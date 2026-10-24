import test from "node:test";
import assert from "node:assert/strict";
import { runCanvasDrawBatches } from "../js/core/renderer/canvas_draw_batch.js";
import { createCanvasGpuSubmissionKernel } from "../js/core/renderer/canvas_gpu_submission_kernel.js";

function harness() {
  let clock = 0, nativeTargetInstalled = false;
  const events = [], paints = [], stack = [];
  const identity = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  let alpha = 1, matrix = identity(), dash = [];
  const context = {
    reset() { alpha = 1; matrix = identity(); dash = []; this.fillStyle = "black"; stack.length = 0; paints.length = 0; },
    get globalAlpha() { return alpha; },
    set globalAlpha(value) { if (value >= 0 && value <= 1) alpha = value; },
    getTransform() { return { ...matrix }; },
    setTransform(...args) { matrix = args.length === 1 ? { ...args[0] } : Object.fromEntries(["a", "b", "c", "d", "e", "f"].map((key, i) => [key, args[i]])); },
    save() { stack.push({ alpha, matrix: { ...matrix }, dash: [...dash], fillStyle: this.fillStyle }); },
    restore() { const previous = stack.pop(); if (previous) { alpha = previous.alpha; matrix = previous.matrix; dash = previous.dash; this.fillStyle = previous.fillStyle; } },
    setLineDash(value) { dash = [...value]; }, getLineDash() { return [...dash]; },
    measureText(text) { return { width: text.length * alpha }; },
    beginPath() {}, rect() {}, clip() {}, moveTo() {}, lineTo() {}, closePath() {},
    clearRect(...args) { events.push(["clear", ...args]); },
    fill(path) { clock++; paints.push({ path, alpha, matrix: { ...matrix }, dash: [...dash], style: this.fillStyle }); },
    getImageData() { throw new Error("must not execute a pixel read during capture"); },
  };
  const canvas = { width: 20, height: 10, getContext(type) { assert.equal(type, "2d"); return context; } };
  context.canvas = canvas;
  let nextFence = 0;
  const waits = new Map();
  const gl = {
    TEXTURE_2D: 1, TEXTURE_MIN_FILTER: 2, TEXTURE_MAG_FILTER: 3, NEAREST: 4,
    TEXTURE_WRAP_S: 5, TEXTURE_WRAP_T: 6, CLAMP_TO_EDGE: 7, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 8,
    RGBA8: 9, RGBA: 10, UNSIGNED_BYTE: 11, NO_ERROR: 0, SYNC_GPU_COMMANDS_COMPLETE: 12,
    ALREADY_SIGNALED: 13, CONDITION_SATISFIED: 14, TIMEOUT_EXPIRED: 15, WAIT_FAILED: 16,
    createTexture() { events.push(["texture"]); return {}; },
    bindTexture() {}, texParameteri() {}, pixelStorei() {},
    texImage2D(...args) { assert.equal(args.at(-1).source, canvas); events.push(["upload", paints.length]); clock++; },
    getError() { events.push(["errorCheck"]); return 0; },
    fenceSync() { const fence = { id: ++nextFence }; waits.set(fence, 0); events.push(["fence", fence.id]); return fence; },
    flush() { events.push(["flush"]); },
    clientWaitSync(fence, flags, timeout) {
      assert.equal(flags, 0); assert.equal(timeout, 0);
      events.push(["poll", fence.id]);
      const polls = waits.get(fence); waits.set(fence, polls + 1);
      return polls ? this.CONDITION_SATISFIED : this.TIMEOUT_EXPIRED;
    },
    deleteSync(fence) { events.push(["deleteFence", fence.id]); },
    deleteTexture() { events.push(["deleteTexture"]); },
    isContextLost() { return false; },
    getExtension(name) { assert.equal(name, "WEBGL_lose_context"); return { loseContext() { events.push(["loseContext"]); } }; },
  };
  const gpuCanvas = { width: 1, height: 1, getContext(type) { assert.equal(type, "webgl2"); return gl; } };
  const options = { canvas, now: () => clock,
    createBitmap: async source => ({ source, width: source.width, height: source.height, close() {} }),
    yieldTask: async () => { assert.equal(nativeTargetInstalled, false, "no renderer target survives across a yield"); events.push(["yield"]); clock++; } };
  options.yieldFenceTask = options.yieldTask;
  // The injection keeps native GPU assertions in a test adapter. Production
  // always uses the Worker client and has no main-thread WebGL fallback.
  options.createGpuConsumer = () => {
    const kernel = createCanvasGpuSubmissionKernel({ createGpuCanvas: () => gpuCanvas,
      now: () => options.now(), yieldTask: () => options.yieldFenceTask() });
    return { consume: (bitmap, { signal, ...input }) => kernel.consume(bitmap, { ...input,
      isCancelled: () => !!signal?.aborted }), dispose: async () => kernel.dispose() };
  };
  return { context, canvas, gl, gpuCanvas, events, paints, options,
    draw(callback) { nativeTargetInstalled = true; try { return callback(); } finally { nativeTargetInstalled = false; } } };
}

