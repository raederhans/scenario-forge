const { test, expect } = require("@playwright/test");
const { applyScenarioAndWaitIdle, gotoApp, waitForAppInteractive } = require("./support/playwright-app");

const SHELL_STARTUP_PATH = "/?render_profile=balanced&startup_interaction=full&startup_worker=0&startup_cache=1&default_scenario=tno_1962";

async function waitForScenarioUiReady(page) {
  await page.waitForFunction(() => {
    const select = document.querySelector("#scenarioSelect");
    return !!select
      && !!select.querySelector('option[value="tno_1962"]');
  });
}

async function applyScenario(page, scenarioId) {
  const expectedScenarioId = String(scenarioId || "").trim();
  await applyScenarioAndWaitIdle(page, expectedScenarioId, {
    timeout: 120_000,
    renderMode: "none",
    markDirtyReason: "",
    showToastOnComplete: false,
    forceApply: true,
  });
}

async function resetScenario(page) {
  await page.evaluate(async () => {
    const { resetScenarioToBaselineCommand } = await import("/js/core/scenario_dispatcher.js");
    resetScenarioToBaselineCommand({
      renderMode: "none",
      markDirtyReason: "",
      showToastOnComplete: false,
    });
  });
  await expect.poll(async () => page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    return !state.scenarioApplyInFlight
      && !state.startupReadonly
      && !state.startupReadonlyUnlockInFlight
      && state.bootBlocking === false;
  }), { timeout: 30_000 }).toBe(true);
}

async function clearScenario(page) {
  await page.evaluate(async () => {
    const { clearActiveScenarioCommand } = await import("/js/core/scenario_dispatcher.js");
    clearActiveScenarioCommand({
      renderMode: "none",
      markDirtyReason: "",
      showToastOnComplete: false,
    });
  });
  await expect.poll(async () => page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    return !state.activeScenarioId
      && !state.scenarioApplyInFlight
      && !state.startupReadonly
      && !state.startupReadonlyUnlockInFlight
      && state.bootBlocking === false;
  }), { timeout: 30_000 }).toBe(true);
}

async function readShellState(page) {
  return page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const shellIds = Array.from(new Set([
      ...Object.keys(state.scenarioAutoShellOwnerByFeatureId || {}),
      ...Object.keys(state.scenarioAutoShellControllerByFeatureId || {}),
    ]));
    const ruPolarId = shellIds.find((id) => id.startsWith("RU_ARCTIC_FB_")) || "";
    return {
      activeScenarioId: String(state.activeScenarioId || ""),
      borderMode: String(state.scenarioBorderMode || ""),
      shellRevision: Number(state.scenarioShellOverlayRevision || 0),
      ruPolarId,
      ruPolarOwner: String(state.scenarioAutoShellOwnerByFeatureId?.[ruPolarId] || ""),
      ruPolarController: String(state.scenarioAutoShellControllerByFeatureId?.[ruPolarId] || ""),
      ownerCount: Object.keys(state.scenarioAutoShellOwnerByFeatureId || {}).length,
      controllerCount: Object.keys(state.scenarioAutoShellControllerByFeatureId || {}).length,
    };
  });
}

async function readPostBootstrapUiSnapshot(page) {
  return page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const scenarioSelect = document.querySelector("#scenarioSelect");
    const themeSelect = document.querySelector("#themeSelect");
    const countryRows = document.querySelectorAll("#countryList .country-select-main-btn").length;
    const specialRegionRows = document.querySelectorAll("#specialRegionList .inspector-item-btn").length;
    return {
      activeScenarioId: String(state.activeScenarioId || ""),
      activePaletteId: String(state.activePaletteId || ""),
      scenarioSelectValue: String(scenarioSelect?.value || ""),
      hasScenarioOption: !!scenarioSelect?.querySelector('option[value="tno_1962"]'),
      paletteSourceValue: String(themeSelect?.value || ""),
      countryRows,
      specialRegionRows,
      specialRegionFeatureCount: Number(state.specialRegionsById?.size || 0),
    };
  });
}

