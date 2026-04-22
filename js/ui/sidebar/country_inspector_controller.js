/**
 * Owns the country inspector explorer panel:
 * - country list rendering
 * - search/grouped explorer rendering
 * - selected country detail rendering
 * - active owner / color picker interactions
 *
 * sidebar.js keeps the higher-level facade:
 * - scenario action/preset tree
 * - cross-panel orchestration
 * - runtimeState callback registration
 * - shared scenario/releasable domain helpers
 */
export function createCountryInspectorController({
  runtimeState,
  list,
  searchInput,
  selectedCountryActionsSection,
  countryInspectorDetail,
  countryInspectorSelected,
  countryInspectorSetActive,
  countryInspectorDetailHint,
  countryInspectorColorRow,
  countryInspectorColorSwatch,
  countryInspectorColorInput,
  countryRowRefsByCode,
  getLatestCountryStatesByCode,
  setLatestCountryStatesByCode,
  getCountryInspectorColorPickerOpen,
  setCountryInspectorColorPickerOpen,
  t,
  normalizeCountryCode,
  normalizeHexColor,
  updateScenarioInspectorLayout,
  scheduleAdaptiveInspectorHeights,
  flushSidebarRender,
  createEmptyNote,
  getDynamicCountryEntries,
  createCountryInspectorState,
  buildInspectorTopLevelCountryEntries,
  getPriorityCountryOrderMap,
  compareInspectorCountries,
  buildCountryColorTree,
  ensureInitialInspectorExpansion,
  getInspectorGroupExpansionKey,
  getCountryChildSectionsForParent,
  buildCountryRowMetaText,
  getResolvedCountryColor,
  getDisplayCountryColor,
  getPrimaryReleasablePresetRef,
  applyScenarioReleasableCoreTerritory,
  applyCountryColor,
  incrementSidebarCounter,
  markDirty,
  showToast,
}) {
  const getSearchTerm = () => (searchInput?.value || "").trim().toLowerCase();

  const registerCountryRowRef = (countryCode, ref) => {
    const normalized = normalizeCountryCode(countryCode);
    if (!normalized || !ref) return;
    const refs = countryRowRefsByCode.get(normalized) || [];
    refs.push(ref);
    countryRowRefsByCode.set(normalized, refs);
  };

  const positionCountryInspectorColorAnchor = () => {
    if (!countryInspectorColorInput || !countryInspectorColorSwatch) return;
    const rect = countryInspectorColorSwatch.getBoundingClientRect();
    countryInspectorColorInput.style.left = `${Math.round(rect.left + rect.width / 2)}px`;
    countryInspectorColorInput.style.top = `${Math.round(rect.top + rect.height / 2)}px`;
  };

  const closeCountryInspectorColorPicker = () => {
    if (!countryInspectorColorInput) return;
    setCountryInspectorColorPickerOpen(false);
    countryInspectorColorInput.blur();
  };

  const syncCountryRowVisuals = (ref, countryState) => {
    if (!ref || !countryState) return;
    const isSelected = runtimeState.selectedInspectorCountryCode === countryState.code;
    const isActiveOwner = runtimeState.activeSovereignCode === countryState.code;
    ref.row?.classList.toggle("is-selected", isSelected);
    ref.row?.classList.toggle("is-active-owner", isActiveOwner);
    ref.wrapper?.classList.toggle("is-selected", isSelected);
    ref.wrapper?.classList.toggle("is-active-owner", isActiveOwner);
    if (ref.main) {
      ref.main.setAttribute("aria-pressed", String(isSelected));
    }
    if (ref.swatch) {
      ref.swatch.style.backgroundColor = getResolvedCountryColor(countryState);
    }
    if (ref.title) {
      ref.title.textContent = `${countryState.displayName} (${countryState.code})`;
    }
    if (ref.meta) {
      ref.meta.textContent = buildCountryRowMetaText(countryState, {
        showRelationMeta: !!ref.showRelationMeta,
      });
    }
  };

  const ensureSelectedInspectorCountry = () => {
    const latestCountryStatesByCode = getLatestCountryStatesByCode();
    const normalized = normalizeCountryCode(runtimeState.selectedInspectorCountryCode);
    const resolved = normalized && latestCountryStatesByCode.has(normalized)
      ? normalized
      : "";

    runtimeState.selectedInspectorCountryCode = resolved;
    runtimeState.inspectorHighlightCountryCode = resolved;
    return resolved;
  };

  const selectInspectorCountry = (code) => {
    const normalized = normalizeCountryCode(code);
    if (!normalized) return;
    const latestCountryStatesByCode = getLatestCountryStatesByCode();
    const previousSelectedCode = normalizeCountryCode(runtimeState.selectedInspectorCountryCode);
    const countryState = latestCountryStatesByCode.get(normalized);
    let requiresListRebuild = false;
    if (countryState?.topLevelGroupId) {
      const groupKey = getInspectorGroupExpansionKey(countryState.topLevelGroupId);
      if (!runtimeState.expandedInspectorContinents.has(groupKey)) {
        runtimeState.expandedInspectorContinents.add(groupKey);
        requiresListRebuild = true;
      }
    }
    if (countryState?.releasable && countryState.parentOwnerTag && runtimeState.expandedInspectorReleaseParents instanceof Set) {
      if (!runtimeState.expandedInspectorReleaseParents.has(countryState.parentOwnerTag)) {
        runtimeState.expandedInspectorReleaseParents.add(countryState.parentOwnerTag);
        requiresListRebuild = true;
      }
    }
    runtimeState.selectedInspectorCountryCode = normalized;
    runtimeState.inspectorHighlightCountryCode = normalized;
    if (selectedCountryActionsSection) {
      selectedCountryActionsSection.open = true;
    }
    if (typeof runtimeState.updatePaintModeUIFn === "function") {
      runtimeState.updatePaintModeUIFn();
    }
    flushSidebarRender(`sidebar-inspector-country:${normalized}`);
    if (requiresListRebuild) {
      renderList();
      return;
    }
    refreshCountryRows({
      countryCodes: [previousSelectedCode, normalized],
      refreshInspector: true,
    });
  };

  const renderCountrySelectRow = (
    parent,
    countryState,
    {
      childStates = [],
      childSections = null,
      forceExpanded = false,
      hideExpandToggle = false,
      showRelationMeta = false,
    } = {}
  ) => {
    const normalizedChildSections = Array.isArray(childSections)
      ? childSections
      : (Array.isArray(childStates) && childStates.length
        ? [{ id: "children", label: "", states: childStates }]
        : []);
    const childCount = normalizedChildSections.reduce(
      (sum, section) => sum + (Array.isArray(section?.states) ? section.states.length : 0),
      0
    );
    const hasChildren = childCount > 0;
    const isActiveOwner = runtimeState.activeSovereignCode === countryState.code;
    const hasReleasableActivateAction = !!(
      runtimeState.activeScenarioId &&
      countryState.releasable &&
      getPrimaryReleasablePresetRef(countryState)
    );
    const isExpanded = hasChildren && (
      forceExpanded ||
      runtimeState.expandedInspectorReleaseParents.has(countryState.code)
    );

    const row = document.createElement("div");
    row.className = "country-select-row";
    row.dataset.countryCode = countryState.code;
    const isSelected = runtimeState.selectedInspectorCountryCode === countryState.code;
    row.classList.toggle("is-selected", isSelected);
    row.classList.toggle("is-active-owner", isActiveOwner);
    row.classList.toggle("has-children", hasChildren);

    const main = document.createElement("button");
    main.type = "button";
    main.className = "country-select-main country-select-main-btn";
    main.setAttribute("aria-pressed", String(isSelected));
    main.addEventListener("click", () => {
      selectInspectorCountry(countryState.code);
    });

    const title = document.createElement("div");
    title.className = "country-select-title";
    title.textContent = `${countryState.displayName} (${countryState.code})`;

    const meta = document.createElement("div");
    meta.className = "country-select-meta";
    meta.textContent = buildCountryRowMetaText(countryState, { showRelationMeta });

    const side = document.createElement("div");
    side.className = "country-select-side";

    if (hasChildren) {
      const corner = document.createElement("div");
      corner.className = "country-select-corner";
      const countBadge = document.createElement("span");
      countBadge.className = "country-children-count";
      countBadge.textContent = String(childCount);
      corner.appendChild(countBadge);

      if (!hideExpandToggle) {
        const toggleBtn = document.createElement("button");
        toggleBtn.type = "button";
        toggleBtn.className = "country-action-btn country-children-toggle";
        toggleBtn.textContent = isExpanded ? "v" : ">";
        toggleBtn.setAttribute("aria-label", `${childCount} ${t("Related Countries", "ui")}`);
        toggleBtn.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (runtimeState.expandedInspectorReleaseParents.has(countryState.code)) {
            runtimeState.expandedInspectorReleaseParents.delete(countryState.code);
          } else {
            runtimeState.expandedInspectorReleaseParents.add(countryState.code);
          }
          renderList();
        });
        corner.appendChild(toggleBtn);
      }
      side.appendChild(corner);
    }

    const swatch = document.createElement("span");
    swatch.className = "country-select-swatch";
    swatch.style.backgroundColor = getResolvedCountryColor(countryState);

    main.appendChild(title);
    main.appendChild(meta);
    row.appendChild(main);

    side.appendChild(swatch);
    row.appendChild(side);

    if (!hasChildren && !hasReleasableActivateAction) {
      registerCountryRowRef(countryState.code, {
        row,
        wrapper: null,
        main,
        swatch,
        title,
        meta,
        showRelationMeta,
      });
      parent.appendChild(row);
      return;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "country-explorer-group country-select-card";
    wrapper.dataset.countryCode = countryState.code;
    if (hasReleasableActivateAction) {
      wrapper.classList.add("has-subaction");
    }
    wrapper.classList.toggle("is-active-owner", isActiveOwner);
    wrapper.classList.toggle("is-selected", isSelected);
    wrapper.appendChild(row);

    if (hasReleasableActivateAction) {
      const activateStrip = document.createElement("button");
      activateStrip.type = "button";
      activateStrip.className = "country-select-subaction";
      activateStrip.textContent = t("Activate Releasable", "ui");
      activateStrip.title = t("Apply this releasable's political ownership and make it active.", "ui");
      activateStrip.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        applyScenarioReleasableCoreTerritory(countryState, {
          source: "scenario-row-activate",
          forceSovereignty: true,
        });
      });
      wrapper.appendChild(activateStrip);
    }

    if (isExpanded) {
      const childList = document.createElement("div");
      childList.className = "country-children";
      normalizedChildSections.forEach((section) => {
        if (section?.label) {
          const sectionLabel = document.createElement("div");
          sectionLabel.className = "inspector-mini-label";
          sectionLabel.textContent = section.label;
          childList.appendChild(sectionLabel);
        }
        (Array.isArray(section?.states) ? section.states : []).forEach((childState) => {
          renderCountrySelectRow(childList, childState, {
            showRelationMeta: true,
          });
        });
      });
      wrapper.appendChild(childList);
    }
    registerCountryRowRef(countryState.code, {
      row,
      wrapper,
      main,
      swatch,
      title,
      meta,
      showRelationMeta,
    });
    parent.appendChild(wrapper);
  };

  const getCountrySearchRank = (countryState, term, upperTerm) => {
    const displayName = String(countryState?.displayName || "").trim().toLowerCase();
    const name = String(countryState?.name || "").trim().toLowerCase();
    const code = String(countryState?.code || "").trim().toUpperCase();
    const subregion = String(countryState?.subregionDisplayLabel || "").trim().toLowerCase();
    const continent = String(countryState?.continentDisplayLabel || "").trim().toLowerCase();
    if (!displayName && !name && !code) return null;
    if (!(displayName.includes(term) || name.includes(term) || code.includes(upperTerm) || subregion.includes(term) || continent.includes(term))) {
      return null;
    }
    if (code === upperTerm) return 0;
    if (displayName === term || name === term) return 1;
    if (displayName.startsWith(term) || name.startsWith(term)) return 2;
    if (code.startsWith(upperTerm)) return 3;
    if (subregion.startsWith(term) || continent.startsWith(term)) return 4;
    return 5;
  };

  const buildInspectorSearchGroups = (countryStates, term, priorityOrderMap) => {
    const latestCountryStatesByCode = getLatestCountryStatesByCode();
    const upperTerm = String(term || "").trim().toUpperCase();
    const groupsByParentCode = new Map();

    const ensureSearchGroup = (parentState) => {
      const parentCode = normalizeCountryCode(parentState?.code);
      if (!parentCode) return null;
      if (!groupsByParentCode.has(parentCode)) {
        groupsByParentCode.set(parentCode, {
          parentState,
          parentMatched: false,
          parentSearchRank: null,
          matchedChildCodes: new Set(),
          bestRank: Number.MAX_SAFE_INTEGER,
        });
      }
      return groupsByParentCode.get(parentCode);
    };

    countryStates.forEach((countryState) => {
      const searchRank = getCountrySearchRank(countryState, term, upperTerm);
      if (searchRank === null) return;

      if (!countryState.releasable) {
        const group = ensureSearchGroup(countryState);
        if (!group) return;
        group.parentMatched = true;
        group.parentSearchRank = searchRank;
        group.bestRank = Math.min(group.bestRank, searchRank);
        return;
      }

      const parentState = (countryState.releasable || countryState.scenarioSubject) && countryState.parentOwnerTag
        ? latestCountryStatesByCode.get(countryState.parentOwnerTag)
        : null;
      if (!parentState) {
        const fallbackGroup = ensureSearchGroup(countryState);
        if (!fallbackGroup) return;
        fallbackGroup.parentMatched = true;
        fallbackGroup.parentSearchRank = searchRank;
        fallbackGroup.bestRank = Math.min(fallbackGroup.bestRank, searchRank);
        return;
      }

      const group = ensureSearchGroup(parentState);
      if (!group) return;
      group.matchedChildCodes.add(countryState.code);
      group.bestRank = Math.min(group.bestRank, searchRank);
    });

    return Array.from(groupsByParentCode.values())
      .map((group) => ({
        parentState: group.parentState,
        parentMatched: group.parentMatched,
        parentSearchRank: group.parentSearchRank,
        childSections: group.parentState?.releasable
          ? []
          : getCountryChildSectionsForParent(group.parentState.code, {
            matchedChildCodes: group.matchedChildCodes,
          }),
        bestRank: Number.isFinite(group.bestRank) ? group.bestRank : Number.MAX_SAFE_INTEGER,
      }))
      .sort((a, b) => {
        if (a.bestRank !== b.bestRank) return a.bestRank - b.bestRank;
        return compareInspectorCountries(a.parentState, b.parentState, priorityOrderMap);
      });
  };

  const renderCountrySearchResults = (countryStates, term, priorityOrderMap) => {
    const searchGroups = buildInspectorSearchGroups(countryStates, term, priorityOrderMap);
    if (!searchGroups.length) {
      list.appendChild(createEmptyNote(t("No matching countries", "ui")));
      return;
    }

    searchGroups.forEach((group) => {
      renderCountrySelectRow(list, group.parentState, {
        childSections: group.childSections,
        forceExpanded: group.childSections.some((section) => Array.isArray(section?.states) && section.states.length > 0),
        hideExpandToggle: group.childSections.some((section) => Array.isArray(section?.states) && section.states.length > 0),
        showRelationMeta: !!group.parentState?.releasable,
      });
    });
  };

  const renderGroupedCountryExplorer = (countryStates) => {
    const latestCountryStatesByCode = getLatestCountryStatesByCode();
    const hasCountryGrouping =
      Array.isArray(runtimeState.countryGroupsData?.continents) &&
      runtimeState.countryGroupsData.continents.length > 0;

    if (!hasCountryGrouping) {
      countryStates.forEach((countryState) => {
        renderCountrySelectRow(list, countryState, {
          childSections: getCountryChildSectionsForParent(countryState.code),
        });
      });
      return;
    }

    const groupedEntries = buildCountryColorTree(countryStates);
    ensureInitialInspectorExpansion(groupedEntries);
    const fragment = document.createDocumentFragment();

    groupedEntries.forEach((continent) => {
      const countries = continent.countries
        .map((entry) => latestCountryStatesByCode.get(entry.code))
        .filter(Boolean);

      if (!countries.length) return;

      const groupKey = getInspectorGroupExpansionKey(continent.id);
      const isOpen = runtimeState.expandedInspectorContinents.has(groupKey);

      const group = document.createElement("div");
      group.className = "country-explorer-group";

      const header = document.createElement("button");
      header.type = "button";
      header.className = "inspector-accordion-btn country-explorer-header";
      header.setAttribute("aria-expanded", String(isOpen));
      header.addEventListener("click", () => {
        if (runtimeState.expandedInspectorContinents.has(groupKey)) {
          runtimeState.expandedInspectorContinents.delete(groupKey);
        } else {
          runtimeState.expandedInspectorContinents.add(groupKey);
        }
        renderList();
      });

      const heading = document.createElement("div");
      heading.className = "country-explorer-heading";

      const title = document.createElement("div");
      title.className = "country-row-title";
      title.textContent = `${continent.displayLabel} (${countries.length})`;

      const chevron = document.createElement("span");
      chevron.className = "inspector-mini-label";
      chevron.textContent = isOpen ? "v" : ">";

      heading.appendChild(title);
      header.appendChild(heading);
      header.appendChild(chevron);
      group.appendChild(header);

      if (isOpen) {
        const groupList = document.createElement("div");
        groupList.className = "country-explorer-list";
        countries.forEach((countryState) => {
          renderCountrySelectRow(groupList, countryState, {
            childSections: getCountryChildSectionsForParent(countryState.code),
          });
        });
        group.appendChild(groupList);
      }

      fragment.appendChild(group);
    });

    list.appendChild(fragment);
  };

  const renderCountryInspectorDetail = () => {
    if (!countryInspectorSelected) return;
    incrementSidebarCounter?.("inspectorRenders");

    updateScenarioInspectorLayout();

    const latestCountryStatesByCode = getLatestCountryStatesByCode();
    const selectedCode = ensureSelectedInspectorCountry();
    const countryState = selectedCode ? latestCountryStatesByCode.get(selectedCode) : null;
    const isEmpty = !countryState;

    if (countryInspectorDetail) {
      countryInspectorDetail.classList.toggle("hidden", isEmpty);
    }
    countryInspectorSelected.classList.toggle("hidden", isEmpty);

    if (!countryState) {
      if (countryInspectorSetActive) {
        countryInspectorSetActive.disabled = true;
        countryInspectorSetActive.classList.remove("is-active");
        countryInspectorSetActive.classList.remove("hidden");
        countryInspectorSetActive.textContent = t("Use as Active Owner", "ui");
        countryInspectorSetActive.setAttribute("aria-pressed", "false");
      }
      if (countryInspectorDetailHint) {
        countryInspectorDetailHint.classList.add("hidden");
        countryInspectorDetailHint.textContent = "";
      }
      if (countryInspectorColorRow) {
        countryInspectorColorRow.classList.add("hidden");
      }
      if (countryInspectorColorInput) {
        countryInspectorColorInput.disabled = true;
        countryInspectorColorInput.style.removeProperty("left");
        countryInspectorColorInput.style.removeProperty("top");
      }
      setCountryInspectorColorPickerOpen(false);
      scheduleAdaptiveInspectorHeights();
      return;
    }

    const isScenarioReleasable = !!runtimeState.activeScenarioId && !!countryState.releasable;
    if (countryInspectorSetActive) {
      const isActive = runtimeState.activeSovereignCode === countryState.code;
      countryInspectorSetActive.disabled = false;
      countryInspectorSetActive.classList.toggle("hidden", isScenarioReleasable);
      countryInspectorSetActive.classList.toggle("is-active", !isScenarioReleasable && isActive);
      countryInspectorSetActive.textContent = isActive
        ? t("Stop Using as Active Owner", "ui")
        : t("Use as Active Owner", "ui");
      countryInspectorSetActive.setAttribute("aria-pressed", String(!isScenarioReleasable && isActive));
    }
    if (countryInspectorDetailHint) {
      if (isScenarioReleasable) {
        countryInspectorDetailHint.classList.remove("hidden");
        countryInspectorDetailHint.textContent = t(
          "Use Activate Releasable or Reapply Core Territory in Scenario Actions.",
          "ui"
        );
      } else {
        countryInspectorDetailHint.classList.add("hidden");
        countryInspectorDetailHint.textContent = "";
      }
    }

    if (countryInspectorColorRow) {
      const resolvedColor = getDisplayCountryColor(countryState);
      countryInspectorColorRow.classList.remove("hidden");
      if (countryInspectorColorSwatch) {
        countryInspectorColorSwatch.style.backgroundColor = resolvedColor;
        countryInspectorColorSwatch.title = `${t("Edit country color", "ui")}: ${countryState.displayName}`;
        countryInspectorColorSwatch.setAttribute(
          "aria-label",
          `${t("Edit country color", "ui")}: ${countryState.displayName}`
        );
      }
      if (countryInspectorColorInput) {
        countryInspectorColorInput.disabled = false;
        countryInspectorColorInput.value = resolvedColor;
        positionCountryInspectorColorAnchor();
      }
    }
    scheduleAdaptiveInspectorHeights();
  };

  const renderList = () => {
    incrementSidebarCounter?.("fullListRenders");
    updateScenarioInspectorLayout();
    const term = getSearchTerm();
    const entries = getDynamicCountryEntries();
    const countryStates = entries.map((entry, entryIndex) => createCountryInspectorState(entry, entryIndex));
    const visibleCountryStates = countryStates.filter((countryState) => !countryState?.hiddenFromCountryList);
    const topLevelCountryStates = buildInspectorTopLevelCountryEntries(visibleCountryStates);
    const priorityOrderMap = getPriorityCountryOrderMap();
    setLatestCountryStatesByCode(new Map(countryStates.map((countryState) => [countryState.code, countryState])));
    countryRowRefsByCode.clear();
    ensureSelectedInspectorCountry();
    list.replaceChildren();

    if (!visibleCountryStates.length) {
      list.appendChild(createEmptyNote(t("No countries available", "ui")));
      renderCountryInspectorDetail();
      scheduleAdaptiveInspectorHeights();
      return;
    }

    if (term) {
      renderCountrySearchResults(visibleCountryStates, term, priorityOrderMap);
    } else {
      renderGroupedCountryExplorer(topLevelCountryStates);
    }

    renderCountryInspectorDetail();
    if (typeof runtimeState.renderPresetTreeFn === "function") {
      runtimeState.renderPresetTreeFn();
    }
    if (typeof runtimeState.updateWorkspaceStatusFn === "function") {
      runtimeState.updateWorkspaceStatusFn();
    }
    scheduleAdaptiveInspectorHeights();
  };

  const refreshCountryRows = ({
    countryCodes = [],
    refreshInspector = true,
    refreshPresetTree = false,
    forceAll = false,
  } = {}) => {
    const latestCountryStatesByCode = getLatestCountryStatesByCode();
    const normalizedCodes = Array.from(new Set(
      (Array.isArray(countryCodes) ? countryCodes : [])
        .map((code) => normalizeCountryCode(code))
        .filter(Boolean)
    ));
    const selectedCode = normalizeCountryCode(runtimeState.selectedInspectorCountryCode);
    const activeCode = normalizeCountryCode(runtimeState.activeSovereignCode);
    if (selectedCode) normalizedCodes.push(selectedCode);
    if (activeCode) normalizedCodes.push(activeCode);
    const targetCodes = forceAll || !normalizedCodes.length
      ? Array.from(countryRowRefsByCode.keys())
      : Array.from(new Set(normalizedCodes));

    targetCodes.forEach((countryCode) => {
      const refs = countryRowRefsByCode.get(countryCode) || [];
      const countryState = latestCountryStatesByCode.get(countryCode);
      if (!countryState || !refs.length) return;
      refs.forEach((ref) => syncCountryRowVisuals(ref, countryState));
    });
    incrementSidebarCounter?.("rowRefreshes", targetCodes.length || 1);

    if (refreshInspector) {
      renderCountryInspectorDetail();
    }
    if (refreshPresetTree && typeof runtimeState.renderPresetTreeFn === "function") {
      runtimeState.renderPresetTreeFn();
    }
    if (typeof runtimeState.updateWorkspaceStatusFn === "function") {
      runtimeState.updateWorkspaceStatusFn();
    }
    scheduleAdaptiveInspectorHeights();
  };

  const bindEvents = () => {
    if (searchInput && !searchInput.dataset.bound) {
      searchInput.addEventListener("input", () => {
        renderList();
        if (typeof runtimeState.renderPresetTreeFn === "function") {
          runtimeState.renderPresetTreeFn();
        }
      });
      searchInput.dataset.bound = "true";
    }

    if (countryInspectorSetActive && !countryInspectorSetActive.dataset.bound) {
      countryInspectorSetActive.addEventListener("click", () => {
        const latestCountryStatesByCode = getLatestCountryStatesByCode();
        const selectedCode = ensureSelectedInspectorCountry();
        if (!selectedCode) return;
        const countryState = latestCountryStatesByCode.get(selectedCode);
        if (runtimeState.activeScenarioId && countryState?.releasable) {
          return;
        }
        const isCurrentlyActive = runtimeState.activeSovereignCode === selectedCode;
        const previousActiveCode = runtimeState.activeSovereignCode;
        runtimeState.activeSovereignCode = isCurrentlyActive ? "" : selectedCode;
        markDirty(isCurrentlyActive ? "set-inactive-sovereign" : "set-active-sovereign");
        if (typeof runtimeState.updateActiveSovereignUIFn === "function") {
          runtimeState.updateActiveSovereignUIFn();
        }
        flushSidebarRender(
          isCurrentlyActive ? "sidebar-active-sovereign:clear" : `sidebar-active-sovereign:${selectedCode}`
        );
        refreshCountryRows({
          countryCodes: [previousActiveCode, selectedCode],
          refreshInspector: true,
        });
        if (!isCurrentlyActive) {
          showToast(
            t("Political ownership editing now targets the selected country.", "ui"),
            {
              title: t("Active owner updated", "ui"),
              tone: "info",
              duration: 3200,
            }
          );
        }
      });
      countryInspectorSetActive.dataset.bound = "true";
    }

    if (countryInspectorColorSwatch && countryInspectorColorInput && !countryInspectorColorSwatch.dataset.bound) {
      countryInspectorColorSwatch.addEventListener("click", () => {
        positionCountryInspectorColorAnchor();
        countryInspectorColorInput.focus({ preventScroll: true });
        setCountryInspectorColorPickerOpen(true);
        if (typeof countryInspectorColorInput.showPicker === "function") {
          countryInspectorColorInput.showPicker();
        } else {
          countryInspectorColorInput.click();
        }
      });
      countryInspectorColorSwatch.dataset.bound = "true";
    }

    if (countryInspectorColorInput && !countryInspectorColorInput.dataset.bound) {
      countryInspectorColorInput.addEventListener("change", (event) => {
        const latestCountryStatesByCode = getLatestCountryStatesByCode();
        const selectedCode = ensureSelectedInspectorCountry();
        if (!selectedCode) return;
        const countryState = latestCountryStatesByCode.get(selectedCode);
        if (!countryState) return;
        const nextColor = normalizeHexColor(event.target.value);
        const currentColor = getDisplayCountryColor(countryState);
        if (!nextColor || nextColor === currentColor) {
          closeCountryInspectorColorPicker();
          renderCountryInspectorDetail();
          return;
        }
        applyCountryColor(selectedCode, nextColor);
        closeCountryInspectorColorPicker();
        markDirty("inspector-country-color");
        refreshCountryRows({
          countryCodes: [selectedCode],
          refreshInspector: true,
        });
      });
      countryInspectorColorInput.addEventListener("blur", () => {
        setCountryInspectorColorPickerOpen(false);
      });
      countryInspectorColorInput.dataset.bound = "true";
    }
  };

  return {
    bindEvents,
    closeCountryInspectorColorPicker,
    ensureSelectedInspectorCountry,
    refreshCountryRows,
    renderCountryInspectorDetail,
    renderCountrySelectRow,
    renderList,
    selectInspectorCountry,
    syncCountryRowVisuals,
  };
}
