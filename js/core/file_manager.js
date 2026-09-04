// Project file manager (Phase 13)
import {
  normalizeAnnotationView,
  normalizeCityLayerStyleConfig,
  normalizeDayNightStyleConfig,
  normalizeLakeStyleConfig,
  normalizeMapSemanticMode,
  INTENSITY_FIELD_GRID,
  normalizeAppearancePresetsState,
  normalizeIntensityFieldsState,
  normalizeIntensityPoint,
  normalizePhysicalStyleConfig,
  normalizeReferenceImageState,
  normalizeRiversStyleConfig,
  normalizeTransportOverviewStyleConfig,
  normalizeTransportWorkbenchPointDeltas,
  normalizeUrbanStyleConfig,
  normalizeTransportWorkbenchUiState,
  normalizeExportWorkbenchUiState,
  normalizeTextureStyleConfig,
  serializeAppearancePresetsState,
  serializeIntensityFieldsState,
  updateIntensityFieldChannel,
} from "./state.js";
import { t } from "./i18n.js";
import { callRuntimeHook } from "./state/index.js";
import { migrateImportedProjectData } from "./sovereignty_manager.js";
import { getTargetMainMapPackMeta } from "./transport_pack_resolver.js";
import {
  getTransportOverviewVisibilityField,
  listTransportOverviewCapabilityFamilyIds,
} from "./transport_capability_registry.js";
import { clearDirty } from "./dirty_state.js";
import { buildExportArtifactManifest } from "./export_artifact_package.js";
import { LegendManager } from "./legend_manager.js";
import {
  buildProjectPackagePayload,
  prepareProjectImportFile,
} from "./project_package_io.js";
import {
  normalizeSpecialZoneMembershipBrushModeState,
  normalizeSpecialZoneLayersState,
  resolveSpecialZoneTopologyFingerprint,
  serializeSpecialZoneLayersState,
} from "./special_zone_layers.js";
import { normalizeOpenOceanLayerVisibility } from "./state/ui_state.js";
import {
  captureUiVisibilityState,
  commitUiVisibilityState,
} from "./state/actions/ui_visibility_actions.js";

const LEGACY_BOUNDARY_VARIANT_ALIASES = {
  legacy_approx: "historical_reference",
};
const DEFAULT_ACTIVE_PALETTE_ID = "hoi4_vanilla";
const MAX_SAVED_RECENT_COLORS = 10;
const MAX_MANUAL_SPECIAL_ZONE_FEATURES = 200;
const MAX_MANUAL_SPECIAL_ZONE_COORDINATES_PER_FEATURE = 5000;
const MAX_MANUAL_SPECIAL_ZONE_RINGS_PER_FEATURE = 32;
const MAX_MANUAL_SPECIAL_ZONE_POLYGONS_PER_FEATURE = 32;
const DEFAULT_OPERATION_GRAPHIC_KIND = "attack";
const DEFAULT_OPERATIONAL_LINE_KIND = "frontline";
const CLOSED_OPERATION_GRAPHIC_KINDS = new Set(["encirclement", "theater"]);
const UNIT_COUNTER_STATS_SOURCES = new Set(["preset", "random", "manual"]);

function showToast(message, options = {}) {
  callRuntimeHook(null, "showToastFn", message, options);
}

function notifyProjectImportObserver(observer, payload, phase) {
  try {
    const result = observer(payload);
    if (result && typeof result.catch === "function") {
      result.catch((error) => {
        console.error(`[project-import] ${phase} observer failed:`, error);
      });
    }
  } catch (error) {
    console.error(`[project-import] ${phase} observer failed:`, error);
  }
}

function resolveProjectImportObservers(observers = {}) {
  return {
    notifySuccess: typeof observers.onSuccess === "function" ? observers.onSuccess : () => {},
    notifyError: typeof observers.onError === "function" ? observers.onError : () => {},
  };
}

function showProjectImportFailure(error) {
  const tone = String(error?.toastTone || "error");
  const title = String(error?.toastTitle || t("Import failed", "ui"));
  const message = String(
    error?.userMessage || t("Invalid project file. Please select a valid map_project.json.", "ui")
  );
  showToast(message, {
    title,
    tone,
    duration: 4200,
  });
}

