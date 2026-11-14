import test from "node:test";
import assert from "node:assert/strict";
import { createBorderCanvasPreparationOwner } from "../js/core/renderer/border_canvas_preparation_owner.js";
import { runCanvasDrawBatches } from "../js/core/renderer/canvas_draw_batch.js";

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

function fixture(options = {}) {
  const h = { snapshot: { key: "scene-a", layout: { pixelWidth: 20, pixelHeight: 10 }, reference: { x: 1, y: 2, k: 2.5 } },
    cache: { dirty: { borders: true }, canvases: {} }, canvases: [], consumers: [], runs: [], resources: [],
    errors: [], statistics: [], draws: [], ready: 0, disposals: 0, admitted: [], admit: true,
    runGate: null, disposeGate: null, failure: null, gpuFailure: null, targetInstalled: false };
  h.owner = createBorderCanvasPreparationOwner({
    readSnapshot: () => h.snapshot, readCache: () => h.cache,
    createCanvas() { const canvas = { width: 0, height: 0 }; h.canvases.push(canvas); return canvas; },
    createGpuConsumer() {
      if (h.gpuFailure) throw h.gpuFailure;
      const consumer = { async dispose() { h.disposals++; await h.disposeGate?.promise; } };
      h.consumers.push(consumer);
      return consumer;
    },
    async runCanvasDrawBatches(input) {
      h.runs.push(input);
      const gate = h.runGate;
      await gate?.promise;
      assert.equal(h.targetInstalled, false, "every runner suspension is outside the render target scope");
      if (input.signal.aborted || !input.isCurrent()) throw new DOMException("stale", "AbortError");
      if (h.failure) throw h.failure;
      input.draw({ private: true });
      assert.equal(h.targetInstalled, false);
      return { canvas: input.canvas, stats: { totalMs: 12, batchCount: 3 } };
    },
    draw(context, snapshot) {
      h.targetInstalled = true;
      try { h.draws.push({ context, snapshot }); }
      finally { h.targetInstalled = false; }
    },
    getPaintWork: command => command.points,
    canAllocate(bytes) { h.admitted.push(bytes); return h.admit; },
    onResource(bytes, allocation) { h.resources.push({ bytes, ...allocation }); },
    onReady() { h.ready++; },
    onStats(stats, snapshot) { h.statistics.push({ stats, snapshot }); },
    onError(error, snapshot) { h.errors.push({ error, snapshot }); },
    ...options,
  });
  return h;
}

test("one private border candidate becomes ready, transfers ownership and recognizes its exact committed cache", async () => {
  const h = fixture(), pending = h.owner.prepare();
  assert.equal(h.owner.prepare(), pending);
  assert.equal(h.owner.getPendingPromise(), pending);
  assert.equal(h.owner.takeReady(), null);
  assert.equal(h.owner.getPendingBytes(), 2400);
  assert.deepEqual(h.resources, [{ bytes: 2400, bitmaps: 1600, gpuTextures: 800 }]);
  assert.deepEqual(h.draws, []);
  await pending;
  assert.equal(h.runs.length, 1);
  assert.equal(h.runs[0].batchSize, Number.MAX_SAFE_INTEGER);
  assert.equal(h.runs[0].maxBatchWork, 8192);
  assert.equal(h.runs[0].getPaintWork({ points: 37 }), 37);
  assert.equal(h.runs[0].gpuConsumer, h.consumers[0]);
  assert.equal(h.draws[0].snapshot, h.snapshot);
  assert.equal(h.owner.getPendingBytes(), 800);
  assert.equal(h.owner.getPendingPromise(), null);
  assert.equal(h.owner.prepare(), null, "a complete private candidate waits for atomic adoption");
  assert.equal(h.ready, 1);
  assert.deepEqual(h.owner.getStats(), { totalMs: 12, batchCount: 3 });
  const job = h.owner.takeReady();
  assert.equal(job.canvas, h.canvases[0]);
  assert.equal(job.layout, h.snapshot.layout);
  assert.equal(job.reference, h.snapshot.reference);
  assert.equal(h.owner.getPendingBytes(), 0);
  assert.equal(h.owner.takeReady(), null);
  h.cache.canvases.borders = job.canvas;
  h.cache.dirty.borders = false;
  h.owner.noteCommitted(job);
  assert.equal(h.owner.prepare(), null);
  assert.equal(h.runs.length, 1, "a clean matching pass cannot restart preparation forever");
  assert.deepEqual(h.resources.slice(1), [{ bytes: 800, bitmaps: 800, gpuTextures: 0 },
    { bytes: 0, bitmaps: 0, gpuTextures: 0 }]);
  assert.throws(() => h.owner.noteCommitted(job), /taken border canvas/);
});

