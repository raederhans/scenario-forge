import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { parse } from "acorn";
import { applyFeaturePaintState } from "../js/core/state/color_state.js";

// Bind the actual private composition-root transaction, not a reimplementation.
function fixture() {
  const source = readFileSync(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const names = new Set(["applyBrushHit", "mergeHistorySnapshot"]);
  const functions = ast.body.filter(node => node.type === "FunctionDeclaration" && names.has(node.id.name));
  assert.equal(functions.length, names.size);
  const runtime = {
    currentTool: "fill", interactionGranularity: "country", selectedColor: "#112233",
    visualOverrides: {}, featureOverrides: {}, waterRegionOverrides: {},
    sovereignBaseColors: { GER: "#445566" }, countryBaseColors: { GER: "#445566" },
    scenarioBaselineOwnersByFeatureId: Object.freeze({ a: "GER", b: "GER" }),
    landIndex: new Map([["a", { id: "a" }], ["b", { id: "b" }]]),
  };
  const session = { before: {}, changed: false, visitedFeatureIds: new Set(), affectedFeatureIds: new Set(),
    visitedWaterRegionIds: new Set(), affectedWaterRegionIds: new Set(), visitedSpecialRegionIds: new Set() };
  const calls = [];
  let ids = ["a", "b"];
  const context = vm.createContext({
    runtimeState: runtime, brushSession: session, LAND_FILL_COLOR: "#eeeeee",
    getFeatureCountryCodeNormalized: () => "DE", requestLeafDetailPromotion: () => true,
    resolveInteractionTargetIds: () => ids, getSafeCanvasColor: (color) => color,
    captureHistoryState: scope => {
      calls.push(["capture", scope]);
      if (scope.waterRegionIds) return { waterRegionOverrides: { [scope.waterRegionIds[0]]: null } };
      assert.equal(Object.hasOwn(scope, "ownerCodes"), false);
      return { visualOverrides: Object.fromEntries(scope.featureIds.map(id => [id, runtime.visualOverrides[id] || null])) };
    },
    applyFeatureVisualOverrideTransaction: (targets, color, options) => {
      calls.push(["paint", [...targets], color, options]);
      applyFeaturePaintState(runtime, [...targets], color, options);
    },
    isMacroOceanWaterRegion: () => false, isOpenOceanPaintEnabled: () => true,
    getWaterRegionDefaultFillColorById: () => "#0000ff",
  });
  vm.runInContext(functions.map(node => source.slice(node.start, node.end)).join("\n"), context);
  return { runtime, session, calls, apply: context.applyBrushHit, setIds: value => { ids = value; } };
}

test("country brush uses per-feature paint and records each feature only once", () => {
  const h = fixture();
  const reference = h.runtime.scenarioBaselineOwnersByFeatureId;
  assert.equal(h.apply({ id: "a", targetType: "land", countryCode: "DE" }), true);
  assert.deepEqual(h.runtime.visualOverrides, { a: "#112233", b: "#112233" });
  assert.deepEqual(h.runtime.featureOverrides, h.runtime.visualOverrides);
  assert.deepEqual(h.runtime.sovereignBaseColors, { GER: "#445566" });
  assert.equal(h.runtime.scenarioBaselineOwnersByFeatureId, reference);
  assert.equal(h.apply({ id: "b", targetType: "land" }), false);
  assert.equal(h.calls.filter(([name]) => name === "paint").length, 1);
  assert.deepEqual(Object.keys(h.session.before.visualOverrides), ["a", "b"]);
});

test("country brush eraser clears feature overrides but not the base palette", () => {
  const h = fixture();
  h.runtime.currentTool = "eraser";
  applyFeaturePaintState(h.runtime, ["a", "b"], "#000000");
  assert.equal(h.apply({ id: "a", targetType: "land" }), true);
  assert.deepEqual(h.runtime.visualOverrides, {});
  assert.deepEqual(h.runtime.sovereignBaseColors, { GER: "#445566" });
  assert.equal(h.session.before.visualOverrides.a, "#000000");
});

test("incomplete brush group produces no paint, capture or changed session", () => {
  const h = fixture(); h.setIds([]);
  assert.equal(h.apply({ id: "a", targetType: "land" }), false);
  assert.equal(h.session.changed, false);
  assert.deepEqual(h.calls, []);
});

test("water brush still uses its separate paint domain", () => {
  const h = fixture();
  assert.equal(h.apply({ id: "water", targetType: "water" }), true);
  assert.equal(h.runtime.waterRegionOverrides.water, "#112233");
  assert.deepEqual(h.runtime.visualOverrides, {});
  assert.equal(h.calls.some(([name]) => name === "paint"), false);
  assert.equal(h.apply({ id: "water", targetType: "water" }), false);
});

function developerGroupFixture(members = ["a", "b"]) {
  const source = readFileSync(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const declaration = ast.body.find(node => node.type === "FunctionDeclaration"
    && node.id.name === "applyDevMacroFillCurrentOwnerScope");
  assert.ok(declaration);
  const calls = [];
  const runtime = { landIndex: new Map([["a", {}], ["b", {}]]) };
  const context = vm.createContext({
    runtimeState: runtime,
    getDevWorkspaceActiveLandContext: () => ({ featureId: "a", countryCode: "AA" }),
    getFeatureOwnerCode: () => "REFERENCE",
    getFeatureIdsForOwner: () => members,
    showToast: message => calls.push(["toast", message]),
    t: value => value,
    applyDevLandBatchAction: ids => { calls.push(["paint", [...ids]]); return true; },
  });
  vm.runInContext(source.slice(declaration.start, declaration.end), context);
  return { calls, apply: context.applyDevMacroFillCurrentOwnerScope };
}

test("developer reference-group macro blocks missing members instead of painting a loaded subset", () => {
  const h = developerGroupFixture(["a", "b", "unloaded"]);
  assert.equal(h.apply(), false);
  assert.equal(h.calls.filter(([type]) => type === "paint").length, 0);
  assert.equal(h.calls.filter(([type]) => type === "toast").length, 1);
});

test("developer reference-group macro applies the complete group when hydrated", () => {
  const h = developerGroupFixture();
  assert.equal(h.apply(), true);
  assert.deepEqual(h.calls, [["paint", ["a", "b"]]]);
});


test("shared country/subdivision fill publishes one render after paint and history", () => {
  const source = readFileSync(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const fn = ast.body.find(node => node.type === "FunctionDeclaration" && node.id.name === "applyVisualSubdivisionFill");
  assert.ok(fn);
  for (const kind of ["fill-country-color", "fill-feature-color"]) {
    const calls = [];
    const context = vm.createContext({
      runtimeState: { activeScenarioId: "scene" }, LAND_FILL_COLOR: "#eeeeee",
      nowMs: () => 25, normalizeFeatureOverrideTargetIds: ids => [...new Set(ids)],
      getSafeCanvasColor: value => value, lastQuickFillLeafClick: null,
      captureHistoryState: scope => { calls.push(["capture", [...scope.featureIds]]); return {}; },
      applyFeatureVisualOverrideTransaction: ids => calls.push(["paint", [...ids]]),
      markDirty: reason => calls.push(["dirty", reason]),
      commitHistoryEntry: entry => calls.push(["history", entry.kind]),
      addRecentColor: color => calls.push(["recent", color]),
      requestInteractionRender: reason => calls.push(["render", reason]),
      refreshSidebarAfterPaint: scope => calls.push(["sidebar", [...scope.featureIds]]),
      noteRenderAction: reason => calls.push(["timing", reason]),
    });
    vm.runInContext(source.slice(fn.start, fn.end), context);
    assert.equal(context.applyVisualSubdivisionFill(["a", "b", "a"], "#112233", { kind }), true);
    assert.deepEqual(calls.map(([name]) => name), ["capture", "paint", "dirty", "capture", "history", "recent", "render", "sidebar", "timing"]);
    assert.deepEqual(calls.find(([name]) => name === "paint"), ["paint", ["a", "b"]]);
    assert.deepEqual(calls.filter(([name]) => name === "render"), [["render", kind]]);
    calls.length = 0;
    assert.equal(context.applyVisualSubdivisionFill([], "#112233", { kind }), false);
    assert.deepEqual(calls, []);
  }
});
