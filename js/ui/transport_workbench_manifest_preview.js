const MANIFEST_URLS = {
  mineral_resources: "data/transport_layers/japan_mineral_resources/manifest.json",
  energy_facilities: "data/transport_layers/japan_energy_facilities/manifest.json",
  industrial_zones: "data/transport_layers/japan_industrial_zones/manifest.json",
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
  const state = getFamilyState(normalizedFamilyId);
  if (!state.manifestPromise) {
    state.snapshot.status = "loading";
    state.snapshot.previewStatus = "loading";
    state.manifestPromise = fetch(MANIFEST_URLS[normalizedFamilyId], { cache: "no-cache" })
      .then(async (response) => {
        if (response.status === 404) {
          state.snapshot = {
            ...createEmptyState(),
            status: "pending",
            previewStatus: "pending",
            fullStatus: "pending",
          };
          return state.snapshot;
        }
        if (!response.ok) {
          throw new Error(`Failed to load ${normalizedFamilyId} manifest: ${response.status}`);
        }
        const manifest = await response.json();
        state.snapshot.manifest = manifest;
        state.snapshot.stats = manifest?.feature_counts || {};
        state.snapshot.status = "ready";
        state.snapshot.previewStatus = "ready";
        state.snapshot.fullStatus = "ready";

        const auditPath = manifest?.paths?.build_audit;
        if (auditPath && !state.auditPromise) {
          state.auditPromise = fetch(auditPath, { cache: "no-cache" })
            .then(async (auditResponse) => {
              if (!auditResponse.ok) {
                throw new Error(`Failed to load ${normalizedFamilyId} audit: ${auditResponse.status}`);
              }
              const audit = await auditResponse.json();
              state.snapshot.audit = audit;
              return audit;
            })
            .catch((error) => {
              console.warn(`[transport-workbench] Failed to load ${normalizedFamilyId} audit.`, error);
              return null;
            });
        }

        const subtypeCatalogPath = manifest?.paths?.subtype_catalog;
        if (subtypeCatalogPath && !state.subtypeCatalogPromise) {
          state.subtypeCatalogPromise = fetch(subtypeCatalogPath, { cache: "no-cache" })
            .then(async (catalogResponse) => {
              if (!catalogResponse.ok) {
                throw new Error(`Failed to load ${normalizedFamilyId} subtype catalog: ${catalogResponse.status}`);
              }
              const catalog = await catalogResponse.json();
              state.snapshot.subtypeCatalog = Array.isArray(catalog) ? catalog : null;
              return state.snapshot.subtypeCatalog;
            })
            .catch((error) => {
              console.warn(`[transport-workbench] Failed to load ${normalizedFamilyId} subtype catalog.`, error);
              return null;
            });
        }

        return state.snapshot;
      })
      .catch((error) => {
        state.snapshot.status = "error";
        state.snapshot.previewStatus = "error";
        state.snapshot.fullStatus = "error";
        state.snapshot.error = error instanceof Error ? error.message : String(error);
        throw error;
      });
  }
  return state.manifestPromise;
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
  const state = getFamilyState(familyId);
  state.snapshot = {
    ...state.snapshot,
    selected: null,
  };
}

export function destroyJapanManifestOnlyFamilyPreview(familyId) {
  const normalizedFamilyId = String(familyId || "").trim();
  if (!familyState.has(normalizedFamilyId)) return;
  const state = familyState.get(normalizedFamilyId);
  state.snapshot = createEmptyState();
  familyState.delete(normalizedFamilyId);
}
