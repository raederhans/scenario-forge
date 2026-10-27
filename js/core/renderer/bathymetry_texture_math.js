const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796;
const M = Math.sqrt(3) / 2;
const RAD = Math.PI / 180;

export function decodeBathymetryDepth(v, encoding) {
  return v <= 1 ? 0 : encoding.max_depth_m * ((v - 1) / 254) ** 2;
}

export function encodeBathymetryDepth(depth, encoding) {
  return Math.round(1 + 254 * Math.sqrt(Math.max(0, Math.min(1, depth / encoding.max_depth_m))));
}

export function equalEarthRaw(lambda, phi) {
  const l = Math.asin(M * Math.sin(phi)), l2 = l * l, l6 = l2 * l2 * l2;
  return [lambda * Math.cos(l) / (M * (A1 + 3 * A2 * l2 + l6 * (7 * A3 + 9 * A4 * l2))),
    l * (A1 + A2 * l2 + l6 * (A3 + A4 * l2))];
}

export function equalEarthRawInvert(x, y) {
  let l = y, converged = false;
  for (let i = 0; i < 12; i++) {
    const l2 = l * l, l6 = l2 * l2 * l2;
    const delta = (l * (A1 + A2 * l2 + l6 * (A3 + A4 * l2)) - y)
      / (A1 + 3 * A2 * l2 + l6 * (7 * A3 + 9 * A4 * l2));
    l -= delta;
    if (Math.abs(delta) < 1e-12) { converged = true; break; }
  }
  if (!converged || Math.abs(l) > Math.PI / 3 + 1e-12) return null;
  const l2 = l * l, l6 = l2 * l2 * l2;
  const lambda = M * x * (A1 + 3 * A2 * l2 + l6 * (7 * A3 + 9 * A4 * l2)) / Math.cos(l);
  if (!Number.isFinite(lambda) || Math.abs(lambda) > Math.PI + 1e-12) return null;
  return [lambda, Math.asin(Math.max(-1, Math.min(1, Math.sin(l) / M)))];
}

export function createProjectionInverseParams(projection) {
  const rotation = projection.rotate();
  if (rotation[1] || rotation[2] || projection.angle?.() || projection.reflectX?.() || projection.reflectY?.()
    || projection.clipAngle?.() || projection.clipExtent?.()) return null;
  const scale = projection.scale(), translate = projection.translate(), center = projection.center();
  const origin = equalEarthRaw(center[0] * RAD, center[1] * RAD);
  const params = { scale, offsetX: translate[0] - scale * origin[0],
    offsetY: translate[1] + scale * origin[1], rotation: rotation[0] * RAD };
  // d3 projections expose no raw-projection identity; compare their observable mapping.
  for (const [lon, lat] of [[0, 0], [41, 23], [-73, -51], [120, 70]]) {
    const lambda = ((lon * RAD + params.rotation + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    const raw = equalEarthRaw(lambda, lat * RAD), actual = projection([lon, lat]);
    if (Math.abs(actual[0] - (params.offsetX + scale * raw[0])) > 1e-7
      || Math.abs(actual[1] - (params.offsetY - scale * raw[1])) > 1e-7) return null;
  }
  return params;
}

export function invertProjectedPoint(params, x, y) {
  const raw = equalEarthRawInvert((x - params.offsetX) / params.scale, (params.offsetY - y) / params.scale);
  if (!raw) return null;
  const lon = ((raw[0] - params.rotation + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  return [lon / RAD, raw[1] / RAD];
}
