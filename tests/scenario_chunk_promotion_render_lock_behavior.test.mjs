import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { bindRenderBoundary, requestRender, markRenderBoundaryFlushed } from "../js/core/render_boundary.js";

const source = readFileSync(new URL("../js/core/scenario/chunk_runtime.js", import.meta.url), "utf8");
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

function createFixture({ renderNow = true, previousRenderLock = false, rollbackCurrent = false } = {}) {
  const loadState = { promotionCommitRunId: 1 };
  const runtimeState = { runtimeChunkLoadState: loadState, landData: { features: [{}] }, scenarioChunkPromotionRenderLocked: previousRenderLock };
  const flushLocks = [];
  const mutations = [];
  const frames = [];
  let current = true;
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
    runtimeState, loadState, previousRenderLock, pendingPromotion: { reason: "scenario-apply-detail-prewarm", changedLayerKeys: ["political"] },
    mergedLayerPayloads: { political: { features: [{}] } }, bundle: {},
    runId: 1, promotionCommitRunId: 1, scenarioId: "tno_1962", promotionScenarioApplyEpoch: 1, promotionScenarioApplyRequestId: 1,
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
    isPendingScenarioChunkPromotionCurrent: () => current,
    canRollbackPromotionContinuation: () => rollbackCurrent,
    restoreMergedLayerRuntimeSnapshot: () => mutations.push(["restore-infra"]),
    restoreScenarioDataGenerationSnapshot: () => mutations.push(["restore-root"]),
    mergedLayerSnapshot: {},
    getFeatureCount: () => 1, getColorCount: () => 1,
    applyScenarioPoliticalChunkPayload: () => { dirty = true; mutations.push(["payload"]); return true; },
    refreshScenarioRenderVisibleOptionalChunkPayloadChange: noop,
    requestRender,
  };
  const run = () => new Function(...Object.keys(deps), `return (async () => { ${commitBody} })();`)(...Object.values(deps));
  return { runtimeState, flushLocks, mutations, frames, run, scheduledRenders, isDirty: () => dirty, makeStale: () => {
    current = false;
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
  const fixture = createFixture({ rollbackCurrent: true });
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
