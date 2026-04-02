import {
  getTransportWorkbenchCarrierOverlayRoots,
  getTransportWorkbenchCarrierViewState,
  projectTransportWorkbenchCarrierGeometry,
  projectTransportWorkbenchCarrierScenePoint,
} from "./transport_workbench_carrier.js";

const PACK_MODE_PREVIEW = "preview";
const PACK_MODE_FULL = "full";
const MANIFEST_URL = "data/transport_layers/japan_industrial_zones/manifest.json";
const PACK_KEY = "industrial_zones";
const INTERNAL_LABEL_THRESHOLD = 1.2;
const OPEN_LABEL_THRESHOLD = 1.32;
const INDUSTRIAL_LABEL_GRID_BY_DENSITY = {
  very_sparse: 230,
  sparse: 192,
  balanced: 160,
  dense: 132,
  very_dense: 108,
};

function createSvgNode(tagName) {
  return document.createElementNS("http://www.w3.org/2000/svg", tagName);
}

function normalizeNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function getCurrentScale() {
  return normalizeNumber(getTransportWorkbenchCarrierViewState()?.scale, 1);
}

function getDefaultVariantId(manifest) {
  const variants = manifest?.distribution_variants;
  if (variants && typeof variants === "object") {
    const candidate = String(
      manifest?.default_distribution_variant
      || manifest?.default_variant
      || ""
    ).trim();
    if (candidate && variants[candidate]) return candidate;
    const [firstVariantId] = Object.keys(variants);
    if (firstVariantId) return firstVariantId;
  }
  return "internal";
}

function resolveVariantId(manifest, config) {
  const requestedVariant = String(config?.variant || "").trim();
  const variants = manifest?.distribution_variants;
  if (requestedVariant && variants?.[requestedVariant]) {
    return requestedVariant;
  }
  return getDefaultVariantId(manifest);
}

function getVariantMeta(manifest, variantId) {
  const variants = manifest?.distribution_variants;
  if (variants && typeof variants === "object" && variants[variantId]) {
    return variants[variantId];
  }
  return manifest || null;
}

function getPackPath(manifest, variantId, mode) {
  const variantMeta = getVariantMeta(manifest, variantId);
  const modePaths = variantMeta?.paths?.[mode];
  if (modePaths && typeof modePaths === "object") {
    return modePaths[PACK_KEY] || "";
  }
  return variantMeta?.paths?.[PACK_KEY] || "";
}

function isFiniteCoordinatePair(point) {
  return Array.isArray(point)
    && point.length >= 2
    && Number.isFinite(point[0])
    && Number.isFinite(point[1]);
}

function appendRingPath(ring, pathParts) {
  let wrotePoint = false;
  ring.forEach((point, index) => {
    if (!isFiniteCoordinatePair(point)) return;
    const command = wrotePoint || index > 0 ? "L" : "M";
    pathParts.push(`${command} ${point[0]} ${point[1]}`);
    wrotePoint = true;
  });
  if (wrotePoint) pathParts.push("Z");
  return wrotePoint;
}

function buildPolygonPath(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) return "";
  const pathParts = [];
  if (geometry.type === "Polygon") {
    geometry.coordinates.forEach((ring) => {
      appendRingPath(ring, pathParts);
    });
    return pathParts.join(" ");
  }
  if (geometry.type === "MultiPolygon") {
    geometry.coordinates.forEach((polygon) => {
      polygon.forEach((ring) => {
        appendRingPath(ring, pathParts);
      });
    });
    return pathParts.join(" ");
  }
  return "";
}

function updateBounds(point, bounds) {
  if (!isFiniteCoordinatePair(point)) return;
  bounds.minX = Math.min(bounds.minX, point[0]);
  bounds.maxX = Math.max(bounds.maxX, point[0]);
  bounds.minY = Math.min(bounds.minY, point[1]);
  bounds.maxY = Math.max(bounds.maxY, point[1]);
}

