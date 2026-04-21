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
  let unitCounterCatalogSearchDebounceHandle = null;
  let suppressUnitCounterListChange = false;
  let counterEditorModalPreviouslyFocused = null;

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
  const getCounterEditorModalFocusableElements = () => {
    if (!(unitCounterEditorModal instanceof HTMLElement)) {
      return [];
    }
    return Array.from(unitCounterEditorModal.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter((element) => (
      element instanceof HTMLElement
      && !element.hidden
      && element.getAttribute("aria-hidden") !== "true"
      && element.tabIndex >= 0
    ));
  };
  const focusUnitCounterDetailToggle = () => {
    if (!(unitCounterDetailToggleBtn instanceof HTMLElement)) {
      return false;
    }
    if (!document.contains(unitCounterDetailToggleBtn)) {
      return false;
    }
    unitCounterDetailToggleBtn.focus({ preventScroll: true });
    return true;
  };
  const setCounterEditorModalState = (nextOpen, { restoreFocus = true } = {}) => {
    ensureStrategicOverlayUiState();
    const isOpen = !!nextOpen;
    state.strategicOverlayUi.counterEditorModalOpen = isOpen;
    if (unitCounterEditorModalOverlay) {
      unitCounterEditorModalOverlay.classList.toggle("hidden", !isOpen);
    }
    if (unitCounterDetailDrawer) {
      unitCounterDetailDrawer.classList.toggle("hidden", !isOpen);
    }
    document.body.classList.toggle("counter-editor-modal-open", isOpen);
    if (isOpen) {
      counterEditorModalPreviouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (state.strategicOverlayUi?.modalOpen) {
        setStrategicWorkspaceModalState(false, String(state.strategicOverlayUi?.modalSection || "line"));
      }
      globalThis.requestAnimationFrame(() => {
        if (unitCounterCatalogSearchInput) {
          unitCounterCatalogSearchInput.focus({ preventScroll: true });
        } else {
          unitCounterEditorModal?.focus({ preventScroll: true });
        }
      });
      return;
    }
    const previousFocused = counterEditorModalPreviouslyFocused;
    counterEditorModalPreviouslyFocused = null;
    if (!restoreFocus) {
      return;
    }
    if (focusUnitCounterDetailToggle()) {
      return;
    }
    if (previousFocused && document.contains(previousFocused)) {
      previousFocused.focus({ preventScroll: true });
    }
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
        ? t("Apply a scenario first, then enable the overlay when you want a derived frontline view.", "ui")
        : frontlineEnabled
        ? t("This project is currently deriving frontlines from scenario control boundaries.", "ui")
        : t("Frontline rendering is disabled until you explicitly enable it for this project.", "ui");
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
        ? t("Click the map to place vertices. Double-click or press Finish to commit the operational line.", "ui")
        : hasSelectedOperationalLine
        ? t("Selected line can be restyled, relabeled, or deleted. Use the map to compose new lines.", "ui")
        : t("Choose a line type below or from the bottom command bar to begin drawing.", "ui");
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
        ? t("Click the map to place vertices. Double-click or press Finish to commit the line.", "ui")
        : hasSelectedGraphic
        ? t("Drag white handles to move vertices, click midpoint pips to insert, then remove the selected vertex if needed.", "ui")
        : t("Select a line to edit its geometry and style, or start a new drawing from the controls above.", "ui");
    }
    if (isGraphicDrawing || hasSelectedGraphic) {
      const graphicsAccordion = document.getElementById("accordionGraphics");
      const graphicsAccordionHeader = graphicsAccordion?.querySelector?.(".strategic-accordion-header");
      graphicsAccordion?.classList.add("is-open");
      graphicsAccordionHeader?.setAttribute("aria-expanded", "true");
    }
    }

    if (hasStrategicOverlayScope(normalizedScopes, "counterIdentity", "counterCombat", "counterPreview", "counterCatalog", "counterList", "workspaceChrome")) {
    const unitEditor = state.unitCounterEditor || {};
    const selectedCounter = (state.unitCounters || []).find(
      (counter) => String(counter?.id || "") === String(unitEditor.selectedId || "")
    ) || null;
    const effectivePresetId = String(
      unitEditor.presetId
      || selectedCounter?.presetId
      || inferUnitCounterPresetId({
        ...(selectedCounter || {}),
        ...(unitEditor || {}),
      })
      || unitCounterPresets[0].id
    ).trim().toUpperCase();
    const effectivePreset = getUnitCounterPresetMeta(effectivePresetId);
    const effectiveRenderer = String(
      unitEditor.renderer
      || selectedCounter?.renderer
      || effectivePreset.defaultRenderer
      || annotationView.unitRendererDefault
      || "game"
    );
    const effectiveUnitCounterFixedScaleMultiplier = clampUnitCounterFixedScaleMultiplier(
      annotationView.unitCounterFixedScaleMultiplier,
      1.5,
    );
    const effectiveSize = String(unitEditor.size || selectedCounter?.size || "medium");
    const effectiveNationSource = String(unitEditor.nationSource || selectedCounter?.nationSource || "display").trim().toLowerCase() || "display";
    const effectiveNationTag = String(unitEditor.nationTag || selectedCounter?.nationTag || "").trim().toUpperCase();
    const effectiveEchelon = String(unitEditor.echelon || selectedCounter?.echelon || effectivePreset.defaultEchelon || "").trim().toUpperCase();
    const effectiveLabel = String(unitEditor.label || selectedCounter?.label || "").trim();
    const effectiveSubLabel = String(unitEditor.subLabel || selectedCounter?.subLabel || "").trim();
    const effectiveStrengthText = String(unitEditor.strengthText || selectedCounter?.strengthText || "").trim();
    const effectiveCombatState = resolveUnitCounterCombatState({
      organizationPct: unitEditor.organizationPct ?? selectedCounter?.organizationPct,
      equipmentPct: unitEditor.equipmentPct ?? selectedCounter?.equipmentPct,
      baseFillColor: unitEditor.baseFillColor ?? selectedCounter?.baseFillColor,
      statsPresetId: unitEditor.statsPresetId || selectedCounter?.statsPresetId || "regular",
      statsSource: unitEditor.statsSource || selectedCounter?.statsSource || "preset",
    });
    const rawEffectiveSymbol = String(
      unitEditor.sidc
      || unitEditor.symbolCode
      || selectedCounter?.sidc
      || selectedCounter?.symbolCode
      || ""
    ).trim().toUpperCase();
    const effectiveSymbol = rawEffectiveSymbol || (
      effectiveRenderer === "milstd"
        ? String(effectivePreset.baseSidc || "").trim().toUpperCase()
        : String(effectivePreset.shortCode || "").trim().toUpperCase()
    );
    const nationOptions = getUnitCounterNationOptions();
    const shouldRefreshCounterIdentity = hasStrategicOverlayScope(normalizedScopes, "counterIdentity");
    const shouldRefreshCounterCombat = hasStrategicOverlayScope(normalizedScopes, "counterCombat");
    const shouldRefreshCounterPreview = hasStrategicOverlayScope(normalizedScopes, "counterPreview");
    const shouldRefreshCounterCatalog = hasStrategicOverlayScope(normalizedScopes, "counterCatalog");
    const shouldRefreshCounterList = hasStrategicOverlayScope(normalizedScopes, "counterList");
    if (shouldRefreshCounterIdentity) {
      recordStrategicOverlayPerfCounter("counterIdentity");
      syncSelectOptions(unitCounterPresetSelect, getSidebarUnitCounterPresetOptions(effectivePresetId).map((preset) => ({
        value: preset.id,
        label: `${preset.label} · ${preset.shortCode}`,
      })), {
        value: effectivePresetId,
        signatureKey: "presetOptionsSignature",
      });
      if (unitCounterNationModeSelect) {
        unitCounterNationModeSelect.value = effectiveNationSource === "manual" ? "manual" : "display";
      }
      const selectedNationValue = effectiveNationTag;
      const knownNationValues = new Set(["", ...nationOptions.map((entry) => entry.value)]);
      const nextNationOptions = nationOptions.slice();
      if (selectedNationValue && !knownNationValues.has(selectedNationValue)) {
        const fallbackMeta = getUnitCounterNationMeta(selectedNationValue);
        nextNationOptions.unshift({
          value: selectedNationValue,
          label: `${selectedNationValue} · ${fallbackMeta.displayName}`,
        });
      }
      syncSelectOptions(unitCounterNationSelect, [
        { value: "", label: t("Auto from placement", "ui") },
        ...nextNationOptions,
      ], {
        value: selectedNationValue,
        disabled: effectiveNationSource !== "manual",
        signatureKey: "nationOptionsSignature",
      });
      const selectedAttachmentLineId = String(unitEditor.attachment?.lineId || selectedCounter?.attachment?.lineId || "").trim();
      syncSelectOptions(unitCounterAttachmentSelect, [
        { value: "", label: t("Anchor: Province / Free", "ui") },
        ...(state.operationalLines || []).map((line) => ({
          value: String(line.id || ""),
          label: `${line.label || line.kind || line.id} (${line.kind})`,
        })),
      ], {
        value: selectedAttachmentLineId,
        signatureKey: "attachmentOptionsSignature",
      });
      if (unitCounterRendererSelect) unitCounterRendererSelect.value = effectiveRenderer;
      if (unitCounterSizeSelect) unitCounterSizeSelect.value = effectiveSize;
      if (unitCounterEchelonSelect) unitCounterEchelonSelect.value = effectiveEchelon;
      if (unitCounterLabelInput) unitCounterLabelInput.value = effectiveLabel;
      if (unitCounterSubLabelInput) unitCounterSubLabelInput.value = effectiveSubLabel;
      if (unitCounterStrengthInput) unitCounterStrengthInput.value = effectiveStrengthText;
      if (unitCounterSymbolInput) {
        unitCounterSymbolInput.value = effectiveSymbol;
        unitCounterSymbolInput.placeholder = effectiveRenderer === "milstd"
          ? t("SIDC (e.g. 130310001412110000000000000000)", "ui")
          : t("Short code (e.g. HQ / ARM / INF)", "ui");
      }
      if (unitCounterSymbolHint) {
        unitCounterSymbolHint.textContent = effectiveRenderer === "milstd"
          ? t("MILSTD uses the browser-loaded milsymbol renderer. Paste a full SIDC for the symbol body.", "ui")
          : t("Game renderer keeps the lighter counter style and uses a short internal code or abbreviation.", "ui");
      }
      if (state.unitCounterEditor?.selectedId || state.unitCounterEditor?.active || state.strategicOverlayUi?.counterEditorModalOpen) {
        const counterAccordion = document.getElementById("accordionCounters");
        const counterAccordionHeader = counterAccordion?.querySelector?.(".strategic-accordion-header");
        counterAccordion?.classList.add("is-open");
        counterAccordionHeader?.setAttribute("aria-expanded", "true");
      }
      if (unitCounterPlaceBtn) unitCounterPlaceBtn.disabled = !!unitEditor.active;
      if (unitCounterCancelBtn) unitCounterCancelBtn.disabled = !unitEditor.active;
      if (unitCounterDeleteBtn) unitCounterDeleteBtn.disabled = !String(unitEditor.selectedId || "").trim();
      if (unitCounterLabelsToggle) {
        unitCounterLabelsToggle.checked = annotationView.showUnitLabels !== false;
      }
      if (unitCounterFixedScaleRange) {
        unitCounterFixedScaleRange.value = String(Math.round(effectiveUnitCounterFixedScaleMultiplier * 100));
      }
      if (unitCounterFixedScaleValue) {
        unitCounterFixedScaleValue.textContent = `${effectiveUnitCounterFixedScaleMultiplier.toFixed(2)}x`;
      }
    }
    const placementStatusText = unitEditor.active
      ? t("Placing on map", "ui")
      : "";
    if (shouldRefreshCounterPreview) {
      recordStrategicOverlayPerfCounter("counterPreview");
      renderUnitCounterPreview(unitCounterPreviewCard, {
      renderer: effectiveRenderer,
      size: effectiveSize,
      nationTag: effectiveNationTag,
      nationSource: effectiveNationSource,
      label: effectiveLabel,
      subLabel: effectiveSubLabel,
      strengthText: effectiveStrengthText,
      sidc: effectiveSymbol,
      symbolCode: effectiveSymbol,
      presetId: effectivePresetId,
      echelon: effectiveEchelon,
      organizationPct: effectiveCombatState.organizationPct,
      equipmentPct: effectiveCombatState.equipmentPct,
      baseFillColor: effectiveCombatState.baseFillColor,
      statusText: placementStatusText,
      compactMode: true,
    });
      renderUnitCounterPreview(unitCounterDetailPreviewCard, {
      renderer: effectiveRenderer,
      size: effectiveSize,
      nationTag: effectiveNationTag,
      nationSource: effectiveNationSource,
      label: effectiveLabel,
      subLabel: effectiveSubLabel,
      strengthText: effectiveStrengthText,
      sidc: effectiveSymbol,
      symbolCode: effectiveSymbol,
      presetId: effectivePresetId,
      echelon: effectiveEchelon,
      organizationPct: effectiveCombatState.organizationPct,
      equipmentPct: effectiveCombatState.equipmentPct,
      baseFillColor: effectiveCombatState.baseFillColor,
      statusText: placementStatusText,
      detailMode: true,
    });
      if (unitCounterPlacementStatus) {
        unitCounterPlacementStatus.textContent = placementStatusText || t("Use the gear button for the full counter editor.", "ui");
        unitCounterPlacementStatus.classList.toggle("hidden", !placementStatusText);
      }
      if (unitCounterEditorModalStatus) {
        unitCounterEditorModalStatus.textContent = placementStatusText || t("Apply a symbol, then return to the map to continue placement or edit the selected counter live.", "ui");
        unitCounterEditorModalStatus.classList.toggle("hidden", false);
        unitCounterEditorModalStatus.dataset.mode = placementStatusText ? "placing" : "idle";
      }
    }
    if (shouldRefreshCounterCombat) {
      recordStrategicOverlayPerfCounter("counterCombat");
      if (unitCounterStatsPresetSelect) {
      unitCounterStatsPresetSelect.value = effectiveCombatState.statsPresetId === "random"
        ? "regular"
        : effectiveCombatState.statsPresetId;
      }
      unitCounterStatsPresetButtons.forEach((button) => {
        const value = String(button.dataset.value || "").trim().toLowerCase();
        const active = effectiveCombatState.statsPresetId !== "random" && value === effectiveCombatState.statsPresetId;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      });
      if (unitCounterOrganizationInput) {
        unitCounterOrganizationInput.value = String(effectiveCombatState.organizationPct);
      }
      if (unitCounterEquipmentInput) {
        unitCounterEquipmentInput.value = String(effectiveCombatState.equipmentPct);
      }
      if (unitCounterOrganizationBar) {
        unitCounterOrganizationBar.style.width = `${effectiveCombatState.organizationPct}%`;
      }
      if (unitCounterEquipmentBar) {
        unitCounterEquipmentBar.style.width = `${effectiveCombatState.equipmentPct}%`;
      }
      const effectiveFillColor = effectiveCombatState.baseFillColor || "#f4f0e6";
      if (unitCounterBaseFillSwatch) {
        unitCounterBaseFillSwatch.style.setProperty("--unit-counter-fill-preview", effectiveFillColor);
        unitCounterBaseFillSwatch.dataset.active = effectiveCombatState.baseFillColor ? "true" : "false";
      }
      if (unitCounterBaseFillColorInput) {
        unitCounterBaseFillColorInput.value = /^#(?:[0-9a-f]{6})$/i.test(effectiveFillColor) ? effectiveFillColor : "#f4f0e6";
      }
      if (unitCounterBaseFillResetBtn) {
        unitCounterBaseFillResetBtn.disabled = !effectiveCombatState.baseFillColor;
      }
      if (unitCounterBaseFillEyedropperBtn) {
        unitCounterBaseFillEyedropperBtn.disabled = !("EyeDropper" in globalThis);
      }
    }
    if (shouldRefreshCounterCatalog) {
      recordStrategicOverlayPerfCounter("counterCatalog");
      ensureStrategicOverlayUiState();
      const catalogSource = state.strategicOverlayUi.counterCatalogSource || "internal";
      const usingHoi4Catalog = catalogSource === "hoi4";
      const hoi4PreferredVariant = state.strategicOverlayUi.hoi4CounterVariant === "large" ? "large" : "small";
      const {
        status: hoi4UnitIconManifestStatus,
        error: hoi4UnitIconManifestError,
        data: hoi4UnitIconManifestData,
      } = getHoi4UnitIconManifestState();
      if (unitCounterCatalogHeaderTitle) {
        unitCounterCatalogHeaderTitle.textContent = usingHoi4Catalog
          ? t("HOI4 Library", "ui")
          : t("Symbol Browser", "ui");
      }
      if (unitCounterCatalogHeaderHint) {
        unitCounterCatalogHeaderHint.textContent = usingHoi4Catalog
          ? t("Review imported Hearts of Iron IV counter icons. This library is read-only for now.", "ui")
          : t("Search the internal counter catalog, then apply a preset back into the editor.", "ui");
      }
      if (unitCounterCatalogSourceTabs) {
        Array.from(unitCounterCatalogSourceTabs.querySelectorAll("[data-counter-catalog-source]")).forEach((element) => {
          const button = element instanceof HTMLButtonElement ? element : null;
          if (!button) return;
          const active = String(button.dataset.counterCatalogSource || "") === catalogSource;
          button.classList.toggle("is-active", active);
          button.setAttribute("aria-pressed", active ? "true" : "false");
        });
      }
      if (unitCounterLibraryVariantRow) {
        unitCounterLibraryVariantRow.classList.toggle("hidden", !usingHoi4Catalog);
        Array.from(unitCounterLibraryVariantRow.querySelectorAll("[data-counter-library-variant]")).forEach((element) => {
          const button = element instanceof HTMLButtonElement ? element : null;
          if (!button) return;
          const active = String(button.dataset.counterLibraryVariant || "small") === hoi4PreferredVariant;
          button.classList.toggle("is-active", active);
          button.setAttribute("aria-pressed", active ? "true" : "false");
        });
      }
      if (unitCounterLibraryReviewBar) {
        unitCounterLibraryReviewBar.classList.toggle("hidden", !usingHoi4Catalog);
      }
      if (unitCounterLibraryReviewSummary) {
        unitCounterLibraryReviewSummary.textContent = usingHoi4Catalog
          ? getHoi4ReviewSummaryText(effectivePresetId)
          : "";
      }
      if (unitCounterCatalogSearchInput) {
        unitCounterCatalogSearchInput.value = usingHoi4Catalog
          ? String(state.strategicOverlayUi?.hoi4CounterQuery || "")
          : String(state.strategicOverlayUi?.counterCatalogQuery || "");
        unitCounterCatalogSearchInput.placeholder = usingHoi4Catalog
          ? t("Search HOI4 sprite names, labels, keywords...", "ui")
          : t("Search internal presets, symbols, keywords...", "ui");
      }
      if (unitCounterCatalogCategoriesEl) {
        const categoryOptions = usingHoi4Catalog
          ? getHoi4CatalogFilterOptions(effectivePresetId)
          : [["all", t("All", "ui")], ...unitCounterCatalogCategories.map((category) => [category, getUnitCounterCategoryLabel(category)])];
        const activeCategory = usingHoi4Catalog
          ? String(state.strategicOverlayUi?.hoi4CounterCategory || "all")
          : String(state.strategicOverlayUi?.counterCatalogCategory || "all");
        unitCounterCatalogCategoriesEl.replaceChildren();
        categoryOptions.forEach(([categoryValue, label]) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "counter-editor-category-btn";
          button.dataset.counterCatalogCategory = String(categoryValue || "");
          button.textContent = label;
          const active = activeCategory === String(categoryValue || "");
          button.classList.toggle("is-active", active);
          button.setAttribute("aria-pressed", active ? "true" : "false");
          unitCounterCatalogCategoriesEl.appendChild(button);
        });
      }
      if (unitCounterCatalogGrid && state.strategicOverlayUi?.counterEditorModalOpen) {
        cancelHoi4CatalogGridRender(unitCounterCatalogGrid);
        unitCounterCatalogGrid.replaceChildren();
        const emptyState = document.createElement("div");
        emptyState.className = "counter-editor-symbol-empty";
        if (!usingHoi4Catalog) {
          const filteredCatalog = getFilteredUnitCounterCatalog({
            category: state.strategicOverlayUi?.counterCatalogCategory || "all",
            query: state.strategicOverlayUi?.counterCatalogQuery || "",
          });
          if (!filteredCatalog.length) {
            emptyState.textContent = t("No symbols match the current filter.", "ui");
            unitCounterCatalogGrid.appendChild(emptyState);
          } else {
            filteredCatalog.forEach((preset) => {
              const button = document.createElement("button");
              button.type = "button";
              button.className = "counter-editor-symbol-card";
              button.dataset.unitCounterCatalogPreset = preset.id;
              const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
              icon.setAttribute("viewBox", "-5 -5 10 10");
              icon.setAttribute("aria-hidden", "true");
              const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
              path.setAttribute("d", getUnitCounterIconPathById(preset.iconId));
              icon.appendChild(path);
              const title = document.createElement("span");
              title.className = "counter-editor-symbol-card-title";
              title.textContent = preset.label;
              const subtitle = document.createElement("span");
              subtitle.className = "counter-editor-symbol-card-subtitle";
              subtitle.textContent = `${preset.shortCode} · ${getUnitCounterCategoryLabel(preset.category)}`;
              const active = preset.id === effectivePresetId;
              button.classList.toggle("is-active", active);
              button.setAttribute("aria-pressed", active ? "true" : "false");
              button.append(icon, title, subtitle);
              unitCounterCatalogGrid.appendChild(button);
            });
          }
        } else {
          if (hoi4UnitIconManifestStatus === "idle") {
            ensureHoi4UnitIconManifest();
          }
          if (hoi4UnitIconManifestStatus === "loading" || hoi4UnitIconManifestStatus === "idle") {
            emptyState.textContent = t("Loading HOI4 unit icon library...", "ui");
            unitCounterCatalogGrid.appendChild(emptyState);
          } else if (hoi4UnitIconManifestStatus === "error") {
            emptyState.textContent = hoi4UnitIconManifestError?.message
              ? String(hoi4UnitIconManifestError.message)
              : t("Failed to load the HOI4 unit icon library.", "ui");
            unitCounterCatalogGrid.appendChild(emptyState);
          } else {
            const filteredEntries = filterHoi4UnitIconEntries(hoi4UnitIconManifestData?.entries || [], {
              filter: state.strategicOverlayUi?.hoi4CounterCategory || "all",
              query: state.strategicOverlayUi?.hoi4CounterQuery || "",
              currentPresetId: effectivePresetId,
              getMappedPresetIds: getHoi4EffectiveMappedPresetIds,
            });
            renderHoi4CatalogCards(unitCounterCatalogGrid, filteredEntries, {
              effectivePresetId,
              preferredVariant: hoi4PreferredVariant,
            });
            /* Legacy two-preview fallback retained only as commented reference during cleanup.
              filteredEntries.forEach((entry) => {
                const card = document.createElement("div");
                card.className = "counter-editor-symbol-card counter-editor-hoi4-card";
                const previewSet = getHoi4UnitIconPreviewSet(entry, hoi4PreferredVariant);
                const previewRow = document.createElement("div");
                previewRow.className = "counter-editor-hoi4-preview-row";
                const createPreview = (label, src, preferred = false) => {
                  const box = document.createElement("div");
                  box.className = "counter-editor-hoi4-preview";
                  if (preferred) {
                    box.classList.add("is-preferred");
                  }
                  const previewLabel = document.createElement("span");
                  previewLabel.className = "counter-editor-hoi4-preview-label";
                  previewLabel.textContent = label;
                  if (src) {
                    const image = document.createElement("img");
                    image.src = src;
                    image.alt = `${entry.label} ${label}`;
                    image.loading = "lazy";
                    box.appendChild(image);
                  } else {
                    const fallback = document.createElement("span");
                    fallback.className = "counter-editor-symbol-card-subtitle";
                    fallback.textContent = t("Missing", "ui");
                    box.appendChild(fallback);
                  }
                  box.appendChild(previewLabel);
                  return box;
                };
                previewRow.append(
                  createPreview(t("Small", "ui"), previewSet.small, hoi4PreferredVariant === "small"),
                  createPreview(t("Large", "ui"), previewSet.large, hoi4PreferredVariant === "large")
                );
                const title = document.createElement("span");
                title.className = "counter-editor-symbol-card-title";
                title.textContent = entry.label;
                const subtitle = document.createElement("span");
                subtitle.className = "counter-editor-symbol-card-subtitle";
                subtitle.textContent = `${entry.domain} · ${formatEntryKind(entry.kind)}`;
                const path = document.createElement("div");
                path.className = "counter-editor-hoi4-path";
                path.textContent = entry.sourceGamePath || entry.sourceTextureFile || entry.spriteName;
                const meta = document.createElement("div");
                meta.className = "counter-editor-hoi4-meta";
                meta.textContent = entry.spriteName;
                const tags = document.createElement("div");
                tags.className = "counter-editor-hoi4-tags";
                const presetTags = Array.isArray(entry.mappedPresetIds) && entry.mappedPresetIds.length
                  ? entry.mappedPresetIds
                  : ["unmapped"];
                presetTags.forEach((presetId) => {
                  const tag = document.createElement("span");
                  tag.className = "counter-editor-hoi4-tag";
                  tag.textContent = presetId === "unmapped" ? t("Unmapped", "ui") : presetId.toUpperCase();
                  tags.appendChild(tag);
                });
                card.append(previewRow, title, subtitle, meta, path, tags);
                unitCounterCatalogGrid.appendChild(card);
              }); */
            }
          }
        }
      }
    if (shouldRefreshCounterList) {
      recordStrategicOverlayPerfCounter("counterList");
      suppressUnitCounterListChange = true;
      try {
        syncSelectOptions(unitCounterList, [
          { value: "", label: t("No unit counters", "ui") },
          ...(state.unitCounters || []).map((counter) => ({
            value: String(counter.id || ""),
            label: formatUnitCounterListLabel(counter),
          })),
        ], {
          value: String(unitEditor.selectedId || ""),
          signatureKey: "counterListOptionsSignature",
        });
      } finally {
        suppressUnitCounterListChange = false;
      }
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

  const syncUnitCounterCombatStateToSelection = (partial = {}, { commitSelected = true } = {}) => {
    const nextCombatState = resolveUnitCounterCombatState({
      organizationPct: partial.organizationPct ?? state.unitCounterEditor.organizationPct,
      equipmentPct: partial.equipmentPct ?? state.unitCounterEditor.equipmentPct,
      baseFillColor: partial.baseFillColor ?? state.unitCounterEditor.baseFillColor,
      statsPresetId: partial.statsPresetId ?? state.unitCounterEditor.statsPresetId,
      statsSource: partial.statsSource ?? state.unitCounterEditor.statsSource,
    });
    state.unitCounterEditor.organizationPct = nextCombatState.organizationPct;
    state.unitCounterEditor.equipmentPct = nextCombatState.equipmentPct;
    state.unitCounterEditor.baseFillColor = nextCombatState.baseFillColor;
    state.unitCounterEditor.statsPresetId = nextCombatState.statsPresetId;
    state.unitCounterEditor.statsSource = nextCombatState.statsSource;
    if (commitSelected && !state.unitCounterEditor.active && state.unitCounterEditor.selectedId) {
      mapRenderer.updateSelectedUnitCounter(nextCombatState);
    } else if (render) {
      render();
    }
    scheduleStrategicOverlayRefresh(["counterCombat", "counterPreview"]);
  };
  const applyUnitCounterCombatPreset = (presetId, { source = "preset" } = {}) => {
    const preset = getUnitCounterCombatPreset(presetId);
    syncUnitCounterCombatStateToSelection({
      organizationPct: preset.organizationPct,
      equipmentPct: preset.equipmentPct,
      statsPresetId: preset.id,
      statsSource: source,
    });
  };
  const applyUnitCounterPresetSelection = (nextPresetId, { commitSelected = true } = {}) => {
    const normalizedPresetId = String(nextPresetId || unitCounterPresets[0].id).trim().toUpperCase();
    const nextPreset = getUnitCounterPresetMeta(normalizedPresetId);
    const nextRenderer = String(nextPreset.defaultRenderer || "game").trim().toLowerCase();
    const fallbackToken = nextRenderer === "milstd"
      ? String(nextPreset.baseSidc || "").trim().toUpperCase()
      : String(nextPreset.shortCode || "").trim().toUpperCase();
    state.unitCounterEditor.presetId = normalizedPresetId;
    state.unitCounterEditor.iconId = String(nextPreset.iconId || "").trim().toLowerCase();
    state.unitCounterEditor.unitType = String(nextPreset.unitType || nextPreset.id || "").trim().toUpperCase();
    state.unitCounterEditor.renderer = nextRenderer;
    state.unitCounterEditor.echelon = String(nextPreset.defaultEchelon || "").trim().toUpperCase();
    state.unitCounterEditor.sidc = fallbackToken;
    state.unitCounterEditor.symbolCode = fallbackToken;
    if (commitSelected && !state.unitCounterEditor.active && state.unitCounterEditor.selectedId) {
      mapRenderer.updateSelectedUnitCounter({
        presetId: normalizedPresetId,
        iconId: state.unitCounterEditor.iconId,
        unitType: state.unitCounterEditor.unitType,
        renderer: String(state.unitCounterEditor.renderer || nextRenderer).trim().toLowerCase(),
        echelon: String(state.unitCounterEditor.echelon || nextPreset.defaultEchelon || "").trim().toUpperCase(),
        sidc: String(state.unitCounterEditor.sidc || state.unitCounterEditor.symbolCode || fallbackToken || "").trim().toUpperCase(),
      });
    } else if (render) {
      render();
    }
    scheduleStrategicOverlayRefresh(["counterIdentity", "counterPreview", "counterCatalog"]);
  };

  if (unitCounterPresetSelect && !unitCounterPresetSelect.dataset.bound) {
    unitCounterPresetSelect.addEventListener("change", (event) => {
      applyUnitCounterPresetSelection(String(event.target.value || unitCounterPresets[0].id));
    });
    unitCounterPresetSelect.dataset.bound = "true";
  }
  if (unitCounterNationModeSelect && !unitCounterNationModeSelect.dataset.bound) {
    unitCounterNationModeSelect.addEventListener("change", (event) => {
      const nextMode = String(event.target.value || "display").trim().toLowerCase();
      state.unitCounterEditor.nationSource = nextMode === "manual" ? "manual" : "display";
      if (nextMode !== "manual") {
        state.unitCounterEditor.nationTag = "";
      }
      if (!state.unitCounterEditor.active && state.unitCounterEditor.selectedId) {
        mapRenderer.updateSelectedUnitCounter({
          nationSource: state.unitCounterEditor.nationSource,
          nationTag: state.unitCounterEditor.nationTag,
        });
      }
      scheduleStrategicOverlayRefresh(["counterIdentity", "counterPreview"]);
    });
    unitCounterNationModeSelect.dataset.bound = "true";
  }
  if (unitCounterNationSelect && !unitCounterNationSelect.dataset.bound) {
    unitCounterNationSelect.addEventListener("change", (event) => {
      const nextNationTag = String(event.target.value || "").trim().toUpperCase();
      state.unitCounterEditor.nationTag = nextNationTag;
      state.unitCounterEditor.nationSource = nextNationTag ? "manual" : "display";
      if (!state.unitCounterEditor.active && state.unitCounterEditor.selectedId) {
        mapRenderer.updateSelectedUnitCounter({
          nationTag: nextNationTag,
          nationSource: state.unitCounterEditor.nationSource,
        });
      }
      scheduleStrategicOverlayRefresh(["counterIdentity", "counterPreview"]);
    });
    unitCounterNationSelect.dataset.bound = "true";
  }
  if (unitCounterAttachmentSelect && !unitCounterAttachmentSelect.dataset.bound) {
    unitCounterAttachmentSelect.addEventListener("change", (event) => {
      const nextLineId = String(event.target.value || "").trim();
      state.unitCounterEditor.attachment = nextLineId
        ? { kind: "operational-line", lineId: nextLineId }
        : null;
      if (!state.unitCounterEditor.active && state.unitCounterEditor.selectedId) {
        mapRenderer.updateSelectedUnitCounter({ attachment: state.unitCounterEditor.attachment });
      } else if (render) {
        render();
      }
      scheduleStrategicOverlayRefresh(["counterIdentity", "counterPreview"]);
    });
    unitCounterAttachmentSelect.dataset.bound = "true";
  }
  if (unitCounterRendererSelect && !unitCounterRendererSelect.dataset.bound) {
    unitCounterRendererSelect.addEventListener("change", (event) => {
      const nextRenderer = String(event.target.value || "game");
      state.unitCounterEditor.renderer = nextRenderer;
      if (nextRenderer === "milstd" && !String(state.unitCounterEditor.sidc || state.unitCounterEditor.symbolCode || "").trim()) {
        state.unitCounterEditor.sidc = "130310001412110000000000000000";
        state.unitCounterEditor.symbolCode = state.unitCounterEditor.sidc;
      }
      state.annotationView = {
        ...(state.annotationView || {}),
        unitRendererDefault: nextRenderer,
      };
      if (!state.unitCounterEditor.active && state.unitCounterEditor.selectedId) {
        mapRenderer.updateSelectedUnitCounter({ renderer: nextRenderer });
      } else if (render) {
        render();
      }
      scheduleStrategicOverlayRefresh(["counterIdentity", "counterPreview"]);
      markDirty("unit-counter-renderer");
    });
    unitCounterRendererSelect.dataset.bound = "true";
  }
  if (unitCounterSizeSelect && !unitCounterSizeSelect.dataset.bound) {
    unitCounterSizeSelect.addEventListener("change", (event) => {
      const nextSize = String(event.target.value || "medium");
      state.unitCounterEditor.size = nextSize;
      if (!state.unitCounterEditor.active && state.unitCounterEditor.selectedId) {
        mapRenderer.updateSelectedUnitCounter({ size: nextSize });
      } else if (render) {
        render();
      }
      scheduleStrategicOverlayRefresh(["counterIdentity", "counterPreview"]);
    });
    unitCounterSizeSelect.dataset.bound = "true";
  }
  if (unitCounterEchelonSelect && !unitCounterEchelonSelect.dataset.bound) {
    unitCounterEchelonSelect.addEventListener("change", (event) => {
      state.unitCounterEditor.echelon = String(event.target.value || "").trim().toUpperCase();
      if (!state.unitCounterEditor.active && state.unitCounterEditor.selectedId) {
        mapRenderer.updateSelectedUnitCounter({ echelon: state.unitCounterEditor.echelon });
      }
      scheduleStrategicOverlayRefresh(["counterIdentity", "counterPreview"]);
    });
    unitCounterEchelonSelect.dataset.bound = "true";
  }
  if (unitCounterLabelInput && !unitCounterLabelInput.dataset.bound) {
    unitCounterLabelInput.addEventListener("input", (event) => {
      state.unitCounterEditor.label = String(event.target.value || "");
      scheduleStrategicOverlayRefresh("counterPreview");
    });
    unitCounterLabelInput.addEventListener("change", (event) => {
      const nextLabel = String(event.target.value || "");
      state.unitCounterEditor.label = nextLabel;
      if (!state.unitCounterEditor.active && state.unitCounterEditor.selectedId) {
        mapRenderer.updateSelectedUnitCounter({ label: nextLabel });
      }
      scheduleStrategicOverlayRefresh(["counterIdentity", "counterPreview", "counterList"]);
    });
    unitCounterLabelInput.dataset.bound = "true";
  }
  if (unitCounterSubLabelInput && !unitCounterSubLabelInput.dataset.bound) {
    unitCounterSubLabelInput.addEventListener("input", (event) => {
      state.unitCounterEditor.subLabel = String(event.target.value || "");
      scheduleStrategicOverlayRefresh("counterPreview");
    });
    unitCounterSubLabelInput.addEventListener("change", (event) => {
      state.unitCounterEditor.subLabel = String(event.target.value || "");
      if (!state.unitCounterEditor.active && state.unitCounterEditor.selectedId) {
        mapRenderer.updateSelectedUnitCounter({ subLabel: state.unitCounterEditor.subLabel });
      }
      scheduleStrategicOverlayRefresh(["counterIdentity", "counterPreview"]);
    });
    unitCounterSubLabelInput.dataset.bound = "true";
  }
  if (unitCounterStrengthInput && !unitCounterStrengthInput.dataset.bound) {
    unitCounterStrengthInput.addEventListener("input", (event) => {
      state.unitCounterEditor.strengthText = String(event.target.value || "");
      scheduleStrategicOverlayRefresh("counterPreview");
    });
    unitCounterStrengthInput.addEventListener("change", (event) => {
      state.unitCounterEditor.strengthText = String(event.target.value || "");
      if (!state.unitCounterEditor.active && state.unitCounterEditor.selectedId) {
        mapRenderer.updateSelectedUnitCounter({ strengthText: state.unitCounterEditor.strengthText });
      }
      scheduleStrategicOverlayRefresh(["counterIdentity", "counterPreview"]);
    });
    unitCounterStrengthInput.dataset.bound = "true";
  }
  if (unitCounterSymbolInput && !unitCounterSymbolInput.dataset.bound) {
    unitCounterSymbolInput.addEventListener("input", (event) => {
      const nextToken = String(event.target.value || "").trim().toUpperCase();
      state.unitCounterEditor.sidc = nextToken;
      state.unitCounterEditor.symbolCode = nextToken;
      scheduleStrategicOverlayRefresh("counterPreview");
    });
    unitCounterSymbolInput.addEventListener("change", (event) => {
      const nextSymbol = String(event.target.value || "").trim().toUpperCase();
      state.unitCounterEditor.sidc = nextSymbol;
      state.unitCounterEditor.symbolCode = nextSymbol;
      if (!state.unitCounterEditor.active && state.unitCounterEditor.selectedId) {
        mapRenderer.updateSelectedUnitCounter({ sidc: nextSymbol });
      } else if (render) {
        render();
      }
      scheduleStrategicOverlayRefresh(["counterIdentity", "counterPreview"]);
    });
    unitCounterSymbolInput.dataset.bound = "true";
  }
  if (unitCounterDetailToggleBtn && !unitCounterDetailToggleBtn.dataset.bound) {
    unitCounterDetailToggleBtn.addEventListener("click", () => {
      ensureStrategicOverlayUiState();
      state.strategicOverlayUi.counterEditorModalOpen = true;
      refreshStrategicOverlayUI({
        scopes: ["workspaceChrome", "counterIdentity", "counterCombat", "counterPreview", "counterCatalog"],
      });
    });
    unitCounterDetailToggleBtn.dataset.bound = "true";
  }
  if (unitCounterEditorModalCloseBtn && !unitCounterEditorModalCloseBtn.dataset.bound) {
    unitCounterEditorModalCloseBtn.addEventListener("click", () => {
      setCounterEditorModalState(false);
      refreshStrategicOverlayUI({ scopes: ["workspaceChrome"] });
    });
    unitCounterEditorModalCloseBtn.dataset.bound = "true";
  }
  if (unitCounterEditorModalOverlay && !unitCounterEditorModalOverlay.dataset.bound) {
    unitCounterEditorModalOverlay.addEventListener("click", (event) => {
      if (event.target !== unitCounterEditorModalOverlay) return;
      setCounterEditorModalState(false);
      refreshStrategicOverlayUI({ scopes: ["workspaceChrome"] });
    });
    unitCounterEditorModalOverlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setCounterEditorModalState(false);
        refreshStrategicOverlayUI({ scopes: ["workspaceChrome"] });
        return;
      }
      if (event.key !== "Tab") return;
      const focusables = getCounterEditorModalFocusableElements();
      if (!focusables.length) {
        event.preventDefault();
        unitCounterEditorModal?.focus({ preventScroll: true });
        return;
      }
      const currentIndex = focusables.indexOf(document.activeElement);
      if (currentIndex === -1) {
        event.preventDefault();
        focusables[0].focus({ preventScroll: true });
        return;
      }
      event.preventDefault();
      const delta = event.shiftKey ? -1 : 1;
      const nextIndex = (currentIndex + delta + focusables.length) % focusables.length;
      focusables[nextIndex].focus({ preventScroll: true });
    });
    unitCounterEditorModalOverlay.dataset.bound = "true";
  }
  if (unitCounterCatalogSearchInput && !unitCounterCatalogSearchInput.dataset.bound) {
    unitCounterCatalogSearchInput.addEventListener("input", (event) => {
      ensureStrategicOverlayUiState();
      if (state.strategicOverlayUi.counterCatalogSource === "hoi4") {
        state.strategicOverlayUi.hoi4CounterQuery = String(event.target.value || "");
      } else {
        state.strategicOverlayUi.counterCatalogQuery = String(event.target.value || "");
      }
      if (unitCounterCatalogSearchDebounceHandle !== null) {
        globalThis.clearTimeout(unitCounterCatalogSearchDebounceHandle);
      }
      unitCounterCatalogSearchDebounceHandle = globalThis.setTimeout(() => {
        unitCounterCatalogSearchDebounceHandle = null;
        scheduleStrategicOverlayRefresh("counterCatalog");
      }, 180);
    });
    unitCounterCatalogSearchInput.dataset.bound = "true";
  }
  if (unitCounterCatalogCategoriesEl && !unitCounterCatalogCategoriesEl.dataset.bound) {
    unitCounterCatalogCategoriesEl.addEventListener("click", (event) => {
      const button = event.target instanceof HTMLElement ? event.target.closest("[data-counter-catalog-category]") : null;
      if (!(button instanceof HTMLButtonElement)) return;
      ensureStrategicOverlayUiState();
      const nextCategory = String(button.dataset.counterCatalogCategory || "all").trim().toLowerCase() || "all";
      if (state.strategicOverlayUi.counterCatalogSource === "hoi4") {
        state.strategicOverlayUi.hoi4CounterCategory = nextCategory;
      } else {
        state.strategicOverlayUi.counterCatalogCategory = nextCategory;
      }
      scheduleStrategicOverlayRefresh("counterCatalog");
    });
    unitCounterCatalogCategoriesEl.dataset.bound = "true";
  }
  if (unitCounterCatalogSourceTabs && !unitCounterCatalogSourceTabs.dataset.bound) {
    unitCounterCatalogSourceTabs.addEventListener("click", (event) => {
      const button = event.target instanceof HTMLElement ? event.target.closest("[data-counter-catalog-source]") : null;
      if (!(button instanceof HTMLButtonElement)) return;
      ensureStrategicOverlayUiState();
      const nextSource = String(button.dataset.counterCatalogSource || "internal").trim().toLowerCase() === "hoi4"
        ? "hoi4"
        : "internal";
      if (state.strategicOverlayUi.counterCatalogSource === nextSource) return;
      state.strategicOverlayUi.counterCatalogSource = nextSource;
      scheduleStrategicOverlayRefresh("counterCatalog");
    });
    unitCounterCatalogSourceTabs.dataset.bound = "true";
  }
  if (unitCounterLibraryVariantRow && !unitCounterLibraryVariantRow.dataset.bound) {
    unitCounterLibraryVariantRow.addEventListener("click", (event) => {
      const button = event.target instanceof HTMLElement ? event.target.closest("[data-counter-library-variant]") : null;
      if (!(button instanceof HTMLButtonElement)) return;
      ensureStrategicOverlayUiState();
      state.strategicOverlayUi.hoi4CounterVariant = String(button.dataset.counterLibraryVariant || "small").trim().toLowerCase() === "large"
        ? "large"
        : "small";
      scheduleStrategicOverlayRefresh("counterCatalog");
    });
    unitCounterLibraryVariantRow.dataset.bound = "true";
  }
  if (unitCounterLibraryExportBtn && !unitCounterLibraryExportBtn.dataset.bound) {
    unitCounterLibraryExportBtn.addEventListener("click", () => {
      exportHoi4UnitIconReviewDraft();
    });
    unitCounterLibraryExportBtn.dataset.bound = "true";
  }
  if (unitCounterCatalogGrid && !unitCounterCatalogGrid.dataset.bound) {
    unitCounterCatalogGrid.addEventListener("click", (event) => {
      const reviewButton = event.target instanceof HTMLElement ? event.target.closest("[data-hoi4-review-action]") : null;
      if (reviewButton instanceof HTMLButtonElement) {
        const action = String(reviewButton.dataset.hoi4ReviewAction || "").trim();
        const entryId = String(reviewButton.dataset.hoi4EntryId || "").trim();
        const currentPresetId = String(state.unitCounterEditor?.presetId || DEFAULT_UNIT_COUNTER_PRESET_ID).trim();
        if (action === "toggle-current-mapping") {
          toggleHoi4EntryCurrentPresetMapping(entryId, currentPresetId);
          scheduleStrategicOverlayRefresh("counterCatalog");
          return;
        }
        if (action === "set-current-candidate") {
          setHoi4CurrentPresetCandidate(entryId, currentPresetId);
          scheduleStrategicOverlayRefresh("counterCatalog");
          return;
        }
      }
      const button = event.target instanceof HTMLElement ? event.target.closest("[data-unit-counter-catalog-preset]") : null;
      if (!(button instanceof HTMLButtonElement)) return;
      applyUnitCounterPresetSelection(String(button.dataset.unitCounterCatalogPreset || unitCounterPresets[0].id));
    });
    unitCounterCatalogGrid.dataset.bound = "true";
  }
  if (unitCounterStatsPresetSelect && !unitCounterStatsPresetSelect.dataset.bound) {
    unitCounterStatsPresetSelect.addEventListener("change", (event) => {
      applyUnitCounterCombatPreset(String(event.target.value || "regular"), { source: "preset" });
    });
    unitCounterStatsPresetSelect.dataset.bound = "true";
  }
  unitCounterStatsPresetButtons.forEach((button) => {
    if (button.dataset.bound) return;
    button.addEventListener("click", () => {
      applyUnitCounterCombatPreset(String(button.dataset.value || "regular"), { source: "preset" });
    });
    button.dataset.bound = "true";
  });
  if (unitCounterStatsRandomizeBtn && !unitCounterStatsRandomizeBtn.dataset.bound) {
    unitCounterStatsRandomizeBtn.addEventListener("click", () => {
      syncUnitCounterCombatStateToSelection(getRandomizedUnitCounterCombatState());
    });
    unitCounterStatsRandomizeBtn.dataset.bound = "true";
  }
  if (unitCounterOrganizationInput && !unitCounterOrganizationInput.dataset.bound) {
    unitCounterOrganizationInput.addEventListener("input", (event) => {
      syncUnitCounterCombatStateToSelection({
        organizationPct: event.target.value,
        statsSource: "manual",
      }, { commitSelected: false });
    });
    unitCounterOrganizationInput.addEventListener("change", (event) => {
      syncUnitCounterCombatStateToSelection({
        organizationPct: event.target.value,
        statsSource: "manual",
      });
    });
    unitCounterOrganizationInput.dataset.bound = "true";
  }
  if (unitCounterEquipmentInput && !unitCounterEquipmentInput.dataset.bound) {
    unitCounterEquipmentInput.addEventListener("input", (event) => {
      syncUnitCounterCombatStateToSelection({
        equipmentPct: event.target.value,
        statsSource: "manual",
      }, { commitSelected: false });
    });
    unitCounterEquipmentInput.addEventListener("change", (event) => {
      syncUnitCounterCombatStateToSelection({
        equipmentPct: event.target.value,
        statsSource: "manual",
      });
    });
    unitCounterEquipmentInput.dataset.bound = "true";
  }
  if (unitCounterBaseFillSwatch && !unitCounterBaseFillSwatch.dataset.bound) {
    unitCounterBaseFillSwatch.addEventListener("click", () => {
      unitCounterBaseFillColorInput?.click();
    });
    unitCounterBaseFillSwatch.dataset.bound = "true";
  }
  if (unitCounterBaseFillColorInput && !unitCounterBaseFillColorInput.dataset.bound) {
    unitCounterBaseFillColorInput.addEventListener("input", (event) => {
      syncUnitCounterCombatStateToSelection({
        baseFillColor: String(event.target.value || "").trim(),
        statsSource: state.unitCounterEditor.statsSource || "manual",
      }, { commitSelected: false });
    });
    unitCounterBaseFillColorInput.addEventListener("change", (event) => {
      syncUnitCounterCombatStateToSelection({
        baseFillColor: String(event.target.value || "").trim(),
        statsSource: state.unitCounterEditor.statsSource || "manual",
      });
    });
    unitCounterBaseFillColorInput.dataset.bound = "true";
  }
  if (unitCounterBaseFillResetBtn && !unitCounterBaseFillResetBtn.dataset.bound) {
    unitCounterBaseFillResetBtn.addEventListener("click", () => {
      syncUnitCounterCombatStateToSelection({
        baseFillColor: "",
        statsSource: state.unitCounterEditor.statsSource || "manual",
      });
    });
    unitCounterBaseFillResetBtn.dataset.bound = "true";
  }
  if (unitCounterBaseFillEyedropperBtn && !unitCounterBaseFillEyedropperBtn.dataset.bound) {
    unitCounterBaseFillEyedropperBtn.addEventListener("click", async () => {
      if (!("EyeDropper" in globalThis)) return;
      try {
        const picker = new globalThis.EyeDropper();
        const result = await picker.open();
        syncUnitCounterCombatStateToSelection({
          baseFillColor: String(result?.sRGBHex || "").trim(),
          statsSource: state.unitCounterEditor.statsSource || "manual",
        });
      } catch (_error) {
        // Ignore cancelled eyedropper sessions.
      }
    });
    unitCounterBaseFillEyedropperBtn.dataset.bound = "true";
  }
  if (unitCounterLabelsToggle && !unitCounterLabelsToggle.dataset.bound) {
    unitCounterLabelsToggle.addEventListener("change", (event) => {
      state.annotationView = {
        ...(state.annotationView || {}),
        showUnitLabels: !!event.target.checked,
      };
      if (render) render();
      scheduleStrategicOverlayRefresh("counterIdentity");
      markDirty("unit-counter-label-visibility");
    });
    unitCounterLabelsToggle.dataset.bound = "true";
  }
  if (unitCounterFixedScaleRange && !unitCounterFixedScaleRange.dataset.bound) {
    const applyUnitCounterFixedScale = (rawValue) => {
      const nextScale = clampUnitCounterFixedScaleMultiplier(Number(rawValue) / 100, 1.5);
      state.annotationView = normalizeAnnotationView({
        ...(state.annotationView || {}),
        unitCounterFixedScaleMultiplier: nextScale,
      });
      if (unitCounterFixedScaleValue) {
        unitCounterFixedScaleValue.textContent = `${nextScale.toFixed(2)}x`;
      }
      if (render) render();
      scheduleStrategicOverlayRefresh("counterIdentity");
      markDirty("unit-counter-fixed-scale");
    };
    unitCounterFixedScaleRange.addEventListener("input", (event) => {
      applyUnitCounterFixedScale(event.target.value);
    });
    unitCounterFixedScaleRange.addEventListener("change", (event) => {
      applyUnitCounterFixedScale(event.target.value);
    });
    unitCounterFixedScaleRange.dataset.bound = "true";
  }
  if (unitCounterPlaceBtn && !unitCounterPlaceBtn.dataset.bound) {
    unitCounterPlaceBtn.addEventListener("click", () => {
      const nextPresetId = String(unitCounterPresetSelect?.value || state.unitCounterEditor?.presetId || unitCounterPresets[0].id).trim().toUpperCase();
      const nextPreset = getUnitCounterPresetMeta(nextPresetId);
      const nextRenderer = String(unitCounterRendererSelect?.value || state.unitCounterEditor?.renderer || nextPreset.defaultRenderer || "game");
      const nextSymbol = String(
        unitCounterSymbolInput?.value
        || state.unitCounterEditor?.sidc
        || state.unitCounterEditor?.symbolCode
        || (String(nextRenderer).trim().toLowerCase() === "milstd"
          ? nextPreset.baseSidc
          : nextPreset.shortCode)
        || ""
      ).trim().toUpperCase();
      mapRenderer.startUnitCounterPlacement({
        renderer: nextRenderer,
        label: String(unitCounterLabelInput?.value || state.unitCounterEditor?.label || ""),
        sidc: nextSymbol,
        symbolCode: nextSymbol,
        size: String(unitCounterSizeSelect?.value || state.unitCounterEditor?.size || "medium"),
        nationTag: String(unitCounterNationSelect?.value || state.unitCounterEditor?.nationTag || "").trim().toUpperCase(),
        nationSource: String(unitCounterNationModeSelect?.value || state.unitCounterEditor?.nationSource || "display").trim().toLowerCase(),
        presetId: nextPresetId,
        iconId: String(nextPreset.iconId || "").trim().toLowerCase(),
        unitType: String(nextPreset.unitType || nextPreset.id || "").trim().toUpperCase(),
        echelon: String(unitCounterEchelonSelect?.value || state.unitCounterEditor?.echelon || nextPreset.defaultEchelon || "").trim().toUpperCase(),
        subLabel: String(unitCounterSubLabelInput?.value || state.unitCounterEditor?.subLabel || ""),
        strengthText: String(unitCounterStrengthInput?.value || state.unitCounterEditor?.strengthText || ""),
        attachment: String(unitCounterAttachmentSelect?.value || state.unitCounterEditor?.attachment?.lineId || "").trim()
          ? {
            kind: "operational-line",
            lineId: String(unitCounterAttachmentSelect?.value || state.unitCounterEditor?.attachment?.lineId || "").trim(),
          }
          : null,
        baseFillColor: String(state.unitCounterEditor?.baseFillColor || ""),
        organizationPct: clampUnitCounterStatValue(state.unitCounterEditor?.organizationPct, 78),
        equipmentPct: clampUnitCounterStatValue(state.unitCounterEditor?.equipmentPct, 74),
        statsPresetId: String(state.unitCounterEditor?.statsPresetId || "regular"),
        statsSource: String(state.unitCounterEditor?.statsSource || "preset"),
      });
      const placementRefreshScopes = ["counterIdentity", "counterPreview", "counterList"];
      scheduleStrategicOverlayRefresh(placementRefreshScopes);
      globalThis.requestAnimationFrame?.(() => {
        scheduleStrategicOverlayRefresh(placementRefreshScopes);
      });
    });
    unitCounterPlaceBtn.dataset.bound = "true";
  }
  if (unitCounterCancelBtn && !unitCounterCancelBtn.dataset.bound) {
    unitCounterCancelBtn.addEventListener("click", () => {
      mapRenderer.cancelUnitCounterPlacement();
      scheduleStrategicOverlayRefresh(["counterIdentity", "counterPreview", "counterList"]);
    });
    unitCounterCancelBtn.dataset.bound = "true";
  }
  if (unitCounterList && !unitCounterList.dataset.bound) {
    unitCounterList.addEventListener("change", (event) => {
      if (suppressUnitCounterListChange) {
        return;
      }
      mapRenderer.selectUnitCounterById(String(event.target.value || ""));
      scheduleStrategicOverlayRefresh(["counterIdentity", "counterCombat", "counterPreview", "counterList"]);
    });
    unitCounterList.dataset.bound = "true";
  }
  if (unitCounterDeleteBtn && !unitCounterDeleteBtn.dataset.bound) {
    unitCounterDeleteBtn.addEventListener("click", async () => {
      if (!state.unitCounterEditor?.selectedId) return;
      const confirmed = await showAppDialog({
        title: t("Delete Selected", "ui"),
        message: t("Delete the selected unit counter?", "ui"),
        details: t("This removes the selected project-local counter from the map.", "ui"),
        confirmLabel: t("Delete Counter", "ui"),
        cancelLabel: t("Cancel", "ui"),
        tone: "warning",
      });
      if (!confirmed) return;
      mapRenderer.deleteSelectedUnitCounter();
      scheduleStrategicOverlayRefresh(["counterIdentity", "counterCombat", "counterPreview", "counterList"]);
    });
    unitCounterDeleteBtn.dataset.bound = "true";
  }

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
