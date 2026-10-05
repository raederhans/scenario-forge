// Pure build bookkeeping for the deferred political full pass. Publication stays with the owner.
import { getGeometryRetentionWeights } from "./geometry_cache_budget.js";

export const POLITICAL_BACKGROUND_MERGED_PATH_BUDGET = 8 * 1024 * 1024;

export function estimatePoliticalBackgroundMergedPathBytes(entries) {
  if (!Array.isArray(entries) || !entries.length) return 0;
  return 256 + entries.reduce((total, entry) => (
    total + Math.max(0, getGeometryRetentionWeights(entry?.feature).path - 256)
  ), 0);
}

export function estimatePoliticalBackgroundOriginalPathBytes(feature) {
  return getGeometryRetentionWeights(feature).path;
}

export function createDeferredPoliticalBackgroundBuildState(identity, transform, entries, startedAt, reason) {
  return {
    fullPassCacheKey: identity.fullPassCacheKey,
    pathCacheSignature: identity.pathCacheSignature,
    scenarioId: identity.scenarioId,
    sceneGeneration: identity.sceneGeneration,
    scenarioDataGeneration: identity.scenarioDataGeneration,
    transformSignature: identity.transformSignature,
    transform,
    entries,
    index: 0,
    stage: "paths",
    resolvedEntries: [],
    pathIndex: new Map(),
    groupMap: new Map(),
    groups: [],
    groupIterator: null,
    mergeCurrent: null,
    builtGroupMergeCount: 0,
    retainedMergedPathBytes: 0,
    startedAt,
    reason,
    sliceCount: 0,
    processedCount: 0,
    builtPathCount: 0,
    reusedPathCount: 0,
    reusedPreviousPathCount: 0,
    pathlessEntryCount: 0,
  };
}