test("zoom cancellation retains its single slot and full reservation until replay cleanup, then reuses the GPU session", async () => {
  const h = fixture();
  h.runGate = deferred();
  const previous = h.owner.prepare();
  await tick();
  assert.equal(h.runs.length, 1);
  h.snapshot = { ...h.snapshot, key: "scene-b" };
  assert.equal(h.owner.prepare(), previous);
  assert.equal(h.runs[0].signal.aborted, true);
  assert.equal(h.owner.getPendingBytes(), 2400);
  assert.equal(h.canvases.length, 1);
  h.runGate.resolve();
  await previous;
  assert.equal(h.owner.getPendingBytes(), 0);
  assert.equal(h.canvases[0].width, 1);
  assert.deepEqual(h.draws, []);
  assert.deepEqual(h.errors, []);
  h.runGate = null;
  await h.owner.prepare();
  assert.equal(h.consumers.length, 1, "ordinary zoom retains the same worker session");
  assert.equal(h.disposals, 0);
  assert.equal(h.owner.takeReady().key, "scene-b");
});

test("clear waits for runner cleanup and consumer disposal ACK before allowing a new session", async () => {
  const h = fixture();
  h.runGate = deferred(); h.disposeGate = deferred();
  const pending = h.owner.prepare();
  await tick();
  const closing = h.owner.clear();
  assert.equal(h.owner.clear(), closing);
  h.snapshot = { ...h.snapshot, key: "scene-b" };
  assert.equal(h.owner.prepare(), closing);
  assert.equal(h.owner.getPendingPromise(), closing);
  assert.equal(h.owner.getPendingBytes(), 2400);
  let closed = false;
  closing.then(() => { closed = true; });
  h.runGate.resolve();
  await pending;
  assert.equal(h.owner.getPendingBytes(), 0);
  assert.equal(h.disposals, 1);
  assert.equal(closed, false);
  assert.equal(h.owner.prepare(), closing);
  assert.equal(h.consumers.length, 1);
  h.disposeGate.resolve();
  await closing;
  h.runGate = null; h.disposeGate = null;
  await h.owner.prepare();
  assert.equal(h.consumers.length, 2);
  assert.equal(h.owner.takeReady().key, "scene-b");
});

test("clearing a ready candidate releases its canvas immediately but still fences session disposal", async () => {
  const h = fixture();
  await h.owner.prepare();
  h.disposeGate = deferred();
  const closing = h.owner.clear();
  assert.equal(h.owner.getPendingBytes(), 0);
  assert.equal(h.canvases[0].width, 1);
  assert.equal(h.owner.takeReady(), null);
  assert.equal(h.owner.getStats(), null);
  assert.equal(h.owner.prepare(), closing);
  h.disposeGate.resolve();
  await closing;
});

test("a current non-abort failure falls back once per view and a new key can recover", async () => {
  const h = fixture();
  h.failure = new Error("native submission failed");
  await h.owner.prepare();
  assert.equal(h.owner.getPendingBytes(), 0);
  assert.equal(h.errors.length, 1);
  assert.equal(h.ready, 1, "the failure wakes the caller to draw its native fallback");
  assert.deepEqual(h.owner.getStats(), { failed: "native submission failed" });
  h.failure = null;
  for (let retry = 0; retry < 3; retry++) assert.equal(h.owner.prepare(), null);
  assert.equal(h.runs.length, 1);
  h.snapshot = { ...h.snapshot, key: "scene-b" };
  await h.owner.prepare();
  assert.equal(h.runs.length, 2);
  assert.equal(h.owner.takeReady().key, "scene-b");
});

test("shared and local resource admission deny a view without allocating or creating a retry loop", async () => {
  for (const local of [false, true]) {
    const h = fixture(local ? { maxBytes: 2399 } : {});
    h.admit = false;
    assert.equal(h.owner.prepare(), null);
    assert.equal(h.owner.getPendingBytes(), 0);
    assert.equal(h.canvases.length, 0);
    assert.equal(h.consumers.length, 0);
    assert.deepEqual(h.errors, []);
    h.admit = true;
    assert.equal(h.owner.prepare(), null, "admission denial is suppressed for this exact view");
    assert.equal(h.admitted.length, local ? 0 : 1);
    await h.owner.clear();
    if (!local) {
      await h.owner.prepare();
      assert.equal(h.owner.takeReady().key, "scene-a");
    }
  }
});

