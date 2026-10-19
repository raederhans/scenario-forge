import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { openRasterApp, waitRasterStartup } from "./political_id_raster_app_session.mjs";
import { brushHistory } from "./verify_political_id_raster_integration.mjs";
import { residentFrameReady } from "./verify_political_raster_resident.mjs";
import { nativeBreadcrumbInitScript, startNativeBreadcrumbCollector } from "./tno_native_breadcrumbs.mjs";

const require = createRequire(import.meta.url);
const { beginProjectImportWatch, waitForProjectImportCompletion } = require("../tests/e2e/support/playwright-app.js");
const SCENARIO = "tno_1962";
const VIEWPORT = { width: 1280, height: 900 };
const reportIo = new WeakMap(), pageReports = new WeakMap();
const IO_BOUND_MS = 10000, CLEANUP_BOUND_MS = 5000, ACTION_BOUND_MS = 120000, TRACE_BOUND_MS = 30000;

export async function withDeadline(action, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms watchdog`)), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

export async function preserveActionError(action, cleanup, onCleanupError = () => {}) {
  let result, failure;
  try { result = await action(); } catch (error) { failure = error; }
  try { await cleanup(); } catch (error) { onCleanupError(error); if (!failure) failure = error; }
  if (failure) throw failure;
  return result;
}

// Playwright's renderer-side timeout may itself stop replying during a freeze.
// Keep the same timeout on Node, and release every returned (even late) handle.
export async function waitForPageCondition(page, predicate, arg, { timeout, label }, read = null) {
  let abandoned = false;
  const dispose = handle => withDeadline(() => handle.dispose(), CLEANUP_BOUND_MS, `${label} handle dispose`);
  const pending = Promise.resolve().then(() => page.waitForFunction(predicate, arg, { timeout }));
  pending.then(handle => {
    if (abandoned) void dispose(handle).catch(error => recordCleanupError(page, error));
  }, () => {});
  let handle;
  try { handle = await withDeadline(() => pending, timeout, label); }
  catch (error) { abandoned = true; throw error; }
  return preserveActionError(
    () => read ? withDeadline(() => read(handle), IO_BOUND_MS, `${label} result`) : undefined,
    () => dispose(handle), error => recordCleanupError(page, error));
}

export function installDiagnosticWorkerPosts() {
  const scope = globalThis;
  if (scope.__tnoWorkerPostDiagnostics || typeof scope.Worker !== "function") return;
  const original = scope.Worker.prototype.postMessage, limit = 1024;
  const evidence = scope.__tnoWorkerPostDiagnostics = { count: 0, limit, records: [] };
  scope.Worker.prototype.postMessage = function (...args) {
    let startedAt, sequence, label, mark;
    try {
      sequence = evidence.count++;
      startedAt = performance.now();
      const type = String(args[0]?.type || "unknown").slice(0, 80);
      const taskId = String(args[0]?.taskId || "").slice(0, 80);
      label = `tno-worker-post:${sequence}:${type}:${taskId}`;
      mark = `${label}:start`;
      evidence.records[sequence % limit] = { sequence, type, taskId, startedAt, durationMs: null };
      performance.mark(mark);
    } catch { /* Observation must not alter native posting or its exceptions. */ }
    try { return Reflect.apply(original, this, args); }
    finally {
      try {
        const record = evidence.records[sequence % limit];
        if (record?.sequence === sequence) record.durationMs = performance.now() - startedAt;
        // The start mark identifies a native call that never returns. Browser
        // tracing retains it even when page.evaluate cannot retrieve records.
        if (mark) {
          performance.measure(label, mark);
          performance.clearMarks(mark);
          performance.clearMeasures(label);
        }
      } catch { /* Preserve native success, return values and thrown errors. */ }
    }
  };
}

// Diagnostic runs perturb execution. Browser-target tracing remains independent
// of renderer commands so an unresponsive page cannot prevent trace retrieval.
export async function startDiagnosticTrace(session, { output, prefix, report,
  timeoutMs = CLEANUP_BOUND_MS, traceTimeoutMs = TRACE_BOUND_MS, traceOnly = false, trigger = "startup", files = fs } = {}) {
  const evidence = report.diagnosticTrace = { enabled: true, performanceBaselineEligible: false,
    trigger, startedAt: new Date().toISOString(),
    coverageWindow: trigger === "failure"
      ? "Failure-triggered capture covers only activity after the failure watchdog; it does not contain the history that caused the failure."
      : "Capture starts after the browser session opens.",
    mode: traceOnly ? "trace-only" : "trace-and-cpu-profile",
    accounting: "Diagnostic tracing/debugging changes execution; timings are not performance baseline evidence.",
    errors: [], paused: [], traceComplete: false, cpuProfileComplete: false,
    watchdogs: { commandMs: timeoutMs, traceMs: traceTimeoutMs } };
  let browserCdp, pageCdp, tracing = false, profiling = false, debuggerEnableRequested = false;
  let finishing = false, completion, onFailurePause, pagePaused = false;
  const recordError = (operation, error) => evidence.errors.push({ operation, stage: report.stage,
    error: String(error?.stack || error) });
  const bounded = (operation, action, limit = timeoutMs) => withDeadline(action, limit, `diagnostic ${operation}`);
  async function acquire(operation, factory) {
    let abandoned = false;
    const pending = Promise.resolve().then(factory);
    pending.then(cdp => {
      if (abandoned) void bounded(`${operation} late detach`, () => cdp.detach()).catch(error => recordError(operation, error));
    }, () => {});
    try { return await bounded(operation, () => pending); }
    catch (error) { abandoned = true; throw error; }
  }
  const onPaused = event => {
    pagePaused = true;
    evidence.paused.push({ at: new Date().toISOString(), stage: report.stage, reason: event.reason,
      callFrames: (event.callFrames || []).map(frame => ({ functionName: frame.functionName, url: frame.url,
        location: frame.location, functionLocation: frame.functionLocation })) });
    onFailurePause?.();
    // A debugger statement encountered during normal execution must not leave
    // this opt-in observer blocking the page. Failure capture resumes in finally.
    if (!finishing) void bounded("Debugger.resume", () => pageCdp.send("Debugger.resume"))
      .catch(error => recordError("Debugger.resume", error));
  };
  const onResumed = () => { pagePaused = false; };
  await Promise.all([
    (async () => {
      try {
        browserCdp = await acquire("browser CDP attach", () => session.browser.newBrowserCDPSession());
        // A timed-out acknowledgement can still have started tracing. Always
        // attempt browser-side end once start was sent to this owned browser.
        tracing = true;
        await bounded("Tracing.start", () => browserCdp.send("Tracing.start", {
          transferMode: "ReturnAsStream", streamFormat: "json", streamCompression: "none",
          traceConfig: { recordMode: "recordContinuously", traceBufferSizeInKb: 64 * 1024,
            includedCategories: ["devtools.timeline", "blink.user_timing", "gpu"] },
        }));
      } catch (error) { recordError("Tracing.start", error); }
    })(),
    (async () => {
      try {
        pageCdp = await acquire("page CDP attach", () => session.context.newCDPSession(session.page));
        pageCdp.on("Debugger.paused", onPaused);
        pageCdp.on("Debugger.resumed", onResumed);
        // A frozen renderer may process enable after its acknowledgement times
        // out. Queue the bounded failure pause even without that acknowledgement.
        debuggerEnableRequested = true;
        await bounded("Debugger.enable", () => pageCdp.send("Debugger.enable"));
        try {
          await bounded("Performance.enable", () => pageCdp.send("Performance.enable", { timeDomain: "timeTicks" }));
          const nodeBeforeMs = Date.now();
          const { metrics } = await bounded("Performance.getMetrics", () => pageCdp.send("Performance.getMetrics"));
          const nodeAfterMs = Date.now();
          const values = new Map((metrics || []).map(metric => [metric.name, metric.value]));
          const timestampSeconds = values.get("Timestamp"), navigationStartSeconds = values.get("NavigationStart");
          if (![timestampSeconds, navigationStartSeconds].every(Number.isFinite)) throw new Error("CDP clock anchor metrics unavailable");
          evidence.timeAnchor = { source: "CDP Performance timeTicks (seconds); CPU profile timestamps are microseconds; Node epoch is milliseconds",
            nodeBeforeMs, nodeAfterMs, timestampSeconds, navigationStartSeconds };
        } catch (error) { recordError("clock anchor", error); }
        if (traceOnly) return;
        await bounded("Profiler.enable", () => pageCdp.send("Profiler.enable"));
        await bounded("Profiler.setSamplingInterval", () => pageCdp.send("Profiler.setSamplingInterval", { interval: 1000 }));
        profiling = true;
        await bounded("Profiler.start", () => pageCdp.send("Profiler.start"));
      } catch (error) { recordError("page profiler start", error); }
    })(),
  ]);

  async function finishPage(failed) {
    if (!pageCdp) return;
    try {
      if (failed && debuggerEnableRequested) {
        const paused = new Promise(resolve => { onFailurePause = resolve; });
        try { await bounded("Debugger.pause", () => Promise.all([pageCdp.send("Debugger.pause"), paused])); }
        catch (error) { recordError("Debugger.pause", error); }
        finally { onFailurePause = null; }
      }
      if (profiling) {
        try {
          const result = await bounded("Profiler.stop", () => pageCdp.send("Profiler.stop"));
          if (!Array.isArray(result?.profile?.nodes)) throw new Error("Profiler.stop returned no CPU profile");
          const file = path.join(output, `${prefix}.cpuprofile`);
          await bounded("CPU profile write", () => files.writeFile(file, JSON.stringify(result.profile)));
          evidence.cpuProfile = file; evidence.cpuProfileComplete = true;
        } catch (error) { recordError("Profiler.stop", error); }
      }
    } finally {
      // Successful runs never pause, so do not issue a spurious resume command.
      // Detaching below also releases a pause arriving after our bounded wait.
      if (pagePaused) {
        try { await bounded("Debugger.resume", () => pageCdp.send("Debugger.resume")); }
        catch (error) { recordError("Debugger.resume", error); }
      }
      pageCdp.off("Debugger.paused", onPaused);
      pageCdp.off("Debugger.resumed", onResumed);
      try { await bounded("page CDP detach", () => pageCdp.detach()); }
      catch (error) { recordError("page CDP detach", error); }
    }
  }
  async function finishBrowser() {
    if (!browserCdp) return;
    let stream, file, onComplete;
    try {
      if (!tracing) return;
      const completed = new Promise(resolve => { onComplete = resolve; browserCdp.on("Tracing.tracingComplete", onComplete); });
      // Start ending on the browser target immediately, alongside page capture.
      await bounded("Tracing.end", () => browserCdp.send("Tracing.end"), traceTimeoutMs);
      const result = await bounded("Tracing.tracingComplete", () => completed, traceTimeoutMs);
      stream = result.stream;
      evidence.traceDataLossOccurred = !!result.dataLossOccurred;
      evidence.traceCoverage = (trigger === "failure" ? "POST-FAILURE WINDOW ONLY: " : "")
        + (result.dataLossOccurred ? "INCOMPLETE: trace data loss; missing events cannot exclude work" : "no-data-loss-reported");
      if (result.dataLossOccurred) report.diagnosticTraceIncomplete = true;
      if (!stream) throw new Error("Tracing completed without a JSON stream");
      evidence.trace = path.join(output, `${prefix}.trace.json`);
      file = await bounded("trace open", () => files.open(evidence.trace, "w"));
      let bytes = 0;
      // Bound the entire stream, not only individual reads: a non-EOF stream
      // cannot keep cleanup alive indefinitely. Partial bytes remain on disk.
      const deadline = Date.now() + traceTimeoutMs;
      for (;;) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error("diagnostic trace stream exceeded cleanup budget");
        const chunk = await bounded("IO.read", () => browserCdp.send("IO.read", { handle: stream, size: 1024 * 1024 }), Math.min(timeoutMs, remaining));
        const data = Buffer.from(chunk.data, chunk.base64Encoded ? "base64" : "utf8");
        await bounded("trace chunk write", () => file.writeFile(data), Math.max(1, Math.min(timeoutMs, deadline - Date.now())));
        bytes += data.length; evidence.traceBytes = bytes;
        if (chunk.eof) { evidence.traceComplete = true; break; }
      }
    } catch (error) { recordError("browser trace finish", error); }
    finally {
      if (onComplete) browserCdp.off("Tracing.tracingComplete", onComplete);
      await Promise.all([
        file && bounded("trace file close", () => file.close()).catch(error => recordError("trace file close", error)),
        stream && bounded("IO.close", () => browserCdp.send("IO.close", { handle: stream })).catch(error => recordError("IO.close", error)),
      ]);
      try { await bounded("browser CDP detach", () => browserCdp.detach()); }
      catch (error) { recordError("browser CDP detach", error); }
    }
  }
  return { finish({ failed = false } = {}) {
    if (completion) return completion;
    finishing = true;
    completion = (async () => {
      await Promise.all([finishPage(failed), finishBrowser()]);
      evidence.finishedAt = new Date().toISOString();
      try { await bounded("CDP evidence write", () => files.writeFile(path.join(output, `${prefix}.cdp.json`), JSON.stringify(evidence, null, 2))); }
      catch (error) { recordError("CDP evidence write", error); }
      return evidence;
    })();
    return completion;
  } };
}

async function checkpoint(report) {
  const io = reportIo.get(report);
  if (!io || io.timingActive) return;
  const body = JSON.stringify(report, null, 2) + "\n";
  io.queue = io.queue.catch(() => {}).then(() => withDeadline(() => fs.writeFile(io.file, body), CLEANUP_BOUND_MS, "report checkpoint"));
  try { await io.queue; } catch (error) { report.checkpointError = String(error?.stack || error); }
}

async function stage(report, name) {
  report.stage = name;
  console.log(JSON.stringify({ tnoSceneStage: name, phase: report.phase, dpr: report.dpr }));
  await checkpoint(report);
}

const evaluate = (page, fn, arg) => withDeadline(() => page.evaluate(fn, arg), IO_BOUND_MS, "page.evaluate");
const mouse = (page, action, ...args) => withDeadline(() => page.mouse[action](...args), IO_BOUND_MS, `mouse.${action}`);
const keyboard = (page, action, ...args) => withDeadline(() => page.keyboard[action](...args), IO_BOUND_MS, `keyboard.${action}`);
function recordCleanupError(page, error) {
  const report = pageReports.get(page);
  if (report) (report.cleanupErrors ||= []).push({ stage: report.stage, error: String(error?.stack || error) });
}

async function heapEvidence(page) {
  return evaluate(page, () => {
    const memory = performance.memory;
    return { at: performance.now(), source: "performance.memory; browser-reported estimate, not process RSS or OOM evidence",
      usedJSHeapSize: memory?.usedJSHeapSize ?? null, totalJSHeapSize: memory?.totalJSHeapSize ?? null,
      jsHeapSizeLimit: memory?.jsHeapSizeLimit ?? null, historyPast: window.__rasterTask.state.historyPast.length,
      historyFuture: window.__rasterTask.state.historyFuture.length };
  });
}

export function assertVisibleScene(snapshot) {
  assert.equal(snapshot.diagnostics.actualBackend, "raster", "raster backend must produce the visible frame");
  assert.equal(snapshot.diagnostics.scene?.active, true, "visible GPU scene must be active");
  assert.ok(snapshot.diagnostics.scene.frames > 0, "scene must have submitted a frame");
  assert.ok(snapshot.diagnostics.scene.textureUploads > 0, "scene must upload real source content");
  assert.ok(snapshot.diagnostics.scene.bytes > 0, "scene must own actual texture bytes");
  assert.equal(snapshot.canvas?.visible, true, "#map-scene-canvas must be visible");
  assert.ok(snapshot.canvas.width > 0 && snapshot.canvas.height > 0);
  assert.ok(snapshot.canvas.rect.width > 0 && snapshot.canvas.rect.height > 0);
}

export function assertRetainedScene(current, before) {
  assertVisibleScene(current);
  const scene = current.diagnostics.scene;
  assert.equal(scene.presentationState, "retained", "unfinished preparation must retain the published scene");
  assert.equal(scene.publishedEpoch, before.diagnostics.scene.publishedEpoch, "preparation must not publish a partial generation");
  assert.equal(scene.publications, before.diagnostics.scene.publications, "held preparation must keep the same complete publication");
  assert.ok(Number.isFinite(scene.publishedEpoch), "published generation identity is required");
  assert.ok(scene.frames > before.diagnostics.scene.frames, "retained scene must keep submitting frames");
  assert.ok(["x", "y", "k"].every(key => Math.abs(scene.view?.[key] - current.view[key]) < 1e-7),
    "retained scene must follow the actual camera");
  assert.ok(current.diagnostics.pending || current.diagnostics.refinementPending
    || current.diagnostics.waterPreparation?.pending || current.diagnostics.borderPreparation?.pending
    || current.diagnostics.scene?.physicalCanvas?.pending,
    "retained evidence must overlap unfinished preparation");
}

export function assertZoomFeedback(sample) {
  assert.ok(Number.isFinite(sample.inputToObservedFeedbackMs), "zoom must submit visible camera feedback");
  assert.ok(sample.inputToObservedFeedbackMs >= 0 && sample.inputToObservedFeedbackMs <= sample.inputToObservedReadyMs,
    "first feedback and final readiness must be separate ordered observations");
  assert.ok(Number.isFinite(sample.maxRafIntervalMs) && Number.isFinite(sample.maxLongTaskMs));
}

function matchingPixelRois(before, after) {
  for (const roi of [before, after]) {
    assert.ok(roi && Number.isInteger(roi.width) && Number.isInteger(roi.height) && roi.width > 0 && roi.height > 0, "pixel ROI is required");
    assert.equal(roi.rgba?.length, roi.width * roi.height * 4, "ROI must contain every RGBA channel");
    assert.ok(roi.rgba.every(value => Number.isInteger(value) && value >= 0 && value <= 255), "ROI channels must be bytes");
  }
  for (const key of ["x", "y", "width", "height"]) assert.equal(after[key], before[key], `ROI ${key} must stay fixed`);
}

export function assertRoiMovedTowardColor(before, after, color) {
  matchingPixelRois(before, after);
  assert.match(color, /^#[\da-f]{6}$/i);
  const target = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
  let changedPixels = 0, towardTargetPixels = 0, maxRgbDelta = 0, witness = null;
  for (let offset = 0; offset < before.rgba.length; offset += 4) {
    const base = before.rgba.slice(offset, offset + 3), painted = after.rgba.slice(offset, offset + 3);
    const direction = target.map((value, channel) => value - base[channel]);
    const delta = painted.map((value, channel) => value - base[channel]);
    const change = Math.max(...delta.map(Math.abs)); maxRgbDelta = Math.max(maxRgbDelta, change);
    if (change > 3) changedPixels++;
    const lengthSquared = direction.reduce((sum, value) => sum + value * value, 0);
    if (!lengthSquared) continue;
    const alpha = Math.max(0, Math.min(1, delta.reduce((sum, value, channel) => sum + value * direction[channel], 0) / lengthSquared));
    const residual = Math.max(...painted.map((value, channel) => Math.abs(value - (base[channel] + alpha * direction[channel]))));
    const improvement = Math.sqrt(lengthSquared) - Math.hypot(...painted.map((value, channel) => target[channel] - value));
    // A tiny antialiased polygon can change only one screenshot pixel. Require
    // a visible change that fits compositing the requested color over baseline,
    // rather than merely accepting any nonzero difference or a nearby color.
    if (change >= 8 && improvement >= 8 && residual <= 3) {
      towardTargetPixels++;
      witness ||= { pixel: offset / 4, alpha, change, improvement, residual };
    }
  }
  assert.ok(towardTargetPixels > 0, "local screenshot pixels must visibly move toward the requested color (change/improvement >=8, blend residual <=3)");
  return { changedPixels, towardTargetPixels, maxRgbDelta, witness };
}

export function assertRoiRestored(reference, current, label = "restored pixels") {
  matchingPixelRois(reference, current);
  let maxChannelDelta = 0;
  for (let channel = 0; channel < reference.rgba.length; channel++) {
    maxChannelDelta = Math.max(maxChannelDelta, Math.abs(reference.rgba[channel] - current.rgba[channel]));
  }
  assert.ok(maxChannelDelta <= 3, `${label} must return to its reference ROI within 3 channel values (observed ${maxChannelDelta})`);
  return { maxChannelDelta };
}

// Installed before worker construction. Let native postMessage perform its normal
// structured clone/transfer and let the real worker finish. Delay only delivery
// of matching replies to the owner, without altering packets or app state.
export function installRasterPreparationHold(scope = window) {
  const OriginalWorker = scope.Worker, prototype = OriginalWorker.prototype, original = prototype.postMessage;
  const tasks = new Map(), replies = new Map(), listeners = new Map();
  const types = new Set(["SYNC_POLITICAL_ID_GEOMETRY", "BUILD_POLITICAL_ID_TILE", "LOAD_POLITICAL_ID_ASSET",
    "SYNC_WATER_GEOMETRY", "BUILD_WATER_BITMAP"]);
  const fault = { active: false, intercepted: 0, cancelled: 0, released: 0,
    stats: () => ({ active: fault.active, intercepted: fault.intercepted, cancelled: fault.cancelled, released: fault.released,
      queued: replies.size, tasks: [...replies.keys()].map(id => tasks.get(id)?.type),
      inFlight: tasks.size, inFlightTypes: [...tasks.values()].map(task => task.type) }),
    arm() {
      if (fault.active || replies.size || tasks.size) throw Error("previous preparation hold must finish before rearming");
      fault.intercepted = 0; fault.cancelled = 0; fault.released = 0; fault.active = true;
    },
    release() {
      fault.active = false;
      const pending = [...replies.values()]; replies.clear();
      fault.released += pending.length;
      for (const { worker, data } of pending) worker.dispatchEvent(new scope.MessageEvent("message", { data }));
    },
    dispose() {
      fault.release();
      if (prototype.postMessage === interceptedPostMessage) prototype.postMessage = original;
      if (scope.Worker === InterceptedWorker) scope.Worker = OriginalWorker;
      for (const [worker, listener] of listeners) worker.removeEventListener("message", listener);
      tasks.clear(); listeners.clear();
    } };
  const InterceptedWorker = new Proxy(OriginalWorker, {
    construct(target, args, newTarget) {
      const worker = Reflect.construct(target, args, newTarget);
      // Worker EventTarget listeners run in registration order. This must be
      // installed before createWorkerTaskClient assigns worker.onmessage.
      const listener = event => {
        if (!tasks.has(event.data?.taskId) || event.data.type === "ASSET_STATS") return;
        if (fault.active) {
          event.stopImmediatePropagation();
          replies.set(event.data.taskId, { worker, data: event.data }); fault.intercepted++;
        } else tasks.delete(event.data.taskId);
      };
      worker.addEventListener("message", listener); listeners.set(worker, listener);
      return worker;
    },
  });
  function interceptedPostMessage(message, ...args) {
    const id = message?.taskId;
    if (message?.type === "CANCEL_TASK") {
      if (tasks.delete(id)) fault.cancelled++;
      replies.get(id)?.data?.value?.bitmap?.close();
      replies.delete(id);
    } else if (fault.active && types.has(message?.type)) {
      tasks.set(id, { worker: this, type: message.type });
    }
    return original.call(this, message, ...args);
  }
  prototype.postMessage = interceptedPostMessage;
  scope.Worker = InterceptedWorker;
  scope.__tnoRasterPreparationHold = fault;
}

export function preparationHeldEvidence(scope = window) {
  const fault = scope.__tnoRasterPreparationHold.stats();
  return fault.active && fault.queued > 0 && fault.intercepted > 0 && fault.released === 0 ? fault : false;
}

export function fillCommitReady(expectedHistory, scope = window) {
  return scope.__rasterTask.state.historyPast.length === expectedHistory;
}

export function armReadyPreparationBaseline(scope = window) {
  const { state, renderer } = scope.__rasterTask;
  if (!scope.__tnoSceneResidentReady(state, renderer.getPoliticalIdRasterDiagnostics())) return false;
  // One synchronous browser task: no candidate can stage or publish between
  // the strict ready check, baseline capture and activation of the worker gate.
  const before = scope.__tnoCaptureSceneSnapshot();
  scope.__tnoRasterPreparationHold.arm();
  before.holdAtCapture = scope.__tnoRasterPreparationHold.stats();
  return before;
}

export function installZoomInputHoldBoundary(scope = window) {
  scope.__tnoZoomInputBoundary?.dispose();
  const boundary = { before: null, rejectedBefore: null, event: null, error: null,
    dispose() { scope.document.removeEventListener("keydown", onKeyDown, true); } };
  function onKeyDown(event) {
    if (event.key !== "Enter" || event.target?.id !== "zoomPercentInput") return;
    boundary.event = { type: event.type, key: event.key, timeStamp: event.timeStamp, targetId: event.target.id, value: event.target.value };
    try {
      boundary.before = scope.__tnoArmReadyPreparationBaseline(scope);
      if (!boundary.before) {
        boundary.rejectedBefore = scope.__tnoCaptureSceneSnapshot();
        boundary.error = "strict-ready baseline unavailable at the actual zoom Enter boundary";
      }
    } catch (error) { boundary.error = String(error?.stack || error); }
    finally { boundary.dispose(); }
  }
  scope.__tnoZoomInputBoundary = boundary;
  // The app commits on the input's bubbling keydown listener. Document capture
  // observes this actual input boundary before that commit, without suppressing
  // the event or assuming nothing changed since the preceding Playwright call.
  scope.document.addEventListener("keydown", onKeyDown, true);
}

export function captureRenderMetricDurations({ sinceEpoch = 0, untilEpoch = Infinity, metrics = window.__rasterTask.state.renderPerfMetrics } = {}) {
  // Last recorded entries only, read after the timing endpoint. This is bounded
  // attribution evidence, not a complete trace or additive CPU accounting.
  return Object.entries(metrics || {}).filter(([, metric]) => Number.isFinite(metric?.durationMs)
    && Number.isFinite(metric.recordedAt) && metric.recordedAt >= sinceEpoch && metric.recordedAt <= untilEpoch)
    .map(([name, metric]) => {
      const details = Object.fromEntries(Object.entries(metric).filter(([key, value]) => !["durationMs", "sequence", "recordedAt"].includes(key)
        && ((typeof value === "number" && Number.isFinite(value)) || typeof value === "boolean" || typeof value === "string")).slice(0, 32));
      return { name, durationMs: metric.durationMs, sequence: metric.sequence ?? null, recordedAt: metric.recordedAt,
        ...(Object.keys(details).length ? { details } : {}) };
    })
    .sort((a, b) => b.durationMs - a.durationMs || a.name.localeCompare(b.name))
    .filter((metric, index) => index < 10 || ["scenarioSecondaryRegionIndexesPreparation", "scenarioWaterRasterPreparation"].includes(metric.name));
}

export function summarizeSamples(values) {
  assert.ok(values.length > 0 && values.every(Number.isFinite), "finite timing samples required");
  const sorted = [...values].sort((a, b) => a - b), n = sorted.length;
  return { count: n, median: n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2,
    p95: sorted[Math.ceil(n * 0.95) - 1], max: sorted[n - 1] };
}

export function summarizeProfileBlock(block) {
  const values = (block.samples || []).map(s => s.inputToObservedReadyMs).filter(Number.isFinite);
  return { mode: block.mode, status: block.status, sampleCount: values.length,
    input: values.length ? summarizeSamples(values) : null,
    firstFillMs: block.firstPaint?.inputToObservedReadyMs ?? null,
    brushMs: block.brush?.sample?.inputToObservedReadyMs ?? null,
    brushSteps: block.brush?.pointerSteps ?? null, brushStage: block.brush?.stage ?? null };
}

export function summarizeQualityPixels({ roi, ...quality }) {
  return { ...quality, ...(roi ? { roi: { x: roi.x, y: roi.y, width: roi.width, height: roi.height } } : {}) };
}

export function summarizeZoomNavigation({ zoom, sample, renderMetrics, round, sequence, roundSequence, cacheOrder }) {
  return { zoom, ...(round === undefined ? {} : { round, sequence, roundSequence, cacheOrder }),
    inputToObservedFeedbackMs: sample?.inputToObservedFeedbackMs ?? null,
    inputToObservedReadyMs: sample?.inputToObservedReadyMs ?? null, maxRafIntervalMs: sample?.maxRafIntervalMs ?? null,
    maxLongTaskMs: sample?.maxLongTaskMs ?? null, renderMetrics: renderMetrics || [] };
}

export function fallbackSnapshotReady(current) {
  const g = current.settlement, d = current.diagnostics;
  if (d.scene?.active || d.scene?.failure !== "webgl-context-lost" || !["raster", "vector", "vector-partial"].includes(d.actualBackend)) return false;
  // A native safety fallback obeys native completion gates even though the
  // user's persistent policy still requests raster. Do not wait for a new scene.
  const observed = d.actualBackend.startsWith("vector") ? { ...d, effectiveMode: "vector" } : d;
  return residentFrameReady({ ...g, zoomTransform: current.view,
    runtimeChunkLoadState: g.chunks, renderPassCache: { dirty: g.dirty },
    renderPerfMetrics: { drawPoliticalBackgroundFillsPass: g.background } }, observed);
}

export function captureSceneSnapshot() {
    const { state: s, renderer } = window.__rasterTask;
    const c = document.querySelector("#map-scene-canvas"), r = c?.getBoundingClientRect(), style = c && getComputedStyle(c);
    return { diagnostics: { ...renderer.getPoliticalIdRasterDiagnostics(),
      countryLabels: renderer.getCountryLabelReadiness() }, scenario: s.activeScenarioId,
      view: { x: s.zoomTransform.x, y: s.zoomTransform.y, k: s.zoomTransform.k },
      overrides: { ...s.visualOverrides }, history: s.historyPast.length,
      interaction: { currentTool: s.currentTool, selectedColor: s.selectedColor, paintMode: s.paintMode,
        interactionGranularity: s.interactionGranularity, topologyBundleMode: s.topologyBundleMode,
        detailPromotionInFlight: !!s.detailPromotionInFlight, canPromoteDetail: typeof s.ensureDetailTopologyFn === "function",
        landFeatureCount: s.landData?.features?.length || 0, fullLandFeatureCount: s.landDataFull?.features?.length || 0,
        landIndexSize: s.landIndex?.size || 0, selectedInspectorCountryCode: s.selectedInspectorCountryCode || "",
        selectedHit: s.devSelectedHit ? { id: s.devSelectedHit.id, targetType: s.devSelectedHit.targetType,
          countryCode: s.devSelectedHit.countryCode, riverBlockedReason: s.devSelectedHit.riverBlockedReason } : null },
      politicalPatch: Object.fromEntries(["politicalPatchOverlayPaint", "politicalPatchOverlayDeferred",
        "politicalPatchOverlayClear", "fillPatchInputToFirstPixelMs"].map(name => {
        const metric = s.renderPerfMetrics?.[name];
        return [name, metric ? Object.fromEntries(["durationMs", "recordedAt", "sequence", "reason", "pendingReason",
          "inputLabel", "paintSource", "requestedFeatureCount", "candidateFeatureCount", "processedCount", "renderedCount",
          "deferred", "inputToFirstPixelMs", "pendingFeatureCount", "renderedIdCount", "colorRevision"]
          .filter(key => metric[key] !== undefined).map(key => [key, metric[key]])) : null];
      })),
      settlement: { bootPhase: s.bootPhase, startupReadonly: !!s.startupReadonly,
        startupReadonlyUnlockInFlight: !!s.startupReadonlyUnlockInFlight,
        currentTool: s.currentTool, brushModeEnabled: !!s.brushModeEnabled,
        historyPast: s.historyPast.length, historyFuture: s.historyFuture.length,
        scenarioApplyInFlight: !!s.scenarioApplyInFlight, renderPhase: s.renderPhase, isInteracting: !!s.isInteracting,
        secondarySpatialBuildPending: !!s.secondarySpatialBuildPending,
        deferExactAfterSettle: !!s.deferExactAfterSettle, exactAfterSettleHandle: !!s.exactAfterSettleHandle,
        activePostReadyTaskKey: s.activePostReadyTaskKey || "", dirty: { ...s.renderPassCache?.dirty },
        background: s.renderPerfMetrics?.drawPoliticalBackgroundFillsPass ? {
          progressive: !!s.renderPerfMetrics.drawPoliticalBackgroundFillsPass.progressive,
          deferredFullCacheReady: !!s.renderPerfMetrics.drawPoliticalBackgroundFillsPass.deferredFullCacheReady } : null,
        chunks: Object.fromEntries(["pendingReason", "refreshScheduled", "promotionScheduled", "pendingPromotion",
          "pendingInfraPromotion", "pendingVisualPromotion", "promotionCommitInFlight"]
          .map(key => [key, key === "pendingReason" ? String(s.runtimeChunkLoadState?.[key] || "") : !!s.runtimeChunkLoadState?.[key]])) },
      canvas: c ? { width: c.width, height: c.height, rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        visible: style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 } : null };
}

async function snapshot(page) {
  return evaluate(page, captureSceneSnapshot);
}

async function settle(page) {
  await waitForPageCondition(page, residentFrameReady, undefined, { timeout: 30000, label: "settlement" });
  const current = await snapshot(page);
  // Direct composition is TNO-specific. Other scenarios can legitimately use
  // the existing raster presenter when an explicit raster preference persists.
  if (current.scenario === SCENARIO && current.diagnostics.effectiveMode === "raster") assertVisibleScene(current);
  return current;
}

async function dismissGuide(page) {
  if (await page.locator("#scenarioGuidePopover").isVisible()) await page.locator("#scenarioGuideCloseBtn").click();
}

async function mode(page, value) {
  await dismissGuide(page);
  if (await evaluate(page, () => document.body.classList.contains("left-sidebar-collapsed"))) await page.locator("#leftSidebarCollapseBtn").click();
  await page.locator("#editorTaskLayersBtn").click();
  await page.locator("#appearanceTabBorders").click();
  await page.locator("#politicalRenderMode").evaluate(element => {
    for (let p = element.parentElement; p; p = p.parentElement) if (p.tagName === "DETAILS") p.open = true;
  });
  await page.locator("#politicalRenderMode").selectOption(value);
  const current = await settle(page);
  assert.equal(current.diagnostics.mode, value);
  assert.equal(current.diagnostics.actualBackend, value);
  if (value === "vector") assert.equal(current.diagnostics.scene?.active, false, "native mode must release visible raster presentation");
  return current;
}

async function paintPoint(page) {
  return evaluate(page, () => {
    const { state: s, renderer } = window.__rasterTask, xy = renderer.projectGeoToScreen(-110, 56);
    const rect = document.querySelector("#map-canvas").getBoundingClientRect();
    const point = { x: rect.left + xy[0] * rect.width / s.width, y: rect.top + xy[1] * rect.height / s.height };
    if (point.x <= rect.left || point.x >= rect.right || point.y <= rect.top || point.y >= rect.bottom) throw Error("paint target is outside viewport");
    return point;
  });
}

// Measurement intervals contain no screenshots, getImageData, GPU queries, or
// tracing screenshots. The endpoint is a state observation, not presentation.
async function measured(page, action, { feedbackZoom = null } = {}) {
  const report = pageReports.get(page), io = report && reportIo.get(report);
  if (report) await checkpoint(report);
  if (io) io.timingActive = true;
  try {
  await evaluate(page, feedbackZoom => {
    const p = window.__tnoSceneSample = { active: true, started: performance.now(), inputAt: null, frames: [], longTasks: [], previous: null,
      feedbackAt: null, initialSceneFrames: window.__rasterTask.renderer.getPoliticalIdRasterDiagnostics().scene?.frames || 0 };
    p.input = event => { p.inputAt ??= event.timeStamp; };
    for (const name of ["pointerdown", "keydown"]) document.addEventListener(name, p.input, true);
    p.tick = now => {
      if (p.inputAt !== null) {
        if (p.previous !== null) p.frames.push(now - p.previous); p.previous = now;
        if (feedbackZoom !== null && p.feedbackAt === null) {
          const { state, renderer } = window.__rasterTask, scene = renderer.getPoliticalIdRasterDiagnostics().scene;
          if (scene?.active && scene.frames > p.initialSceneFrames && Math.abs(state.zoomTransform.k - feedbackZoom / 100) < 1e-7
            && ["x", "y", "k"].every(key => Math.abs(scene.view?.[key] - state.zoomTransform[key]) < 1e-7)) {
            p.feedbackAt = performance.now();
          }
        }
      }
      p.raf = requestAnimationFrame(p.tick);
    };
    p.raf = requestAnimationFrame(p.tick);
    if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
      p.observer = new PerformanceObserver(list => p.longTasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration }))));
      p.observer.observe({ type: "longtask" });
    }
  }, feedbackZoom);
  return await preserveActionError(async () => {
    await withDeadline(action, ACTION_BOUND_MS, "measured input action");
    await settle(page);
    return await evaluate(page, () => {
      const p = window.__tnoSceneSample, end = performance.now();
      if (p.observer) p.longTasks.push(...p.observer.takeRecords().map(e => ({ start: e.startTime, duration: e.duration })));
      const longTasks = p.longTasks.filter(e => p.inputAt !== null && e.start + e.duration >= p.inputAt);
      return { elapsedMs: end - p.started, inputToObservedReadyMs: p.inputAt === null ? null : end - p.inputAt,
        inputAt: p.inputAt, inputEpochAt: p.inputAt === null ? null : performance.timeOrigin + p.inputAt, observedReadyAt: end,
        inputToObservedFeedbackMs: p.feedbackAt === null ? null : p.feedbackAt - p.inputAt,
        maxRafIntervalMs: Math.max(0, ...p.frames), maxLongTaskMs: Math.max(0, ...longTasks.map(e => e.duration)),
        frames: p.frames, longTasks,
        diagnostics: window.__rasterTask.renderer.getPoliticalIdRasterDiagnostics() };
    });
  }, () => withDeadline(() => page.evaluate(() => {
      const p = window.__tnoSceneSample;
      if (!p) return;
      cancelAnimationFrame(p.raf); p.observer?.disconnect();
      p.active = false;
      for (const name of ["pointerdown", "keydown"]) document.removeEventListener(name, p.input, true);
    }), CLEANUP_BOUND_MS, "measurement cleanup"), error => recordCleanupError(page, error));
  } finally {
    if (io) io.timingActive = false;
    if (report) await checkpoint(report);
  }
}

async function fill(page, color, { timed = false, expectedId } = {}) {
  await page.locator("#customColor").fill(color);
  const point = await paintPoint(page), before = await snapshot(page);
  await mouse(page, "move", point.x, point.y);
  const report = pageReports.get(page), expectedHistory = before.history + 1;
  if (report) report.lastFillAttempt = { color, point, expectedHistory, beforeInteraction: before.interaction,
    elementsAtPoint: await evaluate(page, point => document.elementsFromPoint(point.x, point.y).slice(0, 8)
      .map(element => ({ tag: element.tagName, id: element.id, className: element.getAttribute("class") })), point) };
  const click = async () => {
    await mouse(page, "click", point.x, point.y);
    // Click transactions may await detail hydration before changing history.
    // A previously settled frame is not completion evidence for this input.
    await waitForPageCondition(page, fillCommitReady, expectedHistory, { timeout: IO_BOUND_MS, label: "fill history commit" });
  };
  const timing = timed ? await measured(page, click) : (await click(), await settle(page), null);
  const after = await snapshot(page);
  const ids = Object.keys(after.overrides).filter(id => after.overrides[id] !== before.overrides[id]);
  assert.equal(ids.length, 1, "real fill must change exactly one canonical feature");
  assert.equal(after.overrides[ids[0]], color);
  if (expectedId) assert.equal(ids[0], expectedId, "repeated recolor must target the same feature");
  assert.equal(after.history, before.history + 1, "a fill must create one undo step");
  return { id: ids[0], color, point, timing, before, after };
}

async function zoom(page, value, timed = false) {
  await page.locator("#zoomPercentInput").fill(`${value}%`);
  const action = () => page.locator("#zoomPercentInput").press("Enter");
  const sample = timed ? await measured(page, action, { feedbackZoom: value }) : (await action(), null);
  const current = await settle(page);
  assert.ok(Math.abs(current.view.k - value / 100) < 1e-7, "real zoom input must reach requested transform");
  const renderMetrics = timed ? await evaluate(page, captureRenderMetricDurations, { sinceEpoch: sample.inputEpochAt,
    untilEpoch: sample.inputEpochAt - sample.inputAt + sample.observedReadyAt }) : undefined;
  const countryLabels = await evaluate(page, () => ({ readiness: window.__rasterTask.renderer.getCountryLabelReadiness(),
    counters: window.__rasterTask.state.renderPerfMetrics?.countryLabels }));
  return { zoom: value, sample, view: current.view, diagnostics: current.diagnostics, renderMetrics, countryLabels };
}

async function drag(page, { timed = false, reverse = false, delta } = {}) {
  const before = await snapshot(page), box = await page.locator("#mapContainer").boundingBox();
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }, dx = delta?.x ?? (reverse ? -100 : 100), dy = delta?.y ?? (reverse ? -45 : 45);
  const action = async () => {
    await keyboard(page, "down", "Shift");
    await preserveActionError(async () => {
      await mouse(page, "move", start.x, start.y); await mouse(page, "down");
      await mouse(page, "move", start.x + dx, start.y + dy, { steps: 16 }); await mouse(page, "up");
    }, () => keyboard(page, "up", "Shift"), error => recordCleanupError(page, error));
  };
  const sample = timed ? await measured(page, action) : (await action(), null);
  const after = await settle(page);
  assert.ok(Math.hypot(after.view.x - before.view.x, after.view.y - before.view.y) > Math.min(10, Math.hypot(dx, dy) / 2), "Shift drag must pan the actual view");
  assert.equal(after.view.k, before.view.k);
  assert.deepEqual(after.overrides, before.overrides, "pan must not paint");
  assert.equal(after.history, before.history, "pan must not create edit history");
  return { before: before.view, after: after.view, sample };
}

async function restoreEditBaseline(page, baseline) {
  while ((await snapshot(page)).history > baseline.history) {
    await page.locator("#undoBtn").click(); await settle(page);
  }
  assert.deepEqual((await snapshot(page)).overrides, baseline.overrides);
}

async function measuredBrush(page, baseline, trajectory, evidence = {}, progress = () => {}) {
  const step = async name => { evidence.stage = name; await progress(name); };
  await step("baseline");
  await restoreEditBaseline(page, baseline);
  await step("enter");
  await page.locator("#customColor").fill("#f0a322");
  await page.locator("#brushModeBtn").click();
  const before = await snapshot(page);
  const projected = await evaluate(page, () => {
    const { renderer } = window.__rasterTask, rect = document.querySelector("#mapContainer").getBoundingClientRect();
    return Array.from({ length: 41 }, (_, i) => {
      const xy = renderer.projectGeoToScreen(-124 + i * 0.85, 54 - i * 0.1);
      const point = { x: xy[0] + rect.left, y: xy[1] + rect.top };
      if (point.x <= rect.left || point.x >= rect.right || point.y <= rect.top || point.y >= rect.bottom) throw Error("brush point is outside viewport");
      return point;
    });
  });
  if (trajectory) assert.ok(projected.every((p, i) => Math.hypot(p.x - trajectory[i].x, p.y - trajectory[i].y) < 0.25), "paired brush views must project the same geographic trajectory");
  const points = trajectory || projected;
  Object.assign(evidence, { points, pointerSteps: points.length, view: before.view });
  // Color selection, baseline undo, tool selection and initial pointer move
  // precede timing. Only down -> 40 moves -> up -> ready is measured.
  await step("position"); await mouse(page, "move", points[0].x, points[0].y);
  await step("stroke");
  const sample = await measured(page, async () => {
    await mouse(page, "down");
    await preserveActionError(async () => {
      for (const p of points.slice(1)) await mouse(page, "move", p.x, p.y);
    }, () => mouse(page, "up"), error => recordCleanupError(page, error));
  });
  evidence.sample = sample;
  await step("stroke-complete");
  const after = await snapshot(page);
  assert.equal(after.history, before.history + 1, "one timed brush stroke must create exactly one undo step");
  assert.equal(await evaluate(page, () => window.__rasterTask.state.historyPast.at(-1)?.kind), "brush-fill");
  const paintedIds = Object.keys(after.overrides).filter(id => after.overrides[id] !== before.overrides[id]);
  assert.ok(paintedIds.length > 1, "41-point stroke must change several canonical regions");
  assert.ok(paintedIds.every(id => after.overrides[id] === "#f0a322"));
  Object.assign(evidence, { paintedIds, historyEntries: 1 });
  await step("undo");
  await page.locator("#undoBtn").click(); await settle(page);
  assert.deepEqual((await snapshot(page)).overrides, before.overrides);
  evidence.undo = true; await step("redo");
  await page.locator("#redoBtn").click(); await settle(page);
  assert.deepEqual((await snapshot(page)).overrides, after.overrides);
  evidence.redo = true; await step("restore-baseline");
  await restoreEditBaseline(page, baseline);
  await step("exit"); await page.locator("#brushModeBtn").click();
  await step("select-fill"); await page.locator("#toolFillBtn").click();
  await step("complete"); return evidence;
}

async function screenshotPixels(page, output, label, { color, point, reference = false, compare = false } = {}) {
  assert.equal(await evaluate(page, () => !!window.__tnoSceneSample?.active), false, "pixel checks must stay outside timed intervals");
  // Clear the real hover tooltip/outline before inspecting the filled feature.
  await mouse(page, "move", 5, 5);
  await evaluate(page, () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const box = await page.locator("#mapContainer").boundingBox();
  const target = color ? point || await paintPoint(page) : null;
  const bytes = await page.screenshot({ path: path.join(output, `${label}.png`), clip: box });
  return evaluate(page, async ({ encoded, color, reference, compare, label, box, target }) => {
    const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${encoded}`)).blob());
    const canvas = new OffscreenCanvas(image.width, image.height), ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0); image.close();
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height), rgb = color && [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
    let paintPixels = 0, targetPaintPixels = 0;
    const tx = target && (target.x - box.x) * pixels.width / box.width, ty = target && (target.y - box.y) * pixels.height / box.height;
    if (rgb) for (let i = 0; i < pixels.data.length; i += 4) if (pixels.data[i + 3] === 255 && rgb.every((v, c) => Math.abs(v - pixels.data[i + c]) <= 3)) {
      paintPixels++;
      if (Math.abs((i / 4) % pixels.width - tx) <= 6 && Math.abs(Math.floor(i / 4 / pixels.width) - ty) <= 6) targetPaintPixels++;
    }
    const result = { label, width: pixels.width, height: pixels.height, paintPixels, targetPaintPixels };
    if (target) {
      const x = Math.max(0, Math.floor(tx) - 6), y = Math.max(0, Math.floor(ty) - 6);
      const width = Math.min(13, canvas.width - x), height = Math.min(13, canvas.height - y);
      result.roi = { x, y, width, height, rgba: [...ctx.getImageData(x, y, width, height).data] };
    }
    if (compare) {
      const before = window.__tnoSceneScreenshotReference;
      if (!before || before.width !== pixels.width || before.height !== pixels.height) throw Error("screenshot dimensions changed");
      let changed = 0, maximum = 0, total = 0, above32 = 0;
      for (let i = 0; i < pixels.data.length; i += 4) {
        let delta = 0;
        for (let c = 0; c < 4; c++) delta = Math.max(delta, Math.abs(before.data[i + c] - pixels.data[i + c]));
        if (delta) changed++; if (delta > 32) above32++; total += delta; maximum = Math.max(maximum, delta);
      }
      result.difference = { changed, maximum, meanMax: total / (pixels.width * pixels.height), above32Ratio: above32 / (pixels.width * pixels.height) };
    }
    if (reference) window.__tnoSceneScreenshotReference = pixels;
    return result;
  }, { encoded: bytes.toString("base64"), color, reference, compare, label, box, target });
}

