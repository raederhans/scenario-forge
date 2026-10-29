import {
  getTransportOverviewVisibilityField,
  listTransportOverviewCapabilityFamilyIds,
} from "../transport_capability_registry.js";
import {
  INTENSITY_FIELD_CHANNEL_IDS,
} from "../intensity_field.js";
import {
  normalizeIntensityFieldsState,
  serializeIntensityFieldsState,
} from "./intensity_field_state.js";
import {
  createDefaultStyleConfig,
  normalizeOpenOceanLayerVisibility,
  restoreImportedStyleConfigState,
} from "./ui_state.js";

export const APPEARANCE_PRESET_SCHEMA_VERSION = 1;
export const APPEARANCE_PRESET_EXPORT_KIND = "appearance-preset";

const DEFAULT_TIMESTAMP = "1970-01-01T00:00:00.000Z";
const BASE_LAYER_VISIBILITY_FIELDS = Object.freeze([
  "showWaterRegions",
  "showOpenOceanRegions",
  "allowOpenOceanSelect",
  "allowOpenOceanPaint",
  "showScenarioSpecialRegions",
  "showScenarioAtlantropa",
  "showScenarioReliefOverlays",
  "showCityPoints",
  "showStrategicResourceMarkers",
  "strategicChoroplethMetric",
  "showUrban",
  "showPhysical",
  "showRivers",
  "showTransport",
  "showSpecialZones",
]);

function getTransportOverviewLayerVisibilityFields() {
  return listTransportOverviewCapabilityFamilyIds()
    .map((familyId) => getTransportOverviewVisibilityField(familyId))
    .filter(Boolean);
}

export function getAppearancePresetLayerVisibilityFields() {
  return [
    ...BASE_LAYER_VISIBILITY_FIELDS,
    ...getTransportOverviewLayerVisibilityFields(),
  ];
}

export const APPEARANCE_PRESET_LAYER_VISIBILITY_FIELDS = Object.freeze(
  getAppearancePresetLayerVisibilityFields(),
);

function cloneAppearanceValue(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function normalizePresetId(value) {
  return String(value || "").trim();
}

function normalizeChannelRevision(channel) {
  return Math.max(0, Math.round(Number(channel?.revision) || 0));
}

function areGridValuesEqual(leftValues, rightValues) {
  if (leftValues === rightValues) return true;
  if (!leftValues || !rightValues || leftValues.length !== rightValues.length) return false;
  for (let index = 0; index < leftValues.length; index += 1) {
    if (leftValues[index] !== rightValues[index]) return false;
  }
  return true;
}

function areIntensityPointsEqual(leftPoints = [], rightPoints = []) {
  const left = Array.isArray(leftPoints) ? leftPoints : [];
  const right = Array.isArray(rightPoints) ? rightPoints : [];
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftPoint = left[index] || {};
    const rightPoint = right[index] || {};
    if (
      String(leftPoint.id || "") !== String(rightPoint.id || "")
      || Number(leftPoint.lon) !== Number(rightPoint.lon)
      || Number(leftPoint.lat) !== Number(rightPoint.lat)
      || Number(leftPoint.strength) !== Number(rightPoint.strength)
      || Number(leftPoint.radiusDeg) !== Number(rightPoint.radiusDeg)
      || String(leftPoint.falloff || "") !== String(rightPoint.falloff || "")
    ) {
      return false;
    }
  }
  return true;
}

function areIntensityChannelsEqual(leftChannel, rightChannel) {
  return (
    !!leftChannel?.enabled === !!rightChannel?.enabled
    && areIntensityPointsEqual(leftChannel?.points, rightChannel?.points)
    && areGridValuesEqual(leftChannel?.grid?.base, rightChannel?.grid?.base)
  );
}

export function buildRestoredAppearancePresetIntensityFields(currentFields, snapshotFields) {
  const current = normalizeIntensityFieldsState(currentFields);
  const next = normalizeIntensityFieldsState(snapshotFields);
  INTENSITY_FIELD_CHANNEL_IDS.forEach((channelId) => {
    const currentChannel = current.channels?.[channelId];
    const nextChannel = next.channels?.[channelId];
    if (!currentChannel || !nextChannel) return;
    const currentRevision = normalizeChannelRevision(currentChannel);
    const nextRevision = normalizeChannelRevision(nextChannel);
    if (!areIntensityChannelsEqual(currentChannel, nextChannel)) {
      nextChannel.revision = nextRevision <= currentRevision ? currentRevision + 1 : nextRevision;
    } else {
      nextChannel.revision = Math.max(currentRevision, nextRevision);
    }
  });
  return next;
}

function formatTimestamp(value, fallback = DEFAULT_TIMESTAMP) {
  const date = value ? new Date(value) : new Date(fallback);
  if (Number.isFinite(date.getTime())) return date.toISOString();
  return fallback;
}

export function createAppearancePresetId(name = "appearance preset", now = Date.now()) {
  const slug = String(name || "appearance preset")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "appearance-preset";
  const suffixNumber = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  return `${slug}-${Math.max(0, Math.floor(suffixNumber)).toString(36)}`;
}

