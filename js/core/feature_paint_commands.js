import { state } from "./state.js";
import { applyFeaturePaintState } from "./state/color_state.js";
import { captureHistoryState, hasHistoryDelta, pushHistoryEntry } from "./history_manager.js";
import { markDirty } from "./dirty_state.js";

// One completed feature edit. Brush strokes keep their existing deferred commit.
// Callers select targets and supply their existing color refresh/render effect.
export function commitFeaturePaint(batches, {
  kind,
  dirtyReason = kind,
  gesture = null,
  refresh,
  recordUnchanged = false,
}) {
  const paints = new Map();
  for (const { ids, color } of batches) {
    for (const value of ids) {
      const id = String(value || "").trim();
      if (id) paints.set(id, color);
    }
  }
  const featureIds = [...paints.keys()];
  if (!featureIds.length) return { featureIds, changed: 0 };

  const before = captureHistoryState({ featureIds });
  // Last batch wins for overlapping targets. Apply each color as a batch so
  // parent/river cleanup is not repeated once per feature on large fills.
  const idsByColor = new Map();
  for (const [id, color] of paints) {
    if (!idsByColor.has(color)) idsByColor.set(color, []);
    idsByColor.get(color).push(id);
  }
  for (const [color, ids] of idsByColor) {
    applyFeaturePaintState(state, ids, color, { remove: color === null });
  }
  const after = captureHistoryState({ featureIds });
  const changed = featureIds.filter((id) => before.visualOverrides[id] !== after.visualOverrides[id]).length;
  // A parent color can stay equal while its river-cell overrides are cleared.
  // Map/inspector clicks retain their existing feedback for unchanged edits;
  // bulk sidebar edits skip it, and neither path creates empty history entries.
  if (!recordUnchanged && !hasHistoryDelta(before, after)) return { featureIds, changed };

  refresh(featureIds);
  markDirty(dirtyReason);
  pushHistoryEntry({
    kind,
    before,
    after,
    meta: { affectsSovereignty: false, ...(gesture ? { quickFillGesture: gesture } : {}) },
  });
  return { featureIds, changed };
}
