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
    center: [10, -2],
    rotate: [-15, 7, 0],
    angle: 2.5,
    reflectX: true,
    reflectY: false,
    precision: 0.7,
    clipAngle: 90,
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

test("fit rounding is removed from the signature at roughly 1e-12 precision", () => {
  const firstOptions = fittedOptions(512, [300, -100], [[-160, -80], [160, 80]]);
  const secondOptions = fittedOptions(512 + 1e-10, [300 + 1e-10, -100 - 1e-10], [[-160, -80], [160, 80]]);
  const first = createPoliticalIdRasterCoordinateSpace(firstOptions);
  const second = createPoliticalIdRasterCoordinateSpace(secondOptions);

  assert.equal(first.signature, second.signature);
});

test("rotate, clip angle, and canonical clip extent affect the signature", () => {
  const baseOptions = fittedOptions(512, [300, -100], [[-160, -80], [160, 80]]);
  const base = createPoliticalIdRasterCoordinateSpace(baseOptions);
  const rotated = createPoliticalIdRasterCoordinateSpace({ ...baseOptions, rotate: [-14, 7, 0] });
  const clipped = createPoliticalIdRasterCoordinateSpace({ ...baseOptions, clipAngle: 80 });
  const differentExtent = createPoliticalIdRasterCoordinateSpace({
    ...baseOptions,
    clipExtent: fittedExtent(512, [300, -100], [[-150, -80], [160, 80]]),
  });

  assert.notEqual(base.signature, rotated.signature);
  assert.notEqual(base.signature, clipped.signature);
  assert.notEqual(base.signature, differentExtent.signature);
});

test("canonicalization does not mutate projection inputs and leaves DPR to view planning", () => {
  const options = fittedOptions(512, [300, -100], [[-160, -80], [160, 80]]);
  const original = structuredClone(options);
  const first = createPoliticalIdRasterCoordinateSpace(options);
  const withDprMetadata = createPoliticalIdRasterCoordinateSpace({ ...options, dpr: 3 });

  assert.deepEqual(options, original);
  assert.equal(first.signature, withDprMetadata.signature);
  assert.equal(Object.hasOwn(first.projectionOptions, "dpr"), false);
});

test("invalid and unsupported projection options return null", () => {
  for (const options of [
    null,
    {},
    { factory: "geoMercator", scale: 256, translate: [0, 0] },
    { factory: "geoEqualEarth", scale: 0, translate: [0, 0] },
    { factory: "geoEqualEarth", scale: -2, translate: [0, 0] },
    { factory: "geoEqualEarth", scale: 256 },
    { factory: "geoEqualEarth", scale: 256, translate: [0, Number.NaN] },
    { factory: "geoEqualEarth", scale: 256, translate: [0, 0], rotate: [1, Number.POSITIVE_INFINITY] },
    { factory: "geoEqualEarth", scale: 256, translate: [0, 0], clipExtent: [[2, 0], [1, 1]] },
  ]) {
    assert.equal(createPoliticalIdRasterCoordinateSpace(options), null);
  }
});

test("mapping helpers reject malformed coordinates", () => {
  const space = createPoliticalIdRasterCoordinateSpace(fittedOptions(512, [300, -100]));

  assert.equal(space.mapPoint([1]), null);
  assert.equal(space.mapPoint([1, Number.NaN]), null);
  assert.equal(space.mapBounds({ minX: 1, minY: 0, maxX: 0, maxY: 2 }), null);
  assert.equal(space.mapTransform({ x: 0, y: 0, k: Number.NaN }), null);
});