async function missingRetainedPixelDiagnostics(page, { id, color, point }) {
  return evaluate(page, async ({ id, color, point }) => {
    const [{ state: s }, renderer, { getFeatureId }] = await Promise.all([
      import(new URL("js/core/state.js", document.baseURI)),
      import(new URL("js/core/map_renderer.js", document.baseURI)),
      import(new URL("js/core/feature_identity.js", document.baseURI)),
    ]);
    const rectOf = element => {
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, left: r.left, top: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
    };
    const container = document.querySelector("#mapContainer"), containerRect = rectOf(container);
    const transform = { x: s.zoomTransform.x, y: s.zoomTransform.y, k: s.zoomTransform.k };
    const projected = renderer.projectGeoToScreen(...point.geo);
    const feature = s.landIndex?.get(id) || [s.landDataFull?.features, s.landData?.features]
      .flatMap(features => features || []).find(candidate => getFeatureId(candidate) === id);
    const result = { id, color, point, at: Date.now(), transform, dpr: s.dpr,
      container: { rect: containerRect, clientLeft: container.clientLeft, clientTop: container.clientTop,
        clientWidth: container.clientWidth, clientHeight: container.clientHeight, logicalWidth: s.width, logicalHeight: s.height },
      projection: { screen: projected, globalUsingContainerRect: [projected[0] + containerRect.left, projected[1] + containerRect.top],
        unzoomed: [(projected[0] - transform.x) / transform.k, (projected[1] - transform.y) / transform.k] },
      feature: { found: !!feature, source: s.landIndex?.get(id) === feature ? "landIndex" : "landDataFull/landData",
        featureId: feature && getFeatureId(feature), geometryType: feature?.geometry?.type },
      canvases: [...document.querySelectorAll("#mapContainer canvas, canvas[id^='map-']")].map(canvas => {
        const rect = rectOf(canvas), style = getComputedStyle(canvas);
        return { id: canvas.id, parentId: canvas.parentElement?.id, width: canvas.width, height: canvas.height, rect,
          style: { display: style.display, visibility: style.visibility, opacity: style.opacity, zIndex: style.zIndex,
            position: style.position, transform: style.transform, pointerEvents: style.pointerEvents },
          pointCss: [point.x - rect.left, point.y - rect.top],
          pointBacking: rect.width && rect.height ? [(point.x - rect.left) * canvas.width / rect.width,
            (point.y - rect.top) * canvas.height / rect.height] : null };
      }),
      elementsAtPoint: document.elementsFromPoint(point.x, point.y).slice(0, 12).map(element => ({ tag: element.tagName, id: element.id })) };
    try { result.feature.geoContains = feature ? globalThis.d3.geoContains(feature, point.geo) : null; }
    catch (error) { result.feature.geoContainsError = String(error); }
    const patch = document.querySelector("#map-political-patch-canvas");
    if (patch) try {
      const context = patch.getContext("2d"), rect = rectOf(patch);
      const x = Math.floor((point.x - rect.left) * patch.width / rect.width), y = Math.floor((point.y - rect.top) * patch.height / rect.height);
      const data = context.getImageData(0, 0, patch.width, patch.height).data;
      const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
      const target = { count: 0, bbox: null }, alpha = { count: 0, bbox: null };
      const include = (accumulator, px, py) => {
        accumulator.count++;
        if (!accumulator.bbox) accumulator.bbox = { minX: px, minY: py, maxX: px, maxY: py };
        else { const b = accumulator.bbox; b.minX = Math.min(b.minX, px); b.minY = Math.min(b.minY, py); b.maxX = Math.max(b.maxX, px); b.maxY = Math.max(b.maxY, py); }
      };
      let nearbyTargetPixels = 0, nearbyAlphaPixels = 0;
      for (let offset = 0; offset < data.length; offset += 4) {
        const px = (offset / 4) % patch.width, py = Math.floor(offset / 4 / patch.width);
        const near = Math.abs(px - x) <= 6 && Math.abs(py - y) <= 6;
        if (data[offset + 3] > 0) { include(alpha, px, py); if (near) nearbyAlphaPixels++; }
        if (data[offset + 3] === 255 && rgb.every((value, channel) => Math.abs(value - data[offset + channel]) <= 3)) {
          include(target, px, py); if (near) nearbyTargetPixels++;
        }
      }
      result.patchPixels = { pointBacking: [x, y], rgba: x >= 0 && y >= 0 && x < patch.width && y < patch.height
        ? [...data.slice((y * patch.width + x) * 4, (y * patch.width + x) * 4 + 4)] : null,
        target, alpha, nearbyTargetPixels, nearbyAlphaPixels };
    } catch (error) { result.patchPixelError = String(error); }
    return result;
  }, { id, color, point });
}

