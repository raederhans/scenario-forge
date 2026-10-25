import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import { createCountryLabelRenderOwner, groupProjectedRings, isCountryLabelDefinitelyInvisible, projectCountryLabelPolygons, waitForCountryLabelsForExport } from "../js/core/renderer/country_label_render_owner.js";
import { createCountryLabelLayoutWorkerHandler } from "../js/core/renderer/country_label_layout_worker.js";
import { fitCountryLabel } from "../js/core/renderer/country_label_layout.js";
import { getMapLabelHierarchy } from "../js/core/renderer/map_label_hierarchy.js";

const vendor = await readFile(new URL("../vendor/d3.v7.min.js", import.meta.url), "utf8");
const sandbox = {};
vm.runInNewContext(vendor, sandbox);
const d3 = sandbox.d3;

// Deliberately retain the original full-edge ray cast as the independent oracle.
function groupProjectedRingsNaively(rings) {
  const nodes = rings.map((ring) => {
    let sum = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let index = 0; index < ring.length; index++) {
      const point = ring[index], next = ring[(index + 1) % ring.length];
      sum += point[0] * next[1] - next[0] * point[1];
      minX = Math.min(minX, point[0]); minY = Math.min(minY, point[1]);
      maxX = Math.max(maxX, point[0]); maxY = Math.max(maxY, point[1]);
    }
    return { ring, area: Math.abs(sum) / 2, minX, minY, maxX, maxY, parent: null, depth: 0 };
  }).filter((node) => node.area > 1e-8).sort((a, b) => b.area - a.area);
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    const [x, y] = node.ring[0];
    for (let prior = index - 1; prior >= 0; prior--) {
      const candidate = nodes[prior];
      if (x < candidate.minX || x > candidate.maxX || y < candidate.minY || y > candidate.maxY) continue;
      let inside = false;
      for (let i = 0, j = candidate.ring.length - 1; i < candidate.ring.length; j = i++) {
        const [xi, yi] = candidate.ring[i], [xj, yj] = candidate.ring[j];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) { node.parent = candidate; node.depth = candidate.depth + 1; break; }
    }
  }
  const byExterior = new Map(nodes.filter((node) => node.depth % 2 === 0).map((node) => [node, [node.ring]]));
  for (const node of nodes) if (node.depth % 2 === 1) byExterior.get(node.parent)?.push(node.ring);
  return [...byExterior.values()];
}

function densifyRing(ring, subdivisions) {
  const result = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const [x, y] = ring[i], [nextX, nextY] = ring[i + 1];
    for (let step = 0; step < subdivisions; step++) {
      const t = step / subdivisions;
      result.push([x + (nextX - x) * t, y + (nextY - y) * t]);
    }
  }
  result.push([...ring[0]]);
  return result;
}

const squareRing = (x, y, size) => [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]];

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

function createHarness({ names = ["AB"], fontSizes = [12], alternatives = [], realLayout = false,
  viewportWidth = 800, helperOptions = {}, getPaintBounds = () => null } = {}) {
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
  // Existing scheduling fixtures model one legacy serial worker. Pool tests
  // below explicitly use the production four slots and two requests per slot.
  const helpers = { geoStream: d3.geoStream, maxLayoutWorkers: 1, maxPendingPerWorker: 8,
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); }, ...helperOptions };
  if (!realLayout) {
    helpers.buildCountryLabelCandidates = (polygons) => [{ polygons }];
    helpers.fitCountryLabel = (candidates, options) => {
      fitCalls.push(options);
      const offset = candidates[0].polygons[0][0][0][0] - 20;
      const fontSize = Math.min(fontSizes[Math.round(offset / 180)] ?? 12, options.maxFontSize);
      const glyphs = options.glyphs.map((glyph, index) => ({ text: glyph.text,
        x: 70 + offset + index * 12, y: 90, angle: index * 0.04,
        box: { x: 68 + offset + index * 12, y: 80, w: 8, h: 13 } }));
      return { fontSize, glyphs, candidateIndex: 0,
        alternatives: alternatives.map((dy, index) => ({ fontSize, candidateIndex: index + 1,
          glyphs: glyphs.map((glyph) => ({ ...glyph, y: glyph.y + dy, box: { ...glyph.box, y: glyph.box.y + dy } })),
          bounds: { x: 68 + offset, y: 80 + dy, w: 8 + (glyphs.length - 1) * 12, h: 13 } })),
        bounds: { x: 68 + offset, y: 80, w: 8 + (glyphs.length - 1) * 12, h: 13 } };
    };
  }
  const owner = createCountryLabelRenderOwner({ state, helpers, getters: {
    getContext: () => context, getProjection: () => projection,
    getProjectionIdentity: () => projectionIdentity, getCountryLabelSource: () => source,
    getViewportSize: () => ({ width: viewportWidth, height: 700 }), getPaintBounds,
    getTransform: () => state.zoomTransform, getLanguage: () => state.language,
  } });
  return { owner, state, source, context, fitCalls, timers,
    setProjectionIdentity(value) { projectionIdentity = value; }, setViewportWidth(value) { viewportWidth = value; } };
}

test("current-view readiness includes scheduled fits but does not wait for offscreen worker requests", () => {
  const callbacks = [], messages = [];
  const { owner, state, source, fitCalls } = createHarness({ helperOptions: {
    onInvalidate() {}, scheduleWork: callback => callbacks.push(callback),
    createWorker: () => ({ postMessage: message => messages.push(message), terminate() {} }),
  } });
  assert.equal(owner.getReadinessForCurrentView(source).ready, false);
  assert.equal(callbacks.length, 0, "observation never schedules projection or fitting");
  owner.drawCountryLabels(1);
  const scheduled = owner.getReadinessForCurrentView(source);
  assert.equal(scheduled.ready, false);
  assert.equal(scheduled.pendingFits, 1);
  assert.equal(scheduled.scheduled, true);
  assert.equal(scheduled.pendingWorkerFits, 0);
  callbacks.shift()();
  assert.equal(messages.length, 1);
  state.zoomTransform.x = -1000;
  const offscreen = owner.getReadinessForCurrentView(source);
  assert.equal(offscreen.pendingFits, 0);
  assert.equal(offscreen.pendingWorkerFits, 1);
  assert.equal(offscreen.ready, true, "an old view's worker does not block a complete current view");
  state.zoomTransform.x = 0;
  assert.equal(owner.getReadinessForCurrentView(source).ready, false);
  state.styleConfig.countryLabels = { enabled: false };
  assert.equal(owner.getReadinessForCurrentView(source).ready, true);
  assert.equal(messages.length, 1);
  assert.equal(fitCalls.length, 0);
});

