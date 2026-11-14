import assert from "node:assert/strict";
import test from "node:test";

import {
  bindTransportWorkbenchEventOnce,
  createTransportWorkbenchEventOwner,
} from "../js/ui/transport_workbench/transport_workbench_event_owner.js";

class TestElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toLowerCase();
    this.dataset = {};
    this.listeners = new Map();
    this.value = "";
    this.disabled = false;
    this.hidden = false;
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  listenerCount(type) {
    return (this.listeners.get(type) || []).length;
  }

  async dispatch(type, event = {}) {
    const nextEvent = {
      button: 0,
      key: "",
      preventDefault() {},
      ...event,
    };
    for (const handler of this.listeners.get(type) || []) {
      await handler(nextEvent);
    }
  }

  click() {
    return this.dispatch("click");
  }

  focus() {
    this.dataset.focused = "true";
  }
}

class TestDocument {
  constructor() {
    this.body = new TestElement("body");
    this.listeners = new Map();
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  listenerCount(type) {
    return (this.listeners.get(type) || []).length;
  }

  async dispatch(type, event = {}) {
    const nextEvent = {
      key: "",
      preventDefault() {},
      ...event,
    };
    for (const handler of this.listeners.get(type) || []) {
      await handler(nextEvent);
    }
  }
}

function createHarness({ applyEnabled = true, rejectApply = false, popoverHandlesEscape = false } = {}) {
  const documentRef = new TestDocument();
  const nodes = {
    scenarioButton: new TestElement("button"),
    appearanceButton: new TestElement("button"),
    infoButton: new TestElement("button"),
    closeButton: new TestElement("button"),
    resetButton: new TestElement("button"),
    zoomOutButton: new TestElement("button"),
    zoomInButton: new TestElement("button"),
    rotateButton: new TestElement("button"),
    applyButton: new TestElement("button"),
    packSelect: new TestElement("select"),
    familyTabs: [new TestElement("button")],
    inspectorTabButtons: [new TestElement("button")],
  };
  nodes.familyTabs[0].dataset.transportFamily = "rail";
  nodes.inspectorTabButtons[0].dataset.transportInspectorTab = "data";
  nodes.packSelect.value = "japan_road";
  let open = false;
  const events = [];
  const context = {
    family: { id: "road" },
    config: { sentinel: true },
    compareHeld: false,
  };
  const owner = createTransportWorkbenchEventOwner({
    documentRef,
    body: documentRef.body,
    ...nodes,
    actions: {
      isOpen: () => open,
      setOpen: (nextOpen, options = {}) => {
        open = !!nextOpen;
        events.push(`open:${open}:${options.trigger?.tagName || "none"}`);
      },
      toggleInfoPopover: () => events.push("info"),
      resetView: () => events.push("reset"),
      stepCarrierZoom: (step) => events.push(`zoom:${step}`),
      rotateCarrier: () => events.push("rotate"),
      syncPreviewControls: () => events.push("sync-preview"),
      getRenderContext: () => context,
      getApplyButtonState: () => ({ enabled: applyEnabled }),
      applyFamilyToMainMap: async (nextContext) => {
        events.push(`apply:${nextContext.family.id}`);
        if (rejectApply) throw new Error("apply failed");
      },
      renderShell: (nextContext) => events.push(`shell:${nextContext.family.id}`),
      setActivePackId: (packId) => events.push(`pack:${packId}`),
      setActiveFamily: (familyId) => events.push(`family:${familyId}`),
      renderUi: () => events.push("render-ui"),
      setInspectorTab: (tabId) => events.push(`tab:${tabId}`),
      renderInspector: (family, config, compareHeld) => events.push(`inspector:${family.id}:${config.sentinel}:${compareHeld}`),
      handlePopoverEscape: (event) => {
        events.push(`popover-escape:${event.key}`);
        return popoverHandlesEscape;
      },
    },
  });
  return {
    documentRef,
    nodes,
    owner,
    events,
    get open() {
      return open;
    },
  };
}

test("transport workbench event owner binds chrome actions once", async () => {
  const harness = createHarness();

  harness.owner.bind();
  harness.owner.bind();

  assert.equal(harness.nodes.scenarioButton.listenerCount("click"), 1);
  assert.equal(harness.documentRef.listenerCount("keydown"), 1);
  assert.equal(harness.documentRef.body.dataset.transportWorkbenchEscapeBound, "true");

  await harness.nodes.scenarioButton.dispatch("click");
  await harness.nodes.scenarioButton.dispatch("click");
  await harness.nodes.appearanceButton.dispatch("click");
  await harness.nodes.infoButton.dispatch("click");
  await harness.nodes.resetButton.dispatch("click");
  await harness.nodes.closeButton.dispatch("click");

  assert.deepEqual(harness.events, [
    "open:true:button",
    "open:false:none",
    "open:true:button",
    "info",
    "reset",
    "open:false:none",
  ]);
});

test("transport workbench tabs support roving keyboard activation", async () => {
  const harness = createHarness();
  const roadTab = new TestElement("button");
  const railTab = new TestElement("button");
  const inspectTab = new TestElement("button");
  const dataTab = new TestElement("button");
  const hiddenTab = new TestElement("button");
  hiddenTab.dataset.transportInspectorTab = "aggregation";
  hiddenTab.hidden = true;
  roadTab.dataset.transportFamily = "road";
  railTab.dataset.transportFamily = "rail";
  inspectTab.dataset.transportInspectorTab = "inspect";
  dataTab.dataset.transportInspectorTab = "data";
  harness.nodes.familyTabs.splice(0, harness.nodes.familyTabs.length, roadTab, railTab);
  harness.nodes.inspectorTabButtons.splice(0, harness.nodes.inspectorTabButtons.length, inspectTab, hiddenTab, dataTab);

  let preventDefaultCount = 0;
  harness.owner.bind();

  await roadTab.dispatch("keydown", {
    key: "ArrowRight",
    preventDefault() {
      preventDefaultCount += 1;
    },
  });
  await dataTab.dispatch("keydown", {
    key: "Home",
    preventDefault() {
      preventDefaultCount += 1;
    },
  });

  await inspectTab.dispatch("keydown", { key: "ArrowRight" });
  assert.equal(dataTab.dataset.focused, "true");
  assert.equal(hiddenTab.dataset.focused, undefined);
  assert.equal(railTab.dataset.focused, "true");
  assert.equal(inspectTab.dataset.focused, "true");
  assert.equal(preventDefaultCount, 2);
  assert.deepEqual(harness.events, [
    "family:rail",
    "render-ui",
    "tab:inspect",
    "shell:road",
    "inspector:road:true:false",
    "tab:data",
    "shell:road",
    "inspector:road:true:false",
  ]);
});

test("transport workbench event owner keeps preview controls, pack, family, and inspector dispatch narrow", async () => {
  const harness = createHarness();
  harness.owner.bind();

  await harness.nodes.zoomOutButton.dispatch("click");
  await harness.nodes.zoomInButton.dispatch("click");
  await harness.nodes.rotateButton.dispatch("click");
  await harness.nodes.packSelect.dispatch("change");
  await harness.nodes.familyTabs[0].dispatch("click");
  await harness.nodes.inspectorTabButtons[0].dispatch("click");

  assert.deepEqual(harness.events, [
    "zoom:-1",
    "sync-preview",
    "zoom:1",
    "sync-preview",
    "rotate",
    "sync-preview",
    "pack:japan_road",
    "family:rail",
    "render-ui",
    "tab:data",
    "shell:road",
    "inspector:road:true:false",
  ]);
});

test("transport workbench event owner gates apply and refreshes shell after attempts", async () => {
  const disabledHarness = createHarness({ applyEnabled: false });
  disabledHarness.owner.bind();
  await disabledHarness.nodes.applyButton.dispatch("click");
  assert.deepEqual(disabledHarness.events, []);

  const enabledHarness = createHarness();
  enabledHarness.owner.bind();
  await enabledHarness.nodes.applyButton.dispatch("click");
  assert.deepEqual(enabledHarness.events, ["apply:road", "shell:road"]);

  const previousConsoleError = console.error;
  const loggedErrors = [];
  console.error = (...args) => loggedErrors.push(args);
  try {
    const rejectedHarness = createHarness({ rejectApply: true });
    rejectedHarness.owner.bind();
    await rejectedHarness.nodes.applyButton.dispatch("click");
    assert.deepEqual(rejectedHarness.events, ["apply:road", "shell:road"]);
    assert.match(String(loggedErrors[0][0]), /\[transport-workbench\] Failed to apply road/);
  } finally {
    console.error = previousConsoleError;
  }
});

test("transport workbench event owner lets popovers handle Escape before closing the panel", async () => {
  const handledHarness = createHarness({ popoverHandlesEscape: true });
  handledHarness.owner.bind();
  await handledHarness.nodes.scenarioButton.dispatch("click");
  handledHarness.events.length = 0;
  await handledHarness.documentRef.dispatch("keydown", { key: "Escape" });
  assert.deepEqual(handledHarness.events, ["popover-escape:Escape"]);
  assert.equal(handledHarness.open, true);

  const closeHarness = createHarness();
  let preventDefaultCount = 0;
  closeHarness.owner.bind();
  await closeHarness.nodes.scenarioButton.dispatch("click");
  closeHarness.events.length = 0;
  await closeHarness.documentRef.dispatch("keydown", {
    key: "Escape",
    preventDefault() {
      preventDefaultCount += 1;
    },
  });
  assert.deepEqual(closeHarness.events, ["popover-escape:Escape", "open:false:none"]);
  assert.equal(closeHarness.open, false);
  assert.equal(preventDefaultCount, 1);
});

test("transport workbench event owner one-shot binder reports skipped bound nodes", () => {
  const node = new TestElement("button");
  let calls = 0;

  assert.equal(bindTransportWorkbenchEventOnce(node, () => {
    calls += 1;
  }), true);
  assert.equal(bindTransportWorkbenchEventOnce(node, () => {
    calls += 1;
  }), false);
  assert.equal(calls, 1);
  assert.equal(node.dataset.transportWorkbenchEventBound, "true");
});
