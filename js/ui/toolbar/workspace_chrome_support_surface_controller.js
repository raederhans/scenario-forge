// Workspace chrome support-surface controller.
// 这个模块负责 guide / dock support surface / URL restore / 全局 dismiss 这一层的 UI 外壳协调。
// toolbar.js 继续保留 export workbench facade、special zone facade、drawer 切换和更高层的页面编排。

export function createWorkspaceChromeSupportSurfaceController({
  state,
  uiUrlStateKeys,
  scenarioGuideBtn = null,
  utilitiesGuideBtn = null,
  scenarioGuidePopover = null,
  scenarioGuideBackdrop = null,
  openScenarioGuideSurface,
  closeScenarioGuideSurface,
  dockReferenceBtn = null,
  dockEditPopoverBtn = null,
  dockQuickFillBtn = null,
  dockReferencePopover = null,
  dockEditPopover = null,
  dockQuickFillRow = null,
  exportWorkbenchOverlay = null,
  exportWorkbenchPanel = null,
  dockExportBtn = null,
  exportProjectSection = null,
  inspectorUtilitiesSection = null,
  inspectorSidebarTabProject = null,
  appearanceSpecialZoneBtn = null,
  specialZonePopover = null,
  isSpecialZoneInline = () => false,
  closeSpecialZonePopover = () => {},
  closeTransportWorkbenchInfoPopover = () => {},
  closeTransportWorkbenchSectionHelpPopover = () => {},
  transportWorkbenchInfoPopover = null,
  transportWorkbenchInfoBtn = null,
  transportWorkbenchSectionHelpPopover = null,
  rememberOverlayTrigger,
  restoreOverlayTriggerFocus,
  focusOverlaySurface,
  getFocusableElements,
  ensureTransportWorkbenchUiState = () => {},
  ensureRightPanelVisible = () => {},
  openExportWorkbench = () => {},
  closeExportWorkbench = () => {},
} = {}) {
  let dockPopoverCloseBound = false;

  const isFocusableGuideTriggerVisible = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;
    const style = globalThis.getComputedStyle?.(element);
    if (!style || style.display === "none" || style.visibility === "hidden") return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0
      && rect.height > 0
      && rect.bottom > 0
      && rect.right > 0
      && rect.left < (globalThis.innerWidth || 0)
      && rect.top < (globalThis.innerHeight || 0);
  };

  const getGuideFocusReturnTrigger = (preferredTrigger = null) => {
    if (isFocusableGuideTriggerVisible(preferredTrigger)) return preferredTrigger;
    if (isFocusableGuideTriggerVisible(utilitiesGuideBtn)) return utilitiesGuideBtn;
    if (isFocusableGuideTriggerVisible(scenarioGuideBtn)) return scenarioGuideBtn;
    return preferredTrigger || utilitiesGuideBtn || scenarioGuideBtn || null;
  };

  const replaceUiUrlParams = (mutator) => {
    if (!globalThis.URLSearchParams || !globalThis.history?.replaceState || !globalThis.location) return;
    const params = new globalThis.URLSearchParams(globalThis.location.search || "");
    mutator?.(params);
    const nextQuery = params.toString();
    const nextUrl = `${globalThis.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${globalThis.location.hash || ""}`;
    globalThis.history.replaceState(globalThis.history.state, "", nextUrl);
  };

  const syncSupportSurfaceUrlState = (view = "") => {
    replaceUiUrlParams((params) => {
      if (view) {
        params.set(uiUrlStateKeys.view, view);
      } else if (["guide", "reference", "export"].includes(String(params.get(uiUrlStateKeys.view) || ""))) {
        params.delete(uiUrlStateKeys.view);
      }
    });
  };

  const closeScenarioGuidePopover = ({ restoreFocus = false, syncUrl = true } = {}) => {
    if (!scenarioGuidePopover) return;
    closeScenarioGuideSurface?.({
      restoreFocus,
      restoreOverlayTriggerFocus,
    });
    if (syncUrl) {
      syncSupportSurfaceUrlState("");
    }
  };

  const ensureProjectSupportSurface = (sectionKind = "utilities") => {
    ensureRightPanelVisible?.();
    inspectorSidebarTabProject?.click();
    if (inspectorSidebarTabProject && inspectorSidebarTabProject.getAttribute("aria-selected") !== "true") {
      const inspectorSidebarPanel = document.getElementById("inspectorSidebarPanel");
      const projectSidebarPanel = document.getElementById("projectSidebarPanel");
      const inspectorSidebarTabInspector = document.getElementById("inspectorSidebarTabInspector");
      inspectorSidebarTabProject.classList.add("is-active");
      inspectorSidebarTabProject.setAttribute("aria-selected", "true");
      inspectorSidebarTabInspector?.classList.remove("is-active");
      inspectorSidebarTabInspector?.setAttribute("aria-selected", "false");
      projectSidebarPanel?.classList.add("is-active");
      if (projectSidebarPanel instanceof HTMLElement) projectSidebarPanel.hidden = false;
      inspectorSidebarPanel?.classList.remove("is-active");
      if (inspectorSidebarPanel instanceof HTMLElement) inspectorSidebarPanel.hidden = true;
    }
    if (sectionKind === "export" && exportProjectSection instanceof HTMLDetailsElement) {
      exportProjectSection.open = true;
    }
    if (sectionKind !== "export" && inspectorUtilitiesSection instanceof HTMLDetailsElement) {
      inspectorUtilitiesSection.open = true;
    }
  };

  const getDockPopoverByKind = (kind) => {
    if (kind === "reference") return dockReferencePopover;
    if (kind === "edit") return dockEditPopover;
    if (kind === "quickfill") return dockQuickFillRow;
    return null;
  };

  const getDockPopoverTrigger = (kind) => {
    if (kind === "reference") return dockReferenceBtn;
    if (kind === "edit") return dockEditPopoverBtn;
    if (kind === "quickfill") return dockQuickFillBtn;
    return null;
  };

  const supportDockPopoverKinds = new Set(["reference"]);
  const isSupportDockPopoverKind = (kind) => supportDockPopoverKinds.has(String(kind || ""));

  const closeDockPopover = ({ restoreFocus = false, syncUrl = true } = {}) => {
    const activeKind = String(state.activeDockPopover || "");
    const activePopover = getDockPopoverByKind(activeKind);
    const activeTrigger = getDockPopoverTrigger(activeKind);
    state.activeDockPopover = "";
    dockReferencePopover?.classList.add("hidden");
    dockEditPopover?.classList.add("hidden");
    dockQuickFillRow?.classList.add("hidden");
    dockReferencePopover?.setAttribute("aria-hidden", "true");
    dockEditPopover?.setAttribute("aria-hidden", "true");
    dockQuickFillRow?.setAttribute("aria-hidden", "true");
    dockReferenceBtn?.classList.remove("is-active");
    dockEditPopoverBtn?.classList.remove("is-active");
    dockQuickFillBtn?.classList.remove("is-active");
    dockReferenceBtn?.setAttribute("aria-expanded", "false");
    dockEditPopoverBtn?.setAttribute("aria-expanded", "false");
    dockQuickFillBtn?.setAttribute("aria-expanded", "false");
    if (restoreFocus && activePopover) {
      restoreOverlayTriggerFocus?.(activePopover, activeTrigger);
    }
    if (syncUrl && isSupportDockPopoverKind(activeKind)) {
      syncSupportSurfaceUrlState("");
    }
  };

  const openDockPopover = (kind) => {
    const target = getDockPopoverByKind(kind);
    const trigger = getDockPopoverTrigger(kind);
    if (!target) return;
    const nextKind = state.activeDockPopover === kind ? "" : kind;
    closeDockPopover();
    if (!nextKind) return;
    if (isSupportDockPopoverKind(nextKind) && scenarioGuidePopover && !scenarioGuidePopover.classList.contains("hidden")) {
      closeScenarioGuidePopover({ restoreFocus: false, syncUrl: false });
    }
    closeExportWorkbench?.({ restoreFocus: false });
    state.activeDockPopover = nextKind;
    rememberOverlayTrigger?.(target, trigger);
    target.classList.remove("hidden");
    target.setAttribute("aria-hidden", "false");
    trigger?.classList.add("is-active");
    trigger?.setAttribute("aria-expanded", "true");
    if (isSupportDockPopoverKind(nextKind)) {
      syncSupportSurfaceUrlState(nextKind);
    }
    focusOverlaySurface?.(target);
  };

  const restoreSupportSurfaceFromUrl = () => {
    if (!globalThis.URLSearchParams || !globalThis.location) return;
    const params = new globalThis.URLSearchParams(globalThis.location.search || "");
    const view = String(params.get(uiUrlStateKeys.view) || "").trim().toLowerCase();
    if (!["guide", "reference", "export"].includes(view)) return;
    ensureTransportWorkbenchUiState?.();
    if (state.ui?.restoredSupportSurfaceViewFromUrl === view) {
      return;
    }
    if (view === "guide") {
      if (scenarioGuidePopover && !scenarioGuidePopover.classList.contains("hidden")) {
        state.ui.restoredSupportSurfaceViewFromUrl = view;
        return;
      }
      toggleScenarioGuidePopover(getGuideFocusReturnTrigger(utilitiesGuideBtn));
      state.ui.restoredSupportSurfaceViewFromUrl = view;
      return;
    }
    if (view === "export") {
      ensureProjectSupportSurface("export");
      const exportTrigger = isFocusableGuideTriggerVisible(dockExportBtn) ? dockExportBtn : null;
      openExportWorkbench?.(exportTrigger);
      state.ui.restoredSupportSurfaceViewFromUrl = view;
      return;
    }
    ensureProjectSupportSurface("utilities");
    const targetPopover = getDockPopoverByKind(view);
    if (state.activeDockPopover === view && targetPopover && !targetPopover.classList.contains("hidden")) {
      state.ui.restoredSupportSurfaceViewFromUrl = view;
      return;
    }
    openDockPopover(view);
    state.ui.restoredSupportSurfaceViewFromUrl = view;
  };

  const toggleScenarioGuidePopover = (trigger = scenarioGuideBtn) => {
    if (!scenarioGuidePopover) return;
    const willOpen = scenarioGuidePopover.classList.contains("hidden");
    if (!willOpen) {
      closeScenarioGuidePopover({ restoreFocus: true });
      return;
    }
    closeDockPopover({ restoreFocus: false, syncUrl: false });
    closeExportWorkbench?.({ restoreFocus: false });
    closeSpecialZonePopover?.();
    rememberOverlayTrigger?.(scenarioGuidePopover, trigger);
    openScenarioGuideSurface?.({ focusOverlaySurface });
    syncSupportSurfaceUrlState("guide");
  };

  const bindDockPopoverDismiss = () => {
    if (dockPopoverCloseBound) return;
    document.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const insideDockPopover = target.closest(
        "#dockReferencePopover, #dockEditPopover, #dockQuickFillRow, #dockReferenceBtn, #dockEditPopoverBtn, #dockQuickFillBtn"
      );
      if (state.activeDockPopover && !insideDockPopover) {
        closeDockPopover();
      }
      const insideSpecialZone = target.closest("#specialZonePopover, #appearanceSpecialZoneBtn");
      if (!isSpecialZoneInline() && specialZonePopover && !specialZonePopover.classList.contains("hidden") && !insideSpecialZone) {
        closeSpecialZonePopover?.();
      }
      const insideScenarioGuide = target.closest("#scenarioGuidePopover, #scenarioGuideBtn, #utilitiesGuideBtn, #scenarioGuideBackdrop");
      if (scenarioGuidePopover && !scenarioGuidePopover.classList.contains("hidden") && !insideScenarioGuide) {
        closeScenarioGuidePopover();
      }
      const insideTransportWorkbenchInfo = target.closest("#transportWorkbenchInfoPopover, #transportWorkbenchInfoBtn");
      if (transportWorkbenchInfoPopover && !transportWorkbenchInfoPopover.classList.contains("hidden") && !insideTransportWorkbenchInfo) {
        closeTransportWorkbenchInfoPopover?.();
      }
      const insideTransportWorkbenchSectionHelp = target.closest("#transportWorkbenchSectionHelpPopover, .transport-workbench-section-help-btn");
      if (transportWorkbenchSectionHelpPopover && !transportWorkbenchSectionHelpPopover.classList.contains("hidden") && !insideTransportWorkbenchSectionHelp) {
        closeTransportWorkbenchSectionHelpPopover?.();
      }
      if (
        exportWorkbenchOverlay
        && exportWorkbenchPanel
        && !exportWorkbenchOverlay.classList.contains("hidden")
        && target === exportWorkbenchOverlay
      ) {
        closeExportWorkbench?.({ restoreFocus: true });
      }
    });

    document.addEventListener("keydown", (event) => {
      if (exportWorkbenchOverlay && !exportWorkbenchOverlay.classList.contains("hidden") && event.key === "Tab") {
        const focusables = getFocusableElements?.(exportWorkbenchPanel) || [];
        if (!focusables.length) {
          event.preventDefault();
          focusOverlaySurface?.(exportWorkbenchPanel);
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus({ preventScroll: true });
          return;
        }
        if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus({ preventScroll: true });
          return;
        }
      }
      if (scenarioGuidePopover && !scenarioGuidePopover.classList.contains("hidden") && event.key === "Tab") {
        const focusables = getFocusableElements?.(scenarioGuidePopover) || [];
        if (!focusables.length) {
          event.preventDefault();
          focusOverlaySurface?.(scenarioGuidePopover);
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus({ preventScroll: true });
          return;
        }
        if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus({ preventScroll: true });
          return;
        }
      }
      if (event.key === "Escape") {
        let closedOverlay = false;
        if (state.activeDockPopover) {
          closeDockPopover({ restoreFocus: true });
          closedOverlay = true;
        }
        if (!isSpecialZoneInline()) {
          if (specialZonePopover && !specialZonePopover.classList.contains("hidden")) {
            closeSpecialZonePopover?.();
            restoreOverlayTriggerFocus?.(specialZonePopover, appearanceSpecialZoneBtn);
            closedOverlay = true;
          }
        }
        if (scenarioGuidePopover && !scenarioGuidePopover.classList.contains("hidden")) {
          closeScenarioGuidePopover({ restoreFocus: true });
          closedOverlay = true;
        }
        if (exportWorkbenchOverlay && !exportWorkbenchOverlay.classList.contains("hidden")) {
          closeExportWorkbench?.({ restoreFocus: true });
          closedOverlay = true;
        }
        if (transportWorkbenchInfoPopover && !transportWorkbenchInfoPopover.classList.contains("hidden")) {
          closeTransportWorkbenchInfoPopover?.({ restoreFocus: true });
          closedOverlay = true;
        }
        if (closedOverlay) {
          event.preventDefault();
        }
      }
    });

    dockPopoverCloseBound = true;
  };

  return {
    bindDockPopoverDismiss,
    closeDockPopover,
    closeScenarioGuidePopover,
    openDockPopover,
    restoreSupportSurfaceFromUrl,
    syncSupportSurfaceUrlState,
    toggleScenarioGuidePopover,
  };
}
