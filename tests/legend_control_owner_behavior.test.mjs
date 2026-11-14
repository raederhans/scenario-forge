import { Element } from "./helpers/legend_element.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { createLegendControlOwner } from "../js/core/renderer/legend_control_owner.js";

function harness(t) {
  const previous = globalThis.document;
  const document = new Element("document");
  document.createElement = (tag) => new Element(tag);
  globalThis.document = document;
  t.after(() => { globalThis.document = previous; });
  const h = {
    document, container: new Element(), language: "en", updates: [], modelReads: 0,
    control: { visible: true, collapsed: false, width: 240, height: 340, opacity: 0.9, xRatio: 0, yRatio: 0 },
    model: { colors: ["#ff0000"], labelMap: { "#ff0000": "Red" }, specialZoneLegendLayers: [], activeScenarioId: "", hasScenarioVisualEdits: false },
  };
  h.owner = createLegendControlOwner({
    getMapContainer: () => h.container,
    getLanguage: () => h.language,
    getLegendModel: (colors, labels) => { h.modelReads++; return { ...h.model, colors: colors || h.model.colors, labelMap: labels || h.model.labelMap }; },
    getControlState: () => h.control,
    updateControlState: (patch) => { h.updates.push(patch); Object.assign(h.control, patch); return h.control; },
    toggleControlCollapsed: () => { h.control.collapsed = !h.control.collapsed; return h.control; },
    hideControl: () => { h.control.visible = false; },
    clamp: (value, min, max) => Math.max(min, Math.min(value, max)),
  });
  h.render = (...args) => h.owner.renderLegend(...args);
  h.element = () => h.owner.ensureLegendControlElement();
  h.body = () => h.element().querySelector(".map-legend-control-body");
  h.labels = () => h.body().querySelectorAll(".map-legend-label").map((node) => node.textContent);
  return h;
}

test("hidden updates rebuild when shown and unchanged content reuses its rows", (t) => {
  const h = harness(t);
  h.render();
  const first = h.body().children[0];
  h.render();
  assert.equal(h.body().children[0], first);
  h.control.visible = false;
  h.model.labelMap["#ff0000"] = "Updated";
  h.render();
  assert.equal(h.element().hidden, true);
  assert.deepEqual(h.labels(), ["Red"]);
  h.control.visible = true;
  h.render();
  assert.deepEqual(h.labels(), ["Updated"]);
  assert.notEqual(h.body().children[0], first);
});

test("first render while hidden cannot cache an unbuilt body", (t) => {
  const h = harness(t);
  h.control.visible = false;
  h.render();
  assert.equal(h.body().children.length, 0);
  h.control.visible = true;
  h.render();
  assert.deepEqual(h.labels(), ["Red"]);
});

test("new map container builds fresh content even with identical model", (t) => {
  const h = harness(t);
  h.render();
  const oldContainer = h.container, oldElement = h.element();
  h.container = new Element();
  h.render();
  assert.notEqual(h.element(), oldElement);
  assert.deepEqual(h.labels(), ["Red"]);
  assert.equal(oldContainer.contains(oldElement), false);
});

test("language updates refresh special zone sections, headers and handles", (t) => {
  const h = harness(t);
  h.model.specialZoneLegendLayers = [{ id: "zone", name: "Zone", style: { fill: "pink", pattern: "stripes" } }];
  h.render();
  assert.equal(h.body().querySelector(".map-legend-section-title").textContent, "Special Zone Layers");
  h.language = "zh-CN";
  h.render();
  assert.equal(h.body().querySelector(".map-legend-section-title").textContent, "特殊区域图层");
  assert.equal(h.element().querySelector(".map-legend-control-title").textContent, "图例");
  assert.equal(h.element().querySelector('[data-legend-resize="e"]').title, "调整图例宽度");
  assert.equal(h.body().querySelectorAll(".map-legend-swatch")[1].className, "map-legend-swatch has-pattern");
});

