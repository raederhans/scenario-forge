import {
  renderUnitCounterCatalogSection,
} from "./strategic_overlay/unit_counter_catalog_helper.js";
import { setUnitCounterEditorModalState } from "./strategic_overlay/unit_counter_modal_helper.js";
import { bindUnitCounterSidebarEvents } from "./strategic_overlay/unit_counter_bind_events_helper.js";
import {
  buildUnitCounterSectionViewModel,
  refreshUnitCounterCombatSection,
  refreshUnitCounterIdentitySection,
  refreshUnitCounterListSection,
  refreshUnitCounterPreviewSection,
} from "./strategic_overlay/unit_counter_render_helpers.js";

/**
 * Owns the strategic overlay workspace inside the sidebar:
 * - frontline overlay controls and refresh scheduling
 * - strategic workspace chrome and modal state
 * - operational line / operation graphic / unit counter editor interactions
 *
 * sidebar.js keeps the higher-level facade:
 * - right-sidebar tab and URL shell
 * - state callback registration
 * - project import hook wiring
 * - DOM surface creation and host layout orchestration
 */
export function createStrategicOverlayController({
  state,
  elements,
  helpers,
}) {
  const {
    frontlineEnabledStatus,
    frontlineStatusHint,
    frontlineEnabledToggle,
    frontlineEmptyState,
    frontlineSettingsPanel,
    strategicFrontlineStyleSelect,
    frontlineStyleChoiceButtons,
    strategicFrontlineLabelsToggle,
    strategicLabelPlacementSelect,
    strategicOverlaySection,
    strategicWorkspaceBackdropEl,
    strategicOverlayOpenWorkspaceBtn,
    strategicOverlayCloseWorkspaceBtn,
    strategicOverlayIconCloseBtn,
    unitCounterDetailDrawer,
    unitCounterDetailToggleBtn,
    operationalLineKindSelect,
    operationalLineLabelInput,
    operationalLineStrokeInput,
    operationalLineWidthInput,
    operationalLineOpacityInput,
    operationalLineList,
    operationalLineStartBtn,
    operationalLineUndoBtn,
    operationalLineFinishBtn,
    operationalLineCancelBtn,
    operationalLineDeleteBtn,
    operationalLineEditorHint,
    strategicCommandButtons,
    operationGraphicKindSelect,
    operationGraphicLabelInput,
    operationGraphicPresetSelect,
    operationGraphicStrokeInput,
    operationGraphicWidthInput,
    operationGraphicOpacityInput,
    operationGraphicList,
    operationGraphicStartBtn,
    operationGraphicUndoBtn,
    operationGraphicFinishBtn,
    operationGraphicCancelBtn,
    operationGraphicDeleteBtn,
    operationGraphicDeleteVertexBtn,
    operationGraphicEditorHint,
    unitCounterPreviewCard,
    unitCounterPlacementStatus,
    unitCounterEditorModalOverlay,
    unitCounterEditorModal,
    unitCounterEditorModalCloseBtn,
    unitCounterEditorModalStatus,
    unitCounterDetailPreviewCard,
    unitCounterPresetSelect,
    unitCounterNationModeSelect,
    unitCounterNationSelect,
    unitCounterAttachmentSelect,
    unitCounterRendererSelect,
    unitCounterSizeSelect,
    unitCounterEchelonSelect,
    unitCounterLabelInput,
    unitCounterSubLabelInput,
    unitCounterStrengthInput,
    unitCounterSymbolInput,
    unitCounterSymbolHint,
    unitCounterStatsPresetSelect,
    unitCounterStatsPresetButtons,
    unitCounterStatsRandomizeBtn,
    unitCounterOrganizationInput,
    unitCounterEquipmentInput,
    unitCounterOrganizationBar,
    unitCounterEquipmentBar,
    unitCounterBaseFillSwatch,
    unitCounterBaseFillColorInput,
    unitCounterBaseFillResetBtn,
    unitCounterBaseFillEyedropperBtn,
    unitCounterLabelsToggle,
    unitCounterFixedScaleRange,
    unitCounterFixedScaleValue,
    unitCounterPlaceBtn,
    unitCounterCancelBtn,
    unitCounterDeleteBtn,
    unitCounterList,
    unitCounterCatalogHeaderTitle,
    unitCounterCatalogHeaderHint,
    unitCounterCatalogSourceTabs,
    unitCounterCatalogSearchInput,
    unitCounterLibraryVariantRow,
    unitCounterLibraryReviewBar,
    unitCounterLibraryReviewSummary,
    unitCounterLibraryExportBtn,
    unitCounterCatalogCategoriesEl,
    unitCounterCatalogGrid,
  } = elements;

  const {
    mapRenderer,
    render,
    t,
    showAppDialog,
    normalizeAnnotationView,
    captureHistoryState,
    pushHistoryEntry,
    markDirty,
    resolveUnitCounterCombatState,
    getFilteredUnitCounterCatalog,
    getUnitCounterCategoryLabel,
    getUnitCounterIconPathById,
    getUnitCounterPresetMeta,
    unitCounterCatalogCategories,
    unitCounterPresets,
    getSidebarUnitCounterPresetOptions,
    inferUnitCounterPresetId,
    getUnitCounterNationMeta,
    getUnitCounterNationOptions,
    getUnitCounterEchelonLabel,
    formatUnitCounterListLabel,
    renderUnitCounterPreview,
    clampUnitCounterFixedScaleMultiplier,
    clampUnitCounterStatValue,
    getUnitCounterCombatPreset,
    getRandomizedUnitCounterCombatState,
    ensureHoi4UnitIconManifest,
    cancelHoi4CatalogGridRender,
    filterHoi4UnitIconEntries,
    renderHoi4CatalogCards,
    getHoi4EffectiveMappedPresetIds,
    getHoi4ReviewSummaryText,
    getHoi4CatalogFilterOptions,
    getHoi4UnitIconManifestState,
    exportHoi4UnitIconReviewDraft,
    toggleHoi4EntryCurrentPresetMapping,
    setHoi4CurrentPresetCandidate,
    DEFAULT_UNIT_COUNTER_PRESET_ID,
  } = helpers;

  const STRATEGIC_OVERLAY_REFRESH_SCOPES = Object.freeze([
    "frontlineControls",
    "operationalLines",
    "operationGraphics",
    "counterIdentity",
    "counterCombat",
    "counterPreview",
    "counterCatalog",
    "counterList",
    "badgeCounts",
    "workspaceChrome",
  ]);
  const strategicOverlayRefreshScopeSet = new Set(STRATEGIC_OVERLAY_REFRESH_SCOPES);
  const strategicOverlayPerfCounters = Object.create(null);
  let pendingStrategicOverlayRefreshHandle = null;
  const pendingStrategicOverlayRefreshScopes = new Set();
  const unitCounterUiState = {
    catalogSearchDebounceHandle: null,
    counterEditorModalPreviouslyFocused: null,
    suppressListChange: false,
  };

  const ensureStrategicOverlayUiState = () => {
    if (!state.strategicOverlayUi || typeof state.strategicOverlayUi !== "object") {
      state.strategicOverlayUi = {};
    }
    state.strategicOverlayUi.counterEditorModalOpen = !!state.strategicOverlayUi.counterEditorModalOpen;
    state.strategicOverlayUi.counterCatalogSource = String(state.strategicOverlayUi.counterCatalogSource || "internal").trim().toLowerCase() === "hoi4"
      ? "hoi4"
      : "internal";
    state.strategicOverlayUi.counterCatalogCategory = String(state.strategicOverlayUi.counterCatalogCategory || "all").trim().toLowerCase() || "all";
    state.strategicOverlayUi.counterCatalogQuery = String(state.strategicOverlayUi.counterCatalogQuery || "");
    state.strategicOverlayUi.hoi4CounterCategory = String(state.strategicOverlayUi.hoi4CounterCategory || "all").trim().toLowerCase() || "all";
    state.strategicOverlayUi.hoi4CounterQuery = String(state.strategicOverlayUi.hoi4CounterQuery || "");
    state.strategicOverlayUi.hoi4CounterVariant = String(state.strategicOverlayUi.hoi4CounterVariant || "small").trim().toLowerCase() === "large"
      ? "large"
      : "small";
  };
  const recordStrategicOverlayPerfCounter = (name) => {
    const key = String(name || "").trim();
    if (!key) return;
    strategicOverlayPerfCounters[key] = Number(strategicOverlayPerfCounters[key] || 0) + 1;
  };
  const normalizeStrategicOverlayRefreshScopes = (scope = "all") => {
    const rawScopes = Array.isArray(scope) ? scope : [scope];
    const normalizedScopes = new Set();
    rawScopes.forEach((entry) => {
      const normalizedEntry = String(entry || "all").trim();
      if (!normalizedEntry || normalizedEntry === "all") {
        STRATEGIC_OVERLAY_REFRESH_SCOPES.forEach((scopeKey) => normalizedScopes.add(scopeKey));
        return;
      }
      if (strategicOverlayRefreshScopeSet.has(normalizedEntry)) {
        normalizedScopes.add(normalizedEntry);
      }
    });
    if (!normalizedScopes.size) {
      STRATEGIC_OVERLAY_REFRESH_SCOPES.forEach((scopeKey) => normalizedScopes.add(scopeKey));
    }
    return normalizedScopes;
  };
  const hasStrategicOverlayScope = (scopes, ...candidates) => candidates.some((candidate) => scopes.has(candidate));
  const flushPendingStrategicOverlayRefresh = () => {
    const scopes = Array.from(pendingStrategicOverlayRefreshScopes);
    pendingStrategicOverlayRefreshScopes.clear();
    pendingStrategicOverlayRefreshHandle = null;
    refreshStrategicOverlayUI({ scopes });
  };
  const scheduleStrategicOverlayRefresh = (scope = "all") => {
    normalizeStrategicOverlayRefreshScopes(scope).forEach((scopeKey) => pendingStrategicOverlayRefreshScopes.add(scopeKey));
    if (pendingStrategicOverlayRefreshHandle !== null) {
      return;
    }
    pendingStrategicOverlayRefreshHandle = typeof globalThis.requestAnimationFrame === "function"
      ? globalThis.requestAnimationFrame(() => {
        flushPendingStrategicOverlayRefresh();
      })
      : globalThis.setTimeout(() => {
        flushPendingStrategicOverlayRefresh();
      }, 0);
  };
  const setCounterEditorModalState = (nextOpen, { restoreFocus = true } = {}) => {
    setUnitCounterEditorModalState({
      nextOpen,
      state,
      uiState: unitCounterUiState,
      elements: {
        unitCounterCatalogSearchInput,
        unitCounterDetailDrawer,
        unitCounterDetailToggleBtn,
        unitCounterEditorModal,
        unitCounterEditorModalOverlay,
      },
      ensureStrategicOverlayUiState,
      setStrategicWorkspaceModalState,
      restoreFocus,
    });
  };
  const cancelStrategicEditingModes = () => {
    const cancelled = mapRenderer.cancelActiveStrategicInteractionModes();
    if (cancelled) {
      refreshStrategicOverlayUI();
    }
    return cancelled;
  };

  const invalidateFrontlineOverlayState = () => {
    state.frontlineOverlayDirty = true;
    state.cachedFrontlineMesh = null;
    state.cachedFrontlineMeshHash = "";
    state.cachedFrontlineLabelAnchors = [];
  };

  const applyFrontlineAnnotationViewPatch = (patch = {}, dirtyReason = "frontline-overlay") => {
    const before = captureHistoryState({ strategicOverlay: true });
    state.annotationView = normalizeAnnotationView({
      ...(state.annotationView || {}),
      ...(patch && typeof patch === "object" ? patch : {}),
    });
    invalidateFrontlineOverlayState();
    if (render) render();
    refreshStrategicOverlayUI();
    pushHistoryEntry({
      before,
      after: captureHistoryState({ strategicOverlay: true }),
      meta: {
        kind: "strategic-overlay-frontline",
        dirtyReason,
      },
    });
    markDirty(dirtyReason);
  };

  const refreshFrontlineTabUI = () => {
    const annotationView = normalizeAnnotationView(state.annotationView);
    const frontlineEnabled = !!annotationView.frontlineEnabled;
    const hasScenario = !!state.activeScenarioId;
    if (frontlineEnabledStatus) {
      frontlineEnabledStatus.textContent = frontlineEnabled ? t("On", "ui") : t("Off", "ui");
      frontlineEnabledStatus.classList.toggle("is-active", frontlineEnabled);
    }
    if (frontlineStatusHint) {
      frontlineStatusHint.textContent = !hasScenario
        ? t("Scenario required.", "ui")
        : frontlineEnabled
        ? t("Derived frontlines on.", "ui")
        : t("Overlay off.", "ui");
    }
    if (frontlineEnabledToggle) {
      frontlineEnabledToggle.checked = frontlineEnabled;
    }
    if (frontlineEmptyState) {
      frontlineEmptyState.classList.toggle("hidden", frontlineEnabled);
    }
    if (frontlineSettingsPanel) {
      frontlineSettingsPanel.classList.toggle("hidden", !frontlineEnabled);
    }
    if (strategicFrontlineStyleSelect) {
      strategicFrontlineStyleSelect.value = String(annotationView.frontlineStyle || "clean");
      strategicFrontlineStyleSelect.disabled = !frontlineEnabled;
    }
    frontlineStyleChoiceButtons.forEach((button) => {
      const isActive = String(button.dataset.value || "") === String(annotationView.frontlineStyle || "clean");
      button.classList.toggle("is-active", isActive);
      button.disabled = !frontlineEnabled;
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
    if (strategicFrontlineLabelsToggle) {
      strategicFrontlineLabelsToggle.checked = !!annotationView.showFrontlineLabels;
      strategicFrontlineLabelsToggle.disabled = !frontlineEnabled;
    }
    if (strategicLabelPlacementSelect) {
      strategicLabelPlacementSelect.value = String(annotationView.labelPlacementMode || "midpoint");
      strategicLabelPlacementSelect.disabled = !frontlineEnabled || !annotationView.showFrontlineLabels;
    }
  };

  const setStrategicWorkspaceModalState = (nextOpen, section = "line") => {
    if (!state.strategicOverlayUi || typeof state.strategicOverlayUi !== "object") {
      state.strategicOverlayUi = {};
    }
    const wasOpen = !!state.strategicOverlayUi.modalOpen;
    const nextIsOpen = !!nextOpen;
    state.strategicOverlayUi.modalOpen = nextIsOpen;
    state.strategicOverlayUi.modalSection = section === "counter" ? "counter" : "line";
    if (nextIsOpen && !wasOpen) {
      setCounterEditorModalState(false, { restoreFocus: false });
    } else if (!nextIsOpen && wasOpen) {
      cancelStrategicEditingModes();
    }
    document.body.classList.toggle("strategic-workspace-open", nextIsOpen);
    document.body.classList.toggle("strategic-workspace-visual-mode", nextIsOpen);
    if (strategicOverlaySection) {
      strategicOverlaySection.classList.toggle("is-workspace-modal", nextIsOpen);
      strategicOverlaySection.classList.toggle("is-visual-workspace", nextIsOpen);
      strategicOverlaySection.dataset.workspaceSection = section === "counter" ? "counter" : "line";
    }
    if (strategicWorkspaceBackdropEl) {
      strategicWorkspaceBackdropEl.classList.toggle("hidden", !nextIsOpen);
    }
    if (strategicOverlayOpenWorkspaceBtn) {
      strategicOverlayOpenWorkspaceBtn.classList.toggle("hidden", nextIsOpen);
    }
    if (strategicOverlayCloseWorkspaceBtn) {
      strategicOverlayCloseWorkspaceBtn.classList.toggle("hidden", !nextIsOpen);
    }
    if (strategicOverlayIconCloseBtn) {
      strategicOverlayIconCloseBtn.classList.toggle("hidden", !nextIsOpen);
    }
  };

  const refreshStrategicOverlayUI = ({ scopes = "all" } = {}) => {
    const normalizedScopes = normalizeStrategicOverlayRefreshScopes(scopes);
    const annotationView = normalizeAnnotationView(state.annotationView);
    const syncSelectOptions = (selectEl, options, { value, disabled, signatureKey = "optionsSignature" } = {}) => {
      if (!(selectEl instanceof HTMLSelectElement)) {
        return;
      }
      const nextSignature = options.map((option) => `${option.value}::${option.label}`).join("||");
      if (selectEl.dataset[signatureKey] !== nextSignature) {
        selectEl.replaceChildren();
        options.forEach((entry) => {
          const optionEl = document.createElement("option");
          optionEl.value = String(entry.value || "");
          optionEl.textContent = entry.label;
          selectEl.appendChild(optionEl);
        });
        selectEl.dataset[signatureKey] = nextSignature;
      }
      if (typeof value !== "undefined") {
        selectEl.value = String(value || "");
      }
      if (typeof disabled !== "undefined") {
        selectEl.disabled = !!disabled;
      }
    };
    ensureStrategicOverlayUiState();
    if (hasStrategicOverlayScope(normalizedScopes, "frontlineControls")) {
      recordStrategicOverlayPerfCounter("frontlineControls");
      refreshFrontlineTabUI();
    }
    if (hasStrategicOverlayScope(normalizedScopes, "workspaceChrome")) {
      recordStrategicOverlayPerfCounter("workspaceChrome");
      setStrategicWorkspaceModalState(
        !!state.strategicOverlayUi?.modalOpen,
        String(state.strategicOverlayUi?.modalSection || "line")
      );
      if (unitCounterDetailDrawer) {
        unitCounterDetailDrawer.dataset.open = state.strategicOverlayUi?.counterEditorModalOpen ? "true" : "false";
      }
      if (unitCounterDetailToggleBtn) {
        unitCounterDetailToggleBtn.setAttribute("aria-label", t("Open counter editor", "ui"));
        unitCounterDetailToggleBtn.setAttribute("aria-expanded", state.strategicOverlayUi?.counterEditorModalOpen ? "true" : "false");
        unitCounterDetailToggleBtn.classList.toggle("is-active", !!state.strategicOverlayUi?.counterEditorModalOpen);
      }
      setCounterEditorModalState(!!state.strategicOverlayUi?.counterEditorModalOpen, { restoreFocus: false });
    }

    if (hasStrategicOverlayScope(normalizedScopes, "operationalLines")) {
      recordStrategicOverlayPerfCounter("operationalLines");
    const operationalLineEditor = state.operationalLineEditor || {};
    const selectedOperationalLine = (state.operationalLines || []).find(
      (line) => String(line?.id || "") === String(operationalLineEditor.selectedId || "")
    ) || null;
    const selectedOperationalLineId = String(operationalLineEditor.selectedId || "");
    const isOperationalLineDrawing = !!operationalLineEditor.active;
    const hasSelectedOperationalLine = !!selectedOperationalLineId && !!selectedOperationalLine;
    const operationalLineKind = String(
      hasSelectedOperationalLine && !isOperationalLineDrawing
        ? (selectedOperationalLine?.kind || "frontline")
        : (operationalLineEditor.kind || selectedOperationalLine?.kind || "frontline")
    );
    const operationalLineStroke = String(
      hasSelectedOperationalLine && !isOperationalLineDrawing
        ? (selectedOperationalLine?.stroke || "")
        : (operationalLineEditor.stroke || selectedOperationalLine?.stroke || "")
    ).trim();
    const operationalLineWidth = hasSelectedOperationalLine && !isOperationalLineDrawing
      ? Number(selectedOperationalLine?.width || 0)
      : (Number.isFinite(Number(operationalLineEditor.width)) ? Number(operationalLineEditor.width) : Number(selectedOperationalLine?.width || 0));
    const operationalLineOpacity = hasSelectedOperationalLine && !isOperationalLineDrawing
      ? Number(selectedOperationalLine?.opacity ?? 1)
      : (Number.isFinite(Number(operationalLineEditor.opacity)) ? Number(operationalLineEditor.opacity) : Number(selectedOperationalLine?.opacity ?? 1));
    if (operationalLineKindSelect) operationalLineKindSelect.value = operationalLineKind;
    if (operationalLineLabelInput) operationalLineLabelInput.value = String(operationalLineEditor.label || selectedOperationalLine?.label || "");
    if (operationalLineStrokeInput) operationalLineStrokeInput.value = operationalLineStroke || "#7f1d1d";
    if (operationalLineWidthInput) operationalLineWidthInput.value = String(Number(operationalLineWidth || 0).toFixed(1).replace(/\.0$/, ""));
    if (operationalLineOpacityInput) {
      operationalLineOpacityInput.value = String(Number(operationalLineOpacity || 0).toFixed(2).replace(/0+$/, "").replace(/\.$/, ""));
    }
    syncSelectOptions(operationalLineList, [
      { value: "", label: t("No operational lines", "ui") },
      ...(state.operationalLines || []).map((line) => ({
        value: String(line.id || ""),
        label: `${String(line.label || line.kind || line.id || "").trim()} (${line.kind})`,
      })),
    ], {
      value: selectedOperationalLineId,
      signatureKey: "lineOptionsSignature",
    });
    if (operationalLineStartBtn) operationalLineStartBtn.disabled = isOperationalLineDrawing;
    if (operationalLineUndoBtn) operationalLineUndoBtn.disabled = !isOperationalLineDrawing;
    if (operationalLineFinishBtn) operationalLineFinishBtn.disabled = !isOperationalLineDrawing;
    if (operationalLineCancelBtn) operationalLineCancelBtn.disabled = !isOperationalLineDrawing;
    if (operationalLineDeleteBtn) operationalLineDeleteBtn.disabled = !hasSelectedOperationalLine;
    if (operationalLineEditorHint) {
      operationalLineEditorHint.textContent = isOperationalLineDrawing
        ? t("Drawing vertices.", "ui")
        : hasSelectedOperationalLine
        ? t("Line selected.", "ui")
        : t("Choose type and draw.", "ui");
    }
    if (isOperationalLineDrawing || hasSelectedOperationalLine) {
      const linesAccordion = document.getElementById("accordionLines");
      const linesAccordionHeader = linesAccordion?.querySelector?.(".strategic-accordion-header");
      linesAccordion?.classList.add("is-open");
      linesAccordionHeader?.setAttribute("aria-expanded", "true");
    }
    strategicCommandButtons.forEach((button) => {
      const active = String(button.dataset.lineKind || "") === String(state.strategicOverlayUi?.activeMode || "");
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    }

    if (hasStrategicOverlayScope(normalizedScopes, "operationGraphics")) {
      recordStrategicOverlayPerfCounter("operationGraphics");
    const operationEditor = state.operationGraphicsEditor || {};
    const selectedGraphic = (state.operationGraphics || []).find(
      (graphic) => String(graphic?.id || "") === String(operationEditor.selectedId || "")
    ) || null;
    const selectedGraphicId = String(operationEditor.selectedId || "");
    const isGraphicDrawing = !!operationEditor.active;
    const useSelectedGraphicValues = !isGraphicDrawing && !!selectedGraphicId && !!selectedGraphic;
    const operationKind = String(
      useSelectedGraphicValues ? (selectedGraphic?.kind || "attack") : (operationEditor.kind || selectedGraphic?.kind || "attack")
    );
    const operationPreset = String(
      useSelectedGraphicValues
        ? (selectedGraphic?.stylePreset || operationKind || "attack")
        : (operationEditor.stylePreset || selectedGraphic?.stylePreset || operationKind || "attack")
    );
    const operationStroke = String(
      useSelectedGraphicValues ? (selectedGraphic?.stroke || "") : (operationEditor.stroke || selectedGraphic?.stroke || "")
    ).trim();
    const operationWidth = useSelectedGraphicValues
      ? Number(selectedGraphic?.width || 0)
      : (Number.isFinite(Number(operationEditor.width)) ? Number(operationEditor.width) : Number(selectedGraphic?.width || 0));
    const operationOpacity = useSelectedGraphicValues
      ? Number(selectedGraphic?.opacity ?? 1)
      : (Number.isFinite(Number(operationEditor.opacity)) ? Number(operationEditor.opacity) : Number(selectedGraphic?.opacity ?? 1));
    if (operationGraphicKindSelect) {
      operationGraphicKindSelect.value = operationKind;
    }
    if (operationGraphicLabelInput) {
      operationGraphicLabelInput.value = String(operationEditor.label || "");
    }
    if (operationGraphicPresetSelect) {
      operationGraphicPresetSelect.value = operationPreset;
    }
    if (operationGraphicStrokeInput) {
      operationGraphicStrokeInput.value = operationStroke || "#991b1b";
    }
    if (operationGraphicWidthInput) {
      operationGraphicWidthInput.value = String(Number(operationWidth || 0).toFixed(1).replace(/\.0$/, ""));
    }
    if (operationGraphicOpacityInput) {
      operationGraphicOpacityInput.value = String(Number(operationOpacity || 0).toFixed(2).replace(/0+$/, "").replace(/\.$/, ""));
    }
    syncSelectOptions(operationGraphicList, [
      { value: "", label: t("No operation graphics", "ui") },
      ...(state.operationGraphics || []).map((graphic) => ({
        value: String(graphic.id || ""),
        label: `${String(graphic.label || graphic.kind || graphic.id || "").trim()} (${graphic.kind})`,
      })),
    ], {
      value: selectedGraphicId,
      signatureKey: "graphicOptionsSignature",
    });
    const hasSelectedGraphic = !!String(operationEditor.selectedId || "").trim();
    const graphicMinPoints = selectedGraphic ? (["encirclement", "theater"].includes(String(selectedGraphic.kind || "")) ? 3 : 2) : 0;
    const canDeleteVertex = !!selectedGraphic
      && Number.isInteger(Number(operationEditor.selectedVertexIndex))
      && Number(operationEditor.selectedVertexIndex) >= 0
      && Array.isArray(selectedGraphic.points)
      && selectedGraphic.points.length > graphicMinPoints;
    if (operationGraphicStartBtn) operationGraphicStartBtn.disabled = isGraphicDrawing;
    if (operationGraphicUndoBtn) operationGraphicUndoBtn.disabled = !isGraphicDrawing;
    if (operationGraphicFinishBtn) operationGraphicFinishBtn.disabled = !isGraphicDrawing;
    if (operationGraphicCancelBtn) operationGraphicCancelBtn.disabled = !isGraphicDrawing;
    if (operationGraphicDeleteBtn) operationGraphicDeleteBtn.disabled = !hasSelectedGraphic;
    if (operationGraphicDeleteVertexBtn) operationGraphicDeleteVertexBtn.disabled = !canDeleteVertex;
    if (operationGraphicEditorHint) {
      operationGraphicEditorHint.textContent = isGraphicDrawing
        ? t("Drawing path.", "ui")
        : hasSelectedGraphic
        ? t("Graphic selected.", "ui")
        : t("Start drawing or select a line.", "ui");
    }
    if (isGraphicDrawing || hasSelectedGraphic) {
      const graphicsAccordion = document.getElementById("accordionGraphics");
      const graphicsAccordionHeader = graphicsAccordion?.querySelector?.(".strategic-accordion-header");
      graphicsAccordion?.classList.add("is-open");
      graphicsAccordionHeader?.setAttribute("aria-expanded", "true");
    }
    }

    if (hasStrategicOverlayScope(normalizedScopes, "counterIdentity", "counterCombat", "counterPreview", "counterCatalog", "counterList", "workspaceChrome")) {
      const unitCounterViewModel = buildUnitCounterSectionViewModel({
        state,
        annotationView,
        unitCounterPresets,
        inferUnitCounterPresetId,
        getUnitCounterPresetMeta,
        clampUnitCounterFixedScaleMultiplier,
        resolveUnitCounterCombatState,
        getUnitCounterNationOptions,
      });
      const shouldRefreshCounterIdentity = hasStrategicOverlayScope(normalizedScopes, "counterIdentity");
      const shouldRefreshCounterCombat = hasStrategicOverlayScope(normalizedScopes, "counterCombat");
      const shouldRefreshCounterPreview = hasStrategicOverlayScope(normalizedScopes, "counterPreview");
      const shouldRefreshCounterCatalog = hasStrategicOverlayScope(normalizedScopes, "counterCatalog");
      const shouldRefreshCounterList = hasStrategicOverlayScope(normalizedScopes, "counterList");
      if (shouldRefreshCounterIdentity) {
        recordStrategicOverlayPerfCounter("counterIdentity");
        refreshUnitCounterIdentitySection({
          elements: {
            unitCounterAttachmentSelect,
            unitCounterCancelBtn,
            unitCounterDeleteBtn,
            unitCounterEchelonSelect,
            unitCounterFixedScaleRange,
            unitCounterFixedScaleValue,
            unitCounterLabelInput,
            unitCounterLabelsToggle,
            unitCounterNationModeSelect,
            unitCounterNationSelect,
            unitCounterPlaceBtn,
            unitCounterPresetSelect,
            unitCounterRendererSelect,
            unitCounterSizeSelect,
            unitCounterStrengthInput,
            unitCounterSubLabelInput,
            unitCounterSymbolHint,
            unitCounterSymbolInput,
          },
          state,
          t,
          syncSelectOptions,
          model: unitCounterViewModel,
          getSidebarUnitCounterPresetOptions,
          getUnitCounterNationMeta,
        });
      }
      if (shouldRefreshCounterPreview) {
        recordStrategicOverlayPerfCounter("counterPreview");
        refreshUnitCounterPreviewSection({
          elements: {
            unitCounterDetailPreviewCard,
            unitCounterEditorModalStatus,
            unitCounterPlacementStatus,
            unitCounterPreviewCard,
          },
          t,
          renderUnitCounterPreview,
          model: unitCounterViewModel,
        });
      }
      if (shouldRefreshCounterCombat) {
        recordStrategicOverlayPerfCounter("counterCombat");
        refreshUnitCounterCombatSection({
          elements: {
            unitCounterBaseFillColorInput,
            unitCounterBaseFillEyedropperBtn,
            unitCounterBaseFillResetBtn,
            unitCounterBaseFillSwatch,
            unitCounterEquipmentBar,
            unitCounterEquipmentInput,
            unitCounterOrganizationBar,
            unitCounterOrganizationInput,
            unitCounterStatsPresetButtons,
            unitCounterStatsPresetSelect,
          },
          model: unitCounterViewModel,
        });
      }
      if (shouldRefreshCounterCatalog) {
        recordStrategicOverlayPerfCounter("counterCatalog");
        ensureStrategicOverlayUiState();
        renderUnitCounterCatalogSection({
          elements: {
            unitCounterCatalogCategoriesEl,
            unitCounterCatalogGrid,
            unitCounterCatalogHeaderHint,
            unitCounterCatalogHeaderTitle,
            unitCounterCatalogSearchInput,
            unitCounterCatalogSourceTabs,
            unitCounterLibraryReviewBar,
            unitCounterLibraryReviewSummary,
            unitCounterLibraryVariantRow,
          },
          state,
          t,
          effectivePresetId: unitCounterViewModel.effectivePresetId,
          helpers: {
            cancelHoi4CatalogGridRender,
            ensureHoi4UnitIconManifest,
            filterHoi4UnitIconEntries,
            getFilteredUnitCounterCatalog,
            getHoi4CatalogFilterOptions,
            getHoi4EffectiveMappedPresetIds,
            getHoi4ReviewSummaryText,
            getHoi4UnitIconManifestState,
            getUnitCounterCategoryLabel,
            getUnitCounterIconPathById,
            renderHoi4CatalogCards,
            unitCounterCatalogCategories,
          },
        });
      }
      if (shouldRefreshCounterList) {
        recordStrategicOverlayPerfCounter("counterList");
        refreshUnitCounterListSection({
          elements: { unitCounterList },
          t,
          syncSelectOptions,
          formatUnitCounterListLabel,
          state,
          model: unitCounterViewModel,
          uiState: unitCounterUiState,
        });
      }
    }

    if (hasStrategicOverlayScope(normalizedScopes, "badgeCounts", "operationalLines", "operationGraphics", "counterList")) {
      recordStrategicOverlayPerfCounter("badgeCounts");
      const linesBadge = document.querySelector("#accordionLines .strategic-accordion-badge");
      const graphicsBadge = document.querySelector("#accordionGraphics .strategic-accordion-badge");
      const countersBadge = document.querySelector("#accordionCounters .strategic-accordion-badge");
      if (linesBadge) linesBadge.textContent = String((state.operationalLines || []).length);
      if (graphicsBadge) graphicsBadge.textContent = String((state.operationGraphics || []).length);
      if (countersBadge) countersBadge.textContent = String((state.unitCounters || []).length);
    }
  };

  const bindEvents = () => {
  if (frontlineEnabledToggle && !frontlineEnabledToggle.dataset.bound) {
    frontlineEnabledToggle.addEventListener("change", (event) => {
      const nextEnabled = !!event.target.checked;
      applyFrontlineAnnotationViewPatch(
        { frontlineEnabled: nextEnabled },
        nextEnabled ? "frontline-enabled" : "frontline-disabled"
      );
    });
    frontlineEnabledToggle.dataset.bound = "true";
  }

  if (strategicFrontlineStyleSelect && !strategicFrontlineStyleSelect.dataset.bound) {
    strategicFrontlineStyleSelect.addEventListener("change", (event) => {
      applyFrontlineAnnotationViewPatch(
        { frontlineStyle: String(event.target.value || "clean") },
        "frontline-style"
      );
    });
    strategicFrontlineStyleSelect.dataset.bound = "true";
  }
  frontlineStyleChoiceButtons.forEach((button) => {
    if (button.dataset.bound) return;
    button.addEventListener("click", () => {
      const nextStyle = String(button.dataset.value || "clean");
      if (strategicFrontlineStyleSelect) {
        strategicFrontlineStyleSelect.value = nextStyle;
      }
      applyFrontlineAnnotationViewPatch(
        { frontlineStyle: nextStyle },
        "frontline-style"
      );
    });
    button.dataset.bound = "true";
  });
  if (strategicFrontlineLabelsToggle && !strategicFrontlineLabelsToggle.dataset.bound) {
    strategicFrontlineLabelsToggle.addEventListener("change", (event) => {
      applyFrontlineAnnotationViewPatch(
        { showFrontlineLabels: !!event.target.checked },
        "frontline-labels"
      );
    });
    strategicFrontlineLabelsToggle.dataset.bound = "true";
  }
  if (strategicLabelPlacementSelect && !strategicLabelPlacementSelect.dataset.bound) {
    strategicLabelPlacementSelect.addEventListener("change", (event) => {
      applyFrontlineAnnotationViewPatch(
        { labelPlacementMode: String(event.target.value || "midpoint") },
        "frontline-label-placement"
      );
    });
    strategicLabelPlacementSelect.dataset.bound = "true";
  }

  if (strategicOverlayOpenWorkspaceBtn && !strategicOverlayOpenWorkspaceBtn.dataset.bound) {
    strategicOverlayOpenWorkspaceBtn.addEventListener("click", () => {
      const currentSection = String(state.strategicOverlayUi?.modalSection || "line");
      const preferredSection = currentSection === "counter" ? "line" : currentSection;
      setStrategicWorkspaceModalState(true, preferredSection);
    });
    strategicOverlayOpenWorkspaceBtn.dataset.bound = "true";
  }
  if (strategicOverlayCloseWorkspaceBtn && !strategicOverlayCloseWorkspaceBtn.dataset.bound) {
    strategicOverlayCloseWorkspaceBtn.addEventListener("click", () => {
      setStrategicWorkspaceModalState(false, String(state.strategicOverlayUi?.modalSection || "line"));
    });
    strategicOverlayCloseWorkspaceBtn.dataset.bound = "true";
  }
  if (strategicOverlayIconCloseBtn && !strategicOverlayIconCloseBtn.dataset.bound) {
    strategicOverlayIconCloseBtn.addEventListener("click", () => {
      setStrategicWorkspaceModalState(false, String(state.strategicOverlayUi?.modalSection || "line"));
    });
    strategicOverlayIconCloseBtn.dataset.bound = "true";
  }
  if (!document.body.dataset.strategicWorkspaceEscapeBound) {
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !state.strategicOverlayUi?.modalOpen) return;
      setStrategicWorkspaceModalState(false, String(state.strategicOverlayUi?.modalSection || "line"));
    });
    document.body.dataset.strategicWorkspaceEscapeBound = "true";
  }
  strategicCommandButtons.forEach((button) => {
    if (button.dataset.bound) return;
    button.addEventListener("click", () => {
      const nextKind = String(button.dataset.lineKind || "frontline");
      state.strategicOverlayUi = {
        ...(state.strategicOverlayUi || {}),
        activeMode: nextKind,
        modalSection: "line",
      };
      if (operationalLineKindSelect) operationalLineKindSelect.value = nextKind;
      mapRenderer.startOperationalLineDraw({
        kind: nextKind,
        stylePreset: nextKind,
        label: String(operationalLineLabelInput?.value || ""),
        stroke: String(operationalLineStrokeInput?.value || ""),
        width: Number(operationalLineWidthInput?.value || 0),
        opacity: Number(operationalLineOpacityInput?.value || 1),
      });
      refreshStrategicOverlayUI();
    });
    button.dataset.bound = "true";
  });

  if (operationalLineKindSelect && !operationalLineKindSelect.dataset.bound) {
    operationalLineKindSelect.addEventListener("change", (event) => {
      const nextKind = String(event.target.value || "frontline");
      state.operationalLineEditor.kind = nextKind;
      state.operationalLineEditor.stylePreset = nextKind;
      state.strategicOverlayUi = {
        ...(state.strategicOverlayUi || {}),
        activeMode: nextKind,
        modalSection: "line",
      };
      if (!state.operationalLineEditor.active && state.operationalLineEditor.selectedId) {
        mapRenderer.updateSelectedOperationalLine({ kind: nextKind, stylePreset: nextKind });
      } else if (render) {
        render();
      }
      refreshStrategicOverlayUI();
    });
    operationalLineKindSelect.dataset.bound = "true";
  }
  if (operationalLineLabelInput && !operationalLineLabelInput.dataset.bound) {
    operationalLineLabelInput.addEventListener("input", (event) => {
      state.operationalLineEditor.label = String(event.target.value || "");
    });
    operationalLineLabelInput.addEventListener("change", (event) => {
      const nextLabel = String(event.target.value || "");
      state.operationalLineEditor.label = nextLabel;
      if (!state.operationalLineEditor.active && state.operationalLineEditor.selectedId) {
        mapRenderer.updateSelectedOperationalLine({ label: nextLabel });
      } else if (render) {
        render();
      }
      refreshStrategicOverlayUI();
    });
    operationalLineLabelInput.dataset.bound = "true";
  }
  if (operationalLineStrokeInput && !operationalLineStrokeInput.dataset.bound) {
    operationalLineStrokeInput.addEventListener("change", (event) => {
      const nextStroke = String(event.target.value || "");
      state.operationalLineEditor.stroke = nextStroke;
      if (!state.operationalLineEditor.active && state.operationalLineEditor.selectedId) {
        mapRenderer.updateSelectedOperationalLine({ stroke: nextStroke });
      } else if (render) {
        render();
      }
      refreshStrategicOverlayUI();
    });
    operationalLineStrokeInput.dataset.bound = "true";
  }
  if (operationalLineWidthInput && !operationalLineWidthInput.dataset.bound) {
    operationalLineWidthInput.addEventListener("change", (event) => {
      const nextWidth = Number(event.target.value || 0);
      state.operationalLineEditor.width = nextWidth;
      if (!state.operationalLineEditor.active && state.operationalLineEditor.selectedId) {
        mapRenderer.updateSelectedOperationalLine({ width: nextWidth });
      } else if (render) {
        render();
      }
      refreshStrategicOverlayUI();
    });
    operationalLineWidthInput.dataset.bound = "true";
  }
  if (operationalLineOpacityInput && !operationalLineOpacityInput.dataset.bound) {
    operationalLineOpacityInput.addEventListener("change", (event) => {
      const nextOpacity = Number(event.target.value || 1);
      state.operationalLineEditor.opacity = nextOpacity;
      if (!state.operationalLineEditor.active && state.operationalLineEditor.selectedId) {
        mapRenderer.updateSelectedOperationalLine({ opacity: nextOpacity });
      } else if (render) {
        render();
      }
      refreshStrategicOverlayUI();
    });
    operationalLineOpacityInput.dataset.bound = "true";
  }
  if (operationalLineStartBtn && !operationalLineStartBtn.dataset.bound) {
    operationalLineStartBtn.addEventListener("click", () => {
      const nextKind = String(operationalLineKindSelect?.value || state.operationalLineEditor?.kind || "frontline");
      state.strategicOverlayUi = {
        ...(state.strategicOverlayUi || {}),
        activeMode: nextKind,
        modalSection: "line",
      };
      mapRenderer.startOperationalLineDraw({
        kind: nextKind,
        label: String(operationalLineLabelInput?.value || state.operationalLineEditor?.label || ""),
        stylePreset: nextKind,
        stroke: String(operationalLineStrokeInput?.value || state.operationalLineEditor?.stroke || ""),
        width: Number(operationalLineWidthInput?.value || state.operationalLineEditor?.width || 0),
        opacity: Number(operationalLineOpacityInput?.value || state.operationalLineEditor?.opacity || 1),
      });
      refreshStrategicOverlayUI();
    });
    operationalLineStartBtn.dataset.bound = "true";
  }
  if (operationalLineUndoBtn && !operationalLineUndoBtn.dataset.bound) {
    operationalLineUndoBtn.addEventListener("click", () => {
      mapRenderer.undoOperationalLineVertex();
      refreshStrategicOverlayUI();
    });
    operationalLineUndoBtn.dataset.bound = "true";
  }
  if (operationalLineFinishBtn && !operationalLineFinishBtn.dataset.bound) {
    operationalLineFinishBtn.addEventListener("click", () => {
      mapRenderer.finishOperationalLineDraw();
      refreshStrategicOverlayUI();
    });
    operationalLineFinishBtn.dataset.bound = "true";
  }
  if (operationalLineCancelBtn && !operationalLineCancelBtn.dataset.bound) {
    operationalLineCancelBtn.addEventListener("click", () => {
      mapRenderer.cancelOperationalLineDraw();
      refreshStrategicOverlayUI();
    });
    operationalLineCancelBtn.dataset.bound = "true";
  }
  if (operationalLineList && !operationalLineList.dataset.bound) {
    operationalLineList.addEventListener("change", (event) => {
      state.strategicOverlayUi = {
        ...(state.strategicOverlayUi || {}),
        modalSection: "line",
      };
      mapRenderer.selectOperationalLineById(String(event.target.value || ""));
      refreshStrategicOverlayUI();
    });
    operationalLineList.dataset.bound = "true";
  }
  if (operationalLineDeleteBtn && !operationalLineDeleteBtn.dataset.bound) {
    operationalLineDeleteBtn.addEventListener("click", async () => {
      if (!state.operationalLineEditor?.selectedId) return;
      const confirmed = await showAppDialog({
        title: t("Delete Selected", "ui"),
        message: t("Delete the selected operational line?", "ui"),
        details: t("Attached counters will fall back to province or free anchors.", "ui"),
        confirmLabel: t("Delete Line", "ui"),
        cancelLabel: t("Cancel", "ui"),
        tone: "warning",
      });
      if (!confirmed) return;
      mapRenderer.deleteSelectedOperationalLine();
      refreshStrategicOverlayUI();
    });
    operationalLineDeleteBtn.dataset.bound = "true";
  }

  if (operationGraphicKindSelect && !operationGraphicKindSelect.dataset.bound) {
    operationGraphicKindSelect.addEventListener("change", (event) => {
      const nextKind = String(event.target.value || "attack");
      if (!state.operationGraphicsEditor.active && state.operationGraphicsEditor.selectedId) {
        mapRenderer.updateSelectedOperationGraphic({ kind: nextKind });
      } else {
        state.operationGraphicsEditor.kind = nextKind;
        if (render) {
          render();
        }
      }
      refreshStrategicOverlayUI();
    });
    operationGraphicKindSelect.dataset.bound = "true";
  }
  if (operationGraphicPresetSelect && !operationGraphicPresetSelect.dataset.bound) {
    operationGraphicPresetSelect.addEventListener("change", (event) => {
      const nextPreset = String(event.target.value || "attack");
      if (!state.operationGraphicsEditor.active && state.operationGraphicsEditor.selectedId) {
        mapRenderer.updateSelectedOperationGraphic({ stylePreset: nextPreset });
      } else {
        state.operationGraphicsEditor.stylePreset = nextPreset;
        if (render) {
          render();
        }
      }
      refreshStrategicOverlayUI();
    });
    operationGraphicPresetSelect.dataset.bound = "true";
  }
  if (operationGraphicLabelInput && !operationGraphicLabelInput.dataset.bound) {
    operationGraphicLabelInput.addEventListener("input", (event) => {
      state.operationGraphicsEditor.label = String(event.target.value || "");
    });
    operationGraphicLabelInput.addEventListener("change", (event) => {
      const nextLabel = String(event.target.value || "");
      state.operationGraphicsEditor.label = nextLabel;
      if (!state.operationGraphicsEditor.active && state.operationGraphicsEditor.selectedId) {
        mapRenderer.updateSelectedOperationGraphic({ label: nextLabel });
      } else if (render) {
        render();
      }
      refreshStrategicOverlayUI();
    });
    operationGraphicLabelInput.dataset.bound = "true";
  }
  if (operationGraphicStrokeInput && !operationGraphicStrokeInput.dataset.bound) {
    operationGraphicStrokeInput.addEventListener("change", (event) => {
      const nextStroke = String(event.target.value || "");
      state.operationGraphicsEditor.stroke = nextStroke;
      if (!state.operationGraphicsEditor.active && state.operationGraphicsEditor.selectedId) {
        mapRenderer.updateSelectedOperationGraphic({ stroke: nextStroke });
      } else if (render) {
        render();
      }
      refreshStrategicOverlayUI();
    });
    operationGraphicStrokeInput.dataset.bound = "true";
  }
  if (operationGraphicWidthInput && !operationGraphicWidthInput.dataset.bound) {
    operationGraphicWidthInput.addEventListener("change", (event) => {
      const nextWidth = Number(event.target.value || 0);
      state.operationGraphicsEditor.width = nextWidth;
      if (!state.operationGraphicsEditor.active && state.operationGraphicsEditor.selectedId) {
        mapRenderer.updateSelectedOperationGraphic({ width: nextWidth });
      } else if (render) {
        render();
      }
      refreshStrategicOverlayUI();
    });
    operationGraphicWidthInput.dataset.bound = "true";
  }
  if (operationGraphicOpacityInput && !operationGraphicOpacityInput.dataset.bound) {
    operationGraphicOpacityInput.addEventListener("change", (event) => {
      const nextOpacity = Number(event.target.value || 1);
      state.operationGraphicsEditor.opacity = nextOpacity;
      if (!state.operationGraphicsEditor.active && state.operationGraphicsEditor.selectedId) {
        mapRenderer.updateSelectedOperationGraphic({ opacity: nextOpacity });
      } else if (render) {
        render();
      }
      refreshStrategicOverlayUI();
    });
    operationGraphicOpacityInput.dataset.bound = "true";
  }
  if (operationGraphicStartBtn && !operationGraphicStartBtn.dataset.bound) {
    operationGraphicStartBtn.addEventListener("click", () => {
      mapRenderer.startOperationGraphicDraw({
        kind: String(operationGraphicKindSelect?.value || state.operationGraphicsEditor?.kind || "attack"),
        label: String(operationGraphicLabelInput?.value || state.operationGraphicsEditor?.label || ""),
        stylePreset: String(operationGraphicPresetSelect?.value || state.operationGraphicsEditor?.stylePreset || "attack"),
        stroke: String(operationGraphicStrokeInput?.value || state.operationGraphicsEditor?.stroke || ""),
        width: Number(operationGraphicWidthInput?.value || state.operationGraphicsEditor?.width || 0),
        opacity: Number(operationGraphicOpacityInput?.value || state.operationGraphicsEditor?.opacity || 1),
      });
      refreshStrategicOverlayUI();
    });
    operationGraphicStartBtn.dataset.bound = "true";
  }
  if (operationGraphicUndoBtn && !operationGraphicUndoBtn.dataset.bound) {
    operationGraphicUndoBtn.addEventListener("click", () => {
      mapRenderer.undoOperationGraphicVertex();
      refreshStrategicOverlayUI();
    });
    operationGraphicUndoBtn.dataset.bound = "true";
  }
  if (operationGraphicFinishBtn && !operationGraphicFinishBtn.dataset.bound) {
    operationGraphicFinishBtn.addEventListener("click", () => {
      mapRenderer.finishOperationGraphicDraw();
      refreshStrategicOverlayUI();
    });
    operationGraphicFinishBtn.dataset.bound = "true";
  }
  if (operationGraphicCancelBtn && !operationGraphicCancelBtn.dataset.bound) {
    operationGraphicCancelBtn.addEventListener("click", () => {
      mapRenderer.cancelOperationGraphicDraw();
      refreshStrategicOverlayUI();
    });
    operationGraphicCancelBtn.dataset.bound = "true";
  }
  if (operationGraphicList && !operationGraphicList.dataset.bound) {
    operationGraphicList.addEventListener("change", (event) => {
      mapRenderer.selectOperationGraphicById(String(event.target.value || ""));
      refreshStrategicOverlayUI();
    });
    operationGraphicList.dataset.bound = "true";
  }
  if (operationGraphicDeleteBtn && !operationGraphicDeleteBtn.dataset.bound) {
    operationGraphicDeleteBtn.addEventListener("click", async () => {
      if (!state.operationGraphicsEditor?.selectedId) return;
      const confirmed = await showAppDialog({
        title: t("Delete Selected", "ui"),
        message: t("Delete the selected operation graphic?", "ui"),
        details: t("This only removes the selected project-local strategic line.", "ui"),
        confirmLabel: t("Delete Graphic", "ui"),
        cancelLabel: t("Cancel", "ui"),
        tone: "warning",
      });
      if (!confirmed) return;
      mapRenderer.deleteSelectedOperationGraphic();
      refreshStrategicOverlayUI();
    });
    operationGraphicDeleteBtn.dataset.bound = "true";
  }
  if (operationGraphicDeleteVertexBtn && !operationGraphicDeleteVertexBtn.dataset.bound) {
    operationGraphicDeleteVertexBtn.addEventListener("click", () => {
      mapRenderer.deleteSelectedOperationGraphicVertex();
      refreshStrategicOverlayUI();
    });
    operationGraphicDeleteVertexBtn.dataset.bound = "true";
  }

  // Keep unit counter binding in its own owner helper so this controller stays as wiring.
  bindUnitCounterSidebarEvents({
    state,
    elements: {
      unitCounterAttachmentSelect,
      unitCounterBaseFillColorInput,
      unitCounterBaseFillEyedropperBtn,
      unitCounterBaseFillResetBtn,
      unitCounterBaseFillSwatch,
      unitCounterCancelBtn,
      unitCounterCatalogCategoriesEl,
      unitCounterCatalogGrid,
      unitCounterCatalogSearchInput,
      unitCounterCatalogSourceTabs,
      unitCounterDeleteBtn,
      unitCounterDetailToggleBtn,
      unitCounterEditorModal,
      unitCounterEditorModalCloseBtn,
      unitCounterEditorModalOverlay,
      unitCounterEchelonSelect,
      unitCounterEquipmentInput,
      unitCounterFixedScaleRange,
      unitCounterFixedScaleValue,
      unitCounterLabelInput,
      unitCounterLabelsToggle,
      unitCounterLibraryExportBtn,
      unitCounterLibraryVariantRow,
      unitCounterList,
      unitCounterNationModeSelect,
      unitCounterNationSelect,
      unitCounterOrganizationInput,
      unitCounterPlaceBtn,
      unitCounterPresetSelect,
      unitCounterRendererSelect,
      unitCounterSizeSelect,
      unitCounterStatsPresetButtons,
      unitCounterStatsPresetSelect,
      unitCounterStatsRandomizeBtn,
      unitCounterStrengthInput,
      unitCounterSubLabelInput,
      unitCounterSymbolInput,
    },
    uiState: unitCounterUiState,
    helpers: {
      clampUnitCounterFixedScaleMultiplier,
      clampUnitCounterStatValue,
      DEFAULT_UNIT_COUNTER_PRESET_ID,
      ensureStrategicOverlayUiState,
      exportHoi4UnitIconReviewDraft,
      getRandomizedUnitCounterCombatState,
      getUnitCounterCombatPreset,
      getUnitCounterPresetMeta,
      markDirty,
      mapRenderer,
      normalizeAnnotationView,
      refreshStrategicOverlayUI,
      render,
      resolveUnitCounterCombatState,
      scheduleStrategicOverlayRefresh,
      setCounterEditorModalState,
      setHoi4CurrentPresetCandidate,
      showAppDialog,
      t,
      toggleHoi4EntryCurrentPresetMapping,
      unitCounterPresets,
    },
  });

  };

  const closeCounterEditorModal = (options = {}) => {
    setCounterEditorModalState(false, options);
  };

  const closeWorkspace = () => {
    setStrategicWorkspaceModalState(false, String(state.strategicOverlayUi?.modalSection || "line"));
  };

  const getPerfCounters = () => ({ ...strategicOverlayPerfCounters });

  return {
    bindEvents,
    closeCounterEditorModal,
    closeWorkspace,
    cancelEditingModes: cancelStrategicEditingModes,
    getPerfCounters,
    invalidateFrontlineOverlayState,
    refreshUI: refreshStrategicOverlayUI,
  };
}
