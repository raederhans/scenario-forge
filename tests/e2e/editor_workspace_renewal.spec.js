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

test("extra layer and project entries reopen collapsed properties", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkspace(page);
  await page.locator("#editorTaskLayersBtn").click();
  const collapse = page.locator("#rightSidebarCollapseBtn");
  const content = page.locator("#rightSidebarContent");
  for (const [entry, property] of [
    ["editorLayer-legend", "editorProperty-legend"],
    ["editorLayer-annotations", "editorProperty-annotations"],
    ["inspectorSidebarTabProject", "editorProperty-project"],
  ]) {
    await collapse.click();
    await expect(collapse).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("body")).toHaveClass(/right-sidebar-collapsed/);
    await page.locator(`#${entry}`).click();
    await expect(collapse).toHaveAttribute("aria-expanded", "true");
    await expect(content).toHaveAttribute("aria-hidden", "false");
    await expect(content).not.toHaveAttribute("inert", "");
    await expect(page.locator("body")).not.toHaveClass(/right-sidebar-collapsed/);
    await expect(page.locator(`#${property}`)).toBeVisible();
  }
  await page.setViewportSize({ width: 768, height: 900 });
  await page.locator("#leftPanelToggle").click();
  await page.locator("#editorTaskLayersBtn").click();
  await page.locator("#editorLayer-legend").click();
  await expect(page.locator("body")).toHaveClass(/right-drawer-open/);
  await expect(page.locator("body")).not.toHaveClass(/left-drawer-open/);
  await expect(page.locator("#editorProperty-legend")).toBeVisible();
  await expect(page.locator("#rightSidebar")).toHaveJSProperty("inert", false);
  await expect(page.locator("#leftSidebar")).toHaveJSProperty("inert", true);
});

