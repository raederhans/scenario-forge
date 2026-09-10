import assert from "node:assert/strict";
import test from "node:test";

import { createDrawCanvasOrchestrationOwner } from "../js/core/map_renderer/draw_canvas_orchestration_owner.js";

const CONSTANTS = Object.freeze({
  renderPhaseIdle: "idle",
  renderPhaseInteracting: "interacting",
  renderPhaseSettling: "settling",
});
const SUMMARY_OPTIONS = Object.freeze({ includeSummary: true });

function names(calls) {
  return calls.map((call) => call[0]);
}

function createHarness({
  ready = true,
  phase = "idle",
  deferExact = false,
  firstVisible = false,
  transformed = false,
  lastGood = false,
  baseVisible = false,
  exact = true,
  promoteToPhase = null,
  promoteToDefer = null,
  dirtyFastPasses = "",
  activePassNames = ["background", "political"],
  activeScenarioId = "scenario-a",
  nowValues = [1000, 1042],
  onNow = null,
  onFirstVisible = null,
  onTransformed = null,
  onLastGood = null,
  onEnsureIdleTimings = null,
  prepareAsyncFrame = null,
} = {}) {
  const calls = [];
  let currentPhase = phase;
  let currentDeferExact = deferExact;
  let currentFirstVisible = firstVisible;
  let currentRawTransform = { x: 12, y: 34, k: 2 };
  const effectiveTransform = { x: 90, y: 80, k: 3 };
  const times = [...nowValues];
  let nowCallIndex = 0;
  const mutators = Object.freeze({
    setPhase: (nextPhase) => {
      currentPhase = nextPhase;
    },
    setRawTransform: (nextTransform) => {
      currentRawTransform = nextTransform;
    },
  });
  const effects = {
    ...(prepareAsyncFrame ? { prepareAsyncFrame: () => {
      calls.push(["prepareAsyncFrame"]);
      return prepareAsyncFrame();
    } } : {}),
    ensureLayerDataFromTopology: () => calls.push(["ensureLayerDataFromTopology"]),
    incrementPerfCounter: (name) => calls.push(["incrementPerfCounter", name]),
    clearPoliticalPatchOverlayIfStale: (reason) => calls.push(["clearPoliticalPatchOverlayIfStale", reason]),
    cancelPoliticalPathWarmup: (reason) => calls.push(["cancelPoliticalPathWarmup", reason]),
    promoteDeferredColorRenderToIdle: () => {
      calls.push(["promoteDeferredColorRenderToIdle"]);
      if (promoteToPhase) currentPhase = promoteToPhase;
      if (promoteToDefer !== null) currentDeferExact = promoteToDefer;
      return Boolean(promoteToPhase || promoteToDefer !== null);
    },
    drawTransformedFrameFromCaches: (timings, options) => {
      calls.push(["drawTransformedFrameFromCaches", options]);
      if (dirtyFastPasses) timings.usedDirtyFastFramePasses = dirtyFastPasses;
      if (onTransformed) onTransformed(mutators);
      return transformed;
    },
    drawLastGoodFrameFallback: (transform) => {
      calls.push(["drawLastGoodFrameFallback", transform]);
      if (onLastGood) onLastGood(mutators);
      return lastGood;
    },
    noteMissingVisibleFrameSkippedDuringInteraction: (reason) => calls.push(["noteMissingVisibleFrameSkippedDuringInteraction", reason]),
    drawBaseVisibleFrameFallback: (reason) => {
      calls.push(["drawBaseVisibleFrameFallback", reason]);
      return baseVisible;
    },
    resetContextBreakdownForExactFrame: () => calls.push(["resetContextBreakdownForExactFrame"]),
    ensureIdleRenderPasses: (timings, passNames) => {
      calls.push(["ensureIdleRenderPasses", passNames]);
      timings.idle = 7;
      if (onEnsureIdleTimings) onEnsureIdleTimings(timings);
    },
    composeCachedPasses: (passNames) => {
      calls.push(["composeCachedPasses", passNames]);
      return exact;
    },
    abortPendingExactAfterSettleRefreshAfterPaint: (reason) => calls.push(["abortPendingExactAfterSettleRefreshAfterPaint", reason]),
    commitLastFrame: (payload) => calls.push(["commitLastFrame", payload]),
    markFirstVisibleFramePainted: (reason) => {
      calls.push(["markFirstVisibleFramePainted", reason]);
      if (onFirstVisible) onFirstVisible(mutators);
    },
    captureLastGoodFrame: (reason, transform) => calls.push(["captureLastGoodFrame", reason, transform]),
    recordRenderPerfMetric: (name, duration, metadata) => calls.push(["recordRenderPerfMetric", name, duration, metadata]),
    finalizePendingExactAfterSettleRefreshAfterPaint: () => calls.push(["finalizePendingExactAfterSettleRefreshAfterPaint"]),
  };
  const getters = {
    isFrameSurfaceReady: () => {
      calls.push(["isFrameSurfaceReady"]);
      return ready;
    },
    getRenderPhase: () => {
      calls.push(["getRenderPhase"]);
      return currentPhase;
    },
    getDeferExactAfterSettle: () => {
      calls.push(["getDeferExactAfterSettle"]);
      return currentDeferExact;
    },
    getFirstVisibleFramePainted: () => {
      calls.push(["getFirstVisibleFramePainted"]);
      return currentFirstVisible;
    },
    getEffectiveZoomTransform: () => {
      calls.push(["getEffectiveZoomTransform"]);
      return effectiveTransform;
    },
    getRawZoomTransform: () => {
      calls.push(["getRawZoomTransform"]);
      return currentRawTransform;
    },
    getActiveScenarioId: () => {
      calls.push(["getActiveScenarioId"]);
      return activeScenarioId;
    },
    getActiveRenderPassNames: () => {
      calls.push(["getActiveRenderPassNames"]);
      return activePassNames;
    },
    nowMs: () => {
      calls.push(["nowMs"]);
      const callIndex = nowCallIndex;
      nowCallIndex += 1;
      const value = times.shift() ?? nowValues.at(-1) ?? 0;
      if (onNow) onNow({ callIndex, ...mutators });
      return value;
    },
  };
  const owner = createDrawCanvasOrchestrationOwner({ constants: CONSTANTS, getters, effects });
  return { calls, effectiveTransform, owner, rawTransform: currentRawTransform };
}

