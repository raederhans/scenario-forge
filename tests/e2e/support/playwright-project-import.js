async function waitForProjectImportSettled(page, {
  timeout = 30_000,
  minOperationalLines = 0,
  minOperationGraphics = 0,
  minUnitCounters = 0,
} = {}) {
  await page.waitForFunction((expected) => {
    const state = globalThis.__playwrightStateRef || null;
    if (!state) return false;
    const operationalLineCount = Array.isArray(state.operationalLines) ? state.operationalLines.length : 0;
    const operationGraphicCount = Array.isArray(state.operationGraphics) ? state.operationGraphics.length : 0;
    const unitCounterCount = Array.isArray(state.unitCounters) ? state.unitCounters.length : 0;
    return (
      !state.projectImportInFlight
      && operationalLineCount >= expected.minOperationalLines
      && operationGraphicCount >= expected.minOperationGraphics
      && unitCounterCount >= expected.minUnitCounters
    );
  }, {
    minOperationalLines: Math.max(0, Number(minOperationalLines) || 0),
    minOperationGraphics: Math.max(0, Number(minOperationGraphics) || 0),
    minUnitCounters: Math.max(0, Number(minUnitCounters) || 0),
  }, { timeout });
}

async function beginProjectImportWatch(page, { expectedFileName = "" } = {}) {
  const baseline = await page.evaluate(() => {
    const getDebugState = globalThis.__playwrightInteractionFunnelDebugRef || null;
    return typeof getDebugState === "function" ? getDebugState() : null;
  });
  return {
    expectedFileName: String(expectedFileName || "").trim(),
    initialImportStartCount: Number(baseline?.importStartCount || 0),
    initialImportApplyCount: Number(baseline?.importApplyCount || 0),
  };
}

async function waitForProjectImportCompletion(page, importWatchState, {
  timeout = 120_000,
  readBootStateSnapshot,
} = {}) {
  const watchState = importWatchState && typeof importWatchState === "object" ? importWatchState : {};
  const expectedFileName = String(watchState.expectedFileName || "").trim();
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const debug = await page.evaluate(() => {
      const getDebugState = globalThis.__playwrightInteractionFunnelDebugRef || null;
      return typeof getDebugState === "function" ? getDebugState() : null;
    });
    const importStarted = Number(debug?.importStartCount || 0) > Number(watchState.initialImportStartCount || 0);
    if (importStarted) {
      const importError = String(debug?.lastImportError || "").trim();
      if (importError) {
        throw new Error(`Project import failed: ${importError}`);
      }
      const importApplied = Number(debug?.importApplyCount || 0) > Number(watchState.initialImportApplyCount || 0);
      const phaseComplete = String(debug?.importPhase || "") === "complete";
      const fileMatches = !expectedFileName || String(debug?.lastImportFileName || "") === expectedFileName;
      if (importApplied && phaseComplete && fileMatches) {
        return;
      }
    }
    await page.waitForTimeout(200);
  }
  const snapshot = typeof readBootStateSnapshot === "function"
    ? await readBootStateSnapshot(page)
    : { snapshotError: "readBootStateSnapshot unavailable" };
  throw new Error(
    `[playwright-app] waitForProjectImportCompletion timed out after ${timeout}ms. Boot snapshot: ${JSON.stringify(snapshot)}`
  );
}

module.exports = {
  waitForProjectImportSettled,
  beginProjectImportWatch,
  waitForProjectImportCompletion,
};
