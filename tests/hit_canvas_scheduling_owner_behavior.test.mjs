import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createHitCanvasSchedulingOwner } from "../js/core/map_renderer/hit_canvas_scheduling_owner.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OWNER_PATH = "js/core/map_renderer/hit_canvas_scheduling_owner.js";

function createHarness(overrides = {}) {
  const calls = [];
  const scheduledCallbacks = [];
  const harnessState = {
    hasRuntime: true,
    dirty: true,
    deferred: false,
    phase: "idle",
    scheduledHandle: null,
    activeScenarioId: "scenario-a",
    scheduleReturnsEmptyHandle: false,
    ...overrides,
  };
  const effects = {
    scheduleDeferredWork: (callback, options) => {
      calls.push(["scheduleDeferredWork", options]);
      scheduledCallbacks.push(callback);
      if (harnessState.scheduleReturnsEmptyHandle) {
        return null;
      }
      return { kind: "idle-handle", id: scheduledCallbacks.length };
    },
    cancelDeferredWork: (handle) => {
      calls.push(["cancelDeferredWork", handle]);
    },
    setScheduledHitCanvasBuildHandle: (handle) => {
      calls.push(["setScheduledHitCanvasBuildHandle", handle]);
      harnessState.scheduledHandle = handle;
    },
    runScheduledHitCanvasBuild: (details) => {
      calls.push(["runScheduledHitCanvasBuild", details]);
      return true;
    },
  };
  const getters = {
    getHitCanvasBuildIdentity: () => harnessState.identity ?? harnessState.activeScenarioId,
    hasHitCanvasRuntime: () => {
      calls.push(["hasHitCanvasRuntime"]);
      return harnessState.hasRuntime;
    },
    isHitCanvasDirty: () => {
      calls.push(["isHitCanvasDirty"]);
      return harnessState.dirty;
    },
    isHitCanvasBuildDeferred: () => {
      calls.push(["isHitCanvasBuildDeferred"]);
      return harnessState.deferred;
    },
    getRenderPhase: () => {
      calls.push(["getRenderPhase"]);
      return harnessState.phase;
    },
    getScheduledHitCanvasBuildHandle: () => {
      calls.push(["getScheduledHitCanvasBuildHandle"]);
      return harnessState.scheduledHandle;
    },
    getActiveScenarioId: () => {
      calls.push(["getActiveScenarioId"]);
      return harnessState.activeScenarioId;
    },
  };
  const owner = createHitCanvasSchedulingOwner({
    state: {
      renderPhaseIdle: "idle",
      idleTimeoutMs: 75,
    },
    effects,
    getters,
  });
  return { calls, owner, scheduledCallbacks, harnessState };
}

function callNames(calls) {
  return calls.map((call) => call[0]);
}

test("schedule skips when hit canvas runtime is missing", () => {
  const { owner, calls } = createHarness({ hasRuntime: false });

  const summary = owner.scheduleHitCanvasBuildIfNeeded({ reason: "missing-runtime" });

  assert.deepEqual(summary, {
    reason: "missing-runtime",
    scheduled: false,
    canceled: false,
    skipped: true,
    skipReason: "missing-hit-runtime",
    effectOrder: [],
    getterOrder: ["hasHitCanvasRuntime"],
  });
  assert.deepEqual(callNames(calls), ["hasHitCanvasRuntime"]);
});

test("schedule skips when hit canvas is clean", () => {
  const { owner } = createHarness({ dirty: false });

  const summary = owner.scheduleHitCanvasBuildIfNeeded({ reason: "clean" });

  assert.equal(summary.skipped, true);
  assert.equal(summary.skipReason, "clean");
  assert.deepEqual(summary.getterOrder, ["hasHitCanvasRuntime", "isHitCanvasDirty"]);
});

test("schedule skips while hit canvas build is deferred", () => {
  const { owner } = createHarness({ deferred: true });

  const summary = owner.scheduleHitCanvasBuildIfNeeded({ reason: "deferred" });

  assert.equal(summary.skipped, true);
  assert.equal(summary.skipReason, "deferred");
  assert.deepEqual(summary.getterOrder, [
    "hasHitCanvasRuntime",
    "isHitCanvasDirty",
    "isHitCanvasBuildDeferred",
  ]);
});

test("schedule skips when render phase is not idle", () => {
  const { owner } = createHarness({ phase: "interacting" });

  const summary = owner.scheduleHitCanvasBuildIfNeeded({ reason: "phase" });

  assert.equal(summary.skipped, true);
  assert.equal(summary.skipReason, "phase-not-idle");
  assert.deepEqual(summary.getterOrder, [
    "hasHitCanvasRuntime",
    "isHitCanvasDirty",
    "isHitCanvasBuildDeferred",
    "getRenderPhase",
  ]);
});

