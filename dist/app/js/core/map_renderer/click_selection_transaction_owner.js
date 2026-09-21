const RESOLVED_HIT_KEYS = [
  "targetType",
  "id",
  "countryCode",
  "runtimeCountryCode",
];

const READONLY_MODIFIER_KEYS = [
  "ctrlKey",
  "metaKey",
  "shiftKey",
  "altKey",
];

const TARGET_KINDS = new Set(["land", "water", "special"]);

function requireExactDataRecord(value, expectedKeys, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object with exact scalar keys.`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== expectedKeys.length
    || !expectedKeys.every((key) => ownKeys.includes(key))
  ) {
    throw new TypeError(`${label} must contain exactly: ${expectedKeys.join(", ")}.`);
  }
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${label}.${key} must be an enumerable data value.`);
    }
  }
}

function requireNullableString(value, label) {
  if (value !== null && typeof value !== "string") {
    throw new TypeError(`${label} must be a string or null.`);
  }
}

function normalizeIdentity(value) {
  return value === null || value.trim().length === 0 ? null : value;
}

export function resolveClickSelectionDecision(resolvedHit, readonlyModifiers) {
  requireExactDataRecord(resolvedHit, RESOLVED_HIT_KEYS, "resolvedHit");
  requireExactDataRecord(readonlyModifiers, READONLY_MODIFIER_KEYS, "readonlyModifiers");

  requireNullableString(resolvedHit.targetType, "resolvedHit.targetType");
  if (resolvedHit.targetType !== null && !TARGET_KINDS.has(resolvedHit.targetType)) {
    throw new TypeError("resolvedHit.targetType must be land, water, special, or null.");
  }
  for (const key of ["id", "countryCode", "runtimeCountryCode"]) {
    requireNullableString(resolvedHit[key], `resolvedHit.${key}`);
  }
  for (const key of READONLY_MODIFIER_KEYS) {
    if (typeof readonlyModifiers[key] !== "boolean") {
      throw new TypeError(`readonlyModifiers.${key} must be a boolean.`);
    }
  }

  const target = resolvedHit.targetType === null
    ? { kind: "empty" }
    : {
        kind: resolvedHit.targetType,
        id: normalizeIdentity(resolvedHit.id),
        countryCode: normalizeIdentity(resolvedHit.countryCode),
        runtimeCountryCode: normalizeIdentity(resolvedHit.runtimeCountryCode),
      };
  const decision = {
    devSelectionRequested: target.kind === "land" && (readonlyModifiers.ctrlKey || readonlyModifiers.metaKey),
  };
  return { decision, target };
}

function requireFunction(candidate, label) {
  if (typeof candidate !== "function") throw new TypeError(`${label} must be a function.`);
  return candidate;
}

function requirePorts(group, names, label) {
  return Object.freeze(Object.fromEntries(names.map((name) => [name, requireFunction(group[name], `${label}.${name}`)])));
}

