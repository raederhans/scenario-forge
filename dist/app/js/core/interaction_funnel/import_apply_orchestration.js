import { restoreProjectImportFields as restoreScenarioPresentationImportFields } from "../state/actions/scenario_presentation_actions.js";
import { restoreProjectImportFields as restoreUiVisibilityImportFields } from "../state/actions/ui_visibility_actions.js";
import { restoreProjectImportFields as restoreAppearancePresetImportFields } from "../state/actions/appearance_preset_actions.js";
import { restoreProjectImportFields as restoreScenarioActivationImportFields } from "../state/actions/scenario_activation_actions.js";
import { restoreProjectImportFields as restoreRendererCacheImportFields } from "../state/actions/renderer_cache_actions.js";
import { restoreProjectImportFields as restoreExportWorkbenchImportFields } from "../state/actions/export_workbench_actions.js";
import { restoreProjectImportFields as restoreIntensityFieldImportFields } from "../state/actions/intensity_field_actions.js";
import { restoreProjectImportFields as restoreSpecialZoneImportFields } from "../state/actions/special_zone_actions.js";
import { restoreProjectImportFields as restoreStrategicOverlayImportFields } from "../state/actions/strategic_overlay_actions.js";
import { restoreProjectImportFields as restoreAppearanceImportFields } from "../state/actions/appearance_actions.js";
import { restoreProjectImportFields as restoreAppearanceVisibilityImportFields } from "../state/actions/appearance_visibility_actions.js";
import { restoreProjectImportFields as restoreAppearanceReferenceImportFields } from "../state/actions/appearance_reference_actions.js";
import { restoreProjectImportFields as restoreTransportImportFields } from "../state/actions/transport_actions.js";
import { restoreProjectImportFields as restoreRendererInteractionImportFields } from "../state/actions/renderer_interaction_actions.js";
import { applyProjectImportPatch } from "../state/actions/project_import_actions.js";

import {
  migrateFeatureScopedProjectDataToCurrentTopology,
} from "../sovereignty_manager.js";
import { state } from "../state.js";
import { getScenarioImportValidFeatureIds, resolveImportedOwnershipState } from "./import_trust_projection.js";
import {
  waitForScenarioApplyIdle,
  waitForStartupReadonlyUnlock,
} from "./wait_readiness.js";

// Commit and rollback use the same synchronous workflow; each action retains its domain.
export function commitImportedProjectPatch(target, patch) {
  restoreScenarioPresentationImportFields(target, patch);
  restoreUiVisibilityImportFields(target, patch);
  restoreAppearancePresetImportFields(target, patch);
  restoreScenarioActivationImportFields(target, patch);
  restoreRendererCacheImportFields(target, patch);
  restoreExportWorkbenchImportFields(target, patch);
  restoreIntensityFieldImportFields(target, patch);
  restoreSpecialZoneImportFields(target, patch);
  restoreStrategicOverlayImportFields(target, patch);
  restoreAppearanceImportFields(target, patch);
  restoreAppearanceVisibilityImportFields(target, patch);
  restoreAppearanceReferenceImportFields(target, patch);
  restoreTransportImportFields(target, patch);
  restoreRendererInteractionImportFields(target, patch);
  applyProjectImportPatch(target, patch);
}

export async function prepareImportedProjectState({
  data,
  ui,
  debugState,
  getScenarioResourcesModule,
  getScenarioManagerModule,
}) {
  const scenarioImportAudit = await resolveScenarioImportAudit(data, ui, getScenarioResourcesModule);
  debugState.importPhase = "validated";
  await waitForScenarioApplyIdle();
  await waitForStartupReadonlyUnlock();
  debugState.importPhase = "scenario-idle";
  const manager = await getScenarioManagerModule();
  const preparedScenario = await manager.prepareScenarioForProjectImport(data.scenario?.id || "");
  const scenarioState = preparedScenario ? {
    activeScenarioId: preparedScenario.staged.scenarioId,
    activeScenarioManifest: preparedScenario.bundle.manifest,
    scenarioBaselineOwnersByFeatureId: preparedScenario.staged.resolvedOwners,
    mapSemanticMode: preparedScenario.staged.mapSemanticMode,
    scenarioCountriesByTag: preparedScenario.staged.countryMap,
  } : { activeScenarioId: "", activeScenarioManifest: null, scenarioBaselineOwnersByFeatureId: {},
    scenarioCountriesByTag: {}, scenarioReleasableIndex: null };
  debugState.importPhase = "migration";
  const scenarioImportValidFeatureIds = getScenarioImportValidFeatureIds(state, preparedScenario);
  let migrationSummary = null;
  data = await migrateFeatureScopedProjectDataToCurrentTopology(data, {
    landData: scenarioImportValidFeatureIds ? null : state.landData,
    validFeatureIds: scenarioImportValidFeatureIds,
    onMigration: (summary) => { migrationSummary = summary; },
  });
  debugState.importPhase = "migration-done";
  return {
    data,
    preparedScenario, scenarioState, manager,
    validFeatureIds: scenarioImportValidFeatureIds,
    importedOwnershipState: resolveImportedOwnershipState(data, scenarioState),
    scenarioImportAudit,
    importSummary: {
      scenarioId: String(scenarioState.activeScenarioId || ""),
      scenarioName: String(scenarioState.activeScenarioManifest?.display_name || scenarioState.activeScenarioId || ""),
      restoredColorEntries: Object.keys(data.visualOverrides || {}).length,
      restoredOwnershipEntries: Object.keys(data.sovereigntyByFeatureId || {}).length,
      ignoredEntries: migrationSummary?.ignoredEntries ?? null,
      migratedEntries: migrationSummary?.migratedEntries ?? 0,
    },
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
