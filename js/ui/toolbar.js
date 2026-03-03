// Toolbar UI (Phase 13)
import { state, PALETTE_THEMES } from "../core/state.js";
import {
  autoFillMap,
  refreshColorState,
  recomputeDynamicBordersNow,
  scheduleDynamicBorderRecompute,
  startSpecialZoneDraw,
  undoSpecialZoneVertex,
  finishSpecialZoneDraw,
  cancelSpecialZoneDraw,
  deleteSelectedManualSpecialZone,
  selectSpecialZoneById,
} from "../core/map_renderer.js";
import {
  buildPaletteLibraryEntries,
  buildPaletteQuickSwatches,
  getPaletteSourceOptions,
  getSuggestedIso2,
  getUnmappedReason,
  normalizeHexColor,
  setActivePaletteSource,
} from "../core/palette_manager.js";
import { toggleLanguage, updateUIText, t } from "./i18n.js";
import { resetAllFeatureOwnersToCanonical } from "../core/sovereignty_manager.js";

function renderPalette(themeName) {
  const paletteGrid = document.getElementById("paletteGrid");
  if (!paletteGrid) return;
  state.currentPaletteTheme = themeName;
  paletteGrid.replaceChildren();

  let swatches = [];
  if (state.activePalettePack?.entries) {
    swatches = buildPaletteQuickSwatches(24).map((entry) => entry.color);
  } else {
    swatches = Array.isArray(PALETTE_THEMES[themeName]) ? PALETTE_THEMES[themeName] : [];
  }

  swatches.forEach((color) => {
    const normalized = normalizeHexColor(color);
    if (!normalized) return;
    const btn = document.createElement("button");
    btn.className = "color-swatch";
    btn.dataset.color = normalized;
    btn.style.backgroundColor = normalized;
    btn.addEventListener("click", () => {
      state.selectedColor = normalized;
      if (typeof state.updateSwatchUIFn === "function") {
        state.updateSwatchUIFn();
      }
    });
    paletteGrid.appendChild(btn);
  });

  if (!normalizeHexColor(state.selectedColor) && swatches.length > 0) {
    state.selectedColor = swatches[0];
  }
  if (typeof state.updateSwatchUIFn === "function") {
    state.updateSwatchUIFn();
  }
}

function populatePaletteSourceOptions(select) {
  if (!select) return;
  const sourceOptions = getPaletteSourceOptions();
  select.replaceChildren();

  if (sourceOptions.length > 0) {
    sourceOptions.forEach((optionData) => {
      const option = document.createElement("option");
      option.value = optionData.value;
      option.textContent = optionData.label;
      select.appendChild(option);
    });
    select.value = state.activePaletteId || sourceOptions[0]?.value || "";
    return;
  }

  Object.keys(PALETTE_THEMES).forEach((themeName) => {
    const option = document.createElement("option");
    option.value = themeName;
    option.textContent = themeName;
    select.appendChild(option);
  });
  select.value = state.currentPaletteTheme;
}


