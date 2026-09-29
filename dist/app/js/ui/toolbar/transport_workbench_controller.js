// Transport workbench controller.
// 这个模块负责 transport workbench 当前的状态归一、面板渲染、预览联动和事件委派，尚不声明完整应用链所有权。
// toolbar.js 继续保留全局 overlay 协调、URL restore、顶层 chrome 和其他 support surface 的仲裁。

import {
  state as runtimeState,
} from "../../core/state.js";
import { markDirty } from "../../core/dirty_state.js";
import { t } from "../i18n.js";
import {
  focusSurface as focusOverlaySurface,
  rememberSurfaceTrigger as rememberOverlayTrigger,
  restoreSurfaceTriggerFocus as restoreOverlayTriggerFocus,
} from "../ui_contract.js";
import {
  getTransportWorkbenchCarrierViewState,
  resetTransportWorkbenchCarrierView,
  setTransportWorkbenchCarrierFamily,
  stepTransportWorkbenchCarrierZoom,
  toggleTransportWorkbenchCarrierQuarterTurn,
} from "../transport_workbench_carrier.js";
import {
  getTransportWorkbenchFamilyPreviewSnapshot,
} from "../transport_workbench_family_preview.js";
import {
  isTransportWorkbenchLivePreviewFamily,
  isTransportWorkbenchManifestOnlyRuntimeFamily,
} from "../transport_workbench_family_registry.js";
import {
  getTransportWorkbenchPackMeta,
  listTransportWorkbenchPacks,
} from "../../core/transport_pack_resolver.js";
import {
  createTransportWorkbenchApplyBridgeOwner,
} from "./transport_workbench_apply_bridge_owner.js";
import {
  createTransportWorkbenchPreviewLifecycleOwner,
} from "./transport_workbench_preview_lifecycle_owner.js";
import {
  createTransportWorkbenchStateOwner,
} from "./transport_workbench_state_owner.js";
import {
  createTransportWorkbenchInspectorOwner,
} from "./transport_workbench_inspector_owner.js";
import {
  createTransportWorkbenchLayerOrderOwner,
} from "./transport_workbench_layer_order_owner.js";
import {
  createTransportWorkbenchLensOwner,
} from "./transport_workbench_lens_owner.js";
import {
  createTransportWorkbenchPopoverOwner,
} from "./transport_workbench_popover_owner.js";
import {
  createTransportWorkbenchRightDeckOwner,
} from "./transport_workbench_right_deck_owner.js";
import {
  createTransportWorkbenchShellOwner,
} from "./transport_workbench_shell_owner.js";
import {
  createTransportWorkbenchEventOwner,
} from "./transport_workbench_event_owner.js";
import {
  TRANSPORT_WORKBENCH_FAMILIES,
  TRANSPORT_WORKBENCH_INSPECTOR_TABS,
  TRANSPORT_WORKBENCH_DATA_CONTRACTS,
} from "./transport_workbench_descriptor.js";

export { TRANSPORT_WORKBENCH_INSPECTOR_TABS };
export { TRANSPORT_WORKBENCH_INSPECTOR_TAB_IDS } from "./transport_workbench_config_owner.js";

