import assert from "node:assert/strict";
import test from "node:test";

import { createAppearanceBorderOwner } from "../js/ui/toolbar/appearance_border_owner.js";

class TestElement {
  constructor() {
    this.dataset = {};
    this.listeners = new Map();
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.textContent = "";
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  dispatch(type) {
    for (const handler of this.listeners.get(type) || []) {
      handler({ target: this });
    }
  }
}

function createHarness() {
  const nodes = {
    internalBorderAutoColor: new TestElement(),
    internalBorderColor: new TestElement(),
    internalBorderOpacity: new TestElement(),
    internalBorderOpacityValue: new TestElement(),
    internalBorderWidth: new TestElement(),
    internalBorderWidthValue: new TestElement(),
    empireBorderColor: new TestElement(),
    politicalBorderToggle: new TestElement(),
    empireBorderOpacity: new TestElement(),
    empireBorderOpacityValue: new TestElement(),
    empireBorderWidth: new TestElement(),
    empireBorderWidthValue: new TestElement(),
    coastlineColor: new TestElement(),
    coastlineOpacity: new TestElement(),
    coastlineOpacityValue: new TestElement(),
    coastlineWidth: new TestElement(),
    coastlineWidthValue: new TestElement(),
  };
  const documentRef = {
    getElementById(id) {
      return nodes[id] || null;
    },
  };
  const runtimeState = {
    styleConfig: {
      internalBorders: {
        color: "#123456",
        colorMode: "manual",
        opacity: 0.42,
        width: 0.88,
      },
      empireBorders: {
        color: "#abcdef",
        opacity: 0.66,
        width: 2.25,
      },
      coastlines: {
        color: "#2468ac",
        opacity: 0.73,
        width: 2.4,
      },
    },
  };
  const dirtyReasons = [];
  const owner = createAppearanceBorderOwner({
    runtimeState,
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
    renderDirty: (reason) => dirtyReasons.push(reason),
    documentRef,
  });
  return { owner, runtimeState, nodes, dirtyReasons };
}

test("appearance border owner renders internal, country, and coastline controls from state", () => {
  const { owner, nodes, runtimeState } = createHarness();

  owner.renderBorderUi();

  assert.equal(nodes.internalBorderAutoColor.checked, false);
  assert.equal(nodes.internalBorderColor.value, "#123456");
  assert.equal(nodes.internalBorderColor.disabled, false);
  assert.equal(nodes.internalBorderOpacity.value, "42");
  assert.equal(nodes.internalBorderOpacityValue.textContent, "42%");
  assert.equal(nodes.internalBorderWidth.value, "0.88");
  assert.equal(nodes.internalBorderWidthValue.textContent, "0.88");

  assert.equal(nodes.empireBorderColor.value, "#abcdef");
  assert.equal(nodes.empireBorderOpacity.value, "66");
  assert.equal(nodes.empireBorderOpacityValue.textContent, "66%");
  assert.equal(nodes.empireBorderWidth.value, "2.25");

  assert.equal(nodes.coastlineColor.value, "#2468ac");
  assert.equal(nodes.coastlineOpacity.value, "73");
  assert.equal(nodes.coastlineOpacityValue.textContent, "73%");
  assert.equal(nodes.coastlineWidth.value, "2.4");
  assert.equal(runtimeState.styleConfig.empireBorders.widthPrecision, undefined);
  assert.equal(runtimeState.styleConfig.coastlines.widthPrecision, undefined);
});

test("appearance border owner writes style config and dirty reasons on input", () => {
  const { owner, runtimeState, nodes, dirtyReasons } = createHarness();

  owner.bindEvents();

  nodes.internalBorderAutoColor.checked = true;
  nodes.internalBorderAutoColor.dispatch("change");
  assert.equal(runtimeState.styleConfig.internalBorders.colorMode, "auto");
  assert.equal(nodes.internalBorderColor.disabled, true);

  nodes.internalBorderColor.value = "#fedcba";
  nodes.internalBorderColor.dispatch("input");
  assert.equal(runtimeState.styleConfig.internalBorders.color, "#fedcba");
  assert.equal(runtimeState.styleConfig.internalBorders.colorMode, "manual");
  assert.equal(nodes.internalBorderAutoColor.checked, false);
  assert.equal(nodes.internalBorderColor.disabled, false);

  nodes.internalBorderOpacity.value = "0";
  nodes.internalBorderOpacity.dispatch("input");
  assert.equal(runtimeState.styleConfig.internalBorders.opacity, 0);
  assert.equal(nodes.internalBorderOpacityValue.textContent, "0%");

  nodes.empireBorderOpacity.value = "77";
  nodes.empireBorderOpacity.dispatch("input");
  assert.equal(runtimeState.styleConfig.empireBorders.opacity, 0.77);
  assert.equal(nodes.empireBorderOpacityValue.textContent, "77%");

  nodes.coastlineWidth.value = "2.9";
  nodes.coastlineWidth.dispatch("input");
  assert.equal(runtimeState.styleConfig.coastlines.width, 2.9);
  assert.equal(nodes.coastlineWidthValue.textContent, "2.9");

  assert.deepEqual(dirtyReasons, [
    "internal-border-color-mode",
    "internal-border-color",
    "internal-border-opacity",
    "empire-border-opacity",
    "coastline-width",
  ]);
});

test("appearance border owner falls invalid colors back to border defaults", () => {
  const { owner, runtimeState, nodes } = createHarness();

  runtimeState.styleConfig.internalBorders.color = "broken";
  runtimeState.styleConfig.empireBorders.color = "also-broken";
  runtimeState.styleConfig.coastlines.color = "still-broken";

  owner.renderBorderUi();

  assert.equal(nodes.internalBorderColor.value, "#cccccc");
  assert.equal(nodes.empireBorderColor.value, "#4b5563");
  assert.equal(nodes.coastlineColor.value, "#333333");
});

test("political border control follows scenario defaults, persists opt-out and disables in blank maps", () => {
  const { owner, runtimeState, nodes, dirtyReasons } = createHarness();
  runtimeState.activeScenarioId = "tno_1962";
  owner.renderBorderUi();
  assert.equal(nodes.politicalBorderToggle.checked, true);
  owner.bindEvents();
  nodes.politicalBorderToggle.checked = false;
  nodes.politicalBorderToggle.dispatch("change");
  assert.equal(runtimeState.styleConfig.empireBorders.political, "off");
  owner.renderBorderUi();
  assert.equal(nodes.politicalBorderToggle.checked, false);
  assert.deepEqual(dirtyReasons, ["empire-border-political"]);
  runtimeState.mapSemanticMode = "blank";
  runtimeState.styleConfig.empireBorders.political = "on";
  owner.renderBorderUi();
  assert.equal(nodes.politicalBorderToggle.checked, false);
  assert.equal(nodes.politicalBorderToggle.disabled, true);
});
