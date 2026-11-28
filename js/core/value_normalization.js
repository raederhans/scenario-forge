export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeReason(reason, defaultReason) {
  return String(reason || "").trim() || defaultReason;
}
