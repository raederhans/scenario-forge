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

const descriptor = { originX: 0, originY: 0, width: 8, height: 8, density: 1 };
const filledTile = (value, length = 64) => ({ ...makeTile(length * 4), codes: new Uint32Array(length).fill(value) });

test("RLE round trips unsigned codes and preserves exact edge arrays and float bits", () => {
  const cache = createPoliticalIdRasterCache({ maxBytes: 400 });
  const values = [0, 1, 0x80000000, 0xffffffff];
  const expected = Uint32Array.from({ length: 64 }, (_, index) => values[Math.floor(index / 16)]);
  const edgeIds = Uint32Array.of(1, 0xffffffff, 7);
  const edgeWeights = new Float32Array(Uint32Array.of(0x80000000, 0x3e800000, 0x7fc01234).buffer);
  const tile = { codes: expected.slice(), edgeIds, edgeWeights };
  cache.set("rle", tile, descriptor);
  cache.set("constant", filledTile(9), descriptor);
  assert.deepEqual(cache.get("rle").codes, expected);
  assert.equal(tile.edgeIds, edgeIds);
  assert.equal(tile.edgeWeights, edgeWeights);
  assert.deepEqual(new Uint32Array(tile.edgeWeights.buffer), Uint32Array.of(0x80000000, 0x3e800000, 0x7fc01234));
});
