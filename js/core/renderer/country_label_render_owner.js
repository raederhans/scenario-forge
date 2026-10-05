import { buildCountryLabelCandidates, filterCountryLabelHoles, fitCountryLabel } from "./country_label_layout.js";
import { getProjectionGeometryGeneration } from "./projection_geometry_identity.js";
import { doScreenLabelBoxesOverlap } from "./screen_label_placement.js";
import { getMapLabelHierarchy, getCountryLabelOpacity } from "./map_label_hierarchy.js";

const ENGLISH_FONT = '"Map Garamond", "Palatino Linotype", Georgia, serif';
const CHINESE_FONT = '"Map Noto Serif SC", "Noto Serif SC", "Songti SC", SimSun, serif';
const fontWeight = (font) => font === CHINESE_FONT ? 400 : 500;
const displayText = (name, language) => {
  const text = String(name || "").trim();
  // Full capitals suit short titles; retain the supplied case of multiword
  // names so long English labels do not pay an avoidable width penalty.
  return language.startsWith("en") && !/\s/u.test(text) ? text.toLocaleUpperCase("en") : text;
};
const METRIC_FONT_SIZE = 100;
const MAX_CACHED_FITS = 4;
const MAX_PENDING_WORKER_FITS = 8;
// Subpixel interior slivers from mixed-resolution borders must not sever a
// label baseline. Reintroduce each hole once it reaches one screen pixel.
const MIN_LABEL_HOLE_SCREEN_AREA = 1;
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

