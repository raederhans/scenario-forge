import test from "node:test";
import assert from "node:assert/strict";
import { createReadonlyReferenceAssignments, getMapDataBoundary } from "../js/core/map_data_boundary.js";
import { createQuickFillHierarchyResolver } from "../js/core/quick_fill_hierarchy.js";
import { createFillTargetPolicy } from "../js/core/renderer/fill_target_policy.js";
import { createColorResolutionStrategyOwner } from "../js/core/renderer/color_resolution_strategy.js";
import { getDynamicBorderOwnershipContext } from "../js/core/renderer/border_mesh_dynamic_runtime.js";
import { createPaletteLibraryStateAccess } from "../js/core/palette_library_state_access.js";
import { applyFeaturePaintState } from "../js/core/state/color_state.js";
import { captureHistoryState } from "../js/core/history_manager.js";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parse } from "acorn";

function fixture({ blank = false } = {}) {
  const feature = id => ({ type: "Feature", properties: { id, country_code: "GB", admin1_group: "north" } });
  const state = {
    activeScenarioId: blank ? "blank_base" : "test_scene", mapSemanticMode: blank ? "blank" : "political",
    scenarioBaselineOwnersByFeatureId: createReadonlyReferenceAssignments(blank ? {} : { a: "2RA", b: "2RA", c: "GB", unloaded: "GB" }),
    sovereigntyByFeatureId: { a: "GB", b: "GB", c: "2RA" },
    ownerToFeatureIds: new Map([["2RA", new Set(["c"])]]),
    countryToFeatureIds: new Map([["GB", ["a", "b", "c"]]]),
    landIndex: new Map(["a", "b", "c"].map(id => [id, feature(id)])),
    hierarchyData: { groups: { GB_north: ["a", "b", "c"] } },
    sovereignBaseColors: { "2RA": "#111111", GB: "#222222" }, countryBaseColors: {},
    visualOverrides: {}, featureOverrides: {},
    currentTool: "fill", interactionGranularity: "country", batchFillScope: "country",
  };
  const helpers = {
    getAdmin1Group: f => f?.properties?.admin1_group,
    getFeatureCountryCodeNormalized: f => f?.properties?.country_code || "",
    getFeatureInteractionCountryCodeNormalized: () => "WRONG",
    shouldExcludePoliticalInteractionFeature: () => false,
    isSovereigntyModeActive: () => false,
  };
  return { state, helpers, fill: createFillTargetPolicy(state, helpers), hierarchy: createQuickFillHierarchyResolver(state, helpers) };
}

test("country fill no longer trusts stale ownership or an Array-versus-Set index", () => {
  const { state, fill } = fixture();
  assert.deepEqual(fill.resolveInteractionTargetIds(state.landIndex.get("a"), "a"), ["a", "b"]);
  state.ownerToFeatureIds = new Map([["2RA", ["c"]]]);
  state.sovereigntyByFeatureId.a = "OTHER";
  assert.deepEqual(fill.resolveInteractionTargetIds(state.landIndex.get("a"), "a"), ["a", "b"]);
});

test("country click and double-click both reject partially hydrated reference groups", () => {
  const { state, fill } = fixture();
  assert.deepEqual(fill.resolveInteractionTargetIds(state.landIndex.get("c"), "c"), []);
  state.interactionGranularity = "subdivision";
  assert.equal(fill.buildDoubleClickBatchPlan(state.landIndex.get("c"), "c"), null);
  state.landIndex.set("unloaded", { properties: { id: "unloaded", country_code: "GB" } });
  assert.deepEqual(fill.buildDoubleClickBatchPlan(state.landIndex.get("c"), "c").targetIds, ["c", "unloaded"]);
});

test("blank scenario uses geographic groups without inventing owner assignments", () => {
  const { state, fill, hierarchy } = fixture({ blank: true });
  state.countryToFeatureIds.set("GB", new Set(["a", "b", "c"]));
  assert.deepEqual(fill.resolveInteractionTargetIds(state.landIndex.get("a"), "a"), ["a", "b", "c"]);
  assert.equal(hierarchy.resolve(state.landIndex.get("a"), "a", "parent").status, "ready");
  state.landIndex.delete("b");
  assert.deepEqual(fill.resolveInteractionTargetIds(state.landIndex.get("a"), "a"), []);
  assert.deepEqual(state.scenarioBaselineOwnersByFeatureId, {});
});

test("reference-scoped parent fill is unaffected by painting or a view-layer palette", () => {
  const { state, hierarchy } = fixture();
  const resolve = () => hierarchy.resolve(state.landIndex.get("a"), "a", "parent").targetIds;
  assert.deepEqual(resolve(), ["a", "b"]);
  applyFeaturePaintState(state, ["a"], "#222222");
  state.colors = { a: "#abcdef", b: "#fedcba" };
  state.strategicChoroplethMetric = "population";
  assert.deepEqual(resolve(), ["a", "b"]);
  state.scenarioBaselineOwnersByFeatureId = createReadonlyReferenceAssignments({ a: "GB", b: "GB", c: "GB" });
  assert.deepEqual(resolve(), ["a", "b", "c"]);
});

