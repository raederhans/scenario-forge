import {
  getTransportWorkbenchCarrierOverlayRoots,
  getTransportWorkbenchCarrierViewState,
  projectTransportWorkbenchCarrierPoint,
} from "./transport_workbench_carrier.js";

const PACK_MODE_PREVIEW = "preview";
const PACK_MODE_FULL = "full";

function createSvgNode(tagName) {
  return document.createElementNS("http://www.w3.org/2000/svg", tagName);
}

function normalizeNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function getPackPath(manifest, mode, key) {
  const modePaths = manifest?.paths?.[mode];
  if (modePaths && typeof modePaths === "object") {
    return modePaths[key] || "";
  }
  return manifest?.paths?.[key] || "";
}

function isSinglePackPath(manifest, key) {
  const previewPath = getPackPath(manifest, PACK_MODE_PREVIEW, key);
  const fullPath = getPackPath(manifest, PACK_MODE_FULL, key);
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

function createPointFeature(rawFeature, definition) {
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
    properties,
    label: String(featureLabel || "").trim(),
    kind: definition.selectionType,
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
    : createSvgNode("path");
  if (markerStyle.shape === "square") {
    const radius = normalizeNumber(markerStyle.radius, 4.8);
    node.setAttribute("x", String(feature.x - radius));
    node.setAttribute("y", String(feature.y - radius));
    node.setAttribute("width", String(radius * 2));
    node.setAttribute("height", String(radius * 2));
    node.setAttribute("rx", String(normalizeNumber(markerStyle.cornerRadius, 0.9)));
  } else {
    node.setAttribute("d", createDiamondPath(feature.x, feature.y, normalizeNumber(markerStyle.radius, 5.2)));
  }
  node.setAttribute("fill", markerStyle.fill);
  node.setAttribute("stroke", markerStyle.stroke);
  node.setAttribute("stroke-width", String(normalizeNumber(markerStyle.strokeWidth, 1.2)));
  node.setAttribute("opacity", String(normalizeNumber(markerStyle.opacity, 0.9)));
  node.dataset.featureId = feature.id;
  node.dataset.featureKind = feature.kind;
  node.style.cursor = "pointer";
  node.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onSelect(feature);
  });
  return node;
}

function createLabelNode(feature, markerStyle, onSelect) {
  const label = createSvgNode("text");
  label.setAttribute("x", String(feature.x + normalizeNumber(markerStyle.labelOffsetX, 8)));
  label.setAttribute("y", String(feature.y + normalizeNumber(markerStyle.labelOffsetY, 1.5)));
  label.setAttribute("fill", markerStyle.labelColor || markerStyle.stroke);
  label.setAttribute("font-size", String(normalizeNumber(markerStyle.labelSize, 10.5)));
  label.setAttribute("font-weight", String(normalizeNumber(markerStyle.labelWeight, 600)));
  label.setAttribute("font-family", "IBM Plex Sans, Inter, system-ui, sans-serif");
  label.textContent = feature.label;
  label.dataset.featureId = feature.id;
  label.dataset.featureKind = feature.kind;
  label.style.cursor = "pointer";
  label.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onSelect(feature);
  });
  return label;
}

