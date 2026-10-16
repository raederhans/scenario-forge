import { ensureTransportOverviewStyleConfigState } from "../state/ui_state.js";
import {
  normalizeTransportOverviewVisualMode,
  resolveTransportOverviewLineStrategy,
  resolveTransportOverviewPointStrategy,
} from "../transport_capability_registry.js";
import {
  getTransportFacilityIconAtlasImage,
  getTransportFacilityIconAtlasStatus,
  getTransportFacilityIconCell,
  isTransportFacilityIconAtlasReady,
  resolveTransportFacilityIconDrawSizePx,
  resolveTransportFacilityIconKey,
} from "./transport_facility_icons.js";
import {
  applyTransportFacilityDensity,
  findTransportFacilityLabelPlacement,
  getTransportFacilityDensityStrategy,
  getTransportFacilityEntryStableSortKey,
  getTransportFacilityLabelCandidates,
  getTransportFacilityLabelBatchIdentity,
  getTransportOverviewAirportLabelText,
  getTransportOverviewPortLabelText,
} from "./transport_facility_display_policy.js";
import { claimScreenLabelPlacement } from "./screen_label_placement.js";
import {
  getIncludedTransportOverviewLineClass,
  getTransportOverviewLabelZoomConfig,
  getTransportOverviewPointImportanceRank,
  shouldIncludeTransportOverviewPointFeature,
} from "../transport_overview_visibility_policy.js";
import {
  getTransportOverviewAirportVisualStyle,
  getTransportOverviewPortVisualStyle,
  getTransportOverviewRailVisualStyle,
  getTransportOverviewRoadVisualStyle,
} from "./transport_overview_style_policy.js";
import {
  buildTransportOverviewLineStrokeSpecs,
  getTransportLineFeatureLabelAnchor,
  getTransportLineLabelGridSize,
  getTransportOverviewRailLabelText,
  getTransportOverviewRoadLabelText,
  getRoadLabelClassPriority,
  measureProjectedLineSetLength,
  projectTransportLineGeometry,
  resolveTransportRoadLabelClassAndPriority,
} from "./transport_line_label_policy.js";

export function createTransportOverviewRenderOwner({
  state = {},
  helpers = {},
} = {}) {
  const runtimeState = state;
  const {
    buildFacilityEntryKey,
    buildFacilityTooltipText,
    clamp,
    clearFacilityHoverEntries,
    collectContextMetric,
    getActiveFacilityHighlightEntry,
    getContext = () => null,
    getFacilityHoverRadiusPx,
    getFeatureCollectionFeatureCount,
    getLineMidpointFromCoordinates,
    getMultiLineLabelAnchor,
    getPathCanvas = () => null,
    getProjection = () => null,
    invalidateRenderPasses = null,
    mixCanvasColors,
    nowMs,
    requestRender = null,
    setVisibleFacilityHoverEntries,
  } = helpers;

  let context = null;
  let pathCanvas = null;
  let projection = null;
  let transportFacilityIconAtlasRenderQueued = false;
  let pendingLabelBatches = [];

  function resetLabelCandidates() {
    pendingLabelBatches = [];
  }

  // Retain world-space candidates while contextMarkers is cached. Each labels
  // draw projects them again and uses only its caller's fresh occupancy array.
  function drawPendingLabels(k, { occupiedBoxes = [] } = {}) {
    syncRenderTargets();
    if (!context || !runtimeState.showTransport) return 0;
    const transform = getCurrentZoomTransform();
    let labelCount = 0;
    for (const batch of pendingLabelBatches) {
      if (batch.scenarioId !== runtimeState.activeScenarioId
        || batch.sceneGeneration !== runtimeState.sceneGeneration
        || batch.scenarioDataGeneration !== runtimeState.scenarioDataGeneration) continue;
      const visibilityField = { airport: "showAirports", port: "showPorts", road: "showRoad", rail: "showRail" }[batch.options.familyId];
      if (!runtimeState[visibilityField]) continue;
      const entries = batch.entries.map((entry) => ({
        ...entry,
        screenX: entry.x * transform.k + transform.x,
        screenY: entry.y * transform.k + transform.y,
        screenScale: transform.k,
      }));
      const startedAt = nowMs();
      const count = batch.kind === "line"
        ? drawTransportLineLabels(entries, { ...batch.options, k, occupiedBoxes })
        : drawTransportFacilityLabels(entries, { ...batch.options, k, occupiedBoxes });
      labelCount += count;
      collectContextMetric(`${batch.metricName}Labels`, nowMs() - startedAt, {
        labelCount: count, candidateCount: entries.length, skipped: false,
      });
    }
    return labelCount;
  }

  function queueTransportLineLabels(metricName, entries, options) {
    if (!entries.length) return;
    pendingLabelBatches.push({
      kind: "line",
      metricName,
      entries,
      ...getTransportFacilityLabelBatchIdentity(runtimeState),
      options,
    });
  }

  function drawTransportLineLabels(entries, { familyId, labelColor, secondaryLabelColor, k, occupiedBoxes }) {
    const config = getTransportOverviewFamilyConfig(familyId);
    const strategy = resolveTransportOverviewLineStrategy(familyId, config, {
      scale: k,
      visualMode: getTransportOverviewVisualMode(),
    });
    if (!config.labelsEnabled || !strategy.labelsEnabled) return 0;
    const zoomConfig = getTransportOverviewLabelZoomConfig(familyId, config.labelDensity);
    const isPrimary = (entry) => familyId === "rail" ? entry.lineClass === "mainline" : entry.priority >= 4;
    const candidates = selectTransportOverviewLabelEntries(entries, {
      gridSize: getTransportLineLabelGridSize(config.labelDensity),
      isVisible: (entry) => k >= (isPrimary(entry) ? zoomConfig.nationalLabelScale : zoomConfig.regionalLabelScale)
        && (entry.projectedLength == null || entry.projectedLength * entry.screenScale >= entry.minimumScreenLength),
      compare: (left, right) => (familyId === "rail"
        ? Number(isPrimary(right)) - Number(isPrimary(left))
        : right.priority - left.priority) || (Number(right.projectedLength || 0) - Number(left.projectedLength || 0)),
      getBucketParts: familyId === "rail" ? (entry) => [entry.lineClass] : () => [],
    });
    let labelCount = 0;
    context.save();
    context.textAlign = "center";
    context.textBaseline = "middle";
    for (const entry of candidates) {
      const primary = isPrimary(entry);
      const screenFontSize = primary ? 10.5 : 9.5;
      const zoomScale = entry.screenScale;
      context.font = `${primary ? 600 : 500} ${screenFontSize / zoomScale}px "IBM Plex Sans", "Noto Sans JP", sans-serif`;
      const screenWidth = typeof context.measureText === "function"
        ? Number(context.measureText(entry.label)?.width || 0) * zoomScale
        : entry.label.length * screenFontSize * 0.58;
      // Include the screen-pixel halo in the centered label's shared collision box.
      const placement = claimScreenLabelPlacement([{
        worldX: entry.x,
        worldY: entry.y,
        box: {
          x: entry.screenX - screenWidth / 2 - 1.5,
          y: entry.screenY - screenFontSize / 2 - 1.5,
          w: screenWidth + 3,
          h: screenFontSize + 3,
        },
      }], occupiedBoxes);
      if (!placement) continue;
      context.lineWidth = 3 / zoomScale;
      context.strokeStyle = familyId === "rail" ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.88)";
      context.fillStyle = primary ? labelColor : secondaryLabelColor;
      context.strokeText(entry.label, placement.worldX, placement.worldY);
      context.fillText(entry.label, placement.worldX, placement.worldY);
      labelCount += 1;
    }
    context.restore();
    return labelCount;
  }

  // render owner 不缓存外部 helper 返回值的快照；每次 pass 前同步当前 canvas /
  // projection，保证 zoom resize 与 render-pass reset 后仍然读到最新目标。
  function syncRenderTargets() {
    context = getContext();
    pathCanvas = getPathCanvas();
    projection = getProjection();
  }

