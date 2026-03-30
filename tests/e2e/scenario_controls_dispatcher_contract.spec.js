const { test, expect } = require("@playwright/test");
const { getAppUrl } = require("./support/playwright-app");

test.setTimeout(90_000);

const APP_URL = getAppUrl();

async function waitForScenarioControlsReady(page) {
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const select = document.querySelector("#scenarioSelect");
    const applyButton = document.querySelector("#applyScenarioBtn");
    return !!select
      && !!applyButton
      && select.querySelectorAll("option").length > 0;
  }, { timeout: 60_000 });
  await expect.poll(async () => page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    return {
      activeScenarioId: String(state.activeScenarioId || ""),
      scenarioApplyInFlight: !!state.scenarioApplyInFlight,
    };
  }), { timeout: 45_000 }).toEqual({
    activeScenarioId: "tno_1962",
    scenarioApplyInFlight: false,
  });
  await expect.poll(async () => page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    return {
      startupReadonly: !!state.startupReadonly,
      startupReadonlyUnlockInFlight: !!state.startupReadonlyUnlockInFlight,
    };
  }), { timeout: 45_000 }).toEqual({
    startupReadonly: false,
    startupReadonlyUnlockInFlight: false,
  });
  await page.evaluate(() => {
    document.querySelector("#scenarioSelect")?.closest("details")?.setAttribute("open", "");
  });
  await expect(page.locator("#scenarioSelect")).toBeVisible();
}

test("scenario controls apply reset and exit stay on dispatcher-backed path", async ({ page }) => {
  await waitForScenarioControlsReady(page);

  await page.selectOption("#scenarioSelect", "hoi4_1939");
  await page.locator("#applyScenarioBtn").click();

  await expect.poll(async () => page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    return {
      activeScenarioId: String(state.activeScenarioId || ""),
      scenarioApplyInFlight: !!state.scenarioApplyInFlight,
    };
  }), { timeout: 45_000 }).toEqual({
    activeScenarioId: "hoi4_1939",
    scenarioApplyInFlight: false,
  });
  await expect(page.locator("#scenarioStatus")).toContainText("HOI4 1939");

  await page.locator("#resetScenarioBtn").click();
  await expect.poll(async () => page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    return {
      activeScenarioId: String(state.activeScenarioId || ""),
      scenarioApplyInFlight: !!state.scenarioApplyInFlight,
    };
  }), { timeout: 45_000 }).toEqual({
    activeScenarioId: "hoi4_1939",
    scenarioApplyInFlight: false,
  });

  await page.locator("#clearScenarioBtn").click();
  await expect.poll(async () => page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    return {
      activeScenarioId: String(state.activeScenarioId || ""),
      scenarioApplyInFlight: !!state.scenarioApplyInFlight,
    };
  }), { timeout: 45_000 }).toEqual({
    activeScenarioId: "",
    scenarioApplyInFlight: false,
  });
  await expect(page.locator("#scenarioStatus")).toContainText("No scenario active");
});

test("scenario controls switch ownership and frontline view modes through dispatcher", async ({ page }) => {
  await waitForScenarioControlsReady(page);

  const viewModeSelect = page.locator("#scenarioViewModeSelect");
  await expect(viewModeSelect).toBeVisible();
  await expect(viewModeSelect).toBeEnabled();

  await viewModeSelect.selectOption("frontline");
  await expect.poll(async () => page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    return String(state.scenarioViewMode || "");
  }), { timeout: 20_000 }).toBe("frontline");

  await viewModeSelect.selectOption("ownership");
  await expect.poll(async () => page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    return String(state.scenarioViewMode || "");
  }), { timeout: 20_000 }).toBe("ownership");
});
