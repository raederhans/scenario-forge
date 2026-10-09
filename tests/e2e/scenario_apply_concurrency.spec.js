const { test, expect } = require("@playwright/test");
const { getAppUrl, waitForAppInteractive } = require("./support/playwright-app");

// Three cold scenario-apply queue contracts share one page so diagnostic sequence evidence stays continuous.
test.setTimeout(300_000);

const APP_URL = getAppUrl('/?render_profile=balanced&startup_interaction=full&startup_worker=0&startup_cache=1&default_scenario=hoi4_1939&render_diag=1');

async function waitForScenarioControlsReady(page) {
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const select = document.querySelector("#scenarioSelect");
    const applyButton = document.querySelector("#applyScenarioBtn");
    return !!select
      && !!applyButton
      && select.querySelectorAll("option").length > 0;
  }, { timeout: 60_000 });
  await waitForAppInteractive(page, { timeout: 60_000 });
  await page.evaluate(() => {
    document.querySelector("#scenarioSelect")?.closest("details")?.setAttribute("open", "");
  });
  await expect(page.locator("#scenarioSelect")).toBeVisible();
}

async function runScenarioApply(page, scenarioId, { runTwice = false } = {}) {
  const expectedScenarioId = String(scenarioId || "").trim();
  return page.evaluate(async ({ expectedScenarioId, runTwice }) => {
    const { applyScenarioByIdCommand } = await import("/js/core/scenario_dispatcher.js");
    const commandOptions = {
      renderMode: "none",
      markDirtyReason: "",
      showToastOnComplete: false,
    };
    const applyOnce = () => applyScenarioByIdCommand(expectedScenarioId, commandOptions);
    const results = await (runTwice
      ? Promise.allSettled([applyOnce(), applyOnce()])
      : Promise.allSettled([applyOnce()]));
    return results.map((result) => ({
      status: String(result?.status || ""),
      reason: String(result?.reason?.message || result?.reason || ""),
    }));
  }, { expectedScenarioId, runTwice });
}