function showProjectReadFailure(error) {
  showToast(String(error?.message || t("Unable to read the selected file.", "ui")), {
    title: t("Import failed", "ui"),
    tone: "error",
    duration: 4200,
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function migrateLegacyPhysicalIntensityField(intensityFields, legacyField) {
  if (!legacyField || typeof legacyField !== "object") return intensityFields;
  const legacyPoints = Array.isArray(legacyField.points) ? legacyField.points : [];
  if (!legacyPoints.length) return intensityFields;
  const normalizedFields = normalizeIntensityFieldsState(intensityFields);
  if (normalizedFields.channels.physicalAtlas?.points?.length) return normalizedFields;
  const migratedPoints = legacyPoints
    .map((point, index) => normalizeIntensityPoint({
      id: point?.id || `legacy-physical-${index + 1}`,
      lon: point?.lon,
      lat: point?.lat,
      strength: clamp(1 + (Number(point?.weight || 0) * 0.35), INTENSITY_FIELD_GRID.min, INTENSITY_FIELD_GRID.max),
      radiusDeg: clamp(Number(point?.radiusKm || 500) / 111, 0.25, 30),
      falloff: point?.falloff || "smooth",
    }, index))
    .filter(Boolean);
  if (!migratedPoints.length) return normalizedFields;
  return updateIntensityFieldChannel(normalizedFields, "physicalAtlas", (channel) => {
    channel.enabled = legacyField.enabled === undefined ? true : !!legacyField.enabled;
    channel.points = migratedPoints;
    channel.revision = Math.max(
      Math.max(0, Math.round(Number(channel.revision) || 0)),
      Math.max(0, Math.round(Number(legacyField.revision) || 0)),
    );
  });
}

function getTransportOverviewVisibilityFields() {
  return listTransportOverviewCapabilityFamilyIds()
    .map((familyId) => getTransportOverviewVisibilityField(familyId))
    .filter(Boolean);
}

function buildTransportOverviewLayerVisibility(appState) {
  const result = {};
  getTransportOverviewVisibilityFields().forEach((field) => {
    result[field] = !!appState[field];
  });
  return result;
}

function normalizeTransportOverviewLayerVisibility(layerVisibility) {
  commitUiVisibilityState(
    layerVisibility,
    Object.fromEntries(getTransportOverviewVisibilityFields().map((field) => [
      field,
      layerVisibility[field] === undefined ? false : !!layerVisibility[field],
    ])),
  );
}

function normalizeTransportCountryOverlayProjectState(value) {
  const source = value && typeof value === "object" ? value : {};
  const activePackIdByFamily = {};
  // 项目文件保存的是“已经 Apply 到主地图”的国家 transport 包身份。
  // 这里统一按 family 收口，顺手把旧的单 pack 形态折叠进新结构，避免导入后丢掉已应用覆盖层。
  const sourcePackIdsByFamily = source.activePackIdByFamily && typeof source.activePackIdByFamily === "object"
    ? source.activePackIdByFamily
    : {};
  Object.entries(sourcePackIdsByFamily).forEach(([familyId, packId]) => {
    const meta = getTargetMainMapPackMeta(packId);
    const normalizedFamilyId = String(familyId || "").trim().toLowerCase();
    if (meta && meta.family === normalizedFamilyId) {
      activePackIdByFamily[meta.family] = meta.packId;
    }
  });
  if (source.overlaysByFamily && typeof source.overlaysByFamily === "object") {
    Object.entries(source.overlaysByFamily).forEach(([familyId, overlay]) => {
      const meta = getTargetMainMapPackMeta(overlay?.activePackId);
      const normalizedFamilyId = String(familyId || "").trim().toLowerCase();
      if (meta && meta.family === normalizedFamilyId) {
        activePackIdByFamily[meta.family] = meta.packId;
      }
    });
  }
  const meta = getTargetMainMapPackMeta(source.activePackId);
  if (meta && (!source.family || meta.family === String(source.family || "").trim().toLowerCase())) {
    activePackIdByFamily[meta.family] = meta.packId;
  }
  const entries = Object.entries(activePackIdByFamily);
  if (!entries.length) {
    return { activePackId: "", family: "", activePackIdByFamily: {} };
  }
  const [firstFamily, firstPackId] = entries[0];
  return {
    activePackId: firstPackId,
    family: firstFamily,
    activePackIdByFamily,
  };
}

function normalizeProjectHexColor(value) {
  const candidate = String(value || "").trim();
  if (/^#(?:[0-9a-f]{6})$/i.test(candidate)) return candidate.toLowerCase();
  if (/^#(?:[0-9a-f]{3})$/i.test(candidate)) {
    return `#${candidate[1]}${candidate[1]}${candidate[2]}${candidate[2]}${candidate[3]}${candidate[3]}`.toLowerCase();
  }
  return "";
}

function normalizeStrategicKindToken(value, fallback) {
  const token = String(value || "").trim().toLowerCase();
  return /^[a-z][a-z0-9_-]{0,48}$/.test(token) ? token : fallback;
}

function normalizeUnitCounterStatPercent(value, fallback) {
  const numeric = Number(value);
  return clamp(Number.isFinite(numeric) ? Math.round(numeric) : fallback, 0, 100);
}

function normalizeUnitCounterStatsPresetId(value) {
  const token = String(value || "").trim().toLowerCase();
  return /^[a-z][a-z0-9_-]{0,48}$/.test(token) ? token : "regular";
}

function normalizeUnitCounterStatsSource(value) {
  const token = String(value || "").trim().toLowerCase();
  return UNIT_COUNTER_STATS_SOURCES.has(token) ? token : "preset";
}

function normalizeRecentColors(rawColors) {
  if (!Array.isArray(rawColors)) return [];
  const seen = new Set();
  return rawColors
    .map((value) => normalizeProjectHexColor(value))
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    })
    .slice(0, MAX_SAVED_RECENT_COLORS);
}

function normalizeInteractionGranularity(value) {
  return String(value || "").trim().toLowerCase() === "country" ? "country" : "subdivision";
}

function normalizeBatchFillScope(value) {
  return String(value || "").trim().toLowerCase() === "country" ? "country" : "parent";
}

function normalizeActivePaletteId(value) {
  const paletteId = String(value || "").trim();
  return paletteId || DEFAULT_ACTIVE_PALETTE_ID;
}

function normalizeBoundaryVariantSelectionMap(rawMap) {
  if (!rawMap || typeof rawMap !== "object") return {};
  return Object.fromEntries(
    Object.entries(rawMap)
      .map(([rawTag, rawVariantId]) => {
        const tag = String(rawTag || "").trim().toUpperCase();
        const variantId = String(rawVariantId || "").trim().toLowerCase();
        if (!tag) return null;
        return [tag, LEGACY_BOUNDARY_VARIANT_ALIASES[variantId] || variantId || "hoi4"];
      })
      .filter(Boolean)
  );
}

function normalizeScenarioImportAudit(
  rawAudit,
  {
    scenarioId = "",
    savedVersion = 1,
    currentVersion = 1,
    currentBaselineHash = "",
  } = {}
) {
  if (!rawAudit || typeof rawAudit !== "object") return null;
  // import audit 不是业务内容，而是“这个存档和当前 scenario baseline 是否还是同一条世界线”的对账单。
  // 字段不完整就直接丢弃，避免半旧半新的审计信息误导后续导入判断。
  const normalizedScenarioId = String(rawAudit.scenarioId || scenarioId || "").trim();
  const normalizedSavedVersion = Number(rawAudit.savedVersion || savedVersion || 1) || 1;
  const normalizedCurrentVersion = Number(rawAudit.currentVersion || currentVersion || normalizedSavedVersion || 1) || 1;
  const savedBaselineHash = String(rawAudit.savedBaselineHash || "").trim();
  const normalizedCurrentBaselineHash = String(rawAudit.currentBaselineHash || currentBaselineHash || "").trim();
  const acceptedAt = String(rawAudit.acceptedAt || "").trim();
  if (!normalizedScenarioId || !savedBaselineHash || !normalizedCurrentBaselineHash || !acceptedAt) {
    return null;
  }
  return {
    scenarioId: normalizedScenarioId,
    savedVersion: normalizedSavedVersion,
    currentVersion: normalizedCurrentVersion,
    savedBaselineHash,
    currentBaselineHash: normalizedCurrentBaselineHash,
    acceptedAt,
  };
}

function normalizeProjectCoordinatePair(value) {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lon = Number(value[0]);
  const lat = Number(value[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return [clamp(lon, -180, 180), clamp(lat, -90, 90)];
}

function normalizeManualSpecialZoneRing(rawRing, coordinateBudget) {
  if (!Array.isArray(rawRing) || coordinateBudget.remaining < 4) return null;
  const normalized = [];
  // coordinateBudget 在整个 feature 维度共享，
  // 这样导入时会优先保住“每个 ring 都还能闭合并可编辑”，而不是让单个超大 ring 吃掉全部预算。
  const maxRingVerticesToScan = Math.min(
    rawRing.length,
    MAX_MANUAL_SPECIAL_ZONE_COORDINATES_PER_FEATURE,
  );
  for (let i = 0; i < maxRingVerticesToScan; i += 1) {
    if (coordinateBudget.remaining <= 0) break;
    const coord = normalizeProjectCoordinatePair(rawRing[i]);
    if (!coord) continue;
    normalized.push(coord);
    coordinateBudget.remaining -= 1;
  }
  if (normalized.length < 3) return null;
  const first = normalized[0];
  const last = normalized[normalized.length - 1];
  const isClosed = first[0] === last[0] && first[1] === last[1];
  if (!isClosed) {
    if (coordinateBudget.remaining <= 0) return null;
    normalized.push([first[0], first[1]]);
    coordinateBudget.remaining -= 1;
  }
  if (normalized.length < 4) return null;
  return normalized;
}

function normalizeManualSpecialZoneGeometry(rawGeometry) {
  if (!rawGeometry || typeof rawGeometry !== "object") return null;
  const geometryType = String(rawGeometry.type || "").trim();
  if (geometryType !== "Polygon" && geometryType !== "MultiPolygon") return null;
  // 手工 special zone 来自项目文件，必须在导入边界做预算裁剪；
  // 否则异常大的坐标集合会把问题一路带进运行时编辑链。
  const coordinateBudget = { remaining: MAX_MANUAL_SPECIAL_ZONE_COORDINATES_PER_FEATURE };

  if (geometryType === "Polygon") {
    const rings = Array.isArray(rawGeometry.coordinates) ? rawGeometry.coordinates : [];
    const normalizedRings = rings
      .slice(0, MAX_MANUAL_SPECIAL_ZONE_RINGS_PER_FEATURE)
      .map((ring) => normalizeManualSpecialZoneRing(ring, coordinateBudget))
      .filter(Boolean);
    if (!normalizedRings.length) return null;
    return {
      type: "Polygon",
      coordinates: normalizedRings,
    };
  }

  const polygons = Array.isArray(rawGeometry.coordinates) ? rawGeometry.coordinates : [];
  const normalizedPolygons = polygons
    .slice(0, MAX_MANUAL_SPECIAL_ZONE_POLYGONS_PER_FEATURE)
    .map((polygonRings) => {
      if (!Array.isArray(polygonRings)) return null;
      const normalizedRings = polygonRings
        .slice(0, MAX_MANUAL_SPECIAL_ZONE_RINGS_PER_FEATURE)
        .map((ring) => normalizeManualSpecialZoneRing(ring, coordinateBudget))
        .filter(Boolean);
      if (!normalizedRings.length) return null;
      return normalizedRings;
    })
    .filter(Boolean);
  if (!normalizedPolygons.length) return null;
  return {
    type: "MultiPolygon",
    coordinates: normalizedPolygons,
  };
}

function normalizeManualSpecialZoneFeature(rawFeature, fallbackIndex) {
  if (!rawFeature || typeof rawFeature !== "object" || String(rawFeature.type || "") !== "Feature") return null;
  const geometry = normalizeManualSpecialZoneGeometry(rawFeature.geometry);
  if (!geometry) return null;
  const rawProperties = rawFeature.properties && typeof rawFeature.properties === "object"
    ? rawFeature.properties
    : {};
  const id = String(rawProperties.id || `manual_sz_${fallbackIndex + 1}`).trim() || `manual_sz_${fallbackIndex + 1}`;
  const name = String(rawProperties.name || rawProperties.label || "").trim();
  const zoneType = String(rawProperties.type || "custom").trim().toLowerCase() || "custom";
  return {
    type: "Feature",
    geometry,
    properties: {
      ...rawProperties,
      id,
      name: name || `${zoneType} zone`,
      label: String(rawProperties.label || name || `${zoneType} zone`).trim() || `${zoneType} zone`,
      type: zoneType,
      __source: "manual",
    },
  };
}

function normalizeManualSpecialZones(rawCollection) {
  if (!rawCollection || typeof rawCollection !== "object" || rawCollection.type !== "FeatureCollection") {
    return { type: "FeatureCollection", features: [] };
  }
  const rawFeatures = Array.isArray(rawCollection.features) ? rawCollection.features : [];
  const features = rawFeatures
    .slice(0, MAX_MANUAL_SPECIAL_ZONE_FEATURES)
    .map((feature, index) => normalizeManualSpecialZoneFeature(feature, index))
    .filter(Boolean);
  return {
    type: "FeatureCollection",
    features,
  };
}

function normalizeOperationGraphics(rawGraphics) {
  if (!Array.isArray(rawGraphics)) return [];
  return rawGraphics
    .map((entry, index) => {
      const raw = entry && typeof entry === "object" ? entry : {};
      const kind = normalizeStrategicKindToken(raw.kind, DEFAULT_OPERATION_GRAPHIC_KIND);
      const points = Array.isArray(raw.points)
        ? raw.points.map((point) => normalizeProjectCoordinatePair(point)).filter(Boolean)
        : [];
      if (points.length < (CLOSED_OPERATION_GRAPHIC_KINDS.has(kind) ? 3 : 2)) return null;
      const stroke = normalizeProjectHexColor(raw.stroke) || null;
      return {
        id: String(raw.id || `opg_${index + 1}`).trim() || `opg_${index + 1}`,
        kind,
        label: String(raw.label || "").trim(),
        points,
        stylePreset: normalizeStrategicKindToken(raw.stylePreset, kind),
        stroke,
        width: clamp(Number.isFinite(Number(raw.width)) ? Number(raw.width) : 0, 0, 16),
        opacity: clamp(Number.isFinite(Number(raw.opacity)) ? Number(raw.opacity) : 1, 0, 1),
      };
    })
    .filter(Boolean);
}

function normalizeOperationalLines(rawLines) {
  if (!Array.isArray(rawLines)) return [];
  return rawLines
    .map((entry, index) => {
      const raw = entry && typeof entry === "object" ? entry : {};
      const kind = normalizeStrategicKindToken(raw.kind, DEFAULT_OPERATIONAL_LINE_KIND);
      const points = Array.isArray(raw.points)
        ? raw.points.map((point) => normalizeProjectCoordinatePair(point)).filter(Boolean)
        : [];
      if (points.length < 2) return null;
      const stroke = normalizeProjectHexColor(raw.stroke) || null;
      const attachedCounterIds = Array.isArray(raw.attachedCounterIds)
        ? raw.attachedCounterIds.map((value) => String(value || "").trim()).filter(Boolean)
        : [];
      // operational line 这里只保留可序列化的挂接关系；
      // 真正的 counter 布局恢复留给运行时按 lineId 重新连线，避免项目文件里混入 UI 临时状态。
      return {
        id: String(raw.id || `opl_${index + 1}`).trim() || `opl_${index + 1}`,
        kind,
        label: String(raw.label || "").trim(),
        points,
        stylePreset: normalizeStrategicKindToken(raw.stylePreset, kind),
        stroke,
        width: clamp(Number.isFinite(Number(raw.width)) ? Number(raw.width) : 0, 0, 16),
        opacity: clamp(Number.isFinite(Number(raw.opacity)) ? Number(raw.opacity) : 1, 0, 1),
        attachedCounterIds,
      };
    })
    .filter(Boolean);
}

function normalizeUnitCounterNationSource(value) {
  const source = String(value || "").trim().toLowerCase();
  return ["display", "controller", "owner", "active", "manual"].includes(source) ? source : "display";
}

const UNIT_COUNTER_MILSTD_SIDC_PATTERN = /^[A-Z0-9*-]{10,40}$/;
const UNIT_COUNTER_MILSTD_SIDC_ALIASES = new Set([
  "INF",
  "ARMORED",
  "ARM",
  "HQ",
  "ART",
]);

function normalizeImportedUnitCounterSidc(value, renderer = "game") {
  const token = String(value || "").trim().toUpperCase();
  if (renderer !== "milstd") return token;
  if (UNIT_COUNTER_MILSTD_SIDC_ALIASES.has(token)) return token;
  return UNIT_COUNTER_MILSTD_SIDC_PATTERN.test(token) ? token : "";
}

function normalizeUnitCounters(rawCounters) {
  if (!Array.isArray(rawCounters)) return [];
  return rawCounters
    .map((entry, index) => {
      const raw = entry && typeof entry === "object" ? entry : {};
      const anchorSource = raw.anchor && typeof raw.anchor === "object" ? raw.anchor : {};
      const lon = Number(anchorSource.lon);
      const lat = Number(anchorSource.lat);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
      const renderer = String(raw.renderer || "game").trim().toLowerCase() === "milstd" ? "milstd" : "game";
      const size = String(raw.size || "medium").trim().toLowerCase();
      const sidc = normalizeImportedUnitCounterSidc(raw.sidc || raw.symbolCode || raw.templateId || "", renderer);
      const presetId = String(raw.presetId || raw.templateId || "").trim().toLowerCase();
      const nationTag = String(raw.nationTag || raw.countryTag || raw.ownerTag || "").trim().toUpperCase();
      const layoutAnchorSource = raw.layoutAnchor && typeof raw.layoutAnchor === "object" ? raw.layoutAnchor : {};
      const attachmentSource = raw.attachment && typeof raw.attachment === "object" ? raw.attachment : {};
      const layoutAnchorSlot = Number.isInteger(Number(layoutAnchorSource.slotIndex))
        ? Math.max(0, Math.round(Number(layoutAnchorSource.slotIndex)))
        : null;
      const attachmentLineId = String(
        attachmentSource.lineId
        || attachmentSource.operationalLineId
        || attachmentSource.targetId
        || ""
      ).trim();
      const attachmentKind = String(attachmentSource.kind || "").trim().toLowerCase() || (attachmentLineId ? "operational-line" : "");
      // 项目导入时把 anchor、layoutAnchor、attachment 分开归一：
      // anchor 解决地理落点，layoutAnchor 解决同地块排布，attachment 解决与线条的从属关系，
      // 后续 renderer/sidebar 才能按各自职责恢复这些联系。
      return {
        id: String(raw.id || `unit_${index + 1}`).trim() || `unit_${index + 1}`,
        renderer,
        sidc,
        symbolCode: sidc,
        label: String(raw.label || "").trim(),
        nationTag,
        nationSource: normalizeUnitCounterNationSource(raw.nationSource),
        presetId,
        unitType: String(raw.unitType || presetId || "").trim(),
        iconId: String(raw.iconId || "").trim().toLowerCase(),
        echelon: String(raw.echelon || "").trim(),
        subLabel: String(raw.subLabel || "").trim(),
        strengthText: String(raw.strengthText || "").trim(),
        baseFillColor: normalizeProjectHexColor(raw.baseFillColor),
        organizationPct: normalizeUnitCounterStatPercent(raw.organizationPct, 78),
        equipmentPct: normalizeUnitCounterStatPercent(raw.equipmentPct, 74),
        statsPresetId: normalizeUnitCounterStatsPresetId(raw.statsPresetId),
        statsSource: normalizeUnitCounterStatsSource(raw.statsSource),
        size: ["small", "medium", "large"].includes(size) ? size : "medium",
        facing: clamp(Number.isFinite(Number(raw.facing)) ? Number(raw.facing) : 0, -180, 180),
        zIndex: Math.round(Number.isFinite(Number(raw.zIndex)) ? Number(raw.zIndex) : index),
        anchor: {
          lon: clamp(lon, -180, 180),
          lat: clamp(lat, -90, 90),
          featureId: String(anchorSource.featureId || "").trim(),
        },
        layoutAnchor: {
          kind: String(layoutAnchorSource.kind || (attachmentLineId ? "attachment" : "feature")).trim().toLowerCase() || "feature",
          key: String(layoutAnchorSource.key || anchorSource.featureId || "").trim(),
          slotIndex: layoutAnchorSlot,
        },
        attachment: attachmentLineId
          ? {
            kind: attachmentKind,
            lineId: attachmentLineId,
          }
          : null,
      };
    })
    .filter(Boolean);
}

class FileManager {
  static buildProjectPayload(appState) {
    if (!appState) return null;
    const timestamp = Date.now();
    const openOceanLayerVisibility = normalizeOpenOceanLayerVisibility(appState);
    const layerVisibility = captureUiVisibilityState({
      showWaterRegions: appState.showWaterRegions === undefined ? true : !!appState.showWaterRegions,
      showOpenOceanRegions: openOceanLayerVisibility.showOpenOceanRegions,
      allowOpenOceanSelect: openOceanLayerVisibility.allowOpenOceanSelect,
      allowOpenOceanPaint: openOceanLayerVisibility.allowOpenOceanPaint,
      showScenarioSpecialRegions:
        appState.showScenarioSpecialRegions === undefined ? true : !!appState.showScenarioSpecialRegions,
      showScenarioAtlantropa:
        appState.showScenarioAtlantropa === undefined ? true : !!appState.showScenarioAtlantropa,
      showScenarioReliefOverlays:
        appState.showScenarioReliefOverlays === undefined ? true : !!appState.showScenarioReliefOverlays,
      showCityPoints: appState.showCityPoints === undefined ? true : !!appState.showCityPoints,
      showStrategicResourceMarkers: !!appState.showStrategicResourceMarkers,
      strategicChoroplethMetric: String(appState.strategicChoroplethMetric || ""),
      showUrban: !!appState.showUrban,
      showPhysical: !!appState.showPhysical,
      showRivers: !!appState.showRivers,
      showTransport: appState.showTransport === undefined ? true : !!appState.showTransport,
      ...buildTransportOverviewLayerVisibility(appState),
      showSpecialZones: !!appState.showSpecialZones,
    });
    // export 的职责是把当前 runtimeState 收敛成稳定 schema。
    // 这里宁可集中做一次 normalize，也不要让读取方承担多套历史字段和 UI 派生状态。
    const payload = {
      schemaVersion: 22,
      countryBaseColors: appState.sovereignBaseColors || appState.countryBaseColors || {},
      featureOverrides: appState.visualOverrides || appState.featureOverrides || {},
      sovereignBaseColors: appState.sovereignBaseColors || appState.countryBaseColors || {},
      visualOverrides: appState.visualOverrides || appState.featureOverrides || {},
      waterRegionOverrides: appState.waterRegionOverrides || {},
      specialZoneLayers: serializeSpecialZoneLayersState(appState.specialZoneLayers, {
        topologyFingerprint: resolveSpecialZoneTopologyFingerprint(appState),
      }),
      sovereigntyByFeatureId: appState.sovereigntyByFeatureId || {},
      mapSemanticMode: normalizeMapSemanticMode(appState.mapSemanticMode),
      paintMode: appState.paintMode || "visual",
      interactionGranularity: normalizeInteractionGranularity(appState.interactionGranularity),
      batchFillScope: normalizeBatchFillScope(appState.batchFillScope),
      activeSovereignCode: appState.activeSovereignCode || "",
      activePaletteId: normalizeActivePaletteId(appState.activePaletteId),
      dynamicBordersDirty: !!appState.dynamicBordersDirty,
      dynamicBordersDirtyReason: appState.dynamicBordersDirtyReason || "",
      specialZoneMembershipBrushMode: normalizeSpecialZoneMembershipBrushModeState(appState.specialZoneMembershipBrushMode),
      specialZones: appState.specialZones || {},
      parentBordersVisible: appState.parentBordersVisible !== false,
      parentBorderEnabledByCountry: appState.parentBorderEnabledByCountry || {},
      // manualSpecialZones 只作为旧项目 schema 的占位兼容字段继续导出；
      // 真实可编辑数据已经全部收口到 specialZoneLayers，避免两套 special zone 真相源并存。
      manualSpecialZones: { type: "FeatureCollection", features: [] },
      annotationView: normalizeAnnotationView(appState.annotationView),
      operationalLines: normalizeOperationalLines(appState.operationalLines),
      operationGraphics: normalizeOperationGraphics(appState.operationGraphics),
      unitCounters: normalizeUnitCounters(appState.unitCounters),
      intensityFields: serializeIntensityFieldsState(appState.intensityFields),
      appearancePresets: serializeAppearancePresetsState(appState.appearancePresets),
      customPresets: appState.customPresets || {},
      referenceImageState: normalizeReferenceImageState(appState.referenceImageState),
      recentColors: normalizeRecentColors(appState.recentColors),
      legendLabels: LegendManager.normalizeLabels(appState.legendLabels),
      legendConfig: LegendManager.normalizeConfig(appState.legendConfig),
      legendControl: LegendManager.normalizeControl(appState.legendControl),
      layerVisibility,
      styleConfig: {
        internalBorders: appState.styleConfig?.internalBorders || null,
        empireBorders: appState.styleConfig?.empireBorders || null,
        coastlines: appState.styleConfig?.coastlines || null,
        parentBorders: appState.styleConfig?.parentBorders || null,
        ocean: appState.styleConfig?.ocean || null,
        lakes: normalizeLakeStyleConfig(appState.styleConfig?.lakes),
        cityPoints: normalizeCityLayerStyleConfig(appState.styleConfig?.cityPoints),
        urban: normalizeUrbanStyleConfig(appState.styleConfig?.urban),
        physical: normalizePhysicalStyleConfig(appState.styleConfig?.physical),
        transportOverview: normalizeTransportOverviewStyleConfig(appState.styleConfig?.transportOverview),
        rivers: normalizeRiversStyleConfig(appState.styleConfig?.rivers),
        texture: normalizeTextureStyleConfig(appState.styleConfig?.texture),
        dayNight: normalizeDayNightStyleConfig(appState.styleConfig?.dayNight),
      },
      transportWorkbenchPointDeltas: normalizeTransportWorkbenchPointDeltas(appState.transportWorkbenchPointDeltas),
      transportWorkbenchUi: normalizeTransportWorkbenchUiState(appState.transportWorkbenchUi),
      // workbench 当前选中的 pack 只是预览态；项目文件只持久化真正已经 Apply 到主图的 overlay 身份。
      transportCountryOverlayState: normalizeTransportCountryOverlayProjectState(appState.transportCountryOverlayState),
      exportWorkbenchUi: normalizeExportWorkbenchUiState(appState.exportWorkbenchUi),
      scenario: appState.activeScenarioId
        ? {
          id: appState.activeScenarioId,
          version: appState.activeScenarioManifest?.version || 1,
          baselineHash: appState.scenarioBaselineHash || "",
          importAudit: normalizeScenarioImportAudit(appState.scenarioImportAudit, {
            scenarioId: appState.activeScenarioId,
            savedVersion: appState.activeScenarioManifest?.version || 1,
            currentVersion: appState.activeScenarioManifest?.version || 1,
            currentBaselineHash: appState.scenarioBaselineHash || "",
          }),
        }
        : null,
      releasableBoundaryVariantByTag: normalizeBoundaryVariantSelectionMap(appState.releasableBoundaryVariantByTag),
      timestamp,
    };
    payload.exportHandoff = buildExportArtifactManifest({
      artifactKind: "project-json",
      generatedAt: new Date(timestamp).toISOString(),
      scenario: payload.scenario,
      project: {
        schemaVersion: payload.schemaVersion,
        timestamp: payload.timestamp,
      },
      exportUi: payload.exportWorkbenchUi,
      files: [{
        path: "map_project.json",
        role: "editable-project",
        mime: "application/json",
      }],
    });
    return payload;
  }

  static async writeBlobDownload(blob, filename, { destination = "picker", pickerTypes = [] } = {}) {
    const normalizedDestination = String(destination || "picker").trim().toLowerCase();
    if (
      normalizedDestination === "picker"
      && typeof globalThis.showSaveFilePicker === "function"
      && typeof blob?.stream === "function"
    ) {
      try {
        const pickerOptions = { suggestedName: filename };
        if (Array.isArray(pickerTypes) && pickerTypes.length) {
          pickerOptions.types = pickerTypes;
          pickerOptions.excludeAcceptAllOption = true;
        }
        const handle = await globalThis.showSaveFilePicker(pickerOptions);
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return true;
      } catch (error) {
        if (error?.name === "AbortError") return false;
        throw error;
      }
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 100);
    return true;
  }

  static async buildProjectDownloadPayload(payload, { format = "json", packageContents = "recommended" } = {}) {
    const normalizedFormat = String(format || "json").trim().toLowerCase();
    const data = JSON.stringify(payload, null, 2);
    if (normalizedFormat === "zip") {
      const projectPackage = await buildProjectPackagePayload(payload, {
        contentPreset: packageContents,
      });
      return {
        ...projectPackage,
        label: "Project ZIP package downloaded.",
      };
    }
    return {
      blob: new Blob([data], { type: "application/json" }),
      filename: "map_project.json",
      pickerTypes: [{
        description: "Editable project JSON",
        accept: {
          "application/json": [".json"],
        },
      }],
      label: "Project file downloaded.",
    };
  }

  static async exportProject(appState, options = {}) {
    const payload = FileManager.buildProjectPayload(appState);
    if (!payload) return;

    const download = await FileManager.buildProjectDownloadPayload(payload, options);
    const wroteFile = await FileManager.writeBlobDownload(download.blob, download.filename, {
      ...options,
      pickerTypes: download.pickerTypes,
    });
    if (!wroteFile) return false;
    showToast(t(download.label, "ui"), {
      title: t("Project saved", "ui"),
      tone: "success",
    });
    clearDirty("project-export");
    return true;
  }

  static normalizeImportedProjectData(rawData) {
    if (!rawData || typeof rawData !== "object") {
      throw new Error("Invalid project file");
    }
    let data = migrateImportedProjectData(rawData);

    // import 是旧 schema、缺省字段和 UI/场景派生状态重新归一化的唯一入口。
    // 回调拿到的必须已经是可直接进入运行时的稳定形态，避免把兼容判断分散到各个调用点。
    // Backward compatibility: v1 only had `colors`.
    if (data.colors && !data.featureOverrides && !data.countryBaseColors) {
      data.featureOverrides = data.colors;
      data.countryBaseColors = {};
    }

    if (!data.featureOverrides || typeof data.featureOverrides !== "object") {
      data.featureOverrides = {};
    }
    if (!data.countryBaseColors || typeof data.countryBaseColors !== "object") {
      data.countryBaseColors = {};
    }
    if (!data.visualOverrides || typeof data.visualOverrides !== "object") {
      data.visualOverrides = data.featureOverrides;
    }
    if (!data.waterRegionOverrides || typeof data.waterRegionOverrides !== "object") {
      data.waterRegionOverrides = {};
    }
    // special zone 的历史项目文件曾分散在 manualSpecialZones / specialRegionOverrides / specialZoneLayers。
    // 导入时一次性合并回 canonical `specialZoneLayers`，后续运行时只认这一条主状态。
    data.specialZoneLayers = normalizeSpecialZoneLayersState({
      ...(data.specialZoneLayers && typeof data.specialZoneLayers === "object" ? data.specialZoneLayers : {}),
      manualSpecialZones: data.manualSpecialZones,
      specialRegionOverrides: data.specialRegionOverrides,
    }, {
      defaultSource: "project",
      topologyFingerprint: String(data.scenario?.baselineHash || "").trim(),
    });
    data.specialRegionOverrides = {};
    if (!data.sovereignBaseColors || typeof data.sovereignBaseColors !== "object") {
      data.sovereignBaseColors = data.countryBaseColors;
    }
    if (!data.sovereigntyByFeatureId || typeof data.sovereigntyByFeatureId !== "object") {
      data.sovereigntyByFeatureId = {};
    }
    delete data.scenarioControllersByFeatureId;
    data.mapSemanticMode = normalizeMapSemanticMode(data.mapSemanticMode);
    data.interactionGranularity = normalizeInteractionGranularity(data.interactionGranularity);
    data.batchFillScope = normalizeBatchFillScope(data.batchFillScope);
    data.activePaletteId = normalizeActivePaletteId(data.activePaletteId);
    data.dynamicBordersDirty = !!data.dynamicBordersDirty;
    data.dynamicBordersDirtyReason = String(data.dynamicBordersDirtyReason || "");
    data.specialZoneMembershipBrushMode = normalizeSpecialZoneMembershipBrushModeState(data.specialZoneMembershipBrushMode);
    if (!data.customPresets || typeof data.customPresets !== "object") {
      data.customPresets = {};
    }
    data.referenceImageState = normalizeReferenceImageState(data.referenceImageState);
    data.recentColors = normalizeRecentColors(data.recentColors);
    data.legendLabels = LegendManager.normalizeLabels(data.legendLabels);
    data.legendConfig = LegendManager.normalizeConfig(data.legendConfig);
    data.legendControl = LegendManager.normalizeControl(data.legendControl);
    data.parentBordersVisible = data.parentBordersVisible !== false;
    if (!data.parentBorderEnabledByCountry || typeof data.parentBorderEnabledByCountry !== "object") {
      data.parentBorderEnabledByCountry = {};
    }
    if (!data.styleConfig || typeof data.styleConfig !== "object") {
      data.styleConfig = {};
    }
    if (!data.styleConfig.internalBorders || typeof data.styleConfig.internalBorders !== "object") {
      data.styleConfig.internalBorders = null;
    }
    if (!data.styleConfig.empireBorders || typeof data.styleConfig.empireBorders !== "object") {
      data.styleConfig.empireBorders = null;
    }
    if (!data.styleConfig.coastlines || typeof data.styleConfig.coastlines !== "object") {
      data.styleConfig.coastlines = null;
    }
    if (!data.styleConfig.parentBorders || typeof data.styleConfig.parentBorders !== "object") {
      data.styleConfig.parentBorders = null;
    }
    if (!data.styleConfig.ocean || typeof data.styleConfig.ocean !== "object") {
      data.styleConfig.ocean = null;
    }
    data.styleConfig.lakes = normalizeLakeStyleConfig(data.styleConfig.lakes);
    data.styleConfig.cityPoints = normalizeCityLayerStyleConfig(data.styleConfig.cityPoints);
    data.styleConfig.urban = normalizeUrbanStyleConfig(data.styleConfig.urban);
    data.styleConfig.physical = normalizePhysicalStyleConfig(data.styleConfig.physical);
    data.intensityFields = migrateLegacyPhysicalIntensityField(
      normalizeIntensityFieldsState(data.intensityFields),
      data.physicalIntensityField,
    );
    delete data.physicalIntensityField;
    data.appearancePresets = normalizeAppearancePresetsState(data.appearancePresets);
    data.styleConfig.transportOverview = normalizeTransportOverviewStyleConfig(data.styleConfig.transportOverview);
    data.styleConfig.rivers = normalizeRiversStyleConfig(data.styleConfig.rivers);
    if (data.styleConfig.specialZones && typeof data.styleConfig.specialZones === "object") {
      console.info("[project-import] Legacy styleConfig.specialZones ignored; specialZoneLayers is the canonical model.");
    }
    data.styleConfig.specialZones = null;
    data.styleConfig.texture = normalizeTextureStyleConfig(data.styleConfig.texture);
    data.styleConfig.dayNight = normalizeDayNightStyleConfig(data.styleConfig.dayNight);
    data.transportWorkbenchUi = normalizeTransportWorkbenchUiState(data.transportWorkbenchUi);
    data.transportWorkbenchPointDeltas = normalizeTransportWorkbenchPointDeltas(data.transportWorkbenchPointDeltas);
    // 导入后只恢复主图已应用 overlay 的 family->pack 映射；
    // 具体 collection 仍由运行时按 manifest/source gate 重新加载。
    data.transportCountryOverlayState = normalizeTransportCountryOverlayProjectState(data.transportCountryOverlayState);
    data.exportWorkbenchUi = normalizeExportWorkbenchUiState(data.exportWorkbenchUi);
    data.manualSpecialZones = { type: "FeatureCollection", features: [] };
    data.annotationView = normalizeAnnotationView(data.annotationView);
    data.operationalLines = normalizeOperationalLines(data.operationalLines);
    data.operationGraphics = normalizeOperationGraphics(data.operationGraphics);
    data.unitCounters = normalizeUnitCounters(data.unitCounters);
    if (!data.layerVisibility || typeof data.layerVisibility !== "object") {
      data.layerVisibility = {};
    }
    // `scenario` 是项目文件和当前场景资产之间的桥。
    // 这里只保留可稳定序列化的识别信息，把运行时派生态留给后续 scenario apply 重新建立。
    if (!data.scenario || typeof data.scenario !== "object") {
      data.scenario = null;
    } else {
      data.scenario = {
        id: String(data.scenario.id || "").trim(),
        version: Number(data.scenario.version || 1) || 1,
        baselineHash: String(data.scenario.baselineHash || "").trim(),
        viewMode: String(data.scenario.viewMode || "ownership").trim().toLowerCase() === "frontline"
          ? "frontline"
          : "ownership",
        importAudit: normalizeScenarioImportAudit(data.scenario.importAudit, {
          scenarioId: data.scenario.id,
          savedVersion: data.scenario.version,
          currentVersion: data.scenario.version,
          currentBaselineHash: data.scenario.baselineHash,
        }),
      };
      if (!data.scenario.id) {
        data.scenario = null;
      }
    }
    data.exportHandoff = data.exportHandoff && typeof data.exportHandoff === "object"
      ? buildExportArtifactManifest({
        artifactKind: data.exportHandoff.artifactKind || "project-json",
        generatedAt: data.exportHandoff.generatedAt || new Date().toISOString(),
        scenario: data.scenario,
        project: data.exportHandoff.project && typeof data.exportHandoff.project === "object"
          ? {
            schemaVersion: Number(data.exportHandoff.project.schemaVersion || data.schemaVersion || 21) || 21,
            timestamp: Number(data.exportHandoff.project.timestamp || data.timestamp || 0) || 0,
          }
          : {
            schemaVersion: Number(data.schemaVersion || 21) || 21,
            timestamp: Number(data.timestamp || 0) || 0,
          },
        exportUi: data.exportWorkbenchUi,
        files: Array.isArray(data.exportHandoff.files) ? data.exportHandoff.files : [],
      })
      : null;
    data.releasableBoundaryVariantByTag = normalizeBoundaryVariantSelectionMap(data.releasableBoundaryVariantByTag);
    if (!data.transportWorkbenchUi || typeof data.transportWorkbenchUi !== "object") {
      data.transportWorkbenchUi = null;
    }
    if (!data.exportWorkbenchUi || typeof data.exportWorkbenchUi !== "object") {
      data.exportWorkbenchUi = null;
    }
    const openOceanVisibility = normalizeOpenOceanLayerVisibility(data.layerVisibility);
    commitUiVisibilityState(data.layerVisibility, {
      showWaterRegions:
        data.layerVisibility.showWaterRegions === undefined ? true : !!data.layerVisibility.showWaterRegions,
      ...openOceanVisibility,
      showScenarioSpecialRegions:
        data.layerVisibility.showScenarioSpecialRegions === undefined
          ? true
          : !!data.layerVisibility.showScenarioSpecialRegions,
      showScenarioAtlantropa:
        data.layerVisibility.showScenarioAtlantropa === undefined
          ? true
          : !!data.layerVisibility.showScenarioAtlantropa,
      showScenarioReliefOverlays:
        data.layerVisibility.showScenarioReliefOverlays === undefined
          ? true
          : !!data.layerVisibility.showScenarioReliefOverlays,
      showCityPoints:
        data.layerVisibility.showCityPoints === undefined ? true : !!data.layerVisibility.showCityPoints,
      showStrategicResourceMarkers:
        data.layerVisibility.showStrategicResourceMarkers === undefined
          ? false
          : !!data.layerVisibility.showStrategicResourceMarkers,
      strategicChoroplethMetric: String(data.layerVisibility.strategicChoroplethMetric || ""),
      showUrban: data.layerVisibility.showUrban === undefined ? true : !!data.layerVisibility.showUrban,
      showPhysical:
        data.layerVisibility.showPhysical === undefined ? true : !!data.layerVisibility.showPhysical,
      showRivers: data.layerVisibility.showRivers === undefined ? true : !!data.layerVisibility.showRivers,
      showTransport:
        data.layerVisibility.showTransport === undefined ? true : !!data.layerVisibility.showTransport,
      showSpecialZones:
        data.layerVisibility.showSpecialZones === undefined ? false : !!data.layerVisibility.showSpecialZones,
    });
    normalizeTransportOverviewLayerVisibility(data.layerVisibility);
    return data;
  }

  static async importProjectText(text, callback, observers = {}, options = {}) {
    const { notifySuccess, notifyError } = resolveProjectImportObservers(observers);
    try {
      const data = FileManager.normalizeImportedProjectData(JSON.parse(String(text || "")));
      if (typeof callback === "function") {
        // callback 负责把归一化后的项目状态真正接到运行时；
        // 只有 callback 完整成功，才把这次导入视为成功并清掉 dirty / 弹成功提示。
        await callback(data);
      }
      clearDirty("project-import");
      showToast(t(options.successMessage || "Project file loaded successfully.", "ui"), {
        title: t(options.successTitle || "Project imported", "ui"),
        tone: "success",
      });
      notifyProjectImportObserver(notifySuccess, data, "success");
      return true;
    } catch (error) {
      console.error("Failed to import project:", error);
      showProjectImportFailure(error);
      notifyProjectImportObserver(notifyError, error, "error");
      return false;
    }
  }

  static importProject(file, callback, observers = {}, options = {}) {
    if (!file) return false;
    const { notifyError } = resolveProjectImportObservers(observers);
    const reader = new FileReader();

    return prepareProjectImportFile(file)
      .then(({ file: importFile }) => new Promise((resolve) => {
        reader.onload = async () => {
          const text = typeof reader.result === "string" ? reader.result : "";
          resolve(await FileManager.importProjectText(text, callback, observers, options));
        };
        reader.onerror = () => {
          console.error("Failed to read project file:", reader.error);
          showProjectReadFailure(reader.error);
          notifyProjectImportObserver(notifyError, reader.error, "read-error");
          resolve(false);
        };
        reader.readAsText(importFile);
      }))
      .catch((error) => {
        console.error("Failed to read project package:", error);
        showProjectReadFailure(error);
        notifyProjectImportObserver(notifyError, error, "read-error");
        return false;
      });
  }
}

export { FileManager };
