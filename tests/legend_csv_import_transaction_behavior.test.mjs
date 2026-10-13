import { captureScenarioActivationState, restoreScenarioActivationState } from "../js/core/state/actions/scenario_activation_actions.js";
import { captureScenarioPaletteState, restoreScenarioPaletteState } from "../js/core/state/actions/scenario_palette_actions.js";
import { restoreProjectImportFields as restoreFixtureSpecialZones, setSpecialZonesOverlayDirtyState } from "../js/core/state/actions/special_zone_actions.js";
import { restoreHistoryStacksState } from "../js/core/state/actions/history_actions.js";
import { restoreDirtyMetadataState } from "../js/core/state/actions/ui_dirty_actions.js";
import { replaceResolvedColorsState } from "../js/core/state/color_state.js";
import test from "node:test";
import assert from "node:assert/strict";
import { state } from "../js/core/state.js";
import { buildLegendCsvCurrentModel } from "../js/core/legend_csv_schema.js";
import { buildLegendCsvImportPreview } from "../js/core/legend_csv_import_preview.js";
import { applyLegendCsvImport } from "../js/core/legend_csv_import_transaction.js";
import { buildLegendCsv } from "../js/ui/sidebar/legend_export.js";
import { undoHistory, redoHistory } from "../js/core/history_manager.js";
import { readRegisteredRuntimeHookSource, registerRuntimeHook } from "../js/core/state/index.js";


// Real singleton integration tests prepare/restore through its domain owners.
function patchFixture(patch) {
  const activationKeys = ["activeScenarioId", "scenarioBaselineHash", "sovereigntyByFeatureId", "sovereignBaseColors", "visualOverrides", "riverPaint"];
  const paletteKeys = ["legendLabels", "legendConfig"];
  const allowed = [...activationKeys, ...paletteKeys, "colors", "specialZoneLayers", "specialZonesOverlayDirty", "historyPast", "historyFuture", "isDirty", "dirtyRevision", "lastDirtyReason"];
  if (Object.keys(patch).some(key => !allowed.includes(key))) throw new Error("Unknown fixture domain field");
  const activationUpdates = Object.fromEntries(activationKeys.filter(key => Object.hasOwn(patch, key)).map(key => [key, patch[key]]));
  if (Object.keys(activationUpdates).length) {
    const snapshot = captureScenarioActivationState(state);
    restoreScenarioActivationState(state, { values: { ...snapshot.values, ...activationUpdates },
      presentKeys: [...new Set([...snapshot.presentKeys, ...Object.keys(activationUpdates)])] });
  }
  const paletteUpdates = Object.fromEntries(paletteKeys.filter(key => Object.hasOwn(patch, key)).map(key => [key, patch[key]]));
  if (Object.keys(paletteUpdates).length) {
    const snapshot = captureScenarioPaletteState(state);
    restoreScenarioPaletteState(state, { values: { ...snapshot.values, ...paletteUpdates },
      presentKeys: [...new Set([...snapshot.presentKeys, ...Object.keys(paletteUpdates)])] });
  }
  if (Object.hasOwn(patch, "colors")) replaceResolvedColorsState(state, patch.colors);
  if (Object.hasOwn(patch, "specialZoneLayers")) restoreFixtureSpecialZones(state, { specialZoneLayers: patch.specialZoneLayers });
  if (Object.hasOwn(patch, "specialZonesOverlayDirty")) setSpecialZonesOverlayDirtyState(state, patch.specialZonesOverlayDirty);
  if (Object.hasOwn(patch, "historyPast") || Object.hasOwn(patch, "historyFuture")) restoreHistoryStacksState(state,
    Object.hasOwn(patch, "historyPast") ? patch.historyPast : state.historyPast,
    Object.hasOwn(patch, "historyFuture") ? patch.historyFuture : state.historyFuture);
  if (["isDirty", "dirtyRevision", "lastDirtyReason"].some(key => Object.hasOwn(patch, key))) restoreDirtyMetadataState(state, {
    isDirty: Object.hasOwn(patch, "isDirty") ? patch.isDirty : state.isDirty,
    dirtyRevision: Object.hasOwn(patch, "dirtyRevision") ? patch.dirtyRevision : state.dirtyRevision,
    lastDirtyReason: Object.hasOwn(patch, "lastDirtyReason") ? patch.lastDirtyReason : state.lastDirtyReason,
  });
}

