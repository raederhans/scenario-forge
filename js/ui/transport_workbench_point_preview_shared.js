import {
  getTransportWorkbenchCarrierOverlayRoots,
  getTransportWorkbenchCarrierViewState,
  projectTransportWorkbenchCarrierPoint,
  projectTransportWorkbenchCarrierScenePoint,
} from "./transport_workbench_carrier.js";
import {
  aggregateTransportWorkbenchPoints,
  resolveTransportWorkbenchAggregateCellSize,
  resolveTransportWorkbenchDisplayMode,
  resolveTransportWorkbenchGeoLabel,
  resolveTransportWorkbenchLabelBudget,
  resolveTransportWorkbenchLabelSeparation,
  selectTransportWorkbenchLabels,
} from "./transport_workbench_density_helpers.js";

const PACK_MODE_PREVIEW = "preview";
const PACK_MODE_FULL = "full";
const POINT_LABEL_GRID_BY_DENSITY = {
  very_sparse: 192,
  sparse: 164,
  balanced: 136,
  dense: 112,
  very_dense: 90,
};

function createSvgNode(tagName) {
  return document.createElementNS("http://www.w3.org/2000/svg", tagName);
}

function normalizeNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function resolveVariantId(manifest, definition, config) {
  if (typeof definition.resolveVariantId === "function") {
    return String(definition.resolveVariantId(config, manifest) || "").trim();
  }
  return "";
}

function getVariantMeta(manifest, definition, variantId) {
  if (typeof definition.getVariantMeta === "function") {
    return definition.getVariantMeta(manifest, variantId) || null;
  }
  return null;
}

function getPackCacheKey(mode, variantId = "") {
  const normalizedMode = String(mode || PACK_MODE_PREVIEW).trim() || PACK_MODE_PREVIEW;
  const normalizedVariantId = String(variantId || "").trim();
  return normalizedVariantId ? `${normalizedVariantId}:${normalizedMode}` : normalizedMode;
}

function getPackPath(manifest, mode, key, definition, variantId = "") {
  const variantMeta = getVariantMeta(manifest, definition, variantId);
  const variantModePaths = variantMeta?.paths?.[mode];
  if (variantModePaths && typeof variantModePaths === "object") {
    return variantModePaths[key] || "";
  }
  if (variantMeta?.paths?.[key]) {
    return variantMeta.paths[key] || "";
  }
  const modePaths = manifest?.paths?.[mode];
  if (modePaths && typeof modePaths === "object") {
    return modePaths[key] || "";
  }
  return manifest?.paths?.[key] || "";
}

function isSinglePackPath(manifest, key, definition, variantId = "") {
  const previewPath = getPackPath(manifest, PACK_MODE_PREVIEW, key, definition, variantId);
  const fullPath = getPackPath(manifest, PACK_MODE_FULL, key, definition, variantId);
  return !!previewPath && previewPath === fullPath;
}

function getThresholdRank(config, definition) {
  if (typeof definition.getThresholdRank === "function") {
    return normalizeNumber(definition.getThresholdRank(config), 1);
  }
  return definition.importanceOrder?.[String(config?.importanceThreshold || "").trim()] || 1;
}

function getCurrentScale() {
  return normalizeNumber(getTransportWorkbenchCarrierViewState()?.scale, 1);
}

function shouldUseFullPack(config, definition, scale) {
  if (typeof definition.shouldUseFullPack === "function") {
    return !!definition.shouldUseFullPack(config, scale);
  }
  const threshold = definition.importanceOrder?.[String(config?.importanceThreshold || "").trim()] || 1;
  if (threshold <= 1) return true;
  return scale >= normalizeNumber(definition.fullPackScaleThreshold, 1.26);
}

function createDiamondPath(x, y, radius) {
  return `M ${x} ${y - radius} L ${x + radius} ${y} L ${x} ${y + radius} L ${x - radius} ${y} Z`;
}