test("visibility upper bound preserves threshold, unknown geometry and any potentially visible component", () => {
  const transform = { x: 0, y: 0, k: 1 }, viewport = { minX: 0, minY: 0, maxX: 800, maxY: 700 };
  // A fit's ink lies inside its component, so twice the longest side bounds
  // its screen font; alpha reaches 0.05 at 7 + 0.05 / 0.82 * 3 pixels.
  const thresholdSide = (7 + 0.05 / 0.82 * 3) / 2;
  const entry = (side, area = side * side) => ({ polygons: [[]], components: [{ area, bounds: { x: 20, y: 20, w: side, h: side / 3 } }] });
  assert.equal(isCountryLabelDefinitelyInvisible(entry(2), transform, viewport), true);
  assert.equal(isCountryLabelDefinitelyInvisible(entry(thresholdSide * (1 - 1e-10)), transform, viewport), true);
  assert.equal(isCountryLabelDefinitelyInvisible(entry(thresholdSide), transform, viewport), false,
    "the alpha=0.05 mathematical boundary still needs its exact fit");
  assert.equal(isCountryLabelDefinitelyInvisible(entry(2), { ...transform, k: 3 }, viewport), false,
    "magnification makes the same map-space title potentially legible");
  assert.equal(isCountryLabelDefinitelyInvisible(entry(1000), transform, viewport), false,
    "a large territory may still carry a smaller, unfaded title");
  const two = entry(2); two.components.push(entry(100).components[0]);
  assert.equal(isCountryLabelDefinitelyInvisible(two, transform, viewport), false);
  for (const unknown of [entry(2, NaN), entry(2, Infinity), { ...entry(2), polygons: null },
    { polygons: [[]], components: [] }, { polygons: [[]], components: [{ area: 4, bounds: { x: 0, y: 0, w: Infinity, h: 2 } }] }]) {
    assert.equal(isCountryLabelDefinitelyInvisible(unknown, transform, viewport), false);
  }
  assert.equal(isCountryLabelDefinitelyInvisible(entry(2), { ...transform, k: NaN }, viewport), false);
  assert.equal(isCountryLabelDefinitelyInvisible(entry(2), transform, { ...viewport, maxX: NaN }), false);
});

test("tiny countries skip worker fits and regain exact preparation when zoom makes them potentially visible", async () => {
  const callbacks = [], messages = [];
  let worker;
  const h = createHarness({ realLayout: true, helperOptions: { nowMs: () => 0,
    scheduleWork: callback => callbacks.push(callback), onInvalidate() {},
    createWorker: () => (worker = { postMessage: message => messages.push(message), terminate() {} }),
  } });
  h.source.countries[0].feature.geometry.coordinates = [squareRing(50, 50, 3)];
  const first = h.owner.prepareCurrentView(1);
  callbacks.shift()(); await first;
  assert.equal(messages.length, 0, "projected extent proves that even the largest possible title is illegible");
  assert.equal(h.owner.isReadyForCurrentView(), true);
  assert.equal(h.owner.drawCountryLabels(1), 0);
  assert.equal(h.owner.getDiagnostics().skippedByVisibilityUpperBound, 1);
  assert.equal(h.owner.getDiagnostics().cachedFits, 0, "view-specific exclusion never stores a permanent null fit");
  h.state.zoomTransform.k = 4;
  const enlarged = h.owner.prepareCurrentView(4);
  callbacks.shift()();
  assert.equal(messages.length, 1);
  worker.onmessage({ data: createCountryLabelLayoutWorkerHandler()(messages[0]) });
  await enlarged;
  assert.equal(h.owner.isReadyForCurrentView(), true);
  h.owner.drawCountryLabels(4);
  assert.equal(h.owner.getDiagnostics().skippedByVisibilityUpperBound, 0);
  assert.equal(h.owner.getDiagnostics().geometryBuilds, 1);
});

test("an offscreen country starts fitting after panning reveals the same geometry", async () => {
  const callbacks = [], messages = [];
  let worker;
  const h = createHarness({ helperOptions: { nowMs: () => 0,
    scheduleWork: callback => callbacks.push(callback), onInvalidate() {},
    createWorker: () => (worker = { postMessage: message => messages.push(message), terminate() {} }),
  } });
  h.source.countries[0].feature.geometry.coordinates = [squareRing(805, 50, 100)];
  const partial = h.owner.prepareCurrentView(1);
  callbacks.shift()(); await partial;
  assert.equal(messages.length, 0);
  assert.equal(h.owner.isReadyForCurrentView(), true);
  h.state.zoomTransform.x = -100;
  assert.equal(h.owner.isReadyForCurrentView(), false, "same-band panning must reevaluate visibility before readiness");
  const exposed = h.owner.prepareCurrentView(1);
  callbacks.shift()();
  assert.equal(messages.length, 1);
  worker.onmessage({ data: { requestId: messages[0].requestId, fit: null } });
  await exposed;
  assert.equal(h.owner.isReadyForCurrentView(), true);
  assert.equal(h.owner.getDiagnostics().geometryBuilds, 1);
});

test("private preparation replenishes its bounded worker queue without drawing or per-fit invalidation", async () => {
  const callbacks = [], messages = [];
  let worker, invalidations = 0;
  const { owner, context } = createHarness({ names: Array.from({ length: 12 }, (_, index) => `C${index}`),
    viewportWidth: 2400, helperOptions: { nowMs: () => 0,
      scheduleWork: callback => callbacks.push(callback), onInvalidate: () => invalidations++,
      createWorker: () => (worker = { postMessage: message => messages.push(message), terminate() {} }),
    } });
  const preparing = owner.prepareCurrentView(1);
  assert.ok(preparing instanceof Promise);
  assert.equal(owner.prepareCurrentView(1), preparing);
  assert.equal(messages.length, 0, "preflight only schedules a private slice");
  callbacks.shift()();
  assert.equal(messages.length, 8);
  assert.equal(owner.getDiagnostics().pendingWorkerFits, 8);
  for (const message of messages.slice(0, 4)) worker.onmessage({ data: { requestId: message.requestId, fit: null } });
  assert.equal(invalidations, 0);
  assert.equal(callbacks.length, 1, "worker replies refill the queue without another labels draw");
  callbacks.shift()();
  assert.equal(messages.length, 12);
  assert.equal(owner.getDiagnostics().pendingWorkerFits, 8);
  for (const message of messages.slice(4)) worker.onmessage({ data: { requestId: message.requestId, fit: null } });
  await preparing;
  assert.equal(invalidations, 1);
  assert.equal(owner.isReadyForCurrentView(), true, "null fits are completed exact layout outcomes");
  assert.equal(owner.prepareCurrentView(1), null);
  assert.equal(callbacks.length, 0);
  assert.equal(context.events.some(([event]) => event === "fill" || event === "stroke"), false);
});

