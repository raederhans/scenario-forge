import test from "node:test";
import assert from "node:assert/strict";
import { createScenarioInspectorController } from "../js/ui/sidebar/scenario_inspector_controller.js";

class Element {
  constructor(tagName = "div") {
    this.tagName = tagName;
    this.children = [];
    this.style = {};
    this.listeners = new Map();
    this.className = "";
    this.textContent = "";
    this.classList = {
      toggle: (name, enabled) => {
        const classes = new Set(this.className.split(" ").filter(Boolean));
        if (enabled) classes.add(name);
        else classes.delete(name);
        this.className = [...classes].join(" ");
      },
    };
  }
  setAttribute(name, value) { this[name] = value; }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  fire(type = "click") { if (!this.disabled) this.listeners.get(type)?.(); }
}

function nodes(root) { return [root, ...root.children.flatMap(nodes)]; }
function button(root, label) {
  const result = nodes(root).find((node) => node.tagName === "button" && node.textContent === label);
  assert.ok(result, `button exists: ${label}`);
  return result;
}
function country(extra = {}) {
  const groups = extra.hierarchyGroups || [];
  return { code: "AA", displayName: "Country A", hierarchyGroups: groups,
    groupSystems: [{ id: "geographic", groups }], ...extra };
}
function harness(t, overrides = {}) {
  const previous = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  t.after(() => { globalThis.document = previous; });
  const calls = [];
  const record = (name, result) => (...args) => { calls.push([name, ...args]); return result; };
  const view = { visualOpen: false, paintMode: "sovereignty", selectedColor: "#112233" };
  const host = new Element();
  const deps = {
    t: (value) => value,
    getView: () => ({ ...view }),
    selectGroupSystem: record("selectGroupSystem"),
    getCountryState: () => null,
    storeVisualOpen: record("storeOpen"),
    selectInspectorCountry: record("select"),
    getScenarioSubjectKindLabel: () => "Subject",
    getResolvedCountryColor: () => "#abcdef",
    getScenarioSubjectChildrenForParent: () => [],
    getReleasableChildrenForParent: () => [],
    appendActionSection: (parent, title, options) => {
      const section = new Element();
      section.textContent = title;
      section.options = options;
      return parent.appendChild(section);
    },
    createInspectorActionButton: (label, callback) => {
      const node = new Element("button");
      node.textContent = label;
      node.addEventListener("click", callback);
      return node;
    },
    applyHierarchyGroupWithMode: record("hierarchy"),
    render: () => {},
    createEmptyNote: (text) => Object.assign(new Element(), { textContent: text }),
    renderRegionalPresets: record("presets"),
    normalizeCountryCode: (value) => String(value || "").trim().toUpperCase(),
    resolveTerritoryEntry: () => ({ tag: "AA", boundary_variants: [], companion_actions: [] }),
    resolveTerritoryFeatureIds: () => ["visible", "hidden"],
    getSelectedBoundaryVariant: () => null,
    selectBoundaryVariant: record("variant"),
    applyScenarioReleasableCoreTerritory: record("core"),
    selectedCountryActionsSection: host,
    scheduleAdaptiveInspectorHeights: record("schedule"),
    setScenarioVisualAdjustmentsOpen: record("open"),
    filterToVisibleFeatureIds: record("filter", { matchedIds: ["visible"] }),
    clearVisualOverridesForFeatureIds: record("clearCore", { changed: 1 }),
    showToast: record("toast"),
    applyVisualColorToOwnedRegions: record("paintOwned", { changed: 1, matchedCount: 1 }),
    clearCountryVisualOverrides: record("clearOwned", { changed: 0 }),
    renderCountryColorSyncAffordance: record("colorSync"),
    ...overrides,
  };
  const controller = createScenarioInspectorController(deps);
  const root = new Element();
  return { root, host, view, calls, deps, render: (value) => controller.renderScenarioActionsPanel(root, value) };
}

test("no country clears old content and stops before scenario actions", (t) => {
  const h = harness(t);
  h.root.appendChild(new Element());
  h.render(null);
  assert.equal(h.root.children.length, 1);
  assert.match(h.root.children[0].textContent, /Select a country/);
  assert.deepEqual(h.calls, []);
});

