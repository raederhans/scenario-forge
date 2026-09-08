import assert from "node:assert/strict";
import test from "node:test";
import { createRenderDispatcher } from "../js/bootstrap/startup_bootstrap_support.js";
import { bindRenderBoundary, requestRender, flushRenderBoundary, markRenderBoundaryFlushed } from "../js/core/render_boundary.js";

function frames(t) {
  const callbacks = [];
  const cancelled = [];
  t.mock.method(globalThis, "requestAnimationFrame", fn => { callbacks.push(fn); return callbacks.length - 1; });
  t.mock.method(globalThis, "cancelAnimationFrame", id => cancelled.push(id));
  return { callbacks, cancelled };
}

// Node has no animation-frame globals; mock.method needs properties to exist.
globalThis.requestAnimationFrame ??= () => {};
globalThis.cancelAnimationFrame ??= () => {};

test("boundary burst plus synchronous flush renders once and cancels queued frame zero", t => {
  const { callbacks, cancelled } = frames(t);
  let renders = 0;
  const dispatcher = createRenderDispatcher(() => { renders++; markRenderBoundaryFlushed(); });
  bindRenderBoundary({ scheduleRender: dispatcher.schedule, flushRender: dispatcher.flush });
  t.after(() => bindRenderBoundary());
  requestRender("color"); requestRender("overlay"); requestRender("color");
  assert.equal(callbacks.length, 1);
  flushRenderBoundary("export");
  assert.equal(renders, 1);
  assert.deepEqual(cancelled, [0]);
  callbacks[0](); // Even an already-delivered callback is harmless.
  assert.equal(renders, 1);
  requestRender("next-edit");
  callbacks[0]();
  assert.equal(renders, 1, "old callback cannot consume new edit");
  callbacks[1]();
  assert.equal(renders, 2);
});

test("explicit flush remains synchronous without pending work and reentrant schedule survives", t => {
  const { callbacks } = frames(t);
  let renders = 0;
  const dispatcher = createRenderDispatcher(() => {
    renders++;
    if (renders === 1) dispatcher.schedule();
  });
  dispatcher.flush();
  assert.equal(renders, 1);
  callbacks[0]();
  assert.equal(renders, 2);
  dispatcher.flush();
  assert.equal(renders, 3);
});

test("render failure does not leave a queued duplicate or prevent a later request", t => {
  const { callbacks } = frames(t);
  let renders = 0;
  const dispatcher = createRenderDispatcher(() => { if (++renders === 1) throw Error("render failed"); });
  dispatcher.schedule();
  assert.throws(dispatcher.flush, /render failed/);
  callbacks[0]();
  assert.equal(renders, 1);
  dispatcher.schedule(); callbacks[1]();
  assert.equal(renders, 2);
});

test("failed animation-frame enqueue can be retried", t => {
  const { callbacks } = frames(t);
  const enqueue = globalThis.requestAnimationFrame;
  let failed = false;
  t.mock.method(globalThis, "requestAnimationFrame", fn => {
    if (!failed) { failed = true; throw Error("enqueue failed"); }
    return enqueue(fn);
  });
  let renders = 0;
  const dispatcher = createRenderDispatcher(() => renders++);
  assert.throws(dispatcher.schedule, /enqueue failed/);
  dispatcher.schedule(); callbacks[0]();
  assert.equal(renders, 1);
});