async function scenario(page, id) {
  await dismissGuide(page);
  const disclosure = page.locator("#editorProjectBar .editor-scenario-menu");
  if (!(await disclosure.evaluate(element => element.open))) await disclosure.locator("summary").click();
  await page.locator("#scenarioSelectButton").click();
  await page.locator(`#scenarioSelectMenu .scenario-select-option[data-value="${id}"]`).click();
  await page.locator("#applyScenarioBtn").click();
  await waitForPageCondition(page, id => window.__rasterTask.state.activeScenarioId === id && !window.__rasterTask.state.scenarioApplyInFlight,
    id, { timeout: 60000, label: "scenario application" });
  const current = await settle(page);
  if (await disclosure.evaluate(element => element.open)) await disclosure.locator("summary").click();
  return current;
}

async function roundtrip(page, output) {
  const before = await snapshot(page), file = path.join(output, "tno-scene.project.json");
  await page.locator("#editorProjectBar #inspectorSidebarTabProject").click();
  await page.locator("#downloadProjectBtn").evaluate(element => {
    for (let p = element.parentElement; p; p = p.parentElement) if (p.tagName === "DETAILS") p.open = true;
  });
  await page.locator("#projectDownloadDestination").selectOption("browser");
  const downloading = page.waitForEvent("download", { timeout: 30000 });
  await page.locator("#downloadProjectBtn").click();
  await (await downloading).saveAs(file);
  const saved = JSON.parse(await fs.readFile(file, "utf8"));
  assert.deepEqual(saved.visualOverrides, before.overrides, "saved project must contain actual edited canonical colors");
  const away = await scenario(page, "hoi4_1939");
  assert.deepEqual(away.overrides, {}, "scenario change must clear prior scenario edits");
  const watch = await beginProjectImportWatch(page, { expectedFileName: path.basename(file) });
  await page.locator("#projectFileInput").setInputFiles(file);
  await waitForProjectImportCompletion(page, watch, { timeout: 60000 });
  const after = await settle(page);
  assert.equal(after.scenario, SCENARIO); assert.deepEqual(after.overrides, before.overrides);
  return { savedFile: file, switchedTo: away.scenario, restoredScenario: after.scenario, overrides: after.overrides, diagnostics: after.diagnostics };
}

