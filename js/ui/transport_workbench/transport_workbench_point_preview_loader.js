import { createInitialRenderStats } from "./transport_workbench_preview_state.js";
import {
  ensureTransportWorkbenchCarrierForManifest,
  projectTransportWorkbenchCarrierPoint,
} from "./transport_workbench_carrier.js";
import {
  PACK_MODE_FULL,
  PACK_MODE_PREVIEW,
  createTransportWorkbenchEffectivePointPack,
  createTransportWorkbenchPointFeature,
  getTransportWorkbenchPointPackCacheKey,
  getTransportWorkbenchPointPackPath,
  isTransportWorkbenchPointSinglePackPath,
  resolveTransportWorkbenchPointVariantId,
} from "./transport_workbench_point_preview_runtime.js";
import { getTransportAsset } from "../../core/data_service.js";

const resolveVariantId = resolveTransportWorkbenchPointVariantId;
const getPackCacheKey = getTransportWorkbenchPointPackCacheKey;
const getPackPath = getTransportWorkbenchPointPackPath;
const isSinglePackPath = isTransportWorkbenchPointSinglePackPath;

function createInitialLoadState() {
  return {
    status: "idle",
    error: null,
    manifest: null,
    audit: null,
    subtypeCatalog: null,
    singlePack: false,
    previewStatus: "idle",
    fullStatus: "idle",
  };
}

export function createTransportWorkbenchPointPreviewRuntime(definition) {
  return {
    definition,
    manifestPromise: null,
    auditPromise: null,
    subtypeCatalogPromise: null,
    packPromises: new Map(),
    packPaths: new Map(),
    projectedPacks: new Map(),
    loadState: createInitialLoadState(),
    activePackMode: null,
    activeVariantId: null,
    activePack: null,
    rootGroup: null,
    labelsGroup: null,
    selectedFeature: null,
    selectionChangeListener: null,
    labelDescriptors: [],
    renderStats: createInitialRenderStats(),
    renderedConfigSignature: "",
    renderedViewSignature: "",
    lastRenderedConfig: null,
    activePackId: "",
    activeManifestUrl: definition.manifestUrl,
    loadGeneration: 0,
  };
}

function createPointFeature(rawFeature, definition, variantId = "") {
  return createTransportWorkbenchPointFeature(rawFeature, definition, variantId, {
    projectPoint: projectTransportWorkbenchCarrierPoint,
  });
}

export function createEffectiveTransportWorkbenchPointPack(sourcePack, config, definition, options = {}) {
  return createTransportWorkbenchEffectivePointPack(sourcePack, config, definition, {
    ...options,
    projectFeature: typeof options.projectFeature === "function" ? options.projectFeature : createPointFeature,
  });
}

