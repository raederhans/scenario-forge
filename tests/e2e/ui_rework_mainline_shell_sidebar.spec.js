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
