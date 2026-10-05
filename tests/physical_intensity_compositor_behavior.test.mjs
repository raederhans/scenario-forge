import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { multiplyPhysicalAlpha, createPhysicalIntensityCompositor, getPhysicalIntensityBounds, getEqualEarthIntensityRowBounds } from "../js/core/renderer/physical_intensity_compositor.js";
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

function createCompositorHarness({ width = 2, height = 1, position = [10, 46] } = {}) {
  const calls = { reads: 0, clips: 0, writes: 0, draws: [] };
  const values = new Float32Array(720 * 360).fill(1);
  values[88 * 720 + 380] = 0;
  const state = { intensityFields: { channels: { physicalAtlas: { enabled: true, grid: { composite: values } } } } };
  const target = {
    canvas: { width, height }, getTransform: () => identity,
    save() {}, restore() {}, resetTransform() {}, setTransform() {}, beginPath() {}, rect() {},
    clip() { calls.clips++; }, drawImage() {},
  };
  const scratch = {
    resetTransform() {}, clearRect() {}, setTransform() {},
    getImageData() { calls.reads++; return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(100) }; },
    putImageData() { calls.writes++; },
  };
  const canvas = { width: 0, height: 0, getContext: () => scratch };
  const paint = createPhysicalIntensityCompositor({
    state, getContext: () => target, getProjection: () => ({ invert: () => position }),
    getProjectionKey: () => "fixed", withRenderTarget: (_context, draw) => draw(), createCanvas: () => canvas,
  });
  return { calls, canvas, paint, draw: (result) => (blend) => { calls.draws.push(blend); return result; } };
}

test("empty physical draws skip pixel readback and replay, and release large scratch surfaces", () => {
  for (const size of [[2, 1], [2001, 1000]]) {
    const h = createCompositorHarness({ width: size[0], height: size[1] });
    assert.equal(h.paint("physicalAtlas", "multiply", h.draw(0)), 0);
    assert.deepEqual(h.calls, { reads: 0, clips: 0, writes: 0, draws: ["source-over"] });
    if (size[0] * size[1] > 2_000_000) assert.equal(h.canvas.width * h.canvas.height, 1);
  }
});

test("a field outside the painted pixels replays native blend without building an empty clip", () => {
  const h = createCompositorHarness({ position: [0, 0] });
  assert.equal(h.paint("physicalAtlas", "overlay", h.draw(1)), 1);
  assert.deepEqual(h.calls, { reads: 1, clips: 0, writes: 0, draws: ["source-over", "overlay"] });
});

test("nonempty spatial edits retain scratch modulation and native per-feature replay", () => {
  const h = createCompositorHarness();
  assert.equal(h.paint("physicalAtlas", "multiply", h.draw(1)), 1);
  assert.deepEqual(h.calls, { reads: 1, clips: 2, writes: 1, draws: ["source-over", "multiply"] });
});

const d3 = createRequire(import.meta.url)("../vendor/d3.v7.min.js");
const channelId = "physicalAtlas";
const { columns, rows } = INTENSITY_FIELD_GRID;

function field(first, last = first, left = 100, right = 620) {
  const values = new Float32Array(columns * rows).fill(1);
  for (let row = first; row <= last; row++) {
    for (let column = left; column <= right; column++) values[row * columns + column] = 0;
  }
  return { channels: { [channelId]: { enabled: true, revision: 0, grid: { composite: values } } } };
}

function inversePoint(projection, matrix, x, y) {
  const { a, b, c, d, e, f } = matrix;
  const determinant = a * d - b * c;
  return projection.invert([(d * (x - e) - c * (y - f)) / determinant,
    (a * (y - f) - b * (x - e)) / determinant]);
}

function imageFixture(projection, matrix, width, height, sphereOnly = true) {
  const image = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const point = inversePoint(projection, matrix, x + 0.5, y + 0.5);
      let visible = !sphereOnly;
      if (point?.every(Number.isFinite) && Math.abs(point[1]) <= 90) {
        const projected = projection(point);
        const px = matrix.a * projected[0] + matrix.c * projected[1] + matrix.e;
        const py = matrix.b * projected[0] + matrix.d * projected[1] + matrix.f;
        // A round trip excludes the undefined inverse region outside Sphere.
        visible ||= Math.hypot(px - x - 0.5, py - y - 0.5) < 1e-6;
      }
      image.data.set([20 + x % 37, 40 + y % 29, 60, visible ? 160 : 0], (y * width + x) * 4);
    }
  }
  return image;
}

function clone(image) { return { ...image, data: image.data.slice() }; }
function sliceRows(image, first, last) {
  return { width: image.width, height: last - first,
    data: image.data.slice(first * image.width * 4, last * image.width * 4) };
}

