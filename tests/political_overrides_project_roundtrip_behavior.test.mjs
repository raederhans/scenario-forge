import test from "node:test";
import assert from "node:assert/strict";

import { FileManager } from "../js/core/file_manager.js";
import { stageImportedProjectPatch } from "../js/core/interaction_funnel.js";
import { commitImportedProjectPatch } from "../js/core/interaction_funnel/import_apply_orchestration.js";

import { registerProjectCountryState } from "../js/core/project_countries.js";

test("project save, normalize and staged import remap political overrides with project countries", () => {
  const source = { activeScenarioId: "sample", politicalOverrides: { P01: { alliance: "custom_4", ideology: "communism" } },
    politicalAlliances: { custom_4: { name: "League", color: "#123456" } } };
  registerProjectCountryState(source, { tag: "P01", name: "North", color: "#abcdef" });
  const saved = FileManager.buildProjectPayload(source);
  assert.equal(saved.schemaVersion, 22);
  const data = FileManager.normalizeImportedProjectData(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(data.politicalOverrides, source.politicalOverrides);
  assert.deepEqual(data.politicalAlliances, source.politicalAlliances);
  const { patch, dropped } = stageImportedProjectPatch(data, {
    scenarioState: { activeScenarioId: "sample", scenarioCountriesByTag: { P01: { tag: "P01" } } },
    preparedScenario: { staged: { scenarioColorMap: { P01: "#654321" } } },
    importedOwnershipState: { sovereigntyByFeatureId: {} },
  });
  const target = {};
  commitImportedProjectPatch(target, patch);
  assert.deepEqual(dropped, []);
  assert.deepEqual(target.politicalOverrides, { P02: source.politicalOverrides.P01 });
  assert.deepEqual(target.politicalAlliances, source.politicalAlliances);
});

test("political import rejects prototype keys and malformed fields, preserving valid parts of entries", () => {
  const politicalOverrides = JSON.parse('{"__proto__":{"alliance":null},"constructor":{"ideology":"fascism"},"prototype":{"alliance":"axis"}}');
  Object.assign(politicalOverrides, {
    AA: { alliance: "constructor", ideology: "democratic" }, BB: { alliance: "__proto__", ideology: "prototype" },
    CC: { alliance: null, ideology: "__proto__" }, DD: { alliance: "axis", ideology: "constructor" },
    EE: { alliance: "a".repeat(65), ideology: "a".repeat(41) },
    FF: { alliance: "A", ideology: "party9" }, uk: { ideology: "unknown", alliance: "custom_9" },
  });
  const politicalAlliances = { custom_0: { name: "Bad", color: "#fff" }, custom_99: { name: "Bad", color: "invalid" } };
  for (let n = 1; n <= 17; n++) politicalAlliances["custom_" + n] = { name: "🌍".repeat(121), color: "#" + n.toString(16).padStart(6, "0") };
  const data = FileManager.normalizeImportedProjectData({ politicalOverrides, politicalAlliances });
  assert.deepEqual(data.politicalOverrides, { AA: { ideology: "democratic" }, CC: { alliance: null },
    DD: { alliance: "axis" }, GB: { ideology: "unknown", alliance: "custom_9" } });
  assert.equal(Object.keys(data.politicalAlliances).length, 16);
  assert.equal(data.politicalAlliances.custom_16.name, "🌍".repeat(120));
  assert.equal(Object.hasOwn(data.politicalAlliances, "custom_17"), false);
});
