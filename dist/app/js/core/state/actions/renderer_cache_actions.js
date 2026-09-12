// Canonical renderer cache-holder mutations.
// Cache normalization, geometry work, and nested cache algorithms stay in callers/owners.

function assertStateTarget(target) {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw new TypeError("[renderer_cache_actions] target must be an object");
  }
}

function assertMap(value, label) {
  if (!(value instanceof Map)) {
    throw new TypeError(`[renderer_cache_actions] ${label} must be a Map`);
  }
}

function hasSameStateValue(left, right) {
  return left === right || (left !== left && right !== right);
}

function assertOwnDataPropertyWritable(target, key, value, label) {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (descriptor && Object.hasOwn(descriptor, "value")) {
    if (!descriptor.writable && !hasSameStateValue(descriptor.value, value)) {
      throw new TypeError(`[renderer_cache_actions] ${label} must be writable`);
    }
    return descriptor;
  }
  if (descriptor && !descriptor.configurable) {
    throw new TypeError(`[renderer_cache_actions] ${label} accessor must be configurable`);
  }
  if (!descriptor && !Object.isExtensible(target)) {
    throw new TypeError(`[renderer_cache_actions] ${label} target must be extensible`);
  }
  return descriptor;
}

function writeOwnRenderPassCacheState(target, value, descriptor) {
  if (descriptor && Object.hasOwn(descriptor, "value")) {
    if (!hasSameStateValue(descriptor.value, value)) {
      target.renderPassCache = value;
    }
    return;
  }
  Object.defineProperty(target, "renderPassCache", {
    configurable: descriptor?.configurable ?? true,
    enumerable: descriptor?.enumerable ?? true,
    value,
    writable: true,
  });
}

function writeOwnProjectedBoundsCacheState(target, value, descriptor) {
  if (descriptor && Object.hasOwn(descriptor, "value")) {
    if (!hasSameStateValue(descriptor.value, value)) {
      target.projectedBoundsById = value;
    }
    return;
  }
  Object.defineProperty(target, "projectedBoundsById", {
    configurable: descriptor?.configurable ?? true,
    enumerable: descriptor?.enumerable ?? true,
    value,
    writable: true,
  });
}

function writeOwnSphericalFeatureDiagnosticsCacheState(target, value, descriptor) {
  if (descriptor && Object.hasOwn(descriptor, "value")) {
    if (!hasSameStateValue(descriptor.value, value)) {
      target.sphericalFeatureDiagnosticsById = value;
    }
    return;
  }
  Object.defineProperty(target, "sphericalFeatureDiagnosticsById", {
    configurable: descriptor?.configurable ?? true,
    enumerable: descriptor?.enumerable ?? true,
    value,
    writable: true,
  });
}

const immutableDiagnosticValues = new WeakSet();

function isShareableDiagnosticValue(value, ancestors = []) {
  if (!value || typeof value !== "object") return true;
  for (const ancestor of ancestors) {
    if (ancestor === value) return true;
  }
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) {
    return false;
  }
  const nextAncestors = [...ancestors];
  nextAncestors[nextAncestors.length] = value;
  return Object.values(value).every((entry) => (
    isShareableDiagnosticValue(entry, nextAncestors)
  ));
}

function freezeDiagnosticValue(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  Object.values(value).forEach((entry) => freezeDiagnosticValue(entry, seen));
  Object.freeze(value);
}

export function commitRenderPassCacheState(target, renderPassCache) {
  assertStateTarget(target);
  if (!renderPassCache || typeof renderPassCache !== "object" || Array.isArray(renderPassCache)) {
    throw new TypeError("[renderer_cache_actions] renderPassCache must be an object");
  }
  const descriptor = assertOwnDataPropertyWritable(
    target,
    "renderPassCache",
    renderPassCache,
    "renderPassCache",
  );
  writeOwnRenderPassCacheState(target, renderPassCache, descriptor);
  return true;
}

