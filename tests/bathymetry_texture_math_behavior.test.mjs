import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { decodeBathymetryDepth, encodeBathymetryDepth, equalEarthRaw, equalEarthRawInvert,
  createProjectionInverseParams, invertProjectedPoint } from '../js/core/renderer/bathymetry_texture_math.js';

const vendor = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../vendor/d3.v7.min.js', import.meta.url), 'utf8'), vendor);
const { d3 } = vendor;
const encoding = { max_depth_m: 11000 };

test('encoding preserves all ocean codes, with zero reserved for land', () => {
  assert.equal(decodeBathymetryDepth(0, encoding), 0);
  assert.equal(encodeBathymetryDepth(0, encoding), 1);
  assert.equal(decodeBathymetryDepth(255, encoding), 11000);
  for (let v = 1; v <= 255; v++) assert.equal(encodeBathymetryDepth(decodeBathymetryDepth(v, encoding), encoding), v);
});

test('raw Equal Earth inverse includes the sphere boundary and rejects exterior points', () => {
  for (const lon of [-180, -90, 0, 90, 180]) for (const lat of [-90, -60, 0, 60, 90]) {
    const point = equalEarthRaw(lon * Math.PI / 180, lat * Math.PI / 180);
    const inverse = equalEarthRawInvert(...point);
    assert.ok(inverse);
    assert.ok(Math.abs(inverse[0] * 180 / Math.PI - lon) < 1e-6);
    assert.ok(Math.abs(inverse[1] * 180 / Math.PI - lat) < 1e-6);
  }
  assert.equal(equalEarthRawInvert(4, 0), null);
  assert.equal(equalEarthRawInvert(0, 2), null);
});

test('fitted, translated, centered and longitude-rotated inverses match vendor d3 on a grid', () => {
  for (const projection of [
    d3.geoEqualEarth().fitSize([640, 320], { type: 'Sphere' }),
    d3.geoEqualEarth().fitSize([640, 320], { type: 'Sphere' }).translate([401, 197]),
    d3.geoEqualEarth().fitSize([640, 320], { type: 'Sphere' }).center([23, -14]).rotate([127, 0, 0]),
    d3.geoEqualEarth().rotate([-275, 0, 0]).scale(71).translate([-13, 47]),
  ]) {
    const params = createProjectionInverseParams(projection);
    assert.ok(params);
    for (let lon = -175; lon < 180; lon += 10) for (let lat = -85; lat < 90; lat += 10) {
      const pixel = projection([lon, lat]);
      const expected = projection.invert(pixel), actual = invertProjectedPoint(params, ...pixel);
      assert.ok(actual);
      assert.ok(Math.abs(expected[0] - actual[0]) < 1e-6);
      assert.ok(Math.abs(expected[1] - actual[1]) < 1e-6);
    }
    assert.equal(invertProjectedPoint(params, 1e6, 1e6), null);
  }
});

test('unsupported projections and settings return null', () => {
  for (const projection of [d3.geoMercator(), d3.geoEquirectangular(), d3.geoEqualEarth().angle(2),
    d3.geoEqualEarth().reflectX(true), d3.geoEqualEarth().reflectY(true), d3.geoEqualEarth().rotate([0, 1, 0]),
    d3.geoEqualEarth().rotate([0, 0, 1]), d3.geoEqualEarth().clipAngle(40),
    d3.geoEqualEarth().clipExtent([[0, 0], [20, 20]])]) assert.equal(createProjectionInverseParams(projection), null);
});
