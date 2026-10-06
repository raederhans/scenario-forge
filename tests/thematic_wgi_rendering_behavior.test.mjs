import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { loadThematicWgiData, THEMATIC_WGI_METRIC_ID, THEMATIC_WGI_METRICS } from "../js/core/thematic_wgi_data.js";
import { resolveFeatureColor } from "../js/core/color_resolver.js";
import {
  normalizeThematicWgiStyle, getThematicWgiLegend, getThematicWgiViewModel,
  getThematicWgiFeatureInspection, getThematicWgiSignature,
  getThematicWgiColor, THEMATIC_WGI_COLORS,
} from "../js/core/thematic_wgi_view_model.js";
import { drawThematicWgiExportLegend } from "../js/core/renderer/thematic_wgi_export_legend.js";
import { createTooltipFixture } from "./helpers/isolated_tooltip_fixture.mjs";

const ruleOfLawId = "wgi_rule_of_law_score_0_100";
const fetchJson = async (path) => {
  const bytes = await readFile(new URL(`../${path}`, import.meta.url));
  return JSON.parse((path.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString("utf8"));
};
const data = await loadThematicWgiData({ fetchJson });
const ruleOfLawData = await loadThematicWgiData({ fetchJson, metricId: ruleOfLawId });
function fixture() {
  return { activeScenarioId: "modern_world", currentLanguage: "en", width: 1000,
    styleConfig: { thematic: normalizeThematicWgiStyle({ enabled: true }) },
    thematicWgiRuntime: { status: "ready", data, revision: 1 },
    visualOverrides: { sample: "#123456" }, sovereignBaseColors: { US: "#abcdef" } };
}
const feature = (code, id = "sample") => ({ id, properties: { ISO_A2: code } });

function historicalFixture(scenarioId = "hoi4_1939") {
  return { ...fixture(), activeScenarioId: scenarioId,
    scenarioBaselineOwnersByFeatureId: Object.freeze({ sample: "GER" }),
    scenarioCountriesByTag: { GER: { base_iso2: "DE" } } };
}

const scenarioFixtures = new Map();
async function loadScenarioFixture(scenarioId) {
  if (!scenarioFixtures.has(scenarioId)) {
    scenarioFixtures.set(scenarioId, (async () => {
      const manifest = await fetchJson(`data/scenarios/${scenarioId}/manifest.json`);
      const [topology, { owners }, { countries }] = await Promise.all([
        fetchJson(manifest.runtime_topology_url),
        fetchJson(manifest.owners_url),
        fetchJson(manifest.countries_url),
      ]);
      // Mapping uses feature metadata only; decoding polygon coordinates adds no evidence.
      const wrapGeometry = (geometry) => ({ type: "Feature",
        id: geometry.properties?.id ?? geometry.id, properties: geometry.properties });
      const features = topology.objects.political.geometries.map(wrapGeometry);
      return { state: { ...historicalFixture(scenarioId),
        scenarioBaselineOwnersByFeatureId: owners, scenarioCountriesByTag: countries,
        landData: { features } },
        excludedFeatures: Object.values(topology.objects).flatMap((object) => object.geometries || [])
          .filter((geometry) => geometry.properties?.water_type || geometry.properties?.special_type
            || geometry.properties?.atl_color_rule).map(wrapGeometry) };
    })());
  }
  return scenarioFixtures.get(scenarioId);
}

test("thematic display resolves source geography, leaves paint intact, and disabling restores edits", () => {
  const state = fixture();
  state.scenarioBaselineOwnersByFeatureId = { sample: "DE" };
  const original = structuredClone(state.visualOverrides);
  const result = resolveFeatureColor("sample", { state, feature: feature("US") });
  assert.equal(result.source, "thematic:wgi");
  assert.equal(getThematicWgiFeatureInspection(state, feature("US")).joinKey, "USA");
  assert.deepEqual(state.visualOverrides, original);
  state.styleConfig.thematic.enabled = false;
  assert.equal(resolveFeatureColor("sample", { state, feature: feature("US") }).color, "#123456");
  assert.equal(getThematicWgiLegend(state), null);
});

test("missing, unmatched and valid zero keep different colors and inspector states", () => {
  const state = fixture();
  const missing = feature("NC"), unmatched = feature("AQ");
  assert.equal(getThematicWgiFeatureInspection(state, missing).status, "missing");
  assert.equal(getThematicWgiFeatureInspection(state, unmatched).status, "unmatched");
  const zero = getThematicWgiFeatureInspection(state, feature("SO"));
  assert.equal(zero.status, "value");
  assert.equal(getThematicWgiColor({ status: "value", value: 0 }), THEMATIC_WGI_COLORS[0]);
  assert.equal(getThematicWgiColor({ status: "value", value: 100 }), THEMATIC_WGI_COLORS[4]);
  const colors = [missing, unmatched, feature("SO")].map((f) => resolveFeatureColor("sample", { state, feature: f }).color);
  assert.equal(new Set(colors).size, 3);
});

test("unsupported scene/version and water retain ordinary rendering", () => {
  const state = fixture();
  state.activeScenarioId = "blank_base";
  assert.equal(getThematicWgiViewModel(state).status, "unsupported");
  assert.equal(resolveFeatureColor("sample", { state, feature: feature("US") }).color, "#123456");
  state.activeScenarioId = "modern_world";
  state.styleConfig.thematic.dataVersion = "future-data";
  assert.equal(getThematicWgiViewModel(state).status, "version-unavailable");
  assert.equal(getThematicWgiLegend(state), null);
  state.styleConfig.thematic = normalizeThematicWgiStyle({ enabled: true });
  assert.equal(resolveFeatureColor("sample", { state, feature: feature("US"), isOceanFeature: () => true,
    getOceanBaseFillColor: () => "#112233" }).color, "#112233");
});

test("coverage counts geographies once and cache identity changes with loaded payload", () => {
  const state = fixture();
  state.landData = { features: [feature("US", "a"), feature("US", "b"), feature("NC"), feature("AQ")] };
  assert.deepEqual(getThematicWgiViewModel(state).coverage, { matched: 1, missing: 1, unmatched: 1 });
  const before = getThematicWgiSignature(state);
  state.thematicWgiRuntime = { ...state.thematicWgiRuntime, status: "loading", revision: 2 };
  assert.notEqual(getThematicWgiSignature(state), before);
  assert.equal(getThematicWgiLegend(state), null);
});

test("Rule of Law follows selected official values, legend labels and per-payload coverage", () => {
  const state = fixture();
  state.landData = { features: [feature("US", "a"), feature("US", "b"), feature("NC"), feature("AQ")] };
  getThematicWgiViewModel(state);
  state.styleConfig.thematic.metricId = ruleOfLawId;
  state.thematicWgiRuntime = { status: "ready", data: ruleOfLawData, revision: 2 };
  const observation = getThematicWgiFeatureInspection(state, feature("US"));
  assert.equal(observation.value, ruleOfLawData.byIsoA3.USA.value);
  assert.notEqual(observation.value, data.byIsoA3.USA.value);
  assert.equal(resolveFeatureColor("sample", { state, feature: feature("US") }).color, getThematicWgiColor(observation));
  assert.equal(getThematicWgiLegend(state).title, "Rule of law · 2024");
  state.currentLanguage = "zh";
  assert.equal(getThematicWgiLegend(state).title, "法治 · 2024");
  const ncStatus = ruleOfLawData.byIsoA3.NCL.status;
  assert.deepEqual(getThematicWgiViewModel(state).coverage, {
    matched: ncStatus === "value" ? 2 : 1, missing: ncStatus === "missing" ? 1 : 0, unmatched: 1,
  });
  state.styleConfig.thematic.metricId = THEMATIC_WGI_METRIC_ID;
  state.thematicWgiRuntime = { status: "ready", data, revision: 3 };
  assert.equal(getThematicWgiLegend(state).title, "政府效能 · 2024");
  assert.deepEqual(getThematicWgiViewModel(state).coverage, { matched: 1, missing: 1, unmatched: 1 });
});

test("a ready payload must match selected layer, metric and version before rendering or coverage", () => {
  const state = fixture();
  state.landData = { features: [feature("US")] };
  for (const patch of [
    { metricId: ruleOfLawId }, { layerId: "wrong-layer" }, { dataVersion: "future" },
  ]) {
    state.thematicWgiRuntime = { status: "ready", data: { ...data, ...patch }, revision: 2 };
    assert.equal(getThematicWgiFeatureInspection(state, feature("US")), null);
    assert.equal(getThematicWgiLegend(state), null);
    assert.equal(resolveFeatureColor("sample", { state, feature: feature("US") }).color, "#123456");
    const model = getThematicWgiViewModel(state);
    assert.equal(model.status, "idle");
    assert.deepEqual(model.coverage, { matched: 0, missing: 0, unmatched: 0 });
  }
  for (const metricId of ["unknown", "wgi_state_capacity_composite_0_100"]) {
    state.styleConfig.thematic = normalizeThematicWgiStyle({ enabled: true, metricId });
    assert.equal(state.styleConfig.thematic.metricId, metricId);
    assert.equal(getThematicWgiViewModel(state).status, "version-unavailable");
    assert.equal(getThematicWgiLegend(state), null);
  }
});

test("export key includes same bins, year, interpretation and attribution as map legend", () => {
  const state = fixture();
  const texts = [];
  const context = { save() {}, restore() {}, setTransform() {}, fillRect() {}, strokeRect() {},
    measureText: (text) => ({ width: text.length * 6 }),
    fillText: (text) => texts.push(text) };
  const canvas = { width: 2000, height: 1200, getContext: () => context };
  assert.equal(drawThematicWgiExportLegend(canvas, state), true);
  const legend = getThematicWgiLegend(state);
  for (const text of [legend.title, legend.note, legend.source, ...legend.entries.map((e) => e.label)]) assert.ok(texts.includes(text));
  state.styleConfig.thematic.enabled = false;
  texts.length = 0;
  assert.equal(drawThematicWgiExportLegend(canvas, state), false);
  assert.deepEqual(texts, []);
});

test("hover exposes country score uncertainty and distinguishes missing data in both languages", () => {
  const values = fixture();
  const { getTooltipText } = createTooltipFixture(values);
  const english = getTooltipText(feature("US"));
  assert.match(english, /Government effectiveness · 2024:/);
  assert.match(english, /90% confidence interval: [\d.]+–[\d.]+/);
  assert.match(english, /Country\/economy score · World Bank WGI/);
  values.currentLanguage = "zh";
  assert.match(getTooltipText(feature("US")), /90% 置信区间:/);
  assert.match(getTooltipText(feature("NC")), /来源缺失/);
  assert.doesNotMatch(getTooltipText(feature("NC")), /置信区间/);
  values.styleConfig.thematic.enabled = false;
  assert.doesNotMatch(getTooltipText(feature("US")), /World Bank WGI/);

});

test("Rule of Law hover uses selected score, uncertainty and English/Chinese labels", () => {
  const values = fixture();
  values.styleConfig.thematic.metricId = ruleOfLawId;
  values.thematicWgiRuntime.data = ruleOfLawData;
  const { getTooltipText } = createTooltipFixture(values);
  const usa = ruleOfLawData.byIsoA3.USA;
  const interval = usa.uncertainty.score_confidence_interval_90;
  assert.notDeepEqual(interval, data.byIsoA3.USA.uncertainty.score_confidence_interval_90);
  const english = getTooltipText(feature("US"));
  assert.ok(english.includes(`Rule of law · 2024: ${usa.value.toFixed(1)} / 100`));
  assert.ok(english.includes(`90% confidence interval: ${interval.lower.toFixed(1)}–${interval.upper.toFixed(1)}`));
  assert.doesNotMatch(english, /Government effectiveness/);
  values.currentLanguage = "zh";
  const chinese = getTooltipText(feature("US"));
  assert.ok(chinese.includes(`法治 · 2024: ${usa.value.toFixed(1)} / 100`));
  assert.ok(chinese.includes(`90% 置信区间: ${interval.lower.toFixed(1)}–${interval.upper.toFixed(1)}`));
  assert.doesNotMatch(chinese, /政府效能/);

});

test("historical mapping follows immutable baseline owners and explicit ISO2 references only", () => {
  const state = historicalFixture();
  state.sovereigntyByFeatureId = { sample: "USA" };
  state.runtimeCanonicalCountryByFeatureId = { sample: "US" };
  const observation = getThematicWgiFeatureInspection(state, feature("PL"));
  assert.equal(observation.joinKey, "DEU");
  assert.equal(observation.value, data.byIsoA3.DEU.value);
  assert.equal(observation.referenceMapping, true);
  assert.equal(observation.scenarioTag, "GER");
  assert.equal(observation.referenceCountryCode, "DEU");
  assert.equal(resolveFeatureColor("sample", { state, feature: feature("PL") }).color,
    getThematicWgiColor(data.byIsoA3.DEU));
  assert.deepEqual(state.visualOverrides, { sample: "#123456" });
  state.styleConfig.thematic.metricId = ruleOfLawId;
  state.thematicWgiRuntime = { status: "ready", data: ruleOfLawData, revision: 2 };
  assert.equal(getThematicWgiFeatureInspection(state, feature("PL")).value, ruleOfLawData.byIsoA3.DEU.value);
  state.styleConfig.thematic.metricId = THEMATIC_WGI_METRIC_ID;
  state.thematicWgiRuntime = { status: "ready", data: { ...data, supportedScenarios: ["modern_world"] }, revision: 3 };
  assert.equal(getThematicWgiFeatureInspection(state, feature("PL")), null);
  assert.equal(getThematicWgiLegend(state), null);
  state.thematicWgiRuntime = { status: "ready", data, revision: 4 };
  for (const country of [undefined, {}, { base_iso2: "DEU" }, { base_iso2: "ZZ" },
    { base_iso2: "de" }, { parent: "GER" }, { parent: "GER", base_iso2: "USA" }]) {
    state.scenarioBaselineOwnersByFeatureId = { sample: "US" };
    state.scenarioCountriesByTag = { GER: { base_iso2: "DE" }, US: country };
    const unmatched = getThematicWgiFeatureInspection(state, feature("US"));
    assert.equal(unmatched.status, "unmatched");
    assert.equal(unmatched.joinKey, "");
    assert.equal(unmatched.referenceCountryCode, "");
  }
  state.scenarioBaselineOwnersByFeatureId = {};
  assert.equal(getThematicWgiFeatureInspection(state, feature("US")).status, "unmatched");
  state.scenarioCountriesByTag = { GER: { base_iso2: "NC" } };
  state.scenarioBaselineOwnersByFeatureId = { sample: "GER" };
  assert.equal(getThematicWgiFeatureInspection(state, feature("US")).status, "missing");
});

test("historical coverage counts tags, invalidates replaced references and waits for scenario apply", () => {
  const state = historicalFixture("tno_1962");
  state.landData = { features: [feature("US", "a"), feature("DE", "b"), feature("PL", "c"),
    feature("US", "missing"), feature("US", "unknown")] };
  state.scenarioBaselineOwnersByFeatureId = { a: "WRS", b: "WRS", c: "SAM", missing: "GAP", unknown: "UNKNOWN" };
  state.scenarioCountriesByTag = { WRS: { base_iso2: "RU" }, SAM: { base_iso2: "RU" }, GAP: { base_iso2: "NC" } };
  assert.deepEqual(getThematicWgiViewModel(state).coverage, { matched: 2, missing: 1, unmatched: 1 });
  let signature = getThematicWgiSignature(state);
  state.scenarioBaselineOwnersByFeatureId = { ...state.scenarioBaselineOwnersByFeatureId, c: "WRS" };
  assert.notEqual(getThematicWgiSignature(state), signature);
  assert.deepEqual(getThematicWgiViewModel(state).coverage, { matched: 1, missing: 1, unmatched: 1 });
  signature = getThematicWgiSignature(state);
  state.scenarioCountriesByTag = { ...state.scenarioCountriesByTag, WRS: { base_iso2: "NC" } };
  assert.notEqual(getThematicWgiSignature(state), signature);
  assert.deepEqual(getThematicWgiViewModel(state).coverage, { matched: 0, missing: 2, unmatched: 1 });
  signature = getThematicWgiSignature(state);
  state.activeScenarioId = "modern_world";
  assert.notEqual(getThematicWgiSignature(state), signature);
  assert.deepEqual(getThematicWgiViewModel(state).coverage, { matched: 3, missing: 0, unmatched: 0 });
  assert.equal(getThematicWgiFeatureInspection(state, feature("US", "a")).joinKey, "USA");
  state.activeScenarioId = "tno_1962";
  signature = getThematicWgiSignature(state);
  state.scenarioApplyInFlight = true;
  assert.notEqual(getThematicWgiSignature(state), signature);
  assert.equal(getThematicWgiFeatureInspection(state, feature("US", "a")), null);
  assert.equal(getThematicWgiLegend(state), null);
  assert.deepEqual(getThematicWgiViewModel(state).coverage, { matched: 0, missing: 0, unmatched: 0 });
  state.scenarioApplyInFlight = false;
  assert.deepEqual(getThematicWgiViewModel(state).coverage, { matched: 0, missing: 2, unmatched: 1 });
});

for (const scenarioId of ["hoi4_1936", "hoi4_1939", "tno_1962"]) {
  for (const { id: metricId } of THEMATIC_WGI_METRICS) {
    test(`${scenarioId} ${metricId} gives every baseline owner one reference across geographic borders`, async (t) => {
      const { state: scenarioState } = await loadScenarioFixture(scenarioId);
      const data = await loadThematicWgiData({ fetchJson, metricId, scenarioId });
      const state = { ...scenarioState,
        styleConfig: { thematic: normalizeThematicWgiStyle({ enabled: true, metricId }) },
        thematicWgiRuntime: { status: "ready", data, revision: 1 } };
      assert.equal(getThematicWgiViewModel(state).status, "ready");
      const groups = new Map();
      for (const f of state.landData.features) {
        const tag = state.scenarioBaselineOwnersByFeatureId[f.id] || "";
        if (!groups.has(tag)) groups.set(tag, { keys: new Set(), geography: new Set(), features: [] });
        const group = groups.get(tag);
        const observation = getThematicWgiFeatureInspection(state, f);
        assert.ok(observation, `${scenarioId}: ${f.id} is inspectable`);
        group.keys.add(observation.joinKey);
        group.geography.add(f.properties.cntr_code);
        group.features.push(f);
      }
      assert.ok(groups.size > 0);
      for (const [tag, group] of groups) {
        assert.equal(group.keys.size, 1, `${scenarioId}: ${tag} must not split by modern geography`);
      }
      const assertReference = (tag, expectedKey, requiredGeographies = []) => {
        const group = groups.get(tag);
        assert.ok(group?.features.length, `${scenarioId} contains ${tag}`);
        assert.deepEqual([...group.keys], [expectedKey]);
        for (const geography of requiredGeographies) assert.ok(group.geography.has(geography), `${tag} includes ${geography}`);
        for (const f of group.features) {
          const observation = getThematicWgiFeatureInspection(state, f);
          assert.equal(observation.referenceCountryCode, expectedKey);
          assert.equal(observation.value, data.byIsoA3[expectedKey].value);
        }
      };
      if (scenarioId === "hoi4_1936") assertReference("CZE", "CZE", ["CZ", "SK", "UA"]);
      if (scenarioId === "hoi4_1939") assertReference("GER", "DEU", ["DE", "CZ", "PL", "AT", "RU", "LT"]);
      if (scenarioId === "tno_1962") {
        assertReference("GER", "DEU", ["DE", "CZ", "PL", "AT", "RU"]);
        for (const tag of ["WRS", "SAM", "OMS"]) assertReference(tag, "RUS");
        const unreferenced = [...groups.keys()].filter((tag) => !/^[A-Z]{2}$/.test(state.scenarioCountriesByTag[tag]?.base_iso2));
        assert.ok(unreferenced.length > 0, "real TNO countries include non-ISO2 base codes");
        for (const tag of unreferenced) {
          for (const f of groups.get(tag).features) {
            assert.equal(getThematicWgiFeatureInspection(state, f).status, "unmatched", `${tag} has no geographic fallback`);
          }
        }
      }
      const expected = { matched: 0, missing: 0, unmatched: 0 };
      for (const group of groups.values()) {
        const status = getThematicWgiFeatureInspection(state, group.features[0]).status;
        expected[status === "value" ? "matched" : status] += 1;
      }
      assert.deepEqual(getThematicWgiViewModel(state).coverage, expected);
      t.diagnostic(`${scenarioId}: ${groups.size} owner groups (including unassigned); coverage ${JSON.stringify(expected)}`);
    });
  }
}

test("new official dimensions expose their own score and uncertainty in bilingual historical hover", async () => {
  const values = historicalFixture();
  const { getTooltipText } = createTooltipFixture(values);
  for (const metric of THEMATIC_WGI_METRICS.slice(2)) {
    const payload = await loadThematicWgiData({ fetchJson, metricId: metric.id, scenarioId: values.activeScenarioId });
    values.styleConfig = { thematic: normalizeThematicWgiStyle({ enabled: true, metricId: metric.id }) };
    values.thematicWgiRuntime = { status: "ready", data: payload, revision: 1 };
    const observation = payload.byIsoA3.DEU;
    const interval = observation.uncertainty.score_confidence_interval_90;
    for (const language of ["en", "zh"]) {
      values.currentLanguage = language;
      const tooltip = getTooltipText(feature("PL"));
      const label = language === "zh" ? metric.labelZh : metric.labelEn;
      assert.ok(tooltip.includes(`${label} · 2024: ${observation.value.toFixed(1)} / 100`));
      assert.ok(tooltip.includes(`${interval.lower.toFixed(1)}–${interval.upper.toFixed(1)}`));
      assert.ok(tooltip.includes(`${observation.name} (DEU)`));
      assert.ok(tooltip.includes(getThematicWgiLegend(values).referenceNote));
    }
  }

});

test("long official export titles wrap without squeezing or overlapping reference notes and bins", async () => {
  const metricId = "wgi_political_stability_score_0_100";
  const state = historicalFixture();
  state.styleConfig = { thematic: normalizeThematicWgiStyle({ enabled: true, metricId }) };
  state.thematicWgiRuntime.data = await loadThematicWgiData({ fetchJson, metricId });
  const texts = [], rectangles = [];
  const context = { save() {}, restore() {}, setTransform() {}, strokeRect() {},
    measureText(text) { return { width: text.length * (this.font.startsWith("bold") ? 8 : 6) }; },
    fillRect: (x, y, width, height) => rectangles.push({ x, y, width, height }),
    fillText(text, x, y, maxWidth) { texts.push({ text, x, y, maxWidth, font: this.font }); },
  };
  assert.equal(drawThematicWgiExportLegend({ width: 1000, height: 600, getContext: () => context }, state), true);
  const title = texts.filter(({ font }) => font.startsWith("bold"));
  assert.ok(title.length > 1);
  assert.equal(title.map(({ text }) => text).join(" "), getThematicWgiLegend(state).title);
  assert.ok(title.every(({ maxWidth, text }) => maxWidth === undefined && text.length * 8 <= 292));
  assert.ok(texts[title.length].y >= title.at(-1).y + 18, "interpretation starts after the title");
  const panel = rectangles[0];
  const firstBin = rectangles[1];
  const referenceTexts = texts.slice(title.length + 1, -8);
  assert.equal(referenceTexts.map(({ text }) => text).join(" "), getThematicWgiLegend(state).referenceNote);
  assert.ok(referenceTexts.at(-1).y + 14 < firstBin.y);
  assert.ok(texts.every(({ y }) => y >= panel.y && y + 14 <= panel.y + panel.height));
});

test("TNO water, special land and real Atlantropa features do not receive WGI or coverage", async () => {
  const { state: realState, excludedFeatures } = await loadScenarioFixture("tno_1962");
  assert.ok(excludedFeatures.some((f) => f.properties.water_type));
  assert.ok(excludedFeatures.some((f) => f.properties.atl_color_rule));
  const state = { ...realState, landData: { features: [
    ...excludedFeatures,
    ...["water_type", "special_type", "atl_color_rule"].map((property) => ({
      ...feature("US"), properties: { ISO_A2: "US", [property]: "marked" },
    })),
  ] } };
  state.scenarioBaselineOwnersByFeatureId = Object.fromEntries(state.landData.features.map((f) => [f.id, "GER"]));
  for (const f of state.landData.features) assert.equal(getThematicWgiFeatureInspection(state, f), null);
  assert.deepEqual(getThematicWgiViewModel(state).coverage, { matched: 0, missing: 0, unmatched: 0 });
});

test("historical legend, hover and wrapped export explain the 2024 reference in both languages", () => {
  const values = historicalFixture();
  const { getTooltipText } = createTooltipFixture(values);
  for (const language of ["en", "zh"]) {
    values.currentLanguage = language;
    const legend = getThematicWgiLegend(values);
    const view = getThematicWgiViewModel(values);
    const note = language === "zh" ? "2024 参考映射，非剧本年代测量值。"
      : "2024 reference mapping, not a measurement for the scenario year.";
    assert.equal(view.historicalReference, true);
    assert.equal(view.referenceNote, note);
    assert.equal(legend.referenceNote, note);
    const tooltip = getTooltipText(feature("PL"));
    assert.ok(tooltip.includes(note));
    assert.ok(tooltip.includes(`${data.byIsoA3.DEU.name} (DEU)`));
    assert.ok(tooltip.includes(`${data.byIsoA3.DEU.value.toFixed(1)} / 100`));
    const texts = [];
    const context = { save() {}, restore() {}, setTransform() {}, fillRect() {}, strokeRect() {},
      measureText: (text) => ({ width: text.length * 11 }),
      fillText: (text) => texts.push(text) };
    assert.equal(drawThematicWgiExportLegend({ width: 2000, height: 1200, getContext: () => context }, values), true);
    const noteIndex = texts.indexOf(legend.note);
    assert.equal(texts.slice(0, noteIndex).join(language === "zh" ? "" : " "), legend.title);
    assert.equal(texts.slice(noteIndex + 1, -8).join(language === "zh" ? "" : " "), note);
    for (const text of [legend.note, legend.source, ...legend.entries.map((entry) => entry.label)]) {
      assert.ok(texts.includes(text));
    }
  }
  values.scenarioCountriesByTag = { GER: { base_iso2: "DEU" } };
  const unmatched = getTooltipText(feature("PL"));
  assert.match(unmatched, /未匹配／未覆盖/);
  assert.doesNotMatch(unmatched, /参考国家\/经济体:|参考国家：|\(DEU\)/);
  values.activeScenarioId = "modern_world";
  assert.equal(getThematicWgiViewModel(values).historicalReference, false);
  assert.equal(getThematicWgiLegend(values).referenceNote, "");

});


test("tooltip fixture realms retain independent language and indicator state", () => {
  const englishState = fixture();
  const chineseState = fixture();
  chineseState.currentLanguage = "zh";
  const english = createTooltipFixture(englishState);
  const chinese = createTooltipFixture(chineseState);
  assert.match(english.getTooltipText(feature("US")), /Government effectiveness · 2024:/);
  assert.match(chinese.getTooltipText(feature("US")), /政府效能 · 2024:/);
  chineseState.styleConfig.thematic.enabled = false;
  assert.doesNotMatch(chinese.getTooltipText(feature("US")), /World Bank WGI/);
  assert.match(english.getTooltipText(feature("US")), /Country\/economy score · World Bank WGI/);
});
