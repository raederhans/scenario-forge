import { state } from "../../state.js";
import { MAP_LABEL_PRESETS, normalizeMapLabel, replacesCountryLabel } from "../../state/strategic_overlay_state.js";
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

function labelStyle(label) {
  const { size, rotation, tracking, uppercase, colorMode, italic, weight, color, opacity, preset } = label;
  return { size, rotation, tracking, uppercase, colorMode, italic, weight, color, opacity, preset };
}

export function placeMapLabel(options, keepPlacing = false) {
  const counter = ensureMapLabelCounter();
  const id = `map_label_${counter}`;
  const previous = state.mapLabels.find(label => label.id === state.mapLabelEditor.selectedId) ?? state.mapLabels.at(-1);
  const style = previous ? labelStyle(previous) : { size: 18 / (state.zoomTransform?.k || 1) };
  const label = normalizeMapLabel({ ...style, ...options }, id);
  if (!label) return false;
  commitLabels("place-map-label", [...state.mapLabels, label], { active: keepPlacing, counter: counter + 1, selectedId: id });
  return id;
}

function editLabel(kind, id, patch) {
  const existing = state.mapLabels.find(label => label.id === id);
  if (!existing) return false;
  const next = normalizeMapLabel({ ...existing, ...patch }, id);
  if (!next) return false;
  // 规范化会省略默认值字段（如 curve=0），所以键数变化也算编辑。
  const keys = Object.keys(next);
  if (keys.length === Object.keys(existing).length && keys.every(key => next[key] === existing[key])) return false;
  commitLabels(kind, state.mapLabels.map(label => label === existing ? next : label));
  return true;
}

export function updateMapLabel(id, patch) {
  if (Object.hasOwn(MAP_LABEL_PRESETS, patch.preset)) {
    patch = { ...MAP_LABEL_PRESETS[patch.preset], colorMode: "auto", opacity: null, uppercase: null, ...patch };
  }
  return editLabel("edit-map-label", id, patch);
}

export function applyMapLabelStyleToPreset(id) {
  const source = state.mapLabels.find(label => label.id === id);
  if (!source) return false;
  const style = labelStyle(source);
  let changed = false;
  const labels = state.mapLabels.map(label => {
    if (label.preset !== source.preset || Object.keys(style).every(key => label[key] === style[key])) return label;
    changed = true;
    return { ...label, ...style };
  });
  if (changed) commitLabels("apply-map-label-style", labels);
  return changed;
}

export function freezeCountryLabels(records, projection, getCountryName, code) {
  const { x, y, k } = state.zoomTransform;
  let counter = ensureMapLabelCounter();
  const additions = [];
  const seen = new Set(state.mapLabels
    .filter(label => label.countryCode && replacesCountryLabel(label, getCountryName(label.countryCode)))
    .map(label => label.countryCode));
  for (const { countryCode, bounds, fontSizePx, angle } of records) {
    if ((code && countryCode !== code) || seen.has(countryCode)) continue;
    if (bounds.x + bounds.w < 0 || bounds.y + bounds.h < 0 || bounds.x > state.width || bounds.y > state.height) continue;
    const point = projection.invert([(bounds.x + bounds.w / 2 - x) / k, (bounds.y + bounds.h / 2 - y) / k]);
    const label = normalizeMapLabel({ countryCode, fallbackName: getCountryName(countryCode), lon: point?.[0], lat: point?.[1],
      size: fontSizePx / k / (state.styleConfig?.countryLabels?.sizeScale ?? 1), rotation: angle * 180 / Math.PI }, `map_label_${counter}`);
    if (!label) continue;
    seen.add(countryCode);
    additions.push(label);
    counter++;
  }
  if (!additions.length) return false;
  commitLabels("freeze-country-labels", [...state.mapLabels, ...additions], {
    active: false, counter, selectedId: additions[0].id,
  });
  return code ? additions[0].id : additions.length;
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
