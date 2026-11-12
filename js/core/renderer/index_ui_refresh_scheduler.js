export function createIndexUiRefreshScheduler({
  runtimeState,
  setTimeout,
  clearTimeout,
  requestAnimationFrame,
  cancelAnimationFrame,
  scheduleAfterPaint,
  canonicalCountryCode,
  collectCountryCodesForFeatureIds,
  hasSelectedOrActiveCountryImpact,
  notifyDevWorkspace,
  recordUiRefreshMetric,
  callRuntimeHook,
  unwrapRuntimeHookResult,
}) {
  let pendingIndexUiRefreshHandle = null;
  let pendingIndexUiRefreshState = null;
  let deferredIndexUiRefreshHandle = null;
  let deferredIndexUiRefreshState = null;
  let pendingSidebarRefreshHandle = null;
  let pendingSidebarRefreshState = null;

  function cancelPendingIndexUiRefresh() {
    if (deferredIndexUiRefreshHandle !== null && deferredIndexUiRefreshHandle !== undefined) {
      if (typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(deferredIndexUiRefreshHandle);
      } else {
        clearTimeout(deferredIndexUiRefreshHandle);
      }
      deferredIndexUiRefreshHandle = null;
    }
    deferredIndexUiRefreshState = null;
    if (pendingIndexUiRefreshHandle === null || pendingIndexUiRefreshHandle === undefined) {
      pendingIndexUiRefreshState = null;
      return;
    }
    clearTimeout(pendingIndexUiRefreshHandle);
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
    if (pending.renderCountryList && (runtimeState.styleConfig?.thematic?.enabled === true || runtimeState.styleConfig?.population?.enabled === true)) {
      callRuntimeHook(runtimeState, "updateSpecialZoneEditorUIFn");
    }
    if (pending.renderWaterRegionList && typeof runtimeState.renderWaterRegionListFn === "function") {
      runtimeState.renderWaterRegionListFn();
      refreshedScopes.push("water");
    }
    if (pending.renderSpecialRegionList && typeof runtimeState.renderSpecialRegionListFn === "function") {
      runtimeState.renderSpecialRegionListFn();
      refreshedScopes.push("special");
    }
    if (pending.renderDevWorkspace) notifyDevWorkspace();
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
    renderDevWorkspace = false,
  } = {}) {
    pendingIndexUiRefreshState = {
      renderCountryList: !!(pendingIndexUiRefreshState?.renderCountryList || renderCountryList),
      renderWaterRegionList: !!(pendingIndexUiRefreshState?.renderWaterRegionList || renderWaterRegionList),
      renderSpecialRegionList: !!(pendingIndexUiRefreshState?.renderSpecialRegionList || renderSpecialRegionList),
      renderDevWorkspace: !!(pendingIndexUiRefreshState?.renderDevWorkspace || renderDevWorkspace),
    };
    if (pendingIndexUiRefreshHandle !== null && pendingIndexUiRefreshHandle !== undefined) {
      return;
    }
    const callback = () => {
      if (pendingIndexUiRefreshHandle !== handle) return;
      flushPendingIndexUiRefresh();
    };
    // Keep list/workspace work out of the map's animation-frame task.
    const handle = setTimeout(callback, 0);
    pendingIndexUiRefreshHandle = handle;
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
    renderDevWorkspace = false,
  } = {}) {
    deferredIndexUiRefreshState = {
      renderCountryList: !!(deferredIndexUiRefreshState?.renderCountryList || renderCountryList),
      renderWaterRegionList: !!(deferredIndexUiRefreshState?.renderWaterRegionList || renderWaterRegionList),
      renderSpecialRegionList: !!(deferredIndexUiRefreshState?.renderSpecialRegionList || renderSpecialRegionList),
      renderDevWorkspace: !!(deferredIndexUiRefreshState?.renderDevWorkspace || renderDevWorkspace),
    };
    if (deferredIndexUiRefreshHandle !== null && deferredIndexUiRefreshHandle !== undefined) {
      return;
    }
    const callback = () => {
      if (deferredIndexUiRefreshHandle !== handle) return;
      flushDeferredIndexUiRefresh();
    };
    const handle = typeof requestAnimationFrame === "function"
      ? requestAnimationFrame(callback)
      : setTimeout(callback, 0);
    deferredIndexUiRefreshHandle = handle;
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
    pendingSidebarRefreshHandle();
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
    // Row refreshes run after the paint click's frame is on screen.
    pendingSidebarRefreshHandle = scheduleAfterPaint(flushPendingSidebarRefresh, { withoutFrame: "timer" });
  }

  return {
    cancelPendingIndexUiRefresh,
    scheduleIndexUiRefresh,
    scheduleIndexUiRefreshAfterCoarseFrame,
    queueIndexUiRefresh,
    refreshWaterRegionSidebarRowsNow,
    refreshSpecialRegionSidebarRowsNow,
    cancelPendingSidebarRefresh,
    scheduleSidebarRefresh,
  };
}