function createPointFeature(rawFeature, definition, variantId = "") {
  const properties = rawFeature?.properties || {};
  const coordinates = rawFeature?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const projected = projectTransportWorkbenchCarrierPoint(coordinates[0], coordinates[1], "main");
  if (!projected) return null;
  const featureId = typeof definition.getFeatureId === "function"
    ? definition.getFeatureId(rawFeature)
    : String(properties.id || rawFeature.id || properties.stable_key || "").trim();
  const featureName = typeof definition.getFeatureName === "function"
    ? definition.getFeatureName(rawFeature)
    : String(properties.name || "").trim();
  const featureLabel = typeof definition.getFeatureLabel === "function"
    ? definition.getFeatureLabel(rawFeature)
    : featureName;
  const importanceRank = typeof definition.getFeatureImportanceRank === "function"
    ? normalizeNumber(definition.getFeatureImportanceRank(rawFeature), 1)
    : normalizeNumber(properties.importance_rank, 1);
  return {
    id: String(featureId || "").trim(),
    name: String(featureName || "").trim(),
    importance: String(properties.importance || "").trim(),
    importanceRank,
    x: projected.x,
    y: projected.y,
    lon: normalizeNumber(coordinates[0]),
    lat: normalizeNumber(coordinates[1]),
    properties,
    label: String(featureLabel || "").trim(),
    kind: definition.selectionType,
    variant: String(variantId || "").trim(),
  };
}

function buildVisibilityState(feature, config, definition, scale) {
  const hiddenReason = definition.getHiddenReason?.(feature, config, scale) || null;
  return {
    visible: !hiddenReason,
    hiddenReason,
    showLabel: !hiddenReason && !!definition.shouldShowLabel?.(feature, config, scale),
  };
}

function ensureRootGroups(runtime) {
  const roots = getTransportWorkbenchCarrierOverlayRoots();
  const landRoot = roots?.land?.main;
  const labelRoot = roots?.labels?.main;
  if (!landRoot || !labelRoot) {
    throw new Error(`${runtime.definition.familyId} preview carrier overlays are unavailable.`);
  }
  if (!runtime.rootGroup || runtime.rootGroup.parentNode !== landRoot) {
    runtime.rootGroup = createSvgNode("g");
    runtime.rootGroup.setAttribute("class", `transport-workbench-${runtime.definition.familyId}-preview-layer`);
    landRoot.appendChild(runtime.rootGroup);
  }
  if (!runtime.labelsGroup || runtime.labelsGroup.parentNode !== labelRoot) {
    runtime.labelsGroup = createSvgNode("g");
    runtime.labelsGroup.setAttribute("class", `transport-workbench-${runtime.definition.familyId}-preview-label-layer`);
    labelRoot.appendChild(runtime.labelsGroup);
  }
}

function clearGroups(runtime) {
  runtime.rootGroup?.replaceChildren();
  runtime.labelsGroup?.replaceChildren();
}

function createMarkerNode(feature, markerStyle, onSelect) {
  const node = markerStyle.shape === "square"
    ? createSvgNode("rect")
    : markerStyle.shape === "circle"
      ? createSvgNode("circle")
    : createSvgNode("path");
  if (markerStyle.shape === "square") {
    const radius = normalizeNumber(markerStyle.radius, 4.8);
    node.setAttribute("x", String(feature.x - radius));
    node.setAttribute("y", String(feature.y - radius));
    node.setAttribute("width", String(radius * 2));
    node.setAttribute("height", String(radius * 2));
    node.setAttribute("rx", String(normalizeNumber(markerStyle.cornerRadius, 0.9)));
  } else if (markerStyle.shape === "circle") {
    node.setAttribute("cx", String(feature.x));
    node.setAttribute("cy", String(feature.y));
    node.setAttribute("r", String(normalizeNumber(markerStyle.radius, 5.2)));
  } else {
    node.setAttribute("d", createDiamondPath(feature.x, feature.y, normalizeNumber(markerStyle.radius, 5.2)));
  }
  node.setAttribute("fill", markerStyle.fill);
  node.setAttribute("stroke", markerStyle.stroke);
  node.setAttribute("stroke-width", String(normalizeNumber(markerStyle.strokeWidth, 1.2)));
  node.setAttribute("opacity", String(normalizeNumber(markerStyle.opacity, 0.9)));
  node.dataset.featureId = feature.id;
  node.dataset.featureKind = feature.kind;
  node.dataset.baseStroke = String(markerStyle.stroke || "");
  node.dataset.baseStrokeWidth = String(normalizeNumber(markerStyle.strokeWidth, 1.2));
  node.style.cursor = "pointer";
  node.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onSelect(feature);
  });
  return node;
}

