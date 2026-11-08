import { resolveDataUrl, isExternalDataUrl } from "../../../core/data_base_url.js";
import {
  createEmptyHoi4UnitIconReviewDraft,
  filterHoi4UnitIconEntries,
  getHoi4UnitIconMappedPresetIds,
  getHoi4UnitIconVariantPath,
  loadHoi4UnitIconReviewDraft,
  loadHoi4UnitIconManifest,
  saveHoi4UnitIconReviewDraft,
} from "../../../core/unit_counter_icon_libraries.js";
import { DEFAULT_UNIT_COUNTER_PRESET_ID } from "../../../core/unit_counter_presets.js";

import { patchStrategicOverlayEditorState } from "../../../core/state/actions/strategic_overlay_actions.js";

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
  patchStrategicOverlayEditorState(state, "unitCounterEditor", {
    presetId: normalizedPresetId,
    iconId: String(nextPreset.iconId || "").trim().toLowerCase(),
    unitType: String(nextPreset.unitType || nextPreset.id || "").trim().toUpperCase(),
    renderer: nextRenderer,
    echelon: String(nextPreset.defaultEchelon || "").trim().toUpperCase(),
    sidc: fallbackToken,
    symbolCode: fallbackToken,
  });
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
    patchStrategicOverlayEditorState(state, "strategicOverlayUi", { hoi4CounterQuery: nextQuery });
    return;
  }
  patchStrategicOverlayEditorState(state, "strategicOverlayUi", { counterCatalogQuery: nextQuery });
}

export function setUnitCounterCatalogCategory({
  state,
  ensureStrategicOverlayUiState,
  nextCategory,
}) {
  ensureStrategicOverlayUiState();
  const normalizedCategory = normalizeCatalogCategory(nextCategory);
  if (normalizeCatalogSource(state.strategicOverlayUi.counterCatalogSource) === "hoi4") {
    patchStrategicOverlayEditorState(state, "strategicOverlayUi", { hoi4CounterCategory: normalizedCategory });
    return;
  }
  patchStrategicOverlayEditorState(state, "strategicOverlayUi", { counterCatalogCategory: normalizedCategory });
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
  patchStrategicOverlayEditorState(state, "strategicOverlayUi", { counterCatalogSource: normalizedSource });
  return true;
}

export function setUnitCounterLibraryVariant({
  state,
  ensureStrategicOverlayUiState,
  nextVariant,
}) {
  ensureStrategicOverlayUiState();
  patchStrategicOverlayEditorState(state, "strategicOverlayUi", {
    hoi4CounterVariant: normalizeCatalogVariant(nextVariant),
  });
}

