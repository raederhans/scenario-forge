import assert from "node:assert/strict";
import test from "node:test";
import { state } from "../js/core/state.js";
import { makeFixture } from "./helpers/river_paint_fixture.mjs";
import { harness } from "./helpers/toolbar_document_fixture.mjs";
import { mountLocalHistoryPanel } from "../js/ui/local_history_panel.js";
import { getTerritoryChanges, formatTerritorySummary, buildTerritoryChangesCsv } from "../js/core/territory_change_summary.js";

test("territory summary groups baseline transfers by painted country, including unloaded parcels", () => {
  Object.assign(state, {
    activeScenarioId: "test", currentLanguage: "zh",
    scenarioBaselineOwnersByFeatureId: { a: "PL", b: "PL", c: "DE", d: "PL" },
    scenarioCountriesByTag: {
      DE: { display_name_en: "Germany", display_name_zh: "德国" },
      PL: { display_name_en: "Poland", display_name_zh: "波兰" },
    },
    sovereignBaseColors: { ALIAS: "#aa1122", DE: "#aa1122", PL: "#1122aa" },
    visualOverrides: { a: "#AA1122", b: "#aa1122", c: "#aa1122", d: "#888888" },
    landIndex: new Map([["a", { properties: { name: '=Port, "A"' } }]]),
  });
  const rows = getTerritoryChanges(state);
  assert.deepEqual(rows, [
    { id: "a", name: '=Port, "A"', from: "PL", to: "DE" },
    { id: "b", name: "b", from: "PL", to: "DE" },
    { id: "d", name: "d", from: "PL", to: "color:#888888" },
  ]);
  assert.match(formatTerritorySummary(rows, state), /德国从波兰获得 2 块（=Port, "A"、b）。/);
  state.currentLanguage = "en";
  assert.match(formatTerritorySummary(rows, state), /Germany gained 2 parcels from Poland/);
  assert.equal(buildTerritoryChangesCsv(rows), [
    "\ufefffeature_id,name,original_owner,current_owner",
    '"a","\'=Port, ""A""","PL","DE"', '"b","b","PL","DE"', '"d","d","PL","color:#888888"',
  ].join("\r\n"));
  state.activeScenarioId = "";
  assert.equal(formatTerritorySummary(getTerritoryChanges(state), state), "No territory changes.");
});

test("a painted river parcel compares against its parent baseline without counting the parent twice", async () => {
  const { state, cells } = await makeFixture();
  state.scenarioBaselineOwnersByFeatureId = { P: "FR" };
  state.sovereignBaseColors.DE = "#aa1122";
  state.visualOverrides.P = "#aa1122";
  state.riverPaint = { ...state.riverPaint, overrides: { [cells[0].id]: "#ff0000" } };
  assert.deepEqual(getTerritoryChanges(state), [{ id: cells[1].id, name: "P", from: "FR", to: "DE" }]);
});

test("opening history reveals the project panel and binds each action to its displayed version", async context => {
  const { doc, add } = harness(context);
  const project = add("button", doc.body, "inspectorSidebarTabProject");
  const showProject = context.mock.fn();
  project.addEventListener("click", showProject);
  const details = add("details", doc.body, "localHistory");
  const summary = add("summary", details);
  const list = add("ul", details, "localHistoryList");
  add("input", details, "snapshotNote");
  for (const id of ["saveSnapshot", "territorySummaryButton", "territorySummaryPanel", "territorySummaryText",
    "copyTerritorySummary", "exportTerritoryChanges"]) add("div", doc.body, id);
  const records = ["First", "Second"].map(note => ({ note, type: "manual", scenarioName: "Europe",
    projectName: "Campaign", savedAt: Date.now(), payload: new Blob([note]) }));
  const manager = { listHistory: async () => records, restoreSnapshot: context.mock.fn(async () => {}),
    deleteSnapshot: context.mock.fn(async () => {}) };
  const panel = mountLocalHistoryPanel(manager);
  panel.openHistory();
  assert.equal(showProject.mock.callCount(), 1);
  assert.equal(doc.activeElement, summary);
  assert.equal(details.open, true);
  await panel.refreshHistory();
  assert.match(list.children[1].children[0].textContent, /Europe · Campaign .*Second/);
  list.children[1].children[1].click();
  list.children[0].children[2].click();
  assert.equal(manager.restoreSnapshot.mock.calls[0].arguments[0], records[1]);
  assert.equal(manager.deleteSnapshot.mock.calls[0].arguments[0], records[0]);
});
