import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { bindRenderBoundary, requestRender, markRenderBoundaryFlushed } from "../js/core/render_boundary.js";
import { isPendingScenarioChunkPromotionCurrent } from "../js/core/scenario/chunk_promotion_queries.js";
import { captureScenarioChunkLoadStateContinuation } from "../js/core/state/actions/scenario_chunk_runtime_actions.js";

const source = readFileSync(new URL("../js/core/scenario/chunk_runtime.js", import.meta.url), "utf8");
const guardsStart = source.indexOf("    const isPromotionCurrent =");
const guardsEnd = source.indexOf("    if (!isPromotionCurrent())", guardsStart);
const rollbackStart = source.indexOf("    const canRollbackPromotionContinuation =");
const rollbackEnd = source.indexOf("    const restoreScenarioDataGenerationSnapshot =", rollbackStart);
assert.ok(guardsStart >= 0 && guardsEnd > guardsStart);
assert.ok(rollbackStart > guardsEnd && rollbackEnd > rollbackStart);
const guardDeclarations = source.slice(guardsStart, guardsEnd) + source.slice(rollbackStart, rollbackEnd);
const start = source.indexOf("    setScenarioChunkPromotionRenderLockState(runtimeState, true);");
const end = source.indexOf("      const visualEndedAt =", start);
assert.ok(start >= 0 && end > start);
// Execute the production infra/visual commit and both frame continuations, ending
// at its final render boundary; metrics and later commit bookkeeping are irrelevant here.
const finallyStart = source.indexOf("    } finally {", end);
const functionEnd = source.indexOf("\n  async function runPendingScenarioChunkPromotionCommit", finallyStart);
assert.ok(finallyStart > end && functionEnd > finallyStart);
const finalizer = source.slice(finallyStart, functionEnd).trimEnd();
const commitBody = source.slice(start, end) + "return true; " + finalizer.slice(0, finalizer.lastIndexOf("}"));

