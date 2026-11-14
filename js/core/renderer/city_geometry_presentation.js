import { formatCityVictoryPoints } from "./modern_place_name.js";

export function createCityGeometryPresentation({
  state,
  surfaceHost,
  getCityDisplayLabel,
  getDisplayOwnerCode,
  getLocalizedScenarioCountryName,
  getFeatureGeoCentroid,
  normalizeLongitude,
  clamp,
  t,
  renderTooltipText,
}) {
  let cityAnchorCache = new WeakMap();

  function resetCityAnchorCache() {
    cityAnchorCache = new WeakMap();
  }

  function getCityAnchor(feature) {
    if (!feature || !surfaceHost.getProjection()) return null;
    const cached = cityAnchorCache.get(feature);
    if (cached !== undefined) {
      return cached;
    }

    let anchor = null;
    const geometry = feature.geometry;
    if (geometry?.type === "Point" && Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2) {
      const projected = surfaceHost.getProjection()(geometry.coordinates);
      if (Array.isArray(projected) && projected.every((value) => Number.isFinite(Number(value)))) {
        anchor = projected;
      }
    } else if (geometry?.type === "MultiPoint" && Array.isArray(geometry.coordinates) && geometry.coordinates.length) {
      const projectedPoints = geometry.coordinates
        .map((coords) => surfaceHost.getProjection()(coords))
        .filter((point) => Array.isArray(point) && point.every((value) => Number.isFinite(Number(value))));
      if (projectedPoints.length) {
        const [sumX, sumY] = projectedPoints.reduce(
          (acc, point) => [acc[0] + Number(point[0]), acc[1] + Number(point[1])],
          [0, 0]
        );
        anchor = [sumX / projectedPoints.length, sumY / projectedPoints.length];
      }
    }

    if (!anchor && surfaceHost.getPathCanvas()?.centroid) {
      const centroid = surfaceHost.getPathCanvas().centroid(feature);
      if (Array.isArray(centroid) && centroid.every((value) => Number.isFinite(Number(value)))) {
        anchor = centroid;
      }
    }

    if (!anchor && globalThis.d3?.geoCentroid) {
      const geoCentroid = globalThis.d3.geoCentroid(feature);
      const projected = Array.isArray(geoCentroid) ? surfaceHost.getProjection()(geoCentroid) : null;
      if (Array.isArray(projected) && projected.every((value) => Number.isFinite(Number(value)))) {
        anchor = projected;
      }
    }

    cityAnchorCache.set(feature, anchor);
    return anchor;
  }

  function getCityScreenPoint(anchor, transform = state.zoomTransform || globalThis.d3?.zoomIdentity) {
    if (!Array.isArray(anchor) || anchor.length < 2) return null;
    const scale = Math.max(0.0001, Number(transform?.k || 1));
    const x = Number(anchor[0]);
    const y = Number(anchor[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return [
      (x * scale) + Number(transform?.x || 0),
      (y * scale) + Number(transform?.y || 0),
    ];
  }

  function getCityGeoCoordinates(feature) {
    const geometry = feature?.geometry;
    if (geometry?.type === "Point" && Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2) {
      const lon = Number(geometry.coordinates[0]);
      const lat = Number(geometry.coordinates[1]);
      if (Number.isFinite(lon) && Number.isFinite(lat)) {
        return [normalizeLongitude(lon), clamp(lat, -89.999, 89.999)];
      }
    }
    if (geometry?.type === "MultiPoint" && Array.isArray(geometry.coordinates) && geometry.coordinates.length) {
      const points = geometry.coordinates
        .map((coords) => [Number(coords?.[0]), Number(coords?.[1])])
        .filter((coords) => coords.every((value) => Number.isFinite(value)));
      if (points.length) {
        const sums = points.reduce((acc, coords) => [acc[0] + coords[0], acc[1] + coords[1]], [0, 0]);
        return [
          normalizeLongitude(sums[0] / points.length),
          clamp(sums[1] / points.length, -89.999, 89.999),
        ];
      }
    }
    return getFeatureGeoCentroid(feature);
  }

  function isCityAnchorInViewport(anchor, { padding = 24, transform = state.zoomTransform || globalThis.d3?.zoomIdentity } = {}) {
    const screenPoint = getCityScreenPoint(anchor, transform);
    if (!screenPoint) return false;
    return (
      screenPoint[0] >= -padding
      && screenPoint[0] <= state.width + padding
      && screenPoint[1] >= -padding
      && screenPoint[1] <= state.height + padding
    );
  }

  function getCityCapitalDescriptor(entry) {
    if (entry?.feature?.properties?.__city_is_country_capital) {
      return state.currentLanguage === "zh" ? "\u9996\u90fd" : "Capital";
    }
    if (entry?.feature?.properties?.__city_is_admin_capital) {
      return state.currentLanguage === "zh" ? "\u884c\u653f\u4e2d\u5fc3" : "Administrative capital";
    }
    return "";
  }

  function getCityTooltipText(entry) {
    const fullLabel = getCityDisplayLabel(entry?.feature);
    const props = entry?.feature?.properties || {};
    const hostFeatureId = String(props.__city_host_feature_id || "").trim();
    const hostFeature = hostFeatureId ? state.landIndex?.get(hostFeatureId) : null;
    const countryCode = String(
      (hostFeature ? getDisplayOwnerCode(hostFeature, hostFeatureId) : "")
        || props.__city_scenario_tag
        || props.__city_country_code
        || props.country_code
        || ""
    ).trim().toUpperCase();
    const countryDisplayName = getLocalizedScenarioCountryName(
      state.scenarioCountriesByTag?.[countryCode],
      state.countryNames?.[countryCode] || countryCode,
      (name) => t(name, "geo"),
    );
    const lines = [fullLabel];
    const victoryPoints = formatCityVictoryPoints(
      props.__city_scenario_victory_points,
      props.__city_scenario_vp_name,
      getCityDisplayLabel(entry?.feature, { showModernPlaceNames: false }),
      state.currentLanguage,
    );
    if (victoryPoints) lines.push(victoryPoints);
    const capitalDescriptor = getCityCapitalDescriptor(entry);
    if (capitalDescriptor) {
      lines.push(capitalDescriptor);
    }
    if (countryDisplayName) {
      lines.push(countryCode ? `${countryDisplayName} (${countryCode})` : countryDisplayName);
    }
    return renderTooltipText({ lines: lines.filter(Boolean) });
  }

  return {
    resetCityAnchorCache,
    getCityAnchor,
    getCityScreenPoint,
    getCityGeoCoordinates,
    isCityAnchorInViewport,
    getCityCapitalDescriptor,
    getCityTooltipText,
  };
}
