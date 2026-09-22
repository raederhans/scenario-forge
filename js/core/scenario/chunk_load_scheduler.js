// Bounds work from fetch through decode. Weights are estimates, not heap bytes.
const MIB = 1024 * 1024;
const positive = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
const aborted = (signal) => signal?.reason || Object.assign(new Error("Chunk load cancelled."), { name: "AbortError" });

export function estimateChunkLoadBytes(meta = {}) {
  const hints = [meta.decodedByteSize, meta.decoded_byte_size, meta.cacheByteSize, meta.cache_byte_size,
    meta.byteSize, meta.byte_size].map(Number).filter((value) => Number.isFinite(value) && value > 0);
  // Geometry objects cost more than their wire representation. Use the largest
  // known hint; unknown costs never become free work in the admission queue.
  return Math.ceil(hints.length ? Math.max(...hints) : 8 * MIB);
}

export function createChunkLoadScheduler({ maxConcurrent = 2, maxInFlightBytes = 32 * MIB, onMetric = () => {} } = {}) {
  const concurrency = Math.max(1, Math.floor(positive(maxConcurrent, 2)));
  const byteLimit = positive(maxInFlightBytes, 32 * MIB);
  const queue = [];
  let active = 0, activeBytes = 0, sequence = 0, pumpQueued = false;
  let peakActive = 0, peakBytes = 0, queuedBytes = 0, completed = 0, cancelledBeforeStart = 0;
  const getStats = () => ({ active, queued: queue.length, inFlightEstimatedBytes: activeBytes,
    maxConcurrent: concurrency, maxInFlightBytes: byteLimit, peakActive, peakEstimatedBytes: peakBytes,
    overBudgetBytes: Math.max(0, activeBytes - byteLimit), queuedEstimatedBytes: queuedBytes,
    completed, cancelledBeforeStart });
  const report = () => { try { onMetric(getStats()); } catch { /* Diagnostics cannot strand loads. */ } };
  function requestPump() {
    if (pumpQueued) return;
    pumpQueued = true;
    queueMicrotask(() => { pumpQueued = false; pump(); });
  }
  function pump() {
    queue.sort((a, b) => b.priority - a.priority || a.sequence - b.sequence);
    while (active < concurrency && queue.length) {
      const task = queue[0];
      // A single oversized required chunk may run alone. Do not let a stream
      // of smaller tasks leapfrog the head and starve it indefinitely.
      if (active && activeBytes + task.bytes > byteLimit) break;
      queue.shift();
      queuedBytes -= task.bytes;
      if (task.signal?.aborted) { task.cancel(); continue; }
      task.running = true;
      active++;
      activeBytes += task.bytes;
      peakActive = Math.max(peakActive, active);
      peakBytes = Math.max(peakBytes, activeBytes);
      report();
      const finish = () => {
        completed++;
        active--;
        activeBytes -= task.bytes;
        task.signal?.removeEventListener("abort", task.cancel);
        report();
        requestPump();
      };
      // Keep the reservation until the actual operation settles, even if it
      // ignores abort. Releasing on abort alone permits unbounded live decoders.
      Promise.resolve().then(() => {
        if (task.signal?.aborted) throw aborted(task.signal);
        return task.run();
      }).then((value) => {
        finish();
        if (task.signal?.aborted) task.reject(aborted(task.signal));
        else task.resolve(value);
      }, (error) => { finish(); task.reject(error); });
    }
  }
  function schedule(run, { key = null, bytes = 8 * MIB, priority = 0, signal } = {}) {
    if (typeof run !== "function") return Promise.reject(new TypeError("Chunk operation must be callable."));
    if (signal?.aborted) return Promise.reject(aborted(signal));
    return new Promise((resolve, reject) => {
      const task = { key, run, signal, resolve, reject, running: false,
        bytes: Math.ceil(positive(bytes, 8 * MIB)), priority: Number.isFinite(priority) ? priority : 0, sequence: sequence++ };
      task.cancel = () => {
        if (task.running) return;
        const index = queue.indexOf(task);
        if (index >= 0) { queue.splice(index, 1); queuedBytes -= task.bytes; }
        cancelledBeforeStart++;
        signal?.removeEventListener("abort", task.cancel);
        reject(aborted(signal));
        report();
        requestPump();
      };
      signal?.addEventListener("abort", task.cancel, { once: true });
      queue.push(task);
      queuedBytes += task.bytes;
      report();
      requestPump();
    });
  }
  function reprioritize(key, priority) {
    if (!Number.isFinite(priority)) return;
    for (const task of queue) if (task.key === key) task.priority = priority;
    requestPump();
  }
  function promote(key, priority) {
    if (!Number.isFinite(priority)) return;
    for (const task of queue) if (task.key === key) task.priority = Math.max(task.priority, priority);
    requestPump();
  }
  return Object.freeze({ schedule, reprioritize, promote, getStats });
}
