import assert from "node:assert/strict";
import test from "node:test";
import { createNavigationFrameOwner } from "../js/core/renderer/navigation_frame_owner.js";

function fixture() {
  const jobs = new Map();
  let identity = "scene-a";
  let nextTimer = 1;
  const createCanvas = () => {
    const context = {
      setTransform() {}, save() {}, restore() {}, transform() {}, drawImage() {}, fillRect() {},
    };
    return { width: 0, height: 0, getContext: () => context };
  };
  const owner = createNavigationFrameOwner({
    getIdentity: () => identity,
    createCanvas,
    schedule(callback) {
      const timer = nextTimer++;
      jobs.set(timer, callback);
      return timer;
    },
    cancel: (timer) => jobs.delete(timer),
    now: () => 0,
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
    owner, prepare, flushAll, destination, destinationCalls,
    setIdentity: (value) => { identity = value; },
  };
}

test("whole-scene capture requires complete world coverage", () => {
  const f = fixture();
  const source = { width: 800, height: 600 };
  assert.equal(f.owner.captureWholeScene(source, { x: 0, y: 0, k: 1 }, 2, [[-100, -50], [300, 150]]), false);
  assert.equal(f.owner.captureWholeScene(source, { x: 200, y: 100, k: 2 }, 2, [[-100, -50], [300, 150]]), false);
  assert.equal(f.owner.isReady(), false);
  assert.equal(f.owner.captureWholeScene({ width: 1600, height: 1000 },
    { x: 120, y: 70, k: 1 }, 2, [[-100, -50], [300, 150]]), true);
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
  }
});
