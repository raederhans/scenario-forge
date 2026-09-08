import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createVisibleFrameDiagnosticsOwner } from "../js/core/renderer/visible_frame_diagnostics_owner.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OWNER_PATH = "js/core/renderer/visible_frame_diagnostics_owner.js";

function createCommittedFrameIdentity(overrides = {}) {
  return {
    commitKey: {
      scenarioId: "tno_1962",
      sceneGeneration: 11,
      scenarioDataGeneration: 12,
      topologyRevision: 13,
      colorRevision: 14,
      selectionVersion: 15,
      ...overrides.commitKey,
    },
    metadata: {
      politicalDataStage: "fine",
      fullPoliticalReady: true,
      finePoliticalCacheReady: true,
      ...overrides.metadata,
    },
  };
}

function createHarness({
  blockReason = "",
  firstVisibleFramePainted = false,
} = {}) {
  const calls = [];
  const cache = {
    lastAction: "cache-action",
    counters: {},
  };
  const transform = { k: 2, x: 3, y: 4 };
  const runtimeState = { firstVisibleFramePainted };
  const frameState = {
    activeScenarioId: "tno_1962",
    sceneGeneration: 21,
    scenarioDataGeneration: 22,
    topologyRevision: 23,
    colorRevision: 24,
    selectionVersion: 25,
    renderPhase: "idle",
    topologyBundleMode: "composite",
  };
  const committedFrameIdentity = createCommittedFrameIdentity();
  const owner = createVisibleFrameDiagnosticsOwner({
    runtimeState,
    effects: {
      incrementPerfCounter: (counterName) => {
        calls.push(["incrementPerfCounter", counterName]);
        cache.counters[counterName] = Number(cache.counters[counterName] || 0) + 1;
      },
      recordVisibleFrameTransactionDiagnostics: (payload) => {
        calls.push(["recordVisibleFrameTransactionDiagnostics", payload]);
        return { phase: `visible-frame-${payload.status}`, payload };
      },
      recordRenderPerfMetric: (name, durationMs, payload) => {
        calls.push(["recordRenderPerfMetric", name, durationMs, payload]);
        return { name, durationMs, payload };
      },
      callFirstVisibleFramePaintedHook: (payload) => {
        calls.push(["callFirstVisibleFramePaintedHook", payload]);
      },
    },
    getters: {
      getRenderPassCacheState: () => {
        calls.push(["getRenderPassCacheState"]);
        return cache;
      },
      getDefaultTransform: () => {
        calls.push(["getDefaultTransform"]);
        return transform;
      },
      getCommittedFrameIdentity: (currentTransform, payload) => {
        calls.push(["getCommittedFrameIdentity", currentTransform, payload]);
        return committedFrameIdentity;
      },
      getCommittedFrameKeySignature: (commitKey) => {
        calls.push(["getCommittedFrameKeySignature", commitKey]);
        return `sig:${commitKey?.scenarioId || "unknown"}`;
      },
      getFrameStateSnapshot: () => {
        calls.push(["getFrameStateSnapshot"]);
        return frameState;
      },
      getFirstVisiblePoliticalFrameBlockReason: (reason) => {
        calls.push(["getFirstVisiblePoliticalFrameBlockReason", reason]);
        return blockReason;
      },
      getOceanBaseFillColor: () => {
        calls.push(["getOceanBaseFillColor"]);
        return "#123456";
      },
      hasFirstVisibleFramePainted: () => {
        calls.push(["hasFirstVisibleFramePainted"]);
        return runtimeState.firstVisibleFramePainted;
      },
    },
  });
  return {
    owner,
    calls,
    cache,
    transform,
    committedFrameIdentity,
    get painted() {
      return runtimeState.firstVisibleFramePainted;
    },
  };
}

function findCalls(calls, name) {
  return calls.filter((entry) => entry[0] === name);
}

