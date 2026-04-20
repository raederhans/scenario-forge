// Spatial index state defaults.
// 这里收口 feature-id 映射和命中测试网格容器，
// 让 state.js 与 spatial_index_runtime_owner 共用同一份默认 shape。

export function createDefaultSecondarySpatialIndexState() {
  return {
    waterSpatialIndex: null,
    waterSpatialItems: [],
    waterSpatialGrid: new Map(),
    waterSpatialGridMeta: null,
    waterSpatialItemsById: new Map(),
    specialSpatialIndex: null,
    specialSpatialItems: [],
    specialSpatialGrid: new Map(),
    specialSpatialGridMeta: null,
    specialSpatialItemsById: new Map(),
  };
}

export function createDefaultSpatialIndexState() {
  return {
    landIndex: new Map(),
    countryToFeatureIds: new Map(),
    idToKey: new Map(),
    keyToId: new Map(),
    spatialIndex: null,
    spatialItems: [],
    spatialGrid: new Map(),
    spatialGridMeta: null,
    spatialItemsById: new Map(),
    waterRegionsById: new Map(),
    specialRegionsById: new Map(),
    ...createDefaultSecondarySpatialIndexState(),
  };
}
