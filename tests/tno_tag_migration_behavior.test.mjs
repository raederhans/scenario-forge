import test from "node:test";
import assert from "node:assert/strict";
import { FileManager } from "../js/core/file_manager.js";
import { migrateImportedProjectData } from "../js/core/sovereignty_manager.js";
import { TNO_TAG_MIGRATION_VERSION } from "../js/core/country_code_aliases.js";

test("legacy TNO country edits migrate atomically at the import boundary", () => {
  const original = {
    scenario: { id: "tno_1962", version: 1, baselineHash: "legacy" },
    sovereignBaseColors: { MAG: "#123456", RSF: "#abcdef", GSW: "#555555", ANG: "#777777" },
    activeSovereignCode: "MAG",
    customPresets: { MAG: [{ name: "MAG", featureIds: ["legacy-feature"] }], RSF: [] },
    parentBorderEnabledByCountry: { MAG: false, RSF: true },
    releasableBoundaryVariantByTag: { MAG: "historical", RSF: "current" },
    visualOverrides: { "MAG-feature": "#010101" },
  };
  const imported = FileManager.normalizeImportedProjectData(original);
  assert.deepEqual(imported.sovereignBaseColors, { MGN: "#123456", MAG: "#abcdef", ANG: "#555555" });
  assert.equal(imported.activeSovereignCode, "MGN");
  assert.deepEqual(imported.customPresets.MGN, original.customPresets.MAG);
  assert.deepEqual(imported.parentBorderEnabledByCountry, { MGN: false, MAG: true });
  assert.deepEqual(imported.releasableBoundaryVariantByTag, { MGN: "historical", MAG: "current" });
  assert.deepEqual(imported.visualOverrides, original.visualOverrides);
  assert.equal(imported.scenario.tagMigrationVersion, TNO_TAG_MIGRATION_VERSION);
  assert.equal(original.scenario.tagMigrationVersion, undefined);
  assert.equal(original.sovereignBaseColors.MAG, "#123456");
  assert.deepEqual(migrateImportedProjectData(imported).sovereignBaseColors, imported.sovereignBaseColors);
});

test("new TNO exports keep Magadan on repeated imports", () => {
  const saved = FileManager.buildProjectPayload({
    activeScenarioId: "tno_1962", activeScenarioManifest: { version: 1 },
    sovereignBaseColors: { MAG: "#abcdef", MGN: "#123456" }, activeSovereignCode: "MAG",
  });
  assert.equal(saved.scenario.tagMigrationVersion, TNO_TAG_MIGRATION_VERSION);
  const imported = FileManager.normalizeImportedProjectData(saved);
  const again = FileManager.normalizeImportedProjectData(imported);
  assert.deepEqual(again.sovereignBaseColors, saved.sovereignBaseColors);
  assert.equal(again.activeSovereignCode, "MAG");
});

test("other scenarios retain their original tags", () => {
  for (const id of ["hoi4_1936", "modern_world"]) {
    const imported = FileManager.normalizeImportedProjectData({
      scenario: { id }, sovereignBaseColors: { MAG: "#123456", RSF: "#abcdef" }, activeSovereignCode: "MAG",
    });
    assert.deepEqual(imported.sovereignBaseColors, { MAG: "#123456", RSF: "#abcdef" });
    assert.equal(imported.activeSovereignCode, "MAG");
    assert.equal(imported.scenario.tagMigrationVersion, undefined);
  }
});
