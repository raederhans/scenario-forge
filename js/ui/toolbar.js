// Toolbar UI (Phase 13)
import { state, PALETTE_THEMES } from "../core/state.js";
import { autoFillMap, refreshColorState } from "../core/map_renderer.js";
import { toggleLanguage, updateUIText, t } from "./i18n.js";

function renderPalette(themeName) {
  console.log("Rendering palette:", themeName);
  const palette = PALETTE_THEMES[themeName];
  const paletteGrid = document.getElementById("paletteGrid");
  if (!paletteGrid || !palette) return;
  state.currentPaletteTheme = themeName;
  paletteGrid.replaceChildren();

  palette.forEach((color) => {
    const btn = document.createElement("button");
    btn.className = "color-swatch";
    btn.dataset.color = color;
    btn.style.backgroundColor = color;
    btn.addEventListener("click", () => {
      state.selectedColor = color;
      if (typeof state.updateSwatchUIFn === "function") {
        state.updateSwatchUIFn();
      }
    });
    paletteGrid.appendChild(btn);
  });

  if (!palette.includes(state.selectedColor) && palette.length > 0) {
    state.selectedColor = palette[0];
  }
  if (typeof state.updateSwatchUIFn === "function") {
    state.updateSwatchUIFn();
  }
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
  const recentContainer = document.getElementById("recentColors");
  const presetPolitical = document.getElementById("presetPolitical");
  const presetClear = document.getElementById("presetClear");
  const colorModeSelect = document.getElementById("colorModeSelect");
  const paintGranularitySelect = document.getElementById("paintGranularitySelect");
  const internalBorderColor = document.getElementById("internalBorderColor");
  const internalBorderOpacity = document.getElementById("internalBorderOpacity");
  const internalBorderWidth = document.getElementById("internalBorderWidth");
  const empireBorderColor = document.getElementById("empireBorderColor");
  const empireBorderWidth = document.getElementById("empireBorderWidth");
  const coastlineColor = document.getElementById("coastlineColor");
  const coastlineWidth = document.getElementById("coastlineWidth");
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
  const oceanTextureOpacityValue = document.getElementById("oceanTextureOpacityValue");
  const oceanTextureScaleValue = document.getElementById("oceanTextureScaleValue");
  const oceanContourStrengthValue = document.getElementById("oceanContourStrengthValue");
  const referenceOpacityValue = document.getElementById("referenceOpacityValue");
  const referenceScaleValue = document.getElementById("referenceScaleValue");
  const referenceOffsetXValue = document.getElementById("referenceOffsetXValue");
  const referenceOffsetYValue = document.getElementById("referenceOffsetYValue");

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
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
      const btn = document.createElement("button");
      btn.className = "color-swatch";
      btn.dataset.color = color;
      btn.style.backgroundColor = color;
      btn.addEventListener("click", () => {
        state.selectedColor = color;
        updateSwatchUI();
      });
      recentContainer.appendChild(btn);
    });
  }
  state.updateRecentUI = renderRecentColors;

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
    toggleUrban.addEventListener("change", (event) => {
      state.showUrban = event.target.checked;
      if (render) render();
    });
  }

  if (togglePhysical) {
    togglePhysical.addEventListener("change", (event) => {
      state.showPhysical = event.target.checked;
      if (render) render();
    });
  }

  if (toggleRivers) {
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

  if (presetPolitical) {
    presetPolitical.addEventListener("click", () => {
      autoFillMap(state.colorMode);
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
      state.interactionGranularity = value === "country" ? "country" : "subdivision";
    });
  }

  if (presetClear) {
    presetClear.addEventListener("click", () => {
      state.countryBaseColors = {};
      state.featureOverrides = {};
      refreshColorState({ renderNow: true });
    });
  }

  if (themeSelect) {
    themeSelect.value = state.currentPaletteTheme;
    themeSelect.addEventListener("change", (event) => {
      renderPalette(event.target.value);
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

  renderPalette(state.currentPaletteTheme);
  renderRecentColors();
  updateSwatchUI();
  updateToolUI();
  updateUIText();
}



export { initToolbar };
