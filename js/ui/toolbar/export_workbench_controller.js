// Export workbench controller.
// 这个模块负责 export workbench 的状态归一、列表渲染、预览、导出动作和面板内部事件绑定。
// toolbar.js 继续保留 overlay 外壳、跨面板仲裁、URL/focus 协调和 open/close facade。

import { resolveSampleExportRecommendationContext } from "../../core/sample_export_recommendation.js";
import {
  ensureExportWorkbenchUiState as ensureExportWorkbenchUiAction,
  setExportAdjustmentsState,
  setExportBakeState,
  setExportLayerOrderState,
  setExportOutputState,
  setExportPreviewState,
  setExportTextVisibilityState,
  setExportVisibilityState,
} from "../../core/state/actions/export_workbench_actions.js";

const EXPORT_MAIN_LAYER_VIEW_MODELS = Object.freeze([
  Object.freeze({ id: "background", name: "Background", summary: "Base frame", passNames: ["background"] }),
  Object.freeze({ id: "political", name: "Political", summary: "Terrain + ownership", passNames: ["physicalBase", "political"] }),
  Object.freeze({ id: "context", name: "Context", summary: "Scenario overlays", passNames: ["contextBase", "contextScenario"] }),
  Object.freeze({ id: "effects", name: "Effects", summary: "Borders + overlays", passNames: ["effects", "lineEffects", "contextMarkers", "dayNight", "borders", "textureLabels"] }),
  Object.freeze({ id: "labels", name: "Labels", summary: "Render-pass labels", passNames: ["labels"] }),
]);
const EXPORT_MAIN_LAYER_IDS = Object.freeze(EXPORT_MAIN_LAYER_VIEW_MODELS.map((layer) => layer.id));
const EXPORT_MAIN_LAYER_MODEL_BY_ID = new Map(EXPORT_MAIN_LAYER_VIEW_MODELS.map((layer) => [layer.id, layer]));
const EXPORT_TEXT_LAYER_VIEW_MODELS = Object.freeze([
  Object.freeze({ id: "render-labels", name: "Render-pass labels", summary: "City and map labels from the labels pass" }),
  Object.freeze({ id: "special-zones", name: "Special zones", summary: "Layer-based special zone fills, patterns, and outlines" }),
  Object.freeze({ id: "svg-annotations", name: "SVG annotations", summary: "Frontlines, graphics, counters, and other SVG overlays" }),
]);
const EXPORT_TEXT_LAYER_IDS = Object.freeze(EXPORT_TEXT_LAYER_VIEW_MODELS.map((layer) => layer.id));
const EXPORT_TEXT_LAYER_MODEL_BY_ID = new Map(EXPORT_TEXT_LAYER_VIEW_MODELS.map((layer) => [layer.id, layer]));
const EXPORT_ANNOTATION_FAMILY_VIEW_MODELS = Object.freeze([
  Object.freeze({ id: "frontlines", label: "Frontlines", selector: ".frontline-overlay-layer path, .frontline-labels-layer .frontline-label" }),
  Object.freeze({ id: "operational-lines", label: "Operational lines", selector: ".operational-lines-layer .operational-line" }),
  Object.freeze({ id: "operation-graphics", label: "Operation graphics", selector: ".operation-graphics-layer .operation-graphic" }),
  Object.freeze({ id: "unit-counters", label: "Unit counters", selector: ".unit-counters-layer .unit-counter" }),
]);
const EXPORT_BAKE_OUTPUT_MODELS = Object.freeze([
  Object.freeze({ id: "color", name: "Color bake", summary: "Base color and scenario fills" }),
  Object.freeze({ id: "line", name: "Line bake", summary: "Borders and line effects" }),
  Object.freeze({ id: "text", name: "Text bake", summary: "SVG annotations and text overlays" }),
  Object.freeze({ id: "composite", name: "Composite bake", summary: "Full packed export layer" }),
]);
const EXPORT_BAKE_OUTPUT_MODEL_BY_ID = new Map(EXPORT_BAKE_OUTPUT_MODELS.map((item) => [item.id, item]));

function identityT(key) {
  return String(key || "");
}

function assertRequiredCallableDependency(value, name) {
  if (typeof value !== "function") {
    throw new TypeError(`createExportWorkbenchController requires ${name} to be a function.`);
  }
}

function assertRequiredObjectDependency(value, name) {
  if (!value || typeof value !== "object") {
    throw new TypeError(`createExportWorkbenchController requires ${name} to be an object.`);
  }
}