test("readiness failure returns before side effects and counters", () => {
  const { calls, owner } = createHarness({ ready: false });
  const summary = owner.drawCanvasFrame(SUMMARY_OPTIONS);

  assert.deepEqual(calls, [["isFrameSurfaceReady"]]);
  assert.equal(summary.status, "skipped-not-ready");
  assert.equal(summary.frameMode, "none");
  assert.equal(summary.drewFrame, false);
});

test("pending async preparation retains existing pixels without composing or committing an exact frame", () => {
  let pending = true;
  const { calls, owner } = createHarness({ firstVisible: true, prepareAsyncFrame: () => pending });
  const waiting = owner.drawCanvasFrame(SUMMARY_OPTIONS);
  assert.equal(waiting.status, "waiting-worker");
  assert.equal(waiting.frameMode, "previous-pixels");
  assert.equal(waiting.drewFrame, false);
  assert.deepEqual(names(calls), ["isFrameSurfaceReady", "ensureLayerDataFromTopology", "prepareAsyncFrame"]);
  pending = false; calls.length = 0;
  const ready = owner.drawCanvasFrame(SUMMARY_OPTIONS);
  assert.equal(ready.frameMode, "exact");
  assert.equal(names(calls).includes("composeCachedPasses"), true);
  assert.equal(names(calls).includes("commitLastFrame"), true);
});