function fixture(t) {
  const keys = ["activeScenarioId", "scenarioBaselineHash", "colors", "legendLabels", "legendConfig",
    "specialZoneLayers", "specialZonesOverlayDirty", "historyPast", "historyFuture", "isDirty", "dirtyRevision", "lastDirtyReason",
    "visualOverrides", "sovereigntyByFeatureId", "sovereignBaseColors", "riverPaint"];
  const saved = Object.fromEntries(keys.map(key => [key, state[key]]));
  const oldDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };
  patchFixture({
    activeScenarioId: "scenario-a", scenarioBaselineHash: "baseline-a", colors: { A: "#abcdef" },
    legendLabels: { "#abcdef": "Original", "#123456": "Unrelated" }, legendConfig: { maxItems: 15 },
    specialZoneLayers: { version: 1, topologyFingerprint: "topology-a", activeLayerId: "zone-a", extra: { untouched: true }, layers: [
      { id: "zone-a", name: "Original zone", source: "project", visible: true, legendVisible: true,
        memberFeatureIds: ["B", "A"], metadata: { untouched: true },
        style: { fill: "#8b5cf6", stroke: "#6d28d9", pattern: "solid", fillOpacity: 0.32,
          strokeOpacity: 0.92, patternOpacity: 0.42, strokeWidth: 1.3, revision: 4, extra: "preserved" } },
      { id: "unrelated", name: "Other", memberFeatureIds: ["C"], style: { fill: "#123456", extra: "also preserved" } },
    ] }, historyPast: [], historyFuture: [], isDirty: false, lastDirtyReason: "", specialZonesOverlayDirty: false,
    visualOverrides: { A: "#abcdef" }, sovereigntyByFeatureId: { A: "USA", B: "CAN" },
    sovereignBaseColors: { USA: "#112233" }, riverPaint: null,
  });
  t.after(() => { patchFixture(saved); if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument; });
  return buildLegendCsvCurrentModel(state);
}
function proposedCsv(model, transform = entries => entries) {
  return buildLegendCsv(transform(model.entries.map(entry => ({ ...entry }))), { schemaVersion: 2, ...model });
}
const previewOf = (source, model) => buildLegendCsvImportPreview(source, model.entries, model);
const errorCode = code => error => error.code === code;

