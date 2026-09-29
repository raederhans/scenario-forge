// Transport workbench preview lifecycle owner.
// Owns render generation, carrier view sync, and preview/carrier disposal.

import {
  destroyTransportWorkbenchCarrier,
  ensureTransportWorkbenchCarrier,
  getTransportWorkbenchCarrierViewState,
  resizeTransportWorkbenchCarrier,
  setTransportWorkbenchCarrierViewChangeListener,
} from "../transport_workbench_carrier.js";
import {
  clearAllTransportWorkbenchFamilyPreviews,
  destroyAllTransportWorkbenchFamilyPreviews,
  isTransportWorkbenchFamilyLivePreviewCapable,
  prepareTransportWorkbenchFamilyPreview,
  renderTransportWorkbenchFamilyPreview,
  setTransportWorkbenchFamilyPreviewSelectionListener,
  warmTransportWorkbenchFamilyPreview,
} from "../transport_workbench_family_preview.js";
import { listTransportWorkbenchWarmupPlans } from "../transport_workbench_family_registry.js";
import {
  TRANSPORT_WORKBENCH_RUNTIME_FAMILY_IDS,
  normalizeTransportWorkbenchFamily,
} from "./transport_workbench_config_owner.js";

function createTransportWorkbenchPreviewViewKey(viewState = {}) {
  const scale = Number(viewState.scale || 1);
  const translateX = Number(viewState.translateX || 0);
  const translateY = Number(viewState.translateY || 0);
  return [
    Math.round(scale * 100) / 100,
    Math.round(translateX / 2) * 2,
    Math.round(translateY / 2) * 2,
    String(viewState.quarterTurns || 0),
  ].join(":");
}

