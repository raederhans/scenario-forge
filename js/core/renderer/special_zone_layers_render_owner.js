import {
  buildSpecialZoneRenderFeatures,
  normalizeSpecialZoneLayersState,
  getSpecialZonePatternDefinition,
} from "../special_zone_layers.js";

// Merged outlines are topology-heavy; keep a small bounded LRU cache per render owner.
const OUTLINE_MERGE_CACHE_LIMIT = 96;

function sanitizePatternToken(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "zone";
}

function getGeometryFeatureId(geometry) {
  return String(
    geometry?.properties?.id
    || geometry?.id
    || geometry?.properties?.NUTS_ID
    || ""
  ).trim();
}

function getFeatureLayerId(feature) {
  return String(feature?.properties?.__specialZoneLayerId || "").trim();
}

function getLayerStyleRevision(layer) {
  return Math.max(1, Math.round(Number(layer?.style?.revision) || 1));
}

function getLayerOutlineStyleCacheSignature(layer) {
  const style = layer?.style || {};
  return [
    getLayerStyleRevision(layer),
    String(style.stroke || ""),
    String(style.strokeOpacity ?? ""),
    String(style.strokeWidth ?? ""),
    String(style.pattern || ""),
  ].join("|");
}

function getPatternTransform(transform = {}) {
  const k = Math.max(0.0001, Number(transform?.k || 1));
  const x = Number(transform?.x || 0);
  const y = Number(transform?.y || 0);
  return `translate(${-x / k},${-y / k}) scale(${1 / k})`;
}

