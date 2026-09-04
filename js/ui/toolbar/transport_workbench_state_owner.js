// Transport workbench state owner.
// Owns workbench-local UI state normalization and mutation helpers.

import {
  createDefaultTransportWorkbenchDisplayConfig,
  TRANSPORT_WORKBENCH_EDIT_OVERLAY_FAMILY_IDS,
  normalizeTransportWorkbenchDisplayConfig,
  normalizeTransportWorkbenchPointDeltas,
  normalizeTransportWorkbenchUiState,
} from "../../core/state.js";
import {
  commitTransportWorkbenchPointDeltasState,
  commitTransportWorkbenchUiState,
  ensureTransportWorkbenchUiState,
} from "../../core/state/actions/transport_actions.js";
import {
  getDefaultTransportWorkbenchPackIdForFamily,
  getTransportWorkbenchPackMeta,
} from "../../core/transport_pack_resolver.js";
import {
  TRANSPORT_WORKBENCH_FAMILIES,
  TRANSPORT_WORKBENCH_DENSITY_FAMILY_IDS,
  TRANSPORT_WORKBENCH_BASELINE_CONFIGS,
  TRANSPORT_WORKBENCH_SECTION_DEFAULTS,
} from "./transport_workbench_descriptor.js";
import {
  TRANSPORT_WORKBENCH_RUNTIME_FAMILY_IDS,
  mapTransportWorkbenchMaxLevelToLabelLevel,
  normalizeAirportTransportWorkbenchConfig,
  normalizeEnergyFacilityTransportWorkbenchConfig,
  normalizeIndustrialTransportWorkbenchConfig,
  normalizeLogisticsHubTransportWorkbenchConfig,
  normalizeMineralResourceTransportWorkbenchConfig,
  normalizePortTransportWorkbenchConfig,
  normalizeRailTransportWorkbenchConfig,
  normalizeRoadTransportWorkbenchConfig,
  normalizeTransportWorkbenchFamily,
  normalizeTransportWorkbenchInspectorTab,
  normalizeTransportWorkbenchLayerOrder,
} from "./transport_workbench_config_owner.js";

const clonePlainObject = (value) => JSON.parse(JSON.stringify(value || {}));
const EDIT_OVERLAY_FAMILY_IDS = new Set(TRANSPORT_WORKBENCH_EDIT_OVERLAY_FAMILY_IDS);
const isEditOverlayCoordinate = (lon, lat) => (
  Number.isFinite(lon)
  && Number.isFinite(lat)
  && lon >= -180
  && lon <= 180
  && lat >= -90
  && lat <= 90
);

function normalizeTransportWorkbenchFamilyConfig(familyId, value) {
  if (familyId === "road") return normalizeRoadTransportWorkbenchConfig(value);
  if (familyId === "rail") return normalizeRailTransportWorkbenchConfig(value);
  if (familyId === "airport") return normalizeAirportTransportWorkbenchConfig(value);
  if (familyId === "port") return normalizePortTransportWorkbenchConfig(value);
  if (familyId === "mineral_resources") return normalizeMineralResourceTransportWorkbenchConfig(value);
  if (familyId === "energy_facilities") return normalizeEnergyFacilityTransportWorkbenchConfig(value);
  if (familyId === "industrial_zones") return normalizeIndustrialTransportWorkbenchConfig(value);
  if (familyId === "logistics_hubs") return normalizeLogisticsHubTransportWorkbenchConfig(value);
  return value && typeof value === "object" ? { ...value } : {};
}

function resolveTransportWorkbenchPackIdForFamily(uiState, familyId) {
  // activePackIdByFamily 是长期真相源；activePackId 只保留给旧调用方和当前激活 family 的便捷读取。
  // 解析时先吃 family-scoped 状态，避免切换 tab 后把别的 family pack 误投到当前预览。
  const candidatePackId = String(
    uiState?.activePackIdByFamily?.[familyId] || uiState?.activePackId || ""
  ).trim().toLowerCase();
  const candidatePackMeta = getTransportWorkbenchPackMeta(candidatePackId);
  if (candidatePackMeta?.family === familyId) return candidatePackMeta.packId;
  return getDefaultTransportWorkbenchPackIdForFamily(familyId);
}

function writeTransportWorkbenchFamilyConfig(uiState, familyId, config) {
  uiState.familyConfigs[familyId] = normalizeTransportWorkbenchFamilyConfig(familyId, config);
  return uiState.familyConfigs[familyId];
}

