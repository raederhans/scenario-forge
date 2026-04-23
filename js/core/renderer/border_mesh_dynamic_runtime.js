export function buildDynamicBorderHash({
  sovereigntyRevision = 0,
  activeScenarioId = '',
  scenarioViewMode = 'ownership',
  scenarioControllerRevision = 0,
  scenarioShellOverlayRevision = 0,
} = {}) {
  return [
    `rev:${Number(sovereigntyRevision) || 0}`,
    `mode:${activeScenarioId ? String(scenarioViewMode || 'ownership') : 'ownership'}`,
    `ctrl:${Number(scenarioControllerRevision) || 0}`,
    `shell:${activeScenarioId ? Number(scenarioShellOverlayRevision) || 0 : 0}`,
  ].join('|');
}

export function getDynamicBorderOwnershipContext(state = {}) {
  return {
    ownershipByFeatureId: state.sovereigntyByFeatureId,
    controllerByFeatureId: state.scenarioControllersByFeatureId,
    shellOwnerByFeatureId: state.scenarioAutoShellOwnerByFeatureId,
    shellControllerByFeatureId: state.scenarioAutoShellControllerByFeatureId,
    scenarioActive: !!state.activeScenarioId,
    viewMode: state.scenarioViewMode,
  };
}

export function buildOwnerBorderMesh({
  runtimeTopology,
  ownershipContext = {},
  excludeSea = false,
  shouldExcludeOwnerBorderEntity = () => false,
  resolveOwnerBorderCode = () => '',
  globalTopojson = globalThis.topojson,
} = {}) {
  const object = runtimeTopology?.objects?.political;
  if (!object || !globalTopojson) return null;
  return globalTopojson.mesh(runtimeTopology, object, (a, b) => {
    if (!a || !b) return false;
    if (shouldExcludeOwnerBorderEntity(a, { excludeSea }) || shouldExcludeOwnerBorderEntity(b, { excludeSea })) {
      return false;
    }
    const ownerA = resolveOwnerBorderCode(a, ownershipContext);
    const ownerB = resolveOwnerBorderCode(b, ownershipContext);
    return !!(ownerA && ownerB && ownerA !== ownerB);
  });
}

export function buildDynamicOwnerBorderMesh({
  runtimeTopology,
  ownershipContext,
  shouldExcludeOwnerBorderEntity = () => false,
  resolveOwnerBorderCode = () => '',
  globalTopojson = globalThis.topojson,
} = {}) {
  return buildOwnerBorderMesh({
    runtimeTopology,
    ownershipContext,
    excludeSea: true,
    shouldExcludeOwnerBorderEntity,
    resolveOwnerBorderCode,
    globalTopojson,
  });
}

export function countUnresolvedOwnerBorderEntities({
  runtimeTopology,
  ownershipContext = {},
  shouldExcludeOwnerBorderEntity = () => false,
  resolveOwnerBorderCode = () => '',
} = {}) {
  const geometries = runtimeTopology?.objects?.political?.geometries;
  if (!Array.isArray(geometries) || !geometries.length) return 0;
  let unresolvedCount = 0;
  geometries.forEach((geometry) => {
    if (shouldExcludeOwnerBorderEntity(geometry, { excludeSea: true })) return;
    if (resolveOwnerBorderCode(geometry, ownershipContext)) return;
    unresolvedCount += 1;
  });
  return unresolvedCount;
}

export function buildDetailAdmBorderMesh({
  topology,
  includedCountries,
  asFeatureLike = (value) => value,
  shouldExcludePoliticalInteractionFeature = () => false,
  getEntityCountryCode = () => '',
  isAdmDetailTier = () => false,
  globalTopojson = globalThis.topojson,
} = {}) {
  const object = topology?.objects?.political;
  if (!object || !globalTopojson || !includedCountries?.size) {
    return null;
  }

  return globalTopojson.mesh(topology, object, (a, b) => {
    if (!a || !b) return false;
    if (shouldExcludePoliticalInteractionFeature(asFeatureLike(a)) || shouldExcludePoliticalInteractionFeature(asFeatureLike(b))) {
      return false;
    }
    const codeA = getEntityCountryCode(a);
    const codeB = getEntityCountryCode(b);
    if (!codeA || !codeB || codeA !== codeB || !includedCountries.has(codeA)) {
      return false;
    }
    return isAdmDetailTier(a) || isAdmDetailTier(b);
  });
}

export function simplifyCoastlineMesh({
  mesh,
  epsilon = 0,
  minLength = 0,
  isUsableMesh = () => false,
  sanitizePolyline = (line) => line,
  getLatitudeAdjustedSimplifyEpsilon = () => epsilon,
  coastlineEffectiveAreaMultiplier = 0.5,
  simplifyPolylineEffectiveArea = (line) => line,
  getLineLength = () => 0,
} = {}) {
  if (!isUsableMesh(mesh)) return null;
  const simplifiedCoordinates = [];

  mesh.coordinates.forEach((line) => {
    const sanitized = sanitizePolyline(line);
    if (sanitized.length < 2) return;
    const adjustedEpsilon = getLatitudeAdjustedSimplifyEpsilon(epsilon, sanitized);
    const effectiveAreaThreshold = adjustedEpsilon * adjustedEpsilon * coastlineEffectiveAreaMultiplier;
    const simplified = simplifyPolylineEffectiveArea(sanitized, effectiveAreaThreshold);
    if (simplified.length < 2) return;
    if (getLineLength(simplified) < Math.max(0, Number(minLength) || 0)) return;
    simplifiedCoordinates.push(simplified);
  });

  if (!simplifiedCoordinates.length) return null;
  return {
    type: 'MultiLineString',
    coordinates: simplifiedCoordinates,
  };
}