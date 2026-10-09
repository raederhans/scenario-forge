import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  buildPoliticalIdRasterTile,
  encodePoliticalCoverage,
  referenceColorizePoliticalIdTile,
  splitPoliticalIdRasterTile,
} from "../js/core/renderer/political_id_raster_tile.js";

const sandbox = {};
vm.runInNewContext(readFileSync(new URL("../vendor/d3.v7.min.js", import.meta.url), "utf8"), sandbox);
const d3 = sandbox.d3;
const alpha = (...values) => Uint8Array.from(values);
const encode = (layers, width = 1, height = 1) => encodePoliticalCoverage({ width, height, layers });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
function contributions(tile, index = 0) {
  const code = tile.codes[index];
  if (!code) return new Map();
  if (!(code & 0x80000000)) return new Map([[code, 1]]);
  const offset = code & 0x7fffffff;
  return new Map(Array.from({ length: tile.edgeIds[offset] }, (_, i) => [
    tile.edgeIds[offset + i + 1], tile.edgeWeights[offset + i + 1],
  ]));
}
function palette(colors) {
  const result = new Uint8Array((colors.length + 1) * 4);
  colors.forEach((rgb, index) => result.set([...rgb, 255], (index + 1) * 4));
  return result;
}

test("partial masks preserve source-over coverage and transparent background", () => {
  const tile = encode([{ code: 1, alpha: alpha(128) }, { code: 2, alpha: alpha(64) }]);
  const weights = contributions(tile);
  close(weights.get(1), (128 / 255) * (1 - 64 / 255));
  close(weights.get(2), 64 / 255);
  assert.equal(tile.edgeIds[0], 2);
  assert.equal(tile.edgeWeights[0], 0);
  assert.equal(tile.edgeIds.length, tile.edgeWeights.length);
  assert.equal(tile.stats.edgePixelCount, 1);
  assert.equal(tile.stats.contributionCount, 2);
  assert.equal(tile.stats.maxContributors, 2);
  assert.equal(tile.stats.retainedBytes, 4 + 3 * 8);
  assert.equal(tile.stats.maskReadPixels, 2);
  assert.ok(Number.isFinite(tile.stats.buildMs) && tile.stats.buildMs >= 0);
});

test("opaque paint replaces prior edges, and a same-code opaque pixel stays direct", () => {
  const tile = encode([
    { code: 1, alpha: alpha(128, 255) },
    { code: 2, alpha: alpha(255, 0) },
    { code: 1, alpha: alpha(0, 100) },
  ], 2);
  assert.deepEqual([...tile.codes], [2, 1]);
  assert.equal(tile.edgeIds.length, 0);
  assert.equal(tile.stats.edgePixelCount, 0);
});

test("duplicate codes merge contributions without losing painter order", () => {
  const tile = encode([
    { code: 1, alpha: alpha(255) },
    { code: 2, alpha: alpha(128) },
    { code: 1, alpha: alpha(64) },
  ]);
  const weights = contributions(tile);
  assert.equal(weights.size, 2);
  close(weights.get(1), (1 - 128 / 255) * (1 - 64 / 255) + 64 / 255);
  close(weights.get(2), (128 / 255) * (1 - 64 / 255));
  const repeatedPartial = encode([{ code: 1, alpha: alpha(128) }, { code: 1, alpha: alpha(128) }]);
  assert.equal(contributions(repeatedPartial).size, 1);
  close(contributions(repeatedPartial).get(1), 1 - (1 - 128 / 255) ** 2);
});

test("transparent holes keep the earlier painter and empty pixels remain zero", () => {
  const tile = encode([
    { code: 1, alpha: alpha(255, 0, 255, 0) },
    { code: 2, alpha: alpha(0, 255, 128, 0) },
  ], 2, 2);
  assert.equal(tile.codes[0], 1);
  assert.equal(tile.codes[1], 2);
  assert.equal(tile.codes[3], 0);
  close(contributions(tile, 2).get(1), 1 - 128 / 255);
});

test("more than four overlapping IDs retain every contribution", () => {
  const tile = encode(Array.from({ length: 12 }, (_, i) => ({ code: i + 1, alpha: alpha(32) })));
  const weights = contributions(tile);
  assert.equal(weights.size, 12);
  assert.equal(tile.stats.maxContributors, 12);
  for (let i = 0; i < 12; i++) close(weights.get(i + 1), (32 / 255) * (1 - 32 / 255) ** (11 - i));
});

