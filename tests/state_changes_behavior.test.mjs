import test from "node:test";
import assert from "node:assert/strict";

import { off, on } from "../js/core/state/bus.js";
import { STATE_BUS_EVENTS } from "../js/core/state/config.js";
import {
  commitChange,
  flushPanelRefreshNow,
  hasPendingPanelRefresh,
  subscribeChanges,
} from "../js/core/state/changes.js";

function listen(hookNames) {
  const calls = [];
  const listeners = hookNames.map((hookName) => {
    const listener = () => calls.push(hookName);
    on(STATE_BUS_EVENTS[hookName], listener);
    return [STATE_BUS_EVENTS[hookName], listener];
  });
  return { calls, dispose: () => listeners.forEach(([eventName, listener]) => off(eventName, listener)) };
}

function withFrameScheduler(run) {
  const frames = [];
  const timers = [];
  const previous = { raf: globalThis.requestAnimationFrame, timeout: globalThis.setTimeout };
  globalThis.requestAnimationFrame = (callback) => frames.push(callback);
  globalThis.setTimeout = (callback) => timers.push(callback);
  const paint = () => {
    frames.splice(0).forEach((callback) => callback());
    timers.splice(0).forEach((callback) => callback());
  };
  try {
    run(paint);
  } finally {
    globalThis.requestAnimationFrame = previous.raf;
    globalThis.setTimeout = previous.timeout;
  }
}

test("without a frame scheduler panels refresh immediately", () => {
  const { calls, dispose } = listen(["updateHistoryUIFn", "updateProjectSaveStatusFn"]);
  try {
    commitChange({ domains: ["dirty", "history"] });
    assert.deepEqual(calls, ["updateHistoryUIFn", "updateProjectSaveStatusFn"]);
    assert.equal(hasPendingPanelRefresh(), false);
  } finally {
    dispose();
  }
});

test("changes in one frame refresh each panel once, after the frame is painted", () => {
  const { calls, dispose } = listen(["updateHistoryUIFn", "updateProjectSaveStatusFn", "updateRecentUI"]);
  try {
    withFrameScheduler((paint) => {
      commitChange({ domains: ["dirty"] });
      commitChange({ domains: ["history", "recentColors"] });
      commitChange({ domains: ["history", "dirty"] });
      assert.deepEqual(calls, []);
      assert.equal(hasPendingPanelRefresh(), true);
      paint();
      assert.deepEqual(calls, ["updateHistoryUIFn", "updateProjectSaveStatusFn", "updateRecentUI"]);
      assert.equal(hasPendingPanelRefresh(), false);
    });
  } finally {
    dispose();
  }
});

test("an explicit flush refreshes pending panels without waiting for paint", () => {
  const { calls, dispose } = listen(["updateHistoryUIFn"]);
  try {
    withFrameScheduler((paint) => {
      commitChange({ domains: ["history"] });
      flushPanelRefreshNow();
      assert.deepEqual(calls, ["updateHistoryUIFn"]);
      paint();
      assert.deepEqual(calls, ["updateHistoryUIFn"]);
    });
  } finally {
    dispose();
  }
});

test("a failing panel does not stop the others", () => {
  const reported = [];
  const previousReportError = globalThis.reportError;
  globalThis.reportError = (error) => reported.push(error.message);
  const failing = () => { throw new Error("panel failed"); };
  on(STATE_BUS_EVENTS.updateHistoryUIFn, failing);
  const { calls, dispose } = listen(["updateProjectSaveStatusFn"]);
  try {
    commitChange({ domains: ["history", "dirty"] });
    assert.deepEqual(calls, ["updateProjectSaveStatusFn"]);
    assert.deepEqual(reported, ["panel failed"]);
  } finally {
    off(STATE_BUS_EVENTS.updateHistoryUIFn, failing);
    dispose();
    globalThis.reportError = previousReportError;
  }
});

test("sync subscribers see each change immediately; unknown domains are rejected", () => {
  const seen = [];
  const unsubscribe = subscribeChanges((change) => seen.push(change));
  try {
    withFrameScheduler(() => {
      commitChange({ domains: ["tool"], reason: "set-tool" });
      assert.deepEqual(seen, [{ domains: ["tool"], reason: "set-tool" }]);
      flushPanelRefreshNow();
    });
    assert.throws(() => commitChange({ domains: ["nope"] }), /Unknown change domain: nope/);
  } finally {
    unsubscribe();
  }
});
