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
  assert.equal(model.formatCityMapLabel(' Example County (Old) '), 'Example (Old)');
  const context = { measureText: value => ({ width: Array.from(value).length * 10 }) };
  assert.equal(model.formatCityMapLabel('Example County (Old)', { context }), 'Example (Old)');
  const text = model.formatCityMapLabel('中华人民共和国特别行政区域城市名称', { context, scale: 2 });
  assert.ok(text.endsWith('…'));
  assert.ok(Array.from(text).length * 20 <= 134);
  assert.equal(model.formatCityMapLabel('Washington Metropolitan Center', { context }), 'Washington M…');
});

test('city names remove administrative descriptors from actual German locale entries', () => {
  const { model } = setup();
  const context = { measureText: value => ({ width: Array.from(value).length * 3 }) };
  const examples = [
    ['基尔，独立城市', '基尔'],
    ['哈姆，独立城市', '哈姆'],
    ['德尔门霍斯特（独立城市）', '德尔门霍斯特'],
    ['美因河畔法兰克福（独立城市）', '美因河畔法兰克福'],
    ['法兰克福（奥德）、克莱斯自由城', '法兰克福（奥德）'],
    ['哈勒（萨勒），独立城市', '哈勒（萨勒）'],
    ['海德堡城市区', '海德堡'],
    ['巴登-巴登, 城市区', '巴登-巴登'],
    ['基尔（非县辖城市）', '基尔'],
    ['Kiel, Kreisfreie Stadt', 'Kiel'],
    ['Frankfurt (Oder), Kreisfreie Stadt', 'Frankfurt (Oder)'],
    ['Kempten (Allgäu), Kreisfreie Stadt', 'Kempten (Allgäu)'],
    ['Baden-Baden, Stadtkreis', 'Baden-Baden'],
    ['Kreisfreie Stadt Coburg', 'Coburg'],
    ['Kiel, independent city', 'Kiel'],
    ['Independent City of Kiel', 'Kiel'],
    ['Kiel, Kreisfreie Stadt (DE)', 'Kiel (DE)'],
  ];
  for (const [label, expected] of examples) {
    assert.equal(model.getCityDisplayLabel({ properties: { label_en: label } }), expected, label);
    assert.equal(model.formatCityMapLabel(label, { context }), expected, label);
    assert.equal(model.formatCityMapLabel(expected, { context }), expected, `idempotent: ${label}`);
  }
});

test('cleanup preserves actual city names, punctuation and geographic disambiguation', () => {
  const { model } = setup();
  const context = { measureText: value => ({ width: Array.from(value).length * 3 }) };
  for (const label of [
    '盐湖城', '墨西哥城', '纽约市', '市川', 'City of London', 'Salt Lake City',
    'Mexico City', 'District of Columbia', 'Wilshire District', 'County Durham', 'Frankfurt (Oder)',
    'Frankfurt am Main', 'Halle (Saale)', '法兰克福（奥德）', '肯普滕（阿尔高）',
    'Portland, Maine', 'Oldenburg (Oldenburg)',
  ]) {
    assert.equal(model.getCityDisplayLabel({ properties: { label_en: label } }), label);
    assert.equal(model.formatCityMapLabel(label, { context }), label);
  }
});

test('all city label sources share cleanup without modifying locale data or identity', () => {
  const h = setup();
  h.runtimeState.currentLanguage = 'zh';
  const labels = { host: '基尔，独立城市', city: '哈姆，独立城市' };
  const feature = { properties: { id: 'city', __city_host_feature_id: 'host' } };
  h.setLabels(labels);
  assert.equal(h.model.getCityDisplayLabel(feature), '基尔');
  h.runtimeState.scenarioGeoLocalePatchData = { geo: { city: { zh: labels.city } } };
  assert.equal(h.model.getCityDisplayLabel(feature), '哈姆');
  feature.properties.__city_has_display_name_override = true;
  feature.properties.__city_display_name_override = { zh: '德尔门霍斯特（独立城市）' };
  assert.equal(h.model.getCityDisplayLabel(feature), '德尔门霍斯特');
  assert.deepEqual(labels, { host: '基尔，独立城市', city: '哈姆，独立城市' });
  assert.equal(feature.properties.__city_display_name_override.zh, '德尔门霍斯特（独立城市）');
  assert.equal(h.model.getCityFeatureKey(feature), 'city');
});

test('German city districts lose the Chinese suffix only with explicit country context', () => {
  const { model } = setup();
  const context = { measureText: value => ({ width: Array.from(value).length * 3 }) };
  for (const countryProperty of ['country_code', '__city_country_code']) {
    for (const [label, expected] of [
      ['斯图加特市区', '斯图加特'],
      ['海尔布隆市区', '海尔布隆'],
      ['卡尔斯鲁厄市区', '卡尔斯鲁厄'],
      ['乌尔姆市区', '乌尔姆'],
      ['奥斯纳布吕克，无区城市', '奥斯纳布吕克'],
      ['卡塞尔，无区市', '卡塞尔'],
      ['杜塞尔多夫，自由城', '杜塞尔多夫'],
      ['达姆施塔特，自由城', '达姆施塔特'],
      ['亚琛城市地区', '亚琛'],
    ]) {
      const feature = { properties: { label_en: label, [countryProperty]: ' de ' } };
      assert.equal(model.getCityDisplayLabel(feature), expected);
      assert.equal(model.formatCityMapLabel(label, { entry: { feature }, context }), expected);
      assert.equal(feature.properties.label_en, label);
    }
  }
  for (const countryCode of ['CN', 'TW', '']) {
    const feature = { properties: { label_en: '新市区', country_code: countryCode } };
    assert.equal(model.getCityDisplayLabel(feature), '新市区');
    assert.equal(model.formatCityMapLabel('新市区', { entry: { feature }, context }), '新市区');
  }
  assert.equal(model.formatCityMapLabel('斯图加特市区', { context }), '斯图加特市区');
  for (const [countryCode, label] of [
    ['SL', '自由城'], ['SL', '弗里敦，自由城'],
    ['DE', '自由城'], ['DE', '自由堡'], ['DE', '法兰克福（奥德）'],
  ]) {
    const feature = { properties: { label_en: label, country_code: countryCode } };
    assert.equal(model.getCityDisplayLabel(feature), label);
    assert.equal(model.formatCityMapLabel(label, { entry: { feature }, context }), label);
  }
});
