import { createHash } from "node:crypto";
import path from "node:path";

import { parse } from "acorn";

import {
  compareP4StateActionPhases,
  normalizeP4StateActionPhase,
} from "./p4_state_action_phases.mjs";

const BOOT_ACTION_MODULE_PATH =
  "js/core/state/actions/boot_actions.js";
const SCENARIO_READINESS_ACTION_MODULE_PATH =
  "js/core/state/actions/scenario_readiness_actions.js";
const SCENARIO_ACTIVATION_ACTION_MODULE_PATH =
  "js/core/state/actions/scenario_activation_actions.js";
const SCENARIO_PRESENTATION_ACTION_MODULE_PATH =
  "js/core/state/actions/scenario_presentation_actions.js";
const SCENARIO_HEALTH_ACTION_MODULE_PATH =
  "js/core/state/actions/scenario_health_actions.js";
const SCENARIO_APPLY_REQUEST_ACTION_MODULE_PATH =
  "js/core/state/actions/scenario_apply_request_actions.js";
const SCENARIO_PALETTE_ACTION_MODULE_PATH =
  "js/core/state/actions/scenario_palette_actions.js";
const SCENARIO_TRANSACTION_ROLLBACK_ACTION_MODULE_PATH =
  "js/core/state/actions/scenario_transaction_rollback_actions.js";
const SCENARIO_CHUNK_RUNTIME_ACTION_MODULE_PATH =
  "js/core/state/actions/scenario_chunk_runtime_actions.js";
const SCENARIO_CHUNK_PROMOTION_ACTION_MODULE_PATH =
  "js/core/state/actions/scenario_chunk_promotion_actions.js";
const RENDERER_PHASE_ACTION_MODULE_PATH =
  "js/core/state/actions/renderer_phase_actions.js";
const RENDERER_INTERACTION_ACTION_MODULE_PATH =
  "js/core/state/actions/renderer_interaction_actions.js";
const RENDERER_EXACT_REFRESH_ACTION_MODULE_PATH =
  "js/core/state/actions/renderer_exact_refresh_actions.js";
const RENDERER_CACHE_ACTION_MODULE_PATH =
  "js/core/state/actions/renderer_cache_actions.js";
const RENDERER_DIAGNOSTICS_ACTION_MODULE_PATH =
  "js/core/state/actions/renderer_diagnostics_actions.js";
const APPEARANCE_ACTION_MODULE_PATH =
  "js/core/state/actions/appearance_actions.js";
const APPEARANCE_PRESET_ACTION_MODULE_PATH =
  "js/core/state/actions/appearance_preset_actions.js";
const APPEARANCE_REFERENCE_ACTION_MODULE_PATH =
  "js/core/state/actions/appearance_reference_actions.js";
const APPEARANCE_SELECTION_ACTION_MODULE_PATH =
  "js/core/state/actions/appearance_selection_actions.js";
const APPEARANCE_VISIBILITY_ACTION_MODULE_PATH =
  "js/core/state/actions/appearance_visibility_actions.js";
const INTENSITY_FIELD_ACTION_MODULE_PATH =
  "js/core/state/actions/intensity_field_actions.js";
const EXPORT_WORKBENCH_ACTION_MODULE_PATH =
  "js/core/state/actions/export_workbench_actions.js";
const TRANSPORT_ACTION_MODULE_PATH =
  "js/core/state/actions/transport_actions.js";
const UI_CHROME_ACTION_MODULE_PATH =
  "js/core/state/actions/ui_chrome_actions.js";
const UI_DIRTY_ACTION_MODULE_PATH =
  "js/core/state/actions/ui_dirty_actions.js";
const UI_VISIBILITY_ACTION_MODULE_PATH =
  "js/core/state/actions/ui_visibility_actions.js";
const STRATEGIC_OVERLAY_ACTION_MODULE_PATH =
  "js/core/state/actions/strategic_overlay_actions.js";
const SPECIAL_ZONE_ACTION_MODULE_PATH =
  "js/core/state/actions/special_zone_actions.js";

const BOOT_ACTION_EXPORT_NAMES = Object.freeze([
  "setStartupInteractionMode",
  "setBootPreviewVisibleState",
  "setUiHydrationState",
  "commitStartupReadonlyStateFields",
  "clearStartupReadonlyStateFields",
  "clearStartupReadonlyStateForReason",
  "setBootStateFields",
  "replaceBootMetricsState",
  "replaceStartupBootCacheState",
  "setStartupScenarioBootstrapCacheStatus",
  "replaceSampleProjectDeeplinkState",
  "setActivePostReadyTask",
  "clearActivePostReadyTask",
  "replacePostReadyTaskDiagnostics",
  "setLongAnimationFrameObserver",
  "setStartupInitialScenarioChunkVisualPromotion",
  "setUiShellDebugState",
  "setUiShellDebugTerritorySeededState",
]);

const SCENARIO_READINESS_ACTION_EXPORT_NAMES = Object.freeze([
  "commitScenarioReadinessState",
  "restoreScenarioReadinessState",
]);

const SCENARIO_ACTIVATION_ACTION_EXPORT_NAMES = Object.freeze([
  "commitScenarioActivationState",
  "restoreScenarioActivationBeforeAuditState",
  "restoreScenarioActivationBeforeColorDirtyState",
  "restoreScenarioActivationState",
]);

const SCENARIO_ACTIVATION_CHUNK_OPTIONAL_ACTION_EXPORT_NAMES = Object.freeze([
  "applyScenarioChunkOptionalLayerState",
  "restoreScenarioChunkPromotionState",
]);

const SCENARIO_PRESENTATION_ACTION_EXPORT_NAMES = Object.freeze([
  "commitScenarioPresentationState",
  "restoreScenarioTransactionPresentationBeforeAuditState",
  "restoreScenarioPresentationState",
  "restoreScenarioTransactionPresentationState",
]);

const SCENARIO_PRESENTATION_STYLE_DEFAULTS_ACTION_EXPORT_NAMES = Object.freeze([
  "mergeScenarioStyleDefaultsState",
]);

const SCENARIO_PRESENTATION_DAY_NIGHT_ACTION_EXPORT_NAMES = Object.freeze([
  "setDayNightStyleConfigState",
]);

const SCENARIO_ACTIVATION_CLICK_ACTION_EXPORT_NAMES = Object.freeze([
  "removeClickCountryColorsState",
  "setClickCountryColorsState",
]);

const SCENARIO_PRESENTATION_CLICK_ACTION_EXPORT_NAMES = Object.freeze([
  "clearClickScenarioHoverIdsState",
  "setClickActiveSovereignCodeState",
  "setClickSelectedSpecialRegionIdState",
  "setClickSelectedWaterRegionIdState",
]);

const SCENARIO_PRESENTATION_CHUNK_CITY_ACTION_EXPORT_NAMES = Object.freeze([
  "applyScenarioChunkCityExternalEffectState",
  "finalizeScenarioChunkCityExternalEffectState",
]);

const SCENARIO_PRESENTATION_HEALTH_ACTION_EXPORT_NAMES = Object.freeze([
  "setActiveScenarioPerformanceHintsState",
]);

const SCENARIO_APPLY_REQUEST_ACTION_EXPORT_NAMES = Object.freeze([
  "setLatestScenarioApplyRequestState",
  "beginScenarioApplyRequestState",
  "clearActiveScenarioApplyRequestState",
]);

const SCENARIO_PALETTE_ACTION_EXPORT_NAMES = Object.freeze([
  "commitScenarioPaletteState",
  "restoreScenarioPaletteState",
]);

const SCENARIO_HEALTH_ACTION_EXPORT_NAMES = Object.freeze([
  "setScenarioHydrationHealthGateState",
  "restoreScenarioHydrationHealthGateState",
  "setScenarioDataHealthState",
  "restoreScenarioDataHealthState",
]);

const SCENARIO_CHUNK_RUNTIME_ACTION_EXPORT_NAMES = Object.freeze([
  "ensureScenarioChunkRuntimeState",
  "resetScenarioChunkRuntimeState",
  "replaceScenarioChunkRuntimeState",
  "patchScenarioChunkLoadState",
  "commitScenarioChunkSelectionState",
  "beginScenarioChunkLoadState",
  "completeScenarioChunkLoadState",
  "failScenarioChunkLoadState",
  "finishScenarioChunkLoadState",
  "commitScenarioChunkPayloadEntriesState",
  "evictScenarioChunkPayloadsState",
  "setScenarioChunkMergedLayerPayloadsState",
  "replaceScenarioChunkPendingPromotionIdentityState",
  "queueScenarioChunkPromotionState",
  "setScenarioChunkPromotionStatusState",
  "clearScenarioChunkPromotionState",
  "setScenarioChunkRuntimeHooksState",
]);

const SCENARIO_CHUNK_PROMOTION_ACTION_EXPORT_NAMES = Object.freeze([
  "setScenarioPoliticalChunkPayloadState",
  "bumpScenarioChunkDataGenerationState",
  "commitScenarioPoliticalChunkPayloadState",
  "setScenarioChunkPromotionRenderLockState",
  "setDefaultRuntimePoliticalTopologyState",
  "restoreScenarioChunkPromotionRootState",
]);

const RENDERER_PHASE_ACTION_EXPORT_NAMES = Object.freeze([
  "setRenderPhaseTimerIdState",
  "setRenderPhaseValueState",
  "setPhaseEnteredAtState",
  "setRendererIsInteractingState",
  "setPendingDayNightRefreshState",
  "setAdaptiveSettleProfileState",
  "commitRendererDprStageState",
]);

const RENDERER_INTERACTION_ACTION_EXPORT_NAMES = Object.freeze([
  "clearClickHoveredIdState",
  "removeClickWaterRegionOverrideState",
  "setClickHoverOverlayDirtyState",
  "setClickSelectedColorState",
  "setZoomGestureStartTransformState",
  "setZoomGestureScaleDeltaState",
  "setPendingZoomTransformState",
  "setZoomRenderScheduledState",
  "setZoomGestureEndedAtState",
  "beginInteractionRecoveryTaskState",
  "endInteractionRecoveryTaskState",
  "setInteractionInfrastructureStateFields",
]);

const RENDERER_EXACT_REFRESH_ACTION_EXPORT_NAMES = Object.freeze([
  "ensureExactAfterSettleControllerState",
  "resetExactAfterSettleControllerState",
  "refreshExactAfterSettleControllerIdentityState",
  "beginExactAfterSettleControllerScheduleState",
  "beginExactAfterSettleControllerApplyState",
  "replaceExactAfterSettlePendingPlanState",
  "completeExactAfterSettleControllerApplyState",
  "beginExactAfterSettleControllerFinalizeState",
  "setDeferExactAfterSettleState",
  "setPendingExactPoliticalFastFrameState",
  "setExactAfterSettleHandleState",
]);

const RENDERER_CACHE_ACTION_EXPORT_NAMES = Object.freeze([
  "commitRenderPassCacheState",
  "commitProjectedBoundsCacheState",
  "clearSphericalFeatureDiagnosticsCacheState",
  "setSphericalFeatureDiagnosticsCacheEntryState",
]);

const RENDERER_DIAGNOSTICS_ACTION_EXPORT_NAMES = Object.freeze([
  "ensureRenderPerfMetricsState",
  "replaceRenderPerfMetricsState",
  "setRenderPerfMetricEntryState",
  "setRenderPerfContextBreakdownState",
  "commitRenderPerfMetricState",
  "setFirstVisibleFramePaintedState",
  "resetProjectedBoundsDiagnosticsState",
  "setProjectedBoundsDiagnosticsState",
  "setDebugCountryCoverageState",
]);

const APPEARANCE_ACTION_EXPORT_NAMES = Object.freeze([
  "ensureAppearanceStyleConfigState",
  "setAppearanceStyleConfigState",
  "setAppearanceStyleGroupState",
  "patchAppearanceStyleGroupState",
  "applyAppearanceStylePathPatchState",
  "setAppearanceParentBorderEnabledMapState",
  "patchAppearanceParentBorderEnabledMapState",
]);

const APPEARANCE_PRESET_ACTION_EXPORT_NAMES = Object.freeze([
  "setAppearancePresetsState",
  "normalizeAppearancePresetsIntoState",
  "upsertAppearancePresetState",
  "deleteAppearancePresetState",
  "mergeAppearancePresetImportPayloadState",
  "selectAppearancePresetState",
  "applyAppearancePresetState",
]);

const APPEARANCE_REFERENCE_ACTION_EXPORT_NAMES = Object.freeze([
  "setReferenceImageState",
  "patchReferenceImageState",
  "setReferenceImageUrlState",
]);

const APPEARANCE_SELECTION_ACTION_EXPORT_NAMES = Object.freeze([
  "setSelectedColorState",
]);

const APPEARANCE_VISIBILITY_ACTION_EXPORT_NAMES = Object.freeze([
  "setAppearanceVisibilityState",
  "patchAppearanceVisibilityState",
]);

const INTENSITY_FIELD_ACTION_EXPORT_NAMES = Object.freeze([
  "setIntensityFieldsState",
  "normalizeIntensityFieldsIntoState",
  "updateIntensityFieldChannelState",
  "setIntensityFieldToolState",
]);

const EXPORT_WORKBENCH_ACTION_EXPORT_NAMES = Object.freeze([
  "ensureExportWorkbenchUiState",
  "commitExportWorkbenchUiState",
  "setExportLayerOrderState",
  "setExportVisibilityState",
  "setExportTextVisibilityState",
  "setExportPreviewState",
  "setExportOutputState",
  "setExportAdjustmentsState",
  "setExportBakeState",
]);

const TRANSPORT_ACTION_EXPORT_NAMES = Object.freeze([
  "ensureTransportWorkbenchUiState",
  "commitTransportWorkbenchUiState",
  "commitTransportWorkbenchPointDeltasState",
  "applyTransportWorkbenchOverviewState",
  "ensureTransportOverviewStyleConfigState",
  "setTransportMasterVisibilityState",
  "setTransportFamilyVisibilityState",
]);

const UI_CHROME_ACTION_EXPORT_NAMES = Object.freeze([
  "ensureUiChromeState",
  "patchUiChromeState",
  "setActiveDockPopoverState",
  "setRestoredSupportSurfaceViewState",
]);

const UI_DIRTY_ACTION_EXPORT_NAMES = Object.freeze([
  "markDirtyState",
  "clearDirtyState",
]);

const UI_VISIBILITY_ACTION_EXPORT_NAMES = Object.freeze([
  "commitUiVisibilityState",
  "restoreUiVisibilityState",
  "restoreImportedLayerVisibilityState",
]);

const STRATEGIC_OVERLAY_ACTION_EXPORT_NAMES = Object.freeze([
  "commitStrategicOverlayCollectionsState",
  "restoreStrategicOverlaySnapshotState",
  "patchStrategicOverlayEntityGroupState",
  "patchStrategicOverlayEntityState",
  "patchStrategicOverlayEditorState",
  "setStrategicOverlayDirtyState",
]);

const SPECIAL_ZONE_ACTION_EXPORT_NAMES = Object.freeze([
  "ensureSpecialZoneEditorState",
  "patchSpecialZoneEditorState",
  "commitSpecialZoneLayersState",
  "restoreSpecialZoneSnapshotState",
  "setSpecialZoneMembershipBrushModeState",
  "setSpecialZonePresetCategoryState",
  "setSpecialZonePresetCategoryOpenState",
  "ensureManualSpecialZonesState",
  "setSpecialZonesVisibilityState",
  "setSpecialZonesOverlayDirtyState",
]);

const STATE_ACTION_EXPORT_GROUPS = Object.freeze([
  Object.freeze({
    modulePath: BOOT_ACTION_MODULE_PATH,
    exportNames: BOOT_ACTION_EXPORT_NAMES,
    introducedInPhase: "P4.1",
  }),
  Object.freeze({
    modulePath: SCENARIO_READINESS_ACTION_MODULE_PATH,
    exportNames: SCENARIO_READINESS_ACTION_EXPORT_NAMES,
    introducedInPhase: "P4.2a",
  }),
  Object.freeze({
    modulePath: SCENARIO_ACTIVATION_ACTION_MODULE_PATH,
    exportNames: SCENARIO_ACTIVATION_ACTION_EXPORT_NAMES,
    introducedInPhase: "P4.2a",
  }),
  Object.freeze({
    modulePath: SCENARIO_PRESENTATION_ACTION_MODULE_PATH,
    exportNames: SCENARIO_PRESENTATION_ACTION_EXPORT_NAMES,
    introducedInPhase: "P4.2a",
  }),
  Object.freeze({
    modulePath: SCENARIO_APPLY_REQUEST_ACTION_MODULE_PATH,
    exportNames: SCENARIO_APPLY_REQUEST_ACTION_EXPORT_NAMES,
    introducedInPhase: "P4.2a",
  }),
  Object.freeze({
    modulePath: SCENARIO_PALETTE_ACTION_MODULE_PATH,
    exportNames: SCENARIO_PALETTE_ACTION_EXPORT_NAMES,
    introducedInPhase: "P4.2a",
  }),
  Object.freeze({
    modulePath: SCENARIO_ACTIVATION_ACTION_MODULE_PATH,
    exportNames: SCENARIO_ACTIVATION_CHUNK_OPTIONAL_ACTION_EXPORT_NAMES,
    introducedInPhase: "P4.2b",
  }),
  Object.freeze({
    modulePath: SCENARIO_PRESENTATION_ACTION_MODULE_PATH,
    exportNames: SCENARIO_PRESENTATION_CHUNK_CITY_ACTION_EXPORT_NAMES,
    introducedInPhase: "P4.2b",
  }),
  Object.freeze({
    modulePath: SCENARIO_CHUNK_RUNTIME_ACTION_MODULE_PATH,
    exportNames: SCENARIO_CHUNK_RUNTIME_ACTION_EXPORT_NAMES,
    introducedInPhase: "P4.2b",
  }),
  Object.freeze({
    modulePath: SCENARIO_CHUNK_PROMOTION_ACTION_MODULE_PATH,
    exportNames: SCENARIO_CHUNK_PROMOTION_ACTION_EXPORT_NAMES,
    introducedInPhase: "P4.2b",
  }),
  Object.freeze({
    modulePath: SCENARIO_HEALTH_ACTION_MODULE_PATH,
    exportNames: SCENARIO_HEALTH_ACTION_EXPORT_NAMES,
    introducedInPhase: "P4.2c",
  }),
  Object.freeze({
    modulePath: SCENARIO_PRESENTATION_ACTION_MODULE_PATH,
    exportNames: SCENARIO_PRESENTATION_HEALTH_ACTION_EXPORT_NAMES,
    introducedInPhase: "P4.2c",
  }),
  Object.freeze({
    modulePath: RENDERER_PHASE_ACTION_MODULE_PATH,
    exportNames: RENDERER_PHASE_ACTION_EXPORT_NAMES,
    introducedInPhase: "P4.3",
  }),
  Object.freeze({
    modulePath: SCENARIO_PRESENTATION_ACTION_MODULE_PATH,
    exportNames: SCENARIO_PRESENTATION_STYLE_DEFAULTS_ACTION_EXPORT_NAMES,
    introducedInPhase: "P4.3",
  }),
  Object.freeze({
    modulePath: SCENARIO_PRESENTATION_ACTION_MODULE_PATH,
    exportNames: SCENARIO_PRESENTATION_DAY_NIGHT_ACTION_EXPORT_NAMES,
    introducedInPhase: "P4.3",
  }),
  Object.freeze({
    modulePath: SCENARIO_ACTIVATION_ACTION_MODULE_PATH,
    exportNames: SCENARIO_ACTIVATION_CLICK_ACTION_EXPORT_NAMES,
    introducedInPhase: "P4.3",
  }),
  Object.freeze({
    modulePath: SCENARIO_PRESENTATION_ACTION_MODULE_PATH,
    exportNames: SCENARIO_PRESENTATION_CLICK_ACTION_EXPORT_NAMES,
    introducedInPhase: "P4.3",
  }),
  Object.freeze({
    modulePath: RENDERER_INTERACTION_ACTION_MODULE_PATH,
    exportNames: RENDERER_INTERACTION_ACTION_EXPORT_NAMES,
    introducedInPhase: "P4.3",
  }),
  Object.freeze({
    modulePath: RENDERER_EXACT_REFRESH_ACTION_MODULE_PATH,
    exportNames: RENDERER_EXACT_REFRESH_ACTION_EXPORT_NAMES,
    introducedInPhase: "P4.3",
  }),
  Object.freeze({
    modulePath: RENDERER_CACHE_ACTION_MODULE_PATH,
    exportNames: RENDERER_CACHE_ACTION_EXPORT_NAMES,
    introducedInPhase: "P4.3",
  }),
  Object.freeze({
    modulePath: RENDERER_DIAGNOSTICS_ACTION_MODULE_PATH,
    exportNames: RENDERER_DIAGNOSTICS_ACTION_EXPORT_NAMES,
    introducedInPhase: "P4.3",
  }),
  Object.freeze({
    modulePath: APPEARANCE_ACTION_MODULE_PATH,
    exportNames: APPEARANCE_ACTION_EXPORT_NAMES,
    introducedInPhase: "P4.4",
  }),
  Object.freeze({
    modulePath: APPEARANCE_PRESET_ACTION_MODULE_PATH,
    exportNames: APPEARANCE_PRESET_ACTION_EXPORT_NAMES,
    introducedInPhase: "P4.4",
  }),
  Object.freeze({
    modulePath: APPEARANCE_REFERENCE_ACTION_MODULE_PATH,
    exportNames: APPEARANCE_REFERENCE_ACTION_EXPORT_NAMES,
    introducedInPhase: "P4.4",
  }),
  Object.freeze({
    modulePath: APPEARANCE_SELECTION_ACTION_MODULE_PATH,
    exportNames: APPEARANCE_SELECTION_ACTION_EXPORT_NAMES,
    introducedInPhase: "P4.4",
  }),
  Object.freeze({
    modulePath: APPEARANCE_VISIBILITY_ACTION_MODULE_PATH,
    exportNames: APPEARANCE_VISIBILITY_ACTION_EXPORT_NAMES,
    introducedInPhase: "P4.4",
  }),
  Object.freeze({
    modulePath: INTENSITY_FIELD_ACTION_MODULE_PATH,
    exportNames: INTENSITY_FIELD_ACTION_EXPORT_NAMES,
    introducedInPhase: "P4.4",
  }),
  Object.freeze({
    modulePath: EXPORT_WORKBENCH_ACTION_MODULE_PATH,
    exportNames: EXPORT_WORKBENCH_ACTION_EXPORT_NAMES,
    introducedInPhase: "P4.4",
  }),
  Object.freeze({
    modulePath: TRANSPORT_ACTION_MODULE_PATH,
    exportNames: TRANSPORT_ACTION_EXPORT_NAMES,
    introducedInPhase: "P4.4",
  }),
  Object.freeze({
    modulePath: UI_CHROME_ACTION_MODULE_PATH,
    exportNames: UI_CHROME_ACTION_EXPORT_NAMES,
    introducedInPhase: "P4.4",
  }),
  Object.freeze({
    modulePath: UI_DIRTY_ACTION_MODULE_PATH,
    exportNames: UI_DIRTY_ACTION_EXPORT_NAMES,
    introducedInPhase: "P4.4",
  }),
  Object.freeze({
    modulePath: UI_VISIBILITY_ACTION_MODULE_PATH,
    exportNames: UI_VISIBILITY_ACTION_EXPORT_NAMES,
    introducedInPhase: "P4.4",
  }),
  Object.freeze({
    modulePath: STRATEGIC_OVERLAY_ACTION_MODULE_PATH,
    exportNames: STRATEGIC_OVERLAY_ACTION_EXPORT_NAMES,
    introducedInPhase: "P4.4",
  }),
  Object.freeze({
    modulePath: SPECIAL_ZONE_ACTION_MODULE_PATH,
    exportNames: SPECIAL_ZONE_ACTION_EXPORT_NAMES,
    introducedInPhase: "P4.4",
  }),
]);

