import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createCityLabelTextModel } from '../js/core/renderer/city_label_text_model.js';
import { createUrbanCityPolicyOwner } from '../js/core/renderer/urban_city_policy.js';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const base = { ...read('../data/locales.json').geo, ...read('../data/city_aliases.json').geo };
const patch = read('../data/scenarios/tno_1962/geo_locale_patch.json').geo;
const overrides = read('../data/scenarios/tno_1962/city_overrides.json');
const world = read('../data/world_cities.geojson');

function setup() {
  const state = {
    activeScenarioId: 'tno_1962', currentLanguage: 'zh', cityLayerRevision: 0,
    worldCitiesData: { ...world, features: world.features.map(f => ({ ...f,
      properties: { ...f.properties, __city_host_feature_id: f.properties.host_feature_id },
    })) },
    scenarioCityOverridesData: overrides, scenarioCountriesByTag: {}, sovereigntyByFeatureId: {},
  };
  const key = f => f.properties.id;
  const owner = createUrbanCityPolicyOwner({ state,
    caches: { cityLayerCache: {}, urbanFeatureIndexCache: {} },
    helpers: {
      getCityFeatureKey: key, getCityCanonicalId: key,
      getCityFeatureAliases: f => new Set([key(f), f.properties.stable_key]),
      getCityTier: f => f.properties.tier, getDefaultCityMinZoomForTier: () => 0,
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
  const feature = id => {
    const f = owner.getEffectiveCityCollection().features.find(f => key(f) === `CITY::${id}`);
    assert.ok(f, id); return f;
  };
  return { state, feature, label: id => model.getCityDisplayLabel(feature(id)) };
}

test('Burgundy and African occupation names reach actual merged city labels in both languages', () => {
  const { state, label } = setup();
  for (const [id, en, zh] of [
    ['ne::1159147227', 'Ryssel', '赖瑟尔'],
    ['ne::1159142047', 'Kalen', '卡伦'],
    ['ne::1159144561', 'Karolingen', '卡罗林根'],
    ['gn::2787889', 'Russelaere', '吕瑟拉勒'],
    ['ne::1159151539', 'Leopoldstadt', '利奥波德城'],
    ['ne::1159149865', 'Stanleystadt', '斯坦利城'],
    ['ne::1159150903', 'Elisabethstadt', '伊丽莎白城'],
    ['ne::1159149977', 'Luluaburg', '卢卢阿堡'],
    ['ne::1159150683', 'Lourenço Marques', '洛伦索·马贵斯'],
    ['ne::1159150573', 'Salisbury', '索尔兹伯里'],
    ['ne::1159149733', 'Löweburg', '勒韦堡'],
    ['ne::1159135399', 'Böhmstadt', '贝姆城'],
    ['ne::1159151131', 'Neu Lissabon', '新里斯本'],
    ['ne::1159150785', 'Windhuk', '温得和克'],
  ]) {
    state.currentLanguage = 'en'; assert.equal(label(id), en, id);
    state.currentLanguage = 'zh'; assert.equal(label(id), zh, id);
  }
});

test('district labels stay separate from cities, and scenario names do not leak after exit', () => {
  const { state, label, feature } = setup();
  assert.equal(patch.BE100.zh, '布鲁塞尔首都区');
  assert.equal(label('ne::1159151465'), '布鲁塞尔');
  assert.equal(label('gn::2803201'), '安德莱赫特');
  assert.equal(label('gn::2593460'), '马西纳');
  assert.equal(label('gn::3351500'), '卡阿拉');
  assert.equal(label('gn::2971041'), '施瓦嫩塔尔');
  assert.equal(feature('ne::1159149977').properties.host_feature_id, 'CD_ADM1_COD-1872');
  state.activeScenarioId = ''; state.scenarioCityOverridesData = null; state.cityLayerRevision++;
  state.currentLanguage = 'en';
  assert.equal(label('ne::1159151131'), 'Huambo');
  assert.equal(label('ne::1159147227'), 'Lille');
  assert.equal(label('ne::1159149977'), 'Kananga');
  assert.equal(label('gn::2971041'), 'Valenciennes');
  state.currentLanguage = 'zh';
  assert.equal(label('gn::2803201'), '安德莱赫特');
  assert.equal(label('gn::2593460'), '马西纳');
});
