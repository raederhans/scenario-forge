const { test, expect } = require("@playwright/test");
const { openApp } = require("./golden/golden-support");

test("TNO Atlantropa project opens and closes the Suez Canal card", async ({ page }) => {
  test.setTimeout(180_000);
  await openApp(page, { scenarioId: "tno_1962" });
  await page.locator("#toolSelectBtn").click();
  const point = await page.evaluate(() => window.__scenarioForgeTestApi.screenPointForLonLat(32.35, 30.60));
  expect(point).toBeTruthy();
  await page.mouse.click(point.x, point.y);
  await expect(page.locator("#facilityInfoCard")).toBeVisible();
  await expect(page.locator("#facilityInfoCardTitle")).toHaveText("Suez Canal");
  await page.locator("#facilityInfoCardCloseBtn").click();
  await expect(page.locator("#facilityInfoCard")).toBeHidden();
});
