import assert from "node:assert/strict";
import test from "node:test";

import { createNavigationFrameOwner } from "../js/core/renderer/navigation_frame_owner.js";
import { createRuntimeResourceBudget } from "../js/core/runtime_resource_budget.js";

function fixture({ softLimitBytes = 16 * 1024 * 1024 } = {}) {
  const jobs = new Map();
  const canvases = [];
  const paint = [];
  const metrics = [];
  const budget = createRuntimeResourceBudget({ softLimitBytes });
  let identity = "scene-a";
  let time = 0;
  let nextTimer = 1;
  let paused = false;
  const createCanvas = () => {
    const context = {
      setTransform: (...args) => paint.push(["setTransform", ...args]),
      save: () => paint.push(["save"]),
      restore: () => paint.push(["restore"]),
      transform: (...args) => paint.push(["transform", ...args]),
      drawImage: (...args) => paint.push(["drawImage", ...args]),
      fillRect: (...args) => paint.push(["fillRect", ...args]),
    };
    const canvas = { width: 0, height: 0, getContext: () => context };
    canvases.push(canvas);
    return canvas;
  };
  const owner = createNavigationFrameOwner({
    getIdentity: () => identity,
    shouldPause: () => paused,
    createCanvas,
    schedule(callback) {
      const timer = nextTimer++;
      jobs.set(timer, callback);
      return timer;
    },
    cancel: (timer) => jobs.delete(timer),
    now: () => time,
    resourceBudget: budget,
    recordMetric: (name, duration, details) => metrics.push({ name, duration, details }),
  });
  const destinationCalls = [];
  const destination = {
    canvas: { width: 800, height: 600 },
    save: () => destinationCalls.push(["save"]),
    restore: () => destinationCalls.push(["restore"]),
    setTransform: (...args) => destinationCalls.push(["setTransform", ...args]),
    fillRect: (...args) => destinationCalls.push(["fillRect", ...args]),
    clearRect: (...args) => destinationCalls.push(["clearRect", ...args]),
    drawImage: (...args) => destinationCalls.push(["drawImage", ...args]),
  };
  const prepare = (overrides = {}) => owner.prepare({
    bounds: [[-100, -50], [300, 150]],
    layers: [{ items: [1], drawItem: () => {} }],
    backgroundColor: "#abc",
    ...overrides,
  });
  function flushOne() {
    const [timer, callback] = jobs.entries().next().value || [];
    if (!callback) return false;
    jobs.delete(timer);
    callback();
    return true;
  }
  function flushAll() {
    let count = 0;
    while (flushOne()) {
      if (++count > 100) throw new Error("scheduler did not settle");
    }
  }
  return {
    owner, prepare, flushOne, flushAll, destination, destinationCalls,
    paint, canvases, metrics, budget, jobs,
    setIdentity: (value) => { identity = value; },
    setPaused: (value) => { paused = value; },
    advance: (ms) => { time += ms; },
  };
}

test("prepares a bounded full-scene raster in time slices and publishes only after completion", () => {
  const f = fixture();
  const drawn = [];
  assert.equal(f.prepare({ layers: [{ items: [1, 2, 3], drawItem(_context, item) {
    drawn.push(item);
    f.advance(7);
  } }] }), true);
  assert.equal(f.canvases.length, 1);
  assert.deepEqual([f.canvases[0].width, f.canvases[0].height], [1024, 512]);
  assert.equal(f.budget.snapshot().categories.bitmaps, 1024 * 512 * 4);
  assert.equal(f.owner.isReady(), false);
  assert.equal(f.owner.draw(f.destination, { x: 0, y: 0, k: 1 }, 1), false);
  assert.deepEqual(f.destinationCalls, []);
  assert.equal(f.flushOne(), true);
  assert.deepEqual(drawn, [1]);
  assert.equal(f.owner.isReady(), false);
  f.flushAll();
  assert.deepEqual(drawn, [1, 2, 3]);
  assert.equal(f.owner.isReady(), true);
  assert.equal(f.metrics.filter((metric) => metric.name === "navigationFramePrepare").length, 1);
  assert.equal(f.prepare(), false);
  assert.equal(f.canvases.length, 1);
});

