const { test, expect } = require("@playwright/test");
const { gotoApp, waitForAppInteractive, waitForRenderIdle } = require("./support/playwright-app");

async function waitForScenarioManagerIdle(page) {
  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    return !state.scenarioApplyInFlight && !state.startupReadonly && !state.startupReadonlyUnlockInFlight;
  }, { timeout: 120000 });
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
  await page.waitForFunction(async (expectedScenarioId) => {
    const { state } = await import("/js/core/state.js");
    return state.activeScenarioId === expectedScenarioId && !state.scenarioApplyInFlight;
  }, scenarioId, { timeout: 120000 });
}

async function clickWaterRegionByName(page, targetName) {
  await page.evaluate((expectedName) => {
    const rows = Array.from(document.querySelectorAll("#waterRegionList .inspector-item-btn"));
    const row = rows.find((node) => node.textContent?.includes(expectedName));
    if (!row) {
      throw new Error(`Missing water region row: ${expectedName}`);
    }
    row.click();
  }, targetName);
}

async function ensureWaterInspectorOpen(page) {
  if (await page.locator("#editorObjects-water").count()) {
    await page.locator("#editorTaskObjectsBtn").click();
    await page.locator("#editorObjects-water").click();
  }
  await page.evaluate(() => {
    document.querySelector("#waterInspectorSection")?.setAttribute("open", "");
  });
  await expect(page.locator("#waterRegionSearch")).toBeVisible();
}

async function selectWaterRegion(page, searchValue, targetName) {
  await ensureWaterInspectorOpen(page);
  await page.fill("#waterRegionSearch", searchValue);
  await page.waitForFunction((expectedName) => {
    return Array.from(document.querySelectorAll("#waterRegionList .inspector-item-btn .country-row-title"))
      .some((node) => node.textContent?.includes(expectedName));
  }, targetName, { timeout: 30000 });
  await clickWaterRegionByName(page, targetName);
  await expect.poll(() => page.evaluate(() => {
    const activeTitle = document.querySelector("#waterRegionList .inspector-item-btn.is-active .country-row-title");
    return activeTitle?.textContent || "";
  })).toContain(targetName);
}

async function readWaterInspectorMeta(page) {
  return page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll("#waterInspectorMetaList > div"))
      .map((node) => node.textContent?.trim() || "");
    const meta = {};
    for (let index = 0; index < cells.length; index += 2) {
      meta[cells[index]] = cells[index + 1] || "";
    }
    return meta;
  });
}

function normalizeMetaValue(value) {
  return String(value || "").trim().toLowerCase();
}

test("named waters remain selectable when open-ocean selection is disabled", async ({ page }) => {
  test.setTimeout(120000);
  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);
  await applyScenario(page, "tno_1962");

  await page.waitForFunction(() => !!document.querySelector("#waterRegionList .inspector-item-btn"));
  await ensureWaterInspectorOpen(page);

  const selectionState = await page.evaluate(() => ({
    openOceanVisible: Array.from(document.querySelectorAll("#waterRegionList .inspector-item-btn")).some((node) => node.textContent?.includes("Northeast Atlantic Ocean")),
    namedWaterVisible: Array.from(document.querySelectorAll("#waterRegionList .inspector-item-btn")).some((node) => node.textContent?.includes("North Sea")),
  }));

  expect(selectionState.openOceanVisible).toBe(false);
  expect(selectionState.namedWaterVisible).toBe(true);

  await selectWaterRegion(page, "North Sea", "North Sea");
  const meta = await readWaterInspectorMeta(page);
  expect(meta.ID).toBe("tno_north_sea");
  expect(normalizeMetaValue(meta.Type)).toBe("sea");
  expect(normalizeMetaValue(meta.Group)).toBe("marine macro");
  expect(meta.Source).not.toBe("");
});