test("schedule skips duplicate scheduled handle", () => {
  const existingHandle = { kind: "existing" };
  const { owner } = createHarness({ scheduledHandle: existingHandle });

  const summary = owner.scheduleHitCanvasBuildIfNeeded({ reason: "duplicate" });

  assert.equal(summary.skipped, true);
  assert.equal(summary.skipReason, "duplicate-schedule");
  assert.deepEqual(summary.getterOrder, [
    "hasHitCanvasRuntime",
    "isHitCanvasDirty",
    "isHitCanvasBuildDeferred",
    "getRenderPhase",
    "getScheduledHitCanvasBuildHandle",
  ]);
});

test("schedule stores the returned handle and returns a frozen summary", () => {
  const { owner, calls, scheduledCallbacks, harnessState } = createHarness();

  const summary = owner.scheduleHitCanvasBuildIfNeeded({ reason: "idle-render" });

  assert.equal(scheduledCallbacks.length, 1);
  assert.deepEqual(calls[5], ["scheduleDeferredWork", { timeout: 75 }]);
  assert.equal(harnessState.scheduledHandle?.kind, "idle-handle");
  assert.deepEqual(summary, {
    reason: "idle-render",
    scheduled: true,
    canceled: false,
    skipped: false,
    skipReason: "",
    effectOrder: ["scheduleDeferredWork", "setScheduledHitCanvasBuildHandle"],
    getterOrder: [
      "hasHitCanvasRuntime",
      "isHitCanvasDirty",
      "isHitCanvasBuildDeferred",
      "getRenderPhase",
      "getScheduledHitCanvasBuildHandle",
    ],
  });
  assert.equal(Object.isFrozen(summary), true);
  assert.equal(Object.isFrozen(summary.effectOrder), true);
  assert.equal(Object.isFrozen(summary.getterOrder), true);
});

test("schedule reports a skipped summary when the deferred scheduler returns no handle", () => {
  const { owner, calls, scheduledCallbacks, harnessState } = createHarness({
    scheduleReturnsEmptyHandle: true,
  });

  const summary = owner.scheduleHitCanvasBuildIfNeeded({ reason: "empty-handle" });

  assert.equal(scheduledCallbacks.length, 1);
  assert.deepEqual(calls.at(-1), ["setScheduledHitCanvasBuildHandle", null]);
  assert.equal(harnessState.scheduledHandle, null);
  assert.deepEqual(summary, {
    reason: "empty-handle",
    scheduled: false,
    canceled: false,
    skipped: true,
    skipReason: "schedule-returned-empty-handle",
    effectOrder: ["scheduleDeferredWork", "setScheduledHitCanvasBuildHandle"],
    getterOrder: [
      "hasHitCanvasRuntime",
      "isHitCanvasDirty",
      "isHitCanvasBuildDeferred",
      "getRenderPhase",
      "getScheduledHitCanvasBuildHandle",
    ],
  });
});

test("scheduled callback clears handle before drawing deferred hit canvas metric", () => {
  const { owner, calls, scheduledCallbacks, harnessState } = createHarness();
  owner.scheduleHitCanvasBuildIfNeeded({ reason: "custom-reason" });
  calls.length = 0;

  scheduledCallbacks[0]();

  assert.deepEqual(callNames(calls), [
    "getScheduledHitCanvasBuildHandle",
    "setScheduledHitCanvasBuildHandle",
    "hasHitCanvasRuntime",
    "isHitCanvasDirty",
    "isHitCanvasBuildDeferred",
    "getRenderPhase",
    "getActiveScenarioId",
    "runScheduledHitCanvasBuild",
  ]);
  assert.equal(harnessState.scheduledHandle, null);
  assert.deepEqual(calls.at(-1), [
    "runScheduledHitCanvasBuild",
    {
      mode: "deferred",
      reason: "custom-reason",
      activeScenarioId: "scenario-a",
    },
  ]);
});

test("scheduled callback only clears handle when runtime gates are closed", () => {
  const { owner, calls, scheduledCallbacks, harnessState } = createHarness();
  owner.scheduleHitCanvasBuildIfNeeded({ reason: "late-clean" });
  calls.length = 0;
  harnessState.dirty = false;

  scheduledCallbacks[0]();

  assert.deepEqual(callNames(calls), [
    "getScheduledHitCanvasBuildHandle",
    "setScheduledHitCanvasBuildHandle",
    "hasHitCanvasRuntime",
    "isHitCanvasDirty",
  ]);
  assert.equal(calls.some((call) => call[0] === "runScheduledHitCanvasBuild"), false);
  assert.equal(harnessState.scheduledHandle, null);
});

