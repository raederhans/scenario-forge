import assert from 'node:assert/strict';
import test from 'node:test';
import { createCityLabelTextModel } from '../js/core/renderer/city_label_text_model.js';

function setup() {
  const runtimeState = { currentLanguage: 'en' };
  let labels = {};
  const lookup = (keys, fallback) => (Array.isArray(keys) ? keys : [keys]).map(key => labels[key]).find(Boolean) || fallback;
  return { runtimeState, setLabels(next) { labels = next; }, model: createCityLabelTextModel(runtimeState, { getStrictGeoLabel: lookup, getPreferredGeoLabel: lookup }) };
}

test('city host locale does not rename a distinct settlement inside its polygon', () => {
  const h = setup();
  h.runtimeState.currentLanguage = 'zh';
  h.setLabels({ host: '科兹巴' });
  h.runtimeState.scenarioGeoLocalePatchData = { geo: { 'id::LKA-2470': { zh: '科兹巴' } } };
  const kotte = { properties: {
    id: 'CITY::ne::1159149593',
    label_en: 'Sri Jayawardenepura Kotte',
    political_feature_name: 'Kŏḷamba',
    country_code: 'LK',
    __city_host_feature_id: 'LKA-2470',
  } };
  assert.equal(h.model.getCityDisplayLabel(kotte), 'Sri Jayawardenepura Kotte');
});

test('explicit scenario city identity wins over unrelated host translations and stays live', () => {
  const h = setup();
  h.runtimeState.currentLanguage = 'zh';
  const feature = { properties: {
    __city_stable_key: 'stable-city', id: 'city', name_zh: '石家庄',
    __city_host_feature_id: 'host', __city_aliases: ['alias'],
  } };
  h.setLabels({ 'stable-city': '石家庄', alias: '别名译名', host: '河北' });
  h.runtimeState.scenarioGeoLocalePatchData = { geo: { 'stable-city': { zh: '石家庄' } } };
  assert.equal(h.model.getCityDisplayLabel(feature), '石家庄');
  feature.properties.__city_has_display_name_override = true;
  feature.properties.__city_display_name_override = { zh: '显式剧本名' };
  assert.equal(h.model.getCityDisplayLabel(feature), '显式剧本名');
  delete feature.properties.__city_display_name_override;
  h.runtimeState.scenarioGeoLocalePatchData = null;
  assert.equal(h.model.getCityDisplayLabel(feature), '石家庄');
});
