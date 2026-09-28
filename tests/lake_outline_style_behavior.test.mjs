import assert from "node:assert/strict";
import test from "node:test";

import { normalizeLakeStyleConfig } from "../js/core/state_defaults.js";
import { shouldDrawLakeOutline } from "../js/core/renderer/lake_outline_style.js";

const feature = (id, waterType = "lake") => ({ properties: { id, water_type: waterType } });
const bounds = { minX: 0, minY: 0, maxX: 4, maxY: 3 };

test("lake outline defaults normalize and survive JSON roundtrip", () => {
  const defaults = normalizeLakeStyleConfig();
  assert.deepEqual(
    [defaults.outlineEnabled, defaults.outlineColor, defaults.outlineWidth, defaults.outlineOpacity],
    [true, "#54738f", 0.7, 0.45],
  );
  assert.deepEqual(normalizeLakeStyleConfig(JSON.parse(JSON.stringify({
    outlineEnabled: false, outlineColor: "#abc", outlineWidth: 1.2, outlineOpacity: 0.6,
  }))), {
    ...defaults,
    outlineEnabled: false,
    outlineColor: "#aabbcc",
    outlineWidth: 1.2,
    outlineOpacity: 0.6,
  });
  assert.equal(normalizeLakeStyleConfig({ outlineEnabled: "false" }).outlineEnabled, false);
});

test("only curated visible lakes receive outlines independent of river style", () => {
  const config = normalizeLakeStyleConfig();
  for (const id of [
    "lake_baikal", "lake_superior", "lake_michigan", "lake_huron", "lake_erie", "lake_ontario",
    "lake_saimaa", "lake_paijanne", "lake_inari", "lake_pielinen",
    "lake_vanern", "lake_vattern", "lake_ladoga", "lake_onega",
    "ne_lake_1159126725", "ne_lake_1159114015", "ne_lake_1159116351", "ne_lake_1159113611",
  ]) {
    assert.equal(shouldDrawLakeOutline(feature(id), bounds, 2, config), true, id);
  }
  assert.equal(shouldDrawLakeOutline(feature("ne_lake_1159114699"), bounds, 2, config), false);
  assert.equal(shouldDrawLakeOutline(feature("lake_baikal", "sea"), bounds, 2, config), false);
  assert.equal(shouldDrawLakeOutline(feature("lake_baikal"), bounds, 1, config), false);
  assert.equal(shouldDrawLakeOutline(feature("lake_baikal"), bounds, 2, { outlineEnabled: false }), false);
});
