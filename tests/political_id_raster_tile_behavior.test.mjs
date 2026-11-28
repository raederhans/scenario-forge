import test from "node:test";
import assert from "node:assert/strict";
import { encodePoliticalCoverage, referenceColorizePoliticalIdTile, splitPoliticalIdRasterTile } from "../js/core/renderer/political_id_raster_tile.js";

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
});

test("reference colorization is premultiplied RGBA with opaque byte palette", () => {
  const tile = encode([
    { code: 1, alpha: alpha(128, 255, 0) },
    { code: 2, alpha: alpha(64, 0, 0) },
  ], 3);
  const output = referenceColorizePoliticalIdTile(tile, palette([[255, 0, 0], [0, 255, 0]]));
  assert.deepEqual([...output], [96, 64, 0, 160, 255, 0, 0, 255, 0, 0, 0, 0]);
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

test("region split rejects invalid offsets", () => {
  const parent = encode([{ code: 1, alpha: alpha(128) }]);
  assert.throws(() => splitPoliticalIdRasterTile({ ...parent, originX: 0.5 }), /dimensions/);
  assert.throws(() => splitPoliticalIdRasterTile({ ...parent, codes: Uint32Array.of(0x8000000a) }), /edge span/);
});
