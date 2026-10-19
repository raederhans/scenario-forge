import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { bindRenderBoundary, requestRender, markRenderBoundaryFlushed } from "../js/core/render_boundary.js";
import { areScenarioFeatureCollectionsEquivalent, normalizeScenarioFeatureCollection } from "../js/core/scenario/pure_helpers.js";
import { isPendingScenarioChunkPromotionCurrent } from "../js/core/scenario/chunk_promotion_queries.js";

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
const preparationStart = source.indexOf("    // Prepare privately before taking the render lock");
const preparationEnd = source.indexOf("    const previousRenderLock", preparationStart);
const prepareBody = source.slice(preparationStart, preparationEnd);
const optionalRefreshStart = source.indexOf("  function refreshScenarioRenderVisibleOptionalChunkPayloadChange(");
const optionalRefreshEnd = source.indexOf("\n  function ", optionalRefreshStart + 1);
assert.ok(optionalRefreshStart > 0 && optionalRefreshEnd > optionalRefreshStart);
const optionalRefreshSource = source.slice(optionalRefreshStart, optionalRefreshEnd);

test("private preparation obtains its primary payload before the visual commit scope exists", async () => {
  const full = { features: [{ id: "a" }, { id: "b" }] };
  const primary = { features: [full.features[0]] };
  for (const subset of [primary, undefined]) {
    let captured;
    const deps = { runtimeState: {}, mergedLayerPayloads: { political: full },
      pendingPromotion: { primaryMergedLayerPayloads: subset ? { political: subset } : undefined },
      allowStartupInitialVisual: false, loadState: {}, scenarioId: "tno_1962", runId: 1, promotionCommitRunId: 1,
      normalizeScenarioId: value => value,
      normalizeScenarioFeatureCollection: value => value || null,
      areScenarioFeatureCollectionsEquivalent: () => false,
      isPendingScenarioChunkPromotionCurrent: () => true,
      prepareScenarioPoliticalChunkPromotion: async options => {
        captured = options;
        return { status: "prepared", isCurrent: () => true };
      },
      setPromotionCommitStatus: () => { throw new Error("valid preparation must not defer"); },
    };
    await new Function(...Object.keys(deps), `return (async () => { ${prepareBody} })();`)(...Object.values(deps));
    assert.equal(captured.politicalPayload, full);
    assert.equal(captured.primaryPoliticalPayload, subset || null);
    assert.equal(captured.isCurrent(), true);
  }
});

function createAtlantropaPreparationFixture() {
  const political = { type: "FeatureCollection", globalCoverage: true, features: [{ id: "land" }] };
  const previous = { type: "FeatureCollection", features: [{ id: "atl-old" }] };
  const next = { type: "FeatureCollection", features: [{ id: "atl-new" }] };
  const pendingPromotion = { selectionVersion: 1, scenarioApplyRequestId: 1 };
  const loadState = { selectionVersion: 1, promotionCommitRunId: 1, pendingPromotion };
  const runtimeState = { activeScenarioId: "tno_1962", runtimeChunkLoadState: loadState,
    currentScenarioApplyRequestId: 1, latestScenarioApplyRequestId: 1,
    scenarioPoliticalChunkData: political, scenarioAtlantropaData: previous };
  const calls = [], statuses = [];
  const candidate = { status: "prepared", isCurrent: () => calls[0].isCurrent() };
  const deps = { runtimeState, pendingPromotion, loadState, scenarioId: "tno_1962",
    runId: 1, promotionCommitRunId: 1, allowStartupInitialVisual: false,
    mergedLayerPayloads: { political, scenario_atlantropa: next },
    normalizeScenarioId: value => value, normalizeScenarioFeatureCollection,
    areScenarioFeatureCollectionsEquivalent, isPendingScenarioChunkPromotionCurrent,
    prepareScenarioPoliticalChunkPromotion: async options => { calls.push(options); return candidate; },
    setPromotionCommitStatus: (...args) => statuses.push(args),
  };
  const run = () => new Function(...Object.keys(deps), `return (async () => { ${prepareBody} return preparedPoliticalState; })();`)(...Object.values(deps));
  return { deps, run, calls, candidate, statuses, previous, next, political, runtimeState };
}

