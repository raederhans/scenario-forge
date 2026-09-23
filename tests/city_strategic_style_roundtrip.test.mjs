import test from "node:test";
import assert from "node:assert/strict";

import { FileManager } from "../js/core/file_manager.js";
import { normalizeCityLayerStyleConfig } from "../js/core/state_defaults.js";
import { createDefaultStyleConfig, restoreImportedStyleConfigState } from "../js/core/state/ui_state.js";
import { normalizeStrategicValuesStyle } from "../js/core/strategic_values_view_model.js";
import { getCityEffectiveMinZoom, getCityRevealBucket } from "../js/core/renderer/city_reveal_policy.js";

test("city hierarchy controls normalize valid selections and reject invalid values", () => {
  const selected = normalizeCityLayerStyleConfig({ densityPreset: "detailed", minSettlementRank: "medium" });
  assert.equal(selected.densityPreset, "detailed");
  assert.equal(selected.minSettlementRank, "medium");
  const invalid = normalizeCityLayerStyleConfig({ densityPreset: "unbounded", minSettlementRank: "capital" });
  assert.equal(invalid.densityPreset, "balanced");
  assert.equal(invalid.minSettlementRank, "town");
  const legacy = normalizeCityLayerStyleConfig({ markerDensity: 0.7, labelDensity: "sparse" });
  assert.equal(legacy.markerDensity, 0.7);
  assert.equal(legacy.labelDensity, "sparse");
  assert.equal(legacy.densityPreset, "balanced");
  assert.equal(legacy.minSettlementRank, "town");
});

test("strategic style preserves zero opacity and validates palette and resource filter", () => {
  assert.deepEqual(normalizeStrategicValuesStyle({ opacity: 0, palette: "rose", resourceFilter: "oil" }), {
    opacity: 0, palette: "rose", resourceFilter: "oil",
  });
  assert.deepEqual(normalizeStrategicValuesStyle({ opacity: "invalid", palette: "neon", resourceFilter: "alll" }), {
    opacity: 0.75, palette: "auto", resourceFilter: "all",
  });
});

test("saved project styles survive import and runtime restore, including old project defaults", () => {
  const saved = FileManager.buildProjectPayload({ styleConfig: {
    cityPoints: { densityPreset: "compact", minSettlementRank: "large", markerDensity: 0.8 },
    strategicValues: { opacity: 0, palette: "blue", resourceFilter: "tungsten" },
  } });
  const imported = FileManager.normalizeImportedProjectData(structuredClone(saved));
  const target = { styleConfig: createDefaultStyleConfig() };
  restoreImportedStyleConfigState(target, imported.styleConfig);
  assert.equal(target.styleConfig.cityPoints.densityPreset, "compact");
  assert.equal(target.styleConfig.cityPoints.minSettlementRank, "large");
  assert.equal(target.styleConfig.cityPoints.markerDensity, 0.8);
  assert.deepEqual(target.styleConfig.strategicValues, { opacity: 0, palette: "blue", resourceFilter: "tungsten" });

  const legacy = FileManager.normalizeImportedProjectData({ schemaVersion: 1, styleConfig: {
    cityPoints: { markerDensity: 0.7 },
  } });
  const oldTarget = { styleConfig: createDefaultStyleConfig() };
  restoreImportedStyleConfigState(oldTarget, legacy.styleConfig);
  assert.equal(oldTarget.styleConfig.cityPoints.markerDensity, 0.7);
  assert.equal(oldTarget.styleConfig.cityPoints.densityPreset, "balanced");
  assert.equal(oldTarget.styleConfig.cityPoints.minSettlementRank, "town");
  assert.deepEqual(oldTarget.styleConfig.strategicValues, { opacity: 0.75, palette: "auto", resourceFilter: "all" });
});

test("explicit high settlement rank clears an inherited minor zoom gate but respects a true override", () => {
  const feature = { properties: { base_tier: "minor", min_zoom: 2.9, settlement_rank: "large" } };
  assert.equal(getCityEffectiveMinZoom(feature), 2.45);
  assert.equal(getCityRevealBucket({ countryTier: "D", cityTier: "minor", settlementRank: "large" }, "P4"), 3);
  assert.equal(getCityEffectiveMinZoom({ properties: { ...feature.properties, __city_min_zoom: 3.5 } }), 3.5);
});
