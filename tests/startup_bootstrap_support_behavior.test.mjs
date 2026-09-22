import assert from "node:assert/strict";
import test from "node:test";

import { initLongAnimationFrameObserver, waitForStartupRenderSettle } from "../js/bootstrap/startup_bootstrap_support.js";
import { state as runtimeState } from "../js/core/state.js";
import {
  setLongAnimationFrameObserver,
} from "../js/core/state/actions/boot_actions.js";
import {
  replaceRenderPerfMetricsState,
} from "../js/core/state/actions/renderer_diagnostics_actions.js";

function restoreGlobalProperty(name, hadProperty, value) {
  if (hadProperty) {
    globalThis[name] = value;
    return;
  }
  delete globalThis[name];
}

test("startup waits for layout interaction to settle without accepting a frame itself", async () => {
  const state = { renderPhase: "interacting", firstVisibleFramePainted: false };
  let frames = 0;
  assert.equal(await waitForStartupRenderSettle(state, {
    now: () => frames * 16,
    waitForFrame: async () => {
      frames += 1;
      state.renderPhase = frames === 1 ? "settling" : "idle";
    },
  }), true);
  assert.equal(frames, 2);
  assert.equal(state.firstVisibleFramePainted, false);
});

test("startup does not wait when the render phase or accepted frame is already ready", async () => {
  for (const state of [
    { renderPhase: "idle", firstVisibleFramePainted: false },
    { renderPhase: "interacting", firstVisibleFramePainted: true },
  ]) {
    assert.equal(await waitForStartupRenderSettle(state, {
      waitForFrame: async () => assert.fail("unexpected frame wait"),
    }), true);
  }
});

test("startup's layout wait is bounded and preserves the failed-frame gate", async () => {
  const state = { renderPhase: "interacting", firstVisibleFramePainted: false };
  let elapsed = 0;
  assert.equal(await waitForStartupRenderSettle(state, {
    now: () => elapsed,
    timeoutMs: 32,
    waitForFrame: async () => { elapsed += 16; },
  }), false);
  assert.deepEqual(state, { renderPhase: "interacting", firstVisibleFramePainted: false });
});

test("long animation frame observer is committed only after observe succeeds", () => {
  const hadObserverApi = Object.hasOwn(globalThis, "PerformanceObserver");
  const originalObserverApi = globalThis.PerformanceObserver;
  const originalStateObserver = runtimeState.longAnimationFrameObserver;
  const events = [];
  let observerInstance = null;

  class SuccessfulPerformanceObserver {
    constructor(callback) {
      this.callback = callback;
      observerInstance = this;
      events.push("construct");
    }

    observe(options) {
      events.push(["observe", options]);
    }
  }

  try {
    globalThis.PerformanceObserver = SuccessfulPerformanceObserver;
    setLongAnimationFrameObserver(runtimeState, null);

    initLongAnimationFrameObserver();

    assert.deepEqual(events, [
      "construct",
      ["observe", { type: "long-animation-frame", buffered: true }],
    ]);
    assert.equal(runtimeState.longAnimationFrameObserver, observerInstance);
  } finally {
    setLongAnimationFrameObserver(runtimeState, originalStateObserver);
    restoreGlobalProperty("PerformanceObserver", hadObserverApi, originalObserverApi);
  }
});

test("long animation frame observer keeps the previous state when observe throws", () => {
  const hadObserverApi = Object.hasOwn(globalThis, "PerformanceObserver");
  const originalObserverApi = globalThis.PerformanceObserver;
  const originalStateObserver = runtimeState.longAnimationFrameObserver;
  const sentinelObserver = { sentinel: true };

  class FailingPerformanceObserver {
    observe() {
      throw new Error("unsupported");
    }
  }

  try {
    globalThis.PerformanceObserver = FailingPerformanceObserver;
    setLongAnimationFrameObserver(runtimeState, sentinelObserver);

    initLongAnimationFrameObserver();

    assert.equal(runtimeState.longAnimationFrameObserver, sentinelObserver);
  } finally {
    setLongAnimationFrameObserver(runtimeState, originalStateObserver);
    restoreGlobalProperty("PerformanceObserver", hadObserverApi, originalObserverApi);
  }
});

