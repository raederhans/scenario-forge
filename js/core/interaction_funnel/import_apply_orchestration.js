import {
  getFeatureId,
  hasFeatureOwnershipMap,
  migrateFeatureScopedProjectDataToCurrentTopology,
  normalizeFeatureOwnershipMap,
} from "../sovereignty_manager.js";
import { state } from "../state.js";
import {
  waitForScenarioApplyIdle,
  waitForStartupReadonlyUnlock,
} from "./wait_readiness.js";

export async function prepareImportedProjectState({
  data,
  ui,
  debugState,
  getScenarioResourcesModule,
  getScenarioDispatcherModule,
}) {
  const scenarioImportAudit = await resolveScenarioImportAudit(data, ui, getScenarioResourcesModule);
  debugState.importPhase = "validated";
  await waitForScenarioApplyIdle();
  await waitForStartupReadonlyUnlock();
  debugState.importPhase = "scenario-idle";
  await applyImportedScenarioSelection({
    data,
    debugState,
    getScenarioDispatcherModule,
  });

  debugState.importPhase = "migration";
  const scenarioImportValidFeatureIds = getScenarioImportValidFeatureIds();
  data = await migrateFeatureScopedProjectDataToCurrentTopology(data, {
    landData: scenarioImportValidFeatureIds ? null : state.landData,
    validFeatureIds: scenarioImportValidFeatureIds,
  });
  debugState.importPhase = "migration-done";
  return {
    data,
    importedOwnershipState: resolveImportedOwnershipState(data),
    scenarioImportAudit,
  };
}

async function resolveScenarioImportAudit(data, ui, getScenarioResourcesModule) {
  let scenarioImportAudit = data.scenario?.importAudit || null;
  if (!data.scenario?.id) {
    return scenarioImportAudit;
  }
  const { validateImportedScenarioBaseline } = await getScenarioResourcesModule();
  const validation = await validateImportedScenarioBaseline(data.scenario);
  if (validation.ok) {
    return scenarioImportAudit;
  }
  const shouldContinue =
    validation.reason === "baseline_mismatch"
      ? await ui.showAppDialog({
          title: ui.t("Scenario Baseline Mismatch", "ui"),
          message: validation.message,
          details: ui.t(
            "The saved project was created against a different scenario baseline. Continue only if you are comfortable loading it against current assets.",
            "ui"
          ),
          confirmLabel: ui.t("Load Anyway", "ui"),
          cancelLabel: ui.t("Cancel Import", "ui"),
          tone: "warning",
        })
      : false;
  if (!shouldContinue) {
    const error = new Error("Project import cancelled.");
    error.code = "IMPORT_ABORTED";
    error.toastTitle = ui.t("Import cancelled", "ui");
    error.toastTone = validation.reason === "baseline_mismatch" ? "warning" : "error";
    error.userMessage =
      validation.reason === "missing_scenario"
        ? validation.message
        : ui.t(
            "Project import cancelled because the saved scenario baseline does not match the current assets.",
            "ui"
          );
    throw error;
  }
  if (validation.reason === "baseline_mismatch") {
    scenarioImportAudit = {
      scenarioId: String(data.scenario.id || "").trim(),
      savedVersion: Number(data.scenario.version || 1) || 1,
      currentVersion: Number(validation.currentVersion || 1) || 1,
      savedBaselineHash: String(data.scenario.baselineHash || "").trim(),
      currentBaselineHash: String(validation.currentBaselineHash || "").trim(),
      acceptedAt: new Date().toISOString(),
    };
  }
  return scenarioImportAudit;
}

async function applyImportedScenarioSelection({
  data,
  debugState,
  getScenarioDispatcherModule,
}) {
  const importedScenarioId = String(data.scenario?.id || "").trim();
  const currentScenarioId = String(state.activeScenarioId || "").trim();
  if (importedScenarioId) {
    const {
      applyScenarioByIdCommand,
      resetScenarioToBaselineCommand,
      setScenarioViewModeCommand,
    } = await getScenarioDispatcherModule();
    if (importedScenarioId === currentScenarioId) {
      debugState.importPhase = "scenario-reset";
      resetScenarioToBaselineCommand({
        renderMode: "none",
        markDirtyReason: "",
        showToastOnComplete: false,
      });
    } else {
      debugState.importPhase = "scenario-apply";
      await applyScenarioByIdCommand(importedScenarioId, {
        renderMode: "none",
        markDirtyReason: "",
        showToastOnComplete: false,
      });
    }
    setScenarioViewModeCommand(data.scenario.viewMode || "ownership", {
      renderMode: "none",
      markDirtyReason: "",
    });
    return;
  }
  if (state.activeScenarioId) {
    const { clearActiveScenarioCommand } = await getScenarioDispatcherModule();
    debugState.importPhase = "scenario-clear";
    clearActiveScenarioCommand({
      renderMode: "none",
      markDirtyReason: "",
      showToastOnComplete: false,
    });
  }
}

function getScenarioImportValidFeatureIds() {
  if (!String(state.activeScenarioId || "").trim()) {
    return null;
  }
  if (Array.isArray(state.runtimeFeatureIds) && state.runtimeFeatureIds.length) {
    return new Set(
      state.runtimeFeatureIds
        .map((featureId) => String(featureId || "").trim())
        .filter(Boolean)
    );
  }
  if (state.runtimeFeatureIndexById instanceof Map && state.runtimeFeatureIndexById.size) {
    return new Set(
      Array.from(state.runtimeFeatureIndexById.keys())
        .map((featureId) => String(featureId || "").trim())
        .filter(Boolean)
    );
  }
  const runtimeGeometries = state.runtimePoliticalTopology?.objects?.political?.geometries;
  if (Array.isArray(runtimeGeometries) && runtimeGeometries.length) {
    return new Set(runtimeGeometries.map((geometry) => getFeatureId(geometry)).filter(Boolean));
  }
  return null;
}

function resolveImportedOwnershipState(data) {
  const hasScenarioControllerMap = hasFeatureOwnershipMap(data?.scenarioControllersByFeatureId);
  const importedOwnersByFeatureId = normalizeFeatureOwnershipMap(data.sovereigntyByFeatureId);
  const importedControllersByFeatureId = hasScenarioControllerMap
    ? normalizeFeatureOwnershipMap(data.scenarioControllersByFeatureId)
    : null;
  if (state.activeScenarioId) {
    return {
      sovereigntyByFeatureId: {
        ...(state.scenarioBaselineOwnersByFeatureId || {}),
        ...importedOwnersByFeatureId,
      },
      scenarioControllersByFeatureId: hasScenarioControllerMap
        ? importedControllersByFeatureId
        : { ...(state.scenarioBaselineControllersByFeatureId || {}) },
      shouldRestoreScenarioBaselineControllers: !hasScenarioControllerMap,
    };
  }
  return {
    sovereigntyByFeatureId: importedOwnersByFeatureId,
    scenarioControllersByFeatureId: hasScenarioControllerMap ? importedControllersByFeatureId : {},
    shouldRestoreScenarioBaselineControllers: false,
  };
}
