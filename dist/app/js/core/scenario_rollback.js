import { countryNames, defaultCountryPalette, state as runtimeState } from "./state.js";
import { normalizeMapSemanticMode } from "./state.js";
import { callRuntimeHook, readRegisteredRuntimeHookSource } from "./state/index.js";
import { markLegacyColorStateDirty } from "./sovereignty_manager.js";
import { syncResolvedDefaultCountryPalette } from "./palette_manager.js";
import {
  createDefaultActiveScenarioChunksState,
  createDefaultScenarioHydrationHealthGate,
  createDefaultRuntimeChunkLoadState,
} from "./state/scenario_runtime_state.js";
import {
  bumpScenarioDataGenerationState,
  bumpSceneGenerationState,
  ensureSceneSnapshotState,
} from "./state/renderer_runtime_state.js";
import {
  replaceScenarioChunkRuntimeState,
  setScenarioChunkRuntimeHooksState,
} from "./state/actions/scenario_chunk_runtime_actions.js";
import {
  setDefaultRuntimePoliticalTopologyState,
  setScenarioPoliticalChunkPayloadState,
} from "./state/actions/scenario_chunk_promotion_actions.js";
import {
  captureScenarioTransactionRollbackOptionalState,
  captureScenarioTransactionRollbackSupplementalState,
  SCENARIO_TRANSACTION_ROLLBACK_OPTIONAL_STATE_KEYS,
  SCENARIO_TRANSACTION_ROLLBACK_SUPPLEMENTAL_STATE_KEYS,
  validateScenarioTransactionRollbackSupplementalStatePatch,
} from "./state/actions/scenario_transaction_rollback_actions.js";
import {
  captureScenarioActivationState,
  restoreScenarioActivationAfterColorDirtyState,
  restoreScenarioActivationBeforeAuditState,
  restoreScenarioActivationBeforeColorDirtyState,
  SCENARIO_ACTIVATION_STATE_KEYS,
} from "./state/actions/scenario_activation_actions.js";
import {
  restoreScenarioReadinessState,
  SCENARIO_READINESS_STATE_KEYS,
} from "./state/actions/scenario_readiness_actions.js";
import {
  captureActiveScenarioPerformanceHintsState,
  captureScenarioPresentationState,
  restoreScenarioTransactionPresentationBeforeAuditState,
  restoreScenarioTransactionPresentationState,
  setActiveScenarioPerformanceHintsState,
  SCENARIO_PRESENTATION_STATE_KEYS,
} from "./state/actions/scenario_presentation_actions.js";
import {
  captureScenarioHealthState,
  restoreScenarioDataHealthState,
  restoreScenarioHydrationHealthGateState,
} from "./state/actions/scenario_health_actions.js";
import {
  captureScenarioPaletteState,
  restoreScenarioPaletteState,
  SCENARIO_PALETTE_STATE_KEYS,
} from "./state/actions/scenario_palette_actions.js";
import { ensureScenarioAuditUiState, setScenarioAuditUiState } from "./scenario_ui_sync.js";
import {
  awaitInitialScenarioChunkVisualPromotion,
  scheduleScenarioChunkRefresh,
} from "./scenario_resources.js";
import { cloneScenarioStateValue } from "./scenario/shared.js";
import { createScenarioRollbackClone } from "./scenario/rollback_clone.js";
const state = runtimeState;

