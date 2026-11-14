import { createExportBakeRuntime } from "./export_bake_runtime.js";
import { normalizeExportWorkbenchUiState } from "../../core/state.js";
import { callCompatRuntimeHook, callRuntimeHook, registerRuntimeHook } from "../../core/state/index.js";
import { buildExportArtifactPackage } from "../../core/export_artifact_package.js";
import { showToast } from "../toast.js";
import { showExportFailureToast } from "./export_failure_handler.js";
import { buildBakePackMetadata, buildBakePackPackageFiles, buildExportArtifactProjectContext, buildExportArtifactScenarioContext, buildExportUiManifestSnapshot, buildPerLayerPackageFiles, getBakePackLayerIds } from "./export_artifact_model.js";
import { createExportWorkbenchController } from "./export_workbench_controller.js";

const EXPORT_MAX_CONCURRENT_JOBS = 1;

export function createExportWorkflowController({
  state, document, t, closeDockPopover, closeScenarioGuide,
  renderPassNames: RENDER_PASS_NAMES,
  renderExportPassesToCanvas,
  assertPopulationHeatmapReadyForExport,
  ensurePopulationHeatmapReadyForExport,
  ensurePaintContoursReady,
  ensureBathymetryReadyForExport,
  ensureCountryLabelsReadyForExport,
  ensureScenarioPoliticalDetailForExport,
  syncSupportSurfaceUrlState, rememberOverlayTrigger, restoreOverlayTriggerFocus, focusOverlaySurface,
}) {
  const runtimeState = state;
  const exportBtn = document.getElementById("exportWorkbenchSnapshotBtn");
  const exportTarget = document.getElementById("exportWorkbenchTarget");
  const exportFormat = document.getElementById("exportWorkbenchFormat");
  const exportScale = document.getElementById("exportWorkbenchScale");
  const exportWorkbenchLayerList = document.getElementById("exportWorkbenchMainLayerList");
  const exportWorkbenchTextElementList = document.getElementById("exportWorkbenchTextElementList");
  if (exportWorkbenchLayerList && !exportWorkbenchLayerList.getAttribute("aria-label")) {
    exportWorkbenchLayerList.setAttribute("aria-label", t("Main Layers", "ui"));
  }
  if (exportWorkbenchTextElementList && !exportWorkbenchTextElementList.getAttribute("aria-label")) {
    exportWorkbenchTextElementList.setAttribute("aria-label", t("Text elements", "ui"));
  }
  const exportWorkbenchOverlay = document.getElementById("exportWorkbenchOverlay");
  const exportWorkbenchPanel = document.getElementById("exportWorkbenchPanel");
  const exportWorkbenchCloseBtn = document.getElementById("exportWorkbenchCloseBtn");
  const exportWorkbenchPreviewStage = document.getElementById("exportWorkbenchPreviewStage");
  const exportWorkbenchPreviewState = document.getElementById("exportWorkbenchPreviewState");
  const exportWorkbenchPreviewModeButtons = Array.from(document.querySelectorAll(".export-workbench-preview-toggle-btn"));
  const exportWorkbenchPreviewLayerSelect = document.getElementById("exportWorkbenchPreviewLayerSelect");
  const exportWorkbenchTarget = document.getElementById("exportWorkbenchTarget");
  const exportWorkbenchFormat = document.getElementById("exportWorkbenchFormat");
  const exportWorkbenchScale = document.getElementById("exportWorkbenchScale");
  const exportWorkbenchSnapshotBtn = document.getElementById("exportWorkbenchSnapshotBtn");
  const exportWorkbenchBrightness = document.getElementById("exportWorkbenchBrightness");
  const exportWorkbenchContrast = document.getElementById("exportWorkbenchContrast");
  const exportWorkbenchSaturation = document.getElementById("exportWorkbenchSaturation");
  const exportWorkbenchClarity = document.getElementById("exportWorkbenchClarity");
  const exportWorkbenchBrightnessValue = document.getElementById("exportWorkbenchBrightnessValue");
  const exportWorkbenchContrastValue = document.getElementById("exportWorkbenchContrastValue");
  const exportWorkbenchSaturationValue = document.getElementById("exportWorkbenchSaturationValue");
  const exportWorkbenchClarityValue = document.getElementById("exportWorkbenchClarityValue");
  const exportWorkbenchBakeVisibleBtn = document.getElementById("exportWorkbenchBakeVisibleBtn");
  const exportWorkbenchClearBakeBtn = document.getElementById("exportWorkbenchClearBakeBtn");
  const exportWorkbenchBakeArtifactList = document.getElementById("exportWorkbenchBakeArtifactList");
  const exportWorkbenchSampleContext = document.getElementById("exportWorkbenchSampleContext");
  const exportWorkbenchSampleTitle = document.getElementById("exportWorkbenchSampleTitle");
  const exportWorkbenchSampleRecommendation = document.getElementById("exportWorkbenchSampleRecommendation");
  const dockExportBtn = document.getElementById("dockExportBtn");
  const exportProjectSection = document.getElementById("exportProjectSection");
  const exportSectionSummaryTarget = document.getElementById("exportSectionSummaryTarget");
  const exportSectionSummaryFormat = document.getElementById("exportSectionSummaryFormat");
  const exportSectionSummaryScale = document.getElementById("exportSectionSummaryScale");
  let exportWorkbenchController = null;
  let ensureExportWorkbenchUiState = () => {
    throw new Error("Export workbench controller is not initialized.");
  };
  const {
    clearExportBakeCache,
    bakeLayer,
    applyExportAdjustmentsToCanvas,
    buildCompositeSourceCanvas,
    buildSingleExportSourceCanvas,
    scaleCanvasForExport,
    buildCompositeExportCanvas,
    buildPerLayerExportOutputs,
  } = createExportBakeRuntime({
    state: runtimeState,
    document,
    ensureExportWorkbenchUiState: () => ensureExportWorkbenchUiState(),
    renderPassNames: RENDER_PASS_NAMES,
    renderExportPassesToCanvas,
    assertPopulationHeatmapReadyForExport,
    ensurePopulationHeatmapReadyForExport,
    ensurePaintContoursReady,
    ensureBathymetryReadyForExport,
    ensureCountryLabelsReadyForExport,
    ensureScenarioPoliticalDetailForExport,
  });
  const renderExportWorkbenchLayerList = () => exportWorkbenchController?.renderExportWorkbenchLayerList();
  const renderExportWorkbenchTextElementList = () => exportWorkbenchController?.renderExportWorkbenchTextElementList();
  const syncExportPreviewSourceOptions = () => {
    return exportWorkbenchController?.syncExportPreviewSourceOptions();
  };

  const renderExportWorkbenchBakeArtifactList = () => {
    return exportWorkbenchController?.renderExportWorkbenchBakeArtifactList();
  };

  const renderExportWorkbenchPreview = async () => {
    return exportWorkbenchController?.renderExportWorkbenchPreview();
  };

  const renderExportWorkbenchUi = (isOpen) => {
    if (!exportWorkbenchOverlay) return;
    exportWorkbenchOverlay.classList.toggle("hidden", !isOpen);
    exportWorkbenchOverlay.setAttribute("aria-hidden", isOpen ? "false" : "true");
    dockExportBtn?.classList.toggle("is-active", isOpen);
    dockExportBtn?.setAttribute("aria-expanded", isOpen ? "true" : "false");
    return exportWorkbenchController?.renderExportWorkbenchUi(isOpen);
  };

  const setExportWorkbenchState = (nextOpen, { trigger = null, restoreFocus = true } = {}) => {
    if (!exportWorkbenchOverlay || !exportWorkbenchPanel) return;
    const willOpen = !!nextOpen;
    const wasOpen = !exportWorkbenchOverlay.classList.contains("hidden");
    if (willOpen === wasOpen) {
      renderExportWorkbenchUi(willOpen);
      return;
    }
    if (willOpen) {
      closeDockPopover({ restoreFocus: false, syncUrl: false });
      closeScenarioGuide();
      if (exportProjectSection instanceof HTMLDetailsElement) {
        exportProjectSection.open = true;
      }
      if (trigger instanceof HTMLElement) {
        rememberOverlayTrigger(exportWorkbenchOverlay, trigger);
      }
      renderExportWorkbenchUi(true);
      syncSupportSurfaceUrlState("export");
      focusOverlaySurface(exportWorkbenchPanel);
      return;
    }
    renderExportWorkbenchUi(false);
    syncSupportSurfaceUrlState("");
    if (restoreFocus) {
      restoreOverlayTriggerFocus(exportWorkbenchOverlay, null, document.getElementById("workspaceExportBtn"));
    }
  };

  const getSelectedExportScale = () => {
    const rawValue = String(exportScale?.value || ensureExportWorkbenchUiState().scale || "2").trim();
    return ["1", "1.5", "2", "4"].includes(rawValue) ? Number(rawValue) : 2;
  };

  const buildPerLayerExportPackage = async (exportUi, scaleMultiplier) => {
    const outputs = await buildPerLayerExportOutputs(exportUi, scaleMultiplier);
    return buildExportArtifactPackage({
      artifactKind: "per-layer",
      fileStem: "map_layers",
      scenario: buildExportArtifactScenarioContext(
        String(runtimeState.activeScenarioId || ""),
        Number(runtimeState.activeScenarioManifest?.version || 1),
        String(runtimeState.scenarioBaselineHash || ""),
      ),
      project: buildExportArtifactProjectContext(
        Number(runtimeState.dirtyRevision || 0),
        Number(runtimeState.colorRevision || 0),
        Number(runtimeState.topologyRevision || 0),
      ),
      exportUi: buildExportUiManifestSnapshot(exportUi),
      files: buildPerLayerPackageFiles(outputs),
    });
  };

  const buildBakePackOutputs = async (exportUi, scaleMultiplier) => {
    const outputs = [];
    const bakeLayerIds = getBakePackLayerIds(exportUi);
    for (const layerId of bakeLayerIds) {
      const bakedCanvas = await bakeLayer(layerId, exportUi);
      outputs.push({
        id: layerId,
        canvas: scaleCanvasForExport(bakedCanvas, scaleMultiplier, exportUi),
      });
    }
    const metadata = buildBakePackMetadata(exportUi, outputs);
    outputs.push({
      id: "metadata",
      blob: new Blob([JSON.stringify(metadata, null, 2)], { type: "application/json" }),
      extension: "json",
      fileStem: "map_bake_manifest",
    });
    return outputs;
  };

  const buildBakePackPackage = async (exportUi, scaleMultiplier) => {
    const outputs = await buildBakePackOutputs(exportUi, scaleMultiplier);
    return buildExportArtifactPackage({
      artifactKind: "bake-pack",
      fileStem: "map_bake_pack",
      scenario: buildExportArtifactScenarioContext(
        String(runtimeState.activeScenarioId || ""),
        Number(runtimeState.activeScenarioManifest?.version || 1),
        String(runtimeState.scenarioBaselineHash || ""),
      ),
      project: buildExportArtifactProjectContext(
        Number(runtimeState.dirtyRevision || 0),
        Number(runtimeState.colorRevision || 0),
        Number(runtimeState.topologyRevision || 0),
      ),
      exportUi: buildExportUiManifestSnapshot(exportUi),
      files: buildBakePackPackageFiles(outputs),
    });
  };

  const triggerCanvasDownload = (canvas, extension, fileStem) => {
    const format = extension === "jpg" ? "image/jpeg" : "image/png";
    const dataUrl = canvas.toDataURL(format, 0.92);
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `${fileStem}.${extension}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const triggerBlobDownload = (blob, extension, fileStem) => {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `${fileStem}.${extension}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  };

  const syncExportWorkbenchControlsFromState = () => {
    return exportWorkbenchController?.syncExportWorkbenchControlsFromState() || ensureExportWorkbenchUiState();
  };

  exportWorkbenchController = createExportWorkbenchController({
    state,
    t,
    showToast,
    showExportFailureToast,
    normalizeExportWorkbenchUiState,
    renderPassNames: RENDER_PASS_NAMES,
    exportBtn,
    exportTarget,
    exportFormat,
    exportScale,
    exportWorkbenchLayerList,
    exportWorkbenchTextElementList,
    exportWorkbenchOverlay,
    exportWorkbenchPreviewStage,
    exportWorkbenchPreviewState,
    exportWorkbenchPreviewModeButtons,
    exportWorkbenchPreviewLayerSelect,
    exportWorkbenchBrightness,
    exportWorkbenchContrast,
    exportWorkbenchSaturation,
    exportWorkbenchClarity,
    exportWorkbenchBrightnessValue,
    exportWorkbenchContrastValue,
    exportWorkbenchSaturationValue,
    exportWorkbenchClarityValue,
    exportWorkbenchBakeVisibleBtn,
    exportWorkbenchClearBakeBtn,
    exportWorkbenchBakeArtifactList,
    exportWorkbenchSampleContext,
    exportWorkbenchSampleTitle,
    exportWorkbenchSampleRecommendation,
    exportWorkbenchCloseBtn,
    dockExportBtn,
    exportSectionSummaryTarget,
    exportSectionSummaryFormat,
    exportSectionSummaryScale,
    onRequestClose: ({ restoreFocus = true } = {}) => {
      callRuntimeHook(state, "closeExportWorkbenchFn", { restoreFocus });
    },
    buildCompositeSourceCanvas: (...args) => buildCompositeSourceCanvas(...args),
    buildSingleExportSourceCanvas: (...args) => buildSingleExportSourceCanvas(...args),
    applyExportAdjustmentsToCanvas: (...args) => applyExportAdjustmentsToCanvas(...args),
    buildPerLayerExportOutputs: (...args) => buildPerLayerExportOutputs(...args),
    buildPerLayerExportPackage: (...args) => buildPerLayerExportPackage(...args),
    buildBakePackOutputs: (...args) => buildBakePackOutputs(...args),
    buildBakePackPackage: (...args) => buildBakePackPackage(...args),
    buildCompositeExportCanvas: (...args) => buildCompositeExportCanvas(...args),
    getSelectedExportScale: (...args) => getSelectedExportScale(...args),
    triggerCanvasDownload: (...args) => triggerCanvasDownload(...args),
    triggerBlobDownload: (...args) => triggerBlobDownload(...args),
    bakeLayer: (...args) => bakeLayer(...args),
    clearBakeCache: clearExportBakeCache,
    exportMaxConcurrentJobs: EXPORT_MAX_CONCURRENT_JOBS,
  });
  ensureExportWorkbenchUiState = exportWorkbenchController.ensureExportWorkbenchUiState;
  registerRuntimeHook(state, "clearExportBakeCacheFn", clearExportBakeCache);
  const bindEntryEvents = () => {
    const workspaceExportBtn = document.getElementById("workspaceExportBtn");
    if (workspaceExportBtn && !workspaceExportBtn.dataset.bound) {
      workspaceExportBtn.addEventListener("click", () => callCompatRuntimeHook(runtimeState, "openExportWorkbenchFn", workspaceExportBtn));
      workspaceExportBtn.dataset.bound = "true";
    }
    const advancedExportBtn = document.getElementById("exportWorkbenchAdvancedBtn");
    const setAdvancedExport = (expanded) => {
      advancedExportBtn?.setAttribute("aria-expanded", String(expanded));
      document.getElementById("exportWorkbenchPanel")?.classList.toggle("is-advanced", expanded);
      for (const id of ["exportWorkbenchParams", "exportWorkbenchLayers"]) {
        const section = document.getElementById(id);
        if (section) section.hidden = !expanded;
      }
    };
    if (advancedExportBtn && !advancedExportBtn.dataset.bound) {
      advancedExportBtn.addEventListener("click", () => setAdvancedExport(advancedExportBtn.getAttribute("aria-expanded") !== "true"));
      advancedExportBtn.dataset.bound = "true";
    }
    if (exportTarget && !exportTarget.dataset.advancedBound) {
      exportTarget.addEventListener("change", () => {
        if (exportTarget.value !== "composite") setAdvancedExport(true);
      });
      exportTarget.dataset.advancedBound = "true";
    }

  };
  const bindWorkbenchEvents = () => {
    if (dockExportBtn && !dockExportBtn.dataset.bound) {
      dockExportBtn.setAttribute("aria-haspopup", "dialog");
      dockExportBtn.setAttribute("aria-controls", "exportWorkbenchOverlay");
      dockExportBtn.addEventListener("click", () => {
        const isOpen = !!(exportWorkbenchOverlay && !exportWorkbenchOverlay.classList.contains("hidden"));
        if (isOpen) {
          callRuntimeHook(runtimeState, "closeExportWorkbenchFn", { restoreFocus: true });
        } else {
          closeDockPopover?.({ restoreFocus: false, syncUrl: true });
          callRuntimeHook(runtimeState, "openExportWorkbenchFn", dockExportBtn);
        }
      });
      dockExportBtn.dataset.bound = "true";
    }
    exportWorkbenchController.bindExportWorkbenchEvents();

  };
  return {
    exportWorkbenchOverlay, exportWorkbenchPanel, dockExportBtn, exportProjectSection,
    ensureExportWorkbenchUiState, setExportWorkbenchState,
    renderExportWorkbenchLayerList, syncExportWorkbenchControlsFromState,
    bindEntryEvents, bindWorkbenchEvents,
  };
}
