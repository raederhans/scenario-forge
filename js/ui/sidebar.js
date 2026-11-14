import { createStrategicPanelView } from "./sidebar/strategic_panel_view.js";
import { setSelectedColorState } from "../core/state/actions/appearance_selection_actions.js";
import { resolveDataUrl } from "../core/data_base_url.js";
import { applyFeaturePaintState } from "../core/state/color_state.js";
import { initEditorWorkspace } from "./editor_workspace.js";
import { getMapDataBoundary } from "../core/map_data_boundary.js";
import { findCountryGroupForFeature, getGroupDisplayLabel, getHierarchyGroupsForCode as getGeographicHierarchyGroups } from "../core/country_group_provider.js";
// Sidebar UI (Phase 13)
import {
  state as runtimeState,
  countryNames,
  defaultCountryPalette,
  normalizeAnnotationView,
} from "../core/state.js";
import { callRuntimeHook, registerRuntimeHook } from "../core/state/index.js";
import { ensureSidebarPerfState } from "../core/state/renderer_runtime_state.js";
import { pushRecentColorState } from "../core/state/actions/editor_input_actions.js";
import { ColorManager } from "../core/color_manager.js";
import {
  cancelActiveStrategicInteractionModes,
  cancelOperationGraphicDraw,
  cancelOperationalLineDraw,
  cancelUnitCounterPlacement,
  deleteSelectedOperationGraphic,
  deleteSelectedOperationGraphicVertex,
  deleteSelectedOperationalLine,
  addScenarioDefenseLinePresets,
  deleteSelectedUnitCounter,
  finishOperationGraphicDraw,
  finishOperationalLineDraw,
  getWaterRegionColor,
  focusWaterRegionById,
  refreshColorState,
  refreshResolvedColorsForFeatures,
  renderLegend,
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
  getCachedEffectiveCityCollection,
  selectLandFeatureById,
} from "../core/map_renderer/public.js";
import { applyCountryColor, resetCountryColors } from "../core/country_color_commands.js";
import {
  buildPaletteColorSuggestionsForCountry,
  ensurePaletteAssetsLoaded,
} from "../core/palette_manager.js";
import { FileManager } from "../core/file_manager.js";
import { captureHistoryState, getLatestHistoryEntry, pushHistoryEntry, undoHistory } from "../core/history_manager.js";
import { LegendManager } from "../core/legend_manager.js";
import {
  ensureActiveScenarioOptionalLayerLoaded,
  loadScenarioAuditPayload,
  releaseScenarioAuditPayload,
} from "../core/scenario/scenario_resources.js";
import { getDirectGeoLabel, getGeoFeatureDisplayLabel, t } from "./i18n.js";
import { showToast } from "./toast.js";
import { showAppDialog } from "./app_dialog.js";
import { initDevWorkspace } from "./dev_workspace.js";
import { createSidebarLayoutController } from "./sidebar/sidebar_layout_controller.js";
export { createResponsiveSidebarCollapseController } from "./sidebar/sidebar_layout_controller.js";
import { createCountryInspectorModel } from "./sidebar/country_inspector_model.js";
import { createScenarioTerritoryController } from "./sidebar/scenario_territory_controller.js";
import { createScenarioInspectorController, renderCountryGroupButtons } from "./sidebar/scenario_inspector_controller.js";
import { createRegionalPresetController } from "./sidebar/regional_preset_controller.js";
import { createCountryInspectorController } from "./sidebar/country_inspector_controller.js";
import { createRegionSearchController } from "./sidebar/region_search_controller.js";
import { isRenamedPlace, listRenamedPlacesInFeatures } from "../core/renderer/modern_place_name.js";
import { createStrategicOverlayController } from "./sidebar/strategic_overlay_controller.js";
import { createWaterSpecialRegionController } from "./sidebar/water_special_region_controller.js";
import { createProjectSupportDiagnosticsController } from "./sidebar/project_support_diagnostics_controller.js";
import { importProjectThroughFunnel } from "../core/interaction_funnel.js";
import { flushRenderBoundary } from "../core/render_boundary.js";
import {
  getFeatureOwnerCode,
  shouldExcludeScenarioPoliticalFeature,
} from "../core/sovereignty_manager.js";
import { getCountryCode as getSharedFeatureCountryCode } from "../core/feature_identity.js";
import { markDirty } from "../core/dirty_state.js";
import {
  normalizeCountryCode,
  normalizePresetName,
  resolveFeatureIdsFromPresetSource,
} from "../core/releasable_manager.js";
import {
  getLocalizedScenarioCountryName,
  getScenarioCountryDisplayName,
} from "../core/scenario/scenario_country_display.js";
import { createHgoIdentityResolver } from "../core/hgo_identity_resolver.js";
import { resolveDataAssetUrl } from "../core/runtime_asset_registry.js";

