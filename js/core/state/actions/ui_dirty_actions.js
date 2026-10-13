// Canonical dirty-state mutations. UI indicators, hooks, and persistence remain with callers.

function isStateTarget(target) {
  return !!target && typeof target === "object" && !Array.isArray(target);
}

export function markDirtyState(target, reason = "") {
  if (!isStateTarget(target)) return 0;
  const nextRevision = Number(target.dirtyRevision || 0) + 1;
  target.isDirty = true;
  target.dirtyRevision = nextRevision;
  if (reason) target.lastDirtyReason = String(reason);
  return nextRevision;
}

export function clearDirtyState(target, reason = "") {
  if (!isStateTarget(target)) return false;
  target.isDirty = false;
  if (reason) target.lastDirtyReason = String(reason);
  return false;
}

// Restore captured metadata without manufacturing a new edit revision.
export function restoreDirtyMetadataState(target, snapshot) {
  if (!isStateTarget(target) || !snapshot || typeof snapshot !== "object") {
    throw new TypeError("[ui_dirty_actions] target and snapshot must be objects");
  }
  target.isDirty = snapshot.isDirty;
  target.dirtyRevision = snapshot.dirtyRevision;
  target.lastDirtyReason = snapshot.lastDirtyReason;
}
