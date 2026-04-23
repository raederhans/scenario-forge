export function resolveScenarioOpeningOwnerBorderSelection({
  state,
  isUsableMesh = () => false,
} = {}) {
  const runtimeRef = state.runtimePoliticalTopology || null;
  const meshPackRef = state.activeScenarioMeshPack || null;
  const meshPackMesh = meshPackRef?.meshes?.opening_owner_borders || null;
  const hasMeshPackMesh = isUsableMesh(meshPackMesh);
  const hasBaselineOwners = Object.keys(state.scenarioBaselineOwnersByFeatureId || {}).length > 0;
  const scenarioId = String(state.activeScenarioId || "");
  const baselineHash = String(state.scenarioBaselineHash || "");
  const shellRevision = Number(state.scenarioShellOverlayRevision) || 0;
  const meshSource = hasMeshPackMesh ? "mesh_pack" : "runtime";
  const shouldBuild =
    !!scenarioId
    && state.scenarioBorderMode === "scenario_owner_only"
    && String(state.scenarioViewMode || "ownership") === "ownership"
    && (
      hasMeshPackMesh
      || (!!runtimeRef?.objects?.political && hasBaselineOwners)
    );

  return {
    shouldBuild,
    hasMeshPackMesh,
    meshPackMesh,
    runtimeRef,
    meshPackRef,
    scenarioId,
    baselineHash,
    baselineOwnersRef: state.scenarioBaselineOwnersByFeatureId,
    shellRevision,
    meshSource,
    fallbackOwnershipContext: {
      ownershipByFeatureId: state.scenarioBaselineOwnersByFeatureId,
      shellOwnerByFeatureId: state.scenarioAutoShellOwnerByFeatureId,
      scenarioActive: false,
      viewMode: "ownership",
    },
  };
}

export function getSourceCountrySets({
  state,
  getFeatureCountryCodeNormalized = () => "",
  getFeatureId = () => "",
  shouldExcludePoliticalInteractionFeature = () => false,
} = {}) {
  const sets = {
    primary: new Set(),
    detail: new Set(),
  };
  const features = Array.isArray(state.landDataFull?.features) && state.landDataFull.features.length
    ? state.landDataFull.features
    : (Array.isArray(state.landData?.features) ? state.landData.features : []);
  features.forEach((feature) => {
    const source = String(feature?.properties?.__source || "primary");
    const countryCode = getFeatureCountryCodeNormalized(feature);
    const featureId = getFeatureId(feature);
    if (!countryCode || shouldExcludePoliticalInteractionFeature(feature, featureId)) return;
    if (source === "detail") {
      sets.detail.add(countryCode);
      return;
    }
    sets.primary.add(countryCode);
  });
  return sets;
}

export function buildCountryParentBorderMeshes({
  countryCode,
  state,
  canonicalCountryCode = (value) => value,
  getStaticMeshSourceCountries = () => ({ primary: new Set(), detail: new Set() }),
  getEntityCountryCode = () => "",
  getParentGroupForEntity = () => "",
  isUsableMesh = () => false,
} = {}) {
  const normalizedCode = canonicalCountryCode(countryCode);
  if (!normalizedCode || !globalThis.topojson) return [];
  const sourceCountries = getStaticMeshSourceCountries();
  const sources = [
    { key: "detail", topology: state.topologyDetail },
    { key: "primary", topology: state.topologyPrimary || state.topology },
  ];
  const meshes = [];

  sources.forEach(({ key, topology }) => {
    if (!topology?.objects?.political) return;
    if (!sourceCountries[key]?.has(normalizedCode)) return;
    const mesh = globalThis.topojson.mesh(
      topology,
      topology.objects.political,
      (a, b) => {
        if (!a || !b) return false;
        const codeA = getEntityCountryCode(a);
        const codeB = getEntityCountryCode(b);
        if (!codeA || !codeB || codeA !== normalizedCode || codeB !== normalizedCode) return false;
        const groupA = getParentGroupForEntity(a);
        const groupB = getParentGroupForEntity(b);
        return !!(groupA && groupB && groupA !== groupB);
      }
    );
    if (isUsableMesh(mesh)) meshes.push(mesh);
  });

  return meshes;
}