test("dirty or replaced committed canvases prepare again while stale ready canvases never escape", async () => {
  const h = fixture();
  await h.owner.prepare();
  const first = h.owner.takeReady();
  h.cache.canvases.borders = first.canvas; h.cache.dirty.borders = false;
  h.owner.noteCommitted(first);
  h.cache.dirty.borders = true;
  await h.owner.prepare();
  const second = h.owner.takeReady();
  h.cache.canvases.borders = second.canvas; h.cache.dirty.borders = false;
  h.owner.noteCommitted(second);
  h.cache.canvases.borders = {};
  await h.owner.prepare();
  assert.equal(h.runs.length, 3);
  h.snapshot = { ...h.snapshot, key: "scene-b" };
  assert.equal(h.owner.takeReady(), null);
  assert.equal(h.owner.getPendingBytes(), 0);
  assert.equal(h.canvases[2].width, 1);
});

test("a missing snapshot clears the committed identity and drains a session only once", async () => {
  const h = fixture();
  await h.owner.prepare();
  const job = h.owner.takeReady();
  h.cache.canvases.borders = job.canvas; h.cache.dirty.borders = false;
  h.owner.noteCommitted(job);
  h.snapshot = null;
  await h.owner.prepare();
  assert.equal(h.disposals, 1);
  assert.equal(h.owner.prepare(), null);
  assert.equal(h.disposals, 1);
  h.snapshot = job.snapshot;
  await h.owner.prepare();
  assert.equal(h.runs.length, 2, "clear removed the old committed shortcut");
});

test("GPU session construction failures release the reservation and suppress only that view", async () => {
  const h = fixture();
  h.gpuFailure = new Error("worker session unavailable");
  await h.owner.prepare();
  assert.equal(h.owner.getPendingBytes(), 0);
  assert.equal(h.errors.length, 1);
  assert.equal(h.runs.length, 0);
  assert.equal(h.owner.prepare(), null);
});

test("cancelPreparation drains a running candidate before releasing its slot and reuses the consumer", async () => {
  const h = fixture(); h.runGate = deferred();
  const pending = h.owner.prepare(); await tick();
  const consumer = h.consumers[0], candidate = h.canvases[0];
  assert.equal(h.owner.cancelPreparation(), pending);
  assert.equal(h.owner.cancelPreparation(), pending);
  assert.equal(h.runs[0].signal.aborted, true);
  assert.equal(h.owner.getPendingPromise(), pending);
  assert.equal(h.owner.getPendingBytes(), 2400);
  assert.deepEqual([candidate.width, candidate.height], [20, 10]);
  assert.deepEqual(h.resources, [{ bytes: 2400, bitmaps: 1600, gpuTextures: 800 }]);
  assert.equal(h.disposals, 0);
  h.snapshot = { ...h.snapshot, key: "new-source" };
  assert.equal(h.owner.prepare(), pending); assert.equal(h.canvases.length, 1);
  h.runGate.resolve(); await pending;
  assert.equal(h.owner.getPendingPromise(), null); assert.equal(h.owner.getPendingBytes(), 0);
  assert.deepEqual([candidate.width, candidate.height], [1, 1]);
  assert.deepEqual(h.resources.at(-1), { bytes: 0, bitmaps: 0, gpuTextures: 0 });
  assert.deepEqual(h.errors, []); assert.equal(h.ready, 1);
  h.runGate = null; await h.owner.prepare();
  assert.equal(h.consumers.length, 1); assert.equal(h.runs[1].gpuConsumer, consumer);
  assert.equal(h.disposals, 0); assert.equal(h.owner.takeReady().key, "new-source");
});

test("cancelPreparation releases a ready candidate immediately without closing its reusable session", async () => {
  const h = fixture(); await h.owner.prepare();
  const consumer = h.consumers[0], candidate = h.canvases[0];
  const cancelled = h.owner.cancelPreparation();
  assert.equal(typeof cancelled?.then, "function");
  assert.equal(h.owner.getPendingBytes(), 0); assert.equal(h.owner.getPendingPromise(), null);
  assert.deepEqual([candidate.width, candidate.height], [1, 1]);
  assert.equal(h.owner.takeReady(), null); assert.equal(h.disposals, 0);
  assert.equal(h.owner.cancelPreparation(), null); await cancelled;
  await h.owner.prepare();
  assert.equal(h.consumers.length, 1); assert.equal(h.runs[1].gpuConsumer, consumer);
  assert.equal(h.disposals, 0); assert.ok(h.owner.takeReady());
});

