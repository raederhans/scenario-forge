import { INTENSITY_FIELD_GRID, sampleIntensityField } from "../intensity_field.js";

// Bilinear interpolation can reach one cell beyond each non-neutral sample.
// Scan the live grid, not revision or point bounds: brush previews and imported
// base grids can change without a committed point/revision change.
export function getPhysicalIntensityBounds(values) {
  if (!values?.length) return null;
  const { columns, rows } = INTENSITY_FIELD_GRID;
  let minColumn = columns, maxColumn = -1, minRow = rows, maxRow = -1;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === 1) continue;
    const column = index % columns;
    const row = Math.floor(index / columns);
    minColumn = Math.min(minColumn, column); maxColumn = Math.max(maxColumn, column);
    minRow = Math.min(minRow, row); maxRow = Math.max(maxRow, row);
  }
  if (maxColumn < 0) return null;
  return [
    // Column zero also affects interpolation across +180. Keep the full
    // longitude band in this case rather than culling its wrapped footprint.
    minColumn === 0 ? -Infinity : -180 + (minColumn - 1) * 360 / columns,
    maxRow === rows - 1 ? -Infinity : 90 - (maxRow + 1) * 180 / rows,
    minColumn === 0 ? Infinity : -180 + (maxColumn + 1) * 360 / columns,
    minRow === 0 ? Infinity : 90 - (minRow - 1) * 180 / rows,
  ];
}

// Only alpha is modulated. A neutral field is byte-for-byte unchanged, zero
// removes the layer locally, and two doubles opacity up to the canvas limit.
export function multiplyPhysicalAlpha(image, { projection, matrix, sample, coordinates = null, bounds = null }) {
  const { a, b, c, d, e, f } = matrix;
  const determinant = a * d - b * c;
  if (!determinant || typeof projection?.invert !== "function") return [];
  const pixels = image.data;
  const runs = [];
  for (let index = 0; index < image.width * image.height; index += 1) {
    const alphaIndex = index * 4 + 3;
    if (!pixels[alphaIndex]) continue;
    const cacheIndex = index * 2;
    let lon = coordinates?.[cacheIndex];
    let lat = coordinates?.[cacheIndex + 1];
    if (lon === undefined || lon === Infinity) {
      const x = index % image.width + 0.5 - e;
      const y = Math.floor(index / image.width) + 0.5 - f;
      const position = projection.invert([(d * x - c * y) / determinant, (a * y - b * x) / determinant]);
      lon = Number(position?.[0]);
      lat = Number(position?.[1]);
      if (coordinates) {
        coordinates[cacheIndex] = lon;
        coordinates[cacheIndex + 1] = lat;
      }
    }
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (bounds && (lon < bounds[0] || lat < bounds[1] || lon > bounds[2] || lat > bounds[3])) continue;
    const multiplier = Math.max(0, Math.min(2, sample(lon, lat)));
    if (multiplier === 1) continue;
    pixels[alphaIndex] = Math.round(Math.min(255, pixels[alphaIndex] * multiplier));
    const x = index % image.width;
    const y = Math.floor(index / image.width);
    const previous = runs.at(-1);
    if (previous && previous[1] === y && previous[0] + previous[2] === x) previous[2] += 1;
    else runs.push([x, y, 1]);
  }
  return runs;
}

export function createPhysicalIntensityCompositor({ state, getContext, getProjection, getProjectionKey, withRenderTarget, createCanvas = () => document.createElement("canvas") }) {
  let canvas = null;
  let coordinateKey = "";
  let coordinates = null;
  return function paintWithPhysicalIntensity(channelId, blendMode, draw) {
    const channel = state.intensityFields?.channels?.[channelId];
    // Do not cache by revision: brush drags update the composite before commit.
    if (!channel?.enabled) return draw(blendMode);
    const bounds = getPhysicalIntensityBounds(channel.grid?.composite);
    if (!bounds) return draw(blendMode);
    const target = getContext();
    const projection = getProjection();
    if (!target?.canvas || typeof projection?.invert !== "function") return draw(blendMode);
    canvas ||= createCanvas();
    const { width, height } = target.canvas;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const scratch = canvas.getContext("2d", { willReadFrequently: true });
    const matrix = target.getTransform();
    scratch.resetTransform();
    scratch.clearRect(0, 0, width, height);
    scratch.setTransform(matrix);
    const result = withRenderTarget(scratch, () => draw("source-over"));
    const key = [width, height, matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f, getProjectionKey()].join("|");
    if (key !== coordinateKey) {
      coordinateKey = key;
      // Bound retained inverse-projection storage to 16 MB. Large exports
      // still sample every output pixel, without keeping a second large cache.
      coordinates = width * height <= 2_000_000 ? new Float32Array(width * height * 2).fill(Infinity) : null;
    }
    const image = scratch.getImageData(0, 0, width, height);
    const runs = multiplyPhysicalAlpha(image, { projection, matrix, coordinates, bounds,
      sample: (lon, lat) => sampleIntensityField(state.intensityFields, channelId, lon, lat) });
    // Render untouched pixels directly, preserving the native per-feature blend
    // and avoiding an RGBA readback round-trip outside the edited footprint.
    target.save();
    target.resetTransform();
    target.beginPath(); target.rect(0, 0, width, height);
    for (const [x, y, length] of runs) target.rect(x, y, length, 1);
    target.clip("evenodd");
    target.setTransform(matrix);
    draw(blendMode);
    target.restore();
    if (!runs.length) {
      if (width * height > 2_000_000) { canvas.width = 1; canvas.height = 1; }
      return result;
    }
    scratch.putImageData(image, 0, 0);
    target.save();
    target.resetTransform();
    target.beginPath();
    for (const [x, y, length] of runs) target.rect(x, y, length, 1);
    target.clip();
    target.globalAlpha = 1;
    target.globalCompositeOperation = blendMode;
    target.drawImage(canvas, 0, 0);
    target.restore();
    if (width * height > 2_000_000) { canvas.width = 1; canvas.height = 1; }
    return result;
  };
}
