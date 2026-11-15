// 临时检查：调色板库隐藏时不重建，打开 Palette 标签后显示新用的最近颜色。提交前删除。
const { test, expect } = require("@playwright/test");
const { openApp, selectFillTool, zoomTo, fillAt, waitForSettled, switchScenario } = require("./golden-support");

test("调色板库在隐藏时跳过重建，显示时补上新颜色", async ({ page }) => {
  test.setTimeout(240_000);
  await openApp(page);
  await switchScenario(page, "hoi4_1936");
  const point = await zoomTo(page, undefined, { scenarioId: "hoi4_1936" });
  const color = "#12ab34";
  const row = page.locator(`#paletteLibraryList [data-palette-row-key="recent-${color}"]`);
  // 先在 Palette 标签里把调色板库关上，再回到地图填色
  await page.locator("#editorTaskPaletteBtn").click();
  if (await page.locator("#paletteLibraryPanel").isVisible()) await page.locator("#paletteLibraryToggle").click();
  await expect(page.locator("#paletteLibraryPanel")).toBeHidden();
  await selectFillTool(page, color);
  await fillAt(page, point, { scenarioId: "hoi4_1936" });
  await waitForSettled(page, { scenarioId: "hoi4_1936" });
  await page.waitForTimeout(500);
  expect(await row.count(), "隐藏的调色板库不应在填色后重建").toBe(0);
  await page.evaluate(() => {
    window.__libraryRebuilds = 0;
    const list = document.getElementById("paletteLibraryList");
    new MutationObserver((records) => {
      if (records.some((record) => record.target === list && record.removedNodes.length)) window.__libraryRebuilds += 1;
    }).observe(list, { childList: true });
  });
  if (!(await page.locator("#paletteLibraryToggle").isVisible())) await page.locator("#editorTaskPaletteBtn").click();
  await page.locator("#paletteLibraryToggle").click();
  await expect(row.first()).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1500);
  const rebuilds = await page.evaluate(() => window.__libraryRebuilds);
  console.log("LIBRARY_REBUILDS_ON_SHOW", rebuilds);
  expect(rebuilds, "显示调色板库时只重建一次").toBe(1);
});
