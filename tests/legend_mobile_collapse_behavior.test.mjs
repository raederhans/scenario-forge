import assert from "node:assert/strict";
import test from "node:test";
import { createLegendControlOwner } from "../js/core/renderer/legend_control_owner.js";
import { Element } from "./helpers/legend_element.mjs";

function setup(t, width, collapsed) {
  const previous = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  t.after(() => { globalThis.document = previous; });
  const container = new Element();
  const state = { visible: true, collapsed };
  const updateControlState = (patch) => Object.assign(state, patch);
  const owner = createLegendControlOwner({
    getMapContainer: () => container,
    isSmallViewport: () => width <= 767,
    getLanguage: () => "en",
    getLegendModel: () => ({
      colors: ["red"],
      labelMap: { red: "Red" },
      specialZoneLegendLayers: [],
    }),
    getControlState: () => state,
    updateControlState,
    toggleControlCollapsed: () => updateControlState({ collapsed: !state.collapsed }),
    clamp: (value, min, max) => Math.max(min, Math.min(value, max)),
  });
  owner.renderLegend();
  const element = owner.ensureLegendControlElement();
  return {
    state,
    render: owner.renderLegend,
    toggle: element.querySelector('[data-legend-action="toggle"]'),
    isCollapsed: () => element.className.split(" ").includes("is-collapsed"),
  };
}

test("首次在 767px 显示时折叠，显式展开后重新渲染仍保持展开", (t) => {
  const legend = setup(t, 767, null);
  assert.equal(legend.isCollapsed(), true);
  assert.equal(legend.state.collapsed, null);
  assert.equal(legend.toggle.attributes["aria-label"], "Expand legend");
  legend.toggle.fire("click");
  assert.equal(legend.state.collapsed, false);
  legend.render();
  assert.equal(legend.isCollapsed(), false);
  assert.equal(legend.toggle.attributes["aria-label"], "Collapse legend");
});

test("768px 首次显示时默认展开", (t) => {
  assert.equal(setup(t, 768, null).isCollapsed(), false);
});

for (const collapsed of [true, false]) {
  test(`移动端沿用已保存的 collapsed=${collapsed}`, (t) => {
    const legend = setup(t, 767, collapsed);
    assert.equal(legend.isCollapsed(), collapsed);
    assert.equal(legend.state.collapsed, collapsed);
  });
}
