import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();

function readRepoFile(...relativeParts) {
  return fs.readFileSync(path.join(REPO_ROOT, ...relativeParts), "utf8");
}

function extractFunctionBody(source, functionName) {
  const declarationPattern = new RegExp(
    `(?:async\\s+)?function\\s+${functionName}\\s*\\(`,
  );
  const declarationMatch = declarationPattern.exec(source);
  assert.ok(declarationMatch, `missing function ${functionName}`);
  const openParenIndex = source.indexOf("(", declarationMatch.index);
  let parenDepth = 0;
  let bodyOpenIndex = -1;
  for (let index = openParenIndex; index < source.length; index += 1) {
    if (source[index] === "(") {
      parenDepth += 1;
    } else if (source[index] === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) {
        bodyOpenIndex = source.indexOf("{", index);
        break;
      }
    }
  }
  assert.notEqual(bodyOpenIndex, -1, `missing body for ${functionName}`);
  let braceDepth = 0;
  for (let index = bodyOpenIndex; index < source.length; index += 1) {
    if (source[index] === "{") {
      braceDepth += 1;
    } else if (source[index] === "}") {
      braceDepth -= 1;
      if (braceDepth === 0) {
        return source.slice(bodyOpenIndex + 1, index);
      }
    }
  }
  assert.fail(`unterminated body for ${functionName}`);
}

function createApplyScenarioByIdHarness({
  runtimeState,
  activeScenarioApplyPromise = null,
  activeScenarioApplyTargetId = "",
  activeScenarioApplyRequestId = 0,
  latestQueuedScenarioApplyRequest = null,
}) {
  const source = readRepoFile("js", "core", "scenario_manager.js");
  const body = extractFunctionBody(source, "applyScenarioById");
  const buildHarness = new Function(
    "dependencies",
    `
      const {
        activeScenarioApplyPromise,
        activeScenarioApplyRequestId,
        activeScenarioApplyTargetId,
        assertScenarioInteractionsAllowed,
        canReuseActiveScenarioBundle,
        createScenarioApplyRequest,
        drainQueuedScenarioApplyRequests,
        getCurrentScenarioApplyRequestId,
        getSearchParams,
        nextScenarioApplyEpoch,
        normalizeScenarioId,
        queueLatestScenarioApplyRequest,
        recordRenderInvariantWarning,
        recordScenarioApplyRequestSnapshot,
        recordRenderTransactionSnapshot,
        runScenarioApplyRequest,
        runtimeState,
        setLatestScenarioApplyRequestState,
        RENDER_TRANSACTION_WARNING_CODES,
      } = dependencies;
      let latestQueuedScenarioApplyRequest =
        dependencies.latestQueuedScenarioApplyRequest;
      const applyScenarioById = async function applyScenarioById(
        scenarioId,
        {
          renderNow = true,
          markDirtyReason = "scenario-apply",
          showToastOnComplete = false,
        } = {}
      ) {
        ${body}
      };
      applyScenarioById.getLatestQueuedScenarioApplyRequest = () =>
        latestQueuedScenarioApplyRequest;
      return applyScenarioById;
    `,
  );
  let requestSequence = 0;
  return buildHarness({
    activeScenarioApplyPromise,
    activeScenarioApplyRequestId,
    activeScenarioApplyTargetId,
    assertScenarioInteractionsAllowed: () => {},
    canReuseActiveScenarioBundle: (bundle, scenarioId) =>
      !!bundle && runtimeState.activeScenarioId === scenarioId,
    createScenarioApplyRequest: (scenarioId, options) => ({
      requestId: ++requestSequence,
      scenarioId,
      ...options,
    }),
    drainQueuedScenarioApplyRequests: async () => null,
    getCurrentScenarioApplyRequestId: () =>
      Math.max(0, Number(runtimeState.currentScenarioApplyRequestId || 0)),
    getSearchParams: () => new URLSearchParams(),
    nextScenarioApplyEpoch: (state, { scenarioId = "" } = {}) => {
      const diagnostics = state.renderTransactionDiagnostics;
      diagnostics.scenarioApplyEpoch += 1;
      if (scenarioId) {
        diagnostics.scenarioApplyEpochByScenarioId[scenarioId] =
          diagnostics.scenarioApplyEpoch;
      }
      return diagnostics.scenarioApplyEpoch;
    },
    normalizeScenarioId: (value) => String(value || "").trim(),
    queueLatestScenarioApplyRequest: () => {},
    recordRenderInvariantWarning: () => {},
    recordScenarioApplyRequestSnapshot: () => {},
    recordRenderTransactionSnapshot: () => {},
    runScenarioApplyRequest: async () => null,
    runtimeState,
    latestQueuedScenarioApplyRequest,
    setLatestScenarioApplyRequestState: (target, { requestId, targetId }) => {
      target.latestScenarioApplyRequestId = requestId;
      target.latestScenarioApplyTargetId = targetId;
    },
    RENDER_TRANSACTION_WARNING_CODES: {
      scenarioApplyInflightTargetMismatch: "scenario-apply-inflight-target-mismatch",
    },
  });
}

