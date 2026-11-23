export function isValidScenarioBounds(bounds, allowWrap = false) {
  if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite)) return false;
  const [west, south, east, north] = bounds;
  return Math.abs(west) <= 180 && Math.abs(east) <= 180
    && (west < east || (allowWrap && west > east && west - east < 360))
    && south >= -90 && north <= 90 && south < north;
}

export function getScenarioRegion(manifestOrBundle) {
  const manifest = manifestOrBundle?.manifest ?? manifestOrBundle;
  const region = manifest?.region;
  return isValidScenarioBounds(region?.bounds, true) ? region : null;
}

export function isRegionalScenario(manifestOrBundle) {
  return !!getScenarioRegion(manifestOrBundle);
}

export function hidesRegionalBackdrop(manifest) {
  return getScenarioRegion(manifest)?.backdrop === "none";
}