export function createTransportWorkbenchPointPreviewLoader(runtime, definition, {
  emitSelectionChange = () => {},
} = {}) {
  function resetLoadStateForActivePack() {
    runtime.loadGeneration += 1;
    runtime.manifestPromise = null;
    runtime.auditPromise = null;
    runtime.subtypeCatalogPromise = null;
    runtime.packPromises = new Map();
    runtime.packPaths = new Map();
    runtime.projectedPacks = new Map();
    runtime.loadState = createInitialLoadState();
    runtime.activePackMode = null;
    runtime.activeVariantId = null;
    runtime.activePack = null;
    runtime.selectedFeature = null;
    runtime.renderedConfigSignature = "";
    runtime.renderedViewSignature = "";
    runtime.labelDescriptors = [];
    runtime.lastRenderedConfig = null;
  }

  function setActivePack(packId = "", manifestUrl = "") {
    const normalizedPackId = String(packId || "").trim().toLowerCase();
    const normalizedManifestUrl = String(manifestUrl || definition.manifestUrl || "").trim();
    if (runtime.activePackId === normalizedPackId && runtime.activeManifestUrl === normalizedManifestUrl) return;
    runtime.activePackId = normalizedPackId;
    runtime.activeManifestUrl = normalizedManifestUrl;
    resetLoadStateForActivePack();
  }

  function isLoadGenerationCurrent(loadGeneration) {
    return loadGeneration === runtime.loadGeneration;
  }

  async function loadManifest() {
    if (!runtime.manifestPromise) {
      const loadGeneration = runtime.loadGeneration;
      const manifestUrl = runtime.activeManifestUrl || definition.manifestUrl;
      const activePackId = runtime.activePackId || "default";
      runtime.manifestPromise = getTransportAsset(manifestUrl, {
        cachePolicy: "no-cache",
        label: `transport-manifest:${definition.familyId}:${activePackId}`,
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

  function startAuditLoad(manifest) {
    if (!manifest?.paths?.build_audit || runtime.loadState.audit || runtime.auditPromise) return runtime.auditPromise;
    const loadGeneration = runtime.loadGeneration;
    runtime.auditPromise = getTransportAsset(manifest.paths.build_audit, {
      cachePolicy: "no-cache",
      label: `transport-audit:${definition.familyId}`,
    })
      .then((audit) => {
        if (!isLoadGenerationCurrent(loadGeneration)) return null;
        runtime.loadState.audit = audit;
        emitSelectionChange();
        return audit;
      })
      .catch((error) => {
        if (!isLoadGenerationCurrent(loadGeneration)) return null;
        console.warn(`[transport-workbench] Failed to load ${definition.familyId} audit.`, error);
        return null;
      });
    return runtime.auditPromise;
  }

  function startSubtypeCatalogLoad(manifest) {
    if (!manifest?.paths?.subtype_catalog || runtime.loadState.subtypeCatalog || runtime.subtypeCatalogPromise) {
      return runtime.subtypeCatalogPromise;
    }
    const loadGeneration = runtime.loadGeneration;
    runtime.subtypeCatalogPromise = getTransportAsset(manifest.paths.subtype_catalog, {
      cachePolicy: "no-cache",
      label: `transport-subtype-catalog:${definition.familyId}`,
    })
      .then((subtypeCatalog) => {
        if (!isLoadGenerationCurrent(loadGeneration)) return null;
        runtime.loadState.subtypeCatalog = Array.isArray(subtypeCatalog) ? subtypeCatalog : null;
        emitSelectionChange();
        return runtime.loadState.subtypeCatalog;
      })
      .catch((error) => {
        if (!isLoadGenerationCurrent(loadGeneration)) return null;
        console.warn(`[transport-workbench] Failed to load ${definition.familyId} subtype catalog.`, error);
        return null;
      });
    return runtime.subtypeCatalogPromise;
  }

  async function loadPack(mode = PACK_MODE_PREVIEW, config = {}) {
    const loadGeneration = runtime.loadGeneration;
    const isPreview = mode === PACK_MODE_PREVIEW;
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
      runtime.activeVariantId = null;
      runtime.loadState.singlePack = false;
      if (isPreview) {
        runtime.loadState.status = "pending";
        runtime.loadState.previewStatus = "pending";
      } else {
        runtime.loadState.fullStatus = "pending";
      }
      return null;
    }
    startAuditLoad(manifest);
    startSubtypeCatalogLoad(manifest);
    await ensureTransportWorkbenchCarrierForManifest(manifest);
    if (!isLoadGenerationCurrent(loadGeneration)) return null;
    const variantId = resolveVariantId(manifest, definition, config);
    const cacheKey = getPackCacheKey(mode, variantId);
    runtime.loadState.singlePack = isSinglePackPath(manifest, definition.packKey, definition, variantId);
    if (runtime.projectedPacks.has(cacheKey)) {
      if (isPreview) {
        runtime.loadState.status = "ready";
        runtime.loadState.previewStatus = "ready";
      } else {
        runtime.loadState.fullStatus = "ready";
      }
      return runtime.projectedPacks.get(cacheKey);
    }
    if (!runtime.packPromises.has(cacheKey)) {
      runtime.packPromises.set(cacheKey, (async () => {
        const packPath = getPackPath(manifest, mode, definition.packKey, definition, variantId);
        runtime.packPaths.set(cacheKey, packPath);
        const aliasMode = mode === PACK_MODE_PREVIEW ? PACK_MODE_FULL : PACK_MODE_PREVIEW;
        const aliasCacheKey = getPackCacheKey(aliasMode, variantId);
        if (runtime.packPaths.get(aliasCacheKey) && runtime.packPaths.get(aliasCacheKey) === packPath) {
          if (runtime.projectedPacks.has(aliasCacheKey)) {
            const aliasPack = runtime.projectedPacks.get(aliasCacheKey);
            if (!isLoadGenerationCurrent(loadGeneration)) return null;
            runtime.projectedPacks.set(cacheKey, aliasPack);
            if (isPreview) {
              runtime.loadState.status = "ready";
              runtime.loadState.previewStatus = "ready";
            } else {
              runtime.loadState.fullStatus = "ready";
            }
            return aliasPack;
          }
          if (runtime.packPromises.has(aliasCacheKey)) {
            const aliasPack = await runtime.packPromises.get(aliasCacheKey);
            if (!isLoadGenerationCurrent(loadGeneration)) return null;
            runtime.projectedPacks.set(cacheKey, aliasPack);
            if (isPreview) {
              runtime.loadState.status = "ready";
              runtime.loadState.previewStatus = "ready";
            } else {
              runtime.loadState.fullStatus = "ready";
            }
            return aliasPack;
          }
        }
        if (!packPath) {
          const variantPrefix = variantId ? `${variantId}/` : "";
          throw new Error(`Missing ${definition.familyId} pack path for ${variantPrefix}${mode}.`);
        }
        const collection = await getTransportAsset(packPath, {
          cachePolicy: "no-cache",
          label: `transport-pack:${definition.familyId}:${variantId || "default"}:${mode}`,
        });
        const sourceFeatures = Array.isArray(collection?.features) ? collection.features : [];
        const features = sourceFeatures
          .map((feature) => createPointFeature(feature, definition, variantId))
          .filter(Boolean);
        if (sourceFeatures.length > 0 && features.length === 0) {
          const variantPrefix = variantId ? `${variantId}/` : "";
          throw new Error(`Projected zero ${definition.familyId} features for ${variantPrefix}${mode}; carrier geometry is not ready.`);
        }
        const pack = {
          mode,
          path: packPath,
          manifest,
          audit: runtime.loadState.audit,
          variantId,
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
        if (mode === PACK_MODE_PREVIEW) {
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

  return {
    isLoadGenerationCurrent,
    loadManifest,
    loadPack,
    resetLoadStateForActivePack,
    setActivePack,
    startAuditLoad,
    startSubtypeCatalogLoad,
  };
}

export const __transportWorkbenchPointPreviewLoaderTestInternals = Object.freeze({
  createEffectiveTransportWorkbenchPointPack,
  getPackCacheKey,
  getPackPath,
  isSinglePackPath,
});