test("cache hit and same-target promise reuse preserve the active apply epoch for deferred callbacks", async () => {
  const cachedBundle = { manifest: { scenario_id: "alpha" } };
  const queuedBeta = {
    requestId: 99,
    scenarioId: "beta",
    markDirtyReason: "scenario-apply",
  };
  const cacheState = {
    activeScenarioId: "alpha",
    scenarioApplyInFlight: false,
    scenarioBundleCacheById: { alpha: cachedBundle },
    renderTransactionDiagnostics: {
      scenarioApplyEpoch: 7,
      scenarioApplyEpochByScenarioId: { alpha: 7 },
    },
  };
  const applyCachedScenario = createApplyScenarioByIdHarness({
    runtimeState: cacheState,
    latestQueuedScenarioApplyRequest: queuedBeta,
  });

  assert.equal(await applyCachedScenario("alpha"), cachedBundle);
  assert.equal(cacheState.renderTransactionDiagnostics.scenarioApplyEpoch, 7);
  assert.equal(
    cacheState.renderTransactionDiagnostics.scenarioApplyEpochByScenarioId.alpha,
    7,
  );
  assert.equal(applyCachedScenario.getLatestQueuedScenarioApplyRequest(), null);

  let resolveActiveApply;
  let deferredMetadataCommitted = false;
  const activeApplyPromise = new Promise((resolve) => {
    resolveActiveApply = resolve;
  });
  const activeState = {
    activeScenarioId: "alpha",
    currentScenarioApplyRequestId: 41,
    scenarioApplyInFlight: true,
    scenarioBundleCacheById: {},
    renderTransactionDiagnostics: {
      scenarioApplyEpoch: 7,
      scenarioApplyEpochByScenarioId: { alpha: 7 },
    },
  };
  activeApplyPromise.then(() => {
    if (
      activeState.currentScenarioApplyRequestId === 41
      && activeState.renderTransactionDiagnostics
        .scenarioApplyEpochByScenarioId.alpha === 7
    ) {
      deferredMetadataCommitted = true;
    }
  });
  const applyActiveScenario = createApplyScenarioByIdHarness({
    runtimeState: activeState,
    activeScenarioApplyPromise: activeApplyPromise,
    activeScenarioApplyTargetId: "alpha",
    activeScenarioApplyRequestId: 41,
    latestQueuedScenarioApplyRequest: queuedBeta,
  });

  const reusedApply = applyActiveScenario("alpha");
  resolveActiveApply(cachedBundle);
  assert.equal(await reusedApply, cachedBundle);
  await Promise.resolve();

  assert.equal(activeState.renderTransactionDiagnostics.scenarioApplyEpoch, 7);
  assert.equal(
    activeState.renderTransactionDiagnostics.scenarioApplyEpochByScenarioId.alpha,
    7,
  );
  assert.equal(deferredMetadataCommitted, true);
  assert.equal(applyActiveScenario.getLatestQueuedScenarioApplyRequest(), null);

  const supersededState = {
    activeScenarioId: "alpha",
    scenarioApplyInFlight: true,
    scenarioBundleCacheById: { alpha: cachedBundle },
    renderTransactionDiagnostics: {
      scenarioApplyEpoch: 7,
      scenarioApplyEpochByScenarioId: { alpha: 7 },
    },
  };
  const applySupersedingScenario = createApplyScenarioByIdHarness({
    runtimeState: supersededState,
    activeScenarioApplyPromise: Promise.resolve({
      manifest: { scenario_id: "beta" },
    }),
    activeScenarioApplyTargetId: "beta",
    activeScenarioApplyRequestId: 42,
  });

  assert.equal(await applySupersedingScenario("alpha"), null);
  assert.equal(supersededState.renderTransactionDiagnostics.scenarioApplyEpoch, 8);
  assert.equal(
    supersededState.renderTransactionDiagnostics.scenarioApplyEpochByScenarioId.alpha,
    8,
  );
});

