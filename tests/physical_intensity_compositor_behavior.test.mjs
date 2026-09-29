import test from "node:test";
import assert from "node:assert/strict";
import { multiplyPhysicalAlpha, createPhysicalIntensityCompositor, getPhysicalIntensityBounds } from "../js/core/renderer/physical_intensity_compositor.js";
import { INTENSITY_FIELD_GRID, sampleIntensityField } from "../js/core/intensity_field.js";

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
test("cached coordinates resample a live field before its revision is committed", () => {
  let inversions = 0;
  const coordinates = new Float32Array(2).fill(Infinity);
  const projection = { invert: (point) => { inversions += 1; return point; } };
  for (const value of [0, 1, 2]) {
    const image = { width: 1, height: 1, data: new Uint8ClampedArray([1, 2, 3, 100]) };
    multiplyPhysicalAlpha(image, { projection, matrix: identity, coordinates, sample: () => value });
    assert.equal(image.data[3], value * 100);
  }
  assert.equal(inversions, 1);
});
test("disabled and neutral channels keep the original draw and blend without a scratch surface", () => {
  const state = { intensityFields: { channels: { physicalAtlas: { enabled: true, grid: { composite: new Float32Array([1, 1]) } } } } };
  const paint = createPhysicalIntensityCompositor({ state, createCanvas: () => assert.fail("neutral fields must not allocate") });
  assert.equal(paint("physicalAtlas", "multiply", (blend) => blend), "multiply");
  assert.equal(paint("physicalContour", "overlay", (blend) => blend), "overlay");
});

test("live support bounds skip neutral samples and follow uncommitted grid changes", () => {
  const values = new Float32Array(720 * 360).fill(1);
  assert.equal(getPhysicalIntensityBounds(values), null);
  values[88 * 720 + 380] = 0;
  assert.deepEqual(getPhysicalIntensityBounds(values), [9.5, 45.5, 10.5, 46.5]);
  let samples = 0;
  const image = { width: 3, height: 1, data: new Uint8ClampedArray(12).fill(100) };
  multiplyPhysicalAlpha(image, { projection: { invert: () => [0, 0] }, matrix: identity,
    bounds: getPhysicalIntensityBounds(values), sample: () => { samples++; return 1; } });
  assert.equal(samples, 0);
  values.fill(1);
  values[90 * 720 + 400] = 2;
  assert.deepEqual(getPhysicalIntensityBounds(values), [19.5, 44.5, 20.5, 45.5]);
});

test("support bounds preserve bilinear pixels at seams, poles and grid edges", () => {
  const { columns, rows } = INTENSITY_FIELD_GRID;
  for (const [column, row] of [[380,88],[0,180],[719,180],[360,0],[360,359]]) {
    const values = new Float32Array(columns * rows).fill(1);
    values[row * columns + column] = 0;
    const fields = { channels: { physicalAtlas: { enabled:true, grid:{composite:values} } } };
    const positions = [];
    for (const center of [-180 + column / 2, -180, 180]) {
      for(let dx=-1.1;dx<=1.1;dx+=.05) for(let dy=-1.1;dy<=1.1;dy+=.05) {
        positions.push([center+dx,90-row/2+dy]);
      }
    }
    const makeImage = () => ({width:positions.length,height:1,data:new Uint8ClampedArray(positions.length*4).fill(211)});
    const original=makeImage(), bounded=makeImage();
    const options = {matrix:identity,projection:{invert:([x])=>positions[Math.floor(x)]},
      sample:(lon,lat)=>sampleIntensityField(fields,'physicalAtlas',lon,lat)};
    multiplyPhysicalAlpha(original,options);
    multiplyPhysicalAlpha(bounded,{...options,bounds:getPhysicalIntensityBounds(values)});
    assert.deepEqual(bounded.data,original.data,`cell ${column},${row}`);
  }
});
