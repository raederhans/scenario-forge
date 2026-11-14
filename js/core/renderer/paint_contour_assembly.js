import { callRuntimeHook } from "../state/index.js";
import { createPaintContourRuntime } from "./paint_contour_runtime.js";
import { createBorderIdentityResolver } from "./border_identity.js";
import { getParentMergedParents, resolveParentMergedBorderKeys, resolveParentMergedContourColor } from "./parent_merged_presentation.js";
import { getScenarioCountryTags } from "../state/actions/scenario_activation_actions.js";
import { normalizeScenarioDistrictGroupsPayload } from "../scenario/scenario_districts.js";
import { separatesPoliticalBorders } from "./political_border_policy.js";
import { getRiverPaintRuntime } from "../river_paint/runtime.js";
import { getMapDataBoundary } from "../map_data_boundary.js";
import { normalizeMapSemanticMode } from "../state.js";
import { isColorResolutionOceanFeature } from "./color_resolution_strategy.js";
import { isThematicWgiActive } from "../thematic/thematic_wgi_view_model.js";
import { isPopulationActive } from "../thematic/population_spatial_view_model.js";

export function createPaintContourAssembly({
  runtimeState,
  getFeatureId,
  canonicalCountryCode,
  getDisplayOwnerCode,
  getAdmin1Group,
  getFeatureCountryCodeNormalized,
  isScenarioShellFeature,
  getEffectiveWaterRegionFeatures,
  buildAtlantropaLandLikeFeatureCollection,
  hasVisibleRiverPartitions,
  shouldExcludePoliticalVisualFeature,
  isAtlantropaSeaFeature,
  LAND_FILL_COLOR,
  invalidateRenderPasses,
  requestRendererRender,
  getRiverInternalContourOwner,
  getRiverContourRenderOwner,
}) {
  let paintContourRuntimeOwner = null;
  let borderPaletteSource = null, borderPaletteColorRevision = -1, borderPaletteRevision = '';
  function getBorderPaletteRevision() {
    if (borderPaletteSource !== runtimeState.sovereignBaseColors || borderPaletteColorRevision !== runtimeState.colorRevision) {
      borderPaletteSource = runtimeState.sovereignBaseColors;
      borderPaletteColorRevision = runtimeState.colorRevision;
      borderPaletteRevision = JSON.stringify(borderPaletteSource || {});
    }
    return borderPaletteRevision;
  }
  let borderCountryTagsSource, borderCountryTags = null;
  function getBorderCountryTags() {
    if (borderCountryTagsSource !== runtimeState.scenarioCountriesByTag) {
      borderCountryTagsSource = runtimeState.scenarioCountriesByTag;
      borderCountryTags = getScenarioCountryTags(borderCountryTagsSource);
    }
    return borderCountryTags;
  }
  const resolveBorderIdentity = createBorderIdentityResolver({
    sovereignBaseColors: () => runtimeState.sovereignBaseColors,
    getCountryTags: getBorderCountryTags,
    getRevision: getBorderPaletteRevision,
    getReferenceOwner: (id, feature) => {
      const parent = getRiverPaintRuntime(runtimeState).getParentFeature(feature);
      return canonicalCountryCode(getDisplayOwnerCode(parent, feature?.properties?.__riverParentId || id));
    },
    getOverrideColor: (id, feature) => feature?.properties?.__riverParentId
      ? runtimeState.riverPaint?.overrides?.[id] || runtimeState.visualOverrides?.[feature.properties.__riverParentId]
      : runtimeState.visualOverrides?.[id],
  });
  let borderDistrictSource = null, borderDistrictGeneration = -1, borderDistrictGroups = new Map();
  function resolveClassifiedBorderFeature(feature, id) {
    if (borderDistrictSource !== runtimeState.scenarioDistrictGroupsData
      || borderDistrictGeneration !== runtimeState.scenarioDataGeneration) {
      borderDistrictSource = runtimeState.scenarioDistrictGroupsData;
      borderDistrictGeneration = runtimeState.scenarioDataGeneration;
      borderDistrictGroups = new Map();
      const payload = normalizeScenarioDistrictGroupsPayload(borderDistrictSource);
      for (const [tag, record] of Object.entries(payload.tags)) {
        const groups = new Map();
        for (const [districtId, district] of Object.entries(record.districts)) {
          for (const featureId of district.feature_ids) groups.set(featureId, `${tag}::${districtId}`);
        }
        borderDistrictGroups.set(tag, groups);
      }
    }
    const parent = getRiverPaintRuntime(runtimeState).getParentFeature(feature);
    const parentId = feature?.properties?.__riverParentId || id;
    const identityKey = resolveBorderIdentity(id, feature);
    const reference = canonicalCountryCode(getDisplayOwnerCode(parent, parentId));
    const districts = borderDistrictGroups.get(identityKey);
    const sourceParentKey = districts?.get(parentId)
      || (reference === identityKey ? runtimeState.parentGroupByFeatureId?.get(parentId) : '') || '';
    // A same-colour subject (Catalonia in Spain) draws only a regional line
    // against its parent; it never forms a national border of its own.
    const { borderKey, parentKey } = resolveParentMergedBorderKeys({ borderKey: identityKey, reference,
      parentKey: sourceParentKey, parents: getParentMergedParents(runtimeState.scenarioCountriesByTag) });
    // A country with scenario districts uses them as its only subdivision; its
    // source admin1 lines (e.g. the German Länder) would redraw a retired system.
    if (districts) return { borderKey, parentKey, provinceKey: '' };
    const admin1 = getAdmin1Group(parent);
    const sourceCountry = canonicalCountryCode(getFeatureCountryCodeNormalized(parent));
    return { borderKey, parentKey,
      provinceKey: admin1 && isBorderHomeCountry(borderKey, sourceCountry) ? `${sourceCountry}::${admin1}` : '' };
  }
  // Occupied or annexed land (German Bohemia, Austria, Poland) keeps no province
  // lines of its former country; only the owner's own source country does.
  function isBorderHomeCountry(borderKey, sourceCountry) {
    if (!sourceCountry || borderKey === sourceCountry) return true;
    const countries = runtimeState.scenarioCountriesByTag;
    if (!countries || typeof countries !== "object") return true;
    const record = countries[borderKey];
    if (!record) return false;
    return [record.base_iso2, record.lookup_iso2].some(code => code && canonicalCountryCode(code) === sourceCountry);
  }
  // Supported parent-border countries only grow within one scene, so painting a
  // country's last district edge away keeps its enabled preference for undo.
  let parentBorderSupportScene = "", parentBorderSupportKeys = new Set();
  function getClassifiedBorderMeshes() {
    const classification = getPaintContourRuntimeOwner().getClassification();
    if (classification) {
      const scene = `${runtimeState.activeScenarioId || ""}|${runtimeState.sceneGeneration || 0}`;
      if (scene !== parentBorderSupportScene) { parentBorderSupportScene = scene; parentBorderSupportKeys = new Set(); }
      for (const key of classification.parent.keys()) parentBorderSupportKeys.add(key);
      const supported = [...parentBorderSupportKeys].sort();
      if (supported.length !== runtimeState.parentBorderSupportedCountries?.length
        || supported.some((key, index) => key !== runtimeState.parentBorderSupportedCountries[index])) {
        runtimeState.parentBorderSupportedCountries = supported;
        callRuntimeHook(runtimeState, "updateParentBorderCountryListFn");
      }
    }
    return classification;
  }
  // Shell fills are drawn from the full collection but are not interactive, so
  // the surfaces lack them. Contours add them back as coverage-only features.
  let contourSourceBase = null, contourSourceFull = null, contourSourceFeatures = null;
  function getPaintContourSourceFeatures() {
    const base = getRiverPaintRuntime(runtimeState).surfaces();
    const full = runtimeState.landDataFull?.features;
    if (base !== contourSourceBase || full !== contourSourceFull) {
      contourSourceBase = base; contourSourceFull = full;
      const baseIds = new Set();
      for (const feature of base) baseIds.add(getFeatureId(feature));
      const shells = Array.isArray(full) ? full.filter((feature) => {
        const id = getFeatureId(feature);
        return id && !baseIds.has(id) && isScenarioShellFeature(feature, id);
      }) : [];
      contourSourceFeatures = shells.length ? Object.freeze([...base, ...shells]) : base;
    }
    return contourSourceFeatures;
  }
  function getPaintContourRuntimeOwner() {
    if (!paintContourRuntimeOwner) {
      paintContourRuntimeOwner = createPaintContourRuntime({
        state: runtimeState,
        getFeatures: getPaintContourSourceFeatures,
        getFeatureId,
        resolveSourceFeatureId: (feature, id) => feature?.properties?.__riverParentId || id,
        resolveClassification: resolveClassifiedBorderFeature,
        isCoverageOnly: (feature, id) => isScenarioShellFeature(feature, id),
        getWaterMaskSources: () => ({
          land: runtimeState.showScenarioAtlantropa === false ? runtimeState.landBgData
            : runtimeState.scenarioLandMaskData || runtimeState.scenarioContextLandMaskData || runtimeState.landBgData,
          water: getEffectiveWaterRegionFeatures(),
          addedLand: buildAtlantropaLandLikeFeatureCollection(),
        }),
        getClassificationRevision: () => [runtimeState.sovereignBaseColors, getBorderPaletteRevision(),
          runtimeState.scenarioDistrictGroupsData, runtimeState.scenarioDataGeneration, runtimeState.parentGroupByFeatureId,
          runtimeState.scenarioCountriesByTag],
        resolveBoundaryKey: (feature, id) => {
          const parent = getRiverPaintRuntime(runtimeState).getParentFeature(feature);
          return canonicalCountryCode(getDisplayOwnerCode(parent, feature?.properties?.__riverParentId || id));
        },
        getBoundaryRevision: () => [runtimeState.sovereigntyRevision, runtimeState.scenarioDataGeneration,
          runtimeState.scenarioShellOverlayRevision, hasVisibleRiverPartitions()].join("|"),
        separatePoliticalBorders: () => separatesPoliticalBorders(runtimeState),
        isArcEligible: (leftId, rightId) => {
          if (!hasVisibleRiverPartitions()) return true;
          const runtime = getRiverPaintRuntime(runtimeState);
          const parentId = runtime.getCellFeature(leftId)?.properties?.__riverParentId;
          return !parentId || parentId !== runtime.getCellFeature(rightId)?.properties?.__riverParentId;
        },
        // Visible shell fills cover gaps between source admin parcels; without
        // them the parcel edges beside each fill would be classified as coast.
        isEligible: (feature, id) => !shouldExcludePoliticalVisualFeature(feature, id)
          && !isColorResolutionOceanFeature(feature, id, { isAtlantropaSeaFeature })
          && (!feature.properties?.atl_color_rule || feature.properties.atl_color_rule === "owner"),
        resolveColor: (feature, id) => {
          const color = (feature?.properties?.__riverParentId
            ? getMapDataBoundary(runtimeState).paint.resolveRiverCellColor(id)
            : getMapDataBoundary(runtimeState).paint.resolveFeatureColor(id, {
              getBaseGroupCode: () => getMapDataBoundary(runtimeState).reference.getBaseGroupCode(feature),
            })).color || (normalizeMapSemanticMode(runtimeState.mapSemanticMode) === "blank" ? "#d7d3c7" : LAND_FILL_COLOR);
          const parents = getParentMergedParents(runtimeState.scenarioCountriesByTag);
          if (!parents.size) return color;
          const parent = getRiverPaintRuntime(runtimeState).getParentFeature(feature);
          const owner = canonicalCountryCode(getDisplayOwnerCode(parent, feature?.properties?.__riverParentId || id));
          return resolveParentMergedContourColor({ color, owner, parents, baseColors: runtimeState.sovereignBaseColors });
        },
        onChange: (reason) => {
          invalidateRenderPasses("borders", reason);
          // 特殊区域外轮廓依赖边图；边图异步就绪后让特殊区域重绘，不再停留在回退轮廓。
          runtimeState.specialZonesOverlayDirty = true;
          requestRendererRender(reason, { flush: false });
        },
      });
    }
    return paintContourRuntimeOwner;
  }

  async function ensurePaintContoursReady() {
    const riverPartitionsRequired = !isThematicWgiActive(runtimeState) && !isPopulationActive(runtimeState);
    if (riverPartitionsRequired) getRiverPaintRuntime(runtimeState).assertReadyForExport();
    await Promise.all([
      getPaintContourRuntimeOwner().ensureReady(),
      ...(riverPartitionsRequired ? [getRiverInternalContourOwner().ensureReady()] : []),
    ]);
  }

  function getPaintContourDiagnostics() {
    return { ...getPaintContourRuntimeOwner().diagnostics(),
      internal: getRiverInternalContourOwner().diagnostics(), visibility: getRiverContourRenderOwner().diagnostics() };
  }

  function notifyPaintContourColorsChanged(ids = null) {
    const globalChanged = getPaintContourRuntimeOwner().notifyPaintChanged(ids);
    const internalChanged = getRiverInternalContourOwner().notifyPaintChanged(ids);
    if (globalChanged || internalChanged) invalidateRenderPasses("borders", "paint-contours-colors");
  }
  function disposePaintContoursIfCreated() {
    return paintContourRuntimeOwner?.dispose();
  }

  function notifyPaintContourSourcePublished(publication) {
    return paintContourRuntimeOwner?.notifySourcePublished(publication);
  }

  function hasPendingPaintContourWork() {
    return paintContourRuntimeOwner?.hasPendingWork();
  }

  return {
    getPaintContourRuntimeOwner,
    notifyPaintContourColorsChanged,
    ensurePaintContoursReady,
    getPaintContourDiagnostics,
    resolveBorderIdentity,
    getClassifiedBorderMeshes,
    disposePaintContoursIfCreated,
    notifyPaintContourSourcePublished,
    hasPendingPaintContourWork,
  };
}
