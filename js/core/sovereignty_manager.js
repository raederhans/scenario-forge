import { normalizePhysicalStyleConfig, normalizeTextureMode, state } from "./state.js";

const COUNTRY_CODE_ALIASES = {
  UK: "GB",
  EL: "GR",
};
const FEATURE_MIGRATION_URLS = ["data/feature-migrations/by_hybrid_v1.json"];
let featureMigrationMapPromise = null;

function normalizeOwnerCode(rawCode) {
  const code = String(rawCode || "").trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (!code) return "";
  return COUNTRY_CODE_ALIASES[code] || code;
}

function getCanonicalCountryCodeForFeature(feature) {
  if (!feature) return "";
  const props = feature.properties || {};
  const direct = (
    props.cntr_code ||
    props.CNTR_CODE ||
    props.iso_a2 ||
    props.ISO_A2 ||
    props.iso_a2_eh ||
    props.ISO_A2_EH ||
    props.adm0_a2 ||
    props.ADM0_A2 ||
    ""
  );
  return normalizeOwnerCode(direct);
}

function getFeatureId(featureOrId) {
  if (!featureOrId) return "";
  if (typeof featureOrId === "string") return featureOrId.trim();
  return String(
    featureOrId?.properties?.id ??
      featureOrId?.properties?.NUTS_ID ??
      featureOrId?.id ??
      ""
  ).trim();
}

function seedSovereigntyFromLandData(featureCollection) {
  const next = {};
  const features = Array.isArray(featureCollection?.features) ? featureCollection.features : [];
  features.forEach((feature) => {
    const id = getFeatureId(feature);
    const code = getCanonicalCountryCodeForFeature(feature);
    if (!id || !code) return;
    next[id] = code;
  });
  return next;
}

function migrateLegacyColorState() {
  state.sovereignBaseColors = {
    ...(state.countryBaseColors || {}),
    ...(state.sovereignBaseColors || {}),
  };
  state.visualOverrides = {
    ...(state.featureOverrides || {}),
    ...(state.visualOverrides || {}),
  };
}

function ensureOwnerIndexMaps() {
  if (!(state.ownerToFeatureIds instanceof Map)) {
    state.ownerToFeatureIds = new Map();
  }
}

function rebuildOwnerIndex() {
  ensureOwnerIndexMaps();
  state.ownerToFeatureIds.clear();
  Object.entries(state.sovereigntyByFeatureId || {}).forEach(([id, ownerCode]) => {
    const code = normalizeOwnerCode(ownerCode);
    if (!id || !code) return;
    const bucket = state.ownerToFeatureIds.get(code) || new Set();
    bucket.add(id);
    state.ownerToFeatureIds.set(code, bucket);
  });
}

function ensureSovereigntyState({ force = false } = {}) {
  migrateLegacyColorState();
  state.sovereignBaseColors = state.sovereignBaseColors || {};
  state.visualOverrides = state.visualOverrides || {};
  state.sovereigntyByFeatureId = state.sovereigntyByFeatureId || {};

  if (state.sovereigntyInitialized && !force) {
    ensureOwnerIndexMaps();
    return state.sovereigntyByFeatureId;
  }

  const seeded = seedSovereigntyFromLandData(state.landData);
  state.sovereigntyByFeatureId = {
    ...seeded,
    ...state.sovereigntyByFeatureId,
  };
  state.sovereigntyInitialized = true;
  rebuildOwnerIndex();
  return state.sovereigntyByFeatureId;
}

function getFeatureOwnerCode(featureOrId, { skipEnsure = true } = {}) {
  const id = getFeatureId(featureOrId);
  if (!id) return "";
  if (!skipEnsure) {
    ensureSovereigntyState();
  }
  const direct = normalizeOwnerCode(state.sovereigntyByFeatureId?.[id] || "");
  if (direct) return direct;
  const feature = typeof featureOrId === "string" ? state.landIndex?.get(id) : featureOrId;
  return getCanonicalCountryCodeForFeature(feature);
}

function touchSovereigntyRevision() {
  state.sovereigntyRevision = (Number(state.sovereigntyRevision) || 0) + 1;
}

function updateOwnerIndexForMove(featureId, prevOwnerCode, nextOwnerCode) {
  ensureOwnerIndexMaps();
  const prevCode = normalizeOwnerCode(prevOwnerCode);
  const nextCode = normalizeOwnerCode(nextOwnerCode);
  if (prevCode) {
    const prevBucket = state.ownerToFeatureIds.get(prevCode);
    if (prevBucket instanceof Set) {
      prevBucket.delete(featureId);
      if (prevBucket.size === 0) {
        state.ownerToFeatureIds.delete(prevCode);
      }
    }
  }
  if (nextCode) {
    const nextBucket = state.ownerToFeatureIds.get(nextCode) || new Set();
    nextBucket.add(featureId);
    state.ownerToFeatureIds.set(nextCode, nextBucket);
  }
}

