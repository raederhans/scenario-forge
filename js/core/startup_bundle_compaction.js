function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeUpperText(value) {
  return normalizeText(value).toUpperCase();
}

function clonePlainObject(value, fallback) {
  if (value === null || value === undefined) {
    return fallback;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return fallback;
  }
}

export const STARTUP_RUNTIME_POLITICAL_META_ENCODING = "feature-index-v1";
export const STARTUP_FEATURE_ORDER_ASSIGNMENT_ENCODING = "runtime-feature-index-v1";

export function normalizeRuntimePoliticalMeta(featureMeta) {
  if (!featureMeta || typeof featureMeta !== "object") {
    return null;
  }
  const featureIds = Array.isArray(featureMeta.featureIds)
    ? featureMeta.featureIds.map((featureId) => normalizeText(featureId)).filter(Boolean)
    : [];
  const featureIndexById = {};
  featureIds.forEach((featureId, index) => {
    featureIndexById[featureId] = index;
  });
  const canonicalCountryByFeatureId = {};
  const compactCanonicalCountries = Array.isArray(featureMeta.canonicalCountryByIndex)
    ? featureMeta.canonicalCountryByIndex
    : null;
  if (compactCanonicalCountries) {
    featureIds.forEach((featureId, index) => {
      canonicalCountryByFeatureId[featureId] = normalizeUpperText(compactCanonicalCountries[index]);
    });
  } else if (featureMeta.canonicalCountryByFeatureId && typeof featureMeta.canonicalCountryByFeatureId === "object") {
    Object.entries(featureMeta.canonicalCountryByFeatureId).forEach(([featureId, countryCode]) => {
      const normalizedFeatureId = normalizeText(featureId);
      if (!normalizedFeatureId) return;
      canonicalCountryByFeatureId[normalizedFeatureId] = normalizeUpperText(countryCode);
      if (!(normalizedFeatureId in featureIndexById)) {
        featureIndexById[normalizedFeatureId] = featureIds.length;
        featureIds.push(normalizedFeatureId);
      }
    });
  }
  return {
    encoding: normalizeText(featureMeta.encoding),
    featureIds,
    featureIndexById:
      featureMeta.featureIndexById && typeof featureMeta.featureIndexById === "object"
        ? { ...featureIndexById, ...featureMeta.featureIndexById }
        : featureIndexById,
    canonicalCountryByFeatureId,
    neighborGraph: Array.isArray(featureMeta.neighborGraph) ? [...featureMeta.neighborGraph] : [],
  };
}

export function compactRuntimePoliticalMeta(featureMeta) {
  const normalized = normalizeRuntimePoliticalMeta(featureMeta);
  if (!normalized || !normalized.featureIds.length) {
    return clonePlainObject(featureMeta, null);
  }
  return {
    encoding: STARTUP_RUNTIME_POLITICAL_META_ENCODING,
    featureIds: normalized.featureIds.slice(),
    canonicalCountryByIndex: normalized.featureIds.map(
      (featureId) => normalizeUpperText(normalized.canonicalCountryByFeatureId?.[featureId])
    ),
    neighborGraph: Array.isArray(normalized.neighborGraph) ? [...normalized.neighborGraph] : [],
  };
}

function buildFeatureIndexById(featureIds = []) {
  const indexById = new Map();
  featureIds.forEach((featureId, index) => {
    const normalizedFeatureId = normalizeText(featureId);
    if (!normalizedFeatureId || indexById.has(normalizedFeatureId)) return;
    indexById.set(normalizedFeatureId, index);
  });
  return indexById;
}

export function normalizeIndexedTagAssignmentPayload(payload, featureIds = [], mapKey = "owners") {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const directMap = payload?.[mapKey];
  if (directMap && typeof directMap === "object" && !Array.isArray(directMap)) {
    return {
      ...payload,
      [mapKey]: { ...directMap },
    };
  }
  if (normalizeText(payload.encoding) !== STARTUP_FEATURE_ORDER_ASSIGNMENT_ENCODING || !Array.isArray(payload.values)) {
    return clonePlainObject(payload, null);
  }
  const map = {};
  featureIds.forEach((featureId, index) => {
    const tag = normalizeUpperText(payload.values[index]);
    if (featureId && tag) {
      map[featureId] = tag;
    }
  });
  const normalizedPayload = { ...payload, [mapKey]: map };
  delete normalizedPayload.values;
  return normalizedPayload;
}

export function compactIndexedTagAssignmentPayload(payload, featureIds = [], mapKey = "owners") {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const directMap = payload?.[mapKey];
  if (!directMap || typeof directMap !== "object" || Array.isArray(directMap)) {
    return clonePlainObject(payload, null);
  }
  const featureIndexById = buildFeatureIndexById(featureIds);
  const values = new Array(featureIds.length).fill("");
  for (const [featureId, rawValue] of Object.entries(directMap)) {
    const index = featureIndexById.get(normalizeText(featureId));
    if (index === undefined) {
      return clonePlainObject(payload, null);
    }
    values[index] = normalizeUpperText(rawValue);
  }
  const compactPayload = {
    encoding: STARTUP_FEATURE_ORDER_ASSIGNMENT_ENCODING,
    values,
  };
  if ("baseline_hash" in payload) {
    compactPayload.baseline_hash = payload.baseline_hash;
  }
  if ("owner_baseline_hash" in payload) {
    compactPayload.owner_baseline_hash = payload.owner_baseline_hash;
  }
  return compactPayload;
}

function normalizeCoreTagList(rawValue) {
  if (!Array.isArray(rawValue)) {
    return [];
  }
  return rawValue
    .map((entry) => normalizeUpperText(entry))
    .filter(Boolean);
}

export function normalizeIndexedCoreAssignmentPayload(payload, featureIds = []) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const directMap = payload?.cores;
  if (directMap && typeof directMap === "object" && !Array.isArray(directMap)) {
    return {
      ...payload,
      cores: clonePlainObject(directMap, {}),
    };
  }
  if (normalizeText(payload.encoding) !== STARTUP_FEATURE_ORDER_ASSIGNMENT_ENCODING || !Array.isArray(payload.values)) {
    return clonePlainObject(payload, null);
  }
  const cores = {};
  featureIds.forEach((featureId, index) => {
    const normalized = normalizeCoreTagList(payload.values[index]);
    if (featureId && normalized.length) {
      cores[featureId] = normalized;
    }
  });
  const normalizedPayload = { ...payload, cores };
  delete normalizedPayload.values;
  return normalizedPayload;
}

export function compactIndexedCoreAssignmentPayload(payload, featureIds = []) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const directMap = payload?.cores;
  if (!directMap || typeof directMap !== "object" || Array.isArray(directMap)) {
    return clonePlainObject(payload, null);
  }
  const featureIndexById = buildFeatureIndexById(featureIds);
  const values = new Array(featureIds.length).fill(null).map(() => []);
  for (const [featureId, rawValues] of Object.entries(directMap)) {
    const index = featureIndexById.get(normalizeText(featureId));
    if (index === undefined) {
      return clonePlainObject(payload, null);
    }
    values[index] = normalizeCoreTagList(rawValues);
  }
  const compactPayload = {
    encoding: STARTUP_FEATURE_ORDER_ASSIGNMENT_ENCODING,
    values,
  };
  if ("baseline_hash" in payload) {
    compactPayload.baseline_hash = payload.baseline_hash;
  }
  return compactPayload;
}
