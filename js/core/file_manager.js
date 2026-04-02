// Project file manager (Phase 13)
import {
  normalizeAnnotationView,
  normalizeCityLayerStyleConfig,
  normalizeDayNightStyleConfig,
  normalizeLakeStyleConfig,
  normalizeMapSemanticMode,
  normalizePhysicalStyleConfig,
  normalizeUrbanStyleConfig,
  normalizeTransportWorkbenchUiState,
  normalizeTextureStyleConfig,
} from "./state.js";
import { t } from "../ui/i18n.js";
import { showToast } from "../ui/toast.js";
import { migrateImportedProjectData } from "./sovereignty_manager.js";
import { clearDirty } from "./dirty_state.js";

const LEGACY_BOUNDARY_VARIANT_ALIASES = {
  legacy_approx: "historical_reference",
};
const DEFAULT_ACTIVE_PALETTE_ID = "hoi4_vanilla";
const MAX_SAVED_RECENT_COLORS = 10;
const DEFAULT_REFERENCE_IMAGE_STATE = Object.freeze({
  opacity: 0.6,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeProjectHexColor(value) {
  const candidate = String(value || "").trim();
  if (/^#(?:[0-9a-f]{6})$/i.test(candidate)) return candidate.toLowerCase();
  if (/^#(?:[0-9a-f]{3})$/i.test(candidate)) {
    return `#${candidate[1]}${candidate[1]}${candidate[2]}${candidate[2]}${candidate[3]}${candidate[3]}`.toLowerCase();
  }
  return "";
}

function normalizeReferenceImageState(rawState) {
  const state = rawState && typeof rawState === "object" ? rawState : {};
  return {
    opacity: clamp(
      Number.isFinite(Number(state.opacity)) ? Number(state.opacity) : DEFAULT_REFERENCE_IMAGE_STATE.opacity,
      0,
      1
    ),
    scale: clamp(
      Number.isFinite(Number(state.scale)) ? Number(state.scale) : DEFAULT_REFERENCE_IMAGE_STATE.scale,
      0.2,
      3
    ),
    offsetX: clamp(
      Number.isFinite(Number(state.offsetX)) ? Number(state.offsetX) : DEFAULT_REFERENCE_IMAGE_STATE.offsetX,
      -1000,
      1000
    ),
    offsetY: clamp(
      Number.isFinite(Number(state.offsetY)) ? Number(state.offsetY) : DEFAULT_REFERENCE_IMAGE_STATE.offsetY,
      -1000,
      1000
    ),
  };
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

function normalizeOperationGraphics(rawGraphics) {
  if (!Array.isArray(rawGraphics)) return [];
  return rawGraphics
    .map((entry, index) => {
      const raw = entry && typeof entry === "object" ? entry : {};
      const kind = String(raw.kind || "attack").trim().toLowerCase();
      const points = Array.isArray(raw.points)
        ? raw.points.map((point) => normalizeProjectCoordinatePair(point)).filter(Boolean)
        : [];
      if (!["attack", "retreat", "supply", "naval", "encirclement", "theater"].includes(kind)) return null;
      if (points.length < (kind === "encirclement" || kind === "theater" ? 3 : 2)) return null;
      const stroke = normalizeProjectHexColor(raw.stroke) || null;
      return {
        id: String(raw.id || `opg_${index + 1}`).trim() || `opg_${index + 1}`,
        kind,
        label: String(raw.label || "").trim(),
        points,
        stylePreset: String(raw.stylePreset || kind).trim() || kind,
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
      const kind = String(raw.kind || "frontline").trim().toLowerCase();
      const points = Array.isArray(raw.points)
        ? raw.points.map((point) => normalizeProjectCoordinatePair(point)).filter(Boolean)
        : [];
      if (!["frontline", "offensive_line", "spearhead_line", "defensive_line"].includes(kind)) return null;
      if (points.length < 2) return null;
      const stroke = normalizeProjectHexColor(raw.stroke) || null;
      const attachedCounterIds = Array.isArray(raw.attachedCounterIds)
        ? raw.attachedCounterIds.map((value) => String(value || "").trim()).filter(Boolean)
        : [];
      return {
        id: String(raw.id || `opl_${index + 1}`).trim() || `opl_${index + 1}`,
        kind,
        label: String(raw.label || "").trim(),
        points,
        stylePreset: String(raw.stylePreset || kind).trim().toLowerCase() || kind,
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
      const sidc = String(raw.sidc || raw.symbolCode || raw.templateId || "").trim().toUpperCase();
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
  static exportProject(appState) {
    if (!appState) return;
    const payload = {
      schemaVersion: 19,
      countryBaseColors: appState.sovereignBaseColors || appState.countryBaseColors || {},
      featureOverrides: appState.visualOverrides || appState.featureOverrides || {},
      sovereignBaseColors: appState.sovereignBaseColors || appState.countryBaseColors || {},
      visualOverrides: appState.visualOverrides || appState.featureOverrides || {},
      waterRegionOverrides: appState.waterRegionOverrides || {},
      specialRegionOverrides: appState.specialRegionOverrides || {},
      sovereigntyByFeatureId: appState.sovereigntyByFeatureId || {},
      scenarioControllersByFeatureId: appState.scenarioControllersByFeatureId || {},
      mapSemanticMode: normalizeMapSemanticMode(appState.mapSemanticMode),
      paintMode: appState.paintMode || "visual",
      interactionGranularity: normalizeInteractionGranularity(appState.interactionGranularity),
      batchFillScope: normalizeBatchFillScope(appState.batchFillScope),
      activeSovereignCode: appState.activeSovereignCode || "",
      activePaletteId: normalizeActivePaletteId(appState.activePaletteId),
      dynamicBordersDirty: !!appState.dynamicBordersDirty,
      dynamicBordersDirtyReason: appState.dynamicBordersDirtyReason || "",
      specialZones: appState.specialZones || {},
      parentBordersVisible: appState.parentBordersVisible !== false,
      parentBorderEnabledByCountry: appState.parentBorderEnabledByCountry || {},
      manualSpecialZones: appState.manualSpecialZones || { type: "FeatureCollection", features: [] },
      annotationView: normalizeAnnotationView(appState.annotationView),
      operationalLines: normalizeOperationalLines(appState.operationalLines),
      operationGraphics: normalizeOperationGraphics(appState.operationGraphics),
      unitCounters: normalizeUnitCounters(appState.unitCounters),
      customPresets: appState.customPresets || {},
      referenceImageState: normalizeReferenceImageState(appState.referenceImageState),
      recentColors: normalizeRecentColors(appState.recentColors),
      layerVisibility: {
        showWaterRegions: appState.showWaterRegions === undefined ? true : !!appState.showWaterRegions,
        showOpenOceanRegions: !!appState.showOpenOceanRegions,
        showScenarioSpecialRegions:
          appState.showScenarioSpecialRegions === undefined ? true : !!appState.showScenarioSpecialRegions,
        showScenarioReliefOverlays:
          appState.showScenarioReliefOverlays === undefined ? true : !!appState.showScenarioReliefOverlays,
        showCityPoints: appState.showCityPoints === undefined ? true : !!appState.showCityPoints,
        showUrban: !!appState.showUrban,
        showPhysical: !!appState.showPhysical,
        showRivers: !!appState.showRivers,
        showAirports: !!appState.showAirports,
        showPorts: !!appState.showPorts,
        showSpecialZones: !!appState.showSpecialZones,
      },
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
        rivers: appState.styleConfig?.rivers || null,
        specialZones: appState.styleConfig?.specialZones || null,
        texture: normalizeTextureStyleConfig(appState.styleConfig?.texture),
        dayNight: normalizeDayNightStyleConfig(appState.styleConfig?.dayNight),
      },
      transportWorkbenchUi: normalizeTransportWorkbenchUiState(appState.transportWorkbenchUi),
      scenario: appState.activeScenarioId
        ? {
          id: appState.activeScenarioId,
          version: appState.activeScenarioManifest?.version || 1,
          baselineHash: appState.scenarioBaselineHash || "",
          viewMode: String(appState.scenarioViewMode || "ownership"),
          importAudit: normalizeScenarioImportAudit(appState.scenarioImportAudit, {
            scenarioId: appState.activeScenarioId,
            savedVersion: appState.activeScenarioManifest?.version || 1,
            currentVersion: appState.activeScenarioManifest?.version || 1,
            currentBaselineHash: appState.scenarioBaselineHash || "",
          }),
        }
        : null,
      releasableBoundaryVariantByTag: normalizeBoundaryVariantSelectionMap(appState.releasableBoundaryVariantByTag),
      timestamp: Date.now(),
    };

    const data = JSON.stringify(payload, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = "map_project.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 100);
    showToast(t("Project file downloaded.", "ui"), {
      title: t("Project saved", "ui"),
      tone: "success",
    });
    clearDirty("project-export");
  }

  static importProject(file, callback) {
    if (!file) return;
    const reader = new FileReader();

    reader.onload = async () => {
      try {
        const text = typeof reader.result === "string" ? reader.result : "";
        let data = JSON.parse(text);
        if (!data || typeof data !== "object") {
          throw new Error("Invalid project file");
        }
        data = migrateImportedProjectData(data);

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
        if (!data.specialRegionOverrides || typeof data.specialRegionOverrides !== "object") {
          data.specialRegionOverrides = {};
        }
        if (!data.sovereignBaseColors || typeof data.sovereignBaseColors !== "object") {
          data.sovereignBaseColors = data.countryBaseColors;
        }
        if (!data.sovereigntyByFeatureId || typeof data.sovereigntyByFeatureId !== "object") {
          data.sovereigntyByFeatureId = {};
        }
        if (!data.scenarioControllersByFeatureId || typeof data.scenarioControllersByFeatureId !== "object") {
          data.scenarioControllersByFeatureId = null;
        } else {
          data.scenarioControllersByFeatureId = { ...data.scenarioControllersByFeatureId };
        }
        data.mapSemanticMode = normalizeMapSemanticMode(data.mapSemanticMode);
        data.interactionGranularity = normalizeInteractionGranularity(data.interactionGranularity);
        data.batchFillScope = normalizeBatchFillScope(data.batchFillScope);
        data.activePaletteId = normalizeActivePaletteId(data.activePaletteId);
        data.dynamicBordersDirty = !!data.dynamicBordersDirty;
        data.dynamicBordersDirtyReason = String(data.dynamicBordersDirtyReason || "");
        if (!data.customPresets || typeof data.customPresets !== "object") {
          data.customPresets = {};
        }
        data.referenceImageState = normalizeReferenceImageState(data.referenceImageState);
        data.recentColors = normalizeRecentColors(data.recentColors);
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
        if (!data.styleConfig.rivers || typeof data.styleConfig.rivers !== "object") {
          data.styleConfig.rivers = null;
        }
        if (!data.styleConfig.specialZones || typeof data.styleConfig.specialZones !== "object") {
          data.styleConfig.specialZones = null;
        }
        data.styleConfig.texture = normalizeTextureStyleConfig(data.styleConfig.texture);
        data.styleConfig.dayNight = normalizeDayNightStyleConfig(data.styleConfig.dayNight);
        data.transportWorkbenchUi = normalizeTransportWorkbenchUiState(data.transportWorkbenchUi);
        if (
          !data.manualSpecialZones ||
          typeof data.manualSpecialZones !== "object" ||
          data.manualSpecialZones.type !== "FeatureCollection" ||
          !Array.isArray(data.manualSpecialZones.features)
        ) {
          data.manualSpecialZones = { type: "FeatureCollection", features: [] };
        }
        data.annotationView = normalizeAnnotationView(data.annotationView);
        data.operationalLines = normalizeOperationalLines(data.operationalLines);
        data.operationGraphics = normalizeOperationGraphics(data.operationGraphics);
        data.unitCounters = normalizeUnitCounters(data.unitCounters);
        if (!data.layerVisibility || typeof data.layerVisibility !== "object") {
          data.layerVisibility = {};
        }
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
        data.releasableBoundaryVariantByTag = normalizeBoundaryVariantSelectionMap(data.releasableBoundaryVariantByTag);
        if (!data.transportWorkbenchUi || typeof data.transportWorkbenchUi !== "object") {
          data.transportWorkbenchUi = null;
        }
        data.layerVisibility.showWaterRegions =
          data.layerVisibility.showWaterRegions === undefined ? true : !!data.layerVisibility.showWaterRegions;
        data.layerVisibility.showOpenOceanRegions =
          data.layerVisibility.showOpenOceanRegions === undefined ? false : !!data.layerVisibility.showOpenOceanRegions;
        data.layerVisibility.showScenarioSpecialRegions =
          data.layerVisibility.showScenarioSpecialRegions === undefined
            ? true
            : !!data.layerVisibility.showScenarioSpecialRegions;
        data.layerVisibility.showScenarioReliefOverlays =
          data.layerVisibility.showScenarioReliefOverlays === undefined
            ? true
            : !!data.layerVisibility.showScenarioReliefOverlays;
        data.layerVisibility.showCityPoints =
          data.layerVisibility.showCityPoints === undefined ? true : !!data.layerVisibility.showCityPoints;
        data.layerVisibility.showUrban =
          data.layerVisibility.showUrban === undefined ? true : !!data.layerVisibility.showUrban;
        data.layerVisibility.showPhysical =
          data.layerVisibility.showPhysical === undefined ? true : !!data.layerVisibility.showPhysical;
        data.layerVisibility.showRivers =
          data.layerVisibility.showRivers === undefined ? true : !!data.layerVisibility.showRivers;
        data.layerVisibility.showAirports =
          data.layerVisibility.showAirports === undefined ? false : !!data.layerVisibility.showAirports;
        data.layerVisibility.showPorts =
          data.layerVisibility.showPorts === undefined ? false : !!data.layerVisibility.showPorts;
        data.layerVisibility.showSpecialZones =
          data.layerVisibility.showSpecialZones === undefined
            ? false
            : !!data.layerVisibility.showSpecialZones;

        if (typeof callback === "function") {
          await callback(data);
        }
        clearDirty("project-import");
        showToast(t("Project file loaded successfully.", "ui"), {
          title: t("Project imported", "ui"),
          tone: "success",
        });
      } catch (error) {
        console.error("Failed to import project:", error);
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
    };

    reader.onerror = () => {
      console.error("Failed to read project file:", reader.error);
      showToast(t("Unable to read the selected file.", "ui"), {
        title: t("Import failed", "ui"),
        tone: "error",
        duration: 4200,
      });
    };

    reader.readAsText(file);
  }
}

export { FileManager };
