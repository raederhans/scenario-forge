// Static border cache read models and deferred mesh work. Cache writes remain host-owned.
function serializeCountrySetSignature(countrySet) {
  return Array.from(countrySet || []).sort((left, right) => left.localeCompare(right)).join(",");
}

export function getSourceCountriesSignature(sourceCountries = {}) {
  return [
    `primary:${serializeCountrySetSignature(sourceCountries.primary)}`,
    `detail:${serializeCountrySetSignature(sourceCountries.detail)}`,
  ].join("|");
}

export function getCoastlineDecisionSignature(decision = null) {
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

export function createStaticBorderMeshLifecycle(runtimeState, {
  getStaticMeshSourceCountries,
  getDetailAdmMeshBuildState,
  setDetailAdmMeshBuildState,
  getContextBaseZoomBucketId,
  getProjectedViewportBounds,
  VIEWPORT_CULL_OVERSCAN_PX,
  canonicalCountryCode,
  cancelDeferredWork,
  scheduleDeferredWork,
  isInteractionRecoverySettled,
  beginInteractionRecoveryTask,
  endInteractionRecoveryTask,
  nowMs,
  PROVINCE_BORDERS_TRANSITION_END_ZOOM,
  LOCAL_BORDERS_MIN_ZOOM,
  DETAIL_ADM_BORDERS_MIN_ZOOM,
  ensureCountrySourceBorderMeshes,
  buildDetailAdmBorderMesh,
  isUsableMesh,
  replaceDetailAdmBorders,
  syncStaticMeshSnapshot,
  invalidateRenderPasses,
  render,
  recordInteractionRecoveryTaskMetric,
}) {
  let deferredHeavyBorderMeshHandle = null;
  let visibleBorderCountryCodesCache = { signature: "", codes: new Set() };

  function buildDetailAdmMeshSignature(visibleCountryCodes = new Set(), k = runtimeState.zoomTransform?.k || 1) {
    const detailCountries = Array.from(getStaticMeshSourceCountries().detail || new Set())
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
    for (const item of runtimeState.spatialItems || []) {
      const countryCode = canonicalCountryCode(item?.borderMeshCountryCode || item?.countryCode || "");
      if (!countryCode || visible.has(countryCode)) continue;
      if (item.maxX < minX || item.maxY < minY || item.minX > maxX || item.minY > maxY) {
        continue;
      }
      visible.add(countryCode);
    }
    visibleBorderCountryCodesCache = {
      signature,
      codes: new Set(visible),
    };
    return visible;
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
            getDetailAdmMeshBuildState().signature !== detailAdmMeta.signature
            || getDetailAdmMeshBuildState().status === "idle"
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
          const previousDetailAdmStatus = String(getDetailAdmMeshBuildState().status || "idle");
          const detailAdmMesh = buildDetailAdmBorderMesh(runtimeState.topologyDetail, new Set(detailAdmMeta.detailCountries));
          if (isUsableMesh(detailAdmMesh)) {
            replaceDetailAdmBorders([detailAdmMesh]);
            setDetailAdmMeshBuildState({
              signature: detailAdmMeta.signature,
              status: "ready",
            });
            changed = true;
            snapshotChanged = true;
          } else {
            setDetailAdmMeshBuildState({
              signature: detailAdmMeta.signature,
              status: "empty",
            });
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
      detailAdmMeshBuildState: { ...(getDetailAdmMeshBuildState() || { signature: "", status: "idle" }) },
    };
  }

  function resetVisibleCountryCodesCache() {
    visibleBorderCountryCodesCache = { signature: "", codes: new Set() };
  }

  return Object.freeze({
    buildDetailAdmMeshSignature,
    getVisibleCountryCodesForBorderMeshes,
    cancelDeferredHeavyBorderMeshes,
    scheduleDeferredHeavyBorderMeshes,
    captureStaticMeshSnapshot,
    resetVisibleCountryCodesCache,
  });
}