async function politicalExport(page, output, label, color, pixelRatio, records) {
  const result = await evaluate(page, ({ color, pixelRatio }) => {
    const { renderer, state: s } = window.__rasterTask;
    const before = { cache: s.renderPassCache, dpr: s.dpr, transform: { x: s.zoomTransform.x, y: s.zoomTransform.y, k: s.zoomTransform.k },
      overrides: JSON.stringify(s.visualOverrides) };
    const canvas = pixelRatio === null ? renderer.renderExportPassesToCanvas(["political"])
      : renderer.renderExportPassesToCanvas(["political"], { pixelRatio });
    if (!canvas) throw Error("political export returned no canvas");
    const target = renderer.projectGeoToScreen(-110, 56), scale = canvas.width / s.width;
    const x = Math.floor(target[0] * scale), y = Math.floor(target[1] * scale);
    const left = Math.max(0, x - 6), top = Math.max(0, y - 6);
    if (x < 0 || x >= canvas.width || y < 0 || y >= canvas.height) throw Error("export paint probe is outside output");
    const pixels = canvas.getContext("2d").getImageData(left, top, Math.min(13, canvas.width - left), Math.min(13, canvas.height - top)).data;
    const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
    let paintPixels = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] === 255 && rgb.every((v, c) => Math.abs(v - pixels[i + c]) <= 3)) paintPixels++;
    return { pixelRatio, width: canvas.width, height: canvas.height, paintPixels,
      expectedWidth: Math.round(s.width * (pixelRatio ?? before.dpr)), expectedHeight: Math.round(s.height * (pixelRatio ?? before.dpr)),
      restored: { cacheIdentity: before.cache === s.renderPassCache, dpr: before.dpr === s.dpr,
        transform: ["x", "y", "k"].every(k => before.transform[k] === s.zoomTransform[k]), overrides: before.overrides === JSON.stringify(s.visualOverrides) },
      png: canvas.toDataURL("image/png").split(",")[1] };
  }, { color, pixelRatio });
  const { png, ...evidence } = result;
  evidence.label = label; records.push(evidence);
  await fs.writeFile(path.join(output, `${label}.png`), Buffer.from(png, "base64"));
  assert.ok(evidence.paintPixels > 0, `${label} must export the real painted feature`);
  assert.equal(evidence.width, evidence.expectedWidth); assert.equal(evidence.height, evidence.expectedHeight);
  assert.ok(Object.values(evidence.restored).every(Boolean), `${label} must restore the visible cache, DPR, transform and colors`);
  return evidence;
}

