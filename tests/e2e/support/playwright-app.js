const {
  DEFAULT_APP_PATH,
  DEFAULT_OPEN_PATH,
  DEFAULT_APP_ORIGIN,
  getAppUrl,
  getConfiguredAppOrigin,
} = require("./playwright-app-paths");
const { openProjectFrontlineSection } = require("./playwright-frontline-panel");
const {
  waitForProjectImportSettled: waitForProjectImportSettledInternal,
  beginProjectImportWatch: beginProjectImportWatchInternal,
  waitForProjectImportCompletion: waitForProjectImportCompletionInternal,
} = require("./playwright-project-import");
const { getWebServerConfig } = require("./playwright-web-server");

async function primeStateRef(page) {
  // Playwright `waitForFunction(async ...)` only waits on the returned Promise object itself,
  // so shared ready gates pin the live singleton state onto `globalThis` first and then poll
  // it synchronously inside `waitForFunction`.
  await page.evaluate(async () => {
    if (globalThis.__playwrightStateRef) {
      return true;
    }
    const stateModuleUrl = new URL("./js/core/state.js", globalThis.location.href).toString();
    const stateModule = await import(stateModuleUrl);
    globalThis.__playwrightStateRef = stateModule?.state || null;
    return !!globalThis.__playwrightStateRef;
  });
}

async function primeInteractionFunnelDebugRef(page) {
  await page.evaluate(async () => {
    if (globalThis.__playwrightInteractionFunnelDebugRef) {
      return true;
    }
    const funnelModuleUrl = new URL("./js/core/interaction_funnel.js", globalThis.location.href).toString();
    const funnelModule = await import(funnelModuleUrl);
    globalThis.__playwrightInteractionFunnelDebugRef = funnelModule?.getInteractionFunnelDebugState || null;
    return !!globalThis.__playwrightInteractionFunnelDebugRef;
  });
}

async function gotoApp(page, targetPath = DEFAULT_APP_PATH, options = {}) {
  return page.goto(getAppUrl(targetPath), options);
}

async function readBootStateSnapshot(page) {
  try {
    return await page.evaluate(async () => {
      const overlay = document.querySelector("#bootOverlay");
      const scenarioStatus = document.querySelector("#scenarioStatus");
      const stateModuleUrl = new URL("./js/core/state.js", globalThis.location.href).toString();
      const stateModule = await import(stateModuleUrl);
      const state = stateModule?.state || {};
      return {
        bootPhase: String(state.bootPhase || ""),
        bootBlocking: state.bootBlocking === false ? false : !!state.bootBlocking,
        startupReadonly: !!state.startupReadonly,
        startupReadonlyUnlockInFlight: !!state.startupReadonlyUnlockInFlight,
        detailDeferred: !!state.detailDeferred,
        detailPromotionInFlight: !!state.detailPromotionInFlight,
        scenarioApplyInFlight: !!state.scenarioApplyInFlight,
        activeScenarioId: String(state.activeScenarioId || ""),
        bodyAppBooting: !!document.body?.classList?.contains("app-booting"),
        overlayHidden: !!overlay?.classList?.contains("hidden"),
        overlayAriaBusy: String(overlay?.getAttribute("aria-busy") || ""),
        bootError: String(state.bootError || ""),
        scenarioStatus: String(scenarioStatus?.textContent || ""),
      };
    });
  } catch (error) {
    return {
      snapshotError: String(error?.message || error),
    };
  }
}

async function waitForAppInteractive(page, { timeout = 90_000 } = {}) {
  try {
    await primeStateRef(page);
    await page.waitForFunction(() => {
      const state = globalThis.__playwrightStateRef || null;
      if (!state) return false;
      if (String(state.bootError || "").trim()) {
        throw new Error(`[playwright-app] bootError=${state.bootError}`);
      }
      return (
        state.bootBlocking === false
        && !state.scenarioApplyInFlight
        && !state.startupReadonlyUnlockInFlight
      );
    }, { timeout });
  } catch (error) {
    const snapshot = await readBootStateSnapshot(page);
    const detail = JSON.stringify(snapshot);
    const wrapped = new Error(
      `[playwright-app] waitForAppInteractive timed out after ${timeout}ms. Boot snapshot: ${detail}`
    );
    wrapped.cause = error;
    throw wrapped;
  }
}

