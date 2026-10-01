import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import { createCountryLabelRenderOwner, projectCountryLabelPolygons } from "../js/core/renderer/country_label_render_owner.js";
import { createCountryLabelLayoutWorkerHandler } from "../js/core/renderer/country_label_layout_worker.js";

const vendor = await readFile(new URL("../vendor/d3.v7.min.js", import.meta.url), "utf8");
const sandbox = {};
vm.runInNewContext(vendor, sandbox);
const d3 = sandbox.d3;

function createContext() {
  const events = [];
  const stack = [];
  return {
    events, font: "", globalAlpha: 1,
    save() { stack.push({ font: this.font, globalAlpha: this.globalAlpha }); },
    restore() { Object.assign(this, stack.pop()); },
    measureText(text) {
      events.push(["measure", text, this.font]);
      return { width: 60, actualBoundingBoxLeft: 4, actualBoundingBoxRight: 55,
        actualBoundingBoxAscent: 70, actualBoundingBoxDescent: 15 };
    },
    translate(x, y) { events.push(["translate", x, y]); },
    rotate(angle) { events.push(["rotate", angle]); },
    strokeText(text) { events.push(["stroke", text, this.font, this.globalAlpha, this.lineWidth]); },
    fillText(text) { events.push(["fill", text, this.font, this.globalAlpha]); },
  };
}

function createHarness({ names = ["AB"], fontSizes = [12], realLayout = false, helperOptions = {} } = {}) {
  const context = createContext();
  const state = { styleConfig: {}, zoomTransform: { x: 0, y: 0, k: 1 }, language: "en" };
  const projection = { stream: (sink) => sink };
  let projectionIdentity = 1;
  const source = { status: "ready", sourceToken: {}, revision: 1,
    countries: names.map((name, index) => ({ countryCode: `C${index}`, name,
      feature: { type: "Feature", geometry: { type: "Polygon", coordinates: [
        [[20 + index * 180, 20], [170 + index * 180, 20], [170 + index * 180, 170], [20 + index * 180, 170], [20 + index * 180, 20]],
      ] } } })) };
  const fitCalls = [];
  const timers = new Map();
  let timerId = 0;
  const helpers = { geoStream: d3.geoStream,
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); }, ...helperOptions };
  if (!realLayout) {
    helpers.buildCountryLabelCandidates = (polygons) => [{ polygons }];
    helpers.fitCountryLabel = (candidates, options) => {
      fitCalls.push(options);
      const offset = candidates[0].polygons[0][0][0][0] - 20;
      const fontSize = fontSizes[Math.round(offset / 180)] ?? 12;
      const glyphs = options.glyphs.map((glyph, index) => ({ text: glyph.text,
        x: 70 + offset + index * 12, y: 90, angle: index * 0.04,
        box: { x: 68 + offset + index * 12, y: 80, w: 8, h: 13 } }));
      return { fontSize, glyphs, candidateIndex: 0,
        bounds: { x: 68 + offset, y: 80, w: 8 + (glyphs.length - 1) * 12, h: 13 } };
    };
  }
  const owner = createCountryLabelRenderOwner({ state, helpers, getters: {
    getContext: () => context, getProjection: () => projection,
    getProjectionIdentity: () => projectionIdentity, getCountryLabelSource: () => source,
    getViewportSize: () => ({ width: 800, height: 700 }),
    getTransform: () => state.zoomTransform, getLanguage: () => state.language,
  } });
  return { owner, state, source, context, fitCalls, timers, setProjectionIdentity(value) { projectionIdentity = value; } };
}

test("projection streams split antimeridian exteriors and retain polygon holes", () => {
  const projection = d3.geoEquirectangular().scale(100).translate([400, 200]);
  const crossing = { type: "Polygon", coordinates: [[[170, -10], [170, 10], [-170, 10], [-170, -10], [170, -10]]] };
  const polygons = projectCountryLabelPolygons(crossing, projection, d3.geoStream);
  assert.equal(polygons.length, 2, "two clipped exterior rings cannot become an exterior and a hole");
  for (const polygon of polygons) {
    assert.equal(polygon.length, 1);
    const xs = polygon[0].map((point) => point[0]);
    assert.ok(Math.max(...xs) - Math.min(...xs) < 20, "date-line parts stay narrow");
  }
  const withHole = { type: "Polygon", coordinates: [
    [[0, 0], [0, 20], [20, 20], [20, 0], [0, 0]],
    [[5, 5], [15, 5], [15, 15], [5, 15], [5, 5]],
  ] };
  const projected = projectCountryLabelPolygons(withHole, projection, d3.geoStream);
  assert.equal(projected.length, 1);
  assert.equal(projected[0].length, 2);
});

