// Canonical export-workbench mutations. Rendering, downloads, DOM, and runtime jobs remain with callers.

import { normalizeExportWorkbenchUiState } from "../../state_defaults.js";

function isStateTarget(target) {
  return !!target && typeof target === "object" && !Array.isArray(target);
}

function normalizeAndCommit(
  target,
  draft,
  { preserveBakeCache = true, normalizeState = normalizeExportWorkbenchUiState } = {},
) {
  const normalize = typeof normalizeState === "function"
    ? normalizeState
    : normalizeExportWorkbenchUiState;
  if (!isStateTarget(target)) return normalize(null);
  const existingCache = preserveBakeCache && target.exportWorkbenchUi?.bakeCache instanceof Map
    ? target.exportWorkbenchUi.bakeCache
    : null;
  const normalized = normalize(draft);
  if (preserveBakeCache) normalized.bakeCache = existingCache || new Map();
  target.exportWorkbenchUi = normalized;
  return normalized;
}

function mergeUiDraft(target, patch = {}) {
  const current = ensureExportWorkbenchUiState(target);
  return {
    ...current,
    ...patch,
    visibility: Object.hasOwn(patch, "visibility")
      ? { ...current.visibility, ...patch.visibility }
      : current.visibility,
    textVisibility: Object.hasOwn(patch, "textVisibility")
      ? { ...current.textVisibility, ...patch.textVisibility }
      : current.textVisibility,
    adjustments: Object.hasOwn(patch, "adjustments")
      ? { ...current.adjustments, ...patch.adjustments }
      : current.adjustments,
  };
}

export function ensureExportWorkbenchUiState(target, { normalizeState } = {}) {
  if (!isStateTarget(target)) {
    const normalize = typeof normalizeState === "function"
      ? normalizeState
      : normalizeExportWorkbenchUiState;
    return normalize(null);
  }
  return normalizeAndCommit(target, target.exportWorkbenchUi, { normalizeState });
}

export function commitExportWorkbenchUiState(
  target,
  nextUiState = null,
  { normalizeState } = {},
) {
  return normalizeAndCommit(target, nextUiState, {
    preserveBakeCache: false,
    normalizeState,
  });
}

export function setExportLayerOrderState(target, layerOrder = []) {
  return normalizeAndCommit(target, mergeUiDraft(target, { layerOrder })).layerOrder;
}

export function setExportVisibilityState(target, layerId, visible) {
  const visibilityPatch = isStateTarget(layerId) ? layerId : { [String(layerId || "")]: visible };
  return normalizeAndCommit(
    target,
    mergeUiDraft(target, { visibility: visibilityPatch }),
  ).visibility;
}

export function setExportTextVisibilityState(target, layerId, visible) {
  const textVisibilityPatch = isStateTarget(layerId) ? layerId : { [String(layerId || "")]: visible };
  return normalizeAndCommit(
    target,
    mergeUiDraft(target, { textVisibility: textVisibilityPatch }),
  ).textVisibility;
}

export function setExportPreviewState(target, { mode, layerId } = {}) {
  const patch = {};
  if (mode !== undefined) patch.previewMode = mode;
  if (layerId !== undefined) patch.previewLayerId = layerId;
  const ui = normalizeAndCommit(target, mergeUiDraft(target, patch));
  return { previewMode: ui.previewMode, previewLayerId: ui.previewLayerId };
}

export function setExportOutputState(target, patch = {}) {
  const outputPatch = {};
  if (Object.hasOwn(patch, "target")) outputPatch.target = patch.target;
  if (Object.hasOwn(patch, "format")) outputPatch.format = patch.format;
  if (Object.hasOwn(patch, "scale")) outputPatch.scale = patch.scale;
  const ui = normalizeAndCommit(target, mergeUiDraft(target, outputPatch));
  return { target: ui.target, format: ui.format, scale: ui.scale };
}

export function setExportAdjustmentsState(target, adjustments = {}) {
  return normalizeAndCommit(
    target,
    mergeUiDraft(target, { adjustments }),
  ).adjustments;
}

export function setExportBakeState(
  target,
  { bakeCache, bakeArtifacts } = {},
) {
  const currentCache = target?.exportWorkbenchUi?.bakeCache instanceof Map
    ? target.exportWorkbenchUi.bakeCache
    : null;
  const patch = {};
  if (bakeArtifacts !== undefined) patch.bakeArtifacts = bakeArtifacts;
  const ui = normalizeAndCommit(target, mergeUiDraft(target, patch));
  ui.bakeCache = bakeCache instanceof Map ? bakeCache : (currentCache || new Map());
  return { bakeCache: ui.bakeCache, bakeArtifacts: ui.bakeArtifacts };
}