test("Atlantropa-only replacements and explicit clears prepare privately against the unchanged political payload", async () => {
  for (const clear of [false, true]) {
    const fixture = createAtlantropaPreparationFixture();
    if (clear) fixture.deps.mergedLayerPayloads.scenario_atlantropa = null;
    assert.equal(await fixture.run(), fixture.candidate);
    assert.equal(fixture.calls.length, 1);
    assert.equal(fixture.calls[0].atlantropaPayload, clear ? null : fixture.next);
    assert.equal(fixture.calls[0].politicalPayload.features, fixture.political.features);
    assert.equal(fixture.calls[0].isCurrent(), true);
    assert.equal(fixture.runtimeState.scenarioAtlantropaData, fixture.previous, "private preparation cannot publish payloads");
    assert.deepEqual(fixture.statuses, []);
  }
});

test("unchanged or absent Atlantropa payloads do not prepare for a selection hint alone", async () => {
  for (const absent of [false, true]) {
    const fixture = createAtlantropaPreparationFixture();
    fixture.deps.pendingPromotion.changedLayerKeys = ["scenario_atlantropa"];
    if (absent) delete fixture.deps.mergedLayerPayloads.scenario_atlantropa;
    else fixture.deps.mergedLayerPayloads.scenario_atlantropa = fixture.previous;
    assert.equal(await fixture.run(), null);
    assert.deepEqual(fixture.calls, []);
  }
});

test("Atlantropa preparation preserves the strategic-values mixed transaction and startup exceptions", async () => {
  for (const mode of ["changed-strategic", "unchanged-strategic", "startup"]) {
    const fixture = createAtlantropaPreparationFixture();
    const strategic = { features: [] };
    fixture.runtimeState.scenarioStrategicValuesData = strategic;
    fixture.deps.mergedLayerPayloads.strategicvalues = mode === "changed-strategic" ? { features: [] } : strategic;
    fixture.deps.allowStartupInitialVisual = mode === "startup";
    const shouldPrepare = mode === "unchanged-strategic";
    assert.equal(await fixture.run(), shouldPrepare ? fixture.candidate : null);
    assert.equal(fixture.calls.length, shouldPrepare ? 1 : 0);
  }
});

test("Atlantropa-only preparation cancels on gesture, selection, scenario or load ownership changes before publication", async () => {
  const invalidate = [
    state => { state.zoomGestureStartTransform = { k: 2 }; },
    state => { state.isInteracting = true; },
    state => { state.runtimeChunkLoadState.selectionVersion++; },
    state => { state.activeScenarioId = "replacement"; },
    state => { state.runtimeChunkLoadState = {}; },
    state => { state.currentScenarioApplyRequestId = 2; },
  ];
  for (const change of invalidate) {
    const fixture = createAtlantropaPreparationFixture();
    let resume;
    fixture.deps.prepareScenarioPoliticalChunkPromotion = async options => {
      fixture.calls.push(options);
      await new Promise(resolve => { resume = resolve; });
      return fixture.candidate;
    };
    const completion = fixture.run();
    assert.equal(fixture.calls[0].isCurrent(), true);
    change(fixture.runtimeState);
    assert.equal(fixture.calls[0].isCurrent(), false);
    resume();
    assert.equal(await completion, false);
    assert.equal(fixture.runtimeState.scenarioAtlantropaData, fixture.previous);
    assert.equal(fixture.runtimeState.scenarioChunkPromotionRenderLocked, undefined);
    assert.equal(fixture.statuses[0][0], "promotion-deferred");
  }
});

