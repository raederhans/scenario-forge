import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { createBathymetryTextureRenderer, estimateGeographicBounds } from '../js/core/renderer/bathymetry_texture_renderer.js';
import { createProjectionInverseParams, decodeBathymetryDepth, invertProjectedPoint } from '../js/core/renderer/bathymetry_texture_math.js';
import { buildBathymetryColorRamp, depthToToneIndex } from '../js/core/renderer/bathymetry_texture_palette.js';
import { createBathymetryTextureSource } from '../js/core/renderer/bathymetry_texture_source.js';

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
  assert.equal(result.backend, 'cpu');
  assert.equal(result.canvas.image.data[3], 0);
  assert.equal(result.canvas.image.data[(16 * 64 + 32) * 4 + 3], 255);
  assert.equal('drawnPixels' in result, false);
  assert.deepEqual(result.coveredBounds, [-180, -90, 180, 90]);
  const empty = renderer.render({ width: 2, height: 2, transform: { ...identity, e: 1000 },
    projectionParams: createProjectionInverseParams(projection), source: sourceOf(), ramp, detail: false });
  assert.equal(empty.coveredBounds, null);
  assert.ok(empty.canvas.image.data.every((value) => value === 0));
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
    assert.deepEqual(west.missingTileKeys, []);
  }
});

test('detail crosses ordinary tile boundaries and reports every present but unloaded neighbor', () => {
  const tiles = new Map([['8_4', image(2, 2, 80)], ['9_4', image(2, 2, 160)]]);
  const source = sourceOf(image(8, 4, 200), tiles);
  assert.deepEqual(rgba(at(0, 0, { source, detail: true })), colorOf(120));
  const missingSource = sourceOf(image(8, 4, 200), new Map([['0_4', image(2, 2, 100)]]), ['0_4', '17_4']);
  const result = at(-180, 0, { source: missingSource, detail: true });
  assert.deepEqual(rgba(result), colorOf(200));
  assert.deepEqual(result.missingTileKeys, ['17_4']);
  const noDetail = at(-180, 0, { source: missingSource, detail: false });
  assert.deepEqual(noDetail.missingTileKeys, []);
  const landNeighbor = sourceOf(image(8, 4, 200), new Map([['0_4', image(2, 2, 100)]]));
  assert.deepEqual(rgba(at(-180, 0, { source: landNeighbor, detail: true })), colorOf(50));
});

test('overlay overrides positive interpolated codes, falls back at zero, and respects geographic bounds', () => {
  const overlay = { ...image(2, 2, [0, 220, 0, 220]), bounds: [-20, -10, 20, 10] };
  assert.deepEqual(rgba(at(10, 0, { overlay })), colorOf(220));
  assert.deepEqual(rgba(at(-10, 0, { overlay })), colorOf(128));
  assert.deepEqual(rgba(at(0, 0, { overlay })), colorOf(110));
  assert.deepEqual(rgba(at(30, 0, { overlay })), colorOf(128));
  assert.deepEqual(rgba(at(0, 20, { overlay })), colorOf(128));
  const crossed = { bitmap: image(2, 2, 200), bounds: [170, -10, -170, 10] };
  assert.deepEqual(rgba(at(-175, 0, { overlay: crossed })), colorOf(200));
  assert.deepEqual(rgba(at(175, 0, { overlay: crossed })), colorOf(200));
  assert.deepEqual(rgba(at(0, 0, { overlay: crossed })), colorOf(128));
});

test('soft relief stays within its strength and contours blend their depth color by strength', () => {
  const base = rgba(at(0, 0)), soft = rgba(at(0, 0, { preset: 'bathymetry_soft' }));
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(base[i] - soft[i]) <= base[i] * .12 + 1);
  const source = sourceOf(image(8, 4, 255), new Map(), [], 200);
  const normal = rgba(at(0, 0, { source }));
  const contour = rgba(at(0, 0, { source, preset: 'bathymetry_contours', contourStrength: .5 }));
  for (let i = 0; i < 3; i++) assert.equal(contour[i], Math.round(normal[i] * .825));
});

test('bounds use a fixed grid including the edges and add one maximum neighbor step', () => {
  const points = [];
  assert.deepEqual(estimateGeographicBounds(100, 50, (x, y) => {
    points.push([x, y]);
    return [10 + x / 10, 30 - y / 5];
  }, 5), [7.5, 17.5, 22.5, 32.5]);
  assert.equal(points.length, 25);
  assert.deepEqual(points[0], [0, 0]);
  assert.deepEqual(points.at(-1), [100, 50]);
  assert.equal(estimateGeographicBounds(100, 50, () => null), null);
  let count = 0;
  estimateGeographicBounds(8192, 4096, () => { count++; return [0, 0]; });
  assert.equal(count, 33 * 33);
});

