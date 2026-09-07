import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  classifyRenderTransactionPhaseKind,
  exposeRenderTransactionDiagnostics,
  getMergedPayloadStateForDiagnostics,
  getRenderTransactionGlobalName,
  nextScenarioApplyEpoch,
  recordPendingPoliticalColorEditClearDiagnostics,
  recordRenderInvariantWarning,
  recordRenderPassInvalidation,
  recordRenderTransactionSnapshot,
  recordVisibleFrameTransactionDiagnostics,
  registerRenderTransactionOptionalLayerConfigs,
  RENDER_TRANSACTION_WARNING_CODES,
} from "../js/core/renderer/render_transaction_diagnostics.js";

const REPO_ROOT = process.cwd();

function readRepoFile(...relativeParts) {
  return fs.readFileSync(path.join(REPO_ROOT, ...relativeParts), "utf8");
}

function withGlobalDiagnosticsReset(callback) {
  const globalName = getRenderTransactionGlobalName();
  const hadGlobal = Object.prototype.hasOwnProperty.call(globalThis, globalName);
  const previous = globalThis[globalName];
  try {
    delete globalThis[globalName];
    callback(globalName);
  } finally {
    if (hadGlobal) {
      globalThis[globalName] = previous;
    } else {
      delete globalThis[globalName];
    }
  }
}

test("render transaction snapshots stay bounded and expose enabled diagnostics", () => {
  withGlobalDiagnosticsReset((globalName) => {
    const runtimeState = {
      activeScenarioId: "tno_1962",
      ui: { developerMode: true },
      renderPassCache: {},
    };

    for (let index = 0; index < 205; index += 1) {
      recordRenderTransactionSnapshot(runtimeState, {
        phase: `phase-${index}`,
        reason: "bounded-test",
        expectedScenarioId: "tno_1962",
        source: "test",
      });
    }

    const diagnostics = runtimeState.renderTransactionDiagnostics;
    assert.equal(diagnostics.sequence, 205);
    assert.equal(diagnostics.snapshots.length, 200);
    assert.equal(diagnostics.snapshots[0].phase, "phase-5");
    assert.equal(diagnostics.latestSnapshot.phase, "phase-204");
    assert.equal(globalThis[globalName].latest.phase, "phase-204");
    assert.equal(globalThis[globalName].snapshots, diagnostics.snapshots);
  });
});

test("render transaction snapshots keep one entry in ordinary mode", () => {
  withGlobalDiagnosticsReset((globalName) => {
    const runtimeState = {
      activeScenarioId: "hoi4_1939",
      renderPassCache: {},
      landData: { features: [{ id: "A" }] },
      colors: { A: "#112233" },
    };

    recordRenderTransactionSnapshot(runtimeState, { phase: "first", expectedScenarioId: "hoi4_1939" });
    recordRenderTransactionSnapshot(runtimeState, { phase: "second", expectedScenarioId: "hoi4_1939" });
    recordRenderTransactionSnapshot(runtimeState, { phase: "third", expectedScenarioId: "hoi4_1939" });

    assert.equal(runtimeState.renderTransactionDiagnostics.snapshots.length, 1);
    assert.equal(runtimeState.renderTransactionDiagnostics.latestSnapshot.phase, "third");
    assert.equal(globalThis[globalName], undefined);
  });
});

test("render transaction global exposure is removed when diagnostics are disabled", () => {
  withGlobalDiagnosticsReset((globalName) => {
    const runtimeState = {
      activeScenarioId: "tno_1962",
      ui: { developerMode: true },
      renderPassCache: {},
    };

    recordRenderTransactionSnapshot(runtimeState, {
      phase: "enabled",
      expectedScenarioId: "tno_1962",
    });
    assert.equal(globalThis[globalName].enabled, true);

    runtimeState.ui.developerMode = false;
    exposeRenderTransactionDiagnostics(runtimeState);
    assert.equal(globalThis[globalName], undefined);
  });
});