function setFeatureOwnerCode(featureId, ownerCode) {
  const id = getFeatureId(featureId);
  const code = normalizeOwnerCode(ownerCode);
  if (!id || !code) return false;
  const landIndex = state.landIndex instanceof Map ? state.landIndex : null;
  if (landIndex && landIndex.size > 0 && !landIndex.has(id)) {
    // Ignore writes for features that are not currently present in the loaded map topology.
    return false;
  }
  ensureSovereigntyState();
  const prev = getFeatureOwnerCode(id, { skipEnsure: true });
  if (prev === code) return false;
  state.sovereigntyByFeatureId[id] = code;
  updateOwnerIndexForMove(id, prev, code);
  touchSovereigntyRevision();
  return true;
}

function setFeatureOwnerCodes(featureIds, ownerCode) {
  ensureSovereigntyState();
  const ids = Array.isArray(featureIds) ? featureIds : [];
  let changed = 0;
  ids.forEach((featureId) => {
    if (setFeatureOwnerCode(featureId, ownerCode)) {
      changed += 1;
    }
  });
  return changed;
}

function resetFeatureOwnerCode(featureId) {
  const id = getFeatureId(featureId);
  if (!id) return false;
  ensureSovereigntyState();
  const feature = state.landIndex?.get(id);
  const canonical = getCanonicalCountryCodeForFeature(feature);
  if (!canonical) return false;
  const prev = getFeatureOwnerCode(id, { skipEnsure: true });
  if (prev === canonical) return false;
  state.sovereigntyByFeatureId[id] = canonical;
  updateOwnerIndexForMove(id, prev, canonical);
  touchSovereigntyRevision();
  return true;
}

function resetFeatureOwnerCodes(featureIds) {
  ensureSovereigntyState();
  const ids = Array.isArray(featureIds) ? featureIds : [];
  let changed = 0;
  ids.forEach((featureId) => {
    if (resetFeatureOwnerCode(featureId)) {
      changed += 1;
    }
  });
  return changed;
}

function resetAllFeatureOwnersToCanonical() {
  state.sovereigntyByFeatureId = seedSovereigntyFromLandData(state.landData);
  state.sovereigntyInitialized = true;
  rebuildOwnerIndex();
  touchSovereigntyRevision();
}

function getFeatureIdsForOwner(ownerCode) {
  ensureOwnerIndexMaps();
  const code = normalizeOwnerCode(ownerCode);
  if (!code) return [];
  const bucket = state.ownerToFeatureIds.get(code);
  if (!(bucket instanceof Set)) return [];
  return Array.from(bucket);
}

function migrateImportedProjectData(data) {
  const payload = data && typeof data === "object" ? { ...data } : {};
  payload.sovereignBaseColors =
    payload.sovereignBaseColors && typeof payload.sovereignBaseColors === "object"
      ? payload.sovereignBaseColors
      : payload.countryBaseColors && typeof payload.countryBaseColors === "object"
        ? payload.countryBaseColors
        : {};
  payload.visualOverrides =
    payload.visualOverrides && typeof payload.visualOverrides === "object"
      ? payload.visualOverrides
      : payload.featureOverrides && typeof payload.featureOverrides === "object"
        ? payload.featureOverrides
        : {};
  payload.sovereigntyByFeatureId =
    payload.sovereigntyByFeatureId && typeof payload.sovereigntyByFeatureId === "object"
      ? payload.sovereigntyByFeatureId
      : {};
  payload.paintMode =
    payload.paintMode === "sovereignty" ? "sovereignty" : "visual";
  payload.activeSovereignCode = normalizeOwnerCode(payload.activeSovereignCode || "");
  payload.dynamicBordersDirty = !!payload.dynamicBordersDirty;
  payload.dynamicBordersDirtyReason = String(payload.dynamicBordersDirtyReason || "");
  if (!payload.styleConfig || typeof payload.styleConfig !== "object") {
    payload.styleConfig = {};
  }
  if (payload.styleConfig.textureMode && !payload.styleConfig.texture) {
    payload.styleConfig.texture = { mode: payload.styleConfig.textureMode };
  }
  if (payload.styleConfig.texture && typeof payload.styleConfig.texture === "object") {
    payload.styleConfig.texture = {
      ...payload.styleConfig.texture,
      mode: normalizeTextureMode(payload.styleConfig.texture.mode),
    };
  }
  payload.styleConfig.physical = normalizePhysicalStyleConfig(payload.styleConfig.physical);
  return payload;
}