async function lifecycle(page, output, report, painted) {
  const before = await snapshot(page);
  const result = report.lifecycle = { exports: [] };
  for (const [label, ratio] of [["political-export-default", null], ["political-export-low-dpr", 0.5]]) {
    await stage(report, label); await politicalExport(page, output, label, painted.color, ratio, result.exports);
  }
  await stage(report, "context-loss");
  await evaluate(page, () => {
    const canvas = document.querySelector("#map-scene-canvas"), gl = canvas?.getContext("webgl2");
    const extension = gl?.getExtension("WEBGL_lose_context");
    if (!extension || gl.isContextLost()) throw Error("active scene must expose a live WEBGL_lose_context extension");
    extension.loseContext();
  });
  const deadline = Date.now() + 30000;
  let fallback;
  while (Date.now() < deadline) {
    fallback = await snapshot(page);
    if (fallbackSnapshotReady(fallback)) break;
    await page.waitForTimeout(100);
  }
  result.fallback = fallback;
  assert.equal(fallbackSnapshotReady(fallback), true, "context loss must settle a visible safety fallback");
  assert.deepEqual(fallback.overrides, before.overrides); assert.equal(fallback.history, before.history);
  const visible = await screenshotPixels(page, output, "context-loss-fallback", { color: painted.color });
  result.visibleFallback = visible; report.quality.push(visible);
  assert.ok(visible.targetPaintPixels > 0, "real browser fallback must retain painted pixels");
  await stage(report, "context-loss-recovery-vector"); await mode(page, "vector");
  await stage(report, "context-loss-recovery-raster"); result.recovered = await mode(page, "raster");
  assertVisibleScene(result.recovered);
  assert.deepEqual(result.recovered.overrides, before.overrides); assert.equal(result.recovered.history, before.history);
  const recovered = await screenshotPixels(page, output, "context-loss-recovered", { color: painted.color });
  report.quality.push(recovered);
  assert.ok(recovered.targetPaintPixels > 0, "recreated scene must visibly retain painted pixels");
}

