const fs = require("fs");
const path = require("path");
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

// Readiness ladder for E2E callers:
// 1. waitForAppInteractive -> boot 主流程结束，可开始读 runtime state。
// 2. waitForShellReady -> shell 控件和 canvas 就绪，可开始 UI 交互。
// 3. waitForScenarioReadyGate / waitForScenarioApplyIdle -> 场景切换稳定。
// 4. waitForRenderIdle -> render/chunk/exact-after-settle 全部稳定，可做视觉采样。

function isScenarioRuntimeReadyForPlaywright(state) {
  const loadState = state?.runtimeChunkLoadState || {};
  const shellOwnerCount = Object.keys(state?.scenarioAutoShellOwnerByFeatureId || {}).length;
  const selectionVersion = Math.max(0, Number(loadState.selectionVersion || 0));
  const politicalFeatureCount = Array.isArray(state?.scenarioPoliticalChunkData?.features)
    ? state.scenarioPoliticalChunkData.features.length
    : 0;
  const landFeatureCount = Array.isArray(state?.landData?.features) ? state.landData.features.length : 0;
  const colorCount = Object.keys(state?.colors || {}).length;
  const activeScenarioId = String(state?.activeScenarioId || "");
  const activeChunkScenarioId = String(state?.activeScenarioChunks?.scenarioId || "");
  const loadedChunkCount = Array.isArray(state?.activeScenarioChunks?.loadedChunkIds)
    ? state.activeScenarioChunks.loadedChunkIds.length
    : 0;
  const chunkStateMatchesScenario = !!activeScenarioId && activeChunkScenarioId === activeScenarioId;
  const manifestUsesChunkRuntime = !!state?.activeScenarioManifest?.detail_chunk_manifest_url;
  const chunkRuntimeStateActive = !!(
    chunkStateMatchesScenario
    && (
      selectionVersion > 0
      || politicalFeatureCount > 0
      || loadedChunkCount > 0
      || loadState.pendingPromotion
      || loadState.pendingVisualPromotion
      || loadState.refreshScheduled
      || loadState.promotionScheduled
      || loadState.promotionCommitInFlight
    )
  );
  const chunkIdle = !loadState.pendingPromotion
    && !loadState.promotionScheduled
    && !loadState.refreshScheduled
    && !loadState.promotionCommitInFlight
    && !loadState.pendingVisualPromotion;
  const chunkVisualReady = (
    selectionVersion > 0
    && politicalFeatureCount > 0
    && landFeatureCount > 0
    && colorCount > 0
    && chunkIdle
  );
  const usesChunkRuntime = manifestUsesChunkRuntime || chunkRuntimeStateActive;
  if (usesChunkRuntime) return chunkVisualReady;
  return shellOwnerCount > 0 || (landFeatureCount > 0 && colorCount > 0 && chunkIdle);
}

// The published editor is bundled, so importing ./js/core/*.js by URL there loads a
// separate, unused copy of each module. Read the live modules through the app test API
// (js/core/app_test_api.js), which both the source and the bundle install.
const READ_LIVE_MODULES_SOURCE = `async () => {
  for (let attempt = 0; attempt < 600 && !globalThis.__scenarioForgeTestApi; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (globalThis.__scenarioForgeTestApi) return globalThis.__scenarioForgeTestApi.internals();
  const load = (path) => import(new URL(path, globalThis.location.href).toString());
  const [stateModule, interactionFunnel, scenarioDispatcher] = await Promise.all([
    load("./js/core/state.js"), load("./js/core/interaction_funnel.js"), load("./js/core/scenario_dispatcher.js"),
  ]);
  return { state: stateModule.state, interactionFunnel, scenarioDispatcher };
}`;

async function primeStateRef(page) {
  // Playwright `waitForFunction(async ...)` only waits on the returned Promise object itself,
  // so shared ready gates pin the live singleton state onto `globalThis` first and then poll
  // it synchronously inside `waitForFunction`.
  await page.evaluate(async ({ readyPredicateSource, readLiveModulesSource }) => {
    globalThis.__playwrightIsScenarioRuntimeReady = Function(`return (${readyPredicateSource});`)();
    if (globalThis.__playwrightStateRef) {
      return true;
    }
    const modules = await Function(`return (${readLiveModulesSource});`)()();
    globalThis.__playwrightStateRef = modules?.state || null;
    return !!globalThis.__playwrightStateRef;
  }, { readyPredicateSource: isScenarioRuntimeReadyForPlaywright.toString(), readLiveModulesSource: READ_LIVE_MODULES_SOURCE });
}

