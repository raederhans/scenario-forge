import test from "node:test";
import assert from "node:assert/strict";
import {
  createPoliticalIdRasterCache,
  planPoliticalIdRasterView,
} from "../js/core/renderer/political_id_raster_cache.js";

const makeTile = (bytes = 4) => ({
  codes: new Uint32Array(bytes / 4),
  edgeIds: new Uint32Array(0),
  edgeWeights: new Float32Array(0),
});

test("view planner handles negative coordinates and keeps nearby zooms in a stable density level", () => {
  const first = planPoliticalIdRasterView({
    transform: { x: 93.25, y: -18.5, k: 1 }, dpr: 1.5, width: 700, height: 500,
    tileSize: 64,
  });
  const nearby = planPoliticalIdRasterView({
    transform: { x: 93.25, y: -18.5, k: 1.01 }, dpr: 1.5, width: 700, height: 500,
    tileSize: 64,
  });
  assert.ok(first);
  assert.ok(nearby);
  assert.ok(first.originX < 0);
  assert.equal(nearby.level, first.level);
  assert.equal(nearby.tiles[0].key.split(":").slice(1).join(":"), first.tiles[0].key.split(":").slice(1).join(":"));
  assert.equal(first.outputX, first.originX * first.scale + 93.25 * 1.5);
  assert.equal(first.outputY, first.originY * first.scale + (-18.5) * 1.5);
  assert.ok(first.tiles.every((tile) => tile.width === 64 && tile.height === 64));
});

test("tile keys distinguish DPR and planner rejects invalid or over-budget views", () => {
  const one = planPoliticalIdRasterView({
    transform: { x: 0, y: 0, k: 1 }, dpr: 1, width: 300, height: 200, tileSize: 64,
  });
  const two = planPoliticalIdRasterView({
    transform: { x: 0, y: 0, k: 1 }, dpr: 2, width: 300, height: 200, tileSize: 64,
  });
  assert.notEqual(one.tiles[0].key, two.tiles[0].key);
  assert.equal(planPoliticalIdRasterView({ transform: { x: 0, y: 0, k: 1 }, dpr: 1,
    width: 1000, height: 1000, tileSize: 64, maxPixels: 64 * 64 }), null);
  assert.equal(planPoliticalIdRasterView({ transform: { x: 0, y: NaN, k: 1 }, dpr: 1,
    width: 300, height: 200 }), null);
});

test("LRU promotes reads, evicts oldest tiles, and refuses a tile larger than its hard budget", () => {
  const cache = createPoliticalIdRasterCache({ maxBytes: 12 });
  const descriptor = { originX: 0, originY: 0, width: 8, height: 8, density: 1 };
  cache.set("a", makeTile(4), descriptor);
  cache.set("b", makeTile(4), { ...descriptor, originX: 8 });
  assert.ok(cache.get("a"));
  cache.set("c", makeTile(8), { ...descriptor, originX: 16 });
  assert.equal(cache.peek("b"), undefined);
  assert.ok(cache.peek("a"));
  assert.ok(cache.peek("c"));
  assert.equal(cache.set("too-large", makeTile(16), { ...descriptor, originX: 24 }), false);
  assert.deepEqual(cache.getStats(), { cpuBytes: 12, tileCount: 2, evictions: 1 });
});

test("dirty invalidation removes tiles intersecting either old or new moved bounds", () => {
  const cache = createPoliticalIdRasterCache({ maxBytes: 64 });
  const tile = makeTile(4);
  cache.set("old", tile, { originX: 0, originY: 0, width: 32, height: 32, density: 1 });
  cache.set("new", tile, { originX: 96, originY: 0, width: 32, height: 32, density: 1 });
  cache.set("other", tile, { originX: 48, originY: 48, width: 32, height: 32, density: 1 });
  const removed = cache.invalidate([{
    oldBounds: { minX: 2, minY: 2, maxX: 4, maxY: 4 },
    newBounds: { minX: 100, minY: 2, maxX: 104, maxY: 4 },
  }]);
  assert.deepEqual(new Set(removed), new Set(["old", "new"]));
  assert.ok(cache.peek("other"));
});

test("unknown previous coverage clears all tiles but a true insertion stays local", () => {
  const cache = createPoliticalIdRasterCache({ maxBytes: 64 });
  const tile = makeTile(4);
  cache.set("old", tile, { originX: 0, originY: 0, width: 32, height: 32, density: 1 });
  cache.set("new", tile, { originX: 96, originY: 0, width: 32, height: 32, density: 1 });
  cache.set("far", tile, { originX: 160, originY: 96, width: 32, height: 32, density: 1 });
  assert.deepEqual(new Set(cache.invalidate([{
    oldBounds: null,
    newBounds: { minX: 100, minY: 2, maxX: 104, maxY: 4 },
    previousCoverageUnknown: true,
  }])), new Set(["old", "new", "far"]));
  assert.equal(cache.getStats().tileCount, 0);

  cache.set("old", tile, { originX: 0, originY: 0, width: 32, height: 32, density: 1 });
  cache.set("new", tile, { originX: 96, originY: 0, width: 32, height: 32, density: 1 });
  cache.set("far", tile, { originX: 160, originY: 96, width: 32, height: 32, density: 1 });
  assert.deepEqual(cache.invalidate([{
    oldBounds: null,
    newBounds: { minX: 100, minY: 2, maxX: 104, maxY: 4 },
    previousCoverageUnknown: false,
  }]), ["new"]);
  assert.ok(cache.peek("old"));
  assert.ok(cache.peek("far"));
});

test("unknown dirty bounds conservatively clear cache and clear resets retained bytes", () => {
  const cache = createPoliticalIdRasterCache({ maxBytes: 16 });
  cache.set("a", makeTile(4), { originX: 0, originY: 0, width: 8, height: 8, density: 1 });
  assert.deepEqual(cache.invalidate([{ oldBounds: null, newBounds: null }]), ["a"]);
  cache.set("b", makeTile(4), { originX: 0, originY: 0, width: 8, height: 8, density: 1 });
  cache.clear();
  assert.deepEqual(cache.getStats(), { cpuBytes: 0, tileCount: 0, evictions: 0 });
});