test("four lazy country workers preserve exact results, stable geometry ownership and shared queue limits", async () => {
  const callbacks = [], workers = [], countrySlots = new Map();
  const oracle = createCountryLabelLayoutWorkerHandler();
  let uploads = 0, invalidations = 0;
  const h = createHarness({ names: Array.from({ length: 12 }, (_, index) => `C${index}`), viewportWidth: 2400,
    realLayout: true, helperOptions: { maxLayoutWorkers: 4, maxPendingPerWorker: 2, nowMs: () => 0,
      scheduleWork: callback => callbacks.push(callback), onInvalidate: () => invalidations++,
      createWorker({ index }) {
        const slot = { index, queue: [], terminated: false, handle: createCountryLabelLayoutWorkerHandler(),
          terminate() { this.terminated = true; }, postMessage(message) {
            assert.equal(index, Number(message.countryCode.slice(1)) % 4);
            if (countrySlots.has(message.countryCode)) assert.equal(countrySlots.get(message.countryCode), slot);
            else countrySlots.set(message.countryCode, slot);
            if (message.polygons) uploads++;
            slot.queue.push(message);
            assert.ok(slot.queue.length <= 2);
          } };
        workers.push(slot); return slot;
      },
    } });
  const drain = async pending => {
    let turns = 0;
    while (callbacks.length || workers.some(worker => worker.queue.length)) {
      assert.ok(turns++ < 100);
      while (callbacks.length) callbacks.shift()();
      assert.ok(workers.reduce((count, worker) => count + worker.queue.length, 0) <= 8);
      // Different countries may finish in any order; each slot remains FIFO.
      for (const worker of [...workers].reverse()) {
        const message = worker.queue.shift();
        if (!message) continue;
        const result = worker.handle(message);
        assert.deepEqual(result.fit, oracle(message).fit);
        worker.onmessage({ data: result });
      }
    }
    await pending;
  };
  const first = h.owner.prepareCurrentView(1);
  assert.equal(workers.length, 0, "slots are created only when their first fit dispatches");
  callbacks.shift()();
  assert.equal(workers.length, 4);
  assert.equal(workers.reduce((count, worker) => count + worker.queue.length, 0), 8);
  await drain(first);
  assert.equal(uploads, 12, "the full country set is partitioned, never broadcast to four workers");
  assert.equal(invalidations, 1);
  assert.equal(h.owner.isReadyForCurrentView(), true);
  h.state.zoomTransform.k = 1.3;
  assert.equal(h.owner.prepareCurrentView(1.3), null, "map-space fits survive zoom without new worker requests");
  assert.equal(uploads, 12);
  assert.equal(invalidations, 1);
  const diagnostics = h.owner.getDiagnostics();
  assert.equal(diagnostics.workerCount, 4);
  assert.equal(diagnostics.workersCreated, 4);
  assert.equal(diagnostics.maxWorkerQueue, 2);
  assert.equal(diagnostics.maxPendingWorkerFits, 8);
  assert.equal(diagnostics.preparedGeometryBytes, 0);
});

test("a failed pool generation tears down every slot and rejects late replies before recovery", async () => {
  for (const failure of ["error", "messageerror", "timeout"]) {
    const callbacks = [], workers = [];
    let invalidations = 0;
    const h = createHarness({ names: Array.from({ length: 8 }, (_, index) => `C${index}`), viewportWidth: 2000,
      helperOptions: { maxLayoutWorkers: 4, maxPendingPerWorker: 2, nowMs: () => 0,
        scheduleWork: callback => callbacks.push(callback), onInvalidate: () => invalidations++,
        createWorker({ index }) {
          const worker = { index, messages: [], terminated: false,
            postMessage(message) { this.messages.push(message); }, terminate() { this.terminated = true; } };
          workers.push(worker); return worker;
        },
      } });
    const pending = h.owner.prepareCurrentView(1);
    callbacks.shift()();
    assert.equal(workers.length, 4);
    if (failure === "timeout") [...h.timers.values()][0]();
    else if (failure === "messageerror") workers[2].onmessageerror();
    else workers[2].onerror(new Error("pool fixture failure"));
    await pending;
    assert.equal(invalidations, 1);
    assert.ok(workers.every(worker => worker.terminated));
    assert.equal(h.timers.size, 0);
    assert.equal(h.owner.getDiagnostics().workerCount, 0);
    assert.equal(h.owner.getDiagnostics().pendingWorkerFits, 0);
    assert.equal(h.owner.isReadyForCurrentView(), false);
    assert.equal(h.owner.prepareCurrentView(1), null);
    h.source.revision++;
    const recovered = h.owner.prepareCurrentView(1);
    for (const worker of workers.slice(0, 4)) {
      worker.onmessage({ data: { requestId: worker.messages[0].requestId, fit: null } });
      worker.onerror(new Error("stale pool failure"));
    }
    assert.equal(invalidations, 1);
    while (callbacks.length) callbacks.shift()();
    assert.equal(workers.length, 8);
    for (const worker of workers.slice(4)) for (const message of worker.messages)
      worker.onmessage({ data: { requestId: message.requestId, fit: null } });
    await recovered;
    assert.equal(h.owner.getDiagnostics().workerCount, 4);
    assert.equal(h.owner.getDiagnostics().workerErrors, 0);
    assert.equal(h.owner.isReadyForCurrentView(), true);
    assert.equal(invalidations, 2);
  }
});

test("private worker preparation preserves exact synchronous fit and glyph drawing", async () => {
  const native = createHarness({ names: ["TEST"], realLayout: true });
  assert.equal(native.owner.drawCountryLabels(1), 1);
  const callbacks = [], messages = [];
  let worker, invalidations = 0;
  const prepared = createHarness({ names: ["TEST"], realLayout: true, helperOptions: {
    nowMs: () => 0, scheduleWork: callback => callbacks.push(callback), onInvalidate: () => invalidations++,
    createWorker: () => (worker = { postMessage: message => messages.push(message), terminate() {} }),
  } });
  const pending = prepared.owner.prepareCurrentView(1);
  callbacks.shift()();
  const result = createCountryLabelLayoutWorkerHandler()(messages[0]);
  worker.onmessage({ data: result });
  await pending;
  assert.equal(invalidations, 1);
  assert.equal(prepared.owner.drawCountryLabels(1), 1);
  assert.deepEqual(prepared.owner.getDiagnostics().lastLabels, native.owner.getDiagnostics().lastLabels);
  const glyphEvents = context => context.events.filter(([event]) => event === "fill" || event === "stroke");
  assert.deepEqual(glyphEvents(prepared.context), glyphEvents(native.context));
  assert.equal(prepared.owner.prepareCurrentView(1), null);
});

test("private preparation supersedes a view before dispatch and draws join its existing work", async () => {
  const callbacks = [], messages = [];
  let worker, invalidations = 0;
  const { owner, state } = createHarness({ helperOptions: { nowMs: () => 0,
    scheduleWork: callback => callbacks.push(callback), onInvalidate: () => invalidations++,
    createWorker: () => (worker = { postMessage: message => messages.push(message), terminate() {} }),
  } });
  const old = owner.prepareCurrentView(1);
  state.zoomTransform.k = 1.3;
  const current = owner.prepareCurrentView(1.3);
  await old;
  owner.drawCountryLabels(1.3);
  assert.equal(callbacks.length, 2, "draw cannot add a second producer beside the private pump");
  callbacks.shift()();
  assert.equal(messages.length, 0, "cancelled host slices never dispatch old-band fits");
  callbacks.shift()();
  assert.equal(messages.length, 1);
  assert.equal(invalidations, 0);
  worker.onmessage({ data: { requestId: messages[0].requestId, fit: null } });
  await current;
  assert.equal(invalidations, 1);
  assert.equal(owner.isReadyForCurrentView(), true);
});

test("private preparation cancels disabled, interactive and externally disabled candidates without publishing", async () => {
  for (const stop of [h => { h.state.styleConfig.countryLabels = { enabled: false }; },
    h => { h.state.isInteracting = true; }, h => { h.enabled = false; }]) {
    const callbacks = [], messages = [];
    let invalidations = 0;
    const h = { enabled: true };
    Object.assign(h, createHarness({ helperOptions: {
      scheduleWork: callback => callbacks.push(callback), onInvalidate: () => invalidations++,
      isPrivatePreparationEnabled: () => h.enabled,
      createWorker: () => ({ postMessage: message => messages.push(message), terminate() {} }),
    } }));
    const pending = h.owner.prepareCurrentView(1);
    stop(h);
    assert.equal(h.owner.prepareCurrentView(1), null);
    await pending;
    callbacks.shift()();
    assert.equal(messages.length, 0);
    assert.equal(invalidations, 0);
  }
});

