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

test('Northwest European scenario and historical names reach both language paths', () => {
  const { state, label } = setup();
  for (const [id, en, zh] of [
    ['ne::1159150641', 'Drontheim', '德龙泰姆'],
    ['ne::1159149457', 'Der Haag', '海牙'],
    ['gn::2750053', 'Nimwegen', '奈梅亨'],
    ['ne::1159146437', 'Luxemburg', '卢森堡'],
    ['gn::2753184', 'Loopuytdorp', '洛普伊特村'],
    ['gn::2613102', 'Sonderburg', '宗德堡'],
    ['gn::2620964', 'Hadersleben', '哈德斯莱本'],
    ['gn::2611497', 'Tondern', '滕德恩'],
    ['gn::7911309', 'Pargas', '帕尔加斯'],
    ['ne::1159135089', 'Derry', '德里'],
    ['gn::2635412', 'Truro', '特鲁罗'],
    ['ne::1159150939', 'Nuuk', '努克'],
    ['gn::662095', 'Äänekoski', '艾内科斯基'],
  ]) {
    state.currentLanguage = 'en'; assert.equal(label(id), en, id);
    state.currentLanguage = 'zh'; assert.equal(label(id), zh, id);
  }
});

test('city mistranslations are corrected without raw-name or region collisions', () => {
  const { state, label } = setup();
  for (const [id, en, zh] of [
    ['gn::2637627', 'Slough', '斯劳'],
    ['gn::2654187', 'Bury', '伯里'],
    ['gn::2610802', 'Valby', '瓦尔比'],
    ['ne::1159130855', 'Viborg', '维堡'],
    ['gn::2758587', 'Borssele', '博尔瑟勒'],
    ['gn::2759154', 'Bergen', '贝亨'],
    ['ne::1159150643', 'Bergen', '卑尔根'],
    ['ne::1159120321', 'Bergen', '贝亨'],
    ['ne::1159151465', 'Brüssel', '布鲁塞尔'],
    ['ne::1159132333', 'Lüttich', '吕蒂希'],
  ]) {
    state.currentLanguage = 'en'; assert.equal(label(id), en, id);
    state.currentLanguage = 'zh'; assert.equal(label(id), zh, id);
  }
  assert.equal(patch.JE.zh, '泽西岛');
  assert.equal(patch.FI1D8.zh, '卡伊努');
  assert.equal(patch.NL33B.zh, '南荷兰东部');
  assert.equal(patch.NL411.zh, '北布拉班特西部');
});

test('leaving TNO restores base names after Northwest European overrides', () => {
  const { state, label } = setup();
  assert.equal(label('ne::1159150641'), '德龙泰姆');
  state.activeScenarioId = '';
  state.scenarioCityOverridesData = null;
  state.scenarioGeoLocalePatchData = null;
  state.cityLayerRevision++;
  state.currentLanguage = 'en';
  for (const [id, name] of [
    ['ne::1159150641', 'Trondheim'],
    ['ne::1159149457', 'The Hague'],
    ['gn::2753184', 'Julianadorp'],
    ['gn::2613102', 'Sonderborg'],
  ]) assert.equal(label(id), name, id);
});