test("exact idle success preserves order and final frames counter", () => {
  const { calls, owner, rawTransform } = createHarness({ phase: "idle", exact: true });
  const summary = owner.drawCanvasFrame(SUMMARY_OPTIONS);

  assert.deepEqual(names(calls), [
    "isFrameSurfaceReady",
    "ensureLayerDataFromTopology",
    "incrementPerfCounter",
    "clearPoliticalPatchOverlayIfStale",
    "getRenderPhase",
    "getDeferExactAfterSettle",
    "promoteDeferredColorRenderToIdle",
    "nowMs",
    "getRenderPhase",
    "getDeferExactAfterSettle",
    "resetContextBreakdownForExactFrame",
    "getActiveRenderPassNames",
    "ensureIdleRenderPasses",
    "composeCachedPasses",
    "getRenderPhase",
    "nowMs",
    "getRawZoomTransform",
    "commitLastFrame",
    "markFirstVisibleFramePainted",
    "getRenderPhase",
    "getRawZoomTransform",
    "captureLastGoodFrame",
    "finalizePendingExactAfterSettleRefreshAfterPaint",
    "incrementPerfCounter",
  ]);
  assert.equal(summary.frameMode, "exact");
  assert.equal(calls[2][1], "drawCanvas");
  assert.deepEqual(calls.find((call) => call[0] === "commitLastFrame")?.[1], {
    phase: "idle",
    totalMs: 42,
    timings: { idle: 7 },
    transform: rawTransform,
  });
  assert.deepEqual(calls.at(-1), ["incrementPerfCounter", "frames"]);
});

test("last-frame commit reads phase before total time before raw transform", () => {
  const afterTotalTransform = { x: 56, y: 78, k: 4 };
  const { calls, owner } = createHarness({
    phase: "idle",
    exact: true,
    onNow: ({ callIndex, setPhase, setRawTransform }) => {
      if (callIndex === 1) {
        setPhase("settling");
        setRawTransform(afterTotalTransform);
      }
    },
  });
  owner.drawCanvasFrame();

  const callNames = names(calls);
  const commitIndex = callNames.indexOf("commitLastFrame");
  assert.deepEqual(callNames.slice(commitIndex - 3, commitIndex + 1), [
    "getRenderPhase",
    "nowMs",
    "getRawZoomTransform",
    "commitLastFrame",
  ]);
  assert.deepEqual(calls[commitIndex][1], {
    phase: "idle",
    totalMs: 42,
    timings: { idle: 7 },
    transform: afterTotalTransform,
  });
});

test("promotion re-reads phase and uses transformed fast frame", () => {
  const { calls, owner, rawTransform } = createHarness({
    phase: "settling",
    deferExact: true,
    promoteToPhase: "idle",
    promoteToDefer: false,
    exact: true,
  });
  const summary = owner.drawCanvasFrame(SUMMARY_OPTIONS);

  assert.equal(summary.frameMode, "exact");
  assert.deepEqual(calls.find((call) => call[0] === "cancelPoliticalPathWarmup"), ["cancelPoliticalPathWarmup", "drawCanvas-non-idle"]);
  assert.equal(calls.some((call) => call[0] === "drawTransformedFrameFromCaches"), false);
  assert.deepEqual(calls.find((call) => call[0] === "captureLastGoodFrame"), ["captureLastGoodFrame", "exact-frame", rawTransform]);
});

test("transformed success marks fast frame and captures clean non-interacting frame", () => {
  const { calls, owner, rawTransform } = createHarness({ phase: "settling", transformed: true });
  const summary = owner.drawCanvasFrame(SUMMARY_OPTIONS);

  assert.equal(summary.frameMode, "fast");
  assert.equal(summary.usedTransformedFrame, true);
  assert.deepEqual(calls.find((call) => call[0] === "markFirstVisibleFramePainted"), ["markFirstVisibleFramePainted", "fast-frame"]);
  assert.deepEqual(calls.find((call) => call[0] === "captureLastGoodFrame"), ["captureLastGoodFrame", "fast-frame", rawTransform]);
  assert.equal(calls.some((call) => call[0] === "resetContextBreakdownForExactFrame"), false);
});

test("first-visible mutation refreshes capture phase and raw transform", () => {
  const afterFirstVisibleTransform = { x: 66, y: 77, k: 8 };
  const { calls, owner } = createHarness({
    phase: "settling",
    transformed: true,
    onFirstVisible: ({ setPhase, setRawTransform }) => {
      setPhase("idle");
      setRawTransform(afterFirstVisibleTransform);
    },
  });
  owner.drawCanvasFrame();

  const callNames = names(calls);
  const markIndex = callNames.indexOf("markFirstVisibleFramePainted");
  assert.deepEqual(callNames.slice(markIndex, markIndex + 4), [
    "markFirstVisibleFramePainted",
    "getRenderPhase",
    "getRawZoomTransform",
    "captureLastGoodFrame",
  ]);
  assert.deepEqual(calls.find((call) => call[0] === "captureLastGoodFrame"), [
    "captureLastGoodFrame",
    "fast-frame",
    afterFirstVisibleTransform,
  ]);
});