test("private source and font replacement settle old work and reject stale worker fits", async () => {
  for (const replace of [h => { h.source.sourceToken = {}; h.source.revision++; },
    h => h.setProjectionIdentity(2), h => h.owner.clearTextCache()]) {
    const callbacks = [], messages = [], workers = [];
    let invalidations = 0;
    const h = createHarness({ helperOptions: { nowMs: () => 0,
      scheduleWork: callback => callbacks.push(callback), onInvalidate: () => invalidations++,
      createWorker() { const worker = { postMessage: message => messages.push({ worker, message }), terminate() {} };
        workers.push(worker); return worker; },
    } });
    const old = h.owner.prepareCurrentView(1);
    callbacks.shift()();
    const first = messages[0];
    replace(h);
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
  }
});

test("explicit cancellation releases the private view and late replies cannot publish it", async () => {
  const callbacks = [], messages = [];
  let worker, invalidations = 0;
  const { owner } = createHarness({ helperOptions: { nowMs: () => 0,
    scheduleWork: callback => callbacks.push(callback), onInvalidate: () => invalidations++,
    createWorker: () => (worker = { postMessage: message => messages.push(message), terminate() {} }),
  } });
  const pending = owner.prepareCurrentView(1);
  callbacks.shift()();
  owner.cancelPreparation();
  await pending;
  assert.equal(owner.getDiagnostics().privatePreparationPending, false);
  const resumed = owner.prepareCurrentView(1);
  assert.ok(resumed instanceof Promise, "a new epoch prepares its own exact result");
  assert.equal(callbacks.length, 0, "the bounded queue waits for the obsolete in-flight request to release its slot");
  worker.onmessage({ data: { requestId: messages[0].requestId, fit: null } });
  assert.equal(invalidations, 0);
  assert.equal(owner.getDiagnostics().cachedFits, 0, "an obsolete job cannot populate the current fit cache");
  assert.equal(owner.getDiagnostics().pendingWorkerFits, 0);
  callbacks.shift()();
  worker.onmessage({ data: { requestId: messages[1].requestId, fit: null } });
  await resumed;
  assert.equal(invalidations, 1);
  assert.equal(owner.isReadyForCurrentView(), true);
});

test("zoom and viewport changes reuse the single map-space fit and its glyph positions", () => {
  const h = createHarness();
  h.owner.drawCountryLabels(1);
  assert.equal(h.fitCalls.length, 1);
  const options = h.fitCalls[0];
  assert.equal(options.minFontSize < 1, true, "small territories may fit tiny map-space titles");
  assert.equal(options.maxFontSize > 32, true, "large territories are not capped by a screen font");
  for (const [k, width] of [[1.3, 800], [2, 801], [4, 1200], [0.8, 640]]) {
    h.state.zoomTransform.k = k;
    h.setViewportWidth(width);
    assert.equal(h.owner.isReadyForCurrentView(), true);
    h.owner.drawCountryLabels(k);
  }
  assert.equal(h.fitCalls.length, 1, "neither zoom nor viewport refits a title");
  assert.equal(h.owner.getDiagnostics().cachedFits, 1);
  const translations = h.context.events.filter(([event]) => event === "translate");
  assert.deepEqual(new Set(translations.map(([, x, y]) => `${x},${y}`)).size, 2,
    "every draw reuses the same map-space glyph origins");
});

test("a host preparation exception settles once, stays failed without retry and recovers on a new source", async () => {
  const callbacks = [], messages = [];
  let worker, invalidations = 0;
  const h = createHarness({ helperOptions: { nowMs: () => 0,
    scheduleWork: callback => callbacks.push(callback), onInvalidate: () => invalidations++,
    createWorker: () => (worker = { postMessage: message => messages.push(message), terminate() {} }),
  } });
  const measure = h.context.measureText;
  h.context.measureText = () => { throw new Error("fixture glyph metric failure"); };
  const pending = h.owner.prepareCurrentView(1);
  callbacks.shift()();
  await pending;
  assert.equal(invalidations, 1);
  assert.equal(h.owner.getDiagnostics().privatePreparationPending, false);
  assert.equal(h.owner.getDiagnostics().workerErrors, 1);
  assert.match(h.owner.getDiagnostics().lastWorkerError, /glyph metric failure/);
  assert.equal(h.owner.isReadyForCurrentView(), false);
  assert.equal(h.owner.prepareCurrentView(1), null);
  assert.doesNotThrow(() => h.owner.drawCountryLabels(1));
  assert.equal(callbacks.length, 0, "terminal generation failure must not create another host attempt");
  assert.equal(messages.length, 0);
  h.context.measureText = measure;
  h.source.revision++;
  const recovered = h.owner.prepareCurrentView(1);
  callbacks.shift()();
  worker.onmessage({ data: { requestId: messages[0].requestId, fit: null } });
  await recovered;
  assert.equal(h.owner.getDiagnostics().workerErrors, 0);
  assert.equal(h.owner.isReadyForCurrentView(), true);
  assert.equal(invalidations, 2);
});

test("owner aggregates small worker timing and prepared-index accounting without retaining per-request arrays", async () => {
  const callbacks = [], messages = [];
  let worker;
  const { owner, state } = createHarness({ helperOptions: { nowMs: () => 0,
    scheduleWork: callback => callbacks.push(callback), onInvalidate() {},
    createWorker: () => (worker = { postMessage: message => messages.push(message), terminate() {} }),
  } });
  for (const [k, workerMs, fitMs, candidateBuildMs, preparedGeometryBuildMs, preparedGeometryBytes] of [
    [1, 10, 8, 2, 3, 100], [1.3, 7, 6, 1, 2, 120],
  ]) {
    // Fits are zoom independent; a font change requests the second one.
    if (k !== 1) owner.clearTextCache();
    state.zoomTransform.k = k;
    const pending = owner.prepareCurrentView(k);
    callbacks.shift()();
    worker.onmessage({ data: { requestId: messages.at(-1).requestId, fit: null,
      workerMs, fitMs, candidateBuildMs, preparedGeometryBuildMs, preparedGeometryBytes,
      preparedGeometryBuilds: k === 1 ? 1 : 0, preparedGeometryHits: k === 1 ? 0 : 1 } });
    await pending;
  }
  const d = owner.getDiagnostics();
  assert.equal(d.workerTotalMs, 17); assert.equal(d.workerMaxMs, 10);
  assert.equal(d.workerFitMs, 14); assert.equal(d.workerMaxFitMs, 8);
  assert.equal(d.workerCandidateBuildMs, 3); assert.equal(d.workerMaxCandidateBuildMs, 2);
  assert.equal(d.workerPreparedBuildMs, 5); assert.equal(d.workerMaxPreparedBuildMs, 3);
  assert.equal(d.preparedGeometryBuilds, 1); assert.equal(d.preparedGeometryHits, 1);
  assert.equal(d.preparedGeometryBytes, 120);
});

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

