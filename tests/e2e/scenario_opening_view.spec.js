const { test, expect } = require("@playwright/test");
const { waitForSettled } = require("./golden/golden-support");

test.setTimeout(240000);

const APP_PATH = "/app/?render_profile=balanced&startup_interaction=full&startup_worker=0&startup_cache=0";

async function viewportBounds(page) {
  return page.evaluate(() => {
    const { viewport } = globalThis.__scenarioForgeTestApi.status();
    return { bounds: viewport.bounds, k: viewport.k };
  });
}

// 世界上沿（北极）相对地图容器顶部的像素，<= 0 表示开场不露地图外的空白。
async function worldTopOffset(page) {
  return page.evaluate(async () => {
    const point = await globalThis.__scenarioForgeTestApi.screenPointForLonLat(20, 90);
    const y = Array.isArray(point) ? point[1] : point.y;
    return y - document.querySelector("#mapContainer").getBoundingClientRect().top;
  });
}

function containsLonLat([west, south, east, north], [lon, lat]) {
  return lon >= west && lon <= east && lat >= south && lat <= north;
}

// 不复位视角，直接经界面切换剧本：这里验证的正是剧本自己的开场视角。
async function applyScenarioFromPicker(page, scenarioId) {
  await page.locator("#lblScenario").click();
  await page.locator("#scenarioSelectButton").click();
  await page.locator(`#scenarioSelectMenu [role="option"][data-value="${scenarioId}"]`).click();
  await page.locator("#applyScenarioBtn").click();
  await waitForSettled(page, { scenarioId });
  await page.waitForTimeout(800);
  await waitForSettled(page, { scenarioId });
}

test("scenarios open on their own stage: TNO on Eurasia at startup, HOI4 on Europe after switching, modern on the world", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${APP_PATH}&default_scenario=tno_1962`, { waitUntil: "domcontentloaded" });
  await waitForSettled(page, { scenarioId: "tno_1962" });

  const tno = await viewportBounds(page);
  expect(tno.k).toBeGreaterThan(1.5);
  for (const point of [[10, 50], [37.6, 55.8], [70, 45]]) {
    expect(containsLonLat(tno.bounds, point), `TNO opening view should show ${point}`).toBe(true);
  }
  expect(containsLonLat(tno.bounds, [-100, 40]), "TNO opening view should not be the whole world").toBe(false);
  expect(await worldTopOffset(page), "TNO opening view should not show blank space above the world").toBeLessThanOrEqual(1);

  await applyScenarioFromPicker(page, "hoi4_1936");
  const hoi4 = await viewportBounds(page);
  expect(hoi4.k).toBeGreaterThan(tno.k);
  for (const point of [[2.35, 48.85], [13.4, 52.5], [21, 52.2]]) {
    expect(containsLonLat(hoi4.bounds, point), `HOI4 opening view should show ${point}`).toBe(true);
  }
  expect(containsLonLat(hoi4.bounds, [121.5, -25.5]), "HOI4 opening view should not include Australia").toBe(false);
  expect(await worldTopOffset(page), "HOI4 opening view should not show blank space above the world").toBeLessThanOrEqual(1);

  await applyScenarioFromPicker(page, "modern_world");
  const modern = await viewportBounds(page);
  expect(Math.abs(modern.k - 1)).toBeLessThan(0.01);
});
