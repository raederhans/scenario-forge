const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { gotoApp, waitForAppInteractive } = require("./support/playwright-app");

test.setTimeout(90_000);

async function installTestHandles(page) {
  await page.evaluate(async () => {
    globalThis.__pwInteractionFunnel = {
      state: (await import("/js/core/state.js")).state,
      getInteractionFunnelDebugState: (await import("/js/core/interaction_funnel.js")).getInteractionFunnelDebugState,
    };
  });
}

async function waitForStartupReadonlyUnlocked(page, { timeout = 120000, stableMs = 300 } = {}) {
  await installTestHandles(page);
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const unlocked = await page.evaluate(() => {
      const state = globalThis.__pwInteractionFunnel?.state;
      return !!state && !state.startupReadonly && !state.startupReadonlyUnlockInFlight;
    });
    if (unlocked) {
      await page.waitForTimeout(stableMs);
      const stillUnlocked = await page.evaluate(() => {
        const state = globalThis.__pwInteractionFunnel?.state;
        return !!state && !state.startupReadonly && !state.startupReadonlyUnlockInFlight;
      });
      if (stillUnlocked) {
        return;
      }
    } else {
      await page.waitForTimeout(150);
    }
  }
  throw new Error("Startup readonly did not unlock before the test timed out.");
}

async function gotoAppReady(page, targetPath = "/") {
  await gotoApp(page, targetPath, { waitUntil: "domcontentloaded" });
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await waitForAppInteractive(page, { timeout: 45_000 });
      return;
    } catch (error) {
      lastError = error;
      const retryVisible = await page
        .locator("#bootRetryBtn")
        .isVisible()
        .catch(() => false);
      if (!retryVisible || attempt === 2) {
        throw lastError;
      }
      await page.locator("#bootRetryBtn").click();
    }
  }
  throw lastError;
}

async function waitForProjectUiReady(page) {
  await installTestHandles(page);
  await page.waitForFunction(() => {
    const state = globalThis.__pwInteractionFunnel?.state;
    const uploadBtn = document.querySelector("#uploadProjectBtn");
    const uploadInput = document.querySelector("#projectFileInput");
    const scenarioSelect = document.querySelector("#scenarioSelect");
    return !!uploadBtn
      && !!uploadInput
      && !!scenarioSelect
      && scenarioSelect.querySelectorAll("option").length > 0
      && !state.startupReadonly
      && !!globalThis.d3?.json
      && typeof state.renderCountryListFn === "function";
  }, { timeout: 120_000 });
  await waitForStartupReadonlyUnlocked(page);
}

async function waitForScenarioIdle(page) {
  await installTestHandles(page);
  await page.waitForFunction(() => {
    const state = globalThis.__pwInteractionFunnel?.state;
    return !state?.scenarioApplyInFlight;
  }, { timeout: 120_000 });
}

async function exportProjectJson(page, outputPath) {
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#downloadProjectBtn").evaluate((button) => button.click());
  const download = await downloadPromise;
  await download.saveAs(outputPath);
  return JSON.parse(fs.readFileSync(outputPath, "utf8"));
}

test("render boundary contract routes scenario dispatcher render modes", async ({ page }) => {
  await gotoAppReady(page);
  await waitForProjectUiReady(page);
  await waitForScenarioIdle(page);

  const result = await page.evaluate(async () => {
    const { bindRenderBoundary, getRenderBoundaryDebugState } = await import("/js/core/render_boundary.js");
    const { setScenarioViewModeCommand } = await import("/js/core/scenario_dispatcher.js");

    const scheduleCalls = [];
    const flushCalls = [];

    bindRenderBoundary({
      scheduleRender(payload = {}) {
        scheduleCalls.push({
          reason: String(payload.reason || ""),
          reasons: Array.isArray(payload.reasons) ? [...payload.reasons] : [],
        });
      },
      flushRender(payload = {}) {
        flushCalls.push({
          reason: String(payload.reason || ""),
        });
      },
    });

    setScenarioViewModeCommand("frontline", {
      renderMode: "none",
      markDirtyReason: "",
    });
    const afterNone = {
      scheduleCount: scheduleCalls.length,
      flushCount: flushCalls.length,
    };

    setScenarioViewModeCommand("ownership", {
      renderMode: "request",
      markDirtyReason: "",
    });
    const afterRequest = {
      scheduleCount: scheduleCalls.length,
      flushCount: flushCalls.length,
      debug: getRenderBoundaryDebugState(),
    };

    setScenarioViewModeCommand("frontline", {
      renderMode: "flush",
      markDirtyReason: "",
    });

    return {
      afterNone,
      afterRequest,
      afterFlush: {
        scheduleCount: scheduleCalls.length,
        flushCount: flushCalls.length,
        debug: getRenderBoundaryDebugState(),
      },
      scheduleCalls,
      flushCalls,
    };
  });

  expect(result.afterNone).toEqual({
    scheduleCount: 0,
    flushCount: 0,
  });
  expect(result.afterRequest.scheduleCount).toBe(1);
  expect(result.afterRequest.flushCount).toBe(0);
  expect(result.afterRequest.debug.pendingReasons).toContain("scenario-view:ownership");
  expect(result.afterFlush.scheduleCount).toBe(1);
  expect(result.afterFlush.flushCount).toBe(1);
  expect(result.flushCalls[0].reason).toBe("scenario-view:frontline");
  expect(result.afterFlush.debug.lastFlushReason).toBe("scenario-view:frontline");
});

