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

const FAMILY_PREVIEW_HANDLERS = {
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
  return !!getFamilyHandler(familyId);
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