test("visible frame diagnostics use identity-only snapshots on the default render path", () => {
  const colors = new Proxy({}, {
    ownKeys() {
      throw new Error("default visible frame diagnostics must not enumerate colors");
    },
  });
  const runtimeState = {
    activeScenarioId: "tno_1962",
    colors,
    renderPassCache: {},
  };

  const snapshot = recordVisibleFrameTransactionDiagnostics(runtimeState, {
    status: "committed",
    reason: "unit-visible-frame",
    identity: {
      scenarioId: "tno_1962",
      scenarioDataGeneration: 1,
      topologyRevision: 2,
      colorRevision: 3,
      selectionVersion: 4,
    },
    visibleFrameCommitKey: "commit-key",
  });

  assert.equal(snapshot.phase, "visible-frame-committed");
  assert.equal(snapshot.renderPasses.visibleFrameStatus, "committed");
  assert.deepEqual(snapshot.featureCounts, {});
  assert.deepEqual(snapshot.layers, {});
});

test("render transaction identity records scenario and renderer epochs", () => {
  const runtimeState = {
    activeScenarioId: "tno_1962",
    activeScenarioManifest: { scenario_id: "tno_1962" },
    sceneGeneration: 12,
    scenarioDataGeneration: 34,
    topologyRevision: 56,
    colorRevision: 78,
    runtimeChunkLoadState: { selectionVersion: 9 },
    renderPassCache: {},
    colors: { featureA: "#778899" },
  };

  const snapshot = recordRenderTransactionSnapshot(runtimeState, {
    phase: "identity-test",
    expectedScenarioId: "tno_1962",
    extra: {
      scenarioApplyEpoch: 3,
      renderTransactionEpoch: 4,
    },
  });

  assert.equal(snapshot.activeScenarioId, "tno_1962");
  assert.equal(snapshot.activeScenarioManifestId, "tno_1962");
  assert.equal(snapshot.scenarioApplyEpoch, 3);
  assert.equal(snapshot.renderTransactionEpoch, 4);
  assert.equal(snapshot.sceneGeneration, 12);
  assert.equal(snapshot.scenarioDataGeneration, 34);
  assert.equal(snapshot.topologyRevision, 56);
  assert.equal(snapshot.colorRevision, 78);
  assert.equal(snapshot.selectionVersion, 9);
});

test("render transaction phases classify readiness boundaries", () => {
  assert.equal(classifyRenderTransactionPhaseKind("render-pass-invalidated"), "transient");
  assert.equal(classifyRenderTransactionPhaseKind("scenario-chunk-promotion-visual-start"), "transient");
  assert.equal(classifyRenderTransactionPhaseKind("scenario-chunk-promotion-visual-complete"), "stable");
  assert.equal(classifyRenderTransactionPhaseKind("scenario-post-apply-start"), "transient");
  assert.equal(classifyRenderTransactionPhaseKind("scenario-refresh-map-data-start"), "transient");
  assert.equal(classifyRenderTransactionPhaseKind("visible-frame-committed"), "stable");

  const runtimeState = {
    activeScenarioId: "tno_1962",
    runtimeChunkLoadState: {
      lastSelection: {
        selectionVersion: 1,
        requiredChunkIds: ["political.coarse.r0c0"],
      },
    },
    activeScenarioChunks: { loadedChunkIds: ["political.coarse.r0c0"] },
    renderPassCache: {},
  };

  const transientSnapshot = recordRenderTransactionSnapshot(runtimeState, {
    phase: "scenario-chunk-promotion-visual-start",
    expectedScenarioId: "tno_1962",
  });
  assert.equal(transientSnapshot.phaseKind, "transient");
  assert.ok(transientSnapshot.warnings.some(
    (warning) => warning.code === RENDER_TRANSACTION_WARNING_CODES.politicalVisibleSubsetEmptyWithRequiredChunks
      && warning.phaseKind === "transient"
  ));

  const stableSnapshot = recordRenderTransactionSnapshot(runtimeState, {
    phase: "scenario-chunk-promotion-visual-complete",
    expectedScenarioId: "tno_1962",
  });
  assert.equal(stableSnapshot.phaseKind, "stable");
  assert.ok(stableSnapshot.warnings.some(
    (warning) => warning.code === RENDER_TRANSACTION_WARNING_CODES.politicalVisibleSubsetEmptyWithRequiredChunks
      && warning.phaseKind === "stable"
  ));
});