test("scenario shell overlay recalculates on apply reset and clear", async ({ page }) => {
  test.setTimeout(360000);

  await gotoApp(page, SHELL_STARTUP_PATH, { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);
  await waitForScenarioUiReady(page);
  await applyScenario(page, "tno_1962");

  const afterApply = await readShellState(page);
  expect({
    activeScenarioId: afterApply.activeScenarioId,
    hasRuPolar: !!afterApply.ruPolarId,
    hasOwnerMap: afterApply.ownerCount > 0,
    hasControllerMap: afterApply.controllerCount > 0,
    hasRuPolarOwner: !!afterApply.ruPolarOwner,
    hasRuPolarController: !!afterApply.ruPolarController,
  }).toEqual({
    activeScenarioId: "tno_1962",
    hasRuPolar: true,
    hasOwnerMap: true,
    hasControllerMap: true,
    hasRuPolarOwner: true,
    hasRuPolarController: true,
  });

  await resetScenario(page);
  const afterReset = await readShellState(page);
  expect({
    activeScenarioId: afterReset.activeScenarioId,
    hasOwnerMap: afterReset.ownerCount > 0,
    hasControllerMap: afterReset.controllerCount > 0,
    hasRuPolarOwner: !!afterReset.ruPolarOwner,
    hasRuPolarController: !!afterReset.ruPolarController,
  }).toEqual({
    activeScenarioId: "tno_1962",
    hasOwnerMap: true,
    hasControllerMap: true,
    hasRuPolarOwner: true,
    hasRuPolarController: true,
  });
  expect(afterReset.ruPolarId).toBe(afterApply.ruPolarId);
  expect(afterReset.ruPolarOwner).toBe(afterApply.ruPolarOwner);
  expect(afterReset.ruPolarController).toBe(afterApply.ruPolarController);

  await clearScenario(page);
  const afterClear = await readShellState(page);
  expect({
    activeScenarioId: afterClear.activeScenarioId,
    borderMode: afterClear.borderMode,
    ownerCount: afterClear.ownerCount,
    controllerCount: afterClear.controllerCount,
  }).toEqual({
    activeScenarioId: "",
    borderMode: "canonical",
    ownerCount: 0,
    controllerCount: 0,
  });
  expect(afterClear.shellRevision).toBeGreaterThan(afterApply.shellRevision);

  await applyScenario(page, "tno_1962");
  const afterReapply = await readShellState(page);
  expect(afterReapply.shellRevision).toBeGreaterThan(afterClear.shellRevision);
  expect(afterReapply.ruPolarId).toBe(afterApply.ruPolarId);
  expect(afterReapply.ruPolarOwner).toBe(afterApply.ruPolarOwner);
  expect(afterReapply.ruPolarController).toBe(afterApply.ruPolarController);
});

test("delayed ui bootstrap keeps scenario sidebar palette and special region inspector in sync", async ({ page }) => {
  test.setTimeout(360000);

  await page.route(/\/js\/ui\/(toolbar|sidebar|scenario_controls|shortcuts)\.js$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 900));
    await route.continue();
  });

  await gotoApp(page, SHELL_STARTUP_PATH, { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page, { timeout: 120_000 });
  await waitForScenarioUiReady(page);

  const snapshot = await readPostBootstrapUiSnapshot(page);
  expect(snapshot.activeScenarioId).toBe("tno_1962");
  expect(snapshot.scenarioSelectValue).toBe("tno_1962");
  expect(snapshot.hasScenarioOption).toBe(true);
  expect(snapshot.countryRows).toBeGreaterThan(0);
  expect(snapshot.paletteSourceValue).toBe(snapshot.activePaletteId);
  expect(snapshot.paletteSourceValue).not.toBe("");
  if (snapshot.specialRegionFeatureCount > 0) {
    expect(snapshot.specialRegionRows).toBeGreaterThan(0);
  }
});
