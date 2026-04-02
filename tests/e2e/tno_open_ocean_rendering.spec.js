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
    const {
      invalidateOceanWaterInteractionVisualState,
      render,
    } = await import("/js/core/map_renderer.js");
    state.showOpenOceanRegions = !!nextVisible;
    invalidateOceanWaterInteractionVisualState("test-open-ocean-toggle");
    render();
  }, visible);
}

async function setWaterOverrideColor(page, featureId, color) {
  await page.evaluate(async ({ targetFeatureId, nextColor }) => {
    const { state } = await import("/js/core/state.js");
    const { refreshColorState } = await import("/js/core/map_renderer.js");
    state.waterRegionOverrides = {
      ...(state.waterRegionOverrides || {}),
    };
    if (nextColor) {
      state.waterRegionOverrides[targetFeatureId] = nextColor;
    } else {
      delete state.waterRegionOverrides[targetFeatureId];
    }
    refreshColorState({ renderNow: true });
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
      featureInteractive: !!state.showOpenOceanRegions,
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

async function sampleFeaturePatchStats(page, featureId) {
  return page.evaluate(async (targetFeatureId) => {
    const { state } = await import("/js/core/state.js");
    const items = Array.isArray(state.waterSpatialItems)
      ? state.waterSpatialItems
        .filter((item) => String(item?.featureId || "") === targetFeatureId)
        .sort((left, right) => Number(right?.bboxArea || 0) - Number(left?.bboxArea || 0))
      : [];
    const canvas = document.getElementById("map-canvas");
    const context = canvas instanceof HTMLCanvasElement
      ? canvas.getContext("2d", { willReadFrequently: true })
      : null;
    const transform = state.zoomTransform || { x: 0, y: 0, k: 1 };
    const dpr = Number(state.dpr || globalThis.devicePixelRatio || 1);
    if (!items.length || !canvas || !context) {
      return null;
    }
    const sampleBoxes = items
      .slice(0, 3)
      .map((item) => {
        const minX = Math.max(
          0,
          Math.min(
            canvas.width - 1,
            Math.floor(((item.minX * transform.k) + transform.x) * dpr)
          )
        );
        const minY = Math.max(
          0,
          Math.min(
            canvas.height - 1,
            Math.floor(((item.minY * transform.k) + transform.y) * dpr)
          )
        );
        const maxX = Math.max(
          minX + 1,
          Math.min(
            canvas.width,
            Math.ceil(((item.maxX * transform.k) + transform.x) * dpr)
          )
        );
        const maxY = Math.max(
          minY + 1,
          Math.min(
            canvas.height,
            Math.ceil(((item.maxY * transform.k) + transform.y) * dpr)
          )
        );
        const width = Math.max(1, maxX - minX);
        const height = Math.max(1, maxY - minY);
        if (!(width > 0) || !(height > 0)) return null;
        return { minX, minY, width, height };
      })
      .filter(Boolean);
    if (!sampleBoxes.length) {
      return null;
    }
    let pixelCount = 0;
    let red = 0;
    let green = 0;
    let blue = 0;
    sampleBoxes.forEach((box) => {
      const data = context.getImageData(box.minX, box.minY, box.width, box.height).data;
      for (let index = 0; index < data.length; index += 4) {
        red += data[index];
        green += data[index + 1];
        blue += data[index + 2];
        pixelCount += 1;
      }
    });
    if (!pixelCount) {
      return null;
    }
    return {
      sampledBoxes: sampleBoxes.length,
      avgRed: red / pixelCount,
      avgGreen: green / pixelCount,
      avgBlue: blue / pixelCount,
    };
  }, featureId);
}

async function measureFeaturePatchDiff(page, featureId, color) {
  return page.evaluate(async ({ targetFeatureId, nextColor }) => {
    const { state } = await import("/js/core/state.js");
    const { refreshColorState } = await import("/js/core/map_renderer.js");
    const items = Array.isArray(state.waterSpatialItems)
      ? state.waterSpatialItems
        .filter((item) => String(item?.featureId || "") === targetFeatureId)
        .sort((left, right) => Number(right?.bboxArea || 0) - Number(left?.bboxArea || 0))
      : [];
    const canvas = document.getElementById("map-canvas");
    const context = canvas instanceof HTMLCanvasElement
      ? canvas.getContext("2d", { willReadFrequently: true })
      : null;
    const transform = state.zoomTransform || { x: 0, y: 0, k: 1 };
    const dpr = Number(state.dpr || globalThis.devicePixelRatio || 1);
    if (!items.length || !canvas || !context) {
      return null;
    }
    const sampleBoxes = items
      .map((item) => {
        const minX = Math.max(
          0,
          Math.min(
            canvas.width - 1,
            Math.floor(((item.minX * transform.k) + transform.x) * dpr)
          )
        );
        const minY = Math.max(
          0,
          Math.min(
            canvas.height - 1,
            Math.floor(((item.minY * transform.k) + transform.y) * dpr)
          )
        );
        const maxX = Math.max(
          minX + 1,
          Math.min(
            canvas.width,
            Math.ceil(((item.maxX * transform.k) + transform.x) * dpr)
          )
        );
        const maxY = Math.max(
          minY + 1,
          Math.min(
            canvas.height,
            Math.ceil(((item.maxY * transform.k) + transform.y) * dpr)
          )
        );
        const width = Math.max(1, maxX - minX);
        const height = Math.max(1, maxY - minY);
        if (!(width > 0) || !(height > 0)) return null;
        return { minX, minY, width, height };
      })
      .filter(Boolean);
    if (!sampleBoxes.length) {
      return null;
    }
    const before = sampleBoxes.map((box) => context.getImageData(box.minX, box.minY, box.width, box.height).data);
    state.waterRegionOverrides = {
      ...(state.waterRegionOverrides || {}),
      [targetFeatureId]: nextColor,
    };
    refreshColorState({ renderNow: true });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    let changedPixelCount = 0;
    let changedChannelSum = 0;
    sampleBoxes.forEach((box, boxIndex) => {
      const after = context.getImageData(box.minX, box.minY, box.width, box.height).data;
      const beforeData = before[boxIndex];
      for (let index = 0; index < beforeData.length; index += 4) {
        const diff =
          Math.abs(beforeData[index] - after[index])
          + Math.abs(beforeData[index + 1] - after[index + 1])
          + Math.abs(beforeData[index + 2] - after[index + 2]);
        if (diff >= 24) {
          changedPixelCount += 1;
          changedChannelSum += diff / 3;
        }
      }
    });
    return {
      sampledBoxes: sampleBoxes.length,
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

  await page.waitForFunction(async (expectedFeatureId) => {
    const { state } = await import("/js/core/state.js");
    return Array.isArray(state.waterSpatialItems)
      && state.waterSpatialItems.some((item) => String(item?.featureId || "") === expectedFeatureId);
  }, targetFeatureId);

  const runtimeBefore = await readOpenOceanRuntime(page, targetFeatureId);
  expect(runtimeBefore.featureInteractive).toBe(false);
  expect(runtimeBefore.itemCount).toBeGreaterThan(1);
  const patchBefore = await sampleFeaturePatchStats(page, targetFeatureId);
  expect(patchBefore).not.toBeNull();
  expect(patchBefore.avgBlue).toBeGreaterThan(patchBefore.avgRed + 10);
  expect(patchBefore.avgBlue).toBeGreaterThan(patchBefore.avgGreen + 5);

  const diffWhileInteractionOff = await measureFeaturePatchDiff(page, targetFeatureId, "#ff00ff");
  expect(diffWhileInteractionOff).not.toBeNull();
  expect(diffWhileInteractionOff.changedPixelCount).toBeLessThan(160);
  expect(diffWhileInteractionOff.meanChangedChannelDiff).toBeLessThan(18);

  await setOpenOceanVisibility(page, true);
  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    return !!state.showOpenOceanRegions;
  });
  const runtimeInteractiveOn = await readOpenOceanRuntime(page, targetFeatureId);
  expect(runtimeInteractiveOn.featureInteractive).toBe(true);
  const diffWhileInteractionOn = await measureFeaturePatchDiff(page, targetFeatureId, "#00d4ff");
  expect(diffWhileInteractionOn).not.toBeNull();
  expect(diffWhileInteractionOn.changedPixelCount).toBeGreaterThan(80);
  expect(diffWhileInteractionOn.meanChangedChannelDiff).toBeGreaterThan(20);

  await setOpenOceanVisibility(page, false);
  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    return !state.showOpenOceanRegions;
  });
  const runtimeAfterToggleOff = await readOpenOceanRuntime(page, targetFeatureId);
  expect(runtimeAfterToggleOff.featureInteractive).toBe(false);
  const patchAfterToggleOff = await sampleFeaturePatchStats(page, targetFeatureId);
  expect(patchAfterToggleOff).not.toBeNull();
  expect(patchAfterToggleOff.avgBlue).toBeGreaterThan(patchAfterToggleOff.avgRed + 10);
  expect(patchAfterToggleOff.avgBlue).toBeGreaterThan(patchAfterToggleOff.avgGreen + 5);
  expect(Math.abs(patchAfterToggleOff.avgBlue - patchBefore.avgBlue)).toBeLessThan(30);
  const diffAfterToggleOff = await measureFeaturePatchDiff(page, targetFeatureId, "#ff8800");
  expect(diffAfterToggleOff).not.toBeNull();
  expect(diffAfterToggleOff.changedPixelCount).toBeLessThan(diffWhileInteractionOn.changedPixelCount * 0.25);
  expect(diffAfterToggleOff.meanChangedChannelDiff).toBeLessThan(diffWhileInteractionOn.meanChangedChannelDiff * 0.75);

  await setWaterOverrideColor(page, targetFeatureId, "");
});
