import { readMapLabelField, syncMapLabelField } from "./strategic_panel_view.js";
import {
  createUnitCounterCatalog,
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
import { patchStrategicOverlayEditorState } from "../../core/state/actions/strategic_overlay_actions.js";
import { commitMapLabelMove, deleteMapLabel, placeMapLabel, syncMapLabelHandles, updateMapLabel } from "../../core/map_renderer/public.js";
import { callRuntimeHook, registerRuntimeHook } from "../../core/state/index.js";
import { getCountryNameOverride } from "../../core/country_name_overrides.js";
import { getLocalizedScenarioCountryName } from "../../core/scenario/scenario_country_display.js";
import { loadDefenseLinePresets, buildScenarioDefenseLineEntries } from "../../core/scenario/defense_line_presets.js";
import { OPERATIONAL_LINE_KIND_LABELS, OPERATION_GRAPHIC_KIND_LABELS } from "./strategic_overlay/type_labels.js";

export function bindMapLabelPanel({ section, state, startPlacement, refresh, focusGeoBounds, countryName }) {
  const selectedId = () => state.mapLabelEditor.selectedId;
  section.querySelector("#mapLabelPlace").addEventListener("click", startPlacement);
  const list = section.querySelector("#mapLabelList");
  const focusSelection = () => {
    const label = state.mapLabels.find(item => item.id === list.value);
    if (!label) return;
    patchStrategicOverlayEditorState(state, "mapLabelEditor", { selectedId: label.id });
    const { lon, lat } = label;
    focusGeoBounds([lon, lat, lon, lat], {
      geometry: { type: "Point", coordinates: [lon, lat] }, maxScale: state.zoomTransform?.k || 1,
    });
    refresh();
  };
  list.addEventListener("click", focusSelection);
  list.addEventListener("change", () => {
    if (list.matches(":focus-visible")) focusSelection();
  });
  for (const field of section.querySelectorAll("[data-label-field]")) {
    const key = field.dataset.labelField;
    const commit = () => {
      const value = readMapLabelField(field, state.zoomTransform?.k || 1);
      const patch = { [key]: value };
      if (key === "countryCode") patch.fallbackName = value ? countryName(value) : "";
      if (updateMapLabel(selectedId(), patch)) refresh();
    };
    if (field.type === "range") field.addEventListener("input", () => {
      const readout = section.querySelector(`[data-label-readout="${key}"]`);
      if (readout && key === "size") {
        const k = state.zoomTransform?.k || 1;
        syncMapLabelField(readout, { size: readMapLabelField(field, k) }, k);
      } else if (readout) readout.value = field.value;
    });
    field.addEventListener(key === "text" ? "blur" : "change", commit);
    if (key === "text") field.addEventListener("keydown", event => {
      if (event.ctrlKey && event.key === "Enter") {
        event.preventDefault();
        field.blur();
      }
    });
  }
  const remove = () => {
    if (deleteMapLabel(selectedId())) refresh();
  };
  section.querySelector("#mapLabelDelete").addEventListener("click", remove);
  section.ownerDocument.addEventListener("keydown", event => {
    if (!state.strategicOverlayUi.modalOpen || state.strategicOverlayUi.modalSection !== "label" || !selectedId()) return;
    if (event.defaultPrevented || event.target.closest?.("input,textarea,[contenteditable=true]")) return;
    if (event.target !== list && event.target.closest?.("select")) return;
    const selected = state.mapLabels.find(label => label.id === selectedId());
    if (!selected) return;
    const step = 0.1 / (state.zoomTransform?.k || 1);
    if (event.ctrlKey && event.key.toLowerCase() === "d" && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      placeMapLabel({ ...selected, lon: selected.lon + (selected.lon > 0 ? -1 : 1) * step * 5,
        lat: selected.lat + (selected.lat > 0 ? -1 : 1) * step * 5 });
      refresh();
      return;
    }
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[event.key];
    if (delta) {
      event.preventDefault();
      if (commitMapLabelMove(selected.id, selected.lon + delta[0] * step, selected.lat + delta[1] * step)) refresh();
    } else if (["Delete", "Backspace"].includes(event.key)) {
      event.preventDefault();
      remove();
    }
  });
}

/**
 * Owns the strategic overlay workspace inside the sidebar:
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
    strategicOverlaySection,
    strategicWorkspaceBackdropEl,
    strategicOverlayOpenWorkspaceBtn,
    strategicOverlayCloseWorkspaceBtn,
    strategicOverlayIconCloseBtn,
    strategicOverlayPublishStatus,
    unitCounterDetailDrawer,
    unitCounterDetailToggleBtn,
    operationalLineKindSelect,
    operationalLineLabelInput,
    operationalLineLabelSizeInput,
    operationalLineLabelOnPathInput,
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
    operationGraphicLabelSizeInput,
    operationGraphicLabelOnPathInput,
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
    showToast,
    DEFAULT_UNIT_COUNTER_PRESET_ID,
  } = helpers;

  const formatOverlayListLabel = (entry, kindLabels) => {
    const kind = String(entry.kind || "");
    const kindLabel = Object.hasOwn(kindLabels, kind) ? t(kindLabels[kind], "ui") : kind;
    const label = String(entry.label || "").trim();
    return label ? (kindLabel ? `${label} (${kindLabel})` : label) : (kindLabel || String(entry.id || ""));
  };

  let defenseLinePayload;
  let defenseLineLoading = false;
  let defenseLineButton;
  let defenseLineStatus;
  const { mapLabelSection, mapLabelSectionToggle } = elements;
  const countryName = code => getCountryNameOverride(state, code) || getLocalizedScenarioCountryName(state.scenarioCountriesByTag?.[code],
    state.countryNames?.[code] || code, name => t(name, "geo"));
  let placingLabel = false;
  const annotationToggles = mapLabelSection ? mapLabelSection.ownerDocument.querySelectorAll("[data-annotation-view]") : [];
  const placementHint = mapLabelSection?.ownerDocument.getElementById("mapLabelPlacementHint");
  const textTool = mapLabelSection?.ownerDocument.getElementById("toolMapTextBtn");

  function refreshDefenseLinePresets() {
    if (!defenseLineButton) return;
    defenseLineButton.textContent = t("Add scenario defense lines", "ui");
    const presets = defenseLinePayload?.scenarios?.[state.activeScenarioId] || [];
    const existingIds = new Set((state.operationalLines || []).map((line) => line.id));
    const present = presets.filter((line) => existingIds.has(`preset_${state.activeScenarioId}_${line.id}`)).length;
    // The preset file is fetched on first click only, so it never joins startup.
    defenseLineButton.disabled = defenseLineLoading
      || (!!defenseLinePayload && (!presets.length || present === presets.length));
    defenseLineStatus.textContent = presets.length
      ? t("{count} preset lines; {present} already on map", "ui")
        .replace("{count}", presets.length).replace("{present}", present)
      : defenseLinePayload ? t("No preset defense lines for this scenario.", "ui") : "";
  }

  async function fetchDefenseLinePresets() {
    defenseLineLoading = true;
    defenseLineButton.disabled = true;
    try {
      defenseLinePayload = await loadDefenseLinePresets({});
    } catch (error) {
      defenseLineStatus.textContent = error.message;
      defenseLineButton.disabled = false;
    } finally {
      defenseLineLoading = false;
    }
    if (defenseLinePayload) refreshDefenseLinePresets();
  }

  if (operationalLineStartBtn?.parentElement) {
    defenseLineButton = document.createElement("button");
    defenseLineButton.type = "button";
    defenseLineButton.id = "operationalLinePresetsBtn";
    defenseLineButton.className = operationalLineStartBtn.className;
    operationalLineStartBtn.parentElement.append(defenseLineButton);
    defenseLineStatus = document.createElement("div");
    defenseLineStatus.className = operationalLineEditorHint?.className || "";
    defenseLineStatus.setAttribute("role", "status");
    operationalLineStartBtn.parentElement.after(defenseLineStatus);
    defenseLineButton.addEventListener("click", async () => {
      if (!defenseLinePayload) await fetchDefenseLinePresets();
      if (!defenseLinePayload) return;
      const entries = buildScenarioDefenseLineEntries(
        defenseLinePayload, state.activeScenarioId, state.operationalLines,
        { language: state.currentLanguage }
      );
      const count = mapRenderer.addScenarioDefenseLinePresets(entries);
      if (count && showToast) {
        showToast(t("Added {count} defense lines", "ui").replace("{count}", count));
      }
      refreshDefenseLinePresets();
    });
  }

  const unitCounterCatalog = createUnitCounterCatalog({
    t,
    getUnitCounterPresetMeta,
    showToast,
    onManifestSettled: () => refreshStrategicOverlayUI({ scopes: ["counterCatalog"] }),
  });

  const STRATEGIC_OVERLAY_REFRESH_SCOPES = Object.freeze([
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
    patchStrategicOverlayEditorState(state, "strategicOverlayUi", {
      counterEditorModalOpen: !!state.strategicOverlayUi?.counterEditorModalOpen,
      counterCatalogSource: String(state.strategicOverlayUi?.counterCatalogSource || "internal").trim().toLowerCase() === "hoi4"
        ? "hoi4"
        : "internal",
      counterCatalogCategory: String(state.strategicOverlayUi?.counterCatalogCategory || "all").trim().toLowerCase() || "all",
      counterCatalogQuery: String(state.strategicOverlayUi?.counterCatalogQuery || ""),
      hoi4CounterCategory: String(state.strategicOverlayUi?.hoi4CounterCategory || "all").trim().toLowerCase() || "all",
      hoi4CounterQuery: String(state.strategicOverlayUi?.hoi4CounterQuery || ""),
      hoi4CounterVariant: String(state.strategicOverlayUi?.hoi4CounterVariant || "small").trim().toLowerCase() === "large"
        ? "large"
        : "small",
    });
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
    // strategic overlay 的多个控件经常在同一轮操作里一起变脏，
    // 这里先聚合 scope，再压到下一帧统一刷新，避免连续改 state 时重复刷整块 sidebar。
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
    if (!nextOpen) unitCounterCatalog.cancelRender(unitCounterCatalogGrid);
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

  const refreshStrategicOverlayPublishStatus = () => {
    if (!strategicOverlayPublishStatus) return;
    const lineCount = Array.isArray(state.operationalLines) ? state.operationalLines.length : 0;
    const graphicCount = Array.isArray(state.operationGraphics) ? state.operationGraphics.length : 0;
    const counterCount = Array.isArray(state.unitCounters) ? state.unitCounters.length : 0;
    const countText = `${state.mapLabels?.length || 0} ${t("map labels", "ui")}`;
    const nextText = `${lineCount} ${t("lines", "ui")} · ${graphicCount} ${t("graphics", "ui")} · ${counterCount} ${t("counters", "ui")} · ${countText} · ${t("Export as Strategic annotations", "ui")}`;
    const nextTitle = t("Project export saves Strategic annotations.", "ui");
    const nextLabel = `${lineCount} ${t("lines", "ui")}, ${graphicCount} ${t("graphics", "ui")}, ${counterCount} ${t("counters", "ui")}, ${countText}. ${nextTitle}`;
    if (strategicOverlayPublishStatus.textContent !== nextText) {
      strategicOverlayPublishStatus.textContent = nextText;
    }
    if (strategicOverlayPublishStatus.title !== nextTitle) {
      strategicOverlayPublishStatus.title = nextTitle;
    }
    if (strategicOverlayPublishStatus.getAttribute("aria-label") !== nextLabel) {
      strategicOverlayPublishStatus.setAttribute("aria-label", nextLabel);
    }
  };

  const setStrategicWorkspaceModalState = (nextOpen, section = "line") => {
    const wasOpen = !!state.strategicOverlayUi?.modalOpen;
    const nextIsOpen = !!nextOpen;
    patchStrategicOverlayEditorState(state, "strategicOverlayUi", {
      modalOpen: nextIsOpen,
      modalSection: section,
    });
    // 工作台 modal 和 counter editor modal 不能同时抢焦点；
    // 这里把两者的开关关系集中收口，避免 sidebar / overlay / body class 各自漂移。
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
      strategicOverlaySection.dataset.workspaceSection = section;
    }
    if (mapLabelSection) {
      const open = nextIsOpen && section === "label";
      mapLabelSection.hidden = !open;
      syncMapLabelHandles(document.querySelector("#map-svg .map-label-handles"), state);
      mapLabelSectionToggle.textContent = t(open ? "Strategic Annotations" : "Map lettering", "ui");
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
    refreshDefenseLinePresets();
    const normalizedScopes = normalizeStrategicOverlayRefreshScopes(scopes);
    const annotationView = normalizeAnnotationView(state.annotationView);
    for (const toggle of annotationToggles) toggle.checked = annotationView[toggle.dataset.annotationView];
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
    // 所有 strategic 子面板都走同一个 scoped refresh 入口。
    // 这样外层只要声明“哪块脏了”，而不是分别记住几十个局部刷新函数。
    ensureStrategicOverlayUiState();
    refreshStrategicOverlayPublishStatus();
    if (mapLabelSection) {
      const { selectedId, active } = state.mapLabelEditor;
      const selected = state.mapLabels.find(label => label.id === selectedId);
      const list = mapLabelSection.querySelector("#mapLabelList");
      const options = state.mapLabels.map(label => ({
        value: label.id, label: label.text || label.fallbackName || label.countryCode || t("Enter name", "ui"),
      }));
      syncSelectOptions(list, options.length ? options : [{ value: "", label: t("Place a label to start lettering the map.", "ui") }], {
        value: selectedId, disabled: !options.length,
      });
      mapLabelSection.querySelector("#mapLabelFields").hidden = !selected;
      if (selected) {
        const countries = state.activeScenarioId ? state.scenarioCountriesByTag : state.sovereignBaseColors;
        const codes = new Set(Object.keys(countries || {}));
        if (selected.countryCode) codes.add(selected.countryCode);
        syncSelectOptions(mapLabelSection.querySelector("#mapLabelCountry"), [
          { value: "", label: t("None", "ui") },
          ...Array.from(codes).sort().map(code => ({
            value: code, label: t("{name} ({code})", "ui", { name: countryName(code), code }),
          })),
        ], { value: selected.countryCode });
        for (const readout of mapLabelSection.querySelectorAll("output[data-label-readout]")) {
          if (readout !== document.activeElement) readout.value = selected[readout.dataset.labelReadout] ?? 0;
        }
        for (const field of mapLabelSection.querySelectorAll("[data-label-field]")) {
          if (field !== document.activeElement) {
            syncMapLabelField(field, selected, state.zoomTransform?.k || 1, state.styleConfig?.countryLabels);
          }
        }
      }
      placementHint.hidden = !active;
      textTool.setAttribute("aria-pressed", String(active));
      if (active !== placingLabel) {
        const surface = document.querySelector("#map-svg .interaction-layer");
        if (surface) surface.style.cursor = active ? "crosshair" : "";
        strategicOverlaySection.style.visibility = active ? "hidden" : "";
        if (strategicWorkspaceBackdropEl) strategicWorkspaceBackdropEl.style.visibility = active ? "hidden" : "";
        if (!active && !mapLabelSection.hidden && selected && !selected.text && !selected.countryCode) {
          mapLabelSection.querySelector("textarea").focus();
        }
        placingLabel = active;
      }
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
    syncSelectOptions(operationalLineKindSelect, Object.entries(OPERATIONAL_LINE_KIND_LABELS).map(([value, label]) => ({ value, label: t(label, "ui") })), {
      value: operationalLineKind,
    });
    if (operationalLineLabelSizeInput) operationalLineLabelSizeInput.value = String(operationalLineEditor.labelSize ?? 9);
    if (operationalLineLabelOnPathInput) {
      operationalLineLabelOnPathInput.checked = operationalLineEditor.labelOnPath === true;
    }
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
        label: formatOverlayListLabel(line, OPERATIONAL_LINE_KIND_LABELS),
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
    syncSelectOptions(operationGraphicKindSelect, Object.entries(OPERATION_GRAPHIC_KIND_LABELS).map(([value, label]) => ({ value, label: t(label, "ui") })), {
      value: operationKind,
    });
    if (operationGraphicLabelSizeInput) operationGraphicLabelSizeInput.value = String(operationEditor.labelSize ?? 9);
    if (operationGraphicLabelOnPathInput) {
      operationGraphicLabelOnPathInput.checked = operationEditor.labelOnPath === true;
      operationGraphicLabelOnPathInput.disabled = ["encirclement", "theater"].includes(operationKind);
      operationGraphicLabelOnPathInput.title = operationGraphicLabelOnPathInput.disabled ? t("Along line is only available for open lines.", "ui") : "";
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
        label: formatOverlayListLabel(graphic, OPERATION_GRAPHIC_KIND_LABELS),
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
        unitCounterCatalog.render({
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
          catalogView: {
            isModalOpen: Boolean(state.strategicOverlayUi?.counterEditorModalOpen),
            source: String(state.strategicOverlayUi?.counterCatalogSource || "internal"),
            variant: String(state.strategicOverlayUi?.hoi4CounterVariant || "small"),
            internalQuery: String(state.strategicOverlayUi?.counterCatalogQuery || ""),
            hoi4Query: String(state.strategicOverlayUi?.hoi4CounterQuery || ""),
            internalCategory: String(state.strategicOverlayUi?.counterCatalogCategory || "all"),
            hoi4Category: String(state.strategicOverlayUi?.hoi4CounterCategory || "all"),
          },
          t,
          effectivePresetId: unitCounterViewModel.effectivePresetId,
          helpers: {
            getFilteredUnitCounterCatalog,
            getUnitCounterCategoryLabel,
            getUnitCounterIconPathById,
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
  if (mapLabelSection && !mapLabelSection.dataset.bound) {
    mapLabelSectionToggle.addEventListener("click", () => {
      const next = state.strategicOverlayUi.modalOpen && state.strategicOverlayUi.modalSection === "label" ? "line" : "label";
      cancelStrategicEditingModes();
      setStrategicWorkspaceModalState(true, next);
      refreshStrategicOverlayUI();
    });
    const startPlacement = () => {
      cancelStrategicEditingModes();
      document.getElementById("editorLayer-annotations")?.click();
      setStrategicWorkspaceModalState(true, "label");
      patchStrategicOverlayEditorState(state, "mapLabelEditor", { active: true });
      refreshStrategicOverlayUI({ scopes: "workspaceChrome" });
    };
    registerRuntimeHook(state, "runMapTextToolFn", startPlacement);
    textTool.addEventListener("click", () => callRuntimeHook(state, "runMapTextToolFn"));
    for (const toggle of annotationToggles) {
      toggle.addEventListener("change", () => {
        const snapshot = () => captureHistoryState({ strategicOverlay: ["annotationView"] });
        const before = snapshot();
        state.annotationView = normalizeAnnotationView({ ...state.annotationView, [toggle.dataset.annotationView]: toggle.checked });
        pushHistoryEntry({ kind: "annotation-visibility", before, after: snapshot() });
        markDirty("annotation-visibility");
        render();
      });
    }
    bindMapLabelPanel({ section: mapLabelSection, state, countryName, focusGeoBounds: mapRenderer.focusGeoBounds,
      refresh: refreshStrategicOverlayUI, startPlacement });
    mapLabelSection.dataset.bound = "true";
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
      patchStrategicOverlayEditorState(state, "strategicOverlayUi", {
        activeMode: nextKind,
        modalSection: "line",
      });
      if (operationalLineKindSelect) operationalLineKindSelect.value = nextKind;
      mapRenderer.startOperationalLineDraw({
        kind: nextKind,
        stylePreset: nextKind,
        label: String(operationalLineLabelInput?.value || ""),
        labelSize: state.operationalLineEditor?.labelSize,
        labelOnPath: state.operationalLineEditor?.labelOnPath,
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
      patchStrategicOverlayEditorState(state, "operationalLineEditor", { kind: nextKind, stylePreset: nextKind });
      patchStrategicOverlayEditorState(state, "strategicOverlayUi", {
        activeMode: nextKind,
        modalSection: "line",
      });
      if (!state.operationalLineEditor.active && state.operationalLineEditor.selectedId) {
        mapRenderer.updateSelectedOperationalLine({ kind: nextKind, stylePreset: nextKind });
      } else if (render) {
        render();
      }
      refreshStrategicOverlayUI();
    });
    operationalLineKindSelect.dataset.bound = "true";
  }
  for (const [input, key, editor, update] of [
    [operationalLineLabelSizeInput, "labelSize", "operationalLineEditor", mapRenderer.updateSelectedOperationalLine],
    [operationalLineLabelOnPathInput, "labelOnPath", "operationalLineEditor", mapRenderer.updateSelectedOperationalLine],
    [operationGraphicLabelSizeInput, "labelSize", "operationGraphicsEditor", mapRenderer.updateSelectedOperationGraphic],
    [operationGraphicLabelOnPathInput, "labelOnPath", "operationGraphicsEditor", mapRenderer.updateSelectedOperationGraphic],
  ]) {
    if (!input || input.dataset.bound) continue;
    input.addEventListener("change", () => {
      const value = key === "labelOnPath" ? input.checked : Math.max(4, Math.min(64, Number(input.value || 9)));
      const patch = { [key]: value };
      patchStrategicOverlayEditorState(state, editor, patch);
      if (!state[editor].active && state[editor].selectedId) update(patch);
      else if (render) render();
      refreshStrategicOverlayUI();
    });
    input.dataset.bound = "true";
  }
  if (operationalLineLabelInput && !operationalLineLabelInput.dataset.bound) {
    operationalLineLabelInput.addEventListener("input", (event) => {
      patchStrategicOverlayEditorState(state, "operationalLineEditor", { label: String(event.target.value || "") });
    });
    operationalLineLabelInput.addEventListener("change", (event) => {
      const nextLabel = String(event.target.value || "");
      patchStrategicOverlayEditorState(state, "operationalLineEditor", { label: nextLabel });
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
      patchStrategicOverlayEditorState(state, "operationalLineEditor", { stroke: nextStroke });
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
      patchStrategicOverlayEditorState(state, "operationalLineEditor", { width: nextWidth });
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
      patchStrategicOverlayEditorState(state, "operationalLineEditor", { opacity: nextOpacity });
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
      patchStrategicOverlayEditorState(state, "strategicOverlayUi", {
        activeMode: nextKind,
        modalSection: "line",
      });
      mapRenderer.startOperationalLineDraw({
        kind: nextKind,
        label: String(operationalLineLabelInput?.value || state.operationalLineEditor?.label || ""),
        labelSize: state.operationalLineEditor?.labelSize,
        labelOnPath: state.operationalLineEditor?.labelOnPath,
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
      patchStrategicOverlayEditorState(state, "strategicOverlayUi", {
        modalSection: "line",
      });
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
        patchStrategicOverlayEditorState(state, "operationGraphicsEditor", { kind: nextKind });
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
        patchStrategicOverlayEditorState(state, "operationGraphicsEditor", { stylePreset: nextPreset });
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
      patchStrategicOverlayEditorState(state, "operationGraphicsEditor", { label: String(event.target.value || "") });
    });
    operationGraphicLabelInput.addEventListener("change", (event) => {
      const nextLabel = String(event.target.value || "");
      patchStrategicOverlayEditorState(state, "operationGraphicsEditor", { label: nextLabel });
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
      patchStrategicOverlayEditorState(state, "operationGraphicsEditor", { stroke: nextStroke });
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
      patchStrategicOverlayEditorState(state, "operationGraphicsEditor", { width: nextWidth });
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
      patchStrategicOverlayEditorState(state, "operationGraphicsEditor", { opacity: nextOpacity });
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
        labelSize: state.operationGraphicsEditor?.labelSize,
        labelOnPath: state.operationGraphicsEditor?.labelOnPath,
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
      unitCounterCatalog,
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
      showAppDialog,
      t,
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
    refreshUI: refreshStrategicOverlayUI,
  };
}
