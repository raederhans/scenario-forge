import test from "node:test";
import assert from "node:assert/strict";
import { normalizeHexColor } from "../js/core/color_hex_utils.js";
import { getPaletteDisplayColor } from "../js/core/palette_manager.js";
import { createSpecialZoneLayerStyle } from "../js/core/special_zone_layers.js";
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