test("recordVisibleFrameTransaction preserves committed diagnostic and metric payload", () => {
  const { owner, calls, cache, transform, committedFrameIdentity } = createHarness();
  const details = {
    reason: "exact-frame",
    paintSource: "first-visible-frame",
    durationMs: 17,
    dirtyFeatureCount: 3,
  };

  const summary = owner.recordVisibleFrameTransaction("committed", details);

  assert.equal(summary.status, "committed");
  assert.equal(summary.reason, "exact-frame");
  assert.equal(summary.accepted, true);
  assert.deepEqual(summary.counterOrder, [
    "visibleFrameTransactionCount",
    "visibleFrameCommittedCount",
  ]);
  assert.deepEqual(cache.counters, {
    visibleFrameTransactionCount: 1,
    visibleFrameCommittedCount: 1,
  });
  assert.deepEqual(findCalls(calls, "getCommittedFrameIdentity")[0].slice(1), [
    transform,
    {
      status: "committed",
      reason: "exact-frame",
      paintSource: "first-visible-frame",
      blockReason: "",
    },
  ]);

  const diagnosticPayload = findCalls(calls, "recordVisibleFrameTransactionDiagnostics")[0][1];
  assert.equal(diagnosticPayload.status, "committed");
  assert.equal(diagnosticPayload.reason, "exact-frame");
  assert.equal(diagnosticPayload.details, details);
  assert.deepEqual(diagnosticPayload.identity, {
    ...committedFrameIdentity.commitKey,
    ...committedFrameIdentity.metadata,
  });
  assert.equal(diagnosticPayload.committedFrameIdentity, committedFrameIdentity);
  assert.equal(diagnosticPayload.visibleFrameCommitKey, "sig:tno_1962");
  assert.equal(diagnosticPayload.durationMs, 17);

  const metricCall = findCalls(calls, "recordRenderPerfMetric").find((entry) => entry[1] === "visibleFrameTransaction");
  assert.equal(metricCall[2], 17);
  assert.deepEqual(metricCall[3], {
    reason: "exact-frame",
    paintSource: "first-visible-frame",
    dirtyFeatureCount: 3,
    status: "committed",
    accepted: true,
    blockReason: "",
    activeScenarioId: "tno_1962",
    sceneGeneration: 11,
    scenarioDataGeneration: 12,
    topologyRevision: 13,
    colorRevision: 14,
    selectionVersion: 15,
    politicalDataStage: "fine",
    fullPoliticalReady: true,
    finePoliticalCacheReady: true,
    phase: "idle",
    count: 1,
    committedCount: 1,
    reusedCount: 0,
    rejectedCount: 0,
    missingCount: 0,
    blockedCount: 0,
    staleAgeMs: 0,
    commitKey: "sig:tno_1962",
    committedFrameIdentity,
  });
});

test("recordVisibleFrameTransaction falls back to the cache last action reason", () => {
  const { owner, calls } = createHarness();

  const summary = owner.recordVisibleFrameTransaction("missing");

  assert.equal(summary.status, "missing");
  assert.equal(summary.reason, "cache-action");
  assert.equal(findCalls(calls, "getCommittedFrameIdentity")[0][2].reason, "cache-action");

  const diagnosticPayload = findCalls(calls, "recordVisibleFrameTransactionDiagnostics")[0][1];
  assert.equal(diagnosticPayload.reason, "cache-action");

  const metricCall = findCalls(calls, "recordRenderPerfMetric")
    .find((entry) => entry[1] === "visibleFrameTransaction");
  assert.equal(metricCall[3].reason, "cache-action");
});

