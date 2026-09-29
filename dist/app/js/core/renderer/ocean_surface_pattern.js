// Reuse the composed ocean surface inside marine polygons that must cover
// political fills. Pattern coordinates stay in projection space, including
// overscan, zoom and export pixel density; lakes and explicit paint stay solid.
export function createOceanSurfacePattern(context, canvas, layout, transform) {
  if (!context || !canvas || !layout || !transform) return null;
  const k = Number(transform.k);
  const dpr = Number(layout.dpr);
  if (!(k > 0) || !(dpr > 0)) return null;
  const pattern = context.createPattern(canvas, "no-repeat");
  if (!pattern) return null;
  pattern.setTransform({
    a: 1 / (dpr * k), b: 0, c: 0, d: 1 / (dpr * k),
    e: -(Number(transform.x || 0) + Number(layout.offsetX || 0)) / k,
    f: -(Number(transform.y || 0) + Number(layout.offsetY || 0)) / k,
  });
  return pattern;
}
