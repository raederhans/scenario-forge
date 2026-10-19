import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { armReadyPreparationBaseline, assertRetainedScene, assertRoiMovedTowardColor, assertRoiRestored, assertVisibleScene, assertZoomFeedback,
  captureRenderMetricDurations, captureSceneSnapshot, fallbackSnapshotReady, fillCommitReady, installDiagnosticWorkerPosts, installRasterPreparationHold, installZoomInputHoldBoundary,
  parseProfileArguments, preparationHeldEvidence, preserveActionError, profileTnoScene, startDiagnosticTrace, summarizeProfileBlock, summarizeQualityPixels, summarizeSamples,
  summarizeZoomNavigation, waitForPageCondition, withDeadline, zoomStability } from "../tools/profile_tno_raster_scene.mjs";
import { residentFrameReady } from "../tools/verify_political_raster_resident.mjs";

function activeScene() {
  return { diagnostics: { actualBackend: "raster", countryLabels: { ready: true }, scene: { active: true, frames: 2, textureUploads: 1, bytes: 4096 } },
    canvas: { visible: true, width: 1280, height: 900, rect: { width: 1280, height: 900 } } };
}

test("complete residency observes current label readiness only after base readiness", () => {
  const view = { x: 0, y: 0, k: 1 };
  const state = { renderPhase: "idle", zoomTransform: view };
  let reads = 0, readiness = { ready: true };
  const diagnostics = { effectiveMode: "raster", actualBackend: "raster", displayState: "accelerated",
    sourceCoverage: "complete-display-v1", view };
  Object.defineProperty(diagnostics, "countryLabels", { get() { reads++; return readiness; } });
  assert.equal(residentFrameReady({ ...state, isInteracting: true }, diagnostics), false);
  assert.equal(reads, 0, "interaction/base producer polling must not inspect label fits");
  assert.equal(residentFrameReady(state, diagnostics), true);
  assert.equal(reads, 1);
  readiness = { ready: false, pendingFits: 1, scheduled: true, pendingWorkerFits: 0 };
  assert.equal(residentFrameReady(state, diagnostics), false, "scheduled but undispatched visible fits are unfinished");
  readiness = { ready: true, pendingFits: 0, pendingWorkerFits: 2, scheduled: true };
  assert.equal(residentFrameReady(state, diagnostics), true, "unrelated old-view work cannot indefinitely block current readiness");
  assert.equal(residentFrameReady({ ...state, renderPassCache: { dirty: { labels: true } } }, diagnostics), false,
    "completed fits still need their label pass painted and published");
  readiness = undefined;
  assert.equal(residentFrameReady(state, diagnostics), false, "enabled labels require an initialized readiness owner");
  const previousReads = reads;
  assert.equal(residentFrameReady({ ...state, styleConfig: { countryLabels: { enabled: false } } }, diagnostics), true);
  assert.equal(reads, previousReads, "hidden country labels do not wait on their old workers");
});