test("vertical layer tabs switch properties with arrows and Home and End", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkspace(page);
  await page.locator("#editorTaskLayersBtn").click();
  const groups = page.locator('#editorTask-layers [role="tablist"]');
  await expect(groups).toHaveCount(2);
  const borders = page.locator("#appearanceTabBorders");
  await borders.click();
  await expect(borders.locator('xpath=..')).toHaveAttribute("aria-orientation", "vertical");
  await borders.press("ArrowDown");
  await expect(page.locator("#appearanceTabPhysical")).toBeFocused();
  await expect(page.locator("#appearanceTabPhysical")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#editorProperty-data-appearance-panel-physical")).toBeVisible();
  await expect(page.locator("#editorProperty-data-appearance-panel-borders")).toBeHidden();
  await page.keyboard.press("End");
  await expect(page.locator("#appearanceTabPresets")).toBeFocused();
  await expect(page.locator("#appearanceTabPresets")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#editorProperty-data-appearance-panel-presets")).toBeVisible();
  await expect(page.locator("#editorProperty-data-appearance-panel-physical")).toBeHidden();
  await page.keyboard.press("Home");
  await expect(borders).toBeFocused();
  await expect(borders).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#editorProperty-data-appearance-panel-borders")).toBeVisible();
  await expect(page.locator("#editorProperty-data-appearance-panel-presets")).toBeHidden();
  for (const group of await groups.all()) {
    await expect(group).toHaveAttribute("aria-orientation", "vertical");
    expect(await group.locator('[role="tab"][tabindex="0"]').count()).toBeGreaterThanOrEqual(1);
  }
});

test("properties Back restores edited panels and their scroll positions", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  await openWorkspace(page);
  await page.locator("#editorTaskLayersBtn").click();
  const content = page.locator("#rightSidebarContent");
  const borders = page.locator("#appearanceTabBorders");
  const cities = page.locator("#appearanceTabCityPoints");
  const back = page.locator("#editorPropertiesBackBtn");
  // Wait for the native scroll event before switching away from each panel.
  const rememberScroll = async (offset) => content.evaluate(async (element, value) => {
    element.scrollTop = value;
    await new Promise(requestAnimationFrame);
    return element.scrollTop;
  }, offset);

  await borders.click();
  await page.locator("#lblInternalBorders").click();
  await page.locator("#lblEmpireBorders").click();
  const borderWidth = page.locator("#internalBorderWidth");
  await expect(borderWidth).toBeVisible();
  const originalWidth = await borderWidth.inputValue();
  await borderWidth.focus();
  await expect(borderWidth).toBeFocused();
  await borderWidth.press("ArrowRight");
  await expect(borderWidth).not.toHaveValue(originalWidth);
  const editedWidth = await borderWidth.inputValue();
  const borderScroll = await rememberScroll(180);
  expect(borderScroll).toBeGreaterThan(0);
  await borders.click();
  await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBe(borderScroll);

  await cities.click();
  const cityScale = page.locator("#cityPointsMarkerScale");
  await expect(cityScale).toBeVisible();
  const originalScale = await cityScale.inputValue();
  await cityScale.focus();
  await expect(cityScale).toBeFocused();
  await cityScale.press("ArrowRight");
  await expect(cityScale).not.toHaveValue(originalScale);
  const editedScale = await cityScale.inputValue();
  const cityScroll = await rememberScroll(120);
  expect(cityScroll).toBeGreaterThan(0);
  await cities.click();
  await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBe(cityScroll);

  await page.locator("#inspectorSidebarTabProject").click();
  await expect(page.locator("#editorProperty-project")).toBeVisible();
  await back.click();
  await expect(page.locator("#editorProperty-data-appearance-panel-citypoints")).toBeVisible();
  await expect(page.locator("#editorProperty-project")).toBeHidden();
  await expect(cityScale).toHaveValue(editedScale);
  await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBe(cityScroll);
  await back.click();
  await expect(page.locator("#editorProperty-data-appearance-panel-borders")).toBeVisible();
  await expect(page.locator("#editorProperty-data-appearance-panel-citypoints")).toBeHidden();
  await expect(borderWidth).toHaveValue(editedWidth);
  await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBe(borderScroll);
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

test("scenario Escape closes the inner select before its disclosure and restores focus", async ({ page }) => {
  await openWorkspace(page);
  const disclosure = page.locator("#editorProjectBar .editor-scenario-menu");
  const summary = disclosure.locator("summary");
  await summary.click();
  await expect(disclosure).toHaveJSProperty("open", true);
  await summary.press("Escape");
  await expect(disclosure).toHaveJSProperty("open", false);
  await expect(summary).toBeFocused();

  await summary.click();
  const selectButton = page.locator("#scenarioSelectButton");
  const selectMenu = page.locator("#scenarioSelectMenu");
  await selectButton.click();
  await expect(selectMenu).toBeVisible();
  await expect(selectButton).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(selectMenu).toBeHidden();
  await expect(selectButton).toHaveAttribute("aria-expanded", "false");
  await expect(disclosure).toHaveJSProperty("open", true);
  await expect(selectButton).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(disclosure).toHaveJSProperty("open", false);
  await expect(summary).toBeFocused();
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

test("mobile object expansion preserves the drawer and focus while selections open properties", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await openWorkspace(page);
  const body = page.locator("body");
  const expectLeftDrawer = async () => {
    await expect(body).toHaveClass(/left-drawer-open/);
    await expect(body).not.toHaveClass(/right-drawer-open/);
  };
  await page.locator("#leftPanelToggle").click();
  await page.locator("#editorTaskObjectsBtn").click();
  await expectLeftDrawer();

  const collapsed = page.locator('#countryList .country-explorer-header[aria-expanded="false"]').first();
  await expect(collapsed).toBeVisible();
  const groupKey = await collapsed.getAttribute("data-inspector-group-key");
  expect(groupKey).toBeTruthy();
  const groupHeader = page.locator(`#countryList .country-explorer-header[data-inspector-group-key="${groupKey}"]`);
  await groupHeader.click();
  await expect(groupHeader).toHaveAttribute("aria-expanded", "true");
  await expectLeftDrawer();
  await expect(groupHeader).toBeFocused();
  const group = page.locator("#countryList .country-explorer-group").filter({
    has: page.locator(`.country-explorer-header[data-inspector-group-key="${groupKey}"]`),
  });
  const country = group.locator(".country-select-row").first();
  const countryCode = await country.getAttribute("data-country-code");
  const countryName = await country.locator(".country-select-title").textContent();
  expect(countryCode).toBeTruthy();

  // Discover an actual parent row through the same group controls the user uses.
  const headers = page.locator("#countryList .country-explorer-header");
  for (let index = 0; index < await headers.count(); index += 1) {
    if (await page.locator("#countryList .country-children-toggle").count()) break;
    const header = headers.nth(index);
    if (await header.getAttribute("aria-expanded") === "false") await header.click();
  }
  const childrenToggle = page.locator("#countryList .country-children-toggle").first();
  await expect(childrenToggle).toBeVisible();
  const parentCode = await childrenToggle.locator("xpath=ancestor::div[contains(@class, 'country-select-row')][1]").getAttribute("data-country-code");
  expect(parentCode).toBeTruthy();
  const parentToggle = page.locator(`#countryList .country-select-row[data-country-code="${parentCode}"] .country-children-toggle`).first();
  if (await parentToggle.getAttribute("aria-expanded") === "true") await parentToggle.click();
  await expect(parentToggle).toHaveAttribute("aria-expanded", "false");
  await parentToggle.click();
  await expect(parentToggle).toHaveAttribute("aria-expanded", "true");
  await expectLeftDrawer();
  await expect(parentToggle).toBeFocused();

  // A search result in a collapsed group makes the native owner rebuild the list on selection.
  await groupHeader.click();
  await expect(groupHeader).toHaveAttribute("aria-expanded", "false");
  await page.locator("#countrySearch").fill(countryCode);
  const countryButton = page.locator(`#countryList .country-select-row[data-country-code="${countryCode}"] .country-select-main-btn`).first();
  await expect(countryButton).toBeVisible();
  await countryButton.click();
  await expect(body).toHaveClass(/right-drawer-open/);
  await expect(body).not.toHaveClass(/left-drawer-open/);
  const selectedName = page.locator("#editorProperty-countries .editor-selected-name");
  await expect(selectedName).toBeVisible();
  await expect(selectedName).toHaveText(countryName.trim());
  await expect(page.locator("#editorProperty-countries #selectedCountryActionsSection")).toBeVisible();
  await expect(countryButton).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => readState(page, "selectedInspectorCountryCode")).toBe(countryCode);

  await page.locator('[data-close-drawer="right"]').click();
  await page.locator("#leftPanelToggle").click();
  await page.locator("#editorObjects-water").click();
  await expectLeftDrawer();
  const waterButton = page.locator("#waterRegionList .inspector-item-btn").first();
  await expect(waterButton).toBeVisible();
  const waterId = await waterButton.getAttribute("data-region-id");
  expect(waterId).toBeTruthy();
  await waterButton.click();
  await expect(body).toHaveClass(/right-drawer-open/);
  await expect(body).not.toHaveClass(/left-drawer-open/);
  await expect(page.locator("#editorProperty-water #waterInspectorDetail")).toBeVisible();
  await expect(page.locator("#waterInspectorMetaList")).toContainText(waterId);
  await expect.poll(() => readState(page, "selectedWaterRegionId")).toBe(waterId);
});

test("scenario summary resets its select and Tab departure closes the disclosure without stealing focus", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkspace(page);
  const disclosure = page.locator("#editorProjectBar .editor-scenario-menu");
  const summary = disclosure.locator("summary");
  const selectButton = page.locator("#scenarioSelectButton");
  const selectMenu = page.locator("#scenarioSelectMenu");
  await summary.click();
  await selectButton.click();
  await expect(selectMenu).toBeVisible();
  await expect(selectButton).toHaveAttribute("aria-expanded", "true");
  await summary.click();
  await expect(disclosure).toHaveJSProperty("open", false);
  await expect(selectButton).toHaveAttribute("aria-expanded", "false");
  await summary.click();
  await expect(disclosure).toHaveJSProperty("open", true);
  await expect(selectMenu).toBeHidden();
  await expect(selectButton).toHaveAttribute("aria-expanded", "false");

  const lastControl = disclosure.locator('button:visible:enabled:not([tabindex="-1"]), input:visible:enabled:not([tabindex="-1"])').last();
  await lastControl.focus();
  await expect(lastControl).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator("#workspaceSaveBtn")).toBeFocused();
  await expect(disclosure).toHaveJSProperty("open", false);
  await expect(selectButton).toHaveAttribute("aria-expanded", "false");
});

