import assert from "node:assert/strict";
import test from "node:test";
import { createStrategicOverlayController } from "../js/ui/sidebar/strategic_overlay_controller.js";
import { initDevWorkspace } from "../js/ui/dev_workspace.js";
import { state } from "../js/core/state.js";
import { callRuntimeHook, registerRuntimeHook } from "../js/core/state/index.js";
import { createSelectionMarqueeOwner } from "../js/core/renderer/selection_marquee_owner.js";
import { createMapInteractionEventBindingOwner } from "../js/core/renderer/map_interaction_event_binding_owner.js";
import { collectPresentOwnerTags } from "../js/core/legend_manager.js";
import { getRiverPaintRuntime } from "../js/core/river_paint/runtime.js";
import { makeFixture } from "./helpers/river_paint_fixture.mjs";

const noop = () => {};

function setGlobal(t, key, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { configurable: true, value });
  t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
}

test("restored line and graphic labels display entity values and ignore unchanged input", t => {
  setGlobal(t, "document", { getElementById: () => null, querySelector: () => null, body: { dataset: {} }, addEventListener: noop });
  setGlobal(t, "HTMLSelectElement", class {});
  const editor = { selectedId: "a", labelSize: 20, labelOnPath: true };
  const map = { operationalLineEditor: { ...editor }, operationGraphicsEditor: { ...editor },
    operationalLines: [{ id: "a", labelSize: 12 }], operationGraphics: [{ id: "a" }] };
  const elements = { strategicCommandButtons: [], unitCounterStatsPresetButtons: [] };
  for (const prefix of ["operationalLine", "operationGraphic"]) {
    for (const field of ["LabelSizeInput", "LabelOnPathInput"]) {
      elements[prefix + field] = { dataset: {}, addEventListener(name, fn) { this[name] = fn; } };
    }
  }
  const updates = [];
  const update = patch => updates.push(patch);
  const controller = createStrategicOverlayController({ state: map, elements,
    helpers: { t: key => key, normalizeAnnotationView: () => ({}),
      mapRenderer: { updateSelectedOperationalLine: update, updateSelectedOperationGraphic: update } } });
  controller.bindEvents();
  const refresh = () => controller.refreshUI({ scopes: ["operationalLines", "operationGraphics"] });
  refresh();
  for (const [prefix, size] of [["operationalLine", "12"], ["operationGraphic", "9"]]) {
    const input = elements[prefix + "LabelSizeInput"];
    const check = elements[prefix + "LabelOnPathInput"];
    assert.equal(input.value, size);
    assert.equal(check.checked, false);
    input.change();
    check.change();
  }
  assert.deepEqual(updates, []);
  map.operationalLineEditor.active = map.operationGraphicsEditor.active = true;
  refresh();
  for (const prefix of ["operationalLine", "operationGraphic"]) {
    assert.equal(elements[prefix + "LabelSizeInput"].value, "20");
    assert.equal(elements[prefix + "LabelOnPathInput"].checked, true);
  }
});

test("hovering another parcel reuses the selection preview until selection order changes", t => {
  const preview = {};
  const panel = { classList: { toggle: noop, remove: noop }, querySelectorAll: () => [],
    querySelector: id => id === "#devSelectionPreview" ? preview : null };
  setGlobal(t, "document", { getElementById: id =>
    ["bottomDock", "devWorkspacePanel", "devWorkspaceQuickbar"].includes(id) ? panel : null });
  let selectedTooltipReads = 0;
  registerRuntimeHook(state, "resolveBorderIdentityFn", id => {
    if (id === "A" || id === "B") selectedTooltipReads++;
    return "FR";
  });
  const feature = id => ({ properties: { id, name: id } });
  state.landIndex = new Map(["A", "B", "C"].map(id => [id, feature(id)]));
  state.devSelectionOrder = ["A", "B"];
  state.devClipboardPreviewFormat = "ids";
  state.ui.developerMode = true;
  initDevWorkspace();
  assert.equal(preview.value, "A\nB");
  assert.ok(selectedTooltipReads > 0);
  selectedTooltipReads = 0;
  state.devHoverHit = { targetType: "land", id: "C" };
  callRuntimeHook(state, "updateDevWorkspaceUIFn");
  assert.equal(selectedTooltipReads, 0);
  state.devSelectionOrder = ["B", "A"];
  callRuntimeHook(state, "updateDevWorkspaceUIFn");
  assert.equal(preview.value, "B\nA");
});

test("Mac Ctrl-click stays native and opening the context menu releases a Command marquee", t => {
  setGlobal(t, "navigator", { platform: "MacIntel" });
  const events = new Map();
  let captured;
  const node = { setPointerCapture: id => { captured = id; }, hasPointerCapture: id => captured === id,
    releasePointerCapture: () => { captured = null; } };
  const rect = { node: () => node, on: (name, fn) => events.set(name.split(".")[0], fn) };
  const marquee = createSelectionMarqueeOwner({ state: { currentTool: "select" }, isPointPickActive: () => false,
    getScreenPoint: () => [0, 0], surfaceHost: { getInteractionRect: () => rect, getMapContainer: () => ({ focus: noop }) } });
  createMapInteractionEventBindingOwner({
    getters: { getInteractionRect: () => rect, getWindow: () => ({ addEventListener: noop }) },
    handlers: { marquee, handlePhysicalIntensityPointerDown: noop, handleMouseMove: noop,
      handleBrushPointerDown: noop, handleMouseLeave: noop, mapClick: noop, mapDoubleClick: noop,
      handleResize: noop, handleSidebarLayoutStart: noop },
  }).bindEvents();
  const event = { button: 0, pointerId: 1, pointerType: "mouse", preventDefault: noop };
  assert.equal(events.get("pointerdown")({ ...event, ctrlKey: true }), false);
  assert.equal(events.get("pointerdown")({ ...event, metaKey: true }), true);
  assert.equal(captured, 1);
  events.get("contextmenu")({ pointerId: -1 });
  assert.equal(captured, null);
  assert.equal(marquee.end({ ...event, type: "pointerup" }), false);
});

test("full-land legend refresh preserves the loaded river surface cache", async () => {
  const { state: map } = await makeFixture();
  map.landDataFull = { features: [...map.landData.features] };
  const river = getRiverPaintRuntime(map);
  const surfaces = river.surfaces();
  collectPresentOwnerTags(map);
  assert.strictEqual(river.surfaces(), surfaces);
});
