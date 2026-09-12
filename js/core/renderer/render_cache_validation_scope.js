/** Reuse validation only within a synchronous render scope and for the same root. */
export function createRenderCacheValidationScope({ ensure, getRoot }) {
  let depth = 0;
  let validatedCache = null;
  let validatedRoot = null;

  function getRenderPassCacheState() {
    if (depth > 0 && validatedCache && getRoot() === validatedRoot) {
      return validatedCache;
    }
    const cache = ensure();
    if (depth > 0) {
      validatedCache = cache;
      validatedRoot = getRoot();
    }
    return cache;
  }

  function withValidatedCache(callback) {
    if (typeof callback !== "function" || callback.constructor?.name === "AsyncFunction") {
      throw new TypeError("withValidatedCache requires a synchronous callback.");
    }
    depth += 1;
    try {
      const result = callback(getRenderPassCacheState());
      if (result && typeof result.then === "function") {
        throw new TypeError("withValidatedCache cannot span asynchronous work.");
      }
      return result;
    } finally {
      depth -= 1;
      if (depth === 0) {
        validatedCache = null;
        validatedRoot = null;
      }
    }
  }

  return Object.freeze({ getRenderPassCacheState, withValidatedCache });
}
