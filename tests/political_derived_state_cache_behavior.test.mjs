import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parse } from "acorn";
import { createPoliticalDerivedStateCache } from "../js/core/renderer/political_derived_state_cache.js";
import { registerPoliticalGeometrySnapshot } from "../js/core/political_geometry_store.js";
import { bumpColorRevision, replaceResolvedColorsState } from "../js/core/state/color_state.js";

function rendererFunction(name, globals) {
  const source = readFileSync(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
  const declaration = parse(source, { ecmaVersion: "latest", sourceType: "module" }).body
    .find((node) => node.type === "FunctionDeclaration" && node.id.name === name);
  assert.ok(declaration, `${name} must remain a renderer function`);
  const context = vm.createContext(globals);
  vm.runInContext(source.slice(declaration.start, declaration.end), context);
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
    retargetPendingPoliticalColorEditRevisionAfterColorRebuild() {},
    invalidateRenderPasses() {}, recordColorRebuildDiagnostics() {}, recordRenderPerfMetric() {},
  });
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
      retargetPendingPoliticalColorEditRevisionAfterColorRebuild() {},
      invalidateRenderPasses() {}, recordColorRebuildDiagnostics() {}, recordRenderPerfMetric() {},
    });
    rebuild();
    assert.equal(refreshes, 0, fallback ? "fallback land source" : "empty source");
  }
});
