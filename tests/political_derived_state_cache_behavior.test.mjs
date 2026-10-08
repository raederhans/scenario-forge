import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parse } from "acorn";
import { createPoliticalDerivedStateCache } from "../js/core/renderer/political_derived_state_cache.js";
import { registerPoliticalGeometrySnapshot } from "../js/core/political_geometry_store.js";
import { bumpColorRevision, replaceResolvedColorsState, setResolvedColorForFeature } from "../js/core/state/color_state.js";
import { createSpatialIndexRuntimeOwner } from "../js/core/renderer/spatial_index_runtime_owner.js";
import { createDefaultSpatialIndexState } from "../js/core/state/spatial_index_state.js";

function rendererFunction(name, globals, includeFunctions = []) {
  const source = readFileSync(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
  const names = new Set([name, ...includeFunctions]);
  const declarations = parse(source, { ecmaVersion: "latest", sourceType: "module" }).body
    .filter((node) => node.type === "FunctionDeclaration" && names.has(node.id.name));
  assert.equal(declarations.length, names.size, `${name} and its dependencies must remain renderer functions`);
  const context = vm.createContext(globals);
  vm.runInContext(declarations.map(node => source.slice(node.start, node.end)).join("\n"), context);
  return context[name];
}

test("derived delta retains unchanged features, replaces the same ID and removes obsolete IDs", () => {
  const cache = createPoliticalDerivedStateCache({ getFeatureId: (f) => f.id });
  const a = { id: "a" }, b = { id: "b" }, gone = { id: "gone" };
  const collection = { features: [a, b, gone] };
  const colors = { a: "red", b: "blue", gone: "green" };
  const identity = ["scene", 1, "projection", 5];
  cache.commit({ collection, colors, identity });
  const next = { features: [a, { id: "b" }, { id: "new" }] };
  const delta = cache.describe({ previousCollection: collection, collection: next, colors, identity });
  assert.deepEqual(delta.changedIds, ["b", "new"]);
  assert.deepEqual(delta.removedIds, ["gone"]);
  for (const change of [{ identity: ["other", 1, "projection", 5] }, { identity: ["scene", 1, "projection", 6] }, { colors: { ...colors } }, { previousCollection: { ...collection } }]) {
    assert.equal(cache.describe({ previousCollection: collection, collection: next, colors, identity, ...change }), null);
  }
  delete colors.a;
  assert.ok(cache.describe({ previousCollection: collection, collection: next, colors, identity }).changedIds.includes("a"));
  cache.reset();
  assert.equal(cache.describe({ previousCollection: collection, collection: next, colors, identity }), null);
});

test("complete color refresh advances only paint baseline and retains geometry and missing-color checks", () => {
  const misses = [];
  const cache = createPoliticalDerivedStateCache({ getFeatureId: (feature) => feature.id, onMiss: (miss) => misses.push(miss) });
  const a = { id: "a" }, b = { id: "b" };
  const collection = { features: [a, b] };
  const identity = ["scene", "projection", "semantic", new Map()];
  const oldColors = { a: "red", b: "blue" };
  cache.commit({ identity, collection, colors: oldColors, colorRevision: 8 });
  const fullColors = { a: "green", b: "blue" };
  assert.equal(cache.refreshColors({ identity, collection, previousColors: oldColors, previousColorRevision: 8,
    colors: fullColors, colorRevision: 9 }), true);
  const next = { features: [a, { id: "b" }] };
  assert.deepEqual(cache.describe({ identity, previousCollection: collection, collection: next,
    colors: fullColors, colorRevision: 9 }).changedIds, ["b"]);
  delete fullColors.a;
  assert.deepEqual(cache.describe({ identity, previousCollection: collection, collection: next,
    colors: fullColors, colorRevision: 9 }).changedIds, ["a", "b"]);
  assert.deepEqual(misses, []);
});

test("color refresh refuses stale baseline, collection, structure, and geometry revision", () => {
  const a = { id: "a" };
  const collection = { features: [a] };
  registerPoliticalGeometrySnapshot(collection, { revision: 41, featuresById: new Map([["a", a]]) });
  const index = new Map();
  const identity = ["scene", "projection", "semantic", index];
  const oldColors = { a: "red" };
  const replacement = { a: "blue" };
  const cases = [
    { label: "prior colors", change: { previousColors: { ...oldColors } } },
    { label: "prior revision", change: { previousColorRevision: 7 } },
    { label: "collection", change: { collection: { features: [a] } } },
    { label: "scene", change: { identity: ["other", ...identity.slice(1)] } },
    { label: "projection", change: { identity: [identity[0], "other", ...identity.slice(2)] } },
    { label: "semantic", change: { identity: [identity[0], identity[1], "other", index] } },
    { label: "index", change: { identity: ["scene", "projection", "semantic", new Map()] } },
  ];
  for (const { label, change } of cases) {
    const misses = [];
    const cache = createPoliticalDerivedStateCache({ getFeatureId: (feature) => feature.id, onMiss: ({ reason }) => misses.push(reason) });
    cache.commit({ identity, collection, colors: oldColors, colorRevision: 8 });
    assert.equal(cache.refreshColors({ identity, collection, previousColors: oldColors,
      previousColorRevision: 8, colors: replacement, colorRevision: 9, ...change }), false, label);
    const previousCollection = label === "collection" ? change.collection : collection;
    assert.equal(cache.describe({ identity, previousCollection, collection, colors: replacement,
      colorRevision: 9 }), null, label);
    assert.equal(misses.at(-1), label === "collection" ? "collection-reference" : "colors-reference", label);
    if (label === "prior colors" || label === "prior revision") {
      assert.equal(cache.describe({ identity, previousCollection: collection, collection,
        colors: oldColors, colorRevision: 8 })?.changedIds.length, 0, "rejected refresh preserves old baseline");
    }
  }
  const cache = createPoliticalDerivedStateCache({ getFeatureId: (feature) => feature.id });
  cache.commit({ identity, collection, colors: oldColors, colorRevision: 8 });
  registerPoliticalGeometrySnapshot(collection, { revision: 42, featuresById: new Map([["a", a]]) });
  assert.equal(cache.refreshColors({ identity, collection, previousColors: oldColors,
    previousColorRevision: 8, colors: replacement, colorRevision: 9 }), false);
});

test("describe reports independent color pointer and revision misses after partial edits", () => {
  const misses = [];
  const cache = createPoliticalDerivedStateCache({ getFeatureId: (feature) => feature.id,
    onMiss: ({ reason }) => misses.push(reason) });
  const collection = { features: [{ id: "a" }] };
  const colors = { a: "red" };
  const identity = ["scene", "projection", "semantic", new Map()];
  cache.commit({ identity, collection, colors, colorRevision: 8 });
  assert.equal(cache.describe({ identity, previousCollection: collection, collection,
    colors: { ...colors }, colorRevision: 8 }), null);
  assert.equal(cache.describe({ identity, previousCollection: collection, collection,
    colors, colorRevision: 9 }), null);
  assert.deepEqual(misses, ["colors-reference", "color-revision"]);
});

test("renderer full color rebuild refreshes its matching derived baseline", () => {
  const a = { id: "a" }, b = { id: "b" };
  const collection = { features: [a, b] };
  const state = { landDataFull: collection, landData: collection, colors: { a: "old", b: "old" }, colorRevision: 8 };
  const identity = ["scene", "projection", "semantic", new Map()];
  const misses = [];
  const cache = createPoliticalDerivedStateCache({ getFeatureId: (feature) => feature.id,
    onMiss: ({ reason }) => misses.push(reason) });
  cache.commit({ identity, collection, colors: state.colors, colorRevision: state.colorRevision });
  const rebuild = rendererFunction("rebuildResolvedColors", {
    state, runtimeState: state, politicalDerivedStateCache: cache,
    nowMs: () => 1, ensureSovereigntyState() {},
    normalizeColorStateForRender(target) { target.colors = { ...target.colors }; },
    sanitizeColorMap() {}, sanitizeCountryColorMap() {},
    getResolvedColorSourceFeatures: () => state.landDataFull.features,
    getResolvedColorSourceName: () => "landDataFull",
    getFeatureId: (feature) => feature.id,
    getResolvedFeatureColor: (_feature, id) => `new-${id}`,
    replaceResolvedColorsState, bumpColorRevision,
    getPoliticalDerivedStateIdentity: () => identity,
    getCountryFillPaletteOwner: () => ({ invalidate() {} }),
    getPaintContourRuntimeOwner: () => ({ notifyPaintChanged: () => false }),
    getRiverInternalContourOwner: () => ({ notifyPaintChanged: () => false }),
    retargetPendingPoliticalColorEditRevisionAfterColorRebuild() {},
    invalidateRenderPasses() {}, recordColorRebuildDiagnostics() {}, recordRenderPerfMetric() {},
  }, ["notifyPaintContourColorsChanged"]);
  const rebuilt = rebuild();
  assert.equal(state.colors, rebuilt);
  assert.equal(state.colorRevision, 9);
  assert.deepEqual(Object.entries(rebuilt), [["a", "new-a"], ["b", "new-b"]]);
  const next = { features: [a, { id: "b" }] };
  assert.deepEqual(cache.describe({ identity, previousCollection: collection, collection: next,
    colors: state.colors, colorRevision: state.colorRevision }).changedIds, ["b"]);
  assert.deepEqual(misses, []);
});

test("renderer empty or fallback color sources cannot certify a derived baseline", () => {
  for (const fallback of [false, true]) {
    const full = { features: [] };
    const state = { landDataFull: full, landData: { features: fallback ? [{ id: "a" }] : [] },
      colors: { a: "old" }, colorRevision: 8 };
    let refreshes = 0;
    const rebuild = rendererFunction("rebuildResolvedColors", {
      state, runtimeState: state, nowMs: () => 1,
      politicalDerivedStateCache: { refreshColors: () => { refreshes++; return true; } },
      ensureSovereigntyState() {}, normalizeColorStateForRender() {},
      sanitizeColorMap() {}, sanitizeCountryColorMap() {},
      getResolvedColorSourceFeatures: () => fallback ? state.landData.features : [],
      getResolvedColorSourceName: () => fallback ? "landData" : "none",
      getFeatureId: (feature) => feature.id, getResolvedFeatureColor: () => "new",
      replaceResolvedColorsState, bumpColorRevision,
      getPoliticalDerivedStateIdentity: () => ["scene"],
      getCountryFillPaletteOwner: () => ({ invalidate() {} }),
      getPaintContourRuntimeOwner: () => ({ notifyPaintChanged: () => false }),
      getRiverInternalContourOwner: () => ({ notifyPaintChanged: () => false }),
      retargetPendingPoliticalColorEditRevisionAfterColorRebuild() {},
      invalidateRenderPasses() {}, recordColorRebuildDiagnostics() {}, recordRenderPerfMetric() {},
    }, ["notifyPaintContourColorsChanged"]);
    rebuild();
    assert.equal(refreshes, 0, fallback ? "fallback land source" : "empty source");
  }
});

function partialColorHarness({ beforeRefresh = () => {}, resolveColor = (_feature, id) => `paint-${id}` } = {}) {
  const features = Array.from({ length: 40 }, (_, i) => ({ id: `f${i}`, bounds: {
    minX: i * 3, minY: 1, maxX: i * 3 + 2, maxY: 3, area: 4,
  } }));
  const collection = { features };
  const state = { ...createDefaultSpatialIndexState(), landDataFull: collection, landData: collection,
    colors: Object.fromEntries(features.map(feature => [feature.id, `old-${feature.id}`])), colorRevision: 8 };
  const identity = ["scene", "projection", "semantic", "owner", state.landIndex];
  const metrics = [], misses = [];
  const counts = { primaryBounds: 0, spatialCulls: 0, colors: 0 };
  const cache = createPoliticalDerivedStateCache({ getFeatureId: feature => feature.id,
    onMiss: ({ reason }) => misses.push(reason) });
  const spatial = createSpatialIndexRuntimeOwner({ state, getters: { getPathSvg: () => ({}) }, helpers: {
    getLogicalCanvasDimensions: () => [800, 600], getFeatureId: feature => feature.id,
    computeProjectedFeatureBounds: feature => { counts.primaryBounds++; return feature.bounds; },
    getProjectedFeatureBounds: feature => { counts.primaryBounds++; return feature.bounds; },
    shouldSkipFeature: () => { counts.spatialCulls++; return false; },
  } });
  const bounds = new Map();
  spatial.rebuildRuntimePrimaryIndex({ projectedBoundsCache: bounds });
  spatial.buildSpatialIndex({ includeSecondary: false });
  cache.commit({ identity, collection, colors: state.colors, colorRevision: state.colorRevision });
  const getColor = (feature, id) => { counts.colors++; return resolveColor(feature, id); };
  const shared = { state, runtimeState: state, politicalDerivedStateCache: cache,
    getPoliticalDerivedStateIdentity: () => identity, nowMs: () => 1,
    getResolvedFeatureColor: getColor, setResolvedColorForFeature, bumpColorRevision,
    getCountryFillPaletteOwner: () => ({ notifyColorsChanged() {}, invalidate() {} }),
    recordRenderPerfMetric: (name, _duration, details) => metrics.push({ name, details }) };
  const refresh = rendererFunction("refreshResolvedColorsForFeatures", {
    ...shared, ensureSovereigntyState: () => beforeRefresh({ state, identity, collection }),
    getRenderPassCacheState: () => ({ partialPoliticalDirtyIds: new Set() }),
    hasPendingPoliticalColorEdit: () => false, normalizePoliticalColorEditIds: ids => ids,
    findResolvedColorFeatureById: id => state.landDataFull.features.find(feature => feature.id === id) || null,
    notifyPaintContourColorsChanged: () => false,
    getRiverPaintRuntime: () => ({ expandDirtyIds: ids => ids }),
    markPendingPoliticalColorEdit: () => false, clearPendingPoliticalColorEdit() {},
    invalidateRenderPasses() {}, shouldRefreshContextBaseForColorChanges: () => false,
    recordPartialColorRefreshDiagnostics() {}, rendererSurfaceHost: { getContext: () => null },
    politicalPatchPreviewBudget: { isDeferred: () => false },
  });
  const reconcileColors = rendererFunction("reconcilePoliticalDerivedColors", {
    ...shared, retargetPendingPoliticalColorEditRevisionAfterColorRebuild() {},
  });
  const rebuildDerived = rendererFunction("rebuildRuntimeDerivedState", {
    ...shared, buildRuntimePoliticalMeta() {}, clearProjectedBoundsCache: () => bounds.clear(),
    getProjectedGeometryBoundsOwner: () => ({ resetPublishedBoundsCache: () => bounds.clear() }),
    ensureProjectedBoundsCache: () => bounds, getSpatialIndexRuntimeOwner: () => spatial,
    reconcilePoliticalDerivedColors: reconcileColors,
    rebuildResolvedColors: () => {
      state.colors = Object.fromEntries(state.landDataFull.features.map(feature => [feature.id, getColor(feature, feature.id)]));
      bumpColorRevision(state);
      return state.colors;
    },
    queueIndexUiRefresh() {}, finalizeIndexBuildEffects() {},
    buildSpatialIndex: options => spatial.buildSpatialIndex(options),
  });
  const promote = rendererFunction("rebuildPrimaryPoliticalDerivedState", {
    ...shared, rebuildPrimaryPoliticalCollections: () => {
      const next = { features: state.landDataFull.features.map(feature => feature.id === "f1" ? { ...feature } : feature) };
      state.landDataFull = next;
      state.landData = next;
    }, rebuildRuntimeDerivedState: rebuildDerived,
  });
  const delta = () => cache.describe({ identity, previousCollection: collection, collection,
    colors: state.colors, colorRevision: state.colorRevision });
  const resetCounts = () => Object.keys(counts).forEach(key => { counts[key] = 0; });
  return { state, cache, identity, collection, refresh, promote, delta, counts, resetCounts, metrics, misses };
}

test("partial renderer paint and undo retain the strict geometry baseline for a single-feature promotion", () => {
  let undo = false;
  const harness = partialColorHarness({ resolveColor: (_feature, id) => undo ? `old-${id}` : `paint-${id}` });
  harness.refresh(["f0"]);
  assert.equal(harness.state.colors.f0, "paint-f0");
  assert.deepEqual(harness.delta().changedIds, []);
  undo = true;
  harness.refresh(["f0"], { inputLabel: "history-undo" });
  assert.equal(harness.state.colors.f0, "old-f0");
  assert.deepEqual(harness.delta().changedIds, []);
  harness.resetCounts();
  const promoted = harness.promote({ incremental: true, includeSecondarySpatial: false });
  assert.equal(promoted.incremental, true);
  assert.equal(promoted.changedFeatureCount, 1);
  assert.deepEqual(harness.counts, { primaryBounds: 2, spatialCulls: 1, colors: 1 });
  assert.deepEqual(harness.misses, []);
});

test("paint baseline mismatch keeps the full derived-state fallback and exposes its rebuild work", () => {
  const harness = partialColorHarness();
  harness.refresh(["f0"]);
  bumpColorRevision(harness.state);
  harness.resetCounts();
  const promoted = harness.promote({ incremental: true, includeSecondarySpatial: false });
  assert.equal(promoted.incremental, false);
  assert.deepEqual(harness.counts, { primaryBounds: 80, spatialCulls: 40, colors: 40 });
  assert.ok(harness.misses.includes("color-revision"));
});

test("partial renderer color refresh cannot certify changed scene projection owner collection or geometry", () => {
  for (const mutation of [
    ({ identity }) => { identity[0] = "other-scene"; },
    ({ identity }) => { identity[1] = "other-projection"; },
    ({ identity }) => { identity[2] = "other-semantic"; },
    ({ identity }) => { identity[3] = "other-owner"; },
    ({ state }) => { state.landDataFull = { features: [...state.landDataFull.features] }; },
    ({ collection }) => { registerPoliticalGeometrySnapshot(collection, {
      revision: 41, featuresById: new Map(collection.features.map(feature => [feature.id, feature])),
    }); },
    ({ state }) => { state.colors = { ...state.colors }; },
    ({ state }) => { bumpColorRevision(state); },
  ]) {
    const harness = partialColorHarness({ beforeRefresh: mutation });
    harness.refresh(["f0"]);
    assert.equal(harness.delta(), null);
  }
});

test("unresolved partial color targets do not advance the derived paint baseline", () => {
  for (const unresolved of ["missing-feature", "missing-color"]) {
    const harness = partialColorHarness({ resolveColor: () => unresolved === "missing-color" ? null : "#123456" });
    harness.refresh([unresolved === "missing-feature" ? "missing" : "f0"]);
    assert.equal(harness.delta(), null, unresolved);
  }
});
