import { setFirstVisibleFramePaintedState } from "../state/actions/renderer_diagnostics_actions.js";

const REQUIRED_EFFECT_NAMES = Object.freeze([
  "incrementPerfCounter",
  "recordVisibleFrameTransactionDiagnostics",
  "recordRenderPerfMetric",
  "callFirstVisibleFramePaintedHook",
]);

const REQUIRED_GETTER_NAMES = Object.freeze([
  "getRenderPassCacheState",
  "getDefaultTransform",
  "getCommittedFrameIdentity",
  "getCommittedFrameKeySignature",
  "getFrameStateSnapshot",
  "getFirstVisiblePoliticalFrameBlockReason",
  "getOceanBaseFillColor",
  "hasFirstVisibleFramePainted",
]);

const STATUS_COUNTER_NAMES = Object.freeze({
  committed: "visibleFrameCommittedCount",
  reused: "visibleFrameReusedCount",
  rejected: "visibleFrameRejectedCount",
  missing: "visibleFrameMissingCount",
  blocked: "visibleFrameBlockedCount",
});

function requireFunction(source, name, label) {
  const candidate = source?.[name];
  if (typeof candidate !== "function") {
    throw new TypeError(`${label}.${name} must be a function.`);
  }
  return candidate;
}

function normalizeReason(reason, defaultReason) {
  const normalized = String(reason || "").trim();
  return normalized || defaultReason;
}

function normalizeStatus(status) {
  return String(status || "").trim() || "unknown";
}

function createTrace() {
  return {
    effectOrder: [],
    getterOrder: [],
    counterOrder: [],
  };
}

function createSummary({
  status,
  reason,
  accepted = false,
  blockReason = "",
  paintSource = "",
  firstVisibleAction = "",
  diagnosticSnapshot = null,
  metricEntry = null,
  trace,
}) {
  return Object.freeze({
    status,
    reason,
    accepted: Boolean(accepted),
    blockReason,
    paintSource,
    firstVisibleAction,
    diagnosticRecorded: Boolean(diagnosticSnapshot),
    metricRecorded: Boolean(metricEntry),
    diagnosticSnapshot,
    metricEntry,
    effectOrder: Object.freeze([...(trace?.effectOrder || [])]),
    getterOrder: Object.freeze([...(trace?.getterOrder || [])]),
    counterOrder: Object.freeze([...(trace?.counterOrder || [])]),
  });
}