async function loadFeatureMigrationMap({ fetchImpl = globalThis.fetch } = {}) {
  if (featureMigrationMapPromise) {
    return featureMigrationMapPromise;
  }
  featureMigrationMapPromise = (async () => {
    if (typeof fetchImpl !== "function") {
      return {};
    }
    const merged = {};
    for (const url of FEATURE_MIGRATION_URLS) {
      try {
        const response = await fetchImpl(url, { cache: "no-store" });
        if (!response?.ok) {
          console.warn(`Unable to load feature migration asset: ${url} (${response?.status || "n/a"})`);
          continue;
        }
        const payload = await response.json();
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          continue;
        }
        Object.entries(payload).forEach(([legacyId, successorIds]) => {
          if (!legacyId || !Array.isArray(successorIds)) return;
          merged[String(legacyId).trim()] = successorIds
            .map((value) => String(value || "").trim())
            .filter(Boolean);
        });
      } catch (error) {
        console.warn(`Failed to load feature migration asset ${url}:`, error);
      }
    }
    return merged;
  })();
  return featureMigrationMapPromise;
}

function remapFeatureScopedEntries(entries, validFeatureIds, migrationMap) {
  const source = entries && typeof entries === "object" ? entries : {};
  const remapped = {};
  let droppedCount = 0;
  let migratedSourceCount = 0;
  let expandedEntryCount = 0;

  Object.entries(source).forEach(([featureId, value]) => {
    const id = String(featureId || "").trim();
    if (!id || !validFeatureIds.has(id)) return;
    remapped[id] = value;
  });

  Object.entries(source).forEach(([featureId, value]) => {
    const id = String(featureId || "").trim();
    if (!id || validFeatureIds.has(id)) return;
    const successorIds = Array.isArray(migrationMap?.[id]) ? migrationMap[id] : [];
    const validSuccessors = successorIds.filter((successorId) => validFeatureIds.has(successorId));
    if (!validSuccessors.length) {
      droppedCount += 1;
      return;
    }
    migratedSourceCount += 1;
    validSuccessors.forEach((successorId) => {
      if (successorId in remapped) return;
      remapped[successorId] = value;
      expandedEntryCount += 1;
    });
  });

  return {
    remapped,
    droppedCount,
    migratedSourceCount,
    expandedEntryCount,
  };
}

async function migrateFeatureScopedProjectDataToCurrentTopology(
  data,
  landData,
  { fetchImpl = globalThis.fetch } = {}
) {
  const payload = data && typeof data === "object" ? { ...data } : {};
  const features = Array.isArray(landData?.features) ? landData.features : [];
  if (!features.length) {
    return payload;
  }
  const validFeatureIds = new Set(features.map((feature) => getFeatureId(feature)).filter(Boolean));
  if (!validFeatureIds.size) {
    return payload;
  }

  const migrationMap = await loadFeatureMigrationMap({ fetchImpl });
  if (!migrationMap || typeof migrationMap !== "object") {
    return payload;
  }

  const sovereigntyMigration = remapFeatureScopedEntries(
    payload.sovereigntyByFeatureId,
    validFeatureIds,
    migrationMap
  );
  const visualMigration = remapFeatureScopedEntries(
    payload.visualOverrides || payload.featureOverrides,
    validFeatureIds,
    migrationMap
  );

  payload.sovereigntyByFeatureId = sovereigntyMigration.remapped;
  payload.visualOverrides = visualMigration.remapped;
  payload.featureOverrides = { ...visualMigration.remapped };

  const migratedTotal =
    sovereigntyMigration.migratedSourceCount + visualMigration.migratedSourceCount;
  const droppedTotal =
    sovereigntyMigration.droppedCount + visualMigration.droppedCount;
  if (migratedTotal || droppedTotal) {
    console.info(
      "[Project Import] Feature migration applied.",
      {
        migratedEntries: migratedTotal,
        droppedEntries: droppedTotal,
        sovereigntyExpanded: sovereigntyMigration.expandedEntryCount,
        visualExpanded: visualMigration.expandedEntryCount,
      }
    );
  }
  return payload;
}

export {
  normalizeOwnerCode,
  getCanonicalCountryCodeForFeature,
  getFeatureId,
  seedSovereigntyFromLandData,
  ensureSovereigntyState,
  rebuildOwnerIndex,
  getFeatureOwnerCode,
  setFeatureOwnerCode,
  setFeatureOwnerCodes,
  resetFeatureOwnerCode,
  resetFeatureOwnerCodes,
  resetAllFeatureOwnersToCanonical,
  getFeatureIdsForOwner,
  migrateLegacyColorState,
  migrateImportedProjectData,
  migrateFeatureScopedProjectDataToCurrentTopology,
};
