import test from "node:test";
import assert from "node:assert/strict";

import { state } from "../js/core/state.js";

import { markDirty } from "../js/core/dirty_state.js";
import { t as translate } from "../js/core/i18n.js";
import { createProjectSupportDiagnosticsController } from "../js/ui/sidebar/project_support_diagnostics_controller.js";
import { strToU8, zipSync } from "../vendor/fflate.browser.js";
import { harness } from "./helpers/toolbar_document_fixture.mjs";

function createMountDocument(context) {
  const { doc, add } = harness(context);
  const createElement = doc.createElement;
  doc.createElement = tag => {
    const node = createElement(tag);
    if (tag === "dialog") {
      node.showModal = () => { node.open = true; };
      node.close = () => { node.open = false; node.fire("close"); };
    }
    return node;
  };
  return { documentRef: doc, hosts: { projectManagementStack: add() } };
}

function change(input) {
  return input.listeners.get("change")[0].handler({ target: input });
}

function createController({ documentRef, hosts, state: runtimeState = state, helpers }) {
  return createProjectSupportDiagnosticsController({
    state: runtimeState, documentRef, hosts,
    helpers: { t: key => key, mapRenderer: {}, ...helpers },
  });
}

test("merging a preview requires fresh confirmation after an edit", async context => {
  const fixture = createMountDocument(context);
  const get = fixture.documentRef.getElementById;
  const initial = { activeScenarioId: "target", currentLanguage: "en", isDirty: true, dirtyRevision: 1,
    historyPast: [], historyFuture: [], runtimeFeatureIds: ["A", "B"], scenarioBaselineOwnersByFeatureId: { A: "BBB" },
    scenarioCountriesByTag: { AAA: {}, BBB: {} }, sovereignBaseColors: { AAA: "#aabbcc", BBB: "#123456" },
    landIndex: new Map(), visualOverrides: { A: "#111111" }, projectFileBinding: { handle: { name: "local.json" } },
    projectName: "Local", projectFileStem: "local" };
  const saved = Object.fromEntries(Object.keys(initial).map(key => [key, state[key]]));
  Object.assign(state, initial);
  context.after(() => Object.assign(state, saved));
  const alerts = [];
  createController({ ...fixture, helpers: { t: translate,
    showToast: message => alerts.push(message) } }).bindEvents();
  const input = get("mergeProjectFileInput");
  const project = { projectName: "Other", colors: { A: "#abc", B: "#def", LOST_1: "#abc", LOST_2: "#abc" },
    legendLabels: { "#def": "River bank" } };
  const zip = new Blob([zipSync({ "map_project.json": strToU8(JSON.stringify(project)) })], { type: "application/zip" });
  input.files = [Object.assign(zip, { name: "merge.zip" })];
  await change(input);
  const dialog = fixture.documentRef.querySelector("dialog");
  assert.ok(dialog?.open, alerts.join("\n"));
  const apply = dialog.querySelectorAll("button").find(node => node.textContent === "Apply");
  const overwrite = dialog.querySelectorAll("label").find(node => node.textContent === "Overwrite painted parcels").children[0];
  overwrite.checked = true;
  overwrite.fire("change");
  const keepOriginal = dialog.querySelectorAll("label").find(node => node.textContent === "Keep original colors").children[0];
  keepOriginal.checked = true;
  keepOriginal.fire("change");
  state.landIndex.set("LOST_2", { geometry: {} });
  state.visualOverrides = { A: "#111111", B: "#ddeeff" };
  markDirty("another-edit");
  apply.click();
  assert.equal(dialog.open, true);
  assert.equal(state.historyPast.length, 0);
  apply.click();
  assert.equal(dialog.open, false);
  assert.equal(state.visualOverrides.A, "#aabbcc");
  assert.equal(state.historyPast.length, 1);
});

test("a pending whole-project ZIP preview rejects a merge before the file is read", async context => {
  const fixture = createMountDocument(context);
  const get = fixture.documentRef.getElementById;
  const alerts = [];
  const order = [];
  let opened, confirm;
  const pending = new Promise(resolve => { opened = resolve; });
  const controller = createController({ ...fixture, state: { isDirty: true }, helpers: {
    showToast: text => alerts.push(text),
    showAppDialog: ({ title }) => {
      order.push(title);
      if (title === "Load Project") return true;
      opened();
      return new Promise(resolve => { confirm = resolve; });
    },
    importProjectThroughFunnel: () => { order.push("import"); },
  } });
  controller.bindEvents();
  const zip = new Blob([zipSync({ "map_project.json": strToU8("{}") })], { type: "application/zip" });
  get("projectFileInput").files = [Object.assign(zip, { name: "open.zip" })];
  const opening = change(get("projectFileInput"));
  await pending;
  try {
    get("mergeProjectFileInput").files = [{ name: "source.json" }];
    await change(get("mergeProjectFileInput"));
    assert.deepEqual(alerts, ["Project import is already in progress."]);
  } finally {
    confirm(true);
    await opening;
  }
  assert.deepEqual(order, ["Load Project", "Load Project Package", "import"]);
});