test("pending color edit lifecycle resets are separate from missing render proof", () => {
  const lifecycleResetState = {
    activeScenarioId: "modern_world",
    landData: { features: [{ id: "A" }] },
    colors: { A: "#112233" },
    renderPassCache: {},
  };
  const resetSnapshot = recordPendingPoliticalColorEditClearDiagnostics(lifecycleResetState, {
    resetReason: "set-map-data",
    pendingFeatureCount: 3,
    pendingReason: "refresh-colors",
    inputLabel: "refresh-colors",
    renderedCount: 0,
    renderedIdCount: 0,
    force: true,
    paintSource: "set-map-data",
  });
  assert.equal(resetSnapshot.phaseKind, "stable");
  assert.equal(resetSnapshot.extra.clearedWithoutRender, false);
  assert.equal(lifecycleResetState.renderTransactionDiagnostics.warnings.length, 0);

  const fillState = {
    activeScenarioId: "tno_1962",
    landData: { features: [{ id: "A" }] },
    colors: { A: "#112233" },
    renderPassCache: {},
  };
  const fillSnapshot = recordPendingPoliticalColorEditClearDiagnostics(fillState, {
    resetReason: "force",
    pendingFeatureCount: 3,
    pendingReason: "refresh-colors",
    inputLabel: "refresh-colors",
    renderedCount: 0,
    renderedIdCount: 0,
    force: true,
    paintSource: "political-pass",
  });
  assert.equal(fillSnapshot.extra.clearedWithoutRender, true);
  assert.ok(fillState.renderTransactionDiagnostics.warnings.some(
    (warning) => warning.code === RENDER_TRANSACTION_WARNING_CODES.pendingColorEditClearedWithoutRender
      && warning.phaseKind === "stable"
  ));
});

test("scenario apply epoch follows the snapshot scenario instead of the latest global apply", () => {
  const runtimeState = {
    activeScenarioId: "alpha",
    renderPassCache: {},
  };
  const alphaEpoch = nextScenarioApplyEpoch(runtimeState, { scenarioId: "alpha", reason: "unit-alpha" });
  assert.equal(alphaEpoch, 1);

  runtimeState.activeScenarioId = "beta";
  const betaEpoch = nextScenarioApplyEpoch(runtimeState, { scenarioId: "beta", reason: "unit-beta" });
  assert.equal(betaEpoch, 2);

  const delayedAlphaSnapshot = recordRenderTransactionSnapshot(runtimeState, {
    phase: "delayed-alpha-post-apply",
    expectedScenarioId: "alpha",
    extra: { allowScenarioMismatch: true },
  });
  const betaSnapshot = recordRenderTransactionSnapshot(runtimeState, {
    phase: "current-beta-post-apply",
    expectedScenarioId: "beta",
  });

  assert.equal(delayedAlphaSnapshot.scenarioApplyEpoch, alphaEpoch);
  assert.equal(betaSnapshot.scenarioApplyEpoch, betaEpoch);
});

test("explicit scenario apply epoch wins after the same scenario is applied again", () => {
  const runtimeState = {
    activeScenarioId: "alpha",
    renderPassCache: {},
  };
  const firstAlphaEpoch = nextScenarioApplyEpoch(runtimeState, { scenarioId: "alpha", reason: "first-alpha" });
  const secondAlphaEpoch = nextScenarioApplyEpoch(runtimeState, { scenarioId: "alpha", reason: "second-alpha" });

  const delayedFirstAlphaSnapshot = recordRenderTransactionSnapshot(runtimeState, {
    phase: "delayed-first-alpha-chunk",
    expectedScenarioId: "alpha",
    extra: {
      scenarioApplyEpoch: firstAlphaEpoch,
    },
  });
  const latestAlphaSnapshot = recordRenderTransactionSnapshot(runtimeState, {
    phase: "latest-alpha-chunk",
    expectedScenarioId: "alpha",
  });

  assert.equal(delayedFirstAlphaSnapshot.scenarioApplyEpoch, firstAlphaEpoch);
  assert.equal(latestAlphaSnapshot.scenarioApplyEpoch, secondAlphaEpoch);
});