async function waitForScenarioSelectReady(page, { scenarioId = "tno_1962", timeout = 90_000 } = {}) {
  await primeStateRef(page);
  await page.waitForFunction((expectedScenarioId) => {
    const state = globalThis.__playwrightStateRef || null;
    const scenarioSelect = document.querySelector("#scenarioSelect");
    return !!state
      && typeof state.renderCountryListFn === "function"
      && !!scenarioSelect
      && !!scenarioSelect.querySelector(`option[value="${expectedScenarioId}"]`);
  }, String(scenarioId || "").trim(), { timeout });
}

async function readSelectorSnapshot(page, selectors = []) {
  return page.evaluate((selectorList) => selectorList.map((selector) => {
    const element = document.querySelector(selector);
    if (!element) {
      return {
        selector,
        exists: false,
        visible: false,
        text: "",
      };
    }
    const style = globalThis.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const visible = style.visibility !== "hidden"
      && style.display !== "none"
      && Number(rect.width) > 0
      && Number(rect.height) > 0;
    return {
      selector,
      exists: true,
      visible,
      text: String(element.textContent || "").trim().slice(0, 200),
    };
  }), selectors);
}

async function readSmokeFailureSnapshot(page, selectors = []) {
  try {
    await primeStateRef(page);
    const [bootState, selectorState, activeScenarioId] = await Promise.all([
      readBootStateSnapshot(page),
      readSelectorSnapshot(page, selectors),
      page.evaluate(() => {
        const state = globalThis.__playwrightStateRef || null;
        return String(state?.activeScenarioId || "");
      }),
    ]);
    return {
      bootState,
      activeScenarioId,
      selectors: selectorState,
    };
  } catch (error) {
    return {
      snapshotError: String(error?.message || error),
      activeScenarioId: "",
      selectors: [],
      bootState: {
        snapshotError: "smoke snapshot capture failed",
      },
    };
  }
}

async function waitForScenarioReadyGate(page, {
  scenarioId = "tno_1962",
  timeout = 120_000,
  renderMode = "none",
} = {}) {
  await waitForAppInteractive(page, { timeout });
  await waitForScenarioSelectReady(page, { scenarioId, timeout });
  await applyScenarioAndWaitIdle(page, scenarioId, {
    timeout,
    renderMode,
    markDirtyReason: "playwright-smoke-scenario-gate",
    showToastOnComplete: false,
  });
  await expectScenarioInteractive(page, { scenarioId, timeout });
}

async function expectScenarioInteractive(page, { scenarioId, timeout = 120_000 } = {}) {
  await expectPollScenarioId(page, { scenarioId, timeout });
  await page.waitForFunction(() => {
    const state = globalThis.__playwrightStateRef || null;
    return !!state && !state.scenarioApplyInFlight;
  }, { timeout });
}

async function expectPollScenarioId(page, { scenarioId, timeout = 120_000 } = {}) {
  const expectedScenarioId = String(scenarioId || "").trim();
  await page.waitForFunction((targetScenarioId) => {
    const select = document.querySelector("#scenarioSelect");
    return !!select && select.value === targetScenarioId;
  }, expectedScenarioId, { timeout });
}

