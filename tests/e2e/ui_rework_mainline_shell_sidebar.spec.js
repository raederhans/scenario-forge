const { test, expect } = require("@playwright/test");
const { gotoApp, waitForAppInteractive } = require("./support/playwright-app");


test("phase 02 shell and sidebar mainline stays on the new rails", async ({ page }) => {
  test.setTimeout(90_000);
  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);

  await expect(page.locator("#scenarioContextBar #scenarioTransportWorkbenchBtn")).toHaveCount(0);
  await expect(page.locator("#zoomControls #scenarioTransportWorkbenchBtn")).toBeVisible();
  await expect(page.locator("#scenarioGuideBtn")).toHaveText("Guide");

  await expect(page.locator("#dockEditPopoverBtn")).toHaveCount(0);
  await expect(page.locator("#presetClear")).toHaveCount(0);

  await expect(page.locator("#dockReferenceBtn")).toHaveText("Reference");
  await expect(page.locator("#dockExportBtn")).toHaveText("Open workbench");

  await page.locator("#scenarioGuideBtn").click();

  await expect(page.locator("#scenarioGuideBackdrop")).toBeVisible();
  await expect(page.locator("#scenarioGuidePopover")).toBeVisible();
  await expect(page.locator("body")).toHaveClass(/scenario-guide-open/);
  await expect(page.locator("body")).not.toHaveClass(/right-drawer-open/);

  const search = await page.evaluate(() => globalThis.location.search);
  expect(search).toContain("view=guide");

  await page.keyboard.press("Escape");
  await expect(page.locator("#scenarioGuideBackdrop")).toBeHidden();
  await expect(page.locator("#scenarioGuidePopover")).toBeHidden();
  await expect(page.locator("#scenarioGuideBtn")).toBeFocused();
});


test("adaptive scenario bar and bottom dock stay inside the viewport", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1024, height: 760 });
  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);

  await page.evaluate(() => {
    const scenarioText = document.querySelector("#scenarioContextScenarioText");
    if (scenarioText) {
      scenarioText.textContent = "Scenario: " + "Very Long Scenario Name ".repeat(16);
    }
    const activeText = document.querySelector("#scenarioContextActiveText");
    if (activeText) {
      activeText.textContent = "Active: " + "Very Long Country Name ".repeat(16);
    }
  });

  const metrics = await page.evaluate(() => {
    const rectToObject = (rect) => rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height } : null;
    const scenario = rectToObject(document.querySelector("#scenarioContextBar")?.getBoundingClientRect());
    const zoom = rectToObject(document.querySelector("#zoomControls")?.getBoundingClientRect());
    const dock = rectToObject(document.querySelector("#bottomDock")?.getBoundingClientRect());
    return {
      scenario,
      zoom,
      dock,
      viewportWidth: window.innerWidth,
      bodyScrollWidth: document.documentElement.scrollWidth,
      scenarioStyle: document.querySelector("#scenarioContextBar")?.getAttribute("style") || "",
      scenarioMaxWidth: document.querySelector("#scenarioContextBar")?.style.maxWidth || "",
    };
  });

  expect(metrics.scenarioMaxWidth).toBe("");
  expect(metrics.scenario.left).toBeGreaterThanOrEqual(0);
  expect(metrics.scenario.right).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.dock.left).toBeGreaterThanOrEqual(0);
  expect(metrics.dock.right).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(metrics.scenario.bottom <= metrics.zoom.top || metrics.scenario.top >= metrics.zoom.bottom || metrics.scenario.right <= metrics.zoom.left).toBeTruthy();
});