function compareCrop({ projection, matrix = identity, fields, width = 240, height = 180, sphereOnly = true }) {
  const fixture = imageFixture(projection, matrix, width, height, sphereOnly);
  const bounds = getPhysicalIntensityBounds(fields.channels[channelId].grid.composite);
  const rowBounds = getEqualEarthIntensityRowBounds({ projection, matrix, bounds, height });
  const [first, last] = rowBounds || [0, height];
  const options = { projection, matrix, bounds,
    sample: (lon, lat) => sampleIntensityField(fields, channelId, lon, lat) };
  const fullCoordinates = new Float64Array(width * height * 2).fill(Infinity);
  const cropCoordinates = new Float64Array(width * (last - first) * 2).fill(Infinity);
  let changed = 0;
  let runs = [];
  for (let frame = 0; frame < 2; frame++) {
    const full = clone(fixture);
    const cropped = sliceRows(fixture, first, last);
    const fullRuns = multiplyPhysicalAlpha(full, { ...options, coordinates: fullCoordinates });
    const cropRuns = multiplyPhysicalAlpha(cropped, { ...options, coordinates: cropCoordinates, offsetY: first });
    const assembled = clone(fixture);
    assembled.data.set(cropped.data, first * width * 4);
    assert.deepEqual(assembled.data, full.data, `RGBA frame ${frame}`);
    assert.deepEqual(cropRuns, fullRuns, `global row runs frame ${frame}`);
    changed = fullRuns.length;
    runs = fullRuns;
  }
  return { rowBounds, changed, runs };
}

test("Equal Earth latitude cropping preserves cold/warm pixels and runs under screen and export transforms", () => {
  const cases = [
    ["north", identity, p => p, field(100, 116)],
    ["south", identity, p => p, field(244, 260)],
    ["equator", identity, p => p, field(174, 186)],
    ["DPR", { ...identity, a: 2, d: 2, e: -120, f: -90 }, p => p, field(100, 116)],
    ["pan/zoom", { ...identity, a: 1.4, d: 1.4, e: -48, f: -30 }, p => p, field(174, 186)],
    ["export", { ...identity, a: 0.75, d: 1.2, e: 20, f: -12 }, p => p, field(244, 260)],
    ["canvas reflection", { ...identity, a: -1, d: -1, e: 240, f: 180 }, p => p, field(100, 116)],
    ["projection reflection", identity, p => p.reflectX(true).reflectY(true), field(244, 260)],
    ["center/longitude rotation", identity, p => p.center([15, 10]).rotate([40, 0, 0]), field(174, 186)],
  ];
  for (const [name, matrix, configure, fields] of cases) {
    const projection = configure(d3.geoEqualEarth().scale(55).translate([120, 90]));
    const { rowBounds, changed } = compareCrop({ projection, matrix, fields });
    assert.ok(rowBounds && rowBounds[1] - rowBounds[0] < 180, `${name} crops rows`);
    assert.ok(changed > 0, `${name} affects visible pixels`);
  }
});

test("date-line wrapping keeps both sides and poles retain the complete fallback", () => {
  // Put the geographic date line inside the view, with enough scale to resolve
  // the half-degree interpolation footprint on each side of column zero.
  const projection = d3.geoEqualEarth().scale(150).translate([120.5, 90]).rotate([180, 0, 0]);
  const seam = field(174, 186, 0, 0);
  const result = compareCrop({ projection, fields: seam });
  assert.ok(result.changed > 0);
  assert.ok(result.runs.some(([x]) => x < 120), "the +180 side is sampled");
  assert.ok(result.runs.some(([x, , length]) => x + length > 121), "the -180 side is sampled");
  assert.deepEqual(getPhysicalIntensityBounds(seam.channels[channelId].grid.composite).filter((_, i) => i % 2 === 0), [-Infinity, Infinity]);
  for (const fields of [field(0, 2), field(rows - 3, rows - 1)]) {
    assert.equal(compareCrop({ projection, fields }).rowBounds, null);
  }
});

test("latitude rotation, roll, angle and affine tilt preserve full sampling fallback", () => {
  const cases = [
    [p => p.rotate([20, 5, 0]), identity],
    [p => p.rotate([20, 0, 5]), identity],
    [p => p.angle(12), identity],
    [p => p, { ...identity, b: 0.1 }],
    [p => p, { ...identity, c: -0.2 }],
    [p => p, { ...identity, a: 0 }],
  ];
  for (const [configure, matrix] of cases) {
    const projection = configure(d3.geoEqualEarth().scale(55).translate([120, 90]));
    assert.equal(getEqualEarthIntensityRowBounds({ projection, matrix, bounds: [-20, -5, 20, 5], height: 180 }), null);
    if (matrix.a !== 0) compareCrop({ projection, matrix, fields: field(174, 186) });
  }
});

