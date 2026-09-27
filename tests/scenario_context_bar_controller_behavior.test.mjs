import assert from "node:assert/strict";
import test from "node:test";

import { createScenarioContextBarController } from "../js/ui/toolbar/scenario_context_bar_controller.js";

class TestClassList {
  constructor() {
    this.values = new Set();
  }

  add(...tokens) {
    tokens.forEach((token) => this.values.add(token));
  }

  remove(...tokens) {
    tokens.forEach((token) => this.values.delete(token));
  }

  contains(token) {
    return this.values.has(token);
  }

  toggle(token, force) {
    const shouldEnable = force === undefined ? !this.values.has(token) : !!force;
    if (shouldEnable) this.add(token);
    else this.remove(token);
    return shouldEnable;
  }
}

class TestElement {
  constructor({ rect = null } = {}) {
    this.attributes = new Map();
    this.classList = new TestClassList();
    this.dataset = {};
    this.listeners = new Map();
    this.offsetParent = null;
    this.rect = rect || { left: 0, right: 800, top: 0, bottom: 400, width: 800, height: 400 };
    this.style = {
      values: new Map(),
      setProperty: (name, value) => this.style.values.set(name, value),
    };
    this.textContent = "";
  }

  addEventListener(name, handler) {
    this.listeners.set(name, handler);
  }

  click() {
    this.listeners.get("click")?.();
  }

  closest() {
    return null;
  }

