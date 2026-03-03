import { normalizeTextureMode, state } from "./state.js";

const COUNTRY_CODE_ALIASES = {
  UK: "GB",
  EL: "GR",
};

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
};