function createFixture({ renderNow = true, previousRenderLock = false, runId = 1 } = {}) {
  const pendingPromotion = {
    scenarioId: "tno_1962", selectionVersion: 1, scenarioApplyRequestId: 1,
    reason: "scenario-apply-detail-prewarm", changedLayerKeys: ["political"],
  };
  const loadState = { promotionCommitRunId: 1, generation: 1, selectionVersion: 1, pendingPromotion };
  const runtimeState = {
    runtimeChunkLoadState: loadState, landData: { features: [{}] },
    scenarioChunkPromotionRenderLocked: previousRenderLock,
    activeScenarioId: "tno_1962", currentScenarioApplyRequestId: 1,
    latestScenarioApplyRequestId: 1, latestScenarioApplyTargetId: "tno_1962",
  };
  const flushLocks = [];
  const mutations = [];
  const frames = [];
  let dirty = false;
  const scheduledRenders = [];
  bindRenderBoundary({
    scheduleRender: () => {
      flushLocks.push(runtimeState.scenarioChunkPromotionRenderLocked);
      scheduledRenders.push(() => {
        if (!runtimeState.scenarioChunkPromotionRenderLocked) dirty = false;
        markRenderBoundaryFlushed();
      });
    },
    flushRender: () => { throw new Error("promotion must not synchronously flush render passes"); },
  });
  const noop = () => {};
  const deps = {
    runtimeState, loadState, previousRenderLock, pendingPromotion,
    mergedLayerPayloads: { political: { features: [{}] } }, bundle: {},
    runId, promotionCommitRunId: 1, scenarioId: "tno_1962", promotionScenarioApplyEpoch: 1, promotionScenarioApplyRequestId: 1,
    promotionContinuationState: captureScenarioChunkLoadStateContinuation(runtimeState),
    captureScenarioChunkLoadStateContinuation,
    resolvedRenderNow: renderNow, allowStartupInitialVisual: false,
    setScenarioChunkPromotionRenderLockState: (state, locked) => {
      state.scenarioChunkPromotionRenderLocked = locked;
      mutations.push(["lock", locked]);
    },
    setPromotionCommitStatus: noop, recordScenarioChunkRuntimeMetric: noop,
    recordRenderTransactionSnapshot: noop, getSearchParams: () => new URLSearchParams(),
    applyMergedScenarioChunkLayerPayloads: () => ({ changed: true, changedLayerKeys: ["political"] }),
    yieldToFrame: () => new Promise((resolve) => frames.push(resolve)),
    normalizeScenarioId: value => String(value || "").trim(),
    isPendingScenarioChunkPromotionCurrent,
    restoreMergedLayerRuntimeSnapshot: () => mutations.push(["restore-infra"]),
    restoreScenarioDataGenerationSnapshot: () => mutations.push(["restore-root"]),
    mergedLayerSnapshot: {},
    getFeatureCount: () => 1, getColorCount: () => 1,
    applyScenarioPoliticalChunkPayload: () => { dirty = true; mutations.push(["payload"]); return true; },
    refreshScenarioRenderVisibleOptionalChunkPayloadChange: noop,
    requestRender,
  };
  // Use the controller's actual guards and lexical run identity, so each yield
  // observes mutations made after the execution started instead of a cached flag.
  const execution = new Function(...Object.keys(deps), `${guardDeclarations}
    return {
      run: async () => { ${commitBody} },
      isPromotionCurrent, ownsPromotionRun, canRollbackPromotionContinuation,
      replaceControllerRun: (id) => { promotionCommitRunId = id; },
    };`)(...Object.values(deps));
  return { runtimeState, loadState, flushLocks, mutations, frames, ...execution, scheduledRenders, isDirty: () => dirty, makeStale: () => {
    runtimeState.runtimeChunkLoadState = { promotionCommitRunId: 2 };
    runtimeState.scenarioChunkPromotionRenderLocked = true;
  } };
}

for (const renderNow of [true, false]) {
  test(`promotion keeps both frame breaks locked and restores before final render (renderNow=${renderNow})`, async () => {
    const fixture = createFixture({ renderNow });
    const completion = fixture.run();
    assert.equal(fixture.runtimeState.scenarioChunkPromotionRenderLocked, true);
    fixture.frames.shift()();
    await Promise.resolve();
    assert.equal(fixture.runtimeState.scenarioChunkPromotionRenderLocked, true);
    assert.equal(fixture.isDirty(), true);
    assert.deepEqual(fixture.flushLocks, []);
    fixture.frames.shift()();
    await Promise.resolve();
    if (renderNow) {
      assert.equal(fixture.isDirty(), true, "the scheduled draw has not run yet");
      fixture.scheduledRenders.shift()();
      fixture.frames.shift()();
    }
    assert.equal(await completion, true);
    assert.deepEqual(fixture.flushLocks, renderNow ? [false] : []);
    assert.equal(fixture.runtimeState.scenarioChunkPromotionRenderLocked, false);
    assert.equal(fixture.isDirty(), !renderNow);
  });
}

test("a replaced scenario during either frame break cannot flush or unlock its replacement", async () => {
  for (const staleFrame of [0, 1, 2]) {
    const fixture = createFixture();
    const completion = fixture.run();
    for (let index = 0; index < staleFrame; index += 1) {
      fixture.frames.shift()();
      await Promise.resolve();
    }
    fixture.makeStale();
    const before = [...fixture.mutations];
    fixture.frames.shift()();
    assert.equal(await completion, false);
    assert.deepEqual(fixture.flushLocks, staleFrame === 2 ? [false] : []);
    assert.deepEqual(fixture.mutations, before);
    assert.equal(fixture.runtimeState.scenarioChunkPromotionRenderLocked, true);
  }
});

