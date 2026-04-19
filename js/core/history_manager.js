import { state } from "./state.js";
import { markDirty } from "./dirty_state.js";
import { markLegacyColorStateDirty, rebuildOwnerIndex } from "./sovereignty_manager.js";
import { flushRenderBoundary } from "./render_boundary.js";
import { recalculateScenarioOwnerControllerDiffCount } from "./scenario_owner_metrics.js";

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
    let cursor = state.styleConfig;
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
    snapshot.visualOverrides = captureEntries(state.visualOverrides || {}, ids);
    snapshot.featureOverrides = captureEntries(state.featureOverrides || {}, ids);
  }

  if (waterIds.length) {
    snapshot.waterRegionOverrides = captureEntries(state.waterRegionOverrides || {}, waterIds);
  }

  if (specialIds.length) {
    snapshot.specialRegionOverrides = captureEntries(state.specialRegionOverrides || {}, specialIds);
  }

  if (ownerKeys.length) {
    snapshot.sovereignBaseColors = captureEntries(state.sovereignBaseColors || {}, ownerKeys);
    snapshot.countryBaseColors = captureEntries(state.countryBaseColors || {}, ownerKeys);
    snapshot.countryPalette = captureEntries(state.countryPalette || {}, ownerKeys);
  }

  if (sovereigntyIds.length) {
    snapshot.sovereigntyByFeatureId = captureEntries(state.sovereigntyByFeatureId || {}, sovereigntyIds);
  }

  if (scenarioControllerIds.length) {
    snapshot.scenarioControllersByFeatureId = captureEntries(
      state.scenarioControllersByFeatureId || {},
      scenarioControllerIds
    );
  }

  if (styleKeys.length) {
    snapshot.styleConfig = captureStylePaths(styleKeys);
  }

  if (strategicOverlay) {
    snapshot.annotationView = cloneStructuredValue(state.annotationView || {});
    snapshot.operationalLines = cloneStructuredValue(state.operationalLines || []);
    snapshot.operationGraphics = cloneStructuredValue(state.operationGraphics || []);
    snapshot.unitCounters = cloneStructuredValue(state.unitCounters || []);
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
    let cursor = state.styleConfig;
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

  state.historyPast = Array.isArray(state.historyPast) ? state.historyPast : [];
  state.historyFuture = [];
  state.historyPast.push(nextEntry);

  const max = Math.max(1, Number(state.historyMax) || 80);
  if (state.historyPast.length > max) {
    state.historyPast = state.historyPast.slice(state.historyPast.length - max);
  }

  if (typeof state.updateHistoryUIFn === "function") {
    state.updateHistoryUIFn();
  }
  return true;
}