const state = runtimeState;
export function resetCountryColorsWithFeedback(afterReset, afterUndo) {
  const previousEntry = getLatestHistoryEntry();
  resetCountryColors();
  const resetEntry = getLatestHistoryEntry();
  const hasResetEntry = resetEntry && resetEntry !== previousEntry;
  afterReset();
  return showToast(t("Country colors were reset.", "ui"), {
    title: t("Colors reset", "ui"),
    tone: "warning",
    duration: 7200,
    actionLabel: hasResetEntry ? t("Undo", "ui") : "",
    onAction: hasResetEntry ? () => {
      if (getLatestHistoryEntry() !== resetEntry) {
        showToast(t("Can't undo the reset because newer edits exist.", "ui"), { tone: "warning" });
        return;
      }
      if (!undoHistory()) return;
      afterUndo();
      showToast(t("Country colors were restored.", "ui"), {
        title: t("Undo applied", "ui"),
        tone: "success",
      });
    } : null,
  });
}
const translateCountryGeoLabel = (label, type = "ui") => (
  type === "geo" ? getDirectGeoLabel(label) : t(label, type)
);
const {
  createCountryInspectorState,
  compareRelatedCountryStates,
  getScenarioCountryMeta,
  getScenarioSubjectChildrenForParent: selectScenarioSubjectChildren,
  resolveScenarioInspectorGroupMeta,
  resolveScenarioLookupCode,
  resolveInspectorDataCode,
  resolveCountryGroupingCode,
  getCountryGroupingMeta,
} = createCountryInspectorModel(runtimeState, translateCountryGeoLabel, { countryNames, getDirectGeoLabel });

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
  addScenarioDefenseLinePresets,
  deleteSelectedUnitCounter,
  finishOperationGraphicDraw,
  finishOperationalLineDraw,
  getWaterRegionColor,
  focusWaterRegionById,
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
  const response = await fetch(resolveDataUrl(url));
  if (!response.ok) {
    throw new Error(`[hgo_identity] Failed to load ${assetKey}: ${response.status}`);
  }
  return response.json();
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
        const displayName = getLocalizedScenarioCountryName(
          scenarioCountry,
          runtimeState.countryNames?.[code] || code,
          getDirectGeoLabel,
        ) || code;
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
      const displayName = getDirectGeoLabel(name) || code;
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
  return getGeographicHierarchyGroups(runtimeState, code);
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

function applyHierarchyGroupWithMode(
  group,
  {
    color,
    render,
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
      mode: "visual",
    };
  }
  const targetIds = Array.isArray(group.children)
    ? Array.from(new Set(group.children.map((id) => String(id || "").trim()).filter(Boolean)))
    : [];
  previewHierarchyGroupHighlight(group, targetIds);
  return applyVisualOverridesToFeatureIds(targetIds, color || runtimeState.selectedColor, {
    render,
    historyKind: visualHistoryKind,
    dirtyReason: visualDirtyReason,
  });
}

function applyHierarchyGroup(group, color, render) {
  return applyHierarchyGroupWithMode(group, {
    color,
    render,
  });
}

function previewHierarchyGroupHighlight(group, featureIds = []) {
  const { matchedIds } = filterToVisibleFeatureIds(featureIds);
  setInspectorFeatureHighlight(matchedIds, {
    groupMode: true,
    label: getDirectGeoLabel(group?.label || "Hierarchy group") || group?.label || "Hierarchy group",
  });
}

