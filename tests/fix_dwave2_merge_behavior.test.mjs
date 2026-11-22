import assert from "node:assert/strict";
import test from "node:test";
import { prepareProjectMergeFile } from "../js/core/project_merge_funnel.js";
import { state } from "../js/core/state.js";
import { initShortcuts } from "../js/ui/shortcuts.js";
import { createProjectSupportDiagnosticsController } from "../js/ui/sidebar/project_support_diagnostics_controller.js";
import { realPilot } from "./helpers/river_paint_fixture.mjs";
import { harness } from "./helpers/toolbar_document_fixture.mjs";

function setDocument(t, fields) {
  const original = Object.fromEntries(Object.keys(fields).map(key => [key, state[key]]));
  Object.assign(state, fields);
  t.after(() => Object.assign(state, original));
}

const file = payload => ({ name: "paint.json", text: async () => JSON.stringify(payload) });

test("same-scenario merge recognizes a releasable country's unchanged base color", async t => {
  const id = "hoi4_1939";
  const countries = { GER: { color_hex: "#123456" } };
  const entry = { tag: "BAY", color_hex: "#334455", scenario_ids: [id],
    preset_source: { type: "feature_ids", feature_ids: ["A"] } };
  setDocument(t, { activeScenarioId: id, scenarioBundleCacheById: { [id]: { bundleLevel: "bootstrap",
    countriesPayload: { countries }, ownersPayload: { owners: { A: "GER" } } } },
    releasableCatalog: { entries: [entry] }, scenarioCountriesByTag: { ...countries, BAY: entry },
    sovereignBaseColors: { GER: "#123456", BAY: "#334455" }, scenarioBaselineOwnersByFeatureId: { A: "GER" },
    visualOverrides: {}, historyPast: [], historyFuture: [] });
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, json: async () => ({}) }));
  const preview = await prepareProjectMergeFile(file({ scenario: { id }, colors: { A: "#334455" } }));
  const merge = preview();
  assert.equal(merge.commit(), "merged");
  assert.deepEqual(state.visualOverrides, { A: "#334455" });
  assert.deepEqual(merge.report.colorChanges, []);
});

test("only an approved river pack bound to the source project can supply parent paint", async t => {
  const pack = realPilot();
  const { parentId, cells } = pack.parents[0];
  const overrides = Object.fromEntries(cells.map(({ id }) => [id, "#abcdef"]));
  const scenario = { id: pack.sceneId, baselineHash: pack.source.baselineHash };
  setDocument(t, { activeScenarioId: "target", runtimeFeatureIds: ["land", parentId], visualOverrides: {},
    historyPast: [], historyFuture: [] });
  async function preview(sourcePack, sourceScenario) {
    const source = { scenario: sourceScenario, colors: { land: "#123456" }, riverPaint: { pack: sourcePack, overrides } };
    return (await prepareProjectMergeFile(file(source), { loadReference: async () => ({}) }))();
  }
  const approved = await preview(pack, scenario);
  assert.equal(approved.report.writtenCount, 2);
  const altered = { ...pack, source: { ...pack.source, baseCommit: "unreviewed" } };
  for (const [sourcePack, sourceScenario] of [[altered, scenario], [pack, { ...scenario, id: "other" }],
    [pack, { ...scenario, baselineHash: "other" }], [{}, scenario]]) {
    state.visualOverrides = {};
    const merge = await preview(sourcePack, sourceScenario);
    assert.deepEqual(merge.report.unmatchedIds.sort(), Object.keys(overrides).sort());
    assert.equal(merge.report.skippedCount, cells.length);
    assert.equal(merge.report.writtenCount, 1);
    assert.equal(merge.commit(), "merged");
    assert.deepEqual(state.visualOverrides, { land: "#123456" });
  }
});

test("undo leaves map history intact while the merge report is open and resumes on close", async t => {
  const { doc, win } = harness(t);
  const createElement = doc.createElement;
  doc.createElement = tag => {
    const node = createElement(tag);
    if (tag === "dialog") {
      node.showModal = () => { node.open = true; };
      node.close = () => { node.open = false; node.fire("close"); };
    }
    return node;
  };
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, json: async () => ({}) }));
  const entry = { kind: "fill", before: { visualOverrides: { A: null } } };
  setDocument(t, { bootBlocking: false, startupReadonly: false, visualOverrides: { A: "#123456" },
    historyPast: [entry], historyFuture: [] });
  createProjectSupportDiagnosticsController({ documentRef: doc, hosts: { projectManagementStack: doc.body },
    state, helpers: { t: key => key, showToast: message => assert.fail(message) } });
  initShortcuts();
  const input = doc.getElementById("mergeProjectFileInput");
  input.files = [file({ colors: {} })];
  await input.listeners.get("change")[0].handler();
  const dialog = doc.querySelector("dialog");
  assert.ok(dialog.open);
  const button = dialog.querySelector(".btn-primary");
  button.focus();
  for (const modifier of ["ctrlKey", "metaKey"]) {
    win.fire("keydown", { key: "z", [modifier]: true, target: doc.activeElement });
    assert.deepEqual(state.historyPast, [entry]);
    assert.deepEqual(state.historyFuture, []);
  }
  dialog.close();
  win.fire("keydown", { key: "z", ctrlKey: true, target: doc.body });
  assert.deepEqual(state.historyPast, []);
  assert.deepEqual(state.historyFuture, [entry]);
});