function requestTransportFacilityIconAtlasRender() {
  if (transportFacilityIconAtlasRenderQueued) return;
  transportFacilityIconAtlasRenderQueued = true;
  // atlas ready/error 都要主动失效 contextMarkers pass；否则上一帧“还没图标”的
  // 缓存会继续复用，hover/label 已经更新了，图标却还停在旧帧。
  if (typeof invalidateRenderPasses === "function") {
    invalidateRenderPasses("contextMarkers", "transport-facility-icons-ready");
  }
  if (typeof requestRender === "function") requestRender("transport-facility-icons-ready");
}

function getTransportOverviewStyleConfig() {
  return ensureTransportOverviewStyleConfigState(runtimeState);
}

function getTransportOverviewVisualMode() {
  return normalizeTransportOverviewVisualMode(getTransportOverviewStyleConfig().visualMode, "distribution");
}

function getTransportOverviewFamilyConfig(familyId) {
  const config = getTransportOverviewStyleConfig();
  return config?.[familyId] || {};
}

function getTransportCountryOverlayStateForFamily(familyId) {
  const normalizedFamilyId = String(familyId || "").trim().toLowerCase();
  const overlayState = runtimeState.transportCountryOverlayState;
  // 优先读取按 family 持久化的新 overlay；只有旧状态还没迁完时，才回退到 legacy 顶层单 family 形态。
  const familyOverlay = overlayState?.overlaysByFamily?.[normalizedFamilyId];
  if (familyOverlay?.status === "ready") return familyOverlay;
  if (overlayState?.status !== "ready" || overlayState.family !== normalizedFamilyId) return null;
  return overlayState;
}

function getTransportCountryOverlayCollection(familyId, layerKey) {
  const overlayState = getTransportCountryOverlayStateForFamily(familyId);
  return overlayState?.collectionsByLayer?.[layerKey] || null;
}

function collectTransportCountryOverlayMetric(metricName, familyId, reason) {
  const collectionKey = {
    road: "roads",
    rail: "railways",
    airport: "airports",
    port: "ports",
  }[familyId] || "airports";
  const collection = getTransportCountryOverlayCollection(familyId, collectionKey);
  collectContextMetric(metricName, 0, {
    featureCount: getFeatureCollectionFeatureCount(collection),
    visibleFeatureCount: 0,
    labelCount: 0,
    interactive: false,
    skipped: true,
    reason,
  });
}

function drawTransportOverviewLineStroke(features, { strokeStyle, lineWidth, opacity, dash = [] } = {}) {
  if (!features.length || !(opacity > 0) || !(lineWidth > 0)) return;
  context.save();
  context.globalAlpha = opacity;
  context.strokeStyle = strokeStyle;
  context.lineWidth = lineWidth;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.setLineDash(dash);
  try {
    features.forEach((feature) => {
      context.beginPath();
      pathCanvas(feature);
      context.stroke();
    });
  } finally {
    context.setLineDash([]);
    context.restore();
  }
}

function drawTransportOverviewLineSet(features, style, { baseOpacity, strategy, k, widthFloorPx = 0.75 } = {}) {
  if (!features.length) return;
  const strokeSpecs = buildTransportOverviewLineStrokeSpecs(style, {
    baseOpacity,
    strategy,
    k,
    widthFloorPx,
  });
  strokeSpecs.forEach((strokeSpec) => drawTransportOverviewLineStroke(features, strokeSpec));
}

function getCurrentZoomTransform() {
  const transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity || { x: 0, y: 0, k: 1 };
  return {
    x: Number(transform.x || 0),
    y: Number(transform.y || 0),
    k: Math.max(0.0001, Number(transform.k || 1)),
  };
}

function buildContextFacilityEntries(
  collection,
  thresholdRank = 1,
  {
    densityStrategy = null,
    getLabelText = null,
  } = {},
) {
  const featureCount = getFeatureCollectionFeatureCount(collection);
  if (!collection?.features?.length || !projection) {
    return {
      featureCount,
      entries: [],
      skipped: true,
      reason: !projection ? "no-projection" : "no-data",
    };
  }
  const targetCanvas = context?.canvas || null;
  const viewportWidth = Number(targetCanvas?.width || 0);
  const viewportHeight = Number(targetCanvas?.height || 0);
  const zoomTransform = getCurrentZoomTransform();
  const padding = 36;
  const entries = [];
  // 这里先在世界坐标下收集候选，再补齐 screen 坐标与 stableSortKey。
  // 后面的 density、hover、label 都共享这份 entry，避免不同 pass 各自做一套筛选。
  collection.features.forEach((feature) => {
    if (feature?.geometry?.type !== "Point") return;
    const coordinates = feature.geometry.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return;
    const projected = projection([coordinates[0], coordinates[1]]);
    if (!Array.isArray(projected) || !Number.isFinite(projected[0]) || !Number.isFinite(projected[1])) return;
    if (!shouldIncludeTransportOverviewPointFeature(feature, { thresholdRank })) return;
    const properties = feature.properties || {};
    const importanceRank = getTransportOverviewPointImportanceRank(feature);
    const x = projected[0];
    const y = projected[1];
    const screenX = (x * zoomTransform.k) + zoomTransform.x;
    const screenY = (y * zoomTransform.k) + zoomTransform.y;
    if (
      viewportWidth > 0
      && viewportHeight > 0
      && (screenX < -padding || screenX > viewportWidth + padding || screenY < -padding || screenY > viewportHeight + padding)
    ) {
      return;
    }
    entries.push({
      x,
      y,
      screenX,
      screenY,
      screenScale: zoomTransform.k,
      stableSortKey: getTransportFacilityEntryStableSortKey(feature, properties, coordinates),
      label: typeof getLabelText === "function"
        ? String(getLabelText(properties, feature, { importanceRank, scale: zoomTransform.k }) || "").trim()
        : String(properties.name || "").trim(),
      importanceRank,
      properties: {
        ...properties,
        __coordinates: [coordinates[0], coordinates[1]],
      },
    });
  });
  const densityFilteredEntries = densityStrategy
    ? applyTransportFacilityDensity(entries, densityStrategy)
    : entries.sort((left, right) => right.importanceRank - left.importanceRank);
  return {
    featureCount,
    entries: densityFilteredEntries,
    unfilteredVisibleFeatureCount: entries.length,
    densityLevel: densityStrategy?.level || "",
    densityGridSizePx: densityStrategy?.gridSizePx || 0,
    skipped: false,
    reason: "",
  };
}

function tintTransportFacilityIcon(context2d, { x, y, size, tintColor, strokeColor, opacity, scale, strokeScale }) {
  context2d.save();
  context2d.globalAlpha = Math.min(0.42, Math.max(0.16, opacity * 0.26));
  context2d.fillStyle = tintColor;
  context2d.beginPath();
  context2d.arc(x + (size / 2), y + (size / 2), Math.max(0, (size / 2) + (1.2 / scale)), 0, Math.PI * 2);
  context2d.fill();
  context2d.globalAlpha = Math.min(0.95, Math.max(0.46, opacity * 0.72));
  context2d.strokeStyle = strokeColor;
  context2d.lineWidth = Math.max(1 / scale, (1.35 * strokeScale) / scale);
  context2d.beginPath();
  context2d.arc(x + (size / 2), y + (size / 2), Math.max(0, (size / 2) + (0.65 / scale)), 0, Math.PI * 2);
  context2d.stroke();
  context2d.restore();
}