test("promotion preserves a lock already owned by its caller", async () => {
  const fixture = createFixture({ previousRenderLock: true });
  const completion = fixture.run();
  fixture.frames.shift()();
  await Promise.resolve();
  fixture.frames.shift()();
  await Promise.resolve();
  fixture.scheduledRenders.shift()();
  fixture.frames.shift()();
  assert.equal(await completion, true);
  assert.deepEqual(fixture.flushLocks, [true]);
  assert.equal(fixture.runtimeState.scenarioChunkPromotionRenderLocked, true);
});

test("a new gesture at the infra yield defers heavy visual work and restores the owned snapshot", async () => {
  const fixture = createFixture();
  const completion = fixture.run();
  fixture.runtimeState.zoomGestureStartTransform = { x: 1, y: 0, k: 2 };
  // Even a gesture already ended by this continuation must invalidate it.
  fixture.runtimeState.renderPhase = "idle";
  fixture.frames.shift()();
  assert.equal(await completion, false);
  assert.deepEqual(fixture.mutations, [["lock", true], ["restore-infra"], ["restore-root"], ["lock", false]]);
  assert.equal(fixture.isDirty(), false);
  assert.deepEqual(fixture.flushLocks, []);
});

for (const reason of ["new selection", "queued scenario"]) {
  test(`${reason} prevents publication but permits owned rollback and lock cleanup`, async () => {
    const fixture = createFixture();
    const completion = fixture.run();
    if (reason === "new selection") {
      fixture.loadState.selectionVersion += 1;
    } else {
      fixture.runtimeState.latestScenarioApplyRequestId += 1;
      fixture.runtimeState.latestScenarioApplyTargetId = "hoi4_1939";
    }
    assert.equal(fixture.isPromotionCurrent(), false);
    assert.equal(fixture.canRollbackPromotionContinuation(), true);
    assert.equal(fixture.ownsPromotionRun(), true);
    fixture.frames.shift()();
    assert.equal(await completion, false);
    assert.deepEqual(fixture.mutations, [["lock", true], ["restore-infra"], ["restore-root"], ["lock", false]]);
    assert.equal(fixture.isDirty(), false);
    assert.deepEqual(fixture.flushLocks, []);
  });
}

for (const replacement of ["pending promotion", "load generation"]) {
  test(`${replacement} replacement forbids rollback while the old run still releases its own lock`, async () => {
    const fixture = createFixture();
    const completion = fixture.run();
    if (replacement === "pending promotion") {
      fixture.loadState.pendingPromotion = { ...fixture.loadState.pendingPromotion };
    } else {
      fixture.loadState.generation += 1;
      fixture.loadState.selectionVersion += 1;
    }
    assert.equal(fixture.canRollbackPromotionContinuation(), false);
    assert.equal(fixture.ownsPromotionRun(), true);
    fixture.frames.shift()();
    assert.equal(await completion, false);
    assert.deepEqual(fixture.mutations, [["lock", true], ["lock", false]]);
  });
}

test("a superseding controller run cannot be unlocked by the old continuation", async () => {
  const fixture = createFixture();
  const completion = fixture.run();
  fixture.replaceControllerRun(2);
  assert.equal(fixture.isPromotionCurrent(), false);
  assert.equal(fixture.canRollbackPromotionContinuation(), false);
  assert.equal(fixture.ownsPromotionRun(), false);
  fixture.frames.shift()();
  assert.equal(await completion, false);
  assert.deepEqual(fixture.mutations, [["lock", true]]);
  assert.equal(fixture.runtimeState.scenarioChunkPromotionRenderLocked, true);
});

test("legacy run zero may pass the publication fence without owning a numbered run's cleanup", () => {
  const fixture = createFixture({ runId: 0 });
  assert.equal(fixture.isPromotionCurrent(), true);
  assert.equal(fixture.canRollbackPromotionContinuation(), true);
  assert.equal(fixture.ownsPromotionRun(), false);
});