test("registered layer configs drive layer snapshots", () => {
  const runtimeState = {
    activeScenarioId: "tno_1962",
    activeScenarioManifest: {
      scenario_id: "tno_1962",
      required_semantic_layers: ["custom_layer"],
    },
    showCustomLayer: true,
    customLayerRevision: 7,
    customLayerPayload: { features: [{ id: "custom-1" }] },
    renderPassCache: {},
  };
  registerRenderTransactionOptionalLayerConfigs(runtimeState, {
    custom_layer: {
      stateField: "customLayerPayload",
      visibilityField: "showCustomLayer",
      revisionField: "customLayerRevision",
    },
  });

  const snapshot = recordRenderTransactionSnapshot(runtimeState, {
    phase: "registered-layer-test",
    expectedScenarioId: "tno_1962",
  });

  assert.equal(snapshot.layers.custom_layer.visible, true);
  assert.equal(snapshot.layers.custom_layer.required, true);
  assert.equal(snapshot.layers.custom_layer.stateFeatureCount, 1);
  assert.equal(snapshot.layers.custom_layer.revision, 7);
  assert.equal(snapshot.warnings.some(
    (warning) => warning.code === RENDER_TRANSACTION_WARNING_CODES.visibleRequiredLayerMissing
  ), false);
});

test("semantic layer diagnostics keep optional selected layers out of required coverage", () => {
  const runtimeState = {
    activeScenarioId: "tno_1962",
    activeScenarioManifest: {
      scenario_id: "tno_1962",
      required_semantic_layers: [],
    },
    showScenarioReliefOverlays: true,
    runtimeChunkLoadState: {
      lastSelection: {
        requiredChunkIds: ["political.detail.r0c0"],
        optionalChunkIds: ["relief.detail.r0c0"],
      },
    },
    activeScenarioChunks: {
      mergedLayerPayloads: {},
      loadedChunkIds: [],
    },
    renderPassCache: {},
  };

  const snapshot = recordRenderTransactionSnapshot(runtimeState, {
    phase: "visible-frame-committed",
    expectedScenarioId: "tno_1962",
  });

  assert.equal(snapshot.layers.relief.visible, true);
  assert.equal(snapshot.layers.relief.manifestRequired, false);
  assert.equal(snapshot.layers.relief.requiredByRequiredChunk, false);
  assert.equal(snapshot.layers.relief.selectedAsOptionalChunk, true);
  assert.equal(snapshot.layers.relief.required, false);
  assert.equal(snapshot.layers.relief.selected, true);
  assert.equal(snapshot.layers.relief.coverageStatus, "optional-deferred");
  assert.equal(snapshot.layers.relief.missingReason, "optional-deferred");
  assert.equal(snapshot.warnings.some(
    (warning) => warning.code === RENDER_TRANSACTION_WARNING_CODES.visibleRequiredLayerMissing
  ), false);
});

test("semantic layer diagnostics record visible required missing with source reason", () => {
  const runtimeState = {
    activeScenarioId: "tno_1962",
    activeScenarioManifest: {
      scenario_id: "tno_1962",
      required_semantic_layers: ["scenario_atlantropa"],
    },
    showScenarioAtlantropa: true,
    activeScenarioChunks: {
      mergedLayerPayloads: {
        scenario_atlantropa: null,
      },
      loadedChunkIds: [],
    },
    renderPassCache: {},
  };

  const snapshot = recordRenderTransactionSnapshot(runtimeState, {
    phase: "visible-frame-committed",
    expectedScenarioId: "tno_1962",
  });
  const layer = snapshot.layers.scenario_atlantropa;
  const warning = snapshot.warnings.find(
    (entry) => entry.code === RENDER_TRANSACTION_WARNING_CODES.visibleRequiredLayerMissing
  );

  assert.equal(layer.manifestRequired, true);
  assert.equal(layer.required, true);
  assert.equal(layer.coverageStatus, "required-missing");
  assert.equal(layer.sourceKind, "explicit-empty");
  assert.equal(layer.missingReason, "explicit-empty");
  assert.ok(warning);
  assert.equal(warning.phaseKind, "stable");
  assert.equal(warning.details.layerKey, "scenario_atlantropa");
  assert.equal(warning.details.requiredReason, "manifest");
  assert.equal(warning.details.coverageStatus, "required-missing");
  assert.equal(warning.details.missingReason, "explicit-empty");
});