test("indexed large concave and nested rings exactly match the full-edge oracle at boundaries", () => {
  const exterior = densifyRing(squareRing(-100, -100, 500), 128);
  const concave = densifyRing([
    [-20, -10], [280, -10], [280, 50], [80, 50], [80, 290], [-20, 290], [-20, 290], [-20, -10],
  ], 128);
  const island = densifyRing(squareRing(-10, 0, 50), 96);
  const islandHole = squareRing(0, 10, 20);
  const innerIsland = squareRing(5, 15, 5);
  const probes = [];
  for (let y = -100; y <= 400; y += 25) {
    for (let x = -100; x <= 400; x += 25) probes.push(squareRing(x, y, 0.125));
  }
  // Include both endpoints and midpoints of horizontal/vertical notch edges,
  // plus repeated closure points, rather than only non-boundary sample points.
  for (const [x, y] of [[-20, -10], [280, -10], [280, 50], [80, 50], [80, 170], [-20, 290],
    [130, -10], [180, 50], [400, 400], [-100, -100], [0, 400], [0, -100]]) {
    probes.push(squareRing(x, y, 0.0625));
  }
  const rings = [...probes, innerIsland, islandHole, concave, island, exterior];
  for (const oriented of [rings, rings.map((ring) => [...ring].reverse())]) {
    assert.deepEqual(groupProjectedRings(oriented), groupProjectedRingsNaively(oriented));
    const unclosed = oriented.map((ring) => ring.slice(0, -1));
    assert.deepEqual(groupProjectedRings(unclosed), groupProjectedRingsNaively(unclosed), "implicit closing edges are also indexed");
  }
});

test("large-ring y index reduces actual edge coordinate reads and stays local to one grouping", () => {
  let outerReads = 0;
  const rawOuter = densifyRing(squareRing(0, 0, 1000), 1024);
  const outer = new Proxy(rawOuter, {
    get(target, key, receiver) {
      if (typeof key === "string" && /^(0|[1-9]\d*)$/.test(key)) outerReads++;
      return Reflect.get(target, key, receiver);
    },
  });
  const holes = Array.from({ length: 400 }, (_, index) => squareRing(20 + (index % 20) * 45, 20 + Math.floor(index / 20) * 45, 2));
  const rings = [...holes, outer];
  const expected = groupProjectedRingsNaively(rings);
  const naiveReads = outerReads;
  outerReads = 0;
  const actual = groupProjectedRings(rings);
  const indexedReads = outerReads;
  assert.deepEqual(actual, expected);
  assert.ok(indexedReads < naiveReads / 8, `indexed reads ${indexedReads} must be below one eighth of naive reads ${naiveReads}`);
  outerReads = 0;
  groupProjectedRings(rings);
  assert.equal(outerReads, indexedReads, "a new grouping rebuilds its own lazy index");
  assert.deepEqual(Reflect.ownKeys(rawOuter), Reflect.ownKeys(densifyRing(squareRing(0, 0, 1000), 1024)), "rings do not retain index properties");
});

test("pan and zoom reuse map geometry and text fits while repainting transformed glyphs", () => {
  const { owner, state, context, setProjectionIdentity } = createHarness();
  const occupied = [];
  assert.equal(owner.drawCountryLabels(1, { occupiedBoxes: occupied }), 1);
  assert.equal(occupied.length, 2, "each real glyph reserves its own box");
  const first = { ...occupied[0] };
  state.zoomTransform = { k: 1.15, x: 8, y: 5 };
  const next = [];
  assert.equal(owner.drawCountryLabels(1.15, { occupiedBoxes: next }), 1);
  assert.equal(next[0].x, (first.x + 1.5) * 1.15 + 8 - 1.5);
  assert.equal(owner.getDiagnostics().geometryBuilds, 1);
  assert.equal(owner.getDiagnostics().candidateBuilds, 1);
  assert.equal(owner.getDiagnostics().fitBuilds, 1);
  assert.equal(context.events.filter(([event]) => event === "measure").length, 2);
  assert.deepEqual(context.events.filter(([event]) => event === "translate")[0], ["translate", 70, 90]);
  setProjectionIdentity(2);
  owner.drawCountryLabels(1.15);
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
  assert.equal(fitCalls[0].glyphPadding, 0.06);
  assert.match(context.events.find(([event]) => event === "measure")[2], /^500 100px "Map Garamond"/);
  assert.match(context.events.find(([event]) => event === "fill")[2], /^500 .*"Map Garamond", "Palatino Linotype", Georgia, serif$/);
  assert.ok(Math.abs(context.events.find(([event]) => event === "stroke")[4] - 12 * 0.14) < 1e-9,
    "the halo is part of the map-space lettering");
  assert.equal(fitCalls[0].allowArcs, true);
  assert.equal(fitCalls[0].preferGentleArcs, true);
  assert.equal(fitCalls[0].maxArcTiltDegrees, 18);
  assert.equal(fitCalls[0].maxArcBendDegrees, 28);
  assert.equal(fitCalls[0].tracking, 0.08);
  assert.equal(fitCalls[0].maxTracking, 0.6);
  assert.equal(fitCalls[0].minHoleArea, 4);
  assert.equal(fitCalls[0].readableFontSize, Number.MAX_VALUE, "legibility is a drawing decision, not a fit input");
  assert.equal(fitCalls[0].maxTiltDegrees, 30);
  assert.ok(context.events.find(([event]) => event === "measure")[2].includes("100px"));
  state.language = "zh";
  source.countries[0].name = "中国";
  owner.drawCountryLabels(1);
  assert.equal(fitCalls[1].maxArcTiltDegrees, 12);
  assert.equal(fitCalls[1].maxArcBendDegrees, 18);
  assert.equal(fitCalls[1].maxTracking, 0.25);
  assert.equal(owner.getDiagnostics().geometryBuilds, 1);
  assert.equal(owner.getDiagnostics().fitBuilds, 2);
  assert.match(context.events.filter(([event]) => event === "measure").at(-1)[2], /^400 100px "Map Noto Serif SC"/);
  assert.match(context.events.filter(([event]) => event === "fill").at(-1)[2], /^400 .*"Map Noto Serif SC", "Noto Serif SC", "Songti SC", SimSun, serif$/);
  owner.clearTextCache();
  assert.equal(owner.isReadyForCurrentView(), false);
  owner.drawCountryLabels(1);
  assert.equal(owner.getDiagnostics().geometryBuilds, 1);
  assert.equal(owner.getDiagnostics().candidateBuilds, 1);
  assert.equal(owner.getDiagnostics().fitBuilds, 3);
  assert.equal(owner.isReadyForCurrentView(), true);
});

test("fine glyph boxes allow gaps, city collisions reject titles and edge titles may run off screen", () => {
  const { owner, state } = createHarness();
  assert.equal(owner.drawCountryLabels(1, { occupiedBoxes: [{ x: 77.6, y: 80, w: 0.8, h: 10 }] }), 1);
  assert.equal(owner.drawCountryLabels(1, { occupiedBoxes: [{ x: 69, y: 80, w: 2, h: 10 }] }), 0);
  state.zoomTransform.x = -70;
  assert.equal(owner.drawCountryLabels(1), 1, "a title partly past the edge stays in place like printed lettering");
  state.zoomTransform.x = -100;
  assert.equal(owner.drawCountryLabels(1), 0, "a title with no ink on screen is skipped");
  state.zoomTransform.x = -900;
  owner.clearTextCache();
  owner.drawCountryLabels(1);
  assert.equal(owner.getDiagnostics().fitBuilds, 1, "offscreen geography does not trigger a new fit");
});