export function createTransportWorkbenchController({
  scenarioTransportWorkbenchBtn = null,
  transportAppearanceWorkbenchBtn = null,
  transportWorkbenchOverlay = null,
  transportWorkbenchPanel = null,
  transportWorkbenchInfoBtn = null,
  transportWorkbenchInfoPopover = null,
  transportWorkbenchInfoBody = null,
  transportWorkbenchSectionHelpPopover = null,
  transportWorkbenchSectionHelpTitle = null,
  transportWorkbenchSectionHelpBody = null,
  transportWorkbenchCloseBtn = null,
  transportWorkbenchResetBtn = null,
  transportWorkbenchApplyBtn = null,
  transportWorkbenchTitle = null,
  transportWorkbenchLensTitle = null,
  transportWorkbenchLensSections = null,
  transportWorkbenchFamilyStatus = null,
  transportWorkbenchCountryStatus = null,
  transportWorkbenchPackSelect = null,
  transportWorkbenchPreviewMode = null,
  transportWorkbenchPreviewTitle = null,
  transportWorkbenchPreviewCanvas = null,
  transportWorkbenchPreviewControls = null,
  transportWorkbenchCarrierMount = null,
  transportWorkbenchLayerOrderPanel = null,
  transportWorkbenchLayerOrderList = null,
  transportWorkbenchZoomOutBtn = null,
  transportWorkbenchZoomInBtn = null,
  transportWorkbenchRotateBtn = null,
  transportWorkbenchInspectorTitle = null,
  transportWorkbenchInspectorTabButtons = [],
  transportWorkbenchInspectorPanels = {},
  transportWorkbenchInspectorDetails = null,
  transportWorkbenchInspectorEmptyTitle = null,
  transportWorkbenchInspectorEmptyBody = null,
  transportWorkbenchDisplaySections = null,
  transportWorkbenchAggregationSections = null,
  transportWorkbenchLabelSections = null,
  transportWorkbenchCoverageSections = null,
  transportWorkbenchDataSections = null,
  transportWorkbenchFamilyTabs = [],
} = {}) {
  // controller 只拥有 workbench 自己的 overlay/panel/preview 交互闭环。
  // 更高层的 toolbar surface 仲裁、别的工作台切换、URL restore 仍由 toolbar.js 处理。
  const transportWorkbenchStateOwner = createTransportWorkbenchStateOwner(runtimeState);
  const ensureTransportWorkbenchUiState = () => transportWorkbenchStateOwner.ensureUiState();
  const resetTransportWorkbenchSectionState = () => transportWorkbenchStateOwner.resetSectionState();
  let pendingWorkbenchRefreshFrame = 0;
  let pendingWorkbenchAllowCarrierPrep = false;

  const transportWorkbenchApplyBridgeOwner = createTransportWorkbenchApplyBridgeOwner(runtimeState, {
    shouldRerender: (normalizedPackId) => isCurrentTransportWorkbenchPackGate(normalizedPackId),
    renderTransportWorkbenchUi: () => renderTransportWorkbenchUi(),
  });

  const transportWorkbenchPreviewLifecycleOwner = createTransportWorkbenchPreviewLifecycleOwner(runtimeState, {
    ensureUiState: () => ensureTransportWorkbenchUiState(),
    getCarrierMount: () => transportWorkbenchCarrierMount,
    getRenderContext: () => getTransportWorkbenchRenderContext(),
    renderInspector: (family, config, compareHeld) => renderTransportWorkbenchInspector(family, config, compareHeld),
    renderLayerOrderPanel: () => renderTransportWorkbenchLayerOrderPanel(),
    renderLensSections: (family, config, compareHeld) => renderTransportWorkbenchLensSections(family, config, compareHeld),
    syncPreviewControls: () => syncTransportWorkbenchPreviewControls(),
  });

  const transportWorkbenchInspectorOwner = createTransportWorkbenchInspectorOwner({
    getLayerOrder: () => runtimeState.transportWorkbenchUi?.layerOrder || [],
    getLayerFamilyMeta: (familyId) => getTransportWorkbenchLayerFamilyMeta(familyId),
    isLivePreviewFamily: (familyId) => isTransportWorkbenchLivePreviewFamily(familyId),
    isManifestOnlyRuntimeFamily: (familyId) => isTransportWorkbenchManifestOnlyRuntimeFamily(familyId),
  });

  const transportWorkbenchLayerOrderOwner = createTransportWorkbenchLayerOrderOwner({
    panel: transportWorkbenchLayerOrderPanel,
    list: transportWorkbenchLayerOrderList,
    translate: (label) => t(label, "ui"),
    ensureUiState: () => ensureTransportWorkbenchUiState(),
    getLayerOrder: () => runtimeState.transportWorkbenchUi?.layerOrder || [],
    getLayerFamilyMeta: (familyId) => getTransportWorkbenchLayerFamilyMeta(familyId),
    isLivePreviewFamily: (familyId) => isTransportWorkbenchLivePreviewFamily(familyId),
    isManifestOnlyRuntimeFamily: (familyId) => isTransportWorkbenchManifestOnlyRuntimeFamily(familyId),
    moveLayerOrder: (draggedFamilyId, targetFamilyId) => transportWorkbenchStateOwner.moveLayerOrder(draggedFamilyId, targetFamilyId),
    markDirty: (reason) => markDirty(reason),
    getRenderContext: () => getTransportWorkbenchRenderContext(),
    renderInspector: (family, config, compareHeld) => renderTransportWorkbenchInspector(family, config, compareHeld),
  });

  const getTransportWorkbenchDataContract = (familyId) => TRANSPORT_WORKBENCH_DATA_CONTRACTS[familyId] || null;
  const pickUiCopy = (zh, en) => (runtimeState.currentLanguage === "zh" ? zh : en);
  const transportWorkbenchPopoverOwner = createTransportWorkbenchPopoverOwner({
    panel: transportWorkbenchPanel,
    infoButton: transportWorkbenchInfoBtn,
    infoPopover: transportWorkbenchInfoPopover,
    infoBody: transportWorkbenchInfoBody,
    sectionHelpPopover: transportWorkbenchSectionHelpPopover,
    sectionHelpTitle: transportWorkbenchSectionHelpTitle,
    sectionHelpBody: transportWorkbenchSectionHelpBody,
    translate: (label) => t(label, "ui"),
    pickUiCopy,
    getDataContract: (familyId) => getTransportWorkbenchDataContract(familyId),
    focusSurface: (surface) => focusOverlaySurface(surface),
    rememberTrigger: (surface, trigger) => rememberOverlayTrigger(surface, trigger),
  });
  const closeTransportWorkbenchInfoPopover = (options) => transportWorkbenchPopoverOwner.closeInfoPopover(options);
  const closeTransportWorkbenchSectionHelpPopover = (options) => transportWorkbenchPopoverOwner.closeSectionHelpPopover(options);
  const transportWorkbenchShellOwner = createTransportWorkbenchShellOwner({
    body: document.body,
    scenarioButton: scenarioTransportWorkbenchBtn,
    overlay: transportWorkbenchOverlay,
    title: transportWorkbenchTitle,
    lensTitle: transportWorkbenchLensTitle,
    familyStatus: transportWorkbenchFamilyStatus,
    countryStatus: transportWorkbenchCountryStatus,
    packSelect: transportWorkbenchPackSelect,
    previewMode: transportWorkbenchPreviewMode,
    previewTitle: transportWorkbenchPreviewTitle,
    previewCanvas: transportWorkbenchPreviewCanvas,
    previewControls: transportWorkbenchPreviewControls,
    carrierMount: transportWorkbenchCarrierMount,
    layerOrderPanel: transportWorkbenchLayerOrderPanel,
    zoomOutButton: transportWorkbenchZoomOutBtn,
    zoomInButton: transportWorkbenchZoomInBtn,
    rotateButton: transportWorkbenchRotateBtn,
    inspectorTitle: transportWorkbenchInspectorTitle,
    inspectorEmptyTitle: transportWorkbenchInspectorEmptyTitle,
    inspectorEmptyBody: transportWorkbenchInspectorEmptyBody,
    familyTabs: transportWorkbenchFamilyTabs,
    applyButton: transportWorkbenchApplyBtn,
    translate: (label) => t(label, "ui"),
    listPackOptions: ({ familyId }) => listTransportWorkbenchPacks({ familyId }),
    getApplyButtonState: (familyId) => getTransportWorkbenchApplyButtonState(familyId),
    getCarrierViewState: () => getTransportWorkbenchCarrierViewState(),
    setCarrierFamily: (familyId) => setTransportWorkbenchCarrierFamily(familyId),
    isInfoPopoverOpen: () => transportWorkbenchPopoverOwner.isInfoPopoverOpen(),
    renderInfoContent: (family) => transportWorkbenchPopoverOwner.renderInfoContent(family),
  });

  const transportWorkbenchLensOwner = createTransportWorkbenchLensOwner({
    mount: transportWorkbenchLensSections,
    closeSectionHelpPopover: (options) => transportWorkbenchPopoverOwner.closeSectionHelpPopover(options),
    translate: (label) => t(label, "ui"),
    pickUiCopy,
    createRow: (label, value) => transportWorkbenchInspectorOwner.createRow(label, value),
    buildLensSummaryRows: (input) => transportWorkbenchInspectorOwner.buildLensSummaryRows(input),
  });

  const transportWorkbenchRightDeckOwner = createTransportWorkbenchRightDeckOwner({
    tabButtons: transportWorkbenchInspectorTabButtons,
    panels: transportWorkbenchInspectorPanels,
    mounts: {
      display: transportWorkbenchDisplaySections,
      aggregation: transportWorkbenchAggregationSections,
      labels: transportWorkbenchLabelSections,
      coverage: transportWorkbenchCoverageSections,
      data: transportWorkbenchDataSections,
    },
    translate: (label) => t(label, "ui"),
    pickUiCopy,
    setInspectorTab: (tabId) => transportWorkbenchStateOwner.setInspectorTab(tabId),
    getDisplayConfig: (familyId) => getTransportWorkbenchDisplayConfig(familyId),
    isSectionOpen: (familyId, sectionKey) => !!runtimeState.transportWorkbenchUi?.sectionOpen?.[familyId]?.[sectionKey],
    updateFamilyConfig: (familyId, key, nextValue, options) => updateTransportWorkbenchFamilyConfig(familyId, key, nextValue, options),
    updateDisplayConfig: (familyId, updateFn) => updateTransportWorkbenchDisplayConfig(familyId, updateFn),
    toggleSection: (familyId, sectionKey, nextOpen) => toggleTransportWorkbenchSection(familyId, sectionKey, nextOpen),
    createSectionHelpButton: (familyId, section) => transportWorkbenchPopoverOwner.createSectionHelpButton(familyId, section),
    renderDiagnosticsBody: (familyId, config) => transportWorkbenchInspectorOwner.renderDiagnosticsBody(familyId, config),
    getEditOverlay: (familyId) => transportWorkbenchStateOwner.getEditOverlay(familyId),
    addEditOverlayPoint: (familyId, point) => addTransportWorkbenchEditOverlayPoint(familyId, point),
    removeEditOverlayPoint: (familyId, featureId) => removeTransportWorkbenchEditOverlayPoint(familyId, featureId),
    updateEditOverlayPoint: (familyId, featureId, point) => updateTransportWorkbenchEditOverlayPoint(familyId, featureId, point),
    deleteEditOverlayPoint: (familyId, featureId) => deleteTransportWorkbenchEditOverlayPoint(familyId, featureId),
  });
  const transportWorkbenchEventOwner = createTransportWorkbenchEventOwner({
    documentRef: document,
    body: document.body,
    scenarioButton: scenarioTransportWorkbenchBtn,
    appearanceButton: transportAppearanceWorkbenchBtn,
    infoButton: transportWorkbenchInfoBtn,
    closeButton: transportWorkbenchCloseBtn,
    resetButton: transportWorkbenchResetBtn,
    zoomOutButton: transportWorkbenchZoomOutBtn,
    zoomInButton: transportWorkbenchZoomInBtn,
    rotateButton: transportWorkbenchRotateBtn,
    applyButton: transportWorkbenchApplyBtn,
    packSelect: transportWorkbenchPackSelect,
    familyTabs: transportWorkbenchFamilyTabs,
    inspectorTabButtons: transportWorkbenchInspectorTabButtons,
    actions: {
      isOpen: () => !!runtimeState.transportWorkbenchUi?.open,
      setOpen: (nextOpen, options) => setTransportWorkbenchState(nextOpen, options),
      toggleInfoPopover: () => transportWorkbenchPopoverOwner.toggleInfoPopover(getTransportWorkbenchFamilyMeta()),
      resetView: () => resetTransportWorkbenchView(),
      stepCarrierZoom: (step) => stepTransportWorkbenchCarrierZoom(step),
      rotateCarrier: () => toggleTransportWorkbenchCarrierQuarterTurn(),
      syncPreviewControls: () => syncTransportWorkbenchPreviewControls(),
      getRenderContext: () => getTransportWorkbenchRenderContext(),
      getApplyButtonState: (familyId) => getTransportWorkbenchApplyButtonState(familyId),
      applyFamilyToMainMap: (context) => applyTransportWorkbenchFamilyToMainMap(context),
      renderShell: (context) => renderTransportWorkbenchShell(context),
      setActivePackId: (packId) => setTransportWorkbenchActivePackId(packId),
      setActiveFamily: (familyId) => transportWorkbenchStateOwner.setActiveFamily(familyId),
      renderUi: () => renderTransportWorkbenchUi(),
      setInspectorTab: (tabId) => transportWorkbenchStateOwner.setInspectorTab(tabId),
      renderInspector: (family, config, compareHeld) => renderTransportWorkbenchInspector(family, config, compareHeld),
      handlePopoverEscape: (event) => transportWorkbenchPopoverOwner.handleEscape(event),
    },
  });

  const getTransportWorkbenchFamilyMeta = () => transportWorkbenchStateOwner.getFamilyMeta();

  const getTransportWorkbenchWorkingConfig = (familyId) => {
    return transportWorkbenchStateOwner.getWorkingConfig(familyId);
  };

  const getTransportWorkbenchDisplayConfig = (familyId) => {
    return transportWorkbenchStateOwner.getDisplayConfig(familyId);
  };

  const buildTransportWorkbenchResolvedConfig = (familyId, familyConfig, displayConfig) => {
    const activePackId = getTransportWorkbenchActivePackId(familyId);
    // live preview 只认一份扁平 config；state owner 负责把 displayConfig 映射回旧 preview 合约。
    return transportWorkbenchStateOwner.buildResolvedConfig(familyId, familyConfig, displayConfig, activePackId);
  };

  const getTransportWorkbenchConfigSignature = (config) => JSON.stringify(config || {});

  const getTransportWorkbenchActivePackId = (familyId) => (
    transportWorkbenchApplyBridgeOwner.getActivePackId(familyId)
  );

  const isCurrentTransportWorkbenchPackGate = (normalizedPackId) => (
    runtimeState.transportWorkbenchUi?.open
    && getTransportWorkbenchActivePackId(runtimeState.transportWorkbenchUi.activeFamily) === normalizedPackId
  );

  const refreshTransportWorkbenchPackGateReport = (packId, { rerender = false } = {}) => (
    transportWorkbenchApplyBridgeOwner.refreshPackGateReport(packId, {
      rerender,
    })
  );

  const setTransportWorkbenchActivePackId = (packId, { rerender = true } = {}) => {
    const meta = transportWorkbenchStateOwner.setActivePackId(packId);
    if (!meta) return false;
    refreshTransportWorkbenchPackGateReport(meta.packId, { rerender: true });
    if (rerender) renderTransportWorkbenchUi();
    return true;
  };

  const getTransportWorkbenchApplyButtonState = (familyId) => (
    transportWorkbenchApplyBridgeOwner.getApplyButtonState(familyId)
  );

  const applyTransportWorkbenchFamilyToMainMap = (context) => (
    transportWorkbenchApplyBridgeOwner.applyFamilyToMainMap(context)
  );

  const requestWorkbenchRefreshFrame = (callback) => {
    if (typeof globalThis.requestAnimationFrame === "function") {
      return globalThis.requestAnimationFrame(callback);
    }
    return globalThis.setTimeout(callback, 16);
  };

  const cancelWorkbenchRefreshFrame = (frameId) => {
    if (!frameId) return;
    if (typeof globalThis.cancelAnimationFrame === "function") {
      globalThis.cancelAnimationFrame(frameId);
    } else {
      globalThis.clearTimeout(frameId);
    }
  };

  const scheduleTransportWorkbenchSurfaceRefresh = ({ allowCarrierPrep = false } = {}) => {
    pendingWorkbenchAllowCarrierPrep = pendingWorkbenchAllowCarrierPrep || !!allowCarrierPrep;
    if (pendingWorkbenchRefreshFrame) return;
    pendingWorkbenchRefreshFrame = requestWorkbenchRefreshFrame(() => {
      pendingWorkbenchRefreshFrame = 0;
      const allowCarrierPrepForFrame = pendingWorkbenchAllowCarrierPrep;
      pendingWorkbenchAllowCarrierPrep = false;
      const nextContext = getTransportWorkbenchRenderContext();
      if (!nextContext.isOpen) return;
      renderTransportWorkbenchLensSections(nextContext.family, nextContext.config, nextContext.compareHeld);
      renderTransportWorkbenchInspector(nextContext.family, nextContext.config, nextContext.compareHeld);
      refreshTransportWorkbenchPreview(nextContext, { allowCarrierPrep: allowCarrierPrepForFrame });
    });
  };

  const updateTransportWorkbenchFamilyConfig = (familyId, key, nextValue, { appendValue = null } = {}) => {
    if (!transportWorkbenchStateOwner.updateFamilyConfig(familyId, key, nextValue, { appendValue })) return;
    // 控件改动先落到工作台 state，再合并到下一帧刷新；这里不直接改 renderer 的正式图层状态。
    markDirty("transport-workbench-config");
    scheduleTransportWorkbenchSurfaceRefresh({ allowCarrierPrep: false });
  };

  const updateTransportWorkbenchDisplayConfig = (familyId, updateFn) => {
    if (!transportWorkbenchStateOwner.updateDisplayConfig(familyId, updateFn)) return;
    markDirty("transport-workbench-display-config");
    scheduleTransportWorkbenchSurfaceRefresh({ allowCarrierPrep: false });
  };

  const refreshTransportWorkbenchAfterEditOverlayChange = () => {
    markDirty("transport-workbench-point-deltas");
    const nextContext = getTransportWorkbenchRenderContext();
    scheduleTransportWorkbenchSurfaceRefresh({ allowCarrierPrep: false });
    return nextContext;
  };

  const addTransportWorkbenchEditOverlayPoint = (familyId, point) => {
    const created = transportWorkbenchStateOwner.addEditOverlayPoint(familyId, point);
    if (!created) return null;
    refreshTransportWorkbenchAfterEditOverlayChange();
    return created;
  };

  const removeTransportWorkbenchEditOverlayPoint = (familyId, featureId) => {
    if (!transportWorkbenchStateOwner.removeEditOverlayPoint(familyId, featureId)) return false;
    refreshTransportWorkbenchAfterEditOverlayChange();
    return true;
  };

  const updateTransportWorkbenchEditOverlayPoint = (familyId, featureId, point) => {
    const updated = transportWorkbenchStateOwner.updateEditOverlayPoint(familyId, featureId, point);
    if (!updated) return null;
    refreshTransportWorkbenchAfterEditOverlayChange();
    return updated;
  };

  const deleteTransportWorkbenchEditOverlayPoint = (familyId, featureId) => {
    if (!transportWorkbenchStateOwner.deleteEditOverlayPoint(familyId, featureId)) return false;
    refreshTransportWorkbenchAfterEditOverlayChange();
    return true;
  };

  const toggleTransportWorkbenchSection = (familyId, sectionKey, nextOpen) => {
    transportWorkbenchStateOwner.toggleSection(familyId, sectionKey, nextOpen);
  };

  const getTransportWorkbenchLayerFamilyMeta = (familyId) => (
    TRANSPORT_WORKBENCH_FAMILIES.find((family) => family.id === familyId)
    || TRANSPORT_WORKBENCH_FAMILIES[0]
  );

  const renderTransportWorkbenchLayerOrderPanel = () => transportWorkbenchLayerOrderOwner.render();

  const renderTransportWorkbenchInspectorTabs = (family, config, compareHeld) => {
    transportWorkbenchRightDeckOwner.renderTabs({
      family,
      config,
      compareHeld,
      activeTab: runtimeState.transportWorkbenchUi.activeInspectorTab,
    });
  };

  const renderTransportWorkbenchLensSections = (family, config, compareHeld) => {
    const previewSnapshot = getTransportWorkbenchFamilyPreviewSnapshot(family.id, config);
    const dataContract = getTransportWorkbenchDataContract(family.id);
    transportWorkbenchLensOwner.render({
      family,
      previewSnapshot,
      dataContract,
      compareHeld,
      rightDeckLabel: t("Display / Aggregation / Labels / Coverage / Data", "ui"),
    });
  };

  const renderTransportWorkbenchInspector = (family, config, compareHeld) => {
    if (transportWorkbenchInspectorDetails) {
      const inspectorEmptyCard = transportWorkbenchInspectorEmptyTitle?.parentElement || null;
      const dataContract = getTransportWorkbenchDataContract(family.id);
      const previewSnapshot = getTransportWorkbenchFamilyPreviewSnapshot(family.id, config);
      transportWorkbenchInspectorOwner.renderInspectorDetails({
        detailsNode: transportWorkbenchInspectorDetails,
        emptyCard: inspectorEmptyCard,
        family,
        config,
        compareHeld,
        previewSnapshot,
        dataContract,
      });
    }
    renderTransportWorkbenchInspectorTabs(family, config, compareHeld);
  };

  const syncTransportWorkbenchPreviewControls = () => {
    transportWorkbenchShellOwner.syncPreviewControls();
  };

  const getTransportWorkbenchRenderContext = () => {
    ensureTransportWorkbenchUiState();
    const uiState = runtimeState.transportWorkbenchUi;
    const family = getTransportWorkbenchFamilyMeta();
    const isOpen = !!uiState.open;
    const compareHeld = false;
    const familyConfig = getTransportWorkbenchWorkingConfig(family.id);
    const displayConfig = getTransportWorkbenchDisplayConfig(family.id);
    // context 是 shell、lens、inspect 和 preview 的共同输入，避免四处重复读取 runtimeState。
    const config = buildTransportWorkbenchResolvedConfig(family.id, familyConfig, displayConfig);
    const activePackId = getTransportWorkbenchActivePackId(family.id);
    const activePackMeta = getTransportWorkbenchPackMeta(activePackId);
    return {
      uiState,
      family,
      activePackId,
      activePackMeta,
      isOpen,
      compareHeld,
      displayConfig,
      config,
    };
  };

  const refreshTransportWorkbenchPreview = (context, { allowCarrierPrep = true } = {}) => (
    transportWorkbenchPreviewLifecycleOwner.refreshPreview(context, { allowCarrierPrep })
  );

  const renderTransportWorkbenchShell = (context) => {
    transportWorkbenchShellOwner.render(context);
  };

  const renderTransportWorkbenchUi = () => {
    if (
      !transportWorkbenchOverlay
      || !transportWorkbenchPanel
      || !transportWorkbenchTitle
      || !transportWorkbenchLensTitle
      || !transportWorkbenchPreviewTitle
      || !transportWorkbenchInspectorTitle
    ) {
      return;
    }
    const context = getTransportWorkbenchRenderContext();
    renderTransportWorkbenchShell(context);
    renderTransportWorkbenchLensSections(context.family, context.config, context.compareHeld);
    renderTransportWorkbenchInspector(context.family, context.config, context.compareHeld);
    refreshTransportWorkbenchPackGateReport(context.activePackId, { rerender: true });
    refreshTransportWorkbenchPreview(context);
  };

  const setTransportWorkbenchState = (nextOpen, { trigger = null, restoreFocus = true } = {}) => {
    if (!transportWorkbenchOverlay || !transportWorkbenchPanel) {
      return;
    }
    ensureTransportWorkbenchUiState();
    let uiState = runtimeState.transportWorkbenchUi;
    const wasOpen = !!uiState.open;
    const willOpen = !!nextOpen;
    if (willOpen === wasOpen && !willOpen) {
      renderTransportWorkbenchUi();
      if (typeof runtimeState.syncFacilityInfoCardVisibilityFn === "function") {
        runtimeState.syncFacilityInfoCardVisibilityFn();
      }
      return;
    }
    if (willOpen) {
      // 打开时先收拢会抢布局或焦点的兄弟 surface，再记住 trigger 并进入新 overlay。
      // 关闭时则反过来按 restoreState 恢复抽屉/焦点，preview dispose 放在真正 close 分支里执行。
      transportWorkbenchStateOwner.prepareOpenState({
        restoreLeftDrawer: document.body.classList.contains("left-drawer-open"),
        restoreRightDrawer: document.body.classList.contains("right-drawer-open"),
      });
      resetTransportWorkbenchSectionState();
      runtimeState.toggleLeftPanelFn?.(false);
      runtimeState.toggleRightPanelFn?.(false);
      runtimeState.closeDockPopoverFn?.({ restoreFocus: false });
      runtimeState.closeExportWorkbenchFn?.({ restoreFocus: false });
      closeTransportWorkbenchInfoPopover({ restoreFocus: false });
      closeTransportWorkbenchSectionHelpPopover({ restoreFocus: false });
      if (trigger instanceof HTMLElement && transportWorkbenchOverlay instanceof HTMLElement) {
        rememberOverlayTrigger(transportWorkbenchOverlay, trigger);
      }
    }
    // section reset 可能补齐最新 uiState 结构，这里统一回读当前对象后再落 open 状态。
    uiState = transportWorkbenchStateOwner.setOpenState(willOpen);
    renderTransportWorkbenchUi();
    if (typeof runtimeState.syncFacilityInfoCardVisibilityFn === "function") {
      runtimeState.syncFacilityInfoCardVisibilityFn();
    }
    if (willOpen) {
      focusOverlaySurface(transportWorkbenchPanel);
      return;
    }
    cancelWorkbenchRefreshFrame(pendingWorkbenchRefreshFrame);
    pendingWorkbenchRefreshFrame = 0;
    pendingWorkbenchAllowCarrierPrep = false;
    const restoreState = transportWorkbenchStateOwner.prepareCloseState();
    transportWorkbenchPreviewLifecycleOwner.dispose();
    closeTransportWorkbenchInfoPopover({ restoreFocus: false });
    closeTransportWorkbenchSectionHelpPopover({ restoreFocus: false });
    runtimeState.toggleLeftPanelFn?.(restoreState.restoreLeftDrawer);
    runtimeState.toggleRightPanelFn?.(!restoreState.restoreLeftDrawer && restoreState.restoreRightDrawer);
    if (restoreFocus) {
      restoreOverlayTriggerFocus(transportWorkbenchOverlay);
    }
  };

  const resetTransportWorkbenchView = () => {
    ensureTransportWorkbenchUiState();
    resetTransportWorkbenchCarrierView();
    syncTransportWorkbenchPreviewControls();
  };

  const openTransportWorkbench = (trigger = null) => {
    setTransportWorkbenchState(true, { trigger });
    return true;
  };

  const closeTransportWorkbench = ({ restoreFocus = true } = {}) => {
    setTransportWorkbenchState(false, { restoreFocus });
    return false;
  };

  const initializeTransportWorkbenchRuntime = () => {
    transportWorkbenchPreviewLifecycleOwner.initializeRuntimeHooks();
  };

  const bindTransportWorkbenchEvents = () => {
    transportWorkbenchEventOwner.bind();
  };

  return {
    bindTransportWorkbenchEvents,
    closeTransportWorkbenchInfoPopover,
    closeTransportWorkbenchSectionHelpPopover,
    closeTransportWorkbench,
    ensureTransportWorkbenchUiState,
    initializeTransportWorkbenchRuntime,
    openTransportWorkbench,
    renderTransportWorkbenchUi,
  };
}