test('bounds follow the short interval across the antimeridian, including narrow intervals', () => {
  const normalize = (lon) => (lon + 180) % 360 - 180;
  assert.deepEqual(estimateGeographicBounds(100, 50,
    (x, y) => [normalize(170 + x / 5), 10 - y / 5], 5), [165, -2.5, -165, 12.5]);
  const bounds = estimateGeographicBounds(100, 50,
    (x, y) => [normalize(179.9 + x / 500), 10 - y / 5], 5);
  assert.ok(Math.abs(bounds[0] - 179.85) < 1e-9);
  assert.ok(Math.abs(bounds[2] + 179.85) < 1e-9);
});

test('bounds recognize global longitude spans and a fully enclosed sphere outline', () => {
  assert.deepEqual(estimateGeographicBounds(360, 180, (x, y) => [x - 180, 90 - y]), [-180, -90, 180, 90]);
  for (const rotation of [0, 90, -123]) {
    const projection = d3.geoEqualEarth().fitSize([60, 28], { type: 'Sphere' }).translate([32, 16]).rotate([rotation, 0, 0]);
    const params = createProjectionInverseParams(projection);
    assert.deepEqual(estimateGeographicBounds(64, 32, (x, y) => invertProjectedPoint(params, x, y)), [-180, -90, 180, 90]);
  }
});

test('CPU hillshade strength and exaggeration control a sloping surface', () => {
  const source = sourceOf(image(4, 2, [20, 80, 140, 200, 20, 80, 140, 200]));
  const base = rgba(at(0, 0, { source }));
  const unshaded = rgba(at(0, 0, { source, preset: 'bathymetry_soft', hillshadeStrength: 0 }));
  const flat = rgba(at(0, 0, { source, preset: 'bathymetry_soft', hillshadeExaggeration: 0 }));
  const shaded = rgba(at(0, 0, { source, preset: 'bathymetry_soft', hillshadeStrength: .3, hillshadeExaggeration: 4 }));
  const slight = rgba(at(0, 0, { source, preset: 'bathymetry_soft', hillshadeStrength: .3, hillshadeExaggeration: .1 }));
  assert.deepEqual(unshaded, base);
  assert.deepEqual(flat, base);
  assert.notDeepEqual(shaded, slight);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(shaded[i] - base[i]) <= base[i] * .3 + 1);
});

test('WebGL creation failure selects CPU and disposal permits subsequent rendering', () => {
  const renderer = createBathymetryTextureRenderer({ createCanvas, getWebGL2Context: () => { throw new Error('creation failed'); } });
  const projection = d3.geoEqualEarth().scale(1).translate([.5, .5]);
  const options = { width: 1, height: 1, transform: identity, projectionParams: createProjectionInverseParams(projection),
    source: sourceOf(), ramp, detail: false };
  assert.equal(renderer.render(options).backend, 'cpu');
  renderer.dispose();
  assert.deepEqual(rgba(renderer.render(options)), colorOf(128));
});

