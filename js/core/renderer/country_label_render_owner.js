import { buildCountryLabelCandidates, filterCountryLabelHoles, fitCountryLabel } from "./country_label_layout.js";
import { getProjectionGeometryGeneration } from "./projection_geometry_identity.js";
import { doScreenLabelBoxesOverlap } from "./screen_label_placement.js";
import { getMapLabelHierarchy, getCountryLabelOpacity } from "./map_label_hierarchy.js";

const ENGLISH_FONT = '"Map Garamond", "Palatino Linotype", Georgia, serif';
const CHINESE_FONT = '"Map Noto Serif SC", "Noto Serif SC", "Songti SC", SimSun, serif';
const fontWeight = (font) => font === CHINESE_FONT ? 400 : 500;
const displayText = (name, language) => {
  const text = String(name || "").trim();
  // Strategy-map titles are spaced capitals; tracking stretches them along
  // the territory instead of shrinking multiword names to mixed case.
  return language.startsWith("en") ? text.toLocaleUpperCase("en") : text;
};
const METRIC_FONT_SIZE = 100;
const MAX_CACHED_FITS = 4;
const MAX_PENDING_WORKER_FITS = 8;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

function ringMetrics(ring) {
  let sum = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let index = 0; index < ring.length; index += 1) {
    const point = ring[index];
    const next = ring[(index + 1) % ring.length];
    sum += point[0] * next[1] - next[0] * point[1];
    minX = Math.min(minX, point[0]);
    minY = Math.min(minY, point[1]);
    maxX = Math.max(maxX, point[0]);
    maxY = Math.max(maxY, point[1]);
  }
  return { area: Math.abs(sum) / 2, minX, minY, maxX, maxY };
}

const MIN_INDEXED_RING_LENGTH = 256;
const RING_EDGE_BLOCK_SIZE = 32;