test("coverage does not mutate layers, alpha arrays, or feature data", () => {
  const bytes = alpha(0, 128, 255);
  const layers = Object.freeze([Object.freeze({ code: 7, alpha: bytes })]);
  encode(layers, 3);
  assert.deepEqual([...bytes], [0, 128, 255]);
  assert.equal(layers[0].code, 7);
});

test("reference colorization is premultiplied RGBA with opaque byte palette", () => {
  const tile = encode([
    { code: 1, alpha: alpha(128, 255, 0) },
    { code: 2, alpha: alpha(64, 0, 0) },
  ], 3);
  const output = referenceColorizePoliticalIdTile(tile, palette([[255, 0, 0], [0, 255, 0]]));
  assert.deepEqual([...output], [96, 64, 0, 160, 255, 0, 0, 255, 0, 0, 0, 0]);
  assert.throws(() => referenceColorizePoliticalIdTile(tile, new Uint8Array(12)), /opaque/);
  assert.throws(() => referenceColorizePoliticalIdTile(tile, new Map()), /flat byte/);
});

test("palette updates recolor retained IDs without geometry work or tile mutation", () => {
  const tile = encode([{ code: 1, alpha: alpha(128, 255) }], 2);
  const codes = tile.codes.slice(), ids = tile.edgeIds.slice(), weights = tile.edgeWeights.slice();
  const first = referenceColorizePoliticalIdTile(tile, palette([[255, 0, 0]]));
  const second = referenceColorizePoliticalIdTile(tile, palette([[0, 0, 255]]));
  assert.deepEqual([...first], [128, 0, 0, 128, 255, 0, 0, 255]);
  assert.deepEqual([...second], [0, 0, 128, 128, 0, 0, 255, 255]);
  assert.deepEqual(tile.codes, codes);
  assert.deepEqual(tile.edgeIds, ids);
  assert.deepEqual(tile.edgeWeights, weights);
});

test("codes, mask sizes, integer origins, and 32-bit dimensions reject invalid input", () => {
  for (const code of [0, -1, 0x80000000, 1.5]) {
    assert.throws(() => encode([{ code, alpha: alpha(255) }]), /palette code/);
  }
  const tile = encode([{ code: 0x7fffffff, alpha: alpha(255) }]);
  assert.equal(tile.codes[0], 0x7fffffff);
  assert.throws(() => encode([{ code: 1, alpha: alpha(255, 255) }]), /one value per pixel/);
  assert.throws(() => encodePoliticalCoverage({ width: 65536, height: 65536, layers: [] }), /32-bit/);
  assert.throws(() => encodePoliticalCoverage({ width: 1, height: 1, originX: 0.5, layers: [] }), /invalid/);
});

test("pure coverage supports cancellation before and during a long mask", () => {
  assert.throws(() => encodePoliticalCoverage({ width: 1, height: 1, layers: [], isCancelled: () => true }), { name: "AbortError" });
  let checks = 0;
  assert.throws(() => encodePoliticalCoverage({
    width: 65537, height: 1,
    layers: [{ code: 1, alpha: new Uint8Array(65537).fill(128) }],
    isCancelled: () => ++checks >= 4,
  }), { name: "AbortError" });
  assert.equal(checks, 4);
});

class RecordingPath {
  commands = [];
  moveTo(...args) { this.commands.push(["moveTo", ...args]); }
  lineTo(...args) { this.commands.push(["lineTo", ...args]); }
  closePath(...args) { this.commands.push(["closePath", ...args]); }
  arc(...args) { this.commands.push(["arc", ...args]); }
}
function maskHarness(sample = () => 0) {
  const paths = [], reads = [], clears = [], transforms = [], draws = [];
  let canvas, transform, currentDraws = [];
  const context = {
    setTransform(...args) { transform = args; transforms.push(args); },
    clearRect(...args) { clears.push({ args, transform }); currentDraws = []; },
    fill(path) { draws.push({ kind: "fill", path, transform }); currentDraws.push("fill"); },
    stroke(path) { draws.push({ kind: "stroke", path, transform }); currentDraws.push("stroke"); },
    getImageData(x, y, width, height) {
      reads.push([x, y, width, height]);
      const data = new Uint8ClampedArray(width * height * 4);
      for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
        // Arbitrary RGB makes accidental RGB-based ID decoding observable.
        data.set([11, 97, 203, sample(x + col, y + row, currentDraws)], (row * width + col) * 4);
      }
      return { data };
    },
  };
  return {
    paths, reads, clears, transforms, draws, context,
    get canvas() { return canvas; },
    createCanvas(width, height) {
      canvas = { width, height, getContext: () => context, originalSize: [width, height] };
      return canvas;
    },
    createPath() { const path = new RecordingPath(); paths.push(path); return path; },
  };
}
const feature = Object.freeze({ type: "Point", coordinates: Object.freeze([0, 0]) });
const bounds = Object.freeze({ minX: 103, minY: 204, maxX: 104, maxY: 205 });

