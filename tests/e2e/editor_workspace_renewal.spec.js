const { test, expect } = require("@playwright/test");
const { gotoApp, waitForAppInteractive } = require("./support/playwright-app");

test.setTimeout(60_000);

async function openWorkspace(page) {
  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);
  await expect(page.locator("body")).toHaveClass(/editor-workspace/);
}

async function readState(page, field) {
  return page.evaluate(async (name) => {
    const { state } = await import("/js/core/state.js");
    if (name === "cityScale") return Number(state.styleConfig?.cityPoints?.markerScale);
    return state[name];
  }, field);
}

test("workspace geometry is stable before and after deferred controls mount", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  let releaseMain;
  const mainReady = new Promise((resolve) => { releaseMain = resolve; });
  await page.route("**/js/main.js", async (route) => {
    await mainReady;
    await route.continue();
  });
  let initialBounds;
  try {
    await gotoApp(page, "/", { waitUntil: "commit" });
    await expect(page.locator("#editorProjectBar")).toBeVisible();
    await expect(page.locator("#editorProjectBar")).toBeEmpty();
    initialBounds = await page.locator("#mapContainer").boundingBox();
    expect(initialBounds).not.toBeNull();
    expect(initialBounds.y).toBe(56);
    expect(initialBounds.height).toBe(844);
  } finally {
    releaseMain();
  }
  await waitForAppInteractive(page);
  await expect(page.locator("#editorProjectBar")).toHaveAttribute("data-ready", "true");
  const finalBounds = await page.locator("#mapContainer").boundingBox();
  expect(finalBounds).toEqual(initialBounds);
});

test("default workspace keeps four tasks, project header, and the bottom dock", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkspace(page);
  const taskButtons = page.locator("#editorTaskNav .editor-nav-button");
  await expect(taskButtons).toHaveCount(4);
  for (const id of ["Objects", "Layers", "Palette", "Assets"]) {
    await expect(page.locator(`#editorTask${id}Btn`)).toBeVisible();
  }
  await expect(page.locator("#editorTaskObjectsBtn")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#editorProperty-countries")).toBeVisible();
  await expect(page.locator("#editorProjectBar #inspectorSidebarTabProject")).toBeVisible();
  await expect(page.locator("#bottomDock")).toBeVisible();
  await expect(page.locator("body")).not.toHaveClass(/frontline-mode-active/);

  await page.locator("#inspectorSidebarTabProject").click();
  await expect(page.locator("#editorProperty-project")).toBeVisible();
  await expect(page.locator("#bottomDock")).toBeVisible();
  await expect(page.locator("body")).not.toHaveClass(/frontline-mode-active/);
});

test("saved Chinese language renders the new workspace labels on first load", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("map_lang", "zh"));
  await openWorkspace(page);
  await expect.poll(() => readState(page, "currentLanguage")).toBe("zh");
  for (const [id, label] of [
    ["editorTaskObjectsBtn", "对象"],
    ["editorTaskLayersBtn", "图层"],
    ["editorTaskPaletteBtn", "调色板"],
    ["editorTaskAssetsBtn", "素材"],
    ["editorCountryDisplayOptions", "名称与显示"],
  ]) {
    const item = page.locator(`#${id}${id === "editorCountryDisplayOptions" ? " summary" : ""}`);
    await expect(item).toHaveText(label);
  }
  await expect(page.locator("#btnToggleLang")).toBeVisible();
});

test("native city layer control opens the right property panel and changes state", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem("map_lang", "zh"));
  await openWorkspace(page);
  await expect.poll(() => readState(page, "currentLanguage")).toBe("zh");
  await page.locator("#editorTaskLayersBtn").click();
  await page.locator("#appearanceTabCityPoints").click();
  const property = page.locator("#editorProperty-data-appearance-panel-citypoints");
  await expect(property).toBeVisible();
  await expect(page.locator("#editorPropertiesTitle")).toHaveText("城市点位");
  await expect(property).toHaveAttribute("aria-label", "城市点位");
  const scale = page.locator("#cityPointsMarkerScale");
  await expect(scale).toBeVisible();
  const before = Number(await scale.inputValue());
  await scale.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => scale.inputValue()).not.toBe(String(before));
  const after = Number(await scale.inputValue());
  expect(after).toBeGreaterThan(before);
  await expect.poll(() => readState(page, "cityScale"))
    .toBeCloseTo(after, 2);
  await page.locator("#btnToggleLang").click();
  await expect.poll(() => readState(page, "currentLanguage")).toBe("en");
  await expect(page.locator("#editorPropertiesTitle")).toHaveText("City Points");
  await expect(property).toHaveAttribute("aria-label", "City Points");
  await expect(scale).toHaveValue(String(after));
  await expect.poll(() => readState(page, "cityScale")).toBeCloseTo(after, 2);
});