export function advanceDeferredPoliticalBackgroundBuild(deferredState, {
  transform, pathCacheHandle, retainedPathHandle, getFeatureId, isPoliticalFeaturePathEntryCurrent,
  getPoliticalFeaturePathEntry, addRetainedPoliticalPath,
  resolvePoliticalBackgroundEntryMeta, Path2D, withinBudget,
  mergedPathBudgetBytes = POLITICAL_BACKGROUND_MERGED_PATH_BUDGET,
}) {
  let processedCount = 0;
  let builtCount = 0;
  let reusedCount = 0;
  let reusedPreviousCount = 0;
  let pathlessCount = 0;
  while (deferredState.stage !== "ready" && withinBudget(processedCount)) {
    if (deferredState.stage === "paths") {
      if (deferredState.index >= deferredState.entries.length) {
        deferredState.stage = "groups";
        deferredState.index = 0;
        continue;
      }
      const entry = deferredState.entries[deferredState.index++];
      const featureId = entry?.id || getFeatureId(entry?.feature);
      processedCount += 1;
      if (!featureId || !entry?.feature?.geometry) {
        pathlessCount += 1;
        continue;
      }
      const retainedPath = retainedPathHandle?.getPath(entry.feature, featureId) || null;
      const cachedEntry = !retainedPath && pathCacheHandle?.valid ? pathCacheHandle.map?.get(featureId) : null;
      const hadCachedPath = isPoliticalFeaturePathEntryCurrent(cachedEntry, entry.feature);
      const pathEntry = retainedPath ? null : hadCachedPath ? cachedEntry : getPoliticalFeaturePathEntry(entry.feature, {
        featureId, transform, allowBuild: true, countBuild: true,
        validatedHandle: pathCacheHandle,
      });
      const path = retainedPath || pathEntry?.path || null;
      const resolvedEntry = { feature: entry.feature, geometryRef: entry.feature.geometry, path, id: featureId };
      deferredState.resolvedEntries.push(resolvedEntry);
      addRetainedPoliticalPath(deferredState.pathIndex, featureId, resolvedEntry);
      if (path) {
        if (retainedPath || hadCachedPath) reusedCount += 1;
        else builtCount += 1;
        if (retainedPath) reusedPreviousCount += 1;
      } else pathlessCount += 1;
      continue;
    }
    if (deferredState.stage === "groups") {
      if (deferredState.index >= deferredState.resolvedEntries.length) {
        deferredState.stage = "merge";
        deferredState.groupIterator = deferredState.groupMap.entries();
        continue;
      }
      const resolvedEntry = deferredState.resolvedEntries[deferredState.index++];
      const meta = resolvePoliticalBackgroundEntryMeta(resolvedEntry, { useScenarioBackgroundMerge: true });
      let group = deferredState.groupMap.get(meta.groupKey);
      if (!group) {
        group = { groupKey: meta.groupKey, fillColor: meta.fillColor, entries: [], allPaths: true };
        deferredState.groupMap.set(meta.groupKey, group);
      }
      group.entries.push(resolvedEntry);
      if (!resolvedEntry.path) group.allPaths = false;
      processedCount += 1;
      continue;
    }
    if (deferredState.stage === "validate") {
      if (deferredState.index >= deferredState.resolvedEntries.length) {
        deferredState.stage = "ready";
        break;
      }
      const item = deferredState.resolvedEntries[deferredState.index++];
      processedCount += 1;
      if (item.feature.geometry !== item.geometryRef) {
        return { processedCount, builtCount, reusedCount, reusedPreviousCount, pathlessCount, geometryChanged: true };
      }
      continue;
    }
    if (!deferredState.mergeCurrent) {
      const next = deferredState.groupIterator.next();
      if (next.done) {
        deferredState.stage = "validate";
        deferredState.index = 0;
        continue;
      }
      const group = next.value[1];
      group.mergedPath = group.entries.length === 1 ? group.entries[0].path : null;
      const canCompoundFill = group.entries.length > 1 && group.allPaths && Path2D
        && typeof Path2D.prototype?.addPath === "function";
      group.requiresMergedFill = canCompoundFill;
      const mergedPathEstimatedBytes = canCompoundFill
        ? estimatePoliticalBackgroundMergedPathBytes(group.entries)
        : 0;
      group.mergedPathEstimatedBytes = mergedPathEstimatedBytes;
      if (canCompoundFill
        && deferredState.retainedMergedPathBytes + mergedPathEstimatedBytes <= mergedPathBudgetBytes) {
        group.mergedPath = new Path2D();
        deferredState.retainedMergedPathBytes += mergedPathEstimatedBytes;
        deferredState.mergeCurrent = { group, index: 0 };
      } else {
        group.mergedPath = null;
        delete group.allPaths;
        deferredState.groups.push(group);
      }
      processedCount += 1;
      continue;
    }
    const current = deferredState.mergeCurrent;
    current.group.mergedPath.addPath(current.group.entries[current.index++].path);
    processedCount += 1;
    if (current.index === current.group.entries.length) {
      delete current.group.allPaths;
      deferredState.groups.push(current.group);
      deferredState.builtGroupMergeCount += 1;
      deferredState.mergeCurrent = null;
    }
  }
  return { processedCount, builtCount, reusedCount, reusedPreviousCount, pathlessCount, geometryChanged: false };
}

export function buildDeferredPoliticalBackgroundCachePatch(deferredState, identity) {
  return {
    transformSignature: identity.transformSignature,
    colorSignature: identity.colorSignature,
    fullPassCacheKey: identity.fullPassCacheKey,
    fullPassPathCacheSignature: identity.pathCacheSignature,
    fullPassTransformSignature: identity.transformSignature,
    fullPassColorSignature: identity.colorSignature,
    fullPassScenarioId: identity.scenarioId,
    fullPassSceneGeneration: identity.sceneGeneration,
    fullPassScenarioDataGeneration: identity.scenarioDataGeneration,
    fullPassGroupCount: deferredState.groups.length,
    fullPassEntryCount: deferredState.entries.length,
    fullPassReusedPathCount: deferredState.reusedPathCount,
    fullPassReusedPreviousPathCount: deferredState.reusedPreviousPathCount,
    fullPassBuiltPathCount: deferredState.builtPathCount,
    fullPassPathlessEntryCount: deferredState.pathlessEntryCount,
    fullPassReusedGroupMergeCount: 0,
    fullPassBuiltGroupMergeCount: deferredState.builtGroupMergeCount,
    fullPassGroups: deferredState.groups,
    fullPassPathIndex: deferredState.pathIndex,
  };
}

export function buildPoliticalBackgroundColorSignature(entries, useScenarioBackgroundMerge, resolveMeta) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => {
      const meta = resolveMeta(entry, { useScenarioBackgroundMerge });
      return `${meta.groupKey}::${meta.id}`;
    })
    .join("|");
}