async function retainedZoomEdits(page, output, report, value, before) {
  const evidence = { zoom: value, before, status: "holding" };
  report.retained.push(evidence); await checkpoint(report);
  const held = await snapshot(page);
  evidence.held = held;
  evidence.faultAtHeld = await evaluate(page, () => window.__tnoRasterPreparationHold.stats());
  assertRetainedScene(held, before);
  await evaluate(page, () => {
    const monitor = window.__tnoRetainedMonitor = { samples: [], intervals: [], previous: null };
    const tick = now => {
      const d = window.__rasterTask.renderer.getPoliticalIdRasterDiagnostics(), c = document.querySelector("#map-scene-canvas");
      const style = c && getComputedStyle(c);
      if (monitor.previous !== null) monitor.intervals.push(now - monitor.previous);
      monitor.previous = now;
      monitor.samples.push({ active: !!d.scene?.active, backend: d.actualBackend, epoch: d.scene?.publishedEpoch,
        publications: d.scene?.publications, visible: !!c && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 });
      monitor.raf = requestAnimationFrame(tick);
    };
    monitor.raf = requestAnimationFrame(tick);
  });
  const point = await evaluate(page, () => {
    const { renderer, state: s } = window.__rasterTask, rect = document.querySelector("#map-canvas").getBoundingClientRect();
    for (const geo of [[-110, 56], [13.4, 52.5], [25, 45], [100, 40], [0, 25]]) {
      const xy = renderer.projectGeoToScreen(...geo), x = rect.left + xy[0] * rect.width / s.width, y = rect.top + xy[1] * rect.height / s.height;
      if (x > rect.left + 20 && x < rect.right - 20 && y > rect.top + 20 && y < rect.bottom - 20
        && document.elementFromPoint(x, y)?.closest("#mapContainer")) return { x, y, geo };
    }
    throw Error("no visible geographic paint probe during retained zoom");
  });
  const color = ({ 130: "#19a0a2", 250: "#d46c17", 100: "#643cba" })[value];
  const baseline = await screenshotPixels(page, output, `retained-${value}-baseline`, { color, point });
  evidence.baseline = baseline; report.quality.push(baseline);
  await page.locator("#customColor").fill(color);
  await mouse(page, "click", point.x, point.y);
  await waitForPageCondition(page, history => window.__rasterTask.state.historyPast.length === history + 1,
    held.history, { timeout: 10000, label: "retained fill history commit" });
  const painted = await snapshot(page), ids = Object.keys(painted.overrides).filter(id => painted.overrides[id] !== held.overrides[id]);
  assert.equal(ids.length, 1, "fill during preparation must edit one canonical feature");
  assert.equal(painted.overrides[ids[0]], color); assertRetainedScene(painted, before);
  evidence.edit = { id: ids[0], color, point, after: painted };
  const pixel = await screenshotPixels(page, output, `retained-${value}-paint`, { color, point });
  evidence.edit.afterPixels = await snapshot(page);
  report.quality.push(pixel);
  try { evidence.edit.paintComparison = assertRoiMovedTowardColor(baseline.roi, pixel.roi, color); }
  catch (error) {
    try { evidence.edit.afterPixels.missingPixel = await missingRetainedPixelDiagnostics(page, evidence.edit); }
    catch (captureError) { evidence.edit.afterPixels.missingPixelError = String(captureError?.stack || captureError); }
    throw error;
  }
  evidence.edit.paintedPixels = pixel;
  await page.locator("#undoBtn").click();
  await waitForPageCondition(page, history => window.__rasterTask.state.historyPast.length === history,
    held.history, { timeout: 10000, label: "retained undo history commit" });
  const undone = await snapshot(page); assert.deepEqual(undone.overrides, held.overrides); assertRetainedScene(undone, before);
  const undoPixels = await screenshotPixels(page, output, `retained-${value}-undo`, { color, point });
  report.quality.push(undoPixels); evidence.edit.undoComparison = assertRoiRestored(baseline.roi, undoPixels.roi, "undo");
  await page.locator("#redoBtn").click();
  await waitForPageCondition(page, history => window.__rasterTask.state.historyPast.length === history + 1,
    held.history, { timeout: 10000, label: "retained redo history commit" });
  const redone = await snapshot(page); assert.deepEqual(redone.overrides, painted.overrides); assertRetainedScene(redone, before);
  const redoPixels = await screenshotPixels(page, output, `retained-${value}-redo`, { color, point });
  report.quality.push(redoPixels); evidence.edit.redoComparison = assertRoiRestored(pixel.roi, redoPixels.roi, "redo");
  evidence.undo = undone; evidence.redo = redone;
  evidence.faultBeforeRenewal = await evaluate(page, () => window.__tnoRasterPreparationHold.stats());
  // The unchanged asset deadline may cancel a held reply between screenshots.
  // Cancellation is not delivery: wait for the recovery producer's next real
  // reply, retaining the strict requirement that an unreleased reply is held.
  evidence.fault = await waitForPageCondition(page, preparationHeldEvidence, undefined,
    { timeout: 10000, label: "retained preparation reply" }, handle => handle.jsonValue());
  assert.ok(evidence.fault.active && evidence.fault.queued > 0 && evidence.fault.released === 0,
    "edit/undo/redo evidence must finish before worker replies are released");
  assertRetainedScene(await snapshot(page), before);
  evidence.continuity = await evaluate(page, () => {
    const m = window.__tnoRetainedMonitor; cancelAnimationFrame(m.raf);
    return { samples: m.samples, maxRafIntervalMs: Math.max(0, ...m.intervals),
      measurement: "Fault-held interval includes screenshot work; not a normal zoom performance sample." };
  });
  assert.ok(evidence.continuity.samples.length >= 2, "browser must service animation frames while worker replies are held");
  assert.ok(evidence.continuity.samples.every(s => s.active && s.visible && s.backend === "raster"
    && s.epoch === before.diagnostics.scene.publishedEpoch && s.publications === before.diagnostics.scene.publications),
  "every observed frame during preparation must retain the complete visible publication");
  return evidence;
}

export async function zoomStability(page, report) {
  report.navigation = [];
  report.zoomStability = { roundCount: 3, zoomSequence: [130, 250, 100],
    cachePolicy: "No cache clearing between samples. First-pass and repeat-pass identify session order, not independently cold caches; 100% already has a startup baseline. No samples or outliers removed; compare rounds and zoom levels separately." };
  for (let round = 1; round <= report.zoomStability.roundCount; round++) {
    for (const [index, value] of report.zoomStability.zoomSequence.entries()) {
      await stage(report, `zoom-stability-round-${round}-${value}`);
      const navigation = await zoom(page, value, true);
      Object.assign(navigation, { round, sequence: report.navigation.length + 1, roundSequence: index + 1,
        cacheOrder: round === 1 ? "first-pass" : "repeat-pass" });
      report.navigation.push(navigation);
      assertZoomFeedback(navigation.sample); await checkpoint(report);
      console.log(JSON.stringify({ tnoSceneNavigation: summarizeZoomNavigation(navigation), phase: report.phase, dpr: report.dpr }));
    }
  }
}