test("parent and child navigation retain labels, swatches, and country targets", (t) => {
  const parent = country({ code: "PP", displayName: "Parent" });
  const child = country({ code: "CC", displayName: "Child", scenarioSubject: true });
  const h = harness(t, {
    getCountryState: (code) => code === "PP" ? parent : null,
    getScenarioSubjectChildrenForParent: () => [child],
  });
  h.render(country({ scenarioSubject: true, parentOwnerTags: [" pp "] }));
  const cards = nodes(h.root).filter((node) => node.tagName === "button" && node.className.includes("scenario-action-card"));
  assert.equal(cards.length, 2);
  assert.equal(cards[0].className, "scenario-action-card scenario-navigation-card scenario-parent-return-btn");
  assert.ok(nodes(cards[0]).some((node) => node.textContent === "Return to Parent"));
  assert.ok(nodes(cards[1]).some((node) => node.textContent === "(CC) · Subject"));
  assert.equal(nodes(cards[1]).find((node) => node.tagName === "span").style.backgroundColor, "#abcdef");
  cards.forEach((card) => card.fire());
  assert.deepEqual(h.calls.filter(([name]) => name === "select"), [["select", "PP"], ["select", "CC"]]);
  assert.ok(!nodes(h.root).some((node) => node.textContent === "Hierarchy Groups"));
});

test("core reference keeps visual actions while retired ownership actions are absent", (t) => {
  const variants = [{ id: "base", label: "Base", description: "" }, { id: "alt", label: "Alternate", description: "" }];
  const h = harness(t, {
    resolveTerritoryEntry: () => ({ tag: "AA", boundary_variants: variants, companion_actions: [] }),
    getSelectedBoundaryVariant: () => variants[0],
  });
  const target = country({ releasable: true });
  h.render(target);
  const labels = nodes(h.root).filter((node) => node.tagName === "button").map((node) => node.textContent);
  for (const label of ["Base", "Alternate", "Activate Releasable", "Reapply Core Territory"]) {
    assert.ok(!labels.includes(label), `retired action remains absent: ${label}`);
  }
  // Variants are a selection only: choosing one paints nothing by itself.
  const select = nodes(h.root).find((node) => node.tagName === "select");
  assert.deepEqual(select.children.map((option) => option.value), ["base", "alt"]);
  select.value = "alt";
  select.fire("change");
  assert.deepEqual(h.calls.find(([name]) => name === "variant").slice(1, 3), ["AA", "alt"]);
  assert.ok(!h.calls.some(([name]) => name === "core"));
  button(h.root, "Apply territory").fire();
  assert.ok(!h.calls.some(([name]) => ["activate", "transfers"].includes(name)));
  assert.ok(!h.calls.some(([name]) => name === "presets"));
  const core = h.calls.find(([name]) => name === "core");
  assert.equal(core[1], target);
  assert.deepEqual(core[2].companionActionIds, []);
  assert.equal(core[2].filterToVisibleFeatureIds, h.deps.filterToVisibleFeatureIds);
  assert.equal("actionMode" in core[2], false);
});

test("non-releasable country retains reference painting without an ownership target action", (t) => {
  const h = harness(t);
  h.render(country());
  assert.ok(!nodes(h.root).some((node) => node.textContent === "Target This Country"));
  button(h.root, "Paint Reference Regions With Country Color").fire();
  assert.equal(h.calls.filter(([name]) => name === "activate").length, 0);
  assert.equal(h.calls.filter(([name]) => name === "paintOwned").length, 1);
});

test("missing core disables visual core buttons and explains missing territory", (t) => {
  const h = harness(t, { resolveTerritoryFeatureIds: () => [] });
  h.render(country({ releasable: true }));
  assert.equal(button(h.root, "Apply territory").disabled, true);
  assert.equal(button(h.root, "Clear Territory Visual Overrides").disabled, true);
  assert.equal(nodes(h.root).filter((node) => node.textContent === "No core territory defined").length, 1);
});

test("existing scenario countries keep country visuals and add territory only with a catalog entry", (t) => {
  const withEntry = harness(t);
  withEntry.render(country());
  button(withEntry.root, "Paint Reference Regions With Country Color");
  button(withEntry.root, "Apply territory");
  const without = harness(t, { resolveTerritoryEntry: () => null });
  without.render(country());
  button(without.root, "Paint Reference Regions With Country Color");
  assert.ok(!nodes(without.root).some((node) => node.tagName === "button" && node.textContent === "Apply territory"));
});

test("visual core actions preserve visual mode and filter clear targets to visible features", (t) => {
  const h = harness(t);
  const target = country({ releasable: true });
  h.render(target);
  button(h.root, "Apply territory").fire();
  button(h.root, "Clear Territory Visual Overrides").fire();
  assert.equal(h.calls.find(([name]) => name === "core")[1], target);
  assert.deepEqual(h.calls.find(([name]) => name === "filter"), ["filter", ["visible", "hidden"]]);
  const clear = h.calls.find(([name]) => name === "clearCore");
  assert.deepEqual(clear[1], ["visible"]);
  assert.equal(clear[2].historyKind, "scenario-core-clear-visual");
  assert.equal(h.calls.filter(([name]) => name === "open").length, 2);
  assert.ok(!h.calls.some(([name]) => ["activate", "hierarchy", "variant"].includes(name)));
});

