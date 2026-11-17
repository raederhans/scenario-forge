import { commitFeaturePaint } from "../../core/feature_paint_commands.js";
import { refreshResolvedColorsForFeatures } from "../../core/map_renderer/public.js";

export function applyVisualPaintBatches(batches, { filterToVisibleFeatureIds, render, historyKind, dirtyReason, matchedCount }) {
  const visibleBatches = batches.map(({ ids, color }) => {
    const { matchedIds } = filterToVisibleFeatureIds(ids);
    return { ids: matchedIds, color };
  });
  const { changed } = commitFeaturePaint(visibleBatches, {
    kind: historyKind,
    dirtyReason,
    refresh: (featureIds) => {
      refreshResolvedColorsForFeatures(featureIds, { renderNow: false });
      if (render) render();
    },
  });
  return { applied: true, changed, matchedCount };
}
