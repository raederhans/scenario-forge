import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { createBathymetryTextureRenderer } from '../js/core/renderer/bathymetry_texture_renderer.js';
import { createProjectionInverseParams, decodeBathymetryDepth } from '../js/core/renderer/bathymetry_texture_math.js';
import { buildBathymetryColorRamp, depthToToneIndex } from '../js/core/renderer/bathymetry_texture_palette.js';

const vendor = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../vendor/d3.v7.min.js', import.meta.url), 'utf8'), vendor);
const { d3 } = vendor;
const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const ramp = buildBathymetryColorRamp({ baseRgb: { r: 170, g: 218, b: 255 }, scale: 1 });
const image = (width, height, value) => ({ width, height, data: typeof value === 'number'
  ? new Uint8Array(width * height).fill(value) : Uint8Array.from(value) });
function createCanvas(width, height) {
  const canvas = { width, height };
  canvas.getContext = (kind) => kind !== '2d' ? null : {
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: (data) => { canvas.image = data; },
  };
  return canvas;
}
function sourceOf(overview = image(8, 4, 128), tiles = new Map(), present = [...tiles.keys()], maxDepth = 11000) {
  const manifest = { encoding: { max_depth_m: maxDepth }, overview: { width: overview.width, height: overview.height },
    tiles: { tile_size: 2, present } };
  return { getOverview: () => overview, getLoadedTiles: () => tiles, getManifest: () => manifest, getRevision: () => 0 };
}
const colorOf = (value, scale = 1, maxDepth = 11000) => [...ramp.slice(
  depthToToneIndex(decodeBathymetryDepth(value, { max_depth_m: maxDepth }), scale) * 4,
  depthToToneIndex(decodeBathymetryDepth(value, { max_depth_m: maxDepth }), scale) * 4 + 4)];
function at(lon, lat, options = {}) {
  const projection = d3.geoEqualEarth().scale(10).translate([0, 0]);
  const [px, py] = projection([lon, lat]);
  const renderer = createBathymetryTextureRenderer({ createCanvas });
  return renderer.render({ width: 1, height: 1, transform: { ...identity, e: .5 - px, f: .5 - py },
    projectionParams: createProjectionInverseParams(projection), source: sourceOf(), ramp, detail: false, ...options });
}
const rgba = (result) => [...result.canvas.image.data];

test('CPU paints known depths, keeps land shallow, and makes exterior pixels transparent', () => {
  assert.deepEqual(rgba(at(0, 0)), colorOf(128));
  assert.deepEqual(rgba(at(0, 0, { source: sourceOf(image(8, 4, 0)) })), colorOf(0));
  const projection = d3.geoEqualEarth().fitSize([60, 28], { type: 'Sphere' }).translate([32, 16]);
  const renderer = createBathymetryTextureRenderer({ createCanvas });
  const result = renderer.render({ width: 64, height: 32, transform: identity,
    projectionParams: createProjectionInverseParams(projection), source: sourceOf(), ramp, detail: false });
  assert.equal(result.canvas.image.data[3], 0);
  assert.equal(result.canvas.image.data[(16 * 64 + 32) * 4 + 3], 255);
});

test('pixel centers under affine transforms and rotated projections sample the d3 inverse location', () => {
  const overview = image(36, 18, Array.from({ length: 648 }, (_, i) => 30 + i % 36 * 3 + Math.floor(i / 36) * 5));
  function expectedValue(lon, lat) {
    const x = (lon + 180) / 360 * 36 - .5, y = (90 - lat) / 180 * 18 - .5;
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const get = (xx, yy) => overview.data[Math.max(0, Math.min(17, yy)) * 36 + (xx + 36) % 36];
    return (get(ix, iy) * (1 - fx) + get(ix + 1, iy) * fx) * (1 - fy)
      + (get(ix, iy + 1) * (1 - fx) + get(ix + 1, iy + 1) * fx) * fy;
  }
  for (const rotation of [0, 70, -123]) {
    const projection = d3.geoEqualEarth().fitSize([52, 24], { type: 'Sphere' }).center([12, 8]).rotate([rotation, 0, 0]);
    const transform = { a: 1.1, b: .1, c: -.15, d: .9, e: 4, f: 3 };
    const renderer = createBathymetryTextureRenderer({ createCanvas });
    const result = renderer.render({ width: 64, height: 32, transform, projectionParams: createProjectionInverseParams(projection),
      source: sourceOf(overview), ramp, detail: false });
    let compared = 0;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) {
      const offset = (y * 64 + x) * 4;
      if (!result.canvas.image.data[offset + 3]) continue;
      const dx = x + .5 - transform.e, dy = y + .5 - transform.f;
      const determinant = transform.a * transform.d - transform.b * transform.c;
      const projected = [(transform.d * dx - transform.c * dy) / determinant,
        (-transform.b * dx + transform.a * dy) / determinant];
      const [lon, lat] = projection.invert(projected);
      assert.deepEqual([...result.canvas.image.data.slice(offset, offset + 4)], colorOf(expectedValue(lon, lat)));
      compared++;
    }
    assert.ok(compared > 500);
  }
});

test('overview and detail interpolate continuously across the antimeridian', () => {
  const overview = image(4, 2, [100, 40, 220, 160, 100, 40, 220, 160]);
  const source = sourceOf(overview, new Map([
    ['0_4', image(2, 2, [100, 120, 100, 120])], ['17_4', image(2, 2, [140, 160, 140, 160])],
  ]));
  for (const detail of [false, true]) {
    const west = at(-179.999, 0, { source, detail }), east = at(179.999, 0, { source, detail });
    assert.deepEqual(rgba(west), rgba(east));
    assert.deepEqual(rgba(west), colorOf(130));
  }
});

test('detail interpolates across ordinary tile boundaries', () => {
  const tiles = new Map([['8_4', image(2, 2, 80)], ['9_4', image(2, 2, 160)]]);
  const source = sourceOf(image(8, 4, 200), tiles);
  assert.deepEqual(rgba(at(0, 0, { source, detail: true })), colorOf(120));
});