const STATE_ACTION_READ_ONLY_EXPORT_NAMES_BY_MODULE = new Map([
  [
    APPEARANCE_ACTION_MODULE_PATH,
    new Set([
      "APPEARANCE_STYLE_GROUP_KEYS",
    ]),
  ],
  [
    APPEARANCE_VISIBILITY_ACTION_MODULE_PATH,
    new Set([
      "APPEARANCE_VISIBILITY_KEYS",
    ]),
  ],
  [
    UI_VISIBILITY_ACTION_MODULE_PATH,
    new Set([
      "captureUiVisibilityState",
    ]),
  ],
  [
    STRATEGIC_OVERLAY_ACTION_MODULE_PATH,
    new Set([
      "STRATEGIC_OVERLAY_COLLECTION_KEYS",
      "STRATEGIC_OVERLAY_DIRTY_KEYS",
      "STRATEGIC_OVERLAY_ENTITY_FIELD_KEYS",
      "STRATEGIC_OVERLAY_EDITOR_FIELD_KEYS",
    ]),
  ],
  [
    SPECIAL_ZONE_ACTION_MODULE_PATH,
    new Set([
      "SPECIAL_ZONE_EDITOR_FIELD_KEYS",
    ]),
  ],
  [
    RENDERER_DIAGNOSTICS_ACTION_MODULE_PATH,
    new Set([
      "captureRenderPerfContextBreakdownState",
      "captureRenderPerfMetricEntryState",
      "captureRenderPerfMetricsState",
      "captureProjectedBoundsDiagnosticsState",
      "captureRenderSnapshotState",
    ]),
  ],
  [
    RENDERER_CACHE_ACTION_MODULE_PATH,
    new Set([
      "getSphericalFeatureDiagnosticsCacheEntryState",
    ]),
  ],
  [
    RENDERER_EXACT_REFRESH_ACTION_MODULE_PATH,
    new Set([
      "captureExactAfterSettleControllerState",
      "isExactAfterSettleGenerationCurrentState",
      "isExactAfterSettleControllerActiveState",
    ]),
  ],
  [
    SCENARIO_READINESS_ACTION_MODULE_PATH,
    new Set([
      "SCENARIO_READINESS_STATE_KEYS",
      "captureScenarioReadinessState",
    ]),
  ],
  [
    SCENARIO_ACTIVATION_ACTION_MODULE_PATH,
    new Set([
      "SCENARIO_ACTIVATION_STATE_KEYS",
      "SCENARIO_CHUNK_OPTIONAL_LAYER_STATE_CONFIGS",
      "captureScenarioActivationState",
      "captureScenarioChunkPromotionState",
      "getScenarioChunkOptionalLayerState",
      "restoreScenarioActivationAfterColorDirtyState",
    ]),
  ],
  [
    SCENARIO_PRESENTATION_ACTION_MODULE_PATH,
    new Set([
      "SCENARIO_PRESENTATION_STATE_KEYS",
      "captureActiveScenarioPerformanceHintsState",
      "captureScenarioPresentationState",
    ]),
  ],
  [
    SCENARIO_HEALTH_ACTION_MODULE_PATH,
    new Set([
      "captureScenarioHealthState",
    ]),
  ],
  [
    SCENARIO_PALETTE_ACTION_MODULE_PATH,
    new Set([
      "SCENARIO_PALETTE_STATE_KEYS",
      "captureScenarioPaletteState",
    ]),
  ],
  [
    SCENARIO_TRANSACTION_ROLLBACK_ACTION_MODULE_PATH,
    new Set([
      "SCENARIO_TRANSACTION_ROLLBACK_OPTIONAL_STATE_KEYS",
      "SCENARIO_TRANSACTION_ROLLBACK_SUPPLEMENTAL_HANDOFF_PHASE_BY_KEY",
      "SCENARIO_TRANSACTION_ROLLBACK_SUPPLEMENTAL_STATE_KEYS",
      "captureScenarioTransactionRollbackOptionalState",
      "captureScenarioTransactionRollbackSupplementalState",
      "validateScenarioTransactionRollbackSupplementalStatePatch",
    ]),
  ],
  [
    SCENARIO_CHUNK_RUNTIME_ACTION_MODULE_PATH,
    new Set([
      "SCENARIO_CHUNK_LOAD_STATE_PATCH_KEYS",
      "captureScenarioChunkLoadStateContinuation",
    ]),
  ],
  [
    SCENARIO_CHUNK_PROMOTION_ACTION_MODULE_PATH,
    new Set([
      "captureScenarioChunkPromotionRootState",
    ]),
  ],
]);

function freezePureReaderEscape({
  reason = "state-alias-escape",
  key = "*",
  sourceFingerprint = "",
  count = 1,
} = {}) {
  return Object.freeze({
    reason: String(reason || ""),
    key: String(key || ""),
    sourceFingerprint: String(sourceFingerprint || ""),
    count: Number(count),
  });
}

function freezePureReaderConservativeFinding({
  enclosingFunctionIdentity = "",
  reason = "",
  operation = "",
  key = "",
  sourceFingerprint = "",
  count = 1,
} = {}) {
  return Object.freeze({
    enclosingFunctionIdentity: String(
      enclosingFunctionIdentity || "",
    ),
    reason: String(reason || ""),
    operation: String(operation || ""),
    key: String(key || ""),
    sourceFingerprint: String(sourceFingerprint || ""),
    count: Number(count),
  });
}

function freezeStateTargetPureReaderEntry({
  modulePath,
  functionName,
  targetParameterName,
  targetParameterIndex = 0,
  targetParameterPath = "$",
  sourceFingerprint,
  acceptedEscapes = [],
  conservativeFindings = [],
} = {}) {
  return Object.freeze({
    modulePath: normalizeModulePath(modulePath),
    functionName: String(functionName || ""),
    targetParameterName: String(targetParameterName || ""),
    targetParameterIndex: Number(targetParameterIndex),
    targetParameterPath: String(targetParameterPath || ""),
    sourceFingerprint: String(sourceFingerprint || ""),
    acceptedEscapes: Object.freeze(
      acceptedEscapes.map(freezePureReaderEscape),
    ),
    conservativeFindings: Object.freeze(
      conservativeFindings.map(
        freezePureReaderConservativeFinding,
      ),
    ),
  });
}

const SCENARIO_DETAIL_PURE_READER_FUNCTION_IDENTITY =
  '{"kind":"function","ancestry":[{"name":"prepareScenarioDetailTopologyState","ordinal":0}]}';
const SCENARIO_DETAIL_CURRENT_PATCH_FUNCTION_IDENTITY =
  '{"kind":"function","ancestry":[{"name":"prepareScenarioDetailTopologyState","ordinal":0},{"name":"currentPatch","ordinal":0}]}';
const SCENARIO_DETAIL_CREATE_RESULT_FUNCTION_IDENTITY =
  '{"kind":"function","ancestry":[{"name":"prepareScenarioDetailTopologyState","ordinal":0},{"name":"createResult","ordinal":0}]}';

function scenarioDetailConservativeFinding(
  enclosingFunctionIdentity,
  key,
  sourceFingerprint,
  count = 1,
) {
  return {
    enclosingFunctionIdentity,
    reason: "state-alias-escape",
    operation: "unsupported",
    key,
    sourceFingerprint,
    count,
  };
}

export const STATE_TARGET_PURE_READER_CONTRACT = Object.freeze([
  freezeStateTargetPureReaderEntry({
    modulePath: "js/core/scenario_manager.js",
    functionName: "prepareScenarioDetailTopologyState",
    targetParameterName: "targetState",
    targetParameterIndex: 0,
    targetParameterPath: "$/property:targetState",
    sourceFingerprint:
      "47c43af8daaa53a0f3b791601a75d17cb9136cda6914a5daa6874b415443f964",
    conservativeFindings: [
      scenarioDetailConservativeFinding(
        SCENARIO_DETAIL_CURRENT_PATCH_FUNCTION_IDENTITY,
        "*",
        "4cd9b0d4014198e8d5d3d514b177adcc28016abdee9111d8503d9f5b21b53bfe",
      ),
      scenarioDetailConservativeFinding(
        SCENARIO_DETAIL_CURRENT_PATCH_FUNCTION_IDENTITY,
        "topologyDetail",
        "a480f4d95a77a248f3f00504dae9250d7d2b5b203b4fa62095e5c392347240d1",
      ),
      scenarioDetailConservativeFinding(
        SCENARIO_DETAIL_CURRENT_PATCH_FUNCTION_IDENTITY,
        "topologyBundleMode",
        "dc3cf41d39483cf1a5324d0dc39c11a16cd734f0ed3c6f5535c4f6d594883265",
      ),
      scenarioDetailConservativeFinding(
        SCENARIO_DETAIL_CURRENT_PATCH_FUNCTION_IDENTITY,
        "detailDeferred",
        "f4b65c454d015438e41078986902c10a152e822bf5f51b83885c7477a7bdaf81",
      ),
      scenarioDetailConservativeFinding(
        SCENARIO_DETAIL_CURRENT_PATCH_FUNCTION_IDENTITY,
        "detailPromotionCompleted",
        "015b4efaf9069d2d2cb7fe40a597ffc2f9c479e1c1afa7400756261972ab1f1c",
      ),
      scenarioDetailConservativeFinding(
        SCENARIO_DETAIL_CURRENT_PATCH_FUNCTION_IDENTITY,
        "detailPromotionInFlight",
        "9bb1a630841347e38e962d7d9a8238577794cdd7c673d9f83ba79ad7d382357e",
      ),
      scenarioDetailConservativeFinding(
        SCENARIO_DETAIL_CURRENT_PATCH_FUNCTION_IDENTITY,
        "detailSourceRequested",
        "5edd9c39faa5ea35266783d4e03088366240264b8011e86bf6e45f87a3a1b0c3",
      ),
      scenarioDetailConservativeFinding(
        SCENARIO_DETAIL_CREATE_RESULT_FUNCTION_IDENTITY,
        "*",
        "bd646f14a3726436c3155818421d934c3a2dcdf53ada9f31393a3871e2a3235f",
      ),
      scenarioDetailConservativeFinding(
        SCENARIO_DETAIL_CREATE_RESULT_FUNCTION_IDENTITY,
        "*",
        "a4895eb44afc336fecbba6e520cd67e178dace0276655d102fceffa8e5f70570",
      ),
      scenarioDetailConservativeFinding(
        SCENARIO_DETAIL_PURE_READER_FUNCTION_IDENTITY,
        "topologyDetail",
        "a480f4d95a77a248f3f00504dae9250d7d2b5b203b4fa62095e5c392347240d1",
      ),
      ...[
        [
          "4037acc7602070fd45debf1292f6b051e6b371fb95a0fcbf6a03057454b0fb40",
          1,
        ],
        [
          "9b7c27f4636707683beb548569b03c1d2eaecde9490179330a84f69df58e9430",
          2,
        ],
        [
          "e0ae35c7b2c9744523e772fa0831a6af75a74595e7ca8b631d9d3ac7c82d1495",
          1,
        ],
        [
          "51bbcb024ae6b86304ba5499c611b3e3199f21fb3130109be8b61041cf2d3586",
          1,
        ],
        [
          "cd5277d5cb24bee2902ffb16cb96ddf8737123b558b20963bc7ae3db01c57b44",
          1,
        ],
        [
          "87607f01208bed5b3096eb8d02f8f006224ea3b5039a4c537e0b537942d939d4",
          1,
        ],
        [
          "5cd9d40ef22cb3a83b4b1b7979daaeace0e243f813f2f401d018829f8411f823",
          1,
        ],
        [
          "594cccd49e06cb5382ce1cc30e1e2df05b0363abe71fafdc6d5ed6e41611fad0",
          1,
        ],
        [
          "9b39afa32f43a3cf35be55150858a82c68e983a995bbeeb1d9e5250ed31eeb0e",
          1,
        ],
        [
          "0e0088092335c06a6e813f95103ee3ec653de0f603320fb89430d82553ba7620",
          1,
        ],
        [
          "1297675eb4c214963ade4245676beb37e6551ae26175acda39b8657c8e944127",
          1,
        ],
      ].map(([sourceFingerprint, count]) =>
        scenarioDetailConservativeFinding(
          SCENARIO_DETAIL_PURE_READER_FUNCTION_IDENTITY,
          "*",
          sourceFingerprint,
          count,
        )
      ),
    ],
  }),
]);

function freezeStateImportedPureNormalizerEntry({
  modulePath,
  exportName,
  targetArgumentIndex = 0,
  targetArgumentStaticPath,
  sourceFingerprint,
} = {}) {
  return Object.freeze({
    modulePath: normalizeModulePath(modulePath),
    exportName: String(exportName || ""),
    targetArgumentIndex: Number(targetArgumentIndex),
    targetArgumentStaticPath: String(targetArgumentStaticPath || ""),
    sourceFingerprint: String(sourceFingerprint || ""),
  });
}

export const STATE_IMPORTED_PURE_NORMALIZER_CONTRACT = Object.freeze([
  freezeStateImportedPureNormalizerEntry({
    modulePath:
      "js/core/renderer/render_pass_cache_state_normalizer.js",
    exportName: "normalizeRenderPassCacheState",
    targetArgumentIndex: 0,
    targetArgumentStaticPath: "renderPassCache",
    sourceFingerprint:
      "03f4cad1217469c4a5d980ebb0e54793f2bd0f86fa4e557f0b68f11d8af9d70c",
  }),
]);

const IMPORTED_PURE_NORMALIZER_ENTRY_BY_EXPORT = new Map(
  STATE_IMPORTED_PURE_NORMALIZER_CONTRACT.map((entry) => [
    `${entry.modulePath}#${entry.exportName}`,
    entry,
  ]),
);

export function findStateImportedPureNormalizerContractEntry(
  modulePath,
  exportName,
) {
  return IMPORTED_PURE_NORMALIZER_ENTRY_BY_EXPORT.get(
    `${normalizeModulePath(modulePath)}#${String(exportName || "")}`,
  ) || null;
}

export function validateStateImportedPureNormalizerContract(
  contractEntries = STATE_IMPORTED_PURE_NORMALIZER_CONTRACT,
) {
  const violations = [];
  const seenEntries = new Set();
  for (
    const [index, entry] of
    (Array.isArray(contractEntries) ? contractEntries : []).entries()
  ) {
    const entryId = [
      normalizeModulePath(entry?.modulePath),
      String(entry?.exportName || ""),
    ].join("#");
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      violations.push(createViolation(
        "state-imported-pure-normalizer-entry-invalid",
        { index },
      ));
      continue;
    }
    if (seenEntries.has(entryId)) {
      violations.push(createViolation(
        "state-imported-pure-normalizer-entry-duplicate",
        { index, entryId },
      ));
    }
    seenEntries.add(entryId);
    if (
      !/^js\/[^/].*\.js$/.test(normalizeModulePath(entry.modulePath))
      || !isValidExportName(entry.exportName)
      || !Number.isInteger(entry.targetArgumentIndex)
      || entry.targetArgumentIndex < 0
      || !/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(
        String(entry.targetArgumentStaticPath || ""),
      )
      || !/^[a-f0-9]{64}$/.test(String(entry.sourceFingerprint || ""))
    ) {
      violations.push(createViolation(
        "state-imported-pure-normalizer-entry-shape-invalid",
        { index, entryId },
      ));
    }
  }
  return violations;
}

function freezeStateDetachedCaptureEntry({
  modulePath,
  exportName,
  targetArgumentIndex = 0,
  sourceFingerprint,
  cloneHelperFingerprints = {},
  readHelperFingerprints = {},
} = {}) {
  return Object.freeze({
    modulePath: normalizeModulePath(modulePath),
    exportName: String(exportName || ""),
    targetArgumentIndex: Number(targetArgumentIndex),
    sourceFingerprint: String(sourceFingerprint || ""),
    cloneHelperFingerprints: Object.freeze({ ...cloneHelperFingerprints }),
    readHelperFingerprints: Object.freeze({ ...readHelperFingerprints }),
  });
}

const RENDERER_DIAGNOSTICS_DETACHED_CLONE_HELPERS = Object.freeze({
  cloneDiagnosticValue:
    "07c39f1ebbb3d2328aae5713dc6e3e8c43d74c500d8bb18aea9797f5c1e25a24",
  cloneRenderSnapshotState:
    "42fde0ba77866db20458a91410bbae52441beb5e05ec5dbb3868c73add2e52bf",
});
const RENDERER_DIAGNOSTICS_DETACHED_READ_HELPERS = Object.freeze({
  getOwnDataPropertyValue:
    "965d43a6b29d0ac4afcc7107972507f3da7be127c9338c633e067e8623692848",
});
const RENDERER_EXACT_REFRESH_DETACHED_CLONE_HELPERS = Object.freeze({
  cloneExactAfterSettlePendingPlan:
    "b9489b346935a1e0aee1a10326837eaa58dd731bf8433c25ce173f7dff5e147d",
  cloneExactAfterSettleValue:
    "ca872828fa16a380cef3eee73cc1c3bc1dbe6c645f69c07be08b37a0de097c0f",
});

export const STATE_DETACHED_CAPTURE_CONTRACT = Object.freeze([
  ["captureRenderPerfMetricsState", "799cda208851e5ae938cc1904aeb0d6ee17d5e7eb4872015f8d269e9581a894a"],
  ["captureRenderPerfContextBreakdownState", "32ae271183ee8222ed3530bad2e1485d2d080ff78e017122b5be3ab9da35b5bb"],
  ["captureRenderPerfMetricEntryState", "8d057da5caba32bb63f40cd8d8f09753ac38ff455260151504a1a4de408b4a7c"],
  ["captureProjectedBoundsDiagnosticsState", "4352b61b815a7393990db64f2c3e0e355a620f5abaea8d9a8ff78445010e05ea"],
  ["captureRenderSnapshotState", "3dca9a11ba57c7f36de5f7b72171ab7b5e04fe2d69f334ba57ea1e9cee09b62e"],
].map(([exportName, sourceFingerprint]) =>
  freezeStateDetachedCaptureEntry({
    modulePath: "js/core/state/actions/renderer_diagnostics_actions.js",
    exportName,
    targetArgumentIndex: 0,
    sourceFingerprint,
    cloneHelperFingerprints: RENDERER_DIAGNOSTICS_DETACHED_CLONE_HELPERS,
    readHelperFingerprints: RENDERER_DIAGNOSTICS_DETACHED_READ_HELPERS,
  })
).concat([
  freezeStateDetachedCaptureEntry({
    modulePath: "js/core/state/actions/renderer_exact_refresh_actions.js",
    exportName: "captureExactAfterSettleControllerState",
    targetArgumentIndex: 0,
    sourceFingerprint:
      "fa0f35be1303057d2afb495edb0d96aece6e3eceba195f1b77dc52d8eca5d438",
    cloneHelperFingerprints: RENDERER_EXACT_REFRESH_DETACHED_CLONE_HELPERS,
  }),
]));

const DETACHED_CAPTURE_ENTRY_BY_EXPORT = new Map(
  STATE_DETACHED_CAPTURE_CONTRACT.map((entry) => [
    `${entry.modulePath}#${entry.exportName}`,
    entry,
  ]),
);

export function findStateDetachedCaptureContractEntry(modulePath, exportName) {
  return DETACHED_CAPTURE_ENTRY_BY_EXPORT.get(
    `${normalizeModulePath(modulePath)}#${String(exportName || "")}`,
  ) || null;
}

export function validateStateDetachedCaptureContract(
  entries = STATE_DETACHED_CAPTURE_CONTRACT,
) {
  const violations = [];
  const seen = new Set();
  for (const [index, entry] of (Array.isArray(entries) ? entries : []).entries()) {
    const id = `${normalizeModulePath(entry?.modulePath)}#${String(entry?.exportName || "")}`;
    if (seen.has(id)) {
      violations.push(createViolation("state-detached-capture-entry-duplicate", { index, id }));
    }
    seen.add(id);
    if (
      !entry
      || typeof entry !== "object"
      || !/^js\/[^/].*\.js$/.test(normalizeModulePath(entry.modulePath))
      || !isValidExportName(entry.exportName)
      || !Number.isInteger(entry.targetArgumentIndex)
      || entry.targetArgumentIndex < 0
      || !/^[a-f0-9]{64}$/.test(String(entry.sourceFingerprint || ""))
      || !Object.entries(entry.cloneHelperFingerprints || {}).every(
        ([name, fingerprint]) => isValidExportName(name) && /^[a-f0-9]{64}$/.test(fingerprint),
      )
      || !Object.entries(entry.readHelperFingerprints || {}).every(
        ([name, fingerprint]) => isValidExportName(name) && /^[a-f0-9]{64}$/.test(fingerprint),
      )
    ) {
      violations.push(createViolation("state-detached-capture-entry-shape-invalid", { index, id }));
    }
  }
  return violations;
}

function freezeMutationDelegatingOwnerEntry(entry = {}) {
  return Object.freeze({
    compositionModulePath: normalizeModulePath(entry.compositionModulePath),
    compositionExportName: String(entry.compositionExportName || ""),
    compositionSourceFingerprint: String(entry.compositionSourceFingerprint || ""),
    factoryModulePath: normalizeModulePath(entry.factoryModulePath),
    factoryExportName: String(entry.factoryExportName || ""),
    factorySourceFingerprint: String(entry.factorySourceFingerprint || ""),
    ownerBindingName: String(entry.ownerBindingName || ""),
    methods: Object.freeze([...(entry.methods || [])].map(String)),
    actionModulePath: normalizeModulePath(entry.actionModulePath),
    actionExports: Object.freeze([...(entry.actionExports || [])].map(String)),
    actionModulePathsByExport: Object.freeze(Object.fromEntries(
      Object.entries(entry.actionModulePathsByExport || {}).map(
        ([exportName, modulePath]) => [String(exportName), normalizeModulePath(modulePath)],
      ),
    )),
  });
}

export const STATE_MUTATION_DELEGATING_OWNER_CONTRACT = Object.freeze([
  freezeMutationDelegatingOwnerEntry({
    compositionModulePath: "js/core/map_renderer.js",
    compositionExportName: "getRenderPerfMetricsRuntimeOwner",
    compositionSourceFingerprint:
      "4e3401e84dd7da7edc08bfe2e96569841933349e59ec090050e21e059cd1bdde",
    factoryModulePath: "js/core/renderer/render_perf_metrics_runtime_owner.js",
    factoryExportName: "createRenderPerfMetricsRuntimeOwner",
    factorySourceFingerprint:
      "7744ea30c7d1224cc642642fc77abd0700a29a318b425c3085608c19595096ef",
    ownerBindingName: "renderPerfMetricsRuntimeOwner",
    methods: [
      "recordRenderPerfMetric",
      "beginContextMetricSession",
      "collectContextMetric",
      "endContextMetricSession",
      "resetContextBreakdownForExactFrame",
    ],
    actionModulePath: "js/core/state/actions/renderer_diagnostics_actions.js",
    actionExports: [
      "commitRenderPerfMetricState",
      "ensureRenderPerfMetricsState",
      "setRenderPerfContextBreakdownState",
    ],
  }),
  freezeMutationDelegatingOwnerEntry({
    compositionModulePath: "js/core/map_renderer.js",
    compositionExportName: "getVisualEffectsPassOwner",
    compositionSourceFingerprint:
      "52f6684ecb7529de485a0f7cfaf4e8f55da48518ed053d71cb69fc402d55c826",
    factoryModulePath: "js/core/renderer/visual_effects_pass_owner.js",
    factoryExportName: "createVisualEffectsPassOwner",
    factorySourceFingerprint:
      "6b8da5ec1ad7a35813e71a922e93685d41b29f0617257865219fa6d0c911e249",
    ownerBindingName: "visualEffectsPassOwner",
    methods: [
      "drawEffectsPass",
      "drawLineEffectsPass",
      "drawTextureLabelEffectsPass",
      "drawDayNightPass",
      "invalidateTextureRasterCaches",
    ],
    actionExports: [],
  }),
  freezeMutationDelegatingOwnerEntry({
    compositionModulePath: "js/core/map_renderer.js",
    compositionExportName: "getPoliticalBackgroundRenderOwner",
    compositionSourceFingerprint:
      "6c7ca3a50636e5189175b8077f5c0c712a19f3eab817bafdff8a899784305b54",
    factoryModulePath: "js/core/renderer/political_background_render_owner.js",
    factoryExportName: "createPoliticalBackgroundRenderOwner",
    factorySourceFingerprint:
      "8ae470d4bde7a210a0aead9ca4937e90a2e6163935b41bd42270e7cc3f7356b8",
    ownerBindingName: "politicalBackgroundRenderOwner",
    methods: [
      "cancelScenarioPoliticalBackgroundDeferredFullCache",
      "drawBackgroundPass",
      "drawPoliticalBackgroundFills",
      "drawPoliticalBackgroundFillsForEntries",
    ],
    actionExports: [],
  }),
  freezeMutationDelegatingOwnerEntry({
    compositionModulePath: "js/core/map_renderer.js",
    compositionExportName: "getPoliticalPartialRepaintOwner",
    compositionSourceFingerprint:
      "39bc292ae63462625b80ef63f5263cd16bef1436c855695a9f03d29e589c64ae",
    factoryModulePath: "js/core/renderer/political_partial_repaint_owner.js",
    factoryExportName: "createPoliticalPartialRepaintOwner",
    factorySourceFingerprint:
      "806a1cfc6775fcde5d8448dc14bd8170ead6bdfd16db60b9ecd28c7ce3126936",
    ownerBindingName: "politicalPartialRepaintOwner",
    methods: [
      "buildPoliticalRasterWorkerPacket",
      "drawPoliticalFeature",
      "drawPoliticalFineFeatureLoop",
      "drawPoliticalWorkerBitmapResult",
      "publishPoliticalPassDiagnostics",
      "recordPoliticalRasterWorkerSnapshot",
      "requestPoliticalPassWorker",
      "resolvePoliticalPassIdentity",
      "resolvePoliticalPassViewport",
      "tryPartialPoliticalPassRepaint",
    ],
    actionExports: [],
  }),
  freezeMutationDelegatingOwnerEntry({
    compositionModulePath: "js/core/map_renderer.js",
    compositionExportName: "getDayNightRuntimeOwner",
    compositionSourceFingerprint:
      "3ce0f2dde1cf99c3836747e3369daf71c0476bd8f8da60d1f136e0f7e2dd9596",
    factoryModulePath: "js/core/renderer/day_night_runtime_owner.js",
    factoryExportName: "createDayNightRuntimeOwner",
    factorySourceFingerprint:
      "ec2eceb9e94ff0559597ea365226f5b27907274855f1a35e0b1e86a2438a46b7",
    ownerBindingName: "dayNightRuntimeOwner",
    methods: [
      "buildNightHemisphereFeature",
      "buildDayNightPassSignature",
      "clearDayNightClockTimer",
      "drawDayNightShadowLayer",
      "drawDayNightPass",
      "getDayNightStyleConfig",
      "getCurrentSolarState",
      "getCurrentUtcMinutes",
      "getCycleUtcMinutes",
      "getDayNightLiveClockToken",
      "getDayNightSignatureClockToken",
      "getSolarDeclinationRadians",
      "getUtcDateKey",
      "getUtcDayOfYear",
      "syncDayNightClockTimer",
    ],
    actionModulePath: RENDERER_PHASE_ACTION_MODULE_PATH,
    actionModulePathsByExport: {
      setDayNightStyleConfigState: SCENARIO_PRESENTATION_ACTION_MODULE_PATH,
    },
    actionExports: [
      "setDayNightStyleConfigState",
      "setPendingDayNightRefreshState",
    ],
  }),
  freezeMutationDelegatingOwnerEntry({
    compositionModulePath: "js/core/map_renderer.js",
    compositionExportName: "getClickSelectionTransactionOwner",
    compositionSourceFingerprint:
      "23d06b6d8176a619f21f960eb4355b67432d0ad90befda18fc7ce798da3f622c",
    factoryModulePath: "js/core/map_renderer/click_selection_transaction_owner.js",
    factoryExportName: "createClickSelectionTransactionOwner",
    factorySourceFingerprint:
      "b4dfc67b04a28a3b3707ea2dffaaa1a27a02d7600ee9a178411e5f51ba844c47",
    ownerBindingName: "clickSelectionTransactionOwner",
    methods: ["handleClick"],
    actionModulePath: RENDERER_INTERACTION_ACTION_MODULE_PATH,
    actionModulePathsByExport: {
      clearClickScenarioHoverIdsState:
        SCENARIO_PRESENTATION_ACTION_MODULE_PATH,
      removeClickCountryColorsState:
        SCENARIO_ACTIVATION_ACTION_MODULE_PATH,
      setClickActiveSovereignCodeState:
        SCENARIO_PRESENTATION_ACTION_MODULE_PATH,
      setClickCountryColorsState:
        SCENARIO_ACTIVATION_ACTION_MODULE_PATH,
      setClickSelectedSpecialRegionIdState:
        SCENARIO_PRESENTATION_ACTION_MODULE_PATH,
      setClickSelectedWaterRegionIdState:
        SCENARIO_PRESENTATION_ACTION_MODULE_PATH,
    },
    actionExports: [
      "clearClickHoveredIdState",
      "clearClickScenarioHoverIdsState",
      "removeClickCountryColorsState",
      "removeClickWaterRegionOverrideState",
      "setClickActiveSovereignCodeState",
      "setClickCountryColorsState",
      "setClickHoverOverlayDirtyState",
      "setClickSelectedColorState",
      "setClickSelectedSpecialRegionIdState",
      "setClickSelectedWaterRegionIdState",
    ],
  }),
  freezeMutationDelegatingOwnerEntry({
    compositionModulePath: "js/main.js",
    compositionExportName: "getStartupReadyHandoffOwner",
    compositionSourceFingerprint:
      "d95f89b89a45a0334a8f227572f5ee3dabb39415aadb9929961de3e3eff1c709",
    factoryModulePath: "js/bootstrap/startup_ready_handoff.js",
    factoryExportName: "createStartupReadyHandoffOwner",
    factorySourceFingerprint:
      "9600bd838ce894c18e28f715ac2b66dbd2317135b3bea78fe546b36b3b1bd6d2",
    ownerBindingName: "startupReadyHandoffOwner",
    methods: [
      "beginUiHydration",
      "reset",
      "flushPendingScenarioChunkRefreshAfterReady",
      "observePostReadyUiBootstrap",
      "markUiHydrationReady",
      "scheduleReadyPostBootWork",
      "startDeferredFullInteractionInfrastructureBuild",
      "schedulePostReadyHydration",
      "schedulePostReadyPoliticalReconcile",
      "schedulePostReadyDeferredContextWarmup",
      "schedulePostReadyVisualWarmup",
    ],
    actionModulePath: BOOT_ACTION_MODULE_PATH,
    actionExports: [
      "setUiHydrationState",
    ],
  }),
]);