// Owns catalog loading, review persistence and incremental card rendering together.
export function createUnitCounterCatalog({
  t,
  getUnitCounterPresetMeta,
  showToast,
  onManifestSettled,
  loadManifest = loadHoi4UnitIconManifest,
  loadDraft = loadHoi4UnitIconReviewDraft,
  saveDraft = saveHoi4UnitIconReviewDraft,
}) {
  let hoi4UnitIconManifestStatus = "idle";
  let hoi4UnitIconManifestData = null;
  let hoi4UnitIconManifestError = null;
  let hoi4UnitIconReviewDraft = loadDraft();
  const normalizeHoi4ReviewPresetIds = (values = []) => Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean)
    )
  );
  const persistHoi4UnitIconReviewDraft = () => {
    hoi4UnitIconReviewDraft = saveDraft(hoi4UnitIconReviewDraft);
  };
  const getHoi4EffectiveMappedPresetIds = (entry) => getHoi4UnitIconMappedPresetIds(entry, hoi4UnitIconReviewDraft);
  const formatUnitCounterPresetChipLabel = (presetId = "") => {
    const normalizedPresetId = String(presetId || "").trim().toUpperCase();
    if (!normalizedPresetId) return t("Unmapped", "ui");
    const preset = getUnitCounterPresetMeta(normalizedPresetId);
    return preset?.label || normalizedPresetId;
  };
  const getHoi4CurrentPresetCandidateEntryId = (presetId = "") => {
    const normalizedPresetId = String(presetId || "").trim().toLowerCase();
    return normalizedPresetId
      ? String(hoi4UnitIconReviewDraft?.presetCandidates?.[normalizedPresetId] || "").trim()
      : "";
  };
  const setHoi4EntryMappedPresetIds = (entryId = "", mappedPresetIds = []) => {
    const normalizedEntryId = String(entryId || "").trim();
    if (!normalizedEntryId) return;
    const nextPresetIds = normalizeHoi4ReviewPresetIds(mappedPresetIds);
    const entry = hoi4UnitIconManifestData?.entries?.find((candidate) => candidate.id === normalizedEntryId) || null;
    const basePresetIds = entry ? normalizeHoi4ReviewPresetIds(entry.mappedPresetIds) : [];
    if (!nextPresetIds.length && !basePresetIds.length) {
      delete hoi4UnitIconReviewDraft.entryOverrides[normalizedEntryId];
    } else if (JSON.stringify(nextPresetIds) === JSON.stringify(basePresetIds)) {
      delete hoi4UnitIconReviewDraft.entryOverrides[normalizedEntryId];
    } else {
      hoi4UnitIconReviewDraft.entryOverrides[normalizedEntryId] = { mappedPresetIds: nextPresetIds };
    }
  };
  const toggleHoi4EntryCurrentPresetMapping = (entryId = "", presetId = "") => {
    const normalizedEntryId = String(entryId || "").trim();
    const normalizedPresetId = String(presetId || "").trim().toLowerCase();
    if (!normalizedEntryId || !normalizedPresetId) return false;
    const entry = hoi4UnitIconManifestData?.entries?.find((candidate) => candidate.id === normalizedEntryId) || null;
    if (!entry) return false;
    const nextPresetIds = new Set(getHoi4EffectiveMappedPresetIds(entry));
    if (nextPresetIds.has(normalizedPresetId)) {
      nextPresetIds.delete(normalizedPresetId);
      if (getHoi4CurrentPresetCandidateEntryId(normalizedPresetId) === normalizedEntryId) {
        delete hoi4UnitIconReviewDraft.presetCandidates[normalizedPresetId];
      }
    } else {
      nextPresetIds.add(normalizedPresetId);
    }
    setHoi4EntryMappedPresetIds(normalizedEntryId, Array.from(nextPresetIds));
    persistHoi4UnitIconReviewDraft();
    return nextPresetIds.has(normalizedPresetId);
  };
  const setHoi4CurrentPresetCandidate = (entryId = "", presetId = "") => {
    const normalizedEntryId = String(entryId || "").trim();
    const normalizedPresetId = String(presetId || "").trim().toLowerCase();
    if (!normalizedEntryId || !normalizedPresetId) return;
    const entry = hoi4UnitIconManifestData?.entries?.find((candidate) => candidate.id === normalizedEntryId) || null;
    if (!entry) return;
    const nextPresetIds = new Set(getHoi4EffectiveMappedPresetIds(entry));
    nextPresetIds.add(normalizedPresetId);
    setHoi4EntryMappedPresetIds(normalizedEntryId, Array.from(nextPresetIds));
    hoi4UnitIconReviewDraft.presetCandidates[normalizedPresetId] = normalizedEntryId;
    persistHoi4UnitIconReviewDraft();
  };
  const exportHoi4UnitIconReviewDraft = () => {
    const normalizedDraft = saveDraft(hoi4UnitIconReviewDraft || createEmptyHoi4UnitIconReviewDraft());
    const blob = new Blob([JSON.stringify(normalizedDraft, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "hoi4_unit_icon_review.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    globalThis.setTimeout(() => URL.revokeObjectURL(url), 100);
    showToast(t("HOI4 review draft downloaded.", "ui"), {
      title: t("Review exported", "ui"),
      tone: "success",
    });
  };
  const ensureHoi4UnitIconManifest = () => {
    if (hoi4UnitIconManifestStatus === "loading" || hoi4UnitIconManifestStatus === "ready") {
      return;
    }
    hoi4UnitIconManifestStatus = "loading";
    hoi4UnitIconManifestError = null;
    loadManifest()
      .then((manifest) => {
        hoi4UnitIconManifestData = manifest;
        hoi4UnitIconManifestStatus = "ready";
        onManifestSettled();
      })
      .catch((error) => {
        console.error("Failed to load HOI4 unit icon manifest:", error);
        hoi4UnitIconManifestStatus = "error";
        hoi4UnitIconManifestError = error;
        onManifestSettled();
      });
  };
  const formatHoi4EntryKind = (value = "") => String(value || "").replace(/_/g, " ");
  const getHoi4ReviewSummaryText = (effectivePresetId = "") => {
    const presetMeta = getUnitCounterPresetMeta(effectivePresetId || DEFAULT_UNIT_COUNTER_PRESET_ID);
    const candidateEntryId = getHoi4CurrentPresetCandidateEntryId(presetMeta.id);
    const candidateEntry = hoi4UnitIconManifestData?.entries?.find((entry) => entry.id === candidateEntryId) || null;
    const overrideCount = Object.keys(hoi4UnitIconReviewDraft?.entryOverrides || {}).length;
    return [
      `${t("Current Preset", "ui")}: ${presetMeta.label}`,
      candidateEntry ? `${t("Candidate", "ui")}: ${candidateEntry.label}` : `${t("Candidate", "ui")}: ${t("None selected", "ui")}`,
      `${t("Draft Overrides", "ui")}: ${overrideCount}`,
    ].join(" · ");
  };
  const cancelHoi4CatalogGridRender = (grid) => {
    if (!grid) return;
    if (typeof grid._hoi4RenderHandle === "number" && grid._hoi4RenderHandle) {
      globalThis.cancelAnimationFrame(grid._hoi4RenderHandle);
    }
    grid._hoi4RenderHandle = 0;
    grid._hoi4RenderToken = Number(grid._hoi4RenderToken || 0) + 1;
  };
  const buildHoi4CatalogCardRecord = (entry) => {
    const card = document.createElement("article");
    card.className = "counter-editor-symbol-card counter-editor-hoi4-card";
    card.dataset.hoi4EntryId = entry.id;

    const preview = document.createElement("div");
    preview.className = "counter-editor-hoi4-preview is-single";
    const image = document.createElement("img");
    image.alt = entry.label;
    image.loading = "lazy";
    image.decoding = "async";
    const missing = document.createElement("span");
    missing.className = "counter-editor-hoi4-preview-missing";
    const previewLabel = document.createElement("span");
    previewLabel.className = "counter-editor-hoi4-preview-label";
    preview.append(image, missing, previewLabel);

    const title = document.createElement("span");
    title.className = "counter-editor-symbol-card-title";
    const subtitle = document.createElement("span");
    subtitle.className = "counter-editor-symbol-card-subtitle";
    const meta = document.createElement("div");
    meta.className = "counter-editor-hoi4-meta";
    const tags = document.createElement("div");
    tags.className = "counter-editor-hoi4-tags";
    const actions = document.createElement("div");
    actions.className = "counter-editor-hoi4-actions";
    const mappingBtn = document.createElement("button");
    mappingBtn.type = "button";
    mappingBtn.className = "counter-editor-hoi4-action-btn";
    mappingBtn.dataset.hoi4ReviewAction = "toggle-current-mapping";
    mappingBtn.dataset.hoi4EntryId = entry.id;
    const candidateBtn = document.createElement("button");
    candidateBtn.type = "button";
    candidateBtn.className = "counter-editor-hoi4-action-btn";
    candidateBtn.dataset.hoi4ReviewAction = "set-current-candidate";
    candidateBtn.dataset.hoi4EntryId = entry.id;
    actions.append(mappingBtn, candidateBtn);
    card.append(preview, title, subtitle, meta, tags, actions);

    return {
      card,
      image,
      missing,
      previewLabel,
      title,
      subtitle,
      meta,
      tags,
      mappingBtn,
      candidateBtn,
    };
  };
  const updateHoi4CatalogCardRecord = (record, entry, { effectivePresetId, preferredVariant }) => {
    const currentPresetId = String(effectivePresetId || DEFAULT_UNIT_COUNTER_PRESET_ID).trim().toLowerCase();
    const variantPath = getHoi4UnitIconVariantPath(entry, preferredVariant);
    const mappedPresetIds = getHoi4EffectiveMappedPresetIds(entry);
    const isMappedToCurrentPreset = mappedPresetIds.includes(currentPresetId);
    const isCurrentPresetCandidate = getHoi4CurrentPresetCandidateEntryId(currentPresetId) === entry.id;
    record.card.classList.toggle("is-candidate", isCurrentPresetCandidate);
    if (variantPath) {
      const resolvedVariantPath = resolveDataUrl(variantPath);
      if (record.image.getAttribute("src") !== resolvedVariantPath) {
        if (isExternalDataUrl(resolvedVariantPath, variantPath)) record.image.crossOrigin = "anonymous";
        record.image.src = resolvedVariantPath;
      }
      record.image.hidden = false;
      record.missing.hidden = true;
    } else {
      record.image.hidden = true;
      record.image.removeAttribute("src");
      record.missing.hidden = false;
      record.missing.textContent = preferredVariant === "large"
        ? t("Missing Large", "ui")
        : t("Missing Small", "ui");
    }
    record.previewLabel.textContent = preferredVariant === "large"
      ? t("Large", "ui")
      : t("On-map Small", "ui");
    record.title.textContent = entry.label;
    record.subtitle.textContent = `${entry.domain} · ${formatHoi4EntryKind(entry.kind)}`;
    record.meta.textContent = entry.spriteName;
    record.tags.replaceChildren();
    const visiblePresetIds = mappedPresetIds.length ? mappedPresetIds : [""];
    visiblePresetIds.forEach((presetId) => {
      const tag = document.createElement("span");
      tag.className = "counter-editor-hoi4-tag";
      tag.textContent = presetId ? formatUnitCounterPresetChipLabel(presetId) : t("Unmapped", "ui");
      record.tags.appendChild(tag);
    });
    if (isCurrentPresetCandidate) {
      const candidateTag = document.createElement("span");
      candidateTag.className = "counter-editor-hoi4-tag is-candidate";
      candidateTag.textContent = t("Current Candidate", "ui");
      record.tags.appendChild(candidateTag);
    }
    const currentPresetLabel = formatUnitCounterPresetChipLabel(currentPresetId);
    record.mappingBtn.textContent = isMappedToCurrentPreset
      ? `${t("Unmap", "ui")} ${currentPresetLabel}`
      : `${t("Map", "ui")} ${currentPresetLabel}`;
    record.mappingBtn.classList.toggle("is-active", isMappedToCurrentPreset);
    record.candidateBtn.textContent = isCurrentPresetCandidate
      ? t("Current Candidate", "ui")
      : `${t("Set Candidate", "ui")} · ${currentPresetLabel}`;
    record.candidateBtn.classList.toggle("is-active", isCurrentPresetCandidate);
  };
  const renderHoi4CatalogCards = (grid, entries, options) => {
    cancelHoi4CatalogGridRender(grid);
    const emptyState = document.createElement("div");
    emptyState.className = "counter-editor-symbol-empty";
    if (!entries.length) {
      emptyState.textContent = t("No HOI4 icons match the current filter.", "ui");
      grid.replaceChildren(emptyState);
      return;
    }
    const cache = grid._hoi4CardCache instanceof Map ? grid._hoi4CardCache : new Map();
    grid._hoi4CardCache = cache;
    grid.replaceChildren();
    const renderToken = Number(grid._hoi4RenderToken || 0) + 1;
    grid._hoi4RenderToken = renderToken;
    const chunkSize = 24;
    const appendChunk = (startIndex = 0) => {
      if (grid._hoi4RenderToken !== renderToken) return;
      const fragment = document.createDocumentFragment();
      const endIndex = Math.min(startIndex + chunkSize, entries.length);
      for (let index = startIndex; index < endIndex; index += 1) {
        const entry = entries[index];
        let record = cache.get(entry.id);
        if (!record) {
          record = buildHoi4CatalogCardRecord(entry);
          cache.set(entry.id, record);
        }
        updateHoi4CatalogCardRecord(record, entry, options);
        fragment.appendChild(record.card);
      }
      grid.appendChild(fragment);
      if (endIndex < entries.length) {
        grid._hoi4RenderHandle = globalThis.requestAnimationFrame(() => appendChunk(endIndex));
      } else {
        grid._hoi4RenderHandle = 0;
      }
    };
    appendChunk(0);
  };
  const getHoi4CatalogFilterOptions = (effectivePresetId = "") => {
    const currentPreset = getUnitCounterPresetMeta(effectivePresetId || DEFAULT_UNIT_COUNTER_PRESET_ID);
    return [
      ["all", t("All", "ui")],
      ["current", currentPreset?.label ? `${t("Current Preset", "ui")} · ${currentPreset.label}` : t("Current Preset", "ui")],
      ["ground", "Ground"],
      ["air", "Air"],
      ["naval", "Naval"],
    ];
  };

  function applyReviewAction({
    action,
    entryId,
    currentPresetId,
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

  function renderUnitCounterCatalogSection({
    elements,
    catalogView = {},
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
      getFilteredUnitCounterCatalog,
      getUnitCounterCategoryLabel,
      getUnitCounterIconPathById,
      unitCounterCatalogCategories,
    } = helpers;
    const {
      isModalOpen = false,
      source = "internal",
      variant = "small",
      internalQuery = "",
      hoi4Query = "",
      internalCategory = "all",
      hoi4Category = "all",
    } = catalogView;
    const catalogSource = normalizeCatalogSource(source);
    const usingHoi4Catalog = catalogSource === "hoi4";
    const hoi4PreferredVariant = normalizeCatalogVariant(variant);
    const manifestStatus = hoi4UnitIconManifestStatus;

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
        ? hoi4Query
        : internalQuery;
      unitCounterCatalogSearchInput.placeholder = usingHoi4Catalog
        ? t("Search HOI4 sprite names, labels, keywords...", "ui")
        : t("Search internal presets, symbols, keywords...", "ui");
    }
    if (unitCounterCatalogCategoriesEl) {
      const categoryOptions = usingHoi4Catalog
        ? getHoi4CatalogFilterOptions(effectivePresetId)
        : [["all", t("All", "ui")], ...unitCounterCatalogCategories.map((category) => [category, getUnitCounterCategoryLabel(category)])];
      const activeCategory = usingHoi4Catalog
        ? normalizeCatalogCategory(hoi4Category)
        : normalizeCatalogCategory(internalCategory);
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
    cancelHoi4CatalogGridRender(unitCounterCatalogGrid);
    if (!(unitCounterCatalogGrid && isModalOpen)) {
      return;
    }
    unitCounterCatalogGrid.replaceChildren();
    const emptyState = document.createElement("div");
    emptyState.className = "counter-editor-symbol-empty";
    if (!usingHoi4Catalog) {
      const filteredCatalog = getFilteredUnitCounterCatalog({
        category: internalCategory,
        query: internalQuery,
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
    if (manifestStatus === "idle") {
      ensureHoi4UnitIconManifest();
    }
    if (manifestStatus === "loading" || manifestStatus === "idle") {
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
      filter: hoi4Category,
      query: hoi4Query,
      currentPresetId: effectivePresetId,
      getMappedPresetIds: getHoi4EffectiveMappedPresetIds,
    });
    renderHoi4CatalogCards(unitCounterCatalogGrid, filteredEntries, {
      effectivePresetId,
      preferredVariant: hoi4PreferredVariant,
    });
  }

  return {
    render: renderUnitCounterCatalogSection,
    cancelRender: cancelHoi4CatalogGridRender,
    applyReviewAction,
    exportReviewDraft: exportHoi4UnitIconReviewDraft,
  };
}
