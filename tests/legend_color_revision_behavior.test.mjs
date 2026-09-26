import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parse } from "acorn";
import { createRevisionedLegendColorReader, LegendManager } from "../js/core/legend_manager.js";
import { setResolvedColorForFeature, bumpColorRevision, replaceResolvedColorsState } from "../js/core/state/color_state.js";
import { createCountryFillPaletteOwner } from "../js/core/renderer/country_fill_palette_owner.js";

function rendererFunction(name, globals) {
  const source = readFileSync(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
  const declaration = parse(source, { ecmaVersion: "latest", sourceType: "module" }).body
    .find(node => node.type === "FunctionDeclaration" && node.id.name === name);
  const context = vm.createContext(globals);
  vm.runInContext(source.slice(declaration.start, declaration.end), context);
  return context[name];
}

test("background color lookup indexes a source once and follows replacement and geometry revisions", () => {
  let reads = 0;
  let features = Array.from({ length: 2000 }, (_, i) => ({ id: `shell-${i}` }));
  const state = { landIndex: new Map(), topologyRevision: 1 };
  const lookup = rendererFunction("findResolvedColorFeatureById", {
    runtimeState: state,
    resolvedColorFeatureLookupCache: { features: null, revision: -1, index: null },
    getResolvedColorSourceFeatures: () => features,
    getFeatureId: feature => { reads++; return feature.id; },
  });
  for (const feature of features) assert.equal(lookup(feature.id), feature);
  assert.equal(reads, 2000, "pending background ids must not each scan the full source");
  assert.equal(lookup("missing"), null);
  assert.equal(reads, 2000);
  const old = features[0];
  features = [{ id: old.id }, { id: old.id }, {}];
  assert.equal(lookup(old.id), features[0], "preserve first-match semantics");
  assert.equal(lookup("feature-2"), features[2]);
  features[0] = { id: old.id, changed: true };
  state.topologyRevision++;
  assert.equal(lookup(old.id), features[0]);
  const interactive = { id: old.id, interactive: true };
  state.landIndex.set(old.id, interactive);
  assert.equal(lookup(old.id), interactive);
});

test("visible legend avoids feature scans until actual renderer color transaction commits", () => {
  let scans = 0;
  const colors = new Proxy({ A: "#112233", B: "#445566" }, {
    ownKeys(target) { scans++; return Reflect.ownKeys(target); },
  });
  const state = { colors, colorRevision: 0 };
  const features = [{ id: "A", country: "AA" }, { id: "B", country: "BB" }];
  const palette = createCountryFillPaletteOwner({
    state,
    getFeatures: () => features,
    getFeatureId: feature => feature.id,
    resolveCountryCode: feature => feature.country,
    isExcluded: () => false,
    resolveColor: (_feature, id) => state.colors[id],
  });
  const dominantColors = palette.getDominantFillColorMap();
  assert.equal(dominantColors.get("AA"), "#112233");
  assert.equal(dominantColors.get("BB"), "#445566");
  const read = createRevisionedLegendColorReader();
  assert.deepEqual(read(state), ["#112233", "#445566"]);
  for (let index = 0; index < 20; index++) read(state);
  assert.equal(scans, 1);
  let visibleColors;
  const deferredRenders = [];
  const contourNotifications = [], borderInvalidations = [];
  const refresh = rendererFunction("refreshResolvedColorsForFeatures", {
    state, runtimeState: state, setResolvedColorForFeature, bumpColorRevision,
    getCountryFillPaletteOwner: () => palette,
    getPaintContourRuntimeOwner: () => ({ notifyPaintChanged: (ids) => {
      // The extracted transaction owns publication order; the contour runtime
      // has its own behavior suite. Observe the actual committed colors here.
      contourNotifications.push({ ids: Array.from(ids), revision: state.colorRevision });
      for (const id of ids) assert.equal(state.colors[id], "#abcdef");
      return true;
    } }),
    migrateLegacyColorState() {}, ensureSovereigntyState() {},
    getRenderPassCacheState: () => ({ partialPoliticalDirtyIds: new Set() }),
    hasPendingPoliticalColorEdit: () => false, normalizePoliticalColorEditIds: ids => ids,
    findResolvedColorFeatureById: id => features.find(feature => feature.id === id) || null,
    getResolvedFeatureColor: () => "#abcdef",
    markPendingPoliticalColorEdit: () => false, clearPendingPoliticalColorEdit() {},
    invalidateRenderPasses: (pass, reason) => {
      if (pass === "borders") borderInvalidations.push({ reason, revision: state.colorRevision });
    },
    shouldRefreshContextBaseForColorChanges: () => false,
    recordPartialColorRefreshDiagnostics() {}, rendererSurfaceHost: { getContext: () => ({}) },
    requestRendererRender: (_reason, { fallback }) => fallback(),
    scheduleDeferredWork: (callback) => deferredRenders.push(callback),
    politicalPatchPreviewBudget: { isDeferred: () => false },
    render: () => {
      assert.equal(state.colorRevision, 1);
      assert.equal(dominantColors.get("AA"), "#abcdef", "palette notification commits before deferred render");
      assert.equal(dominantColors.get("BB"), "#445566", "unpainted country's palette is preserved");
      visibleColors = read(state);
    },
  });
  refresh(["A"], { renderNow: true });
  assert.equal(state.colors, colors, "transaction mutates the existing table");
  assert.equal(state.colorRevision, 1, "color transaction commits before deferred presentation");
  assert.equal(visibleColors, undefined, "fallback does not render synchronously");
  assert.equal(deferredRenders.length, 1);
  assert.deepEqual(contourNotifications, [{ ids: ["A"], revision: 1 }]);
  assert.deepEqual(borderInvalidations, [{ reason: "paint-contours-colors", revision: 1 }]);
  deferredRenders.shift()();
  assert.deepEqual(visibleColors, ["#abcdef", "#445566"]);
  assert.equal(scans, 2, "revision already changed before deferred render fallback");
  refresh(["B"], { renderNow: false });
  assert.equal(state.colorRevision, 2);
  assert.deepEqual(contourNotifications.at(-1), { ids: ["B"], revision: 2 });
  assert.deepEqual(borderInvalidations.at(-1), { reason: "paint-contours-colors", revision: 2 });
  assert.equal(contourNotifications.length, 2);
  assert.equal(borderInvalidations.length, 2);
  assert.equal(dominantColors.get("BB"), "#abcdef", "non-rendering color transactions also update palette");
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
