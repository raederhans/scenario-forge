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

const descriptor = { originX: 0, originY: 0, width: 8, height: 8, density: 1 };
const filledTile = (value, length = 64) => ({ ...makeTile(length * 4), codes: new Uint32Array(length).fill(value) });

test("cold constant codes retain tile identity while reads materialize one stable hot array", () => {
  const cache = createPoliticalIdRasterCache({ maxBytes: 400 });
  const old = filledTile(0xffffffff), next = filledTile(7);
  const metadata = new WeakMap([[old, "old-identity"]]);
  assert.equal(cache.set("old", old, descriptor), true);
  assert.equal(cache.set("next", next, descriptor), true);
  assert.deepEqual(cache.getStats(), { cpuBytes: 260, tileCount: 2, evictions: 0 });
  assert.equal(cache.peek("old"), old);
  assert.equal(cache.entries()[0][1], old);
  assert.equal(metadata.get(cache.get("old")), "old-identity");
  assert.equal(cache.getStats().cpuBytes, 260, "identity/existence probes never decode");
  const codes = cache.get("old").codes;
  assert.ok(codes instanceof Uint32Array);
  assert.ok(codes.every(value => value === 0xffffffff));
  assert.equal(cache.get("old").codes, codes, "hot reads reuse one decoded array");
  assert.equal(cache.getStats().cpuBytes, 260, "the other tile becomes cold before decoding");
  assert.equal(cache.getStats().evictions, 0);
});

test("RLE round trips unsigned codes and preserves exact edge arrays and float bits", () => {
  const cache = createPoliticalIdRasterCache({ maxBytes: 400 });
  const values = [0, 1, 0x80000000, 0xffffffff];
  const expected = Uint32Array.from({ length: 64 }, (_, index) => values[Math.floor(index / 16)]);
  const edgeIds = Uint32Array.of(1, 0xffffffff, 7);
  const edgeWeights = new Float32Array(Uint32Array.of(0x80000000, 0x3e800000, 0x7fc01234).buffer);
  const tile = { codes: expected.slice(), edgeIds, edgeWeights, stats: { marker: "unchanged" } };
  cache.set("rle", tile, descriptor);
  cache.set("constant", filledTile(9), descriptor);
  assert.equal(cache.getStats().cpuBytes, 32 + 24 + 256);
  assert.deepEqual(cache.get("rle").codes, expected);
  assert.equal(tile.edgeIds, edgeIds);
  assert.equal(tile.edgeWeights, edgeWeights);
  assert.deepEqual(new Uint32Array(tile.edgeWeights.buffer), Uint32Array.of(0x80000000, 0x3e800000, 0x7fc01234));
  assert.equal(tile.stats.marker, "unchanged");
  assert.ok(cache.getStats().cpuBytes <= cache.maxBytes);
  assert.equal(cache.getStats().evictions, 0);
});

test("incompressible and non-configurable codes retain ordinary LRU eviction", () => {
  for (const immutable of [false, true]) {
    const cache = createPoliticalIdRasterCache({ maxBytes: 400 });
    const old = { ...makeTile(256), codes: Uint32Array.from({ length: 64 }, (_, index) => index) };
    if (immutable) Object.freeze(old);
    cache.set("old", old, descriptor);
    cache.set("next", filledTile(7), descriptor);
    assert.equal(cache.peek("old"), undefined);
    assert.equal(cache.peek("next").codes.length, 64);
    assert.deepEqual(cache.getStats(), { cpuBytes: 256, tileCount: 1, evictions: 1 });
  }
});

test("compressed aliases keep conservative bytes bounded when one tile has multiple keys", () => {
  const cache = createPoliticalIdRasterCache({ maxBytes: 600 });
  const shared = filledTile(3);
  cache.set("one", shared, descriptor);
  cache.set("two", shared, descriptor);
  cache.set("next", filledTile(4), descriptor);
  assert.equal(cache.getStats().cpuBytes, 264);
  assert.equal(cache.get("one"), cache.get("two"));
  assert.equal(cache.get("one").codes, shared.codes);
  assert.equal(cache.getStats().cpuBytes, 516);
  assert.equal(cache.getStats().evictions, 0);
  cache.invalidate([{ oldBounds: null, newBounds: null }]);
  assert.deepEqual(cache.getStats(), { cpuBytes: 0, tileCount: 0, evictions: 0 });
});

test("admitting an alias can evict its older key instead of rejecting a legal tile", () => {
  const cache = createPoliticalIdRasterCache({ maxBytes: 400 });
  const shared = filledTile(3);
  assert.equal(cache.set("old", shared, descriptor), true);
  const codes = shared.codes;
  assert.equal(cache.set("new", shared, descriptor), true);
  assert.equal(cache.peek("old"), undefined);
  assert.equal(cache.peek("new"), shared);
  assert.equal(shared.codes, codes);
  assert.deepEqual(cache.getStats(), { cpuBytes: 256, tileCount: 1, evictions: 1 });
});

test("materializing cold aliases evicts older aliases until their raw charges fit", () => {
  const cache = createPoliticalIdRasterCache({ maxBytes: 600 });
  const shared = filledTile(3);
  cache.set("one", shared, descriptor);
  cache.set("two", shared, descriptor);
  cache.set("other", filledTile(4), descriptor);
  cache.set("three", shared, descriptor);
  cache.set("four", shared, descriptor);
  assert.deepEqual(cache.getStats(), { cpuBytes: 272, tileCount: 5, evictions: 0 });
  const codes = cache.get("four").codes;
  assert.ok(codes.every(value => value === 3));
  assert.equal(cache.peek("one"), undefined);
  assert.equal(cache.peek("two"), undefined);
  assert.equal(cache.peek("three"), shared);
  assert.equal(cache.peek("four"), shared);
  assert.equal(cache.get("three").codes, codes);
  assert.deepEqual(cache.getStats(), { cpuBytes: 516, tileCount: 3, evictions: 2 });
});

test("48 MiB retains 30/36/24 full-size LOD tiles and returns to the first view without eviction", () => {
  const cache = createPoliticalIdRasterCache();
  const originals = new Map();
  const levels = [[1, 30], [3, 36], [6, 24]];
  for (const [level, count] of levels) {
    for (let index = 0; index < count; index += 1) {
      const key = `${level}:2:${index}:0`;
      const tile = filledTile(index + 1, 512 * 512);
      if (index % 2) tile.codes.fill(0x80000000 + index, 512 * 256);
      // Sparse coast/AA spans remain verbatim; the compression only affects codes.
      tile.edgeIds = new Uint32Array(64);
      tile.edgeWeights = new Float32Array(64);
      originals.set(key, tile);
      assert.equal(cache.set(key, tile, { ...descriptor, width: 512, height: 512, originX: index * 512 }), true);
      assert.ok(cache.getStats().cpuBytes <= 48 * 1024 * 1024);
    }
  }
  const hot = [];
  for (let index = 0; index < 30; index += 1) {
    const key = `1:2:${index}:0`;
    const tile = cache.get(key);
    assert.equal(tile, originals.get(key));
    assert.ok(tile.codes.every((value, at) => value === (index % 2 && at >= 512 * 256 ? 0x80000000 + index : index + 1)));
    hot.push(tile.codes);
    assert.ok(cache.getStats().cpuBytes <= cache.maxBytes);
  }
  for (let index = 0; index < 30; index += 1) assert.equal(cache.get(`1:2:${index}:0`).codes, hot[index]);
  assert.equal(cache.getStats().tileCount, 90);
  assert.equal(cache.getStats().evictions, 0);
  cache.clear();
  assert.equal(cache.getStats().cpuBytes, 0);
});
