import assert from "node:assert/strict";
import test from "node:test";
import { state } from "../js/core/state.js";
import { readRuntimeHook, registerRuntimeHook } from "../js/core/state/index.js";
import { normalizeExportWorkbenchUiState } from "../js/core/state_defaults.js";
import { undoHistory, redoHistory } from "../js/core/history_manager.js";
import { createLabelsRuntime } from "../js/core/map_renderer/labels_runtime.js";
import { convertCountryLabelToMapLabel } from "../js/core/map_renderer/public.js";
import { createMapHoverInteractionOwner } from "../js/core/map_renderer/map_hover_interaction_owner.js";
import { createFillTargetPolicy } from "../js/core/renderer/fill_target_policy.js";
import { createLegendRuntime } from "../js/core/renderer/legend_runtime.js";
import { createOperationGraphicsEditorRenderOwner } from "../js/core/renderer/operation_graphics_editor_render_owner.js";
import { createStrategicOverlayRuntimeOwner } from "../js/core/renderer/strategic_overlay_runtime_owner.js";
import { initShortcuts } from "../js/ui/shortcuts.js";
import { buildPerLayerExportPlan, getBakePackLayerIds } from "../js/ui/toolbar/export_artifact_model.js";
import { createExportWorkbenchController } from "../js/ui/toolbar/export_workbench_controller.js";
import { Element } from "./helpers/legend_element.mjs";

const noop = () => {};
function setFields(t, target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    const previous = Object.getOwnPropertyDescriptor(target, key);
    t.after(() => previous ? Object.defineProperty(target, key, previous) : delete target[key]);
    target[key] = value;
  }
}

test("automatic replacement follows the bound country's current display name", () => {
  assert.equal(typeof convertCountryLabelToMapLabel, "function");
  const label = { countryCode: "ITA", text: "Roma" };
  const view = { mapLabels: [label], currentLanguage: "en", countryNameOverrides: { ITA: { en: "Italia" } } };
  const { getCountryLabelSuppressionSignature: suppressed } = createLabelsRuntime({ runtimeState: view });
  assert.equal(suppressed(), "");
  label.text = "ITALIA";
  assert.equal(suppressed(), "ITA");
  view.countryNameOverrides.ITA.en = "Italy";
  assert.equal(suppressed(), "");
  label.text = "";
  assert.equal(suppressed(), "ITA");
  label.countryCode = "";
  assert.equal(suppressed(), "");
});

test("Shift placement leaves the next click armed and both annotations start unbound", t => {
  setFields(t, state, { mapLabels: [], mapLabelEditor: { active: true, counter: 1 }, historyPast: [], historyFuture: [] });
  const owner = createStrategicOverlayRuntimeOwner({ state, helpers: { getMapLonLatFromEvent: e => e.point } });
  for (const [index, shiftKey] of [true, false].entries()) {
    const id = owner.placeMapLabelFromEvent({ point: [index, 2], shiftKey });
    assert.deepEqual([state.mapLabelEditor.active, state.mapLabelEditor.selectedId], [shiftKey, id]);
    assert.deepEqual([state.mapLabels[index].lon, state.mapLabels[index].countryCode], [index, ""]);
  }
});

test("hidden selected graphics remove their handles and release the map interaction layer", () => {
  let pointerEvents = "none";
  const group = { selectAll: () => ({ remove() { group.handles = 0; } }), handles: 3, attr: noop };
  const rect = { style(key, value) { assert.equal(key, "pointer-events"); pointerEvents = value; return this; }, lower: noop };
  const owner = createOperationGraphicsEditorRenderOwner({
    annotationView: { showOperationGraphics: false },
    operationGraphicsEditor: { active: false, mode: "edit", selectedId: "line", points: [[1, 2]] },
  }, { ensureOperationGraphicsEditorState: noop, rendererSurfaceHost: {
    getInteractionRect: () => rect, getOperationGraphicsEditorGroup: () => group,
  } });
  owner.renderOperationGraphicsEditorOverlay();
  assert.deepEqual([group.handles, pointerEvents], [0, "all"]);
});

