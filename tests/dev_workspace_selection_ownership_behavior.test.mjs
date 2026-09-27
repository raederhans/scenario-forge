import { setFeatureOwnerCodes, resetFeatureOwnerCode, resetFeatureOwnerCodes, resetAllFeatureOwnersToCanonical } from "../js/core/sovereignty_manager.js";
import { applyOwnerToFeatureIds, resetOwnersToScenarioBaselineForFeatureIds, applyOwnerControllerAssignmentsToFeatureIds, buildScenarioOwnershipSavePayload, filterEditableOwnershipFeatureIds, summarizeOwnershipForFeatureIds } from "../js/core/scenario_ownership_editor.js";
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

function createController({ quickbar, quickRemoveBtn, selectionToggleBtn, renderWorkspace, selectionSummary, localizeSelectionSummary = (count) => String(count) }) {
  return createSelectionOwnershipController({
    panel: createLookupRoot({
      devSelectionToggleSelectedBtn: selectionToggleBtn,
    }),
    quickbar: quickbar || createLookupRoot({ devQuickRemoveSelectedBtn: quickRemoveBtn }),
    renderWorkspace,
    localizeSelectionSummary,
    resolveSelectedOwnershipSummary: selectionSummary,
  });
}

test("quickbar remove selected reuses the selection clipboard toggle for the current selected feature", async () => {
  const previousSelectedHit = state.devSelectedHit;
  const previousSelectionFeatureIds = state.devSelectionFeatureIds;
  const previousSelectionOrder = state.devSelectionOrder;
  const previousActiveScenarioId = state.activeScenarioId;
  const previousLandIndex = state.landIndex;
  const quickRemoveBtn = new TestButton();
  const selectionToggleBtn = new TestButton();
  const quickbarValues = {
    selection: new TestText(),
    tag: new TestText(),
    owner: new TestText(),
    controller: new TestText(),
  };
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
    state.devSelectedHit = { targetType: "land", id: "feature-1" };
    state.devSelectionFeatureIds = new Set(["feature-1", "feature-2"]);
    state.devSelectionOrder = ["feature-1", "feature-2"];
    state.landIndex = new Map([
      ["feature-1", { id: "feature-1" }],
      ["feature-2", { id: "feature-2" }],
    ]);

    const controller = createController({
      quickbar: createLookupRoot({
        devQuickSelectionValue: quickbarValues.selection,
        devQuickTagValue: quickbarValues.tag,
        devQuickOwnerValue: quickbarValues.owner,
        devQuickControllerValue: quickbarValues.controller,
        devQuickRemoveSelectedBtn: quickRemoveBtn,
      }),
      quickRemoveBtn,
      selectionToggleBtn,
      localizeSelectionSummary: (count) => `${count} selected`,
      selectionSummary: () => ({
        selectionCount: 2,
        isMixedOwner: true,
        ownerCodes: ["GER", "FRA"],
        currentOwnerCode: "",
      }),
      renderWorkspace() {},
    });
    controller.bindEvents();

    controller.render({ hasActiveScenario: true });
    assert.equal(quickRemoveBtn.disabled, false);
    assert.equal(quickbarValues.selection.textContent, "2 selected");
    assert.equal(quickbarValues.tag.textContent, "GER, FRA");
    assert.equal(quickbarValues.owner.textContent, "GER, FRA");
    assert.equal(quickbarValues.controller.textContent, "GER, FRA");

    await quickRemoveBtn.click();
    assert.equal(toggleClicks, 1);
    assert.equal(state.devSelectionFeatureIds.has("feature-1"), false);

    state.devSelectedHit = { targetType: "land", id: "feature-3" };
    controller.render({ hasActiveScenario: true });
    assert.equal(quickRemoveBtn.disabled, true);
    controller.render({ hasActiveScenario: false });
    assert.equal(quickRemoveBtn.disabled, true);
  } finally {
    state.devSelectedHit = previousSelectedHit;
    state.devSelectionFeatureIds = previousSelectionFeatureIds;
    state.devSelectionOrder = previousSelectionOrder;
    state.activeScenarioId = previousActiveScenarioId;
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
  const previousBaselineHash = state.scenarioBaselineHash;
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
    state.scenarioBaselineHash = "hgo-baseline";
    state.sovereigntyByFeatureId = { "HGO-S1": "STALE" };
    state.ownerToFeatureIds = new Map();
    state.sovereigntyInitialized = false;
    state.mapSemanticMode = "ownership";

    ensureSovereigntyState();
    assert.equal(setFeatureOwnerCode("HGO-S1", "AAA"), false);

    assert.equal(getFeatureOwnerCode("HGO-S1"), "2RA");
    assert.deepEqual(getFeatureIdsForOwner("2RA"), ["HGO-S1"]);
    assert.deepEqual(getFeatureIdsForOwner("RA"), []);
    assert.deepEqual(filterEditableOwnershipFeatureIds(["HGO-S1", "missing", "HGO-S1"]), {
      requestedIds: ["HGO-S1", "missing"], matchedIds: ["HGO-S1"], missingIds: ["missing"],
    });
    assert.deepEqual(summarizeOwnershipForFeatureIds(["HGO-S1"]), {
      featureCount: 1, ownerCodes: ["2RA"], isMixed: false, singleOwnerCode: "2RA",
    });
    assert.deepEqual(buildScenarioOwnershipSavePayload(), {
      scenarioId: "hgo_1936", baselineHash: "hgo-baseline", owners: { "HGO-S1": "2RA" },
    });
  } finally {
    state.landIndex = previousLandIndex;
    state.landData = previousLandData;
    state.sovereigntyByFeatureId = previousSovereigntyByFeatureId;
    state.ownerToFeatureIds = previousOwnerToFeatureIds;
    state.sovereigntyInitialized = previousSovereigntyInitialized;
    state.mapSemanticMode = previousMapSemanticMode;
    state.activeScenarioId = previousScenario;
    state.scenarioBaselineOwnersByFeatureId = previousBaseline;
    state.scenarioBaselineHash = previousBaselineHash;
  }
});