test("recordVisibleFrameTransaction lets explicit details override identity and frame state fields", () => {
  const { owner, calls } = createHarness();
  const details = {
    reason: "override-reason",
    activeScenarioId: "override-scenario",
    sceneGeneration: 101,
    scenarioDataGeneration: 102,
    topologyRevision: 103,
    colorRevision: 104,
    selectionVersion: 105,
    politicalDataStage: "coarse",
    fullPoliticalReady: false,
    finePoliticalCacheReady: false,
    phase: "interacting",
  };

  owner.recordVisibleFrameTransaction("committed", details);

  const diagnosticPayload = findCalls(calls, "recordVisibleFrameTransactionDiagnostics")[0][1];
  assert.equal(diagnosticPayload.details, details);

  const metricCall = findCalls(calls, "recordRenderPerfMetric")
    .find((entry) => entry[1] === "visibleFrameTransaction");
  assert.equal(metricCall[3].activeScenarioId, "override-scenario");
  assert.equal(metricCall[3].sceneGeneration, 101);
  assert.equal(metricCall[3].scenarioDataGeneration, 102);
  assert.equal(metricCall[3].topologyRevision, 103);
  assert.equal(metricCall[3].colorRevision, 104);
  assert.equal(metricCall[3].selectionVersion, 105);
  assert.equal(metricCall[3].politicalDataStage, "coarse");
  assert.equal(metricCall[3].fullPoliticalReady, false);
  assert.equal(metricCall[3].finePoliticalCacheReady, false);
  assert.equal(metricCall[3].phase, "interacting");
});

test("markFirstVisibleFramePainted records accepted payload once and keeps hook payload", () => {
  const { owner, calls, cache } = createHarness();

  const first = owner.markFirstVisibleFramePainted("exact-frame");
  const second = owner.markFirstVisibleFramePainted("exact-frame");

  assert.equal(first.firstVisibleAction, "accepted");
  assert.equal(first.status, "committed");
  assert.equal(second.firstVisibleAction, "already-painted");
  assert.deepEqual(cache.counters, {
    visibleFrameTransactionCount: 1,
    visibleFrameCommittedCount: 1,
  });
  assert.equal(first.effectOrder.filter((name) => name === "setFirstVisibleFramePainted").length, 1);
  assert.equal(second.effectOrder.includes("setFirstVisibleFramePainted"), false);
  assert.deepEqual(
    findCalls(calls, "callFirstVisibleFramePaintedHook")[0],
    ["callFirstVisibleFramePaintedHook", { reason: "exact-frame", activeScenarioId: "tno_1962" }],
  );
  const firstVisibleMetric = findCalls(calls, "recordRenderPerfMetric")
    .find((entry) => entry[1] === "firstVisibleFramePainted");
  assert.deepEqual(firstVisibleMetric.slice(1), [
    "firstVisibleFramePainted",
    0,
    {
      reason: "exact-frame",
      activeScenarioId: "tno_1962",
      topologyRevision: 23,
      colorRevision: 24,
      topologyBundleMode: "composite",
      oceanFill: "#123456",
    },
  ]);
});

test("markFirstVisibleFramePainted records blocked payload without accepting the frame", () => {
  const harness = createHarness({ blockReason: "dirty-political-pass" });
  const { owner, calls, cache } = harness;

  const summary = owner.markFirstVisibleFramePainted("exact-frame");

  assert.equal(summary.firstVisibleAction, "blocked");
  assert.equal(summary.status, "blocked");
  assert.equal(summary.blockReason, "dirty-political-pass");
  assert.equal(harness.painted, false);
  assert.equal(summary.effectOrder.includes("setFirstVisibleFramePainted"), false);
  assert.deepEqual(cache.counters, {
    visibleFrameTransactionCount: 1,
    visibleFrameBlockedCount: 1,
  });
  const blockedMetric = findCalls(calls, "recordRenderPerfMetric")
    .find((entry) => entry[1] === "firstVisibleFrameBlocked");
  assert.deepEqual(blockedMetric.slice(1), [
    "firstVisibleFrameBlocked",
    0,
    {
      reason: "exact-frame",
      blockReason: "dirty-political-pass",
      activeScenarioId: "tno_1962",
      topologyRevision: 23,
      colorRevision: 24,
      topologyBundleMode: "composite",
      oceanFill: "#123456",
    },
  ]);
  const visibleMetric = findCalls(calls, "recordRenderPerfMetric")
    .find((entry) => entry[1] === "visibleFrameTransaction");
  assert.equal(visibleMetric[3].status, "blocked");
  assert.equal(visibleMetric[3].blockReason, "dirty-political-pass");
  assert.equal(visibleMetric[3].paintSource, "first-visible-frame");
});

