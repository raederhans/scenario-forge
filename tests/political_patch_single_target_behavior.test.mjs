import assert from "node:assert/strict";
import test from "node:test";
import { createPoliticalPatchPreview } from "../js/core/renderer/political_patch_single_target.js";
import { createPoliticalPathCacheOwner } from "../js/core/renderer/political_path_cache_owner.js";

function fixture(t) {
  const entries = ["a", "b", "c"].map((id) => ({
    id, feature: { id, geometry: { type: "Polygon", coordinates: [
      Array.from({ length: 2500 }, (_, i) => [i, i % 2]),
    ] } },
  }));
  const builds = [], fills = [];
  const cache = {}, projection = {};
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
    recordRenderPerfMetric() {}, pathCacheBudget: 512,
  });
  const owner = createPoliticalPatchPreview({
    now: () => clock,
    getPathSignature: paths.getPoliticalPathCacheSignature,
    getPathEntry: paths.getPoliticalFeaturePathEntry,
    isVisible: () => true,
  });
  function click(id, pending, sameColor = []) {
    const plan = owner.prepare(pending.map(key => entries.find(entry => entry.id === key)), {
      inputLabel: "fill-feature-color", currentIds: [id], matchesPublishedColor: key => sameColor.includes(key),
    });
    fills.length = 0;
    owner.draw(plan, features => [...features].sort((a, b) => a.id.localeCompare(b.id)), clock - 5,
      (feature, index, path) => {
        fills.push(path.id);
        return true;
      });
  }
  return { builds, fills, click };
}

test("a cold click draws immediately and replays earlier patches in foreground order", (t) => {
  const f = fixture(t);
  f.click("b", ["c", "b"]);
  assert.deepEqual(f.fills, ["b"]);
  f.click("a", ["c", "b", "a"]);
  assert.deepEqual(f.fills, ["a", "b"]);
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