const CLICK_SELECTION_SERVICE_NAMES = Object.freeze([
  "addRecentColor",
  "appendOperationalLineVertexFromEvent",
  "appendOperationGraphicVertexFromEvent",
  "appendSpecialZoneVertexFromEvent",
  "applyFacilityInfoCardState",
  "applyFeatureVisualOverrideTransaction",
  "applyVisualSubdivisionFill",
  "applyWaterRegionFill",
  "blockStartupReadonlyInteraction",
  "captureHistoryState",
  "commitHistoryEntry",
  "dismissOnboardingHint",
  "ensureLeafDetailReady",
  "getFeatureCountryCodeNormalized",
  "getFeatureOwnerCode",
  "getHitFromEvent",
  "getHoveredFacilityEntryFromEvent",
  "getIntensityFieldTool",
  "getSafeCanvasColor",
  "getSpecialRegionColor",
  "getWaterRegionColor",
  "handleSpecialZoneMembershipClick",
  "inspectHgoRuntimePreviewFromEvent",
  "isDoubleClickBatchEligible",
  "isFacilityDetailsSurfaceActive",
  "isMacroOceanWaterRegion",
  "isOpenOceanPaintEnabled",
  "isSovereigntyModeActive",
  "markDirty",
  "markLegacyColorStateDirty",
  "noteRenderAction",
  "nowMs",
  "placeUnitCounterFromEvent",
  "queueTooltipUpdate",
  "refreshResolvedColorsForFeatures",
  "refreshResolvedColorsForOwners",
  "refreshSidebarAfterPaint",
  "refreshSpecialRegionSidebarRowsNow",
  "refreshWaterRegionSidebarRowsNow",
  "renderHoverOverlayIfNeeded",
  "requestInteractionRender",
  "resetFeatureOwnerCodes",
  "resolveInteractionTargetIds",
  "scheduleDynamicBorderRecompute",
  "setFeatureOwnerCodes",
  "shouldBlockUnderlyingSelectionForFacility",
  "shouldRequireLeafDetail",
  "syncInspectorCountryToLandSelection",
  "toggleFeatureInDevSelection",
  "updateDevSelectedHit",
  "warnMissingActiveSovereign",
]);
const CLICK_SELECTION_ACTION_NAMES = Object.freeze([
  "clearClickHoverIds",
  "consumeSuppressedBrushClick",
  "removeClickCountryColors",
  "removeClickWaterRegionOverride",
  "setClickActiveSovereignCode",
  "setClickCountryColors",
  "setClickHoverOverlayDirty",
  "setClickSelectedColor",
  "setClickSelectedSpecialRegionId",
  "setClickSelectedWaterRegionId",
  "setFacilityInfoCardExpanded",
  "setHoveredFacilityEntry",
  "setSelectedFacilityEntry",
  "togglePresetRegion"
]);