test("background preparation yields to direct manipulation and resumes without rebuilding completed items", () => {
  const f = fixture();
  const drawn = [];
  f.prepare({ layers: [{ items: [1, 2], drawItem(_context, item) { drawn.push(item); f.advance(7); } }] });
  f.flushOne();
  f.setPaused(true);
  f.flushOne();
  assert.deepEqual(drawn, [1]);
  assert.equal(f.owner.isReady(), false);
  assert.equal(f.jobs.size, 1);
  f.setPaused(false);
  f.flushAll();
  assert.deepEqual(drawn, [1, 2]);
  assert.equal(f.owner.isReady(), true);
});

test("a complete whole-world exact frame seeds navigation synchronously without reprojection", () => {
  const f = fixture();
  const source = { width: 1600, height: 1000 };
  const bounds = [[-100, -50], [300, 150]];
  assert.equal(f.owner.captureWholeScene(source, { x: 120, y: 70, k: 1 }, 2, bounds), true);
  assert.equal(f.owner.isReady(), true);
  assert.equal(f.jobs.size, 0);
  assert.equal(f.canvases.length, 1);
  assert.deepEqual(f.paint.find(([kind]) => kind === "transform"), ["transform", 0.5, 0, 0, 0.5, -120, -70]);
  assert.equal(f.paint.find(([kind]) => kind === "drawImage")[1], source);
  assert.equal(f.owner.captureWholeScene(source, { x: 120, y: 70, k: 1 }, 2, bounds), true);
  assert.equal(f.canvases.length, 1);
});

test("regional exact snapshots cannot claim complete world coverage", () => {
  const f = fixture();
  const source = { width: 800, height: 600 };
  assert.equal(f.owner.captureWholeScene(source, { x: 0, y: 0, k: 1 }, 2, [[-100, -50], [300, 150]]), false);
  assert.equal(f.owner.captureWholeScene(source, { x: 200, y: 100, k: 2 }, 2, [[-100, -50], [300, 150]]), false);
  assert.equal(f.owner.isReady(), false);
  assert.equal(f.canvases.length, 0);
});

test("superseded and identity-stale jobs never publish and release their canvases", () => {
  const f = fixture();
  f.prepare({ layers: [{ items: [1, 2], drawItem: () => f.advance(7) }] });
  const first = f.canvases[0];
  f.flushOne();
  f.setIdentity("scene-b");
  assert.equal(f.prepare(), true);
  assert.equal(first.width, 0);
  assert.equal(f.budget.snapshot().ownerCount, 1);
  const second = f.canvases[1];
  f.setIdentity("scene-c");
  f.flushAll();
  assert.equal(second.width, 0);
  assert.equal(f.owner.isReady(), false);
  assert.equal(f.budget.snapshot().ownerCount, 0);
  assert.equal(f.metrics.filter((metric) => metric.name === "navigationFramePrepare").length, 0);
  assert.equal(f.metrics.filter((metric) => metric.name === "navigationFrameCancel").length, 2);
});

test("a job superseded during an item cannot cancel or commit its replacement", () => {
  const f = fixture();
  f.prepare({ layers: [{ items: [1, 2], drawItem() {
    f.setIdentity("scene-b");
    f.prepare();
  } }] });
  const first = f.canvases[0];
  f.flushAll();
  assert.equal(first.width, 0);
  assert.equal(f.owner.isReady(), true);
  assert.equal(f.canvases.length, 2);
  assert.equal(f.budget.snapshot().ownerCount, 1);
  assert.equal(f.metrics.filter((metric) => metric.name === "navigationFramePrepare").length, 1);
});