test("semantic layer diagnostics report required chunks still loading before missing", () => {
  const runtimeState = {
    activeScenarioId: "tno_1962",
    activeScenarioManifest: {
      scenario_id: "tno_1962",
      required_semantic_layers: [],
    },
    showScenarioReliefOverlays: true,
    scenarioReliefOverlaysData: null,
    runtimeChunkLoadState: {
      lastSelection: {
        requiredChunkIds: ["relief.coarse.r0c0"],
        optionalChunkIds: [],
      },
    },
    activeScenarioChunks: {
      mergedLayerPayloads: {
        relief: null,
      },
      loadedChunkIds: [],
    },
    renderPassCache: {},
  };

  const snapshot = recordRenderTransactionSnapshot(runtimeState, {
    phase: "visible-frame-committed",
    expectedScenarioId: "tno_1962",
  });
  const layer = snapshot.layers.relief;

  assert.equal(layer.visible, true);
  assert.equal(layer.required, true);
  assert.equal(layer.requiredByRequiredChunk, true);
  assert.equal(layer.sourceKind, "explicit-empty");
  assert.equal(layer.coverageStatus, "transient-loading");
  assert.equal(layer.missingReason, "not-yet-loaded");
  assert.deepEqual(layer.expectedChunkIds, ["relief.coarse.r0c0"]);
  assert.deepEqual(layer.loadedChunkIds, []);
  assert.deepEqual(layer.missingChunkIds, ["relief.coarse.r0c0"]);
  assert.equal(snapshot.warnings.some(
    (warning) => warning.code === RENDER_TRANSACTION_WARNING_CODES.visibleRequiredLayerMissing
  ), false);
});

test("semantic layer diagnostics record water and Atlantropa required coverage", () => {
  const runtimeState = {
    activeScenarioId: "tno_1962",
    activeScenarioManifest: {
      scenario_id: "tno_1962",
      required_semantic_layers: ["water", "scenario_atlantropa"],
    },
    showWaterRegions: true,
    showScenarioAtlantropa: true,
    scenarioWaterRegionsData: { features: [{ id: "water-1" }] },
    scenarioAtlantropaData: { features: [{ id: "atl-1" }] },
    runtimeChunkLoadState: {
      lastSelection: {
        requiredChunkIds: ["water.detail.r0c0", "scenario_atlantropa.detail.r0c1"],
        optionalChunkIds: [],
      },
    },
    activeScenarioChunks: {
      mergedLayerPayloads: {
        water: { features: [{ id: "water-1" }] },
        scenario_atlantropa: { features: [{ id: "atl-1" }] },
      },
      loadedChunkIds: ["water.detail.r0c0", "scenario_atlantropa.detail.r0c1"],
    },
    renderPassCache: {},
  };

  const snapshot = recordRenderTransactionSnapshot(runtimeState, {
    phase: "visible-frame-committed",
    expectedScenarioId: "tno_1962",
  });

  ["water", "scenario_atlantropa"].forEach((layerKey) => {
    const layer = snapshot.layers[layerKey];
    assert.equal(layer.visible, true);
    assert.equal(layer.required, true);
    assert.equal(layer.manifestRequired, true);
    assert.equal(layer.requiredByRequiredChunk, true);
    assert.equal(layer.coverageStatus, "present");
    assert.equal(layer.sourceKind, "runtime-state");
    assert.equal(layer.stateFeatureCount, 1);
    assert.equal(layer.mergedFeatureCount, 1);
    assert.equal(layer.missingChunkIds.length, 0);
    assert.equal(layer.loadedChunkIds.length, 1);
    assert.equal(layer.requiredReason, "manifest+required-chunk");
  });
  assert.equal(snapshot.warnings.some(
    (warning) => warning.code === RENDER_TRANSACTION_WARNING_CODES.visibleRequiredLayerMissing
  ), false);
});

