import { normalizeCountryCodeAlias } from "./country_code_aliases.js";
import { getCountryCode as getSharedFeatureCountryCode } from "./feature_identity.js";

function normalizeGeoCountryCode(rawValue) {
  const normalized = normalizeCountryCodeAlias(rawValue);
  return /^[A-Z]{2,3}$/.test(normalized) ? normalized : "";
}

function extractCountryCodeFromFeatureId(rawValue) {
  const text = String(rawValue || "").trim().toUpperCase();
  if (!text) return "";
  const match = text.match(/^([A-Z]{2,3})(?:[_-]|$)/);
  return normalizeGeoCountryCode(match?.[1] || "");
}

function resolveFeatureGeoCountryCode(feature) {
  return normalizeGeoCountryCode(getSharedFeatureCountryCode(feature));
}

function normalizeScenarioDistrictTag(rawValue) {
  const normalized = String(rawValue || "").trim().toUpperCase();
  return /^[A-Z]{2,4}$/.test(normalized) ? normalized : "";
}

function normalizeFeatureIdList(values = []) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )).sort((left, right) => left.localeCompare(right));
}

function normalizeDistrictRecord(rawDistrict = {}, fallbackId = "") {
  const id = String(rawDistrict?.id || rawDistrict?.district_id || fallbackId || "").trim();
  if (!id) return null;
  return {
    id,
    name_en: String(rawDistrict?.name_en || rawDistrict?.nameEn || "").trim(),
    name_zh: String(rawDistrict?.name_zh || rawDistrict?.nameZh || "").trim(),
    feature_ids: normalizeFeatureIdList(rawDistrict?.feature_ids || rawDistrict?.featureIds || []),
  };
}

function normalizeTagDistrictRecord(rawTag = {}, fallbackTag = "") {
  const tag = normalizeScenarioDistrictTag(rawTag?.tag || rawTag?.owner_tag || rawTag?.ownerTag || fallbackTag);
  if (!tag) return null;
  const districts = {};
  Object.entries(rawTag?.districts && typeof rawTag.districts === "object" ? rawTag.districts : {})
    .forEach(([districtId, rawDistrict]) => {
      const normalized = normalizeDistrictRecord(rawDistrict, districtId);
      if (!normalized) return;
      districts[normalized.id] = normalized;
    });
  return {
    tag,
    districts,
  };
}

function normalizeLegacyCountryDistrictRecord(rawCountry = {}, fallbackCode = "") {
  const countryCode = normalizeGeoCountryCode(rawCountry?.country_code || rawCountry?.countryCode || fallbackCode);
  if (!countryCode) return null;
  const districts = {};
  Object.entries(rawCountry?.districts && typeof rawCountry.districts === "object" ? rawCountry.districts : {})
    .forEach(([districtId, rawDistrict]) => {
      const normalized = normalizeDistrictRecord(rawDistrict, districtId);
      if (!normalized) return;
      districts[normalized.id] = normalized;
    });
  return {
    country_code: countryCode,
    districts,
  };
}

function createEmptyScenarioDistrictGroupsPayload(scenarioId = "") {
  return {
    version: 1,
    scenario_id: String(scenarioId || "").trim(),
    generated_at: "",
    tags: {},
    legacy_countries: {},
    has_legacy_geo_countries: false,
  };
}

function normalizeScenarioDistrictGroupsPayload(payload, scenarioId = "") {
  const normalized = createEmptyScenarioDistrictGroupsPayload(
    payload?.scenario_id || scenarioId || ""
  );
  if (!payload || typeof payload !== "object") {
    return normalized;
  }
  normalized.version = Number(payload.version || 1) || 1;
  normalized.generated_at = String(payload.generated_at || payload.generatedAt || "").trim();
  Object.entries(payload.tags && typeof payload.tags === "object" ? payload.tags : {})
    .forEach(([tag, rawTag]) => {
      const record = normalizeTagDistrictRecord(rawTag, tag);
      if (!record) return;
      normalized.tags[record.tag] = record;
    });
  Object.entries({
    ...(payload.countries && typeof payload.countries === "object" ? payload.countries : {}),
    ...(payload.legacy_countries && typeof payload.legacy_countries === "object" ? payload.legacy_countries : {}),
  })
    .forEach(([countryCode, rawCountry]) => {
      const record = normalizeLegacyCountryDistrictRecord(rawCountry, countryCode);
      if (!record) return;
      normalized.legacy_countries[record.country_code] = record;
    });
  normalized.has_legacy_geo_countries = Object.keys(normalized.legacy_countries).length > 0;
  return normalized;
}

function getScenarioDistrictTagRecord(payload, tag = "") {
  const normalizedTag = normalizeScenarioDistrictTag(tag);
  if (!normalizedTag) return null;
  const normalizedPayload = normalizeScenarioDistrictGroupsPayload(payload);
  return normalizedPayload.tags[normalizedTag] || null;
}

function buildScenarioDistrictGroupByFeatureId(payload) {
  const featureToGroup = new Map();
  const normalizedPayload = normalizeScenarioDistrictGroupsPayload(payload);
  Object.values(normalizedPayload.tags || {}).forEach((tagRecord) => {
    Object.values(tagRecord?.districts || {}).forEach((district) => {
      const districtId = String(district?.id || "").trim();
      if (!districtId) return;
      normalizeFeatureIdList(district?.feature_ids || []).forEach((featureId) => {
        if (!featureToGroup.has(featureId)) {
          featureToGroup.set(featureId, districtId);
        }
      });
    });
  });
  return featureToGroup;
}

export {
  buildScenarioDistrictGroupByFeatureId,
  createEmptyScenarioDistrictGroupsPayload,
  getScenarioDistrictTagRecord,
  normalizeGeoCountryCode,
  normalizeScenarioDistrictGroupsPayload,
  normalizeScenarioDistrictTag,
  resolveFeatureGeoCountryCode,
};

// Shared normalized adapter for border presentation. Paint uses the same records,
// but does not inherit the border renderer's coverage/display acceptance thresholds.
export function getScenarioDistrictCountryGrouping(payload, countryCode, featureEntries, owners = {}) {
  if (!payload || typeof payload !== "object") return null;
  const normalized = normalizeScenarioDistrictGroupsPayload(payload);
  const country = normalizeGeoCountryCode(countryCode);
  const ids = new Set(featureEntries.map((entry) => entry.id));
  const groups = new Map();
  const conflicts = new Set();
  let declared = false;
  const add = (id, key) => {
    if (groups.has(id) && groups.get(id) !== key) conflicts.add(id);
    else groups.set(id, key);
  };
  for (const [tag, record] of Object.entries(normalized.tags)) {
    if (featureEntries.some(({ id }) => String(owners[id] || "").trim().toUpperCase() === tag)) declared = true;
    for (const [districtId, district] of Object.entries(record.districts)) {
      for (const id of district.feature_ids) {
        if (!ids.has(id)) continue;
        const currentOwner = String(owners[id] || "").trim().toUpperCase();
        if (currentOwner && currentOwner !== tag) continue;
        declared = true;
        add(id, `${tag}::${districtId}`);
      }
    }
  }
  const legacy = normalized.legacy_countries[country];
  if (legacy) {
    declared = true;
    for (const [districtId, district] of Object.entries(legacy.districts)) {
      for (const id of district.feature_ids) {
        const currentOwner = String(owners[id] || "").trim().toUpperCase();
        if (ids.has(id) && !normalized.tags[currentOwner]) add(id, districtId);
      }
    }
  }
  for (const id of conflicts) groups.delete(id);
  return declared ? groups : null;
}