test("collisions try cached alternative positions and reserve only the accepted fit", () => {
  const { owner } = createHarness({ alternatives: [30, 60] });
  const blocker = { x: 65, y: 75, w: 50, h: 20 };
  const occupied = [blocker];
  assert.equal(owner.drawCountryLabels(1, { occupiedBoxes: occupied }), 1);
  assert.equal(owner.getDiagnostics().lastLabels[0].candidateIndex, 1);
  assert.equal(occupied.length, 3, "failed placements do not leak occupancy");
  assert.ok(occupied.slice(1).every((box) => box.y > 100));
  assert.equal(owner.drawCountryLabels(1, { occupiedBoxes: [blocker, { x: 65, y: 105, w: 50, h: 20 }] }), 1);
  assert.equal(owner.getDiagnostics().lastLabels[0].candidateIndex, 2);
  assert.equal(owner.drawCountryLabels(1, { occupiedBoxes: [{ x: 65, y: 75, w: 50, h: 100 }] }), 0);
  assert.equal(owner.drawCountryLabels(1), 1, "cleared obstruction restores the primary");
  assert.equal(owner.getDiagnostics().lastLabels[0].candidateIndex, 0);
  assert.equal(owner.getDiagnostics().fitBuilds, 1, "repaints and collision retries never refit geometry");
});

test("macro label orchestration reserves capitals then countries then other city text; detail prioritizes cities", async () => {
  const renderer = await readFile(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
  const code = renderer.slice(renderer.indexOf("function drawLabelsPassContent(k,"), renderer.indexOf("function focusWaterRegionById("));
  const events = [];
  const runtimeState = { styleConfig: {}, deferContextBasePass: false };
  const countryBox = { x: 20, y: 20, w: 50, h: 12 };
  const markerBox = { x: 80, y: 20, w: 8, h: 8 };
  const capitalBox = { x: 90, y: 20, w: 45, h: 12 };
  const overviewLayout = { capitalBoxes: [capitalBox] };
  const scope = { runtimeState, getMapLabelHierarchy, recordRenderPerfMetric() {},
    drawBlankFeatureLabelsPass() {}, shouldShowMarineRegionNames: () => false, nowMs: () => 0,
    getCityPointsRenderOwner: () => ({
      reserveOverviewLabelBoxes(_k, boxes) { events.push("capitals"); boxes.push(markerBox, capitalBox); return overviewLayout; },
      drawLabelsPass(_k, { occupiedBoxes, overviewLayout: reservation }) {
        events.push("cities");
        if (reservation) { assert.equal(reservation, overviewLayout); assert.ok(occupiedBoxes.includes(countryBox)); }
        else occupiedBoxes.push(markerBox, capitalBox);
      },
    }),
    getCountryLabelSourceOwner: () => ({ prepare() {} }),
    getCountryLabelRenderOwner: () => ({ drawCountryLabels(_k, { occupiedBoxes }) {
      events.push("countries"); assert.ok(occupiedBoxes.includes(markerBox)); assert.ok(occupiedBoxes.includes(capitalBox)); occupiedBoxes.push(countryBox);
    }, getDiagnostics: () => ({}) }),
    getTransportOverviewRenderOwner: () => ({ drawPendingLabels() {} }),
    getPhysicalLayerRenderOwner: () => ({ drawPhysicalRegionLabels() {} }),
  };
  vm.runInNewContext(code, scope);
  for (const k of [1, 2, 2.5, 3]) {
    events.length = 0;
    scope.drawLabelsPassContent(k);
    assert.deepEqual(events, ["capitals", "countries", "cities"]);
  }
  events.length = 0;
  scope.drawLabelsPassContent(4);
  assert.deepEqual(events, ["cities", "countries"]);
  events.length = 0;
  runtimeState.styleConfig.countryLabels = { enabled: false };
  scope.drawLabelsPassContent(1);
  assert.deepEqual(events, ["cities"]);
});

test("map-space titles scale exactly with zoom and fade out once oversized", () => {
  const { owner, state } = createHarness({ names: ["TEST"], realLayout: true });
  assert.equal(owner.drawCountryLabels(1), 1);
  const original = owner.getDiagnostics().lastLabels[0];
  let faded = 0;
  for (const k of [1.5, 2, 4, 8]) {
    state.zoomTransform = { x: 400 - 95 * k, y: 350 - 95 * k, k };
    const expected = original.fontSizePx * k;
    const drawn = owner.drawCountryLabels(k);
    if (expected >= 200) { assert.equal(drawn, 0, `an oversized title hands over at ${k}x`); faded++; continue; }
    assert.equal(drawn, 1);
    const label = owner.getDiagnostics().lastLabels[0];
    assert.ok(Math.abs(label.fontSizePx - expected) < 1e-9, "zoom never refits or resizes a title");
    assert.equal(label.candidateIndex, original.candidateIndex);
    if (expected <= 120) assert.equal(label.alpha, original.alpha);
  }
  assert.ok(faded > 0);
  assert.equal(owner.getDiagnostics().fitBuilds, 1);
});

test("country text steps into the background only while city text is enabled", () => {
  const { owner, state } = createHarness({ names: ["AAAAAAAAAAAAAA"], realLayout: true });
  state.showCityPoints = true;
  assert.equal(owner.drawCountryLabels(1), 1);
  const baseAlpha = owner.getDiagnostics().lastLabels[0].alpha;
  state.zoomTransform = { x: 400 - 95 * 6, y: 350 - 95 * 6, k: 6 };
  const occupiedBoxes = [];
  assert.equal(owner.drawCountryLabels(6, { occupiedBoxes }), 0);
  assert.equal(occupiedBoxes.length, 0, "fully faded countries do not block city labels");
  const fitBuilds = owner.getDiagnostics().fitBuilds;
  for (const cityStyle of [{ showLabels: false }, { opacity: 0 }]) {
    state.styleConfig.cityPoints = cityStyle;
    assert.equal(owner.drawCountryLabels(6), 1);
    assert.equal(owner.getDiagnostics().lastLabels[0].alpha, baseAlpha);
  }
  state.styleConfig.cityPoints = {};
  state.showCityPoints = false;
  assert.equal(owner.drawCountryLabels(6), 1);
  assert.equal(owner.getDiagnostics().lastLabels[0].alpha, baseAlpha);
  assert.equal(owner.getDiagnostics().fitBuilds, fitBuilds, "hierarchy switches change paint, not geometry fitting");
});

test("English display names render as capitals and share export readiness keys", () => {
  const { owner, source, fitCalls } = createHarness({ names: ["New Zealand"] });
  assert.equal(owner.drawCountryLabels(1), 1);
  assert.equal(owner.getDiagnostics().lastLabels[0].text, "NEW ZEALAND");
  assert.equal(fitCalls[0].glyphs.map((glyph) => glyph.text).join(""), "NEW ZEALAND");
  assert.equal(owner.isReadyForCurrentView(), true);
  assert.equal(source.countries[0].name, "New Zealand");
  owner.drawCountryLabels(1);
  assert.equal(fitCalls.length, 1);
  source.countries[0].name = "Brazil";
  owner.drawCountryLabels(1);
  assert.equal(owner.getDiagnostics().lastLabels[0].text, "BRAZIL");
  assert.equal(owner.isReadyForCurrentView(), true);
});

test("a small country remains labelled locally while a large country's fade is stable during pan", () => {
  const { owner, source, state } = createHarness({ names: ["SMALL"], realLayout: true });
  state.showCityPoints = true;
  source.countries[0].feature.geometry.coordinates = [[[20, 20], [35, 20], [35, 35], [20, 35], [20, 20]]];
  state.zoomTransform = { x: 235, y: 185, k: 6 };
  assert.equal(owner.drawCountryLabels(6), 1);
  assert.equal(owner.getDiagnostics().lastLabels[0].alpha, 0.82);
  const large = createHarness({ names: ["LARGE"], realLayout: true });
  large.state.showCityPoints = true;
  for (const x of [-170, -500, -650]) {
    large.state.zoomTransform = { x, y: -220, k: 6 };
    assert.equal(large.owner.drawCountryLabels(6), 0);
    assert.equal(large.owner.getDiagnostics().rejectedByVisibility, 1);
  }
});

test("territory rather than short versus long readable names determines visibility and order", () => {
  const { owner, source } = createHarness({ names: ["AA", "AAAAAAAAAAAAAA"], realLayout: true });
  assert.equal(owner.drawCountryLabels(1), 2);
  const labels = owner.getDiagnostics().lastLabels;
  assert.ok(labels[0].fontSizePx > labels[1].fontSizePx, "the longer label is genuinely geometry constrained");
  assert.equal(labels[0].alpha, labels[1].alpha);
  source.countries[0].name = "AAAAAAAAAAAAAA";
  source.countries[1].name = "AA";
  assert.equal(owner.drawCountryLabels(1), 2);
  assert.deepEqual(owner.getDiagnostics().lastLabels.map((label) => label.countryCode), ["C0", "C1"], "text length does not reorder equal territories");
});

test("remote islands cannot use an inflated aggregate bbox to reveal tiny territories", () => {
  const { owner, source } = createHarness({ names: ["AA"], fontSizes: [12] });
  const square = (x) => [[[x, 20], [x + 3, 20], [x + 3, 23], [x, 23], [x, 20]]];
  source.countries[0].feature.geometry = { type: "MultiPolygon", coordinates: [square(20), square(600)] };
  assert.equal(owner.drawCountryLabels(1), 0);
  assert.equal(owner.getDiagnostics().rejectedByVisibility, 1);
  assert.equal(owner.getDiagnostics().skippedByVisibilityUpperBound, 1);
  assert.equal(owner.getDiagnostics().rejectedLabels[0].visibleArea, 9);
});

test("separate mainland and overseas fits survive panning without refitting or duplicate titles", () => {
  const { owner, state, source } = createHarness({ names: ["Continental Republic"], realLayout: true });
  const square = (x, y, w, h) => [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]];
  source.countries[0].feature.geometry = { type: "MultiPolygon", coordinates: [square(20, 80, 220, 100), square(1000, 80, 110, 110)] };
  assert.equal(owner.drawCountryLabels(1), 1);
  assert.equal(owner.getDiagnostics().lastLabels[0].polygonIndex, 0);
  const builds = owner.getDiagnostics().fitBuilds;
  state.zoomTransform.x = -900;
  assert.equal(owner.drawCountryLabels(1), 1, "an independently retained overseas fit remains available");
  assert.equal(owner.getDiagnostics().lastLabels[0].polygonIndex, 1);
  state.zoomTransform = { x: 0, y: 0, k: 0.6 };
  assert.equal(owner.drawCountryLabels(0.6), 1, "both territories in view still produce a single country title");
  assert.equal(owner.getDiagnostics().lastLabels.length, 1);
  state.zoomTransform = { x: 0, y: 0, k: 1 };
  owner.drawCountryLabels(1);
  assert.equal(owner.getDiagnostics().fitBuilds, builds, "neither zoom nor panning refits component titles");
});

