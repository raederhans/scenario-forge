import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createRenderPhaseLifecycleOwner } from "../js/core/map_renderer/render_phase_lifecycle_owner.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OWNER_PATH = "js/core/map_renderer/render_phase_lifecycle_owner.js";

function createHarness({
  renderPhase = "idle",
  renderPhaseTimerId = null,
  isInteracting = false,
  pendingDayNightRefresh = false,
  dprStageChanged = false,
  exactFastPath = false,
  chunkRefreshStatus = "noop",
  settleProfile = { settleDurationMs: 200, exactQuietWindowMs: 420 },
  nowValues = [1000, 1200, 1400],
} = {}) {
  const calls = [];
  const scheduledCallbacks = [];
  const phaseData = {
    renderPhase,
    renderPhaseTimerId,
    phaseEnteredAt: 0,
    isInteracting,
    hoverOverlayDirty: false,
    pendingDayNightRefresh,
    adaptiveSettleProfile: null,
    deferExactAfterSettle: false,
  };
  const writePhaseField = (fieldName, value) => {
    phaseData[fieldName] = value;
  };
  const times = [...nowValues];
  const effects = {
    clearTimeout: (timerId) => {
      calls.push(["clearTimeout", timerId]);
    },
    setTimeout: (callback, delayMs) => {
      calls.push(["setTimeout", delayMs]);
      scheduledCallbacks.push(callback);
      return `timer-${scheduledCallbacks.length}`;
    },
    setRenderPhaseTimerId: (timerId) => {
      calls.push(["setRenderPhaseTimerId", timerId]);
      writePhaseField("renderPhaseTimerId", timerId);
    },
    setRenderPhaseValue: (phase) => {
      calls.push(["setRenderPhaseValue", phase]);
      writePhaseField("renderPhase", phase);
    },
    setPhaseEnteredAt: (enteredAtMs) => {
      calls.push(["setPhaseEnteredAt", enteredAtMs]);
      writePhaseField("phaseEnteredAt", enteredAtMs);
    },
    setIsInteracting: (isInteracting) => {
      calls.push(["setIsInteracting", isInteracting]);
      writePhaseField("isInteracting", isInteracting);
    },
    cancelPoliticalPathWarmup: (reason) => {
      calls.push(["cancelPoliticalPathWarmup", reason]);
    },
    setHoverOverlayDirty: (dirty) => {
      calls.push(["setHoverOverlayDirty", dirty]);
      writePhaseField("hoverOverlayDirty", dirty);
    },
    setPendingDayNightRefresh: (pending) => {
      calls.push(["setPendingDayNightRefresh", pending]);
      writePhaseField("pendingDayNightRefresh", pending);
    },
    invalidateRenderPasses: (...args) => {
      calls.push(["invalidateRenderPasses", ...args]);
    },
    updateDprStage: (stage) => {
      calls.push(["updateDprStage", stage]);
      return dprStageChanged;
    },
    setCanvasSize: (payload) => {
      calls.push(["setCanvasSize", payload]);
    },
    setAdaptiveSettleProfile: (profile) => {
      calls.push(["setAdaptiveSettleProfile", profile]);
      writePhaseField("adaptiveSettleProfile", profile);
    },
    scheduleScenarioChunkRefresh: (options) => {
      calls.push(["scheduleScenarioChunkRefresh", options]);
      return chunkRefreshStatus;
    },
    setDeferExactAfterSettle: (deferred) => {
      calls.push(["setDeferExactAfterSettle", deferred]);
      writePhaseField("deferExactAfterSettle", deferred);
    },
    render: () => {
      calls.push(["render"]);
    },
    scheduleExactAfterSettleRefresh: (profile) => {
      calls.push(["scheduleExactAfterSettleRefresh", profile]);
    },
  };
  const getters = {
    getRenderPhase: () => {
      calls.push(["getRenderPhase"]);
      return phaseData.renderPhase;
    },
    getRenderPhaseTimerId: () => {
      calls.push(["getRenderPhaseTimerId"]);
      return phaseData.renderPhaseTimerId;
    },
    nowMs: () => {
      calls.push(["nowMs"]);
      return times.shift() ?? nowValues.at(-1) ?? 0;
    },
    getAdaptiveSettleProfile: () => {
      calls.push(["getAdaptiveSettleProfile"]);
      return settleProfile;
    },
    hasPendingDayNightRefresh: () => {
      calls.push(["hasPendingDayNightRefresh"]);
      return phaseData.pendingDayNightRefresh;
    },
    shouldStartExactAfterSettleFastPath: () => {
      calls.push(["shouldStartExactAfterSettleFastPath"]);
      return exactFastPath;
    },
  };
  const owner = createRenderPhaseLifecycleOwner({
    state: {
      renderPhaseIdle: "idle",
      renderPhaseInteracting: "interacting",
    },
    effects,
    getters,
  });
  return { calls, effects, getters, owner, scheduledCallbacks, state: phaseData };
}

