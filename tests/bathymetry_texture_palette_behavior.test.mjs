import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBathymetryColorRamp, depthToToneIndex } from '../js/core/renderer/bathymetry_texture_palette.js';

test('continuous tone maps reference endpoints, stays monotonic, and responds to scale', () => {
  assert.equal(depthToToneIndex(0), 0);
  assert.equal(depthToToneIndex(6000), 255);
  for (const scale of [.6, 1, 2.4]) {
    let previous = -1;
    for (let depth = 0; depth <= 11000; depth += 5) {
      const tone = depthToToneIndex(depth, scale);
      assert.ok(tone >= previous && tone <= 255); previous = tone;
    }
  }
  assert.ok(depthToToneIndex(100, 2) < depthToToneIndex(100, 1));
  assert.ok(depthToToneIndex(2000, 2) > depthToToneIndex(2000, 1));
  assert.ok(depthToToneIndex(0, .6) > 0);
  assert.ok(depthToToneIndex(6000, .6) < 255);
  assert.equal(depthToToneIndex(75), Math.round(.195 * 255));
});

test('ramp uses rounded luminance-dependent palette endpoints and opaque alpha', () => {
  const bright = buildBathymetryColorRamp({ baseRgb: { r: 170, g: 218, b: 255 }, opacity: .2, scale: 1 });
  const dark = buildBathymetryColorRamp({ baseRgb: { r: 20, g: 40, b: 60 }, preset: 'bathymetry_contours' });
  assert.ok(bright instanceof Uint8Array);
  assert.equal(bright.length, 1024);
  assert.deepEqual([...bright.slice(0, 4)], [190, 227, 253, 255]);
  assert.deepEqual([...bright.slice(-4)], [32, 62, 94, 255]);
  assert.notDeepEqual([...bright.slice(0, 3)], [...dark.slice(0, 3)]);
  assert.notDeepEqual([...bright.slice(-4)], [...dark.slice(-4)]);
  assert.notDeepEqual([...dark.slice(0, 3)], [...dark.slice(-4, -1)]);
  for (let i = 3; i < 1024; i += 4) assert.equal(bright[i], 255);
});
