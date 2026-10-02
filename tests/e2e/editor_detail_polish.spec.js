const { test, expect } = require("@playwright/test");
const { gotoApp, waitForAppInteractive } = require("./support/playwright-app");

test.setTimeout(60_000);

async function openWorkspace(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem("map_lang", "zh"));
  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);
  await expect(page.locator("#editorProjectBar")).toHaveAttribute("data-ready", "true");
}

test("water filters show complete default values and lake settings guide without enabling interaction", async ({ page }) => {
  await openWorkspace(page);
  await page.locator("#editorObjects-water").click();
  const settings = page.locator("#waterInspectorLakeSettingsBtn");
  const lake = page.locator("#waterInspectorLakeInteractionToggle");
  await expect(settings).toBeVisible();
  await expect(page.locator("#waterInspectorEmptyHint")).toContainText("开启湖泊交互");
  await page.locator("#leftSidebarCollapseBtn").click();
  await settings.click();
  await expect(page.locator("body")).not.toHaveClass(/left-sidebar-collapsed/);
  await expect(lake).not.toBeChecked();
  await expect(lake).toBeFocused();
  for (const width of [1440, 1100]) {
    await page.setViewportSize({ width, height: 900 });
    const sizes = await page.locator("#editorWaterFilters .app-select-text").evaluateAll((nodes) => nodes.map((node) => ({
      text: node.textContent, width: node.clientWidth, required: node.scrollWidth,
    })));
    expect(sizes).toHaveLength(4);
    for (const size of sizes) expect(size.required, size.text).toBeLessThanOrEqual(size.width + 1);
  }
  await expect(page.locator("#waterInspectorSortSelect option[value=name]")).toHaveText("名称");
  await expect(page.locator("#waterInspectorSortSelect option[value=type]")).toHaveText("类型");
  await lake.check();
  await expect(settings).toBeHidden();
  await expect(page.locator("#waterInspectorEmptyHint")).not.toContainText("先在设置中");
  await lake.uncheck();
  await page.locator("#btnToggleLang").click();
  await expect(settings).toHaveText("Lake interaction settings");
  await expect(page.locator("#waterInspectorEmptyHint")).toContainText("first enable lake interaction");
  await expect(page.locator("#waterInspectorSortSelect option[value=name]")).toHaveText("Name");
  await page.setViewportSize({ width: 768, height: 900 });
  await page.locator("#rightPanelToggle").click();
  await settings.click();
  await expect(page.locator("body")).toHaveClass(/left-drawer-open/);
  await expect(page.locator("body")).not.toHaveClass(/right-drawer-open/);
  await expect(lake).toBeFocused();
  await expect(lake).not.toBeChecked();
});

test("tooltips support focus and Escape while brush guidance follows tool and language changes", async ({ page }) => {
  await openWorkspace(page);
  const tooltip = page.locator("#editorToolTooltip");
  const fill = page.locator("#toolFillBtn");
  await fill.focus();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("填充工具");
  await expect(tooltip.locator("kbd")).toHaveText("F");
  await expect(fill).toHaveAttribute("aria-describedby", "editorToolTooltip");
  await fill.press("Escape");
  await expect(tooltip).toBeHidden();
  await expect(fill).not.toHaveAttribute("aria-describedby", /editorToolTooltip/);
  await page.locator("#toolEraserBtn").hover();
  await expect(tooltip).toContainText("橡皮擦工具");
  await page.locator("#editorProjectBar").hover();
  await expect(tooltip).toBeHidden();
  await page.locator("#brushModeBtn").click();
  const hint = page.locator("#editorBrushPanHint");
  await expect(hint).toBeVisible();
  await expect(hint).toContainText("空格");
  await page.locator("#btnToggleLang").click();
  await expect(hint).toHaveText("Shift / Space + drag to pan");
  await fill.focus();
  await expect(tooltip).toContainText("Fill tool");
  await expect(fill).not.toHaveAttribute("title", /.+/);
  await page.locator("#brushModeBtn").hover();
  await expect(tooltip).toContainText("Brush");
  await page.keyboard.press("i");
  await expect(tooltip).toBeHidden();
  await expect(hint).toBeHidden();
  await expect(page.locator("#brushModeBtn")).toBeDisabled();
});

test("guide country shortcut preserves search and opens the correct drawer with focus", async ({ page }) => {
  await openWorkspace(page);
  const search = page.locator("#countrySearch");
  await search.fill("GER");
  await page.locator("#editorTaskLayersBtn").click();
  await page.locator("#scenarioGuideBtn").click();
  await page.locator("#scenarioGuideTabQuick").click();
  await expect(page.locator("#scenarioGuideStepSelect")).toContainText("对象 → 国家");
  await page.setViewportSize({ width: 768, height: 900 });
  await page.locator("#scenarioGuideSelectCountryBtn").click();
  await expect(page.locator("#scenarioGuidePopover")).toBeHidden();
  await expect(page.locator("body")).toHaveClass(/left-drawer-open/);
  await expect(page.locator("#editorObjects-countries")).toHaveAttribute("aria-pressed", "true");
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("GER");
});

test("city basics precede optional hierarchy help and keep a working style control", async ({ page }) => {
  await openWorkspace(page);
  await page.locator("#editorTaskLayersBtn").click();
  await page.locator("#appearanceTabCityPoints").click();
  await expect(page.locator("#cityPointsTheme")).toHaveCount(1);
  await expect(page.locator(".city-hierarchy-help")).toHaveJSProperty("open", false);
  const hierarchyArrow = () => page.locator(".city-hierarchy-help summary").evaluate((node) => getComputedStyle(node, "::after").transform);
  expect(await hierarchyArrow()).toBe("none");
  await expect(page.locator("#cityHierarchyTitle")).toHaveText("显示与样式");
  await expect(page.locator("#lblCityPointsStyleGroup")).toHaveText("标记");
  const order = await page.evaluate(() => {
    const ids = ["cityPointsTheme", "cityPointsDensityPreset", "cityPointsMarkerScale", "cityPointLabelsEnabled"];
    return ids.map((id) => document.getElementById(id).getBoundingClientRect().top);
  });
  expect(order).toEqual([...order].sort((a, b) => a - b));
  await expect(page.locator("#cityPointLabelsEnabled")).toBeInViewport();
  await page.locator("#cityPointsThemeAppSelectButton").click();
  await page.locator("#cityPointsThemeAppSelectMenu .app-select-option[data-value=atlas_ink]").click();
  await expect(page.locator("#cityPointsTheme")).toHaveValue("atlas_ink");
  await page.locator(".city-hierarchy-help summary").click();
  await expect(page.locator(".city-hierarchy-help .city-symbol-legend")).toBeVisible();
  expect(await hierarchyArrow()).toBe("matrix(0, 1, -1, 0, 0, 0)");
});
