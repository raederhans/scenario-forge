import { createBorderMeshWorkerClient } from "../border_mesh_worker_client.js";

export function createBorderMeshWorkerRuntime({
  state, getGeometrySourceSignature, asFeatureLike = (value) => value,
  getFeatureCountryCodeNormalized, shouldExcludePoliticalInteractionFeature,
  getAdmin1Group, isAdmDetailTier, canonicalCountryCode = (value) => value,
  getSourceTopologies = () => [
    { key: "detail", topology: state.topologyDetail },
    { key: "primary", topology: state.topologyPrimary || state.topology },
  ],
  getStaticMeshSourceCountries,
  getDetailAdmMeshBuildState, setDetailAdmMeshBuildState,
  client = createBorderMeshWorkerClient(),
}) {
  let sceneKey = "";
  let policies = new Map();
  function identity() {
    return [state.activeScenarioId, state.scenarioApplyEpoch, state.sceneGeneration,
      state.scenarioDataGeneration, state.topologyRevision, state.sovereigntyRevision,
      state.scenarioShellOverlayRevision, state.scenarioViewMode, state.mapSemanticMode,
      state.showScenarioAtlantropa].join("|");
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
    const provinceCountries = includeProvince ? codes.filter((code) => !state.cachedProvinceBordersByCountry?.has(code)) : [];
    const localCountries = includeLocal ? codes.filter((code) => !state.cachedLocalBordersByCountry?.has(code)) : [];
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
    let changed = false;
    for (const [kind, countries] of [["Province", result.provinceCountries], ["Local", result.localCountries]]) {
      const mapKey = `cached${kind}BordersByCountry`;
      const arrayKey = `cached${kind}Borders`;
      state[mapKey] ||= new Map(); state[arrayKey] ||= [];
      for (const country of countries) {
        if (state[mapKey].has(country)) continue;
        const meshes = result.parts.flatMap((part) => part[`${kind.toLowerCase()}MeshesByCountry`]?.get(country) || [])
          .filter((mesh) => mesh?.coordinates?.length);
        state[mapKey].set(country, meshes); state[arrayKey].push(...meshes); changed = true;
      }
    }
    if (result.localCountries.length) state.cachedGridLines = [...(state.cachedLocalBorders || [])];
    if (result.detail) {
      const meshes = result.detail.mesh?.coordinates?.length ? [result.detail.mesh] : [];
      const status = meshes.length ? "ready" : "empty";
      if (getDetailAdmMeshBuildState().signature !== result.detailSignature || getDetailAdmMeshBuildState().status !== status) {
        state.cachedDetailAdmBorders = meshes;
        setDetailAdmMeshBuildState({ signature: result.detailSignature, status }); changed = true;
      }
    }
    return changed;
  }
  return { buildDeferredBorderMeshesAsync, commitDeferredBorderMeshes,
    dispose: () => { policies.clear(); client.dispose(); } };
}
