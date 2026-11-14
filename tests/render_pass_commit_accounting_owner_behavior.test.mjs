import assert from "node:assert/strict";
import test from "node:test";

import {
  createRenderPassCommitAccountingOwner,
} from "../js/core/map_renderer/render_pass_commit_accounting_owner.js";

function createCache(overrides = {}) {
  return {
    signatures: {},
    dirty: {},
    partialPoliticalDirtyIds: {
      cleared: false,
      clear() {
        this.cleared = true;
      },
    },
    counters: {
      contextScenarioReuseCount: 5,
    },
    ...overrides,
  };
}

function createOwnerHarness({
  cache = createCache(),
  nowValue = 150,
  signature = "signature",
  passCounterNames = ["passCounter"],
  visibleFrameIdentity = {},
} = {}) {
  const calls = [];
  const owner = createRenderPassCommitAccountingOwner({
    effects: {
      clearPassFullReferenceTransforms(passNames) {
        calls.push(["clearPassFullReferenceTransforms", passNames]);
      },
      incrementPerfCounter(counterName) {
        calls.push(["incrementPerfCounter", counterName]);
      },
      recordPassTiming(timings, passName, passStart) {
        calls.push(["recordPassTiming", passName, passStart]);
        timings[passName] = Number(timings[passName] || 0) + 1;
      },
      recordRenderPerfMetric(name, duration, metadata) {
        calls.push(["recordRenderPerfMetric", name, duration, metadata]);
      },
      schedulePoliticalPathWarmup(transform) {
        calls.push(["schedulePoliticalPathWarmup", transform]);
      },
      setPassFullReferenceTransform(passName, transform) {
        calls.push(["setPassFullReferenceTransform", passName, transform]);
      },
      setPassReferenceTransform(passName, transform) {
        calls.push(["setPassReferenceTransform", passName, transform]);
      },
    },
    getters: {
      getPassCounterNames(passName) {
        calls.push(["getPassCounterNames", passName]);
        return passCounterNames;
      },
      getRenderPassCacheState() {
        calls.push(["getRenderPassCacheState"]);
        return cache;
      },
      getRenderPassSignature(passName, transform) {
        calls.push(["getRenderPassSignature", passName, transform]);
        return signature;
      },
      getVisibleFrameIdentity(transform) {
        calls.push(["getVisibleFrameIdentity", transform]);
        return visibleFrameIdentity;
      },
      nowMs() {
        calls.push(["nowMs"]);
        return nowValue;
      },
    },
  });

  return { cache, calls, owner };
}

test("records declined commit metric and skips cache mutation", () => {
  const { cache, calls, owner } = createOwnerHarness({ nowValue: 212 });
  const timings = {};

  const summary = owner.commitRenderPass({
    passName: "contextBase",
    transform: { k: 2 },
    drawResult: { committed: false, reason: "draw-declined-for-test" },
    timings,
    passStart: 200,
    hostSummary: { drawInvoked: true },
  });

  assert.equal(summary.committed, false);
  assert.equal(summary.skipped, true);
  assert.equal(summary.skipReason, "draw-declined-for-test");
  assert.equal(summary.dirtyCleared, false);
  assert.equal(summary.signatureUpdated, false);
  assert.equal(summary.timingRecorded, false);
  assert.deepEqual(timings, {});
  assert.deepEqual(cache.signatures, {});
  assert.deepEqual(cache.dirty, {});
  assert.deepEqual(calls, [
    ["nowMs"],
    [
      "recordRenderPerfMetric",
      "renderPassCommitSkipped",
      12,
      { passName: "contextBase", reason: "draw-declined-for-test" },
    ],
  ]);
});

test("commits a normal pass signature dirty flag timing and counters", () => {
  const timings = {};
  const transform = { k: 3 };
  const { cache, calls, owner } = createOwnerHarness({
    signature: "context-signature",
    passCounterNames: ["contextCounterA", "contextCounterB"],
  });
  cache.dirty.contextBase = true;

  const summary = owner.commitRenderPass({
    passName: "contextBase",
    transform,
    drawResult: { committed: true },
    timings,
    passStart: 500,
  });

  assert.equal(summary.committed, true);
  assert.equal(summary.skipped, false);
  assert.equal(summary.dirtyCleared, true);
  assert.equal(summary.signatureUpdated, true);
  assert.equal(summary.timingRecorded, true);
  assert.equal(cache.signatures.contextBase, "context-signature");
  assert.equal(cache.dirty.contextBase, false);
  assert.deepEqual(timings, { contextBase: 1 });
  assert.deepEqual(calls, [
    ["getRenderPassCacheState"],
    ["setPassReferenceTransform", "contextBase", transform],
    ["getRenderPassSignature", "contextBase", transform],
    ["recordPassTiming", "contextBase", 500],
    ["getPassCounterNames", "contextBase"],
    ["incrementPerfCounter", "contextCounterA"],
    ["incrementPerfCounter", "contextCounterB"],
  ]);
});

