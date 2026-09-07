// Hybrid canvas + SVG rendering engine.
// 这个文件仍是渲染主控壳层：owner/facade 已经拆到子模块，但跨子系统的调度、
// runtime 句柄和 render pass 编排还集中留在这里。后续修改优先下沉到对应 owner，
// 只有真正跨域的 orchestration 才继续放在本文件。
import {
  getLineMidpointFromCoordinates,
  getMultiLineLabelAnchor,
  getOperationGraphicPreset,
  getOperationalLinePreset,
  getOperationGraphicMinPoints,
  getOperationalLineMinPoints,
  normalizeOperationGraphicStylePreset,
  normalizeOperationalLineStylePreset,
  normalizeOperationGraphicStroke,
  normalizeOperationGraphicWidth,
  normalizeOperationGraphicOpacity,
  getOperationGraphicEditorMidpoints,
  getOperationGraphicLabelAnchor,
  DEFAULT_OPERATION_GRAPHIC_KIND,
  DEFAULT_OPERATIONAL_LINE_KIND,
  OPERATION_GRAPHIC_STYLE_PRESETS,
  OPERATIONAL_LINE_STYLE_PRESETS,
} from "./renderer/operation_graphic_geometry.js";
import {
  createUnitCounterDisplayModel,
  normalizeUnitCounterStatPercent,
  normalizeUnitCounterStatsPresetId,
  normalizeUnitCounterBaseFillColor,
  getNormalizedUnitCounterCombatState,
  normalizeUnitCounterNationSource,
  getUnitCounterSlotOffset,
  compareUnitCounterRenderOrder,
  getUnitCounterNodeTransform,
  DEFAULT_UNIT_COUNTER_ORGANIZATION_PCT,
  DEFAULT_UNIT_COUNTER_EQUIPMENT_PCT,
  DEFAULT_UNIT_COUNTER_BASE_FILL,
  DEFAULT_UNIT_COUNTER_RENDERER,
} from "./renderer/unit_counter_display_model.js";
import {
  getCityCanonicalId,
  getCityTier,
  getCityTierWeight,
  getDefaultCityMinZoomForTier,
  getCityEffectiveMinZoom,
  getUrbanFeatureStableId,
  getCityCapitalScore,
  getCitySortWeight,
  getCityCountryTierFromScenarioRecord,
  getCityCountryVisibilityClass,
  isCityScenarioTagExcludedFromReveal,
  getCityCountryRevealOverride,
  getFallbackCityCountryTier,
  getCityRevealPhase,
  getCityRevealPhaseInterpolation,
  getCityRevealBucket,
  getCityMarkerDensityMultiplier,
  getCityInterpolatedMarkerQuota,
  getCityInterpolatedMarkerBudget,
  getCityPriorityCountryReserveBudget,
  getCityPriorityCountryReserveRank,
  compareCityRevealEntries,
  getCityLabelBudget,
  isCityLabelEligibleForPhase,
  getCityLabelMinZoom,
  getCityMarkerSizePx,
  CITY_COUNTRY_TIER_RANK,
  CITY_COUNTRY_CLASS_RANK,
  CITY_PRIMARY_POWER_TAGS,
  CITY_SECONDARY_POWER_TAGS,
  CITY_MARKER_SIZE_LIMITS_PX,
} from "./renderer/city_reveal_policy.js";
import {
  bumpColorRevision, normalizeCityLayerStyleConfig,
  normalizeColorStateForRender, normalizeDayNightStyleConfig,
  INTENSITY_FIELD_CHANNEL_IDS, INTENSITY_FIELD_GRID,
  getIntensityFieldTargetPasses, normalizeIntensityFieldsState,
  normalizeLakeStyleConfig, normalizeMapSemanticMode,
  normalizePhysicalStyleConfig, normalizeTransportOverviewStyleConfig,
  normalizeTextureMode, normalizeTextureStyleConfig,
  normalizeUrbanStyleConfig, PHYSICAL_ATLAS_PALETTE,
  replaceResolvedColorsState, sampleIntensityField,
  setResolvedColorForFeature, state as runtimeState,
  bakeIntensityComposite, stampIntensityBrush,
} from "./state.js";
import {
  createDefaultOperationGraphicsEditorState, createDefaultOperationalLineEditorState,
  createDefaultSpecialZoneEditorState, createDefaultUnitCounterEditorState,
} from "./state/strategic_overlay_state.js";
import {
  createDefaultProjectedBoundsDiagnostics,
  createDefaultIntensityFieldToolState,
  applyRendererSurfaceBridgeState,
  ensureProjectedBoundsCacheState,
  ensureRenderPassCacheState,
  ensureSceneSnapshotState,
  ensureSidebarPerfState,
  bumpSceneGenerationState,
  resetProjectedBoundsCacheState as resetProjectedBoundsRuntimeCacheState,
  commitRendererDprStageState, commitProjectedBoundsDiagnosticsState,
} from "./state/renderer_runtime_state.js";
import {
  setAdaptiveSettleProfileState, setPendingDayNightRefreshState,
  setPhaseEnteredAtState, setRendererIsInteractingState,
  setRenderPhaseTimerIdState, setRenderPhaseValueState,
} from "./state/actions/renderer_phase_actions.js";
import {
  clearClickScenarioHoverIdsState, setClickActiveSovereignCodeState,
  setClickSelectedSpecialRegionIdState, setClickSelectedWaterRegionIdState, setDayNightStyleConfigState,
} from "./state/actions/scenario_presentation_actions.js";
import { removeClickCountryColorsState, setClickCountryColorsState } from "./state/actions/scenario_activation_actions.js";
import {
  clearClickHoveredIdState, removeClickWaterRegionOverrideState, setClickHoverOverlayDirtyState,
  setClickSelectedColorState,
  beginInteractionRecoveryTaskState, endInteractionRecoveryTaskState,
  setInteractionInfrastructureStateFields, setPendingZoomTransformState,
  setZoomTransformState, setHitCanvasDirtyState,
  setHitCanvasBuildScheduledState,
  setZoomGestureEndedAtState, setZoomGestureScaleDeltaState,
  setZoomGestureStartTransformState, setZoomRenderScheduledState,
} from "./state/actions/renderer_interaction_actions.js";
import {
  setDeferExactAfterSettleState, setPendingExactPoliticalFastFrameState,
} from "./state/actions/renderer_exact_refresh_actions.js";
import {
  clearSphericalFeatureDiagnosticsCacheState, getSphericalFeatureDiagnosticsCacheEntryState,
  setSphericalFeatureDiagnosticsCacheEntryState,
} from "./state/actions/renderer_cache_actions.js";
import {
  captureProjectedBoundsDiagnosticsState, captureRenderPerfContextBreakdownState,
  captureRenderPerfMetricEntryState, captureRenderPerfMetricsState, captureRenderSnapshotState,
  commitRenderPerfMetricState, ensureRenderPerfMetricsState,
  setDebugCountryCoverageState, setFirstVisibleFramePaintedState,
  setRenderPerfContextBreakdownState, setRenderPerfMetricEntryState,
} from "./state/actions/renderer_diagnostics_actions.js";
import { ColorManager } from "./color_manager.js";
import {
  getCanvasColorRelativeLuminance,
  getSafeCanvasColor,
  mixCanvasColors,
  parseCanvasColorChannels,
} from "./renderer/canvas_color_helpers.js";
import {
  getCountryCode as getSharedFeatureCountryCode,
  getFeatureId as getSharedFeatureId,
} from "./feature_identity.js";
import { resolveDataAssetUrl } from "./runtime_asset_registry.js";
import {
  consumePoliticalRasterWorkerBitmapResult,
  createPoliticalRasterWorkerIdentity,
  ensurePoliticalRasterWorkerMetrics,
  isPoliticalRasterWorkerBitmapEnabled,
  requestPoliticalRasterWorkerPass,
} from "./political_raster_worker_client.js";
import { LegendManager } from "./legend_manager.js";
import { createTransientOverlayRenderOwner } from "./renderer/transient_overlay_render_owner.js";
import { createSelectionOverlayOwner } from "./renderer/selection_overlay_owner.js";
import { createLegendControlOwner } from "./renderer/legend_control_owner.js";
import { captureHistoryState, pushHistoryEntry } from "./history_manager.js";
import {
  getPreferredGeoLabel,
  getStrictGeoLabel,
  getTooltipText,
  renderTooltipText,
  t,
} from "./i18n.js";
import { markDirty } from "./dirty_state.js";
import { perfIsEnabled, recordRenderSample } from "./perf_probe.js";
import { getScenarioCountryDisplayName } from "./scenario_country_display.js";
import {
  SCENARIO_PRESENTATION_FEATURES,
  scenarioHasPresentationFeature,
} from "./scenario/presentation_hint_helpers.js";
import {
  ensureSovereigntyState,
  getFeatureOwnerCode,
  getFeatureIdsForOwner,
  markLegacyColorStateDirty,
  migrateLegacyColorState,
  setFeatureOwnerCodes,
  resetFeatureOwnerCodes,
} from "./sovereignty_manager.js";
import { COUNTRY_CODE_ALIASES, normalizeCountryCodeAlias } from "./country_code_aliases.js";
import { fragmentCamouflageRules } from "./country_feature_policies.js";
import {
  DEFAULT_UNIT_COUNTER_PRESET_ID,
  getUnitCounterIconPathById,
  getUnitCounterPresetById,
  normalizeUnitCounterSizeToken,
} from "./unit_counter_presets.js";
import { enqueueFrameTask, getFrameSchedulerQueueLength } from "./frame_scheduler.js";
import { flushRenderBoundary, getRenderBoundaryDebugState, requestRender } from "./render_boundary.js";
import { callRuntimeHook, callRuntimeHooks, registerRuntimeHook } from "./state/index.js";
import {
  bindInteractionFunnel,
  dispatchMapClick,
  dispatchMapDoubleClick,
} from "./interaction_funnel.js";
import { createUrbanCityPolicyOwner, getUrbanCityRenderPassSignatureParts } from "./renderer/urban_city_policy.js";
import { createCityLabelOwner } from "./renderer/city_label_owner.js";
import { createCityPointsRenderOwner } from "./renderer/city_points_render_owner.js";
import { buildStrategicResourceMarkerEntries } from "./renderer/strategic_resource_markers.js";
import { isScenarioStrategicValuesUsable } from "./scenario/strategic_values.js";
import { createColorResolutionStrategyOwner } from "./renderer/color_resolution_strategy.js";
import { createStrategicOverlayHelpersOwner } from "./renderer/strategic_overlay_helpers.js";
import { createStrategicOverlayRenderOwner } from "./renderer/strategic_overlay_render_owner.js";
import { createStrategicOverlayRuntimeOwner } from "./renderer/strategic_overlay_runtime_owner.js";
import { createPoliticalCollectionOwner } from "./renderer/political_collection_owner.js";
import { createContextLayerResolverOwner } from "./renderer/context_layer_resolver.js";
import { createRendererAssetUrlPolicyOwner } from "./renderer/asset_url_policy.js";
import {
  createFacilitySurfaceOwner,
  shouldBlockUnderlyingMapSelectionForFacility,
} from "./renderer/facility_surface.js";
import { createRiverLayerRenderOwner } from "./renderer/river_layer_render_owner.js";
import { createOceanRenderOwner } from "./renderer/ocean_render_owner.js";
import { createPhysicalLayerRenderOwner } from "./renderer/physical_layer_render_owner.js";
import { createScenarioReliefOverlayRenderOwner } from "./renderer/scenario_relief_overlay_render_owner.js";
import { createCityLightsRenderOwner } from "./renderer/city_lights_render_owner.js";
import { createCityLightsAssetProvider } from "./renderer/city_lights_asset_provider.js";
import { createTransportOverviewRenderOwner } from "./renderer/transport_overview_render_owner.js";
import { createBorderMeshOwner } from "./renderer/border_mesh_owner.js";
import {
  getLatitudeAdjustedSimplifyEpsilon,
  sanitizePolyline,
  simplifyPolylineEffectiveArea,
} from "./renderer/polyline_simplification_helpers.js";
import { createSpecialZoneLayersRenderOwner } from "./renderer/special_zone_layers_render_owner.js";
import {
  normalizeSpecialZoneLayersState,
  updateSpecialZoneLayerMembership,
} from "./special_zone_layers.js";
import { createBorderDrawOwner } from "./renderer/border_draw_owner.js";
import { createInteractionBorderSnapshotOwner } from "./renderer/interaction_border_snapshot_owner.js";
import { createSpatialIndexRuntimeOwner } from "./renderer/spatial_index_runtime_owner.js";
import { getSpatialBucketKey } from "./renderer/spatial_index_runtime_builders.js";
import {
  collectSpatialItemsForProjectedRects,
  collectVisibleSpatialItemsWithStats,
} from "./renderer/spatial_query_index.js";
import { createHgoRuntimePreviewRenderOwner } from "./map_renderer/hgo_runtime_preview_render_owner.js";
import { createSetMapDataTransactionOwner } from "./map_renderer/set_map_data_transaction_owner.js";
import { createRenderRequestBoundaryOwner } from "./map_renderer/render_request_boundary_owner.js";
import { createRenderPhaseLifecycleOwner } from "./map_renderer/render_phase_lifecycle_owner.js";
import { createRenderPassCacheHostOwner } from "./map_renderer/render_pass_cache_host_owner.js";
import { createRenderPassCommitAccountingOwner } from "./map_renderer/render_pass_commit_accounting_owner.js";
import { createDrawCanvasOrchestrationOwner } from "./map_renderer/draw_canvas_orchestration_owner.js";
import { createHitCanvasSchedulingOwner } from "./map_renderer/hit_canvas_scheduling_owner.js";
import { createMapHoverInteractionOwner } from "./map_renderer/map_hover_interaction_owner.js";
import {
  createClickSelectionTransactionOwner,
} from "./map_renderer/click_selection_transaction_owner.js";
import { createRendererTransactionResetOwner } from "./map_renderer/renderer_transaction_reset_owner.js";
import { createScenarioRefreshRuntime } from "./map_renderer/scenario_refresh_runtime.js";
import { createExactAfterSettleScheduler } from "./map_renderer/exact_after_settle_scheduler.js";
import {
  CANVAS_LAYER_NAMES,
  clearCanvasLayer,
  ensureCanvasLayers,
  getCanvasLayer,
  resizeCanvasLayers,
  shouldClearStaleCanvasOverlay,
} from "./map_renderer/canvas_layer_manager.js";
import {
  buildWorkerPixelRingsForGeometry,
} from "./map_renderer/political_raster_worker_packet.js";
import {
  INTERACTION_COMPOSITE_PASS_NAMES,
  RENDER_PASS_NAMES,
  RENDER_PASS_OVERSCAN_RATIO_PER_SIDE,
  TRANSFORM_REUSED_RENDER_PASS_NAMES,
  TRANSFORMED_FRAME_PASS_NAMES,
  VIEWPORT_STABLE_RENDER_PASS_SIGNATURE_NAMES,
} from "./map_renderer/render_pass_catalog.js";
import {
  collectSpatialGridCandidates,
  createHitResult,
  findFirstContainingCandidate as findFirstContainingHitCandidate,
  rankCandidates as rankHitCandidates,
  shouldPreferWaterHit as shouldPreferWaterHitCandidate,
  toHitResult as toCandidateHitResult,
} from "./map_renderer/interaction_hit_candidates.js";
import { createRenderPipelinePassesOwner } from "./renderer/render_pipeline_passes.js";
import { createVisualEffectsPassOwner } from "./renderer/visual_effects_pass_owner.js";
import { createDayNightRuntimeOwner } from "./renderer/day_night_runtime_owner.js";
import { createContextPassOrchestratorOwner } from "./renderer/context_pass_orchestrator_owner.js";
import { createPoliticalPassOrchestratorOwner } from "./renderer/political_pass_orchestrator_owner.js";
import { createPoliticalBackgroundRenderOwner } from "./renderer/political_background_render_owner.js";
import { createPoliticalPartialRepaintOwner } from "./renderer/political_partial_repaint_owner.js";
import { createRenderPerfMetricsRuntimeOwner } from "./renderer/render_perf_metrics_runtime_owner.js";
import { createRenderCacheOwner } from "./renderer/render_cache_owner.js";
import { createCachedPassCompositorOwner } from "./renderer/cached_pass_compositor_owner.js";
import { createTransformedFrameCompositorOwner } from "./map_renderer/transformed_frame_compositor_owner.js";
import { createRenderTransformReusePolicyOwner } from "./renderer/render_transform_reuse_policy_owner.js";
import { createProjectedGeometryBoundsOwner } from "./renderer/projected_geometry_bounds_owner.js";
import { createViewportReadModelOwner } from "./renderer/viewport_read_model_owner.js";
import { createRenderSnapshotOwner } from "./renderer/render_snapshot.js";
import { createViewportCommandOwner } from "./renderer/viewport_command_owner.js";
import { createRendererViewportUpdateOwner } from "./renderer/renderer_viewport_update_owner.js";
import { createRendererStartupTransactionOwner } from "./renderer/renderer_startup_transaction_owner.js";
import { createViewportResizeLifecycleOwner } from "./renderer/viewport_resize_lifecycle_owner.js";
import { createScenarioWaterCachePolicyOwner } from "./renderer/scenario_water_cache_policy_owner.js";
import { createZoomInteractionLifecycleOwner } from "./renderer/zoom_interaction_lifecycle_owner.js";
import { createMapInteractionEventBindingOwner } from "./renderer/map_interaction_event_binding_owner.js";
import { createRendererSurfaceHost } from "./renderer/renderer_surface_host.js";
import { createRendererSurfaceLifecycleOwner } from "./renderer/renderer_surface_lifecycle_owner.js";
import { createRendererProjectionPathOwner } from "./renderer/renderer_projection_path_owner.js";
import { createRendererSvgSurfaceLifecycleOwner } from "./renderer/renderer_svg_surface_lifecycle_owner.js";
import { createRendererFitProjectionOwner } from "./renderer/renderer_fit_projection_owner.js";
import { createVisibleFrameDiagnosticsOwner } from "./renderer/visible_frame_diagnostics_owner.js";
import { recordColorRebuildDiagnostics, recordPartialColorRefreshDiagnostics, recordPendingPoliticalColorEditClearDiagnostics, recordPoliticalPatchOverlayPaintDiagnostics, recordProgressivePoliticalFullCacheReadyDiagnostics, recordRenderPassInvalidationDiagnostics, recordVisibleFrameTransactionDiagnostics } from "./renderer/render_transaction_diagnostics.js";
import { createIntensityFieldMaskOwner } from "./renderer/intensity_field_mask_owner.js";
const state = runtimeState;
const {
  getUnitCounterCardModel,
  getUnitCounterRenderEntries,
  getUnitCounterRenderScale,
} = createUnitCounterDisplayModel({
  runtimeState,
  canonicalCountryCode,
  getScenarioCountryDisplayName,
  ColorManager,
  t,
  getUnitCounterEffectiveSidc,
  getMilSymbolDataUri,
  getOperationalLineById,
  getLineMidpointFromCoordinates,
  clamp,
});

function showToast(message, options = {}) {
  callRuntimeHook(runtimeState, "showToastFn", message, options);
}


const rendererSurfaceHost = createRendererSurfaceHost();
let interactionInfrastructureBasicPromise = null;
let interactionInfrastructureFullPromise = null;
let lastHitCanvasBuildStats = null;
let brushSession = null;
let suppressNextClickAfterBrush = false;
let lastDetailToastToken = "";
let lastDetailToastAt = 0;
let lastInspectorOverlaySignature = "";
let lastDevSelectionOverlaySignature = "";
let lastScenarioWaterRenderedCount = 0;

const PROJECTION_PRECISION = 0.1;
const PATH_POINT_RADIUS = 2;
const VIEWPORT_CULL_OVERSCAN_PX = 96;
const MAP_PAN_PADDING_PX = 50;
const PROJECTION_FIT_PADDING_RATIO = 0.04;
const MIN_ZOOM_SCALE = 0.35;
const MAX_ZOOM_SCALE = 50;
const OCEAN_FILL_COLOR = "#aadaff";
const LAND_FILL_COLOR = "#f0f0f0";
const SPECIAL_REGION_FALLBACK_FILL = "#d6c19a";
const SPECIAL_REGION_FALLBACK_STROKE = "#8d6f47";
const UNIFIED_WATER_STROKE_COLOR = "rgba(62, 96, 138, 0)";
const UNIFIED_WATER_FILL_OPACITY = 1;
const RELIEF_SALT_FILL_COLOR = "rgba(222, 203, 170, 0.22)";
const RELIEF_SALT_STROKE_COLOR = "rgba(128, 100, 63, 0.55)";
const RELIEF_ATLANTROPA_SALT_FILL_COLOR = "rgba(0, 0, 0, 0)";
const RELIEF_ATLANTROPA_SALT_STROKE_COLOR = "rgba(148, 163, 184, 0.22)";
const RELIEF_SHORELINE_COLOR = "rgba(109, 84, 50, 0.78)";
const RELIEF_CONTOUR_COLOR = "rgba(176, 148, 103, 0.6)";
const RELIEF_ATLANTROPA_SHORELINE_COLOR = "rgba(148, 163, 184, 0.36)";
const RELIEF_ATLANTROPA_CONTOUR_COLOR = "rgba(148, 163, 184, 0.18)";
const RELIEF_SWAMP_FILL_COLOR = "rgba(128, 150, 114, 0.28)";
const RELIEF_SWAMP_STROKE_COLOR = "rgba(88, 108, 76, 0.68)";
const RELIEF_LAKE_SHORELINE_COLOR = "rgba(214, 232, 244, 0.92)";
const RELIEF_DAM_APPROACH_COLOR = "rgba(102, 86, 62, 0.8)";
const TNO_COASTAL_ACCENT_COLOR = "rgba(214, 232, 244, 0.88)";
const GIANT_FEATURE_CULL_RATIO = 0.95;
const GIANT_FEATURE_ALLOWLIST = new Set(["RU", "CA", "CN", "US", "AQ", "ATA"]);
const HIGH_FREQUENCY_COUNTRY_DETAIL_WHITELIST = new Set(["US", "CN", "RU", "JP", "DE", "GB", "FR", "IN", "BR", "CA"]);
const INTERACTIVE_AGGREGATE_TIER_FILTERS = {
  GB: new Set(["nuts1_basic"]),
  GR: new Set(["adm1_basic"]),
};
const WRAP_ARTIFACT_WIDTH_RATIO = 0.9;
const WRAP_ARTIFACT_HEIGHT_RATIO = 0.3;
const WRAP_ARTIFACT_AREA_RATIO = 0.35;
const WRAP_ARTIFACT_ASPECT_MIN = 1.6;
const HIT_GRID_TARGET_COLS = 24;
const HIT_GRID_MIN_CELL_PX = 32;
const HIT_GRID_MAX_CELL_PX = 96;
const HIT_SNAP_RADIUS_PX = 8;
const HIT_SNAP_RADIUS_HOVER_PX = 0;
const HIT_SNAP_RADIUS_CLICK_PX = 3;
const HIT_MAX_CELLS_PER_ITEM = 400;
const HIT_MODE_PARAM = "hit_mode";
const HIT_MODES = new Set(["auto", "canvas", "spatial"]);
const COASTLINE_LOD_LOW_ZOOM_MAX = 1.8;
const COASTLINE_LOD_MID_ZOOM_MAX = 3.2;
const COASTLINE_SIMPLIFY_MID_EPSILON = 0.09;
const COASTLINE_SIMPLIFY_LOW_EPSILON = 0.22;
const COASTLINE_SIMPLIFY_MID_MIN_LENGTH = 0.2;
const COASTLINE_SIMPLIFY_LOW_MIN_LENGTH = 0.45;
const COASTLINE_EFFECTIVE_AREA_MULTIPLIER = 0.5;
const COASTLINE_VIEW_SIMPLIFY_LOW_MIN_DISTANCE_PX = 1.8;
const COASTLINE_VIEW_SIMPLIFY_MID_MIN_DISTANCE_PX = 1.1;
const COASTLINE_VIEW_SIMPLIFY_COLLINEAR_ANGLE_DEG = 10;
const COASTLINE_ACCENT_DENSITY_THRESHOLD_LOW = 0.0016;
const COASTLINE_ACCENT_DENSITY_THRESHOLD_MID = 0.0022;
const COASTLINE_ACCENT_DENSITY_ALPHA_LOW = 0.68;
const COASTLINE_ACCENT_DENSITY_ALPHA_MID = 0.82;
const COASTLINE_ACCENT_DENSITY_WIDTH_SCALE = 0.9;
const COASTLINE_OVERLAY_ATLANTROPA_ALPHA = 0.42;
const COASTLINE_OVERLAY_ATLANTROPA_ALPHA_INTERACTIVE = 0.30;
const COASTLINE_OVERLAY_DENSITY_ALPHA_LOW = 0.78;
const COASTLINE_OVERLAY_DENSITY_ALPHA_MID = 0.86;
const COASTLINE_ACCENT_MIN_WIDTH_PX = 0.85;
const COASTLINE_ACCENT_OVERLAY_MIN_WIDTH_PX = 0.95;
const BATHYMETRY_SHALLOW_DEPTH_MAX_M = 200;
const BATHYMETRY_MID_DEPTH_MAX_M = 500;
const BATHYMETRY_BAND_SHALLOW_FADE_START_ZOOM = 2.0;
const BATHYMETRY_BAND_SHALLOW_FADE_END_ZOOM = 2.8;
const BATHYMETRY_BAND_MID_FADE_START_ZOOM = 2.6;
const BATHYMETRY_BAND_MID_FADE_END_ZOOM = 3.4;
const BATHYMETRY_BAND_DEEP_FADE_START_ZOOM = COASTLINE_LOD_MID_ZOOM_MAX;
const BATHYMETRY_BAND_DEEP_FADE_END_ZOOM = 4.2;
const BATHYMETRY_SCENARIO_SYNTHETIC_CONTOUR_FADE_START_ZOOM = 2.0;
const BATHYMETRY_SCENARIO_SYNTHETIC_CONTOUR_FADE_END_ZOOM = 3.0;
const BATHYMETRY_SCENARIO_SHALLOW_CONTOUR_FADE_START_ZOOM = 2.4;
const BATHYMETRY_SCENARIO_SHALLOW_CONTOUR_FADE_END_ZOOM = 3.4;
const BATHYMETRY_PRESET_PROFILES = Object.freeze({
  bathymetry_soft: Object.freeze({
    defaultOpacity: 0.84,
    defaultScale: 1.16,
    defaultContourStrength: 0.34,
    bandAlphaBase: 0.62,
    contourAlphaBase: 0.14,
    contourLineWidthBase: 0.30,
    contourLineWidthScale: 0.35,
    skipAlternateContourDepths: true,
  }),
  bathymetry_contours: Object.freeze({
    defaultOpacity: 0.56,
    defaultScale: 1.02,
    defaultContourStrength: 0.86,
    bandAlphaBase: 0.18,
    contourAlphaBase: 0.46,
    contourLineWidthBase: 0.95,
    contourLineWidthScale: 1.25,
    skipAlternateContourDepths: false,
  }),
});
const RENDER_PHASE_IDLE = "idle";
const RENDER_PHASE_INTERACTING = "interacting";
const RENDER_PHASE_SETTLING = "settling";
// renderPhase 只区分“正在连续输入”“输入刚停、等待 quiet window”“完全 idle”三段。
// exact-after-settle 和 deferred exact refresh 都依赖这组状态切换，后续若调整窗口值，
// 要把这三段时序一起看，不能只改单个 timeout。
const RENDER_SETTLE_DURATION_MS = 200;
const RENDER_SETTLE_DURATION_MS_MIN = 120;
const EXACT_AFTER_SETTLE_QUIET_WINDOW_MS = 420;
const EXACT_AFTER_SETTLE_QUIET_WINDOW_MS_MIN = 180;
const DEFERRED_EXACT_CONTEXT_REFRESH_DELAY_MS = 3600;
const CONTINUITY_FRAME_MAX_STALE_AGE_MS = 1500;
const ZOOM_SETTLE_ADAPTIVE_DELTA_MIN = 0.06;
const ZOOM_SETTLE_ADAPTIVE_DELTA_MAX = 0.85;
const CONTOUR_ZOOM_STYLE_PROFILES = Object.freeze({
  low: Object.freeze({
    majorIntervalMultiplier: 3,
    majorOpacityMultiplier: 0.42,
    majorWidthMultiplier: 0.78,
    majorMinScreenSpanPx: 22,
    minorVisible: false,
    minorOpacityMultiplier: 0,
    minorWidthMultiplier: 0,
    minorIntervalMultiplier: 3,
    minorMinScreenSpanPx: 22,
    minorMaxFeaturesBase: 0,
    minorMaxFeaturesPerMajor: 0,
    minorMaxFeaturesHardCap: 0,
  }),
  mid: Object.freeze({
    majorIntervalMultiplier: 2,
    majorOpacityMultiplier: 0.72,
    majorWidthMultiplier: 0.88,
    majorMinScreenSpanPx: 12,
    minorVisible: true,
    minorOpacityMultiplier: 0.55,
    minorWidthMultiplier: 0.82,
    minorIntervalMultiplier: 2,
    minorMinScreenSpanPx: 18,
    minorMaxFeaturesBase: 900,
    minorMaxFeaturesPerMajor: 1.8,
    minorMaxFeaturesHardCap: 3000,
  }),
  high: Object.freeze({
    majorIntervalMultiplier: 1,
    majorOpacityMultiplier: 1,
    majorWidthMultiplier: 1,
    majorMinScreenSpanPx: 0,
    minorVisible: true,
    minorOpacityMultiplier: 1,
    minorWidthMultiplier: 1,
    minorIntervalMultiplier: 1,
    minorMinScreenSpanPx: 8,
    minorMaxFeaturesBase: 1800,
    minorMaxFeaturesPerMajor: 2.8,
    minorMaxFeaturesHardCap: 6400,
  }),
});
const INTERNAL_BORDER_PROVINCE_MIN_ALPHA = 0.30;
const INTERNAL_BORDER_LOCAL_MIN_ALPHA = 0.22;
const INTERNAL_BORDER_PROVINCE_MIN_WIDTH = 0.52;
const INTERNAL_BORDER_LOCAL_MIN_WIDTH = 0.36;
const INTERNAL_BORDER_LOCAL_ALPHA_SCALE = 0.60;
const INTERNAL_BORDER_LOCAL_WIDTH_SCALE = 0.75;
const INTERNAL_BORDER_AUTO_DARK = "#ffffff";
const INTERNAL_BORDER_AUTO_LIGHT = "#111827";
const CONTOUR_HOST_FILL_FALLBACK_RADIUS = 24;
const DETAIL_ADM_BORDER_COLOR = "#888888";
const DETAIL_ADM_BORDER_MIN_ALPHA = 0.24;
const DETAIL_ADM_BORDER_MAX_ALPHA = 0.34;
const DETAIL_ADM_BORDER_MIN_WIDTH = 0.30;
const DETAIL_ADM_BORDER_TARGET_MIN_ALPHA = 0.12;
const DETAIL_ADM_BORDER_TARGET_MAX_ALPHA = 0.18;
const DETAIL_ADM_BORDER_ALPHA_SCALE = 0.70;
const DETAIL_ADM_BORDER_WIDTH_SCALE = 0.70;
const LOCAL_BORDERS_MIN_ZOOM = 2.0;
const DETAIL_ADM_BORDERS_MIN_ZOOM = 2.4;
const PROVINCE_BORDERS_FADE_START_ZOOM = 1.1;
const PROVINCE_BORDERS_TRANSITION_END_ZOOM = 2.0;
const PROVINCE_BORDERS_FAR_ALPHA = 0.10;
const PROVINCE_BORDERS_TRANSITION_ALPHA = 0.38;
const PROVINCE_BORDERS_FAR_WIDTH_MAX_ZOOM = 1.5;
const PROVINCE_BORDERS_FAR_WIDTH_SCALE = 0.75;
const PROVINCE_BORDERS_NEAR_ZOOM_START = 2.2;
const PROVINCE_BORDERS_NEAR_ALPHA_SCALE = 0.86;
const PROVINCE_BORDERS_NEAR_WIDTH_SCALE = 0.90;
const PARENT_BORDER_MIN_COVERAGE = 0.70;
const PARENT_BORDER_MAX_DOMINANT_SHARE = 0.90;
const PARENT_BORDER_MIN_RENDERABLE_GROUPS = 2;
const GB_PARENT_MIN_GROUPS = 20;
const GB_NUTS1_GROUP_MIN = 10;
const GB_NUTS1_PREFIX_LENGTH = 3;
const GB_ID_PATTERN_RE = /^[A-Z]{2}[A-Z0-9]{3}$/;
const DE_STATE_GROUP_MIN = 12;
const DE_STATE_GROUP_MAX = 20;
const DE_CITY_STATES = new Set(["Berlin", "Hamburg", "Bremen"]);
const BOUNDARY_DEFAULT_LINE_JOIN = "round";
const BOUNDARY_DEFAULT_LINE_CAP = "round";
const BOUNDARY_DEFAULT_MITER_LIMIT = 2.4;
const OCEAN_MASK_MODE_TOPOLOGY = "topology_ocean";
const OCEAN_MASK_MODE_SPHERE_MINUS_LAND = "sphere_minus_land";
const OCEAN_MASK_MODE_BATHYMETRY = "bathymetry_features";
const OCEAN_MASK_MIN_QUALITY = 0.35;
const GLOBAL_BATHYMETRY_TOPOLOGY_URL = resolveDataAssetUrl("bathymetry:global_topology");
const BATHYMETRY_BANDS_OBJECT_NAME = "bathymetry_bands";
const BATHYMETRY_CONTOURS_OBJECT_NAME = "bathymetry_contours";
const BATHYMETRY_MAX_REFERENCE_DEPTH_M = 6000;
const CONTEXT_LAYER_MIN_SCORE = 0.08;
const CONTEXT_BREAKDOWN_METRIC_NAMES = new Set([
  "drawPhysicalReliefOverlayLayer",
  "drawPhysicalAtlasLayer",
  "drawPhysicalContourLayer",
  "drawCityPointsLayer",
  "drawStrategicResourceMarkersLayer",
  "drawAirportsLayer",
  "drawPortsLayer",
  "drawRoadsLayer",
  "drawRailwaysLayer",
  "drawUrbanLayer",
  "drawRiversLayer",
  "drawScenarioRegionOverlaysPass",
  "drawScenarioWaterFillLayer",
  "drawScenarioAtlantropaLandLikeOverlayLayer",
  "drawScenarioSpecialRegionOverlaysLayer",
  "drawScenarioReliefOverlaysLayer",
  "contextScenarioLayerWater",
  "contextScenarioLayerSpecial",
  "contextScenarioLayerRelief",
  "contextScenarioLayerCacheHit",
  "contextScenarioLayerCacheMiss",
]);
const LAYER_DIAG_PREFIX = "[layer-resolver]";
const DEFAULT_SPECIAL_ZONE_TYPE = "custom";

const DEFAULT_MILSTD_SIDC = "130310001412110000000000000000";
const STRATEGIC_LINE_LABEL_FONT = "\"IBM Plex Sans\", \"Segoe UI\", sans-serif";
const STRATEGIC_RESOURCE_MARKER_COLORS = Object.freeze({
  steel: "#64748b",
  oil: "#111827",
  aluminium: "#94a3b8",
  rubber: "#166534",
  tungsten: "#92400e",
  chromium: "#7c3aed",
  coal: "#3f3f46",
});
const STRATEGIC_RESOURCE_MARKER_STROKE = "#f8fafc";
const STRATEGIC_COUNTER_ATTACHMENT_KIND = "operational-line";
const milsymbolSvgUriCache = new Map();
const DEFAULT_OPERATION_GRAPHIC_OPACITY = 0.96;
const DEFAULT_OPERATION_GRAPHIC_WIDTH = 4.4;
const DEFAULT_UNIT_COUNTER_SIDC = "130310001412110000000000000000";

const UNIT_COUNTER_SIDC_ALIASES = Object.freeze({
  INF: DEFAULT_UNIT_COUNTER_SIDC,
  ARMORED: "130310001712110000000000000000",
  ARM: "130310001712110000000000000000",
  HQ: "100310001712110000000000000000",
  ART: "130320000000000000000000000000",
});
const PAPER_TEXTURE_BASE_TILE_SIZE = 512;
const TEXTURE_LABEL_SERIF_STACK = "\"Libre Baskerville\", \"Palatino Linotype\", Georgia, serif";
const CITY_MARKER_THEME_GRAPHITE = "classic_graphite";
const CITY_REVEAL_PROFILE_HYBRID = "hybrid_country_budget";
const CITY_LABEL_DARK_BACKGROUND_LUMINANCE = 0.34;
const CITY_MARKER_THEME_TOKENS = {
  classic_graphite: {
    fillTop: "rgba(82, 91, 103, 0.99)",
    fillMid: "rgba(48, 56, 68, 0.99)",
    fillBottom: "rgba(24, 30, 39, 0.99)",
    rimDark: "rgba(5, 9, 15, 0.58)",
    stroke: "rgba(245, 188, 86, 0.72)",
    highlight: "rgba(246, 249, 252, 0.2)",
    specular: "rgba(242, 246, 252, 0.14)",
    baseShadow: "rgba(4, 8, 13, 0.32)",
    capitalAccent: "rgba(240, 184, 79, 0.98)",
    capitalHighlight: "rgba(255, 237, 186, 0.5)",
    label: "rgba(37, 40, 45, 0.96)",
    capitalLabel: "rgba(95, 68, 30, 0.98)",
    halo: "rgba(255, 242, 197, 0.12)",
    shadow: "rgba(7, 11, 17, 0.22)",
  },
  atlas_ink: {
    fillTop: "rgba(96, 230, 244, 0.99)",
    fillMid: "rgba(0, 142, 168, 0.99)",
    fillBottom: "rgba(0, 74, 92, 0.99)",
    rimDark: "rgba(0, 37, 50, 0.6)",
    stroke: "rgba(221, 251, 255, 0.72)",
    highlight: "rgba(241, 255, 255, 0.34)",
    specular: "rgba(229, 254, 255, 0.24)",
    baseShadow: "rgba(0, 31, 43, 0.3)",
    capitalAccent: "rgba(255, 209, 102, 0.98)",
    capitalHighlight: "rgba(255, 244, 196, 0.52)",
    label: "rgba(0, 69, 82, 0.96)",
    capitalLabel: "rgba(101, 72, 22, 0.98)",
    halo: "rgba(211, 250, 255, 0.15)",
    shadow: "rgba(0, 35, 50, 0.22)",
  },
  parchment_sepia: {
    fillTop: "rgba(211, 104, 82, 0.99)",
    fillMid: "rgba(155, 63, 47, 0.99)",
    fillBottom: "rgba(92, 37, 31, 0.99)",
    rimDark: "rgba(52, 20, 18, 0.56)",
    stroke: "rgba(255, 210, 168, 0.64)",
    highlight: "rgba(255, 230, 210, 0.28)",
    specular: "rgba(255, 221, 194, 0.2)",
    baseShadow: "rgba(48, 19, 17, 0.28)",
    capitalAccent: "rgba(230, 132, 58, 0.98)",
    capitalHighlight: "rgba(255, 211, 160, 0.5)",
    label: "rgba(90, 37, 31, 0.96)",
    capitalLabel: "rgba(118, 60, 22, 0.98)",
    halo: "rgba(255, 225, 198, 0.11)",
    shadow: "rgba(56, 22, 18, 0.2)",
  },
  slate_blue: {
    fillTop: "rgba(160, 130, 240, 0.99)",
    fillMid: "rgba(91, 66, 166, 0.99)",
    fillBottom: "rgba(49, 35, 105, 0.99)",
    rimDark: "rgba(25, 17, 69, 0.6)",
    stroke: "rgba(226, 210, 255, 0.72)",
    highlight: "rgba(249, 245, 255, 0.32)",
    specular: "rgba(236, 228, 255, 0.22)",
    baseShadow: "rgba(24, 18, 58, 0.3)",
    capitalAccent: "rgba(215, 183, 255, 0.98)",
    capitalHighlight: "rgba(246, 232, 255, 0.5)",
    label: "rgba(53, 40, 102, 0.96)",
    capitalLabel: "rgba(78, 53, 126, 0.98)",
    halo: "rgba(237, 229, 255, 0.14)",
    shadow: "rgba(28, 20, 66, 0.22)",
  },
  ivory_outline: {
    fillTop: "rgba(255, 252, 237, 0.99)",
    fillMid: "rgba(243, 234, 210, 0.99)",
    fillBottom: "rgba(199, 184, 146, 0.99)",
    rimDark: "rgba(18, 24, 34, 0.7)",
    stroke: "rgba(30, 41, 59, 0.78)",
    highlight: "rgba(255, 255, 255, 0.4)",
    specular: "rgba(255, 255, 255, 0.28)",
    baseShadow: "rgba(6, 10, 18, 0.3)",
    capitalAccent: "rgba(255, 159, 67, 0.98)",
    capitalHighlight: "rgba(255, 220, 177, 0.56)",
    label: "rgba(51, 45, 36, 0.98)",
    capitalLabel: "rgba(112, 63, 16, 0.98)",
    halo: "rgba(255, 249, 228, 0.18)",
    shadow: "rgba(8, 12, 20, 0.24)",
  },
};

const bathymetryTopologyCacheByUrl = new Map();
const bathymetryLoadPromiseByUrl = new Map();
const bathymetryLoadFailureByUrl = new Map();
const BATHYMETRY_LOAD_RETRY_COOLDOWN_MS = 10_000;
const CITY_LABEL_MAX_WIDTH_PX = {
  sparse: { capital: 212, major: 186, regional: 164, minor: 150 },
  balanced: { capital: 188, major: 166, regional: 148, minor: 134 },
  dense: { capital: 166, major: 148, regional: 132, minor: 120 },
};
const CITY_LABEL_PLACEMENT_ORDER = [
  "right",
  "left",
  "upper-right",
  "lower-right",
  "upper-left",
  "lower-left",
];
const CITY_ADMIN_LABEL_PATTERNS = [
  /\bcounty\b/giu,
  /\bdistrict\b/giu,
  /\boblast\b/giu,
  /\bokrug\b/giu,
  /\braion\b/giu,
  /\bmunicipality\b/giu,
  /\bgovernorate\b/giu,
  /городской округ/giu,
  /район/giu,
  /область/giu,
];
const CITY_ADMIN_LABEL_REJECT_PATTERNS = [
  /\bcounty\b/iu,
  /\bdistrict\b/iu,
  /\boblast\b/iu,
  /\bokrug\b/iu,
  /\braion\b/iu,
  /городской округ/iu,
  /район/iu,
  /область/iu,
];
const PAPER_TEXTURE_ASSET_URLS = {
  paper_vintage_01: new URL("../../vendor/textures/paper_vintage_01.svg", import.meta.url).href,
};
// Keep this list empty by default. Polygon winding issues are repaired dynamically.
const KNOWN_BAD_FEATURE_IDS = new Set();
const DEBUG_MODES = new Set(["PROD", "GEOMETRY", "ARTIFACTS", "ISLANDS", "ID_HASH"]);
const RENDER_DIAG_PARAM = "render_diag";
const PERF_OVERLAY_PARAM = "perf_overlay";
const POLITICAL_RECOVERY_QUALITY_PARAM = "political_recovery_quality";
const POLITICAL_RECOVERY_QUALITY_PROGRESSIVE = "progressive";
const POLITICAL_RECOVERY_QUALITY_EXACT = "exact";
const POLITICAL_PATH_CACHE_PRESERVING_INVALIDATION_REASONS = new Set([
  "refresh-colors",
  "progressive-political-full-cache-ready",
]);
// exact-after-settle 的延后刷新只补 context/text 这批轻量 pass；
// political pass 仍走单独的 guarded dirty 路径，避免和局部重绘缓存语义混线。
const POLITICAL_PARTIAL_REPAINT_FEATURE_THRESHOLD = 48;
const POLITICAL_PARTIAL_REPAINT_CANDIDATE_THRESHOLD = 160;
const POLITICAL_PARTIAL_REPAINT_VIEWPORT_COVERAGE_MAX = 0.18;
const POLITICAL_PARTIAL_REPAINT_SYNC_BUILD_CANDIDATE_MAX = 96;
const POLITICAL_PARTIAL_REPAINT_SYNC_BUILD_MISS_MAX = 96;
const POLITICAL_PARTIAL_REPAINT_PAD_PX = 4;
const POLITICAL_PATH_WARMUP_OVERSCAN_PX = 96;
const POLITICAL_PATH_WARMUP_QUEUE_MAX = 512;
const POLITICAL_PATH_WARMUP_MAX_FEATURES_PER_SLICE = 24;
const POLITICAL_PATH_WARMUP_CPU_BUDGET_MS = 4;
const POLITICAL_PATH_WARMUP_TIMEOUT_MS = 24;
const TARGET_GEOMETRY_DIAG_COUNTRIES = new Set(["GY", "SO"]);
const TARGET_GEOMETRY_DIAG_PREFIXES = ["RU_ARCTIC_FB_"];
const HEAVY_SCENARIO_STAGED_APPLY_FEATURE_THRESHOLD = 12000;
const STAGED_CONTEXT_BASE_TIMEOUT_MS = 180;
const STAGED_HIT_CANVAS_TIMEOUT_MS = 260;
const HIT_CANVAS_VIEWPORT_OVERSCAN_PX = 24;
const CHUNKED_INDEX_BUILD_SLICE_SIZE = 1200;
const CHUNKED_SPATIAL_BUILD_SLICE_SIZE = 900;
const HOVER_INTERACTION_METRIC_SAMPLE_RATE = 10;
const HOVER_INTERACTION_SLOW_SAMPLE_MS = 8;
let debugMode = "PROD";
let islandNeighborsCache = {
  topologyRef: null,
  objectRef: null,
  count: 0,
  neighbors: [],
};
const layerResolverCache = {
  primaryRef: null,
  detailRef: null,
  bundleMode: null,
  contextRevision: 0,
  waterRegionsDataToken: "",
};
const objectIdentityTokenCache = new WeakMap();
let nextObjectIdentityToken = 1;
let staticMeshCache = {
  primaryRef: null,
  detailRef: null,
  runtimeRef: null,
  bundleMode: "",
  activeScenarioId: "",
  scenarioBorderMode: "",
  scenarioOwnershipColorMode: "",
  sourceCountriesSignature: "",
  coastlineDecisionSignature: "",
  snapshot: null,
};
let countryDominantFillColorCache = {
  colorRevision: -1,
  scenarioOwnershipColorMode: "",
  activeScenarioId: "",
  result: new Map(),
};
let contourHostFillColorCache = new WeakMap();
let staticMeshSourceCountries = {
  primary: new Set(),
  detail: new Set(),
};
let physicalLandClipPathCache = {
  key: "",
  path: null,
};
const SCENARIO_COASTLINE_MAX_AREA_DELTA_RATIO = 0.02;
const SCENARIO_COASTLINE_MAX_INTERIOR_RING_RATIO = 0.25;
const SCENARIO_COASTLINE_MAX_INTERIOR_RING_COUNT = 500;
const scenarioOwnerOnlyCanonicalFallbackWarnings = new Set();
const missingPhysicalContextWarnings = new Set();
let scenarioWaterPartPathCache = new WeakMap();
let scenarioWaterFeaturePathCache = new WeakMap();
const renderDiag = {
  enabled: false,
  seenKeys: new Set(),
  skippedByReason: new Map(),
  skippedByCountry: new Map(),
  sampleByReason: new Map(),
  targetGeometryById: new Map(),
  politicalPass: null,
  transformedPasses: {},
  waterHit: null,
};
const rewoundFeatureLogKeys = new Set();
const urbanGeoCentroidCache = new WeakMap();
let cityAnchorCache = new WeakMap();
const urbanFeatureIndexCache = {
  sourceRef: null,
  byId: new Map(),
};
const cityLayerCache = {
  baseRef: null,
  scenarioRef: null,
  scenarioCountriesRef: null,
  scenarioId: "",
  cityLayerRevision: -1,
  scenarioOwnershipTagRevision: -1,
  sovereigntyRevision: -1,
  merged: null,
};
// --- owner 初始化区：集中持有 owner 单例引用，并在 getter 中按需延迟创建。 ---
let urbanCityPolicyOwner = null;
let cityLabelOwner = null;
let cityPointsRenderOwner = null;
let colorResolutionStrategyOwner = null;
let strategicOverlayHelpersOwner = null;
let strategicOverlayRuntimeOwner = null;
let politicalCollectionOwner = null;
let contextLayerResolverOwner = null;
let rendererAssetUrlPolicyOwner = null;
let facilitySurfaceOwner = null;
let riverLayerRenderOwner = null;
let oceanRenderOwner = null;
let physicalLayerRenderOwner = null;
let scenarioReliefOverlayRenderOwner = null;
let cityLightsRenderOwner = null;
const cityLightsAssetProvider = createCityLightsAssetProvider();
let dayNightRuntimeOwner = null;
let transportOverviewRenderOwner = null;
let strategicOverlayRenderOwner = null;
let borderMeshOwner = null;
let specialZoneLayersRenderOwner = null;
let borderDrawOwner = null;
let interactionBorderSnapshotOwner = null;
let spatialIndexRuntimeOwner = null;
let renderPipelinePassesOwner = null;
let visualEffectsPassOwner = null;
let contextPassOrchestratorOwner = null;
let politicalPassOrchestratorOwner = null;
let politicalBackgroundRenderOwner = null;
let politicalPartialRepaintOwner = null;
let renderCacheOwner = null;
let cachedPassCompositorOwner = null;
let transformedFrameCompositorOwner = null;
let renderPerfMetricsRuntimeOwner = null;
const renderPerfMetricsMirrorRuntime = { snapshot: null };
let renderPassCacheHostOwner = null;
let renderPassCommitAccountingOwner = null;
let drawCanvasOrchestrationOwner = null;
let renderTransformReusePolicyOwner = null;
let projectedGeometryBoundsOwner = null;
let viewportReadModelOwner = null;
const renderSnapshotOwner = createRenderSnapshotOwner();
let viewportCommandOwner = null;
let rendererViewportUpdateOwner = null;
let rendererStartupTransactionOwner = null;
let viewportResizeLifecycleOwner = null;
let scenarioWaterCachePolicyOwner = null;
let zoomInteractionLifecycleOwner = null;
let mapInteractionEventBindingOwner = null;
let clickSelectionTransactionOwner = null;
let mapHoverInteractionOwner = null;
let rendererTransactionResetOwner = null;
let rendererSurfaceLifecycleOwner = null;
let rendererProjectionPathOwner = null;
let rendererSvgSurfaceLifecycleOwner = null;
let rendererFitProjectionOwner = null;
let setMapDataTransactionOwner = null;
let renderRequestBoundaryOwner = null;
let renderPhaseLifecycleOwner = null;
let hitCanvasSchedulingOwner = null;
let visibleFrameDiagnosticsOwner = null;
let intensityFieldMaskOwner = null;
let hgoRuntimePreviewRenderOwner = null;
let legendControlOwner = null;
let selectionOverlayOwner = null;
let transientOverlayRenderOwner = null;

// --- owner 初始化区：getXxxOwner() 统一承载组装入口与依赖注入。 ---
function markDevSelectionOverlayClean() {
  runtimeState.devSelectionOverlayDirty = false;
}

function markInspectorOverlayClean() {
  runtimeState.inspectorOverlayDirty = false;
}

function getTransientOverlayRenderOwner() {
  if (transientOverlayRenderOwner) return transientOverlayRenderOwner;
  transientOverlayRenderOwner = createTransientOverlayRenderOwner({
    runtimeState,
    rendererSurfaceHost,
    ensureSpecialZoneEditorState,
    getSpecialZoneStyle,
    DEFAULT_SPECIAL_ZONE_TYPE,
    RENDER_PHASE_IDLE,
    isSpecialRegionEnabled,
    isWaterRegionEnabled,
    getFeatureId,
    getActiveFacilityHighlightEntry,
    buildFacilityEntryKey,
  });
  return transientOverlayRenderOwner;
}

function getSelectionOverlayOwner() {
  if (selectionOverlayOwner) return selectionOverlayOwner;
  selectionOverlayOwner = createSelectionOverlayOwner({
    getOverlayProjectionSignature,
    getTopologyRevision: () => Number(runtimeState.topologyRevision || 0),
    getDevSelectionIds: () => Array.isArray(runtimeState.devSelectionOrder)
      ? Array.from(runtimeState.devSelectionOrder, (id) => String(id || "").trim()).filter(Boolean) : [],
    getInspectorSelection: () => ({
      featureIds: Array.isArray(runtimeState.inspectorHighlightFeatureIds)
        ? Array.from(runtimeState.inspectorHighlightFeatureIds, (id) => String(id || "").trim()).filter(Boolean) : [],
      countryCode: String(runtimeState.inspectorHighlightCountryCode || ""),
      groupMode: runtimeState.inspectorHighlightGroupMode === true,
      label: String(runtimeState.inspectorHighlightLabel || ""),
    }),
    getLandFeatures: () => runtimeState.landData?.features || [],
    getLandIndex: () => runtimeState.landIndex,
    getRuntimeTopology: () => runtimeState.runtimePoliticalTopology,
    getTopojson: () => globalThis.topojson,
    getFeatureId,
    getEntityFeatureId,
    getFeatureCountryCodeNormalized,
    getDevGroup: () => rendererSurfaceHost.getDevSelectionGroup(),
    getInspectorGroup: () => rendererSurfaceHost.getInspectorHighlightGroup(),
    getPath: () => rendererSurfaceHost.getPathSvg(),
    isDevDirty: () => !!runtimeState.devSelectionOverlayDirty,
    isInspectorDirty: () => !!runtimeState.inspectorOverlayDirty,
    markDevClean: markDevSelectionOverlayClean,
    markInspectorClean: markInspectorOverlayClean,
  });
  return selectionOverlayOwner;
}

function getLegendControlOwner() {
  if (legendControlOwner) return legendControlOwner;
  legendControlOwner = createLegendControlOwner({
    getMapContainer: () => rendererSurfaceHost.getMapContainer(),
    getViewportSize: () => ({ width: Number(runtimeState.width), height: Number(runtimeState.height) }),
    getLanguage: () => String(runtimeState.currentLanguage || state.currentLanguage || ""),
    getLegendModel: (uniqueColors, labels) => ({
      colors: Array.isArray(uniqueColors) ? uniqueColors : LegendManager.getUniqueColors(state),
      specialZoneLegendLayers: LegendManager.getSpecialZoneLayers(runtimeState),
      labelMap: labels || LegendManager.getLabels(state),
      activeScenarioId: runtimeState.activeScenarioId,
      hasScenarioVisualEdits: !!runtimeState.activeScenarioId && (
        Object.keys(runtimeState.visualOverrides || {}).length > 0
        || Object.keys(runtimeState.featureOverrides || {}).length > 0
      ),
    }),
    getControlState: () => LegendManager.getControlState(state),
    getControlLimits: () => LegendManager.getControlLimits(),
    updateControlState: (patch) => LegendManager.updateControlState(state, patch),
    toggleControlCollapsed: () => LegendManager.toggleControlCollapsed(state),
    hideControl: () => LegendManager.hideControl(state),
    clamp,
  });
  return legendControlOwner;
}

function getRendererSurfaceLifecycleOwner() {
  if (rendererSurfaceLifecycleOwner) {
    return rendererSurfaceLifecycleOwner;
  }
  rendererSurfaceLifecycleOwner = createRendererSurfaceLifecycleOwner({
    surfaceHost: rendererSurfaceHost,
    getters: {
      getDocument: () => document,
    },
    helpers: {
      createHitCanvasElement,
    },
    canvasLayerManager: {
      CANVAS_LAYER_NAMES,
      ensureCanvasLayers,
      getCanvasLayer,
    },
  });
  return rendererSurfaceLifecycleOwner;
}

function getRendererProjectionPathOwner() {
  if (rendererProjectionPathOwner) {
    return rendererProjectionPathOwner;
  }
  rendererProjectionPathOwner = createRendererProjectionPathOwner({
    surfaceHost: rendererSurfaceHost,
    getters: {
      getD3: () => globalThis.d3,
    },
    constants: {
      projectionPrecision: PROJECTION_PRECISION,
      pathPointRadius: PATH_POINT_RADIUS,
    },
  });
  return rendererProjectionPathOwner;
}

function getRendererSvgSurfaceLifecycleOwner() {
  if (rendererSvgSurfaceLifecycleOwner) {
    return rendererSvgSurfaceLifecycleOwner;
  }
  rendererSvgSurfaceLifecycleOwner = createRendererSvgSurfaceLifecycleOwner({
    surfaceHost: rendererSurfaceHost,
    getters: {
      getD3: () => globalThis.d3,
    },
    helpers: {
      createSvgElement,
    },
  });
  return rendererSvgSurfaceLifecycleOwner;
}

function getRendererFitProjectionOwner() {
  if (rendererFitProjectionOwner) {
    return rendererFitProjectionOwner;
  }
  rendererFitProjectionOwner = createRendererFitProjectionOwner({
    surfaceHost: rendererSurfaceHost,
    state: runtimeState,
    constants: {
      projectionFitPaddingRatio: PROJECTION_FIT_PADDING_RATIO,
    },
    getters: {
      getLogicalCanvasDimensions,
      getRenderableLandFeatures,
    },
    effects: {
      resetCityAnchorCache: () => {
        cityAnchorCache = new WeakMap();
      },
      rebuildProjectedBoundsCache,
      buildSpatialIndex,
      setHitCanvasDirty: () => {
        setHitCanvasDirtyState(runtimeState, true);
      },
      updateSpecialZonesPaths,
      renderSpecialZoneEditorOverlay,
      updateZoomTranslateExtent,
      markAllOverlaysDirty,
    },
  });
  return rendererFitProjectionOwner;
}

function getRendererStartupTransactionOwner() {
  if (rendererStartupTransactionOwner) {
    return rendererStartupTransactionOwner;
  }
  rendererStartupTransactionOwner = createRendererStartupTransactionOwner({
    state,
    getters: {
      isPerfOverlayEnabled,
    },
    effects: {
      resetLayerResolverCache: () => {
        layerResolverCache.primaryRef = null;
        layerResolverCache.detailRef = null;
        layerResolverCache.bundleMode = null;
        layerResolverCache.contextRevision = 0;
      },
      resetPhysicalLandClipPathCache,
      resetExactRefreshOptimizationState,
      bumpTopologyRevision: () => {
        runtimeState.topologyRevision = Number(runtimeState.topologyRevision || 0) + 1;
      },
      resetHitCanvasTopologyRevision: () => {
        runtimeState.hitCanvasTopologyRevision = 0;
      },
      clearPendingPoliticalColorEdit,
      clearRenderPassReferenceTransforms,
      clearLastGoodFrame,
      invalidateInteractionComposite,
      resetFirstVisibleFramePainted,
      setRenderPassPerfOverlayEnabled: (enabled) => {
        getRenderPassCacheState().perfOverlayEnabled = enabled;
      },
      ensureLayerDataFromTopology: () => {
        ensureLayerDataFromTopology();
      },
      rebuildPoliticalLandCollections: () => {
        rebuildPoliticalLandCollections();
      },
      applyRendererSurfaceBridgeState: () => {
        applyRendererSurfaceBridgeState(runtimeState, {
          mapCanvas: rendererSurfaceHost.getMapCanvas(),
          canvasLayers: rendererSurfaceHost.getCanvasLayers(),
          context: rendererSurfaceHost.getContext(),
          politicalPatchCanvas: rendererSurfaceHost.getPoliticalPatchCanvas(),
          politicalPatchContext: rendererSurfaceHost.getPoliticalPatchContext(),
          interactionOverlayCanvas: rendererSurfaceHost.getInteractionOverlayCanvas(),
          interactionOverlayContext: rendererSurfaceHost.getInteractionOverlayContext(),
        });
      },
      migrateLegacyColorState: () => {
        migrateLegacyColorState();
      },
      ensureSovereigntyState: () => {
        ensureSovereigntyState();
      },
      normalizeColorStateForRender: () => {
        normalizeColorStateForRender(state, {
          sanitizeColorMap,
          sanitizeCountryColorMap,
        });
      },
      setDebugMode: (nextDebugMode) => {
        runtimeState.debugMode = nextDebugMode;
      },
      resetRenderDiagnostics,
      clearRenderPhaseTimer,
      resetRenderPhaseState: () => getRenderPhaseLifecycleOwner().resetRenderPhaseState("init-map"),
      resetTooltipState: () => getMapHoverInteractionOwner().resetTooltipState(),
      cancelScheduledHoverOverlayRender,
      markAllOverlaysDirty,
      clearStagedMapDataTasks,
      cancelExactAfterSettleRefresh,
      cancelPendingIndexUiRefresh,
      resetDeferredRenderFlags: () => {
        runtimeState.deferContextBasePass = false;
        runtimeState.deferHitCanvasBuild = false;
        setDeferExactAfterSettleState(runtimeState, false);
        runtimeState.hitCanvasBuildScheduled = null;
      },
      resetProjectedBoundsCacheState,
      invalidateAllRenderPasses,
      syncDayNightClockTimerBridge: () => {
        runtimeState.syncDayNightClockTimerFn = syncDayNightClockTimer;
        syncDayNightClockTimer();
      },
    },
  });
  return rendererStartupTransactionOwner;
}

function getSetMapDataTransactionOwner() {
  if (setMapDataTransactionOwner) {
    return setMapDataTransactionOwner;
  }
  setMapDataTransactionOwner = createSetMapDataTransactionOwner({
    state,
    getters: {
      nowMs,
      getActiveScenarioId: () => runtimeState.activeScenarioId,
      getLandFeatureCount: () => Array.isArray(runtimeState.landData?.features)
        ? runtimeState.landData.features.length
        : 0,
      getRenderProfile: () => runtimeState.renderProfile,
    },
    effects: {
      resetRendererTransactionState,
      clearPendingPoliticalColorEdit,
      clearRenderPassReferenceTransforms,
      clearLastGoodFrame,
      invalidateInteractionComposite,
      resetFirstVisibleFramePainted,
      invalidateAllRenderPasses,
      markAllOverlaysDirty,
      queueTooltipUpdate,
      rebuildPrimaryPoliticalCollections,
      recordCompositeCoverageDiagnostics: ({
        fullCollection,
        interactiveCollection,
      } = {}) => {
        if (runtimeState.topologyBundleMode === "composite" && Array.isArray(fullCollection?.features)) {
          const coverage = runtimeState.debugCountryCoverage || collectCountryCoverageStats(fullCollection.features);
          const interactiveFeatureCount = Array.isArray(interactiveCollection?.features)
            ? interactiveCollection.features.length
            : 0;
          console.info(
            `[map_renderer] Composite coverage: countries detail=${coverage.detailCountries}, primaryFallback=${coverage.primaryCountries}, total=${coverage.totalCountries}; features detail=${coverage.detailFeatures}, primary=${coverage.primaryFeatures}, total=${coverage.totalFeatures}.`
            + ` interactive=${interactiveFeatureCount}.`
          );
          console.info("[map_renderer] Composite country coverage detail/primary", {
            summary: {
              totalCountries: coverage.totalCountries,
              detailCountries: coverage.detailCountries,
              primaryCountries: coverage.primaryCountries,
              totalFeatures: coverage.totalFeatures,
              detailFeatures: coverage.detailFeatures,
              primaryFeatures: coverage.primaryFeatures,
            },
            priorityCountryGaps: coverage.priorityCountryGaps,
            detailCountries: coverage.detailCountryList,
            primaryCountries: coverage.primaryCountryList,
          });
        }
      },
      sanitizeSetMapDataColorState: () => {
        runtimeState.countryBaseColors = sanitizeCountryColorMap(runtimeState.countryBaseColors);
        runtimeState.featureOverrides = sanitizeColorMap(runtimeState.featureOverrides);
        runtimeState.waterRegionOverrides = sanitizeColorMap(runtimeState.waterRegionOverrides);
        runtimeState.specialRegionOverrides = {};
      },
      migrateLegacyColorState,
      setCanvasSize,
      buildRuntimePoliticalMeta,
      resetSovereigntyInitialized: () => {
        runtimeState.sovereigntyInitialized = false;
      },
      resetIslandNeighborsCache: () => {
        islandNeighborsCache = {
          topologyRef: null,
          objectRef: null,
          count: 0,
          neighbors: [],
        };
      },
      clearSphericalFeatureDiagnosticsCache: () => {
        ensureProjectedBoundsCache();
        clearSphericalFeatureDiagnosticsCacheState(runtimeState);
      },
      buildIndex,
      ensureSovereigntyState,
      setDeferHitCanvasBuild: (deferred) => {
        runtimeState.deferHitCanvasBuild = Boolean(deferred);
      },
      setInteractionInfrastructureState,
      rebuildProjectedBoundsCache,
      rebuildStaticMeshes,
      invalidateBorderCache,
      updateDynamicBorderStatusUI,
      rebuildResolvedColors,
      fitProjection,
      buildSpatialIndex,
      updateSpecialZonesPaths,
      renderSpecialZoneEditorOverlay,
      updateZoomTranslateExtent,
      resetZoomToFit,
      enforceZoomConstraints,
      setHitCanvasDirty: (dirty) => {
        setHitCanvasDirtyState(runtimeState, dirty);
      },
      beginStagedMapDataWarmup,
      render,
      recordRenderPerfMetric,
    },
  });
  return setMapDataTransactionOwner;
}

function getRenderRequestBoundaryOwner() {
  if (renderRequestBoundaryOwner) {
    return renderRequestBoundaryOwner;
  }
  renderRequestBoundaryOwner = createRenderRequestBoundaryOwner({
    effects: {
      requestRender,
      flushRenderBoundary,
      render,
    },
    getters: {
      hasInteractionRenderContext: () => Boolean(rendererSurfaceHost.getContext()),
    },
  });
  return renderRequestBoundaryOwner;
}

function getRenderPhaseLifecycleOwner() {
  if (renderPhaseLifecycleOwner) {
    return renderPhaseLifecycleOwner;
  }
  renderPhaseLifecycleOwner = createRenderPhaseLifecycleOwner({
    state: {
      renderPhaseIdle: RENDER_PHASE_IDLE,
      renderPhaseInteracting: RENDER_PHASE_INTERACTING,
    },
    getters: {
      getRenderPhase: () => runtimeState.renderPhase,
      getRenderPhaseTimerId: () => runtimeState.renderPhaseTimerId,
      nowMs,
      getAdaptiveSettleProfile,
      hasPendingDayNightRefresh: () => Boolean(runtimeState.pendingDayNightRefresh),
      shouldStartExactAfterSettleFastPath,
    },
    effects: {
      clearTimeout: (timerId) => globalThis.clearTimeout(timerId),
      setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
      setRenderPhaseTimerId: (timerId) => {
        setRenderPhaseTimerIdState(runtimeState, timerId);
      },
      setRenderPhaseValue: (phase) => {
        setRenderPhaseValueState(runtimeState, phase);
      },
      setPhaseEnteredAt: (enteredAtMs) => {
        setPhaseEnteredAtState(runtimeState, enteredAtMs);
      },
      setIsInteracting: (isInteracting) => {
        setRendererIsInteractingState(runtimeState, isInteracting);
      },
      cancelPoliticalPathWarmup,
      setHoverOverlayDirty: (dirty) => {
        getMapHoverInteractionOwner().setHoverOverlayDirty(Boolean(dirty));
      },
      setPendingDayNightRefresh: (pending) => {
        setPendingDayNightRefreshState(runtimeState, pending);
      },
      invalidateRenderPasses,
      updateDprStage,
      setCanvasSize,
      setAdaptiveSettleProfile: (settleProfile) => {
        setAdaptiveSettleProfileState(runtimeState, settleProfile);
      },
      scheduleScenarioChunkRefresh: (options) => (
        typeof runtimeState.scheduleScenarioChunkRefreshFn === "function"
          ? runtimeState.scheduleScenarioChunkRefreshFn(options)
          : "noop"
      ),
      setDeferExactAfterSettle: (deferred) => {
        setDeferExactAfterSettleState(runtimeState, deferred);
      },
      render,
      scheduleExactAfterSettleRefresh,
    },
  });
  return renderPhaseLifecycleOwner;
}

function getHitCanvasSchedulingOwner() {
  if (hitCanvasSchedulingOwner) {
    return hitCanvasSchedulingOwner;
  }
  hitCanvasSchedulingOwner = createHitCanvasSchedulingOwner({
    state: {
      renderPhaseIdle: RENDER_PHASE_IDLE,
      idleTimeoutMs: STAGED_HIT_CANVAS_TIMEOUT_MS,
    },
    getters: {
      hasHitCanvasRuntime: () => Boolean(rendererSurfaceHost.getHitContext() && rendererSurfaceHost.getPathHitCanvas()),
      isHitCanvasDirty: () => Boolean(runtimeState.hitCanvasDirty),
      isHitCanvasBuildDeferred: () => Boolean(runtimeState.deferHitCanvasBuild),
      getRenderPhase: () => runtimeState.renderPhase,
      getScheduledHitCanvasBuildHandle: () => runtimeState.hitCanvasBuildScheduled,
      getActiveScenarioId: () => runtimeState.activeScenarioId,
    },
    effects: {
      scheduleDeferredWork,
      cancelDeferredWork,
      setScheduledHitCanvasBuildHandle: (handle) => {
        setHitCanvasBuildScheduledState(runtimeState, handle);
      },
      runScheduledHitCanvasBuild: (details) => drawScheduledHitCanvasWithMetric(details),
    },
  });
  return hitCanvasSchedulingOwner;
}

function getRendererTransactionResetOwner() {
  if (rendererTransactionResetOwner) {
    return rendererTransactionResetOwner;
  }
  rendererTransactionResetOwner = createRendererTransactionResetOwner({
    effects: {
      clearPendingDynamicBorderTimer,
      clearRenderPhaseTimer,
      cancelPendingIndexUiRefresh,
      cancelPendingSidebarRefresh,
      cancelScheduledHoverOverlayRender,
      setRenderPhaseIdle: () => setRenderPhase(RENDER_PHASE_IDLE),
      resetRenderDiagnostics,
      clearStagedMapDataTasks,
      cancelExactAfterSettleRefresh,
      cancelScheduledHitCanvasBuild: (options) => (
        getHitCanvasSchedulingOwner().cancelScheduledHitCanvasBuild(options)
      ),
      cancelSecondarySpatialBuild: () => {
        cancelDeferredWork(secondarySpatialBuildHandle);
        secondarySpatialBuildHandle = null;
        pendingSecondarySpatialBuildReasons.clear();
        return true;
      },
      setDeferContextBasePass: (deferred) => {
        runtimeState.deferContextBasePass = Boolean(deferred);
      },
      setDeferHitCanvasBuild: (deferred) => {
        runtimeState.deferHitCanvasBuild = Boolean(deferred);
      },
      setDeferExactAfterSettle: (deferred) => {
        setDeferExactAfterSettleState(runtimeState, deferred);
      },
      resetLayerResolverCache: () => {
        layerResolverCache.primaryRef = null;
        layerResolverCache.detailRef = null;
        layerResolverCache.bundleMode = null;
        layerResolverCache.contextRevision = 0;
      },
      resetDevInteractionState: () => {
        runtimeState.devHoverHit = null;
        runtimeState.devSelectedHit = null;
        runtimeState.devSelectionFeatureIds = new Set();
        runtimeState.devSelectionOrder = [];
      },
      resetDevClipboardState: () => {
        runtimeState.devClipboardFallbackText = "";
        runtimeState.devClipboardPreviewFormat = "names_with_ids";
      },
      resetPhysicalLandClipPathCache,
      resetExactRefreshOptimizationState,
      resetVisibleInternalBorderMeshSignature,
      bumpTopologyRevision: () => {
        runtimeState.topologyRevision = Number(runtimeState.topologyRevision || 0) + 1;
        return runtimeState.topologyRevision;
      },
      setHitCanvasDirty: (dirty) => {
        if (dirty) {
          setHitCanvasDirtyState(runtimeState, true);
        }
      },
      resetHitCanvasTopologyRevision: () => {
        runtimeState.hitCanvasTopologyRevision = 0;
      },
    },
  });
  return rendererTransactionResetOwner;
}

function getMapHoverInteractionOwner() {
  if (mapHoverInteractionOwner) return mapHoverInteractionOwner;
  mapHoverInteractionOwner = createMapHoverInteractionOwner({
    state: runtimeState,
    surfaceHost: rendererSurfaceHost,
    constants: { hoverSnapPx: HIT_SNAP_RADIUS_HOVER_PX, renderPhaseIdle: RENDER_PHASE_IDLE },
    getters: {
      nowMs,
      inspectHgoRuntimePreviewFromEvent,
      getHitFromEvent,
      getHoveredFacilityEntryFromEvent,
      isFacilityDetailsSurfaceActive,
      getHoveredCityTooltipEntry,
      getTooltipTextForFeature: getTooltipText,
      getFeatureForHit: (hit) => {
        const id = hit?.id;
        if (!id) return null;
        if (hit.targetType === "special") return runtimeState.specialRegionsById?.get(id) || null;
        if (hit.targetType === "water") return runtimeState.waterRegionsById?.get(id) || null;
        return runtimeState.landIndex?.get(id) || null;
      },
      getOverlayProjectionSignature,
      getSelectedFacilityEntry: () => selectedFacilityEntry,
      shouldBlockUnderlyingSelectionForFacility,
    },
    effects: {
      updateDevHoverHit,
      renderHoverOverlay,
      recordInteractionDurationMetric,
      hidePhysicalIntensityBrushPreview,
    },
    helpers: { getFacilityKey: buildFacilityEntryKey },
  });
  return mapHoverInteractionOwner;
}

function getVisibleFrameDiagnosticsOwner() {
  if (visibleFrameDiagnosticsOwner) {
    return visibleFrameDiagnosticsOwner;
  }
  visibleFrameDiagnosticsOwner = createVisibleFrameDiagnosticsOwner({
    effects: {
      incrementPerfCounter,
      recordVisibleFrameTransactionDiagnostics: (payload) => recordVisibleFrameTransactionDiagnostics(runtimeState, payload),
      recordRenderPerfMetric,
      setFirstVisibleFramePainted: (painted) => {
        setFirstVisibleFramePaintedState(runtimeState, painted);
      },
      callFirstVisibleFramePaintedHook: (payload) => {
        callRuntimeHook(runtimeState, "noteFirstVisibleFramePaintedFn", payload);
      },
    },
    getters: {
      getRenderPassCacheState,
      getDefaultTransform: () => runtimeState.zoomTransform || globalThis.d3?.zoomIdentity,
      getCommittedFrameIdentity,
      getCommittedFrameKeySignature,
      getFrameStateSnapshot: () => ({
        activeScenarioId: runtimeState.activeScenarioId,
        sceneGeneration: runtimeState.sceneGeneration,
        scenarioDataGeneration: runtimeState.scenarioDataGeneration,
        topologyRevision: runtimeState.topologyRevision,
        colorRevision: runtimeState.colorRevision,
        selectionVersion: runtimeState.selectionVersion,
        renderPhase: runtimeState.renderPhase,
        topologyBundleMode: runtimeState.topologyBundleMode,
      }),
      getFirstVisiblePoliticalFrameBlockReason,
      getOceanBaseFillColor,
      hasFirstVisibleFramePainted: () => Boolean(runtimeState.firstVisibleFramePainted),
    },
  });
  return visibleFrameDiagnosticsOwner;
}

function getStrategicOverlayHelpersOwner() {
  if (strategicOverlayHelpersOwner) {
    return strategicOverlayHelpersOwner;
  }
  strategicOverlayHelpersOwner = createStrategicOverlayHelpersOwner({
    state,
    constants: {
      defaultUnitCounterBaseFill: DEFAULT_UNIT_COUNTER_BASE_FILL,
      strategicLineLabelFont: STRATEGIC_LINE_LABEL_FONT,
    },
    groupGetters: {
      getOperationalLinesGroup: () => rendererSurfaceHost.getOperationalLinesGroup(),
      getOperationGraphicsGroup: () => rendererSurfaceHost.getOperationGraphicsGroup(),
      getUnitCountersGroup: () => rendererSurfaceHost.getUnitCountersGroup(),
      getSpecialZonesGroup: () => rendererSurfaceHost.getSpecialZonesGroup(),
      getSpecialZoneEditorGroup: () => rendererSurfaceHost.getSpecialZoneEditorGroup(),
    },
    helpers: {
      renderStrategicDefs,
      ensureOperationalLineEditorState,
      getOperationalLinePreset,
      projectStrategicPoints,
      createOperationGraphicPath,
      getOperationGraphicLabelAnchor,
      selectOperationalLineById,
      getOperationGraphicPreset,
      selectOperationGraphicById,
      renderOperationGraphicsEditorOverlay,
      ensureUnitCounterEditorState,
      getProjectedPoint,
      getUnitCounterRenderEntries,
      getUnitCounterCardModel,
      getUnitCounterRenderScale,
      getUnitCounterSlotOffset,
      compareUnitCounterRenderOrder,
      getUnitCounterNodeTransform,
      getUnitCounterIconPath,
      updateSpecialZonesPaths,
      renderSpecialZoneEditorOverlay,
      getEffectiveSpecialZonesFeatureCollection,
    },
  });
  return strategicOverlayHelpersOwner;
}

function getStrategicOverlayRenderOwner() {
  if (strategicOverlayRenderOwner) {
    return strategicOverlayRenderOwner;
  }
  strategicOverlayRenderOwner = createStrategicOverlayRenderOwner({
    state,
    constants: {
      defaultUnitCounterRenderer: DEFAULT_UNIT_COUNTER_RENDERER,
      renderPhaseIdle: RENDER_PHASE_IDLE,
    },
    helpers: {
      getProjectionRenderSignature,
    },
    renderers: {
      renderFrontlineOverlay,
      renderOperationGraphicsOverlay: () => getStrategicOverlayHelpersOwner().renderOperationGraphicsOverlay(),
      renderOperationalLinesOverlay: () => getStrategicOverlayHelpersOwner().renderOperationalLinesOverlay(),
      renderSpecialZones: () => getStrategicOverlayHelpersOwner().renderSpecialZones(),
      renderUnitCountersOverlay,
      syncUnitCounterScalesDuringZoom: () => getStrategicOverlayHelpersOwner().syncUnitCounterScalesDuringZoom(),
    },
  });
  return strategicOverlayRenderOwner;
}

function getSpecialZoneLayersRenderOwner() {
  if (specialZoneLayersRenderOwner) {
    return specialZoneLayersRenderOwner;
  }
  specialZoneLayersRenderOwner = createSpecialZoneLayersRenderOwner({
    state,
    groupGetters: {
      getSpecialZonesGroup: () => rendererSurfaceHost.getSpecialZonesGroup(),
      getStrategicDefs: () => rendererSurfaceHost.getStrategicDefs(),
    },
    helpers: {
      clamp,
      getDashPattern,
      getFeatureId,
      getPathSVG: () => rendererSurfaceHost.getPathSvg(),
      getSafeCanvasColor,
    },
  });
  return specialZoneLayersRenderOwner;
}

function getUrbanCityPolicyOwner() {
  if (urbanCityPolicyOwner) {
    return urbanCityPolicyOwner;
  }
  urbanCityPolicyOwner = createUrbanCityPolicyOwner({
    state,
    caches: {
      cityLayerCache,
      urbanFeatureIndexCache,
    },
    helpers: {
      compareCityRevealEntries,
      defaultCityCountryClassRank: CITY_COUNTRY_CLASS_RANK.micro,
      defaultCityCountryTierRank: CITY_COUNTRY_TIER_RANK.D,
      getCityAnchor,
      getCityCanonicalId,
      getCityCapitalScore,
      getCityCountryGroupKey,
      getCityCountryProfileIndex,
      getCityEffectiveMinZoom,
      getCityFeatureAliases,
      getCityFeatureKey,
      getCityInterpolatedMarkerBudget,
      getCityInterpolatedMarkerQuota,
      getCityInterpolatedRevealBucket,
      getCityLabelBudget,
      getCityLabelMinZoom,
      getCityMarkerDensityMultiplier,
      getCityMarkerSizePx,
      getCityPriorityCountryReserveBudget,
      getCityPriorityCountryReserveRank,
      getCityRevealPhase,
      getCityScreenPoint,
      getCitySortWeight,
      getCityTier,
      getCityTierWeight,
      getCityViewportCenterDistanceNorm,
      getDefaultCityMinZoomForTier,
      getUrbanFeatureStableId,
      isCityAnchorInViewport,
      isCityLabelEligibleForPhase,
      isCityScenarioTagExcludedFromReveal,
    },
  });
  return urbanCityPolicyOwner;
}

function getCityLabelOwner() {
  if (cityLabelOwner) {
    return cityLabelOwner;
  }
  cityLabelOwner = createCityLabelOwner({
    constants: { textureLabelSerifStack: TEXTURE_LABEL_SERIF_STACK },
    getters: {
      getContext: () => rendererSurfaceHost.getContext(),
      getViewportSize: () => ({ width: runtimeState.width, height: runtimeState.height }),
    },
    helpers: {
      buildCityLabelPlacementCandidates,
      clamp,
      formatCityMapLabel,
      getCityDisplayLabel,
      getCityLabelMinZoom,
      getCityLabelRenderStyle,
      getCityMarkerSizePx,
      getCityVisualCapitalState,
    },
  });
  return cityLabelOwner;
}

function getCityPointsRenderOwner() {
  if (cityPointsRenderOwner) {
    return cityPointsRenderOwner;
  }
  cityPointsRenderOwner = createCityPointsRenderOwner({
    state: runtimeState,
    constants: {
      cityMarkerSizeLimitsPx: CITY_MARKER_SIZE_LIMITS_PX,
      cityMarkerThemeGraphite: CITY_MARKER_THEME_GRAPHITE,
      cityRevealProfileHybrid: CITY_REVEAL_PROFILE_HYBRID,
    },
    getters: {
      getContext: () => rendererSurfaceHost.getContext(),
      getMapSvg: () => rendererSurfaceHost.getMapSvg(),
      getProjection: () => rendererSurfaceHost.getProjection(),
    },
    helpers: {
      buildCityRevealPlan: (...args) => buildCityRevealPlan(...args),
      clamp,
      collectContextMetric,
      drawCityLabelsFromEntries: (...args) => getCityLabelOwner().drawCityLabelsFromEntries(...args),
      getCityMarkerRenderStyle,
      getCityMarkerSizePx,
      getCityTooltipText,
      getCityVisualCapitalState,
      getEffectiveCityCollection: (...args) => getEffectiveCityCollection(...args),
      getHoverEntryHitPriority: getFacilityEntryHitPriority,
      getPointer: (event, target) => (
        typeof globalThis.d3?.pointer === "function" ? globalThis.d3.pointer(event, target) : null
      ),
      getZoomIdentity: () => globalThis.d3?.zoomIdentity || { x: 0, y: 0, k: 1 },
      getFeatureCollectionFeatureCount,
      isCityEntryEligibleForLandHit,
      normalizeCityLayerStyleConfig,
      nowMs,
      recordInteractionDurationMetric,
      recordRenderPerfMetric,
    },
  });
  return cityPointsRenderOwner;
}

function getColorResolutionStrategyOwner() {
  if (colorResolutionStrategyOwner) {
    return colorResolutionStrategyOwner;
  }
  colorResolutionStrategyOwner = createColorResolutionStrategyOwner({
    state: runtimeState,
    helpers: {
      canonicalCountryCode,
      getFeatureCountryCodeNormalized,
      getFeatureId,
      getAtlantropaRuleColor,
      getOceanBaseFillColor,
      getSafeCanvasColor,
      isAntarcticSectorFeature,
      isAtlantropaSeaFeature,
      isScenarioShellFeature,
      normalizeMapSemanticMode,
    },
  });
  return colorResolutionStrategyOwner;
}

const getDisplayOwnerCode = (...args) => getColorResolutionStrategyOwner().getDisplayOwnerCode(...args);
const getResolvedFeatureColor = (...args) => getColorResolutionStrategyOwner().getResolvedFeatureColor(...args);

function getPoliticalCollectionOwner() {
  if (politicalCollectionOwner) {
    return politicalCollectionOwner;
  }
  politicalCollectionOwner = createPoliticalCollectionOwner({
    state,
    constants: {
      highFrequencyCountryDetailWhitelist: HIGH_FREQUENCY_COUNTRY_DETAIL_WHITELIST,
      interactiveAggregateTierFilters: INTERACTIVE_AGGREGATE_TIER_FILTERS,
      fragmentCamouflageRules,
    },
    helpers: {
      getDetailTier,
      getFeatureCountryCodeNormalized,
      getFeatureId,
      isPoliticalInteractionRenderableFeature,
      isRenderDiagEnabled: () => renderDiag.enabled,
    },
  });
  return politicalCollectionOwner;
}

function getContextLayerResolverOwner() {
  if (contextLayerResolverOwner) {
    return contextLayerResolverOwner;
  }
  contextLayerResolverOwner = createContextLayerResolverOwner({
    runtimeState: state,
    caches: {
      layerResolverCache,
    },
    constants: {
      contextLayerMinScore: CONTEXT_LAYER_MIN_SCORE,
      layerDiagPrefix: LAYER_DIAG_PREFIX,
      urbanCorruptBoundsHeightDeg: URBAN_CORRUPT_BOUNDS_HEIGHT_DEG,
      urbanCorruptBoundsWidthDeg: URBAN_CORRUPT_BOUNDS_WIDTH_DEG,
    },
    helpers: {
      clamp,
      ensureBathymetryDataAvailability,
      getContextLayerStableSourceToken,
      getUrbanFeatureOwnerId,
      getUrbanFeatureStableId,
      resetScenarioWaterCacheAdaptiveState,
    },
  });
  return contextLayerResolverOwner;
}

function getRendererAssetUrlPolicyOwner() {
  if (rendererAssetUrlPolicyOwner) {
    return rendererAssetUrlPolicyOwner;
  }
  rendererAssetUrlPolicyOwner = createRendererAssetUrlPolicyOwner({
    state,
    constants: {
      globalBathymetryTopologyUrl: GLOBAL_BATHYMETRY_TOPOLOGY_URL,
    },
  });
  return rendererAssetUrlPolicyOwner;
}

function getFacilitySurfaceOwner() {
  if (facilitySurfaceOwner) {
    return facilitySurfaceOwner;
  }
  facilitySurfaceOwner = createFacilitySurfaceOwner({
    helpers: {
      renderTooltipText,
      t,
    },
  });
  return facilitySurfaceOwner;
}

function getRiverLayerRenderOwner() {
  if (riverLayerRenderOwner) {
    return riverLayerRenderOwner;
  }
  riverLayerRenderOwner = createRiverLayerRenderOwner({
    state,
    helpers: {
      clamp,
      collectContextMetric,
      getContext: () => rendererSurfaceHost.getContext(),
      getContextBaseZoomBucketId,
      getDashPattern,
      getFeatureCollectionFeatureCount,
      getPathCanvas: () => rendererSurfaceHost.getPathCanvas(),
      getSafeCanvasColor,
      nowMs,
      pathBoundsInScreen,
    },
  });
  return riverLayerRenderOwner;
}

function getOceanRenderOwner() {
  if (oceanRenderOwner) {
    return oceanRenderOwner;
  }
  oceanRenderOwner = createOceanRenderOwner({
    state,
    constants: {
      COASTLINE_ACCENT_DENSITY_ALPHA_LOW,
      COASTLINE_ACCENT_DENSITY_ALPHA_MID,
      COASTLINE_ACCENT_DENSITY_THRESHOLD_LOW,
      COASTLINE_ACCENT_DENSITY_THRESHOLD_MID,
      COASTLINE_ACCENT_DENSITY_WIDTH_SCALE,
      COASTLINE_LOD_LOW_ZOOM_MAX,
      COASTLINE_LOD_MID_ZOOM_MAX,
      OCEAN_MASK_MODE_BATHYMETRY,
      OCEAN_MASK_MODE_TOPOLOGY,
      TNO_COASTAL_ACCENT_COLOR,
    },
    getters: {
      getContext: () => rendererSurfaceHost.getContext(),
      getPathCanvas: () => rendererSurfaceHost.getPathCanvas(),
    },
    helpers: {
      applyBathymetryCoverageExclusionMask,
      applyOceanClipMask,
      clamp,
      clipOutAtlantropaAccentRegions,
      doesOceanStyleRequireBathymetry,
      ensureBathymetryDataAvailability,
      getBathymetryBandFillStyle,
      getBathymetryBandVisibilityConfig,
      getBathymetryCollectionBySource,
      getBathymetryContourStrokeStyle,
      getBathymetryContourVisibilityConfig,
      getBathymetryFeatureCollections,
      getBathymetryFeatureDepthMax,
      getBathymetryPresetProfile,
      getCoastlineCollectionForZoom,
      getOceanStyleConfig,
      getProjectedLineDensityStats,
      getSafeCanvasColor,
      getScenarioCoastalAccentLineWidth,
      getScenarioCoastalAccentOverlayFeatures,
      getScenarioCoastalAccentOverlayVisualConfig,
      getViewportAwareCoastlineCollection: (collection, k) => (
        getBorderDrawOwner().getViewportAwareCoastlineCollection(collection, k)
      ),
      isScenarioCoastalAccentEnabled,
      isUsableMesh,
      pathBoundsInScreen,
      resolveCoastlineTopologySource,
      resolveOceanMask,
      sortBathymetryFeaturesForFill,
    },
  });
  return oceanRenderOwner;
}

function getPhysicalLayerRenderOwner() {
  if (physicalLayerRenderOwner) {
    return physicalLayerRenderOwner;
  }
  physicalLayerRenderOwner = createPhysicalLayerRenderOwner({
    state,
    constants: {
      PHYSICAL_ATLAS_PALETTE,
    },
    getters: {
      getContext: () => rendererSurfaceHost.getContext(),
      getPathCanvas: () => rendererSurfaceHost.getPathCanvas(),
      getProjection: () => rendererSurfaceHost.getProjection(),
    },
    helpers: {
      applyPhysicalLandClipMask,
      clamp,
      collectContextMetric,
      getAdaptiveContourStrokeColor,
      getAtlasFeatureAlphaMultiplier,
      getContourVisibleFeatures,
      getContourZoomStyleProfile,
      getFeatureCollectionFeatureCount,
      getFieldFeatureMultiplier,
      getPhysicalAtlasClass,
      getPhysicalAtlasLayer,
      getPhysicalLandMaskInfo,
      getPhysicalPresetRenderProfile,
      getPhysicalReliefOverlayBlendMode,
      getProjectedDegreeRadiusPx,
      getResolvedPhysicalAtlasCollection,
      getSafeBlendMode,
      getSafeCanvasColor,
      normalizeIntensityFieldsState,
      normalizePhysicalStyleConfig,
      nowMs,
      pathBoundsInScreen,
      shouldReportDeferredContextLayerGap,
      warnMissingPhysicalContextOnce,
    },
  });
  return physicalLayerRenderOwner;
}

function getScenarioReliefOverlayRenderOwner() {
  if (scenarioReliefOverlayRenderOwner) {
    return scenarioReliefOverlayRenderOwner;
  }
  scenarioReliefOverlayRenderOwner = createScenarioReliefOverlayRenderOwner({
    state,
    constants: {
      RELIEF_ATLANTROPA_CONTOUR_COLOR,
      RELIEF_ATLANTROPA_SALT_FILL_COLOR,
      RELIEF_ATLANTROPA_SALT_STROKE_COLOR,
      RELIEF_ATLANTROPA_SHORELINE_COLOR,
      RELIEF_CONTOUR_COLOR,
      RELIEF_DAM_APPROACH_COLOR,
      RELIEF_LAKE_SHORELINE_COLOR,
      RELIEF_SALT_FILL_COLOR,
      RELIEF_SALT_STROKE_COLOR,
      RELIEF_SHORELINE_COLOR,
      RELIEF_SWAMP_FILL_COLOR,
      RELIEF_SWAMP_STROKE_COLOR,
      RENDER_PHASE_INTERACTING,
      RENDER_PHASE_SETTLING,
    },
    getters: {
      getContext: () => rendererSurfaceHost.getContext(),
      getPathCanvas: () => rendererSurfaceHost.getPathCanvas(),
    },
    helpers: {
      collectContextMetric,
      getEffectiveScenarioReliefOverlayFeatures,
      getPathBounds,
      getReliefOverlayKind,
      getScenarioReliefVisualRevisionToken,
      isAtlantropaReliefOverlayFeature,
      isReliefOverlayEnabled,
      isScenarioCoastalAccentEnabled,
      nowMs,
      pathBoundsInScreen,
    },
  });
  return scenarioReliefOverlayRenderOwner;
}

function getCityLightsRenderOwner() {
  if (cityLightsRenderOwner) {
    return cityLightsRenderOwner;
  }
  cityLightsRenderOwner = createCityLightsRenderOwner({
    state,
    assets: cityLightsAssetProvider.getAssets(),
    assetProvider: cityLightsAssetProvider,
    getters: {
      getContext: () => rendererSurfaceHost.getContext(),
      getPathCanvas: () => rendererSurfaceHost.getPathCanvas(),
      getProjection: () => rendererSurfaceHost.getProjection(),
    },
    helpers: {
      buildNightHemisphereFeature,
      clamp,
      ColorManager,
      createCanvas: (canvasWidth, canvasHeight, targetContext) => {
        const ownerDocument = targetContext?.canvas?.ownerDocument || globalThis.document;
        const canvas = typeof ownerDocument?.createElement === "function"
          ? ownerDocument.createElement("canvas")
          : (typeof globalThis.OffscreenCanvas === "function" ? new globalThis.OffscreenCanvas(canvasWidth, canvasHeight) : null);
        return canvas;
      },
      estimateProjectedAreaPx,
      getCityAnchor,
      getCityCanonicalId,
      getCityCapitalScore,
      getCityGeoCoordinates,
      getCityScreenPoint,
      getDefaultZoomTransform: () => globalThis.d3?.zoomIdentity || { x: 0, y: 0, k: 1 },
      getEffectiveCityCollection,
      getFeatureGeoCentroid,
      getRenderPassLayout,
      getSafeBlendMode,
      getTransformSignature,
      getUrbanCityPolicyOwner,
      getUrbanGlowMultiplierAt,
      normalizeDayNightStyleConfig,
      normalizeIntensityFieldsState,
      normalizeLongitude,
      pathBoundsInScreen,
      prepareTargetContext,
      recordRenderPerfMetric,
      sampleIntensityField,
      stableJson,
      stringHash,
      withRenderTarget,
    },
    effects: {
      onModernAssetsReady: () => {
        cityLightsRenderOwner = null;
        invalidateRenderPasses("dayNight", "modern-city-lights-asset-ready");
        requestRendererRender("modern-city-lights-asset-ready");
      },
      onModernAssetsError: (error) => {
        console.error("[renderer] Failed to load the Modern City Lights asset.", error);
      },
    },
  });
  return cityLightsRenderOwner;
}

function getDayNightRuntimeOwner() {
  if (dayNightRuntimeOwner) {
    return dayNightRuntimeOwner;
  }
  dayNightRuntimeOwner = createDayNightRuntimeOwner({
    rendererSurfaceHost,
    getters: {
      getDayNightStyleConfigState: () => runtimeState.styleConfig?.dayNight,
      isBootInteractionReady,
      isRenderPhaseIdle: () => runtimeState.renderPhase === RENDER_PHASE_IDLE,
    },
    helpers: {
      clamp,
      normalizeDayNightStyleConfig,
      normalizeLongitude,
      nowMs,
      stableJson,
    },
    effects: {
      drawNightLightsLayer,
      invalidateRenderPasses,
      renderFallback: render,
      requestRender: requestRendererRender,
      setDayNightStyleConfig: (config) => setDayNightStyleConfigState(runtimeState, config),
      setPendingDayNightRefresh: (nextPending) => setPendingDayNightRefreshState(runtimeState, nextPending),
      updateToolbarInputs: refreshPhysicalIntensityUi,
    },
  });
  return dayNightRuntimeOwner;
}

function getTransportOverviewRenderOwner() {
  if (transportOverviewRenderOwner) {
    return transportOverviewRenderOwner;
  }
  transportOverviewRenderOwner = createTransportOverviewRenderOwner({
    state,
    helpers: {
      buildFacilityEntryKey,
      buildFacilityTooltipText,
      clamp,
      clearFacilityHoverEntries,
      collectContextMetric,
      getActiveFacilityHighlightEntry,
      getCanvasColorRelativeLuminance,
      getContext: () => rendererSurfaceHost.getContext(),
      getFacilityHoverRadiusPx,
      getFeatureCollectionFeatureCount,
      getLineMidpointFromCoordinates,
      getMultiLineLabelAnchor,
      getPathCanvas: () => rendererSurfaceHost.getPathCanvas(),
      getProjection: () => rendererSurfaceHost.getProjection(),
      invalidateRenderPasses,
      mixCanvasColors,
      nowMs,
      requestRender: (reason) => requestRendererRender(reason),
      setVisibleFacilityHoverEntries,
    },
  });
  return transportOverviewRenderOwner;
}

function getBorderMeshOwner() {
  if (borderMeshOwner) {
    return borderMeshOwner;
  }
  borderMeshOwner = createBorderMeshOwner({
    state,
    constants: {
      coastlineEffectiveAreaMultiplier: COASTLINE_EFFECTIVE_AREA_MULTIPLIER,
      scenarioCoastlineMaxAreaDeltaRatio: SCENARIO_COASTLINE_MAX_AREA_DELTA_RATIO,
      scenarioCoastlineMaxInteriorRingCount: SCENARIO_COASTLINE_MAX_INTERIOR_RING_COUNT,
      scenarioCoastlineMaxInteriorRingRatio: SCENARIO_COASTLINE_MAX_INTERIOR_RING_RATIO,
    },
    helpers: {
      asFeatureLike,
      canonicalCountryCode,
      renderDynamicBorders: () => {
        if (rendererSurfaceHost.getContext()) render();
      },
      getDetailAdmMeshBuildState: () => detailAdmMeshBuildState,
      setDetailAdmMeshBuildState: (nextState) => {
        detailAdmMeshBuildState = nextState;
      },
      scheduleDeferredHeavyBorderMeshes,
      syncStaticMeshSnapshot,
      ensureSovereigntyState,
      getAdmin1Group,
      getEntityCountryCode,
      getEntityBorderMeshCountryCode,
      getFeatureCountryCodeNormalized,
      getFeatureBorderMeshCountryCodeNormalized,
      getFeatureId,
      getLatitudeAdjustedSimplifyEpsilon,
      getLineLength,
      getParentGroupForEntity,
      incrementPerfCounter,
      invalidateRenderPasses,
      isDynamicBordersEnabled,
      isAdmDetailTier,
      isUsableMesh,
      isWorldBounds,
      nowMs,
      publishScenarioCoastlineDecision,
      recordRenderPerfMetric,
      resolveOwnerBorderCode,
      sanitizePolyline,
      shouldExcludeOwnerBorderEntity,
      shouldExcludePoliticalInteractionFeature,
      simplifyPolylineEffectiveArea,
      getStaticMeshSourceCountries: () => staticMeshSourceCountries,
      getScenarioSurfaceVersionSignal,
      updateDynamicBorderStatusUI,
    },
  });
  return borderMeshOwner;
}

function getBorderDrawOwner() {
  if (borderDrawOwner) {
    return borderDrawOwner;
  }
  borderDrawOwner = createBorderDrawOwner({
    state,
    constants: {
      boundaryDefaultLineCap: BOUNDARY_DEFAULT_LINE_CAP,
      boundaryDefaultLineJoin: BOUNDARY_DEFAULT_LINE_JOIN,
      boundaryDefaultMiterLimit: BOUNDARY_DEFAULT_MITER_LIMIT,
      coastlineLodLowZoomMax: COASTLINE_LOD_LOW_ZOOM_MAX,
      coastlineLodMidZoomMax: COASTLINE_LOD_MID_ZOOM_MAX,
      coastlineViewSimplifyCollinearAngleDeg: COASTLINE_VIEW_SIMPLIFY_COLLINEAR_ANGLE_DEG,
      coastlineViewSimplifyLowMinDistancePx: COASTLINE_VIEW_SIMPLIFY_LOW_MIN_DISTANCE_PX,
      coastlineViewSimplifyMidMinDistancePx: COASTLINE_VIEW_SIMPLIFY_MID_MIN_DISTANCE_PX,
      detailAdmBorderAlphaScale: DETAIL_ADM_BORDER_ALPHA_SCALE,
      detailAdmBorderColor: DETAIL_ADM_BORDER_COLOR,
      detailAdmBorderMinWidth: DETAIL_ADM_BORDER_MIN_WIDTH,
      detailAdmBorderTargetMaxAlpha: DETAIL_ADM_BORDER_TARGET_MAX_ALPHA,
      detailAdmBorderTargetMinAlpha: DETAIL_ADM_BORDER_TARGET_MIN_ALPHA,
      detailAdmBorderWidthScale: DETAIL_ADM_BORDER_WIDTH_SCALE,
      detailAdmBordersMinZoom: DETAIL_ADM_BORDERS_MIN_ZOOM,
      internalBorderLocalAlphaScale: INTERNAL_BORDER_LOCAL_ALPHA_SCALE,
      internalBorderLocalMinAlpha: INTERNAL_BORDER_LOCAL_MIN_ALPHA,
      internalBorderLocalMinWidth: INTERNAL_BORDER_LOCAL_MIN_WIDTH,
      internalBorderLocalWidthScale: INTERNAL_BORDER_LOCAL_WIDTH_SCALE,
      internalBorderProvinceMinAlpha: INTERNAL_BORDER_PROVINCE_MIN_ALPHA,
      internalBorderProvinceMinWidth: INTERNAL_BORDER_PROVINCE_MIN_WIDTH,
      localBordersMinZoom: LOCAL_BORDERS_MIN_ZOOM,
      provinceBordersFadeStartZoom: PROVINCE_BORDERS_FADE_START_ZOOM,
      provinceBordersFarAlpha: PROVINCE_BORDERS_FAR_ALPHA,
      provinceBordersFarWidthMaxZoom: PROVINCE_BORDERS_FAR_WIDTH_MAX_ZOOM,
      provinceBordersFarWidthScale: PROVINCE_BORDERS_FAR_WIDTH_SCALE,
      provinceBordersNearAlphaScale: PROVINCE_BORDERS_NEAR_ALPHA_SCALE,
      provinceBordersNearWidthScale: PROVINCE_BORDERS_NEAR_WIDTH_SCALE,
      provinceBordersNearZoomStart: PROVINCE_BORDERS_NEAR_ZOOM_START,
      provinceBordersTransitionAlpha: PROVINCE_BORDERS_TRANSITION_ALPHA,
      provinceBordersTransitionEndZoom: PROVINCE_BORDERS_TRANSITION_END_ZOOM,
    },
    getters: {
      getContext: () => rendererSurfaceHost.getContext(),
      getPathCanvas: () => rendererSurfaceHost.getPathCanvas(),
      getProjection: () => rendererSurfaceHost.getProjection(),
      getScenarioOwnerOnlyCanonicalFallbackWarnings: () => scenarioOwnerOnlyCanonicalFallbackWarnings,
      getVisibleInternalBorderMeshSignature: () => visibleInternalBorderMeshSignature,
    },
    helpers: {
      buildCountryParentBorderMeshes,
      buildDetailAdmMeshSignature,
      clamp,
      drawScenarioCoastalAccentLayer,
      getCoastlineCollectionForZoom,
      getInternalBorderStrokeColor,
      getSafeCanvasColor,
      getVisibleCountryCodesForBorderMeshes,
      isUsableMesh,
      isDynamicBordersEnabled,
      sanitizePolyline,
      scheduleDeferredHeavyBorderMeshes,
      reconcileDetailAdmBorders: (meta) => getBorderMeshOwner().reconcileDetailAdmBorders(meta),
      setVisibleInternalBorderMeshSignature: (signature) => {
        visibleInternalBorderMeshSignature = signature;
      },
    },
  });
  return borderDrawOwner;
}

function getInteractionBorderSnapshotOwner() {
  if (interactionBorderSnapshotOwner) {
    return interactionBorderSnapshotOwner;
  }
  interactionBorderSnapshotOwner = createInteractionBorderSnapshotOwner({
    state,
    constants: {
      renderPassOverscanRatioPerSide: RENDER_PASS_OVERSCAN_RATIO_PER_SIDE,
    },
    getters: {
      getContext: () => rendererSurfaceHost.getContext(),
      getRenderPassCacheState,
    },
    helpers: {
      cloneZoomTransform,
      drawBordersPass,
      incrementPerfCounter,
      invalidateInteractionBorderSnapshotFacade: (reason) => invalidateInteractionBorderSnapshot(reason),
      nowMs,
      prepareTargetContext,
      recordRenderPerfMetric,
      withRenderTarget,
    },
  });
  return interactionBorderSnapshotOwner;
}

function getSpatialIndexRuntimeOwner() {
  if (spatialIndexRuntimeOwner) {
    return spatialIndexRuntimeOwner;
  }
  spatialIndexRuntimeOwner = createSpatialIndexRuntimeOwner({
    state,
    constants: {
      chunkedIndexBuildSliceSize: CHUNKED_INDEX_BUILD_SLICE_SIZE,
      chunkedSpatialBuildSliceSize: CHUNKED_SPATIAL_BUILD_SLICE_SIZE,
      hitGridTargetCols: HIT_GRID_TARGET_COLS,
      hitGridMinCellPx: HIT_GRID_MIN_CELL_PX,
      hitGridMaxCellPx: HIT_GRID_MAX_CELL_PX,
      hitMaxCellsPerItem: HIT_MAX_CELLS_PER_ITEM,
    },
    getters: {
      getPathSvg: () => rendererSurfaceHost.getPathSvg(),
    },
    helpers: {
      rebuildAuxiliaryRegionIndexes,
      getLogicalCanvasDimensions,
      computeProjectedFeatureBounds,
      getProjectedFeatureBounds,
      shouldSkipFeature,
      queueIndexUiRefresh,
      finalizeIndexBuildEffects,
      getFeatureId,
      getFeatureCountryCodeNormalized,
      getFeatureBorderMeshCountryCodeNormalized,
      shouldExcludePoliticalInteractionFeature,
      shouldExcludePoliticalVisualFeature,
      nowMs,
      recordRenderPerfMetric,
      setInteractionInfrastructureState,
      yieldToMain,
      getEffectiveWaterRegionFeatures,
      getEffectiveSpecialRegionFeatures,
      collectFeatureHitGeometries: collectSafeWaterRegionGeometryParts,
      computeProjectedGeoBounds,
      shouldExcludeWaterHitGeometry,
    },
  });
  return spatialIndexRuntimeOwner;
}

function getRenderCacheOwner() {
  if (renderCacheOwner) {
    return renderCacheOwner;
  }
  renderCacheOwner = createRenderCacheOwner({
    state: runtimeState,
    constants: {
      interactionCompositePassNames: Object.freeze([...INTERACTION_COMPOSITE_PASS_NAMES]),
      renderPassNames: Object.freeze([...RENDER_PASS_NAMES]),
      renderPassOverscanRatioPerSide: RENDER_PASS_OVERSCAN_RATIO_PER_SIDE,
      transformedFramePassNames: new Set(TRANSFORM_REUSED_RENDER_PASS_NAMES),
    },
    getters: {
      getContext: () => rendererSurfaceHost.getContext?.() || null,
    },
    helpers: {
      cloneZoomTransform,
      ensureRenderPassCacheState,
      getTransformSignature,
      getVisibleFrameIdentity,
    },
  });
  return renderCacheOwner;
}

function getCachedPassCompositorOwner() {
  if (cachedPassCompositorOwner) return cachedPassCompositorOwner;
  cachedPassCompositorOwner = createCachedPassCompositorOwner({
    constants: {
      renderPassNames: RENDER_PASS_NAMES,
    },
    getters: {
      getActiveTargetContext: () => rendererSurfaceHost.getContext(),
      getRenderPassCacheSnapshot: getRenderPassCacheState,
      getPassReferenceTransform,
      getRenderPassLayout,
      getDpr: () => runtimeState.dpr,
      getRenderPhase: () => runtimeState.renderPhase,
      isRenderDiagnosticsEnabled: () => !!renderDiag.enabled,
    },
    helpers: {
      cloneZoomTransform,
      areZoomTransformsEquivalent,
    },
    effects: {
      recordTransformedPassDiagnostics: (passName, details) => {
        renderDiag.transformedPasses = {
          ...(renderDiag.transformedPasses || {}),
          [passName]: details,
        };
        publishRenderDiagnostics();
      },
    },
  });
  return cachedPassCompositorOwner;
}

function getTransformedFrameCompositorOwner() {
  if (transformedFrameCompositorOwner) return transformedFrameCompositorOwner;
  transformedFrameCompositorOwner = createTransformedFrameCompositorOwner({
    constants: {
      interactionCompositePassNames: INTERACTION_COMPOSITE_PASS_NAMES,
      renderPhaseIdle: RENDER_PHASE_IDLE,
      renderPhaseInteracting: RENDER_PHASE_INTERACTING,
      renderPhaseSettling: RENDER_PHASE_SETTLING,
    },
    getters: {
      getCurrentTransform: () => runtimeState.zoomTransform || globalThis.d3.zoomIdentity,
      getRenderPassCacheSnapshot: getRenderPassCacheState,
      getActiveTransformedFramePassNames,
      getRenderPhase: () => runtimeState.renderPhase,
      getDeferExactAfterSettle: () => runtimeState.deferExactAfterSettle,
      getActiveScenarioId: () => runtimeState.activeScenarioId,
      getPendingExactPoliticalFastFrame: () => runtimeState.pendingExactPoliticalFastFrame,
      getZoomGestureScaleDelta: () => runtimeState.zoomGestureScaleDelta,
      getZoomGestureEndedAt: () => runtimeState.zoomGestureEndedAt,
      getDpr: () => runtimeState.dpr,
      isHgoRuntimePreviewReady,
    },
    helpers: {
      nowMs,
      canDrawTransformedPass,
      getInteractionCompositeReuseDecision,
    },
    effects: {
      ensureCompositeBufferCanvas,
      resetCanvasContext,
      withRenderTarget,
      drawInteractionComposite,
      composeRenderPassesToTarget,
      drawTransformedPass,
      drawInteractionBorderSnapshot,
      drawBordersPass,
      blitCompositeBufferToMain,
      resetMainCanvas,
      setInteractionCompositeRejectedReason: (reason) => {
        getRenderPassCacheState().interactionComposite.rejectedReason = reason;
      },
      invalidateInteractionComposite,
      buildInteractionComposite,
      canDrawInteractionComposite,
      setPendingExactPoliticalFastFrame: (value) => {
        setPendingExactPoliticalFastFrameState(runtimeState, value);
      },
      recordRenderPerfMetric,
      recordPassTiming,
      incrementPerfCounter,
    },
  });
  return transformedFrameCompositorOwner;
}

function getRenderPassCacheHostOwner() {
  if (renderPassCacheHostOwner) {
    return renderPassCacheHostOwner;
  }
  renderPassCacheHostOwner = createRenderPassCacheHostOwner({
    effects: {
      ensureRenderPassCanvas,
      prepareTargetContext,
      withRenderTarget,
    },
    getters: {
      getRenderPassLayout,
    },
  });
  return renderPassCacheHostOwner;
}

function getRenderPassCommitAccountingOwner() {
  if (renderPassCommitAccountingOwner) {
    return renderPassCommitAccountingOwner;
  }
  renderPassCommitAccountingOwner = createRenderPassCommitAccountingOwner({
    effects: {
      clearPassFullReferenceTransforms,
      incrementPerfCounter,
      recordPassTiming,
      recordRenderPerfMetric,
      schedulePoliticalPathWarmup,
      setPassFullReferenceTransform,
      setPassReferenceTransform,
    },
    getters: {
      getPassCounterNames,
      getRenderPassCacheState,
      getRenderPassSignature,
      getVisibleFrameIdentity,
      nowMs,
    },
  });
  return renderPassCommitAccountingOwner;
}

function getRenderTransformReusePolicyOwner() {
  if (renderTransformReusePolicyOwner) {
    return renderTransformReusePolicyOwner;
  }
  renderTransformReusePolicyOwner = createRenderTransformReusePolicyOwner({
    state,
    getters: {
      getRenderPassCacheState,
      getPassReferenceTransform,
    },
    helpers: {
      cloneZoomTransform,
      isHeavyScenarioStagedApplyCandidate,
    },
  });
  return renderTransformReusePolicyOwner;
}

function getProjectedGeometryBoundsOwner() {
  if (projectedGeometryBoundsOwner) {
    return projectedGeometryBoundsOwner;
  }
  projectedGeometryBoundsOwner = createProjectedGeometryBoundsOwner({
    getters: {
      getProjection: () => rendererSurfaceHost.getProjection(),
      getPathCanvas: () => rendererSurfaceHost.getPathCanvas(),
      getPathSvg: () => rendererSurfaceHost.getPathSvg(),
      getProjectedBoundsCache: ensureProjectedBoundsCache,
      getLandFeatures: () => runtimeState.landData?.features || [],
      getRiverFeatures: () => runtimeState.riversData?.features || [],
      getActiveScenarioId: () => runtimeState.activeScenarioId || "",
      getD3: () => globalThis.d3,
    },
    helpers: {
      getFeatureId,
      recordRenderPerfMetric,
      recordProjectedBoundsDiagnosticsState,
      resetHostWaterPathCaches: () => {
        scenarioWaterPartPathCache = new WeakMap();
        scenarioWaterFeaturePathCache = new WeakMap();
      },
      warn: (...args) => console.warn(...args),
    },
  });
  return projectedGeometryBoundsOwner;
}

function getViewportReadModelOwner() {
  if (viewportReadModelOwner) {
    return viewportReadModelOwner;
  }
  const snapshotBounds = (bounds) => bounds ? {
    minX: Number(bounds.minX), minY: Number(bounds.minY),
    maxX: Number(bounds.maxX), maxY: Number(bounds.maxY),
  } : null;
  const snapshotFeatureBounds = (features) => features.map((feature) => {
    const featureId = getFeatureId(feature);
    return snapshotBounds(getProjectedFeatureBounds(feature, { featureId, allowCompute: false })
      || getProjectedFeatureBounds(feature, { featureId }));
  });
  viewportReadModelOwner = createViewportReadModelOwner({
    constants: {
      mapPanPaddingPx: MAP_PAN_PADDING_PX,
    },
    getters: {
      getViewportDimensions: () => ({ width: Number(runtimeState.width), height: Number(runtimeState.height) }),
      getViewportDpr: () => Number(runtimeState.dpr || 1),
    },
    capabilities: {
      getProjectionSnapshot: () => {
        const projection = rendererSurfaceHost.getProjection();
        if (!projection || typeof projection.scale !== "function" || typeof projection.translate !== "function") {
          return null;
        }
        const translate = projection.translate() || [0, 0];
        return { scale: projection.scale(), translate: [translate[0], translate[1]] };
      },
      invertProjectionPoint: (point) => {
        const projection = rendererSurfaceHost.getProjection();
        if (!projection || typeof projection.invert !== "function") return null;
        const inverted = projection.invert(point);
        return Array.isArray(inverted) ? inverted.map(Number) : null;
      },
      getZoomTransformSnapshot: () => {
        const transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity || { x: 0, y: 0, k: 1 };
        return { x: Number(transform.x), y: Number(transform.y), k: Number(transform.k) };
      },
      createZoomTransform: ({ x, y, translate }) => {
        const identity = globalThis.d3?.zoomIdentity;
        return identity && translate && typeof identity.translate === "function"
          ? identity.translate(x, y) : identity || null;
      },
      getPanContentBoundsSnapshots: () => {
        if (isHgoRuntimePreviewReady()) return [snapshotBounds(getProjectedHgoRuntimePreviewBounds())];
        const features = runtimeState.landData?.features;
        if (!rendererSurfaceHost.getPathSvg() || !Array.isArray(features) || !features.length) return [];
        const [width, height] = getLogicalCanvasDimensions();
        return snapshotFeatureBounds(features.filter((feature) => !shouldSkipFeature(feature, width, height, { forceProd: true })));
      },
      getProjectedRenderableContentBoundsSnapshots: () => {
        if (isHgoRuntimePreviewReady()) return [snapshotBounds(getProjectedHgoRuntimePreviewBounds())];
        const features = runtimeState.landData?.features;
        if (!Array.isArray(features) || !features.length || Number(runtimeState.width || 0) <= 0 || Number(runtimeState.height || 0) <= 0) return [];
        const [width, height] = getLogicalCanvasDimensions();
        const renderable = getRenderableLandFeatures(width, height, { forceProd: true });
        return snapshotFeatureBounds(Array.isArray(renderable) && renderable.length ? renderable : features);
      },
    },
  });
  return viewportReadModelOwner;
}

function getViewportCommandOwner() {
  if (viewportCommandOwner) {
    return viewportCommandOwner;
  }
  viewportCommandOwner = createViewportCommandOwner({
    state: runtimeState,
    constants: {
      minZoomScale: MIN_ZOOM_SCALE,
      maxZoomScale: MAX_ZOOM_SCALE,
    },
    getters: {
      getZoomBehavior: () => rendererSurfaceHost.getZoomBehavior(),
      getInteractionRect: () => rendererSurfaceHost.getInteractionRect(),
      getD3: () => globalThis.d3,
      calculatePanExtent,
      getCenteredFitZoomTransform,
    },
    effects: {
      setZoomTransform: (transform) => {
        setZoomTransformState(runtimeState, transform);
      },
    },
  });
  return viewportCommandOwner;
}

function getRendererViewportUpdateOwner() {
  if (rendererViewportUpdateOwner) {
    return rendererViewportUpdateOwner;
  }
  const runtime = runtimeState;
  rendererViewportUpdateOwner = createRendererViewportUpdateOwner({
    getters: {
      getViewportGroup: () => rendererSurfaceHost.getViewportGroup(),
    },
    effects: {
      setZoomTransform: (transform) => {
        setZoomTransformState(runtimeState, transform);
      },
      setHitCanvasDirty: () => {
        setHitCanvasDirtyState(runtimeState, true);
      },
      updateZoomUi: () => {
        if (typeof runtime.updateZoomUIFn === "function") {
          runtime.updateZoomUIFn();
        }
      },
      renderPhysicalIntensityBrushPreview,
      syncUnitCounterScalesDuringZoom: () => {
        getStrategicOverlayRenderOwner().syncUnitCounterScalesDuringZoom();
      },
      syncSpecialZonePatternTransformDuringZoom,
      drawFrame: () => {
        drawCanvas();
      },
    },
  });
  return rendererViewportUpdateOwner;
}

function getViewportResizeLifecycleOwner() {
  if (viewportResizeLifecycleOwner) {
    return viewportResizeLifecycleOwner;
  }
  viewportResizeLifecycleOwner = createViewportResizeLifecycleOwner({
    state: runtimeState,
    getters: {
      getMapContainer: () => rendererSurfaceHost.getMapContainer(),
      getGlobal: () => globalThis,
      getDevicePixelRatio: () => globalThis.devicePixelRatio,
      hasLandFeatures: () => !!runtimeState.landData?.features?.length,
    },
    helpers: {
      scheduleDeferredWork,
      cancelDeferredWork,
      nowMs,
      recordRenderPerfMetric,
    },
    effects: {
      setRenderPhaseInteracting: () => setRenderPhase(RENDER_PHASE_INTERACTING),
      scheduleRenderPhaseIdle,
      setCanvasSize,
      fitProjection,
      resetZoomToFit,
      enforceZoomConstraints,
      markAllOverlaysDirty,
      render,
      buildSpatialIndex,
      setHitCanvasDirty: () => {
        setHitCanvasDirtyState(runtimeState, true);
      },
      scheduleHitCanvasBuildIfNeeded,
    },
  });
  return viewportResizeLifecycleOwner;
}

function getScenarioWaterCachePolicyOwner() {
  if (scenarioWaterCachePolicyOwner) {
    return scenarioWaterCachePolicyOwner;
  }
  scenarioWaterCachePolicyOwner = createScenarioWaterCachePolicyOwner({
    state,
    getters: {
      readSearchParam,
      getDevicePixelRatio: () => globalThis.devicePixelRatio,
      getPreviousRenderedCount: () => lastScenarioWaterRenderedCount,
    },
    helpers: {
      cloneZoomTransform: (transform) => cloneZoomTransform(transform || globalThis.d3?.zoomIdentity),
      collectSafeWaterRegionGeometryParts,
      computeProjectedGeoBounds,
      isWaterRegionRenderable,
    },
  });
  return scenarioWaterCachePolicyOwner;
}

function getZoomInteractionLifecycleOwner() {
  if (zoomInteractionLifecycleOwner) {
    return zoomInteractionLifecycleOwner;
  }
  zoomInteractionLifecycleOwner = createZoomInteractionLifecycleOwner({
    state: runtimeState,
    constants: {
      minZoomScale: MIN_ZOOM_SCALE,
      maxZoomScale: MAX_ZOOM_SCALE,
      renderPhaseInteracting: RENDER_PHASE_INTERACTING,
      renderPhaseSettling: RENDER_PHASE_SETTLING,
    },
    getters: {
      getD3: () => globalThis.d3,
      getWidth: () => runtimeState.width,
      getHeight: () => runtimeState.height,
      getInteractionRect: () => rendererSurfaceHost.getInteractionRect(),
      getZoomBehavior: () => rendererSurfaceHost.getZoomBehavior(),
      getZoomIdentity: () => globalThis.d3?.zoomIdentity,
      getZoomTransform: () => runtimeState.zoomTransform,
      getPendingZoomTransform: () => runtimeState.pendingZoomTransform,
      getZoomGestureStartTransform: () => runtimeState.zoomGestureStartTransform,
      isZoomRenderScheduled: () => !!runtimeState.zoomRenderScheduled,
    },
    helpers: {
      cloneZoomTransform,
      shouldAllowZoomEvent,
      nowMs,
      requestAnimationFrame: (callback) => globalThis.requestAnimationFrame(callback),
    },
    effects: {
      setZoomBehavior: (nextZoomBehavior) => {
        rendererSurfaceHost.setZoomBehavior(nextZoomBehavior);
      },
      setZoomGestureStartTransform: (transform) => {
        setZoomGestureStartTransformState(runtimeState, transform);
      },
      setZoomGestureScaleDelta: (scaleDelta) => {
        setZoomGestureScaleDeltaState(runtimeState, scaleDelta);
      },
      setPendingExactPoliticalFastFrame: (pending) => {
        setPendingExactPoliticalFastFrameState(runtimeState, pending);
      },
      setPendingZoomTransform: (transform) => {
        setPendingZoomTransformState(runtimeState, transform);
      },
      setZoomRenderScheduled: (scheduled) => {
        setZoomRenderScheduledState(runtimeState, scheduled);
      },
      setZoomGestureEndedAt: (endedAtMs) => {
        setZoomGestureEndedAtState(runtimeState, endedAtMs);
      },
      clearRenderPhaseTimer,
      cancelExactAfterSettleRefresh,
      setRenderPhase,
      captureInteractionBorderSnapshot,
      renderHoverOverlayIfNeeded,
      dismissOnboardingHint,
      updateMap,
      scheduleScenarioChunkRefresh: (options) => {
        if (typeof runtimeState.scheduleScenarioChunkRefreshFn === "function") {
          return runtimeState.scheduleScenarioChunkRefreshFn(options);
        }
        return "noop";
      },
      scheduleRenderPhaseIdle,
      updateZoomTranslateExtent,
      resetZoomToFit,
      enforceZoomConstraints,
    },
  });
  return zoomInteractionLifecycleOwner;
}

function getClickSelectionTransactionOwner() {
  if (clickSelectionTransactionOwner) return clickSelectionTransactionOwner;
  clickSelectionTransactionOwner = createClickSelectionTransactionOwner({
    constants: {
      clickSnapRadiusPx: HIT_SNAP_RADIUS_CLICK_PX,
      landFillColor: LAND_FILL_COLOR,
    },
    getters: {
      getClickState: () => Object.freeze({
        activeSovereignCode: runtimeState.activeSovereignCode,
        colors: runtimeState.colors,
        countryBaseColors: runtimeState.countryBaseColors,
        currentTool: runtimeState.currentTool,
        interactionGranularity: runtimeState.interactionGranularity,
        isEditingPreset: runtimeState.isEditingPreset,
        landData: runtimeState.landData,
        landIndex: runtimeState.landIndex,
        operationalLineEditor: runtimeState.operationalLineEditor,
        operationGraphicsEditor: runtimeState.operationGraphicsEditor,
        scenarioSpecialRegionsData: runtimeState.scenarioSpecialRegionsData,
        selectedColor: runtimeState.selectedColor,
        selectedSpecialRegionId: runtimeState.selectedSpecialRegionId,
        selectedWaterRegionId: runtimeState.selectedWaterRegionId,
        sovereignBaseColors: runtimeState.sovereignBaseColors,
        specialRegionsById: runtimeState.specialRegionsById,
        specialZoneEditor: runtimeState.specialZoneEditor,
        startupReadonly: runtimeState.startupReadonly,
        unitCounterEditor: runtimeState.unitCounterEditor,
        waterRegionsById: runtimeState.waterRegionsById,
        waterRegionsData: runtimeState.waterRegionsData,
      }),
      getSelectedFacilityEntry: () => selectedFacilityEntry,
    },
    effects: {
      clearClickHoverIds: () => (clearClickHoveredIdState(runtimeState), clearClickScenarioHoverIdsState(runtimeState)),
      consumeSuppressedBrushClick: () => {
        if (!suppressNextClickAfterBrush) return false;
        suppressNextClickAfterBrush = false;
        return true;
      },
      removeClickCountryColors: (countryCode) => removeClickCountryColorsState(runtimeState, countryCode),
      removeClickWaterRegionOverride: (regionId) => removeClickWaterRegionOverrideState(runtimeState, regionId),
      setClickActiveSovereignCode: (ownerCode, { updateUi = false } = {}) => {
        setClickActiveSovereignCodeState(runtimeState, ownerCode);
        if (updateUi && typeof runtimeState.updateActiveSovereignUIFn === "function") {
          runtimeState.updateActiveSovereignUIFn();
        }
      },
      setClickCountryColors: (countryCode, color) => setClickCountryColorsState(runtimeState, countryCode, color),
      setClickHoverOverlayDirty: (dirty) => setClickHoverOverlayDirtyState(runtimeState, dirty),
      setClickSelectedColor: (color, { updateSwatch = false } = {}) => {
        setClickSelectedColorState(runtimeState, color);
        if (updateSwatch && typeof runtimeState.updateSwatchUIFn === "function") {
          runtimeState.updateSwatchUIFn();
        }
      },
      setClickSelectedSpecialRegionId: (regionId) => setClickSelectedSpecialRegionIdState(runtimeState, regionId),
      setClickSelectedWaterRegionId: (regionId) => setClickSelectedWaterRegionIdState(runtimeState, regionId),
      setFacilityInfoCardExpanded: (expanded) => {
        facilityInfoCardExpanded = Boolean(expanded);
      },
      setHoveredFacilityEntry: (entry) => {
        getMapHoverInteractionOwner().setHoveredFacilityEntry(entry);
      },
      setSelectedFacilityEntry: (entry) => {
        selectedFacilityEntry = entry;
      },
      togglePresetRegion: (landId) => {
        if (typeof globalThis.togglePresetRegion === "function") globalThis.togglePresetRegion(landId);
      },
    },
    services: {
      addRecentColor,
      appendOperationalLineVertexFromEvent,
      appendOperationGraphicVertexFromEvent,
      appendSpecialZoneVertexFromEvent,
      applyFacilityInfoCardState,
      applyFeatureVisualOverrideTransaction,
      applyVisualSubdivisionFill,
      applyWaterRegionFill,
      blockStartupReadonlyInteraction,
      captureHistoryState,
      commitHistoryEntry,
      dismissOnboardingHint,
      ensureLeafDetailReady,
      getFeatureCountryCodeNormalized,
      getFeatureOwnerCode,
      getHitFromEvent,
      getHoveredFacilityEntryFromEvent,
      getIntensityFieldTool,
      getSafeCanvasColor,
      getSpecialRegionColor,
      getWaterRegionColor,
      handleSpecialZoneMembershipClick,
      inspectHgoRuntimePreviewFromEvent,
      isDoubleClickBatchEligible,
      isFacilityDetailsSurfaceActive,
      isMacroOceanWaterRegion,
      isOpenOceanPaintEnabled,
      isSovereigntyModeActive,
      markDirty,
      markLegacyColorStateDirty,
      noteRenderAction,
      nowMs,
      placeUnitCounterFromEvent,
      queueTooltipUpdate,
      refreshResolvedColorsForFeatures,
      refreshResolvedColorsForOwners,
      refreshSidebarAfterPaint,
      refreshSpecialRegionSidebarRowsNow,
      refreshWaterRegionSidebarRowsNow,
      renderHoverOverlayIfNeeded,
      requestInteractionRender,
      resetFeatureOwnerCodes,
      resolveInteractionTargetIds,
      scheduleDynamicBorderRecompute,
      setFeatureOwnerCodes,
      shouldBlockUnderlyingSelectionForFacility,
      shouldRequireLeafDetail,
      syncInspectorCountryToLandSelection,
      toggleFeatureInDevSelection,
      updateDevSelectedHit,
      warnMissingActiveSovereign: () => console.warn("[sovereignty] No active sovereign selected."),
    },
  });
  return clickSelectionTransactionOwner;
}

function getMapInteractionEventBindingOwner() {
  if (mapInteractionEventBindingOwner) {
    return mapInteractionEventBindingOwner;
  }
  mapInteractionEventBindingOwner = createMapInteractionEventBindingOwner({
    getters: {
      getInteractionRect: () => rendererSurfaceHost.getInteractionRect(),
      getWindow: () => window,
      getInteractionRectNode: () => rendererSurfaceHost.getInteractionRect()?.node?.(),
    },
    helpers: {
      bindInteractionFunnel,
    },
    handlers: {
      mapClick: handleClick,
      mapDoubleClick: handleDoubleClick,
      handleMouseMove,
      handlePhysicalIntensityPointerDown,
      handlePhysicalIntensityPointerMove,
      handlePhysicalIntensityPointerEnd,
      handleBrushPointerDown,
      handleBrushPointerMove,
      handleMouseLeave: handleMapMouseLeave,
      dispatchMapClick,
      dispatchMapDoubleClick,
      handleSidebarLayoutStart,
      handleResize,
      flushSpecialZoneMembershipDragSession,
      flushBrushSession,
    },
    effects: {
      bindMapContainerResizeObserver,
      bindBrowserZoomObservers,
    },
  });
  return mapInteractionEventBindingOwner;
}

function getIntensityFieldMaskOwner() {
  if (intensityFieldMaskOwner) {
    return intensityFieldMaskOwner;
  }
  intensityFieldMaskOwner = createIntensityFieldMaskOwner({
    getFieldsState: () => runtimeState.intensityFields,
    getProjection: () => rendererSurfaceHost.getProjection(),
  });
  return intensityFieldMaskOwner;
}

function getHgoRuntimePreviewRenderOwner() {
  if (hgoRuntimePreviewRenderOwner) {
    return hgoRuntimePreviewRenderOwner;
  }
  hgoRuntimePreviewRenderOwner = createHgoRuntimePreviewRenderOwner({
    runtimeState,
    renderPassNames: RENDER_PASS_NAMES,
    transformedFramePassNames: TRANSFORMED_FRAME_PASS_NAMES,
    getProjection: () => rendererSurfaceHost.getProjection(),
    getMapSvg: () => rendererSurfaceHost.getMapSvg(),
    getTargetCanvas: () => rendererSurfaceHost.getContext()?.canvas || null,
    callRuntimeHook,
    createHitResult,
    resetCanvasContext,
    recordRenderPerfMetric,
    nowMs,
  });
  return hgoRuntimePreviewRenderOwner;
}

function getVisualEffectsPassOwner() {
  if (visualEffectsPassOwner) {
    return visualEffectsPassOwner;
  }
  visualEffectsPassOwner = createVisualEffectsPassOwner({
    getters: {
      getContext: () => rendererSurfaceHost.getContext(),
      getPathCanvas: () => rendererSurfaceHost.getPathCanvas(),
      getPathSvg: () => rendererSurfaceHost.getPathSvg(),
      getProjection: () => rendererSurfaceHost.getProjection(),
      getViewportSize: () => ({ width: runtimeState.width, height: runtimeState.height }),
      getTextureStyleConfig,
      isBootInteractionReady,
      isHgoRuntimePreviewReady,
    },
    helpers: {
      clamp,
      getDashPattern,
      getSafeBlendMode,
      getSafeCanvasColor,
      normalizeTextureMode,
    },
    effects: {
      requestTextureRerender,
      drawDayNightRuntimePass: (k, options) => getDayNightRuntimeOwner().drawDayNightPass(k, options),
      recordRenderPerfMetric,
    },
    platform: {
      createCanvas: () => document.createElement("canvas"),
      createImage: () => new Image(),
      createGeoRotation: (rotation) => globalThis.d3?.geoRotation
        ? globalThis.d3.geoRotation(rotation)
        : ((point) => point),
      createPatternTransform: (scale) => {
        if (!globalThis.DOMMatrix) return null;
        const matrix = new globalThis.DOMMatrix();
        matrix.scaleSelf(scale, scale);
        return matrix;
      },
    },
    constants: {
      paperTextureAssetUrls: PAPER_TEXTURE_ASSET_URLS,
      paperNoiseTileSize: 192,
      graticuleSampleDegrees: 2,
      textureLabelSerifStack: TEXTURE_LABEL_SERIF_STACK,
    },
  });
  return visualEffectsPassOwner;
}

function resolveContextBaseDeferredSnapshot() {
  return {
    maskInfo: getPhysicalLandMaskInfo(),
    urbanFeatureCount: getFeatureCollectionFeatureCount(runtimeState.urbanData),
    airportFeatureCount: getFeatureCollectionFeatureCount(runtimeState.airportsData),
    roadFeatureCount: getFeatureCollectionFeatureCount(runtimeState.roadsData),
    railwayFeatureCount: getFeatureCollectionFeatureCount(runtimeState.railwaysData),
    portFeatureCount: getFeatureCollectionFeatureCount(runtimeState.portsData),
  };
}

function resolveContextMarkersDeferredSnapshot() {
  return {
    cityFeatureCount: getFeatureCollectionFeatureCount(getEffectiveCityCollection()),
    strategicResourceFeatureCount: getStrategicValuesResourceFeatureCount(
      runtimeState.scenarioStrategicValuesData,
    ),
    airportFeatureCount: getFeatureCollectionFeatureCount(runtimeState.airportsData),
    portFeatureCount: getFeatureCollectionFeatureCount(runtimeState.portsData),
    roadFeatureCount: getFeatureCollectionFeatureCount(runtimeState.roadsData),
    railwayFeatureCount: getFeatureCollectionFeatureCount(runtimeState.railwaysData),
  };
}

function getContextPassOrchestratorOwner() {
  if (contextPassOrchestratorOwner) {
    return contextPassOrchestratorOwner;
  }
  contextPassOrchestratorOwner = createContextPassOrchestratorOwner({
    getters: {
      isHgoRuntimePreviewReady,
      getDeferContextBasePass: () => runtimeState.deferContextBasePass,
    },
    resolvers: {
      resolveContextBaseDeferredSnapshot,
      resolveContextMarkersDeferredSnapshot,
    },
    helpers: {
      nowMs,
    },
    effects: {
      beginContextMetricSession,
      endContextMetricSession,
      collectContextMetric,
      recordRenderPerfMetric,
      recordDeferredRiversLayerMetric,
      drawPhysicalContourLayer,
      drawUrbanLayer,
      drawRiversLayer,
      drawRoadsLayer: (k, options) => getTransportOverviewRenderOwner().drawRoadsLayer(k, options),
      drawRailwaysLayer: (k, options) =>
        getTransportOverviewRenderOwner().drawRailwaysLayer(k, options),
      drawAirportsLayer: (k, options) =>
        getTransportOverviewRenderOwner().drawAirportsLayer(k, options),
      drawPortsLayer: (k, options) => getTransportOverviewRenderOwner().drawPortsLayer(k, options),
      drawStrategicResourceMarkersLayer,
      drawCityPointsLayer,
      drawScenarioRegionOverlaysPass,
      drawScenarioReliefOverlaysPass,
    },
  });
  return contextPassOrchestratorOwner;
}

function getPoliticalPassOrchestratorOwner() {
  if (politicalPassOrchestratorOwner) {
    return politicalPassOrchestratorOwner;
  }
  politicalPassOrchestratorOwner = createPoliticalPassOrchestratorOwner({
    getters: {
      isHgoRuntimePreviewReady,
      isRenderDiagnosticsEnabled: () => renderDiag.enabled,
      hasPoliticalLandFeatures: () => !!runtimeState.landData?.features?.length,
      isPoliticalRasterWorkerBitmapEnabled,
      hasPendingPoliticalColorEdit,
    },
    resolvers: {
      resolvePoliticalPassIdentity,
      resolvePoliticalPassViewport,
      hasVisiblePoliticalForegroundColorOverride,
    },
    helpers: {
      nowMs,
      createPoliticalPassDrawResult,
    },
    effects: {
      recordRenderPerfMetric,
      resolvePoliticalRecoveryQuality: getPoliticalRecoveryQuality,
      recordPoliticalRasterWorkerSnapshot,
      publishPoliticalPassDiagnostics,
      consumePoliticalRasterWorkerBitmapResult,
      drawPoliticalWorkerBitmapResult,
      drawPoliticalBackgroundFills: drawPoliticalPassBackground,
      buildPoliticalRasterWorkerPacket: buildPoliticalPassWorkerPacket,
      requestPoliticalRasterWorkerPass: requestPoliticalPassWorker,
      drawPoliticalFineFeatureLoop,
      clearPendingPoliticalColorEdit,
    },
  });
  return politicalPassOrchestratorOwner;
}

function getPoliticalBackgroundRenderOwner() {
  if (politicalBackgroundRenderOwner) {
    return politicalBackgroundRenderOwner;
  }
  politicalBackgroundRenderOwner = createPoliticalBackgroundRenderOwner({
    surface: rendererSurfaceHost,
    getters: {
      getRuntimeState: () => runtimeState,
      getDebugMode: () => debugMode,
    },
    helpers: {
      getAtlantropaSeaPoliticalFillColor,
      getFeatureId,
      getSafeCanvasColor,
      isAtlantropaSeaFeature,
      getResolvedFeatureColor,
      getDisplayOwnerCode,
      getFeatureCountryCodeNormalized,
      isWorldBounds,
      getPoliticalPathCacheHandle,
      getPoliticalFeaturePathEntry,
      getTransformSignature,
      getPoliticalPathCacheSignature,
      getVisibleFrameIdentity,
      nowMs,
      getRenderPassCacheState,
      isInteractionRecoverySettled,
      isExactAfterSettleControllerActive,
      cloneZoomTransform,
      getLogicalCanvasDimensions,
      isAntarcticSectorFeature,
      isBaseGeographyScenarioFeature,
      shouldExcludePoliticalVisualFeature,
      shouldSkipFeature,
      getProjectedFeatureBounds,
      collectVisibleLandSpatialItems,
      screenRectToProjectedRect,
      collectLandSpatialItemsForProjectedRects,
      projectedBoundsIntersectScreenRects,
      getPoliticalRecoveryQuality,
      hasPendingPoliticalColorEdit,
      getAdmin0BackgroundFillColor,
      normalizeIntensityFieldsState,
      getRenderPassLayout,
      getProjectionRenderSignature,
      getOceanBaseFillColor,
    },
    effects: {
      recordRenderPerfMetric,
      cancelDeferredWork,
      scheduleDeferredWork,
      invalidateRenderPasses,
      recordProgressivePoliticalFullCacheReadyDiagnostics,
      requestRendererRender,
      renderFallback: () => {
        if (rendererSurfaceHost.getContext()) render();
      },
      commitIntensityFieldsState: (intensityFields) => {
        runtimeState.intensityFields = intensityFields;
      },
      getIntensityFieldMaskOwner,
      applyOceanClipMask,
      drawOceanStyle,
      warn: (...args) => globalThis.console?.warn?.(...args),
    },
    platform: {
      d3: globalThis.d3,
      topojson: globalThis.topojson,
      Path2D: globalThis.Path2D,
      console: globalThis.console,
    },
    constants: {
      landFillColor: LAND_FILL_COLOR,
      renderPhaseIdle: RENDER_PHASE_IDLE,
      politicalRecoveryQualityProgressive: POLITICAL_RECOVERY_QUALITY_PROGRESSIVE,
      progressiveBackgroundExactEntryLimit: 2400,
      deferredFullCacheCpuBudgetMs: 10,
      deferredFullCacheTimeoutMs: 60,
      scenarioBackgroundMergeMaxArea: Math.PI * 2,
      oceanDepthMaskBlendMode: "soft-light",
      oceanDepthMaskGrayMap: { min: 28, neutral: 128, max: 232 },
      oceanMaskModeTopology: OCEAN_MASK_MODE_TOPOLOGY,
    },
  });
  return politicalBackgroundRenderOwner;
}

function getPoliticalPartialRepaintOwner() {
  if (politicalPartialRepaintOwner) return politicalPartialRepaintOwner;
  politicalPartialRepaintOwner = createPoliticalPartialRepaintOwner({
    surface: rendererSurfaceHost,
    getters: {
      getRuntimeState: () => runtimeState,
      getDebugMode: () => debugMode,
      getDefaultTransform: () => runtimeState.zoomTransform || globalThis.d3?.zoomIdentity,
      getRenderPassCacheState,
    },
    helpers: {
      nowMs,
      getFeatureId,
      isAtlantropaSeaFeature,
      getAtlantropaSeaPoliticalFillColor,
      getAtlantropaSeaPoliticalStrokeColor,
      getSafeCanvasColor,
      getResolvedFeatureColor,
      hashToColor,
      buildWorkerPixelRingsForGeometry,
      orderPoliticalShellUnderlayFirst,
      shouldExcludePoliticalVisualFeature,
      shouldSkipFeature,
      pathBoundsInScreen,
      getPoliticalFeaturePathEntry,
      rectsIntersect,
      screenRectToProjectedRect,
      collectLandSpatialItemsForProjectedRects,
      getFeatureScreenBounds,
      getRenderPassLayout,
      getPassReferenceTransform,
      areZoomTransformsEquivalent,
      hasPassFullReferenceTransform,
      getPassFullReferenceTransform,
      getPoliticalPassFineBaselineMismatch,
      getCachedPoliticalPassStaticSignature,
      getPoliticalPathCacheHandle,
      getVisibleFrameIdentity,
      createPoliticalRasterWorkerIdentity,
      getLogicalCanvasDimensions,
      getRenderPassSignature,
      getPoliticalPassViewportOverscanPx,
      collectVisibleLandSpatialItemsWithStats,
      cloneZoomTransform,
      getTransformBucketSignature,
      getIslandNeighborGraph,
      ensurePoliticalRasterWorkerMetrics: () => ensurePoliticalRasterWorkerMetrics(globalThis),
    },
    effects: {
      incrementPerfCounter,
      recordRenderPerfMetric,
      drawPoliticalBackgroundFillsForEntries,
      withRenderTarget,
      clearPendingPoliticalColorEdit,
      setPassReferenceTransform,
      recordPassTiming,
      commitPoliticalPassDiagnostics: (politicalPassDiagnostics) => {
        renderDiag.politicalPass = politicalPassDiagnostics;
        publishRenderDiagnostics();
      },
      requestPoliticalRasterWorkerPass,
      onAcceptedBitmapResult: () => {
        invalidateRenderPasses("political", "political-raster-worker-bitmap-ready");
        requestRendererRender("political-raster-worker-bitmap-ready", {
          flush: false,
          fallback: () => render(),
        });
      },
    },
    constants: {
      renderPhaseIdle: RENDER_PHASE_IDLE,
      landFillColor: LAND_FILL_COLOR,
      partialFeatureThreshold: POLITICAL_PARTIAL_REPAINT_FEATURE_THRESHOLD,
      partialCandidateThreshold: POLITICAL_PARTIAL_REPAINT_CANDIDATE_THRESHOLD,
      partialViewportCoverageMax: POLITICAL_PARTIAL_REPAINT_VIEWPORT_COVERAGE_MAX,
      partialSyncBuildCandidateMax: POLITICAL_PARTIAL_REPAINT_SYNC_BUILD_CANDIDATE_MAX,
      partialSyncBuildMissMax: POLITICAL_PARTIAL_REPAINT_SYNC_BUILD_MISS_MAX,
      partialPaddingPx: POLITICAL_PARTIAL_REPAINT_PAD_PX,
    },
  });
  return politicalPartialRepaintOwner;
}

function getRenderPipelinePassesOwner() {
  if (renderPipelinePassesOwner) {
    return renderPipelinePassesOwner;
  }
  renderPipelinePassesOwner = createRenderPipelinePassesOwner({
    state,
    drawPasses: {
      drawBackgroundPass,
      drawPhysicalBasePass,
      drawPoliticalPass,
      drawHgoPreviewPass,
      drawContextBasePass,
      drawContextScenarioPass,
      drawEffectsPass,
      drawLineEffectsPass,
      drawDayNightPass,
      drawBordersPass,
      drawContextMarkersPass,
      drawTextureLabelEffectsPass,
      drawLabelsPass,
    },
    helpers: {
      detectContextScenarioReasonMismatch,
      getContextBaseReuseDecision,
      getContextScenarioReuseDecision,
      getExactAfterSettleControllerState,
      getPassReferenceTransform,
      getRenderPassCacheState,
      getRenderPassSignature,
      incrementPerfCounter,
      rebuildResolvedColors,
      recordRenderPerfMetric,
      renderPassToCache,
      shouldEnableContextBaseTransformReuse,
      shouldEnableContextScenarioTransformReuse,
      shouldStartExactAfterSettleFastPath,
      tryPartialPoliticalPassRepaint,
    },
  });
  return renderPipelinePassesOwner;
}

function getDrawCanvasOrchestrationOwner() {
  if (drawCanvasOrchestrationOwner) return drawCanvasOrchestrationOwner;

  drawCanvasOrchestrationOwner = createDrawCanvasOrchestrationOwner({
    constants: {
      renderPhaseIdle: RENDER_PHASE_IDLE,
      renderPhaseInteracting: RENDER_PHASE_INTERACTING,
      renderPhaseSettling: RENDER_PHASE_SETTLING,
    },
    getters: {
      isFrameSurfaceReady: () => Boolean(rendererSurfaceHost.getContext() && rendererSurfaceHost.getPathCanvas()),
      getRenderPhase: () => runtimeState.renderPhase,
      getDeferExactAfterSettle: () => runtimeState.deferExactAfterSettle,
      getFirstVisibleFramePainted: () => runtimeState.firstVisibleFramePainted,
      getEffectiveZoomTransform: () => runtimeState.zoomTransform || globalThis.d3.zoomIdentity,
      getRawZoomTransform: () => runtimeState.zoomTransform,
      getActiveScenarioId: () => runtimeState.activeScenarioId,
      getActiveRenderPassNames,
      nowMs,
    },
    effects: {
      ensureLayerDataFromTopology,
      incrementPerfCounter,
      clearPoliticalPatchOverlayIfStale,
      cancelPoliticalPathWarmup,
      promoteDeferredColorRenderToIdle,
      drawTransformedFrameFromCaches,
      drawLastGoodFrameFallback,
      noteMissingVisibleFrameSkippedDuringInteraction,
      drawBaseVisibleFrameFallback,
      resetContextBreakdownForExactFrame,
      composeCachedPasses,
      abortPendingExactAfterSettleRefreshAfterPaint,
      markFirstVisibleFramePainted,
      captureLastGoodFrame,
      recordRenderPerfMetric,
      finalizePendingExactAfterSettleRefreshAfterPaint,
      ensureIdleRenderPasses: (frameTimings, activeRenderPassNames) => {
        getRenderPipelinePassesOwner().ensureIdleRenderPasses(frameTimings, activeRenderPassNames);
      },
      commitLastFrame: ({ phase, totalMs, timings, transform }) => {
        getRenderPassCacheState().lastFrame = {
          phase,
          totalMs,
          timings,
          transform: cloneZoomTransform(transform),
        };
      },
    },
  });
  return drawCanvasOrchestrationOwner;
}

// --- 注释锚点：缓存状态（cache state）章节 ---
// --- 注释锚点：pass-through facade 章节 ---
// --- 注释锚点：实际渲染实现（render implementation）章节 ---

const cityCountryProfileCache = new WeakMap();
const visibleFacilityHoverEntriesByFamily = {
  airport: [],
  port: [],
  rail: [],
};
let selectedFacilityEntry = null;
let facilityInfoCard = null;
let facilityInfoCardTitle = null;
let facilityInfoCardBody = null;
let facilityInfoCardZoomBtn = null;
let facilityInfoCardCloseBtn = null;
let facilityInfoCardMoreBtn = null;
let facilityInfoCardExpanded = false;
let facilityInfoCardAnchor = null;
let pendingIndexUiRefreshHandle = null;
let pendingIndexUiRefreshState = null;
let deferredIndexUiRefreshHandle = null;
let deferredIndexUiRefreshState = null;
let pendingSidebarRefreshHandle = null;
let pendingSidebarRefreshState = null;
let secondarySpatialBuildHandle = null;
let pendingSecondarySpatialBuildReasons = new Set();
let pendingScenarioChunkFlushAfterExactHandle = null;
let deferredHeavyBorderMeshHandle = null;
let deferredContextBaseEnhancementHandle = null;
let scenarioRefreshRuntime = null;
let exactAfterSettleScheduler = null;
let deferContextBaseEnhancements = false;
let detailAdmMeshBuildState = {
  signature: "",
  status: "idle",
};
let visibleInternalBorderMeshSignature = "";
let visibleBorderCountryCodesCache = {
  signature: "",
  codes: new Set(),
};
let contourVisibleSetCache = {
  major: { collectionRef: null, key: "", features: [] },
  minor: { collectionRef: null, key: "", features: [] },
};

function readSearchParam(name) {
  const search = globalThis?.location?.search || "";
  if (!search || !globalThis.URLSearchParams) return "";
  try {
    const params = new globalThis.URLSearchParams(search);
    return String(params.get(name) || "").trim().toLowerCase();
  } catch (_error) {
    return "";
  }
}

function getPoliticalRecoveryQuality() {
  const raw = readSearchParam(POLITICAL_RECOVERY_QUALITY_PARAM);
  const resolved = raw === POLITICAL_RECOVERY_QUALITY_EXACT
    ? POLITICAL_RECOVERY_QUALITY_EXACT
    : POLITICAL_RECOVERY_QUALITY_PROGRESSIVE;
  runtimeState.politicalRecoveryQuality = resolved;
  return resolved;
}

function isRenderDiagEnabled() {
  const raw = readSearchParam(RENDER_DIAG_PARAM);
  return ["1", "true", "yes", "on"].includes(raw);
}

function isPerfOverlayEnabled() {
  const raw = readSearchParam(PERF_OVERLAY_PARAM);
  return ["1", "true", "yes", "on"].includes(raw);
}

function getRenderPassCacheState() {
  return getRenderCacheOwner().getRenderPassCacheState();
}

function getStrategicOverlayRuntimeOwner() {
  if (strategicOverlayRuntimeOwner) {
    return strategicOverlayRuntimeOwner;
  }
  strategicOverlayRuntimeOwner = createStrategicOverlayRuntimeOwner({
    state,
    constants: {
      defaultOperationGraphicKind: DEFAULT_OPERATION_GRAPHIC_KIND,
      defaultOperationalLineKind: DEFAULT_OPERATIONAL_LINE_KIND,
      defaultSpecialZoneType: DEFAULT_SPECIAL_ZONE_TYPE,
      defaultCounterAttachmentKind: STRATEGIC_COUNTER_ATTACHMENT_KIND,
      defaultHitSnapRadiusClickPx: HIT_SNAP_RADIUS_CLICK_PX,
      defaultUnitCounterEquipmentPct: DEFAULT_UNIT_COUNTER_EQUIPMENT_PCT,
      defaultUnitCounterMilstdSidc: DEFAULT_MILSTD_SIDC,
      defaultUnitCounterOrganizationPct: DEFAULT_UNIT_COUNTER_ORGANIZATION_PCT,
      defaultUnitCounterPresetId: DEFAULT_UNIT_COUNTER_PRESET_ID,
      defaultUnitCounterRenderer: DEFAULT_UNIT_COUNTER_RENDERER,
    },
    helpers: {
      assignUnitCounterEditorFromCounter,
      canonicalCountryCode,
      captureHistoryState,
      commitHistoryEntry,
      ensureManualSpecialZoneCounter,
      ensureOperationGraphicCounter,
      ensureOperationGraphicsEditorState,
      ensureOperationalLineCounter,
      ensureOperationalLineEditorState,
      ensureSpecialZoneEditorState,
      ensureUnitCounterCounter,
      ensureUnitCounterEditorState,
      getDisplayOwnerCode,
      getFeatureOwnerCode,
      getHitFromEvent,
      getMapLonLatFromEvent,
      getManualSpecialZoneFeatures,
      getNormalizedUnitCounterCombatState,
      getOperationGraphicById,
      getOperationGraphicMinPoints,
      getOperationalLineById,
      getOperationalLineMinPoints,
      getUnitCounterCardModel,
      getUnitCounterPresetById,
      markDirty,
      normalizeOperationGraphicOpacity,
      normalizeOperationGraphicStroke,
      normalizeOperationGraphicStylePreset,
      normalizeOperationGraphicWidth,
      normalizeOperationalLineStylePreset,
      normalizeSpecialZoneLayersState,
      normalizeUnitCounterBaseFillColor,
      normalizeUnitCounterNationSource,
      normalizeUnitCounterSizeToken,
      normalizeUnitCounterStatPercent,
      normalizeUnitCounterStatsPresetId,
      refreshSpecialZonesWorkbenchUi,
      renderNow: () => {
        if (rendererSurfaceHost.getContext()) render();
      },
      renderOperationGraphicsIfNeeded,
      renderSpecialZonesIfNeeded,
      renderSpecialZoneEditorOverlay,
      resetUnitCounterEditorState,
      showToast,
      t,
      updateSpecialZoneEditorUI,
      updateSpecialZoneLayerMembership,
      updateStrategicOverlayUi,
    },
  });
  return strategicOverlayRuntimeOwner;
}

function getUrbanLayerCapability(...args) {
  return getContextLayerResolverOwner().getUrbanLayerCapability(...args);
}

function getPoliticalFeatureCollection(...args) { return getPoliticalCollectionOwner().getPoliticalFeatureCollection(...args); }
function composePoliticalFeatures(...args) { return getPoliticalCollectionOwner().composePoliticalFeatures(...args); }
function composePoliticalFeatureCollections(...args) { return getPoliticalCollectionOwner().composePoliticalFeatureCollections(...args); }
function collectCountryCoverageStats(...args) { return getPoliticalCollectionOwner().collectCountryCoverageStats(...args); }
function buildInteractiveLandData(...args) { return getPoliticalCollectionOwner().buildInteractiveLandData(...args); }
function getLayerFeatureCollection(...args) { return getContextLayerResolverOwner().getLayerFeatureCollection(...args); }
function ensureLayerDataFromTopology(...args) { return getContextLayerResolverOwner().ensureLayerDataFromTopology(...args); }
function getScenarioBathymetryTopologyUrl(...args) { return getRendererAssetUrlPolicyOwner().getScenarioBathymetryTopologyUrl(...args); }
function getDesiredBathymetryTopologyUrl(...args) { return getRendererAssetUrlPolicyOwner().getDesiredBathymetryTopologyUrl(...args); }
function buildFacilityTooltipText(...args) { return getFacilitySurfaceOwner().buildFacilityTooltipText(...args); }

function buildCountryParentBorderMeshes(...args) { return getBorderMeshOwner().buildCountryParentBorderMeshes(...args); }
function buildDetailAdmBorderMesh(...args) { return getBorderMeshOwner().buildDetailAdmBorderMesh(...args); }
function buildGlobalCoastlineMesh(...args) { return getBorderMeshOwner().buildGlobalCoastlineMesh(...args); }
function buildGlobalCountryBorderMesh(...args) { return getBorderMeshOwner().buildGlobalCountryBorderMesh(...args); }
function buildSourceBorderMeshes(...args) { return getBorderMeshOwner().buildSourceBorderMeshes(...args); }
function getSourceCountrySets(...args) { return getBorderMeshOwner().getSourceCountrySets(...args); }
function resolveCoastlineTopologySource(...args) { return getBorderMeshOwner().resolveCoastlineTopologySource(...args); }
function simplifyCoastlineMesh(...args) { return getBorderMeshOwner().simplifyCoastlineMesh(...args); }

function buildIndex(...args) { return getSpatialIndexRuntimeOwner().buildIndex(...args); }
function buildIndexChunked(...args) { return getSpatialIndexRuntimeOwner().buildIndexChunked(...args); }
function buildSpatialIndex(...args) { return getSpatialIndexRuntimeOwner().buildSpatialIndex(...args); }
function buildSpatialIndexChunked(...args) { return getSpatialIndexRuntimeOwner().buildSpatialIndexChunked(...args); }

function appendOperationalLineVertexFromEvent(...args) { return getStrategicOverlayRuntimeOwner().appendOperationalLineVertexFromEvent(...args); }
function appendOperationGraphicVertexFromEvent(...args) { return getStrategicOverlayRuntimeOwner().appendOperationGraphicVertexFromEvent(...args); }
function appendSpecialZoneVertexFromEvent(...args) { return getStrategicOverlayRuntimeOwner().appendSpecialZoneVertexFromEvent(...args); }
function placeUnitCounterFromEvent(...args) { return getStrategicOverlayRuntimeOwner().placeUnitCounterFromEvent(...args); }
function startOperationalLineDraw(...args) { return getStrategicOverlayRuntimeOwner().startOperationalLineDraw(...args); }
function undoOperationalLineVertex(...args) { return getStrategicOverlayRuntimeOwner().undoOperationalLineVertex(...args); }
function finishOperationalLineDraw(...args) { return getStrategicOverlayRuntimeOwner().finishOperationalLineDraw(...args); }
function cancelOperationalLineDraw(...args) { return getStrategicOverlayRuntimeOwner().cancelOperationalLineDraw(...args); }
function selectOperationalLineById(...args) { return getStrategicOverlayRuntimeOwner().selectOperationalLineById(...args); }
function deleteSelectedOperationalLine(...args) { return getStrategicOverlayRuntimeOwner().deleteSelectedOperationalLine(...args); }
function updateSelectedOperationalLine(...args) { return getStrategicOverlayRuntimeOwner().updateSelectedOperationalLine(...args); }
function startOperationGraphicDraw(...args) { return getStrategicOverlayRuntimeOwner().startOperationGraphicDraw(...args); }
function undoOperationGraphicVertex(...args) { return getStrategicOverlayRuntimeOwner().undoOperationGraphicVertex(...args); }
function finishOperationGraphicDraw(...args) { return getStrategicOverlayRuntimeOwner().finishOperationGraphicDraw(...args); }
function cancelOperationGraphicDraw(...args) { return getStrategicOverlayRuntimeOwner().cancelOperationGraphicDraw(...args); }
function selectOperationGraphicById(...args) { return getStrategicOverlayRuntimeOwner().selectOperationGraphicById(...args); }
function deleteSelectedOperationGraphic(...args) { return getStrategicOverlayRuntimeOwner().deleteSelectedOperationGraphic(...args); }
function deleteSelectedOperationGraphicVertex(...args) { return getStrategicOverlayRuntimeOwner().deleteSelectedOperationGraphicVertex(...args); }
function updateSelectedOperationGraphic(...args) { return getStrategicOverlayRuntimeOwner().updateSelectedOperationGraphic(...args); }
function startUnitCounterPlacement(...args) { return getStrategicOverlayRuntimeOwner().startUnitCounterPlacement(...args); }
function cancelUnitCounterPlacement(...args) { return getStrategicOverlayRuntimeOwner().cancelUnitCounterPlacement(...args); }
function cancelActiveStrategicInteractionModes(...args) { return getStrategicOverlayRuntimeOwner().cancelActiveStrategicInteractionModes(...args); }
function selectUnitCounterById(...args) { return getStrategicOverlayRuntimeOwner().selectUnitCounterById(...args); }
function deleteSelectedUnitCounter(...args) { return getStrategicOverlayRuntimeOwner().deleteSelectedUnitCounter(...args); }
function updateSelectedUnitCounter(...args) { return getStrategicOverlayRuntimeOwner().updateSelectedUnitCounter(...args); }
function getUnitCounterPreviewData(...args) { return getStrategicOverlayRuntimeOwner().getUnitCounterPreviewData(...args); }
function resolveUnitCounterNationForPlacement(...args) { return getStrategicOverlayRuntimeOwner().resolveUnitCounterNationForPlacement(...args); }
function startSpecialZoneDraw(...args) { return getStrategicOverlayRuntimeOwner().startSpecialZoneDraw(...args); }
function undoSpecialZoneVertex(...args) { return getStrategicOverlayRuntimeOwner().undoSpecialZoneVertex(...args); }
function finishSpecialZoneDraw(...args) { return getStrategicOverlayRuntimeOwner().finishSpecialZoneDraw(...args); }
function cancelSpecialZoneDraw(...args) { return getStrategicOverlayRuntimeOwner().cancelSpecialZoneDraw(...args); }
function deleteSelectedManualSpecialZone(...args) { return getStrategicOverlayRuntimeOwner().deleteSelectedManualSpecialZone(...args); }
function selectSpecialZoneById(...args) { return getStrategicOverlayRuntimeOwner().selectSpecialZoneById(...args); }

function getSidebarPerfState() {
  return ensureSidebarPerfState(state);
}

function resetProjectedBoundsCacheState() {
  resetProjectedBoundsRuntimeCacheState(state);
}

function getRenderPerfMetricsRuntimeOwner() {
  if (renderPerfMetricsRuntimeOwner) return renderPerfMetricsRuntimeOwner;
  renderPerfMetricsRuntimeOwner = createRenderPerfMetricsRuntimeOwner({
    constants: { contextBreakdownMetricNames: CONTEXT_BREAKDOWN_METRIC_NAMES },
    getters: {
      getRenderPerfContextBreakdownSnapshot: () => (
        captureRenderPerfContextBreakdownState(runtimeState)
      ),
      getRenderPerfMetricSequence: () => runtimeState.renderPerfMetricSequence,
      nowMs: () => Date.now(),
    },
    effects: {
      ensureRenderPerfMetricsState: () => ensureRenderPerfMetricsState(runtimeState),
      commitRenderPerfMetricState: (payload) => commitRenderPerfMetricState(runtimeState, payload),
      setRenderPerfContextBreakdownState: (breakdown) => setRenderPerfContextBreakdownState(runtimeState, breakdown),
      mirrorRenderPerfMetrics: mirrorRenderPerfMetricSnapshot,
    },
  });
  return renderPerfMetricsRuntimeOwner;
}

function recordRenderPerfMetric(name, durationMs, details = {}) { return getRenderPerfMetricsRuntimeOwner().recordRenderPerfMetric(name, durationMs, details); }

function beginContextMetricSession() { return getRenderPerfMetricsRuntimeOwner().beginContextMetricSession(); }

function collectContextMetric(name, durationMs, details = {}) { return getRenderPerfMetricsRuntimeOwner().collectContextMetric(name, durationMs, details); }

function endContextMetricSession() { return getRenderPerfMetricsRuntimeOwner().endContextMetricSession(); }

function resetContextBreakdownForExactFrame() { return getRenderPerfMetricsRuntimeOwner().resetContextBreakdownForExactFrame(); }

function mirrorRenderPerfMetricSnapshot(name) {
  const normalizedName = String(name || "").trim();
  if (!normalizedName) return false;
  if (
    !renderPerfMetricsMirrorRuntime.snapshot
    || globalThis.__renderPerfMetrics !== renderPerfMetricsMirrorRuntime.snapshot
  ) {
    renderPerfMetricsMirrorRuntime.snapshot = captureRenderPerfMetricsState(runtimeState) || {};
  } else {
    const entry = captureRenderPerfMetricEntryState(runtimeState, normalizedName);
    if (entry === undefined) delete renderPerfMetricsMirrorRuntime.snapshot[normalizedName];
    else renderPerfMetricsMirrorRuntime.snapshot[normalizedName] = entry;
  }
  globalThis.__renderPerfMetrics = renderPerfMetricsMirrorRuntime.snapshot;
  return true;
}

function incrementPerfCounter(counterName, amount = 1) {
  const cache = getRenderPassCacheState();
  cache.counters[counterName] = (Number(cache.counters[counterName]) || 0) + Number(amount || 0);
}

function recordInteractionDurationMetric(name, durationMs, details = {}) {
  const normalizedName = String(name || "").trim();
  if (!normalizedName) return null;
  const normalizedEventType = String(details.eventType || "unknown").trim().toLowerCase() || "unknown";
  const normalizedDuration = Math.max(0, Number(durationMs) || 0);
  const counterName = `${normalizedName}Count`;
  incrementPerfCounter(counterName);
  const callCount = Number(getRenderPassCacheState().counters[counterName] || 0);
  const isHoverMetric = normalizedEventType === "hover";
  const isSlowHoverMetric = isHoverMetric && normalizedDuration >= HOVER_INTERACTION_SLOW_SAMPLE_MS;
  const shouldRecord = !isHoverMetric
    || isSlowHoverMetric
    || callCount % HOVER_INTERACTION_METRIC_SAMPLE_RATE === 0;
  if (!shouldRecord) return null;
  return recordRenderPerfMetric(normalizedName, normalizedDuration, {
    ...details,
    eventType: normalizedEventType,
    sampleRate: isHoverMetric ? HOVER_INTERACTION_METRIC_SAMPLE_RATE : 1,
    slowSample: isSlowHoverMetric,
    callCount,
  });
}

function recordVisibleFrameTransactionMetric(status, details = {}) {
  return getVisibleFrameDiagnosticsOwner().recordVisibleFrameTransaction(status, details).metricEntry;
}

function recordUiRefreshMetric(name, details = {}) {
  recordRenderPerfMetric(name, 0, {
    recordedAt: Date.now(),
    ...details,
  });
}

function unwrapRuntimeHookResult(result) {
  if (Array.isArray(result)) {
    return result.find((entry) => entry && typeof entry === "object") || null;
  }
  return result && typeof result === "object" ? result : null;
}

function resolveContextScenarioReasonSnapshot({
  cache = getRenderPassCacheState(),
  renderPerf = runtimeState.renderPerfMetrics || {},
} = {}) {
  const cacheReason = String(cache.reasons?.contextScenario || "").trim();
  const perfReason = String(renderPerf.contextScenarioExactRefresh?.reason || renderPerf.contextScenarioReuseSkipped?.reason || "").trim();
  const displayReason = cacheReason || perfReason || "-";
  return {
    cacheReason: cacheReason || "-",
    perfReason: perfReason || "-",
    displayReason,
    mismatch: Boolean(cacheReason && perfReason && cacheReason !== perfReason),
  };
}

function detectContextScenarioReasonMismatch({
  cache = getRenderPassCacheState(),
  renderPerf = runtimeState.renderPerfMetrics || {},
} = {}) {
  const reasonSnapshot = resolveContextScenarioReasonSnapshot({ cache, renderPerf });
  if (!reasonSnapshot.mismatch) {
    cache.contextScenarioReasonMismatchSignature = "";
    return reasonSnapshot;
  }
  const signature = `${reasonSnapshot.cacheReason}::${reasonSnapshot.perfReason}`;
  if (cache.contextScenarioReasonMismatchSignature !== signature) {
    cache.contextScenarioReasonMismatchSignature = signature;
    incrementPerfCounter("contextScenarioReasonMismatchWarnings");
    recordRenderPerfMetric("contextScenarioReasonMismatchWarning", 0, {
      cacheReason: reasonSnapshot.cacheReason,
      perfReason: reasonSnapshot.perfReason,
      warningCount: Number(cache.counters.contextScenarioReasonMismatchWarnings || 0),
    });
  }
  return reasonSnapshot;
}

function resetScenarioWaterCacheAdaptiveState(reason = "water-adaptive-state-reset") {
  lastScenarioWaterRenderedCount = 0;
  incrementPerfCounter("waterAdaptiveStateResetCount");
  const previousCount = Math.max(
    0,
    Number(runtimeState.renderPerfMetrics?.waterAdaptiveStateResetCount?.count || 0),
  );
  setRenderPerfMetricEntryState(runtimeState, {
    name: "waterAdaptiveStateResetCount",
    entry: {
      count: previousCount + 1,
      reason: String(reason || "water-adaptive-state-reset"),
      recordedAt: Date.now(),
    },
  });
  mirrorRenderPerfMetricSnapshot("waterAdaptiveStateResetCount");
}

function stableJson(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch (_error) {
    return "";
  }
}

function cloneZoomTransform(transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity) {
  return {
    x: Number(transform?.x || 0),
    y: Number(transform?.y || 0),
    k: Math.max(0.0001, Number(transform?.k || 1)),
  };
}

function getTransformSignature(transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity) {
  const normalized = cloneZoomTransform(transform);
  return [
    normalized.x.toFixed(3),
    normalized.y.toFixed(3),
    normalized.k.toFixed(4),
    Number(runtimeState.width || 0),
    Number(runtimeState.height || 0),
    Number(runtimeState.dpr || 1).toFixed(2),
  ].join("|");
}

function getTransformBucketSignature(transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity) {
  const k = Math.round(Number(transform?.k || 1) * 100);
  const x = Math.round(Number(transform?.x || 0) / 64);
  const y = Math.round(Number(transform?.y || 0) / 64);
  return `${k}:${x}:${y}`;
}

function noteRenderAction(label, startedAt = null) {
  const cache = getRenderPassCacheState();
  cache.lastAction = String(label || "").trim();
  cache.lastActionAt = Date.now();
  const lastFrame = cache.lastFrame && typeof cache.lastFrame === "object" ? cache.lastFrame : null;
  cache.lastActionFrame = lastFrame
    ? {
      phase: lastFrame.phase,
      totalMs: Number(lastFrame.totalMs || 0),
      timings: { ...(lastFrame.timings || {}) },
      transform: cloneZoomTransform(lastFrame.transform),
    }
    : null;
  if (Number.isFinite(startedAt)) {
    cache.lastActionDurationMs = Math.max(0, nowMs() - Number(startedAt));
    recordInteractionDurationMetric("interactionActionDuration", cache.lastActionDurationMs, {
      actionLabel: cache.lastAction,
      eventType: "action",
    });
  }
}

function getRuntimeChunkSelectionVersion() {
  const loadState = runtimeState.runtimeChunkLoadState && typeof runtimeState.runtimeChunkLoadState === "object"
    ? runtimeState.runtimeChunkLoadState
    : null;
  return Math.max(0, Number(loadState?.selectionVersion || 0));
}

function getVisibleContextFlagSignature() {
  return [
    `view:${"ownership"}`,
    `profile:${String(runtimeState.renderProfile || "auto")}`,
    runtimeState.showPhysical ? "physical:on" : "physical:off",
    runtimeState.showUrban ? "urban:on" : "urban:off",
    runtimeState.showRivers ? "rivers:on" : "rivers:off",
    runtimeState.showWaterRegions ? "water:on" : "water:off",
    runtimeState.showOpenOceanRegions ? "open-ocean:on" : "open-ocean:off",
    runtimeState.showScenarioSpecialRegions ? "special:on" : "special:off",
    runtimeState.showScenarioReliefOverlays ? "relief:on" : "relief:off",
    runtimeState.showCityPoints ? "cities:on" : "cities:off",
    runtimeState.showStrategicResourceMarkers ? "strategic-resources:on" : "strategic-resources:off",
    `strategic-rev:${Number(runtimeState.scenarioStrategicValuesRevision || 0)}`,
    `strategic-metric:${String(runtimeState.strategicChoroplethMetric || "")}`,
    runtimeState.showTransport ? "transport:on" : "transport:off",
    runtimeState.showRoad ? "road:on" : "road:off",
    runtimeState.showAirports ? "airports:on" : "airports:off",
    runtimeState.showPorts ? "ports:on" : "ports:off",
    runtimeState.showRail ? "rail:on" : "rail:off",
    runtimeState.deferContextBasePass ? "context-base:deferred" : "context-base:ready",
    `context-rev:${Number(runtimeState.contextLayerRevision || 0)}`,
    `city-rev:${Number(runtimeState.cityLayerRevision || 0)}`,
  ].join("|");
}

function countFeatureCollectionFeatures(collection) {
  return Array.isArray(collection?.features) ? collection.features.length : 0;
}

const resolvedColorCountSnapshot = {
  colorSource: null,
  colorRevision: -1,
  count: 0,
};

function getResolvedColorCountForSceneSnapshot() {
  const colorSource = runtimeState.colors && typeof runtimeState.colors === "object"
    ? runtimeState.colors
    : {};
  const colorRevision = Number(runtimeState.colorRevision || 0);
  if (
    resolvedColorCountSnapshot.colorSource === colorSource
    && resolvedColorCountSnapshot.colorRevision === colorRevision
  ) {
    return resolvedColorCountSnapshot.count;
  }
  resolvedColorCountSnapshot.colorSource = colorSource;
  resolvedColorCountSnapshot.colorRevision = colorRevision;
  resolvedColorCountSnapshot.count = Object.keys(colorSource).length;
  return resolvedColorCountSnapshot.count;
}

function ensureCurrentSceneSnapshot(reason = "visible-frame") {
  const snapshotState = ensureSceneSnapshotState(runtimeState);
  const activeScenarioId = String(runtimeState.activeScenarioId || "");
  if (String(snapshotState.sceneScenarioId || "") !== activeScenarioId) {
    snapshotState.sceneScenarioId = activeScenarioId;
    bumpSceneGenerationState(runtimeState, reason || "active-scenario-change");
  }
  return snapshotState;
}

function getPoliticalSceneReadiness() {
  const cache = getRenderPassCacheState();
  const scenarioPoliticalFeatureCount = countFeatureCollectionFeatures(runtimeState.scenarioPoliticalChunkData);
  const landFeatureCount = Math.max(
    countFeatureCollectionFeatures(runtimeState.landDataFull),
    countFeatureCollectionFeatures(runtimeState.landData),
  );
  const colorCount = getResolvedColorCountForSceneSnapshot();
  const fullPoliticalReady = !!(
    String(runtimeState.activeScenarioId || "")
    && scenarioPoliticalFeatureCount > 0
    && landFeatureCount > 0
    && colorCount > 0
  );
  const politicalPassCurrent = !!(
    Number(cache.politicalPassSceneGeneration || 0) === Number(runtimeState.sceneGeneration || 0)
    && Number(cache.politicalPassScenarioDataGeneration || 0) === Number(runtimeState.scenarioDataGeneration || 0)
  );
  const finePoliticalCacheReady = !!(
    cache.politicalPassFineCacheReady
    && cache.politicalPassDataStage === "fine"
    && politicalPassCurrent
  );
  const politicalDataStage = finePoliticalCacheReady
    ? "fine"
    : (fullPoliticalReady ? (politicalPassCurrent ? String(cache.politicalPassDataStage || "data-ready") : "data-ready") : "not-ready");
  return {
    politicalDataStage,
    fullPoliticalReady,
    finePoliticalCacheReady,
    scenarioPoliticalFeatureCount,
    landFeatureCount,
    colorCount,
  };
}

function getVisibleFrameIdentity(transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity) {
  ensureCurrentSceneSnapshot("visible-frame-identity");
  const politicalReadiness = getPoliticalSceneReadiness();
  return {
    sceneGeneration: Math.max(0, Number(runtimeState.sceneGeneration || 0)),
    scenarioDataGeneration: Math.max(0, Number(runtimeState.scenarioDataGeneration || 0)),
    scenarioId: String(runtimeState.activeScenarioId || ""),
    selectionVersion: getRuntimeChunkSelectionVersion(),
    topologyRevision: Math.max(0, Number(runtimeState.topologyRevision || 0)),
    dpr: Math.max(1, Number(runtimeState.dpr || 1)),
    pixelWidth: Math.max(1, Number(rendererSurfaceHost.getContext()?.canvas?.width || 1)),
    pixelHeight: Math.max(1, Number(rendererSurfaceHost.getContext()?.canvas?.height || 1)),
    colorRevision: Number(runtimeState.colorRevision || 0),
    contextFlagSignature: getVisibleContextFlagSignature(),
    transformBucket: getTransformBucketSignature(transform),
    politicalDataStage: politicalReadiness.politicalDataStage,
    fullPoliticalReady: politicalReadiness.fullPoliticalReady,
    finePoliticalCacheReady: politicalReadiness.finePoliticalCacheReady,
    transform: cloneZoomTransform(transform),
  };
}

function getCommittedFrameKeySignature(commitKey = {}) {
  return [
    String(commitKey.scenarioId || ""),
    Number(commitKey.sceneGeneration || 0),
    Number(commitKey.scenarioDataGeneration || 0),
    Number(commitKey.selectionVersion || 0),
    Number(commitKey.topologyRevision || 0),
    Number(commitKey.colorRevision || 0),
    String(commitKey.contextFlagSignature || ""),
    Number(commitKey.dpr || 1).toFixed(2),
    Number(commitKey.pixelWidth || 0),
    Number(commitKey.pixelHeight || 0),
  ].join("::");
}

function getCommittedFrameIdentity(transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity, metadata = {}) {
  const identity = getVisibleFrameIdentity(transform);
  const cache = getRenderPassCacheState();
  const commitKey = {
    scenarioId: identity.scenarioId,
    sceneGeneration: identity.sceneGeneration,
    scenarioDataGeneration: identity.scenarioDataGeneration,
    selectionVersion: identity.selectionVersion,
    topologyRevision: identity.topologyRevision,
    colorRevision: identity.colorRevision,
    contextFlagSignature: identity.contextFlagSignature,
    dpr: identity.dpr,
    pixelWidth: identity.pixelWidth,
    pixelHeight: identity.pixelHeight,
  };
  return {
    commitKey,
    metadata: {
      politicalDataStage: identity.politicalDataStage,
      fullPoliticalReady: identity.fullPoliticalReady,
      finePoliticalCacheReady: identity.finePoliticalCacheReady,
      referenceTransform: cloneZoomTransform(transform),
      transformBucket: identity.transformBucket,
      passSignature: getRenderPassSignature("political", transform),
      dirtyReasons: { ...(cache.reasons || {}) },
      resourcesReady: {
        politicalPassCurrent: !cache.dirty?.political,
        fullPoliticalReady: identity.fullPoliticalReady,
        finePoliticalCacheReady: identity.finePoliticalCacheReady,
      },
      ...metadata,
    },
  };
}

function clearLastGoodFrame(reason = "clear") {
  return getRenderCacheOwner().clearLastGoodFrame(reason);
}

function recordLastGoodFrameInvalidationSummary(summary = {}) {
  const lastGoodFrame = summary.effects?.lastGoodFrame || summary.lastGoodFrame || {};
  const hostFollowUps = summary.effects?.hostFollowUps || {};
  if (!lastGoodFrame.invalidated && !summary.lastGoodFrameInvalidated) return;
  if (hostFollowUps.needsContinuityMetric === false && !summary.lastGoodFrameInvalidated) return;
  recordRenderPerfMetric("continuityFrameMarkedStale", 0, {
    reason: lastGoodFrame.reason || summary.reason || "visual-invalidation",
    activeScenarioId: String(runtimeState.activeScenarioId || ""),
  });
}

function invalidateInteractionComposite(reason = "interaction-composite-invalidation") {
  return getRenderCacheOwner().invalidateInteractionComposite(reason);
}

function getMutationPassNames(mutation = {}) {
  if (Array.isArray(mutation.normalizedPassNames)) return mutation.normalizedPassNames;
  return Array.isArray(mutation.targetPassNames) ? mutation.targetPassNames : [];
}

function applyRenderPassInvalidationEffects(mutation = {}) {
  const targetPassNames = getMutationPassNames(mutation);
  const reason = mutation.reason || "unspecified";
  const hostFollowUps = mutation.effects?.hostFollowUps || {};
  if (hostFollowUps.needsRenderPassDiagnostics || targetPassNames.length) {
    recordRenderPassInvalidationDiagnostics(runtimeState, targetPassNames, reason);
  }
  recordLastGoodFrameInvalidationSummary(mutation);
  const cache = getRenderPassCacheState();
  if (
    (hostFollowUps.needsPoliticalPathCacheInvalidation || targetPassNames.includes("political"))
    && !POLITICAL_PATH_CACHE_PRESERVING_INVALIDATION_REASONS.has(String(reason || "unspecified"))
  ) {
    cache.partialPoliticalDirtyIds.clear();
    cancelScenarioPoliticalBackgroundDeferredFullCache(reason);
    invalidatePoliticalPathCache(reason);
  }
  if (hostFollowUps.needsInteractionBorderSnapshotInvalidation || targetPassNames.includes("borders")) {
    invalidateInteractionBorderSnapshot(reason);
  }
  return mutation;
}

function invalidateRenderPasses(passNames, reason = "unspecified") {
  return applyRenderPassInvalidationEffects(getRenderCacheOwner().invalidateRenderPasses(passNames, reason));
}

function invalidateAllRenderPasses(reason = "unspecified") {
  return applyRenderPassInvalidationEffects(getRenderCacheOwner().invalidateAllRenderPasses(reason));
}

function releaseDeferredContextBasePass(reason = "deferred-context-release") {
  const normalizedReason = String(reason || "deferred-context-release").trim() || "deferred-context-release";
  if (!runtimeState.deferContextBasePass) {
    return false;
  }
  const hadStagedContextBaseHandle = !!runtimeState.stagedContextBaseHandle;
  runtimeState.deferContextBasePass = false;
  cancelDeferredWork(runtimeState.stagedContextBaseHandle);
  runtimeState.stagedContextBaseHandle = null;
  if (hadStagedContextBaseHandle && runtimeState.deferHitCanvasBuild) {
    scheduleStagedHitCanvasWarmup(nowMs(), Number(runtimeState.stagedMapDataToken || 0));
  }
  invalidateRenderPasses(["contextBase", "contextMarkers"], normalizedReason);
  clearRenderPassReferenceTransforms(["contextBase", "contextMarkers"]);
  requestRendererRender(normalizedReason, {
    flush: true,
    fallback: () => {
      if (rendererSurfaceHost.getContext()) render();
    },
  });
  recordRenderPerfMetric("releaseDeferredContextBasePass", 0, {
    canceledStagedContextBase: hadStagedContextBaseHandle,
    released: true,
    reason: normalizedReason,
  });
  return true;
}

registerRuntimeHook(runtimeState, "releaseDeferredContextBasePassFn", releaseDeferredContextBasePass);

const INTENSITY_FIELD_TOOL_CHANNELS = new Set(INTENSITY_FIELD_CHANNEL_IDS);
const INTENSITY_FIELD_TOOL_SUBMODES = new Set(["paint", "erase", "points"]);

function normalizeIntensityFieldToolState(next = {}, current = runtimeState.intensityFieldTool) {
  const defaults = createDefaultIntensityFieldToolState();
  const source = current && typeof current === "object" ? current : defaults;
  const draft = next && typeof next === "object" ? next : {};
  const channelId = INTENSITY_FIELD_TOOL_CHANNELS.has(String(draft.channelId || source.channelId || ""))
    ? String(draft.channelId || source.channelId)
    : defaults.channelId;
  const subMode = INTENSITY_FIELD_TOOL_SUBMODES.has(String(draft.subMode || source.subMode || ""))
    ? String(draft.subMode || source.subMode)
    : defaults.subMode;
  return {
    active: draft.active === undefined ? !!source.active : !!draft.active,
    channelId,
    subMode,
    brushRadiusDeg: clamp(Number.isFinite(Number(draft.brushRadiusDeg)) ? Number(draft.brushRadiusDeg) : Number(source.brushRadiusDeg || defaults.brushRadiusDeg), 0.25, 30),
    brushStrength: clamp(Number.isFinite(Number(draft.brushStrength)) ? Number(draft.brushStrength) : Number(source.brushStrength || defaults.brushStrength), INTENSITY_FIELD_GRID.min, INTENSITY_FIELD_GRID.max),
    selectedPointId: String(draft.selectedPointId === undefined ? (source.selectedPointId || "") : (draft.selectedPointId || "")),
  };
}

function getIntensityFieldTool() {
  runtimeState.intensityFieldTool = normalizeIntensityFieldToolState();
  return runtimeState.intensityFieldTool;
}

function setIntensityFieldTool(next = {}) {
  runtimeState.intensityFieldTool = normalizeIntensityFieldToolState(next);
  if (runtimeState.intensityFieldTool.active) {
    runtimeState.currentTool = "physical-intensity-field";
    runtimeState.brushModeEnabled = false;
    if (runtimeState.specialZoneEditor && typeof runtimeState.specialZoneEditor === "object") {
      runtimeState.specialZoneEditor.active = false;
    }
  }
  callRuntimeHooks(runtimeState, ["updateToolUIFn", "updateToolbarInputsFn"]);
  return runtimeState.intensityFieldTool;
}

registerRuntimeHook(runtimeState, "setIntensityFieldToolFn", setIntensityFieldTool);

function isBootInteractionReady() {
  return String(runtimeState.bootPhase || "").trim().toLowerCase() === "ready" && !runtimeState.bootBlocking;
}

function clearRenderPassReferenceTransforms(passNames = null) {
  const mutation = getRenderCacheOwner().clearRenderPassReferenceTransforms(passNames);
  const hostFollowUps = mutation.effects?.hostFollowUps || {};
  if (hostFollowUps.needsPoliticalPathCacheInvalidation || mutation.politicalPathCacheInvalidated) {
    invalidatePoliticalPathCache(mutation.reason || "clear-reference-transform");
  }
  if (hostFollowUps.needsInteractionBorderSnapshotInvalidation || mutation.interactionBorderSnapshotInvalidated) {
    invalidateInteractionBorderSnapshot(mutation.reason || "clear-reference-transform");
  }
  return mutation;
}

function invalidateOceanVisualState(reason = "ocean-visual") {
  cancelExactAfterSettleRefresh({ clearDefer: true });
  invalidateRenderPasses(["background", "physicalBase", "political", "contextBase", "contextScenario"], reason);
  clearRenderPassReferenceTransforms(["background", "physicalBase", "political", "contextBase", "contextScenario", "effects", "lineEffects", "contextMarkers", "dayNight", "textureLabels"]);
}

function invalidateOceanBackgroundVisualState(reason = "ocean-background") {
  cancelExactAfterSettleRefresh({ clearDefer: true });
  invalidateRenderPasses(["background", "physicalBase", "political", "contextBase", "contextScenario"], reason);
  clearRenderPassReferenceTransforms(["background", "physicalBase", "political", "contextBase", "contextScenario"]);
}

function invalidateOceanWaterInteractionVisualState(reason = "ocean-water-interaction") {
  resetScenarioWaterCacheAdaptiveState(reason);
  cancelExactAfterSettleRefresh({ clearDefer: true });
  invalidateRenderPasses(["background", "physicalBase", "contextScenario"], reason);
  clearRenderPassReferenceTransforms(["background", "physicalBase", "contextScenario"]);
}

function invalidateOceanCoastalAccentVisualState(reason = "ocean-coastal-accent") {
  cancelExactAfterSettleRefresh({ clearDefer: true });
  invalidateRenderPasses("borders", reason);
  clearRenderPassReferenceTransforms("borders");
}

function getRenderPassLayout(passName) {
  return getRenderCacheOwner().getRenderPassLayout(passName);
}

function resizeRenderPassCanvases(passNames = RENDER_PASS_NAMES) {
  return getRenderCacheOwner().resizeRenderPassCanvases(passNames);
}

function ensureRenderPassCanvas(passName) {
  return getRenderCacheOwner().ensureRenderPassCanvas(passName);
}

function ensureLastGoodFrameCanvas() {
  return getRenderCacheOwner().ensureLastGoodFrameCanvas();
}

function ensureInteractionCompositeCanvas() {
  return getRenderCacheOwner().ensureInteractionCompositeCanvas();
}

function ensureCompositeBufferCanvas() {
  return getRenderCacheOwner().ensureCompositeBufferCanvas();
}

function getInteractionCompositeSignature(cache = getRenderPassCacheState()) {
  return getRenderCacheOwner().getInteractionCompositeSignature(cache);
}

function getInteractionCompositeReuseDecision(
  currentTransform,
  cache = getRenderPassCacheState(),
  options = {},
) {
  return getRenderCacheOwner().getInteractionCompositeReuseDecision(currentTransform, cache, options);
}

function canDrawInteractionComposite(currentTransform, cache = getRenderPassCacheState()) {
  return getRenderCacheOwner().canDrawInteractionComposite(currentTransform, cache);
}

function captureLastGoodFrame(reason = "frame", transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity) {
  if (!rendererSurfaceHost.getContext()?.canvas) return false;
  const targetCanvas = ensureLastGoodFrameCanvas();
  const targetContext = targetCanvas.getContext("2d");
  if (!targetContext) return false;
  targetContext.setTransform(1, 0, 0, 1, 0, 0);
  targetContext.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
  targetContext.drawImage(rendererSurfaceHost.getContext().canvas, 0, 0);
  const cache = getRenderPassCacheState();
  const committedFrameIdentity = getCommittedFrameIdentity(transform, {
    status: "committed",
    reason: String(reason || "frame"),
    paintSource: "last-good-capture",
  });
  const identity = committedFrameIdentity.commitKey;
  cache.lastGoodFrame.referenceTransform = cloneZoomTransform(transform);
  cache.lastGoodFrame.commitKey = { ...identity };
  cache.lastGoodFrame.commitKeySignature = getCommittedFrameKeySignature(identity);
  cache.lastGoodFrame.committedFrameIdentity = committedFrameIdentity;
  cache.lastGoodFrame.metadata = { ...(committedFrameIdentity.metadata || {}) };
  cache.lastGoodFrame.capturedAt = Date.now();
  cache.lastGoodFrame.invalidatedAt = 0;
  cache.lastGoodFrame.valid = true;
  cache.lastGoodFrame.stale = false;
  cache.lastGoodFrame.reason = String(reason || "frame");
  cache.lastGoodFrame.staleReason = "";
  cache.lastGoodFrame.rejectedReason = "";
  cache.lastGoodFrame.scenarioId = identity.scenarioId;
  cache.lastGoodFrame.sceneGeneration = identity.sceneGeneration;
  cache.lastGoodFrame.scenarioDataGeneration = identity.scenarioDataGeneration;
  cache.lastGoodFrame.selectionVersion = identity.selectionVersion;
  cache.lastGoodFrame.contextFlagSignature = identity.contextFlagSignature;
  cache.lastGoodFrame.topologyRevision = identity.topologyRevision;
  cache.lastGoodFrame.colorRevision = identity.colorRevision;
  cache.lastGoodFrame.dpr = identity.dpr;
  cache.lastGoodFrame.pixelWidth = identity.pixelWidth;
  cache.lastGoodFrame.pixelHeight = identity.pixelHeight;
  cache.lastGoodFrame.politicalDataStage = String(committedFrameIdentity.metadata?.politicalDataStage || "unknown");
  cache.lastGoodFrame.fullPoliticalReady = !!committedFrameIdentity.metadata?.fullPoliticalReady;
  cache.lastGoodFrame.finePoliticalCacheReady = !!committedFrameIdentity.metadata?.finePoliticalCacheReady;
  recordVisibleFrameTransactionMetric("committed", {
    reason: String(reason || "frame"),
    paintSource: "last-good-capture",
    transform,
    committedFrameIdentity,
  });
  return true;
}

function noteMissingVisibleFrame(reason = "unknown", { recordTransaction = true } = {}) {
  incrementPerfCounter("missingVisibleFrameCount");
  const cache = getRenderPassCacheState();
  const count = Number(cache.counters.missingVisibleFrameCount || 0);
  recordRenderPerfMetric("missingVisibleFrameCount", 0, {
    count,
    reason: String(reason || "unknown"),
    activeScenarioId: String(runtimeState.activeScenarioId || ""),
  });
  if (!recordTransaction) return;
  recordVisibleFrameTransactionMetric("missing", {
    reason: String(reason || "unknown"),
    paintSource: "missing-visible-frame",
  });
}

function noteMissingVisibleFrameSkippedDuringInteraction(reason = "unknown") {
  incrementPerfCounter("missingVisibleFrameSkippedDuringInteraction");
  const cache = getRenderPassCacheState();
  const count = Number(cache.counters.missingVisibleFrameSkippedDuringInteraction || 0);
  recordRenderPerfMetric("missingVisibleFrameSkippedDuringInteraction", 0, {
    count,
    reason: String(reason || "unknown"),
    activeScenarioId: String(runtimeState.activeScenarioId || ""),
    phase: String(runtimeState.renderPhase || ""),
  });
  recordVisibleFrameTransactionMetric("missing", {
    reason: String(reason || "unknown"),
    paintSource: "interaction-skip",
  });
}

function getFirstVisiblePoliticalFrameBlockReason(reason = "visible-frame") {
  const activeScenarioId = String(runtimeState.activeScenarioId || "").trim();
  if (!activeScenarioId) return "";
  const normalizedReason = String(reason || "visible-frame");
  if (normalizedReason === "base-visible-fallback") {
    return "base-visible-fallback";
  }
  if (normalizedReason !== "exact-frame") {
    return `${normalizedReason}-before-current-political-frame`;
  }
  const cache = getRenderPassCacheState();
  if (cache.dirty?.political) {
    return "dirty-political-pass";
  }
  const transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity;
  const expectedSignature = getRenderPassSignature("political", transform);
  if (String(cache.signatures?.political || "") !== String(expectedSignature || "")) {
    const cachedOceanFill = getCachedPoliticalPassStaticSignature(cache.signatures?.political)
      .split("::")
      .find((part) => String(part || "").startsWith("ocean-fill:"));
    if (cachedOceanFill && cachedOceanFill !== `ocean-fill:${getOceanBaseFillColor()}`) {
      return "stale-ocean-fill";
    }
    return "stale-political-signature";
  }
  const referenceTransform = getPassReferenceTransform("political");
  if (!referenceTransform || !areZoomTransformsEquivalent(referenceTransform, transform)) {
    return "stale-political-reference-transform";
  }
  if (String(cache.politicalPassDataStage || "") === "fine" && cache.politicalPassFineCacheReady) {
    const fullReferenceTransform = getPassFullReferenceTransform("political");
    if (!fullReferenceTransform || !areZoomTransformsEquivalent(fullReferenceTransform, transform)) {
      return "stale-political-full-reference-transform";
    }
  }
  return "";
}

function noteFirstVisibleFrameBlocked(reason = "visible-frame", blockReason = "unknown") {
  getVisibleFrameDiagnosticsOwner().recordFirstVisibleFrameBlocked(reason, blockReason);
}

function markFirstVisibleFramePainted(reason = "visible-frame") {
  getVisibleFrameDiagnosticsOwner().markFirstVisibleFramePainted(reason);
}

function resetFirstVisibleFramePainted(reason = "visible-frame-reset") {
  getVisibleFrameDiagnosticsOwner().resetFirstVisibleFramePainted(reason);
}

function canDrawBaseVisibleFrameFallback() {
  return !runtimeState.firstVisibleFramePainted || !Array.isArray(runtimeState.landData?.features) || runtimeState.landData.features.length === 0;
}

function drawBaseVisibleFrameFallback(reason = "base-fill") {
  if (!rendererSurfaceHost.getContext()?.canvas) return false;
  if (runtimeState.renderPhase === RENDER_PHASE_INTERACTING && runtimeState.firstVisibleFramePainted) {
    noteMissingVisibleFrameSkippedDuringInteraction(`${reason}-skipped-during-interaction`);
    return false;
  }
  if (!canDrawBaseVisibleFrameFallback()) {
    return false;
  }
  resetMainCanvas();
  rendererSurfaceHost.getContext().save();
  rendererSurfaceHost.getContext().setTransform(1, 0, 0, 1, 0, 0);
  rendererSurfaceHost.getContext().fillStyle = getOceanBaseFillColor();
  rendererSurfaceHost.getContext().fillRect(0, 0, rendererSurfaceHost.getContext().canvas.width, rendererSurfaceHost.getContext().canvas.height);
  rendererSurfaceHost.getContext().restore();
  noteMissingVisibleFrame(reason, { recordTransaction: false });
  recordVisibleFrameTransactionMetric("committed", {
    reason: String(reason || "base-visible-fallback"),
    paintSource: "base-visible-fallback",
  });
  return true;
}

function drawLastGoodFrameFallback(currentTransform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity) {
  const cache = getRenderPassCacheState();
  const fallbackCanvas = cache.lastGoodFrame?.canvas;
  const referenceTransform = cache.lastGoodFrame?.referenceTransform;
  const frame = cache.lastGoodFrame || {};
  if (!fallbackCanvas || !frame.valid || !referenceTransform) {
    return false;
  }
  const identity = getVisibleFrameIdentity(currentTransform);
  const currentCommittedFrameIdentity = getCommittedFrameIdentity(currentTransform, {
    status: "reused",
    reason: String(frame.reason || "last-good-frame"),
    paintSource: "last-good-frame",
  });
  const staleSince = frame.stale && Number(frame.invalidatedAt || 0) > 0
    ? Number(frame.invalidatedAt || 0)
    : Number(frame.capturedAt || 0);
  const staleAgeMs = Math.max(0, Date.now() - staleSince);
  const reject = (reason) => {
    frame.rejectedReason = String(reason || "unknown");
    recordRenderPerfMetric("continuityFrameRejected", 0, {
      reason: frame.rejectedReason,
      staleAgeMs,
      activeScenarioId: identity.scenarioId,
    });
    recordVisibleFrameTransactionMetric("rejected", {
      reason: frame.rejectedReason,
      paintSource: "last-good-frame",
      staleAgeMs,
      transform: currentTransform,
      activeScenarioId: identity.scenarioId,
      committedFrameIdentity: currentCommittedFrameIdentity,
    });
    return false;
  };
  if (String(frame.scenarioId || "") !== identity.scenarioId) {
    return reject("scenario-mismatch");
  }
  if (Number(frame.sceneGeneration || 0) !== identity.sceneGeneration) {
    return reject("scene-generation-mismatch");
  }
  if (Number(frame.scenarioDataGeneration || 0) !== identity.scenarioDataGeneration) {
    return reject("scenario-data-generation-mismatch");
  }
  if (Number(frame.selectionVersion || 0) !== identity.selectionVersion) {
    return reject("selection-version-mismatch");
  }
  if (String(frame.contextFlagSignature || "") !== identity.contextFlagSignature) {
    return reject("context-flag-mismatch");
  }
  const framePixelWidth = Math.max(1, Number(frame.pixelWidth || fallbackCanvas.width || 0));
  const framePixelHeight = Math.max(1, Number(frame.pixelHeight || fallbackCanvas.height || 0));
  const canvasSizeMismatch = framePixelWidth !== identity.pixelWidth || framePixelHeight !== identity.pixelHeight;
  if (canvasSizeMismatch) {
    const canRelaxCanvasSize = runtimeState.renderPhase !== RENDER_PHASE_IDLE || runtimeState.deferExactAfterSettle;
    if (!canRelaxCanvasSize) {
      return reject("canvas-size-mismatch");
    }
    recordRenderPerfMetric("continuityFrameRelaxedReuse", 0, {
      reasons: "canvas-size-mismatch",
      staleAgeMs,
      activeScenarioId: identity.scenarioId,
      framePixelWidth,
      framePixelHeight,
      currentPixelWidth: identity.pixelWidth,
      currentPixelHeight: identity.pixelHeight,
    });
  }
  if (Math.abs(Number(frame.dpr || 1) - identity.dpr) > 0.01) {
    recordRenderPerfMetric("continuityFrameRelaxedReuse", 0, {
      reasons: "dpr-mismatch",
      staleAgeMs,
      activeScenarioId: identity.scenarioId,
      frameDpr: Number(frame.dpr || 1),
      currentDpr: identity.dpr,
    });
  }
  if (Number(frame.topologyRevision || 0) !== identity.topologyRevision) {
    return reject("topology-revision-mismatch");
  }
  if (Number(frame.colorRevision || 0) !== identity.colorRevision) {
    return reject("color-revision-mismatch");
  }
  const currentCommitKeySignature = getCommittedFrameKeySignature(currentCommittedFrameIdentity.commitKey);
  if (frame.commitKeySignature && frame.commitKeySignature !== currentCommitKeySignature) {
    return reject("commit-key-mismatch");
  }
  if (frame.stale && staleAgeMs > CONTINUITY_FRAME_MAX_STALE_AGE_MS) {
    return reject("stale-age-limit");
  }
  const current = cloneZoomTransform(currentTransform);
  const reference = cloneZoomTransform(referenceTransform);
  const scaleRatio = current.k / Math.max(reference.k, 0.0001);
  const canvasScaleX = canvasSizeMismatch ? identity.pixelWidth / framePixelWidth : 1;
  const canvasScaleY = canvasSizeMismatch ? identity.pixelHeight / framePixelHeight : 1;
  const dx = current.x - (reference.x * scaleRatio);
  const dy = current.y - (reference.y * scaleRatio);
  resetMainCanvas();
  rendererSurfaceHost.getContext().save();
  rendererSurfaceHost.getContext().setTransform(1, 0, 0, 1, 0, 0);
  rendererSurfaceHost.getContext().translate(dx * runtimeState.dpr, dy * runtimeState.dpr);
  rendererSurfaceHost.getContext().scale(scaleRatio * canvasScaleX, scaleRatio * canvasScaleY);
  rendererSurfaceHost.getContext().drawImage(fallbackCanvas, 0, 0);
  rendererSurfaceHost.getContext().restore();
  incrementPerfCounter("lastGoodFrameReuses");
  if (frame.stale) {
    incrementPerfCounter("continuityFrameReuses");
  }
  recordRenderPerfMetric("dragVisibleStaleFrameMs", staleAgeMs, {
    phase: runtimeState.renderPhase,
    reason: String(frame.reason || "last-good-frame"),
    stale: !!frame.stale,
    staleReason: String(frame.staleReason || ""),
  });
  if (frame.stale) {
    recordRenderPerfMetric("continuityFrameStaleAgeMs", staleAgeMs, {
      reason: String(frame.staleReason || frame.reason || "continuity-frame"),
      activeScenarioId: identity.scenarioId,
    });
  }
  recordVisibleFrameTransactionMetric("reused", {
    reason: String(frame.reason || "last-good-frame"),
    paintSource: "last-good-frame",
    staleAgeMs,
    transform: currentTransform,
    activeScenarioId: identity.scenarioId,
    committedFrameIdentity: frame.committedFrameIdentity || currentCommittedFrameIdentity,
  });
  return true;
}

function buildInteractionBorderSnapshotLayout() {
  return getInteractionBorderSnapshotOwner().buildInteractionBorderSnapshotLayout();
}

function getInteractionBorderSnapshotState() {
  return getInteractionBorderSnapshotOwner().getInteractionBorderSnapshotState();
}

function ensureInteractionBorderSnapshotCanvas() {
  return getInteractionBorderSnapshotOwner().ensureInteractionBorderSnapshotCanvas();
}

function getPoliticalPassStaticSignature(transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity) {
  return [
    getTransformSignature(transform),
    runtimeState.topologyRevision || 0,
    `ocean-fill:${getOceanBaseFillColor()}`,
    debugMode,
    runtimeState.topologyBundleMode || "single",
  ].join("::");
}

function getPoliticalPathCacheSignature(transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity) {
  return [
    getPoliticalPassStaticSignature(transform),
    getProjectionRenderSignature(),
    getViewportRenderSignature(),
    String(runtimeState.activeScenarioId || ""),
    "ownership",
    Number(runtimeState.sovereigntyRevision || 0),
    0,
    Number(runtimeState.scenarioShellOverlayRevision || 0),
  ].join("::");
}

function cancelPoliticalPathWarmup(reason = "unspecified") {
  const cache = getRenderPassCacheState();
  const hadWork =
    !!cache.politicalPathWarmupHandle
    || (Array.isArray(cache.politicalPathWarmupQueue) && cache.politicalPathWarmupQueue.length > 0)
    || !!cache.politicalPathWarmupSignature;
  if (cache.politicalPathWarmupHandle) {
    cancelDeferredWork(cache.politicalPathWarmupHandle);
  }
  cache.politicalPathWarmupHandle = null;
  cache.politicalPathWarmupQueue = [];
  cache.politicalPathWarmupSignature = "";
  cache.politicalPathWarmupReason = String(reason || "unspecified");
  if (hadWork) {
    incrementPerfCounter("politicalPathWarmupCancels");
  }
}

function invalidatePoliticalPathCache(reason = "unspecified") {
  const cache = getRenderPassCacheState();
  cancelPoliticalPathWarmup(reason);
  const previousSize = cache.politicalPathCache instanceof Map
    ? cache.politicalPathCache.size
    : 0;
  const previousSignature = String(cache.politicalPathCacheSignature || "");
  const previousReason = String(cache.politicalPathCacheReason || "");
  if (cache.politicalPathCache instanceof Map) {
    cache.politicalPathCache.clear();
  } else {
    cache.politicalPathCache = new Map();
  }
  cache.politicalPathCacheSignature = "";
  cache.politicalPathCacheTransform = null;
  cache.politicalPathCacheReason = String(reason || "unspecified");
  recordRenderPerfMetric("politicalPathCacheReset", 0, {
    reason: String(reason || "unspecified"),
    previousSize,
    previousSignature,
    previousReason,
  });
}

function cancelScenarioPoliticalBackgroundDeferredFullCache(reason = "unspecified") {
  return getPoliticalBackgroundRenderOwner().cancelScenarioPoliticalBackgroundDeferredFullCache(reason);
}
function getPoliticalPathCacheHandle(
  transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity,
  { resetIfMismatch = false } = {},
) {
  const cache = getRenderPassCacheState();
  const signature = getPoliticalPathCacheSignature(transform);
  const valid =
    cache.politicalPathCache instanceof Map
    && cache.politicalPathCacheSignature === signature
    && areZoomTransformsEquivalent(cache.politicalPathCacheTransform, transform);
  if (valid) {
    return {
      cache,
      signature,
      valid: true,
      map: cache.politicalPathCache,
      resetSummary: null,
    };
  }
  let resetSummary = null;
  if (resetIfMismatch) {
    const previousSize = cache.politicalPathCache instanceof Map
      ? cache.politicalPathCache.size
      : 0;
    const previousSignature = String(cache.politicalPathCacheSignature || "");
    const previousReason = String(cache.politicalPathCacheReason || "");
    const previousTransform = cache.politicalPathCacheTransform
      ? cloneZoomTransform(cache.politicalPathCacheTransform)
      : null;
    if (!(cache.politicalPathCache instanceof Map)) {
      cache.politicalPathCache = new Map();
    } else {
      cache.politicalPathCache.clear();
    }
    cache.politicalPathCacheSignature = signature;
    cache.politicalPathCacheTransform = cloneZoomTransform(transform);
    cache.politicalPathCacheReason = "prepared";
    resetSummary = {
      reason: "prepare-mismatch",
      previousSize,
      previousSignature,
      previousReason,
      nextSignature: signature,
      previousTransformK: Number(previousTransform?.k || 0),
      nextTransformK: Number(transform?.k || 1),
    };
    recordRenderPerfMetric("politicalPathCacheReset", 0, {
      ...resetSummary,
    });
  }
  return {
    cache,
    signature,
    valid: resetIfMismatch,
    map: cache.politicalPathCache instanceof Map ? cache.politicalPathCache : new Map(),
    resetSummary,
  };
}

function buildPoliticalFeaturePathEntry(feature) {
  if (!feature?.geometry || !globalThis.Path2D || typeof rendererSurfaceHost.getPathSvg() !== "function") {
    return null;
  }
  try {
    const pathString = rendererSurfaceHost.getPathSvg()(feature);
    if (!pathString) return null;
    return {
      path: new globalThis.Path2D(pathString),
    };
  } catch (_error) {
    return null;
  }
}

function getPoliticalFeaturePathEntry(
  feature,
  {
    featureId = null,
    transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity,
    allowBuild = false,
    countMiss = false,
    countBuild = false,
  } = {},
) {
  const resolvedId = featureId || getFeatureId(feature);
  if (!resolvedId) return null;
  const handle = getPoliticalPathCacheHandle(transform, { resetIfMismatch: allowBuild });
  if (!handle.valid || !(handle.map instanceof Map)) {
    if (countMiss) incrementPerfCounter("politicalPartialPathCacheMisses");
    return null;
  }
  const cachedEntry = handle.map.get(resolvedId);
  if (cachedEntry?.path) {
    return cachedEntry;
  }
  if (countMiss) incrementPerfCounter("politicalPartialPathCacheMisses");
  if (!allowBuild) {
    return null;
  }
  const builtEntry = buildPoliticalFeaturePathEntry(feature);
  if (!builtEntry?.path) {
    return null;
  }
  handle.map.set(resolvedId, builtEntry);
  if (countBuild) incrementPerfCounter("politicalPathCacheBuild");
  return builtEntry;
}

function collectWarmupCandidateItems(transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity) {
  const viewportWidth = Math.max(1, Number(runtimeState.width || 1));
  const viewportHeight = Math.max(1, Number(runtimeState.height || 1));
  const overscan = Math.max(0, Number(POLITICAL_PATH_WARMUP_OVERSCAN_PX || 0));
  const viewportRect = {
    minX: -overscan,
    minY: -overscan,
    maxX: viewportWidth + overscan,
    maxY: viewportHeight + overscan,
  };
  const projectedViewportRect = screenRectToProjectedRect(viewportRect, transform);
  if (!projectedViewportRect) return null;
  const candidateResult = collectLandSpatialItemsForProjectedRects([projectedViewportRect]);
  if (!candidateResult || candidateResult.overflow) {
    return null;
  }
  const normalizedTransform = cloneZoomTransform(transform);
  const centerX = ((viewportWidth / 2) - normalizedTransform.x) / normalizedTransform.k;
  const centerY = ((viewportHeight / 2) - normalizedTransform.y) / normalizedTransform.k;
  return candidateResult.items
    .map((item) => ({
      ...item,
      warmupDistance: Math.hypot(
        (((Number(item?.minX || 0) + Number(item?.maxX || 0)) / 2) - centerX),
        (((Number(item?.minY || 0) + Number(item?.maxY || 0)) / 2) - centerY),
      ),
    }))
    .sort((left, right) => {
      const distanceDelta = Number(left?.warmupDistance || 0) - Number(right?.warmupDistance || 0);
      if (Math.abs(distanceDelta) > 0.001) return distanceDelta;
      return (left?.drawOrder ?? 0) - (right?.drawOrder ?? 0);
    })
    .slice(0, POLITICAL_PATH_WARMUP_QUEUE_MAX);
}

function runPoliticalPathWarmupSlice(deadline = null) {
  const cache = getRenderPassCacheState();
  cache.politicalPathWarmupHandle = null;
  if (
    runtimeState.renderPhase !== RENDER_PHASE_IDLE
    || runtimeState.deferExactAfterSettle
    || cache.dirty?.political
  ) {
    cancelPoliticalPathWarmup("warmup-non-idle");
    return false;
  }
  const transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity;
  const expectedSignature = getPoliticalPathCacheSignature(transform);
  if (
    cache.politicalPathWarmupSignature !== expectedSignature
    || (
      cache.politicalPathCacheSignature
      && cache.politicalPathCacheSignature !== expectedSignature
    )
  ) {
    invalidatePoliticalPathCache("warmup-signature-mismatch");
    return false;
  }
  if (!Array.isArray(cache.politicalPathWarmupQueue) || !cache.politicalPathWarmupQueue.length) {
    cache.politicalPathWarmupQueue = [];
    cache.politicalPathWarmupSignature = "";
    return false;
  }
  const handle = getPoliticalPathCacheHandle(transform, { resetIfMismatch: true });
  if (!handle.valid || !(handle.map instanceof Map)) {
    invalidatePoliticalPathCache("warmup-handle-invalid");
    return false;
  }
  const startedAt = nowMs();
  let processedCount = 0;
  let builtCount = 0;
  while (cache.politicalPathWarmupQueue.length > 0) {
    if (processedCount >= POLITICAL_PATH_WARMUP_MAX_FEATURES_PER_SLICE) break;
    if (processedCount > 0 && (nowMs() - startedAt) >= POLITICAL_PATH_WARMUP_CPU_BUDGET_MS) break;
    if (
      processedCount > 0
      && deadline
      && typeof deadline.timeRemaining === "function"
      && deadline.timeRemaining() <= 0
    ) {
      break;
    }
    const nextItem = cache.politicalPathWarmupQueue.shift();
    if (!nextItem?.id || !nextItem?.feature) continue;
    processedCount += 1;
    if (handle.map.get(nextItem.id)?.path) continue;
    const pathEntry = getPoliticalFeaturePathEntry(nextItem.feature, {
      featureId: nextItem.id,
      transform,
      allowBuild: true,
      countBuild: true,
    });
    if (pathEntry?.path) {
      builtCount += 1;
      incrementPerfCounter("politicalPathWarmupBuild");
    }
  }
  incrementPerfCounter("politicalPathWarmupSlices");
  const durationMs = nowMs() - startedAt;
  recordRenderPerfMetric("politicalPathWarmupSlice", durationMs, {
    builtCount,
    processedCount,
    remainingCount: cache.politicalPathWarmupQueue.length,
    activeScenarioId: String(runtimeState.activeScenarioId || ""),
    transformK: Number(transform?.k || 1),
  });
  recordRenderPerfMetric("politicalPathWarmup", durationMs, {
    builtCount,
    processedCount,
    remainingCount: cache.politicalPathWarmupQueue.length,
    activeScenarioId: String(runtimeState.activeScenarioId || ""),
    transformK: Number(transform?.k || 1),
  });
  if (cache.politicalPathWarmupQueue.length > 0) {
    cache.politicalPathWarmupHandle = scheduleDeferredWork(runPoliticalPathWarmupSlice, {
      timeout: POLITICAL_PATH_WARMUP_TIMEOUT_MS,
    });
  } else {
    cache.politicalPathWarmupSignature = "";
  }
  return builtCount > 0;
}

function schedulePoliticalPathWarmup(transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity) {
  const cache = getRenderPassCacheState();
  if (
    runtimeState.renderPhase !== RENDER_PHASE_IDLE
    || runtimeState.deferExactAfterSettle
    || cache.dirty?.political
  ) {
    return false;
  }
  const signature = getPoliticalPathCacheSignature(transform);
  const candidateItems = collectWarmupCandidateItems(transform);
  if (!Array.isArray(candidateItems)) {
    cancelPoliticalPathWarmup("warmup-spatial-unavailable");
    return false;
  }
  const handle = getPoliticalPathCacheHandle(transform, { resetIfMismatch: false });
  const cacheMap = handle.valid && handle.map instanceof Map ? handle.map : null;
  const queue = candidateItems.filter((item) => item?.id && item?.feature && !cacheMap?.get(item.id)?.path);
  if (!queue.length) {
    cancelPoliticalPathWarmup("warmup-complete");
    return false;
  }
  if (cache.politicalPathWarmupHandle) {
    cancelDeferredWork(cache.politicalPathWarmupHandle);
  }
  cache.politicalPathWarmupHandle = null;
  cache.politicalPathWarmupQueue = queue;
  cache.politicalPathWarmupSignature = signature;
  cache.politicalPathWarmupReason = "scheduled";
  cache.politicalPathWarmupHandle = scheduleDeferredWork(runPoliticalPathWarmupSlice, {
    timeout: POLITICAL_PATH_WARMUP_TIMEOUT_MS,
  });
  return true;
}

function invalidateInteractionBorderSnapshot(reason = "unspecified") {
  // 入口负责编排 snapshot 生命周期与时机，像素细节由 owner 实现。
  return getInteractionBorderSnapshotOwner().invalidateInteractionBorderSnapshot(reason);
}

function captureInteractionBorderSnapshot(transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity) {
  // 入口负责编排 snapshot 生命周期与时机，像素细节由 owner 实现。
  return getInteractionBorderSnapshotOwner().captureInteractionBorderSnapshot(transform);
}

function drawInteractionBorderSnapshot(currentTransform = runtimeState.zoomTransform || globalThis.d3.zoomIdentity) {
  // 入口负责编排 snapshot 生命周期与时机，像素细节由 owner 实现。
  return getInteractionBorderSnapshotOwner().drawInteractionBorderSnapshot(currentTransform);
}

function getScenarioRuntimeTopologySignatureToken() {
  const runtimeTopology = runtimeState.scenarioRuntimeTopologyData || runtimeState.runtimePoliticalTopology || null;
  return [
    estimateTopologyObjectArcRefs(runtimeTopology, "political") ?? "na",
    estimateTopologyObjectArcRefs(runtimeTopology, "land_mask") ?? "na",
    estimateTopologyObjectArcRefs(runtimeTopology, "context_land_mask") ?? "na",
    estimateTopologyObjectArcRefs(runtimeTopology, "scenario_water") ?? "na",
    estimateTopologyObjectArcRefs(runtimeTopology, "scenario_special_land") ?? "na",
  ].join("|");
}

function getScenarioDetailPhaseSignatureToken() {
  return [
    String(runtimeState.topologyBundleMode || "single"),
    runtimeState.detailPromotionCompleted ? "detail-ready" : "detail-pending",
    runtimeState.detailPromotionInFlight ? "detail-in-flight" : "detail-idle",
  ].join("/");
}

function getScenarioAtlantropaRevisionToken(counts = null) {
  const buckets = counts ? null : getEffectiveAtlantropaFeatures();
  const atlantropaRef = runtimeState.scenarioAtlantropaData || null;
  const atlantropaFeatures = Array.isArray(atlantropaRef?.features)
    ? atlantropaRef.features
    : [];
  return [
    String(getObjectIdentityToken(atlantropaRef, "scenario-atlantropa")),
    `features:${atlantropaFeatures.length}`,
    `water:${counts ? counts.water : buckets.water.length}`,
    `land:${counts ? counts.land : buckets.land.length}`,
    `shoal:${counts ? counts.shoal : buckets.shoal.length}`,
    `relief:${counts ? counts.relief : buckets.relief.length}`,
    isScenarioAtlantropaVisible() ? "visible:on" : "visible:off",
  ].join(":");
}

function getScenarioWaterRegionsMode() {
  const explicitMode = String(runtimeState.activeScenarioManifest?.water_regions_mode || "").trim().toLowerCase();
  if (explicitMode) return explicitMode;
  if (scenarioHasPresentationFeature(
    runtimeState.activeScenarioManifest,
    SCENARIO_PRESENTATION_FEATURES.ATLANTROPA_RELIEF
  )) {
    return "exclusive";
  }
  return "combined";
}

function isScenarioWaterTopologyExclusiveMode() {
  return getScenarioWaterRegionsMode() === "exclusive";
}

function getScenarioSurfaceVersionParts(waterFeatureCount = null, atlantropaCounts = null) {
  const maskInfo = getPhysicalLandMaskInfo();
  const runtimeTopologyRef = runtimeState.scenarioRuntimeTopologyData || runtimeState.runtimePoliticalTopology || null;
  const effectiveWaterFeatureCount = Number(waterFeatureCount
    ?? getEffectiveWaterRegionFeatures().length);
  const signal = [
    String(runtimeState.activeScenarioId || ""),
    `runtime-tag:${String(runtimeState.scenarioRuntimeTopologyVersionTag || "").trim() || `${getObjectIdentityToken(runtimeTopologyRef, "scenario-runtime-topology")}:${getScenarioRuntimeTopologySignatureToken()}`}`,
    `detail-phase:${getScenarioDetailPhaseSignatureToken()}`,
    `mask-tag:${String(runtimeState.scenarioContextLandMaskVersionTag || runtimeState.scenarioLandMaskVersionTag || "").trim() || `${maskInfo.maskSource}:${getObjectIdentityToken(maskInfo.collection, "scenario-mask")}:${maskInfo.maskFeatureCount}:${maskInfo.maskArcRefEstimate ?? "na"}:${maskInfo.maskQualityToken || "unchecked"}`}`,
    `water-ref:${getObjectIdentityToken(runtimeState.scenarioWaterRegionsData, "scenario-water")}`,
    `water-tag:${String(runtimeState.scenarioWaterOverlayVersionTag || "").trim() || `features:${effectiveWaterFeatureCount}`}`,
    `water-mode:${getScenarioWaterRegionsMode()}`,
  ];
  // Allocate identity tokens in the same order as the standalone surface signal.
  const atlantropaRevisionToken = String(getScenarioAtlantropaRevisionToken(atlantropaCounts));
  signal.push(`atlantropa:${atlantropaRevisionToken}`);
  return { signal: signal.join("|"), atlantropaRevisionToken };
}

function getScenarioSurfaceVersionSignal() {
  return getScenarioSurfaceVersionParts().signal;
}

function getScenarioWaterVisualRevisionToken() {
  const atlantropaFeatures = getEffectiveAtlantropaFeatures();
  const effectiveWaterFeatureCount = getEffectiveWaterRegionFeatures().length;
  const atlantropaCounts = {
    water: Number(atlantropaFeatures.water.length),
    land: Number(atlantropaFeatures.land.length),
    shoal: Number(atlantropaFeatures.shoal.length),
    relief: Number(atlantropaFeatures.relief.length),
  };
  const { signal, atlantropaRevisionToken } = getScenarioSurfaceVersionParts(
    effectiveWaterFeatureCount, atlantropaCounts
  );
  return [
    signal,
    `water-effective:${effectiveWaterFeatureCount}`,
    `water-scenario:${getFeatureCollectionFeatureCount(runtimeState.scenarioWaterRegionsData)}`,
    `water-atlantropa:${atlantropaRevisionToken}`,
    `water-overrides:${stableJson(runtimeState.waterRegionOverrides || {})}`,
    runtimeState.showWaterRegions ? "scenario-water:on" : "scenario-water:off",
    runtimeState.showOpenOceanRegions ? "open-ocean:on" : "open-ocean:off",
    runtimeState.allowOpenOceanSelect ? "open-ocean-select:on" : "open-ocean-select:off",
    runtimeState.allowOpenOceanPaint ? "open-ocean-paint:on" : "open-ocean-paint:off",
    `water-selected:${String(runtimeState.selectedWaterRegionId || "").trim()}`,
    `ocean-fill:${getOceanBaseFillColor()}`,
    `lake-fill:${getLakeBaseFillColor()}`,
    `lake-style:${stableJson(getLakeStyleConfig())}`,
  ].join("|");
}

function getScenarioSpecialVisualRevisionToken() {
  return [
    runtimeState.topologyRevision || 0,
    runtimeState.activeScenarioId || "",
    `scenario-topology:${getScenarioRuntimeTopologySignatureToken()}`,
    `detail-phase:${getScenarioDetailPhaseSignatureToken()}`,
    `special-ref:${getObjectIdentityToken(runtimeState.scenarioSpecialRegionsData, "scenario-special")}`,
    `special-count:${getFeatureCollectionFeatureCount(runtimeState.scenarioSpecialRegionsData)}`,
    runtimeState.showScenarioSpecialRegions ? "scenario-special:on" : "scenario-special:off",
  ].join("|");
}

function getScenarioReliefVisualRevisionToken() {
  return [
    runtimeState.topologyRevision || 0,
    runtimeState.activeScenarioId || "",
    Number(runtimeState.scenarioReliefOverlayRevision || 0),
    `detail-phase:${getScenarioDetailPhaseSignatureToken()}`,
    `relief-count:${getFeatureCollectionFeatureCount(runtimeState.scenarioReliefOverlaysData)}`,
    runtimeState.showScenarioReliefOverlays ? "scenario-relief:on" : "scenario-relief:off",
  ].join("|");
}

function getScenarioOverlaySignatureToken() {
  return [
    String(runtimeState.topologyBundleMode || "single"),
    runtimeState.detailPromotionCompleted ? "detail-ready" : "detail-pending",
    runtimeState.detailPromotionInFlight ? "detail-in-flight" : "detail-idle",
    `water:${getScenarioWaterVisualRevisionToken()}`,
    `special:${getScenarioSpecialVisualRevisionToken()}`,
    `relief:${getScenarioReliefVisualRevisionToken()}`,
  ].join("|");
}

function getRenderPassTransformSignature(passName, transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity) {
  if (
    VIEWPORT_STABLE_RENDER_PASS_SIGNATURE_NAMES.has(passName)
    && shouldEnableContextBaseTransformReuse()
  ) {
    return [
      "transform-reuse",
      getViewportRenderSignature(),
      Number(Number(runtimeState.dpr || 1).toFixed(2)),
    ].join("::");
  }
  return getTransformSignature(transform);
}

function getRenderPassSignature(passName, transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity) {
  const transformSignature = getRenderPassTransformSignature(passName, transform);
  const intensityFields = normalizeIntensityFieldsState(runtimeState.intensityFields);
  if (passName === "background") {
    return [
      transformSignature,
      runtimeState.topologyRevision || 0,
      runtimeState.oceanMaskMode || "topology_ocean",
      Number(runtimeState.oceanMaskQuality || 1).toFixed(3),
      `field:oceanDepth:${Number(intensityFields.channels.oceanDepth?.revision || 0)}`,
      stableJson(runtimeState.styleConfig?.ocean || {}),
    ].join("::");
  }
  if (passName === "physicalBase") {
    const maskInfo = getPhysicalLandMaskInfo();
    return [
      transformSignature,
      runtimeState.topologyRevision || 0,
      runtimeState.activeScenarioId || "",
      runtimeState.showPhysical ? "physical:on" : "physical:off",
      `mask:${maskInfo.maskSource}:${maskInfo.maskFeatureCount}:${maskInfo.maskArcRefEstimate ?? "na"}:${maskInfo.maskQualityToken || "unchecked"}`,
      `scenario-topology:${getScenarioRuntimeTopologySignatureToken()}`,
      `field:${Number(intensityFields.channels.physicalAtlas?.revision || 0)}`,
      stableJson(normalizePhysicalStyleConfig(runtimeState.styleConfig?.physical || {})),
    ].join("::");
  }
  if (passName === "political") {
    return [
      runtimeState.colorRevision || 0,
      getHgoRuntimePreviewVisibilitySignature(),
      getPoliticalPassStaticSignature(transform),
    ].join("::");
  }
  if (passName === "hgoPreview") {
    const preview = runtimeState.hgoRuntimePreview || {};
    const summary = preview.summary || {};
    const hgoProjectionOptions = getHgoRuntimePreviewProjectionOptions();
    return [
      isHgoRuntimePreviewReady() ? "hgo:on" : "hgo:off",
      String(preview.status || ""),
      Number(runtimeState.dpr || 1).toFixed(2),
      Number(runtimeState.width || 0),
      Number(runtimeState.height || 0),
      rendererSurfaceHost.getProjection() ? transformSignature : "projection:none",
      hgoProjectionOptions.projectionName,
      hgoProjectionOptions.sourceProjection,
      `seed:${Number(summary.provinceCount || summary.province_count || 0)}:${Number(summary.stateCount || summary.state_count || 0)}:${Number(summary.countryCount || summary.country_count || 0)}`,
    ].join("::");
  }
  if (passName === "effects") {
    return [
      transformSignature,
      runtimeState.topologyRevision || 0,
      stableJson(normalizeTextureStyleConfig(runtimeState.styleConfig?.texture || {})),
    ].join("::");
  }
  if (passName === "lineEffects") {
    return [
      transformSignature,
      runtimeState.topologyRevision || 0,
      stableJson(normalizeTextureStyleConfig(runtimeState.styleConfig?.texture || {})),
    ].join("::");
  }
  if (passName === "contextBase") {
    const maskInfo = getPhysicalLandMaskInfo();
    const zoomBucket = getContextBaseZoomBucketId(transform?.k || runtimeState.zoomTransform?.k || 1);
    const baseSignatureParts = [
      runtimeState.topologyRevision || 0,
      runtimeState.activeScenarioId || "",
      getHgoRuntimePreviewVisibilitySignature(),
      runtimeState.deferContextBasePass ? "context-base:deferred" : "context-base:ready",
      `bucket:${zoomBucket}`,
      runtimeState.showPhysical ? "physical:on" : "physical:off",
      runtimeState.showUrban ? "urban:on" : "urban:off",
      runtimeState.showRivers ? "rivers:on" : "rivers:off",
      `context:${Number(runtimeState.contextLayerRevision || 0)}`,
      `context-colors:${shouldRefreshContextBaseForColorChanges() ? Number(runtimeState.colorRevision || 0) : 0}`,
      `mask:${maskInfo.maskSource}:${maskInfo.maskFeatureCount}:${maskInfo.maskArcRefEstimate ?? "na"}:${maskInfo.maskQualityToken || "unchecked"}`,
      `scenario-topology:${getScenarioRuntimeTopologySignatureToken()}`,
      `field:physicalContour:${Number(intensityFields.channels.physicalContour?.revision || 0)}`,
      `field:urbanGlow:${Number(intensityFields.channels.urbanGlow?.revision || 0)}`,
      String(runtimeState.renderProfile || "auto"),
      stableJson(normalizePhysicalStyleConfig(runtimeState.styleConfig?.physical || {})),
      stableJson(normalizeUrbanStyleConfig(runtimeState.styleConfig?.urban || {})),
      stableJson(runtimeState.styleConfig?.rivers || {}),
    ];
    if (shouldEnableContextBaseTransformReuse()) {
      return [
        getViewportRenderSignature(),
        "context-base-transform-reuse",
        ...baseSignatureParts,
      ].join("::");
    }
    return [
      transformSignature,
      ...baseSignatureParts,
    ].join("::");
  }
  if (passName === "contextMarkers") {
    return [
      transformSignature,
      runtimeState.topologyRevision || 0,
      runtimeState.activeScenarioId || "",
      getHgoRuntimePreviewVisibilitySignature(),
      runtimeState.deferContextBasePass ? "context-markers:deferred" : "context-markers:ready",
      runtimeState.showCityPoints ? "cities:on" : "cities:off",
      runtimeState.showStrategicResourceMarkers ? "strategic-resources:on" : "strategic-resources:off",
      runtimeState.showTransport ? "transport:on" : "transport:off",
      runtimeState.showRoad ? "road:on" : "road:off",
      runtimeState.showAirports ? "airports:on" : "airports:off",
      runtimeState.showPorts ? "ports:on" : "ports:off",
      runtimeState.showRail ? "rail:on" : "rail:off",
      ...getUrbanCityRenderPassSignatureParts(runtimeState, "contextMarkers"),
      `context:${Number(runtimeState.contextLayerRevision || 0)}`,
      stableJson(normalizeCityLayerStyleConfig(runtimeState.styleConfig?.cityPoints || {})),
      stableJson(normalizeTransportOverviewStyleConfig(runtimeState.styleConfig?.transportOverview || {})),
    ].join("::");
  }
  if (passName === "labels") {
    return [
      transformSignature,
      runtimeState.topologyRevision || 0,
      runtimeState.activeScenarioId || "",
      getHgoRuntimePreviewVisibilitySignature(),
      runtimeState.showBlankFeatureLabels ? "blank-feature-labels:on" : "blank-feature-labels:off",
      runtimeState.showCityPoints ? "cities:on" : "cities:off",
      ...getUrbanCityRenderPassSignatureParts(runtimeState, "labels"),
      stableJson(normalizeCityLayerStyleConfig(runtimeState.styleConfig?.cityPoints || {})),
    ].join("::");
  }
  if (passName === "contextScenario") {
    return [
      transformSignature,
      runtimeState.topologyRevision || 0,
      runtimeState.activeScenarioId || "",
      getHgoRuntimePreviewVisibilitySignature(),
      runtimeState.scenarioReliefOverlayRevision || 0,
      `scenario-topology:${getScenarioRuntimeTopologySignatureToken()}`,
      `scenario-overlays:${getScenarioOverlaySignatureToken()}`,
      runtimeState.showWaterRegions ? "scenario-water:on" : "scenario-water:off",
      runtimeState.showOpenOceanRegions ? "open-ocean:on" : "open-ocean:off",
      runtimeState.showScenarioSpecialRegions ? "scenario-special:on" : "scenario-special:off",
      runtimeState.showScenarioReliefOverlays ? "scenario-relief:on" : "scenario-relief:off",
      `ocean-fill:${getOceanBaseFillColor()}`,
      `lake-fill:${getLakeBaseFillColor()}`,
      `lake-style:${stableJson(getLakeStyleConfig())}`,
    ].join("::");
  }
  if (passName === "textureLabels") {
    return [
      transformSignature,
      getHgoRuntimePreviewVisibilitySignature(),
      runtimeState.topologyRevision || 0,
      stableJson(normalizeTextureStyleConfig(runtimeState.styleConfig?.texture || {})),
    ].join("::");
  }
  if (passName === "dayNight") {
    return getDayNightRuntimeOwner().buildDayNightPassSignature(
      transformSignature, intensityFields.channels.urbanGlow?.revision, Number(runtimeState.topologyRevision || 0),
    );
  }
  if (passName === "borders") {
    return [
      transformSignature,
      getHgoRuntimePreviewVisibilitySignature(),
      runtimeState.topologyRevision || 0,
      runtimeState.colorRevision || 0,
      runtimeState.cachedDynamicBordersHash || "",
      runtimeState.sovereigntyRevision || 0,
      0,
      runtimeState.activeScenarioId || "",
      runtimeState.scenarioBorderMode || "canonical",
      "ownership",
      stableJson(runtimeState.parentBorderEnabledByCountry || {}),
      stableJson(runtimeState.styleConfig?.internalBorders || {}),
      stableJson(runtimeState.styleConfig?.empireBorders || {}),
      stableJson(runtimeState.styleConfig?.coastlines || {}),
      stableJson(runtimeState.styleConfig?.parentBorders || {}),
    ].join("::");
  }
  return transformSignature;
}

function resolveHitMode() {
  const raw = readSearchParam(HIT_MODE_PARAM);
  if (!raw) return "auto";
  if (!HIT_MODES.has(raw)) return "auto";
  return raw;
}

function isDynamicBordersEnabled() {
  if (!runtimeState.runtimePoliticalTopology?.objects?.political || !globalThis.topojson) {
    return false;
  }
  const raw = readSearchParam("dynamic_borders");
  if (!raw) return runtimeState.dynamicBordersEnabled !== false;
  return !["0", "false", "off", "no"].includes(raw);
}

function isSovereigntyModeActive() {
  return String(runtimeState.paintMode || "visual").toLowerCase() === "sovereignty";
}

function clearPendingDynamicBorderTimer() {
  return getBorderMeshOwner().clearPendingDynamicBorderTimer();
}

function updateDynamicBorderStatusUI() {
  if (typeof runtimeState.updateDynamicBorderStatusUIFn === "function") {
    runtimeState.updateDynamicBorderStatusUIFn();
  }
}

function markDynamicBordersDirty(reason = "") {
  return getBorderMeshOwner().markDynamicBordersDirty(reason);
}

function resetRenderDiagnostics() {
  renderDiag.enabled = isRenderDiagEnabled();
  renderDiag.seenKeys = new Set();
  renderDiag.skippedByReason = new Map();
  renderDiag.skippedByCountry = new Map();
  renderDiag.sampleByReason = new Map();
  renderDiag.targetGeometryById = new Map();
  renderDiag.politicalPass = null;
  renderDiag.transformedPasses = {};
  renderDiag.waterHit = null;
  commitProjectedBoundsDiagnosticsState(
    runtimeState,
    createDefaultProjectedBoundsDiagnostics(),
  );
  if (!renderDiag.enabled) {
    delete globalThis.__mapRenderDiag;
  } else {
    publishRenderDiagnostics();
    console.info(`[map_renderer] ${RENDER_DIAG_PARAM}=1 enabled. Collecting skip diagnostics.`);
  }
}

function publishRenderDiagnostics(extra = {}) {
  if (!renderDiag.enabled) return;
  const existing = globalThis.__mapRenderDiag && typeof globalThis.__mapRenderDiag === "object"
    ? globalThis.__mapRenderDiag
    : {};
  globalThis.__mapRenderDiag = {
    ...existing,
    ...extra,
    enabled: true,
    skippedTotal: renderDiag.seenKeys.size,
    skippedByReason: Object.fromEntries(renderDiag.skippedByReason.entries()),
    skippedByCountry: Object.fromEntries(renderDiag.skippedByCountry.entries()),
    sampleByReason: Object.fromEntries(renderDiag.sampleByReason.entries()),
    targetGeometry: Object.fromEntries(renderDiag.targetGeometryById.entries()),
    politicalPass: renderDiag.politicalPass,
    transformedPasses: renderDiag.transformedPasses,
    waterHit: renderDiag.waterHit,
  };
}

function isTargetGeometryDiagnosticFeature(feature, decision = {}) {
  const featureId = String(decision.featureId || getFeatureId(feature) || "").trim().toUpperCase();
  const country = String(decision.countryCode || getFeatureCountryCodeNormalized(feature) || "").trim().toUpperCase();
  return TARGET_GEOMETRY_DIAG_COUNTRIES.has(country)
    || TARGET_GEOMETRY_DIAG_PREFIXES.some((prefix) => featureId.startsWith(prefix));
}

function recordTargetGeometryDiagnostic(feature, decision = {}) {
  if (!renderDiag.enabled || !isTargetGeometryDiagnosticFeature(feature, decision)) return;
  const featureId = String(decision.featureId || getFeatureId(feature) || "(unknown)").trim() || "(unknown)";
  renderDiag.targetGeometryById.set(featureId, {
    id: featureId,
    country: String(decision.countryCode || getFeatureCountryCodeNormalized(feature) || "UNK").trim() || "UNK",
    name: String(feature?.properties?.name || "").trim(),
    skipped: !!decision.skip,
    reason: decision.reason || null,
    bounds: decision.bounds || null,
  });
  publishRenderDiagnostics();
}

function recordWaterHitDiagnostic(detail = {}) {
  if (!renderDiag.enabled) return;
  renderDiag.waterHit = {
    phase: String(runtimeState.renderPhase || ""),
    reason: String(detail.reason || ""),
    eventType: String(detail.eventType || ""),
    waterItems: Array.isArray(runtimeState.waterSpatialItems) ? runtimeState.waterSpatialItems.length : 0,
    waterRegions: Number(runtimeState.waterRegionsById?.size || 0),
    pendingReasons: Array.from(pendingSecondarySpatialBuildReasons || []),
    hasPendingBuild: secondarySpatialBuildHandle !== null && secondarySpatialBuildHandle !== undefined,
    secondarySpatialBuildPending: !!runtimeState.secondarySpatialBuildPending,
    secondarySpatialPreservedDuringBuild: !!runtimeState.secondarySpatialPreservedDuringBuild,
    secondarySpatialGeneration: Number(runtimeState.secondarySpatialGeneration || 0),
    secondarySpatialLastReason: String(runtimeState.secondarySpatialLastReason || ""),
    hitCanvasDirty: !!runtimeState.hitCanvasDirty,
    interactionSettled: isInteractionRecoverySettled({ quietMs: 800 }),
  };
  publishRenderDiagnostics();
}

function recordSkipDiagnostic(feature, decision) {
  if (!renderDiag.enabled || !decision?.skip) return;
  const featureId = decision.featureId || getFeatureId(feature) || "(unknown)";
  const reason = decision.reason || "unknown";
  const country = decision.countryCode || getFeatureCountryCodeNormalized(feature) || "UNK";
  const key = `${reason}::${featureId}`;
  if (renderDiag.seenKeys.has(key)) return;
  renderDiag.seenKeys.add(key);

  renderDiag.skippedByReason.set(reason, (renderDiag.skippedByReason.get(reason) || 0) + 1);
  renderDiag.skippedByCountry.set(country, (renderDiag.skippedByCountry.get(country) || 0) + 1);

  const reasonSamples = renderDiag.sampleByReason.get(reason) || [];
  if (reasonSamples.length < 30) {
    reasonSamples.push({
      id: featureId,
      country,
      name: String(feature?.properties?.name || "").trim(),
      bounds: decision.bounds || null,
    });
    renderDiag.sampleByReason.set(reason, reasonSamples);
  }

  publishRenderDiagnostics();
}

function canonicalCountryCode(rawCode) {
  return normalizeCountryCodeAlias(rawCode);
}

function getColorByCanonicalCountryCode(colorMap, canonicalCode) {
  if (!colorMap || !canonicalCode) return null;
  if (colorMap[canonicalCode]) return colorMap[canonicalCode];
  for (const [alias, canonical] of Object.entries(COUNTRY_CODE_ALIASES)) {
    if (canonical === canonicalCode && colorMap[alias]) {
      return colorMap[alias];
    }
  }
  return null;
}

function getFeatureId(feature) {
  return getSharedFeatureId(feature) || null;
}

function getWaterRegionType(feature) {
  return String(feature?.properties?.water_type || "water_region").trim().toLowerCase();
}

function isBaseGeographyScenarioFeature(feature) {
  return feature?.properties?.render_as_base_geography === true;
}

function isOpenOceanWaterRegion(feature) {
  return getWaterRegionType(feature) === "ocean";
}

function isMacroOceanWaterRegion(feature) {
  if (!feature) return false;
  return (
    isOpenOceanWaterRegion(feature)
    || String(feature?.properties?.region_group || "").trim().toLowerCase() === "ocean_macro"
  );
}

function isOpenOceanSelectionEnabled() {
  return !!runtimeState.allowOpenOceanSelect;
}

function isOpenOceanPaintEnabled() {
  return !!runtimeState.allowOpenOceanPaint;
}

function isOpenOceanRenderable() {
  return !!runtimeState.showOpenOceanRegions || isOpenOceanPaintEnabled();
}

function isOpenOceanOverlayActive() {
  return isOpenOceanSelectionEnabled() || isOpenOceanPaintEnabled();
}

function isWaterRegionRenderable(feature) {
  if (!feature) return false;
  if (isBaseGeographyScenarioFeature(feature)) {
    return true;
  }
  if (isOpenOceanWaterRegion(feature)) {
    return isOpenOceanRenderable();
  }
  return feature?.properties?.interactive !== false;
}

function isWaterRegionEnabled(feature) {
  if (!feature) return false;
  if (isBaseGeographyScenarioFeature(feature)) {
    return true;
  }
  if (isOpenOceanWaterRegion(feature)) {
    return isOpenOceanOverlayActive();
  }
  return feature?.properties?.interactive !== false;
}

function getWaterRegionDefaultStyle(feature) {
  return getUnifiedWaterBaseStyle(feature);
}

function getWaterRegionColor(id, feature = null) {
  const resolvedId = String(id || "").trim();
  const defaultStyleFeature = feature || runtimeState.waterRegionsById?.get(resolvedId);
  if (isMacroOceanWaterRegion(defaultStyleFeature) && !isOpenOceanPaintEnabled()) {
    return getWaterRegionDefaultStyle(defaultStyleFeature).fill;
  }
  return (
    getSafeCanvasColor(runtimeState.waterRegionOverrides?.[resolvedId], null) ||
    getWaterRegionDefaultStyle(defaultStyleFeature).fill
  );
}

function isScenarioWaterRegion(feature) {
  return !!String(feature?.properties?.scenario_id || "").trim();
}

function getScenarioExcludedWaterRegionIds() {
  const ids = runtimeState.activeScenarioManifest?.excluded_water_region_ids;
  if (!Array.isArray(ids) || !ids.length) return new Set();
  return new Set(
    ids
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  );
}

function getScenarioExcludedWaterRegionGroups() {
  const groups = runtimeState.activeScenarioManifest?.excluded_water_region_groups;
  if (!Array.isArray(groups) || !groups.length) return new Set();
  return new Set(
    groups
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean)
  );
}

function isWaterRegionExcludedByScenario(feature) {
  if (!feature || isScenarioWaterRegion(feature)) return false;
  const excludedIds = getScenarioExcludedWaterRegionIds();
  const featureId = String(feature?.properties?.id || "").trim();
  if (featureId && excludedIds.has(featureId)) {
    return true;
  }
  const excludedGroups = getScenarioExcludedWaterRegionGroups();
  const regionGroup = String(feature?.properties?.region_group || "").trim().toLowerCase();
  return !!(regionGroup && excludedGroups.has(regionGroup));
}

function getAtlantropaRenderLayer(feature) {
  return String(feature?.properties?.atl_render_layer || "").trim().toLowerCase();
}

function getAtlantropaColorRule(feature) {
  return String(feature?.properties?.atl_color_rule || "").trim().toLowerCase();
}

function isScenarioAtlantropaVisible() {
  return runtimeState.showScenarioAtlantropa !== false;
}

function isAtlantropaFieldDrivenFeature(feature) {
  return !!(getAtlantropaRenderLayer(feature) || getAtlantropaColorRule(feature));
}

function getEffectiveAtlantropaFeatures() {
  const features = Array.isArray(runtimeState.scenarioAtlantropaData?.features)
    ? runtimeState.scenarioAtlantropaData.features
    : [];
  const buckets = {
    water: [],
    land: [],
    shoal: [],
    relief: [],
  };
  if (!isScenarioAtlantropaVisible()) {
    return buckets;
  }
  features.forEach((feature) => {
    const renderLayer = getAtlantropaRenderLayer(feature);
    if (renderLayer && Array.isArray(buckets[renderLayer])) {
      buckets[renderLayer].push(feature);
    }
  });
  return buckets;
}

function buildAtlantropaLandLikeFeatureCollection() {
  const buckets = getEffectiveAtlantropaFeatures();
  const features = [
    ...buckets.land,
    ...buckets.shoal,
    ...buckets.relief,
  ];
  return features.length ? { type: "FeatureCollection", features } : null;
}

function appendUniqueFeatureCollections(primaryCollection, extraCollection) {
  const primaryFeatures = Array.isArray(primaryCollection?.features) ? primaryCollection.features : [];
  const extraFeatures = Array.isArray(extraCollection?.features) ? extraCollection.features : [];
  if (!extraFeatures.length) {
    return primaryCollection;
  }
  const seen = new Set(primaryFeatures.map((feature) => getFeatureId(feature)).filter(Boolean));
  const features = primaryFeatures.slice();
  extraFeatures.forEach((feature) => {
    const featureId = getFeatureId(feature);
    if (!featureId || seen.has(featureId)) return;
    seen.add(featureId);
    features.push(feature);
  });
  return { type: "FeatureCollection", features };
}

function getEffectiveWaterRegionFeatures() {
  const atlantropaFeatures = getEffectiveAtlantropaFeatures();
  const scenarioFeatures = [
    ...(Array.isArray(runtimeState.scenarioWaterRegionsData?.features)
      ? runtimeState.scenarioWaterRegionsData.features
      : []),
    ...atlantropaFeatures.water,
  ];
  if (isScenarioWaterTopologyExclusiveMode()) {
    return sanitizeWaterRegionFeatures(scenarioFeatures.filter((feature) => !isWaterRegionExcludedByScenario(feature)));
  }
  return sanitizeWaterRegionFeatures([
    ...(Array.isArray(runtimeState.waterRegionsData?.features) ? runtimeState.waterRegionsData.features : []),
    ...scenarioFeatures,
  ].filter((feature) => !isWaterRegionExcludedByScenario(feature)));
}

function getSpecialRegionType(feature) {
  return String(feature?.properties?.special_type || "special_region").trim().toLowerCase();
}

function isSpecialRegionEnabled(feature) {
  if (!feature) return false;
  if (!runtimeState.activeScenarioId) return false;
  if (!runtimeState.showScenarioSpecialRegions && !isBaseGeographyScenarioFeature(feature)) return false;
  return feature?.properties?.interactive !== false;
}

function getSpecialRegionDefaultStyle(feature) {
  const specialType = getSpecialRegionType(feature);
  if (specialType === "salt_flat") {
    return {
      fill: "#d7c6a3",
      stroke: "#8b6f49",
      opacity: 0.9,
    };
  }
  if (specialType === "wasteland") {
    return {
      fill: "#bf8f74",
      stroke: "#7d4e3d",
      opacity: 0.9,
    };
  }
  return {
    fill: SPECIAL_REGION_FALLBACK_FILL,
    stroke: SPECIAL_REGION_FALLBACK_STROKE,
    opacity: 0.88,
  };
}

function getSpecialRegionColor(id, feature = null) {
  return getSpecialRegionDefaultStyle(feature || runtimeState.specialRegionsById?.get(String(id || "").trim())).fill;
}

function getSpecialRegionStrokeColor(feature) {
  return getSpecialRegionDefaultStyle(feature).stroke;
}

function getSpecialRegionOpacity(feature, id) {
  return getSpecialRegionDefaultStyle(feature).opacity;
}

function getEffectiveSpecialRegionFeatures() {
  return Array.isArray(runtimeState.scenarioSpecialRegionsData?.features)
    ? runtimeState.scenarioSpecialRegionsData.features
    : [];
}

function getEffectiveScenarioReliefOverlayFeatures() {
  return Array.isArray(runtimeState.scenarioReliefOverlaysData?.features)
    ? runtimeState.scenarioReliefOverlaysData.features
    : [];
}

function getReliefOverlayKind(feature) {
  return String(feature?.properties?.overlay_kind || "").trim().toLowerCase();
}

function isAtlantropaReliefOverlayFeature(feature) {
  if (!scenarioHasPresentationFeature(
    runtimeState.activeScenarioManifest,
    SCENARIO_PRESENTATION_FEATURES.ATLANTROPA_RELIEF
  )) {
    return false;
  }
  return String(feature?.properties?.id || "").trim().toLowerCase().startsWith("atlantropa_");
}

function isReliefOverlayEnabled(feature) {
  if (!feature) return false;
  if (!runtimeState.activeScenarioId) return false;
  if (!runtimeState.showScenarioReliefOverlays) return false;
  if (isAtlantropaReliefOverlayFeature(feature)) {
    if (!runtimeState.detailPromotionCompleted) return false;
    if (String(runtimeState.topologyBundleMode || "").trim().toLowerCase() !== "composite") return false;
  }
  if (isBaseGeographyScenarioFeature(feature)) return true;
  return feature?.properties?.interactive !== false;
}

function isScenarioCoastalAccentEnabled() {
  return scenarioHasPresentationFeature(
    runtimeState.activeScenarioManifest,
    SCENARIO_PRESENTATION_FEATURES.COASTAL_ACCENT
  )
    && runtimeState.styleConfig?.ocean?.coastalAccentEnabled !== false;
}

function getScenarioCoastalAccentOverlayFeatures() {
  if (!isScenarioCoastalAccentEnabled()) return [];
  return getEffectiveScenarioReliefOverlayFeatures().filter((feature) => {
    if (!isReliefOverlayEnabled(feature)) return false;
    const kind = getReliefOverlayKind(feature);
    return kind === "new_shoreline" || kind === "lake_shoreline";
  });
}

function getAtlantropaAccentSuppressionFeatures() {
  if (!isScenarioCoastalAccentEnabled()) return [];
  return Array.isArray(runtimeState.activeBathymetryBandsData?.features)
    ? runtimeState.activeBathymetryBandsData.features.filter((feature) => {
      if (String(feature?.properties?._bathymetrySource || "").trim().toLowerCase() !== "scenario") {
        return false;
      }
      if (!isAtlantropaBathymetryFeature(feature)) return false;
      return pathBoundsInScreen(feature);
    })
    : [];
}

function drawScenarioReliefOverlaysLayer(k, {
  reliefFeatures = null,
  cacheMode = "direct",
} = {}) {
  return getScenarioReliefOverlayRenderOwner().drawScenarioReliefOverlaysLayer(k, {
    reliefFeatures,
    cacheMode,
  });
}

function renderScenarioReliefOverlaysLayerToCache(currentTransform, reliefFeatures) {
  const layerEntry = getContextScenarioLayerCacheEntry("relief");
  const layerCanvas = ensureContextScenarioLayerCanvas("relief");
  const layerContext = layerCanvas.getContext("2d");
  if (!layerContext) {
    layerEntry.signature = "";
    layerEntry.referenceTransform = null;
    layerEntry.renderedCount = 0;
    return 0;
  }
  const layout = getRenderPassLayout("contextScenario");
  let renderedCount = 0;
  withRenderTarget(layerContext, () => {
    const layerK = prepareTargetContext(layerContext, currentTransform, layout);
    renderedCount = drawScenarioReliefOverlaysLayer(layerK, {
      reliefFeatures,
      cacheMode: "redraw",
    });
  });
  layerEntry.signature = getScenarioReliefVisualRevisionToken();
  layerEntry.referenceTransform = cloneZoomTransform(currentTransform);
  layerEntry.renderedCount = renderedCount;
  return renderedCount;
}

function drawScenarioReliefOverlaysPass(k) {
  const overlays = getEffectiveScenarioReliefOverlayFeatures();
  if (
    !overlays.length
    || !runtimeState.showScenarioReliefOverlays
    || runtimeState.renderPhase === RENDER_PHASE_INTERACTING
    || runtimeState.renderPhase === RENDER_PHASE_SETTLING
  ) {
    drawScenarioReliefOverlaysLayer(k, { reliefFeatures: overlays, cacheMode: "direct" });
    return;
  }

  const currentTransform = cloneZoomTransform(runtimeState.zoomTransform || globalThis.d3?.zoomIdentity);
  const reliefLayerEntry = getContextScenarioLayerCacheEntry("relief");
  const reliefVisualRevision = getScenarioReliefVisualRevisionToken();
  const canReuseReliefLayer = (
    shouldEnableContextScenarioTransformReuse()
    && reliefLayerEntry.signature === reliefVisualRevision
    && !!reliefLayerEntry.canvas
    && !!reliefLayerEntry.referenceTransform
  );
  if (canReuseReliefLayer && drawCachedContextScenarioLayer("relief", currentTransform)) {
    const renderedCount = Number(reliefLayerEntry.renderedCount || 0);
    collectContextMetric("contextScenarioLayerCacheHit", 0, {
      layer: "relief",
      renderedCount,
    });
    collectContextMetric("contextScenarioLayerRelief", 0, {
      featureCount: overlays.length,
      renderedCount,
      skipped: false,
      cacheMode: "reuse",
      signature: reliefVisualRevision,
    });
    return;
  }

  collectContextMetric("contextScenarioLayerCacheMiss", 0, {
    layer: "relief",
    reason: reliefLayerEntry.signature === reliefVisualRevision ? "transform" : "signature",
    signatureChanged: reliefLayerEntry.signature !== reliefVisualRevision,
  });
  renderScenarioReliefOverlaysLayerToCache(currentTransform, overlays);
  if (!drawCachedContextScenarioLayer("relief", currentTransform)) {
    drawScenarioReliefOverlaysLayer(k, { reliefFeatures: overlays, cacheMode: "direct" });
  }
}

function getFeatureCountryCodeNormalized(feature) {
  return canonicalCountryCode(getSharedFeatureCountryCode(feature));
}

function getFeatureBorderMeshCountryCodeNormalized(feature) {
  const featureId = getFeatureId(feature);
  return canonicalCountryCode(
    getDisplayOwnerCode(feature, featureId)
    || getFeatureCountryCodeNormalized(feature)
    || ""
  );
}

function getFeatureInteractionCountryCodeNormalized(feature, featureId = null) {
  const resolvedId = String(featureId || "").trim() || getFeatureId(feature);
  return canonicalCountryCode(
    getDisplayOwnerCode(feature, resolvedId)
    || getFeatureCountryCodeNormalized(feature)
    || ""
  );
}

function getAtlantropaSurfaceKind(feature) {
  return String(feature?.properties?.atl_surface_kind || "").trim().toLowerCase();
}

function isAtlantropaSeaFeature(feature) {
  if (getAtlantropaColorRule(feature) === "atlantropa_sea") {
    return true;
  }
  return getFeatureCountryCodeNormalized(feature) === "ATL"
    && getAtlantropaSurfaceKind(feature) === "sea";
}

function getAtlantropaSeaManifestFillColor() {
  return getSafeCanvasColor(
    runtimeState.activeScenarioManifest?.style_defaults?.atlantropa_sea?.fillColor,
    null
  );
}

function getAtlantropaSaltFlatManifestFillColor() {
  return getSafeCanvasColor(
    runtimeState.activeScenarioManifest?.style_defaults?.atlantropa_salt_flat?.fillColor,
    "#7c6f53"
  );
}

function getAtlantropaShoalManifestFillColor() {
  return getSafeCanvasColor(
    runtimeState.activeScenarioManifest?.style_defaults?.atlantropa_shoal?.fillColor,
    "#3a5d70"
  );
}

function getAtlantropaRuleColor(rule) {
  const normalizedRule = String(rule || "").trim().toLowerCase();
  if (normalizedRule === "atlantropa_sea") {
    return getAtlantropaSeaManifestFillColor() || getOceanBaseFillColor();
  }
  if (normalizedRule === "salt_flat") {
    return getAtlantropaSaltFlatManifestFillColor();
  }
  if (normalizedRule === "shoal_pattern") {
    return getAtlantropaShoalManifestFillColor();
  }
  return "";
}

function isInteractiveAtlantropaBooleanWeldIslandFeature(feature, featureId = null) {
  const candidate = String(
    feature?.properties?.id ?? featureId ?? feature?.id ?? ""
  ).trim().toUpperCase();
  if (!candidate.startsWith("ATLISL_")) {
    return false;
  }
  return getAtlantropaGeometryRole(feature) === "donor_island"
    && getAtlantropaJoinMode(feature) === "boolean_weld";
}

function getAtlantropaSeaPoliticalFillColor() {
  return getAtlantropaSeaManifestFillColor() || getOceanBaseFillColor();
}

function getAtlantropaSeaPoliticalStrokeColor() {
  return UNIFIED_WATER_STROKE_COLOR;
}

function getMediterraneanAtlantropaBounds() {
  if (!scenarioHasPresentationFeature(
    runtimeState.activeScenarioManifest,
    SCENARIO_PRESENTATION_FEATURES.COASTAL_ACCENT
  )) return null;
  const cache = runtimeState.mediterraneanAtlantropaBoundsCache || {};
  const featureCount = Array.isArray(runtimeState.landData?.features) ? runtimeState.landData.features.length : 0;
  if (
    cache.scenarioId === runtimeState.activeScenarioId &&
    cache.topologyRevision === Number(runtimeState.topologyRevision || 0) &&
    cache.featureCount === featureCount &&
    Array.isArray(cache.bounds)
  ) {
    return cache.bounds;
  }
  if (!Array.isArray(runtimeState.landData?.features) || !runtimeState.landData.features.length || !globalThis.d3?.geoBounds) {
    return null;
  }
  const atlFeatures = runtimeState.landData.features.filter((feature) => getFeatureCountryCodeNormalized(feature) === "ATL");
  if (!atlFeatures.length) return null;
  try {
    const bounds = globalThis.d3.geoBounds({
      type: "FeatureCollection",
      features: atlFeatures,
    });
    runtimeState.mediterraneanAtlantropaBoundsCache = {
      scenarioId: runtimeState.activeScenarioId || "",
      topologyRevision: Number(runtimeState.topologyRevision || 0),
      featureCount,
      bounds,
    };
    return bounds;
  } catch (_error) {
    return null;
  }
}

function isPointerInsideMediterraneanAtlantropaBounds(pointer) {
  const bounds = getMediterraneanAtlantropaBounds();
  if (!bounds || !Array.isArray(bounds) || bounds.length !== 2) return false;
  const lon = Number(pointer?.lonLat?.[0]);
  const lat = Number(pointer?.lonLat?.[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
  const [[minLon, minLat], [maxLon, maxLat]] = bounds;
  return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
}

function shouldSuppressOpenOceanHit(candidate, pointer) {
  if (!candidate?.item?.feature || !isOpenOceanWaterRegion(candidate.item.feature)) return false;
  return isPointerInsideMediterraneanAtlantropaBounds(pointer);
}

function getFeatureRegionTag(feature) {
  const props = feature?.properties || {};
  return (
    props.subregion ||
    props.SUBREGION ||
    props.mapcolor7 ||
    props.MAPCOLOR7 ||
    props.mapcolor8 ||
    props.MAPCOLOR8 ||
    props.mapcolor9 ||
    props.MAPCOLOR9 ||
    props.region_un ||
    props.REGION_UN ||
    props.region_wb ||
    props.REGION_WB ||
    props.continent ||
    props.CONTINENT ||
    props.cntr_code ||
    props.CNTR_CODE ||
    "Unknown"
  );
}

function buildCountryDominantFillColorMap() {
  const cacheMatches =
    countryDominantFillColorCache.colorRevision === Number(runtimeState.colorRevision || 0)
    && countryDominantFillColorCache.scenarioOwnershipColorMode === "ownership"
    && countryDominantFillColorCache.activeScenarioId === String(runtimeState.activeScenarioId || "");
  if (cacheMatches && countryDominantFillColorCache.result instanceof Map) {
    return countryDominantFillColorCache.result;
  }

  const countsByCountry = new Map();
  getFullLandDataFeatures().forEach((feature, index) => {
    const countryCode = getFeatureCountryCodeNormalized(feature);
    const id = getFeatureId(feature) || `feature-${index}`;
    if (!countryCode || !id || shouldExcludePoliticalVisualFeature(feature, id)) return;
    const color = getSafeCanvasColor(runtimeState.colors?.[id], null) || getResolvedFeatureColor(feature, id);
    if (!color) return;
    const countryCounts = countsByCountry.get(countryCode) || new Map();
    countryCounts.set(color, (countryCounts.get(color) || 0) + 1);
    countsByCountry.set(countryCode, countryCounts);
  });

  const result = new Map();
  countsByCountry.forEach((countryCounts, countryCode) => {
    let bestColor = "";
    let bestCount = -1;
    countryCounts.forEach((count, color) => {
      if (count <= bestCount) return;
      bestColor = color;
      bestCount = count;
    });
    if (bestColor) result.set(countryCode, bestColor);
  });
  countryDominantFillColorCache = {
    colorRevision: Number(runtimeState.colorRevision || 0),
    scenarioOwnershipColorMode: "ownership",
    activeScenarioId: String(runtimeState.activeScenarioId || ""),
    result,
  };
  return result;
}

function getAdmin0BackgroundFillColor(countryCode) {
  const canonicalCode = canonicalCountryCode(countryCode);
  const dominantFillColor = buildCountryDominantFillColorMap().get(canonicalCode);
  return getSafeCanvasColor(dominantFillColor, null)
    || getSafeCanvasColor(getColorByCanonicalCountryCode(runtimeState.sovereignBaseColors, canonicalCode), null)
    || getSafeCanvasColor(getColorByCanonicalCountryCode(runtimeState.countryBaseColors, canonicalCode), null)
    || LAND_FILL_COLOR;
}

function getInternalBorderStrokeColor(countryCode, fallbackColor) {
  const colorMode = String(runtimeState.styleConfig?.internalBorders?.colorMode || "auto").trim().toLowerCase();
  const manualColor = getSafeCanvasColor(runtimeState.styleConfig?.internalBorders?.color, fallbackColor || "#cccccc");
  if (colorMode === "manual") {
    return manualColor;
  }
  const dominantFillColor = buildCountryDominantFillColorMap().get(canonicalCountryCode(countryCode));
  const luminance = getCanvasColorRelativeLuminance(dominantFillColor);
  if (!Number.isFinite(luminance)) {
    return manualColor;
  }
  const targetColor = luminance >= 0.42 ? INTERNAL_BORDER_AUTO_LIGHT : INTERNAL_BORDER_AUTO_DARK;
  return mixCanvasColors(dominantFillColor, targetColor, luminance >= 0.42 ? 0.78 : 0.72)
    || targetColor
    || manualColor;
}

function getContourZoomStyleProfile(k) {
  const zoomBucket = getContextBaseZoomBucketId(k);
  return CONTOUR_ZOOM_STYLE_PROFILES[zoomBucket] || CONTOUR_ZOOM_STYLE_PROFILES.high;
}

function getContourFeatureHostFillColor(feature) {
  if (!feature || !runtimeState.spatialItems?.length || !rendererSurfaceHost.getProjection()) return null;
  const cacheKey = [
    Number(runtimeState.colorRevision || 0),
    String(runtimeState.activeScenarioId || ""),
    "ownership",
  ].join("::");
  const cached = contourHostFillColorCache.get(feature);
  if (cached?.key === cacheKey) {
    return cached.color;
  }

  const geographicCentroid = getFeatureGeoCentroid(feature);
  const projectedCentroid = rendererSurfaceHost.getPathCanvas()?.centroid
    ? rendererSurfaceHost.getPathCanvas().centroid(feature)
    : (Array.isArray(geographicCentroid) ? rendererSurfaceHost.getProjection()(geographicCentroid) : null);
  const resolveFromRadius = (radiusProj = 0) => {
    if (
      !Array.isArray(projectedCentroid)
      || projectedCentroid.length < 2
      || !projectedCentroid.every((value) => Number.isFinite(Number(value)))
      || !Array.isArray(geographicCentroid)
    ) {
      return null;
    }
    const ranked = rankCandidates(
      collectGridCandidates(projectedCentroid[0], projectedCentroid[1], radiusProj),
      geographicCentroid,
    );
    const match = ranked.find((candidate) => candidate.containsGeo) || ranked[0];
    const hostFeature = match?.item?.feature || null;
    const hostFeatureId = String(match?.item?.featureId || getFeatureId(hostFeature) || "").trim();
    if (!hostFeature || !hostFeatureId) return null;
    return (
      getSafeCanvasColor(runtimeState.colors?.[hostFeatureId], null)
      || getSafeCanvasColor(getResolvedFeatureColor(hostFeature, hostFeatureId), null)
    );
  };

  const color = resolveFromRadius(0) || resolveFromRadius(CONTOUR_HOST_FILL_FALLBACK_RADIUS);
  contourHostFillColorCache.set(feature, {
    key: cacheKey,
    color,
  });
  return color;
}

function getAdaptiveContourStrokeColor(feature, baseColor) {
  const safeBaseColor = getSafeCanvasColor(baseColor, "#665241") || "#665241";
  const hostFillColor = getContourFeatureHostFillColor(feature);
  const luminance = getCanvasColorRelativeLuminance(hostFillColor);
  if (!Number.isFinite(luminance)) {
    return safeBaseColor;
  }
  const targetColor = luminance >= 0.42 ? "#111827" : "#ffffff";
  const mixAmount = luminance >= 0.42 ? 0.58 : 0.74;
  return mixCanvasColors(safeBaseColor, targetColor, mixAmount) || targetColor || safeBaseColor;
}

function sanitizeColorMap(input) {
  const sanitized = {};
  if (!input || typeof input !== "object") return sanitized;

  for (const [rawId, rawColor] of Object.entries(input)) {
    const id = String(rawId || "").trim();
    if (!id) continue;
    const color = getSafeCanvasColor(rawColor, null);
    if (!color) continue;
    sanitized[id] = color;
  }

  return sanitized;
}

function sanitizeCountryColorMap(input) {
  const sanitized = {};
  if (!input || typeof input !== "object") return sanitized;

  for (const [rawCode, rawColor] of Object.entries(input)) {
    const code = canonicalCountryCode(rawCode);
    if (!code) continue;
    const color = getSafeCanvasColor(rawColor, null);
    if (!color) continue;
    sanitized[code] = color;
  }

  return sanitized;
}

function normalizeDebugMode(modeName) {
  const normalized = String(modeName || "PROD").trim().toUpperCase();
  return DEBUG_MODES.has(normalized) ? normalized : "PROD";
}

function stringHash(input) {
  const text = String(input || "");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function hashToColor(token) {
  const hue = stringHash(token) % 360;
  return `hsl(${hue}, 70%, 58%)`;
}

function getIslandNeighborGraph() {
  const object = runtimeState.topology?.objects?.political;
  const geometries = object?.geometries || [];
  if (!object || !Array.isArray(geometries) || geometries.length === 0) {
    return [];
  }

  if (
    islandNeighborsCache.topologyRef === runtimeState.topology &&
    islandNeighborsCache.objectRef === object &&
    islandNeighborsCache.count === geometries.length &&
    Array.isArray(islandNeighborsCache.neighbors)
  ) {
    return islandNeighborsCache.neighbors;
  }

  let neighbors = [];
  if (
    Array.isArray(object.computed_neighbors) &&
    object.computed_neighbors.length === geometries.length
  ) {
    neighbors = object.computed_neighbors;
  } else if (globalThis.topojson?.neighbors) {
    try {
      neighbors = globalThis.topojson.neighbors(geometries) || [];
    } catch (error) {
      neighbors = [];
    }
  }

  if (!Array.isArray(neighbors) || neighbors.length !== geometries.length) {
    neighbors = new Array(geometries.length).fill(null).map(() => []);
  }

  islandNeighborsCache = {
    topologyRef: runtimeState.topology,
    objectRef: object,
    count: geometries.length,
    neighbors,
  };
  return neighbors;
}

function setDebugMode(modeName) {
  const nextMode = normalizeDebugMode(modeName);
  if (debugMode === nextMode) return;
  debugMode = nextMode;
  runtimeState.debugMode = nextMode;
  invalidateRenderPasses(["political", "borders"], "debug-mode");
  if (rendererSurfaceHost.getPathSvg()) {
    buildSpatialIndex();
  }
  if (rendererSurfaceHost.getContext()) {
    render();
  }
}

function prepareTargetContext(
  targetContext,
  transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity,
  layout = null,
) {
  if (!targetContext?.canvas) return 1;
  const width = targetContext.canvas.width;
  const height = targetContext.canvas.height;
  const normalized = cloneZoomTransform(transform);
  const offsetX = Number(layout?.offsetX || 0);
  const offsetY = Number(layout?.offsetY || 0);
  targetContext.setTransform(1, 0, 0, 1, 0, 0);
  targetContext.clearRect(0, 0, width, height);
  targetContext.globalCompositeOperation = "source-over";
  targetContext.globalAlpha = 1;
  targetContext.shadowBlur = 0;
  targetContext.filter = "none";
  targetContext.setTransform(runtimeState.dpr, 0, 0, runtimeState.dpr, 0, 0);
  targetContext.translate(offsetX, offsetY);
  targetContext.translate(normalized.x, normalized.y);
  targetContext.scale(normalized.k, normalized.k);
  return normalized.k;
}

function withRenderTarget(targetContext, callback) {
  if (!targetContext || typeof callback !== "function") return undefined;
  const previousContext = rendererSurfaceHost.getContext();
  const previousPathCanvas = rendererSurfaceHost.getPathCanvas();
  rendererSurfaceHost.setContext(targetContext);
  rendererSurfaceHost.setPathCanvas(globalThis.d3.geoPath(rendererSurfaceHost.getProjection(), targetContext).pointRadius(PATH_POINT_RADIUS));
  try {
    return callback();
  } finally {
    rendererSurfaceHost.setContext(previousContext);
    rendererSurfaceHost.setPathCanvas(previousPathCanvas);
  }
}

function getPassCounterNames(passName) {
  if (passName === "background") return ["backgroundPassRenders"];
  if (passName === "physicalBase") return ["contextPassRenders", "physicalBasePassRenders"];
  if (passName === "political") return ["politicalPassRenders"];
  if (passName === "hgoPreview") return ["hgoPreviewPassRenders"];
  if (passName === "effects") return ["effectsPassRenders"];
  if (passName === "contextBase") return ["contextPassRenders", "contextBasePassRenders"];
  if (passName === "contextScenario") return ["contextPassRenders", "contextScenarioPassRenders"];
  if (passName === "lineEffects") return ["effectsPassRenders"];
  if (passName === "contextMarkers") return ["contextPassRenders", "contextBasePassRenders"];
  if (passName === "dayNight") return ["dayNightPassRenders"];
  if (passName === "borders") return ["borderPassRenders"];
  if (passName === "textureLabels") return ["labelPassRenders"];
  if (passName === "labels") return ["labelPassRenders"];
  return [];
}

function recordPassTiming(timings, passName, startedAt) {
  if (!timings || !passName) return;
  timings[passName] = Math.max(0, nowMs() - startedAt);
}

function getLogicalCanvasDimensions() {
  const dpr = Math.max(runtimeState.dpr || 1, 1);
  const widthFromCanvas = rendererSurfaceHost.getContext()?.canvas?.width ? rendererSurfaceHost.getContext().canvas.width / dpr : 0;
  const heightFromCanvas = rendererSurfaceHost.getContext()?.canvas?.height ? rendererSurfaceHost.getContext().canvas.height / dpr : 0;
  const width = Math.max(runtimeState.width || 0, widthFromCanvas || 0, 1);
  const height = Math.max(runtimeState.height || 0, heightFromCanvas || 0, 1);
  return [width, height];
}

function nowMs() {
  if (globalThis.performance?.now) {
    return globalThis.performance.now();
  }
  return Date.now();
}

function scheduleDeferredWork(callback, { timeout = 0 } = {}) {
  if (typeof callback !== "function") return null;
  if (typeof globalThis.requestIdleCallback === "function") {
    return {
      type: "idle",
      id: globalThis.requestIdleCallback(callback, {
        timeout: Math.max(0, Number(timeout) || 0),
      }),
    };
  }
  return {
    type: "timeout",
    id: globalThis.setTimeout(callback, Math.max(0, Number(timeout) || 0)),
  };
}

function cancelDeferredWork(handle) {
  if (!handle || typeof handle !== "object") return;
  if (handle.type === "idle" && typeof globalThis.cancelIdleCallback === "function") {
    globalThis.cancelIdleCallback(handle.id);
    return;
  }
  if (typeof globalThis.clearTimeout === "function") {
    globalThis.clearTimeout(handle.id);
  }
}

function clearStagedMapDataTasks() {
  cancelDeferredWork(runtimeState.stagedContextBaseHandle);
  cancelDeferredWork(runtimeState.stagedHitCanvasHandle);
  cancelDeferredWork(secondarySpatialBuildHandle);
  runtimeState.stagedContextBaseHandle = null;
  runtimeState.stagedHitCanvasHandle = null;
  secondarySpatialBuildHandle = null;
  pendingSecondarySpatialBuildReasons.clear();
  scenarioRefreshRuntime?.resetDeferredScenarioChunkPromotionState();
}

function setDeferContextBaseEnhancements(value) {
  deferContextBaseEnhancements = !!value;
}

function getExactAfterSettleScheduler() {
  if (exactAfterSettleScheduler) {
    return exactAfterSettleScheduler;
  }
  exactAfterSettleScheduler = createExactAfterSettleScheduler({
    runtimeState,
    renderPassNames: RENDER_PASS_NAMES,
    renderPhaseIdle: RENDER_PHASE_IDLE,
    exactContextRefreshDelayMs: DEFERRED_EXACT_CONTEXT_REFRESH_DELAY_MS,
    getContext: () => rendererSurfaceHost.getContext(),
    getVisibleContextFlagSignature,
    cloneZoomTransform,
    getAdaptiveSettleProfile,
    getContextBaseReuseDecision,
    shouldForceExactContextBaseRefresh,
    updateDprStage,
    setCanvasSize,
    cancelDeferredContextBaseEnhancement,
    setDeferContextBaseEnhancements,
    shouldDeferContextBaseEnhancementsForExactRefresh,
    scheduleDeferredContextBaseEnhancements,
    getRenderPassCacheState,
    getRenderPipelinePassesOwner,
    getPhysicalExactRefreshPasses,
    invalidateRenderPasses,
    rebuildResolvedColors,
    requestRendererRender,
    render,
    recordRenderPerfMetric,
    readRenderPerfMetricDuration,
    nowMs,
    enqueueFrameTask,
    scheduleDeferredWork,
    cancelDeferredWork,
    flushPendingScenarioChunkRefreshAfterExact,
  });
  return exactAfterSettleScheduler;
}

function getExactAfterSettleControllerState() {
  return getExactAfterSettleScheduler().getExactAfterSettleControllerState();
}

function isExactAfterSettleControllerActive() {
  return getExactAfterSettleScheduler().isExactAfterSettleControllerActive();
}

function finalizePendingExactAfterSettleRefreshAfterPaint() {
  return getExactAfterSettleScheduler().finalizePendingExactAfterSettleRefreshAfterPaint();
}

function abortPendingExactAfterSettleRefreshAfterPaint(reason = "exact-compose-failed") {
  return getExactAfterSettleScheduler().abortPendingExactAfterSettleRefreshAfterPaint(reason);
}

function cancelExactAfterSettleRefresh({ clearDefer = true } = {}) {
  return getExactAfterSettleScheduler().cancelExactAfterSettleRefresh({ clearDefer });
}

function scheduleExactAfterSettleRefresh(profile = runtimeState.adaptiveSettleProfile || getAdaptiveSettleProfile()) {
  return getExactAfterSettleScheduler().scheduleExactAfterSettleRefresh(profile);
}

function isHeavyScenarioStagedApplyCandidate() {
  const landCount = Array.isArray(runtimeState.landData?.features) ? runtimeState.landData.features.length : 0;
  return !!runtimeState.activeScenarioId && landCount >= HEAVY_SCENARIO_STAGED_APPLY_FEATURE_THRESHOLD;
}

function getViewportRenderSignature() {
  return getViewportReadModelOwner().getViewportRenderSignature();
}

function getProjectionRenderSignature() {
  return getViewportReadModelOwner().getProjectionRenderSignature();
}

function getContextBaseZoomBucketId(k = runtimeState.zoomTransform?.k || 1) {
  return getRenderTransformReusePolicyOwner().getContextBaseZoomBucketId(k);
}

function getContextBaseReuseMaxDistancePx() {
  return getRenderTransformReusePolicyOwner().getContextBaseReuseMaxDistancePx();
}

function resetPhysicalLandClipPathCache() {
  physicalLandClipPathCache.key = "";
  physicalLandClipPathCache.path = null;
}

function shouldEnableContextBaseTransformReuse() {
  return getRenderTransformReusePolicyOwner().shouldEnableContextBaseTransformReuse();
}

function shouldEnableContextScenarioTransformReuse() {
  return getRenderTransformReusePolicyOwner().shouldEnableContextScenarioTransformReuse();
}

function normalizeScenarioWaterCacheStrategyMode(rawMode) {
  return getScenarioWaterCachePolicyOwner().normalizeScenarioWaterCacheStrategyMode(rawMode);
}

function getFirstValidScenarioWaterCacheStrategyMode(...rawModes) {
  return getScenarioWaterCachePolicyOwner().getFirstValidScenarioWaterCacheStrategyMode(...rawModes);
}

function getForcedScenarioWaterCacheMode() {
  return getScenarioWaterCachePolicyOwner().getForcedScenarioWaterCacheMode();
}

function normalizeScenarioWaterCoverageAlgo(rawValue) {
  return getScenarioWaterCachePolicyOwner().normalizeScenarioWaterCoverageAlgo(rawValue);
}

function getFirstValidScenarioWaterCoverageAlgo(...rawValues) {
  return getScenarioWaterCachePolicyOwner().getFirstValidScenarioWaterCoverageAlgo(...rawValues);
}

function getForcedScenarioWaterCoverageAlgo() {
  return getScenarioWaterCachePolicyOwner().getForcedScenarioWaterCoverageAlgo();
}

function getScenarioWaterVisibleCoverageRatioLegacy(waterFeatures = []) {
  return getScenarioWaterCachePolicyOwner().getScenarioWaterVisibleCoverageRatioLegacy(waterFeatures);
}

function getScenarioWaterVisibleCoverageRatioGrid(waterFeatures = []) {
  return getScenarioWaterCachePolicyOwner().getScenarioWaterVisibleCoverageRatioGrid(waterFeatures);
}

function getScenarioWaterVisibleCoverageRatio(waterFeatures = [], options = {}) {
  return getScenarioWaterCachePolicyOwner().getScenarioWaterVisibleCoverageRatio(waterFeatures, options);
}

function getScenarioWaterCacheComplexitySignals(waterFeatures = []) {
  return getScenarioWaterCachePolicyOwner().getScenarioWaterCacheComplexitySignals(waterFeatures);
}

function shouldUseDirectScenarioWaterDraw(signals) {
  return getScenarioWaterCachePolicyOwner().shouldUseDirectScenarioWaterDraw(signals);
}

function getPassReferenceTransform(passName) {
  return getRenderCacheOwner().getPassReferenceTransform(passName);
}

function setPassReferenceTransform(passName, transform) {
  return getRenderCacheOwner().setPassReferenceTransform(passName, transform);
}

function getPassFullReferenceTransform(passName) {
  return getRenderCacheOwner().getPassFullReferenceTransform(passName);
}

function setPassFullReferenceTransform(passName, transform) {
  return getRenderCacheOwner().setPassFullReferenceTransform(passName, transform);
}

function hasPassFullReferenceTransform(passName) {
  return getRenderCacheOwner().hasPassFullReferenceTransform(passName);
}

function clearPassFullReferenceTransforms(passNames = null) {
  return getRenderCacheOwner().clearPassFullReferenceTransforms(passNames);
}

function getPoliticalPassFineBaselineMismatch(transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity) {
  const cache = getRenderPassCacheState();
  const identity = getVisibleFrameIdentity(transform);
  if (String(cache.politicalPassDataStage || "") !== "fine" || !cache.politicalPassFineCacheReady) {
    return "coarse-baseline";
  }
  if (Number(cache.politicalPassSceneGeneration || 0) !== Number(identity.sceneGeneration || 0)) {
    return "scene-snapshot-mismatch";
  }
  if (Number(cache.politicalPassScenarioDataGeneration || 0) !== Number(identity.scenarioDataGeneration || 0)) {
    return "scenario-data-generation-mismatch";
  }
  return "";
}

function createPoliticalPassDrawResult(sceneIdentity, {
  committed = true,
  reason = "",
  politicalDataStage = "unknown",
  fullPoliticalReady = null,
  finePoliticalCacheReady = false,
  coarseUnderlay = "",
} = {}) {
  const stage = String(politicalDataStage || "unknown");
  return {
    committed,
    reason: String(reason || ""),
    sceneGeneration: Number(sceneIdentity?.sceneGeneration || 0),
    scenarioDataGeneration: Number(sceneIdentity?.scenarioDataGeneration || 0),
    politicalDataStage: stage,
    fullPoliticalReady: fullPoliticalReady === null
      ? !!sceneIdentity?.fullPoliticalReady
      : !!fullPoliticalReady,
    finePoliticalCacheReady: stage === "fine" && !!finePoliticalCacheReady,
    coarseUnderlay: String(coarseUnderlay || ""),
  };
}

function getTransformReuseDelta(currentTransform, referenceTransform) {
  return getRenderTransformReusePolicyOwner().getTransformReuseDelta(currentTransform, referenceTransform);
}

function getContextBaseReuseDecision(transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity) {
  return getRenderTransformReusePolicyOwner().getContextBaseReuseDecision(transform);
}

function getContextScenarioReuseDecision(transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity) {
  return getRenderTransformReusePolicyOwner().getContextScenarioReuseDecision(transform);
}

function shouldStartExactAfterSettleFastPath() {
  return getRenderTransformReusePolicyOwner().shouldStartExactAfterSettleFastPath();
}

function ensureProjectedBoundsCache() {
  ensureProjectedBoundsCacheState(runtimeState);
  return runtimeState.projectedBoundsById;
}

function clearProjectedBoundsCache() {
  return getProjectedGeometryBoundsOwner().clearProjectedBoundsCache();
}

function isLineGeometryType(geometryType) {
  return geometryType === "LineString" || geometryType === "MultiLineString";
}

function recordProjectedBoundsDiagnosticsState(feature, reason = "unknown") {
  const geometryType = String(feature?.geometry?.type || "").trim() || "Unknown";
  const currentDiagnostics = captureProjectedBoundsDiagnosticsState(runtimeState);
  const currentByGeometryType = currentDiagnostics.byGeometryType
    && typeof currentDiagnostics.byGeometryType === "object"
    ? currentDiagnostics.byGeometryType
    : {};
  const currentByReason = currentDiagnostics.byReason
    && typeof currentDiagnostics.byReason === "object"
    ? currentDiagnostics.byReason
    : {};
  const diagnostics = {
    total: Math.max(0, Number(currentDiagnostics.total || 0) + 1),
    byGeometryType: {
      ...currentByGeometryType,
      [geometryType]: Math.max(0, Number(currentByGeometryType[geometryType] || 0) + 1),
    },
    byReason: {
      ...currentByReason,
      [reason]: Math.max(0, Number(currentByReason[reason] || 0) + 1),
    },
  };
  commitProjectedBoundsDiagnosticsState(runtimeState, diagnostics);
  recordRenderPerfMetric("projectedBoundsDiagnostics", 0, {
    total: diagnostics.total,
    byGeometryType: { ...diagnostics.byGeometryType },
    byReason: { ...diagnostics.byReason },
    lastGeometryType: geometryType,
    lastReason: reason,
  });
}

function recordProjectedBoundsDiagnostic(feature, reason = "unknown") {
  return getProjectedGeometryBoundsOwner().recordProjectedBoundsDiagnostic(feature, reason);
}

function computeProjectedFeatureBounds(feature) {
  return getProjectedGeometryBoundsOwner().computeProjectedFeatureBounds(feature);
}

function computeProjectedCoordinateBounds(geoObject) {
  return getProjectedGeometryBoundsOwner().computeProjectedCoordinateBounds(geoObject);
}

function computeProjectedGeoBounds(geoObject) {
  return getProjectedGeometryBoundsOwner().computeProjectedGeoBounds(geoObject);
}

function normalizeGeoObjectForSphericalDiagnostics(geoObject) {
  return getProjectedGeometryBoundsOwner().normalizeGeoObjectForSphericalDiagnostics(geoObject);
}

function getSphericalGeometryDiagnostics(geoObject) {
  return getProjectedGeometryBoundsOwner().getSphericalGeometryDiagnostics(geoObject);
}

function isSphericalGeometryUnsafe(geoObject) {
  return getProjectedGeometryBoundsOwner().isSphericalGeometryUnsafe(geoObject);
}

function collectPolygonalGeometryParts(geometry) {
  return getProjectedGeometryBoundsOwner().collectPolygonalGeometryParts(geometry);
}

function collectFeatureHitGeometries(feature) {
  return getProjectedGeometryBoundsOwner().collectFeatureHitGeometries(feature);
}

function buildWaterRegionFeatureFromParts(feature, parts) {
  return getProjectedGeometryBoundsOwner().buildWaterRegionFeatureFromParts(feature, parts);
}

function collectSafeWaterRegionGeometryPartsInfo(feature) {
  return getProjectedGeometryBoundsOwner().collectSafeWaterRegionGeometryPartsInfo(feature);
}

function collectSafeWaterRegionGeometryParts(feature) {
  return getProjectedGeometryBoundsOwner().collectSafeWaterRegionGeometryParts(feature);
}

function shouldExcludeWaterHitGeometry(hitGeometry, feature = null) {
  return getProjectedGeometryBoundsOwner().shouldExcludeWaterHitGeometry(hitGeometry, feature);
}

function sanitizeWaterRegionFeature(feature) {
  return getProjectedGeometryBoundsOwner().sanitizeWaterRegionFeature(feature);
}

function sanitizeWaterRegionFeatures(features = []) {
  return getProjectedGeometryBoundsOwner().sanitizeWaterRegionFeatures(features);
}

function rebuildProjectedBoundsCache() {
  return getProjectedGeometryBoundsOwner().rebuildProjectedBoundsCache();
}

function getProjectedFeatureBounds(feature, { featureId = null, allowCompute = true } = {}) {
  return getProjectedGeometryBoundsOwner().getProjectedFeatureBounds(feature, { featureId, allowCompute });
}

function mergeProjectedBounds(boundsList = []) {
  return getProjectedGeometryBoundsOwner().mergeProjectedBounds(boundsList);
}

function isKnownBadFeatureId(featureId) {
  if (!featureId) return false;
  return KNOWN_BAD_FEATURE_IDS.has(String(featureId));
}

function isAdmin0ShellFeature(feature, featureId) {
  const candidate = String(
    feature?.properties?.id ?? featureId ?? feature?.id ?? ""
  ).trim().toUpperCase();
  if (/^[A-Z]{2,3}$/.test(candidate)) {
    return true;
  }
  const detailTier = String(feature?.properties?.detail_tier || "").trim().toLowerCase();
  return detailTier === "antarctic_sector" && candidate.startsWith("AQ_");
}

function isScenarioShellFeature(feature, featureId = null) {
  if (String(feature?.properties?.scenario_helper_kind || "").trim().toLowerCase() === "shell_fallback") {
    return true;
  }
  const candidate = String(
    feature?.properties?.id ?? featureId ?? feature?.id ?? ""
  ).trim().toUpperCase();
  if (candidate.startsWith("RU_ARCTIC_FB_")) return true;
  return String(feature?.properties?.name || "").toLowerCase().includes("shell fallback");
}

function isRuntimeOnlyShellFallbackPoliticalFeature(feature, featureId = null) {
  return isScenarioShellFeature(feature, featureId)
    && feature?.properties?.render_as_base_geography === false;
}

function isPoliticalShellUnderlayFeature(feature, featureId = null) {
  return isRuntimeOnlyShellFallbackPoliticalFeature(feature, featureId);
}

function isPoliticalPrimaryUnderlayFeature(feature, _featureId = null) {
  return String(feature?.properties?.__source || "").trim().toLowerCase() === "primary";
}

function isPoliticalUnderlayFeature(feature, featureId = null) {
  return isPoliticalShellUnderlayFeature(feature, featureId)
    || isPoliticalPrimaryUnderlayFeature(feature, featureId);
}

function hasPoliticalForegroundColorOverride(featureId) {
  const id = String(featureId || "").trim();
  if (!id) return false;
  return !!(
    getSafeCanvasColor(runtimeState.visualOverrides?.[id], null)
    || getSafeCanvasColor(runtimeState.featureOverrides?.[id], null)
  );
}

function isPendingPoliticalColorEditFeature(feature, featureId = null) {
  const id = String(
    featureId
    || feature?.properties?.id
    || feature?.id
    || ""
  ).trim();
  if (!id || !hasPendingPoliticalColorEdit()) return false;
  const pendingIds = getRenderPassCacheState().pendingPoliticalColorEditIds;
  return pendingIds instanceof Set && pendingIds.has(id);
}

function isPoliticalForegroundFeature(feature, featureId = null) {
  const id = String(featureId || getFeatureId(feature) || "").trim();
  return hasPoliticalForegroundColorOverride(id)
    || isPendingPoliticalColorEditFeature(feature, id);
}

function hasVisiblePoliticalForegroundColorOverride(entries = []) {
  if (!Array.isArray(entries) || !entries.length) return false;
  return entries.some((entry) => {
    const feature = entry?.feature || entry;
    const featureId = entry?.id || getFeatureId(feature);
    return hasPoliticalForegroundColorOverride(featureId);
  });
}

function orderPoliticalShellUnderlayFirst(entries = []) {
  const underlayEntries = [];
  const detailEntries = [];
  const foregroundEntries = [];
  entries.forEach((entry) => {
    const feature = entry?.feature || entry;
    const featureId = entry?.id || getFeatureId(feature);
    let target = detailEntries;
    if (isPoliticalForegroundFeature(feature, featureId)) {
      target = foregroundEntries;
    } else if (isPoliticalUnderlayFeature(feature, featureId)) {
      target = underlayEntries;
    }
    target.push(entry);
  });
  return [...underlayEntries, ...detailEntries, ...foregroundEntries];
}

function shouldExcludeRuntimeOnlyShellFallbackPoliticalFeature(feature, featureId = null) {
  if (String(runtimeState.mapSemanticMode || "").trim().toLowerCase() === "blank") {
    return false;
  }
  return isRuntimeOnlyShellFallbackPoliticalFeature(feature, featureId);
}

function getAtlantropaGeometryRole(feature) {
  return String(feature?.properties?.atl_geometry_role || "").trim().toLowerCase();
}

function getAtlantropaJoinMode(feature) {
  return String(feature?.properties?.atl_join_mode || "").trim().toLowerCase();
}

function isAntarcticSectorFeature(feature, featureId = null) {
  const candidate = String(
    feature?.properties?.id ?? featureId ?? feature?.id ?? ""
  ).trim().toUpperCase();
  if (!candidate) return false;
  const countryCode = getFeatureCountryCodeNormalized(feature);
  const detailTier = String(feature?.properties?.detail_tier || "").trim().toLowerCase();
  return detailTier === "antarctic_sector" && (countryCode === "AQ" || candidate.startsWith("AQ_"));
}

function isAtlantropaSupportHelperFeature(feature, featureId = null) {
  if (isAtlantropaFieldDrivenFeature(feature)) {
    return feature?.properties?.atl_interactive !== true;
  }
  const candidate = String(
    feature?.properties?.id ?? featureId ?? feature?.id ?? ""
  ).trim().toUpperCase();
  if (
    candidate.startsWith("ATLSHL_")
    || candidate.startsWith("ATLWLD_")
    || candidate.startsWith("ATLSEA_FILL_")
  ) {
    return true;
  }
  if (isInteractiveAtlantropaBooleanWeldIslandFeature(feature, featureId)) {
    return false;
  }
  const geometryRole = getAtlantropaGeometryRole(feature);
  const joinMode = getAtlantropaJoinMode(feature);
  return (
    geometryRole === "shore_seal"
    || geometryRole === "sea_completion"
    || geometryRole === "donor_sea"
    || joinMode === "gap_fill"
    || joinMode === "boolean_weld"
  );
}

function isAtlantropaVisualSupportHelperFeature(feature, featureId = null) {
  if (isAtlantropaFieldDrivenFeature(feature)) {
    return false;
  }
  const candidate = String(
    feature?.properties?.id ?? featureId ?? feature?.id ?? ""
  ).trim().toUpperCase();
  if (
    candidate.startsWith("ATLSHL_")
    || candidate.startsWith("ATLWLD_")
    || candidate.startsWith("ATLSEA_FILL_")
  ) {
    return true;
  }
  const geometryRole = getAtlantropaGeometryRole(feature);
  const joinMode = getAtlantropaJoinMode(feature);
  return (
    geometryRole === "shore_seal"
    || geometryRole === "sea_completion"
    || geometryRole === "donor_sea"
    || joinMode === "gap_fill"
  );
}

function isPoliticalVisualRenderableFeature(feature, featureId = null) {
  if (!feature) return false;
  if (isAtlantropaFieldDrivenFeature(feature) && !isScenarioAtlantropaVisible()) return false;
  if (isAntarcticSectorFeature(feature, featureId)) return false;
  if (isBaseGeographyScenarioFeature(feature)) return false;
  if (isAtlantropaVisualSupportHelperFeature(feature, featureId)) return false;
  return true;
}

function shouldExcludePoliticalVisualFeature(feature, featureId = null) {
  return !isPoliticalVisualRenderableFeature(feature, featureId);
}

function isPoliticalInteractionRenderableFeature(feature, featureId = null) {
  if (!isPoliticalVisualRenderableFeature(feature, featureId)) return false;
  if (isScenarioShellFeature(feature, featureId)) return false;
  if (feature?.properties?.interactive === false) return false;
  if (isAtlantropaSupportHelperFeature(feature, featureId)) return false;
  return true;
}

function shouldExcludePoliticalInteractionFeature(feature, featureId = null) {
  return !isPoliticalInteractionRenderableFeature(feature, featureId);
}

function isGiantFeature(feature, canvasWidth, canvasHeight, boundsOverride = null) {
  const bounds = boundsOverride || getProjectedFeatureBounds(feature);
  if (!bounds) return false;
  return (
    bounds.width > canvasWidth * GIANT_FEATURE_CULL_RATIO &&
    bounds.height > canvasHeight * GIANT_FEATURE_CULL_RATIO
  );
}

function isProjectedWrapArtifact(feature, canvasWidth, canvasHeight, boundsOverride = null) {
  const bounds = boundsOverride || getProjectedFeatureBounds(feature);
  if (!bounds) return false;
  if (canvasWidth <= 0 || canvasHeight <= 0) return false;

  const widthRatio = bounds.width / canvasWidth;
  const heightRatio = bounds.height / canvasHeight;
  const areaRatio = bounds.area / (canvasWidth * canvasHeight);
  const aspectRatio = bounds.width / Math.max(bounds.height, 1);

  if (
    widthRatio >= WRAP_ARTIFACT_WIDTH_RATIO &&
    heightRatio >= WRAP_ARTIFACT_HEIGHT_RATIO
  ) {
    return true;
  }

  return (
    widthRatio >= WRAP_ARTIFACT_WIDTH_RATIO * 0.92 &&
    areaRatio >= WRAP_ARTIFACT_AREA_RATIO &&
    aspectRatio >= WRAP_ARTIFACT_ASPECT_MIN
  );
}

function evaluateSkipFeature(feature, canvasWidth, canvasHeight, { forceProd = false } = {}) {
  if (!forceProd && debugMode !== "PROD") {
    return { skip: false, reason: null, featureId: getFeatureId(feature), countryCode: "" };
  }

  const featureId = getFeatureId(feature);
  if (isKnownBadFeatureId(featureId)) {
    return {
      skip: true,
      reason: "known_bad_id",
      featureId,
      countryCode: getFeatureCountryCodeNormalized(feature),
      bounds: null,
    };
  }

  const bounds = getProjectedFeatureBounds(feature, { featureId });
  const countryCode = getFeatureCountryCodeNormalized(feature);
  if (!bounds) {
    return {
      skip: false,
      reason: null,
      featureId,
      countryCode,
      bounds: null,
    };
  }

  const isTrustedAdmin0Shell =
    GIANT_FEATURE_ALLOWLIST.has(countryCode) &&
    isAdmin0ShellFeature(feature, featureId);
  const spherical = getSphericalFeatureDiagnostics(feature, { featureId });
  if (spherical?.invalid && !isTrustedAdmin0Shell) {
    return {
      skip: true,
      reason: spherical.isWorldBounds ? "world_bounds" : "spherical_area",
      featureId,
      countryCode,
      bounds,
    };
  }

  const giant = isGiantFeature(feature, canvasWidth, canvasHeight, bounds);
  const wrapArtifact = isProjectedWrapArtifact(feature, canvasWidth, canvasHeight, bounds);
  if (!giant && !wrapArtifact) {
    return {
      skip: false,
      reason: null,
      featureId,
      countryCode: getFeatureCountryCodeNormalized(feature),
      bounds,
    };
  }

  if (isTrustedAdmin0Shell) {
    return {
      skip: false,
      reason: null,
      featureId,
      countryCode,
      bounds,
    };
  }

  let reason = "skip_unknown";
  if (giant && wrapArtifact) reason = "giant_wrap_artifact";
  else if (giant) reason = "giant_feature";
  else if (wrapArtifact) reason = "wrap_artifact";

  return {
    skip: true,
    reason,
    featureId,
    countryCode,
    bounds,
  };
}

function shouldSkipFeature(feature, canvasWidth, canvasHeight, { forceProd = false } = {}) {
  const decision = evaluateSkipFeature(feature, canvasWidth, canvasHeight, { forceProd });
  recordTargetGeometryDiagnostic(feature, decision);
  recordSkipDiagnostic(feature, decision);
  return Boolean(decision.skip);
}

function getRenderableLandFeatures(canvasWidth, canvasHeight, { forceProd = false } = {}) {
  if (!runtimeState.landData?.features?.length) return [];
  return runtimeState.landData.features.filter(
    (feature) => !shouldSkipFeature(feature, canvasWidth, canvasHeight, { forceProd })
  );
}

function isWorldBounds(bounds) {
  return !!(
    Array.isArray(bounds) &&
    bounds.length === 2 &&
    Array.isArray(bounds[0]) &&
    Array.isArray(bounds[1]) &&
    Math.abs(Number(bounds[0][0]) + 180) < 1e-9 &&
    Math.abs(Number(bounds[0][1]) + 90) < 1e-9 &&
    Math.abs(Number(bounds[1][0]) - 180) < 1e-9 &&
    Math.abs(Number(bounds[1][1]) - 90) < 1e-9
  );
}

function getSphericalFeatureDiagnostics(feature, { featureId = null, allowCompute = true } = {}) {
  const resolvedFeatureId = featureId || getFeatureId(feature);
  ensureProjectedBoundsCache();
  const cachedDiagnostics = resolvedFeatureId
    ? getSphericalFeatureDiagnosticsCacheEntryState(runtimeState, resolvedFeatureId)
    : null;
  if (cachedDiagnostics) {
    return cachedDiagnostics;
  }
  if (!allowCompute || !globalThis.d3?.geoArea || !globalThis.d3?.geoBounds || !feature?.geometry) {
    return null;
  }

  const diagnostics = getSphericalGeometryDiagnostics(feature);
  if (resolvedFeatureId && diagnostics) {
    setSphericalFeatureDiagnosticsCacheEntryState(runtimeState, resolvedFeatureId, diagnostics);
  }
  return diagnostics;
}

function getMaxDprForProfile(renderProfile) {
  const profile = String(renderProfile || "auto").trim().toLowerCase();
  const deviceDpr = Math.max(1, Number(globalThis.devicePixelRatio) || 1);
  const baseMaxDpr = profile === "full"
    ? deviceDpr
    : profile === "balanced"
      ? 1.5
      : 1.25;
  const stage = String(runtimeState.dprStage || "idle").toLowerCase();
  if (stage === "interactive") {
    const scale = Math.min(1, Math.max(0.5, Number(runtimeState.dprInteractiveScale) || 0.72));
    return Math.max(1, baseMaxDpr * scale);
  }
  return baseMaxDpr;
}

function updateDprStage(nextStage = "idle", { force = false } = {}) {
  const normalizedStage = String(nextStage || "idle").toLowerCase() === "interactive"
    ? "interactive"
    : "idle";
  if (!force && runtimeState.dprStage === normalizedStage) {
    return false;
  }
  commitRendererDprStageState(runtimeState, {
    stage: normalizedStage,
    switchedAt: nowMs(),
  });
  return true;
}

function getRuntimePoliticalBaseCollection(collection) {
  const features = Array.isArray(collection?.features) ? collection.features : [];
  if (!features.length) return null;
  if (String(runtimeState.mapSemanticMode || "").trim().toLowerCase() === "blank") {
    return collection;
  }
  const baseFeatures = features.filter((feature, index) => !shouldExcludeRuntimeOnlyShellFallbackPoliticalFeature(
    feature,
    getFeatureId(feature) || `feature-${index}`,
  ));
  if (!baseFeatures.length) return null;
  if (baseFeatures.length === features.length) return collection;
  return { ...collection, features: baseFeatures };
}

function rebuildPoliticalLandCollections() {
  const startedAt = nowMs();
  let runtimeCollectionMs = 0;
  let composeMs = 0;
  let atlantropaMs = 0;
  let interactiveMs = 0;
  let coverageMs = 0;
  const primaryTopology = runtimeState.topologyPrimary || runtimeState.topology;
  const detailTopology = runtimeState.topologyBundleMode === "composite" ? runtimeState.topologyDetail : null;
  const overrideCollection = runtimeState.topologyBundleMode === "composite" ? runtimeState.ruCityOverrides : null;
  const runtimeTopology = runtimeState.topologyBundleMode === "composite"
    ? (runtimeState.scenarioRuntimeTopologyData || runtimeState.runtimePoliticalTopology)
    : null;
  const scenarioPoliticalChunkCollection = Array.isArray(runtimeState.scenarioPoliticalChunkData?.features)
    ? runtimeState.scenarioPoliticalChunkData
    : null;
  const scenarioPoliticalVisibleChunkCollection = Array.isArray(runtimeState.scenarioPoliticalVisibleChunkData?.features)
    ? runtimeState.scenarioPoliticalVisibleChunkData
    : null;

  let fullCollection = runtimeState.landDataFull || runtimeState.landData || null;
  const runtimeCollectionStartedAt = nowMs();
  const runtimeCollection = runtimeTopology?.objects?.political && globalThis.topojson
    ? getPoliticalFeatureCollection(runtimeTopology, "runtime")
    : null;
  const runtimeBaseCollection = getRuntimePoliticalBaseCollection(runtimeCollection);
  runtimeCollectionMs = nowMs() - runtimeCollectionStartedAt;
  const hasScenarioRuntimePoliticalSource = !!String(runtimeState.activeScenarioId || "").trim()
    && !!runtimeTopology?.objects?.political;
  if (runtimeBaseCollection) {
    fullCollection = runtimeBaseCollection;
  } else if (hasScenarioRuntimePoliticalSource) {
    fullCollection = { type: "FeatureCollection", features: [] };
  } else if (primaryTopology?.objects?.political && globalThis.topojson) {
    const composeStartedAt = nowMs();
    fullCollection = runtimeState.topologyBundleMode === "composite"
      ? composePoliticalFeatures(primaryTopology, detailTopology, overrideCollection)
      : getPoliticalFeatureCollection(primaryTopology, "primary");
    composeMs = nowMs() - composeStartedAt;
  }
  if (scenarioPoliticalChunkCollection) {
    const composeStartedAt = nowMs();
    fullCollection = composePoliticalFeatureCollections(fullCollection, scenarioPoliticalChunkCollection);
    composeMs += nowMs() - composeStartedAt;
  }
  const atlantropaStartedAt = nowMs();
  fullCollection = appendUniqueFeatureCollections(
    fullCollection,
    buildAtlantropaLandLikeFeatureCollection()
  );
  atlantropaMs = nowMs() - atlantropaStartedAt;

  const interactiveStartedAt = nowMs();
  const interactiveCollection = buildInteractiveLandData(fullCollection);
  interactiveMs = nowMs() - interactiveStartedAt;
  runtimeState.landDataFull = fullCollection;
  runtimeState.landData = interactiveCollection;
  const coverageStartedAt = nowMs();
  setDebugCountryCoverageState(
    runtimeState,
    collectCountryCoverageStats(
      Array.isArray(fullCollection?.features) ? fullCollection.features : [],
    ),
  );
  coverageMs = nowMs() - coverageStartedAt;

  const fullCount = Array.isArray(fullCollection?.features) ? fullCollection.features.length : 0;
  const interactiveCount = Array.isArray(interactiveCollection?.features) ? interactiveCollection.features.length : 0;
  if (interactiveCount < fullCount) {
    console.info(
      `[map_renderer] Interactive land filter removed ${fullCount - interactiveCount} aggregate support tier features.`
    );
  }

  recordRenderPerfMetric("rebuildPoliticalLandCollections", nowMs() - startedAt, {
    fullFeatureCount: fullCount,
    interactiveFeatureCount: interactiveCount,
  });
  recordRenderPerfMetric("rebuildPoliticalLandCollectionsBreakdown", nowMs() - startedAt, {
    fullFeatureCount: fullCount,
    interactiveFeatureCount: interactiveCount,
    scenarioChunkFeatureCount: Array.isArray(scenarioPoliticalChunkCollection?.features)
      ? scenarioPoliticalChunkCollection.features.length
      : 0,
    scenarioChunkVisibleFeatureCount: Array.isArray(scenarioPoliticalVisibleChunkCollection?.features)
      ? scenarioPoliticalVisibleChunkCollection.features.length
      : 0,
    runtimeCollectionMs: Math.max(0, runtimeCollectionMs),
    composeMs: Math.max(0, composeMs),
    atlantropaMs: Math.max(0, atlantropaMs),
    interactiveMs: Math.max(0, interactiveMs),
    coverageMs: Math.max(0, coverageMs),
  });
  return { fullCollection, interactiveCollection };
}

function clearRenderPhaseTimer() {
  getRenderPhaseLifecycleOwner().clearRenderPhaseTimer();
}

function clamp01(value) {
  return Math.min(1, Math.max(0, Number(value) || 0));
}

function getAdaptiveSettleProfile(scaleDelta = Number(runtimeState.zoomGestureScaleDelta || 0)) {
  const normalizedDelta = clamp01(
    (Math.max(0, Number(scaleDelta) || 0) - ZOOM_SETTLE_ADAPTIVE_DELTA_MIN)
    / Math.max(0.0001, ZOOM_SETTLE_ADAPTIVE_DELTA_MAX - ZOOM_SETTLE_ADAPTIVE_DELTA_MIN)
  );
  return {
    scaleDelta: Math.max(0, Number(scaleDelta) || 0),
    normalizedDelta,
    settleDurationMs: Math.round(
      RENDER_SETTLE_DURATION_MS_MIN
      + ((RENDER_SETTLE_DURATION_MS - RENDER_SETTLE_DURATION_MS_MIN) * normalizedDelta)
    ),
    exactQuietWindowMs: Math.round(
      EXACT_AFTER_SETTLE_QUIET_WINDOW_MS_MIN
      + ((EXACT_AFTER_SETTLE_QUIET_WINDOW_MS - EXACT_AFTER_SETTLE_QUIET_WINDOW_MS_MIN) * normalizedDelta)
    ),
  };
}

function setRenderPhase(phase) {
  getRenderPhaseLifecycleOwner().setRenderPhase(phase);
}

function isInteractionRecoveryBlocked() {
  return (
    runtimeState.renderPhase !== RENDER_PHASE_IDLE
    || runtimeState.isInteracting
    || isExactAfterSettleControllerActive()
    || !!runtimeState.activeInteractionRecoveryTaskKey
  );
}

function isInteractionRecoverySettled({ quietMs = 600 } = {}) {
  if (isInteractionRecoveryBlocked() || runtimeState.deferExactAfterSettle) {
    return false;
  }
  const currentMs = nowMs();
  const phaseEnteredAt = Number(runtimeState.phaseEnteredAt || 0);
  const zoomEndedAt = Number(runtimeState.zoomGestureEndedAt || 0);
  const idleForMs = phaseEnteredAt > 0 ? currentMs - phaseEnteredAt : Number.POSITIVE_INFINITY;
  const zoomQuietForMs = zoomEndedAt > 0 ? currentMs - zoomEndedAt : Number.POSITIVE_INFINITY;
  const requiredQuietMs = Math.max(0, Number(quietMs) || 0);
  return idleForMs >= requiredQuietMs && zoomQuietForMs >= requiredQuietMs;
}

function beginInteractionRecoveryTask(taskKey) {
  const normalizedTaskKey = String(taskKey || "interaction-recovery").trim() || "interaction-recovery";
  if (runtimeState.activeInteractionRecoveryTaskKey) {
    recordRenderPerfMetric("interactionRecoveryTaskBlocked", 0, {
      taskKey: normalizedTaskKey,
      activeTaskKey: String(runtimeState.activeInteractionRecoveryTaskKey || ""),
    });
    return false;
  }
  const startedAt = nowMs();
  const started = beginInteractionRecoveryTaskState(runtimeState, {
    taskKey: normalizedTaskKey,
    startedAt,
    expectedActiveTaskKey: "",
  });
  if (!started) {
    return false;
  }
  recordRenderPerfMetric("interactionRecoveryTaskStarted", 0, {
    taskKey: normalizedTaskKey,
    activeScenarioId: String(runtimeState.activeScenarioId || ""),
  });
  return true;
}

function endInteractionRecoveryTask(taskKey) {
  const normalizedTaskKey = String(taskKey || "interaction-recovery").trim() || "interaction-recovery";
  endInteractionRecoveryTaskState(runtimeState, normalizedTaskKey);
}

function getInteractionRecoveryChunkState() {
  const loadState = runtimeState.runtimeChunkLoadState && typeof runtimeState.runtimeChunkLoadState === "object"
    ? runtimeState.runtimeChunkLoadState
    : {};
  return {
    shellStatus: String(loadState.shellStatus || ""),
    hasPendingPromotion: !!loadState.pendingPromotion,
    hasPendingVisualPromotion: !!loadState.pendingVisualPromotion,
    hasPendingInfraPromotion: !!loadState.pendingInfraPromotion,
    pendingReason: String(loadState.pendingReason || ""),
    promotionRetryCount: Math.max(0, Number(loadState.promotionRetryCount || 0)),
  };
}

function recordInteractionRecoveryTaskMetric(taskKey, durationMs, details = {}, { benchmarkInteraction = true } = {}) {
  const normalizedTaskKey = String(taskKey || "interaction-recovery").trim() || "interaction-recovery";
  const chunkState = getInteractionRecoveryChunkState();
  const taskMetricName = benchmarkInteraction ? "interactionRecoveryTaskMs" : "postReadyInteractionInfrastructureTaskMs";
  const windowMetricName = benchmarkInteraction ? "interactionRecoveryWindowMs" : "postReadyInteractionInfrastructureWindowMs";
  const entry = recordRenderPerfMetric(taskMetricName, durationMs, {
    taskKey: normalizedTaskKey,
    activeScenarioId: String(runtimeState.activeScenarioId || ""),
    renderPhase: String(runtimeState.renderPhase || ""),
    isInteracting: !!runtimeState.isInteracting,
    deferExactAfterSettle: !!runtimeState.deferExactAfterSettle,
    interactionInfrastructureBuildInFlight: !!runtimeState.interactionInfrastructureBuildInFlight,
    activeInteractionRecoveryTaskKey: String(runtimeState.activeInteractionRecoveryTaskKey || ""),
    hitCanvasBuildScheduled: !!runtimeState.hitCanvasBuildScheduled,
    ...chunkState,
    ...details,
  });
  recordRenderPerfMetric(windowMetricName, Math.max(0, nowMs() - Number(runtimeState.zoomGestureEndedAt || nowMs())), {
    taskKey: normalizedTaskKey,
    chunkState,
    activePostReadyTaskKey: String(runtimeState.activePostReadyTaskKey || ""),
    postReadyPendingTaskCount: Math.max(0, Number(runtimeState.postReadyTaskDiagnostics?.pendingTaskCount || 0)),
  });
  return entry;
}

function markOverlaysDirty({
  frontline = false,
  operationalLines = false,
  operationGraphics = false,
  unitCounters = false,
  specialZones = false,
  inspector = false,
  hover = false,
} = {}) {
  getStrategicOverlayRenderOwner().markOverlaysDirty({
    frontline,
    operationalLines,
    operationGraphics,
    unitCounters,
    specialZones,
  });
  if (inspector) runtimeState.inspectorOverlayDirty = true;
  if (hover) getMapHoverInteractionOwner().setHoverOverlayDirty(true);
}

function markAllOverlaysDirty() {
  getStrategicOverlayRenderOwner().markAllOverlaysDirty();
  runtimeState.inspectorOverlayDirty = true;
  getMapHoverInteractionOwner().setHoverOverlayDirty(true);
}

function getOverlayProjectionSignature() {
  return [
    Number(runtimeState.topologyRevision || 0),
    getProjectionRenderSignature(),
  ].join("::");
}

function renderSpecialZonesIfNeeded({ force = false } = {}) {
  getStrategicOverlayRenderOwner().renderSpecialZonesIfNeeded({ force });
}

function renderFrontlineOverlayIfNeeded({ force = false } = {}) {
  getStrategicOverlayRenderOwner().renderFrontlineOverlayIfNeeded({ force });
}

function renderOperationGraphicsIfNeeded({ force = false } = {}) {
  getStrategicOverlayRenderOwner().renderOperationGraphicsIfNeeded({ force });
}

function renderOperationalLinesIfNeeded({ force = false } = {}) {
  getStrategicOverlayRenderOwner().renderOperationalLinesIfNeeded({ force });
}

function renderUnitCountersIfNeeded({ force = false } = {}) {
  getStrategicOverlayRenderOwner().renderUnitCountersIfNeeded({ force });
}

function renderInspectorHighlightOverlayIfNeeded({ force = false } = {}) {
  return getSelectionOverlayOwner().renderInspectorHighlightOverlayIfNeeded({ force });
}

function renderHoverOverlayIfNeeded({ force = false, eventType = "hover" } = {}) {
  return getMapHoverInteractionOwner().renderHoverOverlayIfNeeded({ force, eventType });
}

function cancelScheduledHoverOverlayRender() {
  getMapHoverInteractionOwner().cancelPendingHoverWork();
}


function renderDevSelectionOverlay() {
  return getSelectionOverlayOwner().renderDevSelectionOverlay();
}

function renderDevSelectionOverlayIfNeeded({ force = false } = {}) {
  return getSelectionOverlayOwner().renderDevSelectionOverlayIfNeeded({ force });
}

function queueTooltipUpdate(nextState = null) {
  getMapHoverInteractionOwner().queueTooltipUpdate(nextState);
}

function scheduleRenderPhaseIdle() {
  getRenderPhaseLifecycleOwner().scheduleRenderPhaseIdle();
}

function flushPendingScenarioChunkRefreshAfterExact(reason = "exact-after-settle") {
  if (pendingScenarioChunkFlushAfterExactHandle) {
    globalThis.clearTimeout(pendingScenarioChunkFlushAfterExactHandle);
    pendingScenarioChunkFlushAfterExactHandle = null;
  }
  if (typeof runtimeState.scheduleScenarioChunkRefreshFn !== "function") {
    return;
  }
  const loadState = runtimeState.runtimeChunkLoadState;
  const hasPendingPromotion = !!loadState?.pendingPromotion;
  const hasPendingReason = !!String(loadState?.pendingReason || "").trim();
  if (!hasPendingPromotion && !hasPendingReason) {
    return;
  }
  pendingScenarioChunkFlushAfterExactHandle = globalThis.setTimeout(() => {
    pendingScenarioChunkFlushAfterExactHandle = null;
    if (typeof runtimeState.scheduleScenarioChunkRefreshFn !== "function") {
      return;
    }
    const nextLoadState = runtimeState.runtimeChunkLoadState;
    const stillHasPendingPromotion = !!nextLoadState?.pendingPromotion;
    const stillHasPendingReason = !!String(nextLoadState?.pendingReason || "").trim();
    if (!stillHasPendingPromotion && !stillHasPendingReason) {
      return;
    }
    if (runtimeState.renderPhase !== RENDER_PHASE_IDLE || runtimeState.deferExactAfterSettle) {
      return;
    }
    runtimeState.scheduleScenarioChunkRefreshFn({
      reason,
      delayMs: 0,
      flushPending: true,
    });
  }, 0);
}

function rebuildResolvedColors() {
  const startedAt = nowMs();
  const previousColorRevision = Number(runtimeState.colorRevision || 0);
  migrateLegacyColorState();
  ensureSovereigntyState();
  normalizeColorStateForRender(state, {
    sanitizeColorMap,
    sanitizeCountryColorMap,
  });

  const nextColors = {};
  const colorSourceFeatures = getResolvedColorSourceFeatures();
  if (!colorSourceFeatures.length) {
    replaceResolvedColorsState(state, nextColors);
    recordColorRebuildDiagnostics(runtimeState, {
      phase: "color-rebuild-empty-source", previousColorRevision, sourceFeatureCount: 0, resolvedColorCount: 0,
    });
    recordRenderPerfMetric("rebuildResolvedColors", nowMs() - startedAt, {
      featureCount: 0,
      sourceFeatureCount: 0,
      source: "none",
    });
    return nextColors;
  }

  // Resolved colors are feature data, so full-table rebuilds stay independent
  // from the current canvas, zoom, pan, and draw-time culling decisions.
  colorSourceFeatures.forEach((feature, index) => {
    const id = getFeatureId(feature) || `feature-${index}`;
    if (!id) return;
    const resolved = getResolvedFeatureColor(feature, id);
    if (resolved) {
      nextColors[id] = resolved;
    }
  });

  replaceResolvedColorsState(state, nextColors);
  bumpColorRevision(state);
  retargetPendingPoliticalColorEditRevisionAfterColorRebuild(previousColorRevision);
  invalidateRenderPasses(["physicalBase", "political", "contextBase"], "rebuild-colors");
  recordColorRebuildDiagnostics(runtimeState, {
    phase: "color-rebuild-complete", previousColorRevision, sourceFeatureCount: colorSourceFeatures.length, resolvedColorCount: Object.keys(nextColors).length, sourceName: getResolvedColorSourceName(),
  });
  recordRenderPerfMetric("rebuildResolvedColors", nowMs() - startedAt, {
    featureCount: Object.keys(nextColors).length,
    sourceFeatureCount: colorSourceFeatures.length,
    source: getResolvedColorSourceName(),
  });
  return nextColors;
}

function getResolvedColorSourceFeatures() {
  const fullFeatures = getFullLandDataFeatures();
  if (fullFeatures.length) {
    return fullFeatures;
  }
  return Array.isArray(runtimeState.landData?.features) ? runtimeState.landData.features : [];
}

function getResolvedColorSourceName() {
  return Array.isArray(runtimeState.landDataFull?.features) && runtimeState.landDataFull.features.length
    ? "landDataFull"
    : "landData";
}

let visibleFrameColorReadinessAttemptSignature = "";

function ensureResolvedColorsReadyForStableVisibleFrame(reason = "visible-frame") {
  const colorSourceName = getResolvedColorSourceName();
  const colorSourceFeatureCount = getResolvedColorSourceFeatures().length;
  const landFeatureCount = Math.max(
    getFullLandDataFeatures().length,
    Array.isArray(runtimeState.landData?.features) ? runtimeState.landData.features.length : 0,
  );
  if (landFeatureCount <= 0) return false;
  if (Object.keys(runtimeState.colors || {}).length > 0) return false;
  const attemptSignature = [
    String(runtimeState.activeScenarioId || ""),
    Number(runtimeState.sceneGeneration || 0),
    Number(runtimeState.scenarioDataGeneration || 0),
    Number(runtimeState.topologyRevision || 0),
    Number(runtimeState.colorRevision || 0),
    colorSourceName,
    colorSourceFeatureCount,
    landFeatureCount,
  ].join("|");
  if (visibleFrameColorReadinessAttemptSignature === attemptSignature) return false;
  visibleFrameColorReadinessAttemptSignature = attemptSignature;
  const startedAt = nowMs();
  const colors = rebuildResolvedColors();
  const resolvedColorCount = Object.keys(colors || {}).length;
  if (resolvedColorCount > 0) {
    visibleFrameColorReadinessAttemptSignature = "";
  }
  recordRenderPerfMetric("visibleFrameResolvedColorReadiness", nowMs() - startedAt, {
    reason: String(reason || "visible-frame"),
    landFeatureCount,
    resolvedColorCount,
    colorRevision: Number(runtimeState.colorRevision || 0),
    sourceFeatureCount: colorSourceFeatureCount,
    sourceName: colorSourceName,
  });
  return resolvedColorCount > 0;
}

function findResolvedColorFeatureById(featureId) {
  const id = String(featureId || "").trim();
  if (!id) return null;
  const indexedFeature = runtimeState.landIndex?.get(id);
  if (indexedFeature) {
    return indexedFeature;
  }
  const features = getResolvedColorSourceFeatures();
  for (let index = 0; index < features.length; index += 1) {
    const feature = features[index];
    const candidateId = getFeatureId(feature) || `feature-${index}`;
    if (candidateId === id) {
      return feature;
    }
  }
  return null;
}

function collectResolvedColorFeatureIdsForOwners(ownerCodes = []) {
  const ownerSet = new Set(
    (Array.isArray(ownerCodes) ? ownerCodes : [])
      .map((ownerCode) => canonicalCountryCode(ownerCode))
      .filter(Boolean)
  );
  const ids = new Set();
  ownerSet.forEach((ownerCode) => {
    getFeatureIdsForOwner(ownerCode).forEach((id) => ids.add(id));
  });
  getResolvedColorSourceFeatures().forEach((feature, index) => {
    const id = getFeatureId(feature) || `feature-${index}`;
    if (!id) return;
    const ownerCode = canonicalCountryCode(
      getDisplayOwnerCode(feature, id)
      || getFeatureCountryCodeNormalized(feature)
    );
    if (ownerSet.has(ownerCode)) {
      ids.add(id);
    }
  });
  return Array.from(ids);
}

function shouldRefreshContextBaseContoursForColorChanges() {
  const cfg = normalizePhysicalStyleConfig(runtimeState.styleConfig?.physical);
  return !!(
    runtimeState.showPhysical
    && cfg.mode !== "atlas_only"
    && Array.isArray(runtimeState.physicalContourMajorData?.features)
    && runtimeState.physicalContourMajorData.features.length > 0
  );
}

function shouldRefreshContextBaseUrbanForColorChanges() {
  const urbanConfig = normalizeUrbanStyleConfig(runtimeState.styleConfig?.urban || {});
  const capability = runtimeState.urbanLayerCapability || getUrbanLayerCapability(runtimeState.urbanData);
  return !!runtimeState.showUrban
    && Array.isArray(runtimeState.urbanData?.features)
    && runtimeState.urbanData.features.length > 0
    && getEffectiveUrbanMode(urbanConfig, capability) === "adaptive";
}

function shouldRefreshContextBaseForColorChanges() {
  return shouldRefreshContextBaseContoursForColorChanges()
    || shouldRefreshContextBaseUrbanForColorChanges();
}

function normalizePoliticalColorEditIds(featureIds) {
  const values = featureIds instanceof Set
    ? Array.from(featureIds)
    : (Array.isArray(featureIds) ? featureIds : []);
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function markPendingPoliticalColorEdit(featureIds, { reason = "refresh-colors", startedAt = 0, inputLabel = "" } = {}) {
  const ids = normalizePoliticalColorEditIds(featureIds);
  if (!ids.length) return false;
  const cache = getRenderPassCacheState();
  const previousStartedAt = Number(cache.pendingPoliticalColorEditStartedAt || 0);
  const previousFirstPixelRecorded = !!cache.pendingPoliticalColorEditFirstPixelRecorded;
  const previousFirstPixelPaintSource = String(cache.pendingPoliticalColorEditFirstPixelPaintSource || "");
  const normalizedStartedAt = Number(startedAt) > 0
    ? Number(startedAt)
    : Number(cache.pendingPoliticalColorEditStartedAt || 0);
  cache.pendingPoliticalColorEditIds = new Set(ids);
  cache.pendingPoliticalColorEditRevision = Number(runtimeState.colorRevision || 0);
  cache.pendingPoliticalColorEditScenarioId = String(runtimeState.activeScenarioId || "");
  cache.pendingPoliticalColorEditReason = String(reason || "refresh-colors");
  cache.pendingPoliticalColorEditStartedAt = normalizedStartedAt;
  cache.pendingPoliticalColorEditInputLabel = String(inputLabel || cache.pendingPoliticalColorEditInputLabel || reason || "refresh-colors");
  cache.pendingPoliticalColorEditFirstPixelRecorded = previousStartedAt > 0
    && previousStartedAt === normalizedStartedAt
    && previousFirstPixelRecorded;
  cache.pendingPoliticalColorEditFirstPixelPaintSource = cache.pendingPoliticalColorEditFirstPixelRecorded
    ? previousFirstPixelPaintSource
    : "";
  return true;
}

function hasPendingPoliticalColorEdit() {
  const cache = getRenderPassCacheState();
  const pendingIds = cache.pendingPoliticalColorEditIds;
  const pendingScenarioId = String(cache.pendingPoliticalColorEditScenarioId || "");
  const activeScenarioId = String(runtimeState.activeScenarioId || "");
  return pendingIds instanceof Set
    && pendingIds.size > 0
    && (!pendingScenarioId || pendingScenarioId === activeScenarioId)
    && Number(cache.pendingPoliticalColorEditRevision ?? -1) === Number(runtimeState.colorRevision || 0);
}

function getPendingPoliticalColorEditInputToPixelMs(cache = getRenderPassCacheState()) {
  const startedAt = Number(cache.pendingPoliticalColorEditStartedAt || 0);
  return startedAt > 0 ? Math.max(0, nowMs() - startedAt) : 0;
}

function recordFillPatchFirstPixelMetric({ renderedCount = 0, renderedIds = null, paintSource = "political-pass" } = {}) {
  const cache = getRenderPassCacheState();
  const inputToFirstPixelMs = getPendingPoliticalColorEditInputToPixelMs(cache);
  if (Number(cache.pendingPoliticalColorEditStartedAt || 0) <= 0) return null;
  if (cache.pendingPoliticalColorEditFirstPixelRecorded) return null;
  const renderedIdCount = renderedIds instanceof Set
    ? renderedIds.size
    : (Array.isArray(renderedIds) ? renderedIds.length : 0);
  incrementPerfCounter("fillPatchFirstPixelCount");
  cache.pendingPoliticalColorEditFirstPixelRecorded = true;
  cache.pendingPoliticalColorEditFirstPixelPaintSource = String(paintSource || "political-pass");
  return recordRenderPerfMetric("fillPatchInputToFirstPixelMs", inputToFirstPixelMs, {
    inputToFirstPixelMs,
    paintSource: String(paintSource || "political-pass"),
    inputLabel: String(cache.pendingPoliticalColorEditInputLabel || cache.pendingPoliticalColorEditReason || "refresh-colors"),
    pendingReason: String(cache.pendingPoliticalColorEditReason || "refresh-colors"),
    activeScenarioId: String(runtimeState.activeScenarioId || ""),
    pendingFeatureCount: cache.pendingPoliticalColorEditIds instanceof Set ? cache.pendingPoliticalColorEditIds.size : 0,
    renderedCount: Math.max(0, Number(renderedCount || 0)),
    renderedIdCount,
    colorRevision: Number(runtimeState.colorRevision || 0),
    count: Number(cache.counters.fillPatchFirstPixelCount || 0),
  });
}

function clearPoliticalPatchOverlay(reason = "clear") {
  const cleared = clearCanvasLayer(getCanvasLayer(rendererSurfaceHost.getCanvasLayers(), CANVAS_LAYER_NAMES.politicalPatch));
  if (cleared) {
    getRenderPassCacheState().pendingPoliticalPatchOverlayTransformSignature = "";
    recordRenderPerfMetric("politicalPatchOverlayClear", 0, {
      reason: String(reason || "clear"),
      activeScenarioId: String(runtimeState.activeScenarioId || ""),
    });
  }
  return cleared;
}

function clearPoliticalPatchOverlayIfStale(reason = "stale-overlay") {
  const cache = getRenderPassCacheState();
  const currentSignature = getTransformSignature(runtimeState.zoomTransform || globalThis.d3?.zoomIdentity);
  if (!shouldClearStaleCanvasOverlay({
    overlayTransformSignature: cache.pendingPoliticalPatchOverlayTransformSignature,
    currentTransformSignature: currentSignature,
    renderPhase: runtimeState.renderPhase,
    idleRenderPhase: RENDER_PHASE_IDLE,
    deferExactAfterSettle: runtimeState.deferExactAfterSettle,
  })) {
    return false;
  }
  return clearPoliticalPatchOverlay(reason);
}

function paintPoliticalPatchOverlayForIds(featureIds, { inputLabel = "refresh-colors" } = {}) {
  if (!rendererSurfaceHost.getPoliticalPatchContext()?.canvas || !rendererSurfaceHost.getProjection() || !rendererSurfaceHost.getPathCanvas()) return false;
  const ids = normalizePoliticalColorEditIds(featureIds);
  if (!ids.length) {
    clearPoliticalPatchOverlay("empty-pending-edit");
    return false;
  }
  const features = ids
    .map((id) => ({ id, feature: findResolvedColorFeatureById(id) }))
    .filter((entry) => entry.feature?.geometry);
  if (!features.length) {
    clearPoliticalPatchOverlay("pending-edit-no-features");
    return false;
  }
  clearPoliticalPatchOverlay("pending-edit-repaint");
  const startedAt = nowMs();
  const transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity;
  const transformSignature = getTransformSignature(transform);
  const [canvasWidth, canvasHeight] = getLogicalCanvasDimensions();
  const metricsCollector = {
    fillMs: 0,
    strokeMs: 0,
    renderedCount: 0,
    renderedIds: new Set(),
  };
  rendererSurfaceHost.getPoliticalPatchContext().save();
  const k = prepareTargetContext(rendererSurfaceHost.getPoliticalPatchContext(), transform);
  withRenderTarget(rendererSurfaceHost.getPoliticalPatchContext(), () => {
    orderPoliticalShellUnderlayFirst(features).forEach(({ feature, id }, index) => {
      drawPoliticalFeature(feature, index, {
        k,
        canvasWidth,
        canvasHeight,
        transform,
        skipScreenCheck: false,
        useCachedPath: true,
        allowBuildPath: true,
        countPathBuild: false,
        metricsCollector,
      });
      if (metricsCollector.renderedIds instanceof Set && id) {
        metricsCollector.renderedIds.add(id);
      }
    });
  });
  rendererSurfaceHost.getPoliticalPatchContext().restore();
  const renderedCount = Number(metricsCollector.renderedCount || 0);
  recordRenderPerfMetric("politicalPatchOverlayPaint", nowMs() - startedAt, {
    inputLabel: String(inputLabel || "refresh-colors"),
    requestedFeatureCount: ids.length,
    candidateFeatureCount: features.length,
    renderedCount,
    activeScenarioId: String(runtimeState.activeScenarioId || ""),
    colorRevision: Number(runtimeState.colorRevision || 0),
  });
  recordPoliticalPatchOverlayPaintDiagnostics(runtimeState, {
    inputLabel, requestedFeatureCount: ids.length, candidateFeatureCount: features.length, renderedCount,
  });
  if (renderedCount > 0) {
    getRenderPassCacheState().pendingPoliticalPatchOverlayTransformSignature = transformSignature;
    recordFillPatchFirstPixelMetric({
      renderedCount,
      renderedIds: metricsCollector.renderedIds,
      paintSource: "political-patch-overlay",
    });
  }
  return renderedCount > 0;
}

function clearPendingPoliticalColorEdit({
  renderedCount = 0,
  renderedIds = null,
  force = false,
  paintSource = "political-pass",
  resetReason = "",
} = {}) {
  const cache = getRenderPassCacheState();
  const preClearPendingIds = cache.pendingPoliticalColorEditIds instanceof Set ? new Set(cache.pendingPoliticalColorEditIds) : new Set();
  const preClearPendingFeatureCount = preClearPendingIds.size;
  const preClearPendingReason = String(cache.pendingPoliticalColorEditReason || "");
  const preClearInputLabel = String(cache.pendingPoliticalColorEditInputLabel || "");
  const preClearFirstPixelRecorded = !!cache.pendingPoliticalColorEditFirstPixelRecorded;
  const renderedIdCount = renderedIds instanceof Set ? renderedIds.size : (Array.isArray(renderedIds) ? renderedIds.length : 0);
  const reset = (resetReason = "pending-edit-cleared") => {
    if (cache.pendingPoliticalColorEditIds instanceof Set) cache.pendingPoliticalColorEditIds.clear(); else cache.pendingPoliticalColorEditIds = new Set();
    cache.pendingPoliticalColorEditRevision = -1;
    Object.assign(cache, {
      pendingPoliticalColorEditScenarioId: "", pendingPoliticalColorEditReason: "", pendingPoliticalColorEditStartedAt: 0,
      pendingPoliticalColorEditInputLabel: "", pendingPoliticalColorEditFirstPixelRecorded: false, pendingPoliticalColorEditFirstPixelPaintSource: "",
    });
    clearPoliticalPatchOverlay("pending-edit-cleared");
    recordPendingPoliticalColorEditClearDiagnostics(runtimeState, {
      resetReason, pendingFeatureCount: preClearPendingFeatureCount, pendingReason: preClearPendingReason, inputLabel: preClearInputLabel, firstPixelRecorded: preClearFirstPixelRecorded, renderedCount, renderedIdCount, force, paintSource,
    });
    return true;
  };
  if (force) return reset(String(resetReason || "").trim() || "force");
  if (!hasPendingPoliticalColorEdit()) return false;
  const hasRenderedIdScope = renderedIds !== null && renderedIds !== undefined;
  if (hasRenderedIdScope) {
    const renderedIdList = normalizePoliticalColorEditIds(renderedIds);
    if (!renderedIdList.length) return false;
    const pendingIds = cache.pendingPoliticalColorEditIds;
    if (!(pendingIds instanceof Set) || !pendingIds.size) return reset("empty-pending-set");
    renderedIdList.forEach((id) => pendingIds.delete(id));
    if (pendingIds.size > 0) return false;
    recordFillPatchFirstPixelMetric({ renderedCount, renderedIds, paintSource });
    return reset("rendered-id-scope-complete");
  }
  if (Number(renderedCount || 0) <= 0) return false;
  recordFillPatchFirstPixelMetric({ renderedCount, renderedIds, paintSource });
  return reset("rendered-count-complete");
}

function retargetPendingPoliticalColorEditRevisionAfterColorRebuild(previousColorRevision) {
  const cache = getRenderPassCacheState();
  const pendingIds = cache.pendingPoliticalColorEditIds;
  if (!(pendingIds instanceof Set) || !pendingIds.size) return false;
  const pendingScenarioId = String(cache.pendingPoliticalColorEditScenarioId || "");
  const activeScenarioId = String(runtimeState.activeScenarioId || "");
  if (pendingScenarioId && pendingScenarioId !== activeScenarioId) {
    clearPendingPoliticalColorEdit({
      force: true,
      resetReason: "stale-scenario-color-rebuild",
      paintSource: "color-rebuild",
    });
    return false;
  }
  const previousRevision = Number(previousColorRevision ?? -1);
  const pendingRevision = Number(cache.pendingPoliticalColorEditRevision ?? -1);
  const currentRevision = Number(runtimeState.colorRevision || 0);
  if (pendingRevision >= 0 && pendingRevision <= Math.max(previousRevision, currentRevision)) {
    cache.pendingPoliticalColorEditRevision = currentRevision;
    cache.pendingPoliticalColorEditScenarioId = activeScenarioId;
    return true;
  }
  return false;
}

function refreshResolvedColorsForFeatures(featureIds, { renderNow = false, inputStartedAt = 0, inputLabel = "" } = {}) {
  migrateLegacyColorState();
  ensureSovereigntyState();
  const cache = getRenderPassCacheState();
  const pendingRenderIds = new Set();
  if (hasPendingPoliticalColorEdit()) {
    normalizePoliticalColorEditIds(cache.pendingPoliticalColorEditIds).forEach((pendingId) => {
      if (findResolvedColorFeatureById(pendingId)) {
        pendingRenderIds.add(pendingId);
      }
    });
  }

  const ids = normalizePoliticalColorEditIds(featureIds);
  ids.forEach((id) => {
    const feature = findResolvedColorFeatureById(id);
    if (!feature) {
      setResolvedColorForFeature(state, id, null);
      return;
    }
    const resolved = getResolvedFeatureColor(feature, id);
    setResolvedColorForFeature(state, id, resolved);
    cache.partialPoliticalDirtyIds.add(id);
    pendingRenderIds.add(id);
  });

  bumpColorRevision(state);
  if (!markPendingPoliticalColorEdit(Array.from(pendingRenderIds), {
    startedAt: inputStartedAt,
    inputLabel,
  })) {
    clearPendingPoliticalColorEdit({ force: true });
  } else {
    paintPoliticalPatchOverlayForIds(pendingRenderIds, {
      inputLabel: inputLabel || "refresh-colors",
    });
  }
  invalidateRenderPasses("political", "refresh-colors");
  invalidateRenderPasses(["contextMarkers", "labels"], "refresh-colors-collateral");
  if (shouldRefreshContextBaseForColorChanges()) {
    invalidateRenderPasses("contextBase", "refresh-colors-context-base");
  }
  recordPartialColorRefreshDiagnostics(runtimeState, {
    requestedFeatureCount: ids.length, pendingRenderFeatureCount: pendingRenderIds.size, renderNow, inputLabel,
  });

  if (renderNow && rendererSurfaceHost.getContext()) {
    requestRendererRender("refresh-colors", {
      flush: false,
      fallback: () => render(),
    });
  }
}

function normalizeFeatureOverrideTargetIds(targetIds) {
  return Array.from(new Set((Array.isArray(targetIds) ? targetIds : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean)));
}

function applyFeatureVisualOverrideTransaction(targetIds, selectedColor, {
  remove = false,
  defaultColor = LAND_FILL_COLOR,
  renderNow = false,
  inputStartedAt = 0,
  inputLabel = "",
} = {}) {
  const resolvedIds = normalizeFeatureOverrideTargetIds(targetIds);
  if (!resolvedIds.length) return [];
  runtimeState.visualOverrides = runtimeState.visualOverrides && typeof runtimeState.visualOverrides === "object"
    ? runtimeState.visualOverrides
    : {};
  runtimeState.featureOverrides = runtimeState.featureOverrides && typeof runtimeState.featureOverrides === "object"
    ? runtimeState.featureOverrides
    : {};
  if (remove) {
    resolvedIds.forEach((targetId) => {
      delete runtimeState.visualOverrides[targetId];
      delete runtimeState.featureOverrides[targetId];
    });
  } else {
    const color = getSafeCanvasColor(selectedColor, defaultColor);
    resolvedIds.forEach((targetId) => {
      runtimeState.visualOverrides[targetId] = color;
      runtimeState.featureOverrides[targetId] = color;
    });
  }
  markLegacyColorStateDirty();
  refreshResolvedColorsForFeatures(resolvedIds, {
    renderNow,
    inputStartedAt,
    inputLabel,
  });
  return resolvedIds;
}

function refreshResolvedColorsForOwners(ownerCodes, { renderNow = false } = {}) {
  const ids = collectResolvedColorFeatureIdsForOwners(ownerCodes);
  refreshResolvedColorsForFeatures(ids, { renderNow });
}

function refreshColorState({ renderNow = true } = {}) {
  const startedAt = nowMs();
  normalizeColorStateForRender(state, {
    sanitizeColorMap,
    sanitizeCountryColorMap,
  });
  rebuildResolvedColors();
  invalidateRenderPasses("contextScenario", "refresh-colors");
  recordRenderPerfMetric("refreshColorState", nowMs() - startedAt, {
    renderNow: !!renderNow,
    featureCount: Object.keys(runtimeState.colors || {}).length,
  });
  if (renderNow && rendererSurfaceHost.getContext()) {
    render();
  }
}

function pathBoundsInScreen(feature) {
  if (!rendererSurfaceHost.getPathSvg()) return false;
  const geometryType = String(feature?.geometry?.type || "").trim();
  const bounds = getProjectedFeatureBounds(feature, { allowCompute: false }) || getProjectedFeatureBounds(feature);
  if (!bounds) {
    recordProjectedBoundsDiagnostic(feature, "missing-bounds");
    return isLineGeometryType(geometryType);
  }
  const minX = bounds.minX * runtimeState.zoomTransform.k + runtimeState.zoomTransform.x;
  const minY = bounds.minY * runtimeState.zoomTransform.k + runtimeState.zoomTransform.y;
  const maxX = bounds.maxX * runtimeState.zoomTransform.k + runtimeState.zoomTransform.x;
  const maxY = bounds.maxY * runtimeState.zoomTransform.k + runtimeState.zoomTransform.y;
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
    recordProjectedBoundsDiagnostic(feature, "non-finite-screen-bounds");
    return isLineGeometryType(geometryType);
  }

  const overscan = Math.max(
    VIEWPORT_CULL_OVERSCAN_PX,
    Math.min(runtimeState.width, runtimeState.height) * 0.08
  );

  return !(
    maxX < -overscan ||
    maxY < -overscan ||
    minX > runtimeState.width + overscan ||
    minY > runtimeState.height + overscan
  );
}

function projectedGeoBoundsInScreen(bounds) {
  if (!bounds) return false;
  const minX = bounds.minX * runtimeState.zoomTransform.k + runtimeState.zoomTransform.x;
  const minY = bounds.minY * runtimeState.zoomTransform.k + runtimeState.zoomTransform.y;
  const maxX = bounds.maxX * runtimeState.zoomTransform.k + runtimeState.zoomTransform.x;
  const maxY = bounds.maxY * runtimeState.zoomTransform.k + runtimeState.zoomTransform.y;
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return false;
  const overscan = Math.max(
    VIEWPORT_CULL_OVERSCAN_PX,
    Math.min(runtimeState.width, runtimeState.height) * 0.08
  );
  return !(
    maxX < -overscan ||
    maxY < -overscan ||
    minX > runtimeState.width + overscan ||
    minY > runtimeState.height + overscan
  );
}

function getContourViewportScreenBounds() {
  const overscan = Math.max(
    VIEWPORT_CULL_OVERSCAN_PX,
    Math.min(runtimeState.width, runtimeState.height) * 0.08
  );
  const minX = -overscan;
  const minY = -overscan;
  const maxX = Number(runtimeState.width || 0) + overscan;
  const maxY = Number(runtimeState.height || 0) + overscan;
  return {
    x: minX,
    y: minY,
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

function getContourVisibleSetCacheKey(collection, {
  k = runtimeState.zoomTransform?.k || 1,
  lowReliefCutoff = 0,
  intervalM = 0,
  excludeIntervalM = 0,
  minScreenSpanPx = 0,
  maxFeatures = 0,
} = {}) {
  return [
    Number(runtimeState.topologyRevision || 0),
    getContextBaseZoomBucketId(k),
    getTransformSignature(runtimeState.zoomTransform || globalThis.d3?.zoomIdentity),
    getViewportRenderSignature(),
    Array.isArray(collection?.features) ? collection.features.length : 0,
    Number(lowReliefCutoff || 0).toFixed(2),
    Number(intervalM || 0).toFixed(2),
    Number(excludeIntervalM || 0).toFixed(2),
    Number(minScreenSpanPx || 0).toFixed(2),
    Number(maxFeatures || 0),
  ].join("|");
}

function getContourVisibleFeatures(
  collection,
  {
    cacheSlot = "major",
    k = runtimeState.zoomTransform?.k || 1,
    lowReliefCutoff = 0,
    intervalM = 0,
    excludeIntervalM = 0,
    minScreenSpanPx = 0,
    maxFeatures = 0,
  } = {},
) {
  if (!Array.isArray(collection?.features) || collection.features.length === 0) return [];
  const cacheKey = getContourVisibleSetCacheKey(collection, {
    k,
    lowReliefCutoff,
    intervalM,
    excludeIntervalM,
    minScreenSpanPx,
    maxFeatures,
  });
  const cacheEntry = contourVisibleSetCache[cacheSlot];
  if (
    cacheEntry?.collectionRef === collection
    && cacheEntry.key === cacheKey
    && Array.isArray(cacheEntry.features)
  ) {
    return cacheEntry.features;
  }

  const viewportBounds = getContourViewportScreenBounds();
  const visibleRecords = [];
  collection.features.forEach((feature) => {
    const elevation = Number(feature?.properties?.elevation_m);
    if (Number.isFinite(elevation) && elevation < lowReliefCutoff) return;
    if (intervalM > 0 && Number.isFinite(elevation) && elevation % intervalM !== 0) return;
    if (excludeIntervalM > 0 && Number.isFinite(elevation) && elevation % excludeIntervalM === 0) return;

    const screenBounds = getFeatureScreenBounds(feature, { allowCompute: false }) || getFeatureScreenBounds(feature);
    if (!screenBounds) {
      if (minScreenSpanPx <= 0 && isLineGeometryType(String(feature?.geometry?.type || "").trim())) {
        visibleRecords.push({ feature, elevation, span: 0 });
      }
      return;
    }
    if (!rectsIntersect(screenBounds, viewportBounds)) return;
    const span = Math.max(Number(screenBounds.width || 0), Number(screenBounds.height || 0));
    if (minScreenSpanPx > 0 && !(span >= minScreenSpanPx)) return;
    visibleRecords.push({ feature, elevation, span });
  });

  if (maxFeatures > 0 && visibleRecords.length > maxFeatures) {
    const scored = visibleRecords.map(({ feature, elevation, span }) => {
      const elevationScore = Number.isFinite(elevation) ? elevation : 0;
      return {
        feature,
        score: elevationScore * 1.15 + span * 34,
      };
    });
    scored.sort((a, b) => b.score - a.score);
    const visibleFeatures = scored.slice(0, maxFeatures).map((entry) => entry.feature);
    contourVisibleSetCache[cacheSlot] = {
      collectionRef: collection,
      key: cacheKey,
      features: visibleFeatures,
    };
    return visibleFeatures;
  }

  const visibleFeatures = visibleRecords.map((entry) => entry.feature);
  contourVisibleSetCache[cacheSlot] = {
    collectionRef: collection,
    key: cacheKey,
    features: visibleFeatures,
  };
  return visibleFeatures;
}

const URBAN_CORRUPT_BOUNDS_WIDTH_DEG = 300;
const URBAN_CORRUPT_BOUNDS_HEIGHT_DEG = 150;

function invalidateContextLayerVisualStateBatch(layerNames, reason = "context-layer-loaded", { renderNow = true } = {}) {
  layerResolverCache.primaryRef = null;
  layerResolverCache.detailRef = null;
  layerResolverCache.bundleMode = null;
  layerResolverCache.contextRevision = Number.NaN;
  layerResolverCache.waterRegionsDataToken = "";
  const targetPasses = new Set(["contextBase"]);
  const normalizedLayerNames = Array.isArray(layerNames) ? layerNames : [layerNames];
  normalizedLayerNames.forEach((layerName) => {
    const normalized = String(layerName || "").trim().toLowerCase();
    if (normalized === "physical" || normalized === "physical_semantics") {
      targetPasses.add("physicalBase");
      targetPasses.add("dayNight");
    }
    if (normalized === "urban") {
      targetPasses.add("dayNight");
    }
  });
  const resolvedPasses = Array.from(targetPasses);
  invalidateRenderPasses(resolvedPasses, reason);
  clearRenderPassReferenceTransforms(resolvedPasses);
  if (renderNow) {
    requestRendererRender(`context-layer-visual:${reason}`, { flush: true });
  }
}

function createHitCanvasElement() {
  const canvas = document.createElement("canvas");
  canvas.id = "map-hit-canvas";
  canvas.width = 1;
  canvas.height = 1;
  return canvas;
}

function createSvgElement() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("id", "map-svg");
  svg.classList.add("map-layer", "map-layer-top");
  svg.style.position = "absolute";
  svg.style.inset = "0";
  svg.style.display = "block";
  svg.style.zIndex = "3";
  svg.style.pointerEvents = "none";
  return svg;
}

function ensureHybridLayers() {
  const legacySpecialZones = document.getElementById("specialZonesSvg");
  if (legacySpecialZones) legacySpecialZones.remove();
  const legacyLegend = document.getElementById("legendSvg");
  if (legacyLegend) legacyLegend.remove();

  const legacyColorCanvas = document.getElementById("colorCanvas");
  const legacyLineCanvas = document.getElementById("lineCanvas");

  const { mapCanvas: nextMapCanvas } = getRendererSurfaceLifecycleOwner().ensureCanvasLayerHandles({
    before: legacyColorCanvas || legacyLineCanvas || null,
  });

  if (legacyColorCanvas && legacyColorCanvas !== nextMapCanvas) {
    legacyColorCanvas.style.display = "none";
    legacyColorCanvas.style.pointerEvents = "none";
  }
  if (legacyLineCanvas) {
    legacyLineCanvas.style.display = "none";
    legacyLineCanvas.style.pointerEvents = "none";
  }

  const { mapSvg } = getRendererSvgSurfaceLifecycleOwner().ensureSvgSurface();
  const svg = globalThis.d3.select(mapSvg);

  svg.select("g.legend-group").remove();
  ensureLegendControlElement();
}

function setCanvasSize({
  reason = "resize",
  targetPassesOnDprChange = null,
  targetPassesOnResize = null,
  targetPassesOnCanvasResize = null,
  forceDprInvalidation = false,
} = {}) {
  if (!rendererSurfaceHost.getMapCanvas() || !rendererSurfaceHost.getMapSvg()) return false;

  const previousWidth = Number(runtimeState.width || 0);
  const previousHeight = Number(runtimeState.height || 0);
  const previousDpr = Number(runtimeState.dpr || 1);
  const deviceDpr = Math.max(Number(globalThis.devicePixelRatio || 1), 1);
  runtimeState.dpr = Math.min(deviceDpr, getMaxDprForProfile(runtimeState.renderProfile));
  const rect = rendererSurfaceHost.getMapContainer()?.getBoundingClientRect?.();
  const measuredWidth = rect?.width || rendererSurfaceHost.getMapContainer()?.clientWidth || globalThis.innerWidth;
  const measuredHeight = rect?.height || rendererSurfaceHost.getMapContainer()?.clientHeight || globalThis.innerHeight;

  runtimeState.width = Math.round(measuredWidth);
  runtimeState.height = Math.round(measuredHeight);

  if (runtimeState.width < 100) runtimeState.width = Math.max(100, globalThis.innerWidth - 580);
  if (runtimeState.height < 100) runtimeState.height = Math.max(100, globalThis.innerHeight);

  const scaledW = Math.floor(runtimeState.width * runtimeState.dpr);
  const scaledH = Math.floor(runtimeState.height * runtimeState.dpr);
  const sizeChanged = previousWidth !== runtimeState.width || previousHeight !== runtimeState.height;
  const dprChanged = forceDprInvalidation || Math.abs(previousDpr - runtimeState.dpr) >= 0.01;
  if (!sizeChanged && !dprChanged) {
    return false;
  }

  resizeCanvasLayers(rendererSurfaceHost.getCanvasLayers(), {
    width: runtimeState.width,
    height: runtimeState.height,
    dpr: runtimeState.dpr,
  });
  if (rendererSurfaceHost.getHitCanvas()) {
    rendererSurfaceHost.getHitCanvas().width = scaledW;
    rendererSurfaceHost.getHitCanvas().height = scaledH;
  }
  const resizeInvalidationPasses = Array.isArray(targetPassesOnResize) && targetPassesOnResize.length
    ? targetPassesOnResize
    : RENDER_PASS_NAMES;
  const dprInvalidationPasses = Array.isArray(targetPassesOnDprChange) && targetPassesOnDprChange.length
    ? targetPassesOnDprChange
    : RENDER_PASS_NAMES;
  const invalidationPasses = sizeChanged ? resizeInvalidationPasses : dprInvalidationPasses;
  const canvasResizePasses = Array.isArray(targetPassesOnCanvasResize) && targetPassesOnCanvasResize.length
    ? targetPassesOnCanvasResize
    : invalidationPasses;
  resizeRenderPassCanvases(canvasResizePasses);
  invalidateInteractionComposite(reason || "resize");
  getVisualEffectsPassOwner().invalidateTextureRasterCaches();
  clearProjectedBoundsCache();
  runtimeState.hitCanvasDirty = true;
  if (sizeChanged) {
    invalidateRenderPasses(resizeInvalidationPasses, reason || "resize");
    clearRenderPassReferenceTransforms(resizeInvalidationPasses);
  } else {
    invalidateRenderPasses(dprInvalidationPasses, reason || "dpr-change");
    clearRenderPassReferenceTransforms(dprInvalidationPasses);
  }

  const svg = globalThis.d3.select(rendererSurfaceHost.getMapSvg());
  svg.attr("width", runtimeState.width).attr("height", runtimeState.height);
  rendererSurfaceHost.getInteractionRect().attr("x", 0).attr("y", 0).attr("width", runtimeState.width).attr("height", runtimeState.height);
  return true;
}

function rebuildDynamicBorders() {
  return getBorderMeshOwner().rebuildDynamicBorders();
}

function recomputeDynamicBordersNow({ renderNow = true, reason = "" } = {}) {
  return getBorderMeshOwner().recomputeDynamicBordersNow({ renderNow, reason });
}

function refreshScenarioOpeningOwnerBorders({ renderNow = false, reason = "" } = {}) {
  const built = getBorderMeshOwner().refreshScenarioOpeningOwnerBorders(reason);
  if (renderNow && rendererSurfaceHost.getContext()) {
    render();
  }
  return built;
}

function scheduleDynamicBorderRecompute(reason = "", delayMs = 150) {
  return getBorderMeshOwner().scheduleDynamicBorderRecompute(reason, delayMs);
}

function isUsableMesh(mesh) {
  return !!(mesh && Array.isArray(mesh.coordinates) && mesh.coordinates.length > 0);
}

function getAdmin1Group(entity) {
  const value = entity?.properties?.admin1_group;
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function getDetailTier(entity) {
  const value = entity?.properties?.detail_tier;
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function isAdmDetailTier(entity) {
  return getDetailTier(entity).toLowerCase().startsWith("adm2");
}

function asFeatureLike(entity) {
  if (!entity) return null;
  return {
    id: entity.id,
    properties: entity.properties || {},
  };
}

function getEntityFeatureId(entity) {
  const featureLike = asFeatureLike(entity);
  return featureLike ? getFeatureId(featureLike) : null;
}

function getEntityCountryCode(entity) {
  const featureLike = asFeatureLike(entity);
  return featureLike ? getFeatureCountryCodeNormalized(featureLike) : "";
}

function getEntityBorderMeshCountryCode(entity) {
  const featureLike = asFeatureLike(entity);
  return featureLike ? getFeatureBorderMeshCountryCodeNormalized(featureLike) : "";
}

function shouldExcludeOwnerBorderEntity(entity, { excludeSea = false } = {}) {
  if (!entity) return false;
  const feature = asFeatureLike(entity);
  if (shouldExcludePoliticalVisualFeature(feature)) return true;
  if (!excludeSea) return false;
  return isAtlantropaSeaFeature(feature);
}

function resolveOwnerBorderCode(entity, ownershipContext = {}) {
  const feature = asFeatureLike(entity);
  if (shouldExcludePoliticalVisualFeature(feature)) {
    return "";
  }
  const featureId = getEntityFeatureId(entity);
  const fallbackCode = getEntityCountryCode(entity) || "";
  const ownershipByFeatureId = ownershipContext?.ownershipByFeatureId || {};
  const shellOwnerByFeatureId = ownershipContext?.shellOwnerByFeatureId || {};
  const shellOwnerHintCode = canonicalCountryCode(feature?.properties?.scenario_shell_owner_hint || "");
  const shellControllerHintCode = canonicalCountryCode(feature?.properties?.scenario_shell_controller_hint || "");
  if (!featureId) {
    return canonicalCountryCode(fallbackCode);
  }
  const isScenarioShell = isScenarioShellFeature(feature, featureId);
  return canonicalCountryCode(
    ownershipByFeatureId?.[featureId]
    || (!isScenarioShell ? fallbackCode : "")
    || (isScenarioShell ? (shellOwnerByFeatureId?.[featureId] || shellOwnerHintCode || shellControllerHintCode) : "")
    || ""
  );
}

function getFullLandDataFeatures() {
  if (Array.isArray(runtimeState.landDataFull?.features) && runtimeState.landDataFull.features.length) {
    return runtimeState.landDataFull.features;
  }
  return Array.isArray(runtimeState.landData?.features) ? runtimeState.landData.features : [];
}

function getCountryFeatureEntriesMap() {
  const byCountry = new Map();
  const features = getFullLandDataFeatures();
  features.forEach((feature) => {
    const id = getFeatureId(feature);
    const countryCode = getFeatureCountryCodeNormalized(feature);
    if (!id || !countryCode || shouldExcludePoliticalInteractionFeature(feature, id)) return;
    const list = byCountry.get(countryCode) || [];
    list.push({ id, feature });
    byCountry.set(countryCode, list);
  });
  return byCountry;
}

function evaluateCountryGroupingCandidate(countryCode, source, featureEntries, featureToGroup) {
  if (!featureEntries?.length || !(featureToGroup instanceof Map) || !featureToGroup.size) return null;

  const groupCounts = new Map();
  let groupedCount = 0;
  featureEntries.forEach(({ id }) => {
    const group = featureToGroup.get(id);
    if (!group) return;
    groupedCount += 1;
    groupCounts.set(group, (groupCounts.get(group) || 0) + 1);
  });

  if (!groupedCount || !groupCounts.size) return null;

  const totalCount = featureEntries.length;
  const groupSizes = Array.from(groupCounts.values());
  const renderableGroupCount = groupSizes.filter((count) => count >= 2).length;
  const coverage = totalCount > 0 ? groupedCount / totalCount : 0;
  const dominantShare = groupedCount > 0 ? Math.max(...groupSizes) / groupedCount : 1;

  return {
    countryCode,
    source,
    featureToGroup,
    groupCounts,
    totalCount,
    groupedCount,
    groupCount: renderableGroupCount,
    groupCountTotal: groupCounts.size,
    coverage,
    dominantShare,
    accepted:
      renderableGroupCount >= PARENT_BORDER_MIN_RENDERABLE_GROUPS &&
      coverage >= PARENT_BORDER_MIN_COVERAGE &&
      dominantShare <= PARENT_BORDER_MAX_DOMINANT_SHARE,
  };
}

function buildHierarchyGroupingCandidate(countryCode, featureEntries) {
  const groups = runtimeState.hierarchyData?.groups;
  if (!groups || typeof groups !== "object") return null;

  const idSet = new Set(featureEntries.map((entry) => entry.id));
  const featureToGroup = new Map();
  Object.entries(groups).forEach(([groupId, children]) => {
    const groupCountry = canonicalCountryCode(String(groupId || "").split("_")[0]);
    if (!groupCountry || groupCountry !== countryCode) return;
    if (!Array.isArray(children)) return;
    children.forEach((child) => {
      const childId = String(child || "").trim();
      if (!childId || !idSet.has(childId)) return;
      if (!featureToGroup.has(childId)) {
        featureToGroup.set(childId, groupId);
      }
    });
  });

  return evaluateCountryGroupingCandidate(countryCode, "hierarchy", featureEntries, featureToGroup);
}

function buildAdmin1GroupingCandidate(countryCode, featureEntries) {
  const featureToGroup = new Map();
  featureEntries.forEach(({ id, feature }) => {
    const group = getAdmin1Group(feature);
    if (!group) return;
    featureToGroup.set(id, group);
  });
  return evaluateCountryGroupingCandidate(countryCode, "admin1_group", featureEntries, featureToGroup);
}

function buildScenarioDistrictGroupingCandidate(countryCode, featureEntries) {
  const districtCountry = runtimeState.scenarioDistrictGroupsData?.countries?.[countryCode];
  if (!districtCountry || typeof districtCountry !== "object") return null;
  const idSet = new Set(featureEntries.map((entry) => entry.id));
  const featureToGroup = new Map();
  Object.entries(districtCountry.districts && typeof districtCountry.districts === "object" ? districtCountry.districts : {})
    .forEach(([districtId, rawDistrict]) => {
      const normalizedDistrictId = String(rawDistrict?.id || rawDistrict?.district_id || districtId || "").trim();
      if (!normalizedDistrictId) return;
      const featureIds = Array.isArray(rawDistrict?.feature_ids) ? rawDistrict.feature_ids : [];
      featureIds.forEach((featureId) => {
        const normalizedFeatureId = String(featureId || "").trim();
        if (!normalizedFeatureId || !idSet.has(normalizedFeatureId)) return;
        if (!featureToGroup.has(normalizedFeatureId)) {
          featureToGroup.set(normalizedFeatureId, normalizedDistrictId);
        }
      });
    });
  if (!featureToGroup.size) {
    return {
      countryCode,
      source: "scenario_district",
      featureToGroup,
      groupCounts: new Map(),
      totalCount: featureEntries.length,
      groupedCount: 0,
      groupCount: 0,
      groupCountTotal: 0,
      coverage: 0,
      dominantShare: 1,
      accepted: false,
      forcedRule: "scenario_district",
    };
  }
  return {
    ...evaluateCountryGroupingCandidate(countryCode, "scenario_district", featureEntries, featureToGroup),
    forcedRule: "scenario_district",
  };
}

function buildIdPrefixGroupingCandidate(countryCode, featureEntries, prefixLength) {
  const length = Number(prefixLength);
  if (!Number.isFinite(length) || length < 3) return null;

  const featureToGroup = new Map();
  let validIds = 0;
  featureEntries.forEach(({ id }) => {
    const text = String(id || "").trim().toUpperCase();
    if (!GB_ID_PATTERN_RE.test(text)) return;
    validIds += 1;
    featureToGroup.set(id, text.slice(0, length));
  });

  if (!featureToGroup.size || !featureEntries.length) return null;
  const idPatternCoverage = validIds / featureEntries.length;
  if (idPatternCoverage < 0.95) return null;

  const candidate = evaluateCountryGroupingCandidate(countryCode, "id_prefix", featureEntries, featureToGroup);
  if (!candidate) return null;
  return {
    ...candidate,
    prefixLength: length,
    idPatternCoverage,
  };
}

function isGermanStateLevelCandidate(candidate) {
  if (!candidate || candidate.source !== "admin1_group") return false;
  if (candidate.groupCountTotal < DE_STATE_GROUP_MIN || candidate.groupCountTotal > DE_STATE_GROUP_MAX) {
    return false;
  }
  const groups = new Set(candidate.groupCounts ? Array.from(candidate.groupCounts.keys()) : []);
  return Array.from(DE_CITY_STATES).every((name) => groups.has(name));
}

function isBritishConstituentGroupingCandidate(candidate) {
  if (!candidate || candidate.source !== "hierarchy") return false;
  if (candidate.coverage < PARENT_BORDER_MIN_COVERAGE) return false;
  if (candidate.groupCount < 4) return false;
  const groups = new Set(candidate.groupCounts ? Array.from(candidate.groupCounts.keys()) : []);
  return (
    groups.has("GB_England")
    && groups.has("GB_Scotland")
    && groups.has("GB_Wales")
    && groups.has("GB_Northern_Ireland")
  );
}

function isBritishNuts1GroupingCandidate(candidate) {
  if (!candidate || candidate.source !== "id_prefix") return false;
  if (candidate.prefixLength !== GB_NUTS1_PREFIX_LENGTH) return false;
  if (candidate.coverage < PARENT_BORDER_MIN_COVERAGE) return false;
  return candidate.groupCountTotal >= GB_NUTS1_GROUP_MIN;
}

function resolveCountryParentGroupingCandidate(countryCode, featureEntries) {
  if (!countryCode || !featureEntries?.length) return null;

  const scenarioDistrictCandidate = buildScenarioDistrictGroupingCandidate(countryCode, featureEntries);
  if (scenarioDistrictCandidate) {
    return scenarioDistrictCandidate;
  }
  if (String(runtimeState.activeScenarioId || "").trim().toLowerCase() === "tno_1962") {
    return null;
  }

  const hierarchyCandidate = buildHierarchyGroupingCandidate(countryCode, featureEntries);
  const adminCandidate = buildAdmin1GroupingCandidate(countryCode, featureEntries);

  if (countryCode === "DE") {
    if (adminCandidate && isGermanStateLevelCandidate(adminCandidate)) {
      return {
        ...adminCandidate,
        accepted: true,
        forcedRule: "de_state_level",
      };
    }
    if (hierarchyCandidate?.accepted) return hierarchyCandidate;
    if (adminCandidate?.accepted) return adminCandidate;
    return null;
  }

  if (countryCode === "GB") {
    const britishLeafEntries = featureEntries.filter(({ id }) =>
      GB_ID_PATTERN_RE.test(String(id || "").trim().toUpperCase())
    );
    const nuts1Candidate = buildIdPrefixGroupingCandidate(
      countryCode,
      britishLeafEntries,
      GB_NUTS1_PREFIX_LENGTH
    );
    if (isBritishNuts1GroupingCandidate(nuts1Candidate)) {
      return {
        ...nuts1Candidate,
        accepted: true,
        forcedRule: "gb_nuts1",
      };
    }
    if (isBritishConstituentGroupingCandidate(hierarchyCandidate)) {
      return {
        ...hierarchyCandidate,
        accepted: true,
        forcedRule: "gb_constituent_countries",
      };
    }
    const hierarchyFineEnough =
      hierarchyCandidate?.accepted &&
      Math.max(hierarchyCandidate.groupCount, hierarchyCandidate.groupCountTotal) >= GB_PARENT_MIN_GROUPS;
    if (hierarchyFineEnough) return hierarchyCandidate;

    const idPrefixCandidate = [
      buildIdPrefixGroupingCandidate(countryCode, britishLeafEntries, 4),
    ].find(
      (candidate) =>
        candidate?.accepted &&
        Math.max(candidate.groupCount, candidate.groupCountTotal) >= GB_PARENT_MIN_GROUPS
    );
    if (idPrefixCandidate) return idPrefixCandidate;
    return null;
  }

  if (hierarchyCandidate?.accepted) return hierarchyCandidate;
  if (adminCandidate?.accepted) return adminCandidate;
  return null;
}

function syncParentBorderEnabledByCountry(supportedCountries) {
  const prev = runtimeState.parentBorderEnabledByCountry && typeof runtimeState.parentBorderEnabledByCountry === "object"
    ? runtimeState.parentBorderEnabledByCountry
    : {};
  const next = {};
  supportedCountries.forEach((countryCode) => {
    next[countryCode] = !!prev[countryCode];
  });
  runtimeState.parentBorderEnabledByCountry = next;
}

function refreshParentBorderSupport() {
  const byCountry = getCountryFeatureEntriesMap();
  const supported = [];
  const meta = {};
  const featureToGroup = new Map();

  byCountry.forEach((featureEntries, countryCode) => {
    const candidate = resolveCountryParentGroupingCandidate(countryCode, featureEntries);
    if (!candidate) return;

    candidate.featureToGroup.forEach((group, featureId) => {
      featureToGroup.set(featureId, group);
    });
    if (candidate.accepted) {
      supported.push(countryCode);
    }
    meta[countryCode] = {
      source: candidate.source,
      groupCount: candidate.groupCountTotal,
      coverage: Number(candidate.coverage.toFixed(3)),
      dominantShare: Number(candidate.dominantShare.toFixed(3)),
      prefixLength: candidate.prefixLength || null,
      idPatternCoverage: Number.isFinite(candidate.idPatternCoverage)
        ? Number(candidate.idPatternCoverage.toFixed(3))
        : null,
    };
  });

  supported.sort((a, b) => a.localeCompare(b));
  runtimeState.parentGroupByFeatureId = featureToGroup;
  runtimeState.parentBorderMetaByCountry = meta;
  runtimeState.parentBorderSupportedCountries = supported;
  syncParentBorderEnabledByCountry(supported);

  if (typeof runtimeState.updateParentBorderCountryListFn === "function") {
    runtimeState.updateParentBorderCountryListFn();
  }
}

function getParentGroupForEntity(entity) {
  const featureId = getEntityFeatureId(entity);
  if (!featureId || !runtimeState.parentGroupByFeatureId) return "";
  const group = runtimeState.parentGroupByFeatureId.get(featureId);
  if (group === null || group === undefined) return "";
  return String(group).trim();
}

function resetContourHostFillColorCache() {
  contourHostFillColorCache = new WeakMap();
}
function resetExactRefreshOptimizationState() {
  resetContourHostFillColorCache();
  resetContourVisibleSetCache();
  cancelDeferredContextBaseEnhancement({ resetFlag: true });
  detailAdmMeshBuildState = {
    signature: "",
    status: "idle",
  };
}

function resetContourVisibleSetCache() {
  contourVisibleSetCache = {
    major: { collectionRef: null, key: "", features: [] },
    minor: { collectionRef: null, key: "", features: [] },
  };
}

function cancelDeferredContextBaseEnhancement({ resetFlag = false } = {}) {
  cancelDeferredWork(deferredContextBaseEnhancementHandle);
  deferredContextBaseEnhancementHandle = null;
  if (resetFlag) {
    deferContextBaseEnhancements = false;
  }
}

function shouldDeferContextBaseEnhancementsForExactRefresh(
  reuseDecision = null,
  forceExactContextBaseRefresh = false,
) {
  const resolvedReuseDecision =
    reuseDecision && typeof reuseDecision === "object"
      ? reuseDecision
      : null;
  if (!resolvedReuseDecision && !forceExactContextBaseRefresh) {
    return false;
  }
  return !!(
    resolvedReuseDecision?.crossesZoomBucket
    || (
      Number.isFinite(Number(resolvedReuseDecision?.distancePx))
      && Number.isFinite(Number(resolvedReuseDecision?.maxDistancePx))
      && Number(resolvedReuseDecision.distancePx) > Number(resolvedReuseDecision.maxDistancePx)
    )
    || String(resolvedReuseDecision?.zoomBucket || "") === "high"
  );
}

function scheduleDeferredContextBaseEnhancements() {
  cancelDeferredContextBaseEnhancement();
  deferredContextBaseEnhancementHandle = scheduleDeferredWork(() => {
    deferredContextBaseEnhancementHandle = null;
    if (!deferContextBaseEnhancements) {
      return;
    }
    if (runtimeState.renderPhase !== RENDER_PHASE_IDLE || runtimeState.deferExactAfterSettle) {
      scheduleDeferredContextBaseEnhancements();
      return;
    }
    deferContextBaseEnhancements = false;
    invalidateRenderPasses(["contextBase", "labels"], "context-base-enhancement");
    render();
  }, {
    timeout: 180,
  });
}

function setStaticMeshSourceCountries(sourceCountries = {}) {
  staticMeshSourceCountries = {
    primary: sourceCountries.primary instanceof Set ? new Set(sourceCountries.primary) : new Set(),
    detail: sourceCountries.detail instanceof Set ? new Set(sourceCountries.detail) : new Set(),
  };
}

function resetVisibleInternalBorderMeshSignature() {
  visibleInternalBorderMeshSignature = "";
  visibleBorderCountryCodesCache = {
    signature: "",
    codes: new Set(),
  };
}

function resetDetailAdmMeshBuildState() {
  detailAdmMeshBuildState = {
    signature: "",
    status: "idle",
  };
}

function syncStaticMeshSnapshot() {
  staticMeshCache.snapshot = captureStaticMeshSnapshot();
}

function clearDeferredInternalBorderMeshCaches({ syncSnapshot = true } = {}) {
  setStaticMeshSourceCountries(getSourceCountrySets());
  runtimeState.cachedProvinceBorders = [];
  runtimeState.cachedProvinceBordersByCountry = new Map();
  runtimeState.cachedLocalBorders = [];
  runtimeState.cachedLocalBordersByCountry = new Map();
  getBorderMeshOwner().replaceDetailAdmBorders();
  runtimeState.cachedGridLines = [];
  resetVisibleInternalBorderMeshSignature();
  resetDetailAdmMeshBuildState();
  if (syncSnapshot && staticMeshCache.snapshot) {
    syncStaticMeshSnapshot();
  }
}

function buildDetailAdmMeshSignature(visibleCountryCodes = new Set(), k = runtimeState.zoomTransform?.k || 1) {
  const detailCountries = Array.from(staticMeshSourceCountries.detail || new Set())
    .filter((countryCode) => visibleCountryCodes.has(countryCode))
    .sort((left, right) => left.localeCompare(right));
  return {
    detailCountries,
    signature: [
      Number(runtimeState.topologyRevision || 0),
      String(getContextBaseZoomBucketId(k)),
      ...detailCountries,
    ].join("|"),
  };
}

function getVisibleCountryCodesForBorderMeshes() {
  const viewportBounds = getProjectedViewportBounds({ overscanPx: VIEWPORT_CULL_OVERSCAN_PX * 0.5 });
  if (!viewportBounds) {
    return new Set();
  }
  const signature = [
    Number(runtimeState.topologyRevision || 0),
    Number(runtimeState.zoomTransform?.k || 1).toFixed(3),
    Number(viewportBounds.minX || 0).toFixed(1),
    Number(viewportBounds.minY || 0).toFixed(1),
    Number(viewportBounds.maxX || 0).toFixed(1),
    Number(viewportBounds.maxY || 0).toFixed(1),
    Array.isArray(runtimeState.spatialItems) ? runtimeState.spatialItems.length : 0,
  ].join("|");
  if (visibleBorderCountryCodesCache.signature === signature) {
    return new Set(visibleBorderCountryCodesCache.codes);
  }
  const visible = new Set();
  const minX = Number(viewportBounds.minX);
  const minY = Number(viewportBounds.minY);
  const maxX = Number(viewportBounds.maxX);
  const maxY = Number(viewportBounds.maxY);
  (runtimeState.spatialItems || []).forEach((item) => {
    const countryCode = canonicalCountryCode(item?.borderMeshCountryCode || item?.countryCode || "");
    if (!countryCode || visible.has(countryCode)) return;
    if (item.maxX < minX || item.maxY < minY || item.minX > maxX || item.minY > maxY) {
      return;
    }
    visible.add(countryCode);
  });
  visibleBorderCountryCodesCache = {
    signature,
    codes: new Set(visible),
  };
  return visible;
}

function ensureCountrySourceBorderMeshes(countryCode, {
  includeProvince = true,
  includeLocal = true,
} = {}) {
  const normalizedCode = canonicalCountryCode(countryCode);
  if (!normalizedCode || !globalThis.topojson) return;
  const needsProvince = includeProvince && !runtimeState.cachedProvinceBordersByCountry?.has(normalizedCode);
  const needsLocal = includeLocal && !runtimeState.cachedLocalBordersByCountry?.has(normalizedCode);
  if (!needsProvince && !needsLocal) {
    return;
  }

  const nextProvinceMeshes = [];
  const nextLocalMeshes = [];
  const sources = [
    { key: "detail", topology: runtimeState.topologyDetail },
    { key: "primary", topology: runtimeState.topologyPrimary || runtimeState.topology },
  ];
  sources.forEach(({ key, topology }) => {
    if (!topology?.objects?.political) return;
    if (!staticMeshSourceCountries[key]?.has(normalizedCode)) return;
    const meshes = buildSourceBorderMeshes(topology, new Set([normalizedCode]));
    if (!meshes) return;
    if (needsProvince) {
      const provinceMeshes = meshes.provinceMeshesByCountry?.get(normalizedCode) || [];
      provinceMeshes.forEach((mesh) => {
        if (isUsableMesh(mesh)) {
          nextProvinceMeshes.push(mesh);
          runtimeState.cachedProvinceBorders.push(mesh);
        }
      });
    }
    if (needsLocal) {
      const localMeshes = meshes.localMeshesByCountry?.get(normalizedCode) || [];
      localMeshes.forEach((mesh) => {
        if (isUsableMesh(mesh)) {
          nextLocalMeshes.push(mesh);
          runtimeState.cachedLocalBorders.push(mesh);
        }
      });
    }
  });
  if (needsProvince) {
    runtimeState.cachedProvinceBordersByCountry.set(normalizedCode, nextProvinceMeshes);
  }
  if (needsLocal) {
    runtimeState.cachedLocalBordersByCountry.set(normalizedCode, nextLocalMeshes);
    runtimeState.cachedGridLines = [...(runtimeState.cachedLocalBorders || [])];
  }
}

function cancelDeferredHeavyBorderMeshes() {
  cancelDeferredWork(deferredHeavyBorderMeshHandle);
  deferredHeavyBorderMeshHandle = null;
}

function scheduleDeferredHeavyBorderMeshes() {
  cancelDeferredHeavyBorderMeshes();
  deferredHeavyBorderMeshHandle = scheduleDeferredWork(() => {
    deferredHeavyBorderMeshHandle = null;
    if (!isInteractionRecoverySettled({ quietMs: 900 })) {
      scheduleDeferredHeavyBorderMeshes();
      return;
    }
    const taskKey = "deferred-heavy-border-meshes";
    if (!beginInteractionRecoveryTask(taskKey)) {
      scheduleDeferredHeavyBorderMeshes();
      return;
    }
    const startedAt = nowMs();
    try {
      const visibleCountryCodes = getVisibleCountryCodesForBorderMeshes();
      if (!visibleCountryCodes.size) return;
      const currentZoom = Math.max(0.0001, Number(runtimeState.zoomTransform?.k || 1));
      const includeProvince = currentZoom >= PROVINCE_BORDERS_TRANSITION_END_ZOOM;
      const includeLocal = currentZoom >= LOCAL_BORDERS_MIN_ZOOM;
      const detailAdmMeta = currentZoom >= DETAIL_ADM_BORDERS_MIN_ZOOM
        ? buildDetailAdmMeshSignature(visibleCountryCodes, currentZoom)
        : { detailCountries: [], signature: "" };
      const includeDetailAdm =
        currentZoom >= DETAIL_ADM_BORDERS_MIN_ZOOM
        && detailAdmMeta.detailCountries.length > 0
        && (
          detailAdmMeshBuildState.signature !== detailAdmMeta.signature
          || detailAdmMeshBuildState.status === "idle"
        );
      if (!includeProvince && !includeLocal && !includeDetailAdm) return;
      let changed = false;
      let snapshotChanged = false;
      visibleCountryCodes.forEach((countryCode) => {
        const hadProvince = runtimeState.cachedProvinceBordersByCountry?.has(countryCode);
        const hadLocal = runtimeState.cachedLocalBordersByCountry?.has(countryCode);
        ensureCountrySourceBorderMeshes(countryCode, {
          includeProvince,
          includeLocal,
        });
        if ((includeProvince && !hadProvince && runtimeState.cachedProvinceBordersByCountry?.has(countryCode))
          || (includeLocal && !hadLocal && runtimeState.cachedLocalBordersByCountry?.has(countryCode))) {
          changed = true;
          snapshotChanged = true;
        }
      });
      if (includeDetailAdm) {
        const previousDetailAdmStatus = String(detailAdmMeshBuildState.status || "idle");
        const detailAdmMesh = buildDetailAdmBorderMesh(runtimeState.topologyDetail, new Set(detailAdmMeta.detailCountries));
        if (isUsableMesh(detailAdmMesh)) {
          getBorderMeshOwner().replaceDetailAdmBorders([detailAdmMesh]);
          detailAdmMeshBuildState = {
            signature: detailAdmMeta.signature,
            status: "ready",
          };
          changed = true;
          snapshotChanged = true;
        } else {
          detailAdmMeshBuildState = {
            signature: detailAdmMeta.signature,
            status: "empty",
          };
          snapshotChanged =
            snapshotChanged
            || previousDetailAdmStatus !== "empty"
            || runtimeState.cachedDetailAdmBorders.length > 0;
        }
      }
      if (snapshotChanged) {
        syncStaticMeshSnapshot();
      }
      if (changed) {
        invalidateRenderPasses("borders", "deferred-country-border-meshes");
        render();
      }
      recordInteractionRecoveryTaskMetric(taskKey, nowMs() - startedAt, {
        visibleCountryCount: visibleCountryCodes.size,
        changed,
        includeProvince,
        includeLocal,
        includeDetailAdm,
        yieldCount: 0,
      });
    } finally {
      endInteractionRecoveryTask(taskKey);
    }
  }, {
    timeout: 360,
  });
}

function serializeCountrySetSignature(countrySet) {
  return Array.from(countrySet || []).sort((left, right) => left.localeCompare(right)).join(",");
}

function getSourceCountriesSignature(sourceCountries = {}) {
  return [
    `primary:${serializeCountrySetSignature(sourceCountries.primary)}`,
    `detail:${serializeCountrySetSignature(sourceCountries.detail)}`,
  ].join("|");
}

function getCoastlineDecisionSignature(decision = null) {
  if (!decision || typeof decision !== "object") {
    return "";
  }
  return [
    String(decision.scenarioSurfaceVersionSignal || ""),
    String(decision.source || ""),
    String(decision.reason || ""),
    String(decision.scenarioId || ""),
    String(decision.primaryObjectName || ""),
    String(decision.runtimeObjectName || ""),
    String(decision.meshMode || ""),
    Number(decision.primaryFeatureCount || 0),
    Number(decision.runtimeFeatureCount || 0),
    Number(decision.primaryPolygonPartCount || 0),
    Number(decision.runtimePolygonPartCount || 0),
    Number(decision.primaryInteriorRingCount || 0),
    Number(decision.runtimeInteriorRingCount || 0),
    Number(decision.runtimeInteriorRingRatio || 0),
    Number(decision.areaDeltaRatio || 0),
  ].join("|");
}

function captureStaticMeshSnapshot() {
  return {
    cachedCountryBorders: [...(runtimeState.cachedCountryBorders || [])],
    cachedProvinceBorders: [...(runtimeState.cachedProvinceBorders || [])],
    cachedProvinceBordersByCountry: new Map(runtimeState.cachedProvinceBordersByCountry || []),
    cachedLocalBorders: [...(runtimeState.cachedLocalBorders || [])],
    cachedLocalBordersByCountry: new Map(runtimeState.cachedLocalBordersByCountry || []),
    cachedDetailAdmBorders: [...(runtimeState.cachedDetailAdmBorders || [])],
    cachedCoastlines: [...(runtimeState.cachedCoastlines || [])],
    cachedCoastlinesHigh: [...(runtimeState.cachedCoastlinesHigh || [])],
    cachedCoastlinesMid: [...(runtimeState.cachedCoastlinesMid || [])],
    cachedCoastlinesLow: [...(runtimeState.cachedCoastlinesLow || [])],
    cachedParentBordersByCountry: new Map(runtimeState.cachedParentBordersByCountry || []),
    cachedGridLines: [...(runtimeState.cachedGridLines || [])],
    parentGroupByFeatureId: new Map(runtimeState.parentGroupByFeatureId || []),
    parentBorderMetaByCountry: { ...(runtimeState.parentBorderMetaByCountry || {}) },
    parentBorderSupportedCountries: [...(runtimeState.parentBorderSupportedCountries || [])],
    detailAdmMeshBuildState: { ...(detailAdmMeshBuildState || { signature: "", status: "idle" }) },
  };
}

function restoreStaticMeshSnapshot(snapshot) {
  if (!snapshot) return;
  runtimeState.cachedCountryBorders = [...(snapshot.cachedCountryBorders || [])];
  runtimeState.cachedProvinceBorders = [...(snapshot.cachedProvinceBorders || [])];
  runtimeState.cachedProvinceBordersByCountry = new Map(snapshot.cachedProvinceBordersByCountry || []);
  runtimeState.cachedLocalBorders = [...(snapshot.cachedLocalBorders || [])];
  runtimeState.cachedLocalBordersByCountry = new Map(snapshot.cachedLocalBordersByCountry || []);
  getBorderMeshOwner().replaceDetailAdmBorders([...(snapshot.cachedDetailAdmBorders || [])]);
  runtimeState.cachedCoastlines = [...(snapshot.cachedCoastlines || [])];
  runtimeState.cachedCoastlinesHigh = [...(snapshot.cachedCoastlinesHigh || [])];
  runtimeState.cachedCoastlinesMid = [...(snapshot.cachedCoastlinesMid || [])];
  runtimeState.cachedCoastlinesLow = [...(snapshot.cachedCoastlinesLow || [])];
  runtimeState.cachedParentBordersByCountry = new Map(snapshot.cachedParentBordersByCountry || []);
  runtimeState.cachedGridLines = [...(snapshot.cachedGridLines || [])];
  runtimeState.parentGroupByFeatureId = new Map(snapshot.parentGroupByFeatureId || []);
  runtimeState.parentBorderMetaByCountry = { ...(snapshot.parentBorderMetaByCountry || {}) };
  runtimeState.parentBorderSupportedCountries = [...(snapshot.parentBorderSupportedCountries || [])];
  detailAdmMeshBuildState = snapshot.detailAdmMeshBuildState && typeof snapshot.detailAdmMeshBuildState === "object"
    ? {
      signature: String(snapshot.detailAdmMeshBuildState.signature || ""),
      status: String(snapshot.detailAdmMeshBuildState.status || "idle"),
    }
    : { signature: "", status: "idle" };
  syncParentBorderEnabledByCountry(runtimeState.parentBorderSupportedCountries);
}

function publishScenarioCoastlineDecision(decision) {
  if (!decision || typeof decision !== "object") return decision;
  const publicDecision = { ...decision };
  delete publicDecision.topology;
  recordRenderPerfMetric("resolveScenarioCoastlineSource", 0, publicDecision);
  globalThis.__mapCoastlineDiag = publicDecision;
  if (renderDiag.enabled) {
    publishRenderDiagnostics({
      coastline: publicDecision,
    });
  }
  return decision;
}

function getLineLength(line) {
  if (!Array.isArray(line) || line.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < line.length; i += 1) {
    const prev = line[i - 1];
    const curr = line[i];
    if (!prev || !curr) continue;
    total += Math.hypot(curr[0] - prev[0], curr[1] - prev[1]);
  }
  return total;
}

function rebuildStaticMeshes({
  refreshOpeningOwnerBorders = true,
} = {}) {
  const startedAt = nowMs();
  cancelDeferredHeavyBorderMeshes();
  resetVisibleInternalBorderMeshSignature();
  if (!globalThis.topojson) {
    staticMeshCache.snapshot = null;
    setStaticMeshSourceCountries();
    runtimeState.cachedCountryBorders = [];
    runtimeState.cachedProvinceBorders = [];
    runtimeState.cachedProvinceBordersByCountry = new Map();
    runtimeState.cachedLocalBorders = [];
    runtimeState.cachedLocalBordersByCountry = new Map();
    getBorderMeshOwner().replaceDetailAdmBorders();
    runtimeState.cachedCoastlines = [];
    runtimeState.cachedCoastlinesHigh = [];
    runtimeState.cachedCoastlinesMid = [];
    runtimeState.cachedCoastlinesLow = [];
    runtimeState.cachedParentBordersByCountry = new Map();
    runtimeState.cachedGridLines = [];
    runtimeState.parentGroupByFeatureId = new Map();
    runtimeState.parentBorderMetaByCountry = {};
    runtimeState.parentBorderSupportedCountries = [];
    syncParentBorderEnabledByCountry([]);
    if (typeof runtimeState.updateParentBorderCountryListFn === "function") {
      runtimeState.updateParentBorderCountryListFn();
    }
    recordRenderPerfMetric("rebuildStaticMeshes", nowMs() - startedAt, {
      hasTopojson: false,
      countryMeshes: 0,
      coastlineMeshes: 0,
    });
    return;
  }

  const sourceCountries = getSourceCountrySets();
  setStaticMeshSourceCountries(sourceCountries);
  const coastlineSourceDecision = resolveCoastlineTopologySource();
  const sourceCountriesSignature = getSourceCountriesSignature(sourceCountries);
  const coastlineDecisionSignature = getCoastlineDecisionSignature(coastlineSourceDecision);
  const primaryTopology = runtimeState.topologyPrimary || runtimeState.topology;
  const detailTopology = runtimeState.topologyDetail || null;
  const runtimeTopology = runtimeState.runtimePoliticalTopology || null;
  const cacheMatches =
    staticMeshCache.primaryRef === primaryTopology &&
    staticMeshCache.detailRef === detailTopology &&
    staticMeshCache.runtimeRef === runtimeTopology &&
    staticMeshCache.bundleMode === String(runtimeState.topologyBundleMode || "") &&
    staticMeshCache.activeScenarioId === String(runtimeState.activeScenarioId || "") &&
    staticMeshCache.scenarioBorderMode === String(runtimeState.scenarioBorderMode || "") &&
    staticMeshCache.scenarioOwnershipColorMode === "ownership" &&
    staticMeshCache.sourceCountriesSignature === sourceCountriesSignature &&
    staticMeshCache.coastlineDecisionSignature === coastlineDecisionSignature &&
    staticMeshCache.snapshot;
  if (cacheMatches) {
    restoreStaticMeshSnapshot(staticMeshCache.snapshot);
    const currentZoom = Math.max(0.0001, Number(runtimeState.zoomTransform?.k || 1));
    if (currentZoom >= DETAIL_ADM_BORDERS_MIN_ZOOM) {
      const detailAdmMeta = buildDetailAdmMeshSignature(getVisibleCountryCodesForBorderMeshes(), currentZoom);
      detailAdmMeshBuildState = {
        signature: detailAdmMeta.signature,
        status: runtimeState.cachedDetailAdmBorders.length
          ? "ready"
          : (detailAdmMeta.detailCountries.length ? "idle" : "empty"),
      };
    } else {
      detailAdmMeshBuildState = {
        signature: "",
        status: "idle",
      };
    }
    if (typeof runtimeState.updateParentBorderCountryListFn === "function") {
      runtimeState.updateParentBorderCountryListFn();
    }
    recordRenderPerfMetric("rebuildStaticMeshes", nowMs() - startedAt, {
      hasTopojson: true,
      cacheHit: true,
      countryMeshes: runtimeState.cachedCountryBorders.length,
      provinceMeshes: runtimeState.cachedProvinceBorders.length,
      localMeshes: runtimeState.cachedLocalBorders.length,
      coastlineMeshes: runtimeState.cachedCoastlines.length,
      coastlineSource: String(coastlineSourceDecision?.source || "primary"),
      coastlineReason: String(coastlineSourceDecision?.reason || ""),
    });
    return;
  }

  runtimeState.cachedCountryBorders = [];
  runtimeState.cachedProvinceBorders = [];
  runtimeState.cachedProvinceBordersByCountry = new Map();
  runtimeState.cachedLocalBorders = [];
  runtimeState.cachedLocalBordersByCountry = new Map();
  getBorderMeshOwner().replaceDetailAdmBorders();
  runtimeState.cachedCoastlines = [];
  runtimeState.cachedCoastlinesHigh = [];
  runtimeState.cachedCoastlinesMid = [];
  runtimeState.cachedCoastlinesLow = [];
  runtimeState.cachedParentBordersByCountry = new Map();
  runtimeState.cachedGridLines = [];
  runtimeState.parentGroupByFeatureId = new Map();
  runtimeState.parentBorderMetaByCountry = {};
  runtimeState.parentBorderSupportedCountries = [];
  refreshParentBorderSupport();

  if (Math.max(0.0001, Number(runtimeState.zoomTransform?.k || 1)) >= DETAIL_ADM_BORDERS_MIN_ZOOM) {
    const visibleCountryCodes = getVisibleCountryCodesForBorderMeshes();
    const detailCountries = new Set(
      [...(sourceCountries.detail || new Set())].filter((countryCode) => visibleCountryCodes.has(countryCode))
    );
    const detailAdmMesh = buildDetailAdmBorderMesh(runtimeState.topologyDetail, detailCountries);
    if (isUsableMesh(detailAdmMesh)) {
      getBorderMeshOwner().replaceDetailAdmBorders([detailAdmMesh]);
      detailAdmMeshBuildState = {
        signature: buildDetailAdmMeshSignature(visibleCountryCodes, runtimeState.zoomTransform?.k || 1).signature,
        status: "ready",
      };
    } else {
      detailAdmMeshBuildState = {
        signature: buildDetailAdmMeshSignature(visibleCountryCodes, runtimeState.zoomTransform?.k || 1).signature,
        status: detailCountries.size ? "empty" : "empty",
      };
    }
  } else {
    detailAdmMeshBuildState = {
      signature: "",
      status: "idle",
    };
  }

  const unifiedBorderTopology =
    runtimeState.topologyBundleMode === "composite" && runtimeTopology?.objects?.political
      ? runtimeTopology
      : primaryTopology;
  const countryMesh = buildGlobalCountryBorderMesh(unifiedBorderTopology);
  if (isUsableMesh(countryMesh)) {
    runtimeState.cachedCountryBorders.push(countryMesh);
  }

  const coastlineMesh = buildGlobalCoastlineMesh(coastlineSourceDecision || primaryTopology);
  if (isUsableMesh(coastlineMesh)) {
    runtimeState.cachedCoastlines.push(coastlineMesh);
    runtimeState.cachedCoastlinesHigh.push(coastlineMesh);

    const coastlineMid = simplifyCoastlineMesh(coastlineMesh, {
      epsilon: COASTLINE_SIMPLIFY_MID_EPSILON,
      minLength: COASTLINE_SIMPLIFY_MID_MIN_LENGTH,
    });
    const coastlineLow = simplifyCoastlineMesh(coastlineMesh, {
      epsilon: COASTLINE_SIMPLIFY_LOW_EPSILON,
      minLength: COASTLINE_SIMPLIFY_LOW_MIN_LENGTH,
    });

    if (isUsableMesh(coastlineMid)) {
      runtimeState.cachedCoastlinesMid.push(coastlineMid);
    } else {
      runtimeState.cachedCoastlinesMid.push(coastlineMesh);
    }
    if (isUsableMesh(coastlineLow)) {
      runtimeState.cachedCoastlinesLow.push(coastlineLow);
    } else if (isUsableMesh(coastlineMid)) {
      runtimeState.cachedCoastlinesLow.push(coastlineMid);
    } else {
      runtimeState.cachedCoastlinesLow.push(coastlineMesh);
    }
  }

  // Province/local border meshes are viewport- and zoom-dependent. Building them
  // synchronously here turns startup and chunk promotion into a per-country
  // topojson.mesh fanout; the draw owner schedules them when the zoom level
  // actually needs them.
  if (
    refreshOpeningOwnerBorders !== false
    &&
    runtimeState.activeScenarioId
    && runtimeState.scenarioBorderMode === "scenario_owner_only"
    && "ownership" === "ownership"
  ) {
    refreshScenarioOpeningOwnerBorders({
      renderNow: false,
      reason: "rebuild-static-meshes:opening",
    });
  }

  // Backward compatibility: expose local boundaries as "grid lines".
  runtimeState.cachedGridLines = [...(runtimeState.cachedLocalBorders || [])];
  staticMeshCache = {
    primaryRef: primaryTopology,
    detailRef: detailTopology,
    runtimeRef: runtimeTopology,
    bundleMode: String(runtimeState.topologyBundleMode || ""),
    activeScenarioId: String(runtimeState.activeScenarioId || ""),
    scenarioBorderMode: String(runtimeState.scenarioBorderMode || ""),
    scenarioOwnershipColorMode: "ownership",
    sourceCountriesSignature,
    coastlineDecisionSignature,
    snapshot: captureStaticMeshSnapshot(),
  };
  recordRenderPerfMetric("rebuildStaticMeshes", nowMs() - startedAt, {
    hasTopojson: true,
    cacheHit: false,
    countryMeshes: runtimeState.cachedCountryBorders.length,
    provinceMeshes: runtimeState.cachedProvinceBorders.length,
    localMeshes: runtimeState.cachedLocalBorders.length,
    coastlineMeshes: runtimeState.cachedCoastlines.length,
    coastlineSource: String(coastlineSourceDecision?.source || "primary"),
    coastlineReason: String(coastlineSourceDecision?.reason || ""),
  });
  scheduleDeferredHeavyBorderMeshes();
}

function invalidateBorderCache() {
  const startedAt = nowMs();
  rebuildDynamicBorders();
  invalidateRenderPasses("borders", "border-cache");
  recordRenderPerfMetric("invalidateBorderCache", nowMs() - startedAt, {
    dynamicBorderCount: Array.isArray(runtimeState.dynamicBorderFeatures) ? runtimeState.dynamicBorderFeatures.length : 0,
  });
}

function isHgoRuntimePreviewReady() {
  return getHgoRuntimePreviewRenderOwner().isReady();
}

function getHgoRuntimePreviewVisibilitySignature() {
  return getHgoRuntimePreviewRenderOwner().getVisibilitySignature();
}

function getActiveRenderPassNames() {
  return getHgoRuntimePreviewRenderOwner().getActiveRenderPassNames();
}

function getActiveTransformedFramePassNames() {
  return getHgoRuntimePreviewRenderOwner().getActiveTransformedFramePassNames();
}

function getHgoRuntimePreviewProjectionOptions(overrides = {}) {
  return getHgoRuntimePreviewRenderOwner().getProjectionOptions(overrides);
}

registerRuntimeHook(runtimeState, "getHgoRuntimePreviewProjectionOptionsFn", getHgoRuntimePreviewProjectionOptions);

function inspectHgoRuntimePreviewFromEvent(event, { eventType = "unknown" } = {}) {
  return getHgoRuntimePreviewRenderOwner().inspectFromEvent(event, { eventType });
}

function keyToHitColor(key) {
  const value = Math.max(0, Math.min(0xffffff, Number(key) || 0));
  const r = value & 255;
  const g = (value >> 8) & 255;
  const b = (value >> 16) & 255;
  return `rgb(${r}, ${g}, ${b})`;
}

function hitColorToKey(pixel) {
  if (!pixel || pixel.length < 3) return 0;
  return (pixel[0] || 0) | ((pixel[1] || 0) << 8) | ((pixel[2] || 0) << 16);
}

function drawHitCanvas() {
  if (!rendererSurfaceHost.getHitContext() || !rendererSurfaceHost.getPathHitCanvas() || !runtimeState.landData?.features?.length) {
    runtimeState.hitCanvasDirty = false;
    runtimeState.hitCanvasTopologyRevision = 0;
    lastHitCanvasBuildStats = null;
    return false;
  }

  const width = rendererSurfaceHost.getHitCanvas()?.width || 0;
  const height = rendererSurfaceHost.getHitCanvas()?.height || 0;
  if (width <= 0 || height <= 0) {
    runtimeState.hitCanvasDirty = false;
    runtimeState.hitCanvasTopologyRevision = 0;
    lastHitCanvasBuildStats = null;
    return false;
  }

  const t = runtimeState.zoomTransform || globalThis.d3.zoomIdentity;
  const k = Math.max(0.0001, t.k || 1);

  rendererSurfaceHost.getHitContext().save();
  rendererSurfaceHost.getHitContext().setTransform(1, 0, 0, 1, 0, 0);
  rendererSurfaceHost.getHitContext().clearRect(0, 0, width, height);
  rendererSurfaceHost.getHitContext().globalCompositeOperation = "source-over";
  rendererSurfaceHost.getHitContext().globalAlpha = 1;
  rendererSurfaceHost.getHitContext().filter = "none";
  rendererSurfaceHost.getHitContext().shadowBlur = 0;
  rendererSurfaceHost.getHitContext().setTransform(runtimeState.dpr, 0, 0, runtimeState.dpr, 0, 0);
  rendererSurfaceHost.getHitContext().translate(t.x, t.y);
  rendererSurfaceHost.getHitContext().scale(k, k);

  const visibleSpatialItemsResult = collectVisibleLandSpatialItemsWithStats({
    overscanPx: HIT_CANVAS_VIEWPORT_OVERSCAN_PX,
  });
  if (visibleSpatialItemsResult === null) {
    rendererSurfaceHost.getHitContext().restore();
    runtimeState.hitCanvasDirty = true;
    lastHitCanvasBuildStats = null;
    recordRenderPerfMetric("hitCanvasSpatialIndexUnavailable", 0, {
      reason: "spatial-index-unavailable",
      activeScenarioId: String(runtimeState.activeScenarioId || ""),
    });
    return false;
  }
  const visibleSpatialItems = visibleSpatialItemsResult.items;
  let drawnItemCount = 0;
  visibleSpatialItems.forEach((item) => {
    const key = runtimeState.idToKey.get(item.id);
    if (!key || !item?.feature) return;
    if (shouldExcludePoliticalInteractionFeature(item.feature, item.id)) return;
    rendererSurfaceHost.getHitContext().beginPath();
    rendererSurfaceHost.getPathHitCanvas()(item.feature);
    rendererSurfaceHost.getHitContext().fillStyle = keyToHitColor(key);
    rendererSurfaceHost.getHitContext().fill();
    drawnItemCount += 1;
  });

  rendererSurfaceHost.getHitContext().restore();
  runtimeState.hitCanvasDirty = false;
  runtimeState.hitCanvasTopologyRevision = Number(runtimeState.topologyRevision || 0);
  lastHitCanvasBuildStats = {
    ...visibleSpatialItemsResult.stats,
    visibleItemCount: visibleSpatialItems.length,
    drawnItemCount,
    globalCount: Number(visibleSpatialItemsResult.stats?.globalCandidateCount || 0),
    spatialItemCount: Array.isArray(runtimeState.spatialItems) ? runtimeState.spatialItems.length : 0,
  };
  incrementPerfCounter("hitCanvasRenders");
  return true;
}

function drawHitCanvasWithMetric(details = {}) {
  const startedAt = nowMs();
  const dirtyBefore = !!runtimeState.hitCanvasDirty;
  const built = drawHitCanvas();
  const durationMs = nowMs() - startedAt;
  const metricDetails = {
    built: !!built,
    dirtyBefore,
    ...(lastHitCanvasBuildStats || {}),
    ...details,
  };
  recordRenderPerfMetric("buildHitCanvas", durationMs, metricDetails);
  recordRenderPerfMetric("hitCanvasViewportProfile", durationMs, {
    sourceMetric: "buildHitCanvas",
    profile: "viewport-full",
    ...metricDetails,
  });
  return built;
}

function drawScheduledHitCanvasWithMetric(details = {}) {
  const {
    reason = "idle-render",
    activeScenarioId = String(runtimeState.activeScenarioId || ""),
    ...metricDetails
  } = details || {};
  return drawHitCanvasWithMetric({
    ...metricDetails,
    mode: "deferred",
    reason,
    activeScenarioId,
  });
}

function recordDeferredFullHitCanvasMetric({ reason = "deferred-full", keepReady = false } = {}) {
  const metricDetails = {
    built: false,
    skipped: true,
    mode: "deferred-full",
    reason,
    activeScenarioId: String(runtimeState.activeScenarioId || ""),
    dirtyBefore: !!runtimeState.hitCanvasDirty,
    current: isHitCanvasCurrent(),
    keepReady: !!keepReady,
  };
  recordRenderPerfMetric("buildHitCanvas", 0, metricDetails);
  recordRenderPerfMetric("hitCanvasViewportProfile", 0, {
    sourceMetric: "buildHitCanvas",
    profile: "deferred-full",
    ...metricDetails,
  });
  return false;
}

function scheduleHitCanvasBuildIfNeeded({ reason = "idle-render" } = {}) {
  getHitCanvasSchedulingOwner().scheduleHitCanvasBuildIfNeeded({ reason });
  return false;
}

function ensureHitCanvasUpToDate({ force = false } = {}) {
  if (!rendererSurfaceHost.getHitContext() || !rendererSurfaceHost.getPathHitCanvas()) return false;
  if (!force && !runtimeState.hitCanvasDirty) return true;
  if (!force) {
    scheduleHitCanvasBuildIfNeeded({ reason: "lazy-hit-validation" });
    return false;
  }
  if (!runtimeState.hitCanvasDirty && isHitCanvasCurrent()) {
    recordRenderPerfMetric("buildHitCanvas", 0, {
      built: false,
      skipped: true,
      reason: "current",
      mode: "forced",
      activeScenarioId: String(runtimeState.activeScenarioId || ""),
    });
    return true;
  }
  getHitCanvasSchedulingOwner().cancelScheduledHitCanvasBuild({ reason: "strict-validation" });
  return drawHitCanvasWithMetric({
    mode: "forced",
    reason: "strict-validation",
    activeScenarioId: String(runtimeState.activeScenarioId || ""),
  });
}

function isHitCanvasCurrent() {
  return (
    !runtimeState.hitCanvasDirty
    && Number(runtimeState.hitCanvasTopologyRevision || 0) === Number(runtimeState.topologyRevision || 0)
  );
}

function getHitResultFromCanvas(event) {
  if (!rendererSurfaceHost.getMapSvg() || !rendererSurfaceHost.getHitContext() || !runtimeState.keyToId?.size || !globalThis.d3?.pointer) {
    return createHitResult();
  }
  const [sx, sy] = globalThis.d3.pointer(event, rendererSurfaceHost.getMapSvg());
  if (![sx, sy].every(Number.isFinite)) return createHitResult();
  const dpr = Number.isFinite(Number(runtimeState.dpr)) && Number(runtimeState.dpr) > 0
    ? Number(runtimeState.dpr)
    : 1;
  const px = Math.max(0, Math.min((rendererSurfaceHost.getHitCanvas()?.width || 1) - 1, Math.round(sx * dpr)));
  const py = Math.max(0, Math.min((rendererSurfaceHost.getHitCanvas()?.height || 1) - 1, Math.round(sy * dpr)));

  let pixel = null;
  try {
    pixel = rendererSurfaceHost.getHitContext().getImageData(px, py, 1, 1).data;
  } catch (_error) {
    return createHitResult();
  }

  const key = hitColorToKey(pixel);
  if (!key) return createHitResult();
  const id = runtimeState.keyToId.get(key);
  if (!id) return createHitResult();
  const feature = runtimeState.landIndex.get(id);
  const [canvasWidth, canvasHeight] = getLogicalCanvasDimensions();
  if (
    !feature
    || shouldExcludePoliticalInteractionFeature(feature, id)
    || shouldSkipFeature(feature, canvasWidth, canvasHeight, { forceProd: true })
  ) {
    return createHitResult();
  }
  return createHitResult({
    id,
    countryCode: getFeatureInteractionCountryCodeNormalized(feature, id),
    runtimeCountryCode: getFeatureCountryCodeNormalized(feature),
    targetType: "land",
    feature,
    hitSource: "canvas",
    bboxArea: Number(runtimeState.spatialItemsById?.get(id)?.bboxArea || Infinity),
    viaSnap: false,
    strict: true,
    distancePx: 0,
  });
}

function getDirtyHitCanvasPointProbeHit(event) {
  if (!rendererSurfaceHost.getMapSvg() || !rendererSurfaceHost.getHitContext() || !rendererSurfaceHost.getPathHitCanvas() || !runtimeState.keyToId?.size || !globalThis.d3?.pointer) {
    return createHitResult();
  }
  const startedAt = nowMs();
  const [sx, sy] = globalThis.d3.pointer(event, rendererSurfaceHost.getMapSvg());
  if (![sx, sy].every(Number.isFinite)) return createHitResult();
  const t = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity || { x: 0, y: 0, k: 1 };
  const k = Math.max(0.0001, Number(t.k) || 1);
  const projectedX = (Number(sx) - Number(t.x || 0)) / k;
  const projectedY = (Number(sy) - Number(t.y || 0)) / k;
  if (![projectedX, projectedY].every(Number.isFinite)) return createHitResult();
  const candidates = collectGridCandidates(projectedX, projectedY, 0)
    .sort((left, right) => (left?.item?.drawOrder ?? 0) - (right?.item?.drawOrder ?? 0));
  const dpr = Number.isFinite(Number(runtimeState.dpr)) && Number(runtimeState.dpr) > 0
    ? Number(runtimeState.dpr)
    : 1;
  const px = Math.max(0, Math.min((rendererSurfaceHost.getHitCanvas()?.width || 1) - 1, Math.round(sx * dpr)));
  const py = Math.max(0, Math.min((rendererSurfaceHost.getHitCanvas()?.height || 1) - 1, Math.round(sy * dpr)));
  let drawnItemCount = 0;
  let hit = createHitResult();
  try {
    rendererSurfaceHost.getHitContext().save();
    rendererSurfaceHost.getHitContext().setTransform(1, 0, 0, 1, 0, 0);
    rendererSurfaceHost.getHitContext().clearRect(px - 1, py - 1, 3, 3);
    rendererSurfaceHost.getHitContext().beginPath();
    rendererSurfaceHost.getHitContext().rect(px - 1, py - 1, 3, 3);
    rendererSurfaceHost.getHitContext().clip();
    rendererSurfaceHost.getHitContext().globalCompositeOperation = "source-over";
    rendererSurfaceHost.getHitContext().globalAlpha = 1;
    rendererSurfaceHost.getHitContext().filter = "none";
    rendererSurfaceHost.getHitContext().shadowBlur = 0;
    rendererSurfaceHost.getHitContext().setTransform(dpr, 0, 0, dpr, 0, 0);
    rendererSurfaceHost.getHitContext().translate(t.x, t.y);
    rendererSurfaceHost.getHitContext().scale(k, k);
    candidates.forEach(({ item }) => {
      const key = runtimeState.idToKey.get(item?.id);
      if (!key || !item?.feature) return;
      if (shouldExcludePoliticalInteractionFeature(item.feature, item.id)) return;
      rendererSurfaceHost.getHitContext().beginPath();
      rendererSurfaceHost.getPathHitCanvas()(item.feature);
      rendererSurfaceHost.getHitContext().fillStyle = keyToHitColor(key);
      rendererSurfaceHost.getHitContext().fill();
      drawnItemCount += 1;
    });
    rendererSurfaceHost.getHitContext().restore();
    const pixel = rendererSurfaceHost.getHitContext().getImageData(px, py, 1, 1).data;
    const key = hitColorToKey(pixel);
    const id = key ? runtimeState.keyToId.get(key) : "";
    const feature = id ? runtimeState.landIndex.get(id) : null;
    const [canvasWidth, canvasHeight] = getLogicalCanvasDimensions();
    if (
      id
      && feature
      && !shouldExcludePoliticalInteractionFeature(feature, id)
      && !shouldSkipFeature(feature, canvasWidth, canvasHeight, { forceProd: true })
    ) {
      hit = createHitResult({
        id,
        countryCode: getFeatureInteractionCountryCodeNormalized(feature, id),
        runtimeCountryCode: getFeatureCountryCodeNormalized(feature),
        targetType: "land",
        feature,
        hitSource: "point-probe",
        bboxArea: Number(runtimeState.spatialItemsById?.get(id)?.bboxArea || Infinity),
        viaSnap: false,
        strict: true,
        distancePx: 0,
      });
    }
  } catch (_error) {
    try {
      rendererSurfaceHost.getHitContext().restore();
    } catch (_restoreError) {
      // Already restored.
    }
    hit = createHitResult();
  }
  const durationMs = nowMs() - startedAt;
  const details = {
    activeScenarioId: String(runtimeState.activeScenarioId || ""),
    candidateCount: candidates.length,
    drawnItemCount,
    hit: !!hit.id,
    hitSource: "point-probe",
    dirtyBefore: !!runtimeState.hitCanvasDirty,
  };
  recordRenderPerfMetric("hitCanvasPointProbe", durationMs, details);
  recordRenderPerfMetric("hitCanvasViewportProfile", durationMs, {
    sourceMetric: "hitCanvasPointProbe",
    profile: "point-probe",
    ...details,
  });
  return hit;
}

function getValidatedCanvasHit(event, strictIds = null, { forceBuild = false } = {}) {
  if (runtimeState.renderPhase !== RENDER_PHASE_IDLE) {
    return createHitResult();
  }
  let hit = createHitResult();
  if (isHitCanvasCurrent()) {
    hit = getHitResultFromCanvas(event);
  } else {
    scheduleHitCanvasBuildIfNeeded({ reason: forceBuild ? "dirty-point-probe-click" : "dirty-point-probe-hover" });
    hit = getDirtyHitCanvasPointProbeHit(event);
  }
  if (!hit.id) return hit;
  if (!strictIds?.size || strictIds.has(hit.id)) return hit;
  return createHitResult();
}

function collectGridCandidates(px, py, radiusProj = 0) {
  return collectSpatialGridCandidates({
    grid: runtimeState.spatialGrid,
    gridMeta: runtimeState.spatialGridMeta,
    px,
    py,
    radiusProj,
    getSpatialBucketKey,
    shouldIncludeItem: (item) => !shouldExcludePoliticalInteractionFeature(item.feature, item.id),
  });
}

function getProjectedViewportBounds({
  overscanPx = Math.max(
    VIEWPORT_CULL_OVERSCAN_PX,
    Math.min(runtimeState.width || 0, runtimeState.height || 0) * 0.08
  ),
} = {}) {
  const width = Number(runtimeState.width) || 0;
  const height = Number(runtimeState.height) || 0;
  const t = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity || { x: 0, y: 0, k: 1 };
  const k = Math.max(0.0001, Number(t.k) || 1);
  if (width <= 0 || height <= 0) return null;
  const minX = (-Number(t.x || 0) - overscanPx) / k;
  const minY = (-Number(t.y || 0) - overscanPx) / k;
  const maxX = (width - Number(t.x || 0) + overscanPx) / k;
  const maxY = (height - Number(t.y || 0) + overscanPx) / k;
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  return {
    minX: Math.min(minX, maxX),
    minY: Math.min(minY, maxY),
    maxX: Math.max(minX, maxX),
    maxY: Math.max(minY, maxY),
  };
}

function getPoliticalPassViewportOverscanPx() {
  const layout = getRenderPassLayout("political");
  const baseOverscanPx = Math.max(
    VIEWPORT_CULL_OVERSCAN_PX,
    Math.min(runtimeState.width || 0, runtimeState.height || 0) * 0.08
  );
  return Math.max(
    baseOverscanPx,
    baseOverscanPx + Math.max(Number(layout?.offsetX || 0), Number(layout?.offsetY || 0))
  );
}

function collectVisibleLandSpatialItemsWithStats({
  overscanPx = undefined,
} = {}) {
  const resolvedOverscanPx = Number.isFinite(Number(overscanPx))
    ? Number(overscanPx)
    : undefined;
  const viewportBounds = getProjectedViewportBounds({ overscanPx: resolvedOverscanPx });
  if (!viewportBounds) return null;
  return collectVisibleSpatialItemsWithStats({
    grid: runtimeState.spatialGrid,
    gridMeta: runtimeState.spatialGridMeta,
    items: runtimeState.spatialItems,
    viewportBounds,
    overscanPx: resolvedOverscanPx,
    shouldIncludeItem: (item) => !shouldExcludePoliticalVisualFeature(item.feature, item.id),
  });
}

function collectVisibleLandSpatialItems() {
  const result = collectVisibleLandSpatialItemsWithStats();
  return result ? result.items : null;
}

function collectWaterGridCandidates(px, py, radiusProj = 0) {
  return collectSpatialGridCandidates({
    grid: runtimeState.waterSpatialGrid,
    gridMeta: runtimeState.waterSpatialGridMeta,
    px,
    py,
    radiusProj,
    getSpatialBucketKey,
    shouldIncludeItem: (item) => isWaterRegionEnabled(item.feature),
  });
}

function collectSpecialGridCandidates(px, py, radiusProj = 0) {
  return collectSpatialGridCandidates({
    grid: runtimeState.specialSpatialGrid,
    gridMeta: runtimeState.specialSpatialGridMeta,
    px,
    py,
    radiusProj,
    getSpatialBucketKey,
    shouldIncludeItem: (item) => isSpecialRegionEnabled(item.feature),
  });
}

function rankCandidates(candidates, lonLat, { eventType = "unknown", targetType = "unknown" } = {}) {
  return rankHitCandidates(candidates, lonLat, {
    eventType,
    targetType,
    geoContains: globalThis.d3?.geoContains,
    nowMs,
    recordInteractionDurationMetric,
  });
}

function findFirstContainingCandidate(candidates, lonLat, { eventType = "hover", targetType = "unknown" } = {}) {
  return findFirstContainingHitCandidate(candidates, lonLat, {
    eventType,
    targetType,
    geoContains: globalThis.d3?.geoContains,
    nowMs,
    recordInteractionDurationMetric,
  });
}

function getPointerProjectionPosition(event) {
  if (!rendererSurfaceHost.getMapSvg() || !rendererSurfaceHost.getProjection() || !globalThis.d3) return null;
  const [sx, sy] = globalThis.d3.pointer(event, rendererSurfaceHost.getMapSvg());
  const transform = runtimeState.zoomTransform || globalThis.d3.zoomIdentity;
  const zoomK = Math.max(0.0001, transform?.k || 1);
  const px = (sx - (transform?.x || 0)) / zoomK;
  const py = (sy - (transform?.y || 0)) / zoomK;
  if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
  const lonLat = rendererSurfaceHost.getProjection().invert([px, py]);
  if (!lonLat) return null;
  return {
    px,
    py,
    lonLat,
    zoomK,
  };
}

function toHitResult(candidate, { viaSnap = false, strict = false, zoomK = 1, targetType = "land" } = {}) {
  return toCandidateHitResult(candidate, {
    viaSnap,
    strict,
    zoomK,
    targetType,
    canonicalCountryCode,
    getFeatureCountryCodeNormalized,
    getFeatureInteractionCountryCodeNormalized,
  });
}

function shouldPreferWaterHit(landHit, waterHit, { eventType = "unknown" } = {}) {
  return shouldPreferWaterHitCandidate(landHit, waterHit, {
    eventType,
    isMacroOceanWaterRegion,
    getWaterRegionType,
  });
}

function collectInteractionHitMetricDetails(
  pointer,
  { enableSnap = true, snapPx = HIT_SNAP_RADIUS_PX, eventType = "unknown", resolvedHit = null } = {}
) {
  if (!pointer) {
    return {
      eventType,
      specialCandidateCount: 0,
      landStrictCandidateCount: 0,
      landSnapCandidateCount: 0,
      waterStrictCandidateCount: 0,
      waterSnapCandidateCount: 0,
      resolvedTargetType: String(resolvedHit?.targetType || "empty"),
    };
  }
  const snapRadiusPx = Number.isFinite(Number(snapPx))
    ? Math.max(0, Number(snapPx))
    : HIT_SNAP_RADIUS_PX;
  const radiusProj = enableSnap && snapRadiusPx > 0
    ? snapRadiusPx / Math.max(0.0001, pointer.zoomK)
    : 0;
  const specialStrict = collectSpecialGridCandidates(pointer.px, pointer.py, 0);
  const specialSnap = radiusProj > 0 ? collectSpecialGridCandidates(pointer.px, pointer.py, radiusProj) : [];
  const landStrict = collectGridCandidates(pointer.px, pointer.py, 0);
  const landSnap = radiusProj > 0 ? collectGridCandidates(pointer.px, pointer.py, radiusProj) : [];
  const waterStrict = collectWaterGridCandidates(pointer.px, pointer.py, 0);
  const waterSnap = radiusProj > 0 ? collectWaterGridCandidates(pointer.px, pointer.py, radiusProj) : [];
  return {
    eventType,
    specialCandidateCount: Math.max(specialStrict.length, specialSnap.length),
    landStrictCandidateCount: landStrict.length,
    landSnapCandidateCount: landSnap.length,
    waterStrictCandidateCount: waterStrict.length,
    waterSnapCandidateCount: waterSnap.length,
    resolvedTargetType: String(resolvedHit?.targetType || "empty"),
  };
}

function recordInteractionHitMetrics(pointer, options = {}) {
  if (options.eventType === "hover") {
    incrementPerfCounter("interactionHitCandidateCount", options.resolvedHit?.id ? 1 : 0);
    if (options.resolvedHit?.hitSource === "canvas") {
      incrementPerfCounter("interactionHitCanvasPreferredCount");
    }
    return;
  }
  const details = collectInteractionHitMetricDetails(pointer, options);
  const totalCandidates =
    details.specialCandidateCount
    + details.landStrictCandidateCount
    + details.landSnapCandidateCount
    + details.waterStrictCandidateCount
    + details.waterSnapCandidateCount;
  incrementPerfCounter("interactionHitCandidateCount", totalCandidates);
  if (options.resolvedHit?.hitSource === "canvas") {
    incrementPerfCounter("interactionHitCanvasPreferredCount");
  }
  recordRenderPerfMetric("interactionHitCandidateCount", 0, {
    ...details,
    totalCandidateCount: totalCandidates,
  });
  recordRenderPerfMetric("interactionHitResolvedPath", 0, {
    ...details,
    hitSource: String(options.resolvedHit?.hitSource || "none"),
    viaSnap: !!options.resolvedHit?.viaSnap,
    strict: !!options.resolvedHit?.strict,
  });
  if (options.resolvedHit?.hitSource === "canvas") {
    recordRenderPerfMetric("interactionHitCanvasPreferredCount", 0, details);
  }
}

function getLandHitFromPointer(
  event,
  pointer,
  { enableSnap = true, snapPx = HIT_SNAP_RADIUS_PX, eventType = "unknown" } = {}
) {
  if (!runtimeState.landData || !runtimeState.spatialItems?.length) return createHitResult();
  const hitMode = resolveHitMode();
  if (hitMode === "canvas" && eventType !== "compat") {
    const hitFromCanvas = getValidatedCanvasHit(event, null, {
      forceBuild: eventType === "click" || eventType === "dblclick",
    });
    if (hitFromCanvas.id) {
      return hitFromCanvas;
    }
  }

  const strictCandidates = collectGridCandidates(pointer.px, pointer.py, 0);
  if (eventType === "hover" && !enableSnap) {
    const strictHoverHit = findFirstContainingCandidate(strictCandidates, pointer.lonLat, { eventType, targetType: "land" });
    return strictHoverHit
      ? toHitResult(strictHoverHit, {
        viaSnap: false,
        strict: true,
        zoomK: pointer.zoomK,
        targetType: "land",
      })
      : createHitResult();
  }
  const strictRanked = rankCandidates(strictCandidates, pointer.lonLat, { eventType, targetType: "land" });
  if (strictRanked.length > 0) {
    const strictContainsGeo = strictRanked.find((candidate) => candidate.containsGeo);
    if (strictContainsGeo) {
      if (hitMode === "auto" && eventType !== "compat") {
        const strictIds = new Set(strictRanked.map((candidate) => candidate.item.id));
        const strictMatchCount = strictRanked.filter((candidate) => candidate.containsGeo).length;
        const hitFromCanvas = getValidatedCanvasHit(event, strictIds, {
          forceBuild:
            strictMatchCount > 1
            && (eventType === "click" || eventType === "dblclick" || eventType === "compat"),
        });
        if (hitFromCanvas.id === strictContainsGeo.item.id) {
          return hitFromCanvas;
        }
      }
      return toHitResult(strictContainsGeo, {
        viaSnap: false,
        strict: true,
        zoomK: pointer.zoomK,
        targetType: "land",
      });
    }
  }

  if (!enableSnap) return createHitResult();

  const snapRadiusPx = Number.isFinite(Number(snapPx))
    ? Math.max(0, Number(snapPx))
    : HIT_SNAP_RADIUS_PX;
  const radiusProj = snapRadiusPx / pointer.zoomK;
  if (radiusProj <= 0) return createHitResult();

  const snapCandidates = collectGridCandidates(pointer.px, pointer.py, radiusProj);
  const snapRanked = rankCandidates(snapCandidates, pointer.lonLat, { eventType, targetType: "land" });
  if (!snapRanked.length) return createHitResult();

  const chosen = snapRanked.find((candidate) => candidate.containsGeo);
  if (!chosen) return createHitResult();
  return toHitResult(chosen, {
    viaSnap: true,
    strict: false,
    zoomK: pointer.zoomK,
    targetType: "land",
  });
}

function getWaterHitFromPointer(
  pointer,
  { enableSnap = true, snapPx = HIT_SNAP_RADIUS_PX, eventType = "unknown" } = {}
) {
  if (!runtimeState.showWaterRegions && !isOpenOceanOverlayActive()) return createHitResult();
  if (!runtimeState.waterSpatialItems?.length) {
    recordWaterHitDiagnostic({
      reason: "empty-water-spatial-items",
      eventType,
    });
    if (runtimeState.waterRegionsById?.size) {
      scheduleSecondarySpatialIndexBuild({
        reason: "water-hit-demand",
      });
    }
    return createHitResult();
  }

  const strictCandidates = collectWaterGridCandidates(pointer.px, pointer.py, 0);
  if (eventType === "hover" && !enableSnap) {
    const strictHoverHit = findFirstContainingCandidate(strictCandidates, pointer.lonLat, { eventType, targetType: "water" });
    if (!strictHoverHit) return createHitResult();
    if (isMacroOceanWaterRegion(strictHoverHit.item?.feature)) return createHitResult();
    if (shouldSuppressOpenOceanHit(strictHoverHit, pointer)) return createHitResult();
    return toHitResult(strictHoverHit, {
      viaSnap: false,
      strict: true,
      zoomK: pointer.zoomK,
      targetType: "water",
    });
  }
  const strictRanked = rankCandidates(strictCandidates, pointer.lonLat, { eventType, targetType: "water" });
  const strictHit = strictRanked.find((candidate) => candidate.containsGeo);
  if (strictHit) {
    if (eventType === "hover" && isMacroOceanWaterRegion(strictHit.item?.feature)) {
      return createHitResult();
    }
    if (shouldSuppressOpenOceanHit(strictHit, pointer)) {
      return createHitResult();
    }
    return toHitResult(strictHit, {
      viaSnap: false,
      strict: true,
      zoomK: pointer.zoomK,
      targetType: "water",
    });
  }

  if (!enableSnap) return createHitResult();

  const snapRadiusPx = Number.isFinite(Number(snapPx))
    ? Math.max(0, Number(snapPx))
    : HIT_SNAP_RADIUS_PX;
  const radiusProj = snapRadiusPx / pointer.zoomK;
  if (radiusProj <= 0) return createHitResult();

  const snapCandidates = collectWaterGridCandidates(pointer.px, pointer.py, radiusProj);
  const snapRanked = rankCandidates(snapCandidates, pointer.lonLat, { eventType, targetType: "water" });
  const chosen = snapRanked.find((candidate) => candidate.containsGeo);
  if (!chosen) return createHitResult();
  if (eventType === "hover" && isMacroOceanWaterRegion(chosen.item?.feature)) {
    return createHitResult();
  }
  if (shouldSuppressOpenOceanHit(chosen, pointer)) {
    return createHitResult();
  }
  return toHitResult(chosen, {
    viaSnap: true,
    strict: false,
    zoomK: pointer.zoomK,
    targetType: "water",
  });
}

function getSpecialHitFromPointer(
  pointer,
  { enableSnap = true, snapPx = HIT_SNAP_RADIUS_PX, eventType = "unknown" } = {}
) {
  if (!runtimeState.showScenarioSpecialRegions) return createHitResult();
  if (!runtimeState.specialSpatialItems?.length) {
    if (runtimeState.specialRegionsById?.size) {
      scheduleSecondarySpatialIndexBuild({
        reason: "special-hit-demand",
      });
    }
    return createHitResult();
  }

  const strictCandidates = collectSpecialGridCandidates(pointer.px, pointer.py, 0);
  if (eventType === "hover" && !enableSnap) {
    const strictHoverHit = findFirstContainingCandidate(strictCandidates, pointer.lonLat, { eventType, targetType: "special" });
    return strictHoverHit
      ? toHitResult(strictHoverHit, {
        viaSnap: false,
        strict: true,
        zoomK: pointer.zoomK,
        targetType: "special",
      })
      : createHitResult();
  }
  const strictRanked = rankCandidates(strictCandidates, pointer.lonLat, { eventType, targetType: "special" });
  const strictHit = strictRanked.find((candidate) => candidate.containsGeo);
  if (strictHit) {
    return toHitResult(strictHit, {
      viaSnap: false,
      strict: true,
      zoomK: pointer.zoomK,
      targetType: "special",
    });
  }

  if (!enableSnap) return createHitResult();

  const snapRadiusPx = Number.isFinite(Number(snapPx))
    ? Math.max(0, Number(snapPx))
    : HIT_SNAP_RADIUS_PX;
  const radiusProj = snapRadiusPx / pointer.zoomK;
  if (radiusProj <= 0) return createHitResult();

  const snapCandidates = collectSpecialGridCandidates(pointer.px, pointer.py, radiusProj);
  const snapRanked = rankCandidates(snapCandidates, pointer.lonLat, { eventType, targetType: "special" });
  const chosen = snapRanked.find((candidate) => candidate.containsGeo);
  if (!chosen) return createHitResult();
  return toHitResult(chosen, {
    viaSnap: true,
    strict: false,
    zoomK: pointer.zoomK,
    targetType: "special",
  });
}

function cancelPendingIndexUiRefresh() {
  if (deferredIndexUiRefreshHandle !== null && deferredIndexUiRefreshHandle !== undefined) {
    if (typeof globalThis.cancelAnimationFrame === "function") {
      globalThis.cancelAnimationFrame(deferredIndexUiRefreshHandle);
    } else {
      globalThis.clearTimeout(deferredIndexUiRefreshHandle);
    }
    deferredIndexUiRefreshHandle = null;
  }
  deferredIndexUiRefreshState = null;
  if (pendingIndexUiRefreshHandle === null || pendingIndexUiRefreshHandle === undefined) {
    pendingIndexUiRefreshState = null;
    return;
  }
  if (typeof globalThis.cancelAnimationFrame === "function") {
    globalThis.cancelAnimationFrame(pendingIndexUiRefreshHandle);
  } else {
    globalThis.clearTimeout(pendingIndexUiRefreshHandle);
  }
  pendingIndexUiRefreshHandle = null;
  pendingIndexUiRefreshState = null;
}

function flushPendingIndexUiRefresh() {
  const pending = pendingIndexUiRefreshState;
  pendingIndexUiRefreshHandle = null;
  pendingIndexUiRefreshState = null;
  if (!pending) return;
  const refreshedScopes = [];
  if (pending.renderCountryList && typeof runtimeState.renderCountryListFn === "function") {
    runtimeState.renderCountryListFn();
    refreshedScopes.push("country");
  }
  if (pending.renderWaterRegionList && typeof runtimeState.renderWaterRegionListFn === "function") {
    runtimeState.renderWaterRegionListFn();
    refreshedScopes.push("water");
  }
  if (pending.renderSpecialRegionList && typeof runtimeState.renderSpecialRegionListFn === "function") {
    runtimeState.renderSpecialRegionListFn();
    refreshedScopes.push("special");
  }
  if (refreshedScopes.length) {
    recordUiRefreshMetric("uiIndexFullRefresh", {
      scope: refreshedScopes.length === 1 ? refreshedScopes[0] : "mixed",
      refreshMode: "full",
      fullRefreshReason: "full-index-rebuild",
      refreshedScopes,
    });
  }
}

function scheduleIndexUiRefresh({
  renderCountryList = false,
  renderWaterRegionList = false,
  renderSpecialRegionList = false,
} = {}) {
  pendingIndexUiRefreshState = {
    renderCountryList: !!(pendingIndexUiRefreshState?.renderCountryList || renderCountryList),
    renderWaterRegionList: !!(pendingIndexUiRefreshState?.renderWaterRegionList || renderWaterRegionList),
    renderSpecialRegionList: !!(pendingIndexUiRefreshState?.renderSpecialRegionList || renderSpecialRegionList),
  };
  if (pendingIndexUiRefreshHandle !== null && pendingIndexUiRefreshHandle !== undefined) {
    return;
  }
  const callback = () => {
    flushPendingIndexUiRefresh();
  };
  pendingIndexUiRefreshHandle = typeof globalThis.requestAnimationFrame === "function"
    ? globalThis.requestAnimationFrame(callback)
    : globalThis.setTimeout(callback, 0);
}

function flushDeferredIndexUiRefresh() {
  const pending = deferredIndexUiRefreshState;
  deferredIndexUiRefreshHandle = null;
  deferredIndexUiRefreshState = null;
  if (!pending) return;
  scheduleIndexUiRefresh(pending);
}

function scheduleIndexUiRefreshAfterCoarseFrame({
  renderCountryList = false,
  renderWaterRegionList = false,
  renderSpecialRegionList = false,
} = {}) {
  deferredIndexUiRefreshState = {
    renderCountryList: !!(deferredIndexUiRefreshState?.renderCountryList || renderCountryList),
    renderWaterRegionList: !!(deferredIndexUiRefreshState?.renderWaterRegionList || renderWaterRegionList),
    renderSpecialRegionList: !!(deferredIndexUiRefreshState?.renderSpecialRegionList || renderSpecialRegionList),
  };
  if (deferredIndexUiRefreshHandle !== null && deferredIndexUiRefreshHandle !== undefined) {
    return;
  }
  const callback = () => {
    flushDeferredIndexUiRefresh();
  };
  deferredIndexUiRefreshHandle = typeof globalThis.requestAnimationFrame === "function"
    ? globalThis.requestAnimationFrame(callback)
    : globalThis.setTimeout(callback, 0);
}

function queueIndexUiRefresh(
  refreshOptions,
  scheduleUiMode = "immediate",
) {
  if (scheduleUiMode === "none") {
    return;
  }
  if (scheduleUiMode === "deferred") {
    scheduleIndexUiRefreshAfterCoarseFrame(refreshOptions);
    return;
  }
  scheduleIndexUiRefresh(refreshOptions);
}

function normalizeSidebarRefreshIds(values) {
  return Array.isArray(values)
    ? values.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
}

function normalizeSidebarRefreshOwnerCodes(values) {
  return Array.isArray(values)
    ? values.map((value) => canonicalCountryCode(value)).filter(Boolean)
    : [];
}

function refreshWaterRegionSidebarRowsNow(regionIds = [], { refreshInspector = true } = {}) {
  const changedIds = normalizeSidebarRefreshIds(regionIds);
  if (changedIds.length && typeof runtimeState.refreshWaterRegionListRowsFn === "function") {
    const result = unwrapRuntimeHookResult(runtimeState.refreshWaterRegionListRowsFn({
      regionIds: changedIds,
      refreshInspector,
    }));
    const refreshMode = result?.refreshMode === "full" ? "full" : "row";
    recordUiRefreshMetric(refreshMode === "row" ? "uiSidebarRowRefresh" : "uiSidebarFullRefresh", {
      scope: "water",
      changedIds,
      refreshMode,
      fullRefreshReason: refreshMode === "full" ? String(result?.fullRefreshReason || "unstable-row-owner") : undefined,
      refreshInspector,
    });
    return;
  }
  if (typeof runtimeState.renderWaterRegionListFn === "function") {
    runtimeState.renderWaterRegionListFn();
    recordUiRefreshMetric("uiSidebarFullRefresh", {
      scope: "water",
      changedIds,
      refreshMode: "full",
      fullRefreshReason: changedIds.length ? "hook-unavailable" : "missing-changed-ids",
    });
  }
}

function refreshSpecialRegionSidebarRowsNow(regionIds = [], { refreshInspector = true } = {}) {
  const changedIds = normalizeSidebarRefreshIds(regionIds);
  if (changedIds.length && typeof runtimeState.refreshSpecialRegionListRowsFn === "function") {
    const result = unwrapRuntimeHookResult(runtimeState.refreshSpecialRegionListRowsFn({
      regionIds: changedIds,
      refreshInspector,
    }));
    const refreshMode = result?.refreshMode === "full" ? "full" : "row";
    recordUiRefreshMetric(refreshMode === "row" ? "uiSidebarRowRefresh" : "uiSidebarFullRefresh", {
      scope: "special",
      changedIds,
      refreshMode,
      fullRefreshReason: refreshMode === "full" ? String(result?.fullRefreshReason || "unstable-row-owner") : undefined,
      refreshInspector,
    });
    return;
  }
  if (typeof runtimeState.renderSpecialRegionListFn === "function") {
    runtimeState.renderSpecialRegionListFn();
    recordUiRefreshMetric("uiSidebarFullRefresh", {
      scope: "special",
      changedIds,
      refreshMode: "full",
      fullRefreshReason: changedIds.length ? "hook-unavailable" : "missing-changed-ids",
    });
  }
}

function cancelPendingSidebarRefresh() {
  if (pendingSidebarRefreshHandle === null || pendingSidebarRefreshHandle === undefined) {
    pendingSidebarRefreshState = null;
    return;
  }
  if (typeof globalThis.cancelAnimationFrame === "function") {
    globalThis.cancelAnimationFrame(pendingSidebarRefreshHandle);
  } else {
    globalThis.clearTimeout(pendingSidebarRefreshHandle);
  }
  pendingSidebarRefreshHandle = null;
  pendingSidebarRefreshState = null;
}

function flushPendingSidebarRefresh() {
  const pending = pendingSidebarRefreshState;
  pendingSidebarRefreshHandle = null;
  pendingSidebarRefreshState = null;
  if (!pending) return;
  const countryCodes = Array.from(
    new Set([
      ...collectCountryCodesForFeatureIds(pending.featureIds),
      ...pending.ownerCodes,
    ])
  );
  const hasWaterRows = pending.waterRegionIds.length > 0;
  const hasSpecialRows = pending.specialRegionIds.length > 0;
  const hasCountryInspectorImpact = hasSelectedOrActiveCountryImpact(countryCodes);
  const shouldRefreshPresetTree = !!pending.refreshPresetTree && hasCountryInspectorImpact;
  if (hasWaterRows) {
    if (typeof runtimeState.refreshWaterRegionListRowsFn === "function") {
      const result = unwrapRuntimeHookResult(runtimeState.refreshWaterRegionListRowsFn({
        regionIds: pending.waterRegionIds,
        refreshInspector: true,
      }));
      const refreshMode = result?.refreshMode === "full" ? "full" : "row";
      recordUiRefreshMetric(refreshMode === "row" ? "uiSidebarRowRefresh" : "uiSidebarFullRefresh", {
        scope: "water",
        changedIds: pending.waterRegionIds.slice(),
        refreshMode,
        fullRefreshReason: refreshMode === "full" ? String(result?.fullRefreshReason || "unstable-row-owner") : undefined,
      });
    } else if (typeof runtimeState.renderWaterRegionListFn === "function") {
      runtimeState.renderWaterRegionListFn();
      recordUiRefreshMetric("uiSidebarFullRefresh", {
        scope: "water",
        changedIds: pending.waterRegionIds.slice(),
        refreshMode: "full",
        fullRefreshReason: "hook-unavailable",
      });
    }
  }
  if (hasSpecialRows) {
    if (typeof runtimeState.refreshSpecialRegionListRowsFn === "function") {
      const result = unwrapRuntimeHookResult(runtimeState.refreshSpecialRegionListRowsFn({
        regionIds: pending.specialRegionIds,
        refreshInspector: true,
      }));
      const refreshMode = result?.refreshMode === "full" ? "full" : "row";
      recordUiRefreshMetric(refreshMode === "row" ? "uiSidebarRowRefresh" : "uiSidebarFullRefresh", {
        scope: "special",
        changedIds: pending.specialRegionIds.slice(),
        refreshMode,
        fullRefreshReason: refreshMode === "full" ? String(result?.fullRefreshReason || "unstable-row-owner") : undefined,
      });
    } else if (typeof runtimeState.renderSpecialRegionListFn === "function") {
      runtimeState.renderSpecialRegionListFn();
      recordUiRefreshMetric("uiSidebarFullRefresh", {
        scope: "special",
        changedIds: pending.specialRegionIds.slice(),
        refreshMode: "full",
        fullRefreshReason: "hook-unavailable",
      });
    }
  }
  if (typeof runtimeState.refreshCountryListRowsFn === "function") {
    runtimeState.refreshCountryListRowsFn({
      countryCodes,
      refreshInspector: hasCountryInspectorImpact,
      refreshPresetTree: shouldRefreshPresetTree,
    });
    if (countryCodes.length > 0 || shouldRefreshPresetTree) {
      recordUiRefreshMetric("uiSidebarRowRefresh", {
        scope: "country",
        changedIds: countryCodes,
        refreshMode: "row",
        refreshInspector: hasCountryInspectorImpact,
        refreshPresetTree: shouldRefreshPresetTree,
      });
    }
    return;
  }
  if (typeof runtimeState.renderCountryListFn === "function" && (countryCodes.length > 0 || shouldRefreshPresetTree)) {
    runtimeState.renderCountryListFn();
    recordUiRefreshMetric("uiSidebarFullRefresh", {
      scope: "country",
      changedIds: countryCodes,
      refreshMode: "full",
      fullRefreshReason: "hook-unavailable",
      refreshPresetTree: shouldRefreshPresetTree,
    });
  }
  if (shouldRefreshPresetTree && typeof runtimeState.renderPresetTreeFn === "function") {
    runtimeState.renderPresetTreeFn();
  }
}

function scheduleSidebarRefresh({
  featureIds = [],
  waterRegionIds = [],
  specialRegionIds = [],
  ownerCodes = [],
  refreshPresetTree = false,
} = {}) {
  pendingSidebarRefreshState = {
    featureIds: Array.from(new Set([
      ...(pendingSidebarRefreshState?.featureIds || []),
      ...normalizeSidebarRefreshIds(featureIds),
    ])),
    waterRegionIds: Array.from(new Set([
      ...(pendingSidebarRefreshState?.waterRegionIds || []),
      ...normalizeSidebarRefreshIds(waterRegionIds),
    ])),
    specialRegionIds: Array.from(new Set([
      ...(pendingSidebarRefreshState?.specialRegionIds || []),
      ...normalizeSidebarRefreshIds(specialRegionIds),
    ])),
    ownerCodes: Array.from(new Set([
      ...(pendingSidebarRefreshState?.ownerCodes || []),
      ...normalizeSidebarRefreshOwnerCodes(ownerCodes),
    ])),
    refreshPresetTree: !!(pendingSidebarRefreshState?.refreshPresetTree || refreshPresetTree),
  };
  if (pendingSidebarRefreshHandle !== null && pendingSidebarRefreshHandle !== undefined) {
    return;
  }
  const callback = () => {
    flushPendingSidebarRefresh();
  };
  pendingSidebarRefreshHandle = typeof globalThis.requestAnimationFrame === "function"
    ? globalThis.requestAnimationFrame(callback)
    : globalThis.setTimeout(callback, 0);
}

function setInteractionInfrastructureState(
  stage,
  {
    ready = null,
    inFlight = null,
  } = {}
) {
  setInteractionInfrastructureStateFields(state, stage, {
    ready,
    inFlight,
  });
}

function getInteractionInfrastructureStageRank(stage = runtimeState.interactionInfrastructureStage) {
  const normalized = String(stage || "idle").trim().toLowerCase();
  if (normalized === "ready") return 2;
  if (normalized === "basic-ready") return 1;
  return 0;
}

async function yieldToMain() {
  if (typeof globalThis.scheduler?.yield === "function") {
    await globalThis.scheduler.yield();
    return;
  }
  await new Promise((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });
}

function rebuildAuxiliaryRegionIndexes() {
  runtimeState.waterRegionsById = new Map();
  runtimeState.specialRegionsById = new Map();

  getEffectiveWaterRegionFeatures().forEach((feature) => {
    const id = getFeatureId(feature);
    if (!id) return;
    runtimeState.waterRegionsById.set(id, feature);
  });

  getEffectiveSpecialRegionFeatures().forEach((feature) => {
    const id = getFeatureId(feature);
    if (!id) return;
    runtimeState.specialRegionsById.set(id, feature);
  });

  if (runtimeState.selectedWaterRegionId && !runtimeState.waterRegionsById.has(runtimeState.selectedWaterRegionId)) {
    runtimeState.selectedWaterRegionId = "";
  } else if (runtimeState.selectedWaterRegionId) {
    const selectedFeature = runtimeState.waterRegionsById.get(runtimeState.selectedWaterRegionId);
    if (!isWaterRegionEnabled(selectedFeature)) {
      runtimeState.selectedWaterRegionId = "";
    }
  }

  if (runtimeState.selectedSpecialRegionId && !runtimeState.specialRegionsById.has(runtimeState.selectedSpecialRegionId)) {
    runtimeState.selectedSpecialRegionId = "";
  } else if (runtimeState.selectedSpecialRegionId) {
    const selectedFeature = runtimeState.specialRegionsById.get(runtimeState.selectedSpecialRegionId);
    if (!isSpecialRegionEnabled(selectedFeature)) {
      runtimeState.selectedSpecialRegionId = "";
    }
  }
}

function finalizeIndexBuildEffects() {
  runtimeState.devSelectionOverlayDirty = true;
  notifyDevWorkspace();
  runtimeState.hitCanvasDirty = true;
}

function adoptRuntimePoliticalMeta(payload) {
  const featureIds = Array.isArray(payload?.featureIds) ? payload.featureIds : [];
  const featureIndexById = payload?.featureIndexById && typeof payload.featureIndexById === "object"
    ? payload.featureIndexById
    : {};
  const canonicalCountryByFeatureId =
    payload?.canonicalCountryByFeatureId && typeof payload.canonicalCountryByFeatureId === "object"
      ? payload.canonicalCountryByFeatureId
      : {};
  const neighborGraph = Array.isArray(payload?.neighborGraph) ? payload.neighborGraph : [];
  runtimeState.runtimeFeatureIndexById = new Map(Object.entries(featureIndexById));
  runtimeState.runtimeFeatureIds = featureIds.slice();
  runtimeState.runtimeNeighborGraph = neighborGraph.slice();
  runtimeState.runtimeCanonicalCountryByFeatureId = { ...canonicalCountryByFeatureId };
}

function buildRuntimePoliticalMetaFallback() {
  runtimeState.runtimeFeatureIndexById = new Map();
  runtimeState.runtimeFeatureIds = [];
  runtimeState.runtimeNeighborGraph = [];
  runtimeState.runtimeCanonicalCountryByFeatureId = {};

  const objectNames = ["political", "scenario_atlantropa"];
  objectNames.forEach((objectName) => {
    const runtimeObject = runtimeState.runtimePoliticalTopology?.objects?.[objectName] || null;
    const geometries = Array.isArray(runtimeObject?.geometries) ? runtimeObject.geometries : [];
    const neighbors = Array.isArray(runtimeObject?.computed_neighbors) ? runtimeObject.computed_neighbors : [];
    geometries.forEach((geometry, index) => {
      const id = getEntityFeatureId(geometry);
      if (!id) return;
      runtimeState.runtimeFeatureIndexById.set(id, runtimeState.runtimeFeatureIds.length);
      runtimeState.runtimeFeatureIds.push(id);
      runtimeState.runtimeCanonicalCountryByFeatureId[id] = getEntityCountryCode(geometry);
      runtimeState.runtimeNeighborGraph.push(
        objectName === "political" && Array.isArray(neighbors[index])
          ? neighbors[index]
          : []
      );
    });
  });
}

function collectRuntimePoliticalTopologyFeatureIds() {
  const runtimeObjects = runtimeState.runtimePoliticalTopology?.objects || {};
  return ["political", "scenario_atlantropa"].flatMap((objectName) => {
    const geometries = runtimeObjects?.[objectName]?.geometries;
    if (!Array.isArray(geometries)) return [];
    return geometries.map((geometry) => getEntityFeatureId(geometry)).filter(Boolean);
  });
}

function runtimePoliticalMetaSeedCoversTopology(seed, runtimeFeatureIds) {
  const seedFeatureIds = Array.isArray(seed?.featureIds) ? seed.featureIds : [];
  // Startup bootstrap can carry a political shell while the seed already covers
  // optional layers that arrive later through detail chunks.
  if (!runtimeFeatureIds.length) return seedFeatureIds.length === 0;
  if (seedFeatureIds.length < runtimeFeatureIds.length) return false;
  const seedFeatureIdSet = new Set(seedFeatureIds);
  return runtimeFeatureIds.every((featureId) => seedFeatureIdSet.has(featureId));
}

function buildRuntimePoliticalMeta() {
  const seed = runtimeState.runtimePoliticalMetaSeed;
  const runtimeFeatureIds = collectRuntimePoliticalTopologyFeatureIds();
  const seedMatches = runtimePoliticalMetaSeedCoversTopology(seed, runtimeFeatureIds);
  if (seedMatches) {
    adoptRuntimePoliticalMeta(seed);
    runtimeState.runtimePoliticalMetaReadyFromWorker = true;
    runtimeState.runtimePoliticalMetaSeed = null;
    return;
  }
  buildRuntimePoliticalMetaFallback();
  runtimeState.runtimePoliticalMetaReadyFromWorker = false;
  runtimeState.runtimePoliticalMetaSeed = null;
}

function scheduleSecondarySpatialIndexBuild({
  timeout = 320,
  reason = "deferred-secondary-spatial",
} = {}) {
  const normalizedReason = String(reason || "deferred-secondary-spatial").trim() || "deferred-secondary-spatial";
  const hadPendingBuild = secondarySpatialBuildHandle !== null && secondarySpatialBuildHandle !== undefined;
  pendingSecondarySpatialBuildReasons.add(normalizedReason);
  if (!hadPendingBuild) {
    incrementPerfCounter("interactionSecondaryIndexDemandCount");
    recordRenderPerfMetric("interactionSecondaryIndexDemandCount", 0, {
      reason: normalizedReason,
      pendingReasonCount: pendingSecondarySpatialBuildReasons.size,
    });
  }
  cancelDeferredWork(secondarySpatialBuildHandle);
  secondarySpatialBuildHandle = scheduleDeferredWork(() => {
    secondarySpatialBuildHandle = null;
    if (!isInteractionRecoverySettled({ quietMs: 800 })) {
      scheduleSecondarySpatialIndexBuild({ timeout, reason: normalizedReason });
      return;
    }
    const taskKey = "secondary-spatial-index";
    if (!beginInteractionRecoveryTask(taskKey)) {
      scheduleSecondarySpatialIndexBuild({ timeout, reason: normalizedReason });
      return;
    }
    const reasons = Array.from(pendingSecondarySpatialBuildReasons);
    pendingSecondarySpatialBuildReasons.clear();
    const startedAt = nowMs();
    try {
      rebuildAuxiliaryRegionIndexes();
      getSpatialIndexRuntimeOwner().resetSecondarySpatialIndexState({
        preserveCurrent: true,
        reason: normalizedReason,
      });
      getSpatialIndexRuntimeOwner().buildSecondarySpatialIndexes({
        allowComputeMissingBounds: true,
      });
      runtimeState.hitCanvasDirty = true;
      scheduleHitCanvasBuildIfNeeded({
        reason: `${normalizedReason}-hit-canvas`,
      });
      recordRenderPerfMetric("buildSecondarySpatialIndex", nowMs() - startedAt, {
        reason: reasons.join(",") || normalizedReason,
        reasons,
        waterItems: runtimeState.waterSpatialItems.length,
        specialItems: runtimeState.specialSpatialItems.length,
      });
      recordInteractionRecoveryTaskMetric(taskKey, nowMs() - startedAt, {
        reason: reasons.join(",") || normalizedReason,
        reasonCount: reasons.length,
        waterItems: runtimeState.waterSpatialItems.length,
        specialItems: runtimeState.specialSpatialItems.length,
        yieldCount: 0,
      });
    } finally {
      endInteractionRecoveryTask(taskKey);
    }
  }, { timeout });
}

function syncScenarioSecondaryRegionIndexes({
  changedLayerKeys = [],
  reason = "scenario-chunk-promotion",
} = {}) {
  const normalizedLayerKeys = new Set(
    (Array.isArray(changedLayerKeys) ? changedLayerKeys : [])
      .map((layerKey) => String(layerKey || "").trim().toLowerCase())
      .filter(Boolean)
  );
  const hasWaterChange = normalizedLayerKeys.has("water") || normalizedLayerKeys.has("scenario_atlantropa");
  const hasSpecialChange = normalizedLayerKeys.has("special");
  if (!hasWaterChange && !hasSpecialChange) {
    return false;
  }
  if (isInteractionRecoveryBlocked()) {
    return false;
  }
  const startedAt = nowMs();
  rebuildAuxiliaryRegionIndexes();
  getSpatialIndexRuntimeOwner().resetSecondarySpatialIndexState({
    preserveCurrent: true,
    reason: reason,
  });
  getSpatialIndexRuntimeOwner().buildSecondarySpatialIndexes({
    allowComputeMissingBounds: true,
  });
  queueIndexUiRefresh({
    renderWaterRegionList: hasWaterChange,
    renderSpecialRegionList: hasSpecialChange,
  });
  runtimeState.hitCanvasDirty = true;
  recordRenderPerfMetric("scenarioChunkSecondaryRegionIndexesSync", nowMs() - startedAt, {
    reason,
    waterItems: runtimeState.waterSpatialItems.length,
    specialItems: runtimeState.specialSpatialItems.length,
    hasWaterChange,
    hasSpecialChange,
  });
  return true;
}

function rebuildRuntimeDerivedState({
  includeRuntimePoliticalMeta = false,
  scheduleUiMode = "immediate",
  buildSpatial = true,
  includeSecondarySpatial = true,
} = {}) {
  if (includeRuntimePoliticalMeta) {
    buildRuntimePoliticalMeta();
  }

  clearProjectedBoundsCache();
  const projectedBoundsCache = ensureProjectedBoundsCache();
  getSpatialIndexRuntimeOwner().rebuildRuntimePrimaryIndex({
    projectedBoundsCache,
  });

  const nextColors = rebuildResolvedColors();
  queueIndexUiRefresh({
    renderCountryList: true,
    renderWaterRegionList: true,
    renderSpecialRegionList: true,
  }, scheduleUiMode);
  finalizeIndexBuildEffects();

  if (buildSpatial) {
    buildSpatialIndex({
      includeSecondary: includeSecondarySpatial,
      allowComputeMissingBounds: false,
    });
  }
  return nextColors;
}

async function buildHitCanvasAfterStartup({ keepReady = false, reason = "startup-deferred-hit-canvas" } = {}) {
  setInteractionInfrastructureState("building-hit-canvas", {
    ready: keepReady ? true : false,
    inFlight: true,
  });
  await yieldToMain();
  recordDeferredFullHitCanvasMetric({
    reason,
    keepReady,
  });
  setInteractionInfrastructureState("hit-canvas-deferred", {
    ready: keepReady ? true : getInteractionInfrastructureStageRank() >= 1,
    inFlight: false,
  });
  await yieldToMain();
}

async function buildBasicInteractionInfrastructureAfterStartup({
  chunked = true,
} = {}) {
  if (getInteractionInfrastructureStageRank() >= 1 && !runtimeState.interactionInfrastructureBuildInFlight) {
    return true;
  }
  if (interactionInfrastructureBasicPromise) {
    return interactionInfrastructureBasicPromise;
  }
  interactionInfrastructureBasicPromise = (async () => {
    setInteractionInfrastructureState("deferred-startup", {
      ready: false,
      inFlight: true,
    });
    try {
      runtimeState.deferHitCanvasBuild = false;
      if (chunked) {
        await buildIndexChunked({ scheduleUiMode: "deferred" });
        await buildSpatialIndexChunked({
          includeSecondary: false,
        });
      } else {
        buildIndex({ scheduleUiMode: "deferred" });
        buildSpatialIndex({
          includeSecondary: false,
        });
      }
      setInteractionInfrastructureState("basic-ready", {
        ready: true,
        inFlight: false,
      });
      return true;
    } catch (error) {
      setInteractionInfrastructureState("error", {
        ready: false,
        inFlight: false,
      });
      throw error;
    } finally {
      interactionInfrastructureBasicPromise = null;
    }
  })();
  return interactionInfrastructureBasicPromise;
}

async function buildFullInteractionInfrastructureAfterStartup({
  chunked = true,
  buildHitCanvas = true,
} = {}) {
  if (getInteractionInfrastructureStageRank() >= 2 && !runtimeState.interactionInfrastructureBuildInFlight) {
    return true;
  }
  if (interactionInfrastructureFullPromise) {
    return interactionInfrastructureFullPromise;
  }
  interactionInfrastructureFullPromise = (async () => {
    await buildBasicInteractionInfrastructureAfterStartup({ chunked });
    setInteractionInfrastructureState("building-spatial", {
      ready: true,
      inFlight: true,
    });
    try {
      const recoveryStartedAt = nowMs();
      let yieldCount = 0;
      while (isInteractionRecoveryBlocked()) {
        yieldCount += 1;
        await yieldToMain();
      }
      ensureSovereigntyState({ force: true });
      yieldCount += 1;
      await yieldToMain();
      rebuildResolvedColors();
      yieldCount += 1;
      await yieldToMain();
      if (chunked) {
        await buildSpatialIndexChunked({
          includeSecondary: false,
          keepReady: true,
        });
      } else {
        buildSpatialIndex({
          includeSecondary: false,
        });
      }
      scheduleSecondarySpatialIndexBuild({
        reason: chunked ? "startup-deferred-secondary-spatial" : "startup-secondary-spatial",
      });
      if (buildHitCanvas) {
        if (chunked) {
          await buildHitCanvasAfterStartup({
            keepReady: true,
            reason: "startup-deferred-hit-canvas",
          });
        } else {
          await buildHitCanvasAfterStartup({
            keepReady: true,
            reason: "startup-hit-canvas",
          });
        }
      } else if (runtimeState.hitCanvasDirty) {
        scheduleHitCanvasBuildIfNeeded({
          reason: chunked ? "startup-deferred-hit-canvas" : "startup-hit-canvas",
        });
      }
      setInteractionInfrastructureState("ready", {
        ready: true,
        inFlight: false,
      });
      recordInteractionRecoveryTaskMetric("post-ready-full-interaction-infra", nowMs() - recoveryStartedAt, {
        chunked: !!chunked,
        buildHitCanvas: !!buildHitCanvas,
        yieldCount,
      }, { benchmarkInteraction: false });
      return true;
    } catch (error) {
      setInteractionInfrastructureState("basic-ready", {
        ready: true,
        inFlight: false,
      });
      throw error;
    } finally {
      interactionInfrastructureFullPromise = null;
    }
  })();
  return interactionInfrastructureFullPromise;
}

async function buildInteractionInfrastructureAfterStartup({
  chunked = true,
  buildHitCanvas = true,
  mode = "full",
} = {}) {
  if (String(mode || "full").trim().toLowerCase() === "basic") {
    return buildBasicInteractionInfrastructureAfterStartup({ chunked });
  }
  return buildFullInteractionInfrastructureAfterStartup({
    chunked,
    buildHitCanvas,
  });
}

function getHitFromEvent(
  event,
  { enableSnap = true, snapPx = HIT_SNAP_RADIUS_PX, eventType = "unknown" } = {}
) {
  if ((!runtimeState.landData || !runtimeState.spatialItems?.length) && !runtimeState.waterSpatialItems?.length && !runtimeState.specialSpatialItems?.length) {
    return createHitResult();
  }
  const pointer = getPointerProjectionPosition(event);
  if (!pointer) return createHitResult();
  const specialHit = getSpecialHitFromPointer(pointer, {
    enableSnap,
    snapPx,
    eventType,
  });
  let resolvedHit = specialHit;
  if (!resolvedHit.id) {
    const landHit = getLandHitFromPointer(event, pointer, {
      enableSnap,
      snapPx,
      eventType,
    });
    const waterHit = getWaterHitFromPointer(pointer, {
      enableSnap,
      snapPx,
      eventType,
    });
    if (
      waterHit.id
      && isScenarioWaterRegion(waterHit.feature)
      && eventType !== "hover"
    ) {
      resolvedHit = waterHit;
    } else if (shouldPreferWaterHit(landHit, waterHit, { eventType })) {
      resolvedHit = waterHit;
    } else if (landHit.id) {
      resolvedHit = landHit;
    } else if (waterHit.id) {
      resolvedHit = waterHit;
    } else {
      resolvedHit = createHitResult();
    }
  }
  recordInteractionHitMetrics(pointer, {
    enableSnap,
    snapPx,
    eventType,
    resolvedHit,
  });
  return resolvedHit;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getProjectedLineDensityStats(line) {
  const sanitized = sanitizePolyline(line);
  if (sanitized.length < 2 || !rendererSurfaceHost.getProjection()) {
    return { pointCount: 0, bboxArea: Infinity, density: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let pointCount = 0;
  sanitized.forEach((point) => {
    const projected = rendererSurfaceHost.getProjection()(point);
    if (!projected || !Number.isFinite(projected[0]) || !Number.isFinite(projected[1])) return;
    pointCount += 1;
    minX = Math.min(minX, projected[0]);
    minY = Math.min(minY, projected[1]);
    maxX = Math.max(maxX, projected[0]);
    maxY = Math.max(maxY, projected[1]);
  });
  if (!(pointCount > 1)) {
    return { pointCount, bboxArea: Infinity, density: 0 };
  }
  const bboxArea = Math.max(1, (maxX - minX) * (maxY - minY));
  return {
    pointCount,
    bboxArea,
    density: pointCount / bboxArea,
  };
}

function drawHierarchicalBorders(k, { interactive = false } = {}) {
  // 入口负责编排边界绘制阶段与参数，笔触/采样等细节由 owner 实现。
  return getBorderDrawOwner().drawHierarchicalBorders(k, { interactive });
}

function normalizeOceanPreset(value) {
  const candidate = String(value || "flat").trim().toLowerCase();
  if (
    candidate === "flat" ||
    candidate === "bathymetry_soft" ||
    candidate === "bathymetry_contours"
  ) {
    return candidate;
  }
  return "flat";
}

function getBathymetryPresetProfile(preset = "flat") {
  return BATHYMETRY_PRESET_PROFILES[normalizeOceanPreset(preset)] || null;
}

function getBathymetryPresetStyleDefaults(preset = "flat") {
  const profile = getBathymetryPresetProfile(preset);
  if (!profile) return null;
  return {
    opacity: profile.defaultOpacity,
    scale: profile.defaultScale,
    contourStrength: profile.defaultContourStrength,
  };
}

function getOceanStyleConfig() {
  const ocean = runtimeState.styleConfig?.ocean || {};
  const preset = normalizeOceanPreset(ocean.preset);
  return {
    preset,
    opacity: clamp(Number.isFinite(Number(ocean.opacity)) ? Number(ocean.opacity) : 0.82, 0, 1),
    scale: clamp(Number.isFinite(Number(ocean.scale)) ? Number(ocean.scale) : 1.14, 0.6, 2.4),
    contourStrength: clamp(
      Number.isFinite(Number(ocean.contourStrength)) ? Number(ocean.contourStrength) : 0.34,
      0,
      1
    ),
    bathymetryProfile: getBathymetryPresetProfile(preset),
    experimentalAdvancedStyles: ocean.experimentalAdvancedStyles === true,
    coastalAccentEnabled: isScenarioCoastalAccentEnabled(),
  };
}

function getOceanBaseFillColor() {
  return getSafeCanvasColor(runtimeState.styleConfig?.ocean?.fillColor, OCEAN_FILL_COLOR) || OCEAN_FILL_COLOR;
}

function getLakeStyleConfig() {
  runtimeState.styleConfig = runtimeState.styleConfig && typeof runtimeState.styleConfig === "object" ? runtimeState.styleConfig : {};
  runtimeState.styleConfig.lakes = normalizeLakeStyleConfig(runtimeState.styleConfig.lakes);
  return runtimeState.styleConfig.lakes;
}

function getLakeBaseFillColor() {
  const lakeStyle = getLakeStyleConfig();
  if (lakeStyle.linkedToOcean) {
    return getOceanBaseFillColor();
  }
  return getSafeCanvasColor(lakeStyle.fillColor, getOceanBaseFillColor()) || getOceanBaseFillColor();
}

function getUnifiedWaterBaseStyle(feature) {
  const waterType = getWaterRegionType(feature);
  return {
    fill: isAtlantropaSeaFeature(feature)
      ? getAtlantropaSeaPoliticalFillColor()
      : (waterType === "lake" ? getLakeBaseFillColor() : getOceanBaseFillColor()),
    stroke: UNIFIED_WATER_STROKE_COLOR,
    opacity: UNIFIED_WATER_FILL_OPACITY,
  };
}

function getWaterRegionDefaultFillColorById(id) {
  return getWaterRegionDefaultStyle(runtimeState.waterRegionsById?.get(String(id || "").trim())).fill;
}

function getPathBounds(shape) {
  if (!rendererSurfaceHost.getPathCanvas() || !shape) return null;
  try {
    const bounds = rendererSurfaceHost.getPathCanvas().bounds(shape);
    if (!bounds || bounds.length !== 2) return null;
    const minX = bounds[0][0];
    const minY = bounds[0][1];
    const maxX = bounds[1][0];
    const maxY = bounds[1][1];
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
    if (maxX <= minX || maxY <= minY) return null;
    return { minX, minY, maxX, maxY };
  } catch (error) {
    return null;
  }
}

function getBoundsArea(bounds) {
  if (!bounds) return 0;
  return Math.max(0, bounds.maxX - bounds.minX) * Math.max(0, bounds.maxY - bounds.minY);
}

function doesOceanStyleRequireBathymetry(oceanStyle = getOceanStyleConfig()) {
  return !!(
    oceanStyle?.experimentalAdvancedStyles
    && String(oceanStyle?.preset || "flat").trim().toLowerCase() !== "flat"
  );
}

function clearBathymetryStateSlot(slot) {
  if (slot === "scenario") {
    runtimeState.scenarioBathymetryTopologyData = null;
    runtimeState.scenarioBathymetryBandsData = null;
    runtimeState.scenarioBathymetryContoursData = null;
    runtimeState.scenarioBathymetryTopologyUrl = "";
    return;
  }
  runtimeState.globalBathymetryTopologyData = null;
  runtimeState.globalBathymetryBandsData = null;
  runtimeState.globalBathymetryContoursData = null;
  runtimeState.globalBathymetryTopologyUrl = "";
}

function disableActiveBathymetryState() {
  runtimeState.activeBathymetryBandsData = null;
  runtimeState.activeBathymetryContoursData = null;
  runtimeState.activeBathymetrySource = "none";
  runtimeState.activeBathymetryTopologyUrl = "";
}

function setBathymetryStateSlot(slot, url, entry) {
  if (slot === "scenario") {
    runtimeState.scenarioBathymetryTopologyData = entry?.topology || null;
    runtimeState.scenarioBathymetryBandsData = entry?.bands || null;
    runtimeState.scenarioBathymetryContoursData = entry?.contours || null;
    runtimeState.scenarioBathymetryTopologyUrl = String(url || "");
    return;
  }
  runtimeState.globalBathymetryTopologyData = entry?.topology || null;
  runtimeState.globalBathymetryBandsData = entry?.bands || null;
  runtimeState.globalBathymetryContoursData = entry?.contours || null;
  runtimeState.globalBathymetryTopologyUrl = String(url || "");
}

function cloneBathymetryFeatureWithSource(feature, source) {
  if (!feature || typeof feature !== "object") return null;
  return {
    ...feature,
    properties: {
      ...(feature.properties || {}),
      _bathymetrySource: source,
    },
  };
}

function buildBathymetryFeatureCollection(features) {
  const nextFeatures = Array.isArray(features) ? features.filter(Boolean) : [];
  if (!nextFeatures.length) return null;
  return {
    type: "FeatureCollection",
    features: nextFeatures,
  };
}

function mergeBathymetryFeatureCollections(scenarioCollection, globalCollection) {
  const scenarioFeatures = Array.isArray(scenarioCollection?.features)
    ? scenarioCollection.features.map((feature) => cloneBathymetryFeatureWithSource(feature, "scenario"))
    : [];
  const globalFeatures = Array.isArray(globalCollection?.features)
    ? globalCollection.features.map((feature) => cloneBathymetryFeatureWithSource(feature, "global"))
    : [];
  return buildBathymetryFeatureCollection([...scenarioFeatures, ...globalFeatures]);
}

function syncActiveBathymetryState() {
  const scenarioUrl = getScenarioBathymetryTopologyUrl();
  const globalUrl = getDesiredBathymetryTopologyUrl("global");
  const scenarioReady =
    !!runtimeState.activeScenarioId &&
    !!scenarioUrl &&
    runtimeState.scenarioBathymetryTopologyUrl === scenarioUrl &&
    (!!runtimeState.scenarioBathymetryBandsData || !!runtimeState.scenarioBathymetryContoursData);
  const globalReady =
    !!globalUrl &&
    runtimeState.globalBathymetryTopologyUrl === globalUrl &&
    (!!runtimeState.globalBathymetryBandsData || !!runtimeState.globalBathymetryContoursData);

  if (scenarioReady && globalReady) {
    runtimeState.activeBathymetryBandsData = mergeBathymetryFeatureCollections(
      runtimeState.scenarioBathymetryBandsData,
      runtimeState.globalBathymetryBandsData
    );
    runtimeState.activeBathymetryContoursData = mergeBathymetryFeatureCollections(
      runtimeState.scenarioBathymetryContoursData,
      runtimeState.globalBathymetryContoursData
    );
    runtimeState.activeBathymetrySource = "merged";
    runtimeState.activeBathymetryTopologyUrl = `${scenarioUrl}|${globalUrl}`;
    return;
  }
  if (scenarioReady) {
    runtimeState.activeBathymetryBandsData = mergeBathymetryFeatureCollections(runtimeState.scenarioBathymetryBandsData, null);
    runtimeState.activeBathymetryContoursData = mergeBathymetryFeatureCollections(runtimeState.scenarioBathymetryContoursData, null);
    runtimeState.activeBathymetrySource = "scenario";
    runtimeState.activeBathymetryTopologyUrl = scenarioUrl;
    return;
  }
  if (globalReady) {
    runtimeState.activeBathymetryBandsData = mergeBathymetryFeatureCollections(null, runtimeState.globalBathymetryBandsData);
    runtimeState.activeBathymetryContoursData = mergeBathymetryFeatureCollections(null, runtimeState.globalBathymetryContoursData);
    runtimeState.activeBathymetrySource = "global";
    runtimeState.activeBathymetryTopologyUrl = globalUrl;
    return;
  }
  runtimeState.activeBathymetryBandsData = null;
  runtimeState.activeBathymetryContoursData = null;
  runtimeState.activeBathymetrySource = "none";
  runtimeState.activeBathymetryTopologyUrl = "";
}

function getCachedBathymetryEntry(url) {
  if (!url) return null;
  const entry = bathymetryTopologyCacheByUrl.get(url);
  return entry && typeof entry === "object" ? entry : null;
}

function normalizeBathymetryTopologyEntry(url, topology) {
  if (!topology || typeof topology !== "object") {
    return null;
  }
  const bands = getLayerFeatureCollection(topology, BATHYMETRY_BANDS_OBJECT_NAME);
  const contours = getLayerFeatureCollection(topology, BATHYMETRY_CONTOURS_OBJECT_NAME);
  if (!Array.isArray(bands?.features) && !Array.isArray(contours?.features)) {
    return null;
  }
  return {
    url,
    topology,
    bands: Array.isArray(bands?.features) ? bands : null,
    contours: Array.isArray(contours?.features) ? contours : null,
  };
}

function warnBathymetryLoadFailureOnce(url, error) {
  if (!url) return;
  const previousFailureAt = Number(bathymetryLoadFailureByUrl.get(url) || 0);
  const now = Date.now();
  bathymetryLoadFailureByUrl.set(url, now);
  if (previousFailureAt && now - previousFailureAt < BATHYMETRY_LOAD_RETRY_COOLDOWN_MS) return;
  const message = error instanceof Error ? error.message : String(error || "Unknown error");
  console.warn(`[bathymetry] Failed to load ${url}: ${message}`);
}

function applyResolvedBathymetryEntry(slot, url, entry) {
  if (!url || getDesiredBathymetryTopologyUrl(slot) !== url) {
    return false;
  }
  setBathymetryStateSlot(slot, url, entry);
  syncActiveBathymetryState();
  return true;
}

async function loadBathymetryTopology(url, { slot = "global" } = {}) {
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl || !getRendererAssetUrlPolicyOwner().isDesiredBathymetryUrl(slot, normalizedUrl)) {
    return null;
  }
  const response = await fetch(normalizedUrl, { cache: "default" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const payload = await response.json();
  const entry = normalizeBathymetryTopologyEntry(normalizedUrl, payload);
  if (!entry) {
    throw new Error("Missing bathymetry_bands / bathymetry_contours objects");
  }
  bathymetryTopologyCacheByUrl.set(normalizedUrl, entry);
  applyResolvedBathymetryEntry(slot, normalizedUrl, entry);
  invalidateOceanVisualState(`bathymetry-loaded:${slot}`);
  if (rendererSurfaceHost.getContext()) {
    render();
  }
  return entry;
}

function scheduleBathymetryTopologyLoad(url, { slot = "global" } = {}) {
  if (!url) {
    clearBathymetryStateSlot(slot);
    syncActiveBathymetryState();
    return;
  }
  const cached = getCachedBathymetryEntry(url);
  if (cached) {
    applyResolvedBathymetryEntry(slot, url, cached);
    return;
  }
  const previousFailureAt = Number(bathymetryLoadFailureByUrl.get(url) || 0);
  if (
    bathymetryLoadPromiseByUrl.has(url)
    || (previousFailureAt && Date.now() - previousFailureAt < BATHYMETRY_LOAD_RETRY_COOLDOWN_MS)
  ) {
    return;
  }
  const loadPromise = loadBathymetryTopology(url, { slot })
    .catch((error) => {
      warnBathymetryLoadFailureOnce(url, error);
      if (getDesiredBathymetryTopologyUrl(slot) === url) {
        clearBathymetryStateSlot(slot);
        syncActiveBathymetryState();
      }
      return null;
    })
    .finally(() => {
      bathymetryLoadPromiseByUrl.delete(url);
    });
  bathymetryLoadPromiseByUrl.set(url, loadPromise);
}

function ensureBathymetryDataAvailability({ required = doesOceanStyleRequireBathymetry() } = {}) {
  if (!required) {
    disableActiveBathymetryState();
    return false;
  }
  const globalUrl = getDesiredBathymetryTopologyUrl("global");
  if (globalUrl) {
    scheduleBathymetryTopologyLoad(globalUrl, { slot: "global" });
  } else {
    clearBathymetryStateSlot("global");
  }
  const scenarioUrl = getScenarioBathymetryTopologyUrl();
  if (runtimeState.activeScenarioId && scenarioUrl) {
    scheduleBathymetryTopologyLoad(scenarioUrl, { slot: "scenario" });
  } else {
    clearBathymetryStateSlot("scenario");
  }
  syncActiveBathymetryState();
  return true;
}

function getBathymetryFeatureCollections() {
  return {
    bands: Array.isArray(runtimeState.activeBathymetryBandsData?.features) ? runtimeState.activeBathymetryBandsData : null,
    contours: Array.isArray(runtimeState.activeBathymetryContoursData?.features) ? runtimeState.activeBathymetryContoursData : null,
    scenarioCoverage: Array.isArray(runtimeState.scenarioBathymetryBandsData?.features) ? runtimeState.scenarioBathymetryBandsData : null,
  };
}

function getBathymetryFeatureDepthMax(feature) {
  const rawValue = Number(
    feature?.properties?.depth_max_m ??
    feature?.properties?.depth_m ??
    feature?.properties?.max_depth_m ??
    0
  );
  return Number.isFinite(rawValue) ? Math.max(0, Math.abs(rawValue)) : 0;
}

function interpolateRgbChannels(startRgb, endRgb, ratio) {
  const tRatio = clamp(Number(ratio) || 0, 0, 1);
  return {
    r: Math.round(startRgb.r + (endRgb.r - startRgb.r) * tRatio),
    g: Math.round(startRgb.g + (endRgb.g - startRgb.g) * tRatio),
    b: Math.round(startRgb.b + (endRgb.b - startRgb.b) * tRatio),
  };
}

function getBathymetryBaseRgb() {
  const oceanChannels = parseCanvasColorChannels(getOceanBaseFillColor());
  if (oceanChannels) {
    return {
      r: oceanChannels.r,
      g: oceanChannels.g,
      b: oceanChannels.b,
    };
  }
  return { r: 170, g: 218, b: 255 };
}

function isAtlantropaBathymetryFeature(feature) {
  return String(feature?.properties?.region_group || "").trim().toLowerCase().startsWith("atlantropa_");
}

function getBathymetryVisualModifiers(feature) {
  const source = String(feature?.properties?._bathymetrySource || "").trim().toLowerCase();
  const mode = String(feature?.properties?.bathymetry_mode || "").trim().toLowerCase();
  const depthMax = getBathymetryFeatureDepthMax(feature);
  if (source !== "scenario" || !isAtlantropaBathymetryFeature(feature)) {
    return {
      bandBrightness: 1,
      bandAlpha: 1,
      contourBrightness: 1,
      contourAlpha: 1,
    };
  }

  if (mode === "synthetic") {
    const shallowScale = depthMax <= 150 ? 0.92 : 1;
    return {
      bandBrightness: 0.7 * shallowScale,
      bandAlpha: 0.62 * shallowScale,
      contourBrightness: 0.64 * shallowScale,
      contourAlpha: 0.56 * shallowScale,
    };
  }

  const shallowScale = depthMax <= 150 ? 0.95 : 1;
  return {
    bandBrightness: 0.88 * shallowScale,
    bandAlpha: 0.8 * shallowScale,
    contourBrightness: 0.86 * shallowScale,
    contourAlpha: 0.8 * shallowScale,
  };
}

function getBathymetryBandFillStyle(feature, oceanStyle) {
  const profile = oceanStyle.bathymetryProfile || getBathymetryPresetProfile(oceanStyle.preset);
  const baseRgb = getBathymetryBaseRgb();
  const shallowRgb = interpolateRgbChannels(baseRgb, { r: 226, g: 242, b: 255 }, 0.88);
  const deepRgb = interpolateRgbChannels(baseRgb, { r: 12, g: 47, b: 86 }, 0.78);
  const depthRatioRaw = getBathymetryFeatureDepthMax(feature) / BATHYMETRY_MAX_REFERENCE_DEPTH_M;
  const scaledDepthRatio = clamp(
    Math.pow(clamp(depthRatioRaw, 0, 1), 1 / Math.max(0.45, oceanStyle.scale)),
    0,
    1
  );
  const visualModifiers = getBathymetryVisualModifiers(feature);
  const fillRgb = interpolateRgbChannels(
    baseRgb,
    interpolateRgbChannels(shallowRgb, deepRgb, scaledDepthRatio),
    visualModifiers.bandBrightness
  );
  const alphaBase = profile?.bandAlphaBase ?? 0.42;
  const alpha = clamp(
    oceanStyle.opacity
      * (alphaBase + scaledDepthRatio * 0.2 + (1 - scaledDepthRatio) * 0.1 + oceanStyle.contourStrength * 0.1)
      * visualModifiers.bandAlpha,
    0,
    0.96
  );
  return toRgbaString(fillRgb, alpha);
}

function getBathymetryContourStrokeStyle(feature, oceanStyle) {
  const profile = oceanStyle.bathymetryProfile || getBathymetryPresetProfile(oceanStyle.preset);
  const baseRgb = getBathymetryBaseRgb();
  const depthRatioRaw = getBathymetryFeatureDepthMax(feature) / BATHYMETRY_MAX_REFERENCE_DEPTH_M;
  const scaledDepthRatio = clamp(depthRatioRaw, 0, 1);
  const visualModifiers = getBathymetryVisualModifiers(feature);
  const strokeRgb = interpolateRgbChannels(
    baseRgb,
    interpolateRgbChannels(
      { r: 204, g: 228, b: 246 },
      { r: 58, g: 101, b: 144 },
      scaledDepthRatio
    ),
    visualModifiers.contourBrightness
  );
  const alphaBase = profile?.contourAlphaBase ?? 0.28;
  const alpha = clamp(
    oceanStyle.opacity
      * (alphaBase + oceanStyle.contourStrength * 0.46 + scaledDepthRatio * 0.08)
      * visualModifiers.contourAlpha,
    0,
    0.92
  );
  return toRgbaString(strokeRgb, alpha);
}

function sortBathymetryFeaturesForFill(collection) {
  if (!Array.isArray(collection?.features)) return [];
  return [...collection.features].sort((a, b) => getBathymetryFeatureDepthMax(b) - getBathymetryFeatureDepthMax(a));
}

function getBathymetryTuningConfig() {
  const ocean = runtimeState.styleConfig?.ocean || {};
  const shallowBandFadeEndZoom = clamp(
    Number.isFinite(Number(ocean.shallowBandFadeEndZoom)) ? Number(ocean.shallowBandFadeEndZoom) : BATHYMETRY_BAND_SHALLOW_FADE_END_ZOOM,
    BATHYMETRY_BAND_SHALLOW_FADE_START_ZOOM + 0.1,
    4.8
  );
  const midBandFadeEndZoom = clamp(
    Number.isFinite(Number(ocean.midBandFadeEndZoom)) ? Number(ocean.midBandFadeEndZoom) : BATHYMETRY_BAND_MID_FADE_END_ZOOM,
    BATHYMETRY_BAND_MID_FADE_START_ZOOM + 0.1,
    5.2
  );
  const deepBandFadeEndZoom = clamp(
    Number.isFinite(Number(ocean.deepBandFadeEndZoom)) ? Number(ocean.deepBandFadeEndZoom) : BATHYMETRY_BAND_DEEP_FADE_END_ZOOM,
    BATHYMETRY_BAND_DEEP_FADE_START_ZOOM + 0.1,
    6
  );
  const scenarioSyntheticContourFadeEndZoom = clamp(
    Number.isFinite(Number(ocean.scenarioSyntheticContourFadeEndZoom))
      ? Number(ocean.scenarioSyntheticContourFadeEndZoom)
      : BATHYMETRY_SCENARIO_SYNTHETIC_CONTOUR_FADE_END_ZOOM,
    BATHYMETRY_SCENARIO_SYNTHETIC_CONTOUR_FADE_START_ZOOM + 0.1,
    4.6
  );
  const scenarioShallowContourFadeEndZoom = clamp(
    Number.isFinite(Number(ocean.scenarioShallowContourFadeEndZoom))
      ? Number(ocean.scenarioShallowContourFadeEndZoom)
      : BATHYMETRY_SCENARIO_SHALLOW_CONTOUR_FADE_END_ZOOM,
    BATHYMETRY_SCENARIO_SHALLOW_CONTOUR_FADE_START_ZOOM + 0.1,
    5
  );
  return {
    shallowBandFadeEndZoom,
    midBandFadeEndZoom,
    deepBandFadeEndZoom,
    scenarioSyntheticContourFadeEndZoom,
    scenarioShallowContourFadeEndZoom,
  };
}

function getZoomFadeFactor(k, fadeStartZoom, fadeEndZoom) {
  if (!(k >= fadeStartZoom)) {
    return 1;
  }
  if (k >= fadeEndZoom) {
    return 0;
  }
  return clamp(
    1 - (k - fadeStartZoom) / Math.max(0.0001, fadeEndZoom - fadeStartZoom),
    0,
    1
  );
}

function getBathymetryBandVisibilityConfig(feature, k) {
  const tuning = getBathymetryTuningConfig();
  const depthMax = getBathymetryFeatureDepthMax(feature);
  if (depthMax <= BATHYMETRY_SHALLOW_DEPTH_MAX_M) {
    return { alpha: getZoomFadeFactor(k, BATHYMETRY_BAND_SHALLOW_FADE_START_ZOOM, tuning.shallowBandFadeEndZoom) };
  }
  if (depthMax <= BATHYMETRY_MID_DEPTH_MAX_M) {
    return { alpha: getZoomFadeFactor(k, BATHYMETRY_BAND_MID_FADE_START_ZOOM, tuning.midBandFadeEndZoom) };
  }
  return { alpha: getZoomFadeFactor(k, BATHYMETRY_BAND_DEEP_FADE_START_ZOOM, tuning.deepBandFadeEndZoom) };
}

function drawBathymetryBands(collection, oceanStyle) {
  return getOceanRenderOwner().drawBathymetryBands(collection, oceanStyle);
}

function buildVisibleBathymetryContourDepthSet(collection, oceanStyle) {
  return getOceanRenderOwner().buildVisibleBathymetryContourDepthSet(collection, oceanStyle);
}

function getBathymetryContourVisibilityConfig(feature, k) {
  const tuning = getBathymetryTuningConfig();
  const source = String(feature?.properties?._bathymetrySource || "").trim().toLowerCase();
  if (source !== "scenario") {
    return { alpha: 1 };
  }
  const mode = String(feature?.properties?.bathymetry_mode || "").trim().toLowerCase();
  if (mode === "synthetic") {
    return {
      alpha: getZoomFadeFactor(
        k,
        BATHYMETRY_SCENARIO_SYNTHETIC_CONTOUR_FADE_START_ZOOM,
        tuning.scenarioSyntheticContourFadeEndZoom
      ),
    };
  }
  if (getBathymetryFeatureDepthMax(feature) <= BATHYMETRY_SHALLOW_DEPTH_MAX_M) {
    return {
      alpha: getZoomFadeFactor(
        k,
        BATHYMETRY_SCENARIO_SHALLOW_CONTOUR_FADE_START_ZOOM,
        tuning.scenarioShallowContourFadeEndZoom
      ),
    };
  }
  return { alpha: 1 };
}

function drawBathymetryContours(collection, oceanStyle) {
  return getOceanRenderOwner().drawBathymetryContours(collection, oceanStyle);
}

function getBathymetryCollectionBySource(collection, source) {
  if (!Array.isArray(collection?.features)) return null;
  return buildBathymetryFeatureCollection(
    collection.features.filter((feature) => String(feature?.properties?._bathymetrySource || "") === source)
  );
}

function getCoastlineCollectionForZoom(k) {
  if (k < COASTLINE_LOD_LOW_ZOOM_MAX) {
    return runtimeState.cachedCoastlinesLow?.length ? runtimeState.cachedCoastlinesLow : runtimeState.cachedCoastlines;
  }
  if (k < COASTLINE_LOD_MID_ZOOM_MAX) {
    return runtimeState.cachedCoastlinesMid?.length ? runtimeState.cachedCoastlinesMid : runtimeState.cachedCoastlines;
  }
  return runtimeState.cachedCoastlinesHigh?.length ? runtimeState.cachedCoastlinesHigh : runtimeState.cachedCoastlines;
}

function getScenarioCoastalAccentLineWidth(k, { interactive = false, overlay = false } = {}) {
  const baseWidth = overlay
    ? 1.22 / Math.max(0.0001, k)
    : (interactive ? 1.05 : 1.28) / Math.max(0.0001, k);
  if (k < COASTLINE_LOD_MID_ZOOM_MAX) {
    return baseWidth;
  }
  return Math.max(baseWidth, overlay ? COASTLINE_ACCENT_OVERLAY_MIN_WIDTH_PX : COASTLINE_ACCENT_MIN_WIDTH_PX);
}

function isAtlantropaScenarioShorelineOverlay(feature) {
  if (getReliefOverlayKind(feature) !== "new_shoreline") return false;
  return String(feature?.properties?.parent_id || "").trim().toLowerCase().startsWith("atlantropa_");
}

function getFeatureProjectedDensity(feature) {
  const geometry = feature?.geometry;
  if (!geometry) return 0;
  const lines = geometry.type === "LineString"
    ? [geometry.coordinates]
    : geometry.type === "MultiLineString"
      ? geometry.coordinates
      : [];
  let maxDensity = 0;
  lines.forEach((line) => {
    const density = getProjectedLineDensityStats(line).density;
    if (density > maxDensity) {
      maxDensity = density;
    }
  });
  return maxDensity;
}

function buildCoastalAccentStrokeBuckets(entries) {
  return getOceanRenderOwner().buildCoastalAccentStrokeBuckets(entries);
}

function drawCoastalAccentStrokeBuckets(entries, { clipAtlantropa = false } = {}) {
  return getOceanRenderOwner().drawCoastalAccentStrokeBuckets(entries, { clipAtlantropa });
}

function getScenarioCoastalAccentOverlayVisualConfig(feature, k, { interactive = false } = {}) {
  const isAtlantropa = isAtlantropaScenarioShorelineOverlay(feature);
  let alpha = interactive ? 0.38 : 0.62;
  if (isAtlantropa) {
    alpha = interactive
      ? COASTLINE_OVERLAY_ATLANTROPA_ALPHA_INTERACTIVE
      : COASTLINE_OVERLAY_ATLANTROPA_ALPHA;
    if (k < COASTLINE_LOD_MID_ZOOM_MAX) {
      const densityThreshold = k < COASTLINE_LOD_LOW_ZOOM_MAX
        ? COASTLINE_ACCENT_DENSITY_THRESHOLD_LOW
        : COASTLINE_ACCENT_DENSITY_THRESHOLD_MID;
      const densityAlpha = k < COASTLINE_LOD_LOW_ZOOM_MAX
        ? COASTLINE_OVERLAY_DENSITY_ALPHA_LOW
        : COASTLINE_OVERLAY_DENSITY_ALPHA_MID;
      if (getFeatureProjectedDensity(feature) > densityThreshold) {
        alpha *= densityAlpha;
      }
    }
  }
  return {
    alpha,
    lineWidth: getScenarioCoastalAccentLineWidth(k, { interactive, overlay: true }),
  };
}

function clipOutAtlantropaAccentRegions() {
  const suppressionFeatures = getAtlantropaAccentSuppressionFeatures();
  if (!suppressionFeatures.length || !rendererSurfaceHost.getContext()) return false;
  const canvasWidth = Number(runtimeState.width) || rendererSurfaceHost.getContext().canvas?.width || 0;
  const canvasHeight = Number(runtimeState.height) || rendererSurfaceHost.getContext().canvas?.height || 0;
  if (!(canvasWidth > 0) || !(canvasHeight > 0)) return false;
  rendererSurfaceHost.getContext().beginPath();
  rendererSurfaceHost.getContext().rect(0, 0, canvasWidth, canvasHeight);
  suppressionFeatures.forEach((feature) => {
    if (!feature?.geometry) return;
    rendererSurfaceHost.getPathCanvas()(feature);
  });
  try {
    rendererSurfaceHost.getContext().clip("evenodd");
    return true;
  } catch (_) {
    return false;
  }
}

function drawScenarioCoastalAccentOverlays(k, { interactive = false } = {}) {
  return getOceanRenderOwner().drawScenarioCoastalAccentOverlays(k, { interactive });
}

function drawScenarioCoastalAccentLayer(k, { interactive = false } = {}) {
  return getOceanRenderOwner().drawScenarioCoastalAccentLayer(k, { interactive });
}

function resolveOceanMask() {
  let mode = OCEAN_MASK_MODE_SPHERE_MINUS_LAND;
  let quality = 0;

  const sphereBounds = getPathBounds({ type: "Sphere" });
  const sphereArea = getBoundsArea(sphereBounds);

  if (runtimeState.oceanData) {
    const oceanBounds = getPathBounds(runtimeState.oceanData);
    const oceanArea = getBoundsArea(oceanBounds);
    if (sphereArea > 0 && oceanArea > 0) {
      quality = clamp(oceanArea / sphereArea, 0, 1);
    } else if (oceanArea > 0) {
      quality = 1;
    }
  }

  if (runtimeState.oceanData && quality >= OCEAN_MASK_MIN_QUALITY) {
    mode = OCEAN_MASK_MODE_TOPOLOGY;
  }

  runtimeState.oceanMaskMode = mode;
  runtimeState.oceanMaskQuality = quality;
  return { mode, quality };
}

function applyOceanClipMask(maskMode) {
  const startedAt = nowMs();
  rendererSurfaceHost.getContext().beginPath();
  if (maskMode === OCEAN_MASK_MODE_TOPOLOGY && runtimeState.oceanData) {
    rendererSurfaceHost.getPathCanvas()(runtimeState.oceanData);
    rendererSurfaceHost.getContext().clip();
    recordRenderPerfMetric("applyOceanClipMask", nowMs() - startedAt, {
      applied: true,
      maskMode,
      maskSource: "oceanData",
      maskFeatureCount: getFeatureCollectionFeatureCount(runtimeState.oceanData),
      maskArcRefEstimate: estimateTopologyObjectArcRefs(runtimeState.topologyPrimary || runtimeState.topology, "ocean"),
    });
    return;
  }

  rendererSurfaceHost.getPathCanvas()({ type: "Sphere" });
  const maskInfo = getPhysicalLandMaskInfo();
  const landMask = maskInfo.collection;

  if (landMask) {
    rendererSurfaceHost.getPathCanvas()(landMask);
    try {
      rendererSurfaceHost.getContext().clip("evenodd");
    } catch (error) {
      rendererSurfaceHost.getContext().clip();
    }
    recordRenderPerfMetric("applyOceanClipMask", nowMs() - startedAt, {
      applied: true,
      maskMode,
      maskSource: maskInfo.maskSource,
      maskFeatureCount: maskInfo.maskFeatureCount,
      maskArcRefEstimate: maskInfo.maskArcRefEstimate,
    });
    return;
  }

  if (runtimeState.oceanData) {
    rendererSurfaceHost.getContext().beginPath();
    rendererSurfaceHost.getPathCanvas()(runtimeState.oceanData);
    rendererSurfaceHost.getContext().clip();
    recordRenderPerfMetric("applyOceanClipMask", nowMs() - startedAt, {
      applied: true,
      maskMode,
      maskSource: "oceanDataWithoutUsableLandMask",
      maskFeatureCount: getFeatureCollectionFeatureCount(runtimeState.oceanData),
      maskArcRefEstimate: estimateTopologyObjectArcRefs(runtimeState.topologyPrimary || runtimeState.topology, "ocean"),
      rejectedMaskToken: maskInfo.maskQualityToken || "",
    });
    return;
  }

  rendererSurfaceHost.getContext().clip();
  recordRenderPerfMetric("applyOceanClipMask", nowMs() - startedAt, {
    applied: true,
    maskMode,
    maskSource: "sphere-only",
    maskFeatureCount: 0,
    maskArcRefEstimate: null,
  });
}

function applyBathymetryCoverageExclusionMask(coverageCollection) {
  if (!Array.isArray(coverageCollection?.features) || !coverageCollection.features.length) return;
  rendererSurfaceHost.getContext().beginPath();
  rendererSurfaceHost.getPathCanvas()({ type: "Sphere" });
  rendererSurfaceHost.getPathCanvas()(coverageCollection);
  try {
    rendererSurfaceHost.getContext().clip("evenodd");
  } catch (error) {
    rendererSurfaceHost.getContext().clip();
  }
}

function drawOceanStyle() {
  return getOceanRenderOwner().drawOceanStyle();
}

const VALID_BLEND_MODES = new Set([
  "source-over",
  "source-in",
  "source-out",
  "source-atop",
  "destination-over",
  "destination-in",
  "destination-out",
  "destination-atop",
  "lighter",
  "copy",
  "xor",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
]);

function getSafeBlendMode(value, fallback = "source-over") {
  const normalizedFallback = String(fallback || "source-over").trim().toLowerCase();
  const safeFallback = VALID_BLEND_MODES.has(normalizedFallback) ? normalizedFallback : "source-over";
  const mode = String(value || "").trim().toLowerCase();
  return VALID_BLEND_MODES.has(mode) ? mode : safeFallback;
}

function getDashPattern(styleName, baseWidth = 1) {
  const style = String(styleName || "solid").trim().toLowerCase();
  if (style === "dashed") {
    return [Math.max(2, baseWidth * 4), Math.max(2, baseWidth * 2.4)];
  }
  if (style === "dotted") {
    return [Math.max(1, baseWidth * 1.2), Math.max(2, baseWidth * 2.1)];
  }
  return [];
}

function estimateProjectedAreaPx(feature, zoomScale) {
  const bounds = getProjectedFeatureBounds(feature);
  if (!bounds) return 0;
  const area = Math.max(0, bounds.width * bounds.height);
  const scale = Math.max(0.1, Number(zoomScale) || 1);
  return area * scale * scale;
}

function warnMissingPhysicalContextOnce(key, message) {
  if (missingPhysicalContextWarnings.has(key)) return;
  missingPhysicalContextWarnings.add(key);
  console.warn(message);
}

function getDeferredContextLayerLoadState(layerName) {
  return String(runtimeState.contextLayerLoadStateByName?.[layerName] || "idle").trim().toLowerCase();
}

function shouldReportDeferredContextLayerGap(layerName) {
  const loadState = getDeferredContextLayerLoadState(layerName);
  return loadState === "loaded" || loadState === "error";
}

function getPhysicalAtlasClass(feature) {
  const props = feature?.properties || {};
  return String(props.atlas_class || props.atlasClass || "").trim();
}

function getPhysicalAtlasLayer(feature) {
  const props = feature?.properties || {};
  return String(props.atlas_layer || props.atlasLayer || "relief_base").trim().toLowerCase();
}

function getResolvedPhysicalAtlasCollection() {
  if (Array.isArray(runtimeState.physicalSemanticsData?.features) && runtimeState.physicalSemanticsData.features.length > 0) {
    return runtimeState.physicalSemanticsData;
  }
  if (!shouldReportDeferredContextLayerGap("physical_semantics")) {
    return null;
  }
  warnMissingPhysicalContextOnce(
    "physical-semantics-missing",
    "[physical] global_physical_semantics.topo.json unavailable or deferred; disabling physical atlas instead of using the old fallback."
  );
  return null;
}

function getPhysicalPresetId(cfg) {
  const preset = String(cfg?.preset || "balanced").trim().toLowerCase();
  if (preset === "political_clean" || preset === "terrain_rich") {
    return preset;
  }
  return "balanced";
}

function getPhysicalPresetRenderProfile(cfg) {
  const preset = getPhysicalPresetId(cfg);
  if (preset === "political_clean") {
    return {
      preset,
      reliefOpacityMultiplier: 0.38,
      reliefOverlayOpacityRatio: 0.7,
      reliefOverlayOpacityCap: 0.05,
      semanticOpacityMultiplier: 0.2,
      reliefBlendFallback: "source-over",
      semanticBlendMode: "source-over",
      majorContourOpacityMultiplier: 0.92,
      minorContourOpacityRatio: 0.52,
      minorContourMinZoom: 2.6,
    };
  }
  if (preset === "terrain_rich") {
    return {
      preset,
      reliefOpacityMultiplier: 1,
      reliefOverlayOpacityRatio: 0.25,
      reliefOverlayOpacityCap: 0.18,
      semanticOpacityMultiplier: 0.72,
      reliefBlendFallback: "soft-light",
      semanticBlendMode: "source-over",
      majorContourOpacityMultiplier: 1.55,
      minorContourOpacityRatio: 0.8,
      minorContourMinZoom: 1.2,
    };
  }
  return {
    preset: "balanced",
    reliefOpacityMultiplier: 0.72,
    reliefOverlayOpacityRatio: 0.55,
    reliefOverlayOpacityCap: 0.12,
    semanticOpacityMultiplier: 0.42,
    reliefBlendFallback: "source-over",
    semanticBlendMode: "source-over",
    majorContourOpacityMultiplier: 1.22,
    minorContourOpacityRatio: 0.68,
    minorContourMinZoom: 1.6,
  };
}

function getAtlasFeatureAlphaMultiplier(atlasClass, cfg) {
  const normalized = String(atlasClass || "").trim().toLowerCase();
  if (normalized === "mountain_high_relief") return 1.18;
  if (normalized === "mountain_hills") return 1.02;
  if (normalized === "desert_bare") return 1.1;
  if (normalized === "rainforest" || normalized === "rainforest_tropical") {
    return clamp(0.72 + cfg.rainforestEmphasis * 0.38, 0.2, 1.2);
  }
  if (normalized === "forest" || normalized === "forest_temperate") return 0.95;
  if (normalized === "upland_plateau") return 0.9;
  if (normalized === "badlands_canyon") return 0.98;
  if (normalized === "basin_lowlands") return 0.76;
  if (normalized === "plains_lowlands") return 0.68;
  if (normalized === "grassland_steppe") return 0.8;
  if (normalized === "wetlands_delta") return 0.92;
  if (normalized === "tundra_ice") return 0.85;
  return 1;
}

function countTopologyArcRefs(arcs) {
  if (Number.isInteger(arcs)) return 1;
  if (!Array.isArray(arcs)) return 0;
  return arcs.reduce((sum, entry) => sum + countTopologyArcRefs(entry), 0);
}

function estimateTopologyObjectArcRefs(topology, objectName) {
  const object = topology?.objects?.[objectName];
  if (!object || typeof object !== "object") return null;
  if (Array.isArray(object.geometries)) {
    const total = object.geometries.reduce(
      (sum, geometry) => sum + countTopologyArcRefs(geometry?.arcs),
      0
    );
    return total > 0 ? total : null;
  }
  const total = countTopologyArcRefs(object.arcs);
  return total > 0 ? total : null;
}

function getFeatureCollectionFeatureCount(collection) {
  return Array.isArray(collection?.features) ? collection.features.length : 0;
}

function getObjectIdentityToken(value, prefix = "obj") {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return `${prefix}:none`;
  let token = objectIdentityTokenCache.get(value);
  if (!token) {
    token = `${prefix}:${nextObjectIdentityToken++}`;
    objectIdentityTokenCache.set(value, token);
  }
  return token;
}

function getContextLayerStableSourceToken(layerName, collection, {
  primaryTopology = null,
  detailTopology = null,
  externalCollection = null,
  source = "",
} = {}) {
  const normalizedLayerName = String(layerName || "").trim().toLowerCase();
  const normalizedSource = String(source || "").trim().toLowerCase();
  const featureCount = getFeatureCollectionFeatureCount(collection);
  const primaryObject = primaryTopology?.objects?.[normalizedLayerName] || null;
  const detailObject = detailTopology?.objects?.[normalizedLayerName] || null;

  if (normalizedSource === "primary") {
    return [
      "src:primary",
      getObjectIdentityToken(primaryTopology, "topology"),
      getObjectIdentityToken(primaryObject, "topology-object"),
      `features:${featureCount}`,
    ].join("|");
  }
  if (normalizedSource === "detail") {
    return [
      "src:detail",
      getObjectIdentityToken(detailTopology, "topology"),
      getObjectIdentityToken(detailObject, "topology-object"),
      `features:${featureCount}`,
    ].join("|");
  }
  if (normalizedSource === "external") {
    const externalRef = externalCollection || collection;
    return [
      "src:external",
      getObjectIdentityToken(externalRef, "external-layer"),
      `features:${featureCount}`,
    ].join("|");
  }
  return [
    "src:other",
    getObjectIdentityToken(collection, "layer-collection"),
    `features:${featureCount}`,
  ].join("|");
}

function createPhysicalLandMaskInfo({
  collection = null,
  maskSource = "none",
  maskFeatureCount = 0,
  maskArcRefEstimate = null,
  maskQualityToken = "unchecked",
} = {}) {
  return {
    collection,
    maskSource,
    maskFeatureCount,
    maskArcRefEstimate,
    maskQualityToken,
  };
}

function getPhysicalLandMaskCandidateQuality(collection, maskSource) {
  if (!Array.isArray(collection?.features) || !collection.features.length) {
    return { usable: false, token: "empty" };
  }
  const diagnostics = getSphericalGeometryDiagnostics(collection);
  if (diagnostics?.invalid) {
    const token = diagnostics.isWorldBounds ? "world-bounds" : "sphere-area";
    recordRenderPerfMetric("physicalLandMaskRejected", 0, {
      maskSource,
      reason: token,
      area: diagnostics.area,
      bounds: diagnostics.bounds,
      featureCount: getFeatureCollectionFeatureCount(collection),
    });
    return { usable: false, token };
  }
  return { usable: true, token: diagnostics ? "d3-valid" : "d3-unavailable" };
}

function getFirstUsablePhysicalLandMaskInfo(candidates = []) {
  const rejected = [];
  for (const candidate of candidates) {
    const quality = getPhysicalLandMaskCandidateQuality(candidate.collection, candidate.maskSource);
    if (quality.usable) {
      return createPhysicalLandMaskInfo({
        ...candidate,
        maskQualityToken: quality.token,
      });
    }
    if (candidate.maskSource !== "none") {
      rejected.push(`${candidate.maskSource}:${quality.token}`);
    }
  }
  return createPhysicalLandMaskInfo({
    collection: null,
    maskSource: rejected.length ? `none:${rejected.join(",")}` : "none",
    maskFeatureCount: 0,
    maskArcRefEstimate: null,
    maskQualityToken: rejected.length ? `rejected:${rejected.join(",")}` : "none",
  });
}

function getPhysicalLandMaskInfo() {
  const primaryTopology = runtimeState.topologyPrimary || runtimeState.topology;
  const detailTopology = runtimeState.topologyDetail;
  const landSource = String(runtimeState.contextLayerSourceByName?.land || "").trim().toLowerCase();
  const candidates = [];
  if (Array.isArray(runtimeState.scenarioContextLandMaskData?.features) && runtimeState.scenarioContextLandMaskData.features.length) {
    candidates.push({
      collection: runtimeState.scenarioContextLandMaskData,
      maskSource: "scenarioContextLandMask",
      maskFeatureCount: getFeatureCollectionFeatureCount(runtimeState.scenarioContextLandMaskData),
      maskArcRefEstimate: estimateTopologyObjectArcRefs(runtimeState.scenarioRuntimeTopologyData, "context_land_mask")
        ?? estimateTopologyObjectArcRefs(runtimeState.scenarioRuntimeTopologyData, "land_mask")
        ?? estimateTopologyObjectArcRefs(runtimeState.scenarioRuntimeTopologyData, "land"),
    });
  }
  if (Array.isArray(runtimeState.scenarioLandMaskData?.features) && runtimeState.scenarioLandMaskData.features.length) {
    candidates.push({
      collection: runtimeState.scenarioLandMaskData,
      maskSource: "scenarioLandMask",
      maskFeatureCount: getFeatureCollectionFeatureCount(runtimeState.scenarioLandMaskData),
      maskArcRefEstimate:
        estimateTopologyObjectArcRefs(runtimeState.scenarioRuntimeTopologyData, "land_mask")
        ?? estimateTopologyObjectArcRefs(runtimeState.scenarioRuntimeTopologyData, "land"),
    });
  }
  if (Array.isArray(runtimeState.landBgData?.features) && runtimeState.landBgData.features.length) {
    const topology = landSource === "detail" ? detailTopology : primaryTopology;
    candidates.push({
      collection: runtimeState.landBgData,
      maskSource: "landBgData",
      maskFeatureCount: getFeatureCollectionFeatureCount(runtimeState.landBgData),
      maskArcRefEstimate: estimateTopologyObjectArcRefs(topology, "land"),
    });
  }
  if (Array.isArray(runtimeState.landDataFull?.features) && runtimeState.landDataFull.features.length) {
    const topology = runtimeState.runtimePoliticalTopology?.objects?.political
      ? runtimeState.runtimePoliticalTopology
      : (primaryTopology || null);
    candidates.push({
      collection: runtimeState.landDataFull,
      maskSource: "landDataFull",
      maskFeatureCount: getFeatureCollectionFeatureCount(runtimeState.landDataFull),
      maskArcRefEstimate: estimateTopologyObjectArcRefs(topology, "political"),
    });
  }
  if (Array.isArray(runtimeState.landData?.features) && runtimeState.landData.features.length) {
    const topology = runtimeState.runtimePoliticalTopology?.objects?.political
      ? runtimeState.runtimePoliticalTopology
      : (primaryTopology || null);
    candidates.push({
      collection: runtimeState.landData,
      maskSource: "landData",
      maskFeatureCount: getFeatureCollectionFeatureCount(runtimeState.landData),
      maskArcRefEstimate: estimateTopologyObjectArcRefs(topology, "political"),
    });
  }
  return getFirstUsablePhysicalLandMaskInfo(candidates);
}

function getPhysicalLandClipCacheKey(maskInfo) {
  return [
    getProjectionRenderSignature(),
    `scenario-surface:${getScenarioSurfaceVersionSignal()}`,
  ].join("::");
}

function getPhysicalLandClipPath(maskInfo, landMask) {
  if (!globalThis.Path2D || !globalThis.d3 || typeof globalThis.d3.geoPath !== "function") {
    return { path: null, cacheHit: false, cacheKey: "", pathType: "canvas-path" };
  }
  const cacheKey = getPhysicalLandClipCacheKey(maskInfo);
  if (physicalLandClipPathCache.key === cacheKey && physicalLandClipPathCache.path) {
    return {
      path: physicalLandClipPathCache.path,
      cacheHit: true,
      cacheKey,
      pathType: "path2d-cache",
    };
  }
  try {
    const pathString = globalThis.d3.geoPath(rendererSurfaceHost.getProjection()).pointRadius(PATH_POINT_RADIUS)(landMask);
    if (!pathString) {
      return { path: null, cacheHit: false, cacheKey, pathType: "canvas-path" };
    }
    const path = new globalThis.Path2D(pathString);
    physicalLandClipPathCache.key = cacheKey;
    physicalLandClipPathCache.path = path;
    return {
      path,
      cacheHit: false,
      cacheKey,
      pathType: "path2d-cache",
    };
  } catch (_error) {
    return { path: null, cacheHit: false, cacheKey, pathType: "canvas-path" };
  }
}

function applyPhysicalLandClipMask() {
  const startedAt = nowMs();
  const maskInfo = getPhysicalLandMaskInfo();
  const landMask = maskInfo.collection;
  if (!landMask) {
    collectContextMetric("applyPhysicalLandClipMask", nowMs() - startedAt, {
      applied: false,
      maskSource: maskInfo.maskSource,
      maskFeatureCount: maskInfo.maskFeatureCount,
      maskArcRefEstimate: maskInfo.maskArcRefEstimate,
      reason: "no-mask",
    });
    return false;
  }
  const clipPath = getPhysicalLandClipPath(maskInfo, landMask);
  if (clipPath.path) {
    rendererSurfaceHost.getContext().clip(clipPath.path);
  } else {
    rendererSurfaceHost.getContext().beginPath();
    rendererSurfaceHost.getPathCanvas()(landMask);
    rendererSurfaceHost.getContext().clip();
  }
  collectContextMetric("applyPhysicalLandClipMask", nowMs() - startedAt, {
    applied: true,
    maskSource: maskInfo.maskSource,
    maskFeatureCount: maskInfo.maskFeatureCount,
    maskArcRefEstimate: maskInfo.maskArcRefEstimate,
    cacheHit: !!clipPath.cacheHit,
    pathType: clipPath.pathType,
  });
  return true;
}

function drawPhysicalAtlasCollectionLayer(
  atlasCollection,
  layerName,
  cfg,
  {
    baseOpacity = 1,
    blendMode = "source-over",
    clipAlreadyApplied = false,
  } = {}
) {
  return getPhysicalLayerRenderOwner().drawPhysicalAtlasCollectionLayer(atlasCollection, layerName, cfg, {
    baseOpacity,
    blendMode,
    clipAlreadyApplied,
  });
}

function getFieldFeatureMultiplier(channelId, feature) {
  runtimeState.intensityFields = normalizeIntensityFieldsState(runtimeState.intensityFields);
  const fields = runtimeState.intensityFields;
  const channel = fields.channels?.[channelId];
  if (!channel?.enabled) return 1;
  const centroid = getFeatureGeoCentroid(feature);
  if (!centroid) return 1;
  return sampleIntensityField(fields, channelId, centroid[0], centroid[1]);
}

function getUrbanGlowMultiplierAt(lon, lat) {
  runtimeState.intensityFields = normalizeIntensityFieldsState(runtimeState.intensityFields);
  return sampleIntensityField(runtimeState.intensityFields, "urbanGlow", lon, lat);
}

function getUrbanGlowFeatureMultiplier(feature) {
  return getFieldFeatureMultiplier("urbanGlow", feature);
}

function getProjectedDegreeRadiusPx(lon, lat, radiusDeg) {
  const center = rendererSurfaceHost.getProjection()([lon, lat]);
  if (!Array.isArray(center) || center.length < 2) return 0;
  const eastLon = lon >= 179 ? lon - 1 : lon + 1;
  const northLat = clamp(lat + 1, -90, 90);
  const east = rendererSurfaceHost.getProjection()([eastLon, lat]);
  const north = rendererSurfaceHost.getProjection()([lon, northLat]);
  const eastDistance = Array.isArray(east) ? Math.hypot(east[0] - center[0], east[1] - center[1]) : 0;
  const northDistance = Array.isArray(north) ? Math.hypot(north[0] - center[0], north[1] - center[1]) : 0;
  return clamp(Math.max(eastDistance, northDistance, 0) * clamp(radiusDeg, 0.25, 30), 6, 160);
}

function drawPhysicalIntensityFieldLayer({ clipAlreadyApplied = false } = {}) {
  return getPhysicalLayerRenderOwner().drawPhysicalIntensityFieldLayer({ clipAlreadyApplied });
}

function getPhysicalReliefOverlayBlendMode(cfg, presetProfile) {
  const requestedMode = getSafeBlendMode(cfg?.blendMode, presetProfile?.reliefBlendFallback || "source-over");
  if (requestedMode === "overlay" || requestedMode === "multiply") {
    return "soft-light";
  }
  return requestedMode;
}

function drawPhysicalReliefOverlayLayer(k, { interactive = false, clipAlreadyApplied = false } = {}) {
  return getPhysicalLayerRenderOwner().drawPhysicalReliefOverlayLayer(k, { interactive, clipAlreadyApplied });
}

function drawPhysicalBasePass(k, { interactive = false } = {}) {
  return getPhysicalLayerRenderOwner().drawPhysicalBasePass(k, { interactive });
}

function drawPhysicalAtlasLayer(k, { interactive = false, clipAlreadyApplied = false } = {}) {
  return getPhysicalLayerRenderOwner().drawPhysicalAtlasLayer(k, { interactive, clipAlreadyApplied });
}

function drawContourCollection(
  collection,
  {
    cacheSlot = "major",
    color,
    colorResolver = null,
    opacity,
    width,
    k,
    interactive = false,
    lowReliefCutoff = 0,
    intervalM = 0,
    excludeIntervalM = 0,
    minScreenSpanPx = 0,
    maxFeatures = 0,
    opacityMultiplierResolver = null,
  } = {}
) {
  return getPhysicalLayerRenderOwner().drawContourCollection(collection, {
    cacheSlot,
    color,
    colorResolver,
    opacity,
    width,
    k,
    interactive,
    lowReliefCutoff,
    intervalM,
    excludeIntervalM,
    minScreenSpanPx,
    maxFeatures,
    opacityMultiplierResolver,
  });
}

function drawPhysicalContourLayer(k, { interactive = false, clipAlreadyApplied = false } = {}) {
  return getPhysicalLayerRenderOwner().drawPhysicalContourLayer(k, { interactive, clipAlreadyApplied });
}

function shouldForceExactContextBaseRefresh(reuseDecision = null) {
  if (!runtimeState.showPhysical) return false;
  if (runtimeState.bootBlocking || runtimeState.scenarioApplyInFlight || runtimeState.startupReadonly || runtimeState.startupReadonlyUnlockInFlight) {
    return false;
  }
  const cfg = normalizePhysicalStyleConfig(runtimeState.styleConfig?.physical);
  if (!(cfg.mode === "atlas_only" || cfg.mode === "contours_only" || cfg.mode === "atlas_and_contours")) {
    return false;
  }
  const cache = getRenderPassCacheState();
  if (cache.dirty?.physicalBase || cache.dirty?.contextBase) {
    return true;
  }
  const resolvedReuseDecision =
    reuseDecision && typeof reuseDecision === "object"
      ? reuseDecision
      : getContextBaseReuseDecision();
  return !!(resolvedReuseDecision?.crossesMinorContourThreshold || resolvedReuseDecision?.crossesZoomBucket);
}

function getPhysicalExactRefreshPasses() {
  const passes = runtimeState.showPhysical
    ? ["physicalBase", "political", "contextBase", "borders"]
    : ["political", "contextBase", "borders"];
  return passes;
}

function getUrbanFeatureOwnerId(feature) {
  const props = feature?.properties || {};
  return String(
    props.country_owner_id ||
    props.countryOwnerId ||
    ""
  ).trim();
}

function getUrbanHostFillColor(feature) {
  const ownerFeatureId = getUrbanFeatureOwnerId(feature);
  if (!ownerFeatureId) return null;
  const hostFeature = runtimeState.landIndex?.get(ownerFeatureId);
  if (!hostFeature) return null;
  return (
    getSafeCanvasColor(runtimeState.colors?.[ownerFeatureId], null) ||
    getSafeCanvasColor(getResolvedFeatureColor(hostFeature, ownerFeatureId), null)
  );
}

function computeUrbanAdaptivePaintFromHostColor(backgroundColor, config = {}) {
  if (!backgroundColor) return null;
  const luminance = getCanvasColorRelativeLuminance(backgroundColor);
  if (!Number.isFinite(luminance)) return null;

  const strength = clamp(Number(config.adaptiveStrength) || 0, 0, 1);
  const toneBias = clamp(Number(config.toneBias) || 0, -0.3, 0.3);
  const lightenBias = Math.max(toneBias, 0);
  const deepenBias = Math.max(-toneBias, 0);
  const isDark = luminance <= 0.30;
  const isLight = luminance >= 0.62;

  const tintEnabled = !!config.adaptiveTintEnabled;
  const tintColor = getSafeCanvasColor(config.adaptiveTintColor, null);
  const tintStrength = clamp(Number(config.adaptiveTintStrength) || 0, 0, 0.5);
  const applyTintOverlay = (baseColor, channelStrength = 1) => {
    if (!tintEnabled || !tintColor || tintStrength <= 0) return baseColor;
    return mixCanvasColors(baseColor, tintColor, clamp(tintStrength * channelStrength, 0, 0.5));
  };

  if (isDark) {
    const fillColor = mixCanvasColors(
      backgroundColor,
      "#f4efe3",
      clamp(0.48 + (strength * 0.18) + (lightenBias * 0.56) - (deepenBias * 0.24), 0.18, 0.96)
    );
    const strokeColor = mixCanvasColors(
      backgroundColor,
      "#fff9ef",
      clamp(0.66 + (strength * 0.14) + (lightenBias * 0.44) - (deepenBias * 0.18), 0.24, 0.98)
    );
    return {
      fillColor: applyTintOverlay(fillColor, 1),
      strokeColor: applyTintOverlay(strokeColor, 0.72),
    };
  }
  if (isLight) {
    const fillColor = mixCanvasColors(
      backgroundColor,
      "#20252b",
      clamp(0.42 + (strength * 0.16) + (deepenBias * 0.34) - (lightenBias * 0.28), 0.16, 0.94)
    );
    const strokeColor = mixCanvasColors(
      backgroundColor,
      "#0f1419",
      clamp(0.62 + (strength * 0.12) + (deepenBias * 0.26) - (lightenBias * 0.18), 0.22, 0.96)
    );
    return {
      fillColor: applyTintOverlay(fillColor, 1),
      strokeColor: applyTintOverlay(strokeColor, 0.72),
    };
  }
  const targetFill = luminance < 0.48 ? "#ede7da" : "#272d34";
  const targetStroke = luminance < 0.48 ? "#fff7ec" : "#10151a";
  const fillColor = mixCanvasColors(
    backgroundColor,
    targetFill,
    clamp(0.46 + (strength * 0.16) + (luminance < 0.48 ? (lightenBias * 0.42) - (deepenBias * 0.18) : (deepenBias * 0.26) - (lightenBias * 0.22)), 0.18, 0.95)
  );
  const strokeColor = mixCanvasColors(
    backgroundColor,
    targetStroke,
    clamp(0.66 + (strength * 0.12) + (luminance < 0.48 ? (lightenBias * 0.3) - (deepenBias * 0.14) : (deepenBias * 0.22) - (lightenBias * 0.16)), 0.24, 0.97)
  );
  return {
    fillColor: applyTintOverlay(fillColor, 1),
    strokeColor: applyTintOverlay(strokeColor, 0.72),
  };
}

function getUrbanAdaptivePaint(feature, config = {}) {
  const backgroundColor = getUrbanHostFillColor(feature);
  return computeUrbanAdaptivePaintFromHostColor(backgroundColor, config);
}

function getEffectiveUrbanMode(config = {}, capability = runtimeState.urbanLayerCapability) {
  return config?.mode === "adaptive" && capability?.adaptiveAvailable ? "adaptive" : "manual";
}

function drawUrbanLayer(k, { interactive = false } = {}) {
  const startedAt = nowMs();
  if (!runtimeState.showUrban || !runtimeState.urbanData?.features?.length) {
    collectContextMetric("drawUrbanLayer", nowMs() - startedAt, {
      featureCount: getFeatureCollectionFeatureCount(runtimeState.urbanData),
      interactive: !!interactive,
      skipped: true,
      reason: !runtimeState.showUrban ? "hidden" : "no-data",
    });
    return;
  }
  const cfg = normalizeUrbanStyleConfig(runtimeState.styleConfig?.urban || {});
  const capability = runtimeState.urbanLayerCapability || getUrbanLayerCapability(runtimeState.urbanData);
  const effectiveMode = getEffectiveUrbanMode(cfg, capability);
  const manualColor = getSafeCanvasColor(cfg.color, "#4b5563");
  const fillOpacity = clamp(Number.isFinite(Number(cfg.fillOpacity)) ? Number(cfg.fillOpacity) : 0.34, 0, 1);
  const strokeOpacity = clamp(Number.isFinite(Number(cfg.strokeOpacity)) ? Number(cfg.strokeOpacity) : 0.25, 0, 1);
  const minAreaPx = clamp(Number.isFinite(Number(cfg.minAreaPx)) ? Number(cfg.minAreaPx) : 1, 1, 80);
  const blendMode = effectiveMode === "manual"
    ? getSafeBlendMode(cfg.blendMode, "multiply")
    : "source-over";
  const strokeWidth = clamp(0.85 / Math.max(Math.sqrt(Math.max(Number(k) || 1, 1)), 1), 0.3, 0.85);

  rendererSurfaceHost.getContext().save();
  rendererSurfaceHost.getContext().globalCompositeOperation = blendMode;
  runtimeState.urbanData.features.forEach((feature) => {
    if (estimateProjectedAreaPx(feature, k) < minAreaPx) return;
    if (!pathBoundsInScreen(feature)) return;
    const adaptivePaint = effectiveMode === "adaptive" ? getUrbanAdaptivePaint(feature, cfg) : null;
    const fillColor = getSafeCanvasColor(adaptivePaint?.fillColor, manualColor);
    const outlineColor = getSafeCanvasColor(adaptivePaint?.strokeColor, null);
    const glowMultiplier = getUrbanGlowFeatureMultiplier(feature);
    if (!fillColor) return;
    rendererSurfaceHost.getContext().beginPath();
    rendererSurfaceHost.getPathCanvas()(feature);
    rendererSurfaceHost.getContext().fillStyle = fillColor;
    rendererSurfaceHost.getContext().globalAlpha = clamp((interactive ? Math.min(fillOpacity, 0.15) : fillOpacity) * glowMultiplier, 0, 1);
    rendererSurfaceHost.getContext().fill();
    if (effectiveMode === "adaptive" && outlineColor) {
      rendererSurfaceHost.getContext().strokeStyle = outlineColor;
      rendererSurfaceHost.getContext().lineWidth = strokeWidth;
      rendererSurfaceHost.getContext().globalAlpha = clamp((interactive ? Math.min(strokeOpacity, 0.18) : strokeOpacity) * glowMultiplier, 0, 1);
      rendererSurfaceHost.getContext().stroke();
    }
  });

  rendererSurfaceHost.getContext().restore();
  collectContextMetric("drawUrbanLayer", nowMs() - startedAt, {
    featureCount: getFeatureCollectionFeatureCount(runtimeState.urbanData),
    interactive: !!interactive,
    skipped: false,
    mode: effectiveMode,
    requestedMode: cfg.mode,
    adaptiveAvailable: !!capability?.adaptiveAvailable,
  });
}

function recordDeferredRiversLayerMetric({ interactive = false, reason = "staged-apply" } = {}) {
  return getRiverLayerRenderOwner().recordDeferredRiversLayerMetric({ interactive, reason });
}

function drawRiversLayer(k, { interactive = false } = {}) {
  return getRiverLayerRenderOwner().drawRiversLayer(k, { interactive });
}

function getCityFeatureKey(feature, fallbackKey = "") {
  const props = feature?.properties || {};
  return String(
    props.__city_stable_key
    || props.stable_key
    || props.__city_id
    || props.id
    || feature?.id
    || fallbackKey
    || ""
  ).trim();
}

function getCityFeatureAliases(feature, key = "") {
  const props = feature?.properties || {};
  const aliases = new Set([
    key,
    props.__city_stable_key,
    props.stable_key,
    props.__city_id,
    props.id,
    props.name,
    props.label,
    props.name_en,
    props.label_en,
    props.name_zh,
    props.label_zh,
  ].filter(Boolean).map((value) => String(value).trim()));
  const extraAliases = Array.isArray(props.__city_aliases) ? props.__city_aliases : [];
  extraAliases.forEach((value) => {
    const alias = String(value || "").trim();
    if (alias) aliases.add(alias);
  });
  return Array.from(aliases);
}

function normalizeCityLabelComparisonValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function getCityRawLanguageLabel(feature, language = runtimeState.currentLanguage) {
  const props = feature?.properties || {};
  if (String(language || "en").trim().toLowerCase() === "zh") {
    return String(props.label_zh || props.name_zh || props.label_cn || props.name_cn || "").trim();
  }
  return String(props.label_en || props.name_en || props.label || props.name || "").trim();
}

function getCityOverrideDisplayLabel(feature) {
  const props = feature?.properties || {};
  if (!props.__city_has_display_name_override) {
    return "";
  }
  const displayName = props.__city_display_name_override && typeof props.__city_display_name_override === "object"
    ? props.__city_display_name_override
    : {};
  return String(
    runtimeState.currentLanguage === "zh"
      ? (displayName.zh || "")
      : (displayName.en || "")
  ).trim();
}

function getCityBaseLocalizedLabel(feature, { strict = false } = {}) {
  const props = feature?.properties || {};
  const baseCandidates = [
    props.__city_stable_key,
    props.stable_key,
    props.__city_id,
    props.id,
    props.name,
    props.label,
    props.name_en,
    props.label_en,
    props.name_zh,
    props.label_zh,
  ];
  const aliases = Array.isArray(props.__city_aliases) ? props.__city_aliases : [];
  return strict
    ? getStrictGeoLabel([...baseCandidates, ...aliases], "")
    : getPreferredGeoLabel([...baseCandidates, ...aliases], "");
}

function isAdministrativeCityLabelCandidate(label = "") {
  const normalizedLabel = String(label || "").trim();
  if (!normalizedLabel) return false;
  return CITY_ADMIN_LABEL_REJECT_PATTERNS.some((pattern) => pattern.test(normalizedLabel));
}

function getCityHostFeatureDisplayLabel(feature) {
  const props = feature?.properties || {};
  const hostFeatureId = String(props.__city_host_feature_id || "").trim();
  if (!hostFeatureId) return "";
  const hostLabel = getStrictGeoLabel(hostFeatureId, "");
  if (!hostLabel || isAdministrativeCityLabelCandidate(hostLabel)) {
    return "";
  }
  return hostLabel;
}

function getCityRawFallbackLabel(feature) {
  const props = feature?.properties || {};
  const currentLanguageLabel = getCityRawLanguageLabel(feature, runtimeState.currentLanguage);
  if (currentLanguageLabel) {
    return currentLanguageLabel;
  }
  const alternateLanguageLabel = getCityRawLanguageLabel(feature, runtimeState.currentLanguage === "zh" ? "en" : "zh");
  if (alternateLanguageLabel) {
    return alternateLanguageLabel;
  }
  const localeEntry = props.__city_locale && typeof props.__city_locale === "object" ? props.__city_locale : {};
  return String(
    runtimeState.currentLanguage === "zh"
      ? (localeEntry.zh || localeEntry.en || props.label_zh || props.name_zh || props.label || props.name || props.__city_id || feature?.id || "")
      : (localeEntry.en || localeEntry.zh || props.label_en || props.name_en || props.label || props.name || props.__city_id || feature?.id || "")
  ).trim();
}

function getCityDisplayLabel(feature) {
  const props = feature?.properties || {};
  const overrideLabel = getCityOverrideDisplayLabel(feature);
  if (overrideLabel) {
    return overrideLabel;
  }
  const baseStrict = getCityBaseLocalizedLabel(feature, { strict: true });
  const baseFallback = getCityBaseLocalizedLabel(feature);
  const rawCurrentLanguageLabel = getCityRawLanguageLabel(feature, runtimeState.currentLanguage);
  const rawFallback = getCityRawFallbackLabel(feature);
  const hostFeatureLabel = getCityHostFeatureDisplayLabel(feature);
  const prefersLocalizedFallback = !!props.__city_has_display_name_override;
  const hostComparison = normalizeCityLabelComparisonValue(hostFeatureLabel);
  const baseComparison = normalizeCityLabelComparisonValue(
    baseStrict || (prefersLocalizedFallback ? baseFallback : rawCurrentLanguageLabel) || (prefersLocalizedFallback ? rawCurrentLanguageLabel : baseFallback) || rawFallback
  );
  if (hostComparison && hostComparison !== baseComparison) {
    return hostFeatureLabel;
  }
  if (baseStrict) {
    return baseStrict;
  }
  if (prefersLocalizedFallback) {
    if (baseFallback) {
      return baseFallback;
    }
    if (rawCurrentLanguageLabel) {
      return rawCurrentLanguageLabel;
    }
  } else {
    if (rawCurrentLanguageLabel) {
      return rawCurrentLanguageLabel;
    }
    if (baseFallback) {
      return baseFallback;
    }
  }
  return rawFallback;
}

function cleanCityMapLabelText(label = "") {
  const rawLabel = String(label || "").trim();
  if (!rawLabel) return "";
  let cleaned = rawLabel
    .replace(/\s*\(([^)]*)\)\s*/g, " ")
    .replace(/\s*,\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  CITY_ADMIN_LABEL_PATTERNS.forEach((pattern) => {
    cleaned = cleaned.replace(pattern, " ").replace(/\s+/g, " ").trim();
  });
  cleaned = cleaned.replace(/^[\s,;:-]+|[\s,;:-]+$/g, "").trim();
  return cleaned.length >= 3 ? cleaned : rawLabel;
}

function isCjkText(value = "") {
  return /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/u.test(String(value || ""));
}

function abbreviateCityMapLabel(label = "") {
  const rawLabel = String(label || "").trim();
  if (!rawLabel || isCjkText(rawLabel) || !/[\s-]/u.test(rawLabel)) {
    return rawLabel;
  }
  const segments = rawLabel.split(/([\s-]+)/u);
  let wordIndex = 0;
  return segments.map((segment) => {
    if (!segment || /^[\s-]+$/u.test(segment)) {
      return segment;
    }
    wordIndex += 1;
    if (wordIndex === 1) {
      return segment;
    }
    const firstGlyph = Array.from(segment)[0] || "";
    return firstGlyph ? `${firstGlyph}.` : segment;
  }).join("").replace(/\s+/g, " ").trim();
}

function truncateCityLabelToWidth(text = "", maxWidthPx = 0, measureWidth = () => 0) {
  const rawText = String(text || "").trim();
  if (!rawText) return "";
  if (measureWidth(rawText) <= maxWidthPx) {
    return rawText;
  }
  const glyphs = Array.from(rawText);
  if (glyphs.length <= 4) {
    return rawText;
  }
  let truncated = rawText;
  while (glyphs.length > 4) {
    glyphs.pop();
    truncated = `${glyphs.join("")}\u2026`;
    if (measureWidth(truncated) <= maxWidthPx) {
      return truncated;
    }
  }
  return truncated;
}

function getCityMapLabelMaxWidth(entry, config = {}) {
  const densityKey = String(config.labelDensity || "balanced").trim().toLowerCase();
  const widthTable = CITY_LABEL_MAX_WIDTH_PX[densityKey] || CITY_LABEL_MAX_WIDTH_PX.balanced;
  const widthKey = entry?.isCapital ? "capital" : (String(entry?.cityTier || "minor").trim().toLowerCase());
  return Number(widthTable[widthKey] || widthTable.minor || 132);
}

function formatCityMapLabel(fullLabel, { entry = null, context: labelContext = null, config = {}, scale = 1 } = {}) {
  const rawLabel = String(fullLabel || "").trim();
  if (!rawLabel || !labelContext?.measureText) {
    return rawLabel;
  }
  const maxWidthPx = getCityMapLabelMaxWidth(entry, config);
  const measureWidth = (candidate) => Number(labelContext.measureText(String(candidate || "")).width || 0) * scale;
  const cleanedLabel = cleanCityMapLabelText(rawLabel);
  if (cleanedLabel && measureWidth(cleanedLabel) <= maxWidthPx) {
    return cleanedLabel;
  }
  const abbreviatedLabel = abbreviateCityMapLabel(cleanedLabel || rawLabel);
  if (abbreviatedLabel && measureWidth(abbreviatedLabel) <= maxWidthPx) {
    return abbreviatedLabel;
  }
  return truncateCityLabelToWidth(abbreviatedLabel || cleanedLabel || rawLabel, maxWidthPx, measureWidth);
}

function getCityMarkerThemeTokens(config = {}) {
  const themeKey = String(config.theme || CITY_MARKER_THEME_GRAPHITE).trim().toLowerCase();
  const baseTokens = CITY_MARKER_THEME_TOKENS[themeKey] || CITY_MARKER_THEME_TOKENS.classic_graphite;
  const pointColor = getSafeCanvasColor(config.color, baseTokens.fillMid);
  const capitalColor = getSafeCanvasColor(config.capitalColor, baseTokens.capitalAccent);
  return {
    ...baseTokens,
    fillTop: mixCanvasColors(baseTokens.fillTop, pointColor, 0.34) || pointColor,
    fillMid: mixCanvasColors(baseTokens.fillMid, pointColor, 0.84) || pointColor,
    fillBottom: mixCanvasColors(baseTokens.fillBottom, pointColor, 0.9) || pointColor,
    stroke: mixCanvasColors(baseTokens.stroke, pointColor, 0.2) || baseTokens.stroke,
    capitalAccent: mixCanvasColors(baseTokens.capitalAccent, capitalColor, 0.92) || capitalColor,
    capitalHighlight: mixCanvasColors(baseTokens.capitalHighlight, capitalColor, 0.32) || baseTokens.capitalHighlight,
    capitalLabel: mixCanvasColors(baseTokens.capitalLabel, capitalColor, 0.18) || baseTokens.capitalLabel,
  };
}

function getCityCountryGroupKey(feature) {
  const props = feature?.properties || {};
  const scenarioTag = getUrbanCityPolicyOwner().getCityScenarioTag(feature);
  if (scenarioTag) return `tag:${scenarioTag}`;
  const countryCode = String(props.__city_country_code || props.country_code || "").trim().toUpperCase();
  if (countryCode) return `cc:${countryCode}`;
  const hostFeatureId = String(props.__city_host_feature_id || props.host_feature_id || "").trim();
  if (hostFeatureId) return `host:${hostFeatureId}`;
  return `city:${getCityCanonicalId(feature) || getCityFeatureKey(feature)}`;
}

function getScenarioFeaturedTagSet() {
  return new Set(
    Array.isArray(runtimeState.activeScenarioManifest?.featured_tags)
      ? runtimeState.activeScenarioManifest.featured_tags
        .map((value) => String(value || "").trim().toUpperCase())
        .filter(Boolean)
      : []
  );
}

function getCityCountryProfileIndex(cityCollection) {
  if (!cityCollection?.features?.length) {
    return new Map();
  }
  const cached = cityCountryProfileCache.get(cityCollection);
  if (cached) {
    return cached;
  }

  const profiles = new Map();
  cityCollection.features.forEach((feature) => {
    const props = feature?.properties || {};
    const groupKey = getCityCountryGroupKey(feature);
    let profile = profiles.get(groupKey);
    if (!profile) {
      profile = {
        groupKey,
        scenarioTag: getUrbanCityPolicyOwner().getCityScenarioTag(feature),
        countryCode: String(props.__city_country_code || props.country_code || "").trim().toUpperCase(),
        featureCount: 0,
        hasCapital: false,
        hasCountryCapital: false,
        maxPopulation: 0,
        maxTierWeight: 0,
        controllerFeatureCount: 0,
        countryClass: "micro",
        classWeightBias: 0,
        minQuotaFloorBoost: 0,
      };
      profiles.set(groupKey, profile);
    }
    profile.featureCount += 1;
    profile.hasCapital = profile.hasCapital || !!props.__city_is_capital;
    profile.hasCountryCapital = profile.hasCountryCapital || !!props.__city_is_country_capital;
    profile.maxPopulation = Math.max(profile.maxPopulation, Math.max(0, Number(props.__city_population || 0)));
    profile.maxTierWeight = Math.max(profile.maxTierWeight, getCityTierWeight(feature));
  });

  const featuredTags = getScenarioFeaturedTagSet();
  const defaultCountry = String(runtimeState.activeScenarioManifest?.default_country || "")
    .trim()
    .toUpperCase();
  profiles.forEach((profile) => {
    const record = profile.scenarioTag ? runtimeState.scenarioCountriesByTag?.[profile.scenarioTag] : null;
    const revealOverride = getCityCountryRevealOverride(record);
    const isDefaultCountry = !!profile.scenarioTag && profile.scenarioTag === defaultCountry;
    const isFeaturedCountry = !!record?.featured || featuredTags.has(profile.scenarioTag);
    const isPrimaryPower = CITY_PRIMARY_POWER_TAGS.has(profile.scenarioTag);
    const isSecondaryPower = CITY_SECONDARY_POWER_TAGS.has(profile.scenarioTag);
    profile.controllerFeatureCount = Math.max(
      0,
      Number(record?.controller_feature_count ?? record?.controllerFeatureCount ?? profile.featureCount ?? 0) || 0
    );
    profile.countryTier = getCityCountryTierFromScenarioRecord(profile, record, {
      defaultCountry,
      featuredTags,
    }) || getFallbackCityCountryTier(profile);
    profile.countryClass = revealOverride.className || getCityCountryVisibilityClass(profile, record, {
      defaultCountry,
      featuredTags,
    });
    profile.countryClassRank = CITY_COUNTRY_CLASS_RANK[profile.countryClass] || 0;
    profile.classWeightBias = Number(revealOverride.classWeightBias || 0);
    profile.minQuotaFloorBoost = Number(revealOverride.minQuotaFloorBoost || 0);
    profile.countryTierRank = CITY_COUNTRY_TIER_RANK[profile.countryTier] || 0;
    profile.isDefaultCountry = isDefaultCountry;
    profile.isFeaturedCountry = isFeaturedCountry;
    profile.isPrimaryPower = isPrimaryPower;
    profile.isSecondaryPower = isSecondaryPower;
    profile.isPriorityCountry = (
      isDefaultCountry
      || isPrimaryPower
      || isSecondaryPower
    );
  });

  cityCountryProfileCache.set(cityCollection, profiles);
  return profiles;
}

function getCityInterpolatedRevealBucket(entry, scale) {
  const { currentPhase, nextPhase, t } = getCityRevealPhaseInterpolation(scale);
  const currentBucket = getCityRevealBucket(entry, currentPhase.id);
  if (!nextPhase || nextPhase.id === currentPhase.id) {
    return currentBucket;
  }
  const nextBucket = getCityRevealBucket(entry, nextPhase.id);
  if (Number.isFinite(currentBucket) && Number.isFinite(nextBucket)) {
    return currentBucket + ((nextBucket - currentBucket) * t);
  }
  if (!Number.isFinite(currentBucket) && Number.isFinite(nextBucket)) {
    const seed = `${String(entry?.cityId || "")}:${currentPhase.id}:${nextPhase.id}`;
    const threshold = clamp(0.7 + (getSignedHashUnit(seed) * 0.12), 0.58, 0.82);
    return t >= threshold ? nextBucket + ((1 - t) * 0.5) : Number.POSITIVE_INFINITY;
  }
  return currentBucket;
}

function getCityViewportCenterDistanceNorm(entry) {
  const point = Array.isArray(entry?.screenPoint) ? entry.screenPoint : null;
  if (!point || point.length < 2) return 1;
  const centerX = Number(runtimeState.width || 0) * 0.5;
  const centerY = Number(runtimeState.height || 0) * 0.5;
  const maxDistance = Math.max(1, Math.hypot(centerX + 48, centerY + 48));
  return clamp(Math.hypot(Number(point[0] || 0) - centerX, Number(point[1] || 0) - centerY) / maxDistance, 0, 1);
}

function getCityMarkerSprite(entry, config = {}) {
  return getCityPointsRenderOwner().getCityMarkerSprite(entry, config);
}

const buildCityRevealPlan = (...args) => getUrbanCityPolicyOwner().buildCityRevealPlan(...args);

const getEffectiveCityCollection = (...args) => getUrbanCityPolicyOwner().getEffectiveCityCollection(...args);

function getCityAnchor(feature) {
  if (!feature || !rendererSurfaceHost.getProjection()) return null;
  const cached = cityAnchorCache.get(feature);
  if (cached !== undefined) {
    return cached;
  }

  let anchor = null;
  const geometry = feature.geometry;
  if (geometry?.type === "Point" && Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2) {
    const projected = rendererSurfaceHost.getProjection()(geometry.coordinates);
    if (Array.isArray(projected) && projected.every((value) => Number.isFinite(Number(value)))) {
      anchor = projected;
    }
  } else if (geometry?.type === "MultiPoint" && Array.isArray(geometry.coordinates) && geometry.coordinates.length) {
    const projectedPoints = geometry.coordinates
      .map((coords) => rendererSurfaceHost.getProjection()(coords))
      .filter((point) => Array.isArray(point) && point.every((value) => Number.isFinite(Number(value))));
    if (projectedPoints.length) {
      const [sumX, sumY] = projectedPoints.reduce(
        (acc, point) => [acc[0] + Number(point[0]), acc[1] + Number(point[1])],
        [0, 0]
      );
      anchor = [sumX / projectedPoints.length, sumY / projectedPoints.length];
    }
  }

  if (!anchor && rendererSurfaceHost.getPathCanvas()?.centroid) {
    const centroid = rendererSurfaceHost.getPathCanvas().centroid(feature);
    if (Array.isArray(centroid) && centroid.every((value) => Number.isFinite(Number(value)))) {
      anchor = centroid;
    }
  }

  if (!anchor && globalThis.d3?.geoCentroid) {
    const geoCentroid = globalThis.d3.geoCentroid(feature);
    const projected = Array.isArray(geoCentroid) ? rendererSurfaceHost.getProjection()(geoCentroid) : null;
    if (Array.isArray(projected) && projected.every((value) => Number.isFinite(Number(value)))) {
      anchor = projected;
    }
  }

  cityAnchorCache.set(feature, anchor);
  return anchor;
}

function getCityScreenPoint(anchor, transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity) {
  if (!Array.isArray(anchor) || anchor.length < 2) return null;
  const scale = Math.max(0.0001, Number(transform?.k || 1));
  const x = Number(anchor[0]);
  const y = Number(anchor[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [
    (x * scale) + Number(transform?.x || 0),
    (y * scale) + Number(transform?.y || 0),
  ];
}

function getCityGeoCoordinates(feature) {
  const geometry = feature?.geometry;
  if (geometry?.type === "Point" && Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2) {
    const lon = Number(geometry.coordinates[0]);
    const lat = Number(geometry.coordinates[1]);
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      return [normalizeLongitude(lon), clamp(lat, -89.999, 89.999)];
    }
  }
  if (geometry?.type === "MultiPoint" && Array.isArray(geometry.coordinates) && geometry.coordinates.length) {
    const points = geometry.coordinates
      .map((coords) => [Number(coords?.[0]), Number(coords?.[1])])
      .filter((coords) => coords.every((value) => Number.isFinite(value)));
    if (points.length) {
      const sums = points.reduce((acc, coords) => [acc[0] + coords[0], acc[1] + coords[1]], [0, 0]);
      return [
        normalizeLongitude(sums[0] / points.length),
        clamp(sums[1] / points.length, -89.999, 89.999),
      ];
    }
  }
  return getFeatureGeoCentroid(feature);
}

function buildCityLabelPlacementCandidates(entry, {
  textWidthPx,
  fontPx,
  scale,
  offsetPx,
  verticalOffsetPx,
}) {
  if (!entry?.screenPoint || !entry?.anchor) return [];
  const widthPx = Math.max(1, Number(textWidthPx || 0));
  const heightPx = fontPx + 4;
  const halfHeightPx = heightPx * 0.5;
  const placements = {
    right: {
      textAlign: "left",
      dxPx: offsetPx,
      dyPx: 0,
      boxX: entry.screenPoint[0] + offsetPx - 2,
      boxY: entry.screenPoint[1] - halfHeightPx,
    },
    left: {
      textAlign: "right",
      dxPx: -offsetPx,
      dyPx: 0,
      boxX: entry.screenPoint[0] - offsetPx - widthPx - 4,
      boxY: entry.screenPoint[1] - halfHeightPx,
    },
    "upper-right": {
      textAlign: "left",
      dxPx: offsetPx,
      dyPx: -verticalOffsetPx,
      boxX: entry.screenPoint[0] + offsetPx - 2,
      boxY: entry.screenPoint[1] - verticalOffsetPx - halfHeightPx,
    },
    "lower-right": {
      textAlign: "left",
      dxPx: offsetPx,
      dyPx: verticalOffsetPx,
      boxX: entry.screenPoint[0] + offsetPx - 2,
      boxY: entry.screenPoint[1] + verticalOffsetPx - halfHeightPx,
    },
    "upper-left": {
      textAlign: "right",
      dxPx: -offsetPx,
      dyPx: -verticalOffsetPx,
      boxX: entry.screenPoint[0] - offsetPx - widthPx - 4,
      boxY: entry.screenPoint[1] - verticalOffsetPx - halfHeightPx,
    },
    "lower-left": {
      textAlign: "right",
      dxPx: -offsetPx,
      dyPx: verticalOffsetPx,
      boxX: entry.screenPoint[0] - offsetPx - widthPx - 4,
      boxY: entry.screenPoint[1] + verticalOffsetPx - halfHeightPx,
    },
  };
  return CITY_LABEL_PLACEMENT_ORDER
    .map((placementId) => {
      const candidate = placements[placementId];
      if (!candidate) return null;
      return {
        id: placementId,
        textAlign: candidate.textAlign,
        drawX: entry.anchor[0] + (candidate.dxPx / scale),
        drawY: entry.anchor[1] + (candidate.dyPx / scale),
        box: {
          x: candidate.boxX,
          y: candidate.boxY,
          w: widthPx + 6,
          h: heightPx,
        },
      };
    })
    .filter(Boolean);
}

function isCityAnchorInViewport(anchor, { padding = 24, transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity } = {}) {
  const screenPoint = getCityScreenPoint(anchor, transform);
  if (!screenPoint) return false;
  return (
    screenPoint[0] >= -padding
    && screenPoint[0] <= runtimeState.width + padding
    && screenPoint[1] >= -padding
    && screenPoint[1] <= runtimeState.height + padding
  );
}

function getCityCapitalDescriptor(entry) {
  if (entry?.feature?.properties?.__city_is_country_capital) {
    return runtimeState.currentLanguage === "zh" ? "\u9996\u90fd" : "Capital";
  }
  if (entry?.feature?.properties?.__city_is_admin_capital) {
    return runtimeState.currentLanguage === "zh" ? "\u884c\u653f\u4e2d\u5fc3" : "Administrative capital";
  }
  return "";
}

function getCityTooltipText(entry) {
  const fullLabel = getCityDisplayLabel(entry?.feature);
  const props = entry?.feature?.properties || {};
  const hostFeatureId = String(props.__city_host_feature_id || "").trim();
  const hostFeature = hostFeatureId ? runtimeState.landIndex?.get(hostFeatureId) : null;
  const countryCode = String(
    (hostFeature ? getDisplayOwnerCode(hostFeature, hostFeatureId) : "")
      || props.__city_scenario_tag
      || props.__city_country_code
      || props.country_code
      || ""
  ).trim().toUpperCase();
  const rawCountryName =
    getScenarioCountryDisplayName(runtimeState.scenarioCountriesByTag?.[countryCode])
    || runtimeState.countryNames?.[countryCode]
    || countryCode;
  const countryDisplayName = rawCountryName ? (t(rawCountryName, "geo") || rawCountryName) : "";
  const lines = [fullLabel];
  const capitalDescriptor = getCityCapitalDescriptor(entry);
  if (capitalDescriptor) {
    lines.push(capitalDescriptor);
  }
  if (countryDisplayName) {
    lines.push(countryCode ? `${countryDisplayName} (${countryCode})` : countryDisplayName);
  }
  return renderTooltipText({ lines: lines.filter(Boolean) });
}

function getCityLabelBackgroundColor(entry) {
  const props = entry?.feature?.properties || entry?.properties || {};
  const hostFeatureId = String(props.__city_host_feature_id || props.host_feature_id || "").trim();
  const hostFeature = hostFeatureId ? runtimeState.landIndex?.get(hostFeatureId) : null;
  if (hostFeature && hostFeatureId) {
    return (
      getSafeCanvasColor(runtimeState.colors?.[hostFeatureId], null) ||
      getSafeCanvasColor(getResolvedFeatureColor(hostFeature, hostFeatureId), null)
    );
  }

  const countryCode = String(
    props.__city_scenario_tag ||
    props.__city_country_code ||
    props.country_code ||
    props.cntr_code ||
    ""
  ).trim().toUpperCase();
  if (!countryCode) return null;
  return (
    getSafeCanvasColor(runtimeState.sovereignBaseColors?.[countryCode], null) ||
    getSafeCanvasColor(runtimeState.countryBaseColors?.[countryCode], null)
  );
}

function getCityBackgroundPaintInfo(entry) {
  const backgroundColor = getCityLabelBackgroundColor(entry) || "";
  const luminance = getCanvasColorRelativeLuminance(backgroundColor);
  const usesLightContrast = Number.isFinite(luminance) && luminance < CITY_LABEL_DARK_BACKGROUND_LUMINANCE;
  return {
    backgroundColor,
    luminance,
    usesLightContrast,
  };
}

function getCityLabelRenderStyle(entry, config = {}) {
  const tokens = getCityMarkerThemeTokens(config);
  const backgroundInfo = getCityBackgroundPaintInfo(entry);
  const { backgroundColor, luminance } = backgroundInfo;
  const usesLightLabel = backgroundInfo.usesLightContrast;

  if (!usesLightLabel) {
    return {
      fillStyle: entry?.isCapital ? tokens.capitalLabel : tokens.label,
      strokeStyle: "rgba(255, 252, 245, 0.22)",
      shadowColor: tokens.shadow,
      strokeWidthFactor: 0.1,
      shadowBlurFactor: 0.12,
      shadowOffsetYFactor: 0.04,
      usesLightLabel: false,
      backgroundColor: backgroundColor || "",
      luminance,
    };
  }

  return {
    fillStyle: entry?.isCapital ? "rgba(248, 245, 238, 0.98)" : "rgba(243, 240, 233, 0.96)",
    strokeStyle: "rgba(12, 16, 24, 0.46)",
    shadowColor: "rgba(6, 9, 14, 0.34)",
    strokeWidthFactor: 0.18,
    shadowBlurFactor: 0.18,
    shadowOffsetYFactor: 0.05,
    usesLightLabel: true,
    backgroundColor: backgroundColor || "",
    luminance,
  };
}

function getCityMarkerRenderStyle(entry, config = {}) {
  const baseTokens = getCityMarkerThemeTokens(config);
  const backgroundInfo = getCityBackgroundPaintInfo(entry);
  const { backgroundColor, luminance, usesLightContrast } = backgroundInfo;
  if (!usesLightContrast || !backgroundColor) {
    return {
      tokens: baseTokens,
      backgroundColor,
      luminance,
      usesLightContrast: false,
      adapted: false,
    };
  }

  const adaptiveBase = computeUrbanAdaptivePaintFromHostColor(backgroundColor, {
    adaptiveStrength: 1,
    toneBias: 0.08,
  });
  const adaptiveStroke = adaptiveBase?.strokeColor || mixCanvasColors(backgroundColor, "#fff8ef", 0.78) || baseTokens.stroke;
  return {
    tokens: {
      ...baseTokens,
      rimDark: mixCanvasColors(baseTokens.rimDark, adaptiveStroke, 0.44) || baseTokens.rimDark,
      stroke: mixCanvasColors(baseTokens.stroke, adaptiveStroke, 0.54) || baseTokens.stroke,
      highlight: mixCanvasColors(baseTokens.highlight, "#ffffff", 0.14) || baseTokens.highlight,
      specular: mixCanvasColors(baseTokens.specular, "#ffffff", 0.1) || baseTokens.specular,
      halo: mixCanvasColors(baseTokens.halo, adaptiveStroke, 0.16) || baseTokens.halo,
    },
    backgroundColor,
    luminance,
    usesLightContrast: true,
    adapted: true,
  };
}

function getCityVisualCapitalState(entry, config = {}) {
  return !!entry?.isCapital && config.showCapitalOverlay !== false;
}

function getHoveredCityEntryFromEvent(event) {
  return getCityPointsRenderOwner().getHoveredCityEntryFromEvent(event);
}

function isCityEntryEligibleForLandHit(entry, hit) {
  if (!entry || hit?.targetType !== "land") {
    return false;
  }
  const hostFeatureId = String(
    entry?.feature?.properties?.__city_host_feature_id
    || entry?.feature?.properties?.host_feature_id
    || ""
  ).trim();
  return !!hostFeatureId && hostFeatureId === String(hit?.id || "").trim();
}

function getHoveredCityTooltipEntry(event, hit) {
  return getCityPointsRenderOwner().getHoveredCityTooltipEntry(event, hit);
}

function listVisibleFacilityHoverEntries() {
  return [
    ...(Array.isArray(visibleFacilityHoverEntriesByFamily.airport) ? visibleFacilityHoverEntriesByFamily.airport : []),
    ...(Array.isArray(visibleFacilityHoverEntriesByFamily.port) ? visibleFacilityHoverEntriesByFamily.port : []),
    ...(Array.isArray(visibleFacilityHoverEntriesByFamily.rail) ? visibleFacilityHoverEntriesByFamily.rail : []),
  ];
}

function normalizeFacilityEntryPackId(value) {
  return String(value || "global").trim().toLowerCase() || "global";
}

function getFacilityEntryHitPriority(entry) {
  return normalizeFacilityEntryPackId(entry?.packId) === "global" ? 0 : 1;
}

function buildFacilityEntryKey(entry) {
  const familyId = String(entry?.familyId || "").trim().toLowerCase();
  const packId = normalizeFacilityEntryPackId(entry?.packId);
  const stableId = String(entry?.stableId || "").trim();
  if (!familyId || !stableId) return "";
  return `${familyId}:${packId}:${stableId}`;
}

function buildFacilityEntrySemanticKey(entry) {
  const familyId = String(entry?.familyId || "").trim().toLowerCase();
  if (!familyId) return "";
  const stableId = String(entry?.stableId || entry?.properties?.stable_key || "").trim();
  if (stableId) return `${familyId}:stable:${stableId}`;
  const id = String(entry?.id || entry?.properties?.id || entry?.properties?.facility_id || "").trim();
  if (id) return `${familyId}:id:${id}`;
  const coordinates = Array.isArray(entry?.coordinates)
    ? entry.coordinates
    : Array.isArray(entry?.properties?.__coordinates)
      ? entry.properties.__coordinates
      : Array.isArray(entry?.projectedPoint)
        ? entry.projectedPoint
        : [];
  const [x, y] = coordinates;
  if (Number.isFinite(Number(x)) && Number.isFinite(Number(y))) {
    return `${familyId}:coord:${Number(x).toFixed(5)}:${Number(y).toFixed(5)}`;
  }
  return "";
}

function dedupeFacilityHoverEntriesBySemanticKey(entries = []) {
  const dedupedByKey = new Map();
  (Array.isArray(entries) ? entries : []).forEach((entry, index) => {
    const semanticKey = buildFacilityEntrySemanticKey(entry) || `entry:${index}`;
    const existing = dedupedByKey.get(semanticKey);
    if (!existing || getFacilityEntryHitPriority(entry) >= getFacilityEntryHitPriority(existing)) {
      dedupedByKey.set(semanticKey, entry);
    }
  });
  return Array.from(dedupedByKey.values());
}

function clearFacilityHoverEntries(familyId = "") {
  const normalizedFamilyId = String(familyId || "").trim().toLowerCase();
  if (normalizedFamilyId && Object.prototype.hasOwnProperty.call(visibleFacilityHoverEntriesByFamily, normalizedFamilyId)) {
    visibleFacilityHoverEntriesByFamily[normalizedFamilyId] = [];
  }
  if (normalizedFamilyId && getMapHoverInteractionOwner().getHoveredFacilityEntry()?.familyId === normalizedFamilyId) {
    getMapHoverInteractionOwner().setHoveredFacilityEntry(null);
    getMapHoverInteractionOwner().setHoverOverlayDirty(true);
  }
  if (normalizedFamilyId && selectedFacilityEntry?.familyId === normalizedFamilyId) {
    selectedFacilityEntry = null;
    applyFacilityInfoCardState(null);
    getMapHoverInteractionOwner().setHoverOverlayDirty(true);
  }
}

function setVisibleFacilityHoverEntries(familyId = "", entries = [], { append = false, packId = "" } = {}) {
  const normalizedFamilyId = String(familyId || "").trim().toLowerCase();
  if (!normalizedFamilyId || !Object.prototype.hasOwnProperty.call(visibleFacilityHoverEntriesByFamily, normalizedFamilyId)) {
    return;
  }
  const normalizedPackId = normalizeFacilityEntryPackId(packId || entries?.[0]?.packId);
  const nextEntries = (Array.isArray(entries) ? entries : []).map((entry) => ({
    ...entry,
    packId: normalizeFacilityEntryPackId(entry?.packId || normalizedPackId),
  }));
  if (append) {
    visibleFacilityHoverEntriesByFamily[normalizedFamilyId] = [
      ...visibleFacilityHoverEntriesByFamily[normalizedFamilyId].filter((entry) => normalizeFacilityEntryPackId(entry?.packId) !== normalizedPackId),
      ...nextEntries,
    ];
  } else {
    visibleFacilityHoverEntriesByFamily[normalizedFamilyId] = nextEntries;
  }
  visibleFacilityHoverEntriesByFamily[normalizedFamilyId] = dedupeFacilityHoverEntriesBySemanticKey(
    visibleFacilityHoverEntriesByFamily[normalizedFamilyId],
  );
  const nextEntriesByKey = new Map(
    listVisibleFacilityHoverEntries()
      .map((entry) => [buildFacilityEntryKey(entry), entry])
      .filter(([key]) => !!key)
  );
  const hoveredKey = buildFacilityEntryKey(getMapHoverInteractionOwner().getHoveredFacilityEntry());
  const selectedKey = buildFacilityEntryKey(selectedFacilityEntry);
  if (hoveredKey) {
    const nextHoveredEntry = nextEntriesByKey.get(hoveredKey) || null;
    if (nextHoveredEntry) {
      getMapHoverInteractionOwner().setHoveredFacilityEntry(nextHoveredEntry);
      getMapHoverInteractionOwner().setHoverOverlayDirty(true);
    } else {
      getMapHoverInteractionOwner().setHoveredFacilityEntry(null);
      getMapHoverInteractionOwner().setHoverOverlayDirty(true);
    }
  }
  if (selectedKey) {
    const nextSelectedEntry = nextEntriesByKey.get(selectedKey) || null;
    if (nextSelectedEntry) {
      selectedFacilityEntry = nextSelectedEntry;
      applyFacilityInfoCardState(nextSelectedEntry);
      getMapHoverInteractionOwner().setHoverOverlayDirty(true);
    } else {
      selectedFacilityEntry = null;
      applyFacilityInfoCardState(null);
      getMapHoverInteractionOwner().setHoverOverlayDirty(true);
    }
  }
}

function getFacilityHoverRadiusPx(entry) {
  return Math.max(9, Math.min(18, Number(entry?.markerRadiusPx || 0) + 5));
}

function getHoveredFacilityEntryFromEvent(event) {
  const startedAt = nowMs();
  const eventType = String(event?.type || "hover").toLowerCase() === "mousemove" ? "hover" : String(event?.type || "unknown").toLowerCase();
  if (!rendererSurfaceHost.getMapSvg() || !globalThis.d3?.pointer) {
    recordInteractionDurationMetric("interactionHoverFacilityProbeDuration", nowMs() - startedAt, {
      eventType,
      entryCount: 0,
      hit: false,
      skipped: true,
    });
    return null;
  }
  const entries = listVisibleFacilityHoverEntries();
  if (!entries.length) {
    recordInteractionDurationMetric("interactionHoverFacilityProbeDuration", nowMs() - startedAt, {
      eventType,
      entryCount: 0,
      hit: false,
      skipped: true,
    });
    return null;
  }
  const [sx, sy] = globalThis.d3.pointer(event, rendererSurfaceHost.getMapSvg());
  if (![sx, sy].every(Number.isFinite)) {
    recordInteractionDurationMetric("interactionHoverFacilityProbeDuration", nowMs() - startedAt, {
      eventType,
      entryCount: entries.length,
      hit: false,
      skipped: true,
    });
    return null;
  }
  let bestEntry = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestPriority = -1;
  entries.forEach((entry) => {
    const [entryX, entryY] = entry?.screenPoint || [];
    if (![entryX, entryY].every(Number.isFinite)) {
      return;
    }
    const threshold = Math.max(6, Number(entry?.hoverRadiusPx || 0));
    const distance = Math.hypot(sx - entryX, sy - entryY);
    const hitPriority = getFacilityEntryHitPriority(entry);
    if (distance <= threshold && (hitPriority > bestPriority || (hitPriority === bestPriority && distance < bestDistance))) {
      bestDistance = distance;
      bestPriority = hitPriority;
      bestEntry = entry;
    }
  });
  recordInteractionDurationMetric("interactionHoverFacilityProbeDuration", nowMs() - startedAt, {
    eventType,
    entryCount: entries.length,
    hit: !!bestEntry,
  });
  return bestEntry;
}

function applyFacilityInfoCardState(entry, anchor = null) {
  if (!facilityInfoCard || !facilityInfoCardTitle || !facilityInfoCardBody || !facilityInfoCardZoomBtn || !facilityInfoCardMoreBtn) {
    return;
  }
  if (!entry) {
    selectedFacilityEntry = null;
    facilityInfoCardExpanded = false;
    facilityInfoCardAnchor = null;
    getFacilitySurfaceOwner().applyFacilityInfoCardState(null, {
      expanded: false,
      previousAnchor: null,
      dom: {
        facilityInfoCard,
        facilityInfoCardBody,
        facilityInfoCardMoreBtn,
        facilityInfoCardTitle,
        facilityInfoCardZoomBtn,
      },
      entryKey: "",
    });
    return;
  }
  selectedFacilityEntry = entry;
  facilityInfoCardAnchor = anchor && Number.isFinite(Number(anchor?.x)) && Number.isFinite(Number(anchor?.y))
    ? { x: Number(anchor.x), y: Number(anchor.y) }
    : (facilityInfoCardAnchor || { x: 24, y: 24 });
  const cardState = getFacilitySurfaceOwner().applyFacilityInfoCardState(entry, {
    anchor,
    expanded: facilityInfoCardExpanded,
    previousAnchor: facilityInfoCardAnchor,
    dom: {
      facilityInfoCard,
      facilityInfoCardBody,
      facilityInfoCardMoreBtn,
      facilityInfoCardTitle,
      facilityInfoCardZoomBtn,
    },
    entryKey: buildFacilityEntryKey(entry),
  });
  facilityInfoCardAnchor = cardState.anchor;
}

function setMapInteractionCursor(nextCursor = "") {
  getMapHoverInteractionOwner().setMapInteractionCursor(nextCursor);
}

function getActiveFacilityHighlightEntry() {
  const hoveredFacilityEntry = getMapHoverInteractionOwner().getHoveredFacilityEntry();
  return hoveredFacilityEntry || selectedFacilityEntry || null;
}

function zoomToFacilityEntry(entry, { targetScale = 4.8, durationMs = 420 } = {}) {
  if (!entry?.coordinates || !rendererSurfaceHost.getProjection() || !rendererSurfaceHost.getInteractionRect() || !rendererSurfaceHost.getZoomBehavior() || !globalThis.d3) {
    return;
  }
  const projected = rendererSurfaceHost.getProjection()(entry.coordinates);
  if (!Array.isArray(projected) || !projected.every(Number.isFinite)) {
    return;
  }
  const nextScale = Math.max(MIN_ZOOM_SCALE, Math.min(MAX_ZOOM_SCALE, Number(targetScale) || 4.8));
  const nextTransform = globalThis.d3.zoomIdentity
    .translate(runtimeState.width / 2, runtimeState.height / 2)
    .scale(nextScale)
    .translate(-projected[0], -projected[1]);
  globalThis.d3
    .select(rendererSurfaceHost.getInteractionRect().node())
    .transition()
    .duration(durationMs)
    .call(rendererSurfaceHost.getZoomBehavior().transform, nextTransform);
}

function syncFacilityInfoCardVisibility() {
  if (!selectedFacilityEntry) {
    return;
  }
  if (isFacilityDetailsSurfaceActive(selectedFacilityEntry.familyId)) {
    return;
  }
  getMapHoverInteractionOwner().setHoveredFacilityEntry(null);
  applyFacilityInfoCardState(null);
  getMapHoverInteractionOwner().setHoverOverlayDirty(true);
  renderHoverOverlayIfNeeded({ eventType: "facility-card-visibility" });
  queueTooltipUpdate({ visible: false });
  setMapInteractionCursor("");
}

function isFacilityDetailsSurfaceActive(familyId = "") {
  const transportPanel = document.getElementById("appearancePanelTransport");
  if (
    transportPanel instanceof HTMLElement
    && transportPanel.hidden !== true
    && !transportPanel.classList.contains("hidden")
  ) {
    const normalizedFamilyId = String(familyId || "").trim().toLowerCase();
    if (normalizedFamilyId === "airport") {
      const airportCard = document.getElementById("transportAirportCard");
      if (airportCard instanceof HTMLDetailsElement && airportCard.open) {
        return true;
      }
    }
    if (normalizedFamilyId === "port") {
      const portCard = document.getElementById("transportPortCard");
      if (portCard instanceof HTMLDetailsElement && portCard.open) {
        return true;
      }
    }
  }
  const workbenchOverlay = document.getElementById("transportWorkbenchOverlay");
  return workbenchOverlay instanceof HTMLElement && !workbenchOverlay.classList.contains("hidden");
}

function allowsFacilityUnderlyingSelection() {
  const transportConfig = normalizeTransportOverviewStyleConfig(runtimeState.styleConfig?.transportOverview || {});
  return !!transportConfig.allowFacilityUnderlyingMapSelection;
}

function shouldBlockUnderlyingSelectionForFacility(entry) {
  return shouldBlockUnderlyingMapSelectionForFacility(entry, allowsFacilityUnderlyingSelection());
}


function getCityLayerRenderState(k, { interactive = false, cacheHoverEntries = false } = {}) {
  return getCityPointsRenderOwner().getCityLayerRenderState(k, { interactive, cacheHoverEntries });
}

function drawCityMarkersFromEntries(markerEntries, { config, scale, opacity, interactive = false } = {}) {
  return getCityPointsRenderOwner().drawCityMarkersFromEntries(markerEntries, {
    config,
    scale,
    opacity,
    interactive,
  });
}

function drawCityPointsLayer(k, { interactive = false } = {}) {
  return getCityPointsRenderOwner().drawCityPointsLayer(k, { interactive });
}

function getStrategicValuesResourceFeatureCount(payload) {
  const features = Array.isArray(payload?.resourcePoints?.features)
    ? payload.resourcePoints.features
    : (
      Array.isArray(payload?.resource_points?.features)
        ? payload.resource_points.features
        : []
    );
  return features.length;
}

function getStrategicResourceMarkerLayerState(k) {
  const payload = runtimeState.scenarioStrategicValuesData;
  const featureCount = getStrategicValuesResourceFeatureCount(payload);
  if (!runtimeState.showStrategicResourceMarkers) {
    return { skipped: true, reason: "hidden", featureCount, markerEntries: [] };
  }
  if (!payload || typeof payload !== "object") {
    return { skipped: true, reason: "no-data", featureCount: 0, markerEntries: [] };
  }
  if (!rendererSurfaceHost.getProjection()) {
    return { skipped: true, reason: "no-projection", featureCount, markerEntries: [] };
  }
  if (!isScenarioStrategicValuesUsable(payload)) {
    const reason = Array.isArray(payload?.diagnostics?.errors) && payload.diagnostics.errors.length > 0
      ? "diagnostic-errors"
      : "no-data";
    return { skipped: true, reason, featureCount, markerEntries: [] };
  }

  const transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity;
  const scale = Math.max(0.0001, Number(transform?.k || k || 1));
  const entries = buildStrategicResourceMarkerEntries(payload, {
    showResourceMarkers: true,
    zoom: scale,
  }).map((entry) => {
    const anchor = rendererSurfaceHost.getProjection()([entry.lon, entry.lat]);
    if (!Array.isArray(anchor) || !anchor.every(Number.isFinite)) return null;
    return { ...entry, anchor };
  }).filter(Boolean);

  if (!entries.length) {
    return { skipped: true, reason: "culled", featureCount, markerEntries: [], scale };
  }
  return { skipped: false, reason: "", featureCount, markerEntries: entries, scale };
}

function drawStrategicResourceMarkerSymbol(entry, scale) {
  const radius = Math.max(1.6 / scale, Number(entry.radiusPx || 4) / scale);
  const strokeWidth = Math.max(0.75 / scale, 1.35 / scale);
  const fillColor = STRATEGIC_RESOURCE_MARKER_COLORS[entry.resource] || "#475569";
  rendererSurfaceHost.getContext().beginPath();
  rendererSurfaceHost.getContext().arc(entry.anchor[0], entry.anchor[1], radius, 0, Math.PI * 2);
  rendererSurfaceHost.getContext().fillStyle = fillColor;
  rendererSurfaceHost.getContext().fill();
  rendererSurfaceHost.getContext().lineWidth = strokeWidth;
  rendererSurfaceHost.getContext().strokeStyle = STRATEGIC_RESOURCE_MARKER_STROKE;
  rendererSurfaceHost.getContext().stroke();
}

function drawStrategicResourceMarkersLayer(k, { interactive = false } = {}) {
  const startedAt = nowMs();
  const renderState = getStrategicResourceMarkerLayerState(k);
  if (renderState.skipped) {
    collectContextMetric("drawStrategicResourceMarkersLayer", nowMs() - startedAt, {
      featureCount: renderState.featureCount,
      visibleFeatureCount: 0,
      interactive: !!interactive,
      skipped: true,
      reason: renderState.reason,
    });
    return;
  }

  rendererSurfaceHost.getContext().save();
  rendererSurfaceHost.getContext().globalCompositeOperation = "source-over";
  rendererSurfaceHost.getContext().globalAlpha = interactive ? 0.82 : 0.9;
  renderState.markerEntries.forEach((entry) => drawStrategicResourceMarkerSymbol(entry, renderState.scale));
  rendererSurfaceHost.getContext().restore();
  collectContextMetric("drawStrategicResourceMarkersLayer", nowMs() - startedAt, {
    featureCount: renderState.featureCount,
    visibleFeatureCount: renderState.markerEntries.length,
    interactive: !!interactive,
    skipped: false,
  });
}

function getTextureStyleConfig() {
  if (!runtimeState.styleConfig || typeof runtimeState.styleConfig !== "object") {
    runtimeState.styleConfig = {};
  }
  runtimeState.styleConfig.texture = normalizeTextureStyleConfig(runtimeState.styleConfig.texture);
  return runtimeState.styleConfig.texture;
}

function requestTextureRerender() {
  requestRendererRender("texture-rerender", {
    fallback: () => {
      if (rendererSurfaceHost.getContext()) {
        drawCanvas();
      }
    },
  });
}

function getDayNightStyleConfig() {
  return getDayNightRuntimeOwner().getDayNightStyleConfig();
}

function normalizeLongitude(value) {
  let normalized = Number.isFinite(Number(value)) ? Number(value) : 0;
  while (normalized > 180) normalized -= 360;
  while (normalized <= -180) normalized += 360;
  return normalized;
}

function getDayNightSignatureClockToken(...args) {
  return getDayNightRuntimeOwner().getDayNightSignatureClockToken(...args);
}

function buildNightHemisphereFeature(...args) {
  return getDayNightRuntimeOwner().buildNightHemisphereFeature(...args);
}

function getFeatureGeoCentroid(feature) {
  if (!feature || !globalThis.d3?.geoCentroid) return null;
  const cached = urbanGeoCentroidCache.get(feature);
  if (cached) return cached;
  const centroid = globalThis.d3.geoCentroid(feature);
  const longitude = Number(centroid?.[0]);
  const latitude = Number(centroid?.[1]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    return null;
  }
  const normalized = [normalizeLongitude(longitude), clamp(latitude, -89.999, 89.999)];
  urbanGeoCentroidCache.set(feature, normalized);
  return normalized;
}

function toRgbaString(...args) {
  return getCityLightsRenderOwner().toRgbaString(...args);
}

function getSignedHashUnit(...args) {
  return getCityLightsRenderOwner().getSignedHashUnit(...args);
}

function drawNightLightsLayer(k, config, solarState) {
  return getCityLightsRenderOwner().drawNightLightsLayer(k, config, solarState);
}

function syncDayNightClockTimer() {
  return getDayNightRuntimeOwner().syncDayNightClockTimer();
}

function drawBackgroundPass() {
  return getPoliticalBackgroundRenderOwner().drawBackgroundPass();
}
function getCachedPoliticalPassStaticSignature(signature) {
  const parts = String(signature || "").split("::");
  return parts.length > 1 ? parts.slice(1).join("::") : "";
}

function getFeatureScreenBounds(feature, {
  featureId = null,
  transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity,
  allowCompute = true,
  padding = 0,
} = {}) {
  const bounds = getProjectedFeatureBounds(feature, { featureId, allowCompute });
  if (!bounds) return null;
  const normalizedTransform = cloneZoomTransform(transform);
  const rawMinX = bounds.minX * normalizedTransform.k + normalizedTransform.x;
  const rawMinY = bounds.minY * normalizedTransform.k + normalizedTransform.y;
  const rawMaxX = bounds.maxX * normalizedTransform.k + normalizedTransform.x;
  const rawMaxY = bounds.maxY * normalizedTransform.k + normalizedTransform.y;
  if (![rawMinX, rawMinY, rawMaxX, rawMaxY].every(Number.isFinite)) {
    return null;
  }
  const normalizedPadding = Math.max(0, Number(padding || 0));
  const minX = rawMinX - normalizedPadding;
  const minY = rawMinY - normalizedPadding;
  const maxX = rawMaxX + normalizedPadding;
  const maxY = rawMaxY + normalizedPadding;
  return {
    x: minX,
    y: minY,
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

function getScreenBoundsFromProjectedBounds(projectedBounds, {
  transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity,
  padding = 0,
} = {}) {
  if (!projectedBounds) return null;
  const normalizedTransform = cloneZoomTransform(transform);
  const rawMinX = Number(projectedBounds.minX) * normalizedTransform.k + normalizedTransform.x;
  const rawMinY = Number(projectedBounds.minY) * normalizedTransform.k + normalizedTransform.y;
  const rawMaxX = Number(projectedBounds.maxX) * normalizedTransform.k + normalizedTransform.x;
  const rawMaxY = Number(projectedBounds.maxY) * normalizedTransform.k + normalizedTransform.y;
  if (![rawMinX, rawMinY, rawMaxX, rawMaxY].every(Number.isFinite)) {
    return null;
  }
  const normalizedPadding = Math.max(0, Number(padding || 0));
  const minX = rawMinX - normalizedPadding;
  const minY = rawMinY - normalizedPadding;
  const maxX = rawMaxX + normalizedPadding;
  const maxY = rawMaxY + normalizedPadding;
  return {
    x: minX,
    y: minY,
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

function rectsIntersect(a, b) {
  if (!a || !b) return false;
  return !(
    a.maxX < b.minX ||
    a.maxY < b.minY ||
    a.minX > b.maxX ||
    a.minY > b.maxY
  );
}

function screenRectToProjectedRect(rect, transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity) {
  if (!rect) return null;
  const normalizedTransform = cloneZoomTransform(transform);
  const minX = (Number(rect.minX ?? rect.x ?? 0) - normalizedTransform.x) / normalizedTransform.k;
  const minY = (Number(rect.minY ?? rect.y ?? 0) - normalizedTransform.y) / normalizedTransform.k;
  const maxX = (Number(rect.maxX ?? ((rect.x || 0) + (rect.width || 0))) - normalizedTransform.x) / normalizedTransform.k;
  const maxY = (Number(rect.maxY ?? ((rect.y || 0) + (rect.height || 0))) - normalizedTransform.y) / normalizedTransform.k;
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
    return null;
  }
  return {
    minX: Math.min(minX, maxX),
    minY: Math.min(minY, maxY),
    maxX: Math.max(minX, maxX),
    maxY: Math.max(minY, maxY),
  };
}

function projectedBoundsIntersectScreenRects(projectedBounds, screenRects, {
  transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity,
  padding = 0,
} = {}) {
  if (!Array.isArray(screenRects) || !screenRects.length) return true;
  const screenBounds = getScreenBoundsFromProjectedBounds(projectedBounds, { transform, padding });
  if (!screenBounds) return false;
  return screenRects.some((rect) => rectsIntersect(rect, screenBounds));
}

function collectLandSpatialItemsForProjectedRects(projectedRects = [], { maxCandidates = Infinity } = {}) {
  return collectSpatialItemsForProjectedRects({
    grid: runtimeState.spatialGrid,
    gridMeta: runtimeState.spatialGridMeta,
    items: runtimeState.spatialItems,
    projectedRects,
    maxCandidates,
  });
}

function drawPoliticalBackgroundFills(options = {}) {
  return getPoliticalBackgroundRenderOwner().drawPoliticalBackgroundFills(options);
}

function drawPoliticalBackgroundFillsForEntries(entries = [], options = {}) {
  return getPoliticalBackgroundRenderOwner().drawPoliticalBackgroundFillsForEntries(entries, options);
}
function buildPoliticalRasterWorkerPacket(options = {}) {
  return getPoliticalPartialRepaintOwner().buildPoliticalRasterWorkerPacket(options);
}
function drawPoliticalWorkerBitmapResult(result, workerIdentity) {
  return getPoliticalPartialRepaintOwner().drawPoliticalWorkerBitmapResult(result, workerIdentity);
}
function drawPoliticalFeature(feature, index, options = {}) {
  return getPoliticalPartialRepaintOwner().drawPoliticalFeature(feature, index, options);
}
function tryPartialPoliticalPassRepaint(transform, nextSignature, timings) {
  return getPoliticalPartialRepaintOwner().tryPartialPoliticalPassRepaint(transform, nextSignature, timings);
}
function recordPoliticalRasterWorkerSnapshot() {
  return getPoliticalPartialRepaintOwner().recordPoliticalRasterWorkerSnapshot();
}
function resolvePoliticalPassIdentity(k) {
  return getPoliticalPartialRepaintOwner().resolvePoliticalPassIdentity(k);
}
function resolvePoliticalPassViewport(identity) {
  return getPoliticalPartialRepaintOwner().resolvePoliticalPassViewport(identity);
}
function publishPoliticalPassDiagnostics({ identity, viewport }) {
  return getPoliticalPartialRepaintOwner().publishPoliticalPassDiagnostics({ identity, viewport });
}
function drawPoliticalPassBackground({ identity, viewport }) {
  return drawPoliticalBackgroundFills({
    transform: identity.transform,
    visibleItems: viewport.visibleItems,
    screenRects: viewport.screenRects,
    returnSummary: true,
  });
}

function buildPoliticalPassWorkerPacket({ identity, viewport }) {
  return getPoliticalPartialRepaintOwner().buildPoliticalRasterWorkerPacket({
    visibleItems: viewport.visibleItems,
    transform: identity.transform,
    canvasWidth: identity.canvasWidth,
    canvasHeight: identity.canvasHeight,
  });
}
function requestPoliticalPassWorker({ identity, packetState }) {
  return getPoliticalPartialRepaintOwner().requestPoliticalPassWorker({ identity, packetState });
}
function drawPoliticalFineFeatureLoop({ k, identity, viewport }) {
  return getPoliticalPartialRepaintOwner().drawPoliticalFineFeatureLoop({ k, identity, viewport });
}
function drawPoliticalPass(k) {
  return getPoliticalPassOrchestratorOwner().drawPoliticalPass(k);
}

function getContextScenarioLayerCacheEntry(layerName) {
  const cache = getRenderPassCacheState();
  const resolvedLayerName = String(layerName || "default").trim() || "default";
  const existing = cache.contextScenarioLayerCache?.[resolvedLayerName];
  if (existing && typeof existing === "object") {
    return existing;
  }
  const next = {
    canvas: null,
    signature: "",
    referenceTransform: null,
    renderedCount: 0,
  };
  cache.contextScenarioLayerCache[resolvedLayerName] = next;
  return next;
}

function ensureContextScenarioLayerCanvas(layerName) {
  const layerEntry = getContextScenarioLayerCacheEntry(layerName);
  if (!layerEntry.canvas) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    layerEntry.canvas = canvas;
  }
  const layout = getRenderPassLayout("contextScenario");
  if (layerEntry.canvas.width !== layout.pixelWidth || layerEntry.canvas.height !== layout.pixelHeight) {
    layerEntry.canvas.width = layout.pixelWidth;
    layerEntry.canvas.height = layout.pixelHeight;
    layerEntry.signature = "";
    layerEntry.referenceTransform = null;
    layerEntry.renderedCount = 0;
  }
  return layerEntry.canvas;
}

function drawCachedContextScenarioLayer(layerName, currentTransform) {
  const layerEntry = getContextScenarioLayerCacheEntry(layerName);
  const layerCanvas = layerEntry.canvas;
  const referenceTransform = layerEntry.referenceTransform
    ? cloneZoomTransform(layerEntry.referenceTransform)
    : null;
  if (!layerCanvas || !referenceTransform) return false;
  const layout = getRenderPassLayout("contextScenario");
  if (layerCanvas.width !== layout.pixelWidth || layerCanvas.height !== layout.pixelHeight) {
    return false;
  }
  rendererSurfaceHost.getContext().save();
  rendererSurfaceHost.getContext().setTransform(1, 0, 0, 1, 0, 0);
  if (areZoomTransformsEquivalent(referenceTransform, currentTransform)) {
    rendererSurfaceHost.getContext().drawImage(layerCanvas, 0, 0);
    rendererSurfaceHost.getContext().restore();
    return true;
  }
  const current = cloneZoomTransform(currentTransform);
  const scaleRatio = current.k / Math.max(referenceTransform.k, 0.0001);
  const dx = current.x - (referenceTransform.x * scaleRatio);
  const dy = current.y - (referenceTransform.y * scaleRatio);
  const offsetX = Number(layout?.offsetX || 0);
  const offsetY = Number(layout?.offsetY || 0);
  rendererSurfaceHost.getContext().translate(
    (dx + offsetX * (1 - scaleRatio)) * runtimeState.dpr,
    (dy + offsetY * (1 - scaleRatio)) * runtimeState.dpr,
  );
  rendererSurfaceHost.getContext().scale(scaleRatio, scaleRatio);
  rendererSurfaceHost.getContext().drawImage(layerCanvas, 0, 0);
  rendererSurfaceHost.getContext().restore();
  return true;
}

function drawScenarioWaterFillLayer(k, { waterFeatures = [] } = {}) {
  const startedAt = nowMs();
  let renderedWaterCount = 0;
  if (!waterFeatures.length) {
    collectContextMetric("drawScenarioWaterFillLayer", nowMs() - startedAt, {
      featureCount: 0,
      renderedCount: 0,
      skipped: true,
      reason: "no-features",
    });
    return 0;
  }
  waterFeatures.forEach((feature, index) => {
    const id = getFeatureId(feature) || `water-${index}`;
    if (!isWaterRegionRenderable(feature)) return;
    const defaultStyle = getWaterRegionDefaultStyle(feature);
    const fillOpacity = defaultStyle.opacity;
    if (!(fillOpacity > 0)) return;
    const parts = collectSafeWaterRegionGeometryParts(feature);
    if (!parts.length) return;
    const visibleParts = [];
    parts.forEach((part) => {
      if (!projectedGeoBoundsInScreen(computeProjectedGeoBounds(part))) return;
      visibleParts.push(part);
    });
    if (!visibleParts.length) return;
    rendererSurfaceHost.getContext().save();
    rendererSurfaceHost.getContext().globalAlpha = fillOpacity;
    rendererSurfaceHost.getContext().fillStyle = getWaterRegionColor(id, feature);
    const waterPath = visibleParts.length === parts.length
      ? getScenarioWaterFeaturePath(feature, parts)
      : null;
    let didFill = false;
    if (waterPath) {
      rendererSurfaceHost.getContext().fill(waterPath);
      didFill = true;
    } else if (globalThis.Path2D) {
      visibleParts.forEach((part) => {
        const partPath = getScenarioWaterPartPath(part);
        if (partPath) {
          rendererSurfaceHost.getContext().fill(partPath);
          didFill = true;
        } else if (rendererSurfaceHost.getPathCanvas()) {
          rendererSurfaceHost.getContext().beginPath();
          rendererSurfaceHost.getPathCanvas()(part);
          rendererSurfaceHost.getContext().fill();
          didFill = true;
        }
      });
    } else if (rendererSurfaceHost.getPathCanvas()) {
      rendererSurfaceHost.getContext().beginPath();
      visibleParts.forEach((part) => {
        if (rendererSurfaceHost.getPathCanvas()) rendererSurfaceHost.getPathCanvas()(part);
      });
      rendererSurfaceHost.getContext().fill();
      didFill = true;
    }
    rendererSurfaceHost.getContext().restore();
    if (didFill) renderedWaterCount += 1;
  });
  collectContextMetric("drawScenarioWaterFillLayer", nowMs() - startedAt, {
    featureCount: waterFeatures.length,
    renderedCount: renderedWaterCount,
    skipped: renderedWaterCount === 0,
    reason: renderedWaterCount === 0 ? "culled" : "",
  });
  return renderedWaterCount;
}

function drawScenarioAtlantropaLandLikeOverlayLayer(k) {
  const startedAt = nowMs();
  const buckets = getEffectiveAtlantropaFeatures();
  const overlayFeatures = [
    ...buckets.land,
    ...buckets.shoal,
    ...buckets.relief,
  ];
  let renderedCount = 0;
  if (!overlayFeatures.length) {
    collectContextMetric("drawScenarioAtlantropaLandLikeOverlayLayer", nowMs() - startedAt, {
      featureCount: 0,
      renderedCount: 0,
      skipped: true,
      reason: "no-features",
    });
    return 0;
  }
  const transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity;
  const [canvasWidth, canvasHeight] = getLogicalCanvasDimensions();
  overlayFeatures.forEach((feature, index) => {
    const id = getFeatureId(feature) || `atlantropa-overlay-${index}`;
    if (!id) return;
    if (shouldExcludePoliticalVisualFeature(feature, id)) return;
    if (shouldSkipFeature(feature, canvasWidth, canvasHeight)) return;
    if (!pathBoundsInScreen(feature)) return;
    const fillColor =
      getSafeCanvasColor(runtimeState.colors?.[id], null)
      || getSafeCanvasColor(getResolvedFeatureColor(feature, id), null)
      || LAND_FILL_COLOR;
    const cachedPath = getPoliticalFeaturePathEntry(feature, {
      featureId: id,
      transform,
      allowBuild: true,
      countBuild: false,
    })?.path || null;
    rendererSurfaceHost.getContext().save();
    rendererSurfaceHost.getContext().globalAlpha = 1;
    rendererSurfaceHost.getContext().fillStyle = fillColor;
    if (cachedPath) {
      rendererSurfaceHost.getContext().fill(cachedPath);
    } else {
      rendererSurfaceHost.getContext().beginPath();
      rendererSurfaceHost.getPathCanvas()(feature);
      rendererSurfaceHost.getContext().fill();
    }
    rendererSurfaceHost.getContext().restore();
    renderedCount += 1;
  });
  collectContextMetric("drawScenarioAtlantropaLandLikeOverlayLayer", nowMs() - startedAt, {
    featureCount: overlayFeatures.length,
    renderedCount,
    skipped: renderedCount === 0,
    reason: renderedCount === 0 ? "culled" : "",
  });
  return renderedCount;
}

function renderScenarioWaterFillLayerToCache(currentTransform, waterFeatures) {
  const layerEntry = getContextScenarioLayerCacheEntry("water");
  const layerCanvas = ensureContextScenarioLayerCanvas("water");
  const layerContext = layerCanvas.getContext("2d");
  if (!layerContext) {
    layerEntry.signature = "";
    layerEntry.referenceTransform = null;
    layerEntry.renderedCount = 0;
    return 0;
  }
  const layout = getRenderPassLayout("contextScenario");
  let renderedWaterCount = 0;
  withRenderTarget(layerContext, () => {
    const layerK = prepareTargetContext(layerContext, currentTransform, layout);
    renderedWaterCount = drawScenarioWaterFillLayer(layerK, { waterFeatures });
  });
  layerEntry.signature = getScenarioWaterVisualRevisionToken();
  layerEntry.referenceTransform = cloneZoomTransform(currentTransform);
  layerEntry.renderedCount = renderedWaterCount;
  return renderedWaterCount;
}

function getScenarioWaterPartPath(part) {
  if (!part || typeof part !== "object" || !globalThis.Path2D || typeof rendererSurfaceHost.getPathSvg() !== "function") {
    return null;
  }
  if (scenarioWaterPartPathCache.has(part)) {
    return scenarioWaterPartPathCache.get(part) || null;
  }
  let path = null;
  try {
    const pathString = rendererSurfaceHost.getPathSvg()(part);
    path = pathString ? new globalThis.Path2D(pathString) : null;
  } catch (_error) {
    path = null;
  }
  scenarioWaterPartPathCache.set(part, path);
  return path;
}

function getScenarioWaterFeaturePath(feature, parts) {
  if (!feature || typeof feature !== "object" || !globalThis.Path2D) {
    return null;
  }
  if (scenarioWaterFeaturePathCache.has(feature)) {
    return scenarioWaterFeaturePathCache.get(feature) || null;
  }
  const combinedPath = new globalThis.Path2D();
  let added = false;
  (Array.isArray(parts) ? parts : []).forEach((part) => {
    const partPath = getScenarioWaterPartPath(part);
    if (!partPath || typeof combinedPath.addPath !== "function") return;
    combinedPath.addPath(partPath);
    added = true;
  });
  const path = added ? combinedPath : null;
  scenarioWaterFeaturePathCache.set(feature, path);
  return path;
}

function drawScenarioWaterHighlightLayer(k) {
  const highlightIds = new Set([
    String(runtimeState.selectedWaterRegionId || "").trim(),
  ].filter(Boolean));
  let highlightedCount = 0;
  highlightIds.forEach((id) => {
    const feature = runtimeState.waterRegionsById?.get(id);
    if (!feature) return;
    if (!isWaterRegionEnabled(feature)) return;
    const parts = collectSafeWaterRegionGeometryParts(feature);
    if (!parts.length) return;
    const isMacroOcean = isMacroOceanWaterRegion(feature);
    rendererSurfaceHost.getContext().beginPath();
    let visiblePartCount = 0;
    parts.forEach((part) => {
      if (!projectedGeoBoundsInScreen(computeProjectedGeoBounds(part))) return;
      if (!rendererSurfaceHost.getPathCanvas()) return;
      rendererSurfaceHost.getPathCanvas()(part);
      visiblePartCount += 1;
    });
    if (!visiblePartCount) return;
    rendererSurfaceHost.getContext().save();
    rendererSurfaceHost.getContext().globalAlpha = isMacroOcean ? 0.92 : 1;
    rendererSurfaceHost.getContext().strokeStyle = "#f1c40f";
    rendererSurfaceHost.getContext().lineWidth = (isMacroOcean ? 1.15 : 0.9) / Math.max(0.0001, k);
    rendererSurfaceHost.getContext().lineJoin = "round";
    rendererSurfaceHost.getContext().stroke();
    rendererSurfaceHost.getContext().restore();
    highlightedCount += 1;
  });
  return highlightedCount;
}

function drawScenarioSpecialRegionOverlaysLayer(k, { specialFeatures = [] } = {}) {
  const startedAt = nowMs();
  let renderedSpecialCount = 0;
  if (!specialFeatures.length) {
    collectContextMetric("drawScenarioSpecialRegionOverlaysLayer", nowMs() - startedAt, {
      featureCount: 0,
      renderedCount: 0,
      skipped: true,
      reason: "no-features",
    });
    return 0;
  }
  specialFeatures.forEach((feature, index) => {
    const id = getFeatureId(feature) || `special-${index}`;
    const renderAsBase = isBaseGeographyScenarioFeature(feature);
    if (!isSpecialRegionEnabled(feature)) return;
    if (!pathBoundsInScreen(feature)) return;
    rendererSurfaceHost.getContext().beginPath();
    rendererSurfaceHost.getPathCanvas()(feature);
    rendererSurfaceHost.getContext().save();
    rendererSurfaceHost.getContext().globalAlpha = renderAsBase
      ? Math.max(getSpecialRegionOpacity(feature, id), 0.94)
      : getSpecialRegionOpacity(feature, id);
    rendererSurfaceHost.getContext().fillStyle = getSpecialRegionColor(id, feature);
    rendererSurfaceHost.getContext().fill();
    rendererSurfaceHost.getContext().restore();
    rendererSurfaceHost.getContext().strokeStyle = getSpecialRegionStrokeColor(feature);
    rendererSurfaceHost.getContext().lineWidth = 1 / Math.max(0.0001, k);
    rendererSurfaceHost.getContext().lineJoin = "round";
    rendererSurfaceHost.getContext().stroke();
    renderedSpecialCount += 1;
  });
  collectContextMetric("drawScenarioSpecialRegionOverlaysLayer", nowMs() - startedAt, {
    featureCount: specialFeatures.length,
    renderedCount: renderedSpecialCount,
    skipped: renderedSpecialCount === 0,
    reason: renderedSpecialCount === 0 ? "culled" : "",
  });
  return renderedSpecialCount;
}

function renderScenarioSpecialRegionOverlaysLayerToCache(currentTransform, specialFeatures) {
  const layerEntry = getContextScenarioLayerCacheEntry("special");
  const layerCanvas = ensureContextScenarioLayerCanvas("special");
  const layerContext = layerCanvas.getContext("2d");
  if (!layerContext) {
    layerEntry.signature = "";
    layerEntry.referenceTransform = null;
    layerEntry.renderedCount = 0;
    return 0;
  }
  const layout = getRenderPassLayout("contextScenario");
  let renderedSpecialCount = 0;
  withRenderTarget(layerContext, () => {
    const layerK = prepareTargetContext(layerContext, currentTransform, layout);
    renderedSpecialCount = drawScenarioSpecialRegionOverlaysLayer(layerK, { specialFeatures });
  });
  layerEntry.signature = getScenarioSpecialVisualRevisionToken();
  layerEntry.referenceTransform = cloneZoomTransform(currentTransform);
  layerEntry.renderedCount = renderedSpecialCount;
  return renderedSpecialCount;
}

function drawScenarioRegionOverlaysPass(k) {
  const startedAt = nowMs();
  const showWater = !!runtimeState.showWaterRegions;
  const showSpecial = !!runtimeState.showScenarioSpecialRegions;
  const showAtlantropaLandLikeOverlay = showWater && isScenarioAtlantropaVisible();
  const waterFeatures = showWater ? getEffectiveWaterRegionFeatures() : [];
  const specialFeatures = showSpecial ? getEffectiveSpecialRegionFeatures() : [];
  let renderedWaterCount = 0;
  let renderedAtlantropaLandLikeCount = 0;
  let renderedSpecialCount = 0;
  let highlightedWaterCount = 0;
  let waterCacheMode = "disabled";
  let waterCacheStrategyMode = "disabled";
  let waterCacheStrategySource = "disabled";
  let waterCoverageAlgo = "disabled";
  let waterVisibleCoverageRatio = 0;
  let waterPrevRenderedCount = Math.max(0, Number(lastScenarioWaterRenderedCount || 0));
  let specialCacheMode = "disabled";
  // water/special overlay 这里走的是显式策略选择，不是错误恢复链：
  // adaptive 会按覆盖率和复杂度在 reuse/redraw/direct 间切换；
  // direct 表示“直接画到当前 pass，不维护复用缓存”，不要把它当失败兜底继续叠 fallback。
  if (!showWater && !showSpecial && !showAtlantropaLandLikeOverlay) {
    collectContextMetric("contextScenarioLayerWater", 0, {
      featureCount: 0,
      renderedCount: 0,
      skipped: true,
      reason: "disabled",
      cacheMode: "disabled",
      signature: getScenarioWaterVisualRevisionToken(),
    });
    collectContextMetric("contextScenarioLayerSpecial", 0, {
      featureCount: 0,
      renderedCount: 0,
      skipped: true,
      reason: "disabled",
      cacheMode: "disabled",
      signature: getScenarioSpecialVisualRevisionToken(),
    });
    collectContextMetric("drawScenarioRegionOverlaysPass", nowMs() - startedAt, {
      featureCount: 0,
      waterFeatureCount: 0,
      specialFeatureCount: 0,
      renderedWaterCount: 0,
      renderedSpecialCount: 0,
      highlightedWaterCount: 0,
      waterVisibleCoverageRatio,
      waterPrevRenderedCount,
      waterCoverageAlgo,
      waterCacheMode,
      waterCacheStrategyMode,
      waterCacheStrategySource,
      skipped: true,
      reason: "disabled",
    });
    return;
  }

  if (showWater) {
    const forcedWaterCache = getForcedScenarioWaterCacheMode();
    waterCacheStrategyMode = forcedWaterCache.mode;
    waterCacheStrategySource = forcedWaterCache.source;
    const signals = getScenarioWaterCacheComplexitySignals(waterFeatures);
    waterVisibleCoverageRatio = signals.visibleCoverageRatio;
    waterPrevRenderedCount = signals.previousRenderedCount;
    waterCoverageAlgo = signals.waterCoverageAlgo || "grid";

    const currentTransform = cloneZoomTransform(runtimeState.zoomTransform || globalThis.d3?.zoomIdentity);
    const waterLayerEntry = getContextScenarioLayerCacheEntry("water");
    const waterVisualRevision = getScenarioWaterVisualRevisionToken();
    const canReuseWaterLayer = (
      shouldEnableContextScenarioTransformReuse()
      && waterLayerEntry.signature === waterVisualRevision
      && !!waterLayerEntry.canvas
      && !!waterLayerEntry.referenceTransform
    );

    const useAdaptiveDirect = forcedWaterCache.mode === "adaptive" && shouldUseDirectScenarioWaterDraw(signals);
    const strategy = useAdaptiveDirect ? "adaptive-direct" : forcedWaterCache.mode;

    if (strategy === "direct" || strategy === "adaptive-direct") {
      waterCacheMode = strategy;
      collectContextMetric("contextScenarioLayerCacheMiss", 0, {
        layer: "water",
        reason: strategy,
        signatureChanged: waterLayerEntry.signature !== waterVisualRevision,
      });
      renderedWaterCount = drawScenarioWaterFillLayer(k, { waterFeatures });
    } else if (strategy === "reuse") {
      if (canReuseWaterLayer && drawCachedContextScenarioLayer("water", currentTransform)) {
        waterCacheMode = "reuse";
        collectContextMetric("contextScenarioLayerCacheHit", 0, {
          layer: "water",
          renderedCount: Number(waterLayerEntry.renderedCount || 0),
        });
        renderedWaterCount = Number(waterLayerEntry.renderedCount || 0);
      } else {
        waterCacheMode = "redraw";
        collectContextMetric("contextScenarioLayerCacheMiss", 0, {
          layer: "water",
          reason: waterLayerEntry.signature === waterVisualRevision ? "transform" : "signature",
          signatureChanged: waterLayerEntry.signature !== waterVisualRevision,
        });
        renderedWaterCount = renderScenarioWaterFillLayerToCache(currentTransform, waterFeatures);
        if (!drawCachedContextScenarioLayer("water", currentTransform)) {
          waterCacheMode = "direct";
          renderedWaterCount = drawScenarioWaterFillLayer(k, { waterFeatures });
        }
      }
    } else if (strategy === "redraw") {
      waterCacheMode = "redraw";
      collectContextMetric("contextScenarioLayerCacheMiss", 0, {
        layer: "water",
        reason: "forced-redraw",
        signatureChanged: waterLayerEntry.signature !== waterVisualRevision,
      });
      renderedWaterCount = renderScenarioWaterFillLayerToCache(currentTransform, waterFeatures);
      if (!drawCachedContextScenarioLayer("water", currentTransform)) {
        waterCacheMode = "direct";
        renderedWaterCount = drawScenarioWaterFillLayer(k, { waterFeatures });
      }
    } else {
      if (canReuseWaterLayer && drawCachedContextScenarioLayer("water", currentTransform)) {
        waterCacheMode = "reuse";
        collectContextMetric("contextScenarioLayerCacheHit", 0, {
          layer: "water",
          renderedCount: Number(waterLayerEntry.renderedCount || 0),
        });
        renderedWaterCount = Number(waterLayerEntry.renderedCount || 0);
      } else {
        waterCacheMode = "redraw";
        collectContextMetric("contextScenarioLayerCacheMiss", 0, {
          layer: "water",
          reason: waterLayerEntry.signature === waterVisualRevision ? "transform" : "signature",
          signatureChanged: waterLayerEntry.signature !== waterVisualRevision,
        });
        renderedWaterCount = renderScenarioWaterFillLayerToCache(currentTransform, waterFeatures);
        if (!drawCachedContextScenarioLayer("water", currentTransform)) {
          waterCacheMode = "direct";
          renderedWaterCount = drawScenarioWaterFillLayer(k, { waterFeatures });
        }
      }
    }
    highlightedWaterCount = drawScenarioWaterHighlightLayer(k);
    if (showAtlantropaLandLikeOverlay) {
      renderedAtlantropaLandLikeCount = drawScenarioAtlantropaLandLikeOverlayLayer(k);
    }
    lastScenarioWaterRenderedCount = Math.max(0, Number(renderedWaterCount || 0));
    collectContextMetric("contextScenarioLayerWater", 0, {
      featureCount: waterFeatures.length,
      renderedCount: renderedWaterCount,
      highlightedCount: highlightedWaterCount,
      cacheMode: waterCacheMode,
      signature: waterVisualRevision,
    });
  } else {
    collectContextMetric("contextScenarioLayerWater", 0, {
      featureCount: 0,
      renderedCount: 0,
      skipped: true,
      reason: "disabled",
      cacheMode: "disabled",
      signature: getScenarioWaterVisualRevisionToken(),
    });
  }

  if (showSpecial) {
    const currentTransform = cloneZoomTransform(runtimeState.zoomTransform || globalThis.d3?.zoomIdentity);
    const specialLayerEntry = getContextScenarioLayerCacheEntry("special");
    const specialVisualRevision = getScenarioSpecialVisualRevisionToken();
    const canReuseSpecialLayer = (
      shouldEnableContextScenarioTransformReuse()
      && specialLayerEntry.signature === specialVisualRevision
      && !!specialLayerEntry.canvas
      && !!specialLayerEntry.referenceTransform
    );
    if (canReuseSpecialLayer && drawCachedContextScenarioLayer("special", currentTransform)) {
      specialCacheMode = "reuse";
      renderedSpecialCount = Number(specialLayerEntry.renderedCount || 0);
      collectContextMetric("contextScenarioLayerCacheHit", 0, {
        layer: "special",
        renderedCount: renderedSpecialCount,
      });
    } else {
      specialCacheMode = "redraw";
      collectContextMetric("contextScenarioLayerCacheMiss", 0, {
        layer: "special",
        reason: specialLayerEntry.signature === specialVisualRevision ? "transform" : "signature",
        signatureChanged: specialLayerEntry.signature !== specialVisualRevision,
      });
      renderedSpecialCount = renderScenarioSpecialRegionOverlaysLayerToCache(currentTransform, specialFeatures);
      if (!drawCachedContextScenarioLayer("special", currentTransform)) {
        specialCacheMode = "direct";
        renderedSpecialCount = drawScenarioSpecialRegionOverlaysLayer(k, { specialFeatures });
      }
    }
    collectContextMetric("contextScenarioLayerSpecial", 0, {
      featureCount: specialFeatures.length,
      renderedCount: renderedSpecialCount,
      cacheMode: specialCacheMode,
      signature: getScenarioSpecialVisualRevisionToken(),
    });
  } else {
    collectContextMetric("contextScenarioLayerSpecial", 0, {
      featureCount: 0,
      renderedCount: 0,
      skipped: true,
      reason: "disabled",
      cacheMode: "disabled",
      signature: getScenarioSpecialVisualRevisionToken(),
    });
  }
  collectContextMetric("drawScenarioRegionOverlaysPass", nowMs() - startedAt, {
    featureCount: waterFeatures.length + specialFeatures.length,
    waterFeatureCount: waterFeatures.length,
    atlantropaLandLikeRenderedCount: renderedAtlantropaLandLikeCount,
    specialFeatureCount: specialFeatures.length,
    renderedWaterCount,
    renderedSpecialCount,
    highlightedWaterCount,
    waterVisibleCoverageRatio,
    waterPrevRenderedCount,
    waterCoverageAlgo,
    waterCacheMode,
    waterCacheStrategyMode,
    waterCacheStrategySource,
    specialCacheMode,
    skipped: false,
  });
}

function drawHgoPreviewPass() {
  return getHgoRuntimePreviewRenderOwner().drawPreviewPass();
}

function drawEffectsPass(k, options = undefined) {
  return getVisualEffectsPassOwner().drawEffectsPass(k, options);
}

function drawLineEffectsPass(k, options = undefined) {
  return getVisualEffectsPassOwner().drawLineEffectsPass(k, options);
}

function drawTextureLabelEffectsPass(k) {
  return getVisualEffectsPassOwner().drawTextureLabelEffectsPass(k);
}

function drawContextBasePass(k, options = undefined) {
  return getContextPassOrchestratorOwner().drawContextBasePass(k, options);
}

function drawContextMarkersPass(k, options = undefined) {
  return getContextPassOrchestratorOwner().drawContextMarkersPass(k, options);
}

function drawContextScenarioPass(k, options = undefined) {
  return getContextPassOrchestratorOwner().drawContextScenarioPass(k, options);
}

function drawDayNightPass(k, options = undefined) {
  return getVisualEffectsPassOwner().drawDayNightPass(k, options);
}

function drawBordersPass(k, { interactive = false } = {}) {
  if (isHgoRuntimePreviewReady()) {
    recordRenderPerfMetric("drawBordersPass", 0, {
      interactive: !!interactive,
      skipped: true,
      reason: "hgo-runtime-preview",
    });
    return;
  }
  if (!runtimeState.landData?.features?.length) return;
  drawHierarchicalBorders(k, { interactive });
}

function getBlankFeatureLabel(feature, id) {
  const props = feature?.properties || {};
  return String(props.name || props.label || id || "").trim();
}

function drawBlankFeatureLabelsPass(k, { interactive = false } = {}) {
  if (interactive) return;
  if (normalizeMapSemanticMode(runtimeState.mapSemanticMode) !== "blank") return;
  if (String(runtimeState.activeScenarioId || "") !== "blank_base") return;
  if (!runtimeState.showBlankFeatureLabels) return;
  if (!runtimeState.landData?.features?.length || !rendererSurfaceHost.getContext() || typeof rendererSurfaceHost.getPathCanvas()?.centroid !== "function") return;
  const visibleItems = collectVisibleLandSpatialItems();
  const items = Array.isArray(visibleItems) && visibleItems.length
    ? visibleItems
    : runtimeState.landData.features.map((feature, index) => ({
      feature,
      id: getFeatureId(feature) || `feature-${index}`,
    }));
  const maxLabels = Math.max(24, Math.min(140, Math.round(44 * Math.max(1, Number(k) || 1))));
  const step = Math.max(1, Math.ceil(items.length / maxLabels));
  const fontSize = Math.max(7, Math.min(12, 11 / Math.max(0.75, Number(k) || 1)));
  rendererSurfaceHost.getContext().save();
  rendererSurfaceHost.getContext().font = `${fontSize}px system-ui, sans-serif`;
  rendererSurfaceHost.getContext().textAlign = "center";
  rendererSurfaceHost.getContext().textBaseline = "middle";
  rendererSurfaceHost.getContext().lineWidth = Math.max(1.8 / Math.max(0.75, Number(k) || 1), 0.7);
  rendererSurfaceHost.getContext().strokeStyle = "rgba(248, 250, 252, 0.82)";
  rendererSurfaceHost.getContext().fillStyle = "rgba(31, 41, 55, 0.86)";
  for (let index = 0; index < items.length; index += step) {
    const item = items[index];
    const feature = item?.feature || item;
    const id = item?.id || getFeatureId(feature) || "";
    const label = getBlankFeatureLabel(feature, id);
    if (!label) continue;
    const centroid = rendererSurfaceHost.getPathCanvas().centroid(feature);
    if (!centroid || !Number.isFinite(centroid[0]) || !Number.isFinite(centroid[1])) continue;
    rendererSurfaceHost.getContext().strokeText(label, centroid[0], centroid[1]);
    rendererSurfaceHost.getContext().fillText(label, centroid[0], centroid[1]);
  }
  rendererSurfaceHost.getContext().restore();
}

function drawLabelsPass(k, { interactive = false } = {}) {
  if (isHgoRuntimePreviewReady()) {
    recordRenderPerfMetric("drawLabelsPass", 0, {
      interactive: !!interactive,
      skipped: true,
      reason: "hgo-runtime-preview",
    });
    return;
  }
  drawBlankFeatureLabelsPass(k, { interactive });
  return getCityPointsRenderOwner().drawLabelsPass(k, { interactive });
}

function renderPassToCache(passName, drawFn, transform, timings) {
  let passStart = 0;
  const hostResult = getRenderPassCacheHostOwner().prepareRenderPassHost({
    passName,
    transform,
    drawFn,
    onHostReady: () => {
      passStart = nowMs();
    },
  });
  if (hostResult?.skipped) return;
  getRenderPassCommitAccountingOwner().commitRenderPass({
    passName,
    transform,
    drawResult: hostResult.drawResult,
    timings,
    passStart,
    hostSummary: hostResult,
  });
}

function resetCanvasContext(targetContext, width, height) {
  if (!targetContext) return;
  targetContext.setTransform(1, 0, 0, 1, 0, 0);
  targetContext.clearRect(0, 0, width, height);
  targetContext.globalCompositeOperation = "source-over";
  targetContext.globalAlpha = 1;
  targetContext.shadowBlur = 0;
  targetContext.filter = "none";
}

function resetMainCanvas() {
  if (!rendererSurfaceHost.getContext()?.canvas) return;
  resetCanvasContext(rendererSurfaceHost.getContext(), rendererSurfaceHost.getContext().canvas.width, rendererSurfaceHost.getContext().canvas.height);
}

function areZoomTransformsEquivalent(a, b, epsilon = 0.01) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    Math.abs(Number(a.k || 1) - Number(b.k || 1)) <= epsilon
    && Math.abs(Number(a.x || 0) - Number(b.x || 0)) <= epsilon
    && Math.abs(Number(a.y || 0) - Number(b.y || 0)) <= epsilon
  );
}

function blitCompositeBufferToMain(bufferCanvas) {
  rendererSurfaceHost.getContext().setTransform(1, 0, 0, 1, 0, 0);
  rendererSurfaceHost.getContext().globalCompositeOperation = "source-over";
  rendererSurfaceHost.getContext().globalAlpha = 1;
  rendererSurfaceHost.getContext().shadowBlur = 0;
  rendererSurfaceHost.getContext().filter = "none";
  rendererSurfaceHost.getContext().globalCompositeOperation = "copy";
  rendererSurfaceHost.getContext().drawImage(bufferCanvas, 0, 0);
  rendererSurfaceHost.getContext().globalCompositeOperation = "source-over";
}

function composeCachedPasses(passNames, currentTransform = runtimeState.zoomTransform || globalThis.d3.zoomIdentity) {
  if (!rendererSurfaceHost.getContext()?.canvas) return false;
  const bufferCanvas = ensureCompositeBufferCanvas();
  const bufferContext = bufferCanvas.getContext("2d");
  if (!bufferContext) return false;
  resetCanvasContext(bufferContext, bufferCanvas.width, bufferCanvas.height);
  const result = composeRenderPassesToTarget(bufferContext, passNames, currentTransform, {
    requireAllPasses: true,
  });
  if (!result.ok) {
    const controller = getExactAfterSettleControllerState();
    const missingPassNames = Array.isArray(result.missingPassNames) && result.missingPassNames.length
      ? result.missingPassNames
      : (result.passName ? [result.passName] : []);
    recordRenderPerfMetric("compositeBufferMissingPass", 0, {
      reason: result.reason,
      passName: result.passName || "",
      missingPassNames: missingPassNames.join(","),
      controllerPhase: String(controller.phase || ""),
      deferExactAfterSettle: !!runtimeState.deferExactAfterSettle,
      activeScenarioId: String(runtimeState.activeScenarioId || ""),
    });
    return false;
  }
  blitCompositeBufferToMain(bufferCanvas);
  incrementPerfCounter("composites");
  return true;
}

function canDrawTransformedPass(passName, cache = getRenderPassCacheState(), { allowDirty = false } = {}) {
  if (cache.dirty?.[passName] && !allowDirty) return false;
  if (!cache.canvases?.[passName]) return false;
  return !!getPassReferenceTransform(passName);
}

function canBuildInteractionComposite(cache = getRenderPassCacheState()) {
  return INTERACTION_COMPOSITE_PASS_NAMES.every((passName) => canDrawTransformedPass(passName, cache));
}

function buildInteractionComposite(currentTransform, timings) {
  if (!rendererSurfaceHost.getContext()?.canvas || !canBuildInteractionComposite(getRenderPassCacheState())) return false;
  const cache = getRenderPassCacheState();
  const compositeCanvas = ensureInteractionCompositeCanvas();
  const compositeContext = compositeCanvas.getContext("2d");
  if (!compositeContext) return false;
  const startedAt = nowMs();
  compositeContext.setTransform(1, 0, 0, 1, 0, 0);
  compositeContext.clearRect(0, 0, compositeCanvas.width, compositeCanvas.height);
  composeRenderPassesToTarget(compositeContext, INTERACTION_COMPOSITE_PASS_NAMES, currentTransform);
  const identity = getVisibleFrameIdentity(currentTransform);
  cache.interactionComposite.referenceTransform = cloneZoomTransform(currentTransform);
  cache.interactionComposite.signature = getInteractionCompositeSignature(cache);
  cache.interactionComposite.valid = true;
  cache.interactionComposite.capturedAt = Date.now();
  cache.interactionComposite.reason = String(runtimeState.renderPhase || "interaction");
  cache.interactionComposite.rejectedReason = "";
  cache.interactionComposite.scenarioId = identity.scenarioId;
  cache.interactionComposite.sceneGeneration = identity.sceneGeneration;
  cache.interactionComposite.scenarioDataGeneration = identity.scenarioDataGeneration;
  cache.interactionComposite.selectionVersion = identity.selectionVersion;
  cache.interactionComposite.contextFlagSignature = identity.contextFlagSignature;
  cache.interactionComposite.topologyRevision = identity.topologyRevision;
  cache.interactionComposite.dpr = identity.dpr;
  cache.interactionComposite.pixelWidth = identity.pixelWidth;
  cache.interactionComposite.pixelHeight = identity.pixelHeight;
  cache.interactionComposite.colorRevision = identity.colorRevision;
  cache.interactionComposite.transformBucket = identity.transformBucket;
  cache.interactionComposite.politicalDataStage = identity.politicalDataStage;
  cache.interactionComposite.fullPoliticalReady = identity.fullPoliticalReady;
  cache.interactionComposite.finePoliticalCacheReady = identity.finePoliticalCacheReady;
  incrementPerfCounter("interactionCompositeBuilds");
  recordPassTiming(timings, "interactionCompositeBuild", startedAt);
  recordRenderPerfMetric("interactionCompositeBuild", nowMs() - startedAt, {
    phase: String(runtimeState.renderPhase || ""),
    activeScenarioId: String(runtimeState.activeScenarioId || ""),
    passCount: INTERACTION_COMPOSITE_PASS_NAMES.length,
  });
  return true;
}

function drawInteractionComposite(
  currentTransform,
  { allowSelectionTopologyContinuity = false } = {},
) {
  const cache = getRenderPassCacheState();
  const composite = cache.interactionComposite || {};
  const reuseDecision = getInteractionCompositeReuseDecision(currentTransform, cache, {
    allowSelectionTopologyContinuity,
  });
  if (!reuseDecision.ok) {
    composite.rejectedReason = reuseDecision.reason || "unknown";
    if (reuseDecision.reason !== "invalid") {
      invalidateInteractionComposite(reuseDecision.reason);
    }
    return false;
  }
  const current = cloneZoomTransform(currentTransform);
  const reference = cloneZoomTransform(composite.referenceTransform);
  const scaleRatio = current.k / Math.max(reference.k, 0.0001);
  const dx = current.x - (reference.x * scaleRatio);
  const dy = current.y - (reference.y * scaleRatio);
  if (renderDiag.enabled) {
    renderDiag.transformedPasses = {
      ...(renderDiag.transformedPasses || {}),
      interactionComposite: {
        current,
        reference,
        scaleRatio,
        dx,
        dy,
        layout: null,
        phase: String(runtimeState.renderPhase || ""),
        dirty: false,
      },
    };
    publishRenderDiagnostics();
  }
  rendererSurfaceHost.getContext().save();
  rendererSurfaceHost.getContext().setTransform(1, 0, 0, 1, 0, 0);
  rendererSurfaceHost.getContext().translate(dx * runtimeState.dpr, dy * runtimeState.dpr);
  rendererSurfaceHost.getContext().scale(scaleRatio, scaleRatio);
  rendererSurfaceHost.getContext().drawImage(composite.canvas, 0, 0);
  rendererSurfaceHost.getContext().restore();
  incrementPerfCounter("interactionCompositeReuses");
  if (reuseDecision.mode === "continuity") {
    incrementPerfCounter("interactionCompositeContinuityReuses");
    recordRenderPerfMetric("interactionCompositeContinuityReuse", 0, {
      reasons: reuseDecision.reason,
      activeScenarioId: String(runtimeState.activeScenarioId || ""),
      phase: String(runtimeState.renderPhase || ""),
      cachedSelectionVersion: Number(composite.selectionVersion || 0),
      currentSelectionVersion: getRuntimeChunkSelectionVersion(),
      cachedTopologyRevision: Number(composite.topologyRevision || 0),
      currentTopologyRevision: Number(runtimeState.topologyRevision || 0),
    });
  }
  return true;
}

function drawTransformedPass(passName, currentTransform, referenceTransform = null) {
  return getCachedPassCompositorOwner().drawTransformedPass(
    passName,
    currentTransform,
    referenceTransform,
  );
}

function composeRenderPassesToTarget(
  targetContext,
  passNames,
  currentTransform = runtimeState.zoomTransform || globalThis.d3.zoomIdentity,
  options,
) {
  return getCachedPassCompositorOwner().composeRenderPassesToTarget(
    targetContext,
    passNames,
    currentTransform,
    options,
  );
}

function renderExportPassesToCanvas(passNames) {
  const width = Number(runtimeState.colorCanvas?.width || 0);
  const height = Number(runtimeState.colorCanvas?.height || 0);
  if (!width || !height) return null;
  getRenderPipelinePassesOwner().ensureIdleRenderPasses({});
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = width;
  exportCanvas.height = height;
  const exportContext = exportCanvas.getContext("2d");
  if (!exportContext) return null;
  exportContext.setTransform(1, 0, 0, 1, 0, 0);
  exportContext.clearRect(0, 0, width, height);
  composeRenderPassesToTarget(exportContext, passNames, runtimeState.zoomTransform || globalThis.d3.zoomIdentity);
  return exportCanvas;
}

function composeTransformedFrameToBuffer(
  currentTransform,
  transformedPasses,
  options,
) {
  return getTransformedFrameCompositorOwner().composeTransformedFrameToBuffer(
    currentTransform,
    transformedPasses,
    options,
  );
}

function drawTransformedFrameFromCaches(timings, options) {
  return getTransformedFrameCompositorOwner().drawTransformedFrameFromCaches(timings, options);
}

function promoteDeferredColorRenderToIdle() {
  const cache = getRenderPassCacheState();
  const reason = String(cache.reasons?.political || "");
  const currentPhase = runtimeState.renderPhase;
  const phaseEligible = currentPhase === RENDER_PHASE_SETTLING
    || (currentPhase === RENDER_PHASE_IDLE && runtimeState.deferExactAfterSettle);
  const promotionEligible = phaseEligible
    && !!cache.dirty?.political
    && (reason === "refresh-colors" || reason === "rebuild-colors");
  if (!promotionEligible) return false;
  const previousPhase = String(runtimeState.renderPhase || "");
  const previousDefer = !!runtimeState.deferExactAfterSettle;
  clearRenderPhaseTimer();
  cancelExactAfterSettleRefresh({ clearDefer: true });
  setRenderPhase(RENDER_PHASE_IDLE);
  recordRenderPerfMetric("promoteDeferredColorRenderToIdle", 0, {
    previousPhase,
    previousDefer,
    reason: String(getRenderPassCacheState().reasons?.political || ""),
  });
  return true;
}

function drawCanvas() {
  getDrawCanvasOrchestrationOwner().drawCanvasFrame();
}

function readRenderPerfMetricDuration(metricName, minSequence = 0) {
  const entry = runtimeState.renderPerfMetrics?.[metricName];
  const requiredMinSequence = Math.max(0, Number(minSequence || 0));
  if (requiredMinSequence > 0 && Math.max(0, Number(entry?.sequence || 0)) <= requiredMinSequence) {
    return 0;
  }
  return Math.max(0, Number(entry?.durationMs || 0));
}

function readRenderPerfMetricNumber(metricName, fieldName, minSequence = 0) {
  const entry = runtimeState.renderPerfMetrics?.[metricName];
  const requiredMinSequence = Math.max(0, Number(minSequence || 0));
  if (requiredMinSequence > 0 && Math.max(0, Number(entry?.sequence || 0)) <= requiredMinSequence) {
    return 0;
  }
  return Math.max(0, Number(entry?.[fieldName] || 0));
}

function readRenderPerfMetricString(metricName, fieldName, minSequence = 0) {
  const entry = runtimeState.renderPerfMetrics?.[metricName];
  const requiredMinSequence = Math.max(0, Number(minSequence || 0));
  if (requiredMinSequence > 0 && Math.max(0, Number(entry?.sequence || 0)) <= requiredMinSequence) {
    return "";
  }
  return String(entry?.[fieldName] || "");
}

function readRenderPerfMetricBoolean(metricName, fieldName, minSequence = 0) {
  const entry = runtimeState.renderPerfMetrics?.[metricName];
  const requiredMinSequence = Math.max(0, Number(minSequence || 0));
  if (requiredMinSequence > 0 && Math.max(0, Number(entry?.sequence || 0)) <= requiredMinSequence) {
    return false;
  }
  return entry?.[fieldName] === true;
}

function scheduleStagedHitCanvasWarmup(startedAt, token) {
  cancelDeferredWork(runtimeState.stagedHitCanvasHandle);
  runtimeState.stagedHitCanvasHandle = scheduleDeferredWork(() => {
    runtimeState.stagedHitCanvasHandle = null;
    if (token !== Number(runtimeState.stagedMapDataToken || 0)) return;
    if (runtimeState.renderPhase !== RENDER_PHASE_IDLE) {
      scheduleStagedHitCanvasWarmup(startedAt, token);
      return;
    }
    runtimeState.deferHitCanvasBuild = false;
    if (runtimeState.hitCanvasDirty) {
      recordDeferredFullHitCanvasMetric({
        reason: "staged-hit-canvas-warmup",
        keepReady: true,
      });
    }
    recordRenderPerfMetric("setMapDataHitCanvasReady", nowMs() - startedAt, {
      staged: true,
      activeScenarioId: String(runtimeState.activeScenarioId || ""),
    });
  }, {
    timeout: STAGED_HIT_CANVAS_TIMEOUT_MS,
  });
}

function scheduleStagedContextBaseWarmup(startedAt, token) {
  cancelDeferredWork(runtimeState.stagedContextBaseHandle);
  runtimeState.stagedContextBaseHandle = scheduleDeferredWork(() => {
    runtimeState.stagedContextBaseHandle = null;
    if (token !== Number(runtimeState.stagedMapDataToken || 0)) return;
    if (runtimeState.renderPhase !== RENDER_PHASE_IDLE) {
      scheduleStagedContextBaseWarmup(startedAt, token);
      return;
    }
    runtimeState.deferContextBasePass = false;
    invalidateRenderPasses(["contextBase", "contextMarkers"], "staged-context-base");
    clearRenderPassReferenceTransforms(["contextBase", "contextMarkers"]);
    render();
    recordRenderPerfMetric("setMapDataContextBaseReady", nowMs() - startedAt, {
      staged: true,
      activeScenarioId: String(runtimeState.activeScenarioId || ""),
    });
    scheduleStagedHitCanvasWarmup(startedAt, token);
  }, {
    timeout: STAGED_CONTEXT_BASE_TIMEOUT_MS,
  });
}

function beginStagedMapDataWarmup(startedAt) {
  clearStagedMapDataTasks();
  const token = Number(runtimeState.stagedMapDataToken || 0) + 1;
  runtimeState.stagedMapDataToken = token;
  const shouldStage = isHeavyScenarioStagedApplyCandidate();
  // staged warmup 的目标是先把可交互底座恢复出来，再把 contextBase / hit canvas 这类重活延后。
  // 这里如果改成立即同步完成，通常会直接把大场景 apply 又拉回启动关键路径。
  runtimeState.deferContextBasePass = shouldStage;
  runtimeState.deferHitCanvasBuild = shouldStage;
  if (shouldStage) {
    scheduleStagedContextBaseWarmup(startedAt, token);
  }
  return shouldStage;
}

function ensureSpecialZoneEditorState() {
  if (!runtimeState.manualSpecialZones || runtimeState.manualSpecialZones.type !== "FeatureCollection") {
    runtimeState.manualSpecialZones = { type: "FeatureCollection", features: [] };
  }
  if (!Array.isArray(runtimeState.manualSpecialZones.features)) {
    runtimeState.manualSpecialZones.features = [];
  }
  if (!runtimeState.specialZoneEditor || typeof runtimeState.specialZoneEditor !== "object") {
    runtimeState.specialZoneEditor = createDefaultSpecialZoneEditorState();
  }
  if (!Array.isArray(runtimeState.specialZoneEditor.vertices)) {
    runtimeState.specialZoneEditor.vertices = [];
  }
  if (!Number.isFinite(Number(runtimeState.specialZoneEditor.counter))) {
    runtimeState.specialZoneEditor.counter = 1;
  }
  if (!runtimeState.specialZoneEditor.zoneType) {
    runtimeState.specialZoneEditor.zoneType = DEFAULT_SPECIAL_ZONE_TYPE;
  }
  if (typeof runtimeState.specialZoneEditor.label !== "string") {
    runtimeState.specialZoneEditor.label = "";
  }
  if (runtimeState.specialZoneEditor.selectedId === undefined) {
    runtimeState.specialZoneEditor.selectedId = null;
  }
}

function getManualSpecialZoneFeatures() {
  ensureSpecialZoneEditorState();
  return runtimeState.manualSpecialZones.features || [];
}

function getEffectiveSpecialZonesFeatureCollection() {
  return getSpecialZoneLayersRenderOwner().getEffectiveSpecialZonesFeatureCollection();
}

function getSpecialZoneStyle(feature) {
  const layerStyle = feature?.properties?.__specialZoneLayerStyle;
  if (layerStyle && typeof layerStyle === "object") {
    return {
      fill: getSafeCanvasColor(layerStyle.fill, "#8b5cf6"),
      stroke: getSafeCanvasColor(layerStyle.stroke, "#6d28d9"),
      fillOpacity: clamp(Number(layerStyle.fillOpacity) || 0.32, 0, 1),
      strokeWidth: clamp(Number(layerStyle.strokeWidth) || 1.3, 0.4, 8),
      dash: getDashPattern(layerStyle.pattern === "outlineOnly" ? "solid" : "dashed", Number(layerStyle.strokeWidth) || 1.3),
      pattern: String(layerStyle.pattern || "solid"),
      patternOpacity: clamp(Number(layerStyle.patternOpacity) || 0.42, 0, 1),
      revision: Math.max(1, Math.round(Number(layerStyle.revision) || 1)),
    };
  }
  const config = runtimeState.styleConfig?.specialZones || {};
  const type = String(feature?.properties?.type || "").toLowerCase();
  const fillOpacity = clamp(Number.isFinite(Number(config.opacity)) ? Number(config.opacity) : 0.32, 0, 1);
  const strokeWidth = clamp(Number.isFinite(Number(config.strokeWidth)) ? Number(config.strokeWidth) : 1.3, 0.4, 4);
  const dashStyle = String(config.dashStyle || "dashed");
  const dash = getDashPattern(dashStyle, strokeWidth);

  if (type === "disputed") {
    return {
      fill: getSafeCanvasColor(config.disputedFill, "#f97316"),
      stroke: getSafeCanvasColor(config.disputedStroke, "#ea580c"),
      fillOpacity,
      strokeWidth,
      dash,
    };
  }
  if (type === "wasteland") {
    return {
      fill: getSafeCanvasColor(config.wastelandFill, "#dc2626"),
      stroke: getSafeCanvasColor(config.wastelandStroke, "#b91c1c"),
      fillOpacity,
      strokeWidth,
      dash,
    };
  }
  return {
    fill: getSafeCanvasColor(config.customFill, "#8b5cf6"),
    stroke: getSafeCanvasColor(config.customStroke, "#6d28d9"),
    fillOpacity,
    strokeWidth,
    dash,
  };
}

function updateSpecialZonesPaths() {
  getSpecialZoneLayersRenderOwner().updateSpecialZonesPaths();
}

function syncSpecialZonePatternTransformDuringZoom() {
  getSpecialZoneLayersRenderOwner().syncPatternTransformDuringZoom();
}

function renderSpecialZoneEditorOverlay() {
  getTransientOverlayRenderOwner().renderSpecialZoneEditorOverlay();
}

function updateStrategicOverlayUi() {
  if (typeof runtimeState.updateStrategicOverlayUIFn === "function") {
    runtimeState.updateStrategicOverlayUIFn();
  }
}

function ensureOperationGraphicsEditorState() {
  if (!runtimeState.operationGraphicsEditor || typeof runtimeState.operationGraphicsEditor !== "object") {
    runtimeState.operationGraphicsEditor = createDefaultOperationGraphicsEditorState();
  }
  if (typeof runtimeState.operationGraphicsEditor.mode !== "string") {
    runtimeState.operationGraphicsEditor.mode = runtimeState.operationGraphicsEditor.active ? "draw" : "idle";
  }
  runtimeState.operationGraphicsEditor.collection = "operationGraphics";
  if (!Array.isArray(runtimeState.operationGraphicsEditor.points)) {
    runtimeState.operationGraphicsEditor.points = [];
  }
  if (!OPERATION_GRAPHIC_STYLE_PRESETS.includes(String(runtimeState.operationGraphicsEditor.stylePreset || "").trim())) {
    runtimeState.operationGraphicsEditor.stylePreset = String(runtimeState.operationGraphicsEditor.kind || DEFAULT_OPERATION_GRAPHIC_KIND);
  }
  runtimeState.operationGraphicsEditor.stroke = String(runtimeState.operationGraphicsEditor.stroke || "").trim();
  runtimeState.operationGraphicsEditor.width = Math.max(0, Math.min(16, Number(runtimeState.operationGraphicsEditor.width) || 0));
  runtimeState.operationGraphicsEditor.opacity = Math.max(0, Math.min(1, Number(runtimeState.operationGraphicsEditor.opacity) || 1));
  runtimeState.operationGraphicsEditor.selectedVertexIndex = Math.max(-1, Number(runtimeState.operationGraphicsEditor.selectedVertexIndex) || -1);
}

function ensureOperationalLineEditorState() {
  if (!runtimeState.operationalLineEditor || typeof runtimeState.operationalLineEditor !== "object") {
    runtimeState.operationalLineEditor = createDefaultOperationalLineEditorState();
  }
  if (typeof runtimeState.operationalLineEditor.mode !== "string") {
    runtimeState.operationalLineEditor.mode = runtimeState.operationalLineEditor.active ? "draw" : "idle";
  }
  if (!Array.isArray(runtimeState.operationalLineEditor.points)) {
    runtimeState.operationalLineEditor.points = [];
  }
  if (!OPERATIONAL_LINE_STYLE_PRESETS.includes(String(runtimeState.operationalLineEditor.stylePreset || "").trim())) {
    runtimeState.operationalLineEditor.stylePreset = String(runtimeState.operationalLineEditor.kind || DEFAULT_OPERATIONAL_LINE_KIND);
  }
  runtimeState.operationalLineEditor.stroke = String(runtimeState.operationalLineEditor.stroke || "").trim();
  runtimeState.operationalLineEditor.width = Math.max(0, Math.min(16, Number(runtimeState.operationalLineEditor.width) || 0));
  runtimeState.operationalLineEditor.opacity = Math.max(0, Math.min(1, Number(runtimeState.operationalLineEditor.opacity) || 1));
  runtimeState.operationalLineEditor.selectedVertexIndex = Math.max(-1, Number(runtimeState.operationalLineEditor.selectedVertexIndex) || -1);
}

function assignUnitCounterEditorFromCounter(counter = null) {
  ensureUnitCounterEditorState();
  if (!counter) {
    return;
  }
  const normalizedCombatState = getNormalizedUnitCounterCombatState(counter);
  runtimeState.unitCounterEditor.renderer = String(counter.renderer || DEFAULT_UNIT_COUNTER_RENDERER);
  runtimeState.unitCounterEditor.label = String(counter.label || "");
  runtimeState.unitCounterEditor.sidc = String(counter.sidc || counter.symbolCode || "").trim().toUpperCase();
  runtimeState.unitCounterEditor.symbolCode = String(counter.symbolCode || counter.sidc || "").trim().toUpperCase();
  runtimeState.unitCounterEditor.nationTag = canonicalCountryCode(counter.nationTag || "");
  runtimeState.unitCounterEditor.nationSource = normalizeUnitCounterNationSource(counter.nationSource, "display");
  runtimeState.unitCounterEditor.presetId = String(counter.presetId || DEFAULT_UNIT_COUNTER_PRESET_ID).trim().toLowerCase() || DEFAULT_UNIT_COUNTER_PRESET_ID;
  runtimeState.unitCounterEditor.iconId = String(counter.iconId || getUnitCounterPresetById(counter.presetId).iconId || "").trim().toLowerCase();
  runtimeState.unitCounterEditor.unitType = String(counter.unitType || getUnitCounterPresetById(counter.presetId).unitType || "").trim().toUpperCase();
  runtimeState.unitCounterEditor.echelon = String(counter.echelon || "").trim().toLowerCase();
  runtimeState.unitCounterEditor.subLabel = String(counter.subLabel || "");
  runtimeState.unitCounterEditor.strengthText = String(counter.strengthText || "");
  runtimeState.unitCounterEditor.layoutAnchor = counter.layoutAnchor && typeof counter.layoutAnchor === "object"
    ? { ...counter.layoutAnchor }
    : { kind: "feature", key: String(counter.anchor?.featureId || ""), slotIndex: null };
  runtimeState.unitCounterEditor.attachment = counter.attachment && typeof counter.attachment === "object"
    ? { ...counter.attachment }
    : null;
  runtimeState.unitCounterEditor.baseFillColor = normalizedCombatState.baseFillColor;
  runtimeState.unitCounterEditor.organizationPct = normalizedCombatState.organizationPct;
  runtimeState.unitCounterEditor.equipmentPct = normalizedCombatState.equipmentPct;
  runtimeState.unitCounterEditor.statsPresetId = normalizedCombatState.statsPresetId;
  runtimeState.unitCounterEditor.statsSource = normalizedCombatState.statsSource;
  runtimeState.unitCounterEditor.size = normalizeUnitCounterSizeToken(counter.size || "medium");
}

function ensureUnitCounterEditorState() {
  if (!runtimeState.unitCounterEditor || typeof runtimeState.unitCounterEditor !== "object") {
    runtimeState.unitCounterEditor = createDefaultUnitCounterEditorState({
      renderer: DEFAULT_UNIT_COUNTER_RENDERER,
      presetId: DEFAULT_UNIT_COUNTER_PRESET_ID,
      organizationPct: DEFAULT_UNIT_COUNTER_ORGANIZATION_PCT,
      equipmentPct: DEFAULT_UNIT_COUNTER_EQUIPMENT_PCT,
    });
  }
  runtimeState.unitCounterEditor.sidc = String(
    runtimeState.unitCounterEditor.sidc
    || runtimeState.unitCounterEditor.symbolCode
    || ""
  ).trim();
  runtimeState.unitCounterEditor.symbolCode = String(
    runtimeState.unitCounterEditor.symbolCode
    || runtimeState.unitCounterEditor.sidc
    || ""
  ).trim();
  runtimeState.unitCounterEditor.nationTag = canonicalCountryCode(runtimeState.unitCounterEditor.nationTag || "");
  runtimeState.unitCounterEditor.nationSource = normalizeUnitCounterNationSource(runtimeState.unitCounterEditor.nationSource, "display");
  runtimeState.unitCounterEditor.presetId = String(runtimeState.unitCounterEditor.presetId || DEFAULT_UNIT_COUNTER_PRESET_ID).trim().toLowerCase() || DEFAULT_UNIT_COUNTER_PRESET_ID;
  runtimeState.unitCounterEditor.iconId = String(
    runtimeState.unitCounterEditor.iconId
    || getUnitCounterPresetById(runtimeState.unitCounterEditor.presetId).iconId
    || ""
  ).trim().toLowerCase();
  runtimeState.unitCounterEditor.unitType = String(
    runtimeState.unitCounterEditor.unitType
    || getUnitCounterPresetById(runtimeState.unitCounterEditor.presetId).unitType
    || ""
  ).trim().toUpperCase();
  runtimeState.unitCounterEditor.echelon = String(runtimeState.unitCounterEditor.echelon || "").trim().toLowerCase();
  runtimeState.unitCounterEditor.subLabel = String(runtimeState.unitCounterEditor.subLabel || "").trim();
  runtimeState.unitCounterEditor.strengthText = String(runtimeState.unitCounterEditor.strengthText || "").trim();
  if (!runtimeState.unitCounterEditor.layoutAnchor || typeof runtimeState.unitCounterEditor.layoutAnchor !== "object") {
    runtimeState.unitCounterEditor.layoutAnchor = { kind: "feature", key: "", slotIndex: null };
  }
  runtimeState.unitCounterEditor.layoutAnchor.kind = String(runtimeState.unitCounterEditor.layoutAnchor.kind || "feature").trim().toLowerCase() || "feature";
  runtimeState.unitCounterEditor.layoutAnchor.key = String(runtimeState.unitCounterEditor.layoutAnchor.key || "").trim();
  runtimeState.unitCounterEditor.layoutAnchor.slotIndex = Number.isInteger(Number(runtimeState.unitCounterEditor.layoutAnchor.slotIndex))
    ? Math.max(0, Math.round(Number(runtimeState.unitCounterEditor.layoutAnchor.slotIndex)))
    : null;
  runtimeState.unitCounterEditor.attachment = runtimeState.unitCounterEditor.attachment && typeof runtimeState.unitCounterEditor.attachment === "object"
    ? {
      kind: String(runtimeState.unitCounterEditor.attachment.kind || STRATEGIC_COUNTER_ATTACHMENT_KIND).trim().toLowerCase() || STRATEGIC_COUNTER_ATTACHMENT_KIND,
      lineId: String(runtimeState.unitCounterEditor.attachment.lineId || "").trim(),
    }
    : null;
  runtimeState.unitCounterEditor.baseFillColor = normalizeUnitCounterBaseFillColor(runtimeState.unitCounterEditor.baseFillColor);
  runtimeState.unitCounterEditor.organizationPct = normalizeUnitCounterStatPercent(
    runtimeState.unitCounterEditor.organizationPct,
    DEFAULT_UNIT_COUNTER_ORGANIZATION_PCT
  );
  runtimeState.unitCounterEditor.equipmentPct = normalizeUnitCounterStatPercent(
    runtimeState.unitCounterEditor.equipmentPct,
    DEFAULT_UNIT_COUNTER_EQUIPMENT_PCT
  );
  runtimeState.unitCounterEditor.statsPresetId = normalizeUnitCounterStatsPresetId(runtimeState.unitCounterEditor.statsPresetId || "regular");
  runtimeState.unitCounterEditor.statsSource = ["preset", "random", "manual"].includes(String(runtimeState.unitCounterEditor.statsSource || "").trim().toLowerCase())
    ? String(runtimeState.unitCounterEditor.statsSource || "").trim().toLowerCase()
    : "preset";
  runtimeState.unitCounterEditor.size = normalizeUnitCounterSizeToken(runtimeState.unitCounterEditor.size);
}

function resetUnitCounterEditorState({ preserveSelection = false, preserveCounter = true } = {}) {
  ensureUnitCounterEditorState();
  const preservedSelection = preserveSelection ? String(runtimeState.unitCounterEditor.selectedId || "").trim() || null : null;
  const preservedCounter = preserveCounter ? Math.max(1, Number(runtimeState.unitCounterEditor.counter) || 1) : 1;
  runtimeState.unitCounterEditor.active = false;
  runtimeState.unitCounterEditor.renderer = DEFAULT_UNIT_COUNTER_RENDERER;
  runtimeState.unitCounterEditor.label = "";
  runtimeState.unitCounterEditor.sidc = "";
  runtimeState.unitCounterEditor.symbolCode = "";
  runtimeState.unitCounterEditor.nationTag = "";
  runtimeState.unitCounterEditor.nationSource = "display";
  runtimeState.unitCounterEditor.presetId = DEFAULT_UNIT_COUNTER_PRESET_ID;
  runtimeState.unitCounterEditor.iconId = "";
  runtimeState.unitCounterEditor.unitType = "";
  runtimeState.unitCounterEditor.echelon = "";
  runtimeState.unitCounterEditor.subLabel = "";
  runtimeState.unitCounterEditor.strengthText = "";
  runtimeState.unitCounterEditor.layoutAnchor = { kind: "feature", key: "", slotIndex: null };
  runtimeState.unitCounterEditor.attachment = null;
  runtimeState.unitCounterEditor.baseFillColor = "";
  runtimeState.unitCounterEditor.organizationPct = DEFAULT_UNIT_COUNTER_ORGANIZATION_PCT;
  runtimeState.unitCounterEditor.equipmentPct = DEFAULT_UNIT_COUNTER_EQUIPMENT_PCT;
  runtimeState.unitCounterEditor.statsPresetId = "regular";
  runtimeState.unitCounterEditor.statsSource = "preset";
  runtimeState.unitCounterEditor.size = "medium";
  runtimeState.unitCounterEditor.selectedId = preservedSelection;
  runtimeState.unitCounterEditor.returnSelectionId = null;
  runtimeState.unitCounterEditor.counter = preservedCounter;
  ensureUnitCounterEditorState();
}

function getProjectedPoint(coord) {
  const projected = rendererSurfaceHost.getProjection()?.(coord);
  if (!Array.isArray(projected) || projected.length < 2) return null;
  const x = Number(projected[0]);
  const y = Number(projected[1]);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

function renderStrategicDefs() {
  if (!rendererSurfaceHost.getStrategicDefs()) return;
  const defs = [
    {
      id: "strategic-arrow-attack",
      path: "M 0 5 L 8 1.8 L 7 5 L 8 8.2 z",
      fill: "#7f1d1d",
      stroke: "#f5d7d3",
      strokeWidth: 0.45,
    },
    {
      id: "strategic-arrow-retreat",
      path: "M 1 5 L 8 2 L 6.6 5 L 8 8 z",
      fill: "#9a3412",
      stroke: "#f3dec6",
      strokeWidth: 0.45,
    },
    {
      id: "strategic-arrow-supply",
      path: "M 0 5 L 6 2.5 L 6 4.2 L 8 4.2 L 8 5.8 L 6 5.8 L 6 7.5 z",
      fill: "#475569",
      stroke: "#dbe2eb",
      strokeWidth: 0.5,
    },
    {
      id: "strategic-arrow-naval",
      path: "M 0 5 L 7 1.6 L 6 5 L 7 8.4 z",
      fill: "#1e3a8a",
      stroke: "#d8e6ff",
      strokeWidth: 0.45,
    },
  ];

  const selection = rendererSurfaceHost.getStrategicDefs().selectAll("marker.strategic-marker").data(defs, (d) => d.id);
  const enter = selection
    .enter()
    .append("marker")
    .attr("class", "strategic-marker")
    .attr("markerUnits", "strokeWidth")
    .attr("orient", "auto-start-reverse")
    .attr("refX", 10)
    .attr("refY", 5)
    .attr("markerWidth", 11)
    .attr("markerHeight", 10)
    .attr("viewBox", "0 0 11 10");

  enter.append("path");
  enter.merge(selection)
    .attr("id", (d) => d.id)
    .select("path")
    .attr("d", (d) => d.path)
    .attr("fill", (d) => d.fill)
    .attr("stroke", (d) => d.stroke)
    .attr("stroke-width", (d) => d.strokeWidth);

  selection.exit().remove();
}

function projectStrategicPoints(points = []) {
  return points.map((point) => getProjectedPoint(point)).filter(Boolean);
}

function createOperationGraphicPath(points = [], { closed = false, curved = true } = {}) {
  const projected = projectStrategicPoints(points);
  if (projected.length < (closed ? 3 : 2) || !globalThis.d3?.line) return "";
  const curve = closed
    ? (curved ? globalThis.d3.curveCatmullRomClosed.alpha(0.5) : globalThis.d3.curveLinearClosed)
    : (curved ? globalThis.d3.curveCatmullRom.alpha(0.5) : globalThis.d3.curveLinear);
  return globalThis.d3.line().curve(curve)(projected) || "";
}

function getOperationGraphicById(id) {
  const selectedId = String(id || "").trim();
  if (!selectedId) return null;
  return (runtimeState.operationGraphics || []).find((entry) => String(entry?.id || "") === selectedId) || null;
}

function getOperationalLineById(id) {
  const selectedId = String(id || "").trim();
  if (!selectedId) return null;
  return (runtimeState.operationalLines || []).find((entry) => String(entry?.id || "") === selectedId) || null;
}

function getOperationGraphicEditorModel() {
  ensureOperationGraphicsEditorState();
  const isDrawing = !!runtimeState.operationGraphicsEditor.active;
  if (isDrawing) {
    const kind = String(runtimeState.operationGraphicsEditor.kind || DEFAULT_OPERATION_GRAPHIC_KIND);
    return {
      mode: "draw",
      graphic: null,
      points: Array.isArray(runtimeState.operationGraphicsEditor.points) ? runtimeState.operationGraphicsEditor.points : [],
      kind,
      stylePreset: normalizeOperationGraphicStylePreset(runtimeState.operationGraphicsEditor.stylePreset, kind),
      stroke: normalizeOperationGraphicStroke(runtimeState.operationGraphicsEditor.stroke),
      width: normalizeOperationGraphicWidth(runtimeState.operationGraphicsEditor.width),
      opacity: normalizeOperationGraphicOpacity(runtimeState.operationGraphicsEditor.opacity),
      selectedVertexIndex: -1,
    };
  }
  const graphic = getOperationGraphicById(runtimeState.operationGraphicsEditor.selectedId);
  if (!graphic) {
    return null;
  }
  const kind = String(graphic.kind || DEFAULT_OPERATION_GRAPHIC_KIND);
  return {
    mode: "edit",
    graphic,
    points: Array.isArray(graphic.points) ? graphic.points : [],
    kind,
    stylePreset: normalizeOperationGraphicStylePreset(graphic.stylePreset, kind),
    stroke: normalizeOperationGraphicStroke(graphic.stroke),
    width: normalizeOperationGraphicWidth(graphic.width),
    opacity: normalizeOperationGraphicOpacity(graphic.opacity),
    selectedVertexIndex: Math.max(-1, Number(runtimeState.operationGraphicsEditor.selectedVertexIndex) || -1),
  };
}

function getUnitCounterSymbolToken(counter = {}) {
  return String(counter.sidc || counter.symbolCode || getUnitCounterPresetById(counter.presetId).baseSidc || "").trim();
}

function getUnitCounterEffectiveSidc(counter = {}) {
  const raw = getUnitCounterSymbolToken(counter);
  if (/^\d{30}$/.test(raw)) {
    return raw;
  }
  return UNIT_COUNTER_SIDC_ALIASES[String(raw || "").trim().toUpperCase()] || DEFAULT_MILSTD_SIDC;
}

function getMilSymbolDataUri(sidc, size = 42) {
  const normalizedSidc = String(sidc || "").trim();
  const normalizedSize = Math.max(24, Math.min(96, Number(size) || 42));
  const cacheKey = `${normalizedSidc}|${normalizedSize}`;
  if (milsymbolSvgUriCache.has(cacheKey)) {
    return milsymbolSvgUriCache.get(cacheKey);
  }
  if (!normalizedSidc || !globalThis.ms?.Symbol) {
    return "";
  }
  try {
    const symbol = new globalThis.ms.Symbol(normalizedSidc, {
      size: normalizedSize,
      frame: true,
      colorMode: "Light",
    });
    const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(symbol.asSVG())}`;
    milsymbolSvgUriCache.set(cacheKey, uri);
    return uri;
  } catch (_error) {
    milsymbolSvgUriCache.set(cacheKey, "");
    return "";
  }
}

function getLandFeatureIdFromEvent(event, eventType = "unit-counter-hit") {
  const hit = getHitFromEvent(event, {
    enableSnap: true,
    snapPx: HIT_SNAP_RADIUS_CLICK_PX,
    eventType,
  });
  return hit?.targetType === "land" ? String(hit.id || "") : "";
}

function renderFrontlineOverlay() {
  if (!rendererSurfaceHost.getFrontlineOverlayGroup() || !rendererSurfaceHost.getFrontlineLabelsGroup() || !rendererSurfaceHost.getPathSvg()) return;
  if (!runtimeState.annotationView?.frontlineEnabled) {
    runtimeState.cachedFrontlineMesh = null;
    runtimeState.cachedFrontlineMeshHash = "";
  } else {
    // Derived frontlines were retired with the control layer; the mesh owner
    // clears legacy mesh state and always returns null, including old saves.
    getBorderMeshOwner().getFrontlineMesh();
  }
  runtimeState.cachedFrontlineLabelAnchors = [];
  runtimeState.cachedFrontlineLabelAnchorsHash = "";
  rendererSurfaceHost.getFrontlineOverlayGroup().selectAll("*").remove();
  rendererSurfaceHost.getFrontlineLabelsGroup().selectAll("*").remove();
  rendererSurfaceHost.getFrontlineOverlayGroup().attr("aria-hidden", "true");
  rendererSurfaceHost.getFrontlineLabelsGroup().attr("aria-hidden", "true");
}

function syncInteractionLayerPointerEvents() {
  if (!rendererSurfaceHost.getInteractionRect()) return;
  const operationGraphicEditor = runtimeState.operationGraphicsEditor || {};
  const hasEditableOperationGraphic = !operationGraphicEditor.active
    && String(operationGraphicEditor.mode || "") === "edit"
    && !!String(operationGraphicEditor.selectedId || "").trim()
    && Array.isArray(operationGraphicEditor.points)
    && operationGraphicEditor.points.length > 0;
  rendererSurfaceHost.getInteractionRect()
    .style("pointer-events", hasEditableOperationGraphic ? "none" : "all")
    .lower();
}

function renderOperationGraphicsEditorOverlay() {
  if (!rendererSurfaceHost.getOperationGraphicsEditorGroup()) return;
  ensureOperationGraphicsEditorState();
  const editorModel = getOperationGraphicEditorModel();
  const points = Array.isArray(editorModel?.points) ? editorModel.points : [];
  const isDrawing = editorModel?.mode === "draw";
  if (!editorModel || points.length === 0) {
    rendererSurfaceHost.getOperationGraphicsEditorGroup().selectAll("*").remove();
    rendererSurfaceHost.getOperationGraphicsEditorGroup().attr("aria-hidden", "true");
    syncInteractionLayerPointerEvents();
    return;
  }
  const geometryPreset = getOperationGraphicPreset(editorModel.kind);
  const stylePreset = getOperationGraphicPreset(editorModel.stylePreset);
  const previewPath = createOperationGraphicPath(points, {
    closed: !!geometryPreset.closed && points.length >= 3,
    curved: true,
  });
  const previewData = previewPath ? [{ id: "preview", d: previewPath, closed: !!geometryPreset.closed && points.length >= 3 }] : [];
  const pathSelection = rendererSurfaceHost.getOperationGraphicsEditorGroup()
    .selectAll("path.operation-graphics-editor-path")
    .data(previewData, (d) => d.id);

  pathSelection
    .enter()
    .append("path")
    .attr("class", "operation-graphics-editor-path")
    .attr("role", "presentation")
    .attr("aria-hidden", "true")
    .attr("pointer-events", "none")
    .attr("vector-effect", "non-scaling-stroke")
    .merge(pathSelection)
    .attr("d", (d) => d.d)
    .attr("fill", (d) => (d.closed ? "rgba(59, 130, 246, 0.08)" : "none"))
    .attr("stroke", editorModel.stroke || stylePreset.stroke)
    .attr("stroke-width", Math.max(1.5, editorModel.width || stylePreset.width))
    .attr("stroke-linecap", "round")
    .attr("stroke-linejoin", "round")
    .attr("stroke-dasharray", stylePreset.dasharray || "8 4")
    .attr("opacity", Number.isFinite(Number(editorModel.opacity)) ? editorModel.opacity : stylePreset.opacity);

  pathSelection.exit().remove();

  const pointSelection = rendererSurfaceHost.getOperationGraphicsEditorGroup()
    .selectAll("circle.operation-graphics-editor-point")
    .data(points.map((coord, index) => ({ coord, index, id: `opg-point-${index}` })), (d) => d.id);

  const pointEnter = pointSelection
    .enter()
    .append("circle")
    .attr("class", "operation-graphics-editor-point")
    .attr("role", "presentation")
    .attr("aria-hidden", "true");

  pointEnter.merge(pointSelection)
    .attr("r", 4.2)
    .attr("cx", (d) => getProjectedPoint(d.coord)?.[0] ?? -9999)
    .attr("cy", (d) => getProjectedPoint(d.coord)?.[1] ?? -9999)
    .attr("fill", (_d, index) => (index === editorModel.selectedVertexIndex ? "#0f172a" : "#ffffff"))
    .attr("stroke", editorModel.stroke || stylePreset.stroke)
    .attr("stroke-width", (_d, index) => (index === editorModel.selectedVertexIndex ? 2 : 1.3))
    .attr("pointer-events", "all")
    .style("cursor", isDrawing ? "default" : "grab");

  pointSelection.exit().remove();

  if (!isDrawing && globalThis.d3?.drag) {
    if (!renderOperationGraphicsEditorOverlay.pointDragBehavior) {
      renderOperationGraphicsEditorOverlay.pointDragBehavior = globalThis.d3.drag()
        .on("start", function onStart(event, datum) {
          event?.sourceEvent?.stopPropagation?.();
          getStrategicOverlayRuntimeOwner().beginOperationGraphicVertexDrag(datum.index);
          globalThis.d3.select(this).style("cursor", "grabbing");
        })
        .on("drag", function onDrag(event, datum) {
          const coord = getMapLonLatFromEvent(event?.sourceEvent || event);
          getStrategicOverlayRuntimeOwner().moveOperationGraphicVertexDrag(datum.index, coord);
        })
        .on("end", function onEnd(_event, datum) {
          globalThis.d3.select(this).style("cursor", "grab");
          getStrategicOverlayRuntimeOwner().finishOperationGraphicVertexDrag(datum.index);
        });
    }
    pointEnter.merge(pointSelection)
      .on("click", (event, datum) => {
        event.stopPropagation();
        runtimeState.operationGraphicsEditor.selectedVertexIndex = datum.index;
        runtimeState.operationGraphicsEditor.points = points;
        runtimeState.operationGraphicsDirty = true;
        updateStrategicOverlayUi();
        renderOperationGraphicsIfNeeded({ force: true });
      })
      .call(renderOperationGraphicsEditorOverlay.pointDragBehavior);
  }

  const midpointData = !isDrawing
    ? getOperationGraphicEditorMidpoints(points, { closed: !!geometryPreset.closed && points.length >= 3 })
    : [];
  const midpointSelection = rendererSurfaceHost.getOperationGraphicsEditorGroup()
    .selectAll("circle.operation-graphics-editor-midpoint")
    .data(midpointData, (d) => d.id);

  midpointSelection
    .enter()
    .append("circle")
    .attr("class", "operation-graphics-editor-midpoint")
    .attr("role", "presentation")
    .attr("aria-hidden", "true")
    .merge(midpointSelection)
    .attr("r", 10)
    .attr("cx", (d) => getProjectedPoint(d.coord)?.[0] ?? -9999)
    .attr("cy", (d) => getProjectedPoint(d.coord)?.[1] ?? -9999)
    .attr("fill", editorModel.stroke || stylePreset.stroke)
    .attr("opacity", 0.001)
    .attr("stroke", "none")
    .attr("stroke-width", 0)
    .attr("pointer-events", "all")
    .style("cursor", "copy")
    .on("pointerdown", function onPointerDown(event, datum) {
      this.dataset.skipMidpointClick = "true";
      event.stopPropagation();
      event.preventDefault?.();
      getStrategicOverlayRuntimeOwner().insertOperationGraphicVertex(datum.insertIndex, datum.coord);
    })
    .on("click", function onClick(event, datum) {
      if (this.dataset.skipMidpointClick === "true") {
        this.dataset.skipMidpointClick = "false";
        return;
      }
      event.stopPropagation();
      getStrategicOverlayRuntimeOwner().insertOperationGraphicVertex(datum.insertIndex, datum.coord);
    });

  const midpointVisualSelection = rendererSurfaceHost.getOperationGraphicsEditorGroup()
    .selectAll("circle.operation-graphics-editor-midpoint-visual")
    .data(midpointData, (d) => d.id);

  midpointVisualSelection
    .enter()
    .append("circle")
    .attr("class", "operation-graphics-editor-midpoint-visual")
    .attr("role", "presentation")
    .attr("aria-hidden", "true")
    .merge(midpointVisualSelection)
    .attr("r", 4.6)
    .attr("cx", (d) => getProjectedPoint(d.coord)?.[0] ?? -9999)
    .attr("cy", (d) => getProjectedPoint(d.coord)?.[1] ?? -9999)
    .attr("fill", editorModel.stroke || stylePreset.stroke)
    .attr("opacity", 0.72)
    .attr("stroke", "#ffffff")
    .attr("stroke-width", 1)
    .attr("pointer-events", "none");

  rendererSurfaceHost.getOperationGraphicsEditorGroup().selectAll("circle.operation-graphics-editor-point").raise();

  midpointSelection.exit().remove();
  midpointVisualSelection.exit().remove();
  rendererSurfaceHost.getOperationGraphicsEditorGroup().attr("aria-hidden", "false");
  syncInteractionLayerPointerEvents();
}

function getUnitCounterIconPath(iconId = "") {
  return getUnitCounterIconPathById(iconId);
}

// 在缩放过程中轻量更新兵牌 transform，避免 localScale 陈旧导致跳变
function renderUnitCountersOverlay() {
  getStrategicOverlayHelpersOwner().renderUnitCountersOverlay();
  bindUnitCounterOverlayInteractions();
}

function bindUnitCounterOverlayInteractions() {
  if (!rendererSurfaceHost.getUnitCountersGroup()) return;
  const merged = rendererSurfaceHost.getUnitCountersGroup().selectAll("g.unit-counter");
  if (globalThis.d3?.drag) {
    if (!bindUnitCounterOverlayInteractions.dragBehavior) {
      bindUnitCounterOverlayInteractions.dragBehavior = globalThis.d3.drag()
        .on("start", function onStart(event, datum) {
          getStrategicOverlayRuntimeOwner().beginUnitCounterDrag(datum.counter);
          globalThis.d3.select(this).style("cursor", "grabbing");
        })
        .on("drag", function onDrag(event, datum) {
          const sourceEvent = event?.sourceEvent || event;
          const coord = getMapLonLatFromEvent(sourceEvent);
          if (!coord) return;
          if (!getStrategicOverlayRuntimeOwner().moveUnitCounterDrag(datum.counter, coord)) return;
          const projected = getProjectedPoint(coord);
          if (projected) {
            datum.projected = projected;
            this.setAttribute("transform", getUnitCounterNodeTransform(datum));
          }
        })
        .on("end", function onEnd(event, datum) {
          globalThis.d3.select(this).style("cursor", "grab");
          const featureId = getLandFeatureIdFromEvent(event?.sourceEvent || event, "unit-counter-drag-end");
          getStrategicOverlayRuntimeOwner().finishUnitCounterDrag(datum.counter, { featureId });
        });
    }
    merged.call(bindUnitCounterOverlayInteractions.dragBehavior);
  }

  merged.on("click", (_event, datum) => {
    getStrategicOverlayRuntimeOwner().selectUnitCounterFromRender(datum.counter);
  });
}

function renderHoverOverlay() {
  getTransientOverlayRenderOwner().renderHoverOverlay();
}

function renderInspectorHighlightOverlay() {
  return getSelectionOverlayOwner().renderInspectorHighlightOverlay();
}

function ensureLegendControlElement() {
  return getLegendControlOwner().ensureLegendControlElement();
}

export function renderLegend(uniqueColors = null, labels = null) {
  return getLegendControlOwner().renderLegend(uniqueColors, labels);
}

function ensurePerfOverlayElement() {
  const cache = getRenderPassCacheState();
  if (!cache.perfOverlayEnabled || !rendererSurfaceHost.getMapContainer()) return null;
  if (cache.overlayElement && rendererSurfaceHost.getMapContainer().contains(cache.overlayElement)) {
    return cache.overlayElement;
  }
  const element = document.createElement("pre");
  element.id = "perf-overlay";
  element.style.position = "absolute";
  element.style.top = "12px";
  element.style.right = "12px";
  element.style.zIndex = "5";
  element.style.maxWidth = "360px";
  element.style.margin = "0";
  element.style.padding = "10px 12px";
  element.style.borderRadius = "10px";
  element.style.background = "rgba(15, 23, 42, 0.84)";
  element.style.color = "#e2e8f0";
  element.style.font = "11px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  element.style.whiteSpace = "pre-wrap";
  element.style.pointerEvents = "none";
  element.style.boxShadow = "0 8px 30px rgba(15, 23, 42, 0.28)";
  rendererSurfaceHost.getMapContainer().appendChild(element);
  cache.overlayElement = element;
  return element;
}

function updatePerfOverlay() {
  const cache = getRenderPassCacheState();
  if (!cache.perfOverlayEnabled) {
    if (cache.overlayElement?.remove) {
      cache.overlayElement.remove();
    }
    cache.overlayElement = null;
    return;
  }
  const overlay = ensurePerfOverlayElement();
  if (!overlay) return;
  const frame = cache.lastFrame || {};
  const sidebarPerf = getSidebarPerfState();
  const invalidations = RENDER_PASS_NAMES.map((passName) => {
    const reason = cache.reasons?.[passName] || "-";
    const dirtyFlag = cache.dirty?.[passName] ? "*" : "";
    return `${passName}:${reason}${dirtyFlag}`;
  }).join(" | ");
  const timingEntries = Object.entries(frame.timings || {})
    .map(([name, value]) => `${name}=${Number(value || 0).toFixed(1)}ms`)
    .join(", ");
  const renderPerf = runtimeState.renderPerfMetrics || {};
  const scenarioPerf = runtimeState.scenarioPerfMetrics || {};
  const contextScenarioReasonSnapshot = resolveContextScenarioReasonSnapshot({ cache, renderPerf });
  const opEntries = [
    ["setMapData", renderPerf.setMapData?.durationMs],
    ["firstPaint", renderPerf.setMapDataFirstPaint?.durationMs],
    ["contextBaseReady", renderPerf.setMapDataContextBaseReady?.durationMs],
    ["hitReady", renderPerf.setMapDataHitCanvasReady?.durationMs],
    ["settleFast", renderPerf.settleFastFrame?.durationMs],
    ["settleExact", renderPerf.settleExactRefresh?.durationMs],
    ["ctxBaseExact", renderPerf.contextBaseExactRefresh?.durationMs],
    ["buildSpatialIndex", renderPerf.buildSpatialIndex?.durationMs],
    ["rebuildStaticMeshes", renderPerf.rebuildStaticMeshes?.durationMs],
    ["rebuildDynamicBorders", renderPerf.rebuildDynamicBorders?.durationMs],
    ["physicalClip", renderPerf.applyPhysicalLandClipMask?.durationMs],
    ["oceanClip", renderPerf.applyOceanClipMask?.durationMs],
    ["contextBase", renderPerf.drawContextBasePass?.durationMs],
    ["labels", renderPerf.drawLabelsPass?.durationMs],
    ["contextScenario", renderPerf.drawContextScenarioPass?.durationMs],
    ["hitCanvas", renderPerf.buildHitCanvas?.durationMs],
    ["bgMerge", renderPerf.drawScenarioPoliticalBackgroundEntries?.durationMs],
    ["politicalBg", renderPerf.drawPoliticalBackgroundFillsPass?.durationMs],
    ["politicalFill", renderPerf.drawPoliticalFeatureFillLoop?.durationMs],
    ["politicalStroke", renderPerf.drawPoliticalFeatureStrokeLoop?.durationMs],
    ["bgCacheBuild", renderPerf.scenarioPoliticalBackgroundCacheBuild?.durationMs],
    ["bgCacheReplay", renderPerf.scenarioPoliticalBackgroundCacheReplay?.durationMs],
    ["relief", renderPerf.drawScenarioReliefOverlaysLayer?.durationMs],
    ["scenarioLoad", scenarioPerf.loadScenarioBundle?.durationMs],
    ["scenarioApply", scenarioPerf.applyScenarioBundle?.durationMs],
  ]
    .filter(([, value]) => Number.isFinite(Number(value)))
    .map(([name, value]) => `${name}=${Number(value || 0).toFixed(1)}ms`)
    .join(", ");
  const contextBreakdownEntries = Object.entries(renderPerf.contextBreakdown || {})
    .map(([name, value]) => {
      const duration = Number(value?.durationMs || 0).toFixed(1);
      const callCount = Number(value?.callCount || 0);
      return `${name}=${duration}ms${callCount > 1 ? `#${callCount}` : ""}`;
    })
    .join(", ");
  const coverageDebug = runtimeState.debugCountryCoverage || {};
  overlay.textContent = [
    `phase=${frame.phase || runtimeState.renderPhase} total=${Number(frame.totalMs || 0).toFixed(1)}ms`,
    `action=${cache.lastAction || "-"} ${Number(cache.lastActionDurationMs || 0).toFixed(1)}ms`,
    `transform=${getTransformSignature(frame.transform || runtimeState.zoomTransform)}`,
    `passes ${timingEntries || "none"}`,
    `contextBreakdown ${contextBreakdownEntries || "none"}`,
    `ops ${opEntries || "none"}`,
    `ctxReuse skip=${renderPerf.contextBaseReuseSkipped ? "yes" : "no"} scale=${Number(renderPerf.contextBaseReuseScaleRatio?.scaleRatio || 0).toFixed(4)} dist=${Number(renderPerf.contextBaseReuseDistancePx?.distancePx || 0).toFixed(2)}px`,
    `ctxScenario reuse=${cache.counters.contextScenarioReuseCount || 0} exact=${cache.counters.contextScenarioExactRefreshCount || 0} reason=${contextScenarioReasonSnapshot.displayReason} cacheReason=${contextScenarioReasonSnapshot.cacheReason} perfReason=${contextScenarioReasonSnapshot.perfReason} mismatchWarn=${cache.counters.contextScenarioReasonMismatchWarnings || 0}`,
    `coverage countries=${Number(coverageDebug.totalCountries || 0)} detail=${Number(coverageDebug.detailCountries || 0)} primary=${Number(coverageDebug.primaryCountries || 0)} priorityGap=${Array.isArray(coverageDebug.priorityCountryGaps) ? coverageDebug.priorityCountryGaps.length : 0}`,
    `projBounds total=${Number(renderPerf.projectedBoundsDiagnostics?.total || 0)} reasons=${JSON.stringify(renderPerf.projectedBoundsDiagnostics?.byReason || {})}`,
    `invalidations ${invalidations}`,
    `render draw=${cache.counters.drawCanvas || 0} frame=${cache.counters.frames || 0} ctxBase=${cache.counters.contextBasePassRenders || 0} labels=${cache.counters.labelPassRenders || 0} ctxScenario=${cache.counters.contextScenarioPassRenders || 0} dayNight=${cache.counters.dayNightPassRenders || 0} hit=${cache.counters.hitCanvasRenders || 0} dynBorder=${cache.counters.dynamicBorderRebuilds || 0}`,
    `sidebar list=${sidebarPerf.counters.fullListRenders || 0} rows=${sidebarPerf.counters.rowRefreshes || 0} detail=${sidebarPerf.counters.inspectorRenders || 0} preset=${sidebarPerf.counters.presetTreeRenders || 0} legend=${sidebarPerf.counters.legendRenders || 0}`,
  ].join("\n");
}

function render() {
  const startedAt = perfIsEnabled() ? nowMs() : 0;
  const metricSequenceStartedAt = startedAt > 0
    ? Math.max(0, Number(runtimeState.renderPerfMetricSequence || 0))
    : 0;
  const frameSchedulerQueue = getFrameSchedulerQueueLength({ byPriority: true, byLabelGeneration: true });
  recordRenderPerfMetric("frameSchedulerQueueDepth", 0, frameSchedulerQueue);
  recordRenderPerfMetric("renderBoundaryReasons", 0, getRenderBoundaryDebugState());
  if (runtimeState.scenarioChunkPromotionRenderLocked) {
    recordRenderPerfMetric("scenarioChunkPromotionRenderLocked", 0, {
      phase: String(runtimeState.renderPhase || ""),
      activeScenarioId: String(runtimeState.activeScenarioId || ""),
    });
    return;
  }
  ensureResolvedColorsReadyForStableVisibleFrame("render");
  drawCanvas();
  if (runtimeState.renderPhase === RENDER_PHASE_IDLE) {
    scheduleHitCanvasBuildIfNeeded();
  }
  renderFrontlineOverlayIfNeeded();
  renderOperationalLinesIfNeeded();
  renderOperationGraphicsIfNeeded();
  renderUnitCountersIfNeeded();
  renderSpecialZonesIfNeeded();
  renderDevSelectionOverlayIfNeeded();
  renderInspectorHighlightOverlayIfNeeded();
  renderHoverOverlayIfNeeded({ eventType: "render-frame" });
  if (runtimeState.renderPhase === RENDER_PHASE_IDLE) {
    renderLegend();
    if (typeof runtimeState.updateLegendUI === "function") {
      runtimeState.updateLegendUI();
    }
  }
  updatePerfOverlay();
  if (startedAt > 0) {
    recordRenderSample(nowMs() - startedAt, {
      activeScenarioId: String(runtimeState.activeScenarioId || ""),
      phase: String(runtimeState.renderPhase || ""),
      politicalBgMs: readRenderPerfMetricDuration("drawPoliticalBackgroundFillsPass", metricSequenceStartedAt),
      politicalRecoveryQuality: readRenderPerfMetricString("drawPoliticalBackgroundFillsPass", "recoveryQuality", metricSequenceStartedAt),
      politicalBgProgressive: readRenderPerfMetricBoolean("drawPoliticalBackgroundFillsPass", "progressive", metricSequenceStartedAt),
      politicalBgDeferredFullCacheScheduled: readRenderPerfMetricBoolean("drawPoliticalBackgroundFillsPass", "deferredFullCacheScheduled", metricSequenceStartedAt),
      politicalBgDeferredFullCacheReady: readRenderPerfMetricBoolean("drawPoliticalBackgroundFillsPass", "deferredFullCacheReady", metricSequenceStartedAt),
      politicalBgCacheBuildMs: readRenderPerfMetricDuration("scenarioPoliticalBackgroundCacheBuild", metricSequenceStartedAt),
      politicalBgCacheEntryCount: readRenderPerfMetricNumber("scenarioPoliticalBackgroundCacheBuild", "entryCount", metricSequenceStartedAt),
      politicalBgCacheBuiltPathCount: readRenderPerfMetricNumber("scenarioPoliticalBackgroundCacheBuild", "builtPathCount", metricSequenceStartedAt),
      politicalBgCachePathCacheSizeBefore: readRenderPerfMetricNumber("scenarioPoliticalBackgroundCacheBuild", "pathCacheSizeBefore", metricSequenceStartedAt),
      politicalBgCachePathCacheSizeAfter: readRenderPerfMetricNumber("scenarioPoliticalBackgroundCacheBuild", "pathCacheSizeAfter", metricSequenceStartedAt),
      politicalBgCachePathCacheResetPreviousReason: readRenderPerfMetricString("scenarioPoliticalBackgroundCacheBuild", "pathCacheResetPreviousReason", metricSequenceStartedAt),
      politicalBgDeferredFullCacheBuildMs: readRenderPerfMetricDuration("scenarioPoliticalBackgroundDeferredFullCacheBuild", metricSequenceStartedAt),
      politicalBgDeferredFullCacheEntryCount: readRenderPerfMetricNumber("scenarioPoliticalBackgroundDeferredFullCacheBuild", "entryCount", metricSequenceStartedAt),
      politicalBgDeferredFullCacheBuiltPathCount: readRenderPerfMetricNumber("scenarioPoliticalBackgroundDeferredFullCacheBuild", "builtPathCount", metricSequenceStartedAt),
      politicalFeatureFillMs: readRenderPerfMetricDuration("drawPoliticalFeatureFillLoop", metricSequenceStartedAt),
      contextScenarioMs: readRenderPerfMetricDuration("drawContextScenarioPass", metricSequenceStartedAt),
      hitCanvasMs: readRenderPerfMetricDuration("buildHitCanvas", metricSequenceStartedAt),
    });
  }
}

function autoFillMap(mode = "region", { recordHistory = true, styleUpdates = null } = {}) {
  if (!runtimeState.landData?.features?.length) {
    console.warn("[autoFillMap] No land features available, aborting.");
    return;
  }

  migrateLegacyColorState();
  ensureSovereigntyState();
  const nextCountryBaseColors = {};
  const [canvasWidth, canvasHeight] = getLogicalCanvasDimensions();

  if (mode === "political" && runtimeState.runtimePoliticalTopology?.objects?.political) {
    const computed = ColorManager.computeOwnerColors(
      {
        featureIds: runtimeState.runtimeFeatureIds,
        canonicalCountryByFeatureId: runtimeState.runtimeCanonicalCountryByFeatureId,
        neighborGraph: runtimeState.runtimeNeighborGraph,
      },
      runtimeState.sovereigntyByFeatureId,
      {
        fixedOwnerColors: {
          ...(runtimeState.fixedPaletteColorsByIso2 || {}),
          ...(runtimeState.scenarioFixedOwnerColors || {}),
        },
      }
    );
    const ownerColors = computed?.ownerColors || {};
    runtimeState.landData.features.forEach((feature, index) => {
      const id = getFeatureId(feature) || `feature-${index}`;
      if (shouldExcludePoliticalVisualFeature(feature, id)) return;
      if (shouldSkipFeature(feature, canvasWidth, canvasHeight, { forceProd: true })) return;
      const ownerCode = getFeatureOwnerCode(id) || getFeatureCountryCodeNormalized(feature);
      if (!ownerCode || nextCountryBaseColors[ownerCode]) return;
      const color =
        getColorByCanonicalCountryCode(ownerColors, ownerCode) ||
        (ownerCode && runtimeState.countryPalette && runtimeState.countryPalette[ownerCode]) ||
        ColorManager.getPoliticalFallbackColor(ownerCode || id, index);
      nextCountryBaseColors[ownerCode] = getSafeCanvasColor(color, LAND_FILL_COLOR);
    });
    runtimeState.sovereignContrastWarnings = computed?.contrastStats?.lowContrastEdges
      ? [computed.contrastStats]
      : [];

  } else {
    // Region mode: assign one region-derived color per country to country base colors.
    const countryRegionTag = new Map();
    runtimeState.landData.features.forEach((feature, index) => {
      const id = getFeatureId(feature) || `feature-${index}`;
      if (shouldExcludePoliticalVisualFeature(feature, id)) return;
      if (shouldSkipFeature(feature, canvasWidth, canvasHeight, { forceProd: true })) return;
      const countryCode = getFeatureCountryCodeNormalized(feature);
      if (!countryCode) return;
      if (countryRegionTag.has(countryCode)) return;
      const tag = getFeatureRegionTag(feature);
      countryRegionTag.set(countryCode, tag);
    });
    countryRegionTag.forEach((tag, countryCode) => {
      nextCountryBaseColors[countryCode] = getSafeCanvasColor(
        ColorManager.getRegionColor(tag),
        LAND_FILL_COLOR
      );
    });
  }

  const historyFeatureIds = Object.keys(runtimeState.visualOverrides || {});
  const historyOwnerCodes = Array.from(new Set([
    ...Object.keys(runtimeState.sovereignBaseColors || {}),
    ...Object.keys(runtimeState.countryBaseColors || {}),
    ...Object.keys(nextCountryBaseColors || {}),
  ]));
  const stylePaths = styleUpdates && typeof styleUpdates === "object"
    ? Object.keys(styleUpdates)
    : [];
  const historyBefore = recordHistory
    ? captureHistoryState({
      featureIds: historyFeatureIds,
      ownerCodes: historyOwnerCodes,
      stylePaths,
    })
    : null;

  runtimeState.visualOverrides = {};
  runtimeState.featureOverrides = {};
  runtimeState.sovereignBaseColors = sanitizeCountryColorMap(nextCountryBaseColors);
  runtimeState.countryBaseColors = { ...runtimeState.sovereignBaseColors };
  markLegacyColorStateDirty();
  if (styleUpdates && typeof styleUpdates === "object") {
    Object.entries(styleUpdates).forEach(([path, value]) => {
      const segments = String(path || "").split(".").filter(Boolean);
      if (!segments.length) return;
      let cursor = runtimeState.styleConfig;
      for (let index = 0; index < segments.length - 1; index += 1) {
        const segment = segments[index];
        if (!cursor[segment] || typeof cursor[segment] !== "object") {
          cursor[segment] = {};
        }
        cursor = cursor[segment];
      }
      cursor[segments[segments.length - 1]] = value;
    });
  }
  markDirty(mode === "political" ? "auto-fill-political" : "auto-fill-region");
  refreshResolvedColorsForOwners(Object.keys(nextCountryBaseColors), { renderNow: false });
  if (recordHistory) {
    commitHistoryEntry({
      kind: mode === "political" ? "auto-fill-political" : "auto-fill-region",
      before: historyBefore,
      after: captureHistoryState({
        featureIds: historyFeatureIds,
        ownerCodes: historyOwnerCodes,
        stylePaths,
      }),
    });
  }
  const changedCountryCodes = Object.keys(nextCountryBaseColors);
  if (typeof runtimeState.refreshCountryListRowsFn === "function") {
    runtimeState.refreshCountryListRowsFn({
      countryCodes: changedCountryCodes,
      refreshInspector: true,
      refreshPresetTree: true,
    });
  } else if (typeof runtimeState.renderCountryListFn === "function") {
    runtimeState.renderCountryListFn();
  }
  if (rendererSurfaceHost.getContext()) {
    render();
  }
}

function getMapLonLatFromEvent(event) {
  if (!rendererSurfaceHost.getProjection() || !rendererSurfaceHost.getInteractionRect()?.node || !globalThis.d3?.pointer) return null;
  const [sx, sy] = globalThis.d3.pointer(event, rendererSurfaceHost.getInteractionRect().node());
  if (![sx, sy].every(Number.isFinite)) return null;
  const t = runtimeState.zoomTransform || globalThis.d3.zoomIdentity;
  const k = Math.max(0.0001, t.k || 1);
  const mapX = (sx - t.x) / k;
  const mapY = (sy - t.y) / k;
  const lonLat = rendererSurfaceHost.getProjection().invert([mapX, mapY]);
  if (!Array.isArray(lonLat) || lonLat.length < 2) return null;
  const lon = Number(lonLat[0]);
  const lat = Number(lonLat[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return [lon, clamp(lat, -90, 90)];
}

let physicalIntensityDragSession = null;
let physicalIntensityRenderFrame = null;
let physicalIntensityPreviewLonLat = null;

function getPhysicalIntensityChannel(channelId = "") {
  runtimeState.intensityFields = normalizeIntensityFieldsState(runtimeState.intensityFields);
  const normalizedChannelId = INTENSITY_FIELD_TOOL_CHANNELS.has(String(channelId || ""))
    ? String(channelId)
    : "physicalAtlas";
  return runtimeState.intensityFields.channels[normalizedChannelId];
}

function getIntensityFieldPassNames(channelId) {
  const targetPasses = getIntensityFieldTargetPasses(channelId);
  return targetPasses.length ? targetPasses : ["physicalBase"];
}

function schedulePhysicalIntensityRender(channelId, reason) {
  invalidateRenderPasses(getIntensityFieldPassNames(channelId), reason);
  if (physicalIntensityRenderFrame !== null) return;
  physicalIntensityRenderFrame = requestAnimationFrame(() => {
    physicalIntensityRenderFrame = null;
    requestInteractionRender(reason);
  });
}

function refreshPhysicalIntensityUi() {
  callRuntimeHook(runtimeState, "updateToolbarInputsFn");
}

function projectGeoToScreen(lon, lat) {
  if (!rendererSurfaceHost.getProjection()) return null;
  const projected = rendererSurfaceHost.getProjection()([lon, lat]);
  if (!Array.isArray(projected) || projected.length < 2) return null;
  const t = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity || { x: 0, y: 0, k: 1 };
  return [
    (projected[0] * Number(t.k || 1)) + Number(t.x || 0),
    (projected[1] * Number(t.k || 1)) + Number(t.y || 0),
  ];
}

function hidePhysicalIntensityBrushPreview() {
  physicalIntensityPreviewLonLat = null;
  if (rendererSurfaceHost.getIntensityFieldPreviewGroup()) {
    rendererSurfaceHost.getIntensityFieldPreviewGroup().style("display", "none");
  }
}

function renderPhysicalIntensityBrushPreview(lonLat = physicalIntensityPreviewLonLat) {
  if (!rendererSurfaceHost.getIntensityFieldPreviewGroup() || !globalThis.d3) return false;
  const tool = getIntensityFieldTool();
  if (!tool.active || !Array.isArray(lonLat) || lonLat.length < 2) {
    hidePhysicalIntensityBrushPreview();
    return false;
  }
  const screenPoint = projectGeoToScreen(lonLat[0], lonLat[1]);
  if (!screenPoint) {
    hidePhysicalIntensityBrushPreview();
    return false;
  }
  const radiusPx = getProjectedDegreeRadiusPx(lonLat[0], lonLat[1], tool.brushRadiusDeg);
  if (!Number.isFinite(radiusPx) || radiusPx <= 0) {
    hidePhysicalIntensityBrushPreview();
    return false;
  }
  physicalIntensityPreviewLonLat = [lonLat[0], lonLat[1]];
  rendererSurfaceHost.getIntensityFieldPreviewGroup().style("display", null);
  const preview = rendererSurfaceHost.getIntensityFieldPreviewGroup()
    .selectAll("circle.intensity-field-brush-preview")
    .data([{
      x: screenPoint[0],
      y: screenPoint[1],
      r: radiusPx,
      mode: tool.subMode,
    }]);
  preview.join("circle")
    .attr("class", "intensity-field-brush-preview")
    .attr("cx", (entry) => entry.x)
    .attr("cy", (entry) => entry.y)
    .attr("r", (entry) => entry.r)
    .attr("fill", (entry) => (entry.mode === "erase" ? "rgba(251, 191, 36, 0.08)" : "rgba(56, 189, 248, 0.08)"))
    .attr("stroke", (entry) => (entry.mode === "erase" ? "rgba(251, 191, 36, 0.92)" : "rgba(56, 189, 248, 0.92)"))
    .attr("stroke-width", 1.5)
    .attr("stroke-dasharray", (entry) => (entry.mode === "points" ? "3 4" : "6 4"));
  return true;
}

function updatePhysicalIntensityBrushPreviewFromEvent(event) {
  const tool = getIntensityFieldTool();
  if (!tool.active) {
    hidePhysicalIntensityBrushPreview();
    return false;
  }
  const lonLat = getMapLonLatFromEvent(event);
  return renderPhysicalIntensityBrushPreview(lonLat);
}

function getPhysicalIntensityPointHit(channel, lonLat) {
  if (!channel || !Array.isArray(channel.points) || !lonLat) return null;
  const pointerScreen = projectGeoToScreen(lonLat[0], lonLat[1]);
  if (!pointerScreen) return null;
  let best = null;
  channel.points.forEach((point) => {
    const pointScreen = projectGeoToScreen(point.lon, point.lat);
    if (!pointScreen) return;
    const centerDistance = Math.hypot(pointerScreen[0] - pointScreen[0], pointerScreen[1] - pointScreen[1]);
    const radiusPx = getProjectedDegreeRadiusPx(point.lon, point.lat, point.radiusDeg);
    const radiusDistance = Math.abs(centerDistance - radiusPx);
    if (centerDistance <= 12 && (!best || centerDistance < best.distance)) {
      best = { point, mode: "move", distance: centerDistance };
    } else if (radiusDistance <= 10 && (!best || radiusDistance < best.distance)) {
      best = { point, mode: "radius", distance: radiusDistance };
    }
  });
  return best;
}

function createIntensityPoint(channel, lonLat, tool) {
  const nextIndex = channel.points.length + 1;
  return {
    id: `point-${Date.now().toString(36)}-${nextIndex}`,
    lon: clamp(Number(lonLat[0]) || 0, -180, 180),
    lat: clamp(Number(lonLat[1]) || 0, -90, 90),
    strength: clamp(Number(tool.brushStrength || 1), INTENSITY_FIELD_GRID.min, INTENSITY_FIELD_GRID.max),
    radiusDeg: clamp(Number(tool.brushRadiusDeg || 3), 0.25, 30),
    falloff: "smooth",
  };
}

function commitPhysicalIntensitySession(reason = "physical-intensity-field") {
  const current = physicalIntensityDragSession;
  physicalIntensityDragSession = null;
  if (!current) return false;
  if (rendererSurfaceHost.getInteractionRect()?.node && current.pointerId !== undefined) {
    try {
      rendererSurfaceHost.getInteractionRect().node().releasePointerCapture(current.pointerId);
    } catch (_error) {
      // Pointer capture may already be released by the browser.
    }
  }
  if (!current.changed) return false;
  const channel = getPhysicalIntensityChannel(current.channelId);
  if (current.subMode === "points") {
    bakeIntensityComposite(channel);
  }
  channel.revision = Math.max(0, Math.round(Number(channel.revision) || 0)) + 1;
  const after = captureHistoryState({ intensityFieldChannels: [current.channelId] });
  pushHistoryEntry({
    kind: current.subMode === "points" ? "physical-intensity-point" : "physical-intensity-brush",
    before: current.before,
    after,
    meta: {
      reason,
      affectsIntensityField: true,
    },
  });
  suppressNextClickAfterBrush = true;
  schedulePhysicalIntensityRender(current.channelId, reason);
  refreshPhysicalIntensityUi();
  return true;
}

function applyPhysicalIntensityBrushAt(event) {
  const current = physicalIntensityDragSession;
  if (!current || current.subMode === "points") return false;
  const lonLat = getMapLonLatFromEvent(event);
  if (!lonLat) return false;
  const channel = getPhysicalIntensityChannel(current.channelId);
  channel.enabled = true;
  const dirtyRect = stampIntensityBrush(channel, {
    lon: lonLat[0],
    lat: lonLat[1],
    radiusDeg: current.brushRadiusDeg,
    strength: current.brushStrength,
    mode: current.subMode,
  });
  if (!dirtyRect) return false;
  current.changed = true;
  schedulePhysicalIntensityRender(current.channelId, "physical-intensity-field-drag");
  return true;
}

function applyPhysicalIntensityPointDrag(event) {
  const current = physicalIntensityDragSession;
  if (!current || current.subMode !== "points" || !current.pointId) return false;
  const lonLat = getMapLonLatFromEvent(event);
  if (!lonLat) return false;
  const channel = getPhysicalIntensityChannel(current.channelId);
  const point = channel.points.find((entry) => entry.id === current.pointId);
  if (!point) return false;
  if (current.pointDragMode === "radius") {
    const deltaLon = Math.abs(point.lon - lonLat[0]);
    const deltaLat = Math.abs(point.lat - lonLat[1]);
    point.radiusDeg = clamp(Math.hypot(Math.min(deltaLon, 360 - deltaLon), deltaLat), 0.25, 30);
  } else {
    point.lon = clamp(lonLat[0], -180, 180);
    point.lat = clamp(lonLat[1], -90, 90);
  }
  channel.enabled = true;
  current.changed = true;
  schedulePhysicalIntensityRender(current.channelId, "physical-intensity-point-drag");
  refreshPhysicalIntensityUi();
  return true;
}

function handlePhysicalIntensityPointerDown(event) {
  const tool = getIntensityFieldTool();
  if (!tool.active) return false;
  if (physicalIntensityDragSession) return true;
  if (runtimeState.startupReadonly) {
    if (event?.preventDefault) event.preventDefault();
    blockStartupReadonlyInteraction();
    return true;
  }
  if ((event.buttons & 1) !== 1) return true;
  const lonLat = getMapLonLatFromEvent(event);
  if (!lonLat) return true;
  renderPhysicalIntensityBrushPreview(lonLat);
  if (event?.preventDefault) event.preventDefault();
  if (rendererSurfaceHost.getInteractionRect()?.node && event.pointerId !== undefined) {
    try {
      rendererSurfaceHost.getInteractionRect().node().setPointerCapture(event.pointerId);
    } catch (_error) {
      // Pointer capture is best-effort across browser targets.
    }
  }
  const channel = getPhysicalIntensityChannel(tool.channelId);
  physicalIntensityDragSession = {
    pointerId: event.pointerId,
    channelId: tool.channelId,
    subMode: tool.subMode,
    brushRadiusDeg: tool.brushRadiusDeg,
    brushStrength: tool.brushStrength,
    before: captureHistoryState({ intensityFieldChannels: [tool.channelId] }),
    changed: false,
    pointId: "",
    pointDragMode: "move",
  };
  if (tool.subMode === "points") {
    const hit = getPhysicalIntensityPointHit(channel, lonLat);
    if (hit?.point) {
      setIntensityFieldTool({ selectedPointId: hit.point.id });
      physicalIntensityDragSession.pointId = hit.point.id;
      physicalIntensityDragSession.pointDragMode = hit.mode;
    } else {
      const point = createIntensityPoint(channel, lonLat, tool);
      channel.enabled = true;
      channel.points.push(point);
      setIntensityFieldTool({ selectedPointId: point.id });
      physicalIntensityDragSession.pointId = point.id;
      physicalIntensityDragSession.changed = true;
      schedulePhysicalIntensityRender(tool.channelId, "physical-intensity-point-add");
      refreshPhysicalIntensityUi();
    }
    return true;
  }
  applyPhysicalIntensityBrushAt(event);
  return true;
}

function handlePhysicalIntensityPointerMove(event) {
  updatePhysicalIntensityBrushPreviewFromEvent(event);
  if (!physicalIntensityDragSession) return false;
  if ((event.buttons & 1) !== 1) {
    commitPhysicalIntensitySession("physical-intensity-pointer-lost-buttons");
    return true;
  }
  if (event?.preventDefault) event.preventDefault();
  if (physicalIntensityDragSession.subMode === "points") {
    return applyPhysicalIntensityPointDrag(event);
  }
  return applyPhysicalIntensityBrushAt(event);
}

function handlePhysicalIntensityPointerEnd(event) {
  if (!physicalIntensityDragSession) return false;
  if (event?.preventDefault) event.preventDefault();
  updatePhysicalIntensityBrushPreviewFromEvent(event);
  commitPhysicalIntensitySession("physical-intensity-field-commit");
  return true;
}

function updateSpecialZoneEditorUI() {
  if (typeof runtimeState.updateSpecialZoneEditorUIFn === "function") {
    runtimeState.updateSpecialZoneEditorUIFn();
  }
}

function ensureManualSpecialZoneCounter() {
  ensureSpecialZoneEditorState();
  const used = new Set(
    getManualSpecialZoneFeatures().map((feature) => String(feature?.properties?.id || ""))
  );
  let counter = Math.max(1, Number(runtimeState.specialZoneEditor.counter) || 1);
  while (used.has(`manual_sz_${counter}`)) {
    counter += 1;
  }
  runtimeState.specialZoneEditor.counter = counter;
}

function ensureOperationGraphicCounter() {
  ensureOperationGraphicsEditorState();
  const used = new Set((runtimeState.operationGraphics || []).map((graphic) => String(graphic?.id || "")));
  let counter = Math.max(1, Number(runtimeState.operationGraphicsEditor.counter) || 1);
  while (used.has(`opg_${counter}`)) {
    counter += 1;
  }
  runtimeState.operationGraphicsEditor.counter = counter;
}

function ensureOperationalLineCounter() {
  ensureOperationalLineEditorState();
  const used = new Set((runtimeState.operationalLines || []).map((line) => String(line?.id || "")));
  let counter = Math.max(1, Number(runtimeState.operationalLineEditor.counter) || 1);
  while (used.has(`opl_${counter}`)) {
    counter += 1;
  }
  runtimeState.operationalLineEditor.counter = counter;
}

function ensureUnitCounterCounter() {
  ensureUnitCounterEditorState();
  const used = new Set((runtimeState.unitCounters || []).map((counter) => String(counter?.id || "")));
  let counter = Math.max(1, Number(runtimeState.unitCounterEditor.counter) || 1);
  while (used.has(`unit_${counter}`)) {
    counter += 1;
  }
  runtimeState.unitCounterEditor.counter = counter;
}

function handleMouseMove(event) {
  getMapHoverInteractionOwner().handleMouseMove(event);
}

function addRecentColor(color) {
  if (!color) return;
  runtimeState.recentColors = runtimeState.recentColors.filter((value) => value !== color);
  runtimeState.recentColors.unshift(color);
  if (runtimeState.recentColors.length > 4) {
    runtimeState.recentColors = runtimeState.recentColors.slice(0, 4);
  }
  if (typeof runtimeState.updateRecentUI === "function") {
    runtimeState.updateRecentUI();
  }
}

function commitHistoryEntry({ kind, before, after, affectsSovereignty = false } = {}) {
  pushHistoryEntry({
    kind: String(kind || "interaction"),
    before: before || {},
    after: after || {},
    meta: {
      affectsSovereignty: !!affectsSovereignty,
    },
  });
}

function getSpecialZoneMembershipTool() {
  const tool = String(runtimeState.specialZoneMembershipTool || "multi").trim();
  return tool === "single" || tool === "multi" || tool === "brush" ? tool : "multi";
}

function getSpecialZoneMembershipBrushMode() {
  const mode = String(runtimeState.specialZoneMembershipBrushMode || "add").trim();
  return mode === "remove" ? "remove" : "add";
}

let specialZonesWorkbenchCurrentTargetSignature = "";

function refreshSpecialZonesWorkbenchUi() {
  specialZonesWorkbenchCurrentTargetSignature = getSpecialZonesWorkbenchCurrentTargetSignature();
  if (typeof runtimeState.updateSpecialZonesWorkbenchUIFn === "function") {
    runtimeState.updateSpecialZonesWorkbenchUIFn();
  }
}

function refreshSpecialZonesWorkbenchCurrentTargetUi() {
  specialZonesWorkbenchCurrentTargetSignature = getSpecialZonesWorkbenchCurrentTargetSignature();
  if (typeof runtimeState.updateSpecialZonesWorkbenchCurrentTargetUIFn === "function") {
    runtimeState.updateSpecialZonesWorkbenchCurrentTargetUIFn();
  }
}

function refreshSpecialZonesWorkbenchCurrentTargetUiIfChanged() {
  const nextSignature = getSpecialZonesWorkbenchCurrentTargetSignature();
  if (nextSignature === specialZonesWorkbenchCurrentTargetSignature) return;
  refreshSpecialZonesWorkbenchCurrentTargetUi();
}

function handleSpecialZoneMembershipClick(hit, event) {
  if (runtimeState.currentTool !== "special-zone-membership") return false;
  const featureId = hit?.targetType === "land" ? String(hit.id || "").trim() : "";
  if (!featureId || !runtimeState.landIndex?.has(featureId)) return true;
  getStrategicOverlayRuntimeOwner().commitSpecialZoneMembershipClick({
    featureId,
    membershipTool: getSpecialZoneMembershipTool(),
    brushMode: getSpecialZoneMembershipBrushMode(),
  });
  return true;
}

function getCountryFeatureIds(countryCode) {
  if (!countryCode || !(runtimeState.countryToFeatureIds instanceof Map)) return [];
  const ids = runtimeState.countryToFeatureIds.get(countryCode);
  if (!Array.isArray(ids)) return [];
  return ids.filter((candidateId) => {
    const candidateFeature = runtimeState.landIndex?.get(candidateId);
    return candidateFeature && !shouldExcludePoliticalInteractionFeature(candidateFeature, candidateId);
  });
}

function getScenarioOwnerFeatureIds(ownerTag) {
  const normalizedOwnerTag = String(ownerTag || "").trim().toUpperCase();
  if (!normalizedOwnerTag || !(runtimeState.ownerToFeatureIds instanceof Map)) return [];
  const ids = runtimeState.ownerToFeatureIds.get(normalizedOwnerTag);
  if (!Array.isArray(ids)) return [];
  return ids.filter((candidateId) => {
    const candidateFeature = runtimeState.landIndex?.get(candidateId);
    return candidateFeature && !shouldExcludePoliticalInteractionFeature(candidateFeature, candidateId);
  });
}

function getInteractionCountryFeatureIds(feature, featureId) {
  const interactionCountryCode = getFeatureInteractionCountryCodeNormalized(feature, featureId);
  const ownerIds = interactionCountryCode ? getScenarioOwnerFeatureIds(interactionCountryCode) : [];
  if (ownerIds.length) return ownerIds;

  const runtimeCountryCode = getFeatureCountryCodeNormalized(feature);
  const runtimeIds = runtimeCountryCode ? getCountryFeatureIds(runtimeCountryCode) : [];
  if (runtimeIds.length) return runtimeIds;

  return interactionCountryCode ? getCountryFeatureIds(interactionCountryCode) : [];
}

function getCountryInteractionPolicy(countryCode) {
  if (!countryCode || !(runtimeState.countryInteractionPoliciesByCode instanceof Map)) return null;
  return runtimeState.countryInteractionPoliciesByCode.get(countryCode) || null;
}

function shouldRequireLeafDetail(countryCode) {
  const policy = getCountryInteractionPolicy(countryCode);
  if (!policy?.requiresComposite) return false;
  if (isSovereigntyModeActive()) return false;
  return runtimeState.interactionGranularity !== "country";
}

function hasLeafDetailReady(countryCode) {
  if (!shouldRequireLeafDetail(countryCode)) return true;
  if (runtimeState.topologyBundleMode !== "composite") return false;
  return getCountryFeatureIds(countryCode).length > 1;
}

function showDetailPromotionToast(message, { title = "", tone = "info", duration = 2600 } = {}) {
  const nextMessage = String(message || "").trim();
  if (!nextMessage) return;
  const now = Date.now();
  const token = `${tone}::${title}::${nextMessage}`;
  if (token === lastDetailToastToken && now - lastDetailToastAt < 1400) {
    return;
  }
  lastDetailToastToken = token;
  lastDetailToastAt = now;
  showToast(nextMessage, { title, tone, duration });
}

function blockStartupReadonlyInteraction() {
  if (!runtimeState.startupReadonly) return false;
  showDetailPromotionToast(t("Detailed interactions are still loading. Pan and zoom remain available.", "ui"), {
    title: t("Startup is still read-only", "ui"),
    tone: "info",
    duration: 2200,
  });
  return true;
}

function requestLeafDetailPromotion(countryCode, { announce = false } = {}) {
  if (!shouldRequireLeafDetail(countryCode)) return true;
  if (hasLeafDetailReady(countryCode)) return true;

  if (announce) {
    showDetailPromotionToast("Loading detailed subdivisions for this country…", {
      title: "Detail layer",
      tone: "info",
    });
  }

  if (!runtimeState.detailPromotionInFlight && typeof runtimeState.ensureDetailTopologyFn === "function") {
    void runtimeState.ensureDetailTopologyFn();
  }
  return false;
}

async function ensureLeafDetailReady(countryCode, { announce = false } = {}) {
  if (!shouldRequireLeafDetail(countryCode)) return true;
  if (hasLeafDetailReady(countryCode)) return true;

  if (announce) {
    showDetailPromotionToast("Loading detailed subdivisions for this country…", {
      title: "Detail layer",
      tone: "info",
      duration: 2200,
    });
  }

  if (typeof runtimeState.ensureDetailTopologyFn !== "function") {
    showDetailPromotionToast("Detailed subdivisions are unavailable in the current session.", {
      title: "Detail layer unavailable",
      tone: "warning",
      duration: 3200,
    });
    return false;
  }

  const promoted = await runtimeState.ensureDetailTopologyFn();
  if (!promoted || !hasLeafDetailReady(countryCode)) {
    showDetailPromotionToast("Detailed subdivisions could not be loaded. Keep the detail layer enabled and try again.", {
      title: "Detail layer unavailable",
      tone: "warning",
      duration: 3600,
    });
    return false;
  }
  return true;
}

function collectCountryCodesForFeatureIds(featureIds) {
  const codes = new Set();
  (Array.isArray(featureIds) ? featureIds : []).forEach((featureId) => {
    const feature = runtimeState.landIndex?.get(featureId);
    const code = feature ? getFeatureCountryCodeNormalized(feature) : "";
    if (code) {
      codes.add(code);
    }
  });
  return Array.from(codes);
}

function syncInspectorCountryToLandSelection(feature, featureId, hit = null) {
  const ownerCode = canonicalCountryCode(getFeatureOwnerCode(featureId));
  const featureCode = canonicalCountryCode(
    ownerCode
      || hit?.countryCode
      || getFeatureCountryCodeNormalized(feature)
      || getFeatureInteractionCountryCodeNormalized(feature, featureId)
  );
  const nextCode = ownerCode || featureCode;
  if (!nextCode) return false;

  const previousCode = canonicalCountryCode(runtimeState.selectedInspectorCountryCode);
  runtimeState.selectedInspectorCountryCode = nextCode;
  runtimeState.inspectorHighlightCountryCode = nextCode;
  runtimeState.inspectorHighlightFeatureIds = [];
  runtimeState.inspectorHighlightGroupMode = false;
  runtimeState.inspectorHighlightLabel = "";
  runtimeState.inspectorOverlayDirty = true;

  if (typeof runtimeState.refreshCountryListRowsFn === "function") {
    runtimeState.refreshCountryListRowsFn({
      countryCodes: Array.from(new Set([previousCode, nextCode].filter(Boolean))),
      refreshInspector: true,
      refreshPresetTree: true,
    });
  } else if (typeof runtimeState.renderPresetTreeFn === "function") {
    runtimeState.renderPresetTreeFn();
  }
  return nextCode !== previousCode;
}

export function setInspectorFeatureHighlight(featureIds = [], {
  groupMode = false,
  label = "",
} = {}) {
  const nextFeatureIds = Array.isArray(featureIds)
    ? Array.from(new Set(featureIds.map((id) => String(id || "").trim()).filter(Boolean)))
    : [];
  runtimeState.inspectorHighlightFeatureIds = nextFeatureIds;
  runtimeState.inspectorHighlightGroupMode = nextFeatureIds.length > 0 && groupMode === true;
  runtimeState.inspectorHighlightLabel = String(label || "").trim();
  runtimeState.inspectorHighlightCountryCode = "";
  runtimeState.inspectorOverlayDirty = true;
  renderInspectorHighlightOverlayIfNeeded({ force: true });
}

function hasSelectedOrActiveCountryImpact(countryCodes = []) {
  const impactedCodes = new Set((Array.isArray(countryCodes) ? countryCodes : [])
    .map((code) => canonicalCountryCode(code))
    .filter(Boolean));
  const selectedCode = canonicalCountryCode(runtimeState.selectedInspectorCountryCode);
  const activeCode = canonicalCountryCode(runtimeState.activeSovereignCode);
  return !!(
    (selectedCode && impactedCodes.has(selectedCode))
    || (activeCode && impactedCodes.has(activeCode))
  );
}

function refreshSidebarAfterPaint({
  featureIds = [],
  waterRegionIds = [],
  specialRegionIds = [],
  ownerCodes = [],
  refreshPresetTree = false,
} = {}) {
  scheduleSidebarRefresh({
    featureIds,
    waterRegionIds,
    specialRegionIds,
    ownerCodes,
    refreshPresetTree,
  });
}

function requestInteractionRender(reason = "interaction") {
  return getRenderRequestBoundaryOwner().requestInteractionRenderBoundary(reason).completed;
}

function flushInteractionRender(reason = "interaction") {
  return getRenderRequestBoundaryOwner().flushInteractionRenderBoundary(reason).completed;
}

function requestRendererRender(reason = "renderer", { flush = false, fallback = null } = {}) {
  return getRenderRequestBoundaryOwner().requestRendererRenderBoundary(reason, {
    flush,
    fallback,
  }).completed;
}

function normalizeDevInteractionHit(hit = null) {
  if (!hit?.id) return null;
  const targetType = String(hit.targetType || "");
  const normalized = {
    id: String(hit.id || "").trim(),
    targetType,
    countryCode: String(hit.countryCode || "").trim().toUpperCase(),
    hitSource: String(hit.hitSource || "spatial"),
    viaSnap: !!hit.viaSnap,
    strict: !!hit.strict,
  };
  if (targetType === "hgo") {
    const hgoRuntime = normalizeHgoRuntimeHitPayload(hit.hgoRuntime);
    if (hgoRuntime) {
      normalized.hgoRuntime = hgoRuntime;
    }
  }
  return normalized;
}

function normalizeHgoRuntimeHitPayload(payload = null) {
  return getHgoRuntimePreviewRenderOwner().normalizeHitPayload(payload);
}

function getDevInteractionHitSignature(hit = null) {
  if (!hit?.id) return "";
  return [
    String(hit.id || "").trim(),
    String(hit.targetType || ""),
    String(hit.countryCode || "").trim().toUpperCase(),
    String(hit.hitSource || "spatial"),
    hit.viaSnap ? "snap" : "direct",
    hit.strict ? "strict" : "loose",
  ].join("|");
}

function getSpecialZonesWorkbenchCurrentTargetSignature() {
  const selectedId = runtimeState.devSelectedHit?.targetType === "land"
    ? String(runtimeState.devSelectedHit.id || "").trim()
    : "";
  const hoverHitId = runtimeState.devHoverHit?.targetType === "land"
    ? String(runtimeState.devHoverHit.id || "").trim()
    : "";
  const hoveredId = String(runtimeState.hoveredId || "").trim();
  return selectedId || hoverHitId || hoveredId || "";
}

function notifyDevWorkspace() {
  if (typeof runtimeState.updateDevWorkspaceUIFn === "function") {
    runtimeState.updateDevWorkspaceUIFn();
  }
}

function isDevSelectionEligibleFeature(feature, featureId = null) {
  return !!feature
    && !shouldExcludePoliticalInteractionFeature(feature, featureId)
    && !isAtlantropaSeaFeature(feature);
}

function setDevSelectionDirty() {
  runtimeState.devSelectionOverlayDirty = true;
  runtimeState.devClipboardFallbackText = "";
  notifyDevWorkspace();
  refreshSpecialZonesWorkbenchUi();
  if (typeof runtimeState.refreshCountryListRowsFn === "function") {
    const selectedCode = canonicalCountryCode(runtimeState.selectedInspectorCountryCode);
    runtimeState.refreshCountryListRowsFn({
      countryCodes: selectedCode ? [selectedCode] : [],
      refreshInspector: true,
      refreshPresetTree: true,
    });
  } else if (typeof runtimeState.refreshCountryInspectorDetailFn === "function") {
    runtimeState.refreshCountryInspectorDetailFn();
  }
}

function updateDevHoverHit(hit = null) {
  const previousHitSignature = getDevInteractionHitSignature(runtimeState.devHoverHit);
  runtimeState.devHoverHit = normalizeDevInteractionHit(hit);
  const nextHitSignature = getDevInteractionHitSignature(runtimeState.devHoverHit);
  if (nextHitSignature !== previousHitSignature) {
    notifyDevWorkspace();
  }
  refreshSpecialZonesWorkbenchCurrentTargetUiIfChanged();
}

function updateDevSelectedHit(hit = null) {
  const previousHitSignature = getDevInteractionHitSignature(runtimeState.devSelectedHit);
  runtimeState.devSelectedHit = normalizeDevInteractionHit(hit);
  const nextHitSignature = getDevInteractionHitSignature(runtimeState.devSelectedHit);
  if (nextHitSignature === previousHitSignature) {
    return;
  }
  notifyDevWorkspace();
  refreshSpecialZonesWorkbenchCurrentTargetUiIfChanged();
}

function getDevSelectionIds() {
  const rawIds = Array.isArray(runtimeState.devSelectionOrder)
    ? runtimeState.devSelectionOrder.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const nextIds = [];
  const seen = new Set();
  rawIds.forEach((id) => {
    if (!id || seen.has(id)) return;
    const feature = runtimeState.landIndex?.get(id);
    if (!isDevSelectionEligibleFeature(feature, id)) return;
    seen.add(id);
    nextIds.push(id);
  });
  const changed = rawIds.length !== nextIds.length || rawIds.some((id, index) => id !== nextIds[index]);
  if (changed) {
    runtimeState.devSelectionOrder = nextIds;
    runtimeState.devSelectionFeatureIds = new Set(nextIds);
    runtimeState.devClipboardFallbackText = "";
    runtimeState.devSelectionOverlayDirty = true;
  } else if (!(runtimeState.devSelectionFeatureIds instanceof Set)) {
    runtimeState.devSelectionFeatureIds = new Set(nextIds);
  }
  return nextIds;
}

function addFeatureToDevSelection(featureId) {
  const id = String(featureId || "").trim();
  const feature = id ? runtimeState.landIndex?.get(id) : null;
  if (!isDevSelectionEligibleFeature(feature, id)) return false;
  runtimeState.devSelectionFeatureIds = runtimeState.devSelectionFeatureIds instanceof Set
    ? runtimeState.devSelectionFeatureIds
    : new Set();
  runtimeState.devSelectionOrder = getDevSelectionIds();
  if (runtimeState.devSelectionFeatureIds.has(id)) {
    return false;
  }
  const limit = Math.max(1, Number(runtimeState.devSelectionLimit) || 200);
  if (runtimeState.devSelectionOrder.length >= limit) {
    showToast(
      runtimeState.currentLanguage === "zh"
        ? `开发多选已达到上限（${limit}）。`
        : `Selection limit reached (${limit}).`,
      {
      title: t("Dev Workspace", "ui"),
      tone: "warning",
      duration: 3600,
    });
    return false;
  }
  runtimeState.devSelectionFeatureIds.add(id);
  runtimeState.devSelectionOrder.push(id);
  setDevSelectionDirty();
  requestInteractionRender("dev-selection-add");
  return true;
}

function toggleFeatureInDevSelection(featureId) {
  const id = String(featureId || "").trim();
  const feature = id ? runtimeState.landIndex?.get(id) : null;
  if (!isDevSelectionEligibleFeature(feature, id)) return false;
  runtimeState.devSelectionFeatureIds = runtimeState.devSelectionFeatureIds instanceof Set
    ? runtimeState.devSelectionFeatureIds
    : new Set();
  runtimeState.devSelectionOrder = getDevSelectionIds();
  if (runtimeState.devSelectionFeatureIds.has(id)) {
    runtimeState.devSelectionFeatureIds.delete(id);
    runtimeState.devSelectionOrder = runtimeState.devSelectionOrder.filter((value) => value !== id);
    setDevSelectionDirty();
    requestInteractionRender("dev-selection-toggle");
    return true;
  }
  return addFeatureToDevSelection(id);
}

function removeLastDevSelection() {
  const ids = getDevSelectionIds();
  if (!ids.length) return false;
  const lastId = ids[ids.length - 1];
  runtimeState.devSelectionFeatureIds.delete(lastId);
  runtimeState.devSelectionOrder = ids.slice(0, -1);
  setDevSelectionDirty();
  requestInteractionRender("dev-selection-remove-last");
  return true;
}

function clearDevSelection() {
  const hadEntries = getDevSelectionIds().length > 0;
  runtimeState.devSelectionFeatureIds = new Set();
  runtimeState.devSelectionOrder = [];
  if (hadEntries) {
    setDevSelectionDirty();
    requestInteractionRender("dev-selection-clear");
  } else {
    notifyDevWorkspace();
  }
  return hadEntries;
}

function getDevWorkspaceActiveLandContext() {
  const selectedHit = runtimeState.devSelectedHit;
  const selectedId = selectedHit?.targetType === "land" ? String(selectedHit.id || "").trim() : "";
  const hoveredId = String(runtimeState.hoveredId || "").trim();
  const featureId = selectedId || hoveredId;
  if (!featureId) return null;
  const feature = runtimeState.landIndex?.get(featureId);
  if (!isDevSelectionEligibleFeature(feature, featureId)) return null;
  const countryCode = getFeatureCountryCodeNormalized(feature);
  return {
    featureId,
    feature,
    countryCode,
  };
}

function applyVisualFillToResolvedIds(targetIds, selectedColor, kind, dirtyReason) {
  const resolvedIds = normalizeFeatureOverrideTargetIds(targetIds);
  if (!resolvedIds.length) return false;
  return applyVisualSubdivisionFill(resolvedIds, selectedColor, {
    kind,
    dirtyReason,
  });
}

function eraseVisualOverridesForIds(targetIds, { kind, dirtyReason } = {}) {
  const actionStart = nowMs();
  const resolvedIds = normalizeFeatureOverrideTargetIds(targetIds);
  if (!resolvedIds.length) return false;
  const historyBefore = captureHistoryState({
    featureIds: resolvedIds,
  });
  applyFeatureVisualOverrideTransaction(resolvedIds, null, {
    remove: true,
    inputStartedAt: actionStart,
    inputLabel: kind || "erase-feature-color",
  });
  markDirty(dirtyReason || kind || "erase-feature-color");
  commitHistoryEntry({
    kind: kind || "erase-feature-color",
    before: historyBefore,
    after: captureHistoryState({
      featureIds: resolvedIds,
    }),
  });
  if (rendererSurfaceHost.getContext()) {
    render();
  }
  refreshSidebarAfterPaint({ featureIds: resolvedIds });
  return true;
}

function applySovereigntyFillToIds(targetIds, { kind, dirtyReason, recomputeReason } = {}) {
  const resolvedIds = Array.from(new Set((Array.isArray(targetIds) ? targetIds : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean)));
  if (!resolvedIds.length) return false;
  if (!runtimeState.activeSovereignCode) {
    showToast(t("No active sovereign selected.", "ui"), {
      title: t("Dev Workspace", "ui"),
      tone: "warning",
    });
    return false;
  }
  const historyBefore = captureHistoryState({
    sovereigntyFeatureIds: resolvedIds,
  });
  const changed = setFeatureOwnerCodes(resolvedIds, runtimeState.activeSovereignCode);
  refreshResolvedColorsForFeatures(resolvedIds, { renderNow: false });
  if (changed > 0) {
    scheduleDynamicBorderRecompute(recomputeReason || kind || "dev-workspace-sovereignty-fill", 90);
    markDirty(dirtyReason || kind || "fill-sovereignty");
    commitHistoryEntry({
      kind: kind || "fill-sovereignty",
      before: historyBefore,
      after: captureHistoryState({
        sovereigntyFeatureIds: resolvedIds,
      }),
      affectsSovereignty: true,
    });
    if (rendererSurfaceHost.getContext()) {
      render();
    }
    refreshSidebarAfterPaint({ featureIds: resolvedIds });
    return true;
  }
  return false;
}

function eraseSovereigntyForIds(targetIds, { kind, dirtyReason, recomputeReason } = {}) {
  const resolvedIds = Array.from(new Set((Array.isArray(targetIds) ? targetIds : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean)));
  if (!resolvedIds.length) return false;
  const historyBefore = captureHistoryState({
    sovereigntyFeatureIds: resolvedIds,
  });
  const changed = resetFeatureOwnerCodes(resolvedIds);
  refreshResolvedColorsForFeatures(resolvedIds, { renderNow: false });
  if (changed > 0) {
    scheduleDynamicBorderRecompute(recomputeReason || kind || "dev-workspace-sovereignty-reset", 90);
    markDirty(dirtyReason || kind || "erase-sovereignty");
    commitHistoryEntry({
      kind: kind || "erase-sovereignty",
      before: historyBefore,
      after: captureHistoryState({
        sovereigntyFeatureIds: resolvedIds,
      }),
      affectsSovereignty: true,
    });
    if (rendererSurfaceHost.getContext()) {
      render();
    }
    refreshSidebarAfterPaint({ featureIds: resolvedIds });
    return true;
  }
  return false;
}

function applyDevLandBatchAction(targetIds, {
  ownerCodes = [],
  visualKind = "dev-batch-fill",
  visualDirtyReason = visualKind,
  sovereigntyFillKind = "dev-batch-sovereignty-fill",
  sovereigntyEraseKind = "dev-batch-sovereignty-reset",
  recomputeReason = "dev-batch",
} = {}) {
  const resolvedIds = Array.from(new Set((Array.isArray(targetIds) ? targetIds : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean)));
  if (!resolvedIds.length) return false;
  if (runtimeState.currentTool === "eyedropper") {
    showToast(t("Switch to Fill or Eraser before running a batch action.", "ui"), {
      title: t("Dev Workspace", "ui"),
      tone: "warning",
    });
    return false;
  }
  if (isSovereigntyModeActive()) {
    return runtimeState.currentTool === "eraser"
      ? eraseSovereigntyForIds(resolvedIds, {
        kind: sovereigntyEraseKind,
        dirtyReason: sovereigntyEraseKind,
        recomputeReason,
      })
      : applySovereigntyFillToIds(resolvedIds, {
        kind: sovereigntyFillKind,
        dirtyReason: sovereigntyFillKind,
        recomputeReason,
      });
  }
  if (runtimeState.currentTool === "eraser") {
    return eraseVisualOverridesForIds(resolvedIds, {
      kind: `${visualKind}-erase`,
      dirtyReason: `${visualDirtyReason}-erase`,
    });
  }
  const color = getSafeCanvasColor(runtimeState.selectedColor, LAND_FILL_COLOR);
  if (ownerCodes.length === 1) {
    refreshSidebarAfterPaint({
      featureIds: resolvedIds,
      ownerCodes,
    });
  }
  return applyVisualFillToResolvedIds(resolvedIds, color, visualKind, visualDirtyReason);
}

function applyDevMacroFillCurrentCountry() {
  const contextInfo = getDevWorkspaceActiveLandContext();
  if (!contextInfo?.countryCode) {
    showToast(t("Select or hover a land feature first.", "ui"), {
      title: t("Dev Workspace", "ui"),
      tone: "warning",
    });
    return false;
  }
  const ids = getCountryFeatureIds(contextInfo.countryCode);
  if (!ids.length) return false;
  return applyDevLandBatchAction(ids, {
    ownerCodes: [contextInfo.countryCode],
    visualKind: "dev-fill-country",
    visualDirtyReason: "dev-fill-country",
    sovereigntyFillKind: "dev-fill-country-sovereignty",
    sovereigntyEraseKind: "dev-erase-country-sovereignty",
    recomputeReason: "dev-fill-country",
  });
}

function applyDevMacroFillCurrentParentGroup() {
  const contextInfo = getDevWorkspaceActiveLandContext();
  if (!contextInfo) {
    showToast(t("Select or hover a land feature first.", "ui"), {
      title: t("Dev Workspace", "ui"),
      tone: "warning",
    });
    return false;
  }
  const ids = resolveParentGroupTargetIds(contextInfo.feature, contextInfo.featureId);
  if (!ids.length) {
    showToast(t("No parent group is available for this feature.", "ui"), {
      title: t("Dev Workspace", "ui"),
      tone: "warning",
    });
    return false;
  }
  return applyDevLandBatchAction(ids, {
    visualKind: "dev-fill-parent-group",
    visualDirtyReason: "dev-fill-parent-group",
    sovereigntyFillKind: "dev-fill-parent-group-sovereignty",
    sovereigntyEraseKind: "dev-erase-parent-group-sovereignty",
    recomputeReason: "dev-fill-parent-group",
  });
}

function applyDevMacroFillCurrentOwnerScope() {
  const contextInfo = getDevWorkspaceActiveLandContext();
  if (!contextInfo) {
    showToast(t("Select or hover a land feature first.", "ui"), {
      title: t("Dev Workspace", "ui"),
      tone: "warning",
    });
    return false;
  }
  const ownerCode = getFeatureOwnerCode(contextInfo.featureId) || contextInfo.countryCode;
  const ids = getFeatureIdsForOwner(ownerCode)
    .map((value) => String(value || "").trim())
    .filter((featureId) => featureId && runtimeState.landIndex?.has(featureId));
  if (!ids.length) {
    showToast(t("No owner scope is available for this feature.", "ui"), {
      title: t("Dev Workspace", "ui"),
      tone: "warning",
    });
    return false;
  }
  return applyDevLandBatchAction(ids, {
    ownerCodes: ownerCode ? [ownerCode] : [],
    visualKind: "dev-fill-owner-scope",
    visualDirtyReason: "dev-fill-owner-scope",
    sovereigntyFillKind: "dev-fill-owner-scope-sovereignty",
    sovereigntyEraseKind: "dev-erase-owner-scope-sovereignty",
    recomputeReason: "dev-fill-owner-scope",
  });
}

function applyDevSelectionFill() {
  const ids = getDevSelectionIds();
  if (!ids.length) {
    showToast(t("No selected regions in the development selection.", "ui"), {
      title: t("Dev Workspace", "ui"),
      tone: "warning",
    });
    return false;
  }
  return applyDevLandBatchAction(ids, {
    visualKind: "dev-fill-selection",
    visualDirtyReason: "dev-fill-selection",
    sovereigntyFillKind: "dev-fill-selection-sovereignty",
    sovereigntyEraseKind: "dev-erase-selection-sovereignty",
    recomputeReason: "dev-fill-selection",
  });
}

function resolveInteractionTargetIds(feature, id) {
  if (shouldExcludePoliticalInteractionFeature(feature, id)) {
    return [];
  }
  if (isSovereigntyModeActive()) {
    return [id];
  }
  if (runtimeState.interactionGranularity !== "country") {
    return [id];
  }
  const countryCode = getFeatureInteractionCountryCodeNormalized(feature, id);
  if (!countryCode) {
    return [id];
  }
  const ids = getInteractionCountryFeatureIds(feature, id);
  return ids.length ? ids : [id];
}

function isBrushNavigationModifier(event) {
  return !!(runtimeState.brushModeEnabled && event?.shiftKey);
}

function shouldAllowZoomEvent(event) {
  const type = String(event?.type || "").toLowerCase();
  if (type === "wheel") return true;
  if (type.startsWith("touch")) return true;
  if (event?.ctrlKey) return false;
  if (typeof event?.button === "number" && event.button !== 0) return false;
  if (runtimeState.specialZoneEditor?.active) return false;
  if (runtimeState.brushModeEnabled) {
    return isBrushNavigationModifier(event);
  }
  return true;
}

function dismissOnboardingHint() {
  if (typeof runtimeState.dismissOnboardingHintFn === "function") {
    runtimeState.dismissOnboardingHintFn();
  }
}

function resolveParentGroupKey(feature, featureId) {
  const scenarioDistrictGroup = String(runtimeState.scenarioDistrictGroupByFeatureId?.get(featureId) || "").trim();
  const scenarioOwnerTag = String(runtimeState.sovereigntyByFeatureId?.[featureId] || "").trim().toUpperCase();
  const scopeCode = scenarioDistrictGroup && scenarioOwnerTag
    ? scenarioOwnerTag
    : getFeatureInteractionCountryCodeNormalized(feature, featureId);
  if (!scopeCode) return "";
  const directGroup = getAdmin1Group(feature);
  const groupName = String(scenarioDistrictGroup || runtimeState.parentGroupByFeatureId?.get(featureId) || directGroup || "").trim();
  if (!groupName) return "";
  return `${scopeCode}::${groupName}`;
}

function resolveParentGroupTargetIds(feature, featureId) {
  if (!featureId || !runtimeState.landIndex?.has(featureId)) return [];
  if (shouldExcludePoliticalInteractionFeature(feature, featureId)) return [];
  const scenarioDistrictGroup = String(runtimeState.scenarioDistrictGroupByFeatureId?.get(featureId) || "").trim();
  const scenarioOwnerTag = String(runtimeState.sovereigntyByFeatureId?.[featureId] || "").trim().toUpperCase();
  const parentGroupKey = resolveParentGroupKey(feature, featureId);
  const ids = scenarioDistrictGroup && scenarioOwnerTag
    ? getScenarioOwnerFeatureIds(scenarioOwnerTag)
    : getInteractionCountryFeatureIds(feature, featureId);
  if (!parentGroupKey || !ids.length) return [];
  const targetIds = ids.filter((candidateId) => {
    const candidateFeature = runtimeState.landIndex.get(candidateId);
    if (!candidateFeature) return false;
    if (shouldExcludePoliticalInteractionFeature(candidateFeature, candidateId)) return false;
    return resolveParentGroupKey(candidateFeature, candidateId) === parentGroupKey;
  });
  if (targetIds.length < 2) return [];
  return Array.from(new Set(targetIds));
}

function resolveSpecialZoneParentGroupTargetIds(featureId) {
  const id = String(featureId || "").trim();
  const feature = id ? runtimeState.landIndex?.get(id) : null;
  if (!feature) return [];
  return resolveParentGroupTargetIds(feature, id);
}

function resolveCountryFillTargetIds(feature, featureId, { allowWhenParentGrouping = false } = {}) {
  if (!featureId || !runtimeState.landIndex?.has(featureId)) return [];
  if (shouldExcludePoliticalInteractionFeature(feature, featureId)) return [];
  const countryCode = getFeatureInteractionCountryCodeNormalized(feature, featureId);
  if (!countryCode) return [];
  const ids = getInteractionCountryFeatureIds(feature, featureId).filter((candidateId) => {
    const candidateFeature = runtimeState.landIndex.get(candidateId);
    return candidateFeature && !shouldExcludePoliticalInteractionFeature(candidateFeature, candidateId);
  });
  if (ids.length < 2) return [];

  if (!allowWhenParentGrouping) {
    const hasParentGrouping = ids.some((candidateId) => {
      const candidateFeature = runtimeState.landIndex.get(candidateId);
      if (!candidateFeature) return false;
      return !!resolveParentGroupKey(candidateFeature, candidateId);
    });
    if (hasParentGrouping) return [];
  }

  return ids;
}

function isBatchFillDoubleClickBaseEligible(hit, feature) {
  if (!hit?.id || !feature) return false;
  if (runtimeState.currentTool !== "fill") return false;
  if (isSovereigntyModeActive()) return false;
  if (runtimeState.interactionGranularity !== "subdivision") return false;
  if (runtimeState.brushModeEnabled) return false;
  if (runtimeState.specialZoneEditor?.active) return false;
  return true;
}

function buildDoubleClickBatchPlan(feature, featureId) {
  if (!feature || !featureId) return null;
  if (shouldExcludePoliticalInteractionFeature(feature, featureId)) return null;
  const requestedScope = String(runtimeState.batchFillScope || "parent") === "country" ? "country" : "parent";
  if (requestedScope === "parent") {
    const parentTargetIds = resolveParentGroupTargetIds(feature, featureId);
    if (parentTargetIds.length >= 2) {
      return {
        targetIds: parentTargetIds,
        kind: "fill-parent-group",
        dirtyReason: "fill-parent-group",
        fallbackToCountry: false,
      };
    }
  }

  const countryTargetIds = resolveCountryFillTargetIds(feature, featureId, {
    allowWhenParentGrouping: true,
  });
  if (countryTargetIds.length >= 2) {
    return {
      targetIds: countryTargetIds,
      kind: "fill-country-batch",
      dirtyReason: "fill-country-batch",
      fallbackToCountry: requestedScope === "parent",
    };
  }
  return null;
}

function isDoubleClickBatchEligible(hit, feature) {
  if (!isBatchFillDoubleClickBaseEligible(hit, feature)) return false;
  return !!buildDoubleClickBatchPlan(feature, hit.id);
}

function applyVisualSubdivisionFill(targetIds, selectedColor, { kind = "fill-feature-color", dirtyReason = kind } = {}) {
  const actionStart = nowMs();
  const resolvedIds = normalizeFeatureOverrideTargetIds(targetIds);
  if (!resolvedIds.length) return false;
  const color = getSafeCanvasColor(selectedColor, LAND_FILL_COLOR);
  const historyBefore = captureHistoryState({
    featureIds: resolvedIds,
  });
  applyFeatureVisualOverrideTransaction(resolvedIds, color, {
    inputStartedAt: actionStart,
    inputLabel: kind || "fill-feature-color",
  });
  markDirty(dirtyReason);
  commitHistoryEntry({
    kind,
    before: historyBefore,
    after: captureHistoryState({
      featureIds: resolvedIds,
    }),
  });
  addRecentColor(color);
  requestInteractionRender(kind);
  refreshSidebarAfterPaint({ featureIds: resolvedIds });
  noteRenderAction(kind, actionStart);
  return true;
}

function applyWaterRegionFill(targetId, selectedColor, { kind = "fill-water-region-color", dirtyReason = kind } = {}) {
  const actionStart = nowMs();
  const resolvedId = String(targetId || "").trim();
  if (!resolvedId) return false;
  const defaultColor = getWaterRegionDefaultFillColorById(resolvedId);
  const color = getSafeCanvasColor(selectedColor, defaultColor);
  const currentColor = getWaterRegionColor(resolvedId);
  runtimeState.selectedWaterRegionId = resolvedId;
  if (currentColor === color) {
    refreshWaterRegionSidebarRowsNow([resolvedId]);
    requestInteractionRender(kind);
    return false;
  }
  const historyBefore = captureHistoryState({
    waterRegionIds: [resolvedId],
  });
  runtimeState.waterRegionOverrides[resolvedId] = color;
  markDirty(dirtyReason);
  commitHistoryEntry({
    kind,
    before: historyBefore,
    after: captureHistoryState({
      waterRegionIds: [resolvedId],
    }),
  });
  addRecentColor(color);
  requestInteractionRender(kind);
  refreshSidebarAfterPaint({ waterRegionIds: [resolvedId] });
  noteRenderAction(kind, actionStart);
  return true;
}

function executeSingleSubdivisionFill(action) {
  if (!action) return false;
  const targetIds = action.eventPayload?.targetIds || [action.featureId];
  return applyVisualSubdivisionFill(targetIds, action.selectedColor, {
    kind: "fill-feature-color",
    dirtyReason: "fill-feature-color",
  });
}

function executeDoubleClickBatchFill(feature, featureId) {
  if (!feature || !featureId) return false;
  const plan = buildDoubleClickBatchPlan(feature, featureId);
  if (!plan?.targetIds?.length) return false;
  if (plan.fallbackToCountry) {
    showDetailPromotionToast("No parent group was available here. Double-click fell back to country fill.", {
      title: "Quick fill scope",
      tone: "info",
      duration: 2400,
    });
  }
  return applyVisualSubdivisionFill(plan.targetIds, runtimeState.selectedColor, {
    kind: plan.kind,
    dirtyReason: plan.dirtyReason,
  });
}

function mergeHistorySnapshot(target, snapshot) {
  if (!snapshot || typeof snapshot !== "object") return;
  Object.entries(snapshot).forEach(([section, patch]) => {
    if (!patch || typeof patch !== "object") return;
    target[section] = target[section] || {};
    Object.assign(target[section], patch);
  });
}

function ensureBrushSession(event) {
  if (brushSession) return brushSession;
  brushSession = {
    active: true,
    dragging: false,
    startX: Number(event?.clientX || 0),
    startY: Number(event?.clientY || 0),
    visitedFeatureIds: new Set(),
    visitedWaterRegionIds: new Set(),
    visitedSpecialRegionIds: new Set(),
    visitedOwnerCodes: new Set(),
    affectedFeatureIds: new Set(),
    affectedWaterRegionIds: new Set(),
    affectedSpecialRegionIds: new Set(),
    affectedOwnerCodes: new Set(),
    affectedSovereigntyIds: new Set(),
    before: {},
    changed: false,
  };
  return brushSession;
}

function applyBrushHit(hit) {
  if (!hit?.id) return false;
  if (hit.targetType === "special") {
    const specialId = String(hit.id || "").trim();
    if (!specialId || brushSession.visitedSpecialRegionIds.has(specialId)) return false;
    return false;
  }
  if (hit.targetType === "water") {
    const waterId = String(hit.id || "").trim();
    if (!waterId || brushSession.visitedWaterRegionIds.has(waterId)) return false;
    if (runtimeState.currentTool === "eyedropper") return false;
    mergeHistorySnapshot(brushSession.before, captureHistoryState({ waterRegionIds: [waterId] }));
    brushSession.visitedWaterRegionIds.add(waterId);
    brushSession.affectedWaterRegionIds.add(waterId);
    if (runtimeState.currentTool === "eraser") {
      delete runtimeState.waterRegionOverrides[waterId];
    } else {
      runtimeState.waterRegionOverrides[waterId] = getSafeCanvasColor(
        runtimeState.selectedColor,
        getWaterRegionDefaultFillColorById(waterId)
      );
    }
    runtimeState.selectedWaterRegionId = waterId;
    brushSession.changed = true;
    return true;
  }
  const feature = runtimeState.landIndex.get(hit.id);
  if (!feature) return false;
  const id = hit.id;
  const countryCode = hit.countryCode || getFeatureCountryCodeNormalized(feature);
  if (!requestLeafDetailPromotion(countryCode, { announce: true })) {
    return false;
  }
  const targetIds = resolveInteractionTargetIds(feature, id);
  const selectedColor = getSafeCanvasColor(runtimeState.selectedColor, LAND_FILL_COLOR);

  if (runtimeState.currentTool === "eyedropper") return false;
  if (runtimeState.currentTool === "eraser") {
    if (isSovereigntyModeActive()) {
      const freshIds = targetIds.filter((targetId) => !brushSession.affectedSovereigntyIds.has(targetId));
      if (!freshIds.length) return false;
      mergeHistorySnapshot(brushSession.before, captureHistoryState({ sovereigntyFeatureIds: freshIds }));
      freshIds.forEach((targetId) => brushSession.affectedSovereigntyIds.add(targetId));
      const changed = resetFeatureOwnerCodes(freshIds);
      if (changed > 0) {
        brushSession.changed = true;
        refreshResolvedColorsForFeatures(freshIds, {
          renderNow: false,
          inputLabel: "brush-erase-feature-color",
        });
        scheduleDynamicBorderRecompute("brush-sovereignty-reset", 90);
        return true;
      }
      return false;
    }
    if (runtimeState.interactionGranularity === "country" && countryCode) {
      if (brushSession.visitedOwnerCodes.has(countryCode)) return false;
      brushSession.visitedOwnerCodes.add(countryCode);
      mergeHistorySnapshot(brushSession.before, captureHistoryState({ ownerCodes: [countryCode] }));
      brushSession.affectedOwnerCodes.add(countryCode);
      delete runtimeState.sovereignBaseColors[countryCode];
      delete runtimeState.countryBaseColors[countryCode];
      markLegacyColorStateDirty();
      refreshResolvedColorsForOwners([countryCode], { renderNow: false });
      brushSession.changed = true;
      return true;
    }
    const freshIds = targetIds.filter((targetId) => !brushSession.visitedFeatureIds.has(targetId));
    if (!freshIds.length) return false;
    mergeHistorySnapshot(brushSession.before, captureHistoryState({ featureIds: freshIds }));
    freshIds.forEach((targetId) => {
      brushSession.visitedFeatureIds.add(targetId);
      brushSession.affectedFeatureIds.add(targetId);
    });
    applyFeatureVisualOverrideTransaction(freshIds, null, {
      remove: true,
      inputLabel: "brush-erase-feature-color",
    });
    brushSession.changed = true;
    return true;
  }

  if (isSovereigntyModeActive()) {
    if (!runtimeState.activeSovereignCode) return false;
    const freshIds = targetIds.filter((targetId) => !brushSession.affectedSovereigntyIds.has(targetId));
    if (!freshIds.length) return false;
    mergeHistorySnapshot(brushSession.before, captureHistoryState({ sovereigntyFeatureIds: freshIds }));
    freshIds.forEach((targetId) => brushSession.affectedSovereigntyIds.add(targetId));
    const changed = setFeatureOwnerCodes(freshIds, runtimeState.activeSovereignCode);
    if (changed > 0) {
      brushSession.changed = true;
      refreshResolvedColorsForFeatures(freshIds, { renderNow: false });
      scheduleDynamicBorderRecompute("brush-sovereignty-fill", 90);
      return true;
    }
    return false;
  }

  if (runtimeState.interactionGranularity === "country" && countryCode) {
    if (brushSession.visitedOwnerCodes.has(countryCode)) return false;
    brushSession.visitedOwnerCodes.add(countryCode);
    mergeHistorySnapshot(brushSession.before, captureHistoryState({ ownerCodes: [countryCode] }));
    brushSession.affectedOwnerCodes.add(countryCode);
    runtimeState.sovereignBaseColors[countryCode] = selectedColor;
    runtimeState.countryBaseColors[countryCode] = selectedColor;
    markLegacyColorStateDirty();
    refreshResolvedColorsForOwners([countryCode], { renderNow: false });
    brushSession.changed = true;
    return true;
  }

  const freshIds = targetIds.filter((targetId) => !brushSession.visitedFeatureIds.has(targetId));
  if (!freshIds.length) return false;
  mergeHistorySnapshot(brushSession.before, captureHistoryState({ featureIds: freshIds }));
  freshIds.forEach((targetId) => {
    brushSession.visitedFeatureIds.add(targetId);
    brushSession.affectedFeatureIds.add(targetId);
  });
  applyFeatureVisualOverrideTransaction(freshIds, selectedColor, {
    inputLabel: "brush-fill-feature-color",
  });
  brushSession.changed = true;
  return true;
}

function flushBrushSession() {
  const actionStart = nowMs();
  if (!brushSession) return;
  const current = brushSession;
  brushSession = null;
  if (current.dragging) {
    suppressNextClickAfterBrush = true;
  }
  if (!current.dragging || !current.changed) return;
  const featureIds = Array.from(current.affectedFeatureIds);
  const waterRegionIds = Array.from(current.affectedWaterRegionIds);
  const specialRegionIds = Array.from(current.affectedSpecialRegionIds);
  const ownerCodes = Array.from(current.affectedOwnerCodes);
  const sovereigntyFeatureIds = Array.from(current.affectedSovereigntyIds);
  const after = captureHistoryState({ featureIds, waterRegionIds, specialRegionIds, ownerCodes, sovereigntyFeatureIds });
  pushHistoryEntry({
    kind: runtimeState.currentTool === "eraser" ? "brush-erase" : "brush-fill",
    before: current.before,
    after,
    meta: {
      affectsSovereignty: isSovereigntyModeActive(),
    },
  });
  if (runtimeState.currentTool !== "eyedropper") {
    addRecentColor(runtimeState.selectedColor);
  }
  markDirty("brush-stroke");
  refreshSidebarAfterPaint({
    featureIds,
    waterRegionIds,
    specialRegionIds,
    ownerCodes,
  });
  requestRendererRender("brush-stroke", { flush: true });
  noteRenderAction("brush-stroke", actionStart);
}

function applySpecialZoneMembershipDragHit(event) {
  const hit = getHitFromEvent(event, {
    enableSnap: false,
    snapPx: 0,
    eventType: "special-zone-membership-drag",
  });
  const featureId = hit?.targetType === "land" ? String(hit.id || "").trim() : "";
  if (!featureId || !runtimeState.landIndex?.has(featureId)) return false;
  return getStrategicOverlayRuntimeOwner().applySpecialZoneMembershipDragFeature(featureId);
}

function flushSpecialZoneMembershipDragSession() {
  const result = getStrategicOverlayRuntimeOwner().finishSpecialZoneMembershipDrag();
  if (result?.active) suppressNextClickAfterBrush = true;
}

function handleSpecialZoneMembershipPointerDown(event) {
  if (runtimeState.currentTool !== "special-zone-membership") return false;
  const membershipTool = getSpecialZoneMembershipTool();
  if (membershipTool !== "brush" && !event?.shiftKey && !event?.altKey) return false;
  if ((event.buttons & 1) !== 1) return true;
  const started = getStrategicOverlayRuntimeOwner().beginSpecialZoneMembershipDrag({
    membershipTool,
    brushMode: getSpecialZoneMembershipBrushMode(),
    altKey: !!event?.altKey,
  });
  if (!started) return true;
  if (event?.preventDefault) event.preventDefault();
  applySpecialZoneMembershipDragHit(event);
  return true;
}

function handleBrushPointerDown(event) {
  if (runtimeState.startupReadonly) {
    if (event?.preventDefault) event.preventDefault();
    blockStartupReadonlyInteraction();
    return;
  }
  if (handlePhysicalIntensityPointerDown(event)) return;
  if (handleSpecialZoneMembershipPointerDown(event)) return;
  if (!runtimeState.brushModeEnabled || runtimeState.currentTool === "eyedropper" || runtimeState.specialZoneEditor?.active) return;
  if (isBrushNavigationModifier(event)) return;
  if ((event.buttons & 1) !== 1) return;
  if (event?.preventDefault) event.preventDefault();
  ensureBrushSession(event);
}

function handleBrushPointerMove(event) {
  if (runtimeState.startupReadonly) {
    return;
  }
  if (handlePhysicalIntensityPointerMove(event)) return;
  if (getStrategicOverlayRuntimeOwner().hasSpecialZoneMembershipDragSession()) {
    if ((event.buttons & 1) !== 1) {
      flushSpecialZoneMembershipDragSession();
      return;
    }
    if (applySpecialZoneMembershipDragHit(event)) {
      requestInteractionRender("special-zone-membership-drag");
    }
    return;
  }
  if (!brushSession || !runtimeState.brushModeEnabled || runtimeState.currentTool === "eyedropper" || runtimeState.specialZoneEditor?.active) {
    return;
  }
  if ((event.buttons & 1) !== 1) {
    flushBrushSession();
    return;
  }
  const dx = Number(event.clientX || 0) - brushSession.startX;
  const dy = Number(event.clientY || 0) - brushSession.startY;
  if (!brushSession.dragging && Math.hypot(dx, dy) <= 3) return;
  brushSession.dragging = true;
  const hit = getHitFromEvent(event, {
    enableSnap: false,
    snapPx: 0,
    eventType: "brush",
  });
  if (!hit?.id) return;
  if (applyBrushHit(hit) && rendererSurfaceHost.getContext()) {
    requestInteractionRender("brush-preview");
  }
}

async function handleClick(event, interactionContext = null) {
  return getClickSelectionTransactionOwner().handleClick(event, interactionContext);
}
async function handleDoubleClick(event, _interactionContext = null) {
  if (runtimeState.startupReadonly) {
    if (event?.preventDefault) event.preventDefault();
    blockStartupReadonlyInteraction();
    return;
  }
  const actionStart = nowMs();
  if (runtimeState.specialZoneEditor?.active) {
    if (event?.preventDefault) event.preventDefault();
    finishSpecialZoneDraw();
    return;
  }
  if (runtimeState.operationalLineEditor?.active) {
    if (event?.preventDefault) event.preventDefault();
    finishOperationalLineDraw();
    return;
  }
  if (runtimeState.operationGraphicsEditor?.active) {
    if (event?.preventDefault) event.preventDefault();
    finishOperationGraphicDraw();
    return;
  }
  if (!runtimeState.landData) return;
  if (event?.preventDefault) event.preventDefault();

  const hit = getHitFromEvent(event, {
    enableSnap: true,
    snapPx: HIT_SNAP_RADIUS_CLICK_PX,
    eventType: "dblclick",
  });
  const id = hit.id;
  if (!id) return;
  let feature = runtimeState.landIndex.get(id);
  if (!feature) return;
  let featureId = id;
  let countryCode = hit.countryCode || getFeatureCountryCodeNormalized(feature);
  if (!(await ensureLeafDetailReady(countryCode, { announce: true }))) {
    return;
  }
  if (shouldRequireLeafDetail(countryCode)) {
    const refreshedHit = getHitFromEvent(event, {
      enableSnap: true,
      snapPx: HIT_SNAP_RADIUS_CLICK_PX,
      eventType: "dblclick",
    });
    const refreshedId = refreshedHit.id;
    const refreshedFeature = refreshedId ? runtimeState.landIndex.get(refreshedId) : null;
    if (refreshedHit.targetType === "land" && refreshedId && refreshedFeature) {
      feature = refreshedFeature;
      featureId = refreshedId;
      countryCode = refreshedHit.countryCode || getFeatureCountryCodeNormalized(feature);
    }
  }
  executeDoubleClickBatchFill(feature, featureId);
  noteRenderAction("double-click-fill", actionStart);
}

function calculatePanExtent() {
  return getViewportReadModelOwner().calculatePanExtent();
}

function updateZoomTranslateExtent() {
  return getViewportCommandOwner().updateZoomTranslateExtent();
}

function getViewportGeoBounds() {
  return getViewportReadModelOwner().getViewportGeoBounds();
}

function captureRenderSnapshot() {
  return renderSnapshotOwner.captureRenderSnapshot(
    captureRenderSnapshotState(runtimeState, {
      getViewportRenderSignature,
      getProjectionRenderSignature,
      getViewportGeoBounds,
    }),
  );
}

function updateMap(transform) {
  return getRendererViewportUpdateOwner().updateMap(transform);
}

function getProjectedHgoRuntimePreviewBounds() {
  return getHgoRuntimePreviewRenderOwner().getProjectedBounds();
}

function getProjectedRenderableContentBounds() {
  return getViewportReadModelOwner().getProjectedRenderableContentBounds();
}

function getCenteredFitZoomTransform({ centerX = true, centerY = false } = {}) {
  return getViewportReadModelOwner().getCenteredFitZoomTransform({ centerX, centerY });
}

function resetZoomToFit({ centerContent = false, centerX = true, centerY = false } = {}) {
  return getViewportCommandOwner().resetZoomToFit({ centerContent, centerX, centerY });
}

function zoomByStep(direction = 1) {
  return getViewportCommandOwner().zoomByStep(direction);
}

function setZoomPercent(percent) {
  return getViewportCommandOwner().setZoomPercent(percent);
}

function getZoomPercent() {
  return getViewportReadModelOwner().getZoomPercent();
}

function enforceZoomConstraints() {
  return getViewportCommandOwner().enforceZoomConstraints();
}

function fitProjection({ skipSpatialIndex = false } = {}) {
  return getRendererFitProjectionOwner().fitProjection({ skipSpatialIndex });
}

function getResizeReason(reason, fallback = "resize") {
  return getViewportResizeLifecycleOwner().getResizeReason(reason, fallback);
}

function isInteractiveLayoutResize(reason) {
  return getViewportResizeLifecycleOwner().isInteractiveLayoutResize(reason);
}

function scheduleResizeSpatialRefresh(reason = "resize") {
  return getViewportResizeLifecycleOwner().scheduleResizeSpatialRefresh(reason);
}

function shouldPreferFullResizeReason(currentReason, nextReason) {
  return getViewportResizeLifecycleOwner().shouldPreferFullResizeReason(currentReason, nextReason);
}

function requestMapContainerResizeSync(reason = "map-container-resize") {
  return getViewportResizeLifecycleOwner().requestMapContainerResizeSync(reason);
}

function bindMapContainerResizeObserver() {
  return getViewportResizeLifecycleOwner().bindMapContainerResizeObserver();
}

function getDevicePixelRatioMediaQuery() {
  return getViewportResizeLifecycleOwner().getDevicePixelRatioMediaQuery();
}

function unbindBrowserPixelRatioObserver() {
  return getViewportResizeLifecycleOwner().unbindBrowserPixelRatioObserver();
}

function bindBrowserPixelRatioObserver() {
  return getViewportResizeLifecycleOwner().bindBrowserPixelRatioObserver();
}

function bindVisualViewportResizeObserver() {
  return getViewportResizeLifecycleOwner().bindVisualViewportResizeObserver();
}

function bindBrowserZoomObservers() {
  return getViewportResizeLifecycleOwner().bindBrowserZoomObservers();
}

function handleBrowserPixelRatioRefresh(reason = "browser-dpr-change") {
  return getViewportResizeLifecycleOwner().handleBrowserPixelRatioRefresh(reason);
}

function handleResize(reason = "resize") {
  return getViewportResizeLifecycleOwner().handleResize(reason);
}

function handleSidebarLayoutStart() {
  return getViewportResizeLifecycleOwner().handleSidebarLayoutStart();
}

function initZoom() {
  return getZoomInteractionLifecycleOwner().initZoom();
}

function handleMapMouseLeave() {
  getMapHoverInteractionOwner().handleMapMouseLeave();
}

function bindEvents() {
  return getMapInteractionEventBindingOwner().bindEvents();
}

function initMap({
  containerId = "mapContainer",
  suppressRender = false,
  interactionLevel = "full",
  deferInteractionInfrastructure = false,
} = {}) {
  if (!globalThis.d3) {
    console.error("D3 is required for map renderer.");
    return;
  }

  getRendererSurfaceLifecycleOwner().resolveDomHandles({ containerId });
  facilityInfoCard = document.getElementById("facilityInfoCard");
  facilityInfoCardTitle = document.getElementById("facilityInfoCardTitle");
  facilityInfoCardBody = document.getElementById("facilityInfoCardBody");
  facilityInfoCardZoomBtn = document.getElementById("facilityInfoCardZoomBtn");
  facilityInfoCardCloseBtn = document.getElementById("facilityInfoCardCloseBtn");
  facilityInfoCardMoreBtn = document.getElementById("facilityInfoCardMoreBtn");
  runtimeState.refreshColorStateFn = refreshColorState;
  runtimeState.recomputeDynamicBordersNowFn = recomputeDynamicBordersNow;
  runtimeState.resolveSpecialZoneParentGroupTargetIdsFn = resolveSpecialZoneParentGroupTargetIds;

  if (!rendererSurfaceHost.getMapContainer()) {
    console.error("Map container not found.");
    return;
  }

  if (facilityInfoCardCloseBtn && !facilityInfoCardCloseBtn.dataset.bound) {
    facilityInfoCardCloseBtn.addEventListener("click", () => {
      applyFacilityInfoCardState(null);
      getMapHoverInteractionOwner().setHoverOverlayDirty(true);
      renderHoverOverlayIfNeeded({ eventType: "facility-card-close" });
    });
    facilityInfoCardCloseBtn.dataset.bound = "true";
  }
  if (facilityInfoCardZoomBtn && !facilityInfoCardZoomBtn.dataset.bound) {
    facilityInfoCardZoomBtn.addEventListener("click", () => {
      const activeEntry = selectedFacilityEntry;
      if (!activeEntry) return;
      zoomToFacilityEntry(activeEntry);
    });
    facilityInfoCardZoomBtn.dataset.bound = "true";
  }
  if (facilityInfoCardMoreBtn && !facilityInfoCardMoreBtn.dataset.bound) {
    facilityInfoCardMoreBtn.addEventListener("click", () => {
      if (!selectedFacilityEntry) return;
      facilityInfoCardExpanded = !facilityInfoCardExpanded;
      applyFacilityInfoCardState(selectedFacilityEntry);
    });
    facilityInfoCardMoreBtn.dataset.bound = "true";
  }
  runtimeState.syncFacilityInfoCardVisibilityFn = syncFacilityInfoCardVisibility;
  runtimeState.updateFacilityInfoCardUiFn = () => {
    if (selectedFacilityEntry) {
      applyFacilityInfoCardState(selectedFacilityEntry);
    }
  };
  applyFacilityInfoCardState(null);

  ensureHybridLayers();

  getRendererSurfaceLifecycleOwner().ensureHitCanvasHandle();

  getRendererSurfaceLifecycleOwner().acquireCanvasContexts();
  if (!rendererSurfaceHost.getContext()) {
    console.error("Canvas 2D context unavailable.");
    return;
  }
  if (!rendererSurfaceHost.getHitContext()) {
    console.error("Hit canvas 2D context unavailable.");
    return;
  }

  getRendererProjectionPathOwner().initializeProjectionPaths();
  getRendererStartupTransactionOwner().runInitMapResetTransaction({ debugMode });

  rendererSurfaceHost.getMapCanvas().style.pointerEvents = "none";
  rendererSurfaceHost.getMapCanvas().style.touchAction = "none";
  if (rendererSurfaceHost.getPoliticalPatchCanvas()) {
    rendererSurfaceHost.getPoliticalPatchCanvas().style.pointerEvents = "none";
    rendererSurfaceHost.getPoliticalPatchCanvas().style.touchAction = "none";
  }
  if (rendererSurfaceHost.getInteractionOverlayCanvas()) {
    rendererSurfaceHost.getInteractionOverlayCanvas().style.pointerEvents = "none";
    rendererSurfaceHost.getInteractionOverlayCanvas().style.touchAction = "none";
  }

  const shouldDeferInteractionInfrastructure =
    deferInteractionInfrastructure || interactionLevel === "readonly-startup";
  buildRuntimePoliticalMeta();
  setCanvasSize();
  if (!shouldDeferInteractionInfrastructure) {
    buildIndex();
  } else {
    runtimeState.deferHitCanvasBuild = true;
    setInteractionInfrastructureState("deferred-startup", {
      ready: false,
      inFlight: false,
    });
  }
  rebuildStaticMeshes();
  invalidateBorderCache();
  updateDynamicBorderStatusUI();
  fitProjection({ skipSpatialIndex: shouldDeferInteractionInfrastructure });
  initZoom();
  bindEvents();
  runtimeState.getViewportGeoBoundsFn = getViewportGeoBounds;
  if (!shouldDeferInteractionInfrastructure) {
    setInteractionInfrastructureState("ready", {
      ready: true,
      inFlight: false,
    });
  }

  if (!suppressRender) {
    render();
  }
}

function markRendererTopologyChanged({ hitCanvasDirty = false } = {}) {
  return getRendererTransactionResetOwner().markRendererTopologyChanged({ hitCanvasDirty });
}

function resetRendererTransactionState({
  cancelSecondarySpatialBuild = false,
  cancelHoverOverlayRender = false,
  hitCanvasDirty = false,
} = {}) {
  return getRendererTransactionResetOwner().resetRendererTransactionState({
    cancelSecondarySpatialBuild,
    cancelHoverOverlayRender,
    hitCanvasDirty,
  });
}

function rebuildPrimaryPoliticalCollections() {
  ensureLayerDataFromTopology();
  return rebuildPoliticalLandCollections();
}

function rebuildPrimaryPoliticalDerivedState({
  scheduleUiMode = "deferred",
  buildSpatial = true,
  includeSecondarySpatial = false,
} = {}) {
  rebuildPrimaryPoliticalCollections();
  rebuildRuntimeDerivedState({
    includeRuntimePoliticalMeta: true,
    scheduleUiMode,
    buildSpatial,
    includeSecondarySpatial,
  });
}

function setMapData({
  refitProjection = true,
  resetZoom = true,
  suppressRender = false,
  interactionLevel = "full",
  deferInteractionInfrastructure = false,
} = {}) {
  return getSetMapDataTransactionOwner().runSetMapDataTransaction({
    refitProjection,
    resetZoom,
    suppressRender,
    interactionLevel,
    deferInteractionInfrastructure,
  });
}

function resetRendererRefreshTransactionState({
  cancelHoverOverlay = false,
  cancelSecondarySpatialBuild = false,
} = {}) {
  return getRendererTransactionResetOwner().resetRendererRefreshTransactionState({
    cancelHoverOverlay,
    cancelSecondarySpatialBuild,
  });
}

scenarioRefreshRuntime = createScenarioRefreshRuntime({
  runtimeState,
  buildIndex,
  buildSpatialIndexChunked,
  rebuildPoliticalLandCollections,
  rebuildRuntimeDerivedState,
  rebuildPrimaryPoliticalDerivedState,
  setInteractionInfrastructureState,
  scheduleSecondarySpatialIndexBuild,
  scheduleHitCanvasBuildIfNeeded,
  ensureSovereigntyState,
  refreshScenarioOpeningOwnerBorders,
  invalidateBorderCache,
  updateDynamicBorderStatusUI,
  updateSpecialZonesPaths,
  renderSpecialZoneEditorOverlay,
  render,
  recordRenderPerfMetric,
  recordInteractionRecoveryTaskMetric,
  beginInteractionRecoveryTask,
  endInteractionRecoveryTask,
  isInteractionRecoverySettled,
  scheduleDeferredWork,
  cancelDeferredWork,
  yieldToMain,
  nowMs,
  markRendererTopologyChanged,
  clearDeferredInternalBorderMeshCaches,
  scheduleDeferredHeavyBorderMeshes,
  resetScenarioWaterCacheAdaptiveState,
  syncScenarioSecondaryRegionIndexes,
  invalidateRenderPasses,
  markAllOverlaysDirty,
  updateZoomTranslateExtent,
  isUsableMesh,
  resetRendererTransactionState,
  clearLastGoodFrame,
  invalidateInteractionComposite,
  resetFirstVisibleFramePainted,
  clearRenderPassReferenceTransforms,
  rebuildStaticMeshes,
  getEffectiveAtlantropaFeatures,
  rebuildAuxiliaryRegionIndexes,
  getSpatialIndexRuntimeOwner,
  queueIndexUiRefresh,
});

function cancelDeferredScenarioChunkPromotionInfraRefresh() {
  return scenarioRefreshRuntime.cancelDeferredScenarioChunkPromotionInfraRefresh();
}

function scheduleDeferredScenarioChunkPromotionInfraRefresh(options = {}) {
  return scenarioRefreshRuntime.scheduleDeferredScenarioChunkPromotionInfraRefresh(options);
}

async function runDeferredScenarioChunkPromotionInfraRefresh(options = {}) {
  return scenarioRefreshRuntime.runDeferredScenarioChunkPromotionInfraRefresh(options);
}

function refreshMapDataForScenarioChunkPromotion(options = {}) {
  return scenarioRefreshRuntime.refreshMapDataForScenarioChunkPromotion(options);
}

function reconcileDetailPromotionPoliticalPass(reason = "detail-promotion-political-reconcile") {
  const startedAt = nowMs();
  const normalizedReason = String(reason || "detail-promotion-political-reconcile").trim()
    || "detail-promotion-political-reconcile";
  const cache = getRenderPassCacheState();
  if (cache?.signatures) {
    cache.signatures.political = "";
  }
  clearPassFullReferenceTransforms(["political"]);
  invalidateRenderPasses(["political"], normalizedReason);
  const requested = requestRendererRender(normalizedReason, {
    flush: false,
  });
  recordRenderPerfMetric("detailPromotionPoliticalReconcile", nowMs() - startedAt, {
    activeScenarioId: String(runtimeState.activeScenarioId || ""),
    reason: normalizedReason,
    requested: !!requested,
  });
  return requested;
}

function refreshMapDataForScenarioApply(options = {}) {
  return scenarioRefreshRuntime.refreshMapDataForScenarioApply(options);
}

// Batch 5 facade note:
// 1) 生产代码侧尽量只用 named imports，避免 namespace import 把 donor surface 继续放大。
// 2) 这里按 consumer lane 分组公开 stable facade，owner-backed 细节继续留在模块内部。
export { RENDER_PASS_NAMES } from "./map_renderer/render_pass_catalog.js";

export {
  // Core render lifecycle facade.
  initMap,
  setMapData,
  buildInteractionInfrastructureAfterStartup,
  render,

  // Scenario refresh and color synchronization facade.
  refreshMapDataForScenarioChunkPromotion,
  refreshMapDataForScenarioApply,
  reconcileDetailPromotionPoliticalPass,
  refreshColorState,
  refreshResolvedColorsForFeatures,
  refreshResolvedColorsForOwners,
  refreshScenarioOpeningOwnerBorders,
  markDynamicBordersDirty,
  recomputeDynamicBordersNow,
  scheduleDynamicBorderRecompute,

  // Strategic overlay editing facade.
  startOperationalLineDraw,
  undoOperationalLineVertex,
  finishOperationalLineDraw,
  cancelOperationalLineDraw,
  selectOperationalLineById,
  deleteSelectedOperationalLine,
  updateSelectedOperationalLine,
  startOperationGraphicDraw,
  undoOperationGraphicVertex,
  finishOperationGraphicDraw,
  cancelOperationGraphicDraw,
  selectOperationGraphicById,
  deleteSelectedOperationGraphic,
  deleteSelectedOperationGraphicVertex,
  updateSelectedOperationGraphic,
  startUnitCounterPlacement,
  cancelUnitCounterPlacement,
  cancelActiveStrategicInteractionModes,
  selectUnitCounterById,
  deleteSelectedUnitCounter,
  updateSelectedUnitCounter,
  getUnitCounterPreviewData,
  resolveUnitCounterNationForPlacement,
  startSpecialZoneDraw,
  undoSpecialZoneVertex,
  finishSpecialZoneDraw,
  cancelSpecialZoneDraw,
  deleteSelectedManualSpecialZone,
  selectSpecialZoneById,

  // Render cache and visual invalidation facade.
  rebuildStaticMeshes,
  invalidateBorderCache,
  invalidateContextLayerVisualStateBatch,
  invalidateAllRenderPasses,
  invalidateOceanBackgroundVisualState,
  invalidateOceanWaterInteractionVisualState,
  invalidateOceanCoastalAccentVisualState,
  invalidateOceanVisualState,

  // Dev workspace selection and fill facade.
  addFeatureToDevSelection,
  toggleFeatureInDevSelection,
  removeLastDevSelection,
  clearDevSelection,
  applyDevMacroFillCurrentCountry,
  applyDevMacroFillCurrentParentGroup,
  applyDevMacroFillCurrentOwnerScope,
  applyDevSelectionFill,

  // Read-model helpers for UI, diagnostics, and export tooling.
  autoFillMap,
  getBathymetryPresetStyleDefaults,
  getWaterRegionColor,
  getUrbanLayerCapability,
  computeUrbanAdaptivePaintFromHostColor,
  getEffectiveUrbanMode,
  buildCityRevealPlan,
  getCityLabelRenderStyle,
  getCityMarkerRenderStyle,
  getEffectiveCityCollection,
  isOpenOceanOverlayActive,
  renderExportPassesToCanvas,
  captureRenderSnapshot,

  // Viewport, diagnostics, and render scheduling facade.
  requestInteractionRender,
  setDebugMode,
  getZoomPercent,
  projectGeoToScreen,
  resetZoomToFit,
  setZoomPercent,
  zoomByStep,
  scheduleExactAfterSettleRefresh,
  scheduleRenderPhaseIdle,
};