test("last-good fallback uses effective transform and first-visible reason", () => {
  const { calls, effectiveTransform, owner } = createHarness({ phase: "settling", lastGood: true });
  const summary = owner.drawCanvasFrame(SUMMARY_OPTIONS);

  assert.equal(summary.frameMode, "last-good");
  assert.deepEqual(calls.find((call) => call[0] === "drawLastGoodFrameFallback"), ["drawLastGoodFrameFallback", effectiveTransform]);
  assert.deepEqual(calls.find((call) => call[0] === "markFirstVisibleFramePainted"), ["markFirstVisibleFramePainted", "last-good-frame"]);
  assert.equal(calls.some((call) => call[0] === "captureLastGoodFrame"), false);
});

test("interacting first-visible failure keeps previous pixels", () => {
  const { calls, owner } = createHarness({ phase: "interacting", firstVisible: true });
  const summary = owner.drawCanvasFrame(SUMMARY_OPTIONS);

  assert.equal(summary.frameMode, "previous-pixels");
  assert.equal(summary.keptPreviousPixels, true);
  assert.deepEqual(calls.find((call) => call[0] === "noteMissingVisibleFrameSkippedDuringInteraction"), [
    "noteMissingVisibleFrameSkippedDuringInteraction",
    "missing-fast-frame-no-continuity",
  ]);
  assert.equal(calls.some((call) => call[0] === "markFirstVisibleFramePainted"), false);
});

test("previous-pixel continuity uses the phase after transformed and last-good effects", () => {
  const { calls, owner } = createHarness({
    phase: "interacting",
    firstVisible: true,
    baseVisible: true,
    onTransformed: ({ setPhase }) => setPhase("idle"),
    onLastGood: ({ setPhase }) => setPhase("settling"),
  });
  const summary = owner.drawCanvasFrame(SUMMARY_OPTIONS);

  assert.equal(summary.frameMode, "base-visible");
  assert.equal(calls.some((call) => call[0] === "noteMissingVisibleFrameSkippedDuringInteraction"), false);
  const lastGoodIndex = names(calls).indexOf("drawLastGoodFrameFallback");
  assert.deepEqual(names(calls).slice(lastGoodIndex, lastGoodIndex + 3), [
    "drawLastGoodFrameFallback",
    "getRenderPhase",
    "drawBaseVisibleFrameFallback",
  ]);
});

test("base visible fallback preserves reason and skips first-visible mark", () => {
  const { calls, owner } = createHarness({ phase: "interacting", baseVisible: true });
  const summary = owner.drawCanvasFrame(SUMMARY_OPTIONS);

  assert.equal(summary.frameMode, "base-visible");
  assert.deepEqual(calls.find((call) => call[0] === "drawBaseVisibleFrameFallback"), [
    "drawBaseVisibleFrameFallback",
    "missing-fast-frame-no-continuity",
  ]);
  assert.equal(calls.some((call) => call[0] === "markFirstVisibleFramePainted"), false);
});

test("failed fast path falls through to exact frame", () => {
  const { calls, owner, rawTransform } = createHarness({ phase: "settling", exact: true });
  const summary = owner.drawCanvasFrame(SUMMARY_OPTIONS);

  assert.equal(summary.frameMode, "exact");
  assert.equal(names(calls).filter((name) => name === "drawTransformedFrameFromCaches").length, 1);
  assert.equal(calls.some((call) => call[0] === "composeCachedPasses"), true);
  assert.deepEqual(calls.find((call) => call[0] === "markFirstVisibleFramePainted"), ["markFirstVisibleFramePainted", "fast-frame"]);
  assert.deepEqual(calls.find((call) => call[0] === "captureLastGoodFrame"), ["captureLastGoodFrame", "fast-frame", rawTransform]);
});

