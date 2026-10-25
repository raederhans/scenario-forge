// Pure render-pass cache preparation. This module stays import-free so callers
// can normalize a detached holder before the state action performs one commit.

function isObjectHolder(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNullableObjectHolder(value) {
  return value === null || isObjectHolder(value);
}

function hasOwnField(value, fieldName) {
  return Object.hasOwn(value, fieldName);
}

// The cache is read on every render; compile each defaults shape once instead
// of walking it with Object.entries per read.
const compiledShapeMatchers = new WeakMap();

function compileShapeMatcher(defaultValue) {
  if (defaultValue instanceof Map) return (value) => value instanceof Map;
  if (defaultValue instanceof Set) return (value) => value instanceof Set;
  if (Array.isArray(defaultValue)) return (value) => Array.isArray(value);
  if (defaultValue === null) return () => true;
  if (typeof defaultValue === "number") {
    return (value) => typeof value === "number" && Number.isFinite(value);
  }
  if (typeof defaultValue !== "object") {
    const expectedType = typeof defaultValue;
    return (value) => typeof value === expectedType;
  }
  const fields = Object.entries(defaultValue).map(([fieldName, nestedDefault]) => (
    [fieldName, compileShapeMatcher(nestedDefault)]
  ));
  return (value) => {
    if (!isObjectHolder(value)) return false;
    for (const [fieldName, matches] of fields) {
      if (!hasOwnField(value, fieldName) || !matches(value[fieldName])) return false;
    }
    return true;
  };
}

function getShapeMatcher(defaults) {
  let matcher = compiledShapeMatchers.get(defaults);
  if (!matcher) {
    matcher = compileShapeMatcher(defaults);
    compiledShapeMatchers.set(defaults, matcher);
  }
  return matcher;
}

function isNormalizedRenderPassCache(cache, defaults, renderPassNames) {
  if (!isObjectHolder(cache)) return false;
  if (
    !hasOwnField(cache, "dirty")
    || !hasOwnField(cache, "reasons")
    || !isObjectHolder(cache.dirty)
    || !isObjectHolder(cache.reasons)
  ) return false;
  for (const passName of renderPassNames) {
    if (!hasOwnField(cache.dirty, passName) || !hasOwnField(cache.reasons, passName)) return false;
  }
  if (
    !hasOwnField(cache, "politicalPathCacheTransform")
    || !isNullableObjectHolder(cache.politicalPathCacheTransform)
  ) return false;
  if (
    !hasOwnField(cache, "politicalPathWarmupHandle")
    || !isNullableObjectHolder(cache.politicalPathWarmupHandle)
  ) return false;
  return getShapeMatcher(defaults)(cache);
}

function normalizeDefaultShape(value, defaultValue) {
  if (defaultValue instanceof Map) {
    return value instanceof Map ? value : new Map(defaultValue);
  }
  if (defaultValue instanceof Set) {
    return value instanceof Set ? value : new Set(defaultValue);
  }
  if (Array.isArray(defaultValue)) {
    return Array.isArray(value) ? value : [...defaultValue];
  }
  if (defaultValue === null) return value ?? null;
  if (typeof defaultValue === "number") {
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : defaultValue;
  }
  if (typeof defaultValue !== "object") {
    return typeof value === typeof defaultValue ? value : defaultValue;
  }
  const source = isObjectHolder(value) ? value : {};
  const normalized = { ...source };
  for (const [fieldName, nestedDefault] of Object.entries(defaultValue)) {
    const sourceValue = hasOwnField(source, fieldName) ? source[fieldName] : undefined;
    normalized[fieldName] = normalizeDefaultShape(sourceValue, nestedDefault);
  }
  return normalized;
}

export function normalizeRenderPassCacheState(
  currentCache,
  {
    defaults = {},
    cloneZoomTransform = (value) => value,
    renderPassNames = [],
  } = {},
) {
  if (!isObjectHolder(defaults)) {
    throw new TypeError("[render_pass_cache_state_normalizer] defaults must be an object");
  }
  if (typeof cloneZoomTransform !== "function") {
    throw new TypeError("[render_pass_cache_state_normalizer] cloneZoomTransform must be a function");
  }
  if (!Array.isArray(renderPassNames)) {
    throw new TypeError("[render_pass_cache_state_normalizer] renderPassNames must be an array");
  }
  if (isNormalizedRenderPassCache(currentCache, defaults, renderPassNames)) {
    return currentCache;
  }

  const cache = normalizeDefaultShape(
    isObjectHolder(currentCache) ? currentCache : {},
    defaults,
  );
  if (!isNullableObjectHolder(cache.politicalPathCacheTransform)) {
    cache.politicalPathCacheTransform = defaults.politicalPathCacheTransform;
  } else if (cache.politicalPathCacheTransform) {
    cache.politicalPathCacheTransform = cloneZoomTransform(
      cache.politicalPathCacheTransform,
    );
  }
  if (!isNullableObjectHolder(cache.politicalPathWarmupHandle)) {
    cache.politicalPathWarmupHandle = defaults.politicalPathWarmupHandle;
  }
  cache.dirty = isObjectHolder(cache.dirty) ? cache.dirty : {};
  cache.reasons = isObjectHolder(cache.reasons) ? cache.reasons : {};
  for (const passName of renderPassNames) {
    if (!hasOwnField(cache.dirty, passName)) cache.dirty[passName] = true;
    if (!hasOwnField(cache.reasons, passName)) cache.reasons[passName] = "init";
  }
  return cache;
}