test("pan and zoom reuse map geometry and text fits while repainting transformed glyphs", () => {
  const { owner, state, context, setProjectionIdentity } = createHarness();
  const occupied = [];
  assert.equal(owner.drawCountryLabels(1, { occupiedBoxes: occupied }), 1);
  assert.equal(occupied.length, 2, "each real glyph reserves its own box");
  const first = { ...occupied[0] };
  state.zoomTransform = { k: 1.2, x: 8, y: 5 };
  const next = [];
  assert.equal(owner.drawCountryLabels(1.2, { occupiedBoxes: next }), 1);
  assert.equal(next[0].x, (first.x + 1.5) * 1.2 + 8 - 1.5);
  assert.equal(owner.getDiagnostics().geometryBuilds, 1);
  assert.equal(owner.getDiagnostics().candidateBuilds, 1);
  assert.equal(owner.getDiagnostics().fitBuilds, 1);
  assert.equal(context.events.filter(([event]) => event === "measure").length, 2);
  assert.deepEqual(context.events.filter(([event]) => event === "translate")[0], ["translate", 70, 90]);
  setProjectionIdentity(2);
  owner.drawCountryLabels(1.2);
  assert.equal(owner.getDiagnostics().geometryBuilds, 2);
  assert.equal(owner.getDiagnostics().fitBuilds, 2);
});

test("disabled, interactive and pending draws do not build or measure labels", () => {
  const { owner, state, source, context } = createHarness();
  assert.equal(owner.drawCountryLabels(1, { interactive: true }), 0);
  state.styleConfig.countryLabels = { enabled: false };
  assert.equal(owner.drawCountryLabels(1), 0);
  state.styleConfig.countryLabels.enabled = true;
  source.status = "pending";
  assert.equal(owner.drawCountryLabels(1), 0);
  assert.equal(owner.getDiagnostics().geometryBuilds, 0);
  assert.equal(context.events.length, 0);
  source.status = "ready";
  assert.equal(owner.drawCountryLabels(1), 1);
});

test("normalized real glyph metrics, graphemes and language fonts participate in text cache", () => {
  const { owner, state, source, context, fitCalls } = createHarness({ names: ["A\u0301中"] });
  owner.drawCountryLabels(1);
  assert.equal(fitCalls[0].glyphs.length, 2);
  assert.deepEqual(fitCalls[0].glyphs[0], { text: "A\u0301", advance: 0.6, left: 0.04, right: 0.55, ascent: 0.7, descent: 0.15 });
  assert.equal(fitCalls[0].glyphPadding, 0.15);
  assert.ok(context.events.find(([event]) => event === "measure")[2].includes("100px"));
  state.language = "zh";
  source.countries[0].name = "中国";
  owner.drawCountryLabels(1);
  assert.equal(owner.getDiagnostics().geometryBuilds, 1);
  assert.equal(owner.getDiagnostics().fitBuilds, 2);
  assert.ok(context.events.filter(([event]) => event === "fill").at(-1)[2].includes("Microsoft YaHei"));
  owner.clearTextCache();
  assert.equal(owner.isReadyForCurrentView(), false);
  owner.drawCountryLabels(1);
  assert.equal(owner.getDiagnostics().geometryBuilds, 1);
  assert.equal(owner.getDiagnostics().candidateBuilds, 1);
  assert.equal(owner.getDiagnostics().fitBuilds, 3);
  assert.equal(owner.isReadyForCurrentView(), true);
});

test("fine glyph boxes allow gaps, but city collisions and viewport clipping reject full labels", () => {
  const { owner, state } = createHarness();
  assert.equal(owner.drawCountryLabels(1, { occupiedBoxes: [{ x: 77.6, y: 80, w: 0.8, h: 10 }] }), 1);
  assert.equal(owner.drawCountryLabels(1, { occupiedBoxes: [{ x: 69, y: 80, w: 2, h: 10 }] }), 0);
  state.zoomTransform.x = -70;
  assert.equal(owner.drawCountryLabels(1), 0);
  state.zoomTransform.x = -900;
  owner.clearTextCache();
  owner.drawCountryLabels(1);
  assert.equal(owner.getDiagnostics().fitBuilds, 1, "offscreen geography does not trigger a new fit");
});

