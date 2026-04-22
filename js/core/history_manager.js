import { state as runtimeState } from "./state.js";
import { markDirty } from "./dirty_state.js";
import { markLegacyColorStateDirty, rebuildOwnerIndex } from "./sovereignty_manager.js";
import { flushRenderBoundary } from "./render_boundary.js";
import { recalculateScenarioOwnerControllerDiffCount } from "./scenario_owner_metrics.js";
import { callRuntimeHook, callRuntimeHooks } from "./state/index.js";
const state = runtimeState;

function uniqueKeys(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean)));
}

function captureEntries(source, keys) {
  const snapshot = {};
  uniqueKeys(keys).forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(source || {}, key)) {
      snapshot[key] = source[key];
    } else {
      snapshot[key] = null;
    }
  });
  return snapshot;
}

function captureStylePaths(paths) {
  const snapshot = {};
  uniqueKeys(paths).forEach((path) => {
    const segments = path.split(".").filter(Boolean);
    let cursor = runtimeState.styleConfig;
    for (const segment of segments) {
      if (!cursor || typeof cursor !== "object") {
        cursor = undefined;
        break;
      }
      cursor = cursor[segment];
    }
    snapshot[path] = cursor === undefined ? null : cursor;
  });
  return snapshot;
}

function cloneStructuredValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function flushHistoryRender(reason = "history-apply") {
  return flushRenderBoundary(reason);
}

function captureHistoryState({
  featureIds = [],
  waterRegionIds = [],
  specialRegionIds = [],
  ownerCodes = [],
  sovereigntyFeatureIds = [],
  scenarioControllerFeatureIds = [],
  stylePaths = [],
  strategicOverlay = false,
} = {}) {
  const snapshot = {};
  const ids = uniqueKeys(featureIds);
  const waterIds = uniqueKeys(waterRegionIds);
  const specialIds = uniqueKeys(specialRegionIds);
  const ownerKeys = uniqueKeys(ownerCodes);
  const sovereigntyIds = uniqueKeys(sovereigntyFeatureIds);
  const scenarioControllerIds = uniqueKeys(scenarioControllerFeatureIds);
  const styleKeys = uniqueKeys(stylePaths);

  if (ids.length) {
    snapshot.visualOverrides = captureEntries(runtimeState.visualOverrides || {}, ids);
    snapshot.featureOverrides = captureEntries(runtimeState.featureOverrides || {}, ids);
  }

  if (waterIds.length) {
    snapshot.waterRegionOverrides = captureEntries(runtimeState.waterRegionOverrides || {}, waterIds);
  }

  if (specialIds.length) {
    snapshot.specialRegionOverrides = captureEntries(runtimeState.specialRegionOverrides || {}, specialIds);
  }

  if (ownerKeys.length) {
    snapshot.sovereignBaseColors = captureEntries(runtimeState.sovereignBaseColors || {}, ownerKeys);
    snapshot.countryBaseColors = captureEntries(runtimeState.countryBaseColors || {}, ownerKeys);
    snapshot.countryPalette = captureEntries(runtimeState.countryPalette || {}, ownerKeys);
  }

  if (sovereigntyIds.length) {
    snapshot.sovereigntyByFeatureId = captureEntries(runtimeState.sovereigntyByFeatureId || {}, sovereigntyIds);
  }

  if (scenarioControllerIds.length) {
    snapshot.scenarioControllersByFeatureId = captureEntries(
      runtimeState.scenarioControllersByFeatureId || {},
      scenarioControllerIds
    );
  }

  if (styleKeys.length) {
    snapshot.styleConfig = captureStylePaths(styleKeys);
  }

  if (strategicOverlay) {
    snapshot.annotationView = cloneStructuredValue(runtimeState.annotationView || {});
    snapshot.operationalLines = cloneStructuredValue(runtimeState.operationalLines || []);
    snapshot.operationGraphics = cloneStructuredValue(runtimeState.operationGraphics || []);
    snapshot.unitCounters = cloneStructuredValue(runtimeState.unitCounters || []);
  }

  return snapshot;
}

