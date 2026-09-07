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

test("scenario manager owns apply requests with same-target reuse and latest-target queue", () => {
  const source = readRepoFile("js", "core", "scenario_manager.js");

  [
    "let activeScenarioApplyRequestId = 0;",
    "let latestQueuedScenarioApplyRequest = null;",
    "let queuedScenarioApplyDrainPromise = null;",
    "function createScenarioApplyRequest(",
    "function isScenarioApplyRequestCurrent(",
    "function runScenarioApplyRequest(",
    "function drainQueuedScenarioApplyRequests()",
    "scenario-apply-reused-active-target",
    "scenario-apply-queued-latest-target",
    "scenario-apply-queue-drain-started",
    "scenario-apply-queue-drain-skipped-stale",
    "scenario-apply-queue-drain-complete",
    "scenario-apply-target-committed",
    "scenario-apply-stale-rollback-complete",
    "resolution: \"queued-latest-request\"",
    "resolution: \"replaced-by-latest-request\"",
    "resolution: \"fatal-recovery-lock\"",
    "requestId: Number(request.requestId)",
    "targetId: normalizedScenarioId",
    "activeScenarioApplyPromise === requestPromise && activeScenarioApplyRequestId === request.requestId",
    "restoreStaleScenarioApplyRollbackSnapshot",
    "restoreScenarioApplyRollbackSnapshot(rollbackSnapshot)",
    "runPostRollbackRestoreEffects({ renderNow })",
  ].forEach((token) => assert.ok(source.includes(token), `scenario_manager should include ${token}`));

  assert.match(
    source,
    /const reuseActiveScenarioApply = Boolean\([\s\S]*?!activeScenarioApplyTargetId[\s\S]*?activeScenarioApplyTargetId === normalizedScenarioId[\s\S]*?if \(reuseActiveScenarioApply\) \{[\s\S]*?return activeScenarioApplyPromise;/,
    "same-target in-flight apply should reuse the active promise",
  );
  assert.match(
    source,
    /recordRenderInvariantWarning\(runtimeState,[\s\S]*?scenarioApplyInflightTargetMismatch[\s\S]*?queueLatestScenarioApplyRequest\(request\);[\s\S]*?return drainQueuedScenarioApplyRequests\(\);/,
    "different-target in-flight apply should queue the latest request",
  );
});

test("stale scenario apply callbacks are fenced at post-apply, optional layer, and chunk writes", () => {
  const postApply = readRepoFile("js", "core", "scenario_post_apply_effects.js");
  const optionalLayers = readRepoFile("js", "core", "scenario", "optional_layer_runtime.js");
  const resources = readRepoFile("js", "core", "scenario_resources.js");
  assert.ok(resources.includes("applyScenarioOptionalLayerState("));
  assert.ok(resources.includes("optional-layer-state-apply"));
  const chunkRuntime = readRepoFile("js", "core", "scenario", "chunk_runtime.js");
  const pipeline = readRepoFile("js", "core", "scenario_apply_pipeline.js");

  [
    "scenario-apply-stale-callback-skipped",
    "shouldContinueScenarioApplyContext(currentnessContext, \"detail-prewarm-after-load\")",
    "shouldContinueScenarioApplyContext(currentnessContext, \"coarse-prewarm-finally-refresh\")",
    "shouldContinueScenarioApplyContext(currentnessContext, \"post-apply-before-data-health\")",
  ].forEach((token) => assert.ok(postApply.includes(token), `post_apply should include ${token}`));

  [
    "scenarioApplyRequestId = 0",
    "optional-layer-visibility-sync-after-load",
  ].forEach((token) => assert.ok(optionalLayers.includes(token), `optional_layer_runtime should include ${token}`));

  [
    "scenarioApplyRequestIdBySelectionVersion",
    "pendingPromotion.scenarioApplyRequestId",
    "political-chunk-payload-write",
    "chunk-refresh-timer",
    "post-commit-refresh-replay",
  ].forEach((token) => assert.ok(chunkRuntime.includes(token), `chunk_runtime should include ${token}`));

  assert.ok(pipeline.includes("scenarioApplyRequestId: Math.max(0, Number(scenarioApplyRequestId || 0))"));
  assert.ok(pipeline.includes("scenarioApplyRequestId: Math.max(0, Number(staged?.scenarioApplyRequestId || 0))"));
});

test("stale commit-start path restores prepare-time palette and detail runtime writes", () => {
  const source = readRepoFile("js", "core", "scenario_manager.js");

  assert.match(
    source,
    /phase: "scenario-apply-stale-callback-skipped"[\s\S]*?callbackPhase: "commit-start"[\s\S]*?restoreStaleScenarioApplyRollbackSnapshot\(\{[\s\S]*?callbackPhase: "commit-start"[\s\S]*?\}\);[\s\S]*?return;/,
    "stale commit-start skip should restore the pre-apply rollback snapshot before returning",
  );
  assert.match(
    source,
    /const restoreStaleScenarioApplyRollbackSnapshot = \(\{ scenarioId, callbackPhase \}\) => \{[\s\S]*?restoreScenarioApplyRollbackSnapshot\(rollbackSnapshot\);[\s\S]*?runPostRollbackRestoreEffects\(\{ renderNow \}\);[\s\S]*?phase: "scenario-apply-stale-rollback-complete"/,
    "stale rollback helper should use the normal rollback snapshot and post-rollback effects",
  );
});

test("scenario prepare publishes no readiness or palette state before commit", () => {
  const source = readRepoFile("js", "core", "scenario_apply_pipeline.js");
  const manager = readRepoFile("js", "core", "scenario_manager.js");
  const paletteActions = readRepoFile(
    "js",
    "core",
    "state",
    "actions",
    "scenario_palette_actions.js",
  );
  const prepareBody = extractFunctionBody(source, "prepareScenarioApplyState");

  [
    "ensureScenarioDetailTopologyLoaded(",
    "applyActivePaletteState(",
    "setActivePaletteSource(",
  ].forEach((mutationEntry) => {
    assert.equal(
      prepareBody.includes(mutationEntry),
      false,
      `prepareScenarioApplyState should stage ${mutationEntry} without invoking a mutating dependency`,
    );
  });
  assert.ok(
    prepareBody.includes("scenarioReadinessPatch"),
    "prepare should return an explicit readiness patch for the commit phase",
  );
  assert.ok(
    prepareBody.includes("scenarioPalettePatch"),
    "prepare should return an explicit palette patch for the commit phase",
  );
  assert.ok(
    source.includes("prepareScenarioDetailTopologyState"),
    "scenario pipeline should consume the pure detail staging API",
  );
  assert.ok(
    manager.includes("prepareScenarioDetailTopologyState,"),
    "scenario manager should wire the pure detail staging API into the pipeline",
  );
  assert.doesNotMatch(
    manager,
    /prepareScenarioDetailTopologyState[\s\S]*?ensureDetailTopologyBoundary\(/,
    "pure detail staging should not traverse the render boundary",
  );
  assert.match(
    source,
    /publishObservers:\s*false[\s\S]*?syncDefaultPalette:\s*false/,
    "palette staging should suppress observer publication and default-palette synchronization",
  );
  [
    "captureScenarioPaletteState",
    "commitScenarioPaletteState",
    "restoreScenarioPaletteState",
  ].forEach((actionName) => {
    assert.ok(
      source.includes(actionName),
      `scenario pipeline should delegate palette authority to ${actionName}`,
    );
  });
  [
    "buildCompleteAuthorityPatch",
    "capturePaletteAuthorityState",
    "commitPaletteAuthorityState",
    "restorePaletteAuthorityState",
  ].forEach((legacyHelper) => {
    assert.equal(
      source.includes(legacyHelper),
      false,
      `scenario pipeline should not retain legacy target mutation helper ${legacyHelper}`,
    );
  });
  assert.doesNotMatch(
    paletteActions,
    /^\s*import\s/m,
    "scenario palette actions should remain import-free",
  );
});

test("scenario activation validates before commit and publishes observers after commit", () => {
  const source = readRepoFile("js", "core", "scenario_apply_pipeline.js");
  const applyBody = extractFunctionBody(source, "applyPreparedScenarioState");
  const validateIndex = applyBody.indexOf("validateScenarioActivationCommitState(");
  const commitIndex = applyBody.indexOf("commitScenarioActivationState(");
  const publishIndex = applyBody.indexOf("publishScenarioActivationObservers(");
  const palettePublishIndex = applyBody.indexOf(
    "publishScenarioPaletteAndToolbarState(",
  );

  assert.ok(validateIndex >= 0, "apply should validate the complete transaction patch");
  assert.ok(commitIndex > validateIndex, "runtime commit should follow validation");
  assert.ok(publishIndex > commitIndex, "observer publication should follow runtime commit");
  assert.ok(
    palettePublishIndex > publishIndex,
    "palette publication should follow every commit observer",
  );
  assert.match(
    applyBody,
    /if \(staged\.scenarioPaletteSyncRequested\) \{[\s\S]*?publishScenarioPaletteAndToolbarState\(/,
  );
  assert.ok(
    applyBody.includes("captureScenarioActivationTransactionState("),
    "apply should capture the complete rollback state before validation and commit",
  );
  assert.ok(
    applyBody.includes("restoreScenarioActivationTransactionState("),
    "apply should restore the complete transaction state when commit or observer publication throws",
  );
  assert.equal(
    source.includes("runScenarioActivationPreCommitPhase"),
    false,
    "post-commit observer publication should not retain a pre-commit name",
  );
  assert.ok(
    source.includes("publishScenarioActivationStateObservers"),
    "post-commit state observers should use an explicit observer publication name",
  );
  const manager = readRepoFile("js", "core", "scenario_manager.js");
  const postApply = readRepoFile(
    "js",
    "core",
    "scenario_post_apply_effects.js",
  );
  assert.ok(
    manager.includes("publishScenarioPaletteAndToolbarState,"),
    "scenario manager should wire the canonical palette publisher",
  );
  assert.match(
    extractFunctionBody(
      postApply,
      "publishScenarioPaletteAndToolbarState",
    ),
    /syncResolvedDefaultCountryPalette\([\s\S]*?runPaletteAndToolbarRefreshCallbacks\(\)/,
  );
  assert.match(
    extractFunctionBody(postApply, "runPostRollbackRestoreEffects"),
    /publishScenarioPaletteAndToolbarState\(\)/,
  );
});

test("same-scenario deferred metadata writes are fenced by request id and apply epoch", () => {
  const source = readRepoFile("js", "core", "scenario_resources.js");
  const scheduleBody = extractFunctionBody(
    source,
    "scheduleScenarioDeferredBundleMetadataLoad",
  );
  const applyBody = extractFunctionBody(source, "applyDeferredScenarioMetadata");

  for (const [name, body] of [
    ["scheduleScenarioDeferredBundleMetadataLoad", scheduleBody],
    ["applyDeferredScenarioMetadata", applyBody],
  ]) {
    assert.ok(body.includes("scenarioApplyRequestId"), `${name} should carry request ownership`);
    assert.ok(body.includes("scenarioApplyEpoch"), `${name} should carry apply epoch ownership`);
    assert.ok(
      body.includes("shouldContinueScenarioApplyContext("),
      `${name} should reject stale same-scenario continuations`,
    );
  }
  assert.match(
    source,
    /applyDeferredScenarioMetadata\(bundle,\s*\{[\s\S]*?scenarioId,[\s\S]*?scenarioApplyEpoch,[\s\S]*?scenarioApplyRequestId,[\s\S]*?isScenarioApplyRequestCurrent,[\s\S]*?\}\)/,
    "the scheduled continuation should forward the complete request identity to the deferred apply",
  );
});
