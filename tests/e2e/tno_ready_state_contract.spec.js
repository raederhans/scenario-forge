const { test, expect } = require("@playwright/test");
const { gotoApp } = require("./support/playwright-app");

const TNO_READY_PATH = "/?render_profile=balanced&startup_interaction=readonly&startup_worker=1&startup_cache=1&default_scenario=tno_1962";

async function readTnoRuntime(page) {
  return page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    return {
      activeScenarioId: String(state.activeScenarioId || ""),
      startupReadonly: !!state.startupReadonly,
      startupReadonlyUnlockInFlight: !!state.startupReadonlyUnlockInFlight,
      scenarioApplyInFlight: !!state.scenarioApplyInFlight,
      detailPromotionCompleted: !!state.detailPromotionCompleted,
      topologyBundleMode: String(state.topologyBundleMode || ""),
      scenarioStatus: String(document.querySelector("#scenarioStatus")?.textContent || ""),
      scenarioHydrationHealthGate: state.scenarioHydrationHealthGate
        ? {
          status: String(state.scenarioHydrationHealthGate.status || ""),
          reason: String(state.scenarioHydrationHealthGate.reason || ""),
        }
        : null,
      scenarioFatalRecovery: state.scenarioFatalRecovery
        ? {
          phase: String(state.scenarioFatalRecovery.phase || ""),
          message: String(state.scenarioFatalRecovery.message || ""),
        }
        : null,
      overlayState: {
        hasScenarioWaterRegions: !!state.scenarioWaterRegionsData,
        hasScenarioLandMask: !!state.scenarioLandMaskData,
        hasScenarioContextLandMask: !!state.scenarioContextLandMaskData,
      },
    };
  });
}

async function waitForTnoReady(page, { timeout = 120000 } = {}) {
  await expect.poll(async () => readTnoRuntime(page), { timeout }).toMatchObject({
    activeScenarioId: "tno_1962",
    startupReadonly: false,
    startupReadonlyUnlockInFlight: false,
    scenarioApplyInFlight: false,
    detailPromotionCompleted: true,
    topologyBundleMode: "composite",
  });
}

test("TNO startup reaches editable composite-ready state without stale coarse warning", async ({ page }) => {
  test.setTimeout(240000);
  await gotoApp(page, TNO_READY_PATH, { waitUntil: "domcontentloaded" });
  await waitForTnoReady(page);

  const runtime = await readTnoRuntime(page);
  expect(runtime.scenarioFatalRecovery).toBeNull();
  expect(runtime.scenarioStatus).toContain("TNO 1962");
  expect(runtime.scenarioStatus).not.toContain("coarse mode");
});

test("overlay-only hydration mismatch degrades overlays without restoring startup readonly", async ({ page }) => {
  test.setTimeout(240000);
  await gotoApp(page, TNO_READY_PATH, { waitUntil: "domcontentloaded" });
  await waitForTnoReady(page);

  const result = await page.evaluate(async () => {
    globalThis.__scenarioTestHooks = {
      ...(globalThis.__scenarioTestHooks || {}),
      forceHydrationHealthGateMaskMismatchOnce: true,
    };
    const { state } = await import("/js/core/state.js");
    const { enforceScenarioHydrationHealthGate } = await import("/js/core/scenario_resources.js");
    const gateResult = await enforceScenarioHydrationHealthGate({
      renderNow: false,
      reason: "playwright-mask-mismatch",
      autoRetry: false,
    });
    return {
      gateResult,
      startupReadonly: !!state.startupReadonly,
      startupReadonlyReason: String(state.startupReadonlyReason || ""),
      scenarioHydrationHealthGate: state.scenarioHydrationHealthGate
        ? {
          status: String(state.scenarioHydrationHealthGate.status || ""),
          reason: String(state.scenarioHydrationHealthGate.reason || ""),
        }
        : null,
      scenarioFatalRecovery: state.scenarioFatalRecovery
        ? {
          phase: String(state.scenarioFatalRecovery.phase || ""),
          message: String(state.scenarioFatalRecovery.message || ""),
        }
        : null,
      scenarioStatus: String(document.querySelector("#scenarioStatus")?.textContent || ""),
      overlayState: {
        hasScenarioWaterRegions: !!state.scenarioWaterRegionsData,
        hasScenarioLandMask: !!state.scenarioLandMaskData,
        hasScenarioContextLandMask: !!state.scenarioContextLandMaskData,
      },
    };
  });

  expect(result.gateResult.ok).toBe(false);
  expect(result.startupReadonly).toBe(false);
  expect(result.startupReadonlyReason).toBe("");
  expect(result.scenarioHydrationHealthGate).toEqual({
    status: "degraded",
    reason: "runtime-overlay-context-land-mask-version-mismatch",
  });
  expect(result.scenarioFatalRecovery).toBeNull();
  expect(result.scenarioStatus).toContain("Overlay fallback active");
  expect(result.overlayState).toEqual({
    hasScenarioWaterRegions: false,
    hasScenarioLandMask: false,
    hasScenarioContextLandMask: false,
  });
});
