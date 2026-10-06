// Draw the projected world silhouette once, with a screen-scaled frame.
export function drawWorldFrame(surface, state, oceanFillColor) {
  const context = surface.getContext();
  const k = Math.max(0.0001, Number(state.zoomTransform?.k) || 1);
  const dpr = Math.max(0.1, Number(state.dpr) || 1);
  context.save();
  try {
    // Canvas shadows use backing pixels, while strokes use projected units.
    // Keep both quiet at every zoom and when export temporarily raises DPR.
    context.shadowColor = "rgba(2, 8, 16, 0.38)";
    context.shadowBlur = 12 * dpr;
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 3 * dpr;
    surface.getContext().fillStyle = oceanFillColor;
    surface.getContext().beginPath();
    surface.getPathCanvas()({ type: "Sphere" });
    surface.getContext().fill();
    context.shadowColor = "transparent";
    context.shadowBlur = 0;
    context.shadowOffsetY = 0;
    context.strokeStyle = "rgba(181, 206, 218, 0.46)";
    context.lineWidth = 0.9 / k;
    context.lineJoin = "round";
    context.stroke();
  } finally {
    context.restore();
  }
}