  getBoundingClientRect() {
    return this.rect;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
}

function createHarness({ collapsed = false, selectionLabel = "Berlin" } = {}) {
  const nodes = {
    scenarioContextBar: new TestElement(),
    scenarioContextCollapseBtn: new TestElement(),
    scenarioContextScenarioText: new TestElement(),
    scenarioContextModeText: new TestElement(),
    scenarioContextActiveText: new TestElement(),
    scenarioContextSelectionItem: new TestElement(),
    scenarioContextSelectionText: new TestElement(),
    scenarioTransportWorkbenchBtn: new TestElement(),
    scenarioGuidePopover: new TestElement(),
    mapContainer: new TestElement({ rect: { left: 0, right: 800, top: 0, bottom: 400, width: 800, height: 400 } }),
    zoomControls: new TestElement({ rect: { left: 460, right: 540, top: 0, bottom: 40, width: 80, height: 40 } }),
  };
  nodes.scenarioGuidePopover.classList.add("hidden");
  nodes.scenarioTransportWorkbenchBtn.dataset.transportEntryLabel = "Transport";
  const guideSyncCalls = [];
  const runtimeState = {
    activeScenarioManifest: { display_name: "HGO 1936" },
    activeSovereignCode: "abc",
    countryNames: { ABC: "Alpha" },
    transportWorkbenchUi: { open: false },
    ui: {
      scenarioBarCollapsed: collapsed,
      tutorialEntryVisible: true,
    },
  };
  const globalRef = {
    innerWidth: 1200,
    handlers: new Map(),
    addEventListener(name, handler) {
      this.handlers.set(name, handler);
    },
    clearTimeout() {},
    setTimeout(handler) {
      this.timeoutHandler = handler;
      return 1;
    },
  };
  const controller = createScenarioContextBarController({
    runtimeState,
    ...nodes,
    getPaintModeLabel: () => "Visual Color",
    getWorkspaceSelectionLabel: () => selectionLabel,
    syncScenarioGuideTriggerButtons: (payload) => guideSyncCalls.push(payload),
    updateLanguageToggleUi: () => {
      runtimeState.languageRefreshCount = (runtimeState.languageRefreshCount || 0) + 1;
    },
    renderOceanCoastalAccentUi: () => {
      runtimeState.oceanRefreshCount = (runtimeState.oceanRefreshCount || 0) + 1;
    },
    translate: (label) => label,
    globalRef,
  });
  return {
    controller,
    globalRef,
    guideSyncCalls,
    nodes,
    runtimeState,
  };
}

test("scenario context bar refresh owns labels, selection chip, and safe width", () => {
  const { controller, guideSyncCalls, nodes, runtimeState } = createHarness();

  controller.refreshScenarioContextBar();

  assert.equal(nodes.scenarioContextScenarioText.textContent, "HGO 1936");
  assert.equal(nodes.scenarioContextModeText.textContent, "Visual Color");
  assert.equal(nodes.scenarioContextModeText.attributes.get("title"), "Mode: Visual Color");
  assert.equal(nodes.scenarioContextActiveText.textContent, "Alpha (ABC)");
  assert.equal(nodes.scenarioContextSelectionItem.classList.contains("hidden"), false);
  assert.equal(nodes.scenarioContextSelectionText.textContent, "Berlin");
  assert.equal(nodes.scenarioContextCollapseBtn.textContent, "-");
  assert.equal(nodes.scenarioTransportWorkbenchBtn.textContent, "Transport");
  assert.equal(nodes.scenarioTransportWorkbenchBtn.attributes.get("title"), "Open transport workbench");
  assert.equal(nodes.scenarioContextBar.style.values.get("--scenario-bar-safe-max-width"), "426px");
  assert.equal(nodes.scenarioContextBar.classList.contains("is-overlay-constrained"), true);
  assert.equal(nodes.scenarioContextBar.classList.contains("is-narrow"), false);
  assert.equal(runtimeState.languageRefreshCount, 1);
  assert.equal(runtimeState.oceanRefreshCount, 1);
  assert.deepEqual(guideSyncCalls.at(-1), { isOpen: false, tutorialEntryVisible: true });
});

test("scenario context bar hides empty selection chip", () => {
  const { controller, nodes } = createHarness({ selectionLabel: "No selection" });

  controller.refreshWorkspaceStatus();

  assert.equal(nodes.scenarioContextSelectionItem.classList.contains("hidden"), true);
  assert.equal(nodes.scenarioContextSelectionText.textContent, "No selection");
});

test("scenario context collapse event toggles state and rerenders affordance", () => {
  const { controller, nodes, runtimeState } = createHarness();

  controller.bindScenarioContextBarEvents();
  nodes.scenarioContextCollapseBtn.click();

  assert.equal(nodes.scenarioContextCollapseBtn.dataset.bound, "true");
  assert.equal(runtimeState.ui.scenarioBarCollapsed, true);
  assert.equal(nodes.scenarioContextBar.classList.contains("is-collapsed"), true);
  assert.equal(nodes.scenarioContextCollapseBtn.textContent, "+");
  assert.equal(nodes.scenarioContextCollapseBtn.attributes.get("aria-label"), "Expand");
});

test("responsive chrome binding delegates resize refresh through the controller", () => {
  let responsiveRefreshCount = 0;
  let dockRefreshCount = 0;
  let paletteResizeCount = 0;
  const { globalRef, runtimeState } = createHarness();
  const controllerWithResponsiveDeps = createScenarioContextBarController({
    runtimeState,
    scenarioContextBar: new TestElement(),
    zoomControls: new TestElement({ rect: { left: 460, right: 540, top: 0, bottom: 40, width: 80, height: 40 } }),
    getPaintModeLabel: () => "Visual Color",
    getWorkspaceSelectionLabel: () => "No selection",
    applyResponsiveChromeDefaults: () => {
      responsiveRefreshCount += 1;
    },
    updateDockCollapsedUi: () => {
      dockRefreshCount += 1;
    },
    handlePaletteLibraryResize: () => {
      paletteResizeCount += 1;
    },
    translate: (label) => label,
    globalRef,
  });

  controllerWithResponsiveDeps.bindResponsiveChromeLayout();
  globalRef.handlers.get("resize")();

  assert.equal(responsiveRefreshCount, 1);
  assert.equal(dockRefreshCount, 1);
  assert.equal(paletteResizeCount, 1);
  assert.equal(runtimeState.ui.overlayResizeBound, true);
});

test("scenario guide trigger highlights bar until the timer callback runs", () => {
  const { controller, globalRef, nodes } = createHarness();

  controller.triggerScenarioGuide();

  assert.equal(nodes.scenarioContextBar.classList.contains("is-highlight"), true);
  globalRef.timeoutHandler();
  assert.equal(nodes.scenarioContextBar.classList.contains("is-highlight"), false);
});

test("scenario context controller can be constructed without DOM dependencies", () => {
  const controller = createScenarioContextBarController();

  assert.equal(typeof controller.refreshScenarioContextBar, "function");
  assert.doesNotThrow(() => controller.refreshWorkspaceStatus());
});