test("confirmed selected IDs update names and zone styles in one undoable transaction without territorial writes", t => {
  const model = fixture(t);
  const untouched = JSON.stringify({ colors: state.colors, owners: state.sovereigntyByFeatureId,
    overrides: state.visualOverrides, bases: state.sovereignBaseColors, palette: state.countryPalette });
  const originalZone = structuredClone(state.specialZoneLayers.layers[0]);
  const otherZone = state.specialZoneLayers.layers[1];
  const source = proposedCsv(model, entries => entries.map(entry => entry.kind === "color"
    ? { ...entry, label: '<img src=x onerror="alert(1)">' }
    : entry.entryId === "special-zone:zone-a" ? { ...entry, label: "Renamed zone", color: "#123456", pattern: "dots", strokeWidth: 2 } : entry));
  const preview = previewOf(source, model);
  const selectedRecords = preview.rows.filter(row => row.canApply).map(row => row.record);
  const result = applyLegendCsvImport({ source, selectedRecords, preview, confirmed: true });
  assert.equal(result.appliedCount, 2);
  assert.equal(state.historyPast.length, 1);
  assert.equal(state.historyPast[0].kind, "legend-csv-import");
  assert.equal(state.legendLabels["#abcdef"], '<img src=x onerror="alert(1)">');
  assert.equal(state.specialZoneLayers.layers[0].name, "Renamed zone");
  assert.equal(state.specialZoneLayers.layers[0].style.fill, "#123456");
  assert.equal(state.specialZoneLayers.layers[0].style.revision, 5);
  assert.equal(state.specialZoneLayers.layers[1], otherZone);
  assert.deepEqual(state.specialZoneLayers.layers[0].memberFeatureIds, ["B", "A"]);
  assert.equal(state.specialZoneLayers.layers[0].style.extra, "preserved");
  assert.equal(state.lastDirtyReason, "legend-csv-import");
  assert.equal(undoHistory(), true);
  assert.equal(state.legendLabels["#abcdef"], "Original");
  assert.deepEqual(state.specialZoneLayers.layers[0], originalZone);
  assert.equal(state.legendLabels["#123456"], "Unrelated");
  assert.equal(redoHistory(), true);
  assert.equal(state.specialZoneLayers.layers[0].style.fill, "#123456");
  assert.equal(JSON.stringify({ colors: state.colors, owners: state.sovereigntyByFeatureId,
    overrides: state.visualOverrides, bases: state.sovereignBaseColors, palette: state.countryPalette }), untouched);
});

test("missing confirmation, legacy, unknown selection and stale target reject before every write", t => {
  const model = fixture(t);
  const source = proposedCsv(model, entries => entries.map(entry => entry.kind === "color" ? { ...entry, label: "New" } : entry));
  const preview = previewOf(source, model);
  const before = JSON.stringify({ labels: state.legendLabels, zones: state.specialZoneLayers, history: state.historyPast });
  assert.throws(() => applyLegendCsvImport({ source, selectedRecords: [2], preview }), errorCode("confirmation-required"));
  assert.throws(() => applyLegendCsvImport({ source: `${source} `, selectedRecords: [2], preview, confirmed: true }), errorCode("confirmation-required"));
  assert.throws(() => applyLegendCsvImport({ source, selectedRecords: [999], preview, confirmed: true }), errorCode("stale-preview"));
  assert.throws(() => applyLegendCsvImport({ source, selectedRecords: [], preview, confirmed: true }), errorCode("no-selection"));
  const legacy = buildLegendCsv(model.entries);
  assert.throws(() => applyLegendCsvImport({ source: legacy, selectedRecords: [2], preview: previewOf(legacy, model), confirmed: true }), errorCode("legacy-readonly"));
  assert.equal(JSON.stringify({ labels: state.legendLabels, zones: state.specialZoneLayers, history: state.historyPast }), before);
  patchFixture({ legendLabels: { ...state.legendLabels, "#abcdef": "Edited after preview" } });
  assert.throws(() => applyLegendCsvImport({ source, selectedRecords: [2], preview, confirmed: true }), errorCode("stale-preview"));
  assert.equal(state.legendLabels["#abcdef"], "Edited after preview");
  assert.equal(state.historyPast.length, 0);
});

test("scope change or one unsafe selected row aborts the entire batch; unknown rows never create layers", t => {
  const model = fixture(t);
  const source = proposedCsv(model, entries => [...entries.map(entry => ({ ...entry, label: "Changed" })),
    { ...entries[1], entryId: "special-zone:unknown", label: "Unknown" }]);
  const preview = previewOf(source, model);
  assert.throws(() => applyLegendCsvImport({ source, selectedRecords: [2, 5], preview, confirmed: true }), errorCode("stale-preview"));
  assert.equal(state.legendLabels["#abcdef"], "Original");
  patchFixture({ scenarioBaselineHash: "another-baseline" });
  assert.throws(() => applyLegendCsvImport({ source, selectedRecords: [2, 3], preview, confirmed: true }), errorCode("stale-preview"));
  patchFixture({ scenarioBaselineHash: model.scenarioBaselineHash });
  const result = applyLegendCsvImport({ source, selectedRecords: [2], preview, confirmed: true });
  assert.equal(result.appliedCount, 1);
  assert.equal(state.specialZoneLayers.layers.length, 2);
  assert.equal(state.specialZoneLayers.layers[0].name, "Original zone");
});