test("upload button dirty confirm and import path go through interaction funnel", async ({ page }) => {
  const artifactDir = path.join(".runtime", "tests", "playwright", "interaction-funnel");
  fs.mkdirSync(artifactDir, { recursive: true });
  const exportPath = path.join(artifactDir, "interaction-funnel-import.json");

  await gotoAppReady(page);
  await waitForProjectUiReady(page);
  await waitForScenarioIdle(page);
  await exportProjectJson(page, exportPath);

  await page.evaluate(async () => {
    const { resetInteractionFunnelDebugState } = await import("/js/core/interaction_funnel.js");
    resetInteractionFunnelDebugState();
  });
  await page.evaluate(async () => {
    const { markDirty } = await import("/js/core/dirty_state.js");
    markDirty("playwright-import-dirty");
  });
  await installTestHandles(page);
  await page.waitForFunction(() => {
    const state = globalThis.__pwInteractionFunnel?.state;
    return !!state?.isDirty;
  }, { timeout: 30_000 });

  await page.locator("#uploadProjectBtn").evaluate((button) => button.click());
  await expect(page.locator("[data-app-dialog-overlay='true']")).toBeVisible();
  await page.locator("[data-dialog-confirm='true']").click();
  await page.locator("#projectFileInput").setInputFiles(exportPath);

  await installTestHandles(page);
  await page.waitForFunction(({ expectedFileName }) => {
    const debug = globalThis.__pwInteractionFunnel?.getInteractionFunnelDebugState?.();
    return debug.importStartCount >= 1
      && debug.importApplyCount >= 1
      && debug.importPhase === "complete"
      && !debug.lastImportError
      && debug.lastImportFileName === expectedFileName
      && !!document.querySelector("#projectFileName")?.textContent;
  }, {
    expectedFileName: path.basename(exportPath),
  }, { timeout: 120_000 });

  const snapshot = await page.evaluate(async () => {
    const { getInteractionFunnelDebugState } = await import("/js/core/interaction_funnel.js");
    return {
      debug: getInteractionFunnelDebugState(),
      projectFileName: document.querySelector("#projectFileName")?.textContent || "",
    };
  });

  expect(snapshot.debug.importStartCount).toBe(1);
  expect(snapshot.debug.importApplyCount).toBe(1);
  expect(snapshot.debug.importPhase).toBe("complete");
  expect(snapshot.debug.lastImportError).toBe("");
  expect(snapshot.debug.lastImportFileName).toBe(path.basename(exportPath));
  expect(snapshot.projectFileName).toBe(path.basename(exportPath));
});

test("map interaction layer click and dblclick bindings dispatch through interaction funnel", async ({ page }) => {
  await gotoAppReady(page);
  await waitForProjectUiReady(page);
  await page.waitForFunction(() => !!document.querySelector("rect.interaction-layer"), {
    timeout: 60_000,
  });

  await page.evaluate(async () => {
    const {
      bindInteractionFunnel,
      resetInteractionFunnelDebugState,
    } = await import("/js/core/interaction_funnel.js");
    resetInteractionFunnelDebugState();
    globalThis.__interactionFunnelClickContext = null;
    globalThis.__interactionFunnelDoubleClickContext = null;
    bindInteractionFunnel({
      mapClick: async (_event, context) => {
        globalThis.__interactionFunnelClickContext = { ...context };
        return true;
      },
      mapDoubleClick: async (_event, context) => {
        globalThis.__interactionFunnelDoubleClickContext = { ...context };
        return true;
      },
    });
  });

  await page.locator("rect.interaction-layer").evaluate((node) => {
    node.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      detail: 1,
      ctrlKey: true,
      shiftKey: true,
    }));
  });
  await page.locator("rect.interaction-layer").evaluate((node) => {
    node.dispatchEvent(new MouseEvent("dblclick", {
      bubbles: true,
      cancelable: true,
      detail: 2,
      altKey: true,
    }));
  });

  const snapshot = await page.evaluate(async () => {
    const { getInteractionFunnelDebugState } = await import("/js/core/interaction_funnel.js");
    return {
      debug: getInteractionFunnelDebugState(),
      clickContext: globalThis.__interactionFunnelClickContext,
      doubleClickContext: globalThis.__interactionFunnelDoubleClickContext,
    };
  });

  expect(snapshot.debug.clickCount).toBe(1);
  expect(snapshot.debug.doubleClickCount).toBe(1);
  expect(snapshot.clickContext).toMatchObject({
    kind: "click",
    detail: 1,
    ctrlKey: true,
    shiftKey: true,
  });
  expect(snapshot.doubleClickContext).toMatchObject({
    kind: "dblclick",
    detail: 2,
    altKey: true,
  });
});