test("far translated inverse foldbacks cannot be omitted even with alpha beyond Sphere", () => {
  const projection = d3.geoEqualEarth().scale(10).translate([0, -100]);
  const height = 60;
  let foldedRow = -1;
  let gridRow;
  for (let y = 0; y < height; y++) {
    const lat = projection.invert([0.5, y + 0.5])?.[1];
    if (Number.isFinite(lat) && Math.abs(lat) < 85) {
      foldedRow = y;
      gridRow = Math.floor((90 - lat) * 2);
      break;
    }
  }
  assert.ok(foldedRow >= 0, "fixture reaches a finite inverse latitude far outside the projected Sphere");
  const result = compareCrop({ projection, fields: field(gridRow, gridRow, 1, 719), width: 20, height, sphereOnly: false });
  assert.ok(result.changed > 0, "foldback fixture actually modulates alpha");
  assert.ok(result.rowBounds[0] <= foldedRow && result.rowBounds[1] > foldedRow);
});

function compositorHarness({ projection, fields, width = 240, height = 180, matrix = identity, sphereOnly = true }) {
  const calls = { reads: [], writes: [], draws: [], clips: [], pixelInversions: [] };
  let projectionKey = "initial";
  let inversions = 0;
  let readStart = 0;
  const invert = projection.invert;
  projection.invert = point => { inversions++; return invert(point); };
  let fixture;
  let output;
  let path = [];
  const target = {
    canvas: { width, height }, getTransform: () => matrix,
    save() {}, restore() {}, resetTransform() {}, setTransform() {}, drawImage() {},
    beginPath() { path = []; }, rect(...args) { path.push(args); },
    clip(rule) { calls.clips.push({ rule, path: path.map(rect => [...rect]) }); },
  };
  const scratch = {
    resetTransform() {}, clearRect() {}, setTransform() {},
    getImageData(x, y, w, h) {
      calls.reads.push([x, y, w, h]);
      readStart = inversions;
      return sliceRows(fixture, y, y + h);
    },
    putImageData(image, x, y) {
      calls.writes.push([x, y]);
      output.data.set(image.data, y * target.canvas.width * 4);
    },
  };
  const paint = createPhysicalIntensityCompositor({
    state: { intensityFields: fields }, getContext: () => target, getProjection: () => projection,
    getProjectionKey: () => projectionKey, getRowBounds: getEqualEarthIntensityRowBounds,
    withRenderTarget: (_, draw) => draw(), createCanvas: () => ({ width: 0, height: 0, getContext: () => scratch }),
  });
  return { calls, target, setKey: key => { projectionKey = key; },
    frame() {
      fixture = imageFixture(projection, matrix, target.canvas.width, target.canvas.height, sphereOnly);
      output = clone(fixture);
      const beforeReads = calls.reads.length;
      const result = paint(channelId, "multiply", blend => { calls.draws.push(blend); return 7; });
      calls.pixelInversions.push(calls.reads.length > beforeReads ? inversions - readStart : 0);
      return { result, output, fixture };
    },
  };
}

test("compositor reads/writes cropped rows and replays clip runs at absolute canvas positions", () => {
  const projection = d3.geoEqualEarth().scale(55).translate([120, 90]);
  const fields = field(100, 116);
  const h = compositorHarness({ projection, fields });
  const { result, output, fixture } = h.frame();
  const bounds = getPhysicalIntensityBounds(fields.channels[channelId].grid.composite);
  const [first, last] = getEqualEarthIntensityRowBounds({ projection, matrix: identity, bounds, height: 180 });
  const expected = clone(fixture);
  const runs = multiplyPhysicalAlpha(expected, { projection, matrix: identity, bounds,
    sample: (lon, lat) => sampleIntensityField(fields, channelId, lon, lat) });
  assert.equal(result, 7);
  assert.deepEqual(output.data, expected.data);
  assert.deepEqual(h.calls.reads, [[0, first, 240, last - first]]);
  assert.deepEqual(h.calls.writes, [[0, first]]);
  assert.deepEqual(h.calls.draws, ["source-over", "multiply"]);
  assert.deepEqual(h.calls.clips[1].path, runs.map(([x, y, length]) => [x, y, length, 1]));
  assert.deepEqual(h.calls.clips[0].path, [[0, 0, 240, 180], ...h.calls.clips[1].path]);
  assert.equal(h.calls.clips[0].rule, "evenodd");
});

