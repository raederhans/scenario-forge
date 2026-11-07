// Pure layer-based special zone model and transformations.
// The layer store is the canonical special-zone runtime shape; legacy freehand data is reported as diagnostics on import.

const SPECIAL_ZONE_LAYER_VERSION = 1;
const SPECIAL_ZONE_SOURCES = new Set(["project", "scenario"]);
const SPECIAL_ZONE_MEMBERSHIP_BRUSH_MODES = new Set(["add", "remove"]);
const SPECIAL_ZONE_STORY_MAX_STEPS = 24;
const SPECIAL_ZONE_LAYER_DIAGNOSTIC_CODES = Object.freeze({
  LOAD_FAILED: "special_zone_layers_load_failed",
});
const SPECIAL_ZONE_PATTERN_IDS = Object.freeze([
  "fineHatch",
  "dashHatch",
  "bandStripes",
  "dotGrid",
  "fineHorizontal",
  "openGrid",
  "solid",
  "diagonalHatch",
  "crossHatch",
  "horizontalLines",
  "wavyLines",
  "dots",
  "denseDots",
  "concentric",
  "chevrons",
  "outlineOnly",
]);

const SPECIAL_ZONE_PRESETS = Object.freeze([
  ["demilitarized", "Demilitarized / buffer", "#f6e05e", "#b7791f", 0.08, "fineHatch"],
  ["claim", "Claim / dispute", "#fb923c", "#c2410c", 0.06, "dashHatch"],
  ["occupation", "Occupation / military administration", "#475569", "#475569", 0, "bandStripes", 0.5],
  ["lease", "Lease / condominium / treaty port", "#5eead4", "#0f766e", 0.06, "dotGrid"],
  ["economic", "Economic development", "#a3e635", "#4d7c0f", 0.06, "fineHorizontal"],
  ["restricted", "Restricted access / environmental risk", "#a8a29e", "#57534e", 0.1, "openGrid"],
  ["custom", "Custom Zone", "#8b5cf6", "#6d28d9", 0.12, "solid"],
].map(([id, name, fill, stroke, fillOpacity, pattern, patternOpacity = 0.42]) => Object.freeze({
  id,
  name,
  category: id,
  style: Object.freeze(createSpecialZoneLayerStyle({ fill, stroke, fillOpacity, pattern, patternOpacity })),
})));

const LEGACY_PRESET_IDS = Object.freeze({
  buffer: "demilitarized", neutral: "demilitarized", frontier: "demilitarized",
  disputed: "claim", occupied: "occupation", military: "occupation",
  protectorate: "lease", administrative: "lease",
  special_economic: "economic", industrial: "economic", resource: "economic",
  exclusion: "restricted", wasteland: "restricted",
  autonomous: "custom", cultural: "custom", maritime: "custom",
});

const SPECIAL_ZONE_PRESET_BY_ID = new Map(SPECIAL_ZONE_PRESETS.map((preset) => [preset.id, preset]));

function clampNumber(value, fallback, min, max) {
  const numeric = Number(value);
  const finite = Number.isFinite(numeric) ? numeric : fallback;
  return Math.min(max, Math.max(min, finite));
}

function normalizeHexColor(value, fallback) {
  const candidate = String(value || "").trim();
  if (/^#(?:[0-9a-f]{6})$/i.test(candidate)) return candidate.toLowerCase();
  if (/^#(?:[0-9a-f]{3})$/i.test(candidate)) {
    return `#${candidate[1]}${candidate[1]}${candidate[2]}${candidate[2]}${candidate[3]}${candidate[3]}`.toLowerCase();
  }
  return fallback;
}

function normalizePatternId(value, fallback = "solid") {
  const candidate = String(value || "").trim();
  return SPECIAL_ZONE_PATTERN_IDS.includes(candidate) ? candidate : fallback;
}

function createSpecialZoneLayerStyle(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    fill: normalizeHexColor(source.fill || source.fillColor, "#8b5cf6"),
    stroke: normalizeHexColor(source.stroke || source.strokeColor, "#6d28d9"),
    fillOpacity: clampNumber(source.fillOpacity ?? source.opacity, 0.32, 0, 1),
    strokeOpacity: clampNumber(source.strokeOpacity, 0.92, 0, 1),
    strokeWidth: clampNumber(source.strokeWidth, 1.3, 0.4, 8),
    pattern: normalizePatternId(source.pattern, "solid"),
    patternOpacity: clampNumber(source.patternOpacity, 0.42, 0, 1),
    revision: Math.max(1, Math.round(Number(source.revision) || 1)),
  };
}