function initToolbar({ render } = {}) {
  const OCEAN_ADVANCED_STYLES_ENABLED = false;
  const OCEAN_ADVANCED_PRESETS = new Set([
    "bathymetry_soft",
    "bathymetry_contours",
    "wave_hachure",
  ]);
  // Support both legacy and current button class names.
  const toolButtons = document.querySelectorAll(".tool-button, .btn-tool");
  const currentToolLabel = document.getElementById("currentTool");
  const customColor = document.getElementById("customColor");
  const exportBtn = document.getElementById("exportBtn");
  const exportFormat = document.getElementById("exportFormat");
  const textureSelect = document.getElementById("textureSelect");
  const toggleUrban = document.getElementById("toggleUrban");
  const togglePhysical = document.getElementById("togglePhysical");
  const toggleRivers = document.getElementById("toggleRivers");
  const toggleSpecialZones = document.getElementById("toggleSpecialZones");
  const urbanColor = document.getElementById("urbanColor");
  const urbanOpacity = document.getElementById("urbanOpacity");
  const urbanBlendMode = document.getElementById("urbanBlendMode");
  const urbanMinArea = document.getElementById("urbanMinArea");
  const physicalPreset = document.getElementById("physicalPreset");
  const physicalTintColor = document.getElementById("physicalTintColor");
  const physicalOpacity = document.getElementById("physicalOpacity");
  const physicalContourColor = document.getElementById("physicalContourColor");
  const physicalContourOpacity = document.getElementById("physicalContourOpacity");
  const physicalContourWidth = document.getElementById("physicalContourWidth");
  const physicalContourSpacing = document.getElementById("physicalContourSpacing");
  const physicalBlendMode = document.getElementById("physicalBlendMode");
  const riversColor = document.getElementById("riversColor");
  const riversOpacity = document.getElementById("riversOpacity");
  const riversWidth = document.getElementById("riversWidth");
  const riversOutlineColor = document.getElementById("riversOutlineColor");
  const riversOutlineWidth = document.getElementById("riversOutlineWidth");
  const riversDashStyle = document.getElementById("riversDashStyle");
  const specialZonesDisputedFill = document.getElementById("specialZonesDisputedFill");
  const specialZonesDisputedStroke = document.getElementById("specialZonesDisputedStroke");
  const specialZonesWastelandFill = document.getElementById("specialZonesWastelandFill");
  const specialZonesWastelandStroke = document.getElementById("specialZonesWastelandStroke");
  const specialZonesCustomFill = document.getElementById("specialZonesCustomFill");
  const specialZonesCustomStroke = document.getElementById("specialZonesCustomStroke");
  const specialZonesOpacity = document.getElementById("specialZonesOpacity");
  const specialZonesStrokeWidth = document.getElementById("specialZonesStrokeWidth");
  const specialZonesDashStyle = document.getElementById("specialZonesDashStyle");
  const specialZoneTypeSelect = document.getElementById("specialZoneTypeSelect");
  const specialZoneLabelInput = document.getElementById("specialZoneLabelInput");
  const specialZoneStartBtn = document.getElementById("specialZoneStartBtn");
  const specialZoneUndoBtn = document.getElementById("specialZoneUndoBtn");
  const specialZoneFinishBtn = document.getElementById("specialZoneFinishBtn");
  const specialZoneCancelBtn = document.getElementById("specialZoneCancelBtn");
  const specialZoneFeatureList = document.getElementById("specialZoneFeatureList");
  const specialZoneDeleteBtn = document.getElementById("specialZoneDeleteBtn");
  const specialZoneEditorHint = document.getElementById("specialZoneEditorHint");
  const recentContainer = document.getElementById("recentColors");
  const paletteLibraryToggle = document.getElementById("paletteLibraryToggle");
  const paletteLibraryPanel = document.getElementById("paletteLibraryPanel");
  const paletteLibrarySearch = document.getElementById("paletteLibrarySearch");
  const paletteLibrarySummary = document.getElementById("paletteLibrarySummary");
  const paletteLibraryList = document.getElementById("paletteLibraryList");
  const presetPolitical = document.getElementById("presetPolitical");
  const presetClear = document.getElementById("presetClear");
  const autoFillStyleSelect = document.getElementById("autoFillStyleSelect");
  const colorModeSelect = document.getElementById("colorModeSelect");
  const paintGranularitySelect = document.getElementById("paintGranularitySelect");
  const paintModeSelect = document.getElementById("paintModeSelect");
  const activeSovereignLabel = document.getElementById("activeSovereignLabel");
  const recalculateBordersBtn = document.getElementById("recalculateBordersBtn");
  const dynamicBorderStatus = document.getElementById("dynamicBorderStatus");
  const internalBorderColor = document.getElementById("internalBorderColor");
  const internalBorderOpacity = document.getElementById("internalBorderOpacity");
  const internalBorderWidth = document.getElementById("internalBorderWidth");
  const empireBorderColor = document.getElementById("empireBorderColor");
  const empireBorderWidth = document.getElementById("empireBorderWidth");
  const coastlineColor = document.getElementById("coastlineColor");
  const coastlineWidth = document.getElementById("coastlineWidth");
  const parentBorderColor = document.getElementById("parentBorderColor");
  const parentBorderOpacity = document.getElementById("parentBorderOpacity");
  const parentBorderWidth = document.getElementById("parentBorderWidth");
  const parentBorderCountryList = document.getElementById("parentBorderCountryList");
  const parentBorderEnableAll = document.getElementById("parentBorderEnableAll");
  const parentBorderDisableAll = document.getElementById("parentBorderDisableAll");
  const parentBorderEmpty = document.getElementById("parentBorderEmpty");
  const oceanFillColor = document.getElementById("oceanFillColor");
  const oceanStyleSelect = document.getElementById("oceanStyleSelect");
  const oceanTextureOpacity = document.getElementById("oceanTextureOpacity");
  const oceanTextureScale = document.getElementById("oceanTextureScale");
  const oceanContourStrength = document.getElementById("oceanContourStrength");
  const toggleLang = document.getElementById("btnToggleLang");
  const themeSelect = document.getElementById("themeSelect");
  const referenceImageInput = document.getElementById("referenceImageInput");
  const referenceOpacity = document.getElementById("referenceOpacity");
  const referenceScale = document.getElementById("referenceScale");
  const referenceOffsetX = document.getElementById("referenceOffsetX");
  const referenceOffsetY = document.getElementById("referenceOffsetY");

  const internalBorderOpacityValue = document.getElementById("internalBorderOpacityValue");
  const internalBorderWidthValue = document.getElementById("internalBorderWidthValue");
  const empireBorderWidthValue = document.getElementById("empireBorderWidthValue");
  const coastlineWidthValue = document.getElementById("coastlineWidthValue");
  const parentBorderOpacityValue = document.getElementById("parentBorderOpacityValue");
  const parentBorderWidthValue = document.getElementById("parentBorderWidthValue");
  const urbanOpacityValue = document.getElementById("urbanOpacityValue");
  const urbanMinAreaValue = document.getElementById("urbanMinAreaValue");
  const physicalOpacityValue = document.getElementById("physicalOpacityValue");
  const physicalContourOpacityValue = document.getElementById("physicalContourOpacityValue");
  const physicalContourWidthValue = document.getElementById("physicalContourWidthValue");
  const physicalContourSpacingValue = document.getElementById("physicalContourSpacingValue");
  const riversOpacityValue = document.getElementById("riversOpacityValue");
  const riversWidthValue = document.getElementById("riversWidthValue");
  const riversOutlineWidthValue = document.getElementById("riversOutlineWidthValue");
  const specialZonesOpacityValue = document.getElementById("specialZonesOpacityValue");
  const specialZonesStrokeWidthValue = document.getElementById("specialZonesStrokeWidthValue");
  const oceanTextureOpacityValue = document.getElementById("oceanTextureOpacityValue");
  const oceanTextureScaleValue = document.getElementById("oceanTextureScaleValue");
  const oceanContourStrengthValue = document.getElementById("oceanContourStrengthValue");
  const referenceOpacityValue = document.getElementById("referenceOpacityValue");
  const referenceScaleValue = document.getElementById("referenceScaleValue");
  const referenceOffsetXValue = document.getElementById("referenceOffsetXValue");
  const referenceOffsetYValue = document.getElementById("referenceOffsetYValue");

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const refreshActiveSovereignLabel = () => {
    if (!activeSovereignLabel) return;
    const code = String(state.activeSovereignCode || "").trim().toUpperCase();
    activeSovereignLabel.textContent = code || t("None selected", "ui");
  };
  state.updateActiveSovereignUIFn = refreshActiveSovereignLabel;
  const refreshDynamicBorderStatus = () => {
    if (dynamicBorderStatus) {
      if (!state.runtimePoliticalTopology?.objects?.political) {
        dynamicBorderStatus.textContent = t("Dynamic borders disabled", "ui");
      } else if (state.dynamicBordersDirty) {
        dynamicBorderStatus.textContent = t("Borders need recalculation", "ui");
      } else {
        dynamicBorderStatus.textContent = t("Borders up to date", "ui");
      }
    }
    if (recalculateBordersBtn) {
      recalculateBordersBtn.disabled = !state.dynamicBordersDirty;
    }
  };
  state.updateDynamicBorderStatusUIFn = refreshDynamicBorderStatus;
  state.updatePaintModeUIFn = () => {
    if (paintModeSelect) {
      paintModeSelect.value = state.paintMode || "visual";
    }
    if (paintGranularitySelect) {
      paintGranularitySelect.value = state.interactionGranularity || "subdivision";
    }
    refreshActiveSovereignLabel();
    refreshDynamicBorderStatus();
  };
  const normalizeOceanPreset = (value) => {
    const candidate = String(value || "flat").trim().toLowerCase();
    if (
      candidate === "flat" ||
      candidate === "bathymetry_soft" ||
      candidate === "bathymetry_contours" ||
      candidate === "wave_hachure"
    ) {
      return candidate;
    }
    return "flat";
  };
  const normalizeOceanFillColor = (value) => {
    const candidate = String(value || "").trim();
    if (/^#(?:[0-9a-f]{6})$/i.test(candidate)) return candidate;
    if (/^#(?:[0-9a-f]{3})$/i.test(candidate)) {
      return `#${candidate[1]}${candidate[1]}${candidate[2]}${candidate[2]}${candidate[3]}${candidate[3]}`;
    }
    return "#aadaff";
  };
  if (!state.styleConfig.ocean || typeof state.styleConfig.ocean !== "object") {
    state.styleConfig.ocean = {};
  }
  state.styleConfig.ocean.preset = normalizeOceanPreset(state.styleConfig.ocean.preset || "flat");
  if (!OCEAN_ADVANCED_STYLES_ENABLED && OCEAN_ADVANCED_PRESETS.has(state.styleConfig.ocean.preset)) {
    state.styleConfig.ocean.preset = "flat";
  }
  state.styleConfig.ocean.fillColor = normalizeOceanFillColor(state.styleConfig.ocean.fillColor);
  state.styleConfig.ocean.opacity = clamp(
    Number.isFinite(Number(state.styleConfig.ocean.opacity)) ? Number(state.styleConfig.ocean.opacity) : 0.72,
    0,
    1
  );
  state.styleConfig.ocean.scale = clamp(
    Number.isFinite(Number(state.styleConfig.ocean.scale)) ? Number(state.styleConfig.ocean.scale) : 1,
    0.6,
    2.4
  );
  state.styleConfig.ocean.contourStrength = clamp(
    Number.isFinite(Number(state.styleConfig.ocean.contourStrength))
      ? Number(state.styleConfig.ocean.contourStrength)
      : 0.75,
    0,
    1
  );
  if (!state.styleConfig.parentBorders || typeof state.styleConfig.parentBorders !== "object") {
    state.styleConfig.parentBorders = {};
  }
  state.styleConfig.parentBorders.color = String(
    state.styleConfig.parentBorders.color || "#4b5563"
  );
  state.styleConfig.parentBorders.opacity = clamp(
    Number.isFinite(Number(state.styleConfig.parentBorders.opacity))
      ? Number(state.styleConfig.parentBorders.opacity)
      : 0.85,
    0,
    1
  );
  state.styleConfig.parentBorders.width = clamp(
    Number.isFinite(Number(state.styleConfig.parentBorders.width))
      ? Number(state.styleConfig.parentBorders.width)
      : 1.1,
    0.2,
    4
  );
  if (!state.parentBorderEnabledByCountry || typeof state.parentBorderEnabledByCountry !== "object") {
    state.parentBorderEnabledByCountry = {};
  }
  if (!state.styleConfig.urban || typeof state.styleConfig.urban !== "object") {
    state.styleConfig.urban = {};
  }
  state.styleConfig.urban.color = normalizeOceanFillColor(state.styleConfig.urban.color || "#4b5563");
  state.styleConfig.urban.opacity = clamp(
    Number.isFinite(Number(state.styleConfig.urban.opacity)) ? Number(state.styleConfig.urban.opacity) : 0.22,
    0,
    1
  );
  state.styleConfig.urban.blendMode = String(state.styleConfig.urban.blendMode || "multiply");
  state.styleConfig.urban.minAreaPx = clamp(
    Number.isFinite(Number(state.styleConfig.urban.minAreaPx)) ? Number(state.styleConfig.urban.minAreaPx) : 8,
    0,
    80
  );

  if (!state.styleConfig.physical || typeof state.styleConfig.physical !== "object") {
    state.styleConfig.physical = {};
  }
  state.styleConfig.physical.preset = String(state.styleConfig.physical.preset || "atlas_soft");
  state.styleConfig.physical.tintColor = normalizeOceanFillColor(
    state.styleConfig.physical.tintColor || "#8f6b4e"
  );
  state.styleConfig.physical.opacity = clamp(
    Number.isFinite(Number(state.styleConfig.physical.opacity)) ? Number(state.styleConfig.physical.opacity) : 0.24,
    0,
    1
  );
  state.styleConfig.physical.contourColor = normalizeOceanFillColor(
    state.styleConfig.physical.contourColor || "#6f4e37"
  );
  state.styleConfig.physical.contourOpacity = clamp(
    Number.isFinite(Number(state.styleConfig.physical.contourOpacity))
      ? Number(state.styleConfig.physical.contourOpacity)
      : 0.30,
    0,
    1
  );
  state.styleConfig.physical.contourWidth = clamp(
    Number.isFinite(Number(state.styleConfig.physical.contourWidth))
      ? Number(state.styleConfig.physical.contourWidth)
      : 0.7,
    0.2,
    2.5
  );
  state.styleConfig.physical.contourSpacing = clamp(
    Number.isFinite(Number(state.styleConfig.physical.contourSpacing))
      ? Number(state.styleConfig.physical.contourSpacing)
      : 18,
    8,
    36
  );
  state.styleConfig.physical.blendMode = String(state.styleConfig.physical.blendMode || "multiply");

  if (!state.styleConfig.rivers || typeof state.styleConfig.rivers !== "object") {
    state.styleConfig.rivers = {};
  }
  state.styleConfig.rivers.color = normalizeOceanFillColor(state.styleConfig.rivers.color || "#3b82f6");
  state.styleConfig.rivers.opacity = clamp(
    Number.isFinite(Number(state.styleConfig.rivers.opacity)) ? Number(state.styleConfig.rivers.opacity) : 0.88,
    0,
    1
  );
  state.styleConfig.rivers.width = clamp(
    Number.isFinite(Number(state.styleConfig.rivers.width)) ? Number(state.styleConfig.rivers.width) : 1.1,
    0.2,
    4
  );
  state.styleConfig.rivers.outlineColor = normalizeOceanFillColor(
    state.styleConfig.rivers.outlineColor || "#e2efff"
  );
  state.styleConfig.rivers.outlineWidth = clamp(
    Number.isFinite(Number(state.styleConfig.rivers.outlineWidth))
      ? Number(state.styleConfig.rivers.outlineWidth)
      : 0.9,
    0,
    3
  );
  state.styleConfig.rivers.dashStyle = String(state.styleConfig.rivers.dashStyle || "solid");

  if (!state.styleConfig.specialZones || typeof state.styleConfig.specialZones !== "object") {
    state.styleConfig.specialZones = {};
  }
  state.styleConfig.specialZones.disputedFill = normalizeOceanFillColor(
    state.styleConfig.specialZones.disputedFill || "#f97316"
  );
  state.styleConfig.specialZones.disputedStroke = normalizeOceanFillColor(
    state.styleConfig.specialZones.disputedStroke || "#ea580c"
  );
  state.styleConfig.specialZones.wastelandFill = normalizeOceanFillColor(
    state.styleConfig.specialZones.wastelandFill || "#dc2626"
  );
  state.styleConfig.specialZones.wastelandStroke = normalizeOceanFillColor(
    state.styleConfig.specialZones.wastelandStroke || "#b91c1c"
  );
  state.styleConfig.specialZones.customFill = normalizeOceanFillColor(
    state.styleConfig.specialZones.customFill || "#8b5cf6"
  );
  state.styleConfig.specialZones.customStroke = normalizeOceanFillColor(
    state.styleConfig.specialZones.customStroke || "#6d28d9"
  );
  state.styleConfig.specialZones.opacity = clamp(
    Number.isFinite(Number(state.styleConfig.specialZones.opacity))
      ? Number(state.styleConfig.specialZones.opacity)
      : 0.32,
    0,
    1
  );
  state.styleConfig.specialZones.strokeWidth = clamp(
    Number.isFinite(Number(state.styleConfig.specialZones.strokeWidth))
      ? Number(state.styleConfig.specialZones.strokeWidth)
      : 1.3,
    0.4,
    4
  );
  state.styleConfig.specialZones.dashStyle = String(state.styleConfig.specialZones.dashStyle || "dashed");

  if (!state.manualSpecialZones || state.manualSpecialZones.type !== "FeatureCollection") {
    state.manualSpecialZones = { type: "FeatureCollection", features: [] };
  }
  if (!Array.isArray(state.manualSpecialZones.features)) {
    state.manualSpecialZones.features = [];
  }
  if (!state.specialZoneEditor || typeof state.specialZoneEditor !== "object") {
    state.specialZoneEditor = {};
  }
  state.specialZoneEditor.zoneType = String(state.specialZoneEditor.zoneType || "custom");
  state.specialZoneEditor.label = String(state.specialZoneEditor.label || "");

  if (oceanFillColor) {
    oceanFillColor.value = state.styleConfig.ocean.fillColor;
    oceanFillColor.addEventListener("input", (event) => {
      state.styleConfig.ocean.fillColor = normalizeOceanFillColor(event.target.value);
      if (render) render();
    });
  }

  function renderRecentColors() {
    if (!recentContainer) return;
    recentContainer.replaceChildren();
    state.recentColors.forEach((color) => {
      const normalized = normalizeHexColor(color);
      if (!normalized) return;
      const btn = document.createElement("button");
      btn.className = "color-swatch";
      btn.dataset.color = normalized;
      btn.style.backgroundColor = normalized;
      btn.addEventListener("click", () => {
        state.selectedColor = normalized;
        updateSwatchUI();
      });
      recentContainer.appendChild(btn);
    });
  }

  function syncPaletteSourceControls() {
    const activeValue = String(state.activePaletteId || "");
    [themeSelect, autoFillStyleSelect].forEach((select) => {
      if (!select) return;
      if (select.value !== activeValue) {
        select.value = activeValue;
      }
    });
  }
  state.updatePaletteSourceUIFn = syncPaletteSourceControls;
  state.renderPaletteFn = renderPalette;

  async function handlePaletteSourceChange(nextPaletteId) {
    const targetId = String(nextPaletteId || "").trim();
    if (!targetId || targetId === state.activePaletteId) {
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

  function applyAutoFillOceanColor() {
    const oceanMeta = state.activePaletteOceanMeta || state.activePalettePack?.ocean || null;
    const nextFillColor = normalizeOceanFillColor(
      oceanMeta?.apply_on_autofill ? oceanMeta?.fill_color : "#aadaff"
    );
    state.styleConfig.ocean.fillColor = nextFillColor;
    if (oceanFillColor) {
      oceanFillColor.value = nextFillColor;
    }
  }
  state.updateRecentUI = () => {
    renderRecentColors();
    renderPalette(state.currentPaletteTheme);
    renderPaletteLibrary();
  };

  function renderPaletteLibrary() {
    if (!paletteLibraryList) return;

    const searchTerm = String(state.paletteLibrarySearch || "").trim().toLowerCase();
    const sourceLabel = state.activePaletteMeta?.display_name || state.currentPaletteTheme || "Palette";
    const summarizeResults = (count) => (
      state.currentLanguage === "zh"
        ? `${count} 个颜色，来源 ${sourceLabel}`
        : `${count} colors from ${sourceLabel}`
    );
    let entries = [];
    if (state.activePalettePack?.entries) {
      entries = buildPaletteLibraryEntries();
    } else {
      entries = (PALETTE_THEMES[state.currentPaletteTheme] || []).map((color, index) => ({
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

    paletteLibraryList.replaceChildren();
    if (paletteLibrarySummary) {
      paletteLibrarySummary.textContent = summarizeResults(filtered.length);
    }

    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "palette-library-empty";
      empty.textContent = t("No palette colors match the current search.", "ui");
      paletteLibraryList.appendChild(empty);
      return;
    }

    filtered.forEach((entry) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "palette-library-row";
      row.dataset.color = entry.color;
      row.dataset.tag = entry.sourceTag;
      row.dataset.iso2 = entry.mappedIso2 || "";
      if (entry.color === state.selectedColor) {
        row.classList.add("is-selected");
      }
      row.addEventListener("click", () => {
        state.selectedColor = entry.color;
        updateSwatchUI();
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
      const statusText = entry.mappedIso2
        ? `${t("Mapped to", "ui")} ${entry.mappedIso2}`
        : `${t("Unmapped", "ui")}: ${formatPaletteReason(entry)}`;
      const subtitleParts = [entry.sourceTag];
      if (entry.countryFileLabel && entry.countryFileLabel !== entry.localizedName) {
        subtitleParts.push(entry.countryFileLabel);
      }
      subtitleParts.push(statusText);
      subtitle.textContent = subtitleParts.filter(Boolean).join(" · ");

      meta.appendChild(title);
      meta.appendChild(subtitle);
      row.appendChild(swatch);
      row.appendChild(meta);
      paletteLibraryList.appendChild(row);
    });
  }
  state.updatePaletteLibraryUIFn = renderPaletteLibrary;

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

  function normalizeParentBorderEnabledMap() {
    const supported = Array.isArray(state.parentBorderSupportedCountries)
      ? state.parentBorderSupportedCountries
      : [];
    const prev = state.parentBorderEnabledByCountry && typeof state.parentBorderEnabledByCountry === "object"
      ? state.parentBorderEnabledByCountry
      : {};
    const next = {};
    supported.forEach((countryCode) => {
      next[countryCode] = !!prev[countryCode];
    });
    state.parentBorderEnabledByCountry = next;
  }

  function renderParentBorderCountryList() {
    if (!parentBorderCountryList) return;
    normalizeParentBorderEnabledMap();
    const supported = Array.isArray(state.parentBorderSupportedCountries)
      ? [...state.parentBorderSupportedCountries]
      : [];

    parentBorderCountryList.replaceChildren();
    if (!supported.length) {
      if (parentBorderEmpty) {
        parentBorderEmpty.classList.remove("hidden");
      }
      return;
    }
    if (parentBorderEmpty) {
      parentBorderEmpty.classList.add("hidden");
    }

    const entries = supported
      .map((code) => {
        const rawName = state.countryNames?.[code] || code;
        return {
          code,
          displayName: t(rawName, "geo"),
        };
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    entries.forEach(({ code, displayName }) => {
      const label = document.createElement("label");
      label.className = "toggle-label parent-border-country-item";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "checkbox-input";
      checkbox.checked = !!state.parentBorderEnabledByCountry?.[code];
      checkbox.addEventListener("change", (event) => {
        state.parentBorderEnabledByCountry[code] = !!event.target.checked;
        if (render) render();
      });

      const text = document.createElement("span");
      text.textContent = `${displayName} (${code})`;

      label.appendChild(checkbox);
      label.appendChild(text);
      parentBorderCountryList.appendChild(label);
    });
  }
  state.updateParentBorderCountryListFn = renderParentBorderCountryList;

  function renderSpecialZoneEditorUI() {
    if (toggleUrban) toggleUrban.checked = !!state.showUrban;
    if (togglePhysical) togglePhysical.checked = !!state.showPhysical;
    if (toggleRivers) toggleRivers.checked = !!state.showRivers;
    if (toggleSpecialZones) toggleSpecialZones.checked = !!state.showSpecialZones;

    if (urbanColor) urbanColor.value = state.styleConfig.urban.color;
    if (urbanOpacity) urbanOpacity.value = String(Math.round(state.styleConfig.urban.opacity * 100));
    if (urbanOpacityValue) urbanOpacityValue.textContent = `${Math.round(state.styleConfig.urban.opacity * 100)}%`;
    if (urbanBlendMode) urbanBlendMode.value = state.styleConfig.urban.blendMode;
    if (urbanMinArea) urbanMinArea.value = String(Math.round(state.styleConfig.urban.minAreaPx));
    if (urbanMinAreaValue) urbanMinAreaValue.textContent = `${Math.round(state.styleConfig.urban.minAreaPx)}`;

    if (physicalPreset) physicalPreset.value = state.styleConfig.physical.preset;
    if (physicalTintColor) physicalTintColor.value = state.styleConfig.physical.tintColor;
    if (physicalOpacity) physicalOpacity.value = String(Math.round(state.styleConfig.physical.opacity * 100));
    if (physicalOpacityValue) {
      physicalOpacityValue.textContent = `${Math.round(state.styleConfig.physical.opacity * 100)}%`;
    }
    if (physicalContourColor) physicalContourColor.value = state.styleConfig.physical.contourColor;
    if (physicalContourOpacity) {
      physicalContourOpacity.value = String(Math.round(state.styleConfig.physical.contourOpacity * 100));
    }
    if (physicalContourOpacityValue) {
      physicalContourOpacityValue.textContent = `${Math.round(state.styleConfig.physical.contourOpacity * 100)}%`;
    }
    if (physicalContourWidth) {
      physicalContourWidth.value = String(Number(state.styleConfig.physical.contourWidth).toFixed(2));
    }
    if (physicalContourWidthValue) {
      physicalContourWidthValue.textContent = Number(state.styleConfig.physical.contourWidth).toFixed(2);
    }
    if (physicalContourSpacing) {
      physicalContourSpacing.value = String(Math.round(state.styleConfig.physical.contourSpacing));
    }
    if (physicalContourSpacingValue) {
      physicalContourSpacingValue.textContent = `${Math.round(state.styleConfig.physical.contourSpacing)}`;
    }
    if (physicalBlendMode) physicalBlendMode.value = state.styleConfig.physical.blendMode;

    if (riversColor) riversColor.value = state.styleConfig.rivers.color;
    if (riversOpacity) riversOpacity.value = String(Math.round(state.styleConfig.rivers.opacity * 100));
    if (riversOpacityValue) riversOpacityValue.textContent = `${Math.round(state.styleConfig.rivers.opacity * 100)}%`;
    if (riversWidth) riversWidth.value = String(Number(state.styleConfig.rivers.width).toFixed(2));
    if (riversWidthValue) riversWidthValue.textContent = Number(state.styleConfig.rivers.width).toFixed(2);
    if (riversOutlineColor) riversOutlineColor.value = state.styleConfig.rivers.outlineColor;
    if (riversOutlineWidth) {
      riversOutlineWidth.value = String(Number(state.styleConfig.rivers.outlineWidth).toFixed(2));
    }
    if (riversOutlineWidthValue) {
      riversOutlineWidthValue.textContent = Number(state.styleConfig.rivers.outlineWidth).toFixed(2);
    }
    if (riversDashStyle) riversDashStyle.value = state.styleConfig.rivers.dashStyle;

    if (specialZonesDisputedFill) specialZonesDisputedFill.value = state.styleConfig.specialZones.disputedFill;
    if (specialZonesDisputedStroke) specialZonesDisputedStroke.value = state.styleConfig.specialZones.disputedStroke;
    if (specialZonesWastelandFill) specialZonesWastelandFill.value = state.styleConfig.specialZones.wastelandFill;
    if (specialZonesWastelandStroke) {
      specialZonesWastelandStroke.value = state.styleConfig.specialZones.wastelandStroke;
    }
    if (specialZonesCustomFill) specialZonesCustomFill.value = state.styleConfig.specialZones.customFill;
    if (specialZonesCustomStroke) specialZonesCustomStroke.value = state.styleConfig.specialZones.customStroke;
    if (specialZonesOpacity) specialZonesOpacity.value = String(Math.round(state.styleConfig.specialZones.opacity * 100));
    if (specialZonesOpacityValue) {
      specialZonesOpacityValue.textContent = `${Math.round(state.styleConfig.specialZones.opacity * 100)}%`;
    }
    if (specialZonesStrokeWidth) {
      specialZonesStrokeWidth.value = String(Number(state.styleConfig.specialZones.strokeWidth).toFixed(2));
    }
    if (specialZonesStrokeWidthValue) {
      specialZonesStrokeWidthValue.textContent = Number(state.styleConfig.specialZones.strokeWidth).toFixed(2);
    }
    if (specialZonesDashStyle) specialZonesDashStyle.value = state.styleConfig.specialZones.dashStyle;

    const manualFeatures = Array.isArray(state.manualSpecialZones?.features)
      ? state.manualSpecialZones.features
      : [];
    if (specialZoneFeatureList) {
      const selectedId = state.specialZoneEditor?.selectedId || "";
      specialZoneFeatureList.replaceChildren();
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = t("No manual zones", "ui");
      specialZoneFeatureList.appendChild(placeholder);

      manualFeatures.forEach((feature, index) => {
        const id = String(feature?.properties?.id || `manual_sz_${index + 1}`);
        const label = String(feature?.properties?.label || feature?.properties?.name || id);
        const option = document.createElement("option");
        option.value = id;
        option.textContent = `${label} (${id})`;
        specialZoneFeatureList.appendChild(option);
      });
      specialZoneFeatureList.value = selectedId && manualFeatures.some((f) => String(f?.properties?.id || "") === selectedId)
        ? selectedId
        : "";
    }

    if (specialZoneTypeSelect) {
      specialZoneTypeSelect.value = String(state.specialZoneEditor?.zoneType || "custom");
    }
    if (specialZoneLabelInput) {
      specialZoneLabelInput.value = String(state.specialZoneEditor?.label || "");
    }

    const isDrawing = !!state.specialZoneEditor?.active;
    if (specialZoneStartBtn) specialZoneStartBtn.disabled = isDrawing;
    if (specialZoneUndoBtn) specialZoneUndoBtn.disabled = !isDrawing;
    if (specialZoneFinishBtn) specialZoneFinishBtn.disabled = !isDrawing;
    if (specialZoneCancelBtn) specialZoneCancelBtn.disabled = !isDrawing;
    if (specialZoneDeleteBtn) {
      specialZoneDeleteBtn.disabled = !state.specialZoneEditor?.selectedId;
    }
    if (specialZoneEditorHint) {
      specialZoneEditorHint.textContent = isDrawing
        ? t("Drawing in progress: click map to add vertices, double-click to finish.", "ui")
        : t("Click map to add vertices, double-click to finish.", "ui");
    }
  }
  state.updateSpecialZoneEditorUIFn = renderSpecialZoneEditorUI;

  function updateSwatchUI() {
    let matched = false;
    const swatches = document.querySelectorAll(".color-swatch");
    swatches.forEach((swatch) => {
      if (swatch.dataset.color === state.selectedColor) {
        swatch.classList.add("ring-2", "ring-slate-900");
        matched = true;
      } else {
        swatch.classList.remove("ring-2", "ring-slate-900");
      }
    });
    const libraryRows = document.querySelectorAll(".palette-library-row");
    libraryRows.forEach((row) => {
      row.classList.toggle("is-selected", row.dataset.color === state.selectedColor);
    });
    if (document.getElementById("customColor")) {
      customColor.value = state.selectedColor;
      customColor.classList.toggle("ring-2", !matched);
      customColor.classList.toggle("ring-slate-900", !matched);
    }
  }
  state.updateSwatchUIFn = updateSwatchUI;

  function updateToolUI() {
    if (state.isEditingPreset) {
      currentToolLabel.textContent = t("Editing Preset", "ui");
    } else if (state.currentTool === "eraser") {
      currentToolLabel.textContent = t("Eraser", "ui");
    } else if (state.currentTool === "eyedropper") {
      currentToolLabel.textContent = t("Eyedropper", "ui");
    } else {
      currentToolLabel.textContent = t("Fill", "ui");
    }
    toolButtons.forEach((button) => {
      const isActive = button.dataset.tool === state.currentTool;
      button.disabled = state.isEditingPreset;
      button.classList.toggle("opacity-50", state.isEditingPreset);
      button.classList.toggle("cursor-not-allowed", state.isEditingPreset);
      button.classList.toggle("bg-slate-900", isActive);
      button.classList.toggle("text-white", isActive);
      button.classList.toggle("bg-white", !isActive);
      button.classList.toggle("text-slate-700", !isActive);
    });
  }
  state.updateToolUIFn = updateToolUI;

  if (customColor) {
    customColor.addEventListener("input", (event) => {
      state.selectedColor = event.target.value;
      updateSwatchUI();
    });
  }

  toolButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.currentTool = button.dataset.tool || "fill";
      updateToolUI();
    });
  });

  if (toggleLang && !toggleLang.dataset.bound) {
    toggleLang.addEventListener("click", toggleLanguage);
    toggleLang.dataset.bound = "true";
  }

  if (exportBtn && exportFormat) {
    exportBtn.addEventListener("click", () => {
      const format = exportFormat.value === "jpg" ? "image/jpeg" : "image/png";
      const extension = exportFormat.value === "jpg" ? "jpg" : "png";
      const exportCanvas = document.createElement("canvas");
      exportCanvas.width = state.colorCanvas?.width || 0;
      exportCanvas.height = state.colorCanvas?.height || 0;
      const exportCtx = exportCanvas.getContext("2d");
      if (state.colorCanvas) exportCtx.drawImage(state.colorCanvas, 0, 0);
      if (state.lineCanvas) exportCtx.drawImage(state.lineCanvas, 0, 0);
      const dataUrl = exportCanvas.toDataURL(format, 0.92);
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `map_snapshot.${extension}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    });
  }

  if (textureSelect) {
    const textureOverlay = document.getElementById("textureOverlay");
    const applyTexture = (value) => {
      if (textureOverlay) {
        textureOverlay.className = `texture-overlay decorative-layer absolute inset-0 texture-${value}`;
      }
    };
    applyTexture(textureSelect.value);
    textureSelect.addEventListener("change", (event) => {
      applyTexture(event.target.value);
    });
  }

  if (toggleUrban) {
    toggleUrban.checked = !!state.showUrban;
    toggleUrban.addEventListener("change", (event) => {
      state.showUrban = event.target.checked;
      if (render) render();
    });
  }

  if (togglePhysical) {
    togglePhysical.checked = !!state.showPhysical;
    togglePhysical.addEventListener("change", (event) => {
      state.showPhysical = event.target.checked;
      if (render) render();
    });
  }

  if (toggleRivers) {
    toggleRivers.checked = !!state.showRivers;
    toggleRivers.addEventListener("change", (event) => {
      state.showRivers = event.target.checked;
      if (render) render();
    });
  }

  if (toggleSpecialZones) {
    toggleSpecialZones.checked = state.showSpecialZones;
    toggleSpecialZones.addEventListener("change", (event) => {
      state.showSpecialZones = event.target.checked;
      if (render) render();
    });
  }
  if (urbanColor) {
    urbanColor.addEventListener("input", (event) => {
      state.styleConfig.urban.color = normalizeOceanFillColor(event.target.value);
      if (render) render();
    });
  }
  if (urbanOpacity) {
    urbanOpacity.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      state.styleConfig.urban.opacity = clamp(Number.isFinite(value) ? value / 100 : 0.22, 0, 1);
      if (urbanOpacityValue) urbanOpacityValue.textContent = `${Math.round(state.styleConfig.urban.opacity * 100)}%`;
      if (render) render();
    });
  }
  if (urbanBlendMode) {
    urbanBlendMode.addEventListener("change", (event) => {
      state.styleConfig.urban.blendMode = String(event.target.value || "multiply");
      if (render) render();
    });
  }
  if (urbanMinArea) {
    urbanMinArea.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      state.styleConfig.urban.minAreaPx = clamp(Number.isFinite(value) ? value : 8, 0, 80);
      if (urbanMinAreaValue) urbanMinAreaValue.textContent = `${Math.round(state.styleConfig.urban.minAreaPx)}`;
      if (render) render();
    });
  }

  if (physicalPreset) {
    physicalPreset.addEventListener("change", (event) => {
      state.styleConfig.physical.preset = String(event.target.value || "atlas_soft");
      if (render) render();
    });
  }
  if (physicalTintColor) {
    physicalTintColor.addEventListener("input", (event) => {
      state.styleConfig.physical.tintColor = normalizeOceanFillColor(event.target.value);
      if (render) render();
    });
  }
  if (physicalOpacity) {
    physicalOpacity.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      state.styleConfig.physical.opacity = clamp(Number.isFinite(value) ? value / 100 : 0.24, 0, 1);
      if (physicalOpacityValue) {
        physicalOpacityValue.textContent = `${Math.round(state.styleConfig.physical.opacity * 100)}%`;
      }
      if (render) render();
    });
  }
  if (physicalContourColor) {
    physicalContourColor.addEventListener("input", (event) => {
      state.styleConfig.physical.contourColor = normalizeOceanFillColor(event.target.value);
      if (render) render();
    });
  }
  if (physicalContourOpacity) {
    physicalContourOpacity.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      state.styleConfig.physical.contourOpacity = clamp(Number.isFinite(value) ? value / 100 : 0.30, 0, 1);
      if (physicalContourOpacityValue) {
        physicalContourOpacityValue.textContent = `${Math.round(state.styleConfig.physical.contourOpacity * 100)}%`;
      }
      if (render) render();
    });
  }
  if (physicalContourWidth) {
    physicalContourWidth.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      state.styleConfig.physical.contourWidth = clamp(Number.isFinite(value) ? value : 0.7, 0.2, 2.5);
      if (physicalContourWidthValue) {
        physicalContourWidthValue.textContent = Number(state.styleConfig.physical.contourWidth).toFixed(2);
      }
      if (render) render();
    });
  }
  if (physicalContourSpacing) {
    physicalContourSpacing.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      state.styleConfig.physical.contourSpacing = clamp(Number.isFinite(value) ? value : 18, 8, 36);
      if (physicalContourSpacingValue) {
        physicalContourSpacingValue.textContent = `${Math.round(state.styleConfig.physical.contourSpacing)}`;
      }
      if (render) render();
    });
  }
  if (physicalBlendMode) {
    physicalBlendMode.addEventListener("change", (event) => {
      state.styleConfig.physical.blendMode = String(event.target.value || "multiply");
      if (render) render();
    });
  }

  if (riversColor) {
    riversColor.addEventListener("input", (event) => {
      state.styleConfig.rivers.color = normalizeOceanFillColor(event.target.value);
      if (render) render();
    });
  }
  if (riversOpacity) {
    riversOpacity.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      state.styleConfig.rivers.opacity = clamp(Number.isFinite(value) ? value / 100 : 0.88, 0, 1);
      if (riversOpacityValue) {
        riversOpacityValue.textContent = `${Math.round(state.styleConfig.rivers.opacity * 100)}%`;
      }
      if (render) render();
    });
  }
  if (riversWidth) {
    riversWidth.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      state.styleConfig.rivers.width = clamp(Number.isFinite(value) ? value : 1.1, 0.2, 4);
      if (riversWidthValue) {
        riversWidthValue.textContent = Number(state.styleConfig.rivers.width).toFixed(2);
      }
      if (render) render();
    });
  }
  if (riversOutlineColor) {
    riversOutlineColor.addEventListener("input", (event) => {
      state.styleConfig.rivers.outlineColor = normalizeOceanFillColor(event.target.value);
      if (render) render();
    });
  }
  if (riversOutlineWidth) {
    riversOutlineWidth.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      state.styleConfig.rivers.outlineWidth = clamp(Number.isFinite(value) ? value : 0.9, 0, 3);
      if (riversOutlineWidthValue) {
        riversOutlineWidthValue.textContent = Number(state.styleConfig.rivers.outlineWidth).toFixed(2);
      }
      if (render) render();
    });
  }
  if (riversDashStyle) {
    riversDashStyle.addEventListener("change", (event) => {
      state.styleConfig.rivers.dashStyle = String(event.target.value || "solid");
      if (render) render();
    });
  }

  const onSpecialZonesStyleChange = () => {
    if (render) render();
  };
  if (specialZonesDisputedFill) {
    specialZonesDisputedFill.addEventListener("input", (event) => {
      state.styleConfig.specialZones.disputedFill = normalizeOceanFillColor(event.target.value);
      onSpecialZonesStyleChange();
    });
  }
  if (specialZonesDisputedStroke) {
    specialZonesDisputedStroke.addEventListener("input", (event) => {
      state.styleConfig.specialZones.disputedStroke = normalizeOceanFillColor(event.target.value);
      onSpecialZonesStyleChange();
    });
  }
  if (specialZonesWastelandFill) {
    specialZonesWastelandFill.addEventListener("input", (event) => {
      state.styleConfig.specialZones.wastelandFill = normalizeOceanFillColor(event.target.value);
      onSpecialZonesStyleChange();
    });
  }
  if (specialZonesWastelandStroke) {
    specialZonesWastelandStroke.addEventListener("input", (event) => {
      state.styleConfig.specialZones.wastelandStroke = normalizeOceanFillColor(event.target.value);
      onSpecialZonesStyleChange();
    });
  }
  if (specialZonesCustomFill) {
    specialZonesCustomFill.addEventListener("input", (event) => {
      state.styleConfig.specialZones.customFill = normalizeOceanFillColor(event.target.value);
      onSpecialZonesStyleChange();
    });
  }
  if (specialZonesCustomStroke) {
    specialZonesCustomStroke.addEventListener("input", (event) => {
      state.styleConfig.specialZones.customStroke = normalizeOceanFillColor(event.target.value);
      onSpecialZonesStyleChange();
    });
  }
  if (specialZonesOpacity) {
    specialZonesOpacity.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      state.styleConfig.specialZones.opacity = clamp(Number.isFinite(value) ? value / 100 : 0.32, 0, 1);
      if (specialZonesOpacityValue) {
        specialZonesOpacityValue.textContent = `${Math.round(state.styleConfig.specialZones.opacity * 100)}%`;
      }
      onSpecialZonesStyleChange();
    });
  }
  if (specialZonesStrokeWidth) {
    specialZonesStrokeWidth.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      state.styleConfig.specialZones.strokeWidth = clamp(Number.isFinite(value) ? value : 1.3, 0.4, 4);
      if (specialZonesStrokeWidthValue) {
        specialZonesStrokeWidthValue.textContent = Number(state.styleConfig.specialZones.strokeWidth).toFixed(2);
      }
      onSpecialZonesStyleChange();
    });
  }
  if (specialZonesDashStyle) {
    specialZonesDashStyle.addEventListener("change", (event) => {
      state.styleConfig.specialZones.dashStyle = String(event.target.value || "dashed");
      onSpecialZonesStyleChange();
    });
  }

  if (specialZoneTypeSelect) {
    specialZoneTypeSelect.addEventListener("change", (event) => {
      state.specialZoneEditor.zoneType = String(event.target.value || "custom");
      if (typeof state.updateSpecialZoneEditorUIFn === "function") {
        state.updateSpecialZoneEditorUIFn();
      }
    });
  }
  if (specialZoneLabelInput) {
    specialZoneLabelInput.addEventListener("input", (event) => {
      state.specialZoneEditor.label = String(event.target.value || "");
    });
  }
  if (specialZoneStartBtn) {
    specialZoneStartBtn.addEventListener("click", () => {
      startSpecialZoneDraw({
        zoneType: String(specialZoneTypeSelect?.value || state.specialZoneEditor.zoneType || "custom"),
        label: String(specialZoneLabelInput?.value || state.specialZoneEditor.label || ""),
      });
      if (typeof state.updateSpecialZoneEditorUIFn === "function") {
        state.updateSpecialZoneEditorUIFn();
      }
      if (render) render();
    });
  }
  if (specialZoneUndoBtn) {
    specialZoneUndoBtn.addEventListener("click", () => {
      undoSpecialZoneVertex();
      if (typeof state.updateSpecialZoneEditorUIFn === "function") {
        state.updateSpecialZoneEditorUIFn();
      }
      if (render) render();
    });
  }
  if (specialZoneFinishBtn) {
    specialZoneFinishBtn.addEventListener("click", () => {
      finishSpecialZoneDraw();
      if (typeof state.updateSpecialZoneEditorUIFn === "function") {
        state.updateSpecialZoneEditorUIFn();
      }
      if (render) render();
    });
  }
  if (specialZoneCancelBtn) {
    specialZoneCancelBtn.addEventListener("click", () => {
      cancelSpecialZoneDraw();
      if (typeof state.updateSpecialZoneEditorUIFn === "function") {
        state.updateSpecialZoneEditorUIFn();
      }
      if (render) render();
    });
  }
  if (specialZoneFeatureList) {
    specialZoneFeatureList.addEventListener("change", (event) => {
      selectSpecialZoneById(String(event.target.value || ""));
      if (typeof state.updateSpecialZoneEditorUIFn === "function") {
        state.updateSpecialZoneEditorUIFn();
      }
      if (render) render();
    });
  }
  if (specialZoneDeleteBtn) {
    specialZoneDeleteBtn.addEventListener("click", () => {
      deleteSelectedManualSpecialZone();
      if (typeof state.updateSpecialZoneEditorUIFn === "function") {
        state.updateSpecialZoneEditorUIFn();
      }
      if (render) render();
    });
  }

  if (presetPolitical) {
    presetPolitical.addEventListener("click", () => {
      autoFillMap("political");
      applyAutoFillOceanColor();
      if (render) render();
    });
  }

  if (colorModeSelect) {
    colorModeSelect.value = state.colorMode;
    colorModeSelect.addEventListener("change", (event) => {
      const value = String(event.target.value || "region");
      state.colorMode = value === "political" ? "political" : "region";
    });
  }

  if (paintGranularitySelect) {
    paintGranularitySelect.value = state.interactionGranularity || "subdivision";
    paintGranularitySelect.addEventListener("change", (event) => {
      const value = String(event.target.value || "subdivision");
      const requested = value === "country" ? "country" : "subdivision";
      state.interactionGranularity =
        state.paintMode === "sovereignty" ? "subdivision" : requested;
      paintGranularitySelect.value = state.interactionGranularity;
    });
  }

  if (paintModeSelect) {
    paintModeSelect.value = state.paintMode || "visual";
    paintModeSelect.addEventListener("change", (event) => {
      const value = String(event.target.value || "visual");
      state.paintMode = value === "sovereignty" ? "sovereignty" : "visual";
      if (state.paintMode === "sovereignty") {
        state.interactionGranularity = "subdivision";
        if (paintGranularitySelect) {
          paintGranularitySelect.value = "subdivision";
        }
      }
      refreshActiveSovereignLabel();
      refreshDynamicBorderStatus();
      if (render) render();
    });
  }

  if (recalculateBordersBtn) {
    recalculateBordersBtn.addEventListener("click", () => {
      recomputeDynamicBordersNow({ renderNow: true, reason: "manual-toolbar" });
    });
  }

  if (presetClear) {
    presetClear.addEventListener("click", () => {
      if (state.paintMode === "sovereignty") {
        resetAllFeatureOwnersToCanonical();
        scheduleDynamicBorderRecompute("clear-sovereignty", 90);
      } else {
        state.colors = {};
        state.visualOverrides = {};
        state.featureOverrides = {};
        state.countryBaseColors = {};
        state.sovereignBaseColors = {};
      }
      refreshColorState({ renderNow: true });
      refreshActiveSovereignLabel();
      refreshDynamicBorderStatus();
    });
  }

  if (themeSelect) {
    populatePaletteSourceOptions(themeSelect);
    themeSelect.addEventListener("change", async (event) => {
      const sourceOptions = getPaletteSourceOptions();
      if (!sourceOptions.length) {
        renderPalette(event.target.value);
        renderPaletteLibrary();
        return;
      }
      await handlePaletteSourceChange(event.target.value);
    });
  }

  if (autoFillStyleSelect) {
    populatePaletteSourceOptions(autoFillStyleSelect);
    autoFillStyleSelect.addEventListener("change", async (event) => {
      if (!getPaletteSourceOptions().length) {
        syncPaletteSourceControls();
        return;
      }
      await handlePaletteSourceChange(event.target.value);
    });
  }

  if (paletteLibraryToggle) {
    paletteLibraryToggle.addEventListener("click", () => {
      state.paletteLibraryOpen = !state.paletteLibraryOpen;
      paletteLibraryPanel?.classList.toggle("hidden", !state.paletteLibraryOpen);
      paletteLibraryToggle.textContent = state.paletteLibraryOpen
        ? t("Hide Color Library", "ui")
        : t("Browse All Colors", "ui");
      renderPaletteLibrary();
    });
  }

  if (paletteLibrarySearch) {
    paletteLibrarySearch.value = state.paletteLibrarySearch || "";
    paletteLibrarySearch.addEventListener("input", (event) => {
      state.paletteLibrarySearch = String(event.target.value || "");
      renderPaletteLibrary();
    });
  }

  if (internalBorderColor) {
    internalBorderColor.addEventListener("input", (event) => {
      state.styleConfig.internalBorders.color = event.target.value;
      if (render) render();
    });
  }
  if (internalBorderOpacity) {
    internalBorderOpacity.addEventListener("input", (event) => {
      const value = Number(event.target.value) / 100;
      state.styleConfig.internalBorders.opacity = Number.isFinite(value) ? value : 1;
      if (internalBorderOpacityValue) {
        internalBorderOpacityValue.textContent = `${event.target.value}%`;
      }
      if (render) render();
    });
  }
  if (internalBorderWidth) {
    const initialInternalWidth = Number(internalBorderWidth.value);
    if (Number.isFinite(initialInternalWidth)) {
      state.styleConfig.internalBorders.width = initialInternalWidth;
      if (internalBorderWidthValue) {
        internalBorderWidthValue.textContent = initialInternalWidth.toFixed(2);
      }
    }
    internalBorderWidth.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      state.styleConfig.internalBorders.width = Number.isFinite(value) ? value : 0.5;
      if (internalBorderWidthValue) {
        internalBorderWidthValue.textContent = value.toFixed(2);
      }
      if (render) render();
    });
  }

  if (empireBorderColor) {
    empireBorderColor.addEventListener("input", (event) => {
      state.styleConfig.empireBorders.color = event.target.value;
      if (render) render();
    });
  }
  if (empireBorderWidth) {
    const initialEmpireWidth = Number(empireBorderWidth.value);
    if (Number.isFinite(initialEmpireWidth)) {
      state.styleConfig.empireBorders.width = initialEmpireWidth;
      if (empireBorderWidthValue) {
        empireBorderWidthValue.textContent = initialEmpireWidth.toFixed(2);
      }
    }
    empireBorderWidth.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      state.styleConfig.empireBorders.width = Number.isFinite(value) ? value : 1.0;
      if (empireBorderWidthValue) {
        empireBorderWidthValue.textContent = value.toFixed(2);
      }
      if (render) render();
    });
  }

  if (coastlineColor) {
    coastlineColor.addEventListener("input", (event) => {
      state.styleConfig.coastlines.color = event.target.value;
      if (render) render();
    });
  }
  if (coastlineWidth) {
    coastlineWidth.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      state.styleConfig.coastlines.width = Number.isFinite(value) ? value : 1.2;
      if (coastlineWidthValue) {
        coastlineWidthValue.textContent = value.toFixed(1);
      }
      if (render) render();
    });
  }

  if (parentBorderColor) {
    parentBorderColor.value = state.styleConfig.parentBorders.color || "#4b5563";
    parentBorderColor.addEventListener("input", (event) => {
      state.styleConfig.parentBorders.color = event.target.value;
      if (render) render();
    });
  }
  if (parentBorderOpacity) {
    const initial = Math.round((state.styleConfig.parentBorders.opacity || 0.85) * 100);
    parentBorderOpacity.value = String(clamp(initial, 0, 100));
    if (parentBorderOpacityValue) {
      parentBorderOpacityValue.textContent = `${parentBorderOpacity.value}%`;
    }
    parentBorderOpacity.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      state.styleConfig.parentBorders.opacity = clamp(
        Number.isFinite(value) ? value / 100 : 0.85,
        0,
        1
      );
      if (parentBorderOpacityValue) {
        parentBorderOpacityValue.textContent = `${event.target.value}%`;
      }
      if (render) render();
    });
  }
  if (parentBorderWidth) {
    const initial = Number(state.styleConfig.parentBorders.width || 1.1);
    parentBorderWidth.value = String(clamp(initial, 0.2, 4));
    if (parentBorderWidthValue) {
      parentBorderWidthValue.textContent = Number(parentBorderWidth.value).toFixed(2);
    }
    parentBorderWidth.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      state.styleConfig.parentBorders.width = clamp(Number.isFinite(value) ? value : 1.1, 0.2, 4);
      if (parentBorderWidthValue) {
        parentBorderWidthValue.textContent = state.styleConfig.parentBorders.width.toFixed(2);
      }
      if (render) render();
    });
  }
  if (parentBorderEnableAll) {
    parentBorderEnableAll.addEventListener("click", () => {
      const supported = Array.isArray(state.parentBorderSupportedCountries)
        ? state.parentBorderSupportedCountries
        : [];
      supported.forEach((countryCode) => {
        state.parentBorderEnabledByCountry[countryCode] = true;
      });
      renderParentBorderCountryList();
      if (render) render();
    });
  }
  if (parentBorderDisableAll) {
    parentBorderDisableAll.addEventListener("click", () => {
      const supported = Array.isArray(state.parentBorderSupportedCountries)
        ? state.parentBorderSupportedCountries
        : [];
      supported.forEach((countryCode) => {
        state.parentBorderEnabledByCountry[countryCode] = false;
      });
      renderParentBorderCountryList();
      if (render) render();
    });
  }

  if (oceanStyleSelect) {
    if (!OCEAN_ADVANCED_STYLES_ENABLED) {
      Array.from(oceanStyleSelect.options).forEach((option) => {
        if (OCEAN_ADVANCED_PRESETS.has(option.value)) {
          option.disabled = true;
        }
      });
      oceanStyleSelect.title = "Advanced ocean styles are temporarily disabled for performance.";
      oceanStyleSelect.value = "flat";
    }
    oceanStyleSelect.value = state.styleConfig.ocean.preset || "flat";
    oceanStyleSelect.addEventListener("change", (event) => {
      const nextPreset = normalizeOceanPreset(event.target.value);
      if (!OCEAN_ADVANCED_STYLES_ENABLED && OCEAN_ADVANCED_PRESETS.has(nextPreset)) {
        state.styleConfig.ocean.preset = "flat";
        event.target.value = "flat";
      } else {
        state.styleConfig.ocean.preset = nextPreset;
      }
      if (render) render();
    });
  }

  if (oceanTextureOpacity) {
    const initial = Math.round((state.styleConfig.ocean.opacity || 0.72) * 100);
    oceanTextureOpacity.value = String(clamp(initial, 0, 100));
    if (oceanTextureOpacityValue) {
      oceanTextureOpacityValue.textContent = `${oceanTextureOpacity.value}%`;
    }
    oceanTextureOpacity.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      state.styleConfig.ocean.opacity = clamp(Number.isFinite(value) ? value / 100 : 0.72, 0, 1);
      if (oceanTextureOpacityValue) {
        oceanTextureOpacityValue.textContent = `${event.target.value}%`;
      }
      if (render) render();
    });
    if (!OCEAN_ADVANCED_STYLES_ENABLED) {
      oceanTextureOpacity.disabled = true;
      oceanTextureOpacity.title = "Temporarily disabled while advanced ocean styles are off.";
    }
  }

  if (oceanTextureScale) {
    const initial = state.styleConfig.ocean.scale || 1;
    oceanTextureScale.value = String(Math.round(clamp(initial, 0.6, 2.4) * 100));
    if (oceanTextureScaleValue) {
      oceanTextureScaleValue.textContent = `${(Number(oceanTextureScale.value) / 100).toFixed(2)}x`;
    }
    oceanTextureScale.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      state.styleConfig.ocean.scale = clamp(Number.isFinite(value) ? value / 100 : 1, 0.6, 2.4);
      if (oceanTextureScaleValue) {
        oceanTextureScaleValue.textContent = `${state.styleConfig.ocean.scale.toFixed(2)}x`;
      }
      if (render) render();
    });
    if (!OCEAN_ADVANCED_STYLES_ENABLED) {
      oceanTextureScale.disabled = true;
      oceanTextureScale.title = "Temporarily disabled while advanced ocean styles are off.";
    }
  }

  if (oceanContourStrength) {
    const initial = Math.round((state.styleConfig.ocean.contourStrength || 0.75) * 100);
    oceanContourStrength.value = String(clamp(initial, 0, 100));
    if (oceanContourStrengthValue) {
      oceanContourStrengthValue.textContent = `${oceanContourStrength.value}%`;
    }
    oceanContourStrength.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      state.styleConfig.ocean.contourStrength = clamp(Number.isFinite(value) ? value / 100 : 0.75, 0, 1);
      if (oceanContourStrengthValue) {
        oceanContourStrengthValue.textContent = `${event.target.value}%`;
      }
      if (render) render();
    });
    if (!OCEAN_ADVANCED_STYLES_ENABLED) {
      oceanContourStrength.disabled = true;
      oceanContourStrength.title = "Temporarily disabled while advanced ocean styles are off.";
    }
  }

  const referenceImage = document.getElementById("referenceImage");
  const applyReferenceStyles = () => {
    if (!referenceImage) return;
    referenceImage.style.opacity = String(state.referenceImageState.opacity);
    referenceImage.style.transform = `translate(${state.referenceImageState.offsetX}px, ${state.referenceImageState.offsetY}px) scale(${state.referenceImageState.scale})`;
  };

  if (referenceImageInput) {
    referenceImageInput.addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (!referenceImage) return;
      if (!file) {
        if (state.referenceImageUrl) {
          URL.revokeObjectURL(state.referenceImageUrl);
          state.referenceImageUrl = null;
        }
        referenceImage.src = "";
        referenceImage.style.opacity = "0";
        return;
      }
      if (state.referenceImageUrl) {
        URL.revokeObjectURL(state.referenceImageUrl);
      }
      state.referenceImageUrl = URL.createObjectURL(file);
      referenceImage.src = state.referenceImageUrl;
      applyReferenceStyles();
    });
  }

  if (referenceOpacity) {
    state.referenceImageState.opacity = Number(referenceOpacity.value) / 100;
    if (referenceOpacityValue) {
      referenceOpacityValue.textContent = `${referenceOpacity.value}%`;
    }
    referenceOpacity.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      state.referenceImageState.opacity = Number.isFinite(value) ? value / 100 : 0.6;
      if (referenceOpacityValue) {
        referenceOpacityValue.textContent = `${event.target.value}%`;
      }
      applyReferenceStyles();
    });
  }

  if (referenceScale) {
    state.referenceImageState.scale = Number(referenceScale.value);
    if (referenceScaleValue) {
      referenceScaleValue.textContent = `${Number(referenceScale.value).toFixed(2)}x`;
    }
    referenceScale.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      state.referenceImageState.scale = Number.isFinite(value) ? value : 1;
      if (referenceScaleValue) {
        referenceScaleValue.textContent = `${state.referenceImageState.scale.toFixed(2)}x`;
      }
      applyReferenceStyles();
    });
  }

  if (referenceOffsetX) {
    state.referenceImageState.offsetX = Number(referenceOffsetX.value);
    if (referenceOffsetXValue) {
      referenceOffsetXValue.textContent = `${referenceOffsetX.value}px`;
    }
    referenceOffsetX.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      state.referenceImageState.offsetX = Number.isFinite(value) ? value : 0;
      if (referenceOffsetXValue) {
        referenceOffsetXValue.textContent = `${state.referenceImageState.offsetX}px`;
      }
      applyReferenceStyles();
    });
  }

  if (referenceOffsetY) {
    state.referenceImageState.offsetY = Number(referenceOffsetY.value);
    if (referenceOffsetYValue) {
      referenceOffsetYValue.textContent = `${referenceOffsetY.value}px`;
    }
    referenceOffsetY.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      state.referenceImageState.offsetY = Number.isFinite(value) ? value : 0;
      if (referenceOffsetYValue) {
        referenceOffsetYValue.textContent = `${state.referenceImageState.offsetY}px`;
      }
      applyReferenceStyles();
    });
  }

  paletteLibraryPanel?.classList.toggle("hidden", !state.paletteLibraryOpen);
  if (paletteLibraryToggle) {
    paletteLibraryToggle.textContent = state.paletteLibraryOpen
      ? t("Hide Color Library", "ui")
      : t("Browse All Colors", "ui");
  }
  syncPaletteSourceControls();
  renderPalette(state.currentPaletteTheme);
  renderPaletteLibrary();
  state.updatePaintModeUIFn();
  renderRecentColors();
  renderParentBorderCountryList();
  renderSpecialZoneEditorUI();
  updateSwatchUI();
  updateToolUI();
  updateUIText();
}



export { initToolbar };