function assertRequiredArrayDependency(value, name) {
  if (!Array.isArray(value)) {
    throw new TypeError(`createExportWorkbenchController requires ${name} to be an array.`);
  }
}

function localize(t, key) {
  return (typeof t === "function" ? t : identityT)(key, "ui");
}

function setElementHidden(element, hidden) {
  if (!element) return;
  element.hidden = !!hidden;
  element.classList.toggle("hidden", !!hidden);
  element.setAttribute("aria-hidden", hidden ? "true" : "false");
}

function resolveExportWorkbenchSampleContext(runtimeState, { t = identityT } = {}) {
  const context = resolveSampleExportRecommendationContext(runtimeState);
  if (!context) return null;
  return {
    sampleId: context.sampleId,
    title: `${localize(t, "Exporting sample")}: ${context.sampleTitle}`,
    recommendation: `${localize(t, "Recommended")}: ${context.recommendationSummary}`,
  };
}

function normalizeExportWorkbenchLayerOrder(value) {
  const nextOrder = Array.isArray(value)
    ? value
      .map((entry) => String(entry || "").trim())
      .filter((entry) => EXPORT_MAIN_LAYER_IDS.includes(entry))
    : [];
  const deduped = Array.from(new Set(nextOrder));
  EXPORT_MAIN_LAYER_IDS.forEach((layerId) => {
    if (!deduped.includes(layerId)) deduped.push(layerId);
  });
  return deduped;
}

function normalizeExportWorkbenchVisibility(value) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(
    EXPORT_MAIN_LAYER_IDS.map((layerId) => [layerId, source[layerId] !== false])
  );
}

function normalizeExportWorkbenchTextVisibility(value, includeTextLayer = true) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(
    EXPORT_TEXT_LAYER_IDS.map((layerId) => [layerId, source[layerId] === undefined ? !!includeTextLayer : source[layerId] !== false])
  );
}

function getExportAnnotationFamilyCounts(mapSvg = null) {
  return Object.fromEntries(
    EXPORT_ANNOTATION_FAMILY_VIEW_MODELS.map((family) => [
      family.id,
      mapSvg ? mapSvg.querySelectorAll(family.selector).length : 0,
    ])
  );
}

function getExportAnnotationCountSummary(mapSvg = null) {
  const counts = getExportAnnotationFamilyCounts(mapSvg);
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const summary = EXPORT_ANNOTATION_FAMILY_VIEW_MODELS
    .map((family) => {
      const count = counts[family.id] || 0;
      return count ? `${family.label}: ${count}` : "";
    })
    .filter(Boolean)
    .join(" · ");
  return {
    count: total,
    summary: summary || "No strategic annotations currently visible",
    counts,
  };
}

function ensureExportWorkbenchUiState(state, normalizeExportWorkbenchUiState) {
  return ensureExportWorkbenchUiAction(state, {
    normalizeState: normalizeExportWorkbenchUiState,
  });
}

function resolveExportPassSequence(exportWorkbenchUi, renderPassNames) {
  const source = exportWorkbenchUi && typeof exportWorkbenchUi === "object"
    ? exportWorkbenchUi
    : {};
  const layerOrder = normalizeExportWorkbenchLayerOrder(source.layerOrder);
  const visibility = normalizeExportWorkbenchVisibility(source.visibility);
  const selectedPasses = layerOrder.flatMap((layerId) => (
    visibility[layerId] === false
      ? []
      : [...(EXPORT_MAIN_LAYER_MODEL_BY_ID.get(layerId)?.passNames || [])]
  ));
  const deduped = Array.from(new Set(selectedPasses));
  return deduped.filter((passName) => renderPassNames.includes(passName));
}

