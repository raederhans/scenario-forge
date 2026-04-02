import {
  clearJapanAirportPreview,
  destroyJapanAirportPreview,
  getJapanAirportPreviewSnapshot,
  renderJapanAirportPreview,
  setJapanAirportPreviewSelectionListener,
  warmJapanAirportPreviewPack,
} from "./transport_workbench_airport_preview.js";
import {
  clearJapanPortPreview,
  destroyJapanPortPreview,
  getJapanPortPreviewSnapshot,
  renderJapanPortPreview,
  setJapanPortPreviewSelectionListener,
  warmJapanPortPreviewPack,
} from "./transport_workbench_port_preview.js";
import {
  clearJapanLogisticsHubPreview,
  destroyJapanLogisticsHubPreview,
  getJapanLogisticsHubPreviewSnapshot,
  renderJapanLogisticsHubPreview,
  setJapanLogisticsHubPreviewSelectionListener,
  warmJapanLogisticsHubPreviewPack,
} from "./transport_workbench_logistics_hub_preview.js";
import {
  clearJapanEnergyFacilityPreview,
  destroyJapanEnergyFacilityPreview,
  getJapanEnergyFacilityPreviewSnapshot,
  renderJapanEnergyFacilityPreview,
  setJapanEnergyFacilityPreviewSelectionListener,
  warmJapanEnergyFacilityPreviewPack,
} from "./transport_workbench_energy_facility_preview.js";
import {
  clearJapanIndustrialZonePreview,
  destroyJapanIndustrialZonePreview,
  getJapanIndustrialZonePreviewSnapshot,
  renderJapanIndustrialZonePreview,
  setJapanIndustrialZonePreviewSelectionListener,
  warmJapanIndustrialZonePreviewPack,
} from "./transport_workbench_industrial_zone_preview.js";
import {
  clearJapanRailPreview,
  destroyJapanRailPreview,
  getJapanRailPreviewSnapshot,
  renderJapanRailPreview,
  setJapanRailPreviewSelectionListener,
  warmJapanRailPreviewPack,
} from "./transport_workbench_rail_preview.js";
import {
  clearJapanRoadPreview,
  destroyJapanRoadPreview,
  getJapanRoadPreviewSnapshot,
  renderJapanRoadPreview,
  setJapanRoadPreviewSelectionListener,
  warmJapanRoadPreviewPack,
} from "./transport_workbench_road_preview.js";
import { isManifestOnlyFamily } from "./transport_workbench_manifest_preview.js";
import {
  clearJapanMineralResourcePreview,
  destroyJapanMineralResourcePreview,
  getJapanMineralResourcePreviewSnapshot,
  renderJapanMineralResourcePreview,
  setJapanMineralResourcePreviewSelectionListener,
  warmJapanMineralResourcePreviewPack,
} from "./transport_workbench_mineral_resource_preview.js";
import { getTransportWorkbenchFamilyRuntimeConfig } from "./transport_workbench_family_registry.js";

