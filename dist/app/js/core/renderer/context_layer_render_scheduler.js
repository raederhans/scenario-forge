// Invalidation remains synchronous; only presentation is coalesced. A fixed
// window (not a restarting debounce) cannot starve under continuous arrivals.
export function createContextLayerRenderScheduler({
  getIdentity, requestRender, recordMetric = () => {},
  schedule = (callback, delay) => setTimeout(callback, delay),
  cancel = (handle) => clearTimeout(handle), now = () => performance.now(),
  delayMs = 32,
}) {
  let pending = null;
  const same = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);
  function reset() {
    if (pending) cancel(pending.handle);
    pending = null;
  }
  function request(layerNames, reason) {
    const identity = getIdentity();
    if (pending && !same(pending.identity, identity)) reset();
    if (!pending) {
      const batch = { identity: [...identity], layers: new Set(), count: 0, startedAt: now(), handle: null, reason };
      pending = batch;
      batch.handle = schedule(() => {
        if (pending !== batch) return;
        pending = null;
        if (!same(batch.identity, getIdentity())) return;
        requestRender(`context-layer-batch:${batch.reason}`, { flush: false });
        recordMetric("contextLayerRenderBatch", now() - batch.startedAt, {
          requestCount: batch.count, layers: [...batch.layers], windowMs: delayMs,
        });
      }, delayMs);
    }
    pending.count++;
    for (const layer of layerNames) pending.layers.add(layer);
    return true;
  }
  return Object.freeze({ request, reset, hasPending: () => pending !== null });
}
