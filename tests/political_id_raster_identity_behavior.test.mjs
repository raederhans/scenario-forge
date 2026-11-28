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
});

test("changing painter order changes tile identity", async () => {
  const identity = builder(), first = input(), expected = await identity.identify(first);
  const next = clone(first);
  next.entries.reverse();
  assert.notEqual(await identity.identify(next), expected);
});

test("in-place geometry edits rehash when the caller advances geometryVersion", async () => {
  const identity = builder(), value = input(), first = await identity.identify(value);
  value.entries[0].feature.geometry.coordinates[0][1][1] = 5;
  value.entries[0].geometryVersion++;
  assert.notEqual(await identity.identify(value), first);
});
