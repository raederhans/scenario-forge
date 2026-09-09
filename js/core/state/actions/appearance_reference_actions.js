import { normalizeReferenceImageState } from "../ui_state.js";

function assertTarget(target) {
  if (!target || typeof target !== "object" || Array.isArray(target)) throw new TypeError("[appearance_reference_actions] target must be an object");
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
export function setReferenceImageState(target, value, { clamp } = {}) {
  assertTarget(target);
  const inputs = detachActionInputs({ value });
  const next = normalizeReferenceImageState(inputs.value, { clamp });
  target.referenceImageState = next;
  return next;
}
export function patchReferenceImageState(target, patch, { clamp } = {}) {
  assertTarget(target);
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new TypeError("[appearance_reference_actions] patch must be an object");
  const current = structuredClone(target.referenceImageState);
  const inputs = detachActionInputs({
    patch,
  });
  const next = normalizeReferenceImageState({ ...(current || {}), ...inputs.patch }, { clamp });
  target.referenceImageState = next;
  return next;
}
export function setReferenceImageUrlState(target, value = null) { assertTarget(target); target.referenceImageUrl = value; return value; }

// Restore only this domain's prevalidated project fields; retain references for rollback.
export function restoreProjectImportFields(target, patch) {
  if (Object.hasOwn(patch, "referenceImageState")) target.referenceImageState = patch.referenceImageState;
}