test("capture preserves native state queries and replays immutable paths in order with real upload/fence boundaries", async () => {
  const h = harness(), path = { immutablePath: true }, matrix = { a: 2, b: 0, c: 0, d: 2, e: 3, f: 5 }, dash = [2, 4];
  let drawEntered = false;
  const pending = runCanvasDrawBatches({ ...h.options, batchSize: 2, draw: context => h.draw(() => {
    drawEntered = true;
    assert.deepEqual(h.events, [["yield"]], "capture starts in a later host task");
    context.setTransform(matrix); matrix.e = 999;
    context.globalAlpha = 0.5; context.save(); context.globalAlpha = 2;
    assert.equal(context.globalAlpha, 0.5, "invalid native alpha writes remain ignored");
    context.setLineDash(dash); dash[0] = 999;
    assert.deepEqual(context.getLineDash(), [2, 4]);
    assert.equal(context.measureText("ab").width, 1);
    assert.equal(context.getTransform().e, 3);
    context.fillStyle = "red"; context.fill(path); context.restore();
    context.globalAlpha = 0.25; context.fill(path); context.fillStyle = "blue"; context.fill(path);
    assert.equal(h.paints.length, 0, "capture does not execute any native paint");
  }) });
  assert.equal(drawEntered, false);
  const { canvas, stats } = await pending;
  assert.equal(canvas, h.canvas);
  assert.deepEqual(h.paints.map(p => [p.path, p.alpha, p.matrix.e, p.style]),
    [[path, 0.5, 3, "red"], [path, 0.25, 3, "black"], [path, 0.25, 3, "blue"]]);
  assert.deepEqual(h.paints[0].dash, [2, 4]);
  assert.deepEqual(h.events.filter(([name]) => name === "upload"), [["upload", 2], ["upload", 3]]);
  assert.equal(stats.paintCount, 3); assert.equal(stats.batchCount, 2);
  assert.equal(stats.gpuTextureBytes, 20 * 10 * 4);
  assert.equal(stats.captureMs, 0); assert.equal(stats.replayMs, 3);
  assert.equal(stats.uploadMs, 0); assert.equal(stats.workerUploadMs, 2);
  assert.equal(stats.workerFenceWaitMs, 4); assert.equal(stats.yieldWallMs, 1);
  assert.equal(stats.totalMs, 10);
  assert.ok(stats.commandCount > stats.paintCount); assert.ok(stats.maxBatchMs > 0);
  assert.deepEqual(h.events.slice(-2), [["deleteTexture"], ["loseContext"]]);
  assert.equal(h.gpuCanvas.width, 0); assert.equal(h.gpuCanvas.height, 0);
});

test("cancellation while waiting releases the live fence and texture without painting another batch", async () => {
  const h = harness(), controller = new AbortController();
  h.gl.clientWaitSync = function(fence) { h.events.push(["poll", fence.id]); controller.abort(); return this.TIMEOUT_EXPIRED; };
  await assert.rejects(runCanvasDrawBatches({ ...h.options, signal: controller.signal, batchSize: 2,
    draw(context) { for (let i = 0; i < 5; i++) context.fill({ id: i }); } }), { name: "AbortError" });
  assert.equal(h.paints.length, 2);
  assert.equal(h.events.some(([name]) => name === "errorCheck"), false, "an outstanding fence never triggers a synchronous error query");
  assert.deepEqual(h.events.slice(-3), [["deleteFence", 1], ["deleteTexture"], ["loseContext"]]);
});

