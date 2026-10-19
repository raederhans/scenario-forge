import { createCanvasGpuSubmissionClient } from "../canvas_gpu_submission_client.js";
import { runCanvasDrawBatches as defaultRunCanvasDrawBatches } from "./canvas_draw_batch.js";

const abortError = () => new DOMException("Stale border canvas candidate.", "AbortError");

export function createBorderCanvasPreparationOwner({
  readSnapshot, readCache, draw, getPaintWork = () => 1,
  runCanvasDrawBatches = defaultRunCanvasDrawBatches,
  createGpuConsumer = createCanvasGpuSubmissionClient,
  createCanvas = () => document.createElement("canvas"),
  canAllocate = () => true,
  onResource = () => {}, onReady = () => {}, onStats = () => {}, onError = () => {},
  maxBytes = 80 * 1024 * 1024,
} = {}) {
  if ([readSnapshot, readCache, draw, getPaintWork, runCanvasDrawBatches, createGpuConsumer, createCanvas, canAllocate]
    .some(callback => typeof callback !== "function") || !(Number.isFinite(maxBytes) && maxBytes > 0)) {
    throw new TypeError("Border canvas preparation requires snapshot, cache, draw and resource callbacks.");
  }
  let candidate = null, committed = null, failedKey = null, consumer = null, closingPromise = null;
  let pendingBytes = 0, stats = null;
  const taken = new WeakSet();

  function charge(bytes, allocation = { bitmaps: bytes, gpuTextures: 0 }) {
    pendingBytes = bytes;
    onResource(bytes, allocation);
  }

  function canvasMatches(job) {
    return job.canvas.width === job.layout.pixelWidth && job.canvas.height === job.layout.pixelHeight;
  }

  function cancelCandidate() {
    const job = candidate;
    if (!job) return;
    job.controller.abort();
    // Running replay/consumption still owns its canvas and GPU allocation.
    // Its finally releases the slot and ledger after cancellation cleanup ACK.
    if (job.ready) {
      job.ready = false;
      job.canvas.width = 1; job.canvas.height = 1;
      candidate = null;
      charge(0);
    }
  }

  function clear() {
    committed = null; failedKey = null; stats = null;
    cancelCandidate();
    if (closingPromise) return closingPromise;
    if (!consumer && !candidate) return null;
    const draining = candidate?.promise, closingConsumer = consumer;
    // Keep the session closed to new work until both the runner and persistent
    // GPU consumer have acknowledged cleanup. Normal view changes skip this.
    closingPromise = Promise.resolve().then(async () => {
      const completed = await Promise.allSettled([draining, Promise.resolve().then(() => closingConsumer?.dispose())]);
      const failure = completed.find(result => result.status === "rejected");
      if (failure) onError(failure.reason, null);
    }).finally(() => {
      if (consumer === closingConsumer) consumer = null;
      closingPromise = null;
      onReady();
    });
    return closingPromise;
  }

  function cancelPreparation() {
    const draining = candidate?.promise || null;
    cancelCandidate();
    return draining;
  }

  function getCurrentCommittedSnapshot() {
    if (!committed || !canvasMatches(committed)) return null;
    const snapshot = readSnapshot();
    const cache = readCache();
    if (cache?.dirty?.borders || cache?.canvases?.borders !== committed.canvas) return null;
    return Object.is(snapshot?.key, committed.key) ? committed.snapshot : null;
  }

  function prepare() {
    const snapshot = readSnapshot();
    if (!snapshot) return clear();
    if (closingPromise) return closingPromise;
    if (candidate && (!Object.is(candidate.key, snapshot.key) || !canvasMatches(candidate))) cancelCandidate();
    const cache = readCache();
    if (committed && Object.is(committed.key, snapshot.key) && canvasMatches(committed)
      && !cache?.dirty?.borders && cache?.canvases?.borders === committed.canvas) return null;
    if (candidate) return candidate.ready ? null : candidate.promise;
    if (Object.is(failedKey, snapshot.key)) return null;
    const { pixelWidth, pixelHeight } = snapshot.layout || {};
    const bytes = pixelWidth * pixelHeight * 4, reservation = bytes * 3;
    if (![pixelWidth, pixelHeight].every(value => Number.isSafeInteger(value) && value > 0)
      || !Number.isSafeInteger(reservation) || reservation > maxBytes || !canAllocate(reservation)) {
      failedKey = snapshot.key;
      stats = { skipped: "resource-budget", estimatedBytes: reservation };
      return null;
    }
    const canvas = createCanvas();
    canvas.width = pixelWidth; canvas.height = pixelHeight;
    const job = { snapshot, key: snapshot.key, canvas, layout: snapshot.layout, reference: snapshot.reference,
      controller: new AbortController(), ready: false, promise: null, stats: null };
    candidate = job;
    charge(reservation, { bitmaps: bytes * 2, gpuTextures: bytes });
    const current = () => candidate === job && !job.controller.signal.aborted && !closingPromise
      && Object.is(readSnapshot()?.key, job.key) && canvasMatches(job);
    job.promise = Promise.resolve().then(async () => {
      if (!current()) throw abortError();
      consumer ||= createGpuConsumer();
      const result = await runCanvasDrawBatches({ canvas, signal: job.controller.signal, isCurrent: current,
        batchSize: Number.MAX_SAFE_INTEGER, maxBatchWork: 8192, getPaintWork, gpuConsumer: consumer,
        // Root installs and restores its render target only inside this sync
        // callback. All runner yields happen after that scope has closed.
        draw: context => draw(context, snapshot) });
      if (!current()) throw abortError();
      job.ready = true;
      job.stats = stats = { ...result.stats };
      charge(bytes);
      onStats(stats, snapshot);
    }).catch(error => {
      if (current() && error?.name !== "AbortError") {
        failedKey = job.key;
        stats = { failed: String(error?.message || error) };
        onError(error, snapshot);
      }
    }).finally(() => {
      if (!job.ready || job.controller.signal.aborted) {
        job.ready = false;
        canvas.width = 1; canvas.height = 1;
        if (candidate === job) { candidate = null; charge(0); }
      }
      onReady();
    });
    return job.promise;
  }

  function takeReady() {
    const job = candidate;
    if (!job?.ready) return null;
    if (job.controller.signal.aborted || !Object.is(readSnapshot()?.key, job.key) || !canvasMatches(job)) {
      cancelCandidate();
      return null;
    }
    candidate = null;
    charge(0);
    taken.add(job);
    return job;
  }

  function noteCommitted(job) {
    if (!taken.has(job)) throw new TypeError("Only a taken border canvas may be committed.");
    taken.delete(job);
    committed = job;
  }

  return Object.freeze({ prepare, takeReady, noteCommitted, clear, cancelPreparation, getCurrentCommittedSnapshot,
    getPendingBytes: () => pendingBytes,
    getPendingPromise: () => closingPromise || (candidate?.ready ? null : candidate?.promise) || null,
    getStats: () => stats ? { ...stats } : null });
}