export function validateStateMutationDelegatingOwnerContract(
  entries = STATE_MUTATION_DELEGATING_OWNER_CONTRACT,
) {
  const violations = [];
  for (const [index, entry] of (Array.isArray(entries) ? entries : []).entries()) {
    if (
      !entry
      || !/^js\/[^/].*\.js$/.test(entry.compositionModulePath)
      || !isValidExportName(entry.compositionExportName)
      || !/^[a-f0-9]{64}$/.test(entry.compositionSourceFingerprint)
      || !/^js\/[^/].*\.js$/.test(entry.factoryModulePath)
      || !isValidExportName(entry.factoryExportName)
      || !/^[a-f0-9]{64}$/.test(entry.factorySourceFingerprint)
      || !isValidExportName(entry.ownerBindingName)
      || !entry.methods?.length
      || !entry.methods.every(isValidExportName)
      || new Set(entry.methods).size !== entry.methods.length
      || !Array.isArray(entry.actionExports)
      || !entry.actionExports.every(isValidExportName)
      || new Set(entry.actionExports).size !== entry.actionExports.length
      || (
        entry.actionExports.length === 0
        && (
          Boolean(entry.actionModulePath)
          || Object.keys(entry.actionModulePathsByExport || {}).length > 0
        )
      )
      || !Object.entries(entry.actionModulePathsByExport || {}).every(
        ([exportName, modulePath]) => entry.actionExports.includes(exportName)
          && /^js\/[^/].*\.js$/.test(modulePath),
      )
      || !entry.actionExports.every((exportName) => (
        Boolean(findStateActionDelegationContractEntry(
          entry.actionModulePathsByExport?.[exportName]
            || entry.actionModulePath,
          exportName,
        ))
      ))
    ) {
      violations.push(createViolation("state-mutation-owner-entry-shape-invalid", { index }));
    }
  }
  return violations;
}

export function findStateMutationDelegatingOwnerFactoryContractEntry(
  modulePath,
  exportName,
) {
  return STATE_MUTATION_DELEGATING_OWNER_CONTRACT.find((entry) => (
    entry.factoryModulePath === normalizeModulePath(modulePath)
    && entry.factoryExportName === String(exportName || "")
  )) || null;
}

function walkSyntaxTree(node, visit) {
  if (!node || typeof node !== "object") return;
  if (typeof node.type === "string") visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === "loc" || key === "start" || key === "end") continue;
    if (Array.isArray(value)) {
      for (const child of value) walkSyntaxTree(child, visit);
    } else if (value && typeof value === "object") {
      walkSyntaxTree(value, visit);
    }
  }
}

function walkFunctionBody(node, visit) {
  if (!node || typeof node !== "object") return;
  if (
    node.type === "FunctionDeclaration"
    || node.type === "FunctionExpression"
    || node.type === "ArrowFunctionExpression"
  ) {
    return;
  }
  if (typeof node.type === "string") visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === "loc" || key === "start" || key === "end") continue;
    if (Array.isArray(value)) {
      for (const child of value) walkFunctionBody(child, visit);
    } else if (value && typeof value === "object") {
      walkFunctionBody(value, visit);
    }
  }
}

function collectPatternIdentifierNames(pattern, names = []) {
  if (!pattern) return names;
  if (pattern.type === "Identifier") {
    names.push(pattern.name);
  } else if (pattern.type === "AssignmentPattern") {
    collectPatternIdentifierNames(pattern.left, names);
  } else if (pattern.type === "RestElement") {
    collectPatternIdentifierNames(pattern.argument, names);
  } else if (pattern.type === "ArrayPattern") {
    for (const element of pattern.elements || []) {
      collectPatternIdentifierNames(element, names);
    }
  } else if (pattern.type === "ObjectPattern") {
    for (const property of pattern.properties || []) {
      collectPatternIdentifierNames(
        property.type === "RestElement" ? property.argument : property.value,
        names,
      );
    }
  }
  return names;
}

function expressionReferencesTaintedInput(node, taintedNames) {
  if (!node) return false;
  if (node.type === "Identifier") return taintedNames.has(node.name);
  if (node.type === "MemberExpression") {
    return expressionReferencesTaintedInput(node.object, taintedNames);
  }
  if (node.type === "ChainExpression") {
    return expressionReferencesTaintedInput(node.expression, taintedNames);
  }
  if (node.type === "ConditionalExpression") {
    return expressionReferencesTaintedInput(node.consequent, taintedNames)
      || expressionReferencesTaintedInput(node.alternate, taintedNames);
  }
  if (node.type === "LogicalExpression") {
    return expressionReferencesTaintedInput(node.left, taintedNames)
      || expressionReferencesTaintedInput(node.right, taintedNames);
  }
  if (node.type === "SequenceExpression") {
    return expressionReferencesTaintedInput(
      node.expressions?.at(-1),
      taintedNames,
    );
  }
  if (node.type === "AssignmentExpression") {
    return expressionReferencesTaintedInput(node.right, taintedNames);
  }
  if (node.type === "AwaitExpression") {
    return expressionReferencesTaintedInput(node.argument, taintedNames);
  }
  return false;
}

function expressionContainsTaintedReference(node, taintedNames) {
  if (!node || typeof node !== "object") return false;
  if (node.type === "Identifier") return taintedNames.has(node.name);
  return Object.entries(node).some(([key, value]) => {
    if (["loc", "start", "end"].includes(key)) return false;
    if (Array.isArray(value)) {
      return value.some((child) => (
        child
        && typeof child === "object"
        && expressionContainsTaintedReference(child, taintedNames)
      ));
    }
    return Boolean(
      value
      && typeof value === "object"
      && expressionContainsTaintedReference(value, taintedNames),
    );
  });
}

function expressionContainsTaintSource(node, predicate) {
  if (!node || typeof node !== "object") return false;
  if (predicate(node)) return true;
  return Object.entries(node).some(([key, value]) => {
    if (["loc", "start", "end"].includes(key)) return false;
    if (Array.isArray(value)) {
      return value.some((child) => (
        child
        && typeof child === "object"
        && expressionContainsTaintSource(child, predicate)
      ));
    }
    return Boolean(
      value
      && typeof value === "object"
      && expressionContainsTaintSource(value, predicate),
    );
  });
}

function directFunctionDeclarations(functionNode) {
  return new Map((functionNode?.body?.body || []).map((statement) => (
    statement?.type === "FunctionDeclaration" && statement.id?.name
      ? [statement.id.name, statement]
      : null
  )).filter(Boolean));
}

const READ_ONLY_TAINT_CALLS = new Set([
  "Array.isArray",
  "Boolean",
  "Number",
  "Object.entries",
  "Object.getOwnPropertyDescriptor",
  "Object.hasOwn",
  "Object.keys",
  "Object.values",
  "String",
]);
const READ_ONLY_TAINT_MEMBER_CALLS = new Set(["every"]);
const READ_ONLY_GLOBAL_REALM_NAMES = new Set([
  "globalThis",
  "self",
  "window",
]);
const READ_ONLY_INTRINSIC_MUTATION_CALLS = new Set([
  "Object.assign",
  "Object.defineProperties",
  "Object.defineProperty",
  "Object.setPrototypeOf",
  "Reflect.defineProperty",
  "Reflect.deleteProperty",
  "Reflect.set",
  "Reflect.setPrototypeOf",
]);

function memberRootIdentifierName(node) {
  let current = node;
  while (current?.type === "MemberExpression") current = current.object;
  return current?.type === "Identifier" ? current.name : "";
}

function staticCallName(callNode) {
  const callee = callNode?.callee;
  if (callee?.type === "Identifier") return callee.name;
  if (
    callee?.type === "MemberExpression"
    && !callee.computed
    && callee.object?.type === "Identifier"
    && callee.property?.type === "Identifier"
  ) {
    return `${callee.object.name}.${callee.property.name}`;
  }
  return "";
}

function staticMemberPath(node) {
  if (node?.type === "Identifier") return node.name;
  if (node?.type !== "MemberExpression") return "";
  const objectPath = staticMemberPath(node.object);
  const propertyName = !node.computed && node.property?.type === "Identifier"
    ? node.property.name
    : node.computed
      && node.property?.type === "Literal"
      && ["string", "number"].includes(typeof node.property.value)
        ? String(node.property.value)
        : "";
  if (!objectPath || !propertyName) return "";
  return `${objectPath}.${propertyName}`;
}

function canonicalReadOnlyIntrinsicPath(node) {
  const segments = staticMemberPath(node).split(".").filter(Boolean);
  if (READ_ONLY_GLOBAL_REALM_NAMES.has(segments[0])) segments.shift();
  return segments.join(".");
}

function staticMutationPropertyName(node) {
  if (node?.type === "Literal"
    && ["string", "number"].includes(typeof node.value)) {
    return String(node.value);
  }
  return "";
}

function collectMutatedReadOnlyIntrinsicPaths(ast) {
  const mutatedPaths = new Set();
  walkSyntaxTree(ast, (node) => {
    const directTarget = node.type === "AssignmentExpression"
      ? node.left
      : node.type === "UpdateExpression"
        ? node.argument
        : node.type === "UnaryExpression" && node.operator === "delete"
          ? node.argument
          : null;
    const directPath = canonicalReadOnlyIntrinsicPath(directTarget);
    if (directPath) mutatedPaths.add(directPath);
    if (node.type !== "CallExpression") return;
    const mutationCallName = canonicalReadOnlyIntrinsicPath(node.callee);
    if (!READ_ONLY_INTRINSIC_MUTATION_CALLS.has(mutationCallName)) return;
    const targetPath = canonicalReadOnlyIntrinsicPath(node.arguments?.[0]);
    if (!targetPath) return;
    if ([
      "Object.defineProperty",
      "Reflect.defineProperty",
      "Reflect.deleteProperty",
      "Reflect.set",
    ].includes(mutationCallName)) {
      const propertyName = staticMutationPropertyName(node.arguments?.[1]);
      mutatedPaths.add(propertyName ? `${targetPath}.${propertyName}` : targetPath);
      return;
    }
    mutatedPaths.add(targetPath);
  });
  return mutatedPaths;
}

function hasReadOnlyIntrinsicMutation(callName, mutatedPaths) {
  const segments = String(callName || "").split(".");
  while (segments.length) {
    if (mutatedPaths.has(segments.join("."))) return true;
    segments.pop();
  }
  return false;
}

function collectModuleBindingNames(ast) {
  const names = new Set();
  for (const statement of ast?.body || []) {
    if (statement.type === "ImportDeclaration") {
      for (const specifier of statement.specifiers || []) {
        if (specifier.local?.name) names.add(specifier.local.name);
      }
      continue;
    }
    const declaration = (
      statement.type === "ExportNamedDeclaration"
      || statement.type === "ExportDefaultDeclaration"
    )
      ? statement.declaration
      : statement;
    if (declaration?.type === "VariableDeclaration") {
      for (const declarator of declaration.declarations || []) {
        for (const name of collectPatternIdentifierNames(declarator.id)) {
          names.add(name);
        }
      }
    } else if (
      (declaration?.type === "FunctionDeclaration"
        || declaration?.type === "ClassDeclaration")
      && declaration.id?.name
    ) {
      names.add(declaration.id.name);
    }
  }
  return names;
}

function collectFunctionBindingNames(ast, functionNode) {
  const names = collectModuleBindingNames(ast);
  if (functionNode.id?.name) names.add(functionNode.id.name);
  for (const parameter of functionNode.params || []) {
    for (const name of collectPatternIdentifierNames(parameter)) {
      names.add(name);
    }
  }
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (
      node.type === "FunctionDeclaration"
      || node.type === "FunctionExpression"
      || node.type === "ArrowFunctionExpression"
    ) {
      if (node.type === "FunctionDeclaration" && node.id?.name) {
        names.add(node.id.name);
      }
      return;
    }
    if (node.type === "VariableDeclarator") {
      for (const name of collectPatternIdentifierNames(node.id)) {
        names.add(name);
      }
    } else if (node.type === "ClassDeclaration" && node.id?.name) {
      names.add(node.id.name);
    } else if (node.type === "CatchClause") {
      for (const name of collectPatternIdentifierNames(node.param)) {
        names.add(name);
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "loc" || key === "start" || key === "end") continue;
      if (Array.isArray(value)) {
        for (const child of value) visit(child);
      } else if (value && typeof value === "object") {
        visit(value);
      }
    }
  };
  visit(functionNode.body);
  return names;
}

function isUnshadowedReadOnlyTaintCall(
  callName,
  bindingNames,
  mutatedIntrinsicPaths,
) {
  if (!READ_ONLY_TAINT_CALLS.has(callName)) return false;
  const rootName = callName.split(".", 1)[0];
  return !bindingNames.has(rootName)
    && !hasReadOnlyIntrinsicMutation(callName, mutatedIntrinsicPaths);
}

function collectReachableTaintedHazardSites({
  ast,
  rootFunction,
  taintedParameterIndexes = [],
  taintSourcePredicate = () => false,
  safeHelperNames = new Set(),
  taintPreservingHelperNames = new Set(),
  localFunctions = null,
} = {}) {
  const functions = localFunctions || topLevelFunctionDeclarations(ast);
  const mutatedIntrinsicPaths = collectMutatedReadOnlyIntrinsicPaths(ast);
  const queue = [{
    functionNode: rootFunction,
    taintedParameterIndexes,
    taintedSourceNames: [],
  }];
  const visitedContexts = new Set();
  const hazardSites = new Map();
  while (queue.length) {
    const {
      functionNode,
      taintedParameterIndexes: parameterIndexes,
      taintedSourceNames,
    } = queue.shift();
    const contextId = [
      functionNode.id?.name || `<anonymous:${functionNode.start}>`,
      [...parameterIndexes].sort((left, right) => left - right).join(","),
      [...taintedSourceNames].sort().join(","),
    ].join("#");
    if (visitedContexts.has(contextId)) continue;
    visitedContexts.add(contextId);
    const bindingNames = collectFunctionBindingNames(ast, functionNode);
    const taintedNames = new Set(taintedSourceNames);
    const localNames = new Set();
    walkFunctionBody(functionNode.body, (node) => {
      if (node.type !== "VariableDeclarator") return;
      for (const name of collectPatternIdentifierNames(node.id)) {
        localNames.add(name);
      }
    });
    const expressionIsTainted = (node) => (
      expressionContainsTaintedReference(node, taintedNames)
      || expressionContainsTaintSource(node, taintSourcePredicate)
    );
    for (const parameterIndex of parameterIndexes) {
      for (const name of collectPatternIdentifierNames(
        functionNode.params?.[parameterIndex],
      )) {
        taintedNames.add(name);
      }
    }

    let aliasAdded = true;
    while (aliasAdded) {
      aliasAdded = false;
      walkFunctionBody(functionNode.body, (node) => {
        const sourceExpression = node.type === "VariableDeclarator"
          ? node.init
          : node.type === "AssignmentExpression" && node.operator === "="
            ? node.right
            : null;
        const targetPattern = node.type === "VariableDeclarator"
          ? node.id
          : node.type === "AssignmentExpression" && node.operator === "="
            ? node.left
            : null;
        if (
          !targetPattern
          || !(
            expressionReferencesTaintedInput(sourceExpression, taintedNames)
            || (
              sourceExpression?.type === "CallExpression"
              && sourceExpression.callee?.type === "Identifier"
              && taintPreservingHelperNames.has(sourceExpression.callee.name)
              && (sourceExpression.arguments || []).some(expressionIsTainted)
            )
            || expressionContainsTaintSource(
              sourceExpression,
              taintSourcePredicate,
            )
          )
        ) return;
        for (const name of collectPatternIdentifierNames(targetPattern)) {
          if (!taintedNames.has(name)) {
            taintedNames.add(name);
            aliasAdded = true;
          }
        }
      });
    }

    walkFunctionBody(functionNode.body, (node) => {
      if (node.type === "AssignmentExpression") {
        const targetIsTainted = node.left?.type === "MemberExpression"
          && expressionReferencesTaintedInput(node.left.object, taintedNames);
        const targetRootName = node.left?.type === "MemberExpression"
          ? memberRootIdentifierName(node.left)
          : "";
        const taintedValueEscapes = node.left?.type === "MemberExpression"
          && expressionIsTainted(node.right)
          && !(localNames.has(targetRootName) && !taintedNames.has(targetRootName));
        if (targetIsTainted || taintedValueEscapes) {
          hazardSites.set(`${node.start}:${node.end}`, node);
        }
        return;
      }
      if (
        (node.type === "UpdateExpression"
          || (node.type === "UnaryExpression" && node.operator === "delete"))
        && node.argument?.type === "MemberExpression"
        && expressionReferencesTaintedInput(node.argument.object, taintedNames)
      ) {
        hazardSites.set(`${node.start}:${node.end}`, node);
        return;
      }
      if (node.type !== "CallExpression") return;
      const callName = staticCallName(node);
      const memberCallName = node.callee?.type === "MemberExpression"
        ? String(node.callee.property?.name || node.callee.property?.value || "")
        : "";
      const taintedArgumentIndexes = (node.arguments || [])
        .map((argument, index) => (
          expressionIsTainted(argument)
            ? index
            : -1
        ))
        .filter((index) => index >= 0);
      const calleeObjectIsTainted = node.callee?.type === "MemberExpression"
        && expressionReferencesTaintedInput(node.callee.object, taintedNames);
      if (calleeObjectIsTainted) {
        hazardSites.set(`${node.start}:${node.end}`, node);
        return;
      }
      const localFunction = node.callee?.type === "Identifier"
        ? functions.get(node.callee.name)
        : null;
      if (safeHelperNames.has(callName)) return;
      if (localFunction && taintedArgumentIndexes.length) {
        queue.push({
          functionNode: localFunction,
          taintedParameterIndexes: taintedArgumentIndexes,
          taintedSourceNames: [],
        });
        return;
      }
      if (
        taintedArgumentIndexes.length
        && !isUnshadowedReadOnlyTaintCall(
          callName,
          bindingNames,
          mutatedIntrinsicPaths,
        )
        && !READ_ONLY_TAINT_MEMBER_CALLS.has(memberCallName)
      ) {
        hazardSites.set(`${node.start}:${node.end}`, node);
      }
    });
  }
  return [...hazardSites.values()];
}

function collectReachableTargetMutationSites(
  ast,
  exportedFunction,
  targetArgumentIndex,
) {
  const localFunctions = new Map();
  for (const statement of ast.body || []) {
    const declaration = statement.type === "ExportNamedDeclaration"
      ? statement.declaration
      : statement;
    if (
      declaration?.type === "FunctionDeclaration"
      && declaration.id?.name
    ) {
      localFunctions.set(declaration.id.name, declaration);
    }
  }
  const queue = [{
    functionNode: exportedFunction,
    taintedParameterIndexes: [targetArgumentIndex],
  }];
  const visitedContexts = new Set();
  const mutationSites = new Map();
  while (queue.length) {
    const { functionNode, taintedParameterIndexes } = queue.shift();
    const contextId = [
      functionNode.id?.name || `<anonymous:${functionNode.start}>`,
      [...taintedParameterIndexes].sort((left, right) => left - right).join(","),
    ].join("#");
    if (visitedContexts.has(contextId)) continue;
    visitedContexts.add(contextId);
    const taintedNames = new Set();
    for (const parameterIndex of taintedParameterIndexes) {
      for (
        const name of collectPatternIdentifierNames(
          functionNode.params?.[parameterIndex],
        )
      ) {
        taintedNames.add(name);
      }
    }
    let aliasAdded = true;
    while (aliasAdded) {
      aliasAdded = false;
      walkFunctionBody(functionNode.body, (node) => {
        const sourceExpression = node.type === "VariableDeclarator"
          ? node.init
          : node.type === "AssignmentExpression" && node.operator === "="
            ? node.right
            : null;
        const targetPattern = node.type === "VariableDeclarator"
          ? node.id
          : node.type === "AssignmentExpression" && node.operator === "="
            ? node.left
            : null;
        if (
          !targetPattern
          || !expressionReferencesTaintedInput(
            sourceExpression,
            taintedNames,
          )
        ) {
          return;
        }
        for (const name of collectPatternIdentifierNames(targetPattern)) {
          if (!taintedNames.has(name)) {
            taintedNames.add(name);
            aliasAdded = true;
          }
        }
      });
    }
    walkFunctionBody(functionNode.body, (node) => {
      const mutationTarget = node.type === "AssignmentExpression"
        ? node.left
        : node.type === "UpdateExpression"
          ? node.argument
          : node.type === "UnaryExpression" && node.operator === "delete"
            ? node.argument
            : null;
      if (
        mutationTarget?.type === "MemberExpression"
        && expressionReferencesTaintedInput(
          mutationTarget.object,
          taintedNames,
        )
      ) {
        mutationSites.set(`${node.start}:${node.end}`, node);
      }
      if (node.type !== "CallExpression") return;
      if (
        node.callee?.type === "MemberExpression"
        && expressionReferencesTaintedInput(
          node.callee.object,
          taintedNames,
        )
      ) {
        mutationSites.set(`${node.start}:${node.end}`, node);
      }
      if (
        node.callee?.type === "MemberExpression"
        && node.callee.object?.type === "Identifier"
        && ["Object", "Reflect"].includes(node.callee.object.name)
        && ["assign", "defineProperty", "deleteProperty", "set"].includes(
          String(node.callee.property?.name || node.callee.property?.value || ""),
        )
        && expressionReferencesTaintedInput(
          node.arguments?.[0],
          taintedNames,
        )
      ) {
        mutationSites.set(`${node.start}:${node.end}`, node);
      }
      if (node.callee?.type !== "Identifier") return;
      const localFunction = localFunctions.get(node.callee.name);
      if (!localFunction) return;
      const propagatedIndexes = (node.arguments || [])
        .map((argument, index) => (
          expressionReferencesTaintedInput(argument, taintedNames)
            ? index
            : -1
        ))
        .filter((index) => index >= 0);
      if (propagatedIndexes.length) {
        queue.push({
          functionNode: localFunction,
          taintedParameterIndexes: propagatedIndexes,
        });
      }
    });
  }
  return [...mutationSites.values()];
}

