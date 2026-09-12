import { createBorderMeshWorkerClient } from "../border_mesh_worker_client.js";
import {
  appendPreparedCountryBorderMeshesState,
  replaceCachedDetailAdmBordersState,
} from "../state/actions/renderer_cache_actions.js";

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
}) {
  let sceneKey = "";
  let policies = new Map();
  function identity() {
    return getBorderWorkerIdentity(state);
  }
  function readSources() {
    return getSourceTopologies().filter(({ topology }) => topology?.objects?.political)
      .sort((a, b) => (a.key === "detail" ? -1 : 1) - (b.key === "detail" ? -1 : 1));
  }
  function signature(source) { return `${identity()}|${getGeometrySourceSignature(source.topology, source.key)}`; }
  function packet(source) {
    const sourceSignature = signature(source);
    const previous = policies.get(source.key);
    if (previous?.sourceSignature === sourceSignature && previous.topology === source.topology) return previous;
    const geometryPolicy = [];
    const visit = (geometry) => {
      if (geometry?.type === "GeometryCollection") { (geometry.geometries || []).forEach(visit); return; }
      if (!geometry) return;
      const feature = asFeatureLike(geometry);
      geometryPolicy.push({
        countryCode: canonicalCountryCode(getFeatureCountryCodeNormalized(feature)) || "",
        excluded: !!shouldExcludePoliticalInteractionFeature(feature),
        admin1Group: getAdmin1Group(geometry), isAdmDetailTier: !!isAdmDetailTier(geometry),
      });
    };
    visit(source.topology.objects.political);
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
    const codes = [...new Set(countries.map(canonicalCountryCode).filter(Boolean))];
    const provinceCountries = includeProvince ? codes.filter((code) => !hasCachedProvinceBorders(state, code)) : [];
    const localCountries = includeLocal ? codes.filter((code) => !hasCachedLocalBorders(state, code)) : [];
    const parts = [];
    for (const source of sources) {
      const allowed = getStaticMeshSourceCountries?.()[source.key];
      const selected = [...new Set([...provinceCountries, ...localCountries])].filter((code) => !allowed || allowed.has(code));
      if (!selected.length) continue;
      const meshes = await client.build({ sceneKey: currentScene, source: packet(source), countries: selected,
        includeProvince: provinceCountries.length > 0, includeLocal: localCountries.length > 0, kind: "country" }, { signal });
      if (currentScene !== identity() || signal?.aborted) throw new DOMException("Stale border batch.", "AbortError");
      if (meshes == null) return null;
      parts.push(meshes);
    }
    let detail = null;
    const detailSource = sources.find((source) => source.key === "detail");
    if (detailCountries.length && detailSource) {
      detail = await client.build({ sceneKey: currentScene, source: packet(detailSource),
        countries: detailCountries, kind: "detail" }, { signal });
      if (currentScene !== identity() || signal?.aborted) throw new DOMException("Stale border batch.", "AbortError");
      if (detail == null) return null;
    }
    return { identity: currentScene, sourceIdentity, provinceCountries, localCountries, parts, detail, detailSignature };
  }
  function commitDeferredBorderMeshes(result) {
    if (!result || result.identity !== identity()) return false;
    const sources = readSources();
    if (sources.length !== result.sourceIdentity.length || result.sourceIdentity.some((prior, index) =>
      prior.key !== sources[index].key || prior.topology !== sources[index].topology || prior.signature !== signature(sources[index]))) return false;
    const provinceEntries = [];
    const localEntries = [];
    for (const country of result.provinceCountries) {
      if (hasCachedProvinceBorders(state, country)) continue;
      const meshes = result.parts.flatMap((part) => part.provinceMeshesByCountry?.get(country) || [])
        .filter((mesh) => mesh?.coordinates?.length);
      provinceEntries.push({ country, meshes });
    }
    for (const country of result.localCountries) {
      if (hasCachedLocalBorders(state, country)) continue;
      const meshes = result.parts.flatMap((part) => part.localMeshesByCountry?.get(country) || [])
        .filter((mesh) => mesh?.coordinates?.length);
      localEntries.push({ country, meshes });
    }
    let changed = appendPreparedCountryBorderMeshesState(state, provinceEntries, localEntries, {
      syncGridLines: result.localCountries.length > 0,
    });
    if (result.detail) {
      const meshes = result.detail.mesh?.coordinates?.length ? [result.detail.mesh] : [];
      const status = meshes.length ? "ready" : "empty";
      if (getDetailAdmMeshBuildState().signature !== result.detailSignature || getDetailAdmMeshBuildState().status !== status) {
        replaceCachedDetailAdmBordersState(state, meshes);
        setDetailAdmMeshBuildState({ signature: result.detailSignature, status }); changed = true;
      }
    }
    return changed;
  }
  return Object.freeze({ buildDeferredBorderMeshesAsync, commitDeferredBorderMeshes,
    dispose: () => { policies.clear(); client.dispose(); } });
}
