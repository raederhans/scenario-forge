import { createDefaultRiverPaintState } from "./river_paint/partition_model.js";
// Scenario apply pipeline.
// 这个模块只负责“准备 staged apply runtimeState”和“把 staged runtimeState 落到 runtime runtimeState”。
// scenario_manager.js 继续保留事务协调、回滚、post-apply、入口控制。

import { buildScenarioOwnerColorMapDetails } from "./palette_runtime_bridge.js";
import {
  SCENARIO_READINESS_STATE_KEYS,
  captureScenarioReadinessState,
  commitScenarioReadinessState,
  restoreScenarioReadinessState,
} from "./state/actions/scenario_readiness_actions.js";
import {
  SCENARIO_ACTIVATION_STATE_KEYS,
  captureScenarioActivationState,
  commitScenarioActivationState as commitScenarioActivationAuthorityState,
  restoreScenarioActivationState,
} from "./state/actions/scenario_activation_actions.js";
import {
  SCENARIO_PRESENTATION_STATE_KEYS,
  captureScenarioPresentationState,
  commitScenarioPresentationState,
  restoreScenarioPresentationState,
} from "./state/actions/scenario_presentation_actions.js";
import {
  SCENARIO_PALETTE_STATE_KEYS,
  captureScenarioPaletteState,
  commitScenarioPaletteState,
  restoreScenarioPaletteState,
} from "./state/actions/scenario_palette_actions.js";
import {
  normalizeScenarioStrategicValuesPayload,
} from "./scenario/strategic_values.js";
import {
  recordRenderTransactionSnapshot,
} from "./renderer/render_transaction_diagnostics.js";
import {
  patchScenarioChunkLoadState,
  replaceScenarioChunkRuntimeState,
  setScenarioChunkRuntimeHooksState,
} from "./state/actions/scenario_chunk_runtime_actions.js";
import {
  setScenarioPoliticalChunkPayloadState,
} from "./state/actions/scenario_chunk_promotion_actions.js";

const SCENARIO_OWNER_COLOR_PROPERTY_KEYS = Object.freeze([
  "owner",
  "owner_tag",
  "ownerTag",
  "controller",
  "controller_tag",
  "controllerTag",
  "sovereign",
  "sovereign_tag",
  "sovereignTag",
  "cntr_code",
  "CNTR_CODE",
  "CNTR",
  "country_code",
  "countryCode",
  "iso_a2",
  "ISO_A2",
  "iso_a2_eh",
  "ISO_A2_EH",
  "adm0_a2",
  "ADM0_A2",
  "scenario_shell_owner_hint",
  "scenario_shell_controller_hint",
]);

function hasOwnStateKey(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function cloneAuthoritySnapshot(snapshot, cloneScenarioStateValue) {
  return {
    values: Object.fromEntries(
      Object.entries(snapshot?.values || {}).map(([key, value]) => [
        key,
        cloneScenarioStateValue(value),
      ]),
    ),
    presentKeys: [...(snapshot?.presentKeys || [])],
  };
}

function normalizeScenarioOwnerColorTag(value) {
  const tag = String(value || "").trim().toUpperCase();
  if (!tag || tag === "-99" || tag === "NULL" || tag === "NONE") {
    return "";
  }
  return /^[A-Z][A-Z0-9_]{1,15}$/.test(tag) ? tag : "";
}

function addScenarioOwnerColorTag(target, value) {
  const tag = normalizeScenarioOwnerColorTag(value);
  if (tag) {
    target.add(tag);
  }
}

function collectScenarioOwnerColorTagsFromRecordValues(target, record) {
  if (!record || typeof record !== "object") return;
  Object.values(record).forEach((value) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => addScenarioOwnerColorTag(target, entry));
      return;
    }
    if (value && typeof value === "object") {
      SCENARIO_OWNER_COLOR_PROPERTY_KEYS.forEach((key) => addScenarioOwnerColorTag(target, value[key]));
      return;
    }
    addScenarioOwnerColorTag(target, value);
  });
}

function collectScenarioOwnerColorTagsFromCountryMap(target, countryMap) {
  Object.entries(countryMap || {}).forEach(([rawTag, entry]) => {
    addScenarioOwnerColorTag(target, rawTag);
    if (!entry || typeof entry !== "object") return;
    [
      entry.code,
      entry.tag,
      entry.parent_owner_tag,
      entry.parentOwnerTag,
    ].forEach((value) => addScenarioOwnerColorTag(target, value));
    (Array.isArray(entry.parent_owner_tags) ? entry.parent_owner_tags : []).forEach(
      (value) => addScenarioOwnerColorTag(target, value)
    );
  });
}

function collectScenarioOwnerColorTagsFromNameMap(target, nameMap) {
  Object.keys(nameMap || {}).forEach((rawTag) => {
    addScenarioOwnerColorTag(target, rawTag);
  });
}

function collectScenarioOwnerColorTagsFromReleasableIndex(target, releasableIndex) {
  const byTag = releasableIndex?.byTag && typeof releasableIndex.byTag === "object"
    ? releasableIndex.byTag
    : {};
  collectScenarioOwnerColorTagsFromCountryMap(target, byTag);
  Object.entries(releasableIndex?.childTagsByParent || {}).forEach(([parentTag, childTags]) => {
    addScenarioOwnerColorTag(target, parentTag);
    (Array.isArray(childTags) ? childTags : []).forEach((childTag) => {
      addScenarioOwnerColorTag(target, childTag);
    });
  });
}

function collectScenarioOwnerColorTagsFromTopology(target, topologyPayload) {
  const geometries = Array.isArray(topologyPayload?.objects?.political?.geometries)
    ? topologyPayload.objects.political.geometries
    : [];
  geometries.forEach((geometry) => {
    const props = geometry?.properties && typeof geometry.properties === "object"
      ? geometry.properties
      : {};
    SCENARIO_OWNER_COLOR_PROPERTY_KEYS.forEach((key) => addScenarioOwnerColorTag(target, props[key]));
  });
}