export function createTransportWorkbenchStateOwner(runtimeState) {
  const ensureUiState = () => {
    const previousUiState = ensureTransportWorkbenchUiState(runtimeState);
    const previousLayerOrder = Array.isArray(previousUiState?.layerOrder)
      ? [...previousUiState.layerOrder]
      : null;
    const normalizedUiState = normalizeTransportWorkbenchUiState(previousUiState);
    const uiState = normalizedUiState;
    uiState.open = !!uiState.open;
    uiState.activeFamily = normalizeTransportWorkbenchFamily(uiState.activeFamily);
    if (!uiState.activePackIdByFamily || typeof uiState.activePackIdByFamily !== "object") {
      uiState.activePackIdByFamily = {};
    }
    const activePackId = resolveTransportWorkbenchPackIdForFamily(uiState, uiState.activeFamily);
    uiState.activePackId = activePackId;
    uiState.activePackIdByFamily[uiState.activeFamily] = activePackId;
    const activePackMeta = getTransportWorkbenchPackMeta(activePackId);
    if (activePackMeta?.country) uiState.sampleCountry = activePackMeta.country;
    if (!uiState.previewCamera || typeof uiState.previewCamera !== "object") {
      uiState.previewCamera = {};
    }
    uiState.previewCamera.scale = Number(uiState.previewCamera.scale) || 1;
    uiState.previewCamera.translateX = Number(uiState.previewCamera.translateX) || 0;
    uiState.previewCamera.translateY = Number(uiState.previewCamera.translateY) || 0;
    delete uiState.compareHeld;
    uiState.activeInspectorTab = normalizeTransportWorkbenchInspectorTab(uiState.activeInspectorTab);
    uiState.layerOrder = normalizeTransportWorkbenchLayerOrder(previousLayerOrder || uiState.layerOrder);
    if (!uiState.familyConfigs || typeof uiState.familyConfigs !== "object") {
      uiState.familyConfigs = {};
    }
    if (!uiState.displayConfigs || typeof uiState.displayConfigs !== "object") {
      uiState.displayConfigs = {};
    }
    commitTransportWorkbenchPointDeltasState(
      runtimeState,
      runtimeState.transportWorkbenchPointDeltas,
    );
    TRANSPORT_WORKBENCH_RUNTIME_FAMILY_IDS.forEach((familyId) => {
      uiState.familyConfigs[familyId] = normalizeTransportWorkbenchFamilyConfig(familyId, uiState.familyConfigs[familyId]);
      uiState.displayConfigs[familyId] = normalizeTransportWorkbenchDisplayConfig(
        uiState.displayConfigs[familyId],
        familyId
      );
    });
    if (!uiState.sectionOpen || typeof uiState.sectionOpen !== "object") {
      uiState.sectionOpen = {};
    }
    TRANSPORT_WORKBENCH_RUNTIME_FAMILY_IDS.forEach((familyId) => {
      const defaults = TRANSPORT_WORKBENCH_SECTION_DEFAULTS[familyId];
      const source = uiState.sectionOpen[familyId] && typeof uiState.sectionOpen[familyId] === "object"
        ? uiState.sectionOpen[familyId]
        : {};
      uiState.sectionOpen[familyId] = Object.fromEntries(
        Object.entries(defaults).map(([sectionKey, defaultValue]) => [
          sectionKey,
          source[sectionKey] !== undefined ? !!source[sectionKey] : defaultValue,
        ])
      );
    });
    uiState.shellPhase = "road-live-preview";
    uiState.restoreLeftDrawer = !!uiState.restoreLeftDrawer;
    uiState.restoreRightDrawer = !!uiState.restoreRightDrawer;
    return commitTransportWorkbenchUiState(runtimeState, uiState);
  };

  const getFamilyMeta = () => {
    const uiState = ensureUiState();
    const activeFamily = normalizeTransportWorkbenchFamily(uiState.activeFamily);
    return TRANSPORT_WORKBENCH_FAMILIES.find((family) => family.id === activeFamily) || TRANSPORT_WORKBENCH_FAMILIES[0];
  };

  const getWorkingConfig = (familyId, { baseline = false } = {}) => {
    const uiState = ensureUiState();
    if (baseline) {
      return TRANSPORT_WORKBENCH_BASELINE_CONFIGS[familyId]
        ? clonePlainObject(TRANSPORT_WORKBENCH_BASELINE_CONFIGS[familyId])
        : null;
    }
    return uiState.familyConfigs?.[familyId] || null;
  };

  const getDisplayConfig = (familyId, { baseline = false } = {}) => {
    const uiState = ensureUiState();
    if (!TRANSPORT_WORKBENCH_DENSITY_FAMILY_IDS.has(familyId) || baseline) {
      return createDefaultTransportWorkbenchDisplayConfig(familyId);
    }
    return normalizeTransportWorkbenchDisplayConfig(uiState.displayConfigs?.[familyId], familyId);
  };

  const buildResolvedConfig = (familyId, familyConfig, displayConfig, activePackId) => {
    const uiState = ensureUiState();
    const pointDeltas = normalizeTransportWorkbenchPointDeltas(runtimeState.transportWorkbenchPointDeltas);
    const familyDeltas = pointDeltas.byFamily?.[familyId] || {};
    const editOverlay = {
      created: familyDeltas.created || [],
      updated: familyDeltas.updated || [],
      deleted: familyDeltas.deleted || [],
      features: familyDeltas.created || [],
    };
    if (!TRANSPORT_WORKBENCH_DENSITY_FAMILY_IDS.has(familyId)) {
      return { ...(familyConfig || {}), activePackId, editOverlay };
    }
    // density family 既要保留嵌套 displayConfig 供持久化/回显，
    // 也要展开出 preview renderer 直接消费的平铺字段，避免下游每次再手动解包。
    const resolvedDisplayConfig = normalizeTransportWorkbenchDisplayConfig(displayConfig, familyId);
    return {
      ...(familyConfig || {}),
      activePackId,
      editOverlay,
      displayConfig: resolvedDisplayConfig,
      displayMode: resolvedDisplayConfig.mode,
      displayPreset: resolvedDisplayConfig.preset,
      aggregationAlgorithm: resolvedDisplayConfig.aggregation.algorithm,
      aggregationAutoSwitch: !!resolvedDisplayConfig.aggregation.autoSwitch,
      aggregationCellSizePx: Number(resolvedDisplayConfig.aggregation.thresholds?.cellSizePx || 44),
      aggregationClusterRadiusPx: Number(resolvedDisplayConfig.aggregation.thresholds?.clusterRadiusPx || 48),
      labelBudget: Number(resolvedDisplayConfig.labels?.budget || 8),
      labelSeparation: Number(resolvedDisplayConfig.labels?.separationStrength || 1),
      labelLevel: mapTransportWorkbenchMaxLevelToLabelLevel(resolvedDisplayConfig.labels?.maxLevel),
      labelAllowAggregation: !!resolvedDisplayConfig.labels?.allowAggregation,
      dominantCategoryThreshold: Number(resolvedDisplayConfig.labels?.dominantCategoryThreshold || 0.62),
      mixedCategoryMode: resolvedDisplayConfig.labels?.mixedCategoryMode || "summary",
      coverageTier: resolvedDisplayConfig.coverage || "default",
    };
  };

  const resetSectionState = () => {
    const uiState = clonePlainObject(ensureUiState());
    uiState.sectionOpen = Object.fromEntries(
      TRANSPORT_WORKBENCH_RUNTIME_FAMILY_IDS.map((familyId) => [
        familyId,
        { ...TRANSPORT_WORKBENCH_SECTION_DEFAULTS[familyId] },
      ])
    );
    return commitTransportWorkbenchUiState(runtimeState, uiState).sectionOpen;
  };

  const updateFamilyConfig = (familyId, key, nextValue, { appendValue = null } = {}) => {
    const uiState = clonePlainObject(ensureUiState());
    const family = TRANSPORT_WORKBENCH_FAMILIES.find((entry) => entry.id === familyId);
    if (!family?.supportsDetailedControls) return false;
    const current = clonePlainObject(uiState.familyConfigs?.[familyId] || {});
    if (appendValue !== null) {
      const currentValues = Array.isArray(current[key]) ? [...current[key]] : [];
      const index = currentValues.indexOf(appendValue);
      if (nextValue) {
        if (index === -1) currentValues.push(appendValue);
      } else if (index !== -1) {
        currentValues.splice(index, 1);
      }
      current[key] = currentValues;
    } else {
      current[key] = nextValue;
    }
    writeTransportWorkbenchFamilyConfig(uiState, familyId, current);
    commitTransportWorkbenchUiState(runtimeState, uiState);
    return true;
  };

  const updateDisplayConfig = (familyId, updateFn) => {
    const uiState = clonePlainObject(ensureUiState());
    if (!TRANSPORT_WORKBENCH_DENSITY_FAMILY_IDS.has(familyId) || typeof updateFn !== "function") return false;
    const draft = clonePlainObject(uiState.displayConfigs?.[familyId]);
    updateFn(draft);
    uiState.displayConfigs[familyId] = normalizeTransportWorkbenchDisplayConfig(draft, familyId);
    commitTransportWorkbenchUiState(runtimeState, uiState);
    return true;
  };

  const toggleSection = (familyId, sectionKey, nextOpen) => {
    const uiState = clonePlainObject(ensureUiState());
    if (!uiState.sectionOpen[familyId]) {
      uiState.sectionOpen[familyId] = {};
    }
    uiState.sectionOpen[familyId][sectionKey] = !!nextOpen;
    const committed = commitTransportWorkbenchUiState(runtimeState, uiState);
    return committed.sectionOpen[familyId][sectionKey];
  };

  const setActivePackId = (packId) => {
    const uiState = clonePlainObject(ensureUiState());
    const normalizedPackId = String(packId || "").trim().toLowerCase();
    const meta = getTransportWorkbenchPackMeta(normalizedPackId);
    if (!meta) return null;
    uiState.activeFamily = meta.family;
    if (!uiState.activePackIdByFamily || typeof uiState.activePackIdByFamily !== "object") {
      uiState.activePackIdByFamily = {};
    }
    uiState.activePackIdByFamily[meta.family] = meta.packId;
    uiState.activePackId = meta.packId;
    uiState.sampleCountry = meta.country;
    commitTransportWorkbenchUiState(runtimeState, uiState);
    return meta;
  };

  const setActiveFamily = (familyId) => {
    const uiState = clonePlainObject(ensureUiState());
    const activeFamily = normalizeTransportWorkbenchFamily(familyId || "road");
    uiState.activeFamily = activeFamily;
    const activePackId = resolveTransportWorkbenchPackIdForFamily(uiState, activeFamily);
    uiState.activePackId = activePackId;
    if (!uiState.activePackIdByFamily || typeof uiState.activePackIdByFamily !== "object") {
      uiState.activePackIdByFamily = {};
    }
    uiState.activePackIdByFamily[activeFamily] = activePackId;
    const activePackMeta = getTransportWorkbenchPackMeta(activePackId);
    if (activePackMeta?.country) uiState.sampleCountry = activePackMeta.country;
    commitTransportWorkbenchUiState(runtimeState, uiState);
    return activeFamily;
  };

  const setInspectorTab = (tabId) => {
    const uiState = clonePlainObject(ensureUiState());
    uiState.activeInspectorTab = normalizeTransportWorkbenchInspectorTab(tabId || "inspect");
    return commitTransportWorkbenchUiState(runtimeState, uiState).activeInspectorTab;
  };

  const prepareOpenState = ({ restoreLeftDrawer = false, restoreRightDrawer = false } = {}) => {
    const uiState = clonePlainObject(ensureUiState());
    uiState.restoreLeftDrawer = !!restoreLeftDrawer;
    uiState.restoreRightDrawer = !!restoreRightDrawer;
    return commitTransportWorkbenchUiState(runtimeState, uiState);
  };

  const setOpenState = (nextOpen) => {
    const uiState = clonePlainObject(ensureUiState());
    uiState.open = !!nextOpen;
    return commitTransportWorkbenchUiState(runtimeState, uiState);
  };

  const prepareCloseState = () => {
    const uiState = clonePlainObject(ensureUiState());
    const restoreState = {
      restoreLeftDrawer: !!uiState.restoreLeftDrawer,
      restoreRightDrawer: !!uiState.restoreRightDrawer,
    };
    uiState.restoreLeftDrawer = false;
    uiState.restoreRightDrawer = false;
    commitTransportWorkbenchUiState(runtimeState, uiState);
    return restoreState;
  };

  const moveLayerOrder = (draggedFamilyId, targetFamilyId) => {
    const uiState = clonePlainObject(ensureUiState());
    const draggedId = normalizeTransportWorkbenchFamily(draggedFamilyId);
    const targetId = normalizeTransportWorkbenchFamily(targetFamilyId);
    if (!draggedId || draggedId === targetId) return false;
    const nextOrder = [...uiState.layerOrder];
    const draggedIndex = nextOrder.indexOf(draggedId);
    const targetIndex = nextOrder.indexOf(targetId);
    if (draggedIndex === -1 || targetIndex === -1) return false;
    nextOrder.splice(draggedIndex, 1);
    nextOrder.splice(targetIndex, 0, draggedId);
    uiState.layerOrder = normalizeTransportWorkbenchLayerOrder(nextOrder);
    commitTransportWorkbenchUiState(runtimeState, uiState);
    return true;
  };

  const getEditOverlay = (familyId) => {
    const normalizedFamilyId = normalizeTransportWorkbenchFamily(familyId);
    const pointDeltas = normalizeTransportWorkbenchPointDeltas(runtimeState.transportWorkbenchPointDeltas);
    const familyDeltas = pointDeltas.byFamily?.[normalizedFamilyId] || {};
    return {
      features: familyDeltas.created || [],
      created: familyDeltas.created || [],
      updated: familyDeltas.updated || [],
      deleted: familyDeltas.deleted || [],
    };
  };

  const addEditOverlayPoint = (familyId, point = {}, { createId = null } = {}) => {
    const uiState = ensureUiState();
    const normalizedFamilyId = normalizeTransportWorkbenchFamily(familyId);
    if (!EDIT_OVERLAY_FAMILY_IDS.has(normalizedFamilyId)) return null;
    const lon = Number(point.lon);
    const lat = Number(point.lat);
    if (!isEditOverlayCoordinate(lon, lat)) return null;
    const pointDeltas = normalizeTransportWorkbenchPointDeltas(runtimeState.transportWorkbenchPointDeltas);
    const familyDeltas = pointDeltas.byFamily[normalizedFamilyId];
    const features = Array.isArray(familyDeltas?.created)
      ? [...familyDeltas.created]
      : [];
    const packId = resolveTransportWorkbenchPackIdForFamily(uiState, normalizedFamilyId);
    const fallbackId = typeof createId === "function"
      ? createId(normalizedFamilyId, features.length + 1)
      : `${normalizedFamilyId}_edit_${Date.now().toString(36)}_${features.length + 1}`;
    const nextFeature = {
      id: String(point.id || fallbackId).trim(),
      family: normalizedFamilyId,
      packId,
      name: String(point.name || "").trim(),
      lon,
      lat,
      properties: point.properties && typeof point.properties === "object" ? { ...point.properties } : {},
    };
    features.push(nextFeature);
    pointDeltas.byFamily[normalizedFamilyId] = {
      ...familyDeltas,
      created: features,
      revision: Number(familyDeltas.revision || 0) + 1,
      sourcePackId: packId,
      updatedAt: new Date().toISOString(),
    };
    const committed = commitTransportWorkbenchPointDeltasState(runtimeState, pointDeltas);
    return committed.byFamily[normalizedFamilyId].created
      .find((feature) => feature.id === nextFeature.id) || null;
  };

  const updateEditOverlayPoint = (familyId, featureId, point = {}) => {
    const uiState = ensureUiState();
    const normalizedFamilyId = normalizeTransportWorkbenchFamily(familyId);
    const normalizedFeatureId = String(featureId || point.id || "").trim();
    if (!EDIT_OVERLAY_FAMILY_IDS.has(normalizedFamilyId) || !normalizedFeatureId) return null;
    const lon = Number(point.lon);
    const lat = Number(point.lat);
    if (!isEditOverlayCoordinate(lon, lat)) return null;
    const pointDeltas = normalizeTransportWorkbenchPointDeltas(runtimeState.transportWorkbenchPointDeltas);
    const familyDeltas = pointDeltas.byFamily[normalizedFamilyId];
    const packId = resolveTransportWorkbenchPackIdForFamily(uiState, normalizedFamilyId);
    const created = Array.isArray(familyDeltas?.created) ? [...familyDeltas.created] : [];
    const createdIndex = created.findIndex((feature) => feature.id === normalizedFeatureId);
    const existingUpdate = Array.isArray(familyDeltas?.updated)
      ? familyDeltas.updated.find((feature) => feature.id === normalizedFeatureId)
      : null;
    const existingFeature = createdIndex !== -1 ? created[createdIndex] : existingUpdate;
    const nextProperties = point.properties && typeof point.properties === "object"
      ? { ...point.properties }
      : { ...((existingFeature?.properties && typeof existingFeature.properties === "object") ? existingFeature.properties : {}) };
    const nextFeature = {
      id: normalizedFeatureId,
      family: normalizedFamilyId,
      packId,
      name: String(point.name ?? existingFeature?.name ?? "").trim(),
      lon,
      lat,
      properties: nextProperties,
    };
    if (createdIndex !== -1) {
      created[createdIndex] = { ...created[createdIndex], ...nextFeature };
    }
    const updated = Array.isArray(familyDeltas?.updated)
      ? familyDeltas.updated.filter((feature) => feature.id !== normalizedFeatureId)
      : [];
    if (createdIndex === -1) {
      updated.push(nextFeature);
    }
    const deleted = Array.isArray(familyDeltas?.deleted)
      ? familyDeltas.deleted.filter((id) => id !== normalizedFeatureId)
      : [];
    pointDeltas.byFamily[normalizedFamilyId] = {
      ...familyDeltas,
      created,
      updated,
      deleted,
      revision: Number(familyDeltas.revision || 0) + 1,
      sourcePackId: packId,
      updatedAt: new Date().toISOString(),
    };
    const committed = commitTransportWorkbenchPointDeltasState(runtimeState, pointDeltas);
    const nextFamilyDeltas = committed.byFamily[normalizedFamilyId];
    return [...(nextFamilyDeltas.created || []), ...(nextFamilyDeltas.updated || [])]
      .find((feature) => feature.id === normalizedFeatureId) || null;
  };

  const removeEditOverlayPoint = (familyId, featureId) => {
    const uiState = ensureUiState();
    const normalizedFamilyId = normalizeTransportWorkbenchFamily(familyId);
    if (!EDIT_OVERLAY_FAMILY_IDS.has(normalizedFamilyId)) return false;
    const pointDeltas = normalizeTransportWorkbenchPointDeltas(runtimeState.transportWorkbenchPointDeltas);
    const familyDeltas = pointDeltas.byFamily[normalizedFamilyId];
    const features = Array.isArray(familyDeltas?.created)
      ? familyDeltas.created
      : [];
    const normalizedFeatureId = String(featureId || "").trim();
    const nextFeatures = features.filter((feature) => feature.id !== normalizedFeatureId);
    if (nextFeatures.length === features.length) return false;
    pointDeltas.byFamily[normalizedFamilyId] = {
      ...familyDeltas,
      created: nextFeatures,
      revision: Number(familyDeltas.revision || 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    commitTransportWorkbenchPointDeltasState(runtimeState, pointDeltas);
    return true;
  };

  const deleteEditOverlayPoint = (familyId, featureId) => {
    const uiState = ensureUiState();
    const normalizedFamilyId = normalizeTransportWorkbenchFamily(familyId);
    const normalizedFeatureId = String(featureId || "").trim();
    if (!EDIT_OVERLAY_FAMILY_IDS.has(normalizedFamilyId) || !normalizedFeatureId) return false;
    const pointDeltas = normalizeTransportWorkbenchPointDeltas(runtimeState.transportWorkbenchPointDeltas);
    const familyDeltas = pointDeltas.byFamily[normalizedFamilyId];
    const created = Array.isArray(familyDeltas?.created)
      ? familyDeltas.created.filter((feature) => feature.id !== normalizedFeatureId)
      : [];
    const updated = Array.isArray(familyDeltas?.updated)
      ? familyDeltas.updated.filter((feature) => feature.id !== normalizedFeatureId)
      : [];
    const deleted = new Set(Array.isArray(familyDeltas?.deleted) ? familyDeltas.deleted : []);
    if ((familyDeltas?.created || []).some((feature) => feature.id === normalizedFeatureId)) {
      deleted.delete(normalizedFeatureId);
    } else {
      deleted.add(normalizedFeatureId);
    }
    pointDeltas.byFamily[normalizedFamilyId] = {
      ...familyDeltas,
      created,
      updated,
      deleted: Array.from(deleted),
      revision: Number(familyDeltas.revision || 0) + 1,
      sourcePackId: resolveTransportWorkbenchPackIdForFamily(uiState, normalizedFamilyId),
      updatedAt: new Date().toISOString(),
    };
    commitTransportWorkbenchPointDeltasState(runtimeState, pointDeltas);
    return true;
  };

  return {
    buildResolvedConfig,
    ensureUiState,
    getDisplayConfig,
    getEditOverlay,
    getFamilyMeta,
    getWorkingConfig,
    moveLayerOrder,
    prepareCloseState,
    prepareOpenState,
    resetSectionState,
    addEditOverlayPoint,
    deleteEditOverlayPoint,
    removeEditOverlayPoint,
    setActiveFamily,
    setActivePackId,
    setInspectorTab,
    setOpenState,
    toggleSection,
    updateDisplayConfig,
    updateEditOverlayPoint,
    updateFamilyConfig,
  };
}