test("clearing a category name is reversible and unchanged exports produce no eligible writes", t => {
  const model = fixture(t);
  const unchanged = previewOf(proposedCsv(model), model);
  assert.equal(unchanged.counts.applicable, 0);
  assert.equal(state.historyPast.length, 0);
  const source = proposedCsv(model, entries => entries.map(entry => entry.kind === "color" ? { ...entry, label: "", labelValue: "" } : entry));
  const preview = previewOf(source, model);
  applyLegendCsvImport({ source, selectedRecords: [2], preview, confirmed: true });
  assert.equal(Object.hasOwn(state.legendLabels, "#abcdef"), false);
  undoHistory();
  assert.equal(state.legendLabels["#abcdef"], "Original");
});

test("zone name, style or membership changes after preview reject the whole selected batch", t => {
  const model = fixture(t);
  const source = proposedCsv(model, entries => entries.map(entry => ({ ...entry, label: "Changed" })));
  const preview = previewOf(source, model);
  const original = state.specialZoneLayers.layers[0];
  for (const replacement of [{ ...original, name: "Other editor" },
    { ...original, style: { ...original.style, strokeWidth: 3 } },
    { ...original, memberFeatureIds: ["C"] }]) {
    patchFixture({ specialZoneLayers: { ...state.specialZoneLayers, layers: [replacement, state.specialZoneLayers.layers[1]] } });
    assert.throws(() => applyLegendCsvImport({ source, selectedRecords: [2, 3], preview, confirmed: true }), errorCode("stale-preview"));
    assert.equal(state.legendLabels["#abcdef"], "Original");
    assert.equal(state.specialZoneLayers.layers[0], replacement);
    assert.equal(state.historyPast.length, 0);
  }
});

test("failed history recording rolls back all edited fields and preserves both history stacks", t => {
  fixture(t);
  const savedHook = readRegisteredRuntimeHookSource(state, "updateHistoryUIFn");
  t.after(() => registerRuntimeHook(state, "updateHistoryUIFn", savedHook));
  registerRuntimeHook(state, "updateHistoryUIFn", () => { throw new Error("history UI failed"); });
  patchFixture({ historyPast: [{ kind: "prior", before: {}, after: { labels: "prior" } }] });
  patchFixture({ historyFuture: [{ kind: "future", before: {}, after: { labels: "future" } }] });
  const zone = state.specialZoneLayers.layers[0];
  const noStyle = { ...zone };
  delete noStyle.style;
  for (const raw of [zone, { ...zone, style: { ...zone.style, stroke: null } }, noStyle, { ...zone, style: null }]) {
    patchFixture({ specialZoneLayers: { ...state.specialZoneLayers, layers: [raw, state.specialZoneLayers.layers[1]] } });
    const model = buildLegendCsvCurrentModel(state);
    const before = JSON.stringify({ labels: state.legendLabels, zones: state.specialZoneLayers,
      past: state.historyPast, future: state.historyFuture, dirty: state.isDirty, zoneDirty: state.specialZonesOverlayDirty });
    const source = proposedCsv(model, entries => entries.map(entry => ({ ...entry, label: "Changed" })));
    assert.throws(() => applyLegendCsvImport({ source, selectedRecords: [2, 3], preview: previewOf(source, model), confirmed: true }), /history UI failed/u);
    assert.equal(JSON.stringify({ labels: state.legendLabels, zones: state.specialZoneLayers,
      past: state.historyPast, future: state.historyFuture, dirty: state.isDirty, zoneDirty: state.specialZonesOverlayDirty }), before);
  }
});
