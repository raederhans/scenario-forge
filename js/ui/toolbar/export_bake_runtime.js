import { drawThematicWgiExportLegend } from "../../core/renderer/thematic_wgi_export_legend.js";
import { drawPopulationExportLegend } from "../../core/renderer/population_export_legend.js";
import { ensurePopulationData } from "../../core/population_spatial_runtime.js";
import { isPopulationActive, getPopulationSignature, getPopulationViewModel } from "../../core/population_spatial_view_model.js";
import { ensureThematicWgiData } from "../../core/thematic_wgi_runtime.js";
import { isThematicWgiRequested, isThematicWgiActive, getThematicWgiSignature } from "../../core/thematic_wgi_view_model.js";
import { setExportBakeState } from "../../core/state/actions/export_workbench_actions.js";
import { createExportError } from "./export_failure_handler.js";
import {
  EXPORT_MAX_DIMENSION_PX,
  EXPORT_MAX_PIXELS,
  buildExportAdjustmentFilter,
  buildPerLayerExportPlan,
  getBakePassNamesForLayer,
  resolveExportBaseDimensions,
} from "./export_artifact_model.js";
import {
  EXPORT_MAIN_LAYER_IDS,
  EXPORT_MAIN_LAYER_MODEL_BY_ID,
  EXPORT_TEXT_LAYER_IDS,
  resolveExportPassSequence,
} from "./export_workbench_controller.js";

