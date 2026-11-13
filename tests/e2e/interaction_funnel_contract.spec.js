const { test, expect } = require("@playwright/test");
const { gotoApp, waitForAppInteractive } = require("./support/playwright-app");

test.setTimeout(90_000);

async function installStateHandle(page) {
  await page.evaluate(async () => {
    globalThis.__pwInteractionFunnel = {
      state: (await import("/js/core/state.js")).state,
    };
  });
}

async function waitForStartupReadonlyUnlocked(page, { timeout = 120000, stableMs = 300 } = {}) {
  await installStateHandle(page);
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
  await waitForAppInteractive(page, { timeout: 45_000 });
}

async function waitForProjectUiReady(page) {
  await installStateHandle(page);
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
  await installStateHandle(page);
  await page.waitForFunction(() => {
    const state = globalThis.__pwInteractionFunnel?.state;
    return !state?.scenarioApplyInFlight;
  }, { timeout: 120_000 });
}

test("render boundary contract routes scenario dispatcher render modes", async ({ page }) => {
  await gotoAppReady(page);
  await waitForProjectUiReady(page);
  await waitForScenarioIdle(page);

  const result = await page.evaluate(async () => {
    const { bindRenderBoundary, getRenderBoundaryDebugState } = await import("/js/core/render_boundary.js");
    const { clearActiveScenarioCommand } = await import("/js/core/scenario_dispatcher.js");

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

    clearActiveScenarioCommand({
      renderMode: "none",
      markDirtyReason: "",
    });
    const afterNone = {
      scheduleCount: scheduleCalls.length,
      flushCount: flushCalls.length,
    };

    clearActiveScenarioCommand({
      renderMode: "request",
      markDirtyReason: "",
    });
    const afterRequest = {
      scheduleCount: scheduleCalls.length,
      flushCount: flushCalls.length,
      debug: getRenderBoundaryDebugState(),
    };

    clearActiveScenarioCommand({
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
  expect(result.afterRequest.debug.pendingReasons).toContain("scenario-clear");
  expect(result.afterFlush.scheduleCount).toBe(1);
  expect(result.afterFlush.flushCount).toBe(1);
  expect(result.flushCalls[0].reason).toBe("scenario-clear");
  expect(result.afterFlush.debug.lastFlushReason).toBe("scenario-clear");
});