test("semantic layer diagnostics distinguish not-owned explicit-empty and present sources", () => {
  const buildSnapshot = (mergedPayloads, runtimeStateOverrides = {}) => recordRenderTransactionSnapshot({
    activeScenarioId: "tno_1962",
    activeScenarioManifest: {
      scenario_id: "tno_1962",
      required_semantic_layers: [],
    },
    showCustomLayer: true,
    runtimeChunkLoadState: {
      lastSelection: {
        requiredChunkIds: [],
        optionalChunkIds: ["custom_layer.detail.r0c0"],
      },
    },
    activeScenarioChunks: {
      mergedLayerPayloads: mergedPayloads,
      loadedChunkIds: ["custom_layer.detail.r0c0"],
    },
    renderPassCache: {},
    ...runtimeStateOverrides,
    renderTransactionDiagnostics: {
      optionalLayerConfigs: {
        custom_layer: {
          stateField: "customLayerPayload",
          visibilityField: "showCustomLayer",
        },
      },
    },
  }, {
    phase: "visible-frame-committed",
    expectedScenarioId: "tno_1962",
  });

  const notOwned = buildSnapshot({});
  assert.equal(notOwned.layers.custom_layer.sourceKind, "not-owned");
  assert.equal(notOwned.layers.custom_layer.sourceStatus, "not-owned");
  assert.equal(notOwned.layers.custom_layer.coverageStatus, "optional-deferred");

  const explicitEmpty = buildSnapshot({ custom_layer: null });
  assert.equal(explicitEmpty.layers.custom_layer.sourceKind, "explicit-empty");
  assert.equal(explicitEmpty.layers.custom_layer.sourceStatus, "empty");
  assert.equal(explicitEmpty.layers.custom_layer.coverageStatus, "explicit-empty");
  assert.equal(explicitEmpty.layers.custom_layer.missingReason, "explicit-empty");

  const present = buildSnapshot({ custom_layer: { features: [{ id: "custom-1" }] } });
  assert.equal(present.layers.custom_layer.sourceKind, "merged-chunk");
  assert.equal(present.layers.custom_layer.sourceStatus, "present");
  assert.equal(present.layers.custom_layer.coverageStatus, "present");
  assert.equal(present.layers.custom_layer.mergedFeatureCount, 1);

  const stateEmptyMergedPresent = buildSnapshot(
    { custom_layer: { features: [{ id: "custom-2" }] } },
    { customLayerPayload: null }
  );
  assert.equal(stateEmptyMergedPresent.layers.custom_layer.sourceKind, "merged-chunk");
  assert.equal(stateEmptyMergedPresent.layers.custom_layer.sourceStatus, "present");
  assert.equal(stateEmptyMergedPresent.layers.custom_layer.coverageStatus, "present");
  assert.equal(stateEmptyMergedPresent.layers.custom_layer.mergedFeatureCount, 1);
});

test("render transaction diagnostics classify invariant warnings", () => {
  assert.equal(getMergedPayloadStateForDiagnostics(undefined), "not-owned");
  assert.equal(getMergedPayloadStateForDiagnostics(null), "empty");
  assert.equal(getMergedPayloadStateForDiagnostics({}), "empty");
  assert.equal(getMergedPayloadStateForDiagnostics({ features: [{ id: "A" }] }), "present");

  const requiredLayerState = {
    activeScenarioId: "tno_1962",
    activeScenarioManifest: {
      scenario_id: "tno_1962",
      required_semantic_layers: ["scenario_atlantropa"],
    },
    showScenarioAtlantropa: true,
    renderPassCache: {},
  };
  const requiredLayerSnapshot = recordRenderTransactionSnapshot(requiredLayerState, {
    phase: "required-layer-test",
    expectedScenarioId: "tno_1962",
  });
  assert.ok(requiredLayerSnapshot.warnings.some(
    (warning) => warning.code === RENDER_TRANSACTION_WARNING_CODES.visibleRequiredLayerMissing
  ));

  const requiredLayerWithStatePayload = {
    activeScenarioId: "tno_1962",
    activeScenarioManifest: {
      scenario_id: "tno_1962",
      required_semantic_layers: ["scenario_atlantropa"],
    },
    showScenarioAtlantropa: true,
    scenarioAtlantropaData: { features: [{ id: "atl" }] },
    renderPassCache: {},
  };
  const layerWithStateSnapshot = recordRenderTransactionSnapshot(requiredLayerWithStatePayload, {
    phase: "required-layer-present-state-test",
    expectedScenarioId: "tno_1962",
  });
  assert.equal(layerWithStateSnapshot.warnings.some(
    (warning) => warning.code === RENDER_TRANSACTION_WARNING_CODES.visibleRequiredLayerMissing
  ), false);

  const colorsState = {
    activeScenarioId: "tno_1962",
    landData: { features: [{ id: "A" }] },
    colors: {},
    renderPassCache: {},
  };
  const colorsSnapshot = recordRenderTransactionSnapshot(colorsState, {
    phase: "color-test",
    expectedScenarioId: "tno_1962",
  });
  assert.ok(colorsSnapshot.warnings.some(
    (warning) => warning.code === RENDER_TRANSACTION_WARNING_CODES.resolvedColorsEmptyWithLand
  ));

  const startupShellColorSnapshot = recordRenderTransactionSnapshot({
    landData: { features: [{ id: "A" }] },
    colors: {},
    renderPassCache: {},
  }, {
    phase: "visible-frame-committed",
  });
  assert.equal(startupShellColorSnapshot.warnings.some(
    (warning) => warning.code === RENDER_TRANSACTION_WARNING_CODES.resolvedColorsEmptyWithLand
  ), false);

  const politicalChunkState = {
    activeScenarioId: "tno_1962",
    runtimeChunkLoadState: {
      lastSelection: {
        selectionVersion: 1,
        requiredChunkIds: ["political.coarse.0"],
      },
    },
    activeScenarioChunks: { loadedChunkIds: [] },
    renderPassCache: {},
  };
  const politicalSnapshot = recordRenderTransactionSnapshot(politicalChunkState, {
    phase: "political-chunk-test",
    expectedScenarioId: "tno_1962",
  });
  assert.ok(politicalSnapshot.warnings.some(
    (warning) => warning.code === RENDER_TRANSACTION_WARNING_CODES.politicalVisibleSubsetEmptyWithRequiredChunks
  ));
});