function buildScenarioOwnerColorUniverse({
  baseCountryMap,
  countryMap,
  countryNames,
  baseTopologyPayload,
  owners,
  resolvedOwners,
  releasableIndex,
  releasableCountries,
  runtimeTopologyPayload,
  startupApplySeed,
} = {}) {
  const tags = new Set();
  collectScenarioOwnerColorTagsFromCountryMap(tags, baseCountryMap);
  collectScenarioOwnerColorTagsFromCountryMap(tags, countryMap);
  collectScenarioOwnerColorTagsFromNameMap(tags, countryNames);
  collectScenarioOwnerColorTagsFromTopology(tags, baseTopologyPayload);
  collectScenarioOwnerColorTagsFromCountryMap(tags, releasableCountries);
  collectScenarioOwnerColorTagsFromReleasableIndex(tags, releasableIndex);
  collectScenarioOwnerColorTagsFromRecordValues(tags, owners);
  collectScenarioOwnerColorTagsFromRecordValues(tags, resolvedOwners);
  collectScenarioOwnerColorTagsFromRecordValues(tags, startupApplySeed?.resolved_owners);
  collectScenarioOwnerColorTagsFromCountryMap(tags, startupApplySeed?.scenario_country_map);
  Object.keys(startupApplySeed?.scenario_color_map || {}).forEach((tag) => {
    addScenarioOwnerColorTag(tags, tag);
  });
  Object.keys(startupApplySeed?.coarse_color_map || {}).forEach((tag) => {
    addScenarioOwnerColorTag(tags, tag);
  });
  collectScenarioOwnerColorTagsFromTopology(tags, runtimeTopologyPayload);
  return [...tags];
}

