// Topology geometry is immutable within one political object identity. Country
// assignment is not: its caller-owned revision invalidates only country groups.
const politicalGeometryIndexes = new WeakMap();

function getPoliticalCountryIndex(object, resolveCountry, assignmentRevision) {
  let geometryIndex = politicalGeometryIndexes.get(object);
  if (!geometryIndex) {
    const geometries = [];
    const arcGeometries = new Map();
    const arcsByGeometry = new Map();
    const visitGeometry = (geometry) => {
      if (geometry?.type === "GeometryCollection") {
        (geometry.geometries || []).forEach(visitGeometry);
        return;
      }
      if (!geometry) return;
      geometries.push(geometry);
      const arcIds = new Set();
      const visitArcs = (arcs) => {
        for (const arc of arcs || []) {
          if (Array.isArray(arc)) visitArcs(arc);
          else if (Number.isInteger(arc)) arcIds.add(arc < 0 ? ~arc : arc);
        }
      };
      visitArcs(geometry.arcs);
      arcsByGeometry.set(geometry, arcIds);
      for (const arcId of arcIds) {
        if (!arcGeometries.has(arcId)) arcGeometries.set(arcId, []);
        arcGeometries.get(arcId).push(geometry);
      }
    };
    visitGeometry(object);
    geometryIndex = { geometries, arcGeometries, arcsByGeometry,
      order: new Map(geometries.map((geometry, index) => [geometry, index])), assignments: new WeakMap() };
    politicalGeometryIndexes.set(object, geometryIndex);
  }
  const revision = String(assignmentRevision);
  let assignment = geometryIndex.assignments.get(resolveCountry);
  if (!assignment || assignment.revision !== revision) {
    const countries = new Map();
    const codes = new Map();
    for (const geometry of geometryIndex.geometries) {
      const code = resolveCountry(geometry);
      codes.set(geometry, code);
      if (!code) continue;
      if (!countries.has(code)) countries.set(code, []);
      countries.get(code).push(geometry);
    }
    assignment = { revision, countries, codes, objects: new Map() };
    geometryIndex.assignments.set(resolveCountry, assignment);
  }
  return {
    codes: assignment.codes,
    getCountryObject(countryCode) {
      if (assignment.objects.has(countryCode)) return assignment.objects.get(countryCode);
      const members = assignment.countries.get(countryCode) || [];
      const included = new Set(members);
      // Keep every original neighbor on a target arc. Removing these would turn
      // international boundaries into a===b coastline in topojson.mesh.
      for (const geometry of members) {
        for (const arcId of geometryIndex.arcsByGeometry.get(geometry)) {
          for (const neighbor of geometryIndex.arcGeometries.get(arcId)) included.add(neighbor);
        }
      }
      const subset = { type: "GeometryCollection", geometries: [...included]
        .sort((a, b) => geometryIndex.order.get(a) - geometryIndex.order.get(b)) };
      assignment.objects.set(countryCode, subset);
      return subset;
    },
  };
}

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
  countryAssignmentRevision = "",
  includeProvince = true,
  includeLocal = true,
} = {}) {
  const object = topology?.objects?.political;
  if (!object || !globalThis.topojson || !includedCountries?.size) {
    return null;
  }
  const provinceMeshesByCountry = new Map();
  const localMeshesByCountry = new Map();
  const provinceMeshes = [];
  const localMeshes = [];
  const countryIndex = getPoliticalCountryIndex(object, getFeatureCountryCodeNormalized, countryAssignmentRevision);
  const excludedByGeometry = new WeakMap();
  const groupByGeometry = new WeakMap();
  const isExcluded = (geometry) => {
    if (!excludedByGeometry.has(geometry)) {
      excludedByGeometry.set(geometry, shouldExcludePoliticalInteractionFeature(asFeatureLike(geometry)));
    }
    return excludedByGeometry.get(geometry);
  };
  const getGroup = (geometry) => {
    if (!groupByGeometry.has(geometry)) groupByGeometry.set(geometry, getAdmin1Group(geometry));
    return groupByGeometry.get(geometry);
  };

  includedCountries.forEach((countryCode) => {
    const normalizedCode = canonicalCountryCode(countryCode);
    if (!normalizedCode) return;
    const countryObject = countryIndex.getCountryObject(normalizedCode);
    const provinceMesh = includeProvince ? globalThis.topojson.mesh(
      topology,
      countryObject,
      (a, b) => {
        if (!a || !b) return false;
        if (isExcluded(a) || isExcluded(b)) {
          return false;
        }
        const codeA = countryIndex.codes.get(a);
        const codeB = countryIndex.codes.get(b);
        if (!codeA || !codeB || codeA !== normalizedCode || codeB !== normalizedCode) return false;
        const groupA = getGroup(a);
        const groupB = getGroup(b);
        return !!(groupA && groupB && groupA !== groupB);
      }
    ) : null;
    if (isUsableMesh(provinceMesh)) {
      provinceMeshesByCountry.set(normalizedCode, [provinceMesh]);
      provinceMeshes.push(provinceMesh);
    }

    const localMesh = includeLocal ? globalThis.topojson.mesh(
      topology,
      countryObject,
      (a, b) => {
        if (!a || !b) return false;
        if (isExcluded(a) || isExcluded(b)) {
          return false;
        }
        const codeA = countryIndex.codes.get(a);
        const codeB = countryIndex.codes.get(b);
        if (!codeA || !codeB || codeA !== normalizedCode || codeB !== normalizedCode) return false;
        const groupA = getGroup(a);
        const groupB = getGroup(b);
        return !(groupA && groupB && groupA !== groupB);
      }
    ) : null;
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