test("new and queued scenario transactions allocate a new apply epoch", async () => {
  const newTransactionState = {
    activeScenarioId: "before",
    scenarioApplyInFlight: false,
    scenarioBundleCacheById: {},
    renderTransactionDiagnostics: {
      scenarioApplyEpoch: 7,
      scenarioApplyEpochByScenarioId: { before: 7 },
    },
  };
  const applyNewScenario = createApplyScenarioByIdHarness({
    runtimeState: newTransactionState,
  });

  await applyNewScenario("alpha");
  assert.equal(newTransactionState.renderTransactionDiagnostics.scenarioApplyEpoch, 8);
  assert.equal(
    newTransactionState.renderTransactionDiagnostics.scenarioApplyEpochByScenarioId.alpha,
    8,
  );

  const queuedTransactionState = {
    activeScenarioId: "alpha",
    scenarioApplyInFlight: true,
    scenarioBundleCacheById: {},
    renderTransactionDiagnostics: {
      scenarioApplyEpoch: 8,
      scenarioApplyEpochByScenarioId: { alpha: 8 },
    },
  };
  const applyQueuedScenario = createApplyScenarioByIdHarness({
    runtimeState: queuedTransactionState,
    activeScenarioApplyPromise: Promise.resolve({
      manifest: { scenario_id: "alpha" },
    }),
    activeScenarioApplyTargetId: "alpha",
    activeScenarioApplyRequestId: 42,
  });

  await applyQueuedScenario("beta");
  assert.equal(queuedTransactionState.renderTransactionDiagnostics.scenarioApplyEpoch, 9);
  assert.equal(
    queuedTransactionState.renderTransactionDiagnostics.scenarioApplyEpochByScenarioId.beta,
    9,
  );
});

test("completed apply resumes only its current pending chunk work after releasing the lock", async () => {
  const body = extractFunctionBody(readRepoFile("js", "core", "scenario_manager.js"), "runScenarioApplyRequest");
  for (const mode of ["success", "no-pending", "failure", "cancelled", "replaced", "other-scene", "other-pending"]) {
    const state = { activeScenarioId: "alpha", runtimeChunkLoadState: {
      pendingReason: mode === "no-pending" ? "" : "scenario-apply",
      pendingScenarioApplyRequestId: mode === "other-pending" ? 2 : 1,
    } };
    const calls = [];
    const dependencies = {
      runtimeState: state,
      getScenarioFatalRecoveryState: () => null,
      beginScenarioApplyRequestState: () => { state.scenarioApplyInFlight = true; },
      syncScenarioUi: () => {}, recordRenderTransactionSnapshot: () => {},
      getSearchParams: () => new URLSearchParams(),
      loadScenarioBundle: async () => ({ manifest: { scenario_id: "alpha" } }),
      scheduleScenarioDeferredBundleMetadataLoad: () => {},
      isScenarioApplyRequestCurrent: () => mode !== "cancelled" && mode !== "replaced",
      applyScenarioBundle: async () => {
        if (mode === "failure") throw new Error("apply failed");
        if (mode === "other-scene") state.activeScenarioId = "beta";
      },
      normalizeScenarioId: value => String(value || ""),
      clearActiveScenarioApplyRequestState: () => { state.scenarioApplyInFlight = false; },
      trimScenarioBundleCaches: () => { assert.equal(state.scenarioApplyInFlight, false); },
      scheduleScenarioChunkRefresh: options => {
        assert.equal(state.scenarioApplyInFlight, false);
        calls.push(options);
      },
    };
    const run = new Function("dependencies", `
      const { ${Object.keys(dependencies).join(",")} } = dependencies;
      let activeScenarioApplyPromise = null, activeScenarioApplyTargetId = "", activeScenarioApplyRequestId = 0;
      return async function(request) { ${body} };
    `)(dependencies);
    const result = run({ requestId: 1, scenarioId: "alpha" });
    if (mode === "failure") await assert.rejects(result, /apply failed/);
    else await result;
    assert.equal(calls.length, mode === "success" ? 1 : 0, mode);
    if (calls.length) assert.deepEqual(calls[0], { flushPending: true, scenarioApplyRequestId: 1 });
  }
});