test("visible frame reuse warns when data generations advance", () => {
  const runtimeState = {
    activeScenarioId: "tno_1962",
    scenarioDataGeneration: 1,
    topologyRevision: 1,
    colorRevision: 1,
    runtimeChunkLoadState: { selectionVersion: 1 },
    renderPassCache: {},
  };

  recordRenderTransactionSnapshot(runtimeState, {
    phase: "visible-frame-committed",
    expectedScenarioId: "tno_1962",
    extra: {
      visibleFrameStatus: "committed",
      scenarioDataGeneration: 1,
      topologyRevision: 1,
      colorRevision: 1,
      selectionVersion: 1,
    },
  });

  runtimeState.scenarioDataGeneration = 2;
  const snapshot = recordRenderTransactionSnapshot(runtimeState, {
    phase: "visible-frame-reused",
    expectedScenarioId: "tno_1962",
    extra: {
      visibleFrameStatus: "reused",
      scenarioDataGeneration: 2,
      topologyRevision: 1,
      colorRevision: 1,
      selectionVersion: 1,
    },
  });

  assert.ok(snapshot.warnings.some(
    (warning) => warning.code === RENDER_TRANSACTION_WARNING_CODES.renderReuseAcrossDataGeneration
  ));
});

test("visible frame reuse warns when the active scenario changes", () => {
  const runtimeState = {
    activeScenarioId: "alpha",
    scenarioDataGeneration: 1,
    topologyRevision: 1,
    colorRevision: 1,
    runtimeChunkLoadState: { selectionVersion: 1 },
    renderPassCache: {},
  };

  recordRenderTransactionSnapshot(runtimeState, {
    phase: "visible-frame-committed",
    expectedScenarioId: "alpha",
    extra: {
      scenarioApplyEpoch: 1,
      visibleFrameStatus: "committed",
      scenarioDataGeneration: 1,
      topologyRevision: 1,
      colorRevision: 1,
      selectionVersion: 1,
    },
  });

  runtimeState.activeScenarioId = "beta";
  const snapshot = recordRenderTransactionSnapshot(runtimeState, {
    phase: "visible-frame-reused",
    expectedScenarioId: "beta",
    extra: {
      scenarioApplyEpoch: 2,
      visibleFrameStatus: "reused",
      scenarioDataGeneration: 1,
      topologyRevision: 1,
      colorRevision: 1,
      selectionVersion: 1,
    },
  });

  assert.ok(snapshot.warnings.some(
    (warning) => warning.code === RENDER_TRANSACTION_WARNING_CODES.renderReuseAcrossDataGeneration
  ));
});

test("chunk runtime source preserves scenario apply epoch on async promotion snapshots", () => {
  const chunkRuntime = readRepoFile("js", "core", "scenario", "chunk_runtime.js");

  [
    "scenarioApplyEpochBySelectionVersion",
    "selectionScenarioApplyEpoch",
    "pendingPromotion?.scenarioApplyEpoch",
    "promotionScenarioApplyEpoch",
    "recordRenderTransactionSnapshotBase",
  ].forEach((token) => assert.ok(chunkRuntime.includes(token), `chunk runtime should include ${token}`));
});

