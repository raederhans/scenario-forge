import test from "node:test";
import assert from "node:assert/strict";
import { createCanvasGpuSubmissionKernel } from "../js/core/renderer/canvas_gpu_submission_kernel.js";
import { createCanvasGpuSubmissionWorkerRuntime } from "../js/workers/canvas_gpu_submission.worker.js";
import { createCanvasGpuSubmissionClient } from "../js/core/canvas_gpu_submission_client.js";
import { runCanvasDrawBatches } from "../js/core/renderer/canvas_draw_batch.js";

function harness() {
  const events = []; let clock = 0, polls = 0;
  const bitmap = { width: 20, height: 10, close() { events.push("bitmap-close"); } };
  const gl = { TEXTURE_2D: 1, TEXTURE_MIN_FILTER: 2, TEXTURE_MAG_FILTER: 3, NEAREST: 4,
    TEXTURE_WRAP_S: 5, TEXTURE_WRAP_T: 6, CLAMP_TO_EDGE: 7, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 8,
    RGBA8: 9, RGBA: 10, UNSIGNED_BYTE: 11, NO_ERROR: 0, SYNC_GPU_COMMANDS_COMPLETE: 12,
    ALREADY_SIGNALED: 13, CONDITION_SATISFIED: 14, TIMEOUT_EXPIRED: 15, WAIT_FAILED: 16,
    createTexture() { events.push("texture"); return {}; }, bindTexture() {}, texParameteri() {}, pixelStorei() {},
    texImage2D(...args) { assert.equal(args.at(-1), bitmap); events.push("upload"); clock += 2; },
    fenceSync() { events.push("fence"); return {}; }, flush() { events.push("flush"); },
    clientWaitSync(_fence, flags, timeout) { assert.equal(flags, 0); assert.equal(timeout, 0); events.push("poll"); return polls++ ? this.CONDITION_SATISFIED : this.TIMEOUT_EXPIRED; },
    getError() { events.push("error"); clock += 109; return 0; }, isContextLost() { return false; },
    deleteSync() { events.push("delete-fence"); }, deleteTexture() { events.push("delete-texture"); },
    getExtension() { return { loseContext() { events.push("lose-context"); } }; },
  };
  const canvas = { width: 1, height: 1, getContext() { return gl; } };
  const options = { createGpuCanvas: () => canvas, yieldTask: async () => { events.push("timer"); clock++; }, now: () => clock };
  const kernel = createCanvasGpuSubmissionKernel(options);
  return { events, bitmap, gl, canvas, options, kernel, input: { width: 20, height: 10 } };
}

test("Worker consumption releases candidate resources while retaining its context until explicit disposal", async () => {
  const h = harness(), stats = await h.kernel.consume(h.bitmap, h.input);
  assert.equal(stats.workerErrorCheckMs, 109); assert.equal(stats.workerUploadMs, 2);
  assert.equal(stats.workerFenceWaitMs, 2); assert.equal(stats.bitmapBytes, 800); assert.equal(stats.gpuTextureBytes, 800);
  assert.ok(h.events.indexOf("error") > h.events.lastIndexOf("poll"));
  assert.deepEqual(h.events.slice(-3), ["delete-fence", "delete-texture", "bitmap-close"]);
  assert.equal(h.events.includes("lose-context"), false); assert.equal(h.canvas.width, 1);
  h.kernel.dispose();
  assert.equal(h.events.at(-1), "lose-context");
  assert.equal(h.canvas.width, 0); assert.equal(h.canvas.height, 0);
});

