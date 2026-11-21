import test from "node:test";
import assert from "node:assert/strict";
import { FileManager } from "../js/core/file_manager.js";
import { captureHistoryState, pushHistoryEntry, undoHistory } from "../js/core/history_manager.js";
import { state } from "../js/core/state.js";
import { normalizeAnnotationView } from "../js/core/state_defaults.js";
import { callRuntimeHook, registerRuntimeHook } from "../js/core/state/index.js";
import { createStrategicOverlayHelpersOwner } from "../js/core/renderer/strategic_overlay_helpers.js";
import { placeMapLabel } from "../js/core/map_renderer/public.js";
import { bindMapLabelPanel, createStrategicOverlayController } from "../js/ui/sidebar/strategic_overlay_controller.js";

const flags = ["showMapLabels", "showOperationalLines", "showOperationGraphics", "showUnitCounters"];

test("hidden annotations survive project save/import and older projects show all four categories", () => {
  const annotationView = Object.fromEntries(flags.map(key => [key, false]));
  const payload = FileManager.buildProjectPayload({ ...state, annotationView });
  const imported = FileManager.normalizeImportedProjectData(JSON.parse(JSON.stringify(payload)));
  for (const key of flags) assert.equal(imported.annotationView[key], false);
  delete payload.annotationView;
  const legacy = FileManager.normalizeImportedProjectData(payload);
  for (const key of flags) assert.equal(legacy.annotationView[key], true);
});

test("hiding a category hides its SVG group and graphic editing handles", () => {
  const state = { annotationView: {} };
  const groups = {};
  const getter = key => () => ({ attr(name, value) {
    if (name === "display") groups[key] = value;
  } });
  const owner = createStrategicOverlayHelpersOwner({ state, groupGetters: {
    getOperationalLinesGroup: getter("lines"), getOperationGraphicsGroup: getter("graphics"),
    getOperationGraphicsEditorGroup: getter("handles"), getUnitCountersGroup: getter("counters"),
  } });
  for (const [flag, render, group] of [
    ["showOperationalLines", owner.renderOperationalLinesOverlay, "lines"],
    ["showOperationGraphics", owner.renderOperationGraphicsOverlay, "graphics"],
    ["showUnitCounters", owner.renderUnitCountersOverlay, "counters"],
  ]) {
    state.annotationView[flag] = false;
    render();
    assert.equal(groups[group], "none");
    if (group === "graphics") assert.equal(groups.handles, "none");
  }
});

class Control extends EventTarget {
  dataset = {};
  style = {};
  classList = { toggle() {} };
  children = [];
  setAttribute(name, value) { this[name] = value; }
  replaceChildren() { this.children = []; }
  appendChild(node) { this.children.push(node); }
}

