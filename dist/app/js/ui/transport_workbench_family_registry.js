import {
  getTransportCapabilityFamilyMetadata,
  isTransportCapabilityLivePreviewFamily,
  isTransportCapabilityManifestOnlyFamily,
  listTransportCapabilityWarmupPlans,
  listTransportRuntimeCapabilityFamilyIds,
} from "../core/transport_capability_registry.js";


const TRANSPORT_WORKBENCH_FAMILY_PREVIEW_EXPORTS = Object.freeze({
  airport: Object.freeze({
    moduleKey: "airport",
    clear: "clearJapanAirportPreview",
    destroy: "destroyJapanAirportPreview",
    getSnapshot: "getJapanAirportPreviewSnapshot",
    render: "renderJapanAirportPreview",
    selectFeature: "selectJapanAirportPreviewFeature",
    setSelectionListener: "setJapanAirportPreviewSelectionListener",
    warm: "warmJapanAirportPreviewPack",
  }),
  port: Object.freeze({
    moduleKey: "port",
    clear: "clearJapanPortPreview",
    destroy: "destroyJapanPortPreview",
    getSnapshot: "getJapanPortPreviewSnapshot",
    render: "renderJapanPortPreview",
    selectFeature: "selectJapanPortPreviewFeature",
    setSelectionListener: "setJapanPortPreviewSelectionListener",
    warm: "warmJapanPortPreviewPack",
  }),
  logistics_hubs: Object.freeze({
    moduleKey: "logistics_hubs",
    clear: "clearJapanLogisticsHubPreview",
    destroy: "destroyJapanLogisticsHubPreview",
    getSnapshot: "getJapanLogisticsHubPreviewSnapshot",
    render: "renderJapanLogisticsHubPreview",
    selectFeature: "selectJapanLogisticsHubPreviewFeature",
    setSelectionListener: "setJapanLogisticsHubPreviewSelectionListener",
    warm: "warmJapanLogisticsHubPreviewPack",
  }),
  mineral_resources: Object.freeze({
    moduleKey: "mineral_resources",
    clear: "clearJapanMineralResourcePreview",
    destroy: "destroyJapanMineralResourcePreview",
    getSnapshot: "getJapanMineralResourcePreviewSnapshot",
    render: "renderJapanMineralResourcePreview",
    selectFeature: "selectJapanMineralResourcePreviewFeature",
    setSelectionListener: "setJapanMineralResourcePreviewSelectionListener",
    warm: "warmJapanMineralResourcePreviewPack",
  }),
  energy_facilities: Object.freeze({
    moduleKey: "energy_facilities",
    clear: "clearJapanEnergyFacilityPreview",
    destroy: "destroyJapanEnergyFacilityPreview",
    getSnapshot: "getJapanEnergyFacilityPreviewSnapshot",
    render: "renderJapanEnergyFacilityPreview",
    selectFeature: "selectJapanEnergyFacilityPreviewFeature",
    setSelectionListener: "setJapanEnergyFacilityPreviewSelectionListener",
    warm: "warmJapanEnergyFacilityPreviewPack",
  }),
  industrial_zones: Object.freeze({
    moduleKey: "industrial_zones",
    clear: "clearJapanIndustrialZonePreview",
    destroy: "destroyJapanIndustrialZonePreview",
    getSnapshot: "getJapanIndustrialZonePreviewSnapshot",
    render: "renderJapanIndustrialZonePreview",
    selectFeature: "selectJapanIndustrialZonePreviewFeature",
    setSelectionListener: "setJapanIndustrialZonePreviewSelectionListener",
    warm: "warmJapanIndustrialZonePreviewPack",
  }),
  road: Object.freeze({
    moduleKey: "road",
    clear: "clearJapanRoadPreview",
    destroy: "destroyJapanRoadPreview",
    getSnapshot: "getJapanRoadPreviewSnapshot",
    render: "renderJapanRoadPreview",
    prepare: "prepareJapanRoadPreview",
    selectFeature: "selectJapanRoadPreviewFeature",
    setSelectionListener: "setJapanRoadPreviewSelectionListener",
    warm: "warmJapanRoadPreviewPack",
    previewOnly: true,
  }),
  rail: Object.freeze({
    moduleKey: "rail",
    clear: "clearJapanRailPreview",
    destroy: "destroyJapanRailPreview",
    getSnapshot: "getJapanRailPreviewSnapshot",
    render: "renderJapanRailPreview",
    prepare: "prepareJapanRailPreview",
    selectFeature: "selectJapanRailPreviewFeature",
    setSelectionListener: "setJapanRailPreviewSelectionListener",
    warm: "warmJapanRailPreviewPack",
    previewOnly: true,
  }),
});

export function getTransportWorkbenchFamilyRuntimeConfig(familyId) {
  const metadata = getTransportCapabilityFamilyMetadata(familyId);
  return metadata?.runtimeKind === "board" ? null : metadata;
}

export function listTransportWorkbenchRuntimeFamilyIds() {
  return listTransportRuntimeCapabilityFamilyIds();
}

export function listTransportWorkbenchWarmupPlans() {
  return listTransportCapabilityWarmupPlans();
}

export function isTransportWorkbenchLivePreviewFamily(familyId) {
  return isTransportCapabilityLivePreviewFamily(familyId);
}

export function isTransportWorkbenchManifestOnlyRuntimeFamily(familyId) {
  return isTransportCapabilityManifestOnlyFamily(familyId);
}

export function getTransportWorkbenchFamilyPreviewConfig(familyId) {
  const normalizedFamilyId = String(familyId || "").trim();
  const metadata = getTransportWorkbenchFamilyRuntimeConfig(normalizedFamilyId);
  const exportsConfig = TRANSPORT_WORKBENCH_FAMILY_PREVIEW_EXPORTS[normalizedFamilyId];
  if (!metadata || !exportsConfig) return null;
  return Object.freeze({
    familyId: normalizedFamilyId,
    baseCapability: metadata.baseCapability,
    runtimeKind: metadata.runtimeKind,
    geometryKind: metadata.geometryKind,
    previewOnly: !!exportsConfig.previewOnly,
    exports: exportsConfig,
  });
}

export function listTransportWorkbenchFamilyPreviewConfigs() {
  return listTransportWorkbenchRuntimeFamilyIds()
    .map(getTransportWorkbenchFamilyPreviewConfig)
    .filter(Boolean);
}
