import { state as runtimeState } from "./state.js";
import {
  normalizeIntensityFieldsState,
  serializeIntensityFieldsState,
} from "./state/intensity_field_state.js";
import {
  createAppearanceSnapshotFromRuntimeState,
  normalizeAppearancePresetsState,
  serializeAppearancePresetsState,
} from "./state/appearance_preset_state.js";
import { applyAppearanceStylePathPatchState } from "./state/actions/appearance_actions.js";
import {
  applyAppearancePresetState,
  setAppearancePresetsState,
} from "./state/actions/appearance_preset_actions.js";
import { setIntensityFieldsState } from "./state/actions/intensity_field_actions.js";
import {
  restoreStrategicOverlaySnapshotState,
  setStrategicOverlayDirtyState,
} from "./state/actions/strategic_overlay_actions.js";
import { restoreSpecialZoneSnapshotState } from "./state/actions/special_zone_actions.js";
import { markDirty } from "./dirty_state.js";
import { markLegacyColorStateDirty, rebuildOwnerIndex } from "./sovereignty_manager.js";
import { flushRenderBoundary } from "./render_boundary.js";
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
  stylePaths = [],
  strategicOverlay = false,
  intensityFieldChannels = [],
  appearancePresets = false,
  appearanceState = false,
} = {}) {
  // history snapshot 只抓本次编辑真实触达的键，避免把整份 runtime state 塞进 undo 栈。
  // 这里缺省键写成 null，后面 apply 时才能表达“这次撤销后应该删除该键”。
  const snapshot = {};
  const ids = uniqueKeys(featureIds);
  const waterIds = uniqueKeys(waterRegionIds);
  const ownerKeys = uniqueKeys(ownerCodes);
  const sovereigntyIds = uniqueKeys(sovereigntyFeatureIds);
  const styleKeys = uniqueKeys(stylePaths);

  if (ids.length) {
    snapshot.visualOverrides = captureEntries(runtimeState.visualOverrides || {}, ids);
    snapshot.featureOverrides = captureEntries(runtimeState.featureOverrides || {}, ids);
  }

  if (waterIds.length) {
    snapshot.waterRegionOverrides = captureEntries(runtimeState.waterRegionOverrides || {}, waterIds);
  }

  if (ownerKeys.length) {
    snapshot.sovereignBaseColors = captureEntries(runtimeState.sovereignBaseColors || {}, ownerKeys);
    snapshot.countryBaseColors = captureEntries(runtimeState.countryBaseColors || {}, ownerKeys);
    snapshot.countryPalette = captureEntries(runtimeState.countryPalette || {}, ownerKeys);
  }

  if (sovereigntyIds.length) {
    snapshot.sovereigntyByFeatureId = captureEntries(runtimeState.sovereigntyByFeatureId || {}, sovereigntyIds);
  }

  if (styleKeys.length) {
    snapshot.styleConfig = captureStylePaths(styleKeys);
  }

  if (strategicOverlay) {
    snapshot.annotationView = cloneStructuredValue(runtimeState.annotationView || {});
    snapshot.operationalLines = cloneStructuredValue(runtimeState.operationalLines || []);
    snapshot.operationGraphics = cloneStructuredValue(runtimeState.operationGraphics || []);
    snapshot.unitCounters = cloneStructuredValue(runtimeState.unitCounters || []);
    snapshot.specialZoneLayers = cloneStructuredValue(runtimeState.specialZoneLayers || {});
    snapshot.specialZoneMembershipBrushMode = cloneStructuredValue(runtimeState.specialZoneMembershipBrushMode || "add");
  }

  const intensityChannels = uniqueKeys(intensityFieldChannels);
  if (intensityChannels.length) {
    const fields = normalizeIntensityFieldsState(runtimeState.intensityFields);
    const selectedFields = {
      schemaVersion: 1,
      channels: {},
    };
    intensityChannels.forEach((channelId) => {
      if (fields.channels[channelId]) {
        selectedFields.channels[channelId] = fields.channels[channelId];
      }
    });
    snapshot.intensityFieldChannels = intensityChannels;
    snapshot.intensityFields = serializeIntensityFieldsState(selectedFields);
  }

  if (appearancePresets) {
    snapshot.appearancePresets = serializeAppearancePresetsState(runtimeState.appearancePresets);
  }

  if (appearanceState) {
    snapshot.appearanceState = createAppearanceSnapshotFromRuntimeState(runtimeState);
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
  if (!stylePatch || typeof stylePatch !== "object" || Array.isArray(stylePatch)) {
    return applyAppearanceStylePathPatchState(runtimeState, stylePatch);
  }
  const entries = Object.entries(stylePatch);
  if (!entries.length) {
    return applyAppearanceStylePathPatchState(runtimeState, stylePatch);
  }
  let styleConfig = null;
  entries.forEach(([path, value]) => {
    styleConfig = applyAppearanceStylePathPatchState(runtimeState, { [path]: value });
  });
  return styleConfig;
}

function hasHistoryDelta(before, after) {
  return stableStringify(before) !== stableStringify(after);
}

function pushHistoryEntry(entry) {
  const nextEntry = entry && typeof entry === "object" ? entry : null;
  if (!nextEntry || !hasHistoryDelta(nextEntry.before, nextEntry.after)) {
    return false;
  }

  // 新操作一旦入栈，future 分支就要整体失效；
  // 这和常规编辑器 undo/redo 的分叉语义保持一致。
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

function getFeatureColorHistoryIds(entry) {
  if (entry?.meta?.affectsSovereignty) return null;
  const ids = new Set();
  for (const snapshot of [entry?.before, entry?.after]) {
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
    for (const [key, values] of Object.entries(snapshot)) {
      if (key !== "visualOverrides" && key !== "featureOverrides") return null;
      if (!values || typeof values !== "object" || Array.isArray(values)) return null;
      Object.keys(values).forEach((id) => ids.add(id));
    }
  }
  return ids.size ? Array.from(ids) : null;
}

function refreshUiAfterHistory(direction, entry) {
  // undo/redo 之后统一从这里补 UI 和 render side effects，
  // 调用方只负责准备 before/after，不要在外面各自手写半套刷新逻辑。
  if (entry?.before?.sovereigntyByFeatureId || entry?.after?.sovereigntyByFeatureId) {
    runtimeState.sovereigntyInitialized = true;
    rebuildOwnerIndex();
  }
  const featureIds = getFeatureColorHistoryIds(entry);
  callRuntimeHook(state, "refreshColorStateFn", {
    renderNow: false,
    ...(featureIds ? { featureIds, inputLabel: `history-${direction}` } : {}),
  });
  if (entry?.meta?.affectsSovereignty) {
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
    || (snapshot.specialZoneLayers && typeof snapshot.specialZoneLayers === "object")
    || typeof snapshot.specialZoneMembershipBrushMode === "string"
  );
  // runtimeState 上这一批容器必须先补齐，历史快照恢复才可以安全地执行 delete / replace。

  runtimeState.visualOverrides = runtimeState.visualOverrides || {};
  runtimeState.featureOverrides = runtimeState.featureOverrides || {};
  runtimeState.waterRegionOverrides = runtimeState.waterRegionOverrides || {};
  runtimeState.specialRegionOverrides = runtimeState.specialRegionOverrides || {};
  runtimeState.sovereignBaseColors = runtimeState.sovereignBaseColors || {};
  runtimeState.countryBaseColors = runtimeState.countryBaseColors || {};
  runtimeState.countryPalette = runtimeState.countryPalette || {};
  runtimeState.sovereigntyByFeatureId = runtimeState.sovereigntyByFeatureId || {};

  applyEntries(runtimeState.visualOverrides, snapshot.visualOverrides);
  applyEntries(runtimeState.featureOverrides, snapshot.featureOverrides);
  applyEntries(runtimeState.waterRegionOverrides, snapshot.waterRegionOverrides);
  applyEntries(runtimeState.sovereignBaseColors, snapshot.sovereignBaseColors);
  applyEntries(runtimeState.countryBaseColors, snapshot.countryBaseColors);
  applyEntries(runtimeState.countryPalette, snapshot.countryPalette);
  applyEntries(runtimeState.sovereigntyByFeatureId, snapshot.sovereigntyByFeatureId);
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
  restoreStrategicOverlaySnapshotState(runtimeState, snapshot);
  restoreSpecialZoneSnapshotState(runtimeState, snapshot);
  if (snapshot.intensityFields && typeof snapshot.intensityFields === "object") {
    const current = normalizeIntensityFieldsState(runtimeState.intensityFields);
    const incoming = normalizeIntensityFieldsState(snapshot.intensityFields);
    const channelScope = uniqueKeys(snapshot.intensityFieldChannels || Object.keys(incoming.channels || {}));
    channelScope.forEach((channelId) => {
      const channel = incoming.channels?.[channelId];
      if (channel && current.channels[channelId]) {
        current.channels[channelId] = channel;
      }
    });
    setIntensityFieldsState(runtimeState, current);
    markDirty("intensity-field-history");
  }
  if (snapshot.appearancePresets && typeof snapshot.appearancePresets === "object") {
    setAppearancePresetsState(
      runtimeState,
      normalizeAppearancePresetsState(snapshot.appearancePresets),
    );
    markDirty("appearance-presets-history");
  }
  if (snapshot.appearanceState && typeof snapshot.appearanceState === "object") {
    applyAppearancePresetState(runtimeState, snapshot.appearanceState);
    markDirty("appearance-state-history");
  }
  if (hasAnnotationView) {
    for (const dirtyKey of [
      "frontlineOverlayDirty",
      "operationalLinesDirty",
      "operationGraphicsDirty",
      "unitCountersDirty",
    ]) {
      setStrategicOverlayDirtyState(runtimeState, dirtyKey);
    }
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


