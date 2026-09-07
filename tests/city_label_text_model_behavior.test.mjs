import assert from 'node:assert/strict';
import test from 'node:test';
import { createCityLabelTextModel } from '../js/core/renderer/city_label_text_model.js';

function setup() {
  const runtimeState = { currentLanguage: 'en' };
  let labels = {};
  const lookup = (keys, fallback) => (Array.isArray(keys) ? keys : [keys]).map(key => labels[key]).find(Boolean) || fallback;
  return { runtimeState, setLabels(next) { labels = next; }, model: createCityLabelTextModel({ runtimeState, getStrictGeoLabel: lookup, getPreferredGeoLabel: lookup }) };
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