export function createClickSelectionTransactionOwner({ constants = {}, getters = {}, effects = {}, services = {} } = {}) {
  const { clickSnapRadiusPx, landFillColor } = constants;
  if (!Number.isFinite(clickSnapRadiusPx) || clickSnapRadiusPx < 0) {
    throw new TypeError("constants.clickSnapRadiusPx must be a non-negative finite number.");
  }
  const getClickState = requireFunction(getters.getClickState, "getters.getClickState");
  const getSelectedFacilityEntry = requireFunction(getters.getSelectedFacilityEntry, "getters.getSelectedFacilityEntry");
  const { clearClickHoverIds, consumeSuppressedBrushClick, removeClickCountryColors, removeClickWaterRegionOverride, setClickActiveSovereignCode, setClickCountryColors, setClickHoverOverlayDirty, setClickSelectedColor, setClickSelectedSpecialRegionId, setClickSelectedWaterRegionId, setFacilityInfoCardExpanded, setHoveredFacilityEntry, setSelectedFacilityEntry, togglePresetRegion } = requirePorts(effects, CLICK_SELECTION_ACTION_NAMES, "effects");
  const { addRecentColor, appendOperationalLineVertexFromEvent, appendOperationGraphicVertexFromEvent, appendSpecialZoneVertexFromEvent, applyFacilityInfoCardState, applyFeatureVisualOverrideTransaction, applyVisualSubdivisionFill, applyWaterRegionFill, blockStartupReadonlyInteraction, captureHistoryState, commitHistoryEntry, dismissOnboardingHint, ensureLeafDetailReady, getFeatureCountryCodeNormalized, getFeatureOwnerCode, getHitFromEvent, getHoveredFacilityEntryFromEvent, getIntensityFieldTool, getSafeCanvasColor, getSpecialRegionColor, getWaterRegionColor, handleSpecialZoneMembershipClick, inspectHgoRuntimePreviewFromEvent, isDoubleClickBatchEligible, isFacilityDetailsSurfaceActive, isMacroOceanWaterRegion, isOpenOceanPaintEnabled, isSovereigntyModeActive, markDirty, markLegacyColorStateDirty, noteRenderAction, nowMs, placeUnitCounterFromEvent, queueTooltipUpdate, refreshResolvedColorsForFeatures, refreshResolvedColorsForOwners, refreshSidebarAfterPaint, refreshSpecialRegionSidebarRowsNow, refreshWaterRegionSidebarRowsNow, renderHoverOverlayIfNeeded, requestInteractionRender, resetFeatureOwnerCodes, resolveInteractionTargetIds, scheduleDynamicBorderRecompute, setFeatureOwnerCodes, shouldBlockUnderlyingSelectionForFacility, shouldRequireLeafDetail, syncInspectorCountryToLandSelection, toggleFeatureInDevSelection, updateDevSelectedHit, warnMissingActiveSovereign } = requirePorts(services, CLICK_SELECTION_SERVICE_NAMES, "services");

  async function handleClick(event, _interactionContext = null) {
    let state = getClickState();
    if (state.startupReadonly) {
      if (event?.preventDefault) event.preventDefault();
      blockStartupReadonlyInteraction();
      return;
    }
    const actionStart = nowMs();
    if (!state.landData && !state.waterRegionsData && !state.scenarioSpecialRegionsData) return;
    if (consumeSuppressedBrushClick()) return;
    dismissOnboardingHint();
    if (getIntensityFieldTool().active) {
      return;
    }
    if (state.specialZoneEditor?.active) {
      appendSpecialZoneVertexFromEvent(event);
      return;
    }
    if (state.operationalLineEditor?.active) {
      appendOperationalLineVertexFromEvent(event);
      return;
    }
    if (state.operationGraphicsEditor?.active) {
      appendOperationGraphicVertexFromEvent(event);
      return;
    }
    if (state.unitCounterEditor?.active) {
      placeUnitCounterFromEvent(event);
      return;
    }

    const hgoRuntimeClick = inspectHgoRuntimePreviewFromEvent(event, { eventType: "click" });
    if (hgoRuntimeClick.active) {
      if (event?.preventDefault) event.preventDefault();
      updateDevSelectedHit(hgoRuntimeClick.hit?.id ? hgoRuntimeClick.hit : null);
      clearClickHoverIds();
      queueTooltipUpdate({ visible: false });
      setClickHoverOverlayDirty(true);
      renderHoverOverlayIfNeeded({ eventType: "hgo-runtime-preview-click" });
      requestInteractionRender("hgo-runtime-preview-click");
      noteRenderAction(hgoRuntimeClick.hit?.id ? "hgo-runtime-preview-select" : "hgo-runtime-preview-empty", actionStart);
      return;
    }

    const clickedFacilityEntry = getHoveredFacilityEntryFromEvent(event);
    if (clickedFacilityEntry && isFacilityDetailsSurfaceActive(clickedFacilityEntry.familyId)) {
      setHoveredFacilityEntry(clickedFacilityEntry);
      setSelectedFacilityEntry(clickedFacilityEntry);
      setFacilityInfoCardExpanded(false);
      queueTooltipUpdate({ visible: false });
      applyFacilityInfoCardState(clickedFacilityEntry, {
        x: event?.clientX,
        y: event?.clientY,
      });
      setClickHoverOverlayDirty(true);
      renderHoverOverlayIfNeeded({ eventType: "facility-card-open" });
      noteRenderAction("click-facility-info", actionStart);
      return;
    }
    if (clickedFacilityEntry && shouldBlockUnderlyingSelectionForFacility(clickedFacilityEntry)) {
      setHoveredFacilityEntry(clickedFacilityEntry);
      if (getSelectedFacilityEntry()) {
        setSelectedFacilityEntry(null);
        applyFacilityInfoCardState(null);
      }
      queueTooltipUpdate({ visible: false });
      setClickHoverOverlayDirty(true);
      renderHoverOverlayIfNeeded({ eventType: "facility-click-block-underlying" });
      noteRenderAction("click-facility-block-underlying", actionStart);
      return;
    }
    if (getSelectedFacilityEntry()) {
      setSelectedFacilityEntry(null);
      applyFacilityInfoCardState(null);
      setClickHoverOverlayDirty(true);
      renderHoverOverlayIfNeeded({ eventType: "facility-card-clear" });
    }

    const hit = getHitFromEvent(event, {
      enableSnap: true,
      snapPx: clickSnapRadiusPx,
      eventType: "click",
    });
    const resolvedHit = {
      targetType: hit.targetType ?? null,
      id: hit.id ?? null,
      countryCode: hit.countryCode ?? null,
      runtimeCountryCode: hit.runtimeCountryCode ?? null,
    };
    const readonlyModifiers = Object.freeze({
      ctrlKey: !!event?.ctrlKey,
      metaKey: !!event?.metaKey,
      shiftKey: !!event?.shiftKey,
      altKey: !!event?.altKey,
    });
    const { decision, target } = resolveClickSelectionDecision(resolvedHit, readonlyModifiers);
    // City points may influence hover messaging, but paint/select stays bound to
    // the canonical land/water/special hit pipeline only.
    const id = target.id;
    if (target.kind === "empty" || !id) {
      if (state.selectedWaterRegionId) {
        const previousWaterRegionId = String(state.selectedWaterRegionId || "").trim();
        setClickSelectedWaterRegionId("");
        refreshWaterRegionSidebarRowsNow([previousWaterRegionId]);
        requestInteractionRender("clear-water-selection-empty-click");
      }
      if (state.selectedSpecialRegionId) {
        const previousSpecialRegionId = String(state.selectedSpecialRegionId || "").trim();
        setClickSelectedSpecialRegionId("");
        refreshSpecialRegionSidebarRowsNow([previousSpecialRegionId]);
        requestInteractionRender("clear-special-selection-empty-click");
      }
      return;
    }
    updateDevSelectedHit(hit);
    if (handleSpecialZoneMembershipClick(hit, event)) return;
    if (target.kind === "special") {
      const specialFeature = state.specialRegionsById.get(id);
      if (!specialFeature) return;
      const previousWaterRegionId = String(state.selectedWaterRegionId || "").trim();
      const previousSpecialRegionId = String(state.selectedSpecialRegionId || "").trim();
      setClickSelectedWaterRegionId("");
      setClickSelectedSpecialRegionId(id);
      if (previousWaterRegionId) refreshWaterRegionSidebarRowsNow([previousWaterRegionId]);
      refreshSpecialRegionSidebarRowsNow([previousSpecialRegionId, id]);
      requestInteractionRender("select-special-region");
      if (state.currentTool === "eyedropper") {
        const picked = getSpecialRegionColor(id, specialFeature);
        if (picked) setClickSelectedColor(picked, { updateSwatch: true });
        noteRenderAction("eyedropper-special", actionStart);
        return;
      }
      noteRenderAction("select-special-region", actionStart);
      return;
    }
    if (target.kind === "water") {
      const waterFeature = state.waterRegionsById.get(id);
      if (!waterFeature) return;
      const previousSpecialRegionId = String(state.selectedSpecialRegionId || "").trim();
      const previousWaterRegionId = String(state.selectedWaterRegionId || "").trim();
      const isSelectionToggle = readonlyModifiers.ctrlKey || readonlyModifiers.metaKey;
      if (isSelectionToggle && event?.preventDefault) event.preventDefault();
      setClickSelectedSpecialRegionId("");
      if (isSelectionToggle && previousWaterRegionId === id) {
        setClickSelectedWaterRegionId("");
        if (previousSpecialRegionId) refreshSpecialRegionSidebarRowsNow([previousSpecialRegionId]);
        refreshWaterRegionSidebarRowsNow([previousWaterRegionId]);
        requestInteractionRender("water-selection-toggle-off");
        noteRenderAction("water-selection-toggle-off", actionStart);
        return;
      }
      setClickSelectedWaterRegionId(id);
      if (previousSpecialRegionId) refreshSpecialRegionSidebarRowsNow([previousSpecialRegionId]);
      refreshWaterRegionSidebarRowsNow([previousWaterRegionId, id]);
      if (isSelectionToggle) {
        requestInteractionRender("water-selection-toggle-on");
        noteRenderAction("water-selection-toggle-on", actionStart);
        return;
      }
      const macroOceanSelectionOnly =
        isMacroOceanWaterRegion(waterFeature) && !isOpenOceanPaintEnabled();
      if (macroOceanSelectionOnly) {
        requestInteractionRender("click-select-open-ocean");
        noteRenderAction("click-select-open-ocean", actionStart);
        return;
      }
      if (state.currentTool === "eraser") {
        const historyBefore = captureHistoryState({ waterRegionIds: [id] });
        removeClickWaterRegionOverride(id);
        markDirty("erase-water-region-color");
        commitHistoryEntry({
          kind: "erase-water-region-color",
          before: historyBefore,
          after: captureHistoryState({ waterRegionIds: [id] }),
        });
        requestInteractionRender("click-erase-water");
        refreshSidebarAfterPaint({ waterRegionIds: [id] });
        noteRenderAction("click-erase-water", actionStart);
        return;
      }
      if (state.currentTool === "eyedropper") {
        const picked = getWaterRegionColor(id);
        if (picked) setClickSelectedColor(picked, { updateSwatch: true });
        requestInteractionRender("eyedropper-water");
        noteRenderAction("eyedropper-water", actionStart);
        return;
      }
      applyWaterRegionFill(id, state.selectedColor, {
        kind: "fill-water-region-color",
        dirtyReason: "fill-water-region-color",
      });
      return;
    }
    if (target.kind !== "land") return;
    if (state.selectedWaterRegionId) {
      const previousWaterRegionId = String(state.selectedWaterRegionId || "").trim();
      setClickSelectedWaterRegionId("");
      refreshWaterRegionSidebarRowsNow([previousWaterRegionId]);
      requestInteractionRender("clear-water-selection-land-click");
    }
    if (state.selectedSpecialRegionId) {
      const previousSpecialRegionId = String(state.selectedSpecialRegionId || "").trim();
      setClickSelectedSpecialRegionId("");
      refreshSpecialRegionSidebarRowsNow([previousSpecialRegionId]);
      requestInteractionRender("clear-special-selection-land-click");
    }
    let landHit = hit;
    let landId = id;
    let feature = state.landIndex.get(landId);
    if (!feature) return;
    if (decision.devSelectionRequested) {
      if (event?.preventDefault) event.preventDefault();
      const changedSelection = toggleFeatureInDevSelection(landId);
      syncInspectorCountryToLandSelection(feature, landId, landHit);
      noteRenderAction(changedSelection ? "dev-selection-toggle" : "dev-selection-sync", actionStart);
      return;
    }
    let countryCode = landHit.countryCode || getFeatureCountryCodeNormalized(feature);
    if (!(await ensureLeafDetailReady(countryCode, { announce: true }))) {
      return;
    }
    state = getClickState();
    if (shouldRequireLeafDetail(countryCode)) {
      const refreshedHit = getHitFromEvent(event, {
        enableSnap: true,
        snapPx: clickSnapRadiusPx,
        eventType: "click",
      });
      const refreshedId = refreshedHit.id;
      const refreshedFeature = refreshedId ? state.landIndex.get(refreshedId) : null;
      if (refreshedHit.targetType === "land" && refreshedId && refreshedFeature) {
        landHit = refreshedHit;
        landId = refreshedId;
        feature = refreshedFeature;
        countryCode = landHit.countryCode || getFeatureCountryCodeNormalized(feature);
        updateDevSelectedHit(landHit);
      }
    }
    const targetIds = resolveInteractionTargetIds(feature, landId);

    if (state.isEditingPreset) {
      togglePresetRegion(landId);
      return;
    }

    if (state.currentTool === "eraser") {
      const shouldRefreshCountryList = (!!countryCode);
      let historyBefore = null;
      if (isSovereigntyModeActive()) {
        historyBefore = captureHistoryState({
          sovereigntyFeatureIds: targetIds,
        });
        const changed = resetFeatureOwnerCodes(targetIds);
        if (changed > 0) {
          refreshResolvedColorsForFeatures(targetIds, { renderNow: false });
          markDirty("erase-sovereignty");
          if (targetIds.length > 1) {
            scheduleDynamicBorderRecompute("sovereignty-batch-reset", 90);
          } else {
            scheduleDynamicBorderRecompute("sovereignty-single-reset", 150);
          }
          commitHistoryEntry({
            kind: "erase-sovereignty",
            before: historyBefore,
            after: captureHistoryState({
              sovereigntyFeatureIds: targetIds,
            }),
            affectsSovereignty: true,
          });
        }
      } else if (state.interactionGranularity === "country" && countryCode) {
        historyBefore = captureHistoryState({
          ownerCodes: [countryCode],
        });
        removeClickCountryColors(countryCode);
        markLegacyColorStateDirty();
        refreshResolvedColorsForOwners([countryCode], { renderNow: false });
        markDirty("erase-country-color");
        commitHistoryEntry({
          kind: "erase-country-color",
          before: historyBefore,
          after: captureHistoryState({
            ownerCodes: [countryCode],
          }),
        });
      } else {
        historyBefore = captureHistoryState({
          featureIds: targetIds,
        });
        applyFeatureVisualOverrideTransaction(targetIds, null, {
          remove: true,
          inputStartedAt: actionStart,
          inputLabel: "erase-feature-color",
        });
        markDirty("erase-feature-color");
        commitHistoryEntry({
          kind: "erase-feature-color",
          before: historyBefore,
          after: captureHistoryState({
            featureIds: targetIds,
          }),
        });
      }
      requestInteractionRender("click-erase");
      if (shouldRefreshCountryList) {
        refreshSidebarAfterPaint({
          featureIds: targetIds,
          ownerCodes: countryCode ? [countryCode] : [],
        });
      }
      noteRenderAction("click-erase", actionStart);
      return;
    }

    if (state.currentTool === "eyedropper") {
      if (isSovereigntyModeActive()) {
        const ownerCode = getFeatureOwnerCode(landId) || countryCode;
        if (ownerCode) {
          const previousActiveOwner = state.activeSovereignCode;
          setClickActiveSovereignCode(ownerCode, { updateUi: true });
          refreshSidebarAfterPaint({
            ownerCodes: [previousActiveOwner, ownerCode],
          });
        }
      } else {
        const picked =
          (state.interactionGranularity === "country" && countryCode
            ? getSafeCanvasColor(state.sovereignBaseColors?.[countryCode] || state.countryBaseColors?.[countryCode], null)
            : null) ||
          getSafeCanvasColor(state.colors[landId], null);
        if (picked) setClickSelectedColor(picked, { updateSwatch: true });
      }
      noteRenderAction("eyedropper", actionStart);
      return;
    }

    const selectedColor = getSafeCanvasColor(state.selectedColor, landFillColor);
    setClickSelectedColor(selectedColor);
    if (isSovereigntyModeActive()) {
      const historyBefore = captureHistoryState({
        sovereigntyFeatureIds: targetIds,
      });
      if (!state.activeSovereignCode) {
        warnMissingActiveSovereign();
        return;
      }
      const changed = setFeatureOwnerCodes(targetIds, state.activeSovereignCode);
      if (changed > 0) {
        refreshResolvedColorsForFeatures(targetIds, { renderNow: false });
        if (targetIds.length > 1) {
          scheduleDynamicBorderRecompute("sovereignty-batch-fill", 90);
        } else {
          scheduleDynamicBorderRecompute("sovereignty-single-fill", 150);
        }
      }
      if (changed > 0) {
        markDirty("fill-sovereignty");
        commitHistoryEntry({
          kind: "fill-sovereignty",
          before: historyBefore,
          after: captureHistoryState({
            sovereigntyFeatureIds: targetIds,
          }),
          affectsSovereignty: true,
        });
      }
    } else if (state.interactionGranularity === "country" && countryCode) {
      const historyBefore = captureHistoryState({
        ownerCodes: [countryCode],
      });
      setClickCountryColors(countryCode, selectedColor);
      markLegacyColorStateDirty();
      refreshResolvedColorsForOwners([countryCode], { renderNow: false });
      markDirty("fill-country-color");
      commitHistoryEntry({
        kind: "fill-country-color",
        before: historyBefore,
        after: captureHistoryState({
          ownerCodes: [countryCode],
        }),
      });
    } else {
      const clickCount = Math.max(1, Number(event?.detail || 1));
      if (clickCount >= 2 && isDoubleClickBatchEligible(landHit, feature)) {
        return;
      }
      applyVisualSubdivisionFill(targetIds, selectedColor, {
        kind: "fill-feature-color",
        dirtyReason: "fill-feature-color",
        gesture: { type: "leaf-click", featureId: landId, timeStamp: Number(event?.timeStamp) },
      });
      return;
    }
    addRecentColor(selectedColor);
    requestInteractionRender("click-fill");
    if (isSovereigntyModeActive() || (state.interactionGranularity === "country" && countryCode)) {
      refreshSidebarAfterPaint({
        featureIds: targetIds,
        ownerCodes: countryCode ? [countryCode] : [],
      });
    }
    noteRenderAction("click-fill", actionStart);
  }


  return Object.freeze({ handleClick });
}
