export function createPerfOverlay() {
  let overlayElement = null;

  function ensurePerfOverlayElement(container) {
    if (!container) return null;
    if (overlayElement && container.contains(overlayElement)) {
      return overlayElement;
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
    container.appendChild(element);
    overlayElement = element;
    return element;
  }

  function updatePerfOverlay(container, {
    cache, sidebarPerf, passNames, renderPerf, scenarioPerf,
    contextScenarioReasonSnapshot, coverageDebug, renderPhase, transformSignature,
  }) {
    if (!cache.perfOverlayEnabled) {
      if (overlayElement?.remove) {
        overlayElement.remove();
      }
      overlayElement = null;
      return;
    }
    const overlay = ensurePerfOverlayElement(container);
    if (!overlay) return;
    const frame = cache.lastFrame || {};
    const invalidations = passNames.map((passName) => {
      const reason = cache.reasons?.[passName] || "-";
      const dirtyFlag = cache.dirty?.[passName] ? "*" : "";
      return `${passName}:${reason}${dirtyFlag}`;
    }).join(" | ");
    const timingEntries = Object.entries(frame.timings || {})
      .map(([name, value]) => `${name}=${Number(value || 0).toFixed(1)}ms`)
      .join(", ");
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
    const backgroundBuild = renderPerf.scenarioPoliticalBackgroundCacheBuild || {};
    overlay.textContent = [
      `phase=${frame.phase || renderPhase} total=${Number(frame.totalMs || 0).toFixed(1)}ms`,
      `action=${cache.lastAction || "-"} ${Number(cache.lastActionDurationMs || 0).toFixed(1)}ms`,
      `transform=${transformSignature}`,
      `passes ${timingEntries || "none"}`,
      `contextBreakdown ${contextBreakdownEntries || "none"}`,
      `ops ${opEntries || "none"}`,
      `ctxReuse skip=${renderPerf.contextBaseReuseSkipped ? "yes" : "no"} scale=${Number(renderPerf.contextBaseReuseScaleRatio?.scaleRatio || 0).toFixed(4)} dist=${Number(renderPerf.contextBaseReuseDistancePx?.distancePx || 0).toFixed(2)}px`,
      `ctxScenario reuse=${cache.counters.contextScenarioReuseCount || 0} exact=${cache.counters.contextScenarioExactRefreshCount || 0} reason=${contextScenarioReasonSnapshot.displayReason} cacheReason=${contextScenarioReasonSnapshot.cacheReason} perfReason=${contextScenarioReasonSnapshot.perfReason} mismatchWarn=${cache.counters.contextScenarioReasonMismatchWarnings || 0}`,
      `coverage countries=${Number(coverageDebug.totalCountries || 0)} detail=${Number(coverageDebug.detailCountries || 0)} primary=${Number(coverageDebug.primaryCountries || 0)} priorityGap=${Array.isArray(coverageDebug.priorityCountryGaps) ? coverageDebug.priorityCountryGaps.length : 0}`,
      `projBounds total=${Number(renderPerf.projectedBoundsDiagnostics?.total || 0)} reasons=${JSON.stringify(renderPerf.projectedBoundsDiagnostics?.byReason || {})}`,
      `partial applied=${!!renderPerf.politicalPartialRepaint?.applied} reason=${renderPerf.politicalPartialRepaint?.fallbackReason || "-"} dirty=${Number(renderPerf.politicalPartialRepaint?.dirtyFeatureCount || 0)} candidates=${Number(renderPerf.politicalPartialRepaint?.candidateCount || 0)} misses=${Number(renderPerf.politicalPartialRepaint?.pathCacheMisses || 0)} coverage=${Number(renderPerf.politicalPartialRepaint?.viewportCoverage || 0).toFixed(4)}`,
      `bgPaths entries=${Number(backgroundBuild.entryCount || 0)} built=${Number(backgroundBuild.builtPathCount || 0)} reused=${Number(backgroundBuild.reusedPathCount || 0)} previous=${Number(backgroundBuild.reusedPreviousPathCount || 0)} cache=${Number(backgroundBuild.pathCacheSizeBefore || 0)}->${Number(backgroundBuild.pathCacheSizeAfter || 0)} reset=${backgroundBuild.pathCacheResetReason || "-"}`,
      `bgGroups built=${Number(backgroundBuild.builtGroupMergeCount || 0)} reused=${Number(backgroundBuild.reusedGroupMergeCount || 0)}`,
      `invalidations ${invalidations}`,
      `render draw=${cache.counters.drawCanvas || 0} frame=${cache.counters.frames || 0} ctxBase=${cache.counters.contextBasePassRenders || 0} labels=${cache.counters.labelPassRenders || 0} ctxScenario=${cache.counters.contextScenarioPassRenders || 0} dayNight=${cache.counters.dayNightPassRenders || 0} hit=${cache.counters.hitCanvasRenders || 0} dynBorder=${cache.counters.dynamicBorderRebuilds || 0}`,
      `sidebar list=${sidebarPerf.counters.fullListRenders || 0} rows=${sidebarPerf.counters.rowRefreshes || 0} detail=${sidebarPerf.counters.inspectorRenders || 0} preset=${sidebarPerf.counters.presetTreeRenders || 0} legend=${sidebarPerf.counters.legendRenders || 0}`,
    ].join("\n");
  }

  return { updatePerfOverlay };
}