test("label delimiters and changes to displayed special zone styles invalidate safely", (t) => {
  const h = harness(t);
  h.model.colors = ["red", "blue"];
  h.model.labelMap = { red: "a|b", blue: "c" };
  h.render();
  h.model.labelMap = { red: "a", blue: "b|c" };
  h.render();
  assert.deepEqual(h.labels(), ["a", "b|c"]);
  h.model.specialZoneLegendLayers = [{ id: "zone", style: { fill: "pink" } }];
  h.render();
  h.model.specialZoneLegendLayers[0].style.fill = "orange";
  h.render();
  assert.equal(h.body().querySelectorAll(".map-legend-swatch")[2].style.backgroundColor, "orange");
});

for (const interaction of ["drag", "resize"]) {
  for (const exit of ["hidden", "empty", "scenario", "close", "container", "no-container"]) {
    test(`${interaction} document listeners stop on ${exit}`, (t) => {
      const h = harness(t);
      h.render();
      const element = h.element();
      const target = element.querySelector(interaction === "drag" ? ".map-legend-control-header" : '[data-legend-resize="se"]');
      target.fire("pointerdown");
      assert.equal(h.document.listeners.get("pointermove").size, 1);
      if (exit === "hidden") h.control.visible = false;
      if (exit === "empty") h.model.colors = [];
      if (exit === "scenario") { h.model.activeScenarioId = "test"; h.model.labelMap = {}; }
      if (exit === "close") element.querySelector('[data-legend-action="close"]').fire("click");
      if (exit === "container") h.container = new Element();
      if (exit === "no-container") h.container = null;
      h.render();
      assert.equal(h.document.listeners.get("pointermove").size, 0);
      assert.equal(h.document.listeners.get("pointerup").size, 0);
      assert.equal(h.document.listeners.get("pointercancel").size, 0);
      assert.ok(!element.className.includes(interaction === "drag" ? "is-dragging" : "is-resizing"));
      h.document.fire("pointermove", { clientX: 100, clientY: 100 });
      assert.deepEqual(h.updates, []);
    });
  }
}

test("drag, resize, opacity and collapse persist control adjustments", (t) => {
  const h = harness(t);
  h.render();
  const element = h.element();
  element.querySelector(".map-legend-control-header").fire("pointerdown");
  h.document.fire("pointermove", { clientX: 60, clientY: 70 });
  assert.ok(h.control.xRatio > 0);
  assert.ok(h.control.yRatio > 0);
  h.document.fire("pointerup");
  element.querySelector('[data-legend-resize="e"]').fire("pointerdown");
  h.document.fire("pointermove", { clientX: 70, clientY: 80 });
  assert.equal(h.control.width, 280);
  assert.equal(h.control.height, 340);
  h.document.fire("pointercancel");
  const opacity = element.querySelector(".map-legend-opacity-input");
  opacity.value = "50";
  opacity.fire("input");
  assert.equal(h.control.opacity, 0.5);
  assert.equal(element.style.opacity, "0.5");
  element.querySelector('[data-legend-action="toggle"]').fire("click");
  assert.equal(h.control.collapsed, true);
  assert.equal(element.style.height, "");
  assert.equal(element.querySelector('[data-legend-action="toggle"]').attributes["aria-label"], "Expand legend");
});
for (const [edge, width, height] of [["s", 240, 390], ["se", 280, 390]]) {
  test(`${edge} handle resizes intended axes and reveals opacity controls`, (t) => {
    const h = harness(t);
    h.render();
    const element = h.element();
    const handle = element.querySelector(`[data-legend-resize="${edge}"]`);
    handle.fire("pointerenter");
    assert.equal(element.querySelector(".map-legend-opacity-panel").hidden, false);
    handle.fire("pointerdown");
    h.document.fire("pointermove", { clientX: 70, clientY: 80 });
    assert.equal(h.control.width, width);
    assert.equal(h.control.height, height);
    h.document.fire("pointerup");
    element.fire("pointerleave");
    assert.equal(element.querySelector(".map-legend-opacity-panel").hidden, true);
  });
}


test("hidden legend skips model reads and unchanged layout performs no style writes", (t) => {
  const h = harness(t);
  h.control.visible = false;
  h.render();
  h.render();
  assert.equal(h.modelReads, 0);
  h.control.visible = true;
  h.render();
  let writes = 0;
  h.element().style = new Proxy(h.element().style, {
    set(target, key, value) { writes++; target[key] = value; return true; },
  });
  h.render();
  assert.equal(writes, 0);
  h.control.width = 280;
  h.render();
  assert.equal(h.element().style.width, "280px");
  assert.ok(writes > 0);
});


