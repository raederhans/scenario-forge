const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const {
  gotoApp,
  waitForAppInteractive,
  waitForScenarioApplyIdle,
  waitForRenderIdle,
} = require("./support/playwright-app");

test.setTimeout(120_000);

const WATER_CACHE_MODES = ["adaptive", "reuse", "direct"];
const FAST_STARTUP_BASE_PATH = "/?render_profile=balanced&startup_interaction=readonly&startup_worker=1&startup_cache=1";
const TARGET_SCENARIO_ID = "tno_1962";
const TARGET_SCENARIO_LABEL = "TNO 1962";
const TARGET_WATER_NAME = "North Sea";
const TARGET_WATER_ID = "tno_north_sea";
const MAX_EXACT_REFRESH_DELTA = 200;
const IGNORED_CONSOLE_ERROR_PATTERNS = [
  /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/,
];

function isIgnoredConsoleError(text) {
  return IGNORED_CONSOLE_ERROR_PATTERNS.some((pattern) => pattern.test(String(text || "")));
}

function getPathForWaterCacheMode(mode) {
  return `${FAST_STARTUP_BASE_PATH}&water_cache_mode=${encodeURIComponent(mode)}`;
}

async function waitForScenarioManagerIdle(page) {
  await waitForScenarioApplyIdle(page, { timeout: 120_000 });
}

async function waitForStableExactRender(page, { timeout = 30_000 } = {}) {
  await waitForRenderIdle(page, { timeout });
}

