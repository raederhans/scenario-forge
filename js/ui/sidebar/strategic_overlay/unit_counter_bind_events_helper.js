import {
  applyUnitCounterCatalogReviewAction,
  applyUnitCounterPresetSelection as applyUnitCounterPresetSelectionHelper,
  setUnitCounterCatalogCategory,
  setUnitCounterCatalogQuery,
  setUnitCounterCatalogSource,
  setUnitCounterLibraryVariant,
} from "./unit_counter_catalog_helper.js";
import { getCounterEditorModalFocusableElements } from "./unit_counter_modal_helper.js";

/**
 * Owns unit counter editor event binding so the controller can stay a facade.
 */
export function bindUnitCounterSidebarEvents({
  state,
  elements,
  uiState,
  helpers,
}) {
  const {
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
  } = elements;
  const {
    clampUnitCounterFixedScaleMultiplier,
    clampUnitCounterStatValue,
    DEFAULT_UNIT_COUNTER_PRESET_ID,
    exportHoi4UnitIconReviewDraft,
    getRandomizedUnitCounterCombatState,
    getUnitCounterCombatPreset,
    getUnitCounterPresetMeta,
    markDirty,
    mapRenderer,
    normalizeAnnotationView,
    render,
    resolveUnitCounterCombatState,
    scheduleStrategicOverlayRefresh,
    setCounterEditorModalState,
    showAppDialog,
    refreshStrategicOverlayUI,
    t,
    toggleHoi4EntryCurrentPresetMapping,
    setHoi4CurrentPresetCandidate,
    unitCounterPresets,
    ensureStrategicOverlayUiState,
  } = helpers;

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
    applyUnitCounterPresetSelectionHelper({
      nextPresetId,
      state,
      unitCounterPresets,
      getUnitCounterPresetMeta,
      mapRenderer,
      render,
      scheduleStrategicOverlayRefresh,
      commitSelected,
    });
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
      const focusables = getCounterEditorModalFocusableElements(unitCounterEditorModal);
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
      setUnitCounterCatalogQuery({
        state,
        ensureStrategicOverlayUiState,
        rawValue: event.target.value,
      });
      if (uiState.catalogSearchDebounceHandle !== null) {
        globalThis.clearTimeout(uiState.catalogSearchDebounceHandle);
      }
      uiState.catalogSearchDebounceHandle = globalThis.setTimeout(() => {
        uiState.catalogSearchDebounceHandle = null;
        scheduleStrategicOverlayRefresh("counterCatalog");
      }, 180);
    });
    unitCounterCatalogSearchInput.dataset.bound = "true";
  }
  if (unitCounterCatalogCategoriesEl && !unitCounterCatalogCategoriesEl.dataset.bound) {
    unitCounterCatalogCategoriesEl.addEventListener("click", (event) => {
      const button = event.target instanceof HTMLElement ? event.target.closest("[data-counter-catalog-category]") : null;
      if (!(button instanceof HTMLButtonElement)) return;
      setUnitCounterCatalogCategory({
        state,
        ensureStrategicOverlayUiState,
        nextCategory: button.dataset.counterCatalogCategory,
      });
      scheduleStrategicOverlayRefresh("counterCatalog");
    });
    unitCounterCatalogCategoriesEl.dataset.bound = "true";
  }
  if (unitCounterCatalogSourceTabs && !unitCounterCatalogSourceTabs.dataset.bound) {
    unitCounterCatalogSourceTabs.addEventListener("click", (event) => {
      const button = event.target instanceof HTMLElement ? event.target.closest("[data-counter-catalog-source]") : null;
      if (!(button instanceof HTMLButtonElement)) return;
      const changed = setUnitCounterCatalogSource({
        state,
        ensureStrategicOverlayUiState,
        nextSource: button.dataset.counterCatalogSource,
      });
      if (!changed) return;
      scheduleStrategicOverlayRefresh("counterCatalog");
    });
    unitCounterCatalogSourceTabs.dataset.bound = "true";
  }
  if (unitCounterLibraryVariantRow && !unitCounterLibraryVariantRow.dataset.bound) {
    unitCounterLibraryVariantRow.addEventListener("click", (event) => {
      const button = event.target instanceof HTMLElement ? event.target.closest("[data-counter-library-variant]") : null;
      if (!(button instanceof HTMLButtonElement)) return;
      setUnitCounterLibraryVariant({
        state,
        ensureStrategicOverlayUiState,
        nextVariant: button.dataset.counterLibraryVariant,
      });
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
        const handled = applyUnitCounterCatalogReviewAction({
          action,
          entryId,
          currentPresetId,
          toggleHoi4EntryCurrentPresetMapping,
          setHoi4CurrentPresetCandidate,
        });
        if (handled) {
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
      if (uiState.suppressListChange) {
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
}
