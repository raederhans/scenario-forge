import { UI_URL_STATE_KEYS } from "../ui_contract.js";
import { setUiIcon } from "../ui_icons.js";

export function createResponsiveSidebarCollapseController({ left, right, applyLeft, applyRight, getWidth }) {
  const desktop = { left, right };
  let current = { ...desktop };
  let compact = false;
  const isCompact = () => getWidth() >= 1024 && getWidth() < 1280;
  const render = (persist = false) => {
    applyLeft(current.left, { persist });
    applyRight(current.right, { persist });
  };
  return {
    sync() {
      const nextCompact = isCompact();
      if (nextCompact !== compact) {
        current = { ...desktop };
        if (nextCompact && !current.left && !current.right) current.right = true;
      }
      compact = nextCompact;
      render();
    },
    set(side, collapsed) {
      compact = isCompact();
      current[side] = !!collapsed;
      if (compact && !collapsed) current[side === "left" ? "right" : "left"] = true;
      if (!compact) Object.assign(desktop, current);
      render(!compact);
    },
  };
}

export function createSidebarLayoutController({
  runtimeState, sidebar, leftSidebar, list, presetTree, t,
  refreshStrategicOverlay, showProperty, getCountryInspectorColorPickerOpen,
  closeCountryInspectorColorPicker, closeWaterInspectorColorPicker, closeSpecialRegionColorPicker,
}) {
  const leftSidebarContent = document.getElementById("leftSidebarContent");
  const leftSidebarCollapseBtn = document.getElementById("leftSidebarCollapseBtn");
  const leftSidebarCollapseIcon = document.getElementById("leftSidebarCollapseIcon");
  const rightSidebarContent = document.getElementById("rightSidebarContent");
  const rightSidebarCollapseBtn = document.getElementById("rightSidebarCollapseBtn");
  const rightSidebarCollapseIcon = document.getElementById("rightSidebarCollapseIcon");
  const frontlineProjectSection = document.getElementById("frontlineProjectSection");
  const projectLegendSection = document.getElementById("lblProjectLegend")?.closest("details");
  const legendProjectSection = document.getElementById("legendProjectSection");
  const diagnosticsSection = document.getElementById("lblDiagnostics")?.closest("details");
  const countryInspectorSection = document.getElementById("countryInspectorSection");
  const waterInspectorSection = document.getElementById("waterInspectorSection");
  const specialRegionInspectorSection = document.getElementById("specialRegionInspectorSection");
  const selectedCountryActionsSection = document.getElementById("selectedCountryActionsSection");
  const countryInspectorDetail = document.getElementById("countryInspectorDetail");
  const waterRegionList = document.getElementById("waterRegionList");
  const waterLegendList = document.getElementById("waterLegendList");
  const specialRegionList = document.getElementById("specialRegionList");
  const selectedCountryActionsBody = selectedCountryActionsSection?.querySelector(".inspector-panel-body") || null;
  const inspectorSidebarTabButtons = Array.from(document.querySelectorAll("[data-inspector-tab]"));
  const inspectorSidebarTabPanels = Array.from(document.querySelectorAll("[data-inspector-panel]"));
  const rightSidebarDetails = () => Array.from(document.querySelectorAll("#rightSidebar details[id]"));
  const replaceUiUrlParams = (mutator) => {
    if (!globalThis.URLSearchParams || !globalThis.history?.replaceState || !globalThis.location) return;
    const params = new globalThis.URLSearchParams(globalThis.location.search || "");
    mutator?.(params);
    const nextQuery = params.toString();
    const nextUrl = `${globalThis.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${globalThis.location.hash || ""}`;
    const currentUrl = `${globalThis.location.pathname}${globalThis.location.search || ""}${globalThis.location.hash || ""}`;
    if (nextUrl === currentUrl) return;
    globalThis.history.replaceState(globalThis.history.state, "", nextUrl);
  };
  const getScopeParamForTab = (tabId) => (String(tabId || "").trim().toLowerCase() === "project" ? "current-project" : "current-object");
  const isProjectSupportView = (value) => ["guide", "reference", "export"].includes(String(value || "").trim().toLowerCase());
  const clearRightSidebarSupportViewParam = () => {
    replaceUiUrlParams((params) => {
      params.delete(UI_URL_STATE_KEYS.view);
    });
  };
  const collectOpenRightSidebarSections = () => rightSidebarDetails()
    .filter((details) => details.open && !details.hidden && !details.closest(".editor-property-panel[hidden]"))
    .map((details) => details.id)
    .join(",");
  // 当前右栏属性面板（editor workspace 的 onNavigate 回报）。参考底图已从弹层改为图层属性，
  // 它不是 details，靠这个标记把 view=reference 写进 URL，刷新/分享链接才能恢复。
  let activeEditorPropertyKey = "";
  const syncRightSidebarUrlState = () => {
    // 右侧栏 URL 状态只记录“当前标签页 + 展开的 section + support view”，
    // 不记录更细的局部表单状态，避免刷新链接过长也避免 restore 语义失真。
    replaceUiUrlParams((params) => {
      const scopeValue = getScopeParamForTab(runtimeState.ui?.rightSidebarTab || "inspector");
      params.set(UI_URL_STATE_KEYS.scope, scopeValue);
      const openSections = collectOpenRightSidebarSections();
      if (openSections) {
        params.set(UI_URL_STATE_KEYS.section, openSections);
      } else {
        params.delete(UI_URL_STATE_KEYS.section);
      }
      if (activeEditorPropertyKey === "reference") {
        params.set(UI_URL_STATE_KEYS.view, "reference");
      } else if (scopeValue !== "current-project") {
        params.delete(UI_URL_STATE_KEYS.view);
      }
    });
  };
  const restoreRightSidebarUrlState = () => {
    if (!globalThis.URLSearchParams || !globalThis.location) return "";
    // restore 只做“把壳层切回同一个工作区入口”，
    // 具体 guide/reference/export 的打开动作仍交给各自 owner 去完成。
    const params = new globalThis.URLSearchParams(globalThis.location.search || "");
    const scopeValue = String(params.get(UI_URL_STATE_KEYS.scope) || "").trim().toLowerCase();
    const viewValue = String(params.get(UI_URL_STATE_KEYS.view) || "").trim().toLowerCase();
    const requestedSections = new Set(
      String(params.get(UI_URL_STATE_KEYS.section) || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    );
    if (requestedSections.size) {
      rightSidebarDetails().forEach((details) => {
        details.open = requestedSections.has(details.id);
      });
    }
    if (isProjectSupportView(viewValue) && scopeValue !== "current-object") {
      const exportDetails = document.getElementById("exportProjectSection");
      const utilitiesDetails = document.getElementById("inspectorUtilitiesSection");
      if (viewValue === "export") {
        if (exportDetails instanceof HTMLDetailsElement) {
          exportDetails.open = true;
        }
      } else if (utilitiesDetails instanceof HTMLDetailsElement) {
        utilitiesDetails.open = true;
      }
      return "project";
    }
    return scopeValue === "current-project" ? "project" : "";
  };
  const updateScenarioInspectorLayout = () => {
    const isScenarioMode = !!runtimeState.activeScenarioId;
    const scenarioDefaultsKey = String(runtimeState.activeScenarioId || "__base__");
    // 切场景时只重置由 scenario 接管的 disclosure，
    // project/diagnostics 这类全局工具区继续保留独立壳层身份。
    if (scenarioDefaultsKey !== lastScenarioInspectorDefaultsKey) {
      collapseScenarioManagedSections();
      lastScenarioInspectorDefaultsKey = scenarioDefaultsKey;
    }
    projectLegendSection?.classList.toggle("inspector-section-secondary", isScenarioMode);
    legendProjectSection?.classList.toggle("inspector-section-secondary", isScenarioMode);
    diagnosticsSection?.classList.toggle("inspector-section-secondary", isScenarioMode);
    if (selectedCountryActionsSection) {
      selectedCountryActionsSection.classList.remove("hidden");
      selectedCountryActionsSection.setAttribute("aria-hidden", "false");
    }
  };

  const INSPECTOR_VH_BASELINE = {
    countryList: 14,
    countryListCap: 42,
    countryListCompactCap: 34,
    presetTreeCap: 52,
    presetTreeCompactCap: 48,
    selectedActionsBodyCap: 56,
    selectedActionsBodyCompactCap: 54,
    selectedActionsBodyVisualOpenCap: 66,
    selectedActionsBodyVisualOpenCompactCap: 64,
  };
  const INSPECTOR_PX_BASELINE = {
    actionList: 120,
    actionListCap: 240,
    presetBody: 240,
    presetBodyCap: 520,
    selectedActionsBodyReserve: 28,
  };
  let adaptiveInspectorHeightFrame = 0;
  let lastScenarioInspectorDefaultsKey = null;
  const inspectorDisclosureOpenByKey = new Map();

  const collapseScenarioManagedSections = () => {
    if (document.body.classList.contains("editor-workspace")) {
      [countryInspectorSection, waterInspectorSection, specialRegionInspectorSection, frontlineProjectSection].forEach((section) => {
        if (section) section.open = true;
      });
      return;
    }
    countryInspectorSection?.removeAttribute("open");
    selectedCountryActionsSection?.removeAttribute("open");
    waterInspectorSection?.removeAttribute("open");
    specialRegionInspectorSection?.removeAttribute("open");
    frontlineProjectSection?.removeAttribute("open");
  };

  const clampInspectorHeight = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
  const toViewportPixels = (vh) => (window.innerHeight * vh) / 100;

  const getInspectorDisclosureOpenState = (key, fallbackOpen) => {
    if (!key) return !!fallbackOpen;
    if (!inspectorDisclosureOpenByKey.has(key)) {
      inspectorDisclosureOpenByKey.set(key, !!fallbackOpen);
    }
    return !!inspectorDisclosureOpenByKey.get(key);
  };

  const setInspectorDisclosureOpenState = (key, isOpen) => {
    if (!key) return;
    inspectorDisclosureOpenByKey.set(key, !!isOpen);
  };

  const applyAdaptiveInspectorHeight = (element, minimum, maximum) => {
    if (!element) return;
    element.style.height = "";
    element.style.maxHeight = "";
    const scrollHeight = Number(element.scrollHeight || 0);
    const nextHeight = clampInspectorHeight(scrollHeight, minimum, maximum);
    element.style.height = `${Math.round(nextHeight)}px`;
    element.style.maxHeight = `${Math.round(nextHeight)}px`;
  };

  const releaseAdaptiveInspectorHeight = (element) => {
    if (!element) return;
    element.style.height = "";
    element.style.maxHeight = "";
  };

  const getCountryInspectorListCap = () => {
    const hasOpenActionStack = !!selectedCountryActionsSection?.open;
    const hasSelectedDetail = !!countryInspectorDetail && !countryInspectorDetail.classList.contains("hidden");
    return hasOpenActionStack || hasSelectedDetail
      ? INSPECTOR_VH_BASELINE.countryListCompactCap
      : INSPECTOR_VH_BASELINE.countryListCap;
  };

  const getPresetInspectorListCap = () => (
    countryInspectorSection?.open
      ? INSPECTOR_VH_BASELINE.presetTreeCompactCap
      : INSPECTOR_VH_BASELINE.presetTreeCap
  );

  const isScenarioVisualAdjustmentsExpanded = () => (
    !!selectedCountryActionsSection?.open
    && !!runtimeState.ui?.scenarioVisualAdjustmentsOpen
  );

  const getSelectedActionsBodyCap = () => {
    const hasOpenVisualAdjustments = isScenarioVisualAdjustmentsExpanded();
    if (countryInspectorSection?.open) {
      return hasOpenVisualAdjustments
        ? INSPECTOR_VH_BASELINE.selectedActionsBodyVisualOpenCompactCap
        : INSPECTOR_VH_BASELINE.selectedActionsBodyCompactCap;
    }
    return hasOpenVisualAdjustments
      ? INSPECTOR_VH_BASELINE.selectedActionsBodyVisualOpenCap
      : INSPECTOR_VH_BASELINE.selectedActionsBodyCap;
  };

  const isSelectedActionsEmptyState = () => (
    !!selectedCountryActionsSection?.classList.contains("is-empty-selection-panel")
  );

  const syncAdaptiveInspectorHeights = () => {
    adaptiveInspectorHeightFrame = 0;
    if (document.body.classList.contains("editor-workspace")) {
      [list, waterRegionList, waterLegendList, specialRegionList, presetTree].forEach(releaseAdaptiveInspectorHeight);
      return;
    }
    applyAdaptiveInspectorHeight(
      list,
      toViewportPixels(INSPECTOR_VH_BASELINE.countryList),
      toViewportPixels(getCountryInspectorListCap())
    );
    applyAdaptiveInspectorHeight(
      waterRegionList,
      toViewportPixels(18),
      toViewportPixels(32)
    );
    applyAdaptiveInspectorHeight(
      waterLegendList,
      96,
      220
    );
    applyAdaptiveInspectorHeight(
      specialRegionList,
      toViewportPixels(18),
      toViewportPixels(32)
    );
    releaseAdaptiveInspectorHeight(presetTree);
    const hasOpenVisualAdjustments = !isSelectedActionsEmptyState() && isScenarioVisualAdjustmentsExpanded();
    selectedCountryActionsSection?.classList.toggle(
      "has-open-visual-adjustments",
      hasOpenVisualAdjustments
    );
    if (isSelectedActionsEmptyState()) {
      releaseAdaptiveInspectorHeight(selectedCountryActionsBody);
    } else {
      applyAdaptiveInspectorHeight(
        selectedCountryActionsBody,
        INSPECTOR_PX_BASELINE.selectedActionsBodyReserve,
        toViewportPixels(getSelectedActionsBodyCap())
      );
    }
    sidebar?.querySelectorAll(".preset-country-body").forEach((element) => {
      applyAdaptiveInspectorHeight(
        element,
        INSPECTOR_PX_BASELINE.presetBody,
        INSPECTOR_PX_BASELINE.presetBodyCap
      );
    });
  };

  const scheduleAdaptiveInspectorHeights = () => {
    if (adaptiveInspectorHeightFrame) {
      globalThis.cancelAnimationFrame(adaptiveInspectorHeightFrame);
    }
    adaptiveInspectorHeightFrame = globalThis.requestAnimationFrame(syncAdaptiveInspectorHeights);
  };

  const LEFT_SIDEBAR_COLLAPSED_KEY = "map_left_sidebar_collapsed";
  const RIGHT_SIDEBAR_COLLAPSED_KEY = "map_right_sidebar_collapsed";
  const leftSidebarCollapseMedia = typeof globalThis.matchMedia === "function"
    ? globalThis.matchMedia("(min-width: 1024px)")
    : null;
  const rightSidebarCollapseMedia = typeof globalThis.matchMedia === "function"
    ? globalThis.matchMedia("(min-width: 1024px)")
    : null;
  const compactSidebarMedia = typeof globalThis.matchMedia === "function"
    ? globalThis.matchMedia("(min-width: 1024px) and (max-width: 1279px)")
    : null;
  let responsiveSidebarCollapse = null;
  const SIDEBAR_LAYOUT_START_EVENT = "mapcreator:sidebar-layout-start";
  const SIDEBAR_LAYOUT_REFRESH_EVENT = "mapcreator:sidebar-layout-refresh";
  const SIDEBAR_LAYOUT_REFRESH_DELAY_MS = 280;
  let leftSidebarCollapsePreference = false;
  let leftSidebarLayoutRefreshTimer = 0;
  let rightSidebarCollapsePreference = false;
  let rightSidebarLayoutRefreshTimer = 0;

  const canCollapseLeftSidebar = () => (
    !leftSidebarCollapseMedia || !!leftSidebarCollapseMedia.matches
  );

  const canCollapseRightSidebar = () => (
    !rightSidebarCollapseMedia || !!rightSidebarCollapseMedia.matches
  );

  const refreshCollapsedSidebarLayout = () => {
    scheduleAdaptiveInspectorHeights();
    globalThis.dispatchEvent(new CustomEvent(SIDEBAR_LAYOUT_REFRESH_EVENT));
  };

  const beginCollapsedSidebarLayout = () => {
    globalThis.dispatchEvent(new CustomEvent(SIDEBAR_LAYOUT_START_EVENT));
  };

  const requestLeftSidebarLayoutRefresh = () => {
    if (leftSidebarLayoutRefreshTimer) {
      globalThis.clearTimeout(leftSidebarLayoutRefreshTimer);
    }
    scheduleAdaptiveInspectorHeights();
    leftSidebarLayoutRefreshTimer = globalThis.setTimeout(() => {
      refreshCollapsedSidebarLayout();
      leftSidebarLayoutRefreshTimer = 0;
    }, SIDEBAR_LAYOUT_REFRESH_DELAY_MS);
  };

  const requestRightSidebarLayoutRefresh = () => {
    if (rightSidebarLayoutRefreshTimer) {
      globalThis.clearTimeout(rightSidebarLayoutRefreshTimer);
    }
    scheduleAdaptiveInspectorHeights();
    rightSidebarLayoutRefreshTimer = globalThis.setTimeout(() => {
      refreshCollapsedSidebarLayout();
      rightSidebarLayoutRefreshTimer = 0;
    }, SIDEBAR_LAYOUT_REFRESH_DELAY_MS);
  };

  const setLeftSidebarCollapsed = (collapsed, { persist = true, refreshLayout = true, linked = true } = {}) => {
    if (responsiveSidebarCollapse && linked) {
      responsiveSidebarCollapse.set("left", collapsed);
      return;
    }
    leftSidebarCollapsePreference = !!collapsed;
    const effectiveCollapsed = leftSidebarCollapsePreference && canCollapseLeftSidebar();
    document.body.classList.toggle("left-sidebar-collapsed", effectiveCollapsed);
    leftSidebar?.classList.toggle("is-collapsed", effectiveCollapsed);
    leftSidebarContent?.toggleAttribute("inert", effectiveCollapsed);
    leftSidebarContent?.setAttribute("aria-hidden", effectiveCollapsed ? "true" : "false");
    leftSidebarCollapseBtn?.setAttribute("aria-expanded", effectiveCollapsed ? "false" : "true");
    const nextSidebarLabel = effectiveCollapsed ? "Expand left sidebar" : "Collapse left sidebar";
    leftSidebarCollapseBtn?.setAttribute("data-i18n-aria-label", nextSidebarLabel);
    leftSidebarCollapseBtn?.setAttribute("aria-label", t(nextSidebarLabel, "ui"));
    if (leftSidebarCollapseIcon) {
      setUiIcon(leftSidebarCollapseIcon, effectiveCollapsed ? "chevron-right" : "chevron-left");
    }
    if (persist) {
      try {
        globalThis.localStorage?.setItem(LEFT_SIDEBAR_COLLAPSED_KEY, leftSidebarCollapsePreference ? "true" : "false");
      } catch (_error) {
        // localStorage can be unavailable in privacy-restricted contexts.
      }
    }
    if (refreshLayout) {
      beginCollapsedSidebarLayout();
      requestLeftSidebarLayoutRefresh();
    }
  };

  const setRightSidebarCollapsed = (collapsed, { persist = true, refreshLayout = true, linked = true } = {}) => {
    if (responsiveSidebarCollapse && linked) {
      responsiveSidebarCollapse.set("right", collapsed);
      return;
    }
    rightSidebarCollapsePreference = !!collapsed;
    const effectiveCollapsed = rightSidebarCollapsePreference && canCollapseRightSidebar();
    document.body.classList.toggle("right-sidebar-collapsed", effectiveCollapsed);
    sidebar?.classList.toggle("is-collapsed", effectiveCollapsed);
    rightSidebarContent?.toggleAttribute("inert", effectiveCollapsed);
    rightSidebarContent?.setAttribute("aria-hidden", effectiveCollapsed ? "true" : "false");
    rightSidebarCollapseBtn?.setAttribute("aria-expanded", effectiveCollapsed ? "false" : "true");
    document.getElementById("editorInspectorToggleBtn")?.setAttribute("aria-expanded", String(
      canCollapseRightSidebar() ? !effectiveCollapsed : document.body.classList.contains("right-drawer-open")
    ));
    const nextSidebarLabel = effectiveCollapsed ? "Expand right sidebar" : "Collapse right sidebar";
    rightSidebarCollapseBtn?.setAttribute("data-i18n-aria-label", nextSidebarLabel);
    rightSidebarCollapseBtn?.setAttribute("aria-label", t(nextSidebarLabel, "ui"));
    if (rightSidebarCollapseIcon) {
      setUiIcon(rightSidebarCollapseIcon, effectiveCollapsed ? "chevron-left" : "chevron-right");
    }
    if (persist) {
      try {
        globalThis.localStorage?.setItem(RIGHT_SIDEBAR_COLLAPSED_KEY, rightSidebarCollapsePreference ? "true" : "false");
      } catch (_error) {
        // localStorage can be unavailable in privacy-restricted contexts.
      }
    }
    if (refreshLayout) {
      beginCollapsedSidebarLayout();
      requestRightSidebarLayoutRefresh();
    }
  };

  const restoreLeftSidebarCollapsedState = () => {
    try {
      leftSidebarCollapsePreference = globalThis.localStorage?.getItem(LEFT_SIDEBAR_COLLAPSED_KEY) === "true";
    } catch (_error) {
      leftSidebarCollapsePreference = false;
    }
    setLeftSidebarCollapsed(leftSidebarCollapsePreference, { persist: false, refreshLayout: false });
  };

  const restoreRightSidebarCollapsedState = () => {
    rightSidebarCollapsePreference = false;
    try {
      const saved = globalThis.localStorage?.getItem(RIGHT_SIDEBAR_COLLAPSED_KEY);
      if (saved !== null && saved !== undefined) rightSidebarCollapsePreference = saved === "true";
    } catch (_error) {
    }
    setRightSidebarCollapsed(rightSidebarCollapsePreference, { persist: false, refreshLayout: false });
  };

  const syncLeftSidebarCollapsedMedia = () => {
    responsiveSidebarCollapse.sync();
  };

  const syncRightSidebarCollapsedMedia = () => {
    responsiveSidebarCollapse.sync();
  };


  const setRightSidebarTab = (tabId) => {
    const normalizedId = String(tabId || "").trim().toLowerCase();
    const activeId = normalizedId === "frontline"
      ? "project"
      : (["inspector", "project"].includes(normalizedId) ? normalizedId : "inspector");
    if (!runtimeState.ui || typeof runtimeState.ui !== "object") {
      runtimeState.ui = {};
    }
    runtimeState.ui.rightSidebarTab = activeId;
    if (activeId !== "project") {
      clearRightSidebarSupportViewParam();
    }
    inspectorSidebarTabButtons.forEach((button) => {
      const id = String(button.dataset.inspectorTab || "").trim().toLowerCase();
      const isActive = id === activeId;
      button.classList.toggle("is-active", isActive);
      const stateAttribute = button.getAttribute("role") === "tab" ? "aria-selected" : "aria-pressed";
      const obsoleteAttribute = stateAttribute === "aria-selected" ? "aria-pressed" : "aria-selected";
      if (button.hasAttribute(obsoleteAttribute)) button.removeAttribute(obsoleteAttribute);
      const stateValue = isActive ? "true" : "false";
      if (button.getAttribute(stateAttribute) !== stateValue) button.setAttribute(stateAttribute, stateValue);
    });
    inspectorSidebarTabPanels.forEach((panel) => {
      const id = String(panel.dataset.inspectorPanel || "").trim().toLowerCase();
      const isActive = id === activeId;
      panel.classList.toggle("is-active", isActive);
      panel.hidden = !isActive;
    });
    refreshStrategicOverlay({
      scopes: ["workspaceChrome", "counterIdentity", "counterPreview", "counterList"],
    });
    syncRightSidebarUrlState();
    scheduleAdaptiveInspectorHeights();
    document.dispatchEvent(new CustomEvent("editor-sidebar-tab", { detail: activeId }));
  };


  const selectionFields = { countries: "selectedInspectorCountryCode", water: "selectedWaterRegionId", special: "selectedSpecialRegionId" };
  const lastEditorSelection = {};
  const syncEditorSelection = () => {
    for (const [kind, field] of Object.entries(selectionFields)) {
      const value = String(runtimeState[field] || "");
      if (value && value !== lastEditorSelection[kind] && !document.body.classList.contains("frontline-mode-active")) {
        showProperty(kind);
        if (runtimeState.currentTool === "select" && document.body.classList.contains("right-sidebar-collapsed")) {
          setRightSidebarCollapsed(false);
        }
      }
      lastEditorSelection[kind] = value;
    }
  };
  const withEditorSelection = (callback) => (...args) => {
    const result = callback(...args);
    syncEditorSelection();
    return result;
  };
  const onNavigate = (key) => {
      activeEditorPropertyKey = String(key || "");
      // Manual context navigation consumes the current selection snapshot so a
      // delayed list refresh cannot take the inspector back to an older choice.
      for (const [kind, field] of Object.entries(selectionFields)) {
        lastEditorSelection[kind] = String(runtimeState[field] || "");
      }
      syncRightSidebarUrlState();
  };
  const toggleRightSidebarCollapsed = () => setRightSidebarCollapsed(!rightSidebarCollapsePreference);
  const restoreCollapsedState = () => {
    restoreLeftSidebarCollapsedState();
    restoreRightSidebarCollapsedState();
    responsiveSidebarCollapse = createResponsiveSidebarCollapseController({
      left: leftSidebarCollapsePreference,
      right: rightSidebarCollapsePreference,
      applyLeft: (collapsed, options) => setLeftSidebarCollapsed(collapsed, { ...options, linked: false }),
      applyRight: (collapsed, options) => setRightSidebarCollapsed(collapsed, { ...options, linked: false }),
      getWidth: () => globalThis.innerWidth,
    });
    responsiveSidebarCollapse.sync();
  };
  const bindEvents = () => {
    if (sidebar && !sidebar.dataset.compactCollapseBound) {
      compactSidebarMedia?.addEventListener?.("change", () => responsiveSidebarCollapse.sync());
      sidebar.dataset.compactCollapseBound = "true";
    }

    if (leftSidebarCollapseBtn && !leftSidebarCollapseBtn.dataset.bound) {
      leftSidebarCollapseBtn.addEventListener("click", () => {
        setLeftSidebarCollapsed(!leftSidebarCollapsePreference);
      });
      leftSidebarCollapseBtn.dataset.bound = "true";
    }

    if (rightSidebarCollapseBtn && !rightSidebarCollapseBtn.dataset.bound) {
      rightSidebarCollapseBtn.addEventListener("click", () => {
        setRightSidebarCollapsed(!rightSidebarCollapsePreference);
      });
      rightSidebarCollapseBtn.dataset.bound = "true";
    }

    if (leftSidebarCollapseMedia && leftSidebar && !leftSidebar.dataset.collapseMediaBound) {
      if (typeof leftSidebarCollapseMedia.addEventListener === "function") {
        leftSidebarCollapseMedia.addEventListener("change", syncLeftSidebarCollapsedMedia);
      } else if (typeof leftSidebarCollapseMedia.addListener === "function") {
        leftSidebarCollapseMedia.addListener(syncLeftSidebarCollapsedMedia);
      }
      leftSidebar.dataset.collapseMediaBound = "true";
    }

    if (rightSidebarCollapseMedia && sidebar && !sidebar.dataset.collapseMediaBound) {
      if (typeof rightSidebarCollapseMedia.addEventListener === "function") {
        rightSidebarCollapseMedia.addEventListener("change", syncRightSidebarCollapsedMedia);
      } else if (typeof rightSidebarCollapseMedia.addListener === "function") {
        rightSidebarCollapseMedia.addListener(syncRightSidebarCollapsedMedia);
      }
      sidebar.dataset.collapseMediaBound = "true";
    }

    inspectorSidebarTabButtons.forEach((button) => {
      if (button.dataset.bound) return;
      button.addEventListener("click", () => {
        setRightSidebarTab(button.dataset.inspectorTab || "inspector");
      });
      button.dataset.bound = "true";
    });

    rightSidebarDetails().forEach((details) => {
      if (details.dataset.urlBound === "true") return;
      details.addEventListener("toggle", () => {
        syncRightSidebarUrlState();
      });
      details.dataset.urlBound = "true";
    });


    if (sidebar && !sidebar.dataset.adaptiveInspectorBound) {
      globalThis.addEventListener("resize", scheduleAdaptiveInspectorHeights);
      countryInspectorSection?.addEventListener("toggle", scheduleAdaptiveInspectorHeights);
      waterInspectorSection?.addEventListener("toggle", scheduleAdaptiveInspectorHeights);
      specialRegionInspectorSection?.addEventListener("toggle", scheduleAdaptiveInspectorHeights);
      selectedCountryActionsSection?.addEventListener("toggle", scheduleAdaptiveInspectorHeights);
      sidebar.addEventListener("scroll", () => {
        if (getCountryInspectorColorPickerOpen()) {
          closeCountryInspectorColorPicker();
        }
        closeWaterInspectorColorPicker();
        closeSpecialRegionColorPicker();
      }, { passive: true });
      sidebar.addEventListener("wheel", () => {
        if (getCountryInspectorColorPickerOpen()) {
          closeCountryInspectorColorPicker();
        }
        closeWaterInspectorColorPicker();
        closeSpecialRegionColorPicker();
      }, { passive: true });
      sidebar.dataset.adaptiveInspectorBound = "true";
    }


  };
  return {
    updateScenarioInspectorLayout,
    getInspectorDisclosureOpenState,
    setInspectorDisclosureOpenState,
    scheduleAdaptiveInspectorHeights,
    setRightSidebarTab,
    restoreRightSidebarUrlState,
    canCollapseRightSidebar,
    setRightSidebarCollapsed,
    syncEditorSelection,
    withEditorSelection,
    onNavigate,
    restoreCollapsedState,
    bindEvents,
    toggleRightSidebarCollapsed,
  };
}
