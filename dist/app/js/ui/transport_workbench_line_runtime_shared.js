import { getTransportAsset } from "../core/data_service.js";
import { registerMapcreatorSnapshotProvider } from "../core/mapcreator_snapshot.js";
import { createChunkLoadScheduler } from "../core/scenario/chunk_load_scheduler.js";
import { pageResourceBudget } from "../core/runtime_resource_budget.js";

export const PACK_MODE_PREVIEW = "preview";
export const PACK_MODE_FULL = "full";
const sharedTransportScheduler = createChunkLoadScheduler();

export function createTransportWorkbenchSvgNode(tagName) {
  return document.createElementNS("http://www.w3.org/2000/svg", tagName);
}

export function normalizeTransportWorkbenchNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

export function createTransportWorkbenchLinePathDFromCoordinates(line) {
  if (!Array.isArray(line) || !line.length) return "";
  return line.map((point, index) => `${index === 0 ? "M" : "L"} ${point[0]} ${point[1]}`).join(" ");
}

function listTransportWorkbenchLineGeometryParts(geometry) {
  if (!geometry || typeof geometry !== "object") return [];
  if (geometry.type === "LineString") {
    return Array.isArray(geometry.coordinates) ? [geometry.coordinates] : [];
  }
  if (geometry.type === "MultiLineString") {
    return Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
  }
  return [];
}

export function createTransportWorkbenchLinePathD(geometry) {
  return listTransportWorkbenchLineGeometryParts(geometry)
    .map((line) => createTransportWorkbenchLinePathDFromCoordinates(line))
    .filter(Boolean)
    .join(" ");
}

export function measureTransportWorkbenchProjectedLineLength(geometry) {
  let length = 0;
  listTransportWorkbenchLineGeometryParts(geometry).forEach((line) => {
    for (let index = 1; index < line.length; index += 1) {
      const [x0, y0] = line[index - 1];
      const [x1, y1] = line[index];
      length += Math.hypot(x1 - x0, y1 - y0);
    }
  });
  return length;
}

export function buildTransportWorkbenchProjectedLines(geometry) {
  return listTransportWorkbenchLineGeometryParts(geometry)
    .filter((line) => Array.isArray(line) && line.length >= 2)
    .map((line) => {
      let length = 0;
      const segments = [];
      for (let index = 1; index < line.length; index += 1) {
        const start = line[index - 1];
        const end = line[index];
        const dx = end[0] - start[0];
        const dy = end[1] - start[1];
        const segmentLength = Math.hypot(dx, dy);
        segments.push({
          start,
          end,
          startDistance: length,
          length: segmentLength,
          angle: Math.atan2(dy, dx) * (180 / Math.PI),
        });
        length += segmentLength;
      }
      return {
        points: line,
        pathD: createTransportWorkbenchLinePathDFromCoordinates(line),
        length,
        segments,
      };
    })
    .filter((line) => line.length > 0);
}

export function keepFirstTransportWorkbenchGridBucket(entries, {
  gridSize,
  getScreenPoint,
  getBucketParts = () => [],
} = {}) {
  const usedBuckets = new Set();
  return entries.filter((entry) => {
    const screenPoint = getScreenPoint(entry);
    if (!screenPoint) return false;
    const bucketParts = [
      Math.round(screenPoint.x / gridSize),
      Math.round(screenPoint.y / gridSize),
      ...getBucketParts(entry),
    ];
    const bucketKey = bucketParts.join(":");
    if (usedBuckets.has(bucketKey)) return false;
    usedBuckets.add(bucketKey);
    return true;
  });
}

function datasetKeyToAttributeName(datasetKey) {
  return String(datasetKey || "").replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

export function findTransportWorkbenchDatasetNode(startNode, datasetKey, boundaryNode) {
  const ElementCtor = boundaryNode?.ownerDocument?.defaultView?.Element || globalThis.Element;
  const startElement = ElementCtor && startNode instanceof ElementCtor
    ? startNode
    : startNode?.parentElement;
  if (!startElement || typeof startElement.closest !== "function") return null;
  const datasetAttribute = datasetKeyToAttributeName(datasetKey);
  const node = startElement.closest(`[data-${datasetAttribute}]`);
  if (!node) return null;
  if (!boundaryNode) return node;
  if (node === boundaryNode) return node;
  return typeof boundaryNode.contains === "function" && boundaryNode.contains(node) ? node : null;
}

export function syncTransportWorkbenchSvgGroupOrder(group, orderedNodes) {
  let previousNode = null;
  orderedNodes.forEach((node) => {
    if (!node.parentNode) {
      group.appendChild(node);
      previousNode = node;
      return;
    }
    if (!previousNode) {
      if (group.firstChild !== node) {
        group.insertBefore(node, group.firstChild);
      }
    } else if (previousNode.nextSibling !== node) {
      group.insertBefore(node, previousNode.nextSibling);
    }
    previousNode = node;
  });
}

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
  let packPath = "";
  if (modePaths && typeof modePaths === "object") {
    packPath = modePaths[key] || "";
  } else {
    packPath = manifest?.paths?.[key] || "";
  }
  if (!packPath) {
    throw new Error(`Transport workbench manifest is missing ${mode}/${key} pack path.`);
  }
  return packPath;
}

