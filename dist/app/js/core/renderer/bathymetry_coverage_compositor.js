const MASK_LAYER_COUNT = 20;
const MAX_FEATHER_DEGREES = 3;
const MAX_RETAINED_CANVAS_PIXELS = 2048 * 2048;

function isValidBbox(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return false;
  const [west, south, east, north] = bbox;
  if (![west, south, east, north].every(Number.isFinite)) return false;
  if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) return false;
  return true;
}

function isLocalBbox(bbox) {
  return isValidBbox(bbox) && bbox[2] - bbox[0] < 180;
}

function sampledEdge(start, end, fixed, latitudeVaries, reverse = false) {
  const steps = Math.ceil(Math.abs(end - start));
  const points = [];
  for (let index = 0; index <= steps; index += 1) {
    const fraction = index / steps;
    const value = reverse ? end - (end - start) * fraction : start + (end - start) * fraction;
    points.push(latitudeVaries ? [fixed, value] : [value, fixed]);
  }
  return points;
}

function rectangleGeometry(west, south, east, north) {
  // D3 geoPath treats this clockwise spherical ring as the small rectangle.
  const ring = [
    ...sampledEdge(south, north, west, true),
    ...sampledEdge(west, east, north, false).slice(1),
    ...sampledEdge(south, north, east, true, true).slice(1),
    ...sampledEdge(west, east, south, false, true).slice(1),
  ];
  ring[ring.length - 1] = [...ring[0]];
  return { type: "Polygon", coordinates: [ring] };
}

function smoothstep(value) {
  return value * value * (3 - 2 * value);
}

// Each inner layer is composited over the previous ones. Incremental alpha
// makes the accumulated mask reach the requested smoothstep opacity exactly.
export function buildBathymetryCoverageMaskLayers(bbox) {
  if (!isLocalBbox(bbox)) return [];
  const [west, south, east, north] = bbox;
  const feather = Math.min(MAX_FEATHER_DEGREES, (east - west) / 4, (north - south) / 4);
  const layers = [];
  let previousAlpha = 0;
  for (let index = 0; index < MASK_LAYER_COUNT; index += 1) {
    const progress = index / (MASK_LAYER_COUNT - 1);
    const targetAlpha = smoothstep((index + 1) / MASK_LAYER_COUNT);
    const alpha = (targetAlpha - previousAlpha) / (1 - previousAlpha);
    const inset = feather * progress;
    layers.push({
      geometry: rectangleGeometry(west + inset, south + inset, east - inset, north - inset),
      alpha,
      targetAlpha,
      inset,
    });
    previousAlpha = targetAlpha;
  }
  return layers;
}

export function buildBathymetryCutlineEraseLayers(totalWidth) {
  if (!Number.isFinite(totalWidth) || totalWidth <= 0) {
    throw new Error("Bathymetry cutline feather width must be positive");
  }
  const layers = [];
  let previousAlpha = 0;
  for (let index = 0; index < MASK_LAYER_COUNT; index += 1) {
    const targetAlpha = smoothstep((index + 1) / MASK_LAYER_COUNT);
    layers.push({
      width: totalWidth * (1 - index / MASK_LAYER_COUNT),
      alpha: (targetAlpha - previousAlpha) / (1 - previousAlpha),
      targetAlpha,
    });
    previousAlpha = targetAlpha;
  }
  return layers;
}

export function sampleBathymetryClipEdges(geometry) {
  if (geometry?.type !== "MultiLineString" && geometry?.type !== "LineString") {
    throw new Error("Bathymetry clip edges must be line geometry");
  }
  const sampleLine = (line) => {
    if (!Array.isArray(line)) throw new Error("Bathymetry clip edge coordinates are invalid");
    const sampled = [];
    for (const point of line) {
      if (!Array.isArray(point) || point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
        throw new Error("Bathymetry clip edge coordinates are invalid");
      }
      if (sampled.length) {
        const previous = sampled.at(-1);
        const steps = Math.ceil(Math.max(Math.abs(point[0] - previous[0]), Math.abs(point[1] - previous[1])));
        for (let index = 1; index < steps; index += 1) {
          const fraction = index / steps;
          sampled.push([
            previous[0] + (point[0] - previous[0]) * fraction,
            previous[1] + (point[1] - previous[1]) * fraction,
          ]);
        }
      }
      sampled.push([point[0], point[1]]);
    }
    return sampled;
  };
  return geometry.type === "LineString"
    ? { type: "LineString", coordinates: sampleLine(geometry.coordinates) }
    : { type: "MultiLineString", coordinates: geometry.coordinates.map(sampleLine) };
}

