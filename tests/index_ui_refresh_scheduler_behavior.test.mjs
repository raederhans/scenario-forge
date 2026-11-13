import test from "node:test";
import assert from "node:assert/strict";
import { createIndexUiRefreshScheduler } from "../js/core/renderer/index_ui_refresh_scheduler.js";

function harness({ animationFrames = true } = {}) {
  let nextHandle = 0;
  const frames = new Map(), tasks = new Map(), canceledFrames = [], canceledTasks = [], calls = [];
  const state = { revision: 1, styleConfig: {} };
  for (const [hook, scope] of [["renderCountryListFn", "country"],
    ["renderWaterRegionListFn", "water"], ["renderSpecialRegionListFn", "special"]]) {
    state[hook] = () => calls.push([scope, state.revision]);
  }
  const owner = createIndexUiRefreshScheduler({
    runtimeState: state,
    setTimeout(callback) { const handle = ++nextHandle; tasks.set(handle, callback); return handle; },
    clearTimeout(handle) { canceledTasks.push(handle); tasks.delete(handle); },
    ...(animationFrames ? {
      requestAnimationFrame(callback) { const handle = ++nextHandle; frames.set(handle, callback); return handle; },
      cancelAnimationFrame(handle) { canceledFrames.push(handle); frames.delete(handle); },
    } : {}),
    notifyDevWorkspace: () => calls.push(["workspace", state.revision]),
    recordUiRefreshMetric() {}, callRuntimeHook() {},
  });
  const runNext = queue => {
    const entry = queue.entries().next().value;
    assert.ok(entry, "expected a scheduled callback");
    queue.delete(entry[0]); entry[1]();
  };
  return { owner, state, calls, frames, tasks, canceledFrames, canceledTasks,
    frame: () => runNext(frames), task: () => runNext(tasks) };
}

test("deferred requests coalesce latest UI after a frame in a separate task", () => {
  const h = harness();
  h.owner.queueIndexUiRefresh({ renderCountryList: true }, "deferred");
  h.owner.queueIndexUiRefresh({ renderDevWorkspace: true }, "deferred");
  h.owner.queueIndexUiRefresh({ renderDevWorkspace: true }, "deferred");
  h.owner.queueIndexUiRefresh({ renderWaterRegionList: true, renderSpecialRegionList: true }, "deferred");
  assert.deepEqual(h.calls, []);
  assert.equal(h.frames.size, 1); assert.equal(h.tasks.size, 0);
  h.frame();
  assert.deepEqual(h.calls, [], "the map frame gate does not execute UI work");
  assert.equal(h.frames.size, 0); assert.equal(h.tasks.size, 1);
  h.state.revision = 2;
  h.task();
  assert.deepEqual(h.calls, [["country", 2], ["water", 2], ["special", 2], ["workspace", 2]]);
  assert.equal(h.frames.size, 0);
  assert.equal(h.tasks.size, 0);
  h.owner.queueIndexUiRefresh({ renderWaterRegionList: true });
  assert.equal(h.tasks.size, 1);
  h.task();
  assert.deepEqual(h.calls, [["country", 2], ["water", 2], ["special", 2], ["workspace", 2], ["water", 2]]);
  assert.equal(h.tasks.size, 0);
});

test("pending immediate and deferred requests merge without adding another UI task", () => {
  const h = harness();
  h.owner.queueIndexUiRefresh({ renderCountryList: true });
  h.owner.queueIndexUiRefresh({ renderWaterRegionList: true });
  h.owner.queueIndexUiRefresh({ renderDevWorkspace: true }, "deferred");
  assert.equal(h.tasks.size, 1); assert.equal(h.frames.size, 1);
  h.frame();
  assert.equal(h.tasks.size, 1);
  h.task();
  assert.deepEqual(h.calls, [["country", 1], ["water", 1], ["workspace", 1]]);
  h.owner.queueIndexUiRefresh({ renderSpecialRegionList: true }, "none");
  assert.equal(h.frames.size, 0); assert.equal(h.tasks.size, 0);
});

test("cancellation uses the right scheduler and stale callbacks cannot consume a new scene's UI work", () => {
  const h = harness();
  h.owner.scheduleIndexUiRefresh({ renderCountryList: true });
  h.owner.queueIndexUiRefresh({ renderDevWorkspace: true }, "deferred");
  const [taskHandle, staleTask] = h.tasks.entries().next().value;
  const [frameHandle, staleFrame] = h.frames.entries().next().value;
  h.owner.cancelPendingIndexUiRefresh();
  assert.deepEqual(h.canceledTasks, [taskHandle]);
  assert.deepEqual(h.canceledFrames, [frameHandle]);
  assert.equal(h.tasks.size, 0);
  assert.equal(h.frames.size, 0);
  h.state.revision = 3;
  h.owner.scheduleIndexUiRefresh({ renderSpecialRegionList: true });
  h.owner.queueIndexUiRefresh({ renderDevWorkspace: true }, "deferred");
  staleTask(); staleFrame();
  assert.deepEqual(h.calls, []);
  assert.equal(h.tasks.size, 1); assert.equal(h.frames.size, 1);
  h.frame(); h.task();
  assert.deepEqual(h.calls, [["special", 3], ["workspace", 3]]);
});

test("a UI callback can queue a later refresh without losing its request", () => {
  const h = harness();
  h.state.renderCountryListFn = () => {
    h.calls.push(["country", h.state.revision]);
    h.owner.queueIndexUiRefresh({ renderWaterRegionList: true });
  };
  h.owner.scheduleIndexUiRefresh({ renderCountryList: true });
  h.task();
  assert.deepEqual(h.calls, [["country", 1]]); assert.equal(h.tasks.size, 1);
  h.state.revision = 4; h.task();
  assert.deepEqual(h.calls, [["country", 1], ["water", 4]]);
});

test("the no-animation-frame fallback still separates the gate and UI tasks and supports cancellation", () => {
  const h = harness({ animationFrames: false });
  h.owner.queueIndexUiRefresh({ renderDevWorkspace: true }, "deferred");
  const canceledHandle = h.tasks.keys().next().value;
  h.owner.cancelPendingIndexUiRefresh();
  assert.deepEqual(h.canceledTasks, [canceledHandle]);
  h.owner.queueIndexUiRefresh({ renderDevWorkspace: true }, "deferred");
  h.task(); assert.deepEqual(h.calls, []); assert.equal(h.tasks.size, 1);
  h.task(); assert.deepEqual(h.calls, [["workspace", 1]]);
});