function drawTransportFacilityLabels(entries, {
  familyId,
  k,
  labelColor,
  labelSize,
  labelHalo,
  nationalLabelScale,
  regionalLabelScale,
  radiusScale,
  occupiedBoxes,
}) {
  const normalizedFamilyId = String(familyId || "").trim().toLowerCase();
  const configuredLabelSize = clamp(Math.round(Number(labelSize || 9)), 7, 16);
  const configuredLabelHalo = clamp(Number(labelHalo ?? 0.22), 0, 1);
  const candidates = getTransportFacilityLabelCandidates(entries, {
    k,
    configuredLabelSize,
    nationalLabelScale,
    regionalLabelScale,
  });
  let labelCount = 0;
  context.save();
  context.textAlign = "left";
  context.textBaseline = "middle";
  // label 采用“候选 -> placement -> occupiedBoxes”的单通道流程，
  // 这样国家级与地区级标签共用同一套碰撞结果，避免不同 rank 互相覆盖。
  candidates.forEach((entry) => {
    const usesFacilityIcon = normalizedFamilyId === "airport" || normalizedFamilyId === "port";
    const zoomScale = Math.max(0.0001, Number(entry.screenScale || 1));
    const iconSizePx = usesFacilityIcon
      ? resolveTransportFacilityIconDrawSizePx(normalizedFamilyId, entry.properties, { visualScale: radiusScale })
      : (entry.importanceRank >= 3 ? 10.4 : 8.6);
    const importanceScale = entry.importanceRank >= 3 ? 1 : 0.92;
    const screenFontSize = Math.max(7, Math.min(16, configuredLabelSize * importanceScale));
    const worldFontSize = usesFacilityIcon ? screenFontSize / zoomScale : screenFontSize;
    context.font = `${entry.importanceRank >= 3 ? 600 : 500} ${worldFontSize}px "IBM Plex Sans", "Noto Sans JP", sans-serif`;
    const measureText = (label) => {
      if (typeof context.measureText === "function") return Number(context.measureText(label)?.width || 0) * zoomScale;
      return String(label || "").length * screenFontSize * 0.58;
    };
    const placements = findTransportFacilityLabelPlacement(entry, {
      fontSizePx: screenFontSize,
      iconSizePx,
      zoomScale,
      measureText,
      zoomTransform: getCurrentZoomTransform(),
    });
    const placement = claimScreenLabelPlacement(placements, occupiedBoxes);
    if (!placement) return;
    context.lineWidth = usesFacilityIcon ? ((0.45 + (configuredLabelHalo * 2.4)) / zoomScale) : 3;
    context.strokeStyle = `rgba(255,255,255,${(0.16 + (configuredLabelHalo * 0.62)).toFixed(3)})`;
    context.fillStyle = labelColor;
    if (configuredLabelHalo > 0.01) context.strokeText(entry.label, placement.worldX, placement.worldY);
    context.fillText(entry.label, placement.worldX, placement.worldY);
    labelCount += 1;
  });
  context.restore();
  return labelCount;
}