test("error checks follow fence completion and native submission and cleanup timings are measured separately", async () => {
  const h = harness(); let complete = false;
  const { now } = h.options;
  let nativeCost = 0;
  h.options.now = () => now() + nativeCost;
  const originalWait = h.gl.clientWaitSync;
  h.gl.clientWaitSync = function(...args) {
    const status = originalWait.apply(this, args);
    if (status === this.CONDITION_SATISFIED) complete = true;
    return status;
  };
  const originalFence = h.gl.fenceSync;
  h.gl.fenceSync = function(...args) { nativeCost += 3; return originalFence.apply(this, args); };
  h.gl.flush = () => { nativeCost += 5; h.events.push(["flush"]); };
  h.gl.getError = () => { assert.equal(complete, true); nativeCost += 7; h.events.push(["errorCheck"]); return 0; };
  const originalDeleteFence = h.gl.deleteSync;
  h.gl.deleteSync = function(fence) { nativeCost += 11; originalDeleteFence.call(this, fence); };
  h.gl.deleteTexture = () => { nativeCost += 13; h.events.push(["deleteTexture"]); };
  const { stats } = await runCanvasDrawBatches({ ...h.options, draw(context) { context.fill({}); } });
  assert.equal(stats.workerFenceMs, 3); assert.equal(stats.workerFlushMs, 5);
  assert.equal(stats.workerErrorCheckMs, 7); assert.equal(stats.workerCleanupMs, 24);
  assert.equal(stats.fenceMs, 0); assert.equal(stats.flushMs, 0); assert.equal(stats.errorCheckMs, 0);
  const names = h.events.map(([name]) => name);
  assert.ok(names.indexOf("errorCheck") > names.lastIndexOf("poll"));
  assert.ok(stats.totalMs >= stats.fenceMs + stats.flushMs + stats.errorCheckMs + stats.cleanupMs);
});

test("an upload error observed after the fence still rejects and releases all resources", async () => {
  const h = harness();
  h.gl.getError = () => { h.events.push(["errorCheck"]); return 999; };
  await assert.rejects(runCanvasDrawBatches({ ...h.options, draw(context) { context.fill({}); } }), /upload failed/);
  const names = h.events.map(([name]) => name);
  assert.ok(names.indexOf("errorCheck") > names.lastIndexOf("poll"));
  assert.deepEqual(h.events.slice(-3), [["deleteFence", 1], ["deleteTexture"], ["loseContext"]]);
});

test("a stale source at the first yield never enters capture or creates GPU resources", async () => {
  const h = harness(); let current = true, captured = false;
  await assert.rejects(runCanvasDrawBatches({ ...h.options, isCurrent: () => current,
    yieldTask: async () => { current = false; }, draw() { captured = true; } }), { name: "AbortError" });
  assert.equal(captured, false); assert.deepEqual(h.events, []);
});

test("unsupported pixel reads and capture exceptions fail before GPU creation", async () => {
  for (const draw of [context => context.getImageData(0, 0, 1, 1), () => { throw new Error("capture failure"); }]) {
    const h = harness();
    await assert.rejects(runCanvasDrawBatches({ ...h.options, draw }), /Unsupported physical canvas capture method|capture failure/);
    assert.deepEqual(h.events, [["yield"]]); assert.equal(h.paints.length, 0);
  }
});

test("failed fence waits and context loss release private GPU resources", async () => {
  for (const outcome of ["failed", "lost"]) {
    const h = harness();
    h.gl.clientWaitSync = function() { if (outcome === "lost") this.isContextLost = () => true; return outcome === "failed" ? this.WAIT_FAILED : this.TIMEOUT_EXPIRED; };
    await assert.rejects(runCanvasDrawBatches({ ...h.options, draw(context) { context.fill({}); } }), /fence wait failed|context was lost/);
    assert.deepEqual(h.events.slice(-3), [["deleteFence", 1], ["deleteTexture"], ["loseContext"]]);
  }
});

test("native replay failures never create a GPU consumer or fence", async () => {
  const h = harness();
  h.context.fill = () => { throw new Error("native fill failed"); };
  await assert.rejects(runCanvasDrawBatches({ ...h.options, draw(context) { context.fill({}); } }), /native fill failed/);
  assert.deepEqual(h.events, [["yield"]]);
  assert.equal(h.events.some(([name]) => name === "fence"), false);
});

test("capture handles expire before replay and asynchronous draw callbacks are rejected", async () => {
  const h = harness(); let recordedContext, savedFill;
  await assert.rejects(runCanvasDrawBatches({ ...h.options, draw(context) {
    recordedContext = context; savedFill = context.fill;
    return Promise.resolve();
  } }), /draw must be synchronous/);
  assert.throws(() => recordedContext.globalAlpha, /revoked/);
  assert.throws(() => savedFill({}), /capture has ended/);
  assert.deepEqual(h.events, [["yield"]]);
});

