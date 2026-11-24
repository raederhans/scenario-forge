import { createPoliticalPatchPreviewBudget } from "./political_patch_preview_budget.js";

export function orderPoliticalPatchFeatures(entries, interactive, full, orderPoliticalShellUnderlayFirst) {
  if (entries.length < 2) return entries;
  // The raster emits full-only support first, then the interactive collection in source order.
  const ranked = entries.map(entry => {
    const index = interactive.indexOf(entry.feature);
    return { entry, rank: index >= 0 ? index : full.indexOf(entry.feature) - full.length };
  });
  return orderPoliticalShellUnderlayFirst(ranked.sort((a, b) => a.rank - b.rank).map(({ entry }) => entry));
}

export function createPoliticalPatchPreview({ now, getPathEntry, getPathSignature, isVisible }) {
  const budget = createPoliticalPatchPreviewBudget({ now });
  const paintedIds = new Set();
  let signature;

  function prepare(entries, { currentIds, inputLabel, matchesPublishedColor }) {
    const features = entries.filter(({ id }) => !matchesPublishedColor(id));
    const targetId = currentIds?.length === 1
      && (inputLabel === "fill-feature-color" || inputLabel === "erase-feature-color")
      ? currentIds[0] : null;
    const nextSignature = getPathSignature();
    if (signature !== nextSignature) paintedIds.clear();
    signature = nextSignature;

    if (targetId) {
      budget.reset();
      const replay = features.filter(({ id }) => id === targetId || paintedIds.has(id));
      return { features: replay, targetId };
    }
    const decision = budget.inspect(features, ({ id, feature }) =>
      !!getPathEntry(feature, { featureId: id, allowBuild: false }));
    return { features, reason: decision.allowed ? null : decision.reason };
  }

  function draw(preview, orderFeatures, startedAt, drawFeature) {
    paintedIds.clear();
    let processed = 0;
    for (const { id, feature } of orderFeatures(preview.features)) {
      if (!preview.targetId && !budget.timeRemaining(startedAt)) {
        budget.defer();
        break;
      }
      const clicked = preview.targetId === id;
      if (clicked && !isVisible(feature)) continue;
      const entry = preview.targetId && getPathEntry(feature, { featureId: id, allowBuild: clicked });
      if (preview.targetId && !clicked && !entry) continue;
      if (drawFeature(feature, processed++, entry?.path, clicked)) {
        paintedIds.add(id);
      }
    }
    return processed;
  }

  return {
    ...budget, prepare, draw,
    defer() { paintedIds.clear(); budget.defer(); },
    reset() { paintedIds.clear(); budget.reset(); },
  };
}
