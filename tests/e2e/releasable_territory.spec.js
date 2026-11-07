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

// Same precedence as the sidebar's getResolvedCountryColor (scenario base color first).
async function countryColor(page, tag) {
  return page.evaluate(async (code) => {
    const { state } = await import("/js/core/state.js");
    return String(state.sovereignBaseColors?.[code] || state.countryPalette?.[code] || "").toLowerCase();
  }, tag);
}

test("territory variants and companion colors each undo as one transaction", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("map_lang", "en"));
  await openApp(page, { scenarioId: "tno_1962" });
  // Same route as tno_1962_ui_smoke: the right drawer is opened through the shell's toggle function.
  await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    state.toggleRightPanelFn?.(true);
    document.querySelector("#inspectorSidebarTabInspector")?.click();
    const section = document.querySelector("#countryInspectorSection");
    if (section instanceof HTMLDetailsElement) section.open = true;
  });
  await expect(page.locator("#inspectorSidebarTabInspector")).toHaveAttribute("aria-selected", "true");
  await selectCountry(page, "BRG");
  const brgColor = await countryColor(page, "BRG");
  const initial = await colors(page);
  const startHistory = await historyLength(page);
  // The app wraps native selects in a styled shell, so address the native element directly.
  const variant = page.locator('#rightSidebar select[aria-label="Boundary variant"]');
  const apply = page.getByRole("button", { name: "Apply territory", exact: true });
  await variant.selectOption("fbw_expanded", { force: true });
  expect(await historyLength(page)).toBe(startHistory);
  await apply.click();
  await expect.poll(() => historyLength(page)).toBe(startHistory + 1);
  const expanded = await colors(page);
  expect(expanded.FR_ARR_57003).toBe(brgColor);
  await variant.selectOption("current_tno_initial", { force: true });
  await apply.click();
  await expect.poll(() => historyLength(page)).toBe(startHistory + 2);
  expect(await colors(page)).not.toHaveProperty("FR_ARR_57003");
  await page.locator("#undoBtn").click();
  await expect.poll(() => colors(page)).toEqual(expanded);
  await page.locator("#undoBtn").click();
  await expect.poll(() => colors(page)).toEqual(initial);

  await selectCountry(page, "ITA");
  const italyColor = await countryColor(page, "ITA");
  await selectCountry(page, "CRO");
  const croatiaColor = await countryColor(page, "CRO");
  const beforeCroatia = await colors(page);
  const beforeHistory = await historyLength(page);
  await expect(page.locator('#rightSidebar input.checkbox-input[value="dalmatia_kotor_to_ita"]')).toBeChecked();
  await apply.click();
  await expect.poll(() => historyLength(page)).toBe(beforeHistory + 1);
  const painted = await colors(page);
  expect(painted.HR033).toBe(italyColor);
  expect(painted.HR021).toBe(croatiaColor);
  await page.locator("#undoBtn").click();
  await expect.poll(() => colors(page)).toEqual(beforeCroatia);
});