export function normalizeAppearanceLayerVisibility(layerVisibility = null) {
  const source = layerVisibility && typeof layerVisibility === "object" ? layerVisibility : {};
  const openOceanLayerVisibility = normalizeOpenOceanLayerVisibility(source);
  const normalized = {
    showWaterRegions: source.showWaterRegions === undefined ? true : !!source.showWaterRegions,
    showOpenOceanRegions: openOceanLayerVisibility.showOpenOceanRegions,
    allowOpenOceanSelect: openOceanLayerVisibility.allowOpenOceanSelect,
    allowOpenOceanPaint: openOceanLayerVisibility.allowOpenOceanPaint,
    showScenarioSpecialRegions:
      source.showScenarioSpecialRegions === undefined
        ? true
        : !!source.showScenarioSpecialRegions,
    showScenarioAtlantropa:
      source.showScenarioAtlantropa === undefined ? true : !!source.showScenarioAtlantropa,
    showScenarioReliefOverlays:
      source.showScenarioReliefOverlays === undefined
        ? true
        : !!source.showScenarioReliefOverlays,
    showCityPoints: source.showCityPoints === undefined ? true : !!source.showCityPoints,
    showStrategicResourceMarkers:
      source.showStrategicResourceMarkers === undefined ? false : !!source.showStrategicResourceMarkers,
    strategicChoroplethMetric: String(source.strategicChoroplethMetric || ""),
    showUrban: source.showUrban === undefined ? true : !!source.showUrban,
    showPhysical: source.showPhysical === undefined ? true : !!source.showPhysical,
    showRivers: source.showRivers === undefined ? true : !!source.showRivers,
    showTransport: source.showTransport === undefined ? true : !!source.showTransport,
    showSpecialZones: source.showSpecialZones === undefined ? false : !!source.showSpecialZones,
  };
  getTransportOverviewLayerVisibilityFields().forEach((field) => {
    normalized[field] = !!source[field];
  });
  return normalized;
}

export function normalizeAppearanceStyleSnapshot(styleConfig = null) {
  const target = {
    styleConfig: createDefaultStyleConfig(),
  };
  restoreImportedStyleConfigState(target, styleConfig);
  return cloneAppearanceValue(target.styleConfig);
}

export function createAppearanceSnapshotFromRuntimeState(runtimeState = {}) {
  // 预设保存的是“外观快照”而不是完整项目；新增外观面板时要在这里显式决定是否进入可导出/导入合同。
  return {
    schemaVersion: APPEARANCE_PRESET_SCHEMA_VERSION,
    styleConfig: normalizeAppearanceStyleSnapshot(runtimeState.styleConfig),
    layerVisibility: normalizeAppearanceLayerVisibility(runtimeState),
    intensityFields: serializeIntensityFieldsState(runtimeState.intensityFields),
  };
}

export function normalizeAppearancePresetSnapshot(value = null) {
  const source = value && typeof value === "object" ? value : {};
  const rawSnapshot =
    source.snapshot && typeof source.snapshot === "object" ? source.snapshot : source;
  return {
    schemaVersion: APPEARANCE_PRESET_SCHEMA_VERSION,
    styleConfig: normalizeAppearanceStyleSnapshot(rawSnapshot.styleConfig),
    layerVisibility: normalizeAppearanceLayerVisibility(rawSnapshot.layerVisibility),
    intensityFields: serializeIntensityFieldsState(rawSnapshot.intensityFields),
  };
}

export function createAppearancePresetFromRuntimeState(
  runtimeState = {},
  { id = "", name = "", now = Date.now() } = {},
) {
  const presetName = String(name || "Appearance Preset").trim() || "Appearance Preset";
  const timestamp = formatTimestamp(now, new Date().toISOString());
  return {
    schemaVersion: APPEARANCE_PRESET_SCHEMA_VERSION,
    id: normalizePresetId(id) || createAppearancePresetId(presetName, now),
    name: presetName,
    createdAt: timestamp,
    updatedAt: timestamp,
    snapshot: createAppearanceSnapshotFromRuntimeState(runtimeState),
  };
}

export function normalizeAppearancePreset(value = null, index = 0) {
  const source =
    value && typeof value === "object" && value.preset && typeof value.preset === "object"
      ? value.preset
      : value;
  const raw = source && typeof source === "object" ? source : {};
  const fallbackName = `Appearance Preset ${index + 1}`;
  const name = String(raw.name || fallbackName).trim() || fallbackName;
  const id = normalizePresetId(raw.id) || createAppearancePresetId(name, index + 1);
  return {
    schemaVersion: APPEARANCE_PRESET_SCHEMA_VERSION,
    id,
    name,
    createdAt: formatTimestamp(raw.createdAt),
    updatedAt: formatTimestamp(raw.updatedAt || raw.createdAt),
    snapshot: normalizeAppearancePresetSnapshot(raw),
  };
}