test("file shortcuts, G and overlapping pan modifiers use their registered actions", t => {
  const listeners = {};
  setFields(t, globalThis, { Element, window: { addEventListener: (key, fn) => { listeners[key] = fn; } },
    document: { body: { dataset: {} }, querySelectorAll: () => [] } });
  setFields(t, state, { bootBlocking: false, startupReadonly: false, brushPanModifierActive: false });
  const calls = [];
  for (const hook of ["runProjectSaveFn", "runProjectSaveAsFn", "runQuickReexportFn", "cycleQuickFillLevelFn"]) {
    const previous = readRuntimeHook(state, hook);
    t.after(() => registerRuntimeHook(state, hook, previous));
    registerRuntimeHook(state, hook, () => { calls.push(hook); return true; });
  }
  initShortcuts();
  const send = (type, key, options = {}) => {
    const e = { key, target: document.body, ...options, preventDefault() { this.defaultPrevented = true; } };
    listeners[type](e);
    return !!e.defaultPrevented;
  };
  for (const [key, options] of [["s", { ctrlKey: true }], ["s", { metaKey: true, shiftKey: true }],
    ["e", { ctrlKey: true, shiftKey: true }], ["g", {}]]) assert.ok(send("keydown", key, options));
  assert.equal(send("keydown", "g", { repeat: true }), false);
  assert.deepEqual(calls, ["runProjectSaveFn", "runProjectSaveAsFn", "runQuickReexportFn", "cycleQuickFillLevelFn"]);
  assert.ok(send("keydown", " "));
  send("keydown", "Shift", { shiftKey: true });
  send("keyup", "Shift");
  assert.equal(state.brushPanModifierActive, true);
  assert.ok(send("keyup", " "));
  assert.equal(state.brushPanModifierActive, false);
});

test("queued hover reports the gesture's actual scope and newly protected regions", t => {
  setFields(t, state, { currentLanguage: "en" });
  const feature = { id: "a" };
  const view = { landData: {}, landIndex: new Map([["a", feature], ["b", { id: "b" }]]),
    currentTool: "fill", interactionGranularity: "subdivision", renderPhase: "idle", batchFillScope: "parent",
    hierarchyData: { groups: { ITA_north: ["a"] } }, countryToFeatureIds: new Map([["ITA", ["a", "b"]]]),
    onlyUnpainted: true, visualOverrides: { b: "#ffffff" }, colorRevision: 0 };
  const policy = createFillTargetPolicy(view, {
    getFeatureCountryCodeNormalized: () => "ITA", getAdmin1Group: () => "", shouldExcludePoliticalInteractionFeature: () => false,
  });
  const tooltip = { style: {} }, frames = [];
  const owner = createMapHoverInteractionOwner({
    state: view, surfaceHost: { getTooltip: () => tooltip, getInteractionRect: () => null },
    getters: { nowMs: () => 1, getGlobal: () => ({ requestAnimationFrame: fn => frames.push(fn), cancelAnimationFrame: noop }),
      getHitFromEvent: () => ({ id: "a", targetType: "land" }), getFeatureForHit: () => feature,
      getTooltipTextForFeature: () => "a", getFillTargetPolicy: () => policy, getHoveredFacilityEntryFromEvent: noop,
      isFacilityDetailsSurfaceActive: noop, getHoveredCityTooltipEntry: noop, getOverlayProjectionSignature: noop,
      getSelectedFacilityEntry: noop, shouldBlockUnderlyingSelectionForFacility: noop },
    effects: { updateDevHoverHit: noop, renderHoverOverlay: noop, recordInteractionDurationMetric: noop,
      hidePhysicalIntensityBrushPreview: noop }, helpers: { getFacilityKey: noop },
  });
  const hover = shiftKey => {
    owner.scheduleMouseMove({ clientX: 2, clientY: 3, shiftKey });
    while (frames.length) frames.shift()();
    return tooltip.textContent;
  };
  assert.match(hover(false), /parent region/);
  assert.match(hover(true), /whole country.*1 region\nSkipping 1 painted region/);
  view.visualOverrides = {};
  view.colorRevision++;
  assert.match(hover(true), /whole country.*2 regions$/);
});