test("annotations mode enters and exits only through explicit controls", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openWorkspace(page);
  await page.locator("#editorTaskLayersBtn").click();
  await page.locator("#editorLayer-annotations").click();
  await expect(page.locator("#editorProperty-annotations")).toBeVisible();
  await expect(page.locator("body")).not.toHaveClass(/frontline-mode-active/);
  await page.locator("#editorStrategicModeBtn").click();
  await expect(page.locator("body")).toHaveClass(/frontline-mode-active/);
  await expect(page.locator("#editorStrategicModeBtn")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#editorFinishAnnotationsBtn").click();
  await expect(page.locator("body")).not.toHaveClass(/frontline-mode-active/);
  await expect(page.locator("#editorStrategicModeBtn")).toHaveAttribute("aria-pressed", "false");
});

test("water search and filters retain selection across language changes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkspace(page);
  await page.locator("#editorObjects-water").click();
  await expect(page.locator("#editorWaterFilters")).toBeVisible();
  await expect(page.locator("#editorWaterFilters")).not.toHaveAttribute("open", "");
  await page.locator("#editorWaterFilters summary").click();
  await expect(page.locator("#waterInspectorGroupFilter")).toHaveCount(1);
  await expect(page.locator("#waterRegionList .inspector-item-btn").first()).toBeVisible();

  const row = page.locator("#waterRegionList .inspector-item-btn").first();
  const id = await row.getAttribute("data-region-id");
  expect(id).toBeTruthy();
  await page.locator("#waterRegionSearch").fill(id);
  await page.locator("#waterRegionList .inspector-item-btn").first().click();
  await expect(page.locator("#editorProperty-water #waterInspectorDetail")).toBeVisible();
  expect(await readState(page, "selectedWaterRegionId")).toBe(id);

  const groupFilter = page.locator("#waterInspectorGroupFilter");
  const chosen = await groupFilter.locator('option[value]:not([value=""]):not([disabled])').first().getAttribute("value");
  expect(chosen).toBeTruthy();
  const trigger = page.locator("#waterInspectorGroupFilterAppSelectButton");
  await trigger.click();
  await page.locator(`#waterInspectorGroupFilterAppSelectMenu .app-select-option[data-value="${chosen}"]`).click();
  await expect(groupFilter).toHaveValue(chosen);
  const allGroupsBefore = await groupFilter.locator('option[value=""]').textContent();
  const languageBefore = await readState(page, "currentLanguage");
  await page.locator("#btnToggleLang").click();
  await expect.poll(() => readState(page, "currentLanguage")).not.toBe(languageBefore);
  await expect(groupFilter).toHaveValue(chosen);
  await expect(page.locator("#waterRegionSearch")).toHaveValue(id);
  expect(await readState(page, "selectedWaterRegionId")).toBe(id);
  await expect(groupFilter.locator('option[value=""]')).not.toHaveText(allGroupsBefore.trim());
});

