import test from "node:test";
import assert from "node:assert/strict";
import { isLakeVisibleInScenarioYear, resolveEffectiveWaterRegionFeatures } from "../js/core/renderer/effective_water_regions.js";

const lake = (id, properties = {}) => ({
  type: "Feature", properties: { id, water_type: "lake", ...properties },
});

test("shared reservoirs appear in their construction year and disappear in their removal year", () => {
  const reservoir = lake("reservoir", { year_built: 1956, year_removed: 2023 });
  for (const [year, visible] of [[1936, false], [1939, false], [1956, true], [1962, true], [2022, true], [2023, false], [2026, false], [null, true]]) {
    assert.equal(isLakeVisibleInScenarioYear(reservoir, year), visible);
    assert.deepEqual(resolveEffectiveWaterRegionFeatures({ globalLakeFeatures: [reservoir], scenarioYear: year }), visible ? [reservoir] : []);
  }
});

test("base and scenario copies cannot reintroduce a hidden shared reservoir", () => {
  const reservoir = lake("reservoir", { year_built: 1970 });
  for (const exclusive of [false, true]) {
    assert.deepEqual(resolveEffectiveWaterRegionFeatures({
      baseFeatures: [lake("reservoir")], scenarioFeatures: [lake("reservoir")],
      globalLakeFeatures: [reservoir], scenarioYear: 1936, exclusive,
    }), []);
  }
});