test("cancellation, WebGL errors, context loss and allocation failures close bitmap and GPU resources", async () => {
  for (const failure of ["cancel", "error", "lost", "fence", "texture", "wait", "upload", "unsupported", "size"]) {
    const h = harness(); let cancelled = false;
    if (failure === "cancel") h.options.yieldTask = async () => { cancelled = true; };
    if (failure === "error") h.gl.getError = () => 1285;
    if (failure === "lost") h.gl.isContextLost = () => true;
    if (failure === "fence") h.gl.fenceSync = () => null;
    if (failure === "texture") h.gl.createTexture = () => null;
    if (failure === "wait") h.gl.clientWaitSync = () => h.gl.WAIT_FAILED;
    if (failure === "upload") h.gl.texImage2D = () => { throw new Error("upload throws"); };
    if (failure === "unsupported") h.canvas.getContext = () => null;
    const kernel = createCanvasGpuSubmissionKernel(h.options);
    await assert.rejects(kernel.consume(h.bitmap, { ...h.input, ...(failure === "size" ? { width: 21 } : {}), isCancelled: () => cancelled }));
    assert.equal(h.events.at(-1), "bitmap-close");
    assert.equal(h.events.filter(value => value === "bitmap-close").length, 1);
    kernel.dispose();
    if (["error", "fence", "texture", "wait", "upload", "cancel"].includes(failure)) {
      assert.ok(h.events.includes("lose-context")); assert.equal(h.canvas.width, 0);
    }
  }
});

test("Worker has no queue and cancellation is acknowledged only after kernel cleanup", async () => {
  const messages = []; let release, cancelled, closed = false;
  const kernel = { consume: async (_bitmap, options) => {
    cancelled = options.isCancelled;
    try { await new Promise(resolve => { release = resolve; }); return { width: 20, height: 10 }; }
    finally { closed = true; }
  } };
  const runtime = createCanvasGpuSubmissionWorkerRuntime({ kernel, postMessage: value => {
    if (value.type === "CANVAS_GPU_CANCELLED") assert.equal(closed, true);
    messages.push(value);
  } });
  const pending = runtime.receive({ type: "CONSUME_CANVAS_BITMAP", taskId: "a", bitmap: {}, width: 20, height: 10 });
  let busyClosed = false;
  runtime.receive({ type: "CONSUME_CANVAS_BITMAP", taskId: "b", bitmap: { close() { busyClosed = true; } } });
  assert.equal(busyClosed, true); assert.equal(messages[0].type, "ERROR");
  runtime.receive({ type: "CANCEL_TASK", taskId: "other" }); assert.equal(cancelled(), false);
  runtime.receive({ type: "CANCEL_TASK", taskId: "a" }); assert.equal(cancelled(), true);
  assert.equal(runtime.getPendingTaskCount(), 1); assert.equal(messages.length, 1);
  release(); await pending;
  assert.equal(runtime.getPendingTaskCount(), 0); assert.equal(messages.at(-1).type, "CANVAS_GPU_CANCELLED");
});

test("Worker forwards successful stats and named errors after cleanup, rejecting unknown messages", async () => {
  for (const fail of [false, true]) {
    const h = harness(), messages = [];
    if (fail) h.gl.getError = () => 1285;
    const runtime = createCanvasGpuSubmissionWorkerRuntime({ kernel: h.kernel, postMessage: message => {
      assert.equal(h.events.at(-1), "bitmap-close"); messages.push(message);
    } });
    await runtime.receive({ type: "CONSUME_CANVAS_BITMAP", taskId: "a", bitmap: h.bitmap, ...h.input });
    assert.equal(messages[0].type, fail ? "ERROR" : "CANVAS_GPU_RESULT");
    if (fail) assert.match(messages[0].message, /1285/);
  }
});

