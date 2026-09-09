import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createPostReadyScheduler } from "../js/bootstrap/post_ready_scheduler.js";

const renderer = readFileSync(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
const source = renderer.slice(renderer.indexOf("async function yieldInteractionInfrastructureBuild("), renderer.indexOf("function getHitFromEvent("));

test("a cancelled full infrastructure build cannot publish ready and a current caller takes over", async () => {
  let releaseYield;
  let beginYield;
  const yielded = new Promise((resolve) => { beginYield = resolve; });
  const deferredYield = new Promise((resolve) => { releaseYield = resolve; });
  let yields = 0;
  let rank = 1;
  const states = [];
  const renderRequests = [];
  const runtimeState = { interactionInfrastructureBuildInFlight: false, hitCanvasDirty: false };
  const dependencies = {
    runtimeState,
    getInteractionInfrastructureStageRank: () => rank,
    setInteractionInfrastructureState: (stage, { inFlight }) => {
      states.push(stage);
      runtimeState.interactionInfrastructureBuildInFlight = inFlight;
      if (stage === "ready") rank = 2;
    },
    buildIndexChunked: async ({ isCurrent }) => assert.equal(isCurrent(), true),
    buildSpatialIndexChunked: async ({ isCurrent }) => assert.equal(isCurrent(), true),
    isInteractionRecoveryBlocked: () => false,
    yieldToMain: async () => { if (++yields === 1) { beginYield(); await deferredYield; } },
    ensureSovereigntyState() {}, rebuildResolvedColors() {}, scheduleSecondarySpatialIndexBuild() {},
    recordInteractionRecoveryTaskMetric() {}, nowMs: () => 0,
    requestRendererRender: (...args) => { renderRequests.push(args); return true; },
  };
  const build = new Function(...Object.keys(dependencies), `let interactionInfrastructureBasicPromise = null; let interactionInfrastructureFullPromise = null; ${source}\nreturn buildInteractionInfrastructureAfterStartup;`)(...Object.values(dependencies));
  function context(controller) {
    return {
      isCurrent: () => !controller.signal.aborted,
      yield: dependencies.yieldToMain,
      waitFor: async (promise) => promise,
      throwIfStale() { if (controller.signal.aborted) throw new DOMException("cancelled", "AbortError"); },
    };
  }
  const oldController = new AbortController();
  const old = build({ buildHitCanvas: false, taskContext: context(oldController) });
  await yielded;
  oldController.abort();
  const current = build({ buildHitCanvas: false, taskContext: context(new AbortController()) });
  const duplicate = build({ buildHitCanvas: false, taskContext: context(new AbortController()) });
  releaseYield();
  await assert.rejects(old, { name: "AbortError" });
  assert.equal(await current, true);
  assert.equal(await duplicate, true);
  assert.equal(states.filter((stage) => stage === "ready").length, 1);
  assert.equal(runtimeState.interactionInfrastructureBuildInFlight, false);
  assert.deepEqual(renderRequests, [["startup-full-interaction-infra", { flush: false }]]);
});

test("real scheduler completes full infrastructure while its own in-flight flag is set", async () => {
  let rank = 1;
  let yields = 0;
  const dirtyPasses = new Set();
  const renderRequests = [];
  let consumeRequestedRender = null;
  const runtimeState = { bootBlocking: false, renderPhase: "idle", interactionInfrastructureBuildInFlight: false, hitCanvasDirty: false };
  const dependencies = {
    runtimeState,
    getInteractionInfrastructureStageRank: () => rank,
    setInteractionInfrastructureState: (stage, { inFlight }) => {
      runtimeState.interactionInfrastructureBuildInFlight = inFlight;
      if (stage === "ready") rank = 2;
    },
    buildSpatialIndexChunked: async ({ isCurrent, yieldControl }) => {
      await yieldControl();
      assert.equal(isCurrent(), true);
    },
    isInteractionRecoveryBlocked: () => false,
    yieldToMain: async () => { yields += 1; await new Promise((resolve) => setTimeout(resolve, 0)); },
    ensureSovereigntyState() {},
    rebuildResolvedColors() {
      for (const pass of ["physicalBase", "political", "contextBase"]) dirtyPasses.add(pass);
    },
    scheduleSecondarySpatialIndexBuild() {},
    recordInteractionRecoveryTaskMetric() {}, nowMs: () => 0,
    requestRendererRender: (reason, options) => {
      assert.equal(rank, 2, "publish ready before requesting the visible update");
      renderRequests.push([reason, options]);
      consumeRequestedRender = () => dirtyPasses.clear();
      return true;
    },
  };
  const build = new Function(...Object.keys(dependencies), `let interactionInfrastructureBasicPromise = null; let interactionInfrastructureFullPromise = null; ${source}\nreturn buildInteractionInfrastructureAfterStartup;`)(...Object.values(dependencies));
  const scheduler = createPostReadyScheduler({ targetState: runtimeState });
  try {
    const result = await new Promise((resolve, reject) => {
      scheduler.scheduleTask("post-ready-full-interaction-infra", async (taskContext) => {
        try { resolve(await build({ buildHitCanvas: false, taskContext })); }
        catch (error) { reject(error); }
      }, { delayMs: 0, maxRunMs: 1000 });
    });
    assert.equal(result, true);
    assert.equal(rank, 2);
    assert.equal(runtimeState.interactionInfrastructureBuildInFlight, false);
    assert.equal(yields, 3);
    assert.deepEqual(renderRequests, [["startup-full-interaction-infra", { flush: false }]]);
    assert.deepEqual([...dirtyPasses].sort(), ["contextBase", "physicalBase", "political"]);
    consumeRequestedRender();
    assert.equal(dirtyPasses.size, 0, "the requested normal render consumes late color invalidations");
  } finally {
    scheduler.reset("test-cleanup");
  }
});

test("old infrastructure catch cannot clear in-flight state owned by a newer same-scenario import epoch", async () => {
  let releaseYield;
  let beginYield;
  const yielded = new Promise((resolve) => { beginYield = resolve; });
  const deferredYield = new Promise((resolve) => { releaseYield = resolve; });
  const runtimeState = {
    activeScenarioId: "A", currentScenarioApplyRequestId: 1,
    renderTransactionDiagnostics: { scenarioApplyEpoch: 1 },
    interactionInfrastructureBuildInFlight: false, hitCanvasDirty: false,
  };
  const stages = [];
  const renderRequests = [];
  const dependencies = {
    runtimeState,
    getInteractionInfrastructureStageRank: () => 1,
    setInteractionInfrastructureState: (stage, { inFlight }) => {
      stages.push(stage);
      runtimeState.interactionInfrastructureBuildInFlight = inFlight;
    },
    isInteractionRecoveryBlocked: () => false,
    yieldToMain: async () => { beginYield(); await deferredYield; },
    ensureSovereigntyState() {}, nowMs: () => 0,
    requestRendererRender: (...args) => { renderRequests.push(args); return true; },
  };
  const build = new Function(...Object.keys(dependencies), `let interactionInfrastructureBasicPromise = null; let interactionInfrastructureFullPromise = null; ${source}\nreturn buildInteractionInfrastructureAfterStartup;`)(...Object.values(dependencies));
  const taskContext = {
    isCurrent: () => runtimeState.renderTransactionDiagnostics.scenarioApplyEpoch === 1,
    throwIfStale() { if (!this.isCurrent()) throw new DOMException("superseded", "AbortError"); },
  };
  const old = build({ taskContext, buildHitCanvas: false });
  await yielded;
  runtimeState.renderTransactionDiagnostics.scenarioApplyEpoch = 2;
  stages.length = 0;
  releaseYield();
  await assert.rejects(old, { name: "AbortError" });
  assert.equal(runtimeState.interactionInfrastructureBuildInFlight, true);
  assert.deepEqual(stages, []);
  assert.deepEqual(renderRequests, []);
});

test("full infrastructure without a task context cannot publish or request render after identity replacement", async () => {
  for (const replacedIdentity of ["scenario", "request", "epoch"]) {
    const runtimeState = {
      activeScenarioId: "A", currentScenarioApplyRequestId: 1,
      renderTransactionDiagnostics: { scenarioApplyEpoch: 1 },
      interactionInfrastructureBuildInFlight: false, hitCanvasDirty: false,
    };
    const stages = [];
    const renderRequests = [];
    const dependencies = {
      runtimeState,
      getInteractionInfrastructureStageRank: () => 1,
      setInteractionInfrastructureState: (stage) => stages.push(stage),
      isInteractionRecoveryBlocked: () => false,
      yieldToMain: async () => {},
      ensureSovereigntyState() {}, rebuildResolvedColors() {},
      buildSpatialIndexChunked: async () => {
        if (replacedIdentity === "scenario") runtimeState.activeScenarioId = "B";
        if (replacedIdentity === "request") runtimeState.currentScenarioApplyRequestId = 2;
        if (replacedIdentity === "epoch") runtimeState.renderTransactionDiagnostics.scenarioApplyEpoch = 2;
        runtimeState.interactionInfrastructureBuildInFlight = true;
        stages.length = 0;
      },
      scheduleSecondarySpatialIndexBuild() {},
      recordInteractionRecoveryTaskMetric() {}, nowMs: () => 0,
      requestRendererRender: (...args) => { renderRequests.push(args); return true; },
    };
    const build = new Function(...Object.keys(dependencies), `let interactionInfrastructureBasicPromise = null; let interactionInfrastructureFullPromise = null; ${source}\nreturn buildInteractionInfrastructureAfterStartup;`)(...Object.values(dependencies));
    assert.equal(await build({ buildHitCanvas: false }), false, replacedIdentity);
    assert.deepEqual(stages, [], replacedIdentity);
    assert.deepEqual(renderRequests, [], replacedIdentity);
    assert.equal(runtimeState.interactionInfrastructureBuildInFlight, true, "replacement retains ownership");
  }
});
