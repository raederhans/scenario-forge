import { createInitialRenderStats } from "./transport_workbench_preview_state.js";
import { createInitialLoadState } from "./transport_workbench_preview_state.js";
import { ensureTransportWorkbenchCarrierForManifest } from "./transport_workbench_carrier.js";
import { getTransportAsset } from "../../core/data_service.js";

export const INDUSTRIAL_PACK_MODE_PREVIEW = "preview";
export const INDUSTRIAL_PACK_MODE_FULL = "full";

export function createJapanIndustrialZonePreviewRuntime(defaultManifestUrl) {
  return {
    manifestPromise: null,
    auditPromise: null,
    packPromises: new Map(),
    projectedPacks: new Map(),
    loadState: createInitialLoadState(),
    activePackMode: null,
    activePackId: "",
    activeManifestUrl: defaultManifestUrl,
    activeVariantId: null,
    loadGeneration: 0,
    rootGroup: null,
    labelsGroup: null,
    selectedFeature: null,
    selectionChangeListener: null,
    renderStats: createInitialRenderStats(),
    renderedConfigSignature: "",
    lastRenderedConfig: null,
  };
}

export function getJapanIndustrialZonePackCacheKey(variantId, mode) {
  return `${variantId}:${mode}`;
}

export function createJapanIndustrialZonePreviewLoader(runtime, {
  defaultManifestUrl,
  createIndustrialFeature,
  emitSelectionChange,
  getPackPath,
  normalizeNumber,
} = {}) {
  function isLoadGenerationCurrent(loadGeneration) {
    return loadGeneration === runtime.loadGeneration;
  }

  function resetLoadStateForActivePack() {
    runtime.loadGeneration += 1;
    runtime.manifestPromise = null;
    runtime.auditPromise = null;
    runtime.packPromises.clear();
    runtime.projectedPacks.clear();
    runtime.loadState = createInitialLoadState();
    runtime.activePackMode = null;
    runtime.activeVariantId = null;
    runtime.selectedFeature = null;
    runtime.renderStats = createInitialRenderStats();
    runtime.renderedConfigSignature = "";
    runtime.lastRenderedConfig = null;
  }

  async function loadManifest() {
    if (!runtime.manifestPromise) {
      const loadGeneration = runtime.loadGeneration;
      const manifestUrl = runtime.activeManifestUrl || defaultManifestUrl;
      const activePackId = runtime.activePackId || "default";
      runtime.manifestPromise = getTransportAsset(manifestUrl, {
        cachePolicy: "no-cache",
        label: `transport-manifest:industrial_zones:${activePackId}`,
      })
        .then(async (manifest) => {
          if (!isLoadGenerationCurrent(loadGeneration)) return null;
          if (!manifest) {
            runtime.loadState.status = "pending";
            runtime.loadState.previewStatus = "pending";
            runtime.loadState.error = null;
            runtime.loadState.manifest = null;
            return null;
          }
          runtime.loadState.manifest = manifest;
          return manifest;
        })
        .catch((error) => {
          if (!isLoadGenerationCurrent(loadGeneration)) return null;
          if (Number(error?.httpStatus || 0) === 404) {
            runtime.loadState.status = "pending";
            runtime.loadState.previewStatus = "pending";
            runtime.loadState.error = null;
            runtime.loadState.manifest = null;
            return null;
          }
          runtime.loadState.status = "error";
          runtime.loadState.previewStatus = "error";
          runtime.loadState.error = error instanceof Error ? error.message : String(error);
          throw error;
        });
    }
    return runtime.manifestPromise;
  }

  function setActivePack(packId = "", manifestUrl = "") {
    const normalizedPackId = String(packId || "").trim().toLowerCase();
    const normalizedManifestUrl = String(manifestUrl || defaultManifestUrl).trim();
    if (runtime.activePackId === normalizedPackId && runtime.activeManifestUrl === normalizedManifestUrl) return;
    runtime.activePackId = normalizedPackId;
    runtime.activeManifestUrl = normalizedManifestUrl;
    resetLoadStateForActivePack();
  }

  function startAuditLoad(manifest) {
    if (!manifest?.paths?.build_audit || runtime.loadState.audit || runtime.auditPromise) return runtime.auditPromise;
    const loadGeneration = runtime.loadGeneration;
    runtime.auditPromise = getTransportAsset(manifest.paths.build_audit, {
      cachePolicy: "no-cache",
      label: "transport-audit:industrial_zones",
    })
      .then((audit) => {
        if (!isLoadGenerationCurrent(loadGeneration)) return null;
        runtime.loadState.audit = audit;
        emitSelectionChange?.();
        return audit;
      })
      .catch((error) => {
        if (!isLoadGenerationCurrent(loadGeneration)) return null;
        console.warn("[transport-workbench] Failed to load industrial_zones audit.", error);
        return null;
      });
    return runtime.auditPromise;
  }

  async function loadPack(variantId, mode = INDUSTRIAL_PACK_MODE_PREVIEW) {
    const loadGeneration = runtime.loadGeneration;
    const cacheKey = getJapanIndustrialZonePackCacheKey(variantId, mode);
    if (runtime.projectedPacks.has(cacheKey)) return runtime.projectedPacks.get(cacheKey);
    if (!runtime.packPromises.has(cacheKey)) {
      runtime.packPromises.set(cacheKey, (async () => {
        const isPreview = mode === INDUSTRIAL_PACK_MODE_PREVIEW;
        if (isPreview) {
          runtime.loadState.status = "loading";
          runtime.loadState.previewStatus = "loading";
          runtime.loadState.error = null;
        } else {
          runtime.loadState.fullStatus = "loading";
        }
        const manifest = await loadManifest();
        if (!isLoadGenerationCurrent(loadGeneration)) return null;
        if (!manifest) {
          if (isPreview) {
            runtime.loadState.status = "pending";
            runtime.loadState.previewStatus = "pending";
          } else {
            runtime.loadState.fullStatus = "pending";
          }
          return null;
        }
        startAuditLoad(manifest);
        await ensureTransportWorkbenchCarrierForManifest(manifest);
        if (!isLoadGenerationCurrent(loadGeneration)) return null;
        const packPath = getPackPath(manifest, variantId, mode);
        if (!packPath) {
          throw new Error(`Missing industrial_zones pack path for ${variantId}/${mode}.`);
        }
        const collection = await getTransportAsset(packPath, {
          cachePolicy: "no-cache",
          label: `transport-pack:industrial_zones:${variantId}:${mode}`,
        });
        const sourceFeatures = Array.isArray(collection?.features) ? collection.features : [];
        const features = sourceFeatures
          .map((feature) => createIndustrialFeature(feature, variantId))
          .filter(Boolean);
        if (sourceFeatures.length > 0 && features.length === 0) {
          throw new Error(`Projected zero industrial_zones features for ${variantId}/${mode}; carrier geometry is not ready.`);
        }
        features.sort((left, right) => {
          const leftArea = normalizeNumber(left.bounds?.width, 0) * normalizeNumber(left.bounds?.height, 0);
          const rightArea = normalizeNumber(right.bounds?.width, 0) * normalizeNumber(right.bounds?.height, 0);
          return rightArea - leftArea;
        });
        const pack = {
          mode,
          variantId,
          manifest,
          features,
          featureById: new Map(features.map((feature) => [feature.id, feature])),
        };
        if (!isLoadGenerationCurrent(loadGeneration)) return null;
        runtime.projectedPacks.set(cacheKey, pack);
        if (isPreview) {
          runtime.loadState.status = "ready";
          runtime.loadState.previewStatus = "ready";
        } else {
          runtime.loadState.fullStatus = "ready";
        }
        return pack;
      })().catch((error) => {
        if (!isLoadGenerationCurrent(loadGeneration)) return null;
        runtime.packPromises.delete(cacheKey);
        runtime.projectedPacks.delete(cacheKey);
        if (mode === INDUSTRIAL_PACK_MODE_PREVIEW) {
          runtime.loadState.status = "error";
          runtime.loadState.previewStatus = "error";
          runtime.loadState.error = error instanceof Error ? error.message : String(error);
        } else {
          runtime.loadState.fullStatus = "error";
        }
        throw error;
      }));
    }
    return runtime.packPromises.get(cacheKey);
  }

  function hasPackPath(manifest, variantId, mode) {
    return !!getPackPath(manifest, variantId, mode);
  }

  return {
    hasPackPath,
    isLoadGenerationCurrent,
    loadManifest,
    loadPack,
    resetLoadStateForActivePack,
    setActivePack,
    startAuditLoad,
  };
}