test("whole-tile mask uses integer origin, bounded ROI, white fill and round stroke", async () => {
  const harness = maskHarness((x, y) => x === 3 && y === 4 ? 128 : 0);
  const tile = await buildPoliticalIdRasterTile({
    entries: [{ code: 13, feature, bounds }], projection: d3.geoIdentity(),
    width: 20, height: 20, originX: 100, originY: 200, d3, ...harness,
  });
  assert.deepEqual(harness.canvas.originalSize, [20, 20]);
  assert.deepEqual(harness.reads, [[0, 1, 7, 7]]);
  assert.deepEqual(harness.clears[0], { args: [0, 1, 7, 7], transform: [1, 0, 0, 1, 0, 0] });
  assert.deepEqual(harness.draws.map(({ kind }) => kind), ["fill", "stroke"]);
  assert.ok(harness.draws.every(({ transform }) => assert.deepEqual(transform, [1, 0, 0, 1, -100, -200]) === undefined));
  assert.equal(harness.context.fillStyle, "#ffffff");
  assert.equal(harness.context.strokeStyle, "#ffffff");
  assert.equal(harness.context.lineWidth, 0.75);
  assert.equal(harness.context.lineJoin, "round");
  assert.equal(harness.context.lineCap, "round");
  close(contributions(tile, 4 * 20 + 3).get(13), 128 / 255);
  assert.equal(tile.stats.maskReadPixels, 49);
  assert.equal(tile.stats.strokeWidth, 0.75);
  assert.equal(tile.stats.originX, 100);
  assert.equal(tile.stats.originY, 200);
  assert.equal(harness.canvas.width, 0);
  assert.equal(harness.canvas.height, 0);
  assert.deepEqual(feature.coordinates, [0, 0]);
});

test("D3 uses complete projection stream for clipping, resampling, seams, and holes", async () => {
  const actualProjection = d3.geoEqualEarth().scale(80).translate([200, 100]).precision(0.05).clipExtent([[0, 0], [400, 200]]);
  let streamCalls = 0;
  function projection() { throw new Error("Vertex-only projection is forbidden"); }
  projection.stream = (stream) => { streamCalls++; return actualProjection.stream(stream); };
  const polygon = { type: "Polygon", coordinates: [
    [[170, -30], [170, 30], [-170, 30], [-170, -30], [170, -30]],
    [[175, -10], [-175, -10], [-175, 10], [175, 10], [175, -10]],
  ] };
  const expected = new RecordingPath();
  d3.geoPath(actualProjection).context(expected)(polygon);
  const harness = maskHarness();
  await buildPoliticalIdRasterTile({
    entries: [{ code: 1, feature: polygon, bounds: { minX: 0, minY: 0, maxX: 400, maxY: 200 } }],
    projection, width: 400, height: 200, d3, ...harness, yieldTask: async () => {},
  });
  assert.equal(streamCalls, 1);
  assert.deepEqual(harness.paths[0].commands, expected.commands);
  assert.ok(expected.commands.length > 10, "seam clipping and adaptive resampling emit more than input vertices");
  assert.ok(expected.commands.filter(([op]) => op === "closePath").length >= 2);
});

test("different strokeCode produces ordered fill and stroke coverage masks", async () => {
  const harness = maskHarness((x, y, draws) => x === 3 && y === 4 ? draws.includes("stroke") ? 128 : 255 : 0);
  const tile = await buildPoliticalIdRasterTile({
    entries: [{ code: 1, strokeCode: 2, feature, bounds }],
    projection: d3.geoIdentity(), width: 12, height: 12, originX: 100, originY: 200, d3, ...harness,
  });
  assert.equal(harness.paths.length, 1);
  assert.equal(harness.reads.length, 2);
  assert.equal(harness.clears.length, 2);
  const weights = contributions(tile, 4 * 12 + 3);
  close(weights.get(1), 1 - 128 / 255);
  close(weights.get(2), 128 / 255);
  assert.equal(tile.stats.maskReadPixels, 98);
});

