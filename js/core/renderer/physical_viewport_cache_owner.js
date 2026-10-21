const defaultYieldControl = () => new Promise(resolve => setTimeout(resolve, 0));

export function createPhysicalViewportCacheOwner({
  readSnapshot, readCache, draw, createCanvas = () => document.createElement("canvas"),
  yieldControl = defaultYieldControl, canAllocate = () => true,
  onResource = () => {}, onReady = () => {}, onStats = () => {}, onError = () => {},
  maxBytes = 80 * 1024 * 1024, maxEntries = 3,
} = {}) {
  if ([readSnapshot, readCache, draw, createCanvas, yieldControl, canAllocate].some(fn => typeof fn !== "function")
    || !(Number.isSafeInteger(maxEntries) && maxEntries > 0) || !(Number.isFinite(maxBytes) && maxBytes > 0)) {
    throw new TypeError("Physical viewport caching requires snapshot, cache, draw and resource callbacks.");
  }
  const inactive = new Map(), owned = new WeakMap(), taken = new WeakSet();
  let candidate = null, committed = null, sourceKey, hasSource = false, failedKey, hasFailure = false;
  let pendingBytes = 0, stats = null, generation = 0, cacheHits = 0, cacheMisses = 0;
  const now = () => performance.now();
  const matches = job => job.canvas.width === job.layout.pixelWidth && job.canvas.height === job.layout.pixelHeight;
  const same = (snapshot, job) => snapshot && Object.is(snapshot.key, job.key)
    && Object.is(snapshot.sourceKey, job.sourceKey) && (!job.canvas || matches(job))
    && snapshot.layout?.pixelWidth === job.layout.pixelWidth && snapshot.layout?.pixelHeight === job.layout.pixelHeight;

  function charge() {
    pendingBytes = [...inactive.values()].reduce((bytes, job) => bytes + job.bytes, candidate?.bytes || 0);
    onResource(pendingBytes);
  }
  function release(job) {
    owned.delete(job.canvas);
    job.canvas.width = 1;
    job.canvas.height = 1;
  }
  function evictOldest() {
    const first = inactive.entries().next().value;
    if (!first) return false;
    inactive.delete(first[0]); release(first[1]); charge();
    return true;
  }
  function cancelCandidate() {
    if (!candidate) return;
    candidate.controller.abort();
    // A suspended draw retains its slot and ledger until its finally runs.
    if (candidate.ready) {
      const job = candidate;
      candidate = null; job.ready = false; release(job); charge();
    }
  }
  function clear() {
    generation++;
    committed = null; hasSource = false; hasFailure = false; stats = null;
    cancelCandidate();
    while (evictOldest()) { /* Release only private surfaces, never the active pass. */ }
    return candidate?.promise || null;
  }
  function admit(bytes, reserveEntry = true) {
    const limit = Math.max(0, maxEntries - (committed ? 1 : 0) - (reserveEntry ? 1 : 0));
    while (inactive.size > limit) evictOldest();
    while (true) {
      const total = pendingBytes + bytes;
      if (total <= maxBytes && canAllocate(total)) return true;
      if (!evictOldest()) return false;
    }
  }
  function prepare() {
    const snapshot = readSnapshot();
    if (!snapshot) return clear();
    if (!hasSource || !Object.is(sourceKey, snapshot.sourceKey)) {
      sourceKey = snapshot.sourceKey; hasSource = true; hasFailure = false;
      cancelCandidate();
      while (evictOldest()) { /* Source identity fences all historical rasters. */ }
    }
    if (candidate && !same(snapshot, candidate)) cancelCandidate();
    if (candidate) return candidate.ready ? null : candidate.promise;
    const cache = readCache();
    if (committed && same(snapshot, committed) && !cache?.dirty?.physicalBase
      && cache?.canvases?.physicalBase === committed.canvas) return null;
    if (hasFailure && Object.is(failedKey, snapshot.key)) return null;
    const cached = inactive.get(snapshot.key);
    if (cached && same(snapshot, cached)) {
      cacheHits++;
      inactive.delete(snapshot.key);
      candidate = { ...cached, snapshot, reference: snapshot.reference, layout: snapshot.layout,
        ready: true, controller: new AbortController(), promise: null };
      stats = { totalMs: 0, drawMs: 0, cacheHit: true };
      candidate.stats = stats;
      charge(); onStats(stats, snapshot);
      return null;
    }
    const { pixelWidth, pixelHeight } = snapshot.layout || {};
    const bytes = pixelWidth * pixelHeight * 4;
    if (![pixelWidth, pixelHeight].every(value => Number.isSafeInteger(value) && value > 0)
      || !Number.isSafeInteger(bytes) || !admit(bytes)) {
      failedKey = snapshot.key; hasFailure = true;
      if (committed) owned.delete(committed.canvas);
      stats = { skipped: "resource-budget", estimatedBytes: bytes };
      return null;
    }
    cacheMisses++;
    const job = { key: snapshot.key, sourceKey: snapshot.sourceKey, snapshot, layout: { ...snapshot.layout },
      reference: snapshot.reference, bytes, canvas: null, generation, controller: new AbortController(), ready: false, promise: null };
    candidate = job; charge();
    const current = () => candidate === job && !job.controller.signal.aborted && generation === job.generation
      && same(readSnapshot(), job);
    const started = now();
    job.promise = Promise.resolve().then(async () => {
      await yieldControl();
      // No render target is installed until this synchronous draw begins.
      if (candidate !== job || job.controller.signal.aborted || generation !== job.generation) return;
      const live = readSnapshot();
      if (!live || !Object.is(live.key, job.key) || !Object.is(live.sourceKey, job.sourceKey)
        || live.layout?.pixelWidth !== pixelWidth || live.layout?.pixelHeight !== pixelHeight) return;
      job.canvas = createCanvas(); job.canvas.width = pixelWidth; job.canvas.height = pixelHeight;
      const context = job.canvas.getContext("2d");
      if (!context) throw new Error("Physical viewport canvas has no 2D context.");
      const drawStart = now();
      const result = draw(context, snapshot);
      if (result && typeof result.then === "function") throw new TypeError("Physical viewport draw must be synchronous.");
      if (!current()) return;
      job.ready = true;
      job.stats = stats = { totalMs: now() - started, drawMs: now() - drawStart, cacheHit: false };
      onStats(stats, snapshot);
    }).catch(error => {
      const live = readSnapshot();
      if (!job.controller.signal.aborted && generation === job.generation
        && Object.is(live?.key, job.key) && Object.is(live?.sourceKey, job.sourceKey) && error?.name !== "AbortError") {
        failedKey = job.key; hasFailure = true;
        if (committed) owned.delete(committed.canvas);
        stats = { failed: String(error?.message || error) }; onError(error, snapshot);
      }
    }).finally(() => {
      if (!job.ready || job.controller.signal.aborted) {
        if (job.canvas) release(job);
        if (candidate === job) { candidate = null; charge(); }
      }
      onReady();
    });
    return job.promise;
  }
  function takeReady() {
    if (!candidate?.ready) return null;
    if (!same(readSnapshot(), candidate)) { cancelCandidate(); return null; }
    const job = candidate;
    candidate = null; charge(); taken.add(job);
    return job;
  }
  function noteCommitted(job, previousCanvas) {
    if (!taken.has(job)) throw new TypeError("Only a taken physical viewport canvas may be committed.");
    taken.delete(job);
    const previous = previousCanvas && owned.get(previousCanvas);
    committed = job; owned.set(job.canvas, job);
    if (maxEntries < 2 || !previous || previousCanvas === job.canvas || previous.generation !== generation
      || !Object.is(previous.sourceKey, job.sourceKey) || !matches(previous)) return false;
    if (!admit(previous.bytes)) { owned.delete(previousCanvas); return false; }
    const duplicate = inactive.get(previous.key);
    if (duplicate) { inactive.delete(previous.key); release(duplicate); }
    inactive.set(previous.key, previous); charge();
    return true;
  }
  function noteNativeDraw(canvas) {
    // Native fallback may repaint the active surface in place under another
    // viewport key. Its previous owner identity no longer describes its pixels.
    owned.delete(canvas);
    if (committed?.canvas === canvas) committed = null;
  }
  function getCurrentCommittedSnapshot() {
    const cache = readCache();
    if (!committed || cache?.dirty?.physicalBase || cache?.canvases?.physicalBase !== committed.canvas
      || !same(readSnapshot(), committed)) return null;
    return committed.snapshot;
  }
  return Object.freeze({ prepare, takeReady, noteCommitted, noteNativeDraw, clear,
    getCurrentCommittedSnapshot,
    getPendingPromise: () => candidate?.ready ? null : candidate?.promise || null,
    getPendingBytes: () => pendingBytes,
    getStats: () => ({ ...stats, cacheHits, cacheMisses,
      entries: inactive.size + (candidate ? 1 : 0) + (committed ? 1 : 0),
      inactiveBytes: [...inactive.values()].reduce((bytes, job) => bytes + job.bytes, 0), pendingBytes }) });
}