test("capture yields at background priority but fence polling always uses timer tasks", async () => {
  const h = harness(), previous = Object.getOwnPropertyDescriptor(globalThis, "scheduler");
  const previousTimeout = globalThis.setTimeout;
  const priorities = [];
  let timers = 0;
  Object.defineProperty(globalThis, "scheduler", { configurable: true, value: {
    async postTask(callback, options) { priorities.push(options?.priority); return callback(); },
  } });
  globalThis.setTimeout = (callback, delay, ...args) => {
    timers++; assert.equal(delay, 0);
    return previousTimeout(callback, delay, ...args);
  };
  try {
    const { yieldTask, yieldFenceTask, ...options } = h.options;
    h.options.yieldFenceTask = () => new Promise(resolve => setTimeout(resolve, 0));
    await runCanvasDrawBatches({ ...options, draw(context) { context.fill({}); } });
    assert.deepEqual(priorities, ["background"], "only the initial capture slice goes through the background scheduler");
    assert.equal(timers, 2, "both zero-timeout fence polls yield through independent timer tasks");
  } finally {
    globalThis.setTimeout = previousTimeout;
    if (previous) Object.defineProperty(globalThis, "scheduler", previous);
    else delete globalThis.scheduler;
  }
});

test("bitmap snapshot synchronous call and asynchronous wait timings are recorded separately", async () => {
  const h = harness(); let clock = 0, resolveSnapshot;
  h.options.now = () => clock;
  h.options.createBitmap = source => {
    clock += 7;
    return new Promise(resolve => { resolveSnapshot = () => {
      clock += 11; resolve({ source, width: source.width, height: source.height, close() {} });
    }; });
  };
  const pending = runCanvasDrawBatches({ ...h.options, draw(context) { context.fill({}); } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.events.some(([name]) => name === "texture"), false, "GPU work cannot start before a snapshot exists");
  resolveSnapshot();
  const { canvas, stats } = await pending;
  assert.equal(canvas, h.canvas, "the consumed bitmap never replaces the original final canvas");
  assert.equal(stats.bitmapSnapshotCallMs, 7); assert.equal(stats.bitmapSnapshotWaitMs, 11);
  assert.equal(stats.errorCheckMs, 0);
});

test("a bitmap arriving after cancellation is closed without entering the Worker consumer", async () => {
  const h = harness(), controller = new AbortController(); let resolveSnapshot, closes = 0, consumers = 0;
  h.options.createBitmap = source => new Promise(resolve => { resolveSnapshot = () => resolve({
    width: source.width, height: source.height, close() { closes++; },
  }); });
  h.options.createGpuConsumer = () => { consumers++; throw new Error("stale bitmap must not enter consumer"); };
  const pending = runCanvasDrawBatches({ ...h.options, signal: controller.signal, draw(context) { context.fill({}); } });
  await new Promise(resolve => setImmediate(resolve)); controller.abort(); resolveSnapshot();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(closes, 1); assert.equal(consumers, 0);
});

test("snapshot exceptions and rejection fail without a Worker or pixel readback", async () => {
  for (const asynchronous of [false, true]) {
    const h = harness(); let consumers = 0;
    h.options.createBitmap = () => {
      if (asynchronous) return Promise.reject(new Error("snapshot rejected"));
      throw new Error("snapshot failed");
    };
    h.options.createGpuConsumer = () => { consumers++; };
    await assert.rejects(runCanvasDrawBatches({ ...h.options, draw(context) { context.fill({}); } }), /snapshot/);
    assert.equal(consumers, 0); assert.equal(h.events.some(([name]) => name === "texture"), false);
  }
});

test("runner cancellation does not dispose the consumer or resolve before its cleanup acknowledgement", async () => {
  const h = harness(), controller = new AbortController(); let release, disposed = false, settled = false, closes = 0;
  h.options.createBitmap = async source => ({ width: source.width, height: source.height, close() { closes++; } });
  h.options.createGpuConsumer = () => ({
    consume: async bitmap => {
      await new Promise(resolve => { release = resolve; });
      bitmap.close(); throw new DOMException("cleanup acknowledged", "AbortError");
    }, dispose: async () => { disposed = true; },
  });
  const pending = runCanvasDrawBatches({ ...h.options, signal: controller.signal, draw(context) { context.fill({}); } });
  pending.then(() => { settled = true; }, () => { settled = true; });
  await new Promise(resolve => setImmediate(resolve)); controller.abort();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false); assert.equal(disposed, false); assert.equal(closes, 0);
  release(); await assert.rejects(pending, { name: "AbortError" });
  assert.equal(disposed, true); assert.equal(closes, 1);
});

