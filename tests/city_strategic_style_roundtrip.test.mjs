import test from "node:test";
import assert from "node:assert/strict";
import { FileManager } from "../js/core/file_manager.js";
import { createDefaultStyleConfig, restoreImportedStyleConfigState } from "../js/core/state/ui_state.js";

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
