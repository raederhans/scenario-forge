// Palette library panel controller.
// 这个模块只负责色板库面板的分组、筛选、切换和 DOM 更新。
// toolbar.js 继续保留主初始化、快捷色板、主题选择和其他面板编排。

import { PALETTE_THEMES, state as runtimeState } from "../../core/state.js";
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
  const PALETTE_LIBRARY_GROUPS = [
    { key: "recent", label: () => t("Recent", "ui"), defaultOpen: true },
    { key: "essentials", label: () => t("Essentials", "ui"), defaultOpen: true },
    { key: "dynamic", label: () => t("Dynamic / Runtime", "ui"), defaultOpen: false },
    { key: "countries", label: () => t("Countries", "ui"), defaultOpen: false },
    { key: "extra", label: () => t("Extra", "ui"), defaultOpen: false },
  ];
  const PALETTE_LIBRARY_HEIGHT = {
    base: 240,
    cap: 480,
  };
  let adaptivePaletteLibraryHeightFrame = 0;
  let activeRowKey = "";

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

  const buildPaletteLibraryGroups = (entries, recentEntries = []) => {
    const groups = {
      recent: recentEntries,
      essentials: [],
      dynamic: [],
      countries: [],
      extra: [],
    };
    entries.forEach((entry) => {
      if (Number.isFinite(entry.quickIndex)) {
        groups.essentials.push(entry);
        return;
      }
      if (entry.dynamic) {
        groups.dynamic.push(entry);
        return;
      }
      if (entry.mapped) {
        groups.countries.push(entry);
        return;
      }
      groups.extra.push(entry);
    });
    return PALETTE_LIBRARY_GROUPS.map((group) => ({
      ...group,
      entries: groups[group.key] || [],
    })).filter((group) => group.entries.length > 0);
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
    runtimeState.selectedColor = entry.color;
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

  const createPaletteLibraryRow = (entry) => {
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
    meta.className = "palette-library-meta";

    const title = document.createElement("span");
    title.className = "palette-library-title";
    title.textContent = entry.localizedName || entry.label;

    const subtitle = document.createElement("span");
    subtitle.className = "palette-library-subtitle";
    const isoTag = entry.mappedIso2 || entry.iso2 || "--";
    const sourceTag = entry.sourceLabel || entry.sourceTag || "Palette";
    subtitle.textContent = `${isoTag} · ${sourceTag}`;
    row.title = [
      entry.localizedName || entry.label,
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
    return row;
  };

  function isPaletteLibraryRowVisible(row) {
    const section = row?.closest?.(".palette-library-section");
    return String(section?.tagName || "").toUpperCase() !== "DETAILS" || section.open;
  }

  function getPaletteLibraryRows() {
    return Array.from(paletteLibraryList?.querySelectorAll(".palette-library-row") || [])
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

  const clampPaletteLibraryHeight = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

  const syncAdaptivePaletteLibraryHeight = () => {
    adaptivePaletteLibraryHeightFrame = 0;
    if (!paletteLibraryList || !runtimeState.paletteLibraryOpen) return;
    const scrollHeight = Number(paletteLibraryList.scrollHeight || 0);
    const nextHeight = clampPaletteLibraryHeight(
      scrollHeight,
      PALETTE_LIBRARY_HEIGHT.base,
      PALETTE_LIBRARY_HEIGHT.cap
    );
    paletteLibraryList.style.height = `${Math.round(nextHeight)}px`;
    paletteLibraryList.style.maxHeight = `${Math.round(nextHeight)}px`;
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
    const activeValue = String(runtimeState.activePaletteId || "");
    if (themeSelect && themeSelect.value !== activeValue) {
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
    const groupedEntries = buildPaletteLibraryGroups(filtered, recentEntries);
    const activeSourceId = String(runtimeState.activePaletteId || runtimeState.currentPaletteTheme || "legacy").trim() || "legacy";
    const sectionState = ensurePaletteLibrarySectionState(activeSourceId);

    paletteLibraryList.replaceChildren();
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

export { createPaletteLibraryPanelController };