function setIdentity(context) {
  context.setTransform(1, 0, 0, 1, 0, 0);
}

function copyTransform(context, transform) {
  context.setTransform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f);
}

export function createBathymetryCoverageCompositor({
  getContext,
  withRenderTarget,
  traceGeometry,
  getFeatherWidth,
  createCanvas = () => document.createElement("canvas"),
}) {
  let scratchCanvas = null;
  let maskCanvas = null;

  function canvasForSize(existing, width, height) {
    const canvas = existing || createCanvas();
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    return canvas;
  }

  function releaseLargeCanvases(width, height) {
    if (width * height <= MAX_RETAINED_CANVAS_PIXELS) return;
    scratchCanvas.width = scratchCanvas.height = 1;
    maskCanvas.width = maskCanvas.height = 1;
  }

  function paint(bbox, draw, clipEdges = null) {
    const local = isLocalBbox(bbox);
    if (!clipEdges?.coordinates?.length) clipEdges = null;
    // A wide longitude envelope is not a small spherical polygon. It also
    // must not introduce a false coverage edge at the Pacific dateline.
    if (!local && !(isValidBbox(bbox) && clipEdges)) return draw();
    const target = getContext();
    if (!target?.canvas || typeof target.getTransform !== "function") {
      throw new Error("Bathymetry coverage requires an active 2D target context");
    }
    const { width, height } = target.canvas;
    scratchCanvas = canvasForSize(scratchCanvas, width, height);
    maskCanvas = canvasForSize(maskCanvas, width, height);
    const scratch = scratchCanvas.getContext("2d");
    const mask = maskCanvas.getContext("2d");
    if (!scratch || !mask) throw new Error("Bathymetry coverage requires 2D scratch contexts");
    const transform = target.getTransform();
    try {
      setIdentity(scratch);
      scratch.clearRect(0, 0, width, height);
      copyTransform(scratch, transform);
      scratch.globalAlpha = target.globalAlpha;
      scratch.globalCompositeOperation = target.globalCompositeOperation;
      const result = withRenderTarget(scratch, draw);

      setIdentity(mask);
      mask.clearRect(0, 0, width, height);
      if (local) {
        copyTransform(mask, transform);
        mask.globalCompositeOperation = "source-over";
        mask.fillStyle = "#000";
        for (const layer of buildBathymetryCoverageMaskLayers(bbox)) {
          mask.globalAlpha = layer.alpha;
          mask.beginPath();
          traceGeometry(layer.geometry, mask);
          mask.fill();
        }
      } else {
        mask.globalAlpha = 1;
        mask.globalCompositeOperation = "source-over";
        mask.fillStyle = "#000";
        mask.fillRect(0, 0, width, height);
        copyTransform(mask, transform);
      }

      if (clipEdges) {
        if (typeof getFeatherWidth !== "function") {
          throw new Error("Bathymetry cutline feather width provider is missing");
        }
        mask.globalCompositeOperation = "destination-out";
        mask.strokeStyle = "#000";
        mask.lineJoin = "round";
        mask.lineCap = "round";
        const sampledClipEdges = sampleBathymetryClipEdges(clipEdges);
        for (const layer of buildBathymetryCutlineEraseLayers(getFeatherWidth(clipEdges))) {
          mask.globalAlpha = layer.alpha;
          mask.lineWidth = layer.width;
          mask.beginPath();
          traceGeometry(sampledClipEdges, mask);
          mask.stroke();
        }
      }

      scratch.save();
      try {
        setIdentity(scratch);
        scratch.globalAlpha = 1;
        scratch.globalCompositeOperation = "destination-in";
        scratch.drawImage(maskCanvas, 0, 0);
      } finally {
        scratch.restore();
      }

      target.save();
      try {
        setIdentity(target);
        target.globalAlpha = 1;
        target.globalCompositeOperation = "source-over";
        target.drawImage(scratchCanvas, 0, 0);
      } finally {
        target.restore();
      }
      return result;
    } finally {
      releaseLargeCanvases(width, height);
    }
  }

  return Object.freeze({ paint });
}