export function commitProjectedBoundsCacheState(
  target,
  { projectedBoundsById, sphericalFeatureDiagnosticsById } = {},
) {
  assertStateTarget(target);
  assertMap(projectedBoundsById, "projectedBoundsById");
  assertMap(sphericalFeatureDiagnosticsById, "sphericalFeatureDiagnosticsById");
  const projectedBoundsDescriptor = assertOwnDataPropertyWritable(
    target,
    "projectedBoundsById",
    projectedBoundsById,
    "projectedBoundsById",
  );
  const sphericalDiagnosticsDescriptor = assertOwnDataPropertyWritable(
    target,
    "sphericalFeatureDiagnosticsById",
    sphericalFeatureDiagnosticsById,
    "sphericalFeatureDiagnosticsById",
  );
  writeOwnProjectedBoundsCacheState(
    target,
    projectedBoundsById,
    projectedBoundsDescriptor,
  );
  writeOwnSphericalFeatureDiagnosticsCacheState(
    target,
    sphericalFeatureDiagnosticsById,
    sphericalDiagnosticsDescriptor,
  );
  return true;
}

// The public feature-ID map is shared with spatial-index preparation. Preserve
// its identity and always address the current holder after a runtime reset.
export function setProjectedBoundsCacheEntryState(target, featureId, bounds) {
  assertStateTarget(target);
  assertMap(target.projectedBoundsById, "projectedBoundsById");
  target.projectedBoundsById.set(featureId, bounds);
}

export function syncProjectedBoundsCacheEntryState(target, featureId, bounds) {
  assertStateTarget(target);
  assertMap(target.projectedBoundsById, "projectedBoundsById");
  if (bounds && target.projectedBoundsById.get(featureId) !== bounds) {
    target.projectedBoundsById.set(featureId, bounds);
  } else if (!bounds) {
    target.projectedBoundsById.delete(featureId);
  }
}

export function clearProjectedBoundsCacheEntriesState(target) {
  assertStateTarget(target);
  assertMap(target.projectedBoundsById, "projectedBoundsById");
  target.projectedBoundsById.clear();
}

export function setDynamicBordersDirtyState(target, dirty, reason) {
  assertStateTarget(target);
  target.dynamicBordersDirty = dirty;
  target.dynamicBordersDirtyReason = reason;
  return dirty;
}

export function setPendingDynamicBorderTimerState(target, timerId) {
  assertStateTarget(target);
  target.pendingDynamicBorderTimerId = timerId;
  return timerId;
}

export function replaceCachedDetailAdmBordersState(target, meshes) {
  assertStateTarget(target);
  target.cachedDetailAdmBorders = meshes;
  return meshes;
}

// Publish the prepared LOD containers without copying their mesh references.
export function replaceCachedCoastlineMeshesState(target, collections) {
  assertStateTarget(target);
  target.cachedCoastlines = collections.cachedCoastlines;
  target.cachedCoastlinesHigh = collections.cachedCoastlinesHigh;
  target.cachedCoastlinesMid = collections.cachedCoastlinesMid;
  target.cachedCoastlinesLow = collections.cachedCoastlinesLow;
}

export function patchBorderMeshCacheState(target, patch) {
  assertStateTarget(target);
  if (Object.hasOwn(patch, "cachedBorders")) target.cachedBorders = patch.cachedBorders;
  if (Object.hasOwn(patch, "cachedDynamicOwnerBorders")) target.cachedDynamicOwnerBorders = patch.cachedDynamicOwnerBorders;
  if (Object.hasOwn(patch, "cachedDynamicBordersHash")) target.cachedDynamicBordersHash = patch.cachedDynamicBordersHash;
  if (Object.hasOwn(patch, "cachedScenarioOpeningOwnerBorders")) target.cachedScenarioOpeningOwnerBorders = patch.cachedScenarioOpeningOwnerBorders;
  if (Object.hasOwn(patch, "cachedFrontlineMesh")) target.cachedFrontlineMesh = patch.cachedFrontlineMesh;
  if (Object.hasOwn(patch, "cachedFrontlineMeshHash")) target.cachedFrontlineMeshHash = patch.cachedFrontlineMeshHash;
}

