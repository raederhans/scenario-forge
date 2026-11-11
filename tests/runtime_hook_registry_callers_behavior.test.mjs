import assert from "node:assert/strict";
import test from "node:test";
import {
  bindStateCompatSurface,
  callRuntimeHook,
  registerRuntimeHook,
  STATE_BUS_EVENTS,
  subscribeStateBusEvent,
} from "../js/core/state/index.js";
import { registerSpecialZonesWorkbenchRuntimeHooks } from "../js/core/state/actions/special_zone_actions.js";

test("inspector step-up callers share the registered command and its boolean result", (t) => {
  const target = bindStateCompatSurface({});
  t.after(() => registerRuntimeHook(target, "stepUpInspectorSelectionFn", null));
  for (const result of [true, false]) {
    let calls = 0;
    registerRuntimeHook(target, "stepUpInspectorSelectionFn", () => {
      calls += 1;
      return result;
    });
    assert.equal(callRuntimeHook(target, "stepUpInspectorSelectionFn"), result);
    assert.equal(target.stepUpInspectorSelectionFn(), result);
    assert.equal(calls, 2);
  }
});

test("workbench notifications dispatch through the registry and legacy properties", (t) => {
  const target = {};
  const calls = [];
  const names = ["updateSpecialZonesWorkbenchUIFn", "updateSpecialZonesWorkbenchCurrentTargetUIFn"];
  t.after(() => names.forEach((name) => registerRuntimeHook(target, name, null)));
  registerSpecialZonesWorkbenchRuntimeHooks(target, {
    renderWorkbench: () => { calls.push("workbench"); },
    renderCurrentTarget: () => { calls.push("target"); },
  });
  for (const name of names) {
    let notifications = 0;
    const unsubscribe = subscribeStateBusEvent(STATE_BUS_EVENTS[name], () => { notifications += 1; });
    t.after(unsubscribe);
    assert.doesNotThrow(() => callRuntimeHook(target, name));
    assert.equal(typeof target[name], "function");
    target[name]();
    assert.equal(notifications, 2);
  }
  assert.deepEqual(calls, ["workbench", "workbench", "target", "target"]);
});
