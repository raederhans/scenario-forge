import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parse } from "acorn";
import { createRevisionedLegendColorReader, LegendManager } from "../js/core/legend_manager.js";
import { setResolvedColorForFeature, bumpColorRevision, replaceResolvedColorsState } from "../js/core/state/color_state.js";

function rendererFunction(name, globals) {
  const source = readFileSync(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
  const declaration = parse(source, { ecmaVersion: "latest", sourceType: "module" }).body
    .find(node => node.type === "FunctionDeclaration" && node.id.name === name);
  const context = vm.createContext(globals);
  vm.runInContext(source.slice(declaration.start, declaration.end), context);
  return context[name];
}

test("visible legend avoids feature scans until actual renderer color transaction commits", () => {
  let scans = 0;
  const colors = new Proxy({ A: "#112233", B: "#445566" }, {
    ownKeys(target) { scans++; return Reflect.ownKeys(target); },
  });
  const state = { colors, colorRevision: 0 };
  const read = createRevisionedLegendColorReader();
  assert.deepEqual(read(state), ["#112233", "#445566"]);
  for (let index = 0; index < 20; index++) read(state);
  assert.equal(scans, 1);
  let visibleColors;
  const refresh = rendererFunction("refreshResolvedColorsForFeatures", {
    state, runtimeState: state, setResolvedColorForFeature, bumpColorRevision,
    migrateLegacyColorState() {}, ensureSovereigntyState() {},
    getRenderPassCacheState: () => ({ partialPoliticalDirtyIds: new Set() }),
    hasPendingPoliticalColorEdit: () => false, normalizePoliticalColorEditIds: ids => ids,
    findResolvedColorFeatureById: id => id === "missing" ? null : { id },
    getResolvedFeatureColor: () => "#abcdef",
    markPendingPoliticalColorEdit: () => false, clearPendingPoliticalColorEdit() {},
    invalidateRenderPasses() {}, shouldRefreshContextBaseForColorChanges: () => false,
    recordPartialColorRefreshDiagnostics() {}, rendererSurfaceHost: { getContext: () => ({}) },
    requestRendererRender: (_reason, { fallback }) => fallback(), render: () => { visibleColors = read(state); },
  });
  refresh(["A"], { renderNow: true });
  assert.equal(state.colors, colors, "transaction mutates the existing table");
  assert.deepEqual(visibleColors, ["#abcdef", "#445566"]);
  assert.equal(scans, 2, "revision already changed before synchronous render fallback");
  refresh(["B"], { renderNow: false });
  assert.deepEqual(read(state), ["#abcdef"]);
  assert.equal(scans, 3);
  replaceResolvedColorsState(state, {});
  assert.deepEqual(read(state), [], "empty-source rebuild replacement invalidates even without bump");
});

test("legend reader honors order/maxItems changes and returned arrays cannot corrupt cache", () => {
  const state = { colors: { A: "#112233", B: "#445566" }, colorRevision: 0 };
  const read = createRevisionedLegendColorReader();
  read(state).push("#000000");
  assert.deepEqual(read(state), ["#112233", "#445566"]);
  state.legendColorOrder.push("#445566");
  assert.deepEqual(read(state), ["#445566", "#112233"]);
  state.legendConfig.maxItems = 1;
  assert.deepEqual(read(state), ["#445566"]);
  replaceResolvedColorsState(state, { C: "#778899" });
  assert.deepEqual(read(state), ["#778899"]);
});

test("public legend reads and states without a revision remain safe for unversioned mutations", () => {
  const state = { colors: { A: "#112233" } };
  const read = createRevisionedLegendColorReader();
  assert.deepEqual(read(state), ["#112233"]);
  setResolvedColorForFeature(state, "A", "#445566");
  assert.deepEqual(read(state), ["#445566"]);
  state.colorRevision = 0;
  LegendManager.getUniqueColors(state);
  setResolvedColorForFeature(state, "A", "#778899");
  assert.deepEqual(LegendManager.getUniqueColors(state), ["#778899"]);
});