test("a blocked dominant mainland cannot relocate its country title to a minor overseas territory", () => {
  const { owner, state, source } = createHarness({ names: ["Continental Republic"], realLayout: true });
  const square = (x, y, w, h) => [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]];
  source.countries[0].feature.geometry = { type: "MultiPolygon", coordinates: [square(20, 180, 350, 200), square(500, 80, 110, 110)] };
  assert.equal(owner.drawCountryLabels(1), 1);
  assert.equal(owner.getDiagnostics().lastLabels[0].polygonIndex, 0);
  assert.equal(owner.drawCountryLabels(1, { occupiedBoxes: [{ x: 20, y: 180, w: 350, h: 200 }] }), 0);
  state.zoomTransform.x = -400;
  assert.equal(owner.drawCountryLabels(1), 1, "overseas placement becomes available when the mainland leaves view");
  assert.equal(owner.getDiagnostics().lastLabels[0].polygonIndex, 1);
});

test("overseas visibility and local fade use the territory carrying the label", () => {
  const { owner, state, source } = createHarness({ names: ["A"], realLayout: true });
  const square = (x, y, w, h) => [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]];
  source.countries[0].feature.geometry = { type: "MultiPolygon", coordinates: [square(20, 20, 200, 80), square(1000, 20, 25, 25)] };
  state.showCityPoints = true;
  state.zoomTransform = { x: 400 - 1012.5 * 6, y: 350 - 32.5 * 6, k: 6 };
  assert.equal(owner.drawCountryLabels(6), 1, "the distant mainland must not suppress this small overseas label");
  const label = owner.getDiagnostics().lastLabels[0];
  assert.equal(label.polygonIndex, 1);
  const sizeFade = Math.min(1, Math.max(0, (200 - label.fontSizePx) / 80));
  const expected = 0.82 * sizeFade * (1 - (625 * 36 / (800 * 700) - 0.02) / 0.08);
  assert.ok(Math.abs(label.alpha - expected) < 1e-8);
  state.zoomTransform = { x: 400 - 120 * 6, y: 350 - 60 * 6, k: 6 };
  assert.equal(owner.drawCountryLabels(6), 0, "the oversized mainland title has handed over at this zoom");
});

test("pan and zoom reuse one cached fit per country", () => {
  const { owner, state } = createHarness();
  for (const k of [1, 1.2, 1.5, 2, 3, 4, 6, 8]) {
    for (const x of [0, 10, 20]) {
      state.zoomTransform = { x: 400 - 80 * k + x, y: 350 - 90 * k, k };
      owner.drawCountryLabels(k);
    }
  }
  assert.equal(owner.getDiagnostics().fitBuilds, 1);
  assert.equal(owner.getDiagnostics().cachedFits, 1);
});

test("rapid zoom requests one worker fit per country and publishes it at every scale", () => {
  const callbacks = [], messages = [];
  let worker;
  const { owner, state, source } = createHarness({ names: ["TEST"], helperOptions: {
    onInvalidate() {}, scheduleWork: (callback) => callbacks.push(callback),
    createWorker: () => (worker = { postMessage: (message) => messages.push(message), terminate() {} }),
  } });
  for (const k of [1, 1.2, 1.5, 2, 3, 4, 6, 8]) {
    state.zoomTransform = { x: 400 - 95 * k, y: 350 - 95 * k, k };
    assert.equal(owner.drawCountryLabels(k), 0, "nothing is painted before the only fit arrives");
    callbacks.shift()?.();
  }
  assert.equal(messages.length, 1);
  assert.equal(owner.isReadyForCurrentView(), false);
  const handle = createCountryLabelLayoutWorkerHandler();
  worker.onmessage({ data: handle(messages.shift()) });
  assert.equal(owner.isReadyForCurrentView(), true);
  for (const k of [2, 1.5, 1]) {
    state.zoomTransform = { x: 400 - 95 * k, y: 350 - 95 * k, k };
    assert.equal(owner.drawCountryLabels(k), 1);
  }
  assert.equal(callbacks.length, 0);
  assert.equal(messages.length, 0, "zoom never queues another fit");
  state.language = "zh";
  source.countries[0].name = "中国";
  assert.equal(owner.drawCountryLabels(1), 0, "a prior language must not appear while its replacement is pending");
});

