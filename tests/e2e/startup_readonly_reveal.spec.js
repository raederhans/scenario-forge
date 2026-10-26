const { test, expect } = require("@playwright/test");
const { PERF_BUDGETS } = require("./golden/golden-budgets");

test("default startup shows peek and a readonly map before becoming editable", async ({ page }) => {
  test.setTimeout(PERF_BUDGETS.startupMs * 2);
  await page.setViewportSize({ width: 1440, height: 900 });
  const startedAt = Date.now();
  await page.goto("/app/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => globalThis.__scenarioForgeTestApi, null,
    { timeout: Math.max(1, PERF_BUDGETS.viewableMs - (Date.now() - startedAt)) });
  await page.evaluate(({ startedAt, viewableMs }) => {
    const probe = window.__readonlyProbe = { sawBlockingPeek: false };
    const sample = () => {
      const status = window.__scenarioForgeTestApi.status();
      if (status.blocking && document.getElementById("bootOverlay")?.classList.contains("is-peek")) {
        probe.sawBlockingPeek = true;
      }
    };
    sample();
    probe.timer = setInterval(() => {
      if (Date.now() - startedAt >= viewableMs) {
        clearInterval(probe.timer);
        return;
      }
      sample();
    }, 100);
  }, { startedAt, viewableMs: PERF_BUDGETS.viewableMs });

  const readonlyHandle = await page.waitForFunction((startedAt) => {
    const { viewable, editable, phase, blocking, startupReadonly } = window.__scenarioForgeTestApi.status();
    const banner = document.getElementById("startupReadonlyBanner");
    const snapshot = {
      viewable,
      editable,
      bannerVisible: !!banner && !banner.hasAttribute("hidden")
        && !banner.classList.contains("hidden") && getComputedStyle(banner).display !== "none",
      booting: document.body.classList.contains("app-booting"),
      phase,
      blocking,
      startupReadonly,
      elapsedMs: Date.now() - startedAt,
    };
    return viewable && !editable ? snapshot : false;
  }, startedAt, { timeout: Math.max(1, PERF_BUDGETS.viewableMs - (Date.now() - startedAt)) });
  const readonly = await readonlyHandle.jsonValue();
  await readonlyHandle.dispose();
  expect(readonly.bannerVisible).toBe(true);
  expect(readonly.booting).toBe(false);
  expect(readonly.startupReadonly).toBe(true);
  expect(readonly.blocking).toBe(false);
  expect(readonly.phase).toBe("interaction-infra");
  expect(readonly.elapsedMs).toBeLessThanOrEqual(PERF_BUDGETS.viewableMs);

  const editableHandle = await page.waitForFunction((startedAt) => {
    const status = window.__scenarioForgeTestApi.status();
    return status.editable ? { elapsedMs: Date.now() - startedAt } : false;
  }, startedAt, { timeout: Math.max(1, PERF_BUDGETS.startupMs - (Date.now() - startedAt)) });
  const editable = await editableHandle.jsonValue();
  await editableHandle.dispose();
  expect(editable.elapsedMs).toBeLessThanOrEqual(PERF_BUDGETS.startupMs);
  const sawBlockingPeek = await page.evaluate(() => {
    clearInterval(window.__readonlyProbe.timer);
    return window.__readonlyProbe.sawBlockingPeek;
  });
  expect(sawBlockingPeek).toBe(true);

  await expect.poll(async () => {
    const status = await page.evaluate(() => window.__scenarioForgeTestApi.status());
    const chunks = status.chunks;
    return status.settled && chunks.idle && !chunks.pendingReason
      && chunks.requiredChunkIds.length > 0
      && chunks.requiredChunkIds.every((id) => chunks.loadedChunkIds.includes(id));
  }, { timeout: PERF_BUDGETS.startupMs }).toBe(true);
  expect(await page.evaluate(() => window.__scenarioForgeTestApi.history())).toEqual({ undo: 0, redo: 0 });
});
