import {
  buildRestoredAppearancePresetIntensityFields,
  deleteAppearancePreset,
  mergeAppearancePresetImportPayload,
  normalizeAppearancePresetSnapshot,
  normalizeAppearancePresetsState,
  upsertAppearancePreset,
} from "../appearance_preset_state.js";
import { setAppearanceStyleConfigState } from "./appearance_actions.js";
import { patchAppearanceVisibilityState } from "./appearance_visibility_actions.js";
import { setIntensityFieldsState } from "./intensity_field_actions.js";

function assertTarget(target) {
  if (!target || typeof target !== "object" || Array.isArray(target)) throw new TypeError("[appearance_preset_actions] target must be an object");
}
function cloneStateValue(value) {
  if (Array.isArray(value)) return value.map(cloneStateValue);
  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof Map) return new Map(Array.from(value, ([key, entry]) => [cloneStateValue(key), cloneStateValue(entry)]));
  if (value instanceof Set) return new Set(Array.from(value, cloneStateValue));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneStateValue(entry)]));
  }
  return value;
}
function detachActionInputs(inputs) { return cloneStateValue({ ...inputs }); }
export function setAppearancePresetsState(target, value) { assertTarget(target); target.appearancePresets = value; return value; }
export function normalizeAppearancePresetsIntoState(target) { assertTarget(target); const current = structuredClone(target.appearancePresets); return setAppearancePresetsState(target, normalizeAppearancePresetsState(current)); }
export function upsertAppearancePresetState(target, preset) { assertTarget(target); const current = structuredClone(target.appearancePresets); const inputs = detachActionInputs({ preset }); return setAppearancePresetsState(target, upsertAppearancePreset(current, inputs.preset)); }
export function deleteAppearancePresetState(target, presetId) { assertTarget(target); const current = structuredClone(target.appearancePresets); const inputs = detachActionInputs({ presetId }); const normalizedPresetId = String(inputs.presetId || ""); return setAppearancePresetsState(target, deleteAppearancePreset(current, normalizedPresetId)); }
export function mergeAppearancePresetImportPayloadState(target, payload) { assertTarget(target); const current = structuredClone(target.appearancePresets); const inputs = detachActionInputs({ payload }); return setAppearancePresetsState(target, mergeAppearancePresetImportPayload(current, inputs.payload)); }
export function selectAppearancePresetState(target, presetId) {
  assertTarget(target);
  const current = structuredClone(target.appearancePresets);
  const inputs = detachActionInputs({ presetId });
  const next = normalizeAppearancePresetsState(current);
  const selectedPresetId = String(inputs.presetId || "").trim();
  if (next.byId[selectedPresetId]) next.selectedPresetId = selectedPresetId;
  return setAppearancePresetsState(target, next);
}
// The canonical helper owns the restore order: style, visibility, then intensity fields.
export function applyAppearancePresetState(target, presetOrSnapshot) {
  assertTarget(target);
  const currentIntensityFields = structuredClone(target.intensityFields);
  const inputs = detachActionInputs({
    presetOrSnapshot,
  });
  const snapshot = normalizeAppearancePresetSnapshot(inputs.presetOrSnapshot);
  setAppearanceStyleConfigState(target, snapshot.styleConfig);
  patchAppearanceVisibilityState(target, {
    ...snapshot.layerVisibility,
    showBlankFeatureLabels: false,
  });
  setIntensityFieldsState(
    target,
    buildRestoredAppearancePresetIntensityFields(
      currentIntensityFields,
      snapshot.intensityFields,
    ),
  );
  return snapshot;
}

// Restore only this domain's prevalidated project fields; retain references for rollback.
export function restoreProjectImportFields(target, patch) {
  if (Object.hasOwn(patch, "appearancePresets")) target.appearancePresets = patch.appearancePresets;
}
