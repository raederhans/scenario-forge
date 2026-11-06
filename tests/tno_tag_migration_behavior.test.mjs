import test from "node:test";
import assert from "node:assert/strict";
import { FileManager } from "../js/core/file_manager.js";
import { migrateImportedProjectData } from "../js/core/sovereignty_manager.js";
import { TNO_TAG_MIGRATION_VERSION } from "../js/core/country_code_aliases.js";

for (const [legacy, successor] of Object.entries({ ALC: "SLG", PAL: "IME", SYR: "SNS", KUR: "BKU" })) {
  test(`retired ${legacy} project edits import as ${successor}`, () => {
    for (const version of [0, 2]) {
      for (const colorField of ["sovereignBaseColors", "countryBaseColors"]) {
        const original = {
          scenario: { id: "tno_1962", ...(version ? { tagMigrationVersion: version } : {}) },
          [colorField]: { [legacy]: "#123456", [successor]: "#abcdef", GER: "#555555" },
          activeSovereignCode: legacy,
          customPresets: { [legacy]: [{ name: "custom", featureIds: ["saved-feature"] }] },
          parentBorderEnabledByCountry: { [legacy]: false },
          releasableBoundaryVariantByTag: { [legacy]: "historical" },
          visualOverrides: { "saved-feature": "#010101" },
        };
        const imported = FileManager.normalizeImportedProjectData(JSON.parse(JSON.stringify(original)));
        assert.deepEqual(imported.sovereignBaseColors, { [successor]: "#123456", GER: "#555555" });
        assert.equal(imported.activeSovereignCode, successor);
        assert.deepEqual(imported.customPresets, { [successor]: original.customPresets[legacy] });
        assert.deepEqual(imported.parentBorderEnabledByCountry, { [successor]: false });
        assert.deepEqual(imported.releasableBoundaryVariantByTag, { [successor]: "historical" });
        assert.deepEqual(imported.visualOverrides, original.visualOverrides);
        assert.equal(imported.scenario.tagMigrationVersion, TNO_TAG_MIGRATION_VERSION);
        const again = FileManager.normalizeImportedProjectData(imported);
        assert.equal(again.activeSovereignCode, successor);
        assert.equal(again.scenario.tagMigrationVersion, TNO_TAG_MIGRATION_VERSION);
        for (const field of ["sovereignBaseColors", "customPresets",
          "parentBorderEnabledByCountry", "releasableBoundaryVariantByTag"]) {
          assert.deepEqual(again[field], imported[field]);
          assert.equal(Object.hasOwn(again[field], legacy), false);
        }
      }
    }
  });
}

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

test("shipped TNO releasables offer no tag that project import migrates away", async () => {
  const { migrateTnoProjectTags } = await import("../js/core/country_code_aliases.js");
  const { readFile } = await import("node:fs/promises");
  const catalog = JSON.parse(await readFile(new URL("../data/releasables/tno_1962.internal.phase1.catalog.json", import.meta.url), "utf8"));
  const retired = catalog.entries.map(entry => entry.tag).filter(tag =>
    migrateTnoProjectTags({ scenario: { id: "tno_1962" }, activeSovereignCode: tag }).activeSovereignCode !== tag);
  assert.deepEqual(retired, []);
});