function stableStringify(value) {
  if (!value || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function applyEntries(target, patch) {
  if (!patch || typeof patch !== "object") return;
  Object.entries(patch).forEach(([key, value]) => {
    if (value === null || value === undefined) {
      delete target[key];
    } else {
      target[key] = value;
    }
  });
}

function applyStyleSnapshot(stylePatch) {
  if (!stylePatch || typeof stylePatch !== "object") return;
  Object.entries(stylePatch).forEach(([path, value]) => {
    const segments = String(path || "").split(".").filter(Boolean);
    if (!segments.length) return;
    let cursor = runtimeState.styleConfig;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index];
      if (!cursor[segment] || typeof cursor[segment] !== "object") {
        cursor[segment] = {};
      }
      cursor = cursor[segment];
    }
    const last = segments[segments.length - 1];
    if (value === null || value === undefined) {
      delete cursor[last];
    } else {
      cursor[last] = value;
    }
  });
}

function hasHistoryDelta(before, after) {
  return stableStringify(before) !== stableStringify(after);
}

function pushHistoryEntry(entry) {
  const nextEntry = entry && typeof entry === "object" ? entry : null;
  if (!nextEntry || !hasHistoryDelta(nextEntry.before, nextEntry.after)) {
    return false;
  }

  runtimeState.historyPast = Array.isArray(runtimeState.historyPast) ? runtimeState.historyPast : [];
  runtimeState.historyFuture = [];
  runtimeState.historyPast.push(nextEntry);

  const max = Math.max(1, Number(runtimeState.historyMax) || 80);
  if (runtimeState.historyPast.length > max) {
    runtimeState.historyPast = runtimeState.historyPast.slice(runtimeState.historyPast.length - max);
  }

  callRuntimeHook(state, "updateHistoryUIFn");
  return true;
}

function refreshUiAfterHistory(direction, entry) {
  const affectsScenarioControllers = !!(
    entry?.before?.scenarioControllersByFeatureId
    || entry?.after?.scenarioControllersByFeatureId
  );
  if (entry?.before?.sovereigntyByFeatureId || entry?.after?.sovereigntyByFeatureId) {
    runtimeState.sovereigntyInitialized = true;
    rebuildOwnerIndex();
  }
  if (affectsScenarioControllers) {
    runtimeState.scenarioControllerRevision = (Number(runtimeState.scenarioControllerRevision) || 0) + 1;
    recalculateScenarioOwnerControllerDiffCount();
  }
  callRuntimeHook(state, "refreshColorStateFn", { renderNow: false });
  if (entry?.meta?.affectsSovereignty || affectsScenarioControllers) {
    callRuntimeHook(state, "recomputeDynamicBordersNowFn", { renderNow: false, reason: `history-${direction}` });
  }
  callRuntimeHooks(state, [
    "updateToolUIFn",
    "updateSwatchUIFn",
    "updatePaintModeUIFn",
    "updateToolbarInputsFn",
    "updateActiveSovereignUIFn",
    "renderCountryListFn",
    "renderWaterRegionListFn",
    "renderSpecialRegionListFn",
    "renderPresetTreeFn",
    "updateLegendUI",
    "updateStrategicOverlayUIFn",
  ]);
  flushHistoryRender(`history-${direction}`);
}