test("cancel cancels an existing scheduled handle and clears it", () => {
  const existingHandle = { kind: "existing" };
  const { owner, calls, harnessState } = createHarness({ scheduledHandle: existingHandle });

  const summary = owner.cancelScheduledHitCanvasBuild({ reason: "strict-validation" });

  assert.deepEqual(callNames(calls), [
    "getScheduledHitCanvasBuildHandle",
    "cancelDeferredWork",
    "setScheduledHitCanvasBuildHandle",
  ]);
  assert.deepEqual(calls[1], ["cancelDeferredWork", existingHandle]);
  assert.equal(harnessState.scheduledHandle, null);
  assert.deepEqual(summary, {
    reason: "strict-validation",
    scheduled: false,
    canceled: true,
    skipped: false,
    skipReason: "",
    effectOrder: ["cancelDeferredWork", "setScheduledHitCanvasBuildHandle"],
    getterOrder: ["getScheduledHitCanvasBuildHandle"],
  });
});

test("cancelled or replaced callbacks cannot clear the new handle or build twice", () => {
  const { owner, calls, scheduledCallbacks, harnessState } = createHarness();
  owner.scheduleHitCanvasBuildIfNeeded();
  const obsolete = scheduledCallbacks[0];
  owner.cancelScheduledHitCanvasBuild();
  owner.scheduleHitCanvasBuildIfNeeded();
  const replacement = harnessState.scheduledHandle;
  obsolete();
  assert.equal(harnessState.scheduledHandle, replacement);
  const current = scheduledCallbacks[1];
  current();
  current();
  assert.equal(calls.filter(([name]) => name === "runScheduledHitCanvasBuild").length, 1);
});

test("a callback from a previous scenario cannot build the current scenario", () => {
  const { owner, calls, scheduledCallbacks, harnessState } = createHarness();
  owner.scheduleHitCanvasBuildIfNeeded();
  Object.assign(harnessState, { activeScenarioId: "scenario-b" });
  scheduledCallbacks[0]();
  assert.equal(harnessState.scheduledHandle, null);
  assert.equal(calls.some(([name]) => name === "runScheduledHitCanvasBuild"), false);
  owner.scheduleHitCanvasBuildIfNeeded();
  scheduledCallbacks[1]();
  const builds = calls.filter(([name]) => name === "runScheduledHitCanvasBuild");
  assert.equal(builds.length, 1);
  assert.equal(builds[0][1].activeScenarioId, "scenario-b");
});

test("same-scenario generation changes and another builder completing retire pending work", () => {
  const { owner, calls, scheduledCallbacks, harnessState } = createHarness({ identity: "scene-a:topology1:viewport1" });
  owner.scheduleHitCanvasBuildIfNeeded();
  harnessState.identity = "scene-a:topology2:viewport2";
  scheduledCallbacks[0]();
  assert.equal(harnessState.scheduledHandle, null);
  assert.equal(calls.some(([name]) => name === "runScheduledHitCanvasBuild"), false);
  owner.scheduleHitCanvasBuildIfNeeded();
  harnessState.dirty = false;
  scheduledCallbacks[1]();
  assert.equal(calls.some(([name]) => name === "runScheduledHitCanvasBuild"), false);
});

test("cancel reports a frozen skipped summary when no handle exists", () => {
  const { owner } = createHarness({ scheduledHandle: null });

  const summary = owner.cancelScheduledHitCanvasBuild({ reason: "reset" });

  assert.equal(summary.skipped, true);
  assert.equal(summary.skipReason, "no-scheduled-handle");
  assert.equal(Object.isFrozen(summary), true);
});

test("createHitCanvasSchedulingOwner fails fast for missing dependencies", () => {
  assert.throws(
    () => createHitCanvasSchedulingOwner({
      effects: {},
      getters: {},
    }),
    /effects\.scheduleDeferredWork must be a function/,
  );
  assert.throws(
    () => createHitCanvasSchedulingOwner({
      effects: {
        scheduleDeferredWork() {},
        cancelDeferredWork() {},
        setScheduledHitCanvasBuildHandle() {},
        runScheduledHitCanvasBuild() {},
      },
      getters: {},
    }),
    /getters\.hasHitCanvasRuntime must be a function/,
  );
});

test("hit canvas scheduling owner stays outside renderer build and probe bodies", () => {
  const ownerSource = fs.readFileSync(path.join(REPO_ROOT, OWNER_PATH), "utf8");
  for (const token of [
    "runtimeState",
    "rendererSurfaceHost",
    "drawHitCanvas",
    "drawHitCanvasWithMetric",
    "recordDeferredFullHitCanvasMetric",
    "buildHitCanvasAfterStartup",
    "getDirtyHitCanvasPointProbeHit",
    "getValidatedCanvasHit",
    "hitCanvasTopologyRevision",
    "from \"../map_renderer.js\"",
    "from \"./map_renderer.js\"",
  ]) {
    assert.equal(ownerSource.includes(token), false, `${OWNER_PATH} must avoid ${token}`);
  }
});
