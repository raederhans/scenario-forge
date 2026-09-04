// Canonical dirty-state mutations. UI indicators, hooks, and persistence remain with callers.

function isStateTarget(target) {
  return !!target && typeof target === "object" && !Array.isArray(target);
}

export function markDirtyState(target, reason = "") {
  if (!isStateTarget(target)) return 0;
  target.isDirty = true;
  target.dirtyRevision = Number(target.dirtyRevision || 0) + 1;
  if (reason) target.lastDirtyReason = String(reason);
  return target.dirtyRevision;
}

export function clearDirtyState(target, reason = "") {
  if (!isStateTarget(target)) return false;
  target.isDirty = false;
  if (reason) target.lastDirtyReason = String(reason);
  return false;
}