function createScenarioApplyPipeline({
  runtimeState,
  countryNames,
  normalizeScenarioId,
  scenarioSupportsChunkedRuntime,
  scenarioBundleUsesChunkedLayer,
  scenarioBundleHasChunkedData,
  prepareScenarioDetailTopologyState,
  hasUsablePoliticalTopology,
  scenarioNeedsDetailTopology,
  getScenarioDisplayName,
  getScenarioTargetPaletteId,
  hasActiveScenarioPaletteLoaded,
  applyActivePaletteState,
  setActivePaletteSource,
  publishScenarioPaletteAndToolbarState,
  getScenarioDefaultCountryCode,
  getScenarioMapSemanticMode,
  buildScenarioReleasableIndex,
  getScenarioReleasableCountries,
  normalizeScenarioCoreMap,
  normalizeScenarioDistrictGroupsPayload,
  getActiveScenarioMergedChunkLayerPayload,
  getScenarioDecodedCollection,
  getScenarioTopologyFeatureCollection,
  getScenarioNameMap,
  getMissingScenarioNameTags,
  getScenarioFixedOwnerColors,
  buildHoi4FarEastSovietOwnerBackfill,
  buildScenarioRuntimeVersionTag,
  mergeReleasableCatalogs,
  buildScenarioDistrictGroupByFeatureId,
  syncScenarioLocalizationState,
  applyBlankScenarioPresentationDefaults,
  setScenarioAuditUiState,
  getScenarioBaselineHashFromBundle,

  syncScenarioInspectorSelection,
  disableScenarioParentBorders,
  applyScenarioPaintMode,
  syncScenarioOceanFillForActivation,
  applyScenarioPerformanceHints,
  scheduleScenarioChunkRefresh,
  awaitInitialScenarioChunkVisualPromotion,
  resetScenarioChunkRuntimeState,
  ensureRuntimeChunkLoadState,
  hasRenderableScenarioPoliticalTopology,
  normalizeScenarioFeatureCollection,
  cloneScenarioStateValue,
  validateScenarioActivationCommitState:
    validateScenarioActivationCommitStateOverride = null,
  captureScenarioActivationTransactionState:
    captureScenarioActivationTransactionStateOverride = null,
  restoreScenarioActivationTransactionState:
    restoreScenarioActivationTransactionStateOverride = null,
} = {}) {
  function captureDefaultScenarioActivationTransactionState({
    clonePresentationValues = false,
  } = {}) {
    const presentationSnapshot =
      captureScenarioPresentationState(runtimeState);
    return {
      readiness: captureScenarioReadinessState(runtimeState),
      activation: captureScenarioActivationState(runtimeState),
      presentation: clonePresentationValues
        ? cloneAuthoritySnapshot(
          presentationSnapshot,
          cloneScenarioStateValue,
        )
        : presentationSnapshot,
      palette: captureScenarioPaletteState(
        runtimeState,
        {
          clonePaletteLoadErrorById: cloneScenarioStateValue,
        },
      ),
    };
  }

  function restoreDefaultScenarioActivationTransactionState(snapshot) {
    restoreScenarioReadinessState(runtimeState, snapshot.readiness);
    restoreScenarioActivationState(runtimeState, snapshot.activation);
    restoreScenarioPresentationState(runtimeState, snapshot.presentation);
    restoreScenarioPaletteState(
      runtimeState,
      snapshot.palette,
    );
  }

  const validateScenarioActivationCommitState =
    typeof validateScenarioActivationCommitStateOverride === "function"
      ? validateScenarioActivationCommitStateOverride
      : () => true;
  const captureScenarioActivationTransactionState =
    typeof captureScenarioActivationTransactionStateOverride === "function"
      ? captureScenarioActivationTransactionStateOverride
      : () => captureDefaultScenarioActivationTransactionState({
        clonePresentationValues: true,
      });
  const restoreScenarioActivationTransactionState =
    typeof restoreScenarioActivationTransactionStateOverride === "function"
      ? restoreScenarioActivationTransactionStateOverride
      : restoreDefaultScenarioActivationTransactionState;

  async function stageScenarioReadinessPatch({
    startupReadonly,
    supportsChunkedPoliticalRuntime,
  }) {
    if (startupReadonly || supportsChunkedPoliticalRuntime) {
      return {
        detailPromoted: false,
        scenarioReadinessPatch:
          captureScenarioReadinessState(runtimeState).values,
      };
    }
    const stagedReadiness =
      await prepareScenarioDetailTopologyState();
    assertCompleteAuthorityPatch(
      stagedReadiness?.scenarioReadinessPatch,
      SCENARIO_READINESS_STATE_KEYS,
      "scenarioReadinessPatch",
    );
    return stagedReadiness;
  }

  async function stageScenarioPalettePatch(bundle, { syncPalette }) {
    const paletteSnapshot = captureScenarioPaletteState(
      runtimeState,
      {
        clonePaletteLoadErrorById: cloneScenarioStateValue,
      },
    );
    try {
      if (syncPalette) {
        const targetPaletteId = getScenarioTargetPaletteId(bundle.manifest);
        if (hasActiveScenarioPaletteLoaded(targetPaletteId)) {
          applyActivePaletteState({
            overwriteCountryPalette: false,
            syncDefaultPalette: false,
          });
        } else {
          const paletteApplied = await setActivePaletteSource(
            targetPaletteId,
            {
              syncUI: false,
              publishObservers: false,
              syncDefaultPalette: false,
              overwriteCountryPalette: false,
            },
          );
          if (
            !paletteApplied
            || !hasActiveScenarioPaletteLoaded(targetPaletteId)
          ) {
            throw new Error(
              `Unable to load palette for scenario "${normalizeScenarioId(
                bundle.manifest?.scenario_id || bundle.meta?.scenario_id,
              )}".`,
            );
          }
        }
      }
      return captureScenarioPaletteState(runtimeState, {
        clonePaletteLoadErrorById: cloneScenarioStateValue,
      }).values;
    } finally {
      restoreScenarioPaletteState(runtimeState, paletteSnapshot);
    }
  }

  function prepareScenarioActivationContext(bundle) {
    // 这里缓存“进入场景前”的显示状态，只在第一次激活场景时截一份基线。
    // 后续场景切换沿用这份快照，避免每次 apply 都把已经是 scenario 态的值继续覆盖回去。
    const scenarioParentBorderEnabledBeforeActivate =
      runtimeState.scenarioParentBorderEnabledBeforeActivate === null && !runtimeState.activeScenarioId
        ? { ...(runtimeState.parentBorderEnabledByCountry || {}) }
        : cloneScenarioStateValue(runtimeState.scenarioParentBorderEnabledBeforeActivate);
    const scenarioDisplaySettingsBeforeActivate =
      !runtimeState.activeScenarioId && !runtimeState.scenarioDisplaySettingsBeforeActivate
        ? {
          renderProfile: String(runtimeState.renderProfile || "").trim().toLowerCase() || "auto",
          dynamicBordersEnabled: runtimeState.dynamicBordersEnabled !== false,
          parentBordersVisible: runtimeState.parentBordersVisible !== false,
          showWaterRegions: runtimeState.showWaterRegions !== false,
          showScenarioSpecialRegions: runtimeState.showScenarioSpecialRegions !== false,
          showScenarioAtlantropa: runtimeState.showScenarioAtlantropa !== false,
          showScenarioReliefOverlays: runtimeState.showScenarioReliefOverlays !== false,
        }
        : cloneScenarioStateValue(runtimeState.scenarioDisplaySettingsBeforeActivate);
    const scenarioOceanFillBeforeActivate = runtimeState.scenarioOceanFillBeforeActivate === null
      ? String(runtimeState.styleConfig?.ocean?.fillColor || "").trim().toLowerCase()
      : runtimeState.scenarioOceanFillBeforeActivate;
    return {
      scenarioParentBorderEnabledBeforeActivate,
      scenarioDisplaySettingsBeforeActivate,
      scenarioOceanFillBeforeActivate,
      scenarioManifest: bundle.manifest || null,
    };
  }

  function buildScenarioActivationCommitState(bundle, staged) {
    // staged 负责把 bundle/loader 结果整理成一次性 runtimeState 提交包。
    // 真正写入 runtimeState 时只认这份对象，避免 apply 流程在多个阶段分散写字段。
    const hasRenderableRuntimeTopology = staged.mapSemanticMode === "blank"
      || hasRenderableScenarioPoliticalTopology(staged.runtimeTopologyPayload, bundle);
    const useDefaultRuntimePoliticalTopology =
      staged.mapSemanticMode !== "blank" && !hasRenderableRuntimeTopology;
    const runtimePoliticalTopology = useDefaultRuntimePoliticalTopology
      ? null
      : (staged.runtimeTopologyPayload || null);
    const scenarioRuntimeTopologyData = hasRenderableRuntimeTopology
      ? (staged.runtimeTopologyPayload || null)
      : null;
    const scenarioPoliticalChunkData = scenarioSupportsChunkedRuntime(bundle)
      ? null
      : (
        normalizeScenarioFeatureCollection(
          getActiveScenarioMergedChunkLayerPayload("political", staged.scenarioId)
        ) || null
      );
    const runtimeVersionTag = String(staged.runtimeVersionTag || "");
    const scenarioLandMaskData = staged.scenarioLandMaskFromTopology || null;
    const scenarioContextLandMaskData = staged.scenarioContextLandMaskFromTopology || null;
    const scenarioWaterRegionsData = staged.scenarioWaterRegionsFromTopology || null;
    const scenarioAtlantropaData = staged.scenarioAtlantropaFromTopology || null;
    const scenarioDistrictGroupByFeatureId = buildScenarioDistrictGroupByFeatureId(staged.districtGroupsPayload);
    const releasableCatalog = mergeReleasableCatalogs(runtimeState.defaultReleasableCatalog, bundle.releasableCatalog);
    const fixedOwnerColors = { ...staged.scenarioColorMap };
    if (staged.coarseColorMap && typeof staged.coarseColorMap === "object") {
      Object.entries(staged.coarseColorMap).forEach(([iso2, color]) => {
        if (iso2 && color && !fixedOwnerColors[iso2]) {
          fixedOwnerColors[iso2] = color;
        }
      });
    }
    return {
      activeScenarioId: staged.scenarioId,
      scenarioBorderMode: "scenario_owner_only",
      activeScenarioManifest: staged.scenarioManifest,
      mapSemanticMode: staged.mapSemanticMode,
      scenarioCountriesByTag: staged.countryMap,
      activeScenarioMeshPack: bundle.meshPackPayload || null,
      scenarioRuntimeTopologyData,
      runtimePoliticalTopology,
      useDefaultRuntimePoliticalTopology,
      scenarioPoliticalChunkData,
      runtimePoliticalMetaSeed: bundle.runtimePoliticalMeta || null,
      runtimePoliticalFeatureCollectionSeed: getScenarioTopologyFeatureCollection(staged.runtimeTopologyPayload, "political", bundle)
        || (!staged.runtimeTopologyPayload?.objects?.political ? getScenarioDecodedCollection(bundle, "politicalData") : null),
      scenarioLandMaskData,
      scenarioContextLandMaskData,
      scenarioWaterRegionsData,
      scenarioAtlantropaData,
      scenarioRuntimeTopologyVersionTag: scenarioRuntimeTopologyData ? runtimeVersionTag : "",
      scenarioLandMaskVersionTag: scenarioLandMaskData ? runtimeVersionTag : "",
      scenarioContextLandMaskVersionTag: scenarioContextLandMaskData ? runtimeVersionTag : "",
      scenarioWaterOverlayVersionTag: scenarioWaterRegionsData ? runtimeVersionTag : "",
      scenarioSpecialRegionsData: staged.scenarioSpecialRegionsFromTopology || bundle.specialRegionsPayload || null,
      scenarioReliefOverlaysData: staged.scenarioReliefOverlaysPayload || null,
      scenarioReliefOverlayRevision: (Number(runtimeState.scenarioReliefOverlayRevision) || 0) + 1,
      scenarioStrategicValuesData: staged.scenarioStrategicValuesPayload || null,
      scenarioStrategicValuesRevision: (Number(runtimeState.scenarioStrategicValuesRevision) || 0) + 1,
      scenarioDistrictGroupsData: staged.districtGroupsPayload,
      scenarioDistrictGroupByFeatureId,
      releasableCatalog,
      scenarioReleasableIndex: staged.releasableIndex,
      scenarioAudit: bundle.auditPayload || null,
      scenarioImportAudit: null,
      scenarioBaselineHash: getScenarioBaselineHashFromBundle(bundle),
      scenarioBaselineOwnersByFeatureId: staged.resolvedOwners,
      scenarioAutoShellOwnerByFeatureId: {},
      scenarioBaselineCoresByFeatureId: staged.cores,
      scenarioShellOverlayRevision: (Number(runtimeState.scenarioShellOverlayRevision) || 0) + 1,
      countryNames: staged.mapSemanticMode === "blank"
        ? countryNames
        : staged.scenarioNameMap,
      sovereigntyByFeatureId: staged.resolvedOwners,
      sovereigntyInitialized: false,
      visualOverrides: {},
      riverPaint: createDefaultRiverPaintState(),
      scenarioGeneratedColorTags: staged.scenarioGeneratedColorTags || [],
      scenarioFixedOwnerColors: fixedOwnerColors,
      sovereignBaseColors: fixedOwnerColors,
    };
  }

  function buildScenarioPresentationCommitState(staged) {
    return {
      ...captureScenarioPresentationState(runtimeState).values,
      scenarioParentBorderEnabledBeforeActivate:
        staged.scenarioParentBorderEnabledBeforeActivate,
      scenarioDisplaySettingsBeforeActivate:
        staged.scenarioDisplaySettingsBeforeActivate,
      scenarioOceanFillBeforeActivate:
        staged.scenarioOceanFillBeforeActivate,
      activeSovereignCode:
        staged.mapSemanticMode === "blank" ? "" : staged.defaultCountryCode,
      selectedWaterRegionId: "",
      selectedSpecialRegionId: "",
      hoveredWaterRegionId: null,
      hoveredSpecialRegionId: null,
    };
  }

  function assertCompleteAuthorityPatch(patch, keys, label) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      throw new TypeError(
        `[scenario_apply_pipeline] ${label} must be an object`,
      );
    }
    keys.forEach((key) => {
      if (!hasOwnStateKey(patch, key)) {
        throw new Error(
          `[scenario_apply_pipeline] ${label} missing required key: ${key}`,
        );
      }
    });
  }

  function buildScenarioActivationTransactionPatch(bundle, staged) {
    return {
      scenarioReadinessPatch: staged.scenarioReadinessPatch
        || captureScenarioReadinessState(runtimeState).values,
      scenarioPalettePatch: staged.scenarioPalettePatch
        || captureScenarioPaletteState(runtimeState, {
          clonePaletteLoadErrorById: cloneScenarioStateValue,
        }).values,
      scenarioActivationPatch: buildScenarioActivationCommitState(
        bundle,
        staged,
      ),
      scenarioPresentationPatch:
        buildScenarioPresentationCommitState(staged),
    };
  }

  function assertCompleteScenarioActivationTransactionPatch(
    transactionPatch,
  ) {
    assertCompleteAuthorityPatch(
      transactionPatch?.scenarioReadinessPatch,
      SCENARIO_READINESS_STATE_KEYS,
      "scenarioReadinessPatch",
    );
    assertCompleteAuthorityPatch(
      transactionPatch?.scenarioPalettePatch,
      SCENARIO_PALETTE_STATE_KEYS,
      "scenarioPalettePatch",
    );
    assertCompleteAuthorityPatch(
      transactionPatch?.scenarioActivationPatch,
      SCENARIO_ACTIVATION_STATE_KEYS,
      "scenarioActivationPatch",
    );
    assertCompleteAuthorityPatch(
      transactionPatch?.scenarioPresentationPatch,
      SCENARIO_PRESENTATION_STATE_KEYS,
      "scenarioPresentationPatch",
    );
  }

  function normalizeScenarioApplyStrategicValuesPayload(payload, bundle, scenarioId) {
    if (!payload) {
      return null;
    }
    return normalizeScenarioStrategicValuesPayload(payload, {
      expected: {
        scenario_id: scenarioId,
        baseline_hash: getScenarioBaselineHashFromBundle(bundle) || bundle?.manifest?.baseline_hash || "",
      },
    });
  }

  function publishScenarioActivationStateObservers(bundle, staged) {
    // runtime commit 完成后再发布 localization、blank presentation 与 audit
    // observers；异常由外层 transaction snapshot 恢复全部受控字段。
    syncScenarioLocalizationState({
      cityOverridesPayload: staged.mapSemanticMode === "blank" ? null : (staged.scenarioCityOverridesPayload || null),
      geoLocalePatchPayload: staged.mapSemanticMode === "blank" ? null : (bundle.geoLocalePatchPayload || null),
    });
    if (staged.mapSemanticMode === "blank") {
      applyBlankScenarioPresentationDefaults({ resetLocalization: false });
    }
    setScenarioAuditUiState({
      loading: false,
      loadedForScenarioId: bundle.auditPayload ? staged.scenarioId : "",
      errorMessage: "",
    });
  }

  function commitScenarioActivationState(transactionPatch, staged) {
    commitScenarioReadinessState(
      runtimeState,
      transactionPatch.scenarioReadinessPatch,
    );
    if (staged.scenarioPaletteSyncRequested) {
      commitScenarioPaletteState(
        runtimeState,
        transactionPatch.scenarioPalettePatch,
      );
    }
    commitScenarioActivationAuthorityState(
      runtimeState,
      transactionPatch.scenarioActivationPatch,
    );
    setScenarioPoliticalChunkPayloadState(runtimeState, {
      payload:
        transactionPatch.scenarioActivationPatch.scenarioPoliticalChunkData,
    });
    commitScenarioPresentationState(
      runtimeState,
      transactionPatch.scenarioPresentationPatch,
    );
    return transactionPatch.scenarioActivationPatch;
  }

  function runScenarioActivationPostCommitPhase(bundle, staged) {

    syncScenarioInspectorSelection("");
    disableScenarioParentBorders();
    applyScenarioPaintMode();
    syncScenarioOceanFillForActivation(bundle.manifest);
    applyScenarioPerformanceHints(bundle.manifest);
    commitScenarioChunkRuntimeState(bundle, staged);
  }

  function publishScenarioActivationObservers(bundle, staged) {
    publishScenarioActivationStateObservers(bundle, staged);
    runScenarioActivationPostCommitPhase(bundle, staged);
  }

  function commitScenarioChunkRuntimeState(bundle, staged) {
    // chunk runtime 的壳状态和 payload cache 在这里统一接管。
    // 非 chunked 场景直接 reset，避免旧场景留下的 detail/chunk 状态混进新场景。
    // 这里的 reset 不是保守清空，而是显式把 owner 交回当前场景，避免上一场景的缓存继续冒充已加载。
    const supportsChunkedRuntime = scenarioSupportsChunkedRuntime(bundle);
    setScenarioChunkRuntimeHooksState(runtimeState, {
      scheduleScenarioChunkRefreshFn: supportsChunkedRuntime ? scheduleScenarioChunkRefresh : null,
      awaitInitialScenarioChunkVisualPromotionFn: supportsChunkedRuntime
        ? awaitInitialScenarioChunkVisualPromotion
        : null,
    });
    if (supportsChunkedRuntime) {
      resetScenarioChunkRuntimeState({ scenarioId: staged.scenarioId });
      const chunkIds = Object.keys(bundle.chunkPayloadCacheById || {});
      if (chunkIds.length) {
        replaceScenarioChunkRuntimeState(runtimeState, {
          activeScenarioChunks: {
            ...runtimeState.activeScenarioChunks,
            loadedChunkIds: [...chunkIds],
            payloadByChunkId: { ...(bundle.chunkPayloadCacheById || {}) },
            lruChunkIds: [...chunkIds],
          },
          runtimeChunkLoadState: runtimeState.runtimeChunkLoadState,
        });
      }
      patchScenarioChunkLoadState(runtimeState, {
        shellStatus: chunkIds.length ? "ready" : "loading",
        registryStatus: scenarioBundleHasChunkedData(bundle) ? "ready" : "idle",
      });
      return;
    }
    resetScenarioChunkRuntimeState();
  }

  function normalizeScenarioIso2Code(value) {
    const normalized = String(value || "").trim().toUpperCase();
    return /^[A-Z]{2}$/.test(normalized) ? normalized : "";
  }

  function buildScenarioCoarseColorMap({
    startupApplySeed,
    countryMap,
    scenarioColorMap,
  }) {
    if (startupApplySeed?.coarse_color_map && typeof startupApplySeed.coarse_color_map === "object") {
      const sanitized = {};
      Object.entries(startupApplySeed.coarse_color_map).forEach(([rawIso2, rawColor]) => {
        const iso2 = normalizeScenarioIso2Code(rawIso2);
        const color = String(rawColor || "").trim().toLowerCase();
        if (iso2 && /^#[0-9a-f]{6}$/.test(color)) {
          sanitized[iso2] = color;
        }
      });
      return sanitized;
    }
    const coarseCandidates = {};
    Object.entries(countryMap || {}).forEach(([rawTag, rawEntry]) => {
      const tag = String(rawTag || "").trim().toUpperCase();
      const entry = rawEntry && typeof rawEntry === "object" ? rawEntry : {};
      const iso2 = normalizeScenarioIso2Code(entry.base_iso2 || entry.lookup_iso2);
      const color = String(
        scenarioColorMap?.[tag]
        || entry.color_hex
        || entry.colorHex
        || ""
      ).trim().toLowerCase();
      if (!iso2 || !/^#[0-9a-f]{6}$/.test(color)) {
        return;
      }
      const featureCount = Number(entry.feature_count);
      const score = Number.isFinite(featureCount) ? featureCount : 0;
      const existing = coarseCandidates[iso2];
      if (!existing || score > existing.score) {
        coarseCandidates[iso2] = { score, color };
      }
    });
    const coarseColorMap = {};
    Object.entries(coarseCandidates).forEach(([iso2, entry]) => {
      if (entry?.color) {
        coarseColorMap[iso2] = entry.color;
      }
    });
    return coarseColorMap;
  }

  async function prepareScenarioApplyState(
    bundle,
    {
      syncPalette = true,
      interactionLevel = "full",
      scenarioApplyEpoch = 0,
      scenarioApplyRequestId = 0,
    } = {}
  ) {
    // apply 前半段先守住“能不能安全进入场景”这条线：
    // detail topology / palette / countries / owners 任一关键输入缺失，都在真正 commit 前直接失败。
    const startupReadonly = interactionLevel === "readonly-startup";
    const supportsChunkedPoliticalRuntime = scenarioSupportsChunkedRuntime(bundle)
      && (!!bundle?.manifest?.detail_chunk_manifest_url || !!bundle?.manifest?.runtime_meta_url);
    const {
      detailPromoted,
      scenarioReadinessPatch,
    } = await stageScenarioReadinessPatch({
      startupReadonly,
      supportsChunkedPoliticalRuntime,
    });
    const politicalChunkedReady =
      supportsChunkedPoliticalRuntime
      || (scenarioBundleUsesChunkedLayer(bundle, "political")
        && scenarioBundleHasChunkedData(bundle));
    const detailReady = (
      scenarioReadinessPatch.topologyBundleMode === "composite"
      && hasUsablePoliticalTopology(scenarioReadinessPatch.topologyDetail)
    ) || !!detailPromoted || politicalChunkedReady;
    // detailReady 只表示“允许进入 apply 的最低入场条件已经满足”。
    // 后续的 hydration health gate、chunk 接管和 post-commit 细化仍可能继续补齐更多 runtime 面。
    // 所以 coarse 路径能继续，不等于场景已经完全稳定；真正 ready 还要看后续 owner 是否把细节面接管完整。
    if (!detailReady && scenarioNeedsDetailTopology(bundle.manifest) && !startupReadonly) {
      const scenarioLabel = getScenarioDisplayName(
        bundle.manifest,
        String(bundle.manifest?.scenario_id || "Scenario").trim()
      );
      const message = `Detailed political topology could not be loaded. ${scenarioLabel} cannot be applied in coarse mode.`;
      console.error(`[scenario] ${message}`);
      throw new Error(message);
    }
    if (!detailReady && scenarioReadinessPatch.topologyBundleMode !== "composite") {
      console.warn("[scenario] Applying bundle without confirmed detail promotion; health gate will validate runtime topology.");
    }
    const scenarioPalettePatch = await stageScenarioPalettePatch(
      bundle,
      { syncPalette },
    );

    const scenarioId = normalizeScenarioId(bundle.manifest.scenario_id || bundle.meta?.scenario_id);
    if (!scenarioId) {
      throw new Error("Scenario bundle is missing a scenario id.");
    }
    const baseCountryMap = bundle.countriesPayload?.countries;
    if (!baseCountryMap || typeof baseCountryMap !== "object") {
      throw new Error(`Scenario "${scenarioId}" is missing countries data.`);
    }
    const ownersPayload = bundle.ownersPayload?.owners;
    if (!ownersPayload || typeof ownersPayload !== "object") {
      throw new Error(`Scenario "${scenarioId}" is missing owner data.`);
    }
    const baseCountryTags = Object.keys(baseCountryMap);
    const owners = ownersPayload;
    const cores = bundle.coresPayload?.cores && typeof bundle.coresPayload.cores === "object"
      ? normalizeScenarioCoreMap(bundle.coresPayload.cores)
      : {};
    const startupApplySeed = bundle.startupApplySeed && typeof bundle.startupApplySeed === "object"
      ? bundle.startupApplySeed
      : null;
    const defaultCountryCode = String(
      startupApplySeed?.default_country_code
      || getScenarioDefaultCountryCode(bundle.manifest, baseCountryMap)
    ).trim().toUpperCase();
    const mapSemanticMode = String(
      startupApplySeed?.map_semantic_mode
      || getScenarioMapSemanticMode(bundle.manifest)
    ).trim().toLowerCase() || "political";
    const releasableIndex = buildScenarioReleasableIndex(scenarioId, {
      excludeTags: baseCountryTags,
    });
    const releasableCountries = getScenarioReleasableCountries(scenarioId, {
      excludeTags: baseCountryTags,
    });
    Object.keys(releasableCountries).forEach((tag) => {
      if (baseCountryMap[tag]) {
        console.warn(`[scenario] Releasable tag conflict detected for "${tag}" while applying "${scenarioId}".`);
      }
    });
    const countryMap = {
      ...baseCountryMap,
      ...releasableCountries,
    };
    const runtimeTopologyPayload = bundle.runtimeTopologyPayload || null;
    if (
      mapSemanticMode !== "blank"
      && (
        !runtimeTopologyPayload
        || !Array.isArray(runtimeTopologyPayload?.objects?.political?.geometries)
        || runtimeTopologyPayload.objects.political.geometries.length === 0
        || !hasRenderableScenarioPoliticalTopology(runtimeTopologyPayload, bundle)
      )
    ) {
      throw new Error(
        `Scenario "${scenarioId}" runtime topology is not renderable: objects.political.geometries is required.`
      );
    }
    const runtimeVersionTag = runtimeTopologyPayload
      ? buildScenarioRuntimeVersionTag(bundle, runtimeTopologyPayload)
      : "";
    const districtGroupsPayload = normalizeScenarioDistrictGroupsPayload(bundle.districtGroupsPayload, scenarioId);
    const mergedWaterPayload = getActiveScenarioMergedChunkLayerPayload("water", scenarioId);
    const mergedSpecialPayload = getActiveScenarioMergedChunkLayerPayload("special", scenarioId);
    const mergedAtlantropaPayload = getActiveScenarioMergedChunkLayerPayload("scenario_atlantropa", scenarioId);
    const mergedReliefPayload = getActiveScenarioMergedChunkLayerPayload("relief", scenarioId);
    const mergedCitiesPayload = getActiveScenarioMergedChunkLayerPayload("cities", scenarioId);
    const mergedStrategicValuesPayload = getActiveScenarioMergedChunkLayerPayload("strategicvalues", scenarioId);
    const scenarioStrategicValuesPayload = normalizeScenarioApplyStrategicValuesPayload(
      mergedStrategicValuesPayload !== undefined
        ? mergedStrategicValuesPayload
        : (bundle.strategicValuesPayload || null),
      bundle,
      scenarioId
    );
    // 这里用 undefined 区分“runtime 还没接管该 layer”，此时继续回退到 bundle/topology。
    // 只要 runtime 显式给出 null 或 payload，都按 runtime 的结论提交。
    const scenarioWaterRegionsFromTopology =
      mergedWaterPayload !== undefined
        ? mergedWaterPayload
        : (
          bundle.waterRegionsPayload
          || getScenarioDecodedCollection(bundle, "scenarioWaterRegionsData")
          || getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "scenario_water", bundle)
        );
    const scenarioSpecialRegionsFromTopology =
      mergedSpecialPayload !== undefined
        ? mergedSpecialPayload
        : (
          getScenarioDecodedCollection(bundle, "scenarioSpecialRegionsData")
          || getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "scenario_special_land", bundle)
        );
    const scenarioAtlantropaFromTopology =
      mergedAtlantropaPayload !== undefined
        ? mergedAtlantropaPayload
        : (
          getScenarioDecodedCollection(bundle, "scenarioAtlantropaData")
          || getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "scenario_atlantropa", bundle)
        );
    const scenarioContextLandMaskFromTopology =
      getScenarioDecodedCollection(bundle, "scenarioContextLandMaskData")
      || getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "context_land_mask", bundle);
    const scenarioLandMaskFromTopology =
      getScenarioDecodedCollection(bundle, "scenarioLandMaskData")
      || getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "land_mask", bundle)
      || getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "land", bundle);
    const scenarioNameMap = startupApplySeed?.scenario_name_map && typeof startupApplySeed.scenario_name_map === "object"
      ? { ...getScenarioNameMap(countryMap), ...startupApplySeed.scenario_name_map }
      : getScenarioNameMap(countryMap);
    const missingScenarioNameTags = getMissingScenarioNameTags(countryMap, scenarioNameMap);
    if (missingScenarioNameTags.length) {
      throw new Error(
        `Scenario "${scenarioId}" is missing display names for active tags: ${missingScenarioNameTags.slice(0, 12).join(", ")}`
      );
    }
    const seedScenarioColorMap = startupApplySeed?.scenario_color_map && typeof startupApplySeed.scenario_color_map === "object"
      ? { ...startupApplySeed.scenario_color_map }
      : {};
    const scenarioOwnerBackfill = startupApplySeed?.resolved_owners && typeof startupApplySeed.resolved_owners === "object"
      ? {}
      : buildHoi4FarEastSovietOwnerBackfill(scenarioId, {
        runtimeTopology: runtimeTopologyPayload?.objects?.political
          ? runtimeTopologyPayload
          : (runtimeState.defaultRuntimePoliticalTopology || runtimeState.runtimePoliticalTopology || null),
        ownersByFeatureId: owners,
        controllersByFeatureId: owners,
      });
    const resolvedOwners = startupApplySeed?.resolved_owners && typeof startupApplySeed.resolved_owners === "object"
      ? { ...startupApplySeed.resolved_owners }
      : (
        Object.keys(scenarioOwnerBackfill).length
          ? {
            ...owners,
            ...scenarioOwnerBackfill,
          }
          : { ...owners }
      );
    const ownerColorTags = buildScenarioOwnerColorUniverse({
      baseCountryMap,
      countryMap,
      countryNames,
      baseTopologyPayload: runtimeState.topologyPrimary || runtimeState.topology || null,
      owners,
      resolvedOwners,
      releasableIndex,
      releasableCountries,
      runtimeTopologyPayload,
      startupApplySeed,
    });
    const fixedScenarioCountryColors = getScenarioFixedOwnerColors(countryMap);
    const scenarioColorDetails = buildScenarioOwnerColorMapDetails(countryMap, {
      palettePack: scenarioPalettePatch.activePalettePack,
      paletteMap: scenarioPalettePatch.activePaletteMap,
      seedColorByTag: seedScenarioColorMap,
      fallbackColorByTag: fixedScenarioCountryColors,
      ownerTags: ownerColorTags,
    });
    const scenarioColorMap = scenarioColorDetails.byTag;
    const coarseColorMap = buildScenarioCoarseColorMap({
      startupApplySeed,
      countryMap,
      scenarioColorMap,
    });
    const activationContext = prepareScenarioActivationContext(bundle);
    const staged = {
      scenarioId,
      scenarioApplyEpoch: Math.max(0, Number(scenarioApplyEpoch || 0)),
      scenarioApplyRequestId: Math.max(0, Number(scenarioApplyRequestId || 0)),
      baseCountryMap,
      defaultCountryCode,
      mapSemanticMode,
      countryMap,
      runtimeTopologyPayload,
      runtimeVersionTag,
      districtGroupsPayload,
      scenarioWaterRegionsFromTopology,
      scenarioSpecialRegionsFromTopology,
      scenarioAtlantropaFromTopology,
      scenarioContextLandMaskFromTopology,
      scenarioLandMaskFromTopology,
      scenarioReliefOverlaysPayload: mergedReliefPayload !== undefined
        ? mergedReliefPayload
        : (bundle.reliefOverlaysPayload || null),
      scenarioCityOverridesPayload: mergedCitiesPayload !== undefined
        ? mergedCitiesPayload
        : (bundle.cityOverridesPayload || null),
      scenarioStrategicValuesPayload,
      scenarioNameMap,
      scenarioColorMap,
      scenarioGeneratedColorTags: scenarioColorDetails.generatedTags,
      scenarioOwnerColorTags: ownerColorTags,
      coarseColorMap,
      scenarioOwnerBackfill,
      resolvedOwners,
      cores,
      releasableIndex,
      scenarioReadinessPatch,
      scenarioPalettePatch,
      scenarioPaletteSyncRequested: !!syncPalette,
      ...activationContext,
    };
    recordRenderTransactionSnapshot(runtimeState, {
      phase: "scenario-apply-pipeline-staged",
      reason: "prepareScenarioApplyState",
      requestedScenarioId: scenarioId,
      source: "scenario_apply_pipeline",
      extra: {
        allowScenarioMismatch: true,
        runtimeTopologyRenderable: hasRenderableScenarioPoliticalTopology(runtimeTopologyPayload, bundle),
        runtimeTopologyObjectCount: runtimeTopologyPayload?.objects && typeof runtimeTopologyPayload.objects === "object"
          ? Object.keys(runtimeTopologyPayload.objects).length
          : 0,
        scenarioWaterSource: scenarioWaterRegionsFromTopology ? "topology-or-merged" : "none",
        scenarioAtlantropaSource: scenarioAtlantropaFromTopology ? "topology-or-merged" : "none",
        scenarioSpecialSource: scenarioSpecialRegionsFromTopology ? "topology-or-merged" : "none",
        scenarioApplyEpoch: Math.max(0, Number(scenarioApplyEpoch || 0)),
        scenarioApplyRequestId: Math.max(0, Number(scenarioApplyRequestId || 0)),
        fixedOwnerColorCount: Object.keys(scenarioColorMap || {}).length,
        ownerColorUniverseCount: ownerColorTags.length,
        generatedOwnerColorCount: scenarioColorDetails.generatedTags.length,
        coarseColorCount: Object.keys(coarseColorMap || {}).length,
        resolvedOwnerCount: Object.keys(resolvedOwners || {}).length,
      },
    });
    return staged;
  }

  function applyPreparedScenarioState(bundle, staged) {
    const transactionSnapshot =
      captureScenarioActivationTransactionState();
    const transactionPatch =
      buildScenarioActivationTransactionPatch(bundle, staged);
    recordRenderTransactionSnapshot(runtimeState, {
      phase: "scenario-apply-precommit-start",
      reason: "applyPreparedScenarioState",
      requestedScenarioId: staged?.scenarioId,
      source: "scenario_apply_pipeline",
      extra: {
        allowScenarioMismatch: true,
        scenarioApplyEpoch: Math.max(0, Number(staged?.scenarioApplyEpoch || 0)),
        scenarioApplyRequestId: Math.max(0, Number(staged?.scenarioApplyRequestId || 0)),
      },
    });
    try {
      assertCompleteScenarioActivationTransactionPatch(transactionPatch);
      const activationCommitAccepted =
        validateScenarioActivationCommitState(
          transactionPatch.scenarioActivationPatch,
          transactionPatch,
        );
      if (activationCommitAccepted === false) {
        throw new Error(
          "[scenario_apply_pipeline] scenario activation commit validation rejected the transaction",
        );
      }
      recordRenderTransactionSnapshot(runtimeState, {
        phase: "scenario-apply-runtime-commit-start",
        reason: "applyPreparedScenarioState",
        requestedScenarioId: staged?.scenarioId,
        source: "scenario_apply_pipeline",
        extra: {
          allowScenarioMismatch: true,
          scenarioApplyEpoch: Math.max(0, Number(staged?.scenarioApplyEpoch || 0)),
          scenarioApplyRequestId: Math.max(0, Number(staged?.scenarioApplyRequestId || 0)),
        },
      });
      commitScenarioActivationState(transactionPatch, staged);
      recordRenderTransactionSnapshot(runtimeState, {
        phase: "scenario-apply-runtime-commit-complete",
        reason: "applyPreparedScenarioState",
        requestedScenarioId: staged?.scenarioId,
        expectedScenarioId: staged?.scenarioId,
        source: "scenario_apply_pipeline",
        extra: {
          scenarioApplyEpoch: Math.max(0, Number(staged?.scenarioApplyEpoch || 0)),
          scenarioApplyRequestId: Math.max(0, Number(staged?.scenarioApplyRequestId || 0)),
          runtimeTopologyWritten:
            !!transactionPatch.scenarioActivationPatch
              .scenarioRuntimeTopologyData,
          runtimePoliticalTopologySource:
            transactionPatch.scenarioActivationPatch
              .runtimePoliticalTopology === staged?.runtimeTopologyPayload
            ? "staged"
            : "runtime-or-default",
          scenarioWaterFeatureCount: Array.isArray(
            transactionPatch.scenarioActivationPatch
              .scenarioWaterRegionsData?.features,
          )
            ? transactionPatch.scenarioActivationPatch
              .scenarioWaterRegionsData.features.length
            : 0,
          scenarioAtlantropaFeatureCount: Array.isArray(
            transactionPatch.scenarioActivationPatch
              .scenarioAtlantropaData?.features,
          )
            ? transactionPatch.scenarioActivationPatch
              .scenarioAtlantropaData.features.length
            : 0,
          scenarioSpecialFeatureCount: Array.isArray(
            transactionPatch.scenarioActivationPatch
              .scenarioSpecialRegionsData?.features,
          )
            ? transactionPatch.scenarioActivationPatch
              .scenarioSpecialRegionsData.features.length
            : 0,
        },
      });
      publishScenarioActivationObservers(bundle, staged);
      if (staged.scenarioPaletteSyncRequested) {
        publishScenarioPaletteAndToolbarState({
          overwriteCountryPalette: false,
        });
      }
      recordRenderTransactionSnapshot(runtimeState, {
        phase: "scenario-apply-postcommit-complete",
        reason: "applyPreparedScenarioState",
        requestedScenarioId: staged?.scenarioId,
        expectedScenarioId: staged?.scenarioId,
        source: "scenario_apply_pipeline",
        extra: {
          scenarioApplyEpoch: Math.max(0, Number(staged?.scenarioApplyEpoch || 0)),
          scenarioApplyRequestId: Math.max(0, Number(staged?.scenarioApplyRequestId || 0)),
        },
      });
    } catch (error) {
      restoreScenarioActivationTransactionState(transactionSnapshot);
      throw error;
    }
  }

  return {
    prepareScenarioApplyState,
    applyPreparedScenarioState,
  };
}

export {
  createScenarioApplyPipeline,
};
