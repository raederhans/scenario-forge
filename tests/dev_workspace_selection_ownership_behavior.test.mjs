import { setFeatureOwnerCodes, resetFeatureOwnerCode, resetFeatureOwnerCodes, resetAllFeatureOwnersToCanonical } from "../js/core/sovereignty_manager.js";
import { applyOwnerToFeatureIds, resetOwnersToScenarioBaselineForFeatureIds, applyOwnerControllerAssignmentsToFeatureIds } from "../js/core/scenario_ownership_editor.js";
import { applyFeaturePaintState } from "../js/core/state/color_state.js";
import { captureHistoryState, clearHistory, pushHistoryEntry, undoHistory, redoHistory } from "../js/core/history_manager.js";
import test from "node:test";
import assert from "node:assert/strict";

import { state } from "../js/core/state.js";
import {
  getFeatureIdsForOwner,
  ensureSovereigntyState,
  getFeatureOwnerCode,
  setFeatureOwnerCode,
} from "../js/core/sovereignty_manager.js";
import { createSelectionOwnershipController } from "../js/ui/dev_workspace/selection_ownership_controller.js";

class TestButton {
  constructor() {
    this.dataset = {};
    this.disabled = false;
    this.listeners = new Map();
  }

  addEventListener(type, handler) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(handler);
    this.listeners.set(type, listeners);
  }

  async click() {
    for (const handler of this.listeners.get("click") || []) {
      await handler({ currentTarget: this, target: this });
    }
  }
}

class TestInput extends TestButton {
  constructor() {
    super();
    this.value = "";
    this.placeholder = "";
  }
}

class TestText {
  constructor() {
    this.textContent = "";
  }
}

function createLookupRoot(elementsById) {
  return {
    querySelector(selector) {
      if (!selector.startsWith("#")) return null;
      return elementsById[selector.slice(1)] || null;
    },
  };
}

function createController({ quickRemoveBtn, selectionToggleBtn, renderWorkspace }) {
  return createSelectionOwnershipController({
    panel: createLookupRoot({
      devSelectionToggleSelectedBtn: selectionToggleBtn,
    }),
    quickbar: createLookupRoot({
      devQuickSelectionValue: new TestText(),
      devQuickTagValue: new TestText(),
      devQuickOwnerValue: new TestText(),
      devQuickControllerValue: new TestText(),
      devQuickOwnerInput: new TestInput(),
      devQuickRemoveSelectedBtn: quickRemoveBtn,
      devQuickUseTagBtn: new TestButton(),
      devQuickApplyOwnerBtn: new TestButton(),
      devQuickResetOwnerBtn: new TestButton(),
      devQuickSaveOwnersBtn: new TestButton(),
    }),
    renderWorkspace,
    renderMetaRows() {},
    normalizeOwnerInput: (value) => String(value || "").trim().toUpperCase(),
    localizeSelectionSummary: (count) => String(count),
    resolveOwnershipTargetIds: () => Array.from(state.devSelectionFeatureIds || []),
    resolveOwnershipEditorModel: () => ({
      selectionCount: state.devSelectionFeatureIds?.size || 0,
      isMixedOwner: false,
      ownerCodes: ["GER"],
      currentOwnerCode: "GER",
      currentControllerCode: "GER",
    }),
    resolveOwnershipEditorHint: () => "",
    buildOwnershipMetaRows: () => [],
  });
}

test("quickbar remove selected reuses the selection clipboard toggle for the current selected feature", async () => {
  const previousSelectedHit = state.devSelectedHit;
  const previousSelectionFeatureIds = state.devSelectionFeatureIds;
  const previousSelectionOrder = state.devSelectionOrder;
  const previousActiveScenarioId = state.activeScenarioId;
  const previousDevScenarioEditor = state.devScenarioEditor;
  const previousLandIndex = state.landIndex;
  const quickRemoveBtn = new TestButton();
  const selectionToggleBtn = new TestButton();
  let toggleClicks = 0;

  selectionToggleBtn.addEventListener("click", () => {
    toggleClicks += 1;
    const selectedId = String(state.devSelectedHit?.id || "").trim();
    if (selectedId && state.devSelectionFeatureIds?.has(selectedId)) {
      state.devSelectionFeatureIds.delete(selectedId);
    }
  });

  try {
    state.activeScenarioId = "tno_1962";
    state.devScenarioEditor = {};
    state.devSelectedHit = { targetType: "land", id: "feature-1" };
    state.devSelectionFeatureIds = new Set(["feature-1", "feature-2"]);
    state.devSelectionOrder = ["feature-1", "feature-2"];
    state.landIndex = new Map([
      ["feature-1", { id: "feature-1" }],
      ["feature-2", { id: "feature-2" }],
    ]);

    const controller = createController({
      quickRemoveBtn,
      selectionToggleBtn,
      renderWorkspace() {},
    });
    controller.bindEvents();

    controller.render({ hasActiveScenario: true });
    assert.equal(quickRemoveBtn.disabled, false);

    await quickRemoveBtn.click();
    assert.equal(toggleClicks, 1);
    assert.equal(state.devSelectionFeatureIds.has("feature-1"), false);

    state.devSelectedHit = { targetType: "land", id: "feature-3" };
    controller.render({ hasActiveScenario: true });
    assert.equal(quickRemoveBtn.disabled, true);
  } finally {
    state.devSelectedHit = previousSelectedHit;
    state.devSelectionFeatureIds = previousSelectionFeatureIds;
    state.devSelectionOrder = previousSelectionOrder;
    state.activeScenarioId = previousActiveScenarioId;
    state.devScenarioEditor = previousDevScenarioEditor;
    state.landIndex = previousLandIndex;
  }
});

