import { state } from "../../state.js";
import { normalizeMapLabel } from "../../state/strategic_overlay_state.js";
import { commitStrategicOverlayCollectionsState, patchStrategicOverlayEditorState } from "../../state/actions/strategic_overlay_actions.js";
import { captureHistoryState, pushHistoryEntry } from "../../history_manager.js";
import { markDirty } from "../../dirty_state.js";
import { requestRender } from "../../render_boundary.js";

function ensureMapLabelCounter() {
  let counter = state.mapLabelEditor.counter;
  const ids = new Set();
  for (const { id } of state.mapLabels) {
    ids.add(id);
    const number = Number(/^map_label_(\d+)$/.exec(id)?.[1]);
    if (Number.isSafeInteger(number + 1)) counter = Math.max(counter, number + 1);
  }
  if (!Number.isSafeInteger(counter + 1)) counter = 1;
  while (ids.has(`map_label_${counter}`)) counter++;
  return counter;
}

function commitLabels(kind, mapLabels, editorPatch) {
  const snapshot = () => captureHistoryState({ strategicOverlay: ["mapLabels"] });
  const before = snapshot();
  commitStrategicOverlayCollectionsState(state, { mapLabels });
  if (editorPatch) patchStrategicOverlayEditorState(state, "mapLabelEditor", editorPatch);
  pushHistoryEntry({ kind, before, after: snapshot() });
  markDirty(kind);
  requestRender(kind);
}

export function placeMapLabel(options) {
  const counter = ensureMapLabelCounter();
  const id = `map_label_${counter}`;
  const label = normalizeMapLabel({ ...options, size: options.size ?? 18 / (state.zoomTransform?.k || 1) }, id);
  if (!label) return false;
  commitLabels("place-map-label", [...state.mapLabels, label], { counter: counter + 1, selectedId: id });
  return id;
}

function editLabel(kind, id, patch) {
  const existing = state.mapLabels.find(label => label.id === id);
  if (!existing) return false;
  const next = normalizeMapLabel({ ...existing, ...patch }, id);
  if (!next || Object.keys(next).every(key => next[key] === existing[key])) return false;
  commitLabels(kind, state.mapLabels.map(label => label === existing ? next : label));
  return true;
}

export function updateMapLabel(id, patch) {
  return editLabel("edit-map-label", id, patch);
}

export function commitMapLabelMove(id, lon, lat) {
  return editLabel("move-map-label", id, { lon, lat });
}

export function deleteMapLabel(id) {
  const remaining = state.mapLabels.filter(label => label.id !== id);
  if (remaining.length === state.mapLabels.length) return false;
  commitLabels("delete-map-label", remaining, state.mapLabelEditor.selectedId === id ? { selectedId: null } : null);
  return true;
}