// 回滚快照是 scenario apply 的最后一道事务边界；这里的字段清单必须和
// capture/restore 两侧同步，避免新增 runtime 状态后只回滚一半。
const ROLLBACK_REQUIRED_KEYS = Object.freeze([
  "activeScenarioId",
  "scenarioBorderMode",
  "activeScenarioManifest",
  "mapSemanticMode",
  "scenarioCountriesByTag",
  "scenarioFixedOwnerColors",
  "scenarioGeneratedColorTags",
  "activeScenarioMeshPack",
  "defaultRuntimePoliticalTopology",
  "scenarioRuntimeTopologyData",
  "runtimePoliticalMetaSeed",
  "runtimePoliticalFeatureCollectionSeed",
  "scenarioLandMaskData",
  "scenarioContextLandMaskData",
  "scenarioAtlantropaData",
  "scenarioLandMaskVersionTag",
  "scenarioContextLandMaskVersionTag",
  "runtimePoliticalTopology",
  "scenarioWaterRegionsData",
  "scenarioWaterOverlayVersionTag",
  "scenarioSpecialRegionsData",
  "scenarioRuntimeTopologyVersionTag",
  "scenarioHydrationHealthGate",
  "scenarioReliefOverlaysData",
  "scenarioStrategicValuesData",
  "scenarioStrategicValuesRevision",
  "scenarioDistrictGroupsData",
  "scenarioDistrictGroupByFeatureId",
  "scenarioReliefOverlayRevision",
  "scenarioGeoLocalePatchData",
  "scenarioCityOverridesData",
  "cityLayerRevision",
  "scenarioReleasableIndex",
  "releasableCatalog",
  "scenarioAudit",
  "scenarioAuditUi",
  "scenarioImportAudit",
  "scenarioBaselineHash",
  "scenarioBaselineOwnersByFeatureId",
  "scenarioAutoShellOwnerByFeatureId",
  "scenarioBaselineCoresByFeatureId",
  "scenarioShellOverlayRevision",
  "scenarioDataHealth",
  "countryNames",
  "locales",
  "geoAliasToStableKey",
  "sovereigntyByFeatureId",
  "sovereigntyInitialized",
  "visualOverrides",
  "featureOverrides",
  "sovereignBaseColors",
  "countryBaseColors",
  "activeSovereignCode",
  "selectedWaterRegionId",
  "selectedSpecialRegionId",
  "hoveredWaterRegionId",
  "hoveredSpecialRegionId",
  "selectedInspectorCountryCode",
  "inspectorHighlightCountryCode",
  "inspectorExpansionInitialized",
  "expandedInspectorContinents",
  "expandedInspectorReleaseParents",
  "parentBordersVisible",
  "scenarioParentBorderEnabledBeforeActivate",
  "parentBorderEnabledByCountry",
  "scenarioPaintModeBeforeActivate",
  "paintMode",
  "interactionGranularity",
  "batchFillScope",
  "scenarioUiState",
  "scenarioOceanFillBeforeActivate",
  "scenarioOceanStyleBeforeActivate",
  "scenarioPresentationStyleBeforeActivate",
  "styleConfigOcean",
  "scenarioDisplaySettingsBeforeActivate",
  "activeScenarioPerformanceHints",
  "scenarioPoliticalChunkData",
  "scenarioPoliticalVisibleChunkData",
  "activeScenarioChunks",
  "runtimeChunkLoadState",
  "scheduleScenarioChunkRefreshEnabled",
  "awaitInitialScenarioChunkVisualPromotionEnabled",
  "renderProfile",
  "dynamicBordersEnabled",
  "showCityPoints",
  "showWaterRegions",
  "showScenarioSpecialRegions",
  "showScenarioAtlantropa",
  "showScenarioReliefOverlays",
  "showStrategicResourceMarkers",
  "strategicChoroplethMetric",
  "activePaletteId",
  "activePaletteMeta",
  "activePalettePack",
  "activePaletteMap",
  "currentPaletteTheme",
  "activePaletteOceanMeta",
  "fixedPaletteColorsByIso2",
  "resolvedDefaultCountryPalette",
  "paletteLibraryEntries",
  "paletteQuickSwatches",
  "paletteLoadErrorById",
  "legendLabels",
  "legendConfig",
  "topologyDetail",
  "topologyBundleMode",
  "detailDeferred",
  "detailPromotionCompleted",
  "detailPromotionInFlight",
  "detailSourceRequested",
]);

function getScenarioTransactionRollbackPresentKeys(snapshot) {
  if (!Array.isArray(snapshot.rollbackPresentStateKeys)) {
    return [...SCENARIO_TRANSACTION_ROLLBACK_OPTIONAL_STATE_KEYS];
  }
  return SCENARIO_TRANSACTION_ROLLBACK_OPTIONAL_STATE_KEYS.filter((key) =>
    snapshot.rollbackPresentStateKeys.includes(key)
  );
}

function buildScenarioTransactionDomainSnapshot(
  values,
  transactionPresentKeys,
  domainKeys,
) {
  const optionalKeys = new Set(
    SCENARIO_TRANSACTION_ROLLBACK_OPTIONAL_STATE_KEYS,
  );
  const presentKeys = new Set(transactionPresentKeys);
  return {
    values: Object.fromEntries(
      domainKeys.map((key) => [key, values[key]]),
    ),
    presentKeys: domainKeys.filter(
      (key) => !optionalKeys.has(key) || presentKeys.has(key),
    ),
  };
}

function validateScenarioApplyRollbackSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("Invalid rollback snapshot: expected an object.");
  }
  const missingKeys = ROLLBACK_REQUIRED_KEYS.filter(
    (key) => !Object.prototype.hasOwnProperty.call(snapshot, key)
  );
  if (!missingKeys.length) {
    return;
  }
  const preview = missingKeys.slice(0, 8).join(", ");
  const suffix = missingKeys.length > 8 ? ` (+${missingKeys.length - 8} more)` : "";
  throw new Error(`Invalid rollback snapshot: missing required keys: ${preview}${suffix}`);
}

function cloneScenarioRollbackCaptureValues(snapshot, cloneValue) {
  return Object.fromEntries(
    Object.entries(snapshot.values).map(([key, value]) => [
      key,
      cloneValue(value),
    ]),
  );
}

function captureScenarioRuntimeSnapshot(cloneValue) {
  const activationValues = cloneScenarioRollbackCaptureValues(
    captureScenarioActivationState(runtimeState), cloneValue,
  );
  const supplementalValues =
    captureScenarioTransactionRollbackSupplementalState(
      runtimeState,
      {
        cloneValue,
        readHookSource: readRegisteredRuntimeHookSource,
        scheduleScenarioChunkRefreshSource:
          scheduleScenarioChunkRefresh,
        awaitInitialScenarioChunkVisualPromotionSource:
          awaitInitialScenarioChunkVisualPromotion,
      },
    ).values;
  const scenarioHealthValues = cloneScenarioRollbackCaptureValues(
    captureScenarioHealthState(runtimeState), cloneValue,
  );
  const scenarioPerformanceHintValues = cloneScenarioRollbackCaptureValues(
    captureActiveScenarioPerformanceHintsState(runtimeState), cloneValue,
  );
  return {
    ...activationValues,
    ...supplementalValues,
    ...scenarioHealthValues,
    ...scenarioPerformanceHintValues,
  };
}

function captureScenarioPresentationSnapshot(cloneValue) {
  ensureScenarioAuditUiState();
  const {
    ui,
    styleConfig,
    ...presentationValues
  } = cloneScenarioRollbackCaptureValues(
    captureScenarioPresentationState(runtimeState), cloneValue,
  );
  return {
    ...presentationValues,
    scenarioUiState: {
      politicalEditingExpanded: !!ui?.politicalEditingExpanded,
      scenarioVisualAdjustmentsOpen:
        !!ui?.scenarioVisualAdjustmentsOpen,
    },
    styleConfigOcean:
      styleConfig?.ocean || {},
  };
}

function captureScenarioPaletteSnapshot(cloneValue) {
  return cloneScenarioRollbackCaptureValues(
    captureScenarioPaletteState(
      runtimeState,
      {
        clonePaletteLoadErrorById: (value) => value,
      },
    ), cloneValue,
  );
}

export function captureScenarioApplyRollbackSnapshot() {
  const cloneValue = createScenarioRollbackClone();
  const optionalState =
    captureScenarioTransactionRollbackOptionalState(
      runtimeState,
      { cloneValue },
    );
  return {
    rollbackPresentStateKeys: optionalState.presentKeys,
    ...captureScenarioRuntimeSnapshot(cloneValue),
    ...captureScenarioPresentationSnapshot(cloneValue),
    ...optionalState.values,
    ...captureScenarioPaletteSnapshot(cloneValue),
  };
}

