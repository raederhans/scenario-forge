// Border/cache state defaults.
// 这里收口边界网格、海岸线和 parent-border 相关缓存，
// 让 renderer owners 与 state.js 共用同一份缓存 shape。

export function createDefaultBorderCacheState() {
  return {
    cachedBorders: null,
    cachedCountryBorders: null,
    cachedDynamicOwnerBorders: null,
    cachedScenarioOpeningOwnerBorders: null,
    cachedFrontlineMesh: null,
    cachedFrontlineMeshHash: "",
    cachedFrontlineLabelAnchors: [],
    cachedFrontlineLabelAnchorsHash: "",
    cachedProvinceBorders: null,
    cachedProvinceBordersByCountry: new Map(),
    cachedLocalBorders: null,
    cachedLocalBordersByCountry: new Map(),
    cachedDetailAdmBorders: null,
    cachedDynamicBordersHash: null,
    cachedCoastlines: null,
    cachedCoastlinesHigh: null,
    cachedCoastlinesMid: null,
    cachedCoastlinesLow: null,
    cachedParentBordersByCountry: new Map(),
    cachedGridLines: null,
    parentBorderSupportedCountries: [],
    parentBorderEnabledByCountry: {},
    parentBorderMetaByCountry: {},
    parentGroupByFeatureId: new Map(),
  };
}
