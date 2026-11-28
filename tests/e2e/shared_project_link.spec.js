const { test, expect } = require("@playwright/test");
const { gotoApp } = require("./support/playwright-app");

const raw = "https://example.test/p.json";
const payload = { schemaVersion: 22, projectName: "Shared atlas", scenario: null };
test.setTimeout(180_000);

for (const confirm of [true, false]) {
  test(confirm ? "confirming retrieves the shared original" : "cancelling preserves the previous project preference", async ({ page }) => {
    let requests = 0;
    await page.route(raw, route => {
      requests++;
      return route.fulfill({ json: payload, headers: { "Access-Control-Allow-Origin": "*" } });
    });
    await page.addInitScript(seedHistory => {
      localStorage.setItem("map_last_scenario", "tno_1962");
      if (seedHistory) {
        const request = indexedDB.open("scenario-forge-autosave", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("snapshots", { keyPath: "scenarioId" });
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("snapshots", "readwrite");
          tx.objectStore("snapshots").put({ scenarioId: "tno_1962", type: "auto", savedAt: Date.now(),
            projectName: "Previous atlas", payload: new Blob(["{}"]) });
          tx.oncomplete = () => db.close();
        };
      }
    }, confirm);
    await gotoApp(page, "/app/?" + new URLSearchParams({
      project: raw, default_scenario: "blank_base", sample: "tno-1962-atlantropa-briefing",
    }), { waitUntil: "domcontentloaded" });
    const dialog = page.locator(".app-dialog");
    await dialog.waitFor({ timeout: 120_000 });
    expect(requests).toBe(0);
    await dialog.locator(confirm ? "[data-dialog-confirm]" : "[data-dialog-cancel]").click();
    await expect.poll(() => new URL(page.url()).searchParams.has("project"), { timeout: 60_000 }).toBe(false);
    expect(await page.evaluate(() => localStorage.getItem("map_last_scenario"))).toBe("tno_1962");
    expect(requests).toBe(confirm ? 1 : 0);
    if (confirm) {
      await expect(dialog).toContainText(/unsaved project|未保存/i, { timeout: 60_000 });
      await dialog.locator("[data-dialog-cancel]").click();
      await page.locator("#inspectorSidebarTabProject").click();
      const original = page.locator("#sampleProjectBannerDownloadOriginalLink");
      await expect(original).toHaveAttribute("href", /^blob:/);
      expect(await original.evaluate(async link => (await fetch(link.href)).json())).toEqual(payload);
    }
  });
}
