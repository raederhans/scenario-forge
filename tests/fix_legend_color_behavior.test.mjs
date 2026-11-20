import assert from "node:assert/strict";
import test from "node:test";
import { getLegendEditorEntries } from "../js/core/legend_state_normalizers.js";
import { createPaletteLibraryOperation } from "../js/core/palette_library_operation.js";
import { createPaletteLibraryStateAccess } from "../js/core/palette_library_state_access.js";
import { getPaletteCountryTargets } from "../js/core/palette_country_targets.js";

test("idle editor reads skip area calculations and follow the next paint revision", () => {
  const state = {
    colors: { a: "#aaaaaa", b: "#bbbbbb" }, colorRevision: 0,
    landIndex: new Map(["a", "b"].map(id => [id, { geometry: { type: "Point", coordinates: [0, 0] } }])),
  };
  let areaCalls = 0;
  function area() { areaCalls++; return 1; }
  const readColors = () => getLegendEditorEntries(state, area, () => "").map(entry => entry.color);
  assert.deepEqual(readColors(), ["#aaaaaa", "#bbbbbb"]);
  assert.equal(areaCalls, 2);
  assert.deepEqual(readColors(), ["#aaaaaa", "#bbbbbb"]);
  assert.equal(areaCalls, 2);
  state.colors.a = "#bbbbbb";
  state.colorRevision++;
  assert.deepEqual(readColors(), ["#bbbbbb"]);
});

test("consecutive palette country edits prompt only for foreign old-color overrides", async () => {
  const state = {
    activeScenarioId: "test",
    scenarioBaselineOwnersByFeatureId: Object.freeze({ a: "D01", b: "D01", foreign: "FRA" }),
    sovereignBaseColors: { D01: "#112233" }, visualOverrides: {},
  };
  const messages = [];
  const edit = createPaletteLibraryOperation({
    state, ...createPaletteLibraryStateAccess(state),
    getCountryFeatureIds: code => [...getPaletteCountryTargets(state).get(code)],
    dialog: async ({ message }) => { messages.push(message); return true; },
    captureHistoryState: () => ({}), pushHistoryEntry() {}, markDirty() {}, selectPaintColor() {},
    refreshColorState() {}, refreshResolvedColorsForFeatures() {},
  });
  const recolor = color => edit.applyColor(color, { countryCode: "D01" });
  await recolor("#aaaaaa");
  await recolor("#bbbbbb");
  assert.deepEqual(messages, []);
  assert.deepEqual(state.visualOverrides, { a: "#bbbbbb", b: "#bbbbbb" });
  state.visualOverrides.foreign = "#bbbbbb";
  await recolor("#cccccc");
  assert.equal(messages.length, 1);
  assert.match(messages[0], /\b1\b/);
  assert.deepEqual(state.visualOverrides, { a: "#cccccc", b: "#cccccc", foreign: "#cccccc" });
});
