import test from "node:test";
import assert from "node:assert/strict";
import { buildScenarioDefenseLineEntries, loadDefenseLinePresets } from "../js/core/scenario/defense_line_presets.js";
import { createStrategicOverlayRuntimeOwner } from "../js/core/renderer/strategic_overlay_runtime_owner.js";
import { configureDataBaseUrl } from "../js/core/data_base_url.js";

const line = { id: "maginot", label_en: "Maginot Line", label_zh: "马其诺防线", points: [[5.601, 49.448], [5.761, 49.52]] };
const payload = { version: 1, scenarios: { hoi4_1936: [line] } };

test("builds ordinary defensive lines with independent coordinates", () => {
  const entries = buildScenarioDefenseLineEntries(payload, "hoi4_1936", [], { language: "en" });
  assert.deepEqual(entries, [{
    id: "preset_hoi4_1936_maginot", kind: "defensive_line", stylePreset: "defensive_line",
    label: "Maginot Line", points: line.points, stroke: null, width: 0, opacity: 1, attachedCounterIds: [],
  }]);
  entries[0].points[0][0] = 100;
  assert.equal(line.points[0][0], 5.601);
});

test("skips existing ids and handles missing scenarios", () => {
  assert.deepEqual(buildScenarioDefenseLineEntries(payload, "hoi4_1936", [{ id: "preset_hoi4_1936_maginot" }]), []);
  assert.deepEqual(buildScenarioDefenseLineEntries(payload, "unknown", []), []);
  assert.deepEqual(buildScenarioDefenseLineEntries(payload, null, []), []);
  assert.deepEqual(buildScenarioDefenseLineEntries(null, "hoi4_1936", []), []);
});

test("uses the current label language", () => {
  assert.equal(buildScenarioDefenseLineEntries(payload, "hoi4_1936", [], { language: "zh" })[0].label, "马其诺防线");
  assert.equal(buildScenarioDefenseLineEntries(payload, "hoi4_1936", [], { language: "en" })[0].label, "Maginot Line");
});

test("loader resolves the data base, retries a failed load, and caches success", async () => {
  configureDataBaseUrl("https://assets.example.test/");
  try {
    let calls = 0;
    const fetchImpl = async (url) => {
      calls += 1;
      assert.equal(url, "https://assets.example.test/data/operational_presets/defense_lines.json");
      return calls === 1 ? { ok: false, status: 503 } : { ok: true, json: async () => payload };
    };
    await assert.rejects(loadDefenseLinePresets({ fetchImpl }), /503/);
    const pending = loadDefenseLinePresets({ fetchImpl });
    assert.equal(loadDefenseLinePresets({ fetchImpl }), pending);
    assert.equal(await pending, payload);
    assert.equal(await loadDefenseLinePresets({ fetchImpl }), payload);
    assert.equal(calls, 2);
  } finally {
    configureDataBaseUrl("");
  }
});

test("adding a batch creates one history entry and refreshes once", () => {
  const state = { operationalLines: [{ id: "existing", points: [[0, 0], [1, 1]] }] };
  const history = [];
  const dirty = [];
  let renders = 0;
  let refreshes = 0;
  const owner = createStrategicOverlayRuntimeOwner({ state, helpers: {
    captureHistoryState: (options) => {
      assert.deepEqual(options, { strategicOverlay: ["operationalLines"] });
      return { operationalLines: structuredClone(state.operationalLines) };
    },
    commitHistoryEntry: (entry) => history.push(entry),
    markDirty: (reason) => dirty.push(reason),
    renderNow: () => { renders += 1; },
    updateStrategicOverlayUi: () => { refreshes += 1; },
  } });
  const entries = buildScenarioDefenseLineEntries({ scenarios: { hoi4_1936: [line, { ...line, id: "second" }] } }, "hoi4_1936", []);
  assert.equal(owner.addScenarioDefenseLinePresets(entries), 2);
  assert.equal(state.operationalLines.length, 3);
  assert.equal(state.operationalLinesDirty, true);
  assert.equal(history.length, 1);
  assert.equal(history[0].kind, "add-scenario-defense-lines");
  assert.equal(history[0].before.operationalLines.length, 1);
  assert.deepEqual(history[0].after.operationalLines, state.operationalLines);
  assert.deepEqual(dirty, ["add-scenario-defense-lines"]);
  assert.equal(renders, 1);
  assert.equal(refreshes, 1);
  assert.equal(owner.addScenarioDefenseLinePresets([]), 0);
  assert.equal(history.length, 1);
  assert.equal(renders, 1);
  assert.equal(refreshes, 1);
});