// Publish unique, uncached country entries prepared by the synchronous runtime commit.
// Empty entries are cached too, so a country with no mesh is not rebuilt.
// Own the per-country arrays while retaining the mesh/geometry references.
export function appendPreparedCountryBorderMeshesState(target, provinceEntries, localEntries, { syncGridLines = false } = {}) {
  assertStateTarget(target);
  target.cachedProvinceBordersByCountry ||= new Map();
  target.cachedProvinceBorders ||= [];
  target.cachedLocalBordersByCountry ||= new Map();
  target.cachedLocalBorders ||= [];
  let changed = false;
  for (const entry of provinceEntries) {
    const country = String(entry.country);
    const meshes = [];
    for (let index = 0; index < entry.meshes.length; index += 1) meshes[index] = entry.meshes[index];
    target.cachedProvinceBordersByCountry.set(country, meshes);
    target.cachedProvinceBorders.push(...meshes);
    changed = true;
  }
  for (const entry of localEntries) {
    const country = String(entry.country);
    const meshes = [];
    for (let index = 0; index < entry.meshes.length; index += 1) meshes[index] = entry.meshes[index];
    target.cachedLocalBordersByCountry.set(country, meshes);
    target.cachedLocalBorders.push(...meshes);
    changed = true;
  }
  if (syncGridLines) target.cachedGridLines = Array.from(target.cachedLocalBorders);
  return changed;
}

export function clearSphericalFeatureDiagnosticsCacheState(target) {
  assertStateTarget(target);
  assertMap(target.sphericalFeatureDiagnosticsById, "sphericalFeatureDiagnosticsById");
  target.sphericalFeatureDiagnosticsById.clear();
  return true;
}

export function getSphericalFeatureDiagnosticsCacheEntryState(target, featureId) {
  assertStateTarget(target);
  assertMap(target.sphericalFeatureDiagnosticsById, "sphericalFeatureDiagnosticsById");
  const normalizedFeatureId = String(featureId);
  if (!target.sphericalFeatureDiagnosticsById.has(normalizedFeatureId)) {
    return null;
  }
  const cachedDiagnostics = target.sphericalFeatureDiagnosticsById.get(normalizedFeatureId);
  return immutableDiagnosticValues.has(cachedDiagnostics)
    ? cachedDiagnostics
    : structuredClone(cachedDiagnostics);
}

export function setSphericalFeatureDiagnosticsCacheEntryState(
  target,
  featureId,
  diagnostics,
) {
  assertStateTarget(target);
  assertMap(target.sphericalFeatureDiagnosticsById, "sphericalFeatureDiagnosticsById");
  const normalizedFeatureId = String(featureId);
  const shareable = isShareableDiagnosticValue(diagnostics);
  const detachedDiagnostics = structuredClone(diagnostics);
  if (shareable && detachedDiagnostics && typeof detachedDiagnostics === "object") {
    if (isShareableDiagnosticValue(detachedDiagnostics)) {
      freezeDiagnosticValue(detachedDiagnostics);
      immutableDiagnosticValues.add(detachedDiagnostics);
    }
  }
  target.sphericalFeatureDiagnosticsById.set(
    normalizedFeatureId,
    detachedDiagnostics,
  );
  return true;
}

// Restore only this domain's prevalidated project fields; retain references for rollback.
export function restoreProjectImportFields(target, patch) {
  if (Object.hasOwn(patch, "dynamicBordersDirty")) target.dynamicBordersDirty = patch.dynamicBordersDirty;
  if (Object.hasOwn(patch, "dynamicBordersDirtyReason")) target.dynamicBordersDirtyReason = patch.dynamicBordersDirtyReason;
}
