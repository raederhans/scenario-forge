// Startup hydration controller.
// 这个模块负责 startup shell decode、active scenario hydrate、health gate 与 locale patch 同步。
// scenario_resources.js 继续保留 facade、bundle cache、startup cache 与对外 export 面。

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
  refreshMapDataForScenarioChunkPromotion,
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
    return !!getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "political");
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
      if (typeof state.updateDevWorkspaceUIFn === "function") {
        state.updateDevWorkspaceUIFn();
      }
      return null;
    }

    bundle.geoLocalePatchPayloadsByLanguage =
      bundle.geoLocalePatchPayloadsByLanguage && typeof bundle.geoLocalePatchPayloadsByLanguage === "object"
        ? bundle.geoLocalePatchPayloadsByLanguage
        : {};

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

    if (normalizeScenarioId(state.activeScenarioId) !== scenarioId) {
      return payload || null;
    }
    bundle.geoLocalePatchPayload = payload || null;
    syncScenarioLocalizationState({ geoLocalePatchPayload: payload || null });
    syncCountryUi({ renderNow });
    if (typeof state.updateDevWorkspaceUIFn === "function") {
      state.updateDevWorkspaceUIFn();
    }
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
    if (typeof state.updateToolbarInputsFn === "function") {
      state.updateToolbarInputsFn();
    }
  }

  function buildScenarioRuntimeVersionTag(bundle, runtimeTopologyPayload) {
    const scenarioId = normalizeScenarioId(
      bundle?.manifest?.scenario_id
      || bundle?.meta?.scenario_id
      || state.activeScenarioId
    ) || "scenario";
    const baselineHash = String(bundle?.manifest?.baseline_hash || bundle?.ownersPayload?.baseline_hash || "").trim();
    const runtimeFeatureCount = getScenarioRuntimePoliticalFeatureCount(runtimeTopologyPayload, bundle?.runtimePoliticalMeta || null);
    return `${scenarioId}:${baselineHash || "no-baseline"}:${runtimeFeatureCount}`;
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
    const runtimeMergedLayerPayloads = getScenarioRuntimeMergedLayerPayloads(bundle);
    const mergedWaterPayload = hasScenarioMergedLayerPayload(runtimeMergedLayerPayloads, "water")
      ? runtimeMergedLayerPayloads.water || null
      : undefined;
    const mergedSpecialPayload = hasScenarioMergedLayerPayload(runtimeMergedLayerPayloads, "special")
      ? runtimeMergedLayerPayloads.special || null
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
    if (runtimeTopologyPayload) {
      const runtimeVersionTag = buildScenarioRuntimeVersionTag(bundle, runtimeTopologyPayload);
      const nextRuntimePoliticalTopology = hasRenderableScenarioPoliticalTopology(runtimeTopologyPayload)
        ? runtimeTopologyPayload
        : (state.defaultRuntimePoliticalTopology || state.runtimePoliticalTopology || null);
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
      scenarioOverlayChanged =
        state.scenarioRuntimeTopologyData !== runtimeTopologyPayload
        || state.scenarioWaterRegionsData !== nextScenarioWaterRegionsData
        || state.scenarioSpecialRegionsData !== nextScenarioSpecialRegionsData;
      contextBaseChanged =
        state.scenarioRuntimeTopologyData !== runtimeTopologyPayload
        || state.runtimePoliticalTopology !== nextRuntimePoliticalTopology
        || state.scenarioLandMaskData !== nextScenarioLandMaskData
        || state.scenarioContextLandMaskData !== nextScenarioContextLandMaskData;
      state.scenarioRuntimeTopologyData = runtimeTopologyPayload;
      state.runtimePoliticalTopology = nextRuntimePoliticalTopology;
      state.runtimePoliticalMetaSeed = bundle.runtimePoliticalMeta || null;
      state.runtimePoliticalFeatureCollectionSeed = getScenarioDecodedCollection(bundle, "politicalData") || null;
      state.scenarioLandMaskData = nextScenarioLandMaskData;
      state.scenarioContextLandMaskData = nextScenarioContextLandMaskData;
      state.scenarioWaterRegionsData = nextScenarioWaterRegionsData;
      state.scenarioRuntimeTopologyVersionTag = runtimeVersionTag;
      state.scenarioWaterOverlayVersionTag = nextScenarioWaterOverlayVersionTag;
      state.scenarioLandMaskVersionTag = nextScenarioLandMaskVersionTag;
      state.scenarioContextLandMaskVersionTag = nextScenarioContextLandMaskVersionTag;
      state.scenarioSpecialRegionsData = nextScenarioSpecialRegionsData;
    }
    state.activeScenarioMeshPack = bundle.meshPackPayload || state.activeScenarioMeshPack || null;
    const nextScenarioPoliticalPayload = normalizeScenarioFeatureCollection(
      mergedPoliticalPayload !== undefined
        ? mergedPoliticalPayload
        : (
          getScenarioDecodedCollection(bundle, "politicalData")
          || getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "political")
          || state.scenarioPoliticalChunkData
        )
    ) || null;
    const previousScenarioPoliticalPayload = state.scenarioPoliticalChunkData;
    const promotedScenarioPolitical = applyScenarioPoliticalChunkPayload(
      bundle,
      nextScenarioPoliticalPayload,
      {
        renderNow: false,
        reason: "scenario-hydrate-political",
      }
    );
    if (!promotedScenarioPolitical) {
      state.scenarioPoliticalChunkData = nextScenarioPoliticalPayload;
      if (
        nextScenarioPoliticalPayload
        && !areScenarioFeatureCollectionsEquivalent(nextScenarioPoliticalPayload, previousScenarioPoliticalPayload)
      ) {
        refreshMapDataForScenarioChunkPromotion({ suppressRender: !renderNow });
      }
    }
    if (bundle.districtGroupsPayload) {
      state.scenarioDistrictGroupsData = bundle.districtGroupsPayload;
      state.scenarioDistrictGroupByFeatureId = buildScenarioDistrictGroupByFeatureId(bundle.districtGroupsPayload);
    }
    if (bundle.releasableCatalog) {
      state.releasableCatalog = mergeReleasableCatalogs(state.defaultReleasableCatalog, bundle.releasableCatalog);
      state.scenarioReleasableIndex = buildScenarioReleasableIndex(bundleScenarioId, { excludeTags: [] });
    }
    if (bundle.auditPayload) {
      state.scenarioAudit = bundle.auditPayload;
      setScenarioAuditUiState({
        loading: false,
        loadedForScenarioId: bundleScenarioId,
        errorMessage: "",
      });
    }
    state.scenarioReliefOverlaysData = mergedReliefPayload !== undefined
      ? mergedReliefPayload
      : (bundle.reliefOverlaysPayload || state.scenarioReliefOverlaysData || null);
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
      reason: forcedMismatch ? "owner-feature-mismatch" : "ok",
    };
  }

  function evaluateScenarioOverlayConsistency({ phase = "deferred" } = {}) {
    const runtimeTag = String(state.scenarioRuntimeTopologyVersionTag || "").trim();
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
      reason: "ok",
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
  } = {}) {
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
        state.scenarioHydrationHealthGate = {
          status: "ok",
          reason: "ok",
          checkedAt: Date.now(),
          attemptedRetry: false,
          ownerFeatureOverlapRatio: report.overlapRatio,
          ownerFeatureOverlapCount: report.overlapCount,
          ownerFeatureRenderedCount: report.renderedFeatureCount,
          degradedWaterOverlay: false,
        };
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
        hydrateActiveScenarioBundle(refreshedBundle, { renderNow: false });
        ({ report, overlayConsistency: waterConsistency } = evaluateScenarioHydrationHealthGateState({
          phase: "deferred",
        }));
      } catch (retryError) {
        console.warn(`[scenario] Hydration health gate retry failed for "${scenarioId}".`, retryError);
      }
    }
    if (report.healthy && waterConsistency.healthy) {
      if (attemptedRetry && renderNow) {
        flushRenderBoundary("scenario-health-gate-retry-recovered");
      }
      if (
        typeof state.setStartupReadonlyStateFn === "function"
        && state.startupReadonly
        && String(state.startupReadonlyReason || "").trim() === "scenario-health-gate"
      ) {
        state.setStartupReadonlyStateFn(false);
      } else if (String(state.startupReadonlyReason || "").trim() === "scenario-health-gate") {
        state.startupReadonly = false;
        state.startupReadonlyReason = "";
        state.startupReadonlyUnlockInFlight = false;
      }
      state.scenarioHydrationHealthGate = {
        status: "ok",
        reason: attemptedRetry ? "retry-recovered" : "ok",
        checkedAt: Date.now(),
        attemptedRetry,
        ownerFeatureOverlapRatio: report.overlapRatio,
        ownerFeatureOverlapCount: report.overlapCount,
        ownerFeatureRenderedCount: report.renderedFeatureCount,
        degradedWaterOverlay: false,
      };
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
      state.scenarioHydrationHealthGate = {
        status: "degraded",
        reason: "owner-feature-mismatch",
        checkedAt: Date.now(),
        attemptedRetry,
        ownerFeatureOverlapRatio: report.overlapRatio,
        ownerFeatureOverlapCount: report.overlapCount,
        ownerFeatureRenderedCount: report.renderedFeatureCount,
        degradedWaterOverlay: false,
      };
      if (
        typeof state.setStartupReadonlyStateFn === "function"
        && state.startupReadonly
        && String(state.startupReadonlyReason || "").trim() === "scenario-health-gate"
      ) {
        state.setStartupReadonlyStateFn(false);
      } else if (String(state.startupReadonlyReason || "").trim() === "scenario-health-gate") {
        state.startupReadonly = false;
        state.startupReadonlyReason = "";
        state.startupReadonlyUnlockInFlight = false;
      }
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
    const hadScenarioOverlay =
      !!state.scenarioWaterRegionsData
      || !!state.scenarioLandMaskData
      || !!state.scenarioContextLandMaskData;
    state.scenarioWaterRegionsData = null;
    state.scenarioWaterOverlayVersionTag = "";
    state.scenarioLandMaskData = null;
    state.scenarioContextLandMaskData = null;
    state.scenarioLandMaskVersionTag = "";
    state.scenarioContextLandMaskVersionTag = "";
    invalidateContextLayerVisualStateBatch([], "scenario-health-gate-mask-fallback", { renderNow: false });
    invalidateOceanWaterInteractionVisualState("scenario-health-gate-water-fallback");
    refreshColorState({ renderNow: false });
    if (
      typeof state.setStartupReadonlyStateFn === "function"
      && state.startupReadonly
      && String(state.startupReadonlyReason || "").trim() === "scenario-health-gate"
    ) {
      state.setStartupReadonlyStateFn(false);
    } else if (String(state.startupReadonlyReason || "").trim() === "scenario-health-gate") {
      state.startupReadonly = false;
      state.startupReadonlyReason = "";
      state.startupReadonlyUnlockInFlight = false;
    }
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
    state.scenarioHydrationHealthGate = {
      status: "degraded",
      reason: !report.healthy ? "owner-feature-mismatch" : `runtime-overlay-${waterConsistency.reason}`,
      checkedAt: Date.now(),
      attemptedRetry,
      ownerFeatureOverlapRatio: report.overlapRatio,
      ownerFeatureOverlapCount: report.overlapCount,
      ownerFeatureRenderedCount: report.renderedFeatureCount,
      degradedWaterOverlay: hadScenarioOverlay,
    };
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
    evaluateScenarioHydrationHealthGateState,
    enforceScenarioHydrationHealthGate,
  };
}

export {
  createScenarioStartupHydrationController,
};
