// Palette library panel controller.
// 这个模块只负责色板库面板的分组、筛选、切换和 DOM 更新。
// toolbar.js 继续保留主初始化、快捷色板、主题选择和其他面板编排。

import { PALETTE_THEMES, state as runtimeState } from "../../core/state.js";
import { selectPalettePaintColorState } from "../../core/state/actions/palette_library_actions.js";
import { callCompatRuntimeHook } from "../../core/state/index.js";
import { patchUiChromeState } from "../../core/state/actions/ui_chrome_actions.js";
import {
  buildPaletteLibraryEntries,
  getPaletteSourceOptions,
  getSuggestedIso2,
  getUnmappedReason,
  normalizeHexColor,
  setActivePaletteSource,
} from "../../core/palette_manager.js";
import { t } from "../i18n.js";
const state = runtimeState;

function selectPalettePaintColor(appState, rawColor) {
  const color = normalizeHexColor(rawColor);
  if (!color) return false;
  selectPalettePaintColorState(appState, color);
  if (appState.ui && typeof appState.ui === "object") {
    patchUiChromeState(appState, { politicalEditingExpanded: false }, { normalizeExisting: false });
  }
  callCompatRuntimeHook(appState, "updatePaintModeUIFn");
  return true;
}

const PALETTE_LIBRARY_GROUPING_MODES = new Set(["default", "region"]);

const PALETTE_LIBRARY_GROUPS = [
  { key: "recent", label: () => t("Recent", "ui"), defaultOpen: true },
  { key: "essentials", label: () => t("Essentials", "ui"), defaultOpen: true },
  { key: "dynamic", label: () => t("Dynamic / Runtime", "ui"), defaultOpen: false },
  { key: "countries", label: () => t("Countries", "ui"), defaultOpen: false },
  { key: "extra", label: () => t("Extra", "ui"), defaultOpen: false },
];

const PALETTE_LIBRARY_REGION_LABELS = {
  europe: () => t("Europe", "ui"),
  asia: () => t("Asia", "ui"),
  middle_east: () => t("Middle East", "ui"),
  africa: () => t("Africa", "ui"),
  north_america: () => t("North America", "ui"),
  south_america: () => t("South America", "ui"),
  oceania: () => t("Oceania", "ui"),
  antarctica: () => t("Antarctica", "ui"),
};

const PALETTE_LIBRARY_REGION_ORDER = {
  europe: 10,
  asia: 20,
  middle_east: 25,
  africa: 30,
  north_america: 40,
  south_america: 50,
  oceania: 60,
  antarctica: 70,
};

function normalizePaletteLibraryGroupingMode(value) {
  const mode = String(value || "").trim();
  return PALETTE_LIBRARY_GROUPING_MODES.has(mode) ? mode : "default";
}

function normalizePaletteLibraryCountryCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizePaletteLibraryRegionKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^continent_/, "")
    .replace(/^region_/, "")
    .replace(/^subregion_/, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function resolvePaletteLibraryRegionFromMeta(meta = {}) {
  const subregionKey = normalizePaletteLibraryRegionKey(meta.subregionId || meta.subregion_id);
  if (subregionKey === "western_asia") {
    return {
      key: "middle_east",
      label: "Middle East",
      order: PALETTE_LIBRARY_REGION_ORDER.middle_east,
    };
  }
  const key = normalizePaletteLibraryRegionKey(meta.continentId || meta.continent_id || meta.continentLabel || meta.continent_label);
  if (!key) return null;
  const label = String(meta.continentLabel || meta.continent_label || "").trim() || key;
  return {
    key,
    label,
    order: PALETTE_LIBRARY_REGION_ORDER[key] || 999,
  };
}

function getPaletteLibraryScenarioCountryMeta(entry = {}, appState = runtimeState) {
  const candidates = [
    entry.mappedIso2,
    entry.iso2,
    entry.sourceTag,
  ].map(normalizePaletteLibraryCountryCode).filter(Boolean);
  const metaByCode = appState?.countryGroupMetaByCode;
  if (metaByCode && typeof metaByCode.get === "function") {
    for (const code of candidates) {
      const meta = metaByCode.get(code);
      if (meta) return meta;
    }
  }

  const scenarioCountries = appState?.scenarioCountriesByTag || {};
  for (const country of Object.values(scenarioCountries)) {
    const countryCodes = [
      country?.tag,
      country?.base_iso2,
      country?.lookup_iso2,
      country?.iso2,
    ].map(normalizePaletteLibraryCountryCode);
    if (!candidates.some((code) => countryCodes.includes(code))) continue;
    return {
      continentId: country.continent_id,
      continentLabel: country.continent_label,
      subregionId: country.subregion_id,
      subregionLabel: country.subregion_label,
    };
  }
  return null;
}

function resolvePaletteLibraryEntryRegion(entry = {}, appState = runtimeState) {
  const importedRegionKey = normalizePaletteLibraryRegionKey(entry.paletteRegionKey);
  if (importedRegionKey) {
    return {
      key: importedRegionKey,
      label: entry.paletteRegionLabel || importedRegionKey,
      order: Number.isFinite(entry.paletteRegionOrder)
        ? entry.paletteRegionOrder
        : (PALETTE_LIBRARY_REGION_ORDER[importedRegionKey] || 999),
    };
  }
  const scenarioMeta = getPaletteLibraryScenarioCountryMeta(entry, appState);
  return resolvePaletteLibraryRegionFromMeta(scenarioMeta || {});
}

function resolveAdaptivePaletteLibraryHeight(contentHeight, maximumHeight) {
  const content = Math.max(0, Number(contentHeight) || 0);
  const cap = Math.max(0, Number(maximumHeight) || 0);
  return cap > 0 ? Math.min(content, cap) : content;
}

function createPaletteLibraryRegionGroup(region, entry) {
  return {
    key: `region:${region.key}`,
    label: PALETTE_LIBRARY_REGION_LABELS[region.key] || (() => region.label || region.key),
    defaultOpen: false,
    entries: [entry],
    order: Number.isFinite(region.order) ? region.order : 999,
    fallbackLabel: region.label || region.key,
  };
}

function pushPaletteLibraryRegionEntry(regionGroups, entry, region) {
  const regionKey = String(region?.key || "").trim();
  if (!regionKey) return false;
  const existing = regionGroups.get(regionKey);
  if (existing) {
    existing.entries.push(entry);
  } else {
    regionGroups.set(regionKey, createPaletteLibraryRegionGroup(region, entry));
  }
  return true;
}

function buildPaletteLibraryGroups(entries, recentEntries = [], {
  groupingMode = "default",
  appState = runtimeState,
} = {}) {
  const mode = normalizePaletteLibraryGroupingMode(groupingMode);
  const groups = {
    recent: recentEntries,
    essentials: [],
    dynamic: [],
    countries: [],
    extra: [],
  };
  const regionGroups = new Map();
  entries.forEach((entry) => {
    if (entry.dynamic) {
      groups.dynamic.push(entry);
      return;
    }
    const region = resolvePaletteLibraryEntryRegion(entry, appState);
    if (mode === "region" && pushPaletteLibraryRegionEntry(regionGroups, entry, region)) {
      return;
    }
    if (Number.isFinite(entry.quickIndex)) {
      groups.essentials.push(entry);
      return;
    }
    if (entry.mapped) {
      groups.countries.push(entry);
      return;
    }
    if (pushPaletteLibraryRegionEntry(regionGroups, entry, region)) {
      return;
    }
    groups.extra.push(entry);
  });
  const baseGroups = PALETTE_LIBRARY_GROUPS.map((group) => ({
    ...group,
    entries: groups[group.key] || [],
  })).filter((group) => group.entries.length > 0 && group.key !== "extra");
  const groupedRegions = Array.from(regionGroups.values())
    .sort((a, b) => a.order - b.order || a.fallbackLabel.localeCompare(b.fallbackLabel));
  const extraGroup = groups.extra.length
    ? [{ ...PALETTE_LIBRARY_GROUPS.find((group) => group.key === "extra"), entries: groups.extra }]
    : [];
  return [...baseGroups, ...groupedRegions, ...extraGroup];
}

function createPaletteLibraryPanelController({
  themeSelect = null,
  paletteLibraryToggle = null,
  paletteLibraryPanel = null,
  paletteLibrarySources = null,
  paletteLibrarySearch = null,
  paletteLibrarySearchClear = null,
  paletteLibrarySummary = null,
  paletteLibraryList = null,
  paletteLibraryToggleLabel = null,
  applyPaletteLibraryColor = null,
  renderPalette,
  updateSwatchUI,
} = {}) {
  const PALETTE_LIBRARY_HEIGHT_CAP = 480;

  const readPaletteLibraryBlockSize = (name, fallbackValue) => {
    const source = paletteLibraryList || document.documentElement;
    const rawValue = globalThis.getComputedStyle?.(source)?.getPropertyValue(name) || "";
    const value = Number.parseFloat(rawValue);
    return Number.isFinite(value) ? value : fallbackValue;
  };
  let adaptivePaletteLibraryHeightFrame = 0;
  let activeRowKey = "";
  let paletteLibraryGroupingControls = null;

  const ensurePaletteLibrarySectionState = (sourceId) => {
    const key = String(sourceId || "legacy").trim() || "legacy";
    if (!runtimeState.ui.paletteLibrarySections[key] || typeof runtimeState.ui.paletteLibrarySections[key] !== "object") {
      runtimeState.ui.paletteLibrarySections[key] = {};
    }
    return runtimeState.ui.paletteLibrarySections[key];
  };

  const buildRecentPaletteEntries = (searchTerm) => {
    const recentColors = Array.isArray(runtimeState.recentColors) ? runtimeState.recentColors : [];
    return recentColors
      .map((color, index) => {
        const normalized = normalizeHexColor(color);
        if (!normalized) return null;
        return {
          key: `recent-${normalized}`,
          sourceTag: normalized.toUpperCase(),
          iso2: "",
          mappedIso2: "",
          color: normalized,
          label: `${t("Recent", "ui")} ${index + 1}`,
          localizedName: `${t("Recent", "ui")} ${index + 1}`,
          sourceLabel: t("Recent colors", "ui"),
          mapped: false,
          dynamic: false,
          recent: true,
        };
      })
      .filter(Boolean)
      .filter((entry) => !searchTerm || [
        entry.color,
        entry.label,
        entry.sourceLabel,
      ].some((value) => String(value || "").toLowerCase().includes(searchTerm)));
  };

  function formatPaletteReason(entry) {
    const reason = getUnmappedReason(entry) || String(entry?.mappingReason || "").trim();
    if (reason === "dynamic_tag_not_mapped") return t("Dynamic tag", "ui");
    if (reason === "unsupported_runtime_country") {
      const suggested = getSuggestedIso2(entry);
      return suggested
        ? `${t("Unsupported runtime country", "ui")} (${suggested})`
        : t("Unsupported runtime country", "ui");
    }
    if (reason === "colonial_predecessor") return t("Colonial predecessor", "ui");
    if (reason === "historical_union_or_predecessor") return t("Historical predecessor", "ui");
    if (reason === "split_state") return t("Split state", "ui");
    if (reason === "warlord_or_regional_tag") return t("Warlord / regional tag", "ui");
    if (reason === "fictional_or_alt_history") return t("Fictional / alt-history", "ui");
    if (reason === "ambiguous_identity") return t("Ambiguous identity", "ui");
    if (reason === "unreviewed") return t("Unreviewed", "ui");
    return reason || t("Unreviewed", "ui");
  }

  const selectPaletteLibraryEntry = (entry) => {
    selectPalettePaintColor(runtimeState, entry.color);
    activeRowKey = entry.key;
    updateSwatchUI?.();
    syncPaletteLibraryRowFocus();
  };

  const applyPaletteLibraryEntry = (entry) => {
    selectPaletteLibraryEntry(entry);
    if (typeof applyPaletteLibraryColor === "function") {
      applyPaletteLibraryColor(entry.color, entry);
    }
  };

  const createPaletteVariantEntry = (entry, variant) => ({
    ...entry,
    key: `${entry.key}:${variant.key}`,
    color: variant.color,
    displayColor: variant.color,
    sourceLabel: variant.label,
    colorVariantKey: variant.key,
    colorVariantSource: variant.source,
  });

  const createPaletteLibraryVariantList = (entry) => {
    const variants = Array.isArray(entry.colorVariants) ? entry.colorVariants : [];
    if (variants.length <= 1) return null;

    const details = document.createElement("details");
    details.className = "palette-library-variant-details";
    details.addEventListener("toggle", () => {
      syncPaletteLibraryRowFocus();
      scheduleAdaptivePaletteLibraryHeight();
    });

    const summary = document.createElement("summary");
    summary.textContent = runtimeState.currentLanguage === "zh"
      ? `${variants.length} 个颜色变体`
      : `${variants.length} color variants`;
    details.appendChild(summary);

    const list = document.createElement("div");
    list.className = "palette-library-variant-list";
    variants.forEach((variant) => {
      const variantEntry = createPaletteVariantEntry(entry, variant);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "palette-library-variant-btn";
      button.dataset.color = variant.color;
      button.dataset.paletteRowKey = variantEntry.key;
      button.tabIndex = -1;
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        selectPaletteLibraryEntry(variantEntry);
      });
      button.addEventListener("dblclick", (event) => {
        event.stopPropagation();
        applyPaletteLibraryEntry(variantEntry);
      });

      const swatch = document.createElement("span");
      swatch.className = "palette-library-variant-swatch";
      swatch.style.backgroundColor = variant.color;

      const label = document.createElement("span");
      label.className = "palette-library-variant-label";
      label.textContent = variant.source
        ? `${t(variant.label, "ui")} · ${variant.source}`
        : t(variant.label, "ui");

      button.appendChild(swatch);
      button.appendChild(label);
      list.appendChild(button);
    });
    details.appendChild(list);
    return details;
  };

  const createPaletteLibraryRow = (entry) => {
    const shell = document.createElement("div");
    shell.className = "palette-library-row-shell";

    const row = document.createElement("button");
    row.type = "button";
    row.className = "palette-library-row";
    row.dataset.color = entry.color;
    row.dataset.tag = entry.sourceTag;
    row.dataset.iso2 = entry.mappedIso2 || "";
    row.dataset.paletteRowKey = entry.key;
    row.tabIndex = -1;
    if (entry.color === runtimeState.selectedColor) {
      row.classList.add("is-selected");
    }
    row.addEventListener("click", () => {
      selectPaletteLibraryEntry(entry);
    });
    row.addEventListener("dblclick", () => {
      applyPaletteLibraryEntry(entry);
    });

    const swatch = document.createElement("span");
    swatch.className = "color-swatch";
    swatch.dataset.color = entry.color;
    swatch.style.backgroundColor = entry.color;

    const meta = document.createElement("span");
    meta.className = "palette-library-meta u-min-0";

    const title = document.createElement("span");
    title.className = "palette-library-title u-truncate";
    title.textContent = entry.localizedName || entry.label;

    const subtitle = document.createElement("span");
    subtitle.className = "palette-library-subtitle";
    const isoTag = entry.mappedIso2 || entry.iso2 || entry.paletteRegionLabel || "--";
    const sourceTag = entry.sourceLabel || entry.sourceTag || "Palette";
    subtitle.textContent = `${isoTag} · ${sourceTag}`;
    row.title = [
      entry.localizedName || entry.label,
      entry.localizedNameEn,
      entry.localizedNameZh,
      entry.sourceTag,
      entry.countryFileLabel,
      entry.mappedIso2
        ? `${t("Mapped to", "ui")} ${entry.mappedIso2}`
        : `${t("Unmapped", "ui")}: ${formatPaletteReason(entry)}`,
    ].filter(Boolean).join(" · ");

    meta.appendChild(title);
    meta.appendChild(subtitle);
    row.appendChild(swatch);
    row.appendChild(meta);
    shell.appendChild(row);
    const variantList = createPaletteLibraryVariantList(entry);
    if (variantList) {
      shell.appendChild(variantList);
    }
    return shell;
  };

  function isPaletteLibraryRowVisible(row) {
    const section = row?.closest?.(".palette-library-section");
    const variantDetails = row?.closest?.(".palette-library-variant-details");
    if (variantDetails && !variantDetails.open) return false;
    return String(section?.tagName || "").toUpperCase() !== "DETAILS" || section.open;
  }

  function getPaletteLibraryRows() {
    return Array.from(paletteLibraryList?.querySelectorAll(".palette-library-row, .palette-library-variant-btn") || [])
      .filter(isPaletteLibraryRowVisible);
  }

  function syncPaletteLibraryRowFocus() {
    const rows = getPaletteLibraryRows();
    if (!rows.length) return;
    const selectedRow = rows.find((row) => row.dataset.paletteRowKey === activeRowKey)
      || rows.find((row) => row.dataset.color === runtimeState.selectedColor)
      || rows[0];
    rows.forEach((row) => {
      row.tabIndex = row === selectedRow ? 0 : -1;
      row.classList.toggle("is-selected", row === selectedRow);
    });
  }

  function focusPaletteLibraryRowByDelta(delta) {
    const rows = getPaletteLibraryRows();
    if (!rows.length) return;
    const currentIndex = rows.findIndex((row) => row === document.activeElement);
    const nextIndex = currentIndex < 0
      ? 0
      : Math.min(rows.length - 1, Math.max(0, currentIndex + delta));
    const nextRow = rows[nextIndex];
    activeRowKey = nextRow.dataset.paletteRowKey || "";
    syncPaletteLibraryRowFocus();
    nextRow.focus();
  }

  function clearPaletteLibrarySearch() {
    runtimeState.paletteLibrarySearch = "";
    if (paletteLibrarySearch) {
      paletteLibrarySearch.value = "";
      paletteLibrarySearch.focus();
    }
    renderPaletteLibrary();
  }

  const renderPaletteLibrarySourceTabs = (sourceOptions) => {
    if (!paletteLibrarySources) return;
    paletteLibrarySources.replaceChildren();
    if (!sourceOptions.length) {
      paletteLibrarySources.classList.add("hidden");
      return;
    }
    paletteLibrarySources.classList.remove("hidden");
    sourceOptions.forEach((optionData) => {
      const button = document.createElement("button");
      const isActive = optionData.value === runtimeState.activePaletteId;
      button.type = "button";
      button.className = "palette-library-source-btn";
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(isActive));
      button.classList.toggle("is-active", isActive);
      button.textContent = optionData.label;
      button.addEventListener("click", async () => {
        if (isActive) return;
        await handlePaletteSourceChange(optionData.value);
      });
      paletteLibrarySources.appendChild(button);
    });
  };

  const updatePaletteLibraryGroupingControls = (mode) => {
    if (!paletteLibraryGroupingControls) return;
    paletteLibraryGroupingControls.setAttribute("aria-label", t("Palette grouping", "ui"));
    paletteLibraryGroupingControls
      .querySelectorAll(".palette-library-grouping-btn")
      .forEach((button) => {
        const isActive = button.dataset.groupingMode === mode;
        button.textContent = button.dataset.groupingMode === "region"
          ? t("Continents", "ui")
          : t("Default", "ui");
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-pressed", String(isActive));
      });
  };

  const ensurePaletteLibraryGroupingControls = (mode) => {
    if (!paletteLibraryPanel || paletteLibraryGroupingControls) {
      updatePaletteLibraryGroupingControls(mode);
      return;
    }
    paletteLibraryGroupingControls = document.createElement("div");
    paletteLibraryGroupingControls.className = "palette-library-grouping-toggle";
    paletteLibraryGroupingControls.setAttribute("role", "group");
    paletteLibraryGroupingControls.setAttribute("aria-label", t("Palette grouping", "ui"));

    [
      { key: "default", label: () => t("Default", "ui") },
      { key: "region", label: () => t("Continents", "ui") },
    ].forEach((optionData) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "palette-library-grouping-btn";
      button.dataset.groupingMode = optionData.key;
      button.textContent = optionData.label();
      button.addEventListener("click", () => {
        const nextMode = normalizePaletteLibraryGroupingMode(optionData.key);
        if (runtimeState.paletteLibraryGroupingMode === nextMode) return;
        runtimeState.paletteLibraryGroupingMode = nextMode;
        renderPaletteLibrary();
      });
      paletteLibraryGroupingControls.appendChild(button);
    });

    paletteLibrarySources?.insertAdjacentElement("afterend", paletteLibraryGroupingControls);
    updatePaletteLibraryGroupingControls(mode);
  };

  const syncAdaptivePaletteLibraryHeight = () => {
    adaptivePaletteLibraryHeightFrame = 0;
    if (!paletteLibraryList || !runtimeState.paletteLibraryOpen) return;
    paletteLibraryList.style.height = "auto";
    paletteLibraryList.style.maxHeight = "";
    const scrollHeight = Number(paletteLibraryList.scrollHeight || 0);
    const maximumHeight = readPaletteLibraryBlockSize("--palette-library-list-max-block", PALETTE_LIBRARY_HEIGHT_CAP);
    const nextHeight = resolveAdaptivePaletteLibraryHeight(scrollHeight, maximumHeight);
    paletteLibraryList.style.height = `${Math.round(nextHeight)}px`;
    paletteLibraryList.style.maxHeight = `${Math.round(maximumHeight)}px`;
  };

  const scheduleAdaptivePaletteLibraryHeight = () => {
    if (adaptivePaletteLibraryHeightFrame) {
      globalThis.cancelAnimationFrame(adaptivePaletteLibraryHeightFrame);
    }
    adaptivePaletteLibraryHeightFrame = globalThis.requestAnimationFrame(syncAdaptivePaletteLibraryHeight);
  };

  const syncPaletteLibraryToggleUi = () => {
    if (!paletteLibraryToggle) return;
    const label = runtimeState.paletteLibraryOpen
      ? t("Hide Color Library", "ui")
      : t("Browse All Colors", "ui");
    paletteLibraryToggle.setAttribute("aria-expanded", runtimeState.paletteLibraryOpen ? "true" : "false");
    paletteLibraryToggle.setAttribute("aria-label", label);
    paletteLibraryToggle.setAttribute("title", label);
    paletteLibraryToggle.dataset.expanded = runtimeState.paletteLibraryOpen ? "true" : "false";
    if (paletteLibraryToggleLabel) {
      paletteLibraryToggleLabel.textContent = label;
    }
  };

  const syncPaletteSourceControls = () => {
    if (!themeSelect) return;
    const sourceOptions = getPaletteSourceOptions();
    const currentOptions = Array.from(themeSelect.options || []);
    if (sourceOptions.length && (
      currentOptions.length !== sourceOptions.length
      || sourceOptions.some((option, index) => (
        currentOptions[index]?.value !== option.value
        || currentOptions[index]?.textContent !== option.label
      ))
    )) {
      const options = sourceOptions.map(({ value, label }) => {
        const option = themeSelect.ownerDocument.createElement("option");
        option.value = value;
        option.textContent = label;
        return option;
      });
      themeSelect.replaceChildren(...options);
    }
    const requestedValue = String(sourceOptions.length
      ? (runtimeState.activePaletteId || sourceOptions[0].value)
      : runtimeState.currentPaletteTheme || "");
    const activeValue = Array.from(themeSelect.options || []).some((option) => option.value === requestedValue)
      ? requestedValue : (themeSelect.options?.[0]?.value || "");
    if (themeSelect.value !== activeValue) {
      themeSelect.value = activeValue;
    }
  };

  async function handlePaletteSourceChange(nextPaletteId) {
    const targetId = String(nextPaletteId || "").trim();
    if (!targetId || targetId === runtimeState.activePaletteId) {
      syncPaletteSourceControls();
      return;
    }
    const didChange = await setActivePaletteSource(targetId, {
      syncUI: true,
      overwriteCountryPalette: false,
    });
    if (!didChange) {
      syncPaletteSourceControls();
    }
  }

  function renderPaletteLibrary() {
    if (!paletteLibraryList) return;

    const searchTerm = String(runtimeState.paletteLibrarySearch || "").trim().toLowerCase();
    paletteLibrarySearchClear?.classList.toggle("hidden", !searchTerm);
    const sourceOptions = getPaletteSourceOptions();
    renderPaletteLibrarySourceTabs(sourceOptions);
    const groupingMode = normalizePaletteLibraryGroupingMode(runtimeState.paletteLibraryGroupingMode);
    runtimeState.paletteLibraryGroupingMode = groupingMode;
    ensurePaletteLibraryGroupingControls(groupingMode);
    const sourceLabel = runtimeState.activePaletteMeta?.display_name || runtimeState.currentPaletteTheme || "Palette";
    const summarizeResults = (count) => (
      runtimeState.currentLanguage === "zh"
        ? `${count} 个颜色，来源 ${sourceLabel}`
        : `${count} colors from ${sourceLabel}`
    );
    let entries = [];
    if (runtimeState.activePalettePack?.entries) {
      entries = buildPaletteLibraryEntries();
    } else {
      entries = (PALETTE_THEMES[runtimeState.currentPaletteTheme] || []).map((color, index) => ({
        key: `legacy-${index}`,
        sourceTag: `LEGACY-${index + 1}`,
        iso2: "",
        color,
        label: `Palette Color ${index + 1}`,
        sourceLabel,
        mapped: false,
        unmappedReason: "",
        dynamic: false,
      }));
    }

    const filtered = entries.filter((entry) => {
      if (!searchTerm) return true;
      return [
        entry.label,
        entry.localizedName,
        entry.localizedNameEn,
        entry.localizedNameZh,
        entry.countryFileLabel,
        entry.iso2,
        entry.sourceTag,
        entry.sourceLabel,
        entry.mappingStatus,
        entry.mappedIso2,
        entry.unmappedReason,
        entry.suggestedIso2,
      ].some((value) => String(value || "").toLowerCase().includes(searchTerm));
    });
    const recentEntries = buildRecentPaletteEntries(searchTerm);
    const groupedEntries = buildPaletteLibraryGroups(filtered, recentEntries, { groupingMode });
    const activeSourceId = String(runtimeState.activePaletteId || runtimeState.currentPaletteTheme || "legacy").trim() || "legacy";
    const sectionState = ensurePaletteLibrarySectionState(`${activeSourceId}:${groupingMode}`);

    paletteLibraryList.replaceChildren();
    paletteLibraryList.dataset.groupingMode = groupingMode;
    if (paletteLibrarySummary) {
      paletteLibrarySummary.textContent = summarizeResults(filtered.length);
    }

    if (!groupedEntries.length) {
      const empty = document.createElement("div");
      empty.className = "palette-library-empty";
      empty.textContent = t("No matching colors. Clear the search or try a country name, ISO-2 code, or source tag.", "ui");
      paletteLibraryList.appendChild(empty);
      scheduleAdaptivePaletteLibraryHeight();
      return;
    }

    groupedEntries.forEach((group) => {
      const section = document.createElement("details");
      section.className = "palette-library-section";
      const isOpen = searchTerm
        ? group.entries.length > 0
        : (typeof sectionState[group.key] === "boolean" ? sectionState[group.key] : group.defaultOpen);
      section.open = isOpen;
      section.addEventListener("toggle", () => {
        if (!searchTerm) {
          sectionState[group.key] = section.open;
        }
        syncPaletteLibraryRowFocus();
        scheduleAdaptivePaletteLibraryHeight();
      });

      const summary = document.createElement("summary");

      const heading = document.createElement("div");
      heading.className = "palette-library-section-heading";

      const title = document.createElement("div");
      title.className = "palette-library-section-title";
      title.textContent = group.label();

      const count = document.createElement("div");
      count.className = "palette-library-section-count";
      count.textContent = String(group.entries.length);

      heading.appendChild(title);
      heading.appendChild(count);
      summary.appendChild(heading);
      section.appendChild(summary);

      const list = document.createElement("div");
      list.className = "palette-library-section-list";
      group.entries.forEach((entry) => {
        list.appendChild(createPaletteLibraryRow(entry));
      });
      section.appendChild(list);
      paletteLibraryList.appendChild(section);
    });
    scheduleAdaptivePaletteLibraryHeight();
    syncPaletteLibraryToggleUi();
    syncPaletteLibraryRowFocus();
  }

  const bindEvents = () => {
    if (paletteLibraryToggle && paletteLibraryToggle.dataset.bound !== "true") {
      paletteLibraryToggle.addEventListener("click", () => {
        runtimeState.paletteLibraryOpen = !runtimeState.paletteLibraryOpen;
        paletteLibraryPanel?.classList.toggle("hidden", !runtimeState.paletteLibraryOpen);
        syncPaletteLibraryToggleUi();
        renderPaletteLibrary();
      });
      paletteLibraryToggle.dataset.bound = "true";
    }

    if (paletteLibrarySearch && paletteLibrarySearch.dataset.bound !== "true") {
      paletteLibrarySearch.value = runtimeState.paletteLibrarySearch || "";
      paletteLibrarySearch.addEventListener("input", (event) => {
        runtimeState.paletteLibrarySearch = String(event.target.value || "");
        renderPaletteLibrary();
      });
      paletteLibrarySearch.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && String(runtimeState.paletteLibrarySearch || "")) {
          event.preventDefault();
          clearPaletteLibrarySearch();
        }
      });
      paletteLibrarySearch.dataset.bound = "true";
    }

    if (paletteLibrarySearchClear && paletteLibrarySearchClear.dataset.bound !== "true") {
      paletteLibrarySearchClear.addEventListener("click", clearPaletteLibrarySearch);
      paletteLibrarySearchClear.dataset.bound = "true";
    }

    if (paletteLibraryList && paletteLibraryList.dataset.bound !== "true") {
      paletteLibraryList.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          focusPaletteLibraryRowByDelta(1);
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          focusPaletteLibraryRowByDelta(-1);
          return;
        }
        if (event.key === "Enter") {
          const row = document.activeElement?.closest?.(".palette-library-row");
          const color = row?.dataset?.color || "";
          if (color) {
            event.preventDefault();
            const entry = { key: row.dataset.paletteRowKey || color, color };
            applyPaletteLibraryEntry(entry);
          }
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          runtimeState.paletteLibraryOpen = false;
          syncPanelVisibility();
        }
      });
      paletteLibraryList.dataset.bound = "true";
    }
  };

  const syncPanelVisibility = () => {
    paletteLibraryPanel?.classList.toggle("hidden", !runtimeState.paletteLibraryOpen);
    syncPaletteLibraryToggleUi();
    scheduleAdaptivePaletteLibraryHeight();
  };

  const handleResize = () => {
    scheduleAdaptivePaletteLibraryHeight();
  };

  return {
    bindEvents,
    handlePaletteSourceChange,
    handleResize,
    renderPaletteLibrary,
    syncPaletteSourceControls,
    syncPanelVisibility,
  };
}

export {
  selectPalettePaintColor,
  buildPaletteLibraryGroups,
  createPaletteLibraryPanelController,
  normalizePaletteLibraryGroupingMode,
  resolveAdaptivePaletteLibraryHeight,
  resolvePaletteLibraryEntryRegion,
};

