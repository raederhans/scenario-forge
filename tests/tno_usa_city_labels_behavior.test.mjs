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

test('US and Japanese Pacific names reach both language label paths', () => {
  const { state, label } = setup();
  for (const [id, en, zh] of [
    ['ne::1159151221', 'Tōkō', '东港'],
    ['ne::1159149209', 'Hiro', '比吕'],
    ['ne::1159149065', 'Akashi', '明石'],
    ['ne::1159146053', 'Korōru', '科吕尔'],
    ['gn::7828758', 'Saipan', '彩帆'],
    ['ne::1159150549', 'Barrow', '巴罗'],
    ['ne::1159134071', 'McKinley Park', '麦金利帕克'],
    ['gn::5363748', 'Wilshire District', '威尔希尔区'],
    ['ne::1159132911', 'Waterloo', '滑铁卢'],
    ['ne::1159123893', 'Lawrence', '劳伦斯'],
    ['ne::1159149273', 'Burlington', '伯灵顿'],
    ['gn::5125771', 'Manhattan', '曼哈顿'],
    ['gn::5110266', 'The Bronx', '布朗克斯'],
    ['gn::5139568', 'Staten Island', '斯塔滕岛'],
    ['gn::4043909', 'Dededo Village', '迪迪多'],
  ]) {
    state.currentLanguage = 'en'; assert.equal(label(id), en, id);
    state.currentLanguage = 'zh'; assert.equal(label(id), zh, id);
  }
});

test('occupation names stay on the named settlement, and US Pacific names remain local', () => {
  const { state, label } = setup();
  for (const [id, en, zh] of [
    ['ne::1159132503', 'Wahiawa', '瓦希阿瓦'],
    ['ne::1159132507', 'Wailuku', '怀卢库'],
    ['ne::1159146199', 'Long Beach', '长滩'],
    ['ne::1159150429', 'Pago Pago', '帕果帕果'],
    ['ne::1159150449', 'Papeete', '帕皮提'],
    ['ne::1159149061', 'Palikir', '帕利基尔'],
  ]) {
    state.currentLanguage = 'en'; assert.equal(label(id), en, id);
    state.currentLanguage = 'zh'; assert.equal(label(id), zh, id);
  }
  assert.equal(patch.US_CNTY_15003.en, 'Tōkō');
  assert.equal(patch.US_CNTY_15007.zh, '考艾岛');
  const topology = read('../data/scenarios/tno_1962/runtime_topology.topo.json');
  const wake = topology.objects.political.geometries.find(f => f.properties.name === 'Wake County');
  assert.ok(wake);
  assert.equal(patch[wake.properties.id].zh, '韦克县');
});

test('leaving TNO restores base Hawaiian and Pacific city names in both languages', () => {
  const { state, label } = setup();
  assert.equal(label('ne::1159151221'), '东港');
  state.activeScenarioId = '';
  state.scenarioCityOverridesData = null;
  state.scenarioGeoLocalePatchData = null;
  state.cityLayerRevision++;
  for (const [id, en, zh] of [
    ['ne::1159151221', 'Honolulu', '檀香山'],
    ['ne::1159149209', 'Hilo', '希洛'],
    ['ne::1159149065', 'Hagåtña', '阿加尼亚'],
    ['ne::1159146053', 'Koror', '科罗尔'],
  ]) {
    state.currentLanguage = 'en'; assert.equal(label(id), en, id);
    state.currentLanguage = 'zh'; assert.equal(label(id), zh, id);
  }
});
