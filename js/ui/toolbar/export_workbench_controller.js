// Export workbench controller.
// 这个模块负责 export workbench 的状态归一、列表渲染、预览、导出动作和面板内部事件绑定。
// toolbar.js 继续保留 overlay 外壳、跨面板仲裁、URL/focus 协调和 open/close facade。

import { getExportScaleInfo, getBakePackLayerIds, getBakePassNamesForLayer, encodeExportCanvas } from "./export_artifact_model.js";
import { createExportError } from "./export_failure_handler.js";
import { resolveSampleExportRecommendationContext } from "../../core/sample_export_recommendation.js";
import { getPoliticalExportLegend, hasMapTitles } from "../../core/map_renderer/public.js";
import { captureHistoryState, pushHistoryEntry } from "../../core/history_manager.js";
import { markDirty } from "../../core/dirty_state.js";
import { requestRender } from "../../core/render_boundary.js";
import { registerRuntimeHook } from "../../core/state/index.js";
import {
  ensureExportWorkbenchUiState as ensureExportWorkbenchUiAction,
  commitExportWorkbenchUiState,
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
  Object.freeze({ id: "political", name: "Political", summary: "Terrain + ownership", passNames: ["physicalBase", "political", "populationHeatmap"] }),
  Object.freeze({ id: "context", name: "Context", summary: "Scenario overlays", passNames: ["contextBase", "contextScenario"] }),
  Object.freeze({ id: "effects", name: "Effects", summary: "Borders + overlays", passNames: ["effects", "lineEffects", "contextMarkers", "dayNight", "borders", "textureLabels"] }),
  Object.freeze({ id: "labels", name: "Labels", summary: "Render-pass labels", passNames: ["labels"] }),
]);
const EXPORT_MAIN_LAYER_IDS = Object.freeze(EXPORT_MAIN_LAYER_VIEW_MODELS.map((layer) => layer.id));
const EXPORT_MAIN_LAYER_MODEL_BY_ID = new Map(EXPORT_MAIN_LAYER_VIEW_MODELS.map((layer) => [layer.id, layer]));
const EXPORT_TEXT_LAYER_VIEW_MODELS = Object.freeze([
  Object.freeze({ id: "render-labels", name: "Render-pass labels", summary: "City and map labels from the labels pass" }),
  Object.freeze({ id: "special-zones", name: "Special zones", summary: "Layer-based special zone fills, patterns, and outlines" }),
  Object.freeze({ id: "svg-annotations", name: "SVG annotations", summary: "Operational lines, graphics, counters, and other SVG overlays" }),
  Object.freeze({ id: "legend", name: "Legend" }),
]);
const EXPORT_TEXT_LAYER_IDS = Object.freeze(EXPORT_TEXT_LAYER_VIEW_MODELS.map((layer) => layer.id));
const EXPORT_TEXT_LAYER_MODEL_BY_ID = new Map(EXPORT_TEXT_LAYER_VIEW_MODELS.map((layer) => [layer.id, layer]));
const EXPORT_ANNOTATION_FAMILY_VIEW_MODELS = Object.freeze([
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

function normalizeExportWorkbenchTextVisibility(value, includeTextLayer = true, legendVisible = true) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(
    EXPORT_TEXT_LAYER_IDS.map((layerId) => [
      layerId,
      source[layerId] === undefined ? (layerId === "legend" ? legendVisible : !!includeTextLayer) : source[layerId] !== false,
    ])
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
  const ui = ensureExportWorkbenchUiAction(state, {
    normalizeState: normalizeExportWorkbenchUiState,
  });
  ui.textVisibility = normalizeExportWorkbenchTextVisibility(ui.textVisibility, ui.includeTextLayer, state.legendControl?.visible !== false);
  ui.includeTextLayer = Object.values(ui.textVisibility).some(Boolean) || hasMapTitles(ui.mapTitles);
  return ui;
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

// A preview source is reusable only while the exact rendered inputs stay valid.
// Adjustments and download scale/format are deliberately absent: they do not
// change the unfiltered, screen-resolution source. Never cache an unsettled pass.
function getExportPreviewSourceKey(state, exportUi, renderPassNames, svgMarkup = "") {
  const cache = state.renderPassCache;
  const sourceId = exportUi.previewMode === "layer" ? exportUi.previewLayerId : "main";
  const passes = sourceId === "main"
    ? resolveExportPassSequence(exportUi, renderPassNames)
      .filter((name) => exportUi.textVisibility?.["render-labels"] || name !== "labels")
    : sourceId === "render-labels"
      ? ["labels"]
      : EXPORT_MAIN_LAYER_MODEL_BY_ID.get(sourceId)?.passNames || [];
  if (!cache || state.scenarioApplyInFlight || state.dynamicBordersDirty
    || state.runtimeChunkLoadState?.pendingPromotion || state.runtimeChunkLoadState?.promotionCommitInFlight
    || (state.renderPhase && state.renderPhase !== "idle")
    || passes.some((name) => cache.dirty?.[name] !== false || !cache.signatures?.[name])) {
    return null;
  }
  const transform = state.zoomTransform || {};
  return JSON.stringify([
    sourceId,
    exportUi.layerOrder,
    exportUi.visibility,
    exportUi.textVisibility,
    exportUi.mapTitles,
    state.activeScenarioId,
    state.renderTransactionDiagnostics?.scenarioApplyEpoch,
    state.sceneGeneration,
    state.scenarioDataGeneration,
    state.topologyRevision,
    state.colorRevision,
    state.dirtyRevision,
    state.width, state.height, state.dpr,
    state.colorCanvas?.width, state.colorCanvas?.height,
    transform.k, transform.x, transform.y,
    state.styleConfig,
    exportUi.textVisibility?.legend && (sourceId === "main" || sourceId === "legend") ? getPoliticalExportLegend(state) : null,
    passes.map((name) => [name, cache.signatures[name], cache.referenceTransforms?.[name]]),
    svgMarkup,
  ]);
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
  isExportRenderOverBudget = () => false,
  exportCopyBtn, exportJobStatus, quickReexportBtn, transparentBackground, jpegHint, openSettings,
  triggerCanvasDownload,
  triggerBlobDownload,
  bakeLayer,
  clearBakeCache,
  exportMaxConcurrentJobs = 1,
  requestPreviewFrame = (callback) => globalThis.requestAnimationFrame(callback),
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
  assertRequiredCallableDependency(clearBakeCache, "clearBakeCache");

  let exportWorkbenchDraggedLayerId = "";
  let exportWorkbenchPreviewRenderToken = 0;
  let previewSession = 0;
  let pendingPreview = null;
  let previewWork = null;
  let previewSourceCache = null;
  let exportJobsInFlight = 0;

  const getExportUi = () => ensureExportWorkbenchUiState(state, normalizeExportWorkbenchUiState);

  const getScaleInfo = (ui, scale, target = ui.target) => {
    const visiblePasses = resolveExportPassSequence(ui, renderPassNames)
      .filter(name => name !== "labels" || ui.textVisibility["render-labels"]);
    let groups = [visiblePasses];
    if (target === "per-layer") {
      groups = ui.layerOrder.filter(id => ui.visibility[id] && (id !== "labels" || ui.textVisibility["render-labels"]))
        .map(id => EXPORT_MAIN_LAYER_MODEL_BY_ID.get(id).passNames);
    } else if (target === "bake-pack") {
      groups = getBakePackLayerIds(ui).map(id => getBakePassNamesForLayer(id, ui, {
        resolvePassSequence: resolveExportPassSequence, renderPassNames,
      }));
    }
    return getExportScaleInfo(state, scale, groups, isExportRenderOverBudget, target === "bake-pack" ? null : Number(scale));
  };

  const scaleLabel = (scale, { width, height, reason }) => {
    const parts = [`${scale}×`, `${width}×${height}`];
    if (Number(scale) === 1 && Number(state.dpr) > 1) parts.push(t("Below screen resolution", "ui"));
    if (reason) parts.push(t(reason, "ui"));
    return parts.join(" · ");
  };

  const getExportTextLayerEntries = () => {
    const mapSvg = document.getElementById("map-svg");
    const annotationSummary = getExportAnnotationCountSummary(mapSvg);
    return [
      {
        ...EXPORT_TEXT_LAYER_MODEL_BY_ID.get("render-labels"),
        name: "Map labels",
        summary: "City and map labels from the labels pass",
      },
      {
        ...EXPORT_TEXT_LAYER_MODEL_BY_ID.get("special-zones"),
        name: "Special zone notes",
      },
      {
        ...EXPORT_TEXT_LAYER_MODEL_BY_ID.get("svg-annotations"),
        name: "Strategic annotations",
        summary: annotationSummary.summary,
        familyCounts: annotationSummary.counts,
      },
      EXPORT_TEXT_LAYER_MODEL_BY_ID.get("legend"),
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
    const selected = getScaleInfo(exportUi, exportUi.scale);
    if (exportSectionSummaryScale) exportSectionSummaryScale.textContent = scaleLabel(exportUi.scale, selected);
    for (const option of exportScale?.options || []) {
      const info = getScaleInfo(exportUi, option.value);
      option.textContent = scaleLabel(option.value, info);
      option.disabled = !!info.reason;
    }
    const busy = exportJobsInFlight > 0;
    if (exportBtn) {
      exportBtn.disabled = busy || !!selected.reason;
      exportBtn.setAttribute("aria-busy", String(busy));
      const label = busy ? "Exporting…" : exportUi.target === "bake-pack" ? "Download Bake Pack"
        : exportUi.target === "per-layer" ? "Download Layers" : "Download Snapshot";
      exportBtn.dataset.i18n = label;
      exportBtn.textContent = t(label, "ui");
    }
    if (quickReexportBtn) quickReexportBtn.disabled = busy || !!selected.reason;
    if (exportCopyBtn) {
      const supported = !!globalThis.ClipboardItem && !!globalThis.navigator?.clipboard?.write;
      const reason = supported ? getScaleInfo(exportUi, exportUi.scale, "composite").reason : "Image clipboard unavailable";
      exportCopyBtn.disabled = busy || !!reason;
      exportCopyBtn.title = reason ? t(reason, "ui") : "";
    }
    const jpg = exportUi.target === "composite" && exportUi.format === "jpg";
    if (transparentBackground) {
      transparentBackground.checked = !jpg && !exportUi.visibility.background;
      transparentBackground.disabled = jpg;
    }
    if (jpegHint) jpegHint.hidden = !jpg;
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
    getExportTextLayerEntries().forEach((entry) => {
      const item = document.createElement("div");
      item.className = "export-workbench-layer-item";
      item.dataset.exportTextLayerId = entry.id;
      item.classList.toggle("is-selected", exportUi.previewLayerId === entry.id);
      item.addEventListener("click", () => {
        setExportPreviewState(state, { layerId: entry.id });
        renderExportWorkbenchUi(true);
      });

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
    const bakeShell = exportWorkbenchBakeArtifactList.closest(".export-workbench-bake-shell");
    bakeShell.hidden = exportUi.target !== "bake-pack";
    if (bakeShell.hidden) return;
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

  const getPreviewSourceKey = (exportUi) => {
    const usesSvg = exportUi.previewMode === "layer"
      ? exportUi.previewLayerId === "svg-annotations" || exportUi.previewLayerId === "special-zones"
      : exportUi.textVisibility?.["svg-annotations"] || exportUi.textVisibility?.["special-zones"];
    // Raster-only previews neither render SVG nor need its serialized identity.
    const svgMarkup = usesSvg ? document.getElementById("map-svg")?.outerHTML || "" : "";
    return getExportPreviewSourceKey(state, exportUi, renderPassNames, svgMarkup);
  };

  const drainPreviewRequests = async () => {
    while (pendingPreview) {
      // Collapse slider events before drawing, and keep at most one source build
      // in flight. A newer request replaces the pending one, not an active job.
      await new Promise((resolve) => requestPreviewFrame(resolve));
      const request = pendingPreview;
      pendingPreview = null;
      if (!request) continue;
      const { token, exportUi, session } = request;
      try {
        const sourceKey = getPreviewSourceKey(exportUi);
        let previewSource = sourceKey && previewSourceCache?.key === sourceKey
          ? previewSourceCache.canvas
          : null;
        if (!previewSource) {
          previewSourceCache = null;
          previewSource = exportUi.previewMode === "layer"
            ? await buildSingleExportSourceCanvas(exportUi, exportUi.previewLayerId)
            : await buildCompositeSourceCanvas(exportUi);
          // Detail preparation or scene updates can change the inputs while the
          // source is building. Such a result must not populate the cache.
          if (session === previewSession && sourceKey && sourceKey === getPreviewSourceKey(exportUi)) {
            previewSourceCache = { key: sourceKey, canvas: previewSource };
          }
        }
        if (token !== exportWorkbenchPreviewRenderToken) continue;
        const adjustedPreview = applyExportAdjustmentsToCanvas(previewSource, exportUi);
        adjustedPreview.classList.add("export-workbench-preview-render");
        exportWorkbenchPreviewStage.replaceChildren(adjustedPreview);
        exportWorkbenchPreviewState.textContent = "";
        exportWorkbenchPreviewState.hidden = true;
      } catch (error) {
        if (token !== exportWorkbenchPreviewRenderToken) continue;
        console.error("[export-workbench] Failed to render preview.", error);
        exportWorkbenchPreviewStage.replaceChildren();
        exportWorkbenchPreviewState.hidden = exportJobsInFlight > 0;
        exportWorkbenchPreviewState.textContent = t("Preview unavailable. Export settings remain editable.", "ui");
      }
    }
  };

  const startPreviewWork = () => {
    if (!previewWork) {
      previewWork = drainPreviewRequests().finally(() => {
        previewWork = null;
        if (pendingPreview) return startPreviewWork();
      });
    }
    return previewWork;
  };

  const renderExportWorkbenchPreview = async () => {
    if (!exportWorkbenchPreviewStage || !exportWorkbenchPreviewState) return;
    pendingPreview = {
      token: ++exportWorkbenchPreviewRenderToken,
      exportUi: getExportUi(),
      session: previewSession,
    };
    exportWorkbenchPreviewState.hidden = exportJobsInFlight > 0;
    exportWorkbenchPreviewState.textContent = t("Rendering export preview…", "ui");
    return startPreviewWork();
  };

  const syncMapTitleFields = (ui) => {
    const document = exportWorkbenchOverlay?.ownerDocument;
    const host = document?.getElementById("exportMapTitleFields");
    if (!host) return;
    const template = document.getElementById("exportMapTitleField");
    const labels = { title: "Map title", subtitle: "Subtitle", attribution: "Attribution" };
    for (const [key, label] of Object.entries(labels)) {
      let field = host.querySelector(`[data-title-field="${key}"]`);
      if (!field) {
        field = template.content.firstElementChild.cloneNode(true);
        field.dataset.titleField = key;
        const edit = (patch) => {
          const current = getExportUi();
          const before = captureHistoryState({ mapTitles: true });
          Object.assign(current.mapTitles[key], patch);
          const updated = commitExportWorkbenchUiState(state, current);
          const after = captureHistoryState({ mapTitles: true });
          if (!pushHistoryEntry({ kind: "map-title", before, after })) return;
          markDirty("map-title");
          requestRender("map-title");
          syncMapTitleFields(updated);
          void renderExportWorkbenchPreview();
        };
        field.addEventListener("change", ({ target }) => {
          edit({ [target.name]: target.type === "checkbox" ? target.checked : target.value });
        });
        if (key === "title") {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "btn-secondary";
          button.dataset.i18n = "Use project name";
          button.addEventListener("click", () => edit({ enabled: true, text: state.projectName }));
          field.append(button);
        }
        host.append(field);
      }
      field.querySelector("legend").textContent = t(label, "ui");
      for (const node of field.querySelectorAll("[data-i18n]")) node.textContent = t(node.dataset.i18n, "ui");
      for (const control of field.querySelectorAll("[name]")) {
        if (control.type === "checkbox") control.checked = ui.mapTitles[key].enabled;
        else control.value = ui.mapTitles[key][control.name];
      }
      const button = field.querySelector("button");
      if (button) button.disabled = !state.projectName;
    }
  };

  const syncExportWorkbenchControlsFromState = () => {
    const exportUiState = getExportUi();
    syncMapTitleFields(exportUiState);
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

  const renderExportWorkbenchContents = (isOpen) => {
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
    if (!isOpen) {
      exportWorkbenchPreviewRenderToken += 1;
      previewSession += 1;
      pendingPreview = null;
      previewSourceCache = null;
      exportWorkbenchPreviewStage?.replaceChildren();
      return;
    }
    void renderExportWorkbenchPreview();
  };

  let openRenderToken = 0;
  const renderExportWorkbenchUi = (isOpen) => {
    if (!exportWorkbenchOverlay) return;
    const token = ++openRenderToken;
    exportWorkbenchOverlay.classList.toggle("hidden", !isOpen);
    exportWorkbenchOverlay.setAttribute("aria-hidden", isOpen ? "false" : "true");
    dockExportBtn?.classList.toggle("is-active", isOpen);
    dockExportBtn?.setAttribute("aria-expanded", String(isOpen));
    if (!isOpen) {
      renderExportWorkbenchContents(false);
      return;
    }
    exportWorkbenchPreviewState.hidden = exportJobsInFlight > 0;
    exportWorkbenchPreviewState.textContent = t("Preparing preview…", "ui");
    requestPreviewFrame(() => requestPreviewFrame(() => {
      if (token === openRenderToken) renderExportWorkbenchContents(true);
    }));
  };

  const handleExportAction = async ({ copy = false } = {}) => {
    if (exportJobsInFlight >= exportMaxConcurrentJobs) return;
    const ui = getExportUi();
    const scale = Number(ui.scale);
    const target = copy ? "composite" : ui.target;
    const { reason } = getScaleInfo(ui, scale, target);
    if (reason) {
      showToast(t(reason, "ui"), { tone: "warning" });
      return;
    }
    const stage = key => {
      if (exportJobStatus) exportJobStatus.textContent = t(key, "ui");
    };
    exportJobsInFlight++;
    syncExportSectionSummary();
    if (exportJobStatus) exportJobStatus.hidden = false;
    if (exportWorkbenchPreviewState) exportWorkbenchPreviewState.hidden = true;
    stage("Preparing export data…");
    const showStage = async key => {
      stage(key);
      if (exportWorkbenchOverlay && !exportWorkbenchOverlay.classList.contains("hidden")) {
        await new Promise(resolve => requestPreviewFrame(() => setTimeout(resolve, 0)));
      }
    };
    const rendering = () => showStage("Rendering map…");
    const encoding = () => showStage("Encoding image…");
    try {
      let message, title;
      if (target === "composite") {
        const canvas = buildCompositeExportCanvas(ui, scale, rendering);
        if (copy) {
          const png = canvas.then(async image => {
            await encoding();
            return encodeExportCanvas(image, "image/png");
          });
          const [image, clipboard] = await Promise.allSettled([
            png, navigator.clipboard.write([new ClipboardItem({ "image/png": png })]),
          ]);
          if (image.status === "rejected") throw image.reason;
          if (clipboard.status === "rejected") throw createExportError("clipboard-failed", "Clipboard write failed.");
          message = "Image copied. Paste it into a chat.";
        } else {
          const image = await canvas;
          await encoding();
          await triggerCanvasDownload(image, ui.format, "map_snapshot");
          title = "Snapshot exported";
          message = "Map snapshot downloaded.";
        }
      } else {
        const bake = target === "bake-pack";
        await rendering();
        const bundle = await (bake ? buildBakePackPackage : buildPerLayerExportPackage)(ui, scale, encoding);
        triggerBlobDownload(bundle.blob, bundle.extension, bundle.fileStem);
        if (bake && exportWorkbenchOverlay && !exportWorkbenchOverlay.classList.contains("hidden")) renderExportWorkbenchBakeArtifactList();
        title = bake ? "Bake pack exported" : "Layer package exported";
        message = bake ? "Bake package downloaded." : "Layer package downloaded.";
      }
      showToast(t(message, "ui"), { title: title ? t(title, "ui") : "", tone: "success", actionLabel: t("Adjust settings", "ui"), onAction: openSettings });
    } catch (error) {
      showExportFailureToast(error);
    } finally {
      exportJobsInFlight--;
      if (exportJobStatus) exportJobStatus.hidden = true;
      if (exportWorkbenchPreviewState) exportWorkbenchPreviewState.hidden = exportJobsInFlight > 0 || !exportWorkbenchPreviewState.textContent;
      syncExportSectionSummary();
    }
  };

  const bindExportWorkbenchEvents = () => {
    registerRuntimeHook(state, "refreshExportMapTitlesFn", () => {
      if (exportWorkbenchOverlay?.getAttribute("aria-hidden") !== "false") return;
      syncMapTitleFields(getExportUi());
      void renderExportWorkbenchPreview();
    });
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
      [exportWorkbenchBrightness, "brightness", exportWorkbenchBrightnessValue],
      [exportWorkbenchContrast, "contrast", exportWorkbenchContrastValue],
      [exportWorkbenchSaturation, "saturation", exportWorkbenchSaturationValue],
      [exportWorkbenchClarity, "clarity", exportWorkbenchClarityValue],
    ].forEach(([input, key, valueLabel]) => {
      if (!(input instanceof HTMLInputElement) || input.dataset.bound === "true") return;
      input.addEventListener("input", () => {
        const adjustment = Number(input.value);
        const nextValue = Number.isFinite(adjustment)
          ? Math.max(0, Math.min(200, Math.round(adjustment)))
          : 100;
        setExportAdjustmentsState(state, { [key]: nextValue });
        // 整体刷新推迟两帧且连续拖动时会被下一次输入取消；数值标签在这里立即跟随。
        if (valueLabel) valueLabel.textContent = `${nextValue}%`;
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
        clearBakeCache();
        setExportBakeState(state, { bakeArtifacts: [] });
        renderExportWorkbenchUi(true);
        showToast(t("Cleared baked cache.", "ui"), {
          title: t("Bake cache cleared", "ui"),
          tone: "success",
        });
      });
      exportWorkbenchClearBakeBtn.dataset.bound = "true";
    }

    if (transparentBackground && !transparentBackground.dataset.bound) {
      transparentBackground.addEventListener("change", () => {
        setExportVisibilityState(state, "background", !transparentBackground.checked);
        renderExportWorkbenchUi(true);
      });
      transparentBackground.dataset.bound = "true";
    }
    for (const button of [quickReexportBtn, exportCopyBtn]) {
      if (!button || button.dataset.bound) continue;
      button.addEventListener("click", () => handleExportAction({ copy: button === exportCopyBtn }));
      button.dataset.bound = "true";
    }
    if (exportBtn && !exportBtn.dataset.bound) {
      exportBtn.addEventListener("click", async () => {
        await handleExportAction();
      });
      globalThis.window?.addEventListener("resize", () => requestPreviewFrame(syncExportSectionSummary));
      exportBtn.dataset.bound = "true";
    }
  };

  return {
    bindExportWorkbenchEvents,
    handleExportAction,
    ensureExportWorkbenchUiState: getExportUi,
    renderExportWorkbenchBakeArtifactList,
    renderExportWorkbenchLayerList,
    renderExportWorkbenchPreview,
    renderExportWorkbenchSampleContext,
    renderExportWorkbenchTextElementList,
    renderExportWorkbenchUi,
    resolveExportPassSequence: (exportWorkbenchUi) => resolveExportPassSequence(exportWorkbenchUi, renderPassNames),
    setExportBakeArtifacts: (bakeArtifacts) => setExportBakeState(state, { bakeArtifacts }),
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
  getExportPreviewSourceKey,
  ensureExportWorkbenchUiState,
  normalizeExportWorkbenchLayerOrder,
  normalizeExportWorkbenchTextVisibility,
  normalizeExportWorkbenchVisibility,
  resolveExportWorkbenchSampleContext,
  resolveExportPassSequence,
};