function applyHistorySnapshot(snapshot, direction, entry) {
  if (!snapshot || typeof snapshot !== "object") return false;
  const hasAnnotationView = !!(snapshot.annotationView && typeof snapshot.annotationView === "object");
  const appliesStrategicOverlay = !!(
    hasAnnotationView
    || Array.isArray(snapshot.operationalLines)
    || Array.isArray(snapshot.operationGraphics)
    || Array.isArray(snapshot.unitCounters)
  );

  runtimeState.visualOverrides = runtimeState.visualOverrides || {};
  runtimeState.featureOverrides = runtimeState.featureOverrides || {};
  runtimeState.waterRegionOverrides = runtimeState.waterRegionOverrides || {};
  runtimeState.specialRegionOverrides = runtimeState.specialRegionOverrides || {};
  runtimeState.sovereignBaseColors = runtimeState.sovereignBaseColors || {};
  runtimeState.countryBaseColors = runtimeState.countryBaseColors || {};
  runtimeState.countryPalette = runtimeState.countryPalette || {};
  runtimeState.sovereigntyByFeatureId = runtimeState.sovereigntyByFeatureId || {};
  runtimeState.scenarioControllersByFeatureId = runtimeState.scenarioControllersByFeatureId || {};

  applyEntries(runtimeState.visualOverrides, snapshot.visualOverrides);
  applyEntries(runtimeState.featureOverrides, snapshot.featureOverrides);
  applyEntries(runtimeState.waterRegionOverrides, snapshot.waterRegionOverrides);
  applyEntries(runtimeState.specialRegionOverrides, snapshot.specialRegionOverrides);
  applyEntries(runtimeState.sovereignBaseColors, snapshot.sovereignBaseColors);
  applyEntries(runtimeState.countryBaseColors, snapshot.countryBaseColors);
  applyEntries(runtimeState.countryPalette, snapshot.countryPalette);
  applyEntries(runtimeState.sovereigntyByFeatureId, snapshot.sovereigntyByFeatureId);
  applyEntries(runtimeState.scenarioControllersByFeatureId, snapshot.scenarioControllersByFeatureId);
  if (
    snapshot.visualOverrides
    || snapshot.featureOverrides
    || snapshot.sovereignBaseColors
    || snapshot.countryBaseColors
  ) {
    markLegacyColorStateDirty();
  }
  applyStyleSnapshot(snapshot.styleConfig);
  if (hasAnnotationView) {
    runtimeState.annotationView = cloneStructuredValue(snapshot.annotationView);
  }
  if (Array.isArray(snapshot.operationalLines)) {
    runtimeState.operationalLines = cloneStructuredValue(snapshot.operationalLines);
    runtimeState.operationalLinesDirty = true;
  }
  if (Array.isArray(snapshot.operationGraphics)) {
    runtimeState.operationGraphics = cloneStructuredValue(snapshot.operationGraphics);
    runtimeState.operationGraphicsDirty = true;
  }
  if (Array.isArray(snapshot.unitCounters)) {
    runtimeState.unitCounters = cloneStructuredValue(snapshot.unitCounters);
    runtimeState.unitCountersDirty = true;
  }
  if (hasAnnotationView) {
    runtimeState.frontlineOverlayDirty = true;
    runtimeState.operationalLinesDirty = true;
    runtimeState.operationGraphicsDirty = true;
    runtimeState.unitCountersDirty = true;
  }
  if (appliesStrategicOverlay) {
    markDirty(`history-${direction}`);
  }

  refreshUiAfterHistory(direction, entry);
  return true;
}

function canUndoHistory() {
  return Array.isArray(runtimeState.historyPast) && runtimeState.historyPast.length > 0;
}

function canRedoHistory() {
  return Array.isArray(runtimeState.historyFuture) && runtimeState.historyFuture.length > 0;
}

function undoHistory() {
  if (!canUndoHistory()) return false;
  const entry = runtimeState.historyPast.pop();
  runtimeState.historyFuture = Array.isArray(runtimeState.historyFuture) ? runtimeState.historyFuture : [];
  runtimeState.historyFuture.push(entry);
  applyHistorySnapshot(entry.before, "undo", entry);
  callRuntimeHook(state, "updateHistoryUIFn");
  return true;
}

function redoHistory() {
  if (!canRedoHistory()) return false;
  const entry = runtimeState.historyFuture.pop();
  runtimeState.historyPast = Array.isArray(runtimeState.historyPast) ? runtimeState.historyPast : [];
  runtimeState.historyPast.push(entry);
  applyHistorySnapshot(entry.after, "redo", entry);
  callRuntimeHook(state, "updateHistoryUIFn");
  return true;
}

function clearHistory() {
  runtimeState.historyPast = [];
  runtimeState.historyFuture = [];
  callRuntimeHook(state, "updateHistoryUIFn");
}

export {
  captureHistoryState,
  clearHistory,
  canRedoHistory,
  canUndoHistory,
  hasHistoryDelta,
  pushHistoryEntry,
  redoHistory,
  undoHistory,
};


