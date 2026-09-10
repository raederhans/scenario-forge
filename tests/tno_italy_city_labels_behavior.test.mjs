import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createCityLabelTextModel } from '../js/core/renderer/city_label_text_model.js';
import { createUrbanCityPolicyOwner } from '../js/core/renderer/urban_city_policy.js';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const base = { ...read('../data/locales.json').geo, ...read('../data/city_aliases.json').geo };
const patch = read('../data/scenarios/tno_1962/geo_locale_patch.json').geo;
const world = read('../data/world_cities.geojson');
const overrides = read('../data/scenarios/tno_1962/city_overrides.json');

function setup() {
  const state = {
    activeScenarioId: 'tno_1962', currentLanguage: 'zh', worldCitiesData: world,
    scenarioCityOverridesData: overrides, scenarioCountriesByTag: {},
    sovereigntyByFeatureId: {}, cityLayerRevision: 0,
    scenarioGeoLocalePatchData: { geo: patch },
  };
  const key = feature => feature.properties.id;
  const owner = createUrbanCityPolicyOwner({ state,
    caches: { cityLayerCache: {}, urbanFeatureIndexCache: {} },
    helpers: {
      getCityFeatureKey: key, getCityCanonicalId: key,
      getCityFeatureAliases: f => new Set([key(f), f.properties.stable_key]),
      getCityTier: f => f.properties.tier,
      getDefaultCityMinZoomForTier: () => 0,
      getCityCapitalScore: () => 0, getCityTierWeight: () => 1,
    },
  });
  const lookup = (keys, fallback) => {
    const geo = state.activeScenarioId ? { ...base, ...patch } : base;
    for (const k of Array.isArray(keys) ? keys : [keys]) {
      if (geo[k]?.[state.currentLanguage]) return geo[k][state.currentLanguage];
    }
    return fallback;
  };
  const model = createCityLabelTextModel(state, { getStrictGeoLabel: lookup, getPreferredGeoLabel: lookup });
  return { state, label(id) {
    const feature = owner.getEffectiveCityCollection().features.find(f => key(f) === `CITY::${id}`);
    assert.ok(feature, id);
    return model.getCityDisplayLabel(feature);
  } };
}

test('Italian historical and colonial names reach both city label paths', () => {
  const { state, label } = setup();
  for (const [id, en, zh] of [
    ['gn::3175058', 'Littoria', '利托里亚'],
    ['gn::3164672', 'Istonio', '伊斯托尼奥'],
    ['gn::3177363', 'Resina', '雷西纳'],
    ['ne::1159139005', 'Beda Littoria', '贝达利托里亚'],
    ['gn::89055', 'Beda Littoria', '贝达利托里亚'],
    ['ne::1159148163', 'Rocca Littorio', '利托里奥堡'],
    ['ne::1159137877', 'Villabruzzi', '阿布鲁齐村'],
    ['ne::1159120029', 'Porto Edda', '艾达港'],
    ['ne::1159147221', 'Nizza', '尼斯'],
    ['ne::1159151315', 'Milano', '米兰'],
    ['ne::1159139469', 'Cagliari', '卡利亚里'],
    ['gn::248370', 'Madaba', '马代巴'],
    ['gn::248875', 'Jarash', '杰拉什'],
  ]) {
    state.currentLanguage = 'en'; assert.equal(label(id), en, id);
    state.currentLanguage = 'zh'; assert.equal(label(id), zh, id);
  }
});

test('same-name cities and Italian client states retain separate identities', () => {
  const { state, label } = setup();
  for (const [id, en, zh] of [
    ['ne::1159151415', 'Tripoli', '的黎波里'],
    ['ne::1159148623', 'Tripoli del Levante', '黎凡特的黎波里'],
    ['ne::1159142183', 'Tripoli', '特里波利'],
    ['ne::1159139505', 'Bari', '巴里'],
    ['gn::6913519', 'Samara', '萨马拉'],
    ['ne::1159151079', 'Belgrade', '贝尔格莱德'],
    ['ne::1159150875', 'Zagreb', '萨格勒布'],
    ['ne::1159151191', 'Victoria', '维多利亚'],
  ]) {
    state.currentLanguage = 'en'; assert.equal(label(id), en, id);
    state.currentLanguage = 'zh'; assert.equal(label(id), zh, id);
  }
  assert.equal(patch.ITI44.en, 'Littoria');
  const somaliBari = 'SO_ADM1_83879307B19000204873860';
  assert.equal((patch[somaliBari] ?? base[`id::${somaliBari}`]).zh, '巴里');
  assert.equal(patch['JOR-856'].zh, '杰拉什');
  assert.equal(patch['ME_ADM1_MNE-1496'].zh, '巴尔');
});

test('leaving TNO restores the base city names without colonial overrides', () => {
  const { state, label } = setup();
  assert.equal(label('gn::3175058'), '利托里亚');
  state.activeScenarioId = '';
  state.scenarioCityOverridesData = null;
  state.scenarioGeoLocalePatchData = null;
  state.cityLayerRevision++;
  state.currentLanguage = 'en';
  for (const [id, name] of [
    ['gn::3175058', 'Latina'],
    ['gn::3177363', 'Ercolano'],
    ['ne::1159148163', 'Galkayo'],
    ['ne::1159147221', 'Nice'],
    ['ne::1159151315', 'Milan'],
  ]) assert.equal(label(id), name, id);
});

