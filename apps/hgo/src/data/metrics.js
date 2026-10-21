const RESOURCE_METRICS = [
  ['resource_steel', 'steel', 'Steel', '钢铁'],
  ['resource_oil', 'oil', 'Oil', '石油'],
  ['resource_aluminium', 'aluminium', 'Aluminium', '铝'],
  ['resource_tungsten', 'tungsten', 'Tungsten', '钨'],
  ['resource_chromium', 'chromium', 'Chromium', '铬'],
  ['resource_rubber', 'rubber', 'Rubber', '橡胶'],
];

const BUILDING_METRICS = [
  // maxLevel and provincial follow common/buildings/00_buildings.txt.
  // A provincial maxLevel applies to each province, never to its state sum.
  ['infrastructure', 'Infrastructure', '基础设施', 10, false, 'level'],
  ['industrial_complex', 'Civilian factories', '民用工厂', 20, false, 'count'],
  ['arms_factory', 'Military factories', '军用工厂', 20, false, 'count'],
  ['dockyard', 'Dockyards', '海军船坞', 20, false, 'count'],
  ['air_base', 'Air bases', '空军基地', 10, false, 'level'],
  ['naval_base', 'Naval bases', '海军基地', 10, true, 'level'],
  ['coastal_bunker', 'Coastal forts', '海岸要塞', 10, true, 'level'],
  ['bunker', 'Land forts', '陆上要塞', 10, true, 'level'],
  ['anti_air_building', 'Anti-air buildings', '防空设施', 5, false, 'level'],
  ['radar_station', 'Radar stations', '雷达站', 6, false, 'level'],
  ['synthetic_refinery', 'Synthetic refineries', '合成炼油厂', 3, false, 'count'],
];

const definitions = [
  ...RESOURCE_METRICS.map(([id, sourceKey, en, zh]) => ({
    id, key: sourceKey, group: 'resources', title: Object.freeze({en, zh}),
    unit: 'native-resource-value', display: 'symbols', maxLevel: null, ownerAggregation: 'sum',
  })),
  ...BUILDING_METRICS.map(([id, en, zh, maxLevel, provincial, valueKind]) => ({
    id, key: id, group: 'buildings', title: Object.freeze({en, zh}),
    unit: provincial ? 'native-province-level-sum' : `native-building-${valueKind}`,
    stateUnit: `native-building-${valueKind}`, provincial, maxLevel,
    display: id === 'infrastructure' ? 'levels' : 'fill',
    ownerAggregation: id === 'infrastructure' ? 'mean' : 'sum',
  })),
].map(Object.freeze);

export const METRIC_DEFINITIONS = Object.freeze(definitions);
export const metricDefinitions = METRIC_DEFINITIONS;
const definitionById = new Map(METRIC_DEFINITIONS.map(definition => [definition.id, definition]));
const RESOURCE_KEYS = Object.freeze(RESOURCE_METRICS.map(([, key]) => key));

// Shared by the GPU lookup table and the legend; null remains transparent.
export function metricColor(value) {
  if (value===null||!Number.isFinite(value)) return [0,0,0,0];
  const t=Math.max(0,Math.min(1,value));
  return [Math.round(45+210*t),Math.round(119+70*t),Math.round(141-87*t),255];
}

/** Presentation mode is independent of the values present in the current view. */
export function metricDisplayKind(metricId) {
  return definitionById.get(metricId)?.display ?? 'none';
}

const INFRASTRUCTURE_COLORS = Object.freeze([
  [237, 242, 237], [216, 226, 223], [194, 209, 209], [173, 193, 195],
  [151, 176, 181], [130, 160, 167], [109, 144, 152], [87, 127, 138],
  [66, 111, 124], [44, 94, 110], [23, 78, 96],
].map(color => Object.freeze([...color, 255])));

export const INFRASTRUCTURE_LEVELS = Object.freeze(INFRASTRUCTURE_COLORS.map((_, level) => level));

/** Native infrastructure uses a fixed 0..10 scale, including unobserved levels. */
export function infrastructureColor(value) {
  if (!Number.isInteger(value) || value < 0 || value > 10) return [0, 0, 0, 0];
  return [...INFRASTRUCTURE_COLORS[value]];
}