function drawContextFacilityPointLayer(
  metricName,
  collection,
  k,
  {
    familyId = "",
    interactive = false,
    visible = true,
    thresholdRank = 1,
    shape = "diamond",
    fillStyle = "#2563eb",
    strokeStyle = "#eff6ff",
    labelColor = "#1e3a8a",
    labelSize = 9,
    labelHalo = 0.22,
    opacity = 0.9,
    labelsEnabled = true,
    nationalLabelScale = 2.2,
    regionalLabelScale = 5.2,
    getLabelText = null,
    radiusScale = 1,
    strokeScale = 1,
    hoverScale = 1.18,
    highlightStroke = "#ffffff",
    packId = "global",
    appendHoverEntries = false,
  } = {},
) {
  const startedAt = nowMs();
  const normalizedFamilyId = String(familyId || "").trim().toLowerCase();
  const normalizedPackId = String(packId || "global").trim().toLowerCase() || "global";
  const clearCurrentPackHoverEntries = () => {
    // 国家包 overlay 追加 hover entry 时，只清自己这一个 pack 的条目，
    // 保留 global overview 的基础条目，避免 country overlay 把全局 hover 语义整体抹掉。
    if (appendHoverEntries) {
      setVisibleFacilityHoverEntries(normalizedFamilyId, [], { append: true, packId: normalizedPackId });
      return;
    }
    clearFacilityHoverEntries(normalizedFamilyId);
  };
  if (!visible) {
    clearCurrentPackHoverEntries();
    collectContextMetric(metricName, nowMs() - startedAt, {
      featureCount: getFeatureCollectionFeatureCount(collection),
      visibleFeatureCount: 0,
      labelCount: 0,
      interactive: !!interactive,
      skipped: true,
      reason: "hidden",
    });
    return;
  }
  if (interactive) {
    collectContextMetric(metricName, nowMs() - startedAt, {
      featureCount: getFeatureCollectionFeatureCount(collection),
      visibleFeatureCount: 0,
      labelCount: 0,
      interactive: true,
      skipped: true,
      reason: "interactive-pass",
    });
    return;
  }
  const renderState = buildContextFacilityEntries(collection, thresholdRank, {
    // 机场/港口的 global overview 先在屏幕空间做密度裁剪；
    // country overlay 仍沿用同一渲染/hover 通道，只是叠加更细的 pack 数据。
    densityStrategy: normalizedFamilyId === "airport" || normalizedFamilyId === "port"
      ? getTransportFacilityDensityStrategy(k)
      : null,
    getLabelText,
  });
  if (renderState.skipped) {
    clearCurrentPackHoverEntries();
    collectContextMetric(metricName, nowMs() - startedAt, {
      featureCount: renderState.featureCount,
      visibleFeatureCount: 0,
      labelCount: 0,
      interactive: !!interactive,
      skipped: true,
      reason: renderState.reason,
    });
    return;
  }
  const activeHighlightKey = buildFacilityEntryKey(getActiveFacilityHighlightEntry());
  const hoverEntries = [];
  const usesFacilityIconLayer = normalizedFamilyId === "airport" || normalizedFamilyId === "port";
  // 这一段同时承担三件事：绘制 marker、生成 hover entries、以及 atlas ready 后触发重绘。
  // atlas 未就绪时也要沿用同一批 entry 语义，这样可见 fallback 和交互目标始终一致。
  const iconAtlasImage = usesFacilityIconLayer
    ? getTransportFacilityIconAtlasImage(requestTransportFacilityIconAtlasRender)
    : null;
  const iconAtlasStatus = usesFacilityIconLayer
    ? (getTransportFacilityIconAtlasStatus() || "unavailable")
    : "";
  const canDrawIconAtlas = !!iconAtlasImage && isTransportFacilityIconAtlasReady();
  context.save();
  context.lineJoin = "round";
  context.lineCap = "round";
  context.globalAlpha = opacity;
  renderState.entries.forEach((entry) => {
    const radiusBase = entry.importanceRank >= 3 ? 5.2 : entry.importanceRank === 2 ? 4.3 : 3.5;
    const iconKey = resolveTransportFacilityIconKey(normalizedFamilyId, entry.properties);
    const iconCell = getTransportFacilityIconCell(iconKey);
    const iconSizePx = iconCell
      ? resolveTransportFacilityIconDrawSizePx(normalizedFamilyId, entry.properties, { visualScale: radiusScale })
      : radiusBase * radiusScale * 2;
    const zoomScale = Math.max(0.0001, Number(entry.screenScale || 1));
    const drawsAtlasIcon = !!iconCell && canDrawIconAtlas;
    const markerEntry = {
      familyId: normalizedFamilyId,
      packId: normalizedPackId,
      stableId: String(entry.properties?.stable_key || entry.properties?.id || entry.label || `${entry.x}:${entry.y}`).trim(),
      shape: drawsAtlasIcon ? "icon" : shape,
      iconKey,
      markerRadiusPx: iconCell ? Math.max(4.5, iconSizePx * 0.52) : radiusBase * radiusScale,
      hoverScale: Number(hoverScale || 1.18),
      highlightStroke: String(highlightStroke || strokeStyle || "#ffffff"),
      projectedPoint: [entry.x, entry.y],
      screenPoint: [entry.screenX, entry.screenY],
      coordinates: Array.isArray(entry.properties?.__coordinates) ? entry.properties.__coordinates : null,
      properties: entry.properties,
    };
    markerEntry.hoverRadiusPx = getFacilityHoverRadiusPx(markerEntry);
    markerEntry.tooltipText = buildFacilityTooltipText(markerEntry);
    hoverEntries.push(markerEntry);
    const highlightFactor = buildFacilityEntryKey(markerEntry) && buildFacilityEntryKey(markerEntry) === activeHighlightKey ? markerEntry.hoverScale : 1;
    if (drawsAtlasIcon) {
      const iconWorldSize = (iconSizePx * highlightFactor) / zoomScale;
      const iconLeft = entry.x - (iconWorldSize / 2);
      const iconTop = entry.y - (iconWorldSize / 2);
      tintTransportFacilityIcon(context, {
        x: iconLeft,
        y: iconTop,
        size: iconWorldSize,
        tintColor: fillStyle,
        strokeColor: highlightFactor > 1 ? markerEntry.highlightStroke : strokeStyle,
        opacity,
        scale: zoomScale,
        strokeScale,
      });
      context.drawImage(
        iconAtlasImage,
        iconCell.x,
        iconCell.y,
        iconCell.size,
        iconCell.size,
        iconLeft,
        iconTop,
        iconWorldSize,
        iconWorldSize,
      );
      return;
    }
    const radius = (markerEntry.markerRadiusPx * highlightFactor) / zoomScale;
    context.beginPath();
    if (shape === "square") {
      context.rect(entry.x - radius, entry.y - radius, radius * 2, radius * 2);
    } else {
      context.moveTo(entry.x, entry.y - radius);
      context.lineTo(entry.x + radius, entry.y);
      context.lineTo(entry.x, entry.y + radius);
      context.lineTo(entry.x - radius, entry.y);
      context.closePath();
    }
    context.fillStyle = fillStyle;
    context.strokeStyle = strokeStyle;
    context.lineWidth = ((entry.importanceRank >= 3 ? 1.4 : 1.1) * strokeScale) / zoomScale;
    context.fill();
    context.stroke();
  });
  context.restore();
  setVisibleFacilityHoverEntries(normalizedFamilyId, hoverEntries, {
    append: appendHoverEntries,
    packId: normalizedPackId,
  });

  if (!labelsEnabled) {
    collectContextMetric(metricName, nowMs() - startedAt, {
      featureCount: renderState.featureCount,
      visibleFeatureCount: renderState.entries.length,
      labelCount: 0,
      interactive: !!interactive,
      skipped: false,
      unfilteredVisibleFeatureCount: renderState.unfilteredVisibleFeatureCount,
      densityLevel: renderState.densityLevel,
      densityGridSizePx: renderState.densityGridSizePx,
      iconAtlasStatus: iconAtlasStatus || undefined,
    });
    return;
  }

  pendingLabelBatches.push({
    entries: renderState.entries,
    metricName,
    ...getTransportFacilityLabelBatchIdentity(runtimeState),
    options: {
      familyId: normalizedFamilyId,
      labelColor,
      labelSize,
      labelHalo,
      nationalLabelScale,
      regionalLabelScale,
      radiusScale,
    },
  });

  collectContextMetric(metricName, nowMs() - startedAt, {
    featureCount: renderState.featureCount,
    visibleFeatureCount: renderState.entries.length,
    labelCount: 0,
    labelCandidateCount: renderState.entries.length,
    labelsDeferred: true,
    interactive: !!interactive,
    skipped: false,
    unfilteredVisibleFeatureCount: renderState.unfilteredVisibleFeatureCount,
    densityLevel: renderState.densityLevel,
    densityGridSizePx: renderState.densityGridSizePx,
    iconAtlasStatus: iconAtlasStatus || undefined,
  });
}

function drawAirportPointCollection(metricName, collection, k, { interactive = false, packId = "global", appendHoverEntries = false } = {}) {
  const airportConfig = getTransportOverviewFamilyConfig("airport");
  const labelZoomConfig = getTransportOverviewLabelZoomConfig("airport", airportConfig.labelDensity);
  const visualStyle = getTransportOverviewAirportVisualStyle(airportConfig.primaryColor, airportConfig.visualStrength);
  const strategy = resolveTransportOverviewPointStrategy("airport", airportConfig, {
    scale: k,
    visualMode: getTransportOverviewVisualMode(),
  });
  drawContextFacilityPointLayer(metricName, collection, k, {
    familyId: "airport",
    interactive,
    visible: !!runtimeState.showTransport && !!runtimeState.showAirports,
    thresholdRank: strategy.thresholdRank,
    fillStyle: visualStyle.fillStyle,
    strokeStyle: visualStyle.strokeStyle,
    labelColor: visualStyle.labelColor,
    opacity: clamp(Number(airportConfig.opacity ?? 0.68), 0, 1) * strategy.opacityMultiplier,
    labelsEnabled: strategy.labelsEnabled,
    labelSize: airportConfig.labelSize,
    labelHalo: airportConfig.labelHalo,
    nationalLabelScale: labelZoomConfig.nationalLabelScale,
    regionalLabelScale: labelZoomConfig.regionalLabelScale,
    radiusScale: visualStyle.radiusScale * strategy.radiusMultiplier,
    strokeScale: visualStyle.strokeScale * strategy.strokeMultiplier,
    hoverScale: visualStyle.hoverScale,
    highlightStroke: visualStyle.highlightStroke,
    getLabelText: (properties, feature, labelOptions) => getTransportOverviewAirportLabelText(properties, airportConfig.labelMode, {
      ...labelOptions,
      labelSize: airportConfig.labelSize,
    }),
    packId,
    appendHoverEntries,
  });
}

function drawCountryAirportsLayer(k, { interactive = false } = {}) {
  const overlayState = getTransportCountryOverlayStateForFamily("airport");
  if (!overlayState) return;
  drawAirportPointCollection("drawCountryAirportsLayer", overlayState.collectionsByLayer?.airports, k, {
    interactive,
    packId: overlayState.activePackId,
    appendHoverEntries: true,
  });
}

function drawAirportsLayer(k, { interactive = false } = {}) {
  syncRenderTargets();
  // 主图先画 global overview，再把已经 Apply 的 country overlay 叠上去。
  // 这样默认世界层始终可见，国家包只覆盖当前 family 的增强细节。
  drawAirportPointCollection("drawAirportsLayer", runtimeState.airportsData, k, { interactive });
  drawCountryAirportsLayer(k, { interactive });
}