test("exact failure aborts exact-after-settle and skips finalize", () => {
  const { calls, owner } = createHarness({ phase: "idle", exact: false });
  const summary = owner.drawCanvasFrame(SUMMARY_OPTIONS);

  assert.equal(summary.status, "not-drawn");
  assert.deepEqual(calls.find((call) => call[0] === "abortPendingExactAfterSettleRefreshAfterPaint"), [
    "abortPendingExactAfterSettleRefreshAfterPaint",
    "compose-cached-passes-failed",
  ]);
  assert.equal(calls.some((call) => call[0] === "finalizePendingExactAfterSettleRefreshAfterPaint"), false);
});

test("dirty fast frame skips capture and records exact metadata", () => {
  const { calls, owner } = createHarness({
    phase: "settling",
    transformed: true,
    dirtyFastPasses: "political,labels",
    activeScenarioId: "tno_1962",
  });
  const summary = owner.drawCanvasFrame(SUMMARY_OPTIONS);

  assert.equal(summary.skippedCapture, true);
  assert.equal(calls.some((call) => call[0] === "captureLastGoodFrame"), false);
  assert.deepEqual(calls.find((call) => call[0] === "recordRenderPerfMetric"), [
    "recordRenderPerfMetric",
    "lastGoodFrameCaptureSkipped",
    0,
    { reason: "dirty-fast-frame", dirtyPasses: "political,labels", activeScenarioId: "tno_1962", phase: "settling" },
  ]);
});

test("dirty fast frame metric uses phase refreshed after first-visible mutation", () => {
  const { calls, owner } = createHarness({
    phase: "settling",
    transformed: true,
    dirtyFastPasses: "political",
    onFirstVisible: ({ setPhase }) => {
      setPhase("idle");
    },
  });
  owner.drawCanvasFrame();

  assert.equal(calls.some((call) => call[0] === "captureLastGoodFrame"), false);
  assert.deepEqual(calls.find((call) => call[0] === "recordRenderPerfMetric")?.[3], {
    reason: "dirty-fast-frame",
    dirtyPasses: "political",
    activeScenarioId: "scenario-a",
    phase: "idle",
  });
});

test("default production path returns undefined without serializing a summary", () => {
  let summaryTimingReads = 0;
  const { owner } = createHarness({
    phase: "idle",
    exact: true,
    onEnsureIdleTimings: (timings) => {
      Object.defineProperty(timings, "summaryOnly", {
        enumerable: true,
        get() {
          summaryTimingReads += 1;
          return 1;
        },
      });
    },
  });

  assert.equal(owner.drawCanvasFrame(), undefined);
  assert.equal(summaryTimingReads, 0);
});

test("last-frame commit keeps mutable timings while opt-in summary owns a frozen copy", () => {
  const { calls, owner } = createHarness({ phase: "idle", exact: true });
  const summary = owner.drawCanvasFrame(SUMMARY_OPTIONS);
  const committedTimings = calls.find((call) => call[0] === "commitLastFrame")?.[1]?.timings;

  assert.notStrictEqual(committedTimings, summary.timings);
  assert.equal(Object.isFrozen(committedTimings), false);
  assert.equal(Object.isFrozen(summary.timings), true);
  committedTimings.idle = 99;
  assert.equal(summary.timings.idle, 7);
});

test("requires dependencies and returns frozen JSON-safe summary without trace arrays", () => {
  const { owner } = createHarness({ phase: "idle", exact: true });
  assert.throws(
    () => createDrawCanvasOrchestrationOwner({ constants: CONSTANTS, getters: {}, effects: {} }),
    /getters\.isFrameSurfaceReady must be a function/,
  );
  assert.throws(
    () => createDrawCanvasOrchestrationOwner({ constants: { ...CONSTANTS, renderPhaseIdle: "" }, getters: {}, effects: {} }),
    /constants\.renderPhaseIdle must be a non-empty string/,
  );

  const summary = owner.drawCanvasFrame(SUMMARY_OPTIONS);
  assert.equal(Object.isFrozen(summary), true);
  assert.equal(Object.isFrozen(summary.timings), true);
  assert.equal(summary.effectOrder, undefined);
  assert.equal(summary.getterOrder, undefined);
  assert.equal(JSON.stringify(summary).includes("transform"), false);
});
