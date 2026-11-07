export function buildScenarioProjectMarkerEntries(manifest, state, projection, transform) {
  if (state.activeScenarioId !== "tno_1962" || !state.showScenarioAtlantropa || !projection) return [];
  return (manifest?.project_markers || []).map((marker) => {
    const coordinates = [marker.lon, marker.lat];
    const projectedPoint = projection(coordinates);
    return {
      familyId: "project",
      packId: "tno_1962",
      stableId: marker.id,
      properties: marker,
      coordinates,
      projectedPoint,
      screenPoint: transform.apply(projectedPoint),
      markerRadiusPx: 5,
      hoverRadiusPx: 10,
    };
  });
}

export function drawScenarioProjectMarkers(context, entries, scale) {
  context.save();
  context.fillStyle = "#d8c9a3";
  context.strokeStyle = "#443e32";
  context.lineWidth = 1.4 / scale;
  for (const entry of entries) {
    const [x, y] = entry.projectedPoint;
    const r = entry.markerRadiusPx / scale;
    context.beginPath();
    context.moveTo(x, y - r);
    context.lineTo(x + r, y);
    context.lineTo(x, y + r);
    context.lineTo(x - r, y);
    context.closePath();
    context.fill();
    context.stroke();
    context.beginPath();
    context.moveTo(x - r / 2, y);
    context.lineTo(x + r / 2, y);
    context.stroke();
  }
  context.restore();
}