function names(calls) {
  return calls.map((call) => call[0]);
}

test("clearRenderPhaseTimer clears an active timer handle through injected effects", () => {
  const { owner, calls, state } = createHarness({ renderPhaseTimerId: "timer-a" });

  owner.clearRenderPhaseTimer();

  assert.deepEqual(calls, [
    ["getRenderPhaseTimerId"],
    ["clearTimeout", "timer-a"],
    ["setRenderPhaseTimerId", null],
  ]);
  assert.equal(state.renderPhaseTimerId, null);
});

test("setRenderPhase enters interacting with exact write and effect order", () => {
  const { owner, calls, state } = createHarness({ renderPhase: "idle", dprStageChanged: true });

  owner.setRenderPhase("interacting");

  assert.deepEqual(names(calls), [
    "getRenderPhase",
    "nowMs",
    "setRenderPhaseValue",
    "setPhaseEnteredAt",
    "setIsInteracting",
    "cancelPoliticalPathWarmup",
    "setHoverOverlayDirty",
    "updateDprStage",
    "setCanvasSize",
  ]);
  assert.equal(state.renderPhase, "interacting");
  assert.equal(state.phaseEnteredAt, 1000);
  assert.equal(state.isInteracting, true);
  assert.equal(state.hoverOverlayDirty, true);
  assert.deepEqual(calls.find((call) => call[0] === "setCanvasSize")?.[1], {
    reason: "phase-interacting-dpr-stage",
    targetPassesOnDprChange: ["political", "contextBase", "borders"],
  });
});

test("setRenderPhase enters settling without interaction state", () => {
  const { owner, calls, state } = createHarness({ renderPhase: "interacting" });

  owner.setRenderPhase("settling");

  assert.equal(state.renderPhase, "settling");
  assert.equal(state.isInteracting, false);
  assert.equal(calls.some((call) => call[0] === "setHoverOverlayDirty"), false);
  assert.deepEqual(calls.find((call) => call[0] === "cancelPoliticalPathWarmup"), [
    "cancelPoliticalPathWarmup",
    "phase-settling",
  ]);
  assert.deepEqual(calls.find((call) => call[0] === "updateDprStage"), ["updateDprStage", "idle"]);
});

test("setRenderPhase enters idle and flushes pending day-night refresh", () => {
  const { owner, calls, state } = createHarness({
    renderPhase: "settling",
    pendingDayNightRefresh: true,
  });

  owner.setRenderPhase("idle");

  assert.deepEqual(names(calls), [
    "getRenderPhase",
    "nowMs",
    "setRenderPhaseValue",
    "setPhaseEnteredAt",
    "setIsInteracting",
    "setHoverOverlayDirty",
    "hasPendingDayNightRefresh",
    "setPendingDayNightRefresh",
    "invalidateRenderPasses",
    "updateDprStage",
  ]);
  assert.equal(state.renderPhase, "idle");
  assert.equal(state.isInteracting, false);
  assert.equal(state.pendingDayNightRefresh, false);
  assert.equal(state.hoverOverlayDirty, true);
  assert.deepEqual(calls.find((call) => call[0] === "invalidateRenderPasses"), [
    "invalidateRenderPasses",
    "dayNight",
    "day-night-clock-deferred",
  ]);
});

test("scheduleRenderPhaseIdle clears old timer and stores a new adaptive timer", () => {
  const settleProfile = { settleDurationMs: 150, exactQuietWindowMs: 300 };
  const { owner, calls, scheduledCallbacks, state } = createHarness({
    renderPhase: "interacting",
    renderPhaseTimerId: "timer-old",
    settleProfile,
  });

  owner.scheduleRenderPhaseIdle();

  assert.deepEqual(names(calls), [
    "getRenderPhaseTimerId",
    "clearTimeout",
    "setRenderPhaseTimerId",
    "getAdaptiveSettleProfile",
    "setAdaptiveSettleProfile",
    "setTimeout",
    "setRenderPhaseTimerId",
  ]);
  assert.equal(scheduledCallbacks.length, 1);
  assert.equal(state.renderPhaseTimerId, "timer-1");
  assert.equal(state.adaptiveSettleProfile, settleProfile);
});

