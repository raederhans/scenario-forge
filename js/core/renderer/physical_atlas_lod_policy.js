export const PHYSICAL_ATLAS_DETAIL_MIN_ZOOM = 4;
export const PHYSICAL_ATLAS_DETAIL_LAYER = "physical_semantics_detail";

export function isPhysicalAtlasDetailScale(state = {}) {
  return Number(state.zoomTransform?.k || 1) >= PHYSICAL_ATLAS_DETAIL_MIN_ZOOM;
}

export function shouldRequestPhysicalAtlasDetail(state = {}) {
  return !!state.showPhysical && state.styleConfig?.physical?.mode !== "contours_only"
    && isPhysicalAtlasDetailScale(state);
}

export function resolvePhysicalAtlasCollection(state = {}) {
  const detail = state.contextLayerExternalDataByName?.[PHYSICAL_ATLAS_DETAIL_LAYER];
  return isPhysicalAtlasDetailScale(state) && detail?.features?.length
    ? detail : state.physicalSemanticsData || null;
}

export function getPhysicalPresentationLayerRequests(state = {}) {
  if (!state.showPhysical || state.styleConfig?.physical?.mode === "contours_only") return [];
  const config = state.styleConfig?.physical || {};
  const layers = [];
  if (config.showRegionLabels && Number(state.zoomTransform?.k || 1) >= 2) layers.push("physical_region_labels");
  if (config.hillshadeOpacity > 0 && isPhysicalAtlasDetailScale(state)) layers.push("physical_hillshade");
  return layers;
}