async function ensureScenario(page, scenarioId, label) {
  await page.waitForFunction((expectedScenarioId) => {
    const select = document.querySelector("#scenarioSelect");
    return !!select && !!select.querySelector(`option[value="${expectedScenarioId}"]`);
  }, scenarioId, { timeout: 120_000 });

  const currentScenarioId = await page.evaluate(async () => {
    const { state } = await import(new URL("./js/core/state.js", location.href));
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
  await waitForScenarioApplyIdle(page, { scenarioId, timeout: 120_000 });
  await waitForRenderIdle(page, { scenarioId, timeout: 120_000 });
}

async function ensureWaterInspectorOpen(page) {
  await page.evaluate(() => {
    document.querySelector("#waterInspectorSection")?.setAttribute("open", "");
  });
  await expect(page.locator("#waterRegionSearch")).toBeVisible();
}

async function ensureWaterInspectorItemsReady(page) {
  await ensureWaterInspectorOpen(page);
  const hasItems = await page.evaluate(() => !!document.querySelector("#waterRegionList .inspector-item-btn"));
  if (!hasItems) {
    await page.evaluate(async () => {
      const { scheduleScenarioChunkRefresh } = await import(new URL("./js/core/scenario_resources.js", location.href));
      scheduleScenarioChunkRefresh({ reason: "scenario-apply", delayMs: 0 });
    });
    await waitForRenderIdle(page, { scenarioId: TARGET_SCENARIO_ID, timeout: 120_000 });
    await page.evaluate(() => {
      if (typeof globalThis.__playwrightStateRef?.renderWaterRegionListFn === "function") {
        globalThis.__playwrightStateRef.renderWaterRegionListFn();
      }
    });
  }
  await page.waitForFunction(() => !!document.querySelector("#waterRegionList .inspector-item-btn"));
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
  await waitForRenderIdle(page, { timeout: 30_000 });
}

async function zoomMap(page, percent) {
  await page.evaluate(async (targetPercent) => {
    const { setZoomPercent } = await import(new URL("./js/core/map_renderer.js", location.href));
    setZoomPercent(targetPercent);
  }, percent);
  await waitForRenderIdle(page, { timeout: 30_000 });
}

async function zoomMapWithoutWaitingForIdle(page, percent) {
  await page.evaluate(async (targetPercent) => {
    const { setZoomPercent } = await import(new URL("./js/core/map_renderer.js", location.href));
    setZoomPercent(targetPercent);
  }, percent);
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
    const { state } = await import(new URL("./js/core/state.js", location.href));
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

  await expect.poll(async () => {
    await page.mouse.move(targetPoint.x, targetPoint.y, { steps: 2 });
    return page.evaluate(async () => {
    const { state } = await import(new URL("./js/core/state.js", location.href));
    const current = state.hoveredWaterRegionId;
    return current ? String(current) : null;
    });
  }, { timeout: 30_000 }).toBe(featureId);
  await waitForRenderIdle(page, { timeout: 30_000 });
}

async function enableOpenOceanInteraction(page) {
  await ensureWaterInspectorOpen(page);
  const selectToggle = page.locator("#waterInspectorOpenOceanSelectToggle");
  const paintToggle = page.locator("#waterInspectorOpenOceanPaintToggle");
  await expect(selectToggle).toBeVisible();
  await expect(paintToggle).toBeVisible();

  await selectToggle.setChecked(true);
  await paintToggle.setChecked(true);
  await waitForRenderIdle(page, { timeout: 30_000 });
}

async function readWaterRuntimeSnapshot(page) {
  return page.evaluate(async () => {
    const { state } = await import(new URL("./js/core/state.js", location.href));
    const metrics = state.renderPerfMetrics && typeof state.renderPerfMetrics === "object"
      ? state.renderPerfMetrics
      : (globalThis.__renderPerfMetrics || {});
    const counters = metrics.counters && typeof metrics.counters === "object" ? metrics.counters : {};
    return {
      hoveredWaterRegionId: state.hoveredWaterRegionId ? String(state.hoveredWaterRegionId) : null,
      selectedWaterRegionId: String(state.selectedWaterRegionId || ""),
      showOpenOceanRegions: !!state.showOpenOceanRegions,
      allowOpenOceanSelect: !!state.allowOpenOceanSelect,
      allowOpenOceanPaint: !!state.allowOpenOceanPaint,
      secondarySpatialBuildPending: !!state.secondarySpatialBuildPending,
      secondarySpatialPreservedDuringBuild: !!state.secondarySpatialPreservedDuringBuild,
      waterSpatialItems: Array.isArray(state.waterSpatialItems) ? state.waterSpatialItems.length : 0,
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
        const text = msg.text();
        if (!isIgnoredConsoleError(text)) {
          consoleErrors.push(text);
        }
      }
    });

    await gotoApp(page, getPathForWaterCacheMode(mode), { waitUntil: "domcontentloaded" });
    await waitForAppInteractive(page);
    await waitForScenarioManagerIdle(page);
    await ensureScenario(page, TARGET_SCENARIO_ID, TARGET_SCENARIO_LABEL);
    await waitForStableExactRender(page);

    await ensureWaterInspectorItemsReady(page);

    const exactRefreshTimeline = [];

    const seed = await readWaterRuntimeSnapshot(page);
    exactRefreshTimeline.push(seed.contextScenarioExactRefreshCount);
    expect(seed.showOpenOceanRegions).toBe(true);
    expect(seed.allowOpenOceanSelect).toBe(false);
    expect(seed.allowOpenOceanPaint).toBe(false);
    expect(seed.waterSpatialItems).toBeGreaterThan(0);

    await dragMap(page);
    await waitForStableExactRender(page);
    exactRefreshTimeline.push((await readWaterRuntimeSnapshot(page)).contextScenarioExactRefreshCount);

    await zoomMap(page, 112);
    await waitForStableExactRender(page);
    exactRefreshTimeline.push((await readWaterRuntimeSnapshot(page)).contextScenarioExactRefreshCount);

    await selectWaterRegionByName(page, TARGET_WATER_NAME, TARGET_WATER_NAME);
    await waitForStableExactRender(page);
    exactRefreshTimeline.push((await readWaterRuntimeSnapshot(page)).contextScenarioExactRefreshCount);

    await zoomMapWithoutWaitingForIdle(page, 128);
    await hoverWaterFeatureOnMap(page, TARGET_WATER_ID);
    await waitForStableExactRender(page);
    const afterHover = await readWaterRuntimeSnapshot(page);
    exactRefreshTimeline.push(afterHover.contextScenarioExactRefreshCount);

    await enableOpenOceanInteraction(page);
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
    expect(afterHover.allowOpenOceanSelect).toBe(false);
    expect(afterHover.allowOpenOceanPaint).toBe(false);
    expect(afterHover.waterSpatialItems).toBeGreaterThan(0);
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