async function applyScenarioAndWaitIdle(page, scenarioId, {
  timeout = 120_000,
  renderMode = "none",
  markDirtyReason = "playwright-apply-scenario",
  showToastOnComplete = false,
  forceApply = false,
} = {}) {
  const expectedScenarioId = String(scenarioId || "").trim();
  await waitForAppInteractive(page, { timeout });
  await waitForScenarioSelectReady(page, { scenarioId: expectedScenarioId, timeout });
  const currentScenarioState = await page.evaluate(() => {
    const state = globalThis.__playwrightStateRef || null;
    const shellOwnerCount = Object.keys(state?.scenarioAutoShellOwnerByFeatureId || {}).length;
    const shellControllerCount = Object.keys(state?.scenarioAutoShellControllerByFeatureId || {}).length;
    const splitFeatureCount = Number(state?.activeScenarioManifest?.summary?.owner_controller_split_feature_count || 0);
    return {
      activeScenarioId: String(state?.activeScenarioId || ""),
      scenarioApplyInFlight: !!state?.scenarioApplyInFlight,
      shellReady: splitFeatureCount <= 0 || (shellOwnerCount > 0 && shellControllerCount > 0),
    };
  });
  if (
    !forceApply
    &&
    currentScenarioState.activeScenarioId === expectedScenarioId
    && !currentScenarioState.scenarioApplyInFlight
    && currentScenarioState.shellReady
  ) {
    return;
  }
  const applyPayload = {
    expectedScenarioId,
    renderMode,
    markDirtyReason,
    showToastOnComplete,
    forceApply,
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.evaluate(async ({
        expectedScenarioId,
        renderMode,
        markDirtyReason,
        showToastOnComplete,
      }) => {
        const select = document.querySelector("#scenarioSelect");
        if (select instanceof HTMLSelectElement) {
          select.value = expectedScenarioId;
        }
        globalThis.__playwrightScenarioApplyState = {
          targetScenarioId: expectedScenarioId,
          settled: false,
          error: "",
          startedAt: Date.now(),
        };
        const { applyScenarioByIdCommand } = await import("/js/core/scenario_dispatcher.js");
        void (async () => {
          let lastError = null;
          for (let commandAttempt = 0; commandAttempt < 3; commandAttempt += 1) {
            try {
              await applyScenarioByIdCommand(expectedScenarioId, {
                renderMode,
                markDirtyReason,
                showToastOnComplete,
              });
              lastError = null;
              break;
            } catch (error) {
              lastError = error;
              await new Promise((resolve) => globalThis.setTimeout(resolve, 400 * (commandAttempt + 1)));
            }
          }
          globalThis.__playwrightScenarioApplyState = {
            targetScenarioId: expectedScenarioId,
            settled: true,
            error: lastError ? String(lastError?.message || lastError) : "",
            finishedAt: Date.now(),
          };
        })();
      }, applyPayload);
      break;
    } catch (error) {
      const message = String(error?.message || error || "");
      const shouldRetry = attempt < 2 && /Execution context was destroyed/i.test(message);
      if (!shouldRetry) {
        throw error;
      }
      await page.waitForLoadState("domcontentloaded", { timeout });
      await waitForAppInteractive(page, { timeout });
      await waitForScenarioSelectReady(page, { scenarioId: expectedScenarioId, timeout });
    }
  }
  await primeStateRef(page);
  await page.waitForFunction((targetScenarioId) => {
    const state = globalThis.__playwrightStateRef || null;
    const applyState = globalThis.__playwrightScenarioApplyState || null;
    if (applyState?.targetScenarioId === targetScenarioId && String(applyState?.error || "").trim()) {
      throw new Error(`[playwright-app] scenario apply failed: ${applyState.error}`);
    }
    if (!state) return false;
    const shellOwnerCount = Object.keys(state.scenarioAutoShellOwnerByFeatureId || {}).length;
    const shellControllerCount = Object.keys(state.scenarioAutoShellControllerByFeatureId || {}).length;
    const splitFeatureCount = Number(state.activeScenarioManifest?.summary?.owner_controller_split_feature_count || 0);
    const shellReady = splitFeatureCount <= 0 || (shellOwnerCount > 0 && shellControllerCount > 0);
    return state.activeScenarioId === targetScenarioId
      && !state.scenarioApplyInFlight
      && shellReady;
  }, expectedScenarioId, { timeout });
}

async function waitForProjectImportSettled(page, options = {}) {
  await primeStateRef(page);
  return waitForProjectImportSettledInternal(page, options);
}

async function beginProjectImportWatch(page, { expectedFileName = "" } = {}) {
  await primeInteractionFunnelDebugRef(page);
  return beginProjectImportWatchInternal(page, { expectedFileName });
}

async function waitForProjectImportCompletion(page, importWatchState, { timeout = 120_000 } = {}) {
  await primeInteractionFunnelDebugRef(page);
  return waitForProjectImportCompletionInternal(page, importWatchState, {
    timeout,
    readBootStateSnapshot,
  });
}

module.exports = {
  DEFAULT_APP_PATH,
  DEFAULT_OPEN_PATH,
  DEFAULT_APP_ORIGIN,
  getAppUrl,
  getConfiguredAppOrigin,
  getWebServerConfig,
  gotoApp,
  readBootStateSnapshot,
  primeStateRef,
  primeInteractionFunnelDebugRef,
  waitForScenarioSelectReady,
  waitForScenarioReadyGate,
  readSmokeFailureSnapshot,
  applyScenarioAndWaitIdle,
  waitForProjectImportSettled,
  beginProjectImportWatch,
  waitForProjectImportCompletion,
  openProjectFrontlineSection,
  waitForAppInteractive,
};