test("manual render warnings and pass invalidations are retained", () => {
  const runtimeState = {
    activeScenarioId: "tno_1962",
    renderPassCache: {},
  };

  const invalidation = recordRenderPassInvalidation(runtimeState, ["political", "labels"], "test-invalidation");
  const warning = recordRenderInvariantWarning(runtimeState, {
    code: RENDER_TRANSACTION_WARNING_CODES.pendingColorEditClearedWithoutRender,
    phase: "unit-test",
    reason: "manual",
    details: { pendingFeatureCount: 2 },
  });
  const snapshot = recordRenderTransactionSnapshot(runtimeState, {
    phase: "invalidation-test",
    expectedScenarioId: "tno_1962",
  });

  assert.deepEqual(invalidation.passNames, ["political", "labels"]);
  assert.equal(warning.code, RENDER_TRANSACTION_WARNING_CODES.pendingColorEditClearedWithoutRender);
  assert.deepEqual(snapshot.renderPasses.lastInvalidatedPasses, ["political", "labels"]);
  assert.equal(snapshot.renderPasses.lastInvalidationReason, "test-invalidation");
});

test("render transaction instrumentation remains wired into apply, chunk, and renderer flows", () => {
  const scenarioManager = readRepoFile("js", "core", "scenario_manager.js");
  const scenarioPipeline = readRepoFile("js", "core", "scenario_apply_pipeline.js");
  const postApply = readRepoFile("js", "core", "scenario_post_apply_effects.js");
  const chunkRuntime = readRepoFile("js", "core", "scenario", "chunk_runtime.js");
  const mapRenderer = readRepoFile("js", "core", "map_renderer.js");
  const renderDiagnostics = readRepoFile("js", "core", "renderer", "render_transaction_diagnostics.js");
  const scenarioResources = readRepoFile("js", "core", "scenario_resources.js");
  const optionalLayers = readRepoFile("js", "core", "scenario", "optional_layer_runtime.js");
  assert.ok(scenarioResources.includes("registerRenderTransactionOptionalLayerConfigs"));
  assert.ok(scenarioResources.includes("optional-layer-state-apply"));

  [
    "scenario-apply-requested",
    "scenario-apply-staged",
    "scenario-apply-committed",
    "scenario-post-apply-complete",
    "scenarioApplyInflightTargetMismatch",
    "scenario-apply-reused-active-target",
    "scenario-apply-queued-latest-target",
    "scenario-apply-queue-drain-started",
    "scenario-apply-queue-drain-skipped-stale",
    "scenario-apply-queue-drain-complete",
    "scenario-apply-target-committed",
  ].forEach((token) => assert.ok(scenarioManager.includes(token), `scenario_manager should include ${token}`));

  [
    "scenario-apply-pipeline-staged",
    "scenario-apply-runtime-commit-complete",
    "scenario-apply-postcommit-complete",
  ].forEach((token) => assert.ok(scenarioPipeline.includes(token), `scenario_apply_pipeline should include ${token}`));

  [
    "scenario-coarse-prewarm-start",
    "scenario-refresh-map-data-complete",
    "scenario-data-health-refreshed",
    "scenario-detail-prewarm-complete",
    "scenario-apply-stale-callback-skipped",
    "scenarioApplyRequestId",
  ].forEach((token) => assert.ok(postApply.includes(token), `scenario_post_apply_effects should include ${token}`));

  [
    "scenario-chunk-refresh-requested",
    "scenario-chunk-selection-created",
    "scenario-chunk-selection-reused",
    "scenario-chunk-promotion-pending-created",
    "scenario-chunk-promotion-commit-start",
    "scenario-chunk-promotion-visual-complete",
    "scenario-political-chunk-payload-written",
    "scenarioApplyRequestIdBySelectionVersion",
    "political-chunk-payload-write",
  ].forEach((token) => assert.ok(chunkRuntime.includes(token), `chunk_runtime should include ${token}`));

  [
    "render-pass-invalidated",
    "visible-frame-${normalizedStatus}",
    "color-rebuild-complete",
    "pending-political-color-edit-cleared",
    "partial-color-refresh-complete",
    "progressive-political-full-cache-ready",
  ].forEach((token) => assert.ok(
    mapRenderer.includes(token) || renderDiagnostics.includes(token),
    `renderer diagnostics should include ${token}`
  ));

  [
    "optional-layer-visibility-sync-start",
    "optional-layer-visibility-sync-complete",
  ].forEach((token) => assert.ok(optionalLayers.includes(token), `optional_layer_runtime should include ${token}`));
});
