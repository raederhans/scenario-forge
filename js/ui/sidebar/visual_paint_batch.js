import { state } from "../../core/state.js";
import { applyFeaturePaintState } from "../../core/state/color_state.js";
import { captureHistoryState, hasHistoryDelta, pushHistoryEntry } from "../../core/history_manager.js";
import { refreshResolvedColorsForFeatures } from "../../core/map_renderer/public.js";
import { markDirty } from "../../core/dirty_state.js";

export function applyVisualPaintBatches(batches, { filterToVisibleFeatureIds, render, historyKind, dirtyReason, matchedCount }) {
  const paints = new Map();
  for (const { ids, color } of batches) {
    const { matchedIds } = filterToVisibleFeatureIds(ids);
    for (const id of matchedIds) paints.set(id, color);
  }
  const featureIds = [...paints.keys()];
  const before = captureHistoryState({ featureIds });
  for (const [id, color] of paints) {
    applyFeaturePaintState(state, [id], color, { remove: color === null });
  }
  const after = captureHistoryState({ featureIds });
  if (!hasHistoryDelta(before, after)) return { applied: true, changed: 0, matchedCount };
  const changed = featureIds.filter((id) => before.visualOverrides[id] !== after.visualOverrides[id]).length;
  refreshResolvedColorsForFeatures(featureIds, { renderNow: false });
  if (render) render();
  markDirty(dirtyReason);
  pushHistoryEntry({ kind: historyKind, before, after, meta: { affectsSovereignty: false } });
  return { applied: true, changed, matchedCount };
}
