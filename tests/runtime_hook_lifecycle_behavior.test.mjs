import assert from "node:assert/strict";
import test from "node:test";
import {
  callRequiredRuntimeHook, callRuntimeHook, registerRuntimeHook,
  registerOwnedRuntimeHook, readRuntimeHook, subscribeStateBusEvent, off, STATE_BUS_EVENTS,
  requestRuntimeHookAfterPaint,
} from "../js/core/state/index.js";

for (const name of ["updateScenarioUIFn", "noteFirstVisibleFramePaintedFn"]) {
  test(`${name}: old cleanup preserves replacement, including reused callbacks`, () => {
    const target = {};
    let calls = 0;
    const fn = () => ++calls;
    const old = registerOwnedRuntimeHook(target, name, fn);
    const next = registerOwnedRuntimeHook(target, name, fn);
    old(); old();
    callRuntimeHook(target, name);
    assert.equal(calls, 1);
    next();
    assert.equal(readRuntimeHook(target, name), null);
    const replaced = registerOwnedRuntimeHook(target, name, fn);
    const latest = registerRuntimeHook(target, name, fn);
    replaced();
    next();
    assert.equal(readRuntimeHook(target, name), latest);
    registerRuntimeHook(target, name, null);
  });
}

test("notification disposal leaves independent observers and absent notifications are safe", () => {
  const name = "updateScenarioUIFn";
  const event = STATE_BUS_EVENTS[name];
  let observed = 0;
  const observer = subscribeStateBusEvent(event, () => ++observed);
  const dispose = registerOwnedRuntimeHook({}, name, () => "owner");
  dispose();
  assert.deepEqual(callRuntimeHook({}, name), [1]);
  off(event, observer);
  assert.deepEqual(callRuntimeHook({}, name), []);
});

test("required commands fail when absent, preserve arguments/results/errors, and reject notifications", () => {
  const target = {};
  const name = "noteFirstVisibleFramePaintedFn";
  assert.throws(() => callRequiredRuntimeHook(target, name), /not registered/);
  assert.throws(() => callRequiredRuntimeHook(target, "updateScenarioUIFn"), /must be a handler/);
  assert.throws(() => registerOwnedRuntimeHook(target, "unknown", () => {}), /Unknown/);
  assert.throws(() => registerOwnedRuntimeHook(target, name, null), /requires a function/);
  const result = {};
  const dispose = registerOwnedRuntimeHook(target, name, (...args) => {
    assert.deepEqual(args, [true, "reason"]);
    return result;
  });
  assert.equal(callRequiredRuntimeHook(target, name, true, "reason"), result);
  dispose();
  const failure = new Error("failed");
  const release = registerOwnedRuntimeHook(target, name, () => { throw failure; });
  assert.throws(() => callRequiredRuntimeHook(target, name), error => error === failure);
  release();
});

test("unknown hook registration and dispatch fail instead of silently losing commands", () => {
  const target = { ordinaryField: true };
  assert.throws(() => registerRuntimeHook(target, "misspelledHookFn", () => {}), /Unknown runtime hook/);
  assert.throws(() => callRuntimeHook(target, "misspelledHookFn"), /Unknown runtime hook/);
  assert.deepEqual(Object.keys(target), ["ordinaryField"]);
});

test("internal renderer commands and first-frame checkpoint dispatch without adding state properties", () => {
  for (const name of ["noteFirstVisibleFramePaintedFn", "syncDayNightClockTimerFn", "resolveSpecialZoneParentGroupTargetIdsFn"]) {
    const payload = { featureId: "A" };
    const dispose = registerOwnedRuntimeHook(null, name, received => {
      assert.equal(received, payload);
      return payload;
    });
    try {
      assert.equal(callRuntimeHook(null, name, payload), payload);
    } finally {
      dispose();
    }
    assert.equal(callRuntimeHook(null, name, payload), undefined);
  }
});

test("after-paint panel requests coalesce until the frame paints; direct hook calls stay synchronous", () => {
  const name = "updateToolbarInputsFn";
  const frames = [], timers = [];
  const previous = { requestAnimationFrame: globalThis.requestAnimationFrame, setTimeout: globalThis.setTimeout };
  globalThis.requestAnimationFrame = (callback) => frames.push(callback);
  globalThis.setTimeout = (callback) => timers.push(callback);
  const target = {};
  let calls = 0;
  const dispose = registerOwnedRuntimeHook(target, name, () => { calls += 1; });
  try {
    requestRuntimeHookAfterPaint(target, name);
    requestRuntimeHookAfterPaint(target, name);
    assert.equal(calls, 0, "nothing runs inside the requesting frame");
    assert.equal(frames.length, 1, "a burst schedules one frame");
    frames.shift()();
    assert.equal(calls, 0, "frame callbacks run before paint, so the refresh waits for a timer");
    timers.shift()();
    assert.equal(calls, 1, "the burst refreshes once");

    callRuntimeHook(target, name);
    target[name]();
    assert.equal(calls, 3, "direct calls keep their synchronous effect");
    assert.equal(frames.length, 0);
    assert.throws(() => requestRuntimeHookAfterPaint(target, "noteFirstVisibleFramePaintedFn"), /notification hook/);
  } finally {
    dispose();
    globalThis.requestAnimationFrame = previous.requestAnimationFrame;
    globalThis.setTimeout = previous.setTimeout;
  }
});

test("after-paint requests run immediately without a frame scheduler and call the target's own hook", () => {
  const spy = [];
  const harness = { updateDynamicBorderStatusUIFn: () => spy.push("own") };
  requestRuntimeHookAfterPaint(harness, "updateDynamicBorderStatusUIFn");
  assert.deepEqual(spy, ["own"]);
});