function collectGeometryBounds(geometry) {
  const bounds = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
  if (!geometry || !Array.isArray(geometry.coordinates)) return null;
  const visitRing = (ring) => {
    if (!Array.isArray(ring)) return;
    ring.forEach((point) => updateBounds(point, bounds));
  };
  if (geometry.type === "Polygon") {
    geometry.coordinates.forEach(visitRing);
  } else if (geometry.type === "MultiPolygon") {
    geometry.coordinates.forEach((polygon) => polygon.forEach(visitRing));
  }
  if (!Number.isFinite(bounds.minX) || !Number.isFinite(bounds.minY)) return null;
  return {
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
    width: Math.max(0, bounds.maxX - bounds.minX),
    height: Math.max(0, bounds.maxY - bounds.minY),
    centerX: (bounds.minX + bounds.maxX) / 2,
    centerY: (bounds.minY + bounds.maxY) / 2,
  };
}

function createPolygonFeature(rawFeature, variantId) {
  const properties = rawFeature?.properties || {};
  const projected = projectTransportWorkbenchCarrierGeometry(rawFeature?.geometry, "main");
  if (!projected?.geometry) return null;
  const pathData = buildPolygonPath(projected.geometry);
  if (!pathData) return null;
  const bounds = collectGeometryBounds(projected.geometry);
  if (!bounds) return null;
  return {
    id: String(properties.id || rawFeature?.id || "").trim(),
    name: String(properties.name || "").trim(),
    variant: variantId,
    properties,
    pathData,
    bounds,
  };
}

function getVariantStyle(config, variantId) {
  const fillOpacity = Math.max(0.18, Math.min(0.96, normalizeNumber(config?.fillOpacity, 74) / 100));
  const outlineOpacity = Math.max(0.28, Math.min(1, normalizeNumber(config?.outlineOpacity, 88) / 100));
  if (variantId === "open") {
    return {
      fill: "#c2410c",
      fillOpacity,
      stroke: "#431407",
      strokeOpacity: outlineOpacity,
      strokeWidth: 0.82,
      selectedStroke: "#111827",
      selectedStrokeWidth: 1.6,
      labelColor: "#7c2d12",
      labelHalo: "#ffedd5",
    };
  }
  return {
    fill: "#475569",
    fillOpacity,
    stroke: "#0f172a",
    strokeOpacity: outlineOpacity,
    strokeWidth: 0.88,
    selectedStroke: "#020617",
    selectedStrokeWidth: 1.72,
    labelColor: "#1e293b",
    labelHalo: "#f8fafc",
  };
}

function ensureRootGroups(runtime) {
  const roots = getTransportWorkbenchCarrierOverlayRoots();
  const landRoot = roots?.land?.main;
  const labelRoot = roots?.labels?.main;
  if (!landRoot || !labelRoot) {
    throw new Error("industrial_zones preview carrier overlays are unavailable.");
  }
  if (!runtime.rootGroup || runtime.rootGroup.parentNode !== landRoot) {
    runtime.rootGroup = createSvgNode("g");
    runtime.rootGroup.setAttribute("class", "transport-workbench-industrial-zones-preview-layer");
    landRoot.appendChild(runtime.rootGroup);
  }
  if (!runtime.labelsGroup || runtime.labelsGroup.parentNode !== labelRoot) {
    runtime.labelsGroup = createSvgNode("g");
    runtime.labelsGroup.setAttribute("class", "transport-workbench-industrial-zones-preview-label-layer");
    labelRoot.appendChild(runtime.labelsGroup);
  }
}

function clearGroups(runtime) {
  runtime.rootGroup?.replaceChildren();
  runtime.labelsGroup?.replaceChildren();
}

function shouldShowLabel(feature, config, variantId, scale) {
  if (!config?.showLabels || !feature.name) return false;
  const threshold = variantId === "open" ? OPEN_LABEL_THRESHOLD : INTERNAL_LABEL_THRESHOLD;
  return scale >= threshold;
}

function getHiddenReason(feature, config, variantId) {
  if (Array.isArray(config?.siteClasses) && config.siteClasses.length > 0) {
    if (!config.siteClasses.includes(String(feature.properties.site_class || "").trim())) {
      return "site_class_filtered";
    }
  }
  if (variantId === "internal" && Array.isArray(config?.coastalModes) && config.coastalModes.length > 0) {
    if (!config.coastalModes.includes(String(feature.properties.coastal_inland_label || "").trim())) {
      return "coastal_mode_filtered";
    }
  }
  return null;
}

