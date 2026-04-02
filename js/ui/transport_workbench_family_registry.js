const TRANSPORT_WORKBENCH_RUNTIME_FAMILY_REGISTRY = Object.freeze({
  road: Object.freeze({
    id: "road",
    runtimeKind: "line",
    geometryKind: "line",
    previewKind: "live",
    warmup: Object.freeze({ includeFull: false }),
  }),
  rail: Object.freeze({
    id: "rail",
    runtimeKind: "line",
    geometryKind: "line",
    previewKind: "live",
    warmup: Object.freeze({ includeFull: false }),
  }),
  airport: Object.freeze({
    id: "airport",
    runtimeKind: "point",
    geometryKind: "point",
    previewKind: "live",
    warmup: Object.freeze({ enabled: false, includeFull: true }),
  }),
  port: Object.freeze({
    id: "port",
    runtimeKind: "point",
    geometryKind: "point",
    previewKind: "live",
    warmup: Object.freeze({ enabled: false, includeFull: true }),
  }),
  logistics_hubs: Object.freeze({
    id: "logistics_hubs",
    runtimeKind: "point",
    geometryKind: "point",
    previewKind: "live",
    warmup: Object.freeze({ enabled: false, includeFull: true }),
  }),
  mineral_resources: Object.freeze({
    id: "mineral_resources",
    runtimeKind: "point",
    geometryKind: "point",
    previewKind: "live",
    warmup: Object.freeze({ enabled: false, includeFull: false }),
  }),
  energy_facilities: Object.freeze({
    id: "energy_facilities",
    runtimeKind: "point",
    geometryKind: "point",
    previewKind: "live",
    warmup: Object.freeze({ enabled: false, includeFull: false }),
  }),
  industrial_zones: Object.freeze({
    id: "industrial_zones",
    runtimeKind: "polygon",
    geometryKind: "polygon",
    previewKind: "live",
    warmup: Object.freeze({ enabled: false, includeFull: false }),
  }),
});

const TRANSPORT_WORKBENCH_RUNTIME_FAMILY_IDS = Object.freeze(
  Object.keys(TRANSPORT_WORKBENCH_RUNTIME_FAMILY_REGISTRY)
);

export function getTransportWorkbenchFamilyRuntimeConfig(familyId) {
  const normalizedFamilyId = String(familyId || "").trim();
  return TRANSPORT_WORKBENCH_RUNTIME_FAMILY_REGISTRY[normalizedFamilyId] || null;
}

export function listTransportWorkbenchRuntimeFamilyIds() {
  return [...TRANSPORT_WORKBENCH_RUNTIME_FAMILY_IDS];
}

export function listTransportWorkbenchWarmupPlans() {
  return TRANSPORT_WORKBENCH_RUNTIME_FAMILY_IDS
    .map((familyId) => ({
      familyId,
      ...(getTransportWorkbenchFamilyRuntimeConfig(familyId)?.warmup || {}),
    }))
    .filter((plan) => plan.enabled !== false);
}

export function isTransportWorkbenchLivePreviewFamily(familyId) {
  return getTransportWorkbenchFamilyRuntimeConfig(familyId)?.previewKind === "live";
}

export function isTransportWorkbenchManifestOnlyRuntimeFamily(familyId) {
  return getTransportWorkbenchFamilyRuntimeConfig(familyId)?.previewKind === "manifest";
}