function buildScenarioTransactionRollbackStatePatch(snapshot) {
  const presentKeys = getScenarioTransactionRollbackPresentKeys(snapshot);
  const values = {
      activeScenarioId: snapshot.activeScenarioId,
      scenarioBorderMode: snapshot.scenarioBorderMode,
      activeScenarioManifest:
        cloneScenarioStateValue(snapshot.activeScenarioManifest),
      scenarioCountriesByTag:
        cloneScenarioStateValue(snapshot.scenarioCountriesByTag),
      scenarioFixedOwnerColors:
        cloneScenarioStateValue(snapshot.scenarioFixedOwnerColors),
      scenarioGeneratedColorTags:
        cloneScenarioStateValue(snapshot.scenarioGeneratedColorTags) || [],
      activeScenarioMeshPack:
        cloneScenarioStateValue(snapshot.activeScenarioMeshPack),
      defaultRuntimePoliticalTopology:
        cloneScenarioStateValue(snapshot.defaultRuntimePoliticalTopology),
      scenarioRuntimeTopologyData:
        cloneScenarioStateValue(snapshot.scenarioRuntimeTopologyData),
      runtimePoliticalMetaSeed:
        cloneScenarioStateValue(snapshot.runtimePoliticalMetaSeed),
      runtimePoliticalFeatureCollectionSeed:
        cloneScenarioStateValue(snapshot.runtimePoliticalFeatureCollectionSeed),
      scenarioLandMaskData:
        cloneScenarioStateValue(snapshot.scenarioLandMaskData),
      scenarioContextLandMaskData:
        cloneScenarioStateValue(snapshot.scenarioContextLandMaskData),
      scenarioAtlantropaData:
        cloneScenarioStateValue(snapshot.scenarioAtlantropaData),
      scenarioLandMaskVersionTag:
        String(snapshot.scenarioLandMaskVersionTag || ""),
      scenarioContextLandMaskVersionTag:
        String(snapshot.scenarioContextLandMaskVersionTag || ""),
      runtimePoliticalTopology:
        cloneScenarioStateValue(snapshot.runtimePoliticalTopology),
      scenarioWaterRegionsData:
        cloneScenarioStateValue(snapshot.scenarioWaterRegionsData),
      scenarioWaterOverlayVersionTag:
        String(snapshot.scenarioWaterOverlayVersionTag || ""),
      scenarioSpecialRegionsData:
        cloneScenarioStateValue(snapshot.scenarioSpecialRegionsData),
      scenarioRuntimeTopologyVersionTag:
        String(snapshot.scenarioRuntimeTopologyVersionTag || ""),
      scenarioHydrationHealthGate:
        cloneScenarioStateValue(snapshot.scenarioHydrationHealthGate)
        || createDefaultScenarioHydrationHealthGate(),
      scenarioReliefOverlaysData:
        cloneScenarioStateValue(snapshot.scenarioReliefOverlaysData),
      scenarioStrategicValuesData:
        cloneScenarioStateValue(snapshot.scenarioStrategicValuesData),
      scenarioStrategicValuesRevision:
        Number(snapshot.scenarioStrategicValuesRevision) || 0,
      scenarioDistrictGroupsData:
        cloneScenarioStateValue(snapshot.scenarioDistrictGroupsData),
      scenarioDistrictGroupByFeatureId:
        cloneScenarioStateValue(snapshot.scenarioDistrictGroupByFeatureId)
        || new Map(),
      scenarioReliefOverlayRevision:
        Number(snapshot.scenarioReliefOverlayRevision) || 0,
      scenarioGeoLocalePatchData:
        cloneScenarioStateValue(snapshot.scenarioGeoLocalePatchData),
      scenarioCityOverridesData:
        cloneScenarioStateValue(snapshot.scenarioCityOverridesData),
      cityLayerRevision: Number(snapshot.cityLayerRevision) || 0,
      scenarioReleasableIndex:
        cloneScenarioStateValue(snapshot.scenarioReleasableIndex),
      releasableCatalog:
        cloneScenarioStateValue(snapshot.releasableCatalog),
      scenarioAudit: cloneScenarioStateValue(snapshot.scenarioAudit),
      scenarioImportAudit:
        cloneScenarioStateValue(snapshot.scenarioImportAudit),
      scenarioBaselineHash: String(snapshot.scenarioBaselineHash || ""),
      scenarioBaselineOwnersByFeatureId:
        cloneScenarioStateValue(snapshot.scenarioBaselineOwnersByFeatureId),
      scenarioAutoShellOwnerByFeatureId:
        cloneScenarioStateValue(snapshot.scenarioAutoShellOwnerByFeatureId),
      scenarioBaselineCoresByFeatureId:
        cloneScenarioStateValue(snapshot.scenarioBaselineCoresByFeatureId),
      scenarioShellOverlayRevision:
        Number(snapshot.scenarioShellOverlayRevision) || 0,
      scenarioDataHealth:
        cloneScenarioStateValue(snapshot.scenarioDataHealth),
      mapSemanticMode: normalizeMapSemanticMode(snapshot.mapSemanticMode),
      countryNames:
        cloneScenarioStateValue(snapshot.countryNames) || { ...countryNames },
      sovereigntyByFeatureId:
        cloneScenarioStateValue(snapshot.sovereigntyByFeatureId),
      sovereigntyInitialized: !!snapshot.sovereigntyInitialized,
      visualOverrides: cloneScenarioStateValue(snapshot.visualOverrides),
      featureOverrides: cloneScenarioStateValue(snapshot.featureOverrides),
      sovereignBaseColors:
        cloneScenarioStateValue(snapshot.sovereignBaseColors),
      countryBaseColors:
        cloneScenarioStateValue(snapshot.countryBaseColors),
      topologyDetail: cloneScenarioStateValue(snapshot.topologyDetail),
      topologyBundleMode: snapshot.topologyBundleMode,
      detailDeferred: snapshot.detailDeferred,
      detailPromotionCompleted: snapshot.detailPromotionCompleted,
      detailPromotionInFlight: snapshot.detailPromotionInFlight,
      detailSourceRequested: snapshot.detailSourceRequested,
      activeScenarioPerformanceHints:
        cloneScenarioStateValue(snapshot.activeScenarioPerformanceHints),
      scenarioPoliticalChunkData:
        cloneScenarioStateValue(snapshot.scenarioPoliticalChunkData),
      scenarioPoliticalVisibleChunkData:
        cloneScenarioStateValue(snapshot.scenarioPoliticalVisibleChunkData),
      activeScenarioChunks:
        cloneScenarioStateValue(snapshot.activeScenarioChunks)
        || createDefaultActiveScenarioChunksState(),
      runtimeChunkLoadState:
        cloneScenarioStateValue(snapshot.runtimeChunkLoadState)
        || createDefaultRuntimeChunkLoadState(),
      // Hook 只按 capture 时记录的布尔语义恢复，避免把旧闭包或已取消的任务重新挂回 runtime。
      scheduleScenarioChunkRefreshFn:
        snapshot.scheduleScenarioChunkRefreshEnabled
          ? scheduleScenarioChunkRefresh
          : null,
      awaitInitialScenarioChunkVisualPromotionFn:
        snapshot.awaitInitialScenarioChunkVisualPromotionEnabled
          ? awaitInitialScenarioChunkVisualPromotion
          : null,
      renderProfile: String(snapshot.renderProfile || "auto"),
      dynamicBordersEnabled: snapshot.dynamicBordersEnabled !== false,
      showCityPoints: snapshot.showCityPoints !== false,
      showWaterRegions: snapshot.showWaterRegions !== false,
      showScenarioSpecialRegions:
        snapshot.showScenarioSpecialRegions !== false,
      showScenarioAtlantropa: snapshot.showScenarioAtlantropa,
      showScenarioReliefOverlays:
        snapshot.showScenarioReliefOverlays !== false,
      showStrategicResourceMarkers:
        !!snapshot.showStrategicResourceMarkers,
      strategicChoroplethMetric:
        String(snapshot.strategicChoroplethMetric || ""),
      activeSovereignCode: String(snapshot.activeSovereignCode || ""),
      selectedWaterRegionId: String(snapshot.selectedWaterRegionId || ""),
      selectedSpecialRegionId:
        String(snapshot.selectedSpecialRegionId || ""),
      hoveredWaterRegionId: snapshot.hoveredWaterRegionId ?? null,
      hoveredSpecialRegionId: snapshot.hoveredSpecialRegionId ?? null,
      selectedInspectorCountryCode:
        String(snapshot.selectedInspectorCountryCode || ""),
      inspectorHighlightCountryCode:
        String(snapshot.inspectorHighlightCountryCode || ""),
      inspectorExpansionInitialized:
        !!snapshot.inspectorExpansionInitialized,
      expandedInspectorContinents:
        cloneScenarioStateValue(snapshot.expandedInspectorContinents)
        || new Set(),
      expandedInspectorReleaseParents:
        cloneScenarioStateValue(snapshot.expandedInspectorReleaseParents)
        || new Set(),
      parentBordersVisible: snapshot.parentBordersVisible !== false,
      scenarioParentBorderEnabledBeforeActivate:
        cloneScenarioStateValue(
          snapshot.scenarioParentBorderEnabledBeforeActivate,
        ),
      parentBorderEnabledByCountry:
        cloneScenarioStateValue(snapshot.parentBorderEnabledByCountry) || {},
      scenarioPaintModeBeforeActivate:
        cloneScenarioStateValue(snapshot.scenarioPaintModeBeforeActivate),
      paintMode: String(snapshot.paintMode || "visual"),
      interactionGranularity:
        String(snapshot.interactionGranularity || "subdivision"),
      batchFillScope: String(snapshot.batchFillScope || "parent"),
      ui: {
        politicalEditingExpanded:
          !!snapshot.scenarioUiState?.politicalEditingExpanded,
        scenarioVisualAdjustmentsOpen:
          !!snapshot.scenarioUiState?.scenarioVisualAdjustmentsOpen,
      },
      scenarioAuditUi:
        cloneScenarioStateValue(snapshot.scenarioAuditUi) || {},
      scenarioOceanFillBeforeActivate:
        snapshot.scenarioOceanFillBeforeActivate,
      scenarioOceanStyleBeforeActivate:
        cloneScenarioStateValue(snapshot.scenarioOceanStyleBeforeActivate),
      scenarioPresentationStyleBeforeActivate:
        cloneScenarioStateValue(
          snapshot.scenarioPresentationStyleBeforeActivate,
        ),
      styleConfig: {
        ocean: cloneScenarioStateValue(snapshot.styleConfigOcean) || {},
      },
      locales:
        cloneScenarioStateValue(snapshot.locales) || { ui: {}, geo: {} },
      geoAliasToStableKey:
        cloneScenarioStateValue(snapshot.geoAliasToStableKey) || {},
      scenarioDisplaySettingsBeforeActivate:
        cloneScenarioStateValue(
          snapshot.scenarioDisplaySettingsBeforeActivate,
        ),
      activePaletteId: String(snapshot.activePaletteId || ""),
      activePaletteMeta:
        cloneScenarioStateValue(snapshot.activePaletteMeta),
      activePalettePack:
        cloneScenarioStateValue(snapshot.activePalettePack),
      activePaletteMap:
        cloneScenarioStateValue(snapshot.activePaletteMap),
      currentPaletteTheme:
        String(snapshot.currentPaletteTheme || ""),
      activePaletteOceanMeta:
        cloneScenarioStateValue(snapshot.activePaletteOceanMeta),
      fixedPaletteColorsByIso2:
        cloneScenarioStateValue(snapshot.fixedPaletteColorsByIso2) || {},
      resolvedDefaultCountryPalette:
        cloneScenarioStateValue(snapshot.resolvedDefaultCountryPalette)
        || { ...defaultCountryPalette },
      paletteLibraryEntries:
        cloneScenarioStateValue(snapshot.paletteLibraryEntries) || [],
      paletteQuickSwatches:
        cloneScenarioStateValue(snapshot.paletteQuickSwatches) || [],
      paletteLoadErrorById:
        cloneScenarioStateValue(snapshot.paletteLoadErrorById) || {},
      legendLabels: cloneScenarioStateValue(snapshot.legendLabels) || {},
      legendConfig: cloneScenarioStateValue(snapshot.legendConfig) || {},
  };
  return {
    activation: buildScenarioTransactionDomainSnapshot(
      values,
      presentKeys,
      SCENARIO_ACTIVATION_STATE_KEYS,
    ),
    readiness: buildScenarioTransactionDomainSnapshot(
      values,
      presentKeys,
      SCENARIO_READINESS_STATE_KEYS,
    ),
    presentation: buildScenarioTransactionDomainSnapshot(
      values,
      presentKeys,
      SCENARIO_PRESENTATION_STATE_KEYS,
    ),
    palette: buildScenarioTransactionDomainSnapshot(
      values,
      presentKeys,
      SCENARIO_PALETTE_STATE_KEYS,
    ),
    supplemental: {
      values: Object.fromEntries(
        SCENARIO_TRANSACTION_ROLLBACK_SUPPLEMENTAL_STATE_KEYS.map((key) => [
          key,
          values[key],
        ]),
      ),
    },
    scenarioHealth: {
      scenarioHydrationHealthGate: values.scenarioHydrationHealthGate,
      scenarioDataHealth: values.scenarioDataHealth,
    },
    activeScenarioPerformanceHints:
      values.activeScenarioPerformanceHints,
  };
}

