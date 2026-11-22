import { isRiverPaintSourceCompatible } from '../river_paint/pilot_manifest.js';
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
import { patchLegendState } from "../state/actions/legend_actions.js";
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
  const original = data;
  const validation = data.scenario?.id
    ? await (await getScenarioResourcesModule()).validateImportedScenarioBaseline(data.scenario) : null;
  if (validation && !validation.ok && validation.reason !== "baseline_mismatch") {
    await resolveScenarioImportAudit(data, ui, validation, 0);
  }
  const unmatched = new Map();
  debugState.importPhase = "validated";
  await waitForScenarioApplyIdle();
  await waitForStartupReadonlyUnlock();
  debugState.importPhase = "scenario-idle";
  const manager = await getScenarioManagerModule();
  const preparedScenario = await manager.prepareScenarioForProjectImport(data.scenario?.id || "");
  const scenarioState = preparedScenario ? {
    activeScenarioId: preparedScenario.staged.scenarioId,
    activeScenarioManifest: preparedScenario.bundle.manifest,
    scenarioBaselineHash: preparedScenario.bundle.manifest.baseline_hash || "",
    scenarioBaselineOwnersByFeatureId: preparedScenario.staged.resolvedOwners,
    mapSemanticMode: preparedScenario.staged.mapSemanticMode,
    scenarioCountriesByTag: preparedScenario.staged.countryMap,
  } : { activeScenarioId: "", activeScenarioManifest: null, scenarioBaselineOwnersByFeatureId: {},
    scenarioCountriesByTag: {}, scenarioReleasableIndex: null };
  if (data.riverPaint?.pack && (data.riverPaint.pack.sceneId !== scenarioState.activeScenarioId
    || data.riverPaint.pack.source.baselineHash !== scenarioState.scenarioBaselineHash
    || !isRiverPaintSourceCompatible(data.riverPaint.pack, scenarioState.activeScenarioManifest))) {
    throw new Error("River partitions require their exact source baseline and geometry build; migration is not automatic");
  }
  debugState.importPhase = "migration";
  const scenarioImportValidFeatureIds = getScenarioImportValidFeatureIds(state, preparedScenario);
  let migrationSummary = null;
  data = await migrateFeatureScopedProjectDataToCurrentTopology(data, {
    landData: scenarioImportValidFeatureIds ? null : state.landData,
    validFeatureIds: scenarioImportValidFeatureIds,
    scenarioManifest: preparedScenario?.bundle?.manifest || null,
    onDiscard: (featureId, targetIds) => unmatched.set(featureId, {
      featureId, targetIds, color: original.visualOverrides?.[featureId] || null,
    }),
    onMigration: (summary) => { migrationSummary = summary; },
  });
  const scenarioImportAudit = await resolveScenarioImportAudit(original, ui, validation, unmatched.size);
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
      unmatchedRegions: [...unmatched.values()],
      ignoredEntries: migrationSummary?.ignoredEntries ?? null,
      migratedEntries: migrationSummary?.migratedEntries ?? 0,
    },
  };
}

async function resolveScenarioImportAudit(data, ui, validation, count) {
  let scenarioImportAudit = data.scenario?.importAudit || null;
  if (!data.scenario?.id) {
    return scenarioImportAudit;
  }
  if (validation.ok) {
    return scenarioImportAudit;
  }
  const shouldContinue =
    validation.reason === "baseline_mismatch"
      ? await ui.showAppDialog({
          title: ui.t("Scenario Baseline Mismatch", "ui"),
          message: ui.t("This project uses different map data. Colors will be migrated. {count} regions could not be matched.", "ui")
            .replace("{count}", count),
          details: `v${data.scenario.version || 1} → v${validation.currentVersion}\n${data.scenario.baselineHash || "—"} → ${validation.currentBaselineHash || "—"}`,
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
        ? ui.t("The saved scenario is unavailable in this version of the map.", "ui")
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