test("properties Back restores the layer task and its selected entry after visiting objects", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkspace(page);
  await page.locator("#editorTaskLayersBtn").click();
  for (const [entryId, propertyId, rememberedObject] of [
    ["appearanceTabCityPoints", "editorProperty-data-appearance-panel-citypoints", "countries"],
    ["editorLayer-legend", "editorProperty-legend", "water"],
  ]) {
    // Establish both a distinct object context and an already active Water
    // context through real navigation before checking the resulting history.
    await page.locator("#editorTaskObjectsBtn").click();
    await page.locator(`#editorObjects-${rememberedObject}`).click();
    await page.locator("#editorTaskLayersBtn").click();
    const entry = page.locator(`#${entryId}`);
    await entry.click();
    await expect(page.locator(`#${propertyId}`)).toBeVisible();
    await page.locator("#editorTaskObjectsBtn").click();
    await expect(page.locator(`#editorProperty-${rememberedObject}`)).toBeVisible();
    await expect(page.locator(`#editorObjects-${rememberedObject}`)).toHaveAttribute("aria-pressed", "true");
    await page.locator("#editorObjects-water").click();
    await expect(page.locator("#editorTask-objects")).toBeVisible();
    await expect(page.locator("#editorProperty-water")).toBeVisible();
    if (rememberedObject !== "water") {
      // Objects restored Countries before the explicit Water click, so Back
      // must visit that actual intermediate entry before returning to Layers.
      await page.locator("#editorPropertiesBackBtn").click();
      await expect(page.locator(`#editorProperty-${rememberedObject}`)).toBeVisible();
      await expect(page.locator("#editorProperty-water")).toBeHidden();
      await expect(page.locator("#editorTask-objects")).toBeVisible();
      await expect(page.locator("#editorTask-layers")).toBeHidden();
      await expect(page.locator("#editorTaskObjectsBtn")).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("#editorTaskLayersBtn")).toHaveAttribute("aria-pressed", "false");
      await expect(page.locator(`#editorObjects-${rememberedObject}`)).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("#editorPropertiesTitle")).toBeFocused();
    }
    await page.locator("#editorPropertiesBackBtn").click();
    await expect(page.locator(`#${propertyId}`)).toBeVisible();
    await expect(page.locator("#editorProperty-water")).toBeHidden();
    await expect(page.locator("#editorTask-layers")).toBeVisible();
    await expect(page.locator("#editorTask-objects")).toBeHidden();
    await expect(page.locator("#editorTaskLayersBtn")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#editorTaskObjectsBtn")).toHaveAttribute("aria-pressed", "false");
    await expect(entry).toBeVisible();
    await expect(entry).toHaveAttribute(entryId === "appearanceTabCityPoints" ? "aria-selected" : "aria-pressed", "true");
    await expect(page.locator("#editorPropertiesTitle")).toBeFocused();
  }
});

