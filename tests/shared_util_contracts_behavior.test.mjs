import test from "node:test";
import assert from "node:assert/strict";

import { normalizeHexColor } from "../js/core/color_hex_utils.js";
import { getPaletteDisplayColor } from "../js/core/palette_manager.js";
import { createSpecialZoneLayerStyle } from "../js/core/special_zone_layers.js";
import { getFeatureId } from "../js/core/feature_identity.js";
import {
  buildStrategicChoroplethColorInput,
  resolveStrategicChoroplethBucketId,
  resolveStrategicChoroplethValue,
} from "../js/core/renderer/strategic_choropleth.js";

test("hex normalization preserves each consumer's invalid-color contract", () => {
  const cases = [
    ["#123456", "#123456"],
    ["#abcdef", "#abcdef"],
    ["#AbCdEf", "#abcdef"],
    ["#abc", "#aabbcc"],
    ["#AbC", "#aabbcc"],
    [" \t#ABCdef\n", "#abcdef"],
    [" \t#AbC\n", "#aabbcc"],
    ["", null],
    ["   ", null],
    ["red", null],
    ["abcdef", null],
    ["#abcd", null],
    ["#12345678", null],
    ["#ggg", null],
    ["#ab cd ef", null],
    [null, null],
    [undefined, null],
    [0, null],
    [false, null],
  ];
  for (const [value, expected] of cases) {
    assert.equal(normalizeHexColor(value), expected);
    assert.equal(getPaletteDisplayColor({ map_hex: value }), expected ?? "");
    const style = createSpecialZoneLayerStyle({ fill: value, stroke: value });
    assert.equal(style.fill, expected ?? "#8b5cf6");
    assert.equal(style.stroke, expected ?? "#6d28d9");
  }
});

test("color consumers preserve source selection before normalization", () => {
  assert.equal(getPaletteDisplayColor({ map_hex: "", hex: " #AbC " }), "#aabbcc");
  assert.equal(getPaletteDisplayColor({ map_hex: "invalid", hex: "#abc" }), "");
  const style = createSpecialZoneLayerStyle({
    fill: "", fillColor: " #AbC ", stroke: "invalid", strokeColor: "#abc",
  });
  assert.equal(style.fill, "#aabbcc");
  assert.equal(style.stroke, "#6d28d9");
});

test("strategic feature identity follows the shared properties-first contract", () => {
  const cases = [
    [" AFG-1742 ", "AFG-1742"],
    [1, "1"],
    [0, "0"],
    [null, ""],
    [undefined, ""],
    [{}, ""],
    [{ id: " top " }, "top"],
    [{ id: 0 }, "0"],
    [{ properties: { id: " property " } }, "property"],
    [{ id: "same", properties: { id: "same" } }, "same"],
    [{ id: "top", properties: { id: "property", NUTS_ID: "nuts" } }, "property"],
    [{ id: "top", properties: { id: " ", NUTS_ID: " nuts " } }, "nuts"],
    [{ id: "top", properties: { id: null, NUTS_ID: "" } }, "top"],
    [{ id: "top", properties: { id: 0 } }, "0"],
    [{ properties: { feature_id: "legacy" } }, ""],
    [{ id: "top", properties: { feature_id: "legacy" } }, "top"],
  ];
  for (const [feature, expected] of cases) {
    assert.equal(getFeatureId(feature), expected);
    assert.equal(buildStrategicChoroplethColorInput(null, feature, "manpower").featureId, expected);
  }
});

test("strategic choropleth resolves the real feature ID over a numeric topology ID", () => {
  const feature = { id: 1, properties: { id: "AFG-1742" } };
  for (const bucketKey of ["bucketByFeature", "bucket_by_feature"]) {
    const payload = {
      [bucketKey]: { "AFG-1742": "s1474", "1": "wrong" },
      buckets: { s1474: { manpower: 400 }, wrong: { manpower: 900 } },
      metrics: { manpower: { min: 0, max: 1000, p95: 800 } },
    };
    assert.equal(resolveStrategicChoroplethBucketId(payload, feature), "s1474");
    assert.equal(resolveStrategicChoroplethValue(payload, feature, "manpower"), 400);
    const input = buildStrategicChoroplethColorInput(payload, feature, "manpower");
    assert.equal(input.featureId, "AFG-1742");
    assert.equal(input.bucketId, "s1474");
    assert.equal(input.value, 400);
    assert.equal(input.t, 0.5);
    assert.deepEqual(input, buildStrategicChoroplethColorInput(payload, "AFG-1742", "manpower"));
  }
});
