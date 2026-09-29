// Pure build bookkeeping for the deferred political full pass. Publication stays with the owner.
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
    startedAt,
    reason,
    sliceCount: 0,
    processedCount: 0,
    builtPathCount: 0,
    reusedPathCount: 0,
    pathlessEntryCount: 0,
  };
}

export function advanceDeferredPoliticalBackgroundBuild(deferredState, {
  transform, pathCacheHandle, getFeatureId, isPoliticalFeaturePathEntryCurrent,
  getPoliticalFeaturePathEntry, addRetainedPoliticalPath,
  resolvePoliticalBackgroundEntryMeta, Path2D, withinBudget,
}) {
  let processedCount = 0;
  let builtCount = 0;
  let reusedCount = 0;
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
      const cachedEntry = pathCacheHandle?.valid ? pathCacheHandle.map?.get(featureId) : null;
      const hadCachedPath = isPoliticalFeaturePathEntryCurrent(cachedEntry, entry.feature);
      const pathEntry = hadCachedPath ? cachedEntry : getPoliticalFeaturePathEntry(entry.feature, {
        featureId, transform, allowBuild: true, countBuild: true,
        validatedHandle: pathCacheHandle,
      });
      const path = pathEntry?.path || null;
      const resolvedEntry = { feature: entry.feature, geometryRef: entry.feature.geometry, path, id: featureId };
      deferredState.resolvedEntries.push(resolvedEntry);
      addRetainedPoliticalPath(deferredState.pathIndex, featureId, resolvedEntry);
      if (path) {
        if (hadCachedPath) reusedCount += 1;
        else builtCount += 1;
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
        return { processedCount, builtCount, reusedCount, pathlessCount, geometryChanged: true };
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
      if (group.entries.length > 1 && group.allPaths && Path2D
        && typeof Path2D.prototype?.addPath === "function") {
        group.mergedPath = new Path2D();
        deferredState.mergeCurrent = { group, index: 0 };
      } else {
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
  return { processedCount, builtCount, reusedCount, pathlessCount, geometryChanged: false };
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
    fullPassReusedPreviousPathCount: 0,
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

export function getRetainedPoliticalPathHandle(cache, identity, pathCacheSignature) {
  const index = cache.fullPassPathIndex;
  if (!(index instanceof Map) || !index.size) return null;
  if (cache.fullPassPathCacheSignature !== pathCacheSignature
    || cache.fullPassScenarioId !== identity.scenarioId
    || cache.fullPassSceneGeneration !== identity.sceneGeneration
    || cache.fullPassScenarioDataGeneration !== identity.scenarioDataGeneration) return null;
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

