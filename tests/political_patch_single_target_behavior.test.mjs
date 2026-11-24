import assert from "node:assert/strict";
import test from "node:test";
import { createPoliticalPatchPreview, orderPoliticalPatchFeatures } from "../js/core/renderer/political_patch_single_target.js";
import { createPoliticalPathCacheOwner } from "../js/core/renderer/political_path_cache_owner.js";
import { createRuntimePoliticalFeaturePolicy } from "../js/core/renderer/political_feature_policy.js";
import { collectPoliticalRasterDisplayFeatures } from "../js/core/renderer/political_id_raster_source.js";
import { encodePoliticalCoverage } from "../js/core/renderer/political_id_raster_tile.js";

function fixture(t, pathCacheBudget = 256000) {
  const entries = ["b", "a", "c"].map((id) => ({
    id, feature: { id, properties: { id, __source: id === "a" ? "primary" : "detail" }, geometry: { type: "Polygon", coordinates: [
      Array.from({ length: 2500 }, (_, i) => [i, i % 2]),
    ] } },
  }));
  const builds = [], fills = [];
  const patchPixel = new Uint8Array(1);
  const cache = {}, projection = {};
  const interactive = entries.map(({ feature }) => feature);
  const state = { landData: { features: interactive } };
  const { orderPoliticalShellUnderlayFirst } = createRuntimePoliticalFeaturePolicy(state, {
    hasPendingPoliticalColorEdit: () => true, getRenderPassCacheState: () => cache,
    getSafeCanvasColor: value => value,
  });
  let clock = 0;
  let context;
  const originalPath = globalThis.Path2D;
  globalThis.Path2D = class {};
  t.after(() => { globalThis.Path2D = originalPath; });
  function stream(feature) {
    builds.push(feature.id);
    context.id = feature.id;
    clock += 10;
  }
  stream.context = (...args) => args.length ? (context = args[0]) : context;
  const paths = createPoliticalPathCacheOwner({ zoomTransform: { k: 1, x: 0, y: 0 } }, {
    rendererSurfaceHost: { getPathCanvas: () => stream, getProjection: () => projection },
    getRenderPassCacheState: () => cache, cloneZoomTransform: value => ({ ...value }),
    recordRenderPerfMetric() {}, pathCacheBudget,
  });
  const owner = createPoliticalPatchPreview({
    now: () => clock,
    getPathSignature: paths.getPoliticalPathCacheSignature,
    getPathEntry: paths.getPoliticalFeaturePathEntry,
    isVisible: () => true,
  });
  function click(id, pending, sameColor = []) {
    cache.pendingPoliticalColorEditIds = new Set(pending);
    const plan = owner.prepare(pending.map(key => entries.find(entry => entry.id === key)), {
      inputLabel: "fill-feature-color", currentIds: [id], matchesPublishedColor: key => sameColor.includes(key),
    });
    fills.length = 0;
    patchPixel.fill(0);
    owner.draw(plan, features => orderPoliticalPatchFeatures(features, interactive, interactive, orderPoliticalShellUnderlayFirst), clock - 5,
      (feature, index, path) => {
        fills.push(path.id);
        patchPixel[0] = path.id.charCodeAt(0);
        return true;
      });
  }
  function rasterOverlapPixel() {
    const source = collectPoliticalRasterDisplayFeatures({ fullCollection: state.landData, interactiveCollection: state.landData });
    const layers = orderPoliticalShellUnderlayFirst(source).map(feature => ({
      code: feature.id.charCodeAt(0), alpha: Uint8Array.of(cache.pendingPoliticalColorEditIds.has(feature.id) ? 255 : 0),
    }));
    return encodePoliticalCoverage({ width: 1, height: 1, layers }).codes[0];
  }
  return { builds, fills, click, patchPixel, rasterOverlapPixel };
}

test("a cold click draws immediately and replays earlier patches in foreground order", (t) => {
  const f = fixture(t);
  f.click("a", ["a"]);
  assert.deepEqual(f.fills, ["a"]);
  f.click("b", ["a", "b"]);
  assert.deepEqual(f.fills, ["b", "a"]);
  assert.equal(f.patchPixel[0], f.rasterOverlapPixel());
  assert.deepEqual(f.builds, ["a", "b"]);
});

test("replay skips an evicted path even when the current click caused the eviction", (t) => {
  const f = fixture(t, 81000);
  f.click("a", ["a"]);
  f.click("b", ["a", "b"]);
  assert.deepEqual(f.fills, ["b"]);
  assert.deepEqual(f.builds, ["a", "b"]);
});

test("an oversized path paints on click and is never borrowed for replay", (t) => {
  const f = fixture(t, 512);
  f.click("b", ["b"]);
  assert.deepEqual(f.fills, ["b"]);
  f.click("a", ["b", "a"]);
  assert.deepEqual(f.fills, ["a"]);
  assert.deepEqual(f.builds, ["b", "a"]);
});

test("matching the displayed baseline skips the target and preserves other pending paint", (t) => {
  const f = fixture(t);
  f.click("a", ["a"], ["a"]);
  assert.deepEqual(f.fills, []);
  assert.deepEqual(f.builds, []);
  f.click("a", ["a"]);
  f.click("b", ["a", "b"], ["b"]);
  assert.deepEqual(f.fills, ["a"]);
  f.click("a", ["a", "b"], ["a", "b"]);
  assert.deepEqual(f.fills, []);
  assert.deepEqual(f.builds, ["a"]);
});
