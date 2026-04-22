import { normalizeMapSemanticMode, state as runtimeState } from "./state.js";
import { t } from "../ui/i18n.js";
import { showToast } from "../ui/toast.js";
import {
  getScenarioEffectiveControllerCodeByFeatureId,
  getScenarioEffectiveOwnerCodeByFeatureId,
} from "./scenario_runtime_queries.js";
const state = runtimeState;

function getScenarioTestHooks() {
  return globalThis.__scenarioTestHooks && typeof globalThis.__scenarioTestHooks === "object"
    ? globalThis.__scenarioTestHooks
    : null;
}

function consumeScenarioTestHook(name) {
  const hooks = getScenarioTestHooks();
  if (!hooks || !hooks[name]) return false;
  delete hooks[name];
  return true;
}

export { consumeScenarioTestHook };

export function getScenarioFatalRecoveryState() {
  return runtimeState.scenarioFatalRecovery && typeof runtimeState.scenarioFatalRecovery === "object"
    ? runtimeState.scenarioFatalRecovery
    : null;
}

export function clearScenarioFatalRecoveryState() {
  runtimeState.scenarioFatalRecovery = null;
}

export function formatScenarioFatalRecoveryMessage(fatalState = getScenarioFatalRecoveryState()) {
  const baseMessage = t("Scenario state is inconsistent. Reload the page before continuing.", "ui");
  const detail = String(fatalState?.message || "").trim();
  return detail ? `${baseMessage} ${detail}` : baseMessage;
}

export function buildScenarioFatalRecoveryError(actionLabel = "complete this scenario action") {
  const message = formatScenarioFatalRecoveryMessage();
  const error = new Error(message);
  error.code = "SCENARIO_FATAL_RECOVERY";
  error.toastTitle = t("Scenario locked", "ui");
  error.toastTone = "error";
  error.userMessage = message;
  error.actionLabel = actionLabel;
  return error;
}

export function validateScenarioRuntimeConsistency({ expectedScenarioId = "", phase = "apply" } = {}) {
  const problems = [];
  const activeScenarioId = String(runtimeState.activeScenarioId || "").trim();
  const manifestScenarioId = String(runtimeState.activeScenarioManifest?.scenario_id || "").trim();
  const normalizedExpectedScenarioId = String(expectedScenarioId || "").trim();
  const mapSemanticMode = normalizeMapSemanticMode(runtimeState.mapSemanticMode);
  const requiredObjects = [
    ["sovereigntyByFeatureId", runtimeState.sovereigntyByFeatureId],
    ["scenarioControllersByFeatureId", runtimeState.scenarioControllersByFeatureId],
    ["scenarioBaselineOwnersByFeatureId", runtimeState.scenarioBaselineOwnersByFeatureId],
    ["scenarioBaselineControllersByFeatureId", runtimeState.scenarioBaselineControllersByFeatureId],
  ];

  if (normalizedExpectedScenarioId && activeScenarioId !== normalizedExpectedScenarioId) {
    problems.push(`active scenario id mismatch (${activeScenarioId || "none"} != ${normalizedExpectedScenarioId}).`);
  }
  if (activeScenarioId && manifestScenarioId !== activeScenarioId) {
    problems.push(`manifest scenario id mismatch (${manifestScenarioId || "none"} != ${activeScenarioId}).`);
  }
  if (activeScenarioId && !String(runtimeState.scenarioBaselineHash || "").trim()) {
    problems.push("scenarioBaselineHash is empty while a scenario is active.");
  }
  requiredObjects.forEach(([fieldName, value]) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      problems.push(`${fieldName} must be a plain object while a scenario is active.`);
    }
  });

  const sampleFeatureId =
    Object.keys(runtimeState.scenarioBaselineOwnersByFeatureId || {}).find(Boolean) ||
    Object.keys(runtimeState.sovereigntyByFeatureId || {}).find(Boolean) ||
    Object.keys(runtimeState.scenarioBaselineControllersByFeatureId || {}).find(Boolean) ||
    Object.keys(runtimeState.scenarioControllersByFeatureId || {}).find(Boolean) ||
    "";
  if (activeScenarioId && !sampleFeatureId && mapSemanticMode !== "blank") {
    problems.push("No feature assignments are available in the active scenario runtimeState.");
  } else if (sampleFeatureId) {
    if (!getScenarioEffectiveOwnerCodeByFeatureId(sampleFeatureId)) {
      problems.push(`Effective owner lookup failed for ${sampleFeatureId}.`);
    }
    if (!getScenarioEffectiveControllerCodeByFeatureId(sampleFeatureId)) {
      problems.push(`Effective controller lookup failed for ${sampleFeatureId}.`);
    }
  }

  const forcedFailureHookName =
    phase === "rollback" ? "forceRollbackConsistencyFailureOnce" : "forceApplyConsistencyFailureOnce";
  if (consumeScenarioTestHook(forcedFailureHookName)) {
    problems.push(`Injected ${phase} consistency failure.`);
  }

  return {
    ok: problems.length === 0,
    problems,
    activeScenarioId,
    manifestScenarioId,
    expectedScenarioId: normalizedExpectedScenarioId,
    phase,
  };
}

export function enterScenarioFatalRecovery({
  phase = "rollback",
  rootError = null,
  rollbackError = null,
  consistencyReport = null,
  syncUi = null,
} = {}) {
  const problemSummary = Array.isArray(consistencyReport?.problems) && consistencyReport.problems.length
    ? consistencyReport.problems.slice(0, 3).join(" ")
    : "";
  const detail = rollbackError
    ? t("Rollback recovery failed.", "ui")
    : problemSummary || t("Rollback validation failed.", "ui");
  runtimeState.scenarioFatalRecovery = {
    phase: String(phase || "rollback"),
    message: detail,
    recordedAt: new Date().toISOString(),
    problems: Array.isArray(consistencyReport?.problems) ? [...consistencyReport.problems] : [],
    rootErrorMessage: String(rootError?.message || "").trim(),
    rollbackErrorMessage: String(rollbackError?.message || "").trim(),
  };
  runtimeState.scenarioApplyInFlight = false;
  showToast(formatScenarioFatalRecoveryMessage(runtimeState.scenarioFatalRecovery), {
    title: t("Scenario recovery failed", "ui"),
    tone: "error",
    duration: 7000,
  });
  if (typeof syncUi === "function") {
    syncUi();
  }
  return runtimeState.scenarioFatalRecovery;
}

export function assertStartupReadonlyUnlocked(actionLabel = "complete this startup action") {
  if (!runtimeState.startupReadonly) return;
  throw new Error(
    `Detailed interactions are still loading. Unable to ${actionLabel} while the startup view is read-only.`
  );
}

export function assertScenarioInteractionsAllowed(
  actionLabel = "complete this scenario action",
  { allowDuringBootBlocking = false } = {}
) {
  if (!allowDuringBootBlocking && runtimeState.bootBlocking !== false) {
    throw new Error(
      `Startup is still completing. Unable to ${actionLabel} until the workspace leaves boot blocking mode.`
    );
  }
  assertStartupReadonlyUnlocked(actionLabel);
  if (!getScenarioFatalRecoveryState()) return;
  throw buildScenarioFatalRecoveryError(actionLabel);
}