function createPolygonNode(feature, style, onSelect) {
  const node = createSvgNode("path");
  node.setAttribute("d", feature.pathData);
  node.setAttribute("fill", style.fill);
  node.setAttribute("fill-opacity", String(style.fillOpacity));
  node.setAttribute("stroke", style.stroke);
  node.setAttribute("stroke-opacity", String(style.strokeOpacity));
  node.setAttribute("stroke-width", String(style.strokeWidth));
  node.setAttribute("vector-effect", "non-scaling-stroke");
  node.dataset.featureId = feature.id;
  node.style.cursor = "pointer";
  node.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onSelect(feature);
  });
  return node;
}

function createLabelNode(feature, style, onSelect) {
  const screenPoint = projectTransportWorkbenchCarrierScenePoint(feature.bounds.centerX, feature.bounds.centerY);
  if (!screenPoint) return null;
  const label = createSvgNode("text");
  label.setAttribute("x", String(screenPoint.x));
  label.setAttribute("y", String(screenPoint.y));
  label.setAttribute("fill", style.labelColor);
  label.setAttribute("font-size", "10.1");
  label.setAttribute("font-weight", "620");
  label.setAttribute("font-family", "IBM Plex Sans, Inter, system-ui, sans-serif");
  label.setAttribute("text-anchor", "middle");
  label.setAttribute("paint-order", "stroke");
  label.setAttribute("stroke", style.labelHalo);
  label.setAttribute("stroke-width", "2.8");
  label.setAttribute("stroke-linejoin", "round");
  label.textContent = feature.name;
  label.dataset.featureId = feature.id;
  label.style.cursor = "pointer";
  label.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onSelect(feature);
  });
  return label;
}

function getLabelDensityGridSize(config) {
  return INDUSTRIAL_LABEL_GRID_BY_DENSITY[String(config?.labelDensityPreset || "").trim()] || INDUSTRIAL_LABEL_GRID_BY_DENSITY.balanced;
}

function selectVisibleLabelEntries(visibleEntries, config) {
  const gridSize = getLabelDensityGridSize(config);
  const usedBuckets = new Set();
  return visibleEntries
    .filter((entry) => entry.showLabel)
    .map((entry) => ({
      ...entry,
      screenPoint: projectTransportWorkbenchCarrierScenePoint(entry.feature.bounds.centerX, entry.feature.bounds.centerY),
    }))
    .filter((entry) => entry.screenPoint)
    .sort((left, right) => {
      const areaDelta = normalizeNumber(right.feature.bounds.width * right.feature.bounds.height, 0)
        - normalizeNumber(left.feature.bounds.width * left.feature.bounds.height, 0);
      if (areaDelta !== 0) return areaDelta;
      return String(left.feature.name || left.feature.id).localeCompare(String(right.feature.name || right.feature.id), "ja");
    })
    .filter((entry) => {
      const bucketKey = `${Math.round(entry.screenPoint.x / gridSize)}:${Math.round(entry.screenPoint.y / gridSize)}`;
      if (usedBuckets.has(bucketKey)) return false;
      usedBuckets.add(bucketKey);
      return true;
    });
}

function applySelectionHighlight(runtime) {
  const style = getVariantStyle(runtime.lastRenderedConfig, runtime.activeVariantId || "internal");
  runtime.rootGroup?.querySelectorAll("[data-feature-id]").forEach((node) => {
    const isSelected = runtime.selectedFeature?.id === node.dataset.featureId;
    node.setAttribute("stroke", isSelected ? style.selectedStroke : style.stroke);
    node.setAttribute(
      "stroke-width",
      String(isSelected ? style.selectedStrokeWidth : style.strokeWidth)
    );
  });
  runtime.labelsGroup?.querySelectorAll("[data-feature-id]").forEach((node) => {
    const isSelected = runtime.selectedFeature?.id === node.dataset.featureId;
    node.setAttribute("font-weight", isSelected ? "700" : "620");
  });
}