test("scheduleRenderPhaseIdle callback renders the normal idle path", () => {
  const { owner, calls, scheduledCallbacks, state } = createHarness({ renderPhase: "settling" });

  owner.scheduleRenderPhaseIdle();
  calls.length = 0;
  scheduledCallbacks[0]();

  assert.equal(state.renderPhaseTimerId, null);
  assert.equal(state.renderPhase, "idle");
  assert.deepEqual(calls.find((call) => call[0] === "scheduleScenarioChunkRefresh")?.[1], {
    reason: "render-phase-idle",
    delayMs: 0,
    flushPending: true,
  });
  assert.deepEqual(names(calls).slice(-3), [
    "scheduleScenarioChunkRefresh",
    "shouldStartExactAfterSettleFastPath",
    "render",
  ]);
});

test("scheduleRenderPhaseIdle callback starts exact fast path when quiet", () => {
  const settleProfile = { settleDurationMs: 120, exactQuietWindowMs: 240 };
  const { owner, calls, scheduledCallbacks, state } = createHarness({
    renderPhase: "settling",
    exactFastPath: true,
    settleProfile,
  });

  owner.scheduleRenderPhaseIdle();
  calls.length = 0;
  scheduledCallbacks[0]();

  assert.equal(state.deferExactAfterSettle, true);
  assert.deepEqual(names(calls).slice(-4), [
    "shouldStartExactAfterSettleFastPath",
    "setDeferExactAfterSettle",
    "render",
    "scheduleExactAfterSettleRefresh",
  ]);
  assert.deepEqual(calls.at(-1), ["scheduleExactAfterSettleRefresh", settleProfile]);
});

test("scheduleRenderPhaseIdle callback waits when chunk promotion is active", () => {
  const { owner, calls, scheduledCallbacks, state } = createHarness({
    renderPhase: "settling",
    exactFastPath: true,
    chunkRefreshStatus: "promotion-started",
  });

  owner.scheduleRenderPhaseIdle();
  calls.length = 0;
  scheduledCallbacks[0]();

  assert.equal(state.deferExactAfterSettle, false);
  assert.equal(calls.some((call) => call[0] === "render"), false);
  assert.equal(calls.some((call) => call[0] === "scheduleExactAfterSettleRefresh"), false);
});

test("resetRenderPhaseState restores idle phase timer fields through injected effects", () => {
  const { owner, calls, state } = createHarness({
    renderPhase: "interacting",
    renderPhaseTimerId: "timer-live",
    isInteracting: true,
    nowValues: [2222],
  });

  owner.resetRenderPhaseState();

  assert.deepEqual(names(calls), [
    "getRenderPhaseTimerId",
    "clearTimeout",
    "setRenderPhaseTimerId",
    "nowMs",
    "setRenderPhaseValue",
    "setPhaseEnteredAt",
    "setIsInteracting",
  ]);
  assert.equal(state.renderPhase, "idle");
  assert.equal(state.phaseEnteredAt, 2222);
  assert.equal(state.isInteracting, false);
  assert.equal(state.renderPhaseTimerId, null);
});

test("createRenderPhaseLifecycleOwner fails fast for missing dependencies", () => {
  const { effects, getters } = createHarness();
  delete effects.render;
  assert.throws(
    () => createRenderPhaseLifecycleOwner({ effects, getters }),
    /effects\.render must be a function/,
  );

  const second = createHarness();
  delete second.getters.getAdaptiveSettleProfile;
  assert.throws(
    () => createRenderPhaseLifecycleOwner({ effects: second.effects, getters: second.getters }),
    /getters\.getAdaptiveSettleProfile must be a function/,
  );
});

test("render phase lifecycle owner stays outside broad render internals", () => {
  const ownerSource = fs.readFileSync(path.join(REPO_ROOT, OWNER_PATH), "utf8");
  for (const token of [
    "runtimeState",
    "map_renderer.js",
    "drawCanvas",
    "renderPassToCache",
    "buildHitCanvas",
    "createScenarioRefreshRuntime",
    "createExactAfterSettleScheduler",
    "createStrategicOverlayRuntimeOwner",
    "renderer_render_lifecycle_owner",
  ]) {
    assert.equal(ownerSource.includes(token), false, `${OWNER_PATH} must avoid ${token}`);
  }
  for (const token of ["createTrace", "createSummary", "effectOrder", "getterOrder"]) {
    assert.equal(ownerSource.includes(token), false, `${OWNER_PATH} must not retain trace bookkeeping ${token}`);
  }
});