test("separate runners borrow one worker and GL context while each candidate releases its own bitmap, texture and fence", async () => {
  const h = harness(); let clock = 0, contextCreations = 0, workerCreations = 0, terminations = 0, receiverCloses = 0;
  const kernel = createCanvasGpuSubmissionKernel({ ...h.options, now: () => clock,
    createGpuCanvas: () => { contextCreations++; clock += 486; return h.canvas; } });
  h.gl.texImage2D = (...args) => { assert.ok(args.at(-1).width > 0); h.events.push("upload"); };
  let runtime;
  const worker = {
    postMessage(message) {
      let bitmap;
      if (message.bitmap) {
        bitmap = { width: message.bitmap.width, height: message.bitmap.height, close() { receiverCloses++; } };
        message.bitmap.width = 0; message.bitmap.height = 0;
      }
      queueMicrotask(() => { void runtime.receive({ ...message, ...(bitmap ? { bitmap } : {}) }); });
    },
    terminate() { assert.equal(h.events.at(-1), "lose-context"); terminations++; },
  };
  runtime = createCanvasGpuSubmissionWorkerRuntime({ kernel, postMessage: data => queueMicrotask(() => worker.onmessage({ data })) });
  const consumer = createCanvasGpuSubmissionClient({ isSupported: () => true,
    createWorker: () => { workerCreations++; return worker; } });
  const context = { reset() {}, fill() {} };
  const canvas = { width: 20, height: 10, getContext() { return context; } }; context.canvas = canvas;
  const options = { canvas, gpuConsumer: consumer, now: () => clock, yieldTask: async () => {},
    createBitmap: async source => ({ width: source.width, height: source.height, close() {} }), draw: value => value.fill({}) };
  const first = await runCanvasDrawBatches(options);
  assert.equal(first.canvas, canvas); assert.equal(first.stats.workerContextInitMs, 486);
  assert.equal(first.stats.workerContextCreationCount, 1); assert.equal(first.stats.workerContextReuseCount, 0);
  canvas.width = 30;
  const second = await runCanvasDrawBatches(options);
  assert.equal(second.stats.workerContextInitMs, 0);
  assert.equal(second.stats.workerContextCreationCount, 0); assert.equal(second.stats.workerContextReuseCount, 1);
  assert.equal(second.stats.gpuTextureBytes, 30 * 10 * 4);
  assert.equal(workerCreations, 1); assert.equal(contextCreations, 1); assert.equal(terminations, 0);
  assert.equal(receiverCloses, 2); assert.equal(h.events.filter(value => value === "delete-texture").length, 2);
  assert.equal(h.events.filter(value => value === "delete-fence").length, 2);
  assert.equal(h.events.includes("lose-context"), false);
  await consumer.dispose(); assert.equal(terminations, 1); assert.equal(h.canvas.width, 0);
});

test("session disposal has a cleanup acknowledgement, rejects busy work and leaves no reusable context", async () => {
  const messages = []; let release, disposed = false;
  const kernel = { dispose: async () => { await new Promise(resolve => { release = resolve; }); disposed = true; } };
  const runtime = createCanvasGpuSubmissionWorkerRuntime({ kernel, postMessage: value => {
    if (value.type === "CANVAS_GPU_DISPOSED") assert.equal(disposed, true);
    messages.push(value);
  } });
  const pending = runtime.receive({ type: "DISPOSE_CANVAS_GPU_SESSION", taskId: "dispose" });
  assert.equal(messages.length, 0); assert.equal(runtime.getPendingTaskCount(), 1);
  let closed = 0;
  runtime.receive({ type: "CONSUME_CANVAS_BITMAP", taskId: "busy", bitmap: { close() { closed++; } } });
  assert.equal(closed, 1); assert.equal(messages.at(-1).type, "ERROR");
  release(); await pending; assert.equal(messages.at(-1).type, "CANVAS_GPU_DISPOSED");
  runtime.receive({ type: "CONSUME_CANVAS_BITMAP", taskId: "late", bitmap: { close() { closed++; } } });
  assert.equal(closed, 2); assert.match(messages.at(-1).message, /disposed/);
});