test("an offscreen latitude edit draws natively without readback or scratch allocation", () => {
  const projection = d3.geoEqualEarth().scale(55).translate([120, 900]);
  const fields = field(100, 116);
  let draws = [];
  const paint = createPhysicalIntensityCompositor({ state: { intensityFields: fields },
    getContext: () => ({ canvas: { width: 240, height: 180 }, getTransform: () => identity }),
    getProjection: () => projection, getRowBounds: getEqualEarthIntensityRowBounds,
    createCanvas: () => assert.fail("offscreen support must not allocate a scratch canvas"),
  });
  assert.equal(paint(channelId, "overlay", blend => { draws.push(blend); return 9; }), 9);
  assert.deepEqual(draws, ["overlay"]);
});

test("live row origins, projection keys and dimensions invalidate coordinates while unchanged frames reuse them", () => {
  const projection = d3.geoEqualEarth().scale(55).translate([120, 90]);
  const candidates = new Map();
  let pair;
  for (let row = 90; row < 270 && !pair; row++) {
    const bounds = getPhysicalIntensityBounds(field(row).channels[channelId].grid.composite);
    const span = getEqualEarthIntensityRowBounds({ projection, matrix: identity, bounds, height: 180 });
    const size = span[1] - span[0];
    if (size > 0 && candidates.has(size) && candidates.get(size).span[0] !== span[0]) pair = [candidates.get(size), { row, span }];
    else if (size > 0) candidates.set(size, { row, span });
  }
  assert.ok(pair, "two live edits have equal read height and distinct row origins");
  const fields = field(pair[0].row);
  const h = compositorHarness({ projection, fields });
  h.frame(); h.frame();
  assert.ok(h.calls.pixelInversions[0] > 0);
  assert.equal(h.calls.pixelInversions[1], 0);
  fields.channels[channelId].grid.composite.set(field(pair[1].row).channels[channelId].grid.composite);
  const changed = h.frame();
  assert.equal(fields.channels[channelId].revision, 0, "no committed revision changed");
  assert.equal(h.calls.reads[0][3], h.calls.reads[2][3]);
  assert.notEqual(h.calls.reads[0][1], h.calls.reads[2][1]);
  assert.ok(h.calls.pixelInversions[2] > 0, "same-height relocation rebuilds coordinates");
  const expected = clone(changed.fixture);
  multiplyPhysicalAlpha(expected, { projection, matrix: identity,
    sample: (lon, lat) => sampleIntensityField(fields, channelId, lon, lat) });
  assert.deepEqual(changed.output.data, expected.data);
  h.setKey("changed"); h.frame();
  assert.ok(h.calls.pixelInversions[3] > 0);
  h.target.canvas.width++; h.frame();
  assert.ok(h.calls.pixelInversions[4] > 0);
  h.target.canvas.height++; h.frame();
  assert.ok(h.calls.pixelInversions[5] > 0);
});

test("compositor cold and warm alpha agree at a bilinear rounding threshold", () => {
  const fields = field(100, 100, 330, 390);
  const latitude = 39.74843751;
  const projection = d3.geoEqualEarth().scale(55).translate([0, 0]);
  const point = projection([0, latitude]);
  projection.translate([0.5 - point[0], 0.5 - point[1]]);
  const [lon, lat] = projection.invert([0.5, 0.5]);
  const sample = (x, y) => sampleIntensityField(fields, channelId, x, y);
  const expectedAlpha = Math.round(160 * sample(lon, lat));
  assert.notEqual(expectedAlpha, Math.round(160 * sample(Math.fround(lon), Math.fround(lat))),
    "fixture distinguishes a lossy Float32 cache from the initial double inverse");
  const h = compositorHarness({ projection, fields, width: 1, height: 1 });
  const first = h.frame().output;
  const warm = h.frame().output;
  assert.equal(first.data[3], expectedAlpha);
  assert.deepEqual(warm.data, first.data);
  assert.equal(h.calls.pixelInversions[1], 0, "the warm frame uses retained coordinates");
});

test("broad edits retain warm-coordinate reuse above one million canvas pixels", () => {
  const projection = d3.geoEqualEarth().scale(55).translate([500, 500]);
  const h = compositorHarness({ projection, fields: field(0, rows - 1, 0, columns - 1), width: 1001, height: 1000 });
  h.frame(); h.frame();
  assert.equal(h.calls.reads[0][2] * h.calls.reads[0][3], 1_001_000);
  assert.ok(h.calls.pixelInversions[0] > 0);
  assert.equal(h.calls.pixelInversions[1], 0, "wider support must not discard the existing warm-cache coverage");
});
