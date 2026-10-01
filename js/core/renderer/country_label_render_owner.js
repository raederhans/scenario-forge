import { buildCountryLabelCandidates, fitCountryLabel } from "./country_label_layout.js";
import { getProjectionGeometryGeneration } from "./projection_geometry_identity.js";
import { doScreenLabelBoxesOverlap } from "./screen_label_placement.js";

const ENGLISH_FONT = '"Libre Baskerville", "Palatino Linotype", Georgia, serif';
const CHINESE_FONT = '"Noto Serif SC", "Source Han Serif SC", "Microsoft YaHei", "PingFang SC", serif';
const METRIC_FONT_SIZE = 100;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

function ringArea(ring) {
  return Math.abs(ring.reduce((sum, point, index) => {
    const next = ring[(index + 1) % ring.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0)) / 2;
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
  const nodes = rings.map((ring) => ({ ring, area: ringArea(ring), parent: null, depth: 0 }))
    .filter((node) => node.area > 1e-8).sort((a, b) => b.area - a.area);
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    for (let prior = index - 1; prior >= 0; prior -= 1) {
      if (ringContains(nodes[prior].ring, node.ring[0])) {
        node.parent = nodes[prior];
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

function getVisibilityAlpha(fontSizePx) {
  const reveal = clamp((fontSizePx - 8) / 4, 0, 1);
  const fade = clamp((56 - fontSizePx) / 22, 0, 1);
  return reveal * fade * 0.78;
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

export function createCountryLabelRenderOwner({ state = {}, getters = {}, helpers = {} } = {}) {
  const {
    getContext = () => null,
    getProjection = () => null,
    getProjectionIdentity = () => getProjectionGeometryGeneration(getProjection()),
    getViewportSize = () => ({ width: 0, height: 0 }),
    getTransform = () => state.zoomTransform || { x: 0, y: 0, k: 1 },
    getLanguage = () => state.currentLanguage || state.language || "en",
    getCountryLabelSource = () => null,
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
  };

  function projectEntry(entry, projection, budget = Infinity) {
    const start = nowMs();
    const geoStream = helpers.geoStream || getD3()?.geoStream;
    do {
      if (entry.polygonCursor >= entry.inputPolygons.length) {
        entry.polygons = entry.projectedPolygons;
        entry.bounds = polygonBounds(entry.polygons);
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
      pending.entry.fits.set(pending.key, null);
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
        if (request.geometry !== geometryCache || request.textGeneration !== textGeneration) return;
        if (data.error) {
          request.entry.fits.set(request.key, null);
          failWorker(data.error);
        } else {
          request.entry.fits.set(request.key, data.fit);
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

  function prepareFit(entry, context, text, key, isChinese, font) {
    const options = {
      glyphs: getGlyphMetrics(context, text, font), glyphPadding: 0.15,
      minFontSize: 0.6, maxFontSize: 28, tracking: isChinese ? 0.12 : 0.08,
      preferredCandidateIndex: entry.previousFit?.candidateIndex,
    };
    const worker = typeof helpers.onInvalidate === "function" ? getLayoutWorker() : null;
    if (workerFailed) {
      entry.fits.set(key, null);
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
    if (!entry.candidates) {
      entry.candidates = buildCandidates(entry.polygons);
      diagnostics.candidateBuilds += 1;
      diagnostics.candidateCount += entry.candidates.length;
    }
    const fit = entry.candidates.length ? fitLabel(entry.candidates, { ...options, polygons: entry.polygons }) : null;
    diagnostics.fitBuilds += 1;
    entry.fits.set(key, fit);
    if (fit) entry.previousFit = fit;
  }

  function getGlyphMetrics(context, text, font) {
    const key = `${font}\n${text}`;
    if (glyphMetrics.has(key)) return glyphMetrics.get(key);
    context.font = `400 ${METRIC_FONT_SIZE}px ${font}`;
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
        polygons: null, bounds: null, candidates: null, fits: new Map(), previousFit: null,
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
    const geometry = getGeometry(source, projection);
    const records = new Map((source.countries || []).map((record) => [record.countryCode, record]));
    const deferred = typeof helpers.onInvalidate === "function";
    const pending = [];
    context.save();
    try {
      context.textAlign = "left";
      context.textBaseline = "alphabetic";
      context.lineJoin = "round";
      const fitted = geometry.entries.map((entry) => {
        const text = String(records.get(entry.countryCode)?.name || "").trim();
        if (!text) return null;
        const key = `${textGeneration}\n${language}\n${font}\n${text}`;
        if (!entry.polygons) {
          pending.push({ entry, text, key });
          return null;
        }
        if (!entry.bounds) return null;
        const countryBox = screenBox(entry.bounds, transform, 0);
        if (countryBox.x + countryBox.w < 2 || countryBox.y + countryBox.h < 2
          || countryBox.x > viewport.width - 2 || countryBox.y > viewport.height - 2) return null;
        if (!entry.fits.has(key) && deferred) {
          pending.push({ entry, text, key });
          return null;
        }
        if (!entry.fits.has(key)) {
          prepareFit(entry, context, text, key, isChinese, font);
        }
        const fit = entry.fits.get(key);
        return fit ? { entry, fit, text } : null;
      }).filter(Boolean).sort((a, b) => b.fit.fontSize - a.fit.fontSize
        || String(a.entry.countryCode).localeCompare(String(b.entry.countryCode)));
      for (const { entry, fit, text } of fitted) {
        const alpha = getVisibilityAlpha(fit.fontSize * k);
        if (alpha < 0.05) continue;
        const boxes = fit.glyphs.filter((glyph) => glyph.text.trim())
          .map((glyph) => screenBox(glyph.box, transform, 1.5));
        if (!boxes.length || boxes.some((box) => ![box.x, box.y, box.w, box.h].every(Number.isFinite)
          || box.x < 2 || box.y < 2 || box.x + box.w > viewport.width - 2
          || box.y + box.h > viewport.height - 2
          || occupiedBoxes.some((occupied) => doScreenLabelBoxesOverlap(box, occupied)))) continue;
        occupiedBoxes.push(...boxes);
        context.font = `400 ${fit.fontSize}px ${font}`;
        context.globalAlpha = alpha;
        context.lineWidth = 2.4 / k;
        context.strokeStyle = "rgba(255, 252, 241, 0.86)";
        context.fillStyle = "#343630";
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
          fontSizePx: fit.fontSize * k, alpha, candidateIndex: fit.candidateIndex,
          bounds: screenBox(fit.bounds, transform, 0) });
      }
    } finally {
      context.restore();
    }
    diagnostics.pendingFits = pending.length;
    const nextPreparation = pending.find(({ entry, key }) => !entry.workerPending.has(key));
    if (nextPreparation && !scheduledContinuation) {
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
        const { entry, text, key } = nextPreparation;
        const start = nowMs();
        if (!entry.polygons) projectEntry(entry, projection, 12);
        if (entry.polygons && entry.bounds && nowMs() - start < 12 && !entry.fits.has(key)) {
          target.save();
          try { prepareFit(entry, target, text, key, isChinese, font); }
          finally { target.restore(); }
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
    return geometryCache.entries.reduce((count, entry) => {
      const text = String(records.get(entry.countryCode)?.name || "").trim();
      if (!text) return count;
      if (!entry.polygons) return count + 1;
      if (!entry.bounds) return count;
      const box = screenBox(entry.bounds, transform, 0);
      if (box.x + box.w < 2 || box.y + box.h < 2 || box.x > viewport.width - 2 || box.y > viewport.height - 2) return count;
      return count + Number(!entry.fits.has(`${textGeneration}\n${language}\n${font}\n${text}`));
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
      lastLabels: diagnostics.lastLabels.map((label) => ({ ...label, bounds: { ...label.bounds } })) }),
  };
}
