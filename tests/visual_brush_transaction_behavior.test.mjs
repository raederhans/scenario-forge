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
