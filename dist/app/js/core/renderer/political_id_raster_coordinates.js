export const POLITICAL_ID_RASTER_COORDINATE_SPACE_VERSION = 1;
export const POLITICAL_ID_RASTER_CANONICAL_SCALE = 256;
export const POLITICAL_ID_RASTER_CANONICAL_PRECISION = 0.05;

const STABLE_DECIMALS = 12;
const STABLE_FACTOR = 10 ** STABLE_DECIMALS;

function stableNumber(value) {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value * STABLE_FACTOR) / STABLE_FACTOR;
  const stable = Number.isFinite(rounded) ? rounded : Number(value.toPrecision(STABLE_DECIMALS + 1));
  return Object.is(stable, -0) ? 0 : stable;
}

function finitePair(value) {
  return (Array.isArray(value) || ArrayBuffer.isView(value))
    && value.length === 2
    && Number.isFinite(value[0])
    && Number.isFinite(value[1]);
}

function finiteVector(value, lengths) {
  return (Array.isArray(value) || ArrayBuffer.isView(value))
    && lengths.includes(value.length)
    && Array.from(value).every(Number.isFinite);
}

function canonicalOptions(options, ratio, translate) {
  const center = options.center === undefined ? [0, 0] : options.center;
  const rotate = options.rotate === undefined ? [0, 0, 0] : options.rotate;
  const angle = options.angle === undefined ? 0 : options.angle;
  const reflectX = options.reflectX === undefined ? false : options.reflectX;
  const reflectY = options.reflectY === undefined ? false : options.reflectY;
  const clipAngle = options.clipAngle === undefined ? null : options.clipAngle;
  const clipExtent = options.clipExtent === undefined ? null : options.clipExtent;

  if (!finitePair(center) || !finiteVector(rotate, [2, 3])
    || !Number.isFinite(angle) || typeof reflectX !== "boolean" || typeof reflectY !== "boolean"
    || (clipAngle !== null && (!Number.isFinite(clipAngle) || clipAngle < 0 || clipAngle > 180))) {
    return null;
  }

  let normalizedClipExtent = null;
  if (clipExtent !== null) {
    if (!Array.isArray(clipExtent) || clipExtent.length !== 2
      || !finitePair(clipExtent[0]) || !finitePair(clipExtent[1])
      || clipExtent[0][0] > clipExtent[1][0] || clipExtent[0][1] > clipExtent[1][1]) {
      return null;
    }
    normalizedClipExtent = clipExtent.map(([x, y]) => [
      stableNumber((x - translate[0]) * ratio),
      stableNumber((y - translate[1]) * ratio),
    ]);
    if (normalizedClipExtent.flat().some((value) => value === null)) return null;
  }

  return {
    factory: "geoEqualEarth",
    scale: POLITICAL_ID_RASTER_CANONICAL_SCALE,
    translate: [0, 0],
    center: Array.from(center, stableNumber),
    rotate: Array.from(rotate, stableNumber).concat(rotate.length === 2 ? [0] : []),
    angle: stableNumber(angle),
    reflectX,
    reflectY,
    precision: POLITICAL_ID_RASTER_CANONICAL_PRECISION,
    clipAngle: clipAngle === null ? null : stableNumber(clipAngle),
    clipExtent: normalizedClipExtent,
  };
}

function isFiniteBounds(bounds) {
  return !!bounds && typeof bounds === "object"
    && [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)
    && bounds.minX <= bounds.maxX && bounds.minY <= bounds.maxY;
}

/**
 * Build an affine mapping from a fitted geoEqualEarth projection to the
 * renderer's fixed-scale projection space. The returned functions do not
 * mutate their arguments and do not apply DPR; view planning owns DPR.
 */
export function createPoliticalIdRasterCoordinateSpace(projectionOptions) {
  if (!projectionOptions || typeof projectionOptions !== "object"
    || projectionOptions.factory !== "geoEqualEarth"
    || !Number.isFinite(projectionOptions.scale) || projectionOptions.scale <= 0
    || !finitePair(projectionOptions.translate)) return null;

  const scale = projectionOptions.scale;
  const translate = Array.from(projectionOptions.translate);
  const ratio = POLITICAL_ID_RASTER_CANONICAL_SCALE / scale;
  if (!Number.isFinite(ratio) || ratio <= 0) return null;

  const normalized = canonicalOptions(projectionOptions, ratio, translate);
  if (!normalized) return null;
  const signature = JSON.stringify({
    version: POLITICAL_ID_RASTER_COORDINATE_SPACE_VERSION,
    ...normalized,
  });

  function mapPoint(point) {
    if (!finitePair(point)) return null;
    const mapped = [
      stableNumber((point[0] - translate[0]) * ratio),
      stableNumber((point[1] - translate[1]) * ratio),
    ];
    return mapped.some((value) => value === null) ? null : mapped;
  }

  function mapBounds(bounds) {
    if (!isFiniteBounds(bounds)) return null;
    const min = mapPoint([bounds.minX, bounds.minY]);
    const max = mapPoint([bounds.maxX, bounds.maxY]);
    if (!min || !max) return null;
    return { minX: min[0], minY: min[1], maxX: max[0], maxY: max[1] };
  }

  function mapTransform(transform) {
    if (!transform || typeof transform !== "object"
      || ![transform.x, transform.y, transform.k].every(Number.isFinite)) return null;
    const mapped = {
      x: stableNumber(transform.x + transform.k * translate[0]),
      y: stableNumber(transform.y + transform.k * translate[1]),
      k: stableNumber(transform.k / ratio),
    };
    return Object.values(mapped).some((value) => value === null) ? null : mapped;
  }

  return {
    projectionOptions: normalized,
    signature,
    mapBounds,
    mapPoint,
    mapTransform,
  };
}
