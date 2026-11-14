import test from "node:test";
import assert from "node:assert/strict";

import { state } from "../js/core/state.js";
import { clearHistory, undoHistory } from "../js/core/history_manager.js";
import { createScenarioTerritoryController } from "../js/ui/sidebar/scenario_territory_controller.js";
import { applyVisualPaintBatches } from "../js/ui/sidebar/visual_paint_batch.js";

const TOUCHED_STATE_KEYS = ["activeScenarioId", "releasableCatalog", "releasableBoundaryVariantByTag", "visualOverrides"];
let savedState = null;
test.beforeEach(() => {
  savedState = Object.fromEntries(TOUCHED_STATE_KEYS.map(key => [key, state[key]]));
  clearHistory();
});
test.afterEach(() => {
  clearHistory();
  Object.assign(state, savedState);
});
const country = { code: "CORE", color: "#aabbcc" };
const source = (...ids) => ({ type: "feature_ids", feature_ids: ids });
function harness({ missingTarget = false, missingEntry = false } = {}) {
  const toasts = [];
  let listRenders = 0;
  const entry = { tag: "CORE", default_boundary_variant_id: "small",
    boundary_variants: [
      { id: "small", preset_source: source("core") },
      { id: "large", preset_source: source("core", "old", "other") },
    ], companion_actions: [
      { id: "ally", target_owner_tag: "ALLY", auto_apply_on_core_territory: true, preset_source: source("ally") },
      { id: "hidden", target_owner_tag: "ALLY", hidden_in_ui: true, auto_apply_on_core_territory: true, preset_source: source("hidden") },
    ] };
  state.activeScenarioId = "test-territory";
  state.releasableCatalog = { entries: missingEntry ? [] : [entry] };
  state.releasableBoundaryVariantByTag = { CORE: "small" };
  state.visualOverrides = { old: "#AABBCC", other: "#123456" };
  const controller = createScenarioTerritoryController({
    t: value => value,
    getCountryState: code => code === "CORE" ? country : missingTarget ? null : { code: "ALLY", color: "#112233" },
    getResolvedCountryColor: value => value.color,
    showToast: (message, options) => toasts.push({ message, options }), render: () => {}, renderList: () => { listRenders += 1; },
    get applyScenarioOwnerControllerAssignments() { throw new Error("retired ownership capability read"); },
    get setReleasableBoundaryVariant() { throw new Error("retired boundary capability read"); },
    get activateCoreOwner() { throw new Error("retired activation capability read"); },
    get applyScenarioAutoCompanionActions() { throw new Error("retired companion capability read"); },
  });
  const apply = controller.applyScenarioReleasableCoreTerritory;
  controller.applyScenarioReleasableCoreTerritory = (countryState, options = {}) => apply(countryState, {
    filterToVisibleFeatureIds: ids => ({ matchedIds: ids }), ...options,
  });
  return { controller, toasts, get listRenders() { return listRenders; } };
}
const overrides = () => ({ ...state.visualOverrides });
const historyKinds = () => (state.historyPast || []).map(entry => entry.kind);

test("selected variant and companions use current country colors in one batch transaction", () => {
  const { controller } = harness();
  state.releasableBoundaryVariantByTag.CORE = "large";
  assert.equal(controller.applyScenarioReleasableCoreTerritory(country), true);
  assert.deepEqual(historyKinds(), ["scenario-core-apply-visual"]);
  assert.deepEqual(overrides(), { core: "#aabbcc", old: "#aabbcc", other: "#aabbcc", ally: "#112233" });
});

test("other variants clear only matching overrides, including after reloading state", () => {
  const { controller } = harness();
  state.visualOverrides = JSON.parse(JSON.stringify(state.visualOverrides));
  controller.applyScenarioReleasableCoreTerritory(country, { companionActionIds: [] });
  assert.equal(historyKinds().length, 1);
  assert.deepEqual(overrides(), { core: "#aabbcc", other: "#123456" });
});

test("hidden companions never execute even if selected; missing targets are skipped", () => {
  for (const missingTarget of [false, true]) {
    clearHistory();
    const { controller } = harness({ missingTarget });
    controller.applyScenarioReleasableCoreTerritory(country, { companionActionIds: ["ally", "hidden"] });
    assert.equal(historyKinds().length, 1);
    assert.equal(Object.hasOwn(overrides(), "ally"), !missingTarget);
    assert.equal(Object.hasOwn(overrides(), "hidden"), false);
  }
});

test("obsolete action options cannot select an ownership or boundary mutation", () => {
  const { controller } = harness();
  controller.applyScenarioReleasableCoreTerritory(country, { actionMode: "ownership", forceSovereignty: true });
  assert.deepEqual(historyKinds(), ["scenario-core-apply-visual"]);
  assert.equal(state.releasableBoundaryVariantByTag.CORE, "small");
});

test("missing catalog entry does not paint", () => {
  const { controller } = harness({ missingEntry: true });
  assert.equal(controller.applyScenarioReleasableCoreTerritory(country), false);
  assert.deepEqual(historyKinds(), []);
  assert.deepEqual(overrides(), { old: "#AABBCC", other: "#123456" });
});

test("invisible main territory does not paint or show success even with visible companions", () => {
  const h = harness();
  assert.equal(h.controller.applyScenarioReleasableCoreTerritory(country, {
    filterToVisibleFeatureIds: ids => ({ matchedIds: ids.filter(id => id !== "core") }),
  }), false);
  assert.deepEqual(historyKinds(), []);
  assert.equal(h.toasts.length, 1);
  assert.equal(h.toasts[0].options.tone, "warning");
  assert.equal(h.listRenders, 1);
  assert.deepEqual(state.visualOverrides, { old: "#AABBCC", other: "#123456" });
});

test("batch paint filters targets, records one undo snapshot and ignores unchanged final colors", () => {
  state.visualOverrides = { old: "#aabbcc", untouched: "#654321" };
  let renders = 0;
  const batches = [
    { ids: ["old"], color: null },
    { ids: ["core", "unloaded"], color: "#aabbcc" },
    { ids: ["ally", "core"], color: "#112233" },
  ];
  const options = {
    matchedCount: 1,
    filterToVisibleFeatureIds: ids => ({ matchedIds: ids.filter(id => id !== "unloaded") }),
    render: () => { renders += 1; }, historyKind: "territory", dirtyReason: "territory",
  };
  const result = applyVisualPaintBatches(batches, options);
  assert.equal(result.changed, 3);
  assert.equal(result.matchedCount, 1);
  assert.deepEqual(historyKinds(), ["territory"]);
  assert.equal(renders, 1);
  assert.deepEqual(overrides(), { core: "#112233", ally: "#112233", untouched: "#654321" });
  assert.equal(applyVisualPaintBatches(batches, options).changed, 0);
  assert.deepEqual(historyKinds(), ["territory"]);
  assert.equal(renders, 1);
  assert.equal(undoHistory(), true);
  assert.deepEqual(overrides(), { old: "#aabbcc", untouched: "#654321" });
});