export function createSpecialZoneLayersRenderOwner({
  state,
  helpers = {},
  groupGetters = {},
} = {}) {
  const runtimeState = state;
  const {
    clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value))),
    getDashPattern = () => [],
    getFeatureId = (feature) => String(feature?.properties?.id || feature?.id || "").trim(),
    getPathSVG = () => null,
    getSelectionBoundary = () => null,
    getSafeCanvasColor = (value, fallback) => value || fallback,
  } = helpers;

  const outlineCache = new Map();

  function getSpecialZonesGroup() {
    return groupGetters.getSpecialZonesGroup?.() || null;
  }

  function getStrategicDefs() {
    return groupGetters.getStrategicDefs?.() || null;
  }

  function getEffectiveSpecialZonesFeatureCollection() {
    return buildSpecialZoneRenderFeatures(runtimeState.specialZoneLayers, runtimeState.landIndex);
  }

  function getSpecialZoneStyle(feature) {
    const layerStyle = feature?.properties?.__specialZoneLayerStyle;
    if (layerStyle && typeof layerStyle === "object") {
      return {
        fill: getSafeCanvasColor(layerStyle.fill, "#8b5cf6"),
        stroke: getSafeCanvasColor(layerStyle.stroke, "#6d28d9"),
        fillOpacity: clamp(layerStyle.fillOpacity !== null && layerStyle.fillOpacity !== "" && Number.isFinite(Number(layerStyle.fillOpacity)) ? Number(layerStyle.fillOpacity) : 0.32, 0, 1),
        strokeOpacity: clamp(Number(layerStyle.strokeOpacity) || 0.92, 0, 1),
        strokeWidth: clamp(Number(layerStyle.strokeWidth) || 1.3, 0.4, 8),
        dash: getDashPattern(layerStyle.pattern === "outlineOnly" ? "solid" : "dashed", Number(layerStyle.strokeWidth) || 1.3),
        pattern: String(layerStyle.pattern || "solid"),
        patternOpacity: clamp(Number(layerStyle.patternOpacity) || 0.42, 0, 1),
        revision: getLayerStyleRevision({ style: layerStyle }),
      };
    }
    const config = runtimeState.styleConfig?.specialZones || {};
    const type = String(feature?.properties?.type || "").toLowerCase();
    const fillOpacity = clamp(Number.isFinite(Number(config.opacity)) ? Number(config.opacity) : 0.32, 0, 1);
    const strokeWidth = clamp(Number.isFinite(Number(config.strokeWidth)) ? Number(config.strokeWidth) : 1.3, 0.4, 4);
    const dash = getDashPattern(String(config.dashStyle || "dashed"), strokeWidth);

    if (type === "disputed") {
      return {
        fill: getSafeCanvasColor(config.disputedFill, "#f97316"),
        stroke: getSafeCanvasColor(config.disputedStroke, "#ea580c"),
        fillOpacity,
        strokeOpacity: 0.92,
        strokeWidth,
        dash,
        pattern: "solid",
        patternOpacity: 0,
        revision: 1,
      };
    }
    if (type === "wasteland") {
      return {
        fill: getSafeCanvasColor(config.wastelandFill, "#dc2626"),
        stroke: getSafeCanvasColor(config.wastelandStroke, "#b91c1c"),
        fillOpacity,
        strokeOpacity: 0.92,
        strokeWidth,
        dash,
        pattern: "solid",
        patternOpacity: 0,
        revision: 1,
      };
    }
    return {
      fill: getSafeCanvasColor(config.customFill, "#8b5cf6"),
      stroke: getSafeCanvasColor(config.customStroke, "#6d28d9"),
      fillOpacity,
      strokeOpacity: 0.92,
      strokeWidth,
      dash,
      pattern: "solid",
      patternOpacity: 0,
      revision: 1,
    };
  }

  function getPatternDefId(feature, style) {
    const layerId = sanitizePatternToken(getFeatureLayerId(feature) || "layer");
    const pattern = sanitizePatternToken(style?.pattern || "solid");
    const stroke = sanitizePatternToken(style?.stroke || "stroke");
    const revision = Math.max(1, Math.round(Number(style?.revision) || 1));
    return `special-zone-pattern-${layerId}-${pattern}-${stroke}-${revision}`;
  }

  function renderPatternDefs(features) {
    const strategicDefs = getStrategicDefs();
    if (!strategicDefs) return;
    const defsById = new Map();
    features.forEach((feature) => {
      const style = getSpecialZoneStyle(feature);
      const pattern = String(style.pattern || "solid");
      if (pattern === "solid" || pattern === "outlineOnly") return;
      const id = getPatternDefId(feature, style);
      if (!defsById.has(id)) {
        defsById.set(id, {
          id,
          pattern,
          stroke: style.stroke,
          strokeWidth: Math.max(0.8, Number(style.strokeWidth) || 1.2),
        });
      }
    });

    const selection = strategicDefs
      .selectAll("pattern.special-zone-pattern-def")
      .data(Array.from(defsById.values()), (d) => d.id);

    const enter = selection
      .enter()
      .append("pattern")
      .attr("class", "special-zone-pattern-def")
      .attr("patternUnits", "userSpaceOnUse")
      .attr("width", 14)
      .attr("height", 14);

    const merged = enter.merge(selection)
      .attr("id", (d) => d.id)
      .attr("width", (d) => (getSpecialZonePatternDefinition(d.pattern)?.size || (d.pattern === "denseDots" ? 8 : 14)))
      .attr("height", (d) => (getSpecialZonePatternDefinition(d.pattern)?.size || (d.pattern === "denseDots" ? 8 : 14)))
      .attr("patternTransform", (d) => `${getPatternTransform(runtimeState.zoomTransform)} rotate(${getSpecialZonePatternDefinition(d.pattern)?.rotation || 0})`);

    merged.each(function renderPatternDefinition(d) {
      const patternSelection = globalThis.d3.select(this);
      patternSelection.selectAll("*").remove();
      const stroke = d.stroke;
      const width = d.strokeWidth;
      const definition = getSpecialZonePatternDefinition(d.pattern);
      if (definition) {
        definition.marks.forEach(([tag, attributes]) => {
          const mark = patternSelection.append(tag);
          Object.entries(attributes).forEach(([key, value]) => mark.attr(key, value));
          mark.attr("fill", tag === "path" ? "none" : stroke);
          if (tag === "path") mark.attr("stroke", stroke);
        });
      } else if (d.pattern === "diagonalHatch") {
        patternSelection.append("path").attr("d", "M -4 14 L 14 -4 M 0 18 L 18 0").attr("stroke", stroke).attr("stroke-width", width).attr("fill", "none");
      } else if (d.pattern === "crossHatch") {
        patternSelection.append("path").attr("d", "M -4 14 L 14 -4 M 0 18 L 18 0 M 0 -4 L 18 14 M -4 0 L 14 18").attr("stroke", stroke).attr("stroke-width", width * 0.75).attr("fill", "none");
      } else if (d.pattern === "horizontalLines") {
        patternSelection.append("path").attr("d", "M 0 4 H 14 M 0 10 H 14").attr("stroke", stroke).attr("stroke-width", width).attr("fill", "none");
      } else if (d.pattern === "wavyLines") {
        patternSelection.append("path").attr("d", "M 0 5 C 3 2, 5 8, 8 5 S 12 2, 14 5 M 0 11 C 3 8, 5 14, 8 11 S 12 8, 14 11").attr("stroke", stroke).attr("stroke-width", width * 0.75).attr("fill", "none");
      } else if (d.pattern === "dots" || d.pattern === "denseDots") {
        const radius = d.pattern === "denseDots" ? 1.1 : 1.35;
        patternSelection.append("circle").attr("cx", d.pattern === "denseDots" ? 2 : 4).attr("cy", d.pattern === "denseDots" ? 2 : 4).attr("r", radius).attr("fill", stroke);
        patternSelection.append("circle").attr("cx", d.pattern === "denseDots" ? 6 : 10).attr("cy", d.pattern === "denseDots" ? 6 : 10).attr("r", radius).attr("fill", stroke);
      } else if (d.pattern === "concentric") {
        patternSelection.append("circle").attr("cx", 7).attr("cy", 7).attr("r", 2.2).attr("stroke", stroke).attr("stroke-width", width * 0.7).attr("fill", "none");
        patternSelection.append("circle").attr("cx", 7).attr("cy", 7).attr("r", 5.4).attr("stroke", stroke).attr("stroke-width", width * 0.55).attr("fill", "none");
      } else if (d.pattern === "chevrons") {
        patternSelection.append("path").attr("d", "M 1 9 L 7 4 L 13 9 M 1 14 L 7 9 L 13 14").attr("stroke", stroke).attr("stroke-width", width).attr("fill", "none").attr("stroke-linejoin", "round");
      }
    });

    selection.exit().remove();
  }

  function getActiveTopology() {
    if (runtimeState.runtimePoliticalTopology?.objects?.political) return runtimeState.runtimePoliticalTopology;
    if (runtimeState.topologyPrimary?.objects?.political) return runtimeState.topologyPrimary;
    if (runtimeState.topology?.objects?.political) return runtimeState.topology;
    return null;
  }

  function buildGeometryIndex(topology) {
    const geometries = topology?.objects?.political?.geometries || [];
    const byId = new Map();
    geometries.forEach((geometry) => {
      const id = getGeometryFeatureId(geometry);
      if (id) byId.set(id, geometry);
    });
    return byId;
  }

  function getLayerOutlineFeature(layer, geometryIndex, topology) {
    const memberIds = Array.isArray(layer?.memberFeatureIds) ? [...layer.memberFeatureIds].sort((a, b) => a.localeCompare(b)) : [];
    const boundary = getSelectionBoundary(new Set(memberIds));
    if (boundary) return boundary;
    if (!memberIds.length || !topology || !globalThis.topojson?.merge) return null;
    const styleSignature = getLayerOutlineStyleCacheSignature(layer);
    const cacheKey = [
      String(runtimeState.specialZoneLayers?.topologyFingerprint || ""),
      String(runtimeState.activeScenarioId || ""),
      layer.id,
      styleSignature,
      memberIds.join("|"),
    ].join("::");
    const cached = outlineCache.get(cacheKey);
    if (cached && cached.topologyRef === topology) return cached.feature;
    const geoms = memberIds
      .map((id) => geometryIndex.get(id))
      .filter(Boolean);
    if (geoms.length !== memberIds.length) return null;
    try {
      const mergedShape = globalThis.topojson.merge(topology, geoms);
      const feature = {
        type: "Feature",
        properties: {
          id: `special-zone-outline-${layer.id}`,
          __specialZoneLayerId: layer.id,
          __specialZoneLayerStyle: layer.style,
        },
        geometry: mergedShape,
      };
      outlineCache.set(cacheKey, { topologyRef: topology, feature });
      if (outlineCache.size > OUTLINE_MERGE_CACHE_LIMIT) {
        outlineCache.delete(outlineCache.keys().next().value);
      }
      return feature;
    } catch (_error) {
      return null;
    }
  }

  function updateSpecialZonesPaths() {
    const group = getSpecialZonesGroup();
    const pathSVG = getPathSVG();
    if (!group || !pathSVG) return;
    const normalized = normalizeSpecialZoneLayersState(runtimeState.specialZoneLayers);
    const features = getEffectiveSpecialZonesFeatureCollection().features;
    renderPatternDefs(features);
    const topology = getActiveTopology();
    const geometryIndex = buildGeometryIndex(topology);
    const entries = normalized.layers.filter((layer) => layer.visible).map((layer) => {
      const collection = {
        type: "FeatureCollection",
        features: features.filter((feature) => getFeatureLayerId(feature) === layer.id),
        properties: { __specialZoneLayerId: layer.id, __specialZoneLayerStyle: layer.style },
      };
      const outline = getLayerOutlineFeature(layer, geometryIndex, topology);
      return { layer, collection, outline: outline || collection, fallback: !outline };
    });
    group.selectAll("path.special-zone, path.special-zone-pattern, path.special-zone-outline").remove();
    entries.forEach(({ layer, collection, outline, fallback }) => {
      const style = layer.style;
      group.append("path")
        .attr("class", "special-zone")
        .attr("d", pathSVG(collection))
        .attr("fill", style.fill)
        .attr("fill-opacity", style.pattern === "outlineOnly" ? 0 : style.fillOpacity)
        .attr("stroke", "none");
      group.append("path")
        .attr("class", "special-zone-pattern")
        .attr("d", pathSVG(collection))
        .attr("fill", ["solid", "outlineOnly"].includes(style.pattern) ? "none" : `url(#${getPatternDefId(collection, style)})`)
        .attr("fill-opacity", style.patternOpacity)
        .attr("stroke", "none")
        .attr("pointer-events", "none");
      group.append("path")
        .attr("class", "special-zone-outline")
        .attr("d", pathSVG(outline))
        .attr("fill", "none")
        .attr("stroke", style.stroke)
        .attr("stroke-opacity", style.strokeOpacity)
        .attr("stroke-width", (fallback ? 0.6 : style.strokeWidth) + (layer.id === normalized.activeLayerId ? 0.6 : 0))
        .attr("stroke-dasharray", layer.category === "claim" ? "6 4" : null)
        .attr("vector-effect", "non-scaling-stroke")
        .attr("pointer-events", "none");
    });
  }

  function syncPatternTransformDuringZoom() {
    const strategicDefs = getStrategicDefs();
    if (!strategicDefs) return;
    strategicDefs
      .selectAll("pattern.special-zone-pattern-def")
      .attr("patternTransform", (d) => `${getPatternTransform(runtimeState.zoomTransform)} rotate(${getSpecialZonePatternDefinition(d.pattern)?.rotation || 0})`);
  }

  return {
    getEffectiveSpecialZonesFeatureCollection,
    syncPatternTransformDuringZoom,
    updateSpecialZonesPaths,
  };
}
