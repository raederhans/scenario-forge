const { test, expect } = require("@playwright/test");
const { gotoApp } = require("./support/playwright-app");

const raw = "https://example.test/p.json";
const payload = { schemaVersion: 22, projectName: "Shared atlas", scenario: null };
test.setTimeout(180_000);

for (const confirm of [true, false]) {
  test(confirm ? "open a shared project and save a copy" : "cancel a shared project without fetching it", async ({ page, context }) => {
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
      window.showSaveFilePicker = async options => {
        window.sharedCopyName = options.suggestedName;
        throw new DOMException("Cancelled", "AbortError");
      };
    }, confirm);
    await gotoApp(page, "/app/?" + new URLSearchParams({
      project: raw, default_scenario: "blank_base", sample: "tno-1962-atlantropa-briefing",
    }), { waitUntil: "domcontentloaded" });
    const dialog = page.locator(".app-dialog");
    await expect(dialog).toContainText("example.test", { timeout: 120_000 });
    expect(requests).toBe(0);
    expect(new URL(page.url()).searchParams.has("sample")).toBe(false);
    await dialog.locator(confirm ? "[data-dialog-confirm]" : "[data-dialog-cancel]").click();
    await expect.poll(() => new URL(page.url()).searchParams.has("project"), { timeout: 60_000 }).toBe(false);
    expect(new URL(page.url()).searchParams.has("default_scenario")).toBe(false);
    expect(await page.evaluate(() => localStorage.getItem("map_last_scenario"))).toBe("tno_1962");
    expect(requests).toBe(confirm ? 1 : 0);
    if (confirm) {
      await expect(dialog).toContainText(/unsaved project|未保存/i, { timeout: 60_000 });
      await dialog.locator("[data-dialog-cancel]").click();
      await page.locator("#inspectorSidebarTabProject").click();
      await expect(page.locator("#sampleProjectBanner")).toContainText("example.test");
      const original = page.locator("#sampleProjectBannerDownloadOriginalLink");
      await expect(original).toHaveAttribute("download", "p.json");
      await expect(original).toHaveAttribute("href", /^blob:/);
      expect(await original.evaluate(async link => (await fetch(link.href)).json())).toEqual(payload);
      await page.locator("#sharedProjectSaveCopyBtn").click();
      await expect.poll(() => page.evaluate(() => window.sharedCopyName)).toMatch(/Shared atlas.*\.json$/);
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      const input = page.locator("#sharedProjectRawUrl");
      if (!await input.isVisible()) await page.locator("details:has(> #sharedProjectRawUrl) > summary").click();
      await input.fill(raw);
      await page.locator("details:has(> #sharedProjectRawUrl) > button").click();
      await expect.poll(() => page.evaluate(async () => {
        const text = await navigator.clipboard.readText();
        return text && new URL(text).searchParams.get("project");
      })).toBe(raw);
    } else {
      await expect(page.locator("#sampleProjectBanner")).toBeHidden();
    }
  });
}
