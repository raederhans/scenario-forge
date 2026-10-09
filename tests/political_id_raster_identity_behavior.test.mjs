import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createPoliticalIdRasterIdentityBuilder } from "../js/core/renderer/political_id_raster_identity.js";

const clone = (value) => JSON.parse(JSON.stringify(value));
function input() {
  return {
    sceneKey: "tno_1962",
    descriptor: { originX: -256, originY: 512, width: 256, height: 128, density: 2, level: 4, key: "session:1" },
    projectionOptions: { factory: "geoEqualEarth", scale: 100, translate: [10, 20], precision: 0.1,
      center: [0, 0], rotate: [0, 0, 0], angle: 0, reflectX: false, reflectY: false, clipAngle: null, clipExtent: null },
    strokeWidth: 0.75, gutter: 0,
    entries: [
      { id: "a", code: 1, strokeCode: 1, geometryVersion: 1, bounds: { minX: 0 }, color: "#ff0000",
        feature: { type: "Feature", properties: { label: "a" }, geometry: { type: "Polygon", coordinates: [
          [[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]],
        ] } } },
      { id: "b", code: 2, strokeCode: 0, geometryVersion: 2,
        feature: { type: "Point", coordinates: [10, 20] } },
    ],
  };
}
const builder = () => createPoliticalIdRasterIdentityBuilder({ crypto: webcrypto });

test("content identity survives object replacement, code reassignment, recolor and session metadata", async () => {
  const identity = builder(), first = input();
  const expected = await identity.identify(first);
  assert.match(expected, /^political-id-raster:v1:[0-9a-f]{64}$/);
  const second = clone(first);
  second.descriptor.key = "session:200";
  second.descriptor.sessionGeneration = 999;
  second.entries[0].code = 90;
  second.entries[0].strokeCode = 90;
  second.entries[0].geometryVersion = 999;
  second.entries[0].color = "#0000ff";
  second.entries[0].bounds = { unrelated: true };
  second.entries[0].feature.properties = { label: "new label", color: "green" };
  second.entries[0].feature.geometry.bbox = [-3, -3, 3, 3];
  second.entries[0].feature.geometry = { coordinates: second.entries[0].feature.geometry.coordinates, type: "Polygon", foreign: "ignored" };
  second.entries[1].code = 91;
  second.entries[1].geometryVersion = 1000;
  second.projectionOptions = { factory: "geoEqualEarth", methods: Object.fromEntries(
    Object.entries(second.projectionOptions).filter(([key]) => key !== "factory").reverse(),
  ) };
  assert.equal(await identity.identify(second), expected);
  assert.deepEqual(identity.getStats(), { geometryHashes: 4, identityHashes: 2, cacheHits: 0 });
});

test("tile geometry, painter order, stroke, projection and stable scene changes miss", async () => {
  const identity = builder(), first = input(), expected = await identity.identify(first);
  const changes = [
    (value) => { value.entries[0].feature.geometry.coordinates[0][1][1] = 3; },
    (value) => { value.entries.reverse(); },
    (value) => { value.entries[0].strokeCode = 0; },
    (value) => { value.strokeWidth *= 2; }, // physical DPR affects coverage stroke width
    (value) => { value.projectionOptions.precision = 0.25; },
    (value) => { value.projectionOptions.rotate = [10, 0, 0]; },
    (value) => { value.projectionOptions.scale = 120; },
    (value) => { value.projectionOptions.clipExtent = [[0, 0], [100, 100]]; },
    (value) => { value.descriptor.density = 4; },
    (value) => { value.descriptor.level = 8; },
    (value) => { value.descriptor.originX += 256; },
    (value) => { value.descriptor.width = 128; },
    (value) => { value.gutter = 2; },
    (value) => { value.sceneKey = "another-scenario"; },
  ];
  for (const change of changes) {
    const next = clone(first);
    change(next);
    assert.notEqual(await identity.identify(next), expected);
  }
});

test("bootstrap/detail geometries with the same stable IDs receive different identities", async () => {
  const identity = builder(), bootstrap = input(), detail = clone(bootstrap);
  detail.entries[0].feature.geometry.coordinates[0].splice(1, 0, [0, 1]);
  assert.notEqual(await identity.identify(detail), await identity.identify(bootstrap));
});