test("candidate-only cancellation preserves a committed pass and its clean-cache shortcut", async () => {
  const h = fixture(); await h.owner.prepare();
  const committed = h.owner.takeReady();
  h.cache.canvases.borders = committed.canvas; h.cache.dirty.borders = false;
  h.owner.noteCommitted(committed);
  assert.equal(h.owner.cancelPreparation(), null); assert.equal(h.owner.prepare(), null);
  h.snapshot = { ...h.snapshot, key: "scene-b" }; h.cache.dirty.borders = true; h.runGate = deferred();
  const pending = h.owner.prepare(); await tick();
  assert.equal(h.owner.cancelPreparation(), pending);
  h.runGate.resolve(); await pending;
  h.snapshot = committed.snapshot; h.cache.dirty.borders = false;
  assert.equal(h.owner.prepare(), null, "cancelling a superseded candidate cannot forget the accepted pass");
  assert.deepEqual([committed.canvas.width, committed.canvas.height], [20, 10]);
  assert.equal(h.cache.canvases.borders, committed.canvas);
  assert.equal(h.runs.length, 2); assert.equal(h.disposals, 0);
});

test("committed surface validation rejects dirty, replaced, resized and stale inputs without mutating them", async () => {
  const h = fixture();
  assert.equal(h.owner.getCurrentCommittedSnapshot(), null);
  await h.owner.prepare();
  const committed = h.owner.takeReady();
  h.owner.noteCommitted(committed);
  h.cache.canvases.borders = committed.canvas;
  h.cache.dirty.borders = false;
  assert.equal(h.owner.getCurrentCommittedSnapshot(), committed.snapshot);
  for (const mutate of [
    () => { h.cache.dirty.borders = true; },
    () => { h.cache.canvases.borders = {}; },
    () => { committed.canvas.width++; },
    () => { h.snapshot = { ...committed.snapshot, key: "new-input" }; },
    () => { h.snapshot = null; },
  ]) {
    mutate();
    assert.equal(h.owner.getCurrentCommittedSnapshot(), null);
    h.cache.dirty.borders = false;
    h.cache.canvases.borders = committed.canvas;
    committed.canvas.width = committed.layout.pixelWidth;
    h.snapshot = committed.snapshot;
    assert.equal(h.owner.getCurrentCommittedSnapshot(), committed.snapshot);
  }
});

function replayFixture() {
  const h = { snapshot: { key: "scene-a", layout: { pixelWidth: 20, pixelHeight: 10 }, reference: { x: 0, y: 0, k: 1 } },
    snapshotReads: 0, consumes: 0, gate: null, strokes: 6 };
  const workerStats = Object.fromEntries(["workerContextInitMs", "workerTextureSetupMs", "workerContextCreationCount",
    "workerContextReuseCount", "workerUploadMs", "workerFenceMs", "workerFlushMs", "workerFenceWaitMs",
    "workerErrorCheckMs", "workerCleanupMs", "workerTotalMs"].map(name => [name, 0]));
  h.owner = createBorderCanvasPreparationOwner({
    readSnapshot: () => { h.snapshotReads++; return h.snapshot; },
    readCache: () => ({ dirty: { borders: true }, canvases: {} }),
    createCanvas() {
      const context = { reset() {}, beginPath() {}, stroke() {} };
      return { width: 0, height: 0, getContext: () => context };
    },
    createGpuConsumer: () => ({
      async consume(bitmap) { h.consumes++; bitmap.close(); await h.gate?.promise; return workerStats; },
      async dispose() {},
    }),
    runCanvasDrawBatches: input => runCanvasDrawBatches({ ...input, now: () => 0, yieldTask: async () => {},
      createBitmap: async canvas => ({ width: canvas.width, height: canvas.height, close() {} }) }),
    draw(context) { for (let index = 0; index < h.strokes; index++) { context.beginPath(); context.stroke(); } },
    getPaintWork: () => 8192,
  });
  return h;
}

test("replay batches read the border snapshot a fixed number of times, however many batches run", async () => {
  const reads = [];
  for (const strokes of [2, 12]) {
    const h = replayFixture();
    h.strokes = strokes;
    await h.owner.prepare();
    assert.equal(h.consumes, strokes, "each stroke is its own batch");
    assert.ok(h.owner.takeReady());
    reads.push(h.snapshotReads);
  }
  assert.equal(reads[0], reads[1]);
});

test("a view change during replay cancels the candidate at the next prepare and it never becomes ready", async () => {
  const h = replayFixture();
  h.gate = deferred();
  const running = h.owner.prepare();
  while (h.consumes === 0) await tick();
  h.snapshot = { ...h.snapshot, key: "scene-b" };
  // The aborted candidate keeps its single slot until its cleanup completes.
  assert.equal(h.owner.prepare(), running);
  h.gate.resolve();
  await running;
  assert.equal(h.consumes, 1, "the aborted candidate stops after the batch in flight");
  assert.equal(h.owner.takeReady(), null);
  h.gate = null;
  await h.owner.prepare();
  assert.equal(h.owner.takeReady()?.key, "scene-b", "only the current view's candidate is adopted");
});