function addRecentColor(color) {
  if (!pushRecentColorState(runtimeState, color)) return;
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
  // Legacy sidebar restoration updates the URL before controls move into the
  // workspace. Keep the requested section so its new property host can reopen.
  const initialWorkspaceSearch = globalThis.location?.search || "";
  const list = document.getElementById("countryList");
  if (!list) return;
  // sidebar.js 仍然是右侧工作区的总装壳层：
  // 负责建宿主 DOM、接 runtime hooks、编排多个子 controller，
  // 具体的国家检查器、战略面板、水域面板等细节则下沉到 owner 文件。
  const presetTree = document.getElementById("presetTree");
  const searchInput = document.getElementById("countrySearch");
  const resetBtn = document.getElementById("resetCountryColors");
  const leftSidebar = document.getElementById("leftSidebar");
  const sidebar = document.getElementById("rightSidebar");
  const projectManagementStack = document.getElementById("projectManagementStack");
  const legendEditorStack = document.getElementById("legendEditorStack")
    || projectManagementStack;
  const diagnosticStack = document.getElementById("diagnosticStack");

  const frontlineTabStack = document.getElementById("frontlineTabStack");
  const strategicPanelView = createStrategicPanelView({
    frontlineTabStack, runtimeState, countryNames, t, getDirectGeoLabel,
    getScenarioCountryMeta, ensureCountryPaletteColor, getDynamicCountryEntries,
    deleteSelectedOperationGraphicVertex,
    refreshStrategicOverlayUI: (...args) => refreshStrategicOverlayUI(...args),
  });

  const countryInspectorDetail = document.getElementById("countryInspectorDetail");
  const countryInspectorSelected = document.getElementById("countryInspectorSelected");
  const countryInspectorColorRow = document.getElementById("countryInspectorColorRow");
  const countryInspectorColorSwatch = document.getElementById("countryInspectorColorSwatch");
  const countryInspectorColorInput = document.getElementById("countryInspectorColorInput");
  const countryInspectorSection = document.getElementById("countryInspectorSection");
  const waterInspectorSection = document.getElementById("waterInspectorSection");
  const waterInspectorOpenOceanSelectToggle = document.getElementById("waterInspectorOpenOceanSelectToggle");
  const waterInspectorLakeInteractionToggle = document.getElementById("waterInspectorLakeInteractionToggle");
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
  const waterInspectorLocateBtn = document.getElementById("waterInspectorLocateBtn");
  const waterInspectorMetaSection = document.getElementById("waterInspectorMetaSection");
  const waterInspectorMetaList = document.getElementById("waterInspectorMetaList");
  const waterInspectorHierarchySection = document.getElementById("waterInspectorHierarchySection");
  const waterInspectorBreadcrumb = document.getElementById("waterInspectorBreadcrumb");
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
  initDevWorkspace();

  let countryInspectorColorPickerOpen = false;
  const {
    updateScenarioInspectorLayout,
    getInspectorDisclosureOpenState,
    setInspectorDisclosureOpenState,
    scheduleAdaptiveInspectorHeights,
    setRightSidebarTab,
    restoreRightSidebarUrlState,
    canCollapseRightSidebar,
    setRightSidebarCollapsed,
    syncEditorSelection,
    withEditorSelection,
    onNavigate,
    restoreCollapsedState,
    bindEvents,
    toggleRightSidebarCollapsed,
  } = createSidebarLayoutController({
    runtimeState, sidebar, leftSidebar, list, presetTree, t,
    refreshStrategicOverlay: (options) => callRuntimeHook(state, "updateStrategicOverlayUIFn", options),
    showProperty: (kind) => editorWorkspace?.showProperty(kind),
    getCountryInspectorColorPickerOpen: () => countryInspectorColorPickerOpen,
    closeCountryInspectorColorPicker: () => closeCountryInspectorColorPicker(),
    closeWaterInspectorColorPicker: () => closeWaterInspectorColorPicker(),
    closeSpecialRegionColorPicker: () => closeSpecialRegionColorPicker(),
  });

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
    const scenarioName = getLocalizedScenarioCountryName(scenarioCountry, "", getDirectGeoLabel);
    if (scenarioName) {
      return scenarioName;
    }
    const fallbackName = String(runtimeState.countryNames?.[normalized] || countryNames[normalized] || normalized).trim();
    return getDirectGeoLabel(fallbackName) || fallbackName || normalized;
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
      autonomous_region: t("Autonomous Region", "ui"),
      constituent_country: t("Constituent Country", "ui"),
      federal_subject: t("Federal Subject", "ui"),
      federal_member_state: t("Federal Member State", "ui"),
      special_territory: t("Special Territory", "ui"),
      province: t("Province", "ui"),
      separatist_region: t("Separatist Region", "ui"),
      de_facto_state: t("De Facto State", "ui"),
      civil_war_faction: t("Civil War Faction", "ui"),
    };
    return labels[normalizedKind] || normalizedKind.replace(/_/g, " ");
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

  const getScenarioSubjectChildrenForParent = (parentTag) => {
    return selectScenarioSubjectChildren(parentTag, Array.from(latestCountryStatesByCode.values()))
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
      runtimeState.countryPalette?.[countryState.code] ||
      fallbackColor
    );
  };

  const getDisplayCountryColor = (countryState) =>
    ColorManager.normalizeHexColor(getResolvedCountryColor(countryState)) || "#cccccc";

  const syncSelectedColorFromCountry = (countryState) => {
    const resolvedColor = getDisplayCountryColor(countryState);
    setSelectedColorState(runtimeState, resolvedColor);
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
        || getDirectGeoLabel(suggestion.label)
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
    setSelectedColorState(runtimeState, suggestion.color);
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

  const regionSearchController = createRegionSearchController({
    documentRef: document,
    state,
    t,
    getFeatureOwnerCode,
    getFeatureLabel: getGeoFeatureDisplayLabel,
    selectLandFeatureById,
  });
  regionSearchController.mount(countryInspectorDetail);
  countryInspectorSelected.after(countryInspectorDetail.lastElementChild);

  const renamedPlacesCache = { features: null, hasAny: false };
  const countryInspectorController = createCountryInspectorController({
    resolveInspectorGroup: (code, id) => callRuntimeHook(runtimeState, "resolveInspectorGroupForFeatureFn", code, id),
    stepUpInspectorSelection: () => callRuntimeHook(runtimeState, "stepUpInspectorSelectionFn"),
    getInspectorFeatureLabel: (id) => getGeoFeatureDisplayLabel(runtimeState.landIndex.get(id)),
    hasScenarioRenamedPlaces: () => {
      const features = getCachedEffectiveCityCollection()?.features;
      if (!Array.isArray(features)) return false;
      if (renamedPlacesCache.features !== features) {
        renamedPlacesCache.features = features;
        renamedPlacesCache.hasAny = features.some((feature) => {
          const props = feature?.properties || {};
          return isRenamedPlace(props.__city_display_name_override?.en, props.__city_base_display_name?.en);
        });
      }
      return renamedPlacesCache.hasAny;
    },
    getRenamedPlacesInFeatures: (featureIds) => listRenamedPlacesInFeatures(
      getCachedEffectiveCityCollection()?.features, featureIds, runtimeState.currentLanguage,
    ),
    // 转发给外观面板的开关，由它统一改状态、重绘地图并回刷检查器。
    setShowModernPlaceNames: (enabled) => {
      const appearanceToggle = document.getElementById("showModernPlaceNames");
      if (!appearanceToggle) return;
      appearanceToggle.checked = !!enabled;
      appearanceToggle.dispatchEvent(new Event("change", { bubbles: true }));
    },
    onSelectedCountryRendered: regionSearchController.setCountry,
    runtimeState: state,
    list,
    searchInput,
    selectedCountryActionsSection,
    countryInspectorDetail,
    countryInspectorSelected,
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
    applyCountryColor,
    incrementSidebarCounter,
    markDirty,
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
  let refreshProjectAccountLanguage = () => {};
  let renderScenarioAuditPanel = () => {};

  let bindStrategicOverlayEvents = () => {};
  let closeCounterEditorModal = () => {};
  let closeStrategicWorkspace = () => {};
  let cancelStrategicEditingModes = () => false;
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

  const getCountryState = (code) => latestCountryStatesByCode.get(code);
  registerRuntimeHook(runtimeState, "resolveInspectorGroupForFeatureFn", (code, featureId) => {
    const countryState = getCountryState(code);
    if (!countryState) return null;
    const systems = countryState.groupSystems;
    const systemId = runtimeState.ui.inspectorGroupSystemByCode?.[code] || systems[0]?.id;
    const group = findCountryGroupForFeature(systems, systemId, featureId);
    return group ? {
      id: group.id,
      label: getGroupDisplayLabel(group, runtimeState.currentLanguage, getDirectGeoLabel),
      children: group.children,
    } : null;
  });

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
    getPrimaryReleasablePresetRef,
    applyPresetReference,
    renderRegionalPresets,
  } = createRegionalPresetController(runtimeState, {
    t,
    normalizeCountryCode,
    normalizePresetName,
    resolveScenarioLookupCode,
    getScenarioCountryMeta,
    resolveFeatureIdsFromPresetSource,
    filterToVisibleFeatureIds,
    applyVisualOverridesToFeatureIds,
    showToast,
    render,
    appendActionSection,
    setScenarioVisualAdjustmentsOpen,
  });

  const {
    applyScenarioReleasableCoreTerritory,
  } = createScenarioTerritoryController({
    t,
    getPrimaryReleasablePresetRef,
    applyPresetReference,
    getCountryState,
    getResolvedCountryColor,
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

  const storeInspectorGroupSystem = (code, id) => {
    runtimeState.ui ||= {};
    runtimeState.ui.inspectorGroupSystemByCode ||= {};
    runtimeState.ui.inspectorGroupSystemByCode[code] = id;
  };

  const renderParentCountryActions = (container, countryState) => {
    renderCountryColorSyncAffordance(container, countryState);
    const groupSection = appendActionSection(container, t("Hierarchy Groups", "ui"), {
      collapsible: true,
      defaultOpen: false,
      rememberKey: "territories-presets:hierarchy-groups",
    });
    renderCountryGroupButtons(groupSection, countryState, {
      t,
      language: runtimeState.currentLanguage,
      translateGeo: getDirectGeoLabel,
      selectedSystemId: runtimeState.ui?.inspectorGroupSystemByCode?.[countryState.code],
      selectSystem: (id) => storeInspectorGroupSystem(countryState.code, id),
      createInspectorActionButton,
      applyGroup: (group) => applyHierarchyGroup(group, runtimeState.selectedColor, render),
      createEmptyNote,
    });

    renderRegionalPresets(container, countryState);
  };

  const { renderScenarioActionsPanel } = createScenarioInspectorController({
    t: translateCountryGeoLabel,
    selectGroupSystem: storeInspectorGroupSystem,
    getView: () => ({
      language: runtimeState.currentLanguage,
      inspectorGroupSystemByCode: runtimeState.ui?.inspectorGroupSystemByCode,
      visualOpen: !!runtimeState.ui?.scenarioVisualAdjustmentsOpen,
      paintMode: String(runtimeState.paintMode || "visual"),
      selectedColor: String(runtimeState.selectedColor || ""),
    }),
    getCountryState,
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
    getPrimaryReleasablePresetRef,
    applyScenarioReleasableCoreTerritory,
    selectedCountryActionsSection,
    scheduleAdaptiveInspectorHeights,
    setScenarioVisualAdjustmentsOpen,
    filterToVisibleFeatureIds,
    clearVisualOverridesForFeatureIds,
    showToast,
    applyVisualColorToOwnedRegions,
    clearCountryVisualOverrides,
    renderCountryColorSyncAffordance,
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
      waterInspectorLakeInteractionToggle,
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
      waterInspectorLocateBtn,
      waterInspectorMetaSection,
      waterInspectorMetaList,
      waterInspectorHierarchySection,
      waterInspectorBreadcrumb,
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
    refreshProjectAccountLanguage,
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
    },
  }));

  bindProjectSupportDiagnosticsEvents();

  ({
    bindEvents: bindStrategicOverlayEvents,
    closeCounterEditorModal,
    closeWorkspace: closeStrategicWorkspace,
    cancelEditingModes: cancelStrategicEditingModes,
    getPerfCounters: getStrategicOverlayPerfCounters,
    refreshUI: refreshStrategicOverlayUI,
  } = createStrategicOverlayController({
    state,
    elements: strategicPanelView.elements,
    helpers: {
      mapRenderer,
      render,
      t,
      showAppDialog,
      normalizeAnnotationView,
      captureHistoryState,
      pushHistoryEntry,
      markDirty,
      ...strategicPanelView.helpers,
      showToast,
    },
  }));

  bindStrategicOverlayEvents();

  let editorWorkspace = null;
  registerRuntimeHook(state, "renderCountryListFn", withEditorSelection(renderList));
  registerRuntimeHook(state, "renderWaterRegionListFn", withEditorSelection(renderWaterRegionList));
  registerRuntimeHook(state, "refreshWaterRegionListRowsFn", withEditorSelection(refreshWaterRegionRows));
  registerRuntimeHook(state, "updateWaterInteractionUIFn", renderWaterInteractionUi);
  registerRuntimeHook(state, "renderSpecialRegionListFn", withEditorSelection(renderSpecialRegionList));
  registerRuntimeHook(state, "refreshSpecialRegionListRowsFn", withEditorSelection(refreshSpecialRegionRows));
  registerRuntimeHook(state, "updateScenarioSpecialRegionUIFn", renderSpecialRegionInspectorUi);
  registerRuntimeHook(state, "updateScenarioReliefOverlayUIFn", renderSpecialRegionInspectorUi);
  registerRuntimeHook(state, "updateLegendUI", refreshLegendEditor);
  registerRuntimeHook(state, "updateProjectSaveStatusFn", refreshProjectSaveStatus);
  registerRuntimeHook(state, "refreshProjectAccountLanguageFn", refreshProjectAccountLanguage);
  registerRuntimeHook(state, "renderScenarioAuditPanelFn", renderScenarioAuditPanel);
  registerRuntimeHook(state, "updateStrategicOverlayUIFn", refreshStrategicOverlayUI);
  registerRuntimeHook(state, "getStrategicOverlayPerfCountersFn", getStrategicOverlayPerfCounters);
  registerRuntimeHook(state, "refreshCountryListRowsFn", withEditorSelection(refreshCountryRows));
  registerRuntimeHook(state, "refreshCountryInspectorDetailFn", withEditorSelection(renderCountryInspectorDetail));
  const requestedSidebarTab = restoreRightSidebarUrlState();
  setRightSidebarTab(requestedSidebarTab || runtimeState.ui?.rightSidebarTab || "inspector");
  callRuntimeHook(state, "restoreSupportSurfaceFromUrlFn");
  refreshStrategicOverlayUI();
  restoreCollapsedState();
  bindEvents();

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
      resetCountryColorsWithFeedback(() => {
        markDirty("reset-country-colors");
        callRuntimeHook(state, "renderCountryListFn");
        flushSidebarRender("sidebar-reset-country-colors");
        scheduleAdaptiveInspectorHeights();
      }, scheduleAdaptiveInspectorHeights);
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
  editorWorkspace = initEditorWorkspace({
    initialSearch: initialWorkspaceSearch,
    toggleInspector: () => {
      if (canCollapseRightSidebar()) toggleRightSidebarCollapsed();
      else callRuntimeHook(state, "toggleRightPanelFn");
    },
    revealProperties: () => {
      if (document.body.classList.contains("right-sidebar-collapsed")) setRightSidebarCollapsed(false);
      if (globalThis.matchMedia("(max-width: 1023px)").matches) {
        callRuntimeHook(state, "toggleRightPanelFn", true);
      }
    },
    t,
    onNavigate,
    setSidebarTab: setRightSidebarTab,
    setStrategicMode: (active) => {
      document.body.classList.toggle("frontline-mode-active", active);
      if (!active) {
        closeCounterEditorModal({ restoreFocus: false });
        cancelStrategicEditingModes();
        closeStrategicWorkspace();
      }
      refreshStrategicOverlayUI();
    },
  });
  syncEditorSelection();
  scheduleAdaptiveInspectorHeights();
}

export { initSidebar, requestHgoIdentityAssetsForSettings };
