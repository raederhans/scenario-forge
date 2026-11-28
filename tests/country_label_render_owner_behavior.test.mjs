import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import { createCountryLabelRenderOwner, projectCountryLabelPolygons } from "../js/core/renderer/country_label_render_owner.js";

const vendor = await readFile(new URL("../vendor/d3.v7.min.js", import.meta.url), "utf8");
const sandbox = {};
vm.runInNewContext(vendor, sandbox);
const d3 = sandbox.d3;

function createContext() {
  return {
    save() {}, restore() {}, translate() {}, rotate() {}, strokeText() {}, fillText() {},
    measureText() {
      return { width: 60, actualBoundingBoxLeft: 4, actualBoundingBoxRight: 55,
        actualBoundingBoxAscent: 70, actualBoundingBoxDescent: 15 };
    },
  };
}

function createHarness({ helperOptions = {} } = {}) {
  const context = createContext();
  const state = { styleConfig: {}, zoomTransform: { x: 0, y: 0, k: 1 }, language: "en" };
  const projection = { stream: (sink) => sink };
  const source = { status: "ready", sourceToken: {}, revision: 1,
    countries: [{ countryCode: "C0", name: "AB",
      feature: { type: "Feature", geometry: { type: "Polygon", coordinates: [
        [[20, 20], [170, 20], [170, 170], [20, 170], [20, 20]],
      ] } } }] };
  const timers = new Map();
  let timerId = 0;
  const helpers = { geoStream: d3.geoStream, maxLayoutWorkers: 1, maxPendingPerWorker: 8,
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); }, ...helperOptions };
  helpers.buildCountryLabelCandidates = (polygons) => [{ polygons }];
  helpers.fitCountryLabel = (_candidates, options) => {
    const fontSize = Math.min(12, options.maxFontSize);
    const glyphs = options.glyphs.map((glyph, index) => ({ text: glyph.text,
      x: 70 + index * 12, y: 90, angle: index * 0.04,
      box: { x: 68 + index * 12, y: 80, w: 8, h: 13 } }));
    return { fontSize, glyphs, candidateIndex: 0,
      bounds: { x: 68, y: 80, w: 8 + (glyphs.length - 1) * 12, h: 13 } };
  };
  const owner = createCountryLabelRenderOwner({ state, helpers, getters: {
    getContext: () => context, getProjection: () => projection,
    getProjectionIdentity: () => 1, getCountryLabelSource: () => source,
    getViewportSize: () => ({ width: 800, height: 700 }),
    getTransform: () => state.zoomTransform, getLanguage: () => state.language,
  } });
  return { owner, state, source };
}

test("private source replacement settles old work and rejects stale worker fits", async () => {
  const callbacks = [], messages = [];
  let invalidations = 0;
  const h = createHarness({ helperOptions: { nowMs: () => 0,
    scheduleWork: callback => callbacks.push(callback), onInvalidate: () => invalidations++,
    createWorker() { const worker = { postMessage: message => messages.push({ worker, message }), terminate() {} };
      return worker; },
  } });
  const old = h.owner.prepareCurrentView(1);
  callbacks.shift()();
  const first = messages[0];
  h.source.sourceToken = {};
  h.source.revision++;
  const current = h.owner.prepareCurrentView(1);
  await old;
  first.worker.onmessage({ data: { requestId: first.message.requestId, fit: null } });
  assert.equal(invalidations, 0, "obsolete preparation never announces a publication");
  while (callbacks.length) callbacks.shift()();
  const last = messages.at(-1);
  assert.notEqual(last.message.requestId, first.message.requestId);
  last.worker.onmessage({ data: { requestId: last.message.requestId, fit: null } });
  await current;
  assert.equal(invalidations, 1);
  assert.equal(h.owner.isReadyForCurrentView(), true);
  assert.equal(h.owner.getDiagnostics().cachedFits, 1);
});

test("ring grouping preserves nested islands, concave gaps and boundary containment", () => {
  const rectangle = (x, y, size) => [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]];
  const exterior = rectangle(-20, -20, 20);
  const hole = rectangle(-18, -18, 10);
  const island = rectangle(-16, -16, 4);
  const islandHole = rectangle(-15, -15, 1);
  const concave = [[10, 0], [30, 0], [30, 4], [14, 4], [14, 20], [10, 20], [10, 0]];
  const inConcaveGap = rectangle(20, 10, 2);
  const onIncludedBoundary = rectangle(-20, -5, 1);
  const onExcludedBoundary = rectangle(0, -5, 1);
  const disjoint = Array.from({ length: 250 }, (_, index) => rectangle(100 + index * 3, -10, 1));
  const input = [islandHole, inConcaveGap, ...disjoint, hole, onExcludedBoundary, concave, island, onIncludedBoundary, exterior];
  const polygons = projectCountryLabelPolygons({}, { stream: (sink) => sink }, (_feature, sink) => {
    // Model a projection emitting many rings within one clipped polygon.
    sink.polygonStart();
    for (const ring of input) {
      sink.lineStart();
      for (const [x, y] of ring) sink.point(x, y);
      sink.lineEnd();
    }
    sink.polygonEnd();
  });
  assert.equal(polygons.length, disjoint.length + 5);
  assert.deepEqual(polygons.find(([ring]) => ring[0][0] === -20), [exterior, hole, onIncludedBoundary]);
  assert.deepEqual(polygons.find(([ring]) => ring[0][0] === -16), [island, islandHole]);
  assert.deepEqual(polygons.find(([ring]) => ring[0][0] === 10), [concave]);
  assert.deepEqual(polygons.find(([ring]) => ring[0][0] === 20), [inConcaveGap]);
  assert.deepEqual(polygons.find(([ring]) => ring[0][0] === 0), [onExcludedBoundary]);
});

test("fine glyph boxes allow gaps, city collisions reject titles", () => {
  const { owner } = createHarness();
  assert.equal(owner.drawCountryLabels(1, { occupiedBoxes: [{ x: 77.6, y: 80, w: 0.8, h: 10 }] }), 1);
  assert.equal(owner.drawCountryLabels(1, { occupiedBoxes: [{ x: 69, y: 80, w: 2, h: 10 }] }), 0);
});

test("pan and zoom repaint transformed glyph boxes", () => {
  const { owner, state } = createHarness();
  const occupied = [];
  assert.equal(owner.drawCountryLabels(1, { occupiedBoxes: occupied }), 1);
  const first = { ...occupied[0] };
  state.zoomTransform = { k: 1.15, x: 8, y: 5 };
  const next = [];
  assert.equal(owner.drawCountryLabels(1.15, { occupiedBoxes: next }), 1);
  assert.equal(next[0].x, (first.x + 1.5) * 1.15 + 8 - 1.5);
});