test("weighted paints group small paths at the limit and isolate a large path without changing native state or order", async () => {
  const h = harness(), paths = Array.from({ length: 6 }, (_, id) => ({ id }));
  const weights = new Map(paths.map((value, index) => [value, [3000, 2000, 16384, 4000, 4192, 0][index]]));
  const measured = [];
  const { stats } = await runCanvasDrawBatches({ ...h.options, maxBatchWork: 8192,
    getPaintWork(command) { measured.push(command); return weights.get(command.args[0]); },
    draw(context) {
      context.clearRect(0, 0, 20, 10);
      context.setTransform(2, 0, 0, 2, 3, 5); context.globalAlpha = 0.5;
      context.fill(paths[0]); context.fill(paths[1]);
      context.save(); context.globalAlpha = 0.25; context.fill(paths[2]); context.restore();
      context.fill(paths[3]); context.fill(paths[4]); context.globalAlpha = 0.75; context.fill(paths[5]);
    },
  });
  assert.deepEqual(h.events.filter(([name]) => name === "upload"), [["upload", 2], ["upload", 3], ["upload", 5], ["upload", 6]]);
  assert.deepEqual(h.paints.map(value => [value.path.id, value.alpha, value.matrix.e]),
    [[0, 0.5, 3], [1, 0.5, 3], [2, 0.25, 3], [3, 0.5, 3], [4, 0.5, 3], [5, 0.75, 3]]);
  assert.deepEqual(measured.map(value => value.method), Array(6).fill("fill"));
  assert.equal(stats.paintCount, 7, "the original clear command remains counted and replayed");
  assert.equal(stats.batchCount, 4);
});

test("default unit work retains batchSize behavior and clears alone never create a GPU consumer", async () => {
  const h = harness();
  const result = await runCanvasDrawBatches({ ...h.options, batchSize: 1, draw(context) {
    context.clearRect(0, 0, 20, 10); context.fill({ id: 1 }); context.fill({ id: 2 });
  } });
  assert.deepEqual(h.events.filter(([name]) => name === "upload"), [["upload", 1], ["upload", 2]]);
  assert.equal(result.stats.batchCount, 2);
  const cleared = harness(); let consumers = 0;
  const { stats } = await runCanvasDrawBatches({ ...cleared.options, batchSize: 1,
    createGpuConsumer() { consumers++; throw new Error("clear must not create GPU work"); },
    getPaintWork() { throw new Error("clear must not invoke the path work estimator"); },
    draw(context) { context.clearRect(0, 0, 20, 10); context.clearRect(1, 1, 2, 2); },
  });
  assert.equal(consumers, 0); assert.equal(stats.paintCount, 2); assert.equal(stats.batchCount, 0);
  assert.equal(cleared.events.filter(([name]) => name === "clear").length, 2);
});

test("invalid work estimates and limits fail before publishing, while zero-work paint still consumes", async () => {
  for (const maxBatchWork of [0, -1, Infinity, NaN]) {
    const h = harness();
    await assert.rejects(runCanvasDrawBatches({ ...h.options, maxBatchWork, draw(context) { context.fill({}); } }), /work limit/);
    assert.deepEqual(h.events, []);
  }
  for (const work of [-1, Infinity, NaN, "1", undefined]) {
    const h = harness();
    await assert.rejects(runCanvasDrawBatches({ ...h.options, getPaintWork: () => work, draw(context) { context.fill({}); } }), /nonnegative finite/);
    assert.equal(h.paints.length, 0); assert.equal(h.events.some(([name]) => name === "upload"), false);
  }
  const h = harness();
  const { stats } = await runCanvasDrawBatches({ ...h.options, maxBatchWork: 8192, getPaintWork: () => 0,
    draw(context) { context.fill({}); context.fill({}); },
  });
  assert.equal(stats.batchCount, 1); assert.equal(h.paints.length, 2);
});

test("cancellation at the pre-large-paint flush cannot execute the large paint or later commands", async () => {
  const h = harness(), controller = new AbortController();
  h.gl.clientWaitSync = function() { controller.abort(); return this.TIMEOUT_EXPIRED; };
  await assert.rejects(runCanvasDrawBatches({ ...h.options, signal: controller.signal, maxBatchWork: 8192,
    getPaintWork: command => command.args[0].work,
    draw(context) { context.fill({ id: "small", work: 1 }); context.fill({ id: "large", work: 10000 }); context.fill({ id: "late", work: 1 }); },
  }), { name: "AbortError" });
  assert.deepEqual(h.paints.map(value => value.path.id), ["small"]);
  assert.deepEqual(h.events.filter(([name]) => name === "upload"), [["upload", 1]]);
});
