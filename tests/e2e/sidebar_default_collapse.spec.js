const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { getAppUrl } = require("./support/playwright-app");

function resolveBaseUrl() {
  return getAppUrl();
}

async function waitForProjectUiReady(page) {
  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    const scenarioSelect = document.querySelector("#scenarioSelect");
    return typeof state.renderCountryListFn === "function"
      && !!scenarioSelect
      && !!scenarioSelect.querySelector('option[value="tno_1962"]');
  }, { timeout: 120000 });
}

async function applyScenario(page, scenarioId) {
  await page.evaluate(async (expectedScenarioId) => {
    const select = document.querySelector("#scenarioSelect");
    if (select instanceof HTMLSelectElement) {
      select.value = expectedScenarioId;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const { applyScenarioById } = await import("/js/core/scenario_manager.js");
    await applyScenarioById(expectedScenarioId, {
      renderNow: true,
      markDirtyReason: "playwright-sidebar-collapse",
      showToastOnComplete: false,
    });
  }, scenarioId);
  await page.waitForFunction(async (expectedScenarioId) => {
    const { state } = await import("/js/core/state.js");
    return state.activeScenarioId === expectedScenarioId;
  }, scenarioId, { timeout: 120000 });
}

test("default sidebar sections stay collapsed until explicitly used", async ({ page }) => {
  test.setTimeout(120000);

  await page.goto(resolveBaseUrl(), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await waitForProjectUiReady(page);

  const initialShell = await page.evaluate(() => {
    const byId = (selector) => document.querySelector(selector);
    return {
      leftDrawerOpen: document.body.classList.contains("left-drawer-open"),
      rightDrawerOpen: document.body.classList.contains("right-drawer-open"),
      appearanceOpen: byId(".appearance-card")?.open ?? null,
      specialZoneOpen: byId("#specialZonePopover")?.open ?? null,
      palettePanelHidden: byId("#paletteLibraryPanel")?.classList.contains("hidden") ?? null,
      themeSelectVisible: (byId("#themeSelect")?.getClientRects?.().length || 0) > 0,
      paletteSourceTabsVisible: (byId("#paletteLibrarySources")?.getClientRects?.().length || 0) > 0,
    };
  });

  expect(initialShell.leftDrawerOpen).toBe(false);
  expect(initialShell.rightDrawerOpen).toBe(false);
  expect(initialShell.appearanceOpen).toBe(false);
  expect(initialShell.specialZoneOpen).toBe(false);
  expect(initialShell.palettePanelHidden).toBe(false);
  expect(initialShell.themeSelectVisible).toBe(false);
  expect(initialShell.paletteSourceTabsVisible).toBe(true);

  await page.evaluate(() => {
    document.querySelector("#paletteLibraryToggle")?.click();
  });
  await page.waitForFunction(() => {
    const panel = document.querySelector("#paletteLibraryPanel");
    const select = document.querySelector("#themeSelect");
    return panel && panel.classList.contains("hidden") && !!select && (select.getClientRects?.().length || 0) === 0;
  });

  await applyScenario(page, "tno_1962");
  await page.waitForFunction(() => !document.querySelector("#specialRegionInspectorSection")?.classList.contains("hidden"));

  const scenarioState = await page.evaluate(() => {
    const byId = (selector) => document.querySelector(selector);
    return {
      countryOpen: byId("#countryInspectorSection")?.open ?? null,
      territoriesOpen: byId("#selectedCountryActionsSection")?.open ?? null,
      waterOpen: byId("#waterInspectorSection")?.open ?? null,
      specialOpen: byId("#specialRegionInspectorSection")?.open ?? null,
      frontlineOpen: byId("#frontlineProjectSection")?.open ?? null,
    };
  });

  expect(scenarioState.countryOpen).toBe(false);
  expect(scenarioState.territoriesOpen).toBe(false);
  expect(scenarioState.waterOpen).toBe(false);
  expect(scenarioState.specialOpen).toBe(false);
  expect(scenarioState.frontlineOpen).toBe(false);

  await page.evaluate(() => {
    document.querySelector("#selectedCountryActionsSection")?.removeAttribute("open");
    document.querySelector("#countryList .country-select-main-btn")?.click();
  });
  await page.waitForFunction(() => document.querySelector("#selectedCountryActionsSection")?.open === true);

  await page.waitForFunction(() => !!document.querySelector("#waterRegionList .inspector-item-btn"));
  await page.evaluate(() => {
    document.querySelector("#waterInspectorSection")?.removeAttribute("open");
    document.querySelector("#waterRegionList .inspector-item-btn")?.click();
  });
  await page.waitForFunction(() => document.querySelector("#waterInspectorSection")?.open === true);

  await page.waitForFunction(() => !!document.querySelector("#specialRegionList .inspector-item-btn"));
  await page.evaluate(() => {
    document.querySelector("#specialRegionInspectorSection")?.removeAttribute("open");
    document.querySelector("#specialRegionList .inspector-item-btn")?.click();
  });
  await page.waitForFunction(() => document.querySelector("#specialRegionInspectorSection")?.open === true);
});
