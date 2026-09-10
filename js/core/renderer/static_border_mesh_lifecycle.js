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
  buildDeferredBorderMeshesAsync,
  commitDeferredBorderMeshes,
}) {
  let deferredHeavyBorderMeshHandle = null;
  let workerAbort = null;
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

  let deferredHeavyBorderRunId = 0;

  function readWorkIdentity() {
    const bounds = getProjectedViewportBounds({ overscanPx: VIEWPORT_CULL_OVERSCAN_PX * 0.5 });
    return [
      runtimeState.activeScenarioId, runtimeState.scenarioApplyEpoch,
      runtimeState.sceneGeneration, runtimeState.scenarioDataGeneration,
      runtimeState.scenarioShellOverlayRevision, runtimeState.mapSemanticMode,
      runtimeState.scenarioViewMode, runtimeState.showScenarioAtlantropa,
      runtimeState.topologyRevision, runtimeState.sovereigntyRevision,
      runtimeState.topologyPrimary, runtimeState.topology, runtimeState.topologyDetail, runtimeState.runtimePoliticalTopology,
      runtimeState.spatialItems, runtimeState.spatialItems?.length,
      runtimeState.zoomTransform?.k, runtimeState.zoomTransform?.x, runtimeState.zoomTransform?.y,
      bounds?.minX, bounds?.minY, bounds?.maxX, bounds?.maxY,
      getSourceCountriesSignature(getStaticMeshSourceCountries()),
    ];
  }

  function cancelDeferredHeavyBorderMeshes() {
    deferredHeavyBorderRunId += 1;
    workerAbort?.abort();
    workerAbort = null;
    cancelDeferredWork(deferredHeavyBorderMeshHandle);
    deferredHeavyBorderMeshHandle = null;
  }

  function scheduleDeferredHeavyBorderMeshes() {
    cancelDeferredHeavyBorderMeshes();
    const runId = deferredHeavyBorderRunId;
    const taskKey = "deferred-heavy-border-meshes";
    let work = null;
    const enqueue = () => {
      if (runId !== deferredHeavyBorderRunId) return;
      deferredHeavyBorderMeshHandle = scheduleDeferredWork(runSlice, { timeout: 360 });
    };
    const isCurrent = () => runId === deferredHeavyBorderRunId
      && (!work || readWorkIdentity().every((value, index) => value === work.identity[index]));
    const restartIfStale = () => {
      if (isCurrent()) return false;
      if (runId === deferredHeavyBorderRunId) scheduleDeferredHeavyBorderMeshes();
      return true;
    };
    function runSlice() {
      if (runId !== deferredHeavyBorderRunId) return;
      deferredHeavyBorderMeshHandle = null;
      if (restartIfStale()) return;
      if (!isInteractionRecoverySettled({ quietMs: 900 })) { enqueue(); return; }
      if (!beginInteractionRecoveryTask(taskKey)) { enqueue(); return; }
      const startedAt = nowMs();
      let needsContinuation = false;
      let completed = false;
      try {
        if (!work) {
          resetVisibleCountryCodesCache();
          const visibleCountryCodes = getVisibleCountryCodesForBorderMeshes();
          const currentZoom = Math.max(0.0001, Number(runtimeState.zoomTransform?.k || 1));
          const detailAdmMeta = currentZoom >= DETAIL_ADM_BORDERS_MIN_ZOOM
            ? buildDetailAdmMeshSignature(visibleCountryCodes, currentZoom)
            : { detailCountries: [], signature: "" };
          work = {
            identity: readWorkIdentity(), countries: [...visibleCountryCodes], index: 0,
            includeProvince: currentZoom >= PROVINCE_BORDERS_TRANSITION_END_ZOOM,
            includeLocal: currentZoom >= LOCAL_BORDERS_MIN_ZOOM,
            includeDetailAdm: detailAdmMeta.detailCountries.length > 0
              && (getDetailAdmMeshBuildState().signature !== detailAdmMeta.signature
                || getDetailAdmMeshBuildState().status === "idle"),
            detailAdmMeta, phase: "countries", changed: false, snapshotChanged: false,
            cpuMs: 0, yieldCount: 0,
          };
        }
        if (buildDeferredBorderMeshesAsync && commitDeferredBorderMeshes && !work.workerStatus) {
          work.workerStatus = "pending";
          const abort = new AbortController();
          workerAbort = abort;
          Promise.resolve().then(() => {
            if (!isCurrent()) return null;
            return buildDeferredBorderMeshesAsync({ countries: work.countries,
              includeProvince: work.includeProvince, includeLocal: work.includeLocal,
              detailCountries: work.includeDetailAdm ? work.detailAdmMeta.detailCountries : [],
              detailSignature: work.detailAdmMeta.signature, signal: abort.signal });
          }).then((result) => {
            work.workerResult = result;
            work.workerStatus = result == null ? "fallback" : "ready";
          }, (error) => {
            work.workerStatus = "fallback";
            if (isCurrent()) recordInteractionRecoveryTaskMetric("border-worker-fallback", 0, { message: String(error?.message || error) });
          }).finally(() => {
            if (workerAbort === abort) workerAbort = null;
            if (runId !== deferredHeavyBorderRunId) return;
            if (!restartIfStale()) enqueue();
          });
          return;
        }
        if (work.workerStatus === "pending") return;
        if (work.workerStatus === "ready") {
          work.changed = !!commitDeferredBorderMeshes(work.workerResult);
          work.snapshotChanged = work.changed;
          work.index = work.countries.length;
          work.phase = "complete";
          work.workerStatus = "committed";
        }
        if (work.phase === "countries") {
          if (work.includeProvince || work.includeLocal) {
            while (work.index < work.countries.length) {
              const countryCode = work.countries[work.index++];
              const hadProvince = runtimeState.cachedProvinceBordersByCountry?.has(countryCode);
              const hadLocal = runtimeState.cachedLocalBordersByCountry?.has(countryCode);
              ensureCountrySourceBorderMeshes(countryCode, {
                includeProvince: work.includeProvince, includeLocal: work.includeLocal,
              });
              if (restartIfStale()) return;
              if ((work.includeProvince && !hadProvince && runtimeState.cachedProvinceBordersByCountry?.has(countryCode))
                || (work.includeLocal && !hadLocal && runtimeState.cachedLocalBordersByCountry?.has(countryCode))) {
                work.changed = true;
                work.snapshotChanged = true;
              }
              if (nowMs() - startedAt >= 8 && work.index < work.countries.length) {
                needsContinuation = true;
                return;
              }
            }
          }
          // Detail ADM can itself be expensive; never append it to a country slice.
          if (work.includeDetailAdm) {
            work.phase = "detail";
            needsContinuation = true;
            return;
          }
        } else if (work.phase === "detail") {
          const previousDetailAdmStatus = String(getDetailAdmMeshBuildState().status || "idle");
          const detailAdmMesh = buildDetailAdmBorderMesh(runtimeState.topologyDetail, new Set(work.detailAdmMeta.detailCountries));
          if (restartIfStale()) return;
          if (isUsableMesh(detailAdmMesh)) {
            replaceDetailAdmBorders([detailAdmMesh]);
            setDetailAdmMeshBuildState({ signature: work.detailAdmMeta.signature, status: "ready" });
            work.changed = true;
            work.snapshotChanged = true;
          } else {
            setDetailAdmMeshBuildState({ signature: work.detailAdmMeta.signature, status: "empty" });
            work.snapshotChanged ||= previousDetailAdmStatus !== "empty" || runtimeState.cachedDetailAdmBorders.length > 0;
          }
        }
        if (restartIfStale()) return;
        if (work.snapshotChanged) syncStaticMeshSnapshot();
        if (work.changed) {
          invalidateRenderPasses("borders", "deferred-country-border-meshes");
          render();
        }
        completed = true;
      } finally {
        const sliceCpuMs = Math.max(0, nowMs() - startedAt);
        try {
          if (work && isCurrent()) {
            work.cpuMs += sliceCpuMs;
            if (needsContinuation) work.yieldCount += 1;
            recordInteractionRecoveryTaskMetric(taskKey, sliceCpuMs, {
              visibleCountryCount: work.countries.length,
              processedCountryCount: work.index, changed: work.changed,
              includeProvince: work.includeProvince, includeLocal: work.includeLocal,
              includeDetailAdm: work.includeDetailAdm, cpuMs: work.cpuMs,
              yieldCount: work.yieldCount, complete: completed,
            });
          }
        } finally {
          endInteractionRecoveryTask(taskKey);
          if (needsContinuation && isCurrent()) enqueue();
        }
      }
    }
    enqueue();
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
    hasPendingWork: () => !!deferredHeavyBorderMeshHandle || !!workerAbort,
    buildDetailAdmMeshSignature,
    getVisibleCountryCodesForBorderMeshes,
    cancelDeferredHeavyBorderMeshes,
    scheduleDeferredHeavyBorderMeshes,
    captureStaticMeshSnapshot,
    resetVisibleCountryCodesCache,
  });
}
