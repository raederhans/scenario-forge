import assert from "node:assert/strict";
import test from "node:test";
import { resolveWaterRegionOverride, expandWaterRegionColorDependents } from "../js/core/renderer/water_region_color.js";

const normalize = (value) => /^#[a-f\d]{6}$/i.test(value || "") ? value : null;
const feature = (id, parent_id = "") => ({ properties: { id, parent_id } });
const parent = feature("marine_yellow_sea");
const child = feature("marine_bo_hai", parent.properties.id);
const grandchild = feature("marine_liaodong_wan", child.properties.id);
const index = new Map([parent, child, grandchild].map((f) => [f.properties.id, f]));
const resolve = (id, overrides, lookup = index) => resolveWaterRegionOverride(id, null, lookup, overrides, normalize);

test("old project parent colors survive subdivision without rewriting saved overrides", () => {
  const overrides = Object.freeze({ marine_yellow_sea: "#123456" });
  assert.equal(resolve("marine_bo_hai", overrides), "#123456");
  assert.equal(resolve("marine_liaodong_wan", overrides), "#123456");
  assert.deepEqual(overrides, { marine_yellow_sea: "#123456" });
});

test("painting a child takes priority; clearing it restores the nearest parent", () => {
  const overrides = { marine_yellow_sea: "#123456", marine_bo_hai: "#abcdef", marine_liaodong_wan: "#fedcba" };
  assert.equal(resolve("marine_liaodong_wan", overrides), "#fedcba");
  delete overrides.marine_liaodong_wan;
  assert.equal(resolve("marine_liaodong_wan", overrides), "#abcdef");
  delete overrides.marine_bo_hai;
  assert.equal(resolve("marine_liaodong_wan", overrides), "#123456");
});

test("invalid colors and cyclic or absent hierarchy terminate without a false override", () => {
  assert.equal(resolve("missing", {}), null);
  assert.equal(resolve("marine_bo_hai", { marine_bo_hai: "invalid", marine_yellow_sea: "#123456" }), "#123456");
  const cycle = new Map([["a", feature("a", "b")], ["b", feature("b", "a")]]);
  assert.equal(resolve("a", {}, cycle), null);
});

test("parent edits refresh descendant swatches; child edits do not repaint ancestor rows", () => {
  assert.deepEqual(expandWaterRegionColorDependents([parent.properties.id], index), [...index.keys()]);
  assert.deepEqual(expandWaterRegionColorDependents([child.properties.id], index), [child.properties.id, grandchild.properties.id]);
});
