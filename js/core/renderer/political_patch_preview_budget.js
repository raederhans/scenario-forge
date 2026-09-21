// Synchronous previews are an optimization, never the authority for an edit.
// Reject bulk/cold geometry before creating Path2D; the normal render owns
// completion and undo. Counts are work limits, not heap or FPS guarantees.
export const POLITICAL_PATCH_PREVIEW_LIMITS = Object.freeze({
  maxFeatures: 24, maxColdPoints: 2048, maxCoordinateArrays: 8192, budgetMs: 4,
});

export function createPoliticalPatchPreviewBudget({
  now = () => performance.now(), limits = POLITICAL_PATCH_PREVIEW_LIMITS,
} = {}) {
  let deferred = false;
  function inspect(entries, hasCurrentPath = () => false) {
    const startedAt = now();
    deferred = false;
    let coldPoints = 0, arrays = 0;
    const reject = (reason) => { deferred = true; return { allowed: false, reason, coldPoints }; };
    if (entries.length > limits.maxFeatures) return reject("feature-budget");
    // Iterative, bounded traversal: even one giant MultiPolygon cannot make the
    // cost estimate itself an unbounded coordinate scan.
    for (const entry of entries) {
      if (now() - startedAt >= limits.budgetMs) return reject("inspection-time-budget");
      if (hasCurrentPath(entry)) continue;
      const geometries = [entry.feature?.geometry];
      while (geometries.length) {
        if (++arrays > limits.maxCoordinateArrays) return reject("structure-budget");
        const geometry = geometries.pop();
        if (!geometry) continue;
        if (geometry.type === "GeometryCollection") {
          const parts = geometry.geometries || [];
          if (parts.length + arrays > limits.maxCoordinateArrays) return reject("structure-budget");
          for (const part of parts) geometries.push(part);
          continue;
        }
        const stack = [{ values: [geometry.coordinates], index: 0 }];
        while (stack.length) {
          const cursor = stack[stack.length - 1];
          if (cursor.index >= cursor.values.length) { stack.pop(); continue; }
          const value = cursor.values[cursor.index++];
          if (++arrays > limits.maxCoordinateArrays) return reject("structure-budget");
          if (!Array.isArray(value)) continue;
          if (typeof value[0] === "number") {
            if (++coldPoints > limits.maxColdPoints) return reject("cold-path-budget");
          } else {
            stack.push({ values: value, index: 0 });
          }
          if ((arrays & 63) === 0 && now() - startedAt >= limits.budgetMs) return reject("inspection-time-budget");
        }
      }
    }
    return { allowed: true, reason: "within-budget", coldPoints };
  }
  return Object.freeze({ inspect,
    exceedsFeatureLimit: (count) => count > limits.maxFeatures,
    timeRemaining: (startedAt) => now() - startedAt < limits.budgetMs,
    defer() { deferred = true; },
    reset() { deferred = false; },
    isDeferred: () => deferred,
  });
}