function createFixture({ renderNow = true, previousRenderLock = false, rollbackCurrent = false,
  preparedPoliticalState = null, optionalOnly = false } = {}) {
  const loadState = { promotionCommitRunId: 1 };
  const runtimeState = { runtimeChunkLoadState: loadState, landData: { features: [{}] }, scenarioChunkPromotionRenderLocked: previousRenderLock };
  const flushLocks = [];
  const mutations = [];
  const frames = [];
  let current = true;
  let dirty = false;
  const scheduledRenders = [];
  const refreshCalls = [];
  const previousAtlantropa = { features: [{ id: "old-atl" }] };
  const nextAtlantropa = { features: [{ id: "next-atl" }] };
  runtimeState.scenarioAtlantropaData = previousAtlantropa;
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
    runtimeState, loadState, previousRenderLock, preparedPoliticalState,
    pendingPromotion: { reason: "scenario-apply-detail-prewarm", changedLayerKeys: [optionalOnly ? "scenario_atlantropa" : "political"] },
    mergedLayerPayloads: { political: { features: [{}] } }, bundle: {},
    runId: 1, promotionCommitRunId: 1, scenarioId: "tno_1962", promotionScenarioApplyEpoch: 1, promotionScenarioApplyRequestId: 1,
    resolvedRenderNow: renderNow, allowStartupInitialVisual: false,
    setScenarioChunkPromotionRenderLockState: (state, locked) => {
      state.scenarioChunkPromotionRenderLocked = locked;
      mutations.push(["lock", locked]);
    },
    setPromotionCommitStatus: noop, recordScenarioChunkRuntimeMetric: noop,
    recordRenderTransactionSnapshot: noop, getSearchParams: () => new URLSearchParams(),
    applyMergedScenarioChunkLayerPayloads: () => {
      if (optionalOnly) runtimeState.scenarioAtlantropaData = nextAtlantropa;
      return { changed: true, changedLayerKeys: [optionalOnly ? "scenario_atlantropa" : "political"],
        renderVisibleChangedLayerKeys: optionalOnly ? ["scenario_atlantropa"] : [] };
    },
    yieldToFrame: () => new Promise((resolve) => frames.push(resolve)),
    normalizeScenarioId: value => String(value || "").trim(),
    isPendingScenarioChunkPromotionCurrent: () => current,
    canRollbackPromotionContinuation: () => rollbackCurrent,
    restoreMergedLayerRuntimeSnapshot: () => {
      runtimeState.scenarioAtlantropaData = previousAtlantropa;
      mutations.push(["restore-infra"]);
    },
    restoreScenarioDataGenerationSnapshot: () => mutations.push(["restore-root"]),
    mergedLayerSnapshot: {},
    getFeatureCount: () => 1, getColorCount: () => 1,
    applyScenarioPoliticalChunkPayload: (_bundle, _payload, options) => {
      assert.equal(options.preparedPoliticalState, preparedPoliticalState);
      if (optionalOnly) return false;
      dirty = true; mutations.push(["payload"]); return true;
    },
    refreshScenarioRenderVisibleOptionalChunkPayloadChange: noop,
    requestRender,
  };
  if (optionalOnly) {
    const refreshDeps = { runtimeState,
      bumpScenarioChunkDataGenerationState: () => mutations.push(["generation"]),
      refreshMapDataForScenarioChunkPromotion: options => {
        assert.equal(runtimeState.scenarioChunkPromotionRenderLocked, true);
        assert.equal(runtimeState.scenarioAtlantropaData, nextAtlantropa);
        if (options.preparedPoliticalState) assert.equal(options.preparedPoliticalState.isCurrent(), true);
        refreshCalls.push(options);
        dirty = true;
      },
    };
    deps.refreshScenarioRenderVisibleOptionalChunkPayloadChange = new Function(...Object.keys(refreshDeps), `${optionalRefreshSource}; return refreshScenarioRenderVisibleOptionalChunkPayloadChange;`)(...Object.values(refreshDeps));
  }
  const run = () => new Function(...Object.keys(deps), `return (async () => { ${commitBody} })();`)(...Object.values(deps));
  return { runtimeState, previousAtlantropa, nextAtlantropa, refreshCalls, flushLocks, mutations, frames, run, scheduledRenders, isDirty: () => dirty, makeStale: () => {
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

test("prepared political state remains guarded across both render-locked frame continuations", async () => {
  let candidateCurrent = true;
  const preparedPoliticalState = { status: "prepared", isCurrent: () => candidateCurrent };
  const fixture = createFixture({ preparedPoliticalState });
  const completion = fixture.run();
  assert.equal(fixture.runtimeState.scenarioChunkPromotionRenderLocked, true);
  candidateCurrent = false;
  fixture.frames.shift()();
  assert.equal(await completion, false);
  assert.equal(fixture.isDirty(), false);
  assert.deepEqual(fixture.flushLocks, []);
  assert.equal(fixture.runtimeState.scenarioChunkPromotionRenderLocked, false);
});

test("Atlantropa-only promotion forwards the exact prepared candidate through deferred optional refresh while locked", async () => {
  const candidate = { status: "prepared", isCurrent: () => true };
  const fixture = createFixture({ renderNow: false, preparedPoliticalState: candidate, optionalOnly: true });
  const completion = fixture.run();
  assert.equal(fixture.runtimeState.scenarioAtlantropaData, fixture.nextAtlantropa);
  assert.equal(fixture.runtimeState.scenarioChunkPromotionRenderLocked, true);
  assert.equal(fixture.refreshCalls.length, 0);
  fixture.frames.shift()();
  await Promise.resolve();
  assert.equal(fixture.refreshCalls.length, 0, "optional visual authority waits for the second continuation");
  fixture.frames.shift()();
  assert.equal(await completion, true);
  assert.equal(fixture.refreshCalls.length, 1);
  assert.equal(fixture.refreshCalls[0].preparedPoliticalState, candidate);
  assert.equal(fixture.refreshCalls[0].hasPoliticalPayloadChange, false);
  assert.deepEqual(fixture.refreshCalls[0].changedLayerKeys, ["scenario_atlantropa"]);
  assert.deepEqual(fixture.refreshCalls[0].politicalFeatureIds, []);
  assert.equal(fixture.runtimeState.scenarioChunkPromotionRenderLocked, false);
  assert.deepEqual(fixture.mutations, [["lock", true], ["generation"], ["lock", false], ["lock", false]]);
});

test("Atlantropa-only promotion retains its optional refresh when private preparation is unsupported", async () => {
  const fixture = createFixture({ renderNow: false, optionalOnly: true });
  const completion = fixture.run();
  fixture.frames.shift()();
  await Promise.resolve();
  fixture.frames.shift()();
  assert.equal(await completion, true);
  assert.equal(fixture.refreshCalls.length, 1);
  assert.equal(fixture.refreshCalls[0].preparedPoliticalState, null);
  assert.equal(fixture.refreshCalls[0].hasPoliticalPayloadChange, false);
  assert.equal(fixture.runtimeState.scenarioAtlantropaData, fixture.nextAtlantropa);
});

test("Atlantropa-only candidates invalidated at either frame break restore owned payloads without an optional rebuild", async () => {
  for (const frame of [0, 1]) {
    let current = true;
    const candidate = { status: "prepared", isCurrent: () => current };
    const fixture = createFixture({ renderNow: false, rollbackCurrent: true, preparedPoliticalState: candidate, optionalOnly: true });
    const completion = fixture.run();
    if (frame === 1) {
      fixture.frames.shift()();
      await Promise.resolve();
    }
    current = false;
    fixture.frames.shift()();
    assert.equal(await completion, false);
    assert.equal(fixture.runtimeState.scenarioAtlantropaData, fixture.previousAtlantropa);
    assert.deepEqual(fixture.refreshCalls, []);
    assert.deepEqual(fixture.mutations, [["lock", true], ["restore-infra"], ["restore-root"], ["lock", false]]);
    assert.equal(fixture.isDirty(), false);
    assert.equal(fixture.runtimeState.scenarioChunkPromotionRenderLocked, false);
  }
});