test("draw covers the viewport during pan and zoom-out without allocating a canvas", () => {
  const f = fixture();
  f.prepare();
  f.flushAll();
  const count = f.canvases.length;
  assert.equal(f.owner.draw(f.destination, { x: 900, y: -700, k: 0.25 }, 2), true);
  assert.equal(f.canvases.length, count);
  assert.deepEqual(f.destinationCalls[0], ["save"]);
  assert.deepEqual(f.destinationCalls[1], ["setTransform", 1, 0, 0, 1, 0, 0]);
  assert.deepEqual(f.destinationCalls[2], ["clearRect", 0, 0, 800, 600]);
  assert.deepEqual(f.destinationCalls[3], ["fillRect", 0, 0, 800, 600]);
  assert.deepEqual(f.destinationCalls[4], ["setTransform", 0.1953125, 0, 0, 0.1953125, 1750, -1425]);
  assert.equal(f.destinationCalls[5][0], "drawImage");
  assert.deepEqual(f.destinationCalls.at(-1), ["restore"]);
  assert.equal(f.metrics.at(-1).name, "navigationFrameReuse");
});

test("detail overlay maps its reference viewport onto the target before restore", () => {
  const f = fixture();
  f.prepare();
  f.flushAll();
  const detail = { width: 1000, height: 600 };
  assert.equal(f.owner.draw(f.destination, { x: 40, y: -20, k: 2 }, 2, {
    detailSource: detail, detailTransform: { x: 100, y: 50, k: 4 }, detailDpr: 1,
  }), true);
  assert.deepEqual(f.destinationCalls[6], ["setTransform", 1, 0, 0, 1, -20, -90]);
  assert.deepEqual(f.destinationCalls[7], ["drawImage", detail, 0, 0]);
  assert.deepEqual(f.destinationCalls[8], ["restore"]);
});

test("invalid identity leaves destination untouched and clear releases retained memory", () => {
  const f = fixture();
  f.prepare();
  f.flushAll();
  f.setIdentity(null);
  assert.equal(f.owner.draw(f.destination, { x: 0, y: 0, k: 1 }, 1), false);
  assert.deepEqual(f.destinationCalls, []);
  assert.equal(f.canvases[0].width, 0);
  assert.equal(f.budget.snapshot().ownerCount, 0);
  f.setIdentity("scene-d");
  f.prepare();
  f.flushAll();
  f.owner.clear();
  assert.equal(f.canvases[1].width, 0);
  assert.equal(f.budget.snapshot().ownerCount, 0);
});

test("invalid geometry or shared resource pressure prevents allocation", () => {
  const f = fixture({ softLimitBytes: 1024 });
  assert.equal(f.prepare(), false);
  assert.equal(f.prepare({ bounds: [[0, 0], [0, 10]] }), false);
  assert.equal(f.canvases.length, 0);
});


test("worker raster publishes atomically during interaction and closes transferred bitmap", async () => {
  const f = fixture();
  let finish;
  let closed = 0;
  f.prepare({ renderRaster: () => new Promise((resolve) => { finish = resolve; }) });
  f.setPaused(true);
  assert.equal(f.owner.isReady(), false);
  finish({ bitmap: { close: () => closed++ } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.owner.isReady(), true);
  assert.equal(closed, 1);
  assert.equal(f.jobs.size, 0);
  assert.equal(f.metrics.at(-1).details.mode, "worker");
});

test("cancelled or obsolete raster cannot replace current pixels and always releases bitmap", async () => {
  for (const action of [f => f.owner.clear(), f => f.setIdentity("scene-b")]) {
    const f = fixture();
    let finish, signal;
    let closed = 0;
    f.prepare({ renderRaster: (options) => { signal = options.signal; return new Promise((resolve) => { finish = resolve; }); } });
    action(f);
    finish({ bitmap: { close: () => closed++ } });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.owner.isReady(), false);
    assert.equal(signal.aborted, true);
    assert.equal(closed, 1);
    assert.equal(f.budget.snapshot().categories.bitmaps ?? 0, 0);
  }
});

test("unavailable worker falls back to existing sliced drawing without publishing partial pixels", async () => {
  const f = fixture();
  let drawn = 0;
  f.prepare({ renderRaster: async () => null, layers: [{ items: [1], drawItem() { drawn++; } }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.owner.isReady(), false);
  assert.equal(drawn, 0);
  f.flushAll();
  assert.equal(f.owner.isReady(), true);
  assert.equal(drawn, 1);
  assert.equal(f.metrics.at(-1).details.mode, "main-fallback");
});