export function inspectStateImportedPureNormalizerSource(source, entry) {
  const violations = validateStateImportedPureNormalizerContract([entry]);
  if (violations.length) {
    return { violations, sourceFingerprint: "" };
  }
  const normalizedSource = String(source || "").replaceAll("\r\n", "\n");
  let ast;
  try {
    ast = parseModuleSource(normalizedSource);
  } catch (error) {
    return {
      violations: [createViolation(
        "state-imported-pure-normalizer-source-parse-failed",
        {
          modulePath: normalizeModulePath(entry.modulePath),
          exportName: String(entry.exportName || ""),
          message: String(error?.message || ""),
        },
      )],
      sourceFingerprint: "",
    };
  }
  const sourceFingerprint = createHash("sha256")
    .update(normalizedSource)
    .digest("hex");
  if (sourceFingerprint !== entry.sourceFingerprint) {
    violations.push(createViolation(
      "state-imported-pure-normalizer-source-drift",
      {
        modulePath: normalizeModulePath(entry.modulePath),
        exportName: String(entry.exportName || ""),
        expectedSourceFingerprint: String(entry.sourceFingerprint || ""),
        actualSourceFingerprint: sourceFingerprint,
      },
    ));
  }
  const importSites = [];
  walkSyntaxTree(ast, (node) => {
    if (
      node.type === "ImportDeclaration"
      || node.type === "ImportExpression"
      || (
        (node.type === "ExportNamedDeclaration"
          || node.type === "ExportAllDeclaration")
        && node.source
      )
    ) {
      importSites.push(node);
    }
  });
  if (importSites.length) {
    violations.push(createViolation(
      "state-imported-pure-normalizer-import-free-proof-failed",
      {
        modulePath: normalizeModulePath(entry.modulePath),
        exportName: String(entry.exportName || ""),
        count: importSites.length,
      },
    ));
  }
  const exportedFunctions = (ast.body || []).filter((statement) => (
    statement.type === "ExportNamedDeclaration"
    && statement.declaration?.type === "FunctionDeclaration"
    && statement.declaration.id?.name === entry.exportName
  )).map((statement) => statement.declaration);
  if (exportedFunctions.length !== 1) {
    violations.push(createViolation(
      "state-imported-pure-normalizer-direct-export-invalid",
      {
        modulePath: normalizeModulePath(entry.modulePath),
        exportName: String(entry.exportName || ""),
        count: exportedFunctions.length,
      },
    ));
  } else {
    const [functionNode] = exportedFunctions;
    const targetParameter =
      functionNode.params?.[entry.targetArgumentIndex];
    if (targetParameter?.type !== "Identifier") {
      violations.push(createViolation(
        "state-imported-pure-normalizer-target-parameter-invalid",
        {
          modulePath: normalizeModulePath(entry.modulePath),
          exportName: String(entry.exportName || ""),
          targetArgumentIndex: entry.targetArgumentIndex,
        },
      ));
    } else {
      const mutationSites = collectReachableTaintedHazardSites({
        ast,
        rootFunction: functionNode,
        taintedParameterIndexes: [entry.targetArgumentIndex],
      });
      if (mutationSites.length) {
        violations.push(createViolation(
          "state-imported-pure-normalizer-target-mutation-proof-failed",
          {
            modulePath: normalizeModulePath(entry.modulePath),
            exportName: String(entry.exportName || ""),
            count: mutationSites.length,
            lines: mutationSites.map(
              (node) => Number(node.loc?.start?.line || 1),
            ),
          },
        ));
      }
    }
  }
  return { violations, sourceFingerprint };
}

function fingerprintFunctionSource(source, node) {
  return createHash("sha256")
    .update(String(source || "").slice(node.start, node.end).trim())
    .digest("hex");
}

function topLevelFunctionDeclarations(ast) {
  return new Map((ast?.body || []).map((statement) => {
    const declaration = statement.type === "ExportNamedDeclaration"
      ? statement.declaration
      : statement;
    return declaration?.type === "FunctionDeclaration" && declaration.id?.name
      ? [declaration.id.name, declaration]
      : null;
  }).filter(Boolean));
}

function expressionContainsDetachedCaptureAlias(
  node,
  aliases,
  safeCloneHelperNames,
) {
  if (!node) return false;
  if (node.type === "Identifier") return aliases.has(node.name);
  if (node.type === "ChainExpression") {
    return expressionContainsDetachedCaptureAlias(
      node.expression,
      aliases,
      safeCloneHelperNames,
    );
  }
  if (node.type === "MemberExpression") {
    return expressionContainsDetachedCaptureAlias(
      node.object,
      aliases,
      safeCloneHelperNames,
    ) || (
      node.computed
      && expressionContainsDetachedCaptureAlias(
        node.property,
        aliases,
        safeCloneHelperNames,
      )
    );
  }
  if (node.type === "ConditionalExpression") {
    return expressionContainsDetachedCaptureAlias(
      node.consequent,
      aliases,
      safeCloneHelperNames,
    ) || expressionContainsDetachedCaptureAlias(
      node.alternate,
      aliases,
      safeCloneHelperNames,
    );
  }
  if (node.type === "ObjectExpression") {
    return (node.properties || []).some((property) => (
      property.type === "SpreadElement"
        ? expressionContainsDetachedCaptureAlias(
          property.argument,
          aliases,
          safeCloneHelperNames,
        )
        : (
          (property.computed && expressionContainsDetachedCaptureAlias(
            property.key,
            aliases,
            safeCloneHelperNames,
          ))
          || expressionContainsDetachedCaptureAlias(
            property.value,
            aliases,
            safeCloneHelperNames,
          )
        )
    ));
  }
  if (node.type === "ArrayExpression") {
    return (node.elements || []).some((element) => (
      expressionContainsDetachedCaptureAlias(
        element?.type === "SpreadElement" ? element.argument : element,
        aliases,
        safeCloneHelperNames,
      )
    ));
  }
  if (node.type === "CallExpression") {
    if (
      node.callee?.type === "Identifier"
      && (
        safeCloneHelperNames.has(node.callee.name)
        || ["Boolean", "Number", "String"].includes(node.callee.name)
      )
    ) {
      return false;
    }
  }
  if (
    node.type === "FunctionExpression"
    || node.type === "ArrowFunctionExpression"
    || node.type === "FunctionDeclaration"
  ) {
    return false;
  }
  return Object.entries(node).some(([key, value]) => {
    if (["loc", "start", "end"].includes(key)) return false;
    if (Array.isArray(value)) {
      return value.some((child) => child && typeof child === "object"
        && expressionContainsDetachedCaptureAlias(
          child,
          aliases,
          safeCloneHelperNames,
        ));
    }
    return value && typeof value === "object"
      ? expressionContainsDetachedCaptureAlias(
        value,
        aliases,
        safeCloneHelperNames,
      )
      : false;
  });
}

export function inspectStateDetachedCaptureSource(source, entry) {
  const violations = validateStateDetachedCaptureContract([entry]);
  if (violations.length) return { violations, sourceFingerprint: "" };
  const normalizedSource = String(source || "").replaceAll("\r\n", "\n");
  let ast;
  try {
    ast = parseModuleSource(normalizedSource);
  } catch (error) {
    return {
      violations: [createViolation("state-detached-capture-source-parse-failed", {
        modulePath: entry.modulePath,
        exportName: entry.exportName,
        message: String(error?.message || ""),
      })],
      sourceFingerprint: "",
    };
  }
  const functions = topLevelFunctionDeclarations(ast);
  const capture = functions.get(entry.exportName);
  if (!capture || !((ast.body || []).some((statement) => (
    statement.type === "ExportNamedDeclaration"
    && statement.declaration === capture
  )))) {
    violations.push(createViolation("state-detached-capture-direct-export-invalid", {
      modulePath: entry.modulePath,
      exportName: entry.exportName,
    }));
    return { violations, sourceFingerprint: "" };
  }
  const sourceFingerprint = fingerprintFunctionSource(normalizedSource, capture);
  if (sourceFingerprint !== entry.sourceFingerprint) {
    violations.push(createViolation("state-detached-capture-source-drift", {
      modulePath: entry.modulePath,
      exportName: entry.exportName,
      expectedSourceFingerprint: entry.sourceFingerprint,
      actualSourceFingerprint: sourceFingerprint,
    }));
  }
  if (capture.params?.[entry.targetArgumentIndex]?.type !== "Identifier") {
    violations.push(createViolation("state-detached-capture-target-parameter-invalid", {
      modulePath: entry.modulePath,
      exportName: entry.exportName,
      targetArgumentIndex: entry.targetArgumentIndex,
    }));
    return { violations, sourceFingerprint };
  }
  const safeCloneHelperNames = new Set();
  const taintPreservingReadHelperNames = new Set();
  for (const [helperName, expectedFingerprint] of Object.entries(
    entry.cloneHelperFingerprints || {},
  )) {
    const helper = functions.get(helperName);
    const actualFingerprint = helper
      ? fingerprintFunctionSource(normalizedSource, helper)
      : "";
    if (actualFingerprint !== expectedFingerprint) {
      violations.push(createViolation("state-detached-capture-clone-helper-source-drift", {
        modulePath: entry.modulePath,
        exportName: entry.exportName,
        helperName,
        expectedSourceFingerprint: expectedFingerprint,
        actualSourceFingerprint: actualFingerprint,
      }));
    } else {
      safeCloneHelperNames.add(helperName);
    }
  }
  for (const [helperName, expectedFingerprint] of Object.entries(
    entry.readHelperFingerprints || {},
  )) {
    const helper = functions.get(helperName);
    const actualFingerprint = helper
      ? fingerprintFunctionSource(normalizedSource, helper)
      : "";
    if (actualFingerprint !== expectedFingerprint) {
      violations.push(createViolation("state-detached-capture-read-helper-source-drift", {
        modulePath: entry.modulePath,
        exportName: entry.exportName,
        helperName,
        expectedSourceFingerprint: expectedFingerprint,
        actualSourceFingerprint: actualFingerprint,
      }));
    } else {
      taintPreservingReadHelperNames.add(helperName);
    }
  }
  const targetName = capture.params[entry.targetArgumentIndex].name;
  const aliases = new Set([targetName]);
  let changed = true;
  while (changed) {
    changed = false;
    walkFunctionBody(capture.body, (node) => {
      if (
        node.type === "VariableDeclarator"
        && node.id?.type === "Identifier"
        && expressionContainsDetachedCaptureAlias(
          node.init,
          aliases,
          new Set(),
        )
        && !aliases.has(node.id.name)
      ) {
        aliases.add(node.id.name);
        changed = true;
      }
    });
  }
  const aliasReturns = [];
  const aliasReturnKeys = [];
  walkFunctionBody(capture.body, (node) => {
    if (
      node.type === "ReturnStatement"
      && expressionContainsDetachedCaptureAlias(
        node.argument,
        aliases,
        safeCloneHelperNames,
      )
    ) {
      aliasReturns.push(node);
      if (node.argument?.type === "ObjectExpression") {
        aliasReturnKeys.push(...(node.argument.properties || [])
          .filter((property) => expressionContainsDetachedCaptureAlias(
            property.value,
            aliases,
            safeCloneHelperNames,
          ))
          .map((property) => String(property.key?.name || property.key?.value || "*")));
      }
    }
  });
  if (aliasReturns.length) {
    violations.push(createViolation("state-detached-capture-alias-escape", {
      modulePath: entry.modulePath,
      exportName: entry.exportName,
      count: aliasReturns.length,
      lines: aliasReturns.map((node) => Number(node.loc?.start?.line || 1)),
      keys: [...new Set(aliasReturnKeys)].sort(),
    }));
  }
  const hazardSites = collectReachableTaintedHazardSites({
    ast,
    rootFunction: capture,
    taintedParameterIndexes: [entry.targetArgumentIndex],
    safeHelperNames: safeCloneHelperNames,
    taintPreservingHelperNames: taintPreservingReadHelperNames,
  });
  if (hazardSites.length) {
    violations.push(createViolation("state-detached-capture-alias-escape", {
      modulePath: entry.modulePath,
      exportName: entry.exportName,
      count: hazardSites.length,
      lines: hazardSites.map((node) => Number(node.loc?.start?.line || 1)),
      keys: [],
    }));
  }
  return { violations, sourceFingerprint };
}

function rootIdentifierName(node) {
  let current = node;
  while (current?.type === "MemberExpression") current = current.object;
  if (current?.type === "CallExpression") return rootIdentifierName(current.callee);
  return current?.type === "Identifier" ? current.name : "";
}

export function inspectStateMutationDelegatingOwnerSources({
  compositionSource,
  factorySource,
  entry,
} = {}) {
  const violations = validateStateMutationDelegatingOwnerContract([entry]);
  if (violations.length) return { violations };
  let compositionAst;
  let factoryAst;
  try {
    compositionAst = parseModuleSource(String(compositionSource || "").replaceAll("\r\n", "\n"));
    factoryAst = parseModuleSource(String(factorySource || "").replaceAll("\r\n", "\n"));
  } catch (error) {
    return { violations: [createViolation("state-mutation-owner-source-parse-failed", {
      message: String(error?.message || ""),
    })] };
  }
  const normalizedComposition = String(compositionSource || "").replaceAll("\r\n", "\n");
  const normalizedFactory = String(factorySource || "").replaceAll("\r\n", "\n");
  const compositionFunctions = topLevelFunctionDeclarations(compositionAst);
  const factoryFunctions = topLevelFunctionDeclarations(factoryAst);
  const composition = compositionFunctions.get(entry.compositionExportName);
  const factory = factoryFunctions.get(entry.factoryExportName);
  if (!composition || fingerprintFunctionSource(normalizedComposition, composition)
    !== entry.compositionSourceFingerprint) {
    violations.push(createViolation("state-mutation-owner-composition-source-drift", {
      modulePath: entry.compositionModulePath,
      functionName: entry.compositionExportName,
      actualSourceFingerprint: composition
        ? fingerprintFunctionSource(normalizedComposition, composition)
        : "",
    }));
  }
  if (!factory || fingerprintFunctionSource(normalizedFactory, factory)
    !== entry.factorySourceFingerprint) {
    violations.push(createViolation("state-mutation-owner-factory-source-drift", {
      modulePath: entry.factoryModulePath,
      exportName: entry.factoryExportName,
      actualSourceFingerprint: factory
        ? fingerprintFunctionSource(normalizedFactory, factory)
        : "",
    }));
  }
  if (!composition || !factory) return { violations };

  const imports = new Map();
  for (const statement of compositionAst.body || []) {
    if (statement.type !== "ImportDeclaration") continue;
    for (const specifier of statement.specifiers || []) {
      if (specifier.type === "ImportSpecifier") {
        imports.set(specifier.local.name, {
          source: normalizeModulePath(path.posix.normalize(path.posix.join(
            path.posix.dirname(entry.compositionModulePath),
            String(statement.source.value || ""),
          ))),
          importedName: specifier.imported.name,
        });
      }
    }
  }
  const factoryLocalName = [...imports].find(([, imported]) => (
    imported.source === entry.factoryModulePath
    && imported.importedName === entry.factoryExportName
  ))?.[0] || "";
  const factoryCalls = [];
  walkFunctionBody(composition.body, (node) => {
    if (node.type === "CallExpression" && node.callee?.name === factoryLocalName) {
      factoryCalls.push(node);
    }
  });
  if (factoryCalls.length !== 1) {
    violations.push(createViolation("state-mutation-owner-factory-composition-invalid", {
      count: factoryCalls.length,
    }));
  } else {
    const options = factoryCalls[0].arguments?.[0];
    const effects = options?.type === "ObjectExpression"
      ? options.properties.find((property) => property.key?.name === "effects")?.value
      : null;
    for (const actionExportName of entry.actionExports) {
      const actionModulePath = entry.actionModulePathsByExport?.[actionExportName]
        || entry.actionModulePath;
      const matches = [];
      walkSyntaxTree(effects, (node) => {
        if (node.type !== "CallExpression" || node.callee?.type !== "Identifier") return;
        const imported = imports.get(node.callee.name);
        if (
          imported?.source === actionModulePath
          && imported.importedName === actionExportName
          && node.arguments?.[0]?.type === "Identifier"
          && node.arguments[0].name === "runtimeState"
        ) matches.push(node);
      });
      if (matches.length !== 1) {
        violations.push(createViolation("state-mutation-owner-action-effect-edge-invalid", {
          actionExportName,
          count: matches.length,
        }));
      }
    }
  }

  const returnedMethodNames = new Set();
  walkFunctionBody(factory.body, (node) => {
    if (node.type === "ReturnStatement" && node.argument?.type === "CallExpression"
      && node.argument.callee?.type === "MemberExpression"
      && node.argument.callee.object?.name === "Object"
      && node.argument.callee.property?.name === "freeze"
      && node.argument.arguments?.[0]?.type === "ObjectExpression") {
      for (const property of node.argument.arguments[0].properties || []) {
        if (property.key?.name) returnedMethodNames.add(property.key.name);
      }
    }
    if (
      node.type === "AssignmentExpression"
      && node.left?.type === "MemberExpression"
      && ["getters", "runtimeState", "state", "target"].includes(
        rootIdentifierName(node.left.object),
      )
    ) {
      violations.push(createViolation("state-mutation-owner-direct-mutation", {
        line: Number(node.loc?.start?.line || 1),
      }));
    }
  });
  for (const method of entry.methods) {
    if (!returnedMethodNames.has(method)) {
      violations.push(createViolation("state-mutation-owner-method-missing", { method }));
    }
  }
  const factoryLocalFunctions = directFunctionDeclarations(factory);
  for (const methodName of entry.methods) {
    const methodNode = factoryLocalFunctions.get(methodName);
    if (!methodNode) continue;
    const mutationSites = collectReachableTaintedHazardSites({
      ast: factoryAst,
      rootFunction: methodNode,
      taintSourcePredicate: (node) => (
        node?.type === "CallExpression"
        && rootIdentifierName(node.callee) === "getters"
      ),
      localFunctions: factoryLocalFunctions,
    });
    for (const node of mutationSites) {
      violations.push(createViolation("state-mutation-owner-direct-mutation", {
        line: Number(node.loc?.start?.line || 1),
      }));
    }
  }
  return { violations };
}

const PURE_READER_ENTRY_BY_ID = new Map(
  STATE_TARGET_PURE_READER_CONTRACT.map((entry) => [
    [
      entry.modulePath,
      entry.functionName,
      entry.targetParameterIndex,
      entry.targetParameterPath,
    ].join("#"),
    entry,
  ]),
);

