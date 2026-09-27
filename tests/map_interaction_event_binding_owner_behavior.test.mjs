import assert from "node:assert/strict";
import test from "node:test";

import { createMapInteractionEventBindingOwner } from "../js/core/renderer/map_interaction_event_binding_owner.js";

function createFakeNode({ includeAddEventListener = true, calls = null } = {}) {
  const listeners = new Map();
  const node = { listeners };
  if (includeAddEventListener) {
    node.addEventListener = (type, handler) => {
      calls?.order.push(`node:${type}`);
      listeners.set(type, handler);
    };
    node.dispatch = (type, event = {}) => listeners.get(type)?.(event);
  }
  return node;
}

function createFakeInteractionRect(node = createFakeNode(), calls = null) {
  const handlers = new Map();
  return {
    handlers,
    node: () => node,
    on(type, handler) {
      calls?.order.push(`rect:${type}`);
      handlers.set(type, handler);
      return this;
    },
    dispatch(type, event = {}) {
      return handlers.get(type)?.(event);
    },
  };
}

function createFakeWindow(calls = null) {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, handler) {
      calls?.order.push(`window:${type}`);
      const next = listeners.get(type) || [];
      next.push(handler);
      listeners.set(type, next);
    },
    dispatch(type, event = {}) {
      for (const handler of listeners.get(type) || []) {
        handler(event);
      }
    },
    listenerCount(type) {
      return (listeners.get(type) || []).length;
    },
  };
}

function createHandler(name, calls) {
  return (...args) => {
    calls.handlers.push({ name, args });
  };
}

function createHarness({
  includeInteractionRect = true,
  includeNodeAddEventListener = true,
} = {}) {
  const calls = {
    order: [],
    effects: [],
    handlers: [],
  };
  const node = createFakeNode({ includeAddEventListener: includeNodeAddEventListener, calls });
  const interactionRect = includeInteractionRect ? createFakeInteractionRect(node, calls) : null;
  const fakeWindow = createFakeWindow(calls);
  const handlers = {
    mapClick: createHandler("mapClick", calls),
    mapDoubleClick: createHandler("mapDoubleClick", calls),
    handleMouseMove: createHandler("handleMouseMove", calls),
    handlePhysicalIntensityPointerDown: createHandler("handlePhysicalIntensityPointerDown", calls),
    handlePhysicalIntensityPointerMove: createHandler("handlePhysicalIntensityPointerMove", calls),
    handlePhysicalIntensityPointerEnd: createHandler("handlePhysicalIntensityPointerEnd", calls),
    handleBrushPointerDown: createHandler("handleBrushPointerDown", calls),
    handleBrushPointerMove: createHandler("handleBrushPointerMove", calls),
    handleMouseLeave: createHandler("handleMouseLeave", calls),
    handleSidebarLayoutStart: createHandler("handleSidebarLayoutStart", calls),
    handleResize: createHandler("handleResize", calls),
    flushSpecialZoneMembershipDragSession: createHandler("flushSpecialZoneMembershipDragSession", calls),
    flushBrushSession: createHandler("flushBrushSession", calls),
  };

  const owner = createMapInteractionEventBindingOwner({
    getters: {
      getInteractionRect: () => interactionRect,
      getWindow: () => fakeWindow,
      getInteractionRectNode: () => node,
    },
    handlers,
    effects: {
      bindMapContainerResizeObserver() {
        calls.effects.push("bindMapContainerResizeObserver");
        calls.order.push("bindMapContainerResizeObserver");
      },
      bindBrowserZoomObservers() {
        calls.effects.push("bindBrowserZoomObservers");
        calls.order.push("bindBrowserZoomObservers");
      },
    },
  });

  return {
    calls,
    fakeWindow,
    handlers,
    interactionRect,
    node,
    owner,
  };
}

test("bindEvents noops when interaction rect is missing", () => {
  const { calls, fakeWindow, node, owner } = createHarness({ includeInteractionRect: false });

  assert.equal(owner.bindEvents(), false);
  assert.deepEqual(calls.effects, []);
  assert.equal(fakeWindow.listeners.size, 0);
  assert.equal(node.listeners.size, 0);
});