test("reference border context and palette refresh agree on the baseline, not current RGB", () => {
  const { state } = fixture();
  const context = getDynamicBorderOwnershipContext(state);
  assert.equal(context.ownershipByFeatureId, state.scenarioBaselineOwnersByFeatureId);
  assert.throws(() => { context.ownershipByFeatureId.a = "GB"; }, TypeError);
  const palette = createPaletteLibraryStateAccess(state);
  assert.deepEqual(palette.getOwnerFeatureIds("2RA"), ["a", "b"]);
  applyFeaturePaintState(state, ["a", "c"], "#000000");
  assert.deepEqual(palette.getOwnerFeatureIds("2RA"), ["a", "b"]);
  state.activeScenarioId = "next";
  state.scenarioBaselineOwnersByFeatureId = createReadonlyReferenceAssignments({ c: "2RA" });
  assert.deepEqual(palette.getOwnerFeatureIds("2RA"), ["c"]);
  assert.deepEqual(getDynamicBorderOwnershipContext(state).ownershipByFeatureId, { c: "2RA" });
});

test("ordinary color strategy ignores mutable owner mirror but preserves blank, shell and Antarctica", () => {
  const { state } = fixture();
  const owner = createColorResolutionStrategyOwner({ state, helpers: {
    canonicalCountryCode: value => String(value || "").trim().toUpperCase(),
    getFeatureCountryCodeNormalized: feature => feature?.properties?.country_code || "",
    getFeatureId: feature => feature?.properties?.id || "",
    getSafeCanvasColor: (value, fallback) => /^#[0-9a-f]{6}$/i.test(value || "") ? value.toLowerCase() : fallback,
    normalizeMapSemanticMode: value => value,
    isAntarcticSectorFeature: feature => feature?.properties?.detail_tier === "antarctic_sector",
    isAtlantropaSeaFeature: () => false,
    isScenarioShellFeature: (_, id) => id.includes("_FB_"),
  } });
  assert.equal(owner.getResolvedFeatureColor(state.landIndex.get("a"), "a"), "#111111");
  applyFeaturePaintState(state, ["a"], "#abc");
  assert.equal(owner.getResolvedFeatureColor(state.landIndex.get("a"), "a"), "#aabbcc");
  applyFeaturePaintState(state, ["a"], null, { remove: true });
  assert.equal(owner.getResolvedFeatureColor(state.landIndex.get("a"), "a"), "#111111");
  const shell = { properties: { id: "GB_FB_1", scenario_shell_owner_hint: "2RA" } };
  assert.equal(owner.getResolvedFeatureColor(shell, "GB_FB_1"), "#111111");
  assert.equal(owner.getDisplayOwnerCode({ properties: { detail_tier: "antarctic_sector" } }, "AQ_1"), "");
  state.activeScenarioId = "blank_base"; state.mapSemanticMode = "blank";
  state.scenarioBaselineOwnersByFeatureId = createReadonlyReferenceAssignments({});
  assert.equal(owner.getResolvedFeatureColor(state.landIndex.get("b"), "b"), "#d7d3c7");
});

test("default paint API resolves geographic base colors outside a scenario", () => {
  const { state } = fixture(); state.activeScenarioId = "";
  const { paint, reference } = getMapDataBoundary(state);
  assert.equal(paint.resolveFeatureColor("a").color, "#222222");
  assert.equal(reference.getScenarioGroupCode("a"), "");
  state.runtimeCanonicalCountryByFeatureId = { unloaded: "GB" };
  assert.equal(paint.resolveFeatureColor("unloaded").color, "#222222");
  state.mapSemanticMode = "blank";
  assert.equal(paint.resolveFeatureColor("unloaded").color, null);
});

test("retired ownership cannot add history or clear redo; mixed entries retain only paint", () => {
  const source = readFileSync(new URL("../js/core/history_manager.js", import.meta.url), "utf8");
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const names = new Set(["stableStringify", "hasHistoryDelta", "pushHistoryEntry"]);
  const functions = ast.body.filter(node => node.type === "FunctionDeclaration" && names.has(node.id.name));
  assert.equal(functions.length, names.size);
  const model = { historyPast: [], historyFuture: [{ kind: "existing-redo" }] };
  const calls = [];
  const context = vm.createContext({ runtimeState: model, state: model,
    coalesceQuickFillGesture: () => null, callRuntimeHook: (_, name) => calls.push(name) });
  vm.runInContext(functions.map(node => source.slice(node.start, node.end)).join("\n"), context);
  const beforeFuture = model.historyFuture;
  assert.deepEqual(captureHistoryState({ sovereigntyFeatureIds: ["a"] }), {});
  assert.equal(context.pushHistoryEntry({ before: { sovereigntyByFeatureId: { a: "GB" } },
    after: { sovereigntyByFeatureId: { a: "FR" } } }), false);
  assert.equal(model.historyFuture, beforeFuture);
  assert.deepEqual(model.historyPast, []);
  assert.deepEqual(calls, []);
  assert.equal(context.pushHistoryEntry({
    before: { sovereigntyByFeatureId: { a: "GB" }, visualOverrides: { a: null } },
    after: { sovereigntyByFeatureId: { a: "FR" }, visualOverrides: { a: "#000000" } },
    meta: { affectsSovereignty: true },
  }), true);
  const entry = model.historyPast[0];
  assert.equal(Object.hasOwn(entry.before, "sovereigntyByFeatureId"), false);
  assert.equal(Object.hasOwn(entry.after, "sovereigntyByFeatureId"), false);
  assert.equal(entry.after.visualOverrides.a, "#000000");
  assert.equal(entry.meta.affectsSovereignty, false);
  assert.equal(model.historyFuture.length, 0);
});