function markScenarioRollbackSceneSnapshotRestored(previousScenarioId = "") {
  const restoredScenarioId = String(runtimeState.activeScenarioId || "");
  const sceneSnapshot = ensureSceneSnapshotState(runtimeState);
  if (
    String(sceneSnapshot.sceneScenarioId || "") !== restoredScenarioId
    || String(previousScenarioId || "") !== restoredScenarioId
  ) {
    bumpSceneGenerationState(runtimeState, "scenario-rollback");
    sceneSnapshot.sceneScenarioId = restoredScenarioId;
  }
  bumpScenarioDataGenerationState(runtimeState, "scenario-rollback");
}

export function restoreScenarioApplyRollbackSnapshot(
  snapshot,
  {
    shouldFailRestore = false,
  } = {}
) {
  validateScenarioApplyRollbackSnapshot(snapshot);
  if (shouldFailRestore) {
    throw new Error("Injected rollback restore failure.");
  }
  const rollbackStatePatch =
    buildScenarioTransactionRollbackStatePatch(snapshot);
  validateScenarioTransactionRollbackSupplementalStatePatch(
    rollbackStatePatch.supplemental,
  );
  if (runtimeState.runtimeChunkLoadState?.refreshTimerId) {
    globalThis.clearTimeout(runtimeState.runtimeChunkLoadState.refreshTimerId);
  }
  callRuntimeHook(runtimeState, "cancelScenarioChunkPromotionCommitFn", "rolled-back");

  const previousScenarioId = String(runtimeState.activeScenarioId || "");
  restoreScenarioActivationBeforeAuditState(
    runtimeState,
    rollbackStatePatch.activation,
  );
  setDefaultRuntimePoliticalTopologyState(
    runtimeState,
    rollbackStatePatch.supplemental.values.defaultRuntimePoliticalTopology,
  );
  restoreScenarioHydrationHealthGateState(
    runtimeState,
    rollbackStatePatch.scenarioHealth.scenarioHydrationHealthGate,
  );
  restoreScenarioTransactionPresentationBeforeAuditState(
    runtimeState,
    rollbackStatePatch.presentation,
  );
  setScenarioAuditUiState(
    cloneScenarioStateValue(snapshot.scenarioAuditUi) || {},
  );
  restoreScenarioActivationBeforeColorDirtyState(
    runtimeState,
    rollbackStatePatch.activation,
  );
  restoreScenarioReadinessState(
    runtimeState,
    rollbackStatePatch.readiness,
  );
  restoreScenarioDataHealthState(
    runtimeState,
    rollbackStatePatch.scenarioHealth.scenarioDataHealth,
  );
  markLegacyColorStateDirty();
  restoreScenarioActivationAfterColorDirtyState(
    runtimeState,
    rollbackStatePatch.activation,
  );
  setActiveScenarioPerformanceHintsState(
    runtimeState,
    rollbackStatePatch.activeScenarioPerformanceHints,
  );
  setScenarioPoliticalChunkPayloadState(runtimeState, {
    payload: rollbackStatePatch.supplemental.values.scenarioPoliticalChunkData,
    visiblePayload:
      rollbackStatePatch.supplemental.values.scenarioPoliticalVisibleChunkData,
  });
  replaceScenarioChunkRuntimeState(runtimeState, {
    activeScenarioChunks:
      rollbackStatePatch.supplemental.values.activeScenarioChunks,
    runtimeChunkLoadState:
      rollbackStatePatch.supplemental.values.runtimeChunkLoadState,
  });
  setScenarioChunkRuntimeHooksState(runtimeState, {
    scheduleScenarioChunkRefreshFn:
      rollbackStatePatch.supplemental.values.scheduleScenarioChunkRefreshFn,
    awaitInitialScenarioChunkVisualPromotionFn:
      rollbackStatePatch.supplemental.values
        .awaitInitialScenarioChunkVisualPromotionFn,
  });
  restoreScenarioTransactionPresentationState(
    runtimeState,
    rollbackStatePatch.presentation,
  );
  restoreScenarioPaletteState(runtimeState, rollbackStatePatch.palette);
  syncResolvedDefaultCountryPalette({ overwriteCountryPalette: false });
  markScenarioRollbackSceneSnapshotRestored(previousScenarioId);
  return true;
}
