import assert from "node:assert/strict";
import test from "node:test";
import * as facade from "../js/core/state/index.js";
import * as hooks from "../js/core/state/runtime_hooks.js";

import {
  bindStateCompatSurface,
  callCompatRuntimeHook,
  captureCompatRuntimeHook,
  readRegisteredRuntimeHookSource,
  registerRuntimeHook,
} from "../js/core/state/index.js";

test("legacy facade preserves all domain exports and forwards the same lightweight hook API", async () => {
  const domains = await Promise.all([
    import("../js/core/state_defaults.js"),
    import("../js/core/state_catalog.js"),
    import("../js/core/state/boot_state.js"),
    import("../js/core/state/content_state.js"),
    import("../js/core/state/color_state.js"),
    import("../js/core/state/ui_state.js"),
  ]);
  const expected = Object.assign({}, ...domains, hooks);
  assert.deepEqual(Object.keys(facade).sort(), Object.keys(expected).sort());
  for (const [name, value] of Object.entries(expected)) {
    assert.equal(facade[name], value, `${name} keeps its original provider identity`);
  }
  const root = await import("../js/core/state.js");
  assert.equal(root.bindStateCompatSurface, hooks.bindStateCompatSurface);
  assert.equal(root.callRuntimeHook, hooks.callRuntimeHook);
});

test("registrations and bus observers interoperate across legacy and lightweight entries", (t) => {
  const target = bindStateCompatSurface({});
  const name = "updateRecentUI";
  const event = hooks.STATE_BUS_EVENTS[name];
  const observed = [];
  const listener = facade.on(event, payload => { observed.push(payload); });
  t.after(() => {
    facade.off(event, listener);
    hooks.registerRuntimeHook(target, name, null);
    facade.registerRuntimeHook(target, "getViewportGeoBoundsFn", null);
  });
  facade.registerRuntimeHook(target, name, (...args) => args);
  assert.deepEqual(hooks.callRuntimeHook(null, name, "recent", 2), [undefined, ["recent", 2]]);
  assert.deepEqual(observed, [{ __runtimeHookArgs: ["recent", 2] }]);
  assert.equal(hooks.readRegisteredRuntimeHookSource(null, name), facade.readRegisteredRuntimeHookSource(target, name));
  hooks.registerRuntimeHook(null, "getViewportGeoBoundsFn", value => value);
  const result = {};
  assert.equal(facade.callRuntimeHook(target, "getViewportGeoBoundsFn", result), result);
  assert.equal(target.getViewportGeoBoundsFn(result), result);
});

test("captured compatibility callbacks preserve the original bare-call receiver after replacement", () => {
  const result = {};
  const target = { ensureContextLayerDataFn: function (...args) {
    assert.equal(this, undefined);
    assert.deepEqual(args, [["physical-contours-set"], { renderNow: false }]);
    return result;
  } };
  const captured = captureCompatRuntimeHook(target, "ensureContextLayerDataFn");
  target.ensureContextLayerDataFn = () => { throw new Error("replacement must not run"); };
  assert.equal(captured(["physical-contours-set"], { renderNow: false }), result);
  const failure = new Error("loader failed");
  assert.throws(captureCompatRuntimeHook({ ensureContextLayerDataFn() { throw failure; } },
    "ensureContextLayerDataFn"), (error) => error === failure);
  assert.equal(captureCompatRuntimeHook({}, "ensureContextLayerDataFn"), undefined);
  assert.throws(() => captureCompatRuntimeHook({}, "unknown"), /Unknown runtime hook/);
});

test("plain compatibility hooks preserve receiver, arguments, return values, and fields", () => {
  const calls = [];
  const callback = function (...args) {
    calls.push({ receiver: this, args });
    return { accepted: args.length };
  };
  const target = {
    showToastFn: callback,
    updatePaletteLibraryUIFn: null,
    runZoomResetFn: 42,
    ordinaryField: "keep",
  };

  assert.deepEqual(
    callCompatRuntimeHook(target, "showToastFn", "saved", { tone: "success" }),
    { accepted: 2 },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].receiver, target);
  assert.deepEqual(calls[0].args, ["saved", { tone: "success" }]);
  assert.equal(callCompatRuntimeHook(target, "updatePaletteLibraryUIFn"), undefined);
  assert.equal(callCompatRuntimeHook({}, "updatePaletteLibraryUIFn"), undefined);
  assert.throws(
    () => callCompatRuntimeHook(target, "runZoomResetFn"),
    TypeError,
  );
  assert.throws(
    () => callCompatRuntimeHook({ unknownHook() {} }, "unknownHook"),
    TypeError,
  );
  assert.equal(target.showToastFn, callback);
  assert.equal(target.updatePaletteLibraryUIFn, null);
  assert.equal(target.runZoomResetFn, 42);
  assert.equal(target.ordinaryField, "keep");
});

test("plain compatibility hook forwards the original thrown value", () => {
  const failure = new Error("legacy-hook-failed");
  const target = {
    showToastFn() {
      throw failure;
    },
  };
  assert.throws(
    () => callCompatRuntimeHook(target, "showToastFn"),
    (error) => error === failure,
  );
});

test("bound notification and handler hooks dispatch without replacing the registry", (t) => {
  const notificationName = "updatePaletteLibraryUIFn";
  const handlerName = "getViewportGeoBoundsFn";
  const registryProbe = {};
  const notificationBefore = readRegisteredRuntimeHookSource(registryProbe, notificationName);
  const handlerBefore = readRegisteredRuntimeHookSource(registryProbe, handlerName);
  assert.equal(notificationBefore, null);
  assert.equal(handlerBefore, null);

  t.after(() => {
    registerRuntimeHook(registryProbe, notificationName, null);
    registerRuntimeHook(registryProbe, handlerName, null);
  });

  const boundTarget = bindStateCompatSurface({ ordinaryField: "keep" });
  const notificationArgs = [];
  registerRuntimeHook(boundTarget, notificationName, (...args) => {
    notificationArgs.push(args);
    return "notified";
  });
  registerRuntimeHook(boundTarget, handlerName, (west, east) => ({ west, east }));

  const notificationSource = readRegisteredRuntimeHookSource(registryProbe, notificationName);
  const handlerSource = readRegisteredRuntimeHookSource(registryProbe, handlerName);
  assert.deepEqual(
    callCompatRuntimeHook(boundTarget, notificationName, "palette", 3),
    ["notified"],
  );
  assert.deepEqual(notificationArgs, [["palette", 3]]);
  assert.deepEqual(
    callCompatRuntimeHook(boundTarget, handlerName, -12, 25),
    { west: -12, east: 25 },
  );
  assert.equal(readRegisteredRuntimeHookSource(registryProbe, notificationName), notificationSource);
  assert.equal(readRegisteredRuntimeHookSource(registryProbe, handlerName), handlerSource);
  assert.equal(boundTarget.ordinaryField, "keep");
});
