function normalizeCatalogSource(value) {
  return String(value || "internal").trim().toLowerCase() === "hoi4"
    ? "hoi4"
    : "internal";
}

function normalizeCatalogVariant(value) {
  return String(value || "small").trim().toLowerCase() === "large"
    ? "large"
    : "small";
}

function normalizeCatalogCategory(value) {
  return String(value || "all").trim().toLowerCase() || "all";
}

export function applyUnitCounterPresetSelection({
  nextPresetId,
  state,
  unitCounterPresets,
  getUnitCounterPresetMeta,
  mapRenderer,
  render,
  scheduleStrategicOverlayRefresh,
  commitSelected = true,
}) {
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
}

export function setUnitCounterCatalogQuery({
  state,
  ensureStrategicOverlayUiState,
  rawValue,
}) {
  ensureStrategicOverlayUiState();
  const nextQuery = String(rawValue || "");
  if (normalizeCatalogSource(state.strategicOverlayUi.counterCatalogSource) === "hoi4") {
    state.strategicOverlayUi.hoi4CounterQuery = nextQuery;
    return;
  }
  state.strategicOverlayUi.counterCatalogQuery = nextQuery;
}

export function setUnitCounterCatalogCategory({
  state,
  ensureStrategicOverlayUiState,
  nextCategory,
}) {
  ensureStrategicOverlayUiState();
  const normalizedCategory = normalizeCatalogCategory(nextCategory);
  if (normalizeCatalogSource(state.strategicOverlayUi.counterCatalogSource) === "hoi4") {
    state.strategicOverlayUi.hoi4CounterCategory = normalizedCategory;
    return;
  }
  state.strategicOverlayUi.counterCatalogCategory = normalizedCategory;
}

export function setUnitCounterCatalogSource({
  state,
  ensureStrategicOverlayUiState,
  nextSource,
}) {
  ensureStrategicOverlayUiState();
  const normalizedSource = normalizeCatalogSource(nextSource);
  if (state.strategicOverlayUi.counterCatalogSource === normalizedSource) {
    return false;
  }
  state.strategicOverlayUi.counterCatalogSource = normalizedSource;
  return true;
}

export function setUnitCounterLibraryVariant({
  state,
  ensureStrategicOverlayUiState,
  nextVariant,
}) {
  ensureStrategicOverlayUiState();
  state.strategicOverlayUi.hoi4CounterVariant = normalizeCatalogVariant(nextVariant);
}

export function applyUnitCounterCatalogReviewAction({
  action,
  entryId,
  currentPresetId,
  toggleHoi4EntryCurrentPresetMapping,
  setHoi4CurrentPresetCandidate,
}) {
  if (action === "toggle-current-mapping") {
    toggleHoi4EntryCurrentPresetMapping(entryId, currentPresetId);
    return true;
  }
  if (action === "set-current-candidate") {
    setHoi4CurrentPresetCandidate(entryId, currentPresetId);
    return true;
  }
  return false;
}

export function renderUnitCounterCatalogSection({
  elements,
  state,
  t,
  effectivePresetId,
  helpers,
}) {
  const {
    unitCounterCatalogCategoriesEl,
    unitCounterCatalogGrid,
    unitCounterCatalogHeaderHint,
    unitCounterCatalogHeaderTitle,
    unitCounterCatalogSearchInput,
    unitCounterCatalogSourceTabs,
    unitCounterLibraryReviewBar,
    unitCounterLibraryReviewSummary,
    unitCounterLibraryVariantRow,
  } = elements;
  const {
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
  } = helpers;
  const catalogSource = normalizeCatalogSource(state.strategicOverlayUi.counterCatalogSource);
  const usingHoi4Catalog = catalogSource === "hoi4";
  const hoi4PreferredVariant = normalizeCatalogVariant(state.strategicOverlayUi.hoi4CounterVariant);
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
  unitCounterLibraryReviewBar?.classList.toggle("hidden", !usingHoi4Catalog);
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
      ? normalizeCatalogCategory(state.strategicOverlayUi?.hoi4CounterCategory || "all")
      : normalizeCatalogCategory(state.strategicOverlayUi?.counterCatalogCategory || "all");
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
  if (!(unitCounterCatalogGrid && state.strategicOverlayUi?.counterEditorModalOpen)) {
    return;
  }
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
      return;
    }
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
    return;
  }
  if (hoi4UnitIconManifestStatus === "idle") {
    ensureHoi4UnitIconManifest();
  }
  if (hoi4UnitIconManifestStatus === "loading" || hoi4UnitIconManifestStatus === "idle") {
    emptyState.textContent = t("Loading HOI4 unit icon library...", "ui");
    unitCounterCatalogGrid.appendChild(emptyState);
    return;
  }
  if (hoi4UnitIconManifestStatus === "error") {
    emptyState.textContent = hoi4UnitIconManifestError?.message
      ? String(hoi4UnitIconManifestError.message)
      : t("Failed to load the HOI4 unit icon library.", "ui");
    unitCounterCatalogGrid.appendChild(emptyState);
    return;
  }
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
}