export function createTransportWorkbenchPreviewLifecycleOwner(runtimeState, {
  getCarrierMount = () => null,
  getRenderContext = () => null,
  ensureUiState = () => {},
  renderInspector = () => {},
  renderLayerOrderPanel = () => {},
  renderLensSections = () => {},
  syncPreviewControls = () => {},
  getCarrierViewState = getTransportWorkbenchCarrierViewState,
  ensureCarrier = ensureTransportWorkbenchCarrier,
  prepareFamilyPreview = prepareTransportWorkbenchFamilyPreview,
  renderFamilyPreview = renderTransportWorkbenchFamilyPreview,
  listWarmupPlans = listTransportWorkbenchWarmupPlans,
  warmFamilyPreview = warmTransportWorkbenchFamilyPreview,
  setCarrierViewChangeListener = setTransportWorkbenchCarrierViewChangeListener,
  setFamilyPreviewSelectionListener = setTransportWorkbenchFamilyPreviewSelectionListener,
  runtimeFamilyIds = TRANSPORT_WORKBENCH_RUNTIME_FAMILY_IDS,
  destroyCarrier = destroyTransportWorkbenchCarrier,
  destroyFamilyPreviews = destroyAllTransportWorkbenchFamilyPreviews,
  scheduleTimeout = (callback, delay) => globalThis.setTimeout(callback, delay),
  requestAnimationFrame = (callback) => globalThis.requestAnimationFrame(callback),
  cancelAnimationFrame = (id) => globalThis.cancelAnimationFrame(id),
  requestIdle = (callback, options) => {
    if (typeof globalThis.requestIdleCallback === "function") {
      return globalThis.requestIdleCallback(callback, options);
    }
    callback();
    return 0;
  },
  warnWarmupFailure = (familyId, reason) => {
    console.warn(`[transport-workbench] Failed to warm ${familyId} preview pack.`, reason);
  },
} = {}) {
  // 每次 preview 刷新都会递增 generation；异步 pack/render 返回后先比对 generation，防止旧 family 写回新 UI。
  let renderGeneration = 0;
  let previewViewSyncRaf = 0;
  let previewLastViewKey = "";
  let previewLensRefreshPending = false;
  let previewWarmupScheduled = false;
  let selectionSyncRaf = 0;
  const pendingSelectionFamilyIds = new Set();

  const isRenderGenerationCurrent = (candidateGeneration, familyId) => (
    candidateGeneration === renderGeneration
    && !!runtimeState.transportWorkbenchUi?.open
    && normalizeTransportWorkbenchFamily(runtimeState.transportWorkbenchUi?.activeFamily) === familyId
  );

  const refreshPreview = (context, { allowCarrierPrep = true, viewOnly = false } = {}) => {
    const candidateGeneration = ++renderGeneration;
    if (!context.isOpen) {
      clearAllTransportWorkbenchFamilyPreviews();
      return Promise.resolve(null);
    }
    if (context.family.id === "layers") {
      clearAllTransportWorkbenchFamilyPreviews();
      renderLayerOrderPanel();
      return Promise.resolve(null);
    }
    const carrierMount = getCarrierMount();
    if (!carrierMount) {
      return Promise.resolve(null);
    }
    const isLiveCapable = isTransportWorkbenchFamilyLivePreviewCapable(context.family.id);
    if (allowCarrierPrep && !viewOnly && isLiveCapable) previewLensRefreshPending = true;
    const preparePack = (allowCarrierPrep && !viewOnly && isLiveCapable)
      ? Promise.resolve().then(() => prepareFamilyPreview(context.family.id, context.config))
      : Promise.resolve();
    const prepareCarrier = allowCarrierPrep
      ? Promise.resolve().then(() => ensureCarrier(carrierMount))
      : Promise.resolve();

    return Promise.all([prepareCarrier, preparePack])
      .then(() => {
        if (!isRenderGenerationCurrent(candidateGeneration, context.family.id)) {
          return null;
        }
        resizeTransportWorkbenchCarrier();
        syncPreviewControls();
        // Preview family modules consume the resolved config; this owner only keeps lifecycle ordering stable.
        if (isLiveCapable) {
          return renderFamilyPreview(context.family.id, context.config, {
            isCurrent: () => isRenderGenerationCurrent(candidateGeneration, context.family.id),
            viewOnly,
          }).then(() => {
            if (!isRenderGenerationCurrent(candidateGeneration, context.family.id)) {
              return null;
            }
            previewLastViewKey = createTransportWorkbenchPreviewViewKey(getCarrierViewState());
            // A carrier view update may supersede the initial preparation.
            // Let the latest committed preview publish the pending status.
            if (previewLensRefreshPending) {
              previewLensRefreshPending = false;
              renderLensSections(context.family, context.config, context.compareHeld);
            }
            renderInspector(context.family, context.config, context.compareHeld);
            return null;
          });
        }
        clearAllTransportWorkbenchFamilyPreviews();
        if (isRenderGenerationCurrent(candidateGeneration, context.family.id)) {
          renderInspector(context.family, context.config, context.compareHeld);
        }
        return null;
      })
      .catch((error) => {
        if (!isRenderGenerationCurrent(candidateGeneration, context.family.id)) {
          return null;
        }
        console.error("[transport-workbench] Failed to prepare transport carrier preview.", error);
        if (!isTransportWorkbenchFamilyLivePreviewCapable(context.family.id)) {
          clearAllTransportWorkbenchFamilyPreviews();
        }
        if (isRenderGenerationCurrent(candidateGeneration, context.family.id)) {
          renderInspector(context.family, context.config, context.compareHeld);
        }
        return null;
      });
  };

  const scheduleViewSync = () => {
    ensureUiState();
    const activeFamily = normalizeTransportWorkbenchFamily(runtimeState.transportWorkbenchUi.activeFamily);
    if (!runtimeState.transportWorkbenchUi?.open || !isTransportWorkbenchFamilyLivePreviewCapable(activeFamily)) {
      return;
    }
    const nextViewKey = createTransportWorkbenchPreviewViewKey(getCarrierViewState());
    if (previewLastViewKey === nextViewKey) {
      return;
    }
    previewLastViewKey = nextViewKey;
    if (previewViewSyncRaf) {
      cancelAnimationFrame(previewViewSyncRaf);
    }
    previewViewSyncRaf = requestAnimationFrame(() => {
      previewViewSyncRaf = 0;
      const context = getRenderContext();
      if (!context.isOpen || context.family.id !== activeFamily) return;
      refreshPreview(context, { allowCarrierPrep: false, viewOnly: true });
    });
  };

  const schedulePreviewWarmup = () => {
    if (previewWarmupScheduled) return;
    previewWarmupScheduled = true;
    // warmup 延后到首屏之后的 idle，减少打开页面时 transport pack 预热和主图启动争抢。
    const runWarmup = () => {
      const warmupPlans = listWarmupPlans();
      Promise.allSettled(
        warmupPlans.map((plan) => warmFamilyPreview(plan.familyId, { includeFull: !!plan.includeFull }))
      ).then((results) => {
        results.forEach((result, index) => {
          if (result.status === "fulfilled") return;
          warnWarmupFailure(warmupPlans[index]?.familyId || "unknown", result.reason);
        });
      });
    };
    scheduleTimeout(() => {
      requestIdle(() => runWarmup(), { timeout: 2_000 });
    }, 10_000);
  };

  const attachRuntimeListeners = () => {
    setCarrierViewChangeListener(() => {
      scheduleViewSync();
    });
    runtimeFamilyIds.forEach((familyId) => {
      setFamilyPreviewSelectionListener(familyId, () => {
        pendingSelectionFamilyIds.add(familyId);
        if (selectionSyncRaf) {
          return;
        }
        selectionSyncRaf = requestAnimationFrame(() => {
          selectionSyncRaf = 0;
          const context = getRenderContext();
          const activeFamilyId = context?.family?.id || "";
          const shouldRefresh = pendingSelectionFamilyIds.has(activeFamilyId);
          pendingSelectionFamilyIds.clear();
          if (!context?.isOpen || !shouldRefresh) {
            return;
          }
          renderLensSections(context.family, context.config, context.compareHeld);
          renderInspector(context.family, context.config, context.compareHeld);
        });
      });
    });
  };

  const initializeRuntimeHooks = () => {
    schedulePreviewWarmup();
    attachRuntimeListeners();
  };

  const dispose = () => {
    if (previewViewSyncRaf) {
      cancelAnimationFrame(previewViewSyncRaf);
      previewViewSyncRaf = 0;
    }
    if (selectionSyncRaf) {
      cancelAnimationFrame(selectionSyncRaf);
      selectionSyncRaf = 0;
      pendingSelectionFamilyIds.clear();
    }
    renderGeneration += 1;
    previewLastViewKey = "";
    previewLensRefreshPending = false;
    destroyFamilyPreviews();
    destroyCarrier();
    attachRuntimeListeners();
  };

  return {
    dispose,
    initializeRuntimeHooks,
    isRenderGenerationCurrent,
    refreshPreview,
    scheduleViewSync,
  };
}
