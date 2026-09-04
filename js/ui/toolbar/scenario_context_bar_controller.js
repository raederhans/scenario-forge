import { patchUiChromeState } from "../../core/state/actions/ui_chrome_actions.js";

const SCENARIO_BAR_LEFT_OFFSET = 18;
const SCENARIO_BAR_MOBILE_LEFT_OFFSET = 12;
const SCENARIO_BAR_SAFE_GAP = 16;
const SCENARIO_BAR_MIN_WIDTH = 172;
const SCENARIO_BAR_BASE_MAX_WIDTH = 560;
const SCENARIO_BAR_NARROW_WIDTH = 360;
const SCENARIO_BAR_COMPACT_WIDTH = 420;

function createScenarioContextBarController({
  runtimeState = { ui: {} },
  scenarioContextBar = null,
  scenarioContextCollapseBtn = null,
  scenarioContextScenarioText = null,
  scenarioContextModeText = null,
  scenarioContextActiveText = null,
  scenarioContextSelectionItem = null,
  scenarioContextSelectionText = null,
  scenarioTransportWorkbenchBtn = null,
  scenarioGuidePopover = null,
  mapContainer = null,
  zoomControls = null,
  getPaintModeLabel = () => "",
  getWorkspaceSelectionLabel = () => "",
  syncScenarioGuideTriggerButtons = () => {},
  updateLanguageToggleUi = () => {},
  renderOceanCoastalAccentUi = () => {},
  applyResponsiveChromeDefaults = () => {},
  updateDockCollapsedUi = () => {},
  handlePaletteLibraryResize = () => {},
  translate = (label) => label,
  globalRef = globalThis,
} = {}) {
  if (!runtimeState.ui || typeof runtimeState.ui !== "object") {
    runtimeState.ui = {};
  }
  let scenarioGuideTimerId = null;
  const translateUi = (label) => translate(label, "ui");
  const translateGeo = (label) => translate(label, "geo") || label;

  const refreshScenarioSelectionChip = () => {
    const selectionLabel = getWorkspaceSelectionLabel();
    const hasSelection = selectionLabel !== translateUi("No selection");
    if (scenarioContextSelectionItem) {
      scenarioContextSelectionItem.classList.toggle("hidden", !hasSelection);
    }
    if (scenarioContextSelectionText) {
      scenarioContextSelectionText.textContent = selectionLabel;
      scenarioContextSelectionText.setAttribute("title", `${translateUi("Selection")}: ${selectionLabel}`);
    }
  };

  const refreshWorkspaceStatus = () => {
    updateLanguageToggleUi();
    refreshScenarioSelectionChip();
    renderOceanCoastalAccentUi();
  };

  const getScenarioOverlayLeftInset = () => (
    globalRef.innerWidth <= 767 ? SCENARIO_BAR_MOBILE_LEFT_OFFSET : SCENARIO_BAR_LEFT_OFFSET
  );

  const applyScenarioOverlaySafeLayout = () => {
    if (!scenarioContextBar || !zoomControls) return;
    const overlayRect =
      scenarioContextBar.offsetParent?.getBoundingClientRect()
      || mapContainer?.closest(".map-stage")?.getBoundingClientRect()
      || mapContainer?.getBoundingClientRect()
      || { left: 0, right: globalRef.innerWidth || 0 };
    const zoomRect = zoomControls.getBoundingClientRect();
    const leftInset = getScenarioOverlayLeftInset();
    const stageWidthLimit = Math.round((overlayRect.right - overlayRect.left) - (leftInset * 2));
    const rawAvailableWidth = Math.round(
      zoomRect.left - overlayRect.left - leftInset - SCENARIO_BAR_SAFE_GAP
    );
    const availableWidth = Math.max(
      SCENARIO_BAR_MIN_WIDTH,
      Math.min(stageWidthLimit, rawAvailableWidth > 0 ? rawAvailableWidth : stageWidthLimit)
    );
    scenarioContextBar.style.setProperty("--scenario-bar-safe-max-width", `${availableWidth}px`);
    scenarioContextBar.classList.toggle("is-overlay-constrained", availableWidth < SCENARIO_BAR_BASE_MAX_WIDTH);
    scenarioContextBar.classList.toggle("is-narrow", availableWidth < SCENARIO_BAR_NARROW_WIDTH);
    scenarioContextBar.classList.toggle("is-auto-compact", availableWidth < SCENARIO_BAR_COMPACT_WIDTH);
  };

  const refreshScenarioContextBar = () => {
    if (!scenarioContextBar) return;
    const activeScenario = String(runtimeState.activeScenarioManifest?.display_name || runtimeState.activeScenarioId || "").trim();
    const activeCode = String(runtimeState.activeSovereignCode || "").trim().toUpperCase();
    const activeLabel = activeCode
      ? translateGeo(runtimeState.countryNames?.[activeCode] || activeCode)
      : translateUi("None");
    const modeLabel = getPaintModeLabel();
    const scenarioViewLabel = String(runtimeState.scenarioViewMode || "ownership") === "frontline"
      ? translateUi("Frontline")
      : translateUi("Ownership");
    const showScenarioState = !!activeScenario;
    const activeValue = activeCode ? `${activeLabel} (${activeCode})` : translateUi("None");
    scenarioContextBar.classList.toggle("is-scenario", !!activeScenario);
    scenarioContextBar.classList.toggle("is-collapsed", !!runtimeState.ui.scenarioBarCollapsed);
    if (scenarioContextScenarioText) {
      const scenarioValue = activeScenario || translateUi("None");
      scenarioContextScenarioText.textContent = scenarioValue;
      scenarioContextScenarioText.setAttribute("title", `${translateUi("Scenario")}: ${scenarioValue}`);
    }
    if (scenarioContextModeText) {
      scenarioContextModeText.textContent = modeLabel;
      scenarioContextModeText.setAttribute(
        "title",
        showScenarioState
          ? `${translateUi("Mode")}: ${modeLabel} · ${translateUi("View")}: ${scenarioViewLabel}`
          : `${translateUi("Mode")}: ${modeLabel}`
      );
    }
    if (scenarioContextActiveText) {
      scenarioContextActiveText.textContent = activeValue;
      scenarioContextActiveText.setAttribute("title", `${translateUi("Active")}: ${activeValue}`);
    }
    if (scenarioContextCollapseBtn) {
      scenarioContextCollapseBtn.textContent = runtimeState.ui.scenarioBarCollapsed ? "+" : "-";
      scenarioContextCollapseBtn.setAttribute("aria-label", runtimeState.ui.scenarioBarCollapsed
        ? translateUi("Expand")
        : translateUi("Collapse"));
    }
    syncScenarioGuideTriggerButtons({
      isOpen: !!(scenarioGuidePopover && !scenarioGuidePopover.classList.contains("hidden")),
      tutorialEntryVisible: !!runtimeState.ui.tutorialEntryVisible,
    });
    if (scenarioTransportWorkbenchBtn) {
      const transportEntryLabel = scenarioTransportWorkbenchBtn.dataset.transportEntryLabel || "Transport";
      scenarioTransportWorkbenchBtn.textContent = translateUi(transportEntryLabel);
      scenarioTransportWorkbenchBtn.setAttribute("title", runtimeState.transportWorkbenchUi?.open
        ? translateUi("Close transport workbench")
        : translateUi("Open transport workbench"));
    }
    refreshWorkspaceStatus();
    applyScenarioOverlaySafeLayout();
  };

  const triggerScenarioGuide = () => {
    if (!scenarioContextBar) return;
    scenarioContextBar.classList.add("is-highlight");
    if (scenarioGuideTimerId) {
      globalRef.clearTimeout?.(scenarioGuideTimerId);
    }
    scenarioGuideTimerId = globalRef.setTimeout?.(() => {
      scenarioContextBar.classList.remove("is-highlight");
    }, 3000) || null;
  };

  const bindScenarioContextBarEvents = () => {
    if (scenarioContextCollapseBtn && !scenarioContextCollapseBtn.dataset.bound) {
      scenarioContextCollapseBtn.addEventListener("click", () => {
        patchUiChromeState(runtimeState, {
          scenarioBarCollapsed: !runtimeState.ui.scenarioBarCollapsed,
        });
        refreshScenarioContextBar();
      });
      scenarioContextCollapseBtn.dataset.bound = "true";
    }
  };

  const bindResponsiveChromeLayout = () => {
    if (!runtimeState.ui.overlayResizeBound) {
      const refreshResponsiveChromeLayout = () => {
        applyResponsiveChromeDefaults();
        updateDockCollapsedUi();
        refreshScenarioContextBar();
        handlePaletteLibraryResize();
      };
      globalRef.addEventListener("resize", refreshResponsiveChromeLayout);
      globalRef.addEventListener("mapcreator:sidebar-layout-refresh", refreshResponsiveChromeLayout);
      patchUiChromeState(runtimeState, { overlayResizeBound: true });
    }
  };

  return {
    applyScenarioOverlaySafeLayout,
    bindResponsiveChromeLayout,
    bindScenarioContextBarEvents,
    refreshScenarioContextBar,
    refreshScenarioSelectionChip,
    refreshWorkspaceStatus,
    triggerScenarioGuide,
  };
}

export { createScenarioContextBarController };
