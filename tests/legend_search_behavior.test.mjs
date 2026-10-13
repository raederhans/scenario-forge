import test from "node:test";
import assert from "node:assert/strict";
import { buildLegendSearchItems, filterLegendEntries, createLegendSearchControls } from "../js/ui/sidebar/legend_search.js";

function element(tagName) {
  return { tagName, value: "", children: [], listeners: {}, attributes: {},
    append(...children) { this.children.push(...children); }, appendChild(child) { this.children.push(child); },
    setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener(key, callback) { this.listeners[key] = callback; }, focus() { this.focused = true; } };
}

test("legend search finds multilingual names, accent variants and short hex colors", () => {
  const items = buildLegendSearchItems({ colors: ["#aabbcc", "#123456", "#223344"],
    labels: { "#aabbcc": "Côte d’Ivoire", "#123456": "北方地区", "#223344": "Other" } });
  assert.equal(filterLegendEntries(items, { query: "COTE #ABC" })[0].label, "Côte d’Ivoire");
  assert.equal(filterLegendEntries(items, { query: "北方" })[0].color, "#123456");
  assert.equal(filterLegendEntries(items, { query: "123456" })[0].label, "北方地区");
  assert.deepEqual(filterLegendEntries(items, { query: "other #123456" }), []);
});

test("legend search includes entries beyond thirty and filters visible special zones", () => {
  const colors = Object.freeze(Array.from({ length: 35 }, (_, index) => `#${String(index + 1).padStart(6, "0")}`));
  const zone = Object.freeze({ id: "buffer", name: "Border buffer", style: Object.freeze({ fill: "#facc15" }) });
  const items = buildLegendSearchItems({ colors, specialZones: [zone, { name: "Hidden", visible: false }], language: "zh" });
  assert.equal(items.length, 36);
  assert.equal(filterLegendEntries(items, { query: "#000035" })[0].index, 34);
  assert.equal(filterLegendEntries(items, { kind: "special-zone" })[0].layer, zone);
  assert.equal(filterLegendEntries(items, { kind: "color" }).length, 35);
  assert.equal(items[34].label, "类别 35");
});

test("legend search controls retain input, reset filters and support Enter and Escape", () => {
  const changes = [];
  let entered = 0;
  const controls = createLegendSearchControls({ documentRef: { createElement: element },
    onChange: filters => changes.push(filters), onEnter: () => { entered += 1; } });
  const [field, summary] = controls.element.children;
  const [input, clear] = field.children;
  const [select, status] = summary.children;
  controls.update({ language: "en", total: 35, matches: 35 });
  input.value = "Latest label";
  input.listeners.input();
  controls.update({ language: "zh", total: 35, matches: 1 });
  assert.equal(input.value, "Latest label");
  assert.equal(input.attributes["aria-label"], "搜索图例");
  assert.equal(status.textContent, "1 / 35 项");
  select.value = "special-zone";
  select.listeners.change();
  assert.deepEqual(changes.at(-1), { query: "Latest label", kind: "special-zone" });
  input.listeners.keydown({ key: "Enter", isComposing: true });
  assert.equal(entered, 0);
  input.listeners.keydown({ key: "Enter", preventDefault() {} });
  assert.equal(entered, 1);
  input.listeners.keydown({ key: "Escape", preventDefault() {} });
  assert.deepEqual(controls.getFilters(), { query: "", kind: "all" });
  assert.equal(clear.disabled, true);
  assert.equal(input.value, "");
  assert.equal(select.value, "all");
  clear.listeners.click();
  assert.equal(input.focused, true);
});