test("legend URL reload restores its layer task and property without entering annotation mode", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem("map_lang", "en"));
  await openWorkspace(page);
  await page.locator("#editorTaskLayersBtn").click();
  await page.locator("#editorLayer-legend").click();
  await expect(page.locator("#editorProperty-legend")).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("section")).toBe("legendProjectSection");
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);
  await expect(page.locator("#editorTask-layers")).toBeVisible();
  await expect(page.locator("#editorTaskLayersBtn")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#editorLayer-legend")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#editorProperty-legend")).toBeVisible();
  await expect(page.locator("#editorProperty-countries")).toBeHidden();
  await expect(page.locator("body")).not.toHaveClass(/frontline-mode-active/);

  const generator = page.locator("#editorProperty-legend .legend-generator-card");
  const modeTrigger = generator.locator(".app-select-button").first();
  const continentTrigger = generator.locator(".app-select-button").nth(1);
  await expect(modeTrigger).toBeVisible();
  await expect(modeTrigger).toHaveAccessibleName("Generation Mode");
  await modeTrigger.click();
  await generator.getByRole("option", { name: "Continent Focus", exact: true }).click();
  await expect(modeTrigger.locator(".app-select-text")).toHaveText("Continent Focus");
  await expect(continentTrigger).toBeVisible();
  await expect(continentTrigger).toHaveAccessibleName("Continent");
  await page.locator("#btnToggleLang").click();
  await expect.poll(() => readState(page, "currentLanguage")).toBe("zh");
  await expect(modeTrigger).toHaveAccessibleName("生成模式");
  await expect(continentTrigger).toBeVisible();
  await expect(continentTrigger).toHaveAccessibleName("大洲");
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
