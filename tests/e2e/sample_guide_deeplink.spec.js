const { test, expect } = require("@playwright/test");
const { gotoApp, waitForShellReady, waitForProjectImportCompletion } = require("./support/playwright-app");

test.setTimeout(180000);

async function readSampleDeeplinkState(page) {
  return page.evaluate(async () => {
    const stateModuleUrl = new URL("./js/core/state.js", globalThis.location.href).toString();
    const { state } = await import(stateModuleUrl);
    return {
      activeScenarioId: String(state.activeScenarioId || ""),
      status: String(state.sampleProjectDeeplink?.status || ""),
      sampleId: String(state.sampleProjectDeeplink?.sampleId || ""),
      scenarioId: String(state.sampleProjectDeeplink?.scenarioId || ""),
    };
  });
}

async function ensureGuideVisible(page) {
  if (await page.locator("#scenarioGuidePopover").isHidden()) {
    if (await page.locator("#sidebarDrawerBackdrop").isVisible()) {
      await page.keyboard.press("Escape");
      await expect(page.locator("#sidebarDrawerBackdrop")).toBeHidden();
      await expect(page.locator("body")).not.toHaveClass(/(?:left|right)-drawer-open/);
    }
    await page.locator("#scenarioGuideBtn").click();
  }
  await expect(page.locator("#scenarioGuidePopover")).toBeVisible({ timeout: 30000 });
}

test("@golden-demo cancelling a dirty sample switch preserves the active scenario and link", async ({ page }) => {
  await gotoApp(page, "/app/?sample=modern-world-japan-corridor&view=guide", { waitUntil: "domcontentloaded" });
  await waitForShellReady(page, { timeout: 120000, requireCanvas: true });
  await expect(page.locator("#scenarioGuidePopover")).toBeVisible({ timeout: 30000 });

  await waitForProjectImportCompletion(page, {
    initialImportStartCount: 0,
    initialImportApplyCount: 0,
    expectedFileName: "modern-world-japan-corridor.project.json",
  }, { timeout: 120000 });
  await expect.poll(() => readSampleDeeplinkState(page), { timeout: 30000 }).toMatchObject({
    activeScenarioId: "modern_world",
    status: "success",
    sampleId: "modern-world-japan-corridor",
    scenarioId: "modern_world",
  });
  await page.evaluate(async () => {
    const { markDirty } = await import("/js/core/dirty_state.js");
    markDirty("playwright-sample-switch-cancel");
  });
  await ensureGuideVisible(page);
  await page.locator("[data-sample-guide-choice='tno-1962-atlantropa-briefing']").click();
  const dirtyDialog = page.locator("[data-app-dialog-overlay='true']");
  await expect(dirtyDialog).toBeVisible({ timeout: 30000 });
  await dirtyDialog.locator("[data-dialog-cancel='true']").click();
  await expect(dirtyDialog).toBeHidden({ timeout: 30000 });
  await expect.poll(() => readSampleDeeplinkState(page), { timeout: 30000 }).toMatchObject({
    activeScenarioId: "modern_world",
    status: "success",
    sampleId: "modern-world-japan-corridor",
    scenarioId: "modern_world",
  });
  await expect(page).toHaveURL(/sample=modern-world-japan-corridor/);
});
