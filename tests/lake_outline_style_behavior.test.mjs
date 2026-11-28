import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLakeStyleConfig } from "../js/core/state_defaults.js";
import { shouldDrawLakeOutline } from "../js/core/renderer/lake_outline_style.js";

const feature = (id, waterType = "lake") => ({ properties: { id, water_type: waterType } });
const bounds = { minX: 0, minY: 0, maxX: 4, maxY: 3 };

test("only curated visible lakes receive outlines independent of river style", () => {
  const config = normalizeLakeStyleConfig();
  assert.equal(shouldDrawLakeOutline(feature("lake_baikal"), bounds, 2, config), true);
  assert.equal(shouldDrawLakeOutline(feature("ne_lake_1159114699"), bounds, 2, config), false);
  assert.equal(shouldDrawLakeOutline(feature("lake_baikal", "sea"), bounds, 2, config), false);
  assert.equal(shouldDrawLakeOutline(feature("lake_baikal"), bounds, 1, config), false);
  assert.equal(shouldDrawLakeOutline(feature("lake_baikal"), bounds, 2, { outlineEnabled: false }), false);
  assert.equal(shouldDrawLakeOutline(feature("lake_baikal"), bounds, 10,
    normalizeLakeStyleConfig({ outlineWidth: 0 })), false, "zero width must not reuse a previous Canvas stroke width");
});