export function createVisibleFrameDiagnosticsOwner({ runtimeState, effects = {}, getters = {} } = {}) {
  const effectApi = Object.fromEntries(
    REQUIRED_EFFECT_NAMES.map((name) => [name, requireFunction(effects, name, "effects")]),
  );
  effectApi.setFirstVisibleFramePainted = (painted) => setFirstVisibleFramePaintedState(runtimeState, painted);
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

  function incrementCounter(trace, counterName) {
    trace.counterOrder.push(counterName);
    runEffect(trace, "incrementPerfCounter", counterName);
  }

  function readFrameState(trace) {
    const snapshot = runGetter(trace, "getFrameStateSnapshot");
    return snapshot && typeof snapshot === "object" ? snapshot : {};
  }

  function recordVisibleFrameTransactionCore(status, details = {}, trace = createTrace()) {
    const normalizedStatus = normalizeStatus(status);
    incrementCounter(trace, "visibleFrameTransactionCount");
    const statusCounterName = STATUS_COUNTER_NAMES[normalizedStatus];
    if (statusCounterName) incrementCounter(trace, statusCounterName);

    const cache = runGetter(trace, "getRenderPassCacheState") || {};
    const {
      transform: metricTransform,
      durationMs: metricDurationMs,
      committedFrameIdentity: providedCommittedFrameIdentity,
      ...publicDetails
    } = details && typeof details === "object" ? details : {};
    const transform = metricTransform || runGetter(trace, "getDefaultTransform");
    const reason = String(details?.reason || cache.lastAction || "visible-frame");
    const paintSource = String(details?.paintSource || "");
    const blockReason = String(details?.blockReason || "");
    const committedFrameIdentity = providedCommittedFrameIdentity || runGetter(trace, "getCommittedFrameIdentity", transform, {
      status: normalizedStatus,
      reason,
      paintSource,
      blockReason,
    });
    const identity = {
      ...(committedFrameIdentity?.commitKey || {}),
      ...(committedFrameIdentity?.metadata || {}),
    };
    const frameState = readFrameState(trace);
    const visibleFrameCommitKey = runGetter(trace, "getCommittedFrameKeySignature", committedFrameIdentity?.commitKey);
    const durationMs = Number(metricDurationMs || 0);
    const diagnosticSnapshot = runEffect(trace, "recordVisibleFrameTransactionDiagnostics", {
      status: normalizedStatus,
      reason,
      details,
      identity,
      committedFrameIdentity,
      visibleFrameCommitKey,
      durationMs,
    });
    const metricEntry = runEffect(trace, "recordRenderPerfMetric", "visibleFrameTransaction", durationMs, {
      ...publicDetails,
      status: normalizedStatus,
      reason,
      paintSource,
      accepted: normalizedStatus === "committed" || normalizedStatus === "reused",
      blockReason,
      activeScenarioId: String(details?.activeScenarioId || identity.scenarioId || frameState.activeScenarioId || ""),
      sceneGeneration: Number(details?.sceneGeneration ?? identity.sceneGeneration ?? frameState.sceneGeneration ?? 0),
      scenarioDataGeneration: Number(details?.scenarioDataGeneration ?? identity.scenarioDataGeneration ?? frameState.scenarioDataGeneration ?? 0),
      topologyRevision: Number(details?.topologyRevision ?? identity.topologyRevision ?? frameState.topologyRevision ?? 0),
      colorRevision: Number(details?.colorRevision ?? identity.colorRevision ?? frameState.colorRevision ?? 0),
      selectionVersion: Number(details?.selectionVersion ?? identity.selectionVersion ?? frameState.selectionVersion ?? 0),
      politicalDataStage: String(details?.politicalDataStage || identity.politicalDataStage || ""),
      fullPoliticalReady: !!(details?.fullPoliticalReady ?? identity.fullPoliticalReady),
      finePoliticalCacheReady: !!(details?.finePoliticalCacheReady ?? identity.finePoliticalCacheReady),
      phase: String(details?.phase || frameState.renderPhase || ""),
      count: Number(cache.counters?.visibleFrameTransactionCount || 0),
      committedCount: Number(cache.counters?.visibleFrameCommittedCount || 0),
      reusedCount: Number(cache.counters?.visibleFrameReusedCount || 0),
      rejectedCount: Number(cache.counters?.visibleFrameRejectedCount || 0),
      missingCount: Number(cache.counters?.visibleFrameMissingCount || 0),
      blockedCount: Number(cache.counters?.visibleFrameBlockedCount || 0),
      staleAgeMs: Math.max(0, Number(details?.staleAgeMs || 0)),
      dirtyFeatureCount: Math.max(0, Number(details?.dirtyFeatureCount || 0)),
      commitKey: visibleFrameCommitKey,
      committedFrameIdentity,
    });

    return {
      status: normalizedStatus,
      reason,
      accepted: normalizedStatus === "committed" || normalizedStatus === "reused",
      blockReason,
      paintSource,
      diagnosticSnapshot,
      metricEntry,
    };
  }

  function recordVisibleFrameTransaction(status, details = {}) {
    const trace = createTrace();
    return createSummary({
      ...recordVisibleFrameTransactionCore(status, details, trace),
      trace,
    });
  }

  function recordFirstVisibleFrameBlocked(reason = "visible-frame", blockReason = "unknown", trace = createTrace()) {
    const normalizedReason = normalizeReason(reason, "visible-frame");
    const normalizedBlockReason = normalizeReason(blockReason, "unknown");
    const frameState = readFrameState(trace);
    const oceanFill = runGetter(trace, "getOceanBaseFillColor");
    runEffect(trace, "recordRenderPerfMetric", "firstVisibleFrameBlocked", 0, {
      reason: normalizedReason,
      blockReason: normalizedBlockReason,
      activeScenarioId: String(frameState.activeScenarioId || ""),
      topologyRevision: Number(frameState.topologyRevision || 0),
      colorRevision: Number(frameState.colorRevision || 0),
      topologyBundleMode: String(frameState.topologyBundleMode || "single"),
      oceanFill,
    });
    return createSummary({
      ...recordVisibleFrameTransactionCore("blocked", {
        reason: normalizedReason,
        blockReason: normalizedBlockReason,
        paintSource: "first-visible-frame",
      }, trace),
      firstVisibleAction: "blocked",
      trace,
    });
  }

  function markFirstVisibleFramePainted(reason = "visible-frame") {
    const trace = createTrace();
    const normalizedReason = normalizeReason(reason, "visible-frame");
    if (runGetter(trace, "hasFirstVisibleFramePainted")) {
      return createSummary({
        status: "skipped",
        reason: normalizedReason,
        firstVisibleAction: "already-painted",
        trace,
      });
    }
    const blockReason = String(runGetter(trace, "getFirstVisiblePoliticalFrameBlockReason", normalizedReason) || "");
    if (blockReason) {
      return recordFirstVisibleFrameBlocked(normalizedReason, blockReason, trace);
    }

    runEffect(trace, "setFirstVisibleFramePainted", true);
    const frameState = readFrameState(trace);
    const oceanFill = runGetter(trace, "getOceanBaseFillColor");
    runEffect(trace, "recordRenderPerfMetric", "firstVisibleFramePainted", 0, {
      reason: normalizedReason,
      activeScenarioId: String(frameState.activeScenarioId || ""),
      topologyRevision: Number(frameState.topologyRevision || 0),
      colorRevision: Number(frameState.colorRevision || 0),
      topologyBundleMode: String(frameState.topologyBundleMode || "single"),
      oceanFill,
    });
    const transform = runGetter(trace, "getDefaultTransform");
    const committedFrameIdentity = runGetter(trace, "getCommittedFrameIdentity", transform, {
      status: "committed",
      reason: normalizedReason,
      paintSource: "first-visible-frame",
    });
    const core = recordVisibleFrameTransactionCore("committed", {
      reason: normalizedReason,
      paintSource: "first-visible-frame",
      committedFrameIdentity,
    }, trace);
    runEffect(trace, "callFirstVisibleFramePaintedHook", {
      reason: normalizedReason,
      activeScenarioId: String(frameState.activeScenarioId || ""),
    });
    return createSummary({
      ...core,
      firstVisibleAction: "accepted",
      trace,
    });
  }

  function resetFirstVisibleFramePainted(reason = "visible-frame-reset") {
    const trace = createTrace();
    const normalizedReason = normalizeReason(reason, "visible-frame-reset");
    runEffect(trace, "setFirstVisibleFramePainted", false);
    const frameState = readFrameState(trace);
    const metricEntry = runEffect(trace, "recordRenderPerfMetric", "firstVisibleFramePaintedReset", 0, {
      reason: normalizedReason,
      activeScenarioId: String(frameState.activeScenarioId || ""),
    });
    return createSummary({
      status: "reset",
      reason: normalizedReason,
      firstVisibleAction: "reset",
      metricEntry,
      trace,
    });
  }

  return Object.freeze({
    recordVisibleFrameTransaction,
    recordFirstVisibleFrameBlocked,
    markFirstVisibleFramePainted,
    resetFirstVisibleFramePainted,
  });
}
