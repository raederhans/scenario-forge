/**
 * Owns the water and special-region inspector panels inside the sidebar:
 * - water region filtering, detail, legend, batch color actions
 * - special region visibility, detail, legend, color actions
 * - panel-local picker runtimeState and event binding
 *
 * sidebar.js keeps the higher-level facade:
 * - runtimeState callback registration
 * - shared layout scheduling and sidebar shell events
 * - cross-panel bridges such as special-zone and workspace status updates
 */
export function createWaterSpecialRegionController({
  runtimeState,
  elements,
  helpers,
}) {
  const {
    waterInspectorSection,
    waterInspectorOpenOceanSelectToggle,
    waterInspectorOpenOceanSelectHint,
    waterInspectorOpenOceanPaintToggle,
    waterInspectorOpenOceanPaintHint,
    waterInspectorOverridesOnlyToggle,
    waterInspectorTypeFilter,
    waterInspectorGroupFilter,
    waterInspectorSourceFilter,
    waterInspectorSortSelect,
    waterInspectorResultCount,
    waterSearchInput,
    waterRegionList,
    waterLegendList,
    waterInspectorEmpty,
    waterInspectorSelected,
    waterInspectorDetailHint,
    waterInspectorMetaSection,
    waterInspectorMetaList,
    waterInspectorHierarchySection,
    waterInspectorJumpToParentBtn,
    waterInspectorChildrenList,
    waterInspectorColorRow,
    waterInspectorColorLabel,
    waterInspectorColorSwatch,
    waterInspectorColorValue,
    waterInspectorColorInput,
    clearWaterRegionColorBtn,
    waterInspectorBatchSection,
    waterInspectorScopeSelect,
    waterInspectorScopePreview,
    applyWaterFamilyOverrideBtn,
    clearWaterFamilyOverrideBtn,
    specialRegionInspectorSection,
    scenarioSpecialRegionVisibilityToggle,
    scenarioSpecialRegionVisibilityHint,
    scenarioReliefOverlayVisibilityToggle,
    scenarioReliefOverlayVisibilityHint,
    specialRegionSearchInput,
    specialRegionList,
    specialRegionLegendList,
    specialRegionInspectorEmpty,
    specialRegionInspectorSelected,
    specialRegionInspectorDetailHint,
    specialRegionColorRow,
    specialRegionColorLabel,
    specialRegionColorSwatch,
    specialRegionColorValue,
    specialRegionColorInput,
    clearSpecialRegionColorBtn,
  } = elements;

  const {
    mapRenderer,
    render,
    t,
    normalizeHexColor,
    getGeoFeatureDisplayLabel,
    captureHistoryState,
    pushHistoryEntry,
    markDirty,
    ensureActiveScenarioOptionalLayerLoaded,
    createEmptyNote,
    scheduleAdaptiveInspectorHeights,
    updateSpecialZoneEditorUi,
    updateWorkspaceStatus,
  } = helpers;

  let waterInspectorColorPickerOpen = false;
  let specialRegionColorPickerOpen = false;
  const waterRowRefsById = new Map();
  const specialRegionRowRefsById = new Map();

  const closeWaterInspectorColorPicker = () => {
    if (!waterInspectorColorInput) return;
    waterInspectorColorPickerOpen = false;
    waterInspectorColorInput.blur();
  };

  const closeSpecialRegionColorPicker = () => {
    if (!specialRegionColorInput) return;
    specialRegionColorPickerOpen = false;
    specialRegionColorInput.blur();
  };

  const getWaterSearchTerm = () => (waterSearchInput?.value || "").trim().toLowerCase();

  const getLegacyOpenOceanFallbackEnabled = () =>
    !!runtimeState.showOpenOceanRegions && !runtimeState.allowOpenOceanSelect && !runtimeState.allowOpenOceanPaint;

  const isOpenOceanSelectionEnabled = () =>
    !!runtimeState.allowOpenOceanSelect || getLegacyOpenOceanFallbackEnabled();

  const isOpenOceanPaintEnabled = () =>
    !!runtimeState.allowOpenOceanPaint || getLegacyOpenOceanFallbackEnabled();

  const syncOpenOceanInspectorState = () => {
    runtimeState.showOpenOceanRegions = !!(isOpenOceanSelectionEnabled() || isOpenOceanPaintEnabled());
  };

  const formatWaterTokenLabel = (value, fallback = "Unknown") => {
    const normalized = String(value || "").trim();
    if (!normalized) return fallback;
    return normalized
      .replace(/_/g, " ")
      .replace(/\b\w/g, (match) => match.toUpperCase());
  };

  const getWaterFeatureDisplayName = (feature) => {
    return getGeoFeatureDisplayLabel(feature, "Water Region")
      || t("Water Region", "ui")
      || "Water Region";
  };

  const getWaterFeatureId = (feature) =>
    String(feature?.properties?.id || feature?.id || "").trim();

  const getWaterFeatureType = (feature) =>
    String(feature?.properties?.water_type || "water_region").trim().toLowerCase();

  const getWaterFeatureGroup = (feature) =>
    String(feature?.properties?.region_group || "").trim().toLowerCase();

  const getWaterFeatureParentId = (feature) =>
    String(feature?.properties?.parent_id || "").trim();

  const getWaterFeatureSource = (feature) =>
    String(feature?.properties?.source_standard || "").trim().toLowerCase();

  const getWaterFeatureHasOverride = (featureId) =>
    Object.prototype.hasOwnProperty.call(runtimeState.waterRegionOverrides || {}, String(featureId || "").trim());

  const getWaterFeatureMeta = (feature) => {
    const waterType = formatWaterTokenLabel(getWaterFeatureType(feature), "Water");
    const regionGroup = formatWaterTokenLabel(getWaterFeatureGroup(feature));
    const sourceLabel = formatWaterTokenLabel(getWaterFeatureSource(feature));
    return [waterType, regionGroup, sourceLabel].filter(Boolean).join(" · ");
  };

  const isOpenOceanWaterFeature = (feature) =>
    getWaterFeatureType(feature) === "ocean";

  const isWaterFeatureVisibleInInspector = (feature) => {
    if (!feature) return false;
    if (isOpenOceanWaterFeature(feature)) {
      return isOpenOceanSelectionEnabled();
    }
    return feature?.properties?.interactive !== false;
  };

  const getWaterFeatureColor = (featureId) => {
    const resolvedId = String(featureId || "").trim();
    return normalizeHexColor(mapRenderer.getWaterRegionColor(resolvedId)) || "#aadaff";
  };

  const ensureSelectedWaterRegion = () => {
    const current = String(runtimeState.selectedWaterRegionId || "").trim();
    if (current && runtimeState.waterRegionsById?.has(current)) {
      const feature = runtimeState.waterRegionsById.get(current);
      if (isWaterFeatureVisibleInInspector(feature)) {
        return current;
      }
    }
    runtimeState.selectedWaterRegionId = "";
    return "";
  };

  const getVisibleWaterFeatures = () =>
    Array.from(runtimeState.waterRegionsById?.values() || [])
      .filter((feature) => isWaterFeatureVisibleInInspector(feature))
      .sort((a, b) => getWaterFeatureDisplayName(a).localeCompare(getWaterFeatureDisplayName(b)));

  const getWaterFilterValue = (input) => String(input?.value || "").trim().toLowerCase();

  const getFilteredWaterFeatures = () => {
    const term = getWaterSearchTerm();
    const typeFilter = getWaterFilterValue(waterInspectorTypeFilter);
    const groupFilter = getWaterFilterValue(waterInspectorGroupFilter);
    const sourceFilter = getWaterFilterValue(waterInspectorSourceFilter);
    const sortMode = getWaterFilterValue(waterInspectorSortSelect) || "name";
    const overridesOnly = !!waterInspectorOverridesOnlyToggle?.checked;

    const filtered = getVisibleWaterFeatures().filter((feature) => {
      const featureId = getWaterFeatureId(feature).toLowerCase();
      const name = getWaterFeatureDisplayName(feature).toLowerCase();
      const meta = getWaterFeatureMeta(feature).toLowerCase();
      if (term && !name.includes(term) && !featureId.includes(term) && !meta.includes(term)) {
        return false;
      }
      if (typeFilter && getWaterFeatureType(feature) !== typeFilter) return false;
      if (groupFilter && getWaterFeatureGroup(feature) !== groupFilter) return false;
      if (sourceFilter && getWaterFeatureSource(feature) !== sourceFilter) return false;
      if (overridesOnly && !getWaterFeatureHasOverride(getWaterFeatureId(feature))) return false;
      return true;
    });

    filtered.sort((left, right) => {
      if (sortMode === "type") {
        const compare = formatWaterTokenLabel(getWaterFeatureType(left)).localeCompare(
          formatWaterTokenLabel(getWaterFeatureType(right))
        );
        if (compare !== 0) return compare;
      } else if (sortMode === "group") {
        const compare = formatWaterTokenLabel(getWaterFeatureGroup(left)).localeCompare(
          formatWaterTokenLabel(getWaterFeatureGroup(right))
        );
        if (compare !== 0) return compare;
      } else if (sortMode === "override") {
        const compare = Number(getWaterFeatureHasOverride(getWaterFeatureId(right)))
          - Number(getWaterFeatureHasOverride(getWaterFeatureId(left)));
        if (compare !== 0) return compare;
      }
      return getWaterFeatureDisplayName(left).localeCompare(getWaterFeatureDisplayName(right));
    });

    return filtered;
  };

  const populateWaterFilterSelect = (input, values, emptyLabel) => {
    if (!input) return;
    const currentValue = String(input.value || "");
    const nextValues = ["", ...values];
    const signature = JSON.stringify(nextValues);
    if (input.dataset.optionsSignature !== signature) {
      input.replaceChildren();
      nextValues.forEach((value) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value ? formatWaterTokenLabel(value) : t(emptyLabel, "ui") || emptyLabel;
        input.appendChild(option);
      });
      input.dataset.optionsSignature = signature;
    }
    input.value = nextValues.includes(currentValue) ? currentValue : "";
  };

  const getWaterScopeFeatureIds = (selectedId, scope) => {
    const normalizedSelectedId = String(selectedId || "").trim();
    if (!normalizedSelectedId) return [];
    const selectedFeature = runtimeState.waterRegionsById?.get(normalizedSelectedId);
    if (!selectedFeature) return [];
    const filteredFeatures = getFilteredWaterFeatures();
    const selectedGroup = getWaterFeatureGroup(selectedFeature);
    const selectedType = getWaterFeatureType(selectedFeature);
    const selectedParentId = getWaterFeatureParentId(selectedFeature);
    let candidateIds = [];
    switch (scope) {
      case "same-parent":
        if (selectedParentId) {
          candidateIds = filteredFeatures
            .filter((feature) => getWaterFeatureParentId(feature) === selectedParentId)
            .map((feature) => getWaterFeatureId(feature));
        } else {
          candidateIds = filteredFeatures
            .filter((feature) => {
              const featureId = getWaterFeatureId(feature);
              return featureId === normalizedSelectedId || getWaterFeatureParentId(feature) === normalizedSelectedId;
            })
            .map((feature) => getWaterFeatureId(feature));
        }
        break;
      case "same-group":
        candidateIds = filteredFeatures
          .filter((feature) => getWaterFeatureGroup(feature) === selectedGroup)
          .map((feature) => getWaterFeatureId(feature));
        break;
      case "same-type":
        candidateIds = filteredFeatures
          .filter((feature) => getWaterFeatureType(feature) === selectedType)
          .map((feature) => getWaterFeatureId(feature));
        break;
      case "selected":
      default:
        candidateIds = [normalizedSelectedId];
        break;
    }
    if (!candidateIds.includes(normalizedSelectedId)) {
      candidateIds.unshift(normalizedSelectedId);
    }
    return Array.from(new Set(candidateIds.filter(Boolean)));
  };

  const applyWaterOverrideScope = (targetIds, color, kind, dirtyReason) => {
    const nextIds = Array.from(new Set((targetIds || []).map((featureId) => String(featureId || "").trim()).filter(Boolean)));
    if (!nextIds.length) return false;
    const historyBefore = captureHistoryState({ waterRegionIds: nextIds });
    let changed = false;
    nextIds.forEach((featureId) => {
      const currentColor = getWaterFeatureColor(featureId);
      if (currentColor === color) return;
      runtimeState.waterRegionOverrides[featureId] = color;
      changed = true;
    });
    if (!changed) return false;
    pushHistoryEntry({
      kind,
      before: historyBefore,
      after: captureHistoryState({ waterRegionIds: nextIds }),
    });
    markDirty(dirtyReason);
    return true;
  };

  const clearWaterOverrideScope = (targetIds, kind, dirtyReason) => {
    const nextIds = Array.from(new Set((targetIds || []).map((featureId) => String(featureId || "").trim()).filter(Boolean)));
    const activeIds = nextIds.filter((featureId) => getWaterFeatureHasOverride(featureId));
    if (!activeIds.length) return false;
    const historyBefore = captureHistoryState({ waterRegionIds: activeIds });
    activeIds.forEach((featureId) => {
      delete runtimeState.waterRegionOverrides[featureId];
    });
    pushHistoryEntry({
      kind,
      before: historyBefore,
      after: captureHistoryState({ waterRegionIds: activeIds }),
    });
    markDirty(dirtyReason);
    return true;
  };

  const renderWaterInteractionUi = () => {
    syncOpenOceanInspectorState();
    if (waterInspectorOpenOceanSelectToggle) {
      waterInspectorOpenOceanSelectToggle.checked = isOpenOceanSelectionEnabled();
    }
    if (waterInspectorOpenOceanSelectHint) {
      waterInspectorOpenOceanSelectHint.textContent = isOpenOceanSelectionEnabled()
        ? t("Macro ocean regions are currently available in the inspector and map picking.", "ui")
        : t("When off, macro ocean regions stay hidden from inspector selection and map picking.", "ui");
    }
    if (waterInspectorOpenOceanPaintToggle) {
      waterInspectorOpenOceanPaintToggle.checked = isOpenOceanPaintEnabled();
    }
    if (waterInspectorOpenOceanPaintHint) {
      waterInspectorOpenOceanPaintHint.textContent = isOpenOceanPaintEnabled()
        ? t("Macro ocean regions currently accept paint, eraser, and eyedropper actions.", "ui")
        : t("When off, macro ocean regions can be inspected but ignore paint, eraser, and eyedropper actions.", "ui");
    }
  };

  const renderWaterFilterUi = () => {
    const visibleFeatures = getVisibleWaterFeatures();
    populateWaterFilterSelect(
      waterInspectorTypeFilter,
      Array.from(new Set(visibleFeatures.map((feature) => getWaterFeatureType(feature)).filter(Boolean))).sort(),
      "All Types"
    );
    populateWaterFilterSelect(
      waterInspectorGroupFilter,
      Array.from(new Set(visibleFeatures.map((feature) => getWaterFeatureGroup(feature)).filter(Boolean))).sort(),
      "All Groups"
    );
    populateWaterFilterSelect(
      waterInspectorSourceFilter,
      Array.from(new Set(visibleFeatures.map((feature) => getWaterFeatureSource(feature)).filter(Boolean))).sort(),
      "All Sources"
    );
    if (waterInspectorResultCount) {
      const filteredFeatures = getFilteredWaterFeatures();
      const overrideCount = filteredFeatures.filter((feature) => getWaterFeatureHasOverride(getWaterFeatureId(feature))).length;
      waterInspectorResultCount.textContent = `${filteredFeatures.length} ${t("regions", "ui") || "regions"} · ${overrideCount} ${t("overrides", "ui") || "overrides"}`;
    }
  };

  const renderWaterLegend = () => {
    if (!waterLegendList) return;
    waterLegendList.replaceChildren();
    const overrideEntries = Object.entries(runtimeState.waterRegionOverrides || {})
      .map(([featureId, color]) => {
        const feature = runtimeState.waterRegionsById?.get(featureId);
        if (!feature || !isWaterFeatureVisibleInInspector(feature)) return null;
        return {
          featureId,
          feature,
          color: normalizeHexColor(color) || getWaterFeatureColor(featureId),
        };
      })
      .filter(Boolean)
      .sort((a, b) => getWaterFeatureDisplayName(a.feature).localeCompare(getWaterFeatureDisplayName(b.feature)));

    if (!overrideEntries.length) {
      waterLegendList.appendChild(createEmptyNote(t("Paint water regions to create an override list.", "ui")));
      return;
    }

    overrideEntries.forEach(({ featureId, feature, color }) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "scenario-action-card";
      row.addEventListener("click", () => {
        runtimeState.selectedWaterRegionId = featureId;
        waterInspectorSection?.setAttribute("open", "");
        if (typeof runtimeState.renderWaterRegionListFn === "function") {
          runtimeState.renderWaterRegionListFn();
        }
      });

      const copy = document.createElement("div");
      copy.className = "scenario-action-card-copy";

      const title = document.createElement("div");
      title.className = "country-row-title";
      title.textContent = getWaterFeatureDisplayName(feature);

      const meta = document.createElement("div");
      meta.className = "country-select-meta";
      meta.textContent = color.toUpperCase();

      copy.appendChild(title);
      copy.appendChild(meta);

      const actions = document.createElement("div");
      actions.className = "country-row-actions";

      const swatch = document.createElement("span");
      swatch.className = "country-select-swatch";
      swatch.style.backgroundColor = color;
      actions.appendChild(swatch);

      row.appendChild(copy);
      row.appendChild(actions);
      waterLegendList.appendChild(row);
    });
  };

  const renderWaterInspectorDetail = () => {
    if (!waterInspectorEmpty || !waterInspectorSelected) return;
    const selectedId = ensureSelectedWaterRegion();
    const feature = selectedId ? runtimeState.waterRegionsById?.get(selectedId) : null;
    const isEmpty = !feature;

    waterInspectorEmpty.classList.toggle("hidden", !isEmpty);
    waterInspectorSelected.classList.toggle("hidden", isEmpty);

    if (!feature) {
      waterInspectorMetaSection?.classList.add("hidden");
      waterInspectorHierarchySection?.classList.add("hidden");
      waterInspectorBatchSection?.classList.add("hidden");
      if (waterInspectorMetaList) {
        waterInspectorMetaList.replaceChildren();
      }
      if (waterInspectorChildrenList) {
        waterInspectorChildrenList.replaceChildren();
        waterInspectorChildrenList.classList.add("hidden");
      }
      if (waterInspectorScopePreview) {
        waterInspectorScopePreview.classList.add("hidden");
        waterInspectorScopePreview.textContent = "";
      }
      if (waterInspectorJumpToParentBtn) {
        waterInspectorJumpToParentBtn.classList.add("hidden");
      }
      if (waterInspectorColorRow) {
        waterInspectorColorRow.classList.add("hidden");
      }
      if (waterInspectorDetailHint) {
        waterInspectorDetailHint.classList.add("hidden");
        waterInspectorDetailHint.textContent = "";
      }
      if (waterInspectorColorInput) {
        waterInspectorColorInput.disabled = true;
      }
      waterInspectorColorPickerOpen = false;
      scheduleAdaptiveInspectorHeights();
      return;
    }

    const featureColor = getWaterFeatureColor(selectedId);
    const defaultColor = normalizeHexColor(
      mapRenderer.getWaterRegionDefaultFillColorById?.(selectedId)
    ) || featureColor;
    const featureParentId = getWaterFeatureParentId(feature);
    const childFeatures = Array.from(runtimeState.waterRegionsById?.values() || [])
      .filter((candidate) => getWaterFeatureParentId(candidate) === selectedId)
      .sort((left, right) => getWaterFeatureDisplayName(left).localeCompare(getWaterFeatureDisplayName(right)));
    const selectedScope = getWaterFilterValue(waterInspectorScopeSelect) || "selected";
    const scopeIds = getWaterScopeFeatureIds(selectedId, selectedScope);
    if (waterInspectorDetailHint) {
      const meta = [
        getWaterFeatureMeta(feature),
        getWaterFeatureHasOverride(selectedId)
          ? `Override active · ${featureColor.toUpperCase()}`
          : `Default color · ${defaultColor.toUpperCase()}`,
      ].filter(Boolean).join(" · ");
      waterInspectorDetailHint.classList.toggle("hidden", !meta);
      waterInspectorDetailHint.textContent = meta;
    }
    if (waterInspectorMetaSection && waterInspectorMetaList) {
      waterInspectorMetaSection.classList.remove("hidden");
      waterInspectorMetaList.replaceChildren();
      const rows = [
        ["ID", selectedId],
        ["Type", formatWaterTokenLabel(getWaterFeatureType(feature), "Water")],
        ["Group", formatWaterTokenLabel(getWaterFeatureGroup(feature))],
        ["Parent", featureParentId || "None"],
        ["Source", formatWaterTokenLabel(getWaterFeatureSource(feature))],
        ["Interactive", feature?.properties?.interactive === false ? "No" : "Yes"],
        ["Chokepoint", feature?.properties?.is_chokepoint ? "Yes" : "No"],
        ["Base Geography", feature?.properties?.render_as_base_geography ? "Yes" : "No"],
        ["Default Color", defaultColor.toUpperCase()],
        ["Current Color", featureColor.toUpperCase()],
      ];
      rows.forEach(([label, value]) => {
        const key = document.createElement("div");
        key.className = "inspector-meta-label";
        key.textContent = label;
        const val = document.createElement("div");
        val.className = "inspector-meta-value";
        val.textContent = String(value || "");
        waterInspectorMetaList.appendChild(key);
        waterInspectorMetaList.appendChild(val);
      });
    }
    if (waterInspectorHierarchySection) {
      const shouldShowHierarchy = !!featureParentId || childFeatures.length > 0;
      waterInspectorHierarchySection.classList.toggle("hidden", !shouldShowHierarchy);
    }
    if (waterInspectorJumpToParentBtn) {
      if (featureParentId && runtimeState.waterRegionsById?.has(featureParentId)) {
        const parentFeature = runtimeState.waterRegionsById.get(featureParentId);
        waterInspectorJumpToParentBtn.classList.remove("hidden");
        waterInspectorJumpToParentBtn.textContent = `${t("Jump To Parent", "ui")} · ${getWaterFeatureDisplayName(parentFeature)}`;
      } else {
        waterInspectorJumpToParentBtn.classList.add("hidden");
      }
    }
    if (waterInspectorChildrenList) {
      waterInspectorChildrenList.replaceChildren();
      waterInspectorChildrenList.classList.toggle("hidden", childFeatures.length === 0);
      childFeatures.forEach((childFeature) => {
        const childId = getWaterFeatureId(childFeature);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "inspector-item-btn";
        button.addEventListener("click", () => {
          runtimeState.selectedWaterRegionId = childId;
          renderWaterRegionList();
        });
        const copy = document.createElement("div");
        copy.className = "scenario-action-card-copy";
        const title = document.createElement("div");
        title.className = "country-row-title";
        title.textContent = getWaterFeatureDisplayName(childFeature);
        const meta = document.createElement("div");
        meta.className = "country-select-meta";
        meta.textContent = getWaterFeatureMeta(childFeature);
        copy.appendChild(title);
        copy.appendChild(meta);
        button.appendChild(copy);
        waterInspectorChildrenList.appendChild(button);
      });
    }
    if (waterInspectorColorRow) {
      waterInspectorColorRow.classList.remove("hidden");
    }
    if (waterInspectorColorLabel) {
      waterInspectorColorLabel.textContent = t("Water Color", "ui");
    }
    if (waterInspectorColorSwatch) {
      waterInspectorColorSwatch.style.backgroundColor = featureColor;
      waterInspectorColorSwatch.title = `${t("Edit water region color", "ui")}: ${getWaterFeatureDisplayName(feature)} (${featureColor.toUpperCase()})`;
    }
    if (waterInspectorColorValue) {
      waterInspectorColorValue.textContent = featureColor.toUpperCase();
    }
    if (waterInspectorColorInput) {
      waterInspectorColorInput.disabled = false;
      waterInspectorColorInput.value = featureColor;
    }
    if (waterInspectorBatchSection) {
      waterInspectorBatchSection.classList.remove("hidden");
    }
    if (waterInspectorScopePreview) {
      const sampleNames = scopeIds
        .slice(0, 4)
        .map((featureId) => getWaterFeatureDisplayName(runtimeState.waterRegionsById?.get(featureId)))
        .filter(Boolean);
      waterInspectorScopePreview.classList.toggle("hidden", scopeIds.length === 0);
      waterInspectorScopePreview.textContent = scopeIds.length
        ? `${scopeIds.length} regions affected · ${sampleNames.join(", ")}${scopeIds.length > sampleNames.length ? "..." : ""}`
        : "";
    }
    scheduleAdaptiveInspectorHeights();
  };

  const renderWaterRegionList = () => {
    if (!waterRegionList) return;
    renderWaterFilterUi();
    const filteredFeatures = getFilteredWaterFeatures();

    waterRowRefsById.clear();
    waterRegionList.replaceChildren();

    if (!filteredFeatures.length) {
      waterRegionList.appendChild(createEmptyNote(t("No matching water regions", "ui")));
      renderWaterInspectorDetail();
      renderWaterLegend();
      scheduleAdaptiveInspectorHeights();
      return;
    }

    filteredFeatures.forEach((feature) => {
      const featureId = getWaterFeatureId(feature);
      if (!featureId) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "inspector-item-btn";
      button.dataset.regionId = featureId;
      button.dataset.regionScope = "water";
      button.classList.toggle("is-active", featureId === runtimeState.selectedWaterRegionId);
      button.addEventListener("click", () => {
        runtimeState.selectedWaterRegionId = featureId;
        waterInspectorSection?.setAttribute("open", "");
        renderWaterRegionList();
      });

      const name = document.createElement("div");
      name.className = "country-row-title";
      name.textContent = getWaterFeatureDisplayName(feature);

      const meta = document.createElement("div");
      meta.className = "country-select-meta";
      meta.textContent = getWaterFeatureMeta(feature);

      const swatch = document.createElement("span");
      swatch.className = "country-select-swatch";
      swatch.style.backgroundColor = getWaterFeatureColor(featureId);

      const actions = document.createElement("div");
      actions.className = "country-row-actions";
      actions.appendChild(swatch);
      if (getWaterFeatureHasOverride(featureId)) {
        const badge = document.createElement("span");
        badge.className = "country-select-meta";
        badge.textContent = t("Override", "ui");
        actions.appendChild(badge);
      }

      const copy = document.createElement("div");
      copy.className = "scenario-action-card-copy";
      copy.appendChild(name);
      copy.appendChild(meta);

      button.appendChild(copy);
      button.appendChild(actions);
      waterRegionList.appendChild(button);
      waterRowRefsById.set(featureId, button);
    });

    renderWaterInspectorDetail();
    renderWaterLegend();
      updateWorkspaceStatus();
    scheduleAdaptiveInspectorHeights();
  };

  const refreshWaterRegionRows = ({ regionIds = [], refreshInspector = true } = {}) => {
    const ids = Array.from(new Set(
      (Array.isArray(regionIds) ? regionIds : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    ));
    const sortMode = getWaterFilterValue(waterInspectorSortSelect) || "name";
    if (waterInspectorOverridesOnlyToggle?.checked || sortMode === "override") {
      renderWaterRegionList();
      return {
        refreshMode: "full",
        fullRefreshReason: "unstable-row-owner",
        changedIds: ids,
      };
    }
    if (!ids.length) {
      renderWaterRegionList();
      return { refreshMode: "full", fullRefreshReason: "missing-changed-ids", changedIds: [] };
    }
    let needsFullRender = false;
    ids.forEach((featureId) => {
      const feature = runtimeState.waterRegionsById?.get(featureId);
      const row = waterRowRefsById.get(featureId);
      if (!feature || !row) {
        needsFullRender = true;
        return;
      }
      row.dataset.regionId = featureId;
      row.dataset.regionScope = "water";
      row.classList.toggle("is-active", featureId === runtimeState.selectedWaterRegionId);
      const title = row.querySelector(".country-row-title");
      if (title) title.textContent = getWaterFeatureDisplayName(feature);
      const meta = row.querySelector(".country-select-meta");
      if (meta) meta.textContent = getWaterFeatureMeta(feature);
      const actions = row.querySelector(".country-row-actions");
      if (actions) {
        const swatch = document.createElement("span");
        swatch.className = "country-select-swatch";
        swatch.style.backgroundColor = getWaterFeatureColor(featureId);
        actions.replaceChildren(swatch);
        if (getWaterFeatureHasOverride(featureId)) {
          const badge = document.createElement("span");
          badge.className = "country-select-meta";
          badge.textContent = t("Override", "ui");
          actions.appendChild(badge);
        }
      }
    });
    if (needsFullRender) {
      renderWaterRegionList();
      return { refreshMode: "full", fullRefreshReason: "unstable-row-owner", changedIds: ids };
    }
    renderWaterFilterUi();
    if (refreshInspector) {
      renderWaterInspectorDetail();
      renderWaterLegend();
    }
    updateWorkspaceStatus();
    scheduleAdaptiveInspectorHeights();
    return { refreshMode: "row", changedIds: ids };
  };

  const getSpecialFeatureDisplayName = (feature) => {
    return getGeoFeatureDisplayLabel(feature, "Special Region")
      || t("Special Region", "ui")
      || "Special Region";
  };

  const getSpecialFeatureMeta = (feature) => {
    const specialType = String(feature?.properties?.special_type || "special_region")
      .replace(/_/g, " ")
      .trim();
    const regionGroup = String(feature?.properties?.region_group || "").replace(/_/g, " ").trim();
    return [specialType, regionGroup].filter(Boolean).join(" · ");
  };

  const getSpecialFeatureFallbackColor = (feature) => {
    const specialType = String(feature?.properties?.special_type || "").trim().toLowerCase();
    if (specialType === "salt_flat") return "#d7c6a3";
    if (specialType === "wasteland") return "#bf8f74";
    return "#d6c19a";
  };

  const isSpecialFeatureVisibleInInspector = (feature) =>
    !!feature && !!runtimeState.activeScenarioId && !!runtimeState.showScenarioSpecialRegions && feature?.properties?.interactive !== false;

  const getSpecialFeatureColor = (featureId, feature = null) => {
    const resolvedId = String(featureId || "").trim();
    return (
      normalizeHexColor(runtimeState.specialRegionOverrides?.[resolvedId]) ||
      getSpecialFeatureFallbackColor(feature || runtimeState.specialRegionsById?.get(resolvedId))
    );
  };

  const ensureSelectedSpecialRegion = () => {
    const current = String(runtimeState.selectedSpecialRegionId || "").trim();
    if (current && runtimeState.specialRegionsById?.has(current)) {
      const feature = runtimeState.specialRegionsById.get(current);
      if (isSpecialFeatureVisibleInInspector(feature)) {
        return current;
      }
    }
    runtimeState.selectedSpecialRegionId = "";
    return "";
  };

  const getVisibleSpecialFeatures = () =>
    Array.from(runtimeState.specialRegionsById?.values() || [])
      .filter((feature) => isSpecialFeatureVisibleInInspector(feature))
      .sort((a, b) => getSpecialFeatureDisplayName(a).localeCompare(getSpecialFeatureDisplayName(b)));

  const renderSpecialRegionInspectorUi = () => {
    const hasScenarioSpecialRegions = !!runtimeState.activeScenarioId && (runtimeState.specialRegionsById?.size || 0) > 0;
    const hasScenarioReliefOverlays =
      !!runtimeState.activeScenarioId &&
      (Array.isArray(runtimeState.scenarioReliefOverlaysData?.features) ? runtimeState.scenarioReliefOverlaysData.features.length : 0) > 0;
    const hasScenarioInspectorContent = hasScenarioSpecialRegions || hasScenarioReliefOverlays;
    const selectedSpecialRegionId = ensureSelectedSpecialRegion();
    if (specialRegionInspectorSection) {
      specialRegionInspectorSection.classList.toggle("hidden", !hasScenarioInspectorContent);
    }
    if (scenarioSpecialRegionVisibilityToggle) {
      scenarioSpecialRegionVisibilityToggle.checked = !!runtimeState.showScenarioSpecialRegions;
    }
    scenarioSpecialRegionVisibilityHint?.classList.add("hidden");
    if (scenarioReliefOverlayVisibilityToggle) {
      scenarioReliefOverlayVisibilityToggle.checked = !!runtimeState.showScenarioReliefOverlays;
    }
    scenarioReliefOverlayVisibilityHint?.classList.add("hidden");
  };

  const renderSpecialRegionLegend = () => {
    if (!specialRegionLegendList) return;
    specialRegionLegendList.replaceChildren();
    const overrideEntries = Object.entries(runtimeState.specialRegionOverrides || {})
      .map(([featureId, color]) => {
        const feature = runtimeState.specialRegionsById?.get(featureId);
        if (!feature || !isSpecialFeatureVisibleInInspector(feature)) return null;
        return {
          featureId,
          feature,
          color: normalizeHexColor(color) || getSpecialFeatureColor(featureId, feature),
        };
      })
      .filter(Boolean)
      .sort((a, b) => getSpecialFeatureDisplayName(a.feature).localeCompare(getSpecialFeatureDisplayName(b.feature)));

    if (!overrideEntries.length) {
      specialRegionLegendList.appendChild(
        createEmptyNote(t("Paint special regions to create an override list.", "ui"))
      );
      return;
    }

    overrideEntries.forEach(({ featureId, feature, color }) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "scenario-action-card";
      row.addEventListener("click", () => {
        runtimeState.selectedSpecialRegionId = featureId;
        specialRegionInspectorSection?.setAttribute("open", "");
        renderSpecialRegionList();
      });

      const copy = document.createElement("div");
      copy.className = "scenario-action-card-copy";

      const title = document.createElement("div");
      title.className = "country-row-title";
      title.textContent = getSpecialFeatureDisplayName(feature);

      const meta = document.createElement("div");
      meta.className = "country-select-meta";
      meta.textContent = color.toUpperCase();

      copy.appendChild(title);
      copy.appendChild(meta);

      const actions = document.createElement("div");
      actions.className = "country-row-actions";

      const swatch = document.createElement("span");
      swatch.className = "country-select-swatch";
      swatch.style.backgroundColor = color;
      actions.appendChild(swatch);

      row.appendChild(copy);
      row.appendChild(actions);
      specialRegionLegendList.appendChild(row);
    });
  };

  const renderSpecialRegionInspectorDetail = () => {
    if (!specialRegionInspectorEmpty || !specialRegionInspectorSelected) return;
    const selectedId = ensureSelectedSpecialRegion();
    const feature = selectedId ? runtimeState.specialRegionsById?.get(selectedId) : null;
    const isEmpty = !feature;

    specialRegionInspectorEmpty.classList.toggle("hidden", !isEmpty);
    specialRegionInspectorSelected.classList.toggle("hidden", isEmpty);

    if (!feature) {
      if (specialRegionColorRow) specialRegionColorRow.classList.add("hidden");
      if (specialRegionInspectorDetailHint) {
        specialRegionInspectorDetailHint.classList.add("hidden");
        specialRegionInspectorDetailHint.textContent = "";
      }
      if (specialRegionColorInput) {
        specialRegionColorInput.disabled = true;
      }
      specialRegionColorPickerOpen = false;
      scheduleAdaptiveInspectorHeights();
      return;
    }

    const featureColor = getSpecialFeatureColor(selectedId, feature);
    if (specialRegionInspectorDetailHint) {
      const meta = getSpecialFeatureMeta(feature);
      specialRegionInspectorDetailHint.classList.toggle("hidden", !meta);
      specialRegionInspectorDetailHint.textContent = meta;
    }
    if (specialRegionColorRow) {
      specialRegionColorRow.classList.remove("hidden");
    }
    if (specialRegionColorLabel) {
      specialRegionColorLabel.textContent = t("Special Region Color", "ui");
    }
    if (specialRegionColorSwatch) {
      specialRegionColorSwatch.style.backgroundColor = featureColor;
      specialRegionColorSwatch.title =
        `${t("Edit special region color", "ui")}: ${getSpecialFeatureDisplayName(feature)} (${featureColor.toUpperCase()})`;
    }
    if (specialRegionColorValue) {
      specialRegionColorValue.textContent = featureColor.toUpperCase();
    }
    if (specialRegionColorInput) {
      specialRegionColorInput.disabled = false;
      specialRegionColorInput.value = featureColor;
    }
    scheduleAdaptiveInspectorHeights();
  };

  const renderSpecialRegionList = () => {
    if (!specialRegionList) return;
    renderSpecialRegionInspectorUi();
    specialRegionRowRefsById.clear();
    specialRegionList.replaceChildren();

    const term = (specialRegionSearchInput?.value || "").trim().toLowerCase();
    const features = getVisibleSpecialFeatures();

    if (!features.length) {
      specialRegionList.appendChild(createEmptyNote(t("No special regions available", "ui")));
      renderSpecialRegionInspectorDetail();
      renderSpecialRegionLegend();
      scheduleAdaptiveInspectorHeights();
      return;
    }

    const filteredFeatures = term
      ? features.filter((feature) => {
        const name = getSpecialFeatureDisplayName(feature).toLowerCase();
        const rawId = String(feature?.properties?.id || feature?.id || "").toLowerCase();
        const meta = getSpecialFeatureMeta(feature).toLowerCase();
        return name.includes(term) || rawId.includes(term) || meta.includes(term);
      })
      : features;

    if (!filteredFeatures.length) {
      specialRegionList.appendChild(createEmptyNote(t("No matching special regions", "ui")));
      renderSpecialRegionInspectorDetail();
      renderSpecialRegionLegend();
      scheduleAdaptiveInspectorHeights();
      return;
    }

    filteredFeatures.forEach((feature) => {
      const featureId = String(feature?.properties?.id || feature?.id || "").trim();
      if (!featureId) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "inspector-item-btn";
      button.dataset.regionId = featureId;
      button.dataset.regionScope = "special";
      button.classList.toggle("is-active", featureId === runtimeState.selectedSpecialRegionId);
      button.addEventListener("click", () => {
        runtimeState.selectedSpecialRegionId = featureId;
        specialRegionInspectorSection?.setAttribute("open", "");
        renderSpecialRegionList();
      });

      const name = document.createElement("div");
      name.className = "country-row-title";
      name.textContent = getSpecialFeatureDisplayName(feature);

      const meta = document.createElement("div");
      meta.className = "country-select-meta";
      meta.textContent = getSpecialFeatureMeta(feature);

      const swatch = document.createElement("span");
      swatch.className = "country-select-swatch";
      swatch.style.backgroundColor = getSpecialFeatureColor(featureId, feature);

      const actions = document.createElement("div");
      actions.className = "country-row-actions";
      actions.appendChild(swatch);

      const copy = document.createElement("div");
      copy.className = "scenario-action-card-copy";
      copy.appendChild(name);
      copy.appendChild(meta);

      button.appendChild(copy);
      button.appendChild(actions);
      specialRegionList.appendChild(button);
      specialRegionRowRefsById.set(featureId, button);
    });

    renderSpecialRegionInspectorDetail();
    renderSpecialRegionLegend();
    updateWorkspaceStatus();
    scheduleAdaptiveInspectorHeights();
  };

  const refreshSpecialRegionRows = ({ regionIds = [], refreshInspector = true } = {}) => {
    const ids = Array.from(new Set(
      (Array.isArray(regionIds) ? regionIds : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    ));
    if (!ids.length) {
      renderSpecialRegionList();
      return { refreshMode: "full", fullRefreshReason: "missing-changed-ids", changedIds: [] };
    }
    let needsFullRender = false;
    ids.forEach((featureId) => {
      const feature = runtimeState.specialRegionsById?.get(featureId);
      const row = specialRegionRowRefsById.get(featureId);
      if (!feature || !row) {
        needsFullRender = true;
        return;
      }
      row.dataset.regionId = featureId;
      row.dataset.regionScope = "special";
      row.classList.toggle("is-active", featureId === runtimeState.selectedSpecialRegionId);
      const title = row.querySelector(".country-row-title");
      if (title) title.textContent = getSpecialFeatureDisplayName(feature);
      const meta = row.querySelector(".country-select-meta");
      if (meta) meta.textContent = getSpecialFeatureMeta(feature);
      const swatch = row.querySelector(".country-select-swatch");
      if (swatch) swatch.style.backgroundColor = getSpecialFeatureColor(featureId, feature);
    });
    if (needsFullRender) {
      renderSpecialRegionList();
      return { refreshMode: "full", fullRefreshReason: "unstable-row-owner", changedIds: ids };
    }
    if (refreshInspector) {
      renderSpecialRegionInspectorDetail();
      renderSpecialRegionLegend();
    }
    updateWorkspaceStatus();
    scheduleAdaptiveInspectorHeights();
    return { refreshMode: "row", changedIds: ids };
  };


  const bindEvents = () => {
  if (waterInspectorOpenOceanSelectToggle && !waterInspectorOpenOceanSelectToggle.dataset.bound) {
    waterInspectorOpenOceanSelectToggle.addEventListener("change", (event) => {
      runtimeState.allowOpenOceanSelect = !!event.target.checked;
      syncOpenOceanInspectorState();
      if (!runtimeState.showOpenOceanRegions) {
        runtimeState.hoveredWaterRegionId = null;
      }
      markDirty("toggle-open-ocean-select");
      renderWaterInteractionUi();
      renderWaterRegionList();
      updateSpecialZoneEditorUi();
      if (render) render();
    });
    waterInspectorOpenOceanSelectToggle.dataset.bound = "true";
  }

  if (waterInspectorOpenOceanPaintToggle && !waterInspectorOpenOceanPaintToggle.dataset.bound) {
    waterInspectorOpenOceanPaintToggle.addEventListener("change", (event) => {
      runtimeState.allowOpenOceanPaint = !!event.target.checked;
      syncOpenOceanInspectorState();
      if (!runtimeState.showOpenOceanRegions) {
        runtimeState.hoveredWaterRegionId = null;
      }
      markDirty("toggle-open-ocean-paint");
      renderWaterInteractionUi();
      renderWaterRegionList();
      updateSpecialZoneEditorUi();
      if (render) render();
    });
    waterInspectorOpenOceanPaintToggle.dataset.bound = "true";
  }

  [
    waterInspectorOverridesOnlyToggle,
    waterInspectorTypeFilter,
    waterInspectorGroupFilter,
    waterInspectorSourceFilter,
    waterInspectorSortSelect,
  ].filter(Boolean).forEach((input) => {
    if (input.dataset.bound) return;
    input.addEventListener("change", () => {
      renderWaterRegionList();
    });
    input.dataset.bound = "true";
  });

  if (scenarioSpecialRegionVisibilityToggle && !scenarioSpecialRegionVisibilityToggle.dataset.bound) {
    scenarioSpecialRegionVisibilityToggle.addEventListener("change", (event) => {
      runtimeState.showScenarioSpecialRegions = !!event.target.checked;
      if (!runtimeState.showScenarioSpecialRegions) {
        runtimeState.hoveredSpecialRegionId = null;
      }
      if (runtimeState.showScenarioSpecialRegions) {
        void ensureActiveScenarioOptionalLayerLoaded("special", { renderNow: true });
      }
      markDirty("toggle-scenario-special-regions");
      renderSpecialRegionInspectorUi();
      renderSpecialRegionList();
      if (render) render();
    });
    scenarioSpecialRegionVisibilityToggle.dataset.bound = "true";
  }

  if (scenarioReliefOverlayVisibilityToggle && !scenarioReliefOverlayVisibilityToggle.dataset.bound) {
    scenarioReliefOverlayVisibilityToggle.addEventListener("change", (event) => {
      runtimeState.showScenarioReliefOverlays = !!event.target.checked;
      if (runtimeState.showScenarioReliefOverlays) {
        void ensureActiveScenarioOptionalLayerLoaded("relief", { renderNow: true });
      }
      markDirty("toggle-scenario-relief-overlays");
      renderSpecialRegionInspectorUi();
      if (render) render();
    });
    scenarioReliefOverlayVisibilityToggle.dataset.bound = "true";
  }

  if (waterInspectorColorSwatch && waterInspectorColorInput && !waterInspectorColorSwatch.dataset.bound) {
    waterInspectorColorSwatch.addEventListener("click", () => {
      waterInspectorColorPickerOpen = true;
      waterInspectorColorInput.focus({ preventScroll: true });
      if (typeof waterInspectorColorInput.showPicker === "function") {
        waterInspectorColorInput.showPicker();
      } else {
        waterInspectorColorInput.click();
      }
    });
    waterInspectorColorSwatch.dataset.bound = "true";
  }

  if (waterInspectorColorInput && !waterInspectorColorInput.dataset.bound) {
    waterInspectorColorInput.addEventListener("change", (event) => {
      const selectedId = ensureSelectedWaterRegion();
      if (!selectedId) return;
      const nextColor = normalizeHexColor(event.target.value);
      const currentColor = getWaterFeatureColor(selectedId);
      if (!nextColor || nextColor === currentColor) {
        closeWaterInspectorColorPicker();
        renderWaterRegionList();
        return;
      }
      const historyBefore = captureHistoryState({ waterRegionIds: [selectedId] });
      runtimeState.waterRegionOverrides[selectedId] = nextColor;
      pushHistoryEntry({
        kind: "inspector-water-region-color",
        before: historyBefore,
        after: captureHistoryState({ waterRegionIds: [selectedId] }),
      });
      markDirty("inspector-water-region-color");
      if (render) render();
      closeWaterInspectorColorPicker();
      renderWaterRegionList();
    });
    waterInspectorColorInput.addEventListener("blur", () => {
      waterInspectorColorPickerOpen = false;
    });
    waterInspectorColorInput.dataset.bound = "true";
  }

  if (clearWaterRegionColorBtn && !clearWaterRegionColorBtn.dataset.bound) {
    clearWaterRegionColorBtn.addEventListener("click", () => {
      const selectedId = ensureSelectedWaterRegion();
      if (!selectedId) return;
      if (!Object.prototype.hasOwnProperty.call(runtimeState.waterRegionOverrides || {}, selectedId)) {
        return;
      }
      const historyBefore = captureHistoryState({ waterRegionIds: [selectedId] });
      delete runtimeState.waterRegionOverrides[selectedId];
      pushHistoryEntry({
        kind: "clear-water-region-color",
        before: historyBefore,
        after: captureHistoryState({ waterRegionIds: [selectedId] }),
      });
      markDirty("clear-water-region-color");
      if (render) render();
      renderWaterRegionList();
    });
    clearWaterRegionColorBtn.dataset.bound = "true";
  }

  if (waterInspectorJumpToParentBtn && !waterInspectorJumpToParentBtn.dataset.bound) {
    waterInspectorJumpToParentBtn.addEventListener("click", () => {
      const selectedId = ensureSelectedWaterRegion();
      const feature = selectedId ? runtimeState.waterRegionsById?.get(selectedId) : null;
      const parentId = getWaterFeatureParentId(feature);
      if (!parentId || !runtimeState.waterRegionsById?.has(parentId)) return;
      runtimeState.selectedWaterRegionId = parentId;
      renderWaterRegionList();
    });
    waterInspectorJumpToParentBtn.dataset.bound = "true";
  }

  if (waterInspectorScopeSelect && !waterInspectorScopeSelect.dataset.bound) {
    waterInspectorScopeSelect.addEventListener("change", () => {
      renderWaterInspectorDetail();
    });
    waterInspectorScopeSelect.dataset.bound = "true";
  }

  if (applyWaterFamilyOverrideBtn && !applyWaterFamilyOverrideBtn.dataset.bound) {
    applyWaterFamilyOverrideBtn.addEventListener("click", () => {
      const selectedId = ensureSelectedWaterRegion();
      if (!selectedId) return;
      const scope = getWaterFilterValue(waterInspectorScopeSelect) || "selected";
      const targetIds = getWaterScopeFeatureIds(selectedId, scope);
      if (!targetIds.length) return;
      const color = getWaterFeatureColor(selectedId);
      if (!applyWaterOverrideScope(targetIds, color, "batch-water-region-color", "batch-water-region-color")) {
        return;
      }
      if (render) render();
      renderWaterRegionList();
    });
    applyWaterFamilyOverrideBtn.dataset.bound = "true";
  }

  if (clearWaterFamilyOverrideBtn && !clearWaterFamilyOverrideBtn.dataset.bound) {
    clearWaterFamilyOverrideBtn.addEventListener("click", () => {
      const selectedId = ensureSelectedWaterRegion();
      if (!selectedId) return;
      const scope = getWaterFilterValue(waterInspectorScopeSelect) || "selected";
      const targetIds = getWaterScopeFeatureIds(selectedId, scope);
      if (!targetIds.length) return;
      if (!clearWaterOverrideScope(targetIds, "clear-batch-water-region-color", "clear-batch-water-region-color")) {
        return;
      }
      if (render) render();
      renderWaterRegionList();
    });
    clearWaterFamilyOverrideBtn.dataset.bound = "true";
  }

  if (specialRegionSearchInput && !specialRegionSearchInput.dataset.bound) {
    specialRegionSearchInput.addEventListener("input", () => {
      renderSpecialRegionList();
    });
    specialRegionSearchInput.dataset.bound = "true";
  }

  if (specialRegionColorSwatch && specialRegionColorInput && !specialRegionColorSwatch.dataset.bound) {
    specialRegionColorSwatch.addEventListener("click", () => {
      specialRegionColorPickerOpen = true;
      specialRegionColorInput.focus({ preventScroll: true });
      if (typeof specialRegionColorInput.showPicker === "function") {
        specialRegionColorInput.showPicker();
      } else {
        specialRegionColorInput.click();
      }
    });
    specialRegionColorSwatch.dataset.bound = "true";
  }

  if (specialRegionColorInput && !specialRegionColorInput.dataset.bound) {
    specialRegionColorInput.addEventListener("change", (event) => {
      const selectedId = ensureSelectedSpecialRegion();
      if (!selectedId) return;
      const nextColor = normalizeHexColor(event.target.value);
      const currentColor = getSpecialFeatureColor(selectedId);
      if (!nextColor || nextColor === currentColor) {
        closeSpecialRegionColorPicker();
        renderSpecialRegionList();
        return;
      }
      const historyBefore = captureHistoryState({ specialRegionIds: [selectedId] });
      runtimeState.specialRegionOverrides[selectedId] = nextColor;
      pushHistoryEntry({
        kind: "inspector-special-region-color",
        before: historyBefore,
        after: captureHistoryState({ specialRegionIds: [selectedId] }),
      });
      markDirty("inspector-special-region-color");
      if (render) render();
      closeSpecialRegionColorPicker();
      renderSpecialRegionList();
    });
    specialRegionColorInput.addEventListener("blur", () => {
      specialRegionColorPickerOpen = false;
    });
    specialRegionColorInput.dataset.bound = "true";
  }

  if (clearSpecialRegionColorBtn && !clearSpecialRegionColorBtn.dataset.bound) {
    clearSpecialRegionColorBtn.addEventListener("click", () => {
      const selectedId = ensureSelectedSpecialRegion();
      if (!selectedId) return;
      if (!Object.prototype.hasOwnProperty.call(runtimeState.specialRegionOverrides || {}, selectedId)) {
        return;
      }
      const historyBefore = captureHistoryState({ specialRegionIds: [selectedId] });
      delete runtimeState.specialRegionOverrides[selectedId];
      pushHistoryEntry({
        kind: "clear-special-region-color",
        before: historyBefore,
        after: captureHistoryState({ specialRegionIds: [selectedId] }),
      });
      markDirty("clear-special-region-color");
      if (render) render();
      renderSpecialRegionList();
    });
    clearSpecialRegionColorBtn.dataset.bound = "true";
  }

  if (waterSearchInput && !waterSearchInput.dataset.bound) {
    waterSearchInput.addEventListener("input", () => {
      renderWaterRegionList();
    });
    waterSearchInput.dataset.bound = "true";
  }

  };

  return {
    bindEvents,
    closeSpecialRegionColorPicker,
    closeWaterInspectorColorPicker,
    renderSpecialRegionInspectorUi,
    renderSpecialRegionList,
    refreshSpecialRegionRows,
    renderWaterInteractionUi,
    renderWaterRegionList,
    refreshWaterRegionRows,
  };
}
