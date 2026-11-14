export const STRATEGIC_RESOURCE_IDS = Object.freeze([
  "steel",
  "oil",
  "aluminium",
  "rubber",
  "tungsten",
  "chromium",
  "coal",
]);

export const STRATEGIC_RESOURCE_TIER_MIN_ZOOM = Object.freeze({
  1: 3.5,
  2: 2,
  3: 1,
});

const RESOURCE_SET = new Set(STRATEGIC_RESOURCE_IDS);

function toFiniteNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function normalizeResourceId(value) {
  return String(value || "").trim().toLowerCase();
}

function getFeatureCollection(input) {
  if (input?.type === "FeatureCollection" && Array.isArray(input.features)) {
    return input;
  }
  if (input?.resourcePoints?.type === "FeatureCollection" && Array.isArray(input.resourcePoints.features)) {
    return input.resourcePoints;
  }
  if (input?.resource_points?.type === "FeatureCollection" && Array.isArray(input.resource_points.features)) {
    return input.resource_points;
  }
  return { type: "FeatureCollection", features: [] };
}

function getCoordinates(feature) {
  const coordinates = feature?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const lon = toFiniteNumber(coordinates[0], NaN);
  const lat = toFiniteNumber(coordinates[1], NaN);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return [lon, lat];
}

function normalizeTier(value) {
  const tier = Math.round(toFiniteNumber(value, 1));
  return Math.min(3, Math.max(1, tier));
}

function normalizeMinTier(value) {
  const tier = Math.round(toFiniteNumber(value, 1));
  return Math.max(1, tier);
}

function normalizeResourceFilter(resources) {
  if (!Array.isArray(resources) || resources.length === 0) return null;
  return new Set(resources.map(normalizeResourceId).filter((resourceId) => RESOURCE_SET.has(resourceId)));
}

export function shouldRenderStrategicResourceMarker(feature, options = {}) {
  const {
    showResourceMarkers = true,
    zoom = 1,
    minTier = 1,
    minAmount = 0,
    resources = null,
    tierMinZoom = STRATEGIC_RESOURCE_TIER_MIN_ZOOM,
  } = options;
  if (!showResourceMarkers) return false;
  const properties = feature?.properties || {};
  const resource = normalizeResourceId(properties.resource);
  if (!RESOURCE_SET.has(resource)) return false;
  const resourceFilter = normalizeResourceFilter(resources);
  if (resourceFilter && !resourceFilter.has(resource)) return false;
  const amount = toFiniteNumber(properties.amount, 0);
  if (amount <= 0 || amount < toFiniteNumber(minAmount, 0)) return false;
  const tier = normalizeTier(properties.tier);
  const requiredTier = normalizeMinTier(minTier);
  if (requiredTier > 3 || tier < requiredTier) return false;
  const currentZoom = toFiniteNumber(zoom, 1);
  const requiredZoom = toFiniteNumber(tierMinZoom?.[tier], 1);
  if (currentZoom < requiredZoom) return false;
  return !!getCoordinates(feature);
}

export function buildStrategicResourceMarkerEntries(input, options = {}) {
  const collection = getFeatureCollection(input);
  return collection.features
    .filter((feature) => shouldRenderStrategicResourceMarker(feature, options))
    .map((feature, index) => {
      const properties = feature.properties || {};
      const coordinates = getCoordinates(feature);
      const resource = normalizeResourceId(properties.resource);
      const amount = toFiniteNumber(properties.amount, 0);
      const tier = normalizeTier(properties.tier);
      const stateId = properties.state_id ?? properties.stateId ?? "";
      const markerId = String(
        properties.id
        || properties.marker_id
        || `${resource}:${stateId || "state"}:${coordinates[0]}:${coordinates[1]}:${index}`,
      );
      return {
        id: markerId,
        resource,
        amount,
        tier,
        lon: coordinates[0],
        lat: coordinates[1],
        ownerTag: String(properties.owner_tag || properties.ownerTag || "").trim(),
        stateId,
        anchorKind: String(properties.anchor_kind || properties.anchorKind || "").trim(),
        radiusPx: 3 + (tier * 1.6),
      };
    })
    .sort((left, right) => {
      if (right.tier !== left.tier) return right.tier - left.tier;
      if (right.amount !== left.amount) return right.amount - left.amount;
      return left.id.localeCompare(right.id);
    });
}
