import {
  getTransportWorkbenchCarrierViewState,
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
import {
  PACK_MODE_FULL,
  PACK_MODE_PREVIEW,
  buildTransportWorkbenchPointSnapshot,
  buildTransportWorkbenchPointVisibilityState,
  createTransportWorkbenchPointAggregateSelection,
  createTransportWorkbenchPointViewRenderSignature,
  getActiveTransportWorkbenchPointPack,
  getTransportWorkbenchPointThresholdRank,
  normalizeTransportWorkbenchPointNumber,
  shouldUseTransportWorkbenchPointFullPack,
} from "./transport_workbench_point_preview_runtime.js";
import {
  __transportWorkbenchPointPreviewLoaderTestInternals,
  createEffectiveTransportWorkbenchPointPack,
  createTransportWorkbenchPointPreviewLoader,
  createTransportWorkbenchPointPreviewRuntime,
} from "./transport_workbench_point_preview_loader.js";
import {
  applyTransportWorkbenchPointSelectionHighlight as applySelectionHighlight,
  clearTransportWorkbenchPointGroups as clearGroups,
  createTransportWorkbenchPointLabelDescriptor as createLabelDescriptor,
  createTransportWorkbenchPointLabelNode as createLabelNode,
  createTransportWorkbenchPointMarkerNode as createMarkerNode,
  ensureTransportWorkbenchPointRootGroups as ensureRootGroups,
  getTransportWorkbenchPointLabelDensityGridSize as getLabelDensityGridSize,
  renderTransportWorkbenchPointLabelDescriptors as renderLabelDescriptors,
  selectVisibleTransportWorkbenchPointLabelEntries as selectVisibleLabelEntries,
} from "./transport_workbench_point_preview_dom.js";
import { registerMapcreatorSnapshotProvider } from "../../core/mapcreator_snapshot.js";

const getThresholdRank = getTransportWorkbenchPointThresholdRank;
const shouldUseFullPack = shouldUseTransportWorkbenchPointFullPack;
const buildVisibilityState = buildTransportWorkbenchPointVisibilityState;
const createViewRenderSignature = createTransportWorkbenchPointViewRenderSignature;
const createAggregateSelection = createTransportWorkbenchPointAggregateSelection;
const getActivePointPack = getActiveTransportWorkbenchPointPack;
const normalizeNumber = normalizeTransportWorkbenchPointNumber;
const createEffectivePointPack = createEffectiveTransportWorkbenchPointPack;

function getCurrentScale() {
  return normalizeNumber(getTransportWorkbenchCarrierViewState()?.scale, 1);
}


function buildSnapshot(runtime) {
  return buildTransportWorkbenchPointSnapshot(runtime, { scale: getCurrentScale() });
}

export const __transportWorkbenchPointPreviewTestInternals = Object.freeze({
  createEffectivePointPack,
  getPackCacheKey: __transportWorkbenchPointPreviewLoaderTestInternals.getPackCacheKey,
  getPackPath: __transportWorkbenchPointPreviewLoaderTestInternals.getPackPath,
  isSinglePackPath: __transportWorkbenchPointPreviewLoaderTestInternals.isSinglePackPath,
  buildSnapshot,
});

export function createTransportWorkbenchPointPreviewController(definition) {
  const runtime = createTransportWorkbenchPointPreviewRuntime(definition);
  const { loadPack, setActivePack } = createTransportWorkbenchPointPreviewLoader(runtime, definition, {
    emitSelectionChange,
  });

  function emitSelectionChange() {
    runtime.selectionChangeListener?.(buildSnapshot(runtime));
  }

  async function render(config = {}, options = {}) {
    if (config?.activePackId && typeof definition.resolveManifestUrl === "function") {
      setActivePack(config.activePackId, definition.resolveManifestUrl(config.activePackId));
    }
    const nextConfigSignature = JSON.stringify(config || {});
    runtime.lastRenderedConfig = { ...(config || {}) };
    const scale = getCurrentScale();
    const targetMode = shouldUseFullPack(config, definition, scale) ? PACK_MODE_FULL : PACK_MODE_PREVIEW;
    const nextViewSignature = createViewRenderSignature(targetMode, scale);
    if (
      options.viewOnly
      && runtime.renderedConfigSignature === nextConfigSignature
      && runtime.renderedViewSignature === nextViewSignature
      && runtime.rootGroup
      && runtime.labelsGroup
    ) {
      renderLabelDescriptors(runtime);
      emitSelectionChange();
      return null;
    }
    runtime.renderedConfigSignature = "";
    runtime.renderedViewSignature = "";
    const sourcePack = await loadPack(targetMode, config);
    if (typeof options.isCurrent === "function" && !options.isCurrent()) {
      return null;
    }
    if (!sourcePack) {
      runtime.activeVariantId = null;
      runtime.activePack = null;
      clearGroups(runtime);
      emitSelectionChange();
      return null;
    }
    const pack = createEffectivePointPack(sourcePack, config, definition);
    runtime.activePackMode = targetMode;
    runtime.activeVariantId = String(pack.variantId || "").trim() || null;
    runtime.activePack = pack;
    ensureRootGroups(runtime);
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
    const labelDescriptors = [];
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
            labelDescriptors.push(createLabelDescriptor(feature, featureMarkerStyle, onFeatureSelect));
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
              labelDescriptors.push(createLabelDescriptor(aggregateEntry, aggregateStyle, (entry) => {
                onFeatureSelect(createAggregateSelection(entry, definition));
              }));
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
    runtime.labelDescriptors = labelDescriptors;
    runtime.renderedConfigSignature = nextConfigSignature;
    runtime.renderedViewSignature = nextViewSignature;
    applySelectionHighlight(runtime);
    emitSelectionChange();
    return pack;
  }

  function clear() {
    runtime.activeVariantId = null;
    runtime.activePack = null;
    runtime.loadState.singlePack = false;
    clearGroups(runtime);
  }

  function destroy() {
    runtime.activeVariantId = null;
    runtime.activePack = null;
    runtime.loadState.singlePack = false;
    runtime.rootGroup?.remove();
    runtime.labelsGroup?.remove();
    runtime.rootGroup = null;
    runtime.labelsGroup = null;
    runtime.renderedViewSignature = "";
    runtime.labelDescriptors = [];
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

  function selectFeature(selection) {
    const selectionId = String(selection?.id || selection || "").trim();
    if (!selectionId) return false;
    const pack = getActivePointPack(runtime);
    const feature = pack?.featureById?.get(selectionId)
      || Array.from(runtime.projectedPacks.values()).find((candidatePack) => candidatePack?.featureById?.has(selectionId))?.featureById?.get(selectionId)
      || null;
    if (!feature) return false;
    const visibility = buildVisibilityState(feature, runtime.lastRenderedConfig || {}, definition, getCurrentScale());
    runtime.selectedFeature = { ...feature, visible: visibility.visible, hiddenReason: visibility.hiddenReason };
    applySelectionHighlight(runtime);
    emitSelectionChange();
    return true;
  }

  registerMapcreatorSnapshotProvider("loadStatus", `transport_preview:${definition.familyId}`, () => (
    getSnapshot()
  ));

  return {
    clear,
    destroy,
    getSnapshot,
    render,
    selectFeature,
    setSelectionListener,
    warm,
    setActivePack,
  };
}