test("hierarchy visuals read click-time color and leave ownership routes untouched", (t) => {
  const h = harness(t);
  const group = { label: "Group A" };
  h.render(country({ hierarchyGroups: [group] }));
  const visual = nodes(h.root).find((node) => node.textContent === "Hierarchy Groups (Visual Color)");
  h.view.selectedColor = "#fedcba";
  button(visual, "Group A").fire();
  button(h.root, "Paint Reference Regions With Country Color").fire();
  button(h.root, "Clear Reference Region Color Edits").fire();
  const hierarchy = h.calls.filter(([name]) => name === "hierarchy");
  assert.equal(hierarchy.length, 1);
  assert.equal(hierarchy[0][2].mode, "visual");
  assert.equal(hierarchy[0][2].color, "#fedcba");
  assert.ok(!h.calls.some(([name]) => ["activate", "core", "variant", "paintMode"].includes(name)));
  assert.deepEqual(h.calls.filter(([name]) => name === "presets").map((call) => call[3].mode), ["visual"]);
});

test("hierarchy exposes only a visual action even if stale view state requests ownership", (t) => {
  const h = harness(t);
  const group = { label: "Group A" };
  h.render(country({ hierarchyGroups: [group] }));
  button(h.root, "Group A").fire();
  const call = h.calls.find(([name]) => name === "hierarchy");
  assert.equal(call[2].mode, "visual");
  assert.equal(nodes(h.root).filter((node) => node.textContent === "Group A").length, 1);
  assert.ok(!nodes(h.root).some((node) => node.textContent === "Hierarchy Groups"));
});

test("color disclosure opens by default, records toggles, and has no ownership brush switch", (t) => {
  const h = harness(t);
  h.render(country());
  const details = nodes(h.root).find((node) => node.tagName === "details");
  assert.equal(details.open, true);
  assert.match(h.host.className, /has-open-visual-adjustments/);
  details.open = false;
  details.fire("toggle");
  assert.equal(h.host.className, "");
  assert.deepEqual(h.calls.slice(-2), [["storeOpen", false], ["schedule"]]);
  assert.ok(!nodes(h.root).some((node) => node.textContent === "Use Visual Color Brush"));
  h.view.paintMode = "visual";
  h.render(country());
  assert.ok(!nodes(h.root).some((node) => node.textContent === "Return to Political Ownership Brush"));
  assert.ok(!h.calls.some(([name]) => name === "paintMode"));
});

test("group source and toggle display the selected system without painting until a group is clicked", (t) => {
  const district = { id: "district:AA:one", label: "District One", labelZh: "第一大区", children: ["a"] };
  const geographic = { id: "AA_north", label: "North", children: ["b"] };
  const h = harness(t);
  h.view.language = "zh";
  const target = country({
    hierarchyGroups: [district],
    groupSystems: [{ id: "scenario_districts", groups: [district] }, { id: "geographic", groups: [geographic] }],
  });
  h.render(target);
  assert.ok(nodes(h.root).some((node) => node.tagName === "small" && node.textContent === "Scenario districts"));
  assert.equal(button(h.root, "Scenario districts")["aria-pressed"], "true");
  button(h.root, "第一大区");
  button(h.root, "Modern administrative regions").fire();
  assert.ok(nodes(h.root).some((node) => node.tagName === "small" && node.textContent === "Modern administrative regions"));
  assert.equal(button(h.root, "Modern administrative regions")["aria-pressed"], "true");
  assert.ok(!nodes(h.root).some((node) => node.textContent === "第一大区"));
  assert.deepEqual(h.calls.filter(([name]) => name === "selectGroupSystem"), [["selectGroupSystem", "AA", "geographic"]]);
  assert.ok(!h.calls.some(([name]) => ["hierarchy", "paintOwned", "open"].includes(name)));
  button(h.root, "North").fire();
  assert.equal(h.calls.find(([name]) => name === "hierarchy")[1], geographic);
  h.view.inspectorGroupSystemByCode = { AA: "geographic" };
  h.render(target);
  button(h.root, "North");
  assert.ok(!nodes(h.root).some((node) => node.textContent === "第一大区"));
});