function applySelectionHighlight(runtime) {
  const markerStyle = runtime.definition.getMarkerStyle(getCurrentScale());
  runtime.rootGroup.querySelectorAll("[data-feature-id]").forEach((node) => {
    const id = node.dataset.featureId || "";
    const isSelected = runtime.selectedFeature?.id === id;
    node.setAttribute("stroke", isSelected ? (markerStyle.selectedStroke || "#111827") : markerStyle.stroke);
    node.setAttribute("stroke-width", String(isSelected ? normalizeNumber(markerStyle.selectedStrokeWidth, 2.2) : normalizeNumber(markerStyle.strokeWidth, 1.2)));
  });
  runtime.labelsGroup.querySelectorAll("[data-feature-id]").forEach((node) => {
    const id = node.dataset.featureId || "";
    node.setAttribute("font-weight", runtime.selectedFeature?.id === id ? "700" : String(normalizeNumber(markerStyle.labelWeight, 600)));
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
    subtypeCatalog: runtime.loadState.subtypeCatalog,
    packMode: runtime.activePackMode,
    singlePack: !!runtime.loadState.singlePack,
    previewStatus: runtime.loadState.previewStatus,
    fullStatus: runtime.loadState.fullStatus,
    stats: {
      totalFeatures: runtime.renderStats.totalFeatures,
      visibleFeatures: runtime.renderStats.visibleFeatures,
      filteredFeatures: runtime.renderStats.filteredFeatures,
      visibleLabels: runtime.renderStats.visibleLabels,
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
    packPromises: {
      [PACK_MODE_PREVIEW]: null,
      [PACK_MODE_FULL]: null,
    },
    packPaths: {
      [PACK_MODE_PREVIEW]: "",
      [PACK_MODE_FULL]: "",
    },
    projectedPacks: {
      [PACK_MODE_PREVIEW]: null,
      [PACK_MODE_FULL]: null,
    },
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
        runtime.selectionChangeListener?.(buildSnapshot(runtime));
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

  async function loadPack(mode = PACK_MODE_PREVIEW) {
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
        startAuditLoad(manifest);
        startSubtypeCatalogLoad(manifest);
        const packPath = getPackPath(manifest, mode, definition.packKey);
        runtime.loadState.singlePack = isSinglePackPath(manifest, definition.packKey);
        runtime.packPaths[mode] = packPath;
        const aliasMode = mode === PACK_MODE_PREVIEW ? PACK_MODE_FULL : PACK_MODE_PREVIEW;
        if (runtime.packPaths[aliasMode] && runtime.packPaths[aliasMode] === packPath) {
          if (runtime.projectedPacks[aliasMode]) {
            runtime.projectedPacks[mode] = runtime.projectedPacks[aliasMode];
            if (isPreview) {
              runtime.loadState.status = "ready";
              runtime.loadState.previewStatus = "ready";
            } else {
              runtime.loadState.fullStatus = "ready";
            }
            return runtime.projectedPacks[mode];
          }
          if (runtime.packPromises[aliasMode]) {
            const pack = await runtime.packPromises[aliasMode];
            runtime.projectedPacks[mode] = pack;
            if (isPreview) {
              runtime.loadState.status = "ready";
              runtime.loadState.previewStatus = "ready";
            } else {
              runtime.loadState.fullStatus = "ready";
            }
            return pack;
          }
        }
        const response = await fetch(packPath, { cache: "no-cache" });
        if (!response.ok) {
          throw new Error(`Failed to load ${definition.familyId} pack (${mode}): ${response.status}`);
        }
        const collection = await response.json();
        const sourceFeatures = Array.isArray(collection?.features) ? collection.features : [];
        const features = sourceFeatures.map((feature) => createPointFeature(feature, definition)).filter(Boolean);
        if (sourceFeatures.length > 0 && features.length === 0) {
          throw new Error(`Projected zero ${definition.familyId} features for ${mode}; carrier geometry is not ready.`);
        }
        const pack = {
          mode,
          path: packPath,
          manifest,
          audit: runtime.loadState.audit,
          features,
          featureById: new Map(features.map((feature) => [feature.id, feature])),
        };
        runtime.projectedPacks[mode] = pack;
        if (isPreview) {
          runtime.loadState.status = "ready";
          runtime.loadState.previewStatus = "ready";
        } else {
          runtime.loadState.fullStatus = "ready";
        }
        return pack;
      })().catch((error) => {
        runtime.packPromises[mode] = null;
        runtime.projectedPacks[mode] = null;
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

  function emitSelectionChange() {
    runtime.selectionChangeListener?.(buildSnapshot(runtime));
  }

  async function render(config = {}) {
    ensureRootGroups(runtime);
    runtime.renderedConfigSignature = "";
    const scale = getCurrentScale();
    const targetMode = shouldUseFullPack(config, definition, scale) ? PACK_MODE_FULL : PACK_MODE_PREVIEW;
    const pack = await loadPack(targetMode);
    if (!pack) {
      clearGroups(runtime);
      emitSelectionChange();
      return null;
    }
    runtime.activePackMode = targetMode;
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
    visibleEntries.forEach(({ feature, visibility }) => {
      runtime.rootGroup.appendChild(createMarkerNode(feature, markerStyle, (selectedFeature) => {
        runtime.selectedFeature = { ...selectedFeature, visible: true };
        applySelectionHighlight(runtime);
        emitSelectionChange();
      }));
      if (visibility.showLabel) {
        runtime.labelsGroup.appendChild(createLabelNode(feature, markerStyle, (selectedFeature) => {
          runtime.selectedFeature = { ...selectedFeature, visible: true };
          applySelectionHighlight(runtime);
          emitSelectionChange();
        }));
      }
    });
    runtime.renderStats.totalFeatures = features.length;
    runtime.renderStats.visibleFeatures = visibleEntries.length;
    runtime.renderStats.filteredFeatures = Math.max(0, features.length - visibleEntries.length);
    runtime.renderStats.visibleLabels = visibleEntries.filter((entry) => entry.visibility.showLabel).length;
    runtime.renderedConfigSignature = JSON.stringify(config || {});
    applySelectionHighlight(runtime);
    emitSelectionChange();
    return pack;
  }

  function clear() {
    clearGroups(runtime);
  }

  function destroy() {
    runtime.rootGroup?.remove();
    runtime.labelsGroup?.remove();
    runtime.rootGroup = null;
    runtime.labelsGroup = null;
  }

  function getSnapshot() {
    return buildSnapshot(runtime);
  }

  async function warm(options = {}) {
    await loadPack(PACK_MODE_PREVIEW);
    if (options?.includeFull && !runtime.loadState.singlePack) {
      await loadPack(PACK_MODE_FULL);
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