test("toolbar and shortcut hook open lettering and show the placement hint; layer controls record history", t => {
  const controls = new Map();
  const get = key => {
    if (!controls.has(key)) controls.set(key, new Control());
    return controls.get(key);
  };
  const toggles = flags.map(key => Object.assign(new Control(), { dataset: { annotationView: key } }));
  const doc = Object.assign(new EventTarget(), {
    getElementById: get, body: new Control(), querySelector: () => null,
    querySelectorAll: () => toggles, createElement: () => new Control(),
  });
  get("editorLayer-annotations").click = () => {};
  globalThis.document = doc;
  globalThis.HTMLSelectElement = Control;
  t.after(() => {
    registerRuntimeHook(state, "runMapTextToolFn", null);
    delete globalThis.document;
    delete globalThis.HTMLSelectElement;
  });
  const section = Object.assign(new Control(), { ownerDocument: doc, querySelector: get, querySelectorAll: () => [] });
  state.annotationView = normalizeAnnotationView({});
  state.mapLabels = [];
  const controller = createStrategicOverlayController({ state, elements: {
    mapLabelSection: section, mapLabelSectionToggle: new Control(), strategicOverlaySection: new Control(),
    strategicCommandButtons: [], unitCounterStatsPresetButtons: [],
  }, helpers: {
    mapRenderer: { cancelActiveStrategicInteractionModes() { state.mapLabelEditor.active = false; } },
    t: key => key, normalizeAnnotationView, captureHistoryState, pushHistoryEntry, markDirty() {}, render() {},
    getUnitCounterPresetMeta: () => ({}), clampUnitCounterFixedScaleMultiplier: Number,
    resolveUnitCounterCombatState: () => ({}), getUnitCounterNationOptions: () => [],
  } });
  controller.bindEvents();
  for (const start of [() => get("toolMapTextBtn").dispatchEvent(new Event("click")), () => callRuntimeHook(state, "runMapTextToolFn")]) {
    start();
    assert.deepEqual([state.strategicOverlayUi.modalSection, state.mapLabelEditor.active, section.hidden], ["label", true, false]);
    assert.equal(get("mapLabelPlacementHint").hidden, false);
    assert.equal(get("#mapLabelList").children[0].textContent, "Place a label to start lettering the map.");
    doc.dispatchEvent(Object.assign(new Event("keydown"), { key: "Escape" }));
    controller.refreshUI({ scopes: "workspaceChrome" });
    assert.equal(get("mapLabelPlacementHint").hidden, true);
  }
  for (const toggle of toggles) {
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    assert.equal(state.annotationView[toggle.dataset.annotationView], false);
    undoHistory();
    assert.equal(state.annotationView[toggle.dataset.annotationView], true);
  }
});

test("Ctrl+D copies the selected label and arrows nudge the copy in undoable steps", () => {
  state.mapLabels = [];
  state.strategicOverlayUi.modalOpen = true;
  state.strategicOverlayUi.modalSection = "label";
  placeMapLabel({ text: "Harbor", lon: 2, lat: 3, size: 23, rotation: 40, colorMode: "light" });
  const original = state.mapLabels[0];
  const doc = new EventTarget();
  bindMapLabelPanel({ state, section: { ownerDocument: doc, querySelector: () => new Control(), querySelectorAll: () => [] },
    refresh() {}, startPlacement() {} });
  const press = (key, ctrlKey = false) => doc.dispatchEvent(Object.assign(new Event("keydown"), { key, ctrlKey }));
  press("d", true);
  const copy = state.mapLabels[1];
  assert.equal(state.mapLabelEditor.selectedId, copy.id);
  assert.notEqual(copy.id, original.id);
  assert.notEqual(copy.lon, original.lon);
  assert.deepEqual(copy, { ...original, id: copy.id, lon: copy.lon, lat: copy.lat });
  press("ArrowUp");
  assert.ok(state.mapLabels[1].lat > copy.lat);
  assert.deepEqual(state.mapLabels[0], original);
  undoHistory();
  assert.deepEqual(state.mapLabels[1], copy);
  undoHistory();
  assert.deepEqual(state.mapLabels, [original]);
});

test("dragging a slider updates its readout and typing an exact size commits a numeric value", () => {
  const id = placeMapLabel({ text: "Harbor", lon: 2, lat: 3 });
  const fields = ["size", "rotation"].map(key => Object.assign(new Control(), { type: "range", dataset: { labelField: key } }));
  const size = Object.assign(new Control(), { type: "number", dataset: { labelField: "size" } });
  const rotation = new Control();
  const readouts = { '[data-label-readout="size"]': size, '[data-label-readout="rotation"]': rotation };
  bindMapLabelPanel({ state, startPlacement() {}, refresh() {}, section: {
    ownerDocument: new EventTarget(), querySelector: key => readouts[key] || new Control(), querySelectorAll: () => [...fields, size],
  } });
  for (const [index, value] of ["7.15", "-25"].entries()) {
    fields[index].value = value;
    fields[index].dispatchEvent(new Event("input"));
  }
  assert.equal(size.value, "7.15");
  assert.equal(rotation.value, "-25");
  size.value = "3.75";
  size.dispatchEvent(new Event("change"));
  assert.equal(state.mapLabels.find(label => label.id === id).size, 3.75);
});