function normalizeModulePath(value = "") {
  return String(value || "")
    .replaceAll("\\", "/")
    .replace(/^\.\//, "");
}

const STATE_ACTION_READ_ONLY_ARGUMENT_INDEXES_BY_ID = new Map([
  [
    `${SCENARIO_CHUNK_RUNTIME_ACTION_MODULE_PATH}#replaceScenarioChunkPendingPromotionIdentityState`,
    Object.freeze([1]),
  ],
]);

function freezeAllowedDynamicSite({
  operation,
  key,
  pathPattern,
}) {
  return Object.freeze({
    operation: String(operation || ""),
    key: String(key || ""),
    pathPattern: String(pathPattern || ""),
  });
}

const RENDER_PERF_METRIC_DYNAMIC_SITES = Object.freeze([
  freezeAllowedDynamicSite({
    operation: "define-property",
    key: "renderPerfMetrics",
    pathPattern: "renderPerfMetrics.*",
  }),
  freezeAllowedDynamicSite({
    operation: "assign",
    key: "renderPerfMetrics",
    pathPattern: "renderPerfMetrics.*",
  }),
]);

const STATE_ACTION_ALLOWED_DYNAMIC_SITES_BY_ID = new Map([
  [
    `${RENDERER_DIAGNOSTICS_ACTION_MODULE_PATH}#setRenderPerfMetricEntryState`,
    RENDER_PERF_METRIC_DYNAMIC_SITES,
  ],
  [
    `${RENDERER_DIAGNOSTICS_ACTION_MODULE_PATH}#commitRenderPerfMetricState`,
    RENDER_PERF_METRIC_DYNAMIC_SITES,
  ],
]);

function freezeDelegationEntry({
  modulePath,
  exportName,
  targetArgumentIndex = 0,
  introducedInPhase,
}) {
  const normalizedModulePath = normalizeModulePath(modulePath);
  const normalizedExportName = String(exportName || "");
  return Object.freeze({
    modulePath: normalizedModulePath,
    exportName: normalizedExportName,
    targetArgumentIndex: Number(targetArgumentIndex),
    readOnlyArgumentIndexes:
      STATE_ACTION_READ_ONLY_ARGUMENT_INDEXES_BY_ID.get(
        `${normalizedModulePath}#${normalizedExportName}`,
      ) || Object.freeze([]),
    allowedDynamicSites:
      STATE_ACTION_ALLOWED_DYNAMIC_SITES_BY_ID.get(
        `${normalizedModulePath}#${normalizedExportName}`,
      ) || Object.freeze([]),
    introducedInPhase: String(introducedInPhase || ""),
  });
}

export const STATE_ACTION_DELEGATION_CONTRACT = Object.freeze(
  STATE_ACTION_EXPORT_GROUPS.flatMap(({
    modulePath,
    exportNames,
    introducedInPhase,
  }) =>
    exportNames.map((exportName) =>
      freezeDelegationEntry({
        modulePath,
        exportName,
        targetArgumentIndex: 0,
        introducedInPhase,
      })
    )
  ),
);

const CONTRACT_ENTRY_BY_ID = new Map(
  STATE_ACTION_DELEGATION_CONTRACT.map((entry) => [
    `${entry.modulePath}#${entry.exportName}`,
    entry,
  ]),
);

function normalizeStateActionMembership(value = "") {
  return String(value || "").trim();
}

function stateActionLegacyMembershipReplacementIdentityPayload(
  entry = {},
) {
  return {
    modulePath: normalizeModulePath(entry.modulePath),
    exportName: String(entry.exportName || ""),
    retiredMembership: normalizeStateActionMembership(
      entry.retiredMembership,
    ),
    requiredConcreteMemberships: (
      Array.isArray(entry.requiredConcreteMemberships)
        ? entry.requiredConcreteMemberships
        : []
    ).map(normalizeStateActionMembership),
  };
}

export function buildStateActionLegacyMembershipReplacementContractIdentity(
  entry = {},
) {
  return createHash("sha256")
    .update(JSON.stringify(
      stateActionLegacyMembershipReplacementIdentityPayload(entry),
    ))
    .digest("hex");
}

function freezeLegacyMembershipReplacementEntry(entry = {}) {
  const normalized =
    stateActionLegacyMembershipReplacementIdentityPayload(entry);
  const contractIdentity =
    buildStateActionLegacyMembershipReplacementContractIdentity(
      normalized,
    );
  return Object.freeze({
    ...normalized,
    requiredConcreteMemberships: Object.freeze(
      normalized.requiredConcreteMemberships,
    ),
    contractIdentity,
  });
}

const SCENARIO_CHUNK_OPTIONAL_LAYER_ASSIGN_MEMBERSHIPS = Object.freeze([
  "scenario|P4.2|assign|scenarioAtlantropaData",
  "scenario|P4.2|assign|scenarioAtlantropaRevision",
  "scenario|P4.2|assign|scenarioReliefOverlayRevision",
  "scenario|P4.2|assign|scenarioReliefOverlaysData",
  "scenario|P4.2|assign|scenarioSpecialRegionsData",
  "scenario|P4.2|assign|scenarioStrategicValuesData",
  "scenario|P4.2|assign|scenarioStrategicValuesRevision",
  "scenario|P4.2|assign|scenarioWaterRegionsData",
  "ui|P4.4|assign|specialZoneLayers",
]);

function sortStateActionMemberships(memberships = []) {
  return Object.freeze([...new Set(memberships.map(
    normalizeStateActionMembership,
  ).filter(Boolean))].sort((left, right) => left.localeCompare(right)));
}

function createLegacyMembershipReplacementEntry({
  modulePath,
  exportName,
  retiredMembership,
  requiredConcreteMemberships,
}) {
  return freezeLegacyMembershipReplacementEntry({
    modulePath,
    exportName,
    retiredMembership,
    requiredConcreteMemberships:
      sortStateActionMemberships(requiredConcreteMemberships),
  });
}

const STRATEGIC_COLLECTION_ASSIGN_MEMBERSHIPS = sortStateActionMemberships([
  "ui|P4.4|assign|operationalLines",
  "ui|P4.4|assign|operationalLinesDirty",
  "ui|P4.4|assign|operationGraphics",
  "ui|P4.4|assign|operationGraphicsDirty",
  "ui|P4.4|assign|unitCounters",
  "ui|P4.4|assign|unitCountersDirty",
]);
const STRATEGIC_EDITOR_ASSIGN_MEMBERSHIPS = sortStateActionMemberships([
  "strategic-overlay|P4.4|assign|operationalLineEditor",
  "strategic-overlay|P4.4|assign|operationGraphicsEditor",
  "strategic-overlay|P4.4|assign|strategicOverlayUi",
  "strategic-overlay|P4.4|assign|unitCounterEditor",
]);
const TRANSPORT_OWNER_WRITE_MEMBERSHIPS = sortStateActionMemberships([
  "ui|P4.4|assign|transportWorkbenchUi",
  "ui|P4.4|define-property|showAirports",
  "ui|P4.4|define-property|showPorts",
  "ui|P4.4|define-property|showRail",
  "ui|P4.4|define-property|showRoad",
  "ui|P4.4|define-property|showTransport",
  "ui|P4.4|define-property|styleConfig",
  "ui|P4.4|define-property|transportWorkbenchPointDeltas",
  "ui|P4.4|define-property|transportWorkbenchUi",
]);
const TRANSPORT_OVERVIEW_WRITE_MEMBERSHIPS = sortStateActionMemberships([
  ...TRANSPORT_OWNER_WRITE_MEMBERSHIPS,
  "ui|P4.4|assign|styleConfig",
]);

export const STATE_ACTION_LEGACY_MEMBERSHIP_REPLACEMENT_CONTRACT =
  Object.freeze([
    ...[
      "applyScenarioChunkOptionalLayerState",
      "restoreScenarioChunkPromotionState",
    ].map((exportName) =>
      createLegacyMembershipReplacementEntry({
      modulePath: SCENARIO_ACTIVATION_ACTION_MODULE_PATH,
      exportName,
      retiredMembership: "scenario|P4.2|assign|*",
      requiredConcreteMemberships:
        SCENARIO_CHUNK_OPTIONAL_LAYER_ASSIGN_MEMBERSHIPS,
      })
    ),
    ...[
      "operationalLines",
      "operationGraphics",
      "unitCounters",
    ].flatMap((key) => [
      createLegacyMembershipReplacementEntry({
        modulePath: STRATEGIC_OVERLAY_ACTION_MODULE_PATH,
        exportName: "commitStrategicOverlayCollectionsState",
        retiredMembership: `ui|P4.4|collection-mutate|${key}`,
        requiredConcreteMemberships: STRATEGIC_COLLECTION_ASSIGN_MEMBERSHIPS,
      }),
      createLegacyMembershipReplacementEntry({
        modulePath: STRATEGIC_OVERLAY_ACTION_MODULE_PATH,
        exportName: "patchStrategicOverlayEntityGroupState",
        retiredMembership: `ui|P4.4|collection-mutate|${key}`,
        requiredConcreteMemberships: STRATEGIC_COLLECTION_ASSIGN_MEMBERSHIPS,
      }),
    ]),
    ...[
      "operationalLineEditor",
      "operationGraphicsEditor",
      "strategicOverlayUi",
      "unitCounterEditor",
    ].map((key) => createLegacyMembershipReplacementEntry({
      modulePath: STRATEGIC_OVERLAY_ACTION_MODULE_PATH,
      exportName: "patchStrategicOverlayEditorState",
      retiredMembership: `strategic-overlay|P4.4|compound-assign|${key}`,
      requiredConcreteMemberships: STRATEGIC_EDITOR_ASSIGN_MEMBERSHIPS,
    })),
    createLegacyMembershipReplacementEntry({
      modulePath: TRANSPORT_ACTION_MODULE_PATH,
      exportName: "applyTransportWorkbenchOverviewState",
      retiredMembership: "ui|P4.4|assign|*",
      requiredConcreteMemberships: TRANSPORT_OVERVIEW_WRITE_MEMBERSHIPS,
    }),
    createLegacyMembershipReplacementEntry({
      modulePath: TRANSPORT_ACTION_MODULE_PATH,
      exportName: "applyTransportWorkbenchOverviewState",
      retiredMembership: "ui|P4.4|assign|showTransport",
      requiredConcreteMemberships: TRANSPORT_OVERVIEW_WRITE_MEMBERSHIPS,
    }),
    createLegacyMembershipReplacementEntry({
      modulePath: TRANSPORT_ACTION_MODULE_PATH,
      exportName: "setTransportMasterVisibilityState",
      retiredMembership: "ui|P4.4|assign|showTransport",
      requiredConcreteMemberships: TRANSPORT_OWNER_WRITE_MEMBERSHIPS,
    }),
    ...[
      "showAirports",
      "showPorts",
      "showRail",
      "showRoad",
    ].map((key) => createLegacyMembershipReplacementEntry({
      modulePath: TRANSPORT_ACTION_MODULE_PATH,
      exportName: "setTransportFamilyVisibilityState",
      retiredMembership: `ui|P4.4|assign|${key}`,
      requiredConcreteMemberships: TRANSPORT_OWNER_WRITE_MEMBERSHIPS,
    })),
    createLegacyMembershipReplacementEntry({
      modulePath: TRANSPORT_ACTION_MODULE_PATH,
      exportName: "commitTransportWorkbenchPointDeltasState",
      retiredMembership: "ui|P4.4|assign|transportWorkbenchPointDeltas",
      requiredConcreteMemberships: TRANSPORT_OWNER_WRITE_MEMBERSHIPS,
    }),
    createLegacyMembershipReplacementEntry({
      modulePath: TRANSPORT_ACTION_MODULE_PATH,
      exportName: "ensureTransportWorkbenchUiState",
      retiredMembership: "ui|P4.4|assign|transportWorkbenchUi",
      requiredConcreteMemberships: TRANSPORT_OWNER_WRITE_MEMBERSHIPS,
    }),
    createLegacyMembershipReplacementEntry({
      modulePath: TRANSPORT_ACTION_MODULE_PATH,
      exportName: "commitTransportWorkbenchUiState",
      retiredMembership: "ui|P4.4|object-assign|transportWorkbenchUi",
      requiredConcreteMemberships: TRANSPORT_OWNER_WRITE_MEMBERSHIPS,
    }),
  ].sort((left, right) =>
    legacyMembershipReplacementEntryId(left).localeCompare(
      legacyMembershipReplacementEntryId(right),
    )
  ));

const SCENARIO_MANAGER_RUNTIME_STATE_BINDING_IDENTITY =
  JSON.stringify({
    kind: "module",
    name: "runtimeState",
    functionName: "",
    parameterName: "",
    parameterIndex: 0,
    parameterPath: "",
    importSource: "./state.js",
    importedName: "state",
    aliasSources: [],
    aliasOperators: [],
  });
const SCENARIO_APPLY_PIPELINE_RUNTIME_STATE_BINDING_IDENTITY =
  JSON.stringify({
    kind: "function-parameter",
    name: "",
    functionName: "createScenarioApplyPipeline",
    parameterName: "",
    parameterIndex: 0,
    parameterPath: "$/property:runtimeState",
    importSource: "",
    importedName: "",
    aliasSources: [],
    aliasOperators: [],
  });
const SCENARIO_DETAIL_RETIRED_FUNCTION_IDENTITY =
  JSON.stringify({
    kind: "function",
    ancestry: [{
      name: "ensureScenarioDetailTopologyLoaded",
      ordinal: 0,
    }],
  });
const SCENARIO_ACTIVATION_COMMIT_FUNCTION_IDENTITY =
  JSON.stringify({
    kind: "function",
    ancestry: [{
      name: "createScenarioApplyPipeline",
      ordinal: 0,
    }, {
      name: "commitScenarioActivationState",
      ordinal: 0,
    }],
  });
const SCENARIO_RUNTIME_DATA_HEALTH_RETIRED_BINDING_IDENTITY =
  JSON.stringify({
    kind: "function-parameter",
    name: "",
    functionName: "setScenarioDataHealthState",
    parameterName: "",
    parameterIndex: 0,
    parameterPath: "$",
    importSource: "",
    importedName: "",
    aliasSources: [],
    aliasOperators: [],
  });
const SCENARIO_RUNTIME_HYDRATION_HEALTH_RETIRED_BINDING_IDENTITY =
  JSON.stringify({
    kind: "function-parameter",
    name: "",
    functionName: "setScenarioHydrationHealthGateState",
    parameterName: "",
    parameterIndex: 0,
    parameterPath: "$",
    importSource: "",
    importedName: "",
    aliasSources: [],
    aliasOperators: [],
  });
const SCENARIO_DATA_HEALTH_RUNTIME_STATE_BINDING_IDENTITY =
  JSON.stringify({
    kind: "module",
    name: "runtimeState",
    functionName: "",
    parameterName: "",
    parameterIndex: 0,
    parameterPath: "",
    importSource: "./state.js",
    importedName: "state",
    aliasSources: [],
    aliasOperators: [],
  });
const SCENARIO_STARTUP_HYDRATION_STATE_BINDING_IDENTITY =
  JSON.stringify({
    kind: "function-parameter",
    name: "",
    functionName: "createScenarioStartupHydrationController",
    parameterName: "",
    parameterIndex: 0,
    parameterPath: "$/property:state",
    importSource: "",
    importedName: "",
    aliasSources: [],
    aliasOperators: [],
  });
const SCENARIO_DATA_HEALTH_REFRESH_FUNCTION_IDENTITY =
  JSON.stringify({
    kind: "function",
    ancestry: [{
      name: "refreshScenarioDataHealth",
      ordinal: 0,
    }],
  });
const SCENARIO_HYDRATION_HEALTH_ENFORCEMENT_FUNCTION_IDENTITY =
  JSON.stringify({
    kind: "function",
    ancestry: [{
      name: "createScenarioStartupHydrationController",
      ordinal: 0,
    }, {
      name: "enforceScenarioHydrationHealthGate",
      ordinal: 0,
    }],
  });
function normalizeMigrationMutationSite(site = {}) {
  return Object.freeze({
    enclosingFunctionIdentity: String(
      site.enclosingFunctionIdentity || "",
    ),
    sourceFingerprint: String(site.sourceFingerprint || ""),
    occurrenceIndex: Number(site.occurrenceIndex),
  });
}

function crossFileMigrationContractIdentityPayload(entry = {}) {
  return {
    retiredCallerPath: normalizeModulePath(entry.retiredCallerPath),
    retiredCallerBindingIdentity: String(
      entry.retiredCallerBindingIdentity || "",
    ),
    domain: String(entry.domain || ""),
    migrationPhase: String(entry.migrationPhase || ""),
    operation: String(entry.operation || ""),
    key: String(entry.key || ""),
    retiredMutationSites: (
      Array.isArray(entry.retiredMutationSites)
        ? entry.retiredMutationSites
        : []
    ).map((site) => ({
      enclosingFunctionIdentity: String(
        site.enclosingFunctionIdentity || "",
      ),
      sourceFingerprint: String(site.sourceFingerprint || ""),
      occurrenceIndex: Number(site.occurrenceIndex),
    })),
    replacementCallerPath: normalizeModulePath(
      entry.replacementCallerPath,
    ),
    replacementCallerBindingIdentity: String(
      entry.replacementCallerBindingIdentity || "",
    ),
    replacementEnclosingFunctionIdentity: String(
      entry.replacementEnclosingFunctionIdentity || "",
    ),
    actionModulePath: normalizeModulePath(entry.actionModulePath),
    actionExportName: String(entry.actionExportName || ""),
    targetArgumentIndex: Number(entry.targetArgumentIndex),
    replacementActionSourceFingerprint: String(
      entry.replacementActionSourceFingerprint || "",
    ),
  };
}

export function buildStateActionCrossFileMigrationContractIdentity(
  entry = {},
) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        crossFileMigrationContractIdentityPayload(entry),
      ),
    )
    .digest("hex");
}

function freezeCrossFileMigrationEntry(entry = {}) {
  const normalized = crossFileMigrationContractIdentityPayload(entry);
  const retiredMutationSites = Object.freeze(
    normalized.retiredMutationSites.map(
      normalizeMigrationMutationSite,
    ),
  );
  const retiredMembershipIdentity = [
    normalized.retiredCallerPath,
    normalized.retiredCallerBindingIdentity,
    normalized.domain,
    normalized.migrationPhase,
    normalized.operation,
    normalized.key,
  ].join("|");
  const frozen = {
    ...normalized,
    retiredMutationSites,
    retiredMembershipIdentity,
  };
  return Object.freeze({
    ...frozen,
    contractIdentity:
      buildStateActionCrossFileMigrationContractIdentity(frozen),
  });
}

const SCENARIO_DETAIL_MIGRATION_SITES_BY_KEY = Object.freeze({
  topologyBundleMode: Object.freeze([
    Object.freeze({
      sourceFingerprint:
        "1edfcf4cc10092c06ae4e9763c436a5b31fa3141123717bfd5113ebfc42454aa",
      occurrenceIndex: 0,
    }),
    Object.freeze({
      sourceFingerprint:
        "1edfcf4cc10092c06ae4e9763c436a5b31fa3141123717bfd5113ebfc42454aa",
      occurrenceIndex: 1,
    }),
  ]),
  detailDeferred: Object.freeze([
    ...[0, 1, 2, 3].map((occurrenceIndex) => Object.freeze({
      sourceFingerprint:
        "0b82c34a7c15b03e57d63b2013fb904db8187628bfb249fb9da9bf816e4be5ae",
      occurrenceIndex,
    })),
  ]),
  detailPromotionCompleted: Object.freeze([
    Object.freeze({
      sourceFingerprint:
        "2b29862129ac2f743c6a257512b6cfb5b2a418aedd32279a6bb23d64ccd8ada6",
      occurrenceIndex: 0,
    }),
    Object.freeze({
      sourceFingerprint:
        "2b29862129ac2f743c6a257512b6cfb5b2a418aedd32279a6bb23d64ccd8ada6",
      occurrenceIndex: 1,
    }),
  ]),
  detailPromotionInFlight: Object.freeze([
    Object.freeze({
      sourceFingerprint:
        "9989ae5aceaa64ece377c75f87c5c7e1cbd1c47f57aa8b0e78cd98ea13be1098",
      occurrenceIndex: 0,
    }),
    Object.freeze({
      sourceFingerprint:
        "9989ae5aceaa64ece377c75f87c5c7e1cbd1c47f57aa8b0e78cd98ea13be1098",
      occurrenceIndex: 1,
    }),
  ]),
  topologyDetail: Object.freeze([
    Object.freeze({
      sourceFingerprint:
        "8edd070d7210a8201b16b65ba20c261acc7c4fe661a79b5e1245731ef6c9bc39",
      occurrenceIndex: 0,
    }),
  ]),
  runtimePoliticalTopology: Object.freeze([
    Object.freeze({
      sourceFingerprint:
        "1f83bd9f1169e37079140e94347a0f2c8a6bd12ff6c78be4f0fe800933b4dedc",
      occurrenceIndex: 0,
    }),
  ]),
  detailSourceRequested: Object.freeze([
    Object.freeze({
      sourceFingerprint:
        "c5fa2c1ee7493ac4474e9243de5b7b36cea3afc76c3534f36c71325472bf26ff",
      occurrenceIndex: 0,
    }),
  ]),
});

function createScenarioDetailCrossFileMigrationEntry(
  key,
  {
    actionModulePath,
    actionExportName,
    replacementActionSourceFingerprint,
  },
) {
  return freezeCrossFileMigrationEntry({
    retiredCallerPath: "js/core/scenario_manager.js",
    retiredCallerBindingIdentity:
      SCENARIO_MANAGER_RUNTIME_STATE_BINDING_IDENTITY,
    domain: "content",
    migrationPhase: "P4.2",
    operation: "assign",
    key,
    retiredMutationSites:
      SCENARIO_DETAIL_MIGRATION_SITES_BY_KEY[key].map((site) => ({
        ...site,
        enclosingFunctionIdentity:
          SCENARIO_DETAIL_RETIRED_FUNCTION_IDENTITY,
      })),
    replacementCallerPath:
      "js/core/scenario_apply_pipeline.js",
    replacementCallerBindingIdentity:
      SCENARIO_APPLY_PIPELINE_RUNTIME_STATE_BINDING_IDENTITY,
    replacementEnclosingFunctionIdentity:
      SCENARIO_ACTIVATION_COMMIT_FUNCTION_IDENTITY,
    actionModulePath,
    actionExportName,
    targetArgumentIndex: 0,
    replacementActionSourceFingerprint,
  });
}

function createScenarioHealthCrossFileMigrationEntry({
  retiredCallerBindingIdentity,
  key,
  retiredEnclosingFunctionIdentity,
  retiredSourceFingerprint,
  replacementCallerPath,
  replacementCallerBindingIdentity,
  replacementEnclosingFunctionIdentity,
  actionExportName,
  replacementActionSourceFingerprint,
}) {
  return freezeCrossFileMigrationEntry({
    retiredCallerPath: "js/core/state/scenario_runtime_state.js",
    retiredCallerBindingIdentity,
    domain: "scenario",
    migrationPhase: "P4.2",
    operation: "assign",
    key,
    retiredMutationSites: [{
      enclosingFunctionIdentity: retiredEnclosingFunctionIdentity,
      sourceFingerprint: retiredSourceFingerprint,
      occurrenceIndex: 0,
    }],
    replacementCallerPath,
    replacementCallerBindingIdentity,
    replacementEnclosingFunctionIdentity,
    actionModulePath: SCENARIO_HEALTH_ACTION_MODULE_PATH,
    actionExportName,
    targetArgumentIndex: 0,
    replacementActionSourceFingerprint,
  });
}

function createRendererFunctionParameterBindingIdentity(functionName) {
  return JSON.stringify({
    kind: "function-parameter",
    name: "",
    functionName,
    parameterName: "",
    parameterIndex: 0,
    parameterPath: "$",
    importSource: "",
    importedName: "",
    aliasSources: [],
    aliasOperators: [],
  });
}

const MAP_RENDERER_RUNTIME_STATE_BINDING_IDENTITY =
  JSON.stringify({
    kind: "module",
    name: "runtimeState",
    functionName: "",
    parameterName: "",
    parameterIndex: 0,
    parameterPath: "",
    importSource: "./state.js",
    importedName: "state",
    aliasSources: [],
    aliasOperators: [],
  });

function createRendererFunctionIdentity(...names) {
  return JSON.stringify({
    kind: "function",
    ancestry: names.map((name) => ({ name, ordinal: 0 })),
  });
}

function createRendererRetiredMutationSites(groups = []) {
  return groups.flatMap(({
    enclosingFunctionIdentity,
    sourceFingerprints,
  }) => sourceFingerprints.map((sourceFingerprint) => ({
    enclosingFunctionIdentity,
    sourceFingerprint,
    occurrenceIndex: 0,
  }))).sort(
    (left, right) =>
      left.enclosingFunctionIdentity.localeCompare(
        right.enclosingFunctionIdentity,
      )
      || left.sourceFingerprint.localeCompare(
        right.sourceFingerprint,
      ),
  );
}

const EXACT_AFTER_SETTLE_CONTROLLER_RETIRED_MUTATION_SITES =
  Object.freeze(createRendererRetiredMutationSites([
    {
      enclosingFunctionIdentity: createRendererFunctionIdentity(
        "ensureExactAfterSettleControllerState",
        "<anonymous>",
      ),
      sourceFingerprints: [
        "ecd12a01aa31911f3c6082039d223ecf60f56f36f8aa2825fdd0c490aa06bbf0",
      ],
    },
    {
      enclosingFunctionIdentity: createRendererFunctionIdentity(
        "ensureExactAfterSettleControllerState",
      ),
      sourceFingerprints: [
        "21627ab6f02dc575201be312d541f4a277c78747d2fd6e3f3d316b2dc0f7cfb2",
      ],
    },
  ]));

const RENDER_PASS_CACHE_RETIRED_MUTATION_SITES = Object.freeze(
  createRendererRetiredMutationSites([
    {
      enclosingFunctionIdentity: createRendererFunctionIdentity(
        "ensureRenderPassCacheState",
        "<anonymous>",
      ),
      sourceFingerprints: [
        "44ca29993fc85d66a21939cb8bf753c1cc96cfaaabbbb968b2346a3d17762f27",
      ],
    },
    ...[
      [1, "cd1abaa5108a63e7c17d8fe8b4d83872acbaa549c2016e9e80a865878bf2318f"],
      [2, "476b066c5e31d502bc996aefc85073bcc6596616fc9a0daec86cb1f30205c7e1"],
      [4, "b9820c5b6fdaeb7390d44dc6ccd15e79e75d8425b421da3a2b2fece9d7112ac0"],
    ].map(([ordinal, sourceFingerprint]) => ({
      enclosingFunctionIdentity: JSON.stringify({
        kind: "function",
        ancestry: [
          { name: "ensureRenderPassCacheState", ordinal: 0 },
          { name: "<anonymous>", ordinal },
        ],
      }),
      sourceFingerprints: [sourceFingerprint],
    })),
    {
      enclosingFunctionIdentity: JSON.stringify({
        kind: "function",
        ancestry: [
          { name: "ensureRenderPassCacheState", ordinal: 0 },
          { name: "<anonymous>", ordinal: 3 },
        ],
      }),
      sourceFingerprints: [
        "008ed9c4c1e3ad46d2e9e3c64a646f0f3319185673bf36ee176bf0c491acc67d",
        "8d54559dc85a9bd6f8d8538a540a0b858cfb63820c6d9ebbb0418ae3e8805847",
      ],
    },
    {
      enclosingFunctionIdentity: createRendererFunctionIdentity(
        "ensureRenderPassCacheState",
      ),
      sourceFingerprints: [
        "03d0c938c444e28b1813a83bd8fb2571aa38827a415e0d65b61d05ff8c23a973",
        "0754f9554515f190f7d87022c4de61c23525cfb8c19a92c3cad5443732c29c75",
        "13fd4fc86b948d29ab856a1115da007ef0f24272a8fd806a7cb12998291971eb",
        "17850a44244266dd8aa99f6052dd947d0df32b335615a0b978cbf0b2ebcfd1d2",
        "1cfd233b956e559f38bd4d686707ec665a134d806f6e6772658afaf36a567857",
        "2384709e3a5df1515cf96944e9f68865c34e30d80c47274070bd710b85cb38ef",
        "29deb067b7a626962bf2da1fc258b766c8f9fce537808dcd1fcfaece3153e85f",
        "3041f1dbdb697ee99822161e55545ab2ded43f5d3fefa0db55740989ee941d38",
        "3e66913a315cfcc7851192223ed27cabf4ce9ea5723f5458440cebbd16af53c0",
        "3ece7657943e658ee04c96649c67d3ddecf1af76c7d551b570c2620d4a51490f",
        "4118b14b806a4c1b12d4ec0985843754e3c769a7053416052077eaf277a5436c",
        "4249feb0fe4467d48b62b1a180b33fcdff8901204594e8096b4b821d219e36e8",
        "47a5dd0470a1ea0fedfef4f32e97bc02f5cba3723c89fb2520a167020c6ed01d",
        "503bd4f1235cc0e7ae97776ad1f7d16c0f9960f4cfc7def896ed76cd587ab100",
        "5a3072e238e6461034f3fcd30cdf17c9a5c409932c15d45f6e0f33e1355f416c",
        "5efca238399122cb725b7ffba96976884f434f36b4e1f9ddc58ceed97acb06c1",
        "641d9d27e0736b67b93def8e9523ceec2bc9080fc9341f1e046988b54cb44d7d",
        "647f8a1580069d96f1f7b5d2c89a7ee017eaf42d7ca3a1a5e12cd1ea78e333a7",
        "7298e324ede3fd03e0013021de579b066be5971aa4b0897c1772f069703674e4",
        "757b4d2cd8dc6c0f7ffaa6d58c8ae60c4df2fb6abed5d75e12ede1022a692620",
        "7c63293c4fd51cbd218007ed62bb0f3a6cf1844beb1b5cd5ab4ee95801167570",
        "80fb2cf43b5e6f4b3cb1b5c2852922d972e9e4a8349edf6e9de99cfbd2560cde",
        "8638c1d95937421e59b28862e5aa66480b752f45586384499fea9bec1e20591f",
        "8cb39709b6884a7e1d67dd54ba9c83feb6c05fb21e028de3afb6157d5948f087",
        "921631f6e4a683e7bc55559abfe056b05d9ddbb978f8756a5eadfb424cc3bc23",
        "992866807a6f64dd5bf8f15d9ac89fc5c81b3d232e08dc9305963d6a7f795b7f",
        "9a657fc21f69683436e3ec24addc30ccf3d0dc8e6cdd31dc6bc27d250bf4e0fc",
        "9de6dbc3332dda7f3e04454b6065d4cab422956664db919ac3c6b02c676e590d",
        "a1175ae752a4d057321ea09a72243e8aa8a2f9495db3ae5725ec725ac67268b1",
        "a20490f006c7dc57b2f79e7e96ed0ba76bace2196a059873fb2ac6b99590b42f",
        "bd12a7a64539d83647b1517cd48d5588088da7e87fae0d7559c02a5cde1416e2",
        "c9b7b04f5b7c6362432a58467d9e7de65053f23f021d3b3d74e982a56b656d28",
        "cc5fd28f13610363df7159976a8e3a22e2d2359fc1ccd204dc4400bdb03adb5c",
        "d0ff886b05d696aa829a40f72e31afe7e535ca4f77a45b173c64843c11fda27b",
        "d5d26d456da0adcd2d691ad440ea9a7346bccfa6a3fec59e8cb1b93adc201371",
        "e0ab65ae9e8b34bc0644e6ac86c0a92efd3c6aa3077d0efc5a06bb7b80b745eb",
        "ed563fbfefbddd5e99382fdaccfa8326e1550372ec8390015250a36d84eb64b6",
        "f48a948c1f36dc661c135d131649ce8ac3c99d4e7c11a9f09c28daa80648b72e",
        "f53725d56dde213c9831868c87656b703386a7d379c679c9094c0beb1ac2978a",
        "f93682c9fde61d3f9d0d555bdec22c8f4e692cbbd29e5c45068c25b037084bf8",
        "fae85cb5302e188628d3dd48df7621858c79af5fbe660a90f506896c4eae716b",
        "ff8bc6ec88611ee286a028d4e5c8bf6cf2309dc43b92359d91717c8cdec70ab2",
        "ffb56eaf06215f4eb8775f64108a1ce2cf7c07479cc35481f59dd10973fa9822",
      ],
    },
  ]),
);

