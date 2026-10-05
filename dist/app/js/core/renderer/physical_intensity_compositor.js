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

// Equal Earth's unrotated inverse latitude depends only on the screen row. Keep
// the full longitude span (including the date line); other orientations and
// non-axis-aligned canvas transforms must use the full sampling path.
// The caller supplies this only for the renderer's known Equal Earth projection.
export function getEqualEarthIntensityRowBounds({ projection, matrix, bounds, height }) {
  const rotation = projection.rotate?.();
  if (!rotation || rotation[1] !== 0 || rotation[2] !== 0
    || projection.angle?.() !== 0 || matrix.b !== 0 || matrix.c !== 0
    || !Number.isFinite(bounds[1]) || !Number.isFinite(bounds[3])) return null;
  const { a, d, e, f } = matrix;
  const determinant = a * d;
  if (!determinant || ![a, d, e, f, determinant].every(Number.isFinite)) return null;
  let first = height, last = 0;
  for (let row = 0; row < height; row += 1) {
    const lat = Number(projection.invert([(d * (0.5 - e)) / determinant, (a * (row + 0.5 - f)) / determinant])?.[1]);
    if (!Number.isFinite(lat)) continue;
    if (lat >= bounds[1] && lat <= bounds[3]) {
      first = Math.min(first, row);
      last = row + 1;
    }
  }
  // Use the actual inverse, including its behavior beyond the sphere. Pixel
  // sampling and the coordinate cache both retain these double-precision values.
  return last ? [first, last] : [0, 0];
}

// Only alpha is modulated. A neutral field is byte-for-byte unchanged, zero
// removes the layer locally, and two doubles opacity up to the canvas limit.
export function multiplyPhysicalAlpha(image, { projection, matrix, sample, coordinates = null, bounds = null, offsetY = 0 }) {
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
      const y = Math.floor(index / image.width) + offsetY + 0.5 - f;
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
    const y = Math.floor(index / image.width) + offsetY;
    const previous = runs.at(-1);
    if (previous && previous[1] === y && previous[0] + previous[2] === x) previous[2] += 1;
    else runs.push([x, y, 1]);
  }
  return runs;
}

export function createPhysicalIntensityCompositor({ state, getContext, getProjection, getProjectionKey, withRenderTarget, getRowBounds = () => null, createCanvas = () => document.createElement("canvas") }) {
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
    const { width, height } = target.canvas;
    const matrix = target.getTransform();
    const [firstRow, lastRow] = getRowBounds({ projection, matrix, bounds, height }) || [0, height];
    const readHeight = lastRow - firstRow;
    if (!readHeight) return draw(blendMode);
    canvas ||= createCanvas();
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const scratch = canvas.getContext("2d", { willReadFrequently: true });
    scratch.resetTransform();
    scratch.clearRect(0, 0, width, height);
    scratch.setTransform(matrix);
    const result = withRenderTarget(scratch, () => draw("source-over"));
    if (result === 0) {
      if (width * height > 2_000_000) { canvas.width = 1; canvas.height = 1; }
      return result;
    }
    const key = [width, height, firstRow, readHeight, matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f, getProjectionKey()].join("|");
    if (key !== coordinateKey) {
      coordinateKey = key;
      // Keep cold and cached samples at the same precision as projection.invert.
      // Keep the existing two-million-pixel cache coverage for broad edits;
      // doubles cap retained storage at 32 MB, usually much less after cropping.
      coordinates = width * readHeight <= 2_000_000 ? new Float64Array(width * readHeight * 2).fill(Infinity) : null;
    }
    const image = scratch.getImageData(0, firstRow, width, readHeight);
    const runs = multiplyPhysicalAlpha(image, { projection, matrix, coordinates, bounds, offsetY: firstRow,
      sample: (lon, lat) => sampleIntensityField(state.intensityFields, channelId, lon, lat) });
    if (!runs.length) {
      draw(blendMode);
      if (width * height > 2_000_000) { canvas.width = 1; canvas.height = 1; }
      return result;
    }
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
    scratch.putImageData(image, 0, firstRow);
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