function createExportWorkbenchController({
  state,
  t,
  showToast,
  showExportFailureToast,
  normalizeExportWorkbenchUiState,
  renderPassNames,
  exportBtn = null,
  exportTarget = null,
  exportFormat = null,
  exportScale = null,
  exportWorkbenchLayerList = null,
  exportWorkbenchTextElementList = null,
  exportWorkbenchOverlay = null,
  exportWorkbenchPreviewStage = null,
  exportWorkbenchPreviewState = null,
  exportWorkbenchPreviewModeButtons = [],
  exportWorkbenchPreviewLayerSelect = null,
  exportWorkbenchBrightness = null,
  exportWorkbenchContrast = null,
  exportWorkbenchSaturation = null,
  exportWorkbenchClarity = null,
  exportWorkbenchBrightnessValue = null,
  exportWorkbenchContrastValue = null,
  exportWorkbenchSaturationValue = null,
  exportWorkbenchClarityValue = null,
  exportWorkbenchBakeVisibleBtn = null,
  exportWorkbenchClearBakeBtn = null,
  exportWorkbenchBakeArtifactList = null,
  exportWorkbenchSampleContext = null,
  exportWorkbenchSampleTitle = null,
  exportWorkbenchSampleRecommendation = null,
  exportWorkbenchCloseBtn = null,
  dockExportBtn = null,
  exportSectionSummaryTarget = null,
  exportSectionSummaryFormat = null,
  exportSectionSummaryScale = null,
  onRequestClose = null,
  buildCompositeSourceCanvas,
  buildSingleExportSourceCanvas,
  applyExportAdjustmentsToCanvas,
  buildPerLayerExportOutputs,
  buildPerLayerExportPackage,
  buildBakePackOutputs,
  buildBakePackPackage,
  buildCompositeExportCanvas,
  getSelectedExportScale,
  triggerCanvasDownload,
  triggerBlobDownload,
  bakeLayer,
  exportMaxConcurrentJobs = 1,
} = {}) {
  assertRequiredObjectDependency(state, "state");
  assertRequiredCallableDependency(t, "t");
  assertRequiredCallableDependency(showToast, "showToast");
  assertRequiredCallableDependency(showExportFailureToast, "showExportFailureToast");
  assertRequiredCallableDependency(normalizeExportWorkbenchUiState, "normalizeExportWorkbenchUiState");
  assertRequiredArrayDependency(renderPassNames, "renderPassNames");
  assertRequiredCallableDependency(buildCompositeSourceCanvas, "buildCompositeSourceCanvas");
  assertRequiredCallableDependency(buildSingleExportSourceCanvas, "buildSingleExportSourceCanvas");
  assertRequiredCallableDependency(applyExportAdjustmentsToCanvas, "applyExportAdjustmentsToCanvas");
  assertRequiredCallableDependency(bakeLayer, "bakeLayer");

  let exportWorkbenchDraggedLayerId = "";
  let exportWorkbenchPreviewRenderToken = 0;
  let exportJobsInFlight = 0;

  const getExportUi = () => ensureExportWorkbenchUiState(state, normalizeExportWorkbenchUiState);

  const getExportScaleLabel = (scaleValue) => {
    if (String(scaleValue || "") === "1") return t("Current preview (1×)", "ui");
    if (String(scaleValue || "") === "1.5") return t("High (1.5×)", "ui");
    if (String(scaleValue || "") === "4") return t("Maximum detail (4×)", "ui");
    return t("Ultra (2×)", "ui");
  };

  const getExportTextLayerEntries = () => {
    const mapSvg = document.getElementById("map-svg");
    const specialZoneCount = mapSvg ? mapSvg.querySelectorAll(".special-zones-layer .special-zone").length : 0;
    const renderPassMetrics = state.renderPassCache?.metrics?.labels || null;
    const annotationSummary = getExportAnnotationCountSummary(mapSvg);
    return [
      {
        ...EXPORT_TEXT_LAYER_MODEL_BY_ID.get("render-labels"),
        name: "Map labels",
        summary: "City and map labels from the labels pass",
        count: Math.max(0, Number(renderPassMetrics?.labelCount || 0)),
      },
      {
        ...EXPORT_TEXT_LAYER_MODEL_BY_ID.get("special-zones"),
        name: "Special zone notes",
        count: specialZoneCount,
      },
      {
        ...EXPORT_TEXT_LAYER_MODEL_BY_ID.get("svg-annotations"),
        name: "Strategic annotations",
        summary: annotationSummary.summary,
        count: annotationSummary.count,
        familyCounts: annotationSummary.counts,
      },
    ].filter((entry) => !!entry?.id);
  };

  const getVisibleExportPreviewSources = (exportUi) => {
    const mainEntries = exportUi.layerOrder
      .map((layerId) => EXPORT_MAIN_LAYER_MODEL_BY_ID.get(layerId))
      .filter((entry) => entry && exportUi.visibility?.[entry.id] !== false)
      .map((entry) => ({ id: entry.id, label: entry.name }));
    const textEntries = getExportTextLayerEntries()
      .filter((entry) => exportUi.textVisibility?.[entry.id] !== false)
      .map((entry) => ({ id: entry.id, label: entry.name }));
    return [...mainEntries, ...textEntries];
  };

  const syncExportSectionSummary = () => {
    const exportUi = getExportUi();
    if (exportSectionSummaryTarget) {
      exportSectionSummaryTarget.textContent =
        exportUi.target === "per-layer"
          ? t("Per-layer PNG", "ui")
          : exportUi.target === "bake-pack"
            ? t("Bake pack (v1.1)", "ui")
            : t("Composite image", "ui");
    }
    if (exportSectionSummaryFormat) {
      exportSectionSummaryFormat.textContent =
        exportUi.target === "per-layer" || exportUi.target === "bake-pack"
          ? "PNG"
          : exportUi.format.toUpperCase();
    }
    if (exportSectionSummaryScale) {
      exportSectionSummaryScale.textContent = getExportScaleLabel(exportUi.scale);
    }
  };

  const renderExportWorkbenchSampleContext = () => {
    const sampleContext = resolveExportWorkbenchSampleContext(state, { t });
    if (!sampleContext) {
      if (exportWorkbenchSampleTitle) exportWorkbenchSampleTitle.textContent = "";
      if (exportWorkbenchSampleRecommendation) exportWorkbenchSampleRecommendation.textContent = "";
      setElementHidden(exportWorkbenchSampleContext, true);
      return null;
    }
    if (exportWorkbenchSampleTitle) {
      exportWorkbenchSampleTitle.textContent = sampleContext.title;
    }
    if (exportWorkbenchSampleRecommendation) {
      exportWorkbenchSampleRecommendation.textContent = sampleContext.recommendation;
    }
    if (exportWorkbenchSampleContext) {
      exportWorkbenchSampleContext.dataset.sampleId = sampleContext.sampleId;
    }
    setElementHidden(exportWorkbenchSampleContext, false);
    return sampleContext;
  };

  const renderExportWorkbenchLayerList = () => {
    if (!exportWorkbenchLayerList) return;
    const exportUi = getExportUi();
    exportWorkbenchLayerList.replaceChildren();
    exportUi.layerOrder.forEach((layerId) => {
      const layer = EXPORT_MAIN_LAYER_MODEL_BY_ID.get(layerId);
      if (!layer) return;

      const item = document.createElement("div");
      item.className = "export-workbench-layer-item";
      item.dataset.exportLayerId = layer.id;
      item.draggable = true;
      item.classList.toggle("is-selected", exportUi.previewLayerId === layer.id);
      item.addEventListener("click", () => {
        setExportPreviewState(state, { layerId: layer.id });
        renderExportWorkbenchUi(true);
      });

      item.addEventListener("dragstart", () => {
        exportWorkbenchDraggedLayerId = layer.id;
        item.classList.add("is-dragging");
      });
      item.addEventListener("dragend", () => {
        exportWorkbenchDraggedLayerId = "";
        item.classList.remove("is-dragging");
      });
      item.addEventListener("dragover", (event) => {
        event.preventDefault();
      });
      item.addEventListener("drop", (event) => {
        event.preventDefault();
        if (!exportWorkbenchDraggedLayerId || exportWorkbenchDraggedLayerId === layer.id) return;
        const nextOrder = [...state.exportWorkbenchUi.layerOrder];
        const draggedIndex = nextOrder.indexOf(exportWorkbenchDraggedLayerId);
        const targetIndex = nextOrder.indexOf(layer.id);
        if (draggedIndex === -1 || targetIndex === -1) return;
        nextOrder.splice(draggedIndex, 1);
        nextOrder.splice(targetIndex, 0, exportWorkbenchDraggedLayerId);
        setExportLayerOrderState(state, normalizeExportWorkbenchLayerOrder(nextOrder));
        renderExportWorkbenchLayerList();
      });

      const handle = document.createElement("span");
      handle.className = "export-workbench-layer-handle";
      handle.textContent = ":::";
      item.appendChild(handle);

      const name = document.createElement("span");
      name.className = "export-workbench-layer-name";
      name.textContent = t(layer.name, "ui");
      item.appendChild(name);

      const controls = document.createElement("div");
      controls.className = "export-workbench-layer-controls";

      const badge = document.createElement("span");
      badge.className = "export-workbench-layer-badge";
      badge.textContent = t(layer.summary || "Visible", "ui");
      controls.appendChild(badge);

      const toggle = document.createElement("label");
      toggle.className = "export-workbench-layer-toggle";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = exportUi.visibility[layer.id] !== false;
      input.addEventListener("click", (event) => event.stopPropagation());
      input.addEventListener("change", () => {
        setExportVisibilityState(state, layer.id, input.checked);
        renderExportWorkbenchUi(true);
      });
      const text = document.createElement("span");
      text.textContent = t("Visible", "ui");
      toggle.append(input, text);
      controls.appendChild(toggle);
      item.appendChild(controls);

      exportWorkbenchLayerList.appendChild(item);
    });
  };

  const renderExportWorkbenchTextElementList = () => {
    if (!exportWorkbenchTextElementList) return;
    const exportUi = getExportUi();
    exportWorkbenchTextElementList.replaceChildren();
    const getTextLayerSummary = (entry) => {
      if (entry.id !== "svg-annotations" || !entry.familyCounts) {
        return t(entry.summary || "", "ui");
      }
      const summary = EXPORT_ANNOTATION_FAMILY_VIEW_MODELS
        .map((family) => {
          const count = entry.familyCounts[family.id] || 0;
          return count ? `${t(family.label, "ui")}: ${count}` : "";
        })
        .filter(Boolean)
        .join(" · ");
      return summary || t("No strategic annotations currently visible", "ui");
    };
    getExportTextLayerEntries().forEach((entry, index) => {
      const item = document.createElement("div");
      item.className = "export-workbench-layer-item";
      item.dataset.exportTextLayerId = entry.id;
      item.classList.toggle("is-selected", exportUi.previewLayerId === entry.id);
      item.addEventListener("click", () => {
        setExportPreviewState(state, { layerId: entry.id });
        renderExportWorkbenchUi(true);
      });

      const order = document.createElement("span");
      order.className = "export-workbench-layer-order";
      order.textContent = `T${index + 1}`;
      item.appendChild(order);

      const name = document.createElement("span");
      name.className = "export-workbench-layer-name";
      name.textContent = t(entry.name, "ui");
      const copy = document.createElement("div");
      copy.className = "export-workbench-layer-copy";
      copy.appendChild(name);
      const meta = document.createElement("span");
      meta.className = "export-workbench-layer-meta";
      meta.textContent = getTextLayerSummary(entry);
      meta.title = meta.textContent;
      copy.appendChild(meta);
      item.appendChild(copy);

      const controls = document.createElement("div");
      controls.className = "export-workbench-layer-controls";

      const badge = document.createElement("span");
      badge.className = "export-workbench-layer-badge";
      badge.textContent = `${entry.count} ${t("nodes", "ui")}`;
      controls.appendChild(badge);

      const toggle = document.createElement("label");
      toggle.className = "export-workbench-layer-toggle";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = exportUi.textVisibility?.[entry.id] !== false;
      input.addEventListener("click", (event) => event.stopPropagation());
      input.addEventListener("change", () => {
        setExportTextVisibilityState(state, entry.id, input.checked);
        renderExportWorkbenchUi(true);
      });
      const text = document.createElement("span");
      text.textContent = t("Visible", "ui");
      toggle.append(input, text);
      controls.append(toggle);
      item.appendChild(controls);

      exportWorkbenchTextElementList.appendChild(item);
    });
  };

  const syncExportPreviewSourceOptions = () => {
    if (!exportWorkbenchPreviewLayerSelect) return;
    const exportUi = getExportUi();
    const entries = getVisibleExportPreviewSources(exportUi);
    exportWorkbenchPreviewLayerSelect.replaceChildren();
    entries.forEach((entry) => {
      const option = document.createElement("option");
      option.value = entry.id;
      option.textContent = t(entry.label, "ui");
      exportWorkbenchPreviewLayerSelect.appendChild(option);
    });
    if (!entries.some((entry) => entry.id === exportUi.previewLayerId)) {
      setExportPreviewState(state, { layerId: entries[0]?.id || "background" });
    }
    exportWorkbenchPreviewLayerSelect.value = getExportUi().previewLayerId;
    exportWorkbenchPreviewLayerSelect.disabled = exportUi.previewMode !== "layer";
  };

  const renderExportWorkbenchBakeArtifactList = () => {
    if (!exportWorkbenchBakeArtifactList) return;
    const exportUi = getExportUi();
    exportWorkbenchBakeArtifactList.replaceChildren();
    EXPORT_BAKE_OUTPUT_MODELS.forEach((model) => {
      const artifact = Array.isArray(exportUi.bakeArtifacts)
        ? exportUi.bakeArtifacts.find((entry) => entry?.layerId === model.id)
        : null;
      const item = document.createElement("div");
      item.className = "export-workbench-bake-item";

      const copy = document.createElement("div");
      copy.className = "export-workbench-bake-copy";
      const title = document.createElement("strong");
      title.className = "export-workbench-bake-title";
      title.textContent = t(model.name, "ui");
      const meta = document.createElement("span");
      meta.className = "export-workbench-bake-meta";
      if (!artifact) {
        meta.textContent = t("Not baked yet", "ui");
      } else {
        meta.textContent = artifact.dirtyFlag
          ? t("Ready to export", "ui")
          : t("Cached", "ui");
      }
      copy.append(title, meta);
      item.appendChild(copy);

      if (artifact?.canvasSize?.width && artifact?.canvasSize?.height) {
        const size = document.createElement("span");
        size.className = "export-workbench-bake-size";
        size.textContent = `${artifact.canvasSize.width}×${artifact.canvasSize.height}`;
        item.appendChild(size);
      }
      exportWorkbenchBakeArtifactList.appendChild(item);
    });
  };

  const renderExportWorkbenchPreview = async () => {
    if (!exportWorkbenchPreviewStage || !exportWorkbenchPreviewState) return;
    const token = ++exportWorkbenchPreviewRenderToken;
    const exportUi = getExportUi();
    exportWorkbenchPreviewState.textContent = t("Rendering export preview…", "ui");
    exportWorkbenchPreviewStage.replaceChildren();
    try {
      const previewSource = exportUi.previewMode === "layer"
        ? await buildSingleExportSourceCanvas(exportUi, exportUi.previewLayerId)
        : await buildCompositeSourceCanvas(exportUi);
      const adjustedPreview = applyExportAdjustmentsToCanvas(previewSource, exportUi);
      if (token !== exportWorkbenchPreviewRenderToken) return;
      adjustedPreview.classList.add("export-workbench-preview-render");
      exportWorkbenchPreviewStage.replaceChildren(adjustedPreview);
      exportWorkbenchPreviewState.textContent = exportUi.previewMode === "layer"
        ? t("Single layer preview ready", "ui")
        : t("Main image preview ready", "ui");
    } catch (error) {
      if (token !== exportWorkbenchPreviewRenderToken) return;
      console.error("[export-workbench] Failed to render preview.", error);
      exportWorkbenchPreviewStage.replaceChildren();
      exportWorkbenchPreviewState.textContent = t("Preview unavailable. Export settings remain editable.", "ui");
    }
  };

  const syncExportWorkbenchControlsFromState = () => {
    const exportUiState = getExportUi();
    if (exportTarget) {
      exportTarget.value = exportUiState.target;
    }
    if (exportFormat) {
      if (exportUiState.target === "per-layer" || exportUiState.target === "bake-pack") {
        exportFormat.value = "png";
        exportFormat.disabled = true;
      } else {
        exportFormat.value = exportUiState.format === "jpg" ? "jpg" : "png";
        exportFormat.disabled = false;
      }
    }
    if (exportScale) {
      exportScale.value = exportUiState.scale;
    }
    if (exportWorkbenchBrightness) {
      exportWorkbenchBrightness.value = String(exportUiState.adjustments.brightness);
    }
    if (exportWorkbenchContrast) {
      exportWorkbenchContrast.value = String(exportUiState.adjustments.contrast);
    }
    if (exportWorkbenchSaturation) {
      exportWorkbenchSaturation.value = String(exportUiState.adjustments.saturation);
    }
    if (exportWorkbenchClarity) {
      exportWorkbenchClarity.value = String(exportUiState.adjustments.clarity);
    }
    if (exportWorkbenchBrightnessValue) {
      exportWorkbenchBrightnessValue.textContent = `${exportUiState.adjustments.brightness}%`;
    }
    if (exportWorkbenchContrastValue) {
      exportWorkbenchContrastValue.textContent = `${exportUiState.adjustments.contrast}%`;
    }
    if (exportWorkbenchSaturationValue) {
      exportWorkbenchSaturationValue.textContent = `${exportUiState.adjustments.saturation}%`;
    }
    if (exportWorkbenchClarityValue) {
      exportWorkbenchClarityValue.textContent = `${exportUiState.adjustments.clarity}%`;
    }
    syncExportSectionSummary();
    return exportUiState;
  };

  const renderExportWorkbenchUi = (isOpen) => {
    if (!exportWorkbenchOverlay) return;
    const exportUi = syncExportWorkbenchControlsFromState();
    exportWorkbenchOverlay.classList.toggle("hidden", !isOpen);
    exportWorkbenchOverlay.setAttribute("aria-hidden", isOpen ? "false" : "true");
    dockExportBtn?.classList.toggle("is-active", isOpen);
    dockExportBtn?.setAttribute("aria-expanded", isOpen ? "true" : "false");
    renderExportWorkbenchSampleContext();
    renderExportWorkbenchLayerList();
    renderExportWorkbenchTextElementList();
    renderExportWorkbenchBakeArtifactList();
    syncExportPreviewSourceOptions();
    exportWorkbenchPreviewModeButtons.forEach((button) => {
      const isActive = String(button.dataset.exportPreviewMode || "main") === exportUi.previewMode;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
    if (exportBtn) {
      const buttonLabel = exportUi.target === "bake-pack"
        ? t("Download Bake Pack", "ui")
        : exportUi.target === "per-layer"
          ? t("Download Layers", "ui")
          : t("Download Snapshot", "ui");
      exportBtn.dataset.i18n = exportUi.target === "bake-pack"
        ? "Download Bake Pack"
        : exportUi.target === "per-layer"
          ? "Download Layers"
          : "Download Snapshot";
      exportBtn.textContent = buttonLabel;
    }
    if (!isOpen) {
      exportWorkbenchPreviewRenderToken += 1;
      exportWorkbenchPreviewStage?.replaceChildren();
      return;
    }
    void renderExportWorkbenchPreview();
  };

  const handleExportAction = async () => {
    if (exportJobsInFlight >= exportMaxConcurrentJobs) {
      showToast(
        t("An export is already in progress. Wait for it to finish before starting another export.", "ui"),
        { title: t("Export queue is full", "ui"), tone: "warning", duration: 4200 }
      );
      return;
    }
    exportJobsInFlight += 1;
    try {
      let exportUi = syncExportWorkbenchControlsFromState();
      const scaleMultiplier = getSelectedExportScale();
      setExportOutputState(state, { scale: String(scaleMultiplier) });
      exportUi = getExportUi();
      const extension = exportUi.target === "per-layer" || exportUi.target === "bake-pack"
        ? "png"
        : (exportUi.format === "jpg" ? "jpg" : "png");
      if (exportUi.target === "composite") {
        setExportOutputState(state, { format: extension });
        exportUi = getExportUi();
      }
      const exportTargetKind = exportUi.target;
      if (exportTargetKind === "per-layer") {
        const layerPackage = await buildPerLayerExportPackage(exportUi, scaleMultiplier);
        triggerBlobDownload(layerPackage.blob, layerPackage.extension, layerPackage.fileStem);
        showToast(t("Layer package downloaded.", "ui"), {
          title: t("Layer package exported", "ui"),
          tone: "success",
        });
      } else if (exportTargetKind === "bake-pack") {
        const bakePackage = await buildBakePackPackage(exportUi, scaleMultiplier);
        triggerBlobDownload(bakePackage.blob, bakePackage.extension, bakePackage.fileStem);
        renderExportWorkbenchUi(true);
        showToast(t("Bake package downloaded.", "ui"), {
          title: t("Bake pack exported", "ui"),
          tone: "success",
        });
      } else {
        const exportCanvas = await buildCompositeExportCanvas(exportUi, scaleMultiplier);
        triggerCanvasDownload(exportCanvas, extension, "map_snapshot");
        showToast(t("Map snapshot downloaded.", "ui"), {
          title: t("Snapshot exported", "ui"),
          tone: "success",
        });
      }
    } catch (error) {
      console.error("Snapshot export failed:", error);
      showExportFailureToast(error);
    } finally {
      exportJobsInFlight = Math.max(0, exportJobsInFlight - 1);
    }
  };

  const bindExportWorkbenchEvents = () => {
    if (exportWorkbenchCloseBtn && !exportWorkbenchCloseBtn.dataset.bound) {
      exportWorkbenchCloseBtn.addEventListener("click", () => {
        onRequestClose?.({ restoreFocus: true });
      });
      exportWorkbenchCloseBtn.dataset.bound = "true";
    }

    exportWorkbenchPreviewModeButtons.forEach((button) => {
      if (!button || button.dataset.bound === "true") return;
      button.addEventListener("click", () => {
        setExportPreviewState(state, {
          mode: String(button.dataset.exportPreviewMode || "main") === "layer" ? "layer" : "main",
        });
        renderExportWorkbenchUi(true);
      });
      button.dataset.bound = "true";
    });

    if (exportWorkbenchPreviewLayerSelect && !exportWorkbenchPreviewLayerSelect.dataset.bound) {
      exportWorkbenchPreviewLayerSelect.addEventListener("change", () => {
        const exportUi = getExportUi();
        setExportPreviewState(state, {
          layerId: String(exportWorkbenchPreviewLayerSelect.value || "").trim() || exportUi.previewLayerId,
        });
        renderExportWorkbenchUi(true);
      });
      exportWorkbenchPreviewLayerSelect.dataset.bound = "true";
    }

    if (exportTarget && !exportTarget.dataset.bound) {
      exportTarget.addEventListener("change", () => {
        const nextTarget = String(exportTarget.value || "").trim().toLowerCase();
        setExportOutputState(state, {
          target: ["composite", "per-layer", "bake-pack"].includes(nextTarget)
            ? nextTarget
            : "composite",
        });
        renderExportWorkbenchUi(true);
      });
      exportTarget.dataset.bound = "true";
    }

    if (exportFormat && !exportFormat.dataset.bound) {
      exportFormat.addEventListener("change", () => {
        setExportOutputState(state, {
          format: exportFormat.value === "jpg" ? "jpg" : "png",
        });
        renderExportWorkbenchUi(true);
      });
      exportFormat.dataset.bound = "true";
    }

    if (exportScale && !exportScale.dataset.bound) {
      exportScale.addEventListener("change", () => {
        const normalizedScale = ["1", "1.5", "2", "4"].includes(String(exportScale.value || "").trim())
          ? String(exportScale.value || "").trim()
          : "2";
        exportScale.value = normalizedScale;
        setExportOutputState(state, { scale: normalizedScale });
        renderExportWorkbenchUi(true);
      });
      exportScale.dataset.bound = "true";
    }

    [
      [exportWorkbenchBrightness, "brightness"],
      [exportWorkbenchContrast, "contrast"],
      [exportWorkbenchSaturation, "saturation"],
      [exportWorkbenchClarity, "clarity"],
    ].forEach(([input, key]) => {
      if (!(input instanceof HTMLInputElement) || input.dataset.bound === "true") return;
      input.addEventListener("input", () => {
        setExportAdjustmentsState(state, {
          [key]: Math.max(0, Math.min(200, Math.round(Number(input.value) || 100))),
        });
        renderExportWorkbenchUi(true);
      });
      input.dataset.bound = "true";
    });

    if (exportWorkbenchBakeVisibleBtn && !exportWorkbenchBakeVisibleBtn.dataset.bound) {
      exportWorkbenchBakeVisibleBtn.addEventListener("click", async () => {
        const exportUi = getExportUi();
        try {
          for (const layerId of getBakePackLayerIds(exportUi)) {
            await bakeLayer(layerId);
          }
          renderExportWorkbenchUi(true);
          showToast(t("Bake outputs updated.", "ui"), {
            title: t("Bake ready", "ui"),
            tone: "success",
          });
        } catch (error) {
          console.error("[export-workbench] Bake failed.", error);
          showExportFailureToast(error);
        }
      });
      exportWorkbenchBakeVisibleBtn.dataset.bound = "true";
    }

    if (exportWorkbenchClearBakeBtn && !exportWorkbenchClearBakeBtn.dataset.bound) {
      exportWorkbenchClearBakeBtn.addEventListener("click", () => {
        setExportBakeState(state, { bakeCache: new Map(), bakeArtifacts: [] });
        renderExportWorkbenchUi(true);
        showToast(t("Cleared baked cache.", "ui"), {
          title: t("Bake cache cleared", "ui"),
          tone: "success",
        });
      });
      exportWorkbenchClearBakeBtn.dataset.bound = "true";
    }

    if (exportBtn && !exportBtn.dataset.bound) {
      exportBtn.addEventListener("click", async () => {
        await handleExportAction();
      });
      exportBtn.dataset.bound = "true";
    }
  };

  return {
    bindExportWorkbenchEvents,
    ensureExportWorkbenchUiState: getExportUi,
    renderExportWorkbenchBakeArtifactList,
    renderExportWorkbenchLayerList,
    renderExportWorkbenchPreview,
    renderExportWorkbenchSampleContext,
    renderExportWorkbenchTextElementList,
    renderExportWorkbenchUi,
    resolveExportPassSequence: (exportWorkbenchUi) => resolveExportPassSequence(exportWorkbenchUi, renderPassNames),
    syncExportPreviewSourceOptions,
    syncExportWorkbenchControlsFromState,
  };
}

export {
  EXPORT_BAKE_OUTPUT_MODELS,
  EXPORT_MAIN_LAYER_IDS,
  EXPORT_MAIN_LAYER_MODEL_BY_ID,
  EXPORT_TEXT_LAYER_IDS,
  EXPORT_TEXT_LAYER_MODEL_BY_ID,
  getExportAnnotationCountSummary,
  getExportAnnotationFamilyCounts,
  createExportWorkbenchController,
  ensureExportWorkbenchUiState,
  normalizeExportWorkbenchLayerOrder,
  normalizeExportWorkbenchTextVisibility,
  normalizeExportWorkbenchVisibility,
  resolveExportWorkbenchSampleContext,
  resolveExportPassSequence,
};