test("visible frame status counters preserve missing reused rejected and blocked buckets", () => {
  for (const [status, counterName, accepted] of [
    ["reused", "visibleFrameReusedCount", true],
    ["rejected", "visibleFrameRejectedCount", false],
    ["missing", "visibleFrameMissingCount", false],
    ["blocked", "visibleFrameBlockedCount", false],
  ]) {
    const { owner, cache } = createHarness();

    const summary = owner.recordVisibleFrameTransaction(status, { reason: `${status}-reason` });

    assert.equal(summary.status, status);
    assert.equal(summary.accepted, accepted);
    assert.deepEqual(cache.counters, {
      visibleFrameTransactionCount: 1,
      [counterName]: 1,
    });
  }
});

test("resetFirstVisibleFramePainted records reset metric through injected effects", () => {
  const harness = createHarness({ firstVisibleFramePainted: true });

  const summary = harness.owner.resetFirstVisibleFramePainted("scenario-apply-refresh");

  assert.equal(harness.painted, false);
  assert.equal(summary.firstVisibleAction, "reset");
  assert.equal(summary.effectOrder.filter((name) => name === "setFirstVisibleFramePainted").length, 1);
  assert.deepEqual(findCalls(harness.calls, "recordRenderPerfMetric")[0].slice(1), [
    "firstVisibleFramePaintedReset",
    0,
    {
      reason: "scenario-apply-refresh",
      activeScenarioId: "tno_1962",
    },
  ]);
});

test("createVisibleFrameDiagnosticsOwner fails fast for missing dependencies", () => {
  assert.throws(
    () => createVisibleFrameDiagnosticsOwner({
      effects: {
        incrementPerfCounter() {},
        recordVisibleFrameTransactionDiagnostics() {},
        recordRenderPerfMetric() {},
      },
      getters: {
        getRenderPassCacheState() {},
        getDefaultTransform() {},
        getCommittedFrameIdentity() {},
        getCommittedFrameKeySignature() {},
        getFrameStateSnapshot() {},
        getFirstVisiblePoliticalFrameBlockReason() {},
        getOceanBaseFillColor() {},
        hasFirstVisibleFramePainted() {},
      },
    }),
    /effects\.callFirstVisibleFramePaintedHook must be a function/,
  );
  assert.throws(
    () => createVisibleFrameDiagnosticsOwner({
      effects: {
        incrementPerfCounter() {},
        recordVisibleFrameTransactionDiagnostics() {},
        recordRenderPerfMetric() {},
        callFirstVisibleFramePaintedHook() {},
      },
      getters: {
        getRenderPassCacheState() {},
        getDefaultTransform() {},
        getCommittedFrameIdentity() {},
        getCommittedFrameKeySignature() {},
        getFrameStateSnapshot() {},
        getFirstVisiblePoliticalFrameBlockReason() {},
        getOceanBaseFillColor() {},
      },
    }),
    /getters\.hasFirstVisibleFramePainted must be a function/,
  );
});

test("visible frame diagnostics owner returns frozen summaries and stays outside render lifecycle internals", () => {
  const { owner } = createHarness();

  const summary = owner.recordVisibleFrameTransaction("committed", { reason: "freeze-check" });

  assert.equal(Object.isFrozen(summary), true);
  assert.equal(Object.isFrozen(summary.effectOrder), true);
  assert.equal(Object.isFrozen(summary.getterOrder), true);
  assert.equal(Object.isFrozen(summary.counterOrder), true);

  const ownerSource = fs.readFileSync(path.join(REPO_ROOT, OWNER_PATH), "utf8");
  for (const token of [
    "map_renderer.js",
    "runtimeState =",
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
});