const MAP_RENDERER_DEFER_EXACT_RETIRED_MUTATION_SITES = Object.freeze(
  createRendererRetiredMutationSites([
    {
      enclosingFunctionIdentity: createRendererFunctionIdentity(
        "getRendererStartupTransactionOwner",
        "resetDeferredRenderFlags",
      ),
      sourceFingerprints: [
        "8be8ff5d1e5e3387ffe359256e797603d09c1eb4713f24a3af377cc1228b3e8d",
      ],
    },
    {
      enclosingFunctionIdentity: createRendererFunctionIdentity(
        "getRendererTransactionResetOwner",
        "setDeferExactAfterSettle",
      ),
      sourceFingerprints: [
        "8be8ff5d1e5e3387ffe359256e797603d09c1eb4713f24a3af377cc1228b3e8d",
      ],
    },
    {
      enclosingFunctionIdentity: createRendererFunctionIdentity(
        "getRenderPhaseLifecycleOwner",
        "setDeferExactAfterSettle",
      ),
      sourceFingerprints: [
        "8be8ff5d1e5e3387ffe359256e797603d09c1eb4713f24a3af377cc1228b3e8d",
      ],
    },
  ]),
);

const MAP_RENDERER_DPR_STAGE_RETIRED_MUTATION_SITES = Object.freeze(
  createRendererRetiredMutationSites([{
    enclosingFunctionIdentity: createRendererFunctionIdentity(
      "updateDprStage",
    ),
    sourceFingerprints: [
      "ea96a221ef127a50a1cbd2e81c11a6addf93a6e5133db8e41e704fd71931f517",
    ],
  }]),
);

const MAP_RENDERER_DPR_SWITCH_RETIRED_MUTATION_SITES = Object.freeze(
  createRendererRetiredMutationSites([{
    enclosingFunctionIdentity: createRendererFunctionIdentity(
      "updateDprStage",
    ),
    sourceFingerprints: [
      "79c955ae4348f78c75bf574ef2a4881dd8ff8ce62b45255a4561123849a363e1",
    ],
  }]),
);

const MAP_RENDERER_FIRST_VISIBLE_RETIRED_MUTATION_SITES = Object.freeze(
  createRendererRetiredMutationSites([{
    enclosingFunctionIdentity: createRendererFunctionIdentity(
      "getVisibleFrameDiagnosticsOwner",
      "setFirstVisibleFramePainted",
    ),
    sourceFingerprints: [
      "3638cdf234c11513c7a2bca4239238da3ce29a9f0369f44c9ffb2358a0c2c3d8",
    ],
  }]),
);

const MAP_RENDERER_PENDING_EXACT_POLITICAL_RETIRED_MUTATION_SITES =
  Object.freeze(createRendererRetiredMutationSites([
    {
      enclosingFunctionIdentity: createRendererFunctionIdentity(
        "getTransformedFrameCompositorOwner",
        "setPendingExactPoliticalFastFrame",
      ),
      sourceFingerprints: [
        "843031e48909bfc035daced288222631f154f017a1f7a8ff457ee2ee110911e7",
      ],
    },
    {
      enclosingFunctionIdentity: createRendererFunctionIdentity(
        "getZoomInteractionLifecycleOwner",
        "setPendingExactPoliticalFastFrame",
      ),
      sourceFingerprints: [
        "843031e48909bfc035daced288222631f154f017a1f7a8ff457ee2ee110911e7",
      ],
    },
  ]));

const MAP_RENDERER_PROJECTED_DIAGNOSTICS_RETIRED_MUTATION_SITES =
  Object.freeze(createRendererRetiredMutationSites([
    {
      enclosingFunctionIdentity: createRendererFunctionIdentity(
        "recordProjectedBoundsDiagnosticsState",
      ),
      sourceFingerprints: [
        "ceedd15522ac76aeb424c44e2deae29883b230bcdcf854e42e8ee5d6a28562ff",
      ],
    },
    {
      enclosingFunctionIdentity: createRendererFunctionIdentity(
        "resetRenderDiagnostics",
      ),
      sourceFingerprints: [
        "ceedd15522ac76aeb424c44e2deae29883b230bcdcf854e42e8ee5d6a28562ff",
      ],
    },
  ]));

function createRendererCrossBoundaryMigrationEntry({
  retiredCallerPath,
  retiredCallerBindingIdentity,
  key,
  retiredMutationSites,
  replacementCallerPath,
  replacementCallerBindingIdentity,
  replacementEnclosingFunctionIdentity,
  actionModulePath,
  actionExportName,
  replacementActionSourceFingerprint,
}) {
  return freezeCrossFileMigrationEntry({
    retiredCallerPath,
    retiredCallerBindingIdentity,
    domain: "renderer",
    migrationPhase: "P4.3",
    operation: "assign",
    key,
    retiredMutationSites,
    replacementCallerPath,
    replacementCallerBindingIdentity,
    replacementEnclosingFunctionIdentity,
    actionModulePath,
    actionExportName,
    targetArgumentIndex: 0,
    replacementActionSourceFingerprint,
  });
}

function createP44FunctionParameterBindingIdentity(
  functionName,
  { parameterPath = "$" } = {},
) {
  return JSON.stringify({
    kind: "function-parameter",
    name: "",
    functionName,
    parameterName: "",
    parameterIndex: 0,
    parameterPath,
    importSource: "",
    importedName: "",
    aliasSources: [],
    aliasOperators: [],
  });
}

function createP44FunctionIdentity(...ancestryNames) {
  return JSON.stringify({
    kind: "function",
    ancestry: ancestryNames.map((entry) => (
      typeof entry === "string"
        ? { name: entry, ordinal: 0 }
        : entry
    )),
  });
}

function createP44CrossFileMigrationEntry({
  retiredCallerPath,
  retiredCallerBindingIdentity,
  key,
  retiredMutationSites,
  replacementCallerPath,
  replacementCallerBindingIdentity,
  replacementEnclosingFunctionIdentity,
  actionModulePath,
  actionExportName,
  replacementActionSourceFingerprint,
}) {
  return freezeCrossFileMigrationEntry({
    retiredCallerPath,
    retiredCallerBindingIdentity,
    domain: "ui",
    migrationPhase: "P4.4",
    operation: "assign",
    key,
    retiredMutationSites,
    replacementCallerPath,
    replacementCallerBindingIdentity,
    replacementEnclosingFunctionIdentity,
    actionModulePath,
    actionExportName,
    targetArgumentIndex: 0,
    replacementActionSourceFingerprint,
  });
}

export const STATE_ACTION_CROSS_FILE_MIGRATION_CONTRACT =
  Object.freeze([
    createP44CrossFileMigrationEntry({
      retiredCallerPath: "js/core/special_zone_layers.js",
      retiredCallerBindingIdentity:
        createP44FunctionParameterBindingIdentity(
          "mutateRuntimeSpecialZoneLayersState",
        ),
      key: "specialZoneLayers",
      retiredMutationSites: [
        {
          enclosingFunctionIdentity: createP44FunctionIdentity(
            "mutateRuntimeSpecialZoneLayersState",
          ),
          sourceFingerprint:
            "fd5d59cac0c899e80a5991627c4cc1859c15fda0958a28b5951d709e90fff62d",
          occurrenceIndex: 0,
        },
        {
          enclosingFunctionIdentity: createP44FunctionIdentity(
            "normalizeRuntimeSpecialZoneLayersState",
          ),
          sourceFingerprint:
            "fd5d59cac0c899e80a5991627c4cc1859c15fda0958a28b5951d709e90fff62d",
          occurrenceIndex: 0,
        },
      ],
      replacementCallerPath: "js/core/special_zone_layers.js",
      replacementCallerBindingIdentity:
        createP44FunctionParameterBindingIdentity(
          "mutateRuntimeSpecialZoneLayersState",
        ),
      replacementEnclosingFunctionIdentity: createP44FunctionIdentity(
        "mutateRuntimeSpecialZoneLayersState",
      ),
      actionModulePath: SPECIAL_ZONE_ACTION_MODULE_PATH,
      actionExportName: "commitSpecialZoneLayersState",
      replacementActionSourceFingerprint:
        "84879d13d4320985ed649bfc4929c419bf6d26e5ded3278f006dfcb658086fea",
    }),
    createP44CrossFileMigrationEntry({
      retiredCallerPath: "js/core/special_zone_layers.js",
      retiredCallerBindingIdentity:
        createP44FunctionParameterBindingIdentity(
          "setSpecialZoneMembershipBrushModeState",
        ),
      key: "specialZoneMembershipBrushMode",
      retiredMutationSites: [{
        enclosingFunctionIdentity: createP44FunctionIdentity(
          "setSpecialZoneMembershipBrushModeState",
        ),
        sourceFingerprint:
          "5e5dd8b8a8bd0551d98e2873643108e5d78b1f270ef6226d12525e4e48014b2a",
        occurrenceIndex: 0,
      }],
      replacementCallerPath:
        "js/ui/toolbar/special_zones_workbench_controller.js",
      replacementCallerBindingIdentity:
        createP44FunctionParameterBindingIdentity(
          "createSpecialZonesWorkbenchController",
          { parameterPath: "$/property:runtimeState" },
        ),
      replacementEnclosingFunctionIdentity: createP44FunctionIdentity(
        "createSpecialZonesWorkbenchController",
        "renderActions",
        { name: "<anonymous>", ordinal: 1 },
        "<anonymous>",
      ),
      actionModulePath: SPECIAL_ZONE_ACTION_MODULE_PATH,
      actionExportName: "setSpecialZoneMembershipBrushModeState",
      replacementActionSourceFingerprint:
        "7189e7f4fb3f9e8ec59351b7d685080a793fc4427c8791b12bf31d0c90c39bdb",
    }),
    createP44CrossFileMigrationEntry({
      retiredCallerPath: "js/core/special_zone_layers.js",
      retiredCallerBindingIdentity:
        createP44FunctionParameterBindingIdentity(
          "setSpecialZonePresetCategoryState",
        ),
      key: "specialZonePresetCategory",
      retiredMutationSites: [{
        enclosingFunctionIdentity: createP44FunctionIdentity(
          "setSpecialZonePresetCategoryState",
        ),
        sourceFingerprint:
          "8974b9efefc036debb37c12e45838cb20cf39ee932090ec5ce8e99893dfe3470",
        occurrenceIndex: 0,
      }],
      replacementCallerPath:
        "js/ui/toolbar/special_zones_workbench_controller.js",
      replacementCallerBindingIdentity:
        createP44FunctionParameterBindingIdentity(
          "createSpecialZonesWorkbenchController",
          { parameterPath: "$/property:runtimeState" },
        ),
      replacementEnclosingFunctionIdentity: createP44FunctionIdentity(
        "createSpecialZonesWorkbenchController",
        "renderPresetList",
      ),
      actionModulePath: SPECIAL_ZONE_ACTION_MODULE_PATH,
      actionExportName: "setSpecialZonePresetCategoryState",
      replacementActionSourceFingerprint:
        "8a0095351d0567c92a99e6983e8f089d0641480ddedea853e9a07bfb42b07f16",
    }),
    createP44CrossFileMigrationEntry({
      retiredCallerPath: "js/core/state/appearance_preset_state.js",
      retiredCallerBindingIdentity:
        createP44FunctionParameterBindingIdentity(
          "applyAppearancePresetToRuntimeState",
        ),
      key: "intensityFields",
      retiredMutationSites: [{
        enclosingFunctionIdentity: createP44FunctionIdentity(
          "applyAppearancePresetToRuntimeState",
        ),
        sourceFingerprint:
          "946f6a319281398d673ee3c036de665c727bd75b529be02f2a30a8fb8ab3e279",
        occurrenceIndex: 0,
      }],
      replacementCallerPath:
        "js/core/state/actions/appearance_preset_actions.js",
      replacementCallerBindingIdentity:
        createP44FunctionParameterBindingIdentity(
          "applyAppearancePresetState",
        ),
      replacementEnclosingFunctionIdentity: createP44FunctionIdentity(
        "applyAppearancePresetState",
      ),
      actionModulePath: INTENSITY_FIELD_ACTION_MODULE_PATH,
      actionExportName: "setIntensityFieldsState",
      replacementActionSourceFingerprint:
        "535fe9d6b0c542302e1ac6634777f399de33c1643b8afddc9196d5010b0d6116",
    }),
    createP44CrossFileMigrationEntry({
      retiredCallerPath:
        "js/ui/toolbar/special_zones_workbench_controller.js",
      retiredCallerBindingIdentity:
        createP44FunctionParameterBindingIdentity(
          "createSpecialZonesWorkbenchController",
          { parameterPath: "$/property:runtimeState" },
        ),
      key: "specialZonePresetOpenCategories",
      retiredMutationSites: [{
        enclosingFunctionIdentity: createP44FunctionIdentity(
          "createSpecialZonesWorkbenchController",
          "setPresetCategoryOpen",
        ),
        sourceFingerprint:
          "2cc6e6d94aebd8e6d313ca92316f7f5a2761b6d736787934e1a55f0e7f679696",
        occurrenceIndex: 0,
      }],
      replacementCallerPath:
        "js/ui/toolbar/special_zones_workbench_controller.js",
      replacementCallerBindingIdentity:
        createP44FunctionParameterBindingIdentity(
          "createSpecialZonesWorkbenchController",
          { parameterPath: "$/property:runtimeState" },
        ),
      replacementEnclosingFunctionIdentity: createP44FunctionIdentity(
        "createSpecialZonesWorkbenchController",
        "renderPresetList",
        { name: "<anonymous>", ordinal: 2 },
        "<anonymous>",
      ),
      actionModulePath: SPECIAL_ZONE_ACTION_MODULE_PATH,
      actionExportName: "setSpecialZonePresetCategoryOpenState",
      replacementActionSourceFingerprint:
        "6e12e5ca425b30af2198b5ba4340dc7bc23281ea37669cd0badea79c4011b208",
    }),
    ...[
      "detailDeferred",
      "detailPromotionCompleted",
      "detailPromotionInFlight",
      "detailSourceRequested",
      "topologyBundleMode",
      "topologyDetail",
    ].map((key) =>
      createScenarioDetailCrossFileMigrationEntry(key, {
        actionModulePath:
          SCENARIO_READINESS_ACTION_MODULE_PATH,
        actionExportName: "commitScenarioReadinessState",
        replacementActionSourceFingerprint:
          "a18092f6cae4949214006f1acd9091cb66b8fca6a23c06f970a08e8554954412",
      })
    ),
    createScenarioDetailCrossFileMigrationEntry(
      "runtimePoliticalTopology",
      {
        actionModulePath:
          SCENARIO_ACTIVATION_ACTION_MODULE_PATH,
        actionExportName: "commitScenarioActivationState",
        replacementActionSourceFingerprint:
          "48de10ee32e9c2cb07dee776e315e5bf98c22ac658d90af9180f76712616a22a",
      },
    ),
    createScenarioHealthCrossFileMigrationEntry({
      retiredCallerBindingIdentity:
        SCENARIO_RUNTIME_DATA_HEALTH_RETIRED_BINDING_IDENTITY,
      key: "scenarioDataHealth",
      retiredEnclosingFunctionIdentity: JSON.stringify({
        kind: "function",
        ancestry: [{
          name: "setScenarioDataHealthState",
          ordinal: 0,
        }],
      }),
      retiredSourceFingerprint:
        "499c46a92c442aca4ea8ac280d759b930abe5821c3ff06dcc2c6e2f910d749b5",
      replacementCallerPath: "js/core/scenario_data_health.js",
      replacementCallerBindingIdentity:
        SCENARIO_DATA_HEALTH_RUNTIME_STATE_BINDING_IDENTITY,
      replacementEnclosingFunctionIdentity:
        SCENARIO_DATA_HEALTH_REFRESH_FUNCTION_IDENTITY,
      actionExportName: "setScenarioDataHealthState",
      replacementActionSourceFingerprint:
        "34e8ad9722db769ba6c7da4c2e84fcee70c24ef65a9d8a5ef0a96fd08f3f5373",
    }),
    createScenarioHealthCrossFileMigrationEntry({
      retiredCallerBindingIdentity:
        SCENARIO_RUNTIME_HYDRATION_HEALTH_RETIRED_BINDING_IDENTITY,
      key: "scenarioHydrationHealthGate",
      retiredEnclosingFunctionIdentity: JSON.stringify({
        kind: "function",
        ancestry: [{
          name: "setScenarioHydrationHealthGateState",
          ordinal: 0,
        }],
      }),
      retiredSourceFingerprint:
        "c84938fde26b1d2af44477315d953497d4ef55223b474dc4dc5c9b0d3ec99f6a",
      replacementCallerPath:
        "js/core/scenario/startup_hydration.js",
      replacementCallerBindingIdentity:
        SCENARIO_STARTUP_HYDRATION_STATE_BINDING_IDENTITY,
      replacementEnclosingFunctionIdentity:
        SCENARIO_HYDRATION_HEALTH_ENFORCEMENT_FUNCTION_IDENTITY,
      actionExportName: "setScenarioHydrationHealthGateState",
      replacementActionSourceFingerprint:
        "cc4831af773186e73e4d9dc6b705d379fdc5b384fe574bacef03b89ed3bfbc75",
    }),
    createRendererCrossBoundaryMigrationEntry({
      retiredCallerPath:
        "js/core/state/renderer_runtime_state.js",
      retiredCallerBindingIdentity:
        createRendererFunctionParameterBindingIdentity(
          "ensureExactAfterSettleControllerState",
        ),
      key: "exactAfterSettleController",
      retiredMutationSites:
        EXACT_AFTER_SETTLE_CONTROLLER_RETIRED_MUTATION_SITES,
      replacementCallerPath:
        "js/core/state/renderer_runtime_state.js",
      replacementCallerBindingIdentity:
        createRendererFunctionParameterBindingIdentity(
          "ensureExactAfterSettleControllerState",
        ),
      replacementEnclosingFunctionIdentity:
        createRendererFunctionIdentity(
          "ensureExactAfterSettleControllerState",
        ),
      actionModulePath:
        RENDERER_EXACT_REFRESH_ACTION_MODULE_PATH,
      actionExportName:
        "ensureExactAfterSettleControllerState",
      replacementActionSourceFingerprint:
        "fb16bc84699298a90657913ea0c1a6b9f1dc4d3e5090c04129ddd66cf9167d68",
    }),
    createRendererCrossBoundaryMigrationEntry({
      retiredCallerPath:
        "js/core/state/renderer_runtime_state.js",
      retiredCallerBindingIdentity:
        createRendererFunctionParameterBindingIdentity(
          "resetExactAfterSettleControllerState",
        ),
      key: "exactAfterSettleController",
      retiredMutationSites:
        EXACT_AFTER_SETTLE_CONTROLLER_RETIRED_MUTATION_SITES,
      replacementCallerPath:
        "js/core/state/renderer_runtime_state.js",
      replacementCallerBindingIdentity:
        createRendererFunctionParameterBindingIdentity(
          "resetExactAfterSettleControllerState",
        ),
      replacementEnclosingFunctionIdentity:
        createRendererFunctionIdentity(
          "resetExactAfterSettleControllerState",
        ),
      actionModulePath:
        RENDERER_EXACT_REFRESH_ACTION_MODULE_PATH,
      actionExportName:
        "resetExactAfterSettleControllerState",
      replacementActionSourceFingerprint:
        "1ca8726fe37dda5e19d368a379d570683a1f6aff461894f22c52e12f1bfe7523",
    }),
    createRendererCrossBoundaryMigrationEntry({
      retiredCallerPath:
        "js/core/state/renderer_runtime_state.js",
      retiredCallerBindingIdentity:
        createRendererFunctionParameterBindingIdentity(
          "ensureRenderPassCacheState",
        ),
      key: "renderPassCache",
      retiredMutationSites:
        RENDER_PASS_CACHE_RETIRED_MUTATION_SITES,
      replacementCallerPath:
        "js/core/state/renderer_runtime_state.js",
      replacementCallerBindingIdentity:
        createRendererFunctionParameterBindingIdentity(
          "ensureRenderPassCacheState",
        ),
      replacementEnclosingFunctionIdentity:
        createRendererFunctionIdentity(
          "ensureRenderPassCacheState",
        ),
      actionModulePath: RENDERER_CACHE_ACTION_MODULE_PATH,
      actionExportName: "commitRenderPassCacheState",
      replacementActionSourceFingerprint:
        "cf8361ca52fccc613ada80db4fdf20c6f95e3df60842b71b4e9f287f0b34ce7d",
    }),
    createRendererCrossBoundaryMigrationEntry({
      retiredCallerPath:
        "js/core/state/renderer_runtime_state.js",
      retiredCallerBindingIdentity:
        createRendererFunctionParameterBindingIdentity(
          "ensureSphericalFeatureDiagnosticsCache",
        ),
      key: "sphericalFeatureDiagnosticsById",
      retiredMutationSites:
        createRendererRetiredMutationSites([{
          enclosingFunctionIdentity:
            createRendererFunctionIdentity(
              "ensureSphericalFeatureDiagnosticsCache",
            ),
          sourceFingerprints: [
            "664e9f747682e1c18bcfb2b9a74be297b01f2aa1a829b1abf28430dc3fbedb45",
          ],
        }]),
      replacementCallerPath:
        "js/core/state/renderer_runtime_state.js",
      replacementCallerBindingIdentity:
        createRendererFunctionParameterBindingIdentity(
          "ensureProjectedBoundsCacheState",
        ),
      replacementEnclosingFunctionIdentity:
        createRendererFunctionIdentity(
          "ensureProjectedBoundsCacheState",
        ),
      actionModulePath: RENDERER_CACHE_ACTION_MODULE_PATH,
      actionExportName: "commitProjectedBoundsCacheState",
      replacementActionSourceFingerprint:
        "36721b91e1951ad0206875f69db5fa30cab0443caed9b96fe34c327be1f1e8b3",
    }),
    createRendererCrossBoundaryMigrationEntry({
      retiredCallerPath: "js/core/map_renderer.js",
      retiredCallerBindingIdentity:
        MAP_RENDERER_RUNTIME_STATE_BINDING_IDENTITY,
      key: "projectedBoundsById",
      retiredMutationSites:
        createRendererRetiredMutationSites([{
          enclosingFunctionIdentity:
            createRendererFunctionIdentity(
              "ensureProjectedBoundsCache",
            ),
          sourceFingerprints: [
            "91b4bf1c5f0523fba4dd4d225589c1816701d8f68414c6cb9bdbf7e79515a92c",
          ],
        }]),
      replacementCallerPath:
        "js/core/state/renderer_runtime_state.js",
      replacementCallerBindingIdentity:
        createRendererFunctionParameterBindingIdentity(
          "ensureProjectedBoundsCacheState",
        ),
      replacementEnclosingFunctionIdentity:
        createRendererFunctionIdentity(
          "ensureProjectedBoundsCacheState",
        ),
      actionModulePath: RENDERER_CACHE_ACTION_MODULE_PATH,
      actionExportName: "commitProjectedBoundsCacheState",
      replacementActionSourceFingerprint:
        "36721b91e1951ad0206875f69db5fa30cab0443caed9b96fe34c327be1f1e8b3",
    }),
    createRendererCrossBoundaryMigrationEntry({
      retiredCallerPath: "js/core/map_renderer.js",
      retiredCallerBindingIdentity:
        MAP_RENDERER_RUNTIME_STATE_BINDING_IDENTITY,
      key: "deferExactAfterSettle",
      retiredMutationSites:
        MAP_RENDERER_DEFER_EXACT_RETIRED_MUTATION_SITES,
      replacementCallerPath: "js/core/map_renderer.js",
      replacementCallerBindingIdentity:
        MAP_RENDERER_RUNTIME_STATE_BINDING_IDENTITY,
      replacementEnclosingFunctionIdentity:
        createRendererFunctionIdentity(
          "getRendererStartupTransactionOwner",
          "resetDeferredRenderFlags",
        ),
      actionModulePath:
        RENDERER_EXACT_REFRESH_ACTION_MODULE_PATH,
      actionExportName: "setDeferExactAfterSettleState",
      replacementActionSourceFingerprint:
        "7e7ef84a5382566d17cb8a9715c0a42581da7ecf5a9e5c425a17f3b595fdb425",
    }),
    ...[
      [
        "dprLastStageSwitchAt",
        MAP_RENDERER_DPR_SWITCH_RETIRED_MUTATION_SITES,
      ],
      [
        "dprStage",
        MAP_RENDERER_DPR_STAGE_RETIRED_MUTATION_SITES,
      ],
    ].map(([key, retiredMutationSites]) =>
      createRendererCrossBoundaryMigrationEntry({
        retiredCallerPath: "js/core/map_renderer.js",
        retiredCallerBindingIdentity:
          MAP_RENDERER_RUNTIME_STATE_BINDING_IDENTITY,
        key,
        retiredMutationSites,
        replacementCallerPath:
          "js/core/state/renderer_runtime_state.js",
        replacementCallerBindingIdentity:
          createRendererFunctionParameterBindingIdentity(
            "commitRendererDprStageState",
          ),
        replacementEnclosingFunctionIdentity:
          createRendererFunctionIdentity(
            "commitRendererDprStageState",
          ),
        actionModulePath: RENDERER_PHASE_ACTION_MODULE_PATH,
        actionExportName: "commitRendererDprStageState",
        replacementActionSourceFingerprint:
          "21b13184a45c45e2cde7bb66273ecffdb190ca3250cc5c0ce7fdd6ff43816f15",
      })
    ),
    createRendererCrossBoundaryMigrationEntry({
      retiredCallerPath: "js/core/map_renderer.js",
      retiredCallerBindingIdentity:
        MAP_RENDERER_RUNTIME_STATE_BINDING_IDENTITY,
      key: "firstVisibleFramePainted",
      retiredMutationSites:
        MAP_RENDERER_FIRST_VISIBLE_RETIRED_MUTATION_SITES,
      replacementCallerPath:
        "js/core/state/renderer_runtime_state.js",
      replacementCallerBindingIdentity:
        createRendererFunctionParameterBindingIdentity(
          "setFirstVisibleFramePaintedState",
        ),
      replacementEnclosingFunctionIdentity:
        createRendererFunctionIdentity(
          "setFirstVisibleFramePaintedState",
        ),
      actionModulePath:
        RENDERER_DIAGNOSTICS_ACTION_MODULE_PATH,
      actionExportName: "setFirstVisibleFramePaintedState",
      replacementActionSourceFingerprint:
        "4b37f18717c2ef312c44b44062011dc84feb3a63b103f7beffd88cd4a5ed1556",
    }),
    createRendererCrossBoundaryMigrationEntry({
      retiredCallerPath: "js/core/map_renderer.js",
      retiredCallerBindingIdentity:
        MAP_RENDERER_RUNTIME_STATE_BINDING_IDENTITY,
      key: "pendingDayNightRefresh",
      retiredMutationSites:
        createRendererRetiredMutationSites([
          {
            enclosingFunctionIdentity:
              createRendererFunctionIdentity(
                "getRenderPhaseLifecycleOwner",
                "setPendingDayNightRefresh",
              ),
            sourceFingerprints: [
              "68f881a110b597426dc8ade6193f716ef8acdcdfc189106533cb99647c46f12c",
            ],
          },
          {
            enclosingFunctionIdentity:
              createRendererFunctionIdentity(
                "requestDayNightClockRender",
              ),
            sourceFingerprints: [
              "b1edfd5d6bca64d37fe89e11a9177b2c9f206a749b09d5272cd557d5b0550221",
            ],
          },
        ]),
      replacementCallerPath: "js/core/map_renderer.js",
      replacementCallerBindingIdentity:
        MAP_RENDERER_RUNTIME_STATE_BINDING_IDENTITY,
      replacementEnclosingFunctionIdentity:
        createRendererFunctionIdentity(
          "getDayNightRuntimeOwner",
          "setPendingDayNightRefresh",
        ),
      actionModulePath: RENDERER_PHASE_ACTION_MODULE_PATH,
      actionExportName: "setPendingDayNightRefreshState",
      replacementActionSourceFingerprint:
        "44557915cacb4091ae86adc4d9571922d42603d5932c4667954451f8a1947ff4",
    }),
    freezeCrossFileMigrationEntry({
      retiredCallerPath: "js/core/map_renderer.js",
      retiredCallerBindingIdentity:
        MAP_RENDERER_RUNTIME_STATE_BINDING_IDENTITY,
      domain: "color",
      migrationPhase: "P4.4",
      operation: "assign",
      key: "activeSovereignCode",
      retiredMutationSites: [{
        enclosingFunctionIdentity:
          createRendererFunctionIdentity("handleClick"),
        sourceFingerprint:
          "69fa89ec7f66f5dbfcbab885d80a60cbecf5067edf91e743c3c2b6bfb296e81b",
        occurrenceIndex: 0,
      }],
      replacementCallerPath: "js/core/map_renderer.js",
      replacementCallerBindingIdentity:
        MAP_RENDERER_RUNTIME_STATE_BINDING_IDENTITY,
      replacementEnclosingFunctionIdentity:
        createRendererFunctionIdentity(
          "getClickSelectionTransactionOwner",
          "setClickActiveSovereignCode",
        ),
      actionModulePath: SCENARIO_PRESENTATION_ACTION_MODULE_PATH,
      actionExportName: "setClickActiveSovereignCodeState",
      targetArgumentIndex: 0,
      replacementActionSourceFingerprint:
        "2655a9f4972a0715f0bec40c32a1b3701354b05ba0cf81b41e45a9d6c4160f6d",
    }),
    freezeCrossFileMigrationEntry({
      retiredCallerPath: "js/core/map_renderer.js",
      retiredCallerBindingIdentity:
        MAP_RENDERER_RUNTIME_STATE_BINDING_IDENTITY,
      domain: "color",
      migrationPhase: "P4.4",
      operation: "assign",
      key: "selectedColor",
      retiredMutationSites: [0, 1, 2, 3].map((occurrenceIndex) => ({
        enclosingFunctionIdentity:
          createRendererFunctionIdentity("handleClick"),
        sourceFingerprint:
          "44f205f7b042beac7faa6d0be234297e11f83fddafd1ad9e1fb29daedca94437",
        occurrenceIndex,
      })),
      replacementCallerPath: "js/core/map_renderer.js",
      replacementCallerBindingIdentity:
        MAP_RENDERER_RUNTIME_STATE_BINDING_IDENTITY,
      replacementEnclosingFunctionIdentity:
        createRendererFunctionIdentity(
          "getClickSelectionTransactionOwner",
          "setClickSelectedColor",
        ),
      actionModulePath: RENDERER_INTERACTION_ACTION_MODULE_PATH,
      actionExportName: "setClickSelectedColorState",
      targetArgumentIndex: 0,
      replacementActionSourceFingerprint:
        "cd41494ba0115eb7e2361708e925e2efccf0789ffb7dcfc48f4f2d5cbff87328",
    }),
    createRendererCrossBoundaryMigrationEntry({
      retiredCallerPath: "js/core/map_renderer.js",
      retiredCallerBindingIdentity:
        MAP_RENDERER_RUNTIME_STATE_BINDING_IDENTITY,
      key: "pendingExactPoliticalFastFrame",
      retiredMutationSites:
        MAP_RENDERER_PENDING_EXACT_POLITICAL_RETIRED_MUTATION_SITES,
      replacementCallerPath: "js/core/map_renderer.js",
      replacementCallerBindingIdentity:
        MAP_RENDERER_RUNTIME_STATE_BINDING_IDENTITY,
      replacementEnclosingFunctionIdentity:
        createRendererFunctionIdentity(
          "getZoomInteractionLifecycleOwner",
          "setPendingExactPoliticalFastFrame",
        ),
      actionModulePath:
        RENDERER_EXACT_REFRESH_ACTION_MODULE_PATH,
      actionExportName:
        "setPendingExactPoliticalFastFrameState",
      replacementActionSourceFingerprint:
        "260a1ac89f08877a13c7aa58338a968fdbd0b29a683ca45784c3e5d5b7240a9e",
    }),
    createRendererCrossBoundaryMigrationEntry({
      retiredCallerPath: "js/core/map_renderer.js",
      retiredCallerBindingIdentity:
        MAP_RENDERER_RUNTIME_STATE_BINDING_IDENTITY,
      key: "projectedBoundsDiagnostics",
      retiredMutationSites:
        MAP_RENDERER_PROJECTED_DIAGNOSTICS_RETIRED_MUTATION_SITES,
      replacementCallerPath:
        "js/core/state/renderer_runtime_state.js",
      replacementCallerBindingIdentity:
        createRendererFunctionParameterBindingIdentity(
          "commitProjectedBoundsDiagnosticsState",
        ),
      replacementEnclosingFunctionIdentity:
        createRendererFunctionIdentity(
          "commitProjectedBoundsDiagnosticsState",
        ),
      actionModulePath:
        RENDERER_DIAGNOSTICS_ACTION_MODULE_PATH,
      actionExportName:
        "setProjectedBoundsDiagnosticsState",
      replacementActionSourceFingerprint:
        "232b0cecc793ce7c8dc1ba2fd403de9ab9d7b5879f130bd9d871ccd657a4fd01",
    }),
    createRendererCrossBoundaryMigrationEntry({
      retiredCallerPath: "js/core/map_renderer.js",
      retiredCallerBindingIdentity:
        MAP_RENDERER_RUNTIME_STATE_BINDING_IDENTITY,
      key: "renderPerfMetrics",
      retiredMutationSites:
        createRendererRetiredMutationSites([{
          enclosingFunctionIdentity:
            createRendererFunctionIdentity(
              "ensureRenderPerfMetrics",
            ),
          sourceFingerprints: [
            "9a7604c8ab3b78b1711f6084a93deae01daef5ca893aa376ac3df478b01f69e4",
          ],
        }]),
      replacementCallerPath: "js/core/map_renderer.js",
      replacementCallerBindingIdentity:
        MAP_RENDERER_RUNTIME_STATE_BINDING_IDENTITY,
      replacementEnclosingFunctionIdentity:
        createRendererFunctionIdentity(
          "getRenderPerfMetricsRuntimeOwner",
          "ensureRenderPerfMetricsState",
        ),
      actionModulePath:
        RENDERER_DIAGNOSTICS_ACTION_MODULE_PATH,
      actionExportName: "ensureRenderPerfMetricsState",
      replacementActionSourceFingerprint:
        "b78cb0e2c76abeb52dc862526b28953c24e2f5b877fdaa3b1fe2902da57de0c3",
    }),
    createRendererCrossBoundaryMigrationEntry({
      retiredCallerPath: "js/core/map_renderer.js",
      retiredCallerBindingIdentity:
        MAP_RENDERER_RUNTIME_STATE_BINDING_IDENTITY,
      key: "renderPerfMetricSequence",
      retiredMutationSites:
        createRendererRetiredMutationSites([{
          enclosingFunctionIdentity:
            createRendererFunctionIdentity(
              "recordRenderPerfMetric",
            ),
          sourceFingerprints: [
            "c0cc051ae64a3b19eaed969c87860b175c88c86f35a495699c8302e807b9c536",
          ],
        }]),
      replacementCallerPath: "js/core/map_renderer.js",
      replacementCallerBindingIdentity:
        MAP_RENDERER_RUNTIME_STATE_BINDING_IDENTITY,
      replacementEnclosingFunctionIdentity:
        createRendererFunctionIdentity(
          "getRenderPerfMetricsRuntimeOwner",
          "commitRenderPerfMetricState",
        ),
      actionModulePath:
        RENDERER_DIAGNOSTICS_ACTION_MODULE_PATH,
      actionExportName: "commitRenderPerfMetricState",
      replacementActionSourceFingerprint:
        "8470f9be0dd1dbd3b4ab18f62a375c02ea859a03913957e730ec322383d90c5a",
    }),
  ].sort(
    (left, right) =>
      left.retiredMembershipIdentity.localeCompare(
        right.retiredMembershipIdentity,
      ),
  ));

