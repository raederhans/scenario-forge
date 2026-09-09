import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createCityLabelTextModel } from '../js/core/renderer/city_label_text_model.js';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const world = read('../data/world_cities.geojson');
const base = { ...read('../data/locales.json').geo, ...read('../data/city_aliases.json').geo };
const scenario = read('../data/scenarios/tno_1962/geo_locale_patch.json').geo;
const cities = new Map(world.features.map(feature => [feature.properties.id, feature]));
const names = [
  ['1159151393', 'Hsinking', '新京'],
  ['1159151377', 'Mukden', '奉天'],
  ['1159149913', 'Dairen', '大連'],
  ['1159147067', 'Antung', '安東'],
  ['1159141171', 'Zhuhe', '珠河'],
  ['1159147115', "Xi'an", '西安'],
  ['1159149955', 'Sartu', '薩爾圖'],
  ['1159149941', 'Houhehot', '厚和浩特'],
  ['1159149945', 'Wangyehmiao', '王爺廟'],
  ['1159140859', 'Xinhai', '新海'],
];

function setup() {
  const state = { currentLanguage: 'zh' };
  let geo = { ...base, ...scenario };
  const lookup = (keys, fallback) => {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      const value = geo[key]?.[state.currentLanguage];
      if (value) return value;
    }
    return fallback;
  };
  return {
    state,
    model: createCityLabelTextModel(state, { getStrictGeoLabel: lookup, getPreferredGeoLabel: lookup }),
    resetToBase() { geo = base; },
  };
}

function cityFeature(suffix) {
  const feature = cities.get(`CITY::ne::${suffix}`);
  assert.ok(feature, suffix);
  return { ...feature, properties: {
    ...feature.properties,
    __city_host_feature_id: feature.properties.host_feature_id,
  } };
}

test('TNO Chinese and Manchurian city labels use matching historical names in both languages', () => {
  const { state, model } = setup();
  for (const [suffix, en, zh] of names) {
    const feature = cityFeature(suffix);
    state.currentLanguage = 'zh';
    assert.equal(model.getCityDisplayLabel(feature), zh, suffix);
    state.currentLanguage = 'en';
    assert.equal(model.getCityDisplayLabel(feature), en, suffix);
  }
});

test('leaving TNO restores base city names without contaminating Shaanxi Xi’an', () => {
  const { state, model, resetToBase } = setup();
  const changchun = cityFeature('1159151393');
  assert.equal(model.getCityDisplayLabel(changchun), '新京');
  const shaanxi = cityFeature('1159151363');
  assert.equal(model.getCityDisplayLabel(shaanxi), '西安');
  resetToBase();
  assert.equal(model.getCityDisplayLabel(changchun), '长春');
  assert.equal(model.getCityDisplayLabel(cityFeature('1159151377')), '沈阳');
  state.currentLanguage = 'en';
  assert.equal(model.getCityDisplayLabel(changchun), 'Changchun');
});
