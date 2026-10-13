import test from "node:test";
import assert from "node:assert/strict";
import { buildLegendExportEntries, buildLegendCsv, buildLegendSvg, createLegendExportControls } from "../js/ui/sidebar/legend_export.js";

function element(tagName) {
  return { tagName, children: [], listeners: {}, attributes: {},
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); },
    setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener(key, callback) { this.listeners[key] = callback; } };
}

test("legend export preserves order and visible special zones without changing source data", () => {
  const input = Object.freeze({
    colors: Object.freeze(["#AbC", "#aabbcc", "invalid", "#123456"]),
    labels: Object.freeze({ "#aabbcc": "First" }),
    specialZones: Object.freeze([
      Object.freeze({ name: "Visible", style: Object.freeze({ pattern: "dots", fill: "#def" }) }),
      Object.freeze({ name: "Hidden", visible: false }),
      Object.freeze({ name: "No legend", legendVisible: false }),
    ]),
  });
  const entries = buildLegendExportEntries(input);
  assert.deepEqual(entries.map(({ label }) => label), ["First", "Category 2", "Visible"]);
  assert.equal(entries[2].pattern, "dots");
  assert.equal(entries[2].color, "#ddeeff");
  assert.equal(buildLegendExportEntries({ colors: ["#abc"], language: "zh" })[0].label, "类别 1");
});

test("CSV preserves Unicode, quotes and multiline labels and protects formula-looking cells", () => {
  const labels = ['中文, "Legend"\nSecond line', " =SUM(1,2)", "@external", "-42"];
  const entries = labels.map(label => ({ kind: "color", label, color: "#abcdef", pattern: "solid" }));
  const csv = buildLegendCsv(entries);
  assert.ok(csv.startsWith('\uFEFF"kind","label","color"'));
  assert.ok(csv.includes('"中文, ""Legend""\nSecond line"'));
  assert.ok(csv.includes('"\' =SUM(1,2)"'));
  assert.ok(csv.includes('"\'@external"'));
  assert.ok(csv.endsWith("\r\n"));
});

test("SVG includes all pages, complete labels and self-contained pattern definitions", () => {
  const patterns = ["solid", "diagonalHatch", "crossHatch", "horizontalLines", "wavyLines", "dots", "denseDots", "concentric", "chevrons", "outlineOnly"];
  const colors = Array.from({ length: 35 }, (_, index) => `#${(index + 1).toString(16).padStart(6, "0")}`);
  const hostileLabel = '<script>alert("x")</script> & 中文';
  const entries = buildLegendExportEntries({ colors, labels: { [colors[0]]: hostileLabel },
    specialZones: patterns.map(pattern => ({ name: pattern, style: { pattern } })) });
  const svg = buildLegendSvg(entries);
  assert.equal((svg.match(/<g><title>/g) || []).length, 45);
  assert.ok(svg.includes("Category 35"));
  assert.ok(svg.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; 中文"));
  assert.equal(svg.includes("<script>"), false);
  assert.equal((svg.match(/<pattern /g) || []).length, 8);
  assert.equal(/<(?:image|foreignObject|script)\b/u.test(svg), false);
  assert.ok(buildLegendSvg(entries, { language: "zh" }).includes(">特殊区域</text>"));
});

test("export controls download current labels and all entries, with an accessible status", async () => {
  const model = { colors: Array.from({ length: 35 }, (_, index) => `#${(index + 1).toString(16).padStart(6, "0")}`),
    labels: {}, fileStem: "scenario/1936", language: "en" };
  const downloads = [];
  const controls = createLegendExportControls({ documentRef: { createElement: element }, getModel: () => model,
    download: async (blob, filename) => { downloads.push({ text: await blob.text(), filename, type: blob.type }); return true; } });
  const [actions, status] = controls.children;
  assert.equal(status.attributes.role, "status");
  assert.ok(status.textContent.includes("35"));
  model.labels[model.colors[0]] = "Updated after panel render";
  await actions.children[0].listeners.click();
  await actions.children[1].listeners.click();
  assert.equal(downloads[0].filename, "scenario-1936-legend.svg");
  assert.equal(downloads[1].filename, "scenario-1936-legend.csv");
  assert.ok(downloads.every(file => file.text.includes("Updated after panel render")));
  assert.ok(downloads[0].text.includes("Category 35"));
  assert.ok(downloads[1].text.includes(`category:${model.colors[34]}`));
  assert.ok(downloads[1].text.includes('"schemaVersion","scenarioId","scenarioBaselineHash","entryId"'));
  assert.match(downloads[0].type, /^image\/svg\+xml/u);
  assert.equal(actions.children[0].disabled, false);
});

test("long SVG labels wrap at word boundaries and retain the complete accessible label", () => {
  const label = "United Kingdom of Great Britain and Northern Ireland";
  const entries = buildLegendExportEntries({ colors: ["#abc"], labels: { "#aabbcc": label } });
  const svg = buildLegendSvg(entries);
  assert.ok(svg.includes(`<g><title>${label}</title>`));
  assert.ok(svg.includes(">United Kingdom of Great Britain</tspan>"));
  assert.ok(svg.includes(">and Northern Ireland</tspan>"));
});

test("empty and failed legend exports give actionable feedback and restore controls", async () => {
  const documentRef = { createElement: element };
  const empty = createLegendExportControls({ documentRef, getModel: () => ({}), download: () => assert.fail("empty download") });
  assert.equal(empty.children[0].children[0].disabled, true);
  const messages = [];
  const failed = createLegendExportControls({ documentRef, getModel: () => ({ colors: ["#abc"], language: "zh" }),
    download: async () => { throw new Error("denied"); }, showToast: message => messages.push(message) });
  await failed.children[0].children[0].listeners.click();
  assert.equal(failed.children[1].textContent, "图例导出失败，请重试。");
  assert.equal(messages.length, 1);
  assert.equal(failed.children[0].children[0].disabled, false);
});
