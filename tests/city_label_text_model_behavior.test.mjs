import assert from 'node:assert/strict';
import test from 'node:test';
import { createCityLabelTextModel } from '../js/core/renderer/city_label_text_model.js';

function setup() {
  const runtimeState = { currentLanguage: 'en' };
  let labels = {};
  const lookup = (keys, fallback) => (Array.isArray(keys) ? keys : [keys]).map(key => labels[key]).find(Boolean) || fallback;
  return { runtimeState, setLabels(next) { labels = next; }, model: createCityLabelTextModel(runtimeState, { getStrictGeoLabel: lookup, getPreferredGeoLabel: lookup }) };
}

test('city display labels follow live language, explicit overrides and replaced locale lookup', () => {
  const h = setup();
  const feature = { properties: { id: 'city', label_en: 'London', label_zh: '伦敦' } };
  assert.equal(h.model.getCityDisplayLabel(feature), 'London');
  h.runtimeState.currentLanguage = 'zh';
  assert.equal(h.model.getCityDisplayLabel(feature), '伦敦');
  feature.properties.__city_has_display_name_override = true;
  feature.properties.__city_display_name_override = { zh: '新伦敦' };
  assert.equal(h.model.getCityDisplayLabel(feature), '新伦敦');
  feature.properties.__city_display_name_override = {};
  h.setLabels({ city: '本地名称' });
  assert.equal(h.model.getCityDisplayLabel(feature), '本地名称');
});

test('host administrative labels are rejected while real host names take precedence', () => {
  const h = setup();
  const feature = { properties: { id: 'city', label_en: 'Raw', __city_host_feature_id: 'host' } };
  h.setLabels({ host: 'Example District' });
  assert.equal(h.model.getCityDisplayLabel(feature), 'Raw');
  h.setLabels({ host: 'Host City' });
  assert.equal(h.model.getCityDisplayLabel(feature), 'Host City');
});

test('aliases preserve ordered identity and deduplicate normalized extra aliases', () => {
  const { model } = setup();
  const feature = { id: 'fallback', properties: { __city_stable_key: 'stable', id: 'id', __city_aliases: ['id', ' extra ', ''] } };
  assert.equal(model.getCityFeatureKey(feature), 'stable');
  assert.deepEqual(model.getCityFeatureAliases(feature, 'stable'), ['stable', 'id', 'extra']);
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
  assert.equal(h.model.getCityDisplayLabel(feature), '河北');
});

test('raw-name and alias patches do not imply an explicit city identity', () => {
  const h = setup();
  h.setLabels({ Raw: 'Alias City', host: 'Host City' });
  h.runtimeState.scenarioGeoLocalePatchData = { geo: { Raw: { en: 'Alias City' } } };
  const feature = { properties: { id: 'city', name: 'Raw', __city_aliases: ['Raw'], __city_host_feature_id: 'host' } };
  assert.equal(h.model.getCityDisplayLabel(feature), 'Host City');
});

test('an explicit top-level city ID resolves without normalized properties', () => {
  const h = setup();
  h.setLabels({ city: 'Identity City', host: 'Host City' });
  h.runtimeState.scenarioGeoLocalePatchData = { geo: { city: { en: 'Identity City' } } };
  assert.equal(h.model.getCityDisplayLabel({ id: 'city', properties: { __city_host_feature_id: 'host' } }), 'Identity City');
});

test('map labels clean, abbreviate and measure CJK at the requested scale', () => {
  const { model } = setup();
  assert.equal(model.formatCityMapLabel(' Example County (Old) '), 'Example County (Old)');
  const context = { measureText: value => ({ width: Array.from(value).length * 10 }) };
  assert.equal(model.formatCityMapLabel('Example County (Old)', { context }), 'Example');
  const text = model.formatCityMapLabel('中华人民共和国特别行政区域城市名称', { context, scale: 2 });
  assert.ok(text.endsWith('…'));
  assert.ok(Array.from(text).length * 20 <= 134);
  assert.equal(model.formatCityMapLabel('Washington Metropolitan Center', { context }), 'Washington M…');
});