async function zoomRetained(page, output, report, { normal = true } = {}) {
  report.navigation = []; report.retained = [];
  // Same automatic raster policy and real input path as benchmark v3. These
  // samples precede all fault injection; never report fault latency as speed.
  if (normal) for (const value of [130, 250, 100]) {
    await stage(report, `zoom-normal-${value}`);
    const navigation = await zoom(page, value, true); report.navigation.push(navigation);
    // Inspect graph reuse after the timing window, never force graph/mesh work
    // from the rAF latency observer.
    navigation.contours = await evaluate(page, () => window.__rasterTask.renderer.getPaintContourDiagnostics());
    assertZoomFeedback(navigation.sample); await checkpoint(report);
    console.log(JSON.stringify({ tnoSceneNavigation: summarizeZoomNavigation(navigation), phase: report.phase, dpr: report.dpr }));
  }
  await stage(report, "zoom-retained-fresh-runtime");
  await page.addInitScript(installRasterPreparationHold);
  await page.addInitScript({ content: `window.__tnoSceneResidentReady = (${residentFrameReady.toString()});
    window.__tnoCaptureSceneSnapshot = (${captureSceneSnapshot.toString()});
    window.__tnoArmReadyPreparationBaseline = (${armReadyPreparationBaseline.toString()});` });
  await withDeadline(() => page.reload({ waitUntil: "domcontentloaded", timeout: 60000 }), 60000, "fresh runtime reload");
  await evaluate(page, async () => {
    const renderer = await import(new URL("js/core/map_renderer.js", document.baseURI));
    const { state } = await import(new URL("js/core/state.js", document.baseURI));
    const scenarios = await import(new URL("js/core/scenario_manager.js", document.baseURI));
    window.__rasterTask = { renderer, state, scenarios };
  });
  // Reuse the shared startup predicate through a bounded wait/disposal port.
  await waitRasterStartup({ waitForFunction: (predicate, arg, options) => waitForPageCondition(page, predicate, arg,
    { ...options, label: "fresh runtime startup" }) });
  await settle(page); await dismissGuide(page);
  await page.locator("#paintModeVisualBtn").click(); await page.locator("#toolFillBtn").click();
  await zoom(page, 100);
  await preserveActionError(async () => {
    for (const value of [130, 250, 100]) {
      await stage(report, `zoom-held-${value}`);
      await page.locator("#zoomPercentInput").fill(`${value}%`);
      await waitForPageCondition(page, residentFrameReady, undefined, { timeout: 30000, label: `held ${value} baseline readiness` });
      await evaluate(page, installZoomInputHoldBoundary);
      let before;
      await preserveActionError(async () => {
        await page.locator("#zoomPercentInput").press("Enter");
        const boundary = await evaluate(page, () => {
          const { before, rejectedBefore, event, error } = window.__tnoZoomInputBoundary;
          return { before, rejectedBefore, event, error };
        });
        report.lastHeldInputBoundary = { zoom: value, ...boundary };
        assert.equal(boundary.error, null, boundary.error || "zoom input boundary capture must succeed");
        assert.ok(boundary.event && boundary.before, "the actual Enter must capture a completed scene before zoom begins");
        before = boundary.before;
        before.inputBoundary = boundary.event;
        // Discovery only: cache-only steps still use the strict settle oracle.
        await waitForPageCondition(page, value => {
          const { state, renderer } = window.__rasterTask, d = renderer.getPoliticalIdRasterDiagnostics();
          return window.__tnoRasterPreparationHold.stats().queued > 0 || (Math.abs(state.zoomTransform.k - value / 100) < 1e-7
            && !state.isInteracting && state.renderPhase === "idle" && !state.renderPassCache?.dirty?.political
            && !d.pending && !d.refinementPending && d.view && Math.abs(d.view.k - value / 100) < 1e-7);
        }, value, { timeout: 10000, label: `held ${value} preparation discovery` });
        if ((await evaluate(page, () => window.__tnoRasterPreparationHold.stats())).queued > 0) {
          await retainedZoomEdits(page, output, report, value, before);
        }
      }, () => evaluate(page, () => {
        window.__tnoZoomInputBoundary?.dispose(); window.__tnoRasterPreparationHold.release();
      }), error => recordCleanupError(page, error));
      const after = await settle(page), evidence = report.retained.at(-1);
      assert.ok(Math.abs(after.view.k - value / 100) < 1e-7);
      if (evidence?.zoom === value) {
        assert.deepEqual(after.overrides, evidence.redo.overrides, "atomic publication must preserve edits made while preparing");
        assert.equal(after.history, evidence.redo.history);
        assert.equal(after.diagnostics.scene.presentationState, "published");
        assert.equal(after.diagnostics.scene.usingOverview, false, "final readiness must use the complete current primary frame");
        assert.ok(after.diagnostics.scene.publications > before.diagnostics.scene.publications, "finished candidate must publish a new frame");
        const pixels = await screenshotPixels(page, output, `retained-${value}-settled`, { color: evidence.edit.color, point: evidence.edit.point });
        report.quality.push(pixels); evidence.edit.settledComparison = assertRoiMovedTowardColor(evidence.baseline.roi, pixels.roi, evidence.edit.color);
        evidence.after = after; evidence.status = "complete";
      }
      await checkpoint(report);
    }
    assert.ok(report.retained.length > 0, "retained regression must exercise actual unfinished worker preparation");
  }, () => evaluate(page, () => {
    cancelAnimationFrame(window.__tnoRetainedMonitor?.raf); window.__tnoZoomInputBoundary?.dispose(); window.__tnoRasterPreparationHold.dispose();
  }), error => recordCleanupError(page, error));
}

