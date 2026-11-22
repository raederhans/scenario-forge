export function getScenarioRegion(manifestOrBundle) {
  const manifest = manifestOrBundle?.manifest ?? manifestOrBundle;
  const region = manifest?.region;
  const bounds = region?.bounds;
  if (!Array.isArray(bounds) || bounds.length !== 4) return null;
  const [west, south, east, north] = bounds;
  return Number.isFinite(west) && Number.isFinite(east)
    && Math.abs(west) <= 180 && Math.abs(east) <= 180 && west !== east
    && !(west === 180 && east === -180)
    && Number.isFinite(south) && Number.isFinite(north)
    && south >= -90 && north <= 90 && south < north ? region : null;
}

export function isRegionalScenario(manifestOrBundle) {
  return !!getScenarioRegion(manifestOrBundle);
}
