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

test('Russian regime and occupation names reach both language label paths', () => {
  const { state, label } = setup();
  for (const [id, en, zh] of [
    ['ne::1159150701', 'Sverdlovsk', '斯维尔德洛夫斯克'],
    ['ne::1159128853', 'Ivashchenkovo', '伊瓦申科沃'],
    ['ne::1159128869', 'Novosamarovsk', '新萨马罗夫斯克'],
    ['gn::518659', 'Novosamarovsk', '新萨马罗夫斯克'],
    ['ne::1159149535', 'Äänislinna', '艾尼斯林纳'],
    ['ne::1159149657', 'Toyohara', '丰原'],
    ['ne::1159146759', 'Chumin', '诸民'],
    ['ne::1159146767', 'Yaozhi', '曜之'],
    ['gn::2121052', 'Yaozhi', '曜之'],
    ['gn::2027468', 'Huangtukanzi', '黄土坎子'],
    ['ne::1159129029', 'Huangtukanzi', '黄土坎子'],
    ['ne::1159128915', 'Mundybash', '蒙德巴什'],
    ['ne::1159128793', 'Severny', '谢韦尔内'],
  ]) {
    state.currentLanguage = 'en'; assert.equal(label(id), en, id);
    state.currentLanguage = 'zh'; assert.equal(label(id), zh, id);
  }
});

test('ideological names stay local and leaving TNO restores base names', () => {
  const { state, label } = setup();
  state.currentLanguage = 'en';
  assert.equal(label('ne::1159149623'), 'Ulan-Ude');
  assert.equal(label('ne::1159149583'), 'Novokuznetsk');
  assert.equal(label('ne::1159150775'), 'Perm');
  assert.equal(label('ne::1159149625'), 'Blagoveshchensk');
  state.currentLanguage = 'zh';
  assert.equal(label('gn::576116'), '布拉戈维申斯克');
  assert.equal(label('ne::1159149625'), '海兰泡');
  state.activeScenarioId = '';
  state.scenarioCityOverridesData = null;
  state.scenarioGeoLocalePatchData = null;
  state.cityLayerRevision++;
  state.currentLanguage = 'en';
  assert.equal(label('ne::1159150701'), 'Yekaterinburg');
  assert.equal(label('ne::1159149535'), 'Petrozavodsk');
  assert.equal(label('ne::1159146767'), 'Sovetskaya Gavan');
  state.currentLanguage = 'zh';
  assert.equal(label('ne::1159150701'), '叶卡捷琳堡');
});