test("large labels fade at high zoom while fitted small-country labels can reveal", () => {
  const { owner, state } = createHarness({ names: ["Large", "Small"], fontSizes: [28, 3] });
  assert.equal(owner.drawCountryLabels(1), 1);
  assert.equal(owner.getDiagnostics().lastLabels[0].countryCode, "C0");
  state.zoomTransform = { x: -650, y: -150, k: 3 };
  assert.equal(owner.drawCountryLabels(3), 1);
  assert.equal(owner.getDiagnostics().lastLabels[0].countryCode, "C1");
  assert.equal(owner.getDiagnostics().fitBuilds, 2, "zoom bands reuse the original fits");
});

test("geometry and fitting run in bounded deferred tasks while repaint stays free of preparation", () => {
  let now = 0;
  const callbacks = [];
  let invalidations = 0;
  const { owner } = createHarness({ names: ["A", "B", "C"], helperOptions: {
    nowMs: () => { now += 7; return now; },
    scheduleWork: (callback) => callbacks.push(callback),
    onInvalidate: () => { invalidations += 1; },
  } });
  owner.drawCountryLabels(1);
  assert.equal(owner.getDiagnostics().fitBuilds, 0);
  assert.equal(owner.getDiagnostics().projectedCountries, 0);
  assert.equal(owner.getDiagnostics().pendingFits, 3);
  owner.drawCountryLabels(1);
  assert.equal(callbacks.length, 1);
  callbacks.shift()();
  assert.equal(invalidations, 1);
  owner.drawCountryLabels(1);
  for (let turn = 0; turn < 12 && owner.getDiagnostics().pendingFits; turn += 1) {
    callbacks.shift()();
    owner.drawCountryLabels(1);
  }
  assert.equal(owner.getDiagnostics().fitBuilds, 3);
  assert.equal(owner.getDiagnostics().pendingFits, 0);
});

test("actual layout can render a complete projected country using measured glyph bounds", () => {
  const { owner, context } = createHarness({ names: ["TEST"], realLayout: true });
  assert.equal(owner.drawCountryLabels(1), 1);
  assert.equal(owner.getDiagnostics().glyphsDrawn, 4);
  assert.equal(context.events.filter(([event]) => event === "stroke").length, 4);
});

test("worker fits reuse projected geometry and discard responses after text or projection invalidation", () => {
  const callbacks = [];
  const messages = [];
  const workers = [];
  const handle = createCountryLabelLayoutWorkerHandler();
  const { owner, state, source, setProjectionIdentity } = createHarness({ names: ["TEST"], helperOptions: {
    onInvalidate() {}, scheduleWork: (callback) => callbacks.push(callback),
    createWorker() {
      const worker = { terminate() { this.terminated = true; }, postMessage(message) { messages.push(message); } };
      workers.push(worker);
      return worker;
    },
  } });
  owner.drawCountryLabels(1);
  callbacks.shift()();
  assert.equal(messages.length, 1);
  assert.equal(owner.getDiagnostics().fitBuilds, 0, "posting work does not imply a completed fit");
  workers[0].onmessage({ data: handle(messages.shift()) });
  assert.equal(owner.drawCountryLabels(1), 1);
  assert.equal(owner.getDiagnostics().workerFits, 1);
  assert.equal(owner.getDiagnostics().candidateBuilds, 1);
  state.language = "zh";
  source.countries[0].name = "中国";
  owner.drawCountryLabels(1);
  callbacks.shift()();
  assert.equal(messages[0].polygons, undefined, "worker retains immutable projected country geometry");
  const outdatedFontResult = handle(messages.shift());
  owner.clearTextCache();
  workers[0].onmessage({ data: outdatedFontResult });
  assert.equal(owner.getDiagnostics().workerFits, 1, "font changes reject older glyph metrics");
  owner.drawCountryLabels(1);
  callbacks.shift()();
  const outdatedProjectionResult = handle(messages.shift());
  setProjectionIdentity(2);
  owner.drawCountryLabels(1);
  assert.equal(workers[0].terminated, true);
  workers[0].onmessage({ data: outdatedProjectionResult });
  assert.equal(owner.getDiagnostics().workerFits, 1, "projection changes reject older fitted positions");
});

