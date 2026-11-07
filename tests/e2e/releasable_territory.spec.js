const { test, expect } = require("@playwright/test");
const { openApp } = require("./golden/golden-support");

test.setTimeout(180000);

async function selectCountry(page, tag) {
  await page.locator("#countrySearch").fill(tag);
  await page.locator(`.country-select-row[data-country-code="${tag}"] .country-select-main-btn`).click();
}

async function colors(page) {
  return page.evaluate(() => window.__scenarioForgeTestApi.editedFeatureColors());
}

async function historyLength(page) {
  return page.evaluate(() => window.__scenarioForgeTestApi.history().undo);
}

async function countryColor(page) {
  return page.locator("#countryInspectorColorInput").inputValue();
}

test("territory variants and companion colors each undo as one transaction", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("map_lang", "en"));
  await openApp(page, { scenarioId: "tno_1962" });
  if (!(await page.locator("#inspectorSidebarTabInspector").isVisible())) {
    await page.locator("#rightPanelToggle").click();
  }
  await page.locator("#inspectorSidebarTabInspector").click();
  await page.locator("#countryInspectorSection").evaluate(element => { element.open = true; });
  await selectCountry(page, "BRG");
  const brgColor = await countryColor(page);
  const initial = await colors(page);
  const startHistory = await historyLength(page);
  const variant = page.getByRole("combobox", { name: "Boundary variant", exact: true });
  const apply = page.getByRole("button", { name: "Apply territory", exact: true });
  await variant.selectOption("fbw_expanded");
  expect(await historyLength(page)).toBe(startHistory);
  await apply.click();
  await expect.poll(() => historyLength(page)).toBe(startHistory + 1);
  const expanded = await colors(page);
  expect(expanded.FR_ARR_57003).toBe(brgColor);
  await variant.selectOption("current_tno_initial");
  await apply.click();
  await expect.poll(() => historyLength(page)).toBe(startHistory + 2);
  expect(await colors(page)).not.toHaveProperty("FR_ARR_57003");
  await page.locator("#undoBtn").click();
  await expect.poll(() => colors(page)).toEqual(expanded);
  await page.locator("#undoBtn").click();
  await expect.poll(() => colors(page)).toEqual(initial);

  await selectCountry(page, "ITA");
  const italyColor = await countryColor(page);
  await selectCountry(page, "CRO");
  const croatiaColor = await countryColor(page);
  const beforeCroatia = await colors(page);
  const beforeHistory = await historyLength(page);
  await expect(page.locator(".scenario-visual-adjustments input[type=checkbox]")).toBeChecked();
  await apply.click();
  await expect.poll(() => historyLength(page)).toBe(beforeHistory + 1);
  const painted = await colors(page);
  expect(painted.HR033).toBe(italyColor);
  expect(painted.HR021).toBe(croatiaColor);
  await page.locator("#undoBtn").click();
  await expect.poll(() => colors(page)).toEqual(beforeCroatia);
});
