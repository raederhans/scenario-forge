const facadeState = {
  getPoliticalCollectionOwner: null,
  getContextLayerResolverOwner: null,
  getRendererAssetUrlPolicyOwner: null,
  getFacilitySurfaceOwner: null,
};

function readFacadeGetter(name) {
  const getter = facadeState[name];
  if (typeof getter !== 'function') {
    throw new Error(`[facade_data_runtime] Missing runtime getter: ${name}`);
  }
  return getter;
}

export function configureDataRuntimeFacade(nextState = {}) {
  Object.assign(facadeState, nextState);
}

export function getPoliticalFeatureCollection(topology, sourceName) {
  return readFacadeGetter('getPoliticalCollectionOwner')().getPoliticalFeatureCollection(topology, sourceName);
}

export function normalizeFeatureGeometry(feature, { sourceLabel = 'detail' } = {}) {
  return readFacadeGetter('getPoliticalCollectionOwner')().normalizeFeatureGeometry(feature, { sourceLabel });
}

export function mergeOverrideFeatures(baseFeatures, overrideCollection) {
  return readFacadeGetter('getPoliticalCollectionOwner')().mergeOverrideFeatures(baseFeatures, overrideCollection);
}

export function composePoliticalFeatures(primaryTopology, detailTopology, overrideCollection = null) {
  return readFacadeGetter('getPoliticalCollectionOwner')().composePoliticalFeatures(
    primaryTopology,
    detailTopology,
    overrideCollection,
  );
}

export function composePoliticalFeatureCollections(primaryCollection, detailCollection = null, overrideCollection = null) {
  return readFacadeGetter('getPoliticalCollectionOwner')().composePoliticalFeatureCollections(
    primaryCollection,
    detailCollection,
    overrideCollection,
  );
}

export function collectCountryCoverageStats(features = []) {
  return readFacadeGetter('getPoliticalCollectionOwner')().collectCountryCoverageStats(features);
}

export function buildInteractiveLandData(fullCollection) {
  return readFacadeGetter('getPoliticalCollectionOwner')().buildInteractiveLandData(fullCollection);
}

export function getLayerFeatureCollection(topology, layerName) {
  return readFacadeGetter('getContextLayerResolverOwner')().getLayerFeatureCollection(topology, layerName);
}

export function computeLayerCoverageScore(collection) {
  return readFacadeGetter('getContextLayerResolverOwner')().computeLayerCoverageScore(collection);
}

export function createUrbanLayerCapability(overrides = {}) {
  return readFacadeGetter('getContextLayerResolverOwner')().createUrbanLayerCapability(overrides);
}

export function getUrbanFeatureGeoBounds(feature) {
  return readFacadeGetter('getContextLayerResolverOwner')().getUrbanFeatureGeoBounds(feature);
}

export function getUrbanLayerCapability(collection) {
  return readFacadeGetter('getContextLayerResolverOwner')().getUrbanLayerCapability(collection);
}

export function canRenderUrbanCollection(capability) {
  return readFacadeGetter('getContextLayerResolverOwner')().canRenderUrbanCollection(capability);
}

export function canPreferUrbanDetailCollection(capability) {
  return readFacadeGetter('getContextLayerResolverOwner')().canPreferUrbanDetailCollection(capability);
}

export function pickBestLayerSource(primaryCollection, detailCollection, policy = {}) {
  return readFacadeGetter('getContextLayerResolverOwner')().pickBestLayerSource(
    primaryCollection,
    detailCollection,
    policy,
  );
}

export function resolveContextLayerData(layerName) {
  return readFacadeGetter('getContextLayerResolverOwner')().resolveContextLayerData(layerName);
}

export function ensureLayerDataFromTopology() {
  return readFacadeGetter('getContextLayerResolverOwner')().ensureLayerDataFromTopology();
}

export function getScenarioBathymetryTopologyUrl() {
  return readFacadeGetter('getRendererAssetUrlPolicyOwner')().getScenarioBathymetryTopologyUrl();
}

export function getDesiredBathymetryTopologyUrl(slot) {
  return readFacadeGetter('getRendererAssetUrlPolicyOwner')().getDesiredBathymetryTopologyUrl(slot);
}

export function buildFacilityTooltipText(entry) {
  return readFacadeGetter('getFacilitySurfaceOwner')().buildFacilityTooltipText(entry);
}

export function buildFacilityInfoCardTitle(entry) {
  return readFacadeGetter('getFacilitySurfaceOwner')().buildFacilityInfoCardTitle(entry);
}

export function buildFacilityInfoCardFieldSections(entry) {
  const model = readFacadeGetter('getFacilitySurfaceOwner')().buildFacilityInfoCardFieldSections(entry, false);
  return {
    defaultRows: Array.isArray(model?.rows) ? model.rows : [],
    extraRows: [],
  };
}

export function buildFacilityInfoCardBody(entry, expanded = false) {
  return readFacadeGetter('getFacilitySurfaceOwner')().buildFacilityInfoCardFieldSections(entry, expanded);
}