const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { gotoApp, waitForAppInteractive } = require("./support/playwright-app");

const DEFAULT_STARTUP_PATH = "/?render_profile=balanced&startup_interaction=readonly&startup_worker=1&startup_cache=1";

async function readStartupRuntime(page) {
  return page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    return {
      activeScenarioId: String(state.activeScenarioId || ""),
      startupReadonly: !!state.startupReadonly,
      startupReadonlyReason: String(state.startupReadonlyReason || ""),
      scenarioHydrationHealthGate: state.scenarioHydrationHealthGate
        ? {
          status: String(state.scenarioHydrationHealthGate.status || ""),
          reason: String(state.scenarioHydrationHealthGate.reason || ""),
        }
        : null,
      scenarioBundleMetric: state.bootMetrics?.["scenario-bundle"] || null,
      scenarioApplyMetric: state.bootMetrics?.["scenario-apply"] || null,
      overlayState: {
        hasScenarioWaterRegions: !!state.scenarioWaterRegionsData,
        hasScenarioLandMask: !!state.scenarioLandMaskData,
        hasScenarioContextLandMask: !!state.scenarioContextLandMaskData,
      },
    };
  });
}

test("chunked-coarse startup falls back to legacy bootstrap when runtime shell contract is missing", async ({ page }) => {
  test.setTimeout(240000);
  await page.route("**/data/scenarios/tno_1962/startup.bundle.en.json.gz*", async (route) => {
    const payload = JSON.parse(fs.readFileSync(STARTUP_BUNDLE_EN_PATH, "utf8"));
    delete payload?.scenario?.runtime_topology_bootstrap;
    delete payload?.scenario?.runtime_political_meta;
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "application/gzip",
        "content-encoding": "gzip",
        "cache-control": "no-cache",
      },
      body: zlib.gzipSync(Buffer.from(JSON.stringify(payload), "utf8")),
    });
  });

  await gotoApp(page, DEFAULT_STARTUP_PATH, { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page, { timeout: 120000 });

  const runtime = await readStartupRuntime(page);
  expect(runtime.activeScenarioId).toBe("tno_1962");
  expect(runtime.startupReadonly).toBe(false);
  expect(runtime.scenarioBundleMetric?.source).toBe("legacy");
  expect(runtime.scenarioApplyMetric?.source).toBe("legacy");
});

test("startup apply health gate falls back to legacy bootstrap recovery when owner overlap is broken", async ({ page }) => {
  test.setTimeout(240000);
  await page.addInitScript(() => {
    globalThis.__scenarioTestHooks = {
      ...(globalThis.__scenarioTestHooks || {}),
      forceStartupHealthGateOwnerMismatchOnce: true,
    };
  });

  await gotoApp(page, DEFAULT_STARTUP_PATH, { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page, { timeout: 120000 });

  const runtime = await readStartupRuntime(page);
  expect(runtime.activeScenarioId).toBe("tno_1962");
  expect(runtime.startupReadonly).toBe(false);
  expect(runtime.scenarioApplyMetric?.source).toBe("legacy-bootstrap-recovery");
  expect(String(runtime.scenarioApplyMetric?.startupRecoveryReason || "")).toMatch(/Startup hydration health gate failed/i);
});

test("deferred hydration mask mismatch enters safe readonly mode and clears runtime overlays", async ({ page }) => {
  test.setTimeout(240000);
  await gotoApp(page, DEFAULT_STARTUP_PATH, { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page, { timeout: 120000 });

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
      overlayState: {
        hasScenarioWaterRegions: !!state.scenarioWaterRegionsData,
        hasScenarioLandMask: !!state.scenarioLandMaskData,
        hasScenarioContextLandMask: !!state.scenarioContextLandMaskData,
      },
    };
  });

  expect(result.gateResult.ok).toBe(false);
  expect(result.startupReadonly).toBe(true);
  expect(result.startupReadonlyReason).toBe("scenario-health-gate");
  expect(result.scenarioHydrationHealthGate).toEqual({
    status: "degraded",
    reason: "runtime-overlay-context-land-mask-version-mismatch",
  });
  expect(result.overlayState).toEqual({
    hasScenarioWaterRegions: false,
    hasScenarioLandMask: false,
    hasScenarioContextLandMask: false,
  });
});
const STARTUP_BUNDLE_EN_PATH = path.resolve(__dirname, "..", "..", "data", "scenarios", "tno_1962", "startup.bundle.en.json");
