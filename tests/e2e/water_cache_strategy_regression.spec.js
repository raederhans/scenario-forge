const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { gotoApp, waitForAppInteractive } = require("./support/playwright-app");

test.setTimeout(120_000);

const WATER_CACHE_MODES = ["adaptive", "reuse", "direct"];
const FAST_STARTUP_BASE_PATH = "/?render_profile=balanced&startup_interaction=readonly&startup_worker=1&startup_cache=1";
const TARGET_SCENARIO_ID = "tno_1962";
const TARGET_SCENARIO_LABEL = "TNO 1962";
const TARGET_WATER_NAME = "North Sea";
const TARGET_WATER_ID = "tno_north_sea";
const MAX_EXACT_REFRESH_DELTA = 200;

function getPathForWaterCacheMode(mode) {
  return `${FAST_STARTUP_BASE_PATH}&water_cache_mode=${encodeURIComponent(mode)}`;
}

async function waitForScenarioManagerIdle(page) {
  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    return !state.scenarioApplyInFlight
      && !state.startupReadonly
      && !state.startupReadonlyUnlockInFlight;
  }, { timeout: 120_000 });
}

async function waitForStableExactRender(page, { timeout = 30_000 } = {}) {
  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    return String(state.renderPhase || "") === "idle"
      && !state.deferExactAfterSettle
      && !state.exactAfterSettleHandle;
  }, { timeout });
}

async function ensureScenario(page, scenarioId, label) {
  await page.waitForFunction((expectedScenarioId) => {
    const select = document.querySelector("#scenarioSelect");
    return !!select && !!select.querySelector(`option[value="${expectedScenarioId}"]`);
  }, scenarioId, { timeout: 120_000 });

  const currentScenarioId = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    return String(state.activeScenarioId || "");
  });

  if (currentScenarioId !== scenarioId) {
    await page.selectOption("#scenarioSelect", scenarioId);
    const applyButton = page.locator("#applyScenarioBtn");
    if (await applyButton.isVisible().catch(() => false)) {
      if (await applyButton.isEnabled().catch(() => false)) {
        await applyButton.click();
      }
    }
  }

  await expect(page.locator("#scenarioStatus")).toContainText(label, { timeout: 20_000 });
  await page.waitForTimeout(800);
}

async function ensureWaterInspectorOpen(page) {
  await page.evaluate(() => {
    document.querySelector("#waterInspectorSection")?.setAttribute("open", "");
  });
  await expect(page.locator("#waterRegionSearch")).toBeVisible();
}

async function dragMap(page, { dx = 180, dy = 28, steps = 8 } = {}) {
  const box = await page.locator("#mapContainer").boundingBox();
  if (!box) {
    throw new Error("mapContainer bounding box unavailable");
  }
  const startX = box.x + (box.width * 0.55);
  const startY = box.y + (box.height * 0.45);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dx, startY + dy, { steps });
  await page.mouse.up();
  await page.waitForTimeout(700);
}

async function zoomMap(page, percent) {
  await page.evaluate(async (targetPercent) => {
    const { setZoomPercent } = await import("/js/core/map_renderer.js");
    setZoomPercent(targetPercent);
  }, percent);
  await page.waitForTimeout(800);
}

async function selectWaterRegionByName(page, searchValue, expectedName) {
  await ensureWaterInspectorOpen(page);
  await page.fill("#waterRegionSearch", searchValue);
  await page.waitForFunction((targetName) => {
    return Array.from(document.querySelectorAll("#waterRegionList .inspector-item-btn .country-row-title"))
      .some((node) => node.textContent?.includes(targetName));
  }, expectedName, { timeout: 30_000 });

  await page.evaluate((targetName) => {
    const rows = Array.from(document.querySelectorAll("#waterRegionList .inspector-item-btn"));
    const row = rows.find((node) => node.textContent?.includes(targetName));
    if (!row) {
      throw new Error(`Missing water region row: ${targetName}`);
    }
    row.click();
  }, expectedName);

  await expect.poll(() => page.evaluate(() => {
    const activeTitle = document.querySelector("#waterRegionList .inspector-item-btn.is-active .country-row-title");
    return activeTitle?.textContent || "";
  })).toContain(expectedName);
}

async function hoverWaterFeatureOnMap(page, featureId) {
  const targetPoint = await page.evaluate(async (targetFeatureId) => {
    const { state } = await import("/js/core/state.js");
    const mapContainer = document.querySelector("#mapContainer");
    if (!mapContainer) return null;
    const rect = mapContainer.getBoundingClientRect();
    const transform = state.zoomTransform || { x: 0, y: 0, k: 1 };
    const dpr = Number(state.dpr || globalThis.devicePixelRatio || 1);
    const candidates = Array.isArray(state.waterSpatialItems)
      ? state.waterSpatialItems
        .filter((item) => String(item?.featureId || "") === targetFeatureId)
        .sort((left, right) => Number(right?.bboxArea || 0) - Number(left?.bboxArea || 0))
      : [];
    if (!candidates.length) return null;
    const item = candidates[0];
    const worldX = (Number(item.minX || 0) + Number(item.maxX || 0)) * 0.5;
    const worldY = (Number(item.minY || 0) + Number(item.maxY || 0)) * 0.5;
    const canvasX = ((worldX * transform.k) + transform.x) * dpr;
    const canvasY = ((worldY * transform.k) + transform.y) * dpr;
    return {
      x: rect.left + (canvasX / dpr),
      y: rect.top + (canvasY / dpr),
    };
  }, featureId);

  if (!targetPoint) {
    throw new Error(`Unable to compute map hover point for feature ${featureId}`);
  }

  await page.mouse.move(targetPoint.x, targetPoint.y, { steps: 6 });
  await page.waitForTimeout(500);
}

