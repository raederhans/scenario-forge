const MANIFEST_URLS = {
  mineral_resources: "data/transport_layers/japan_mineral_resources/manifest.json",
  energy_facilities: "data/transport_layers/japan_energy_facilities/manifest.json",
  industrial_zones: "data/transport_layers/japan_industrial_zones/manifest.json",
  logistics_hubs: "data/transport_layers/japan_logistics_hubs/manifest.json",
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
  const normalizedFamilyId = String(familyId || "").trim();
  if (!familyState.has(normalizedFamilyId)) {
    familyState.set(normalizedFamilyId, {
      snapshot: createEmptyState(),
      manifestPromise: null,
      auditPromise: null,
      subtypeCatalogPromise: null,
    });
  }
  return familyState.get(normalizedFamilyId);
}

async function startManifestOnlyPreviewLoad(familyId) {
  const normalizedFamilyId = String(familyId || "").trim();
  if (!MANIFEST_ONLY_FAMILIES.has(normalizedFamilyId)) return createEmptyState();
  const previewRuntime = getFamilyState(normalizedFamilyId);
  if (!previewRuntime.manifestPromise) {
    previewRuntime.snapshot.status = "loading";
    previewRuntime.snapshot.previewStatus = "loading";
    previewRuntime.manifestPromise = fetch(MANIFEST_URLS[normalizedFamilyId], { cache: "no-cache" })
      .then(async (response) => {
        if (response.status === 404) {
          previewRuntime.snapshot = {
            ...createEmptyState(),
            status: "pending",
            previewStatus: "pending",
            fullStatus: "pending",
          };
          return previewRuntime.snapshot;
        }
        if (!response.ok) {
          throw new Error(`Failed to load ${normalizedFamilyId} manifest: ${response.status}`);
        }
        const manifest = await response.json();
        previewRuntime.snapshot.manifest = manifest;
        previewRuntime.snapshot.stats = manifest?.feature_counts || {};
        previewRuntime.snapshot.status = "ready";
        previewRuntime.snapshot.previewStatus = "ready";
        previewRuntime.snapshot.fullStatus = "ready";

        const auditPath = manifest?.paths?.build_audit;
        if (auditPath && !previewRuntime.auditPromise) {
          previewRuntime.auditPromise = fetch(auditPath, { cache: "no-cache" })
            .then(async (auditResponse) => {
              if (!auditResponse.ok) {
                throw new Error(`Failed to load ${normalizedFamilyId} audit: ${auditResponse.status}`);
              }
              const audit = await auditResponse.json();
              previewRuntime.snapshot.audit = audit;
              return audit;
            })
            .catch((error) => {
              console.warn(`[transport-workbench] Failed to load ${normalizedFamilyId} audit.`, error);
              return null;
            });
        }

        const subtypeCatalogPath = manifest?.paths?.subtype_catalog;
        if (subtypeCatalogPath && !previewRuntime.subtypeCatalogPromise) {
          previewRuntime.subtypeCatalogPromise = fetch(subtypeCatalogPath, { cache: "no-cache" })
            .then(async (catalogResponse) => {
              if (!catalogResponse.ok) {
                throw new Error(`Failed to load ${normalizedFamilyId} subtype catalog: ${catalogResponse.status}`);
              }
              const catalog = await catalogResponse.json();
              previewRuntime.snapshot.subtypeCatalog = Array.isArray(catalog) ? catalog : null;
              return previewRuntime.snapshot.subtypeCatalog;
            })
            .catch((error) => {
              console.warn(`[transport-workbench] Failed to load ${normalizedFamilyId} subtype catalog.`, error);
              return null;
            });
        }

        return previewRuntime.snapshot;
      })
      .catch((error) => {
        previewRuntime.snapshot.status = "error";
        previewRuntime.snapshot.previewStatus = "error";
        previewRuntime.snapshot.fullStatus = "error";
        previewRuntime.snapshot.error = error instanceof Error ? error.message : String(error);
        throw error;
      });
  }
  return previewRuntime.manifestPromise;
}

export function isManifestOnlyFamily(familyId) {
  return MANIFEST_ONLY_FAMILIES.has(String(familyId || "").trim());
}

export async function renderJapanManifestOnlyFamilyPreview(familyId) {
  return startManifestOnlyPreviewLoad(familyId);
}

export async function warmJapanManifestOnlyFamilyPreview(familyId) {
  return startManifestOnlyPreviewLoad(familyId);
}

export function getJapanManifestOnlyFamilyPreviewSnapshot(familyId) {
  return { ...getFamilyState(familyId).snapshot };
}

export function clearJapanManifestOnlyFamilyPreview(familyId) {
  const previewRuntime = getFamilyState(familyId);
  previewRuntime.snapshot = {
    ...previewRuntime.snapshot,
    selected: null,
  };
}

export function destroyJapanManifestOnlyFamilyPreview(familyId) {
  const normalizedFamilyId = String(familyId || "").trim();
  if (!familyState.has(normalizedFamilyId)) return;
  const previewRuntime = familyState.get(normalizedFamilyId);
  previewRuntime.snapshot = createEmptyState();
  familyState.delete(normalizedFamilyId);
}
