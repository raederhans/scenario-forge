import { createCanvasGpuSubmissionClient } from "../canvas_gpu_submission_client.js";
import { yieldToBackground } from "../background_yield.js";

// Private physical-pass candidates only. Cached Path2D inputs must remain
// immutable until replay completes; pixel reads and mutable paint factories are
// deliberately unsupported during capture.
const STATE_AND_PATH_METHODS = new Set([
  "save", "restore", "resetTransform", "setTransform", "transform", "translate", "scale", "rotate",
  "beginPath", "closePath", "moveTo", "lineTo", "quadraticCurveTo", "bezierCurveTo",
  "arc", "arcTo", "ellipse", "rect", "clip", "setLineDash",
]);
const PAINT_METHODS = new Set(["fill", "stroke", "fillRect", "strokeRect", "clearRect"]);
const QUERY_METHODS = new Set([
  "getTransform", "getLineDash", "measureText", "getContextAttributes", "isPointInPath", "isPointInStroke", "isContextLost",
]);
const defaultYield = yieldToBackground;

function captureArguments(method, args) {
  if (method === "setLineDash") return [Array.from(args[0])];
  return args;
}

export async function runCanvasDrawBatches({
  canvas, draw, batchSize = 64, signal, isCurrent = () => true,
  getPaintWork = () => 1, maxBatchWork = batchSize,
  yieldTask = defaultYield,
  now = () => globalThis.performance.now(),
  createBitmap = source => createImageBitmap(source),
  createGpuConsumer = createCanvasGpuSubmissionClient,
  gpuConsumer = null,
} = {}) {
  const totalStartedAt = now();
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || typeof draw !== "function") {
    throw new TypeError("Canvas draw batches require a synchronous draw callback and a positive batch size.");
  }
  if (typeof getPaintWork !== "function" || !Number.isFinite(maxBatchWork) || maxBatchWork <= 0) {
    throw new TypeError("Canvas draw batches require a paint work function and a positive finite work limit.");
  }
  const context = canvas?.getContext("2d");
  if (!context || typeof context.reset !== "function" || !(canvas.width > 0) || !(canvas.height > 0)) {
    throw new TypeError("Canvas draw batches require a private, nonempty, resettable 2D canvas.");
  }
  const commands = [];
  const stats = { width: canvas.width, height: canvas.height, commandCount: 0, paintCount: 0, batchCount: 0,
    totalMs: 0, captureMs: 0, replayMs: 0, uploadMs: 0, waitMs: 0, yieldWallMs: 0,
    errorCheckMs: 0, fenceMs: 0, flushMs: 0, cleanupMs: 0,
    maxBatchMs: 0, maxUploadMs: 0, maxWaitMs: 0, gpuTextureBytes: canvas.width * canvas.height * 4,
    bitmapBytes: canvas.width * canvas.height * 4, bitmapSnapshotCallMs: 0, bitmapSnapshotWaitMs: 0,
    workerContextInitMs: 0, workerTextureSetupMs: 0, workerContextCreationCount: 0, workerContextReuseCount: 0,
    workerUploadMs: 0, workerFenceMs: 0, workerFlushMs: 0, workerFenceWaitMs: 0,
    workerErrorCheckMs: 0, workerCleanupMs: 0, workerTotalMs: 0, workerRoundTripMs: 0 };
  let consumer = gpuConsumer;
  function checkCancelled() {
    if (signal?.aborted) throw new DOMException("Stale canvas draw candidate", "AbortError");
  }
  function checkCurrent() {
    checkCancelled();
    if (!isCurrent()) throw new DOMException("Stale canvas draw candidate", "AbortError");
    if (canvas.width !== stats.width || canvas.height !== stats.height) throw new Error("Canvas draw candidate was resized.");
  }
  async function yieldToHost(yieldCallback = yieldTask) {
    const startedAt = now();
    await yieldCallback();
    stats.yieldWallMs += now() - startedAt;
    checkCurrent();
  }
  try {
    checkCurrent();
    // The caller may enter withRenderTarget only inside this synchronous draw.
    // No global renderer target remains installed across any await below.
    await yieldToHost();
    context.reset();
    let captureOpen = true;
    const recording = Proxy.revocable(context, {
      get(target, key) {
        const value = Reflect.get(target, key, target);
        if (typeof value !== "function") return value;
        if (QUERY_METHODS.has(key)) return value.bind(target);
        if (!STATE_AND_PATH_METHODS.has(key) && !PAINT_METHODS.has(key)) {
          throw new TypeError(`Unsupported physical canvas capture method: ${String(key)}`);
        }
        return (...args) => {
          if (!captureOpen) throw new TypeError("Canvas capture has ended.");
          checkCancelled();
          let captured = captureArguments(key, args), result;
          if (!PAINT_METHODS.has(key)) {
            // Validate matrix aliases using the original native dictionary, then
            // freeze its resulting affine value against later caller mutation.
            result = value.apply(target, key === "setTransform" ? args : captured);
            if (key === "setTransform" && args.length === 1) {
              const { a, b, c, d, e, f } = target.getTransform();
              captured = [{ a, b, c, d, e, f }];
            }
          }
          commands.push({ method: key, args: captured, paint: PAINT_METHODS.has(key) });
          // Native state/path behavior supplies validated getters during capture.
          // Paint itself is deferred until the whole callback has returned.
          return result;
        };
      },
      set(target, key, value) {
        checkCancelled();
        const result = Reflect.set(target, key, value, target);
        if (result) commands.push({ property: key, value });
        return result;
      },
    });
    const captureStartedAt = now();
    let result;
    try { result = draw(recording.proxy); }
    finally { captureOpen = false; recording.revoke(); }
    if (result && typeof result.then === "function") {
      Promise.resolve(result).catch(() => {});
      throw new TypeError("Canvas capture draw must be synchronous.");
    }
    stats.captureMs = now() - captureStartedAt;
    stats.commandCount = commands.length;
    checkCurrent();
    context.reset();

    async function submitBatch(batchStartedAt) {
      checkCurrent();
      let bitmap = null;
      try {
        let phaseStartedAt = now();
        const snapshot = createBitmap(canvas);
        stats.bitmapSnapshotCallMs += now() - phaseStartedAt;
        phaseStartedAt = now();
        bitmap = await snapshot;
        stats.bitmapSnapshotWaitMs += now() - phaseStartedAt;
        checkCurrent();
        consumer ||= createGpuConsumer();
        phaseStartedAt = now();
        const completion = consumer.consume(bitmap, { signal, width: stats.width, height: stats.height });
        bitmap = null; // The consumer owns closure even if transfer or Worker startup fails.
        const workerStats = await completion;
        const roundTripMs = now() - phaseStartedAt;
        stats.workerRoundTripMs += roundTripMs;
        stats.waitMs += roundTripMs; stats.maxWaitMs = Math.max(stats.maxWaitMs, roundTripMs);
        for (const name of ["workerContextInitMs", "workerTextureSetupMs", "workerContextCreationCount", "workerContextReuseCount",
          "workerUploadMs", "workerFenceMs", "workerFlushMs", "workerFenceWaitMs",
          "workerErrorCheckMs", "workerCleanupMs", "workerTotalMs"]) {
          if (!Number.isFinite(workerStats?.[name]) || workerStats[name] < 0) {
            throw new Error("Invalid canvas GPU submission timing acknowledgement.");
          }
          stats[name] += workerStats[name];
        }
        checkCurrent();
        stats.batchCount += 1;
        stats.maxBatchMs = Math.max(stats.maxBatchMs, now() - batchStartedAt);
      } finally { bitmap?.close?.(); }
    }
    let paints = 0, batchWork = 0, batchStartedAt = now(), replayStartedAt = batchStartedAt;
    async function flushBatch() {
      stats.replayMs += now() - replayStartedAt;
      await submitBatch(batchStartedAt);
      paints = 0; batchWork = 0; batchStartedAt = now(); replayStartedAt = batchStartedAt;
    }
    for (const command of commands) {
      checkCancelled();
      const contributesWork = command.paint && command.method !== "clearRect";
      const work = contributesWork ? getPaintWork(command) : 0;
      if (!Number.isFinite(work) || work < 0) {
        throw new TypeError("Canvas paint work must be a nonnegative finite number.");
      }
      // Preserve native commands and state. A large paint is isolated by
      // consumption boundaries only; it is never clipped or subdivided.
      if (contributesWork && work >= maxBatchWork && paints) await flushBatch();
      if (command.method) context[command.method](...command.args);
      else context[command.property] = command.value;
      if (!command.paint) continue;
      stats.paintCount += 1;
      // Clearing keeps its exact position but does not independently consume a
      // GPU batch. Zero-work visible paints still require a final submission.
      if (!contributesWork) continue;
      paints++; batchWork += work;
      if (batchWork >= maxBatchWork) await flushBatch();
    }
    stats.replayMs += now() - replayStartedAt;
    if (paints) await submitBatch(batchStartedAt);
    checkCurrent();
    return { canvas, stats };
  } finally {
    const cleanupStartedAt = now();
    commands.length = 0;
    // An explicit consumer is borrowed from the renderer's persistent owner.
    // That owner cancels/drains active work and disposes only at session exit.
    if (!gpuConsumer) await consumer?.dispose();
    stats.cleanupMs += now() - cleanupStartedAt;
    stats.totalMs = now() - totalStartedAt;
  }
}