test("long animation frame observer commits a complete metrics snapshot and mirrors that identity", () => {
  const hadObserverApi = Object.hasOwn(globalThis, "PerformanceObserver");
  const originalObserverApi = globalThis.PerformanceObserver;
  const hadMetricsMirror = Object.hasOwn(globalThis, "__renderPerfMetrics");
  const originalMetricsMirror = globalThis.__renderPerfMetrics;
  const originalStateObserver = runtimeState.longAnimationFrameObserver;
  const originalMetrics = runtimeState.renderPerfMetrics;
  const previousMetrics = {
    interactionRecoveryTaskMs: {
      taskKey: "rebuild-spatial-index",
      durationMs: 12,
    },
    interactionRecoveryWindowMs: {
      durationMs: 18,
    },
  };
  let observerInstance = null;

  class RecordingPerformanceObserver {
    constructor(callback) {
      this.callback = callback;
      observerInstance = this;
    }

    observe() {}
  }

  try {
    globalThis.PerformanceObserver = RecordingPerformanceObserver;
    setLongAnimationFrameObserver(runtimeState, null);
    replaceRenderPerfMetricsState(runtimeState, previousMetrics);

    initLongAnimationFrameObserver();
    observerInstance.callback({
      getEntries: () => [{
        duration: 31,
        blockingDuration: 17,
        startTime: 7,
        renderStart: 11,
        firstUIEventTimestamp: 13,
      }],
    });

    assert.equal(runtimeState.renderPerfMetrics, previousMetrics);
    assert.equal(
      previousMetrics.longAnimationFrameBlockingDuration,
      runtimeState.renderPerfMetrics.longAnimationFrameBlockingDuration,
    );
    assert.equal(runtimeState.renderPerfMetrics.interactionRecoveryTaskMs, previousMetrics.interactionRecoveryTaskMs);
    assert.deepEqual(runtimeState.renderPerfMetrics.longAnimationFrameBlockingDuration, {
      durationMs: 31,
      blockingDuration: 17,
      startTime: 7,
      renderStart: 11,
      firstUIEventTimestamp: 13,
      bootPhase: String(runtimeState.bootPhase || ""),
      renderPhase: String(runtimeState.renderPhase || ""),
      startupReadonly: !!runtimeState.startupReadonly,
      activePostReadyTaskKey: String(runtimeState.activePostReadyTaskKey || ""),
      activePostReadyTaskStartedAt: Math.max(0, Number(runtimeState.activePostReadyTaskStartedAt || 0)),
      activePostReadyTaskAgeMs: runtimeState.activePostReadyTaskStartedAt
        ? Math.max(0, Number(runtimeState.renderPerfMetrics.longAnimationFrameBlockingDuration.activePostReadyTaskAgeMs || 0))
        : 0,
      pendingPostReadyTaskCount: Math.max(0, Number(runtimeState.postReadyTaskDiagnostics?.pendingTaskCount || 0)),
      pendingPostReadyTaskKeys: Array.isArray(runtimeState.postReadyTaskDiagnostics?.pendingTaskKeys)
        ? [...runtimeState.postReadyTaskDiagnostics.pendingTaskKeys]
        : [],
      postReadyMaxPendingAgeMs: Math.max(0, Number(runtimeState.postReadyTaskDiagnostics?.maxPendingAgeMs || 0)),
      postReadyMaxRetryCount: Math.max(0, Number(runtimeState.postReadyTaskDiagnostics?.maxRetryCount || 0)),
      interactionRecoveryTaskKey: "rebuild-spatial-index",
      activeInteractionRecoveryTaskKey: String(runtimeState.activeInteractionRecoveryTaskKey || ""),
      interactionRecoveryTaskMs: 12,
      interactionRecoveryWindowMs: 18,
      recordedAt: runtimeState.renderPerfMetrics.longAnimationFrameBlockingDuration.recordedAt,
    });
    assert.equal(globalThis.__renderPerfMetrics, runtimeState.renderPerfMetrics);
  } finally {
    replaceRenderPerfMetricsState(runtimeState, originalMetrics);
    setLongAnimationFrameObserver(runtimeState, originalStateObserver);
    restoreGlobalProperty("PerformanceObserver", hadObserverApi, originalObserverApi);
    restoreGlobalProperty("__renderPerfMetrics", hadMetricsMirror, originalMetricsMirror);
  }
});