test("offscreen projection skips worker preparation until panning into view", () => {
  const callbacks = [], messages = [];
  let worker;
  const { owner, state } = createHarness({ helperOptions: {
    onInvalidate() {}, scheduleWork: (callback) => callbacks.push(callback),
    createWorker: () => (worker = { postMessage: (message) => messages.push(message), terminate() {} }),
  } });
  state.zoomTransform.x = -1000;
  owner.drawCountryLabels(1);
  callbacks.shift()();
  assert.equal(messages.length, 0, "offscreen geometry does not occupy the serial worker queue");
  assert.equal(owner.isReadyForCurrentView(), true, "an offscreen country has no pending fit for this view");

  state.zoomTransform.x = 0;
  owner.drawCountryLabels(1);
  assert.equal(callbacks.length, 1, "panning into view schedules its fit");
  callbacks.shift()();
  assert.equal(messages.length, 1);
  assert.equal(owner.isReadyForCurrentView(), false);
  worker.onmessage({ data: createCountryLabelLayoutWorkerHandler()(messages.shift()) });
  assert.equal(owner.drawCountryLabels(1), 1);
  assert.equal(owner.isReadyForCurrentView(), true);
});

test("edge titles ignore collision padding, stay in place while partly visible and try alternatives when not", () => {
  const { owner, state } = createHarness({ alternatives: [30] });
  state.zoomTransform.y = -79;
  assert.equal(owner.drawCountryLabels(1), 1, "padding crossing the viewport does not clip actual glyph boxes");
  state.zoomTransform.y = -85;
  assert.equal(owner.drawCountryLabels(1), 1);
  assert.equal(owner.getDiagnostics().lastLabels[0].candidateIndex, 0, "a partly visible title does not jump");
  state.zoomTransform.y = -115;
  assert.equal(owner.drawCountryLabels(1), 1);
  assert.equal(owner.getDiagnostics().lastLabels[0].candidateIndex, 1, "an offscreen primary yields to a visible alternative");
  assert.equal(owner.getDiagnostics().fitBuilds, 1);
  state.zoomTransform.y = -150;
  assert.equal(owner.drawCountryLabels(1), 0);
  assert.equal(owner.getDiagnostics().rejectedByViewport, 1);
  assert.equal(owner.getDiagnostics().rejectedLabels[0].reason, "Viewport");
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

test("deferred preparation batches countries and bounds the serial worker queue", () => {
  const callbacks = [], messages = [];
  let invalidations = 0;
  let worker;
  const { owner } = createHarness({ names: Array.from({ length: 12 }, (_, i) => `C${i}`), viewportWidth: 2400, helperOptions: {
    nowMs: () => 0,
    scheduleWork: (callback) => callbacks.push(callback),
    onInvalidate: () => { invalidations += 1; },
    createWorker: () => (worker = { postMessage: (message) => messages.push(message), terminate() {} }),
  } });
  owner.drawCountryLabels(1);
  callbacks.shift()();
  assert.equal(messages.length, 8, "one bounded batch prepares multiple worker requests");
  assert.equal(invalidations, 1, "preparation shares one repaint across the batch");
  owner.drawCountryLabels(1);
  assert.equal(callbacks.length, 0, "a full queue waits for completion instead of flooding the worker");
  for (const message of messages.slice(0, 4)) worker.onmessage({ data: { requestId: message.requestId, fit: null } });
  assert.equal(owner.getDiagnostics().pendingWorkerFits, 4);
  owner.drawCountryLabels(1);
  callbacks.shift()();
  assert.equal(messages.length, 12, "pending worker requests are not queued again");
  assert.equal(owner.getDiagnostics().pendingWorkerFits, 8, "released slots are refilled without exceeding the queue cap");
  assert.equal(invalidations, 6);
  owner.clearTextCache();
  owner.drawCountryLabels(1);
  assert.equal(callbacks.length, 0);
  worker.onmessage({ data: { requestId: messages[4].requestId, fit: null } });
  assert.equal(invalidations, 7, "a stale text response still wakes preparation after releasing a slot");
  owner.drawCountryLabels(1);
  callbacks.shift()();
  assert.equal(messages.length, 13, "the current text generation resumes within the queue cap");
  assert.equal(owner.getDiagnostics().pendingWorkerFits, 8);
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

test("export waits for country name source and layout workers", async () => {
  let tick = 0, prepared = 0, requested = 0;
  await waitForCountryLabelsForExport({
    prepareSource: async () => { prepared += 1; },
    getSource: () => ({ status: tick ? "ready" : "pending" }),
    getDiagnostics: () => ({ workerErrors: 0, pendingFits: tick < 3 ? 1 : 0 }),
    requestRender: () => { requested += 1; }, isDisabled: () => false,
    wait: async () => { tick += 1; }, now: () => tick,
  });
  assert.equal(tick, 3);
  assert.equal(prepared, 1);
  assert.equal(requested, 1);
});

test("export preserves label failure and timeout guards and disabled bypass", async () => {
  const options = { prepareSource: async () => {}, getSource: () => ({ status: "ready" }),
    getDiagnostics: () => ({ workerErrors: 1, pendingFits: 0 }), requestRender: () => {},
    isDisabled: () => false };
  await assert.rejects(waitForCountryLabelsForExport(options), /failed to prepare/);
  await assert.rejects(waitForCountryLabelsForExport({ ...options,
    getSource: () => ({ status: "error", error: "source failed" }) }), /source failed/);
  let tick = 0;
  await assert.rejects(waitForCountryLabelsForExport({ ...options,
    getDiagnostics: () => ({ workerErrors: 0, pendingFits: 1 }),
    wait: async () => { tick++; }, now: () => tick, timeoutMs: 2 }), /still preparing/);
  await waitForCountryLabelsForExport({ ...options, isDisabled: () => true,
    prepareSource: () => { throw new Error("must not prepare disabled labels"); } });
});

test("country glyphs in paint padding are actually drawn and keep geometry fits reusable", () => {
  let bounds = null;
  const { owner, state, context, fitCalls } = createHarness({ getPaintBounds: () => bounds });
  state.zoomTransform.x = -130;
  assert.equal(owner.drawCountryLabels(1), 0);
  const fits = fitCalls.length;
  bounds = { minX: -96, minY: -96, maxX: 896, maxY: 796 };
  assert.equal(owner.drawCountryLabels(1), 1);
  assert.ok(context.events.some(event => event[0] === "fill"));
  assert.equal(fitCalls.length, fits);
  bounds = null;
  assert.equal(owner.drawCountryLabels(1), 0);
});

test("deferred fit completes for a country wholly inside the paint margin", () => {
  const callbacks = [];
  const { owner, state, source, context, fitCalls } = createHarness({
    getPaintBounds: () => ({ minX: -96, minY: -96, maxX: 896, maxY: 796 }),
    helperOptions: { nowMs: () => 0, scheduleWork: callback => callbacks.push(callback), onInvalidate() {} },
  });
  source.countries[0].feature.geometry.coordinates = [[[20, 20], [100, 20], [100, 170], [20, 170], [20, 20]]];
  state.zoomTransform.x = -110;
  assert.equal(owner.drawCountryLabels(1), 0);
  assert.equal(callbacks.length, 1);
  callbacks.shift()();
  assert.equal(fitCalls.length, 1, "deferred preparation must include the offscreen paint rectangle");
  assert.equal(owner.drawCountryLabels(1), 1);
  assert.equal(owner.getDiagnostics().pendingFits, 0);
  assert.equal(callbacks.length, 0, "no repeated invalidation/preparation loop");
  assert.ok(context.events.some(event => event[0] === "fill"));
});