test("commits political fine cache metadata and warmup", () => {
  const timings = {};
  const transform = { k: 4 };
  const { cache, calls, owner } = createOwnerHarness({
    signature: "political-signature",
    passCounterNames: ["politicalCounter"],
    visibleFrameIdentity: {
      politicalDataStage: "coarse",
      fullPoliticalReady: false,
      finePoliticalCacheReady: false,
      sceneGeneration: 1,
      scenarioDataGeneration: 2,
    },
  });
  cache.dirty.political = true;

  const summary = owner.commitRenderPass({
    passName: "political",
    transform,
    drawResult: {
      politicalDataStage: "fine",
      fullPoliticalReady: true,
      finePoliticalCacheReady: true,
      sceneGeneration: 7,
      scenarioDataGeneration: 8,
    },
    timings,
    passStart: 700,
  });

  assert.equal(summary.committed, true);
  assert.equal(summary.politicalFineCacheReady, true);
  assert.equal(cache.politicalPassSceneGeneration, 7);
  assert.equal(cache.politicalPassScenarioDataGeneration, 8);
  assert.equal(cache.politicalPassDataStage, "fine");
  assert.equal(cache.politicalPassFullReady, true);
  assert.equal(cache.politicalPassFineCacheReady, true);
  assert.equal(cache.signatures.political, "political-signature");
  assert.equal(cache.dirty.political, false);
  assert.equal(cache.partialPoliticalDirtyIds.cleared, true);
  assert.deepEqual(timings, { political: 1 });
  assert.deepEqual(calls, [
    ["getRenderPassCacheState"],
    ["setPassReferenceTransform", "political", transform],
    ["getVisibleFrameIdentity", transform],
    ["setPassFullReferenceTransform", "political", transform],
    ["getRenderPassSignature", "political", transform],
    ["schedulePoliticalPathWarmup", transform],
    ["recordPassTiming", "political", 700],
    ["getPassCounterNames", "political"],
    ["incrementPerfCounter", "politicalCounter"],
  ]);
});

test("commits political non-fine cache metadata and clears full transform", () => {
  const timings = {};
  const transform = { k: 5 };
  const { cache, calls, owner } = createOwnerHarness({
    signature: "political-coarse-signature",
    passCounterNames: [],
    visibleFrameIdentity: {
      politicalDataStage: "coarse",
      fullPoliticalReady: true,
      finePoliticalCacheReady: false,
      sceneGeneration: 10,
      scenarioDataGeneration: 11,
    },
  });

  const summary = owner.commitRenderPass({
    passName: "political",
    transform,
    drawResult: {},
    timings,
    passStart: 800,
  });

  assert.equal(summary.committed, true);
  assert.equal(summary.politicalFineCacheReady, false);
  assert.equal(cache.politicalPassSceneGeneration, 10);
  assert.equal(cache.politicalPassScenarioDataGeneration, 11);
  assert.equal(cache.politicalPassDataStage, "coarse");
  assert.equal(cache.politicalPassFullReady, true);
  assert.equal(cache.politicalPassFineCacheReady, false);
  assert.equal(cache.partialPoliticalDirtyIds.cleared, false);
  assert.equal(calls.some((entry) => entry[0] === "schedulePoliticalPathWarmup"), false);
  assert.deepEqual(calls, [
    ["getRenderPassCacheState"],
    ["setPassReferenceTransform", "political", transform],
    ["getVisibleFrameIdentity", transform],
    ["clearPassFullReferenceTransforms", ["political"]],
    ["getRenderPassSignature", "political", transform],
    ["recordPassTiming", "political", 800],
    ["getPassCounterNames", "political"],
  ]);
});

test("resets contextScenario reuse accounting after commit", () => {
  const timings = {};
  const { cache, owner } = createOwnerHarness({
    signature: "scenario-signature",
    passCounterNames: [],
  });
  cache.counters.contextScenarioReuseCount = 9;

  owner.commitRenderPass({
    passName: "contextScenario",
    transform: { k: 1 },
    drawResult: undefined,
    timings,
    passStart: 600,
  });

  assert.equal(cache.signatures.contextScenario, "scenario-signature");
  assert.equal(cache.dirty.contextScenario, false);
  assert.equal(cache.counters.contextScenarioReuseCount, 0);
  assert.deepEqual(timings, { contextScenario: 1 });
});

test("requires declared dependencies", () => {
  assert.throws(
    () => createRenderPassCommitAccountingOwner({
      effects: {
        clearPassFullReferenceTransforms: () => {},
        incrementPerfCounter: () => {},
        recordPassTiming: () => {},
        recordRenderPerfMetric: () => {},
        schedulePoliticalPathWarmup: () => {},
        setPassFullReferenceTransform: () => {},
        setPassReferenceTransform: () => {},
      },
      getters: {
        getPassCounterNames: () => [],
        getRenderPassCacheState: () => ({}),
        getRenderPassSignature: () => "",
        getVisibleFrameIdentity: () => ({}),
      },
    }),
    /getters\.nowMs must be a function/,
  );
});

test("freezes returned summary and trace arrays", () => {
  const { owner } = createOwnerHarness();

  const summary = owner.commitRenderPass({
    passName: "contextBase",
    transform: { k: 1 },
    timings: {},
    passStart: 1,
  });

  assert.equal(Object.isFrozen(summary), true);
  assert.equal(Object.isFrozen(summary.effectOrder), true);
  assert.equal(Object.isFrozen(summary.getterOrder), true);
});
