import { applyFeaturePaintState } from "../core/state/color_state.js";
import { getMapDataBoundary } from "../core/map_data_boundary.js";
import { isOwnershipEditingEnabled, normalizePaintMode, ownershipEditingDisabledResult } from "../core/map_editing_policy.js";
import { getEffectiveScenarioHierarchy } from "../core/scenario_hierarchy.js";
// Sidebar UI (Phase 13)
import {
  state as runtimeState,
  countryNames,
  defaultCountryPalette,
  normalizeCityLayerStyleConfig,
  normalizeAnnotationView,
} from "../core/state.js";
import { callRuntimeHook, registerRuntimeHook } from "../core/state/index.js";
import { ensureSidebarPerfState } from "../core/state/renderer_runtime_state.js";
import { ColorManager } from "../core/color_manager.js";
import {
  cancelActiveStrategicInteractionModes,
  cancelOperationGraphicDraw,
  cancelOperationalLineDraw,
  cancelUnitCounterPlacement,
  deleteSelectedOperationGraphic,
  deleteSelectedOperationGraphicVertex,
  deleteSelectedOperationalLine,
  deleteSelectedUnitCounter,
  finishOperationGraphicDraw,
  finishOperationalLineDraw,
  getWaterRegionColor,
  refreshColorState,
  refreshResolvedColorsForFeatures,
  renderLegend,
  scheduleDynamicBorderRecompute,
  selectOperationGraphicById,
  selectOperationalLineById,
  selectUnitCounterById,
  setDebugMode,
  setInspectorFeatureHighlight,
  startOperationGraphicDraw,
  startOperationalLineDraw,
  startUnitCounterPlacement,
  undoOperationGraphicVertex,
  undoOperationalLineVertex,
  updateSelectedOperationGraphic,
  updateSelectedOperationalLine,
  updateSelectedUnitCounter,
} from "../core/map_renderer/public.js";
import { applyCountryColor, resetCountryColors } from "../core/logic.js";
import {
  buildPaletteColorSuggestionsForCountry,
  ensurePaletteAssetsLoaded,
} from "../core/palette_manager.js";
import { FileManager } from "../core/file_manager.js";
import { canUndoHistory, captureHistoryState, pushHistoryEntry, undoHistory } from "../core/history_manager.js";
import { LegendManager } from "../core/legend_manager.js";
import {
  ensureActiveScenarioOptionalLayerLoaded,
  loadScenarioAuditPayload,
  releaseScenarioAuditPayload,
} from "../core/scenario_resources.js";
import { refreshScenarioShellOverlays } from "../core/scenario_shell_overlay.js";
import { getGeoFeatureDisplayLabel, t } from "./i18n.js";
import { showToast } from "./toast.js";
import { showAppDialog } from "./app_dialog.js";
import { initDevWorkspace } from "./dev_workspace.js";
import { UI_URL_STATE_KEYS } from "./ui_contract.js";
import { createCountryInspectorModel } from "./sidebar/country_inspector_model.js";
import { createScenarioTerritoryController } from "./sidebar/scenario_territory_controller.js";
import { createScenarioInspectorController } from "./sidebar/scenario_inspector_controller.js";
import { createScenarioTransferController } from "./sidebar/scenario_transfer_controller.js";
import { createRegionalPresetController } from "./sidebar/regional_preset_controller.js";
import { createCountryInspectorController } from "./sidebar/country_inspector_controller.js";
import { createStrategicOverlayController } from "./sidebar/strategic_overlay_controller.js";
import { createWaterSpecialRegionController } from "./sidebar/water_special_region_controller.js";
import { createProjectSupportDiagnosticsController } from "./sidebar/project_support_diagnostics_controller.js";
import { importProjectThroughFunnel } from "../core/interaction_funnel.js";
import { flushRenderBoundary } from "../core/render_boundary.js";
import {
  getFeatureOwnerCode,
  setFeatureOwnerCodes,
  markLegacyColorStateDirty,
} from "../core/sovereignty_manager.js";
import { getCountryCode as getSharedFeatureCountryCode } from "../core/feature_identity.js";
import { markDirty } from "../core/dirty_state.js";
import {
  getResolvedReleasableBoundaryVariant,
  normalizeCountryCode,
  normalizePresetName,
  resolveCompanionActionFeatureIds,
  resolveFeatureIdsFromPresetSource,
  rebuildPresetState,
  setReleasableBoundaryVariant,
} from "../core/releasable_manager.js";
import { getScenarioCountryDisplayName } from "../core/scenario_country_display.js";
import { createHgoIdentityResolver } from "../core/hgo_identity_resolver.js";
import { resolveDataAssetUrl } from "../core/runtime_asset_registry.js";
import {
  DEFAULT_UNIT_COUNTER_PRESET_ID,
  getUnitCounterCatalogCategories,
  getUnitCounterCategoryLabel,
  getUnitCounterIconPathById,
  getUnitCounterPresetById,
  UNIT_COUNTER_ECHELONS,
  UNIT_COUNTER_PRESETS,
} from "../core/unit_counter_presets.js";

const state = runtimeState;
const {
  getScenarioCountryMeta,
  resolveScenarioInspectorGroupMeta,
  resolveScenarioLookupCode,
  resolveInspectorDataCode,
  resolveCountryGroupingCode,
  getCountryGroupingMeta,
} = createCountryInspectorModel(runtimeState, t);

function requestHgoIdentityAssetsForSettings(settings, loadAssets) {
  if (settings?.enabled === true && typeof loadAssets === "function") {
    loadAssets();
  }
}

// Batch 5: sidebar controllers consume a curated renderer helper surface so
// renderer API drift stays visible in one place instead of hiding in namespace imports.
const mapRenderer = Object.freeze({
  cancelActiveStrategicInteractionModes,
  cancelOperationGraphicDraw,
  cancelOperationalLineDraw,
  cancelUnitCounterPlacement,
  deleteSelectedOperationGraphic,
  deleteSelectedOperationGraphicVertex,
  deleteSelectedOperationalLine,
  deleteSelectedUnitCounter,
  finishOperationGraphicDraw,
  finishOperationalLineDraw,
  getWaterRegionColor,
  refreshColorState,
  renderLegend,
  selectOperationGraphicById,
  selectOperationalLineById,
  selectUnitCounterById,
  setDebugMode,
  startOperationGraphicDraw,
  startOperationalLineDraw,
  startUnitCounterPlacement,
  undoOperationGraphicVertex,
  undoOperationalLineVertex,
  updateSelectedOperationGraphic,
  updateSelectedOperationalLine,
  updateSelectedUnitCounter,
});

function flushSidebarRender(reason = "") {
  return flushRenderBoundary(reason);
}

async function loadRuntimeJsonAsset(assetKey) {
  const url = resolveDataAssetUrl(assetKey);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`[hgo_identity] Failed to load ${assetKey}: ${response.status}`);
  }
  return response.json();
}

function extractCountryCodeFromId(value) {
  const text = String(value || "").trim().toUpperCase();
  if (!text) return "";
  const prefix = text.split(/[-_]/)[0];
  if (/^[A-Z]{2,3}$/.test(prefix)) {
    return normalizeCountryCode(prefix);
  }
  const alphaPrefix = prefix.match(/^[A-Z]{2,3}/);
  return normalizeCountryCode(alphaPrefix ? alphaPrefix[0] : "");
}

function getCountryCodeFromProps(props = {}, fallbackId = "") {
  return normalizeCountryCode(
    getSharedFeatureCountryCode(
      {
        id: fallbackId,
        properties: props,
      },
      { useIdFallback: true },
    )
  );
}

function isScenarioShellLikeFeature(feature, featureId = "") {
  const candidate = String(feature?.properties?.id || feature?.id || featureId || "").trim().toUpperCase();
  if (!candidate) return false;
  if (candidate.includes("_FB_")) return true;
  return String(feature?.properties?.name || "").toLowerCase().includes("shell fallback");
}

function getScenarioInteractionLockMessage() {
  const baseMessage = t("Scenario state is inconsistent. Reload the page before continuing.", "ui");
  const detail = String(runtimeState.scenarioFatalRecovery?.message || "").trim();
  return detail ? `${baseMessage} ${detail}` : baseMessage;
}

function blockLockedScenarioInteraction() {
  if (!runtimeState.activeScenarioId || !runtimeState.scenarioFatalRecovery) return false;
  showToast(getScenarioInteractionLockMessage(), {
    title: t("Scenario locked", "ui"),
    tone: "error",
    duration: 5200,
  });
  return true;
}

function isAntarcticSectorLikeFeature(feature, featureId = "") {
  const candidate = String(feature?.properties?.id || feature?.id || featureId || "").trim().toUpperCase();
  if (!candidate) return false;
  const detailTier = String(feature?.properties?.detail_tier || "").trim().toLowerCase();
  if (detailTier !== "antarctic_sector") return false;
  const countryCode = getCountryCodeFromProps(feature?.properties || {}, candidate);
  return countryCode === "AQ" || candidate.startsWith("AQ_");
}

function shouldExcludeScenarioPoliticalFeature(feature, featureId = "") {
  return isScenarioShellLikeFeature(feature, featureId) || isAntarcticSectorLikeFeature(feature, featureId);
}

function getCountryNameFromProps(props = {}) {
  const candidate = getGeoFeatureDisplayLabel({ properties: props }) || (
    props.name_en ||
    props.name ||
    props.NAME_EN ||
    props.NAME ||
    props.admin ||
    props.ADMIN ||
    ""
  );
  return String(candidate || "").trim();
}

function collectCountryNameByCode() {
  const nameByCode = new Map();

  const primaryGeometries = runtimeState.topologyPrimary?.objects?.political?.geometries;
  if (Array.isArray(primaryGeometries)) {
    primaryGeometries.forEach((geometry) => {
      const props = geometry?.properties || {};
      const code = getCountryCodeFromProps(props, geometry?.id);
      if (!code || nameByCode.has(code)) return;
      const name = getCountryNameFromProps(props);
      if (name) {
        nameByCode.set(code, name);
      }
    });
  }

  if (Array.isArray(runtimeState.landData?.features)) {
    runtimeState.landData.features.forEach((feature) => {
      const props = feature?.properties || {};
      const code = getCountryCodeFromProps(props, feature?.id);
      if (!code || nameByCode.has(code)) return;
      const name = getCountryNameFromProps(props);
      if (name) {
        nameByCode.set(code, name);
      }
    });
  }

  return nameByCode;
}