function createEmptySpecialZoneLayersState({ topologyFingerprint = "" } = {}) {
  return {
    version: SPECIAL_ZONE_LAYER_VERSION,
    layers: [],
    activeLayerId: "",
    storySteps: [],
    activeStoryStepId: "",
    topologyFingerprint: String(topologyFingerprint || "").trim(),
    diagnostics: [],
  };
}

function resolveSpecialZoneTopologyFingerprint(runtimeState = {}) {
  const baselineHash = String(runtimeState?.scenarioBaselineHash || "").trim();
  if (baselineHash) return baselineHash;
  return String(runtimeState?.activeScenarioManifest?.source?.runtime_topology_sha256 || "").trim();
}

function normalizeMemberFeatureIds(rawIds, diagnostics, validFeatureIds = null) {
  const seen = new Set();
  const ids = Array.isArray(rawIds) ? rawIds : [];
  ids.forEach((value) => {
    const id = String(value || "").trim();
    if (!id) return;
    if (validFeatureIds && !validFeatureIds.has(id)) {
      diagnostics.push({ code: "invalid_feature_id", featureId: id });
      return;
    }
    seen.add(id);
  });
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}

function dedupeSpecialZoneDiagnostics(entries) {
  const seen = new Set();
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && typeof entry === "object")
    .filter((entry) => {
      const key = JSON.stringify(entry);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeSpecialZoneLayer(rawLayer, index, diagnostics, options = {}) {
  const raw = rawLayer && typeof rawLayer === "object" ? rawLayer : {};
  const rawPresetId = String(raw.presetId || raw.preset || "custom").trim() || "custom";
  const presetId = LEGACY_PRESET_IDS[rawPresetId] || rawPresetId;
  const preset = SPECIAL_ZONE_PRESET_BY_ID.get(presetId) || SPECIAL_ZONE_PRESET_BY_ID.get("custom");
  const id = String(raw.id || `special-zone-layer-${index + 1}`).trim();
  if (!id) return null;
  const source = String(raw.source || options.defaultSource || "project").trim();
  const normalizedSource = SPECIAL_ZONE_SOURCES.has(source) ? source : "project";
  const members = normalizeMemberFeatureIds(raw.memberFeatureIds, diagnostics, options.validFeatureIds || null);
  return {
    id,
    name: String(raw.name || preset.name || id).trim() || id,
    // 剧本预设区域可带中文名；用户改名后以 name 为准（改名时清掉 nameZh）。
    ...(typeof raw.nameZh === "string" && raw.nameZh.trim() ? { nameZh: raw.nameZh.trim() } : {}),
    presetId: SPECIAL_ZONE_PRESET_BY_ID.has(presetId) ? presetId : "custom",
    category: preset.category,
    source: normalizedSource,
    visible: raw.visible === undefined ? true : !!raw.visible,
    legendVisible: raw.legendVisible === undefined ? true : !!raw.legendVisible,
    style: createSpecialZoneLayerStyle({ ...(preset.style || {}), ...(raw.style || {}) }),
    memberFeatureIds: members,
  };
}

function normalizeSpecialZoneStoryStep(rawStep, index, validLayerIds = new Set()) {
  const raw = rawStep && typeof rawStep === "object" ? rawStep : {};
  const id = String(raw.id || `special-zone-story-step-${index + 1}`).trim();
  if (!id) return null;
  const layerIds = Array.from(new Set(
    (Array.isArray(raw.layerIds) ? raw.layerIds : [])
      .map((value) => String(value || "").trim())
      .filter((value) => value && (!validLayerIds.size || validLayerIds.has(value)))
  ));
  return {
    id,
    title: String(raw.title || `Step ${index + 1}`).trim() || `Step ${index + 1}`,
    description: String(raw.description || "").trim(),
    layerIds,
    focusFeatureId: String(raw.focusFeatureId || "").trim(),
    showLegend: raw.showLegend === undefined ? true : !!raw.showLegend,
  };
}

function normalizeSpecialZoneStoryState(rawState, layers = []) {
  const raw = rawState && typeof rawState === "object" ? rawState : {};
  const validLayerIds = new Set(layers.map((layer) => layer.id));
  const seen = new Set();
  const storySteps = (Array.isArray(raw.storySteps) ? raw.storySteps : [])
    .slice(0, SPECIAL_ZONE_STORY_MAX_STEPS)
    .map((step, index) => normalizeSpecialZoneStoryStep(step, index, validLayerIds))
    .filter(Boolean)
    .filter((step) => {
      if (seen.has(step.id)) return false;
      seen.add(step.id);
      return true;
    });
  const activeStoryStepId = storySteps.some((step) => step.id === raw.activeStoryStepId)
    ? String(raw.activeStoryStepId)
    : (storySteps[0]?.id || "");
  return { storySteps, activeStoryStepId };
}

function normalizeSpecialZoneLayersState(rawState, options = {}) {
  const diagnostics = [];
  const raw = rawState && typeof rawState === "object" ? rawState : {};
  const validFeatureIds = options.validFeatureIds instanceof Set ? options.validFeatureIds : null;
  const expectedFingerprint = String(options.topologyFingerprint || "").trim();
  const stateFingerprint = String(raw.topologyFingerprint || "").trim();
  // normalize 是 layer-based special zones 的单一入口：
  // import、mutation、preview、serialize 前都先走这里，保证 runtime/store/导出看到同一份形状。
  if (expectedFingerprint && stateFingerprint && expectedFingerprint !== stateFingerprint) {
    diagnostics.push({
      code: "topology_fingerprint_mismatch",
      expected: expectedFingerprint,
      actual: stateFingerprint,
    });
  }
  if (raw.manualSpecialZones || raw.specialRegionOverrides || raw.special_regions_url || raw.specialRegionsPayload) {
    diagnostics.push({ code: "legacy_special_zone_fields_dropped" });
  }
  const seenLayerIds = new Set();
  const layers = (Array.isArray(raw.layers) ? raw.layers : [])
    .map((layer, index) => normalizeSpecialZoneLayer(layer, index, diagnostics, {
      defaultSource: options.defaultSource,
      validFeatureIds,
    }))
    .filter(Boolean)
    .filter((layer) => {
      if (seenLayerIds.has(layer.id)) {
        diagnostics.push({ code: "duplicate_layer_id_dropped", layerId: layer.id });
        return false;
      }
      seenLayerIds.add(layer.id);
      return true;
    });
  const activeLayerId = layers.some((layer) => layer.id === raw.activeLayerId)
    ? String(raw.activeLayerId)
    : (layers[0]?.id || "");
  const story = normalizeSpecialZoneStoryState(raw, layers);
  return {
    version: SPECIAL_ZONE_LAYER_VERSION,
    layers,
    activeLayerId,
    storySteps: story.storySteps,
    activeStoryStepId: story.activeStoryStepId,
    topologyFingerprint: expectedFingerprint || stateFingerprint,
    diagnostics: dedupeSpecialZoneDiagnostics([
      ...diagnostics,
      ...(Array.isArray(raw.diagnostics) ? raw.diagnostics : []),
    ]),
  };
}

function serializeSpecialZoneLayersState(rawState, options = {}) {
  const normalized = normalizeSpecialZoneLayersState(rawState, options);
  return {
    version: SPECIAL_ZONE_LAYER_VERSION,
    layers: normalized.layers.map((layer) => ({
      ...layer,
      legendVisible: layer.legendVisible !== false,
      style: { ...layer.style },
      memberFeatureIds: [...layer.memberFeatureIds].sort((a, b) => a.localeCompare(b)),
    })),
    activeLayerId: normalized.activeLayerId,
    storySteps: normalized.storySteps.map((step) => ({
      ...step,
      layerIds: [...step.layerIds],
    })),
    activeStoryStepId: normalized.activeStoryStepId,
    topologyFingerprint: normalized.topologyFingerprint,
    diagnostics: normalized.diagnostics.map((entry) => ({ ...entry })),
  };
}

function captureScenarioLayerSaveRequestState(target, saveRequestId = 0) {
  const scenarioId = String(target?.activeScenarioId || "").trim();
  const scenarioApplyRequestId = Number(
    target?.currentScenarioApplyRequestId || 0,
  );
  return {
    loadContext: {
      scenarioId,
      scenarioApplyRequestId: scenarioApplyRequestId >= 0
        ? scenarioApplyRequestId
        : 0,
      declaresLayerAsset: Boolean(
        String(
          target?.activeScenarioManifest?.special_zone_layers_url || "",
        ).trim(),
      ),
    },
    scenarioId,
    saveRequestId: Math.max(0, Number(saveRequestId || 0)),
    requestedState: serializeSpecialZoneLayersState(target?.specialZoneLayers, {
      defaultSource: scenarioId ? "scenario" : "project",
      topologyFingerprint: String(
        target?.scenarioBaselineHash
        || target?.activeScenarioManifest?.source?.runtime_topology_sha256
        || "",
      ).trim(),
    }),
  };
}

function normalizeSpecialZoneMembershipBrushModeState(value) {
  const mode = String(value || "add").trim();
  return SPECIAL_ZONE_MEMBERSHIP_BRUSH_MODES.has(mode) ? mode : "add";
}

function getSpecialZoneLegendLayers(rawState) {
  return normalizeSpecialZoneLayersState(rawState).layers
    .filter((layer) => layer.visible !== false && layer.legendVisible !== false);
}

function getSpecialZoneLegendSignature(rawState) {
  return getSpecialZoneLegendLayers(rawState)
    .map((layer) => [
      layer.id,
      layer.name,
      layer.legendVisible !== false ? "1" : "0",
      layer.style?.fill || "",
      layer.style?.stroke || "",
      layer.style?.pattern || "",
    ].join(":"))
    .join("|");
}

function parseSpecialZoneMemberImportText(text = "") {
  return Array.from(new Set(
    String(text || "")
      .split(/[\s,;]+/)
      .map((value) => value.trim())
      .filter(Boolean)
  )).sort((a, b) => a.localeCompare(b));
}

function getSpecialZoneLayerMemberSetOperationIds(targetIds = [], sourceIds = [], operation = "union") {
  const target = new Set((Array.isArray(targetIds) ? targetIds : []).map((value) => String(value || "").trim()).filter(Boolean));
  const source = new Set((Array.isArray(sourceIds) ? sourceIds : []).map((value) => String(value || "").trim()).filter(Boolean));
  const op = String(operation || "union").trim();
  if (op === "subtract") {
    source.forEach((id) => target.delete(id));
    return Array.from(target).sort((a, b) => a.localeCompare(b));
  }
  if (op === "intersect") {
    return Array.from(target).filter((id) => source.has(id)).sort((a, b) => a.localeCompare(b));
  }
  source.forEach((id) => target.add(id));
  return Array.from(target).sort((a, b) => a.localeCompare(b));
}

function getSpecialZoneStoryPreviewSteps(rawState) {
  const normalized = normalizeSpecialZoneLayersState(rawState);
  if (normalized.storySteps.length) {
    return normalized.storySteps.map((step, index) => ({
      ...step,
      index,
      layers: step.layerIds
        .map((layerId) => normalized.layers.find((layer) => layer.id === layerId))
        .filter(Boolean),
    }));
  }
  return normalized.layers
    .filter((layer) => layer.visible !== false)
    .slice(0, SPECIAL_ZONE_STORY_MAX_STEPS)
    .map((layer, index) => ({
      id: `auto-${layer.id}`,
      title: layer.name || layer.id,
      description: `${layer.memberFeatureIds.length} members`,
      layerIds: [layer.id],
      focusFeatureId: layer.memberFeatureIds[0] || "",
      showLegend: layer.legendVisible !== false,
      index,
      layers: [layer],
    }));
}

function applySpecialZoneStoryStepToPreviewState(rawState, stepId) {
  const normalized = normalizeSpecialZoneLayersState(rawState);
  const steps = getSpecialZoneStoryPreviewSteps(normalized);
  const step = steps.find((entry) => entry.id === stepId) || steps[0] || null;
  const visibleLayerIds = new Set(step?.layerIds || []);
  return {
    ...normalized,
    activeStoryStepId: step?.id || "",
    layers: normalized.layers.map((layer) => ({
      ...layer,
      visible: visibleLayerIds.size ? visibleLayerIds.has(layer.id) : layer.visible,
    })),
  };
}

function getSpecialZoneLayerDisplayName(layer, language = "en") {
  const zh = String(language || "").toLowerCase().startsWith("zh");
  return (zh && layer?.nameZh) || layer?.name || layer?.id || "";
}

function getSpecialZonePatternDefinition(pattern) {
  const definitions = {
    fineHatch: { size: 8, rotation: 45, marks: [["path", { d: "M0 0V8", "stroke-width": 1 }]] },
    dashHatch: { size: 9, rotation: 45, marks: [["path", { d: "M0 0V9", "stroke-width": 1, "stroke-dasharray": "3 3" }]] },
    bandStripes: { size: 10, rotation: -45, marks: [["rect", { width: 4, height: 10 }]] },
    dotGrid: { size: 14, rotation: 0, marks: [["circle", { cx: 3.5, cy: 3.5, r: 1.1 }], ["circle", { cx: 10.5, cy: 10.5, r: 1.1 }]] },
    fineHorizontal: { size: 6, rotation: 0, marks: [["path", { d: "M0 0H6", "stroke-width": 0.8 }]] },
    openGrid: { size: 12, rotation: 0, marks: [["path", { d: "M0 12V0H12", "stroke-width": 0.8 }]] },
  };
  return definitions[pattern] || null;
}

function createSpecialZonePatternPreviewStyle(style = {}) {
  // 颜色会拼进内联 SVG 字符串：允许 CSS 颜色写法，拒绝引号、尖括号等可能破坏标记的字符。
  const safeColor = (value, fallback) => {
    const candidate = String(value || "").trim();
    return /^[#a-zA-Z0-9(),.%\s-]{1,48}$/.test(candidate) ? candidate : fallback;
  };
  const fill = safeColor(style.fill, "#8b5cf6");
  const stroke = safeColor(style.stroke, "#6d28d9");
  const pattern = normalizePatternId(style.pattern, "solid");
  const opacity = clampNumber(style.fillOpacity, 0.32, 0, 1);
  const patterns = {
    solid: { image: "none", size: "12px 12px" },
    diagonalHatch: { image: `linear-gradient(135deg, transparent 0 42%, ${stroke} 42% 52%, transparent 52% 100%)`, size: "14px 14px" },
    crossHatch: {
      image: [
        `linear-gradient(45deg, transparent 0 42%, ${stroke} 42% 52%, transparent 52% 100%)`,
        `linear-gradient(135deg, transparent 0 42%, ${stroke} 42% 52%, transparent 52% 100%)`,
      ].join(", "),
      size: "14px 14px",
    },
    horizontalLines: { image: `linear-gradient(0deg, transparent 0 42%, ${stroke} 42% 52%, transparent 52% 100%)`, size: "14px 12px" },
    wavyLines: {
      image: [
        `radial-gradient(ellipse at 50% 0%, transparent 0 48%, ${stroke} 49% 55%, transparent 56% 100%)`,
        `radial-gradient(ellipse at 50% 100%, transparent 0 48%, ${stroke} 49% 55%, transparent 56% 100%)`,
      ].join(", "),
      size: "18px 10px",
    },
    dots: { image: `radial-gradient(circle at 50% 50%, ${stroke} 0 2px, transparent 2.5px)`, size: "12px 12px" },
    denseDots: { image: `radial-gradient(circle at 50% 50%, ${stroke} 0 1.6px, transparent 2px)`, size: "7px 7px" },
    concentric: { image: `radial-gradient(circle at 50% 50%, transparent 0 34%, ${stroke} 35% 46%, transparent 47% 100%)`, size: "18px 18px" },
    chevrons: {
      image: [
        `linear-gradient(135deg, transparent 0 42%, ${stroke} 43% 52%, transparent 53% 100%)`,
        `linear-gradient(45deg, transparent 0 42%, ${stroke} 43% 52%, transparent 53% 100%)`,
      ].join(", "),
      size: "18px 18px",
    },
    outlineOnly: { image: "none", size: "12px 12px" },
  };
  const definition = getSpecialZonePatternDefinition(pattern);
  if (definition) {
    const marks = definition.marks.map(([tag, attrs]) => {
      const paint = tag === "path" ? `fill="none" stroke="${stroke}"` : `fill="${stroke}"`;
      return `<${tag} ${paint} ${Object.entries(attrs).map(([key, value]) => `${key}="${value}"`).join(" ")}/>`;
    }).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><defs><pattern id="p" patternUnits="userSpaceOnUse" width="${definition.size}" height="${definition.size}" patternTransform="rotate(${definition.rotation})">${marks}</pattern></defs><rect width="100%" height="100%" fill="${fill}" fill-opacity="${opacity}"/><rect width="100%" height="100%" fill="url(#p)" opacity="${style.patternOpacity ?? 0.42}"/></svg>`;
    return { backgroundColor: "transparent", backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`, backgroundSize: "28px 28px", borderColor: stroke, opacity: "1" };
  }
  const previewPattern = patterns[pattern] || patterns.solid;
  return {
    backgroundColor: fill,
    backgroundImage: previewPattern.image,
    backgroundSize: previewPattern.size,
    borderColor: stroke,
    opacity: String(Math.max(0.24, opacity)),
  };
}

function createLayerFromPreset(presetId = "custom", patch = {}) {
  const preset = SPECIAL_ZONE_PRESET_BY_ID.get(LEGACY_PRESET_IDS[presetId] || String(presetId || "").trim()) || SPECIAL_ZONE_PRESET_BY_ID.get("custom");
  return normalizeSpecialZoneLayer({
    id: patch.id || `special-zone-${preset.id}-${Date.now().toString(36)}`,
    name: patch.name || preset.name,
    presetId: preset.id,
    category: patch.category || preset.category,
    source: patch.source || "project",
    visible: patch.visible,
    legendVisible: patch.legendVisible,
    style: { ...preset.style, ...(patch.style || {}) },
    memberFeatureIds: patch.memberFeatureIds || [],
  }, 0, [], { defaultSource: patch.source || "project" });
}

function updateSpecialZoneLayerMembership(state, layerId, featureIds, mode = "toggle") {
  const normalized = normalizeSpecialZoneLayersState(state);
  const ids = (Array.isArray(featureIds) ? featureIds : [featureIds])
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  // member 改动始终先基于 normalized 副本计算，
  // 这样 add/remove/toggle/replace 四种入口都共用同一套去重和排序合同。
  const layer = normalized.layers.find((entry) => entry.id === layerId) || normalized.layers.find((entry) => entry.id === normalized.activeLayerId);
  if (!layer) return normalized;
  if (mode === "replace") {
    layer.memberFeatureIds = ids.sort((a, b) => a.localeCompare(b));
    return normalized;
  }
  if (!ids.length) return normalized;
  const members = new Set(layer.memberFeatureIds);
  ids.forEach((id) => {
    if (mode === "add") members.add(id);
    else if (mode === "remove") members.delete(id);
    else if (members.has(id)) members.delete(id);
    else members.add(id);
  });
  layer.memberFeatureIds = Array.from(members).sort((a, b) => a.localeCompare(b));
  return normalized;
}

function mutateSpecialZoneLayersState(state, mutation) {
  const normalized = normalizeSpecialZoneLayersState(state);
  const action = String(mutation?.action || "").trim();
  // 所有工作台按钮都应折叠到这个 mutation switch，
  // 未来新增动作时优先加新 action 分支，而不是在外围直接手改 layers 结构。
  if (action === "addLayer") {
    const nextLayer = normalizeSpecialZoneLayer(mutation.layer || createLayerFromPreset(mutation.presetId, mutation), normalized.layers.length, normalized.diagnostics);
    if (nextLayer && !normalized.layers.some((layer) => layer.id === nextLayer.id)) {
      normalized.layers.push(nextLayer);
      normalized.activeLayerId = nextLayer.id;
    }
  } else if (action === "deleteLayer") {
    const id = String(mutation.layerId || normalized.activeLayerId || "").trim();
    normalized.layers = normalized.layers.filter((layer) => layer.id !== id);
    normalized.activeLayerId = normalized.layers.some((layer) => layer.id === normalized.activeLayerId)
      ? normalized.activeLayerId
      : (normalized.layers[0]?.id || "");
  } else if (action === "setActiveLayer") {
    const id = String(mutation.layerId || "").trim();
    if (normalized.layers.some((layer) => layer.id === id)) {
      normalized.activeLayerId = id;
    }
  } else if (action === "updateLayer") {
    const id = String(mutation.layerId || normalized.activeLayerId || "").trim();
    normalized.layers = normalized.layers.map((layer) => layer.id === id
      ? normalizeSpecialZoneLayer({ ...layer, ...(mutation.patch || {}), style: { ...layer.style, ...(mutation.patch?.style || {}) } }, 0, normalized.diagnostics)
      : layer);
  } else if (action === "duplicateLayer") {
    const id = String(mutation.layerId || normalized.activeLayerId || "").trim();
    const source = normalized.layers.find((layer) => layer.id === id);
    if (source) {
      const copy = normalizeSpecialZoneLayer({
        ...source,
        id: mutation.newLayerId || `${source.id}-copy`,
        name: mutation.name || `${source.name} Copy`,
      }, normalized.layers.length, normalized.diagnostics);
      if (copy && !normalized.layers.some((layer) => layer.id === copy.id)) {
        normalized.layers.push(copy);
        normalized.activeLayerId = copy.id;
      }
    }
  } else if (action === "reorderLayers") {
    const order = Array.isArray(mutation.layerIds) ? mutation.layerIds.map((id) => String(id || "").trim()).filter(Boolean) : [];
    const byId = new Map(normalized.layers.map((layer) => [layer.id, layer]));
    normalized.layers = [...order.filter((id) => byId.has(id)).map((id) => byId.get(id)), ...normalized.layers.filter((layer) => !order.includes(layer.id))];
  } else if (["addMembers", "removeMembers", "toggleMembers", "replaceMembers"].includes(action)) {
    const mode = action === "addMembers" ? "add" : action === "removeMembers" ? "remove" : action === "replaceMembers" ? "replace" : "toggle";
    return updateSpecialZoneLayerMembership(normalized, mutation.layerId, mutation.featureIds, mode);
  } else if (action === "applyMemberSetOperation") {
    const id = String(mutation.layerId || normalized.activeLayerId || "").trim();
    const sourceId = String(mutation.sourceLayerId || "").trim();
    const target = normalized.layers.find((layer) => layer.id === id);
    const source = normalized.layers.find((layer) => layer.id === sourceId);
    if (target && source) {
      return updateSpecialZoneLayerMembership(normalized, id, getSpecialZoneLayerMemberSetOperationIds(
        target.memberFeatureIds,
        source.memberFeatureIds,
        mutation.operation
      ), "replace");
    }
  } else if (action === "setStorySteps") {
    const story = normalizeSpecialZoneStoryState({
      storySteps: mutation.storySteps,
      activeStoryStepId: mutation.activeStoryStepId,
    }, normalized.layers);
    normalized.storySteps = story.storySteps;
    normalized.activeStoryStepId = story.activeStoryStepId;
  } else if (action === "setActiveStoryStep") {
    const id = String(mutation.storyStepId || "").trim();
    if (normalized.storySteps.some((step) => step.id === id)) {
      normalized.activeStoryStepId = id;
    }
  }
  return normalizeSpecialZoneLayersState(normalized);
}

function buildSpecialZoneRenderFeatures(layerState, featureById) {
  const normalized = normalizeSpecialZoneLayersState(layerState);
  const resolveFeature = typeof featureById === "function"
    ? featureById
    : (id) => featureById?.get?.(id) || null;
  // 渲染层只消费扁平 FeatureCollection，
  // layer 元数据在这里投影进 feature.properties，避免 renderer 反向理解 workbench store。
  const features = [];
  normalized.layers.forEach((layer, layerIndex) => {
    if (!layer.visible) return;
    layer.memberFeatureIds.forEach((featureId) => {
      const feature = resolveFeature(featureId);
      if (!feature?.geometry) return;
      features.push({
        ...feature,
        properties: {
          ...(feature.properties || {}),
          id: `${layer.id}:${featureId}`,
          sourceFeatureId: featureId,
          __source: "special_zone_layer",
          __specialZoneLayerId: layer.id,
          __specialZoneLayerIndex: layerIndex,
          __specialZoneLayerStyle: layer.style,
          type: layer.presetId,
        },
      });
    });
  });
  return { type: "FeatureCollection", features };
}

export {
  SPECIAL_ZONE_LAYER_VERSION,
  SPECIAL_ZONE_LAYER_DIAGNOSTIC_CODES,
  SPECIAL_ZONE_PATTERN_IDS,
  SPECIAL_ZONE_PRESETS,
  buildSpecialZoneRenderFeatures,
  captureScenarioLayerSaveRequestState,
  createSpecialZonePatternPreviewStyle,
  getSpecialZonePatternDefinition,
  getSpecialZoneLayerDisplayName,
  createEmptySpecialZoneLayersState,
  createLayerFromPreset,
  createSpecialZoneLayerStyle,
  applySpecialZoneStoryStepToPreviewState,
  getSpecialZoneLayerMemberSetOperationIds,
  getSpecialZoneLegendLayers,
  getSpecialZoneLegendSignature,
  getSpecialZoneStoryPreviewSteps,
  mutateSpecialZoneLayersState,
  normalizeSpecialZoneLayersState,
  normalizeSpecialZoneMembershipBrushModeState,
  normalizeSpecialZoneStoryState,
  parseSpecialZoneMemberImportText,
  resolveSpecialZoneTopologyFingerprint,
  serializeSpecialZoneLayersState,
  updateSpecialZoneLayerMembership,
};