function drawPortsLayer(k, { interactive = false } = {}) {
  syncRenderTargets();
  drawPortPointCollection("drawPortsLayer", runtimeState.portsData, k, { interactive });
  drawCountryPortsLayer(k, { interactive });
}

function drawCountryPortsLayer(k, { interactive = false } = {}) {
  const overlayState = getTransportCountryOverlayStateForFamily("port");
  if (!overlayState) return;
  drawPortPointCollection("drawCountryPortsLayer", overlayState.collectionsByLayer?.ports, k, {
    interactive,
    packId: overlayState.activePackId,
    appendHoverEntries: true,
  });
}

function drawPortPointCollection(metricName, collection, k, { interactive = false, packId = "global", appendHoverEntries = false } = {}) {
  const portConfig = getTransportOverviewFamilyConfig("port");
  const labelZoomConfig = getTransportOverviewLabelZoomConfig("port", portConfig.labelDensity);
  const visualStyle = getTransportOverviewPortVisualStyle(portConfig.primaryColor, portConfig.visualStrength);
  const strategy = resolveTransportOverviewPointStrategy("port", portConfig, {
    scale: k,
    visualMode: getTransportOverviewVisualMode(),
  });
  drawContextFacilityPointLayer(metricName, collection, k, {
    familyId: "port",
    interactive,
    visible: !!runtimeState.showTransport && !!runtimeState.showPorts,
    thresholdRank: strategy.thresholdRank,
    shape: "square",
    fillStyle: visualStyle.fillStyle,
    strokeStyle: visualStyle.strokeStyle,
    labelColor: visualStyle.labelColor,
    opacity: clamp(Number(portConfig.opacity ?? 0.64), 0, 1) * strategy.opacityMultiplier,
    labelsEnabled: strategy.labelsEnabled,
    labelSize: portConfig.labelSize,
    labelHalo: portConfig.labelHalo,
    nationalLabelScale: labelZoomConfig.nationalLabelScale,
    regionalLabelScale: labelZoomConfig.regionalLabelScale,
    radiusScale: visualStyle.radiusScale * strategy.radiusMultiplier,
    strokeScale: visualStyle.strokeScale * strategy.strokeMultiplier,
    hoverScale: visualStyle.hoverScale,
    highlightStroke: visualStyle.highlightStroke,
    getLabelText: (properties, feature, labelOptions) => getTransportOverviewPortLabelText(properties, portConfig.labelMode, {
      ...labelOptions,
      labelSize: portConfig.labelSize,
    }),
    packId,
    appendHoverEntries,
  });
}

function selectTransportOverviewLabelEntries(candidates, {
  gridSize,
  isVisible,
  compare,
  getBucketParts = () => [],
} = {}) {
  const usedBuckets = new Set();
  const visibleLabelEntries = [];
  candidates
    .filter((entry) => typeof isVisible === "function" ? isVisible(entry) : true)
    .sort(compare)
    .forEach((entry) => {
      const bucketKey = [
        Math.round((entry.screenX ?? entry.x) / gridSize),
        Math.round((entry.screenY ?? entry.y) / gridSize),
        ...getBucketParts(entry),
      ].join(":");
      if (usedBuckets.has(bucketKey)) return;
      usedBuckets.add(bucketKey);
      visibleLabelEntries.push(entry);
    });
  return visibleLabelEntries;
}

function drawRailwaysLayer(k, { interactive = false } = {}) {
  pendingLabelBatches = pendingLabelBatches.filter((batch) => batch.metricName !== "drawRailwaysLayer");
  syncRenderTargets();
  const startedAt = nowMs();
  const visible = !!runtimeState.showTransport && !!runtimeState.showRail;
  const collection = runtimeState.railwaysData;
  const featureCount = getFeatureCollectionFeatureCount(collection);
  if (!visible) {
    collectContextMetric("drawRailwaysLayer", nowMs() - startedAt, {
      featureCount,
      visibleFeatureCount: 0,
      labelCount: 0,
      interactive: !!interactive,
      skipped: true,
      reason: "hidden",
    });
    return;
  }
  if (interactive) {
    collectContextMetric("drawRailwaysLayer", nowMs() - startedAt, {
      featureCount,
      visibleFeatureCount: 0,
      labelCount: 0,
      interactive: true,
      skipped: true,
      reason: "interactive-pass",
    });
    return;
  }
  if (!collection?.features?.length || !pathCanvas) {
    collectContextMetric("drawRailwaysLayer", nowMs() - startedAt, {
      featureCount,
      visibleFeatureCount: 0,
      labelCount: 0,
      interactive: !!interactive,
      skipped: true,
      reason: !pathCanvas ? "no-path" : "no-data",
    });
    drawCountryRailwaysLayer(k, { interactive });
    return;
  }
  const railConfig = getTransportOverviewFamilyConfig("rail");
  const strategy = resolveTransportOverviewLineStrategy("rail", railConfig, {
    scale: k,
    visualMode: getTransportOverviewVisualMode(),
  });
  const visualStyle = getTransportOverviewRailVisualStyle(railConfig.primaryColor, railConfig.visualStrength);
  const featuresByClass = {
    secondary: [],
    regional: [],
    mainline: [],
  };
  const labelCandidates = [];
  collection.features.forEach((feature) => {
    const properties = feature?.properties || {};
    const lineClass = getIncludedTransportOverviewLineClass("rail", feature, strategy);
    if (!lineClass) return;
    if (lineClass === "mainline") {
      featuresByClass.mainline.push(feature);
    } else if (lineClass === "regional") {
      featuresByClass.regional.push(feature);
    } else if (lineClass === "secondary") {
      featuresByClass.secondary.push(feature);
    } else {
      return;
    }

    const label = getTransportOverviewRailLabelText(properties, railConfig.labelMode);
    if (!label || !railConfig.labelsEnabled || typeof projection !== "function") return;
    const anchorGeo = getTransportLineFeatureLabelAnchor(feature, {
      getLineMidpointFromCoordinates,
      getMultiLineLabelAnchor,
    });
    if (!Array.isArray(anchorGeo) || anchorGeo.length < 2) return;
    const anchorProjected = projection(anchorGeo);
    if (!Array.isArray(anchorProjected) || anchorProjected.length < 2 || !Number.isFinite(anchorProjected[0]) || !Number.isFinite(anchorProjected[1])) return;
    const projectedLines = projectTransportLineGeometry(feature.geometry, projection);
    const projectedLength = measureProjectedLineSetLength(projectedLines);
    const minimumScreenLength = lineClass === "mainline" ? 110 : lineClass === "regional" ? 72 : 58;
    labelCandidates.push({
      label,
      lineClass,
      projectedLength,
      minimumScreenLength,
      x: anchorProjected[0],
      y: anchorProjected[1],
    });
  });
  const stationCollection = runtimeState.railStationsMajorData;
  const stationFeatureCount = getFeatureCollectionFeatureCount(stationCollection);
  if (Array.isArray(stationCollection?.features) && stationCollection.features.length) {
    drawContextFacilityPointLayer("drawRailStationsMajorLayer", stationCollection, k, {
      familyId: "rail",
      interactive,
      visible,
      thresholdRank: 1,
      shape: "square",
      fillStyle: visualStyle.regionalStroke,
      strokeStyle: mixCanvasColors(visualStyle.regionalStroke, "#ffffff", 0.7) || "#ffffff",
      labelColor: visualStyle.mainlineStroke,
      opacity: clamp(Number(railConfig.opacity ?? 0.72), 0, 1) * 0.9 * strategy.opacityMultiplier,
      labelsEnabled: false,
      radiusScale: 0.92 * Math.max(0.88, strategy.widthMultiplier * 0.92),
      strokeScale: 0.95,
      hoverScale: 1.1,
      highlightStroke: "#ffffff",
      getLabelText: null,
    });
  } else {
    collectContextMetric("drawRailStationsMajorLayer", 0, {
      featureCount: stationFeatureCount,
      visibleFeatureCount: 0,
      labelCount: 0,
      interactive: !!interactive,
      skipped: true,
      reason: visible ? "no-data" : "hidden",
    });
  }
  const visibleFeatureCount = featuresByClass.mainline.length + featuresByClass.regional.length + featuresByClass.secondary.length;
  if (!visibleFeatureCount) {
    collectContextMetric("drawRailwaysLayer", nowMs() - startedAt, {
      featureCount,
      visibleFeatureCount: 0,
      labelCount: 0,
      interactive: !!interactive,
      skipped: true,
      reason: "filtered",
    });
    drawCountryRailwaysLayer(k, { interactive });
    return;
  }

  const baseRailOpacity = clamp(Number(railConfig.opacity ?? 0.72), 0, 1);
  drawTransportOverviewLineSet(featuresByClass.secondary, {
    casingStroke: visualStyle.secondaryCasingStroke,
    innerStroke: visualStyle.secondaryStroke,
    casingWidth: visualStyle.secondaryCasingWidth,
    innerWidth: visualStyle.secondaryWidth,
    opacity: visualStyle.secondaryOpacity,
    dashPx: visualStyle.secondaryDashPx,
  }, {
    baseOpacity: baseRailOpacity,
    strategy,
    k,
    widthFloorPx: 0.78,
  });
  drawTransportOverviewLineSet(featuresByClass.regional, {
    casingStroke: visualStyle.regionalCasingStroke,
    innerStroke: visualStyle.regionalStroke,
    casingWidth: visualStyle.regionalCasingWidth,
    innerWidth: visualStyle.regionalWidth,
    opacity: visualStyle.regionalOpacity,
    dashPx: visualStyle.regionalDashPx,
  }, {
    baseOpacity: baseRailOpacity,
    strategy,
    k,
    widthFloorPx: 0.9,
  });
  drawTransportOverviewLineSet(featuresByClass.mainline, {
    casingStroke: visualStyle.mainlineCasingStroke,
    innerStroke: visualStyle.mainlineStroke,
    casingWidth: visualStyle.mainlineCasingWidth,
    innerWidth: visualStyle.mainlineWidth,
    opacity: visualStyle.mainlineOpacity,
  }, {
    baseOpacity: baseRailOpacity,
    strategy,
    k,
    widthFloorPx: 1.05,
  });

  queueTransportLineLabels("drawRailwaysLayer", labelCandidates, {
    familyId: "rail",
    labelColor: visualStyle.mainlineStroke,
    secondaryLabelColor: visualStyle.mainlineStroke,
  });

  collectContextMetric("drawRailwaysLayer", nowMs() - startedAt, {
    featureCount,
    visibleFeatureCount,
    labelCount: 0,
    labelsDeferred: true,
    interactive: !!interactive,
    skipped: false,
  });
  drawCountryRailwaysLayer(k, { interactive });
}