test("read-only scenario assignments preserve digit-prefixed HGO tags and reject edits", () => {
  const previousLandIndex = state.landIndex;
  const previousLandData = state.landData;
  const previousSovereigntyByFeatureId = state.sovereigntyByFeatureId;
  const previousOwnerToFeatureIds = state.ownerToFeatureIds;
  const previousSovereigntyInitialized = state.sovereigntyInitialized;
  const previousMapSemanticMode = state.mapSemanticMode;
  const previousScenario = state.activeScenarioId;
  const previousBaseline = state.scenarioBaselineOwnersByFeatureId;
  const feature = {
    id: "HGO-S1",
    properties: {
      id: "HGO-S1",
      country_code: "AAA",
    },
  };

  try {
    state.landIndex = new Map([["HGO-S1", feature]]);
    state.landData = { features: [feature] };
    state.activeScenarioId = "hgo_1936";
    state.scenarioBaselineOwnersByFeatureId = Object.freeze({ "HGO-S1": "2RA" });
    state.sovereigntyByFeatureId = { "HGO-S1": "STALE" };
    state.ownerToFeatureIds = new Map();
    state.sovereigntyInitialized = false;
    state.mapSemanticMode = "ownership";

    ensureSovereigntyState();
    assert.equal(setFeatureOwnerCode("HGO-S1", "AAA"), false);

    assert.equal(getFeatureOwnerCode("HGO-S1"), "2RA");
    assert.deepEqual(getFeatureIdsForOwner("2RA"), ["HGO-S1"]);
    assert.deepEqual(getFeatureIdsForOwner("RA"), []);
  } finally {
    state.landIndex = previousLandIndex;
    state.landData = previousLandData;
    state.sovereigntyByFeatureId = previousSovereigntyByFeatureId;
    state.ownerToFeatureIds = previousOwnerToFeatureIds;
    state.sovereigntyInitialized = previousSovereigntyInitialized;
    state.mapSemanticMode = previousMapSemanticMode;
    state.activeScenarioId = previousScenario;
    state.scenarioBaselineOwnersByFeatureId = previousBaseline;
  }
});

test("all ownership mutation APIs reject before writes, history, revision changes, or rendering", () => {
  const keys = ["activeScenarioId", "scenarioBaselineOwnersByFeatureId", "sovereigntyByFeatureId", "sovereigntyRevision", "sovereigntyInitialized", "ownerToFeatureIds", "mapSemanticMode", "paintMode", "visualOverrides", "featureOverrides", "historyPast", "historyFuture", "pendingDynamicBorderTimerId", "dynamicBordersDirty"];
  const old = Object.fromEntries(keys.map(key => [key, state[key]]));
  try {
    Object.assign(state, { activeScenarioId: "hgo_1936", scenarioBaselineOwnersByFeatureId: Object.freeze({ test: "2RA" }), sovereigntyByFeatureId: { test: "STALE" }, sovereigntyRevision: 77, sovereigntyInitialized: true,
      ownerToFeatureIds: new Map([["2RA", new Set(["test"])]]), paintMode: "sovereignty", visualOverrides: {}, featureOverrides: {} });
    const before = structuredClone(Object.fromEntries(keys.map(key => [key, state[key]])));
    assert.equal(setFeatureOwnerCode("test", "GB"), false);
    assert.equal(setFeatureOwnerCodes(["test"], "GB"), 0);
    assert.equal(resetFeatureOwnerCode("test"), false);
    assert.equal(resetFeatureOwnerCodes(["test"]), 0);
    assert.equal(resetAllFeatureOwnersToCanonical(), false);
    for (const result of [applyOwnerToFeatureIds(["test"], "GB"), resetOwnersToScenarioBaselineForFeatureIds(["test"]), applyOwnerControllerAssignmentsToFeatureIds({ test: { ownerCode: "GB" } })]) {
      assert.equal(result.applied, false);
      assert.equal(result.changed, 0);
      assert.equal(result.reason, "ownership-editing-disabled");
    }
    assert.deepEqual(Object.fromEntries(keys.map(key => [key, state[key]])), before);
    assert.equal(getFeatureOwnerCode("test"), "2RA");
  } finally { Object.assign(state, old); }
});

test("real paint undo/redo restores visual state and never replays ownership patches", () => {
  const keys = ["visualOverrides", "featureOverrides", "sovereigntyByFeatureId", "historyPast", "historyFuture", "legacyColorStateDirty"];
  const old = Object.fromEntries(keys.map(key => [key, state[key]]));
  const oldDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };
  try {
    state.visualOverrides = {}; state.featureOverrides = {}; state.sovereigntyByFeatureId = { paintTest: "2RA" };
    clearHistory();
    const before = captureHistoryState({ featureIds: ["paintTest"] });
    applyFeaturePaintState(state, ["paintTest"], "#aabbcc");
    const after = captureHistoryState({ featureIds: ["paintTest"] });
    // A stale internal entry must not be a write bypass even without any saved projects.
    before.sovereigntyByFeatureId = { paintTest: "OTHER" };
    after.sovereigntyByFeatureId = { paintTest: "THIRD" };
    pushHistoryEntry({ kind: "paint-test", before, after });
    undoHistory();
    assert.deepEqual(state.visualOverrides, {});
    assert.equal(state.sovereigntyByFeatureId.paintTest, "2RA");
    redoHistory();
    assert.deepEqual(state.visualOverrides, { paintTest: "#aabbcc" });
    assert.equal(state.sovereigntyByFeatureId.paintTest, "2RA");
  } finally { clearHistory(); Object.assign(state, old); if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument; }
});