function ringContains(ring, [x, y]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function groupProjectedRings(rings) {
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
      if (ringContains(candidate.ring, node.ring[0])) {
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

function getZoomBand(k) {
  // Four bands per doubling keep the refit step below 19%. Size limits are
  // expressed at the band's upper end, so no in-band zoom can exceed the cap.
  const index = Math.floor(Math.log2(k) * 4 + 1e-9);
  const upperScale = 2 ** ((index + 1) / 4);
  const screenFontLimit = clamp(20 + 3 * Math.log2(Math.max(1, upperScale)), 20, 32);
  return { index, upperScale, minFontSize: 0.6 / upperScale, maxFontSize: screenFontLimit / upperScale };
}

function getVisibilityAlpha(fontSizePx, visibleArea) {
  // Territory controls the hierarchy; name length only gates legibility.
  // Once readable, larger labels never disappear merely because of their size.
  const territoryReveal = clamp((Math.sqrt(visibleArea) - 28) / 32, 0, 1);
  const readable = clamp((fontSizePx - 8) / 2, 0, 1);
  return territoryReveal * readable * 0.9;
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
  const width = Math.max(0, Math.min(viewport.width, box.x + box.w) - Math.max(0, box.x));
  const height = Math.max(0, Math.min(viewport.height, box.y + box.h) - Math.max(0, box.y));
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

export function createCountryLabelRenderOwner({ state = {}, getters = {}, helpers = {} } = {}) {
  const {
    getContext = () => null,
    getProjection = () => null,
    getProjectionIdentity = () => getProjectionGeometryGeneration(getProjection()),
    getViewportSize = () => ({ width: 0, height: 0 }),
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
  let layoutWorker = null;
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
  const diagnostics = {
    geometryBuilds: 0, candidateBuilds: 0, fitBuilds: 0, metricBuilds: 0,
    projectedCountries: 0, candidateCount: 0, drawn: 0, glyphsDrawn: 0, pendingFits: 0, lastLabels: [],
    workerFits: 0, workerErrors: 0, lastWorkerError: "",
    rejectedByVisibility: 0, rejectedByCollision: 0, rejectedByViewport: 0, noFit: 0, rejectedLabels: [],
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

  function failWorker(error) {
    diagnostics.workerErrors += 1;
    diagnostics.lastWorkerError = String(error?.message || error || "country label layout worker failed");
    workerFailed = true;
    layoutWorker?.terminate();
    layoutWorker = null;
    for (const pending of workerRequests.values()) {
      clearRequestTimeout(pending.timeout);
      pending.entry.workerPending.delete(pending.key);
      storeFit(pending.entry, pending.key, null);
    }
    workerRequests.clear();
  }

  function getLayoutWorker() {
    if (layoutWorker || workerFailed) return layoutWorker;
    const createWorker = helpers.createWorker || (typeof globalThis.Worker === "function"
      ? () => new Worker(new URL("./country_label_layout_worker.js", import.meta.url), { type: "module" }) : null);
    if (!createWorker) return null;
    try {
      layoutWorker = createWorker();
      const ownedWorker = layoutWorker;
      layoutWorker.onmessage = ({ data }) => {
        if (layoutWorker !== ownedWorker) return;
        const request = workerRequests.get(data.requestId);
        if (!request) return;
        clearRequestTimeout(request.timeout);
        workerRequests.delete(data.requestId);
        request.entry.workerPending.delete(request.key);
        if (request.geometry !== geometryCache || request.textGeneration !== textGeneration) {
          helpers.onInvalidate?.();
          return;
        }
        if (data.error) {
          storeFit(request.entry, request.key, null);
          failWorker(data.error);
        } else {
          storeFit(request.entry, request.key, data.fit);
          if (data.fit) request.entry.previousFit = data.fit;
          diagnostics.fitBuilds += 1;
          diagnostics.workerFits += 1;
          if (data.candidateBuilt) {
            diagnostics.candidateBuilds += 1;
            diagnostics.candidateCount += data.candidateCount;
          }
        }
        helpers.onInvalidate?.();
      };
      layoutWorker.onerror = (error) => {
        if (layoutWorker !== ownedWorker) return;
        failWorker(error);
        helpers.onInvalidate?.();
      };
      layoutWorker.onmessageerror = () => {
        if (layoutWorker !== ownedWorker) return;
        failWorker(new Error("Country label worker response could not be decoded."));
        helpers.onInvalidate?.();
      };
    } catch (error) {
      failWorker(error);
    }
    return layoutWorker;
  }

  function prepareFit(entry, context, text, key, isChinese, font, zoomBand) {
    const viewport = getViewportSize();
    const options = {
      glyphs: getGlyphMetrics(context, text, font), glyphPadding: 0.06,
      minFontSize: zoomBand.minFontSize, maxFontSize: zoomBand.maxFontSize, tracking: isChinese ? 0.03 : 0.015,
      maxTracking: isChinese ? 0.14 : 0.08,
      minHoleArea: MIN_LABEL_HOLE_SCREEN_AREA / zoomBand.upperScale ** 2,
      readableFontSize: 10 / (zoomBand.upperScale / 2 ** 0.25),
      preferredCandidateIndex: entry.previousFit?.candidateIndex,
      maxAlternatives: 3,
      maxTiltDegrees: 30, allowArcs: true,
      preferGentleArcs: true,
      minArcComponentArea: viewport.width * viewport.height * 0.035 / zoomBand.upperScale ** 2,
      maxArcTiltDegrees: isChinese ? 10 : 15, maxArcBendDegrees: isChinese ? 14 : 22,
      allowMultiline: true, allowPositionShift: true,
    };
    const worker = typeof helpers.onInvalidate === "function" ? getLayoutWorker() : null;
    if (workerFailed) {
      storeFit(entry, key, null);
      return;
    }
    if (worker) {
      const id = ++requestId;
      entry.workerPending.add(key);
      const timeout = setRequestTimeout(() => {
        if (!workerRequests.has(id)) return;
        failWorker(new Error("Country label layout worker timed out."));
        helpers.onInvalidate?.();
      }, 20_000);
      workerRequests.set(id, { geometry: geometryCache, entry, key, textGeneration, timeout });
      try {
        worker.postMessage({ requestId: id, generation: cacheGeneration, countryCode: entry.countryCode,
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
    if (fit) entry.previousFit = fit;
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
    const entries = (source.countries || []).map((record) => {
      const shape = record.geometry || record.feature?.geometry;
      const inputPolygons = shape?.type === "MultiPolygon" ? shape.coordinates
        : shape?.type === "Polygon" ? [shape.coordinates] : [];
      return { countryCode: record.countryCode, inputPolygons, projectedPolygons: [], polygonCursor: 0,
        polygons: null, bounds: null, components: [], candidates: null, fits: new Map(), previousFit: null,
        workerPending: new Set(), workerHasGeometry: false };
    });
    layoutWorker?.terminate();
    layoutWorker = null;
    for (const pending of workerRequests.values()) clearRequestTimeout(pending.timeout);
    workerRequests.clear();
    scheduledContinuation = null;
    // A failure stops this generation; a new scene or projection owns a fresh
    // attempt, so one crashed worker cannot poison the whole application.
    workerFailed = false;
    diagnostics.workerErrors = 0;
    diagnostics.lastWorkerError = "";
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

  function drawCountryLabels(k, { interactive = false, occupiedBoxes = [] } = {}) {
    diagnostics.drawn = 0;
    diagnostics.glyphsDrawn = 0;
    diagnostics.pendingFits = 0;
    diagnostics.lastLabels = [];
    diagnostics.rejectedByVisibility = 0;
    diagnostics.rejectedByCollision = 0;
    diagnostics.rejectedByViewport = 0;
    diagnostics.noFit = 0;
    diagnostics.rejectedLabels = [];
    if (interactive || state.styleConfig?.countryLabels?.enabled === false || !(k > 0)) return 0;
    const context = getContext();
    const projection = getProjection();
    const source = getCountryLabelSource();
    const viewport = getViewportSize();
    if (!context || !projection || source?.status !== "ready" || !(viewport.width > 0 && viewport.height > 0)) return 0;
    const rawTransform = getTransform() || {};
    const transform = { x: Number(rawTransform.x) || 0, y: Number(rawTransform.y) || 0, k };
    const language = String(getLanguage() || "en");
    const isChinese = language.startsWith("zh");
    const font = isChinese ? CHINESE_FONT : ENGLISH_FONT;
    const zoomBand = getZoomBand(k);
    const hierarchy = getMapLabelHierarchy(k, state);
    const geometry = getGeometry(source, projection);
    const records = new Map((source.countries || []).map((record) => [record.countryCode, record]));
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
      const fitted = geometry.entries.map((entry) => {
        const text = displayText(records.get(entry.countryCode)?.name, language);
        if (!text) return null;
        const key = `${textGeneration}\n${language}\n${font}\n${text}\n${zoomBand.index}`;
        if (!entry.polygons) {
          pending.push({ entry, text, key });
          return null;
        }
        if (!entry.bounds) return null;
        const countryBox = screenBox(entry.bounds, transform, 0);
        if (countryBox.x + countryBox.w < 2 || countryBox.y + countryBox.h < 2
          || countryBox.x > viewport.width - 2 || countryBox.y > viewport.height - 2) return null;
        let fit = entry.fits.get(key);
        if (!entry.fits.has(key) && deferred) {
          pending.push({ entry, text, key });
          const textKey = key.slice(0, key.lastIndexOf("\n") + 1);
          // A pending band may retain a validated fit of the same text/font.
          // No coordinates are resized, and readiness still waits for the
          // requested band. Oversized old fits cannot bypass the screen cap.
          fit = [...entry.fits].reverse().find(([cachedKey, cachedFit]) =>
            cachedKey.startsWith(textKey) && cachedFit && cachedFit.fontSize * k <= 32
            && (cachedFit.minHoleArea || 0) <= MIN_LABEL_HOLE_SCREEN_AREA / zoomBand.upperScale ** 2)?.[1];
          if (!fit) return null;
        } else if (!entry.fits.has(key)) {
          prepareFit(entry, context, text, key, isChinese, font, zoomBand);
          fit = entry.fits.get(key);
        }
        const visibleArea = visibleTerritoryArea(entry, transform, viewport);
        if (!fit) reject(entry, text, null, "noFit", visibleArea);
        if (!fit) return null;
        const groups = (fit.componentFits?.length ? fit.componentFits : [fit]).slice(0, 3).map((group) => {
          const component = entry.components.find((part) => part.polygonIndex === group.polygonIndex)
            || entry.components[0];
          return { fit: group, component, visibleArea: visibleComponentArea(component, transform, viewport) };
        }).sort((a, b) => b.visibleArea - a.visibleArea || (b.component?.area || 0) - (a.component?.area || 0));
        return { entry, fit, groups, text, visibleArea: groups[0]?.visibleArea || 0 };
      }).filter(Boolean).sort((a, b) => b.visibleArea - a.visibleArea
        || String(a.entry.countryCode).localeCompare(String(b.entry.countryCode)));
      for (const { entry, fit: primaryFit, groups, text, visibleArea } of fitted) {
        let placement = null;
        let reason = "Visibility";
        const dominant = groups[0];
        // A blocked mainland title must not jump to a minor overseas territory
        // while the mainland still dominates this view. Panning away restores
        // the independently prepared overseas placements.
        const placementGroups = dominant && groups.length > 1
          && dominant.visibleArea >= (dominant.component?.area || 0) * k ** 2 * 0.5
          && dominant.visibleArea > groups[1].visibleArea * 2.5 ? [dominant] : groups;
        const placements = placementGroups.flatMap((group) => [group.fit, ...(group.fit.alternatives || []).slice(0, 3)]
          .map((fit) => ({ ...group, fit })));
        for (const { fit, component, visibleArea: componentArea } of placements) {
          if (fit.fontSize * k > 32 || (fit.minHoleArea || 0) > MIN_LABEL_HOLE_SCREEN_AREA / zoomBand.upperScale ** 2) continue;
          const countryOpacity = getCountryLabelOpacity(hierarchy, (component?.area || 0) * k ** 2, viewport.width * viewport.height);
          const alpha = getVisibilityAlpha(fit.fontSize * k, componentArea) * countryOpacity;
          if (alpha < 0.05) continue;
          // Viewport checks use fitted glyph bounds. Collision padding
          // alone should not make an otherwise complete edge label disappear.
          const inkBoxes = fit.glyphs.filter((glyph) => glyph.text.trim())
            .map((glyph) => screenBox(glyph.box, transform, 0));
          const boxes = fit.glyphs.filter((glyph) => glyph.text.trim())
            .map((glyph) => screenBox(glyph.box, transform, 1.5));
          if (!inkBoxes.length || inkBoxes.some((box) => ![box.x, box.y, box.w, box.h].every(Number.isFinite)
            || box.x < 0 || box.y < 0 || box.x + box.w > viewport.width
            || box.y + box.h > viewport.height)) {
            reason = "Viewport";
            continue;
          }
          if (boxes.some((box) => occupiedBoxes.some((occupied) => doScreenLabelBoxesOverlap(box, occupied)))) {
            reason = "Collision";
            continue;
          }
          placement = { fit, alpha, boxes };
          break;
        }
        if (!placement) {
          reject(entry, text, primaryFit.fontSize * k, reason, visibleArea);
          continue;
        }
        const { fit, alpha, boxes } = placement;
        occupiedBoxes.push(...boxes);
        context.font = `${fontWeight(font)} ${fit.fontSize}px ${font}`;
        context.globalAlpha = alpha;
        context.lineWidth = 0.45 / k;
        const colors = getCountryLabelColors(entry.countryCode);
        context.strokeStyle = colors.stroke;
        context.fillStyle = colors.fill;
        for (const glyph of fit.glyphs) {
          if (!glyph.text.trim()) continue;
          context.save();
          context.translate(glyph.x, glyph.y);
          context.rotate(glyph.angle);
          context.strokeText(glyph.text, 0, 0);
          context.fillText(glyph.text, 0, 0);
          context.restore();
          diagnostics.glyphsDrawn += 1;
        }
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
    const nextPreparation = pending.find(({ entry, key }) => !entry.workerPending.has(key) && entry.workerPending.size < MAX_CACHED_FITS);
    if (nextPreparation && !scheduledContinuation && workerRequests.size < MAX_PENDING_WORKER_FITS) {
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
        const target = getContext();
        if (!target) return;
        const start = nowMs();
        let prepared = 0;
        let remaining = 12;
        // Share one budget and repaint across several countries. One repaint
        // per country used to double the frames needed for worker completion.
        for (const { entry, text, key } of pending) {
          // The worker executes serially. Bound its queue so waiting requests
          // cannot expire behind unrelated countries or older zoom bands.
          if (workerRequests.size >= MAX_PENDING_WORKER_FITS) break;
          if (entry.workerPending.has(key) || entry.fits.has(key) || entry.workerPending.size >= MAX_CACHED_FITS) continue;
          if (prepared && (remaining <= 0 || prepared >= 8)) break;
          if (!entry.polygons) projectEntry(entry, projection, Math.max(0, remaining));
          const box = entry.bounds ? screenBox(entry.bounds, transform, 0) : null;
          const inViewport = box && !(box.x + box.w < 2 || box.y + box.h < 2
            || box.x > viewport.width - 2 || box.y > viewport.height - 2);
          if (entry.polygons && inViewport && nowMs() - start < 12) {
            target.save();
            try { prepareFit(entry, target, text, key, isChinese, font, zoomBand); }
            finally { target.restore(); }
          }
          prepared += 1;
          remaining = 12 - (nowMs() - start);
        }
        helpers.onInvalidate?.();
      });
    }
    return diagnostics.drawn;
  }

  function getPendingFitsForCurrentView() {
    if (state.styleConfig?.countryLabels?.enabled === false) return 0;
    const source = getCountryLabelSource();
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
    const zoomBand = getZoomBand(Number(transform.k) || 1);
    return geometryCache.entries.reduce((count, entry) => {
      const text = displayText(records.get(entry.countryCode)?.name, language);
      if (!text) return count;
      if (!entry.polygons) return count + 1;
      if (!entry.bounds) return count;
      const box = screenBox(entry.bounds, transform, 0);
      if (box.x + box.w < 2 || box.y + box.h < 2 || box.x > viewport.width - 2 || box.y > viewport.height - 2) return count;
      return count + Number(!entry.fits.has(`${textGeneration}\n${language}\n${font}\n${text}\n${zoomBand.index}`));
    }, 0);
  }

  return {
    drawCountryLabels,
    clearTextCache() {
      textGeneration += 1;
      glyphMetrics.clear();
      for (const entry of geometryCache?.entries || []) entry.fits.clear();
    },
    isReadyForCurrentView: () => getPendingFitsForCurrentView() === 0 && diagnostics.workerErrors === 0,
    getDiagnostics: () => ({ ...diagnostics, pendingFits: getPendingFitsForCurrentView(),
      cachedFits: (geometryCache?.entries || []).reduce((count, entry) => count + entry.fits.size, 0),
      pendingWorkerFits: workerRequests.size,
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