const CROSS_FILE_MIGRATION_ENTRY_BY_RETIRED_IDENTITY =
  new Map(
    STATE_ACTION_CROSS_FILE_MIGRATION_CONTRACT.map((entry) => [
      entry.retiredMembershipIdentity,
      entry,
    ]),
  );

export function findStateActionCrossFileMigrationContractEntry(
  retiredMembershipIdentity,
  entries = STATE_ACTION_CROSS_FILE_MIGRATION_CONTRACT,
) {
  if (entries !== STATE_ACTION_CROSS_FILE_MIGRATION_CONTRACT) {
    return (Array.isArray(entries) ? entries : []).find(
      (entry) =>
        String(entry?.retiredMembershipIdentity || "")
        === String(retiredMembershipIdentity || ""),
    ) || null;
  }
  return CROSS_FILE_MIGRATION_ENTRY_BY_RETIRED_IDENTITY.get(
    String(retiredMembershipIdentity || ""),
  ) || null;
}

export function validateStateActionCrossFileMigrationContract(
  entries = STATE_ACTION_CROSS_FILE_MIGRATION_CONTRACT,
) {
  const violations = [];
  if (!Array.isArray(entries)) {
    return [
      createViolation(
        "state-action-cross-file-migration-contract-invalid",
        {
          reason: "entries-not-array",
        },
      ),
    ];
  }
  const seenRetiredIdentities = new Set();
  for (
    const [index, entry] of
    entries.entries()
  ) {
    const normalized =
      crossFileMigrationContractIdentityPayload(entry);
    const retiredMembershipIdentity = [
      normalized.retiredCallerPath,
      normalized.retiredCallerBindingIdentity,
      normalized.domain,
      normalized.migrationPhase,
      normalized.operation,
      normalized.key,
    ].join("|");
    const actionContract =
      CONTRACT_ENTRY_BY_ID.get(
        `${normalized.actionModulePath}#${normalized.actionExportName}`,
      );
    const mutationSitesValid =
      normalized.retiredMutationSites.length > 0
      && normalized.retiredMutationSites.every((site) =>
        String(site.enclosingFunctionIdentity || "")
        && /^[0-9a-f]{64}$/i.test(
          String(site.sourceFingerprint || ""),
        )
        && Number.isInteger(site.occurrenceIndex)
        && site.occurrenceIndex >= 0
      );
    const mutationSiteIdentities =
      normalized.retiredMutationSites.map((site) =>
        [
          site.enclosingFunctionIdentity,
          site.sourceFingerprint,
          site.occurrenceIndex,
        ].join("|")
      );
    const mutationSitesUnique =
      new Set(mutationSiteIdentities).size
      === mutationSiteIdentities.length;
    const mutationSitesSorted =
      JSON.stringify(normalized.retiredMutationSites)
      === JSON.stringify(
        [...normalized.retiredMutationSites].sort(
          (left, right) =>
            left.enclosingFunctionIdentity.localeCompare(
              right.enclosingFunctionIdentity,
            )
            || left.sourceFingerprint.localeCompare(
              right.sourceFingerprint,
            )
            || left.occurrenceIndex - right.occurrenceIndex,
        ),
      );
    const retiredEnclosingFunctionIdentities = new Set(
      normalized.retiredMutationSites.map(
        ({ enclosingFunctionIdentity }) =>
          enclosingFunctionIdentity,
      ),
    );
    const replacementBoundaryDistinct = Boolean(
      normalized.replacementCallerPath
        !== normalized.retiredCallerPath
      || normalized.replacementCallerBindingIdentity
        !== normalized.retiredCallerBindingIdentity
      || !retiredEnclosingFunctionIdentities.has(
        normalized.replacementEnclosingFunctionIdentity,
      ),
    );
    const multiFunctionRetirement =
      retiredEnclosingFunctionIdentities.size > 1;
    let retiredCallerBindingIdentityValid = false;
    let replacementCallerBindingIdentityValid = false;
    try {
      retiredCallerBindingIdentityValid = Boolean(
        JSON.parse(normalized.retiredCallerBindingIdentity),
      );
    } catch {
      retiredCallerBindingIdentityValid = false;
    }
    try {
      replacementCallerBindingIdentityValid = Boolean(
        JSON.parse(normalized.replacementCallerBindingIdentity),
      );
    } catch {
      replacementCallerBindingIdentityValid = false;
    }
    const valid = Boolean(
      normalized.retiredCallerPath
      && normalized.retiredCallerBindingIdentity
      && retiredCallerBindingIdentityValid
      && normalized.domain
      && normalized.migrationPhase
      && normalized.operation
      && normalized.key
      && mutationSitesValid
      && mutationSitesUnique
      && mutationSitesSorted
      && normalized.replacementCallerPath
      && (
        replacementBoundaryDistinct
        || multiFunctionRetirement
      )
      && normalized.replacementCallerBindingIdentity
      && replacementCallerBindingIdentityValid
      && normalized.replacementEnclosingFunctionIdentity
      && normalized.actionModulePath
      && normalized.actionExportName
      && actionContract
      && normalized.targetArgumentIndex
        === actionContract.targetArgumentIndex
      && /^[0-9a-f]{64}$/i.test(
        normalized.replacementActionSourceFingerprint,
      )
      && String(entry?.retiredMembershipIdentity || "")
        === retiredMembershipIdentity
      && String(entry?.contractIdentity || "")
        === buildStateActionCrossFileMigrationContractIdentity(
          entry,
        )
    );
    if (!valid) {
      violations.push(
        createViolation(
          "state-action-cross-file-migration-entry-invalid",
          {
            index,
            retiredMembershipIdentity,
          },
        ),
      );
    }
    if (seenRetiredIdentities.has(retiredMembershipIdentity)) {
      violations.push(
        createViolation(
          "state-action-cross-file-migration-entry-duplicate",
          {
            index,
            retiredMembershipIdentity,
          },
        ),
      );
    }
    seenRetiredIdentities.add(retiredMembershipIdentity);
  }
  return violations;
}

export function findStateActionDelegationContractEntry(
  modulePath,
  exportName,
) {
  return CONTRACT_ENTRY_BY_ID.get(
    `${normalizeModulePath(modulePath)}#${String(exportName || "")}`,
  ) || null;
}

function parseStateActionMembership(value = "") {
  const normalized = normalizeStateActionMembership(value);
  const parts = normalized.split("|");
  if (parts.length !== 4) {
    return null;
  }
  const [domain, migrationPhase, operation, key] = parts;
  if (!domain || !migrationPhase || !operation || !key) {
    return null;
  }
  if (!/^P4\.[1-4]$/.test(migrationPhase)) {
    return null;
  }
  return {
    normalized,
    domain,
    migrationPhase,
    operation,
    key,
  };
}

function legacyMembershipReplacementEntryId(entry = {}) {
  return [
    normalizeModulePath(entry.modulePath),
    String(entry.exportName || ""),
    normalizeStateActionMembership(entry.retiredMembership),
  ].join("#");
}

export function validateStateActionLegacyMembershipReplacementContract(
  entries = STATE_ACTION_LEGACY_MEMBERSHIP_REPLACEMENT_CONTRACT,
) {
  if (!Array.isArray(entries)) {
    return [createViolation(
      "state-action-legacy-membership-replacement-contract-invalid",
      { reason: "entries-not-array" },
    )];
  }
  const violations = [];
  const entryIds = entries.map(legacyMembershipReplacementEntryId);
  const sortedEntryIds = [...entryIds].sort((left, right) =>
    left.localeCompare(right)
  );
  if (JSON.stringify(entryIds) !== JSON.stringify(sortedEntryIds)) {
    violations.push(createViolation(
      "state-action-legacy-membership-replacement-order-invalid",
    ));
  }
  const seenEntryIds = new Set();
  for (const [index, entry] of entries.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      violations.push(createViolation(
        "state-action-legacy-membership-replacement-entry-invalid",
        { index, reason: "entry-not-object" },
      ));
      continue;
    }
    const normalized =
      stateActionLegacyMembershipReplacementIdentityPayload(entry);
    const entryId = legacyMembershipReplacementEntryId(normalized);
    const retiredMembership = parseStateActionMembership(
      normalized.retiredMembership,
    );
    const requiredMemberships =
      normalized.requiredConcreteMemberships;
    const parsedRequiredMemberships = requiredMemberships.map(
      parseStateActionMembership,
    );
    const actionContract = CONTRACT_ENTRY_BY_ID.get(
      `${normalized.modulePath}#${normalized.exportName}`,
    );
    const requiredMembershipsSorted =
      [...requiredMemberships].sort((left, right) =>
        left.localeCompare(right)
      );
    const valid = Boolean(
      normalized.modulePath === String(entry.modulePath || "")
      && actionContract
      && retiredMembership
      && requiredMemberships.length > 0
      && JSON.stringify(requiredMemberships)
        === JSON.stringify(requiredMembershipsSorted)
      && new Set(requiredMemberships).size === requiredMemberships.length
      && parsedRequiredMemberships.every(
        (membership) =>
          membership
          && membership.key !== "*"
      )
      && requiredMemberships.some(
        (membership) => membership !== retiredMembership.normalized,
      )
      && String(entry.contractIdentity || "")
        === buildStateActionLegacyMembershipReplacementContractIdentity(
          entry,
        )
    );
    if (!valid) {
      violations.push(createViolation(
        "state-action-legacy-membership-replacement-entry-invalid",
        {
          index,
          modulePath: normalized.modulePath,
          exportName: normalized.exportName,
          retiredMembership: normalized.retiredMembership,
        },
      ));
    }
    if (seenEntryIds.has(entryId)) {
      violations.push(createViolation(
        "state-action-legacy-membership-replacement-entry-duplicate",
        { index, entryId },
      ));
    }
    seenEntryIds.add(entryId);
  }
  return violations;
}

export function expandStateActionMembershipsWithLegacyReplacements({
  modulePath = "",
  exportName = "",
  memberships = [],
  contractEntries =
    STATE_ACTION_LEGACY_MEMBERSHIP_REPLACEMENT_CONTRACT,
} = {}) {
  const effectiveMemberships = new Set(
    [...(memberships instanceof Set
      ? memberships
      : (Array.isArray(memberships) ? memberships : []))]
      .map(normalizeStateActionMembership)
      .filter(Boolean),
  );
  if (
    validateStateActionLegacyMembershipReplacementContract(
      contractEntries,
    ).length
  ) {
    return effectiveMemberships;
  }
  const normalizedModulePath = normalizeModulePath(modulePath);
  const normalizedExportName = String(exportName || "");
  const concreteMemberships = [...effectiveMemberships]
    .filter((membership) => parseStateActionMembership(membership)?.key !== "*")
    .sort((left, right) => left.localeCompare(right));
  for (const entry of contractEntries) {
    if (
      entry.modulePath !== normalizedModulePath
      || entry.exportName !== normalizedExportName
      || JSON.stringify(concreteMemberships)
        !== JSON.stringify(entry.requiredConcreteMemberships)
    ) {
      continue;
    }
    effectiveMemberships.add(entry.retiredMembership);
  }
  return effectiveMemberships;
}

export function getStateActionDelegationContractEntriesForModule(
  modulePath,
) {
  const normalizedPath = normalizeModulePath(modulePath);
  return STATE_ACTION_DELEGATION_CONTRACT.filter(
    (entry) => entry.modulePath === normalizedPath,
  );
}

function createViolation(code, details = {}) {
  return {
    code,
    ...details,
  };
}

function contractEntryId(entry = {}) {
  return [
    normalizeModulePath(entry.modulePath),
    String(entry.exportName || ""),
  ].join("#");
}

function isRegisteredReadOnlyExport(modulePath, exportName) {
  return STATE_ACTION_READ_ONLY_EXPORT_NAMES_BY_MODULE
    .get(normalizeModulePath(modulePath))
    ?.has(String(exportName || "")) === true;
}

export function findStateActionReadOnlyContractEntry(
  modulePath,
  exportName,
) {
  const normalizedPath = normalizeModulePath(modulePath);
  const normalizedExportName = String(exportName || "");
  if (
    !isRegisteredReadOnlyExport(
      normalizedPath,
      normalizedExportName,
    )
  ) {
    return null;
  }
  return Object.freeze({
    modulePath: normalizedPath,
    exportName: normalizedExportName,
    targetArgumentIndex: 0,
  });
}

function stateTargetPureReaderContractEntryId(entry = {}) {
  return [
    normalizeModulePath(entry.modulePath),
    String(entry.functionName || ""),
    Number(entry.targetParameterIndex),
    String(entry.targetParameterPath || ""),
  ].join("#");
}

export function findStateTargetPureReaderContractEntry(
  modulePath,
  functionName,
  targetParameterIndex,
  targetParameterPath,
) {
  return PURE_READER_ENTRY_BY_ID.get(
    [
      normalizeModulePath(modulePath),
      String(functionName || ""),
      Number(targetParameterIndex),
      String(targetParameterPath || ""),
    ].join("#"),
  ) || null;
}

export function getStateTargetPureReaderContractEntriesForModule(
  modulePath,
) {
  const normalizedPath = normalizeModulePath(modulePath);
  return STATE_TARGET_PURE_READER_CONTRACT.filter(
    (entry) => entry.modulePath === normalizedPath,
  );
}

