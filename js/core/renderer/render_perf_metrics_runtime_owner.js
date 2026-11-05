function requireFunction(candidate, label) {
  if (typeof candidate !== "function") {
    throw new TypeError(`${label} must be a function.`);
  }
  return candidate;
}

function requireNameSet(candidate, label) {
  if (!candidate || typeof candidate.has !== "function") {
    throw new TypeError(`${label} must provide has().`);
  }
  return candidate;
}

export function createRenderPerfMetricsRuntimeOwner({
  constants = {},
  getters = {},
  effects = {},
} = {}) {
  const contextBreakdownMetricNames = requireNameSet(
    constants.contextBreakdownMetricNames,
    "constants.contextBreakdownMetricNames",
  );
  const getRenderPerfContextBreakdownSnapshot = requireFunction(
    getters.getRenderPerfContextBreakdownSnapshot,
    "getters.getRenderPerfContextBreakdownSnapshot",
  );
  const getRenderPerfMetricSequence = requireFunction(
    getters.getRenderPerfMetricSequence,
    "getters.getRenderPerfMetricSequence",
  );
  const nowMs = requireFunction(getters.nowMs, "getters.nowMs");
  const ensureRenderPerfMetricsState = requireFunction(
    effects.ensureRenderPerfMetricsState,
    "effects.ensureRenderPerfMetricsState",
  );
  const commitRenderPerfMetricState = requireFunction(
    effects.commitRenderPerfMetricState,
    "effects.commitRenderPerfMetricState",
  );
  const setRenderPerfContextBreakdownState = requireFunction(
    effects.setRenderPerfContextBreakdownState,
    "effects.setRenderPerfContextBreakdownState",
  );

  let activeContextMetricSession = null;

  function ensureRenderPerfMetrics() {
    return ensureRenderPerfMetricsState();
  }

  function recordRenderPerfMetric(name, durationMs, details = {}) {
    ensureRenderPerfMetrics();
    const normalizedName = String(name || "").trim();
    if (!normalizedName) return null;
    const nextSequence = Math.max(0, Number(getRenderPerfMetricSequence() || 0)) + 1;
    const nextEntry = {
      durationMs: Math.max(0, Number(durationMs) || 0),
      recordedAt: nowMs(),
      ...details,
      sequence: nextSequence,
    };
    commitRenderPerfMetricState({
      name: normalizedName,
      entry: nextEntry,
      sequence: nextSequence,
    });
    return nextEntry;
  }

  function beginContextMetricSession() {
    activeContextMetricSession = {
      metrics: {},
    };
  }

  function collectContextMetric(name, durationMs, details = {}) {
    const normalizedName = String(name || "").trim();
    if (!normalizedName) return null;
    const nextEntry = {
      durationMs: Math.max(0, Number(durationMs) || 0),
      recordedAt: nowMs(),
      ...details,
    };
    if (!activeContextMetricSession?.metrics) {
      return recordRenderPerfMetric(normalizedName, nextEntry.durationMs, details);
    }
    const existingEntry = activeContextMetricSession.metrics[normalizedName];
    if (!existingEntry) {
      activeContextMetricSession.metrics[normalizedName] = {
        ...nextEntry,
        callCount: 1,
      };
      return activeContextMetricSession.metrics[normalizedName];
    }
    activeContextMetricSession.metrics[normalizedName] = {
      ...existingEntry,
      ...details,
      durationMs: Math.max(0, Number(existingEntry.durationMs || 0) + nextEntry.durationMs),
      recordedAt: nextEntry.recordedAt,
      callCount: Math.max(1, Number(existingEntry.callCount || 1) + 1),
    };
    return activeContextMetricSession.metrics[normalizedName];
  }

  function endContextMetricSession() {
    const session = activeContextMetricSession;
    activeContextMetricSession = null;
    ensureRenderPerfMetrics();
    const breakdown = getRenderPerfContextBreakdownSnapshot();
    const sessionMetrics = session?.metrics && typeof session.metrics === "object"
      ? session.metrics
      : {};
    Object.entries(sessionMetrics).forEach(([name, entry]) => {
      if (!entry || typeof entry !== "object") return;
      const { durationMs, ...details } = entry;
      const recordedEntry = recordRenderPerfMetric(name, durationMs, details);
      if (contextBreakdownMetricNames.has(name) && recordedEntry) {
        breakdown[name] = { ...recordedEntry };
      }
    });
    setRenderPerfContextBreakdownState(breakdown);
    return breakdown;
  }

  function resetContextBreakdownForExactFrame() {
    setRenderPerfContextBreakdownState({});
  }

  return Object.freeze({
    ensureRenderPerfMetrics,
    recordRenderPerfMetric,
    beginContextMetricSession,
    collectContextMetric,
    endContextMetricSession,
    resetContextBreakdownForExactFrame,
  });
}