test("off-tile geometry is skipped and zero stroke width only fills", async () => {
  const harness = maskHarness(() => 255);
  const tile = await buildPoliticalIdRasterTile({
    entries: [
      { code: 2, feature, bounds: { minX: -100, minY: -100, maxX: -90, maxY: -90 } },
      { code: 3, feature, bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 } },
    ], projection: d3.geoIdentity(), width: 3, height: 3, strokeWidth: 0, d3, ...harness,
  });
  assert.deepEqual(harness.draws.map(({ kind }) => kind), ["fill"]);
  assert.deepEqual(harness.reads, [[0, 0, 3, 3]]);
  assert.deepEqual([...tile.codes], Array(9).fill(3));
});

test("strokeCode zero omits transparent TNO stroke without recording code zero", async () => {
  const harness = maskHarness(() => 128);
  const tile = await buildPoliticalIdRasterTile({
    entries: [{ code: 1, strokeCode: 0, feature, bounds }],
    projection: d3.geoIdentity(), width: 12, height: 12, originX: 100, originY: 200, d3, ...harness,
  });
  assert.deepEqual(harness.draws.map(({ kind }) => kind), ["fill"]);
  assert.equal(harness.reads.length, 1);
  assert.deepEqual(harness.reads[0], [1, 2, 5, 5]);
  assert.deepEqual([...contributions(tile, 4 * 12 + 3).keys()], [1]);
});

test("long raster loops yield, cancellation aborts, and mask canvas is released", async () => {
  const harness = maskHarness(() => 128);
  let cancelled = false, yields = 0;
  await assert.rejects(buildPoliticalIdRasterTile({
    entries: [{ code: 1, feature, bounds: { minX: 0, minY: 0, maxX: 256, maxY: 300 } }],
    projection: d3.geoIdentity(), width: 256, height: 300, d3, ...harness,
    isCancelled: () => cancelled,
    yieldTask: async () => { yields++; cancelled = true; },
  }), { name: "AbortError" });
  assert.equal(yields, 1);
  assert.equal(harness.canvas.width, 0);
  assert.equal(harness.canvas.height, 0);
});

test("failed path construction releases the mask canvas", async () => {
  const harness = maskHarness();
  await assert.rejects(buildPoliticalIdRasterTile({
    entries: [{ code: 1, feature, bounds }], projection: d3.geoIdentity(),
    width: 4, height: 4, originX: 100, originY: 200, d3, ...harness,
    createPath: () => { throw new Error("path failure"); },
  }), /path failure/);
  assert.equal(harness.canvas.width, 0);
  assert.equal(harness.canvas.height, 0);
});

test("projected-path and cache hooks reuse geometry while applying current paint codes and stroke", async () => {
  const cached = new Map();
  let builds = 0;
  const make = async (code, strokeCode) => {
    const harness = maskHarness(() => 128);
    const tile = await buildPoliticalIdRasterTile({
      entries: [{ id: "geometry", code, strokeCode, feature, bounds }],
      projection: d3.geoIdentity(), width: 12, height: 12, originX: 100, originY: 200,
      d3, ...harness,
      createProjectedPath: (entry) => {
        builds++;
        const path = new RecordingPath();
        d3.geoPath(d3.geoIdentity()).context(path)(entry.feature);
        return path;
      },
      getCachedPath: (entry, buildPath) => {
        if (!cached.has(entry.id)) cached.set(entry.id, buildPath());
        return cached.get(entry.id);
      },
    });
    return { tile, harness };
  };
  const first = await make(1, 1), second = await make(2, 3);
  assert.equal(builds, 1);
  assert.equal(first.tile.stats.pathBuilds, 1);
  assert.equal(first.tile.stats.pathCacheHits, 0);
  assert.equal(second.tile.stats.pathBuilds, 0);
  assert.equal(second.tile.stats.pathCacheHits, 1);
  assert.equal(second.harness.draws[0].path, first.harness.draws[0].path);
  assert.deepEqual([...contributions(second.tile, 4 * 12 + 3).keys()], [2, 3]);
});