function getDynamicCountryEntries() {
  const resolveScenarioCountryFeatureCount = (entry = {}) => {
    const ownerFeatureCount = Number(entry?.feature_count ?? entry?.featureCount ?? 0) || 0;
    return ownerFeatureCount;
  };

  if (runtimeState.activeScenarioId && runtimeState.scenarioCountriesByTag && typeof runtimeState.scenarioCountriesByTag === "object") {
    const scenarioEntries = Object.entries(runtimeState.scenarioCountriesByTag)
      .map(([rawCode, scenarioCountry]) => {
        const code = normalizeCountryCode(rawCode);
        if (!code) return null;
        const name = getScenarioCountryDisplayName(scenarioCountry, runtimeState.countryNames?.[code] || code) || code;
        const displayName = t(name, "geo") || name || code;
        const ownerFeatureCount = Number(scenarioCountry?.feature_count || 0) || 0;
        const controllerFeatureCount = Number(scenarioCountry?.controller_feature_count || 0) || 0;
        return {
          code,
          name,
          displayName,
          featureCount: resolveScenarioCountryFeatureCount(scenarioCountry),
          ownerFeatureCount,
          controllerFeatureCount,
          quality: String(scenarioCountry?.quality || "").trim(),
          baseIso2: String(scenarioCountry?.base_iso2 || "").trim().toUpperCase(),
          lookupIso2: String(
            scenarioCountry?.lookup_iso2
            || scenarioCountry?.release_lookup_iso2
            || scenarioCountry?.base_iso2
            || ""
          ).trim().toUpperCase(),
          releaseLookupIso2: String(scenarioCountry?.release_lookup_iso2 || "").trim().toUpperCase(),
          scenarioOnly: !!scenarioCountry?.scenario_only,
          releasable: !!scenarioCountry?.releasable || String(scenarioCountry?.entry_kind || "").trim() === "releasable",
          scenarioSubject: String(scenarioCountry?.entry_kind || "").trim() === "scenario_subject",
          entryKind: String(scenarioCountry?.entry_kind || "").trim(),
          subjectKind: String(scenarioCountry?.subject_kind || "").trim().toLowerCase(),
          presetLookupCode: String(scenarioCountry?.preset_lookup_code || "").trim().toUpperCase(),
          parentOwnerTag: String(scenarioCountry?.parent_owner_tag || "").trim().toUpperCase(),
          parentOwnerTags: Array.isArray(scenarioCountry?.parent_owner_tags)
            ? scenarioCountry.parent_owner_tags.map((value) => String(value || "").trim().toUpperCase()).filter(Boolean)
            : [],
          continentId: String(scenarioCountry?.continent_id || "").trim(),
          continentLabel: String(scenarioCountry?.continent_label || "").trim(),
          subregionId: String(scenarioCountry?.subregion_id || "").trim(),
          subregionLabel: String(scenarioCountry?.subregion_label || "").trim(),
          inspector_group_id: String(scenarioCountry?.inspector_group_id || "").trim(),
          inspector_group_label: String(scenarioCountry?.inspector_group_label || "").trim(),
          inspector_group_anchor_id: String(scenarioCountry?.inspector_group_anchor_id || "").trim(),
          syntheticOwner: !!scenarioCountry?.synthetic_owner,
          hiddenFromCountryList: !!scenarioCountry?.hidden_from_country_list,
          featured: !!scenarioCountry?.featured,
          catalogOrder: Number(scenarioCountry?.catalog_order ?? Number.MAX_SAFE_INTEGER),
        };
      })
      .filter(Boolean);
    return scenarioEntries.sort((a, b) => {
      const getRank = (entry) => {
        if (entry?.releasable) return 2;
        if (entry?.scenarioOnly) return 1;
        return 0;
      };
      const rankDelta = getRank(a) - getRank(b);
      if (rankDelta !== 0) return rankDelta;
      if ((b.featureCount || 0) !== (a.featureCount || 0)) return (b.featureCount || 0) - (a.featureCount || 0);
      return a.displayName.localeCompare(b.displayName);
    });
  }

  const codes = new Set();

  if (runtimeState.countryToFeatureIds instanceof Map && runtimeState.countryToFeatureIds.size > 0) {
    runtimeState.countryToFeatureIds.forEach((_ids, rawCode) => {
      const code = normalizeCountryCode(rawCode);
      if (code) codes.add(code);
    });
  } else if (Array.isArray(runtimeState.landData?.features)) {
    runtimeState.landData.features.forEach((feature) => {
      const code = getCountryCodeFromProps(feature?.properties || {}, feature?.id);
      if (code) codes.add(code);
    });
  }

  if (!codes.size) {
    Object.keys(countryNames || {}).forEach((rawCode) => {
      const code = normalizeCountryCode(rawCode);
      if (code) codes.add(code);
    });
  }

  const nameByCode = collectCountryNameByCode();
  return Array.from(codes)
    .map((code) => {
      const name = nameByCode.get(code) || runtimeState.countryNames?.[code] || countryNames[code] || code;
      const displayName = t(name, "geo") || code;
      return { code, name, displayName };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function ensureCountryPaletteColor(code, fallbackIndex = 0) {
  const normalizedCode = normalizeCountryCode(code);
  if (!normalizedCode) return "#cccccc";

  const existing = runtimeState.countryPalette?.[normalizedCode] || defaultCountryPalette[normalizedCode];
  if (existing) {
    runtimeState.countryPalette[normalizedCode] = existing;
    return existing;
  }

  const generated =
    ColorManager.getPoliticalFallbackColor(normalizedCode, fallbackIndex) || "#cccccc";
  runtimeState.countryPalette[normalizedCode] = generated;
  return generated;
}

export function getHierarchyGroupsForCode(code) {
  const normalizedCode = normalizeCountryCode(code);
  if (!normalizedCode) return [];
  const hierarchy = getEffectiveScenarioHierarchy(runtimeState);
  if (hierarchy === runtimeState.hierarchyData && runtimeState.hierarchyGroupsByCode.size > 0) {
    return runtimeState.hierarchyGroupsByCode.get(normalizedCode) || [];
  }
  if (!hierarchy?.groups) return [];
  const labels = hierarchy.labels || {};
  const groups = [];
  Object.entries(hierarchy.groups).forEach(([groupId, children]) => {
    if (!groupId.startsWith(`${normalizedCode}_`)) return;
    const label = labels[groupId] || groupId.replace(`${normalizedCode}_`, "").replace(/_/g, " ");
    groups.push({
      id: groupId,
      label,
      children: Array.isArray(children) ? children : [],
    });
  });
  groups.sort((a, b) => a.label.localeCompare(b.label));
  return groups;
}

function normalizeActionMode(mode = "auto") {
  if (mode === "ownership" || mode === "visual") return mode;
  return normalizePaintMode(runtimeState.paintMode);
}

function applyVisualOverridesToFeatureIds(
  targetIds = [],
  color,
  {
    render,
    historyKind = "feature-apply-color",
    dirtyReason = "feature-apply-color",
    addToRecent = true,
  } = {}
) {
  const normalizedTargetIds = Array.from(new Set((targetIds || []).map((id) => String(id || "").trim()).filter(Boolean)));
  if (!normalizedTargetIds.length) {
    return {
      applied: false,
      changed: 0,
      matchedCount: 0,
      requestedCount: 0,
      missingCount: 0,
      reason: "empty-target",
      mode: "visual",
    };
  }

  const colorToApply = color || runtimeState.selectedColor;
  const before = captureHistoryState({
    featureIds: normalizedTargetIds,
  });
  applyFeaturePaintState(runtimeState, normalizedTargetIds, colorToApply);
  markLegacyColorStateDirty();
  refreshResolvedColorsForFeatures(normalizedTargetIds, { renderNow: false });
  if (render) render();
  if (addToRecent) {
    addRecentColor(colorToApply);
  }
  markDirty(dirtyReason);
  pushHistoryEntry({
    kind: historyKind,
    before,
    after: captureHistoryState({
      featureIds: normalizedTargetIds,
    }),
    meta: {
      affectsSovereignty: false,
    },
  });
  return {
    applied: true,
    changed: normalizedTargetIds.length,
    matchedCount: normalizedTargetIds.length,
    requestedCount: normalizedTargetIds.length,
    missingCount: 0,
    reason: "",
    mode: "visual",
  };
}

function clearVisualOverridesForFeatureIds(
  targetIds = [],
  {
    render,
    historyKind = "feature-clear-color",
    dirtyReason = "feature-clear-color",
  } = {}
) {
  const normalizedTargetIds = Array.from(new Set((targetIds || []).map((id) => String(id || "").trim()).filter(Boolean)));
  if (!normalizedTargetIds.length) {
    return {
      applied: false,
      changed: 0,
      matchedCount: 0,
      requestedCount: 0,
      missingCount: 0,
      reason: "empty-target",
      mode: "visual",
    };
  }

  const changedIds = normalizedTargetIds.filter((id) => (
    Object.prototype.hasOwnProperty.call(runtimeState.visualOverrides || {}, id)
    || Object.prototype.hasOwnProperty.call(runtimeState.featureOverrides || {}, id)
  ));
  if (!changedIds.length) {
    return {
      applied: true,
      changed: 0,
      matchedCount: normalizedTargetIds.length,
      requestedCount: normalizedTargetIds.length,
      missingCount: 0,
      reason: "",
      mode: "visual",
    };
  }

  const before = captureHistoryState({
    featureIds: changedIds,
  });
  applyFeaturePaintState(runtimeState, changedIds, null, { remove: true });
  markLegacyColorStateDirty();
  refreshResolvedColorsForFeatures(changedIds, { renderNow: false });
  if (render) render();
  markDirty(dirtyReason);
  pushHistoryEntry({
    kind: historyKind,
    before,
    after: captureHistoryState({
      featureIds: changedIds,
    }),
    meta: {
      affectsSovereignty: false,
    },
  });
  return {
    applied: true,
    changed: changedIds.length,
    matchedCount: normalizedTargetIds.length,
    requestedCount: normalizedTargetIds.length,
    missingCount: 0,
    reason: "",
    mode: "visual",
  };
}

function applyOwnershipToFeatureIds(
  targetIds = [],
  ownerCode,
  {
    render,
    historyKind = "feature-apply-ownership",
    dirtyReason = "feature-apply-ownership",
    recomputeReason = "sidebar-ownership-batch",
  } = {}
) {
  if (!isOwnershipEditingEnabled()) return ownershipEditingDisabledResult(Array.isArray(targetIds) ? targetIds.length : 0);
  if (blockLockedScenarioInteraction()) {
    return {
      applied: false,
      changed: 0,
      matchedCount: 0,
      requestedCount: 0,
      missingCount: 0,
      reason: "scenario-locked",
      mode: "ownership",
    };
  }
  const {
    requestedIds,
    matchedIds: normalizedTargetIds,
    missingIds,
  } = filterToVisibleFeatureIds(targetIds);
  const normalizedOwnerCode = normalizeCountryCode(ownerCode);
  if (!normalizedTargetIds.length) {
    return {
      applied: false,
      changed: 0,
      matchedCount: 0,
      requestedCount: requestedIds.length,
      missingCount: missingIds.length,
      reason: "empty-target",
      mode: "ownership",
    };
  }
  if (!normalizedOwnerCode) {
    return {
      applied: false,
      changed: 0,
      matchedCount: normalizedTargetIds.length,
      requestedCount: requestedIds.length,
      missingCount: missingIds.length,
      reason: "missing-active-owner",
      mode: "ownership",
    };
  }

  const before = captureHistoryState({
    sovereigntyFeatureIds: normalizedTargetIds,
  });
  // ownership 写入不是单纯改颜色：
  // 它会触发 sovereignty、边界和历史记录三条链，所以这里先过滤可见 feature，再按批次提交。
  const changed = setFeatureOwnerCodes(normalizedTargetIds, normalizedOwnerCode);
  if (changed > 0) {
    refreshResolvedColorsForFeatures(normalizedTargetIds, { renderNow: false });
    scheduleDynamicBorderRecompute(recomputeReason, 90);
    markDirty(dirtyReason);
    pushHistoryEntry({
      kind: historyKind,
      before,
      after: captureHistoryState({
        sovereigntyFeatureIds: normalizedTargetIds,
      }),
      meta: {
        affectsSovereignty: true,
      },
    });
  }
  if (render) render();
  return {
    applied: true,
    changed,
    matchedCount: normalizedTargetIds.length,
    requestedCount: requestedIds.length,
    missingCount: missingIds.length,
    reason: "",
    mode: "ownership",
  };
}

function applyScenarioOwnerControllerAssignments(
  assignmentsByFeatureId = {},
  {
    render,
    historyKind = "scenario-owner-controller-apply",
    dirtyReason = "scenario-owner-controller-apply",
    recomputeReason = "scenario-owner-controller-apply",
  } = {}
) {
  if (!isOwnershipEditingEnabled()) return ownershipEditingDisabledResult(Object.keys(assignmentsByFeatureId || {}).length);
  if (blockLockedScenarioInteraction()) {
    return {
      applied: false,
      changed: 0,
      matchedCount: 0,
      requestedCount: 0,
      missingCount: 0,
      reason: "scenario-locked",
      mode: "ownership",
    };
  }
  const entries = Object.entries(assignmentsByFeatureId || {})
    .map(([featureId, assignment]) => {
      const normalizedId = String(featureId || "").trim();
      if (!normalizedId || !assignment || typeof assignment !== "object") return null;
      const ownerCode = normalizeCountryCode(assignment.ownerCode);
      const controllerCode = normalizeCountryCode(assignment.controllerCode || assignment.ownerCode);
      if (!ownerCode || !controllerCode) return null;
      return {
        featureId: normalizedId,
        ownerCode,
        controllerCode,
      };
    })
    .filter(Boolean);

  if (!entries.length) {
    return {
      applied: false,
      changed: 0,
      matchedCount: 0,
      requestedCount: 0,
      missingCount: 0,
      reason: "empty-target",
      mode: "ownership",
    };
  }

  const targetIds = entries.map((entry) => entry.featureId);
  const before = captureHistoryState({
    sovereigntyFeatureIds: targetIds,
  });

  // 这是 sidebar 内的批量 ownership 入口；视觉覆盖不要走到这里，
  // 否则颜色预览会变成真实政治状态修改。
  // owner/controller 拆成两个按 code 聚合的批次，是为了尽量复用下层批量写口，
  // 同时只对真正变动的 feature 触发颜色刷新、边界重算和 history 快照。
  const ownerFeatureIdsByCode = new Map();
  const changedFeatureIds = new Set();

  entries.forEach(({ featureId, ownerCode }) => {
    const currentOwnerCode = normalizeCountryCode(runtimeState.sovereigntyByFeatureId?.[featureId]);
    if (currentOwnerCode !== ownerCode) {
      if (!ownerFeatureIdsByCode.has(ownerCode)) {
        ownerFeatureIdsByCode.set(ownerCode, []);
      }
      ownerFeatureIdsByCode.get(ownerCode).push(featureId);
      changedFeatureIds.add(featureId);
    }
  });

  let ownerChanged = 0;
  ownerFeatureIdsByCode.forEach((featureIds, ownerCode) => {
    ownerChanged += setFeatureOwnerCodes(featureIds, ownerCode);
  });
  if (changedFeatureIds.size) {
    refreshResolvedColorsForFeatures(Array.from(changedFeatureIds), { renderNow: false });
    scheduleDynamicBorderRecompute(recomputeReason, 90);
    markDirty(dirtyReason);
    pushHistoryEntry({
      kind: historyKind,
      before,
      after: captureHistoryState({
        sovereigntyFeatureIds: targetIds,
      }),
      meta: {
        affectsSovereignty: true,
      },
    });
  }
  if (render) render();
  return {
    applied: true,
    changed: changedFeatureIds.size,
    matchedCount: targetIds.length,
    requestedCount: targetIds.length,
    missingCount: 0,
    reason: "",
    mode: "ownership",
  };
}

function applyHierarchyGroupWithMode(
  group,
  {
    mode = "auto",
    color,
    ownerCode,
    render,
    ownershipHistoryKind = "hierarchy-apply-sovereignty",
    ownershipDirtyReason = "hierarchy-apply-sovereignty",
    visualHistoryKind = "hierarchy-apply-color",
    visualDirtyReason = "hierarchy-apply-color",
  } = {}
) {
  if (!group || !group.children) {
    return {
      applied: false,
      changed: 0,
      matchedCount: 0,
      requestedCount: 0,
      missingCount: 0,
      reason: "missing-group",
      mode: normalizeActionMode(mode),
    };
  }
  const targetIds = Array.isArray(group.children)
    ? Array.from(new Set(group.children.map((id) => String(id || "").trim()).filter(Boolean)))
    : [];
  previewHierarchyGroupHighlight(group, targetIds);
  const resolvedMode = normalizeActionMode(mode);
  if (resolvedMode === "ownership") {
    return applyOwnershipToFeatureIds(targetIds, ownerCode || runtimeState.activeSovereignCode, {
      render,
      historyKind: ownershipHistoryKind,
      dirtyReason: ownershipDirtyReason,
      recomputeReason: "sidebar-hierarchy-batch",
    });
  }
  return applyVisualOverridesToFeatureIds(targetIds, color || runtimeState.selectedColor, {
    render,
    historyKind: visualHistoryKind,
    dirtyReason: visualDirtyReason,
  });
}

function applyHierarchyGroup(group, color, render) {
  return applyHierarchyGroupWithMode(group, {
    mode: "auto",
    color,
    render,
  });
}

function previewHierarchyGroupHighlight(group, featureIds = []) {
  const { matchedIds } = filterToVisibleFeatureIds(featureIds);
  setInspectorFeatureHighlight(matchedIds, {
    groupMode: true,
    label: t(group?.label || "Hierarchy group", "geo") || group?.label || "Hierarchy group",
  });
}

function addRecentColor(color) {
  if (!color) return;
  runtimeState.recentColors = runtimeState.recentColors.filter((value) => value !== color);
  runtimeState.recentColors.unshift(color);
  if (runtimeState.recentColors.length > 10) {
    runtimeState.recentColors = runtimeState.recentColors.slice(0, 10);
  }
  callRuntimeHook(state, "updateRecentUI");
}

function filterToVisibleFeatureIds(featureIds = []) {
  const requestedIds = Array.isArray(featureIds)
    ? Array.from(new Set(featureIds.map((id) => String(id || "").trim()).filter(Boolean)))
    : [];
  if (!requestedIds.length) {
    return {
      requestedIds: [],
      matchedIds: [],
      missingIds: [],
    };
  }
  const landIndex = runtimeState.landIndex instanceof Map ? runtimeState.landIndex : null;
  if (!landIndex || landIndex.size === 0) {
    return {
      requestedIds,
      matchedIds: requestedIds,
      missingIds: [],
    };
  }
  const matchedIds = [];
  const missingIds = [];
  requestedIds.forEach((id) => {
    const feature = landIndex.get(id);
    if (feature && !shouldExcludeScenarioPoliticalFeature(feature, id)) {
      matchedIds.push(id);
      return;
    }
    missingIds.push(id);
  });
  return {
    requestedIds,
    matchedIds,
    missingIds,
  };
}

function getOwnedVisibleFeatureIds(ownerCode) {
  const normalizedOwnerCode = normalizeCountryCode(ownerCode);
  if (!normalizedOwnerCode) {
    return {
      requestedIds: [],
      matchedIds: [],
      missingIds: [],
    };
  }

  const reference = getMapDataBoundary(runtimeState).reference;
  const requestedIds = runtimeState.activeScenarioId
    ? reference.getScenarioGroupFeatureIds(normalizedOwnerCode)
    : reference.getGeographicCountryFeatureIds(normalizedOwnerCode);

  return filterToVisibleFeatureIds(requestedIds);
}

function initSidebar({ render } = {}) {
  const list = document.getElementById("countryList");
  if (!list) return;
  // sidebar.js 仍然是右侧工作区的总装壳层：
  // 负责建宿主 DOM、接 runtime hooks、编排多个子 controller，
  // 具体的国家检查器、战略面板、水域面板等细节则下沉到 owner 文件。
  const presetTree = document.getElementById("presetTree");
  const searchInput = document.getElementById("countrySearch");
  const resetBtn = document.getElementById("resetCountryColors");
  const leftSidebar = document.getElementById("leftSidebar");
  const leftSidebarContent = document.getElementById("leftSidebarContent");
  const leftSidebarCollapseBtn = document.getElementById("leftSidebarCollapseBtn");
  const leftSidebarCollapseIcon = document.getElementById("leftSidebarCollapseIcon");
  const sidebar = document.getElementById("rightSidebar");
  const rightSidebarContent = document.getElementById("rightSidebarContent");
  const rightSidebarCollapseBtn = document.getElementById("rightSidebarCollapseBtn");
  const rightSidebarCollapseIcon = document.getElementById("rightSidebarCollapseIcon");
  const projectManagementStack = document.getElementById("projectManagementStack")
    || document.getElementById("projectLegendStack");
  const legendEditorStack = document.getElementById("legendEditorStack")
    || projectManagementStack;
  const diagnosticStack = document.getElementById("diagnosticStack");

  const frontlineTabStack = document.getElementById("frontlineTabStack");
  const buildRow = () => {
    const row = document.createElement("div");
    row.className = "mt-2 flex flex-wrap items-center gap-2";
    return row;
  };
  const buildSelect = (id, options) => {
    const select = document.createElement("select");
    select.id = id;
    select.className = "select-input";
    options.forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = t(label, "ui");
      select.appendChild(option);
    });
    return select;
  };
  const buildButton = (id, label, variant = "btn-secondary") => {
    const button = document.createElement("button");
    button.id = id;
    button.type = "button";
    button.className = variant;
    button.textContent = t(label, "ui");
    return button;
  };
  const buildInput = (id, placeholder, type = "text") => {
    const input = document.createElement("input");
    input.id = id;
    input.type = type;
    input.className = "input";
    if (placeholder) {
      input.placeholder = t(placeholder, "ui");
    }
    return input;
  };
  const buildCheckboxLabel = (id, label, className) => {
    const shell = document.createElement("label");
    shell.className = className;
    const input = document.createElement("input");
    input.id = id;
    input.type = "checkbox";
    input.className = "checkbox-input";
    const text = document.createElement("span");
    text.textContent = t(label, "ui");
    shell.append(input, text);
    return shell;
  };
  const buildCombatBar = ({ id, label, className }) => {
    const row = document.createElement("div");
    row.className = className;
    const labelNode = document.createElement("span");
    labelNode.className = "unit-counter-combat-bar-label";
    labelNode.textContent = t(label, "ui");
    const track = document.createElement("span");
    track.className = "unit-counter-combat-bar-track";
    const fill = document.createElement("span");
    fill.id = id;
    fill.className = "unit-counter-combat-bar-fill";
    track.appendChild(fill);
    row.append(labelNode, track);
    return row;
  };
  const buildSegmentedChoiceField = (id, options, {
    groupClassName = "frontline-segmented-field",
    buttonClassName = "frontline-segmented-choice",
  } = {}) => {
    const shell = document.createElement("div");
    shell.className = groupClassName;
    const select = buildSelect(id, options);
    select.classList.add("frontline-segmented-native");
    shell.appendChild(select);
    options.forEach(([value, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = buttonClassName;
      button.dataset.value = value;
      button.dataset.frontlineStyleChoice = "true";
      button.textContent = t(label, "ui");
      shell.appendChild(button);
    });
    return { shell, select };
  };
  const buildDetailGroup = (id, label, { open = false } = {}) => {
    const shell = document.createElement("details");
    shell.id = id;
    shell.className = "unit-counter-detail-group";
    shell.open = !!open;
    const summary = document.createElement("summary");
    summary.className = "unit-counter-detail-group-summary";
    summary.textContent = t(label, "ui");
    const body = document.createElement("div");
    body.className = "unit-counter-detail-group-body";
    shell.appendChild(summary);
    shell.appendChild(body);
    return { shell, body };
  };
  const unitCounterPresets = Object.freeze(UNIT_COUNTER_PRESETS.map((preset) => ({
    ...preset,
    id: String(preset.id || "").trim().toUpperCase(),
    defaultEchelon: String(preset.defaultEchelon || "").trim().toUpperCase(),
    category: String(preset.category || "ground").trim().toLowerCase() || "ground",
    keywords: Array.isArray(preset.keywords) ? preset.keywords.map((entry) => String(entry || "").trim().toLowerCase()).filter(Boolean) : [],
    featured: preset.featured !== false,
  })));
  const featuredUnitCounterPresets = Object.freeze(unitCounterPresets.filter((preset) => preset.featured));
  const unitCounterCatalogCategories = Object.freeze(getUnitCounterCatalogCategories());
  const unitCounterEchelons = Object.freeze(UNIT_COUNTER_ECHELONS.map(([value, label]) => [
    String(value || "").trim().toUpperCase(),
    label,
  ]));
  const unitCounterSizeLabels = Object.freeze({
    small: "Small",
    medium: "Medium",
    large: "Large",
  });
  const unitCounterCombatPresets = Object.freeze([
    { id: "elite", label: "Elite", organizationPct: 94, equipmentPct: 92 },
    { id: "regular", label: "Regular", organizationPct: 82, equipmentPct: 78 },
    { id: "worn", label: "Worn", organizationPct: 68, equipmentPct: 62 },
    { id: "understrength", label: "Understrength", organizationPct: 58, equipmentPct: 48 },
    { id: "improvised", label: "Improvised", organizationPct: 47, equipmentPct: 42 },
  ]);
  const clampUnitCounterStatValue = (value, fallback = 78) => {
    const nextValue = Number(value);
    if (!Number.isFinite(nextValue)) {
      return Math.max(0, Math.min(100, Number(fallback) || 0));
    }
    return Math.max(0, Math.min(100, Math.round(nextValue)));
  };
  const clampUnitCounterFixedScaleMultiplier = (value, fallback = 1.5) => {
    const nextValue = Number(value);
    if (!Number.isFinite(nextValue)) {
      return Math.max(0.5, Math.min(2.0, Number(fallback) || 1.5));
    }
    return Math.max(0.5, Math.min(2.0, nextValue));
  };
  const normalizeUnitCounterStatsPresetId = (value = "") => {
    const normalizedValue = String(value || "").trim().toLowerCase();
    return unitCounterCombatPresets.some((preset) => preset.id === normalizedValue) ? normalizedValue : "regular";
  };
  const getUnitCounterCombatPreset = (value = "") => {
    const presetId = normalizeUnitCounterStatsPresetId(value);
    return unitCounterCombatPresets.find((preset) => preset.id === presetId) || unitCounterCombatPresets[1];
  };
  const rollBiasedUnitCounterStat = (minimum = 40, maximum = 100) => {
    const span = Math.max(0, Number(maximum) - Number(minimum));
    const biasedRoll = 0.55 * Math.random() + 0.25 * Math.random() + 0.2 * Math.random();
    return clampUnitCounterStatValue(Number(minimum) + span * biasedRoll, minimum);
  };
  const getRandomizedUnitCounterCombatState = () => ({
    organizationPct: rollBiasedUnitCounterStat(44, 100),
    equipmentPct: rollBiasedUnitCounterStat(40, 96),
    statsPresetId: "random",
    statsSource: "random",
  });
  const resolveUnitCounterCombatState = (candidate = {}) => {
    const preset = getUnitCounterCombatPreset(candidate.statsPresetId || "regular");
    const statsSource = ["preset", "random", "manual"].includes(String(candidate.statsSource || "").trim().toLowerCase())
      ? String(candidate.statsSource || "").trim().toLowerCase()
      : "preset";
    return {
      organizationPct: clampUnitCounterStatValue(candidate.organizationPct, preset.organizationPct),
      equipmentPct: clampUnitCounterStatValue(candidate.equipmentPct, preset.equipmentPct),
      statsPresetId: String(candidate.statsPresetId || preset.id || "").trim().toLowerCase() || preset.id,
      statsSource,
      baseFillColor: String(candidate.baseFillColor || "").trim(),
    };
  };
  const getUnitCounterPresetMeta = (presetId = "") => {
    const normalizedPresetId = String(presetId || "").trim().toUpperCase();
    return unitCounterPresets.find((preset) => preset.id === normalizedPresetId)
      || {
        ...getUnitCounterPresetById(normalizedPresetId || DEFAULT_UNIT_COUNTER_PRESET_ID),
        id: String(normalizedPresetId || DEFAULT_UNIT_COUNTER_PRESET_ID).trim().toUpperCase(),
        defaultEchelon: String(getUnitCounterPresetById(normalizedPresetId || DEFAULT_UNIT_COUNTER_PRESET_ID).defaultEchelon || "").trim().toUpperCase(),
      };
  };
  const getSidebarUnitCounterPresetOptions = (selectedPresetId = "") => {
    const normalizedSelectedId = String(selectedPresetId || "").trim().toUpperCase();
    const options = featuredUnitCounterPresets.slice();
    if (normalizedSelectedId && !options.some((preset) => preset.id === normalizedSelectedId)) {
      options.unshift(getUnitCounterPresetMeta(normalizedSelectedId));
    }
    return options;
  };
  const getFilteredUnitCounterCatalog = ({
    category = "all",
    query = "",
  } = {}) => {
    const normalizedCategory = String(category || "all").trim().toLowerCase() || "all";
    const normalizedQuery = String(query || "").trim().toLowerCase();
    return unitCounterPresets.filter((preset) => {
      if (normalizedCategory !== "all" && preset.category !== normalizedCategory) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      const haystacks = [
        preset.id,
        preset.label,
        preset.shortCode,
        preset.unitType,
        preset.category,
        ...(preset.keywords || []),
      ]
        .map((entry) => String(entry || "").trim().toLowerCase())
        .filter(Boolean);
      return haystacks.some((entry) => entry.includes(normalizedQuery));
    });
  };
  const inferUnitCounterPresetId = (candidate = {}) => {
    const rawPreset = String(candidate?.presetId || candidate?.unitType || "").trim().toUpperCase();
    if (rawPreset && unitCounterPresets.some((preset) => preset.id === rawPreset)) {
      return rawPreset;
    }
    const rawToken = String(candidate?.symbolCode || candidate?.sidc || candidate?.label || "").trim().toUpperCase();
    const matchedPreset = unitCounterPresets.find((preset) => {
      if (!rawToken) return false;
      return rawToken === preset.id
        || rawToken === preset.shortCode
        || rawToken.includes(preset.shortCode);
    });
    return matchedPreset?.id || unitCounterPresets[0].id;
  };
  const getUnitCounterNationMeta = (nationTag = "") => {
    const normalizedTag = normalizeCountryCode(nationTag);
    if (!normalizedTag) {
      return {
        tag: "",
        displayName: t("Auto from placement", "ui"),
        color: "rgba(71, 85, 105, 0.78)",
      };
    }
    const scenarioMeta = getScenarioCountryMeta(normalizedTag);
    const fallbackName = runtimeState.countryNames?.[normalizedTag] || countryNames[normalizedTag] || normalizedTag;
    const scenarioName = scenarioMeta
      ? getScenarioCountryDisplayName(scenarioMeta, fallbackName) || fallbackName
      : fallbackName;
    return {
      tag: normalizedTag,
      displayName: t(scenarioName || normalizedTag, "geo") || scenarioName || normalizedTag,
      color: String(
        scenarioMeta?.color_hex
          || scenarioMeta?.colorHex
          || ensureCountryPaletteColor(normalizedTag)
          || "#64748b"
      ),
    };
  };
  const getUnitCounterNationOptions = () => getDynamicCountryEntries().map((entry) => {
    const meta = getUnitCounterNationMeta(entry.code);
    return {
      value: entry.code,
      label: `${entry.code} · ${meta.displayName}`,
    };
  });
  const getUnitCounterEchelonLabel = (value = "") => {
    const normalizedValue = String(value || "").trim().toUpperCase();
    return unitCounterEchelons.find(([code]) => code === normalizedValue)?.[1] || normalizedValue || t("Auto", "ui");
  };
  const formatUnitCounterListLabel = (counter = {}) => {
    const presetMeta = getUnitCounterPresetMeta(inferUnitCounterPresetId(counter));
    const nationMeta = getUnitCounterNationMeta(counter.nationTag);
    const primaryLabel = String(counter.label || "").trim() || presetMeta.label;
    const rendererLabel = String(counter.renderer || "game").trim().toUpperCase();
    const detailTokens = [
      presetMeta.shortCode,
      String(counter.echelon || "").trim() ? getUnitCounterEchelonLabel(counter.echelon) : "",
      rendererLabel,
    ].filter(Boolean);
    return [`${nationMeta.tag || "AUTO"} · ${primaryLabel}`, detailTokens.join(" · ")].filter(Boolean).join(" · ");
  };
  const UNIT_COUNTER_PREVIEW_SVG_CACHE_LIMIT = 48;
  const UNIT_COUNTER_MILSTD_SIDC_PATTERN = /^[A-Z0-9*-]{10,40}$/;
  const unitCounterPreviewSvgCache = new Map();
  const normalizeUnitCounterMilstdSidc = (sidc = "") => {
    const token = String(sidc || "").trim().toUpperCase();
    return UNIT_COUNTER_MILSTD_SIDC_PATTERN.test(token) ? token : "";
  };
  const getUnitCounterPreviewSvg = (sidc = "") => {
    const normalizedSidc = normalizeUnitCounterMilstdSidc(sidc);
    if (!normalizedSidc || !globalThis.ms?.Symbol) {
      return null;
    }
    if (unitCounterPreviewSvgCache.has(normalizedSidc)) {
      const cachedNode = unitCounterPreviewSvgCache.get(normalizedSidc);
      unitCounterPreviewSvgCache.delete(normalizedSidc);
      unitCounterPreviewSvgCache.set(normalizedSidc, cachedNode);
      return cachedNode.cloneNode(true);
    }
    try {
      const markup = new globalThis.ms.Symbol(normalizedSidc, {
        size: 18,
        fill: true,
        monoColor: "#0f172a",
        outlineColor: "#f8f5eb",
        outlineWidth: 3,
      }).asSVG();
      const parsed = new globalThis.DOMParser().parseFromString(markup, "image/svg+xml");
      const svg = parsed?.documentElement;
      if (!(svg instanceof SVGElement)) {
        return null;
      }
      unitCounterPreviewSvgCache.set(normalizedSidc, svg);
      if (unitCounterPreviewSvgCache.size > UNIT_COUNTER_PREVIEW_SVG_CACHE_LIMIT) {
        const oldestKey = unitCounterPreviewSvgCache.keys().next().value;
        unitCounterPreviewSvgCache.delete(oldestKey);
      }
      return svg.cloneNode(true);
    } catch (_error) {
      return null;
    }
  };
  const buildUnitCounterPreviewStat = (kind, label) => {
    const stat = document.createElement("div");
    stat.className = `unit-counter-preview-stat is-${kind}`;
    const statLabel = document.createElement("span");
    statLabel.className = "unit-counter-preview-stat-label";
    statLabel.textContent = label;
    const track = document.createElement("span");
    track.className = "unit-counter-preview-stat-track";
    const fill = document.createElement("span");
    fill.className = "unit-counter-preview-stat-fill";
    track.appendChild(fill);
    const value = document.createElement("span");
    value.className = "unit-counter-preview-stat-value";
    stat.append(statLabel, track, value);
    return { stat, fill, value };
  };
  const ensureUnitCounterPreviewNodes = (container) => {
    if (container?._previewNodes) {
      return container._previewNodes;
    }
    container.replaceChildren();
    const card = document.createElement("div");
    card.className = "unit-counter-preview-card is-medium";

    const strip = document.createElement("div");
    strip.className = "unit-counter-preview-strip";
    card.appendChild(strip);

    const topLine = document.createElement("div");
    topLine.className = "unit-counter-preview-topline";
    const nationPill = document.createElement("span");
    nationPill.className = "unit-counter-preview-nation";
    const typePill = document.createElement("span");
    typePill.className = "unit-counter-preview-renderer";
    topLine.append(nationPill, typePill);
    card.appendChild(topLine);

    const body = document.createElement("div");
    body.className = "unit-counter-preview-body";
    const symbolShell = document.createElement("div");
    symbolShell.className = "unit-counter-preview-symbol";

    const content = document.createElement("div");
    content.className = "unit-counter-preview-copy";
    const title = document.createElement("div");
    title.className = "unit-counter-preview-title";
    const status = document.createElement("div");
    status.className = "unit-counter-preview-status";
    status.hidden = true;
    const meta = document.createElement("div");
    meta.className = "unit-counter-preview-meta";

    const statStack = document.createElement("div");
    statStack.className = "unit-counter-preview-stats";
    const orgStat = buildUnitCounterPreviewStat("org", t("ORG", "ui"));
    const equipmentStat = buildUnitCounterPreviewStat("equipment", t("EQP", "ui"));
    statStack.append(orgStat.stat, equipmentStat.stat);

    const footer = document.createElement("div");
    footer.className = "unit-counter-preview-footer";
    const echelonBadge = document.createElement("span");
    echelonBadge.className = "unit-counter-preview-chip";
    const strengthBadge = document.createElement("span");
    strengthBadge.className = "unit-counter-preview-chip is-alert";
    strengthBadge.hidden = true;
    footer.append(echelonBadge, strengthBadge);

    content.append(title, status, meta, statStack, footer);
    body.append(symbolShell, content);
    card.appendChild(body);
    container.appendChild(card);

    container._previewNodes = {
      card,
      nationPill,
      typePill,
      symbolShell,
      title,
      status,
      meta,
      statStack,
      orgStat,
      equipmentStat,
      footer,
      echelonBadge,
      strengthBadge,
      symbolKey: "",
    };
    return container._previewNodes;
  };
  const renderUnitCounterPreview = (container, {
    renderer = "game",
    size = "medium",
    nationTag = "",
    nationSource = "display",
    label = "",
    subLabel = "",
    strengthText = "",
    sidc = "",
    symbolCode = "",
    presetId = "",
    echelon = "",
    organizationPct = 78,
    equipmentPct = 74,
    baseFillColor = "",
    statusText = "",
    detailMode = false,
    compactMode = false,
  } = {}) => {
    if (!container) return;
    const presetMeta = getUnitCounterPresetMeta(presetId || inferUnitCounterPresetId({ presetId, symbolCode, sidc, label }));
    const nationMeta = getUnitCounterNationMeta(nationTag);
    const combatState = resolveUnitCounterCombatState({
      organizationPct,
      equipmentPct,
      baseFillColor,
    });
    const previewLabel = String(label || "").trim() || presetMeta.label;
    const previewSubLabel = String(subLabel || "").trim() || `${nationMeta.displayName} · ${getUnitCounterEchelonLabel(echelon || presetMeta.defaultEchelon)}`;
    const previewStrength = String(strengthText || "").trim();
    const previewRenderer = String(renderer || presetMeta.defaultRenderer || "game").trim().toLowerCase();
    const previewSidc = normalizeUnitCounterMilstdSidc(sidc);
    const previewSymbolToken = String(symbolCode || sidc || presetMeta.shortCode || "").trim().toUpperCase() || presetMeta.shortCode;
    const previewSymbolKey = previewRenderer === "milstd"
      ? `milstd:${previewSidc}`
      : `game:${previewSymbolToken || presetMeta.shortCode}`;
    const nodes = ensureUnitCounterPreviewNodes(container);

    container.classList.toggle("is-detail", !!detailMode);
    container.classList.toggle("is-compact", !!compactMode);
    container.classList.toggle("is-milstd", previewRenderer === "milstd");
    container.classList.toggle("is-game", previewRenderer !== "milstd");
    container.style.setProperty("--unit-counter-accent", nationMeta.color || "#64748b");
    container.style.setProperty("--unit-counter-fill", combatState.baseFillColor || "#f4f0e6");
    container.style.setProperty("--unit-counter-org-ratio", `${combatState.organizationPct}%`);
    container.style.setProperty("--unit-counter-equip-ratio", `${combatState.equipmentPct}%`);

    nodes.card.className = `unit-counter-preview-card is-${String(size || "medium").trim().toLowerCase()}${detailMode ? " is-detail" : ""}${compactMode ? " is-compact" : ""}`;
    nodes.nationPill.textContent = nationMeta.tag || t("AUTO", "ui");
    nodes.typePill.textContent = presetMeta.shortCode;
    nodes.title.textContent = previewLabel;
    nodes.meta.textContent = compactMode
      ? `${nationMeta.tag || t("AUTO", "ui")} · ${getUnitCounterEchelonLabel(echelon || presetMeta.defaultEchelon)}`
      : previewSubLabel;
    nodes.status.hidden = !statusText;
    nodes.status.textContent = statusText || "";
    nodes.statStack.hidden = !!compactMode;
    nodes.footer.hidden = !!compactMode;
    nodes.echelonBadge.textContent = getUnitCounterEchelonLabel(echelon || presetMeta.defaultEchelon).slice(0, detailMode ? 24 : 3).toUpperCase();
    nodes.strengthBadge.hidden = !previewStrength;
    nodes.strengthBadge.textContent = previewStrength || "";
    nodes.orgStat.stat.style.setProperty("--unit-counter-stat-ratio", `${combatState.organizationPct}%`);
    nodes.orgStat.value.textContent = String(combatState.organizationPct);
    nodes.equipmentStat.stat.style.setProperty("--unit-counter-stat-ratio", `${combatState.equipmentPct}%`);
    nodes.equipmentStat.value.textContent = String(combatState.equipmentPct);

    if (nodes.symbolKey !== previewSymbolKey) {
      nodes.symbolShell.replaceChildren();
      if (previewRenderer === "milstd" && previewSidc) {
        const svg = getUnitCounterPreviewSvg(previewSidc);
        if (svg) {
          nodes.symbolShell.appendChild(svg);
        } else {
          nodes.symbolShell.textContent = presetMeta.shortCode;
        }
      } else {
        nodes.symbolShell.textContent = previewSymbolToken || presetMeta.shortCode;
      }
      nodes.symbolKey = previewSymbolKey;
    }
  };

  let frontlineOverlaySection = document.getElementById("frontlineOverlayPanel");
  if (!frontlineOverlaySection && frontlineTabStack) {
    frontlineOverlaySection = document.createElement("div");
    frontlineOverlaySection.id = "frontlineOverlayPanel";
    frontlineOverlaySection.className = "inspector-tool-card frontline-tab-card";

    const statusRow = document.createElement("div");
    statusRow.className = "frontline-status-row";

    const statusTitleGroup = document.createElement("div");
    statusTitleGroup.className = "frontline-status-copy";

    const title = document.createElement("div");
    title.className = "section-header sidebar-tool-title";
    title.textContent = t("Derived Frontlines", "ui");

    const statusPill = document.createElement("span");
    statusPill.id = "frontlineEnabledStatus";
    statusPill.className = "frontline-status-pill";
    statusPill.textContent = t("Off", "ui");

    statusTitleGroup.appendChild(title);
    statusTitleGroup.appendChild(statusPill);

    const statusHint = document.createElement("p");
    statusHint.id = "frontlineStatusHint";
    statusHint.className = "sidebar-tool-hint frontline-compact-hint";
    statusHint.textContent = t("Overlay off.", "ui");

    statusRow.appendChild(statusTitleGroup);

    const enableRow = buildRow();
    const enableToggle = buildCheckboxLabel("frontlineEnabledToggle", "Enable derived frontlines", "toggle-label");
    enableRow.appendChild(enableToggle);

    const emptyState = document.createElement("div");
    emptyState.id = "frontlineEmptyState";
    emptyState.className = "inspector-empty-state frontline-empty-state";
    const emptyTitle = document.createElement("h3");
    emptyTitle.className = "section-header-block";
    emptyTitle.textContent = t("Frontline is off", "ui");
    emptyState.appendChild(emptyTitle);

    const settings = document.createElement("div");
    settings.id = "frontlineSettingsPanel";
    settings.className = "frontline-settings-stack hidden";

    const controlsHeader = document.createElement("div");
    controlsHeader.className = "section-header mt-2";
    controlsHeader.textContent = t("View", "ui");

    const controlsHint = document.createElement("p");
    controlsHint.className = "sidebar-tool-hint frontline-compact-hint";
    controlsHint.textContent = t("Style and labels.", "ui");

    const controlsRow = buildRow();
    controlsRow.classList.add("frontline-compact-row");
    const frontlineStyleField = buildSegmentedChoiceField("strategicFrontlineStyleSelect", [
      ["clean", "Clean"],
      ["dual-rail", "Dual Rail"],
      ["teeth", "Teeth"],
    ]);
    const frontlineStyleSelect = frontlineStyleField.select;
    const frontlineLabelToggle = buildCheckboxLabel("strategicFrontlineLabelsToggle", "Labels", "checkbox-row");
    const frontlineLabelPlacement = buildSelect("strategicLabelPlacementSelect", [
      ["midpoint", "Midpoint"],
      ["centroid", "Centroid"],
    ]);
    frontlineLabelPlacement.classList.add("frontline-inline-select");
    controlsRow.appendChild(frontlineStyleField.shell);
    controlsRow.appendChild(frontlineLabelToggle);

    const controlsAdvanced = document.createElement("details");
    controlsAdvanced.className = "unit-counter-advanced-shell frontline-advanced-shell";
    const controlsAdvancedSummary = document.createElement("summary");
    controlsAdvancedSummary.className = "unit-counter-advanced-summary";
    controlsAdvancedSummary.textContent = t("Advanced Label Placement", "ui");
    const controlsAdvancedBody = document.createElement("div");
    controlsAdvancedBody.className = "unit-counter-advanced-body";
    controlsAdvancedBody.appendChild(frontlineLabelPlacement);
    controlsAdvanced.appendChild(controlsAdvancedSummary);
    controlsAdvanced.appendChild(controlsAdvancedBody);

    settings.appendChild(controlsHeader);
    settings.appendChild(controlsHint);
    settings.appendChild(controlsRow);
    settings.appendChild(controlsAdvanced);

    frontlineOverlaySection.appendChild(statusRow);
    frontlineOverlaySection.appendChild(statusHint);
    frontlineOverlaySection.appendChild(enableRow);
    frontlineOverlaySection.appendChild(emptyState);
    frontlineOverlaySection.appendChild(settings);
    frontlineTabStack.appendChild(frontlineOverlaySection);
  }

  let strategicOverlaySection = document.getElementById("strategicOverlayPanel");
  if (!strategicOverlaySection && frontlineTabStack) {
    strategicOverlaySection = document.createElement("div");
    strategicOverlaySection.id = "strategicOverlayPanel";
    strategicOverlaySection.className = "inspector-tool-card frontline-tab-card";

    const headerRow = document.createElement("div");
    headerRow.className = "strategic-workspace-header";

    const headerCopy = document.createElement("div");
    headerCopy.className = "strategic-workspace-header-copy";

    const title = document.createElement("div");
    title.className = "section-header sidebar-tool-title";
    title.textContent = t("Strategic Annotations", "ui");

    const hint = document.createElement("p");
    hint.className = "sidebar-tool-hint";
    hint.textContent = t("Project-local lines, graphics, and unit counters for export.", "ui");

    const publishStatus = document.createElement("p");
    publishStatus.id = "strategicOverlayPublishStatus";
    publishStatus.className = "sidebar-tool-hint strategic-overlay-publish-status";
    publishStatus.setAttribute("role", "status");
    publishStatus.setAttribute("aria-live", "polite");
    publishStatus.setAttribute("aria-atomic", "true");
    publishStatus.title = t("Project export saves Strategic annotations.", "ui");
    publishStatus.textContent = `0 ${t("lines", "ui")} · 0 ${t("graphics", "ui")} · 0 ${t("counters", "ui")} · ${t("Export as Strategic annotations", "ui")}`;

    const workspaceIconCloseBtn = buildButton("strategicOverlayIconCloseBtn", "Close");
    workspaceIconCloseBtn.classList.add("secondary", "strategic-workspace-icon-close", "hidden");
    headerCopy.appendChild(title);
    headerCopy.appendChild(hint);
    headerCopy.appendChild(publishStatus);
    headerRow.appendChild(headerCopy);
    headerRow.appendChild(workspaceIconCloseBtn);

    const workspaceActions = buildRow();
    workspaceActions.className = "strategic-workspace-actions mt-2";
    const workspaceOpenBtn = buildButton("strategicOverlayOpenWorkspaceBtn", "Open Workspace");
    workspaceOpenBtn.classList.add("secondary");
    const workspaceCloseBtn = buildButton("strategicOverlayCloseWorkspaceBtn", "Close Workspace");
    workspaceCloseBtn.classList.add("secondary", "hidden");
    workspaceActions.appendChild(workspaceOpenBtn);
    workspaceActions.appendChild(workspaceCloseBtn);

    const operationalLineBlock = document.createElement("div");
    operationalLineBlock.className = "frontline-workbench-block strategic-workspace-section strategic-workspace-section-lines";
    const operationalLineHeader = document.createElement("div");
    operationalLineHeader.className = "section-header mt-3";
    operationalLineHeader.textContent = t("Operational Lines", "ui");
    const operationalLineHint = document.createElement("p");
    operationalLineHint.className = "sidebar-tool-hint";
    operationalLineHint.textContent = t("Plan lines.", "ui");
    const operationalLineRow = buildRow();
    operationalLineRow.classList.add("frontline-compact-row", "strategic-line-primary-row");
    const operationalLineKindSelect = buildSelect("operationalLineKindSelect", [
      ["frontline", "Frontline"],
      ["offensive_line", "Offensive Line"],
      ["spearhead_line", "Spearhead Line"],
      ["defensive_line", "Defensive Line"],
    ]);
    const operationalLineLabelInput = buildInput("operationalLineLabelInput", "Label");
    operationalLineRow.appendChild(operationalLineKindSelect);
    operationalLineRow.appendChild(operationalLineLabelInput);
    operationalLineRow.appendChild(buildButton("operationalLineStartBtn", "Start Draw"));

    const operationalLineStyleRow = buildRow();
    operationalLineStyleRow.classList.add("frontline-compact-row");
    const operationalLineStrokeInput = buildInput("operationalLineStrokeInput", "", "color");
    operationalLineStrokeInput.value = "#7f1d1d";
    operationalLineStrokeInput.className = "input strategic-inline-color";
    operationalLineStrokeInput.setAttribute("aria-label", t("Operational line stroke", "ui"));
    const operationalLineWidthInput = buildInput("operationalLineWidthInput", "Width", "number");
    operationalLineWidthInput.min = "0";
    operationalLineWidthInput.max = "16";
    operationalLineWidthInput.step = "0.2";
    const operationalLineOpacityInput = buildInput("operationalLineOpacityInput", "Opacity", "number");
    operationalLineOpacityInput.min = "0";
    operationalLineOpacityInput.max = "1";
    operationalLineOpacityInput.step = "0.05";
    operationalLineStyleRow.appendChild(operationalLineStrokeInput);
    operationalLineStyleRow.appendChild(operationalLineWidthInput);
    operationalLineStyleRow.appendChild(operationalLineOpacityInput);

    const operationalLineEditorHint = document.createElement("p");
    operationalLineEditorHint.id = "operationalLineEditorHint";
    operationalLineEditorHint.className = "sidebar-tool-hint mt-2";
    operationalLineEditorHint.textContent = t("Choose type and draw.", "ui");

    const operationalLineActions = buildRow();
    operationalLineActions.className = "sidebar-equal-actions mt-3 strategic-line-management-actions";
    operationalLineActions.appendChild(buildButton("operationalLineUndoBtn", "Undo Vertex"));
    operationalLineActions.appendChild(buildButton("operationalLineFinishBtn", "Finish"));
    operationalLineActions.appendChild(buildButton("operationalLineCancelBtn", "Cancel"));
    operationalLineActions.appendChild(buildButton("operationalLineDeleteBtn", "Delete Selected"));

    const operationalLineList = document.createElement("select");
    operationalLineList.id = "operationalLineList";
    operationalLineList.className = "select-input mt-2 strategic-line-list";
    operationalLineList.size = 4;

    const graphicsBlock = document.createElement("div");
    graphicsBlock.className = "frontline-workbench-block strategic-workspace-section strategic-workspace-section-graphics";
    const graphicsHeader = document.createElement("div");
    graphicsHeader.className = "section-header mt-3";
    graphicsHeader.textContent = t("Operation Graphics", "ui");
    const graphicsHint = document.createElement("p");
    graphicsHint.className = "sidebar-tool-hint";
    graphicsHint.textContent = t("Arrows and markers.", "ui");
    const graphicsRow = buildRow();
    graphicsRow.classList.add("frontline-compact-row", "strategic-graphics-primary-row");
    const graphicsKindSelect = buildSelect("operationGraphicKindSelect", [
      ["attack", "Attack"],
      ["retreat", "Retreat"],
      ["supply", "Supply"],
      ["naval", "Naval"],
      ["encirclement", "Encirclement"],
      ["theater", "Theater"],
    ]);
    const graphicsLabelInput = buildInput("operationGraphicLabelInput", "Label");
    graphicsRow.appendChild(graphicsKindSelect);
    graphicsRow.appendChild(graphicsLabelInput);
    graphicsRow.appendChild(buildButton("operationGraphicStartBtn", "Start Draw"));

    const graphicsStyleRow = buildRow();
    graphicsStyleRow.classList.add("frontline-compact-row");
    const graphicsPresetSelect = buildSelect("operationGraphicPresetSelect", [
      ["attack", "Attack Style"],
      ["retreat", "Retreat Style"],
      ["supply", "Supply Style"],
      ["naval", "Naval Style"],
      ["encirclement", "Encirclement Style"],
      ["theater", "Theater Style"],
    ]);
    const graphicsStrokeInput = buildInput("operationGraphicStrokeInput", "", "color");
    graphicsStrokeInput.value = "#991b1b";
    graphicsStrokeInput.className = "input strategic-inline-color";
    graphicsStrokeInput.setAttribute("aria-label", t("Graphic stroke", "ui"));
    const graphicsWidthInput = buildInput("operationGraphicWidthInput", "Width", "number");
    graphicsWidthInput.min = "0";
    graphicsWidthInput.max = "16";
    graphicsWidthInput.step = "0.2";
    const graphicsOpacityInput = buildInput("operationGraphicOpacityInput", "Opacity", "number");
    graphicsOpacityInput.min = "0";
    graphicsOpacityInput.max = "1";
    graphicsOpacityInput.step = "0.05";
    graphicsStyleRow.appendChild(graphicsPresetSelect);
    graphicsStyleRow.appendChild(graphicsStrokeInput);
    graphicsStyleRow.appendChild(graphicsWidthInput);
    graphicsStyleRow.appendChild(graphicsOpacityInput);

    const graphicsEditorHint = document.createElement("p");
    graphicsEditorHint.id = "operationGraphicEditorHint";
    graphicsEditorHint.className = "sidebar-tool-hint mt-2";
    graphicsEditorHint.textContent = t("Edit vertices and style.", "ui");

    const graphicsActions = buildRow();
    graphicsActions.className = "sidebar-equal-actions mt-3 strategic-graphics-management-actions";
    graphicsActions.appendChild(buildButton("operationGraphicUndoBtn", "Undo Vertex"));
    graphicsActions.appendChild(buildButton("operationGraphicFinishBtn", "Finish"));
    graphicsActions.appendChild(buildButton("operationGraphicCancelBtn", "Cancel"));
    graphicsActions.appendChild(buildButton("operationGraphicDeleteBtn", "Delete Selected"));
    const graphicsDeleteVertexBtn = buildButton("operationGraphicDeleteVertexBtn", "Delete Vertex");
    let skipDeleteGraphicVertexClick = false;
    const handleDeleteGraphicVertex = (event) => {
      event?.preventDefault?.();
      if (event?.type === "click" && skipDeleteGraphicVertexClick) {
        skipDeleteGraphicVertexClick = false;
        return;
      }
      if (event?.type === "pointerdown") {
        skipDeleteGraphicVertexClick = true;
      }
      deleteSelectedOperationGraphicVertex();
      refreshStrategicOverlayUI();
    };
    graphicsDeleteVertexBtn.addEventListener("pointerdown", handleDeleteGraphicVertex);
    graphicsDeleteVertexBtn.addEventListener("click", handleDeleteGraphicVertex);
    graphicsDeleteVertexBtn.dataset.bound = "true";
    graphicsActions.appendChild(graphicsDeleteVertexBtn);

    const graphicsList = document.createElement("select");
    graphicsList.id = "operationGraphicList";
    graphicsList.className = "select-input mt-2 strategic-graphics-list";
    graphicsList.size = 4;

    const graphicsAdvanced = document.createElement("details");
    graphicsAdvanced.className = "unit-counter-advanced-shell frontline-advanced-shell mt-2";
    const graphicsAdvancedSummary = document.createElement("summary");
    graphicsAdvancedSummary.className = "unit-counter-advanced-summary";
    graphicsAdvancedSummary.textContent = t("Graphic Style Controls", "ui");
    const graphicsAdvancedBody = document.createElement("div");
    graphicsAdvancedBody.className = "unit-counter-advanced-body";
    graphicsAdvancedBody.appendChild(graphicsStyleRow);
    graphicsAdvanced.appendChild(graphicsAdvancedSummary);
    graphicsAdvanced.appendChild(graphicsAdvancedBody);

    const countersBlock = document.createElement("div");
    countersBlock.className = "frontline-workbench-block strategic-workspace-section strategic-workspace-section-counters";
    const unitHeader = document.createElement("div");
    unitHeader.className = "section-header mt-4";
    unitHeader.textContent = t("Unit Counters", "ui");
    const unitHint = document.createElement("p");
    unitHint.className = "sidebar-tool-hint";
    unitHint.textContent = t("Map pieces.", "ui");
    const unitEditorShell = document.createElement("div");
    unitEditorShell.className = "unit-counter-editor-shell mt-2";
    unitEditorShell.id = "unitCounterEditorShell";

    const unitPreviewFrame = document.createElement("div");
    unitPreviewFrame.className = "unit-counter-preview-frame";

    const unitPreviewCard = document.createElement("div");
    unitPreviewCard.id = "unitCounterPreviewCard";
    unitPreviewCard.className = "unit-counter-preview-shell is-compact";

    const unitPreviewActions = document.createElement("div");
    unitPreviewActions.className = "unit-counter-preview-actions";
    const unitDetailToggleBtn = document.createElement("button");
    unitDetailToggleBtn.type = "button";
    unitDetailToggleBtn.id = "unitCounterDetailToggleBtn";
    unitDetailToggleBtn.className = "btn secondary unit-counter-detail-icon-btn";
    unitDetailToggleBtn.setAttribute("aria-label", t("Toggle details", "ui"));
    unitDetailToggleBtn.setAttribute("aria-haspopup", "dialog");
    unitDetailToggleBtn.textContent = "\u2699";
    unitPreviewActions.appendChild(unitDetailToggleBtn);

    unitPreviewFrame.appendChild(unitPreviewCard);
    unitPreviewFrame.appendChild(unitPreviewActions);

    const unitPlacementStatus = document.createElement("div");
    unitPlacementStatus.id = "unitCounterPlacementStatus";
    unitPlacementStatus.className = "unit-counter-placement-status hidden";

    const unitPresetNationRow = buildRow();
    unitPresetNationRow.className = "unit-counter-grid-row unit-counter-fast-row mt-3 strategic-counter-fast-controls";
    const unitPresetSelect = buildSelect("unitCounterPresetSelect", featuredUnitCounterPresets.map((preset) => [
      preset.id,
      `${preset.label} · ${preset.shortCode}`,
    ]));
    const unitNationModeSelect = buildSelect("unitCounterNationModeSelect", [
      ["display", "Nation: Auto"],
      ["manual", "Nation: Manual"],
    ]);
    const unitNationSelect = buildSelect("unitCounterNationSelect", [["", "Auto from placement"]]);
    const unitAttachmentSelect = buildSelect("unitCounterAttachmentSelect", [["", "Anchor: Province / Free"]]);
    const unitEchelonSelect = buildSelect("unitCounterEchelonSelect", unitCounterEchelons);
    const unitLabelInput = buildInput("unitCounterLabelInput", "Counter Label");
    unitPresetNationRow.appendChild(unitPresetSelect);
    unitPresetNationRow.appendChild(unitNationModeSelect);
    unitPresetNationRow.appendChild(unitNationSelect);
    unitPresetNationRow.appendChild(unitAttachmentSelect);
    unitPresetNationRow.appendChild(unitEchelonSelect);
    unitPresetNationRow.appendChild(unitLabelInput);

    const unitIdentityGroup = buildDetailGroup("unitCounterIdentityGroup", "Identity", { open: true });
    const unitCombatGroup = buildDetailGroup("unitCounterCombatGroup", "Combat State", { open: true });
    const unitFinishGroup = buildDetailGroup("unitCounterFinishGroup", "Finish", { open: false });

    const counterEditorModalOverlay = document.createElement("div");
    counterEditorModalOverlay.id = "unitCounterEditorModalOverlay";
    counterEditorModalOverlay.className = "counter-editor-modal-overlay hidden";
    const counterEditorModal = document.createElement("div");
    counterEditorModal.id = "unitCounterEditorModal";
    counterEditorModal.className = "counter-editor-modal";
    counterEditorModal.setAttribute("role", "dialog");
    counterEditorModal.setAttribute("aria-modal", "true");
    counterEditorModal.setAttribute("aria-labelledby", "unitCounterEditorModalTitle");
    counterEditorModal.tabIndex = -1;
    const counterEditorModalHeader = document.createElement("div");
    counterEditorModalHeader.className = "counter-editor-modal-header";
    const counterEditorModalCopy = document.createElement("div");
    counterEditorModalCopy.className = "counter-editor-modal-copy";
    const counterEditorModalTitle = document.createElement("h2");
    counterEditorModalTitle.id = "unitCounterEditorModalTitle";
    counterEditorModalTitle.className = "counter-editor-modal-title";
    counterEditorModalTitle.textContent = t("Counter Editor", "ui");
    const counterEditorModalMessage = document.createElement("p");
    counterEditorModalMessage.className = "counter-editor-modal-message";
    counterEditorModalMessage.textContent = t("Browse symbols, tune combat state, and preview the selected counter in one place.", "ui");
    counterEditorModalCopy.append(counterEditorModalTitle, counterEditorModalMessage);
    const counterEditorModalCloseBtn = document.createElement("button");
    counterEditorModalCloseBtn.type = "button";
    counterEditorModalCloseBtn.id = "unitCounterEditorModalCloseBtn";
    counterEditorModalCloseBtn.className = "counter-editor-modal-close-btn";
    counterEditorModalCloseBtn.setAttribute("aria-label", t("Close counter editor", "ui"));
    counterEditorModalCloseBtn.textContent = "\u00D7";
    counterEditorModalHeader.append(counterEditorModalCopy, counterEditorModalCloseBtn);

    const counterEditorModalBody = document.createElement("div");
    counterEditorModalBody.className = "counter-editor-modal-body";
    const counterEditorModalPreview = document.createElement("div");
    counterEditorModalPreview.className = "counter-editor-modal-preview";
    const unitDetailPreviewCard = document.createElement("div");
    unitDetailPreviewCard.id = "unitCounterDetailPreviewCard";
    unitDetailPreviewCard.className = "unit-counter-preview-shell counter-editor-preview-shell";
    const counterEditorModalStatus = document.createElement("div");
    counterEditorModalStatus.id = "unitCounterEditorModalStatus";
    counterEditorModalStatus.className = "counter-editor-modal-status hidden";
    counterEditorModalPreview.append(unitDetailPreviewCard, counterEditorModalStatus);

    const counterEditorModalControls = document.createElement("div");
    counterEditorModalControls.className = "counter-editor-modal-controls";
    const unitCounterCatalogPanel = document.createElement("div");
    unitCounterCatalogPanel.className = "counter-editor-symbol-panel";
    const unitCounterCatalogHeader = document.createElement("div");
    unitCounterCatalogHeader.className = "counter-editor-symbol-header";
    const unitCounterCatalogHeaderTitle = document.createElement("div");
    unitCounterCatalogHeaderTitle.id = "unitCounterCatalogHeaderTitle";
    unitCounterCatalogHeaderTitle.className = "section-header";
    unitCounterCatalogHeaderTitle.textContent = t("Symbol Browser", "ui");
    const unitCounterCatalogHeaderHint = document.createElement("p");
    unitCounterCatalogHeaderHint.id = "unitCounterCatalogHeaderHint";
    unitCounterCatalogHeaderHint.className = "sidebar-tool-hint";
    unitCounterCatalogHeaderHint.textContent = t("Search symbols.", "ui");
    unitCounterCatalogHeader.append(unitCounterCatalogHeaderTitle, unitCounterCatalogHeaderHint);
    const unitCounterCatalogSourceTabs = document.createElement("div");
    unitCounterCatalogSourceTabs.id = "unitCounterCatalogSourceTabs";
    unitCounterCatalogSourceTabs.className = "counter-editor-source-tabs";
    const unitCounterInternalSourceBtn = document.createElement("button");
    unitCounterInternalSourceBtn.type = "button";
    unitCounterInternalSourceBtn.className = "counter-editor-source-btn";
    unitCounterInternalSourceBtn.dataset.counterCatalogSource = "internal";
    unitCounterInternalSourceBtn.textContent = t("Internal", "ui");
    const unitCounterHoi4SourceBtn = document.createElement("button");
    unitCounterHoi4SourceBtn.type = "button";
    unitCounterHoi4SourceBtn.className = "counter-editor-source-btn";
    unitCounterHoi4SourceBtn.dataset.counterCatalogSource = "hoi4";
    unitCounterHoi4SourceBtn.textContent = t("HOI4 Library", "ui");
    unitCounterCatalogSourceTabs.append(unitCounterInternalSourceBtn, unitCounterHoi4SourceBtn);
    const unitCounterCatalogSearchInput = buildInput("unitCounterCatalogSearchInput", "Search symbols");
    unitCounterCatalogSearchInput.classList.add("counter-editor-symbol-search");
    const unitCounterLibraryVariantRow = document.createElement("div");
    unitCounterLibraryVariantRow.id = "unitCounterLibraryVariantRow";
    unitCounterLibraryVariantRow.className = "counter-editor-category-row hidden";
    const unitCounterLibrarySmallVariantBtn = document.createElement("button");
    unitCounterLibrarySmallVariantBtn.type = "button";
    unitCounterLibrarySmallVariantBtn.className = "counter-editor-category-btn";
    unitCounterLibrarySmallVariantBtn.dataset.counterLibraryVariant = "small";
    unitCounterLibrarySmallVariantBtn.textContent = t("On-map Small", "ui");
    const unitCounterLibraryLargeVariantBtn = document.createElement("button");
    unitCounterLibraryLargeVariantBtn.type = "button";
    unitCounterLibraryLargeVariantBtn.className = "counter-editor-category-btn";
    unitCounterLibraryLargeVariantBtn.dataset.counterLibraryVariant = "large";
    unitCounterLibraryLargeVariantBtn.textContent = t("Large", "ui");
    unitCounterLibraryVariantRow.append(unitCounterLibrarySmallVariantBtn, unitCounterLibraryLargeVariantBtn);
    const unitCounterLibraryReviewBar = document.createElement("div");
    unitCounterLibraryReviewBar.id = "unitCounterLibraryReviewBar";
    unitCounterLibraryReviewBar.className = "counter-editor-library-review-bar hidden";
    const unitCounterLibraryReviewSummary = document.createElement("div");
    unitCounterLibraryReviewSummary.id = "unitCounterLibraryReviewSummary";
    unitCounterLibraryReviewSummary.className = "counter-editor-library-review-summary";
    const unitCounterLibraryExportBtn = buildButton("unitCounterLibraryExportBtn", "Export HOI4 Review JSON");
    unitCounterLibraryExportBtn.classList.add("counter-editor-library-export-btn");
    unitCounterLibraryReviewBar.append(unitCounterLibraryReviewSummary, unitCounterLibraryExportBtn);
    const unitCounterCatalogCategoriesEl = document.createElement("div");
    unitCounterCatalogCategoriesEl.id = "unitCounterCatalogCategories";
    unitCounterCatalogCategoriesEl.className = "counter-editor-category-row";
    const unitCounterCatalogGrid = document.createElement("div");
    unitCounterCatalogGrid.id = "unitCounterCatalogGrid";
    unitCounterCatalogGrid.className = "counter-editor-symbol-grid";
    unitCounterCatalogPanel.append(
      unitCounterCatalogHeader,
      unitCounterCatalogSourceTabs,
      unitCounterCatalogSearchInput,
      unitCounterLibraryVariantRow,
      unitCounterLibraryReviewBar,
      unitCounterCatalogCategoriesEl,
      unitCounterCatalogGrid
    );

    const unitDetailDrawer = document.createElement("div");
    unitDetailDrawer.id = "unitCounterDetailDrawer";
    unitDetailDrawer.className = "unit-counter-detail-drawer";

    const unitIdentityBlock = document.createElement("div");
    unitIdentityBlock.className = "unit-counter-detail-block";

    const unitModeRow = buildRow();
    unitModeRow.className = "unit-counter-grid-row mt-2";
    const unitRendererSelect = buildSelect("unitCounterRendererSelect", [
      ["game", "Game"],
      ["milstd", "MILSTD"],
    ]);
    const unitSizeSelect = buildSelect("unitCounterSizeSelect", [
      ["small", "Small"],
      ["medium", "Medium"],
      ["large", "Large"],
    ]);
    unitModeRow.appendChild(unitRendererSelect);
    unitModeRow.appendChild(unitSizeSelect);

    const unitCopyRow = buildRow();
    unitCopyRow.className = "unit-counter-grid-row mt-2";
    const unitSubLabelInput = buildInput("unitCounterSubLabelInput", "Sub-label");
    const unitStrengthInput = buildInput("unitCounterStrengthInput", "Strength");
    unitCopyRow.appendChild(unitSubLabelInput);
    unitCopyRow.appendChild(unitStrengthInput);

    const unitSymbolInput = buildInput("unitCounterSymbolInput", "SIDC / Symbol Code");
    const unitSymbolHint = document.createElement("p");
    unitSymbolHint.id = "unitCounterSymbolHint";
    unitSymbolHint.className = "sidebar-tool-hint mt-2";
    unitSymbolHint.textContent = t("Short code or SIDC.", "ui");
    unitIdentityBlock.appendChild(unitModeRow);
    unitIdentityBlock.appendChild(unitCopyRow);
    unitIdentityBlock.appendChild(unitSymbolInput);
    unitIdentityBlock.appendChild(unitSymbolHint);

    const unitCombatBlock = document.createElement("div");
    unitCombatBlock.className = "unit-counter-detail-block";

    const unitCombatPresetField = buildSegmentedChoiceField("unitCounterStatsPresetSelect", unitCounterCombatPresets.map((preset) => [
      preset.id,
      preset.label,
    ]), {
      groupClassName: "unit-counter-stat-preset-group",
      buttonClassName: "unit-counter-stat-preset-button",
    });
    unitCombatPresetField.shell.querySelectorAll("button").forEach((button) => {
      button.removeAttribute("data-frontline-style-choice");
      button.dataset.unitCounterStatsPresetChoice = "true";
    });
    const unitRandomizeBtn = buildButton("unitCounterStatsRandomizeBtn", "Randomize");
    unitRandomizeBtn.classList.add("secondary");

    const unitCombatPresetStack = document.createElement("div");
    unitCombatPresetStack.className = "unit-counter-combat-preset-stack mt-2";
    unitCombatPresetStack.appendChild(unitCombatPresetField.shell);
    unitCombatPresetStack.appendChild(unitRandomizeBtn);

    const unitStatInputs = buildRow();
    unitStatInputs.className = "unit-counter-grid-row mt-2";
    const unitOrganizationInput = buildInput("unitCounterOrganizationInput", "Organization", "number");
    unitOrganizationInput.min = "0";
    unitOrganizationInput.max = "100";
    unitOrganizationInput.step = "1";
    const unitEquipmentInput = buildInput("unitCounterEquipmentInput", "Equipment", "number");
    unitEquipmentInput.min = "0";
    unitEquipmentInput.max = "100";
    unitEquipmentInput.step = "1";
    unitStatInputs.appendChild(unitOrganizationInput);
    unitStatInputs.appendChild(unitEquipmentInput);

    const unitCombatBars = document.createElement("div");
    unitCombatBars.className = "unit-counter-combat-bar-stack mt-2";
    unitCombatBars.append(
      buildCombatBar({
        id: "unitCounterOrganizationBar",
        label: "Organization",
        className: "unit-counter-combat-bar is-org",
      }),
      buildCombatBar({
        id: "unitCounterEquipmentBar",
        label: "Equipment",
        className: "unit-counter-combat-bar is-equipment",
      })
    );
    unitCombatBlock.appendChild(unitCombatPresetStack);
    unitCombatBlock.appendChild(unitStatInputs);
    unitCombatBlock.appendChild(unitCombatBars);

    const unitFinishBlock = document.createElement("div");
    unitFinishBlock.className = "unit-counter-detail-block";

    const unitColorPanel = document.createElement("div");
    unitColorPanel.className = "unit-counter-color-panel mt-2";
    const unitColorSwatch = document.createElement("button");
    unitColorSwatch.type = "button";
    unitColorSwatch.id = "unitCounterBaseFillSwatch";
    unitColorSwatch.className = "unit-counter-color-swatch";
    unitColorSwatch.setAttribute("aria-label", t("Counter fill swatch", "ui"));
    const unitColorInput = buildInput("unitCounterBaseFillColorInput", "", "color");
    unitColorInput.classList.add("unit-counter-color-input");
    unitColorInput.setAttribute("aria-label", t("Counter fill color", "ui"));
    const unitColorResetBtn = buildButton("unitCounterBaseFillResetBtn", "Paper");
    unitColorResetBtn.classList.add("secondary");
    const unitColorEyedropperBtn = buildButton("unitCounterBaseFillEyedropperBtn", "Eyedropper");
    unitColorEyedropperBtn.classList.add("secondary");
    unitColorPanel.appendChild(unitColorSwatch);
    unitColorPanel.appendChild(unitColorInput);
    unitColorPanel.appendChild(unitColorResetBtn);
    unitColorPanel.appendChild(unitColorEyedropperBtn);
    unitFinishBlock.appendChild(unitColorPanel);

    unitIdentityGroup.body.appendChild(unitIdentityBlock);
    unitCombatGroup.body.appendChild(unitCombatBlock);
    unitFinishGroup.body.appendChild(unitFinishBlock);
    unitDetailDrawer.appendChild(unitIdentityGroup.shell);
    unitDetailDrawer.appendChild(unitCombatGroup.shell);
    unitDetailDrawer.appendChild(unitFinishGroup.shell);

    counterEditorModalControls.append(unitCounterCatalogPanel, unitDetailDrawer);
    counterEditorModalBody.append(counterEditorModalPreview, counterEditorModalControls);
    counterEditorModal.append(counterEditorModalHeader, counterEditorModalBody);
    counterEditorModalOverlay.appendChild(counterEditorModal);

    const unitOptionsRow = buildRow();
    unitOptionsRow.className = "mt-2 flex flex-wrap items-center justify-between gap-2 strategic-counter-visual-options";
    const unitLabelToggle = buildCheckboxLabel("unitCounterLabelsToggle", "Show Labels", "checkbox-row");
    unitOptionsRow.appendChild(unitLabelToggle);
    const unitScaleShell = document.createElement("div");
    unitScaleShell.className = "strategic-counter-scale-shell";
    const unitScaleRow = document.createElement("div");
    unitScaleRow.className = "range-row";
    const unitScaleLabel = document.createElement("label");
    unitScaleLabel.className = "range-label";
    unitScaleLabel.setAttribute("for", "unitCounterFixedScaleRange");
    unitScaleLabel.textContent = t("Counter Scale", "ui");
    const unitScaleValue = document.createElement("span");
    unitScaleValue.id = "unitCounterFixedScaleValue";
    unitScaleValue.className = "range-value";
    unitScaleValue.textContent = "1.50x";
    unitScaleRow.append(unitScaleLabel, unitScaleValue);
    unitScaleShell.appendChild(unitScaleRow);
    const unitScaleRange = document.createElement("input");
    unitScaleRange.id = "unitCounterFixedScaleRange";
    unitScaleRange.type = "range";
    unitScaleRange.min = "50";
    unitScaleRange.max = "200";
    unitScaleRange.step = "5";
    unitScaleRange.value = "150";
    unitScaleRange.className = "range-input";
    unitScaleShell.appendChild(unitScaleRange);
    unitOptionsRow.appendChild(unitScaleShell);

    const unitActions = buildRow();
    unitActions.className = "sidebar-equal-actions mt-3 strategic-counter-management-actions";
    const createCounterActionButton = (id, label, iconText, fullLabel) => {
      const button = buildButton(id, label);
      button.classList.add("strategic-counter-action-btn");
      button.setAttribute("title", t(fullLabel || label, "ui"));
      button.setAttribute("aria-label", t(fullLabel || label, "ui"));
      const icon = document.createElement("span");
      icon.className = "strategic-counter-action-icon";
      icon.textContent = iconText;
      const copy = document.createElement("span");
      copy.className = "strategic-counter-action-label";
      copy.textContent = t(label, "ui");
      button.replaceChildren(icon, copy);
      return button;
    };
    unitActions.appendChild(createCounterActionButton("unitCounterPlaceBtn", "Place", "+", "Place Counter"));
    unitActions.appendChild(createCounterActionButton("unitCounterCancelBtn", "Cancel", "\u00D7", "Cancel Place"));
    unitActions.appendChild(createCounterActionButton("unitCounterDeleteBtn", "Delete", "\u2212", "Delete Selected"));

    const unitListHeader = document.createElement("div");
    unitListHeader.className = "unit-counter-list-header mt-3 strategic-counter-list-header";
    const unitListTitle = document.createElement("div");
    unitListTitle.className = "section-header";
    unitListTitle.textContent = t("Placed Counters", "ui");
    unitListHeader.appendChild(unitListTitle);

    const unitList = document.createElement("select");
    unitList.id = "unitCounterList";
    unitList.className = "select-input mt-2 unit-counter-list strategic-counter-list";
    unitList.size = 4;

    strategicOverlaySection.appendChild(headerRow);
    strategicOverlaySection.appendChild(workspaceActions);
    operationalLineBlock.appendChild(operationalLineHeader);
    operationalLineBlock.appendChild(operationalLineHint);
    operationalLineBlock.appendChild(operationalLineRow);
    operationalLineBlock.appendChild(operationalLineStyleRow);
    operationalLineBlock.appendChild(operationalLineEditorHint);
    operationalLineBlock.appendChild(operationalLineActions);
    operationalLineBlock.appendChild(operationalLineList);
    graphicsBlock.appendChild(graphicsHeader);
    graphicsBlock.appendChild(graphicsHint);
    graphicsBlock.appendChild(graphicsRow);
    graphicsBlock.appendChild(graphicsAdvanced);
    graphicsBlock.appendChild(graphicsEditorHint);
    graphicsBlock.appendChild(graphicsActions);
    graphicsBlock.appendChild(graphicsList);
    countersBlock.appendChild(unitHeader);
    countersBlock.appendChild(unitHint);
    unitEditorShell.appendChild(unitPreviewFrame);
    unitEditorShell.appendChild(unitPlacementStatus);
    unitEditorShell.appendChild(unitPresetNationRow);
    unitEditorShell.appendChild(unitOptionsRow);
    unitEditorShell.appendChild(unitActions);
    unitEditorShell.appendChild(unitListHeader);
    unitEditorShell.appendChild(unitList);
    countersBlock.appendChild(unitEditorShell);
    document.body.appendChild(counterEditorModalOverlay);

    const buildAccordionSection = (id, title, contentBlock, opts = {}) => {
      const wrapper = document.createElement("div");
      wrapper.className = "strategic-accordion-section";
      wrapper.id = id;
      const header = document.createElement("button");
      header.type = "button";
      header.className = "strategic-accordion-header";
      const arrow = document.createElement("span");
      arrow.className = "strategic-accordion-arrow";
      arrow.textContent = "\u25B6";
      const titleEl = document.createElement("span");
      titleEl.className = "strategic-accordion-title";
      titleEl.textContent = t(title, "ui");
      const badge = document.createElement("span");
      badge.className = "strategic-accordion-badge";
      badge.textContent = "0";
      header.appendChild(arrow);
      header.appendChild(titleEl);
      header.appendChild(badge);
      const body = document.createElement("div");
      body.className = "strategic-accordion-body";
      body.id = `${id}Body`;
      body.appendChild(contentBlock);
      const syncExpandedState = (isOpen) => {
        wrapper.classList.toggle("is-open", !!isOpen);
        header.setAttribute("aria-expanded", isOpen ? "true" : "false");
      };
      header.setAttribute("aria-controls", body.id);
      header.addEventListener("click", () => {
        syncExpandedState(!wrapper.classList.contains("is-open"));
      });
      wrapper.appendChild(header);
      wrapper.appendChild(body);
      syncExpandedState(!!opts.defaultOpen);
      return wrapper;
    };

    const accordionLines = buildAccordionSection("accordionLines", "Operational Lines", operationalLineBlock, { defaultOpen: true });
    const accordionGraphics = buildAccordionSection("accordionGraphics", "Operation Graphics", graphicsBlock);
    const accordionCounters = buildAccordionSection("accordionCounters", "Unit Counters", countersBlock);
    strategicOverlaySection.appendChild(accordionLines);
    strategicOverlaySection.appendChild(accordionGraphics);
    strategicOverlaySection.appendChild(accordionCounters);
    frontlineTabStack.appendChild(strategicOverlaySection);
  }

  if (strategicOverlaySection && frontlineTabStack && strategicOverlaySection.parentElement !== frontlineTabStack) {
    strategicOverlaySection.classList.add("frontline-tab-card");
    frontlineTabStack.appendChild(strategicOverlaySection);
  }

  let strategicWorkspaceBackdrop = document.getElementById("strategicWorkspaceBackdrop");
  if (!strategicWorkspaceBackdrop) {
    strategicWorkspaceBackdrop = document.createElement("div");
    strategicWorkspaceBackdrop.id = "strategicWorkspaceBackdrop";
    strategicWorkspaceBackdrop.className = "strategic-workspace-backdrop hidden";
    document.body.appendChild(strategicWorkspaceBackdrop);
  }

  let strategicCommandBar = document.getElementById("strategicCommandBar");
  if (!strategicCommandBar) {
    strategicCommandBar = document.createElement("div");
    strategicCommandBar.id = "strategicCommandBar";
    strategicCommandBar.className = "strategic-command-bar";
    [
      ["strategicCommandFrontlineBtn", "frontline", "作战前线"],
      ["strategicCommandOffensiveBtn", "offensive_line", "进攻线"],
      ["strategicCommandSpearheadBtn", "spearhead_line", "穿插线"],
      ["strategicCommandDefensiveBtn", "defensive_line", "防守线"],
    ].forEach(([id, lineKind, label]) => {
      const button = document.createElement("button");
      button.id = id;
      button.type = "button";
      button.className = "strategic-command-btn";
      button.dataset.lineKind = lineKind;
      button.textContent = t(label, "ui");
      strategicCommandBar.appendChild(button);
    });
    document.body.appendChild(strategicCommandBar);
  }

  const inspectorSidebarTabButtons = Array.from(document.querySelectorAll("[data-inspector-tab]"));
  const inspectorSidebarTabPanels = Array.from(document.querySelectorAll("[data-inspector-panel]"));
  const rightSidebarDetails = () => Array.from(document.querySelectorAll("#rightSidebar details[id]"));
  const replaceUiUrlParams = (mutator) => {
    if (!globalThis.URLSearchParams || !globalThis.history?.replaceState || !globalThis.location) return;
    const params = new globalThis.URLSearchParams(globalThis.location.search || "");
    mutator?.(params);
    const nextQuery = params.toString();
    const nextUrl = `${globalThis.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${globalThis.location.hash || ""}`;
    globalThis.history.replaceState(globalThis.history.state, "", nextUrl);
  };
  const getScopeParamForTab = (tabId) => (String(tabId || "").trim().toLowerCase() === "project" ? "current-project" : "current-object");
  const isProjectSupportView = (value) => ["guide", "reference", "export"].includes(String(value || "").trim().toLowerCase());
  const clearRightSidebarSupportViewParam = () => {
    replaceUiUrlParams((params) => {
      params.delete(UI_URL_STATE_KEYS.view);
    });
  };
  const collectOpenRightSidebarSections = () => rightSidebarDetails()
    .filter((details) => details.open && !details.hidden)
    .map((details) => details.id)
    .join(",");
  const syncRightSidebarUrlState = () => {
    // 右侧栏 URL 状态只记录“当前标签页 + 展开的 section + support view”，
    // 不记录更细的局部表单状态，避免刷新链接过长也避免 restore 语义失真。
    replaceUiUrlParams((params) => {
      const scopeValue = getScopeParamForTab(runtimeState.ui?.rightSidebarTab || "inspector");
      params.set(UI_URL_STATE_KEYS.scope, scopeValue);
      const openSections = collectOpenRightSidebarSections();
      if (openSections) {
        params.set(UI_URL_STATE_KEYS.section, openSections);
      } else {
        params.delete(UI_URL_STATE_KEYS.section);
      }
      if (scopeValue !== "current-project") {
        params.delete(UI_URL_STATE_KEYS.view);
      }
    });
  };
  const restoreRightSidebarUrlState = () => {
    if (!globalThis.URLSearchParams || !globalThis.location) return "";
    // restore 只做“把壳层切回同一个工作区入口”，
    // 具体 guide/reference/export 的打开动作仍交给各自 owner 去完成。
    const params = new globalThis.URLSearchParams(globalThis.location.search || "");
    const scopeValue = String(params.get(UI_URL_STATE_KEYS.scope) || "").trim().toLowerCase();
    const viewValue = String(params.get(UI_URL_STATE_KEYS.view) || "").trim().toLowerCase();
    const requestedSections = new Set(
      String(params.get(UI_URL_STATE_KEYS.section) || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    );
    if (requestedSections.size) {
      rightSidebarDetails().forEach((details) => {
        details.open = requestedSections.has(details.id);
      });
    }
    if (isProjectSupportView(viewValue) && scopeValue !== "current-object") {
      const exportDetails = document.getElementById("exportProjectSection");
      const utilitiesDetails = document.getElementById("inspectorUtilitiesSection");
      if (viewValue === "export") {
        if (exportDetails instanceof HTMLDetailsElement) {
          exportDetails.open = true;
        }
      } else if (utilitiesDetails instanceof HTMLDetailsElement) {
        utilitiesDetails.open = true;
      }
      return "project";
    }
    return scopeValue === "current-project" ? "project" : "";
  };
  const frontlineEnabledStatus = document.getElementById("frontlineEnabledStatus");
  const frontlineStatusHint = document.getElementById("frontlineStatusHint");
  const frontlineEnabledToggle = document.getElementById("frontlineEnabledToggle");
  const frontlineEmptyState = document.getElementById("frontlineEmptyState");
  const frontlineSettingsPanel = document.getElementById("frontlineSettingsPanel");
  const strategicFrontlineStyleSelect = document.getElementById("strategicFrontlineStyleSelect");
  const frontlineStyleChoiceButtons = Array.from(document.querySelectorAll("[data-frontline-style-choice]"));
  const strategicFrontlineLabelsToggle = document.getElementById("strategicFrontlineLabelsToggle");
  const strategicLabelPlacementSelect = document.getElementById("strategicLabelPlacementSelect");
  const strategicWorkspaceBackdropEl = document.getElementById("strategicWorkspaceBackdrop");
  const strategicCommandButtons = Array.from(document.querySelectorAll("#strategicCommandBar .strategic-command-btn"));
  const strategicOverlayOpenWorkspaceBtn = document.getElementById("strategicOverlayOpenWorkspaceBtn");
  const strategicOverlayCloseWorkspaceBtn = document.getElementById("strategicOverlayCloseWorkspaceBtn");
  const strategicOverlayIconCloseBtn = document.getElementById("strategicOverlayIconCloseBtn");
  const strategicOverlayPublishStatus = document.getElementById("strategicOverlayPublishStatus");
  const operationalLineKindSelect = document.getElementById("operationalLineKindSelect");
  const operationalLineLabelInput = document.getElementById("operationalLineLabelInput");
  const operationalLineStrokeInput = document.getElementById("operationalLineStrokeInput");
  const operationalLineWidthInput = document.getElementById("operationalLineWidthInput");
  const operationalLineOpacityInput = document.getElementById("operationalLineOpacityInput");
  const operationalLineEditorHint = document.getElementById("operationalLineEditorHint");
  const operationalLineStartBtn = document.getElementById("operationalLineStartBtn");
  const operationalLineUndoBtn = document.getElementById("operationalLineUndoBtn");
  const operationalLineFinishBtn = document.getElementById("operationalLineFinishBtn");
  const operationalLineCancelBtn = document.getElementById("operationalLineCancelBtn");
  const operationalLineDeleteBtn = document.getElementById("operationalLineDeleteBtn");
  const operationalLineList = document.getElementById("operationalLineList");
  const operationGraphicKindSelect = document.getElementById("operationGraphicKindSelect");
  const operationGraphicLabelInput = document.getElementById("operationGraphicLabelInput");
  const operationGraphicPresetSelect = document.getElementById("operationGraphicPresetSelect");
  const operationGraphicStrokeInput = document.getElementById("operationGraphicStrokeInput");
  const operationGraphicWidthInput = document.getElementById("operationGraphicWidthInput");
  const operationGraphicOpacityInput = document.getElementById("operationGraphicOpacityInput");
  const operationGraphicEditorHint = document.getElementById("operationGraphicEditorHint");
  const operationGraphicStartBtn = document.getElementById("operationGraphicStartBtn");
  const operationGraphicUndoBtn = document.getElementById("operationGraphicUndoBtn");
  const operationGraphicFinishBtn = document.getElementById("operationGraphicFinishBtn");
  const operationGraphicCancelBtn = document.getElementById("operationGraphicCancelBtn");
  const operationGraphicDeleteBtn = document.getElementById("operationGraphicDeleteBtn");
  const operationGraphicDeleteVertexBtn = document.getElementById("operationGraphicDeleteVertexBtn");
  const operationGraphicList = document.getElementById("operationGraphicList");
  const unitCounterPreviewCard = document.getElementById("unitCounterPreviewCard");
  const unitCounterPlacementStatus = document.getElementById("unitCounterPlacementStatus");
  const unitCounterDetailToggleBtn = document.getElementById("unitCounterDetailToggleBtn");
  const unitCounterEditorModalOverlay = document.getElementById("unitCounterEditorModalOverlay");
  const unitCounterEditorModal = document.getElementById("unitCounterEditorModal");
  const unitCounterEditorModalCloseBtn = document.getElementById("unitCounterEditorModalCloseBtn");
  const unitCounterEditorModalStatus = document.getElementById("unitCounterEditorModalStatus");
  const unitCounterDetailPreviewCard = document.getElementById("unitCounterDetailPreviewCard");
  const unitCounterDetailDrawer = document.getElementById("unitCounterDetailDrawer");
  const unitCounterPresetSelect = document.getElementById("unitCounterPresetSelect");
  const unitCounterNationModeSelect = document.getElementById("unitCounterNationModeSelect");
  const unitCounterNationSelect = document.getElementById("unitCounterNationSelect");
  const unitCounterAttachmentSelect = document.getElementById("unitCounterAttachmentSelect");
  const unitCounterRendererSelect = document.getElementById("unitCounterRendererSelect");
  const unitCounterSizeSelect = document.getElementById("unitCounterSizeSelect");
  const unitCounterEchelonSelect = document.getElementById("unitCounterEchelonSelect");
  const unitCounterLabelInput = document.getElementById("unitCounterLabelInput");
  const unitCounterSubLabelInput = document.getElementById("unitCounterSubLabelInput");
  const unitCounterStrengthInput = document.getElementById("unitCounterStrengthInput");
  const unitCounterSymbolInput = document.getElementById("unitCounterSymbolInput");
  const unitCounterSymbolHint = document.getElementById("unitCounterSymbolHint");
  const unitCounterStatsPresetSelect = document.getElementById("unitCounterStatsPresetSelect");
  const unitCounterStatsPresetButtons = Array.from(document.querySelectorAll("[data-unit-counter-stats-preset-choice]"));
  const unitCounterStatsRandomizeBtn = document.getElementById("unitCounterStatsRandomizeBtn");
  const unitCounterOrganizationInput = document.getElementById("unitCounterOrganizationInput");
  const unitCounterEquipmentInput = document.getElementById("unitCounterEquipmentInput");
  const unitCounterOrganizationBar = document.getElementById("unitCounterOrganizationBar");
  const unitCounterEquipmentBar = document.getElementById("unitCounterEquipmentBar");
  const unitCounterBaseFillSwatch = document.getElementById("unitCounterBaseFillSwatch");
  const unitCounterBaseFillColorInput = document.getElementById("unitCounterBaseFillColorInput");
  const unitCounterBaseFillResetBtn = document.getElementById("unitCounterBaseFillResetBtn");
  const unitCounterBaseFillEyedropperBtn = document.getElementById("unitCounterBaseFillEyedropperBtn");
  const unitCounterLabelsToggle = document.getElementById("unitCounterLabelsToggle");
  const unitCounterFixedScaleRange = document.getElementById("unitCounterFixedScaleRange");
  const unitCounterFixedScaleValue = document.getElementById("unitCounterFixedScaleValue");
  const unitCounterPlaceBtn = document.getElementById("unitCounterPlaceBtn");
  const unitCounterCancelBtn = document.getElementById("unitCounterCancelBtn");
  const unitCounterDeleteBtn = document.getElementById("unitCounterDeleteBtn");
  const unitCounterList = document.getElementById("unitCounterList");
  const unitCounterCatalogHeaderTitle = document.getElementById("unitCounterCatalogHeaderTitle");
  const unitCounterCatalogHeaderHint = document.getElementById("unitCounterCatalogHeaderHint");
  const unitCounterCatalogSourceTabs = document.getElementById("unitCounterCatalogSourceTabs");
  const unitCounterCatalogSearchInput = document.getElementById("unitCounterCatalogSearchInput");
  const unitCounterLibraryVariantRow = document.getElementById("unitCounterLibraryVariantRow");
  const unitCounterLibraryReviewBar = document.getElementById("unitCounterLibraryReviewBar");
  const unitCounterLibraryReviewSummary = document.getElementById("unitCounterLibraryReviewSummary");
  const unitCounterLibraryExportBtn = document.getElementById("unitCounterLibraryExportBtn");
  const unitCounterCatalogCategoriesEl = document.getElementById("unitCounterCatalogCategories");
  const unitCounterCatalogGrid = document.getElementById("unitCounterCatalogGrid");
  const countryInspectorDetail = document.getElementById("countryInspectorDetail");
  const countryInspectorSelected = document.getElementById("countryInspectorSelected");
  const countryInspectorSetActive = document.getElementById("countryInspectorSetActive");
  const countryInspectorDetailHint = document.getElementById("countryInspectorDetailHint");
  const countryInspectorColorRow = document.getElementById("countryInspectorColorRow");
  const countryInspectorColorSwatch = document.getElementById("countryInspectorColorSwatch");
  const countryInspectorColorInput = document.getElementById("countryInspectorColorInput");
  const countryInspectorSection = document.getElementById("countryInspectorSection");
  const waterInspectorSection = document.getElementById("waterInspectorSection");
  const waterInspectorOpenOceanSelectToggle = document.getElementById("waterInspectorOpenOceanSelectToggle");
  const waterInspectorOpenOceanSelectHint = document.getElementById("waterInspectorOpenOceanSelectHint");
  const waterInspectorOpenOceanPaintToggle = document.getElementById("waterInspectorOpenOceanPaintToggle");
  const waterInspectorOpenOceanPaintHint = document.getElementById("waterInspectorOpenOceanPaintHint");
  const waterInspectorOverridesOnlyToggle = document.getElementById("waterInspectorOverridesOnlyToggle");
  const waterInspectorTypeFilter = document.getElementById("waterInspectorTypeFilter");
  const waterInspectorGroupFilter = document.getElementById("waterInspectorGroupFilter");
  const waterInspectorSourceFilter = document.getElementById("waterInspectorSourceFilter");
  const waterInspectorSortSelect = document.getElementById("waterInspectorSortSelect");
  const waterInspectorResultCount = document.getElementById("waterInspectorResultCount");
  const waterSearchInput = document.getElementById("waterRegionSearch");
  const waterRegionList = document.getElementById("waterRegionList");
  const waterLegendList = document.getElementById("waterLegendList");
  const waterInspectorEmpty = document.getElementById("waterInspectorEmpty");
  const waterInspectorSelected = document.getElementById("waterInspectorSelected");
  const waterInspectorDetailHint = document.getElementById("waterInspectorDetailHint");
  const waterInspectorMetaSection = document.getElementById("waterInspectorMetaSection");
  const waterInspectorMetaList = document.getElementById("waterInspectorMetaList");
  const waterInspectorHierarchySection = document.getElementById("waterInspectorHierarchySection");
  const waterInspectorJumpToParentBtn = document.getElementById("waterInspectorJumpToParentBtn");
  const waterInspectorChildrenList = document.getElementById("waterInspectorChildrenList");
  const waterInspectorColorRow = document.getElementById("waterInspectorColorRow");
  const waterInspectorColorLabel = document.getElementById("waterInspectorColorLabel");
  const waterInspectorColorSwatch = document.getElementById("waterInspectorColorSwatch");
  const waterInspectorColorValue = document.getElementById("waterInspectorColorValue");
  const waterInspectorColorInput = document.getElementById("waterInspectorColorInput");
  const clearWaterRegionColorBtn = document.getElementById("clearWaterRegionColorBtn");
  const waterInspectorBatchSection = document.getElementById("waterInspectorBatchSection");
  const waterInspectorScopeSelect = document.getElementById("waterInspectorScopeSelect");
  const waterInspectorScopePreview = document.getElementById("waterInspectorScopePreview");
  const applyWaterFamilyOverrideBtn = document.getElementById("applyWaterFamilyOverrideBtn");
  const clearWaterFamilyOverrideBtn = document.getElementById("clearWaterFamilyOverrideBtn");
  const specialRegionInspectorSection = document.getElementById("specialRegionInspectorSection");
  const scenarioSpecialRegionVisibilityToggle = document.getElementById("scenarioSpecialRegionVisibilityToggle");
  const scenarioSpecialRegionVisibilityHint = document.getElementById("scenarioSpecialRegionVisibilityHint");
  const scenarioReliefOverlayVisibilityToggle = document.getElementById("scenarioReliefOverlayVisibilityToggle");
  const scenarioReliefOverlayVisibilityHint = document.getElementById("scenarioReliefOverlayVisibilityHint");
  const specialRegionSearchInput = document.getElementById("specialRegionSearch");
  const specialRegionList = document.getElementById("specialRegionList");
  const specialRegionLegendList = document.getElementById("specialRegionLegendList");
  const specialRegionInspectorEmpty = document.getElementById("specialRegionInspectorEmpty");
  const specialRegionInspectorSelected = document.getElementById("specialRegionInspectorSelected");
  const specialRegionInspectorDetailHint = document.getElementById("specialRegionInspectorDetailHint");
  const specialRegionColorRow = document.getElementById("specialRegionColorRow");
  const specialRegionColorLabel = document.getElementById("specialRegionColorLabel");
  const specialRegionColorSwatch = document.getElementById("specialRegionColorSwatch");
  const specialRegionColorValue = document.getElementById("specialRegionColorValue");
  const specialRegionColorInput = document.getElementById("specialRegionColorInput");
  const clearSpecialRegionColorBtn = document.getElementById("clearSpecialRegionColorBtn");
  const selectedCountryActionsSection = document.getElementById("selectedCountryActionsSection");
  const selectedCountryActionsBody = selectedCountryActionsSection?.querySelector(".inspector-panel-body") || null;
  const frontlineProjectSection = document.getElementById("frontlineProjectSection");
  const projectLegendSection = document.getElementById("lblProjectLegend")?.closest("details");
  const legendProjectSection = document.getElementById("legendProjectSection");
  const diagnosticsSection = document.getElementById("lblDiagnostics")?.closest("details");
  initDevWorkspace();

  const updateScenarioInspectorLayout = () => {
    const isScenarioMode = !!runtimeState.activeScenarioId;
    const scenarioDefaultsKey = String(runtimeState.activeScenarioId || "__base__");
    // 切场景时只重置由 scenario 接管的 disclosure，
    // project/diagnostics 这类全局工具区继续保留独立壳层身份。
    if (scenarioDefaultsKey !== lastScenarioInspectorDefaultsKey) {
      collapseScenarioManagedSections();
      lastScenarioInspectorDefaultsKey = scenarioDefaultsKey;
    }
    projectLegendSection?.classList.toggle("inspector-section-secondary", isScenarioMode);
    legendProjectSection?.classList.toggle("inspector-section-secondary", isScenarioMode);
    diagnosticsSection?.classList.toggle("inspector-section-secondary", isScenarioMode);
    if (selectedCountryActionsSection) {
      selectedCountryActionsSection.classList.remove("hidden");
      selectedCountryActionsSection.setAttribute("aria-hidden", "false");
    }
  };

  const INSPECTOR_VH_BASELINE = {
    countryList: 14,
    countryListCap: 42,
    countryListCompactCap: 34,
    presetTreeCap: 52,
    presetTreeCompactCap: 48,
    selectedActionsBodyCap: 56,
    selectedActionsBodyCompactCap: 54,
    selectedActionsBodyVisualOpenCap: 66,
    selectedActionsBodyVisualOpenCompactCap: 64,
  };
  const INSPECTOR_PX_BASELINE = {
    actionList: 120,
    actionListCap: 240,
    presetBody: 240,
    presetBodyCap: 520,
    selectedActionsBodyReserve: 28,
  };
  let adaptiveInspectorHeightFrame = 0;
  let countryInspectorColorPickerOpen = false;
  let lastScenarioInspectorDefaultsKey = null;
  const inspectorDisclosureOpenByKey = new Map();

  const collapseScenarioManagedSections = () => {
    countryInspectorSection?.removeAttribute("open");
    selectedCountryActionsSection?.removeAttribute("open");
    waterInspectorSection?.removeAttribute("open");
    specialRegionInspectorSection?.removeAttribute("open");
    frontlineProjectSection?.removeAttribute("open");
  };

  const clampInspectorHeight = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
  const toViewportPixels = (vh) => (window.innerHeight * vh) / 100;

  const getInspectorDisclosureOpenState = (key, fallbackOpen) => {
    if (!key) return !!fallbackOpen;
    if (!inspectorDisclosureOpenByKey.has(key)) {
      inspectorDisclosureOpenByKey.set(key, !!fallbackOpen);
    }
    return !!inspectorDisclosureOpenByKey.get(key);
  };

  const setInspectorDisclosureOpenState = (key, isOpen) => {
    if (!key) return;
    inspectorDisclosureOpenByKey.set(key, !!isOpen);
  };

  const applyAdaptiveInspectorHeight = (element, minimum, maximum) => {
    if (!element) return;
    element.style.height = "";
    element.style.maxHeight = "";
    const scrollHeight = Number(element.scrollHeight || 0);
    const nextHeight = clampInspectorHeight(scrollHeight, minimum, maximum);
    element.style.height = `${Math.round(nextHeight)}px`;
    element.style.maxHeight = `${Math.round(nextHeight)}px`;
  };

  const releaseAdaptiveInspectorHeight = (element) => {
    if (!element) return;
    element.style.height = "";
    element.style.maxHeight = "";
  };

  const getCountryInspectorListCap = () => {
    const hasOpenActionStack = !!selectedCountryActionsSection?.open;
    const hasSelectedDetail = !!countryInspectorDetail && !countryInspectorDetail.classList.contains("hidden");
    return hasOpenActionStack || hasSelectedDetail
      ? INSPECTOR_VH_BASELINE.countryListCompactCap
      : INSPECTOR_VH_BASELINE.countryListCap;
  };

  const getPresetInspectorListCap = () => (
    countryInspectorSection?.open
      ? INSPECTOR_VH_BASELINE.presetTreeCompactCap
      : INSPECTOR_VH_BASELINE.presetTreeCap
  );

  const isScenarioVisualAdjustmentsExpanded = () => (
    !!selectedCountryActionsSection?.open
    && !!runtimeState.ui?.scenarioVisualAdjustmentsOpen
  );

  const getSelectedActionsBodyCap = () => {
    const hasOpenVisualAdjustments = isScenarioVisualAdjustmentsExpanded();
    if (countryInspectorSection?.open) {
      return hasOpenVisualAdjustments
        ? INSPECTOR_VH_BASELINE.selectedActionsBodyVisualOpenCompactCap
        : INSPECTOR_VH_BASELINE.selectedActionsBodyCompactCap;
    }
    return hasOpenVisualAdjustments
      ? INSPECTOR_VH_BASELINE.selectedActionsBodyVisualOpenCap
      : INSPECTOR_VH_BASELINE.selectedActionsBodyCap;
  };

  const isSelectedActionsEmptyState = () => (
    !!selectedCountryActionsSection?.classList.contains("is-empty-selection-panel")
  );

  const syncAdaptiveInspectorHeights = () => {
    adaptiveInspectorHeightFrame = 0;
    applyAdaptiveInspectorHeight(
      list,
      toViewportPixels(INSPECTOR_VH_BASELINE.countryList),
      toViewportPixels(getCountryInspectorListCap())
    );
    applyAdaptiveInspectorHeight(
      waterRegionList,
      toViewportPixels(18),
      toViewportPixels(32)
    );
    applyAdaptiveInspectorHeight(
      waterLegendList,
      96,
      220
    );
    applyAdaptiveInspectorHeight(
      specialRegionList,
      toViewportPixels(18),
      toViewportPixels(32)
    );
    applyAdaptiveInspectorHeight(
      specialRegionLegendList,
      96,
      220
    );
    releaseAdaptiveInspectorHeight(presetTree);
    const hasOpenVisualAdjustments = !isSelectedActionsEmptyState() && isScenarioVisualAdjustmentsExpanded();
    selectedCountryActionsSection?.classList.toggle(
      "has-open-visual-adjustments",
      hasOpenVisualAdjustments
    );
    if (isSelectedActionsEmptyState()) {
      releaseAdaptiveInspectorHeight(selectedCountryActionsBody);
    } else {
      applyAdaptiveInspectorHeight(
        selectedCountryActionsBody,
        INSPECTOR_PX_BASELINE.selectedActionsBodyReserve,
        toViewportPixels(getSelectedActionsBodyCap())
      );
    }
    sidebar?.querySelectorAll(".preset-country-body").forEach((element) => {
      applyAdaptiveInspectorHeight(
        element,
        INSPECTOR_PX_BASELINE.presetBody,
        INSPECTOR_PX_BASELINE.presetBodyCap
      );
    });
  };

  const scheduleAdaptiveInspectorHeights = () => {
    if (adaptiveInspectorHeightFrame) {
      globalThis.cancelAnimationFrame(adaptiveInspectorHeightFrame);
    }
    adaptiveInspectorHeightFrame = globalThis.requestAnimationFrame(syncAdaptiveInspectorHeights);
  };

  const LEFT_SIDEBAR_COLLAPSED_KEY = "map_left_sidebar_collapsed";
  const RIGHT_SIDEBAR_COLLAPSED_KEY = "map_right_sidebar_collapsed";
  const leftSidebarCollapseMedia = typeof globalThis.matchMedia === "function"
    ? globalThis.matchMedia("(min-width: 1024px)")
    : null;
  const rightSidebarCollapseMedia = typeof globalThis.matchMedia === "function"
    ? globalThis.matchMedia("(min-width: 1024px)")
    : null;
  const SIDEBAR_LAYOUT_START_EVENT = "mapcreator:sidebar-layout-start";
  const SIDEBAR_LAYOUT_REFRESH_EVENT = "mapcreator:sidebar-layout-refresh";
  const SIDEBAR_LAYOUT_REFRESH_DELAY_MS = 280;
  let leftSidebarCollapsePreference = false;
  let leftSidebarLayoutRefreshTimer = 0;
  let rightSidebarCollapsePreference = false;
  let rightSidebarLayoutRefreshTimer = 0;

  const canCollapseLeftSidebar = () => (
    !leftSidebarCollapseMedia || !!leftSidebarCollapseMedia.matches
  );

  const canCollapseRightSidebar = () => (
    !rightSidebarCollapseMedia || !!rightSidebarCollapseMedia.matches
  );

  const refreshCollapsedSidebarLayout = () => {
    scheduleAdaptiveInspectorHeights();
    globalThis.dispatchEvent(new CustomEvent(SIDEBAR_LAYOUT_REFRESH_EVENT));
  };

  const beginCollapsedSidebarLayout = () => {
    globalThis.dispatchEvent(new CustomEvent(SIDEBAR_LAYOUT_START_EVENT));
  };

  const requestLeftSidebarLayoutRefresh = () => {
    if (leftSidebarLayoutRefreshTimer) {
      globalThis.clearTimeout(leftSidebarLayoutRefreshTimer);
    }
    scheduleAdaptiveInspectorHeights();
    leftSidebarLayoutRefreshTimer = globalThis.setTimeout(() => {
      refreshCollapsedSidebarLayout();
      leftSidebarLayoutRefreshTimer = 0;
    }, SIDEBAR_LAYOUT_REFRESH_DELAY_MS);
  };

  const requestRightSidebarLayoutRefresh = () => {
    if (rightSidebarLayoutRefreshTimer) {
      globalThis.clearTimeout(rightSidebarLayoutRefreshTimer);
    }
    scheduleAdaptiveInspectorHeights();
    rightSidebarLayoutRefreshTimer = globalThis.setTimeout(() => {
      refreshCollapsedSidebarLayout();
      rightSidebarLayoutRefreshTimer = 0;
    }, SIDEBAR_LAYOUT_REFRESH_DELAY_MS);
  };

  const setLeftSidebarCollapsed = (collapsed, { persist = true, refreshLayout = true } = {}) => {
    leftSidebarCollapsePreference = !!collapsed;
    const effectiveCollapsed = leftSidebarCollapsePreference && canCollapseLeftSidebar();
    document.body.classList.toggle("left-sidebar-collapsed", effectiveCollapsed);
    leftSidebar?.classList.toggle("is-collapsed", effectiveCollapsed);
    leftSidebarContent?.toggleAttribute("inert", effectiveCollapsed);
    leftSidebarContent?.setAttribute("aria-hidden", effectiveCollapsed ? "true" : "false");
    leftSidebarCollapseBtn?.setAttribute("aria-expanded", effectiveCollapsed ? "false" : "true");
    const nextSidebarLabel = effectiveCollapsed ? "Expand left sidebar" : "Collapse left sidebar";
    leftSidebarCollapseBtn?.setAttribute("data-i18n-aria-label", nextSidebarLabel);
    leftSidebarCollapseBtn?.setAttribute("aria-label", t(nextSidebarLabel, "ui"));
    if (leftSidebarCollapseIcon) {
      leftSidebarCollapseIcon.textContent = effectiveCollapsed ? ">" : "<";
    }
    if (persist) {
      try {
        globalThis.localStorage?.setItem(LEFT_SIDEBAR_COLLAPSED_KEY, leftSidebarCollapsePreference ? "true" : "false");
      } catch (_error) {
        // localStorage can be unavailable in privacy-restricted contexts.
      }
    }
    if (refreshLayout) {
      beginCollapsedSidebarLayout();
      requestLeftSidebarLayoutRefresh();
    }
  };

  const setRightSidebarCollapsed = (collapsed, { persist = true, refreshLayout = true } = {}) => {
    rightSidebarCollapsePreference = !!collapsed;
    const effectiveCollapsed = rightSidebarCollapsePreference && canCollapseRightSidebar();
    document.body.classList.toggle("right-sidebar-collapsed", effectiveCollapsed);
    sidebar?.classList.toggle("is-collapsed", effectiveCollapsed);
    rightSidebarContent?.toggleAttribute("inert", effectiveCollapsed);
    rightSidebarContent?.setAttribute("aria-hidden", effectiveCollapsed ? "true" : "false");
    rightSidebarCollapseBtn?.setAttribute("aria-expanded", effectiveCollapsed ? "false" : "true");
    const nextSidebarLabel = effectiveCollapsed ? "Expand right sidebar" : "Collapse right sidebar";
    rightSidebarCollapseBtn?.setAttribute("data-i18n-aria-label", nextSidebarLabel);
    rightSidebarCollapseBtn?.setAttribute("aria-label", t(nextSidebarLabel, "ui"));
    if (rightSidebarCollapseIcon) {
      rightSidebarCollapseIcon.textContent = effectiveCollapsed ? "<" : ">";
    }
    if (persist) {
      try {
        globalThis.localStorage?.setItem(RIGHT_SIDEBAR_COLLAPSED_KEY, rightSidebarCollapsePreference ? "true" : "false");
      } catch (_error) {
        // localStorage can be unavailable in privacy-restricted contexts.
      }
    }
    if (refreshLayout) {
      beginCollapsedSidebarLayout();
      requestRightSidebarLayoutRefresh();
    }
  };

  const restoreLeftSidebarCollapsedState = () => {
    try {
      leftSidebarCollapsePreference = globalThis.localStorage?.getItem(LEFT_SIDEBAR_COLLAPSED_KEY) === "true";
    } catch (_error) {
      leftSidebarCollapsePreference = false;
    }
    setLeftSidebarCollapsed(leftSidebarCollapsePreference, { persist: false, refreshLayout: false });
  };

  const restoreRightSidebarCollapsedState = () => {
    try {
      rightSidebarCollapsePreference = globalThis.localStorage?.getItem(RIGHT_SIDEBAR_COLLAPSED_KEY) === "true";
    } catch (_error) {
      rightSidebarCollapsePreference = false;
    }
    setRightSidebarCollapsed(rightSidebarCollapsePreference, { persist: false, refreshLayout: false });
  };

  const syncLeftSidebarCollapsedMedia = () => {
    setLeftSidebarCollapsed(leftSidebarCollapsePreference, { persist: false });
  };

  const syncRightSidebarCollapsedMedia = () => {
    setRightSidebarCollapsed(rightSidebarCollapsePreference, { persist: false });
  };


  if (!(runtimeState.expandedInspectorContinents instanceof Set)) {
    runtimeState.expandedInspectorContinents = new Set();
  }
  if (!(runtimeState.expandedInspectorReleaseParents instanceof Set)) {
    runtimeState.expandedInspectorReleaseParents = new Set();
  }
  if (typeof runtimeState.selectedInspectorCountryCode !== "string") {
    runtimeState.selectedInspectorCountryCode = "";
  }
  if (typeof runtimeState.ui?.scenarioVisualAdjustmentsOpen !== "boolean") {
    runtimeState.ui.scenarioVisualAdjustmentsOpen = false;
  }
  if (typeof runtimeState.ui?.politicalEditingExpanded !== "boolean") {
    runtimeState.ui.politicalEditingExpanded = false;
  }
  if (typeof runtimeState.inspectorExpansionInitialized !== "boolean") {
    runtimeState.inspectorExpansionInitialized = false;
  }

  let latestCountryStatesByCode = new Map();
  const countryRowRefsByCode = new Map();
  let hgoIdentityResolver = null;
  const hgoIdentityLoadState = {
    status: "idle",
    error: "",
  };
  const ensureHgoIdentityRuntimeState = () => {
    if (!runtimeState.hgoIdentity || typeof runtimeState.hgoIdentity !== "object") {
      runtimeState.hgoIdentity = {};
    }
    runtimeState.hgoIdentity.enabled = runtimeState.hgoIdentity.enabled === true;
    runtimeState.hgoIdentity.nameMode = runtimeState.hgoIdentity.nameMode === "hgo" ? "hgo" : "scenario";
    runtimeState.hgoIdentity.showSuggestedAliases = runtimeState.hgoIdentity.showSuggestedAliases !== false;
    if (!runtimeState.hgoIdentity.variantSelections || typeof runtimeState.hgoIdentity.variantSelections !== "object") {
      runtimeState.hgoIdentity.variantSelections = {};
    }
    return runtimeState.hgoIdentity;
  };
  const resolveHgoIdentityForCountry = (countryState, options = {}) => {
    const settings = ensureHgoIdentityRuntimeState();
    if (!hgoIdentityResolver) return null;
    const countryCode = normalizeCountryCode(countryState?.code || countryState?.tag || "");
    return hgoIdentityResolver.resolveIdentity(countryState, {
      ...options,
      preferredVariantKey: options.preferredVariantKey || settings.variantSelections[countryCode] || "",
    });
  };
  const getHgoIdentityCoverage = (countryStates, options = {}) => (
    hgoIdentityResolver ? hgoIdentityResolver.summarizeCoverage(countryStates, options) : null
  );
  const ensureHgoIdentityAssetsLoaded = () => {
    if (hgoIdentityLoadState.status === "loading" || hgoIdentityLoadState.status === "ready") {
      return;
    }
    hgoIdentityLoadState.status = "loading";
    hgoIdentityLoadState.error = "";
    Promise.all([
      loadRuntimeJsonAsset("hgo_place_names"),
      loadRuntimeJsonAsset("hgo_flags_png_manifest"),
      loadRuntimeJsonAsset("hgo_identity_aliases"),
      loadRuntimeJsonAsset("hgo_palette_pack"),
    ])
      .then(([placeNames, flagsManifest, aliases, palettePack]) => {
        hgoIdentityResolver = createHgoIdentityResolver({
          placeNames,
          flagsManifest,
          aliases,
          palettePack,
        });
        hgoIdentityLoadState.status = "ready";
        renderList();
      })
      .catch((error) => {
        hgoIdentityLoadState.status = "error";
        hgoIdentityLoadState.error = error?.message || String(error || "");
        console.warn("[hgo_identity] HGO identity assets unavailable.", error);
        renderList();
      });
  };
  const incrementSidebarCounter = (counterName, amount = 1) => {
    const sidebarPerf = ensureSidebarPerfState(state);
    if (!Number.isFinite(Number(sidebarPerf.counters[counterName]))) {
      sidebarPerf.counters[counterName] = 0;
    }
    sidebarPerf.counters[counterName] += Number(amount || 0);
  };

  const getInspectorCountryDisplayName = (code) => {
    const normalized = normalizeCountryCode(code);
    if (!normalized) return "";
    const inspectorState = latestCountryStatesByCode.get(normalized);
    if (inspectorState?.displayName) {
      return inspectorState.displayName;
    }
    const scenarioCountry = runtimeState.scenarioCountriesByTag?.[normalized];
    const scenarioName = getScenarioCountryDisplayName(scenarioCountry);
    if (scenarioName) {
      return t(scenarioName, "geo") || scenarioName;
    }
    const fallbackName = String(runtimeState.countryNames?.[normalized] || countryNames[normalized] || normalized).trim();
    return t(fallbackName, "geo") || fallbackName || normalized;
  };

  const formatReleasableParentLabel = (countryState, { conjunction = false } = {}) => {
    const parentCodes = Array.isArray(countryState?.parentOwnerTags) && countryState.parentOwnerTags.length
      ? countryState.parentOwnerTags
      : (countryState?.parentOwnerTag ? [countryState.parentOwnerTag] : []);
    const labels = parentCodes
      .map((parentCode) => getInspectorCountryDisplayName(parentCode))
      .filter(Boolean);
    if (!conjunction || labels.length <= 1) {
      return labels.join(", ");
    }
    if (labels.length === 2) {
      return `${labels[0]} ${t("and", "ui")} ${labels[1]}`;
    }
    return `${labels.slice(0, -1).join(", ")} ${t("and", "ui")} ${labels[labels.length - 1]}`;
  };

  const getScenarioSubjectKindLabel = (countryState) => {
    const normalizedKind = String(countryState?.subjectKind || countryState?.subject_kind || "").trim().toLowerCase();
    if (!normalizedKind) return "";
    const labels = {
      raj: t("Raj", "ui"),
      dominion: t("Dominion", "ui"),
      mandate: t("Mandate", "ui"),
      protectorate: t("Protectorate", "ui"),
      client_state: t("Client State", "ui"),
      condominium: t("Condominium", "ui"),
      colony: t("Colony", "ui"),
      commonwealth: t("Commonwealth", "ui"),
      colonial_government: t("Colonial Government", "ui"),
      colonial_federation: t("Colonial Federation", "ui"),
    };
    return labels[normalizedKind] || normalizedKind.replace(/_/g, " ");
  };

  const normalizeCountryDisplayNameCandidate = (value) => {
    const text = String(value ?? "").trim();
    if (!text || /^(undefined|null)$/i.test(text)) return "";
    return text;
  };

  const buildCountryRowMetaText = (countryState, { showRelationMeta = false } = {}) => {
    const metaBits = [countryState?.subregionDisplayLabel].filter(Boolean);
    if (countryState?.releasable && showRelationMeta) {
      const parentLabel = formatReleasableParentLabel(countryState);
      metaBits.push(
        parentLabel
          ? `${t("Releasable from", "ui")} ${parentLabel}`
          : t("Releasable", "ui")
      );
    } else if (countryState?.scenarioSubject && showRelationMeta) {
      const isCondominium = String(countryState?.subjectKind || countryState?.subject_kind || "").trim().toLowerCase() === "condominium";
      const parentLabel = formatReleasableParentLabel(countryState, { conjunction: isCondominium });
      const subjectLabel = getScenarioSubjectKindLabel(countryState);
      metaBits.push(
        parentLabel
          ? `${subjectLabel || t("Subject", "ui")} ${t("of", "ui")} ${parentLabel}`
          : (subjectLabel || t("Subject", "ui"))
      );
    }
    return metaBits.join(" · ");
  };

  const createCountryInspectorState = (entry, fallbackIndex = 0) => {
    const inlineReleasableMeta = !!(entry?.releasable || String(entry?.entry_kind || entry?.entryKind || "").trim() === "releasable");
    const scenarioMeta = inlineReleasableMeta
      ? (entry || getScenarioCountryMeta(entry.code) || {})
      : (getScenarioCountryMeta(entry.code) || entry || {});
    const normalizedEntryCode = normalizeCountryCode(entry?.code || scenarioMeta.code || scenarioMeta.tag);
    const fallbackDisplayName = normalizeCountryDisplayNameCandidate(
      entry?.displayName
      || entry?.name
      || scenarioMeta?.preset_source?.name
      || scenarioMeta?.presetSource?.name
      || runtimeState.countryNames?.[normalizedEntryCode]
      || countryNames[normalizedEntryCode]
      || normalizedEntryCode
    );
    const scenarioDisplayName = normalizeCountryDisplayNameCandidate(
      getScenarioCountryDisplayName(scenarioMeta, fallbackDisplayName)
    );
    const displayNameSource = scenarioDisplayName.toUpperCase() === normalizedEntryCode && fallbackDisplayName
      ? fallbackDisplayName
      : (scenarioDisplayName || fallbackDisplayName || normalizedEntryCode);
    const displayName = t(displayNameSource, "geo") || displayNameSource || normalizedEntryCode;
    const name = normalizeCountryDisplayNameCandidate(displayNameSource || entry?.name || normalizedEntryCode) || normalizedEntryCode;
    const lookupIso2 = resolveScenarioLookupCode(entry);
    const inspectorDataCode = resolveInspectorDataCode(entry);
    const presetLookupCode = resolveScenarioLookupCode(entry);
    const groupLookupCode = resolveCountryGroupingCode(entry);
    const groupingMeta = getCountryGroupingMeta(entry) || {};
    const entryKind = String(scenarioMeta.entry_kind || entry.entryKind || "").trim();
    const ownerFeatureCount = Number(
      scenarioMeta.feature_count
      ?? entry.ownerFeatureCount
      ?? entry.featureCount
      ?? 0
    ) || 0;
    const controllerFeatureCount = Number(
      scenarioMeta.controller_feature_count
      ?? entry.controllerFeatureCount
      ?? 0
    ) || 0;
    const featureCount = ownerFeatureCount;
    const continentId = String(
      scenarioMeta.continent_id || scenarioMeta.continentId || groupingMeta.continentId || "continent_other"
    );
    const continentLabel = String(
      scenarioMeta.continent_label || scenarioMeta.continentLabel || groupingMeta.continentLabel || "Other"
    );
    const subregionId = String(
      scenarioMeta.subregion_id || scenarioMeta.subregionId || groupingMeta.subregionId || "subregion_unclassified"
    );
    const subregionLabel = String(
      scenarioMeta.subregion_label || scenarioMeta.subregionLabel || groupingMeta.subregionLabel || "Unclassified"
    );
    const inspectorGroupMeta = resolveScenarioInspectorGroupMeta(entry);
    const inspectorGroupId = inspectorGroupMeta.id;
    const inspectorGroupLabel = inspectorGroupMeta.label;
    const inspectorGroupAnchorId = inspectorGroupMeta.anchorId;
    const topLevelGroupId = inspectorGroupId || continentId;
    const topLevelGroupLabel = inspectorGroupLabel || continentLabel;
    // inspector 状态把 lookup/preset/grouping code 分开保存：
    // 列表分组、预设读取和详情展示可能各自指向不同来源，不能在这里合并成一个 code。
    return {
      ...entry,
      code: normalizedEntryCode || entry.code,
      name,
      displayName,
      fallbackIndex,
      lookupIso2,
      inspectorDataCode,
      presetLookupCode,
      groupingCode: groupLookupCode,
      presets: runtimeState.presetsState[presetLookupCode] || [],
      hierarchyGroups: scenarioMeta.releasable ? [] : getHierarchyGroupsForCode(groupLookupCode),
      continentId,
      continentLabel,
      continentDisplayLabel: t(continentLabel, "geo") || continentLabel,
      subregionId,
      subregionLabel,
      subregionDisplayLabel: t(subregionLabel, "geo") || subregionLabel,
      inspectorGroupId,
      inspectorGroupLabel,
      inspectorGroupAnchorId,
      topLevelGroupId,
      topLevelGroupLabel,
      topLevelGroupDisplayLabel: t(topLevelGroupLabel, "geo") || topLevelGroupLabel,
      topLevelGroupAnchorId: inspectorGroupAnchorId,
      quality: String(scenarioMeta.quality || entry.quality || "").trim(),
      featureCount,
      ownerFeatureCount,
      controllerFeatureCount,
      baseIso2: String(scenarioMeta.base_iso2 || entry.baseIso2 || "").trim().toUpperCase(),
      releaseLookupIso2: String(
        scenarioMeta.release_lookup_iso2
        || entry.releaseLookupIso2
        || ""
      ).trim().toUpperCase(),
      scenarioOnly: !!(scenarioMeta.scenario_only ?? entry.scenarioOnly),
      releasable: !!(scenarioMeta.releasable ?? entry.releasable),
      scenarioSubject: entryKind === "scenario_subject",
      entryKind,
      subjectKind: String(scenarioMeta.subject_kind || entry.subjectKind || "").trim().toLowerCase(),
      parentOwnerTag: String(scenarioMeta.parent_owner_tag || entry.parentOwnerTag || "").trim().toUpperCase(),
      parentOwnerTags: Array.isArray(scenarioMeta.parent_owner_tags)
        ? scenarioMeta.parent_owner_tags.map((value) => String(value || "").trim().toUpperCase()).filter(Boolean)
        : Array.isArray(entry.parentOwnerTags)
          ? entry.parentOwnerTags
          : [],
      disabledRegionalPresetNames: (
        Array.isArray(scenarioMeta.disabled_regional_preset_names)
          ? scenarioMeta.disabled_regional_preset_names
          : Array.isArray(entry.disabledRegionalPresetNames)
            ? entry.disabledRegionalPresetNames
            : []
      )
        .map((value) => normalizePresetName(value))
        .filter(Boolean),
      disabledRegionalPresetReason: String(
        scenarioMeta.disabled_regional_preset_reason
        || entry.disabledRegionalPresetReason
        || ""
      ).trim(),
      syntheticOwner: !!(scenarioMeta.synthetic_owner ?? entry.syntheticOwner),
      hiddenFromCountryList: !!(scenarioMeta.hidden_from_country_list ?? entry.hiddenFromCountryList),
      featured: !!(scenarioMeta.featured ?? entry.featured),
      catalogOrder: Number(scenarioMeta.catalog_order ?? entry.catalogOrder ?? Number.MAX_SAFE_INTEGER),
      notes: String(scenarioMeta.notes || entry.notes || "").trim(),
      defaultBoundaryVariantId: String(
        scenarioMeta.default_boundary_variant_id
        || entry.defaultBoundaryVariantId
        || ""
      ).trim().toLowerCase(),
      selectedBoundaryVariantId: String(
        scenarioMeta.selected_boundary_variant_id
        || entry.selectedBoundaryVariantId
        || ""
      ).trim().toLowerCase(),
      selectedBoundaryVariantLabel: String(
        scenarioMeta.selected_boundary_variant_label
        || entry.selectedBoundaryVariantLabel
        || ""
      ).trim(),
      selectedBoundaryVariantDescription: String(
        scenarioMeta.selected_boundary_variant_description
        || entry.selectedBoundaryVariantDescription
        || ""
      ).trim(),
      boundaryVariants: Array.isArray(scenarioMeta.boundary_variants)
        ? scenarioMeta.boundary_variants
        : Array.isArray(entry.boundaryVariants)
          ? entry.boundaryVariants
          : [],
      companionActions: Array.isArray(scenarioMeta.companion_actions)
        ? scenarioMeta.companion_actions
        : Array.isArray(entry.companionActions)
          ? entry.companionActions
          : [],
    };
  };

  const compareRelatedCountryStates = (a, b) => {
    const catalogOrderDelta = Number(a?.catalogOrder ?? Number.MAX_SAFE_INTEGER)
      - Number(b?.catalogOrder ?? Number.MAX_SAFE_INTEGER);
    if (catalogOrderDelta !== 0) return catalogOrderDelta;
    const featureDelta = Number(b?.featureCount || 0) - Number(a?.featureCount || 0);
    if (featureDelta !== 0) return featureDelta;
    return String(a?.displayName || "").localeCompare(String(b?.displayName || ""));
  };

  const getScenarioSubjectChildrenForParent = (parentTag) => {
    const normalizedParent = normalizeCountryCode(parentTag);
    if (!normalizedParent) return [];
    return Array.from(latestCountryStatesByCode.values())
      .filter((countryState) => {
        if (!countryState?.scenarioSubject || countryState?.releasable) return false;
        const parentTags = Array.isArray(countryState.parentOwnerTags) && countryState.parentOwnerTags.length
          ? countryState.parentOwnerTags
          : (countryState.parentOwnerTag ? [countryState.parentOwnerTag] : []);
        return parentTags.includes(normalizedParent);
      })
      .sort(compareRelatedCountryStates);
  };

  const getReleasableChildrenForParent = (parentTag) => {
    const normalizedParent = normalizeCountryCode(parentTag);
    if (!normalizedParent) return [];
    const childTags = Array.isArray(runtimeState.scenarioReleasableIndex?.childTagsByParent?.[normalizedParent])
      ? runtimeState.scenarioReleasableIndex.childTagsByParent[normalizedParent]
      : [];
    return childTags
      .map((childTag, childIndex) => {
        const normalizedChild = normalizeCountryCode(childTag);
        const existingState = latestCountryStatesByCode.get(normalizedChild);
        const existingParentTags = Array.isArray(existingState?.parentOwnerTags) && existingState.parentOwnerTags.length
          ? existingState.parentOwnerTags
          : (existingState?.parentOwnerTag ? [existingState.parentOwnerTag] : []);
        if (existingState?.scenarioSubject && existingParentTags.includes(normalizedParent)) {
          return null;
        }
        const releasableEntry = runtimeState.scenarioReleasableIndex?.byTag?.[normalizedChild];
        if (releasableEntry && typeof releasableEntry === "object") {
          return createCountryInspectorState({
            code: normalizedChild,
            display_name: releasableEntry.display_name,
            display_name_en: releasableEntry.display_name_en,
            display_name_zh: releasableEntry.display_name_zh,
            color_hex: releasableEntry.color_hex,
            feature_count: Number(releasableEntry.resolved_feature_count_hint || 0),
            release_lookup_iso2: releasableEntry.release_lookup_iso2,
            releasable: true,
            entry_kind: "releasable",
            scenario_only: true,
            parent_owner_tag: releasableEntry.parent_owner_tag,
            parent_owner_tags: Array.isArray(releasableEntry.parent_owner_tags)
              ? releasableEntry.parent_owner_tags
              : [],
            capital_state_id: Number(releasableEntry.capital_state_id || 0) || 0,
            core_state_ids: Array.isArray(releasableEntry.core_state_ids)
              ? releasableEntry.core_state_ids
              : [],
            default_boundary_variant_id: releasableEntry.default_boundary_variant_id,
            boundary_variants: Array.isArray(releasableEntry.boundary_variants)
              ? releasableEntry.boundary_variants
              : [],
            companion_actions: Array.isArray(releasableEntry.companion_actions)
              ? releasableEntry.companion_actions
              : [],
            preset_source: releasableEntry.preset_source,
            notes: String(releasableEntry.notes || "").trim(),
            continent_id: releasableEntry.continent_id,
            continent_label: releasableEntry.continent_label,
            subregion_id: releasableEntry.subregion_id,
            subregion_label: releasableEntry.subregion_label,
            catalog_order: Number(releasableEntry.catalog_order ?? childIndex),
          }, childIndex);
        }
        return latestCountryStatesByCode.get(normalizedChild);
      })
      .filter(Boolean)
      .sort(compareRelatedCountryStates);
  };

  const getCountryChildSectionsForParent = (parentTag, { matchedChildCodes = null } = {}) => {
    const matchSet = matchedChildCodes instanceof Set ? matchedChildCodes : null;
    const filterMatched = (states) => (
      matchSet
        ? states.filter((countryState) => matchSet.has(countryState.code))
        : states
    );
    const sections = [];
    const scenarioSubjects = filterMatched(getScenarioSubjectChildrenForParent(parentTag));
    if (scenarioSubjects.length) {
      sections.push({
        id: "scenario-subjects",
        label: t("Subject Governments", "ui"),
        states: scenarioSubjects,
      });
    }
    const releasables = filterMatched(getReleasableChildrenForParent(parentTag));
    if (releasables.length) {
      sections.push({
        id: "releasables",
        label: t("Releasable Countries", "ui"),
        states: releasables,
      });
    }
    return sections;
  };

  const getResolvedCountryColor = (countryState) => {
    if (!countryState?.code) return "#cccccc";
    const fallbackColor = ensureCountryPaletteColor(countryState.code, countryState.fallbackIndex || 0);
    return (
      runtimeState.sovereignBaseColors?.[countryState.code] ||
      runtimeState.countryBaseColors?.[countryState.code] ||
      runtimeState.countryPalette?.[countryState.code] ||
      fallbackColor
    );
  };

  const getDisplayCountryColor = (countryState) =>
    ColorManager.normalizeHexColor(getResolvedCountryColor(countryState)) || "#cccccc";

  const syncSelectedColorFromCountry = (countryState) => {
    const resolvedColor = getDisplayCountryColor(countryState);
    runtimeState.selectedColor = resolvedColor;
    callRuntimeHook(state, "updateSwatchUIFn");
  };

  const paletteColorSuggestionCache = new Map();

  const getPaletteColorSuggestionCacheKey = (countryState = {}) => JSON.stringify({
    language: runtimeState.currentLanguage || "en",
    paletteCount: Array.isArray(runtimeState.paletteRegistry?.palettes)
      ? runtimeState.paletteRegistry.palettes.length
      : 0,
    code: countryState.code || "",
    lookupIso2: countryState.lookupIso2 || "",
    baseIso2: countryState.baseIso2 || "",
    releaseLookupIso2: countryState.releaseLookupIso2 || "",
    presetLookupCode: countryState.presetLookupCode || "",
    name: countryState.name || "",
    displayName: countryState.displayName || "",
  });

  const loadPaletteColorSuggestionsForCountry = async (countryState) => {
    const cacheKey = getPaletteColorSuggestionCacheKey(countryState);
    if (paletteColorSuggestionCache.has(cacheKey)) {
      return paletteColorSuggestionCache.get(cacheKey);
    }

    const registryEntries = Array.isArray(runtimeState.paletteRegistry?.palettes)
      ? runtimeState.paletteRegistry.palettes
      : [];
    const assets = (await Promise.all(registryEntries.map(async (meta) => {
      const paletteId = String(meta?.palette_id || "").trim();
      if (!paletteId) return null;
      try {
        const loaded = await ensurePaletteAssetsLoaded(paletteId);
        return {
          paletteId,
          paletteLabel: String(meta?.display_name || paletteId),
          meta: loaded.meta || meta,
          pack: loaded.pack,
          map: loaded.map,
        };
      } catch (error) {
        console.warn("[sidebar] Failed to load palette suggestions:", error);
        return null;
      }
    }))).filter(Boolean);

    const suggestions = buildPaletteColorSuggestionsForCountry(countryState, assets);
    paletteColorSuggestionCache.set(cacheKey, suggestions);
    return suggestions;
  };

  const getLocalizedPaletteSuggestionLabel = (suggestion, countryState = null) => {
    if (!suggestion) return "";
    const language = runtimeState.currentLanguage === "zh" ? "zh" : "en";
    const localizedName = language === "zh"
      ? (
        String(suggestion.localizedNameZh || "").trim()
        || String(countryState?.displayName || "").trim()
        || t(suggestion.label, "geo")
      )
      : (
        String(suggestion.localizedNameEn || "").trim()
        || String(suggestion.label || "").trim()
      );
    return String(localizedName || suggestion.label || suggestion.sourceTag || "").trim();
  };

  const getLocalizedPaletteSuggestionPaletteLabel = (suggestion) => {
    const paletteLabel = String(suggestion?.paletteLabel || suggestion?.paletteId || "").trim();
    return t(paletteLabel, "ui") || paletteLabel;
  };

  const formatPaletteColorSuggestionText = (suggestion, countryState = null, { includeColor = false } = {}) => {
    const parts = [
      getLocalizedPaletteSuggestionPaletteLabel(suggestion),
      getLocalizedPaletteSuggestionLabel(suggestion, countryState),
    ].filter(Boolean);
    if (includeColor && suggestion?.color) {
      parts.push(suggestion.color);
    }
    return parts.join(" · ");
  };

  const applyPaletteColorSuggestion = (suggestion, previewButton) => {
    if (!suggestion?.color) return;
    const suggestionText = formatPaletteColorSuggestionText(suggestion);
    runtimeState.selectedColor = suggestion.color;
    callRuntimeHook(state, "updateSwatchUIFn");
    if (previewButton) {
      previewButton.style.backgroundColor = suggestion.color;
      previewButton.title = `${t("Palette color suggestion", "ui")}: ${suggestionText}`;
      previewButton.setAttribute(
        "aria-label",
        `${t("Palette color suggestion", "ui")}: ${suggestionText}`
      );
    }
    showToast(suggestionText, {
      title: t("Palette color suggestion applied", "ui"),
      tone: "info",
      duration: 2200,
    });
  };

  const storeVisualOpen = (nextOpen) => {
    if (!runtimeState.ui || typeof runtimeState.ui !== "object") runtimeState.ui = {};
    runtimeState.ui.scenarioVisualAdjustmentsOpen = !!nextOpen;
  };

  const setScenarioVisualAdjustmentsOpen = (nextOpen, { scrollIntoView = false } = {}) => {
    storeVisualOpen(nextOpen);
    if (selectedCountryActionsSection) {
      selectedCountryActionsSection.open = true;
      if (scrollIntoView) {
        selectedCountryActionsSection.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
    callRuntimeHook(state, "renderPresetTreeFn");
  };

  registerRuntimeHook(state, "openScenarioVisualAdjustmentsFn", ({ scrollIntoView = false } = {}) => {
    setScenarioVisualAdjustmentsOpen(true, { scrollIntoView });
  });

  const setScenarioMapPaintMode = (nextMode) => {
    const normalizedMode = normalizePaintMode(nextMode);
    runtimeState.paintMode = normalizedMode;
    if (normalizedMode === "sovereignty") {
      runtimeState.interactionGranularity = "subdivision";
    }
    callRuntimeHook(state, "updatePaintModeUIFn");
    flushSidebarRender(`sidebar-paint-mode:${normalizedMode}`);
  };

  const applyVisualColorToOwnedRegions = (countryState, { renderNow = render, color = null } = {}) => {
    const { requestedIds, matchedIds } = getOwnedVisibleFeatureIds(countryState?.code);
    if (!requestedIds.length || !matchedIds.length) {
      return {
        applied: false,
        changed: 0,
        matchedCount: matchedIds.length,
        requestedCount: requestedIds.length,
        missingCount: 0,
        reason: "no-owned-features",
      };
    }
    return applyVisualOverridesToFeatureIds(
      matchedIds,
      color || getResolvedCountryColor(countryState),
      {
        render: renderNow,
        historyKind: "scenario-country-visual-fill",
        dirtyReason: "scenario-country-visual-fill",
      }
    );
  };

  const clearCountryVisualOverrides = (countryState, { renderNow = render } = {}) => {
    const { requestedIds, matchedIds } = getOwnedVisibleFeatureIds(countryState?.code);
    if (!requestedIds.length || !matchedIds.length) {
      return {
        applied: false,
        changed: 0,
        matchedCount: matchedIds.length,
        requestedCount: requestedIds.length,
        missingCount: 0,
        reason: "no-owned-features",
      };
    }
    return clearVisualOverridesForFeatureIds(matchedIds, {
      render: renderNow,
      historyKind: "scenario-country-visual-clear",
      dirtyReason: "scenario-country-visual-clear",
    });
  };

  const createEmptyNote = (text) => {
    const note = document.createElement("div");
    note.className = "inspector-empty-note";
    note.textContent = text;
    return note;
  };

  const createInspectorActionButton = (label, onClick) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "inspector-item-btn";
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  };

  const countryInspectorController = createCountryInspectorController({
    runtimeState: state,
    list,
    searchInput,
    selectedCountryActionsSection,
    countryInspectorDetail,
    countryInspectorSelected,
    countryInspectorSetActive,
    countryInspectorDetailHint,
    countryInspectorColorRow,
    countryInspectorColorSwatch,
    countryInspectorColorInput,
    countryRowRefsByCode,
    getLatestCountryStatesByCode: () => latestCountryStatesByCode,
    setLatestCountryStatesByCode: (nextMap) => {
      latestCountryStatesByCode = nextMap instanceof Map ? nextMap : new Map();
    },
    getCountryInspectorColorPickerOpen: () => countryInspectorColorPickerOpen,
    setCountryInspectorColorPickerOpen: (isOpen) => {
      countryInspectorColorPickerOpen = !!isOpen;
    },
    t,
    normalizeCountryCode,
    normalizeHexColor: (value) => ColorManager.normalizeHexColor(value),
    updateScenarioInspectorLayout,
    scheduleAdaptiveInspectorHeights,
    flushSidebarRender,
    createEmptyNote,
    getDynamicCountryEntries,
    createCountryInspectorState,
    getCountryChildSectionsForParent,
    buildCountryRowMetaText,
    getResolvedCountryColor,
    getDisplayCountryColor,
    getPrimaryReleasablePresetRef: (...args) => getPrimaryReleasablePresetRef(...args),
    applyScenarioReleasableCoreTerritory: (...args) => applyScenarioReleasableCoreTerritory(...args),
    applyCountryColor,
    incrementSidebarCounter,
    markDirty,
    showToast,
    getHgoIdentity: resolveHgoIdentityForCountry,
    getSelectedLandInspectorCountryCode: () => getLastSelectedLandInspectorCountryCode(),
    getHgoIdentityCoverage,
    getHgoIdentityStatus: () => hgoIdentityLoadState,
    onHgoIdentityRetry: () => {
      if (hgoIdentityLoadState.status === "error") {
        hgoIdentityLoadState.status = "idle";
      }
      ensureHgoIdentityAssetsLoaded();
      renderList();
    },
    onHgoIdentitySettingsChange: () => {
      const settings = ensureHgoIdentityRuntimeState();
      requestHgoIdentityAssetsForSettings(settings, ensureHgoIdentityAssetsLoaded);
      renderList();
      render();
    },
  });
  const {
    bindEvents: bindCountryInspectorEvents,
    closeCountryInspectorColorPicker,
    ensureSelectedInspectorCountry,
    refreshCountryRows,
    renderCountryInspectorDetail,
    renderCountrySelectRow,
    renderList,
    selectInspectorCountry,
    syncCountryRowVisuals,
  } = countryInspectorController;

  bindCountryInspectorEvents();
  requestHgoIdentityAssetsForSettings(
    ensureHgoIdentityRuntimeState(),
    ensureHgoIdentityAssetsLoaded,
  );

  let bindWaterSpecialRegionEvents = () => {};
  let closeWaterInspectorColorPicker = () => {};
  let closeSpecialRegionColorPicker = () => {};
  let renderWaterInteractionUi = () => {};
  let renderWaterRegionList = () => {};
  let refreshWaterRegionRows = () => {};
  let renderSpecialRegionInspectorUi = () => {};
  let renderSpecialRegionList = () => {};
  let refreshSpecialRegionRows = () => {};

  let bindProjectSupportDiagnosticsEvents = () => {};
  let refreshLegendEditor = () => {};
  let refreshProjectSaveStatus = () => {};
  let renderScenarioAuditPanel = () => {};

  let bindStrategicOverlayEvents = () => {};
  let closeCounterEditorModal = () => {};
  let closeStrategicWorkspace = () => {};
  let cancelStrategicEditingModes = () => false;
  let invalidateFrontlineOverlayState = () => {};
  let refreshStrategicOverlayUI = () => {};
  let getStrategicOverlayPerfCounters = () => ({});

  const resolveAuditNumber = (...values) => {
    for (const value of values) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        return numeric;
      }
    }
    return 0;
  };

  const activateCoreOwner = (countryCode, { forceSovereignty = false } = {}) => {
    if (forceSovereignty && String(runtimeState.paintMode || "visual") !== "sovereignty") {
      setScenarioMapPaintMode("ownership");
    }
    runtimeState.activeSovereignCode = countryCode;
    callRuntimeHook(state, "updateActiveSovereignUIFn");
  };

  const activateScenarioCountry = (countryState) => {
    if (!isOwnershipEditingEnabled()) return ownershipEditingDisabledResult();
    const isReleasable = !!countryState?.releasable;

    const normalizedCountryCode = normalizeCountryCode(countryState.code);
    const alreadyActive = normalizedCountryCode && normalizedCountryCode === normalizeCountryCode(runtimeState.activeSovereignCode);
    const previousActiveCode = normalizeCountryCode(runtimeState.activeSovereignCode);
    const selectedCode = normalizeCountryCode(runtimeState.selectedInspectorCountryCode);
    if (normalizedCountryCode) {
      runtimeState.activeSovereignCode = normalizedCountryCode;
    }
    setScenarioMapPaintMode("ownership");
    if (!alreadyActive) {
      markDirty("set-active-sovereign");
    }
    callRuntimeHook(state, "updateActiveSovereignUIFn");
    refreshCountryRows({
      countryCodes: [previousActiveCode, normalizedCountryCode, selectedCode],
      refreshInspector: true,
    });
    showToast(
      t(
        alreadyActive
          ? (isReleasable
            ? "Political ownership editing already targets this releasable."
            : "Political ownership editing already targets this country.")
          : (isReleasable
            ? "Political ownership editing now targets this releasable."
            : "Political ownership editing now targets this country."),
        "ui"
      ),
      {
        title: t("Active owner updated", "ui"),
        tone: alreadyActive ? "info" : "success",
        duration: 2800,
      }
    );
  };

  const getCountryState = (code) => latestCountryStatesByCode.get(code);

  const appendActionSection = (
    container,
    titleText,
    {
      collapsible = false,
      defaultOpen = true,
      rememberKey = "",
      bodyClassName = "",
    } = {}
  ) => {
    const body = document.createElement("div");
    body.className = [
      "inspector-action-section-body",
      bodyClassName,
      collapsible ? "inspector-action-disclosure-body" : "inspector-action-list",
    ].filter(Boolean).join(" ");

    if (!collapsible) {
      const section = document.createElement("div");
      section.className = "inspector-detail-section inspector-action-section";
      const title = document.createElement("div");
      title.className = "section-header-block";
      title.textContent = titleText;
      section.appendChild(title);
      section.appendChild(body);
      container.appendChild(section);
      return body;
    }

    const details = document.createElement("details");
    details.className = "inspector-action-disclosure";
    details.open = getInspectorDisclosureOpenState(rememberKey, defaultOpen);
    details.addEventListener("toggle", () => {
      setInspectorDisclosureOpenState(rememberKey, details.open);
      scheduleAdaptiveInspectorHeights();
    });

    const summary = document.createElement("summary");
    summary.className = "inspector-action-disclosure-summary";
    summary.textContent = titleText;

    details.appendChild(summary);
    details.appendChild(body);
    container.appendChild(details);
    return body;
  };

  const {
    applyScenarioAutoCompanionActions,
    renderScenarioHistoricalTransfers,
  } = createScenarioTransferController({
    t,
    normalizeCountryCode,
    getScenarioCountryMeta,
    resolveCompanionActionFeatureIds,
    filterToVisibleFeatureIds,
    applyScenarioOwnerControllerAssignments,
    showToast,
    refreshScenarioShellOverlays,
    render,
    renderList,
    appendActionSection,
    createInspectorActionButton,
  });

  const renderNoActiveGuard = (container) => {
    if (!isOwnershipEditingEnabled()) return false;
    const needsGuard = runtimeState.activeScenarioId
      ? !normalizeCountryCode(runtimeState.activeSovereignCode)
      : (
        String(runtimeState.paintMode || "visual") === "sovereignty" &&
        !normalizeCountryCode(runtimeState.activeSovereignCode)
      );
    if (!needsGuard) return false;
    container.appendChild(
      createEmptyNote(t("Choose an active owner before changing political ownership or borders.", "ui"))
    );
    return true;
  };

  const {
    getPrimaryReleasablePresetRef,
    prepareScenarioCoreApplication,
    hasScenarioCoreTerritoryActions,
    applyPresetReference,
    renderRegionalPresets,
  } = createRegionalPresetController(runtimeState, {
    t,
    normalizeCountryCode,
    normalizePresetName,
    resolveScenarioLookupCode,
    getScenarioCountryMeta,
    resolveFeatureIdsFromPresetSource,
    normalizeActionMode,
    filterToVisibleFeatureIds,
    applyOwnershipToFeatureIds,
    applyVisualOverridesToFeatureIds,
    showToast,
    render,
    appendActionSection,
    setScenarioVisualAdjustmentsOpen,
  });

  const {
    applyScenarioReleasableCoreTerritory,
    applyReleasableBoundaryVariantSelection,
  } = createScenarioTerritoryController({
    t,
    prepareScenarioCoreApplication,
    getPrimaryReleasablePresetRef,
    applyPresetReference,
    getCountryState,
    getResolvedCountryColor,
    blockLockedScenarioInteraction,
    applyScenarioOwnerControllerAssignments,
    activateCoreOwner,
    setReleasableBoundaryVariant,
    applyScenarioAutoCompanionActions,
    refreshScenarioShellOverlays,
    showToast,
    render,
    renderList,
  });

  const renderCountryColorSyncAffordance = (container, countryState) => {
    if (!container || !countryState) return;

    const resolvedColor = getDisplayCountryColor(countryState);
    const suggestionKey = getPaletteColorSuggestionCacheKey(countryState);
    const row = document.createElement("div");
    row.className = "inspector-color-sync-row inspector-color-sync-row-compact";
    row.dataset.paletteSuggestionKey = suggestionKey;

    const copy = document.createElement("div");
    copy.className = "inspector-color-sync-copy";

    const compactTitle = document.createElement("div");
    compactTitle.className = "section-header-block inspector-color-sync-title";
    compactTitle.textContent = t("Country Color", "ui");
    copy.appendChild(compactTitle);

    const suggestionSelect = document.createElement("select");
    suggestionSelect.className = "inspector-color-suggestion-select";
    suggestionSelect.setAttribute("aria-label", t("Palette color suggestions", "ui"));
    const currentOption = document.createElement("option");
    currentOption.value = "current";
    currentOption.textContent = t("Current country color", "ui");
    suggestionSelect.appendChild(currentOption);

    const compactButton = document.createElement("button");
    compactButton.type = "button";
    compactButton.className = "country-select-swatch inspector-color-sync-swatch inspector-color-sync-trigger";
    compactButton.style.backgroundColor = resolvedColor;
    const countryColorActionLabel = `${t("Use Country Color for Visual Actions", "ui")}: ${countryState.displayName}`;
    compactButton.title = countryColorActionLabel;
    compactButton.setAttribute("aria-label", countryColorActionLabel);
    compactButton.addEventListener("click", () => {
      syncSelectedColorFromCountry(countryState);
      compactButton.style.backgroundColor = resolvedColor;
      compactButton.title = countryColorActionLabel;
      compactButton.setAttribute("aria-label", countryColorActionLabel);
      suggestionSelect.value = "current";
    });

    suggestionSelect.addEventListener("change", () => {
      if (suggestionSelect.value === "current") {
        syncSelectedColorFromCountry(countryState);
        compactButton.style.backgroundColor = resolvedColor;
        compactButton.title = countryColorActionLabel;
        compactButton.setAttribute("aria-label", countryColorActionLabel);
        return;
      }
      const suggestions = Array.isArray(suggestionSelect._paletteColorSuggestions)
        ? suggestionSelect._paletteColorSuggestions
        : [];
      const suggestion = suggestions[Number(suggestionSelect.value)];
      applyPaletteColorSuggestion(suggestion, compactButton);
    });

    copy.appendChild(suggestionSelect);
    row.appendChild(copy);
    row.appendChild(compactButton);
    container.appendChild(row);

    suggestionSelect.disabled = true;
    currentOption.textContent = t("Loading palette suggestions", "ui");
    void loadPaletteColorSuggestionsForCountry(countryState).then((suggestions) => {
      if (!row.isConnected || row.dataset.paletteSuggestionKey !== suggestionKey) return;
      suggestionSelect.innerHTML = "";
      const baseOption = document.createElement("option");
      baseOption.value = "current";
      baseOption.textContent = t("Current country color", "ui");
      suggestionSelect.appendChild(baseOption);
      suggestionSelect._paletteColorSuggestions = suggestions;

      if (!suggestions.length) {
        const emptyOption = document.createElement("option");
        emptyOption.value = "empty";
        emptyOption.textContent = t("No palette suggestions", "ui");
        emptyOption.disabled = true;
        suggestionSelect.appendChild(emptyOption);
        suggestionSelect.disabled = false;
        suggestionSelect.value = "current";
        return;
      }

      suggestions.forEach((suggestion, index) => {
        const option = document.createElement("option");
        option.value = String(index);
        option.textContent = formatPaletteColorSuggestionText(suggestion, countryState, { includeColor: true });
        suggestionSelect.appendChild(option);
      });
      suggestionSelect.disabled = false;
      suggestionSelect.value = "current";
    });
    return;
  };

  const renderParentCountryActions = (container, countryState) => {
    renderCountryColorSyncAffordance(container, countryState);
    const actionGuarded = renderNoActiveGuard(container);
    const groupSection = appendActionSection(container, t("Hierarchy Groups", "ui"), {
      collapsible: true,
      defaultOpen: false,
      rememberKey: "territories-presets:hierarchy-groups",
    });
    if (countryState.hierarchyGroups.length > 0) {
      countryState.hierarchyGroups.forEach((group) => {
        const button = createInspectorActionButton(
          t(group.label, "geo") || group.label,
          () => applyHierarchyGroup(group, runtimeState.selectedColor, render)
        );
        button.disabled = actionGuarded;
        if (actionGuarded) {
          button.title = t("Choose an active owner before changing political ownership.", "ui");
        }
        groupSection.appendChild(button);
      });
    } else {
      groupSection.appendChild(createEmptyNote(t("No hierarchy groups", "ui")));
    }

    renderRegionalPresets(container, countryState);
  };

  const { renderScenarioActionsPanel } = createScenarioInspectorController({
    t,
    getView: () => ({
      visualOpen: !!runtimeState.ui?.scenarioVisualAdjustmentsOpen,
      paintMode: String(runtimeState.paintMode || "visual"),
      selectedColor: String(runtimeState.selectedColor || ""),
    }),
    getCountryState,
    activateScenarioCountry,
    storeVisualOpen,
    selectInspectorCountry,
    getScenarioSubjectKindLabel,
    getResolvedCountryColor,
    getScenarioSubjectChildrenForParent,
    getReleasableChildrenForParent,
    appendActionSection,
    createInspectorActionButton,
    applyHierarchyGroupWithMode,
    render,
    createEmptyNote,
    renderRegionalPresets,
    normalizeCountryCode,
    getResolvedReleasableBoundaryVariant,
    getScenarioCountryMeta,
    applyReleasableBoundaryVariantSelection,
    getPrimaryReleasablePresetRef,
    applyScenarioReleasableCoreTerritory,
    renderScenarioHistoricalTransfers,
    selectedCountryActionsSection,
    scheduleAdaptiveInspectorHeights,
    setScenarioMapPaintMode,
    setScenarioVisualAdjustmentsOpen,
    filterToVisibleFeatureIds,
    clearVisualOverridesForFeatureIds,
    showToast,
    applyVisualColorToOwnedRegions,
    clearCountryVisualOverrides,
    renderCountryColorSyncAffordance,
    hasScenarioCoreTerritoryActions,
  });

  const getSelectedLandFeatureIdsForCountryInference = () => {
    const orderedIds = Array.isArray(runtimeState.devSelectionOrder)
      ? runtimeState.devSelectionOrder.map((value) => String(value || "").trim()).filter(Boolean)
      : [];
    const validOrderedIds = orderedIds.filter((featureId) => runtimeState.landIndex?.has(featureId));
    if (validOrderedIds.length) {
      return Array.from(new Set(validOrderedIds));
    }

    const selectedId = runtimeState.devSelectedHit?.targetType === "land"
      ? String(runtimeState.devSelectedHit.id || "").trim()
      : "";
    return selectedId && runtimeState.landIndex?.has(selectedId) ? [selectedId] : [];
  };

  const resolveSelectedLandFeatureCountryCode = (featureId) => {
    const normalizedId = String(featureId || "").trim();
    if (!normalizedId) return "";
    const feature = runtimeState.landIndex?.get(normalizedId);
    if (!feature) return "";
    const ownerCode = normalizeCountryCode(getFeatureOwnerCode(normalizedId));
    const featureCode = normalizeCountryCode(
      getSharedFeatureCountryCode(feature || { id: normalizedId }, { useIdFallback: true })
    );
    return ownerCode || featureCode;
  };

  const getLastSelectedLandInspectorCountryCode = () => {
    const selectedFeatureIds = getSelectedLandFeatureIdsForCountryInference();
    const lastFeatureId = selectedFeatureIds[selectedFeatureIds.length - 1] || "";
    return resolveSelectedLandFeatureCountryCode(lastFeatureId);
  };

  const inferCountryCodesFromSelectedLand = () => {
    const codes = new Set();
    getSelectedLandFeatureIdsForCountryInference().forEach((featureId) => {
      const code = resolveSelectedLandFeatureCountryCode(featureId);
      if (code) {
        codes.add(code);
      }
    });
    return Array.from(codes);
  };

  const resolvePresetTreeCountryState = () => {
    const selectedCode = ensureSelectedInspectorCountry();
    if (selectedCode) {
      return {
        countryState: latestCountryStatesByCode.get(selectedCode) || null,
        reason: "inspector",
      };
    }

    const inferredCodes = inferCountryCodesFromSelectedLand()
      .filter((code) => latestCountryStatesByCode.has(code));
    if (inferredCodes.length === 1) {
      return {
        countryState: latestCountryStatesByCode.get(inferredCodes[0]) || null,
        reason: "selection",
      };
    }
    if (inferredCodes.length > 1) {
      return {
        countryState: null,
        reason: "multi-selection",
      };
    }
    return {
      countryState: null,
      reason: "empty",
    };
  };

  const renderPresetTree = () => {
    if (!presetTree) return;
    incrementSidebarCounter("presetTreeRenders");
    updateScenarioInspectorLayout();
    presetTree.innerHTML = "";

    const { countryState, reason } = resolvePresetTreeCountryState();
    selectedCountryActionsSection?.classList.toggle("is-empty-selection-panel", !countryState);

    if (reason === "multi-selection") {
      presetTree.appendChild(createEmptyNote(t("Multiple countries are selected. Narrow the map selection to one country or choose a country in the inspector.", "ui")));
      scheduleAdaptiveInspectorHeights();
      return;
    }

    if (runtimeState.activeScenarioId) {
      renderScenarioActionsPanel(presetTree, countryState);
      scheduleAdaptiveInspectorHeights();
      return;
    }

    if (!countryState) {
      presetTree.appendChild(createEmptyNote(t("Select a country to inspect territories, presets, and releasables.", "ui")));
      scheduleAdaptiveInspectorHeights();
      return;
    }

    renderParentCountryActions(presetTree, countryState);
    scheduleAdaptiveInspectorHeights();
  };

  registerRuntimeHook(state, "renderPresetTreeFn", renderPresetTree);
  const setRightSidebarTab = (tabId) => {
    const normalizedId = String(tabId || "").trim().toLowerCase();
    const activeId = normalizedId === "frontline"
      ? "project"
      : (["inspector", "project"].includes(normalizedId) ? normalizedId : "inspector");
    if (!runtimeState.ui || typeof runtimeState.ui !== "object") {
      runtimeState.ui = {};
    }
    runtimeState.ui.rightSidebarTab = activeId;
    document.body.classList.toggle("frontline-mode-active", activeId === "project");
    if (activeId !== "project") {
      closeCounterEditorModal({ restoreFocus: false });
      cancelStrategicEditingModes();
      closeStrategicWorkspace();
      clearRightSidebarSupportViewParam();
    }
    inspectorSidebarTabButtons.forEach((button) => {
      const id = String(button.dataset.inspectorTab || "").trim().toLowerCase();
      const isActive = id === activeId;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    inspectorSidebarTabPanels.forEach((panel) => {
      const id = String(panel.dataset.inspectorPanel || "").trim().toLowerCase();
      const isActive = id === activeId;
      panel.classList.toggle("is-active", isActive);
      panel.hidden = !isActive;
    });
    callRuntimeHook(state, "updateStrategicOverlayUIFn", {
      scopes: ["workspaceChrome", "counterIdentity", "counterPreview", "counterList"],
    });
    syncRightSidebarUrlState();
    scheduleAdaptiveInspectorHeights();
  };


  ({
    bindEvents: bindWaterSpecialRegionEvents,
    closeWaterInspectorColorPicker,
    closeSpecialRegionColorPicker,
    renderSpecialRegionInspectorUi,
    renderSpecialRegionList,
    refreshSpecialRegionRows,
    renderWaterInteractionUi,
    renderWaterRegionList,
    refreshWaterRegionRows,
  } = createWaterSpecialRegionController({
    runtimeState: state,
    elements: {
      waterInspectorSection,
      waterInspectorOpenOceanSelectToggle,
      waterInspectorOpenOceanSelectHint,
      waterInspectorOpenOceanPaintToggle,
      waterInspectorOpenOceanPaintHint,
      waterInspectorOverridesOnlyToggle,
      waterInspectorTypeFilter,
      waterInspectorGroupFilter,
      waterInspectorSourceFilter,
      waterInspectorSortSelect,
      waterInspectorResultCount,
      waterSearchInput,
      waterRegionList,
      waterLegendList,
      waterInspectorEmpty,
      waterInspectorSelected,
      waterInspectorDetailHint,
      waterInspectorMetaSection,
      waterInspectorMetaList,
      waterInspectorHierarchySection,
      waterInspectorJumpToParentBtn,
      waterInspectorChildrenList,
      waterInspectorColorRow,
      waterInspectorColorLabel,
      waterInspectorColorSwatch,
      waterInspectorColorValue,
      waterInspectorColorInput,
      clearWaterRegionColorBtn,
      waterInspectorBatchSection,
      waterInspectorScopeSelect,
      waterInspectorScopePreview,
      applyWaterFamilyOverrideBtn,
      clearWaterFamilyOverrideBtn,
      specialRegionInspectorSection,
      scenarioSpecialRegionVisibilityToggle,
      scenarioSpecialRegionVisibilityHint,
      scenarioReliefOverlayVisibilityToggle,
      scenarioReliefOverlayVisibilityHint,
      specialRegionSearchInput,
      specialRegionList,
      specialRegionLegendList,
      specialRegionInspectorEmpty,
      specialRegionInspectorSelected,
      specialRegionInspectorDetailHint,
      specialRegionColorRow,
      specialRegionColorLabel,
      specialRegionColorSwatch,
      specialRegionColorValue,
      specialRegionColorInput,
      clearSpecialRegionColorBtn,
    },
    helpers: {
      mapRenderer,
      render,
      t,
      normalizeHexColor: (value) => ColorManager.normalizeHexColor(value),
      getGeoFeatureDisplayLabel,
      captureHistoryState,
      pushHistoryEntry,
      markDirty,
      ensureActiveScenarioOptionalLayerLoaded,
      createEmptyNote,
      scheduleAdaptiveInspectorHeights,
      updateSpecialZoneEditorUi: () => callRuntimeHook(state, "updateSpecialZoneEditorUIFn"),
      updateWorkspaceStatus: () => callRuntimeHook(state, "updateWorkspaceStatusFn"),
    },
  }));

  bindWaterSpecialRegionEvents();

  ({
    bindEvents: bindProjectSupportDiagnosticsEvents,
    refreshLegendEditor,
    refreshProjectSaveStatus,
    renderScenarioAuditPanel,
  } = createProjectSupportDiagnosticsController({
    state,
    hosts: {
      projectManagementStack,
      legendEditorStack,
      diagnosticStack,
      rightSidebarContent,
    },
    helpers: {
      t,
      createEmptyNote,
      resolveAuditNumber,
      incrementSidebarCounter,
      loadScenarioAuditPayload,
      releaseScenarioAuditPayload,
      legendManager: LegendManager,
      mapRenderer,
      fileManager: FileManager,
      showAppDialog,
      showToast,
      importProjectThroughFunnel,
      invalidateFrontlineOverlayState: () => invalidateFrontlineOverlayState(),
    },
  }));

  bindProjectSupportDiagnosticsEvents();

  ({
    bindEvents: bindStrategicOverlayEvents,
    closeCounterEditorModal,
    closeWorkspace: closeStrategicWorkspace,
    cancelEditingModes: cancelStrategicEditingModes,
    getPerfCounters: getStrategicOverlayPerfCounters,
    invalidateFrontlineOverlayState,
    refreshUI: refreshStrategicOverlayUI,
  } = createStrategicOverlayController({
    state,
    elements: {
      frontlineEnabledStatus,
      frontlineStatusHint,
      frontlineEnabledToggle,
      frontlineEmptyState,
      frontlineSettingsPanel,
      strategicFrontlineStyleSelect,
      frontlineStyleChoiceButtons,
      strategicFrontlineLabelsToggle,
      strategicLabelPlacementSelect,
      strategicOverlaySection,
      strategicWorkspaceBackdropEl,
      strategicOverlayOpenWorkspaceBtn,
      strategicOverlayCloseWorkspaceBtn,
      strategicOverlayIconCloseBtn,
      strategicOverlayPublishStatus,
      unitCounterDetailDrawer,
      unitCounterDetailToggleBtn,
      operationalLineKindSelect,
      operationalLineLabelInput,
      operationalLineStrokeInput,
      operationalLineWidthInput,
      operationalLineOpacityInput,
      operationalLineList,
      operationalLineStartBtn,
      operationalLineUndoBtn,
      operationalLineFinishBtn,
      operationalLineCancelBtn,
      operationalLineDeleteBtn,
      operationalLineEditorHint,
      strategicCommandButtons,
      operationGraphicKindSelect,
      operationGraphicLabelInput,
      operationGraphicPresetSelect,
      operationGraphicStrokeInput,
      operationGraphicWidthInput,
      operationGraphicOpacityInput,
      operationGraphicList,
      operationGraphicStartBtn,
      operationGraphicUndoBtn,
      operationGraphicFinishBtn,
      operationGraphicCancelBtn,
      operationGraphicDeleteBtn,
      operationGraphicDeleteVertexBtn,
      operationGraphicEditorHint,
      unitCounterPreviewCard,
      unitCounterPlacementStatus,
      unitCounterEditorModalOverlay,
      unitCounterEditorModal,
      unitCounterEditorModalCloseBtn,
      unitCounterEditorModalStatus,
      unitCounterDetailPreviewCard,
      unitCounterPresetSelect,
      unitCounterNationModeSelect,
      unitCounterNationSelect,
      unitCounterAttachmentSelect,
      unitCounterRendererSelect,
      unitCounterSizeSelect,
      unitCounterEchelonSelect,
      unitCounterLabelInput,
      unitCounterSubLabelInput,
      unitCounterStrengthInput,
      unitCounterSymbolInput,
      unitCounterSymbolHint,
      unitCounterStatsPresetSelect,
      unitCounterStatsPresetButtons,
      unitCounterStatsRandomizeBtn,
      unitCounterOrganizationInput,
      unitCounterEquipmentInput,
      unitCounterOrganizationBar,
      unitCounterEquipmentBar,
      unitCounterBaseFillSwatch,
      unitCounterBaseFillColorInput,
      unitCounterBaseFillResetBtn,
      unitCounterBaseFillEyedropperBtn,
      unitCounterLabelsToggle,
      unitCounterFixedScaleRange,
      unitCounterFixedScaleValue,
      unitCounterPlaceBtn,
      unitCounterCancelBtn,
      unitCounterDeleteBtn,
      unitCounterList,
      unitCounterCatalogHeaderTitle,
      unitCounterCatalogHeaderHint,
      unitCounterCatalogSourceTabs,
      unitCounterCatalogSearchInput,
      unitCounterLibraryVariantRow,
      unitCounterLibraryReviewBar,
      unitCounterLibraryReviewSummary,
      unitCounterLibraryExportBtn,
      unitCounterCatalogCategoriesEl,
      unitCounterCatalogGrid,
    },
    helpers: {
      mapRenderer,
      render,
      t,
      showAppDialog,
      normalizeAnnotationView,
      captureHistoryState,
      pushHistoryEntry,
      markDirty,
      resolveUnitCounterCombatState,
      getFilteredUnitCounterCatalog,
      getUnitCounterCategoryLabel,
      getUnitCounterIconPathById,
      getUnitCounterPresetMeta,
      unitCounterCatalogCategories,
      unitCounterPresets,
      getSidebarUnitCounterPresetOptions,
      inferUnitCounterPresetId,
      getUnitCounterNationMeta,
      getUnitCounterNationOptions,
      getUnitCounterEchelonLabel,
      formatUnitCounterListLabel,
      renderUnitCounterPreview,
      clampUnitCounterFixedScaleMultiplier,
      clampUnitCounterStatValue,
      getUnitCounterCombatPreset,
      getRandomizedUnitCounterCombatState,
      showToast,
      DEFAULT_UNIT_COUNTER_PRESET_ID,
    },
  }));

  bindStrategicOverlayEvents();

  registerRuntimeHook(state, "renderCountryListFn", renderList);
  registerRuntimeHook(state, "renderWaterRegionListFn", renderWaterRegionList);
  registerRuntimeHook(state, "refreshWaterRegionListRowsFn", refreshWaterRegionRows);
  registerRuntimeHook(state, "updateWaterInteractionUIFn", renderWaterInteractionUi);
  registerRuntimeHook(state, "renderSpecialRegionListFn", renderSpecialRegionList);
  registerRuntimeHook(state, "refreshSpecialRegionListRowsFn", refreshSpecialRegionRows);
  registerRuntimeHook(state, "updateScenarioSpecialRegionUIFn", renderSpecialRegionInspectorUi);
  registerRuntimeHook(state, "updateScenarioReliefOverlayUIFn", renderSpecialRegionInspectorUi);
  registerRuntimeHook(state, "updateLegendUI", refreshLegendEditor);
  registerRuntimeHook(state, "updateProjectSaveStatusFn", refreshProjectSaveStatus);
  registerRuntimeHook(state, "renderScenarioAuditPanelFn", renderScenarioAuditPanel);
  registerRuntimeHook(state, "updateStrategicOverlayUIFn", refreshStrategicOverlayUI);
  registerRuntimeHook(state, "getStrategicOverlayPerfCountersFn", getStrategicOverlayPerfCounters);
  registerRuntimeHook(state, "refreshCountryListRowsFn", refreshCountryRows);
  registerRuntimeHook(state, "refreshCountryInspectorDetailFn", renderCountryInspectorDetail);
  const requestedSidebarTab = restoreRightSidebarUrlState();
  setRightSidebarTab(requestedSidebarTab || runtimeState.ui?.rightSidebarTab || "inspector");
  callRuntimeHook(state, "restoreSupportSurfaceFromUrlFn");
  refreshStrategicOverlayUI();
  restoreLeftSidebarCollapsedState();
  restoreRightSidebarCollapsedState();

  if (leftSidebarCollapseBtn && !leftSidebarCollapseBtn.dataset.bound) {
    leftSidebarCollapseBtn.addEventListener("click", () => {
      setLeftSidebarCollapsed(!leftSidebarCollapsePreference);
    });
    leftSidebarCollapseBtn.dataset.bound = "true";
  }

  if (rightSidebarCollapseBtn && !rightSidebarCollapseBtn.dataset.bound) {
    rightSidebarCollapseBtn.addEventListener("click", () => {
      setRightSidebarCollapsed(!rightSidebarCollapsePreference);
    });
    rightSidebarCollapseBtn.dataset.bound = "true";
  }

  if (leftSidebarCollapseMedia && leftSidebar && !leftSidebar.dataset.collapseMediaBound) {
    if (typeof leftSidebarCollapseMedia.addEventListener === "function") {
      leftSidebarCollapseMedia.addEventListener("change", syncLeftSidebarCollapsedMedia);
    } else if (typeof leftSidebarCollapseMedia.addListener === "function") {
      leftSidebarCollapseMedia.addListener(syncLeftSidebarCollapsedMedia);
    }
    leftSidebar.dataset.collapseMediaBound = "true";
  }

  if (rightSidebarCollapseMedia && sidebar && !sidebar.dataset.collapseMediaBound) {
    if (typeof rightSidebarCollapseMedia.addEventListener === "function") {
      rightSidebarCollapseMedia.addEventListener("change", syncRightSidebarCollapsedMedia);
    } else if (typeof rightSidebarCollapseMedia.addListener === "function") {
      rightSidebarCollapseMedia.addListener(syncRightSidebarCollapsedMedia);
    }
    sidebar.dataset.collapseMediaBound = "true";
  }

  inspectorSidebarTabButtons.forEach((button) => {
    if (button.dataset.bound) return;
    button.addEventListener("click", () => {
      setRightSidebarTab(button.dataset.inspectorTab || "inspector");
    });
    button.dataset.bound = "true";
  });

  rightSidebarDetails().forEach((details) => {
    if (details.dataset.urlBound === "true") return;
    details.addEventListener("toggle", () => {
      syncRightSidebarUrlState();
    });
    details.dataset.urlBound = "true";
  });


  if (sidebar && !sidebar.dataset.adaptiveInspectorBound) {
    globalThis.addEventListener("resize", scheduleAdaptiveInspectorHeights);
    countryInspectorSection?.addEventListener("toggle", scheduleAdaptiveInspectorHeights);
    waterInspectorSection?.addEventListener("toggle", scheduleAdaptiveInspectorHeights);
    specialRegionInspectorSection?.addEventListener("toggle", scheduleAdaptiveInspectorHeights);
    selectedCountryActionsSection?.addEventListener("toggle", scheduleAdaptiveInspectorHeights);
    sidebar.addEventListener("scroll", () => {
      if (countryInspectorColorPickerOpen) {
        closeCountryInspectorColorPicker();
      }
      closeWaterInspectorColorPicker();
      closeSpecialRegionColorPicker();
    }, { passive: true });
    sidebar.addEventListener("wheel", () => {
      if (countryInspectorColorPickerOpen) {
        closeCountryInspectorColorPicker();
      }
      closeWaterInspectorColorPicker();
      closeSpecialRegionColorPicker();
    }, { passive: true });
    sidebar.dataset.adaptiveInspectorBound = "true";
  }


  if (resetBtn && !resetBtn.dataset.bound) {
    resetBtn.addEventListener("click", async () => {
      const confirmed = await showAppDialog({
        title: t("Reset Country Colors", "ui"),
        message: t("Reset all country colors and clear visual overrides?", "ui"),
        details: t(
          "This removes manual color changes from the current map. You can undo the reset from the toast that follows.",
          "ui"
        ),
        confirmLabel: t("Reset Colors", "ui"),
        cancelLabel: t("Keep Current Colors", "ui"),
        tone: "warning",
      });
      if (!confirmed) return;
      resetCountryColors();
      markDirty("reset-country-colors");
      callRuntimeHook(state, "renderCountryListFn");
      flushSidebarRender("sidebar-reset-country-colors");
      scheduleAdaptiveInspectorHeights();
      showToast(t("Country colors were reset.", "ui"), {
        title: t("Colors reset", "ui"),
        tone: "warning",
        duration: 7200,
        actionLabel: canUndoHistory() ? t("Undo", "ui") : "",
        onAction: canUndoHistory()
          ? async () => {
            if (!undoHistory()) return;
            scheduleAdaptiveInspectorHeights();
            showToast(t("Country colors were restored.", "ui"), {
              title: t("Undo applied", "ui"),
              tone: "success",
            });
          }
          : null,
      });
    });
    resetBtn.dataset.bound = "true";
  }

  renderList();
  renderWaterInteractionUi();
  renderWaterRegionList();
  renderSpecialRegionInspectorUi();
  renderSpecialRegionList();
  renderPresetTree();
  refreshLegendEditor();
  renderScenarioAuditPanel();
  scheduleAdaptiveInspectorHeights();
}

export { initSidebar, requestHgoIdentityAssetsForSettings };
