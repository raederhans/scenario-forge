import { normalizeMapSemanticMode, state } from "./state.js";
import { t } from "../ui/i18n.js";
import { showToast } from "../ui/toast.js";

function getScenarioEffectiveOwnerCodeByFeatureId(featureId) {
  const normalizedId = String(featureId || "").trim();
  if (!normalizedId) return "";
  return String(
    state.sovereigntyByFeatureId?.[normalizedId] ||
      state.runtimeCanonicalCountryByFeatureId?.[normalizedId] ||
      ""
  )
    .trim()
    .toUpperCase();
}

function getScenarioEffectiveControllerCodeByFeatureId(featureId) {
  const normalizedId = String(featureId || "").trim();
  if (!normalizedId) return "";
  return String(
    state.scenarioControllersByFeatureId?.[normalizedId] ||
      getScenarioEffectiveOwnerCodeByFeatureId(normalizedId) ||
      ""
  )
    .trim()
    .toUpperCase();
}

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
  return state.scenarioFatalRecovery && typeof state.scenarioFatalRecovery === "object"
    ? state.scenarioFatalRecovery
    : null;
}

export function clearScenarioFatalRecoveryState() {
  state.scenarioFatalRecovery = null;
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
  const activeScenarioId = String(state.activeScenarioId || "").trim();
  const manifestScenarioId = String(state.activeScenarioManifest?.scenario_id || "").trim();
  const normalizedExpectedScenarioId = String(expectedScenarioId || "").trim();
  const mapSemanticMode = normalizeMapSemanticMode(state.mapSemanticMode);
  const requiredObjects = [
    ["sovereigntyByFeatureId", state.sovereigntyByFeatureId],
    ["scenarioControllersByFeatureId", state.scenarioControllersByFeatureId],
    ["scenarioBaselineOwnersByFeatureId", state.scenarioBaselineOwnersByFeatureId],
    ["scenarioBaselineControllersByFeatureId", state.scenarioBaselineControllersByFeatureId],
  ];

  if (normalizedExpectedScenarioId && activeScenarioId !== normalizedExpectedScenarioId) {
    problems.push(`active scenario id mismatch (${activeScenarioId || "none"} != ${normalizedExpectedScenarioId}).`);
  }
  if (activeScenarioId && manifestScenarioId !== activeScenarioId) {
    problems.push(`manifest scenario id mismatch (${manifestScenarioId || "none"} != ${activeScenarioId}).`);
  }
  if (activeScenarioId && !String(state.scenarioBaselineHash || "").trim()) {
    problems.push("scenarioBaselineHash is empty while a scenario is active.");
  }
  requiredObjects.forEach(([fieldName, value]) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      problems.push(`${fieldName} must be a plain object while a scenario is active.`);
    }
  });

  const sampleFeatureId =
    Object.keys(state.scenarioBaselineOwnersByFeatureId || {}).find(Boolean) ||
    Object.keys(state.sovereigntyByFeatureId || {}).find(Boolean) ||
    Object.keys(state.scenarioBaselineControllersByFeatureId || {}).find(Boolean) ||
    Object.keys(state.scenarioControllersByFeatureId || {}).find(Boolean) ||
    "";
  if (activeScenarioId && !sampleFeatureId && mapSemanticMode !== "blank") {
    problems.push("No feature assignments are available in the active scenario state.");
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
  state.scenarioFatalRecovery = {
    phase: String(phase || "rollback"),
    message: detail,
    recordedAt: new Date().toISOString(),
    problems: Array.isArray(consistencyReport?.problems) ? [...consistencyReport.problems] : [],
    rootErrorMessage: String(rootError?.message || "").trim(),
    rollbackErrorMessage: String(rollbackError?.message || "").trim(),
  };
  showToast(formatScenarioFatalRecoveryMessage(state.scenarioFatalRecovery), {
    title: t("Scenario recovery failed", "ui"),
    tone: "error",
    duration: 7000,
  });
  if (typeof syncUi === "function") {
    syncUi();
  }
  return state.scenarioFatalRecovery;
}

export function assertStartupReadonlyUnlocked(actionLabel = "complete this startup action") {
  if (!state.startupReadonly) return;
  throw new Error(
    `Detailed interactions are still loading. Unable to ${actionLabel} while the startup view is read-only.`
  );
}

export function assertScenarioInteractionsAllowed(actionLabel = "complete this scenario action") {
  assertStartupReadonlyUnlocked(actionLabel);
  if (!getScenarioFatalRecoveryState()) return;
  throw buildScenarioFatalRecoveryError(actionLabel);
}
