import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createScenarioGuidePopoverController } from "../js/ui/toolbar/scenario_guide_popover.js";
import { createUiSurfaceUrlState } from "../js/ui/ui_surface_url_state.js";
import { UI_COPY_CATALOG } from "../js/core/i18n_catalog.js";

function element(dataset = {}) {
  const classes = new Set();
  return {
    dataset, hidden: false, textContent: "",
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
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

test("legacy checks deep links open Quick start on first visit and after visiting another tab", context => {
  const originalDocument = globalThis.document;
  const originalLocation = globalThis.location;
  globalThis.document = { body: element() };
  globalThis.location = new URL("https://example.test/?view=guide&guide_section=checks");
  context.after(() => {
    globalThis.document = originalDocument;
    globalThis.location = originalLocation;
  });
  const sections = ["quick", "tools"];
  const panels = sections.map(guidePanel => element({ guidePanel }));
  const nav = sections.map(guideSection => element({ guideSection }));
  const url = createUiSurfaceUrlState({ uiUrlStateKeys: { view: "view", guideSection: "guide_section" } });
  const guide = createScenarioGuidePopoverController({
    state: {}, scenarioGuidePopover: element(), scenarioGuideNavButtons: nav,
    scenarioGuidePanels: panels, getGuideSectionFromUrl: url.getScenarioGuideSectionFromUrl, t: key => key,
  });
  guide.openScenarioGuideSurface();
  assert.deepEqual(panels.map(panel => panel.hidden), [false, true]);
  guide.renderScenarioGuideSection("tools");
  assert.deepEqual(panels.map(panel => panel.hidden), [true, false]);
  guide.closeScenarioGuideSurface();
  guide.openScenarioGuideSurface();
  assert.deepEqual(panels.map(panel => panel.hidden), [false, true]);
  assert.equal(nav[0]["aria-selected"], "true");
});

test("workspace catalog labels match the locales snapshot and distinguish paint mode from generic Color", () => {
  const { ui } = JSON.parse(readFileSync(new URL("../data/locales.json", import.meta.url), "utf8"));
  const keys = ["Save project", "Export image", "Not saved yet", "Unsaved changes", "Project downloaded",
    "Advanced settings", "Paint mode color", "Ownership", "Close panels"];
  for (const key of keys) assert.equal(UI_COPY_CATALOG[key].zh, ui[key].zh, key);
  assert.equal(UI_COPY_CATALOG.Color.zh, "颜色");
  assert.equal(UI_COPY_CATALOG["Paint mode color"].en, "Color");
  assert.equal(UI_COPY_CATALOG["Paint mode color"].zh, "着色");
});
