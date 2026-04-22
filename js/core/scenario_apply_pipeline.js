// Scenario apply pipeline.
// 这个模块只负责“准备 staged apply runtimeState”和“把 staged runtimeState 落到 runtime runtimeState”。
// scenario_manager.js 继续保留事务协调、回滚、post-apply、入口控制。

function createScenarioApplyPipeline({
  runtimeState,
  countryNames,
  normalizeScenarioId,
  scenarioSupportsChunkedRuntime,
  scenarioBundleUsesChunkedLayer,
  scenarioBundleHasChunkedData,
  ensureScenarioDetailTopologyLoaded,
  hasUsablePoliticalTopology,
  scenarioNeedsDetailTopology,
  getScenarioDisplayName,
  getScenarioTargetPaletteId,
  hasActiveScenarioPaletteLoaded,
  applyActivePaletteState,
  setActivePaletteSource,
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
  markLegacyColorStateDirty,
  syncScenarioInspectorSelection,
  disableScenarioParentBorders,
  applyScenarioPaintMode,
  syncScenarioOceanFillForActivation,
  applyScenarioPerformanceHints,
  scheduleScenarioChunkRefresh,
  resetScenarioChunkRuntimeState,
  ensureRuntimeChunkLoadState,
  recalculateScenarioOwnerControllerDiffCount,
  hasRenderableScenarioPoliticalTopology,
  normalizeScenarioFeatureCollection,
  cloneScenarioStateValue,
} = {}) {
  function prepareScenarioActivationContext(bundle) {
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

  function commitScenarioActivationState(bundle, staged) {
    runtimeState.scenarioParentBorderEnabledBeforeActivate =
      cloneScenarioStateValue(staged.scenarioParentBorderEnabledBeforeActivate);
    runtimeState.scenarioDisplaySettingsBeforeActivate =
      cloneScenarioStateValue(staged.scenarioDisplaySettingsBeforeActivate);
    runtimeState.scenarioOceanFillBeforeActivate = staged.scenarioOceanFillBeforeActivate;
    runtimeState.activeScenarioId = staged.scenarioId;
    runtimeState.scenarioBorderMode = "scenario_owner_only";
    runtimeState.activeScenarioManifest = staged.scenarioManifest;
    runtimeState.mapSemanticMode = staged.mapSemanticMode;
    runtimeState.scenarioCountriesByTag = staged.countryMap;
    runtimeState.activeScenarioMeshPack = bundle.meshPackPayload || null;
    runtimeState.scenarioRuntimeTopologyData = staged.runtimeTopologyPayload;
    runtimeState.runtimePoliticalTopology = hasRenderableScenarioPoliticalTopology(staged.runtimeTopologyPayload)
      ? staged.runtimeTopologyPayload
      : (runtimeState.defaultRuntimePoliticalTopology || runtimeState.runtimePoliticalTopology || null);
    runtimeState.scenarioPoliticalChunkData = scenarioSupportsChunkedRuntime(bundle)
      ? null
      : (
        normalizeScenarioFeatureCollection(
          getActiveScenarioMergedChunkLayerPayload("political", staged.scenarioId)
        ) || null
      );
    runtimeState.runtimePoliticalMetaSeed = bundle.runtimePoliticalMeta || null;
    runtimeState.runtimePoliticalFeatureCollectionSeed = getScenarioDecodedCollection(bundle, "politicalData") || null;
    runtimeState.scenarioLandMaskData = staged.scenarioLandMaskFromTopology || null;
    runtimeState.scenarioContextLandMaskData = staged.scenarioContextLandMaskFromTopology || null;
    runtimeState.scenarioWaterRegionsData = staged.scenarioWaterRegionsFromTopology || bundle.waterRegionsPayload || null;
    runtimeState.scenarioRuntimeTopologyVersionTag = String(staged.runtimeVersionTag || "");
    runtimeState.scenarioLandMaskVersionTag = runtimeState.scenarioLandMaskData ? String(staged.runtimeVersionTag || "") : "";
    runtimeState.scenarioContextLandMaskVersionTag = runtimeState.scenarioContextLandMaskData ? String(staged.runtimeVersionTag || "") : "";
    runtimeState.scenarioWaterOverlayVersionTag = runtimeState.scenarioWaterRegionsData ? String(staged.runtimeVersionTag || "") : "";
    runtimeState.scenarioSpecialRegionsData = staged.scenarioSpecialRegionsFromTopology || bundle.specialRegionsPayload || null;
    runtimeState.scenarioReliefOverlaysData = staged.scenarioReliefOverlaysPayload || null;
    runtimeState.scenarioReliefOverlayRevision = (Number(runtimeState.scenarioReliefOverlayRevision) || 0) + 1;
    runtimeState.scenarioDistrictGroupsData = staged.districtGroupsPayload;
    runtimeState.scenarioDistrictGroupByFeatureId = buildScenarioDistrictGroupByFeatureId(staged.districtGroupsPayload);
    syncScenarioLocalizationState({
      cityOverridesPayload: staged.mapSemanticMode === "blank" ? null : (staged.scenarioCityOverridesPayload || null),
      geoLocalePatchPayload: staged.mapSemanticMode === "blank" ? null : (bundle.geoLocalePatchPayload || null),
    });
    if (staged.mapSemanticMode === "blank") {
      applyBlankScenarioPresentationDefaults({ resetLocalization: false });
    }
    runtimeState.releasableCatalog = mergeReleasableCatalogs(runtimeState.defaultReleasableCatalog, bundle.releasableCatalog);
    runtimeState.scenarioReleasableIndex = staged.releasableIndex;
    runtimeState.scenarioAudit = bundle.auditPayload || null;
    setScenarioAuditUiState({
      loading: false,
      loadedForScenarioId: bundle.auditPayload ? staged.scenarioId : "",
      errorMessage: "",
    });
    runtimeState.scenarioImportAudit = null;
    runtimeState.scenarioBaselineHash = getScenarioBaselineHashFromBundle(bundle);
    runtimeState.scenarioBaselineOwnersByFeatureId = { ...staged.resolvedOwners };
    runtimeState.scenarioControllersByFeatureId = { ...staged.controllers };
    runtimeState.scenarioAutoShellOwnerByFeatureId = {};
    runtimeState.scenarioAutoShellControllerByFeatureId = {};
    runtimeState.scenarioBaselineControllersByFeatureId = { ...staged.controllers };
    runtimeState.scenarioBaselineCoresByFeatureId = { ...staged.cores };
    runtimeState.scenarioShellOverlayRevision = (Number(runtimeState.scenarioShellOverlayRevision) || 0) + 1;
    runtimeState.scenarioControllerRevision = (Number(runtimeState.scenarioControllerRevision) || 0) + 1;
    runtimeState.scenarioViewMode = "ownership";
    runtimeState.countryNames = staged.mapSemanticMode === "blank"
      ? { ...countryNames }
      : { ...staged.scenarioNameMap };
    runtimeState.sovereigntyByFeatureId = { ...staged.resolvedOwners };
    runtimeState.sovereigntyInitialized = false;
    runtimeState.visualOverrides = {};
    runtimeState.featureOverrides = {};
    const fixedOwnerColors = { ...staged.scenarioColorMap };
    if (staged.coarseColorMap && typeof staged.coarseColorMap === "object") {
      Object.entries(staged.coarseColorMap).forEach(([iso2, color]) => {
        if (iso2 && color && !fixedOwnerColors[iso2]) {
          fixedOwnerColors[iso2] = color;
        }
      });
    }
    runtimeState.scenarioFixedOwnerColors = { ...fixedOwnerColors };
    runtimeState.sovereignBaseColors = { ...fixedOwnerColors };
    runtimeState.countryBaseColors = { ...fixedOwnerColors };
    markLegacyColorStateDirty();
    runtimeState.activeSovereignCode = staged.mapSemanticMode === "blank" ? "" : staged.defaultCountryCode;
    runtimeState.selectedWaterRegionId = "";
    runtimeState.selectedSpecialRegionId = "";
    runtimeState.hoveredWaterRegionId = null;
    runtimeState.hoveredSpecialRegionId = null;
  }

  function commitScenarioChunkRuntimeState(bundle, staged) {
    runtimeState.scheduleScenarioChunkRefreshFn = scenarioSupportsChunkedRuntime(bundle) ? scheduleScenarioChunkRefresh : null;
    if (scenarioSupportsChunkedRuntime(bundle)) {
      resetScenarioChunkRuntimeState({ scenarioId: staged.scenarioId });
      const chunkIds = Object.keys(bundle.chunkPayloadCacheById || {});
      if (chunkIds.length) {
        runtimeState.activeScenarioChunks.loadedChunkIds = [...chunkIds];
        runtimeState.activeScenarioChunks.payloadByChunkId = { ...(bundle.chunkPayloadCacheById || {}) };
        runtimeState.activeScenarioChunks.lruChunkIds = [...chunkIds];
      }
      ensureRuntimeChunkLoadState().shellStatus = chunkIds.length ? "ready" : "idle";
      ensureRuntimeChunkLoadState().registryStatus = scenarioBundleHasChunkedData(bundle) ? "ready" : "idle";
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
    } = {}
  ) {
    const startupReadonly = interactionLevel === "readonly-startup";
    const supportsChunkedPoliticalRuntime = scenarioSupportsChunkedRuntime(bundle)
      && (!!bundle?.manifest?.detail_chunk_manifest_url || !!bundle?.manifest?.runtime_meta_url);
    const detailPromoted = (startupReadonly || supportsChunkedPoliticalRuntime)
      ? false
      : await ensureScenarioDetailTopologyLoaded({ applyMapData: false });
    const politicalChunkedReady =
      supportsChunkedPoliticalRuntime
      || (scenarioBundleUsesChunkedLayer(bundle, "political")
        && scenarioBundleHasChunkedData(bundle));
    const detailReady = (
      runtimeState.topologyBundleMode === "composite"
      && hasUsablePoliticalTopology(runtimeState.topologyDetail)
    ) || !!detailPromoted || politicalChunkedReady;
    if (!detailReady && scenarioNeedsDetailTopology(bundle.manifest) && !startupReadonly) {
      const scenarioLabel = getScenarioDisplayName(
        bundle.manifest,
        String(bundle.manifest?.scenario_id || "Scenario").trim()
      );
      const message = `Detailed political topology could not be loaded. ${scenarioLabel} cannot be applied in coarse mode.`;
      console.error(`[scenario] ${message}`);
      throw new Error(message);
    }
    if (!detailReady && runtimeState.topologyBundleMode !== "composite") {
      console.warn("[scenario] Applying bundle without confirmed detail promotion; health gate will validate runtime topology.");
    }
    if (syncPalette) {
      const targetPaletteId = getScenarioTargetPaletteId(bundle.manifest);
      if (hasActiveScenarioPaletteLoaded(targetPaletteId)) {
        applyActivePaletteState({ overwriteCountryPalette: false });
      } else {
        const paletteApplied = await setActivePaletteSource(
          targetPaletteId,
          {
            syncUI: true,
            overwriteCountryPalette: false,
          }
        );
        if (!paletteApplied || !hasActiveScenarioPaletteLoaded(targetPaletteId)) {
          throw new Error(
            `Unable to load palette for scenario "${normalizeScenarioId(bundle.manifest?.scenario_id || bundle.meta?.scenario_id)}".`
          );
        }
      }
    }

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
    const controllers = bundle.controllersPayload?.controllers && typeof bundle.controllersPayload.controllers === "object"
      ? bundle.controllersPayload.controllers
      : owners;
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
    const runtimeVersionTag = runtimeTopologyPayload
      ? buildScenarioRuntimeVersionTag(bundle, runtimeTopologyPayload)
      : "";
    const districtGroupsPayload = normalizeScenarioDistrictGroupsPayload(bundle.districtGroupsPayload, scenarioId);
    const mergedWaterPayload = getActiveScenarioMergedChunkLayerPayload("water", scenarioId);
    const mergedSpecialPayload = getActiveScenarioMergedChunkLayerPayload("special", scenarioId);
    const mergedReliefPayload = getActiveScenarioMergedChunkLayerPayload("relief", scenarioId);
    const mergedCitiesPayload = getActiveScenarioMergedChunkLayerPayload("cities", scenarioId);
    const scenarioWaterRegionsFromTopology =
      mergedWaterPayload !== undefined
        ? mergedWaterPayload
        : (
          bundle.waterRegionsPayload
          || getScenarioDecodedCollection(bundle, "scenarioWaterRegionsData")
          || getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "scenario_water")
        );
    const scenarioSpecialRegionsFromTopology =
      mergedSpecialPayload !== undefined
        ? mergedSpecialPayload
        : (
          getScenarioDecodedCollection(bundle, "scenarioSpecialRegionsData")
          || getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "scenario_special_land")
        );
    const scenarioContextLandMaskFromTopology =
      getScenarioDecodedCollection(bundle, "scenarioContextLandMaskData")
      || getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "context_land_mask");
    const scenarioLandMaskFromTopology =
      getScenarioDecodedCollection(bundle, "scenarioLandMaskData")
      || getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "land_mask")
      || getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "land");
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
    const scenarioColorMap = {
      ...seedScenarioColorMap,
      ...getScenarioFixedOwnerColors(countryMap),
    };
    const coarseColorMap = buildScenarioCoarseColorMap({
      startupApplySeed,
      countryMap,
      scenarioColorMap,
    });
    const scenarioOwnerBackfill = startupApplySeed?.resolved_owners && typeof startupApplySeed.resolved_owners === "object"
      ? {}
      : buildHoi4FarEastSovietOwnerBackfill(scenarioId, {
        runtimeTopology: runtimeTopologyPayload?.objects?.political
          ? runtimeTopologyPayload
          : (runtimeState.defaultRuntimePoliticalTopology || runtimeState.runtimePoliticalTopology || null),
        ownersByFeatureId: owners,
        controllersByFeatureId: controllers,
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
    const activationContext = prepareScenarioActivationContext(bundle);
    return {
      scenarioId,
      baseCountryMap,
      defaultCountryCode,
      mapSemanticMode,
      countryMap,
      runtimeTopologyPayload,
      runtimeVersionTag,
      districtGroupsPayload,
      scenarioWaterRegionsFromTopology,
      scenarioSpecialRegionsFromTopology,
      scenarioContextLandMaskFromTopology,
      scenarioLandMaskFromTopology,
      scenarioReliefOverlaysPayload: mergedReliefPayload !== undefined
        ? mergedReliefPayload
        : (bundle.reliefOverlaysPayload || null),
      scenarioCityOverridesPayload: mergedCitiesPayload !== undefined
        ? mergedCitiesPayload
        : (bundle.cityOverridesPayload || null),
      scenarioNameMap,
      scenarioColorMap,
      coarseColorMap,
      scenarioOwnerBackfill,
      resolvedOwners,
      controllers,
      cores,
      releasableIndex,
      ...activationContext,
    };
  }

  function applyPreparedScenarioState(bundle, staged) {
    commitScenarioActivationState(bundle, staged);
    syncScenarioInspectorSelection(runtimeState.activeSovereignCode);

    disableScenarioParentBorders();
    applyScenarioPaintMode();
    syncScenarioOceanFillForActivation(bundle.manifest);
    applyScenarioPerformanceHints(bundle.manifest);
    commitScenarioChunkRuntimeState(bundle, staged);
    recalculateScenarioOwnerControllerDiffCount();
  }

  return {
    prepareScenarioApplyState,
    applyPreparedScenarioState,
  };
}

export {
  createScenarioApplyPipeline,
};
