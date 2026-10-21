import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INFRASTRUCTURE_LEVELS, METRIC_DEFINITIONS, aggregateMetricByOwner, infrastructureColor, metricColor,
  metricDisplayKind, metricEntries, metricUnit, readStateMetric, validateMetrics,
} from '../src/data/metrics.js';

const baseRevision = 'a'.repeat(64);
const dataset = {
  manifest: {id: 'hgo-1936', revision: baseRevision},
  core: {
    states: [{id: 1}, {id: 2}, {id: 3}],
    provinceIds: [null, 11, 21, 31],
    provinceStateIds: [null, 1, 2, 3],
  },
};

function stateRecord(overrides = {}) {
  const values = Object.fromEntries(METRIC_DEFINITIONS.map(definition => [definition.id, null]));
  return {
    resources: {steel: null, oil: null, aluminium: null, tungsten: null, chromium: null, rubber: null},
    stateBuildings: {}, provinceBuildings: {}, values: {...values, ...overrides},
  };
}

function payload() {
  return {
    format: 'hgo-native-metrics', schemaVersion: 1,
    baseDataset: {id: 'hgo-1936', revision: baseRevision},
    asOf: '1936.1.1', valueBasis: 'native-game-configuration',
    resourceTypes: ['steel', 'oil', 'aluminium', 'tungsten', 'chromium', 'rubber'],
    buildingTypes: ['air_base', 'infrastructure'],
    states: {
      '1': stateRecord({resource_steel: 0, infrastructure: 2, air_base: 1}),
      '2': stateRecord({resource_steel: null, infrastructure: 4}),
      '3': stateRecord({resource_steel: 5, infrastructure: null}),
    },
  };
}

test('validates exact base binding and state/province coverage', () => {
  const data = payload();
  assert.equal(validateMetrics(data, dataset), data);

  const wrongRevision = structuredClone(data);
  wrongRevision.baseDataset.revision = 'b'.repeat(64);
  assert.throws(() => validateMetrics(wrongRevision, dataset), /revision mismatch/);

  const unknownProvince = structuredClone(data);
  unknownProvince.states['1'].provinceBuildings['31'] = {air_base: 1};
  assert.throws(() => validateMetrics(unknownProvince, dataset), /does not belong/);

  const missingState = structuredClone(data);
  delete missingState.states['3'];
  assert.throws(() => validateMetrics(missingState, dataset), /state coverage/);
});

test('preserves explicit zero and marks absent values missing', () => {
  const data = payload();
  assert.deepEqual(readStateMetric(data, 'resource_steel', 1),
    {stateId: '1', value: 0, unit: 'native-resource-value', status: 'available'});
  assert.deepEqual(readStateMetric(data, 'resource_steel', 2),
    {stateId: '2', value: null, unit: 'native-resource-value', status: 'missing', reason: 'no-source-value'});
  assert.equal(readStateMetric(data, 'resource_steel', 9).status, 'missing');
});

test('aggregates by injected current owner with known and missing counts', () => {
  const data = payload();
  const byOwner = aggregateMetricByOwner(data, 'resource_steel', {
    ownerForState: id => id < 3 ? 'AAA' : 'BBB',
  });
  assert.deepEqual(byOwner, [
    {owner: 'AAA', value: 0, knownCount: 1, missingCount: 1,
      aggregation: 'sum', complete: false},
    {owner: 'BBB', value: 5, knownCount: 1, missingCount: 0,
      aggregation: 'sum', complete: true},
  ]);
  const infrastructure = aggregateMetricByOwner(data, 'infrastructure', {
    ownerForState: id => id < 3 ? 'AAA' : 'BBB',
  });
  assert.equal(infrastructure[0].value, 3);
  assert.equal(infrastructure[0].knownCount, 2);
  assert.equal(infrastructure[0].missingCount, 0);
});

test('returns normalized state entries for the caller color table', () => {
  const entries = metricEntries(payload(), 'resource_steel');
  assert.deepEqual(entries.map(({value, normalized, status}) => [value, normalized, status]), [
    [0, 0, 'available'],
    [null, null, 'missing'],
    [5, 1, 'available'],
  ]);
});

