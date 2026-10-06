import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { THEMATIC_HDI_METRICS } from "../js/core/thematic_hdi_data.js";
import { getThematicIndicator, loadThematicIndicatorData } from "../js/core/thematic_indicator_catalog.js";
import { ensureThematicWgiData } from "../js/core/thematic_wgi_runtime.js";
import { setThematicWgiStyleState } from "../js/core/state/actions/thematic_wgi_actions.js";
import {
  normalizeThematicWgiStyle, getThematicWgiColor, getThematicWgiLegend,
  getThematicWgiFeatureInspection, getThematicWgiViewModel,
} from "../js/core/thematic_wgi_view_model.js";
import { resolveFeatureColor } from "../js/core/color_resolver.js";
import { createTooltipFixture } from "./helpers/isolated_tooltip_fixture.mjs";
import { drawThematicWgiExportLegend } from "../js/core/renderer/thematic_wgi_export_legend.js";

const fetchJson = async (path) => {
  const bytes = await readFile(new URL(`../${path}`, import.meta.url));
  return JSON.parse((path.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString("utf8"));
};
const dataByMetric = new Map(await Promise.all(THEMATIC_HDI_METRICS.map(async ({ id }) => [id,
  await loadThematicIndicatorData({ metricId: id, fetchJson })])));
function fixture(metricId = "undp_hdi", scenarioId = "modern_world") {
  return { activeScenarioId: scenarioId, currentLanguage: "en", width: 1000,
    styleConfig: { thematic: normalizeThematicWgiStyle({ enabled: true, metricId }) },
    thematicWgiRuntime: { status: "ready", data: dataByMetric.get(metricId), revision: 1 },
    visualOverrides: { sample: "#123456" },
    scenarioBaselineOwnersByFeatureId: { sample: "GER" }, scenarioCountriesByTag: { GER: { base_iso2: "DE" } } };
}
const feature = { id: "sample", properties: { ISO_A2: "AT" } };

test("HDI uses exact official category cutoffs and distinct missing/unmatched colors", () => {
  const metric = getThematicIndicator("undp_hdi");
  for (const [value, index] of [[0, 0], [0.549, 0], [0.55, 1], [0.699, 1], [0.7, 2], [0.799, 2], [0.8, 3], [1, 3]]) {
    assert.equal(getThematicWgiColor({ status: "value", value, metricId: metric.id }), metric.colors[index]);
  }
  assert.notEqual(getThematicWgiColor({ status: "missing" }), getThematicWgiColor({ status: "unmatched" }));
});

test("every UNDP indicator renders raw units and its own year, source and bins across four scenarios", () => {
  for (const { id } of THEMATIC_HDI_METRICS) {
    const metric = getThematicIndicator(id);
    for (const scene of ["modern_world", "hoi4_1936", "hoi4_1939", "tno_1962"]) {
      const state = fixture(id, scene);
      const observation = getThematicWgiFeatureInspection(state, feature);
      assert.equal(observation.joinKey, scene === "modern_world" ? "AUT" : "DEU");
      assert.equal(observation.value, dataByMetric.get(id).byIsoA3[observation.joinKey].value);
      assert.equal(resolveFeatureColor("sample", { state, feature }).color, getThematicWgiColor(observation));
      assert.equal(state.visualOverrides.sample, "#123456");
      const tooltip = createTooltipFixture(state).getTooltipText(feature);
      assert.match(tooltip, /2023/);
      assert.match(tooltip, /UNDP HDR 2025/);
      assert.doesNotMatch(tooltip, /2024|World Bank|\/ 100|confidence interval/);
      if (metric.unit === "years") assert.match(tooltip, /\d+\.\d years/);
      if (metric.unit === "usd_2021_ppp") assert.match(tooltip, /2021 PPP \$/);
      const legend = getThematicWgiLegend(state);
      assert.equal(legend.entries.length, metric.colors.length + 2);
      assert.equal(legend.binCount, id === "undp_hdi" ? 4 : 5);
      assert.equal(legend.referenceNote.includes("2023"), scene !== "modern_world");
      const texts = [], swatches = [];
      const ctx = { save() {}, restore() {}, setTransform() {}, strokeRect() {},
        measureText: (text) => ({ width: text.length * 6 }),
        fillRect() { swatches.push(this.fillStyle); }, fillText(text) { texts.push(text); } };
      drawThematicWgiExportLegend({ width: 2000, height: 1200, getContext: () => ctx }, state);
      assert.ok(texts.includes(metric.attribution));
      for (const label of metric.labels) assert.ok(texts.includes(label));
      assert.equal(swatches.length, metric.colors.length + 3); // background + bins + two missing states
    }
  }
});

test("UNDP mapping follows actual historical owner groups and leaves unknown/special surfaces alone", async () => {
  for (const [scene, tag, iso] of [["hoi4_1936", "CZE", "CZE"], ["hoi4_1939", "GER", "DEU"], ["tno_1962", "WRS", "RUS"]]) {
    const base = `data/scenarios/${scene}`;
    const manifest = await fetchJson(`${base}/manifest.json`);
    const [topology, { owners }, { countries }] = await Promise.all([
      fetchJson(manifest.runtime_topology_url), fetchJson(`${base}/owners.by_feature.json`), fetchJson(`${base}/countries.json`),
    ]);
    const features = topology.objects.political.geometries.map((geometry) => ({
      id: geometry.properties?.id ?? geometry.id, properties: geometry.properties,
    }));
    const state = { ...fixture("undp_hdi", scene), scenarioBaselineOwnersByFeatureId: owners,
      scenarioCountriesByTag: countries, landData: { features } };
    const owned = features.filter((row) => owners[row.id] === tag);
    assert.ok(owned.length > 0);
    assert.deepEqual([...new Set(owned.map((row) => getThematicWgiFeatureInspection(state, row).joinKey))], [iso]);
    assert.ok(getThematicWgiViewModel(state).coverage.matched > 0);
    for (const properties of [{ water_type: "sea" }, { special_type: "zone" }, { atl_color_rule: "land" }]) {
      assert.equal(getThematicWgiFeatureInspection(state, { ...feature, properties }), null);
    }
    const unknown = { ...state, scenarioCountriesByTag: { [tag]: { base_iso2: "ZZZ" } } };
    assert.equal(getThematicWgiFeatureInspection(unknown, owned[0]).status, "unmatched");
  }
});

test("cross-family switches fence stale responses and preserve the selected data identity", async () => {
  const wgiMetric = "wgi_government_effectiveness_score_0_100";
  const wgiData = await loadThematicIndicatorData({ metricId: wgiMetric, fetchJson });
  for (const [firstId, secondId, firstData, secondData] of [
    [wgiMetric, "undp_hdi", wgiData, dataByMetric.get("undp_hdi")],
    ["undp_hdi", wgiMetric, dataByMetric.get("undp_hdi"), wgiData],
  ]) {
    for (const fail of [false, true]) {
      const state = fixture(firstId);
      state.thematicWgiRuntime = { status: "idle", revision: 0 };
      let finish, reject;
      const oldData = new Promise((resolve, no) => { finish = resolve; reject = no; });
      const old = ensureThematicWgiData(state, { loadData: () => oldData });
      await Promise.resolve();
      setThematicWgiStyleState(state, normalizeThematicWgiStyle({ enabled: true, metricId: secondId }));
      await ensureThematicWgiData(state, { loadData: async () => secondData });
      if (fail) reject(new Error("stale source failed")); else finish(firstData);
      assert.equal(await old, null);
      assert.equal(state.thematicWgiRuntime.status, "ready");
      assert.equal(state.thematicWgiRuntime.data.metricId, secondId);
    }
  }
});