test("gutters enlarge mask dimensions and crop origin while preserving every edge contributor", async () => {
  const width = 5, height = 3, originX = -8, originY = 13;
  const layers = Array.from({ length: 9 }, (_, index) => ({
    code: index + 1,
    alpha: Uint8Array.from({ length: width * height }, (_, pixel) => (pixel * 29 + index * 17) % 254 + 1),
  }));
  const expected = encodePoliticalCoverage({ width, height, originX, originY, layers });
  for (const gutter of [0, 1, 2, 4]) {
    let layer = -1;
    const harness = maskHarness((x, y) => {
      x -= gutter; y -= gutter;
      return x >= 0 && x < width && y >= 0 && y < height ? layers[layer].alpha[y * width + x] : 128;
    });
    const originalFill = harness.context.fill;
    harness.context.fill = (path) => { layer++; originalFill(path); };
    const tile = await buildPoliticalIdRasterTile({
      entries: layers.map(({ code }) => ({ code, feature,
        bounds: { minX: originX - 4, minY: originY - 4, maxX: originX + width + 4, maxY: originY + height + 4 } })),
      projection: d3.geoIdentity(), width, height, originX, originY, gutter, strokeWidth: 0, d3, ...harness,
    });
    assert.deepEqual([tile.width, tile.height, tile.originX, tile.originY], [width, height, originX, originY]);
    assert.deepEqual(harness.canvas.originalSize, [width + 2 * gutter, height + 2 * gutter]);
    assert.deepEqual(harness.draws[0].transform, [1, 0, 0, 1, -originX + gutter, -originY + gutter]);
    assert.deepEqual(tile.codes, expected.codes);
    assert.deepEqual(tile.edgeIds, expected.edgeIds);
    assert.deepEqual(tile.edgeWeights, expected.edgeWeights);
    assert.equal(tile.stats.maxContributors, 9);
    assert.equal(tile.stats.maskReadPixels, 9 * (width + 2 * gutter) * (height + 2 * gutter));
    assert.equal(tile.stats.retainedBytes, expected.stats.retainedBytes);
    assert.equal(tile.stats.gutter, gutter);
  }
});

test("gutter defaults to zero and rejects unsupported sizes before allocating", async () => {
  const harness = maskHarness();
  const input = { entries: [], projection: d3.geoIdentity(), width: 2, height: 3, d3, ...harness };
  const defaultTile = await buildPoliticalIdRasterTile(input);
  assert.equal(defaultTile.stats.gutter, 0);
  assert.deepEqual(harness.canvas.originalSize, [2, 3]);
  for (const gutter of [-1, 3, 0.5, "1", NaN]) {
    await assert.rejects(buildPoliticalIdRasterTile({ ...input, gutter }), /gutter/);
  }
});

function assertSplitMatchesParent(parent, children, colors) {
  const parentRgba = referenceColorizePoliticalIdTile(parent, colors);
  let pixelCount = 0;
  for (const child of children) {
    const rgba = referenceColorizePoliticalIdTile(child, colors);
    const left = child.originX - parent.originX;
    const top = child.originY - parent.originY;
    for (let row = 0; row < child.height; row++) {
      const parentOffset = ((top + row) * parent.width + left) * 4;
      assert.deepEqual(rgba.subarray(row * child.width * 4, (row + 1) * child.width * 4),
        parentRgba.subarray(parentOffset, parentOffset + child.width * 4));
      for (let col = 0; col < child.width; col++) {
        const childIndex = row * child.width + col;
        const parentIndex = (top + row) * parent.width + left + col;
        assert.deepEqual(contributions(child, childIndex), contributions(parent, parentIndex));
      }
    }
    assert.equal(child.stats.maskReadPixels, 0);
    assert.equal(child.stats.retainedBytes, child.codes.byteLength + child.edgeIds.byteLength + child.edgeWeights.byteLength);
    assert.equal(child.edgeIds.length, child.edgeWeights.length);
    pixelCount += child.width * child.height;
  }
  assert.equal(pixelCount, parent.width * parent.height);
}

test("region split preserves blank and opaque tiles including right/bottom small blocks", () => {
  for (const layers of [[], [{ code: 1, alpha: new Uint8Array(20).fill(255) }]]) {
    const parent = encodePoliticalCoverage({ width: 5, height: 4, originX: -300, originY: -20, layers });
    parent.stats.strokeWidth = 1.5;
    const children = splitPoliticalIdRasterTile(parent, { tileSize: 3 });
    assert.deepEqual(children.map((child) => [child.width, child.height, child.originX, child.originY]), [
      [3, 3, -300, -20], [2, 3, -297, -20], [3, 1, -300, -17], [2, 1, -297, -17],
    ]);
    assertSplitMatchesParent(parent, children, palette([[121, 50, 207]]));
    for (const child of children) {
      assert.equal(child.stats.strokeWidth, 1.5);
      assert.equal(child.stats.edgePixelCount, 0);
      assert.equal(child.stats.contributionCount, 0);
      assert.equal(child.stats.retainedBytes, child.width * child.height * 4);
    }
  }
});

