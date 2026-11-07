import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parse } from "acorn";
import { state } from "../js/core/state.js";
import { applyFeaturePaintState } from "../js/core/state/color_state.js";
import * as manager from "../js/core/releasable_manager.js";

function loadModule(path, bindings) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const context = vm.createContext(bindings);
  vm.runInContext(ast.body.filter(node => node.type !== "ImportDeclaration")
    .map(node => source.slice(node.declaration?.start ?? node.start, node.end)).join("\n"), context);
  return context;
}
const country = { code: "CORE", color: "#aabbcc" };
const source = (...ids) => ({ type: "feature_ids", feature_ids: ids });
function harness({ missingTarget = false, missingEntry = false } = {}) {
  const calls = [];
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
  const context = loadModule("../js/ui/sidebar/scenario_territory_controller.js", {
    ...manager, state,
    applyVisualPaintBatches: (batches, options) => { calls.push({ batches, options }); return { applied: true, changed: 3, matchedCount: options.matchedCount }; },
  });
  const controller = context.createScenarioTerritoryController({
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
  return { controller, calls, toasts, get listRenders() { return listRenders; } };
}
function batches(calls) { return JSON.parse(JSON.stringify(calls[0].batches)); }

test("selected variant and companions use current country colors in one batch transaction", () => {
  const { controller, calls } = harness();
  state.releasableBoundaryVariantByTag.CORE = "large";
  assert.equal(controller.applyScenarioReleasableCoreTerritory(country), true);
  assert.equal(calls.length, 1);
  assert.deepEqual(batches(calls), [
    { ids: [], color: null }, { ids: ["core", "old", "other"], color: "#aabbcc" },
    { ids: ["ally"], color: "#112233" },
  ]);
});

test("other variants clear only matching overrides, including after reloading state", () => {
  const { controller, calls } = harness();
  state.visualOverrides = JSON.parse(JSON.stringify(state.visualOverrides));
  controller.applyScenarioReleasableCoreTerritory(country, { companionActionIds: [] });
  assert.equal(calls.length, 1);
  assert.deepEqual(batches(calls), [ { ids: ["old"], color: null }, { ids: ["core"], color: "#aabbcc" } ]);
});

test("hidden companions never execute even if selected; missing targets are skipped", () => {
  for (const missingTarget of [false, true]) {
    const { controller, calls } = harness({ missingTarget });
    controller.applyScenarioReleasableCoreTerritory(country, { companionActionIds: ["ally", "hidden"] });
    assert.equal(calls.length, 1);
    assert.equal(batches(calls).length, missingTarget ? 2 : 3);
    assert.ok(!batches(calls).some(batch => batch.ids.includes("hidden")));
  }
});

test("obsolete action options cannot select an ownership or boundary mutation", () => {
  const { controller, calls } = harness();
  controller.applyScenarioReleasableCoreTerritory(country, { actionMode: "ownership", forceSovereignty: true });
  assert.equal(calls[0].options.historyKind, "scenario-core-apply-visual");
  assert.equal(state.releasableBoundaryVariantByTag.CORE, "small");
});

test("missing catalog entry does not paint", () => {
  const { controller, calls } = harness({ missingEntry: true });
  assert.equal(controller.applyScenarioReleasableCoreTerritory(country), false);
  assert.equal(calls.length, 0);
});

test("invisible main territory does not paint or show success even with visible companions", () => {
  const h = harness();
  assert.equal(h.controller.applyScenarioReleasableCoreTerritory(country, {
    filterToVisibleFeatureIds: ids => ({ matchedIds: ids.filter(id => id !== "core") }),
  }), false);
  assert.equal(h.calls.length, 0);
  assert.equal(h.toasts.length, 0);
  assert.equal(h.listRenders, 1);
  assert.deepEqual(state.visualOverrides, { old: "#AABBCC", other: "#123456" });
});

test("batch paint filters targets, records one undo snapshot and ignores unchanged final colors", () => {
  const runtime = { visualOverrides: { old: "#aabbcc", untouched: "#654321" } };
  const entries = [];
  let captures = 0;
  let dirty = 0;
  let renders = 0;
  const context = loadModule("../js/ui/sidebar/visual_paint_batch.js", {
    state: runtime, applyFeaturePaintState,
    captureHistoryState: ({ featureIds }) => {
      captures += 1;
      return { visualOverrides: Object.fromEntries(featureIds.map(id => [id, runtime.visualOverrides[id] ?? null])) };
    },
    hasHistoryDelta: (before, after) => JSON.stringify(before) !== JSON.stringify(after),
    pushHistoryEntry: entry => entries.push(entry),
    refreshResolvedColorsForFeatures: () => {},
    markDirty: () => { dirty += 1; },
  });
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
  const result = context.applyVisualPaintBatches(batches, options);
  assert.equal(result.changed, 3);
  assert.equal(result.matchedCount, 1);
  assert.equal(captures, 2);
  assert.equal(entries.length, 1);
  assert.equal(dirty, 1);
  assert.equal(renders, 1);
  assert.deepEqual(runtime.visualOverrides, { core: "#112233", ally: "#112233", untouched: "#654321" });
  assert.equal(context.applyVisualPaintBatches(batches, options).changed, 0);
  assert.equal(entries.length, 1);
  assert.equal(dirty, 1);
  assert.equal(renders, 1);
  for (const [id, color] of Object.entries(entries[0].before.visualOverrides)) {
    applyFeaturePaintState(runtime, [id], color, { remove: color === null });
  }
  assert.deepEqual(runtime.visualOverrides, { old: "#aabbcc", untouched: "#654321" });
});

test("sidebar hierarchy uses only visual paint, deduplicates targets and preserves transaction options", () => {
  const source = readFileSync(new URL("../js/ui/sidebar.js", import.meta.url), "utf8");
  const fn = parse(source, { ecmaVersion: "latest", sourceType: "module" }).body.find(node => node.id?.name === "applyHierarchyGroupWithMode");
  const events = [];
  const context = vm.createContext({
    runtimeState: { selectedColor: "#abcdef", paintMode: "sovereignty", activeSovereignCode: "STALE" },
    previewHierarchyGroupHighlight: (_group, ids) => events.push(["preview", Array.from(ids)]),
    applyVisualOverridesToFeatureIds: (ids, color, options) => { events.push(["paint", Array.from(ids), color, options]); return { applied: true, mode: "visual" }; },
  });
  vm.runInContext(source.slice(fn.start, fn.end), context);
  const result = context.applyHierarchyGroupWithMode({ children: [" a ", "a", "b", ""] }, { mode: "ownership", ownerCode: "OLD", visualHistoryKind: "custom" });
  assert.equal(result.applied, true);
  assert.deepEqual(events[0], ["preview", ["a", "b"]]);
  assert.deepEqual(events[1].slice(0, 3), ["paint", ["a", "b"], "#abcdef"]);
  assert.equal(events[1][3].historyKind, "custom");
  assert.equal(context.applyHierarchyGroupWithMode(null).mode, "visual");
  assert.equal(source.includes("scenario_transfer_controller.js"), false);
});
