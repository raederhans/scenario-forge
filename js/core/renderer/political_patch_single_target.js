import { isPoliticalFeaturePathEntryCurrent } from "./political_path_cache_owner.js";
import { createPoliticalPatchPreviewBudget } from "./political_patch_preview_budget.js";

export function createPoliticalPatchPreview({ now, getPathEntry, getPathSignature, isVisible }) {
  const budget = createPoliticalPatchPreviewBudget({ now });
  const paintedPaths = new Map();
  let signature;

  function prepare(entries, { currentIds, inputLabel, matchesPublishedColor }) {
    const features = entries.filter(({ id }) => !matchesPublishedColor(id));
    const targetId = currentIds?.length === 1
      && (inputLabel === "fill-feature-color" || inputLabel === "erase-feature-color")
      ? currentIds[0] : null;
    const nextSignature = getPathSignature();
    if (signature !== nextSignature) paintedPaths.clear();
    signature = nextSignature;

    if (targetId) {
      budget.reset();
      const replay = [];
      for (const entry of features) {
        const previous = paintedPaths.get(entry.id);
        if (isPoliticalFeaturePathEntryCurrent(previous, entry.feature)) replay.push({ ...entry, pathEntry: previous });
        else if (entry.id === targetId) replay.push(entry);
      }
      return { features: replay, targetId };
    }
    const decision = budget.inspect(features, ({ id, feature }) =>
      !!getPathEntry(feature, { featureId: id, allowBuild: false }));
    return { features, reason: decision.allowed ? null : decision.reason };
  }

  function draw(preview, orderFeatures, startedAt, drawFeature) {
    paintedPaths.clear();
    let processed = 0;
    for (const { id, feature, pathEntry } of orderFeatures(preview.features)) {
      if (!preview.targetId && !budget.timeRemaining(startedAt)) {
        budget.defer();
        break;
      }
      const clicked = preview.targetId === id;
      if (clicked && !isVisible(feature)) continue;
      const entry = pathEntry || (clicked && getPathEntry(feature, { featureId: id, allowBuild: true }));
      if (drawFeature(feature, processed++, entry?.path, clicked)) {
        const painted = entry || getPathEntry(feature, { featureId: id, allowBuild: false });
        if (painted) paintedPaths.set(id, painted);
      }
    }
    return processed;
  }

  return {
    ...budget, prepare, draw,
    defer() { paintedPaths.clear(); budget.defer(); },
    reset() { paintedPaths.clear(); budget.reset(); },
  };
}