test("region split remaps spans and preserves every Float32 contributor byte and oracle pixel", () => {
  const layers = Array.from({ length: 9 }, (_, layer) => ({
    code: layer + 1,
    alpha: Uint8Array.from({ length: 35 }, (_, pixel) => pixel === 0 ? 0 : pixel === 1 ? 255
      : (pixel + layer) % 7 === 0 ? 0 : (pixel * 19 + layer * 31) % 254 + 1),
  }));
  const parent = encodePoliticalCoverage({ width: 7, height: 5, originX: -3, originY: 10, layers });
  const originalCodes = parent.codes.slice(), originalIds = parent.edgeIds.slice(), originalWeights = parent.edgeWeights.slice();
  const children = splitPoliticalIdRasterTile(parent, { tileSize: 3 });
  const colors = palette(Array.from({ length: 9 }, (_, i) => [i * 29 % 256, i * 67 % 256, i * 101 % 256]));
  assertSplitMatchesParent(parent, children, colors);
  assert.ok(children.some((child) => child.stats.maxContributors > 4));
  assert.equal(children.reduce((sum, child) => sum + child.stats.edgePixelCount, 0), parent.stats.edgePixelCount);
  assert.equal(children.reduce((sum, child) => sum + child.stats.contributionCount, 0), parent.stats.contributionCount);
  assert.equal(children.reduce((sum, child) => sum + child.stats.retainedBytes, 0), parent.stats.retainedBytes);
  assert.deepEqual(parent.codes, originalCodes);
  assert.deepEqual(parent.edgeIds, originalIds);
  assert.deepEqual(parent.edgeWeights, originalWeights);
  for (const child of children) {
    for (let index = 0; index < child.codes.length; index++) {
      if (!(child.codes[index] & 0x80000000)) continue;
      const parentIndex = (child.originY - parent.originY + Math.floor(index / child.width)) * parent.width
        + child.originX - parent.originX + index % child.width;
      const parentOffset = parent.codes[parentIndex] & 0x7fffffff;
      const childOffset = child.codes[index] & 0x7fffffff;
      const spanLength = child.edgeIds[childOffset] + 1;
      assert.deepEqual(new Uint8Array(child.edgeWeights.buffer, childOffset * 4, spanLength * 4),
        new Uint8Array(parent.edgeWeights.buffer, parentOffset * 4, spanLength * 4));
    }
  }
  children[0].codes[0] = 77;
  assert.equal(parent.codes[0], 0, "child storage is detached from its parent");
});

test("default region split uses 256px tiles and large tile size returns a detached copy", () => {
  const parent = encode([], 257, 1);
  assert.deepEqual(splitPoliticalIdRasterTile(parent).map((child) => child.width), [256, 1]);
  const [copy] = splitPoliticalIdRasterTile(parent, { tileSize: 1024 });
  assert.equal(copy.width, 257);
  assert.notEqual(copy.codes, parent.codes);
  assert.equal(copy.stats.maskReadPixels, 0);
});

test("region split rejects invalid sizes, dimensions, storage, spans, and weights", () => {
  const parent = encode([{ code: 1, alpha: alpha(128) }]);
  for (const tileSize of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => splitPoliticalIdRasterTile(parent, { tileSize }), /positive integer/);
  }
  assert.throws(() => splitPoliticalIdRasterTile(null), /requires Uint32/);
  assert.throws(() => splitPoliticalIdRasterTile({ ...parent, width: 0 }), /dimensions/);
  assert.throws(() => splitPoliticalIdRasterTile({ ...parent, originX: 0.5 }), /dimensions/);
  assert.throws(() => splitPoliticalIdRasterTile({ ...parent, codes: new Uint32Array(2) }), /lengths/);
  assert.throws(() => splitPoliticalIdRasterTile({ ...parent, edgeWeights: new Float32Array(1) }), /lengths/);
  assert.throws(() => splitPoliticalIdRasterTile({ ...parent, codes: Uint32Array.of(0x8000000a) }), /edge span/);
  assert.throws(() => splitPoliticalIdRasterTile({ ...parent, edgeIds: Uint32Array.of(2, 1) }), /edge span/);
  assert.throws(() => splitPoliticalIdRasterTile({ ...parent, edgeIds: Uint32Array.of(1, 0) }), /palette code/);
  assert.throws(() => splitPoliticalIdRasterTile({ ...parent, edgeWeights: Float32Array.of(0, -0.5) }), /edge weight/);
});
