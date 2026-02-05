// Toolbar UI (Phase 13)
import { state, PALETTE_THEMES } from "../core/state.js";
import { invalidateBorderCache, autoFillMap } from "../core/map_renderer.js";
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
  const toolButtons = document.querySelectorAll(".tool-button");
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
  const internalBorderColor = document.getElementById("internalBorderColor");
  const internalBorderOpacity = document.getElementById("internalBorderOpacity");
  const internalBorderWidth = document.getElementById("internalBorderWidth");
  const empireBorderColor = document.getElementById("empireBorderColor");
  const empireBorderWidth = document.getElementById("empireBorderWidth");
  const coastlineColor = document.getElementById("coastlineColor");
  const coastlineWidth = document.getElementById("coastlineWidth");
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
  const referenceOpacityValue = document.getElementById("referenceOpacityValue");
  const referenceScaleValue = document.getElementById("referenceScaleValue");
  const referenceOffsetXValue = document.getElementById("referenceOffsetXValue");
  const referenceOffsetYValue = document.getElementById("referenceOffsetYValue");

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
      currentToolLabel.textContent = "Editing Preset";
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
      autoFillMap(state.colorMode);
    });
  }

  if (presetClear) {
    presetClear.addEventListener("click", () => {
      Object.keys(state.colors).forEach((key) => delete state.colors[key]);
      invalidateBorderCache();
      if (typeof globalThis.renderApp === "function") {
        globalThis.renderApp();
      }
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
    internalBorderWidth.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      state.styleConfig.internalBorders.width = Number.isFinite(value) ? value : 0.5;
      if (internalBorderWidthValue) {
        internalBorderWidthValue.textContent = value.toFixed(1);
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
    empireBorderWidth.addEventListener("input", (event) => {
      const value = Number(event.target.value);
      state.styleConfig.empireBorders.width = Number.isFinite(value) ? value : 1.0;
      if (empireBorderWidthValue) {
        empireBorderWidthValue.textContent = value.toFixed(1);
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