test("all ownership mutation APIs reject before writes, history, revision changes, or rendering", () => {
  const keys = ["activeScenarioId", "scenarioBaselineOwnersByFeatureId", "sovereigntyByFeatureId", "sovereigntyRevision", "sovereigntyInitialized", "ownerToFeatureIds", "mapSemanticMode", "paintMode", "visualOverrides", "sovereignBaseColors", "historyPast", "historyFuture", "pendingDynamicBorderTimerId", "dynamicBordersDirty"];
  const old = Object.fromEntries(keys.map(key => [key, state[key]]));
  try {
    Object.assign(state, { activeScenarioId: "hgo_1936", scenarioBaselineOwnersByFeatureId: Object.freeze({ test: "2RA" }), sovereigntyByFeatureId: { test: "STALE" }, sovereigntyRevision: 77, sovereigntyInitialized: true,
      ownerToFeatureIds: new Map([["2RA", new Set(["test"])]]), paintMode: "sovereignty", visualOverrides: {}, sovereignBaseColors: { GER: "#112233" } });
    const before = structuredClone(Object.fromEntries(keys.map(key => [key, state[key]])));
    assert.equal(setFeatureOwnerCode("test", "GB"), false);
    assert.equal(setFeatureOwnerCodes(["test"], "GB"), 0);
    assert.equal(resetFeatureOwnerCode("test"), false);
    assert.equal(resetFeatureOwnerCodes(["test"]), 0);
    assert.equal(resetAllFeatureOwnersToCanonical(), false);
    for (const result of [applyOwnerToFeatureIds(["test"], "GB"), resetOwnersToScenarioBaselineForFeatureIds(["test"]), applyOwnerControllerAssignmentsToFeatureIds({ test: { ownerCode: "GB" } })]) {
      assert.equal(result.applied, false);
      assert.equal(result.changed, 0);
      assert.equal(result.requestedCount, 1);
      assert.equal(result.reason, "ownership-editing-disabled");
    }
    assert.deepEqual(Object.fromEntries(keys.map(key => [key, state[key]])), before);
    assert.equal(getFeatureOwnerCode("test"), "2RA");
  } finally { Object.assign(state, old); }
});

test("real paint undo/redo restores visual state without changing canonical ownership colors", () => {
  const keys = ["visualOverrides", "sovereignBaseColors", "sovereigntyByFeatureId", "historyPast", "historyFuture"];
  const old = Object.fromEntries(keys.map(key => [key, state[key]]));
  const oldDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };
  try {
    state.visualOverrides = {}; state.sovereignBaseColors = { GER: "#112233" }; state.sovereigntyByFeatureId = { paintTest: "2RA" };
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
    assert.deepEqual(state.sovereignBaseColors, { GER: "#112233" });
    assert.equal(state.sovereigntyByFeatureId.paintTest, "2RA");
    redoHistory();
    assert.deepEqual(state.visualOverrides, { paintTest: "#aabbcc" });
    assert.deepEqual(state.sovereignBaseColors, { GER: "#112233" });
    assert.equal(state.sovereigntyByFeatureId.paintTest, "2RA");
  } finally { clearHistory(); Object.assign(state, old); if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument; }
});
