const BATHYMETRY_DEPTH_STOPS = [
  [0, 0], [50, 0.14], [100, 0.25], [200, 0.38], [500, 0.50],
  [1000, 0.61], [2000, 0.73], [4000, 0.89], [6000, 1],
];

export function depthToToneIndex(depth, scale = 1) {
  const bounded = Math.max(0, Math.min(6000, depth));
  const index = BATHYMETRY_DEPTH_STOPS.findIndex(([stop]) => stop >= bounded);
  const [endDepth, endTone] = BATHYMETRY_DEPTH_STOPS[index];
  const [startDepth, startTone] = BATHYMETRY_DEPTH_STOPS[Math.max(0, index - 1)];
  const tone = endDepth === startDepth ? endTone
    : startTone + (endTone - startTone) * (bounded - startDepth) / (endDepth - startDepth);
  return Math.round(255 * Math.max(0, Math.min(1, 0.5 + (tone - 0.5) * Math.max(0.6, Math.min(2.4, Number(scale) || 1)))));
}

export function buildBathymetryColorRamp({ baseRgb, preset, scale = 1, opacity }) {
  const luminance = (0.2126 * baseRgb.r + 0.7152 * baseRgb.g + 0.0722 * baseRgb.b) / 255;
  const mix = (a, b, t) => Math.round(a + (b - a) * t);
  const shallow = [225, 243, 250].map((v, i) => mix([baseRgb.r, baseRgb.g, baseRgb.b][i], v, luminance < 0.4 ? 0.42 : 0.36));
  const deep = [9, 37, 68].map((v, i) => mix([baseRgb.r, baseRgb.g, baseRgb.b][i], v, luminance < 0.4 ? 0.64 : 0.86));
  const ramp = new Uint8Array(1024);
  for (let i = 0; i < 256; i++) {
    for (let c = 0; c < 3; c++) ramp[i * 4 + c] = mix(shallow[c], deep[c], i / 255);
    ramp[i * 4 + 3] = 255;
  }
  // The renderer needs the tone scale, while the table itself is indexed by tone.
  ramp.scale = scale;
  return ramp;
}