test("bindEvents wires interaction rect handlers directly to the injected click handlers", () => {
  const { calls, handlers, interactionRect, owner } = createHarness();

  assert.equal(owner.bindEvents(), true);

  assert.equal(interactionRect.handlers.get("mousemove"), handlers.handleMouseMove);
  assert.equal(interactionRect.handlers.get("pointerdown.fieldTool"), handlers.handlePhysicalIntensityPointerDown);
  assert.equal(interactionRect.handlers.get("pointermove.fieldTool"), handlers.handlePhysicalIntensityPointerMove);
  assert.equal(interactionRect.handlers.get("mousedown.brush"), handlers.handleBrushPointerDown);
  assert.equal(interactionRect.handlers.get("mousemove.brush"), handlers.handleBrushPointerMove);
  assert.equal(interactionRect.handlers.get("mouseleave"), handlers.handleMouseLeave);
  assert.equal(interactionRect.handlers.get("click"), handlers.mapClick);
  assert.equal(interactionRect.handlers.get("dblclick"), handlers.mapDoubleClick);

  interactionRect.dispatch("mouseleave", { type: "mouseleave" });
  interactionRect.dispatch("click", { type: "click" });
  interactionRect.dispatch("dblclick", { type: "dblclick" });
  assert.deepEqual(
    calls.handlers.map((entry) => entry.name),
    ["handleMouseLeave", "mapClick", "mapDoubleClick"],
  );
});

test("bindEvents wires window and native node listeners", () => {
  const { fakeWindow, handlers, node, owner } = createHarness();

  owner.bindEvents();

  assert.equal(fakeWindow.listenerCount("mouseup"), 1);
  assert.equal(fakeWindow.listeners.get("pointerup")[0], handlers.handlePhysicalIntensityPointerEnd);
  assert.equal(fakeWindow.listeners.get("pointercancel")[0], handlers.handlePhysicalIntensityPointerEnd);
  assert.equal(fakeWindow.listeners.get("resize")[0], handlers.handleResize);
  assert.equal(fakeWindow.listeners.get("mapcreator:sidebar-layout-start")[0], handlers.handleSidebarLayoutStart);
  assert.equal(fakeWindow.listenerCount("mapcreator:sidebar-layout-refresh"), 1);
  assert.equal(node.listeners.get("lostpointercapture"), handlers.handlePhysicalIntensityPointerEnd);
});

test("mouseup and sidebar refresh callbacks preserve host behavior", () => {
  const { calls, fakeWindow, owner } = createHarness();

  owner.bindEvents();
  fakeWindow.dispatch("mouseup", { type: "mouseup" });
  fakeWindow.dispatch("mapcreator:sidebar-layout-refresh", { type: "mapcreator:sidebar-layout-refresh" });

  assert.deepEqual(
    calls.handlers.map((entry) => ({ name: entry.name, args: entry.args })),
    [
      { name: "flushSpecialZoneMembershipDragSession", args: [] },
      { name: "flushBrushSession", args: [] },
      { name: "handleResize", args: ["sidebar-layout-refresh"] },
    ],
  );
});

test("lostpointercapture is optional when the native node has no listener API", () => {
  const { fakeWindow, node, owner } = createHarness({ includeNodeAddEventListener: false });

  assert.equal(owner.bindEvents(), true);
  assert.equal(node.listeners.size, 0);
  assert.equal(fakeWindow.listenerCount("pointerup"), 1);
});

test("resize and browser zoom observers run after listener binding", () => {
  const { calls, owner } = createHarness();

  owner.bindEvents();

  assert.deepEqual(calls.effects, ["bindMapContainerResizeObserver", "bindBrowserZoomObservers"]);
  assert.ok(calls.order.indexOf("rect:dblclick") < calls.order.indexOf("bindMapContainerResizeObserver"));
  assert.ok(calls.order.indexOf("window:mapcreator:sidebar-layout-refresh") < calls.order.indexOf("bindMapContainerResizeObserver"));
  assert.ok(calls.order.indexOf("node:lostpointercapture") < calls.order.indexOf("bindMapContainerResizeObserver"));
  assert.ok(calls.order.indexOf("bindMapContainerResizeObserver") < calls.order.indexOf("bindBrowserZoomObservers"));
});

test("factory freezes its exact public API", () => {
  const { owner } = createHarness();

  assert.equal(Object.isFrozen(owner), true);
});

 test("direct click bindings preserve event identity and asynchronous failures", async () => {
  const { handlers, interactionRect, owner } = createHarness();
  const event = { detail: 2, ctrlKey: true, shiftKey: true };
  const failure = new Error("click failed");
  handlers.mapClick = async (received) => { assert.equal(received, event); throw failure; };
  handlers.mapDoubleClick = async (received) => { assert.equal(received, event); return "done"; };
  owner.bindEvents();
  await assert.rejects(interactionRect.dispatch("click", event), error => error === failure);
  assert.equal(await interactionRect.dispatch("dblclick", event), "done");
});