function createLabelNode(feature, markerStyle, onSelect) {
  const screenPoint = projectTransportWorkbenchCarrierScenePoint(feature.x, feature.y);
  if (!screenPoint) return null;
  const label = createSvgNode("text");
  label.setAttribute("x", String(screenPoint.x + normalizeNumber(markerStyle.labelOffsetX, 8)));
  label.setAttribute("y", String(screenPoint.y + normalizeNumber(markerStyle.labelOffsetY, 1.5)));
  label.setAttribute("fill", markerStyle.labelColor || markerStyle.stroke);
  label.setAttribute("font-size", String(normalizeNumber(markerStyle.labelSize, 10.5)));
  label.setAttribute("font-weight", String(normalizeNumber(markerStyle.labelWeight, 600)));
  label.setAttribute("font-family", "IBM Plex Sans, Inter, system-ui, sans-serif");
  label.textContent = feature.label;
  label.dataset.featureId = feature.id;
  label.dataset.featureKind = feature.kind;
  label.dataset.baseLabelWeight = String(normalizeNumber(markerStyle.labelWeight, 600));
  label.style.cursor = "pointer";
  label.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onSelect(feature);
  });
  return label;
}

function createAggregateSelection(aggregateEntry, definition) {
  const dominantFeature = aggregateEntry.sampleFeature || {};
  return {
    id: aggregateEntry.id,
    name: aggregateEntry.label,
    aggregateCount: aggregateEntry.aggregateCount,
    dominantCategory: aggregateEntry.dominantCategory,
    dominantCategoryLabel: aggregateEntry.dominantCategoryLabel,
    properties: {
      aggregate_count: aggregateEntry.aggregateCount,
      dominant_category: aggregateEntry.dominantCategory,
      dominant_category_label: aggregateEntry.dominantCategoryLabel,
    },
    x: aggregateEntry.x,
    y: aggregateEntry.y,
    lon: aggregateEntry.lon,
    lat: aggregateEntry.lat,
    kind: `${definition.selectionType}_aggregate`,
    sampleFeatureId: dominantFeature.id || "",
    variant: String(dominantFeature.variant || "").trim(),
  };
}

function getLabelDensityGridSize(config) {
  return POINT_LABEL_GRID_BY_DENSITY[String(config?.labelDensityPreset || "").trim()] || POINT_LABEL_GRID_BY_DENSITY.balanced;
}

function selectVisibleLabelEntries(visibleEntries, config) {
  const gridSize = getLabelDensityGridSize(config);
  const usedBuckets = new Set();
  return visibleEntries
    .filter((entry) => entry.visibility.showLabel)
    .map((entry) => ({
      ...entry,
      screenPoint: projectTransportWorkbenchCarrierScenePoint(entry.feature.x, entry.feature.y),
    }))
    .filter((entry) => entry.screenPoint)
    .sort((left, right) => {
      const rankDelta = normalizeNumber(right.feature.importanceRank, 1) - normalizeNumber(left.feature.importanceRank, 1);
      if (rankDelta !== 0) return rankDelta;
      return String(left.feature.label || left.feature.id).localeCompare(String(right.feature.label || right.feature.id), "ja");
    })
    .filter((entry) => {
      const bucketKey = `${Math.round(entry.screenPoint.x / gridSize)}:${Math.round(entry.screenPoint.y / gridSize)}`;
      if (usedBuckets.has(bucketKey)) return false;
      usedBuckets.add(bucketKey);
      return true;
    });
}

function applySelectionHighlight(runtime) {
  const markerStyle = runtime.definition.getMarkerStyle(getCurrentScale(), runtime.lastRenderedConfig || {});
  runtime.rootGroup.querySelectorAll("[data-feature-id]").forEach((node) => {
    const id = node.dataset.featureId || "";
    const isSelected = runtime.selectedFeature?.id === id;
    node.setAttribute("stroke", isSelected ? (markerStyle.selectedStroke || "#111827") : (node.dataset.baseStroke || markerStyle.stroke));
    node.setAttribute("stroke-width", String(isSelected ? normalizeNumber(markerStyle.selectedStrokeWidth, 2.2) : normalizeNumber(node.dataset.baseStrokeWidth, normalizeNumber(markerStyle.strokeWidth, 1.2))));
  });
  runtime.labelsGroup.querySelectorAll("[data-feature-id]").forEach((node) => {
    const id = node.dataset.featureId || "";
    node.setAttribute("font-weight", runtime.selectedFeature?.id === id ? "700" : (node.dataset.baseLabelWeight || String(normalizeNumber(markerStyle.labelWeight, 600))));
  });
}