export async function profileTnoScene(baseUrl, { phase = "smoke", dpr = 1, output, revision = "unknown", channel,
  diagnosticTrace = false, diagnosticTraceOnly = false, diagnosticOnFailure = false,
  diagnosticNativeBreadcrumbs = false, onFailure = null } = {}) {
  assert.ok([diagnosticTrace, diagnosticTraceOnly, diagnosticOnFailure].filter(Boolean).length <= 1, "Choose only one diagnostic trace mode");
  assert.ok(["smoke", "smoke-core", "roundtrip", "benchmark", "lifecycle", "zoom-retained", "zoom-stability", "retained-edit"].includes(phase), "unknown phase");
  assert.ok([1, 2].includes(dpr), "DPR must be 1 or 2");
  output = path.resolve(output || `.runtime/browser/tno-raster-scene/${phase}-dpr${dpr}`);
  await fs.mkdir(output, { recursive: true });
  const report = { schemaVersion: 1, revision, phase, scenario: SCENARIO, dpr, viewport: VIEWPORT, passed: false, blocks: [], quality: [], events: [],
    measurement: "Same-document, same-DPR input to observed settled state and rAF intervals; not display presentation, GPU execution, FPS, or INP. Screenshot/pixel checks only outside sample intervals. No outliers removed." };
  const diagnosticEnabled = diagnosticTrace || diagnosticTraceOnly;
  if (diagnosticEnabled) {
    report.performanceBaselineEligible = false;
    report.measurement = "DIAGNOSTIC TRACE RUN: debugger/profiler/tracing overhead; not performance baseline evidence. " + report.measurement;
  }
  if (diagnosticNativeBreadcrumbs) {
    report.performanceBaselineEligible = false;
    report.measurement = "DIAGNOSTIC NATIVE BREADCRUMBS: native-call instrumentation overhead; not performance baseline evidence. " + report.measurement;
  }
  report.watchdogs = { ioMs: IO_BOUND_MS, cleanupMs: CLEANUP_BOUND_MS, inputActionMs: ACTION_BOUND_MS,
    locatorMs: 10000, settlementMs: 30000, cancellation: "watchdog rejects the pending command; browser close is bounded separately" };
  reportIo.set(report, { file: path.join(output, `tno-scene-${phase}-dpr${dpr}.json`), queue: Promise.resolve(), timingActive: false });
  let session, diagnostic, nativeBreadcrumbs, closingSession = false;
  async function finishDiagnostic(failed) {
    try { await diagnostic?.finish({ failed }); }
    catch (error) { report.diagnosticFinishError = String(error?.stack || error); }
  }
  try {
    await stage(report, "startup-default");
    if (diagnosticNativeBreadcrumbs) {
      const file = path.join(output, `tno-scene-${phase}-dpr${dpr}.native-breadcrumbs.json`);
      nativeBreadcrumbs = await startNativeBreadcrumbCollector({ file });
      report.nativeBreadcrumbs = { ...nativeBreadcrumbs.snapshot(), file };
    }
    session = await openRasterApp(baseUrl, { scenarioId: SCENARIO, enabled: null, dpr, viewport: VIEWPORT, language: "en", launchOptions: channel ? { channel } : {},
      ...(nativeBreadcrumbs ? { initScripts: [nativeBreadcrumbInitScript(nativeBreadcrumbs.endpoint)] } : {}) });
    const { page } = session; page.setDefaultTimeout(10000);
    pageReports.set(page, report);
    if (diagnosticEnabled) diagnostic = await startDiagnosticTrace(session, {
      output, prefix: `tno-scene-${phase}-dpr${dpr}`, report, traceOnly: diagnosticTraceOnly,
    });
    if (diagnosticEnabled) {
      try {
        await withDeadline(() => page.addInitScript(installDiagnosticWorkerPosts), CLEANUP_BOUND_MS, "diagnostic worker post init");
        await withDeadline(() => page.evaluate(installDiagnosticWorkerPosts), CLEANUP_BOUND_MS, "diagnostic worker post observer");
      } catch (error) {
        report.diagnosticTrace.errors.push({ operation: "worker post observer", stage: report.stage, error: String(error?.stack || error) });
      }
    }
    const recordEvent = name => {
      const event = { name, at: new Date().toISOString(), stage: report.stage, runnerClosingSession: closingSession };
      report.events.push(event); console.log(JSON.stringify({ tnoSceneEvent: event }));
      void checkpoint(report);
    };
    page.on("crash", () => recordEvent("page-crash"));
    page.on("close", () => recordEvent("page-close"));
    session.context.on("close", () => recordEvent("context-close"));
    session.browser.on("disconnected", () => recordEvent("browser-disconnected"));
    report.browser = session.browser.version(); report.requestedChannel = channel || "bundled-chromium";
    report.hardware = await evaluate(page, () => {
      const gl = document.createElement("canvas").getContext("webgl2"), ext = gl?.getExtension("WEBGL_debug_renderer_info");
      const gpu = gl ? { renderer: gl.getParameter(ext?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER), vendor: gl.getParameter(ext?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR), version: gl.getParameter(gl.VERSION) } : null;
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
      return { gpu, userAgent: navigator.userAgent, dpr: devicePixelRatio, visibility: document.visibilityState };
    });
    assert.equal(report.hardware.dpr, dpr);
    report.initial = await settle(page); assertVisibleScene(report.initial);
    assert.ok(!new URL(page.url()).searchParams.has("political_id_raster"), "startup must use real default policy");
    await dismissGuide(page); await page.locator("#paintModeVisualBtn").click(); await page.locator("#toolFillBtn").click();
    if (["benchmark", "zoom-retained", "zoom-stability", "retained-edit"].includes(phase)) await zoom(page, 100);
    await stage(report, "real-fill");
    const first = await fill(page, "#e31ac4", { timed: phase === "benchmark" });
    report.firstFill = first;
    if (phase === "benchmark") {
      // ABBA repeats preserve order effects and do not blend different DPRs.
      for (const [index, value] of ["raster", "vector", "vector", "raster"].entries()) {
        const block = { index, mode: value, status: "running", samples: [], navigation: [], brush: {} };
        report.blocks.push(block);
        await stage(report, `benchmark-${index}-${value}`);
        block.heapBefore = await heapEvidence(page); await checkpoint(report);
        await mode(page, value);
        const view = (await snapshot(page)).view;
        const correction = { x: first.before.view.x - view.x, y: first.before.view.y - view.y };
        if (Math.hypot(correction.x, correction.y) >= 0.25) await drag(page, { delta: correction });
        // Reset through real undo before each paired first fill, preserving the
        // same canonical baseline without mutating application state in tests.
        await restoreEditBaseline(page, first.before);
        const before = await snapshot(page), samples = block.samples;
        block.before = before.diagnostics;
        await page.locator("#toolFillBtn").click();
        await stage(report, `benchmark-${index}-${value}-first-fill`);
        const firstPaint = await fill(page, "#e31ac4", { timed: true, expectedId: first.id });
        block.firstPaint = firstPaint.timing;
        await stage(report, `benchmark-${index}-${value}-recolor`);
        for (const color of ["#ab1357", "#31bb7d", "#8a32c4", "#317acd", "#e31ac4", "#cc9911"]) {
          const painted = await fill(page, color, { timed: true, expectedId: first.id }); samples.push({ color, ...painted.timing });
          block.input = summarizeSamples(samples.map(s => s.inputToObservedReadyMs));
          await checkpoint(report);
        }
        await stage(report, `benchmark-${index}-${value}-brush`);
        const brush = await measuredBrush(page, first.before, report.blocks[0]?.brush.points, block.brush,
          async name => await stage(report, `benchmark-${index}-${value}-brush-${name}`));
        if (index > 0) assert.deepEqual(brush.points, report.blocks[0].brush.points, "paired raster/vector brush must use identical screen trajectories");
        const navigation = block.navigation;
        for (const zoomValue of [130, 250, 100]) {
          await stage(report, `benchmark-${index}-${value}-zoom-${zoomValue}`);
          navigation.push(await zoom(page, zoomValue, true));
        }
        await stage(report, `benchmark-${index}-${value}-pan`);
        const pan = await drag(page, { timed: true });
        block.pan = pan;
        await drag(page, { delta: { x: pan.before.x - pan.after.x, y: pan.before.y - pan.after.y } });
        const after = await snapshot(page);
        block.after = after.diagnostics; block.heapAfter = await heapEvidence(page); block.status = "complete";
        await checkpoint(report);
      }
    } else if (phase === "zoom-stability") {
      await zoomStability(page, report);
    } else if (["zoom-retained", "retained-edit"].includes(phase)) {
      await zoomRetained(page, output, report, { normal: phase === "zoom-retained" });
    } else if (phase === "lifecycle") {
      await lifecycle(page, output, report, first);
    } else if (phase === "roundtrip") {
      await stage(report, "project-roundtrip"); report.roundtrip = await roundtrip(page, output);
      const restored = await screenshotPixels(page, output, "raster-restored", { color: first.color });
      report.quality.push(restored);
      assert.ok(restored.targetPaintPixels > 0, "import must restore painted color at its actual map position");
    } else {
      await stage(report, "repeat-fill-history");
      const repeated = await fill(page, "#19a0a2", { expectedId: first.id }); report.repeatedFill = repeated;
      await page.locator("#undoBtn").click(); await settle(page);
      assert.deepEqual((await snapshot(page)).overrides, repeated.before.overrides);
      await page.locator("#redoBtn").click(); await settle(page);
      assert.deepEqual((await snapshot(page)).overrides, repeated.after.overrides);
      await stage(report, "brush-history"); report.brush = await brushHistory(page, false, settle);
      assert.equal(report.brush.pointerSteps, 41); assert.equal(report.brush.historyEntries, 1);
      await page.locator("#toolFillBtn").click();
      await stage(report, "navigation"); report.pan = await drag(page); await drag(page, { reverse: true });
      report.navigation = [];
      for (const value of [130, 250, 100]) {
        await stage(report, `zoom-${value}`); report.navigation.push(await zoom(page, value));
      }
      await stage(report, "visible-paint");
      const painted = await fill(page, "#dd2277", { expectedId: first.id });
      const raster = await screenshotPixels(page, output, "raster-painted", { color: painted.color, reference: true });
      report.quality.push(raster);
      assert.ok(raster.targetPaintPixels > 0, "actual browser composite must contain the painted color at the clicked feature");
      const rasterState = await snapshot(page); await mode(page, "vector");
      assert.deepEqual((await snapshot(page)).overrides, rasterState.overrides);
      assert.deepEqual((await snapshot(page)).view, rasterState.view);
      const vector = await screenshotPixels(page, output, "vector-painted", { color: painted.color, compare: true });
      report.quality.push(vector); assert.ok(vector.targetPaintPixels > 0);
      await mode(page, "raster");
      if (phase === "smoke") {
        await stage(report, "project-roundtrip"); report.roundtrip = await roundtrip(page, output);
        const restored = await screenshotPixels(page, output, "raster-restored", { color: painted.color });
        report.quality.push(restored);
        assert.ok(restored.targetPaintPixels > 0, "import must restore painted color at its actual map position");
      }
    }
    report.final = await snapshot(page); assert.deepEqual(session.errors, []);
    report.finalContours = await evaluate(page, () => window.__rasterTask.renderer.getPaintContourDiagnostics());
    report.finalResourceBudget = await evaluate(page, async () => {
      const { pageResourceBudget } = await import(new URL("js/core/runtime_resource_budget.js", document.baseURI));
      return pageResourceBudget.snapshot();
    });
    await stage(report, "complete"); report.passed = true;
  } catch (error) {
    report.error = String(error?.stack || error);
    const partial = report.blocks.at(-1);
    if (partial?.status === "running") { partial.status = "failed"; partial.failedStage = report.stage; partial.error = report.error; }
    console.log(JSON.stringify({ tnoSceneFailure: report.stage, phase, dpr, error: String(error?.message || error) }));
    if (onFailure) {
      try { await withDeadline(() => onFailure({ session, report }), 30000, "external failure observer"); }
      catch (observerError) { report.externalFailureObserverError = String(observerError?.stack || observerError); }
    }
    // Capture the stopped stack and browser trace before optional page-based
    // failure probes, which can themselves stall on the unresponsive renderer.
    if (diagnosticOnFailure && session && !diagnostic) {
      report.performanceBaselineEligible = false;
      try {
        diagnostic = await startDiagnosticTrace(session, {
          output, prefix: `tno-scene-${phase}-dpr${dpr}`, report, trigger: "failure",
        });
      } catch (captureError) { report.diagnosticStartError = String(captureError?.stack || captureError); }
    }
    await finishDiagnostic(true);
    if (session) {
      report.failureConnection = { pageClosed: session.page.isClosed(), browserConnected: session.browser.isConnected(), at: new Date().toISOString() };
      await checkpoint(report);
      try { report.failure = await withDeadline(() => snapshot(session.page), CLEANUP_BOUND_MS, "failure snapshot"); }
      catch (captureError) { report.failure = null; report.failureSnapshotError = String(captureError?.stack || captureError); }
      await checkpoint(report);
      try { await withDeadline(() => session.page.screenshot({ path: path.join(output, "failure.png"), timeout: CLEANUP_BOUND_MS }), CLEANUP_BOUND_MS, "failure screenshot"); }
      catch (captureError) { report.failureScreenshotError = String(captureError?.stack || captureError); }
      if (partial?.status === "failed") {
        try { partial.heapAfterFailure = await withDeadline(() => heapEvidence(session.page), CLEANUP_BOUND_MS, "failure heap observation"); }
        catch (captureError) { partial.heapAfterFailureError = String(captureError?.stack || captureError); }
      }
    }
  } finally {
    await finishDiagnostic(!report.passed);
    if (session) {
      report.errors = session.errors; report.warnings = session.warnings; report.network = session.network;
      closingSession = true;
      await checkpoint(report);
      try { await withDeadline(() => session.browser.close(), CLEANUP_BOUND_MS, "browser.close"); }
      catch (closeError) { report.browserCloseError = String(closeError?.stack || closeError); }
    }
    if (nativeBreadcrumbs) {
      try { report.nativeBreadcrumbs = { ...await withDeadline(() => nativeBreadcrumbs.close(), CLEANUP_BOUND_MS, "native breadcrumb cleanup"), file: report.nativeBreadcrumbs.file }; }
      catch (closeError) {
        report.nativeBreadcrumbs = { ...nativeBreadcrumbs.snapshot(), file: report.nativeBreadcrumbs.file,
          cleanupError: String(closeError?.stack || closeError) };
      }
    }
    await checkpoint(report);
  }
  return report;
}

export function parseProfileArguments(args) {
  const flags = new Map(), allowed = ["--base-url", "--phase", "--dpr", "--output", "--revision", "--channel"];
  const diagnosticFlags = ["--diagnostic-trace", "--diagnostic-trace-only", "--diagnostic-on-failure"];
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--diagnostic-native-breadcrumbs") { flags.set(flag, true); continue; }
    if (diagnosticFlags.includes(flag)) { flags.set(flag, true); continue; }
    if (!allowed.includes(flag) || !args[i + 1] || args[i + 1].startsWith("--")) throw Error("Invalid profiler argument");
    flags.set(flag, args[++i]);
  }
  if (diagnosticFlags.filter(flag => flags.has(flag)).length > 1) throw Error("Choose only one diagnostic trace mode");
  return flags;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const flags = parseProfileArguments(process.argv.slice(2));
  const baseUrl = flags.get("--base-url"), url = new URL(baseUrl);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw Error("Profiler is localhost-only");
  const phase = flags.get("--phase") || "smoke", dpr = Number(flags.get("--dpr") || 1);
  const output = path.resolve(flags.get("--output") || `.runtime/browser/tno-raster-scene/${phase}-dpr${dpr}`);
  if (!output.startsWith(path.resolve(".runtime") + path.sep)) throw Error("Artifacts must stay inside .runtime");
  await fs.mkdir(output, { recursive: true });
  const report = await profileTnoScene(baseUrl, { phase, dpr, output, revision: flags.get("--revision"), channel: flags.get("--channel"),
    diagnosticTrace: flags.get("--diagnostic-trace") === true, diagnosticTraceOnly: flags.get("--diagnostic-trace-only") === true,
    diagnosticOnFailure: flags.get("--diagnostic-on-failure") === true,
    diagnosticNativeBreadcrumbs: flags.get("--diagnostic-native-breadcrumbs") === true });
  console.log(JSON.stringify({ passed: report.passed, stage: report.stage, phase, dpr, hardware: report.hardware,
    blocks: report.blocks.map(summarizeProfileBlock), navigation: (report.navigation || []).map(summarizeZoomNavigation),
    ...(report.zoomStability ? { zoomStability: report.zoomStability } : {}),
    quality: report.quality.map(summarizeQualityPixels), error: report.error,
    ...(report.diagnosticTrace ? { diagnosticTrace: report.diagnosticTrace,
      diagnosticTraceIncomplete: !!report.diagnosticTraceIncomplete, performanceBaselineEligible: false } : {}),
    ...(report.nativeBreadcrumbs ? { nativeBreadcrumbs: report.nativeBreadcrumbs, performanceBaselineEligible: false } : {}) }));
  if (!report.passed) process.exitCode = 1;
}