test('GPU uses bounded inverse work, direct bitmap uploads, stable allocation and incremental layer reuse', async () => {
  const calls = { texImage2D: [], texImage3D: [], texSubImage3D: [], pixelStorei: [], uniform1f: [], drawArrays: [] };
  const gl = Object.fromEntries(['VERTEX_SHADER', 'FRAGMENT_SHADER', 'COMPILE_STATUS', 'LINK_STATUS',
    'MAX_TEXTURE_SIZE', 'MAX_ARRAY_TEXTURE_LAYERS', 'MAX_VIEWPORT_DIMS', 'UNPACK_ALIGNMENT',
    'UNPACK_COLORSPACE_CONVERSION_WEBGL', 'UNPACK_PREMULTIPLY_ALPHA_WEBGL', 'UNPACK_FLIP_Y_WEBGL',
    'NONE', 'TEXTURE0', 'TEXTURE_2D', 'TEXTURE_2D_ARRAY', 'TEXTURE_MIN_FILTER', 'TEXTURE_MAG_FILTER',
    'NEAREST', 'TEXTURE_WRAP_S', 'TEXTURE_WRAP_T', 'CLAMP_TO_EDGE', 'R8', 'R8UI', 'RGBA8',
    'RED', 'RED_INTEGER', 'RGBA', 'UNSIGNED_BYTE', 'TRIANGLES'].map((name, i) => [name, i + 1]));
  for (const name of Object.keys(calls)) gl[name] = (...args) => calls[name].push(args);
  for (const name of ['shaderSource', 'compileShader', 'attachShader', 'deleteShader', 'linkProgram',
    'useProgram', 'activeTexture', 'bindTexture', 'texParameteri', 'uniform1i', 'uniformMatrix3fv',
    'uniform4f', 'uniform4fv', 'uniform2f', 'viewport']) gl[name] = () => {};
  for (const name of ['createProgram', 'createShader', 'createTexture']) gl[name] = () => ({});
  gl.getShaderParameter = gl.getProgramParameter = () => true;
  gl.getUniformLocation = (_, name) => name;
  gl.getParameter = (name) => name === gl.MAX_VIEWPORT_DIMS ? [8192, 8192]
    : name === gl.MAX_ARRAY_TEXTURE_LAYERS ? 256 : 8192;
  const bitmap = (url) => ({ width: 2, height: 2, url });
  const manifest = { overview: { url: 'overview' }, encoding: { max_depth_m: 11000 },
    tiles: { tile_size: 2, present: ['8_4', '9_4', '10_4'], url_template: '{col}_{row}' } };
  const source = createBathymetryTextureSource({ manifestUrl: 'manifest', fetchJson: async () => manifest,
    loadImageBitmap: async (url) => bitmap(url), maxCachedTiles: 2 });
  await source.load();
  await source.requestTiles(['8_4', '9_4']);
  const renderer = createBathymetryTextureRenderer({
    createCanvas: (width, height) => ({ width, height, getContext: () => ({ drawImage() {}, clearRect() {} }) }),
    getWebGL2Context: () => gl,
  });
  const projection = d3.geoEqualEarth().fitSize([8000, 30], { type: 'Sphere' }).translate([4096, 16]);
  const params = createProjectionInverseParams(projection), scale = params.scale;
  let scaleReads = 0;
  Object.defineProperty(params, 'scale', { get() { scaleReads++; return scale; } });
  const options = { width: 8192, height: 32, transform: identity, projectionParams: params, source, ramp,
    preset: 'bathymetry_soft', hillshadeStrength: .2, hillshadeExaggeration: 3 };
  const first = renderer.render(options);
  assert.equal(first.backend, 'webgl2');
  assert.equal(scaleReads, 33 * 33 * 2 + 1);
  assert.deepEqual(first.missingTileKeys, ['10_4']);
  assert.equal(calls.texImage3D.length, 1);
  assert.equal(calls.texImage3D[0][5], 2);
  assert.equal(calls.texSubImage3D.length, 2);
  assert.equal(calls.texSubImage3D[0].at(-1), source.getLoadedTiles().get('8_4'));
  assert.equal(calls.texImage2D[0].length, 6);
  assert.equal(calls.texImage2D[0].at(-1), source.getOverview());
  assert.ok(calls.pixelStorei.some(([key, value]) => key === gl.UNPACK_COLORSPACE_CONVERSION_WEBGL && value === gl.NONE));
  assert.ok(calls.pixelStorei.some(([key, value]) => key === gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL && value === false));
  assert.ok(calls.pixelStorei.some(([key, value]) => key === gl.UNPACK_FLIP_Y_WEBGL && value === false));
  assert.ok(calls.uniform1f.some(([key, value]) => key === 'hillshadeStrength' && value === .2));
  assert.ok(calls.uniform1f.some(([key, value]) => key === 'hillshadeExaggeration' && value === 3));
  assert.equal(calls.drawArrays.length, 2);
  const uploads = calls.texImage2D.length;
  renderer.render(options);
  assert.equal(calls.texImage2D.length, uploads);
  assert.equal(calls.texSubImage3D.length, 2);
  await source.requestTiles(['8_4']);
  await source.requestTiles(['10_4']);
  renderer.render(options);
  assert.equal(calls.texImage3D.length, 1);
  assert.equal(calls.texSubImage3D.length, 3);
  assert.equal(calls.texSubImage3D[2][4], calls.texSubImage3D[1][4]);
  assert.equal(calls.texSubImage3D[2].at(-1), source.getLoadedTiles().get('10_4'));
  assert.equal(calls.texImage2D.length, uploads + 1);
  assert.equal(calls.texImage2D.at(-1)[2], gl.R8UI);
});

test('renderer reuses its output canvas and resizes it without allocating another output', () => {
  let allocations = 0;
  const renderer = createBathymetryTextureRenderer({
    createCanvas: (width, height) => { allocations++; return createCanvas(width, height); },
  });
  const projection = d3.geoEqualEarth().scale(1).translate([.5, .5]);
  const options = { width: 1, height: 1, transform: identity,
    projectionParams: createProjectionInverseParams(projection), source: sourceOf(), ramp, detail: false };
  const first = renderer.render(options);
  const count = allocations;
  assert.equal(renderer.render(options).canvas, first.canvas);
  assert.equal(allocations, count);
  const resized = renderer.render({ ...options, width: 2, height: 3 });
  assert.equal(resized.canvas, first.canvas);
  assert.equal(resized.canvas.width, 2);
  assert.equal(resized.canvas.height, 3);
  assert.equal(resized.canvas.image.data.length, 24);
  assert.equal(allocations, count);
});
