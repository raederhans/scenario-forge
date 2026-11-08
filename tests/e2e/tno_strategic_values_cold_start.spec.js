const { test, expect } = require("@playwright/test");
const { waitForSettled } = require("./golden/golden-support");

test.setTimeout(240000);

// 默认启动参数：启动 worker 开启、走启动包，正是"启动包内嵌 manifest 副本落后"会出问题的路径。
const APP_PATH = "/app/?render_profile=balanced&startup_interaction=full";

// 运行时把胜利点按地块归一化（Map 或普通对象，值为数组）。
function summarizeVictoryPoints() {
  return import("/js/core/state.js").then(({ state }) => {
    const byFeature = state.scenarioStrategicValuesData?.victoryPointsByFeature;
    const groups = byFeature instanceof Map ? [...byFeature.values()] : Object.values(byFeature || {});
    const points = groups.flatMap((entry) => (Array.isArray(entry) ? entry : [entry]));
    const berlin = points.find((point) => point?.name === "Berlin-Germania") || null;
    return { count: points.length, berlinValue: berlin ? Number(berlin.value) : null };
  });
}

// 冷启动直接进入 TNO：活动 manifest 是启动包内嵌副本，战略值面板与加载器读剧本包缓存里的完整 manifest，图层应可加载。
test("TNO strategic values load when the app starts directly on TNO", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("map_lang", "en"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${APP_PATH}&default_scenario=tno_1962`, { waitUntil: "domcontentloaded" });
  await waitForSettled(page, { scenarioId: "tno_1962" });

  const status = page.locator("#strategicValuesStatus");
  await expect(status).not.toHaveText(/not connected/i);
  await page.locator("#strategicValuesLoad").dispatchEvent("click");
  await expect(status).toHaveText(/ready/i, { timeout: 120000 });

  const summary = await page.evaluate(summarizeVictoryPoints);
  expect(summary.count).toBeGreaterThan(1000);
  expect(summary.berlinValue).toBeGreaterThanOrEqual(50);
});
