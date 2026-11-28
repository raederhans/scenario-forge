import test from "node:test";
import assert from "node:assert/strict";
import { multiplyPhysicalAlpha, getPhysicalIntensityBounds } from "../js/core/renderer/physical_intensity_compositor.js";
import { INTENSITY_FIELD_GRID } from "../js/core/intensity_field.js";

const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
test("a single feature is suppressed, unchanged and enhanced in different painted locations", () => {
  const image = { width: 3, height: 1, data: new Uint8ClampedArray([20, 40, 60, 100, 20, 40, 60, 100, 20, 40, 60, 100]) };
  multiplyPhysicalAlpha(image, { projection: { invert: (point) => point }, matrix: identity, sample: (lon) => Math.floor(lon) });
  assert.deepEqual([...image.data], [20, 40, 60, 0, 20, 40, 60, 100, 20, 40, 60, 200]);
});
test("DPR, pan, zoom and export transforms map back to the same geographical location", () => {
  let sampled;
  const image = { width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 200]) };
  multiplyPhysicalAlpha(image, {
    projection: { invert: ([x, y]) => [x + 10, y + 20] },
    matrix: { a: 2, b: 0, c: 0, d: 2, e: -3.5, f: -5.5 },
    sample: (...point) => { sampled = point; return 2; },
  });
  assert.deepEqual(sampled, [12, 23]);
  assert.equal(image.data[3], 255);
});

const channelId = "physicalAtlas";
const { columns, rows } = INTENSITY_FIELD_GRID;

function field(first, last = first, left = 100, right = 620) {
  const values = new Float32Array(columns * rows).fill(1);
  for (let row = first; row <= last; row++) {
    for (let column = left; column <= right; column++) values[row * columns + column] = 0;
  }
  return { channels: { [channelId]: { enabled: true, revision: 0, grid: { composite: values } } } };
}

test("date-line bounds include both sides of the seam", () => {
  const seam = field(174, 186, 0, 0);
  assert.deepEqual(getPhysicalIntensityBounds(seam.channels[channelId].grid.composite).filter((_, i) => i % 2 === 0), [-Infinity, Infinity]);
});