test("a cancelled candidate releases its resources and the next candidate reuses the same GL context", async () => {
  const h = harness(); let cancelled = false, cancelFirst = true, creations = 0;
  const kernel = createCanvasGpuSubmissionKernel({ ...h.options,
    createGpuCanvas: () => { creations++; return h.canvas; },
    yieldTask: async () => { if (cancelFirst) cancelled = true; },
  });
  await assert.rejects(kernel.consume(h.bitmap, { ...h.input, isCancelled: () => cancelled }), { name: "AbortError" });
  assert.deepEqual(h.events.slice(-3), ["delete-fence", "delete-texture", "bitmap-close"]);
  assert.equal(h.events.includes("lose-context"), false);
  cancelled = false; cancelFirst = false;
  const stats = await kernel.consume(h.bitmap, { ...h.input, isCancelled: () => cancelled });
  assert.equal(creations, 1); assert.equal(stats.workerContextCreationCount, 0); assert.equal(stats.workerContextReuseCount, 1);
  kernel.dispose(); assert.equal(h.events.at(-1), "lose-context");
});

test("a context lost after its fence is released before the error acknowledgement and the same worker accepts a rebuilt context", async () => {
  const first = harness(), second = harness(); let creations = 0, lost = false;
  const originalPoll = first.gl.clientWaitSync;
  first.gl.isContextLost = () => lost;
  first.gl.clientWaitSync = function(...args) {
    const status = originalPoll.apply(this, args);
    if (status === this.CONDITION_SATISFIED) lost = true;
    return status;
  };
  const kernel = createCanvasGpuSubmissionKernel({ ...first.options,
    createGpuCanvas: () => (++creations === 1 ? first.canvas : second.canvas) });
  const messages = [];
  const runtime = createCanvasGpuSubmissionWorkerRuntime({ kernel, postMessage: message => {
    if (message.type === "ERROR") {
      assert.deepEqual(first.events.slice(-4), ["delete-fence", "delete-texture", "lose-context", "bitmap-close"]);
      assert.equal(first.canvas.width, 0); assert.equal(first.canvas.height, 0);
    }
    messages.push(message);
  } });
  await runtime.receive({ type: "CONSUME_CANVAS_BITMAP", taskId: "lost", bitmap: first.bitmap, ...first.input });
  assert.equal(messages[0].type, "ERROR"); assert.match(messages[0].message, /context was lost/);
  assert.equal(runtime.getPendingTaskCount(), 0);
  await runtime.receive({ type: "CONSUME_CANVAS_BITMAP", taskId: "recovered", bitmap: second.bitmap, ...second.input });
  assert.equal(messages[1].type, "CANVAS_GPU_RESULT"); assert.equal(creations, 2);
  assert.equal(messages[1].stats.workerContextCreationCount, 1);
  assert.equal(messages[1].stats.workerContextReuseCount, 0);
  assert.equal(second.events.includes("lose-context"), false);
  await runtime.receive({ type: "DISPOSE_CANVAS_GPU_SESSION", taskId: "dispose" });
  assert.equal(messages.at(-1).type, "CANVAS_GPU_DISPOSED"); assert.equal(second.canvas.width, 0);
});

test("non-abort upload errors and simultaneous cancellation/context loss also discard the broken context", async () => {
  for (const failure of ["upload-error", "cancel-and-loss"]) {
    const first = harness(), second = harness(); let creations = 0, cancelled = false, lost = false;
    first.gl.isContextLost = () => lost;
    if (failure === "upload-error") first.gl.getError = () => 1285;
    const kernel = createCanvasGpuSubmissionKernel({ ...first.options,
      createGpuCanvas: () => (++creations === 1 ? first.canvas : second.canvas),
      yieldTask: async () => { if (failure === "cancel-and-loss" && creations === 1) { cancelled = true; lost = true; } },
    });
    await assert.rejects(kernel.consume(first.bitmap, { ...first.input, isCancelled: () => cancelled }),
      failure === "upload-error" ? /1285/ : { name: "AbortError" });
    assert.equal(first.canvas.width, 0); assert.equal(first.events.at(-1), "bitmap-close");
    cancelled = false;
    const result = await kernel.consume(second.bitmap, second.input);
    assert.equal(creations, 2); assert.equal(result.workerContextCreationCount, 1);
    kernel.dispose();
  }
});