export function validateStateTargetPureReaderContract(
  contractEntries = STATE_TARGET_PURE_READER_CONTRACT,
) {
  const violations = [];
  const seenEntryIds = new Set();
  for (
    const [index, entry] of
    (Array.isArray(contractEntries) ? contractEntries : []).entries()
  ) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      violations.push(
        createViolation("state-target-pure-reader-entry-invalid", { index }),
      );
      continue;
    }
    const entryId = stateTargetPureReaderContractEntryId(entry);
    if (seenEntryIds.has(entryId)) {
      violations.push(
        createViolation("state-target-pure-reader-entry-duplicate", {
          index,
          entryId,
        }),
      );
    }
    seenEntryIds.add(entryId);
    if (
      !/^js\/[^/].*\.js$/.test(normalizeModulePath(entry.modulePath))
      || !isValidExportName(entry.functionName)
      || !isValidExportName(entry.targetParameterName)
      || !Number.isInteger(entry.targetParameterIndex)
      || entry.targetParameterIndex < 0
      || !String(entry.targetParameterPath || "")
      || !/^[a-f0-9]{64}$/.test(String(entry.sourceFingerprint || ""))
    ) {
      violations.push(
        createViolation("state-target-pure-reader-entry-shape-invalid", {
          index,
          entryId,
        }),
      );
    }
    const seenEscapes = new Set();
    for (
      const [escapeIndex, escape] of
      (
        Array.isArray(entry.acceptedEscapes)
          ? entry.acceptedEscapes
          : []
      ).entries()
    ) {
      const escapeIdentity = [
        String(escape?.reason || ""),
        String(escape?.key || ""),
        String(escape?.sourceFingerprint || ""),
      ].join("|");
      if (
        String(escape?.reason || "") !== "state-alias-escape"
        || !String(escape?.key || "")
        || !/^[a-f0-9]{64}$/.test(
          String(escape?.sourceFingerprint || ""),
        )
        || !Number.isInteger(escape?.count)
        || Number(escape.count) < 1
      ) {
        violations.push(
          createViolation("state-target-pure-reader-escape-invalid", {
            index,
            escapeIndex,
            entryId,
          }),
        );
      }
      if (String(escape?.key || "") === "*") {
        violations.push(
          createViolation(
            "state-target-pure-reader-escape-wildcard-forbidden",
            {
              index,
              escapeIndex,
              entryId,
            },
          ),
        );
      }
      if (seenEscapes.has(escapeIdentity)) {
        violations.push(
          createViolation("state-target-pure-reader-escape-duplicate", {
            index,
            escapeIndex,
            entryId,
            escapeIdentity,
          }),
        );
      }
      seenEscapes.add(escapeIdentity);
    }
    const seenConservativeFindings = new Set();
    for (
      const [findingIndex, finding] of
      (
        Array.isArray(entry.conservativeFindings)
          ? entry.conservativeFindings
          : []
      ).entries()
    ) {
      const findingIdentity = [
        String(finding?.enclosingFunctionIdentity || ""),
        String(finding?.reason || ""),
        String(finding?.operation || ""),
        String(finding?.key || ""),
        String(finding?.sourceFingerprint || ""),
      ].join("|");
      if (
        !String(finding?.enclosingFunctionIdentity || "")
        || String(finding?.reason || "") !== "state-alias-escape"
        || String(finding?.operation || "") !== "unsupported"
        || !String(finding?.key || "")
        || !/^[a-f0-9]{64}$/.test(
          String(finding?.sourceFingerprint || ""),
        )
        || !Number.isInteger(finding?.count)
        || Number(finding.count) < 1
      ) {
        violations.push(
          createViolation(
            "state-target-pure-reader-conservative-finding-invalid",
            {
              index,
              findingIndex,
              entryId,
            },
          ),
        );
      }
      if (seenConservativeFindings.has(findingIdentity)) {
        violations.push(
          createViolation(
            "state-target-pure-reader-conservative-finding-duplicate",
            {
              index,
              findingIndex,
              entryId,
              findingIdentity,
            },
          ),
        );
      }
      seenConservativeFindings.add(findingIdentity);
    }
  }
  return violations;
}

function staticPropertyName(property) {
  if (!property) {
    return "";
  }
  if (!property.computed && property.key?.type === "Identifier") {
    return property.key.name;
  }
  if (
    property.key?.type === "Literal"
    && ["string", "number"].includes(typeof property.key.value)
  ) {
    return String(property.key.value);
  }
  return "";
}

function collectParameterBindingPaths(
  pattern,
  path = "$",
  results = [],
) {
  if (!pattern) {
    return results;
  }
  if (pattern.type === "Identifier") {
    results.push({
      name: pattern.name,
      path,
    });
    return results;
  }
  if (pattern.type === "AssignmentPattern") {
    return collectParameterBindingPaths(pattern.left, path, results);
  }
  if (pattern.type === "RestElement") {
    return collectParameterBindingPaths(
      pattern.argument,
      `${path}/rest`,
      results,
    );
  }
  if (pattern.type === "ObjectPattern") {
    for (const property of pattern.properties || []) {
      if (property.type === "RestElement") {
        collectParameterBindingPaths(
          property.argument,
          `${path}/rest`,
          results,
        );
        continue;
      }
      const propertyName = staticPropertyName(property);
      collectParameterBindingPaths(
        property.value,
        propertyName
          ? `${path}/property:${propertyName}`
          : `${path}/property:*`,
        results,
      );
    }
    return results;
  }
  if (pattern.type === "ArrayPattern") {
    for (
      let elementIndex = 0;
      elementIndex < (pattern.elements || []).length;
      elementIndex += 1
    ) {
      collectParameterBindingPaths(
        pattern.elements[elementIndex],
        `${path}/index:${elementIndex}`,
        results,
      );
    }
  }
  return results;
}

function findTopLevelFunctionDeclarations(ast, functionName) {
  const matches = [];
  for (const statement of ast?.body || []) {
    const declaration = statement.type === "ExportNamedDeclaration"
      ? statement.declaration
      : statement;
    if (
      declaration?.type === "FunctionDeclaration"
      && declaration.id?.name === functionName
    ) {
      matches.push(declaration);
    }
  }
  return matches;
}

export function inspectStateTargetPureReaderFunctionSource(
  source,
  entry,
) {
  const violations = validateStateTargetPureReaderContract([entry]);
  if (violations.length) {
    return {
      violations,
      functionSource: "",
      functionSourceFingerprint: "",
    };
  }
  let ast;
  try {
    ast = parseModuleSource(source);
  } catch (error) {
    return {
      violations: [
        createViolation("state-target-pure-reader-source-parse-failed", {
          modulePath: normalizeModulePath(entry.modulePath),
          functionName: String(entry.functionName || ""),
          message: String(error?.message || ""),
        }),
      ],
      functionSource: "",
      functionSourceFingerprint: "",
    };
  }
  const functions = findTopLevelFunctionDeclarations(
    ast,
    String(entry.functionName || ""),
  );
  if (functions.length !== 1) {
    return {
      violations: [
        createViolation(
          functions.length
            ? "state-target-pure-reader-function-duplicate"
            : "state-target-pure-reader-function-missing",
          {
            modulePath: normalizeModulePath(entry.modulePath),
            functionName: String(entry.functionName || ""),
            count: functions.length,
          },
        ),
      ],
      functionSource: "",
      functionSourceFingerprint: "",
    };
  }
  const [functionNode] = functions;
  const parameter = functionNode.params?.[entry.targetParameterIndex];
  const targetBindings = collectParameterBindingPaths(parameter).filter(
    ({ name, path }) =>
      name === entry.targetParameterName
      && path === entry.targetParameterPath,
  );
  if (targetBindings.length !== 1) {
    violations.push(
      createViolation("state-target-pure-reader-target-binding-missing", {
        modulePath: normalizeModulePath(entry.modulePath),
        functionName: String(entry.functionName || ""),
        targetParameterName: String(entry.targetParameterName || ""),
        targetParameterIndex: Number(entry.targetParameterIndex),
        targetParameterPath: String(entry.targetParameterPath || ""),
      }),
    );
  }
  const functionSource = String(source || "")
    .slice(functionNode.start, functionNode.end)
    .replaceAll("\r\n", "\n");
  const functionSourceFingerprint = createHash("sha256")
    .update(functionSource)
    .digest("hex");
  if (functionSourceFingerprint !== entry.sourceFingerprint) {
    violations.push(
      createViolation("state-target-pure-reader-source-drift", {
        modulePath: normalizeModulePath(entry.modulePath),
        functionName: String(entry.functionName || ""),
        expectedSourceFingerprint: String(entry.sourceFingerprint || ""),
        actualSourceFingerprint: functionSourceFingerprint,
      }),
    );
  }
  return {
    violations,
    functionSource,
    functionSourceFingerprint,
  };
}

function isValidActionModulePath(modulePath = "") {
  return /^js\/core\/state\/actions\/[^/]+\.js$/.test(
    normalizeModulePath(modulePath),
  );
}

function isValidExportName(exportName = "") {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(
    String(exportName || ""),
  );
}

function normalizeStateActionIntroducedPhase(value) {
  const phase = String(value || "").trim();
  if (!phase) {
    throw new Error("State action introduced phase is required.");
  }
  return normalizeP4StateActionPhase(phase);
}

export function validateStateActionDelegationContract(
  contractEntries = STATE_ACTION_DELEGATION_CONTRACT,
) {
  const violations = [];
  const seenEntryIds = new Set();
  for (
    const [index, entry] of
    (Array.isArray(contractEntries) ? contractEntries : []).entries()
  ) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      violations.push(
        createViolation("state-action-contract-entry-invalid", { index }),
      );
      continue;
    }
    const rawModulePath = String(entry.modulePath || "");
    const modulePath = normalizeModulePath(rawModulePath);
    const exportName = String(entry.exportName || "");
    let introducedInPhase = "";
    try {
      introducedInPhase = normalizeStateActionIntroducedPhase(
        entry.introducedInPhase,
      );
    } catch {
      violations.push(
        createViolation(
          "state-action-contract-introduced-phase-invalid",
          {
            index,
            modulePath,
            introducedInPhase: String(
              entry.introducedInPhase || "",
            ),
          },
        ),
      );
    }
    if (
      rawModulePath !== modulePath
      || !isValidActionModulePath(modulePath)
    ) {
      violations.push(
        createViolation("state-action-contract-module-path-invalid", {
          index,
          modulePath,
        }),
      );
    }
    if (!isValidExportName(exportName) || exportName === "default") {
      violations.push(
        createViolation("state-action-contract-export-name-invalid", {
          index,
          modulePath,
          exportName,
        }),
      );
    }
    if (entry.targetArgumentIndex !== 0) {
      violations.push(
        createViolation("state-action-contract-target-index-invalid", {
          index,
          modulePath,
          exportName,
          targetArgumentIndex: entry.targetArgumentIndex,
        }),
      );
    }
    if (
      entry.readOnlyArgumentIndexes !== undefined
      && !Array.isArray(entry.readOnlyArgumentIndexes)
    ) {
      violations.push(
        createViolation(
          "state-action-contract-read-only-argument-indexes-invalid",
          { index, modulePath, exportName },
        ),
      );
    } else {
      const seenReadOnlyIndexes = new Set();
      for (const readOnlyArgumentIndex of entry.readOnlyArgumentIndexes || []) {
        if (
          !Number.isInteger(readOnlyArgumentIndex)
          || readOnlyArgumentIndex < 0
          || readOnlyArgumentIndex === entry.targetArgumentIndex
          || seenReadOnlyIndexes.has(readOnlyArgumentIndex)
        ) {
          violations.push(
            createViolation(
              "state-action-contract-read-only-argument-index-invalid",
              {
                index,
                modulePath,
                exportName,
                readOnlyArgumentIndex,
              },
            ),
          );
        }
        seenReadOnlyIndexes.add(readOnlyArgumentIndex);
      }
    }
    const entryId = contractEntryId(entry);
    if (seenEntryIds.has(entryId)) {
      violations.push(
        createViolation("state-action-contract-entry-duplicate", {
          index,
          modulePath,
          exportName,
        }),
      );
    }
    seenEntryIds.add(entryId);
  }
  return violations;
}

export function validateStateActionModulePhaseAdmissions({
  modulePaths = [],
  phase,
  contractEntries = STATE_ACTION_DELEGATION_CONTRACT,
} = {}) {
  let currentPhase = "";
  try {
    currentPhase = normalizeP4StateActionPhase(phase);
  } catch {
    return [
      createViolation("state-action-module-current-phase-invalid", {
        currentPhase: String(phase || ""),
      }),
    ];
  }
  const entries = Array.isArray(contractEntries)
    ? contractEntries
    : [];
  const violations = [];
  for (
    const modulePath of
    [...new Set((Array.isArray(modulePaths) ? modulePaths : [])
      .map(normalizeModulePath))]
      .sort()
  ) {
    const introducedPhases = new Set();
    for (
      const entry of entries.filter(
        (candidate) =>
          normalizeModulePath(candidate?.modulePath) === modulePath,
      )
    ) {
      try {
        introducedPhases.add(
          normalizeStateActionIntroducedPhase(
            entry.introducedInPhase,
          ),
        );
      } catch {
        violations.push(
          createViolation(
            "state-action-module-introduced-phase-invalid",
            {
              modulePath,
              introducedInPhase: String(
                entry?.introducedInPhase || "",
              ),
              currentPhase,
            },
          ),
        );
      }
    }
    if (!introducedPhases.size) {
      violations.push(
        createViolation("state-action-module-phase-ambiguous", {
          modulePath,
          introducedInPhases: [...introducedPhases].sort(),
          currentPhase,
        }),
      );
      continue;
    }
    const introducedInPhase = [...introducedPhases].reduce(
      (latestPhase, candidatePhase) =>
        compareP4StateActionPhases(candidatePhase, latestPhase) > 0
          ? candidatePhase
          : latestPhase,
    );
    if (
      compareP4StateActionPhases(
        introducedInPhase,
        currentPhase,
      ) > 0
    ) {
      violations.push(
        createViolation(
          "state-action-module-phase-not-admitted",
          {
            modulePath,
            introducedInPhase,
            currentPhase,
          },
        ),
      );
    }
  }
  return violations;
}

function parseModuleSource(source = "") {
  return parse(String(source || ""), {
    ecmaVersion: "latest",
    sourceType: "module",
    locations: true,
    allowHashBang: true,
  });
}

function staticExportedName(node) {
  if (node?.type === "Identifier") {
    return node.name;
  }
  if (node?.type === "Literal") {
    return String(node.value || "");
  }
  return "";
}

function declarationExportedNames(declaration) {
  if (!declaration) {
    return [];
  }
  if (
    ["FunctionDeclaration", "ClassDeclaration"].includes(declaration.type)
    && declaration.id?.type === "Identifier"
  ) {
    return [declaration.id.name];
  }
  if (declaration.type !== "VariableDeclaration") {
    return [];
  }
  return (declaration.declarations || [])
    .map(({ id }) => id?.type === "Identifier" ? id.name : "")
    .filter(Boolean);
}

function collectNamedExportShapes(ast) {
  const directFunctions = new Map();
  const nonDirectExports = new Map();
  const add = (target, exportName, node, shape) => {
    if (!exportName) {
      return;
    }
    if (!target.has(exportName)) {
      target.set(exportName, []);
    }
    target.get(exportName).push({ node, shape });
  };

  for (const statement of ast?.body || []) {
    if (statement.type === "ExportAllDeclaration") {
      add(
        nonDirectExports,
        staticExportedName(statement.exported) || "*",
        statement,
        statement.exported ? "export-namespace" : "export-all",
      );
      continue;
    }
    if (statement.type === "ExportNamedDeclaration") {
      if (
        statement.declaration?.type === "FunctionDeclaration"
        && statement.declaration.id?.type === "Identifier"
      ) {
        add(
          directFunctions,
          statement.declaration.id.name,
          statement.declaration,
          "direct-function",
        );
      } else {
        for (
          const exportName of declarationExportedNames(
            statement.declaration,
          )
        ) {
          add(
            nonDirectExports,
            exportName,
            statement.declaration,
            `direct-${statement.declaration?.type || "declaration"}`,
          );
        }
      }
      for (const specifier of statement.specifiers || []) {
        add(
          nonDirectExports,
          staticExportedName(specifier.exported),
          specifier,
          statement.source ? "reexport" : "export-specifier",
        );
      }
      continue;
    }
    if (statement.type === "ExportDefaultDeclaration") {
      add(
        nonDirectExports,
        "default",
        statement.declaration,
        "default-export",
      );
    }
  }
  return { directFunctions, nonDirectExports };
}

export function validateStateActionModuleSource(
  source,
  {
    filePath = "",
    contractEntries = STATE_ACTION_DELEGATION_CONTRACT,
  } = {},
) {
  const normalizedPath = normalizeModulePath(filePath);
  const entries = (Array.isArray(contractEntries) ? contractEntries : [])
    .filter(
      (entry) =>
        normalizeModulePath(entry?.modulePath) === normalizedPath,
    );
  const violations = validateStateActionDelegationContract(entries);

  let ast;
  try {
    ast = parseModuleSource(source);
  } catch (error) {
    return [
      ...violations,
      createViolation("state-action-source-parse-failed", {
        modulePath: normalizedPath,
        message: String(error?.message || ""),
      }),
    ];
  }

  const { directFunctions, nonDirectExports } =
    collectNamedExportShapes(ast);
  const registeredReadOnlyExportCount = [
    ...directFunctions.keys(),
    ...nonDirectExports.keys(),
  ].filter((exportName) => (
    isRegisteredReadOnlyExport(normalizedPath, exportName)
  )).length;
  if (!entries.length && registeredReadOnlyExportCount === 0) {
    violations.push(
      createViolation("state-action-module-contract-missing", {
        modulePath: normalizedPath,
      }),
    );
  }
  const registeredExportNames = new Set(
    entries.map(({ exportName }) => String(exportName || "")),
  );
  for (const [exportName, functions] of directFunctions) {
    if (
      registeredExportNames.has(exportName)
      || isRegisteredReadOnlyExport(normalizedPath, exportName)
    ) {
      continue;
    }
    for (const _function of functions) {
      violations.push(
        createViolation("state-action-direct-export-unregistered", {
          modulePath: normalizedPath,
          exportName,
        }),
      );
    }
  }
  for (const [exportName, exposures] of nonDirectExports) {
    if (
      registeredExportNames.has(exportName)
      || isRegisteredReadOnlyExport(normalizedPath, exportName)
    ) {
      continue;
    }
    for (const exposure of exposures) {
      violations.push(
        createViolation("state-action-export-unregistered", {
          modulePath: normalizedPath,
          exportName,
          shape: exposure.shape,
        }),
      );
    }
  }
  for (const entry of entries) {
    const exportName = String(entry.exportName || "");
    const functions = directFunctions.get(exportName) || [];
    const indirect = nonDirectExports.get(exportName) || [];
    if (!functions.length) {
      violations.push(
        createViolation("state-action-direct-export-missing", {
          modulePath: normalizedPath,
          exportName,
        }),
      );
    }
    if (functions.length > 1) {
      violations.push(
        createViolation("state-action-direct-export-duplicate", {
          modulePath: normalizedPath,
          exportName,
          count: functions.length,
        }),
      );
    }
    for (const exposure of indirect) {
      violations.push(
        createViolation("state-action-export-not-direct-function", {
          modulePath: normalizedPath,
          exportName,
          shape: exposure.shape,
          line: Number(exposure.node?.loc?.start?.line || 1),
          column: Number(exposure.node?.loc?.start?.column || 0) + 1,
        }),
      );
    }
    if (functions.length !== 1) {
      continue;
    }
    const targetParameter =
      functions[0].node.params?.[entry.targetArgumentIndex];
    if (!targetParameter) {
      violations.push(
        createViolation("state-action-target-parameter-missing", {
          modulePath: normalizedPath,
          exportName,
          targetArgumentIndex: entry.targetArgumentIndex,
        }),
      );
    } else if (targetParameter.type !== "Identifier") {
      violations.push(
        createViolation("state-action-target-parameter-shape-invalid", {
          modulePath: normalizedPath,
          exportName,
          targetArgumentIndex: entry.targetArgumentIndex,
          parameterType: targetParameter.type,
        }),
      );
    } else if (targetParameter.name !== "target") {
      violations.push(
        createViolation("state-action-target-parameter-name-invalid", {
          modulePath: normalizedPath,
          exportName,
          targetArgumentIndex: entry.targetArgumentIndex,
          parameterName: targetParameter.name,
        }),
      );
    }
  }
  return violations;
}

function isSafeDomainActionTargetHelperAliasSite(
  binding = {},
  site = {},
) {
  return Boolean(
    binding.authority === "domain-action"
    && binding.kind === "function-parameter"
    && binding.parameterIndex === 0
    && String(binding.parameterPath || "") === "$"
    && String(binding.parameterName || "") === "target"
    && String(site.alias || "") === "target"
    && Array.isArray(site.aliasChain)
    && site.aliasChain.length >= 1
    && site.aliasChain.every((aliasName) => aliasName === "target")
    && String(site.key || "")
    && site.key !== "*"
    && /^[0-9a-f]{64}$/i.test(
      String(site.sourceFingerprint || ""),
    )
  );
}

function isAllowedDomainActionDynamicSite(entry = {}, site = {}) {
  return (entry.allowedDynamicSites || []).some(
    (allowedSite) =>
      String(site.operation || "") === String(allowedSite.operation || "")
      && String(site.key || "") === String(allowedSite.key || "")
      && String(site.pathPattern || "") === String(allowedSite.pathPattern || ""),
  );
}

function bindingDiagnosticCount(binding = {}, entry = {}) {
  return (binding.grants || []).reduce(
    (count, grant) =>
      count
      + (grant.aliasSites || []).filter(
        (site) =>
          !isSafeDomainActionTargetHelperAliasSite(binding, site),
      ).length
      + (grant.dynamicSites || []).filter(
        (site) => !isAllowedDomainActionDynamicSite(entry, site),
      ).length
      + (grant.ambiguousSites || []).length
      + (grant.unsupportedSites || []).length,
    0,
  );
}

export function validateStateActionPolicyBindings(
  policyOrWriters,
  {
    contractEntries = STATE_ACTION_DELEGATION_CONTRACT,
    modulePaths = null,
  } = {},
) {
  const writers = Array.isArray(policyOrWriters)
    ? policyOrWriters
    : (policyOrWriters?.writers || []);
  const activeModulePaths = new Set(
    (
      Array.isArray(modulePaths)
        ? modulePaths
        : (contractEntries || []).map(({ modulePath }) => modulePath)
    ).map(normalizeModulePath),
  );
  const entries = (Array.isArray(contractEntries) ? contractEntries : [])
    .filter((entry) =>
      activeModulePaths.has(normalizeModulePath(entry?.modulePath))
    );
  const entriesByModulePath = new Map();
  for (const entry of entries) {
    const modulePath = normalizeModulePath(entry.modulePath);
    if (!entriesByModulePath.has(modulePath)) {
      entriesByModulePath.set(modulePath, []);
    }
    entriesByModulePath.get(modulePath).push(entry);
  }

  const violations = [];
  for (const [modulePath, moduleEntries] of entriesByModulePath) {
    const writer = writers.find(
      ({ path: writerPath }) =>
        normalizeModulePath(writerPath) === modulePath,
    );
    if (!writer) {
      violations.push(
        createViolation("state-action-policy-writer-missing", {
          modulePath,
        }),
      );
      continue;
    }
    if (writer.authority !== "domain-action") {
      violations.push(
        createViolation("state-action-policy-writer-authority-invalid", {
          modulePath,
          authority: writer.authority,
        }),
      );
    }
    const registeredNames = new Set(
      moduleEntries.map(({ exportName }) => String(exportName)),
    );
    for (const binding of writer.bindings || []) {
      if (
        binding.kind === "function-parameter"
        && !registeredNames.has(String(binding.functionName || ""))
      ) {
        violations.push(
          createViolation("state-action-policy-binding-unregistered", {
            modulePath,
            functionName: String(binding.functionName || ""),
          }),
        );
      }
    }
    for (const entry of moduleEntries) {
      const matches = (writer.bindings || []).filter(
        (binding) =>
          binding.functionName === entry.exportName,
      );
      if (!matches.length) {
        violations.push(
          createViolation("state-action-policy-binding-missing", {
            modulePath,
            exportName: entry.exportName,
          }),
        );
        continue;
      }
      if (matches.length > 1) {
        violations.push(
          createViolation("state-action-policy-binding-duplicate", {
            modulePath,
            exportName: entry.exportName,
            count: matches.length,
          }),
        );
      }
      for (const binding of matches) {
        if (
          binding.authority !== "domain-action"
          || binding.kind !== "function-parameter"
        ) {
          violations.push(
            createViolation(
              "state-action-policy-binding-authority-invalid",
              {
                modulePath,
                exportName: entry.exportName,
                authority: binding.authority,
                kind: binding.kind,
              },
            ),
          );
        }
        if (
          binding.parameterIndex !== entry.targetArgumentIndex
          || binding.parameterIndex !== 0
          || String(binding.parameterPath || "") !== "$"
        ) {
          violations.push(
            createViolation("state-action-policy-binding-shape-invalid", {
              modulePath,
              exportName: entry.exportName,
              parameterIndex: binding.parameterIndex,
              parameterPath: binding.parameterPath,
            }),
          );
        }
        const diagnosticCount = bindingDiagnosticCount(binding, entry);
        if (diagnosticCount > 0) {
          violations.push(
            createViolation(
              "state-action-policy-binding-diagnostics-invalid",
              {
                modulePath,
                exportName: entry.exportName,
                diagnosticCount,
              },
            ),
          );
        }
      }
    }
  }
  return violations;
}