test('declares source building limits, scopes, and presentation independently', () => {
  const definitions = new Map(METRIC_DEFINITIONS.map(definition => [definition.id, definition]));
  assert.deepEqual(METRIC_DEFINITIONS.filter(definition => metricDisplayKind(definition.id) === 'symbols')
    .map(definition => definition.id), [
    'resource_steel', 'resource_oil', 'resource_aluminium', 'resource_tungsten',
    'resource_chromium', 'resource_rubber',
  ]);
  assert.equal(metricDisplayKind('infrastructure'), 'levels');
  assert.equal(definitions.get('infrastructure').maxLevel, 10);
  for (const [id, maxLevel, provincial, unit] of [
    ['industrial_complex', 20, false, 'native-building-count'],
    ['arms_factory', 20, false, 'native-building-count'],
    ['dockyard', 20, false, 'native-building-count'],
    ['air_base', 10, false, 'native-building-level'],
    ['naval_base', 10, true, 'native-province-level-sum'],
    ['coastal_bunker', 10, true, 'native-province-level-sum'],
    ['bunker', 10, true, 'native-province-level-sum'],
    ['anti_air_building', 5, false, 'native-building-level'],
    ['radar_station', 6, false, 'native-building-level'],
    ['synthetic_refinery', 3, false, 'native-building-count'],
  ]) {
    const definition = definitions.get(id);
    assert.equal(definition.maxLevel, maxLevel, id);
    assert.equal(definition.provincial, provincial, id);
    assert.equal(definition.unit, unit, id);
    assert.equal(metricDisplayKind(id), 'fill', id);
  }
  for (const id of ['none', undefined, 'unknown']) assert.equal(metricDisplayKind(id), 'none');
});

test('infrastructure colors use the native 0..10 scale without view normalization', () => {
  assert.deepEqual(INFRASTRUCTURE_LEVELS, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(Object.isFrozen(INFRASTRUCTURE_LEVELS));
  const colors = INFRASTRUCTURE_LEVELS.map(infrastructureColor);
  assert.equal(new Set(colors.map(color => color.join(','))).size, 11);
  assert.deepEqual(colors[0], [237, 242, 237, 255]);
  assert.deepEqual(colors[10], [23, 78, 96, 255]);
  const luminance = ([r, g, b]) => {
    const linear = channel => {
      const s = channel / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  };
  for (let level = 0; level <= 10; level++) {
    assert.equal(colors[level][3], 255);
    if (level > 0) assert.ok(luminance(colors[level]) < luminance(colors[level - 1]));
  }
  for (const invalid of [null, undefined, NaN, Infinity, -Infinity, -1, 11, 2.5, '2']) {
    assert.deepEqual(infrastructureColor(invalid), [0, 0, 0, 0]);
  }
  const mutableColor = infrastructureColor(0);
  mutableColor[0] = 0;
  assert.deepEqual(infrastructureColor(0), colors[0]);
  // Existing non-infrastructure fills retain their original normalized palette.
  assert.deepEqual(metricColor(0), [45, 119, 141, 255]);
  assert.deepEqual(metricColor(1), [255, 189, 54, 255]);
  // A view whose maximum is 9 must still leave color 10 distinct and available.
  assert.notDeepEqual(infrastructureColor(9), infrastructureColor(10));
});

test('resolves state-first units and province level sums without changing source values', () => {
  const data = payload();
  data.states['1'].stateBuildings = {naval_base: 0, air_base: 1, industrial_complex: 2};
  data.states['1'].provinceBuildings = {'11': {naval_base: 10, infrastructure: 10}};
  data.states['1'].values.naval_base = 0;
  data.states['1'].values.industrial_complex = 2;
  data.states['2'].provinceBuildings = {'21': {naval_base: 10}, '22': {naval_base: 8}};
  data.states['2'].values.naval_base = 18;
  const original = structuredClone(data);
  assert.equal(metricUnit(data, 'air_base', 1), 'native-building-level');
  assert.equal(metricUnit(data, 'industrial_complex', 1), 'native-building-count');
  assert.equal(metricUnit(data, 'naval_base', 1), 'native-building-level');
  assert.equal(metricUnit(data, 'naval_base', 2), 'native-province-level-sum');
  assert.equal(metricUnit(data, 'naval_base'), 'native-building-configuration');
  assert.deepEqual(readStateMetric(data, 'naval_base', 1), {
    stateId: '1', value: 0, unit: 'native-building-level', status: 'available',
  });
  assert.deepEqual(readStateMetric(data, 'naval_base', 2), {
    stateId: '2', value: 18, unit: 'native-province-level-sum', status: 'available',
  });
  // Infrastructure ignores province configuration, as does the producer.
  assert.equal(metricUnit(data, 'infrastructure', 1), 'native-building-level');
  assert.equal(readStateMetric(data, 'infrastructure', 1).value, 2);
  assert.equal(readStateMetric(data, 'naval_base', 3).value, null);
  assert.equal(metricUnit(data, 'naval_base', 3), 'native-province-level-sum');
  assert.equal(metricUnit(data, 'naval_base', 9), 'native-province-level-sum');
  assert.deepEqual(data, original);
  delete data.states['1'].stateBuildings.naval_base;
  data.states['1'].values.naval_base = 10;
  assert.equal(metricUnit(data, 'naval_base'), 'native-province-level-sum');
  assert.throws(() => metricUnit(data, 'unknown'), /Unknown HGO metric/);
});
