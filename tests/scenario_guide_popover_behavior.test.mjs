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

test("main quick guide remains independent while the HGO guide links to its own editor", () => {
  const state = { activeScenarioId: "tno_1962" };
  const identity = element();
  const ownerHeading = element();
  const editHeading = element();
  const hgoNav = element({ guideSection: "hgo" });
  const hgoPanel = element({ guidePanel: "hgo" });
  const nodes = new Map([
    ["#scenarioGuideStepActive", identity],
    ["#scenarioGuideStepOwner strong", ownerHeading],
    ["#scenarioGuideStepApplyActions strong", editHeading],
  ]);
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  for (const id of ["scenarioGuideStepActive", "scenarioGuideStepOwner", "scenarioGuideStepApplyActions"]) {
    assert.ok(html.includes(`id="${id}"`), `${id} exists in the shipping guide`);
  }
  const controller = createScenarioGuidePopoverController({
    state,
    scenarioGuidePopover: { querySelector: (selector) => nodes.get(selector) },
    scenarioGuideNavButtons: [hgoNav], scenarioGuidePanels: [hgoPanel],
    t: (key) => UI_COPY_CATALOG[key]?.zh || key,
  });
  controller.renderScenarioGuideSection("quick");
  assert.equal(identity.hidden, true);
  assert.equal(identity.classList.contains("hidden"), true);
  assert.equal(ownerHeading["data-i18n"], "3. Set the active owner");
  assert.equal(editHeading.textContent, "4. 编辑、调整样式并保存");
  state.activeScenarioId = "hgo_1936";
  controller.syncScenarioGuideTriggerButtons();
  assert.equal(identity.hidden, true);
  assert.equal(identity.classList.contains("hidden"), true);
  assert.equal(ownerHeading["data-i18n"], "3. Set the active owner");
  assert.equal(editHeading.textContent, "4. 编辑、调整样式并保存");
  state.activeScenarioId = "";
  controller.renderScenarioGuideSection("hgo");
  assert.equal(identity.hidden, true);
  assert.equal(hgoPanel.hidden, false);
  assert.equal(hgoNav["aria-selected"], "true");
  assert.ok(html.includes('href="apps/hgo/index.html"'), "HGO entry navigates to the independent app");
});

test("new workspace labels agree across runtime and manual catalogs without changing generic Color", () => {
  const manual = JSON.parse(readFileSync(new URL("../data/i18n/manual_ui.json", import.meta.url), "utf8"));
  const keys = ["Save project", "Export image", "Not saved yet", "Unsaved changes", "Project downloaded",
    "Advanced settings", "Paint mode color", "Ownership", "Close panels", "3. Set the active owner",
    "4. Set the active owner", "4. Edit, style, then save", "5. Edit, style, then save"];
  for (const key of keys) assert.equal(UI_COPY_CATALOG[key].zh, manual[key], key);
  assert.equal(manual.Color, "颜色");
  assert.equal(UI_COPY_CATALOG["Paint mode color"].en, "Color");
  assert.equal(UI_COPY_CATALOG["Paint mode color"].zh, "着色");
});
