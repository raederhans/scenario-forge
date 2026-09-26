const RADIANS = Math.PI / 180;
const MAX_MASK_DIMENSION = 512;

export function getNightCoverage(solarDot, twilightWidthDeg) {
  const width = Math.sin(Math.max(2, Math.min(28, twilightWidthDeg)) * RADIANS);
  return smoothNightCoverage(solarDot, 1 / width);
}

function smoothNightCoverage(solarDot, inverseWidth) {
  const t = Math.max(0, Math.min(1, -solarDot * inverseWidth));
  return t * t * (3 - 2 * t);
}

function projectionSignature(projection) {
  return JSON.stringify([
    "scale", "translate", "center", "rotate", "parallels", "angle",
    "reflectX", "reflectY", "clipAngle", "clipExtent",
  ].map((key) => projection[key]?.()));
}

// Cache geographic unit vectors, not solar angles: clock ticks only update a
// bounded alpha bitmap. The target transform includes DPR and pass overscan.
export function createDayNightMask({ createCanvas }) {
  let cachedProjection = null;
  let geometryKey = "";
  let illuminationKey = "";
  let vectors = null;
  let pixels = null;
  let canvas = null;
  let maskContext = null;

  function getMask({ context, projection, solarState, twilightWidthDeg = 10 }) {
    if (!context?.canvas || typeof context.getTransform !== "function"
      || typeof projection?.invert !== "function" || !solarState) return null;
    const targetWidth = context.canvas.width;
    const targetHeight = context.canvas.height;
    if (!(targetWidth > 0 && targetHeight > 0)) return null;
    const ratio = Math.min(0.25, MAX_MASK_DIMENSION / Math.max(targetWidth, targetHeight));
    const width = Math.max(1, Math.ceil(targetWidth * ratio));
    const height = Math.max(1, Math.ceil(targetHeight * ratio));
    const { a, b, c, d, e, f } = context.getTransform();
    const determinant = a * d - b * c;
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null;
    const nextGeometryKey = [targetWidth, targetHeight, a, b, c, d, e, f, projectionSignature(projection)].join("|");
    const geometryChanged = cachedProjection !== projection || geometryKey !== nextGeometryKey;
    if (geometryChanged) {
      canvas ||= createCanvas(width, height, context);
      maskContext ||= canvas?.getContext("2d");
      if (!maskContext) return null;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      vectors = new Float32Array(width * height * 3);
      pixels = maskContext.createImageData(width, height);
      const extent = projection.clipExtent?.();
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const screenX = (x + 0.5) * targetWidth / width - e;
          const screenY = (y + 0.5) * targetHeight / height - f;
          const px = (d * screenX - c * screenY) / determinant;
          const py = (a * screenY - b * screenX) / determinant;
          if (extent && (px < extent[0][0] || px > extent[1][0]
            || py < extent[0][1] || py > extent[1][1])) continue;
          const geographic = projection.invert([px, py]);
          if (!geographic || !geographic.every(Number.isFinite)
            || Math.abs(geographic[1]) > 90) continue;
          // Some projections return an inverse outside their actual world outline.
          const projected = projection(geographic);
          if (!projected || Math.hypot(projected[0] - px, projected[1] - py) > 1e-4) continue;
          const lon = geographic[0] * RADIANS;
          const lat = geographic[1] * RADIANS;
          const offset = (y * width + x) * 3;
          vectors[offset] = Math.cos(lat) * Math.cos(lon);
          vectors[offset + 1] = Math.cos(lat) * Math.sin(lon);
          vectors[offset + 2] = Math.sin(lat);
          const pixel = (y * width + x) * 4;
          pixels.data[pixel] = 8;
          pixels.data[pixel + 1] = 20;
          pixels.data[pixel + 2] = 35;
        }
      }
      cachedProjection = projection;
      geometryKey = nextGeometryKey;
      illuminationKey = "";
    }
    const nextIlluminationKey = [solarState.subsolarLongitude, solarState.declinationDeg, twilightWidthDeg].join("|");
    if (illuminationKey !== nextIlluminationKey) {
      const lon = solarState.subsolarLongitude * RADIANS;
      const lat = solarState.declinationDeg * RADIANS;
      const sunX = Math.cos(lat) * Math.cos(lon);
      const sunY = Math.cos(lat) * Math.sin(lon);
      const sunZ = Math.sin(lat);
      const inverseWidth = 1 / Math.sin(Math.max(2, Math.min(28, twilightWidthDeg)) * RADIANS);
      for (let index = 0; index < width * height; index += 1) {
        const offset = index * 3;
        const dot = vectors[offset] * sunX + vectors[offset + 1] * sunY + vectors[offset + 2] * sunZ;
        pixels.data[index * 4 + 3] = Math.round(255 * smoothNightCoverage(dot, inverseWidth));
      }
      maskContext.putImageData(pixels, 0, 0);
      illuminationKey = nextIlluminationKey;
    }
    return canvas;
  }

  return { getMask };
}
