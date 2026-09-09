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
  getFeatureId,
  migrateFeatureScopedProjectDataToCurrentTopology,
  normalizeFeatureOwnershipMap,
} from "../sovereignty_manager.js";
import { state } from "../state.js";
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
    runtimePoliticalTopology: preparedScenario.staged.runtimeTopologyPayload,
    runtimeFeatureIds: preparedScenario.staged.scenarioId === state.activeScenarioId ? state.runtimeFeatureIds : [],
    runtimeFeatureIndexById: preparedScenario.staged.scenarioId === state.activeScenarioId ? state.runtimeFeatureIndexById : null,
    mapSemanticMode: preparedScenario.staged.mapSemanticMode,
    scenarioCountriesByTag: preparedScenario.staged.countryMap,
  } : { activeScenarioId: "", activeScenarioManifest: null, scenarioBaselineOwnersByFeatureId: {},
    scenarioCountriesByTag: {}, scenarioReleasableIndex: null,
    runtimePoliticalTopology: state.defaultRuntimePoliticalTopology, runtimeFeatureIds: [], runtimeFeatureIndexById: null };
  const target = { ...state, ...scenarioState };
  debugState.importPhase = "migration";
  const scenarioImportValidFeatureIds = getScenarioImportValidFeatureIds(target);
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
    importedOwnershipState: resolveImportedOwnershipState(data, target),
    scenarioImportAudit,
    importSummary: {
      scenarioId: String(target.activeScenarioId || ""),
      scenarioName: String(target.activeScenarioManifest?.display_name || target.activeScenarioId || ""),
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

function getScenarioImportValidFeatureIds(target = state) {
  // Staged scenario topology omits global coarse/auxiliary features that the
  // runtime composites into the scene. Keep those trusted identities as well as
  // baseline owners for regions whose detail chunks are not loaded yet.
  const ids = new Set(Object.keys(target.scenarioBaselineOwnersByFeatureId || {}));
  const add = value => { const id = String(value || "").trim(); if (id) ids.add(id); };
  for (const id of Array.isArray(target.runtimeFeatureIds) ? target.runtimeFeatureIds : []) add(id);
  if (target.runtimeFeatureIndexById instanceof Map) target.runtimeFeatureIndexById.forEach((_value, id) => add(id));
  for (const topology of [
    target.runtimePoliticalTopology,
    target.defaultRuntimePoliticalTopology,
    target.topologyPrimary || target.topology,
    // Plain projects use base detail regions. A scenario instead supplies its
    // own trusted runtime topology and must not inherit a prior detail variant.
    !target.activeScenarioId ? target.topologyDetail : null,
  ]) {
    const geometries = topology?.objects?.political?.geometries;
    for (const geometry of Array.isArray(geometries) ? geometries : []) add(getFeatureId(geometry));
  }
  return ids.size ? ids : null;
}

function resolveImportedOwnershipState(data, target = state) {
  const importedOwnersByFeatureId = normalizeFeatureOwnershipMap(data.sovereigntyByFeatureId);
  if (target.activeScenarioId) {
    return {
      sovereigntyByFeatureId: {
        ...(target.scenarioBaselineOwnersByFeatureId || {}),
        ...importedOwnersByFeatureId,
      },
      shouldRestoreScenarioBaselineControllers: false,
    };
  }
  return {
    sovereigntyByFeatureId: importedOwnersByFeatureId,
    shouldRestoreScenarioBaselineControllers: false,
  };
}