function buildSnapshot(runtime) {
  const activePackStatus = runtime.activePackMode === PACK_MODE_FULL
    ? runtime.loadState.fullStatus
    : runtime.loadState.previewStatus;
  const baseStatus = activePackStatus && activePackStatus !== "idle"
    ? activePackStatus
    : runtime.loadState.status;
  const resolvedStatus = (
    baseStatus === "ready" && !runtime.renderedConfigSignature
  ) ? "loading" : baseStatus;
  return {
    status: resolvedStatus,
    error: runtime.loadState.error,
    manifest: runtime.loadState.manifest,
    audit: runtime.loadState.audit,
    activeVariant: runtime.activeVariantId,
    packMode: runtime.activePackMode,
    previewStatus: runtime.loadState.previewStatus,
    fullStatus: runtime.loadState.fullStatus,
    stats: { ...runtime.renderStats },
    renderedConfigSignature: runtime.renderedConfigSignature || "",
    selected: runtime.selectedFeature,
  };
}

const runtime = {
  manifestPromise: null,
  auditPromise: null,
  packPromises: new Map(),
  projectedPacks: new Map(),
  loadState: {
    status: "idle",
    error: null,
    manifest: null,
    audit: null,
    previewStatus: "idle",
    fullStatus: "idle",
  },
  activePackMode: null,
  activeVariantId: null,
  rootGroup: null,
  labelsGroup: null,
  selectedFeature: null,
  selectionChangeListener: null,
  renderStats: {
    totalFeatures: 0,
    visibleFeatures: 0,
    filteredFeatures: 0,
    visibleLabels: 0,
  },
  renderedConfigSignature: "",
  lastRenderedConfig: null,
};

