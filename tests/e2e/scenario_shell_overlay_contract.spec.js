const { test, expect } = require("@playwright/test");
const { gotoApp, waitForAppInteractive } = require("./support/playwright-app");

async function waitForScenarioUiReady(page) {
  await page.waitForFunction(() => {
    const select = document.querySelector("#scenarioSelect");
    return !!select
      && !!select.querySelector('option[value="tno_1962"]');
  });
}

async function waitForScenarioManagerIdle(page) {
  await waitForAppInteractive(page, { timeout: 120_000 });
}

async function applyScenario(page, scenarioId) {
  await waitForScenarioManagerIdle(page);
  await page.evaluate(async (expectedScenarioId) => {
    const { applyScenarioByIdCommand } = await import("/js/core/scenario_dispatcher.js");
    await applyScenarioByIdCommand(expectedScenarioId, {
      renderMode: "request",
      markDirtyReason: "",
      showToastOnComplete: false,
    });
  }, scenarioId);
  await expect.poll(async () => page.evaluate(async (expectedScenarioId) => {
    const { state } = await import("/js/core/state.js");
    return state.activeScenarioId === expectedScenarioId && !state.scenarioApplyInFlight;
  }, scenarioId)).toBe(true);
}

async function resetScenario(page) {
  await waitForScenarioManagerIdle(page);
  await page.evaluate(async () => {
    const { resetScenarioToBaselineCommand } = await import("/js/core/scenario_dispatcher.js");
    resetScenarioToBaselineCommand({
      renderMode: "flush",
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
  })).toBe(true);
}

async function clearScenario(page) {
  await waitForScenarioManagerIdle(page);
  await page.evaluate(async () => {
    const { clearActiveScenarioCommand } = await import("/js/core/scenario_dispatcher.js");
    clearActiveScenarioCommand({
      renderMode: "flush",
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
  })).toBe(true);
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

test("scenario shell overlay recalculates on apply reset and clear", async ({ page }) => {
  test.setTimeout(120000);

  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);
  await waitForScenarioUiReady(page);

  await applyScenario(page, "hoi4_1939");
  await applyScenario(page, "tno_1962");
  await expect.poll(async () => {
    const shell = await readShellState(page);
    return {
      activeScenarioId: shell.activeScenarioId,
      hasRuPolar: !!shell.ruPolarId,
      hasOwnerMap: shell.ownerCount > 0,
      hasControllerMap: shell.controllerCount > 0,
      hasRuPolarOwner: !!shell.ruPolarOwner,
      hasRuPolarController: !!shell.ruPolarController,
    };
  }).toEqual({
    activeScenarioId: "tno_1962",
    hasRuPolar: true,
    hasOwnerMap: true,
    hasControllerMap: true,
    hasRuPolarOwner: true,
    hasRuPolarController: true,
  });

  const afterApply = await readShellState(page);

  await resetScenario(page);
  await expect.poll(async () => {
    const shell = await readShellState(page);
    return {
      activeScenarioId: shell.activeScenarioId,
      hasOwnerMap: shell.ownerCount > 0,
      hasControllerMap: shell.controllerCount > 0,
      hasRuPolarOwner: !!shell.ruPolarOwner,
      hasRuPolarController: !!shell.ruPolarController,
    };
  }).toEqual({
    activeScenarioId: "tno_1962",
    hasOwnerMap: true,
    hasControllerMap: true,
    hasRuPolarOwner: true,
    hasRuPolarController: true,
  });

  const afterReset = await readShellState(page);
  expect(afterReset.ruPolarId).toBe(afterApply.ruPolarId);
  expect(afterReset.ruPolarOwner).toBe(afterApply.ruPolarOwner);
  expect(afterReset.ruPolarController).toBe(afterApply.ruPolarController);

  await clearScenario(page);
  await expect.poll(async () => {
    const shell = await readShellState(page);
    return {
      activeScenarioId: shell.activeScenarioId,
      borderMode: shell.borderMode,
      ownerCount: shell.ownerCount,
      controllerCount: shell.controllerCount,
    };
  }).toEqual({
    activeScenarioId: "",
    borderMode: "canonical",
    ownerCount: 0,
    controllerCount: 0,
  });

  const afterClear = await readShellState(page);
  expect(afterClear.shellRevision).toBeGreaterThan(afterApply.shellRevision);

  await applyScenario(page, "tno_1962");
  const afterReapply = await readShellState(page);
  expect(afterReapply.shellRevision).toBeGreaterThan(afterClear.shellRevision);
  expect(afterReapply.ruPolarId).toBe(afterApply.ruPolarId);
  expect(afterReapply.ruPolarOwner).toBe(afterApply.ruPolarOwner);
  expect(afterReapply.ruPolarController).toBe(afterApply.ruPolarController);
});