export function createTransportWorkbenchLinePackRuntime(definition, {
  getAsset = getTransportAsset,
  resourceBudget = pageResourceBudget,
  scheduler = resourceBudget === pageResourceBudget ? sharedTransportScheduler : createChunkLoadScheduler({ resourceBudget }),
  yieldTask = () => new Promise((resolve) => setTimeout(resolve, 0)),
} = {}) {
  // Each family owns its promises, projected geometry and selection. Neither
  // this lifetime nor shared resource accounting may mutate political state.
  const runtime = {
    manifestPromise: null,
    auditPromise: null,
    packPromises: { [PACK_MODE_PREVIEW]: null, [PACK_MODE_FULL]: null },
    projectedPacks: { [PACK_MODE_PREVIEW]: null, [PACK_MODE_FULL]: null },
    activePack: null,
    activePackMode: null,
    loadState: createInitialLoadState(),
    selectedFeature: null,
    selectionChangeListener: null,
    lastRenderedConfig: null,
    renderStats: { ...(definition.initialRenderStats || {}) },
    activePackId: "",
    activeManifestUrl: definition.manifestUrl,
    loadGeneration: 0,
  };
  const fetchOptions = definition.fetchOptions || { cache: "no-cache" };
  const packResourceOwner = Symbol(`transport:${definition.familyId}`);
  let controller = new AbortController();
  let packTaskKeys = new Map();
  let packWeights = new Map();
  let releaseCount = 0;

  function reportPackRetention() {
    if (!packWeights.size) resourceBudget.release(packResourceOwner);
    else resourceBudget.update(packResourceOwner, { transport: [...packWeights.values()].some((bytes) => bytes === null)
      ? null : [...packWeights.values()].reduce((sum, bytes) => sum + bytes, 0) });
  }

  function resetLoadStateForActivePack() {
    runtime.loadGeneration += 1;
    controller.abort();
    controller = new AbortController();
    packTaskKeys = new Map();
    packWeights = new Map();
    resourceBudget.release(packResourceOwner);
    runtime.manifestPromise = null;
    runtime.auditPromise = null;
    runtime.packPromises = { [PACK_MODE_PREVIEW]: null, [PACK_MODE_FULL]: null };
    runtime.projectedPacks = { [PACK_MODE_PREVIEW]: null, [PACK_MODE_FULL]: null };
    runtime.activePack = null;
    runtime.activePackMode = null;
    runtime.loadState = createInitialLoadState();
    runtime.selectedFeature = null;
    runtime.lastRenderedConfig = null;
  }

  function release({ preserveSelection = false } = {}) {
    const selected = preserveSelection ? runtime.selectedFeature : null;
    resetLoadStateForActivePack();
    runtime.selectedFeature = selected;
    releaseCount++;
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
      const signal = controller.signal;
      const manifestUrl = runtime.activeManifestUrl || definition.manifestUrl;
      const activePackId = runtime.activePackId || "default";
      runtime.manifestPromise = (async () => {
        definition.ensureClient?.();
        const manifest = await getAsset(manifestUrl, {
          cachePolicy: fetchOptions.cache,
          label: `transport-manifest:${definition.familyId}:${activePackId}`,
          signal,
        });
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
      })().catch((error) => {
        if (!isLoadGenerationCurrent(loadGeneration)) return null;
        if (Number(error?.httpStatus || 0) === 404 && definition.allowPendingManifest) {
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

  function startAuditLoad(manifest, onAuditReady) {
    if (!manifest?.paths?.build_audit || runtime.loadState.audit || runtime.auditPromise) return runtime.auditPromise;
    const loadGeneration = runtime.loadGeneration;
    const signal = controller.signal;
    runtime.auditPromise = scheduler.schedule(() => getAsset(manifest.paths.build_audit, {
      cachePolicy: fetchOptions.cache,
      label: `transport-audit:${definition.familyId}`,
      signal,
    }), { signal, speculative: true, priority: -1 })
      .then((audit) => {
        if (!isLoadGenerationCurrent(loadGeneration)) return null;
        runtime.loadState.audit = audit;
        onAuditReady?.(audit);
        return audit;
      })
      .catch((error) => {
        if (!isLoadGenerationCurrent(loadGeneration)) return null;
        console.warn(`[transport-workbench] Failed to load ${definition.familyId} audit.`, error);
        return null;
      });
    return runtime.auditPromise;
  }

  async function loadPack(mode = PACK_MODE_PREVIEW, onAuditReady, { speculative = false } = {}) {
    if (mode !== PACK_MODE_PREVIEW && mode !== PACK_MODE_FULL) throw new TypeError("Unknown transport pack mode.");
    if (runtime.projectedPacks[mode]) return runtime.projectedPacks[mode];
    if (runtime.packPromises[mode]) {
      if (!speculative) scheduler.promote(packTaskKeys.get(mode), 1);
      return runtime.packPromises[mode];
    }
    const loadGeneration = runtime.loadGeneration;
    const signal = controller.signal;
    const taskKey = Symbol(`${definition.familyId}:${mode}:${loadGeneration}`);
    packTaskKeys.set(mode, taskKey);
    const hint = definition.estimatedLoadBytes?.[mode];
    runtime.packPromises[mode] = scheduler.schedule(async () => {
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
        if (isPreview) {
          runtime.loadState.status = "pending";
          runtime.loadState.previewStatus = "pending";
        } else {
          runtime.loadState.fullStatus = "pending";
        }
        return null;
      }
      startAuditLoad(manifest, onAuditReady);
      await yieldTask();
      if (!isLoadGenerationCurrent(loadGeneration)) return null;
      await definition.prepareCarrier?.(manifest);
      if (!isLoadGenerationCurrent(loadGeneration)) return null;
      const pack = await definition.buildPack({
        mode,
        manifest,
        runtime,
        fetchOptions,
        signal,
        isCurrent: () => isLoadGenerationCurrent(loadGeneration),
        getPackPath: getTransportWorkbenchPackPath,
        loadTransportAsset: (path, overrides = {}) => getAsset(path, {
          cachePolicy: overrides.cachePolicy || fetchOptions.cache,
          label: overrides.label || `transport-pack:${definition.familyId}:${mode}`,
          signal,
        }),
      });
      if (!isLoadGenerationCurrent(loadGeneration)) return null;
      runtime.projectedPacks[mode] = pack;
      let weight = null;
      try { weight = definition.estimatePackBytes?.(pack); } catch { /* Keep valid content, report unknown weight. */ }
      packWeights.set(mode, Number.isSafeInteger(weight) && weight >= 0 ? weight : null);
      reportPackRetention();
      if (isPreview) {
        runtime.loadState.status = "ready";
        runtime.loadState.previewStatus = "ready";
        runtime.loadState.error = null;
      } else {
        runtime.loadState.fullStatus = "ready";
      }
      return pack;
    }, { key: taskKey, signal, priority: speculative ? -1 : 1, speculative,
      ...(Number.isSafeInteger(hint) && hint > 0 ? { bytes: hint } : {}) })
      .catch((error) => {
        if (!isLoadGenerationCurrent(loadGeneration)) return null;
        if (mode === PACK_MODE_PREVIEW) {
          runtime.loadState.status = "error";
          runtime.loadState.previewStatus = "error";
          runtime.loadState.error = error instanceof Error ? error.message : String(error);
        } else {
          runtime.loadState.fullStatus = "error";
        }
        throw error;
      });
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
      lifetime: { generation: runtime.loadGeneration, releaseCount, retainedPackCount: packWeights.size,
        estimatedPackBytes: [...packWeights.values()].some((bytes) => bytes === null)
          ? null : [...packWeights.values()].reduce((sum, bytes) => sum + bytes, 0),
        accounting: "owned-pack-retention-estimates-not-heap", sharedResources: resourceBudget.snapshot() },
    };
  }

  function emitSelectionChange(getSelectedSnapshot) {
    runtime.selectionChangeListener?.(getSnapshot(getSelectedSnapshot));
  }

  function startBackgroundFullPackLoad({ onAuditReady, onHydrated } = {}) {
    if (runtime.projectedPacks[PACK_MODE_FULL] || runtime.packPromises[PACK_MODE_FULL]) return;
    const loadGeneration = runtime.loadGeneration;
    loadPack(PACK_MODE_FULL, onAuditReady, { speculative: true })
      .then((pack) => {
        if (!pack || !isLoadGenerationCurrent(loadGeneration)) return;
        onHydrated?.(pack);
      })
      .catch((error) => {
        if (!isLoadGenerationCurrent(loadGeneration)) return;
        console.warn(`[transport-workbench] Failed to hydrate full ${definition.familyId} pack.`, error);
      });
  }

  async function warm({ includeFull = false, onAuditReady, onHydrated } = {}) {
    const loadGeneration = runtime.loadGeneration;
    await loadPack(PACK_MODE_PREVIEW, onAuditReady);
    if (isLoadGenerationCurrent(loadGeneration) && includeFull && runtime.loadState.status === "ready") {
      startBackgroundFullPackLoad({ onAuditReady, onHydrated });
    }
    return getSnapshot();
  }

  registerMapcreatorSnapshotProvider("loadStatus", `transport_preview:${definition.familyId}`, () => (
    getSnapshot()
  ));

  return {
    runtime,
    emitSelectionChange,
    getSnapshot,
    loadPack,
    pickActivePack,
    setSelectionListener,
    startBackgroundFullPackLoad,
    warm,
    setActivePack,
    release,
  };
}