test("WeakMap hits avoid coordinate traversal; version change, new object and dispose rehash", async () => {
  const identity = builder(), value = input();
  let coordinateReads = 0;
  const geometry = value.entries[0].feature.geometry;
  const coordinates = geometry.coordinates;
  Object.defineProperty(geometry, "coordinates", { get() { coordinateReads++; return coordinates; } });
  const first = await identity.identify(value);
  const firstReads = coordinateReads;
  assert.ok(firstReads > 0);
  assert.equal(await identity.identify(value), first);
  assert.equal(coordinateReads, firstReads, "hit does not read or stringify coordinate content");
  assert.deepEqual(identity.getStats(), { geometryHashes: 2, identityHashes: 2, cacheHits: 2 });
  value.entries[0].geometryVersion++;
  assert.equal(await identity.identify(value), first, "session version itself is absent from content identity");
  assert.ok(coordinateReads > firstReads);
  assert.equal(identity.getStats().geometryHashes, 3);
  value.entries[0].feature.geometry = clone(geometry);
  assert.equal(await identity.identify(value), first);
  assert.equal(identity.getStats().geometryHashes, 4);
  identity.dispose();
  assert.equal(await identity.identify(value), first);
  assert.equal(identity.getStats().geometryHashes, 6);
});

test("in-place geometry edits rehash when the caller advances geometryVersion", async () => {
  const identity = builder(), value = input(), first = await identity.identify(value);
  value.entries[0].feature.geometry.coordinates[0][1][1] = 5;
  value.entries[0].geometryVersion++;
  assert.notEqual(await identity.identify(value), first);
  assert.equal(identity.getStats().geometryHashes, 3);
});

test("GeometryCollection hashes only ordered geometry type and content", async () => {
  const identity = builder(), value = input();
  value.entries = [{ id: "collection", code: 1, feature: { type: "GeometryCollection", geometries: [
    { type: "Point", coordinates: [1, 2, 3] },
    { type: "MultiLineString", coordinates: [[[0, 0], [1, 1]]] },
  ] } }];
  const first = await identity.identify(value), next = clone(value);
  next.entries[0].feature.geometries[0].properties = { note: "ignored" };
  assert.equal(await identity.identify(next), first);
  next.entries[0].feature.geometries.reverse();
  next.entries[0].geometryVersion = 1;
  assert.notEqual(await identity.identify(next), first);
});

test("unavailable/failed crypto errors are clear, and failed geometry digests are retryable", async () => {
  await assert.rejects(createPoliticalIdRasterIdentityBuilder({ crypto: null }).identify(input()), /Web Crypto SHA-256/);
  let fail = true, calls = 0;
  const identity = createPoliticalIdRasterIdentityBuilder({ crypto: { subtle: { digest: async (...args) => {
    calls++;
    if (fail) throw new Error("digest unavailable");
    return webcrypto.subtle.digest(...args);
  } } } });
  const value = input();
  await assert.rejects(identity.identify(value), /SHA-256 failed: digest unavailable/);
  fail = false;
  assert.match(await identity.identify(value), /v1:[0-9a-f]{64}$/);
  assert.equal(calls, 4);
  assert.deepEqual(identity.getStats(), { geometryHashes: 2, identityHashes: 1, cacheHits: 0 });
});

test("invalid coverage, geometry, dimensions and cross-ID stroke fail closed", async () => {
  const identity = builder();
  const changes = [
    (value) => { value.sceneKey = ""; },
    (value) => { value.descriptor.width = 0; },
    (value) => { value.descriptor.density = NaN; },
    (value) => { value.descriptor.originX = 0.5; },
    (value) => { value.projectionOptions.precision = Infinity; },
    (value) => { value.projectionOptions.translate = [0]; },
    (value) => { value.strokeWidth = -1; },
    (value) => { value.gutter = 3; },
    (value) => { value.entries[1].id = "a"; },
    (value) => { value.entries[0].strokeCode = 2; },
    (value) => { value.entries[0].feature.geometry = null; },
    (value) => { value.entries[0].feature.geometry.type = "Unsupported"; },
    (value) => { value.entries[0].feature.geometry.coordinates[0][0][0] = NaN; },
    (value) => {
      const geometry = { type: "GeometryCollection", geometries: [] };
      geometry.geometries.push(geometry);
      value.entries[0].feature.geometry = geometry;
    },
  ];
  for (const change of changes) {
    const value = input();
    change(value);
    await assert.rejects(identity.identify(value), /Political raster identity:/);
  }
});

test("concurrent requests share pending geometry digests without sharing identity hashes", async () => {
  const identity = builder(), value = input();
  const [first, second] = await Promise.all([identity.identify(value), identity.identify(value)]);
  assert.equal(first, second);
  assert.deepEqual(identity.getStats(), { geometryHashes: 2, identityHashes: 2, cacheHits: 2 });
});
