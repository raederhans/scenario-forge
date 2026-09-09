import { normalizeIntensityFieldsState, updateIntensityFieldChannel } from "../intensity_field_state.js";

function assertTarget(target) {
  if (!target || typeof target !== "object" || Array.isArray(target)) throw new TypeError("[intensity_field_actions] target must be an object");
}
function commitIntensityFieldsState(target, next) {
  if (target.intensityFields && typeof target.intensityFields === "object" && !Array.isArray(target.intensityFields)) {
    target.intensityFields.schemaVersion = next.schemaVersion;
    target.intensityFields.channels = next.channels;
    return next;
  }
  target.intensityFields = next;
  return next;
}
export function setIntensityFieldsState(target, value) { assertTarget(target); target.intensityFields = value; return value; }
export function appendIntensityFieldPointState(target, channelId, point) {
  assertTarget(target);
  const id = String(channelId || "");
  if (!Object.hasOwn(target.intensityFields.channels, id)) {
    throw new RangeError("Unknown intensity field channel");
  }
  const nextPoint = structuredClone(point);
  target.intensityFields.channels[id].enabled = true;
  target.intensityFields.channels[id].points.push(nextPoint);
  return nextPoint;
}
export function normalizeIntensityFieldsIntoState(target) {
  assertTarget(target);
  const current = structuredClone(target.intensityFields);
  return commitIntensityFieldsState(target, normalizeIntensityFieldsState(current));
}
export function updateIntensityFieldChannelState(target, channelId, mutate) {
  assertTarget(target);
  const current = structuredClone(target.intensityFields);
  const normalizedChannelId = String(channelId || "");
  const detachedMutate = typeof mutate === "function"
    ? (channel, fields) => mutate(channel, fields)
    : null;
  return commitIntensityFieldsState(
    target,
    updateIntensityFieldChannel(current, normalizedChannelId, detachedMutate),
  );
}
export function setIntensityFieldToolState(target, value) { assertTarget(target); target.intensityFieldTool = value; return value; }

// Restore only this domain's prevalidated project fields; retain references for rollback.
export function restoreProjectImportFields(target, patch) {
  if (Object.hasOwn(patch, "intensityFields")) target.intensityFields = patch.intensityFields;
}