export function addRetainedPoliticalPath(index, id, entry) {
  if (!id || !entry?.path) return;
  const previous = index.get(id);
  if (!previous) index.set(id, entry);
  else if (Array.isArray(previous)) previous.push(entry);
  else index.set(id, [previous, entry]);
}

export function buildRetainedPoliticalPathIndex(groups) {
  const index = new Map();
  for (const group of groups) {
    for (const entry of group.entries) {
      addRetainedPoliticalPath(index, entry.id, entry);
    }
  }
  return index;
}

export function getRetainedPoliticalPathHandle(cache, identity, pathCacheSignature, {
  allowDataGenerationReuse = false,
} = {}) {
  const index = cache.fullPassPathIndex;
  if (!(index instanceof Map) || !index.size) return null;
  if (cache.fullPassPathCacheSignature !== pathCacheSignature
    || cache.fullPassScenarioId !== identity.scenarioId
    || cache.fullPassSceneGeneration !== identity.sceneGeneration
    || (!allowDataGenerationReuse
      && cache.fullPassScenarioDataGeneration !== identity.scenarioDataGeneration)) return null;
  // Geometry identity is checked on each lookup, including duplicate IDs.
  return {
    getPath(feature, id) {
      if (!feature?.geometry || !id) return null;
      const candidates = index.get(id);
      if (!candidates) return null;
      if (Array.isArray(candidates)) {
        return candidates.find((entry) => entry.geometryRef === feature.geometry)?.path || null;
      }
      return candidates.geometryRef === feature.geometry ? candidates.path : null;
    },
  };
}
export function createPoliticalBackgroundCacheState(overrides = {}) {
  return {
    runtimeRef: null,
    scenarioId: "",
    viewMode: "ownership",
    oceanFillColor: "",
    sovereigntyRevision: 0,
    controllerRevision: 0,
    shellRevision: 0,
    colorRevision: 0,
    topologyRevision: 0,
    canvasWidth: 0,
    canvasHeight: 0,
    transformSignature: "",
    colorSignature: "",
    cacheKey: "",
    fullPassCacheKey: "",
    fullPassPathCacheSignature: "",
    fullPassTransformSignature: "",
    fullPassColorSignature: "",
    fullPassGroupCount: 0,
    fullPassEntryCount: 0,
    fullPassReusedPathCount: 0,
    fullPassReusedPreviousPathCount: 0,
    fullPassScenarioId: "",
    fullPassSceneGeneration: null,
    fullPassScenarioDataGeneration: null,
    fullPassBuiltPathCount: 0,
    fullPassPathlessEntryCount: 0,
    fullPassGroups: [],
    fullPassPathIndex: null,
    entries: [],
    ...overrides,
  };
}

// Both cache artifacts share this injected accounting port with the feature LRU.
export function createPoliticalBackgroundPathAccounting(resourceBudget, politicalPathResourceAccounting) {
  for (const method of ["batch", "retain", "release", "getEstimatedBytes"]) {
    if (typeof politicalPathResourceAccounting?.[method] !== "function") {
      throw new TypeError(`effects.politicalPathResourceAccounting.${method} must be a function.`);
    }
  }
  const politicalBackgroundPathResourceOwner = Symbol("political-background-merged-paths");
  let retainedPoliticalBackgroundOriginalPaths = new Map();
  function update(cache, pendingState) {
    const groups = [
      ...(Array.isArray(cache.fullPassGroups)
        ? cache.fullPassGroups : []),
      ...(Array.isArray(pendingState?.groups)
        ? pendingState.groups : []),
    ];
    if (pendingState?.mergeCurrent?.group) groups.push(pendingState.mergeCurrent.group);
    const originalPaths = new Map();
    const mergedPaths = new Map();
    const addOriginalPath = (entry) => {
      if (!entry?.path) return;
      const estimatedBytes = estimatePoliticalBackgroundOriginalPathBytes(entry.feature);
      originalPaths.set(entry.path, Math.max(estimatedBytes, originalPaths.get(entry.path) || 0));
    };
    groups.forEach((group) => (Array.isArray(group?.entries) ? group.entries : []).forEach(addOriginalPath));
    (Array.isArray(pendingState?.resolvedEntries) ? pendingState.resolvedEntries : []).forEach(addOriginalPath);
    groups.forEach((group) => {
      const path = group?.mergedPath;
      if (!path || originalPaths.has(path) || mergedPaths.has(path)) return;
      const estimate = Number(group.mergedPathEstimatedBytes)
        || estimatePoliticalBackgroundMergedPathBytes(group.entries);
      mergedPaths.set(path, estimate);
    });
    politicalPathResourceAccounting.batch(() => {
      for (const [path, previousBytes] of retainedPoliticalBackgroundOriginalPaths) {
        const nextBytes = originalPaths.get(path);
        if (nextBytes === undefined || nextBytes !== previousBytes) {
          politicalPathResourceAccounting.release(politicalBackgroundPathResourceOwner, path);
        }
      }
      for (const [path, nextBytes] of originalPaths) {
        const previousBytes = retainedPoliticalBackgroundOriginalPaths.get(path);
        if (previousBytes === undefined || previousBytes !== nextBytes) {
          politicalPathResourceAccounting.retain(politicalBackgroundPathResourceOwner, path, nextBytes);
        }
      }
    });
    retainedPoliticalBackgroundOriginalPaths = originalPaths;
    const mergedBytes = [...mergedPaths.values()].reduce((total, bytes) => total + bytes, 0);
    if (mergedBytes > 0) {
      resourceBudget.update(politicalBackgroundPathResourceOwner, { projectedPaths: mergedBytes });
    } else {
      resourceBudget.release(politicalBackgroundPathResourceOwner);
    }
    return politicalPathResourceAccounting.getEstimatedBytes() + mergedBytes;
  }

  return update;
}

