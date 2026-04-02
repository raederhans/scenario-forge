export const PACK_MODE_PREVIEW = "preview";
export const PACK_MODE_FULL = "full";

function createInitialLoadState() {
  return {
    status: "idle",
    error: null,
    manifest: null,
    audit: null,
    previewStatus: "idle",
    fullStatus: "idle",
  };
}

export function getTransportWorkbenchPackPath(manifest, mode, key) {
  const modePaths = manifest?.paths?.[mode];
  if (modePaths && typeof modePaths === "object") {
    return modePaths[key] || "";
  }
  return manifest?.paths?.[key] || "";
}

export function createTransportWorkbenchLinePackRuntime(definition) {
  const runtime = {
    manifestPromise: null,
    auditPromise: null,
    packPromises: {
      [PACK_MODE_PREVIEW]: null,
      [PACK_MODE_FULL]: null,
    },
    projectedPacks: {
      [PACK_MODE_PREVIEW]: null,
      [PACK_MODE_FULL]: null,
    },
    activePack: null,
    activePackMode: null,
    loadState: createInitialLoadState(),
    selectedFeature: null,
    selectionChangeListener: null,
    lastRenderedConfig: null,
    renderStats: { ...(definition.initialRenderStats || {}) },
  };
  const fetchOptions = definition.fetchOptions || { cache: "no-cache" };

  async function loadManifest() {
    if (!runtime.manifestPromise) {
      runtime.manifestPromise = (async () => {
        definition.ensureClient?.();
        const response = await fetch(definition.manifestUrl, fetchOptions);
        if (response.status === 404 && definition.allowPendingManifest) {
          runtime.loadState.status = "pending";
          runtime.loadState.previewStatus = "pending";
          runtime.loadState.error = null;
          runtime.loadState.manifest = null;
          return null;
        }
        if (!response.ok) {
          throw new Error(`Failed to load ${definition.familyLabel} manifest: ${response.status}`);
        }
        const manifest = await response.json();
        runtime.loadState.manifest = manifest;
        return manifest;
      })().catch((error) => {
        runtime.loadState.status = "error";
        runtime.loadState.previewStatus = "error";
        runtime.loadState.error = error instanceof Error ? error.message : String(error);
        throw error;
      });
    }
    return runtime.manifestPromise;
  }

  function startAuditLoad(manifest, onAuditReady) {
    if (!manifest?.paths?.build_audit || runtime.loadState.audit || runtime.auditPromise) return runtime.auditPromise;
    runtime.auditPromise = fetch(manifest.paths.build_audit, fetchOptions)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to load ${definition.familyLabel} audit: ${response.status}`);
        }
        const audit = await response.json();
        runtime.loadState.audit = audit;
        onAuditReady?.(audit);
        return audit;
      })
      .catch((error) => {
        console.warn(`[transport-workbench] Failed to load ${definition.familyId} audit.`, error);
        return null;
      });
    return runtime.auditPromise;
  }

  async function loadPack(mode = PACK_MODE_PREVIEW, onAuditReady) {
    if (runtime.projectedPacks[mode]) return runtime.projectedPacks[mode];
    if (!runtime.packPromises[mode]) {
      runtime.packPromises[mode] = (async () => {
        const isPreview = mode === PACK_MODE_PREVIEW;
        if (isPreview) {
          runtime.loadState.status = "loading";
          runtime.loadState.previewStatus = "loading";
          runtime.loadState.error = null;
        } else {
          runtime.loadState.fullStatus = "loading";
        }
        const manifest = await loadManifest();
        if (!manifest) {
          if (isPreview) {
            runtime.loadState.status = "pending";
            runtime.loadState.previewStatus = "pending";
          } else {
            runtime.loadState.fullStatus = "pending";
          }
          return null;
        }
        startAuditLoad(manifest, onAuditReady);
        const pack = await definition.buildPack({
          mode,
          manifest,
          runtime,
          fetchOptions,
          getPackPath: getTransportWorkbenchPackPath,
        });
        runtime.projectedPacks[mode] = pack;
        if (isPreview) {
          runtime.loadState.status = "ready";
          runtime.loadState.previewStatus = "ready";
          runtime.loadState.error = null;
        } else {
          runtime.loadState.fullStatus = "ready";
        }
        return pack;
      })().catch((error) => {
        if (mode === PACK_MODE_PREVIEW) {
          runtime.loadState.status = "error";
          runtime.loadState.previewStatus = "error";
          runtime.loadState.error = error instanceof Error ? error.message : String(error);
        } else {
          runtime.loadState.fullStatus = "error";
        }
        throw error;
      });
    }
    return runtime.packPromises[mode];
  }

  function pickActivePack() {
    return runtime.projectedPacks[PACK_MODE_FULL] || runtime.projectedPacks[PACK_MODE_PREVIEW] || null;
  }

  function setSelectionListener(listener) {
    runtime.selectionChangeListener = typeof listener === "function" ? listener : null;
  }

  function getSnapshot(getSelectedSnapshot) {
    return {
      status: runtime.loadState.status,
      error: runtime.loadState.error,
      manifest: runtime.loadState.manifest,
      audit: runtime.loadState.audit,
      stats: { ...runtime.renderStats },
      packMode: runtime.activePackMode,
      previewStatus: runtime.loadState.previewStatus,
      fullStatus: runtime.loadState.fullStatus,
      selected: typeof getSelectedSnapshot === "function"
        ? getSelectedSnapshot(runtime.lastRenderedConfig)
        : runtime.selectedFeature,
    };
  }

  function emitSelectionChange(getSelectedSnapshot) {
    runtime.selectionChangeListener?.(getSnapshot(getSelectedSnapshot));
  }

  function startBackgroundFullPackLoad({ onAuditReady, onHydrated } = {}) {
    if (runtime.projectedPacks[PACK_MODE_FULL] || runtime.packPromises[PACK_MODE_FULL]) return;
    loadPack(PACK_MODE_FULL, onAuditReady)
      .then((pack) => {
        if (!pack) return;
        onHydrated?.(pack);
      })
      .catch((error) => {
        console.warn(`[transport-workbench] Failed to hydrate full ${definition.familyId} pack.`, error);
      });
  }

  async function warm({ includeFull = false, onAuditReady, onHydrated } = {}) {
    await loadPack(PACK_MODE_PREVIEW, onAuditReady);
    if (includeFull && runtime.loadState.status === "ready") {
      startBackgroundFullPackLoad({ onAuditReady, onHydrated });
    }
    return getSnapshot();
  }

  return {
    runtime,
    emitSelectionChange,
    getSnapshot,
    loadPack,
    pickActivePack,
    setSelectionListener,
    startBackgroundFullPackLoad,
    warm,
  };
}
