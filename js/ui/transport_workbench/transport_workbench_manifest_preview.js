import { resolveTransportManifestUrl } from "../../core/data_loader.js";
import { registerMapcreatorSnapshotProvider } from "../../core/mapcreator_snapshot.js";

const MANIFEST_URLS = {
  mineral_resources: resolveTransportManifestUrl("mineral_resources"),
  energy_facilities: resolveTransportManifestUrl("energy_facilities"),
  industrial_zones: resolveTransportManifestUrl("industrial_zones"),
  logistics_hubs: resolveTransportManifestUrl("logistics_hubs"),
};

const MANIFEST_ONLY_FAMILIES = new Set(Object.keys(MANIFEST_URLS));

const familyState = new Map();

function createEmptyState() {
  return {
    status: "idle",
    error: null,
    manifest: null,
    audit: null,
    subtypeCatalog: null,
    stats: {},
    packMode: null,
    previewStatus: "idle",
    fullStatus: "idle",
    selected: null,
  };
}

function getFamilyState(familyId) {
  // manifest-only family 没有本地 geometry pack；这里缓存 manifest/audit/subtype，供 inspector 与快照读取同一状态。
  const normalizedFamilyId = String(familyId || "").trim();
  if (!familyState.has(normalizedFamilyId)) {
    familyState.set(normalizedFamilyId, {
      snapshot: createEmptyState(),
    });
  }
  return familyState.get(normalizedFamilyId);
}

export function isManifestOnlyFamily(familyId) {
  return MANIFEST_ONLY_FAMILIES.has(String(familyId || "").trim());
}

export function getJapanManifestOnlyFamilyPreviewSnapshot(familyId) {
  return { ...getFamilyState(familyId).snapshot };
}

Array.from(MANIFEST_ONLY_FAMILIES)
  .sort((left, right) => left.localeCompare(right))
  .forEach((familyId) => {
    registerMapcreatorSnapshotProvider("loadStatus", `transport_preview_manifest:${familyId}`, () => (
      getJapanManifestOnlyFamilyPreviewSnapshot(familyId)
    ));
  });
