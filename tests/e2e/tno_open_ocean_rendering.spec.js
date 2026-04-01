const { test, expect } = require("@playwright/test");
const { gotoApp, waitForAppInteractive } = require("./support/playwright-app");

async function waitForScenarioManagerIdle(page) {
  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    return !state.scenarioApplyInFlight
      && !state.startupReadonly
      && !state.startupReadonlyUnlockInFlight;
  });
}

async function applyScenario(page, scenarioId) {
  await waitForScenarioManagerIdle(page);
  await page.evaluate(async (expectedScenarioId) => {
    const { applyScenarioByIdCommand } = await import("/js/core/scenario_dispatcher.js");
    await applyScenarioByIdCommand(expectedScenarioId, {
      renderMode: "flush",
      markDirtyReason: "",
      showToastOnComplete: false,
    });
  }, scenarioId);
  await page.waitForFunction(async (expectedScenarioId) => {
    const { state } = await import("/js/core/state.js");
    return state.activeScenarioId === expectedScenarioId && !state.scenarioApplyInFlight;
  }, scenarioId);
}

async function setOpenOceanVisibility(page, visible) {
  await page.evaluate(async (nextVisible) => {
    const { state } = await import("/js/core/state.js");
    const { render } = await import("/js/core/map_renderer.js");
    state.showOpenOceanRegions = !!nextVisible;
    render();
  }, visible);
}

async function setWaterOverrideColor(page, featureId, color) {
  await page.evaluate(async ({ targetFeatureId, nextColor }) => {
    const { state } = await import("/js/core/state.js");
    const { render } = await import("/js/core/map_renderer.js");
    state.waterRegionOverrides = {
      ...(state.waterRegionOverrides || {}),
    };
    if (nextColor) {
      state.waterRegionOverrides[targetFeatureId] = nextColor;
      render();
    } else {
      delete state.waterRegionOverrides[targetFeatureId];
      render();
    }
  }, {
    targetFeatureId: featureId,
    nextColor: color,
  });
}

async function readOpenOceanRuntime(page, featureId) {
  return page.evaluate(async (targetFeatureId) => {
    const { state } = await import("/js/core/state.js");
    const items = Array.isArray(state.waterSpatialItems)
      ? state.waterSpatialItems.filter((item) => String(item?.featureId || "") === targetFeatureId)
      : [];
    return {
      featureVisible: !!state.showOpenOceanRegions,
      itemCount: items.length,
      itemBounds: items.map((item) => ({
        minX: item.minX,
        minY: item.minY,
        maxX: item.maxX,
        maxY: item.maxY,
        bboxArea: item.bboxArea,
      })),
    };
  }, featureId);
}

async function measureFeaturePatchDiff(page, featureId, color) {
  return page.evaluate(async ({ targetFeatureId, nextColor }) => {
    const { state } = await import("/js/core/state.js");
    const { render } = await import("/js/core/map_renderer.js");
    const items = Array.isArray(state.waterSpatialItems)
      ? state.waterSpatialItems
        .filter((item) => String(item?.featureId || "") === targetFeatureId)
        .sort((left, right) => Number(right?.bboxArea || 0) - Number(left?.bboxArea || 0))
      : [];
    const targetItem = items[0];
    const canvas = document.getElementById("map-canvas");
    const context = canvas instanceof HTMLCanvasElement
      ? canvas.getContext("2d", { willReadFrequently: true })
      : null;
    if (!targetItem || !canvas || !context) {
      return null;
    }
    const minX = Math.max(0, Math.min(canvas.width - 1, Math.floor(targetItem.minX)));
    const minY = Math.max(0, Math.min(canvas.height - 1, Math.floor(targetItem.minY)));
    const maxX = Math.max(minX + 1, Math.min(canvas.width, Math.ceil(targetItem.maxX)));
    const maxY = Math.max(minY + 1, Math.min(canvas.height, Math.ceil(targetItem.maxY)));
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const before = context.getImageData(minX, minY, width, height).data;
    state.waterRegionOverrides = {
      ...(state.waterRegionOverrides || {}),
      [targetFeatureId]: nextColor,
    };
    render();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const after = context.getImageData(minX, minY, width, height).data;
    let changedPixelCount = 0;
    let changedChannelSum = 0;
    for (let index = 0; index < before.length; index += 4) {
      const diff =
        Math.abs(before[index] - after[index])
        + Math.abs(before[index + 1] - after[index + 1])
        + Math.abs(before[index + 2] - after[index + 2]);
      if (diff >= 24) {
        changedPixelCount += 1;
        changedChannelSum += diff / 3;
      }
    }
    return {
      width,
      height,
      changedPixelCount,
      meanChangedChannelDiff: changedPixelCount ? changedChannelSum / changedPixelCount : 0,
    };
  }, {
    targetFeatureId: featureId,
    nextColor: color,
  });
}

test("tno open ocean override is visibly rendered and indexed by polygon part", async ({ page }) => {
  test.setTimeout(120000);

  const targetFeatureId = "tno_northwest_pacific_ocean";

  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);
  await applyScenario(page, "tno_1962");

  await setOpenOceanVisibility(page, true);
  await page.waitForFunction(async (expectedFeatureId) => {
    const { state } = await import("/js/core/state.js");
    return !!state.showOpenOceanRegions
      && Array.isArray(state.waterSpatialItems)
      && state.waterSpatialItems.some((item) => String(item?.featureId || "") === expectedFeatureId);
  }, targetFeatureId);

  const runtimeBefore = await readOpenOceanRuntime(page, targetFeatureId);
  expect(runtimeBefore.featureVisible).toBe(true);
  expect(runtimeBefore.itemCount).toBeGreaterThan(1);

  const diffStats = await measureFeaturePatchDiff(page, targetFeatureId, "#ff00ff");
  expect(diffStats).not.toBeNull();
  expect(diffStats.changedPixelCount).toBeGreaterThan(250);
  expect(diffStats.meanChangedChannelDiff).toBeGreaterThan(30);

  await setWaterOverrideColor(page, targetFeatureId, "");
});