function drawRoadsLayer(k, { interactive = false } = {}) {
  pendingLabelBatches = pendingLabelBatches.filter((batch) => batch.kind !== "line" || batch.options.familyId !== "road");
  syncRenderTargets();
  const startedAt = nowMs();
  const visible = !!runtimeState.showTransport && !!runtimeState.showRoad;
  const collection = runtimeState.roadsData;
  const featureCount = getFeatureCollectionFeatureCount(collection);
  if (!visible) {
    collectContextMetric("drawRoadsLayer", nowMs() - startedAt, {
      featureCount,
      visibleFeatureCount: 0,
      labelCount: 0,
      interactive: !!interactive,
      skipped: true,
      reason: "hidden",
    });
    return;
  }
  if (interactive) {
    collectContextMetric("drawRoadsLayer", nowMs() - startedAt, {
      featureCount,
      visibleFeatureCount: 0,
      labelCount: 0,
      interactive: true,
      skipped: true,
      reason: "interactive-pass",
    });
    return;
  }
  if (!collection?.features?.length || !pathCanvas) {
    collectContextMetric("drawRoadsLayer", nowMs() - startedAt, {
      featureCount,
      visibleFeatureCount: 0,
      labelCount: 0,
      interactive: !!interactive,
      skipped: true,
      reason: !pathCanvas ? "no-path" : "no-data",
    });
    drawCountryRoadsLayer(k, { interactive });
    return;
  }
  const roadConfig = getTransportOverviewFamilyConfig("road");
  const strategy = resolveTransportOverviewLineStrategy("road", roadConfig, {
    scale: k,
    visualMode: getTransportOverviewVisualMode(),
  });
  const visualStyle = getTransportOverviewRoadVisualStyle(roadConfig.primaryColor, roadConfig.visualStrength);
  const featuresByClass = {
    secondary: [],
    primary: [],
    trunk: [],
    motorway: [],
  };
  collection.features.forEach((feature) => {
    const roadClass = getIncludedTransportOverviewLineClass("road", feature, strategy);
    if (!roadClass) return;
    if (roadClass === "motorway") {
      featuresByClass.motorway.push(feature);
    } else if (roadClass === "trunk") {
      featuresByClass.trunk.push(feature);
    } else if (roadClass === "primary") {
      featuresByClass.primary.push(feature);
    } else if (roadClass === "secondary") {
      featuresByClass.secondary.push(feature);
    }
  });
  const visibleFeatureCount = featuresByClass.motorway.length + featuresByClass.trunk.length + featuresByClass.primary.length + featuresByClass.secondary.length;
  if (!visibleFeatureCount) {
    collectContextMetric("drawRoadsLayer", nowMs() - startedAt, {
      featureCount,
      visibleFeatureCount: 0,
      labelCount: 0,
      interactive: !!interactive,
      skipped: true,
      reason: "filtered",
    });
    drawCountryRoadsLayer(k, { interactive });
    return;
  }

  const baseRoadOpacity = clamp(Number(roadConfig.opacity ?? 0.72), 0, 1);
  drawTransportOverviewLineSet(featuresByClass.secondary, {
    casingStroke: visualStyle.secondaryCasingStroke,
    innerStroke: visualStyle.secondaryStroke,
    casingWidth: visualStyle.secondaryCasingWidth,
    innerWidth: visualStyle.secondaryWidth,
    opacity: visualStyle.secondaryOpacity,
    dashPx: visualStyle.secondaryDashPx,
  }, {
    baseOpacity: baseRoadOpacity,
    strategy,
    k,
    widthFloorPx: 0.68,
  });
  drawTransportOverviewLineSet(featuresByClass.primary, {
    casingStroke: visualStyle.primaryCasingStroke,
    innerStroke: visualStyle.primaryStroke,
    casingWidth: visualStyle.primaryCasingWidth,
    innerWidth: visualStyle.primaryWidth,
    opacity: visualStyle.primaryOpacity,
    dashPx: visualStyle.primaryDashPx,
  }, {
    baseOpacity: baseRoadOpacity,
    strategy,
    k,
    widthFloorPx: 0.78,
  });
  drawTransportOverviewLineSet(featuresByClass.trunk, {
    casingStroke: visualStyle.trunkCasingStroke,
    innerStroke: visualStyle.trunkStroke,
    casingWidth: visualStyle.trunkCasingWidth,
    innerWidth: visualStyle.trunkWidth,
    opacity: visualStyle.trunkOpacity,
    dashPx: visualStyle.trunkDashPx,
  }, {
    baseOpacity: baseRoadOpacity,
    strategy,
    k,
    widthFloorPx: 0.95,
  });
  drawTransportOverviewLineSet(featuresByClass.motorway, {
    casingStroke: visualStyle.motorwayCasingStroke,
    innerStroke: visualStyle.motorwayStroke,
    casingWidth: visualStyle.motorwayCasingWidth,
    innerWidth: visualStyle.motorwayWidth,
    opacity: visualStyle.motorwayOpacity,
  }, {
    baseOpacity: baseRoadOpacity,
    strategy,
    k,
    widthFloorPx: 1.1,
  });

  const labelsEnabled = !!roadConfig.labelsEnabled && strategy.labelsEnabled && typeof projection === "function";
  if (labelsEnabled) {
    const labelCandidates = [];
    Object.entries(featuresByClass).forEach(([roadClass, features]) => {
      features.forEach((feature) => {
        const properties = feature?.properties || {};
        const label = getTransportOverviewRoadLabelText(properties, roadConfig.labelMode);
        if (!label) return;
        const anchorGeo = getTransportLineFeatureLabelAnchor(feature, {
          getLineMidpointFromCoordinates,
          getMultiLineLabelAnchor,
        });
        if (!Array.isArray(anchorGeo) || anchorGeo.length < 2) return;
        const anchorProjected = projection(anchorGeo);
        if (!Array.isArray(anchorProjected) || anchorProjected.length < 2 || !Number.isFinite(anchorProjected[0]) || !Number.isFinite(anchorProjected[1])) return;
        const projectedLines = projectTransportLineGeometry(feature.geometry, projection);
        const projectedLength = measureProjectedLineSetLength(projectedLines);
        const minimumScreenLength = roadClass === "motorway" ? 120 : roadClass === "trunk" ? 88 : 70;
        labelCandidates.push({
          label,
          roadClass,
          projectedLength,
          minimumScreenLength,
          x: anchorProjected[0],
          y: anchorProjected[1],
          priority: getRoadLabelClassPriority(roadClass),
        });
      });
    });
    queueTransportLineLabels("drawRoadsLayer", labelCandidates, {
      familyId: "road",
      labelColor: visualStyle.motorwayStroke,
      secondaryLabelColor: visualStyle.trunkStroke,
    });
  }

  collectContextMetric("drawRoadsLayer", nowMs() - startedAt, {
    featureCount,
    visibleFeatureCount,
    labelCount: 0,
    labelsDeferred: true,
    interactive: !!interactive,
    skipped: false,
  });
  drawCountryRoadsLayer(k, { interactive });
}