export function createExportBakeRuntime({
  state: runtimeState,
  document,
  ensureExportWorkbenchUiState,
  renderPassNames: RENDER_PASS_NAMES,
  renderExportPassesToCanvas,
  assertPopulationHeatmapReadyForExport,
  ensurePopulationHeatmapReadyForExport,
  ensurePaintContoursReady,
  ensureBathymetryReadyForExport,
  ensureCountryLabelsReadyForExport,
  ensureScenarioPoliticalDetailForExport,
}) {
  const exportBakeCache = new Map();
  const clearExportBakeCache = () => exportBakeCache.clear();

  const getExportBakeVisibilitySignature = (exportUi) => {
    const main = EXPORT_MAIN_LAYER_IDS
      .map((layerId) => `${layerId}:${exportUi?.visibility?.[layerId] === false ? "0" : "1"}`)
      .join("|");
    const text = EXPORT_TEXT_LAYER_IDS
      .map((layerId) => `${layerId}:${exportUi?.textVisibility?.[layerId] === false ? "0" : "1"}`)
      .join("|");
    return `main=${main};text=${text}`;
  };

  const computeBakeHash = (parts) => {
    const source = Array.isArray(parts) ? parts.join("|") : String(parts || "");
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `fnv1a_${(hash >>> 0).toString(16).padStart(8, "0")}`;
  };

  const getLayerDependencyRevision = (layerId, exportUi = ensureExportWorkbenchUiState()) => {
    const mapSvg = document.getElementById("map-svg");
    const mapSvgChildCount = mapSvg ? mapSvg.childElementCount : 0;
    const renderPassCache = runtimeState.renderPassCache && typeof runtimeState.renderPassCache === "object"
      ? runtimeState.renderPassCache
      : {};
    const signatures = renderPassCache.signatures && typeof renderPassCache.signatures === "object"
      ? renderPassCache.signatures
      : {};
    const dirtyRevision = Number(runtimeState.dirtyRevision || 0);
    const thematicDependencies = [
      `thematic:${getThematicWgiSignature(runtimeState)}`,
      `population:${getPopulationSignature(runtimeState)}`,
      `thematicLanguage:${runtimeState.currentLanguage || "en"}`,
    ];
    const zoomTransform = runtimeState.zoomTransform && typeof runtimeState.zoomTransform === "object"
      ? runtimeState.zoomTransform
      : { k: 1, x: 0, y: 0 };
    const transformSignature = [
      `zoomK:${Number(zoomTransform.k || 1).toFixed(5)}`,
      `zoomX:${Number(zoomTransform.x || 0).toFixed(2)}`,
      `zoomY:${Number(zoomTransform.y || 0).toFixed(2)}`,
    ];
    if (layerId === "color") {
      return [
        ...thematicDependencies,
        getExportBakeVisibilitySignature(exportUi),
        `colorRevision:${Number(runtimeState.colorRevision) || 0}`,
        `topologyRevision:${Number(runtimeState.topologyRevision) || 0}`,
        `dirtyRevision:${dirtyRevision}`,
        `passBackground:${String(signatures.background || "")}`,
        `passPhysicalBase:${String(signatures.physicalBase || "")}`,
        `passPolitical:${String(signatures.political || "")}`,
        `passContextBase:${String(signatures.contextBase || "")}`,
        `passContextScenario:${String(signatures.contextScenario || "")}`,
        `passEffects:${String(signatures.effects || "")}`,
        `passDayNight:${String(signatures.dayNight || "")}`,
      ];
    }
    if (layerId === "line") {
      return [
        getExportBakeVisibilitySignature(exportUi),
        `topologyRevision:${Number(runtimeState.topologyRevision) || 0}`,
        `dynamicDirty:${runtimeState.dynamicBordersDirty ? 1 : 0}`,
        `dirtyRevision:${dirtyRevision}`,
        `passBorders:${String(signatures.borders || "")}`,
        `passLineEffects:${String(signatures.lineEffects || "")}`,
      ];
    }
    if (layerId === "text") {
      return [
        getExportBakeVisibilitySignature(exportUi),
        `topologyRevision:${Number(runtimeState.topologyRevision) || 0}`,
        `svgChildren:${mapSvgChildCount}`,
        `dirtyRevision:${dirtyRevision}`,
        ...transformSignature,
      ];
    }
    return [
      ...thematicDependencies,
      getExportBakeVisibilitySignature(exportUi),
      `colorRevision:${Number(runtimeState.colorRevision) || 0}`,
      `topologyRevision:${Number(runtimeState.topologyRevision) || 0}`,
      `svgChildren:${mapSvgChildCount}`,
      `dirtyRevision:${dirtyRevision}`,
      ...transformSignature,
      `passPolitical:${String(signatures.political || "")}`,
      `passContextBase:${String(signatures.contextBase || "")}`,
      `passContextScenario:${String(signatures.contextScenario || "")}`,
      `passEffects:${String(signatures.effects || "")}`,
      `passBorders:${String(signatures.borders || "")}`,
      `passLineEffects:${String(signatures.lineEffects || "")}`,
      `passDayNight:${String(signatures.dayNight || "")}`,
      `passContextMarkers:${String(signatures.contextMarkers || "")}`,
      `passTextureLabels:${String(signatures.textureLabels || "")}`,
      `passLabels:${String(signatures.labels || "")}`,
    ];
  };

  const SVG_ANNOTATION_VIEWPORT_SELECTOR = [
    ".operational-lines-layer",
    ".operation-graphics-layer",
    ".unit-counters-layer",
  ].join(", ");
  const cloneSvgForExport = ({ onlyViewportSelector = "", removeSelectors = [] } = {}) => {
    const mapSvg = document.getElementById("map-svg");
    if (!mapSvg) return null;
    const clone = mapSvg.cloneNode(true);
    removeSelectors.forEach((selector) => {
      clone.querySelectorAll(selector).forEach((node) => node.remove());
    });
    if (onlyViewportSelector) {
      const viewport = clone.querySelector(".viewport-layer");
      if (viewport) {
        Array.from(viewport.children).forEach((child) => {
          if (!child.matches(onlyViewportSelector)) child.remove();
        });
      }
      Array.from(clone.children).forEach((child) => {
        const tagName = String(child.tagName || "").toLowerCase();
        if (child !== viewport && tagName !== "defs") child.remove();
      });
    }
    return clone;
  };

  const drawSvgLayerToCanvas = async (targetCanvas, targetCtx, options = {}) => {
    const svgForExport = cloneSvgForExport(options);
    if (!svgForExport || !targetCanvas || !targetCtx) return false;
    const serializer = new XMLSerializer();
    const svgMarkup = serializer.serializeToString(svgForExport);
    const svgBlob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
    const svgUrl = URL.createObjectURL(svgBlob);
    try {
      await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          targetCtx.drawImage(image, 0, 0, targetCanvas.width, targetCanvas.height);
          resolve();
        };
        image.onerror = () => reject(new Error("SVG overlay export failed."));
        image.src = svgUrl;
      });
      return true;
    } finally {
      URL.revokeObjectURL(svgUrl);
    }
  };

  const writeBakeArtifactMeta = (layerId, dependencies, canvas, dirtyFlag) => {
    const exportUi = ensureExportWorkbenchUiState();
    const entry = {
      layerId,
      updatedAt: Date.now(),
      dependencies: [...dependencies],
      canvasSize: {
        width: Math.max(0, Math.round(Number(canvas?.width) || 0)),
        height: Math.max(0, Math.round(Number(canvas?.height) || 0)),
      },
      dirtyFlag: !!dirtyFlag,
    };
    const nextArtifacts = Array.isArray(exportUi.bakeArtifacts) ? [...exportUi.bakeArtifacts] : [];
    const existingIndex = nextArtifacts.findIndex((artifact) => artifact?.layerId === layerId);
    if (existingIndex >= 0) {
      nextArtifacts[existingIndex] = entry;
    } else {
      nextArtifacts.push(entry);
    }
    setExportBakeState(runtimeState, { bakeArtifacts: nextArtifacts });
    return entry;
  };

  const drawRenderPassCanvasToBakeTarget = (passName, targetCtx) => {
    const renderPassCache = runtimeState.renderPassCache && typeof runtimeState.renderPassCache === "object"
      ? runtimeState.renderPassCache
      : null;
    if (!renderPassCache || !targetCtx) return false;
    const passCanvas = renderPassCache.canvases?.[passName];
    if (!passCanvas) return false;
    const layout = renderPassCache.layouts?.[passName] || {};
    const dpr = Math.max(Number(runtimeState.dpr) || 1, 1);
    const referenceTransform = renderPassCache.referenceTransforms?.[passName] || null;
    const currentTransform = runtimeState.zoomTransform && typeof runtimeState.zoomTransform === "object"
      ? runtimeState.zoomTransform
      : { k: 1, x: 0, y: 0 };
    const hasReferenceTransform = referenceTransform
      && Number.isFinite(Number(referenceTransform.k))
      && Number.isFinite(Number(referenceTransform.x))
      && Number.isFinite(Number(referenceTransform.y));
    const hasCurrentTransform = Number.isFinite(Number(currentTransform.k))
      && Number.isFinite(Number(currentTransform.x))
      && Number.isFinite(Number(currentTransform.y));
    if (!hasReferenceTransform || !hasCurrentTransform) {
      const offsetX = Math.round(-Number(layout.offsetX || 0) * dpr);
      const offsetY = Math.round(-Number(layout.offsetY || 0) * dpr);
      targetCtx.drawImage(passCanvas, offsetX, offsetY);
      return true;
    }
    const referenceK = Math.max(Number(referenceTransform.k) || 1, 0.0001);
    const currentK = Math.max(Number(currentTransform.k) || 1, 0.0001);
    const scaleRatio = currentK / referenceK;
    const dx = Number(currentTransform.x || 0) - (Number(referenceTransform.x || 0) * scaleRatio);
    const dy = Number(currentTransform.y || 0) - (Number(referenceTransform.y || 0) * scaleRatio);
    targetCtx.save();
    targetCtx.setTransform(1, 0, 0, 1, 0, 0);
    targetCtx.translate(
      (dx - Number(layout.offsetX || 0) * scaleRatio) * dpr,
      (dy - Number(layout.offsetY || 0) * scaleRatio) * dpr,
    );
    targetCtx.scale(scaleRatio, scaleRatio);
    targetCtx.drawImage(passCanvas, 0, 0);
    targetCtx.restore();
    return true;
  };

  const ensureThematicWgiReadyForExport = async (passNames) => {
    const population = getPopulationViewModel(runtimeState);
    if (population.enabled && population.supported && (passNames.includes("political") || passNames.includes("populationHeatmap"))) {
      await ensurePopulationData(runtimeState, { onChange: () => runtimeState.refreshColorStateFn?.({ renderNow: false }) });
      if (!isPopulationActive(runtimeState)) throw createExportError("invalid-params", runtimeState.currentLanguage === "zh"
        ? "人口数据不可用。请重试加载或关闭人口图层后导出。" : "Population data is unavailable. Retry or turn off the population layer before export.");
      if (population.mode === "heatmap" && passNames.includes("populationHeatmap")) {
        await ensurePopulationHeatmapReadyForExport();
        assertPopulationHeatmapReadyForExport();
      }
    }
    if (!passNames.includes("political") || !isThematicWgiRequested(runtimeState)) return;
    await ensureThematicWgiData(runtimeState, {
      onChange: () => runtimeState.refreshColorStateFn?.({ renderNow: false }),
    });
    if (!isThematicWgiActive(runtimeState)) {
      throw createExportError("invalid-params", runtimeState.currentLanguage === "zh"
        ? "专题数据不可用。请重试加载或关闭专题着色后再导出。"
        : "Thematic data is unavailable. Retry loading or turn off thematic shading before export.");
    }
  };

  const bakeLayer = async (layerId, exportUiOverride = null) => {
    await ensureScenarioPoliticalDetailForExport();
    const exportUi = exportUiOverride && typeof exportUiOverride === "object"
      ? exportUiOverride
      : ensureExportWorkbenchUiState();
    const normalizedLayerId = String(layerId || "").trim().toLowerCase();
    if (!["color", "line", "text", "composite"].includes(normalizedLayerId)) {
      throw new Error(`Unsupported bake layer: ${layerId}`);
    }
    const bakePassNames = getBakePassNamesForLayer(normalizedLayerId, exportUi, {
      resolvePassSequence: resolveExportPassSequence,
      renderPassNames: RENDER_PASS_NAMES,
    });
    await ensureThematicWgiReadyForExport(bakePassNames);
    await ensurePaintContoursReady();
    const width = runtimeState.colorCanvas?.width || runtimeState.lineCanvas?.width || 0;
    const height = runtimeState.colorCanvas?.height || runtimeState.lineCanvas?.height || 0;
    const dependencies = getLayerDependencyRevision(normalizedLayerId, exportUi);
    const hash = computeBakeHash([normalizedLayerId, `${width}x${height}`, ...dependencies]);
    const cacheEntry = exportBakeCache.get(normalizedLayerId);
    if (
      cacheEntry
      && cacheEntry.hash === hash
      && cacheEntry.canvas
      && cacheEntry.canvas.width === width
      && cacheEntry.canvas.height === height
    ) {
      writeBakeArtifactMeta(normalizedLayerId, dependencies, cacheEntry.canvas, false);
      return cacheEntry.canvas;
    }
    const bakeCanvas = document.createElement("canvas");
    bakeCanvas.width = width;
    bakeCanvas.height = height;
    const bakeCtx = bakeCanvas.getContext("2d");
    if (!bakeCtx) {
      throw new Error("Canvas bake context unavailable.");
    }
    if (normalizedLayerId === "composite") {
      const compositeCanvas = await buildCompositeSourceCanvas(exportUi);
      bakeCtx.drawImage(compositeCanvas, 0, 0);
    } else {
      if (bakePassNames.length) {
        await ensureCountryLabelsReadyForExport(bakePassNames);
        await ensureBathymetryReadyForExport(bakePassNames);
        const passCanvas = renderExportPassesToCanvas(bakePassNames);
        if (passCanvas) {
          bakeCtx.drawImage(passCanvas, 0, 0);
        }
      }
      if (normalizedLayerId === "text" && exportUi.textVisibility?.["svg-annotations"]) {
        await drawSvgLayerToCanvas(bakeCanvas, bakeCtx, {
          onlyViewportSelector: SVG_ANNOTATION_VIEWPORT_SELECTOR,
        });
      }
      if (normalizedLayerId === "text" && exportUi.textVisibility?.["special-zones"]) {
        await drawSvgLayerToCanvas(bakeCanvas, bakeCtx, { onlyViewportSelector: ".special-zones-layer" });
      }
      if (bakePassNames.includes("political")) { drawThematicWgiExportLegend(bakeCanvas, runtimeState); drawPopulationExportLegend(bakeCanvas, runtimeState); }
    }
    const version = cacheEntry ? Number(cacheEntry.version || 0) + 1 : 1;
    exportBakeCache.set(normalizedLayerId, {
      hash,
      version,
      canvas: bakeCanvas,
      updatedAt: Date.now(),
      dependencies,
      canvasSize: { width, height },
      dirtyFlag: true,
    });
    writeBakeArtifactMeta(normalizedLayerId, dependencies, bakeCanvas, true);
    return bakeCanvas;
  };

  const applyExportAdjustmentsToCanvas = (sourceCanvas, exportUi, { width = sourceCanvas?.width, height = sourceCanvas?.height } = {}) => {
    if (!sourceCanvas) {
      throw createExportError("invalid-params", "Missing export source canvas.");
    }
    const targetWidth = Math.max(1, Math.round(Number(width) || 0));
    const targetHeight = Math.max(1, Math.round(Number(height) || 0));
    const adjustedCanvas = document.createElement("canvas");
    adjustedCanvas.width = targetWidth;
    adjustedCanvas.height = targetHeight;
    const adjustedCtx = adjustedCanvas.getContext("2d");
    if (!adjustedCtx) {
      throw createExportError("invalid-params", "Canvas export context unavailable.");
    }
    adjustedCtx.imageSmoothingEnabled = true;
    adjustedCtx.imageSmoothingQuality = "high";
    adjustedCtx.filter = buildExportAdjustmentFilter(exportUi);
    adjustedCtx.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight);
    adjustedCtx.filter = "none";
    return adjustedCanvas;
  };

  const buildSvgAnnotationCanvas = async (options = {}, dimensions = null) => {
    const width = dimensions?.width || runtimeState.colorCanvas?.width || runtimeState.lineCanvas?.width || 0;
    const height = dimensions?.height || runtimeState.colorCanvas?.height || runtimeState.lineCanvas?.height || 0;
    if (!(width > 0) || !(height > 0)) {
      throw createExportError("invalid-params", "SVG annotation canvas unavailable.");
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw createExportError("invalid-params", "SVG annotation context unavailable.");
    }
    await drawSvgLayerToCanvas(canvas, ctx, options);
    return canvas;
  };

  const buildSpecialZonesExportCanvas = async (dimensions = null) => buildSvgAnnotationCanvas({
    onlyViewportSelector: ".special-zones-layer",
  }, dimensions);

  const buildCompositeSourceCanvas = async (exportUi, dimensions = null) => {
    await ensureScenarioPoliticalDetailForExport();
    const passNames = resolveExportPassSequence({
      ...exportUi,
      visibility: exportUi.visibility,
    }, RENDER_PASS_NAMES).filter((passName) => exportUi.textVisibility?.["render-labels"] || passName !== "labels");
    await ensureThematicWgiReadyForExport(passNames);
    await ensurePaintContoursReady();
    await ensureCountryLabelsReadyForExport(passNames);
    await ensureBathymetryReadyForExport(passNames, dimensions?.pixelRatio ?? null);
    const compositeCanvas = renderExportPassesToCanvas(passNames, dimensions ? { pixelRatio: dimensions.pixelRatio } : {});
    if (!compositeCanvas) {
      throw createExportError("invalid-params", "Composite export canvas unavailable.");
    }
    // The renderer returns a new, caller-owned canvas in both resolution paths.
    // SVG overlays can compose directly onto it without a full-frame copy.
    const workingCanvas = compositeCanvas;
    if (exportUi.textVisibility?.["svg-annotations"]) {
      const workingCtx = workingCanvas.getContext("2d");
      if (!workingCtx) {
        throw createExportError("invalid-params", "Composite export context unavailable.");
      }
      await drawSvgLayerToCanvas(workingCanvas, workingCtx, {
        onlyViewportSelector: SVG_ANNOTATION_VIEWPORT_SELECTOR,
      });
    }
    if (exportUi.textVisibility?.["special-zones"]) {
      const workingCtx = workingCanvas.getContext("2d");
      if (!workingCtx) {
        throw createExportError("invalid-params", "Composite export context unavailable.");
      }
      await drawSvgLayerToCanvas(workingCanvas, workingCtx, { onlyViewportSelector: ".special-zones-layer" });
    }
    if (passNames.includes("political")) { drawThematicWgiExportLegend(workingCanvas, runtimeState); drawPopulationExportLegend(workingCanvas, runtimeState); }
    return workingCanvas;
  };

  const buildSingleExportSourceCanvas = async (exportUi, sourceId, dimensions = null) => {
    await ensureScenarioPoliticalDetailForExport();
    const normalizedSourceId = String(sourceId || "").trim();
    if (EXPORT_MAIN_LAYER_MODEL_BY_ID.has(normalizedSourceId)) {
      const model = EXPORT_MAIN_LAYER_MODEL_BY_ID.get(normalizedSourceId);
      const passNames = model?.passNames || [];
      await ensureThematicWgiReadyForExport(passNames);
      await ensurePaintContoursReady();
      await ensureCountryLabelsReadyForExport(passNames);
      await ensureBathymetryReadyForExport(passNames, dimensions?.pixelRatio ?? null);
      const canvas = renderExportPassesToCanvas(passNames, dimensions ? { pixelRatio: dimensions.pixelRatio } : {});
      if (!canvas) {
        throw createExportError("invalid-params", `Layer export canvas unavailable for ${normalizedSourceId}.`);
      }
      if (passNames.includes("political")) { drawThematicWgiExportLegend(canvas, runtimeState); drawPopulationExportLegend(canvas, runtimeState); }
      return canvas;
    }
    await ensurePaintContoursReady();
    if (normalizedSourceId === "render-labels") {
      await ensureCountryLabelsReadyForExport(["labels"]);
      const canvas = renderExportPassesToCanvas(["labels"], dimensions ? { pixelRatio: dimensions.pixelRatio } : {});
      if (!canvas) {
        throw createExportError("invalid-params", "Render-pass label canvas unavailable.");
      }
      return canvas;
    }
    if (normalizedSourceId === "svg-annotations") {
      return buildSvgAnnotationCanvas({ onlyViewportSelector: SVG_ANNOTATION_VIEWPORT_SELECTOR }, dimensions);
    }
    if (normalizedSourceId === "special-zones") {
      return buildSpecialZonesExportCanvas(dimensions);
    }
    throw createExportError("invalid-params", `Unsupported preview source: ${normalizedSourceId}`);
  };

  const getExportDimensions = (scaleMultiplier) => {
    const { width: baseWidth, height: baseHeight } = resolveExportBaseDimensions(
      Number(runtimeState.dpr || 0),
      Number(runtimeState.width || 0),
      Number(runtimeState.height || 0),
      Number(runtimeState.colorCanvas?.width || 0),
      Number(runtimeState.colorCanvas?.height || 0),
    );
    if (!(baseWidth > 0) || !(baseHeight > 0)) {
      throw createExportError("invalid-params", "Missing preview canvas dimensions.");
    }
    const targetWidth = Math.round(baseWidth * scaleMultiplier);
    const targetHeight = Math.round(baseHeight * scaleMultiplier);
    if (targetWidth > EXPORT_MAX_DIMENSION_PX || targetHeight > EXPORT_MAX_DIMENSION_PX) {
      throw createExportError("invalid-params", `Export size exceeds 8K cap (${targetWidth}x${targetHeight}).`);
    }
    if (targetWidth * targetHeight > EXPORT_MAX_PIXELS) {
      throw createExportError("invalid-params", `Export pixel budget exceeded (${targetWidth}x${targetHeight}).`);
    }
    return { width: targetWidth, height: targetHeight, pixelRatio: scaleMultiplier };
  };

  const scaleCanvasForExport = (sourceCanvas, scaleMultiplier, exportUi) => {
    if (!sourceCanvas) {
      throw createExportError("invalid-params", "Missing export source canvas.");
    }
    const dimensions = getExportDimensions(scaleMultiplier);
    return applyExportAdjustmentsToCanvas(sourceCanvas, exportUi, dimensions);
  };

  const buildCompositeExportCanvas = async (exportUi, scaleMultiplier) => {
    const dimensions = getExportDimensions(scaleMultiplier);
    const compositeCanvas = await buildCompositeSourceCanvas(exportUi, dimensions);
    return scaleCanvasForExport(compositeCanvas, scaleMultiplier, exportUi);
  };

  const buildPerLayerExportOutputs = async (exportUi, scaleMultiplier) => {
    const dimensions = getExportDimensions(scaleMultiplier);
    const outputs = buildPerLayerExportPlan(exportUi);
    for (const output of outputs) {
      const layerCanvas = await buildSingleExportSourceCanvas(exportUi, output.id, dimensions);
      output.canvas = scaleCanvasForExport(layerCanvas, scaleMultiplier, exportUi);
    }
    if (!outputs.length) {
      throw createExportError("invalid-params", "No visible export layers are available for per-layer export.");
    }
    return outputs;
  };

  return {
    clearExportBakeCache,
    bakeLayer,
    applyExportAdjustmentsToCanvas,
    buildCompositeSourceCanvas,
    buildSingleExportSourceCanvas,
    scaleCanvasForExport,
    buildCompositeExportCanvas,
    buildPerLayerExportOutputs,
  };
}
