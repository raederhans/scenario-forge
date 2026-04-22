// Special zone editor controller.
// 这个模块只负责 special zone 面板自己的 runtimeState 归一、DOM 渲染和事件绑定。
// toolbar.js 继续保留 popover 打开关闭、全局 dismiss 和其他 overlay 的仲裁。

function createSpecialZoneEditorController({
  runtimeState,
  specialZonesDisputedFill = null,
  specialZonesDisputedStroke = null,
  specialZonesWastelandFill = null,
  specialZonesWastelandStroke = null,
  specialZonesCustomFill = null,
  specialZonesCustomStroke = null,
  specialZonesOpacity = null,
  specialZonesStrokeWidth = null,
  specialZonesDashStyle = null,
  specialZoneTypeSelect = null,
  specialZoneLabelInput = null,
  specialZoneStartBtn = null,
  specialZoneUndoBtn = null,
  specialZoneFinishBtn = null,
  specialZoneCancelBtn = null,
  specialZoneFeatureList = null,
  specialZoneDeleteBtn = null,
  specialZoneEditorHint = null,
  specialZonesOpacityValue = null,
  specialZonesStrokeWidthValue = null,
  normalizeOceanFillColor,
  clamp,
  markDirty,
  dismissOnboardingHint,
  updateToolUI,
  renderTransportAppearanceUi,
  render,
  startSpecialZoneDraw,
  undoSpecialZoneVertex,
  finishSpecialZoneDraw,
  cancelSpecialZoneDraw,
  deleteSelectedManualSpecialZone,
  selectSpecialZoneById,
  showAppDialog,
  showToast,
  t,
} = {}) {
  const normalizeSpecialZoneEditorState = () => {
    if (!runtimeState.styleConfig.specialZones || typeof runtimeState.styleConfig.specialZones !== "object") {
      runtimeState.styleConfig.specialZones = {};
    }
    runtimeState.styleConfig.specialZones.disputedFill = normalizeOceanFillColor(
      runtimeState.styleConfig.specialZones.disputedFill || "#f97316"
    );
    runtimeState.styleConfig.specialZones.disputedStroke = normalizeOceanFillColor(
      runtimeState.styleConfig.specialZones.disputedStroke || "#ea580c"
    );
    runtimeState.styleConfig.specialZones.wastelandFill = normalizeOceanFillColor(
      runtimeState.styleConfig.specialZones.wastelandFill || "#dc2626"
    );
    runtimeState.styleConfig.specialZones.wastelandStroke = normalizeOceanFillColor(
      runtimeState.styleConfig.specialZones.wastelandStroke || "#b91c1c"
    );
    runtimeState.styleConfig.specialZones.customFill = normalizeOceanFillColor(
      runtimeState.styleConfig.specialZones.customFill || "#8b5cf6"
    );
    runtimeState.styleConfig.specialZones.customStroke = normalizeOceanFillColor(
      runtimeState.styleConfig.specialZones.customStroke || "#6d28d9"
    );
    runtimeState.styleConfig.specialZones.opacity = clamp(
      Number.isFinite(Number(runtimeState.styleConfig.specialZones.opacity))
        ? Number(runtimeState.styleConfig.specialZones.opacity)
        : 0.32,
      0,
      1
    );
    runtimeState.styleConfig.specialZones.strokeWidth = clamp(
      Number.isFinite(Number(runtimeState.styleConfig.specialZones.strokeWidth))
        ? Number(runtimeState.styleConfig.specialZones.strokeWidth)
        : 1.3,
      0.4,
      4
    );
    runtimeState.styleConfig.specialZones.dashStyle = String(runtimeState.styleConfig.specialZones.dashStyle || "dashed");

    if (!runtimeState.manualSpecialZones || runtimeState.manualSpecialZones.type !== "FeatureCollection") {
      runtimeState.manualSpecialZones = { type: "FeatureCollection", features: [] };
    }
    if (!Array.isArray(runtimeState.manualSpecialZones.features)) {
      runtimeState.manualSpecialZones.features = [];
    }
    if (!runtimeState.specialZoneEditor || typeof runtimeState.specialZoneEditor !== "object") {
      runtimeState.specialZoneEditor = {};
    }
    runtimeState.specialZoneEditor.zoneType = String(runtimeState.specialZoneEditor.zoneType || "custom");
    runtimeState.specialZoneEditor.label = String(runtimeState.specialZoneEditor.label || "");
  };

  const renderSpecialZoneEditorUI = () => {
    if (specialZonesDisputedFill) specialZonesDisputedFill.value = runtimeState.styleConfig.specialZones.disputedFill;
    if (specialZonesDisputedStroke) specialZonesDisputedStroke.value = runtimeState.styleConfig.specialZones.disputedStroke;
    if (specialZonesWastelandFill) specialZonesWastelandFill.value = runtimeState.styleConfig.specialZones.wastelandFill;
    if (specialZonesWastelandStroke) {
      specialZonesWastelandStroke.value = runtimeState.styleConfig.specialZones.wastelandStroke;
    }
    if (specialZonesCustomFill) specialZonesCustomFill.value = runtimeState.styleConfig.specialZones.customFill;
    if (specialZonesCustomStroke) specialZonesCustomStroke.value = runtimeState.styleConfig.specialZones.customStroke;
    if (specialZonesOpacity) specialZonesOpacity.value = String(Math.round(runtimeState.styleConfig.specialZones.opacity * 100));
    if (specialZonesOpacityValue) {
      specialZonesOpacityValue.textContent = `${Math.round(runtimeState.styleConfig.specialZones.opacity * 100)}%`;
    }
    if (specialZonesStrokeWidth) {
      specialZonesStrokeWidth.value = String(Number(runtimeState.styleConfig.specialZones.strokeWidth).toFixed(2));
    }
    if (specialZonesStrokeWidthValue) {
      specialZonesStrokeWidthValue.textContent = Number(runtimeState.styleConfig.specialZones.strokeWidth).toFixed(2);
    }
    if (specialZonesDashStyle) specialZonesDashStyle.value = runtimeState.styleConfig.specialZones.dashStyle;

    const manualFeatures = Array.isArray(runtimeState.manualSpecialZones?.features)
      ? runtimeState.manualSpecialZones.features
      : [];
    if (specialZoneFeatureList) {
      const selectedId = runtimeState.specialZoneEditor?.selectedId || "";
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
      specialZoneTypeSelect.value = String(runtimeState.specialZoneEditor?.zoneType || "custom");
    }
    if (specialZoneLabelInput) {
      specialZoneLabelInput.value = String(runtimeState.specialZoneEditor?.label || "");
    }

    const isDrawing = !!runtimeState.specialZoneEditor?.active;
    if (specialZoneStartBtn) specialZoneStartBtn.disabled = isDrawing;
    if (specialZoneUndoBtn) specialZoneUndoBtn.disabled = !isDrawing;
    if (specialZoneFinishBtn) specialZoneFinishBtn.disabled = !isDrawing;
    if (specialZoneCancelBtn) specialZoneCancelBtn.disabled = !isDrawing;
    if (specialZoneDeleteBtn) {
      specialZoneDeleteBtn.disabled = !runtimeState.specialZoneEditor?.selectedId;
    }
    if (specialZoneEditorHint) {
      specialZoneEditorHint.textContent = isDrawing
        ? t("Drawing in progress: click map to add vertices, double-click to finish.", "ui")
        : t("Click map to add vertices, double-click to finish.", "ui");
    }
    renderTransportAppearanceUi?.();
  };

  const onSpecialZonesStyleChange = () => {
    markDirty("special-zone-style");
  };

  const bindSpecialZoneEditorEvents = () => {
    if (specialZonesDisputedFill && !specialZonesDisputedFill.dataset.bound) {
      specialZonesDisputedFill.addEventListener("input", (event) => {
        runtimeState.styleConfig.specialZones.disputedFill = normalizeOceanFillColor(event.target.value);
        onSpecialZonesStyleChange();
      });
      specialZonesDisputedFill.dataset.bound = "true";
    }
    if (specialZonesDisputedStroke && !specialZonesDisputedStroke.dataset.bound) {
      specialZonesDisputedStroke.addEventListener("input", (event) => {
        runtimeState.styleConfig.specialZones.disputedStroke = normalizeOceanFillColor(event.target.value);
        onSpecialZonesStyleChange();
      });
      specialZonesDisputedStroke.dataset.bound = "true";
    }
    if (specialZonesWastelandFill && !specialZonesWastelandFill.dataset.bound) {
      specialZonesWastelandFill.addEventListener("input", (event) => {
        runtimeState.styleConfig.specialZones.wastelandFill = normalizeOceanFillColor(event.target.value);
        onSpecialZonesStyleChange();
      });
      specialZonesWastelandFill.dataset.bound = "true";
    }
    if (specialZonesWastelandStroke && !specialZonesWastelandStroke.dataset.bound) {
      specialZonesWastelandStroke.addEventListener("input", (event) => {
        runtimeState.styleConfig.specialZones.wastelandStroke = normalizeOceanFillColor(event.target.value);
        onSpecialZonesStyleChange();
      });
      specialZonesWastelandStroke.dataset.bound = "true";
    }
    if (specialZonesCustomFill && !specialZonesCustomFill.dataset.bound) {
      specialZonesCustomFill.addEventListener("input", (event) => {
        runtimeState.styleConfig.specialZones.customFill = normalizeOceanFillColor(event.target.value);
        onSpecialZonesStyleChange();
      });
      specialZonesCustomFill.dataset.bound = "true";
    }
    if (specialZonesCustomStroke && !specialZonesCustomStroke.dataset.bound) {
      specialZonesCustomStroke.addEventListener("input", (event) => {
        runtimeState.styleConfig.specialZones.customStroke = normalizeOceanFillColor(event.target.value);
        onSpecialZonesStyleChange();
      });
      specialZonesCustomStroke.dataset.bound = "true";
    }
    if (specialZonesOpacity && !specialZonesOpacity.dataset.bound) {
      specialZonesOpacity.addEventListener("input", (event) => {
        const value = Number(event.target.value);
        runtimeState.styleConfig.specialZones.opacity = clamp(Number.isFinite(value) ? value / 100 : 0.32, 0, 1);
        if (specialZonesOpacityValue) {
          specialZonesOpacityValue.textContent = `${Math.round(runtimeState.styleConfig.specialZones.opacity * 100)}%`;
        }
        onSpecialZonesStyleChange();
      });
      specialZonesOpacity.dataset.bound = "true";
    }
    if (specialZonesStrokeWidth && !specialZonesStrokeWidth.dataset.bound) {
      specialZonesStrokeWidth.addEventListener("input", (event) => {
        const value = Number(event.target.value);
        runtimeState.styleConfig.specialZones.strokeWidth = clamp(Number.isFinite(value) ? value : 1.3, 0.4, 4);
        if (specialZonesStrokeWidthValue) {
          specialZonesStrokeWidthValue.textContent = Number(runtimeState.styleConfig.specialZones.strokeWidth).toFixed(2);
        }
        onSpecialZonesStyleChange();
      });
      specialZonesStrokeWidth.dataset.bound = "true";
    }
    if (specialZonesDashStyle && !specialZonesDashStyle.dataset.bound) {
      specialZonesDashStyle.addEventListener("change", (event) => {
        runtimeState.styleConfig.specialZones.dashStyle = String(event.target.value || "dashed");
        onSpecialZonesStyleChange();
      });
      specialZonesDashStyle.dataset.bound = "true";
    }

    if (specialZoneTypeSelect && !specialZoneTypeSelect.dataset.bound) {
      specialZoneTypeSelect.addEventListener("change", (event) => {
        runtimeState.specialZoneEditor.zoneType = String(event.target.value || "custom");
        runtimeState.updateSpecialZoneEditorUIFn?.();
        markDirty("special-zone-type");
      });
      specialZoneTypeSelect.dataset.bound = "true";
    }
    if (specialZoneLabelInput && !specialZoneLabelInput.dataset.bound) {
      specialZoneLabelInput.addEventListener("input", (event) => {
        runtimeState.specialZoneEditor.label = String(event.target.value || "");
        markDirty("special-zone-label");
      });
      specialZoneLabelInput.dataset.bound = "true";
    }
    if (specialZoneStartBtn && !specialZoneStartBtn.dataset.bound) {
      specialZoneStartBtn.addEventListener("click", () => {
        startSpecialZoneDraw({
          zoneType: String(specialZoneTypeSelect?.value || runtimeState.specialZoneEditor.zoneType || "custom"),
          label: String(specialZoneLabelInput?.value || runtimeState.specialZoneEditor.label || ""),
        });
        runtimeState.updateSpecialZoneEditorUIFn?.();
        dismissOnboardingHint?.();
        updateToolUI?.();
        render?.();
      });
      specialZoneStartBtn.dataset.bound = "true";
    }
    if (specialZoneUndoBtn && !specialZoneUndoBtn.dataset.bound) {
      specialZoneUndoBtn.addEventListener("click", () => {
        undoSpecialZoneVertex();
        runtimeState.updateSpecialZoneEditorUIFn?.();
        updateToolUI?.();
        render?.();
      });
      specialZoneUndoBtn.dataset.bound = "true";
    }
    if (specialZoneFinishBtn && !specialZoneFinishBtn.dataset.bound) {
      specialZoneFinishBtn.addEventListener("click", () => {
        const didFinish = finishSpecialZoneDraw();
        runtimeState.updateSpecialZoneEditorUIFn?.();
        updateToolUI?.();
        if (didFinish) {
          markDirty("special-zone-finish");
        }
        render?.();
      });
      specialZoneFinishBtn.dataset.bound = "true";
    }
    if (specialZoneCancelBtn && !specialZoneCancelBtn.dataset.bound) {
      specialZoneCancelBtn.addEventListener("click", () => {
        cancelSpecialZoneDraw();
        runtimeState.updateSpecialZoneEditorUIFn?.();
        updateToolUI?.();
        render?.();
      });
      specialZoneCancelBtn.dataset.bound = "true";
    }
    if (specialZoneFeatureList && !specialZoneFeatureList.dataset.bound) {
      specialZoneFeatureList.addEventListener("change", (event) => {
        selectSpecialZoneById(String(event.target.value || ""));
        runtimeState.updateSpecialZoneEditorUIFn?.();
        render?.();
      });
      specialZoneFeatureList.dataset.bound = "true";
    }
    if (specialZoneDeleteBtn && !specialZoneDeleteBtn.dataset.bound) {
      specialZoneDeleteBtn.addEventListener("click", async () => {
        if (!runtimeState.specialZoneEditor?.selectedId) return;
        const confirmed = await showAppDialog({
          title: t("Delete Selected", "ui"),
          message: t("Delete the selected special region?", "ui"),
          details: t(
            "This removes the selected manual zone from the current project. You can undo the deletion from history.",
            "ui"
          ),
          confirmLabel: t("Delete Zone", "ui"),
          cancelLabel: t("Cancel", "ui"),
          tone: "warning",
        });
        if (!confirmed) return;
        deleteSelectedManualSpecialZone();
        runtimeState.updateSpecialZoneEditorUIFn?.();
        markDirty("special-zone-delete");
        render?.();
        showToast(t("Selected special region was deleted.", "ui"), {
          title: t("Delete Selected", "ui"),
          tone: "warning",
        });
      });
      specialZoneDeleteBtn.dataset.bound = "true";
    }
  };

  return {
    bindSpecialZoneEditorEvents,
    normalizeSpecialZoneEditorState,
    renderSpecialZoneEditorUI,
  };
}

export { createSpecialZoneEditorController };