test('scenario apply is single-flight and english ui uses entry.en overrides', async ({ page }) => {
  const pageErrors = [];
  const unhandledConsoleErrors = [];

  page.on('pageerror', (error) => {
    pageErrors.push(String(error?.message || error));
  });

  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error' && /unhandled|uncaught|rejection/i.test(text)) {
      unhandledConsoleErrors.push(text);
    }
  });

  await waitForScenarioControlsReady(page);

  const startupState = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    return {
      activeScenarioId: String(state.activeScenarioId || ''),
      scenarioApplyInFlight: !!state.scenarioApplyInFlight,
    };
  });
  expect(startupState).toEqual({
    activeScenarioId: 'hoi4_1939',
    scenarioApplyInFlight: false,
  });

  const manualInFlightButtonState = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    state.scenarioApplyInFlight = true;
    if (typeof state.updateScenarioUIFn === 'function') {
      state.updateScenarioUIFn();
    }
    const snapshot = {
      applyDisabled: !!document.querySelector('#applyScenarioBtn')?.disabled,
      resetDisabled: !!document.querySelector('#resetScenarioBtn')?.disabled,
      clearDisabled: !!document.querySelector('#clearScenarioBtn')?.disabled,
    };
    state.scenarioApplyInFlight = false;
    if (typeof state.updateScenarioUIFn === 'function') {
      state.updateScenarioUIFn();
    }
    return snapshot;
  });
  expect(manualInFlightButtonState).toEqual({
    applyDisabled: true,
    resetDisabled: true,
    clearDisabled: true,
  });

  await page.evaluate(() => {
    if (globalThis.__scenarioTestJsonWrapperInstalled) return;
    const originalJson = globalThis.d3?.json?.bind(globalThis.d3);
    if (typeof originalJson !== 'function') {
      throw new Error('d3.json is not available for scenario test instrumentation.');
    }
    globalThis.__scenarioTestJsonCounters = {
      manifest: 0,
    };
    globalThis.__scenarioTestJsonDelays = {
      "data/scenarios/tno_1962/manifest.json": 700,
    };
    globalThis.d3.json = async (...args) => {
      const url = String(args[0] || '');
      const delayEntry = Object.entries(globalThis.__scenarioTestJsonDelays || {})
        .find(([needle]) => url.includes(needle));
      if (delayEntry) {
        globalThis.__scenarioTestJsonCounters.manifest += 1;
        await new Promise((resolve) => setTimeout(resolve, Number(delayEntry[1] || 0)));
      }
      return originalJson(...args);
    };
    globalThis.__scenarioTestJsonWrapperInstalled = true;
  });
  const applyResults = await runScenarioApply(page, 'tno_1962', { runTwice: true });
  expect(applyResults).toEqual([
    { status: 'fulfilled', reason: '' },
    { status: 'fulfilled', reason: '' },
  ]);
  await expect.poll(async () => page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    return {
      activeScenarioId: String(state.activeScenarioId || ''),
      scenarioApplyInFlight: !!state.scenarioApplyInFlight,
    };
  }), { timeout: 45_000 }).toEqual({
    activeScenarioId: 'tno_1962',
    scenarioApplyInFlight: false,
  });
  await expect(page.locator('#scenarioStatus')).toContainText('TNO 1962', { timeout: 30000 });

  const scenarioState = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    return {
      activeScenarioId: state.activeScenarioId,
      manifestScenarioId: String(state.activeScenarioManifest?.scenario_id || ''),
      scenarioApplyInFlight: state.scenarioApplyInFlight,
      applyDisabled: !!document.querySelector('#applyScenarioBtn')?.disabled,
      resetDisabled: !!document.querySelector('#resetScenarioBtn')?.disabled,
      clearDisabled: !!document.querySelector('#clearScenarioBtn')?.disabled,
    };
  });
  const requestCounters = await page.evaluate(() => ({ ...(globalThis.__scenarioTestJsonCounters || {}) }));

  const englishOverride = await page.evaluate(async () => {
    const { t } = await import('/js/ui/i18n.js');
    return {
      setActive: t('Set Active', 'ui'),
      scenarioGuide: t(
        'Scenario loaded. 1) Select a country 2) Set Active 3) Apply Core/Presets.',
        'ui'
      ),
    };
  });

  // Bundle caching may satisfy the second scenario switch without a manifest round-trip.
  expect(Number(requestCounters.manifest || 0)).toBeLessThanOrEqual(1);
  expect(pageErrors).toEqual([]);
  expect(unhandledConsoleErrors).toEqual([]);
  expect(scenarioState.activeScenarioId).toBe('tno_1962');
  expect(scenarioState.manifestScenarioId).toBe('tno_1962');
  expect(scenarioState.scenarioApplyInFlight).toBe(false);
  expect(scenarioState.resetDisabled).toBe(false);
  expect(scenarioState.clearDisabled).toBe(false);
  expect(englishOverride.setActive).toBe('Use as Active Owner');
  expect(englishOverride.scenarioGuide).toBe(
    'Scenario loaded. 1) Select a country 2) Choose an active owner 3) Use Activate or Scenario Actions.'
  );

  const queueResult = await page.evaluate(async () => {
    globalThis.__scenarioTestJsonDelays = {
      ...(globalThis.__scenarioTestJsonDelays || {}),
      "data/scenarios/hoi4_1936/manifest.json": 900,
    };
    const { applyScenarioByIdCommand } = await import("/js/core/scenario_dispatcher.js");
    const { state } = await import("/js/core/state.js");
    const commandOptions = {
      renderMode: "none",
      markDirtyReason: "",
      showToastOnComplete: false,
    };
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const first = applyScenarioByIdCommand("hoi4_1936", commandOptions);
    await sleep(30);
    const second = applyScenarioByIdCommand("modern_world", commandOptions);
    await sleep(30);
    const third = applyScenarioByIdCommand("hoi4_1939", commandOptions);
    const results = await Promise.allSettled([first, second, third]);
    const diagnostics = globalThis.__scenarioForgeRenderTransactions || {};
    const snapshots = Array.isArray(diagnostics.snapshots) ? diagnostics.snapshots : [];
    const warnings = Array.isArray(diagnostics.warnings) ? diagnostics.warnings : [];
    return {
      results: results.map((result) => ({
        status: String(result.status || ""),
        valueScenarioId: String(result.value?.manifest?.scenario_id || result.value?.meta?.scenario_id || ""),
        reason: String(result.reason?.message || result.reason || ""),
      })),
      activeScenarioId: String(state.activeScenarioId || ""),
      scenarioApplyInFlight: !!state.scenarioApplyInFlight,
      queueSnapshots: snapshots
        .filter((snapshot) => [
          "scenario-apply-queued-latest-target",
          "scenario-apply-queue-drain-started",
          "scenario-apply-queue-drain-skipped-stale",
          "scenario-apply-queue-drain-complete",
        ].includes(snapshot.phase))
        .slice(-12)
        .map((snapshot) => ({
          phase: snapshot.phase,
          requestedScenarioId: snapshot.requestedScenarioId,
          expectedScenarioId: snapshot.expectedScenarioId,
          scenarioApplyRequestId: snapshot.extra?.scenarioApplyRequestId || 0,
          activeScenarioApplyTargetId: snapshot.extra?.activeScenarioApplyTargetId || "",
          queuedScenarioApplyTargetId: snapshot.extra?.queuedScenarioApplyTargetId || snapshot.extra?.latestQueuedScenarioApplyTargetId || "",
          resolution: snapshot.extra?.resolution || "",
          finalActiveScenarioId: snapshot.extra?.finalActiveScenarioId || "",
        })),
      mismatchWarnings: warnings
        .filter((warning) => warning.code === "scenario-apply-inflight-target-mismatch")
        .slice(-8)
        .map((warning) => ({
          activeScenarioApplyTargetId: warning.details?.activeScenarioApplyTargetId || "",
          requestedScenarioId: warning.details?.requestedScenarioId || "",
          queuedScenarioApplyTargetId: warning.details?.queuedScenarioApplyTargetId || "",
          resolution: warning.details?.resolution || "",
        })),
    };
  });

  expect(queueResult.results.every((result) => result.status === "fulfilled")).toBe(true);
  expect(queueResult.activeScenarioId).toBe("hoi4_1939");
  expect(queueResult.scenarioApplyInFlight).toBe(false);
  expect(queueResult.mismatchWarnings.some((warning) => (
    warning.activeScenarioApplyTargetId === "hoi4_1936"
    && warning.requestedScenarioId === "modern_world"
    && warning.resolution === "queued-latest-request"
  ))).toBe(true);
  expect(queueResult.mismatchWarnings.some((warning) => warning.requestedScenarioId === "hoi4_1939")).toBe(true);
  expect(queueResult.queueSnapshots.some((snapshot) => (
    snapshot.phase === "scenario-apply-queue-drain-skipped-stale"
    && snapshot.requestedScenarioId === "modern_world"
    && snapshot.resolution === "replaced-by-latest-request"
  ))).toBe(true);
  expect(queueResult.queueSnapshots.some((snapshot) => (
    snapshot.phase === "scenario-apply-queue-drain-complete"
    && snapshot.requestedScenarioId === "hoi4_1939"
    && snapshot.finalActiveScenarioId === "hoi4_1939"
  ))).toBe(true);

  const middleStartedResult = await page.evaluate(async () => {
    const diagnosticsBefore = globalThis.__scenarioForgeRenderTransactions || {};
    const sequenceStart = Number(
      diagnosticsBefore.state?.sequence
      || diagnosticsBefore.latest?.sequence
      || 0
    );
    globalThis.__scenarioTestJsonDelays = {
      ...(globalThis.__scenarioTestJsonDelays || {}),
      "data/scenarios/hoi4_1936/manifest.json": 500,
      "data/scenarios/blank_base/manifest.json": 900,
    };
    const { applyScenarioByIdCommand } = await import("/js/core/scenario_dispatcher.js");
    const { state } = await import("/js/core/state.js");
    ["hoi4_1936", "blank_base", "modern_world"].forEach((scenarioId) => {
      if (state.scenarioBundleCacheById && typeof state.scenarioBundleCacheById === "object") {
        delete state.scenarioBundleCacheById[scenarioId];
      }
    });
    const commandOptions = {
      renderMode: "none",
      markDirtyReason: "",
      showToastOnComplete: false,
    };
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    // Observe these three events as they occur: a public scenario may emit
    // enough renderer diagnostics to evict them from the bounded history.
    const observations = { blankBaseCommitted: false, staleBlankBaseSkipped: false, modernDrainComplete: false };
    const diagnosticSnapshots = diagnosticsBefore.snapshots;
    const originalPush = diagnosticSnapshots.push;
    Object.defineProperty(diagnosticSnapshots, "push", {
      configurable: true,
      value(...snapshots) {
        for (const snapshot of snapshots) {
          if (Number(snapshot.sequence || 0) <= sequenceStart) continue;
          observations.blankBaseCommitted ||= snapshot.phase === "scenario-apply-target-committed"
            && snapshot.requestedScenarioId === "blank_base";
          observations.staleBlankBaseSkipped ||= snapshot.phase === "scenario-apply-stale-callback-skipped"
            && snapshot.expectedScenarioId === "blank_base"
            && snapshot.extra?.callbackPhase === "commit-start"
            && snapshot.extra?.resolution === "skipped-stale-request";
          observations.modernDrainComplete ||= snapshot.phase === "scenario-apply-queue-drain-complete"
            && snapshot.requestedScenarioId === "modern_world"
            && snapshot.extra?.finalActiveScenarioId === "modern_world";
        }
        return originalPush.apply(this, snapshots);
      },
    });
    const waitForQueueDrainStarted = async (scenarioId, timeoutMs = 60_000) => {
      const startedAt = Date.now();
      while (true) {
        const diagnostics = globalThis.__scenarioForgeRenderTransactions || {};
        const snapshots = Array.isArray(diagnostics.snapshots) ? diagnostics.snapshots : [];
        const found = snapshots.some((snapshot) => (
          Number(snapshot.sequence || 0) > sequenceStart
          && snapshot.phase === "scenario-apply-queue-drain-started"
          && snapshot.requestedScenarioId === scenarioId
        ));
        if (found) return true;
        // A cold scenario prepare can hold the main thread past the wall-clock budget
        // after the drain marker is recorded, so inspect once before declaring timeout.
        if (Date.now() - startedAt >= timeoutMs) return false;
        await sleep(25);
      }
    };
    let middleStarted;
    let results;
    try {
      const first = applyScenarioByIdCommand("hoi4_1936", commandOptions);
      await sleep(30);
      const second = applyScenarioByIdCommand("blank_base", commandOptions);
      middleStarted = await waitForQueueDrainStarted("blank_base");
      const third = applyScenarioByIdCommand("modern_world", commandOptions);
      results = await Promise.allSettled([first, second, third]);
    } finally {
      delete diagnosticSnapshots.push;
    }
    return {
      middleStarted,
      results: results.map((result) => ({
        status: String(result.status || ""),
        valueScenarioId: String(result.value?.manifest?.scenario_id || result.value?.meta?.scenario_id || ""),
        reason: String(result.reason?.message || result.reason || ""),
      })),
      activeScenarioId: String(state.activeScenarioId || ""),
      scenarioApplyInFlight: !!state.scenarioApplyInFlight,
      ...observations,
    };
  });

  expect(middleStartedResult.middleStarted).toBe(true);
  expect(middleStartedResult.results.every((result) => result.status === "fulfilled")).toBe(true);
  expect(middleStartedResult.results.map((result) => result.valueScenarioId)).toEqual([
    "hoi4_1936",
    "modern_world",
    "modern_world",
  ]);
  expect(middleStartedResult.activeScenarioId).toBe("modern_world");
  expect(middleStartedResult.scenarioApplyInFlight).toBe(false);
  expect(middleStartedResult.blankBaseCommitted).toBe(false);
  expect(middleStartedResult.staleBlankBaseSkipped).toBe(true);
  expect(middleStartedResult.modernDrainComplete).toBe(true);
  expect(pageErrors).toEqual([]);
  expect(unhandledConsoleErrors).toEqual([]);
});