const FAMILY_PREVIEW_HANDLERS = {
  airport: {
    clear: clearJapanAirportPreview,
    destroy: destroyJapanAirportPreview,
    getSnapshot: getJapanAirportPreviewSnapshot,
    render: renderJapanAirportPreview,
    setSelectionListener: setJapanAirportPreviewSelectionListener,
    warm: warmJapanAirportPreviewPack,
  },
  port: {
    clear: clearJapanPortPreview,
    destroy: destroyJapanPortPreview,
    getSnapshot: getJapanPortPreviewSnapshot,
    render: renderJapanPortPreview,
    setSelectionListener: setJapanPortPreviewSelectionListener,
    warm: warmJapanPortPreviewPack,
  },
  logistics_hubs: {
    clear: clearJapanLogisticsHubPreview,
    destroy: destroyJapanLogisticsHubPreview,
    getSnapshot: getJapanLogisticsHubPreviewSnapshot,
    render: renderJapanLogisticsHubPreview,
    setSelectionListener: setJapanLogisticsHubPreviewSelectionListener,
    warm: warmJapanLogisticsHubPreviewPack,
  },
  mineral_resources: {
    clear: clearJapanMineralResourcePreview,
    destroy: destroyJapanMineralResourcePreview,
    getSnapshot: getJapanMineralResourcePreviewSnapshot,
    render: renderJapanMineralResourcePreview,
    setSelectionListener: setJapanMineralResourcePreviewSelectionListener,
    warm: warmJapanMineralResourcePreviewPack,
  },
  energy_facilities: {
    clear: clearJapanEnergyFacilityPreview,
    destroy: destroyJapanEnergyFacilityPreview,
    getSnapshot: getJapanEnergyFacilityPreviewSnapshot,
    render: renderJapanEnergyFacilityPreview,
    setSelectionListener: setJapanEnergyFacilityPreviewSelectionListener,
    warm: warmJapanEnergyFacilityPreviewPack,
  },
  industrial_zones: {
    clear: clearJapanIndustrialZonePreview,
    destroy: destroyJapanIndustrialZonePreview,
    getSnapshot: getJapanIndustrialZonePreviewSnapshot,
    render: renderJapanIndustrialZonePreview,
    setSelectionListener: setJapanIndustrialZonePreviewSelectionListener,
    warm: warmJapanIndustrialZonePreviewPack,
  },
  road: {
    clear: clearJapanRoadPreview,
    destroy: destroyJapanRoadPreview,
    getSnapshot: getJapanRoadPreviewSnapshot,
    render: renderJapanRoadPreview,
    setSelectionListener: setJapanRoadPreviewSelectionListener,
    warm: warmJapanRoadPreviewPack,
  },
  rail: {
    clear: clearJapanRailPreview,
    destroy: destroyJapanRailPreview,
    getSnapshot: getJapanRailPreviewSnapshot,
    render: renderJapanRailPreview,
    setSelectionListener: setJapanRailPreviewSelectionListener,
    warm: warmJapanRailPreviewPack,
  },
};

function getFamilyHandler(familyId) {
  return FAMILY_PREVIEW_HANDLERS[String(familyId || "").trim()] || null;
}

export function isTransportWorkbenchFamilyLivePreviewCapable(familyId) {
  return !!getFamilyHandler(familyId) || !!getTransportWorkbenchFamilyRuntimeConfig(familyId) || isManifestOnlyFamily(familyId);
}

export function setTransportWorkbenchFamilyPreviewSelectionListener(familyId, listener) {
  const handler = getFamilyHandler(familyId);
  if (!handler?.setSelectionListener) return;
  handler.setSelectionListener(listener);
}

export function getTransportWorkbenchFamilyPreviewSnapshot(familyId, config) {
  const handler = getFamilyHandler(familyId);
  if (!handler?.getSnapshot) {
    return {
      status: "idle",
      error: null,
      manifest: null,
      audit: null,
      stats: {},
      packMode: null,
      previewStatus: "idle",
      fullStatus: "idle",
      selected: null,
    };
  }
  return handler.getSnapshot(config);
}

export async function renderTransportWorkbenchFamilyPreview(familyId, config) {
  const handler = getFamilyHandler(familyId);
  if (!handler?.render) return null;
  Object.entries(FAMILY_PREVIEW_HANDLERS).forEach(([candidateFamilyId, candidateHandler]) => {
    if (candidateFamilyId === familyId) return;
    candidateHandler.clear?.();
  });
  return handler.render(config);
}

export async function warmTransportWorkbenchFamilyPreview(familyId, options = {}) {
  const handler = getFamilyHandler(familyId);
  if (!handler?.warm) return null;
  return handler.warm(options);
}

export function clearTransportWorkbenchFamilyPreview(familyId) {
  const handler = getFamilyHandler(familyId);
  if (!handler?.clear) return;
  handler.clear();
}

export function clearAllTransportWorkbenchFamilyPreviews() {
  Object.values(FAMILY_PREVIEW_HANDLERS).forEach((handler) => {
    handler.clear?.();
  });
}

export function destroyAllTransportWorkbenchFamilyPreviews() {
  Object.values(FAMILY_PREVIEW_HANDLERS).forEach((handler) => {
    handler.destroy?.();
  });
}