function drawCountryRailwaysLayer(k, { interactive = false } = {}) {
  syncRenderTargets();
  const startedAt = nowMs();
  const overlayState = getTransportCountryOverlayStateForFamily("rail");
  if (!overlayState) return;
  // country rail overlay 只在对应 family 已 Apply 且 source gate 通过后参与主图渲染。
  const visible = !!runtimeState.showTransport && !!runtimeState.showRail;
  const collection = overlayState.collectionsByLayer?.railways;
  const stationCollection = overlayState.collectionsByLayer?.rail_stations_major;
  const featureCount = getFeatureCollectionFeatureCount(collection);
  if (!visible) {
    collectContextMetric("drawCountryRailwaysLayer", nowMs() - startedAt, {
      featureCount,
      visibleFeatureCount: 0,
      labelCount: 0,
      interactive: !!interactive,
      skipped: true,
      reason: "hidden",
    });
    setVisibleFacilityHoverEntries("rail", [], { append: true, packId: overlayState.activePackId });
    return;
  }
  if (interactive) {
    collectContextMetric("drawCountryRailwaysLayer", nowMs() - startedAt, {
      featureCount,
      visibleFeatureCount: 0,
      labelCount: 0,
      interactive: true,
      skipped: true,
      reason: "interactive-pass",
    });
    return;
  }
  const railConfig = getTransportOverviewFamilyConfig("rail");
  const strategy = resolveTransportOverviewLineStrategy("rail", railConfig, {
    scale: k,
    visualMode: getTransportOverviewVisualMode(),
  });
  const visualStyle = getTransportOverviewRailVisualStyle(railConfig.primaryColor, railConfig.visualStrength);
  drawContextFacilityPointLayer("drawCountryRailStationsMajorLayer", stationCollection, k, {
    familyId: "rail",
    interactive,
    visible,
    thresholdRank: 1,
    shape: "square",
    fillStyle: visualStyle.regionalStroke,
    strokeStyle: mixCanvasColors(visualStyle.regionalStroke, "#ffffff", 0.7) || "#ffffff",
    labelColor: visualStyle.mainlineStroke,
    opacity: clamp(Number(railConfig.opacity ?? 0.72), 0, 1) * 0.9 * strategy.opacityMultiplier,
    labelsEnabled: false,
    radiusScale: 0.92 * Math.max(0.88, strategy.widthMultiplier * 0.92),
    strokeScale: 0.95,
    hoverScale: 1.1,
    highlightStroke: "#ffffff",
    getLabelText: null,
    packId: overlayState.activePackId,
    appendHoverEntries: true,
  });
  if (!collection?.features?.length || !pathCanvas) {
    collectContextMetric("drawCountryRailwaysLayer", nowMs() - startedAt, {
      featureCount,
      visibleFeatureCount: 0,
      labelCount: 0,
      interactive: !!interactive,
      skipped: true,
      reason: !pathCanvas ? "no-path" : "no-data",
    });
    return;
  }
  const featuresByClass = {
    secondary: [],
    regional: [],
    mainline: [],
  };
  collection.features.forEach((feature) => {
    const lineClass = getIncludedTransportOverviewLineClass("rail", feature, strategy);
    if (!lineClass) return;
    if (lineClass === "mainline") featuresByClass.mainline.push(feature);
    else if (lineClass === "regional") featuresByClass.regional.push(feature);
    else if (lineClass === "secondary") featuresByClass.secondary.push(feature);
  });
  const visibleFeatureCount = featuresByClass.mainline.length + featuresByClass.regional.length + featuresByClass.secondary.length;
  if (!visibleFeatureCount) {
    collectContextMetric("drawCountryRailwaysLayer", nowMs() - startedAt, {
      featureCount,
      visibleFeatureCount: 0,
      labelCount: 0,
      interactive: !!interactive,
      skipped: true,
      reason: "filtered",
    });
    return;
  }
  const baseRailOpacity = clamp(Number(railConfig.opacity ?? 0.72), 0, 1);
  drawTransportOverviewLineSet(featuresByClass.secondary, {
    casingStroke: visualStyle.secondaryCasingStroke,
    innerStroke: visualStyle.secondaryStroke,
    casingWidth: visualStyle.secondaryCasingWidth,
    innerWidth: visualStyle.secondaryWidth,
    opacity: visualStyle.secondaryOpacity,
    dashPx: visualStyle.secondaryDashPx,
  }, { baseOpacity: baseRailOpacity, strategy, k, widthFloorPx: 0.78 });
  drawTransportOverviewLineSet(featuresByClass.regional, {
    casingStroke: visualStyle.regionalCasingStroke,
    innerStroke: visualStyle.regionalStroke,
    casingWidth: visualStyle.regionalCasingWidth,
    innerWidth: visualStyle.regionalWidth,
    opacity: visualStyle.regionalOpacity,
    dashPx: visualStyle.regionalDashPx,
  }, { baseOpacity: baseRailOpacity, strategy, k, widthFloorPx: 0.9 });
  drawTransportOverviewLineSet(featuresByClass.mainline, {
    casingStroke: visualStyle.mainlineCasingStroke,
    innerStroke: visualStyle.mainlineStroke,
    casingWidth: visualStyle.mainlineCasingWidth,
    innerWidth: visualStyle.mainlineWidth,
    opacity: visualStyle.mainlineOpacity,
  }, { baseOpacity: baseRailOpacity, strategy, k, widthFloorPx: 1.05 });
  collectContextMetric("drawCountryRailwaysLayer", nowMs() - startedAt, {
    featureCount,
    visibleFeatureCount,
    labelCount: 0,
    interactive: !!interactive,
    skipped: false,
  });
}