test("renderer country label readiness reads existing owners without creating producers", async () => {
  const source = await readFile(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
  const start = source.indexOf("export function getCountryLabelReadiness()");
  const end = source.indexOf("export function getPoliticalIdRasterDiagnostics()", start);
  assert.ok(start >= 0 && end > start);
  const create = new Function("runtimeState", "countryLabelSourceOwner", "countryLabelRenderOwner",
    `${source.slice(start, end).replace("export function", "function")} return getCountryLabelReadiness;`);
  const state = { styleConfig: {}, renderPassCache: { dirty: {} } };
  assert.equal(create(state, null, null)().ready, false);
  assert.equal(create({ styleConfig: { countryLabels: { enabled: false } } },
    { peekSource() { assert.fail("hidden labels must not inspect source"); } }, null)().ready, true);
  let status = "pending", peeks = 0, checks = 0;
  const snapshot = { status: "ready" };
  const owner = { peekSource() { peeks++; return status === "ready" ? snapshot : { status }; },
    getSource() { assert.fail("readiness must never sync or start a source worker"); } };
  const render = { getReadinessForCurrentView(value) {
    checks++; assert.equal(value, snapshot);
    return { ready: true, pendingFits: 0, pendingWorkerFits: 1, scheduled: true, workerErrors: 0 };
  } };
  const read = create(state, owner, render);
  assert.equal(read().ready, false); assert.equal(checks, 0);
  status = "disabled";
  assert.equal(create(state, owner, null)().ready, true, "disabled blank sources do not need a layout owner");
  status = "ready";
  assert.equal(create(state, owner, null)().ready, false);
  assert.equal(read().ready, true);
  state.renderPassCache.dirty.labels = true;
  assert.equal(read().ready, false);
  assert.equal(checks, 2);
  assert.equal(peeks, 5);
});

test("complete residency waits for nonpolitical texture preparation and atomic publication", () => {
  const view = { x: 0, y: 0, k: 1 };
  const state = { renderPhase: "idle", zoomTransform: view, renderPassCache: { dirty: {} } };
  const diagnostics = { effectiveMode: "raster", actualBackend: "raster", displayState: "accelerated",
    directPresentation: true, sourceCoverage: "complete-display-v1", view, countryLabels: { ready: true },
    publishedFrame: { state: "published" },
    scene: { active: true, presentationState: "published", usingOverview: false, publicationPending: true } };
  assert.equal(residentFrameReady(state, diagnostics), false,
    "clean Canvas passes and old published political data cannot finish private texture preparation");
  diagnostics.scene.preparedPassCount = 3;
  assert.equal(residentFrameReady(state, diagnostics), false, "ready private textures still need atomic adoption");
  diagnostics.scene.publicationPending = false;
  assert.equal(residentFrameReady(state, diagnostics), true);
});

test("visible scene evidence rejects a successful raster pass with an absent or hidden presentation", () => {
  assert.doesNotThrow(() => assertVisibleScene(activeScene()));
  for (const key of ["active", "frames", "textureUploads", "bytes"]) {
    const s = activeScene(); s.diagnostics.scene[key] = key === "active" ? false : 0;
    assert.throws(() => assertVisibleScene(s), undefined, key);
  }
  const hidden = activeScene(); hidden.canvas.visible = false;
  assert.throws(() => assertVisibleScene(hidden));
  const missing = activeScene(); missing.canvas = null;
  assert.throws(() => assertVisibleScene(missing));
  const empty = activeScene(); empty.canvas.width = 0;
  assert.throws(() => assertVisibleScene(empty));
});

test("performance summaries preserve tail samples and reject invalid or empty measurements", () => {
  assert.deepEqual(summarizeSamples([1, 2, 3, 1000]), { count: 4, median: 2.5, p95: 1000, max: 1000 });
  assert.deepEqual(summarizeSamples([4, 1, 2]), { count: 3, median: 2, p95: 4, max: 4 });
  assert.throws(() => summarizeSamples([]));
  assert.throws(() => summarizeSamples([1, NaN]));
});

test("context loss requires a completed fallback producer while preserving the requested raster policy", () => {
  const current = { view: { x: 0, y: 0, k: 1 }, settlement: { renderPhase: "idle", dirty: {}, chunks: {},
    background: { progressive: true, deferredFullCacheReady: true } },
    diagnostics: { effectiveMode: "raster", actualBackend: "vector", countryLabels: { ready: true }, scene: { active: false, failure: "webgl-context-lost" } } };
  assert.equal(fallbackSnapshotReady(current), true);
  assert.equal(current.diagnostics.effectiveMode, "raster", "test adaptation must not mutate user policy");
  assert.equal(fallbackSnapshotReady({ ...current, settlement: { ...current.settlement, background: null } }), false);
  assert.equal(fallbackSnapshotReady({ ...current, settlement: { ...current.settlement, dirty: { political: true } } }), false);
  assert.equal(fallbackSnapshotReady({ ...current, diagnostics: { ...current.diagnostics, scene: { active: true, failure: "webgl-context-lost" } } }), false);
  const raster = { ...current.diagnostics, actualBackend: "raster", displayState: "accelerated", sourceCoverage: "complete-display-v1", view: current.view };
  assert.equal(fallbackSnapshotReady({ ...current, diagnostics: raster }), true);
  assert.equal(fallbackSnapshotReady({ ...current, diagnostics: { ...raster, pending: 1 } }), false);
});

test("browser snapshots carry observed label readiness across the Node fallback boundary", () => {
  const state = { zoomTransform: { x: 0, y: 0, k: 1 }, historyPast: [], historyFuture: [],
    renderPhase: "idle", renderPassCache: { dirty: {} },
    renderPerfMetrics: { drawPoliticalBackgroundFillsPass: { progressive: false } } };
  let ready = false;
  const renderer = { getPoliticalIdRasterDiagnostics: () => ({ effectiveMode: "raster", actualBackend: "vector",
    scene: { active: false, failure: "webgl-context-lost" } }), getCountryLabelReadiness: () => ({ ready }) };
  const capture = new Function("window", "document", `return (${captureSceneSnapshot.toString()})();`);
  const read = () => capture({ __rasterTask: { state, renderer } }, { querySelector: () => null });
  assert.equal(fallbackSnapshotReady(read()), false, "unfinished visible labels still block fallback completion");
  ready = true;
  assert.equal(fallbackSnapshotReady(read()), true, "completed labels must survive snapshot serialization");
  state.renderPassCache.dirty.labels = true;
  assert.equal(fallbackSnapshotReady(read()), false, "label publication remains required");
});

test("direct final readiness waits for secondary spatial preparation even while the published scene remains visible", () => {
  const view = { x: 0, y: 0, k: 1 }, state = { renderPhase: "idle", zoomTransform: view, secondarySpatialBuildPending: false };
  const diagnostics = { effectiveMode: "raster", actualBackend: "raster", displayState: "accelerated", view,
    sourceCoverage: "complete-display-v1", directPresentation: true, countryLabels: { ready: true }, publishedFrame: { state: "published" },
    scene: { active: true, presentationState: "published", usingOverview: false } };
  assert.equal(residentFrameReady(state, diagnostics), true);
  assert.equal(residentFrameReady({ ...state, secondarySpatialBuildPending: true }, diagnostics), false);
  assert.equal(residentFrameReady(state, { ...diagnostics, waterPreparation: { pending: true } }), false);
  assert.equal(residentFrameReady(state, { ...diagnostics, borderPreparation: { pending: true } }), false);
  assert.equal(residentFrameReady(state, { ...diagnostics, asyncWork: { borderScheduled: true } }), false,
    "a published frame is not final while a border mesh or contour can still replace it");
  assert.equal(residentFrameReady(state, { ...diagnostics, asyncWork: { borderScheduled: false } }), true);
  assert.equal(residentFrameReady({ ...state, renderPassCache: { dirty: { borders: true } } },
    { ...diagnostics, asyncWork: { borderScheduled: false }, borderPreparation: { pending: false } }), false,
    "committed border meshes must redraw and publish before reporting ready");
  assert.equal(diagnostics.scene.active, true, "completion must wait without invalidating the visible scene");
  const physical = { ...state, showPhysical: true, styleConfig: { physical: { mode: "atlas_only" } } };
  assert.equal(residentFrameReady(physical, diagnostics), false, "visible atlas data must arrive before full readiness");
  physical.physicalSemanticsData = { features: [{}] };
  assert.equal(residentFrameReady(physical, diagnostics), true);
  assert.equal(residentFrameReady({ ...physical, renderPassCache: { dirty: { physicalBase: true } } }, diagnostics), false);
  assert.equal(residentFrameReady(physical, { ...diagnostics, scene: { ...diagnostics.scene, physicalCanvas: { pending: true } } }), false);
});

test("held baseline waits for the previous complete candidate to publish before capturing and arming", () => {
  const view = { x: 0, y: 0, k: 1 }, state = { renderPhase: "idle", zoomTransform: view };
  const current = activeScene(); current.view = view;
  Object.assign(current.diagnostics, { effectiveMode: "raster", displayState: "accelerated", sourceCoverage: "complete-display-v1",
    directPresentation: true, view, stagedPending: true, publishedFrame: { state: "retained" } });
  Object.assign(current.diagnostics.scene, { presentationState: "retained", publishedEpoch: 1, publications: 2, usingOverview: false });
  let captures = 0, arms = 0;
  const fault = { active: false, arm() { arms++; this.active = true; }, stats() { return { active: this.active, queued: 0, released: 0 }; } };
  const scope = { __rasterTask: { state, renderer: { getPoliticalIdRasterDiagnostics: () => current.diagnostics } },
    __tnoSceneResidentReady: residentFrameReady,
    __tnoCaptureSceneSnapshot: () => { captures++; assert.equal(fault.active, false); return structuredClone(current); },
    __tnoRasterPreparationHold: fault };
  assert.equal(armReadyPreparationBaseline(scope), false, "pending old candidate cannot become the retained baseline");
  assert.equal(captures, 0); assert.equal(arms, 0);
  current.diagnostics.stagedPending = false;
  assert.equal(armReadyPreparationBaseline(scope), false, "a retained primary is still not a completed baseline");
  current.diagnostics.publishedFrame.state = "published";
  current.diagnostics.scene.presentationState = "published";
  current.diagnostics.scene.publications = 3;
  const baseline = armReadyPreparationBaseline(scope);
  assert.equal(captures, 1); assert.equal(arms, 1);
  assert.equal(baseline.diagnostics.scene.publications, 3);
  assert.equal(baseline.holdAtCapture.active, true);
  current.diagnostics.scene.presentationState = "retained";
  current.diagnostics.scene.frames++;
  current.diagnostics.scene.view = view;
  current.diagnostics.pending = 1;
  assert.doesNotThrow(() => assertRetainedScene(current, baseline));
  current.diagnostics.scene.publications++;
  assert.throws(() => assertRetainedScene(current, baseline), /same complete publication/, "publications during the actual hold remain forbidden");
});

test("held baseline uses the actual Enter capture boundary after a legal publication between API calls", () => {
  let publication = 2, ready = true, arms = 0, listener = null;
  const fault = { active: false, arm() { arms++; this.active = true; }, stats() { return { active: this.active }; } };
  const scope = { document: {
    addEventListener(type, callback, capture) { assert.equal(type, "keydown"); assert.equal(capture, true); listener = callback; },
    removeEventListener(type, callback, capture) { assert.equal(type, "keydown"); assert.equal(capture, true); if (listener === callback) listener = null; },
  }, __rasterTask: { state: {}, renderer: { getPoliticalIdRasterDiagnostics: () => ({}) } },
  __tnoSceneResidentReady: () => ready,
  __tnoCaptureSceneSnapshot: () => ({ diagnostics: { scene: { publications: publication } } }),
  __tnoArmReadyPreparationBaseline: armReadyPreparationBaseline, __tnoRasterPreparationHold: fault };
  installZoomInputHoldBoundary(scope);
  assert.equal(arms, 0, "setup cannot arm the gate or freeze an earlier publication");
  publication = 3; // An old-view complete frame publishes before real Enter.
  const event = { type: "keydown", key: "Enter", timeStamp: 100,
    target: { id: "zoomPercentInput", value: "130%" }, preventDefault() { assert.fail("input must reach the app unchanged"); } };
  listener(event);
  assert.equal(arms, 1); assert.equal(listener, null, "capture listener removes itself after the matching input");
  assert.equal(scope.__tnoZoomInputBoundary.before.diagnostics.scene.publications, 3);
  assert.equal(scope.__tnoZoomInputBoundary.event.timeStamp, 100);
  assert.equal(scope.__tnoZoomInputBoundary.error, null);
  // The app's input handler now begins zoom; the captured baseline stays at
  // its actual pre-input publication, rather than the earlier API-call state.
  ready = false; publication = 4;
  assert.equal(scope.__tnoZoomInputBoundary.before.diagnostics.scene.publications, 3);
  fault.active = false;
  installZoomInputHoldBoundary(scope);
  listener(event);
  assert.equal(arms, 1, "a non-ready scene at real Enter cannot arm a hold");
  assert.equal(scope.__tnoZoomInputBoundary.before, false);
  assert.match(scope.__tnoZoomInputBoundary.error, /strict-ready baseline unavailable/);
  assert.equal(scope.__tnoZoomInputBoundary.rejectedBefore.diagnostics.scene.publications, 4);
});

test("partial benchmark blocks retain completed samples and can be summarized before brush cleanup finishes", () => {
  assert.deepEqual(summarizeProfileBlock({ mode: "vector", status: "failed" }), {
    mode: "vector", status: "failed", sampleCount: 0, input: null, firstFillMs: null, brushMs: null, brushSteps: null, brushStage: null,
  });
  const result = summarizeProfileBlock({ mode: "vector", status: "failed", samples: [{ inputToObservedReadyMs: 12 }, { inputToObservedReadyMs: 34 }],
    brush: { sample: { inputToObservedReadyMs: 99 }, pointerSteps: 41, stage: "exit" } });
  assert.equal(result.input.median, 23); assert.equal(result.sampleCount, 2);
  assert.equal(result.brushMs, 99); assert.equal(result.brushStage, "exit");
});

test("a stalled command reaches its watchdog without waiting for a browser disconnect", async () => {
  await assert.rejects(withDeadline(() => new Promise(() => {}), 20, "stalled input"), /stalled input exceeded 20ms watchdog/);
  assert.equal(await withDeadline(() => Promise.resolve("ready"), 20, "completed input"), "ready");
});

function boundedWaitHarness() {
  const cleanupErrors = [];
  const wait = new Function("withDeadline", "preserveActionError", "CLEANUP_BOUND_MS", "IO_BOUND_MS", "recordCleanupError",
    `return (${waitForPageCondition.toString()});`)(withDeadline, preserveActionError, 20, 20,
    (_page, error) => cleanupErrors.push(error));
  return { wait, cleanupErrors };
}

test("page predicate wait has the same Node deadline and disposes a handle arriving after timeout", async () => {
  const { wait, cleanupErrors } = boundedWaitHarness();
  let resolveWait, disposed = 0;
  const predicate = () => true, arg = { value: 130 };
  const page = { waitForFunction(actualPredicate, actualArg, options) {
    assert.equal(actualPredicate, predicate); assert.equal(actualArg, arg);
    assert.deepEqual(options, { timeout: 20 });
    return new Promise(resolve => { resolveWait = resolve; });
  } };
  await assert.rejects(wait(page, predicate, arg, { timeout: 20, label: "held 250 baseline readiness" }),
    /held 250 baseline readiness exceeded 20ms watchdog/);
  resolveWait({ async dispose() { disposed++; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(disposed, 1);
  assert.deepEqual(cleanupErrors, []);
});

test("successful predicate handle disposal is bounded and reports a stuck cleanup", async () => {
  const { wait, cleanupErrors } = boundedWaitHarness();
  const page = { async waitForFunction() { return { dispose: () => new Promise(() => {}) }; } };
  await assert.rejects(wait(page, () => true, undefined, { timeout: 20, label: "preparation discovery" }),
    /preparation discovery handle dispose exceeded 20ms watchdog/);
  assert.equal(cleanupErrors.length, 1);
});

test("predicate result reads are bounded and their failure survives handle cleanup failure", async () => {
  const { wait, cleanupErrors } = boundedWaitHarness();
  let reads = 0, disposals = 0;
  const handle = { jsonValue: () => { reads++; return new Promise(() => {}); },
    dispose: () => { disposals++; return new Promise(() => {}); } };
  const page = { async waitForFunction() { return handle; } };
  await assert.rejects(wait(page, () => true, undefined, { timeout: 20, label: "retained reply" }, value => value.jsonValue()),
    /retained reply result exceeded 20ms watchdog/);
  assert.equal(reads, 1); assert.equal(disposals, 1);
  assert.match(cleanupErrors[0].message, /retained reply handle dispose exceeded 20ms watchdog/);
  const healthy = { async waitForFunction() { return { jsonValue: async () => ({ queued: 1 }), dispose: async () => { disposals++; } }; } };
  assert.deepEqual(await wait(healthy, () => true, undefined, { timeout: 20, label: "retained reply" }, value => value.jsonValue()), { queued: 1 });
  assert.equal(disposals, 2);
});

test("runtime and held predicate waits all use the Node watchdog and handle disposal boundary", async () => {
  const source = await readFile(new URL("../tools/profile_tno_raster_scene.mjs", import.meta.url), "utf8");
  assert.equal([...source.matchAll(/\bpage\.waitForFunction\(/g)].length, 1, "only the bounded helper may directly issue a predicate wait");
  assert.match(source, /waitRasterStartup\(\{ waitForFunction: \(predicate, arg, options\) => waitForPageCondition\(page, predicate, arg,/);
  for (const label of ["fresh runtime startup", "retained fill history commit", "retained undo history commit", "retained redo history commit", "retained preparation reply"]) {
    assert.ok(source.includes(`label: "${label}"`), `${label} must retain a specific failure label`);
  }
});

test("measurement cleanup cannot overwrite the original action failure", async () => {
  const actionFailure = new Error("mouse.move watchdog"), cleanupFailure = new Error("cleanup target closed"), captured = [];
  await assert.rejects(preserveActionError(() => { throw actionFailure; }, () => { throw cleanupFailure; }, error => captured.push(error)),
    error => error === actionFailure);
  assert.deepEqual(captured, [cleanupFailure]);
  await assert.rejects(preserveActionError(() => 42, () => { throw cleanupFailure; }), error => error === cleanupFailure);
  assert.equal(await preserveActionError(() => 42, () => {}), 42);
});

function diagnosticHarness({ pageSend = () => {}, browserSend = () => {}, traceTimeoutMs, traceOnly = false, trigger } = {}) {
  const commands = [], written = new Map(), report = { stage: "zoom-held-100", passed: false, error: "original settlement watchdog" };
  const cpu = { nodes: [], startTime: 1, endTime: 2 };
  const chunks = [{ data: Buffer.from('{"traceEvents":[').toString("base64"), base64Encoded: true },
    { data: "]}", eof: true }];
  class Cdp extends EventEmitter {
    constructor(target) { super(); this.target = target; }
    async send(method, params) {
      commands.push([this.target, method, params]);
      const override = await (this.target === "page" ? pageSend : browserSend)(method, params, this);
      if (override !== undefined) return override;
      if (method === "Tracing.end") this.emit("Tracing.tracingComplete", { stream: "browser-stream", dataLossOccurred: false });
      if (method === "IO.read") return chunks.shift();
      if (method === "Performance.getMetrics") return { metrics: [{ name: "Timestamp", value: 100 }, { name: "NavigationStart", value: 90 }] };
      if (method === "Profiler.stop") return { profile: cpu };
      if (method === "Debugger.pause") this.emit("Debugger.paused", { reason: "other", callFrames: [{
        functionName: "stalledCanvasCall", url: "http://localhost/js/core/map_renderer.js",
        location: { scriptId: "7", lineNumber: 42, columnNumber: 3 }, scopeChain: [{ secretObject: true }],
      }] });
      if (method === "Debugger.resume") this.emit("Debugger.resumed");
      return {};
    }
    async detach() { commands.push([this.target, "detach"]); }
  }
  const browserCdp = new Cdp("browser"), pageCdp = new Cdp("page");
  const session = { browser: { async newBrowserCDPSession() { return browserCdp; } },
    context: { async newCDPSession() { return pageCdp; } }, page: {} };
  const files = { async writeFile(file, data) { written.set(file, Buffer.from(data)); },
    async open(file) {
      written.set(file, Buffer.alloc(0));
      return { async writeFile(data) { written.set(file, Buffer.concat([written.get(file), data])); },
        async close() { commands.push(["file", "close"]); } };
    } };
  const start = () => startDiagnosticTrace(session, { output: ".runtime/diagnostic-test", prefix: "held", report, files, timeoutMs: 25, traceTimeoutMs, traceOnly, trigger });
  const artifact = extension => [...written].find(([file]) => file.endsWith(extension))?.[1];
  return { start, report, commands, artifact, pageCdp, browserCdp };
}

test("diagnostic tracing is an explicit boolean opt-in alongside unchanged value flags", () => {
  const args = ["--base-url", "http://localhost:8000", "--phase", "zoom-retained", "--dpr", "2"];
  const normal = parseProfileArguments(args);
  assert.equal(normal.has("--diagnostic-trace"), false);
  const enabled = parseProfileArguments(["--diagnostic-trace", ...args, "--output", ".runtime/diagnostic"]);
  assert.equal(enabled.get("--diagnostic-trace"), true);
  for (const flag of ["--base-url", "--phase", "--dpr"]) assert.equal(enabled.get(flag), normal.get(flag));
  assert.throws(() => parseProfileArguments(["--diagnostic-trace", "false"]), /Invalid profiler argument/);
  assert.throws(() => parseProfileArguments(["--phase", "--diagnostic-trace"]), /Invalid profiler argument/);
  const light = parseProfileArguments([...args, "--diagnostic-trace-only"]);
  assert.equal(light.get("--diagnostic-trace-only"), true);
  assert.equal(light.has("--diagnostic-trace"), false);
  assert.throws(() => parseProfileArguments(["--diagnostic-trace", "--diagnostic-trace-only"]), /only one diagnostic/);
  assert.equal(parseProfileArguments([...args, "--diagnostic-on-failure"]).get("--diagnostic-on-failure"), true);
  for (const flag of ["--diagnostic-trace", "--diagnostic-trace-only"]) {
    assert.throws(() => parseProfileArguments([flag, "--diagnostic-on-failure"]), /only one diagnostic/);
  }
  assert.throws(() => parseProfileArguments(["--diagnostic-on-failure", "false"]), /Invalid profiler argument/);
  const native = parseProfileArguments(["--diagnostic-native-breadcrumbs", "--diagnostic-on-failure"]);
  assert.equal(native.get("--diagnostic-native-breadcrumbs"), true);
  assert.equal(native.get("--diagnostic-on-failure"), true);
  assert.throws(() => parseProfileArguments(["--diagnostic-native-breadcrumbs", "false"]), /Invalid profiler argument/);
});

test("failure-only harness starts CDP only after failure, with native breadcrumbs independently opt-in", async () => {
  // Execute the real runner with its browser/application dependencies replaced,
  // rather than launching a browser or relying on a source-order assertion.
  for (const { failed, nativeEnabled } of [false, true].flatMap(nativeEnabled => [false, true].map(failed => ({ failed, nativeEnabled })))) {
    const calls = [], failure = new Error("settlement watchdog"), noop = async () => {};
    let collectorStarts = 0, collectorCloses = 0;
    const page = { setDefaultTimeout() {}, on() {}, url: () => "http://localhost/", isClosed: () => false,
      locator: () => ({ click: noop }), screenshot: async () => { calls.push("screenshot"); },
      addInitScript() { assert.fail("failure-only mode must not install a Worker hook"); },
      evaluate() { assert.fail("failure-only mode must not evaluate a Worker hook"); } };
    const session = { page, errors: [], warnings: [], network: [],
      context: { on() {}, newCDPSession() { assert.fail("no page CDP during interaction"); } },
      browser: { on() {}, version: () => "fixture", isConnected: () => true, close: noop,
        newBrowserCDPSession() { assert.fail("no browser CDP during interaction"); } } };
    let complete;
    const dependencies = { assert, fs: { mkdir: noop }, path: { resolve: value => value, join: (...values) => values.join("/") },
      SCENARIO: "tno_1962", VIEWPORT: {}, reportIo: new WeakMap(), pageReports: new WeakMap(),
      IO_BOUND_MS: 100, CLEANUP_BOUND_MS: 100, ACTION_BOUND_MS: 100,
      stage: async (report, name) => { report.stage = name; }, checkpoint: noop,
      openRasterApp: async (_url, options) => {
        assert.deepEqual(options.initScripts, nativeEnabled ? [{ content: "native fixture" }] : undefined);
        return session;
      },
      startNativeBreadcrumbCollector: async () => {
        collectorStarts++;
        return { endpoint: "http://127.0.0.1:123/token", snapshot: () => ({ enabled: true }),
          close: async () => { collectorCloses++; return { enabled: true }; } };
      },
      nativeBreadcrumbInitScript: endpoint => { assert.equal(endpoint, "http://127.0.0.1:123/token"); return { content: "native fixture" }; },
      evaluate: async () => ({ dpr: 1 }), settle: async () => ({}),
      assertVisibleScene() {}, dismissGuide: noop, fill: async () => ({}),
      lifecycle: async () => { calls.push("interaction"); if (failed) throw failure; },
      snapshot: async () => { calls.push("snapshot"); return {}; }, withDeadline,
      startDiagnosticTrace: async (actualSession, options) => {
        assert.equal(actualSession, session);
        assert.ok(options.report.error.includes(failure.message), "original failure must already be recorded");
        assert.equal(options.trigger, "failure");
        assert.equal(calls.at(-1), "external-observer");
        calls.push("diagnostic-start");
        options.report.diagnosticTrace = { trigger: options.trigger };
        return { finish({ failed: captureFailed }) {
          assert.equal(captureFailed, true);
          if (!complete) { calls.push("diagnostic-finish"); complete = Promise.resolve(); }
          return complete;
        } };
      }, console: { log() {} } };
    const run = new Function(...Object.keys(dependencies), `return (${profileTnoScene.toString()});`)(...Object.values(dependencies));
    const report = await run("http://localhost/", { phase: "lifecycle", diagnosticOnFailure: true, diagnosticNativeBreadcrumbs: nativeEnabled,
      onFailure: async ({ session: actualSession, report: actualReport }) => {
        assert.equal(actualSession, session); assert.ok(actualReport.error.includes(failure.message));
        calls.push("external-observer"); throw new Error("external observer failed");
      } });
    assert.equal(report.passed, !failed);
    assert.equal(collectorStarts, Number(nativeEnabled)); assert.equal(collectorCloses, Number(nativeEnabled));
    if (failed) {
      assert.deepEqual(calls.slice(0, 5), ["interaction", "external-observer", "diagnostic-start", "diagnostic-finish", "snapshot"]);
      assert.equal(calls.filter(call => call === "diagnostic-start").length, 1);
      assert.equal(calls.filter(call => call === "diagnostic-finish").length, 1);
      assert.ok(report.error.includes(failure.message));
      assert.equal(report.performanceBaselineEligible, false);
      assert.match(report.externalFailureObserverError, /external observer failed/);
    } else {
      assert.deepEqual(calls, ["interaction", "snapshot"]);
      assert.equal(report.diagnosticTrace, undefined);
      assert.equal(report.performanceBaselineEligible, nativeEnabled ? false : undefined);
    }
  }
});

test("failure-triggered capture labels its limited window and still pauses after a Debugger enable timeout", async () => {
  const f = diagnosticHarness({ trigger: "failure", pageSend: method => method === "Debugger.enable" ? new Promise(() => {}) : undefined });
  const diagnostic = await f.start();
  const result = await diagnostic.finish({ failed: true });
  assert.equal(result.trigger, "failure");
  assert.match(result.coverageWindow, /only activity after the failure watchdog.*does not contain the history/);
  assert.match(result.traceCoverage, /^POST-FAILURE WINDOW ONLY:/);
  assert.ok(result.startedAt);
  assert.ok(result.errors.some(error => error.error.includes("Debugger.enable exceeded 25ms watchdog")));
  assert.ok(f.commands.some(([, method]) => method === "Debugger.pause"));
  assert.equal(result.paused.length, 1);
  assert.equal(result.traceComplete, true);
  assert.equal(f.commands.some(([, method]) => method.startsWith("Profiler.")), false, "an unstarted profiler is never stopped");
  const saved = JSON.parse(f.artifact(".cdp.json").toString());
  assert.equal(saved.trigger, "failure");
  assert.equal(saved.coverageWindow, result.coverageWindow);
});

test("browser-target trace survives stalled page pause, profiler stop and resume without changing the original failure", async () => {
  const never = () => new Promise(() => {});
  const f = diagnosticHarness({ pageSend: (method, _params, cdp) => {
    if (method === "Debugger.pause") cdp.emit("Debugger.paused", { reason: "other", callFrames: [] });
    return ["Debugger.pause", "Profiler.stop", "Debugger.resume"].includes(method) ? never() : undefined;
  } });
  const diagnostic = await f.start();
  const result = await diagnostic.finish({ failed: true });
  assert.equal(f.report.error, "original settlement watchdog");
  assert.equal(f.report.passed, false);
  assert.equal(result.performanceBaselineEligible, false);
  assert.equal(result.traceComplete, true);
  assert.equal(f.artifact(".trace.json").toString(), '{"traceEvents":[]}');
  assert.equal(result.cpuProfileComplete, false);
  assert.equal(f.artifact(".cpuprofile"), undefined, "a failed stop cannot create a CPU profile");
  for (const operation of ["Debugger.pause", "Profiler.stop", "Debugger.resume"]) {
    assert.ok(result.errors.some(error => error.operation === operation && error.error.includes("watchdog")));
  }
  assert.ok(f.commands.findIndex(([target, method]) => target === "browser" && method === "IO.read")
    < f.commands.findIndex(([, method]) => method === "Profiler.stop"), "browser trace reads must not wait for page recovery");
  assert.equal(f.commands.some(([target, method]) => target === "page" && method.startsWith("Tracing.")), false);
  assert.ok(f.commands.some(([target, method]) => target === "browser" && method === "IO.close"));
  assert.ok(f.artifact(".cdp.json"));
});

test("failed diagnostic captures paused call frames and a successful CPU profile, then resumes and detaches once", async () => {
  const f = diagnosticHarness();
  const diagnostic = await f.start();
  const completion = diagnostic.finish({ failed: true });
  assert.equal(diagnostic.finish({ failed: true }), completion, "catch and finally share one cleanup");
  const result = await completion;
  assert.equal(result.paused.length, 1);
  assert.deepEqual(result.paused[0].callFrames, [{ functionName: "stalledCanvasCall",
    url: "http://localhost/js/core/map_renderer.js", location: { scriptId: "7", lineNumber: 42, columnNumber: 3 }, functionLocation: undefined }]);
  assert.deepEqual(JSON.parse(f.artifact(".cpuprofile").toString()), { nodes: [], startTime: 1, endTime: 2 });
  assert.equal(result.traceComplete, true);
  assert.equal(result.cpuProfileComplete, true);
  assert.deepEqual(result.errors, []);
  for (const target of ["page", "browser"]) assert.equal(f.commands.filter(([name, method]) => name === target && method === "detach").length, 1);
  assert.equal(f.pageCdp.listenerCount("Debugger.paused"), 0);
  assert.equal(f.browserCdp.listenerCount("Tracing.tracingComplete"), 0);
  const config = f.commands.find(([, method]) => method === "Tracing.start")[2];
  assert.equal(config.transferMode, "ReturnAsStream");
  assert.equal(config.traceConfig.traceBufferSizeInKb, 64 * 1024);
  assert.deepEqual(config.traceConfig.includedCategories, ["devtools.timeline", "blink.user_timing", "gpu"]);
  assert.ok(f.commands.some(([, method]) => method === "Profiler.start"), "full diagnostic mode retains the independent CPU profiler");
  assert.deepEqual(result.watchdogs, { commandMs: 25, traceMs: 30000 });
  assert.equal(result.timeAnchor.timestampSeconds, 100);
  assert.equal(result.timeAnchor.navigationStartSeconds, 90);
  assert.ok(result.timeAnchor.nodeBeforeMs <= result.timeAnchor.nodeAfterMs);
  const cpuAnchor = JSON.parse(f.artifact(".cdp.json").toString()).timeAnchor;
  assert.deepEqual(cpuAnchor, result.timeAnchor, "clock alignment evidence must survive outside the renderer");
});

test("trace end and completion tolerate delays beyond command watchdog while each stream read stays bounded", async () => {
  const f = diagnosticHarness({ traceTimeoutMs: 250, browserSend: async (method, _params, cdp) => {
    if (method === "Tracing.end") {
      await new Promise(resolve => setTimeout(resolve, 40));
      setTimeout(() => cdp.emit("Tracing.tracingComplete", { stream: "browser-stream" }), 40);
      return {};
    }
  } });
  const diagnostic = await f.start();
  const result = await diagnostic.finish();
  assert.equal(result.traceComplete, true);
  assert.deepEqual(result.errors, []);
  assert.equal(f.commands.some(([, method]) => method === "Debugger.resume"), false);
});

test("trace-only mode pre-enables Debugger and clock alignment without starting any CPU profiler", async () => {
  const f = diagnosticHarness({ traceOnly: true });
  const diagnostic = await f.start();
  const result = await diagnostic.finish({ failed: true });
  assert.equal(result.mode, "trace-only");
  assert.equal(result.traceComplete, true);
  assert.equal(result.cpuProfileComplete, false);
  assert.equal(f.artifact(".cpuprofile"), undefined);
  assert.equal(f.commands.some(([, method]) => method.startsWith("Profiler.")), false);
  assert.ok(f.commands.some(([, method]) => method === "Debugger.enable"));
  assert.equal(result.paused.length, 1);
  assert.equal(result.timeAnchor.timestampSeconds, 100);
  assert.deepEqual(result.errors, []);
});

test("a completely written trace with lost events is prominently reported as incomplete evidence", async () => {
  const f = diagnosticHarness({ traceOnly: true, browserSend: (method, _params, cdp) => {
    if (method === "Tracing.end") {
      cdp.emit("Tracing.tracingComplete", { stream: "browser-stream", dataLossOccurred: true });
      return {};
    }
  } });
  const diagnostic = await f.start();
  const result = await diagnostic.finish();
  assert.equal(result.traceComplete, true, "file completion is separate from event coverage");
  assert.equal(result.traceDataLossOccurred, true);
  assert.match(result.traceCoverage, /INCOMPLETE.*missing events/);
  assert.equal(f.report.diagnosticTraceIncomplete, true);
  assert.equal(JSON.parse(f.artifact(".cdp.json").toString()).traceDataLossOccurred, true);
});

test("diagnostic stream timeout preserves partial trace bytes and successful CPU evidence", async () => {
  let reads = 0;
  const f = diagnosticHarness({ browserSend: method => method === "IO.read" && ++reads > 1 ? new Promise(() => {}) : undefined });
  const diagnostic = await f.start();
  f.report.passed = true; delete f.report.error;
  const result = await diagnostic.finish();
  assert.equal(f.report.passed, true, "diagnostic failure must not change application verdict");
  assert.equal(f.commands.some(([, method]) => method === "Debugger.pause"), false, "successful runs never pause the page");
  assert.equal(f.commands.some(([, method]) => method === "Debugger.resume"), false, "an unpaused successful run must not resume");
  assert.equal(result.traceComplete, false);
  assert.equal(f.artifact(".trace.json").toString(), '{"traceEvents":[');
  assert.equal(result.cpuProfileComplete, true);
  assert.ok(result.errors.some(error => error.operation === "browser trace finish" && error.error.includes("watchdog")));
  assert.ok(f.commands.some(([target, method]) => target === "browser" && method === "IO.close"));
});

test("page profiler setup failure cannot prevent independent browser trace startup and cleanup", async () => {
  const f = diagnosticHarness({ pageSend: method => { if (method === "Debugger.enable") throw new Error("renderer target unavailable"); } });
  const diagnostic = await f.start();
  const result = await diagnostic.finish({ failed: true });
  assert.equal(result.traceComplete, true);
  assert.equal(result.cpuProfileComplete, false);
  assert.ok(result.errors.some(error => error.operation === "page profiler start" && error.error.includes("renderer target unavailable")));
  assert.equal(f.commands.some(([, method]) => method === "Profiler.stop"), false);
  assert.ok(f.artifact(".cdp.json"));
});

test("a timed-out trace start acknowledgement still ends and retrieves browser-owned tracing", async () => {
  const f = diagnosticHarness({ browserSend: method => method === "Tracing.start" ? new Promise(() => {}) : undefined });
  const diagnostic = await f.start();
  const result = await diagnostic.finish();
  assert.ok(result.errors.some(error => error.operation === "Tracing.start" && error.error.includes("watchdog")));
  assert.equal(result.traceComplete, true);
  assert.ok(f.commands.some(([target, method]) => target === "browser" && method === "Tracing.end"));
  assert.ok(f.artifact(".trace.json"));
  assert.equal(result.cpuProfileComplete, true);
});

test("diagnostic worker marks preserve postMessage arguments, return and exceptions with bounded metadata", () => {
  const calls = [], marks = new Map(), measures = [], nativeError = new Error("native clone failed");
  let clock = 0;
  class Worker {
    postMessage(...args) {
      calls.push([this, args]);
      if (args[0].reject) throw nativeError;
      return "native-return";
    }
  }
  const performance = { now: () => ++clock, mark: name => marks.set(name, clock),
    measure: (name, start) => { assert.ok(marks.has(start)); measures.push(name); },
    clearMarks: name => marks.delete(name), clearMeasures() {} };
  const scope = { Worker };
  const install = () => new Function("globalThis", "performance", `return (${installDiagnosticWorkerPosts.toString()})();`)(scope, performance);
  install();
  const intercepted = Worker.prototype.postMessage;
  install();
  assert.equal(Worker.prototype.postMessage, intercepted, "init installation must be idempotent");
  const worker = new Worker(), transfers = [{}], payload = { type: "BUILD_WATER_BITMAP", taskId: "water:7", packet: { huge: "omitted" } };
  assert.equal(worker.postMessage(payload, transfers), "native-return");
  assert.equal(calls[0][0], worker);
  assert.equal(calls[0][1][0], payload);
  assert.equal(calls[0][1][1], transfers);
  assert.match(measures[0], /tno-worker-post:0:BUILD_WATER_BITMAP:water:7/);
  assert.deepEqual(scope.__tnoWorkerPostDiagnostics.records[0], {
    sequence: 0, type: "BUILD_WATER_BITMAP", taskId: "water:7", startedAt: 1, durationMs: 1,
  });
  assert.throws(() => worker.postMessage({ type: "BAD", reject: true }), error => error === nativeError);
  for (let index = 0; index < 1100; index++) worker.postMessage(payload, transfers);
  assert.equal(scope.__tnoWorkerPostDiagnostics.count, 1102);
  assert.equal(scope.__tnoWorkerPostDiagnostics.records.length, 1024);
  assert.equal(marks.size, 0, "completed marks must not accumulate in the page timeline");
  assert.equal(scope.__tnoWorkerPostDiagnostics.records.some(record => Object.hasOwn(record, "packet")), false);
  performance.mark = () => { throw new Error("observer failed"); };
  assert.equal(worker.postMessage(payload, transfers), "native-return");
  assert.throws(() => worker.postMessage({ reject: true }), error => error === nativeError);
});

test("retained camera feedback cannot pass as a finished or partially published scene", () => {
  const before = activeScene();
  Object.assign(before.diagnostics.scene, { publishedEpoch: 3, publications: 7 });
  const current = activeScene(); current.view = { x: 30, y: 40, k: 2.5 };
  Object.assign(current.diagnostics.scene, { presentationState: "retained", publishedEpoch: 3, publications: 7,
    frames: 4, view: { ...current.view } });
  current.diagnostics.pending = 1;
  assert.doesNotThrow(() => assertRetainedScene(current, before));
  for (const producer of ["waterPreparation", "borderPreparation", "physicalCanvas"]) {
    const independent = structuredClone(current); independent.diagnostics.pending = 0;
    const owner = producer === "physicalCanvas" ? independent.diagnostics.scene : independent.diagnostics;
    owner[producer] = { pending: true };
    assert.doesNotThrow(() => assertRetainedScene(independent, before), `${producer} holds the same complete scene`);
    independent.diagnostics.scene.publications++;
    assert.throws(() => assertRetainedScene(independent, before), /same complete publication/);
  }
  const overview = structuredClone(current); overview.diagnostics.scene.usingOverview = true;
  assert.doesNotThrow(() => assertRetainedScene(overview, before), "a complete overview may follow the camera while primary preparation is pending");
  overview.diagnostics.pending = 0;
  assert.throws(() => assertRetainedScene(overview, before), undefined, "overview does not bypass the unfinished-work requirement");
  for (const change of [s => { s.diagnostics.pending = 0; }, s => { s.diagnostics.scene.publishedEpoch++; },
    s => { s.diagnostics.scene.publications++; }, s => { s.diagnostics.scene.frames = 2; },
    s => { s.diagnostics.scene.view.k = 1; }, s => { s.diagnostics.scene.presentationState = "published"; },
    s => { s.canvas.visible = false; }]) {
    const changed = structuredClone(current); change(changed);
    assert.throws(() => assertRetainedScene(changed, before));
  }
});

test("zoom measurement distinguishes first camera feedback, final readiness and stalls", () => {
  const sample = { inputToObservedFeedbackMs: 20, inputToObservedReadyMs: 500, maxRafIntervalMs: 230, maxLongTaskMs: 190 };
  assert.doesNotThrow(() => assertZoomFeedback(sample));
  for (const changed of [{ inputToObservedFeedbackMs: null }, { inputToObservedFeedbackMs: -1 },
    { inputToObservedFeedbackMs: 501 }, { maxRafIntervalMs: NaN }, { maxLongTaskMs: undefined }]) {
    assert.throws(() => assertZoomFeedback({ ...sample, ...changed }));
  }
});

function tinyPaintRoi() {
  const baseline = { x: 10, y: 20, width: 3, height: 3, rgba: Array.from({ length: 9 }, () => [80, 90, 100, 255]).flat() };
  const painted = structuredClone(baseline), target = [212, 108, 23], alpha = 0.2;
  // Only one screenshot pixel is affected by the tiny polygon. Its composite
  // is visibly orange, while none of its channels equals the opaque paint.
  for (let channel = 0; channel < 3; channel++) painted.rgba[16 + channel] = Math.round(baseline.rgba[16 + channel] * (1 - alpha) + target[channel] * alpha);
  return { baseline, painted };
}

test("local screenshot comparison accepts a tiny antialiased polygon without requiring opaque paint pixels", () => {
  const { baseline, painted } = tinyPaintRoi();
  const evidence = assertRoiMovedTowardColor(baseline, painted, "#d46c17");
  assert.equal(evidence.towardTargetPixels, 1);
  assert.ok(evidence.witness.change >= 8 && evidence.witness.improvement >= 8);
  assert.ok(evidence.witness.alpha > 0 && evidence.witness.alpha < 1);
  assert.deepEqual(assertRoiRestored(baseline, baseline, "undo"), { maxChannelDelta: 0 });
  assert.deepEqual(assertRoiRestored(painted, painted, "redo"), { maxChannelDelta: 0 });
});

test("local paint evidence rejects no change, insignificant movement and a wrong color", () => {
  const { baseline, painted } = tinyPaintRoi();
  assert.throws(() => assertRoiMovedTowardColor(baseline, baseline, "#d46c17"));
  const insignificant = structuredClone(baseline); insignificant.rgba[16] += 4;
  assert.throws(() => assertRoiMovedTowardColor(baseline, insignificant, "#d46c17"));
  const wrong = structuredClone(painted); wrong.rgba.splice(16, 3, 80, 180, 100);
  assert.throws(() => assertRoiMovedTowardColor(baseline, wrong, "#d46c17"));
  // This wrong hue is closer to the target overall, but does not fit blending
  // that color over baseline. Distance improvement alone must not pass it.
  const closerWrong = structuredClone(baseline); closerWrong.rgba.splice(16, 3, 150, 145, 80);
  assert.throws(() => assertRoiMovedTowardColor(baseline, closerWrong, "#d46c17"));
});

test("undo and redo must restore their whole local reference within three channel values", () => {
  const { baseline, painted } = tinyPaintRoi();
  assert.throws(() => assertRoiRestored(baseline, painted, "undo"));
  assert.throws(() => assertRoiRestored(painted, baseline, "redo"));
  const rounding = structuredClone(baseline); rounding.rgba[0] += 3;
  assert.deepEqual(assertRoiRestored(baseline, rounding), { maxChannelDelta: 3 });
  rounding.rgba[0]++;
  assert.throws(() => assertRoiRestored(baseline, rounding));
  assert.throws(() => assertRoiMovedTowardColor(baseline, { ...painted, x: 11 }, "#d46c17"), /ROI x/);
});

test("post-timing render attribution excludes stale entries and bounds the largest recorded durations", () => {
  const timeOrigin = 1792298500000, inputAt = 50000, inputEpochAt = timeOrigin + inputAt;
  const metrics = Object.fromEntries(Array.from({ length: 15 }, (_, i) => ["pass" + i,
    { durationMs: i * 10, sequence: i, recordedAt: inputEpochAt + i, details: { omitted: true } }]));
  Object.assign(metrics, { stale: { durationMs: 9999, recordedAt: inputEpochAt - 5000 }, missingTime: { durationMs: 8888 },
    invalid: { durationMs: NaN, recordedAt: inputEpochAt + 20 } });
  const summary = captureRenderMetricDurations({ metrics, sinceEpoch: inputEpochAt });
  assert.equal(summary.length, 10);
  assert.deepEqual(summary[0], { name: "pass14", durationMs: 140, sequence: 14, recordedAt: inputEpochAt + 14 });
  assert.equal(summary.at(-1).name, "pass5");
  assert.deepEqual(captureRenderMetricDurations({ metrics, sinceEpoch: inputEpochAt + 100 }), []);
});

test("render attribution preserves water path and derived-state scalar breakdowns without nested payloads", () => {
  const metrics = {
    drawScenarioWaterFillLayer: { durationMs: 659, recordedAt: 100, pathBuildMs: 630, buildCount: 12,
      renderedCount: 42, reason: "zoom", maskOnly: false, nested: { geometry: [] }, invalid: NaN },
    rebuildPoliticalLandCollectionsBreakdown: { durationMs: 400, recordedAt: 101, composeMs: 200, interactiveMs: 90 },
    politicalDerivedStateBreakdown: { durationMs: 300, recordedAt: 102, primaryIndexMs: 100, spatialAndCommitMs: 120, incremental: true },
  };
  const result = captureRenderMetricDurations({ metrics, sinceEpoch: 100 });
  assert.deepEqual(result[0].details, { pathBuildMs: 630, buildCount: 12, renderedCount: 42, reason: "zoom", maskOnly: false });
  assert.deepEqual(result[1].details, { composeMs: 200, interactiveMs: 90 });
  assert.deepEqual(result[2].details, { primaryIndexMs: 100, spatialAndCommitMs: 120, incremental: true });
});

test("render attribution excludes records after the measured ready endpoint on the same epoch clock", () => {
  const sample = { inputAt: 42080.3, inputEpochAt: 1792300978141.3, observedReadyAt: 50929 };
  const untilEpoch = sample.inputEpochAt - sample.inputAt + sample.observedReadyAt;
  const metrics = {
    beforeInput: { durationMs: 9999, recordedAt: sample.inputEpochAt - 1 },
    atInput: { durationMs: 10, recordedAt: sample.inputEpochAt },
    inside: { durationMs: 20, recordedAt: sample.inputEpochAt + 100 },
    atReady: { durationMs: 30, recordedAt: untilEpoch },
    laterLabel: { durationMs: 8888, recordedAt: untilEpoch + 400 },
  };
  const result = captureRenderMetricDurations({ metrics, sinceEpoch: sample.inputEpochAt, untilEpoch });
  assert.deepEqual(result.map(metric => metric.name), ["atReady", "inside", "atInput"]);
});

test("console quality summaries omit ROI bytes without mutating the saved evidence", () => {
  const { baseline } = tinyPaintRoi();
  const quality = { label: "paint", targetPaintPixels: 0, roi: baseline };
  assert.deepEqual(summarizeQualityPixels(quality), { label: "paint", targetPaintPixels: 0,
    roi: { x: 10, y: 20, width: 3, height: 3 } });
  assert.equal(quality.roi.rgba.length, 36, "the report retains complete pixel evidence");
});

test("completed normal navigation remains reportable when a later held stage fails", () => {
  const report = { passed: false, stage: "zoom-held-130", navigation: [{ zoom: 130,
    sample: { inputToObservedFeedbackMs: 117.9, inputToObservedReadyMs: 5058.1, maxRafIntervalMs: 374.9, maxLongTaskMs: 124 },
    renderMetrics: [{ name: "drawContextBasePass", durationMs: 100 }] }] };
  assert.deepEqual(report.navigation.map(summarizeZoomNavigation), [{ zoom: 130, inputToObservedFeedbackMs: 117.9,
    inputToObservedReadyMs: 5058.1, maxRafIntervalMs: 374.9, maxLongTaskMs: 124,
    renderMetrics: [{ name: "drawContextBasePass", durationMs: 100 }] }]);
});

async function zoomStabilityHarness({ invalidSample = 0 } = {}) {
  const calls = [], samples = [], summaries = [], noop = async () => {};
  let percent = 100, pendingPercent, closed = 0, filled = false;
  const page = { setDefaultTimeout() {}, on() {}, url: () => "http://localhost/", isClosed: () => false,
    locator: selector => selector === "#zoomPercentInput" ? {
      fill: async value => { pendingPercent = Number.parseFloat(value); calls.push(["zoom-fill", value]); },
      press: async key => { assert.equal(key, "Enter"); percent = pendingPercent; calls.push(["zoom-enter", percent]); },
    } : { click: noop }, screenshot: async () => { calls.push(["failure-screenshot"]); } };
  const session = { page, errors: [], warnings: [], network: [], context: { on() {} },
    browser: { on() {}, version: () => "fixture", isConnected: () => true, close: async () => { closed++; } } };
  const settle = async () => ({ view: { x: 0, y: 0, k: percent / 100 }, diagnostics: { actualBackend: "raster" } });
  const evaluate = async (_page, fn, arg) => fn === captureRenderMetricDurations
    ? [{ name: "measured-pass", durationMs: 50, recordedAt: arg.sinceEpoch }]
    : { dpr: 1, readiness: { ready: true } };
  // Execute the existing zoom body, including its real locator input, measured
  // feedbackZoom boundary, exact-transform oracle and post-window attribution.
  const source = await readFile(new URL("../tools/profile_tno_raster_scene.mjs", import.meta.url), "utf8");
  const start = source.indexOf("async function zoom("), end = source.indexOf("async function drag(", start);
  assert.ok(start >= 0 && end > start);
  const measured = async (actualPage, action, options) => {
    assert.equal(actualPage, page); assert.equal(filled, true, "timing follows real-fill setup");
    const sample = { inputToObservedFeedbackMs: 20, inputToObservedReadyMs: 500 + samples.length,
      inputAt: 10, inputEpochAt: 1000, observedReadyAt: 510 + samples.length,
      maxRafIntervalMs: 230, maxLongTaskMs: 190, frames: [16, 230], longTasks: [{ start: 11, duration: 190 }] };
    if (samples.length + 1 === invalidSample) sample.inputToObservedFeedbackMs = null;
    calls.push(["measurement", options]); samples.push(sample); await action(); return sample;
  };
  const zoom = new Function("assert", "measured", "settle", "evaluate", "captureRenderMetricDurations",
    `${source.slice(start, end)} return zoom;`)(assert, measured, settle, evaluate, captureRenderMetricDurations);
  const stage = async (report, name) => { report.stage = name; calls.push(["stage", name]); };
  const console = { log: value => { const entry = JSON.parse(value); if (entry.tnoSceneNavigation) summaries.push(entry.tnoSceneNavigation); } };
  const runStability = new Function("stage", "zoom", "assertZoomFeedback", "checkpoint", "console", "summarizeZoomNavigation",
    `return (${zoomStability.toString()});`)(stage, zoom, assertZoomFeedback, noop, console, summarizeZoomNavigation);
  const dependencies = { assert, fs: { mkdir: noop }, path: { resolve: value => value, join: (...values) => values.join("/") },
    SCENARIO: "tno_1962", VIEWPORT: {}, reportIo: new WeakMap(), pageReports: new WeakMap(),
    IO_BOUND_MS: 100, CLEANUP_BOUND_MS: 100, ACTION_BOUND_MS: 100, stage, checkpoint: noop,
    openRasterApp: async (_url, options) => {
      assert.equal(options.scenarioId, "tno_1962"); assert.equal(options.enabled, null);
      calls.push(["open-default-session"]); return session;
    }, evaluate, settle, assertVisibleScene() {}, dismissGuide: noop, zoom,
    fill: async (_page, color, options) => { assert.equal(percent, 100); assert.equal(options.timed, false);
      calls.push(["real-fill", color]); filled = true; return { color }; },
    zoomStability: runStability, snapshot: settle, withDeadline, console };
  const run = new Function(...Object.keys(dependencies), `return (${profileTnoScene.toString()});`)(...Object.values(dependencies));
  const report = await run("http://localhost/", { phase: "zoom-stability" });
  return { report, calls, samples, summaries, closed };
}

test("zoom stability runs three ordered rounds through the existing input, measurement and strict oracle", async () => {
  const f = await zoomStabilityHarness();
  assert.equal(f.report.passed, true); assert.equal(f.closed, 1);
  assert.deepEqual(f.calls.filter(([name]) => name === "zoom-enter").map(([, value]) => value),
    [100, 130, 250, 100, 130, 250, 100, 130, 250, 100]);
  assert.ok(f.calls.findIndex(([name]) => name === "zoom-enter") < f.calls.findIndex(([name]) => name === "real-fill"));
  assert.deepEqual(f.calls.filter(([name]) => name === "measurement").map(([, options]) => options),
    [130, 250, 100, 130, 250, 100, 130, 250, 100].map(feedbackZoom => ({ feedbackZoom })));
  assert.equal(f.report.zoomStability.roundCount, 3); assert.equal(f.report.navigation.length, 9);
  assert.deepEqual(f.report.navigation.map(n => [n.round, n.sequence, n.roundSequence, n.cacheOrder]),
    Array.from({ length: 9 }, (_, i) => [Math.floor(i / 3) + 1, i + 1, i % 3 + 1, i < 3 ? "first-pass" : "repeat-pass"]));
  for (const [index, navigation] of f.report.navigation.entries()) {
    assert.equal(navigation.sample, f.samples[index], "full samples, RAF intervals and long tasks remain intact");
    assert.deepEqual(f.summaries[index], summarizeZoomNavigation(navigation));
    assert.deepEqual(navigation.renderMetrics, [{ name: "measured-pass", durationMs: 50, recordedAt: 1000 }]);
  }
  assert.equal(f.calls.some(([name]) => name.includes("screenshot")), false);
  assert.equal(f.summaries.length, 9, "first and repeat passes remain separate instead of a pooled percentile");
});

test("zoom stability retains an invalid sample and fails through the existing cleanup path", async () => {
  const f = await zoomStabilityHarness({ invalidSample: 4 });
  assert.equal(f.report.passed, false); assert.equal(f.closed, 1);
  assert.equal(f.report.stage, "zoom-stability-round-2-130");
  assert.match(f.report.error, /zoom must submit visible camera feedback/);
  assert.equal(f.report.navigation.length, 4);
  assert.equal(f.report.navigation.at(-1).sample, f.samples[3]);
  assert.equal(f.report.navigation.at(-1).sample.inputToObservedFeedbackMs, null);
  assert.equal(f.samples.length, 4, "a failed strict oracle cannot be skipped or retried");
  assert.equal(f.calls.filter(([name]) => name === "failure-screenshot").length, 1);
});

test("fill completion cannot reuse an idle frame before its async history transaction commits", () => {
  const state = { historyPast: [], renderPhase: "idle", startupReadonly: false }, scope = { __rasterTask: { state } };
  assert.equal(fillCommitReady(1, scope), false, "an old ready frame is not evidence that the new fill committed");
  state.historyPast.push({ kind: "fill-feature-color" });
  assert.equal(fillCommitReady(1, scope), true);
  state.historyPast.push({ kind: "unexpected-second-step" });
  assert.equal(fillCommitReady(1, scope), false, "one fill must still create exactly one history step");
});

test("preparation fault preserves native requests and releases only uncancelled matching replies once", () => {
  // Worker is an EventTarget, where registration order controls delivery.
  // Register the app consumer immediately after construction and before the
  // first postMessage: attaching the fault at request time is already too late.
  class FakeWorker extends EventTarget {
    sent = []; received = [];
    postMessage(...args) { this.sent.push(args); }
  }
  const scope = { Worker: FakeWorker, MessageEvent }, original = FakeWorker.prototype.postMessage;
  installRasterPreparationHold(scope);
  const worker = new scope.Worker();
  worker.addEventListener("message", event => worker.received.push(event.data));
  const fault = scope.__tnoRasterPreparationHold;
  try {
    fault.arm();
    const packet = { type: "BUILD_POLITICAL_ID_TILE", taskId: "build-1", packet: { value: 1 } }, transfers = [new ArrayBuffer(4)];
    worker.postMessage(packet, transfers);
    assert.equal(worker.sent[0][0], packet); assert.equal(worker.sent[0][1], transfers, "native transfer arguments must remain untouched");
    const result = { type: "RESULT", taskId: "build-1", tile: { codes: new Uint32Array([3]) } };
    worker.dispatchEvent(new MessageEvent("message", { data: result }));
    assert.equal(worker.received.length, 0); assert.equal(fault.stats().queued, 1);
    worker.postMessage({ type: "UNRELATED_GEOMETRY", taskId: "native" });
    worker.dispatchEvent(new MessageEvent("message", { data: { type: "RESULT", taskId: "native" } }));
    assert.equal(worker.received.length, 1, "unrelated worker traffic must remain live");
    worker.postMessage({ type: "LOAD_POLITICAL_ID_ASSET", taskId: "asset-cancelled" });
    worker.dispatchEvent(new MessageEvent("message", { data: { type: "RESULT", taskId: "asset-cancelled" } }));
    worker.postMessage({ type: "CANCEL_TASK", taskId: "asset-cancelled" });
    assert.equal(fault.stats().cancelled, 1); assert.equal(fault.stats().queued, 1);
    worker.postMessage({ type: "CANCEL_TASK", taskId: "build-1" });
    assert.equal(fault.stats().queued, 0);
    assert.equal(fault.stats().active, true);
    assert.equal(fault.stats().released, 0, "cancelling a held reply is not releasing it to the owner");
    assert.equal(preparationHeldEvidence(scope), false, "an empty cancellation window must wait for another real reply");
    worker.postMessage({ type: "BUILD_POLITICAL_ID_TILE", taskId: "recovery-1" });
    assert.equal(fault.stats().inFlight, 1);
    assert.equal(preparationHeldEvidence(scope), false, "an in-flight task alone is insufficient held-reply evidence");
    const recovery = { type: "RESULT", taskId: "recovery-1", tile: { codes: new Uint32Array([4]) } };
    worker.dispatchEvent(new MessageEvent("message", { data: recovery }));
    assert.equal(worker.received.length, 1);
    assert.equal(preparationHeldEvidence(scope).queued, 1, "the recovery reply reestablishes a strict unreleased hold");
    fault.release(); fault.release();
    assert.equal(worker.received.length, 2); assert.equal(worker.received[1], recovery, "release must deliver the actual unmodified reply");
    assert.equal(fault.stats().released, 1);
    assert.equal(preparationHeldEvidence(scope), false, "released replies cannot satisfy the hold oracle");
    assert.equal(fault.stats().queued, 0);
    fault.arm();
    assert.equal(fault.stats().released, 0); assert.equal(fault.stats().intercepted, 0);
    assert.equal(preparationHeldEvidence(scope), false, "a new cycle cannot reuse previous intercepted evidence");
  } finally { fault.dispose(); }
  assert.equal(FakeWorker.prototype.postMessage, original);
  assert.equal(scope.Worker, FakeWorker, "cleanup must restore the native constructor");
  worker.dispatchEvent(new MessageEvent("message", { data: { type: "RESULT", taskId: "after-cleanup" } }));
  assert.equal(worker.received.at(-1).taskId, "after-cleanup");
});


test("label preflight prepares the current source and view privately and cancels inactive work", async () => {
  const source = await readFile(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
  const start = source.indexOf("function prepareCountryLabelsPass()");
  const end = source.indexOf("function drawLabelsPass(", start);
  assert.ok(start >= 0 && end > start);
  let selected = true, active = true, cancelled = 0, status = "pending", owners = 0, prepared = [];
  const state = { zoomTransform: { k: 2.5 }, styleConfig: {} }, pending = Promise.resolve();
  const render = { cancelPreparation() { cancelled++; }, prepareCurrentView(k) { prepared.push(k); return pending; } };
  const create = new Function("runtimeState", "exportRenderInProgress", "isTnoRasterSceneSelected",
    "tnoRasterSceneOwner", "countryLabelRenderOwner", "getCountryLabelSourceOwner", "getCountryLabelRenderOwner",
    `${source.slice(start, end)} return prepareCountryLabelsPass;`);
  const make = (exporting = false) => create(state, exporting, () => selected, { isActive: () => active }, render,
    () => { owners++; return { getSource: () => ({ status }), prepare: () => pending }; }, () => render);
  const prepare = make();
  assert.equal(prepare(), pending); assert.deepEqual(prepared, []);
  status = "ready";
  assert.equal(prepare(), pending); assert.deepEqual(prepared, [2.5]);
  status = "error"; assert.equal(prepare(), null);
  const before = owners;
  selected = false; assert.equal(prepare(), null); selected = true;
  active = false; assert.equal(prepare(), null); active = true;
  state.isInteracting = true; assert.equal(prepare(), null); state.isInteracting = false;
  state.styleConfig.countryLabels = { enabled: false }; assert.equal(prepare(), null);
  state.styleConfig.countryLabels.enabled = true; assert.equal(make(true)(), null);
  assert.equal(owners, before, "inactive and export paths cannot create producers");
  assert.equal(cancelled, 5, "inactive paths settle an existing private wait immediately");
});

async function createCityPassPreflightHarness() {
  const source = await readFile(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
  const start = source.indexOf("let cityPointsPreparationPromise = null;");
  const end = source.indexOf("function drawLabelsPass(", start);
  assert.ok(start >= 0 && end > start);
  const h = { state: { zoomTransform: { k: 2.5 }, styleConfig: {} }, cancelled: 0,
    cityPending: null, countryPending: null, events: [], notifications: [], options: null };
  const city = {
    cancelPreparation() { h.cancelled++; },
    prepareCurrentView(k, options) {
      h.events.push(["city", k]);
      h.options = options;
      return h.cityPending;
    },
  };
  const country = { cancelPreparation() {}, prepareCurrentView(k) { h.events.push(["country", k]); return h.countryPending; } };
  const create = new Function("runtimeState", "exportRenderInProgress", "isTnoRasterSceneSelected", "tnoRasterSceneOwner",
    "cityPointsRenderOwner", "getCityPointsRenderOwner", "requestRendererRender", "countryLabelRenderOwner",
    "getCountryLabelSourceOwner", "getCountryLabelRenderOwner",
    `${source.slice(start, end)} return { prepareCityPointsPass, prepareLabelsPass };`);
  h.api = create(h.state, false, () => true, { isActive: () => true }, city, () => city,
    (reason, options) => h.notifications.push({ reason, options }), country,
    () => ({ getSource: () => ({ status: "ready" }) }), () => country);
  return h;
}

test("city pass preflight wakes once per ready job and leaves cancelled preparation quiet", async () => {
  const h = await createCityPassPreflightHarness();
  let finish;
  h.cityPending = new Promise((resolve) => { finish = resolve; });
  assert.equal(h.api.prepareCityPointsPass(), h.cityPending);
  assert.equal(h.api.prepareCityPointsPass(), h.cityPending);
  assert.equal(h.api.prepareCityPointsPass(), h.cityPending);
  assert.deepEqual(h.notifications, []);
  finish(true);
  await h.cityPending;
  await Promise.resolve();
  assert.deepEqual(h.notifications, [{ reason: "city-plan-prepared", options: { flush: false } }],
    "marker-only preflight has its own completion wakeup and repeated callers share it");
  h.cityPending = new Promise((resolve) => { finish = resolve; });
  h.api.prepareCityPointsPass();
  h.api.prepareCityPointsPass();
  assert.equal(h.options.isCurrent(), true);
  h.state.isInteracting = true;
  assert.equal(h.options.isCurrent(), false, "an already yielded job cancels before its next helper call");
  assert.equal(h.api.prepareCityPointsPass(), null);
  assert.equal(h.cancelled, 1);
  finish(false);
  await h.cityPending;
  await Promise.resolve();
  assert.equal(h.notifications.length, 1, "a cancelled job cannot schedule another render");
});

test("labels preflight starts both private plans and still waits for cities when country names are disabled", async () => {
  const h = await createCityPassPreflightHarness();
  let finishCity, finishCountry, complete = false;
  h.cityPending = new Promise((resolve) => { finishCity = resolve; });
  h.countryPending = new Promise((resolve) => { finishCountry = resolve; });
  const combined = h.api.prepareLabelsPass().then(() => { complete = true; });
  assert.deepEqual(h.events, [["city", 2.5], ["country", 2.5]], "neither producer waits for the other to start");
  finishCity(true);
  await h.cityPending;
  await Promise.resolve();
  assert.equal(complete, false);
  finishCountry();
  await combined;
  assert.equal(complete, true);

  h.state.styleConfig.countryLabels = { enabled: false };
  h.events.length = 0;
  h.cityPending = new Promise((resolve) => { finishCity = resolve; });
  complete = false;
  const citiesOnly = h.api.prepareLabelsPass().then(() => { complete = true; });
  assert.deepEqual(h.events, [["city", 2.5]]);
  await Promise.resolve();
  assert.equal(complete, false, "disabling country names cannot bypass city readiness");
  finishCity(true);
  await citiesOnly;
  assert.equal(complete, true);
});
