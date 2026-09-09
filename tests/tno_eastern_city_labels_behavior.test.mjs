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
  };
  const key = f => f.properties.id;
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
  return { state, owner, label(id) {
    const feature = owner.getEffectiveCityCollection().features.find(f => key(f) === `CITY::${id}`);
    assert.ok(feature, id);
    return model.getCityDisplayLabel(feature);
  } };
}

test('eastern TNO city overrides reach the label model in both languages', () => {
  const { state, label } = setup();
  for (const [id, en, zh] of [
    ['ne::1159151299', 'Warschau', '华沙'],
    ['ne::1159149707', 'Danzig', '但泽'],
    ['ne::1159150877', 'Reval', '雷瓦尔'],
    ['ne::1159148453', 'Dorpat', '多尔帕特'],
    ['ne::1159150809', 'Wilna', '维尔纳'],
    ['ne::1159149329', 'Reichenaustadt', '赖歇瑙施塔特'],
    ['ne::1159149331', 'Hughesdorf', '休斯多夫'],
    ['ne::1159150961', 'Tiflis', '第比利斯'],
    ['ne::1159147265', 'Batum', '巴统'],
    ['ne::1159150561', 'Theoderichshafen', '狄奥多里希港'],
    ['gn::694423', 'Theoderichshafen', '狄奥多里希港'],
  ]) {
    state.currentLanguage = 'en'; assert.equal(label(id), en, id);
    state.currentLanguage = 'zh'; assert.equal(label(id), zh, id);
  }
});

test('shared regions keep distinct cities, and leaving TNO removes the overrides', () => {
  const { state, label } = setup();
  state.currentLanguage = 'en';
  assert.equal(label('ne::1159146449'), 'Libau');
  assert.equal(label('ne::1159136347'), 'Windau');
  assert.equal(label('ne::1159136375'), 'Kauen');
  assert.equal(label('gn::598818'), 'Jonava');
  assert.notEqual(label('ne::1159126859'), 'Hughesdorf');
  state.activeScenarioId = '';
  state.scenarioCityOverridesData = null;
  state.cityLayerRevision++;
  assert.equal(label('ne::1159150877'), 'Tallinn');
  assert.equal(label('ne::1159149329'), 'Dnipro');
  state.currentLanguage = 'zh';
  assert.equal(label('ne::1159150877'), '塔林');
});