export function finalizePoliticalBackgroundGroups(groupedEntries, {
  previousFullPassGroups, retainMergedPaths, Path2D,
  mergedPathBudgetBytes = POLITICAL_BACKGROUND_MERGED_PATH_BUDGET,
}) {
  const groups = [];
  let reusedGroupMergeCount = 0;
  let builtGroupMergeCount = 0;
  let retainedMergedPathBytes = 0;
  const retainedMergedPaths = new Set();
  const tryRetainMergedPath = (path, estimatedBytes) => {
    if (path && retainedMergedPaths.has(path)) return true;
    if (retainedMergedPathBytes + estimatedBytes > mergedPathBudgetBytes) return false;
    if (path) retainedMergedPaths.add(path);
    retainedMergedPathBytes += estimatedBytes;
    return true;
  };

  groupedEntries.forEach(({ fillColor, entries: groupEntries }, groupKey) => {
    const resolvedEntries = Array.isArray(groupEntries) ? groupEntries.filter(Boolean) : [];
    if (!resolvedEntries.length) return;
    let mergedPath = null;

    const previousGroup = previousFullPassGroups?.get(groupKey);
    const isMultiPath = resolvedEntries.length > 1;
    const canCompoundFill = isMultiPath
      && Path2D
      && typeof Path2D.prototype?.addPath === "function"
      && resolvedEntries.every((item) => item?.path);
    const mergedPathEstimatedBytes = canCompoundFill
      ? estimatePoliticalBackgroundMergedPathBytes(resolvedEntries)
      : 0;
    const exactMatch = isMultiPath
      && previousGroup
      && previousGroup.mergedPath
      && previousGroup.fillColor === fillColor
      && previousGroup.entries.length === resolvedEntries.length
      && resolvedEntries.every((item, idx) => {
        const prevItem = previousGroup.entries[idx];
        return (
          prevItem
          && prevItem.feature === item.feature
          && prevItem.geometryRef === item.geometryRef
          && prevItem.path === item.path
          && item.path != null
        );
      });

    if (exactMatch) {
      if (retainMergedPaths
        && tryRetainMergedPath(previousGroup.mergedPath, mergedPathEstimatedBytes)) {
        mergedPath = previousGroup.mergedPath;
        reusedGroupMergeCount += 1;
      }
    } else if (resolvedEntries.length === 1 && resolvedEntries[0]?.path) {
      mergedPath = resolvedEntries[0].path;
    } else if (canCompoundFill && retainMergedPaths
      && tryRetainMergedPath(null, mergedPathEstimatedBytes)) {
      mergedPath = new Path2D();
      resolvedEntries.forEach((item) => {
        mergedPath.addPath(item.path);
      });
      builtGroupMergeCount += 1;
    }
    groups.push({
      groupKey,
      fillColor,
      mergedPath,
      mergedPathEstimatedBytes,
      requiresMergedFill: canCompoundFill,
      entries: resolvedEntries,
    });
  });

  return { groups, reusedGroupMergeCount, builtGroupMergeCount };
}
