import test from "node:test";
import assert from "node:assert/strict";

import { state, createIntensityFieldsState } from "../js/core/state.js";
import { createDefaultAppearancePresetsState } from "../js/core/state/appearance_preset_state.js";
import { bindBeforeUnload, clearDirty, markDirty } from "../js/core/dirty_state.js";
import {
  captureHistoryState, clearHistory, pushHistoryEntry, redoHistory, undoHistory,
} from "../js/core/history_manager.js";

function mount(t) {
  const keys = [
    "visualOverrides", "waterRegionOverrides", "specialRegionOverrides", "sovereignBaseColors",
    "countryPalette", "styleConfig", "intensityFields", "appearancePresets", "annotationView",
    "operationalLines", "operationGraphics", "unitCounters", "specialZoneLayers",
    "specialZoneMembershipBrushMode", "frontlineOverlayDirty", "operationalLinesDirty",
    "operationGraphicsDirty", "unitCountersDirty", "historyPast", "historyFuture",
    "isDirty", "dirtyRevision", "lastDirtyReason",
  ];
  const saved = Object.fromEntries(keys.map(key => [key, state[key]]));
  const globals = new Map(["document", "addEventListener", "removeEventListener"]
    .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const listeners = new Map();
  const indicator = { hidden: true, classList: { toggle(_name, hidden) { indicator.hidden = hidden; } }, setAttribute() {} };
  globalThis.document = { getElementById: id => id === "appDirtyIndicator" ? indicator : null };
  globalThis.addEventListener = (type, listener) => listeners.set(type, listener);
  globalThis.removeEventListener = type => listeners.delete(type);
  Object.assign(state, {
    visualOverrides: {}, waterRegionOverrides: {}, specialRegionOverrides: {}, sovereignBaseColors: {},
    countryPalette: {}, styleConfig: { ocean: { fillColor: "#112233" } },
    intensityFields: createIntensityFieldsState(), appearancePresets: createDefaultAppearancePresetsState(),
    annotationView: {}, operationalLines: [], operationGraphics: [], unitCounters: [],
    specialZoneLayers: {}, specialZoneMembershipBrushMode: "add", isDirty: false, dirtyRevision: 12,
  });
  clearHistory();
  bindBeforeUnload();
  t.after(() => {
    Object.assign(state, saved);
    for (const [key, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return {
    indicator,
    protectedFromLeaving() {
      let prevented = false;
      const event = { preventDefault() { prevented = true; } };
      listeners.get("beforeunload")?.(event);
      return prevented;
    },
  };
}

for (const [domain, capture, apply, read] of [
  ["land paint", { featureIds: ["land-1"] }, () => { state.visualOverrides["land-1"] = "#abcdef"; }, () => state.visualOverrides["land-1"]],
  ["water paint", { waterRegionIds: ["water-1"] }, () => { state.waterRegionOverrides["water-1"] = "#abcdef"; }, () => state.waterRegionOverrides["water-1"]],
  ["style", { stylePaths: ["ocean.fillColor"] }, () => { state.styleConfig.ocean.fillColor = "#abcdef"; }, () => state.styleConfig.ocean.fillColor],
]) {
  test(`saved ${domain} becomes dirty and protected after undo or redo`, t => {
    const environment = mount(t);
    const original = read();
    const before = captureHistoryState(capture);
    apply();
    markDirty("edit");
    const after = captureHistoryState(capture);
    assert.equal(pushHistoryEntry({ before, after }), true);
    clearDirty("project-export");
    assert.equal(environment.protectedFromLeaving(), false);
    const savedRevision = state.dirtyRevision;

    assert.equal(undoHistory(), true);
    assert.equal(read(), original);
    assert.equal(state.isDirty, true);
    assert.equal(state.dirtyRevision, savedRevision + 1);
    assert.equal(environment.indicator.hidden, false);
    assert.equal(environment.protectedFromLeaving(), true);

    clearDirty("project-export");
    assert.equal(state.isDirty, false);
    assert.equal(environment.protectedFromLeaving(), false);
    assert.equal(redoHistory(), true);
    assert.equal(read(), "#abcdef");
    assert.equal(state.isDirty, true);
    assert.equal(state.dirtyRevision, savedRevision + 2);
    assert.equal(environment.protectedFromLeaving(), true);
  });
}

test("one history application advances revision once across multiple specialized domains", t => {
  mount(t);
  const before = {
    intensityFields: createIntensityFieldsState(),
    appearancePresets: createDefaultAppearancePresetsState(),
    annotationView: { showLabels: false }, operationalLines: [],
  };
  const after = structuredClone(before);
  after.annotationView.showLabels = true;
  after.operationalLines.push({ id: "line-1", points: [[1, 2], [3, 4]] });
  assert.equal(pushHistoryEntry({ before, after }), true);
  const revision = state.dirtyRevision;

  assert.equal(undoHistory(), true);
  assert.equal(state.annotationView.showLabels, false);
  assert.equal(state.isDirty, true);
  assert.equal(state.dirtyRevision, revision + 1);
  clearDirty("project-export");
  assert.equal(redoHistory(), true);
  assert.equal(state.annotationView.showLabels, true);
  assert.equal(state.operationalLines[0].id, "line-1");
  assert.equal(state.dirtyRevision, revision + 2);
});

test("empty history and an unchanged entry leave a saved project clean", t => {
  mount(t);
  const revision = state.dirtyRevision;
  assert.equal(undoHistory(), false);
  assert.equal(redoHistory(), false);
  assert.equal(pushHistoryEntry({ before: { visualOverrides: {} }, after: { visualOverrides: {} } }), false);
  assert.equal(state.isDirty, false);
  assert.equal(state.dirtyRevision, revision);
});

test("history still updates dirty state in a headless document model", t => {
  mount(t);
  delete globalThis.document;
  const before = captureHistoryState({ featureIds: ["land-1"] });
  state.visualOverrides["land-1"] = "#abcdef";
  const after = captureHistoryState({ featureIds: ["land-1"] });
  assert.equal(pushHistoryEntry({ before, after }), true);
  assert.equal(undoHistory(), true);
  assert.equal(state.isDirty, true);
  assert.equal(state.dirtyRevision, 13);
});