async function primeInteractionFunnelDebugRef(page) {
  await page.evaluate(async (readLiveModulesSource) => {
    if (globalThis.__playwrightInteractionFunnelDebugRef) {
      return true;
    }
    const modules = await Function(`return (${readLiveModulesSource});`)()();
    globalThis.__playwrightInteractionFunnelDebugRef = modules?.interactionFunnel?.getInteractionFunnelDebugState || null;
    return !!globalThis.__playwrightInteractionFunnelDebugRef;
  }, READ_LIVE_MODULES_SOURCE);
}

async function gotoApp(page, targetPath = DEFAULT_APP_PATH, options = {}) {
  return page.goto(getAppUrl(targetPath), options);
}

async function readBootStateSnapshot(page) {
  try {
    return await page.evaluate(async () => {
      const overlay = document.querySelector("#bootOverlay");
      const scenarioStatus = document.querySelector("#scenarioStatus");
      // Diagnostics only: use the live state without waiting for the test API to appear.
      const state = globalThis.__playwrightStateRef
        || (globalThis.__scenarioForgeTestApi
          ? (await globalThis.__scenarioForgeTestApi.internals()).state
          : (await import(new URL("./js/core/state.js", globalThis.location.href).toString())).state)
        || {};
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

async function readRuntimeIdleSnapshot(page) {
  try {
    await primeStateRef(page);
    return await page.evaluate(() => {
      const state = globalThis.__playwrightStateRef || {};
      const loadState = state.runtimeChunkLoadState || {};
      return {
        activeScenarioId: String(state.activeScenarioId || ""),
        renderPhase: String(state.renderPhase || ""),
        scenarioApplyInFlight: !!state.scenarioApplyInFlight,
        startupReadonlyUnlockInFlight: !!state.startupReadonlyUnlockInFlight,
        chunkIdle: {
          pendingPromotion: !!loadState.pendingPromotion,
          promotionScheduled: !!loadState.promotionScheduled,
          refreshScheduled: !!loadState.refreshScheduled,
          promotionCommitInFlight: !!loadState.promotionCommitInFlight,
          pendingVisualPromotion: !!loadState.pendingVisualPromotion,
          pendingInfraPromotion: !!loadState.pendingInfraPromotion,
        },
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
    }, undefined, { timeout });
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

async function waitForShellReady(page, { timeout = 90_000, requireCanvas = false } = {}) {
  try {
    await primeStateRef(page);
    await page.waitForFunction(({ requireCanvas: shouldRequireCanvas }) => {
      const state = globalThis.__playwrightStateRef || null;
      if (!state) return false;
      if (String(state.bootError || "").trim()) {
        throw new Error(`[playwright-app] bootError=${state.bootError}`);
      }
      const overlay = document.querySelector("#bootOverlay");
      const scenarioSelect = document.querySelector("#scenarioSelect");
      const canvas = Array.from(document.querySelectorAll("canvas"))
        .find((entry) => entry.width >= 200
          && entry.height >= 120
          && globalThis.getComputedStyle(entry).display !== "none");
      return (
        state.bootBlocking === false
        && !state.scenarioApplyInFlight
        && !state.startupReadonlyUnlockInFlight
        && !document.body?.classList?.contains("app-booting")
        && (!overlay || overlay.classList.contains("hidden"))
        && !!scenarioSelect
        && scenarioSelect.querySelectorAll("option").length > 0
        && (!shouldRequireCanvas || !!canvas)
      );
    }, { requireCanvas: !!requireCanvas }, { timeout });
  } catch (error) {
    const [bootSnapshot, idleSnapshot] = await Promise.all([
      readBootStateSnapshot(page),
      readRuntimeIdleSnapshot(page),
    ]);
    const wrapped = new Error(
      `[playwright-app] waitForShellReady timed out after ${timeout}ms. Snapshot: ${JSON.stringify({
        boot: bootSnapshot,
        idle: idleSnapshot,
      })}`
    );
    wrapped.cause = error;
    throw wrapped;
  }
}

async function waitForScenarioApplyIdle(page, { scenarioId = "", timeout = 120_000 } = {}) {
  const expectedScenarioId = String(scenarioId || "").trim();
  try {
    await primeStateRef(page);
    await page.waitForFunction((targetScenarioId) => {
      const state = globalThis.__playwrightStateRef || null;
      const applyState = globalThis.__playwrightScenarioApplyState || null;
      if (applyState?.targetScenarioId === targetScenarioId && String(applyState?.error || "").trim()) {
        throw new Error(`[playwright-app] scenario apply failed: ${applyState.error}`);
      }
      if (!state) return false;
      const scenarioStable = !targetScenarioId || String(state.activeScenarioId || "") === targetScenarioId;
      return (
        scenarioStable
        && !state.scenarioApplyInFlight
        && !state.startupReadonlyUnlockInFlight
      );
    }, expectedScenarioId, { timeout });
  } catch (error) {
    const snapshot = await readRuntimeIdleSnapshot(page);
    const wrapped = new Error(
      `[playwright-app] waitForScenarioApplyIdle timed out after ${timeout}ms. Snapshot: ${JSON.stringify(snapshot)}`
    );
    wrapped.cause = error;
    throw wrapped;
  }
}

async function waitForChunkIdle(page, { timeout = 120_000, requireInfra = true } = {}) {
  try {
    await primeStateRef(page);
    await page.waitForFunction((requiresInfra) => {
      const state = globalThis.__playwrightStateRef || null;
      const loadState = state?.runtimeChunkLoadState || {};
      return !!state
        && !loadState.pendingPromotion
        && !loadState.promotionScheduled
        && !loadState.refreshScheduled
        && !loadState.promotionCommitInFlight
        && !loadState.pendingVisualPromotion
        && (!requiresInfra || !loadState.pendingInfraPromotion);
    }, requireInfra, { timeout });
  } catch (error) {
    const snapshot = await readRuntimeIdleSnapshot(page);
    const wrapped = new Error(
      `[playwright-app] waitForChunkIdle timed out after ${timeout}ms. Snapshot: ${JSON.stringify(snapshot)}`
    );
    wrapped.cause = error;
    throw wrapped;
  }
}

async function waitForRenderIdle(page, { scenarioId = "", timeout = 120_000, requireInfra = true } = {}) {
  await waitForScenarioApplyIdle(page, { scenarioId, timeout });
  await waitForChunkIdle(page, { timeout, requireInfra });
  await page.waitForFunction(() => {
    const state = globalThis.__playwrightStateRef || null;
    return !!state
      && String(state.renderPhase || "idle") === "idle"
      && !state.deferExactAfterSettle
      && !state.exactAfterSettleHandle
      && !state.zoomRenderScheduled
      && !state.pendingZoomTransform
      && !state.renderPhaseTimerId;
  }, undefined, { timeout });
  // 两帧 RAF 可以让 canvas 合成落到稳定帧，再做亮度采样。
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  await waitForScenarioApplyIdle(page, { scenarioId, timeout });
  await waitForChunkIdle(page, { timeout, requireInfra });
  await page.waitForFunction(() => {
    const state = globalThis.__playwrightStateRef || null;
    return !!state
      && String(state.renderPhase || "idle") === "idle"
      && !state.deferExactAfterSettle
      && !state.exactAfterSettleHandle
      && !state.zoomRenderScheduled
      && !state.pendingZoomTransform
      && !state.renderPhaseTimerId;
  }, undefined, { timeout });
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

async function readDomFingerprint(page, selectors = []) {
  try {
    return await page.evaluate((selectorList) => {
      const overlay = document.querySelector("#bootOverlay");
      const canvases = Array.from(document.querySelectorAll("canvas")).map((canvas) => ({
        id: String(canvas.id || ""),
        width: Number(canvas.width || 0),
        height: Number(canvas.height || 0),
        visible: globalThis.getComputedStyle(canvas).display !== "none",
      }));
      return {
        bodyAppBooting: !!document.body?.classList?.contains("app-booting"),
        bootOverlay: {
          exists: !!overlay,
          hidden: !!overlay?.classList?.contains("hidden"),
          ariaBusy: String(overlay?.getAttribute("aria-busy") || ""),
          ariaHidden: String(overlay?.getAttribute("aria-hidden") || ""),
        },
        canvasCount: canvases.length,
        canvases,
        selectors: selectorList.map((selector) => {
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
          return {
            selector,
            exists: true,
            visible: style.visibility !== "hidden"
              && style.display !== "none"
              && Number(rect.width) > 0
              && Number(rect.height) > 0,
            text: String(element.textContent || "").trim().slice(0, 200),
          };
        }),
      };
    }, selectors);
  } catch (error) {
    return {
      snapshotError: String(error?.message || error),
    };
  }
}

async function readFailureContextSnapshot(page, selectors = []) {
  try {
    await primeStateRef(page);
    const [bootState, idleState, selectorState, domFingerprint, activeScenarioId] = await Promise.all([
      readBootStateSnapshot(page),
      readRuntimeIdleSnapshot(page),
      readSelectorSnapshot(page, selectors),
      readDomFingerprint(page, selectors),
      page.evaluate(() => {
        const state = globalThis.__playwrightStateRef || null;
        return String(state?.activeScenarioId || "");
      }),
    ]);
    return {
      bootState,
      idleState,
      activeScenarioId,
      selectors: selectorState,
      domFingerprint,
    };
  } catch (error) {
    return {
      snapshotError: String(error?.message || error),
      activeScenarioId: "",
      selectors: [],
      domFingerprint: {
        snapshotError: "failure-context capture failed",
      },
      bootState: {
        snapshotError: "failure-context capture failed",
      },
      idleState: {
        snapshotError: "failure-context capture failed",
      },
    };
  }
}

async function readSmokeFailureSnapshot(page, selectors = []) {
  const snapshot = await readFailureContextSnapshot(page, selectors);
  return snapshot;
}

async function writeFailureContextArtifact(testInfo, snapshot, {
  fileName = "failure-context.json",
  attachmentName = "failure-context",
} = {}) {
  if (!testInfo?.outputDir) {
    return null;
  }
  const outputPath = path.join(testInfo.outputDir, fileName);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  if (typeof testInfo.attach === "function") {
    await testInfo.attach(attachmentName, {
      path: outputPath,
      contentType: "application/json",
    });
  }
  return outputPath;
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
  }, undefined, { timeout });
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
    return {
      activeScenarioId: String(state?.activeScenarioId || ""),
      scenarioApplyInFlight: !!state?.scenarioApplyInFlight,
      runtimeReady: globalThis.__playwrightIsScenarioRuntimeReady(state),
    };
  });
  if (
    !forceApply
    &&
    currentScenarioState.activeScenarioId === expectedScenarioId
    && !currentScenarioState.scenarioApplyInFlight
    && currentScenarioState.runtimeReady
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
        const { applyScenarioByIdCommand } = globalThis.__scenarioForgeTestApi
          ? (await globalThis.__scenarioForgeTestApi.internals()).scenarioDispatcher
          : await import("/js/core/scenario_dispatcher.js");
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
    return state.activeScenarioId === targetScenarioId
      && !state.scenarioApplyInFlight
      && globalThis.__playwrightIsScenarioRuntimeReady(state);
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
  waitForShellReady,
  waitForScenarioApplyIdle,
  waitForChunkIdle,
  waitForRenderIdle,
  waitForScenarioSelectReady,
  waitForScenarioReadyGate,
  readDomFingerprint,
  readFailureContextSnapshot,
  readSmokeFailureSnapshot,
  writeFailureContextArtifact,
  applyScenarioAndWaitIdle,
  waitForProjectImportSettled,
  beginProjectImportWatch,
  waitForProjectImportCompletion,
  openProjectFrontlineSection,
  waitForAppInteractive,
  isScenarioRuntimeReadyForPlaywright,
};