function buildSnapshot(runtime) {
  const audit = runtime.loadState.audit;
  const manifest = runtime.loadState.manifest;
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
    manifest,
    audit,
    activeVariant: runtime.activeVariantId,
    subtypeCatalog: runtime.loadState.subtypeCatalog,
    packMode: runtime.activePackMode,
    singlePack: !!runtime.loadState.singlePack,
    previewStatus: runtime.loadState.previewStatus,
    fullStatus: runtime.loadState.fullStatus,
    stats: {
      renderMode: runtime.renderStats.renderMode,
      totalFeatures: runtime.renderStats.totalFeatures,
      visibleFeatures: runtime.renderStats.visibleFeatures,
      filteredFeatures: runtime.renderStats.filteredFeatures,
      visibleLabels: runtime.renderStats.visibleLabels,
      aggregateUnits: runtime.renderStats.aggregateUnits,
    },
    renderedConfigSignature: runtime.renderedConfigSignature || "",
    selected: runtime.selectedFeature,
  };
}

export function createTransportWorkbenchPointPreviewController(definition) {
  const runtime = {
    definition,
    manifestPromise: null,
    auditPromise: null,
    subtypeCatalogPromise: null,
    packPromises: new Map(),
    packPaths: new Map(),
    projectedPacks: new Map(),
    loadState: {
      status: "idle",
      error: null,
      manifest: null,
      audit: null,
      subtypeCatalog: null,
      singlePack: false,
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
      renderMode: "inspect",
      totalFeatures: 0,
      visibleFeatures: 0,
      filteredFeatures: 0,
      visibleLabels: 0,
      aggregateUnits: 0,
    },
    renderedConfigSignature: "",
    lastRenderedConfig: null,
  };

  async function loadManifest() {
    if (!runtime.manifestPromise) {
      runtime.manifestPromise = fetch(definition.manifestUrl, { cache: "no-cache" })
        .then(async (response) => {
          if (response.status === 404) {
            runtime.loadState.status = "pending";
            runtime.loadState.previewStatus = "pending";
            runtime.loadState.error = null;
            runtime.loadState.manifest = null;
            return null;
          }
          if (!response.ok) {
            throw new Error(`Failed to load ${definition.familyId} manifest: ${response.status}`);
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
    runtime.auditPromise = fetch(manifest.paths.build_audit)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to load ${definition.familyId} audit: ${response.status}`);
        }
        const audit = await response.json();
        runtime.loadState.audit = audit;
        emitSelectionChange();
        return audit;
      })
      .catch((error) => {
        console.warn(`[transport-workbench] Failed to load ${definition.familyId} audit.`, error);
        return null;
      });
    return runtime.auditPromise;
  }

  function startSubtypeCatalogLoad(manifest) {
    if (!manifest?.paths?.subtype_catalog || runtime.loadState.subtypeCatalog || runtime.subtypeCatalogPromise) {
      return runtime.subtypeCatalogPromise;
    }
    runtime.subtypeCatalogPromise = fetch(manifest.paths.subtype_catalog, { cache: "no-cache" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to load ${definition.familyId} subtype catalog: ${response.status}`);
        }
        const subtypeCatalog = await response.json();
        runtime.loadState.subtypeCatalog = Array.isArray(subtypeCatalog) ? subtypeCatalog : null;
        emitSelectionChange();
        return runtime.loadState.subtypeCatalog;
      })
      .catch((error) => {
        console.warn(`[transport-workbench] Failed to load ${definition.familyId} subtype catalog.`, error);
        return null;
      });
    return runtime.subtypeCatalogPromise;
  }

  async function loadPack(mode = PACK_MODE_PREVIEW, config = {}) {
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
        const response = await fetch(packPath, { cache: "no-cache" });
        if (!response.ok) {
          const variantPrefix = variantId ? `${variantId}/` : "";
          throw new Error(`Failed to load ${definition.familyId} pack (${variantPrefix}${mode}): ${response.status}`);
        }
        const collection = await response.json();
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

  function emitSelectionChange() {
    runtime.selectionChangeListener?.(buildSnapshot(runtime));
  }

  async function render(config = {}) {
    ensureRootGroups(runtime);
    runtime.lastRenderedConfig = { ...(config || {}) };
    runtime.renderedConfigSignature = "";
    const scale = getCurrentScale();
    const targetMode = shouldUseFullPack(config, definition, scale) ? PACK_MODE_FULL : PACK_MODE_PREVIEW;
    const pack = await loadPack(targetMode, config);
    if (!pack) {
      runtime.activeVariantId = null;
      clearGroups(runtime);
      emitSelectionChange();
      return null;
    }
    runtime.activePackMode = targetMode;
    runtime.activeVariantId = String(pack.variantId || "").trim() || null;
    if (runtime.selectedFeature && !pack.featureById.has(runtime.selectedFeature.id)) {
      runtime.selectedFeature = null;
    }
    clearGroups(runtime);
    const markerStyle = definition.getMarkerStyle(scale, config);
    const thresholdRank = getThresholdRank(config, definition);
    const sourceFeatures = Array.isArray(pack.features) ? [...pack.features] : [];
    const features = typeof definition.sortFeatures === "function"
      ? definition.sortFeatures(sourceFeatures, config)
      : sourceFeatures.sort((a, b) => a.importanceRank - b.importanceRank);
    const visibleEntries = [];
    features.forEach((feature) => {
      if ((feature.importanceRank || 1) < thresholdRank) {
        return;
      }
      const visibility = buildVisibilityState(feature, config, definition, scale);
      if (!visibility.visible) {
        return;
      }
      visibleEntries.push({ feature, visibility });
    });
    const displayMode = resolveTransportWorkbenchDisplayMode(config, definition.familyId, scale, visibleEntries.length);
    const onFeatureSelect = (selectedFeature) => {
      runtime.selectedFeature = { ...selectedFeature, visible: true };
      applySelectionHighlight(runtime);
      emitSelectionChange();
    };
    let labelEntries = [];
    if (displayMode === "inspect") {
      const visibleLabelEntries = selectVisibleLabelEntries(visibleEntries, config);
      const visibleLabelIds = new Set(visibleLabelEntries.map((entry) => entry.feature.id));
      visibleEntries.forEach(({ feature, visibility }) => {
        const featureMarkerStyle = typeof definition.getFeatureMarkerStyle === "function"
          ? definition.getFeatureMarkerStyle(feature, markerStyle, config, scale, displayMode) || markerStyle
          : markerStyle;
        runtime.rootGroup.appendChild(createMarkerNode(feature, featureMarkerStyle, () => onFeatureSelect(feature)));
        if (visibility.showLabel && visibleLabelIds.has(feature.id)) {
          const labelNode = createLabelNode(feature, featureMarkerStyle, () => onFeatureSelect(feature));
          if (labelNode) {
            runtime.labelsGroup.appendChild(labelNode);
            labelEntries.push(feature.id);
          }
        }
      });
      runtime.renderStats.aggregateUnits = 0;
    } else {
      const aggregationAlgorithm = String(config?.aggregationAlgorithm || "square").trim();
      const cellSize = resolveTransportWorkbenchAggregateCellSize(config, scale, definition.familyId);
      const aggregates = aggregateTransportWorkbenchPoints(visibleEntries, {
        cellSize,
        algorithm: aggregationAlgorithm,
        clusterRadius: Number(config?.aggregationClusterRadiusPx || cellSize),
        categoryAccessor: (feature) => definition.getFeatureCategory?.(feature) || "",
        categoryLabelAccessor: (categoryValue) => definition.getFeatureCategoryLabel?.(categoryValue) || categoryValue,
      }).map((aggregateEntry) => {
        const label = resolveTransportWorkbenchGeoLabel(
          aggregateEntry.lon,
          aggregateEntry.lat,
          aggregateEntry.dominantCategoryLabel || definition.aggregateLabel || "",
          config?.labelLevel
        );
        return {
          ...aggregateEntry,
          label,
          priority: aggregateEntry.aggregateCount,
          screenX: aggregateEntry.x,
          screenY: aggregateEntry.y,
        };
      });
      const labelBudget = resolveTransportWorkbenchLabelBudget(config, definition.familyId);
      const labelSeparation = resolveTransportWorkbenchLabelSeparation(config);
      const labelGridSize = getLabelDensityGridSize(config) * 1.2;
      const selectedLabels = selectTransportWorkbenchLabels(aggregates, {
        gridSize: labelGridSize,
        budget: labelBudget,
        labelAccessor: (entry) => entry.label,
        priorityAccessor: (entry) => entry.priority,
        separation: labelSeparation,
        allowAggregation: !!config?.labelAllowAggregation,
      });
      const selectedLabelIds = new Set(selectedLabels.map((entry) => entry.id));
      aggregates
        .sort((left, right) => left.aggregateCount - right.aggregateCount)
        .forEach((aggregateEntry) => {
          const aggregateStyle = typeof definition.getAggregateMarkerStyle === "function"
            ? definition.getAggregateMarkerStyle(aggregateEntry, scale, config, displayMode)
            : {
              shape: "circle",
              radius: Math.min(displayMode === "density" ? 16 : 13, 5 + Math.sqrt(aggregateEntry.aggregateCount) * (displayMode === "density" ? 1.22 : 0.96)),
              fill: markerStyle.fill,
              stroke: markerStyle.stroke,
              strokeWidth: displayMode === "density" ? 0.8 : 1.1,
              opacity: displayMode === "density"
                ? Math.max(0.14, Math.min(0.44, 0.12 + aggregateEntry.aggregateCount / 180))
                : Math.max(0.42, Math.min(0.88, 0.28 + aggregateEntry.aggregateCount / 90)),
              labelColor: markerStyle.labelColor || markerStyle.stroke,
              labelSize: displayMode === "density" ? 10.6 : 10.0,
              labelWeight: 700,
              labelOffsetX: 10,
              labelOffsetY: 2,
            };
          runtime.rootGroup.appendChild(createMarkerNode(aggregateEntry, aggregateStyle, () => {
            onFeatureSelect(createAggregateSelection(aggregateEntry, definition));
          }));
          if (!!config?.showLabels && selectedLabelIds.has(aggregateEntry.id)) {
            const labelNode = createLabelNode(aggregateEntry, aggregateStyle, () => {
              onFeatureSelect(createAggregateSelection(aggregateEntry, definition));
            });
            if (labelNode) {
              runtime.labelsGroup.appendChild(labelNode);
              labelEntries.push(aggregateEntry.id);
            }
          }
        });
      runtime.renderStats.aggregateUnits = aggregates.length;
    }
    runtime.renderStats.totalFeatures = features.length;
    runtime.renderStats.visibleFeatures = visibleEntries.length;
    runtime.renderStats.filteredFeatures = Math.max(0, features.length - visibleEntries.length);
    runtime.renderStats.visibleLabels = labelEntries.length;
    runtime.renderStats.renderMode = displayMode;
    runtime.renderedConfigSignature = JSON.stringify(config || {});
    applySelectionHighlight(runtime);
    emitSelectionChange();
    return pack;
  }

  function clear() {
    runtime.activeVariantId = null;
    runtime.loadState.singlePack = false;
    clearGroups(runtime);
  }

  function destroy() {
    runtime.activeVariantId = null;
    runtime.loadState.singlePack = false;
    runtime.rootGroup?.remove();
    runtime.labelsGroup?.remove();
    runtime.rootGroup = null;
    runtime.labelsGroup = null;
  }

  function getSnapshot() {
    return buildSnapshot(runtime);
  }

  async function warm(options = {}) {
    await loadPack(PACK_MODE_PREVIEW, options?.config || {});
    if (options?.includeFull && !runtime.loadState.singlePack) {
      await loadPack(PACK_MODE_FULL, options?.config || {});
    }
    return true;
  }

  function setSelectionListener(listener) {
    runtime.selectionChangeListener = typeof listener === "function" ? listener : null;
  }

  return {
    clear,
    destroy,
    getSnapshot,
    render,
    setSelectionListener,
    warm,
  };
}
