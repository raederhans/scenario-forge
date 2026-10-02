const { test, expect } = require("@playwright/test");
const { gotoApp, waitForAppInteractive } = require("./support/playwright-app");

test.setTimeout(60_000);

async function openWorkspace(page, height = 900) {
  await page.setViewportSize({ width: 1440, height });
  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);
  await expect(page.locator("body")).toHaveClass(/editor-workspace/);
}

async function expectContext(page, key) {
  await expect(page.locator("#rightSidebarContent")).toHaveAttribute("data-editor-context", key);
  await expect(page.locator(`#editorProperty-${key}`)).toBeVisible();
}

test("object and layer tasks restore their own entries while palette and assets retain properties", async ({ page }) => {
  await openWorkspace(page);
  await page.locator("#editorObjects-water").click();
  await page.locator("#editorWaterFilters summary").click();
  const waterRow = page.locator("#waterRegionList .inspector-item-btn").first();
  await expect(waterRow).toBeVisible();
  const waterId = await waterRow.getAttribute("data-region-id");
  expect(waterId).toBeTruthy();
  await page.locator("#waterRegionSearch").fill(waterId);
  await page.locator("#waterRegionList .inspector-item-btn").first().click();
  await expectContext(page, "water");

  // The first visit activates the first native layer with an available panel.
  await page.locator("#editorTaskLayersBtn").click();
  await expectContext(page, "data-appearance-panel-borders");
  await expect(page.locator("#editorTaskLayersBtn")).toBeFocused();
  await page.locator("#appearanceTabCityPoints").click();
  const scale = page.locator("#cityPointsMarkerScale");
  const initialScale = await scale.inputValue();
  await scale.press("ArrowRight");
  await expect(scale).not.toHaveValue(initialScale);
  const editedScale = await scale.inputValue();
  const propertyUrl = page.url();

  for (const task of ["Palette", "Assets"]) {
    await page.locator(`#editorTask${task}Btn`).click();
    await expectContext(page, "data-appearance-panel-citypoints");
    await expect(scale).toHaveValue(editedScale);
    expect(page.url()).toBe(propertyUrl);
  }
  await page.locator("#editorTaskObjectsBtn").click();
  await expectContext(page, "water");
  await expect(page.locator("#editorObjects-water")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#waterRegionSearch")).toHaveValue(waterId);
  await expect(page.locator("#editorWaterFilters")).toHaveJSProperty("open", true);
  await expect.poll(() => page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    return state.selectedWaterRegionId;
  })).toBe(waterId);

  await page.locator("#editorTaskLayersBtn").click();
  await expectContext(page, "data-appearance-panel-citypoints");
  await expect(scale).toHaveValue(editedScale);
  await expect(page.locator("#appearanceTabCityPoints")).toHaveAttribute("aria-selected", "true");
});

test("the active task returns from Project without duplicate Back entries or scroll loss", async ({ page }) => {
  await openWorkspace(page, 600);
  await page.locator("#editorTaskLayersBtn").click();
  await page.locator("#appearanceTabCityPoints").click();
  const right = page.locator("#rightSidebarContent");
  const savedScroll = await right.evaluate(async (element) => {
    element.scrollTop = 120;
    await new Promise(requestAnimationFrame);
    return element.scrollTop;
  });
  expect(savedScroll).toBeGreaterThan(0);
  const layerUrl = page.url();
  await page.locator("#inspectorSidebarTabProject").click();
  await expectContext(page, "project");
  expect(new URL(page.url()).searchParams.get("scope")).toBe("current-project");

  await page.locator("#editorTaskLayersBtn").click();
  await expectContext(page, "data-appearance-panel-citypoints");
  await expect(page.locator("#editorTaskLayersBtn")).toBeFocused();
  await expect.poll(() => right.evaluate((element) => element.scrollTop)).toBe(savedScroll);
  expect(page.url()).toBe(layerUrl);

  // Selecting an already restored task must retain the no-change DOM fast path.
  await page.evaluate(() => {
    window.__taskContextMutations = 0;
    window.__taskContextObserver = new MutationObserver((records) => {
      window.__taskContextMutations += records.length;
    });
    for (const node of document.querySelectorAll(
      "#rightSidebarContent, #editorPropertiesTitle, #editorPropertiesBackBtn, .editor-property-panel, .editor-task-panel, #editorTaskNav button"
    )) {
      window.__taskContextObserver.observe(node, {
        attributes: true, childList: true, characterData: true,
      });
    }
  });
  await page.locator("#editorTaskLayersBtn").click();
  const mutations = await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    window.__taskContextObserver.disconnect();
    const count = window.__taskContextMutations;
    delete window.__taskContextObserver;
    delete window.__taskContextMutations;
    return count;
  });
  expect(mutations).toBe(0);
  await expect.poll(() => right.evaluate((element) => element.scrollTop)).toBe(savedScroll);

  for (const key of ["project", "data-appearance-panel-citypoints", "data-appearance-panel-borders"]) {
    await page.locator("#editorPropertiesBackBtn").click();
    await expectContext(page, key);
    await expect(page.locator("#editorPropertiesTitle")).toBeFocused();
  }
  await page.locator("#editorTaskObjectsBtn").click();
  await expectContext(page, "countries");
  await page.locator("#inspectorSidebarTabProject").click();
  await expectContext(page, "project");
  await page.locator("#editorTaskObjectsBtn").click();
  await expectContext(page, "countries");
});

