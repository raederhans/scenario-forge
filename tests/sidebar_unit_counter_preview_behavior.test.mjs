import test from "node:test";
import assert from "node:assert/strict";
import { createUnitCounterPreview } from "../js/ui/sidebar/unit_counter_preview.js";

const createPreview = () => createUnitCounterPreview({
  runtimeState: { countryNames: { GB: "Britain" } },
  countryNames: {},
  t: (label) => label,
  getDirectGeoLabel: (label) => label,
  getScenarioCountryMeta: () => null,
  ensureCountryPaletteColor: () => "#123456",
  getDynamicCountryEntries: () => [{ code: "GB" }],
  resolveUnitCounterCombatState: (candidate) => candidate,
});

test("catalog filters by category and case-insensitive keywords", () => {
  const preview = createPreview();
  assert.deepEqual(preview.getFilteredUnitCounterCatalog({ category: " GROUND ", query: " RIFLE " })
    .map((preset) => preset.id), ["INF"]);
  assert.deepEqual(preview.getFilteredUnitCounterCatalog({ category: "naval", query: "rifle" }), []);
  const unfeatured = preview.unitCounterPresets.find((preset) => !preset.featured);
  const options = preview.getSidebarUnitCounterPresetOptions(unfeatured.id);
  assert.equal(options[0].id, unfeatured.id);
  assert.equal(preview.featuredUnitCounterPresets.some((preset) => preset.id === unfeatured.id), false);
});

test("nation options and list labels retain normalized country identity", () => {
  const preview = createPreview();
  assert.deepEqual(preview.getUnitCounterNationOptions(), [{ value: "GB", label: "GB · Britain" }]);
  assert.equal(preview.getUnitCounterNationMeta("uk").tag, "GB");
  assert.equal(preview.formatUnitCounterListLabel({ presetId: "inf", nationTag: "uk", label: "First" }),
    "GB · First · INF · GAME");
});

function createNode() {
  return {
    children: [],
    style: { values: {}, setProperty(key, value) { this.values[key] = value; } },
    classList: { toggle() {} },
    append(...nodes) { this.children.push(...nodes); },
    appendChild(node) { this.children.push(node); },
    replaceChildren(...nodes) { this.children = nodes; },
  };
}

test("preview updates the existing card and compact presentation", (context) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: createNode } });
  context.after(() => {
    if (descriptor) Object.defineProperty(globalThis, "document", descriptor);
    else delete globalThis.document;
  });
  const preview = createPreview();
  const container = createNode();
  preview.renderUnitCounterPreview(container, { presetId: "inf", nationTag: "GB", label: "First", organizationPct: 65 });
  const card = container.children[0];
  const content = card.children[2].children[1];
  assert.equal(content.children[0].textContent, "First");
  assert.equal(content.children[3].children[0].children[2].textContent, "65");
  assert.equal(container.style.values["--unit-counter-accent"], "#123456");
  preview.renderUnitCounterPreview(container, { presetId: "inf", label: "Second", compactMode: true });
  assert.equal(container.children[0], card);
  assert.equal(content.children[0].textContent, "Second");
  assert.equal(content.children[3].hidden, true);
  assert.equal(content.children[4].hidden, true);
});
