import assert from "node:assert/strict";
import test from "node:test";
import { getMapLabelHierarchy, getCountryLabelOpacity } from "../js/core/renderer/map_label_hierarchy.js";

const activeState = { showCityPoints: true, styleConfig: {} };

test("priority retains direction inside the band and switches at its boundaries", () => {
  for (const initial of [true, false]) {
    let previous = initial;
    for (const k of [2.95, 3.05, 2.95, 3.05]) {
      const hierarchy = getMapLabelHierarchy(k, activeState, previous);
      assert.equal(hierarchy.preferCountries, initial);
      const direct = getMapLabelHierarchy(k, activeState);
      assert.deepEqual(hierarchy, { ...direct, preferCountries: initial });
      previous = hierarchy.preferCountries;
    }
  }
  assert.equal(getMapLabelHierarchy(3.149, activeState, true).preferCountries, true);
  assert.equal(getMapLabelHierarchy(3.15, activeState, true).preferCountries, false);
  assert.equal(getMapLabelHierarchy(2.851, activeState, false).preferCountries, false);
  assert.equal(getMapLabelHierarchy(2.85, activeState, false).preferCountries, true);
});

test("local country emphasis follows territory footprint rather than a universal zoom cutoff", () => {
  const near = getMapLabelHierarchy(6, activeState);
  assert.equal(getCountryLabelOpacity(near, 1000, 100000), 1);
  assert.ok(Math.abs(getCountryLabelOpacity(near, 6000, 100000) - 0.5) < 1e-10);
  assert.equal(getCountryLabelOpacity(near, 12000, 100000), 0);
  const far = getMapLabelHierarchy(1, activeState);
  assert.equal(getCountryLabelOpacity(far, 12000, 100000), 1);
  const noCities = getMapLabelHierarchy(6, { showCityPoints: false });
  assert.equal(getCountryLabelOpacity(noCities, 12000, 100000), 1);
});
