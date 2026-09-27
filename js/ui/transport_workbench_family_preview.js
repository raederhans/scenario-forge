import * as airportPreview from "./transport_workbench_airport_preview.js";
import * as portPreview from "./transport_workbench_port_preview.js";
import * as logisticsHubPreview from "./transport_workbench_logistics_hub_preview.js";
import * as energyFacilityPreview from "./transport_workbench_energy_facility_preview.js";
import * as industrialZonePreview from "./transport_workbench_industrial_zone_preview.js";
import * as railPreview from "./transport_workbench_rail_preview.js";
import * as roadPreview from "./transport_workbench_road_preview.js";
import * as mineralResourcePreview from "./transport_workbench_mineral_resource_preview.js";
import { isManifestOnlyFamily } from "./transport_workbench_manifest_preview.js";
import {
  getTransportWorkbenchFamilyPreviewConfig,
  getTransportWorkbenchFamilyRuntimeConfig,
  listTransportWorkbenchFamilyPreviewConfigs,
} from "./transport_workbench_family_registry.js";

const PREVIEW_MODULES_BY_KEY = Object.freeze({
  airport: airportPreview,
  port: portPreview,
  logistics_hubs: logisticsHubPreview,
  mineral_resources: mineralResourcePreview,
  energy_facilities: energyFacilityPreview,
  industrial_zones: industrialZonePreview,
  road: roadPreview,
  rail: railPreview,
});

// handler 由 family registry 的 exports 描述生成；新增 family 时先补 registry，再让这里按 moduleKey 接线。
const previewHandlerCache = new Map();

function createEmptyPreviewSnapshot() {
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

function createPreviewHandler(previewConfig) {
  const exportsConfig = previewConfig?.exports;
  const previewModule = PREVIEW_MODULES_BY_KEY[exportsConfig?.moduleKey];
  if (!previewModule) return null;

  const handler = {
    clear: previewModule[exportsConfig.clear],
    destroy: previewModule[exportsConfig.destroy],
    getSnapshot: previewModule[exportsConfig.getSnapshot],
    render: previewModule[exportsConfig.render],
    selectFeature: previewModule[exportsConfig.selectFeature],
    setSelectionListener: previewModule[exportsConfig.setSelectionListener],
    warm: previewModule[exportsConfig.warm],
    prepare: exportsConfig?.prepare ? previewModule[exportsConfig.prepare] : null,
    previewOnly: !!previewConfig.previewOnly,
  };

  return Object.freeze(handler);
}

function getFamilyHandler(familyId) {
  const normalizedFamilyId = String(familyId || "").trim();
  if (!normalizedFamilyId) return null;
  if (!previewHandlerCache.has(normalizedFamilyId)) {
    previewHandlerCache.set(
      normalizedFamilyId,
      createPreviewHandler(getTransportWorkbenchFamilyPreviewConfig(normalizedFamilyId))
    );
  }
  return previewHandlerCache.get(normalizedFamilyId) || null;
}

function forEachPreviewHandler(callback) {
  listTransportWorkbenchFamilyPreviewConfigs().forEach((previewConfig) => {
    const handler = getFamilyHandler(previewConfig.familyId);
    if (handler) callback(previewConfig.familyId, handler);
  });
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
  if (!handler?.getSnapshot) return createEmptyPreviewSnapshot();
  return handler.getSnapshot(config);
}

export function selectTransportWorkbenchFamilyPreviewFeature(familyId, selection) {
  const handler = getFamilyHandler(familyId);
  if (!handler?.selectFeature) return false;
  return !!handler.selectFeature(selection);
}

export async function renderTransportWorkbenchFamilyPreview(familyId, config, options = {}) {
  const normalizedFamilyId = String(familyId || "").trim();
  const handler = getFamilyHandler(normalizedFamilyId);
  if (!handler?.render) return null;
  // 同一时间只保留当前 family 的 preview，避免旧 canvas/selection listener 继续影响 inspector。
  forEachPreviewHandler((candidateFamilyId, candidateHandler) => {
    if (candidateFamilyId === normalizedFamilyId) return;
    candidateHandler.clear?.();
  });
  return handler.render(config, options);
}

export async function prepareTransportWorkbenchFamilyPreview(familyId, config, options = {}) {
  const normalizedFamilyId = String(familyId || "").trim();
  const handler = getFamilyHandler(normalizedFamilyId);
  if (typeof handler?.prepare === "function") {
    return handler.prepare(config, options);
  }
  return null;
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
  forEachPreviewHandler((_familyId, handler) => {
    handler.clear?.();
  });
}

export function destroyAllTransportWorkbenchFamilyPreviews() {
  forEachPreviewHandler((_familyId, handler) => {
    handler.destroy?.();
  });
  previewHandlerCache.clear();
}