test("worker and structured clone errors remain observable without synchronous expensive fallback", () => {
  for (const cloneThrows of [false, true]) {
    const callbacks = [];
    let worker;
    const { owner, fitCalls } = createHarness({ helperOptions: {
      onInvalidate() {}, scheduleWork: (callback) => callbacks.push(callback),
      createWorker() {
        worker = { terminate() {}, postMessage() { if (cloneThrows) throw new Error("clone failed"); } };
        return worker;
      },
    } });
    owner.drawCountryLabels(1);
    callbacks.shift()();
    if (!cloneThrows) worker.onerror(new Error("worker failed"));
    owner.drawCountryLabels(1);
    assert.equal(fitCalls.length, 0);
    assert.equal(owner.getDiagnostics().workerErrors, 1);
    assert.equal(owner.getDiagnostics().pendingFits, 0);
    assert.equal(owner.isReadyForCurrentView(), false);
    assert.match(owner.getDiagnostics().lastWorkerError, cloneThrows ? /clone failed/ : /worker failed/);
  }
});

test("unanswered or undecodable layout requests fail and a new scene can recover", () => {
  for (const failure of ["timeout", "messageerror"]) {
    const callbacks = [], workers = [];
    const harness = createHarness({ realLayout: true, helperOptions: {
      onInvalidate() {}, scheduleWork: (callback) => callbacks.push(callback),
      createWorker() {
        const worker = { messages: [], terminate() { this.terminated = true; },
          postMessage(data) { this.messages.push(data); } };
        workers.push(worker);
        return worker;
      },
    } });
    const { owner, source, timers } = harness;
    owner.drawCountryLabels(1);
    callbacks.shift()();
    assert.equal(timers.size, 1);
    if (failure === "timeout") [...timers.values()][0]();
    else workers[0].onmessageerror();
    assert.equal(timers.size, 0);
    assert.equal(owner.getDiagnostics().pendingFits, 0);
    assert.equal(owner.getDiagnostics().workerErrors, 1);
    assert.equal(owner.isReadyForCurrentView(), false);
    owner.drawCountryLabels(1);
    assert.equal(callbacks.length, 0, "failed generation must not retry");
    source.sourceToken = {};
    source.revision++;
    owner.drawCountryLabels(1);
    callbacks.shift()();
    assert.equal(workers.length, 2);
    workers[0].onerror(new Error("late failure"));
    assert.equal(workers[1].terminated, undefined, "old worker cannot fail the new generation");
    const handle = createCountryLabelLayoutWorkerHandler();
    workers[1].onmessage({ data: handle(workers[1].messages[0]) });
    assert.equal(timers.size, 0);
    assert.equal(owner.getDiagnostics().workerErrors, 0);
    assert.equal(owner.isReadyForCurrentView(), true);
  }
});

test("projection replacement clears pending layout timers", () => {
  const callbacks = [];
  const { owner, timers, setProjectionIdentity } = createHarness({ helperOptions: {
    onInvalidate() {}, scheduleWork: (callback) => callbacks.push(callback),
    createWorker: () => ({ postMessage() {}, terminate() {} }),
  } });
  owner.drawCountryLabels(1);
  callbacks.shift()();
  assert.equal(timers.size, 1);
  setProjectionIdentity(2);
  owner.drawCountryLabels(1);
  assert.equal(timers.size, 0);
});

test("a stale idle callback cannot strand preparation after a projection change", () => {
  const callbacks = [];
  const { owner, setProjectionIdentity } = createHarness({ helperOptions: {
    onInvalidate() {}, scheduleWork: (callback) => callbacks.push(callback),
  } });
  owner.drawCountryLabels(1);
  setProjectionIdentity(2);
  owner.drawCountryLabels(1);
  assert.equal(callbacks.length, 2, "new projection schedules its own continuation immediately");
  callbacks.shift()();
  assert.equal(owner.getDiagnostics().fitBuilds, 0);
  callbacks.shift()();
  assert.equal(owner.getDiagnostics().fitBuilds, 1);
  assert.equal(owner.isReadyForCurrentView(), true);
});
