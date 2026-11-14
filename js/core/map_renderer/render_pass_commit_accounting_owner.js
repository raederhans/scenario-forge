import { requireFunction } from "../renderer/require_named_function.js";
const REQUIRED_EFFECT_NAMES = Object.freeze([
  "clearPassFullReferenceTransforms",
  "incrementPerfCounter",
  "recordPassTiming",
  "recordRenderPerfMetric",
  "schedulePoliticalPathWarmup",
  "setPassFullReferenceTransform",
  "setPassReferenceTransform",
]);

const REQUIRED_GETTER_NAMES = Object.freeze([
  "getPassCounterNames",
  "getRenderPassCacheState",
  "getRenderPassSignature",
  "getVisibleFrameIdentity",
  "nowMs",
]);

function createTrace() {
  return {
    effectOrder: [],
    getterOrder: [],
  };
}

function createSummary({
  passName,
  committed = false,
  skipped = false,
  skipReason = "",
  dirtyCleared = false,
  signatureUpdated = false,
  timingRecorded = false,
  politicalFineCacheReady = false,
  hostSummary = null,
  trace,
}) {
  return Object.freeze({
    passName,
    committed: Boolean(committed),
    skipped: Boolean(skipped),
    skipReason: String(skipReason || ""),
    dirtyCleared: Boolean(dirtyCleared),
    signatureUpdated: Boolean(signatureUpdated),
    timingRecorded: Boolean(timingRecorded),
    politicalFineCacheReady: Boolean(politicalFineCacheReady),
    hostSummary,
    effectOrder: Object.freeze([...(trace?.effectOrder || [])]),
    getterOrder: Object.freeze([...(trace?.getterOrder || [])]),
  });
}

export function createRenderPassCommitAccountingOwner({ effects = {}, getters = {} } = {}) {
  const effectApi = Object.fromEntries(
    REQUIRED_EFFECT_NAMES.map((name) => [name, requireFunction(effects, name, "effects")]),
  );
  const getterApi = Object.fromEntries(
    REQUIRED_GETTER_NAMES.map((name) => [name, requireFunction(getters, name, "getters")]),
  );

  function runEffect(trace, name, ...args) {
    trace.effectOrder.push(name);
    return effectApi[name](...args);
  }

  function runGetter(trace, name, ...args) {
    trace.getterOrder.push(name);
    return getterApi[name](...args);
  }

  function commitRenderPass({
    passName,
    transform,
    drawResult,
    timings,
    passStart = 0,
    hostSummary = null,
  } = {}) {
    const trace = createTrace();
    const normalizedPassName = String(passName || "");
    if (drawResult && typeof drawResult === "object" && drawResult.committed === false) {
      const reason = String(drawResult.reason || "draw-declined-commit");
      runEffect(
        trace,
        "recordRenderPerfMetric",
        "renderPassCommitSkipped",
        runGetter(trace, "nowMs") - Number(passStart || 0),
        { passName: normalizedPassName, reason },
      );
      return createSummary({
        passName: normalizedPassName,
        skipped: true,
        skipReason: reason,
        hostSummary,
        trace,
      });
    }

    const cache = runGetter(trace, "getRenderPassCacheState");
    runEffect(trace, "setPassReferenceTransform", normalizedPassName, transform);
    let politicalFineCacheReady = false;
    if (normalizedPassName === "political") {
      const identity = runGetter(trace, "getVisibleFrameIdentity", transform);
      const politicalDataStage = String(drawResult?.politicalDataStage || identity.politicalDataStage || "unknown");
      const fullPoliticalReady = !!(drawResult?.fullPoliticalReady ?? identity.fullPoliticalReady);
      // political pass 的 full reference 只在 fine cache 可用时保留，避免 coarse 帧污染后续复用判断。
      politicalFineCacheReady = politicalDataStage === "fine"
        && !!(drawResult?.finePoliticalCacheReady ?? identity.finePoliticalCacheReady);
      cache.politicalPassSceneGeneration = Number(drawResult?.sceneGeneration ?? identity.sceneGeneration ?? 0);
      cache.politicalPassScenarioDataGeneration = Number(drawResult?.scenarioDataGeneration ?? identity.scenarioDataGeneration ?? 0);
      cache.politicalPassDataStage = politicalDataStage;
      cache.politicalPassFullReady = fullPoliticalReady;
      cache.politicalPassFineCacheReady = politicalFineCacheReady;
      if (politicalFineCacheReady) {
        runEffect(trace, "setPassFullReferenceTransform", normalizedPassName, transform);
      } else {
        runEffect(trace, "clearPassFullReferenceTransforms", [normalizedPassName]);
      }
    }

    cache.signatures[normalizedPassName] = runGetter(
      trace,
      "getRenderPassSignature",
      normalizedPassName,
      transform,
    );
    cache.dirty[normalizedPassName] = false;
    if (normalizedPassName === "political" && politicalFineCacheReady) {
      cache.partialPoliticalDirtyIds.clear();
      runEffect(trace, "schedulePoliticalPathWarmup", transform);
    }
    runEffect(trace, "recordPassTiming", timings, normalizedPassName, passStart);
    runGetter(trace, "getPassCounterNames", normalizedPassName)
      .forEach((counterName) => runEffect(trace, "incrementPerfCounter", counterName));
    if (normalizedPassName === "contextScenario") {
      cache.counters.contextScenarioReuseCount = 0;
    }

    return createSummary({
      passName: normalizedPassName,
      committed: true,
      dirtyCleared: true,
      signatureUpdated: true,
      timingRecorded: true,
      politicalFineCacheReady,
      hostSummary,
      trace,
    });
  }

  return Object.freeze({
    commitRenderPass,
  });
}
