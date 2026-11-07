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

test("natural lakes remain visible in every era and omitted years leave reservoirs visible", () => {
  const natural = lake("natural");
  for (const scenarioYear of [1936, 1939, 1962, 2026, null]) {
    assert.equal(isLakeVisibleInScenarioYear(natural, scenarioYear), true);
    assert.deepEqual(resolveEffectiveWaterRegionFeatures({ globalLakeFeatures: [natural], scenarioYear }), [natural]);
  }
  const reservoir = lake("future", { year_built: 1970 });
  assert.deepEqual(resolveEffectiveWaterRegionFeatures({ globalLakeFeatures: [reservoir] }), [reservoir]);
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

test("Congo Lake remains exclusive to TNO and cannot enter through the shared layer", () => {
  const congo = lake("congo_lake", { scenario_id: "tno_1962" });
  for (const activeScenarioId of ["", "hoi4_1939", "modern_world", "tno_1962"]) {
    const result = resolveEffectiveWaterRegionFeatures({
      activeScenarioId, scenarioYear: 1962,
      baseFeatures: [lake("congo_lake")], scenarioFeatures: [congo],
      globalLakeFeatures: [lake("congo_lake")],
    });
    assert.deepEqual(result, activeScenarioId === "tno_1962" ? [congo] : []);
  }
});
