import assert from "node:assert/strict";
import test from "node:test";
import { getMapLabelHierarchy, getCountryLabelOpacity } from "../js/core/renderer/map_label_hierarchy.js";

const activeState = { showCityPoints: true, styleConfig: {} };

test("world to local zoom steadily transfers visual priority from countries to city names", () => {
  assert.deepEqual(getMapLabelHierarchy(1, activeState), { cityOpacity: 0, capitalOpacity: 0.5, countryOpacity: 1, preferCountries: true });
  assert.deepEqual(getMapLabelHierarchy(1.8, activeState), getMapLabelHierarchy(1, activeState));
  assert.equal(getMapLabelHierarchy(2.5, activeState).countryOpacity, 1);
  const scales = [1, 1.8, 2, 2.5, 2.9, 3, 3.1, 4, 5, 6, 8, 16];
  const policies = scales.map((k) => getMapLabelHierarchy(k, activeState));
  for (let i = 1; i < policies.length; i += 1) {
    assert.ok(policies[i].cityOpacity >= policies[i - 1].cityOpacity);
    assert.ok(policies[i].capitalOpacity >= policies[i - 1].capitalOpacity);
    assert.ok(policies[i].countryOpacity <= policies[i - 1].countryOpacity);
  }
  assert.equal(getMapLabelHierarchy(3, activeState).preferCountries, true);
  assert.equal(getMapLabelHierarchy(3.01, activeState).preferCountries, false);
  assert.equal(getMapLabelHierarchy(4, activeState).cityOpacity, 1);
  assert.equal(getMapLabelHierarchy(4, activeState).capitalOpacity, 1);
  assert.equal(getMapLabelHierarchy(6, activeState).countryOpacity, 0);
  assert.equal(getMapLabelHierarchy(16, activeState).countryOpacity, 0);
  assert.ok(getMapLabelHierarchy(2, activeState).cityOpacity > 0 && getMapLabelHierarchy(2, activeState).cityOpacity < 1);
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

test("independent layer, text and transparency switches restore the remaining label hierarchy", () => {
  const countriesOff = { showCityPoints: true, styleConfig: { countryLabels: { enabled: false } } };
  assert.equal(getMapLabelHierarchy(1, countriesOff).cityOpacity, 1);
  assert.equal(getMapLabelHierarchy(1, countriesOff).capitalOpacity, 1);
  assert.equal(getMapLabelHierarchy(1, countriesOff).preferCountries, false);
  for (const state of [
    { showCityPoints: false, styleConfig: {} },
    { showCityPoints: true, styleConfig: { cityPoints: { showLabels: false } } },
    { showCityPoints: true, styleConfig: { cityPoints: { opacity: 0 } } },
  ]) {
    assert.equal(getMapLabelHierarchy(8, state).countryOpacity, 1);
    assert.equal(getMapLabelHierarchy(8, state).cityOpacity, 0);
    assert.equal(getMapLabelHierarchy(8, state).capitalOpacity, 0);
  }
});