test("task context restoration keeps collapsed properties and the narrow task drawer intact", async ({ page }) => {
  await openWorkspace(page);
  await page.locator("#editorTaskLayersBtn").click();
  await page.locator("#appearanceTabCityPoints").click();
  await page.locator("#editorTaskObjectsBtn").click();
  await page.locator("#rightSidebarCollapseBtn").click();
  await page.locator("#editorTaskLayersBtn").click();
  await expect(page.locator("body")).toHaveClass(/right-sidebar-collapsed/);
  await expect(page.locator("#rightSidebarCollapseBtn")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#rightSidebarContent")).toHaveAttribute("data-editor-context", "data-appearance-panel-citypoints");

  await page.setViewportSize({ width: 768, height: 900 });
  await page.locator("#leftPanelToggle").click();
  for (const [task, context] of [["Objects", "countries"], ["Layers", "data-appearance-panel-citypoints"]]) {
    await page.locator(`#editorTask${task}Btn`).click();
    await expect(page.locator("#rightSidebarContent")).toHaveAttribute("data-editor-context", context);
    await expect(page.locator("body")).toHaveClass(/left-drawer-open/);
    await expect(page.locator("body")).not.toHaveClass(/right-drawer-open/);
    await expect(page.locator("#leftSidebar")).toHaveJSProperty("inert", false);
    await expect(page.locator("#rightSidebar")).toHaveJSProperty("inert", true);
    await expect(page.locator(`#editorTask${task}Btn`)).toBeFocused();
  }
  // A concrete property entry still opens the right drawer through its owner.
  await page.locator("#editorLayer-legend").click();
  await expect(page.locator("body")).toHaveClass(/right-drawer-open/);
  await expect(page.locator("body")).not.toHaveClass(/left-drawer-open/);
  await expectContext(page, "legend");
});

test("migrated headings label their content and Project uses button state after navigation", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("map_lang", "zh"));
  await openWorkspace(page);
  const headingLocations = [
    ["appearanceSectionHeading", "#editorTask-layers .editor-layer-group"],
    ["mapContentSectionHeading", "#editorTask-layers .editor-layer-group"],
    ["countryInspectorHeading", "#countryInspectorSection"],
    ["selectedCountryActionsHeading", "#selectedCountryActionsSection"],
    ["specialRegionInspectorHeading", "#specialRegionInspectorSection"],
    ["waterInspectorHeading", "#waterInspectorSection"],
    ["projectLegendHeading", "#projectLegendSection"],
    ["legendProjectHeading", "#legendProjectSection"],
    ["frontlineProjectHeading", "#frontlineProjectSection"],
    ["transportProjectHeading", "#transportProjectSection"],
    ["exportProjectHeading", "#exportProjectSection"],
    ["inspectorUtilitiesHeading", "#inspectorUtilitiesSection"],
    ["diagnosticsHeading", "#diagnosticsSection"],
  ];
  for (const [heading, host] of headingLocations) {
    await expect(page.locator(`${host} #${heading}`)).toHaveCount(1);
  }
  await expect(page.locator("#inspectorSidebarPanel h2.visually-hidden")).toHaveCount(0);
  const missingLabels = await page.evaluate(() => [...document.querySelectorAll(
    "#editorTask-layers [aria-labelledby], #editorTask-objects [aria-labelledby], #editorPropertiesBody [aria-labelledby]"
  )].flatMap((node) => (node.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean)
    .filter((id) => !document.getElementById(id))));
  expect(missingLabels).toEqual([]);
  await expect(page.locator("#waterInspectorHeading")).toHaveText("水域地块");
  await expect(page.locator("#frontlineProjectHeading")).toHaveText("前线与战略标注");
  await expect(page.locator("#exportProjectHeading")).toHaveText("导出");
  // Header wiring is tested after the lazy full-locale resource is ready;
  // map interactivity alone does not imply localization hydration has finished.
  await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    await state.ensureFullLocalizationDataReadyFn({ reason: "heading-language-test", renderNow: false });
  });
  await page.locator("#btnToggleLang").click();
  await expect(page.locator("#waterInspectorHeading")).toHaveText("Water Regions");
  await expect(page.locator("#frontlineProjectHeading")).toHaveText("Frontlines & Annotations");
  await expect(page.locator("#exportProjectHeading")).toHaveText("Export");

  const project = page.locator("#inspectorSidebarTabProject");
  for (const [trigger, pressed] of [["#inspectorSidebarTabProject", "true"], ["#editorTaskObjectsBtn", "false"]]) {
    await page.locator(trigger).click();
    await expect(project).not.toHaveAttribute("role", "tab");
    await expect(project).not.toHaveAttribute("aria-selected", /.+/);
    await expect(project).toHaveAttribute("aria-pressed", pressed);
  }
});