test("unchanged visible legend header avoids repeated text writes but language and collapse refresh", t => {
  const h = harness(t);
  h.render();
  const title = h.element().querySelector(".map-legend-control-title");
  let text = title.textContent, writes = 0;
  Object.defineProperty(title, "textContent", { get: () => text, set(value) { writes++; text = value; } });
  h.render();
  h.render();
  assert.equal(writes, 0);
  h.language = "zh";
  h.render();
  assert.equal(writes, 1);
  assert.equal(text, "图例");
  h.control.collapsed = true;
  h.render();
  assert.equal(writes, 2);
  assert.ok(h.element().className.includes("is-collapsed"));
});


test("population thematic legend replaces paint categories and refreshes source and reference notes", (t) => {
  const h = harness(t);
  h.model.colors = [];
  h.model.thematicLegend = { title: "Population density · 2020",
    entries: [{ color: "#ffffb2", label: "0–1" }, { color: "#bd0026", label: "5000+" }],
    note: "Persons per square kilometre", referenceNote: "2020 reference on historical borders", source: "GHSL 1 km" };
  h.render();
  assert.equal(h.element().hidden, false);
  assert.deepEqual(h.labels(), ["0–1", "5000+"]);
  assert.equal(h.body().querySelector(".map-legend-section-title").textContent, "Population density · 2020");
  assert.deepEqual(h.body().querySelectorAll(".city-points-advanced-hint").map(node => node.textContent),
    ["Persons per square kilometre", "2020 reference on historical borders", "GHSL 1 km"]);
  const rebuilds = h.body().rebuilds;
  h.render();
  assert.equal(h.body().rebuilds, rebuilds);
  h.model.thematicLegend.referenceNote = "Modern boundaries";
  h.render();
  assert.equal(h.body().rebuilds, rebuilds + 1);
  h.model.thematicLegend = null;
  h.model.colors = ["#ff0000"];
  h.render();
  assert.deepEqual(h.labels(), ["Red"]);
  assert.equal(h.body().querySelector(".map-legend-section-title"), null);
});

test("scenario paint without named labels keeps the legend hidden", (t) => {
  const h = harness(t);
  h.model.activeScenarioId = "hoi4_1936";
  h.model.hasScenarioVisualEdits = true;
  h.model.colors = ["#ff0000", "#00ff00", "#0000ff"];
  h.model.labelMap = { "#00ff00": "   " };
  h.render();
  assert.equal(h.element().hidden, true);
  assert.deepEqual(h.labels(), []);
});

for (const activeScenarioId of ["hoi4_1936", ""]) {
  test(`only named colors render as legend rows (scenario: ${activeScenarioId || "none"})`, (t) => {
    const h = harness(t);
    h.model.activeScenarioId = activeScenarioId;
    h.model.colors = ["#ff0000", "#00ff00", "#0000ff"];
    h.model.labelMap = { "#00ff00": "Allies", "#0000ff": "" };
    h.render();
    assert.equal(h.element().hidden, false);
    assert.deepEqual(h.labels(), ["Allies"]);
    assert.equal(h.body().querySelectorAll(".map-legend-swatch")[0].style.backgroundColor, "#00ff00");
  });
}

test("special zone layers still show the legend when no color is named", (t) => {
  const h = harness(t);
  h.model.activeScenarioId = "hoi4_1936";
  h.model.labelMap = {};
  h.model.specialZoneLegendLayers = [{ id: "zone", name: "Zone", style: { fill: "pink" } }];
  h.render();
  assert.equal(h.element().hidden, false);
  assert.deepEqual(h.labels(), ["Zone"]);
});

test("图例默认按内容自动高度，用户调整过的高度才固定", async () => {
  const { normalizeLegendControl } = await import("../js/core/legend_state_normalizers.js");
  assert.equal(normalizeLegendControl({}).height, null);
  assert.equal(normalizeLegendControl({ height: null }).height, null);
  assert.equal(normalizeLegendControl({ height: 280 }).height, 280);
  assert.equal(normalizeLegendControl({ height: 20 }).height, 130);
});