function refreshUiAfterHistory(direction, entry) {
  const affectsScenarioControllers = !!(
    entry?.before?.scenarioControllersByFeatureId
    || entry?.after?.scenarioControllersByFeatureId
  );
  if (entry?.before?.sovereigntyByFeatureId || entry?.after?.sovereigntyByFeatureId) {
    state.sovereigntyInitialized = true;
    rebuildOwnerIndex();
  }
  if (affectsScenarioControllers) {
    state.scenarioControllerRevision = (Number(state.scenarioControllerRevision) || 0) + 1;
    recalculateScenarioOwnerControllerDiffCount();
  }
  if (typeof state.refreshColorStateFn === "function") {
    state.refreshColorStateFn({ renderNow: false });
  }
  if ((entry?.meta?.affectsSovereignty || affectsScenarioControllers) && typeof state.recomputeDynamicBordersNowFn === "function") {
    state.recomputeDynamicBordersNowFn({ renderNow: false, reason: `history-${direction}` });
  }
  if (typeof state.updateToolUIFn === "function") {
    state.updateToolUIFn();
  }
  if (typeof state.updateSwatchUIFn === "function") {
    state.updateSwatchUIFn();
  }
  if (typeof state.updatePaintModeUIFn === "function") {
    state.updatePaintModeUIFn();
  }
  if (typeof state.updateToolbarInputsFn === "function") {
    state.updateToolbarInputsFn();
  }
  if (typeof state.updateActiveSovereignUIFn === "function") {
    state.updateActiveSovereignUIFn();
  }
  if (typeof state.renderCountryListFn === "function") {
    state.renderCountryListFn();
  }
  if (typeof state.renderWaterRegionListFn === "function") {
    state.renderWaterRegionListFn();
  }
  if (typeof state.renderSpecialRegionListFn === "function") {
    state.renderSpecialRegionListFn();
  }
  if (typeof state.renderPresetTreeFn === "function") {
    state.renderPresetTreeFn();
  }
  if (typeof state.updateLegendUI === "function") {
    state.updateLegendUI();
  }
  if (typeof state.updateStrategicOverlayUIFn === "function") {
    state.updateStrategicOverlayUIFn();
  }
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

  state.visualOverrides = state.visualOverrides || {};
  state.featureOverrides = state.featureOverrides || {};
  state.waterRegionOverrides = state.waterRegionOverrides || {};
  state.specialRegionOverrides = state.specialRegionOverrides || {};
  state.sovereignBaseColors = state.sovereignBaseColors || {};
  state.countryBaseColors = state.countryBaseColors || {};
  state.countryPalette = state.countryPalette || {};
  state.sovereigntyByFeatureId = state.sovereigntyByFeatureId || {};
  state.scenarioControllersByFeatureId = state.scenarioControllersByFeatureId || {};

  applyEntries(state.visualOverrides, snapshot.visualOverrides);
  applyEntries(state.featureOverrides, snapshot.featureOverrides);
  applyEntries(state.waterRegionOverrides, snapshot.waterRegionOverrides);
  applyEntries(state.specialRegionOverrides, snapshot.specialRegionOverrides);
  applyEntries(state.sovereignBaseColors, snapshot.sovereignBaseColors);
  applyEntries(state.countryBaseColors, snapshot.countryBaseColors);
  applyEntries(state.countryPalette, snapshot.countryPalette);
  applyEntries(state.sovereigntyByFeatureId, snapshot.sovereigntyByFeatureId);
  applyEntries(state.scenarioControllersByFeatureId, snapshot.scenarioControllersByFeatureId);
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
    state.annotationView = cloneStructuredValue(snapshot.annotationView);
  }
  if (Array.isArray(snapshot.operationalLines)) {
    state.operationalLines = cloneStructuredValue(snapshot.operationalLines);
    state.operationalLinesDirty = true;
  }
  if (Array.isArray(snapshot.operationGraphics)) {
    state.operationGraphics = cloneStructuredValue(snapshot.operationGraphics);
    state.operationGraphicsDirty = true;
  }
  if (Array.isArray(snapshot.unitCounters)) {
    state.unitCounters = cloneStructuredValue(snapshot.unitCounters);
    state.unitCountersDirty = true;
  }
  if (hasAnnotationView) {
    state.frontlineOverlayDirty = true;
    state.operationalLinesDirty = true;
    state.operationGraphicsDirty = true;
    state.unitCountersDirty = true;
  }
  if (appliesStrategicOverlay) {
    markDirty(`history-${direction}`);
  }

  refreshUiAfterHistory(direction, entry);
  return true;
}

function canUndoHistory() {
  return Array.isArray(state.historyPast) && state.historyPast.length > 0;
}

function canRedoHistory() {
  return Array.isArray(state.historyFuture) && state.historyFuture.length > 0;
}

function undoHistory() {
  if (!canUndoHistory()) return false;
  const entry = state.historyPast.pop();
  state.historyFuture = Array.isArray(state.historyFuture) ? state.historyFuture : [];
  state.historyFuture.push(entry);
  applyHistorySnapshot(entry.before, "undo", entry);
  if (typeof state.updateHistoryUIFn === "function") {
    state.updateHistoryUIFn();
  }
  return true;
}

function redoHistory() {
  if (!canRedoHistory()) return false;
  const entry = state.historyFuture.pop();
  state.historyPast = Array.isArray(state.historyPast) ? state.historyPast : [];
  state.historyPast.push(entry);
  applyHistorySnapshot(entry.after, "redo", entry);
  if (typeof state.updateHistoryUIFn === "function") {
    state.updateHistoryUIFn();
  }
  return true;
}

function clearHistory() {
  state.historyPast = [];
  state.historyFuture = [];
  if (typeof state.updateHistoryUIFn === "function") {
    state.updateHistoryUIFn();
  }
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
