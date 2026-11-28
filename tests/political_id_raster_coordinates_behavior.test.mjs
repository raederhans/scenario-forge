import test from "node:test";
import assert from "node:assert/strict";
import {
  createPoliticalIdRasterCoordinateSpace,
  POLITICAL_ID_RASTER_CANONICAL_PRECISION,
  POLITICAL_ID_RASTER_CANONICAL_SCALE,
  POLITICAL_ID_RASTER_COORDINATE_SPACE_VERSION,
} from "../js/core/renderer/political_id_raster_coordinates.js";

function fittedExtent(scale, translate, canonicalExtent) {
  const inverseRatio = scale / POLITICAL_ID_RASTER_CANONICAL_SCALE;
  return canonicalExtent.map(([x, y]) => [
    x * inverseRatio + translate[0],
    y * inverseRatio + translate[1],
  ]);
}

function fittedOptions(scale, translate, canonicalClipExtent) {
  return {
    factory: "geoEqualEarth",
    scale,
    translate,
    clipExtent: canonicalClipExtent ? fittedExtent(scale, translate, canonicalClipExtent) : null,
  };
}

test("different fit scales and translations produce one canonical signature", () => {
  const clip = [[-160, -80], [160, 80]];
  const firstOptions = fittedOptions(512, [300, -100], clip);
  const secondOptions = fittedOptions(1024, [-50, 450], clip);
  const first = createPoliticalIdRasterCoordinateSpace(firstOptions);
  const second = createPoliticalIdRasterCoordinateSpace(secondOptions);

  assert.ok(first);
  assert.ok(second);
  assert.equal(first.signature, second.signature);
  assert.deepEqual(first.projectionOptions, second.projectionOptions);
  assert.equal(first.projectionOptions.scale, POLITICAL_ID_RASTER_CANONICAL_SCALE);
  assert.deepEqual(first.projectionOptions.translate, [0, 0]);
  assert.equal(first.projectionOptions.precision, POLITICAL_ID_RASTER_CANONICAL_PRECISION);
  assert.equal(JSON.parse(first.signature).version, POLITICAL_ID_RASTER_COORDINATE_SPACE_VERSION);
});

test("point, negative bounds, and transform mappings preserve the fitted screen position", () => {
  const options = fittedOptions(640, [275, -90], [[-170, -100], [170, 100]]);
  const space = createPoliticalIdRasterCoordinateSpace(options);
  const originalPoint = [75, -215];
  const canonicalPoint = space.mapPoint(originalPoint);
  const ratio = POLITICAL_ID_RASTER_CANONICAL_SCALE / options.scale;
  assert.deepEqual(canonicalPoint, [
    (originalPoint[0] - options.translate[0]) * ratio,
    (originalPoint[1] - options.translate[1]) * ratio,
  ].map((value) => Number(value.toFixed(12))));

  const negativeBounds = space.mapBounds({ minX: -725, minY: -410, maxX: -85, maxY: -90 });
  assert.ok(negativeBounds.minX < 0);
  assert.ok(negativeBounds.minY < 0);
  assert.ok(negativeBounds.minX <= negativeBounds.maxX);
  assert.ok(negativeBounds.minY <= negativeBounds.maxY);

  const transform = { x: 38, y: 51, k: 1.75 };
  const mappedTransform = space.mapTransform(transform);
  const oldScreen = [
    transform.x + transform.k * originalPoint[0],
    transform.y + transform.k * originalPoint[1],
  ];
  const canonicalScreen = [
    mappedTransform.x + mappedTransform.k * canonicalPoint[0],
    mappedTransform.y + mappedTransform.k * canonicalPoint[1],
  ];
  assert.ok(Math.abs(canonicalScreen[0] - oldScreen[0]) < 1e-9);
  assert.ok(Math.abs(canonicalScreen[1] - oldScreen[1]) < 1e-9);
  assert.equal(transform.x, 38);
  assert.equal(transform.y, 51);
  assert.equal(transform.k, 1.75);
});

test("mapping helpers reject malformed coordinates", () => {
  const space = createPoliticalIdRasterCoordinateSpace(fittedOptions(512, [300, -100]));

  assert.equal(space.mapPoint([1]), null);
  assert.equal(space.mapPoint([1, Number.NaN]), null);
  assert.equal(space.mapBounds({ minX: 1, minY: 0, maxX: 0, maxY: 2 }), null);
  assert.equal(space.mapTransform({ x: 0, y: 0, k: Number.NaN }), null);
});
