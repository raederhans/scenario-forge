import test from "node:test";
import assert from "node:assert/strict";
import { resolveEffectiveWaterRegionFeatures, isLakeRegion, isLakeInteractionEnabled } from "../js/core/renderer/effective_water_regions.js";
import { normalizeLakeStyleConfig } from "../js/core/state_defaults.js";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parse } from "acorn";

const water = (id, properties = {}) => ({
  type: "Feature", properties: { id, water_type: "lake", ...properties },
});

test("all lake types require opt-in, including legacy named lakes and display-only lakes", () => {
  const source = readFileSync(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
  const names = ["isWaterRegionEnabled", "isWaterRegionRenderable", "getWaterRegionType", "isOpenOceanWaterRegion", "isBaseGeographyScenarioFeature"];
  const declarations = parse(source, { ecmaVersion: "latest", sourceType: "module" }).body
    .filter((node) => node.type === "FunctionDeclaration" && names.includes(node.id.name));
  const state = { styleConfig: { lakes: normalizeLakeStyleConfig() }, showWaterRegions: true };
  const scope = vm.createContext({ runtimeState: state, isLakeRegion, isLakeInteractionEnabled,
    isOpenOceanOverlayActive: () => false, isOpenOceanRenderable: () => false });
  vm.runInContext(declarations.map(({ start, end }) => source.slice(start, end)).join("\n"), scope);
  for (const water_type of ["lake", "reservoir", "inland_sea"]) {
    for (const interactive of [true, false, undefined]) {
      const feature = water("test-lake", { water_type, interactive });
      state.styleConfig.lakes = normalizeLakeStyleConfig({ fillColor: "#123456" });
      assert.equal(scope.isWaterRegionEnabled(feature), false);
      assert.equal(scope.isWaterRegionRenderable(feature), true);
      state.styleConfig.lakes = normalizeLakeStyleConfig({ interactive: true });
      assert.equal(scope.isWaterRegionEnabled(feature), true);
      state.styleConfig.lakes = normalizeLakeStyleConfig({ interactive: false });
      assert.equal(scope.isWaterRegionEnabled(feature), false);
    }
  }
  assert.equal(scope.isWaterRegionEnabled(water("sea", { water_type: "sea" })), true);
  assert.equal(scope.isWaterRegionEnabled(water("ocean", { water_type: "ocean" })), false);
  assert.equal(normalizeLakeStyleConfig({ interactive: "false" }).interactive, false);
  assert.equal(normalizeLakeStyleConfig(JSON.parse(JSON.stringify({ interactive: true }))).interactive, true);
});

test("exclusive scenarios share ordinary lakes without reintroducing base marine regions or cloned lakes", () => {
  const lake = water("lake_superior");
  const baikal = water("lake_baikal");
  const congo = water("congo_lake", { scenario_id: "tno_1962" });
  const scenarioSea = water("tno_sea", { water_type: "sea", scenario_id: "tno_1962" });
  const result = resolveEffectiveWaterRegionFeatures({
    activeScenarioId: "tno_1962", exclusive: true,
    baseFeatures: [water("base_ocean", { water_type: "ocean" }), lake],
    scenarioFeatures: [water("lake_superior", { scenario_id: "tno_1962" }), congo, scenarioSea],
    globalLakeFeatures: [lake, baikal],
    isExcluded: (feature) => feature.properties.id === "lake_superior",
  });
  assert.deepEqual(new Set(result.map((f) => f.properties.id)), new Set(["lake_superior", "lake_baikal", "congo_lake", "tno_sea"]));
  assert.equal(result.find((f) => f.properties.id === "lake_superior"), lake);
});

test("Congo Lake never leaks to another scenario, including stale scenario collections and unscoped input", () => {
  for (const activeScenarioId of ["", "modern_world", "hoi4_1939", "hgo_1936"]) {
    const result = resolveEffectiveWaterRegionFeatures({
      activeScenarioId,
      baseFeatures: [water("congo_lake")],
      scenarioFeatures: [water("congo_lake", { scenario_id: "tno_1962" })],
      globalLakeFeatures: [water("lake_baikal"), water("congo_lake")],
    });
    assert.deepEqual(result.map((f) => f.properties.id), ["lake_baikal"]);
  }
});

test("ordinary lakes have identical feature identities across scenario modes and toggles", () => {
  const lakes = [water("lake_baikal"), water("lake_geneva")];
  for (const activeScenarioId of ["", "tno_1962", "modern_world", "hoi4_1939", "hgo_1936"]) {
    for (const exclusive of [true, false]) {
      const result = resolveEffectiveWaterRegionFeatures({ activeScenarioId, exclusive, globalLakeFeatures: lakes });
      assert.deepEqual(result, lakes);
      assert.equal(result[0], lakes[0]);
    }
  }
});