test("project name creates an undoable title and registers title-only layer and bake outputs", t => {
  class Control extends Element {
    matches(selector) {
      return selector === this.tagName || (selector === "[name]" && !!this.name) || super.matches(selector);
    }
  }
  const fields = new Control();
  const makeField = () => {
    const field = new Control("fieldset");
    field.append(new Control("legend"));
    for (const name of ["enabled", "text", "position", "size", "background"]) {
      field.append(Object.assign(new Control("input"), { name, type: name === "enabled" ? "checkbox" : "text" }));
    }
    return field;
  };
  const template = { content: { firstElementChild: { cloneNode: makeField } } };
  const doc = { getElementById: id => id === "exportMapTitleFields" ? fields : template, createElement: tag => new Control(tag) };
  setFields(t, globalThis, { HTMLInputElement: Control });
  setFields(t, state, { exportWorkbenchUi: normalizeExportWorkbenchUiState(null), projectName: "Atlas", historyPast: [], historyFuture: [] });
  const previous = readRuntimeHook(state, "refreshExportMapTitlesFn");
  t.after(() => registerRuntimeHook(state, "refreshExportMapTitlesFn", previous));
  const controller = createExportWorkbenchController({ state, t: key => key, normalizeExportWorkbenchUiState,
    exportWorkbenchOverlay: { ownerDocument: doc, getAttribute: () => "false" }, renderPassNames: [],
    showToast: noop, showExportFailureToast: noop, buildCompositeSourceCanvas: noop, buildSingleExportSourceCanvas: noop,
    applyExportAdjustmentsToCanvas: noop, bakeLayer: noop, clearBakeCache: noop });
  controller.bindExportWorkbenchEvents();
  controller.syncExportWorkbenchControlsFromState();
  const field = fields.querySelector('[data-title-field="title"]');
  const [enabled, input] = field.querySelectorAll("[name]");
  field.querySelector("button").fire("click");
  assert.deepEqual([enabled.checked, input.value], [true, "Atlas"]);
  input.value = "Revised";
  field.fire("change", { target: input });
  assert.equal(state.exportWorkbenchUi.mapTitles.title.text, "Revised");
  const layers = () => ({ mapTitles: state.exportWorkbenchUi.mapTitles, textVisibility: {}, layerOrder: [] });
  assert.deepEqual(buildPerLayerExportPlan(layers()), [{ id: "map-titles" }]);
  assert.deepEqual(getBakePackLayerIds(layers()), ["text", "composite"]);
  undoHistory();
  assert.equal(input.value, "Atlas");
  undoHistory();
  assert.deepEqual([enabled.checked, input.value], [false, ""]);
  assert.deepEqual(buildPerLayerExportPlan(layers()), []);
  redoHistory();
  assert.equal(input.value, "Atlas");
  assert.equal(fields.children.length, 3);
});

test("changing only the legend title refreshes the visible header and its accessible name", t => {
  const doc = Object.assign(new Element("document"), { createElement: tag => new Element(tag) });
  setFields(t, globalThis, { document: doc });
  const view = { width: 800, height: 600, currentLanguage: "en", legendConfig: { title: "Boundaries" },
    legendControl: { visible: true, collapsed: false } };
  const container = new Element();
  const runtime = createLegendRuntime({ state: view, runtimeState: view, getMapContainer: () => container,
    clamp: (value, min, max) => Math.max(min, Math.min(value, max)) });
  for (const title of ["Boundaries", "Survey", ""]) {
    view.legendConfig.title = title;
    runtime.renderLegend(["#ff0000"], { "#ff0000": "Border" });
    assert.equal(container.querySelector(".map-legend-control-title").textContent, title || "Legend");
    assert.equal(runtime.ensureLegendControlElement().attributes["aria-label"], title || "Legend");
  }
});