function assert(ok, message) {
  if (!ok) throw new Error(`Invalid HGO metrics: ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validValue(value) {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}

function stateRows(dataset) {
  const rows = dataset?.core?.states;
  if (Array.isArray(rows)) return rows;
  if (dataset?.stateById instanceof Map) return [...dataset.stateById.values()];
  return null;
}

function provinceOwnerMap(dataset) {
  const ids = dataset?.core?.provinceIds;
  const stateIds = dataset?.core?.provinceStateIds;
  if (!Array.isArray(ids) || !Array.isArray(stateIds) || ids.length !== stateIds.length) return null;
  const result = new Map();
  for (let index = 1; index < ids.length; index++) {
    if (Number.isSafeInteger(ids[index])) result.set(ids[index], stateIds[index]);
  }
  return result;
}

/** Validate the sidecar against the exact loaded native dataset. Returns payload on success. */
export function validateMetrics(payload, dataset) {
  const manifest = dataset?.manifest;
  const rows = stateRows(dataset);
  assert(manifest && typeof manifest.id === 'string' && typeof manifest.revision === 'string', 'missing base manifest');
  assert(Array.isArray(rows), 'missing base state metadata');
  assert(payload?.format === 'hgo-native-metrics' && payload.schemaVersion === 1, 'unsupported format or schema');
  assert(payload.asOf === '1936.1.1' && payload.valueBasis === 'native-game-configuration', 'unsupported metric basis');
  assert(payload.baseDataset?.id === manifest.id && payload.baseDataset?.revision === manifest.revision,
    'base dataset identity or revision mismatch');
  assert(Array.isArray(payload.resourceTypes) && RESOURCE_KEYS.every(key => payload.resourceTypes.includes(key)),
    'missing native resource fields');
  assert(Array.isArray(payload.buildingTypes) && payload.buildingTypes.every(key => typeof key === 'string'),
    'invalid building type list');
  assert(isRecord(payload.states), 'missing state metrics');

  const expectedStateIds = new Set();
  for (const state of rows) {
    assert(Number.isSafeInteger(state?.id), 'invalid base state ID');
    expectedStateIds.add(String(state.id));
  }
  const stateIds = Object.keys(payload.states);
  assert(stateIds.length === expectedStateIds.size && stateIds.every(id => expectedStateIds.has(id)),
    'state coverage differs from the base dataset');

  const provinceState = provinceOwnerMap(dataset);
  for (const [stateId, record] of Object.entries(payload.states)) {
    assert(isRecord(record) && isRecord(record.resources) && isRecord(record.stateBuildings)
      && isRecord(record.provinceBuildings) && isRecord(record.values), `invalid state record ${stateId}`);
    for (const key of RESOURCE_KEYS) {
      assert(validValue(record.resources[key]), `invalid ${key} value in state ${stateId}`);
    }
    for (const [key, value] of Object.entries(record.stateBuildings)) {
      assert(typeof key === 'string' && validValue(value), `invalid state building in state ${stateId}`);
    }
    for (const [provinceId, buildings] of Object.entries(record.provinceBuildings)) {
      const numericProvinceId = Number(provinceId);
      assert(Number.isSafeInteger(numericProvinceId) && numericProvinceId >= 0 && isRecord(buildings),
        `invalid province building reference in state ${stateId}`);
      assert(provinceState?.get(numericProvinceId) === Number(stateId),
        `province ${provinceId} does not belong to state ${stateId}`);
      for (const [key, value] of Object.entries(buildings)) {
        assert(typeof key === 'string' && validValue(value), `invalid province building in state ${stateId}`);
      }
    }
    for (const [key, value] of Object.entries(record.values)) {
      assert(typeof key === 'string' && validValue(value), `invalid aggregate value in state ${stateId}`);
    }
    for (const definition of METRIC_DEFINITIONS) {
      const value = record.values[definition.id];
      assert(validValue(value), `missing or invalid ${definition.id} value in state ${stateId}`);
    }
  }
  return payload;
}

function getDefinition(metricId) {
  const definition = definitionById.get(metricId);
  if (!definition) throw new Error(`Unknown HGO metric: ${metricId}`);
  return definition;
}

function stateMetricUnit(record, definition) {
  if (definition.group === 'resources' || definition.id === 'infrastructure') return definition.unit;
  // Match build_native_metrics.py: an explicit state field wins, including zero.
  if (Object.hasOwn(record?.stateBuildings ?? {}, definition.key)) return definition.stateUnit;
  if (Object.values(record?.provinceBuildings ?? {}).some(buildings => Object.hasOwn(buildings, definition.key))) {
    return 'native-province-level-sum';
  }
  return definition.unit;
}

/** Resolve the recorded scope; a mixed overview cannot claim a single unit. */
export function metricUnit(payload, metricId, stateId) {
  const definition = getDefinition(metricId);
  if (stateId !== undefined && stateId !== null) {
    return stateMetricUnit(payload?.states?.[String(stateId)], definition);
  }
  if (definition.group === 'resources' || metricId === 'infrastructure') return definition.unit;
  const units = new Set();
  for (const record of Object.values(payload?.states ?? {})) {
    if (typeof record.values?.[metricId] === 'number' && Number.isFinite(record.values[metricId])) {
      units.add(stateMetricUnit(record, definition));
      if (units.size > 1) return 'native-building-configuration';
    }
  }
  return units.size ? [...units][0] : definition.unit;
}

/** Read one state's recorded metric without treating absent values as zero. */
export function readStateMetric(payload, metricId, stateId) {
  const definition = getDefinition(metricId);
  const id = String(stateId);
  const record = payload?.states?.[id];
  const unit = stateMetricUnit(record, definition);
  if (!record) return {stateId: id, value: null, unit, status: 'missing', reason: 'state-unrecorded'};
  const value = record.values?.[metricId];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return {stateId: id, value: null, unit, status: 'missing', reason: 'no-source-value'};
  }
  return {stateId: id, value, unit, status: 'available'};
}

/** Aggregate known state values by the current owner supplied by the caller. */
export function aggregateMetricByOwner(payload, metricId, {ownerForState} = {}) {
  const definition = getDefinition(metricId);
  if (typeof ownerForState !== 'function') throw new TypeError('ownerForState must be a function');
  const buckets = new Map();
  for (const stateId of Object.keys(payload?.states ?? {}).sort((a, b) => Number(a) - Number(b))) {
    const owner = ownerForState(Number(stateId));
    if (typeof owner !== 'string' || owner.length === 0) continue;
    let bucket = buckets.get(owner);
    if (!bucket) {
      bucket = {owner, value: 0, knownCount: 0, missingCount: 0, aggregation: definition.ownerAggregation};
      buckets.set(owner, bucket);
    }
    const result = readStateMetric(payload, metricId, stateId);
    if (result.status === 'missing') bucket.missingCount++;
    else { bucket.value += result.value; bucket.knownCount++; }
  }
  return [...buckets.values()].sort((a, b) => a.owner.localeCompare(b.owner)).map(bucket => {
    const value = bucket.knownCount === 0 ? null
      : (bucket.aggregation === 'mean' ? bucket.value / bucket.knownCount : bucket.value);
    return {...bucket, value, complete: bucket.missingCount === 0};
  });
}

/** Return per-state values with one shared 0..1 min/max normalization range. */
export function metricEntries(payload, metricId, {stateIds} = {}) {
  getDefinition(metricId);
  const ids = stateIds === undefined ? Object.keys(payload?.states ?? {}) : [...stateIds].map(String);
  ids.sort((a, b) => Number(a) - Number(b));
  const entries = ids.map(stateId => readStateMetric(payload, metricId, stateId));
  const known = entries.filter(entry => entry.status === 'available');
  const min = known.length ? Math.min(...known.map(entry => entry.value)) : null;
  const max = known.length ? Math.max(...known.map(entry => entry.value)) : null;
  return entries.map(entry => ({
    ...entry,
    normalized: entry.status === 'missing' ? null : (max === min ? 0.5 : (entry.value - min) / (max - min)),
  }));
}
