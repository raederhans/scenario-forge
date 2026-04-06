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
  await expect(page.locator("#dockExportBtn")).toHaveText("Export");

  await page.locator("#scenarioGuideBtn").click();

  await expect(page.locator("#inspectorSidebarTabProject")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#inspectorUtilitiesSection")).toHaveJSProperty("open", true);
  await expect(page.locator("#scenarioGuidePopover")).toBeVisible();

  const search = await page.evaluate(() => globalThis.location.search);
  expect(search).toContain("scope=current-project");
  expect(search).toContain("view=guide");
});