function ringContainsEdgeRange(ring, x, y, start, end) {
  let inside = false;
  for (let i = start, j = start === 0 ? ring.length - 1 : start - 1; i < end; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function buildRingYIndex(ring, start = 0, end = ring.length) {
  if (end - start <= RING_EDGE_BLOCK_SIZE) {
    // Every edge i also uses vertex i-1, including the closing edge at i=0.
    let minY = ring[start === 0 ? ring.length - 1 : start - 1][1];
    let maxY = minY;
    for (let index = start; index < end; index++) {
      const y = ring[index][1];
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    return { start, end, minY, maxY };
  }
  const middle = start + Math.floor((end - start) / 2);
  const left = buildRingYIndex(ring, start, middle);
  const right = buildRingYIndex(ring, middle, end);
  return { left, right, minY: Math.min(left.minY, right.minY), maxY: Math.max(left.maxY, right.maxY) };
}

function indexedRingContains(ring, index, x, y) {
  // The original crossing predicate includes the lower endpoint and excludes
  // the upper one. Horizontal blocks therefore have no crossings at any y.
  if (y < index.minY || y >= index.maxY) return false;
  if (!index.left) return ringContainsEdgeRange(ring, x, y, index.start, index.end);
  return indexedRingContains(ring, index.left, x, y) !== indexedRingContains(ring, index.right, x, y);
}

function ringContains(node, [x, y]) {
  const ring = node.ring;
  if (ring.length < MIN_INDEXED_RING_LENGTH) return ringContainsEdgeRange(ring, x, y, 0, ring.length);
  // Many holes query the same large exterior. Keep this lazy index on the
  // grouping node only, so no geometry or projection cache retains it.
  node.ringYIndex ||= buildRingYIndex(ring);
  return indexedRingContains(ring, node.ringYIndex, x, y);
}

export function groupProjectedRings(rings) {
  // A clipped spherical polygon can emit several disjoint exterior rings in
  // one polygonStart/polygonEnd pair. Rebuild planar nesting before fitting.
  const nodes = rings.map((ring) => ({ ring, ...ringMetrics(ring), parent: null, depth: 0 }))
    .filter((node) => node.area > 1e-8).sort((a, b) => b.area - a.area);
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const [x, y] = node.ring[0];
    for (let prior = index - 1; prior >= 0; prior -= 1) {
      const candidate = nodes[prior];
      // Most projected island rings are disjoint. Reject impossible containers
      // before walking their edges; inclusive bounds retain exact boundary rules.
      if (x < candidate.minX || x > candidate.maxX || y < candidate.minY || y > candidate.maxY) continue;
      if (ringContains(candidate, node.ring[0])) {
        node.parent = candidate;
        node.depth = node.parent.depth + 1;
        break;
      }
    }
  }
  const byExterior = new Map(nodes.filter((node) => node.depth % 2 === 0).map((node) => [node, [node.ring]]));
  for (const node of nodes) {
    if (node.depth % 2 === 1) byExterior.get(node.parent)?.push(node.ring);
  }
  return [...byExterior.values()];
}

// Projection streams perform spherical clipping and antimeridian splitting.
// Projecting coordinate vertices individually would lose both of those seams.
export function projectCountryLabelPolygons(feature, projection, geoStream) {
  if (!feature || typeof projection?.stream !== "function" || typeof geoStream !== "function") return [];
  const polygons = [];
  let polygon = null;
  let ring = null;
  const sink = {
    polygonStart() { polygon = []; },
    polygonEnd() {
      if (polygon?.length) polygons.push(...groupProjectedRings(polygon));
      polygon = null;
    },
    lineStart() { ring = []; },
    lineEnd() {
      if (polygon && ring?.length >= 3) {
        const first = ring[0];
        const last = ring[ring.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
        polygon.push(ring);
      }
      ring = null;
    },
    point(x, y) { if (ring && Number.isFinite(x) && Number.isFinite(y)) ring.push([x, y]); },
    sphere() {},
  };
  geoStream(feature, projection.stream(sink));
  return polygons;
}

// Titles are fitted once in projected map units, like lettering printed on
// the map. Zoom only scales them, so position, curve and size never jump;
// the screen size alone fades a title in when legible and out when oversized.
const LAYOUT_MIN_FONT_SIZE = 0.12;
const LAYOUT_MAX_FONT_SIZE = 96;
const LAYOUT_MIN_HOLE_AREA = 4;
const FADE_IN_START_PX = 7;
const FADE_IN_END_PX = 10;
const FADE_OUT_START_PX = 120;
const FADE_OUT_END_PX = 200;
const MAX_ALPHA = 0.82;

function getVisibilityAlpha(fontSizePx) {
  const legible = clamp((fontSizePx - FADE_IN_START_PX) / (FADE_IN_END_PX - FADE_IN_START_PX), 0, 1);
  const overview = clamp((FADE_OUT_END_PX - fontSizePx) / (FADE_OUT_END_PX - FADE_OUT_START_PX), 0, 1);
  return legible * overview * MAX_ALPHA;
}

function screenBox(box, transform, padding) {
  const corners = box.corners;
  const minX = box.minX ?? (corners?.length ? Math.min(...corners.map((point) => point.x)) : undefined);
  const minY = box.minY ?? (corners?.length ? Math.min(...corners.map((point) => point.y)) : undefined);
  const maxX = box.maxX ?? (corners?.length ? Math.max(...corners.map((point) => point.x)) : undefined);
  const maxY = box.maxY ?? (corners?.length ? Math.max(...corners.map((point) => point.y)) : undefined);
  const x = box.x ?? minX;
  const y = box.y ?? minY;
  const width = box.w ?? (maxX - minX);
  const height = box.h ?? (maxY - minY);
  return {
    x: x * transform.k + transform.x - padding,
    y: y * transform.k + transform.y - padding,
    w: width * transform.k + padding * 2,
    h: height * transform.k + padding * 2,
  };
}

function polygonBounds(polygons) {
  const points = polygons.flat(2);
  if (!points.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function visibleComponentArea(component, transform, viewport) {
  if (!component) return 0;
  const box = screenBox(component.bounds, transform, 0);
  const width = Math.max(0, Math.min(viewport.maxX ?? viewport.width, box.x + box.w) - Math.max(viewport.minX ?? 0, box.x));
  const height = Math.max(0, Math.min(viewport.maxY ?? viewport.height, box.y + box.h) - Math.max(viewport.minY ?? 0, box.y));
  const fraction = box.w > 0 && box.h > 0 ? width * height / (box.w * box.h) : 0;
  return component.area * transform.k ** 2 * fraction;
}

function visibleTerritoryArea(entry, transform, viewport) {
  // Use each clipped component's real area, subtracting holes. A country's
  // overseas islands or antimeridian span must not inflate its display rank.
  return entry.components.reduce((largest, component) => {
    return Math.max(largest, visibleComponentArea(component, transform, viewport));
  }, 0);
}

export function isCountryLabelDefinitelyInvisible(entry, transform, paintBounds) {
  if (!entry.polygons || !Array.isArray(entry.components) || !entry.components.length
    || ![transform?.x, transform?.y, transform?.k].every(Number.isFinite) || !(transform.k > 0)
    || ![paintBounds?.minX ?? 0, paintBounds?.minY ?? 0,
      paintBounds?.maxX ?? paintBounds?.width, paintBounds?.maxY ?? paintBounds?.height].every(Number.isFinite)) return false;
  return entry.components.every(component => {
    if (!component?.bounds || ![component.bounds.x, component.bounds.y, component.bounds.w, component.bounds.h].every(Number.isFinite)
      || component.bounds.w < 0 || component.bounds.h < 0 || !Number.isFinite(component.area) || component.area < 0) return false;
    // Fitted glyph ink lies inside the component, and a capital's ink is at
    // least half its font size. Its longest side therefore bounds any fit.
    // Only the legibility fade applies: a smaller fit may escape the overview fade.
    const maximumFontPx = 2 * Math.max(component.bounds.w, component.bounds.h) * transform.k;
    return maximumFontPx < FADE_IN_START_PX + 0.05 / MAX_ALPHA * (FADE_IN_END_PX - FADE_IN_START_PX);
  });
}

export function createCountryLabelRenderOwner({ state = {}, getters = {}, helpers = {} } = {}) {
  const {
    getContext = () => null,
    getProjection = () => null,
    getProjectionIdentity = () => getProjectionGeometryGeneration(getProjection()),
    getViewportSize = () => ({ width: 0, height: 0 }),
    getPaintBounds = () => null,
    getTransform = () => state.zoomTransform || { x: 0, y: 0, k: 1 },
    getLanguage = () => state.currentLanguage || state.language || "en",
    getCountryLabelSource = () => null,
    getCountryLabelColors = () => ({ fill: "#172b35", stroke: "rgba(255, 252, 241, 0.4)" }),
    getD3 = () => globalThis.d3,
  } = getters;
  const buildCandidates = helpers.buildCountryLabelCandidates || buildCountryLabelCandidates;
  const fitLabel = helpers.fitCountryLabel || fitCountryLabel;
  const glyphMetrics = new Map();
  let geometryCache = null;
  let scheduledContinuation = null;
  let privatePreparation = null;
  let layoutWorkers = [];
  const maxLayoutWorkers = Math.max(1, Math.min(4, Math.floor(helpers.maxLayoutWorkers || 4)));
  const maxPendingPerWorker = Math.max(1, Math.min(MAX_PENDING_WORKER_FITS, Math.floor(helpers.maxPendingPerWorker || 2)));
  let workerFailed = false;
  let requestId = 0;
  let cacheGeneration = 0;
  let textGeneration = 0;
  const workerRequests = new Map();
  const setRequestTimeout = helpers.setTimeout || globalThis.setTimeout;
  const clearRequestTimeout = helpers.clearTimeout || globalThis.clearTimeout;
  const nowMs = helpers.nowMs || (() => globalThis.performance?.now?.() ?? Date.now());
  const scheduleWork = helpers.scheduleWork || ((callback) => {
    if (typeof globalThis.requestIdleCallback === "function") globalThis.requestIdleCallback(callback, { timeout: 200 });
    else globalThis.setTimeout(callback, 0);
  });
  const schedulePreparation = helpers.schedulePreparation || helpers.scheduleWork
    || ((callback) => globalThis.setTimeout(callback, 0));
  const diagnostics = {
    geometryBuilds: 0, candidateBuilds: 0, fitBuilds: 0, metricBuilds: 0,
    projectedCountries: 0, candidateCount: 0, drawn: 0, glyphsDrawn: 0, pendingFits: 0, lastLabels: [],
    workerFits: 0, workerErrors: 0, lastWorkerError: "",
    workerTotalMs: 0, workerMaxMs: 0, workerFitMs: 0, workerMaxFitMs: 0,
    workerCandidateBuildMs: 0, workerMaxCandidateBuildMs: 0, workerPreparedBuildMs: 0, workerMaxPreparedBuildMs: 0,
    preparedGeometryHits: 0, preparedGeometryBuilds: 0, preparedGeometryBytes: 0,
    workerCount: 0, workersCreated: 0, workerPoolLimit: maxLayoutWorkers,
    maxWorkerQueue: 0, maxPendingWorkerFits: 0,
    rejectedByVisibility: 0, rejectedByCollision: 0, rejectedByViewport: 0, noFit: 0, rejectedLabels: [],
    skippedByVisibilityUpperBound: 0,
  };

  function storeFit(entry, key, fit) {
    entry.fits.delete(key);
    entry.fits.set(key, fit);
    while (entry.fits.size > MAX_CACHED_FITS) entry.fits.delete(entry.fits.keys().next().value);
  }

  function projectEntry(entry, projection, budget = Infinity) {
    const start = nowMs();
    const geoStream = helpers.geoStream || getD3()?.geoStream;
    do {
      if (entry.polygonCursor >= entry.inputPolygons.length) {
        entry.polygons = entry.projectedPolygons;
        entry.bounds = polygonBounds(entry.polygons);
        entry.components = entry.polygons.map((polygon, polygonIndex) => ({
          polygonIndex,
          bounds: polygonBounds([polygon]),
          area: Math.max(0, ringMetrics(polygon[0]).area - polygon.slice(1).reduce((sum, ring) => sum + ringMetrics(ring).area, 0)),
        })).filter((component) => component.bounds && component.area > 0);
        entry.inputPolygons = null;
        diagnostics.projectedCountries += Number(!!entry.polygons.length);
        return true;
      }
      const coordinates = entry.inputPolygons[entry.polygonCursor++];
      entry.projectedPolygons.push(...projectCountryLabelPolygons({ type: "Polygon", coordinates }, projection, geoStream));
    } while (nowMs() - start < budget);
    return false;
  }

  function terminateLayoutWorkers() {
    const previous = layoutWorkers;
    layoutWorkers = [];
    diagnostics.workerCount = 0;
    for (const slot of previous) slot?.worker.terminate();
  }

  function canQueueEntry(entry) {
    return (layoutWorkers[entry.workerSlot]?.pending || 0) < maxPendingPerWorker;
  }

  function failWorker(error) {
    diagnostics.workerErrors += 1;
    diagnostics.lastWorkerError = String(error?.message || error || "country label layout worker failed");
    workerFailed = true;
    terminateLayoutWorkers();
    for (const pending of workerRequests.values()) {
      clearRequestTimeout(pending.timeout);
      pending.entry.workerPending.delete(pending.key);
      storeFit(pending.entry, pending.key, null);
    }
    workerRequests.clear();
  }

  function getLayoutWorker(entry) {
    const index = entry.workerSlot;
    if (workerFailed) return null;
    if (layoutWorkers[index]) return layoutWorkers[index];
    const createWorker = helpers.createWorker || (typeof globalThis.Worker === "function"
      ? () => new Worker(new URL("./country_label_layout_worker.js", import.meta.url), { type: "module" }) : null);
    if (!createWorker) return null;
    try {
      const worker = createWorker({ index });
      const slot = { worker, pending: 0 };
      layoutWorkers[index] = slot;
      diagnostics.workerCount++;
      diagnostics.workersCreated++;
      worker.onmessage = ({ data }) => {
        if (layoutWorkers[index] !== slot) return;
        const request = workerRequests.get(data.requestId);
        if (!request || request.slot !== slot) return;
        clearRequestTimeout(request.timeout);
        workerRequests.delete(data.requestId);
        slot.pending--;
        request.entry.workerPending.delete(request.key);
        for (const [field, total, maximum] of [["workerMs", "workerTotalMs", "workerMaxMs"],
          ["fitMs", "workerFitMs", "workerMaxFitMs"],
          ["candidateBuildMs", "workerCandidateBuildMs", "workerMaxCandidateBuildMs"],
          ["preparedGeometryBuildMs", "workerPreparedBuildMs", "workerMaxPreparedBuildMs"]]) {
          if (Number.isFinite(data[field]) && data[field] >= 0) {
            diagnostics[total] += data[field];
            diagnostics[maximum] = Math.max(diagnostics[maximum], data[field]);
          }
        }
        diagnostics.preparedGeometryHits += Number(data.preparedGeometryHits) || 0;
        diagnostics.preparedGeometryBuilds += Number(data.preparedGeometryBuilds) || 0;
        if (Number.isFinite(data.preparedGeometryBytes)) diagnostics.preparedGeometryBytes = data.preparedGeometryBytes;
        if (request.geometry !== geometryCache || request.textGeneration !== textGeneration
          || !isFitCacheCurrent(request.view)
          || (request.preparation && !isPrivateViewCurrent(request.preparation))) {
          notifyPreparationProgress(request);
          return;
        }
        if (data.error) {
          storeFit(request.entry, request.key, null);
          failWorker(data.error);
        } else {
          storeFit(request.entry, request.key, data.fit);
          diagnostics.fitBuilds += 1;
          diagnostics.workerFits += 1;
          if (data.candidateBuilt) {
            diagnostics.candidateBuilds += 1;
            diagnostics.candidateCount += data.candidateCount;
          }
        }
        notifyPreparationProgress(request);
      };
      worker.onerror = (error) => {
        if (layoutWorkers[index] !== slot) return;
        failWorker(error);
        notifyPreparationProgress();
      };
      worker.onmessageerror = () => {
        if (layoutWorkers[index] !== slot) return;
        failWorker(new Error("Country label worker response could not be decoded."));
        notifyPreparationProgress();
      };
    } catch (error) {
      failWorker(error);
    }
    return layoutWorkers[index] || null;
  }

  function prepareFit(entry, context, text, key, isChinese, font, view) {
    if (workerFailed) {
      storeFit(entry, key, null);
      return;
    }
    const options = {
      glyphs: getGlyphMetrics(context, text, font), glyphPadding: 0.06,
      minFontSize: LAYOUT_MIN_FONT_SIZE, maxFontSize: LAYOUT_MAX_FONT_SIZE,
      // Wide letter spacing lets a title span its territory as on a strategy map.
      tracking: isChinese ? 0.12 : 0.08, maxTracking: isChinese ? 0.9 : 0.6,
      minHoleArea: LAYOUT_MIN_HOLE_AREA,
      // Legibility is decided per zoom while drawing; the fit itself only
      // ranks wrapping and arcs by the size they achieve.
      readableFontSize: Number.MAX_VALUE,
      maxAlternatives: 3,
      maxTiltDegrees: 30, allowArcs: true,
      preferGentleArcs: true,
      maxArcTiltDegrees: isChinese ? 12 : 18, maxArcBendDegrees: isChinese ? 18 : 28,
      allowMultiline: true, allowPositionShift: true,
    };
    const slot = typeof helpers.onInvalidate === "function" ? getLayoutWorker(entry) : null;
    if (workerFailed) {
      storeFit(entry, key, null);
      return;
    }
    if (slot) {
      const id = ++requestId;
      entry.workerPending.add(key);
      const timeout = setRequestTimeout(() => {
        if (!workerRequests.has(id)) return;
        failWorker(new Error("Country label layout worker timed out."));
        notifyPreparationProgress();
      }, 20_000);
      workerRequests.set(id, { geometry: geometryCache, entry, key, textGeneration, timeout, slot, view,
        preparation: privatePreparation });
      slot.pending++;
      diagnostics.maxWorkerQueue = Math.max(diagnostics.maxWorkerQueue, slot.pending);
      diagnostics.maxPendingWorkerFits = Math.max(diagnostics.maxPendingWorkerFits, workerRequests.size);
      try {
        slot.worker.postMessage({ requestId: id, generation: cacheGeneration, countryCode: entry.countryCode,
          polygons: entry.workerHasGeometry ? undefined : entry.polygons, options });
        entry.workerHasGeometry = true;
      } catch (error) { failWorker(error); }
      return;
    }
    if (!(entry.candidates instanceof Map)) entry.candidates = new Map();
    const fitPolygons = filterCountryLabelHoles(entry.polygons, options.minHoleArea);
    const candidateKey = `${options.allowArcs}:${fitPolygons.map((polygon) => polygon.length).join(",")}`;
    if (!entry.candidates.has(candidateKey)) {
      const candidates = buildCandidates(fitPolygons, { allowArcs: options.allowArcs });
      entry.candidates.set(candidateKey, candidates);
      while (entry.candidates.size > 4) entry.candidates.delete(entry.candidates.keys().next().value);
      diagnostics.candidateBuilds += 1;
      diagnostics.candidateCount += candidates.length;
    }
    const candidates = entry.candidates.get(candidateKey);
    const fit = candidates.length ? fitLabel(candidates, { ...options, polygons: entry.polygons }) : null;
    diagnostics.fitBuilds += 1;
    storeFit(entry, key, fit);
  }

  function getGlyphMetrics(context, text, font) {
    const key = `${font}\n${text}`;
    if (glyphMetrics.has(key)) return glyphMetrics.get(key);
    context.font = `${fontWeight(font)} ${METRIC_FONT_SIZE}px ${font}`;
    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    const graphemes = segmenter ? Array.from(segmenter.segment(text), (part) => part.segment) : Array.from(text);
    const result = graphemes.map((glyph) => {
      const measured = context.measureText(glyph);
      const advance = Number(measured.width) / METRIC_FONT_SIZE;
      const normalized = (value, fallback) => Number.isFinite(value) ? value / METRIC_FONT_SIZE : fallback;
      return {
        text: glyph, advance,
        left: normalized(measured.actualBoundingBoxLeft, 0),
        right: normalized(measured.actualBoundingBoxRight, advance),
        ascent: normalized(measured.actualBoundingBoxAscent, 0.8),
        descent: normalized(measured.actualBoundingBoxDescent, 0.2),
      };
    });
    diagnostics.metricBuilds += 1;
    glyphMetrics.set(key, result);
    return result;
  }

  function getGeometry(source, projection) {
    const identity = getProjectionIdentity();
    if (geometryCache && geometryCache.sourceToken === source.sourceToken
      && geometryCache.revision === source.revision && geometryCache.projection === projection
      && geometryCache.identity === identity) return geometryCache;
    cancelPrivatePreparation();
    const entries = (source.countries || []).map((record, index) => {
      const shape = record.geometry || record.feature?.geometry;
      const inputPolygons = shape?.type === "MultiPolygon" ? shape.coordinates
        : shape?.type === "Polygon" ? [shape.coordinates] : [];
      return { countryCode: record.countryCode, inputPolygons, projectedPolygons: [], polygonCursor: 0,
        polygons: null, bounds: null, components: [], candidates: null, fits: new Map(),
        workerPending: new Set(), workerHasGeometry: false, workerSlot: index % maxLayoutWorkers };
    });
    terminateLayoutWorkers();
    for (const pending of workerRequests.values()) clearRequestTimeout(pending.timeout);
    workerRequests.clear();
    scheduledContinuation = null;
    // A failure stops this generation; a new scene or projection owns a fresh
    // attempt, so one crashed worker cannot poison the whole application.
    workerFailed = false;
    diagnostics.workerErrors = 0;
    diagnostics.lastWorkerError = "";
    diagnostics.preparedGeometryBytes = 0;
    cacheGeneration += 1;
    diagnostics.geometryBuilds += 1;
    diagnostics.projectedCountries = 0;
    diagnostics.candidateCount = 0;
    geometryCache = { sourceToken: source.sourceToken, revision: source.revision, projection, identity, entries };
    // A replaced source/projection also releases obsolete text measurements.
    glyphMetrics.clear();
    if (typeof helpers.onInvalidate !== "function") {
      for (const entry of entries) projectEntry(entry, projection);
    }
    return geometryCache;
  }

  function getFitKey(text, language, font) {
    // Map-space fits depend on neither zoom nor viewport.
    return `${textGeneration}\n${language}\n${font}\n${text}`;
  }

  function getViewFitRequest(entry, view, onInvisible = null) {
    const text = displayText(view.records.get(entry.countryCode)?.name, view.language);
    if (!text) return null;
    const key = getFitKey(text, view.language, view.font);
    if (entry.polygons) {
      if (!entry.bounds) return null;
      const box = screenBox(entry.bounds, view.transform, 0);
      const bounds = view.paintBounds;
      if (box.x + box.w < bounds.minX + 2 || box.y + box.h < bounds.minY + 2
        || box.x > bounds.maxX - 2 || box.y > bounds.maxY - 2) return null;
      if (isCountryLabelDefinitelyInvisible(entry, view.transform, bounds)) {
        onInvisible?.(entry, text);
        return null;
      }
    }
    return { entry, text, key };
  }

  function collectPendingFits(view) {
    return view.geometry.entries.map(entry => getViewFitRequest(entry, view))
      .filter(request => request && (!request.entry.polygons || !request.entry.fits.has(request.key)));
  }

  function preparePendingFits(pending, view) {
    const target = getContext();
    if (!target) return;
    const start = nowMs();
    let prepared = 0, remaining = 12;
    for (const { entry, text, key } of pending) {
      if (workerRequests.size >= MAX_PENDING_WORKER_FITS) break;
      if (entry.workerPending.has(key) || entry.fits.has(key) || entry.workerPending.size >= MAX_CACHED_FITS || !canQueueEntry(entry)) continue;
      if (prepared && (remaining <= 0 || prepared >= 8)) break;
      if (!entry.polygons) projectEntry(entry, view.projection, Math.max(0, remaining));
      // Projection can establish that a country does not need a fit at all.
      if (entry.polygons && getViewFitRequest(entry, view) && nowMs() - start < 12) {
        target.save();
        try { prepareFit(entry, target, text, key, view.isChinese, view.font, view); }
        finally { target.restore(); }
      }
      prepared += 1;
      remaining = 12 - (nowMs() - start);
    }
  }

  function cancelPrivatePreparation(error = null) {
    const job = privatePreparation;
    if (!job) return;
    privatePreparation = null;
    job.scheduled = false;
    job.view = null;
    if (error) job.reject(error);
    else job.resolve();
  }

  function isFitCacheCurrent(view) {
    if (!view || view.textGeneration !== textGeneration || geometryCache !== view.geometry
      || getProjection() !== view.projection || getProjectionIdentity() !== view.geometry.identity
      || String(getLanguage() || "en") !== view.language) return false;
    const source = getCountryLabelSource();
    if (source?.status !== "ready" || source.sourceToken !== view.geometry.sourceToken
      || source.revision !== view.geometry.revision || source.countries !== view.countries) return false;
    const viewport = getViewportSize();
    return viewport.width === view.viewport.width && viewport.height === view.viewport.height;
  }

  function isFitViewCurrent(view) {
    if (!isFitCacheCurrent(view)) return false;
    const transform = getTransform() || {}, viewport = getViewportSize();
    const bounds = getPaintBounds() || { minX: 0, minY: 0, maxX: viewport.width, maxY: viewport.height };
    return ["x", "y", "k"].every(key => (Number(transform[key]) || (key === "k" ? 1 : 0)) === view.transform[key])
      && ["minX", "minY", "maxX", "maxY"].every(key => bounds[key] === view.paintBounds[key]);
  }

  function isPrivateViewCurrent(job) {
    return privatePreparation === job && helpers.isPrivatePreparationEnabled?.() !== false
      && !state.isInteracting && state.styleConfig?.countryLabels?.enabled !== false
      && isFitViewCurrent(job.view);
  }

  function advancePrivatePreparation() {
    const job = privatePreparation;
    if (!job) return;
    if (!isPrivateViewCurrent(job)) { cancelPrivatePreparation(); return; }
    const pending = collectPendingFits(job.view);
    if (!pending.length || workerFailed) {
      cancelPrivatePreparation();
      helpers.onInvalidate?.();
      return;
    }
    const next = pending.some(({ entry, key }) => !entry.workerPending.has(key)
      && entry.workerPending.size < MAX_CACHED_FITS && canQueueEntry(entry));
    if (!next || job.scheduled || workerRequests.size >= MAX_PENDING_WORKER_FITS) return;
    job.scheduled = true;
    schedulePreparation(() => {
      if (privatePreparation !== job) return;
      job.scheduled = false;
      if (!isPrivateViewCurrent(job) || !getContext()) { cancelPrivatePreparation(); return; }
      try {
        preparePendingFits(collectPendingFits(job.view), job.view);
        advancePrivatePreparation();
      } catch (error) {
        // The frame preflight may only inspect the returned promise. Record a
        // terminal generation failure and wake it without an unhandled reject.
        failWorker(error);
        cancelPrivatePreparation();
        helpers.onInvalidate?.();
      }
    });
  }

  function notifyPreparationProgress(request = null) {
    if (privatePreparation) advancePrivatePreparation();
    else if (!request?.preparation) helpers.onInvalidate?.();
  }

  function prepareCurrentView(k) {
    if (privatePreparation && privatePreparation.view.transform.k === k
      && isPrivateViewCurrent(privatePreparation)) return privatePreparation.promise;
    cancelPrivatePreparation();
    if (helpers.isPrivatePreparationEnabled?.() === false || state.isInteracting
      || state.styleConfig?.countryLabels?.enabled === false || !(k > 0)
      || !getContext() || !getProjection()) return null;
    const source = getCountryLabelSource(), projection = getProjection(), viewport = getViewportSize();
    if (source?.status !== "ready" || !(viewport.width > 0 && viewport.height > 0)) return null;
    const raw = getTransform() || {}, language = String(getLanguage() || "en"), isChinese = language.startsWith("zh");
    const view = { geometry: getGeometry(source, projection), projection, countries: source.countries, viewport: { ...viewport },
      transform: { x: Number(raw.x) || 0, y: Number(raw.y) || 0, k }, language, isChinese,
      font: isChinese ? CHINESE_FONT : ENGLISH_FONT, textGeneration,
      paintBounds: { ...(getPaintBounds() || { minX: 0, minY: 0, maxX: viewport.width, maxY: viewport.height }) },
      records: new Map((source.countries || []).map(record => [record.countryCode, record])) };
    if (!collectPendingFits(view).length || workerFailed) return null;
    scheduledContinuation = null;
    const job = { view, scheduled: false, resolve: null, reject: null, promise: null };
    job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
    privatePreparation = job;
    advancePrivatePreparation();
    return job.promise;
  }

  function drawCountryLabels(k, { interactive = false, occupiedBoxes = [] } = {}) {
    if (privatePreparation && (interactive || !isPrivateViewCurrent(privatePreparation))) cancelPrivatePreparation();
    diagnostics.drawn = 0;
    diagnostics.glyphsDrawn = 0;
    diagnostics.pendingFits = 0;
    diagnostics.lastLabels = [];
    diagnostics.rejectedByVisibility = 0;
    diagnostics.rejectedByCollision = 0;
    diagnostics.rejectedByViewport = 0;
    diagnostics.noFit = 0;
    diagnostics.rejectedLabels = [];
    diagnostics.skippedByVisibilityUpperBound = 0;
    if (interactive || state.styleConfig?.countryLabels?.enabled === false || !(k > 0)) return 0;
    const context = getContext();
    const projection = getProjection();
    const source = getCountryLabelSource();
    const viewport = getViewportSize();
    const paintBounds = getPaintBounds() || { minX: 0, minY: 0, maxX: viewport.width, maxY: viewport.height };
    if (!context || !projection || source?.status !== "ready" || !(viewport.width > 0 && viewport.height > 0)) return 0;
    const rawTransform = getTransform() || {};
    const transform = { x: Number(rawTransform.x) || 0, y: Number(rawTransform.y) || 0, k };
    const language = String(getLanguage() || "en");
    const isChinese = language.startsWith("zh");
    const font = isChinese ? CHINESE_FONT : ENGLISH_FONT;
    const hierarchy = getMapLabelHierarchy(k, state);
    const geometry = getGeometry(source, projection);
    const records = new Map((source.countries || []).map((record) => [record.countryCode, record]));
    const fitView = { records, language, font, transform, paintBounds, projection, isChinese,
      geometry, textGeneration, countries: source.countries, viewport: { ...viewport } };
    const deferred = typeof helpers.onInvalidate === "function";
    const pending = [];
    const reject = (entry, text, fontSizePx, reason, visibleArea) => {
      const counter = reason === "noFit" ? "noFit" : `rejectedBy${reason}`;
      diagnostics[counter] += 1;
      diagnostics.rejectedLabels.push({ countryCode: entry.countryCode, text, fontSizePx, reason, visibleArea });
      diagnostics.rejectedLabels.sort((a, b) => b.visibleArea - a.visibleArea);
      diagnostics.rejectedLabels.length = Math.min(8, diagnostics.rejectedLabels.length);
    };
    context.save();
    try {
      context.textAlign = "left";
      context.textBaseline = "alphabetic";
      context.lineJoin = "round";
      const onInvisible = (entry, text) => {
        diagnostics.skippedByVisibilityUpperBound++;
        reject(entry, text, null, "Visibility", visibleTerritoryArea(entry, transform, paintBounds));
      };
      const fitted = geometry.entries.map((entry) => {
        const request = getViewFitRequest(entry, fitView, onInvisible);
        if (!request) return null;
        const { text, key } = request;
        if (!entry.polygons) {
          pending.push(request);
          return null;
        }
        let fit = entry.fits.get(key);
        if (!entry.fits.has(key) && deferred) {
          pending.push({ entry, text, key });
          return null;
        } else if (!entry.fits.has(key)) {
          prepareFit(entry, context, text, key, isChinese, font, fitView);
          fit = entry.fits.get(key);
        }
        const visibleArea = visibleTerritoryArea(entry, transform, paintBounds);
        if (!fit) reject(entry, text, null, "noFit", visibleArea);
        if (!fit) return null;
        // Rank by whole territory, not its visible part, so panning never
        // reorders priorities or moves a title between components.
        const groups = (fit.componentFits?.length ? fit.componentFits : [fit]).slice(0, 3).map((group) => {
          const component = entry.components.find((part) => part.polygonIndex === group.polygonIndex)
            || entry.components[0];
          return { fit: group, component, area: component?.area || 0 };
        }).sort((a, b) => b.area - a.area);
        return { entry, fit, groups, text, visibleArea, area: groups[0]?.area || 0 };
      }).filter(Boolean).sort((a, b) => b.area - a.area
        || String(a.entry.countryCode).localeCompare(String(b.entry.countryCode)));
      for (const { entry, fit: primaryFit, groups, text, visibleArea } of fitted) {
        let placement = null;
        let reason = "Visibility";
        // A blocked mainland title must not jump to a minor overseas territory.
        // Only a mainland title wholly off screen yields to the next component.
        const dominantOnly = groups.length > 1 && groups[0].area > groups[1].area * 2.5;
        for (const [groupIndex, group] of groups.entries()) {
          let groupOnScreen = false;
          for (const fit of [group.fit, ...(group.fit.alternatives || []).slice(0, 3)]) {
            const countryOpacity = getCountryLabelOpacity(hierarchy, group.area * k ** 2, viewport.width * viewport.height);
            const alpha = getVisibilityAlpha(fit.fontSize * k) * countryOpacity;
            if (alpha < 0.05) continue;
            const inkBoxes = fit.glyphs.filter((glyph) => glyph.text.trim())
              .map((glyph) => screenBox(glyph.box, transform, 0));
            const boxes = fit.glyphs.filter((glyph) => glyph.text.trim())
              .map((glyph) => screenBox(glyph.box, transform, 1.5));
            // Titles may run past the edge like printed map lettering; only
            // a title with no ink in the paint area is skipped.
            if (!inkBoxes.length || inkBoxes.some((box) => ![box.x, box.y, box.w, box.h].every(Number.isFinite))
              || inkBoxes.every((box) => box.x + box.w < paintBounds.minX || box.y + box.h < paintBounds.minY
                || box.x > paintBounds.maxX || box.y > paintBounds.maxY)) {
              reason = "Viewport";
              continue;
            }
            groupOnScreen = true;
            if (boxes.some((box) => occupiedBoxes.some((occupied) => doScreenLabelBoxesOverlap(box, occupied)))) {
              reason = "Collision";
              continue;
            }
            placement = { fit, alpha, boxes };
            break;
          }
          if (placement || (groupIndex === 0 && dominantOnly && groupOnScreen)) break;
        }
        if (!placement) {
          reject(entry, text, primaryFit.fontSize * k, reason, visibleArea);
          continue;
        }
        const { fit, alpha, boxes } = placement;
        occupiedBoxes.push(...boxes);
        context.font = `${fontWeight(font)} ${fit.fontSize}px ${font}`;
        context.globalAlpha = alpha;
        // The halo is part of the lettering and scales with it.
        context.lineWidth = fit.fontSize * 0.14;
        const colors = getCountryLabelColors(entry.countryCode);
        context.strokeStyle = colors.stroke;
        context.fillStyle = colors.fill;
        const glyphs = fit.glyphs.filter((glyph) => glyph.text.trim());
        // Stroke every glyph before filling so a halo never covers a neighbor.
        for (const paint of ["strokeText", "fillText"]) {
          for (const glyph of glyphs) {
            context.save();
            context.translate(glyph.x, glyph.y);
            context.rotate(glyph.angle);
            context[paint](glyph.text, 0, 0);
            context.restore();
          }
        }
        diagnostics.glyphsDrawn += glyphs.length;
        diagnostics.drawn += 1;
        diagnostics.lastLabels.push({ countryCode: entry.countryCode, text,
          fontSizePx: fit.fontSize * k, alpha, candidateIndex: fit.candidateIndex, polygonIndex: fit.polygonIndex,
          candidateKind: fit.candidateKind,
          lineCount: fit.lineCount || 1,
          bounds: screenBox(fit.bounds, transform, 0) });
      }
    } finally {
      context.restore();
    }
    diagnostics.pendingFits = pending.length;
    const nextPreparation = pending.find(({ entry, key }) => !entry.workerPending.has(key)
      && entry.workerPending.size < MAX_CACHED_FITS && canQueueEntry(entry));
    if (privatePreparation) advancePrivatePreparation();
    else if (!workerFailed && nextPreparation && !scheduledContinuation && workerRequests.size < MAX_PENDING_WORKER_FITS) {
      const continuation = {};
      scheduledContinuation = continuation;
      scheduleWork(() => {
        if (scheduledContinuation !== continuation) return;
        scheduledContinuation = null;
        if (geometryCache !== geometry || getProjection() !== projection
          || getProjectionIdentity() !== geometry.identity
          || state.styleConfig?.countryLabels?.enabled === false) return;
        const latestSource = getCountryLabelSource();
        if (latestSource?.sourceToken !== geometry.sourceToken || latestSource.revision !== geometry.revision) return;
        preparePendingFits(pending, fitView);
        helpers.onInvalidate?.();
      });
    }
    return diagnostics.drawn;
  }

  function getPendingFitsForCurrentView(source) {
    if (state.styleConfig?.countryLabels?.enabled === false) return 0;
    source ??= getCountryLabelSource();
    if (source?.status === "disabled") return 0;
    if (source?.status !== "ready") return 1;
    if (!geometryCache || geometryCache.sourceToken !== source.sourceToken
      || geometryCache.revision !== source.revision || geometryCache.projection !== getProjection()
      || geometryCache.identity !== getProjectionIdentity()) return Math.max(1, source.countries?.length || 0);
    const language = String(getLanguage() || "en");
    const font = language.startsWith("zh") ? CHINESE_FONT : ENGLISH_FONT;
    const records = new Map((source.countries || []).map((record) => [record.countryCode, record]));
    const transform = getTransform() || { k: 1, x: 0, y: 0 };
    const viewport = getViewportSize();
    const paintBounds = getPaintBounds() || { minX: 0, minY: 0, maxX: viewport.width, maxY: viewport.height };
    return geometryCache.entries.reduce((count, entry) => {
      const text = displayText(records.get(entry.countryCode)?.name, language);
      if (!text) return count;
      if (!entry.polygons) return count + 1;
      if (!entry.bounds) return count;
      const box = screenBox(entry.bounds, transform, 0);
      if (box.x + box.w < paintBounds.minX + 2 || box.y + box.h < paintBounds.minY + 2 || box.x > paintBounds.maxX - 2 || box.y > paintBounds.maxY - 2) return count;
      if (isCountryLabelDefinitelyInvisible(entry, transform, paintBounds)) return count;
      return count + Number(!entry.fits.has(getFitKey(text, language, font)));
    }, 0);
  }

  return {
    drawCountryLabels,
    prepareCurrentView,
    cancelPreparation: () => cancelPrivatePreparation(),
    clearTextCache() {
      cancelPrivatePreparation();
      textGeneration += 1;
      glyphMetrics.clear();
      for (const entry of geometryCache?.entries || []) entry.fits.clear();
    },
    isReadyForCurrentView: () => getPendingFitsForCurrentView() === 0 && diagnostics.workerErrors === 0,
    getReadinessForCurrentView(source) {
      const pendingFits = getPendingFitsForCurrentView(source);
      return { ready: pendingFits === 0 && diagnostics.workerErrors === 0, pendingFits,
        pendingWorkerFits: workerRequests.size, scheduled: scheduledContinuation !== null || !!privatePreparation?.scheduled,
        workerErrors: diagnostics.workerErrors };
    },
    getDiagnostics: () => ({ ...diagnostics, pendingFits: getPendingFitsForCurrentView(),
      cachedFits: (geometryCache?.entries || []).reduce((count, entry) => count + entry.fits.size, 0),
      pendingWorkerFits: workerRequests.size,
      privatePreparationPending: privatePreparation !== null,
      rejectedLabels: diagnostics.rejectedLabels.map((label) => ({ ...label })),
      lastLabels: diagnostics.lastLabels.map((label) => ({ ...label, bounds: { ...label.bounds } })) }),
  };
}

// Export callers must yield to the same source/layout workers as the screen.
// Keep preparation failures explicit rather than exporting an incomplete label pass.
export async function waitForCountryLabelsForExport({
  prepareSource, getSource, getDiagnostics, requestRender, isDisabled,
  wait = () => new Promise((resolve) => setTimeout(resolve, 16)),
  now = () => performance.now(), timeoutMs = 30000,
}) {
  if (isDisabled()) return;
  const started = now();
  await prepareSource();
  requestRender();
  for (;;) {
    if (isDisabled()) return;
    const source = getSource();
    if (source.status === "disabled") return;
    const layout = getDiagnostics();
    if (source.status === "error" || layout.workerErrors > 0) {
      throw new Error(source.error || "Country names failed to prepare for export.");
    }
    if (source.status === "ready" && layout.pendingFits === 0) return;
    if (now() - started >= timeoutMs) {
      throw new Error("Country names are still preparing; try exporting again when the labels are ready.");
    }
    await wait();
  }
}
