// 回归：在地图上涂色/选中国家后，左栏国家列表不能整体下移（否则用户点击落错目标），
// 右栏属性面板里的动作列表不能再出现嵌套滚动条。只经 DOM 与 __scenarioForgeTestApi 读写应用。
const { test, expect } = require("@playwright/test");
const {
  collectPageErrors,
  fillAt,
  openApp,
  selectFillTool,
  waitForSettled,
  zoomTo,
} = require("./golden/golden-support");

const FILL = "#2a9d8f";

test("painting a region keeps the country list in place and the action list unscrolled", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = collectPageErrors(page);
  await openApp(page);
  const countryList = page.locator("#countryList");
  await expect(countryList).toBeVisible();
  const point = await zoomTo(page);
  const readTop = () => countryList.evaluate((node) => node.getBoundingClientRect().top);
  const topBefore = await readTop();

  await selectFillTool(page, FILL);
  await fillAt(page, point);
  // 涂色只记录地块命中；用户随后点左栏国家行时快捷块才渲染，这一刻列表不能下移。
  const row = page.locator("#countryList .country-select-row[data-country-code] .country-select-main-btn:visible").first();
  await row.click();
  await expect(page.locator("[data-selected-land-country-quick-tab] .country-select-main-btn")).toBeVisible();
  const quickTab = await page.locator("[data-selected-land-country-quick-tab]").evaluate((node) => ({
    scrollHeight: node.scrollHeight, clientHeight: node.clientHeight,
  }));
  expect(quickTab.scrollHeight, "selected country card is clipped by its slot").toBeLessThanOrEqual(quickTab.clientHeight);
  expect(await readTop(), "country list moved after selecting a country").toBeCloseTo(topBefore, 0);
  await waitForSettled(page);
  const actionLists = page.locator("#editorProperty-countries .inspector-action-list");
  await expect(actionLists.first()).toBeVisible();
  const overflow = await actionLists.evaluateAll((nodes) => nodes
    .filter((node) => node.getClientRects().length)
    .map((node) => ({ scrollHeight: node.scrollHeight, clientHeight: node.clientHeight })));
  expect(overflow.length).toBeGreaterThan(0);
  for (const box of overflow) expect(box.scrollHeight).toBe(box.clientHeight);
  expect(errors).toEqual([]);
});