function drawCountryRoadsLayer(k, { interactive = false } = {}) {
  pendingLabelBatches = pendingLabelBatches.filter((batch) => batch.metricName !== "drawCountryRoadsLayer");
  syncRenderTargets();
  const startedAt = nowMs();
  const overlayState = getTransportCountryOverlayStateForFamily("road");
  if (!overlayState) return;
  const visible = !!runtimeState.showTransport && !!runtimeState.showRoad;
  const collection = overlayState.collectionsByLayer?.roads;
  const labelCollection = overlayState.collectionsByLayer?.road_labels;
  const featureCount = getFeatureCollectionFeatureCount(collection);
  if (!visible) {
    collectContextMetric("drawCountryRoadsLayer", nowMs() - startedAt, {
      featureCount,
      visibleFeatureCount: 0,
      labelCount: 0,
      interactive: !!interactive,
      skipped: true,
      reason: "hidden",
    });
    return;
  }
  if (interactive) {
    collectContextMetric("drawCountryRoadsLayer", nowMs() - startedAt, {
      featureCount,
      visibleFeatureCount: 0,
      labelCount: 0,
      interactive: true,
      skipped: true,
      reason: "interactive-pass",
    });
    return;
  }
  if (!collection?.features?.length || !pathCanvas) {
    collectContextMetric("drawCountryRoadsLayer", nowMs() - startedAt, {
      featureCount,
      visibleFeatureCount: 0,
      labelCount: 0,
      interactive: !!interactive,
      skipped: true,
      reason: !pathCanvas ? "no-path" : "no-data",
    });
    return;
  }
  const roadConfig = getTransportOverviewFamilyConfig("road");
  const strategy = resolveTransportOverviewLineStrategy("road", roadConfig, {
    scale: k,
    visualMode: getTransportOverviewVisualMode(),
  });
  const visualStyle = getTransportOverviewRoadVisualStyle(roadConfig.primaryColor, roadConfig.visualStrength);
  const featuresByClass = {
    secondary: [],
    primary: [],
    trunk: [],
    motorway: [],
  };
  collection.features.forEach((feature) => {
    const roadClass = getIncludedTransportOverviewLineClass("road", feature, strategy);
    if (!roadClass) return;
    if (roadClass === "motorway") featuresByClass.motorway.push(feature);
    else if (roadClass === "trunk") featuresByClass.trunk.push(feature);
    else if (roadClass === "primary") featuresByClass.primary.push(feature);
    else if (roadClass === "secondary") featuresByClass.secondary.push(feature);
  });
  const visibleFeatureCount = featuresByClass.motorway.length + featuresByClass.trunk.length + featuresByClass.primary.length + featuresByClass.secondary.length;
  if (!visibleFeatureCount) {
    collectContextMetric("drawCountryRoadsLayer", nowMs() - startedAt, {
      featureCount,
      visibleFeatureCount: 0,
      labelCount: 0,
      interactive: !!interactive,
      skipped: true,
      reason: "filtered",
    });
    return;
  }
  const baseRoadOpacity = clamp(Number(roadConfig.opacity ?? 0.72), 0, 1);
  drawTransportOverviewLineSet(featuresByClass.secondary, {
    casingStroke: visualStyle.secondaryCasingStroke,
    innerStroke: visualStyle.secondaryStroke,
    casingWidth: visualStyle.secondaryCasingWidth,
    innerWidth: visualStyle.secondaryWidth,
    opacity: visualStyle.secondaryOpacity,
    dashPx: visualStyle.secondaryDashPx,
  }, { baseOpacity: baseRoadOpacity, strategy, k, widthFloorPx: 0.68 });
  drawTransportOverviewLineSet(featuresByClass.primary, {
    casingStroke: visualStyle.primaryCasingStroke,
    innerStroke: visualStyle.primaryStroke,
    casingWidth: visualStyle.primaryCasingWidth,
    innerWidth: visualStyle.primaryWidth,
    opacity: visualStyle.primaryOpacity,
    dashPx: visualStyle.primaryDashPx,
  }, { baseOpacity: baseRoadOpacity, strategy, k, widthFloorPx: 0.78 });
  drawTransportOverviewLineSet(featuresByClass.trunk, {
    casingStroke: visualStyle.trunkCasingStroke,
    innerStroke: visualStyle.trunkStroke,
    casingWidth: visualStyle.trunkCasingWidth,
    innerWidth: visualStyle.trunkWidth,
    opacity: visualStyle.trunkOpacity,
    dashPx: visualStyle.trunkDashPx,
  }, { baseOpacity: baseRoadOpacity, strategy, k, widthFloorPx: 0.95 });
  drawTransportOverviewLineSet(featuresByClass.motorway, {
    casingStroke: visualStyle.motorwayCasingStroke,
    innerStroke: visualStyle.motorwayStroke,
    casingWidth: visualStyle.motorwayCasingWidth,
    innerWidth: visualStyle.motorwayWidth,
    opacity: visualStyle.motorwayOpacity,
  }, { baseOpacity: baseRoadOpacity, strategy, k, widthFloorPx: 1.1 });

  const labelsEnabled = !!roadConfig.labelsEnabled && strategy.labelsEnabled && typeof projection === "function";
  if (labelsEnabled && Array.isArray(labelCollection?.features) && labelCollection.features.length) {
    const labelCandidates = labelCollection.features
      .map((feature) => {
        const properties = feature?.properties || {};
        const coordinates = feature?.geometry?.coordinates;
        const label = getTransportOverviewRoadLabelText(properties, roadConfig.labelMode);
        if (!label || !Array.isArray(coordinates) || coordinates.length < 2) return null;
        const anchorProjected = projection(coordinates);
        if (!Array.isArray(anchorProjected) || anchorProjected.length < 2 || !Number.isFinite(anchorProjected[0]) || !Number.isFinite(anchorProjected[1])) return null;
        const { roadClass, priority } = resolveTransportRoadLabelClassAndPriority(properties);
        return {
          label,
          roadClass,
          priority,
          x: anchorProjected[0],
          y: anchorProjected[1],
        };
      })
      .filter(Boolean);
    queueTransportLineLabels("drawCountryRoadsLayer", labelCandidates, {
      familyId: "road",
      labelColor: visualStyle.motorwayStroke,
      secondaryLabelColor: visualStyle.trunkStroke,
    });
  }
  collectContextMetric("drawCountryRoadsLayer", nowMs() - startedAt, {
    featureCount,
    visibleFeatureCount,
    labelCount: 0,
    labelsDeferred: true,
    interactive: !!interactive,
    skipped: false,
  });
}


  return {
    resetLabelCandidates,
    drawPendingLabels,
    drawAirportsLayer,
    drawPortsLayer,
    drawRailwaysLayer,
    drawRoadsLayer,
    getTransportOverviewStyleConfig,
  };
}