test("account dialog and quick color labels refresh without clearing entered values", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem("map_lang", "en"));
  await openWorkspace(page);
  await expect.poll(() => readState(page, "currentLanguage")).toBe("en");
  const accountButton = page.locator("#editorProjectBar #backendAccountToggleBtn");
  const dialog = page.locator("#backendAccountPopover");
  const title = page.locator("#backendAccountPopoverTitle");
  const username = page.locator("#backendCloudUsername");
  const quickSwatch = page.locator("#paletteGrid .color-swatch").first();
  await expect(quickSwatch).toBeVisible();
  const selectedColor = await readState(page, "selectedColor");
  const swatchColor = await quickSwatch.getAttribute("data-color");
  const swatchStyle = await quickSwatch.getAttribute("style");
  const englishSwatchLabel = await quickSwatch.getAttribute("aria-label");
  expect(swatchColor).toBeTruthy();
  expect(englishSwatchLabel).toContain(swatchColor);

  await accountButton.click();
  await expect(dialog).toBeVisible();
  await expect(title).toHaveText("Cloud Saves");
  const englishAccountLabel = await dialog.getAttribute("aria-label");
  await username.fill("draft-account-name");
  await page.locator("#backendAccountCloseBtn").click();
  await expect(dialog).toBeHidden();

  await page.locator("#btnToggleLang").click();
  await expect.poll(() => readState(page, "currentLanguage")).toBe("zh");
  await expect(quickSwatch).not.toHaveAttribute("aria-label", englishSwatchLabel);
  await expect(quickSwatch).toHaveAttribute("data-color", swatchColor);
  await expect(quickSwatch).toHaveAttribute("style", swatchStyle);
  expect(await quickSwatch.getAttribute("aria-label")).toContain(swatchColor);
  expect(await readState(page, "selectedColor")).toBe(selectedColor);
  await accountButton.click();
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toHaveAttribute("aria-label", englishAccountLabel);
  await expect(title).not.toHaveText("Cloud Saves");
  await expect(username).toHaveValue("draft-account-name");
  await page.locator("#backendAccountCloseBtn").click();
});

test("managed scenario disclosure survives selection and runtime refresh", async ({ page }) => {
  await openWorkspace(page);
  const disclosure = page.locator("#editorProjectBar .editor-scenario-menu");
  await disclosure.locator("summary").click();
  await expect(disclosure).toHaveJSProperty("open", true);
  await page.locator("#scenarioSelectButton").click();
  const option = page.locator('#scenarioSelectMenu .scenario-select-option[data-value]:not([data-value=""])').first();
  await expect(option).toBeVisible();
  const scenarioId = await option.getAttribute("data-value");
  await option.click();
  await expect(page.locator("#scenarioSelect")).toHaveValue(scenarioId);
  await expect(disclosure).toHaveJSProperty("open", true);
  await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    state.updateScenarioUIFn?.();
  });
  await expect(disclosure).toHaveJSProperty("open", true);
  await expect(page.locator("#scenarioSelect")).toHaveValue(scenarioId);
});

test("a live long water select supports keyboard search and native selection", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkspace(page);
  await page.locator("#editorObjects-water").click();
  await page.locator("#editorWaterFilters summary").click();
  const selectId = await page.evaluate(() => [
    "waterInspectorTypeFilter", "waterInspectorGroupFilter", "waterInspectorSourceFilter",
  ].find((id) => {
    const select = document.getElementById(id);
    return [...(select?.options || [])].filter((option) => !option.disabled && !option.parentElement?.disabled).length >= 10;
  }) || "");
  expect(selectId, "The default scenario must exercise a live select with at least ten options").toBeTruthy();
  const select = page.locator(`#${selectId}`);
  const target = await select.locator('option[value]:not([value=""]):not([disabled])').last().evaluate((option) => ({
    value: option.value,
    label: option.textContent.trim(),
  }));
  const trigger = page.locator(`#${selectId}AppSelectButton`);
  await trigger.click();
  const menu = page.locator(`#${selectId}AppSelectMenu`);
  const search = menu.locator(".app-select-search");
  await expect(search).toBeFocused();
  await search.fill(target.label);
  await search.press("Enter");
  await expect(select).toHaveValue(target.value);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await search.fill("no such water category 98765");
  await expect(menu.locator(".app-select-no-matches")).toBeVisible();
  await search.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(menu).toBeHidden();
});

test("workspace widths and mobile drawer have no horizontal page overflow", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkspace(page);
  for (const { width, height } of [
    { width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 1920, height: 1080 },
    { width: 1280, height: 800 }, { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize({ width, height });
    await expect(page.locator("#bottomDock")).toBeVisible();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, `${width}x${height} horizontal overflow`).toBeLessThanOrEqual(width + 1);
  }
  await page.setViewportSize({ width: 768, height: 900 });
  await expect(page.locator("#leftPanelToggle")).toBeVisible();
  await page.locator("#leftPanelToggle").click();
  await expect(page.locator('[data-close-drawer="left"]')).toBeFocused();
  await expect(page.locator("#editorTaskNav")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(769);
  await page.keyboard.press("Escape");
  await expect(page.locator("#leftPanelToggle")).toBeFocused();
});
