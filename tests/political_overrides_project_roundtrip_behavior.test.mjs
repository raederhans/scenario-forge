import test from "node:test";
import assert from "node:assert/strict";
import { state } from "../js/core/state.js";
import { FileManager } from "../js/core/file_manager.js";
import { stageImportedProjectPatch } from "../js/core/interaction_funnel.js";
import { commitImportedProjectPatch } from "../js/core/interaction_funnel/import_apply_orchestration.js";
import { commitScenarioForProjectImport, clearActiveScenario, resetToScenarioBaseline } from "../js/core/scenario_manager.js";
import { allocateProjectCountryTag, registerProjectCountryState, unregisterProjectCountryState } from "../js/core/project_countries.js";

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
  assert.ok(unregisterProjectCountryState(target, "P02"));
  assert.deepEqual(target.politicalOverrides, { P02: source.politicalOverrides.P01 });
  assert.equal(allocateProjectCountryTag(target), "P03");
  delete saved.politicalOverrides;
  delete saved.politicalAlliances;
  const legacy = FileManager.normalizeImportedProjectData(saved);
  assert.deepEqual(legacy.politicalOverrides, {});
  assert.deepEqual(legacy.politicalAlliances, {});
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

function setupScenario() {
  Object.assign(state, { activeScenarioId: "sample", bootBlocking: false,
    politicalOverrides: { AA: { alliance: "custom_1" } },
    politicalAlliances: { custom_1: { name: "League", color: "#123456" } } });
}

test("failed scenario import restores both original references, successful activation clears both", () => {
  setupScenario();
  const { politicalOverrides, politicalAlliances } = state;
  const prepared = { bundle: { manifest: { scenario_id: "next" } },
    staged: { scenarioId: "next", mapSemanticMode: "blank", countryMap: {}, resolvedOwners: {}, cores: {} } };
  const check = () => {
    assert.equal(state.activeScenarioId, "next");
    assert.deepEqual(state.politicalOverrides, {});
    assert.deepEqual(state.politicalAlliances, {});
  };
  assert.throws(() => commitScenarioForProjectImport(prepared, () => { check(); throw Error("cancel"); }, () => true), /cancel/);
  assert.equal(state.activeScenarioId, "sample");
  assert.equal(state.politicalOverrides, politicalOverrides);
  assert.equal(state.politicalAlliances, politicalAlliances);
  commitScenarioForProjectImport(prepared, check, () => true);
});

for (const action of [resetToScenarioBaseline, clearActiveScenario]) {
  test(`${action.name} clears both political tables`, () => {
    setupScenario();
    action({ renderNow: false });
    assert.deepEqual(state.politicalOverrides, {});
    assert.deepEqual(state.politicalAlliances, {});
  });
}
