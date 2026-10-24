import { createBorderMeshWorkerClient } from "../border_mesh_worker_client.js";
import { isUsableLineMesh } from "./packed_line_mesh.js";
import {
  appendPreparedCountryBorderMeshesState,
  replaceCachedDetailAdmBordersState,
} from "../state/actions/renderer_cache_actions.js";
import { yieldToBackground } from "../background_yield.js";

import { getBorderWorkerIdentity, getDefaultBorderWorkerSources,
  hasCachedProvinceBorders, hasCachedLocalBorders } from "./border_mesh_queries.js";

export function createBorderMeshWorkerRuntime({
  state, getGeometrySourceSignature, asFeatureLike = (value) => value,
  getFeatureCountryCodeNormalized, shouldExcludePoliticalInteractionFeature,
  getAdmin1Group, isAdmDetailTier, canonicalCountryCode = (value) => value,
  getSourceTopologies = () => getDefaultBorderWorkerSources(state),
  getStaticMeshSourceCountries,
  getDetailAdmMeshBuildState, setDetailAdmMeshBuildState,
  client = createBorderMeshWorkerClient(),
  yieldControl = yieldToBackground,
  nowMs = () => performance.now(),
}) {
  let sceneKey = "";
  let policies = new Map();
  let disposed = false;
  function identity() {
    return getBorderWorkerIdentity(state);
  }
  function workerSceneKey() {
    return `${state.activeScenarioId || ""}|${state.sceneGeneration || 0}`;
  }
  function readSources() {
    return getSourceTopologies().filter(({ topology }) => topology?.objects?.political)
      .sort((a, b) => (a.key === "detail" ? -1 : 1) - (b.key === "detail" ? -1 : 1));
  }
  function signature(source) { return `${identity()}|${getGeometrySourceSignature(source.topology, source.key)}`; }
  function sourcesMatch(sourceIdentity) {
    const sources = readSources();
    return sources.length === sourceIdentity.length && sourceIdentity.every((prior, index) =>
      prior.key === sources[index].key && prior.topology === sources[index].topology
      && prior.signature === signature(sources[index]));
  }
  async function preparePacket(source, assertCurrent) {
    assertCurrent();
    const sourceSignature = signature(source);
    const previous = policies.get(source.key);
    if (previous?.sourceSignature === sourceSignature && previous.topology === source.topology) return previous;
    const geometryPolicy = [];
    // Iterator frames retain forEach's DFS order without copying a large child array.
    // A work unit includes collection entry/exit and empty entries, not only policies.
    const stack = [{ geometries: [source.topology.objects.political], index: 0, length: 1 }];
    while (stack.length) {
      assertCurrent();
      const started = nowMs();
      let work = 0;
      do {
        const frame = stack[stack.length - 1];
        if (frame.index >= frame.length) {
          stack.pop();
        } else {
          const index = frame.index++;
          const geometry = index in frame.geometries ? frame.geometries[index] : null;
          if (geometry?.type === "GeometryCollection") {
            const geometries = geometry.geometries || [];
            stack.push({ geometries, index: 0, length: geometries.length });
          } else if (geometry) {
            const feature = asFeatureLike(geometry);
            geometryPolicy.push({
              countryCode: canonicalCountryCode(getFeatureCountryCodeNormalized(feature)) || "",
              excluded: !!shouldExcludePoliticalInteractionFeature(feature),
              admin1Group: getAdmin1Group(geometry), isAdmDetailTier: !!isAdmDetailTier(geometry),
            });
          }
        }
        // Individual synchronous policy callbacks cannot be preempted.
        work += 1;
      } while (stack.length && work < 512 && nowMs() - started < 4);
      assertCurrent();
      if (stack.length) await yieldControl();
    }
    assertCurrent();
    const next = { sourceKey: source.key, sourceSignature, topology: source.topology, geometryPolicy };
    policies.set(source.key, next);
    return next;
  }
  async function buildDeferredBorderMeshesAsync({ countries = [], includeProvince, includeLocal,
    detailCountries = [], detailSignature = "", signal } = {}) {
    const currentScene = identity();
    if (sceneKey !== currentScene) { policies.clear(); sceneKey = currentScene; }
    const sources = readSources();
    const sourceIdentity = sources.map((source) => ({ ...source, signature: signature(source) }));
    const assertCurrent = () => {
      if (disposed || signal?.aborted || currentScene !== identity() || !sourcesMatch(sourceIdentity)) {
        throw new DOMException("Stale border batch.", "AbortError");
      }
    };
    assertCurrent();
    const codes = [...new Set(countries.map(canonicalCountryCode).filter(Boolean))];
    const provinceCountries = includeProvince ? codes.filter((code) => !hasCachedProvinceBorders(state, code)) : [];
    const localCountries = includeLocal ? codes.filter((code) => !hasCachedLocalBorders(state, code)) : [];
    const parts = [];
    for (const source of sources) {
      const allowed = getStaticMeshSourceCountries?.()[source.key];
      const selected = [...new Set([...provinceCountries, ...localCountries])].filter((code) => !allowed || allowed.has(code));
      if (!selected.length) continue;
      const prepared = await preparePacket(source, assertCurrent);
      assertCurrent();
      const meshes = await client.build({ sceneKey: workerSceneKey(), source: prepared, countries: selected,
        includeProvince: provinceCountries.length > 0, includeLocal: localCountries.length > 0, kind: "country" }, { signal });
      assertCurrent();
      if (meshes == null) return null;
      parts.push(meshes);
    }
    let detail = null;
    const detailSource = sources.find((source) => source.key === "detail");
    if (detailCountries.length && detailSource) {
      const prepared = await preparePacket(detailSource, assertCurrent);
      assertCurrent();
      detail = await client.build({ sceneKey: workerSceneKey(), source: prepared,
        countries: detailCountries, kind: "detail" }, { signal });
      assertCurrent();
      if (detail == null) return null;
    }
    return { identity: currentScene, sourceIdentity, provinceCountries, localCountries, parts, detail, detailSignature };
  }
  function commitDeferredBorderMeshes(result) {
    if (disposed || !result || result.identity !== identity() || !sourcesMatch(result.sourceIdentity)) return false;
    const provinceEntries = [];
    const localEntries = [];
    for (const country of result.provinceCountries) {
      if (hasCachedProvinceBorders(state, country)) continue;
      const meshes = result.parts.flatMap((part) => part.provinceMeshesByCountry?.get(country) || [])
        .filter(isUsableLineMesh);
      provinceEntries.push({ country, meshes });
    }
    for (const country of result.localCountries) {
      if (hasCachedLocalBorders(state, country)) continue;
      const meshes = result.parts.flatMap((part) => part.localMeshesByCountry?.get(country) || [])
        .filter(isUsableLineMesh);
      localEntries.push({ country, meshes });
    }
    let changed = appendPreparedCountryBorderMeshesState(state, provinceEntries, localEntries, {
      syncGridLines: result.localCountries.length > 0,
    });
    if (result.detail) {
      const meshes = isUsableLineMesh(result.detail.mesh) ? [result.detail.mesh] : [];
      const status = meshes.length ? "ready" : "empty";
      if (getDetailAdmMeshBuildState().signature !== result.detailSignature || getDetailAdmMeshBuildState().status !== status) {
        replaceCachedDetailAdmBordersState(state, meshes);
        setDetailAdmMeshBuildState({ signature: result.detailSignature, status }); changed = true;
      }
    }
    return changed;
  }
  return Object.freeze({ buildDeferredBorderMeshesAsync, commitDeferredBorderMeshes,
    dispose: () => { disposed = true; policies.clear(); client.dispose(); } });
}
