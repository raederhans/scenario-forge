import {
  EXACT_AFTER_SETTLE_ALWAYS_TARGET_PASSES,
  EXACT_AFTER_SETTLE_DEFERRED_PASS_NAMES,
  getExactAfterSettleDprRestorePasses,
} from "../renderer/exact_after_settle_pass_catalog.js";

function normalizeStringList(values = []) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : Array.from(values || []))
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
}

function createExactAfterSettleRefreshPlan({
  profile = null,
  scheduleStartedAt = 0,
  callbackStartedAt = 0,
  reuseDecision = {},
  forceExactContextBaseRefresh = false,
  urbanZoomExactRefresh = false,
  metricSequenceStartedAt = 0,
} = {}) {
  const startedAt = Math.max(0, Number(callbackStartedAt || 0));
  return {
    resolvedProfile: profile || {},
    reuseDecision: reuseDecision && typeof reuseDecision === "object" ? reuseDecision : {},
    forceExactContextBaseRefresh: !!forceExactContextBaseRefresh,
    urbanZoomExactRefresh: !!urbanZoomExactRefresh,
    exactRefreshApplied: !!forceExactContextBaseRefresh || !!reuseDecision?.shouldExactRefresh,
    exactTargetPasses: [],
    deferredExactTargetPasses: [],
    scheduleStartedAt: Math.max(0, Number(scheduleStartedAt || 0)),
    callbackStartedAt: startedAt,
    startedAt,
    metricSequenceStartedAt: Math.max(0, Number(metricSequenceStartedAt || 0)),
    settleWindowElapsedMs: Math.max(0, startedAt - Math.max(0, Number(scheduleStartedAt || 0))),
  };
}

function filterExactAfterSettleIdleRenderPassDefinitions(definitions = [], targetPasses = []) {
  const targetPassSet = new Set(normalizeStringList(targetPasses));
  return (Array.isArray(definitions) ? definitions : [])
    .filter(([passName]) => !targetPassSet.size || targetPassSet.has(String(passName || "").trim()));
}

function resolveExactAfterSettleTargetPasses({
  renderPassNames = [],
  idleRenderPassNames = [],
  dirtyPassNames = [],
  physicalExactRefreshPasses = [],
  deferredPassNames = EXACT_AFTER_SETTLE_DEFERRED_PASS_NAMES,
  forceExactContextBaseRefresh = false,
  exactRefreshApplied = false,
} = {}) {
  const normalizedIdleRenderPassNames = normalizeStringList(idleRenderPassNames);
  const orderedIdlePassNames = normalizedIdleRenderPassNames.length
    ? normalizedIdleRenderPassNames
    : normalizeStringList(renderPassNames);
  const validRenderPasses = new Set(normalizeStringList(renderPassNames));
  const deferredPasses = new Set(normalizeStringList(deferredPassNames));
  const targetPassNames = new Set(EXACT_AFTER_SETTLE_ALWAYS_TARGET_PASSES);

  if (forceExactContextBaseRefresh || exactRefreshApplied) {
    normalizeStringList(physicalExactRefreshPasses).forEach((passName) => targetPassNames.add(passName));
  }
  normalizeStringList(dirtyPassNames).forEach((passName) => {
    if (
      (!validRenderPasses.size || validRenderPasses.has(passName))
      && orderedIdlePassNames.includes(passName)
    ) {
      targetPassNames.add(passName);
    }
  });

  return {
    deferredExactTargetPasses: orderedIdlePassNames
      .filter((passName) => targetPassNames.has(passName) && deferredPasses.has(passName)),
    exactTargetPasses: orderedIdlePassNames
      .filter((passName) => targetPassNames.has(passName) && !deferredPasses.has(passName)),
  };
}

function resolveDeferredExactContextTargetPasses({
  plan = {},
  dirtyPassNames = [],
  deferredPassNames = EXACT_AFTER_SETTLE_DEFERRED_PASS_NAMES,
  idleRenderPassNames = [],
} = {}) {
  const deferredPasses = new Set(normalizeStringList(deferredPassNames));
  const targetPasses = new Set(normalizeStringList(plan?.deferredExactTargetPasses));
  normalizeStringList(dirtyPassNames).forEach((passName) => {
    if (deferredPasses.has(passName)) {
      targetPasses.add(passName);
    }
  });
  return normalizeStringList(idleRenderPassNames).filter((passName) => targetPasses.has(passName));
}

export {
  createExactAfterSettleRefreshPlan,
  EXACT_AFTER_SETTLE_DEFERRED_PASS_NAMES,
  filterExactAfterSettleIdleRenderPassDefinitions,
  getExactAfterSettleDprRestorePasses,
  resolveDeferredExactContextTargetPasses,
  resolveExactAfterSettleTargetPasses,
};