export function buildSourceBorderMeshes({
  topology,
  includedCountries,
  canonicalCountryCode = (value) => value,
  asFeatureLike = (value) => value,
  shouldExcludePoliticalInteractionFeature = () => false,
  getFeatureCountryCodeNormalized = () => "",
  getAdmin1Group = () => "",
  isUsableMesh = () => false,
} = {}) {
  const object = topology?.objects?.political;
  if (!object || !globalThis.topojson || !includedCountries?.size) {
    return null;
  }
  const provinceMeshesByCountry = new Map();
  const localMeshesByCountry = new Map();
  const provinceMeshes = [];
  const localMeshes = [];

  includedCountries.forEach((countryCode) => {
    const normalizedCode = canonicalCountryCode(countryCode);
    if (!normalizedCode) return;
    const provinceMesh = globalThis.topojson.mesh(
      topology,
      object,
      (a, b) => {
        if (!a || !b) return false;
        if (shouldExcludePoliticalInteractionFeature(asFeatureLike(a)) || shouldExcludePoliticalInteractionFeature(asFeatureLike(b))) {
          return false;
        }
        const codeA = getFeatureCountryCodeNormalized(a);
        const codeB = getFeatureCountryCodeNormalized(b);
        if (!codeA || !codeB || codeA !== normalizedCode || codeB !== normalizedCode) return false;
        const groupA = getAdmin1Group(a);
        const groupB = getAdmin1Group(b);
        return !!(groupA && groupB && groupA !== groupB);
      }
    );
    if (isUsableMesh(provinceMesh)) {
      provinceMeshesByCountry.set(normalizedCode, [provinceMesh]);
      provinceMeshes.push(provinceMesh);
    }

    const localMesh = globalThis.topojson.mesh(
      topology,
      object,
      (a, b) => {
        if (!a || !b) return false;
        if (shouldExcludePoliticalInteractionFeature(asFeatureLike(a)) || shouldExcludePoliticalInteractionFeature(asFeatureLike(b))) {
          return false;
        }
        const codeA = getFeatureCountryCodeNormalized(a);
        const codeB = getFeatureCountryCodeNormalized(b);
        if (!codeA || !codeB || codeA !== normalizedCode || codeB !== normalizedCode) return false;
        const groupA = getAdmin1Group(a);
        const groupB = getAdmin1Group(b);
        return !(groupA && groupB && groupA !== groupB);
      }
    );
    if (isUsableMesh(localMesh)) {
      localMeshesByCountry.set(normalizedCode, [localMesh]);
      localMeshes.push(localMesh);
    }
  });

  return {
    provinceMeshes,
    provinceMeshesByCountry,
    localMeshes,
    localMeshesByCountry,
  };
}

export function buildGlobalCountryBorderMesh({
  primaryTopology,
  asFeatureLike = (value) => value,
  shouldExcludePoliticalInteractionFeature = () => false,
  getFeatureCountryCodeNormalized = () => "",
} = {}) {
  const object = primaryTopology?.objects?.political;
  if (!object || !globalThis.topojson) return null;
  return globalThis.topojson.mesh(
    primaryTopology,
    object,
    (a, b) => {
      if (!a || !b) return false;
      if (shouldExcludePoliticalInteractionFeature(asFeatureLike(a)) || shouldExcludePoliticalInteractionFeature(asFeatureLike(b))) {
        return false;
      }
      const codeA = getFeatureCountryCodeNormalized(a);
      const codeB = getFeatureCountryCodeNormalized(b);
      return !!(codeA && codeB && codeA !== codeB);
    }
  );
}

export function buildGlobalCoastlineMesh({
  topologyInput,
  shouldExcludeOwnerBorderEntity = () => false,
} = {}) {
  const topology = topologyInput?.topology || topologyInput;
  const meshMode = String(topologyInput?.meshMode || "mask");
  if (!topology?.objects || !globalThis.topojson) return null;
  if (meshMode === "political_outline" && topology.objects.political) {
    return globalThis.topojson.mesh(
      topology,
      topology.objects.political,
      (a, b) => !!(a && b && a === b && !shouldExcludeOwnerBorderEntity(a, { excludeSea: true }))
    );
  }
  if (topology.objects.context_land_mask) {
    return globalThis.topojson.mesh(topology, topology.objects.context_land_mask);
  }
  if (topology.objects.land_mask) {
    return globalThis.topojson.mesh(topology, topology.objects.land_mask);
  }
  if (topology.objects.land) {
    return globalThis.topojson.mesh(topology, topology.objects.land);
  }
  if (topology.objects.political) {
    return globalThis.topojson.mesh(
      topology,
      topology.objects.political,
      (a, b) => !!(a && !b)
    );
  }
  return null;
}
