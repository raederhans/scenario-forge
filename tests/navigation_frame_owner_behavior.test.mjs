import assert from "node:assert/strict";
import test from "node:test";

import { createNavigationFrameOwner } from "../js/core/renderer/navigation_frame_owner.js";
import { createRuntimeResourceBudget } from "../js/core/runtime_resource_budget.js";

function fixture({ softLimitBytes = 16 * 1024 * 1024, qualityLimits } = {}) {
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
    qualityLimits,
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
    detailSource: detail, detailTransform: { x: 50, y: 25, k: 2.5 }, detailDpr: 2,
  }), true);
  assert.deepEqual(f.destinationCalls[6], ["setTransform", 0.8, 0, 0, 0.8, 0, -80]);
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

test("invalid geometry prevents allocation without changing shared budget limits", () => {
  const f = fixture({ softLimitBytes: 1024 });
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



test("world device-pixel magnification is decided before destination clearing", () => {
  const f = fixture();
  f.prepare();
  f.flushAll();
  assert.equal(f.owner.draw(f.destination, { x: 0, y: 0, k: 5.12 }, 1), true, "exactly 2x is admitted");
  assert.equal(f.metrics.at(-1).details.worldMagnification, 2);
  f.destinationCalls.length = 0;
  assert.equal(f.owner.draw(f.destination, { x: 0, y: 0, k: 5.12001 }, 1), false);
  assert.deepEqual(f.destinationCalls, []);
  assert.equal(f.metrics.at(-1).details.reason, "raster-quality");
  assert.equal(f.owner.draw(f.destination, { x: 0, y: 0, k: 3 }, 2), false, "higher DPR exceeds the same device-pixel ceiling");
  assert.deepEqual(f.destinationCalls, []);
  assert.equal(f.owner.isReady(), true, "quality rejection does not evict the bounded world frame");
});

test("a sharp detail can replace blurry world pixels only with full target coverage", () => {
  const f = fixture();
  f.prepare();
  f.flushAll();
  const detail = { width: 800, height: 600 };
  const transform = { x: 0, y: 0, k: 8 };
  assert.equal(f.owner.draw(f.destination, transform, 1, {
    detailSource: detail, detailTransform: transform, detailDpr: 1,
  }), true);
  assert.deepEqual(f.destinationCalls.filter(([kind]) => kind === "drawImage"), [["drawImage", detail, 0, 0]]);
  assert.equal(f.metrics.at(-1).details.detailOnly, true);
  assert.equal(f.metrics.at(-1).details.worldQualityOK, false);
  f.destinationCalls.length = 0;
  for (const partial of [{ width: 799, height: 600 }, { width: 800, height: 599 }]) {
    assert.equal(f.owner.draw(f.destination, transform, 1, {
      detailSource: partial, detailTransform: transform, detailDpr: 1,
    }), false);
    assert.deepEqual(f.destinationCalls, []);
    assert.equal(f.metrics.at(-1).details.detailQualityOK, true);
    assert.equal(f.metrics.at(-1).details.detailCoversViewport, false);
  }
  for (const x of [-1, 1]) {
    assert.equal(f.owner.draw(f.destination, { ...transform, x }, 1, {
      detailSource: detail, detailTransform: transform, detailDpr: 1,
    }), false, "an uncovered edge cannot be filled by low-quality world pixels");
    assert.deepEqual(f.destinationCalls, []);
  }
  assert.equal(f.owner.draw(f.destination, { ...transform, x: -10 }, 1, {
    detailSource: { width: 820, height: 600 }, detailTransform: transform, detailDpr: 1,
  }), true, "oversized detail coverage tolerates pan while covering every target pixel");
});

test("detail CSS ratio and device-pixel magnification enforce independent quality bounds", () => {
  for (const ratio of [0.8, 1.25]) {
    const f = fixture();
    f.prepare();
    f.flushAll();
    const detail = { width: 1000, height: 750 };
    assert.equal(f.owner.draw(f.destination, { x: 0, y: 0, k: 8 }, 1, {
      detailSource: detail, detailTransform: { x: 0, y: 0, k: 8 / ratio }, detailDpr: 1,
    }), true);
    assert.equal(f.metrics.at(-1).details.detailCssScaleRatio, ratio);
  }
  for (const ratio of [0.799, 1.251, 0.5, 2]) {
    const f = fixture();
    f.prepare();
    f.flushAll();
    assert.equal(f.owner.draw(f.destination, { x: 0, y: 0, k: 8 }, 1, {
      detailSource: { width: 4000, height: 4000 }, detailTransform: { x: 0, y: 0, k: 8 / ratio }, detailDpr: 1,
    }), false, "large coverage does not admit a detail with an excessive CSS scale change");
    assert.deepEqual(f.destinationCalls, []);
  }
  for (const [dpr, expected] of [[1.5, true], [1.501, false], [2, false]]) {
    const f = fixture();
    f.prepare();
    f.flushAll();
    assert.equal(f.owner.draw(f.destination, { x: 0, y: 0, k: 8 }, dpr, {
      detailSource: { width: 800, height: 600 }, detailTransform: { x: 0, y: 0, k: 8 }, detailDpr: 1,
    }), expected);
    if (!expected) assert.deepEqual(f.destinationCalls, []);
  }
  const f = fixture();
  f.prepare();
  f.flushAll();
  assert.equal(f.owner.draw(f.destination, { x: 0, y: 0, k: 8 }, 2, {
    detailSource: { width: 800, height: 600 }, detailTransform: { x: 0, y: 0, k: 8 }, detailDpr: 2,
  }), true, "equal source and target DPR avoids device-pixel enlargement");
});

test("world quality allows sharp partial details and skips unqualified overlays", () => {
  const transform = { x: 0, y: 0, k: 1 };
  const f = fixture();
  f.prepare();
  f.flushAll();
  const detail = { width: 100, height: 100 };
  assert.equal(f.owner.draw(f.destination, transform, 1, {
    detailSource: detail, detailTransform: transform, detailDpr: 1,
  }), true);
  assert.equal(f.destinationCalls.filter(([kind]) => kind === "drawImage").length, 2);
  f.destinationCalls.length = 0;
  assert.equal(f.owner.draw(f.destination, transform, 1, {
    detailSource: detail, detailTransform: { ...transform, k: 2 }, detailDpr: 1,
  }), true);
  assert.deepEqual(f.destinationCalls.filter(([kind]) => kind === "drawImage"), [["drawImage", f.canvases[0], 0, 0]]);
  assert.equal(f.metrics.at(-1).details.detail, false);
});

test("invalid transforms, DPR, dimensions and overflow never mutate the destination", () => {
  const f = fixture();
  f.prepare();
  f.flushAll();
  for (const transform of [
    { x: NaN, y: 0, k: 1 }, { x: 0, y: Infinity, k: 1 }, { x: 0, y: 0, k: 0 },
    { x: 0, y: 0, k: -1 }, { x: 0, y: 0, k: Infinity }, { x: 1e308, y: 0, k: 1e308 },
  ]) {
    assert.equal(f.owner.draw(f.destination, transform, 1), false);
    assert.deepEqual(f.destinationCalls, []);
  }
  for (const dpr of [0, -1, NaN, Infinity]) {
    assert.equal(f.owner.draw(f.destination, { x: 0, y: 0, k: 1 }, dpr), false);
    assert.deepEqual(f.destinationCalls, []);
  }
  for (const options of [
    { detailSource: { width: 0, height: 600 }, detailTransform: { x: 0, y: 0, k: 8 }, detailDpr: 1 },
    { detailSource: { width: 800, height: Infinity }, detailTransform: { x: 0, y: 0, k: 8 }, detailDpr: 1 },
    { detailSource: { width: 800, height: 600 }, detailTransform: { x: NaN, y: 0, k: 8 }, detailDpr: 1 },
    { detailSource: { width: 800, height: 600 }, detailTransform: { x: 0, y: 0, k: 0 }, detailDpr: 1 },
    { detailSource: { width: 800, height: 600 }, detailTransform: { x: 0, y: 0, k: 8 }, detailDpr: NaN },
    { detailSource: { width: 800, height: 600 }, detailTransform: { x: 1e308, y: 0, k: 8 }, detailDpr: 2 },
    { detailSource: f.destination.canvas, detailTransform: { x: 0, y: 0, k: 8 }, detailDpr: 1 },
  ]) {
    assert.equal(f.owner.draw(f.destination, { x: 0, y: 0, k: 8 }, 2, options), false);
    assert.deepEqual(f.destinationCalls, []);
  }
});

test("capture rejects malformed or nonfinite coverage without allocation", () => {
  const f = fixture();
  const source = { width: 800, height: 600 };
  for (const bounds of [[], [null, null], [[0, 0], [NaN, 10]], [[10, 10], [0, 0]], [[0, 0], [0, 10]]]) {
    assert.equal(f.owner.captureWholeScene(source, { x: 0, y: 0, k: 1 }, 1, bounds), false);
  }
  assert.equal(f.owner.captureWholeScene({ width: Infinity, height: 600 }, { x: 0, y: 0, k: 1 }, 1, [[0, 0], [100, 100]]), false);
  assert.equal(f.canvases.length, 0);
});

test("quality thresholds can be made stricter without changing coverage requirements", () => {
  const f = fixture({ qualityLimits: {
    worldMaxDevicePixelMagnification: 1,
    detailMinCssScaleRatio: 0.95, detailMaxCssScaleRatio: 1.05,
    detailMaxDevicePixelMagnification: 1.2,
  } });
  f.prepare();
  f.flushAll();
  assert.equal(f.owner.draw(f.destination, { x: 0, y: 0, k: 3 }, 1), false);
  assert.deepEqual(f.destinationCalls, []);
  assert.equal(f.owner.draw(f.destination, { x: 0, y: 0, k: 3 }, 1, {
    detailSource: { width: 800, height: 600 }, detailTransform: { x: 0, y: 0, k: 3 }, detailDpr: 1,
  }), true);
  assert.equal(f.metrics.at(-1).details.detailOnly, true);
  assert.throws(() => fixture({ qualityLimits: { worldMaxDevicePixelMagnification: Infinity } }), /quality limits/);
});

test("required pass pressure does not evict navigation or prevent bounded sliced preparation", () => {
  const f = fixture({ softLimitBytes: 1024 });
  const requiredOwner = Symbol("required-pass-canvases");
  f.budget.update(requiredOwner, { bitmaps: 8 * 1024 * 1024 });
  assert.equal(f.budget.snapshot().pressure, true);
  assert.equal(f.prepare({ bounds: [[0, 0], [100, 100]], maxDimension: 100000 }), true);
  assert.deepEqual([f.canvases[0].width, f.canvases[0].height], [1024, 1024]);
  f.flushAll();
  assert.equal(f.owner.isReady(), true);
  assert.equal(f.budget.snapshot().categories.bitmaps, 12 * 1024 * 1024);
  assert.equal(f.budget.snapshot().softLimitBytes, 1024);
  assert.equal(f.budget.snapshot().pressure, true, "navigation does not conceal whole-page pressure");
  assert.equal(f.owner.draw(f.destination, { x: 0, y: 0, k: 1 }, 1), true);
  assert.equal(f.owner.isReady(), true);
  assert.equal(f.prepare(), false);
  assert.equal(f.canvases.length, 1);
  f.owner.clear();
  assert.equal(f.budget.snapshot().categories.bitmaps, 8 * 1024 * 1024);
});

test("worker publication and fallback survive required-pass pressure within the navigation cap", async () => {
  for (const workerFails of [false, true]) {
    const f = fixture({ softLimitBytes: 1024 });
    f.budget.update(Symbol("required-passes"), { bitmaps: 8 * 1024 * 1024 });
    let closed = 0;
    assert.equal(f.prepare({ renderRaster: async () => workerFails ? null : { bitmap: { close: () => closed++ } } }), true);
    await new Promise((resolve) => setImmediate(resolve));
    if (workerFails) {
      assert.equal(f.owner.isReady(), false);
      f.flushAll();
    }
    assert.equal(f.owner.isReady(), true);
    assert.equal(closed, workerFails ? 0 : 1);
    const navigationBytes = f.canvases.reduce((sum, canvas) => sum + canvas.width * canvas.height * 4, 0);
    assert.ok(navigationBytes <= 8 * 1024 * 1024);
    assert.equal(f.budget.snapshot().categories.bitmaps, 8 * 1024 * 1024 + navigationBytes);
    assert.equal(f.budget.snapshot().softLimitBytes, 1024);
  }
});
