// Canonical transaction-diagnostics writes; callers supply sampled timestamps.
export function ensureRenderTransactionDiagnosticsState(target) {
  if (!target.renderTransactionDiagnostics || typeof target.renderTransactionDiagnostics !== "object") {
    target.renderTransactionDiagnostics = {
      sequence: 0,
      scenarioApplyEpoch: 0,
      renderTransactionEpoch: 0,
      enabled: false,
      maxSnapshots: 1,
      snapshots: [],
      warnings: [],
      latestSnapshot: null,
      latestWarning: null,
      lastAcceptedFrameIdentity: null,
      lastRenderPassInvalidation: null,
      scenarioApplyEpochByScenarioId: {},
      optionalLayerConfigs: null,
      globalName: "__scenarioForgeRenderTransactions",
    };
  }
  target.renderTransactionDiagnostics.sequence = Math.max(0, Number(target.renderTransactionDiagnostics.sequence || 0));
  target.renderTransactionDiagnostics.scenarioApplyEpoch = Math.max(0, Number(target.renderTransactionDiagnostics.scenarioApplyEpoch || 0));
  target.renderTransactionDiagnostics.renderTransactionEpoch = Math.max(0, Number(target.renderTransactionDiagnostics.renderTransactionEpoch || 0));
  target.renderTransactionDiagnostics.maxSnapshots = Math.max(1, Number(target.renderTransactionDiagnostics.maxSnapshots || 1));
  target.renderTransactionDiagnostics.snapshots = Array.isArray(target.renderTransactionDiagnostics.snapshots) ? target.renderTransactionDiagnostics.snapshots : [];
  target.renderTransactionDiagnostics.warnings = Array.isArray(target.renderTransactionDiagnostics.warnings) ? target.renderTransactionDiagnostics.warnings : [];
  target.renderTransactionDiagnostics.scenarioApplyEpochByScenarioId =
    target.renderTransactionDiagnostics.scenarioApplyEpochByScenarioId && typeof target.renderTransactionDiagnostics.scenarioApplyEpochByScenarioId === "object"
      ? target.renderTransactionDiagnostics.scenarioApplyEpochByScenarioId
      : {};
  target.renderTransactionDiagnostics.globalName = "__scenarioForgeRenderTransactions";
}

export function advanceScenarioApplyEpochState(target, { scenarioId = "", reason = "", recordedAt } = {}) {
  ensureRenderTransactionDiagnosticsState(target);
  target.renderTransactionDiagnostics.scenarioApplyEpoch += 1;
  const normalizedScenarioId = String(scenarioId || "").trim();
  target.renderTransactionDiagnostics.lastScenarioApply = {
    scenarioId: normalizedScenarioId,
    reason: String(reason || ""),
    recordedAt,
  };
  if (normalizedScenarioId) {
    target.renderTransactionDiagnostics.scenarioApplyEpochByScenarioId[normalizedScenarioId] = target.renderTransactionDiagnostics.scenarioApplyEpoch;
  }
  return Number(target.renderTransactionDiagnostics.scenarioApplyEpoch);
}
