import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createCityLabelTextModel } from '../js/core/renderer/city_label_text_model.js';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const base = { ...read('../data/locales.json').geo, ...read('../data/city_aliases.json').geo };
const scenario = read('../data/scenarios/tno_1962/geo_locale_patch.json').geo;
const cities = new Map(read('../data/world_cities.geojson').features.map(feature => [feature.properties.id, feature]));

function setup() {
  const state = { currentLanguage: 'zh', scenarioGeoLocalePatchData: { geo: scenario } };
  let geo = { ...base, ...scenario };
  const lookup = (keys, fallback) => {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      if (geo[key]?.[state.currentLanguage]) return geo[key][state.currentLanguage];
    }
    return fallback;
  };
  return {
    state,
    model: createCityLabelTextModel(state, { getStrictGeoLabel: lookup, getPreferredGeoLabel: lookup }),
    resetToBase() { geo = base; state.scenarioGeoLocalePatchData = null; },
  };
}

function city(id) {
  const feature = cities.get(`CITY::${id}`);
  assert.ok(feature, id);
  return { ...feature, properties: {
    ...feature.properties,
    __city_host_feature_id: feature.properties.host_feature_id,
  } };
}

test('German Russian city labels resolve coherent names in both languages', () => {
  const { state, model } = setup();
  for (const [id, en, zh] of [
    ['ne::1159146521', 'Goebbels', '戈培尔'],
    ['ne::1159149575', 'Platenfurt', '普拉滕富特'],
    ['ne::1159150697', 'Paulusburg', '保卢斯堡'],
    ['ne::1159149549', 'Jekaterinodar', '叶卡捷琳诺达尔'],
    ['ne::1159149557', 'Woronesch', '沃罗涅日'],
    ['ne::1159146503', 'Holmgard', '霍尔姆加德'],
    ['ne::1159149527', 'Königsberg', '柯尼斯堡'],
    ['ne::1159148119', 'Noworossijsk', '新罗西斯克'],
    ['ne::1159137187', 'Sharya', '沙里亚'],
    ['ne::1159137443', 'Kovrov', '科夫罗夫'],
    ['gn::559317', 'Goryachy Klyuch', '戈里亚奇克柳奇'],
    ['gn::550280', 'Neu-Kiel', '新基尔'],
    ['gn::548602', 'Jamburg', '扬堡'],
    ['ne::1159149533', 'Klugeburg', '克卢格堡'],
  ]) {
    const feature = city(id);
    assert.deepEqual(scenario[feature.properties.stable_key], { en, zh }, `${id}: explicit city locale`);
    state.currentLanguage = 'en';
    assert.equal(model.getCityDisplayLabel(feature), en, id);
    state.currentLanguage = 'zh';
    assert.equal(model.getCityDisplayLabel(feature), zh, id);
  }
});

test('Rostov am Don is not applied to Rostov Veliky, and leaving TNO restores city names', () => {
  const { state, model, resetToBase } = setup();
  state.currentLanguage = 'en';
  assert.equal(scenario[city('ne::1159149545').properties.stable_key].en, 'Rostow am Don');
  assert.equal(model.getCityDisplayLabel(city('ne::1159149545')), 'Rostow am Don');
  assert.notEqual(model.getCityDisplayLabel(city('ne::1159137245')), 'Rostow am Don');
  assert.equal(model.getCityDisplayLabel(city('ne::1159149575')), 'Platenfurt');
  resetToBase();
  assert.equal(model.getCityDisplayLabel(city('ne::1159149575')), 'Saratov');
  assert.equal(model.getCityDisplayLabel(city('gn::550280')), 'Khimki');
  state.currentLanguage = 'zh';
  assert.equal(model.getCityDisplayLabel(city('ne::1159149575')), '萨拉托夫');
  assert.equal(model.getCityDisplayLabel(city('gn::550280')), '希姆基');
});

test('new Chinese city names survive the base locale fallback without a scenario host', () => {
  const { state, model, resetToBase } = setup();
  resetToBase();
  state.currentLanguage = 'zh';
  for (const [id, zh] of [
    ['gn::559317', '戈里亚奇克柳奇'], ['gn::548602', '金吉谢普'],
    ['gn::557775', '古斯赫鲁斯特尔内'], ['gn::526480', '矿水市'],
    ['gn::466990', '叶森图基'], ['gn::555746', '伊斯特拉'],
  ]) {
    const feature = city(id);
    delete feature.properties.__city_host_feature_id;
    assert.equal(model.getCityDisplayLabel(feature), zh, id);
  }
});
