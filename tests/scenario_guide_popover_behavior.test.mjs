import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createScenarioGuidePopoverController } from "../js/ui/toolbar/scenario_guide_popover.js";
import { UI_COPY_CATALOG } from "../js/core/i18n_catalog.js";

function element(dataset = {}) {
  const classes = new Set();
  return {
    dataset, hidden: false, textContent: "",
    classList: {
      add(name) { classes.add(name); },
      toggle(name, active) { active ? classes.add(name) : classes.delete(name); },
      contains(name) { return classes.has(name); },
    },
    setAttribute(name, value) { this[name] = value; },
  };
}

test("HGO guidance is available in its own tab", () => {
  const state = { activeScenarioId: "tno_1962" };
  const hgoNav = element({ guideSection: "hgo" });
  const hgoPanel = element({ guidePanel: "hgo" });
  const controller = createScenarioGuidePopoverController({
    state,
    scenarioGuideNavButtons: [hgoNav], scenarioGuidePanels: [hgoPanel],
    t: (key) => UI_COPY_CATALOG[key]?.zh || key,
  });
  controller.renderScenarioGuideSection("quick");
  assert.equal(hgoPanel.hidden, true);
  state.activeScenarioId = "hgo_1936";
  controller.renderScenarioGuideSection("hgo");
  assert.equal(hgoPanel.hidden, false);
  assert.equal(hgoNav["aria-selected"], "true");
});

test("new workspace labels agree across runtime and manual catalogs without changing generic Color", () => {
  const manual = Object.fromEntries(Object.entries(JSON.parse(readFileSync(new URL("../data/i18n/ui_copy.json", import.meta.url), "utf8"))).map(([key, entry]) => [key, entry.zh]));
  const keys = ["Save project", "Export image", "Not saved yet", "Unsaved changes", "Project downloaded",
    "Advanced settings", "Paint mode color", "Ownership", "Close panels"];
  for (const key of keys) assert.equal(UI_COPY_CATALOG[key].zh, manual[key], key);
  assert.equal(manual.Color, "颜色");
  assert.equal(UI_COPY_CATALOG["Paint mode color"].en, "Color");
  assert.equal(UI_COPY_CATALOG["Paint mode color"].zh, "着色");
});
