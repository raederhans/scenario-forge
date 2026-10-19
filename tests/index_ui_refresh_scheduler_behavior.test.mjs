import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const renderer = readFileSync(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
const schedulerStart = renderer.indexOf("function cancelPendingIndexUiRefresh() {");
const schedulerEnd = renderer.indexOf("\nfunction normalizeSidebarRefreshIds(", schedulerStart);
const finalizeStart = renderer.indexOf("function finalizeIndexBuildEffects() {");
const finalizeEnd = renderer.indexOf("\nfunction adoptRuntimePoliticalMeta(", finalizeStart);
assert.ok(schedulerStart >= 0 && schedulerEnd > schedulerStart);
assert.ok(finalizeStart >= 0 && finalizeEnd > finalizeStart);

function harness({ animationFrames = true } = {}) {
  let nextHandle = 0;
  const frames = new Map(), tasks = new Map(), canceledFrames = [], canceledTasks = [], calls = [];
  const state = { revision: 1, styleConfig: {} };
  for (const [hook, scope] of [["renderCountryListFn", "country"],
    ["renderWaterRegionListFn", "water"], ["renderSpecialRegionListFn", "special"]]) {
    state[hook] = () => calls.push([scope, state.revision]);
  }
  const context = vm.createContext({
    runtimeState: state,
    pendingIndexUiRefreshHandle: null, pendingIndexUiRefreshState: null,
    deferredIndexUiRefreshHandle: null, deferredIndexUiRefreshState: null,
    setTimeout(callback) { const handle = ++nextHandle; tasks.set(handle, callback); return handle; },
    clearTimeout(handle) { canceledTasks.push(handle); tasks.delete(handle); },
    ...(animationFrames ? {
      requestAnimationFrame(callback) { const handle = ++nextHandle; frames.set(handle, callback); return handle; },
      cancelAnimationFrame(handle) { canceledFrames.push(handle); frames.delete(handle); },
    } : {}),
    notifyDevWorkspace: () => calls.push(["workspace", state.revision]),
    recordUiRefreshMetric() {}, callRuntimeHook() {},
  });
  vm.runInContext(`${renderer.slice(schedulerStart, schedulerEnd)}\n${renderer.slice(finalizeStart, finalizeEnd)}`, context);
  const runNext = queue => {
    const entry = queue.entries().next().value;
    assert.ok(entry, "expected a scheduled callback");
    queue.delete(entry[0]); entry[1]();
  };
  return { context, state, calls, frames, tasks, canceledFrames, canceledTasks,
    frame: () => runNext(frames), task: () => runNext(tasks) };
}

test("index finalization dirties geometry immediately and coalesces latest UI after a frame in a separate task", () => {
  const h = harness();
  h.context.queueIndexUiRefresh({ renderCountryList: true }, "deferred");
  h.context.finalizeIndexBuildEffects();
  h.context.finalizeIndexBuildEffects();
  h.context.queueIndexUiRefresh({ renderWaterRegionList: true, renderSpecialRegionList: true }, "deferred");
  assert.equal(h.state.devSelectionOverlayDirty, true);
  assert.equal(h.state.hitCanvasDirty, true);
  assert.deepEqual(h.calls, []);
  assert.equal(h.frames.size, 1); assert.equal(h.tasks.size, 0);
  h.frame();
  assert.deepEqual(h.calls, [], "the map frame gate does not execute UI work");
  assert.equal(h.frames.size, 0); assert.equal(h.tasks.size, 1);
  h.state.revision = 2;
  h.task();
  assert.deepEqual(h.calls, [["country", 2], ["water", 2], ["special", 2], ["workspace", 2]]);
  assert.equal(h.context.pendingIndexUiRefreshState, null);
  assert.equal(h.context.pendingIndexUiRefreshHandle, null);
});

test("pending immediate and deferred requests merge without adding another UI task", () => {
  const h = harness();
  h.context.queueIndexUiRefresh({ renderCountryList: true });
  h.context.queueIndexUiRefresh({ renderWaterRegionList: true });
  h.context.finalizeIndexBuildEffects();
  assert.equal(h.tasks.size, 1); assert.equal(h.frames.size, 1);
  h.frame();
  assert.equal(h.tasks.size, 1);
  h.task();
  assert.deepEqual(h.calls, [["country", 1], ["water", 1], ["workspace", 1]]);
  h.context.queueIndexUiRefresh({ renderSpecialRegionList: true }, "none");
  assert.equal(h.frames.size, 0); assert.equal(h.tasks.size, 0);
});

test("cancellation uses the right scheduler and stale callbacks cannot consume a new scene's UI work", () => {
  const h = harness();
  h.context.scheduleIndexUiRefresh({ renderCountryList: true });
  h.context.finalizeIndexBuildEffects();
  const [taskHandle, staleTask] = h.tasks.entries().next().value;
  const [frameHandle, staleFrame] = h.frames.entries().next().value;
  h.context.cancelPendingIndexUiRefresh();
  assert.deepEqual(h.canceledTasks, [taskHandle]);
  assert.deepEqual(h.canceledFrames, [frameHandle]);
  assert.equal(h.context.pendingIndexUiRefreshState, null);
  assert.equal(h.context.deferredIndexUiRefreshState, null);
  h.state.revision = 3;
  h.context.scheduleIndexUiRefresh({ renderSpecialRegionList: true });
  h.context.finalizeIndexBuildEffects();
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
    h.context.queueIndexUiRefresh({ renderWaterRegionList: true });
  };
  h.context.scheduleIndexUiRefresh({ renderCountryList: true });
  h.task();
  assert.deepEqual(h.calls, [["country", 1]]); assert.equal(h.tasks.size, 1);
  h.state.revision = 4; h.task();
  assert.deepEqual(h.calls, [["country", 1], ["water", 4]]);
});

test("the no-animation-frame fallback still separates the gate and UI tasks and supports cancellation", () => {
  const h = harness({ animationFrames: false });
  h.context.finalizeIndexBuildEffects();
  const canceledHandle = h.tasks.keys().next().value;
  h.context.cancelPendingIndexUiRefresh();
  assert.deepEqual(h.canceledTasks, [canceledHandle]);
  h.context.finalizeIndexBuildEffects();
  h.task(); assert.deepEqual(h.calls, []); assert.equal(h.tasks.size, 1);
  h.task(); assert.deepEqual(h.calls, [["workspace", 1]]);
});