async function loadManifest() {
  if (!runtime.manifestPromise) {
    runtime.manifestPromise = fetch(MANIFEST_URL, { cache: "no-cache" })
      .then(async (response) => {
        if (response.status === 404) {
          runtime.loadState.status = "pending";
          runtime.loadState.previewStatus = "pending";
          runtime.loadState.error = null;
          runtime.loadState.manifest = null;
          return null;
        }
        if (!response.ok) {
          throw new Error(`Failed to load industrial_zones manifest: ${response.status}`);
        }
        const manifest = await response.json();
        runtime.loadState.manifest = manifest;
        return manifest;
      })
      .catch((error) => {
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
  runtime.auditPromise = fetch(manifest.paths.build_audit, { cache: "no-cache" })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to load industrial_zones audit: ${response.status}`);
      }
      const audit = await response.json();
      runtime.loadState.audit = audit;
      runtime.selectionChangeListener?.(buildSnapshot(runtime));
      return audit;
    })
    .catch((error) => {
      console.warn("[transport-workbench] Failed to load industrial_zones audit.", error);
      return null;
    });
  return runtime.auditPromise;
}

function getPackCacheKey(variantId, mode) {
  return `${variantId}:${mode}`;
}

async function loadPack(variantId, mode = PACK_MODE_PREVIEW) {
  const cacheKey = getPackCacheKey(variantId, mode);
  if (runtime.projectedPacks.has(cacheKey)) return runtime.projectedPacks.get(cacheKey);
  if (!runtime.packPromises.has(cacheKey)) {
    runtime.packPromises.set(cacheKey, (async () => {
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
      startAuditLoad(manifest);
      const packPath = getPackPath(manifest, variantId, mode);
      const response = await fetch(packPath, { cache: "no-cache" });
      if (!response.ok) {
        throw new Error(`Failed to load industrial_zones pack (${variantId}/${mode}): ${response.status}`);
      }
      const collection = await response.json();
      const sourceFeatures = Array.isArray(collection?.features) ? collection.features : [];
      const features = (collection?.features || [])
        .map((feature) => createPolygonFeature(feature, variantId))
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
      runtime.projectedPacks.set(cacheKey, pack);
      if (isPreview) {
        runtime.loadState.status = "ready";
        runtime.loadState.previewStatus = "ready";
      } else {
        runtime.loadState.fullStatus = "ready";
      }
      return pack;
    })().catch((error) => {
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

function shouldUseFullPack(scale) {
  return scale >= 1.22;
}

function emitSelectionChange() {
  runtime.selectionChangeListener?.(buildSnapshot(runtime));
}

export async function renderJapanIndustrialZonePreview(config = {}) {
  ensureRootGroups(runtime);
  runtime.lastRenderedConfig = { ...(config || {}) };
  runtime.renderedConfigSignature = "";
  const manifest = await loadManifest();
  if (!manifest) {
    clearGroups(runtime);
    runtime.activeVariantId = null;
    runtime.activePackMode = null;
    runtime.selectedFeature = null;
    emitSelectionChange();
    return null;
  }

  const scale = getCurrentScale();
  const variantId = resolveVariantId(manifest, config);
  const targetMode = shouldUseFullPack(scale) ? PACK_MODE_FULL : PACK_MODE_PREVIEW;
  const pack = await loadPack(variantId, targetMode);
  if (!pack) {
    clearGroups(runtime);
    runtime.activeVariantId = variantId;
    runtime.activePackMode = null;
    runtime.selectedFeature = null;
    emitSelectionChange();
    return null;
  }

  runtime.activeVariantId = variantId;
  runtime.activePackMode = targetMode;
  if (runtime.selectedFeature && runtime.selectedFeature.variant !== variantId) {
    runtime.selectedFeature = null;
  }

  clearGroups(runtime);
  const style = getVariantStyle(config, variantId);
  const visibleEntries = [];
  pack.features.forEach((feature) => {
    const hiddenReason = getHiddenReason(feature, config, variantId);
    if (hiddenReason) return;
    visibleEntries.push({
      feature,
      showLabel: shouldShowLabel(feature, config, variantId, scale),
    });
  });
  const visibleLabelEntries = selectVisibleLabelEntries(visibleEntries, config);
  const visibleLabelIds = new Set(visibleLabelEntries.map((entry) => entry.feature.id));

  visibleEntries.forEach(({ feature, showLabel }) => {
    runtime.rootGroup.appendChild(createPolygonNode(feature, style, (selectedFeature) => {
      runtime.selectedFeature = {
        ...selectedFeature,
        visible: true,
      };
      applySelectionHighlight(runtime);
      emitSelectionChange();
    }));
    if (showLabel && visibleLabelIds.has(feature.id)) {
      const labelNode = createLabelNode(feature, style, (selectedFeature) => {
        runtime.selectedFeature = {
          ...selectedFeature,
          visible: true,
        };
        applySelectionHighlight(runtime);
        emitSelectionChange();
      });
      if (labelNode) {
        runtime.labelsGroup.appendChild(labelNode);
      }
    }
  });

  runtime.renderStats.totalFeatures = pack.features.length;
  runtime.renderStats.visibleFeatures = visibleEntries.length;
  runtime.renderStats.filteredFeatures = Math.max(0, pack.features.length - visibleEntries.length);
  runtime.renderStats.visibleLabels = visibleLabelEntries.length;
  runtime.renderStats.variant = variantId;
  runtime.renderedConfigSignature = JSON.stringify(config || {});
  applySelectionHighlight(runtime);
  emitSelectionChange();
  return pack;
}

export async function warmJapanIndustrialZonePreviewPack({ includeFull = false } = {}) {
  const manifest = await loadManifest();
  if (!manifest) return buildSnapshot(runtime);
  const variantId = getDefaultVariantId(manifest);
  await loadPack(variantId, PACK_MODE_PREVIEW);
  if (includeFull) {
    loadPack(variantId, PACK_MODE_FULL).catch((error) => {
      console.warn("[transport-workbench] Failed to warm industrial_zones full pack.", error);
    });
  }
  return buildSnapshot(runtime);
}

export function getJapanIndustrialZonePreviewSnapshot() {
  return buildSnapshot(runtime);
}

export function setJapanIndustrialZonePreviewSelectionListener(listener) {
  runtime.selectionChangeListener = typeof listener === "function" ? listener : null;
}

export function clearJapanIndustrialZonePreview() {
  clearGroups(runtime);
  runtime.selectedFeature = null;
}

export function destroyJapanIndustrialZonePreview() {
  runtime.rootGroup?.remove();
  runtime.labelsGroup?.remove();
  runtime.rootGroup = null;
  runtime.labelsGroup = null;
  runtime.selectedFeature = null;
}