export function createDefaultAppearancePresetsState() {
  return {
    schemaVersion: APPEARANCE_PRESET_SCHEMA_VERSION,
    selectedPresetId: "",
    order: [],
    byId: {},
  };
}

function getRawPresetEntries(rawState = null, unsupported = []) {
  if (!rawState || typeof rawState !== "object") return unsupported;
  // 导入入口同时接收单个导出文件、旧版数组和当前 byId/order 状态，避免预设文件格式演进时丢用户资产。
  if (rawState.kind === APPEARANCE_PRESET_EXPORT_KIND && rawState.preset) {
    return [rawState.preset];
  }
  if (rawState.preset && typeof rawState.preset === "object") {
    return [rawState.preset];
  }
  if (Array.isArray(rawState.presets)) {
    return rawState.presets;
  }
  if (Array.isArray(rawState)) {
    return rawState;
  }
  if (rawState.byId && typeof rawState.byId === "object") {
    const orderedIds = Array.isArray(rawState.order)
      ? rawState.order.map((id) => String(id || "")).filter(Boolean)
      : Object.keys(rawState.byId);
    const orderedEntries = orderedIds
      .map((id) => rawState.byId[id])
      .filter((preset) => preset && typeof preset === "object");
    const seen = new Set(orderedIds);
    Object.entries(rawState.byId).forEach(([id, preset]) => {
      if (seen.has(id) || !preset || typeof preset !== "object") return;
      orderedEntries.push(preset);
    });
    return orderedEntries;
  }
  if (rawState.snapshot && typeof rawState.snapshot === "object") {
    return [rawState];
  }
  return unsupported;
}

export function normalizeAppearancePresetsState(rawState = null) {
  const source = rawState && typeof rawState === "object" ? rawState : {};
  const normalized = createDefaultAppearancePresetsState();
  getRawPresetEntries(source).forEach((entry, index) => {
    const preset = normalizeAppearancePreset(entry, index);
    if (!preset.id) return;
    normalized.byId[preset.id] = preset;
    if (!normalized.order.includes(preset.id)) {
      normalized.order.push(preset.id);
    }
  });
  const selectedPresetId = normalizePresetId(source.selectedPresetId);
  normalized.selectedPresetId = normalized.byId[selectedPresetId]
    ? selectedPresetId
    : normalized.order[0] || "";
  return normalized;
}

export function serializeAppearancePresetsState(rawState = null) {
  return cloneAppearanceValue(normalizeAppearancePresetsState(rawState));
}

export function upsertAppearancePreset(rawState = null, preset = null) {
  const normalized = normalizeAppearancePresetsState(rawState);
  const nextPreset = normalizeAppearancePreset(preset, normalized.order.length);
  const existing = normalized.byId[nextPreset.id];
  if (existing && !preset?.createdAt) {
    nextPreset.createdAt = existing.createdAt;
  }
  normalized.byId[nextPreset.id] = nextPreset;
  if (!normalized.order.includes(nextPreset.id)) {
    normalized.order.push(nextPreset.id);
  }
  normalized.selectedPresetId = nextPreset.id;
  return normalized;
}

export function deleteAppearancePreset(rawState = null, presetId = "") {
  const normalized = normalizeAppearancePresetsState(rawState);
  const id = normalizePresetId(presetId);
  if (!id || !normalized.byId[id]) return normalized;
  delete normalized.byId[id];
  normalized.order = normalized.order.filter((entryId) => entryId !== id);
  if (normalized.selectedPresetId === id) {
    normalized.selectedPresetId = normalized.order[0] || "";
  }
  return normalized;
}

export function getSelectedAppearancePreset(rawState = null) {
  const normalized = normalizeAppearancePresetsState(rawState);
  return normalized.byId[normalized.selectedPresetId] || null;
}

export function normalizeAppearancePresetImportPayload(payload = null) {
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch (cause) {
      const error = new Error("Invalid appearance preset JSON", { cause });
      error.code = "invalid-json";
      throw error;
    }
  }
  const entries = getRawPresetEntries(payload, null);
  if (entries === null) {
    const error = new Error("Unsupported appearance preset format");
    error.code = "invalid-format";
    throw error;
  }
  return entries
    .map((entry, index) => normalizeAppearancePreset(entry, index))
    .filter((preset) => !!preset.id);
}

export function mergeAppearancePresetImportPayload(rawState = null, payload = null) {
  let nextState = normalizeAppearancePresetsState(rawState);
  normalizeAppearancePresetImportPayload(payload).forEach((preset) => {
    nextState = upsertAppearancePreset(nextState, {
      ...preset,
      updatedAt: new Date().toISOString(),
    });
  });
  return nextState;
}

export function buildAppearancePresetExportPayload(preset = null) {
  const normalizedPreset = normalizeAppearancePreset(preset);
  return {
    kind: APPEARANCE_PRESET_EXPORT_KIND,
    schemaVersion: APPEARANCE_PRESET_SCHEMA_VERSION,
    preset: normalizedPreset,
  };
}
