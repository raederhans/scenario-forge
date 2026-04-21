const { test, expect } = require("@playwright/test");
const {
  gotoApp,
  openProjectFrontlineSection,
  primeStateRef,
  waitForAppInteractive,
} = require("./support/playwright-app");

test("strategic overlay shell keeps command bar, focus return, and counter placement recovery", async ({ page }) => {
  test.setTimeout(90_000);

  await gotoApp(page, undefined, { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page, { timeout: 90_000 });
  await primeStateRef(page);
  await openProjectFrontlineSection(page);

  const commandBar = page.locator("#strategicCommandBar");
  const detailToggle = page.locator("#unitCounterDetailToggleBtn");
  const placeButton = page.locator("#unitCounterPlaceBtn");

  await expect(commandBar).toBeVisible();
  await expect(placeButton).toBeEnabled();
  await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const { render, selectUnitCounterById } = await import("/js/core/map_renderer.js");
    state.unitCounters = [{
      id: "unit_sidebar_smoke_1",
      renderer: "game",
      sidc: "INF",
      symbolCode: "INF",
      nationTag: "GER",
      nationSource: "manual",
      presetId: "inf",
      iconId: "infantry",
      unitType: "INF",
      echelon: "corps",
      label: "Sidebar Smoke",
      organizationPct: 84,
      equipmentPct: 73,
      size: "medium",
      facing: 0,
      zIndex: 0,
      anchor: { lon: 12, lat: 48, featureId: "GER" },
    }];
    state.unitCountersDirty = true;
    selectUnitCounterById("unit_sidebar_smoke_1");
    state.updateStrategicOverlayUIFn?.();
    render();
  });
  await expect(detailToggle).toBeVisible();

  await detailToggle.click();
  await expect(page.locator("#unitCounterEditorModalOverlay")).toBeVisible();
  await page.locator("#unitCounterEditorModalCloseBtn").click();
  await expect(page.locator("#unitCounterEditorModalOverlay")).toBeHidden();
  await expect.poll(async () => page.evaluate(() => document.activeElement?.id || ""), {
    timeout: 4_000,
  }).toBe("unitCounterDetailToggleBtn");

  await placeButton.click();
  await page.waitForFunction(() => {
    const state = globalThis.__playwrightStateRef || null;
    return !!state?.unitCounterEditor?.active;
  }, { timeout: 4_000 });

  await page.evaluate(() => {
    const inspectorTab = document.querySelector("#inspectorSidebarTabInspector");
    if (inspectorTab instanceof HTMLElement) {
      inspectorTab.click();
    }
  });
  await expect.poll(async () => page.evaluate(() => {
    const state = globalThis.__playwrightStateRef || null;
    return {
      rightSidebarTab: String(state?.ui?.rightSidebarTab || ""),
      unitCounterActive: !!state?.unitCounterEditor?.active,
    };
  }), { timeout: 4_000 }).toEqual({
    rightSidebarTab: "inspector",
    unitCounterActive: false,
  });
  await expect(commandBar).toBeHidden();

  await openProjectFrontlineSection(page);
  await expect.poll(async () => page.evaluate(() => {
    const state = globalThis.__playwrightStateRef || null;
    return {
      rightSidebarTab: String(state?.ui?.rightSidebarTab || ""),
      unitCounterActive: !!state?.unitCounterEditor?.active,
    };
  }), { timeout: 4_000 }).toEqual({
    rightSidebarTab: "project",
    unitCounterActive: false,
  });
  await expect(commandBar).toBeVisible();
  await expect(placeButton).toBeEnabled();

  await placeButton.click();
  await expect.poll(async () => page.evaluate(() => {
    const state = globalThis.__playwrightStateRef || null;
    return !!state?.unitCounterEditor?.active;
  }), { timeout: 4_000 }).toBeTruthy();
  await page.keyboard.press("Escape");
  await expect.poll(async () => page.evaluate(() => {
    const state = globalThis.__playwrightStateRef || null;
    return !!state?.unitCounterEditor?.active;
  }), { timeout: 4_000 }).toBeFalsy();
  await expect(placeButton).toBeEnabled();
});
