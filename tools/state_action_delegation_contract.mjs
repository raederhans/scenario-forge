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
const PROJECT_IMPORT_ACTION_MODULE_PATH =
  "js/core/state/actions/project_import_actions.js";

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
  "commitScenarioOptionalLayerPayloadState",
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
  "ensureInspectorExpansionState",
  "markInspectorExpansionInitializedState",
  "setInspectorContinentExpandedState",
  "setHgoIdentityVariantSelectionState",
  "setBatchFillScopeState",
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
  "setScenarioHoverRegionIdsState",
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
  "setHoveredFeatureIdsState",
  "setLastMouseMoveTimeState",
  "setTooltipPendingState",
  "setTooltipRafHandleState",
  "clearClickHoveredIdState",
  "removeClickWaterRegionOverrideState",
  "setClickHoverOverlayDirtyState",
  "setClickSelectedColorState",
  "setZoomGestureStartTransformState",
  "setZoomGestureScaleDeltaState",
  "setPendingZoomTransformState",
  "setZoomTransformState",
  "setHitCanvasDirtyState",
  "setHitCanvasBuildScheduledState",
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
  "setDynamicBordersDirtyState",
  "setPendingDynamicBorderTimerState",
  "replaceCachedDetailAdmBordersState",
  "commitRenderPassCacheState",
  "commitProjectedBoundsCacheState",
  "setProjectedBoundsCacheEntryState",
  "syncProjectedBoundsCacheEntryState",
  "clearProjectedBoundsCacheEntriesState",
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
  "setAppearanceVisibilitySnapshotState",
  "patchAppearanceVisibilityState",
]);

const INTENSITY_FIELD_ACTION_EXPORT_NAMES = Object.freeze([
  "appendIntensityFieldPointState",
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
  "setUiChromeState",
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
  "mutateSpecialZoneLayersStateAction",
  "restoreSpecialZoneSnapshotState",
  "setSpecialZoneMembershipBrushModeState",
  "setSpecialZonePresetCategoryState",
  "setSpecialZonePresetCategoryOpenState",
  "ensureManualSpecialZonesState",
  "setSpecialZonesVisibilityState",
  "setSpecialZonesOverlayDirtyState",
  "activateSpecialZoneMembershipToolState",
  "exitSpecialZoneMembershipToolState",
  "registerSpecialZonesWorkbenchRuntimeHooks",
]);

const STATE_ACTION_EXPORT_GROUPS = Object.freeze([
  Object.freeze({
    modulePath: SCENARIO_ACTIVATION_ACTION_MODULE_PATH,
    exportNames: Object.freeze(["applyPaletteFeatureColorState", "applyPaletteOwnerColorState"]),
    introducedInPhase: "P4.4",
  }),
  Object.freeze({
    modulePath: SCENARIO_PRESENTATION_ACTION_MODULE_PATH,
    exportNames: Object.freeze(["selectPaletteVisualPaintModeState"]),
    introducedInPhase: "P4.4",
  }),
  Object.freeze({
    modulePath: RENDERER_CACHE_ACTION_MODULE_PATH,
    exportNames: Object.freeze(["appendPreparedCountryBorderMeshesState", "replaceCachedCoastlineMeshesState", "patchBorderMeshCacheState"]),
    introducedInPhase: "P4.4",
  }),
  Object.freeze({
    modulePath: "js/core/state/actions/palette_library_actions.js",
    exportNames: Object.freeze([
      "selectPalettePaintColorState",
      "applyPaletteFeatureColorState",
      "applyPaletteOwnerColorState",
    ]),
    introducedInPhase: "P4.4",
  }),
  Object.freeze({
    modulePath: "js/core/state/actions/content_load_actions.js",
    exportNames: Object.freeze(["finishBaseCitySupportLoad", "finishFullLocalizationLoad", "finishContextLayerLoad", "commitPhysicalContourDisplayState"]),
    introducedInPhase: "P4.4",
  }),
  Object.freeze({
    modulePath: "js/core/state/actions/renderer_transaction_diagnostics_actions.js",
    exportNames: Object.freeze(["ensureRenderTransactionDiagnosticsState", "advanceScenarioApplyEpochState"]),
    introducedInPhase: "P4.4",
  }),
  Object.freeze({
    modulePath: SCENARIO_PALETTE_ACTION_MODULE_PATH,
    exportNames: Object.freeze(["patchLegendPaletteState"]),
    introducedInPhase: "P4.4",
  }),
  Object.freeze({
    modulePath: "js/core/state/actions/legend_actions.js",
    exportNames: Object.freeze(["ensureLegendState", "patchLegendState", "setLegendLabelState"]),
    introducedInPhase: "P4.4",
  }),
  Object.freeze({
    modulePath: SCENARIO_ACTIVATION_ACTION_MODULE_PATH,
    exportNames: Object.freeze([
      "trimScenarioBundleCacheState",
      "clearScenarioBundleChunkProtectionState",
      "removeScenarioBundleChunkPayloadState",
      "removeScenarioBundleCacheEntryState",
    ]),
    introducedInPhase: "P4.4",
  }),
  ...[
    SCENARIO_PRESENTATION_ACTION_MODULE_PATH,
    UI_VISIBILITY_ACTION_MODULE_PATH,
    APPEARANCE_PRESET_ACTION_MODULE_PATH,
    SCENARIO_ACTIVATION_ACTION_MODULE_PATH,
    RENDERER_CACHE_ACTION_MODULE_PATH,
    EXPORT_WORKBENCH_ACTION_MODULE_PATH,
    INTENSITY_FIELD_ACTION_MODULE_PATH,
    SPECIAL_ZONE_ACTION_MODULE_PATH,
    STRATEGIC_OVERLAY_ACTION_MODULE_PATH,
    APPEARANCE_ACTION_MODULE_PATH,
    APPEARANCE_VISIBILITY_ACTION_MODULE_PATH,
    APPEARANCE_REFERENCE_ACTION_MODULE_PATH,
    TRANSPORT_ACTION_MODULE_PATH,
    RENDERER_INTERACTION_ACTION_MODULE_PATH,
  ].map((modulePath) => Object.freeze({
    modulePath,
    exportNames: Object.freeze(["restoreProjectImportFields"]),
    introducedInPhase: "P4.4",
  })),
  Object.freeze({
    modulePath: PROJECT_IMPORT_ACTION_MODULE_PATH,
    exportNames: Object.freeze(["applyProjectImportPatch"]),
    introducedInPhase: "P4.4",
  }),
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
  [PROJECT_IMPORT_ACTION_MODULE_PATH, new Set(["captureProjectImportState"])],
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
  importedArgumentCount = 0,
  allowBorrowedTarget = false,
  localFunctionFingerprints = {},
  acceptedEscapes = [],
  conservativeFindings = [],
  reviewedReadSiteFingerprints = [],
} = {}) {
  return Object.freeze({
    modulePath: normalizeModulePath(modulePath),
    functionName: String(functionName || ""),
    targetParameterName: String(targetParameterName || ""),
    targetParameterIndex: Number(targetParameterIndex),
    targetParameterPath: String(targetParameterPath || ""),
    sourceFingerprint: String(sourceFingerprint || ""),
    importedArgumentCount: Number(importedArgumentCount),
    allowBorrowedTarget,
    localFunctionFingerprints: Object.freeze({ ...localFunctionFingerprints }),
    reviewedReadSiteFingerprints: Object.freeze([...reviewedReadSiteFingerprints].map(String)),
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
  "modulePath": "js/core/renderer/static_border_mesh_lifecycle.js",
  "functionName": "getCoastlineDecisionSignature",
  "targetParameterName": "decision",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "importedArgumentCount": 1,
  "allowBorrowedTarget": true,
  "sourceFingerprint": "20546fa676da4944227e0120f7d3d4b53d897a64cff4c836cf7c89275f002e8e",
  "localFunctionFingerprints": {},
  "conservativeFindings": [],
  "reviewedReadSiteFingerprints": []
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/scenario/chunk_promotion_queries.js",
  "functionName": "getScenarioChunkActiveMergeIds",
  "targetParameterName": "inputs",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "importedArgumentCount": 1,
  "allowBorrowedTarget": true,
  "sourceFingerprint": "1daaa0230fb682abe8914dda80ec078b372f6b4422e77c1411521e832ae80d6d",
  "localFunctionFingerprints": {},
  // Each call maps a guarded input array to normalized strings; all later
  // filtering and Set membership operate on those newly allocated values.
  "conservativeFindings": [
    ...["370958b7d9b4b0418e27967a963bbbedb0bfc1e9235bdd35283b5fca0b1b9abc", "5bd6487301ff34cde6793aa15bb82454f11b6c6e5904876c3106701de9d65c2f", "1f535992434006ca42a13a53f7937fe4f7bf51e8538b7b08f8aa0cfefbc4df9e"].map(sourceFingerprint => ({
      enclosingFunctionIdentity: '{"kind":"function","ancestry":[{"name":"getScenarioChunkActiveMergeIds","ordinal":0}]}',
      reason: "unsupported-call-mutation", operation: "unsupported", key: "*", sourceFingerprint, count: 1,
    })),
  ],
  "reviewedReadSiteFingerprints": ["370958b7d9b4b0418e27967a963bbbedb0bfc1e9235bdd35283b5fca0b1b9abc", "5bd6487301ff34cde6793aa15bb82454f11b6c6e5904876c3106701de9d65c2f", "1f535992434006ca42a13a53f7937fe4f7bf51e8538b7b08f8aa0cfefbc4df9e"]
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/renderer/object_identity.js",
  "functionName": "getObjectIdentityToken",
  "targetParameterName": "value",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "importedArgumentCount": 2,
  "allowBorrowedTarget": true,
  "sourceFingerprint": "d0c50ce02846b31de308e5a3f5f83580381e33bde90aca8332b8f5de3108bcc3",
  "localFunctionFingerprints": {},
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"getObjectIdentityToken\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "cd42404d52ad55ccfa9aca4adc828aa5800ad9d385a0671fbcbf724118320619",
      "count": 2
    }
  ],
  "reviewedReadSiteFingerprints": []
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/scenario/chunk_promotion_queries.js",
  "functionName": "isPendingScenarioChunkPromotionCurrent",
  "targetParameterName": "inputs",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "importedArgumentCount": 1,
  "allowBorrowedTarget": true,
  "sourceFingerprint": "28d66435360fbaad576c47cce030f1f2ba0940aec65ad1210878d55bbd4ba288",
  "localFunctionFingerprints": {},
  "conservativeFindings": [],
  "reviewedReadSiteFingerprints": []
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/renderer/border_mesh_diagnostics.js",
  "functionName": "evaluateCoastlineTopologyDiagnostics",
  "targetParameterName": "inputs",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "importedArgumentCount": 1,
  "allowBorrowedTarget": true,
  "sourceFingerprint": "7e0841b1e6556213ce98a66cd416c217f0d5e5a8d8fdadfb29940844f4641092",
  "localFunctionFingerprints": {
    "countGeometryPolygonParts": "6253ca05f39fac9c317781bd7298124151c98310826185e2efdcfcb93bde6736",
    "evaluateCoastlineTopologySource": "1b4ef48525f3bca40b8bc684404b59013b4134700d96db2762263da246015436",
    "getCoastlineTopologyMetrics": "66a5a3300ea6ce469fb361390e3fc96c9108da84d92f6cba5062399ead109ec0",
    "getTopologyObjectFeatureCollection": "25cda633fb1c438c44e3b1fbf5e580f726fece5f1372d681211379d1b1239b99"
  },
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"evaluateCoastlineTopologyDiagnostics\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "32381523e63197c929b67f793a8098bed0ae3a6fa902634fdbcc6fa4567f3346",
      "count": 1
    }
  ],
  "reviewedReadSiteFingerprints": []
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/renderer/render_transform_reuse_policy_owner.js",
  "functionName": "cloneRenderZoomTransform",
  "targetParameterName": "transform",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "importedArgumentCount": 1,
  "allowBorrowedTarget": true,
  "sourceFingerprint": "83315a29a6d5ef70eb07fffbe2b9a10c3b1b06f741b3bd846f16da69e084a42e",
  "localFunctionFingerprints": {},
  "conservativeFindings": [],
  "reviewedReadSiteFingerprints": []
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/renderer/transport_facility_display_policy.js",
  "functionName": "getTransportFacilityLabelBatchIdentity",
  "targetParameterName": "state",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "importedArgumentCount": 1,
  "allowBorrowedTarget": true,
  "sourceFingerprint": "82212c650ae124ceda9740acc3365372d8190e8228b768925aaef30d93f35f3c",
  "localFunctionFingerprints": {},
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"getTransportFacilityLabelBatchIdentity\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "1963e2239e88e913f81d59bcb1b4f614fe3116c7bf999e4640baad346a0315b9",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"getTransportFacilityLabelBatchIdentity\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "activeScenarioId",
      "sourceFingerprint": "7c3f07c9b2554939aa77bc94d7c6f409b41bd01549548a31573ba74e70dc603a",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"getTransportFacilityLabelBatchIdentity\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "sceneGeneration",
      "sourceFingerprint": "f818ef843a2a713f33aa00eff13a61f361b0b63e11e13495dfa6d83bb6780c84",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"getTransportFacilityLabelBatchIdentity\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "scenarioDataGeneration",
      "sourceFingerprint": "8f1b09cd983b0fb42fd041070c997fbe3ead44b1a19ef8b37e0c10d5bfdeeea3",
      "count": 1
    }
  ],
  "reviewedReadSiteFingerprints": []
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/renderer/border_mesh_queries.js",
  "functionName": "getBorderCountryAssignmentRevision",
  "targetParameterName": "state",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "importedArgumentCount": 1,
  "allowBorrowedTarget": true,
  "sourceFingerprint": "632e2b0e5fe5a86b523ffcec8bad394c1e4c05b7b46a157652e7ff7c52839b1a",
  "localFunctionFingerprints": {},
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"getBorderCountryAssignmentRevision\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "c154041e8d097872bcee89f351d4694bb2d53d7a020aba954760dbfef84d3d07",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"getBorderCountryAssignmentRevision\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "activeScenarioId",
      "sourceFingerprint": "7c3f07c9b2554939aa77bc94d7c6f409b41bd01549548a31573ba74e70dc603a",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"getBorderCountryAssignmentRevision\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "topologyRevision",
      "sourceFingerprint": "5ac7948b3391086275c22999645ef3a38ce4a6c475436f3f3aa6525bb96ca2f9",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"getBorderCountryAssignmentRevision\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "sovereigntyRevision",
      "sourceFingerprint": "d10e5da8df7d08ca9843b5bf610dcd72af447440847ae7e67f992b77de1d615b",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"getBorderCountryAssignmentRevision\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "scenarioShellOverlayRevision",
      "sourceFingerprint": "0343e90c550cb86abb4f8c05eacf9e00ee1e54f7a58f81706a91d8ba321c6449",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"getBorderCountryAssignmentRevision\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "mapSemanticMode",
      "sourceFingerprint": "4b51e045be255cd00941075d6dfbe93c85f713e84a806e97ecd2718268eb0bb5",
      "count": 1
    }
  ],
  "reviewedReadSiteFingerprints": [
    "c154041e8d097872bcee89f351d4694bb2d53d7a020aba954760dbfef84d3d07"
  ]
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/renderer/border_mesh_queries.js",
  "functionName": "isAtlantropaCoastlineLandVisible",
  "targetParameterName": "state",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "importedArgumentCount": 1,
  "allowBorrowedTarget": true,
  "sourceFingerprint": "464ad88996954cebee184949ada793ddc7f2163919dcf6951474e05c19bc052c",
  "localFunctionFingerprints": {},
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"isAtlantropaCoastlineLandVisible\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "740c3bdb760b3576f9506f085009089882be56f987405d158407b7ebc70d37e9",
      "count": 1
    }
  ],
  "reviewedReadSiteFingerprints": ["740c3bdb760b3576f9506f085009089882be56f987405d158407b7ebc70d37e9"]
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/renderer/border_mesh_queries.js",
  "functionName": "getBorderWorkerIdentity",
  "targetParameterName": "state",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "importedArgumentCount": 1,
  "allowBorrowedTarget": true,
  "sourceFingerprint": "c2412889af3d8eb6c37fe63ed14f1cd329a723fb681ea819e803d5622a833d80",
  "localFunctionFingerprints": {},
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"getBorderWorkerIdentity\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "8643511457c4d95c7517427b6ca4355f2619fc19e01edfd99e6048e1bf12a70a",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"getBorderWorkerIdentity\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "activeScenarioId",
      "sourceFingerprint": "7c3f07c9b2554939aa77bc94d7c6f409b41bd01549548a31573ba74e70dc603a",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"getBorderWorkerIdentity\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "scenarioApplyEpoch",
      "sourceFingerprint": "f8cbe1227b1934f432e828aa48c5a2f1aea0b3407391456e5ec71506466f0cd4",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"getBorderWorkerIdentity\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "sceneGeneration",
      "sourceFingerprint": "f818ef843a2a713f33aa00eff13a61f361b0b63e11e13495dfa6d83bb6780c84",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"getBorderWorkerIdentity\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "scenarioDataGeneration",
      "sourceFingerprint": "8f1b09cd983b0fb42fd041070c997fbe3ead44b1a19ef8b37e0c10d5bfdeeea3",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"getBorderWorkerIdentity\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "topologyRevision",
      "sourceFingerprint": "5ac7948b3391086275c22999645ef3a38ce4a6c475436f3f3aa6525bb96ca2f9",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"getBorderWorkerIdentity\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "sovereigntyRevision",
      "sourceFingerprint": "d10e5da8df7d08ca9843b5bf610dcd72af447440847ae7e67f992b77de1d615b",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"getBorderWorkerIdentity\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "scenarioShellOverlayRevision",
      "sourceFingerprint": "0343e90c550cb86abb4f8c05eacf9e00ee1e54f7a58f81706a91d8ba321c6449",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"getBorderWorkerIdentity\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "mapSemanticMode",
      "sourceFingerprint": "4b51e045be255cd00941075d6dfbe93c85f713e84a806e97ecd2718268eb0bb5",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"getBorderWorkerIdentity\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "showScenarioAtlantropa",
      "sourceFingerprint": "c3f599b03f57f55ed17eeb19192cfbf35bd20a62351befbac2d8ddfa13c86b87",
      "count": 1
    }
  ],
  "reviewedReadSiteFingerprints": [
    "8643511457c4d95c7517427b6ca4355f2619fc19e01edfd99e6048e1bf12a70a"
  ]
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/renderer/border_mesh_queries.js",
  "functionName": "getDefaultBorderWorkerSources",
  "targetParameterName": "state",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "importedArgumentCount": 1,
  "allowBorrowedTarget": true,
  "sourceFingerprint": "0b955ef5cc7f60835bbb0b08ea1f45f0824e4247373d8a601c72afa238c2d066",
  "localFunctionFingerprints": {},
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"getDefaultBorderWorkerSources\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "047504b160b11ac9faa61d6834137c744160667991a9df2047148921248e4f39",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"getDefaultBorderWorkerSources\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "3ad112ec3c3300bede71306cda536c5e278f777ed70e4bbb9e4c91efaf5529ee",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"getDefaultBorderWorkerSources\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "topologyDetail",
      "sourceFingerprint": "72890bc3b5215447c442de899ff4e183237410e382a9ba58c716d8b87520d1e9",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"getDefaultBorderWorkerSources\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "f26b1bc9d00172731e23a182832b39e0c4fa8b03d2533bedca776a9ecdd01340",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"getDefaultBorderWorkerSources\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "6ea232e62cc8a7938c8a6ec39371d2c876838a6603b92d99740d501586cecda7",
      "count": 1
    }
  ],
  "reviewedReadSiteFingerprints": []
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/renderer/border_mesh_queries.js",
  "functionName": "hasCachedProvinceBorders",
  "targetParameterName": "state",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "importedArgumentCount": 2,
  "allowBorrowedTarget": true,
  "sourceFingerprint": "efbd2d657aef5a2716c20e7137af050610c0c3d975a63fb29e10efa1cba797f9",
  "localFunctionFingerprints": {},
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"hasCachedProvinceBorders\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "cachedProvinceBordersByCountry",
      "sourceFingerprint": "ac30c92b38bd8d38c699d77052e40ad908c83ae9b09a9053013886052d8e53e0",
      "count": 1
    }
  ],
  "reviewedReadSiteFingerprints": [
    "ac30c92b38bd8d38c699d77052e40ad908c83ae9b09a9053013886052d8e53e0"
  ]
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/renderer/border_mesh_queries.js",
  "functionName": "hasCachedLocalBorders",
  "targetParameterName": "state",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "importedArgumentCount": 2,
  "allowBorrowedTarget": true,
  "sourceFingerprint": "6029e26aab5d172c92f4b63e144bd3247a0454cadc0825532b01a269ef50fc8b",
  "localFunctionFingerprints": {},
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"hasCachedLocalBorders\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "cachedLocalBordersByCountry",
      "sourceFingerprint": "d4a0bd07bdff80251b2e5d16a49b7ba6be4cae9cae9f74bd5c0233703dbcc3c6",
      "count": 1
    }
  ],
  "reviewedReadSiteFingerprints": [
    "d4a0bd07bdff80251b2e5d16a49b7ba6be4cae9cae9f74bd5c0233703dbcc3c6"
  ]
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/renderer/geometry_raster_runtime_owner.js",
  "functionName": "createGeometryRasterRuntimeOwner",
  "targetParameterName": "state",
  "targetParameterIndex": 0,
  "targetParameterPath": "$/property:state",
  "sourceFingerprint": "7f01b321f177d5d2c97c138b26d4f6ad0d0360e309c96a03b6ac434170fa40b2",
  "localFunctionFingerprints": {},
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createGeometryRasterRuntimeOwner\",\"ordinal\":0},{\"name\":\"enabled\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "95cdde82a67b80d4b4f23da121859d458dc869fcdea5f01ea8c1d30127acda29",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createGeometryRasterRuntimeOwner\",\"ordinal\":0},{\"name\":\"describe\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "zoomTransform",
      "sourceFingerprint": "4cbd24c0282cefff40fce25d52c3b981ed0dfe212a8af6fba9cf4aba8f0279c5",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createGeometryRasterRuntimeOwner\",\"ordinal\":0},{\"name\":\"describe\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "zoomTransform",
      "sourceFingerprint": "003197902061c394b0f395e7363c3bcafc7590f368c44b3b99e78ddff5a19de3",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createGeometryRasterRuntimeOwner\",\"ordinal\":0},{\"name\":\"describe\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "zoomTransform",
      "sourceFingerprint": "2248d279c3e9ddd6cc090128d1c2db9e45bc941a49496626b13b7317525d8b53",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createGeometryRasterRuntimeOwner\",\"ordinal\":0},{\"name\":\"describe\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "c0228f42f38187f090c02f2625926ec33dd894010fb38b43eee780a5fc5d1fa0",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createGeometryRasterRuntimeOwner\",\"ordinal\":0},{\"name\":\"describe\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "activeScenarioId",
      "sourceFingerprint": "7c3f07c9b2554939aa77bc94d7c6f409b41bd01549548a31573ba74e70dc603a",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createGeometryRasterRuntimeOwner\",\"ordinal\":0},{\"name\":\"describe\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "sceneGeneration",
      "sourceFingerprint": "f818ef843a2a713f33aa00eff13a61f361b0b63e11e13495dfa6d83bb6780c84",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createGeometryRasterRuntimeOwner\",\"ordinal\":0},{\"name\":\"describe\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "scenarioDataGeneration",
      "sourceFingerprint": "8f1b09cd983b0fb42fd041070c997fbe3ead44b1a19ef8b37e0c10d5bfdeeea3",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createGeometryRasterRuntimeOwner\",\"ordinal\":0},{\"name\":\"describe\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "topologyRevision",
      "sourceFingerprint": "5ac7948b3391086275c22999645ef3a38ce4a6c475436f3f3aa6525bb96ca2f9",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createGeometryRasterRuntimeOwner\",\"ordinal\":0},{\"name\":\"describe\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "landData",
      "sourceFingerprint": "1ae491827e958b2ccdb4f9244f5fc7ef5f32a0c28e0504d25997c2893c00a5e8",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createGeometryRasterRuntimeOwner\",\"ordinal\":0},{\"name\":\"describe\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "c0e2d48cb6b6106a229099f2947b5f16cd804da811362eecdd5f037e8853b974",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createGeometryRasterRuntimeOwner\",\"ordinal\":0},{\"name\":\"describe\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "idToKey",
      "sourceFingerprint": "eb2fd3e7370071a887e3e02fcd99f698f42602d6409a62726bf11a725a0de618",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createGeometryRasterRuntimeOwner\",\"ordinal\":0},{\"name\":\"describe\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "mapSemanticMode",
      "sourceFingerprint": "4b51e045be255cd00941075d6dfbe93c85f713e84a806e97ecd2718268eb0bb5",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createGeometryRasterRuntimeOwner\",\"ordinal\":0},{\"name\":\"describe\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "scenarioShellOverlayRevision",
      "sourceFingerprint": "0343e90c550cb86abb4f8c05eacf9e00ee1e54f7a58f81706a91d8ba321c6449",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createGeometryRasterRuntimeOwner\",\"ordinal\":0},{\"name\":\"describe\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "sovereigntyRevision",
      "sourceFingerprint": "d10e5da8df7d08ca9843b5bf610dcd72af447440847ae7e67f992b77de1d615b",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createGeometryRasterRuntimeOwner\",\"ordinal\":0},{\"name\":\"describe\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "aa214ea38326805d95661c3ad1643cc07f88e2bae0438ac0448a66d93335ca6e",
      "count": 2
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createGeometryRasterRuntimeOwner\",\"ordinal\":0},{\"name\":\"describe\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "dpr",
      "sourceFingerprint": "a55fe7fe3cf392958f033ecbb15a4073e2c96918d91aa09f7a3e8b7d23a44425",
      "count": 2
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createGeometryRasterRuntimeOwner\",\"ordinal\":0},{\"name\":\"describe\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "7f5e9b277fa1ccc09fb19cf1b85a63b17bed65b5df5ccc5815a90a03af1ecbab",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createGeometryRasterRuntimeOwner\",\"ordinal\":0},{\"name\":\"getPoliticalEntries\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "zoomTransform",
      "sourceFingerprint": "2248d279c3e9ddd6cc090128d1c2db9e45bc941a49496626b13b7317525d8b53",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createGeometryRasterRuntimeOwner\",\"ordinal\":0},{\"name\":\"preparePolitical\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "c63b7f28ec400f4a62844dfef8ab9473b3846b46b920d52b0971386c6e361906",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createGeometryRasterRuntimeOwner\",\"ordinal\":0},{\"name\":\"preparePolitical\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "c9046f7a37ad0ea7cee73355984fa5428982f8b37c8f7bcec91f7ac71a7cd104",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createGeometryRasterRuntimeOwner\",\"ordinal\":0},{\"name\":\"preparePolitical\",\"ordinal\":0},{\"name\":\"<anonymous>\",\"ordinal\":1}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "867dc564fcf177cc3def6501e74c47ea127a02ec323594b2f6d75bdfe4fbf72b",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createGeometryRasterRuntimeOwner\",\"ordinal\":0},{\"name\":\"getHitEntries\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "idToKey",
      "sourceFingerprint": "b1e64a324cdaa5531ef88d34e9fb2f43fc2aaf91ef0c432e5259a1bad5dc7e5f",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createGeometryRasterRuntimeOwner\",\"ordinal\":0},{\"name\":\"requestHit\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "c63b7f28ec400f4a62844dfef8ab9473b3846b46b920d52b0971386c6e361906",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createGeometryRasterRuntimeOwner\",\"ordinal\":0},{\"name\":\"requestHit\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "c9046f7a37ad0ea7cee73355984fa5428982f8b37c8f7bcec91f7ac71a7cd104",
      "count": 1
    }
  ],
  "reviewedReadSiteFingerprints": [
    "c0228f42f38187f090c02f2625926ec33dd894010fb38b43eee780a5fc5d1fa0",
    "c0e2d48cb6b6106a229099f2947b5f16cd804da811362eecdd5f037e8853b974",
    "b1e64a324cdaa5531ef88d34e9fb2f43fc2aaf91ef0c432e5259a1bad5dc7e5f"
  ]
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/renderer/country_fill_palette_owner.js",
  "functionName": "createCountryFillPaletteOwner",
  "targetParameterName": "state",
  "targetParameterIndex": 0,
  "targetParameterPath": "$/property:state",
  "sourceFingerprint": "d5454207020ed553ab9f1b4c3f50b976a7200d3e09c886a9124a60b537608d78",
  "localFunctionFingerprints": {},
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createCountryFillPaletteOwner\",\"ordinal\":0},{\"name\":\"readIdentity\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "cd5de2d7e5daf0edec6bf4f32bef49592e3e7cb9d2bd1b8220c6e15f0bd5952e",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createCountryFillPaletteOwner\",\"ordinal\":0},{\"name\":\"readIdentity\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "activeScenarioId",
      "sourceFingerprint": "7c3f07c9b2554939aa77bc94d7c6f409b41bd01549548a31573ba74e70dc603a",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createCountryFillPaletteOwner\",\"ordinal\":0},{\"name\":\"readIdentity\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "sceneGeneration",
      "sourceFingerprint": "f818ef843a2a713f33aa00eff13a61f361b0b63e11e13495dfa6d83bb6780c84",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createCountryFillPaletteOwner\",\"ordinal\":0},{\"name\":\"readIdentity\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "scenarioDataGeneration",
      "sourceFingerprint": "8f1b09cd983b0fb42fd041070c997fbe3ead44b1a19ef8b37e0c10d5bfdeeea3",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createCountryFillPaletteOwner\",\"ordinal\":0},{\"name\":\"readIdentity\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "topologyRevision",
      "sourceFingerprint": "5ac7948b3391086275c22999645ef3a38ce4a6c475436f3f3aa6525bb96ca2f9",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createCountryFillPaletteOwner\",\"ordinal\":0},{\"name\":\"readIdentity\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "sovereigntyRevision",
      "sourceFingerprint": "d10e5da8df7d08ca9843b5bf610dcd72af447440847ae7e67f992b77de1d615b",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createCountryFillPaletteOwner\",\"ordinal\":0},{\"name\":\"readIdentity\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "scenarioShellOverlayRevision",
      "sourceFingerprint": "0343e90c550cb86abb4f8c05eacf9e00ee1e54f7a58f81706a91d8ba321c6449",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createCountryFillPaletteOwner\",\"ordinal\":0},{\"name\":\"readIdentity\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "mapSemanticMode",
      "sourceFingerprint": "4b51e045be255cd00941075d6dfbe93c85f713e84a806e97ecd2718268eb0bb5",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createCountryFillPaletteOwner\",\"ordinal\":0},{\"name\":\"readIdentity\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "showScenarioAtlantropa",
      "sourceFingerprint": "c3f599b03f57f55ed17eeb19192cfbf35bd20a62351befbac2d8ddfa13c86b87",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createCountryFillPaletteOwner\",\"ordinal\":0},{\"name\":\"identityMatches\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "08e24ae48b260f88d6a790c80b1192afc9d46c6884beb7be75657d9d42352c2c",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createCountryFillPaletteOwner\",\"ordinal\":0},{\"name\":\"getDominantFillColorMap\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "d85c754ba44529c90600f49d0663e923f40b2b44732ccffb8e460f67c4041114",
      "count": 2
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createCountryFillPaletteOwner\",\"ordinal\":0},{\"name\":\"notifyColorsChanged\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "d85c754ba44529c90600f49d0663e923f40b2b44732ccffb8e460f67c4041114",
      "count": 3
    }
  ],
  "reviewedReadSiteFingerprints": []
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/renderer/urban_layer_render_owner.js",
  "functionName": "createUrbanLayerRenderOwner",
  "targetParameterName": "state",
  "targetParameterIndex": 0,
  "targetParameterPath": "$/property:state",
  "sourceFingerprint": "6388b3a7cefe0a8f0c704d9ad4f61a79e8875dc3f6bad3c53e15e131a9fd9259",
  "localFunctionFingerprints": {
    "getUrbanZoomPaint": "c228b476cacc0dfed832111462af10f3a27c5aaa974aed7a1e9c1a8b5c49f7fb"
  },
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createUrbanLayerRenderOwner\",\"ordinal\":0},{\"name\":\"drawUrbanLayer\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "003e415ba97c56f192fcb8962b6a1d8fca31212905724c498d335d24417d59e5",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createUrbanLayerRenderOwner\",\"ordinal\":0},{\"name\":\"drawUrbanLayer\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "5cb59c728dace418e3294c93690d291142f895658a906a8a3016133109869b26",
      "count": 2
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createUrbanLayerRenderOwner\",\"ordinal\":0},{\"name\":\"drawUrbanLayer\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "3605f7137c829da98cf5ca7ddfdd1103da195d15cfd933390b4257f16e594aeb",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createUrbanLayerRenderOwner\",\"ordinal\":0},{\"name\":\"drawUrbanLayer\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "urbanData",
      "sourceFingerprint": "d37807ae72c92f2fbaf903c2090d3579f3f706f67012b654184be7a0b6a35ef1",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createUrbanLayerRenderOwner\",\"ordinal\":0},{\"name\":\"drawUrbanLayer\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "38a5be91af79d7e5ba9809bf383c699b6864ee50446239fe56a45e32b84638fe",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createUrbanLayerRenderOwner\",\"ordinal\":0},{\"name\":\"drawUrbanLayer\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "2ad562319767157087dda0dec6391f4479f8a04869ab0cc8d3a9c3637dae73b5",
      "count": 6
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createUrbanLayerRenderOwner\",\"ordinal\":0},{\"name\":\"drawUrbanLayer\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "09913deda591f446156d7284075806d4b03e2a1c16842ffd437fb9664667d803",
      "count": 1
    }
  ],
  "reviewedReadSiteFingerprints": []
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/state_defaults.js",
  "functionName": "normalizePhysicalStyleConfig",
  "targetParameterName": "rawConfig",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "importedArgumentCount": 1,
  "allowBorrowedTarget": true,
  "sourceFingerprint": "ec93978c54619f491a794489730af217d47f315a7f7754921660a35809bd5ec1",
  "localFunctionFingerprints": {
    "clamp": "22a84881618ba6f57419b23947227aaf6be0d57194034e009aa8be75cf232ec4",
    "createDefaultPhysicalAtlasVisibility": "1a40f77423b50a9b57c2d4c1fd7cf113fd35c61c2aaa33b326609ac35cee113d",
    "createPhysicalPresetConfig": "3bba439f92100f3c5f22b4a01b133dd294b4901c3dfdd52c882ba79a5b032fce",
    "normalizePhysicalBlendMode": "0f7d78c780e41ae9d2f4fb7f895a6bee33c86f0407f89edd0fb57b4db158bdab",
    "normalizePhysicalMode": "13e3621c619aa439d1089607a54626df3d243e9769025792698ca26b230ff01b",
    "normalizePhysicalPreset": "17816c812359011d62ca7e042f9c31b339c61f03ed7643d88f82d70d63419a1c",
    "toFiniteNumber": "6039f7255116524fbaff35f7b5865fbf349d6654e45e0677ddc1195c73064423"
  },
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"normalizePhysicalStyleConfig\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "e62abb84f4d252e6d6fc48974aafbbdea1bdc80fa44e493f8cef0efa77aa9935",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"normalizePhysicalStyleConfig\",\"ordinal\":0},{\"name\":\"<anonymous>\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "d7439bee24773bcbfa2d0a97947ee36227b10d1022b1a55847e928965bb6bfde",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"normalizePhysicalStyleConfig\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "26069fd47ad5ab29d37c9293e6e8e685004f0176a6d8d3329a9c68c83f351775",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"normalizePhysicalStyleConfig\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "75ca59f6bc72bb1266557e47eaf68e4703a65f1492198b4a0ca39a2f71647de2",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"normalizePhysicalStyleConfig\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "895cc5a9b5b0fa97214c92582abeada42451d4d9a239d117b3e186fe9397ed71",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"normalizePhysicalStyleConfig\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "50c7c902a24a9c465e272ba234ecb355265d097df742d3c1c3e0f7bf20da7588",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"normalizePhysicalStyleConfig\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "b205b3b72e3655381173849d50e838b79cd1c04af9c63cf3de34b1cdfde7aa71",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"normalizePhysicalStyleConfig\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "ea9de34e28bc8ded73d3d12384e79126e071f85aeb34288c5211a627a16ef7f7",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"normalizePhysicalStyleConfig\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "a0aad4da3231aa83017279fd38f77b05710fad1d5321ce40131db88a36e55891",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"normalizePhysicalStyleConfig\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "a21229e5d2bb941818caa8a3cdeaf947aae9558867444c7d5bd61c8d34ed47e4",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"normalizePhysicalStyleConfig\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "9c36e90d71ce1a795dcb62f90fb45685956ea275818cfe52f5066b7c9997e16d",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"normalizePhysicalStyleConfig\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "d1cbcce512c9a2b63f5d1865b8f7e7538daa08ce1398b69cf3b808c2ca82a83d",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"normalizePhysicalStyleConfig\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "90050f0316d5e6cae86f743b4cac8ef0d3c2285ec80e4e8eab25e2ec8913b3af",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"normalizePhysicalStyleConfig\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "64694f4f67772e26d96b8f31273b14f7f9f2bedfc6d237d021303d46a83424ea",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"normalizePhysicalStyleConfig\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "6424f773975ef286283cbe62a3a7a7e6d4e93715eaeedfe36c2c328ff0e49d86",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"normalizePhysicalStyleConfig\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "44242c103d78192cfca9da82d1e324b75382119ea04c688114dc511731685678",
      "count": 2
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"normalizePhysicalStyleConfig\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "58291100238a64531307478a0212fe3f62d0cf43c3208c2c7f2ca79f18ff7098",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"normalizePhysicalStyleConfig\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "7fd5e804796f2d501dd11940da12c4ce3ccde86e000e6cf54f2fb45dcd4566a7",
      "count": 1
    }
  ],
  "reviewedReadSiteFingerprints": []
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/state_defaults.js",
  "functionName": "getPhysicalContextLayerRequests",
  "targetParameterName": "rawConfig",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "importedArgumentCount": 1,
  "allowBorrowedTarget": true,
  "sourceFingerprint": "cffb8021ace9cac3c855d4ac6aac888cae348896f9150443c89cf1eadae056c4",
  "localFunctionFingerprints": {
    "clamp": "22a84881618ba6f57419b23947227aaf6be0d57194034e009aa8be75cf232ec4",
    "createDefaultPhysicalAtlasVisibility": "1a40f77423b50a9b57c2d4c1fd7cf113fd35c61c2aaa33b326609ac35cee113d",
    "createPhysicalPresetConfig": "3bba439f92100f3c5f22b4a01b133dd294b4901c3dfdd52c882ba79a5b032fce",
    "normalizePhysicalBlendMode": "0f7d78c780e41ae9d2f4fb7f895a6bee33c86f0407f89edd0fb57b4db158bdab",
    "normalizePhysicalMode": "13e3621c619aa439d1089607a54626df3d243e9769025792698ca26b230ff01b",
    "normalizePhysicalPreset": "17816c812359011d62ca7e042f9c31b339c61f03ed7643d88f82d70d63419a1c",
    "normalizePhysicalStyleConfig": "ec93978c54619f491a794489730af217d47f315a7f7754921660a35809bd5ec1",
    "toFiniteNumber": "6039f7255116524fbaff35f7b5865fbf349d6654e45e0677ddc1195c73064423"
  },
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"getPhysicalContextLayerRequests\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "c35ea2094353121654b138cf3e28961417fbbb52d91228707ab4e998a3c98771",
      "count": 1
    }
  ],
  "reviewedReadSiteFingerprints": []
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/renderer/physical_contour_lod_policy.js",
  "functionName": "resolveContourLodRequest",
  "targetParameterName": "state",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "importedArgumentCount": 1,
  "allowBorrowedTarget": true,
  "sourceFingerprint": "6c0d00dd467485039dc839321ca406e633e4b6d12ad02e73571acd925d175c17",
  "localFunctionFingerprints": {},
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"resolveContourLodRequest\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "cc3d88e8eae650f35cd52bec25bcc82673a273349f609639ca92c172de19c269",
      "count": 1
    }
  ],
  "reviewedReadSiteFingerprints": []
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/sample_export_recommendation.js",
  "functionName": "resolveSampleExportRecommendationContext",
  "targetParameterName": "runtimeState",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "importedArgumentCount": 2,
  "allowBorrowedTarget": true,
  "sourceFingerprint": "9bb082411a06615748e6158316d39bc40903310afdcd87c6294906797342d0b4",
  "localFunctionFingerprints": {
    "collectListIssues": "bdc9cb87feeb5fe6ac398f31efb56e3b0d7db5ff34207daeade7c8f18a96a2a3",
    "collectSampleExportRecommendationIssues": "93afce7a68995ca957b52d818d95a48e777843ce72020b5a01a7c33155ee2755",
    "getCommittedSampleProjectId": "4afbbb0ae296f3c1d9b1f46a25f876773bd9d372addf7f8938455fb5ec9d3944",
    "getCommittedSampleProjectTitle": "faa2879cc233481c20c2a38dc9ef4d01dd9af21cf48a10c44aa29eb8304d13d8",
    "getSampleExportRecommendationSummary": "06097a3d7fee98a7dac40388dc1cdd539cd30cd562ffcc00b72f39a975bcac9d",
    "getSampleExportTargetLabel": "e99cc22545b0dedf4cb7a1e53037d5a95a2ada26eed855e3e9db7556a664ed7f",
    "getScaleLabel": "8d9f6519049ba823555480096657152bb67e07584c985a85409550692ecbf6e5",
    "isPlainObject": "cf2888bcc65fb6ec99eedfc930d575f86ca60fbdbe20d771988fdf98c2b14f5b",
    "normalizeSampleExportRecommendation": "01cb3729a9e21076b7c3b75d38ef9099314bec5ea6092ca433a911a0190a6114",
    "normalizeSampleProjectEntry": "bf66220b500e7ba26144e2c5c77efee2ba56548030602d0d4996864684424868",
    "normalizeText": "2e1915d9ad51ae8032a7dfb0db8cb760ef8d770542bc9078ad0aaea127c6ec1a",
    "normalizeToken": "156470195260dc738c8a0b09b35601746b7e41b49bf10fd644dc77c3d3696667",
    "normalizeUniqueList": "d3d772cf37935e3e00555077517852b5d3d4df855d9a45ce946831dd7cb41aed",
    "resolveSampleStateRecommendation": "92730e6a0df6a809a7ae95b8cbfd85308539c2f24ea318e149364d7a4b44b86b"
  },
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"resolveSampleExportRecommendationContext\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "sampleProjectDeeplink",
      "sourceFingerprint": "f15e663dd80038db3b78cdb4f950128ee3a3a5998ef5b37eb084bcebd2a7926b",
      "count": 3
    }
  ],
  "reviewedReadSiteFingerprints": []
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/ui/toolbar/sample_project_banner_controller.js",
  "functionName": "resolveSampleProjectGuideContext",
  "targetParameterName": "runtimeState",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "importedArgumentCount": 2,
  "allowBorrowedTarget": true,
  "sourceFingerprint": "8152219c3f2bed1e8d89e287490abe97e18e33bb0f5d8dc029d9ce9fe62ed1c6",
  "localFunctionFingerprints": {
    "createStarterSampleProjectGuideContext": "f0c501f03d3f8ae9994c8a55ff94b3559732d5ee09844b15689eb4a5c7cde067",
    "localize": "d2b27b3f2bf673fb323c2fa1fd7d1d3fba017a40e058fff25932850f4650c16c",
    "normalizeSampleProjectEntries": "89cb89d6b331730e285f7b165b397fe73084854cc19a621b0b1f21dc79f9692c",
    "normalizeText": "2e1915d9ad51ae8032a7dfb0db8cb760ef8d770542bc9078ad0aaea127c6ec1a",
    "resolveCommittedSampleId": "4e3681fc3f5bb966b264fa5c3a6ad80ff44f9c098fe11b1397fe2f172c1c99de",
    "resolveErrorMessage": "94ab0db5184fbcaf728d458924363d25ef6a856a19e69d128ae01bdc10bcfa9f",
    "resolveOriginalDownloadUrl": "813d1102df46bbd6b64a5c7638a3a3432ea3c37c48a55d459755890efbb7ae29"
  },
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"resolveSampleProjectGuideContext\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "sampleProjectDeeplink",
      "sourceFingerprint": "8aa7bece7359f33be953e16f3df9c427b6d06ec014fc62b24c2bb043aebd3e0d",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"resolveSampleProjectGuideContext\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "sampleProjectDeeplink",
      "sourceFingerprint": "a6c48e0403c0aa64e65a49778f88ed4cab00eadda1ba8648056cc64d6870c62a",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"resolveSampleProjectGuideContext\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "sampleProjectDeeplink",
      "sourceFingerprint": "f15e663dd80038db3b78cdb4f950128ee3a3a5998ef5b37eb084bcebd2a7926b",
      "count": 3
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"resolveSampleProjectGuideContext\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "sampleProjectDeeplink",
      "sourceFingerprint": "d9fe06a233341626360c0a4ec7d7aec9a7caf5de7f6bd2fc7d43c879ded040a1",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"resolveSampleProjectGuideContext\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "2e51c4d469637774e394d4d8cf5c379bebc66669a88c5e54a716cd9277c294c7",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"resolveSampleProjectGuideContext\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "sampleProjectDeeplink",
      "sourceFingerprint": "557449fc6a63a5438061a6cc87a39f5fcba90594c73ed01e74d264cf4a9dcdc0",
      "count": 2
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"resolveSampleProjectGuideContext\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "sampleProjectDeeplink",
      "sourceFingerprint": "5887e543b689a30f2f94ec0bc8479877c3e28f936c2e70232fef2f4613fd108b",
      "count": 2
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"resolveSampleProjectGuideContext\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "sampleProjectDeeplink",
      "sourceFingerprint": "cfdc776f3a61fbd0fdf884d076051f5261c40f9ce11eb3f087017b6b42bbb547",
      "count": 2
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"resolveSampleProjectGuideContext\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "sampleProjectDeeplink",
      "sourceFingerprint": "85580c0f74b47d539ca0c3c86bb7a1f16cf7672646bf93b24d0d91efbf00927c",
      "count": 3
    }
  ],
  "reviewedReadSiteFingerprints": []
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/ui/toolbar/sample_project_banner_controller.js",
  "functionName": "createSampleProjectBannerController",
  "targetParameterName": "runtimeState",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "importedArgumentCount": 2,
  "allowBorrowedTarget": true,
  "sourceFingerprint": "473bfddfe923ba630022d6bfea378b7aeff9b2c734b5363d9844ee61e3ee88a8",
  "localFunctionFingerprints": {
    "createDismissKey": "3370187f424f78ab2fe7c9b6d412e01e4fb89caec4dca5a7f359333879941b32",
    "localize": "d2b27b3f2bf673fb323c2fa1fd7d1d3fba017a40e058fff25932850f4650c16c",
    "normalizeText": "2e1915d9ad51ae8032a7dfb0db8cb760ef8d770542bc9078ad0aaea127c6ec1a",
    "resolveErrorMessage": "94ab0db5184fbcaf728d458924363d25ef6a856a19e69d128ae01bdc10bcfa9f",
    "resolveOriginalDownloadUrl": "813d1102df46bbd6b64a5c7638a3a3432ea3c37c48a55d459755890efbb7ae29",
    "resolveSampleProjectBannerView": "2cf0dde96c475677958c85ea7357240cfbb6da6b1d2a30b9dc2ae99cfa727527",
    "setActionHidden": "a6c62cdc36487662bc38504cdf08a73188657ec76745eda12c808ca7df52085e",
    "setElementHidden": "30fc6e216e18d2f98aec523d34c67051564ef2c3aea6b22b5ddd83a3eb977f59"
  },
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createSampleProjectBannerController\",\"ordinal\":0},{\"name\":\"render\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "sampleProjectDeeplink",
      "sourceFingerprint": "17f522213930a65c71f5d67a6e80610943eb89fe72f4e00e8f413b8b0a9dbc44",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createSampleProjectBannerController\",\"ordinal\":0},{\"name\":\"bindEvents\",\"ordinal\":0},{\"name\":\"<anonymous>\",\"ordinal\":1}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "sampleProjectDeeplink",
      "sourceFingerprint": "17f522213930a65c71f5d67a6e80610943eb89fe72f4e00e8f413b8b0a9dbc44",
      "count": 1
    }
  ],
  "reviewedReadSiteFingerprints": []
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/ui/toolbar/sample_project_banner_controller.js",
  "functionName": "createSampleProjectGuideCardController",
  "targetParameterName": "runtimeState",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "importedArgumentCount": 2,
  "allowBorrowedTarget": true,
  "sourceFingerprint": "40c5ecd5f66fc125434ce9415921602d7e5a936a4884e6bba1cca37ba9eaa778",
  "localFunctionFingerprints": {
    "createStarterSampleProjectGuideContext": "f0c501f03d3f8ae9994c8a55ff94b3559732d5ee09844b15689eb4a5c7cde067",
    "localize": "d2b27b3f2bf673fb323c2fa1fd7d1d3fba017a40e058fff25932850f4650c16c",
    "normalizeSampleProjectEntries": "89cb89d6b331730e285f7b165b397fe73084854cc19a621b0b1f21dc79f9692c",
    "normalizeText": "2e1915d9ad51ae8032a7dfb0db8cb760ef8d770542bc9078ad0aaea127c6ec1a",
    "resolveCommittedSampleId": "4e3681fc3f5bb966b264fa5c3a6ad80ff44f9c098fe11b1397fe2f172c1c99de",
    "resolveErrorMessage": "94ab0db5184fbcaf728d458924363d25ef6a856a19e69d128ae01bdc10bcfa9f",
    "resolveOriginalDownloadUrl": "813d1102df46bbd6b64a5c7638a3a3432ea3c37c48a55d459755890efbb7ae29",
    "resolveSampleProjectGuideContext": "8152219c3f2bed1e8d89e287490abe97e18e33bb0f5d8dc029d9ce9fe62ed1c6",
    "setActionHidden": "a6c62cdc36487662bc38504cdf08a73188657ec76745eda12c808ca7df52085e",
    "setElementHidden": "30fc6e216e18d2f98aec523d34c67051564ef2c3aea6b22b5ddd83a3eb977f59"
  },
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createSampleProjectGuideCardController\",\"ordinal\":0},{\"name\":\"renderSampleChoices\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "312152ea23e8c305213eeef543a6537c1af7a7750e047edeb24ecaacc836a1c7",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createSampleProjectGuideCardController\",\"ordinal\":0},{\"name\":\"renderSampleChoices\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "11c47534c1d322ba1904b2f566a7ce9ca256ad7dda35cdba9ebe0139e6d6a2c5",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createSampleProjectGuideCardController\",\"ordinal\":0},{\"name\":\"render\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "2e51c4d469637774e394d4d8cf5c379bebc66669a88c5e54a716cd9277c294c7",
      "count": 1
    }
  ],
  "reviewedReadSiteFingerprints": []
}),

  freezeStateTargetPureReaderEntry({
    modulePath: "js/core/palette_library_queries.js",
    functionName: "resolvePaletteLibraryApplyTarget",
    reviewedReadSiteFingerprints: [
      "44d10f7bf5779044bf2aa9691cb015f14af1551f5df17b09d393890404d668e1",
      "52a7f9d5ba55d506b477123b44a1dbad68f8496518035e6add6597dbd6717b2f"
    ],
    conservativeFindings: [
      {
        "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"resolvePaletteLibraryApplyTarget\",\"ordinal\":0}]}",
        "reason": "unsupported-call-mutation",
        "operation": "unsupported",
        "key": "landIndex",
        "sourceFingerprint": "44d10f7bf5779044bf2aa9691cb015f14af1551f5df17b09d393890404d668e1",
        "count": 1
      },
      {
        "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"resolvePaletteLibraryApplyTarget\",\"ordinal\":0}]}",
        "reason": "unsupported-call-mutation",
        "operation": "unsupported",
        "key": "landIndex",
        "sourceFingerprint": "52a7f9d5ba55d506b477123b44a1dbad68f8496518035e6add6597dbd6717b2f",
        "count": 1
      },
      {
        "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"resolvePaletteLibraryApplyTarget\",\"ordinal\":0}]}",
        "reason": "state-alias-escape",
        "operation": "unsupported",
        "key": "selectedInspectorCountryCode",
        "sourceFingerprint": "6ed811ca402195e0741f5a12679dcb843c8c3792df32b9c8898ad9bb20084e14",
        "count": 1
      }
    ],
    targetParameterName: "inputs",
    importedArgumentCount: 1,
    allowBorrowedTarget: true,
    sourceFingerprint: "583a013d04428233674fd42f92996a2a66d32a7a7ec2cac302fb0d989f215353",
    localFunctionFingerprints: {
      normalizeOwnerCode: "280ec1d37c97a49faf9323e8b09a152aa8d9d010f79c6c6954f562f26ecc10b6",
    },
  }),
  freezeStateTargetPureReaderEntry({
    modulePath: "js/core/palette_library_queries.js",
    functionName: "getFeatureIdsForOwnerColorRefresh",
    reviewedReadSiteFingerprints: [
      "ef08ab7ac1ed169d99a912713225734c008503bddcad9ac0dab3fa00175aaf86",
      "30d03d5ab7e7c97dfd01e7de1e44250c6081041fb3bb1877d2d4f4f3c0815f03",
      "1f9634b4c7ebe9e64e3a8a2aaf756d6b16d39d04e2ba6ac04b01d165d1a79782"
    ],
    conservativeFindings: [
      {
        "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"getFeatureIdsForOwnerColorRefresh\",\"ordinal\":0}]}",
        "reason": "ambiguous-alias-flow",
        "operation": "unsupported",
        "key": "*",
        "sourceFingerprint": "ef08ab7ac1ed169d99a912713225734c008503bddcad9ac0dab3fa00175aaf86",
        "count": 1
      },
      {
        "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"getFeatureIdsForOwnerColorRefresh\",\"ordinal\":0}]}",
        "reason": "unsupported-call-mutation",
        "operation": "unsupported",
        "key": "*",
        "sourceFingerprint": "30d03d5ab7e7c97dfd01e7de1e44250c6081041fb3bb1877d2d4f4f3c0815f03",
        "count": 1
      },
      {
        "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"getFeatureIdsForOwnerColorRefresh\",\"ordinal\":0},{\"name\":\"<anonymous>\",\"ordinal\":3}]}",
        "reason": "unsupported-call-mutation",
        "operation": "unsupported",
        "key": "landIndex",
        "sourceFingerprint": "1f9634b4c7ebe9e64e3a8a2aaf756d6b16d39d04e2ba6ac04b01d165d1a79782",
        "count": 1
      }
    ],
    targetParameterName: "inputs",
    importedArgumentCount: 2,
    allowBorrowedTarget: true,
    sourceFingerprint: "656df18fd3d1ef004f2bacf016e2235898ec05eae36141f86e8d7599e4d70bec",
    localFunctionFingerprints: {
      normalizeOwnerCode: "280ec1d37c97a49faf9323e8b09a152aa8d9d010f79c6c6954f562f26ecc10b6",
    },
  }),
freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/legend_state_normalizers.js",
  "functionName": "normalizeLabels",
  "targetParameterName": "value",
  "importedArgumentCount": 1,
  "sourceFingerprint": "4838808f5753e0ab92bd43e3dbe5e799766e05b7929315e646c4b89a784a7ab3",
  "allowBorrowedTarget": true,
  "localFunctionFingerprints": {
    "normalizeColor": "0056e3c114fca25c0bd010a717d1376e45aa3733448faab76776a22c8a3cb734"
  },
  "conservativeFindings": []
}),
freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/legend_state_normalizers.js",
  "functionName": "normalizeColorOrder",
  "targetParameterName": "value",
  "importedArgumentCount": 1,
  "sourceFingerprint": "ce99b5efe1510ebac8662962ddb148a61aab251ff366ff6ec544847e996ba62f",
  "allowBorrowedTarget": true,
  "localFunctionFingerprints": {
    "normalizeColor": "0056e3c114fca25c0bd010a717d1376e45aa3733448faab76776a22c8a3cb734"
  },
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"normalizeColorOrder\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "923fe53966c6cd9343e11af776cd4b05be315ea4b200b02e4d5dfb0f929b73bf",
      "count": 1
    }
  ],
  "reviewedReadSiteFingerprints": []
}),
freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/legend_state_normalizers.js",
  "functionName": "normalizeLegendConfig",
  "targetParameterName": "value",
  "importedArgumentCount": 1,
  "sourceFingerprint": "2942db1de8d263cad9f210f45c6a162714139e51dbb3df361d270a9d9be70284",
  "allowBorrowedTarget": true,
  "localFunctionFingerprints": {},
  "conservativeFindings": []
}),
freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/legend_state_normalizers.js",
  "functionName": "normalizeLegendControl",
  "targetParameterName": "value",
  "importedArgumentCount": 1,
  "sourceFingerprint": "65ce45fd619647d6c2af095ef8784832b8fd9dfd327e42ca8d04f60b8a556d9c",
  "allowBorrowedTarget": true,
  "localFunctionFingerprints": {
    "clampNumber": "d3c8031cc777389f1db77853c8eb8f035a6352b2c5ac088aa7604a76988a9236"
  },
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"normalizeLegendControl\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "f5b3c61db26736b6ded41aa82f8e896db993055956b871aad3af70377b5f3d0d",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"normalizeLegendControl\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "fac0303db1408f5ba08f8a3c14b735bb3a2c96e88955f064ca9b076eb8aa6335",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"normalizeLegendControl\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "a84b24495a15ced1c0e420cf31933ae647265edbab1bcd4f2df0801a5e4be686",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"normalizeLegendControl\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "1abd5470f4c5d68af89800b0946cef1192d677a0611ea559a562ab74b0abfa09",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"normalizeLegendControl\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "0b5863751e7d47e7348f188fb67b638707b31c96ebf3549e59d96e2bc4c9d45b",
      "count": 1
    }
  ]
}),
freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/legend_state_normalizers.js",
  "functionName": "getUniqueLegendColors",
  "targetParameterName": "appState",
  "importedArgumentCount": 1,
  "sourceFingerprint": "078f05ade9b8ab403e8d365b38bf3d5868f0382d790e38ce0993fd254be0d13c",
  "allowBorrowedTarget": true,
  "localFunctionFingerprints": {
    "normalizeColorOrder": "ce99b5efe1510ebac8662962ddb148a61aab251ff366ff6ec544847e996ba62f",
    "normalizeColor": "0056e3c114fca25c0bd010a717d1376e45aa3733448faab76776a22c8a3cb734"
  },
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"getUniqueLegendColors\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "legendColorOrder",
      "sourceFingerprint": "c8b4867508471920f1c1853bdb45071da159dc1f386710bb858dddf39f9bdc27",
      "count": 1
    }
  ]
}),
freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/legend_state_normalizers.js",
  "functionName": "getLegendColorRevisionKey",
  "targetParameterName": "appState",
  "importedArgumentCount": 1,
  "sourceFingerprint": "cdf6c83fe1ccba36ff13fa188da588c0ab23309a92a40ac5148f6b83260b13aa",
  "allowBorrowedTarget": true,
  "localFunctionFingerprints": {
    "normalizeColorOrder": "ce99b5efe1510ebac8662962ddb148a61aab251ff366ff6ec544847e996ba62f",
    "normalizeColor": "0056e3c114fca25c0bd010a717d1376e45aa3733448faab76776a22c8a3cb734"
  },
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"getLegendColorRevisionKey\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "legendColorOrder",
      "sourceFingerprint": "c8b4867508471920f1c1853bdb45071da159dc1f386710bb858dddf39f9bdc27",
      "count": 1
    }
  ]
}),
  // Coverage uses borrowed scene inputs and returns detached scalar/sample data.
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/renderer/scenario_chunk_promotion_helpers.js",
  "functionName": "analyzeScenarioPoliticalDerivedStateCoverage",
  "targetParameterName": "runtimeState",
  "sourceFingerprint": "8a9f8ee3e441816b0a12df62d574990906b092d4449f6eaee068d99c50eed695",
  "importedArgumentCount": 1,
  "localFunctionFingerprints": {
    "getFeatureCollectionFeatures": "e1a8a6c9a1bb7968a52e0ae8aed7f1c1862a45f8a5cc5f6b00cc3675e20b21b6",
    "collectFeatureIdSet": "139e43dd1f00389c8e6e4a59e556f630cc3df23f5ae6e47afdd26f202b953967",
    "getMissingFeatureIdSample": "0de8806d203d060439d08e570190d693e750f6f2944641ae8e8dbb277a089274"
  },
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"analyzeScenarioPoliticalDerivedStateCoverage\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "scenarioPoliticalChunkData",
      "sourceFingerprint": "c024782e27a373543558bb66fb1cf9475829b276e80bfaca5ca61d93b8585073",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"analyzeScenarioPoliticalDerivedStateCoverage\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "scenarioPoliticalVisibleChunkData",
      "sourceFingerprint": "0b6ab5f5502a69e63c362ba5066ce94639dffd4721206ab983818dcd0dbf6184",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"analyzeScenarioPoliticalDerivedStateCoverage\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "landData",
      "sourceFingerprint": "0fd4d335198763a982ae64517b274530ce4975db4efbf1fef68c70e3a3385e3b",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"analyzeScenarioPoliticalDerivedStateCoverage\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "d747561f4df0ac246270df0626fa8c1a629025ac056aa51736406aac82433ffc",
      "count": 2
    }
  ]
}),
  // Returns newly allocated string IDs; live bundles and entries remain borrowed
  // read inputs. Actual eviction is performed by the canonical activation action.
  freezeStateTargetPureReaderEntry({
    modulePath: "js/core/scenario/bundle_cache_policy.js",
    functionName: "getScenarioChunkPayloadEvictionIds",
    targetParameterName: "bundle",
    sourceFingerprint: "a5a8980315d54289b51d3f6b901118c94490f2981103a99cd8b453a6d2815f94",
    allowBorrowedTarget: true,
    importedArgumentCount: 1,
    conservativeFindings: [
      ["06a3f95d90319f606623f626102f5b792f8a9366a72257623f701e105e749f90", 1],
      ["5d0ff787e23deec7d6d7888d48ac87812247b6962ea3c77c340508d8dbaf397a", 1],
      ["c75c997274dc0bde9157ba2ffdcf72b6027cfee0760fc5fb5ec8b61692a35cbe", 2],
    ].map(([sourceFingerprint, count]) => ({
      enclosingFunctionIdentity: '{"kind":"function","ancestry":[{"name":"getScenarioChunkPayloadEvictionIds","ordinal":0}]}',
      reason: "state-alias-escape", operation: "unsupported", key: "*", sourceFingerprint, count,
    })),
  }),
  // Document identity deliberately borrows the two history array references as
  // comparison tokens; no consumer mutates through them. This is not a deep snapshot.
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/interaction_funnel.js",
  "functionName": "captureImportDocumentIdentity",
  "targetParameterName": "target",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "sourceFingerprint": "50b3fa1014131652b85c6be5a22723a804a6924b30cc88dc2fa1e3fed8f70b5d",
  "importedArgumentCount": 0,
  "allowBorrowedTarget": false,
  "localFunctionFingerprints": {},
  "reviewedReadSiteFingerprints": [],
  "acceptedEscapes": [],
  "conservativeFindings": []
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/interaction_funnel.js",
  "functionName": "validateImportedContextLayerResult",
  "targetParameterName": "target",
  "targetParameterIndex": 1,
  "targetParameterPath": "$",
  "sourceFingerprint": "50ca83916b12ee77eda83d13f1523320e76c65e6ddda4c684fe6c628367e8d54",
  "importedArgumentCount": 0,
  "allowBorrowedTarget": false,
  "localFunctionFingerprints": {},
  "acceptedEscapes": [],
  "reviewedReadSiteFingerprints": [],
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"validateImportedContextLayerResult\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "f1303ac9a71abb880024256ab558bbaacc892905c73cb7d2dfa4529d73a785b5",
      "count": 1
    }
  ]
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/interaction_funnel.js",
  "functionName": "resolveImportedTransportCountryOverlayPackIds",
  "targetParameterName": "target",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "sourceFingerprint": "19949d72f798bfd051208900d96b161c86cae6bff8c94946cdb8d62d307a2075",
  "importedArgumentCount": 2,
  "allowBorrowedTarget": false,
  "localFunctionFingerprints": {},
  "acceptedEscapes": [],
  "reviewedReadSiteFingerprints": [],
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"resolveImportedTransportCountryOverlayPackIds\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "9ac10a7f9c6662215651ae164c8e1fe4c7c8e3a77b144a196bc4809bf3d158d9",
      "count": 1
    }
  ]
}),
  // Import preflight only reads trusted topology/ownership projections; each
  // result is a fresh Set or ownership object. Map iteration is source reviewed.
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/interaction_funnel/import_trust_projection.js",
  "functionName": "getScenarioImportValidFeatureIds",
  "targetParameterName": "target",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "sourceFingerprint": "e1f569b8d5dbb5b053c7e9c434034b7cc7bc1ca89988cf9ffc00d55591d31a23",
  "importedArgumentCount": 2,
  "allowBorrowedTarget": false,
  "localFunctionFingerprints": {},
  "acceptedEscapes": [],
  "reviewedReadSiteFingerprints": [
    "2a3f88c19bcbf4ceb733620430e27a19ee9088d6de6f928f5722addd844e1617"
  ],
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"getScenarioImportValidFeatureIds\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "a56145270ce6b3bebd1dd012b73948677dd618d496488bc608a3cb43ce3547dd",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"getScenarioImportValidFeatureIds\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "runtimeFeatureIndexById",
      "sourceFingerprint": "2a3f88c19bcbf4ceb733620430e27a19ee9088d6de6f928f5722addd844e1617",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"getScenarioImportValidFeatureIds\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "8148b7fefaf89ebf8e7951994d2601d731220c5460faecc64c69d12bb7ff3213",
      "count": 1
    }
  ]
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/interaction_funnel/import_trust_projection.js",
  "functionName": "resolveImportedOwnershipState",
  "targetParameterName": "data",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "sourceFingerprint": "6baa3db16ae9bf40d4f663aa5694901d9b64a590e676075de7933553a9b6633e",
  "importedArgumentCount": 2,
  "allowBorrowedTarget": false,
  "localFunctionFingerprints": {},
  "acceptedEscapes": [],
  "reviewedReadSiteFingerprints": [],
  "conservativeFindings": [
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"resolveImportedOwnershipState\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "sovereigntyByFeatureId",
    "sourceFingerprint": "ed8a7f8b9ada9fc6e308b97db6117a2e9afabd4285af5f1f615be3d769b4da09",
    "count": 1
  }
]
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/renderer/fill_target_policy.js",
  "functionName": "createFillTargetPolicy",
  "targetParameterName": "runtimeState",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "importedArgumentCount": 2,
  "sourceFingerprint": "bfbb22703f23ad405387f8d0a849bf4df23e155bcd166d7d995e7b44d34de9c6",
  "reviewedReadSiteFingerprints": [
    "7b885591dab7ab6d93797f0a408ad1d4fa33e4982e7674e8da5392f59be17215",
    "5dcd9eb86a0a447a7fd1b06157a3e81c9ae82a20398c2646cfb477f6efe57bb0",
    "90ba4e4c01486eea5e532bed52d65d1d41517445f540787567990b3290ad4b61",
    "b152d083bc3ad04468cdaf98d9c6bcf2fe65fd34bada469669710235e2703a42",
    "8e68207ab45cddfcd9f15925f3e1b9f8c77b10c3ce354c7adbc857e8bb09d327",
    "7cdf2dee7c9b23c3df8250d8c4c543b264fb855a1b9afcf524b75f7a9e3d6e27",
    "46b1013615cb35c0b1e6a8b49a57b1852dbed645528e27628d6cb68e3c4bf5ca",
    "44afb93474315315a086f168cd8ba61f10b7601ee62389e0ada7c85c47f2d02e"
  ],
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createFillTargetPolicy\",\"ordinal\":0},{\"name\":\"getCountryFeatureIds\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "countryToFeatureIds",
      "sourceFingerprint": "7b885591dab7ab6d93797f0a408ad1d4fa33e4982e7674e8da5392f59be17215",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createFillTargetPolicy\",\"ordinal\":0},{\"name\":\"getCountryFeatureIds\",\"ordinal\":0},{\"name\":\"<anonymous>\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "landIndex",
      "sourceFingerprint": "5dcd9eb86a0a447a7fd1b06157a3e81c9ae82a20398c2646cfb477f6efe57bb0",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createFillTargetPolicy\",\"ordinal\":0},{\"name\":\"getScenarioOwnerFeatureIds\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "ownerToFeatureIds",
      "sourceFingerprint": "90ba4e4c01486eea5e532bed52d65d1d41517445f540787567990b3290ad4b61",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createFillTargetPolicy\",\"ordinal\":0},{\"name\":\"getScenarioOwnerFeatureIds\",\"ordinal\":0},{\"name\":\"<anonymous>\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "landIndex",
      "sourceFingerprint": "5dcd9eb86a0a447a7fd1b06157a3e81c9ae82a20398c2646cfb477f6efe57bb0",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createFillTargetPolicy\",\"ordinal\":0},{\"name\":\"resolveParentGroupKey\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "scenarioDistrictGroupByFeatureId",
      "sourceFingerprint": "b152d083bc3ad04468cdaf98d9c6bcf2fe65fd34bada469669710235e2703a42",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createFillTargetPolicy\",\"ordinal\":0},{\"name\":\"resolveParentGroupKey\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "parentGroupByFeatureId",
      "sourceFingerprint": "8e68207ab45cddfcd9f15925f3e1b9f8c77b10c3ce354c7adbc857e8bb09d327",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createFillTargetPolicy\",\"ordinal\":0},{\"name\":\"resolveParentGroupTargetIds\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "landIndex",
      "sourceFingerprint": "7cdf2dee7c9b23c3df8250d8c4c543b264fb855a1b9afcf524b75f7a9e3d6e27",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createFillTargetPolicy\",\"ordinal\":0},{\"name\":\"resolveParentGroupTargetIds\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "scenarioDistrictGroupByFeatureId",
      "sourceFingerprint": "b152d083bc3ad04468cdaf98d9c6bcf2fe65fd34bada469669710235e2703a42",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createFillTargetPolicy\",\"ordinal\":0},{\"name\":\"resolveParentGroupTargetIds\",\"ordinal\":0},{\"name\":\"<anonymous>\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "landIndex",
      "sourceFingerprint": "46b1013615cb35c0b1e6a8b49a57b1852dbed645528e27628d6cb68e3c4bf5ca",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createFillTargetPolicy\",\"ordinal\":0},{\"name\":\"resolveSpecialZoneParentGroupTargetIds\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "landIndex",
      "sourceFingerprint": "44afb93474315315a086f168cd8ba61f10b7601ee62389e0ada7c85c47f2d02e",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createFillTargetPolicy\",\"ordinal\":0},{\"name\":\"resolveCountryFillTargetIds\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "landIndex",
      "sourceFingerprint": "7cdf2dee7c9b23c3df8250d8c4c543b264fb855a1b9afcf524b75f7a9e3d6e27",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createFillTargetPolicy\",\"ordinal\":0},{\"name\":\"resolveCountryFillTargetIds\",\"ordinal\":0},{\"name\":\"<anonymous>\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "landIndex",
      "sourceFingerprint": "46b1013615cb35c0b1e6a8b49a57b1852dbed645528e27628d6cb68e3c4bf5ca",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createFillTargetPolicy\",\"ordinal\":0},{\"name\":\"resolveCountryFillTargetIds\",\"ordinal\":0},{\"name\":\"<anonymous>\",\"ordinal\":1}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "landIndex",
      "sourceFingerprint": "46b1013615cb35c0b1e6a8b49a57b1852dbed645528e27628d6cb68e3c4bf5ca",
      "count": 1
    }
  ]
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/renderer/visible_frame_identity_policy.js",
  "functionName": "createVisibleFrameIdentityPolicy",
  "targetParameterName": "runtimeState",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "importedArgumentCount": 2,
  "sourceFingerprint": "f7a5dee8726e035460d07ad4ecf9e2d5345fa575be771b14979dba95d0ce63ce",
  "reviewedReadSiteFingerprints": [],
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createVisibleFrameIdentityPolicy\",\"ordinal\":0},{\"name\":\"countFeatureCollectionFeatures\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "2a6713bd3774cc4560c7c908fcb21a262a9ccc75c5e521889b78338be3d87771",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createVisibleFrameIdentityPolicy\",\"ordinal\":0},{\"name\":\"getPoliticalSceneReadiness\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "09ab370303a30c957edda080d7bc453da2f7114e5a6fd4bde27b19115a553c6f",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createVisibleFrameIdentityPolicy\",\"ordinal\":0},{\"name\":\"getPoliticalSceneReadiness\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "62ef700615dc02ae51c682a78ed69d920c2668cd376228b2a1adf9b10ee248fb",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createVisibleFrameIdentityPolicy\",\"ordinal\":0},{\"name\":\"getPoliticalSceneReadiness\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "45e84462f70b67ed95d57ee05e143731aeda00563ac6ce09f3be59b8c156534b",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createVisibleFrameIdentityPolicy\",\"ordinal\":0},{\"name\":\"getPoliticalSceneReadiness\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "ef5783ca31441756782e4ee380dec5da629b387c018672af235eeb385c50d09c",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createVisibleFrameIdentityPolicy\",\"ordinal\":0},{\"name\":\"getVisibleFrameIdentity\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "aa214ea38326805d95661c3ad1643cc07f88e2bae0438ac0448a66d93335ca6e",
      "count": 2
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createVisibleFrameIdentityPolicy\",\"ordinal\":0},{\"name\":\"getCommittedFrameIdentity\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "aa214ea38326805d95661c3ad1643cc07f88e2bae0438ac0448a66d93335ca6e",
      "count": 3
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createVisibleFrameIdentityPolicy\",\"ordinal\":0},{\"name\":\"getFirstVisiblePoliticalFrameBlockReason\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "aa214ea38326805d95661c3ad1643cc07f88e2bae0438ac0448a66d93335ca6e",
      "count": 3
    }
  ]
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/renderer/parent_border_grouping_policy.js",
  "functionName": "createParentBorderGroupingPolicy",
  "targetParameterName": "runtimeState",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "importedArgumentCount": 2,
  "sourceFingerprint": "5670f3a4632551c5bc5f87ead6ec7f6d09b05e1fe747c3069d62613ddb63116b",
  "reviewedReadSiteFingerprints": [],
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createParentBorderGroupingPolicy\",\"ordinal\":0},{\"name\":\"getFullLandDataFeatures\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "landDataFull",
      "sourceFingerprint": "cfc372e856be4393336edb59dfdd9a85818ae640f2ff3cbb9d159ffd618b585b",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createParentBorderGroupingPolicy\",\"ordinal\":0},{\"name\":\"getFullLandDataFeatures\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "a4b2da05ea08f0b3e96876c13b91160b5f314216f91475d452974700e25d095d",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createParentBorderGroupingPolicy\",\"ordinal\":0},{\"name\":\"getCountryFeatureEntriesMap\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "2ad562319767157087dda0dec6391f4479f8a04869ab0cc8d3a9c3637dae73b5",
      "count": 4
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createParentBorderGroupingPolicy\",\"ordinal\":0},{\"name\":\"getCountryFeatureEntriesMap\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "7a753bfb25faa0d4209caee0c6618e0477b90d9c79ce81a283bfd81bf8b296dc",
      "count": 1
    }
  ]
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/renderer/bathymetry_style_policy.js",
  "functionName": "createBathymetryStylePolicy",
  "targetParameterName": "runtimeState",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "importedArgumentCount": 2,
  "sourceFingerprint": "69daef834597d419b5e93be094053086a119ba50a35767dcfa275a1512708f53",
  "reviewedReadSiteFingerprints": [],
  "conservativeFindings": []
}),
  // Reviewed cache-key construction: no writes to the supplied runtime state.
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/renderer/render_pass_signature_policy.js",
  "functionName": "createRenderPassSignaturePolicy",
  "targetParameterName": "runtimeState",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "importedArgumentCount": 2,
  "sourceFingerprint": "889441dec930853ac97ae1df88d87436902e637208f4225e79606b06e2f53a18",
  "reviewedReadSiteFingerprints": [
    "f647030132722ae3af9f66521c4f809bd251525e4d8e2c07af71cecb2139b068",
    "227888b0de31384b3ff91e6afb1953a231655869c0f1f1ca7714bd381800324e",
    "50318e66ee60ec90f6eece379c41bed532dfb651fcc17e80c921a3923e4d477c",
    "649a631808e219f64f8c15f28dd2e05b159de8621abeaedf4ae517eb36dd7840",
    "f34bd27f826ee018f400ea83fe87155c90d615cce04f74a4608e5fa4c1c532f3",
    "e0d5ceebd0b9df96fa634a9896c139f85fce6990da48c497569586800db8c480",
    "91363a7f9f173374e5f818b9c02011588651581239b87c9c4ae409fa795cfa26",
    "1d6a2bbee82de8d2cab8a5b74bcd6d3e2774b2d3cddf91f0da44317e27884e41",
    "af4f4c56fd6d5a8dced359fb303462ff7534472eae5b6ea9e0b83093a9919dcf",
    "803959b42b14c1ec474c33b39749838dde40d9cac8231365d999a0ca7f76bf26",
    "ea0622ecd4ec27121ed69a45d621dff76e90e94f35ba3ab470eb52750ece3346",
    "325e65d190d5441e5d865b40695e0eee9aad90ca206dde06bd211516b15c9ec9"
  ],
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getBorderAppearanceRevision\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "f2b9df28b4be5de5a0c10d49b317bb6cc2cd3201c163db4ea5331ecadad88648",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getTransportPresentationSignatureParts\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "80251709a36cf44e189abc1e5226764f9b0ce854f927627da901911f68c6774d",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getPoliticalPassStaticSignature\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "f647030132722ae3af9f66521c4f809bd251525e4d8e2c07af71cecb2139b068",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getPoliticalPassStaticSignature\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "aa214ea38326805d95661c3ad1643cc07f88e2bae0438ac0448a66d93335ca6e",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getPoliticalPassStaticSignature\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "b0993135d395f1d11c7b028f8e69efb916c608b6955251b21aa613a8e6f13faf",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getPoliticalPassStaticSignature\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "8f894f0728091252c297f7371b02ff62a720321a08f0c8d83155e5cd1ee20fe3",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getRenderPassTransformSignature\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "aa214ea38326805d95661c3ad1643cc07f88e2bae0438ac0448a66d93335ca6e",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getRenderPassSignature\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "aa214ea38326805d95661c3ad1643cc07f88e2bae0438ac0448a66d93335ca6e",
      "count": 3
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getRenderPassSignature\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "intensityFields",
      "sourceFingerprint": "00c77b0847e15fd470bdad5f4172e4f93f9a32a71533d98d23cd0f975f130516",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getRenderPassSignature\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "227888b0de31384b3ff91e6afb1953a231655869c0f1f1ca7714bd381800324e",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getRenderPassSignature\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "b0993135d395f1d11c7b028f8e69efb916c608b6955251b21aa613a8e6f13faf",
      "count": 10
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getRenderPassSignature\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "59d7a6a13ccf6a3cb22c93a67fb238930870286a34e58d15b23951a598f2dcda",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getRenderPassSignature\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "b8ffadb3e829551dd90b4eecb6773c5efa5cb0c9460b006d703602a2a266d614",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getRenderPassSignature\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "50318e66ee60ec90f6eece379c41bed532dfb651fcc17e80c921a3923e4d477c",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getRenderPassSignature\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "46b307d8e854682ac1d79f4f83fe73751551d9e56bcea1bd04dfff5c111ff585",
      "count": 6
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getRenderPassSignature\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "1be60129cbadd56582e2ce5ebd597edc8b62bf2418ff3b7e334c8c9c5fd62219",
      "count": 2
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getRenderPassSignature\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "649a631808e219f64f8c15f28dd2e05b159de8621abeaedf4ae517eb36dd7840",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getRenderPassSignature\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "f2b9df28b4be5de5a0c10d49b317bb6cc2cd3201c163db4ea5331ecadad88648",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getRenderPassSignature\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "f34bd27f826ee018f400ea83fe87155c90d615cce04f74a4608e5fa4c1c532f3",
      "count": 2
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getRenderPassSignature\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "28375c9754788fcb5fe581ab5b29acfe5db4c54114b457174a82b548718a1380",
      "count": 3
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getRenderPassSignature\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "8ce80812e36b0cf81bccd066585ee426d85089d62619f8ef45468d0b673194ab",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getRenderPassSignature\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "364110161ea7b1708b7c391d5c2158174df92d4942a5bb89987150b84bede648",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getRenderPassSignature\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "styleConfig",
      "sourceFingerprint": "810d1a71db52ce4a5fc0b87587329bbd4caecd73786ec81a414b946247b875bb",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getRenderPassSignature\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "fb966f56bb34229459f83628f83d5f91f8e71a63b56b21b78872cdf363f10763",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getRenderPassSignature\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "0d1e0dd18ba428d8870b1eee499ea6ec71ad706a55de5e94334658565b551251",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getRenderPassSignature\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "e0d5ceebd0b9df96fa634a9896c139f85fce6990da48c497569586800db8c480",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getRenderPassSignature\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "2ee0c86b2ebf1f6dd9b5644b774f50ebfe29b2d713c0bee13c87b02ed19e9ae0",
      "count": 2
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getRenderPassSignature\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "91363a7f9f173374e5f818b9c02011588651581239b87c9c4ae409fa795cfa26",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getRenderPassSignature\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "1d6a2bbee82de8d2cab8a5b74bcd6d3e2774b2d3cddf91f0da44317e27884e41",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getRenderPassSignature\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "2e51c4d469637774e394d4d8cf5c379bebc66669a88c5e54a716cd9277c294c7",
      "count": 2
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getRenderPassSignature\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "c84724b94202621a115ca289c7fe4e4669dc929026ed18ee9bd7bc56d8fda013",
      "count": 2
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getRenderPassSignature\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "af4f4c56fd6d5a8dced359fb303462ff7534472eae5b6ea9e0b83093a9919dcf",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getRenderPassSignature\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "803959b42b14c1ec474c33b39749838dde40d9cac8231365d999a0ca7f76bf26",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getRenderPassSignature\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "181d34d5760d34994027705303bfcd807190a30bbe17c9b8ffb4d61a8fd53d9a",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getRenderPassSignature\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "ea0622ecd4ec27121ed69a45d621dff76e90e94f35ba3ab470eb52750ece3346",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getRenderPassSignature\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "325e65d190d5441e5d865b40695e0eee9aad90ca206dde06bd211516b15c9ec9",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getRenderPassSignature\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "9ce1772f57bd2cbf9a3f5043a4b3473980a70b1f05175096d82307733f428829",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getRenderPassSignature\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "60fb297c4a75911be7e8f2cef19f26423b4a2c6a42492beab8d0a70a06a1b7b4",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getRenderPassSignature\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "080d98b9113dceb3b76d147ec18328889e9b81f123077a1dc7ffc82acc8e11df",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getRenderPassSignature\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "34ca10667d7c502ea9ecb3ca98c818062fc23b399b5e48860ba7752207370d7d",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getRenderPassSignature\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "be70b4cf5e47ec0e28197cae3b392cf36cefab52d4c7de6f5631dac8c8e24856",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getRenderPassSignature\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "f7f9493575a38b36742e1d86033a3c670a08024a776317cc3dbdf14dedb2aa33",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getRenderPassSignature\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "c77c0c7203dea786aa285fdc577bfce274ef2b3bb548df4f44ba4bdcfdc5aed1",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createRenderPassSignaturePolicy\",\"ordinal\":0},{\"name\":\"getRenderPassSignature\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "814a638b718c74404bf36981e5d2704cf8405dddee63fb90dec6992979ba42bc",
      "count": 1
    }
  ]
}),
  freezeStateTargetPureReaderEntry({
  localFunctionFingerprints: {
  "getScenarioChunkIdsByLayer": "2d7eef210310a415ae3b185a942ca141a49db425bb2836626a9f644d8e1cfefb",
  "getPayloadIdentity": "f9317f6fb2449ac07e27a7b1ba8cdbf72269ad6f686e94b42e825971ae4e2063"
},
  "modulePath": "js/core/scenario/chunk_layer_payloads.js",
  "functionName": "buildScenarioChunkLayerSelectionSignatures",
  "allowBorrowedTarget": true,
  "targetParameterName": "chunkState",
  "targetParameterIndex": 1,
  "targetParameterPath": "$",
  "sourceFingerprint": "41838c0e0a1f663e76858ea9096a4b21a88de35ffd3bd18857433a83fd925dc3",
  "importedArgumentCount": 3,
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"buildScenarioChunkLayerSelectionSignatures\",\"ordinal\":0},{\"name\":\"<anonymous>\",\"ordinal\":1},{\"name\":\"<anonymous>\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "payloadByChunkId",
      "sourceFingerprint": "ed5703b81f6d6868198e8c1fcdb7da5500178359be0a32e6500f4d9b0049434d",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"buildScenarioChunkLayerSelectionSignatures\",\"ordinal\":0},{\"name\":\"<anonymous>\",\"ordinal\":1}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "2391ae740baea4f907b8bcd3778b16ae0a3fc97d4dbfdc3c019aad3dc8bbef22",
      "count": 1
    }
  ]
}),
  freezeStateTargetPureReaderEntry({
  localFunctionFingerprints: {
  "getScenarioChunkPayloadEntriesForLayer": "950c8e4e0aadb4aa0cbc72c9fd0d041945f2e1e3a7b6dd551cc38cbf885b01cd",
  "buildScenarioChunkMetaIndex": "2524ec2c823fd9e9ff7bb1e05be414fd6a23597910993155ac064fa5ce391226"
},
  "modulePath": "js/core/scenario/chunk_layer_payloads.js",
  "functionName": "buildMergedScenarioChunkLayerPayloads",
  "allowBorrowedTarget": true,
  "targetParameterName": "chunkState",
  "targetParameterIndex": 1,
  "targetParameterPath": "$",
  "sourceFingerprint": "47dc1cc4395b44564e669f0a7cb8142e190d1000fad0c87a97687dcc31685ca4",
  "importedArgumentCount": 3,
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"buildMergedScenarioChunkLayerPayloads\",\"ordinal\":0},{\"name\":\"<anonymous>\",\"ordinal\":1}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "2391ae740baea4f907b8bcd3778b16ae0a3fc97d4dbfdc3c019aad3dc8bbef22",
      "count": 1
    }
  ]
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/renderer/city_label_text_model.js",
  "functionName": "createCityLabelTextModel",
  "importedArgumentCount": 2,
  "targetParameterName": "runtimeState",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "sourceFingerprint": "453d6c8856513622143f405f0317fc1dffdf101cf53367a1cfb52f20fe8ea3ce",
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createCityLabelTextModel\",\"ordinal\":0},{\"name\":\"getCityRawFallbackLabel\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "currentLanguage",
      "sourceFingerprint": "ca4a227c42b62e44f8daa1e53f62cda734b0577033429c0a4b3b1589aec935bd",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createCityLabelTextModel\",\"ordinal\":0},{\"name\":\"resolveCityDisplayLabel\",\"ordinal\":0},{\"name\":\"<anonymous>\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "a8f428ae15ee30a87d4a1acd7ffe4e48adbcd2f400facf488ddaface38376bbc",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createCityLabelTextModel\",\"ordinal\":0},{\"name\":\"resolveCityDisplayLabel\",\"ordinal\":0},{\"name\":\"<anonymous>\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "scenarioGeoLocalePatchData",
      "sourceFingerprint": "088349b3e0ed36d76cd63d4f3faaf7826ca6e4116b4346371370b63cf64996e8",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createCityLabelTextModel\",\"ordinal\":0},{\"name\":\"resolveCityDisplayLabel\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "currentLanguage",
      "sourceFingerprint": "ca4a227c42b62e44f8daa1e53f62cda734b0577033429c0a4b3b1589aec935bd",
      "count": 1
    }
  ],
  "reviewedReadSiteFingerprints": []
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/renderer/political_feature_policy.js",
  "functionName": "createPoliticalFeaturePolicy",
  "importedArgumentCount": 2,
  "targetParameterName": "runtimeState",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "sourceFingerprint": "9647ef9584d488e38920674d9ebab5bc099b59f631c31dafdf635205530b76a9",
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createPoliticalFeaturePolicy\",\"ordinal\":0},{\"name\":\"hasPoliticalForegroundColorOverride\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "visualOverrides",
      "sourceFingerprint": "3a75131341f80cbba7fff3e9eb4d5d8a4a0a6a2e62befb33b09056ab8eae2d1e",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createPoliticalFeaturePolicy\",\"ordinal\":0},{\"name\":\"hasPoliticalForegroundColorOverride\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "featureOverrides",
      "sourceFingerprint": "af800fea6948a4f22285356a219f80362a89b98ef5d5c75a5adb52e730e413eb",
      "count": 1
    }
  ],
  "reviewedReadSiteFingerprints": []
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/renderer/physical_intensity_preview_owner.js",
  "functionName": "createPhysicalIntensityPreviewOwner",
  "importedArgumentCount": 2,
  "targetParameterName": "runtimeState",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "sourceFingerprint": "f1785aa7513397801118f9b489d1656cd6e02e3756330b52b082394d8e06f6b2",
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createPhysicalIntensityPreviewOwner\",\"ordinal\":0},{\"name\":\"getMapLonLatFromEvent\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "59ded132c1a2410e3d59235da3a5d0bbaa01688efe5fbf18796419317f0707e2",
      "count": 1
    }
  ],
  "reviewedReadSiteFingerprints": []
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/renderer/political_path_cache_owner.js",
  "functionName": "createPoliticalPathCacheOwner",
  "importedArgumentCount": 2,
  "targetParameterName": "runtimeState",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "sourceFingerprint": "c451d541f0d567309f5f0f71f97c5274f5052cd92c4cf28996446f2e17972891",
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createPoliticalPathCacheOwner\",\"ordinal\":0},{\"name\":\"getPoliticalPathCacheSignature\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "ea0b830832854d9deb1bc25226c9685324b53c6a01a87e8dd288d23c82383323",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createPoliticalPathCacheOwner\",\"ordinal\":0},{\"name\":\"getPoliticalPathCacheSignature\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "topologyDetail",
      "sourceFingerprint": "8edd070d7210a8201b16b65ba20c261acc7c4fe661a79b5e1245731ef6c9bc39",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createPoliticalPathCacheOwner\",\"ordinal\":0},{\"name\":\"getPoliticalPathCacheSignature\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "b5ef4f9b225eff3ed07c3c91829be497ac51b41abb3eacfe304acd3957336ee7",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createPoliticalPathCacheOwner\",\"ordinal\":0},{\"name\":\"getPoliticalPathCacheHandle\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "aa214ea38326805d95661c3ad1643cc07f88e2bae0438ac0448a66d93335ca6e",
      "count": 2
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createPoliticalPathCacheOwner\",\"ordinal\":0},{\"name\":\"getPoliticalFeaturePathEntry\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "aa214ea38326805d95661c3ad1643cc07f88e2bae0438ac0448a66d93335ca6e",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createPoliticalPathCacheOwner\",\"ordinal\":0},{\"name\":\"collectWarmupCandidateItems\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "aa214ea38326805d95661c3ad1643cc07f88e2bae0438ac0448a66d93335ca6e",
      "count": 2
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createPoliticalPathCacheOwner\",\"ordinal\":0},{\"name\":\"runPoliticalPathWarmupSlice\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "aa214ea38326805d95661c3ad1643cc07f88e2bae0438ac0448a66d93335ca6e",
      "count": 4
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createPoliticalPathCacheOwner\",\"ordinal\":0},{\"name\":\"runPoliticalPathWarmupSlice\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "a692fae1891f016b7aac2655559f73c3e5fdf4118eab6dfa1211cceea73fb921",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createPoliticalPathCacheOwner\",\"ordinal\":0},{\"name\":\"schedulePoliticalPathWarmup\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "aa214ea38326805d95661c3ad1643cc07f88e2bae0438ac0448a66d93335ca6e",
      "count": 4
    }
  ],
  "reviewedReadSiteFingerprints": []
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/renderer/brush_interaction_session_owner.js",
  "functionName": "createBrushInteractionSessionOwner",
  "importedArgumentCount": 2,
  "targetParameterName": "runtimeState",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "sourceFingerprint": "fc2e1d1ed5a96512a40bea2b7b1aa80c2d76ebbcf82b643dacfeffabb3952da0",
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createBrushInteractionSessionOwner\",\"ordinal\":0},{\"name\":\"flushBrushSession\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "selectedColor",
      "sourceFingerprint": "44f205f7b042beac7faa6d0be234297e11f83fddafd1ad9e1fb29daedca94437",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createBrushInteractionSessionOwner\",\"ordinal\":0},{\"name\":\"applySpecialZoneMembershipDragHit\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "landIndex",
      "sourceFingerprint": "7cdf2dee7c9b23c3df8250d8c4c543b264fb855a1b9afcf524b75f7a9e3d6e27",
      "count": 1
    }
  ],
  "reviewedReadSiteFingerprints": [
    "7cdf2dee7c9b23c3df8250d8c4c543b264fb855a1b9afcf524b75f7a9e3d6e27"
  ]
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/renderer/city_paint_style_model.js",
  "functionName": "createCityPaintStyleModel",
  "importedArgumentCount": 2,
  "targetParameterName": "runtimeState",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "sourceFingerprint": "f71945637e83848b11df931adfc59d5f3e3902aec0a839007e2dcd6a27642084",
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createCityPaintStyleModel\",\"ordinal\":0},{\"name\":\"getCityLabelBackgroundColor\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "landIndex",
      "sourceFingerprint": "3d16be86c3951d290a05d9b59533e6d2d15912c57d3deb03c03811bfe6e8d66e",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createCityPaintStyleModel\",\"ordinal\":0},{\"name\":\"getCityLabelBackgroundColor\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "colors",
      "sourceFingerprint": "2c8e4f2f749d810bc634816c230ad1a7d8f906f23a9771372dca36a55f0b5fd6",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createCityPaintStyleModel\",\"ordinal\":0},{\"name\":\"getCityLabelBackgroundColor\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "sovereignBaseColors",
      "sourceFingerprint": "c88066fe383ba2647eaac3aef10079b359814c85eedfcb1fc4ef4c874beb2cac",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createCityPaintStyleModel\",\"ordinal\":0},{\"name\":\"getCityLabelBackgroundColor\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "countryBaseColors",
      "sourceFingerprint": "c70df4a92814a02f80381bfc2d8a2b66509bd101c74a5ec6c9d2d00f96ba91a5",
      "count": 1
    }
  ],
  "reviewedReadSiteFingerprints": [
    "3d16be86c3951d290a05d9b59533e6d2d15912c57d3deb03c03811bfe6e8d66e"
  ]
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/renderer/urban_adaptive_paint_model.js",
  "functionName": "createUrbanAdaptivePaintModel",
  "importedArgumentCount": 2,
  "targetParameterName": "runtimeState",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "sourceFingerprint": "fe268dcce895261da021e818431ea2ba166d5750fbc2162296a1b65f806137ce",
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createUrbanAdaptivePaintModel\",\"ordinal\":0},{\"name\":\"getUrbanHostFillColor\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "landIndex",
      "sourceFingerprint": "1bc050c6358029b1974e561af79bcba76eeb45b6811ccd05360265b9c768be80",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createUrbanAdaptivePaintModel\",\"ordinal\":0},{\"name\":\"getUrbanHostFillColor\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "colors",
      "sourceFingerprint": "20fe3f066d3e2d5876d47a1d229c88545c132f2e504de5089028ef62fc0756e2",
      "count": 1
    }
  ],
  "reviewedReadSiteFingerprints": [
    "1bc050c6358029b1974e561af79bcba76eeb45b6811ccd05360265b9c768be80"
  ]
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/renderer/operation_graphics_editor_render_owner.js",
  "functionName": "createOperationGraphicsEditorRenderOwner",
  "importedArgumentCount": 2,
  "targetParameterName": "runtimeState",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "sourceFingerprint": "015a8f1dcfeda3376b1a0e6be49f2dc8e4a48dbdb33dd7ed11622d37ea8314c3",
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createOperationGraphicsEditorRenderOwner\",\"ordinal\":0},{\"name\":\"getOperationGraphicEditorModel\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "19b3d8f375a6e5ae595efc5cddffdcc1c94a84225ec07dede2c3cd5d40b38b3a",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createOperationGraphicsEditorRenderOwner\",\"ordinal\":0},{\"name\":\"getOperationGraphicEditorModel\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "155baacdcb6b78a1c24f733f3dd45699a4a82219a2e937ed4a355d3426a60740",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createOperationGraphicsEditorRenderOwner\",\"ordinal\":0},{\"name\":\"getOperationGraphicEditorModel\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "operationGraphicsEditor",
      "sourceFingerprint": "519aa1198f2441799d53442efae395b1533d82e4ae64fcce1d88935792abc3c7",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createOperationGraphicsEditorRenderOwner\",\"ordinal\":0},{\"name\":\"getOperationGraphicEditorModel\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "operationGraphicsEditor",
      "sourceFingerprint": "24274d8edb690ba0f26f1557bf01ab9eaaa2d3cafecfe1eea04742dfd1baf904",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createOperationGraphicsEditorRenderOwner\",\"ordinal\":0},{\"name\":\"getOperationGraphicEditorModel\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "operationGraphicsEditor",
      "sourceFingerprint": "2cca5adc673c1813e77b922f7f3c4cf5958154e861946b39e71d07e4930786d6",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createOperationGraphicsEditorRenderOwner\",\"ordinal\":0},{\"name\":\"getOperationGraphicEditorModel\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "operationGraphicsEditor",
      "sourceFingerprint": "f7c19143f20496140a503658b715316e4ac8af8cf6c46b6032821fbb3f6c6ecc",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createOperationGraphicsEditorRenderOwner\",\"ordinal\":0},{\"name\":\"getOperationGraphicEditorModel\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "operationGraphicsEditor",
      "sourceFingerprint": "cb04ec6dff788fd9f09d3f43fb58b34def6678b6898f77cb1f4ebf1093cead86",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createOperationGraphicsEditorRenderOwner\",\"ordinal\":0},{\"name\":\"renderOperationGraphicsEditorOverlay\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "e0d46c367252678dc0eda80c1ade7b5be5861b42c0ebb1a67ada007d7a38bfe4",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createOperationGraphicsEditorRenderOwner\",\"ordinal\":0},{\"name\":\"renderOperationGraphicsEditorOverlay\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "47effeab37eb17c30289312c8a8e38c1d0c361193e6c638147ed85b77c306afa",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createOperationGraphicsEditorRenderOwner\",\"ordinal\":0},{\"name\":\"renderOperationGraphicsEditorOverlay\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "c54a061dfcc125cb160421b2680feaf6d65d938d756d887fe4d8d1d046eb626e",
      "count": 2
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createOperationGraphicsEditorRenderOwner\",\"ordinal\":0},{\"name\":\"renderOperationGraphicsEditorOverlay\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "f35c051744c7dacb6394badfcd87ca74e491a0635dbd4021307eadbcff84c224",
      "count": 4
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createOperationGraphicsEditorRenderOwner\",\"ordinal\":0},{\"name\":\"renderOperationGraphicsEditorOverlay\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "c24a12d63a6be7c543e772fa84730f55a9a7dd72c0e6c19fd9baca437ed63109",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createOperationGraphicsEditorRenderOwner\",\"ordinal\":0},{\"name\":\"renderOperationGraphicsEditorOverlay\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "c117e6bea9223b0bdb5596451c8516952ba86ffa96a1ed143f0d3c93cbe710fa",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createOperationGraphicsEditorRenderOwner\",\"ordinal\":0},{\"name\":\"renderOperationGraphicsEditorOverlay\",\"ordinal\":0}]}",
      "reason": "ambiguous-alias-flow",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "48c2f317e6ec8c795de225bf8c6d41f3936c3e898c7308b9bd948ce2caf119e0",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createOperationGraphicsEditorRenderOwner\",\"ordinal\":0},{\"name\":\"renderOperationGraphicsEditorOverlay\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "23cc4069ee1cbf8cd8dcccf007d5c323acdb79356731d1d2f6b009c1919502a6",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createOperationGraphicsEditorRenderOwner\",\"ordinal\":0},{\"name\":\"renderOperationGraphicsEditorOverlay\",\"ordinal\":0},{\"name\":\"<anonymous>\",\"ordinal\":9}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "c54a061dfcc125cb160421b2680feaf6d65d938d756d887fe4d8d1d046eb626e",
      "count": 1
    }
  ],
  "reviewedReadSiteFingerprints": [
    "48c2f317e6ec8c795de225bf8c6d41f3936c3e898c7308b9bd948ce2caf119e0",
    "23cc4069ee1cbf8cd8dcccf007d5c323acdb79356731d1d2f6b009c1919502a6"
  ]
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/renderer/scenario_region_overlay_render_owner.js",
  "functionName": "createScenarioRegionOverlayRenderOwner",
  "importedArgumentCount": 2,
  "targetParameterName": "runtimeState",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "sourceFingerprint": "f9e236ec7300fb094535764db2eea2efa6fe2514d0fffed94fce8ba530d01387",
  "conservativeFindings": [

    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createScenarioRegionOverlayRenderOwner\",\"ordinal\":0},{\"name\":\"drawScenarioWaterFillLayer\",\"ordinal\":0},{\"name\":\"<anonymous>\",\"ordinal\":0},{\"name\":\"<anonymous>\",\"ordinal\":1}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "d80ecbcca1f8812f667c273a85ad27337b7dd89950e3b29f14bfa4c27a45951a",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createScenarioRegionOverlayRenderOwner\",\"ordinal\":0},{\"name\":\"drawScenarioAtlantropaLandLikeOverlayLayer\",\"ordinal\":0},{\"name\":\"<anonymous>\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "colors",
      "sourceFingerprint": "2e8220e7a8bb2055af50b2c67c01da148a594d8938caf0713d14ccd7fd061c77",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createScenarioRegionOverlayRenderOwner\",\"ordinal\":0},{\"name\":\"drawScenarioAtlantropaLandLikeOverlayLayer\",\"ordinal\":0},{\"name\":\"<anonymous>\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "3c6433af2ff4d9f1a5cd72bbf568ad73f998345c30494d40606a1582c9b943ce",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createScenarioRegionOverlayRenderOwner\",\"ordinal\":0},{\"name\":\"drawScenarioAtlantropaLandLikeOverlayLayer\",\"ordinal\":0},{\"name\":\"<anonymous>\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "aa214ea38326805d95661c3ad1643cc07f88e2bae0438ac0448a66d93335ca6e",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createScenarioRegionOverlayRenderOwner\",\"ordinal\":0},{\"name\":\"getScenarioWaterFeaturePath\",\"ordinal\":0},{\"name\":\"<anonymous>\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "d80ecbcca1f8812f667c273a85ad27337b7dd89950e3b29f14bfa4c27a45951a",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createScenarioRegionOverlayRenderOwner\",\"ordinal\":0},{\"name\":\"drawScenarioWaterHighlightLayer\",\"ordinal\":0},{\"name\":\"<anonymous>\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "waterRegionsById",
      "sourceFingerprint": "e7977b6652a98c924e5d56cd04a860c20c291684311194d7aa70305da8298a62",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createScenarioRegionOverlayRenderOwner\",\"ordinal\":0},{\"name\":\"drawScenarioRegionOverlaysPass\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "1e54a3b975197cb6ff380af66df12d4bbd987aca2256543e91e4fd341fc1585e",
      "count": 2
    }
  ],
  "reviewedReadSiteFingerprints": [
    "e7977b6652a98c924e5d56cd04a860c20c291684311194d7aa70305da8298a62"
  ]
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/renderer/static_border_mesh_lifecycle.js",
  "functionName": "createStaticBorderMeshLifecycle",
  "importedArgumentCount": 2,
  "targetParameterName": "runtimeState",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "sourceFingerprint": "676eb69ead980e86e9fabc6c9a71b517050bfa8f5c80e639266210148097619b",
  "conservativeFindings": [
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"buildDetailAdmMeshSignature\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "*",
    "sourceFingerprint": "8254c329a92850f6d539dd376f4816ee2764517da5e0235514af433164480d7a",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"getVisibleCountryCodesForBorderMeshes\",\"ordinal\":0}]}",
    "reason": "unsupported-call-mutation",
    "operation": "unsupported",
    "key": "*",
    "sourceFingerprint": "4748641712fb9fd6252f78436ca751283b64ab94f9782d067277c8470567e601",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"getVisibleCountryCodesForBorderMeshes\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "*",
    "sourceFingerprint": "6ee3ea5be0fff658a0d31bd14d8fea0c11d9d6eb03b5aaf391978880971cc963",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"getVisibleCountryCodesForBorderMeshes\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "*",
    "sourceFingerprint": "bcaf5eab79242d6df3d77d118c98aed908da502e5a60b25bb6af8e9eed7661d2",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"readWorkIdentity\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "*",
    "sourceFingerprint": "c729633a42c5dd7d4dd2035e3c63ab13ec706bca4681dd5e1c2b4a1a9f3dc8d9",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"readWorkIdentity\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "activeScenarioId",
    "sourceFingerprint": "fb0d7fc4691d8ae31834ef075e360c8702375dfc26c1c87f465de52a728a4899",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"readWorkIdentity\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "scenarioApplyEpoch",
    "sourceFingerprint": "af6a8af6201c2fe61ba7e567822d262335bef36e755686cf1f328bf549329c1b",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"readWorkIdentity\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "sceneGeneration",
    "sourceFingerprint": "2bf235c9b5f840ba9ecec2ace67c0ed9d69ae82c2259d97c0a22323723adde52",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"readWorkIdentity\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "scenarioDataGeneration",
    "sourceFingerprint": "3dca862c4f2c44b73ff0bf58d3a1071ea9dc7a302e4e2057b721dc5cc99855a4",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"readWorkIdentity\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "scenarioShellOverlayRevision",
    "sourceFingerprint": "9bae72d5b8e860b7837bc62904f3cc52000c63ad11abff9431a20674b9918e5f",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"readWorkIdentity\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "mapSemanticMode",
    "sourceFingerprint": "dedba2284c1c09f618491258ae375117c28f211233d4173844e317ac0873db51",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"readWorkIdentity\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "showScenarioAtlantropa",
    "sourceFingerprint": "16c3ef3c3c0c75816f5f53100e41964df06a5aafd5bb506446b2f67e116f5fce",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"readWorkIdentity\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "topologyRevision",
    "sourceFingerprint": "0ecf14fee7ec0b685d10d0eeaf49e86ad5bcf2d299ef20d8f83ce8863e46ce83",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"readWorkIdentity\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "sovereigntyRevision",
    "sourceFingerprint": "9ab5eaf06b9ffe957267fc012c1e33a69719d60b981571dfbd490192356e531b",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"readWorkIdentity\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "topologyPrimary",
    "sourceFingerprint": "7b62fcab92f25972c8a580c92365065965a9b4e87c4fd016f058604eafbda003",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"readWorkIdentity\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "topology",
    "sourceFingerprint": "3117660ebdefea088741158c7088c4dc4456ca02f1921b890792200869f9b228",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"readWorkIdentity\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "topologyDetail",
    "sourceFingerprint": "8edd070d7210a8201b16b65ba20c261acc7c4fe661a79b5e1245731ef6c9bc39",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"readWorkIdentity\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "runtimePoliticalTopology",
    "sourceFingerprint": "1f83bd9f1169e37079140e94347a0f2c8a6bd12ff6c78be4f0fe800933b4dedc",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"readWorkIdentity\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "spatialItems",
    "sourceFingerprint": "73faf5a0a54b05c91aee55dd7104e1a525e8b717e460ae87aeccf3cb80e073d6",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"readWorkIdentity\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "spatialItems",
    "sourceFingerprint": "8ddd54d0a44ca097a6c6999cce2b5f895883973a25f216fc248048beee0a5b72",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"readWorkIdentity\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "zoomTransform",
    "sourceFingerprint": "9c2442d3802414d857a242eeeea3173b8dafb50b28718c35289ec2f8e6fbc44e",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"readWorkIdentity\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "zoomTransform",
    "sourceFingerprint": "1038c4b6b76a9fdf9857c95d28c0b694b595422a82a89b80e6f6f1d8eead0182",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"readWorkIdentity\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "zoomTransform",
    "sourceFingerprint": "2aae1e1c9a9ce9151840e62dcb60bafaeabe7bebe305c419ee7457980987c02f",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"scheduleDeferredHeavyBorderMeshes\",\"ordinal\":0},{\"name\":\"runSlice\",\"ordinal\":0}]}",
    "reason": "unsupported-call-mutation",
    "operation": "unsupported",
    "key": "cachedProvinceBordersByCountry",
    "sourceFingerprint": "eb13c25ac01d1e044eced1c8217f03514e15c5cf9dc8cd6b68ca5d1e8580b5f8",
    "count": 2
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"scheduleDeferredHeavyBorderMeshes\",\"ordinal\":0},{\"name\":\"runSlice\",\"ordinal\":0}]}",
    "reason": "unsupported-call-mutation",
    "operation": "unsupported",
    "key": "cachedLocalBordersByCountry",
    "sourceFingerprint": "1bb6ba3601e9f59c00d02b34c5c73ce99d6b996d33cb4ecd62f6117e35b8321e",
    "count": 2
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"scheduleDeferredHeavyBorderMeshes\",\"ordinal\":0},{\"name\":\"runSlice\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "topologyDetail",
    "sourceFingerprint": "8edd070d7210a8201b16b65ba20c261acc7c4fe661a79b5e1245731ef6c9bc39",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"captureStaticMeshSnapshot\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "*",
    "sourceFingerprint": "e2d15361c9fc9967183d139951c46a7376f5ab0eb4c7fb900c3c6aad23915c16",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"captureStaticMeshSnapshot\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "*",
    "sourceFingerprint": "fae5b0a220e1ba8551c1e62eb6840b5ae0fa94ee63e20fbb95ad4a2bdc421176",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"captureStaticMeshSnapshot\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "*",
    "sourceFingerprint": "a6fb3c0d19791619021b29305034932a534f8d31e53b165838a0c4453bfab844",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"captureStaticMeshSnapshot\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "*",
    "sourceFingerprint": "63f218ce93822be3aaab058ab7c076f099b73b4b9f95e128aee4c6b365a8af8a",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"captureStaticMeshSnapshot\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "*",
    "sourceFingerprint": "825ba80f85d4297065e09046bc0384a76354a8cfeaa61a26cabbadaa5451a741",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"captureStaticMeshSnapshot\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "*",
    "sourceFingerprint": "2c40a63d04e06d704264f58fe99aa72ce9e0de5e06354ba48d8f67c894c6ace6",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"captureStaticMeshSnapshot\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "*",
    "sourceFingerprint": "0d7697173cbabc5239d99627f46b960710b15ae826a843fae7c14ea264963a5f",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"captureStaticMeshSnapshot\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "*",
    "sourceFingerprint": "1e31289410bd9b1203c6097d9fcbdc39ae1df7bd54a39c53c4741c3a6c01a168",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"captureStaticMeshSnapshot\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "*",
    "sourceFingerprint": "baf43bcd52a6d4a2c95551551241cea3c144cd6761681076247fed92ad5b0427",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"captureStaticMeshSnapshot\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "*",
    "sourceFingerprint": "e2545b6887e7a64ddcceee36b8287c5addb100225c3b38bbb14f9195b8aff28b",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"captureStaticMeshSnapshot\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "*",
    "sourceFingerprint": "5b86385e6a9bd09851b294c0848c9df6b6d09ae86a04231a45a7af4d752d12a1",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"captureStaticMeshSnapshot\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "*",
    "sourceFingerprint": "4562e6a3c7edb21eb3a6f0ca43d50c3ea7db9245e02f96021a5e4a1f8ce7226c",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"captureStaticMeshSnapshot\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "*",
    "sourceFingerprint": "f7f6b3760014f41fca0f05c69c6afab091f64627401e7e862336d6bc7aca0705",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"captureStaticMeshSnapshot\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "*",
    "sourceFingerprint": "be50eed3ca51bfb92932742e45d2b50002d0d255b75ad690163318ebbea67ea5",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"captureStaticMeshSnapshot\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "*",
    "sourceFingerprint": "eac58d75a6a0129a3d7115573b618b9f8ce6e57b4d2808af83ea744a770c5708",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"captureStaticMeshSnapshot\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "*",
    "sourceFingerprint": "15c766f8f3292c6614d208ceb318a9665520e65078c55aa9f2a37e4c32a319c9",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"captureStaticMeshSnapshot\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "*",
    "sourceFingerprint": "81c6ad98f8c0a688fab87b97e8b84090d38c7bea3697cffe1608de89ac407750",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"captureStaticMeshSnapshot\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "*",
    "sourceFingerprint": "91add48bde0eea8752a95375e776f975d2ebb3f5efedbea7e32e557d7e3882ea",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"captureStaticMeshSnapshot\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "*",
    "sourceFingerprint": "72454a3cc82de994e177033a54550509466ca6bd1d434acf90257f18437735ca",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"captureStaticMeshSnapshot\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "*",
    "sourceFingerprint": "89c06705d47e1d0b3974e4570e71ac9dc0dee46e07abc7c8fddf24ae80d8570a",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"captureStaticMeshSnapshot\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "*",
    "sourceFingerprint": "d5bdad7afb5df8a724d6aa1887dffb6ffbe5e6fde4c044a448f908e5a56ad7f2",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"captureStaticMeshSnapshot\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "*",
    "sourceFingerprint": "b0b72d636adba43bb381e746caa1bc0ed2419ebe88c347c3178a34c661df1e15",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"captureStaticMeshSnapshot\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "*",
    "sourceFingerprint": "bea38f6b4dc48e1a4aa8e427534a9c7c6a9f21c108f219b77d81dec03465b226",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"captureStaticMeshSnapshot\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "*",
    "sourceFingerprint": "b5feceb5a7ac93a98242080a915c121048555e3f6e6f1ecd73166679c84eb0f4",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"captureStaticMeshSnapshot\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "*",
    "sourceFingerprint": "9d717940f9d071e66573cf3e6c6bbdbf2d9e96682bf0e0e2ae3a391c7f6a0f21",
    "count": 1
  },
  {
    "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createStaticBorderMeshLifecycle\",\"ordinal\":0},{\"name\":\"captureStaticMeshSnapshot\",\"ordinal\":0}]}",
    "reason": "state-alias-escape",
    "operation": "unsupported",
    "key": "*",
    "sourceFingerprint": "ee3344eb18c023daf909ce520e9faa321ce12f1acc572addf5c3bbfd82e8ff32",
    "count": 1
  }
],
  "reviewedReadSiteFingerprints": [
  "4748641712fb9fd6252f78436ca751283b64ab94f9782d067277c8470567e601",
  "eb13c25ac01d1e044eced1c8217f03514e15c5cf9dc8cd6b68ca5d1e8580b5f8",
  "1bb6ba3601e9f59c00d02b34c5c73ce99d6b996d33cb4ecd62f6117e35b8321e"
]
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/renderer/transient_overlay_render_owner.js",
  "functionName": "createTransientOverlayRenderOwner",
  "importedArgumentCount": 2,
  "targetParameterName": "runtimeState",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "sourceFingerprint": "ae07580ea25d02255a0bc0d939977f3c7896f0620d5c6fac971093cc36b92e86",
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createTransientOverlayRenderOwner\",\"ordinal\":0},{\"name\":\"renderSpecialZoneEditorOverlay\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "1ec216c8af482ac8b5d362130e5e62a5228d33dee5bda2ad24a509b7e79339c0",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createTransientOverlayRenderOwner\",\"ordinal\":0},{\"name\":\"renderSpecialZoneEditorOverlay\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "da9d870e98d2a1c36b0136c32a26aa413e9989d6b80758f15ed0f7fb4ab748cd",
      "count": 2
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createTransientOverlayRenderOwner\",\"ordinal\":0},{\"name\":\"renderSpecialZoneEditorOverlay\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "860be45182390b0a5ad50394e0c2b9f1ddf7772170cc2624534a7f3be15f11ae",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createTransientOverlayRenderOwner\",\"ordinal\":0},{\"name\":\"renderSpecialZoneEditorOverlay\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "eb0680818fdc18f742006d48f1827ec7b70cffd8d0bbfdf9f0b899dd947ae4bf",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createTransientOverlayRenderOwner\",\"ordinal\":0},{\"name\":\"renderSpecialZoneEditorOverlay\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "63eaf64aa2d6883785345f846082280295a6d943a07fee2716fb6cb7a4d2a863",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createTransientOverlayRenderOwner\",\"ordinal\":0},{\"name\":\"renderSpecialZoneEditorOverlay\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "9f6d171bfd4bfea97b43c83b87ecf0a6c300ba4b5f8a83d02af64386b01d5e07",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createTransientOverlayRenderOwner\",\"ordinal\":0},{\"name\":\"renderSpecialZoneEditorOverlay\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "d851eb5374add303119f20881c7498839ed006453728f7052fe48a539ad51eee",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createTransientOverlayRenderOwner\",\"ordinal\":0},{\"name\":\"renderSpecialZoneEditorOverlay\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "9b43a30569690522861259390e64e06a40ed2be5b8860fbfe386cd98eacbc8f3",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createTransientOverlayRenderOwner\",\"ordinal\":0},{\"name\":\"renderSpecialZoneEditorOverlay\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "1dfff8979f55425fa63d059c4ea33fb891b018351f4a02f2702e6926217f3826",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createTransientOverlayRenderOwner\",\"ordinal\":0},{\"name\":\"renderSpecialZoneEditorOverlay\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "25e4665c61841f11a60521eb39f7135d2f5fea798e9c34d25c6fb7c4aa61db45",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createTransientOverlayRenderOwner\",\"ordinal\":0},{\"name\":\"renderSpecialZoneEditorOverlay\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "170c8d57bbd3c904eec1c4f597382e8e81d45b82e651d7ed3751da10c585aa2a",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createTransientOverlayRenderOwner\",\"ordinal\":0},{\"name\":\"renderSpecialZoneEditorOverlay\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "180b603f81687b2f76d9871deda7d7a98858dc3548e14ed0941b31b7cd5fa810",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createTransientOverlayRenderOwner\",\"ordinal\":0},{\"name\":\"renderSpecialZoneEditorOverlay\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "a5fae0d1d82d08291c160c0bc61029d5ec9b1eaf8d0eff6ee39c52a4b8455ab9",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createTransientOverlayRenderOwner\",\"ordinal\":0},{\"name\":\"renderSpecialZoneEditorOverlay\",\"ordinal\":0}]}",
      "reason": "ambiguous-alias-flow",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "777e3d6fcb79cba1cfb3e137449facb61417d0c67ee5a5b2ff310b4d9c40e814",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createTransientOverlayRenderOwner\",\"ordinal\":0},{\"name\":\"renderSpecialZoneEditorOverlay\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "d3f03be5c53786e04f4f4ab1b75bf1156a3f57442fbeed4c3bf87039d274f833",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createTransientOverlayRenderOwner\",\"ordinal\":0},{\"name\":\"renderHoverOverlay\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "specialRegionsById",
      "sourceFingerprint": "6e5cc07af3f65a2c310c5752a6be8176a7843914743d78cd080023b39d84d1f4",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createTransientOverlayRenderOwner\",\"ordinal\":0},{\"name\":\"renderHoverOverlay\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "hoveredSpecialRegionId",
      "sourceFingerprint": "18e1ca5e9f601ffd560d54762bef40bc83540eb2c07dd451fd594d24c7790834",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createTransientOverlayRenderOwner\",\"ordinal\":0},{\"name\":\"renderHoverOverlay\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "waterRegionsById",
      "sourceFingerprint": "aa89f9e45d0e6e6d90277ac6eea2a7cfb9cd4904607749417c0962a93f02823f",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createTransientOverlayRenderOwner\",\"ordinal\":0},{\"name\":\"renderHoverOverlay\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "hoveredWaterRegionId",
      "sourceFingerprint": "92f477d4bd553d571a84078255db7d005f497f3806336f745eadbf0d31008e57",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createTransientOverlayRenderOwner\",\"ordinal\":0},{\"name\":\"renderHoverOverlay\",\"ordinal\":0}]}",
      "reason": "unsupported-call-mutation",
      "operation": "unsupported",
      "key": "landIndex",
      "sourceFingerprint": "171cb83ffec7716452353e2d6e48aeb33bec078e9aad010ef734a92c04ab3602",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createTransientOverlayRenderOwner\",\"ordinal\":0},{\"name\":\"renderHoverOverlay\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "hoveredId",
      "sourceFingerprint": "480716aca0ac4b1b6c73b8f237759ac1c82b9fc9896b9941a2eb15954bc31319",
      "count": 1
    }
  ],
  "reviewedReadSiteFingerprints": [
    "777e3d6fcb79cba1cfb3e137449facb61417d0c67ee5a5b2ff310b4d9c40e814",
    "d3f03be5c53786e04f4f4ab1b75bf1156a3f57442fbeed4c3bf87039d274f833",
    "6e5cc07af3f65a2c310c5752a6be8176a7843914743d78cd080023b39d84d1f4",
    "aa89f9e45d0e6e6d90277ac6eea2a7cfb9cd4904607749417c0962a93f02823f",
    "171cb83ffec7716452353e2d6e48aeb33bec078e9aad010ef734a92c04ab3602"
  ]
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/renderer/unit_counter_display_model.js",
  "functionName": "createUnitCounterDisplayModel",
  "importedArgumentCount": 2,
  "targetParameterName": "runtimeState",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "sourceFingerprint": "83de6c3a776a4554559e347e4b78908e86996925ce04dfd863b7cd6a193c7998",
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createUnitCounterDisplayModel\",\"ordinal\":0},{\"name\":\"getUnitCounterNationMeta\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "scenarioCountriesByTag",
      "sourceFingerprint": "012a725893b2fe37f85477f3a23a3cc7fa77b5e8bfdfb9daeb1636ac9ff50c26",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createUnitCounterDisplayModel\",\"ordinal\":0},{\"name\":\"getUnitCounterNationMeta\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "a518f4ab8d22a41c9ade2923b0431d3550fe0cf7b928358718fb5bfca432fc21",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createUnitCounterDisplayModel\",\"ordinal\":0},{\"name\":\"getUnitCounterNationMeta\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "9e71e85661cff9a09700506da46e649e2ad3e384993ef0088e6c5215409f8184",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createUnitCounterDisplayModel\",\"ordinal\":0},{\"name\":\"getUnitCounterNationMeta\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "82a3537ff0dbce7eec35d69edc3a189ee6f17d82f353a553f9aa96cb0be3ce89",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createUnitCounterDisplayModel\",\"ordinal\":0},{\"name\":\"getUnitCounterRenderEntries\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "efe899c74558f20b08bbc19bf0228c0c25bddb7871d80bd34ac8b33c030b3698",
      "count": 2
    }
  ],
  "reviewedReadSiteFingerprints": []
}),

  // Bundle identity is only a key into the owner-local request lease map.
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/scenario_resources.js",
  "functionName": "getOptionalLayerRequestTokens",
  "targetParameterName": "bundle",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "sourceFingerprint": "21115602fb6c6d09001e36cfcddc394d17f3b1d0f1e22516b7a1f23f003a04a7",
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"getOptionalLayerRequestTokens\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "1e6ed65d77d6364eeaed5a745ba5c4985ae2b700dd85d7cf7f027bdf294a33fc",
      "count": 3
    }
  ]
}),
  freezeStateTargetPureReaderEntry({
  "modulePath": "js/core/scenario/optional_layer_runtime.js",
  "functionName": "createScenarioOptionalLayerRuntime",
  "importedArgumentCount": 2,
  "targetParameterName": "state",
  "targetParameterIndex": 0,
  "targetParameterPath": "$",
  "sourceFingerprint": "59e459c489d1b1272c7a8bb1fc2f80c9fe82b725093ed0b20238a2315561c9fb",
  "conservativeFindings": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createScenarioOptionalLayerRuntime\",\"ordinal\":0},{\"name\":\"ensureActiveScenarioOptionalLayerLoaded\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "activeScenarioId",
      "sourceFingerprint": "7c3f07c9b2554939aa77bc94d7c6f409b41bd01549548a31573ba74e70dc603a",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createScenarioOptionalLayerRuntime\",\"ordinal\":0},{\"name\":\"ensureActiveScenarioOptionalLayerLoaded\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "scenarioBundleCacheById",
      "sourceFingerprint": "1e6ed65d77d6364eeaed5a745ba5c4985ae2b700dd85d7cf7f027bdf294a33fc",
      "count": 4
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createScenarioOptionalLayerRuntime\",\"ordinal\":0},{\"name\":\"ensureActiveScenarioOptionalLayerLoaded\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "4ba69735ca53765ed6a709edb56c6ea236b7193a3b29a6b390c346f0f4340e4e",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createScenarioOptionalLayerRuntime\",\"ordinal\":0},{\"name\":\"isScenarioOptionalLayerRequestedForVisibility\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "4ba69735ca53765ed6a709edb56c6ea236b7193a3b29a6b390c346f0f4340e4e",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createScenarioOptionalLayerRuntime\",\"ordinal\":0},{\"name\":\"ensureActiveScenarioOptionalLayersForVisibility\",\"ordinal\":0}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "activeScenarioId",
      "sourceFingerprint": "7c3f07c9b2554939aa77bc94d7c6f409b41bd01549548a31573ba74e70dc603a",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createScenarioOptionalLayerRuntime\",\"ordinal\":0},{\"name\":\"ensureActiveScenarioOptionalLayersForVisibility\",\"ordinal\":0},{\"name\":\"<anonymous>\",\"ordinal\":2}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "6f355f4c726407ce6e8fb9f1a2d56666f715d94a716136007fb929dce0b42691",
      "count": 1
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createScenarioOptionalLayerRuntime\",\"ordinal\":0},{\"name\":\"ensureActiveScenarioOptionalLayersForVisibility\",\"ordinal\":0},{\"name\":\"<anonymous>\",\"ordinal\":4}]}",
      "reason": "state-alias-escape",
      "operation": "unsupported",
      "key": "*",
      "sourceFingerprint": "6f355f4c726407ce6e8fb9f1a2d56666f715d94a716136007fb929dce0b42691",
      "count": 1
    }
  ],
  "reviewedReadSiteFingerprints": []
}),

  // Renderer read models retain live state reads; mutations remain in canonical actions.

  // Renderer read models retain live state reads; mutations remain in canonical actions.

  // Preset UI reads its target; existing injected transactions receive detached IDs/strings.
  freezeStateTargetPureReaderEntry({
    modulePath: "js/ui/sidebar/regional_preset_controller.js",
    functionName: "createRegionalPresetController",
    importedArgumentCount: 2,
    targetParameterName: "runtimeState",
    targetParameterIndex: 0,
    targetParameterPath: "$",
    sourceFingerprint: "4abc2b6fd9d5c5a818fc6bd88e4e5125f63092d359140e725124022f62304677",
    // The indexed adapter returns the detached application result; it returns no target reference.
    conservativeFindings: [

    ],
  }),
  // Query-only model: these two returns deliberately preserve borrowed metadata identity.
  freezeStateTargetPureReaderEntry({
    modulePath: "js/ui/sidebar/country_inspector_model.js",
    functionName: "createCountryInspectorModel",
    importedArgumentCount: 2,
    targetParameterName: "runtimeState",
    targetParameterIndex: 0,
    targetParameterPath: "$",
    sourceFingerprint: "5025268bdaa447224e575677424628ca5614ebb6bf9deb3ea949a2fb39aaab04",
    conservativeFindings: [
      {
        enclosingFunctionIdentity: "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createCountryInspectorModel\",\"ordinal\":0},{\"name\":\"getScenarioCountryMeta\",\"ordinal\":0}]}",
        reason: "state-alias-escape",
        operation: "unsupported",
        key: "scenarioCountriesByTag",
        sourceFingerprint: "923fe53966c6cd9343e11af776cd4b05be315ea4b200b02e4d5dfb0f929b73bf",
        count: 1
      },
      {
        enclosingFunctionIdentity: "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createCountryInspectorModel\",\"ordinal\":0},{\"name\":\"getCountryGroupingMeta\",\"ordinal\":0}]}",
        reason: "state-alias-escape",
        operation: "unsupported",
        key: "countryGroupMetaByCode",
        sourceFingerprint: "c8d46c08ad3b4f2b23b4e8531c98f48910ee89396ac3abf11b1bf096c3631691",
        count: 1
      }
    ]
  }),
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

// This projection copies layer metadata but retains land-feature references.
// The reviewed array reads below are bound to the complete import-free module.
export const STATE_IMPORTED_BORROWED_PROJECTION_CONTRACT = Object.freeze([
  Object.freeze({
    modulePath: "js/core/special_zone_layers.js",
    exportName: "buildSpecialZoneRenderFeatures",
    copiedArgumentIndex: 0,
    copiedArgumentStaticPath: "specialZoneLayers",
    borrowedArgumentIndex: 1,
    borrowedArgumentStaticPath: "landIndex",
    argumentCount: 2,
    sourceFingerprint: "81673f03c47f8a6d170556f77c46751fa57be76127db595f7c5060b014d6e82f",
    reviewedReadCallFingerprints: Object.freeze([
      "9d62a2b7dca715130713cf46489d48e7e16f6becc75c6de122cd96cfd2d0913a",
      "aff4d257027d21f7914af6ce20680d07adc77a6f91b233e70c2961a22e5afd81",
      "a24026f928ff0ea718538d86e9a7fb4b76ee3fe647db65bc361583b6705baa4a",
      "ca4b21de6fbbe1959898efd6d45a62779dbc2d20494d89d7afe7ffb94b525f0e",
      "970d4885184c911328b86350bd4a4a08851f643923888d8929c29d69f630ce5d",
    ]),
  }),
]);

export function findStateImportedBorrowedProjectionContractEntry(modulePath, exportName) {
  return STATE_IMPORTED_BORROWED_PROJECTION_CONTRACT.find((entry) => (
    entry.modulePath === normalizeModulePath(modulePath) && entry.exportName === exportName
  )) || null;
}

export function inspectStateImportedBorrowedProjectionSource(source, entry) {
  const violations = [];
  const fail = (reason, details = {}) => violations.push({ code: "state-imported-borrowed-projection-" + reason, ...details });
  if (!entry || entry.argumentCount !== 2 || entry.copiedArgumentIndex !== 0
    || entry.borrowedArgumentIndex !== 1
    || !/^[a-f0-9]{64}$/.test(entry.sourceFingerprint || "")
    || !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(entry.copiedArgumentStaticPath || "")
    || !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(entry.borrowedArgumentStaticPath || "")
    || !Array.isArray(entry.reviewedReadCallFingerprints)
    || new Set(entry.reviewedReadCallFingerprints).size !== entry.reviewedReadCallFingerprints.length
    || entry.reviewedReadCallFingerprints.some((value) => !/^[a-f0-9]{64}$/.test(value))) {
    fail("contract-invalid");
    return { violations };
  }
  const normalized = String(source).replaceAll("\r\n", "\n");
  if (createHash("sha256").update(normalized).digest("hex") !== entry.sourceFingerprint) fail("source-drift");
  let ast;
  try { ast = parseModuleSource(normalized); } catch { fail("parse-failed"); return { violations }; }
  walkSyntaxTree(ast, (node) => {
    if (node.type === "ImportDeclaration" || node.type === "ImportExpression" || node.source) fail("import-forbidden");
  });
  const fn = topLevelFunctionDeclarations(ast).get(entry.exportName);
  const exported = ast.body.some((node) => node.type === "ExportNamedDeclaration" && (
    node.declaration?.id?.name === entry.exportName
    || node.specifiers?.some((spec) => spec.exported?.name === entry.exportName && spec.local?.name === entry.exportName)
  ));
  if (!exported || !fn || fn.params?.[entry.copiedArgumentIndex]?.type !== "Identifier") {
    fail("export-invalid"); return { violations };
  }
  const reads = new Set(entry.reviewedReadCallFingerprints);
  const seen = new Set();
  for (const node of collectReachableTaintedHazardSites({ ast, rootFunction: fn, taintedParameterIndexes: [entry.copiedArgumentIndex] })) {
    const fingerprint = fingerprintFunctionSource(normalized, node);
    if (node.type !== "CallExpression" || !reads.has(fingerprint)) fail("input-hazard", { line: node.loc?.start.line, fingerprint });
    else seen.add(fingerprint);
  }
  if (seen.size !== reads.size) fail("reviewed-read-drift");
  return { violations };
}

function freezeStateDetachedCaptureEntry({
  modulePath,
  exportName,
  targetArgumentIndex = 0,
  targetArgumentStaticPath = "",
  sourceFingerprint,
  cloneHelperFingerprints = {},
  readHelperFingerprints = {},
} = {}) {
  return Object.freeze({
    modulePath: normalizeModulePath(modulePath),
    exportName: String(exportName || ""),
    targetArgumentIndex: Number(targetArgumentIndex),
    targetArgumentStaticPath: String(targetArgumentStaticPath || ""),
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
const SPECIAL_ZONE_DETACHED_CLONE_HELPERS = Object.freeze({
  normalizeSpecialZoneLayersState:
    "b9ed5eb75af3d1cc9f573429472ec8fc289de74a3d0b10af9e6d6a5698ff3092",
});
const SPECIAL_ZONE_SAVE_REQUEST_DETACHED_CLONE_HELPERS = Object.freeze({
  serializeSpecialZoneLayersState:
    "d66a2b978f9e70f1b4c7d00d7b7ecdd51419688c84a9acbec55e020ecb31f7a3",
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
  freezeStateDetachedCaptureEntry({
    modulePath: "js/core/special_zone_layers.js",
    exportName: "serializeSpecialZoneLayersState",
    targetArgumentIndex: 0,
    targetArgumentStaticPath: "specialZoneLayers",
    sourceFingerprint:
      "d66a2b978f9e70f1b4c7d00d7b7ecdd51419688c84a9acbec55e020ecb31f7a3",
    cloneHelperFingerprints: SPECIAL_ZONE_DETACHED_CLONE_HELPERS,
  }),
  freezeStateDetachedCaptureEntry({
    modulePath: "js/core/special_zone_layers.js",
    exportName: "captureScenarioLayerSaveRequestState",
    targetArgumentIndex: 0,
    sourceFingerprint:
      "1fdcf4a1df2f1bc9ce9da6e8d2d5d5d19eeb28dcc2daf58031454503ad8fa983",
    cloneHelperFingerprints:
      SPECIAL_ZONE_SAVE_REQUEST_DETACHED_CLONE_HELPERS,
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
      || (
        entry.targetArgumentStaticPath
        && !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(
          String(entry.targetArgumentStaticPath),
        )
      )
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
    factoryStateArgumentShape: String(entry.factoryStateArgumentShape || "object"),
    methods: Object.freeze([...(entry.methods || [])].map(String)),
    borrowedCallbackMethods: Object.freeze([...(entry.borrowedCallbackMethods || [])].map(String)),
    borrowedForwarders: Object.freeze((entry.borrowedForwarders || []).map(forwarder => Object.freeze({ ...forwarder }))),
    borrowedLocalStorage: Object.freeze((entry.borrowedLocalStorage || []).map(storage => Object.freeze({
      functionName: String(storage.functionName), bindingName: String(storage.bindingName),
      paths: Object.freeze(storage.paths.map(path => Object.freeze([...path]))),
    }))),
    borrowedLocalParameterIndexes: Object.freeze(Object.fromEntries(
      Object.entries(entry.borrowedLocalParameterIndexes || {}).map(([name, indexes]) => [name, Object.freeze([...indexes])]),
    )),
    borrowedMapReadResultPaths: Object.freeze(Object.fromEntries(
      Object.entries(entry.borrowedMapReadResultPaths || {}).map(([name, paths]) => [name, Object.freeze(paths.map(path => Object.freeze([...path])))]),
    )),
    borrowedMethodArgumentIndexes: Object.freeze(Object.fromEntries(
      Object.entries(entry.borrowedMethodArgumentIndexes || {}).map(([name, indexes]) => [name, Object.freeze([...indexes])]),
    )),
    borrowedResultPathsByMethod: Object.freeze(Object.fromEntries(
      Object.entries(entry.borrowedResultPathsByMethod || {}).map(([method, paths]) =>
        [method, Object.freeze(paths.map(path => Object.freeze([...path])))]),
    )),
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
  "compositionModulePath": "js/core/map_renderer.js",
  "compositionExportName": "getCityLightsRenderOwner",
  "compositionSourceFingerprint": "ece72a38a9c38c2ad7221d89d793996bd228eb78da01fa80770196fc4f2e0709",
  "factoryModulePath": "js/core/renderer/city_lights_render_owner.js",
  "factoryExportName": "createCityLightsRenderOwner",
  "borrowedLocalParameterIndexes": { "getUrbanLightWeight": [0], "sampleModernCityLightsGridNormalized": [0, 1], "getModernPopulationCoreGain": [0] },
  "borrowedMapReadResultPaths": { "getModernPopulationCoreGain": [["feature"], ["urbanFeature"]] },
  "factorySourceFingerprint": "fd86667f1243909ec3db5cecb4a4d2abbd0ccc88fa85613d0278eac1c0a4a512",
  "ownerBindingName": "cityLightsRenderOwner",
  "methods": [
    "toRgbaString",
    "getSignedHashUnit",
    "drawNightLightsLayer",
    "collectModernUrbanCoreEntries",
    "getModernCityLightsPopulationBoostData"
  ],
  "borrowedResultPathsByMethod": {
    "collectModernUrbanCoreEntries": [
      [
        "*",
        "feature"
      ]
    ],
    "getModernCityLightsPopulationBoostData": [
      [
        "cityCollection"
      ],
      [
        "urbanCollection"
      ],
      [
        "urbanEntries",
        "*",
        "urbanFeature"
      ],
      [
        "cityEntries",
        "*",
        "feature"
      ],
      [
        "urbanByFeature"
      ],
      [
        "cityByFeature"
      ]
    ]
  },
  "borrowedLocalStorage": [
    {
      "functionName": "createCityLightsRenderOwner",
      "bindingName": "modernCityLightsPopulationBoostCache",
      "paths": [
        [
          "cityCollection"
        ],
        [
          "urbanCollection"
        ],
        [
          "urbanEntries",
          "*",
          "urbanFeature"
        ],
        [
          "cityEntries",
          "*",
          "feature"
        ],
        [
          "urbanByFeature"
        ],
        [
          "cityByFeature"
        ]
      ]
    },
    {
      "functionName": "collectModernUrbanCoreEntries",
      "bindingName": "entries",
      "paths": [
        [
          "*",
          "feature"
        ]
      ]
    }
  ],
  "actionExports": []
}),
  freezeMutationDelegatingOwnerEntry({
  "compositionModulePath": "js/core/map_renderer.js",
  "compositionExportName": "getProjectedGeographicPathCache",
  "compositionSourceFingerprint": "f167e4ade4c631ca23d0af8a7c0ac5ccc6ccc4216884f284dd339027591a94b3",
  "factoryModulePath": "js/core/renderer/projected_geographic_path_cache.js",
  "factoryExportName": "createProjectedGeographicPathCache",
  "borrowedMethodArgumentIndexes": { "getPath": [0] },
  "factorySourceFingerprint": "5b27591435f382eabd0914b628c7673afb3a1df896a1be9fa767a2dbde4f5d36",
  "ownerBindingName": "geographicPathCache",
  "methods": [
    "getPath",
    "reset",
    "getStats"
  ],
  "actionExports": []
}),
  freezeMutationDelegatingOwnerEntry({
  "compositionModulePath": "js/core/map_renderer.js",
  "compositionExportName": "getProjectedGeometryBoundsOwner",
  "compositionSourceFingerprint": "be3626f7615bac4bd30a6cca1405f2200326a8e06c3e74c5ce3f4f5e4b49d18d",
  "factoryModulePath": "js/core/renderer/projected_geometry_bounds_owner.js",
  "factoryExportName": "createProjectedGeometryBoundsOwner",
  "factorySourceFingerprint": "1388d77514bd2874a9650ca936c567fdab494f70db243a3de34298a312c9cabf",
  "ownerBindingName": "projectedGeometryBoundsOwner",
  "methods": [
    "computeProjectedCoordinateBounds",
    "computeProjectedGeoBounds",
    "computeProjectedFeatureBounds",
    "getProjectedFeatureBounds",
    "rebuildProjectedBoundsCache",
    "clearProjectedBoundsCache",
    "recordProjectedBoundsDiagnostic",
    "mergeProjectedBounds",
    "normalizeGeoObjectForSphericalDiagnostics",
    "getSphericalGeometryDiagnostics",
    "isSphericalGeometryUnsafe",
    "collectPolygonalGeometryParts",
    "collectFeatureHitGeometries",
    "buildWaterRegionFeatureFromParts",
    "collectSafeWaterRegionGeometryPartsInfo",
    "collectSafeWaterRegionGeometryParts",
    "shouldExcludeWaterHitGeometry",
    "sanitizeWaterRegionFeature",
    "sanitizeWaterRegionFeatures"
  ],
  "actionExports": []
}),
  freezeMutationDelegatingOwnerEntry({
  "compositionModulePath": "js/core/map_renderer.js",
  "compositionExportName": "getBorderMeshOwner",
  "compositionSourceFingerprint": "b360c481d93c118b5ac7d3f022711429915cd3926bd8e01f7b719f0c3bd0eb56",
  "factoryModulePath": "js/core/renderer/border_mesh_owner.js",
  "factoryExportName": "createBorderMeshOwner",
  "borrowedMethodArgumentIndexes": { "buildSourceBorderMeshes": [0] },
  "factorySourceFingerprint": "4f6b2d8b9dd8cd03c4f37f3d328100b603dbd2d721f8f9c34bbf2ab8bab73189",
  "ownerBindingName": "borderMeshOwner",
  "borrowedLocalStorage": [
    { "functionName": "resolveCoastlineTopologySource", "bindingName": "publishedDecision", "paths": [["topology"]] },
    { "functionName": "createBorderMeshOwner", "bindingName": "scenarioCoastlineSourceCache", "paths": [["primaryRef"], ["runtimeRef"], ["decision", "topology"]] },
    { "functionName": "createBorderMeshOwner", "bindingName": "coastlineMeshCache", "paths": [["topology"], ["object"], ["arcs"], ["transform"]] }
  ],
  "borrowedResultPathsByMethod": { "resolveCoastlineTopologySource": [["topology"]] },
  "borrowedForwarders": [{ "functionName": "resolveCoastlineTopologySource", "methodName": "resolveCoastlineTopologySource", "restParameterName": "args", "sourceFingerprint": "cf319f3867f517341d11096caca2b85c53d47e43ecd3a5cb8e442dd842f312b1" }],
  "methods": [
    "clearPendingDynamicBorderTimer",
    "markDynamicBordersDirty",
    "recomputeDynamicBordersNow",
    "scheduleDynamicBorderRecompute",
    "replaceDetailAdmBorders",
    "reconcileDetailAdmBorders",
    "buildOwnerBorderMesh",
    "buildDynamicOwnerBorderMesh",
    "countUnresolvedOwnerBorderEntities",
    "rebuildDynamicBorders",
    "refreshScenarioOpeningOwnerBorders",
    "getFrontlineOwnershipContext",
    "getFrontlineMesh",
    "buildDetailAdmBorderMesh",
    "getSourceCountrySets",
    "buildCountryParentBorderMeshes",
    "buildSourceBorderMeshes",
    "buildGlobalCountryBorderMesh",
    "resolveCoastlineTopologySource",
    "buildGlobalCoastlineMesh",
    "simplifyCoastlineMesh",
    "ensureCoastlineMeshes"
  ],
  "actionExports": []
}),
  freezeMutationDelegatingOwnerEntry({
  "compositionModulePath": "js/core/renderer/render_cache_owner.js",
  "compositionExportName": "composeRenderCacheValidationScope",
  "compositionSourceFingerprint": "2d626d537dfb0e7299edc0bc01fd5a8e58a3a6fa547186acb993b3bd6bf8117d",
  "factoryModulePath": "js/core/renderer/render_cache_validation_scope.js",
  "factoryExportName": "createRenderCacheValidationScope",
  "factorySourceFingerprint": "95d9df40a1173007d44b1028949687e33f8bb90c3e7a79ba6ac195be3e9b1374",
  "ownerBindingName": "owner",
  "methods": [
    "getRenderPassCacheState",
    "withValidatedCache"
  ],
  "borrowedCallbackMethods": ["withValidatedCache"],
  "actionExports": []
}),
  freezeMutationDelegatingOwnerEntry({
  "compositionModulePath": "js/core/map_renderer.js",
  "compositionExportName": "composeUrbanLayerRenderOwner",
  "compositionSourceFingerprint": "971ae110867c1a3eeec5f3abeef0dfc9a57f9736cf8f63e45b1a240963054273",
  "factoryModulePath": "js/core/renderer/urban_layer_render_owner.js",
  "factoryExportName": "createUrbanLayerRenderOwner",
  "factorySourceFingerprint": "6388b3a7cefe0a8f0c704d9ad4f61a79e8875dc3f6bad3c53e15e131a9fd9259",
  "ownerBindingName": "owner",
  "methods": [
    "drawUrbanLayer"
  ],
  "actionExports": []
}),
  freezeMutationDelegatingOwnerEntry({
  "compositionModulePath": "js/core/map_renderer.js",
  "compositionExportName": "getGeometryRasterRuntimeOwner",
  "compositionSourceFingerprint": "271dbebae1d8548034ad5500028658f5323b7f9384a1151f2e981f8b582181bb",
  "factoryModulePath": "js/core/renderer/geometry_raster_runtime_owner.js",
  "factoryExportName": "createGeometryRasterRuntimeOwner",
  "factorySourceFingerprint": "7f01b321f177d5d2c97c138b26d4f6ad0d0360e309c96a03b6ac434170fa40b2",
  "ownerBindingName": "geometryRasterRuntimeOwner",
  "methods": [
    "prepareFrame",
    "preparePolitical",
    "drawPolitical",
    "requestHit",
    "getPendingWorkCount",
    "dispose"
  ],
  "actionExports": []
}),
  freezeMutationDelegatingOwnerEntry({
  "compositionModulePath": "js/core/map_renderer.js",
  "compositionExportName": "getCountryFillPaletteOwner",
  "compositionSourceFingerprint": "c1edcf2c21d37a2ac060117ce87da725133f55970f699bf0184377624ecb642b",
  "factoryModulePath": "js/core/renderer/country_fill_palette_owner.js",
  "factoryExportName": "createCountryFillPaletteOwner",
  "factorySourceFingerprint": "d5454207020ed553ab9f1b4c3f50b976a7200d3e09c886a9124a60b537608d78",
  "ownerBindingName": "countryFillPaletteOwner",
  "methods": [
    "getDominantFillColorMap",
    "notifyColorsChanged",
    "getAppearanceRevision",
    "invalidate"
  ],
  "actionExports": []
}),
  freezeMutationDelegatingOwnerEntry({
  "compositionModulePath": "js/ui/toolbar.js",
  "compositionExportName": "composePaletteLibraryOperation",
  "compositionSourceFingerprint": "e8b7d5c5849ad686a3418987f1ec670bcef127375172f10c847cae87013f6a70",
  "factoryModulePath": "js/core/palette_library_state_access.js",
  "factoryExportName": "createPaletteLibraryStateAccess",
  "factoryStateArgumentShape": "target",
  "factorySourceFingerprint": "b07ddf91f7ebbc6d39c1f425a1710dfad82bf859a61abcbd158356b3fc7a8374",
  "ownerBindingName": "stateAccess",
  "methods": [
    "getApplyTarget",
    "getOwnerFeatureIds",
    "applyFeatureColor",
    "applyOwnerColor"
  ],
  "actionExports": []
}),
  freezeMutationDelegatingOwnerEntry({
  "compositionModulePath": "js/core/map_renderer.js",
  "compositionExportName": "getBorderMeshWorkerRuntime",
  "compositionSourceFingerprint": "8117f1ddc2f82c4ec3b744f6db069a537749df9679e0e163f4e4365ca7f2845d",
  "factoryModulePath": "js/core/renderer/border_mesh_worker_runtime.js",
  "factoryExportName": "createBorderMeshWorkerRuntime",
  "factorySourceFingerprint": "80f665798376a2a4d6becace1f5092f602a59a0177990900095b7c618ac0b436",
  "ownerBindingName": "borderMeshWorkerRuntime",
  "methods": [
    "buildDeferredBorderMeshesAsync",
    "commitDeferredBorderMeshes",
    "dispose"
  ],
  "actionExports": []
}),
freezeMutationDelegatingOwnerEntry({
  "compositionModulePath": "js/core/map_renderer.js",
  "compositionExportName": "getVisibleFrameDiagnosticsOwner",
  "compositionSourceFingerprint": "053e296fd24239f313455cdf6e6972e07146356a72d13b1e565d186f343cbb0a",
  "factoryModulePath": "js/core/renderer/visible_frame_diagnostics_owner.js",
  "factoryExportName": "createVisibleFrameDiagnosticsOwner",
  "factorySourceFingerprint": "9f0befd8fd36469c6f45f51ff21a93a007c03165ce92fcaca269221be2e32385",
  "ownerBindingName": "visibleFrameDiagnosticsOwner",
  "methods": [
    "recordVisibleFrameTransaction",
    "recordFirstVisibleFrameBlocked",
    "markFirstVisibleFramePainted",
    "resetFirstVisibleFramePainted"
  ],
  "actionExports": []
}),
freezeMutationDelegatingOwnerEntry({
  "compositionModulePath": "js/core/map_renderer.js",
  "compositionExportName": "composePhysicalIntensityInteractionOwner",
  "compositionSourceFingerprint": "34e3c2904fa042f7bacbbb51e79ff25e9a8067788ca4b4d5f553c5e72497fc8b",
  "factoryModulePath": "js/core/renderer/physical_intensity_interaction_owner.js",
  "factoryExportName": "createPhysicalIntensityInteractionOwner",
  "factorySourceFingerprint": "a9b2b2a5b8da55bbbd27bdb4d212483b71b507169f45a1c4d9970264868c7153",
  "ownerBindingName": "owner",
  "methods": [
    "handlePhysicalIntensityPointerDown",
    "handlePhysicalIntensityPointerMove",
    "handlePhysicalIntensityPointerEnd"
  ],
  "actionExports": []
}),
freezeMutationDelegatingOwnerEntry({
  "compositionModulePath": "js/core/map_renderer.js",
  "compositionExportName": "getPixelRatioPolicy",
  "compositionSourceFingerprint": "466362d23f7fa54eaf838f3a038fb8e60ef1716d832d3989c54fdfbf8300ab24",
  "factoryModulePath": "js/core/renderer/pixel_ratio_policy.js",
  "factoryExportName": "createPixelRatioPolicy",
  "factorySourceFingerprint": "562da86ec29a16d6dabb1be5d875ded0f0b8638e143517dfe5c2d0892d3bf400",
  "ownerBindingName": "pixelRatioPolicy",
  "methods": [
    "getMaxDprForProfile",
    "updateDprStage"
  ],
  "actionExports": []
}),
freezeMutationDelegatingOwnerEntry({
  "compositionModulePath": "js/core/map_renderer.js",
  "compositionExportName": "recordProjectedBoundsDiagnosticsState",
  "compositionSourceFingerprint": "4c304da4acd6feef8e3d4abdd08945cbd1969f2816aac54570c7134f19fb04d7",
  "factoryModulePath": "js/core/renderer/projected_bounds_diagnostics_owner.js",
  "factoryExportName": "createProjectedBoundsDiagnosticsOwner",
  "factorySourceFingerprint": "f4b56295e387f224826937d1a97d91fc3694d43673a20d6dadc403c90bd48bf5",
  "ownerBindingName": "projectedBoundsDiagnosticsOwner",
  "methods": [
    "recordProjectedBoundsDiagnosticsState"
  ],
  "actionExports": []
}),
  freezeMutationDelegatingOwnerEntry({
  "compositionModulePath": "js/core/scenario/chunk_runtime.js",
  "compositionExportName": "composeScenarioChunkPayloadLoader",
  "compositionSourceFingerprint": "506a3145b37deb016c6193c09371f6fc0dadc6c146234ee57fa19ac3eb39c7f4",
  "factoryModulePath": "js/core/scenario/chunk_payload_loader.js",
  "factoryExportName": "createScenarioChunkPayloadLoader",
  "factorySourceFingerprint": "872d1eca77a7db583222abf4a316c630141372121c7a19ecfb49fd58792fbeef",
  "ownerBindingName": "owner",
  "methods": [
    "loadScenarioChunkPayload",
    "loadScenarioChunkPayloadEntries",
    "resetScenarioChunkRequests"
  ],
  "actionExports": []
}),
  // Composition receipts keep callable owner interfaces distinct from state data.
  freezeMutationDelegatingOwnerEntry({
  "compositionModulePath": "js/core/map_renderer.js",
  "compositionExportName": "composeCityLabelTextModel",
  "compositionSourceFingerprint": "bc6d83e78976b4dae096897ab3c09bddd93c44c8830eed2c1153d415ab13a2bd",
  "factoryModulePath": "js/core/renderer/city_label_text_model.js",
  "factoryExportName": "createCityLabelTextModel",
  "factorySourceFingerprint": "453d6c8856513622143f405f0317fc1dffdf101cf53367a1cfb52f20fe8ea3ce",
  "ownerBindingName": "owner",
  "methods": [
    "getCityFeatureKey",
    "getCityFeatureAliases",
    "getCityDisplayLabel",
    "formatCityMapLabel"
  ],
  "actionExports": []
}),
  freezeMutationDelegatingOwnerEntry({
  "compositionModulePath": "js/core/map_renderer.js",
  "compositionExportName": "composePoliticalFeaturePolicy",
  "compositionSourceFingerprint": "d0b7a2baa68d42144def1e2946ba81c74880c6eb51972371af444b579e79313f",
  "factoryModulePath": "js/core/renderer/political_feature_policy.js",
  "factoryExportName": "createPoliticalFeaturePolicy",
  "factorySourceFingerprint": "9647ef9584d488e38920674d9ebab5bc099b59f631c31dafdf635205530b76a9",
  "ownerBindingName": "owner",
  "methods": [
    "isScenarioShellFeature",
    "hasVisiblePoliticalForegroundColorOverride",
    "orderPoliticalShellUnderlayFirst",
    "shouldExcludeRuntimeOnlyShellFallbackPoliticalFeature",
    "getAtlantropaGeometryRole",
    "getAtlantropaJoinMode",
    "isAntarcticSectorFeature",
    "shouldExcludePoliticalVisualFeature",
    "isPoliticalInteractionRenderableFeature",
    "shouldExcludePoliticalInteractionFeature"
  ],
  "actionExports": []
}),
  freezeMutationDelegatingOwnerEntry({
  "compositionModulePath": "js/core/map_renderer.js",
  "compositionExportName": "composePhysicalIntensityPreviewOwner",
  "compositionSourceFingerprint": "a1fd2c1f62ecc0fad5cf2ae0dcf39059607588d34b89a2144b280a0aab72f2d1",
  "factoryModulePath": "js/core/renderer/physical_intensity_preview_owner.js",
  "factoryExportName": "createPhysicalIntensityPreviewOwner",
  "factorySourceFingerprint": "f1785aa7513397801118f9b489d1656cd6e02e3756330b52b082394d8e06f6b2",
  "ownerBindingName": "owner",
  "methods": [
    "getMapLonLatFromEvent",
    "projectGeoToScreen",
    "hidePhysicalIntensityBrushPreview",
    "renderPhysicalIntensityBrushPreview",
    "updatePhysicalIntensityBrushPreviewFromEvent",
    "getPhysicalIntensityPointHit"
  ],
  "actionExports": []
}),
  freezeMutationDelegatingOwnerEntry({
  "compositionModulePath": "js/core/map_renderer.js",
  "compositionExportName": "composePoliticalPathCacheOwner",
  "compositionSourceFingerprint": "cf4648c87226489ac0cbd8d94197dba295482737cd2ba535ef1d75aad98948b1",
  "factoryModulePath": "js/core/renderer/political_path_cache_owner.js",
  "factoryExportName": "createPoliticalPathCacheOwner",
  "factorySourceFingerprint": "c451d541f0d567309f5f0f71f97c5274f5052cd92c4cf28996446f2e17972891",
  "ownerBindingName": "owner",
  "methods": [
    "getPoliticalPathCacheSignature",
    "cancelPoliticalPathWarmup",
    "invalidatePoliticalPathCache",
    "getPoliticalPathCacheHandle",
    "getPoliticalFeaturePathEntry",
    "isPoliticalFeaturePathEntryCurrent",
    "schedulePoliticalPathWarmup"
  ],
  "borrowedResultPathsByMethod": {
    "getPoliticalPathCacheHandle": [["cache"], ["map"]],
    "getPoliticalFeaturePathEntry": [["geometryRef"]]
  },
  "actionExports": []
}),
  freezeMutationDelegatingOwnerEntry({
  "compositionModulePath": "js/core/map_renderer.js",
  "compositionExportName": "composeBrushInteractionSessionOwner",
  "compositionSourceFingerprint": "29330f19625cc92158ee8d91c7c9cfec930d86b21da42575427cc52ec25dc354",
  "factoryModulePath": "js/core/renderer/brush_interaction_session_owner.js",
  "factoryExportName": "createBrushInteractionSessionOwner",
  "factorySourceFingerprint": "fc2e1d1ed5a96512a40bea2b7b1aa80c2d76ebbcf82b643dacfeffabb3952da0",
  "ownerBindingName": "owner",
  "methods": [
    "flushBrushSession",
    "flushSpecialZoneMembershipDragSession",
    "handleBrushPointerDown",
    "handleBrushPointerMove"
  ],
  "actionExports": []
}),
  freezeMutationDelegatingOwnerEntry({
  "compositionModulePath": "js/core/map_renderer.js",
  "compositionExportName": "getCityPaintStyleModel",
  "compositionSourceFingerprint": "688e2307ffefb2e587b175ac8fe1f4425af25d790104d1b028a34eb3a9504f07",
  "factoryModulePath": "js/core/renderer/city_paint_style_model.js",
  "factoryExportName": "createCityPaintStyleModel",
  "factorySourceFingerprint": "f71945637e83848b11df931adfc59d5f3e3902aec0a839007e2dcd6a27642084",
  "ownerBindingName": "cityPaintStyleModel",
  "methods": [
    "getCityLabelRenderStyle",
    "getCityMarkerRenderStyle"
  ],
  "actionExports": []
}),
  freezeMutationDelegatingOwnerEntry({
  "compositionModulePath": "js/core/map_renderer.js",
  "compositionExportName": "composeUrbanAdaptivePaintModel",
  "compositionSourceFingerprint": "d61dcb9e056c84418d3ae71e864add8ca2bb05d9d6fc66f3c6ae551b0507a088",
  "factoryModulePath": "js/core/renderer/urban_adaptive_paint_model.js",
  "factoryExportName": "createUrbanAdaptivePaintModel",
  "factorySourceFingerprint": "fe268dcce895261da021e818431ea2ba166d5750fbc2162296a1b65f806137ce",
  "ownerBindingName": "owner",
  "methods": [
    "computeUrbanAdaptivePaintFromHostColor",
    "getUrbanAdaptivePaint",
    "getEffectiveUrbanMode",
    "createDrawPaintResolver"
  ],
  "actionExports": []
}),
  freezeMutationDelegatingOwnerEntry({
  "compositionModulePath": "js/core/map_renderer.js",
  "compositionExportName": "getOperationGraphicsEditorRenderOwner",
  "compositionSourceFingerprint": "62f126b231771d327eb0b9b12b0e65f0ea267b7b811d7c813ff68a5ab721eed2",
  "factoryModulePath": "js/core/renderer/operation_graphics_editor_render_owner.js",
  "factoryExportName": "createOperationGraphicsEditorRenderOwner",
  "factorySourceFingerprint": "015a8f1dcfeda3376b1a0e6be49f2dc8e4a48dbdb33dd7ed11622d37ea8314c3",
  "ownerBindingName": "operationGraphicsEditorRenderOwner",
  "methods": [
    "renderOperationGraphicsEditorOverlay"
  ],
  "actionExports": []
}),
  freezeMutationDelegatingOwnerEntry({
  "compositionModulePath": "js/core/map_renderer.js",
  "compositionExportName": "getScenarioRegionOverlayRenderOwner",
  "compositionSourceFingerprint": "7e65d0dbae48519b822d257b396121ee0cb5194ecd403b77237f8a43cc66bc7b",
  "factoryModulePath": "js/core/renderer/scenario_region_overlay_render_owner.js",
  "factoryExportName": "createScenarioRegionOverlayRenderOwner",
  "factorySourceFingerprint": "f9e236ec7300fb094535764db2eea2efa6fe2514d0fffed94fce8ba530d01387",
  "ownerBindingName": "scenarioRegionOverlayRenderOwner",
  "methods": [
    "drawScenarioRegionOverlaysPass",
    "getScenarioWaterPartBounds",
    "resetWaterPathCaches",
    "getPreviousWaterRenderedCount",
    "resetPreviousWaterRenderedCount"
  ],
  "actionExports": []
}),
  freezeMutationDelegatingOwnerEntry({
  "compositionModulePath": "js/core/map_renderer.js",
  "compositionExportName": "getStaticBorderMeshLifecycle",
  "compositionSourceFingerprint": "ea3ea276be7d700ec93c23d12555eb1bc7173739271917c2d598cec594f4f549",
  "factoryModulePath": "js/core/renderer/static_border_mesh_lifecycle.js",
  "factoryExportName": "createStaticBorderMeshLifecycle",
  "factorySourceFingerprint": "676eb69ead980e86e9fabc6c9a71b517050bfa8f5c80e639266210148097619b",
  "ownerBindingName": "staticBorderMeshLifecycle",
  "methods": [
    "buildDetailAdmMeshSignature",
    "getVisibleCountryCodesForBorderMeshes",
    "cancelDeferredHeavyBorderMeshes",
    "scheduleDeferredHeavyBorderMeshes",
    "captureStaticMeshSnapshot",
    "resetVisibleCountryCodesCache"
  ],
  "actionExports": []
}),
  freezeMutationDelegatingOwnerEntry({
  "compositionModulePath": "js/core/map_renderer.js",
  "compositionExportName": "getTransientOverlayRenderOwner",
  "compositionSourceFingerprint": "8f6bd8a66fe2079283208b0ecd2efa87b6cf2c188cfae05063d25b72d3d9ecae",
  "factoryModulePath": "js/core/renderer/transient_overlay_render_owner.js",
  "factoryExportName": "createTransientOverlayRenderOwner",
  "factorySourceFingerprint": "ae07580ea25d02255a0bc0d939977f3c7896f0620d5c6fac971093cc36b92e86",
  "ownerBindingName": "transientOverlayRenderOwner",
  "methods": [
    "renderSpecialZoneEditorOverlay",
    "renderHoverOverlay"
  ],
  "actionExports": []
}),
  freezeMutationDelegatingOwnerEntry({
  "compositionModulePath": "js/core/map_renderer.js",
  "compositionExportName": "composeUnitCounterDisplayModel",
  "compositionSourceFingerprint": "528868b43ffb081174714f2d3adf1979bb6dc52fcfc21b0f1c9d98a98298c4ba",
  "factoryModulePath": "js/core/renderer/unit_counter_display_model.js",
  "factoryExportName": "createUnitCounterDisplayModel",
  "factorySourceFingerprint": "83de6c3a776a4554559e347e4b78908e86996925ce04dfd863b7cd6a193c7998",
  "ownerBindingName": "owner",
  "methods": [
    "getUnitCounterCardModel",
    "getUnitCounterRenderEntries",
    "getUnitCounterRenderScale"
  ],
  "actionExports": []
}),
  freezeMutationDelegatingOwnerEntry({
    compositionModulePath: "js/core/map_renderer.js",
    compositionExportName: "getSelectionOverlayOwner",
    compositionSourceFingerprint: "16d01f47e724dcba2985bf46216bbe9966a730f9d6413217c3f69c2a2a49ff7f",
    factoryModulePath: "js/core/renderer/selection_overlay_owner.js",
    factoryExportName: "createSelectionOverlayOwner",
    factorySourceFingerprint: "e8df4a168e3a9479cc988f8f852e3427cf5196c0b785dc02ceffe7526d78b742",
    ownerBindingName: "selectionOverlayOwner",
    methods: ["renderDevSelectionOverlay", "renderDevSelectionOverlayIfNeeded",
      "renderInspectorHighlightOverlay", "renderInspectorHighlightOverlayIfNeeded"],
    actionExports: [],
  }),
  freezeMutationDelegatingOwnerEntry({
    compositionModulePath: "js/core/map_renderer.js",
    compositionExportName: "getViewportReadModelOwner",
    compositionSourceFingerprint: "3cc3cd9f9c84a89e117603c3bf5f3f4d2f4242837f4b00d90377f98d0aadd75c",
    factoryModulePath: "js/core/renderer/viewport_read_model_owner.js",
    factoryExportName: "createViewportReadModelOwner",
    factorySourceFingerprint: "27777745dacb10e02e3636df153a92f8b95aecaad6ed99e9a640676a64617755",
    ownerBindingName: "viewportReadModelOwner",
    methods: ["getViewportRenderSignature", "getProjectionRenderSignature", "getViewportGeoBounds",
      "calculatePanExtent", "getProjectedRenderableContentBounds", "getCenteredFitZoomTransform", "getZoomPercent"],
    actionExports: [],
  }),
  freezeMutationDelegatingOwnerEntry({
    "compositionModulePath": "js/core/map_renderer.js",
    "compositionExportName": "getRenderCacheOwner",
    "compositionSourceFingerprint": "f9e6134fee02281e43d48d388d37bcdb3b6767d7fd5f228f76d8e2b91cbacfe0",
    "factoryModulePath": "js/core/renderer/render_cache_owner.js",
    "factoryExportName": "createRenderCacheOwner",
    "factorySourceFingerprint": "f49984ba8bc21bbbe80626863ede1c04e7409ec07a632add7f638fb76cfbedb7",
    "ownerBindingName": "renderCacheOwner",
    "methods": [
      "canDrawInteractionComposite",
      "clearLastGoodFrame",
      "clearPassFullReferenceTransforms",
      "clearRenderPassReferenceTransforms",
      "ensureCompositeBufferCanvas",
      "ensureInteractionCompositeCanvas",
      "ensureLastGoodFrameCanvas",
      "ensureRenderPassCanvas",
      "getInteractionCompositeSignature",
      "getInteractionCompositeReuseDecision",
      "getPassFullReferenceTransform",
      "getPassReferenceTransform",
      "getRenderPassCacheState",
      "withValidatedCache",
      "getRenderPassLayout",
      "hasPassFullReferenceTransform",
      "invalidateAllRenderPasses",
      "invalidateInteractionComposite",
      "invalidateRenderPasses",
      "resizeRenderPassCanvases",
      "setPassFullReferenceTransform",
      "setPassReferenceTransform"
    ],
    "borrowedCallbackMethods": ["withValidatedCache"],
    "actionExports": []
  }),
  freezeMutationDelegatingOwnerEntry({
    "compositionModulePath": "js/core/map_renderer.js",
    "compositionExportName": "getViewportCommandOwner",
    "compositionSourceFingerprint": "9fd48adfda556034b5a42283ef88e988f8da94cd01afe5b13818c5e1e015b8f9",
    "factoryModulePath": "js/core/renderer/viewport_command_owner.js",
    "factoryExportName": "createViewportCommandOwner",
    "factorySourceFingerprint": "e616dc8d793563d8267a856254c0f9ec9c0d8256329fcda657207495f0e25f47",
    "ownerBindingName": "viewportCommandOwner",
    "methods": [
      "updateZoomTranslateExtent",
      "resetZoomToFit",
      "zoomByStep",
      "setZoomPercent",
      "enforceZoomConstraints"
    ],
    "actionExports": [
      "setZoomTransformState"
    ],
    "actionModulePath": "js/core/state/actions/renderer_interaction_actions.js"
  }),
  freezeMutationDelegatingOwnerEntry({
    "compositionModulePath": "js/core/map_renderer.js",
    "compositionExportName": "getViewportResizeLifecycleOwner",
    "compositionSourceFingerprint": "0344ad081f0a18865fc8e16215b9f757f6ae93c6f3ef0615ec623230df03c4aa",
    "factoryModulePath": "js/core/renderer/viewport_resize_lifecycle_owner.js",
    "factoryExportName": "createViewportResizeLifecycleOwner",
    "factorySourceFingerprint": "8715b48893089aeac645b8753eec9ce8593701cb7d1f357a666ddf897cd25ffe",
    "ownerBindingName": "viewportResizeLifecycleOwner",
    "methods": [
      "getResizeReason",
      "isInteractiveLayoutResize",
      "scheduleResizeSpatialRefresh",
      "shouldPreferFullResizeReason",
      "requestMapContainerResizeSync",
      "bindMapContainerResizeObserver",
      "getDevicePixelRatioMediaQuery",
      "unbindBrowserPixelRatioObserver",
      "bindBrowserPixelRatioObserver",
      "bindVisualViewportResizeObserver",
      "bindBrowserZoomObservers",
      "handleBrowserPixelRatioRefresh",
      "handleResize",
      "handleSidebarLayoutStart",
      "dispose"
    ],
    "actionExports": [
      "setHitCanvasDirtyState"
    ],
    "actionModulePath": "js/core/state/actions/renderer_interaction_actions.js"
  }),
  freezeMutationDelegatingOwnerEntry({
    "compositionModulePath": "js/core/map_renderer.js",
    "compositionExportName": "getZoomInteractionLifecycleOwner",
    "compositionSourceFingerprint": "77be4039f6d5b8af80f9dca408b5e108fab0fe0545cc86471a497c06cc5e2565",
    "factoryModulePath": "js/core/renderer/zoom_interaction_lifecycle_owner.js",
    "factoryExportName": "createZoomInteractionLifecycleOwner",
    "factorySourceFingerprint": "bfeab0d137018835a1a925045885be7898283074acae8aeec912be69bc155e5f",
    "ownerBindingName": "zoomInteractionLifecycleOwner",
    "methods": [
      "initZoom",
      "flushLatestZoomTransform",
      "getZoomBehavior",
      "dispose"
    ],
    "actionExports": [
      "setZoomGestureStartTransformState",
      "setZoomGestureScaleDeltaState",
      "setPendingZoomTransformState",
      "setZoomRenderScheduledState",
      "setZoomGestureEndedAtState",
      "setPendingExactPoliticalFastFrameState"
    ],
    "actionModulePath": "js/core/state/actions/renderer_interaction_actions.js",
    "actionModulePathsByExport": {
      "setPendingExactPoliticalFastFrameState": "js/core/state/actions/renderer_exact_refresh_actions.js"
    }
  }),
  freezeMutationDelegatingOwnerEntry({
    "compositionModulePath": "js/core/map_renderer.js",
    "compositionExportName": "getMapInteractionEventBindingOwner",
    "compositionSourceFingerprint": "5ac9a0e746c7544f65fc77329ccf6ccd91a428779235613b9f7eb9a0e176befd",
    "factoryModulePath": "js/core/renderer/map_interaction_event_binding_owner.js",
    "factoryExportName": "createMapInteractionEventBindingOwner",
    "factorySourceFingerprint": "5b63e64411390e23a1be4a401cf9040034a845966ef35e4977d6f0a3c8497233",
    "ownerBindingName": "mapInteractionEventBindingOwner",
    "methods": [
      "bindEvents"
    ],
    "actionExports": []
  }),
  freezeMutationDelegatingOwnerEntry({
    compositionModulePath: "js/core/map_renderer.js",
    compositionExportName: "getHitCanvasSchedulingOwner",
    compositionSourceFingerprint: "ff892613e155506c55bf68c0b6c4af1d7ad6fd40c39aff06a3d41656a117e934",
    factoryModulePath: "js/core/map_renderer/hit_canvas_scheduling_owner.js",
    factoryExportName: "createHitCanvasSchedulingOwner",
    factorySourceFingerprint: "a2652c44c74755efcadfba35b637ccc35b4caa7be9482f4ffcfa10b557c9b0f6",
    ownerBindingName: "hitCanvasSchedulingOwner",
    methods: ["scheduleHitCanvasBuildIfNeeded", "cancelScheduledHitCanvasBuild"],
    actionModulePath: RENDERER_INTERACTION_ACTION_MODULE_PATH,
    actionExports: ["setHitCanvasBuildScheduledState"],
  }),
  freezeMutationDelegatingOwnerEntry({
    compositionModulePath: "js/core/map_renderer.js",
    compositionExportName: "getRendererProjectionPathOwner",
    compositionSourceFingerprint: "49d45b45f2da5052fdba6a4407f58228e5ea9c09ca7153b8798c387cbebfe6c5",
    factoryModulePath: "js/core/renderer/renderer_projection_path_owner.js",
    factoryExportName: "createRendererProjectionPathOwner",
    factorySourceFingerprint: "6a7ab1cce3bdaf74ea6c7ad0a1a8a1295a3dcf7e9f5119846db2beee72360ca2",
    ownerBindingName: "rendererProjectionPathOwner",
    methods: ["initializeProjectionPaths"], actionExports: [],
  }),
  freezeMutationDelegatingOwnerEntry({
    compositionModulePath: "js/core/map_renderer.js",
    compositionExportName: "getRendererFitProjectionOwner",
    compositionSourceFingerprint: "90d49709571b02a5cde1cd7c4d690059dccdb82ab840d6cdfea442030c466329",
    factoryModulePath: "js/core/renderer/renderer_fit_projection_owner.js",
    factoryExportName: "createRendererFitProjectionOwner",
    factorySourceFingerprint: "c567b0a86d148b86722371dd264f3023f81adba5a63a8758d49415c959c9fdc3",
    ownerBindingName: "rendererFitProjectionOwner", methods: ["fitProjection"],
    actionModulePath: RENDERER_INTERACTION_ACTION_MODULE_PATH,
    actionExports: ["setHitCanvasDirtyState"],
  }),
  freezeMutationDelegatingOwnerEntry({
    compositionModulePath: "js/core/map_renderer.js",
    compositionExportName: "getMapHoverInteractionOwner",
    compositionSourceFingerprint: "42a7b223db4cf7aea6be2737e9dce4bfb5fe201f68eb87b5cad02735029bcc90",
    factoryModulePath: "js/core/map_renderer/map_hover_interaction_owner.js",
    factoryExportName: "createMapHoverInteractionOwner",
    factorySourceFingerprint: "74c9802dbc4ef697bdba765346940b91d41040c4b57c6d0ddeebcaf8488e6635",
    ownerBindingName: "mapHoverInteractionOwner",
    methods: ["handleMouseMove", "handleMapMouseLeave", "getHoveredFacilityEntry", "setHoveredFacilityEntry", "setHoverOverlayDirty", "renderHoverOverlayIfNeeded", "cancelScheduledHoverOverlayRender", "cancelPendingHoverWork", "queueTooltipUpdate", "resetTooltipState", "setMapInteractionCursor"],
    actionExports: [],
  }),
  freezeMutationDelegatingOwnerEntry({
    compositionModulePath: "js/core/map_renderer.js",
    compositionExportName: "getRenderPassCacheHostOwner",
    compositionSourceFingerprint: "6fa23f55aec2ed44e486fae9dd6b1848f129714e5c1bfc0433d8ef1481a4bc03",
    factoryModulePath: "js/core/map_renderer/render_pass_cache_host_owner.js",
    factoryExportName: "createRenderPassCacheHostOwner",
    factorySourceFingerprint: "84a9b709939aa9aa4ad8646d9c9d183d70c996500a49255c25f7eb8cd5256e8d",
    ownerBindingName: "renderPassCacheHostOwner", methods: ["prepareRenderPassHost"], actionExports: [],
  }),
  freezeMutationDelegatingOwnerEntry({
    compositionModulePath: "js/core/map_renderer.js",
    compositionExportName: "getRenderPassCommitAccountingOwner",
    compositionSourceFingerprint: "97d4d3887dc9e225b68d24302f5ddac34b1a7b9cd9ac62c4bacd0f12aa8d8123",
    factoryModulePath: "js/core/map_renderer/render_pass_commit_accounting_owner.js",
    factoryExportName: "createRenderPassCommitAccountingOwner",
    factorySourceFingerprint: "da61e1d3f93ab2081febc40f631bb532a309c5abc494d41a00048fba71d8e1b4",
    ownerBindingName: "renderPassCommitAccountingOwner", methods: ["commitRenderPass"], actionExports: [],
  }),
  freezeMutationDelegatingOwnerEntry({
    compositionModulePath: "js/core/map_renderer.js",
    compositionExportName: "getRendererViewportUpdateOwner",
    compositionSourceFingerprint: "d3ff5e5ac3975279ab35dd50148aa4cbfaf016811aaa0f46aa18026ab5621aa4",
    factoryModulePath: "js/core/renderer/renderer_viewport_update_owner.js",
    factoryExportName: "createRendererViewportUpdateOwner",
    factorySourceFingerprint: "aab9925647bba714aaf6ebd7daafb415d9d5c7892827fce9beb54e2b9d9b3abc",
    ownerBindingName: "rendererViewportUpdateOwner", methods: ["updateMap"],
    actionModulePath: RENDERER_INTERACTION_ACTION_MODULE_PATH,
    actionExports: ["setZoomTransformState", "setHitCanvasDirtyState"],
  }),
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
      "eaf23737b1e05c66c977c99b7b194792421be811642a6948ac8f825ed5fe486e",
    factoryModulePath: "js/core/renderer/political_background_render_owner.js",
    factoryExportName: "createPoliticalBackgroundRenderOwner",
    factorySourceFingerprint:
      "7fc2e64b8f974b6d30774a7c40ce8ce567bbb1aee38b3f8920f13bb340f3dada",
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
      "02ff9a5c2d54921b54269fcf14b6bb53850bd6c3f4b08d239e1210af59eb8e35",
    factoryModulePath: "js/core/renderer/political_partial_repaint_owner.js",
    factoryExportName: "createPoliticalPartialRepaintOwner",
    factorySourceFingerprint:
      "4694a7d859e28f5e905e97d77c04bb522d89686239f1caf9b3ab624f4ff0d4ec",
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
      "7350227e1b3f93d2b850189e536c04df594007f7a7e86e0b7ba689be00112590",
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
      "671db953deac93bd1e92ad8d8c11dfda2bf87f617ba5ed99c634aab0f6ce24e8",
    factoryModulePath: "js/bootstrap/startup_ready_handoff.js",
    factoryExportName: "createStartupReadyHandoffOwner",
    factorySourceFingerprint:
      "0f427eabfea3546220cfaacf06ab55ff5a1d255d78496996100c0aec69601422",
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
      || !["object", "target"].includes(entry.factoryStateArgumentShape)
      || !entry.methods?.length
      || !(entry.borrowedLocalStorage || []).every(storage => isValidExportName(storage.functionName)
        && isValidExportName(storage.bindingName) && Array.isArray(storage.paths) && storage.paths.length
        && storage.paths.every(path => Array.isArray(path) && path.length && path.every(segment => segment === "*" || isValidExportName(segment))))
      || !Object.entries(entry.borrowedLocalParameterIndexes || {}).every(([name, indexes]) =>
        isValidExportName(name) && Array.isArray(indexes) && indexes.every(index => Number.isInteger(index) && index >= 0))
      || !Object.entries(entry.borrowedMapReadResultPaths || {}).every(([name, paths]) =>
        isValidExportName(name) && Array.isArray(paths) && paths.length
        && paths.every(path => Array.isArray(path) && path.every(segment => segment === "*" || isValidExportName(segment))))
      || !Object.entries(entry.borrowedMethodArgumentIndexes || {}).every(([name, indexes]) =>
        entry.methods.includes(name) && Array.isArray(indexes) && indexes.every(index => Number.isInteger(index) && index >= 0))
      || !entry.methods.every(isValidExportName)
      || new Set(entry.methods).size !== entry.methods.length
      || !Array.isArray(entry.borrowedCallbackMethods || [])
      || !(entry.borrowedCallbackMethods || []).every((method) => entry.methods.includes(method))
      || new Set(entry.borrowedCallbackMethods || []).size !== (entry.borrowedCallbackMethods || []).length
      || !Object.entries(entry.borrowedResultPathsByMethod || {}).every(([method, paths]) =>
        entry.methods.includes(method) && Array.isArray(paths) && paths.length
          && paths.every(path => Array.isArray(path) && path.every(segment => segment === "*" || isValidExportName(segment))))
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
  const directlyExported = (ast.body || []).some((statement) => (
    statement.type === "ExportNamedDeclaration"
    && (
      statement.declaration === capture
      || (
        !statement.source
        && (statement.specifiers || []).some((specifier) => (
          specifier.local?.name === entry.exportName
          && specifier.exported?.name === entry.exportName
        ))
      )
    )
  ));
  if (!capture || !directlyExported) {
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
          safeCloneHelperNames,
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
  for (const forwarder of entry.borrowedForwarders || []) {
    const fn = compositionFunctions.get(forwarder.functionName);
    const call = fn?.body?.body?.[0]?.argument;
    const callee = call?.callee;
    const exported = compositionAst.body.some(statement => statement.type === "ExportNamedDeclaration"
      && (statement.declaration?.id?.name === forwarder.functionName
        || statement.specifiers?.some(specifier => specifier.local?.name === forwarder.functionName)));
    if (!fn || exported || fingerprintFunctionSource(normalizedComposition, fn) !== forwarder.sourceFingerprint
      || fn.params.length !== 1 || fn.params[0].type !== "RestElement"
      || fn.params[0].argument.name !== forwarder.restParameterName
      || fn.body.body.length !== 1 || fn.body.body[0].type !== "ReturnStatement"
      || call?.type !== "CallExpression" || call.optional
      || callee?.type !== "MemberExpression" || callee.computed || callee.optional
      || callee.property.name !== forwarder.methodName
      || !entry.borrowedResultPathsByMethod[forwarder.methodName]
      || callee.object?.type !== "CallExpression" || callee.object.optional
      || callee.object.callee?.type !== "Identifier" || callee.object.callee.name !== entry.compositionExportName
      || callee.object.arguments.length !== 0 || call.arguments.length !== 1
      || call.arguments[0].type !== "SpreadElement" || call.arguments[0].argument.name !== forwarder.restParameterName) {
      violations.push(createViolation("state-mutation-owner-borrowed-forwarder-invalid", {
        modulePath: entry.compositionModulePath, functionName: forwarder.functionName,
      }));
    }
  }
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
  [`${SCENARIO_ACTIVATION_ACTION_MODULE_PATH}#applyPaletteFeatureColorState`, Object.freeze([1])],
  [`${SCENARIO_ACTIVATION_ACTION_MODULE_PATH}#applyScenarioChunkOptionalLayerState`, Object.freeze([2])],
  [`${SCENARIO_CHUNK_PROMOTION_ACTION_MODULE_PATH}#commitScenarioPoliticalChunkPayloadState`, Object.freeze([1])],
  [`${SCENARIO_CHUNK_RUNTIME_ACTION_MODULE_PATH}#queueScenarioChunkPromotionState`, Object.freeze([1])],
  [`${SCENARIO_CHUNK_RUNTIME_ACTION_MODULE_PATH}#setScenarioChunkMergedLayerPayloadsState`, Object.freeze([1])],
  [
    `${SCENARIO_CHUNK_RUNTIME_ACTION_MODULE_PATH}#replaceScenarioChunkPendingPromotionIdentityState`,
    Object.freeze([1]),
  ],
]);

const STATE_ACTION_REFERENCE_IDENTITY_ARGUMENT_INDEXES_BY_ID = new Map([
  [`${SCENARIO_ACTIVATION_ACTION_MODULE_PATH}#applyPaletteFeatureColorState`, Object.freeze([1, 2])],
  [`${SCENARIO_ACTIVATION_ACTION_MODULE_PATH}#applyPaletteOwnerColorState`, Object.freeze([1, 2])],
  [`${APPEARANCE_ACTION_MODULE_PATH}#setAppearanceStyleConfigState`, Object.freeze([1])],
  [`${APPEARANCE_ACTION_MODULE_PATH}#setAppearanceStyleGroupState`, Object.freeze([2])],
  [`${APPEARANCE_ACTION_MODULE_PATH}#setAppearanceParentBorderEnabledMapState`, Object.freeze([1])],
  [`${APPEARANCE_SELECTION_ACTION_MODULE_PATH}#setSelectedColorState`, Object.freeze([1])],
  [`${APPEARANCE_VISIBILITY_ACTION_MODULE_PATH}#setAppearanceVisibilitySnapshotState`, Object.freeze([2])],
  [`${SPECIAL_ZONE_ACTION_MODULE_PATH}#commitSpecialZoneLayersState`, Object.freeze([1])],
  [`${UI_CHROME_ACTION_MODULE_PATH}#setUiChromeState`, Object.freeze([1])],
  [`${UI_VISIBILITY_ACTION_MODULE_PATH}#commitUiVisibilityState`, Object.freeze([1])],
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
  [`${SCENARIO_ACTIVATION_ACTION_MODULE_PATH}#applyPaletteFeatureColorState`, Object.freeze([
    freezeAllowedDynamicSite({ operation: "assign", key: "visualOverrides", pathPattern: "visualOverrides.*" }),
    freezeAllowedDynamicSite({ operation: "assign", key: "featureOverrides", pathPattern: "featureOverrides.*" }),
  ])],
  [`${SCENARIO_ACTIVATION_ACTION_MODULE_PATH}#applyPaletteOwnerColorState`, Object.freeze([
    freezeAllowedDynamicSite({ operation: "assign", key: "sovereignBaseColors", pathPattern: "sovereignBaseColors.*" }),
    freezeAllowedDynamicSite({ operation: "assign", key: "countryBaseColors", pathPattern: "countryBaseColors.*" }),
  ])],
  ["js/core/state/actions/content_load_actions.js#finishContextLayerLoad", Object.freeze([
    freezeAllowedDynamicSite({ operation: "delete", key: "contextLayerLoadPromiseByName", pathPattern: "contextLayerLoadPromiseByName.*" }),
    freezeAllowedDynamicSite({ operation: "assign", key: "contextLayerLoadStateByName", pathPattern: "contextLayerLoadStateByName.*" }),
    freezeAllowedDynamicSite({ operation: "assign", key: "contextLayerLoadErrorByName", pathPattern: "contextLayerLoadErrorByName.*" }),
  ])],
  [`${SCENARIO_ACTIVATION_ACTION_MODULE_PATH}#trimScenarioBundleCacheState`, Object.freeze([
    freezeAllowedDynamicSite({ operation: "assign", key: "scenarioBundleCacheById", pathPattern: "scenarioBundleCacheById.*.chunkPayloadProtectedIds" }),
    freezeAllowedDynamicSite({ operation: "delete", key: "scenarioBundleCacheById", pathPattern: "scenarioBundleCacheById.*.chunkPayloadCacheById.*" }),
    freezeAllowedDynamicSite({ operation: "delete", key: "scenarioBundleCacheById", pathPattern: "scenarioBundleCacheById.*" }),
  ])],
  ["js/core/state/actions/renderer_transaction_diagnostics_actions.js#advanceScenarioApplyEpochState", Object.freeze([
    freezeAllowedDynamicSite({ operation: "assign", key: "renderTransactionDiagnostics", pathPattern: "renderTransactionDiagnostics.scenarioApplyEpochByScenarioId.*" }),
  ])],
  [`${SCENARIO_ACTIVATION_ACTION_MODULE_PATH}#clearScenarioBundleChunkProtectionState`, Object.freeze([
    freezeAllowedDynamicSite({ operation: "assign", key: "scenarioBundleCacheById", pathPattern: "scenarioBundleCacheById.*.chunkPayloadProtectedIds" }),
  ])],
  [`${SCENARIO_ACTIVATION_ACTION_MODULE_PATH}#removeScenarioBundleChunkPayloadState`, Object.freeze([
    freezeAllowedDynamicSite({ operation: "delete", key: "scenarioBundleCacheById", pathPattern: "scenarioBundleCacheById.*.chunkPayloadCacheById.*" }),
  ])],
  [`${SCENARIO_ACTIVATION_ACTION_MODULE_PATH}#removeScenarioBundleCacheEntryState`, Object.freeze([
    freezeAllowedDynamicSite({ operation: "delete", key: "scenarioBundleCacheById", pathPattern: "scenarioBundleCacheById.*" }),
  ])],
  [
    `${INTENSITY_FIELD_ACTION_MODULE_PATH}#appendIntensityFieldPointState`,
    Object.freeze([
      freezeAllowedDynamicSite({ operation: "assign", key: "intensityFields", pathPattern: "intensityFields.channels.*.enabled" }),
      freezeAllowedDynamicSite({ operation: "collection-mutate", key: "intensityFields", pathPattern: "intensityFields.channels.*.points" }),
    ]),
  ],
  [
    `${SCENARIO_ACTIVATION_ACTION_MODULE_PATH}#commitScenarioOptionalLayerPayloadState`,
    Object.freeze([
      // The action validates the layer-to-payload-field pair before publishing.
      freezeAllowedDynamicSite({ operation: "assign", key: "scenarioBundleCacheById", pathPattern: "scenarioBundleCacheById.*.*" }),
      freezeAllowedDynamicSite({ operation: "assign", key: "scenarioBundleCacheById", pathPattern: "scenarioBundleCacheById.*.optionalLayerSettledByKey.*" }),
      freezeAllowedDynamicSite({ operation: "delete", key: "scenarioBundleCacheById", pathPattern: "scenarioBundleCacheById.*.optionalLayerSettledByKey.*" }),
    ]),
  ],
  [
    `${SCENARIO_PRESENTATION_ACTION_MODULE_PATH}#setHgoIdentityVariantSelectionState`,
    Object.freeze([
      freezeAllowedDynamicSite({
        operation: "assign", key: "hgoIdentity", pathPattern: "hgoIdentity.variantSelections.*",
      }),
      freezeAllowedDynamicSite({
        operation: "delete", key: "hgoIdentity", pathPattern: "hgoIdentity.variantSelections.*",
      }),
    ]),
  ],
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
    borrowedResultPaths: Object.freeze(
      normalizedModulePath === SCENARIO_ACTIVATION_ACTION_MODULE_PATH
        && normalizedExportName === "applyScenarioChunkOptionalLayerState"
        ? [Object.freeze(["externalEffect", "payload"])] : [],
    ),
    readOnlyArgumentIndexes:
      STATE_ACTION_READ_ONLY_ARGUMENT_INDEXES_BY_ID.get(
        `${normalizedModulePath}#${normalizedExportName}`,
      ) || Object.freeze([]),
    referenceIdentityArgumentIndexes:
      STATE_ACTION_REFERENCE_IDENTITY_ARGUMENT_INDEXES_BY_ID.get(
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

function freezeActionSuccessorEdge({
  enclosingFunctionIdentity,
  actionModulePath,
  actionExportName,
  targetArgumentIndex = 0,
  sourceFingerprint,
  occurrenceIndex = 0,
  terminalMembership = "",
}) {
  return Object.freeze({
    enclosingFunctionIdentity: String(enclosingFunctionIdentity || ""),
    actionModulePath: normalizeModulePath(actionModulePath),
    actionExportName: String(actionExportName || ""),
    targetArgumentIndex: Number(targetArgumentIndex),
    sourceFingerprint: String(sourceFingerprint || ""),
    occurrenceIndex: Number(occurrenceIndex),
    terminalMembership: normalizeStateActionMembership(
      terminalMembership,
    ),
  });
}

function freezeActionSuccessorProofEntry({
  modulePath,
  exportName,
  replacementMembership,
  carrierFunctions,
  successorEdges,
  requiredDirectMemberships = [],
}) {
  const replacement = normalizeStateActionMembership(
    replacementMembership,
  );
  const normalized = {
    modulePath: normalizeModulePath(modulePath),
    exportName: String(exportName || ""),
    replacementMembership: replacement,
    requiredDirectMemberships: Object.freeze(
      requiredDirectMemberships.map(normalizeStateActionMembership),
    ),
    carrierFunctions: Object.freeze(carrierFunctions.map((entry) =>
      Object.freeze({
        functionName: String(entry.functionName || ""),
        sourceFingerprint: String(entry.sourceFingerprint || ""),
      })
    )),
    successorEdges: Object.freeze(successorEdges.map((edge) =>
      freezeActionSuccessorEdge({
        ...edge,
        terminalMembership:
          edge.terminalMembership || replacement,
      })
    )),
  };
  return Object.freeze({
    ...normalized,
    contractIdentity: createHash("sha256")
      .update(JSON.stringify(normalized))
      .digest("hex"),
  });
}

const SCENARIO_PRESENTATION_RESTORE_FUNCTION_IDENTITY =
  '{"kind":"function","ancestry":[{"name":"restoreScenarioPresentationStateFromValidated","ordinal":0}]}';
const APPEARANCE_VISIBILITY_RELAY_FUNCTION_IDENTITY =
  '{"kind":"function","ancestry":[{"name":"setAppearanceVisibilityState","ordinal":0}]}';

function successorEdge(actionModulePath, actionExportName, sourceFingerprint,
  occurrenceIndex = 0, enclosingFunctionIdentity = APPEARANCE_VISIBILITY_RELAY_FUNCTION_IDENTITY) {
  return {
    enclosingFunctionIdentity,
    actionModulePath,
    actionExportName,
    targetArgumentIndex: 0,
    sourceFingerprint,
    occurrenceIndex,
  };
}

const SCENARIO_RESTORE_SUCCESSORS = Object.freeze({
  parentBordersVisible: [successorEdge(APPEARANCE_VISIBILITY_ACTION_MODULE_PATH, "setAppearanceVisibilitySnapshotState", "2e0f5953f63502a06e1886b79c66b6b12c1b25f054a5f5b2d8a0885a928b9b18", 0, SCENARIO_PRESENTATION_RESTORE_FUNCTION_IDENTITY)],
  parentBorderEnabledByCountry: [successorEdge(APPEARANCE_ACTION_MODULE_PATH, "setAppearanceParentBorderEnabledMapState", "a03126d95a092f78f2fdc19413b7f4af87cf2525760277b6e379fec7e56a3f72", 0, SCENARIO_PRESENTATION_RESTORE_FUNCTION_IDENTITY)],
  styleConfig: [
    successorEdge(APPEARANCE_ACTION_MODULE_PATH, "setAppearanceStyleGroupState", "f77bdee999a5f11a70dc7cb1421d0a872fd317fe9e79df7f4bb3ca88b4f65109", 0, SCENARIO_PRESENTATION_RESTORE_FUNCTION_IDENTITY),
    successorEdge(APPEARANCE_ACTION_MODULE_PATH, "setAppearanceStyleConfigState", "320b6b090abe4f7aafcba4703b78857873a06c08b21f2d61abe85e87df0e6008", 0, SCENARIO_PRESENTATION_RESTORE_FUNCTION_IDENTITY),
  ],
  ui: [
    successorEdge(UI_CHROME_ACTION_MODULE_PATH, "patchUiChromeState", "8bf9a22cf562f52d1e986ca50368d27b05be1510a973f0bbdfb66820a79481af", 0, SCENARIO_PRESENTATION_RESTORE_FUNCTION_IDENTITY),
    {
      ...successorEdge(UI_CHROME_ACTION_MODULE_PATH, "setUiChromeState", "6c92df76d0808f166c2e8b3789796f889ae67016a8cdf1d16da6ddef513db898", 0, SCENARIO_PRESENTATION_RESTORE_FUNCTION_IDENTITY),
      terminalMembership: "ui|P4.4|define-property|ui",
    },
  ],
  showCityPoints: [successorEdge(UI_VISIBILITY_ACTION_MODULE_PATH, "commitUiVisibilityState", "3917a3be2b5885e6055e813bd69e21da9694ea8a0c653e0711d80e32cff9a988", 0, SCENARIO_PRESENTATION_RESTORE_FUNCTION_IDENTITY)],
  showWaterRegions: [successorEdge(UI_VISIBILITY_ACTION_MODULE_PATH, "commitUiVisibilityState", "d31f2ebd3b9efad7a2b4f8a89183f23e155f7f3274b7e17fe27aee4a3d0f2f7e", 1, SCENARIO_PRESENTATION_RESTORE_FUNCTION_IDENTITY)],
  showScenarioSpecialRegions: [successorEdge(UI_VISIBILITY_ACTION_MODULE_PATH, "commitUiVisibilityState", "49209ea256d0776f46911ed6428baacbc5f289e43caf83ab79e3f800546884bf", 2, SCENARIO_PRESENTATION_RESTORE_FUNCTION_IDENTITY)],
  showScenarioReliefOverlays: [successorEdge(UI_VISIBILITY_ACTION_MODULE_PATH, "commitUiVisibilityState", "99e1e0763e4aa603ceb87e87aeb2b0ea9773b402fe06b42fe8c34f7b92e8060f", 4, SCENARIO_PRESENTATION_RESTORE_FUNCTION_IDENTITY)],
  showStrategicResourceMarkers: [successorEdge(UI_VISIBILITY_ACTION_MODULE_PATH, "commitUiVisibilityState", "6df3f099c8df42610c49e445079fd2d6567c0fba872c1b0f3d0599949fde99af", 5, SCENARIO_PRESENTATION_RESTORE_FUNCTION_IDENTITY)],
  strategicChoroplethMetric: [successorEdge(UI_VISIBILITY_ACTION_MODULE_PATH, "commitUiVisibilityState", "fe5f72f21cf3631b11f97bf04b3d6861d9e0292bb7ba321fcae75ebc1698d207", 6, SCENARIO_PRESENTATION_RESTORE_FUNCTION_IDENTITY)],
});

const VISIBILITY_SUCCESSOR_FINGERPRINTS = Object.freeze({
  showCityPoints: ["ef137e6d95996769aadc088639caf87eb0b1d56f1b5139fdf00c29437d578816", 7],
  showStrategicResourceMarkers: ["9b31391661f92a53741d415258171bfdfd54ae1627f554202da9310fdd83f41a", 8],
  strategicChoroplethMetric: ["057504ca5226f31d7cde94089a62f645945a5dfceedccd37135c37e38d8c370b", 9],
  showUrban: ["1c23f6c2f846f28d5861b0f3da57d590cd6a81022c6d8389e5f3a70bbdcb3281", 10],
  showPhysical: ["d5128fe29925d25a4bb6ccd39b757cd92139765005a3ef50f39c7c09086b3782", 11],
  showRivers: ["fdf6a5b996b1a92309f924b0d88c9b10fe75a560718d0df24da115f8e8773b6e", 12],
});
const SCENARIO_CHUNK_HYBRID_DIRECT_MEMBERSHIPS = Object.freeze([
  "scenario|P4.2|assign|scenarioAtlantropaData",
  "scenario|P4.2|assign|scenarioAtlantropaRevision",
  "scenario|P4.2|assign|scenarioReliefOverlayRevision",
  "scenario|P4.2|assign|scenarioReliefOverlaysData",
  "scenario|P4.2|assign|scenarioSpecialRegionsData",
  "scenario|P4.2|assign|scenarioStrategicValuesData",
  "scenario|P4.2|assign|scenarioStrategicValuesRevision",
  "scenario|P4.2|assign|scenarioWaterRegionsData",
]);

const successorEntries = [];
for (const [key, edges] of Object.entries(SCENARIO_RESTORE_SUCCESSORS)) {
  const replacementMembership = key === "parentBordersVisible"
    ? "content|P4.2|assign|parentBordersVisible"
    : key === "parentBorderEnabledByCountry"
      ? "renderer|P4.3|assign|parentBorderEnabledByCountry"
      : `ui|P4.4|assign|${key}`;
  successorEntries.push(freezeActionSuccessorProofEntry({
    modulePath: SCENARIO_PRESENTATION_ACTION_MODULE_PATH,
    exportName: "restoreScenarioTransactionPresentationState",
    replacementMembership,
    carrierFunctions: [
      { functionName: "restoreScenarioTransactionPresentationState", sourceFingerprint: "9133d927670747ac2aba6c59442afdeb347ddfb396f821b0e893a2515bfee8d9" },
      { functionName: "restoreScenarioPresentationStateFromValidated", sourceFingerprint: "12dff0f3f892f7b45c6b34aa01d94717364958fd7790d9e0ff11cea41965aa61" },
    ],
    successorEdges: edges,
  }));
}
for (const [key, [fingerprint, occurrenceIndex]] of Object.entries(VISIBILITY_SUCCESSOR_FINGERPRINTS)) {
  successorEntries.push(freezeActionSuccessorProofEntry({
    modulePath: APPEARANCE_VISIBILITY_ACTION_MODULE_PATH,
    exportName: "setAppearanceVisibilityState",
    replacementMembership: `ui|P4.4|assign|${key}`,
    carrierFunctions: [{ functionName: "setAppearanceVisibilityState", sourceFingerprint: "8d4a1032dfc1f9d4eb7f20337fe6269332d809d639543fe117cea6eee5a29c41" }],
    successorEdges: [successorEdge(UI_VISIBILITY_ACTION_MODULE_PATH, "commitUiVisibilityState", fingerprint, occurrenceIndex)],
  }));
}
successorEntries.push(
  freezeActionSuccessorProofEntry({
    modulePath: SCENARIO_ACTIVATION_ACTION_MODULE_PATH,
    exportName: "applyScenarioChunkOptionalLayerState",
    replacementMembership: "scenario|P4.2|assign|*",
    requiredDirectMemberships:
      SCENARIO_CHUNK_HYBRID_DIRECT_MEMBERSHIPS,
    carrierFunctions: [{ functionName: "applyScenarioChunkOptionalLayerState", sourceFingerprint: "e57211283e41e92a4a68f016950b7215be74563a6e58860a36e42db20e8f6866" }],
    successorEdges: [{
      ...successorEdge(SPECIAL_ZONE_ACTION_MODULE_PATH, "commitSpecialZoneLayersState", "9c5e9b6f5722f2eb0461db89f615e90f1e0bb892a2a4cb843287b90221783bb4", 0, '{"kind":"function","ancestry":[{"name":"applyScenarioChunkOptionalLayerState","ordinal":0}]}'),
      terminalMembership: "ui|P4.4|assign|specialZoneLayers",
    }],
  }),
  freezeActionSuccessorProofEntry({
    modulePath: SCENARIO_ACTIVATION_ACTION_MODULE_PATH,
    exportName: "restoreScenarioChunkPromotionState",
    replacementMembership: "scenario|P4.2|assign|*",
    requiredDirectMemberships:
      SCENARIO_CHUNK_HYBRID_DIRECT_MEMBERSHIPS,
    carrierFunctions: [{ functionName: "restoreScenarioChunkPromotionState", sourceFingerprint: "ef7f68540902b9f5a2b5916311ff4f9b33813f122c3b9431b90a1079ab297f3a" }],
    successorEdges: [
      {
        ...successorEdge(SPECIAL_ZONE_ACTION_MODULE_PATH, "commitSpecialZoneLayersState", "39fa88ef1fdc10d6f07b01feb0f9a80c087c3f7a318b9ab80eb7ed578e9c4e75", 0, '{"kind":"function","ancestry":[{"name":"restoreScenarioChunkPromotionState","ordinal":0}]}'),
        terminalMembership: "ui|P4.4|assign|specialZoneLayers",
      },
      {
        ...successorEdge(SPECIAL_ZONE_ACTION_MODULE_PATH, "commitSpecialZoneLayersState", "ae8a608f6851731064dabf89ac7615738e83aebdd1e276e87d8385dadd3073d0", 1, '{"kind":"function","ancestry":[{"name":"restoreScenarioChunkPromotionState","ordinal":0}]}'),
        terminalMembership: "ui|P4.4|assign|specialZoneLayers",
      },
    ],
  }),
  freezeActionSuccessorProofEntry({
    modulePath: SPECIAL_ZONE_ACTION_MODULE_PATH,
    exportName: "setSpecialZonesVisibilityState",
    replacementMembership: "ui|P4.4|assign|showSpecialZones",
    carrierFunctions: [{ functionName: "setSpecialZonesVisibilityState", sourceFingerprint: "c95dff5b54150378af045b1a43dca529fed47c934000eacb944eac5296ccbe51" }],
    successorEdges: [successorEdge(UI_VISIBILITY_ACTION_MODULE_PATH, "commitUiVisibilityState", "1cc43eb500139f636aa2cb1e16f5deddc26fe7bf752daed23c682a612c74a288", 0, '{"kind":"function","ancestry":[{"name":"setSpecialZonesVisibilityState","ordinal":0}]}')],
  }),
  freezeActionSuccessorProofEntry({
    modulePath: TRANSPORT_ACTION_MODULE_PATH,
    exportName: "applyTransportWorkbenchOverviewState",
    replacementMembership: "ui|P4.4|assign|styleConfig",
    carrierFunctions: [{ functionName: "applyTransportWorkbenchOverviewState", sourceFingerprint: "46056c49e4fd86246219b1c9f719ee643893a819ff81938b2c1f346c69d3d587" }],
    successorEdges: [successorEdge(APPEARANCE_ACTION_MODULE_PATH, "setAppearanceStyleGroupState", "eaea368a81306342fb11279d196cef0fdb600b4793c9853662655a3770a87266", 0, '{"kind":"function","ancestry":[{"name":"applyTransportWorkbenchOverviewState","ordinal":0}]}')],
  }),
  freezeActionSuccessorProofEntry({
    modulePath: RENDERER_INTERACTION_ACTION_MODULE_PATH,
    exportName: "setClickSelectedColorState",
    replacementMembership: "color|P4.4|assign|selectedColor",
    carrierFunctions: [{ functionName: "setClickSelectedColorState", sourceFingerprint: "29ad3281276fd64baaffcb0fe4c9f3a19ddc2cd554a1825d8ed54506f882e62e" }],
    successorEdges: [successorEdge(APPEARANCE_SELECTION_ACTION_MODULE_PATH, "setSelectedColorState", "4e3b5bf002f14c1caf299322dceae4409ad330194cbcc86669f51775ebd18a33", 0, '{"kind":"function","ancestry":[{"name":"setClickSelectedColorState","ordinal":0}]}')],
  }),
  freezeActionSuccessorProofEntry({
    modulePath: RENDERER_INTERACTION_ACTION_MODULE_PATH,
    exportName: "setHoveredFeatureIdsState",
    replacementMembership: "ui|P4.4|assign|hoveredSpecialRegionId",
    carrierFunctions: [{ functionName: "setHoveredFeatureIdsState", sourceFingerprint: "f8a2836a2bd862986f8178c0158e7d11d39f82e119623d68525d59f1d984c0a4" }],
    successorEdges: [successorEdge(SCENARIO_PRESENTATION_ACTION_MODULE_PATH, "setScenarioHoverRegionIdsState", "e3463a5e9d61e6396d301ed94bee7a39a9d6b9637ab2d9bc9acb0a805a76dbc5", 0, '{"kind":"function","ancestry":[{"name":"setHoveredFeatureIdsState","ordinal":0}]}')],
  }),
  freezeActionSuccessorProofEntry({
    modulePath: RENDERER_INTERACTION_ACTION_MODULE_PATH,
    exportName: "setHoveredFeatureIdsState",
    replacementMembership: "ui|P4.4|assign|hoveredWaterRegionId",
    carrierFunctions: [{ functionName: "setHoveredFeatureIdsState", sourceFingerprint: "f8a2836a2bd862986f8178c0158e7d11d39f82e119623d68525d59f1d984c0a4" }],
    successorEdges: [successorEdge(SCENARIO_PRESENTATION_ACTION_MODULE_PATH, "setScenarioHoverRegionIdsState", "e3463a5e9d61e6396d301ed94bee7a39a9d6b9637ab2d9bc9acb0a805a76dbc5", 0, '{"kind":"function","ancestry":[{"name":"setHoveredFeatureIdsState","ordinal":0}]}')],
  }),
);

for (const key of ["legendLabels", "legendConfig"]) {
  successorEntries.push(freezeActionSuccessorProofEntry({
    modulePath: "js/core/state/actions/legend_actions.js",
    exportName: "patchLegendState",
    replacementMembership: `color|P4.4|assign|${key}`,
    carrierFunctions: [{ functionName: "patchLegendState", sourceFingerprint: "15960db1542112d203f5543680dddc235ee4a47b178835117298f557db18cabf" }],
    successorEdges: [successorEdge(SCENARIO_PALETTE_ACTION_MODULE_PATH, "patchLegendPaletteState", "56fd1abca5818d063f12394d8ad707a716e4357602341617cfb353fcd86133c5", 0,
      '{"kind":"function","ancestry":[{"name":"patchLegendState","ordinal":0}]}')],
  }));
}

// Legend entry points normalize or update a detached label map before the
// existing palette owner publishes it; deletion is committed as map replacement.
successorEntries.push(
freezeActionSuccessorProofEntry({
  "modulePath": "js/core/state/actions/legend_actions.js",
  "exportName": "ensureLegendState",
  "replacementMembership": "color|P4.4|assign|legendConfig",
  "carrierFunctions": [
    {
      "functionName": "ensureLegendState",
      "sourceFingerprint": "c22f5f0499706c69fae6336721d6ec441cf8d1d677fe8a47b9925115908089ae"
    },
    {
      "functionName": "patchLegendState",
      "sourceFingerprint": "15960db1542112d203f5543680dddc235ee4a47b178835117298f557db18cabf"
    }
  ],
  "successorEdges": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"patchLegendState\",\"ordinal\":0}]}",
      "actionModulePath": "js/core/state/actions/scenario_palette_actions.js",
      "actionExportName": "patchLegendPaletteState",
      "targetArgumentIndex": 0,
      "sourceFingerprint": "56fd1abca5818d063f12394d8ad707a716e4357602341617cfb353fcd86133c5",
      "occurrenceIndex": 0,
      "terminalMembership": "color|P4.4|assign|legendConfig"
    }
  ]
}),
freezeActionSuccessorProofEntry({
  "modulePath": "js/core/state/actions/legend_actions.js",
  "exportName": "ensureLegendState",
  "replacementMembership": "color|P4.4|assign|legendLabels",
  "carrierFunctions": [
    {
      "functionName": "ensureLegendState",
      "sourceFingerprint": "c22f5f0499706c69fae6336721d6ec441cf8d1d677fe8a47b9925115908089ae"
    },
    {
      "functionName": "patchLegendState",
      "sourceFingerprint": "15960db1542112d203f5543680dddc235ee4a47b178835117298f557db18cabf"
    }
  ],
  "successorEdges": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"patchLegendState\",\"ordinal\":0}]}",
      "actionModulePath": "js/core/state/actions/scenario_palette_actions.js",
      "actionExportName": "patchLegendPaletteState",
      "targetArgumentIndex": 0,
      "sourceFingerprint": "56fd1abca5818d063f12394d8ad707a716e4357602341617cfb353fcd86133c5",
      "occurrenceIndex": 0,
      "terminalMembership": "color|P4.4|assign|legendLabels"
    }
  ]
}),
freezeActionSuccessorProofEntry({
  "modulePath": "js/core/state/actions/legend_actions.js",
  "exportName": "setLegendLabelState",
  "replacementMembership": "color|P4.4|assign|legendLabels",
  "carrierFunctions": [
    {
      "functionName": "setLegendLabelState",
      "sourceFingerprint": "3d918915922cf34b42c2e9f412c2942a905cf1e4138bd86f37eaf3fb64c867c6"
    },
    {
      "functionName": "patchLegendState",
      "sourceFingerprint": "15960db1542112d203f5543680dddc235ee4a47b178835117298f557db18cabf"
    }
  ],
  "successorEdges": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"patchLegendState\",\"ordinal\":0}]}",
      "actionModulePath": "js/core/state/actions/scenario_palette_actions.js",
      "actionExportName": "patchLegendPaletteState",
      "targetArgumentIndex": 0,
      "sourceFingerprint": "56fd1abca5818d063f12394d8ad707a716e4357602341617cfb353fcd86133c5",
      "occurrenceIndex": 0,
      "terminalMembership": "color|P4.4|assign|legendLabels"
    }
  ]
}),
freezeActionSuccessorProofEntry({
  "modulePath": "js/core/state/actions/legend_actions.js",
  "exportName": "setLegendLabelState",
  "replacementMembership": "color|P4.4|delete|legendLabels",
  "carrierFunctions": [
    {
      "functionName": "setLegendLabelState",
      "sourceFingerprint": "3d918915922cf34b42c2e9f412c2942a905cf1e4138bd86f37eaf3fb64c867c6"
    },
    {
      "functionName": "patchLegendState",
      "sourceFingerprint": "15960db1542112d203f5543680dddc235ee4a47b178835117298f557db18cabf"
    }
  ],
  "successorEdges": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"patchLegendState\",\"ordinal\":0}]}",
      "actionModulePath": "js/core/state/actions/scenario_palette_actions.js",
      "actionExportName": "patchLegendPaletteState",
      "targetArgumentIndex": 0,
      "sourceFingerprint": "56fd1abca5818d063f12394d8ad707a716e4357602341617cfb353fcd86133c5",
      "occurrenceIndex": 0,
      "terminalMembership": "color|P4.4|assign|legendLabels"
    }
  ]
})
);

successorEntries.push(freezeActionSuccessorProofEntry({
  "modulePath": "js/core/state/actions/palette_library_actions.js",
  "exportName": "selectPalettePaintColorState",
  "replacementMembership": "color|P4.4|assign|selectedColor",
  "carrierFunctions": [
    {
      "functionName": "selectPalettePaintColorState",
      "sourceFingerprint": "d613a3e5fe2d7121ba0afe0fa6b1a9fc447119466d4ca9ca66b72f4e6b71294a"
    }
  ],
  "successorEdges": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"selectPalettePaintColorState\",\"ordinal\":0}]}",
      "actionModulePath": "js/core/state/actions/appearance_selection_actions.js",
      "actionExportName": "setSelectedColorState",
      "targetArgumentIndex": 0,
      "sourceFingerprint": "4e3b5bf002f14c1caf299322dceae4409ad330194cbcc86669f51775ebd18a33",
      "occurrenceIndex": 0
    }
  ]
}));

export const STATE_ACTION_SUCCESSOR_PROOF_CONTRACT = Object.freeze(
  [...successorEntries, ...[
    ["selectPalettePaintColorState", "paintMode", SCENARIO_PRESENTATION_ACTION_MODULE_PATH, "selectPaletteVisualPaintModeState", "d613a3e5fe2d7121ba0afe0fa6b1a9fc447119466d4ca9ca66b72f4e6b71294a", "7a7bbfe18788c2f9e4584cd5317fc05edebf88a4a57068baebfabba382ffc1d6"],
    ...["visualOverrides", "featureOverrides"].map(key => ["applyPaletteFeatureColorState", key, SCENARIO_ACTIVATION_ACTION_MODULE_PATH, "applyPaletteFeatureColorState", "db7322b0783e1a37f7bf3ee0f43eae75bc475cfdcfe80a69dd4c5fc23d61e050", "dc0631e18de280577898d15f0a9346c83916dd8689456d2d7068bb9bdfca0bba"]),
    ...["sovereignBaseColors", "countryBaseColors"].map(key => ["applyPaletteOwnerColorState", key, SCENARIO_ACTIVATION_ACTION_MODULE_PATH, "applyPaletteOwnerColorState", "48f69348d1e6d08339aad7ce802ba753998ee44e2f54672fde72287f058c840b", "8f77ade5c6934e8e87f7228b4f705430a2023bab3fe9c116b17cd24569ed87cf"]),
  ].map(([exportName, key, actionModulePath, actionExportName, sourceFingerprint, edgeFingerprint]) => freezeActionSuccessorProofEntry({
    modulePath: "js/core/state/actions/palette_library_actions.js", exportName,
    replacementMembership: `color|P4.4|assign|${key}`,
    carrierFunctions: [{ functionName: exportName, sourceFingerprint }],
    successorEdges: [{
      enclosingFunctionIdentity: JSON.stringify({ kind: "function", ancestry: [{ name: exportName, ordinal: 0 }] }),
      actionModulePath, actionExportName, targetArgumentIndex: 0, sourceFingerprint: edgeFingerprint, occurrenceIndex: 0,
    }],
  }))].sort((left, right) =>
    `${left.modulePath}#${left.exportName}#${left.replacementMembership}`.localeCompare(
      `${right.modulePath}#${right.exportName}#${right.replacementMembership}`,
    )
  ),
);

export function findStateActionSuccessorProofContractEntry(
  modulePath,
  exportName,
  replacementMembership,
) {
  return STATE_ACTION_SUCCESSOR_PROOF_CONTRACT.find((entry) =>
    entry.modulePath === normalizeModulePath(modulePath)
    && entry.exportName === String(exportName || "")
    && entry.replacementMembership
      === normalizeStateActionMembership(replacementMembership)
  ) || null;
}

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

export const STATE_ACTION_LEGACY_MEMBERSHIP_REPLACEMENT_CONTRACT =
  Object.freeze([
    ...["cachedCoastlines", "cachedCoastlinesHigh", "cachedCoastlinesLow", "cachedCoastlinesMid"].map(key => ({
      modulePath: RENDERER_CACHE_ACTION_MODULE_PATH, exportName: "replaceCachedCoastlineMeshesState",
      retiredMembership: `renderer|P4.3|collection-mutate|${key}`, requiredConcreteMemberships: [`renderer|P4.3|assign|${key}`],
    })),
    // Import replaces the cleared inspector Sets with staged Set instances.
    ...["expandedInspectorContinents", "expandedInspectorReleaseParents"].map((key) => ({
      modulePath: SCENARIO_PRESENTATION_ACTION_MODULE_PATH,
      exportName: "restoreProjectImportFields",
      retiredMembership: `color|P4.4|collection-mutate|${key}`,
      requiredConcreteMemberships: [`color|P4.4|assign|${key}`],
    })),
    {
      modulePath: RENDERER_CACHE_ACTION_MODULE_PATH,
      exportName: "replaceCachedDetailAdmBordersState",
      retiredMembership: "renderer|P4.3|collection-mutate|cachedDetailAdmBorders",
      requiredConcreteMemberships: ["renderer|P4.3|assign|cachedDetailAdmBorders"],
    },
    ...[
      "applyScenarioChunkOptionalLayerState",
      "restoreScenarioChunkPromotionState",
    ].map((exportName) => ({
      modulePath: SCENARIO_ACTIVATION_ACTION_MODULE_PATH,
      exportName,
      retiredMembership: "scenario|P4.2|assign|*",
      requiredConcreteMemberships:
        SCENARIO_CHUNK_OPTIONAL_LAYER_ASSIGN_MEMBERSHIPS,
    })),
    ...[
      "collection-mutate",
      "compound-assign",
    ].map((operation) => ({
      modulePath: STRATEGIC_OVERLAY_ACTION_MODULE_PATH,
      exportName: "patchStrategicOverlayEditorState",
      retiredMembership:
        `strategic-overlay|P4.4|${operation}|operationGraphicsEditor`,
      requiredConcreteMemberships: [
        "strategic-overlay|P4.4|assign|operationGraphicsEditor",
      ],
    })),
    {
      modulePath: STRATEGIC_OVERLAY_ACTION_MODULE_PATH,
      exportName: "commitStrategicOverlayCollectionsState",
      retiredMembership:
        "ui|P4.4|collection-mutate|operationGraphics",
      requiredConcreteMemberships: [
        "ui|P4.4|assign|operationGraphics",
      ],
    },
    {
      modulePath: STRATEGIC_OVERLAY_ACTION_MODULE_PATH,
      exportName: "patchStrategicOverlayEditorState",
      retiredMembership:
        "strategic-overlay|P4.4|compound-assign|unitCounterEditor",
      requiredConcreteMemberships: [
        "strategic-overlay|P4.4|assign|unitCounterEditor",
      ],
    },
    {
      modulePath: STRATEGIC_OVERLAY_ACTION_MODULE_PATH,
      exportName: "commitStrategicOverlayCollectionsState",
      retiredMembership: "ui|P4.4|collection-mutate|unitCounters",
      requiredConcreteMemberships: [
        "ui|P4.4|assign|unitCounters",
      ],
    },
    ...[
      "collection-mutate",
      "compound-assign",
    ].map((operation) => ({
      modulePath: STRATEGIC_OVERLAY_ACTION_MODULE_PATH,
      exportName: "patchStrategicOverlayEditorState",
      retiredMembership:
        `strategic-overlay|P4.4|${operation}|operationalLineEditor`,
      requiredConcreteMemberships: [
        "strategic-overlay|P4.4|assign|operationalLineEditor",
      ],
    })),
    {
      modulePath: STRATEGIC_OVERLAY_ACTION_MODULE_PATH,
      exportName: "commitStrategicOverlayCollectionsState",
      retiredMembership: "ui|P4.4|collection-mutate|operationalLines",
      requiredConcreteMemberships: [
        "ui|P4.4|assign|operationalLines",
      ],
    },
    {
      modulePath: TRANSPORT_ACTION_MODULE_PATH,
      exportName: "applyTransportWorkbenchOverviewState",
      retiredMembership: "cross-domain|multi-phase|assign|*",
      requiredConcreteMemberships: [
        "ui|P4.4|define-property|showAirports",
        "ui|P4.4|define-property|showPorts",
        "ui|P4.4|define-property|showRail",
        "ui|P4.4|define-property|showRoad",
        "ui|P4.4|define-property|showTransport",
        "ui|P4.4|define-property|transportWorkbenchPointDeltas",
        "ui|P4.4|define-property|transportWorkbenchUi",
      ],
    },
    {
      modulePath: TRANSPORT_ACTION_MODULE_PATH,
      exportName: "applyTransportWorkbenchOverviewState",
      retiredMembership: "ui|P4.4|assign|showTransport",
      requiredConcreteMemberships: [
        "ui|P4.4|define-property|showTransport",
      ],
    },
    ...[
      "showAirports",
      "showPorts",
      "showRail",
      "showRoad",
      "showTransport",
    ].map((key) => ({
      modulePath: TRANSPORT_ACTION_MODULE_PATH,
      exportName: "setTransportFamilyVisibilityState",
      retiredMembership: `ui|P4.4|assign|${key}`,
      requiredConcreteMemberships: [
        `ui|P4.4|define-property|${key}`,
      ],
    })),
    {
      modulePath: TRANSPORT_ACTION_MODULE_PATH,
      exportName: "setTransportMasterVisibilityState",
      retiredMembership: "ui|P4.4|assign|showTransport",
      requiredConcreteMemberships: [
        "ui|P4.4|define-property|showTransport",
      ],
    },
    {
      modulePath: TRANSPORT_ACTION_MODULE_PATH,
      exportName: "commitTransportWorkbenchPointDeltasState",
      retiredMembership:
        "ui|P4.4|assign|transportWorkbenchPointDeltas",
      requiredConcreteMemberships: [
        "ui|P4.4|define-property|transportWorkbenchPointDeltas",
      ],
    },
    {
      modulePath: TRANSPORT_ACTION_MODULE_PATH,
      exportName: "commitTransportWorkbenchUiState",
      retiredMembership:
        "ui|P4.4|object-assign|transportWorkbenchUi",
      requiredConcreteMemberships: [
        "ui|P4.4|assign|transportWorkbenchUi",
        "ui|P4.4|define-property|transportWorkbenchUi",
      ],
    },
  ].map(freezeLegacyMembershipReplacementEntry).sort(
    (left, right) =>
      legacyMembershipReplacementEntryId(left).localeCompare(
        legacyMembershipReplacementEntryId(right),
      ),
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
  parameterPath = "$",
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
    ancestry: ancestryNames.map((entry) =>
      typeof entry === "string"
        ? { name: entry, ordinal: 0 }
        : { name: entry.name, ordinal: entry.ordinal }
    ),
  });
}

function createP44RetiredMutationSites(groups = []) {
  return groups.flatMap(({ ancestryNames, sites }) =>
    sites.map(([sourceFingerprint, occurrenceIndex = 0]) => ({
      enclosingFunctionIdentity:
        createP44FunctionIdentity(...ancestryNames),
      sourceFingerprint,
      occurrenceIndex,
    }))
  ).sort(
    (left, right) =>
      left.enclosingFunctionIdentity.localeCompare(
        right.enclosingFunctionIdentity,
      )
      || left.sourceFingerprint.localeCompare(right.sourceFingerprint)
      || left.occurrenceIndex - right.occurrenceIndex,
  );
}

const SPECIAL_ZONE_LAYERS_RUNTIME_BINDING_IDENTITY =
  createP44FunctionParameterBindingIdentity(
    "mutateRuntimeSpecialZoneLayersState",
  );
const SPECIAL_ZONES_WORKBENCH_RUNTIME_BINDING_IDENTITY =
  createP44FunctionParameterBindingIdentity(
    "createSpecialZonesWorkbenchController",
    "$/property:runtimeState",
  );

// Thirty direct writes in the trusted pre-transaction funnel now commit through
// the existing domain owners. Retired sites are checked against 9d4b715a source.
const PROJECT_IMPORT_CROSS_FILE_MIGRATIONS = Object.freeze([
  {
    "domain": "appearance",
    "migrationPhase": "P4.4",
    "operation": "assign",
    "key": "appearancePresets",
    "retiredMutationSites": [
      {
        "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"applyImportedProjectState\",\"ordinal\":0}]}",
        "sourceFingerprint": "0f9ae1ebcc8a4a845e775ff6d179822eaf695d55c6a2a17304a4a23c369d7417",
        "occurrenceIndex": 0
      }
    ],
    "actionModulePath": "js/core/state/actions/appearance_preset_actions.js",
    "actionExportName": "restoreProjectImportFields",
    "replacementActionSourceFingerprint": "0a6d40e9bd64e401e6b879c3eb00ff265c37254a82e49836eb273835b1ac80c1"
  },
  {
    "domain": "appearance",
    "migrationPhase": "P4.4",
    "operation": "assign",
    "key": "intensityFields",
    "retiredMutationSites": [
      {
        "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"applyImportedProjectState\",\"ordinal\":0}]}",
        "sourceFingerprint": "1332594a380f08b078806bea85dc54ed01b1b62fa0cbb36c61f74640042fa7c7",
        "occurrenceIndex": 0
      }
    ],
    "actionModulePath": "js/core/state/actions/intensity_field_actions.js",
    "actionExportName": "restoreProjectImportFields",
    "replacementActionSourceFingerprint": "64bb81d999e029a0086a1289c294c2ef6b97e38dea34ab7476f794c47ca8746c"
  },
  {
    "domain": "color",
    "migrationPhase": "P4.4",
    "operation": "assign",
    "key": "activeSovereignCode",
    "retiredMutationSites": [
      {
        "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"applyImportedProjectState\",\"ordinal\":0}]}",
        "sourceFingerprint": "7c7985c426b2ef8c7434a3ae5facdcfbecf8eef2f0663e31575a0b4ff79e48bd",
        "occurrenceIndex": 0
      }
    ],
    "actionModulePath": "js/core/state/actions/scenario_presentation_actions.js",
    "actionExportName": "restoreProjectImportFields",
    "replacementActionSourceFingerprint": "12453160e64308e63e6e3ae064ec8f4c4cab5271a1576dc76d10640e55ff5f87"
  },
  {
    "domain": "color",
    "migrationPhase": "P4.4",
    "operation": "assign",
    "key": "countryBaseColors",
    "retiredMutationSites": [
      {
        "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"applyImportedProjectState\",\"ordinal\":0}]}",
        "sourceFingerprint": "e4126794838c2dbcbd1abb0b8c7f86cd2612af5d290f0b29837b38eed412dede",
        "occurrenceIndex": 0
      }
    ],
    "actionModulePath": "js/core/state/actions/scenario_activation_actions.js",
    "actionExportName": "restoreProjectImportFields",
    "replacementActionSourceFingerprint": "027f290c51cfbc082ba9460e3fba0653ba03d70c890c5e3d75037cdfba0113f4"
  },
  {
    "domain": "color",
    "migrationPhase": "P4.4",
    "operation": "assign",
    "key": "customPresets",
    "retiredMutationSites": [
      {
        "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"applyImportedProjectState\",\"ordinal\":0}]}",
        "sourceFingerprint": "e93ef4ce0d2be9cbd22a1a74051afa15f2bc69942cedfcaa7c3fc0f4d6b4750a",
        "occurrenceIndex": 0
      }
    ],
    "actionModulePath": "js/core/state/actions/project_import_actions.js",
    "actionExportName": "applyProjectImportPatch",
    "replacementActionSourceFingerprint": "f7663283a39f25a90e6505ceee4240574faa489837fe72cdc717e4f2f6cbc226"
  },
  {
    "domain": "color",
    "migrationPhase": "P4.4",
    "operation": "assign",
    "key": "dynamicBordersDirty",
    "retiredMutationSites": [
      {
        "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"applyImportedProjectState\",\"ordinal\":0}]}",
        "sourceFingerprint": "0ca69e677f6171a341a2e3f05c0a091846966e8b6d36fc755925808228095e25",
        "occurrenceIndex": 0
      }
    ],
    "actionModulePath": "js/core/state/actions/renderer_cache_actions.js",
    "actionExportName": "restoreProjectImportFields",
    "replacementActionSourceFingerprint": "706e1b6663a2d54a7809c98bd43486d58dc556909ce79b5c296660ea6e7e423f"
  },
  {
    "domain": "color",
    "migrationPhase": "P4.4",
    "operation": "assign",
    "key": "dynamicBordersDirtyReason",
    "retiredMutationSites": [
      {
        "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"applyImportedProjectState\",\"ordinal\":0}]}",
        "sourceFingerprint": "963c37de90379372b2f142422a1f5388dde833000e0f91b50026fe0359de48e9",
        "occurrenceIndex": 0
      }
    ],
    "actionModulePath": "js/core/state/actions/renderer_cache_actions.js",
    "actionExportName": "restoreProjectImportFields",
    "replacementActionSourceFingerprint": "706e1b6663a2d54a7809c98bd43486d58dc556909ce79b5c296660ea6e7e423f"
  },
  {
    "domain": "color",
    "migrationPhase": "P4.4",
    "operation": "assign",
    "key": "featureOverrides",
    "retiredMutationSites": [
      {
        "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"applyImportedProjectState\",\"ordinal\":0}]}",
        "sourceFingerprint": "3b815bbc169acf222385ba083209b7ae43caa5e7f28d1ca02002d67b9eba2dd0",
        "occurrenceIndex": 0
      }
    ],
    "actionModulePath": "js/core/state/actions/scenario_activation_actions.js",
    "actionExportName": "restoreProjectImportFields",
    "replacementActionSourceFingerprint": "027f290c51cfbc082ba9460e3fba0653ba03d70c890c5e3d75037cdfba0113f4"
  },
  {
    "domain": "color",
    "migrationPhase": "P4.4",
    "operation": "assign",
    "key": "inspectorExpansionInitialized",
    "retiredMutationSites": [
      {
        "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"applyImportedProjectState\",\"ordinal\":0}]}",
        "sourceFingerprint": "7abf6ae36aab8601aafa0fc5f2f494b60adcb30f444a87fe1ab429af3a3359be",
        "occurrenceIndex": 0
      }
    ],
    "actionModulePath": "js/core/state/actions/scenario_presentation_actions.js",
    "actionExportName": "restoreProjectImportFields",
    "replacementActionSourceFingerprint": "12453160e64308e63e6e3ae064ec8f4c4cab5271a1576dc76d10640e55ff5f87"
  },
  {
    "domain": "color",
    "migrationPhase": "P4.4",
    "operation": "assign",
    "key": "inspectorHighlightCountryCode",
    "retiredMutationSites": [
      {
        "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"applyImportedProjectState\",\"ordinal\":0}]}",
        "sourceFingerprint": "9af03db07ea249b83bab022365c1283941037e0d88ba2683e824a05764d7ac25",
        "occurrenceIndex": 0
      }
    ],
    "actionModulePath": "js/core/state/actions/scenario_presentation_actions.js",
    "actionExportName": "restoreProjectImportFields",
    "replacementActionSourceFingerprint": "12453160e64308e63e6e3ae064ec8f4c4cab5271a1576dc76d10640e55ff5f87"
  },
  {
    "domain": "color",
    "migrationPhase": "P4.4",
    "operation": "assign",
    "key": "mapSemanticMode",
    "retiredMutationSites": [
      {
        "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"applyImportedProjectState\",\"ordinal\":0}]}",
        "sourceFingerprint": "4b51e045be255cd00941075d6dfbe93c85f713e84a806e97ecd2718268eb0bb5",
        "occurrenceIndex": 0
      }
    ],
    "actionModulePath": "js/core/state/actions/scenario_activation_actions.js",
    "actionExportName": "restoreProjectImportFields",
    "replacementActionSourceFingerprint": "027f290c51cfbc082ba9460e3fba0653ba03d70c890c5e3d75037cdfba0113f4"
  },
  {
    "domain": "color",
    "migrationPhase": "P4.4",
    "operation": "assign",
    "key": "paintMode",
    "retiredMutationSites": [
      {
        "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"applyImportedProjectState\",\"ordinal\":0}]}",
        "sourceFingerprint": "c0cbcd34c0dbc98bbe4a8bc038a07a0105b4b1708a90c456175e0b04460cafe3",
        "occurrenceIndex": 0
      }
    ],
    "actionModulePath": "js/core/state/actions/scenario_presentation_actions.js",
    "actionExportName": "restoreProjectImportFields",
    "replacementActionSourceFingerprint": "12453160e64308e63e6e3ae064ec8f4c4cab5271a1576dc76d10640e55ff5f87"
  },
  {
    "domain": "color",
    "migrationPhase": "P4.4",
    "operation": "assign",
    "key": "selectedInspectorCountryCode",
    "retiredMutationSites": [
      {
        "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"applyImportedProjectState\",\"ordinal\":0}]}",
        "sourceFingerprint": "942eb70c80eaa7ab64ef77845085f5a5cd209d36e2b0e21faa332d8cf42168dc",
        "occurrenceIndex": 0
      }
    ],
    "actionModulePath": "js/core/state/actions/scenario_presentation_actions.js",
    "actionExportName": "restoreProjectImportFields",
    "replacementActionSourceFingerprint": "12453160e64308e63e6e3ae064ec8f4c4cab5271a1576dc76d10640e55ff5f87"
  },
  {
    "domain": "color",
    "migrationPhase": "P4.4",
    "operation": "assign",
    "key": "sovereignBaseColors",
    "retiredMutationSites": [
      {
        "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"applyImportedProjectState\",\"ordinal\":0}]}",
        "sourceFingerprint": "868a408a4e36b2138b2cc35e44514a50106c5192875757d6244774b8cfc435fd",
        "occurrenceIndex": 0
      }
    ],
    "actionModulePath": "js/core/state/actions/scenario_activation_actions.js",
    "actionExportName": "restoreProjectImportFields",
    "replacementActionSourceFingerprint": "027f290c51cfbc082ba9460e3fba0653ba03d70c890c5e3d75037cdfba0113f4"
  },
  {
    "domain": "color",
    "migrationPhase": "P4.4",
    "operation": "assign",
    "key": "sovereigntyByFeatureId",
    "retiredMutationSites": [
      {
        "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"applyImportedProjectState\",\"ordinal\":0}]}",
        "sourceFingerprint": "1c21a16465069043a36f6135bde914d868ee7522a79a16e6d3ae9864f4bd34a7",
        "occurrenceIndex": 0
      }
    ],
    "actionModulePath": "js/core/state/actions/scenario_activation_actions.js",
    "actionExportName": "restoreProjectImportFields",
    "replacementActionSourceFingerprint": "027f290c51cfbc082ba9460e3fba0653ba03d70c890c5e3d75037cdfba0113f4"
  },
  {
    "domain": "color",
    "migrationPhase": "P4.4",
    "operation": "assign",
    "key": "sovereigntyInitialized",
    "retiredMutationSites": [
      {
        "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"applyImportedProjectState\",\"ordinal\":0}]}",
        "sourceFingerprint": "b70a43fdb935ca87bf4f7612a7d2abe5063766f52f81b5abd7530a629d652ba9",
        "occurrenceIndex": 0
      }
    ],
    "actionModulePath": "js/core/state/actions/scenario_activation_actions.js",
    "actionExportName": "restoreProjectImportFields",
    "replacementActionSourceFingerprint": "027f290c51cfbc082ba9460e3fba0653ba03d70c890c5e3d75037cdfba0113f4"
  },
  {
    "domain": "color",
    "migrationPhase": "P4.4",
    "operation": "assign",
    "key": "specialRegionOverrides",
    "retiredMutationSites": [
      {
        "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"applyImportedProjectState\",\"ordinal\":0}]}",
        "sourceFingerprint": "df5515a133e8166674abd813076486cfcc871644388d4fe2d1ec92213eabc150",
        "occurrenceIndex": 0
      }
    ],
    "actionModulePath": "js/core/state/actions/project_import_actions.js",
    "actionExportName": "applyProjectImportPatch",
    "replacementActionSourceFingerprint": "f7663283a39f25a90e6505ceee4240574faa489837fe72cdc717e4f2f6cbc226"
  },
  {
    "domain": "color",
    "migrationPhase": "P4.4",
    "operation": "assign",
    "key": "visualOverrides",
    "retiredMutationSites": [
      {
        "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"applyImportedProjectState\",\"ordinal\":0}]}",
        "sourceFingerprint": "d8384d843b1d322145ba6ac69c37dac2ff8f1b00b15ab78726130ef489569818",
        "occurrenceIndex": 0
      }
    ],
    "actionModulePath": "js/core/state/actions/scenario_activation_actions.js",
    "actionExportName": "restoreProjectImportFields",
    "replacementActionSourceFingerprint": "027f290c51cfbc082ba9460e3fba0653ba03d70c890c5e3d75037cdfba0113f4"
  },
  {
    "domain": "color",
    "migrationPhase": "P4.4",
    "operation": "assign",
    "key": "waterRegionOverrides",
    "retiredMutationSites": [
      {
        "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"applyImportedProjectState\",\"ordinal\":0}]}",
        "sourceFingerprint": "425f83ca8b04037fe71987b2986fa4932c6cea6006c5023258e96a8ac942ebcb",
        "occurrenceIndex": 0
      }
    ],
    "actionModulePath": "js/core/state/actions/renderer_interaction_actions.js",
    "actionExportName": "restoreProjectImportFields",
    "replacementActionSourceFingerprint": "09d38f7b372297e512b2877f30826f0cc6ea00300371dc65549c28ac6f824f99"
  },
  {
    "domain": "color",
    "migrationPhase": "P4.4",
    "operation": "collection-mutate",
    "key": "expandedInspectorContinents",
    "retiredMutationSites": [
      {
        "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"applyImportedProjectState\",\"ordinal\":0}]}",
        "sourceFingerprint": "a57a31d6c2fca81072c9d7fd537fcee12bc5ba7cd0140721b5fddd212203ace9",
        "occurrenceIndex": 0
      }
    ],
    "actionModulePath": "js/core/state/actions/scenario_presentation_actions.js",
    "actionExportName": "restoreProjectImportFields",
    "replacementActionSourceFingerprint": "12453160e64308e63e6e3ae064ec8f4c4cab5271a1576dc76d10640e55ff5f87"
  },
  {
    "domain": "color",
    "migrationPhase": "P4.4",
    "operation": "collection-mutate",
    "key": "expandedInspectorReleaseParents",
    "retiredMutationSites": [
      {
        "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"applyImportedProjectState\",\"ordinal\":0}]}",
        "sourceFingerprint": "2f2bb4410e6dc488a1264d084e029974110458c16aad3417b89b4c8e4597e280",
        "occurrenceIndex": 0
      }
    ],
    "actionModulePath": "js/core/state/actions/scenario_presentation_actions.js",
    "actionExportName": "restoreProjectImportFields",
    "replacementActionSourceFingerprint": "12453160e64308e63e6e3ae064ec8f4c4cab5271a1576dc76d10640e55ff5f87"
  },
  {
    "domain": "content",
    "migrationPhase": "P4.2",
    "operation": "assign",
    "key": "parentBordersVisible",
    "retiredMutationSites": [
      {
        "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"applyImportedProjectState\",\"ordinal\":0}]}",
        "sourceFingerprint": "eab8438f20ef8db96363840577e0c523c34833c646be26db4202661ca2999edf",
        "occurrenceIndex": 0
      }
    ],
    "actionModulePath": "js/core/state/actions/appearance_visibility_actions.js",
    "actionExportName": "restoreProjectImportFields",
    "replacementActionSourceFingerprint": "40e84a53516a90a2d7786f690bd83260233e2cf0273bba6fce9e6efe2f36a625"
  },
  {
    "domain": "content",
    "migrationPhase": "P4.2",
    "operation": "assign",
    "key": "specialZones",
    "retiredMutationSites": [
      {
        "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"applyImportedProjectState\",\"ordinal\":0}]}",
        "sourceFingerprint": "62ce8dcde4d9771966acc57de410c07c2796295597aac6846d89a44e4b4d431e",
        "occurrenceIndex": 0
      }
    ],
    "actionModulePath": "js/core/state/actions/project_import_actions.js",
    "actionExportName": "applyProjectImportPatch",
    "replacementActionSourceFingerprint": "f7663283a39f25a90e6505ceee4240574faa489837fe72cdc717e4f2f6cbc226"
  },
  {
    "domain": "renderer",
    "migrationPhase": "P4.3",
    "operation": "assign",
    "key": "parentBorderEnabledByCountry",
    "retiredMutationSites": [
      {
        "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"applyImportedProjectState\",\"ordinal\":0}]}",
        "sourceFingerprint": "7a95e1a466fdbc274005eb39d1dfd961063c62e8ac5fcb2488b0a1dc4d08a954",
        "occurrenceIndex": 0
      }
    ],
    "actionModulePath": "js/core/state/actions/appearance_actions.js",
    "actionExportName": "restoreProjectImportFields",
    "replacementActionSourceFingerprint": "05cf67c17e061cee4ef349b4ddec16635ee17660ea797f3e1b3d4cf3287868ec"
  },
  {
    "domain": "scenario",
    "migrationPhase": "P4.2",
    "operation": "assign",
    "key": "releasableBoundaryVariantByTag",
    "retiredMutationSites": [
      {
        "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"applyImportedProjectState\",\"ordinal\":0}]}",
        "sourceFingerprint": "09d870fb3fd1e131dcae770d3ccea648108db6a18e156bf30579208b395326bf",
        "occurrenceIndex": 0
      }
    ],
    "actionModulePath": "js/core/state/actions/project_import_actions.js",
    "actionExportName": "applyProjectImportPatch",
    "replacementActionSourceFingerprint": "f7663283a39f25a90e6505ceee4240574faa489837fe72cdc717e4f2f6cbc226"
  },
  {
    "domain": "scenario",
    "migrationPhase": "P4.2",
    "operation": "assign",
    "key": "scenarioCountriesByTag",
    "retiredMutationSites": [
      {
        "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"applyImportedProjectState\",\"ordinal\":0}]}",
        "sourceFingerprint": "f4ae5f2a857231d048c6b709dd55b1d63ba28522269b7992c6208f576ee6072e",
        "occurrenceIndex": 0
      }
    ],
    "actionModulePath": "js/core/state/actions/scenario_activation_actions.js",
    "actionExportName": "restoreProjectImportFields",
    "replacementActionSourceFingerprint": "027f290c51cfbc082ba9460e3fba0653ba03d70c890c5e3d75037cdfba0113f4"
  },
  {
    "domain": "scenario",
    "migrationPhase": "P4.2",
    "operation": "assign",
    "key": "scenarioReleasableIndex",
    "retiredMutationSites": [
      {
        "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"applyImportedProjectState\",\"ordinal\":0}]}",
        "sourceFingerprint": "0bdea54b10f65dbed590d87f39b17b32d8bc01fafc97a7cf850c0b234875c31e",
        "occurrenceIndex": 0
      }
    ],
    "actionModulePath": "js/core/state/actions/scenario_activation_actions.js",
    "actionExportName": "restoreProjectImportFields",
    "replacementActionSourceFingerprint": "027f290c51cfbc082ba9460e3fba0653ba03d70c890c5e3d75037cdfba0113f4"
  },
  {
    "domain": "ui",
    "migrationPhase": "P4.4",
    "operation": "assign",
    "key": "manualSpecialZones",
    "retiredMutationSites": [
      {
        "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"applyImportedProjectState\",\"ordinal\":0}]}",
        "sourceFingerprint": "8aa3e7b0990fbe05d38c0751a886371ac8d8053b9037bc9d51c656b6dc187630",
        "occurrenceIndex": 0
      }
    ],
    "actionModulePath": "js/core/state/actions/special_zone_actions.js",
    "actionExportName": "restoreProjectImportFields",
    "replacementActionSourceFingerprint": "d042f8a2502a847f86a67e7abbeac090ded5d66abc8cb97a8e5656435332f09d"
  },
  {
    "domain": "ui",
    "migrationPhase": "P4.4",
    "operation": "assign",
    "key": "specialZoneLayers",
    "retiredMutationSites": [
      {
        "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"applyImportedProjectState\",\"ordinal\":0}]}",
        "sourceFingerprint": "1291a2798123fbefe1db45f2ffbe16ffcefc4553c0e30b311bc4eeae383e457c",
        "occurrenceIndex": 0
      }
    ],
    "actionModulePath": "js/core/state/actions/special_zone_actions.js",
    "actionExportName": "restoreProjectImportFields",
    "replacementActionSourceFingerprint": "d042f8a2502a847f86a67e7abbeac090ded5d66abc8cb97a8e5656435332f09d"
  },
  {
    "domain": "ui",
    "migrationPhase": "P4.4",
    "operation": "assign",
    "key": "specialZoneMembershipBrushMode",
    "retiredMutationSites": [
      {
        "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"applyImportedProjectState\",\"ordinal\":0}]}",
        "sourceFingerprint": "3d4d78f66f3cac4faba58f4ac0e026f428985097d459c6660740298e5f5952c9",
        "occurrenceIndex": 0
      }
    ],
    "actionModulePath": "js/core/state/actions/special_zone_actions.js",
    "actionExportName": "restoreProjectImportFields",
    "replacementActionSourceFingerprint": "d042f8a2502a847f86a67e7abbeac090ded5d66abc8cb97a8e5656435332f09d"
  }
].map((entry) => freezeCrossFileMigrationEntry({
  ...{
  "retiredCallerPath": "js/core/interaction_funnel.js",
  "retiredCallerBindingIdentity": "{\"kind\":\"module\",\"name\":\"state\",\"functionName\":\"\",\"parameterName\":\"\",\"parameterIndex\":0,\"parameterPath\":\"\",\"importSource\":\"./state.js\",\"importedName\":\"state\",\"aliasSources\":[],\"aliasOperators\":[]}",
  "replacementCallerPath": "js/core/interaction_funnel/import_apply_orchestration.js",
  "replacementCallerBindingIdentity": "{\"kind\":\"function-parameter\",\"name\":\"\",\"functionName\":\"commitImportedProjectPatch\",\"parameterName\":\"\",\"parameterIndex\":0,\"parameterPath\":\"$\",\"importSource\":\"\",\"importedName\":\"\",\"aliasSources\":[],\"aliasOperators\":[]}",
  "replacementEnclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"commitImportedProjectPatch\",\"ordinal\":0}]}",
  "targetArgumentIndex": 0
},
  ...entry,
})));

const P44_STATE_ACTION_CROSS_FILE_MIGRATION_CONTRACT = Object.freeze([
  freezeCrossFileMigrationEntry({
  "retiredCallerPath": "js/core/map_renderer/exact_after_settle_scheduler.js",
  "retiredCallerBindingIdentity": "{\"kind\":\"function-parameter\",\"name\":\"\",\"functionName\":\"createExactAfterSettleScheduler\",\"parameterName\":\"\",\"parameterIndex\":0,\"parameterPath\":\"$/property:runtimeState\",\"importSource\":\"\",\"importedName\":\"\",\"aliasSources\":[],\"aliasOperators\":[]}",
  "domain": "renderer",
  "migrationPhase": "P4.3",
  "operation": "assign",
  "key": "deferExactAfterSettle",
  "retiredMutationSites": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createExactAfterSettleScheduler\",\"ordinal\":0},{\"name\":\"abortInterruptedExactAfterSettleRefresh\",\"ordinal\":0}]}",
      "sourceFingerprint": "8be8ff5d1e5e3387ffe359256e797603d09c1eb4713f24a3af377cc1228b3e8d",
      "occurrenceIndex": 0
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createExactAfterSettleScheduler\",\"ordinal\":0},{\"name\":\"abortPendingExactAfterSettleRefreshAfterPaint\",\"ordinal\":0}]}",
      "sourceFingerprint": "8be8ff5d1e5e3387ffe359256e797603d09c1eb4713f24a3af377cc1228b3e8d",
      "occurrenceIndex": 0
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createExactAfterSettleScheduler\",\"ordinal\":0},{\"name\":\"applyExactAfterSettleRefreshPlan\",\"ordinal\":0}]}",
      "sourceFingerprint": "8be8ff5d1e5e3387ffe359256e797603d09c1eb4713f24a3af377cc1228b3e8d",
      "occurrenceIndex": 0
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createExactAfterSettleScheduler\",\"ordinal\":0},{\"name\":\"cancelExactAfterSettleRefresh\",\"ordinal\":0}]}",
      "sourceFingerprint": "8be8ff5d1e5e3387ffe359256e797603d09c1eb4713f24a3af377cc1228b3e8d",
      "occurrenceIndex": 0
    }
  ],
  "replacementCallerPath": "js/core/map_renderer/exact_after_settle_scheduler.js",
  "replacementCallerBindingIdentity": "{\"kind\":\"function-parameter\",\"name\":\"\",\"functionName\":\"createExactAfterSettleScheduler\",\"parameterName\":\"\",\"parameterIndex\":0,\"parameterPath\":\"$/property:runtimeState\",\"importSource\":\"\",\"importedName\":\"\",\"aliasSources\":[],\"aliasOperators\":[]}",
  "replacementEnclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createExactAfterSettleScheduler\",\"ordinal\":0},{\"name\":\"completeScheduledExactAfterSettleRefreshPlan\",\"ordinal\":0}]}",
  "actionModulePath": "js/core/state/actions/renderer_exact_refresh_actions.js",
  "actionExportName": "setDeferExactAfterSettleState",
  "targetArgumentIndex": 0,
  "replacementActionSourceFingerprint": "7e7ef84a5382566d17cb8a9715c0a42581da7ecf5a9e5c425a17f3b595fdb425"
}),
  freezeCrossFileMigrationEntry({
  "retiredCallerPath": "js/ui/toolbar/palette_library_panel.js",
  "retiredCallerBindingIdentity": "{\"kind\":\"module\",\"name\":\"runtimeState\",\"functionName\":\"\",\"parameterName\":\"\",\"parameterIndex\":0,\"parameterPath\":\"\",\"importSource\":\"../../core/state.js\",\"importedName\":\"state\",\"aliasSources\":[],\"aliasOperators\":[]}",
  "domain": "color",
  "migrationPhase": "P4.4",
  "operation": "assign",
  "key": "selectedColor",
  "retiredMutationSites": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createPaletteLibraryPanelController\",\"ordinal\":0},{\"name\":\"selectPaletteLibraryEntry\",\"ordinal\":0}]}",
      "sourceFingerprint": "44f205f7b042beac7faa6d0be234297e11f83fddafd1ad9e1fb29daedca94437",
      "occurrenceIndex": 0
    }
  ],
  "replacementCallerPath": "js/ui/toolbar/palette_library_panel.js",
  "replacementCallerBindingIdentity": "{\"kind\":\"module\",\"name\":\"runtimeState\",\"functionName\":\"\",\"parameterName\":\"\",\"parameterIndex\":0,\"parameterPath\":\"\",\"importSource\":\"../../core/state.js\",\"importedName\":\"state\",\"aliasSources\":[],\"aliasOperators\":[]}",
  "replacementEnclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"selectPalettePaintColor\",\"ordinal\":0}]}",
  "actionModulePath": "js/core/state/actions/palette_library_actions.js",
  "actionExportName": "selectPalettePaintColorState",
  "targetArgumentIndex": 0,
  "replacementActionSourceFingerprint": "3789682e921f8f8d954e73d51fde93ec102f9ceec32c4623accdec27ceca9387"
}),
  freezeCrossFileMigrationEntry({
  "retiredCallerPath": "js/core/map_renderer.js",
  "retiredCallerBindingIdentity": "{\"kind\":\"module\",\"name\":\"runtimeState\",\"functionName\":\"\",\"parameterName\":\"\",\"parameterIndex\":0,\"parameterPath\":\"\",\"importSource\":\"./state.js\",\"importedName\":\"state\",\"aliasSources\":[],\"aliasOperators\":[]}",
  "domain": "renderer",
  "migrationPhase": "P4.3",
  "operation": "collection-mutate",
  "key": "cachedCoastlines",
  "retiredMutationSites": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"rebuildStaticMeshes\",\"ordinal\":0}]}",
      "sourceFingerprint": "611fcc7f87581c5a3db45e588a18a9ae6ed945ef97b6293fd51df5f7de370052",
      "occurrenceIndex": 0
    }
  ],
  "replacementCallerPath": "js/core/renderer/border_mesh_owner.js",
  "replacementCallerBindingIdentity": "{\"kind\":\"function-parameter\",\"name\":\"\",\"functionName\":\"createBorderMeshOwner\",\"parameterName\":\"\",\"parameterIndex\":0,\"parameterPath\":\"$/property:state\",\"importSource\":\"\",\"importedName\":\"\",\"aliasSources\":[],\"aliasOperators\":[]}",
  "replacementEnclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createBorderMeshOwner\",\"ordinal\":0},{\"name\":\"ensureCoastlineMeshes\",\"ordinal\":0}]}",
  "actionModulePath": "js/core/state/actions/renderer_cache_actions.js",
  "actionExportName": "replaceCachedCoastlineMeshesState",
  "targetArgumentIndex": 0,
  "replacementActionSourceFingerprint": "0020990e5c184be2f706d2e24cae42453cc38f2b3b0e27f0668c055ac6fd8833"
}),
  freezeCrossFileMigrationEntry({
  "retiredCallerPath": "js/core/map_renderer.js",
  "retiredCallerBindingIdentity": "{\"kind\":\"module\",\"name\":\"runtimeState\",\"functionName\":\"\",\"parameterName\":\"\",\"parameterIndex\":0,\"parameterPath\":\"\",\"importSource\":\"./state.js\",\"importedName\":\"state\",\"aliasSources\":[],\"aliasOperators\":[]}",
  "domain": "renderer",
  "migrationPhase": "P4.3",
  "operation": "collection-mutate",
  "key": "cachedCoastlinesHigh",
  "retiredMutationSites": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"rebuildStaticMeshes\",\"ordinal\":0}]}",
      "sourceFingerprint": "91282517c517e91cec5cb796358e6a04dd1ade1d60921860e4d619b332c6b5f9",
      "occurrenceIndex": 0
    }
  ],
  "replacementCallerPath": "js/core/renderer/border_mesh_owner.js",
  "replacementCallerBindingIdentity": "{\"kind\":\"function-parameter\",\"name\":\"\",\"functionName\":\"createBorderMeshOwner\",\"parameterName\":\"\",\"parameterIndex\":0,\"parameterPath\":\"$/property:state\",\"importSource\":\"\",\"importedName\":\"\",\"aliasSources\":[],\"aliasOperators\":[]}",
  "replacementEnclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createBorderMeshOwner\",\"ordinal\":0},{\"name\":\"ensureCoastlineMeshes\",\"ordinal\":0}]}",
  "actionModulePath": "js/core/state/actions/renderer_cache_actions.js",
  "actionExportName": "replaceCachedCoastlineMeshesState",
  "targetArgumentIndex": 0,
  "replacementActionSourceFingerprint": "0020990e5c184be2f706d2e24cae42453cc38f2b3b0e27f0668c055ac6fd8833"
}),
  freezeCrossFileMigrationEntry({
  "retiredCallerPath": "js/core/map_renderer.js",
  "retiredCallerBindingIdentity": "{\"kind\":\"module\",\"name\":\"runtimeState\",\"functionName\":\"\",\"parameterName\":\"\",\"parameterIndex\":0,\"parameterPath\":\"\",\"importSource\":\"./state.js\",\"importedName\":\"state\",\"aliasSources\":[],\"aliasOperators\":[]}",
  "domain": "renderer",
  "migrationPhase": "P4.3",
  "operation": "collection-mutate",
  "key": "cachedCoastlinesLow",
  "retiredMutationSites": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"rebuildStaticMeshes\",\"ordinal\":0}]}",
      "sourceFingerprint": "0b7d14d37c235f60bb0ba3cfe3ea32dfe6986eb38447c204ee86333d8dfa5945",
      "occurrenceIndex": 0
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"rebuildStaticMeshes\",\"ordinal\":0}]}",
      "sourceFingerprint": "55da8beadf7f014680a5347c9092103a4fe78ee55cb8828506abda831aa735fd",
      "occurrenceIndex": 0
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"rebuildStaticMeshes\",\"ordinal\":0}]}",
      "sourceFingerprint": "9d402cbd63c62572ae2024b7a74680c0fdedd3eb66c2cae3a46c539710c0b1a5",
      "occurrenceIndex": 0
    }
  ],
  "replacementCallerPath": "js/core/renderer/border_mesh_owner.js",
  "replacementCallerBindingIdentity": "{\"kind\":\"function-parameter\",\"name\":\"\",\"functionName\":\"createBorderMeshOwner\",\"parameterName\":\"\",\"parameterIndex\":0,\"parameterPath\":\"$/property:state\",\"importSource\":\"\",\"importedName\":\"\",\"aliasSources\":[],\"aliasOperators\":[]}",
  "replacementEnclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createBorderMeshOwner\",\"ordinal\":0},{\"name\":\"ensureCoastlineMeshes\",\"ordinal\":0}]}",
  "actionModulePath": "js/core/state/actions/renderer_cache_actions.js",
  "actionExportName": "replaceCachedCoastlineMeshesState",
  "targetArgumentIndex": 0,
  "replacementActionSourceFingerprint": "0020990e5c184be2f706d2e24cae42453cc38f2b3b0e27f0668c055ac6fd8833"
}),
  freezeCrossFileMigrationEntry({
  "retiredCallerPath": "js/core/map_renderer.js",
  "retiredCallerBindingIdentity": "{\"kind\":\"module\",\"name\":\"runtimeState\",\"functionName\":\"\",\"parameterName\":\"\",\"parameterIndex\":0,\"parameterPath\":\"\",\"importSource\":\"./state.js\",\"importedName\":\"state\",\"aliasSources\":[],\"aliasOperators\":[]}",
  "domain": "renderer",
  "migrationPhase": "P4.3",
  "operation": "collection-mutate",
  "key": "cachedCoastlinesMid",
  "retiredMutationSites": [
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"rebuildStaticMeshes\",\"ordinal\":0}]}",
      "sourceFingerprint": "8319521b0fd126243a85d1630c4a4ae6ba8a3d4b9f6380c7ecffa8d8a33c7079",
      "occurrenceIndex": 0
    },
    {
      "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"rebuildStaticMeshes\",\"ordinal\":0}]}",
      "sourceFingerprint": "ec1f108a6ca112335b73147b03ea9e75d380c0cd3e1f472a04b57f3890295004",
      "occurrenceIndex": 0
    }
  ],
  "replacementCallerPath": "js/core/renderer/border_mesh_owner.js",
  "replacementCallerBindingIdentity": "{\"kind\":\"function-parameter\",\"name\":\"\",\"functionName\":\"createBorderMeshOwner\",\"parameterName\":\"\",\"parameterIndex\":0,\"parameterPath\":\"$/property:state\",\"importSource\":\"\",\"importedName\":\"\",\"aliasSources\":[],\"aliasOperators\":[]}",
  "replacementEnclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createBorderMeshOwner\",\"ordinal\":0},{\"name\":\"ensureCoastlineMeshes\",\"ordinal\":0}]}",
  "actionModulePath": "js/core/state/actions/renderer_cache_actions.js",
  "actionExportName": "replaceCachedCoastlineMeshesState",
  "targetArgumentIndex": 0,
  "replacementActionSourceFingerprint": "0020990e5c184be2f706d2e24cae42453cc38f2b3b0e27f0668c055ac6fd8833"
}),
  ...PROJECT_IMPORT_CROSS_FILE_MIGRATIONS,
  freezeCrossFileMigrationEntry({
    retiredCallerPath:
      "js/core/renderer/strategic_overlay_runtime_owner.js",
    retiredCallerBindingIdentity:
      createP44FunctionParameterBindingIdentity(
        "createStrategicOverlayRuntimeOwner",
        "$/property:state",
      ),
    domain: "ui",
    migrationPhase: "P4.4",
    operation: "assign",
    key: "specialZoneLayers",
    retiredMutationSites: createP44RetiredMutationSites([
      {
        ancestryNames: [
          "createStrategicOverlayRuntimeOwner",
          "applySpecialZoneMembershipFeature",
        ],
        sites: [
          ["1291a2798123fbefe1db45f2ffbe16ffcefc4553c0e30b311bc4eeae383e457c", 0],
          ["1291a2798123fbefe1db45f2ffbe16ffcefc4553c0e30b311bc4eeae383e457c", 1],
        ],
      },
      {
        ancestryNames: [
          "createStrategicOverlayRuntimeOwner",
          "getActiveSpecialZoneMembershipLayerId",
        ],
        sites: [[
          "1291a2798123fbefe1db45f2ffbe16ffcefc4553c0e30b311bc4eeae383e457c",
          0,
        ]],
      },
    ]),
    replacementCallerPath:
      "js/core/renderer/strategic_overlay_runtime_owner.js",
    replacementCallerBindingIdentity:
      createP44FunctionParameterBindingIdentity(
        "createStrategicOverlayRuntimeOwner",
        "$/property:state",
      ),
    replacementEnclosingFunctionIdentity: createP44FunctionIdentity(
      "createStrategicOverlayRuntimeOwner",
      "applySpecialZoneMembershipFeature",
    ),
    actionModulePath: SPECIAL_ZONE_ACTION_MODULE_PATH,
    actionExportName: "commitSpecialZoneLayersState",
    targetArgumentIndex: 0,
    replacementActionSourceFingerprint:
      "3f14d5bf000c4e3f160bc97d261817e2bb7b02987a3945af45e8c9cef0d5d452",
  }),
  freezeCrossFileMigrationEntry({
    retiredCallerPath: "js/core/special_zone_layers.js",
    retiredCallerBindingIdentity:
      SPECIAL_ZONE_LAYERS_RUNTIME_BINDING_IDENTITY,
    domain: "ui",
    migrationPhase: "P4.4",
    operation: "assign",
    key: "specialZoneLayers",
    retiredMutationSites: createP44RetiredMutationSites([
      {
        ancestryNames: ["mutateRuntimeSpecialZoneLayersState"],
        sites: [[
          "fd5d59cac0c899e80a5991627c4cc1859c15fda0958a28b5951d709e90fff62d",
          0,
        ]],
      },
      {
        ancestryNames: ["normalizeRuntimeSpecialZoneLayersState"],
        sites: [[
          "fd5d59cac0c899e80a5991627c4cc1859c15fda0958a28b5951d709e90fff62d",
          0,
        ]],
      },
    ]),
    replacementCallerPath: "js/ui/toolbar/special_zones_workbench_controller.js",
    replacementCallerBindingIdentity:
      SPECIAL_ZONES_WORKBENCH_RUNTIME_BINDING_IDENTITY,
    replacementEnclosingFunctionIdentity: createP44FunctionIdentity(
      "createSpecialZonesWorkbenchController",
      "updateState",
    ),
    actionModulePath: SPECIAL_ZONE_ACTION_MODULE_PATH,
    actionExportName: "commitSpecialZoneLayersState",
    targetArgumentIndex: 0,
    replacementActionSourceFingerprint:
      "12c6ebda6b0b647f6b1c3377f0fd131880cd41f7d60493df600f4abc3401a48e",
  }),
  freezeCrossFileMigrationEntry({
    retiredCallerPath: "js/core/special_zone_layers.js",
    retiredCallerBindingIdentity:
      createP44FunctionParameterBindingIdentity(
        "setSpecialZoneMembershipBrushModeState",
      ),
    domain: "ui",
    migrationPhase: "P4.4",
    operation: "assign",
    key: "specialZoneMembershipBrushMode",
    retiredMutationSites: createP44RetiredMutationSites([{
      ancestryNames: ["setSpecialZoneMembershipBrushModeState"],
      sites: [[
        "5e5dd8b8a8bd0551d98e2873643108e5d78b1f270ef6226d12525e4e48014b2a",
        0,
      ]],
    }]),
    replacementCallerPath:
      "js/ui/toolbar/special_zones_workbench_controller.js",
    replacementCallerBindingIdentity:
      SPECIAL_ZONES_WORKBENCH_RUNTIME_BINDING_IDENTITY,
    replacementEnclosingFunctionIdentity: createP44FunctionIdentity(
      "createSpecialZonesWorkbenchController",
      "renderActions",
      { name: "<anonymous>", ordinal: 1 },
      "<anonymous>",
    ),
    actionModulePath: SPECIAL_ZONE_ACTION_MODULE_PATH,
    actionExportName: "setSpecialZoneMembershipBrushModeState",
    targetArgumentIndex: 0,
    replacementActionSourceFingerprint:
      "7189e7f4fb3f9e8ec59351b7d685080a793fc4427c8791b12bf31d0c90c39bdb",
  }),
  freezeCrossFileMigrationEntry({
    retiredCallerPath: "js/core/special_zone_layers.js",
    retiredCallerBindingIdentity:
      createP44FunctionParameterBindingIdentity(
        "setSpecialZonePresetCategoryState",
      ),
    domain: "ui",
    migrationPhase: "P4.4",
    operation: "assign",
    key: "specialZonePresetCategory",
    retiredMutationSites: createP44RetiredMutationSites([{
      ancestryNames: ["setSpecialZonePresetCategoryState"],
      sites: [[
        "8974b9efefc036debb37c12e45838cb20cf39ee932090ec5ce8e99893dfe3470",
        0,
      ]],
    }]),
    replacementCallerPath:
      "js/ui/toolbar/special_zones_workbench_controller.js",
    replacementCallerBindingIdentity:
      SPECIAL_ZONES_WORKBENCH_RUNTIME_BINDING_IDENTITY,
    replacementEnclosingFunctionIdentity: createP44FunctionIdentity(
      "createSpecialZonesWorkbenchController",
      "renderPresetList",
    ),
    actionModulePath: SPECIAL_ZONE_ACTION_MODULE_PATH,
    actionExportName: "setSpecialZonePresetCategoryState",
    targetArgumentIndex: 0,
    replacementActionSourceFingerprint:
      "8a0095351d0567c92a99e6983e8f089d0641480ddedea853e9a07bfb42b07f16",
  }),
  freezeCrossFileMigrationEntry({
    retiredCallerPath: "js/core/state/appearance_preset_state.js",
    retiredCallerBindingIdentity:
      createP44FunctionParameterBindingIdentity(
        "applyAppearancePresetToRuntimeState",
      ),
    domain: "appearance",
    migrationPhase: "P4.4",
    operation: "assign",
    key: "intensityFields",
    retiredMutationSites: createP44RetiredMutationSites([{
      ancestryNames: ["applyAppearancePresetToRuntimeState"],
      sites: [[
        "946f6a319281398d673ee3c036de665c727bd75b529be02f2a30a8fb8ab3e279",
        0,
      ]],
    }]),
    replacementCallerPath: APPEARANCE_PRESET_ACTION_MODULE_PATH,
    replacementCallerBindingIdentity:
      createP44FunctionParameterBindingIdentity(
        "applyAppearancePresetState",
      ),
    replacementEnclosingFunctionIdentity: createP44FunctionIdentity(
      "applyAppearancePresetState",
    ),
    actionModulePath: INTENSITY_FIELD_ACTION_MODULE_PATH,
    actionExportName: "setIntensityFieldsState",
    targetArgumentIndex: 0,
    replacementActionSourceFingerprint:
      "535fe9d6b0c542302e1ac6634777f399de33c1643b8afddc9196d5010b0d6116",
  }),
  freezeCrossFileMigrationEntry({
    retiredCallerPath:
      "js/ui/toolbar/special_zones_workbench_controller.js",
    retiredCallerBindingIdentity:
      SPECIAL_ZONES_WORKBENCH_RUNTIME_BINDING_IDENTITY,
    domain: "ui",
    migrationPhase: "P4.4",
    operation: "assign",
    key: "specialZonePresetOpenCategories",
    retiredMutationSites: createP44RetiredMutationSites([{
      ancestryNames: [
        "createSpecialZonesWorkbenchController",
        "setPresetCategoryOpen",
      ],
      sites: [[
        "2cc6e6d94aebd8e6d313ca92316f7f5a2761b6d736787934e1a55f0e7f679696",
        0,
      ]],
    }]),
    replacementCallerPath:
      "js/ui/toolbar/special_zones_workbench_controller.js",
    replacementCallerBindingIdentity:
      SPECIAL_ZONES_WORKBENCH_RUNTIME_BINDING_IDENTITY,
    replacementEnclosingFunctionIdentity: createP44FunctionIdentity(
      "createSpecialZonesWorkbenchController",
      "renderPresetList",
      { name: "<anonymous>", ordinal: 2 },
      "<anonymous>",
    ),
    actionModulePath: SPECIAL_ZONE_ACTION_MODULE_PATH,
    actionExportName: "setSpecialZonePresetCategoryOpenState",
    targetArgumentIndex: 0,
    replacementActionSourceFingerprint:
      "6e12e5ca425b30af2198b5ba4340dc7bc23281ea37669cd0badea79c4011b208",
  }),
  freezeCrossFileMigrationEntry({
    retiredCallerPath:
      "js/ui/toolbar/transport_workbench_state_owner.js",
    retiredCallerBindingIdentity:
      createP44FunctionParameterBindingIdentity(
        "createTransportWorkbenchStateOwner",
      ),
    domain: "ui",
    migrationPhase: "P4.4",
    operation: "assign",
    key: "transportWorkbenchUi",
    retiredMutationSites: createP44RetiredMutationSites([
      {
        ancestryNames: [
          "createTransportWorkbenchStateOwner",
          "ensureUiState",
          "<anonymous>",
        ],
        sites: [
          ["15d8441f3ae119a9a623c79d045e4f0b545d0a96f22d75feda52ba7b30f719ba", 0],
          ["1fea22062de58fa34759270e6e286c230ebf40fe44d78a0f6c4078980ebdc9b0", 0],
        ],
      },
      {
        ancestryNames: [
          "createTransportWorkbenchStateOwner",
          "ensureUiState",
          { name: "<anonymous>", ordinal: 1 },
        ],
        sites: [[
          "1141a006bbb8c9dd1dd5c5a6b00cd128729edfd5ef38f3ea063031901a5b0815",
          0,
        ]],
      },
      {
        ancestryNames: [
          "createTransportWorkbenchStateOwner",
          "ensureUiState",
        ],
        sites: [
          ["062287f59a14e3732527bbc7631733159e035c51eb8b77ccfaa2378f651f1816", 0],
          ["0c5e5f272e9baedb3514f218de21996d2f92f57379b713171d2904bd430d8770", 0],
          ["12034e88d2b675bbf84eaab74457eab7186a62b51aa6ea8299c23df111634d3a", 0],
          ["1903e7bc551e989fcbef98135eb8ea68044f6ced6f99d41738fbd7bcae0b7f1d", 0],
          ["2559b08f953884841c0e30559d17c1b264ad62af09ed8fd95b88f2cb674e8a53", 0],
          ["3c0b5b723944efac5970332ac1665d085df36cb5feafb7c3697236831e8c0079", 0],
          ["5c773ee9856917ecb86935be609a74a2ef0020ab87d1d7dcdfbc7747a0c87f52", 0],
          ["6d829e5bc4ac2e1a134dbed22c116e9fb75a9f6e49194c0ae67dd311b7f91261", 0],
          ["820c55211545e1649024cf5d666c6b56651f615120b14604fd69d473b56cadd7", 0],
          ["89e502302c3ca280863d22d27c00376babca7f1ffac984178574fc4630e9a822", 0],
          ["968cf382902794b700944ec584b623f0d4e16d68a36a52c777a751c81d7b0299", 0],
          ["968cf382902794b700944ec584b623f0d4e16d68a36a52c777a751c81d7b0299", 1],
          ["9ed05ee9265bc976779837292dc7309ec9e1d08b6de76bb6c69a8a2a0aef83d1", 0],
          ["a3aeef74900b9ef783b6eec12933c7bbbfcad78e83bd62bfa31fe5e061f64d07", 0],
          ["a3af889be4340e887f1baffad83a7e6e9cb6067405ea1a5691911cf00c31c65b", 0],
          ["c9e4646252e01d2a46cea3ae25232bcb830b46cef055530e5670d70eafb48a4d", 0],
          ["cb08e730ca2930414e9249868bf49776f9f5df1df13299289b8dfb2e511a7de3", 0],
          ["cc9f012bf56e1b13d12fd87664bb9bc733125647c471c583e87f8dce1a250e83", 0],
          ["cf50cc6b126f6e7dbe50858558a7191a94ccfce21826c5850e3dcaab8deb7e3e", 0],
          ["fbe8a2df71c436aa38348eb40ab901599857534f0a11005ae47831a8d5d1babd", 0],
        ],
      },
    ]),
    replacementCallerPath:
      "js/ui/toolbar/transport_workbench_state_owner.js",
    replacementCallerBindingIdentity:
      createP44FunctionParameterBindingIdentity(
        "createTransportWorkbenchStateOwner",
      ),
    replacementEnclosingFunctionIdentity: createP44FunctionIdentity(
      "createTransportWorkbenchStateOwner",
      "ensureUiState",
    ),
    actionModulePath: TRANSPORT_ACTION_MODULE_PATH,
    actionExportName: "commitTransportWorkbenchUiState",
    targetArgumentIndex: 0,
    replacementActionSourceFingerprint:
      "85d3ce37f43c75489f0a70fd113db7d32176444cd863d7f87eb10a84e8c88c73",
  }),
]);

// Exact sites from the accepted legacy runtime binding. Other helper sites were
// included in its historical alias inventory and remain attached to that identity.
const SCENARIO_RUNTIME_ACTIVATION_RETIREMENT_SITES = Object.freeze([
  ["content","P4.2","countryNames",[["commitScenarioActivationRuntimeState","2056cc09c73402372ce04124bc4b31407c04ae5c2e22570f7e61a748aeebe4cc",0]]],
  ["content","P4.2","runtimePoliticalTopology",[["setHydratedScenarioRuntimeTopologyState","7c79ce87ed3afd70157aa6ec4b560f657e44eba02b320e8eac688f2624497d5a",0]]],
  ["scenario","P4.2","activeScenarioId",[["commitScenarioActivationRuntimeState","bd369a1292cb1ede5f46d5d758d262e7fce395703e9ef4f3d1ff1267f1dce205",0]]],
  ["scenario","P4.2","activeScenarioManifest",[["commitScenarioActivationRuntimeState","2d792f7a7fa349746ba09de6391105a90b1eb87c5a011803a029b48a773ae6c5",0]]],
  ["scenario","P4.2","activeScenarioMeshPack",[["setScenarioRuntimeOptionalLayerState","5e2e66a53e0938d8f9e54df0c2938eed3a81cfd7697e0539b6101f675b866b4c",0]]],
  ["scenario","P4.2","releasableCatalog",[["commitScenarioActivationRuntimeState","1ab4fc30e1e34c63672da79831952915a35b4ef0162b6fb5f5adda03fcd7a612",0]]],
  ["scenario","P4.2","runtimePoliticalFeatureCollectionSeed",[["setHydratedScenarioRuntimeTopologyState","7729e20136497c1b5d2240d0d0e01aacb0555d60563d77ca9fa690dd0b1477c9",0]]],
  ["scenario","P4.2","scenarioAtlantropaData",[["setHydratedScenarioRuntimeTopologyState","eb50d09e45215fb82384a4b1272ac8081c7d457a50546df8cfdbe88ee27fc5f5",0],["setScenarioRuntimeOptionalLayerState","eb50d09e45215fb82384a4b1272ac8081c7d457a50546df8cfdbe88ee27fc5f5",0]]],
  ["scenario","P4.2","scenarioAudit",[["commitScenarioActivationRuntimeState","730ca51c52daa1adaa9212db4161f700763eddeaf732b8ddc608400eba336839",0]]],
  ["scenario","P4.2","scenarioAutoShellOwnerByFeatureId",[["commitScenarioActivationRuntimeState","d4516f7259b5fcb7008a9e30aff8fc0e0e08fbd0ac7ac4328d189ab52bcc2c67",0]]],
  ["scenario","P4.2","scenarioBaselineCoresByFeatureId",[["commitScenarioActivationRuntimeState","2151a7bd5878989590020be07564297f1041995a1793dde7eb8765acde9d3590",0]]],
  ["scenario","P4.2","scenarioBaselineHash",[["commitScenarioActivationRuntimeState","3127f8e4844e24f90a688ea449776d197eb0d511043c6039b504eb9e6711f23a",0]]],
  ["scenario","P4.2","scenarioBaselineOwnersByFeatureId",[["commitScenarioActivationRuntimeState","c7de762b3e9b391fabb3af810c302c8829a91ef23e86b020c5d562071565764e",0]]],
  ["scenario","P4.2","scenarioBorderMode",[["commitScenarioActivationRuntimeState","72acb3c506c0b737708447c8948e46869da3bcffb08d28dfbc786658f3f95ea0",0]]],
  ["scenario","P4.2","scenarioContextLandMaskData",[["setHydratedScenarioRuntimeTopologyState","45481e50b8dcfd44657b7ce76357255a62fa1e79a3315ba50ce8d7287112b617",0]]],
  ["scenario","P4.2","scenarioContextLandMaskVersionTag",[["setHydratedScenarioRuntimeTopologyState","7693d4486623c499acfe17e8113f612322ee3fc0d1fc96aae7eadb3f6301cce6",0]]],
  ["scenario","P4.2","scenarioCountriesByTag",[["commitScenarioActivationRuntimeState","b792fa5956fdbc7bcf77e4e6c0a500f35c3dffde2ac18796c30b4dc2c7c269e3",0]]],
  ["scenario","P4.2","scenarioDisplaySettingsBeforeActivate",[["commitScenarioActivationRuntimeState","7959b2a5d48c4c3e4bb5c430ec641dff652e79f1d7e6fbf9f89943577f65f2e2",0]]],
  ["scenario","P4.2","scenarioDistrictGroupByFeatureId",[["setScenarioRuntimeOptionalLayerState","7e2e7d3f266f8d480700a142c4549a79bd6d930405643e2b4d27d2fe5372568b",0]]],
  ["scenario","P4.2","scenarioDistrictGroupsData",[["setScenarioRuntimeOptionalLayerState","0289b33b68d678600fcf56ca8e7c6f95542c21035cd0af7d68f82e5a4ac4cbc9",0]]],
  ["scenario","P4.2","scenarioFixedOwnerColors",[["commitScenarioActivationRuntimeState","bf8ad4f8133f4fd8df6f295a83188b8dda05b693d2f15716ae8a509935d5a2a4",0]]],
  ["scenario","P4.2","scenarioGeneratedColorTags",[["commitScenarioActivationRuntimeState","f6e4e4a3e444a2b9a5b9c4f64567ed4dc1fd69b037b2fab37481a11735a3f2c4",0]]],
  ["scenario","P4.2","scenarioImportAudit",[["setScenarioImportAudit","fdf3c16fc76398268eb53d97344de62ee916cc40bd99fd6475fd0f23e1e3c62e",0]]],
  ["scenario","P4.2","scenarioLandMaskData",[["setHydratedScenarioRuntimeTopologyState","bf1b21ae881142d7bdb6d9e2a17208e9d1a23028f20dc61c08ac8279442d70db",0]]],
  ["scenario","P4.2","scenarioLandMaskVersionTag",[["setHydratedScenarioRuntimeTopologyState","5d061a13bd1dc5e4b01d673a85f04a79b6a7e2e0409fabf371bd2bd34d266c98",0]]],
  ["scenario","P4.2","scenarioOceanFillBeforeActivate",[["commitScenarioActivationRuntimeState","9015d1a6e0aa545fe7fad7c15b55c62f21903c625eb91193400eca2481dce95d",0]]],
  ["scenario","P4.2","scenarioParentBorderEnabledBeforeActivate",[["commitScenarioActivationRuntimeState","4c427a80189d1528b0b5f0abcd27c74ade0f221d487c8789e3972a29a1f1f477",0]]],
  ["scenario","P4.2","scenarioReleasableIndex",[["commitScenarioActivationRuntimeState","f0ba3b0d2ea4bbfff441a11b39f78d65abd77dc2a4d4df77b428aa2d93a49b63",0]]],
  ["scenario","P4.2","scenarioReliefOverlayRevision",[["commitScenarioActivationRuntimeState","7942e311ef88490009112a0e07967bff829383cf9c6619db5ce4ae029dc215f9",0]]],
  ["scenario","P4.2","scenarioReliefOverlaysData",[["setScenarioRuntimeOptionalLayerState","ed4e5d804c1a516b7b0bd125f7741e3211534d3584bc23670071fcd8be63bb49",0]]],
  ["scenario","P4.2","scenarioRuntimeTopologyData",[["setHydratedScenarioRuntimeTopologyState","44e387f873dc72f924626173fb722c9e21cf0a539f3ed8bcd30443229d48d58c",0]]],
  ["scenario","P4.2","scenarioRuntimeTopologyVersionTag",[["setHydratedScenarioRuntimeTopologyState","05dd25f51044a513c43c7b9f1eb53e0da81a0804940fd58683be69086e699324",0]]],
  ["scenario","P4.2","scenarioShellOverlayRevision",[["commitScenarioActivationRuntimeState","b1fe2753865bec05418547a1efe5222a8c4ca6c11b331b5fc961f7edc18fafb5",0]]],
  ["scenario","P4.2","scenarioSpecialRegionsData",[["setHydratedScenarioRuntimeTopologyState","67ddb3688c7cbc3377a2753d60ba82848608238fe5b590eb8520a3384089164b",0]]],
  ["scenario","P4.2","scenarioStrategicValuesData",[["setScenarioRuntimeOptionalLayerState","9ab060f3c649618f1bc9c756759b6000854554694575a6819e4d695d2eb5f3d0",0]]],
  ["scenario","P4.2","scenarioStrategicValuesRevision",[["commitScenarioActivationRuntimeState","d368c71f3a740ff67781c3a114fe9a201b092e063ff2e23a292df33eff637a0e",0]]],
  ["scenario","P4.2","scenarioWaterOverlayVersionTag",[["setHydratedScenarioRuntimeTopologyState","fab314be262e3032e9608d6e1b00fa29870023d8ccb139b7266c9f5b6f853d2a",0]]],
  ["scenario","P4.2","scenarioWaterRegionsData",[["setHydratedScenarioRuntimeTopologyState","a9496855c3fa5928e180ecf5d6051d30353a331f33421d3654a8441528c72cda",0]]],
  ["color","P4.4","activeSovereignCode",[["commitScenarioActivationRuntimeState","2ba937d8d87d527a5db51b5af8741ac0e6cc145af761d47a3907a64e0a65f45e",0]]],
  ["color","P4.4","countryBaseColors",[["commitScenarioActivationRuntimeState","89a636795bd9ee6c0394b79bc47bf7112053abb38ab524e4a4c9e7c886167be3",0]]],
  ["color","P4.4","featureOverrides",[["commitScenarioActivationRuntimeState","91797c98eda2738dad0538aa3e14d8d6d7aa3e13582adc29f7ac91467f51daa6",0]]],
  ["color","P4.4","mapSemanticMode",[["commitScenarioActivationRuntimeState","020941e32826bea82b50c66c0b97fb8ad3dcb55698d0f95c3912b852fc468c66",0]]],
  ["color","P4.4","runtimePoliticalMetaSeed",[["setHydratedScenarioRuntimeTopologyState","b228be7638d09476d251534b10049727719b073e3d532acadbe7aaa2b23abbc0",0]]],
  ["color","P4.4","sovereignBaseColors",[["commitScenarioActivationRuntimeState","93cc53b07fcdcd5ab4b97f665261878b1116e2d11b2139ccdff185db2512f8ea",0]]],
  ["color","P4.4","sovereigntyByFeatureId",[["commitScenarioActivationRuntimeState","044082ea4674883e56dc17db0d3c4cba046d3917a57843d3e8c698351e462912",0]]],
  ["color","P4.4","sovereigntyInitialized",[["commitScenarioActivationRuntimeState","beb2fc734eb1ec5534a79cc94de89af242eb5bb0dba56ba717aca2d1c34d6f4b",0]]],
  ["color","P4.4","visualOverrides",[["commitScenarioActivationRuntimeState","480611b47858cfa78e28a67a707381b5650bdb07cc4344ac8c8feb58c2889b88",0]]],
  ["ui","P4.4","hoveredSpecialRegionId",[["commitScenarioActivationRuntimeState","3c7bc432868410f0b023a73221231d6d9ceb1bd5e9792c984c1fe9d796a8c780",0]]],
  ["ui","P4.4","hoveredWaterRegionId",[["commitScenarioActivationRuntimeState","ca42ea3ab8820520e007314efcf5537fa3f399c8889e75e5970832234de7cdf3",0]]],
  ["ui","P4.4","selectedSpecialRegionId",[["commitScenarioActivationRuntimeState","7e391a023e99cad9790eb33e9022ba91ac2740422a63f7ebd0d30f260ad4d426",0]]],
  ["ui","P4.4","selectedWaterRegionId",[["commitScenarioActivationRuntimeState","09da3fc2a4b3b4028976afc8221998632f7b205c0b84511220be61452600c6fd",0]]],
]);

function createScenarioRuntimeActivationRetirementEntry([domain, migrationPhase, key, sites]) {
  const presentation = [
    "scenarioDisplaySettingsBeforeActivate", "scenarioOceanFillBeforeActivate",
    "scenarioParentBorderEnabledBeforeActivate", "activeSovereignCode",
    "selectedWaterRegionId", "selectedSpecialRegionId",
    "hoveredWaterRegionId", "hoveredSpecialRegionId",
  ].includes(key);
  return freezeCrossFileMigrationEntry({
    retiredCallerPath: "js/core/state/scenario_runtime_state.js",
    retiredCallerBindingIdentity: JSON.stringify({
      kind: "function-parameter", name: "", functionName: "commitScenarioActivationRuntimeState",
      parameterName: "", parameterIndex: 0, parameterPath: "$",
      importSource: "", importedName: "", aliasSources: [], aliasOperators: [],
    }),
    domain, migrationPhase, operation: "assign", key,
    retiredMutationSites: sites.map(([name, sourceFingerprint, occurrenceIndex]) => ({
      enclosingFunctionIdentity: JSON.stringify({kind: "function", ancestry: [{name, ordinal: 0}]}),
      sourceFingerprint, occurrenceIndex,
    })),
    replacementCallerPath: "js/core/scenario_apply_pipeline.js",
    replacementCallerBindingIdentity: SCENARIO_APPLY_PIPELINE_RUNTIME_STATE_BINDING_IDENTITY,
    replacementEnclosingFunctionIdentity: SCENARIO_ACTIVATION_COMMIT_FUNCTION_IDENTITY,
    actionModulePath: presentation ? SCENARIO_PRESENTATION_ACTION_MODULE_PATH : SCENARIO_ACTIVATION_ACTION_MODULE_PATH,
    actionExportName: presentation ? "commitScenarioPresentationState" : "commitScenarioActivationState",
    targetArgumentIndex: 0,
    replacementActionSourceFingerprint: presentation
      ? "437e733eec227b6984eeee13c06aa7338d6ee0c7543612e8d6338adb6965637d"
      : "48de10ee32e9c2cb07dee776e315e5bf98c22ac658d90af9180f76712616a22a",
  });
}

export const STATE_ACTION_CROSS_FILE_MIGRATION_CONTRACT =
  Object.freeze([
    ...P44_STATE_ACTION_CROSS_FILE_MIGRATION_CONTRACT,
    // Successors recovered from accepted policy sites; frozen evidence is retained.

    freezeCrossFileMigrationEntry({
      "retiredCallerPath": "js/core/state/ui_state.js",
      "retiredCallerBindingIdentity": "{\"kind\":\"function-parameter\",\"name\":\"\",\"functionName\":\"applyTransportWorkbenchOverviewState\",\"parameterName\":\"\",\"parameterIndex\":0,\"parameterPath\":\"$\",\"importSource\":\"\",\"importedName\":\"\",\"aliasSources\":[],\"aliasOperators\":[]}",
      "domain": "cross-domain",
      "migrationPhase": "multi-phase",
      "operation": "assign",
      "key": "*",
      "retiredMutationSites": [
        {
          "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"applyTransportWorkbenchOverviewState\",\"ordinal\":0}]}",
          "sourceFingerprint": "6bf49676bc0f94f98f396ed64aeb4def6e1b7614637c3b662cfb64e832acb925",
          "occurrenceIndex": 0
        }
      ],
      "replacementCallerPath": "js/ui/toolbar/transport_workbench_apply_bridge_owner.js",
      "replacementCallerBindingIdentity": "{\"kind\":\"function-parameter\",\"name\":\"\",\"functionName\":\"createTransportWorkbenchApplyBridgeOwner\",\"parameterName\":\"\",\"parameterIndex\":0,\"parameterPath\":\"$\",\"importSource\":\"\",\"importedName\":\"\",\"aliasSources\":[],\"aliasOperators\":[]}",
      "replacementEnclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createTransportWorkbenchApplyBridgeOwner\",\"ordinal\":0},{\"name\":\"applyFamilyToMainMap\",\"ordinal\":0}]}",
      "actionModulePath": "js/core/state/actions/transport_actions.js",
      "actionExportName": "applyTransportWorkbenchOverviewState",
      "targetArgumentIndex": 0,
      "replacementActionSourceFingerprint": "cc9e8748bdb1a44950f03ff8866845003a6cb62bd2546c312828e3a1f2d0576a"
    }),
    freezeCrossFileMigrationEntry({
      "retiredCallerPath": "js/core/state/ui_state.js",
      "retiredCallerBindingIdentity": "{\"kind\":\"function-parameter\",\"name\":\"\",\"functionName\":\"applyTransportWorkbenchOverviewState\",\"parameterName\":\"\",\"parameterIndex\":0,\"parameterPath\":\"$\",\"importSource\":\"\",\"importedName\":\"\",\"aliasSources\":[],\"aliasOperators\":[]}",
      "domain": "ui",
      "migrationPhase": "P4.4",
      "operation": "assign",
      "key": "showTransport",
      "retiredMutationSites": [
        {
          "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"applyTransportWorkbenchOverviewState\",\"ordinal\":0}]}",
          "sourceFingerprint": "e952b1edc69cc1172be0f3a582dbdc78e6677d650f644a00fc3b995a1eab5ee7",
          "occurrenceIndex": 0
        }
      ],
      "replacementCallerPath": "js/ui/toolbar/transport_workbench_apply_bridge_owner.js",
      "replacementCallerBindingIdentity": "{\"kind\":\"function-parameter\",\"name\":\"\",\"functionName\":\"createTransportWorkbenchApplyBridgeOwner\",\"parameterName\":\"\",\"parameterIndex\":0,\"parameterPath\":\"$\",\"importSource\":\"\",\"importedName\":\"\",\"aliasSources\":[],\"aliasOperators\":[]}",
      "replacementEnclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createTransportWorkbenchApplyBridgeOwner\",\"ordinal\":0},{\"name\":\"applyFamilyToMainMap\",\"ordinal\":0}]}",
      "actionModulePath": "js/core/state/actions/transport_actions.js",
      "actionExportName": "applyTransportWorkbenchOverviewState",
      "targetArgumentIndex": 0,
      "replacementActionSourceFingerprint": "cc9e8748bdb1a44950f03ff8866845003a6cb62bd2546c312828e3a1f2d0576a"
    }),
    freezeCrossFileMigrationEntry({
      "retiredCallerPath": "js/core/state/ui_state.js",
      "retiredCallerBindingIdentity": "{\"kind\":\"function-parameter\",\"name\":\"\",\"functionName\":\"applyTransportWorkbenchOverviewState\",\"parameterName\":\"\",\"parameterIndex\":0,\"parameterPath\":\"$\",\"importSource\":\"\",\"importedName\":\"\",\"aliasSources\":[],\"aliasOperators\":[]}",
      "domain": "ui",
      "migrationPhase": "P4.4",
      "operation": "assign",
      "key": "styleConfig",
      "retiredMutationSites": [
        {
          "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"applyTransportWorkbenchOverviewState\",\"ordinal\":0}]}",
          "sourceFingerprint": "6ff4e78b8ae6b947c2ec59ea76cd2c4f4090059152abad58aa647829d5c5dec6",
          "occurrenceIndex": 0
        },
        {
          "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"applyTransportWorkbenchOverviewState\",\"ordinal\":0}]}",
          "sourceFingerprint": "fb9e193bb4c5a12b22f9a2b3a01a3e1e7a0f85b5fe815b5254f170bc53c3f324",
          "occurrenceIndex": 0
        }
      ],
      "replacementCallerPath": "js/ui/toolbar/transport_workbench_apply_bridge_owner.js",
      "replacementCallerBindingIdentity": "{\"kind\":\"function-parameter\",\"name\":\"\",\"functionName\":\"createTransportWorkbenchApplyBridgeOwner\",\"parameterName\":\"\",\"parameterIndex\":0,\"parameterPath\":\"$\",\"importSource\":\"\",\"importedName\":\"\",\"aliasSources\":[],\"aliasOperators\":[]}",
      "replacementEnclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createTransportWorkbenchApplyBridgeOwner\",\"ordinal\":0},{\"name\":\"applyFamilyToMainMap\",\"ordinal\":0}]}",
      "actionModulePath": "js/core/state/actions/transport_actions.js",
      "actionExportName": "applyTransportWorkbenchOverviewState",
      "targetArgumentIndex": 0,
      "replacementActionSourceFingerprint": "cc9e8748bdb1a44950f03ff8866845003a6cb62bd2546c312828e3a1f2d0576a"
    }),
    freezeCrossFileMigrationEntry({
      "retiredCallerPath": "js/core/map_renderer.js",
      "retiredCallerBindingIdentity": "{\"kind\":\"module\",\"name\":\"runtimeState\",\"functionName\":\"\",\"parameterName\":\"\",\"parameterIndex\":0,\"parameterPath\":\"\",\"importSource\":\"./state.js\",\"importedName\":\"state\",\"aliasSources\":[],\"aliasOperators\":[]}",
      "domain": "appearance",
      "migrationPhase": "P4.4",
      "operation": "collection-mutate",
      "key": "intensityFields",
      "retiredMutationSites": [
        {
          "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"handlePhysicalIntensityPointerDown\",\"ordinal\":0}]}",
          "sourceFingerprint": "d47b2b8c00c0143ed139897d71242036adf3cc54300904029380f76c6318be67",
          "occurrenceIndex": 0
        }
      ],
      "replacementCallerPath": "js/core/renderer/physical_intensity_interaction_owner.js",
      "replacementCallerBindingIdentity": "{\"kind\":\"function-parameter\",\"name\":\"\",\"functionName\":\"createPhysicalIntensityInteractionOwner\",\"parameterName\":\"\",\"parameterIndex\":0,\"parameterPath\":\"$/property:runtimeState\",\"importSource\":\"\",\"importedName\":\"\",\"aliasSources\":[],\"aliasOperators\":[]}",
      "replacementEnclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createPhysicalIntensityInteractionOwner\",\"ordinal\":0},{\"name\":\"handlePhysicalIntensityPointerDown\",\"ordinal\":0}]}",
      "actionModulePath": "js/core/state/actions/intensity_field_actions.js",
      "actionExportName": "appendIntensityFieldPointState",
      "targetArgumentIndex": 0,
      "replacementActionSourceFingerprint": "0b64390ff46f8d0b47bab961e655fdf2bfe493de0afe6450d847e7e48fdb6ab3"
    }),

    freezeCrossFileMigrationEntry({
      "retiredCallerPath": "js/ui/sidebar/country_inspector_controller.js",
      "retiredCallerBindingIdentity": "{\"kind\":\"function-parameter\",\"name\":\"\",\"functionName\":\"createCountryInspectorController\",\"parameterName\":\"\",\"parameterIndex\":0,\"parameterPath\":\"$/property:runtimeState\",\"importSource\":\"\",\"importedName\":\"\",\"aliasSources\":[],\"aliasOperators\":[]}",
      "domain": "ui",
      "migrationPhase": "P4.4",
      "operation": "delete",
      "key": "hgoIdentity",
      "retiredMutationSites": [
            {
                  "enclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createCountryInspectorController\",\"ordinal\":0},{\"name\":\"renderHgoIdentityDetail\",\"ordinal\":0},{\"name\":\"<anonymous>\",\"ordinal\":4}]}",
                  "sourceFingerprint": "3c39e299edce02621afe70eedfdfedb8dcab879b5059f0028efcb60aa28567a9",
                  "occurrenceIndex": 0
            }
      ],
      "replacementCallerPath": "js/ui/sidebar/country_inspector_controller.js",
      "replacementCallerBindingIdentity": "{\"kind\":\"function-parameter\",\"name\":\"\",\"functionName\":\"createCountryInspectorController\",\"parameterName\":\"\",\"parameterIndex\":0,\"parameterPath\":\"$/property:runtimeState\",\"importSource\":\"\",\"importedName\":\"\",\"aliasSources\":[],\"aliasOperators\":[]}",
      "replacementEnclosingFunctionIdentity": "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createCountryInspectorController\",\"ordinal\":0},{\"name\":\"renderHgoIdentityDetail\",\"ordinal\":0},{\"name\":\"handleHgoVariantChange\",\"ordinal\":0}]}",
      "actionModulePath": "js/core/state/actions/scenario_presentation_actions.js",
      "actionExportName": "setHgoIdentityVariantSelectionState",
      "targetArgumentIndex": 0,
      "replacementActionSourceFingerprint": "1b4d0f4dd691a10472e09aad7f31b73c8a06008082b38027811f9093efb51e58"
}),
    // UI owners delegate their migrated field writes to existing presentation actions.
    freezeCrossFileMigrationEntry({
      retiredCallerPath: "js/ui/sidebar.js",
      retiredCallerBindingIdentity: JSON.stringify({
        kind: "module", name: "runtimeState", functionName: "", parameterName: "",
        parameterIndex: 0, parameterPath: "", importSource: "../core/state.js",
        importedName: "state", aliasSources: [], aliasOperators: [],
      }),
      domain: "color", migrationPhase: "P4.4", operation: "collection-mutate",
      key: "expandedInspectorContinents",
      retiredMutationSites: [{
        enclosingFunctionIdentity: JSON.stringify({
          kind: "function", ancestry: [{ name: "ensureInitialInspectorExpansion", ordinal: 0 }],
        }),
        sourceFingerprint: "cd3fee8bfca241d17cf57f2bebe9a4282934b33b077d4240cef2d0ebab263a02",
        occurrenceIndex: 0,
      }],
      replacementCallerPath: "js/ui/sidebar/country_inspector_controller.js",
      replacementCallerBindingIdentity: "{\"kind\":\"function-parameter\",\"name\":\"\",\"functionName\":\"createCountryInspectorController\",\"parameterName\":\"\",\"parameterIndex\":0,\"parameterPath\":\"$/property:runtimeState\",\"importSource\":\"\",\"importedName\":\"\",\"aliasSources\":[],\"aliasOperators\":[]}",
      replacementEnclosingFunctionIdentity: "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createCountryInspectorController\",\"ordinal\":0},{\"name\":\"ensureInitialInspectorExpansion\",\"ordinal\":0}]}",
      actionModulePath: "js/core/state/actions/scenario_presentation_actions.js",
      actionExportName: "setInspectorContinentExpandedState",
      targetArgumentIndex: 0,
      replacementActionSourceFingerprint: "33e90b8899a0fdcdad4ce1bc71fcd9516eab76832ae63930bf428e0f4af362fd",
    }),
    freezeCrossFileMigrationEntry({
      retiredCallerPath: "js/ui/toolbar.js",
      retiredCallerBindingIdentity: JSON.stringify({
        kind: "module", name: "runtimeState", functionName: "", parameterName: "",
        parameterIndex: 0, parameterPath: "", importSource: "../core/state.js",
        importedName: "state", aliasSources: [], aliasOperators: [],
      }),
      domain: "color", migrationPhase: "P4.4", operation: "assign", key: "batchFillScope",
      retiredMutationSites: [
        {
          enclosingFunctionIdentity: JSON.stringify({
            kind: "function", ancestry: [
              { name: "initToolbar", ordinal: 0 }, { name: "<anonymous>", ordinal: 42 },
            ],
          }),
          sourceFingerprint: "c4cf4cee341d6695166a50fcab4bcaa94ff2600c8aafc4006436564789054c3a",
          occurrenceIndex: 0,
        },
        {
          enclosingFunctionIdentity: JSON.stringify({
            kind: "function", ancestry: [
              { name: "initToolbar", ordinal: 0 }, { name: "<anonymous>", ordinal: 43 },
            ],
          }),
          sourceFingerprint: "c4cf4cee341d6695166a50fcab4bcaa94ff2600c8aafc4006436564789054c3a",
          occurrenceIndex: 0,
        },
      ],
      replacementCallerPath: "js/ui/toolbar/workspace_chrome_support_surface_controller.js",
      replacementCallerBindingIdentity: "{\"kind\":\"function-parameter\",\"name\":\"\",\"functionName\":\"createWorkspaceChromeSupportSurfaceController\",\"parameterName\":\"\",\"parameterIndex\":0,\"parameterPath\":\"$/property:state\",\"importSource\":\"\",\"importedName\":\"\",\"aliasSources\":[],\"aliasOperators\":[]}",
      replacementEnclosingFunctionIdentity: "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createWorkspaceChromeSupportSurfaceController\",\"ordinal\":0},{\"name\":\"bindQuickFillControls\",\"ordinal\":0},{\"name\":\"<anonymous>\",\"ordinal\":1}]}",
      actionModulePath: "js/core/state/actions/scenario_presentation_actions.js",
      actionExportName: "setBatchFillScopeState",
      targetArgumentIndex: 0,
      replacementActionSourceFingerprint: "02ee0ee4f193dfb3b3b1f10ac29ca5104c0b6c3f9d6b12302b688f5dd6c85e76",
    }),
    // Removed special-zone wrappers retain their old sites and canonical write semantics.
    freezeCrossFileMigrationEntry({
      retiredCallerPath: "js/core/special_zone_layers.js",
      retiredCallerBindingIdentity: createP44FunctionParameterBindingIdentity("activateSpecialZoneMembershipToolState", "$"),
      domain: "color", migrationPhase: "P4.4", operation: "assign", key: "brushModeEnabled",
      retiredMutationSites: createP44RetiredMutationSites([
        { ancestryNames: ["activateSpecialZoneMembershipToolState"], sites: [["d103eeb8b941032cd5daf2a2c2e32ee459f8122d74323b5c03a46eff1fc4c665",0]] },
      ]),
      replacementCallerPath: "js/ui/toolbar/special_zones_workbench_controller.js",
      replacementCallerBindingIdentity: createP44FunctionParameterBindingIdentity("createSpecialZonesWorkbenchController", "$/property:runtimeState"),
      replacementEnclosingFunctionIdentity: createP44FunctionIdentity("createSpecialZonesWorkbenchController", "activateMembershipTool"),
      actionModulePath: SPECIAL_ZONE_ACTION_MODULE_PATH, actionExportName: "activateSpecialZoneMembershipToolState", targetArgumentIndex: 0,
      replacementActionSourceFingerprint: "c4a3ead467985a41652fd268cbae8dc3003c299e78d4008a4e0364182dbce019",
    }),
    freezeCrossFileMigrationEntry({
      retiredCallerPath: "js/core/special_zone_layers.js",
      retiredCallerBindingIdentity: createP44FunctionParameterBindingIdentity("activateSpecialZoneMembershipToolState", "$"),
      domain: "strategic-overlay", migrationPhase: "P4.4", operation: "assign", key: "specialZoneEditor",
      retiredMutationSites: createP44RetiredMutationSites([
        { ancestryNames: ["activateSpecialZoneMembershipToolState"], sites: [["327124a9df6870f614b505b79fff29d616f278a35eef7e5ba8e3a0d9d4d5a942",0]] },
      ]),
      replacementCallerPath: "js/ui/toolbar/special_zones_workbench_controller.js",
      replacementCallerBindingIdentity: createP44FunctionParameterBindingIdentity("createSpecialZonesWorkbenchController", "$/property:runtimeState"),
      replacementEnclosingFunctionIdentity: createP44FunctionIdentity("createSpecialZonesWorkbenchController", "activateMembershipTool"),
      actionModulePath: SPECIAL_ZONE_ACTION_MODULE_PATH, actionExportName: "activateSpecialZoneMembershipToolState", targetArgumentIndex: 0,
      replacementActionSourceFingerprint: "c4a3ead467985a41652fd268cbae8dc3003c299e78d4008a4e0364182dbce019",
    }),
    freezeCrossFileMigrationEntry({
      retiredCallerPath: "js/core/special_zone_layers.js",
      retiredCallerBindingIdentity: createP44FunctionParameterBindingIdentity("activateSpecialZoneMembershipToolState", "$"),
      domain: "color", migrationPhase: "P4.4", operation: "assign", key: "currentTool",
      retiredMutationSites: createP44RetiredMutationSites([
        { ancestryNames: ["activateSpecialZoneMembershipToolState"], sites: [["bd432c3dc0358f4ce26f5aad49036bce7ecbf8aecba9b8d5ec347c7e44e37103",0]] },
      ]),
      replacementCallerPath: "js/ui/toolbar/special_zones_workbench_controller.js",
      replacementCallerBindingIdentity: createP44FunctionParameterBindingIdentity("createSpecialZonesWorkbenchController", "$/property:runtimeState"),
      replacementEnclosingFunctionIdentity: createP44FunctionIdentity("createSpecialZonesWorkbenchController", "activateMembershipTool"),
      actionModulePath: SPECIAL_ZONE_ACTION_MODULE_PATH, actionExportName: "activateSpecialZoneMembershipToolState", targetArgumentIndex: 0,
      replacementActionSourceFingerprint: "c4a3ead467985a41652fd268cbae8dc3003c299e78d4008a4e0364182dbce019",
    }),
    freezeCrossFileMigrationEntry({
      retiredCallerPath: "js/core/special_zone_layers.js",
      retiredCallerBindingIdentity: createP44FunctionParameterBindingIdentity("activateSpecialZoneMembershipToolState", "$"),
      domain: "ui", migrationPhase: "P4.4", operation: "assign", key: "specialZoneMembershipTool",
      retiredMutationSites: createP44RetiredMutationSites([
        { ancestryNames: ["activateSpecialZoneMembershipToolState"], sites: [["0f0b54af0ee1099f07f4bb600afdd4898b8cab01fab1afbddfa552265f92e2f2",0]] },
      ]),
      replacementCallerPath: "js/ui/toolbar/special_zones_workbench_controller.js",
      replacementCallerBindingIdentity: createP44FunctionParameterBindingIdentity("createSpecialZonesWorkbenchController", "$/property:runtimeState"),
      replacementEnclosingFunctionIdentity: createP44FunctionIdentity("createSpecialZonesWorkbenchController", "activateMembershipTool"),
      actionModulePath: SPECIAL_ZONE_ACTION_MODULE_PATH, actionExportName: "activateSpecialZoneMembershipToolState", targetArgumentIndex: 0,
      replacementActionSourceFingerprint: "c4a3ead467985a41652fd268cbae8dc3003c299e78d4008a4e0364182dbce019",
    }),
    freezeCrossFileMigrationEntry({
      retiredCallerPath: "js/core/special_zone_layers.js",
      retiredCallerBindingIdentity: createP44FunctionParameterBindingIdentity("activateSpecialZoneMembershipToolState", "$"),
      domain: "ui", migrationPhase: "P4.4", operation: "assign", key: "specialZonePreviousTool",
      retiredMutationSites: createP44RetiredMutationSites([
        { ancestryNames: ["activateSpecialZoneMembershipToolState"], sites: [["5d2709539c2ddf70d14d351e15700120acd3fe6fa563c7bbf6b0e73fd1d5cdb8",0]] },
      ]),
      replacementCallerPath: "js/ui/toolbar/special_zones_workbench_controller.js",
      replacementCallerBindingIdentity: createP44FunctionParameterBindingIdentity("createSpecialZonesWorkbenchController", "$/property:runtimeState"),
      replacementEnclosingFunctionIdentity: createP44FunctionIdentity("createSpecialZonesWorkbenchController", "activateMembershipTool"),
      actionModulePath: SPECIAL_ZONE_ACTION_MODULE_PATH, actionExportName: "activateSpecialZoneMembershipToolState", targetArgumentIndex: 0,
      replacementActionSourceFingerprint: "c4a3ead467985a41652fd268cbae8dc3003c299e78d4008a4e0364182dbce019",
    }),
    freezeCrossFileMigrationEntry({
      retiredCallerPath: "js/core/special_zone_layers.js",
      retiredCallerBindingIdentity: createP44FunctionParameterBindingIdentity("exitSpecialZoneMembershipToolState", "$"),
      domain: "color", migrationPhase: "P4.4", operation: "assign", key: "currentTool",
      retiredMutationSites: createP44RetiredMutationSites([
        { ancestryNames: ["exitSpecialZoneMembershipToolState"], sites: [["bd432c3dc0358f4ce26f5aad49036bce7ecbf8aecba9b8d5ec347c7e44e37103",0]] },
      ]),
      replacementCallerPath: "js/ui/toolbar/special_zones_workbench_controller.js",
      replacementCallerBindingIdentity: createP44FunctionParameterBindingIdentity("createSpecialZonesWorkbenchController", "$/property:runtimeState"),
      replacementEnclosingFunctionIdentity: createP44FunctionIdentity("createSpecialZonesWorkbenchController", "renderActions", {"name":"<anonymous>","ordinal":2}),
      actionModulePath: SPECIAL_ZONE_ACTION_MODULE_PATH, actionExportName: "exitSpecialZoneMembershipToolState", targetArgumentIndex: 0,
      replacementActionSourceFingerprint: "6c2d698b5680004d946e5b0d41c4a21f96b7ff1b56ded450c3dcee9eb8346b25",
    }),
    freezeCrossFileMigrationEntry({
      retiredCallerPath: "js/core/special_zone_layers.js",
      retiredCallerBindingIdentity: createP44FunctionParameterBindingIdentity("exitSpecialZoneMembershipToolState", "$"),
      domain: "ui", migrationPhase: "P4.4", operation: "assign", key: "specialZonePreviousTool",
      retiredMutationSites: createP44RetiredMutationSites([
        { ancestryNames: ["exitSpecialZoneMembershipToolState"], sites: [["5d2709539c2ddf70d14d351e15700120acd3fe6fa563c7bbf6b0e73fd1d5cdb8",0]] },
      ]),
      replacementCallerPath: "js/ui/toolbar/special_zones_workbench_controller.js",
      replacementCallerBindingIdentity: createP44FunctionParameterBindingIdentity("createSpecialZonesWorkbenchController", "$/property:runtimeState"),
      replacementEnclosingFunctionIdentity: createP44FunctionIdentity("createSpecialZonesWorkbenchController", "renderActions", {"name":"<anonymous>","ordinal":2}),
      actionModulePath: SPECIAL_ZONE_ACTION_MODULE_PATH, actionExportName: "exitSpecialZoneMembershipToolState", targetArgumentIndex: 0,
      replacementActionSourceFingerprint: "6c2d698b5680004d946e5b0d41c4a21f96b7ff1b56ded450c3dcee9eb8346b25",
    }),
    freezeCrossFileMigrationEntry({
      retiredCallerPath: "js/core/special_zone_layers.js",
      retiredCallerBindingIdentity: createP44FunctionParameterBindingIdentity("registerSpecialZonesWorkbenchRuntimeHooks", "$"),
      domain: "runtime-hooks", migrationPhase: "P4.5", operation: "assign", key: "updateSpecialZonesWorkbenchUIFn",
      retiredMutationSites: createP44RetiredMutationSites([
        { ancestryNames: ["registerSpecialZonesWorkbenchRuntimeHooks"], sites: [["e9ff763f9df0624a4b8471ca3d366402d854a7fcb1ffd580fc94c4b0d8f2c5bc",0]] },
      ]),
      replacementCallerPath: "js/ui/toolbar/special_zones_workbench_controller.js",
      replacementCallerBindingIdentity: createP44FunctionParameterBindingIdentity("createSpecialZonesWorkbenchController", "$/property:runtimeState"),
      replacementEnclosingFunctionIdentity: createP44FunctionIdentity("createSpecialZonesWorkbenchController", "renderSpecialZonesWorkbenchUi"),
      actionModulePath: SPECIAL_ZONE_ACTION_MODULE_PATH, actionExportName: "registerSpecialZonesWorkbenchRuntimeHooks", targetArgumentIndex: 0,
      replacementActionSourceFingerprint: "0c3ff994507de0f9dd43bc55eec99626c62c4f394d9c87dae22edd58716bad05",
    }),
    freezeCrossFileMigrationEntry({
      retiredCallerPath: "js/core/special_zone_layers.js",
      retiredCallerBindingIdentity: createP44FunctionParameterBindingIdentity("registerSpecialZonesWorkbenchRuntimeHooks", "$"),
      domain: "runtime-hooks", migrationPhase: "P4.5", operation: "assign", key: "updateSpecialZonesWorkbenchCurrentTargetUIFn",
      retiredMutationSites: createP44RetiredMutationSites([
        { ancestryNames: ["registerSpecialZonesWorkbenchRuntimeHooks"], sites: [["6b6f58f80de181a568d43ca8e068eceaebdbb6f29d968743011a4a4b99bd32e2",0]] },
      ]),
      replacementCallerPath: "js/ui/toolbar/special_zones_workbench_controller.js",
      replacementCallerBindingIdentity: createP44FunctionParameterBindingIdentity("createSpecialZonesWorkbenchController", "$/property:runtimeState"),
      replacementEnclosingFunctionIdentity: createP44FunctionIdentity("createSpecialZonesWorkbenchController", "renderSpecialZonesWorkbenchUi"),
      actionModulePath: SPECIAL_ZONE_ACTION_MODULE_PATH, actionExportName: "registerSpecialZonesWorkbenchRuntimeHooks", targetArgumentIndex: 0,
      replacementActionSourceFingerprint: "0c3ff994507de0f9dd43bc55eec99626c62c4f394d9c87dae22edd58716bad05",
    }),
    freezeCrossFileMigrationEntry({
      retiredCallerPath: "js/core/special_zone_layers.js",
      retiredCallerBindingIdentity: createP44FunctionParameterBindingIdentity("ensureSpecialZoneLayersState", "$"),
      domain: "ui", migrationPhase: "P4.4", operation: "assign", key: "specialZoneLayers",
      retiredMutationSites: createP44RetiredMutationSites([
        { ancestryNames: ["ensureSpecialZoneLayersState"], sites: [["fd5d59cac0c899e80a5991627c4cc1859c15fda0958a28b5951d709e90fff62d",0]] },
      ]),
      replacementCallerPath: "js/ui/toolbar/special_zones_workbench_controller.js",
      replacementCallerBindingIdentity: createP44FunctionParameterBindingIdentity("createSpecialZonesWorkbenchController", "$/property:runtimeState"),
      replacementEnclosingFunctionIdentity: createP44FunctionIdentity("createSpecialZonesWorkbenchController", "normalizeState"),
      actionModulePath: SPECIAL_ZONE_ACTION_MODULE_PATH, actionExportName: "commitSpecialZoneLayersState", targetArgumentIndex: 0,
      replacementActionSourceFingerprint: "7fcdc86b09f245b136b46d10a837790f73c3e96e47de0d1181b0e861cc8d9c38",
    }),
    freezeCrossFileMigrationEntry({
      retiredCallerPath: "js/core/special_zone_layers.js",
      retiredCallerBindingIdentity: createP44FunctionParameterBindingIdentity("mutateRuntimeSpecialZoneLayersState", "$"),
      domain: "ui", migrationPhase: "P4.4", operation: "assign", key: "specialZonesOverlayDirty",
      retiredMutationSites: createP44RetiredMutationSites([
        { ancestryNames: ["mutateRuntimeSpecialZoneLayersState"], sites: [["c160a7fa65d90fd7d549d034a1dcf50b25fc802b2565af279fc26098438fd7ba",0]] },
      ]),
      replacementCallerPath: "js/ui/toolbar/special_zones_workbench_controller.js",
      replacementCallerBindingIdentity: createP44FunctionParameterBindingIdentity("createSpecialZonesWorkbenchController", "$/property:runtimeState"),
      replacementEnclosingFunctionIdentity: createP44FunctionIdentity("createSpecialZonesWorkbenchController", "updateState"),
      actionModulePath: SPECIAL_ZONE_ACTION_MODULE_PATH, actionExportName: "commitSpecialZoneLayersState", targetArgumentIndex: 0,
      replacementActionSourceFingerprint: "12c6ebda6b0b647f6b1c3377f0fd131880cd41f7d60493df600f4abc3401a48e",
    }),
    freezeCrossFileMigrationEntry({
      retiredCallerPath: "js/core/special_zone_layers.js",
      retiredCallerBindingIdentity: createP44FunctionParameterBindingIdentity("normalizeRuntimeSpecialZoneLayersState", "$"),
      domain: "ui", migrationPhase: "P4.4", operation: "assign", key: "specialZoneLayers",
      retiredMutationSites: createP44RetiredMutationSites([
        { ancestryNames: ["normalizeRuntimeSpecialZoneLayersState"], sites: [["fd5d59cac0c899e80a5991627c4cc1859c15fda0958a28b5951d709e90fff62d",0]] },
      ]),
      replacementCallerPath: "js/ui/toolbar/special_zones_workbench_controller.js",
      replacementCallerBindingIdentity: createP44FunctionParameterBindingIdentity("createSpecialZonesWorkbenchController", "$/property:runtimeState"),
      replacementEnclosingFunctionIdentity: createP44FunctionIdentity("createSpecialZonesWorkbenchController", "normalizeState"),
      actionModulePath: SPECIAL_ZONE_ACTION_MODULE_PATH, actionExportName: "commitSpecialZoneLayersState", targetArgumentIndex: 0,
      replacementActionSourceFingerprint: "7fcdc86b09f245b136b46d10a837790f73c3e96e47de0d1181b0e861cc8d9c38",
    }),
    freezeCrossFileMigrationEntry({
      retiredCallerPath: "js/core/special_zone_layers.js",
      retiredCallerBindingIdentity: createP44FunctionParameterBindingIdentity("setRuntimeSpecialZoneLayersState", "$"),
      domain: "ui", migrationPhase: "P4.4", operation: "assign", key: "specialZoneLayers",
      retiredMutationSites: createP44RetiredMutationSites([
        { ancestryNames: ["setRuntimeSpecialZoneLayersState"], sites: [["fd5d59cac0c899e80a5991627c4cc1859c15fda0958a28b5951d709e90fff62d",0]] },
      ]),
      replacementCallerPath: "js/ui/toolbar/special_zones_workbench_controller.js",
      replacementCallerBindingIdentity: createP44FunctionParameterBindingIdentity("createSpecialZonesWorkbenchController", "$/property:runtimeState"),
      replacementEnclosingFunctionIdentity: createP44FunctionIdentity("createSpecialZonesWorkbenchController", "normalizeState"),
      actionModulePath: SPECIAL_ZONE_ACTION_MODULE_PATH, actionExportName: "commitSpecialZoneLayersState", targetArgumentIndex: 0,
      replacementActionSourceFingerprint: "7fcdc86b09f245b136b46d10a837790f73c3e96e47de0d1181b0e861cc8d9c38",
    }),
    // Owner moves keep their exact legacy sites and delegate final writes to actions.
    freezeCrossFileMigrationEntry({
      retiredCallerPath: "js/core/map_renderer.js",
      retiredCallerBindingIdentity: MAP_RENDERER_RUNTIME_STATE_BINDING_IDENTITY,
      domain: "color", migrationPhase: "P4.4", operation: "assign", key: "dynamicBordersDirty",
      retiredMutationSites: createP44RetiredMutationSites([
        { ancestryNames: ["markDynamicBordersDirty"], sites: [["c2382984fcb9ceaa0f2cbb1f04d9b9adf5129d4a866f707dc67c32c8b9019bea",0],["c2382984fcb9ceaa0f2cbb1f04d9b9adf5129d4a866f707dc67c32c8b9019bea",1]] },
        { ancestryNames: ["recomputeDynamicBordersNow"], sites: [["c2382984fcb9ceaa0f2cbb1f04d9b9adf5129d4a866f707dc67c32c8b9019bea",0]] },
      ]),
      replacementCallerPath: "js/core/renderer/border_mesh_owner.js",
      replacementCallerBindingIdentity: createP44FunctionParameterBindingIdentity("createBorderMeshOwner", "$/property:state"),
      replacementEnclosingFunctionIdentity: createP44FunctionIdentity("createBorderMeshOwner", "markDynamicBordersDirty"),
      actionModulePath: RENDERER_CACHE_ACTION_MODULE_PATH, actionExportName: "setDynamicBordersDirtyState", targetArgumentIndex: 0,
      replacementActionSourceFingerprint: "f73f1c89ae0b6dee86a58827a49400cfba80623233b930c0ced8f38875a26077",
    }),
    freezeCrossFileMigrationEntry({
      retiredCallerPath: "js/core/map_renderer.js",
      retiredCallerBindingIdentity: MAP_RENDERER_RUNTIME_STATE_BINDING_IDENTITY,
      domain: "color", migrationPhase: "P4.4", operation: "assign", key: "dynamicBordersDirtyReason",
      retiredMutationSites: createP44RetiredMutationSites([
        { ancestryNames: ["markDynamicBordersDirty"], sites: [["54bedbda1f3b248635fabc4b055b6eb329fae901befa78bbda0d572a840ead09",0],["54bedbda1f3b248635fabc4b055b6eb329fae901befa78bbda0d572a840ead09",1]] },
        { ancestryNames: ["recomputeDynamicBordersNow"], sites: [["54bedbda1f3b248635fabc4b055b6eb329fae901befa78bbda0d572a840ead09",0],["54bedbda1f3b248635fabc4b055b6eb329fae901befa78bbda0d572a840ead09",1]] },
      ]),
      replacementCallerPath: "js/core/renderer/border_mesh_owner.js",
      replacementCallerBindingIdentity: createP44FunctionParameterBindingIdentity("createBorderMeshOwner", "$/property:state"),
      replacementEnclosingFunctionIdentity: createP44FunctionIdentity("createBorderMeshOwner", "markDynamicBordersDirty"),
      actionModulePath: RENDERER_CACHE_ACTION_MODULE_PATH, actionExportName: "setDynamicBordersDirtyState", targetArgumentIndex: 0,
      replacementActionSourceFingerprint: "f73f1c89ae0b6dee86a58827a49400cfba80623233b930c0ced8f38875a26077",
    }),
    freezeCrossFileMigrationEntry({
      retiredCallerPath: "js/core/map_renderer.js",
      retiredCallerBindingIdentity: MAP_RENDERER_RUNTIME_STATE_BINDING_IDENTITY,
      domain: "color", migrationPhase: "P4.4", operation: "assign", key: "pendingDynamicBorderTimerId",
      retiredMutationSites: createP44RetiredMutationSites([
        { ancestryNames: ["clearPendingDynamicBorderTimer"], sites: [["e84845ee832443c8e453ef12bc5c5579ffe7a83b0c7086eac6087cf61ff6fad8",0]] },
        { ancestryNames: ["scheduleDynamicBorderRecompute","<anonymous>"], sites: [["e84845ee832443c8e453ef12bc5c5579ffe7a83b0c7086eac6087cf61ff6fad8",0]] },
        { ancestryNames: ["scheduleDynamicBorderRecompute"], sites: [["e84845ee832443c8e453ef12bc5c5579ffe7a83b0c7086eac6087cf61ff6fad8",0]] },
      ]),
      replacementCallerPath: "js/core/renderer/border_mesh_owner.js",
      replacementCallerBindingIdentity: createP44FunctionParameterBindingIdentity("createBorderMeshOwner", "$/property:state"),
      replacementEnclosingFunctionIdentity: createP44FunctionIdentity("createBorderMeshOwner", "clearPendingDynamicBorderTimer"),
      actionModulePath: RENDERER_CACHE_ACTION_MODULE_PATH, actionExportName: "setPendingDynamicBorderTimerState", targetArgumentIndex: 0,
      replacementActionSourceFingerprint: "632dfb0287a64f874cecf11a8d746f8aee055785722a74d830727c66001b1d96",
    }),
    freezeCrossFileMigrationEntry({
      retiredCallerPath: "js/core/map_renderer.js",
      retiredCallerBindingIdentity: MAP_RENDERER_RUNTIME_STATE_BINDING_IDENTITY,
      domain: "renderer", migrationPhase: "P4.3", operation: "assign", key: "cachedDetailAdmBorders",
      retiredMutationSites: createP44RetiredMutationSites([
        { ancestryNames: ["clearDeferredInternalBorderMeshCaches"], sites: [["b9fca13801d187e08ff5d99e86f5588a324d1215a68122d0e5104e8e5424fdc7",0]] },
        { ancestryNames: ["rebuildStaticMeshes"], sites: [["b9fca13801d187e08ff5d99e86f5588a324d1215a68122d0e5104e8e5424fdc7",0],["b9fca13801d187e08ff5d99e86f5588a324d1215a68122d0e5104e8e5424fdc7",1]] },
        { ancestryNames: ["restoreStaticMeshSnapshot"], sites: [["b9fca13801d187e08ff5d99e86f5588a324d1215a68122d0e5104e8e5424fdc7",0]] },
        { ancestryNames: ["scheduleDeferredHeavyBorderMeshes","<anonymous>"], sites: [["b9fca13801d187e08ff5d99e86f5588a324d1215a68122d0e5104e8e5424fdc7",0]] },
      ]),
      replacementCallerPath: "js/core/renderer/border_mesh_owner.js",
      replacementCallerBindingIdentity: createP44FunctionParameterBindingIdentity("createBorderMeshOwner", "$/property:state"),
      replacementEnclosingFunctionIdentity: createP44FunctionIdentity("createBorderMeshOwner", "replaceDetailAdmBorders"),
      actionModulePath: RENDERER_CACHE_ACTION_MODULE_PATH, actionExportName: "replaceCachedDetailAdmBordersState", targetArgumentIndex: 0,
      replacementActionSourceFingerprint: "13858ddc24bfd4790980720065a0e31215884cbe521f105d34f209950b4ff44c",
    }),
    freezeCrossFileMigrationEntry({
      retiredCallerPath: "js/core/map_renderer.js",
      retiredCallerBindingIdentity: MAP_RENDERER_RUNTIME_STATE_BINDING_IDENTITY,
      domain: "renderer", migrationPhase: "P4.3", operation: "assign", key: "lastMouseMoveTime",
      retiredMutationSites: createP44RetiredMutationSites([
        { ancestryNames: ["getMapHoverInteractionOwner","setLastMouseMoveTime"], sites: [["a6b2dccabcb124b3b194389668d9e0014cf75fbfad482bf52ca47cc06711b8fd",0]] },
      ]),
      replacementCallerPath: "js/core/map_renderer/map_hover_interaction_owner.js",
      replacementCallerBindingIdentity: createP44FunctionParameterBindingIdentity("createMapHoverInteractionOwner", "$/property:state"),
      replacementEnclosingFunctionIdentity: createP44FunctionIdentity("createMapHoverInteractionOwner", "handleMouseMove"),
      actionModulePath: RENDERER_INTERACTION_ACTION_MODULE_PATH, actionExportName: "setLastMouseMoveTimeState", targetArgumentIndex: 0,
      replacementActionSourceFingerprint: "a10359f10f6c0d80b5a8389d586f1f7043a5bc05c761153c90615fdfcf1fd884",
    }),
    freezeCrossFileMigrationEntry({
      retiredCallerPath: "js/core/map_renderer.js",
      retiredCallerBindingIdentity: MAP_RENDERER_RUNTIME_STATE_BINDING_IDENTITY,
      domain: "renderer", migrationPhase: "P4.3", operation: "collection-mutate", key: "cachedDetailAdmBorders",
      retiredMutationSites: createP44RetiredMutationSites([
        { ancestryNames: ["rebuildStaticMeshes"], sites: [["666440010cdb7ee6178e34bda9d43a6875bd89b4d305df9176164c9b866d771b",0]] },
      ]),
      replacementCallerPath: "js/core/renderer/border_mesh_owner.js",
      replacementCallerBindingIdentity: createP44FunctionParameterBindingIdentity("createBorderMeshOwner", "$/property:state"),
      replacementEnclosingFunctionIdentity: createP44FunctionIdentity("createBorderMeshOwner", "replaceDetailAdmBorders"),
      actionModulePath: RENDERER_CACHE_ACTION_MODULE_PATH, actionExportName: "replaceCachedDetailAdmBordersState", targetArgumentIndex: 0,
      replacementActionSourceFingerprint: "13858ddc24bfd4790980720065a0e31215884cbe521f105d34f209950b4ff44c",
    }),
    freezeCrossFileMigrationEntry({
      retiredCallerPath: "js/core/map_renderer.js",
      retiredCallerBindingIdentity: MAP_RENDERER_RUNTIME_STATE_BINDING_IDENTITY,
      domain: "ui", migrationPhase: "P4.4", operation: "assign", key: "hoverOverlayDirty",
      retiredMutationSites: createP44RetiredMutationSites([
        { ancestryNames: ["clearFacilityHoverEntries"], sites: [["8f33ab5c3cc170baf4bb18aa95a6c5baf7b48ac07bed6e10d011612409429636",0],["8f33ab5c3cc170baf4bb18aa95a6c5baf7b48ac07bed6e10d011612409429636",1]] },
        { ancestryNames: ["clearUnderlyingHoverForFacilityEntry"], sites: [["8f33ab5c3cc170baf4bb18aa95a6c5baf7b48ac07bed6e10d011612409429636",0]] },
        { ancestryNames: ["getMapHoverInteractionOwner","markHoverOverlayDirty"], sites: [["8f33ab5c3cc170baf4bb18aa95a6c5baf7b48ac07bed6e10d011612409429636",0]] },
        { ancestryNames: ["getRenderPhaseLifecycleOwner","setHoverOverlayDirty"], sites: [["8f33ab5c3cc170baf4bb18aa95a6c5baf7b48ac07bed6e10d011612409429636",0]] },
        { ancestryNames: ["handleMapMouseLeave"], sites: [["8f33ab5c3cc170baf4bb18aa95a6c5baf7b48ac07bed6e10d011612409429636",0]] },
        { ancestryNames: ["initMap","<anonymous>"], sites: [["8f33ab5c3cc170baf4bb18aa95a6c5baf7b48ac07bed6e10d011612409429636",0]] },
        { ancestryNames: ["markAllOverlaysDirty"], sites: [["8f33ab5c3cc170baf4bb18aa95a6c5baf7b48ac07bed6e10d011612409429636",0]] },
        { ancestryNames: ["markOverlaysDirty"], sites: [["8f33ab5c3cc170baf4bb18aa95a6c5baf7b48ac07bed6e10d011612409429636",0]] },
        { ancestryNames: ["renderHoverOverlayIfNeeded"], sites: [["8f33ab5c3cc170baf4bb18aa95a6c5baf7b48ac07bed6e10d011612409429636",0]] },
        { ancestryNames: ["setVisibleFacilityHoverEntries"], sites: [["8f33ab5c3cc170baf4bb18aa95a6c5baf7b48ac07bed6e10d011612409429636",0],["8f33ab5c3cc170baf4bb18aa95a6c5baf7b48ac07bed6e10d011612409429636",1],["8f33ab5c3cc170baf4bb18aa95a6c5baf7b48ac07bed6e10d011612409429636",2],["8f33ab5c3cc170baf4bb18aa95a6c5baf7b48ac07bed6e10d011612409429636",3]] },
        { ancestryNames: ["syncFacilityInfoCardVisibility"], sites: [["8f33ab5c3cc170baf4bb18aa95a6c5baf7b48ac07bed6e10d011612409429636",0]] },
      ]),
      replacementCallerPath: "js/core/map_renderer/map_hover_interaction_owner.js",
      replacementCallerBindingIdentity: createP44FunctionParameterBindingIdentity("createMapHoverInteractionOwner", "$/property:state"),
      replacementEnclosingFunctionIdentity: createP44FunctionIdentity("createMapHoverInteractionOwner", "setHoverOverlayDirty"),
      actionModulePath: RENDERER_INTERACTION_ACTION_MODULE_PATH, actionExportName: "setClickHoverOverlayDirtyState", targetArgumentIndex: 0,
      replacementActionSourceFingerprint: "d3c5982a9456a99000c605f2516c1ef94ac89a12c2c07a56f5c3dbe16bdf2080",
    }),
    freezeCrossFileMigrationEntry({
      retiredCallerPath: "js/core/map_renderer.js",
      retiredCallerBindingIdentity: MAP_RENDERER_RUNTIME_STATE_BINDING_IDENTITY,
      domain: "ui", migrationPhase: "P4.4", operation: "assign", key: "hoveredId",
      retiredMutationSites: createP44RetiredMutationSites([
        { ancestryNames: ["clearUnderlyingHoverForFacilityEntry"], sites: [["480716aca0ac4b1b6c73b8f237759ac1c82b9fc9896b9941a2eb15954bc31319",0]] },
        { ancestryNames: ["getMapHoverInteractionOwner","setHoverIds"], sites: [["480716aca0ac4b1b6c73b8f237759ac1c82b9fc9896b9941a2eb15954bc31319",0]] },
        { ancestryNames: ["handleMapMouseLeave"], sites: [["480716aca0ac4b1b6c73b8f237759ac1c82b9fc9896b9941a2eb15954bc31319",0]] },
      ]),
      replacementCallerPath: "js/core/map_renderer/map_hover_interaction_owner.js",
      replacementCallerBindingIdentity: createP44FunctionParameterBindingIdentity("createMapHoverInteractionOwner", "$/property:state"),
      replacementEnclosingFunctionIdentity: createP44FunctionIdentity("createMapHoverInteractionOwner", "setHoverIds"),
      actionModulePath: RENDERER_INTERACTION_ACTION_MODULE_PATH, actionExportName: "setHoveredFeatureIdsState", targetArgumentIndex: 0,
      replacementActionSourceFingerprint: "fe643f1d784d04fdaad71a856bece9288bfe301d5f3394eecdc4fca887df04b2",
    }),
    freezeCrossFileMigrationEntry({
      retiredCallerPath: "js/core/map_renderer.js",
      retiredCallerBindingIdentity: MAP_RENDERER_RUNTIME_STATE_BINDING_IDENTITY,
      domain: "ui", migrationPhase: "P4.4", operation: "assign", key: "hoveredSpecialRegionId",
      retiredMutationSites: createP44RetiredMutationSites([
        { ancestryNames: ["clearUnderlyingHoverForFacilityEntry"], sites: [["18e1ca5e9f601ffd560d54762bef40bc83540eb2c07dd451fd594d24c7790834",0]] },
        { ancestryNames: ["getMapHoverInteractionOwner","setHoverIds"], sites: [["18e1ca5e9f601ffd560d54762bef40bc83540eb2c07dd451fd594d24c7790834",0]] },
        { ancestryNames: ["handleMapMouseLeave"], sites: [["18e1ca5e9f601ffd560d54762bef40bc83540eb2c07dd451fd594d24c7790834",0]] },
      ]),
      replacementCallerPath: "js/core/map_renderer/map_hover_interaction_owner.js",
      replacementCallerBindingIdentity: createP44FunctionParameterBindingIdentity("createMapHoverInteractionOwner", "$/property:state"),
      replacementEnclosingFunctionIdentity: createP44FunctionIdentity("createMapHoverInteractionOwner", "setHoverIds"),
      actionModulePath: RENDERER_INTERACTION_ACTION_MODULE_PATH, actionExportName: "setHoveredFeatureIdsState", targetArgumentIndex: 0,
      replacementActionSourceFingerprint: "fe643f1d784d04fdaad71a856bece9288bfe301d5f3394eecdc4fca887df04b2",
    }),
    freezeCrossFileMigrationEntry({
      retiredCallerPath: "js/core/map_renderer.js",
      retiredCallerBindingIdentity: MAP_RENDERER_RUNTIME_STATE_BINDING_IDENTITY,
      domain: "ui", migrationPhase: "P4.4", operation: "assign", key: "hoveredWaterRegionId",
      retiredMutationSites: createP44RetiredMutationSites([
        { ancestryNames: ["clearUnderlyingHoverForFacilityEntry"], sites: [["92f477d4bd553d571a84078255db7d005f497f3806336f745eadbf0d31008e57",0]] },
        { ancestryNames: ["getMapHoverInteractionOwner","setHoverIds"], sites: [["92f477d4bd553d571a84078255db7d005f497f3806336f745eadbf0d31008e57",0]] },
        { ancestryNames: ["handleMapMouseLeave"], sites: [["92f477d4bd553d571a84078255db7d005f497f3806336f745eadbf0d31008e57",0]] },
      ]),
      replacementCallerPath: "js/core/map_renderer/map_hover_interaction_owner.js",
      replacementCallerBindingIdentity: createP44FunctionParameterBindingIdentity("createMapHoverInteractionOwner", "$/property:state"),
      replacementEnclosingFunctionIdentity: createP44FunctionIdentity("createMapHoverInteractionOwner", "setHoverIds"),
      actionModulePath: RENDERER_INTERACTION_ACTION_MODULE_PATH, actionExportName: "setHoveredFeatureIdsState", targetArgumentIndex: 0,
      replacementActionSourceFingerprint: "fe643f1d784d04fdaad71a856bece9288bfe301d5f3394eecdc4fca887df04b2",
    }),
    freezeCrossFileMigrationEntry({
      retiredCallerPath: "js/core/map_renderer.js",
      retiredCallerBindingIdentity: MAP_RENDERER_RUNTIME_STATE_BINDING_IDENTITY,
      domain: "ui", migrationPhase: "P4.4", operation: "assign", key: "tooltipPendingState",
      retiredMutationSites: createP44RetiredMutationSites([
        { ancestryNames: ["getRendererStartupTransactionOwner","resetTooltipState"], sites: [["0eb2b366382c01eb7d1b630cc05819a468c0470f2d1df087a07e2e7510ebaf10",0]] },
        { ancestryNames: ["queueTooltipUpdate","<anonymous>"], sites: [["0eb2b366382c01eb7d1b630cc05819a468c0470f2d1df087a07e2e7510ebaf10",0]] },
        { ancestryNames: ["queueTooltipUpdate"], sites: [["0eb2b366382c01eb7d1b630cc05819a468c0470f2d1df087a07e2e7510ebaf10",0]] },
      ]),
      replacementCallerPath: "js/core/map_renderer/map_hover_interaction_owner.js",
      replacementCallerBindingIdentity: createP44FunctionParameterBindingIdentity("createMapHoverInteractionOwner", "$/property:state"),
      replacementEnclosingFunctionIdentity: createP44FunctionIdentity("createMapHoverInteractionOwner", "resetTooltipState"),
      actionModulePath: RENDERER_INTERACTION_ACTION_MODULE_PATH, actionExportName: "setTooltipPendingState", targetArgumentIndex: 0,
      replacementActionSourceFingerprint: "dd50ffa1b300fc489909c429f53d3dc04c4463fd00467eaf8ac4b7fe67e9884c",
    }),
    freezeCrossFileMigrationEntry({
      retiredCallerPath: "js/core/map_renderer.js",
      retiredCallerBindingIdentity: MAP_RENDERER_RUNTIME_STATE_BINDING_IDENTITY,
      domain: "ui", migrationPhase: "P4.4", operation: "assign", key: "tooltipRafHandle",
      retiredMutationSites: createP44RetiredMutationSites([
        { ancestryNames: ["getRendererStartupTransactionOwner","resetTooltipState"], sites: [["34020ee3bf3c2ba2ba3110ca210d7a556ae8134bfb59d2807c2a1a5112dd1a71",0]] },
        { ancestryNames: ["queueTooltipUpdate","<anonymous>"], sites: [["34020ee3bf3c2ba2ba3110ca210d7a556ae8134bfb59d2807c2a1a5112dd1a71",0]] },
        { ancestryNames: ["queueTooltipUpdate"], sites: [["34020ee3bf3c2ba2ba3110ca210d7a556ae8134bfb59d2807c2a1a5112dd1a71",0]] },
      ]),
      replacementCallerPath: "js/core/map_renderer/map_hover_interaction_owner.js",
      replacementCallerBindingIdentity: createP44FunctionParameterBindingIdentity("createMapHoverInteractionOwner", "$/property:state"),
      replacementEnclosingFunctionIdentity: createP44FunctionIdentity("createMapHoverInteractionOwner", "resetTooltipState"),
      actionModulePath: RENDERER_INTERACTION_ACTION_MODULE_PATH, actionExportName: "setTooltipRafHandleState", targetArgumentIndex: 0,
      replacementActionSourceFingerprint: "d8bc90b434bf3f1511fdb2f0503cc8c762b64f6e884a387f66272f32d57a3c87",
    }),
    freezeCrossFileMigrationEntry({
      retiredCallerPath: "js/core/renderer/border_draw_owner.js",
      retiredCallerBindingIdentity: createP44FunctionParameterBindingIdentity("createBorderDrawOwner", "$/property:state"),
      domain: "renderer", migrationPhase: "P4.3", operation: "assign", key: "cachedDetailAdmBorders",
      retiredMutationSites: createP44RetiredMutationSites([
        { ancestryNames: ["createBorderDrawOwner","drawHierarchicalBorders"], sites: [["f9a09e0ed92bffaefd4815181ad745170b32a19a5be357d01790fd56d23bf2a4",0]] },
      ]),
      replacementCallerPath: "js/core/renderer/border_mesh_owner.js",
      replacementCallerBindingIdentity: createP44FunctionParameterBindingIdentity("createBorderMeshOwner", "$/property:state"),
      replacementEnclosingFunctionIdentity: createP44FunctionIdentity("createBorderMeshOwner", "replaceDetailAdmBorders"),
      actionModulePath: RENDERER_CACHE_ACTION_MODULE_PATH, actionExportName: "replaceCachedDetailAdmBordersState", targetArgumentIndex: 0,
      replacementActionSourceFingerprint: "13858ddc24bfd4790980720065a0e31215884cbe521f105d34f209950b4ff44c",
    }),
    ...SCENARIO_RUNTIME_ACTIVATION_RETIREMENT_SITES.map(createScenarioRuntimeActivationRetirementEntry),
    // These two historical sites belonged to the optional-layer helper, even
    // though the frozen alias inventory attached them to the activation binding.
    ...[
      ["scenarioPoliticalChunkData", "6e1a9b4c807115a4fea48d77fd72cb08fc1bc84ce3e20ed997859948352a4986"],
      ["scenarioPoliticalVisibleChunkData", "1f447d1cbf2d5f017fffc794f693ce9b25cca35961b9967dd41381dcff2a1915"],
    ].map(([key, sourceFingerprint]) => freezeCrossFileMigrationEntry({
      retiredCallerPath: "js/core/state/scenario_runtime_state.js",
      retiredCallerBindingIdentity: createP44FunctionParameterBindingIdentity("commitScenarioActivationRuntimeState"),
      domain: "scenario", migrationPhase: "P4.2", operation: "assign", key,
      retiredMutationSites: [{
        enclosingFunctionIdentity: createP44FunctionIdentity("setScenarioRuntimeOptionalLayerState"),
        sourceFingerprint, occurrenceIndex: 0,
      }],
      replacementCallerPath: "js/core/state/scenario_runtime_state.js",
      replacementCallerBindingIdentity: createP44FunctionParameterBindingIdentity("setScenarioRuntimeOptionalLayerState"),
      replacementEnclosingFunctionIdentity: createP44FunctionIdentity("setScenarioRuntimeOptionalLayerState"),
      actionModulePath: SCENARIO_CHUNK_PROMOTION_ACTION_MODULE_PATH,
      actionExportName: "setScenarioPoliticalChunkPayloadState", targetArgumentIndex: 0,
      replacementActionSourceFingerprint: "2aa7cb93c56d94e0f81ca38de3c9eddbc7759cb5014e9385c37317eb2a7b9991",
    })),
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
          "js/core/renderer/pixel_ratio_policy.js",
        replacementCallerBindingIdentity:
          "{\"kind\":\"function-parameter\",\"name\":\"\",\"functionName\":\"createPixelRatioPolicy\",\"parameterName\":\"\",\"parameterIndex\":0,\"parameterPath\":\"$/property:runtimeState\",\"importSource\":\"\",\"importedName\":\"\",\"aliasSources\":[],\"aliasOperators\":[]}",
        replacementEnclosingFunctionIdentity:
          "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createPixelRatioPolicy\",\"ordinal\":0},{\"name\":\"updateDprStage\",\"ordinal\":0}]}",
        actionModulePath: RENDERER_PHASE_ACTION_MODULE_PATH,
        actionExportName: "commitRendererDprStageState",
        replacementActionSourceFingerprint:
          "d6f8982b4d145ebf2faa71a6c4112c7073fc1c538b754af2f6e085b3a3c5d901",
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
        "js/core/renderer/visible_frame_diagnostics_owner.js",
      replacementCallerBindingIdentity:
        "{\"kind\":\"function-parameter\",\"name\":\"\",\"functionName\":\"createVisibleFrameDiagnosticsOwner\",\"parameterName\":\"\",\"parameterIndex\":0,\"parameterPath\":\"$/property:runtimeState\",\"importSource\":\"\",\"importedName\":\"\",\"aliasSources\":[],\"aliasOperators\":[]}",
      replacementEnclosingFunctionIdentity:
        "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createVisibleFrameDiagnosticsOwner\",\"ordinal\":0},{\"name\":\"<anonymous>\",\"ordinal\":1}]}",
      actionModulePath:
        RENDERER_DIAGNOSTICS_ACTION_MODULE_PATH,
      actionExportName: "setFirstVisibleFramePaintedState",
      replacementActionSourceFingerprint:
        "aa23300756fbd1509d1038ce98cdd0431d49848b8de76edf9a3b1e3ee988e685",
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
        "js/core/renderer/projected_bounds_diagnostics_owner.js",
      replacementCallerBindingIdentity:
        "{\"kind\":\"function-parameter\",\"name\":\"\",\"functionName\":\"createProjectedBoundsDiagnosticsOwner\",\"parameterName\":\"\",\"parameterIndex\":0,\"parameterPath\":\"$/property:runtimeState\",\"importSource\":\"\",\"importedName\":\"\",\"aliasSources\":[],\"aliasOperators\":[]}",
      replacementEnclosingFunctionIdentity:
        "{\"kind\":\"function\",\"ancestry\":[{\"name\":\"createProjectedBoundsDiagnosticsOwner\",\"ordinal\":0},{\"name\":\"recordProjectedBoundsDiagnosticsState\",\"ordinal\":0}]}",
      actionModulePath:
        RENDERER_DIAGNOSTICS_ACTION_MODULE_PATH,
      actionExportName:
        "setProjectedBoundsDiagnosticsState",
      replacementActionSourceFingerprint:
        "fee97a9d0c1e461648d339dc0c796e20a74683ea767399e1c71e44e4b2d80061",
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
  if (
    migrationPhase !== "multi-phase"
    && !/^P4\.[1-4]$/.test(migrationPhase)
  ) {
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

export function validateStateActionSuccessorProofContract(
  entries = STATE_ACTION_SUCCESSOR_PROOF_CONTRACT,
) {
  if (!Array.isArray(entries)) {
    return [createViolation(
      "state-action-successor-proof-contract-invalid",
      { reason: "entries-not-array" },
    )];
  }
  const violations = [];
  const seen = new Set();
  const identities = [];
  for (const [index, entry] of entries.entries()) {
    const identity = [
      normalizeModulePath(entry?.modulePath),
      String(entry?.exportName || ""),
      normalizeStateActionMembership(entry?.replacementMembership),
    ].join("#");
    identities.push(identity);
    const carrierFunctions = entry?.carrierFunctions;
    const successorEdges = entry?.successorEdges;
    const normalizedForIdentity = {
      modulePath: normalizeModulePath(entry?.modulePath),
      exportName: String(entry?.exportName || ""),
      replacementMembership:
        normalizeStateActionMembership(entry?.replacementMembership),
      requiredDirectMemberships: entry?.requiredDirectMemberships,
      carrierFunctions,
      successorEdges,
    };
    const valid = Boolean(
      findStateActionDelegationContractEntry(
        entry?.modulePath,
        entry?.exportName,
      )
      && parseStateActionMembership(entry?.replacementMembership)
      && Array.isArray(entry?.requiredDirectMemberships)
      && entry.requiredDirectMemberships.every((membership) =>
        parseStateActionMembership(membership)
      )
      && new Set(entry.requiredDirectMemberships).size
        === entry.requiredDirectMemberships.length
      && Array.isArray(carrierFunctions)
      && carrierFunctions.length > 0
      && carrierFunctions.some((carrier) =>
        carrier?.functionName === entry?.exportName
      )
      && new Set(carrierFunctions.map(
        (carrier) => carrier?.functionName,
      )).size === carrierFunctions.length
      && carrierFunctions.every((carrier) =>
        isValidExportName(carrier?.functionName)
        && /^[0-9a-f]{64}$/i.test(
          String(carrier?.sourceFingerprint || ""),
        )
      )
      && Array.isArray(successorEdges)
      && successorEdges.length > 0
      && new Set(successorEdges.map((edge) => JSON.stringify(edge)))
        .size === successorEdges.length
      && successorEdges.every((edge) =>
        edge?.enclosingFunctionIdentity
        && findStateActionDelegationContractEntry(
          edge?.actionModulePath,
          edge?.actionExportName,
        )
        && Number.isInteger(edge?.targetArgumentIndex)
        && edge.targetArgumentIndex === 0
        && Number.isInteger(edge?.occurrenceIndex)
        && edge.occurrenceIndex >= 0
        && parseStateActionMembership(edge?.terminalMembership)
        && !(
          normalizeModulePath(edge?.actionModulePath)
            === normalizeModulePath(entry?.modulePath)
          && String(edge?.actionExportName || "")
            === String(entry?.exportName || "")
        )
        && /^[0-9a-f]{64}$/i.test(
          String(edge?.sourceFingerprint || ""),
        )
      )
      && /^[0-9a-f]{64}$/i.test(
        String(entry?.contractIdentity || ""),
      )
      && entry.contractIdentity === createHash("sha256")
        .update(JSON.stringify(normalizedForIdentity))
        .digest("hex")
    );
    const legacyReplacement =
      STATE_ACTION_LEGACY_MEMBERSHIP_REPLACEMENT_CONTRACT.find(
        (candidate) =>
          candidate.modulePath === normalizedForIdentity.modulePath
          && candidate.exportName === normalizedForIdentity.exportName
          && candidate.retiredMembership
            === normalizedForIdentity.replacementMembership,
      );
    const hybridCoverage = [...new Set([
      ...(entry?.requiredDirectMemberships || []),
      ...(entry?.successorEdges || []).map(
        (edge) => edge.terminalMembership,
      ),
    ])].sort();
    const hybridCoverageValid = entry?.requiredDirectMemberships?.length
      ? Boolean(
        legacyReplacement
        && JSON.stringify(hybridCoverage) === JSON.stringify(
          [...legacyReplacement.requiredConcreteMemberships].sort(),
        )
      )
      : true;
    if (!valid || !hybridCoverageValid) {
      violations.push(createViolation(
        "state-action-successor-proof-entry-invalid",
        { index, identity },
      ));
    }
    if (seen.has(identity)) {
      violations.push(createViolation(
        "state-action-successor-proof-entry-duplicate",
        { index, identity },
      ));
    }
    seen.add(identity);
  }
  if (JSON.stringify(identities) !== JSON.stringify([...identities].sort())) {
    violations.push(createViolation(
      "state-action-successor-proof-order-invalid",
    ));
  }
  return violations;
}

const LEGACY_MEMBERSHIP_REPLACEMENT_OPERATIONS = Object.freeze({
  assign: Object.freeze(["assign", "define-property"]),
  "collection-mutate": Object.freeze(["assign"]),
  "compound-assign": Object.freeze(["assign"]),
  delete: Object.freeze(["delete"]),
  "object-assign": Object.freeze(["assign", "define-property"]),
});

function getLegacyMembershipReplacementOperations(operation = "") {
  return LEGACY_MEMBERSHIP_REPLACEMENT_OPERATIONS[operation] || [];
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
    const allowedReplacementOperations =
      getLegacyMembershipReplacementOperations(
        retiredMembership?.operation,
      );
    const requiredMembershipShapeValid =
      retiredMembership?.key === "*"
        ? parsedRequiredMemberships.every(
          (membership) =>
            membership
            && membership.key !== "*"
            && allowedReplacementOperations.includes(
              membership.operation,
            ),
        )
        : parsedRequiredMemberships.every(
          (membership) =>
            membership
            && membership.domain === retiredMembership?.domain
            && membership.migrationPhase
              === retiredMembership?.migrationPhase
            && membership.key === retiredMembership?.key
            && allowedReplacementOperations.includes(
              membership.operation,
            ),
        );
    const valid = Boolean(
      normalized.modulePath === String(entry.modulePath || "")
      && actionContract
      && retiredMembership
      && allowedReplacementOperations.length > 0
      && requiredMemberships.length > 0
      && JSON.stringify(requiredMemberships)
        === JSON.stringify(requiredMembershipsSorted)
      && new Set(requiredMemberships).size === requiredMemberships.length
      && requiredMembershipShapeValid
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
  const baseMemberships = new Set(
    [...(memberships instanceof Set
      ? memberships
      : (Array.isArray(memberships) ? memberships : []))]
      .map(normalizeStateActionMembership)
      .filter(Boolean),
  );
  const effectiveMemberships = new Set(baseMemberships);
  if (
    validateStateActionLegacyMembershipReplacementContract(
      contractEntries,
    ).length
  ) {
    return effectiveMemberships;
  }
  const normalizedModulePath = normalizeModulePath(modulePath);
  const normalizedExportName = String(exportName || "");
  for (const entry of contractEntries) {
    const retiredMembership = parseStateActionMembership(
      entry.retiredMembership,
    );
    const allowedReplacementOperations =
      getLegacyMembershipReplacementOperations(
        retiredMembership?.operation,
      );
    const replacementMemberships = [...baseMemberships].filter(
      (membership) => {
        const parsed = parseStateActionMembership(membership);
        if (
          !parsed
          || parsed.key === "*"
          || !allowedReplacementOperations.includes(parsed.operation)
        ) {
          return false;
        }
        return retiredMembership?.key === "*"
          || (
            parsed.domain === retiredMembership?.domain
            && parsed.migrationPhase
              === retiredMembership?.migrationPhase
            && parsed.key === retiredMembership?.key
          );
      },
    );
    if (
      entry.modulePath !== normalizedModulePath
      || entry.exportName !== normalizedExportName
      || replacementMemberships.length
        !== entry.requiredConcreteMemberships.length
      || !entry.requiredConcreteMemberships.every(
        (membership) => baseMemberships.has(membership),
      )
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

export function findStateImportedPureReaderContractEntry(modulePath, exportName) {
  return STATE_TARGET_PURE_READER_CONTRACT.find((entry) => (
    entry.modulePath === normalizeModulePath(modulePath)
    && entry.functionName === exportName
    && entry.targetParameterPath === "$"
    && entry.importedArgumentCount > entry.targetParameterIndex
  )) || null;
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
    const readSites = entry.reviewedReadSiteFingerprints || [];
    const localFunctions = entry.localFunctionFingerprints || {};
    if (!localFunctions || typeof localFunctions !== "object" || Array.isArray(localFunctions)
      || Object.entries(localFunctions).some(([name, fingerprint]) => (
        !isValidExportName(name) || !/^[a-f0-9]{64}$/.test(String(fingerprint))
      ))) {
      violations.push(createViolation("state-target-pure-reader-dependencies-invalid", { index, entryId }));
    }
    if (!Array.isArray(readSites) || new Set(readSites).size !== readSites.length
      || readSites.some((value) => !/^[a-f0-9]{64}$/.test(String(value)))) {
      violations.push(createViolation("state-target-pure-reader-read-sites-invalid", { index, entryId }));
    }
    if (
      !/^js\/[^/].*\.js$/.test(normalizeModulePath(entry.modulePath))
      || !isValidExportName(entry.functionName)
      || !isValidExportName(entry.targetParameterName)
      || !Number.isInteger(entry.targetParameterIndex)
      || entry.targetParameterIndex < 0
      || !Number.isInteger(entry.importedArgumentCount ?? 0)
      || typeof (entry.allowBorrowedTarget ?? false) !== "boolean"
      || (entry.importedArgumentCount ?? 0) < 0
      || ((entry.importedArgumentCount ?? 0) > 0 && (
        entry.targetParameterPath !== "$" || entry.importedArgumentCount <= entry.targetParameterIndex
      ))
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
        || !(String(finding?.reason || "") === "state-alias-escape"
          || (["unsupported-call-mutation", "ambiguous-alias-flow"].includes(finding?.reason)
            && readSites.includes(finding?.sourceFingerprint)))
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

function validateReviewedStateReadSites(source, ast, functionNode, fingerprints = []) {
  const pending = new Set(fingerprints);
  const violations = [];
  const readMethods = new Set(["get", "has", "keys", "join", "map", "forEach", "some"]);
  const fingerprint = (node) => createHash("sha256")
    .update(source.slice(node.start, node.end).trim().replaceAll("\r\n", "\n"))
    .digest("hex");
  const localFunctions = new Map([
    ...topLevelFunctionDeclarations(ast),
    ...directFunctionDeclarations(functionNode),
  ]);
  walkSyntaxTree(functionNode.body, (node) => {
    if (node.type !== "CallExpression" || node.callee?.type !== "MemberExpression") return;
    const identities = [fingerprint(node), fingerprint(node.callee)];
    const matches = identities.filter((identity) => pending.has(identity));
    if (!matches.length) return;
    const method = !node.callee.computed ? node.callee.property?.name : "";
    if (!readMethods.has(method)) {
      violations.push(createViolation("state-target-pure-reader-read-method-invalid", { method }));
      return;
    }
    if (["map", "forEach", "some"].includes(method)) {
      const callback = node.arguments[0];
      if (!["ArrowFunctionExpression", "FunctionExpression"].includes(callback?.type)) {
        violations.push(createViolation("state-target-pure-reader-read-callback-invalid", { method }));
        return;
      }
      const hazards = collectReachableTaintedHazardSites({
        ast, rootFunction: callback, taintedParameterIndexes: [0, 2], localFunctions,
      }).filter((site) => site.type !== "ReturnStatement");
      if (hazards.length) {
        violations.push(createViolation("state-target-pure-reader-read-callback-mutation", {
          method, lines: hazards.map((site) => Number(site.loc?.start?.line || 1)),
        }));
        return;
      }
    }
    for (const identity of matches) pending.delete(identity);
  });
  if (pending.size) {
    violations.push(createViolation("state-target-pure-reader-read-site-unverified", {
      fingerprints: [...pending],
    }));
  }
  return violations;
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
  if (entry.importedArgumentCount > 0 && !ast.body.some((node) => (
    node.type === "ExportNamedDeclaration"
    && node.declaration?.type === "FunctionDeclaration"
    && node.declaration.id?.name === entry.functionName
  ))) {
    violations.push(createViolation("state-target-pure-reader-direct-export-required", {
      modulePath: entry.modulePath, functionName: entry.functionName,
    }));
  }
  const [functionNode] = functions;
  if (entry.allowBorrowedTarget || Object.keys(entry.localFunctionFingerprints || {}).length) {
    const localFunctions = topLevelFunctionDeclarations(ast);
    const dependencies = new Map();
    const pending = [functionNode];
    while (pending.length) {
      walkSyntaxTree(pending.pop().body, (node) => {
        if (node.type !== "CallExpression" || node.callee?.type !== "Identifier") return;
        const helper = localFunctions.get(node.callee.name);
        if (!helper || helper === functionNode || dependencies.has(node.callee.name)) return;
        dependencies.set(node.callee.name, helper);
        pending.push(helper);
      });
    }
    const expected = entry.localFunctionFingerprints || {};
    for (const name of new Set([...dependencies.keys(), ...Object.keys(expected)])) {
      const helper = dependencies.get(name);
      const actual = helper ? createHash("sha256")
        .update(String(source || "").slice(helper.start, helper.end).replaceAll("\r\n", "\n").trim())
        .digest("hex") : "";
      if (!actual || actual !== expected[name]) {
        violations.push(createViolation("state-target-pure-reader-dependency-source-drift", {
          modulePath: entry.modulePath, functionName: entry.functionName, dependencyName: name,
        }));
      }
    }
  }
  violations.push(...validateReviewedStateReadSites(
    String(source || ""), ast, functionNode, entry.reviewedReadSiteFingerprints || [],
  ));
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
    const expectedBorrowedResultPaths = modulePath === SCENARIO_ACTIVATION_ACTION_MODULE_PATH
      && exportName === "applyScenarioChunkOptionalLayerState" ? [["externalEffect", "payload"]] : [];
    if (JSON.stringify(entry.borrowedResultPaths || []) !== JSON.stringify(expectedBorrowedResultPaths)) {
      violations.push(createViolation("state-action-contract-borrowed-result-paths-invalid", { index, modulePath, exportName }));
    }
    if (
      entry.referenceIdentityArgumentIndexes !== undefined
      && !Array.isArray(entry.referenceIdentityArgumentIndexes)
    ) {
      violations.push(
        createViolation(
          "state-action-contract-reference-identity-argument-indexes-invalid",
          { index, modulePath, exportName },
        ),
      );
    } else {
      const seenReferenceIdentityIndexes = new Set();
      for (
        const referenceIdentityArgumentIndex of
        entry.referenceIdentityArgumentIndexes || []
      ) {
        if (
          !Number.isInteger(referenceIdentityArgumentIndex)
          || referenceIdentityArgumentIndex < 0
          || referenceIdentityArgumentIndex === entry.targetArgumentIndex
          || seenReferenceIdentityIndexes.has(referenceIdentityArgumentIndex)
        ) {
          violations.push(
            createViolation(
              "state-action-contract-reference-identity-argument-index-invalid",
              {
                index,
                modulePath,
                exportName,
                referenceIdentityArgumentIndex,
              },
            ),
          );
        }
        seenReferenceIdentityIndexes.add(referenceIdentityArgumentIndex);
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
  const canonicalSource = String(source || "").replace(/\r\n?/g, "\n");
  const normalizedPath = normalizeModulePath(filePath);
  const entries = (Array.isArray(contractEntries) ? contractEntries : [])
    .filter(
      (entry) =>
        normalizeModulePath(entry?.modulePath) === normalizedPath,
    );
  const violations = validateStateActionDelegationContract(entries);

  let ast;
  try {
    ast = parseModuleSource(canonicalSource);
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
  const topLevelFunctions = topLevelFunctionDeclarations(ast);
  for (const successorEntry of STATE_ACTION_SUCCESSOR_PROOF_CONTRACT.filter(
    (entry) => entry.modulePath === normalizedPath
  )) {
    for (const carrier of successorEntry.carrierFunctions) {
      const functionNode = topLevelFunctions.get(carrier.functionName);
      const actualSourceFingerprint = functionNode
        ? fingerprintFunctionSource(canonicalSource, functionNode)
        : "";
      if (
        !functionNode
        || actualSourceFingerprint !== carrier.sourceFingerprint
      ) {
        violations.push(createViolation(
          "state-action-successor-carrier-source-drift",
          {
            modulePath: normalizedPath,
            exportName: successorEntry.exportName,
            replacementMembership:
              successorEntry.replacementMembership,
            functionName: carrier.functionName,
            expectedSourceFingerprint: carrier.sourceFingerprint,
            actualSourceFingerprint,
          },
        ));
      }
    }
  }
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

// Effectful target delegation: the imported implementation is scanned separately, including its commit action edge.
export const STATE_TARGET_EFFECTFUL_DELEGATOR_CONTRACT = Object.freeze([Object.freeze({"modulePath":"js/core/state/renderer_runtime_state.js","exportName":"ensureProjectedBoundsCacheState","targetArgumentIndex":0,"argumentCount":1,"sourceFingerprint":"86c16c937cd2d3a28ef05dc3c42b47630f70b32355caab99394e6a835783abb8"})]);

// Exact Map storage effects borrow keys/values without mutating them. Function drift invalidates this proof.
export const STATE_ACTION_BORROWED_MAP_STORAGE_CONTRACT = Object.freeze([{"modulePath":"js/core/state/actions/renderer_cache_actions.js","exportName":"setProjectedBoundsCacheEntryState","targetParameterName":"target","containerField":"projectedBoundsById","moduleSourceFingerprint":"4ffe985761e14cba6978de1f529007317063d1ecc9776108b67a5d3cf8a1c739","sourceFingerprint":"139d116c8614556880da2a440519ec83bc1ebcd7fd9ca072d808473f573e7ae7"},{"modulePath":"js/core/state/actions/renderer_cache_actions.js","exportName":"syncProjectedBoundsCacheEntryState","targetParameterName":"target","containerField":"projectedBoundsById","moduleSourceFingerprint":"4ffe985761e14cba6978de1f529007317063d1ecc9776108b67a5d3cf8a1c739","sourceFingerprint":"d399d0e2920a555fc9041ecef290bcd9c0d899017ef47acfb471f20d496f36da"}].map(Object.freeze));
