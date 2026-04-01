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
import {
  clearJapanManifestOnlyFamilyPreview,
  destroyJapanManifestOnlyFamilyPreview,
  getJapanManifestOnlyFamilyPreviewSnapshot,
  isManifestOnlyFamily,
  renderJapanManifestOnlyFamilyPreview,
  warmJapanManifestOnlyFamilyPreview,
} from "./transport_workbench_manifest_preview.js";

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
  mineral_resources: {
    clear: () => clearJapanManifestOnlyFamilyPreview("mineral_resources"),
    destroy: () => destroyJapanManifestOnlyFamilyPreview("mineral_resources"),
    getSnapshot: () => getJapanManifestOnlyFamilyPreviewSnapshot("mineral_resources"),
    render: () => renderJapanManifestOnlyFamilyPreview("mineral_resources"),
    warm: () => warmJapanManifestOnlyFamilyPreview("mineral_resources"),
  },
  energy_facilities: {
    clear: () => clearJapanManifestOnlyFamilyPreview("energy_facilities"),
    destroy: () => destroyJapanManifestOnlyFamilyPreview("energy_facilities"),
    getSnapshot: () => getJapanManifestOnlyFamilyPreviewSnapshot("energy_facilities"),
    render: () => renderJapanManifestOnlyFamilyPreview("energy_facilities"),
    warm: () => warmJapanManifestOnlyFamilyPreview("energy_facilities"),
  },
  industrial_zones: {
    clear: () => clearJapanManifestOnlyFamilyPreview("industrial_zones"),
    destroy: () => destroyJapanManifestOnlyFamilyPreview("industrial_zones"),
    getSnapshot: () => getJapanManifestOnlyFamilyPreviewSnapshot("industrial_zones"),
    render: () => renderJapanManifestOnlyFamilyPreview("industrial_zones"),
    warm: () => warmJapanManifestOnlyFamilyPreview("industrial_zones"),
  },
};

function getFamilyHandler(familyId) {
  return FAMILY_PREVIEW_HANDLERS[String(familyId || "").trim()] || null;
}

export function isTransportWorkbenchFamilyLivePreviewCapable(familyId) {
  return !!getFamilyHandler(familyId) || isManifestOnlyFamily(familyId);
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
