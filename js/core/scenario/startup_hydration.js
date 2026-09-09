// Startup hydration controller.
// 这个模块负责 startup shell decode、active scenario hydrate、health gate 与 locale patch 同步。
// scenario_resources.js 继续保留 facade、bundle cache、startup cache 与对外 export 面。

import {
  STATE_BUS_EVENTS,
  callRuntimeHook,
  emitStateBusEvent,
} from "../state/index.js";
import {
  clearStartupReadonlyStateForReason,
  commitStartupReadonlyStateFields,
} from "../state/actions/boot_actions.js";
import {
  hasStartupReadonlyReason,
} from "../state/boot_state.js";
import {
  SCENARIO_HYDRATION_HEALTH_REASONS,
  normalizeScenarioHydrationHealthGateState,
  resetScenarioHydrationOverlayState,
  setHydratedScenarioRuntimeTopologyState,
  setScenarioRuntimeOptionalLayerState,
} from "../state/scenario_runtime_state.js";
import {
  setScenarioHydrationHealthGateState,
} from "../state/actions/scenario_health_actions.js";
import {
  hydrateScenarioReleasableCatalogState,
  setScenarioAuditState,
} from "../state_catalog.js";

function createScenarioStartupHydrationController({
  state,
  normalizeScenarioId,
  normalizeScenarioRuntimeTopologyPayload,
  normalizeScenarioGeoLocalePatchPayload,
  normalizeFeatureText,
  normalizeScenarioFeatureCollection,
  getScenarioRuntimePoliticalFeatureCount,
  getScenarioDecodedCollection,
  getScenarioRuntimeMergedLayerPayloads,
  hasScenarioMergedLayerPayload,
  areScenarioFeatureCollectionsEquivalent,
  applyScenarioPoliticalChunkPayload,
  loadOptionalScenarioResource,
  getScenarioGeoLocalePatchDescriptor,
  getLoadScenarioBundle,
  syncScenarioLocalizationState,
  syncCountryUi,
  syncScenarioUi,
  setScenarioAuditUiState,
  mergeReleasableCatalogs,
  buildScenarioDistrictGroupByFeatureId,
  buildScenarioReleasableIndex,
  invalidateContextLayerVisualStateBatch,
  invalidateOceanWaterInteractionVisualState,
  refreshColorState,
  createStartupHydrationRefreshPlan = null,
  refreshMapDataForScenarioChunkPromotion,
  refreshScenarioOpeningOwnerBorders = () => false,
  flushRenderBoundary,
  enterScenarioFatalRecovery,
  consumeScenarioTestHook,
  t,
  showToast,
  ownerFeatureCoverageMinRatio = 0.85,
  ownerFeatureCoverageMinFeatures = 1000,
} = {}) {
  function getScenarioTopologyFeatureCollection(topologyPayload, objectName) {
    const object = topologyPayload?.objects?.[objectName];
    if (!object || typeof globalThis.topojson?.feature !== "function") {
      return null;
    }
    try {
      return normalizeScenarioFeatureCollection(globalThis.topojson.feature(topologyPayload, object));
    } catch (error) {
      console.warn(`[scenario] Failed to decode scenario topology object "${objectName}".`, error);
      return null;
    }
  }

  function hasRenderableScenarioPoliticalTopology(runtimeTopologyPayload) {
    const geometries = runtimeTopologyPayload?.objects?.political?.geometries;
    return Array.isArray(geometries)
      && geometries.length > 0
      && !!getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "political");
  }

  function isRuntimeOnlyShellFallbackFeature(feature) {
    const props = feature?.properties || {};
    return String(props.scenario_helper_kind || "").trim().toLowerCase() === "shell_fallback"
      && props.render_as_base_geography === false;
  }

  function getPromotablePoliticalPayloadDecision(payload, mapSemanticMode) {
    const collection = normalizeScenarioFeatureCollection(payload);
    if (!collection) return { hasPayload: false, payload: null };
    if (String(mapSemanticMode || "").trim().toLowerCase() === "blank") {
      return { hasPayload: true, payload: collection };
    }
    const features = Array.isArray(collection.features) ? collection.features : [];
    const promotableFeatures = features.filter((feature) => !isRuntimeOnlyShellFallbackFeature(feature));
    if (!features.length || promotableFeatures.length === features.length) {
      return { hasPayload: true, payload: collection };
    }
    if (!promotableFeatures.length) {
      return { hasPayload: true, payload: null };
    }
    return {
      hasPayload: true,
      payload: { ...collection, features: promotableFeatures },
    };
  }

  function getPoliticalPayloadDecisionFromRuntimeTopology(runtimeTopologyPayload, mapSemanticMode) {
    const collection = getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "political");
    return getPromotablePoliticalPayloadDecision(collection, mapSemanticMode);
  }

  function normalizeScenarioSourceMetadata(source) {
    return source && typeof source === "object" ? source : {};
  }

  function getRequiredRuntimeSourceShaKeys(bundle) {
    const isBootstrap = String(bundle?.bundleLevel || "").trim().toLowerCase() === "bootstrap";
    const chunked = !!String(bundle?.manifest?.detail_chunk_manifest_url || "").trim();
    const keys = [
      isBootstrap || chunked
        ? "runtime_bootstrap_topology_sha256"
        : "runtime_topology_sha256",
    ];
    if (chunked) {
      keys.push("detail_chunk_manifest_sha256");
    }
    return keys;
  }

  function getScenarioRuntimeSourceShaStatus(bundle) {
    const source = normalizeScenarioSourceMetadata(bundle?.source);
    const missingKeys = getRequiredRuntimeSourceShaKeys(bundle)
      .filter((key) => !String(source[key] || "").trim());
    return {
      ok: missingKeys.length === 0,
      missingKeys,
      source,
    };
  }

  async function ensureScenarioGeoLocalePatchForLanguage(
    language,
    {
      d3Client = globalThis.d3,
      forceReload = false,
      renderNow = false,
    } = {}
  ) {
    const scenarioId = normalizeScenarioId(state.activeScenarioId);
    if (!scenarioId) return null;
    const loadScenarioBundle = getLoadScenarioBundle();
    const bundle = await loadScenarioBundle(scenarioId, { d3Client, bundleLevel: "full" });
    if (!bundle?.manifest) return null;

    const descriptor = getScenarioGeoLocalePatchDescriptor(bundle.manifest, language);
    if (!descriptor.url) {
      syncScenarioLocalizationState({ geoLocalePatchPayload: null });
      syncCountryUi({ renderNow });
      emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_DEV_WORKSPACE_UI);
      return null;
    }

    bundle.geoLocalePatchPayloadsByLanguage =
      bundle.geoLocalePatchPayloadsByLanguage && typeof bundle.geoLocalePatchPayloadsByLanguage === "object"
        ? bundle.geoLocalePatchPayloadsByLanguage
        : {};

    // locale-specific patch 只按语言缓存一份；共享 patch 则同时挂到 en/zh，
    // 这样保存后 reload 不会因为 UI 当前语言切换而把同一份 payload 重复拉两次。
    let payload = !forceReload ? bundle.geoLocalePatchPayloadsByLanguage[descriptor.language] || null : null;
    if (!payload) {
      const result = await loadOptionalScenarioResource(d3Client, descriptor.url, {
        scenarioId,
        resourceLabel: descriptor.localeSpecific
          ? `geo_locale_patch_${descriptor.language}`
          : "geo_locale_patch",
      });
      payload = normalizeScenarioGeoLocalePatchPayload(result.value);
      if (payload) {
        if (descriptor.localeSpecific) {
          bundle.geoLocalePatchPayloadsByLanguage[descriptor.language] = payload;
        } else {
          bundle.geoLocalePatchPayloadsByLanguage.en = payload;
          bundle.geoLocalePatchPayloadsByLanguage.zh = payload;
        }
      }
    }

    // 异步资源回来前用户可能已经切走场景；这里允许返回加载结果给调用方，
    // 但不再把旧场景的 locale patch 回写进当前 runtime。
    if (normalizeScenarioId(state.activeScenarioId) !== scenarioId) {
      return payload || null;
    }
    bundle.geoLocalePatchPayload = payload || null;
    syncScenarioLocalizationState({ geoLocalePatchPayload: payload || null });
    syncCountryUi({ renderNow });
    emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_DEV_WORKSPACE_UI);
    return payload || null;
  }

  function applyBlankScenarioPresentationDefaults({ resetLocalization = true } = {}) {
    if (resetLocalization) {
      syncScenarioLocalizationState({
        cityOverridesPayload: null,
        geoLocalePatchPayload: null,
      });
    }
    state.showCityPoints = false;
    emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_TOOLBAR_INPUTS);
  }

  function buildScenarioRuntimeVersionTag(bundle, runtimeTopologyPayload) {
    const scenarioId = normalizeScenarioId(
      bundle?.manifest?.scenario_id
      || bundle?.meta?.scenario_id
      || state.activeScenarioId
    ) || "scenario";
    // version tag 不是给用户看的版本号，而是 hydration / overlay / chunk 刷新链共享的“同一份 runtime 壳层身份标记”。
    // 这里优先拼 source sha，避免不同来源但同场景 id 的旧 overlay 被误当作可复用状态。
    void runtimeTopologyPayload;
    const sourceStatus = getScenarioRuntimeSourceShaStatus(bundle);
    if (!sourceStatus.ok) {
      return `${scenarioId}:${SCENARIO_HYDRATION_HEALTH_REASONS.missingRuntimeSourceSha}:${sourceStatus.missingKeys.join("+")}`;
    }
    const isBootstrap = String(bundle?.bundleLevel || "").trim().toLowerCase() === "bootstrap";
    const chunked = !!String(bundle?.manifest?.detail_chunk_manifest_url || "").trim();
    const topologySha = isBootstrap || chunked
      ? String(sourceStatus.source.runtime_bootstrap_topology_sha256 || "").trim()
      : String(sourceStatus.source.runtime_topology_sha256 || "").trim();
    const chunkManifestSha = chunked
      ? `:${String(sourceStatus.source.detail_chunk_manifest_sha256 || "").trim()}`
      : "";
    return `${scenarioId}:${topologySha}${chunkManifestSha}`;
  }

  function collectFeatureIdsFromCollection(collection) {
    const features = Array.isArray(collection?.features) ? collection.features : [];
    const ids = new Set();
    features.forEach((feature) => {
      const featureId = normalizeFeatureText(
        feature?.properties?.id
        || feature?.id
      );
      if (featureId) ids.add(featureId);
    });
    return ids;
  }

  function clearScenarioHealthGateReadonlyState() {
    if (!hasStartupReadonlyReason(state, "scenario-health-gate")) {
      return false;
    }
    if (state.startupReadonly) {
      const handled = callRuntimeHook(state, "setStartupReadonlyStateFn", false);
      if (handled !== undefined) {
        return true;
      }
    }
    clearStartupReadonlyStateForReason(state, "scenario-health-gate");
    return true;
  }

  function hydrateActiveScenarioBundle(
    bundle,
    {
      renderNow = true,
    } = {}
  ) {
    const bundleScenarioId = normalizeScenarioId(bundle?.manifest?.scenario_id || bundle?.meta?.scenario_id);
    if (!bundleScenarioId || bundleScenarioId !== normalizeScenarioId(state.activeScenarioId)) {
      return false;
    }
    const runtimeTopologyPayload =
      normalizeScenarioRuntimeTopologyPayload(bundle.runtimeTopologyPayload) || state.scenarioRuntimeTopologyData || null;
    const mapSemanticMode = String(bundle?.manifest?.map_mode || "").trim().toLowerCase();
    const runtimeMergedLayerPayloads = getScenarioRuntimeMergedLayerPayloads(bundle);
    const mergedWaterPayload = hasScenarioMergedLayerPayload(runtimeMergedLayerPayloads, "water")
      ? runtimeMergedLayerPayloads.water || null
      : undefined;
    const mergedSpecialPayload = hasScenarioMergedLayerPayload(runtimeMergedLayerPayloads, "special")
      ? runtimeMergedLayerPayloads.special || null
      : undefined;
    const mergedAtlantropaPayload = hasScenarioMergedLayerPayload(runtimeMergedLayerPayloads, "scenario_atlantropa")
      ? runtimeMergedLayerPayloads.scenario_atlantropa || null
      : undefined;
    const mergedPoliticalPayload = hasScenarioMergedLayerPayload(runtimeMergedLayerPayloads, "political")
      ? runtimeMergedLayerPayloads.political || null
      : undefined;
    const mergedReliefPayload = hasScenarioMergedLayerPayload(runtimeMergedLayerPayloads, "relief")
      ? runtimeMergedLayerPayloads.relief || null
      : undefined;
    const mergedCitiesPayload = hasScenarioMergedLayerPayload(runtimeMergedLayerPayloads, "cities")
      ? runtimeMergedLayerPayloads.cities || null
      : undefined;
    let scenarioOverlayChanged = false;
    let contextBaseChanged = false;
    let scenarioAtlantropaChanged = false;
    let scenarioWaterChanged = false;
    let hydrationChangedLayerKeys = [];
    if (runtimeTopologyPayload) {
      // 这里先用 runtime topology 定住“壳层真相”，再决定各类 overlay 是否复用缓存、是否需要刷新版本标签。
      // 顺序不能反过来，否则 water / land mask 这类派生层会拿到和当前 runtime 壳层不一致的身份标记。
      if (mapSemanticMode !== "blank" && !hasRenderableScenarioPoliticalTopology(runtimeTopologyPayload)) {
        setScenarioHydrationHealthGateState(state, normalizeScenarioHydrationHealthGateState({
          status: "fatal",
          reason: SCENARIO_HYDRATION_HEALTH_REASONS.runtimeTopologyUnrenderable,
          checkedAt: Date.now(),
          attemptedRetry: false,
          ownerFeatureOverlapRatio: 0,
          ownerFeatureOverlapCount: 0,
          ownerFeatureRenderedCount: 0,
          degradedWaterOverlay: false,
        }));
        const handled = callRuntimeHook(state, "setStartupReadonlyStateFn", true, {
          reason: "scenario-health-gate",
          unlockInFlight: false,
        });
        if (handled === undefined) {
          commitStartupReadonlyStateFields(state, {
            active: true,
            reason: "scenario-health-gate",
            unlockInFlight: false,
            since: Number(state.startupReadonlySince) || 0,
          });
        }
        syncScenarioUi();
        syncCountryUi({ renderNow: false });
        return false;
      }
      const runtimeVersionTag = buildScenarioRuntimeVersionTag(bundle, runtimeTopologyPayload);
      const nextRuntimePoliticalTopology = runtimeTopologyPayload;
      const nextScenarioLandMaskData =
        getScenarioDecodedCollection(bundle, "scenarioLandMaskData")
        || getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "land_mask")
        || state.scenarioLandMaskData
        || null;
      const nextScenarioContextLandMaskData =
        getScenarioDecodedCollection(bundle, "scenarioContextLandMaskData")
        || getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "context_land_mask")
        || state.scenarioContextLandMaskData
        || null;
      const hasBundleWaterPayload = Object.prototype.hasOwnProperty.call(bundle || {}, "waterRegionsPayload");
      const decodedWaterPayload = getScenarioDecodedCollection(bundle, "scenarioWaterRegionsData");
      const topologyWaterPayload = getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "scenario_water");
      const bundleWaterPayload = hasBundleWaterPayload ? bundle.waterRegionsPayload : undefined;
      const nextScenarioWaterRegionsData =
        mergedWaterPayload !== undefined
          ? mergedWaterPayload
          : (bundleWaterPayload != null ? bundleWaterPayload : decodedWaterPayload)
        || topologyWaterPayload
        || state.scenarioWaterRegionsData
        || null;
      const reusingCachedWaterPayload =
        nextScenarioWaterRegionsData
        && mergedWaterPayload === undefined
        && !hasBundleWaterPayload
        && !decodedWaterPayload
        && !topologyWaterPayload
        && nextScenarioWaterRegionsData === state.scenarioWaterRegionsData;
      const nextScenarioWaterOverlayVersionTag = nextScenarioWaterRegionsData
        ? (reusingCachedWaterPayload
          ? String(state.scenarioWaterOverlayVersionTag || "").trim()
          : runtimeVersionTag)
        : "";
      const nextScenarioLandMaskVersionTag = nextScenarioLandMaskData
        ? (nextScenarioLandMaskData === state.scenarioLandMaskData
          ? String(state.scenarioLandMaskVersionTag || "").trim()
          : runtimeVersionTag)
        : "";
      const nextScenarioContextLandMaskVersionTag = nextScenarioContextLandMaskData
        ? (nextScenarioContextLandMaskData === state.scenarioContextLandMaskData
          ? String(state.scenarioContextLandMaskVersionTag || "").trim()
          : runtimeVersionTag)
        : "";
      const nextScenarioSpecialRegionsData =
        mergedSpecialPayload !== undefined
          ? mergedSpecialPayload
          : (
            getScenarioDecodedCollection(bundle, "scenarioSpecialRegionsData")
            || getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "scenario_special_land")
            || bundle.specialRegionsPayload
            || state.scenarioSpecialRegionsData
            || null
          );
      const nextScenarioAtlantropaData =
        mergedAtlantropaPayload !== undefined
          ? mergedAtlantropaPayload
          : (
            getScenarioDecodedCollection(bundle, "scenarioAtlantropaData")
            || getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "scenario_atlantropa")
            || state.scenarioAtlantropaData
            || null
          );
      scenarioWaterChanged = state.scenarioWaterRegionsData !== nextScenarioWaterRegionsData;
      scenarioAtlantropaChanged = state.scenarioAtlantropaData !== nextScenarioAtlantropaData;
      hydrationChangedLayerKeys = [
        ...(scenarioWaterChanged ? ["water"] : []),
        ...(scenarioAtlantropaChanged ? ["scenario_atlantropa"] : []),
      ];
      scenarioOverlayChanged =
        state.scenarioRuntimeTopologyData !== runtimeTopologyPayload
        || scenarioWaterChanged
        || state.scenarioSpecialRegionsData !== nextScenarioSpecialRegionsData
        || scenarioAtlantropaChanged;
      contextBaseChanged =
        state.scenarioRuntimeTopologyData !== runtimeTopologyPayload
        || state.runtimePoliticalTopology !== nextRuntimePoliticalTopology
        || state.scenarioLandMaskData !== nextScenarioLandMaskData
        || state.scenarioContextLandMaskData !== nextScenarioContextLandMaskData;
      setHydratedScenarioRuntimeTopologyState(state, {
        runtimeTopologyData: runtimeTopologyPayload,
        runtimePoliticalTopology: nextRuntimePoliticalTopology,
        runtimePoliticalMetaSeed: bundle.runtimePoliticalMeta || null,
        runtimePoliticalFeatureCollectionSeed: getScenarioDecodedCollection(bundle, "politicalData") || null,
        scenarioLandMaskData: nextScenarioLandMaskData,
        scenarioContextLandMaskData: nextScenarioContextLandMaskData,
        scenarioWaterRegionsData: nextScenarioWaterRegionsData,
        scenarioAtlantropaData: nextScenarioAtlantropaData,
        scenarioRuntimeTopologyVersionTag: runtimeVersionTag,
        scenarioWaterOverlayVersionTag: nextScenarioWaterOverlayVersionTag,
        scenarioLandMaskVersionTag: nextScenarioLandMaskVersionTag,
        scenarioContextLandMaskVersionTag: nextScenarioContextLandMaskVersionTag,
        scenarioSpecialRegionsData: nextScenarioSpecialRegionsData,
      });
    }
    setScenarioRuntimeOptionalLayerState(state, {
      activeScenarioMeshPack: bundle.meshPackPayload || state.activeScenarioMeshPack || null,
    });
    if (
      state.activeScenarioMeshPack?.meshes?.opening_owner_borders
      && state.scenarioBorderMode === "scenario_owner_only"
    ) {
      refreshScenarioOpeningOwnerBorders({
        renderNow: false,
        reason: "scenario-hydrate-opening",
      });
    }
    const runtimePoliticalPayloadDecision = getPoliticalPayloadDecisionFromRuntimeTopology(
      runtimeTopologyPayload,
      mapSemanticMode,
    );
    const decodedPoliticalPayloadDecision = getPromotablePoliticalPayloadDecision(
      getScenarioDecodedCollection(bundle, "politicalData"),
      mapSemanticMode,
    );
    // political payload 优先级从旧 runtime -> decoded full bundle -> merged runtime layer 逐层覆盖。
    // 最后一层 merged payload 代表 chunk/apply 后的最新壳层真相，必须拥有最终解释权。
    const previousScenarioPoliticalPayload = state.scenarioPoliticalChunkData;
    let nextScenarioPoliticalPayload = previousScenarioPoliticalPayload || null;
    if (runtimePoliticalPayloadDecision.hasPayload) {
      nextScenarioPoliticalPayload = runtimePoliticalPayloadDecision.payload;
    }
    if (decodedPoliticalPayloadDecision.hasPayload) {
      nextScenarioPoliticalPayload = decodedPoliticalPayloadDecision.payload;
    }
    if (mergedPoliticalPayload !== undefined) {
      let mergedPoliticalPayloadDecision = { hasPayload: true, payload: null };
      if (mergedPoliticalPayload !== null) {
        mergedPoliticalPayloadDecision = getPromotablePoliticalPayloadDecision(
          mergedPoliticalPayload,
          mapSemanticMode
        );
      }
      nextScenarioPoliticalPayload = mergedPoliticalPayloadDecision.payload;
    }
    const promotedScenarioPolitical = applyScenarioPoliticalChunkPayload(
      bundle,
      nextScenarioPoliticalPayload,
      {
        renderNow: false,
        reason: "scenario-hydrate-political",
        changedLayerKeys: hydrationChangedLayerKeys,
      }
    );
    const hasPoliticalPayloadChange = !areScenarioFeatureCollectionsEquivalent(
      nextScenarioPoliticalPayload,
      previousScenarioPoliticalPayload
    );
    if (!promotedScenarioPolitical) {
      setScenarioRuntimeOptionalLayerState(state, {
        scenarioPoliticalChunkData: nextScenarioPoliticalPayload,
      });
      if (hasPoliticalPayloadChange) {
        refreshMapDataForScenarioChunkPromotion({
          suppressRender: !renderNow,
          hasPoliticalPayloadChange: true,
          refreshPlan: typeof createStartupHydrationRefreshPlan === "function"
            ? createStartupHydrationRefreshPlan({
              changedLayerKeys: ["political", ...hydrationChangedLayerKeys],
              hasPoliticalChange: true,
            })
            : null,
        });
      }
    }
    if (scenarioAtlantropaChanged && !promotedScenarioPolitical && !hasPoliticalPayloadChange) {
      refreshMapDataForScenarioChunkPromotion({
        suppressRender: !renderNow,
        reason: "scenario-hydrate-atlantropa",
        changedLayerKeys: hydrationChangedLayerKeys,
        hasPoliticalPayloadChange: false,
      });
    }
    if (scenarioWaterChanged && !scenarioAtlantropaChanged && !promotedScenarioPolitical && !hasPoliticalPayloadChange) {
      refreshMapDataForScenarioChunkPromotion({
        suppressRender: !renderNow,
        reason: "scenario-hydrate-water",
        changedLayerKeys: ["water"],
        hasPoliticalPayloadChange: false,
      });
    }
    if (bundle.districtGroupsPayload) {
      setScenarioRuntimeOptionalLayerState(state, {
        scenarioDistrictGroupsData: bundle.districtGroupsPayload,
        scenarioDistrictGroupByFeatureId: buildScenarioDistrictGroupByFeatureId(bundle.districtGroupsPayload),
      });
    }
    if (bundle.releasableCatalog) {
      hydrateScenarioReleasableCatalogState(state, {
        releasableCatalog: mergeReleasableCatalogs(state.defaultReleasableCatalog, bundle.releasableCatalog),
        scenarioReleasableIndex: buildScenarioReleasableIndex(bundleScenarioId, { excludeTags: [] }),
      });
    }
    if (bundle.auditPayload) {
      setScenarioAuditState(state, bundle.auditPayload);
      setScenarioAuditUiState({
        loading: false,
        loadedForScenarioId: bundleScenarioId,
        errorMessage: "",
      });
    }
    setScenarioRuntimeOptionalLayerState(state, {
      scenarioReliefOverlaysData: mergedReliefPayload !== undefined
        ? mergedReliefPayload
        : (bundle.reliefOverlaysPayload || state.scenarioReliefOverlaysData || null),
    });
    if (mergedCitiesPayload !== undefined || bundle.cityOverridesPayload) {
      syncScenarioLocalizationState({
        cityOverridesPayload: mergedCitiesPayload !== undefined
          ? mergedCitiesPayload
          : (bundle.cityOverridesPayload || null),
        geoLocalePatchPayload: bundle.geoLocalePatchPayload || state.scenarioGeoLocalePatchData || null,
      });
    }
    if (contextBaseChanged) {
      invalidateContextLayerVisualStateBatch(["physical"], "scenario-hydrate-context-base", { renderNow: false });
    }
    if (scenarioOverlayChanged) {
      invalidateOceanWaterInteractionVisualState("scenario-hydrate-water");
      refreshColorState({ renderNow: false });
    }
    syncScenarioUi();
    syncCountryUi({ renderNow });
    return true;
  }

  function evaluateScenarioOwnerFeatureCoverage({ phase = "deferred" } = {}) {
    const renderedFeatureIds = collectFeatureIdsFromCollection(state.landData);
    const ownerFeatureIds = new Set(
      Object.keys(state.sovereigntyByFeatureId && typeof state.sovereigntyByFeatureId === "object"
        ? state.sovereigntyByFeatureId
        : {})
        .map((featureId) => normalizeFeatureText(featureId))
        .filter(Boolean)
    );
    let overlapCount = 0;
    renderedFeatureIds.forEach((featureId) => {
      if (ownerFeatureIds.has(featureId)) overlapCount += 1;
    });
    const renderedFeatureCount = renderedFeatureIds.size;
    const ownerFeatureCount = ownerFeatureIds.size;
    const overlapRatio = renderedFeatureCount > 0 ? overlapCount / renderedFeatureCount : 1;
    const forcedMismatch =
      (phase === "startup" && consumeScenarioTestHook("forceStartupHealthGateOwnerMismatchOnce"))
      || (phase !== "startup" && consumeScenarioTestHook("forceHydrationHealthGateOwnerMismatchOnce"));
    const effectiveOverlapCount = forcedMismatch ? 0 : overlapCount;
    const effectiveOverlapRatio = forcedMismatch && renderedFeatureCount > 0 ? 0 : overlapRatio;
    return {
      renderedFeatureCount,
      ownerFeatureCount,
      overlapCount: effectiveOverlapCount,
      overlapRatio: effectiveOverlapRatio,
      healthy:
        phase === "startup"
          ? (renderedFeatureCount === 0 || effectiveOverlapRatio >= ownerFeatureCoverageMinRatio)
          : (
            renderedFeatureCount < ownerFeatureCoverageMinFeatures
            || effectiveOverlapRatio >= ownerFeatureCoverageMinRatio
          ),
      reason: forcedMismatch
        ? SCENARIO_HYDRATION_HEALTH_REASONS.ownerFeatureMismatch
        : SCENARIO_HYDRATION_HEALTH_REASONS.ok,
    };
  }

  function evaluateScenarioOverlayConsistency({ phase = "deferred" } = {}) {
    const runtimeTag = String(state.scenarioRuntimeTopologyVersionTag || "").trim();
    if (runtimeTag.includes(SCENARIO_HYDRATION_HEALTH_REASONS.missingRuntimeSourceSha)) {
      return {
        healthy: false,
        reason: SCENARIO_HYDRATION_HEALTH_REASONS.missingRuntimeSourceSha,
        runtimeTag,
        overlayTags: {
          water: String(state.scenarioWaterOverlayVersionTag || "").trim(),
          landMask: String(state.scenarioLandMaskVersionTag || "").trim(),
          contextLandMask: String(state.scenarioContextLandMaskVersionTag || "").trim(),
        },
      };
    }
    const forcedMaskMismatch =
      (phase === "startup" && consumeScenarioTestHook("forceStartupHealthGateMaskMismatchOnce"))
      || (phase !== "startup" && consumeScenarioTestHook("forceHydrationHealthGateMaskMismatchOnce"));
    if (forcedMaskMismatch) {
      return {
        healthy: false,
        reason: "context-land-mask-version-mismatch",
        runtimeTag,
        overlayTags: {
          water: String(state.scenarioWaterOverlayVersionTag || "").trim(),
          landMask: String(state.scenarioLandMaskVersionTag || "").trim(),
          contextLandMask: String(state.scenarioContextLandMaskVersionTag || "").trim(),
        },
      };
    }
    const overlayChecks = [
      {
        key: "water",
        present: !!state.scenarioWaterRegionsData,
        overlayTag: String(state.scenarioWaterOverlayVersionTag || "").trim(),
      },
      {
        key: "land-mask",
        present: !!state.scenarioLandMaskData,
        overlayTag: String(state.scenarioLandMaskVersionTag || "").trim(),
      },
      {
        key: "context-land-mask",
        present: !!state.scenarioContextLandMaskData,
        overlayTag: String(state.scenarioContextLandMaskVersionTag || "").trim(),
      },
    ];
    const failingOverlay = overlayChecks.find((entry) => {
      if (!entry.present) return false;
      if (!runtimeTag || !entry.overlayTag) return true;
      return runtimeTag !== entry.overlayTag;
    });
    if (failingOverlay) {
      return {
        healthy: false,
        reason: !runtimeTag || !failingOverlay.overlayTag
          ? `${failingOverlay.key}-missing-version-tag`
          : `${failingOverlay.key}-version-mismatch`,
        runtimeTag,
        overlayTags: {
          water: overlayChecks[0].overlayTag,
          landMask: overlayChecks[1].overlayTag,
          contextLandMask: overlayChecks[2].overlayTag,
        },
      };
    }
    return {
      healthy: true,
      reason: SCENARIO_HYDRATION_HEALTH_REASONS.ok,
      runtimeTag,
      overlayTags: {
        water: overlayChecks[0].overlayTag,
        landMask: overlayChecks[1].overlayTag,
        contextLandMask: overlayChecks[2].overlayTag,
      },
    };
  }

  function evaluateScenarioHydrationHealthGateState({ phase = "deferred" } = {}) {
    const report = evaluateScenarioOwnerFeatureCoverage({ phase });
    const overlayConsistency = evaluateScenarioOverlayConsistency({ phase });
    return {
      ok: report.healthy && overlayConsistency.healthy,
      report,
      overlayConsistency,
    };
  }

  async function enforceScenarioHydrationHealthGate({
    renderNow = true,
    reason = "post-ready",
    autoRetry = true,
    isCurrent = () => true,
  } = {}) {
    const requestId = state.currentScenarioApplyRequestId;
    const scenarioApplyEpoch = state.renderTransactionDiagnostics?.scenarioApplyEpoch ?? 0;
    const initialScenarioId = state.activeScenarioId;
    const assertCurrent = () => {
      if (!isCurrent() || state.activeScenarioId !== initialScenarioId
        || state.currentScenarioApplyRequestId !== requestId
        || (state.renderTransactionDiagnostics?.scenarioApplyEpoch ?? 0) !== scenarioApplyEpoch) {
        throw Object.assign(new Error("Scenario hydration superseded."), { name: "AbortError" });
      }
    };
    assertCurrent();
    // health gate 的目标不是“尽量兜住”，而是尽快判断当前 runtime 壳层是否还能支撑后续编辑。
    // 能通过就放行；一次强制重载能修复就立即收口；仍然失败就显式进入 fatal recovery。
    const scenarioId = normalizeScenarioId(state.activeScenarioId);
    if (!scenarioId) {
      return { ok: true, attemptedRetry: false, degradedWaterOverlay: false, report: null };
    }
    let { report, overlayConsistency: waterConsistency } = evaluateScenarioHydrationHealthGateState({
      phase: "deferred",
    });
    if (report.healthy) {
      const ok = waterConsistency.healthy;
      if (ok) {
        setScenarioHydrationHealthGateState(state, normalizeScenarioHydrationHealthGateState({
          status: "ok",
          reason: SCENARIO_HYDRATION_HEALTH_REASONS.ok,
          checkedAt: Date.now(),
          attemptedRetry: false,
          ownerFeatureOverlapRatio: report.overlapRatio,
          ownerFeatureOverlapCount: report.overlapCount,
          ownerFeatureRenderedCount: report.renderedFeatureCount,
          degradedWaterOverlay: false,
        }));
      }
      if (ok) {
        return { ok: true, attemptedRetry: false, degradedWaterOverlay: false, report, waterConsistency };
      }
    }
    let attemptedRetry = false;
    if (autoRetry) {
      attemptedRetry = true;
      try {
        const loadScenarioBundle = getLoadScenarioBundle();
        const refreshedBundle = await loadScenarioBundle(scenarioId, {
          d3Client: globalThis.d3,
          bundleLevel: "full",
          forceReload: true,
        });
        assertCurrent();
        hydrateActiveScenarioBundle(refreshedBundle, { renderNow: false });
        ({ report, overlayConsistency: waterConsistency } = evaluateScenarioHydrationHealthGateState({
          phase: "deferred",
        }));
      } catch (retryError) {
        assertCurrent();
        console.warn(`[scenario] Hydration health gate retry failed for "${scenarioId}".`, retryError);
      }
    }
    if (report.healthy && waterConsistency.healthy) {
      if (attemptedRetry && renderNow) {
        flushRenderBoundary("scenario-health-gate-retry-recovered");
      }
      clearScenarioHealthGateReadonlyState();
      setScenarioHydrationHealthGateState(state, normalizeScenarioHydrationHealthGateState({
        status: "ok",
        reason: attemptedRetry ? "retry-recovered" : "ok",
        checkedAt: Date.now(),
        attemptedRetry,
        ownerFeatureOverlapRatio: report.overlapRatio,
        ownerFeatureOverlapCount: report.overlapCount,
        ownerFeatureRenderedCount: report.renderedFeatureCount,
        degradedWaterOverlay: false,
      }));
      syncScenarioUi();
      syncCountryUi({ renderNow: false });
      return { ok: true, attemptedRetry, degradedWaterOverlay: false, report, waterConsistency };
    }
    if (!report.healthy) {
      const problemParts = [
        `Hydration owner overlap dropped to ${report.overlapCount}/${report.renderedFeatureCount} (${report.overlapRatio.toFixed(3)}).`,
      ];
      if (waterConsistency?.reason && waterConsistency.reason !== "ok") {
        problemParts.push(`Overlay consistency also failed: ${waterConsistency.reason}.`);
      }
      setScenarioHydrationHealthGateState(state, normalizeScenarioHydrationHealthGateState({
        status: "degraded",
        reason: SCENARIO_HYDRATION_HEALTH_REASONS.ownerFeatureMismatch,
        checkedAt: Date.now(),
        attemptedRetry,
        ownerFeatureOverlapRatio: report.overlapRatio,
        ownerFeatureOverlapCount: report.overlapCount,
        ownerFeatureRenderedCount: report.renderedFeatureCount,
        degradedWaterOverlay: false,
      }));
      clearScenarioHealthGateReadonlyState();
      enterScenarioFatalRecovery({
        phase: "hydration-health-gate",
        consistencyReport: {
          phase: "hydration-health-gate",
          problems: problemParts,
        },
        syncUi: () => {
          syncScenarioUi();
          syncCountryUi({ renderNow: false });
        },
      });
      if (renderNow) {
        flushRenderBoundary("scenario-health-gate-owner-mismatch");
      }
      return {
        ok: false,
        attemptedRetry,
        degradedWaterOverlay: false,
        report,
        waterConsistency,
      };
    }
    const hadScenarioOverlay = resetScenarioHydrationOverlayState(state);
    invalidateContextLayerVisualStateBatch([], "scenario-health-gate-mask-fallback", { renderNow: false });
    invalidateOceanWaterInteractionVisualState("scenario-health-gate-water-fallback");
    refreshColorState({ renderNow: false });
    clearScenarioHealthGateReadonlyState();
    showToast(
      t("Scenario runtime overlays were degraded. Editing remains available.", "ui"),
      {
        title: t("Scenario overlays degraded", "ui"),
        tone: "warning",
        duration: 6200,
      }
    );
    console.warn(
      `[scenario] Hydration health gate triggered fallback for "${scenarioId}". reason=${reason}, overlap=${report.overlapCount}/${report.renderedFeatureCount}, ratio=${report.overlapRatio.toFixed(3)}, waterConsistency=${waterConsistency.reason}.`
    );
    setScenarioHydrationHealthGateState(state, normalizeScenarioHydrationHealthGateState({
      status: "degraded",
      reason: !report.healthy
        ? SCENARIO_HYDRATION_HEALTH_REASONS.ownerFeatureMismatch
        : `runtime-overlay-${waterConsistency.reason}`,
      checkedAt: Date.now(),
      attemptedRetry,
      ownerFeatureOverlapRatio: report.overlapRatio,
      ownerFeatureOverlapCount: report.overlapCount,
      ownerFeatureRenderedCount: report.renderedFeatureCount,
      degradedWaterOverlay: hadScenarioOverlay,
    }));
    syncScenarioUi();
    syncCountryUi({ renderNow: false });
    if (renderNow) {
      flushRenderBoundary("scenario-health-gate-fallback");
    }
    return {
      ok: false,
      attemptedRetry,
      degradedWaterOverlay: hadScenarioOverlay,
      report,
      waterConsistency,
    };
  }

  return {
    getScenarioTopologyFeatureCollection,
    ensureScenarioGeoLocalePatchForLanguage,
    applyBlankScenarioPresentationDefaults,
    hydrateActiveScenarioBundle,
    buildScenarioRuntimeVersionTag,
    hasRenderableScenarioPoliticalTopology,
    getScenarioRuntimeSourceShaStatus,
    evaluateScenarioHydrationHealthGateState,
    enforceScenarioHydrationHealthGate,
  };
}

export {
  createScenarioStartupHydrationController,
};