async function toggleOpenOceanSwitch(page) {
  const toggle = page.locator("#toggleOpenOceanRegions");
  await expect(toggle).toBeVisible();
  await toggle.click();
  await page.waitForTimeout(400);
  await toggle.click();
  await page.waitForTimeout(500);
}

async function readWaterRuntimeSnapshot(page) {
  return page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const metrics = state.renderPerfMetrics && typeof state.renderPerfMetrics === "object"
      ? state.renderPerfMetrics
      : (globalThis.__renderPerfMetrics || {});
    const counters = metrics.counters && typeof metrics.counters === "object" ? metrics.counters : {};
    return {
      hoveredWaterRegionId: state.hoveredWaterRegionId ? String(state.hoveredWaterRegionId) : null,
      selectedWaterRegionId: String(state.selectedWaterRegionId || ""),
      showOpenOceanRegions: !!state.showOpenOceanRegions,
      blackFrameCount: Number(metrics.blackFrameCount?.count || 0),
      contextScenarioExactRefreshCount: Number(counters.contextScenarioExactRefreshCount || 0),
    };
  });
}

for (const mode of WATER_CACHE_MODES) {
  test(`water cache mode ${mode} keeps water interactions stable`, async ({ page }) => {
    const consoleErrors = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await gotoApp(page, getPathForWaterCacheMode(mode), { waitUntil: "domcontentloaded" });
    await waitForAppInteractive(page);
    await waitForScenarioManagerIdle(page);
    await ensureScenario(page, TARGET_SCENARIO_ID, TARGET_SCENARIO_LABEL);
    await waitForStableExactRender(page);

    await ensureWaterInspectorOpen(page);
    await page.waitForFunction(() => !!document.querySelector("#waterRegionList .inspector-item-btn"));

    const exactRefreshTimeline = [];

    const seed = await readWaterRuntimeSnapshot(page);
    exactRefreshTimeline.push(seed.contextScenarioExactRefreshCount);

    await dragMap(page);
    await waitForStableExactRender(page);
    exactRefreshTimeline.push((await readWaterRuntimeSnapshot(page)).contextScenarioExactRefreshCount);

    await zoomMap(page, 112);
    await waitForStableExactRender(page);
    exactRefreshTimeline.push((await readWaterRuntimeSnapshot(page)).contextScenarioExactRefreshCount);

    await selectWaterRegionByName(page, TARGET_WATER_NAME, TARGET_WATER_NAME);
    await waitForStableExactRender(page);
    exactRefreshTimeline.push((await readWaterRuntimeSnapshot(page)).contextScenarioExactRefreshCount);

    await hoverWaterFeatureOnMap(page, TARGET_WATER_ID);
    await waitForStableExactRender(page);
    const afterHover = await readWaterRuntimeSnapshot(page);
    exactRefreshTimeline.push(afterHover.contextScenarioExactRefreshCount);

    await toggleOpenOceanSwitch(page);
    await waitForStableExactRender(page);
    const afterToggle = await readWaterRuntimeSnapshot(page);
    exactRefreshTimeline.push(afterToggle.contextScenarioExactRefreshCount);

    const screenshotDir = path.join(".runtime", "tests", "playwright");
    fs.mkdirSync(screenshotDir, { recursive: true });
    const fullScreenshotPath = path.join(screenshotDir, `water-cache-mode-${mode}-full.png`);
    const mapScreenshotPath = path.join(screenshotDir, `water-cache-mode-${mode}-map.png`);
    await page.screenshot({ path: fullScreenshotPath, fullPage: true });
    await page.locator("#mapContainer").screenshot({ path: mapScreenshotPath });

    for (let index = 1; index < exactRefreshTimeline.length; index += 1) {
      expect(exactRefreshTimeline[index]).toBeGreaterThanOrEqual(exactRefreshTimeline[index - 1]);
    }

    const exactRefreshDelta = afterToggle.contextScenarioExactRefreshCount - seed.contextScenarioExactRefreshCount;
    expect(exactRefreshDelta).toBeLessThanOrEqual(MAX_EXACT_REFRESH_DELTA);
    expect(seed.blackFrameCount).toBe(afterToggle.blackFrameCount);
    expect(afterHover.hoveredWaterRegionId).toBe(TARGET_WATER_ID);
    expect(afterToggle.selectedWaterRegionId).toBe(TARGET_WATER_ID);

    await expect.poll(() => page.evaluate(() => {
      const activeTitle = document.querySelector("#waterRegionList .inspector-item-btn.is-active .country-row-title");
      return activeTitle?.textContent || "";
    })).toContain(TARGET_WATER_NAME);

    expect(consoleErrors, `Console errors: ${JSON.stringify(consoleErrors, null, 2)}`).toEqual([]);

    console.log(JSON.stringify({
      kind: "water-cache-mode-regression",
      mode,
      contextScenarioExactRefreshCount: {
        seed: seed.contextScenarioExactRefreshCount,
        afterToggle: afterToggle.contextScenarioExactRefreshCount,
        delta: exactRefreshDelta,
      },
      blackFrameCount: {
        seed: seed.blackFrameCount,
        afterToggle: afterToggle.blackFrameCount,
      },
      selectedWaterRegionId: afterToggle.selectedWaterRegionId,
      hoveredWaterRegionId: afterHover.hoveredWaterRegionId,
      screenshots: [fullScreenshotPath, mapScreenshotPath],
    }));
  });
}
