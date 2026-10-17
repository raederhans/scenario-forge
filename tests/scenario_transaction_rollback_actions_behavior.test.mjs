import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  captureScenarioActivationState,
  restoreScenarioActivationAfterColorDirtyState,
  restoreScenarioActivationBeforeAuditState,
  restoreScenarioActivationBeforeColorDirtyState,
  SCENARIO_ACTIVATION_STATE_KEYS,
} from "../js/core/state/actions/scenario_activation_actions.js";
import {
  captureScenarioPaletteState,
  restoreScenarioPaletteState,
  SCENARIO_PALETTE_STATE_KEYS,
} from "../js/core/state/actions/scenario_palette_actions.js";
import {
  captureActiveScenarioPerformanceHintsState,
  captureScenarioPresentationState,
  restoreScenarioTransactionPresentationBeforeAuditState,
  restoreScenarioTransactionPresentationState,
  setActiveScenarioPerformanceHintsState,
  SCENARIO_PRESENTATION_STATE_KEYS,
} from "../js/core/state/actions/scenario_presentation_actions.js";
import {
  captureScenarioHealthState,
  restoreScenarioDataHealthState,
  restoreScenarioHydrationHealthGateState,
} from "../js/core/state/actions/scenario_health_actions.js";
import {
  restoreScenarioReadinessState,
  SCENARIO_READINESS_STATE_KEYS,
} from "../js/core/state/actions/scenario_readiness_actions.js";
import {
  captureScenarioTransactionRollbackOptionalState,
  captureScenarioTransactionRollbackSupplementalState,
  SCENARIO_TRANSACTION_ROLLBACK_SUPPLEMENTAL_HANDOFF_PHASE_BY_KEY,
  SCENARIO_TRANSACTION_ROLLBACK_OPTIONAL_STATE_KEYS,
  SCENARIO_TRANSACTION_ROLLBACK_SUPPLEMENTAL_STATE_KEYS,
  validateScenarioTransactionRollbackSupplementalStatePatch,
} from "../js/core/state/actions/scenario_transaction_rollback_actions.js";
import {
  patchScenarioChunkLoadState,
  replaceScenarioChunkRuntimeState,
  setScenarioChunkRuntimeHooksState,
} from "../js/core/state/actions/scenario_chunk_runtime_actions.js";
import {
  setDefaultRuntimePoliticalTopologyState,
  setScenarioPoliticalChunkPayloadState,
} from "../js/core/state/actions/scenario_chunk_promotion_actions.js";
import { cloneScenarioStateValue } from "../js/core/scenario/shared.js";
import { createScenarioRollbackClone } from "../js/core/scenario/rollback_clone.js";
import { trimScenarioBundleCache } from "../js/core/scenario/bundle_cache.js";
import {
  createDefaultActiveScenarioChunksState,
  createDefaultScenarioHydrationHealthGate,
  createDefaultRuntimeChunkLoadState,
} from "../js/core/state/scenario_runtime_state.js";
import {
  bumpScenarioDataGenerationState,
  bumpSceneGenerationState,
  ensureSceneSnapshotState,
} from "../js/core/state/renderer_runtime_state.js";
import { normalizeMapSemanticMode } from "../js/core/state_defaults.js";
import { makeFixture } from "./helpers/river_paint_fixture.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const ACTION_SOURCE = fs.readFileSync(
  path.join(
    REPO_ROOT,
    "js/core/state/actions/scenario_transaction_rollback_actions.js",
  ),
  "utf8",
);
const ROLLBACK_SOURCE = fs.readFileSync(
  path.join(REPO_ROOT, "js/core/scenario_rollback.js"),
  "utf8",
);

const EXPECTED_SUPPLEMENTAL_KEYS = Object.freeze([
  "defaultRuntimePoliticalTopology",
  "scenarioPoliticalChunkData",
  "scenarioPoliticalVisibleChunkData",
  "activeScenarioChunks",
  "runtimeChunkLoadState",
  "scheduleScenarioChunkRefreshFn",
  "awaitInitialScenarioChunkVisualPromotionFn",
]);

const ALL_DOMAIN_KEYS = Object.freeze([
  ...SCENARIO_ACTIVATION_STATE_KEYS,
  ...SCENARIO_READINESS_STATE_KEYS,
  ...SCENARIO_PRESENTATION_STATE_KEYS,
  ...SCENARIO_PALETTE_STATE_KEYS,
]);

const AUTHORITY_KEY_SETS = Object.freeze({
  activation: SCENARIO_ACTIVATION_STATE_KEYS,
  readiness: SCENARIO_READINESS_STATE_KEYS,
  presentation: SCENARIO_PRESENTATION_STATE_KEYS,
  palette: SCENARIO_PALETTE_STATE_KEYS,
  health: ["scenarioHydrationHealthGate", "scenarioDataHealth"],
  presentationHints: ["activeScenarioPerformanceHints"],
  supplemental: SCENARIO_TRANSACTION_ROLLBACK_SUPPLEMENTAL_STATE_KEYS,
});

const EXPECTED_SUPPLEMENTAL_HANDOFF_PHASE_BY_KEY = Object.freeze({
  defaultRuntimePoliticalTopology: "P4.2b",
  scenarioPoliticalChunkData: "P4.2b",
  scenarioPoliticalVisibleChunkData: "P4.2b",
  activeScenarioChunks: "P4.2b",
  runtimeChunkLoadState: "P4.2b",
  scheduleScenarioChunkRefreshFn: "P4.2b",
  awaitInitialScenarioChunkVisualPromotionFn: "P4.2b",
});

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function extractFrozenStringArray(source, constantName) {
  const match = source.match(
    new RegExp(
      `const ${constantName} = Object\\.freeze\\(\\[([\\s\\S]*?)\\n\\]\\);`,
    ),
  );
  assert.ok(match, `${constantName} must remain a frozen string array`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

function extractRollbackPatchValueKeys(source) {
  const normalizedSource = source.replace(/\r\n?/g, "\n");
  const match = normalizedSource.match(
    /function buildScenarioTransactionRollbackStatePatch\(snapshot\) \{[\s\S]*?const values = \{\n(?<body>[\s\S]*?)\n  \};\n  return \{/,
  );
  assert.ok(match?.groups?.body, "rollback patch values object must remain statically discoverable");
  return [...match.groups.body.matchAll(/^ {6}([A-Za-z_$][\w$]*):/gm)]
    .map((entry) => entry[1]);
}

function createValues(keys) {
  return Object.fromEntries(
    keys.map((key, index) => [
      key,
      Object.freeze({ key, index }),
    ]),
  );
}

function createProductionRollbackHarness(runtimeState) {
  // Execute the production capture/patch/restore composition with real domain
  // actions; only UI/palette effects and resource callbacks are supplied here.
  const dependencies = {
    runtimeState, countryNames: {}, defaultCountryPalette: {}, normalizeMapSemanticMode,
    captureScenarioActivationState, captureScenarioPaletteState,
    captureActiveScenarioPerformanceHintsState, captureScenarioPresentationState,
    captureScenarioHealthState, captureScenarioTransactionRollbackOptionalState,
    captureScenarioTransactionRollbackSupplementalState,
    SCENARIO_TRANSACTION_ROLLBACK_OPTIONAL_STATE_KEYS,
    SCENARIO_TRANSACTION_ROLLBACK_SUPPLEMENTAL_STATE_KEYS,
    SCENARIO_ACTIVATION_STATE_KEYS, SCENARIO_READINESS_STATE_KEYS,
    SCENARIO_PRESENTATION_STATE_KEYS, SCENARIO_PALETTE_STATE_KEYS,
    restoreScenarioActivationBeforeAuditState, restoreScenarioActivationBeforeColorDirtyState,
    restoreScenarioActivationAfterColorDirtyState, restoreScenarioReadinessState,
    restoreScenarioHydrationHealthGateState, restoreScenarioDataHealthState,
    restoreScenarioTransactionPresentationBeforeAuditState,
    restoreScenarioTransactionPresentationState, restoreScenarioPaletteState,
    setActiveScenarioPerformanceHintsState, setDefaultRuntimePoliticalTopologyState,
    setScenarioPoliticalChunkPayloadState, replaceScenarioChunkRuntimeState,
    setScenarioChunkRuntimeHooksState, validateScenarioTransactionRollbackSupplementalStatePatch,
    createDefaultActiveScenarioChunksState, createDefaultScenarioHydrationHealthGate,
    createDefaultRuntimeChunkLoadState, bumpScenarioDataGenerationState,
    bumpSceneGenerationState, ensureSceneSnapshotState, cloneScenarioStateValue,
    createScenarioRollbackClone,
    ensureScenarioAuditUiState: () => {},
    setScenarioAuditUiState: (value) => { runtimeState.scenarioAuditUi = value; },
    syncResolvedDefaultCountryPalette: () => {},
    readRegisteredRuntimeHookSource: (target, name) => target[name] || null,
    callRuntimeHook: (target, name, ...args) => target[name]?.(...args),
    scheduleScenarioChunkRefresh: () => {},
    awaitInitialScenarioChunkVisualPromotion: () => {},
  };
  const source = ROLLBACK_SOURCE.slice(ROLLBACK_SOURCE.indexOf("const ROLLBACK_REQUIRED_KEYS"))
    .replace(/^export /gm, "");
  return new Function(...Object.keys(dependencies), `${source}; return {
    capture: captureScenarioApplyRollbackSnapshot,
    restore: restoreScenarioApplyRollbackSnapshot,
    schedule: scheduleScenarioChunkRefresh,
    promote: awaitInitialScenarioChunkVisualPromotion,
  };`)(...Object.values(dependencies));
}

function createDomainSnapshot(keys, values, {
  presentOptionalKeys = SCENARIO_TRANSACTION_ROLLBACK_OPTIONAL_STATE_KEYS,
} = {}) {
  const optionalKeys = new Set(SCENARIO_TRANSACTION_ROLLBACK_OPTIONAL_STATE_KEYS);
  const presentKeys = keys.filter(
    (key) => !optionalKeys.has(key) || presentOptionalKeys.includes(key),
  );
  return {
    values: Object.fromEntries(keys.map((key) => [key, values[key]])),
    presentKeys,
  };
}

function createRollbackPlan({
  presentOptionalKeys = SCENARIO_TRANSACTION_ROLLBACK_OPTIONAL_STATE_KEYS,
} = {}) {
  const values = createValues([
    ...ALL_DOMAIN_KEYS,
    ...SCENARIO_TRANSACTION_ROLLBACK_SUPPLEMENTAL_STATE_KEYS,
    "scenarioHydrationHealthGate",
    "scenarioDataHealth",
    "activeScenarioPerformanceHints",
  ]);
  values.ui = Object.freeze({
    politicalEditingExpanded: true,
    scenarioVisualAdjustmentsOpen: false,
  });
  values.styleConfig = Object.freeze({
    ocean: Object.freeze({ fill: "#123456" }),
  });
  return {
    values,
    activation: createDomainSnapshot(
      SCENARIO_ACTIVATION_STATE_KEYS,
      values,
      { presentOptionalKeys },
    ),
    readiness: createDomainSnapshot(
      SCENARIO_READINESS_STATE_KEYS,
      values,
      { presentOptionalKeys },
    ),
    presentation: createDomainSnapshot(
      SCENARIO_PRESENTATION_STATE_KEYS,
      values,
      { presentOptionalKeys },
    ),
    palette: createDomainSnapshot(
      SCENARIO_PALETTE_STATE_KEYS,
      values,
      { presentOptionalKeys },
    ),
    supplemental: {
      values: Object.fromEntries(
        SCENARIO_TRANSACTION_ROLLBACK_SUPPLEMENTAL_STATE_KEYS.map((key) => [
          key,
          values[key],
        ]),
      ),
    },
    scenarioHealth: {
      scenarioHydrationHealthGate: values.scenarioHydrationHealthGate,
      scenarioDataHealth: values.scenarioDataHealth,
    },
    activeScenarioPerformanceHints: values.activeScenarioPerformanceHints,
  };
}

function restoreScenarioTransactionRollbackPlan(target, plan, effects = {}) {
  validateScenarioTransactionRollbackSupplementalStatePatch(plan.supplemental);
  restoreScenarioActivationBeforeAuditState(target, plan.activation);
  setDefaultRuntimePoliticalTopologyState(
    target,
    plan.supplemental.values.defaultRuntimePoliticalTopology,
  );
  restoreScenarioHydrationHealthGateState(
    target,
    plan.scenarioHealth.scenarioHydrationHealthGate,
  );
  restoreScenarioTransactionPresentationBeforeAuditState(
    target,
    plan.presentation,
  );
  effects.audit?.();
  restoreScenarioActivationBeforeColorDirtyState(target, plan.activation);
  restoreScenarioReadinessState(target, plan.readiness);
  restoreScenarioDataHealthState(
    target,
    plan.scenarioHealth.scenarioDataHealth,
  );
  effects.colorDirty?.();
  restoreScenarioActivationAfterColorDirtyState(target, plan.activation);
  setActiveScenarioPerformanceHintsState(
    target,
    plan.activeScenarioPerformanceHints,
  );
  setScenarioPoliticalChunkPayloadState(target, {
    payload: plan.supplemental.values.scenarioPoliticalChunkData,
    visiblePayload:
      plan.supplemental.values.scenarioPoliticalVisibleChunkData,
  });
  replaceScenarioChunkRuntimeState(target, {
    activeScenarioChunks: plan.supplemental.values.activeScenarioChunks,
    runtimeChunkLoadState: plan.supplemental.values.runtimeChunkLoadState,
  });
  setScenarioChunkRuntimeHooksState(target, {
    scheduleScenarioChunkRefreshFn:
      plan.supplemental.values.scheduleScenarioChunkRefreshFn,
    awaitInitialScenarioChunkVisualPromotionFn:
      plan.supplemental.values.awaitInitialScenarioChunkVisualPromotionFn,
  });
  restoreScenarioTransactionPresentationState(target, plan.presentation);
  restoreScenarioPaletteState(target, plan.palette);
}

test("scenario transaction rollback action owns the exact frozen supplemental keys", () => {
  assert.equal(
    Object.isFrozen(SCENARIO_TRANSACTION_ROLLBACK_SUPPLEMENTAL_STATE_KEYS),
    true,
  );
  assert.deepEqual(
    SCENARIO_TRANSACTION_ROLLBACK_SUPPLEMENTAL_STATE_KEYS,
    EXPECTED_SUPPLEMENTAL_KEYS,
  );
  assert.equal(
    new Set(SCENARIO_TRANSACTION_ROLLBACK_SUPPLEMENTAL_STATE_KEYS).size,
    SCENARIO_TRANSACTION_ROLLBACK_SUPPLEMENTAL_STATE_KEYS.length,
  );
  const canonicalKeys = new Set(ALL_DOMAIN_KEYS);
  for (const key of SCENARIO_TRANSACTION_ROLLBACK_SUPPLEMENTAL_STATE_KEYS) {
    assert.equal(
      canonicalKeys.has(key),
      false,
      `${key} must remain outside existing canonical domain ownership`,
    );
  }
});

test("scenario rollback authority key sets are pairwise disjoint and cover the exact rollback patch", () => {
  const authorityEntries = Object.entries(AUTHORITY_KEY_SETS);
  for (let leftIndex = 0; leftIndex < authorityEntries.length; leftIndex += 1) {
    const [leftName, leftKeys] = authorityEntries[leftIndex];
    const leftSet = new Set(leftKeys);
    assert.equal(leftSet.size, leftKeys.length, `${leftName} keys must be unique`);
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < authorityEntries.length;
      rightIndex += 1
    ) {
      const [rightName, rightKeys] = authorityEntries[rightIndex];
      const overlap = rightKeys.filter((key) => leftSet.has(key));
      assert.deepEqual(
        overlap,
        [],
        `${leftName} and ${rightName} must not share rollback authority`,
      );
    }
  }

  const authorityKeys = authorityEntries.flatMap(([, keys]) => keys);
  // Retired featureOverrides/countryBaseColors (-2), canonical riverPaint (+1).
  assert.equal(authorityKeys.length, 109);
  assert.deepEqual(
    sorted(extractRollbackPatchValueKeys(ROLLBACK_SOURCE)),
    sorted(authorityKeys),
  );

  const snapshotToAuthorityKey = Object.freeze({
    scenarioUiState: "ui",
    styleConfigOcean: "styleConfig",
    scheduleScenarioChunkRefreshEnabled: "scheduleScenarioChunkRefreshFn",
    awaitInitialScenarioChunkVisualPromotionEnabled:
      "awaitInitialScenarioChunkVisualPromotionFn",
  });
  const requiredSnapshotKeys = extractFrozenStringArray(
    ROLLBACK_SOURCE,
    "ROLLBACK_REQUIRED_KEYS",
  );
  assert.equal(requiredSnapshotKeys.length, 109);
  assert.deepEqual(
    sorted(
      requiredSnapshotKeys.map(
        (key) => snapshotToAuthorityKey[key] || key,
      ),
    ),
    sorted(authorityKeys),
  );
});

test("production rollback restores river edits while cache trimming and stale chunk work stay fenced", async () => {
  const { state: target, cells } = await makeFixture();
  target.riverPaint.overrides[cells[0].id] = "#123456";
  target.styleConfig = { ocean: { fill: "#abcdef" } };
  target.ui = {};
  target.runtimeChunkLoadState = {
    generation: 5, shellStatus: "ready", promotionScheduled: true,
    promotionCommitInFlight: true, promotionCommitStatus: "running",
  };
  const topology = { type: "Topology", arcs: [[[0, 0], [1, 1]]], objects: { political: {} } };
  target.scenarioRuntimeTopologyData = topology;
  const bundle = {
    runtimeTopologyPayload: topology,
    runtimeDecodedCollections: { politicalData: { features: [{ id: "P" }] } },
    runtimeDecodedTopologyCache: new Map([["political", {}]]),
  };
  target.scenarioBundleCacheById = { modern_world: bundle, hoi4_1939: {} };
  target.scenarioApplyInFlight = true;
  const rollback = createProductionRollbackHarness(target);
  target.scheduleScenarioChunkRefreshFn = rollback.schedule;
  target.awaitInitialScenarioChunkVisualPromotionFn = rollback.promote;
  const snapshot = rollback.capture();
  const expectedPaint = structuredClone(target.riverPaint);
  assert.deepEqual(snapshot.riverPaint, expectedPaint);
  assert.notEqual(snapshot.riverPaint.overrides, target.riverPaint.overrides);
  assert.notEqual(snapshot.riverPaint.pack, target.riverPaint.pack);

  target.activeScenarioId = "hoi4_1939";
  target.riverPaint.overrides[cells[0].id] = "#654321";
  target.riverPaint.editMode = false;
  target.runtimeChunkLoadState = { generation: 7, shellStatus: "loading" };
  target.scheduleScenarioChunkRefreshFn = () => {};
  const cancellations = [];
  target.cancelScenarioChunkPromotionCommitFn = (reason) => cancellations.push(reason);
  const recency = new Map();
  trimScenarioBundleCache(target, recency, "hoi4_1939");
  assert.ok(bundle.runtimeDecodedCollections, "an apply must retain outgoing derivations for rollback");
  const staleChunkWrite = Promise.resolve().then(() => patchScenarioChunkLoadState(
    target, { shellStatus: "stale" }, { expectedLoadStateGeneration: 7 },
  ));

  rollback.restore(snapshot);
  assert.deepEqual(target.riverPaint, expectedPaint);
  assert.notEqual(target.riverPaint, snapshot.riverPaint);
  assert.notEqual(target.riverPaint.pack, snapshot.riverPaint.pack);
  assert.equal(target.activeScenarioId, "modern_world");
  assert.deepEqual(cancellations, ["rolled-back"]);
  assert.equal(await staleChunkWrite, false);
  assert.equal(target.runtimeChunkLoadState.shellStatus, "ready");
  assert.equal(target.runtimeChunkLoadState.generation, 8);
  assert.equal(target.runtimeChunkLoadState.promotionTimerId, null);
  assert.equal(target.runtimeChunkLoadState.promotionCommitInFlight, false);
  assert.equal(target.runtimeChunkLoadState.promotionCommitStatus, "rolled-back");
  assert.equal(target.scheduleScenarioChunkRefreshFn, rollback.schedule);
  assert.equal(target.awaitInitialScenarioChunkVisualPromotionFn, rollback.promote);
  assert.equal(target.sceneGeneration, 2);
  assert.equal(target.scenarioDataGeneration, 1);

  target.scenarioApplyInFlight = false;
  trimScenarioBundleCache(target, recency, "hoi4_1939");
  assert.ok(bundle.runtimeDecodedCollections, "the restored active bundle must remain protected");
  target.activeScenarioId = "hoi4_1939";
  trimScenarioBundleCache(target, recency, "hoi4_1939");
  assert.equal(bundle.runtimeDecodedCollections, null);
  assert.equal(bundle.runtimeDecodedTopologyCache, undefined);
  rollback.restore(snapshot);
  assert.deepEqual(target.riverPaint, expectedPaint);
  assert.deepEqual(target.scenarioRuntimeTopologyData, topology);
  assert.notEqual(target.scenarioRuntimeTopologyData, topology);
  assert.equal(target.runtimeChunkLoadState.generation, 9);
});

test("production rollback validates river state before effects and remains safe to retry", async () => {
  const { state: target, cells } = await makeFixture();
  target.riverPaint.overrides[cells[0].id] = "#123456";
  const rollback = createProductionRollbackHarness(target);
  const snapshot = rollback.capture();
  const expectedPaint = structuredClone(snapshot.riverPaint);
  const cancellations = [];
  target.cancelScenarioChunkPromotionCommitFn = (reason) => cancellations.push(reason);
  target.activeScenarioId = "failed-target";
  target.riverPaint = { schemaVersion: 1, editMode: false, pack: null, overrides: {} };
  const failedPaint = target.riverPaint;
  const incomplete = { ...snapshot };
  delete incomplete.riverPaint;
  assert.throws(() => rollback.restore(incomplete), /missing required keys: riverPaint/);
  assert.throws(() => rollback.restore(snapshot, { shouldFailRestore: true }), /Injected rollback restore failure/);
  assert.equal(target.riverPaint, failedPaint);
  assert.equal(target.activeScenarioId, "failed-target");
  assert.deepEqual(cancellations, []);

  rollback.restore(snapshot);
  assert.deepEqual(target.riverPaint, expectedPaint);
  target.riverPaint.overrides[cells[0].id] = "#abcdef";
  const nextSnapshot = rollback.capture();
  assert.deepEqual(snapshot.riverPaint, expectedPaint, "restoring and editing must not mutate the reusable snapshot");
  assert.equal(nextSnapshot.riverPaint.overrides[cells[0].id], "#abcdef");
  assert.notEqual(nextSnapshot.riverPaint, snapshot.riverPaint);
  rollback.restore(snapshot);
  assert.deepEqual(target.riverPaint, expectedPaint);
  assert.deepEqual(cancellations, ["rolled-back", "rolled-back"]);
});

test("scenario rollback patch discovery is portable across line endings", () => {
  const lfSource = ROLLBACK_SOURCE.replace(/\r\n?/g, "\n");
  const crlfSource = lfSource.replaceAll("\n", "\r\n");
  assert.deepEqual(
    extractRollbackPatchValueKeys(crlfSource),
    extractRollbackPatchValueKeys(lfSource),
  );
});

test("scenario rollback supplemental authority has an exact frozen phase handoff", () => {
  assert.equal(
    Object.isFrozen(
      SCENARIO_TRANSACTION_ROLLBACK_SUPPLEMENTAL_HANDOFF_PHASE_BY_KEY,
    ),
    true,
  );
  assert.deepEqual(
    SCENARIO_TRANSACTION_ROLLBACK_SUPPLEMENTAL_HANDOFF_PHASE_BY_KEY,
    EXPECTED_SUPPLEMENTAL_HANDOFF_PHASE_BY_KEY,
  );
  assert.deepEqual(
    Object.keys(
      SCENARIO_TRANSACTION_ROLLBACK_SUPPLEMENTAL_HANDOFF_PHASE_BY_KEY,
    ),
    SCENARIO_TRANSACTION_ROLLBACK_SUPPLEMENTAL_STATE_KEYS,
  );
  assert.deepEqual(
    Object.values(
      SCENARIO_TRANSACTION_ROLLBACK_SUPPLEMENTAL_HANDOFF_PHASE_BY_KEY,
    ).reduce((counts, phase) => {
      counts[phase] = (counts[phase] || 0) + 1;
      return counts;
    }, {}),
    { "P4.2b": 7 },
  );
});

test("scenario transaction rollback optional capture clones only the frozen sentinel catalog", () => {
  const target = Object.fromEntries(
    SCENARIO_TRANSACTION_ROLLBACK_OPTIONAL_STATE_KEYS.map((key, index) => [
      key,
      { key, index },
    ]),
  );
  target.unowned = { keep: true };
  const captured = captureScenarioTransactionRollbackOptionalState(
    target,
    {
      cloneValue(value) {
        return value && typeof value === "object"
          ? { ...value }
          : value;
      },
    },
  );

  assert.deepEqual(
    Object.keys(captured.values),
    SCENARIO_TRANSACTION_ROLLBACK_OPTIONAL_STATE_KEYS,
  );
  assert.equal(Object.hasOwn(captured.values, "unowned"), false);
  assert.deepEqual(
    captured.presentKeys,
    SCENARIO_TRANSACTION_ROLLBACK_OPTIONAL_STATE_KEYS,
  );
  for (const key of SCENARIO_TRANSACTION_ROLLBACK_OPTIONAL_STATE_KEYS) {
    assert.deepEqual(captured.values[key], target[key]);
    assert.notEqual(captured.values[key], target[key]);
  }
});

test("scenario transaction supplemental capture deeply clones exact state and records hook presence", async () => {
  const {
    captureScenarioTransactionRollbackSupplementalState,
  } = await import(
    "../js/core/state/actions/scenario_transaction_rollback_actions.js"
  );
  assert.equal(
    typeof captureScenarioTransactionRollbackSupplementalState,
    "function",
  );

  const scheduleHook = () => {};
  const promotionHook = () => {};
  const target = {
    defaultRuntimePoliticalTopology: {
      capturedAt: new Date("2026-07-20T12:00:00.000Z"),
      topologyById: new Map([["main", { version: 1 }]]),
    },
    scenarioPoliticalChunkData: { features: [{ id: "full" }] },
    scenarioPoliticalVisibleChunkData: { features: [{ id: "visible" }] },
    activeScenarioChunks: { loaded: new Set(["political"]) },
    runtimeChunkLoadState: {
      refreshTimerId: 17,
      promotionTimerId: 23,
      promotionScheduled: true,
      promotionCommitInFlight: true,
      promotionCommitStatus: "running",
      promotionCommitError: "stale",
      pendingPostCommitRefresh: { reason: "stale" },
      retained: new Map([["chunk", { id: "main" }]]),
    },
  };
  const hookSources = new Map([
    ["scheduleScenarioChunkRefreshFn", scheduleHook],
    ["awaitInitialScenarioChunkVisualPromotionFn", promotionHook],
  ]);

  const captured = captureScenarioTransactionRollbackSupplementalState(
    target,
    {
      cloneValue: cloneScenarioStateValue,
      readHookSource: (_target, hookName) => hookSources.get(hookName) || null,
      scheduleScenarioChunkRefreshSource: scheduleHook,
      awaitInitialScenarioChunkVisualPromotionSource: promotionHook,
    },
  );

  assert.deepEqual(Object.keys(captured.values), [
    "defaultRuntimePoliticalTopology",
    "scenarioPoliticalChunkData",
    "scenarioPoliticalVisibleChunkData",
    "activeScenarioChunks",
    "runtimeChunkLoadState",
    "scheduleScenarioChunkRefreshEnabled",
    "awaitInitialScenarioChunkVisualPromotionEnabled",
  ]);
  assert.deepEqual(
    captured.presentKeys,
    SCENARIO_TRANSACTION_ROLLBACK_SUPPLEMENTAL_STATE_KEYS,
  );
  assert.equal(captured.values.scheduleScenarioChunkRefreshEnabled, true);
  assert.equal(
    captured.values.awaitInitialScenarioChunkVisualPromotionEnabled,
    true,
  );
  assert.deepEqual(captured.values.defaultRuntimePoliticalTopology, {
    capturedAt: new Date("2026-07-20T12:00:00.000Z"),
    topologyById: new Map([["main", { version: 1 }]]),
  });
  assert.notEqual(
    captured.values.defaultRuntimePoliticalTopology,
    target.defaultRuntimePoliticalTopology,
  );
  assert.notEqual(
    captured.values.defaultRuntimePoliticalTopology.capturedAt,
    target.defaultRuntimePoliticalTopology.capturedAt,
  );
  assert.notEqual(
    captured.values.defaultRuntimePoliticalTopology.topologyById,
    target.defaultRuntimePoliticalTopology.topologyById,
  );
  assert.notEqual(
    captured.values.scenarioPoliticalChunkData.features,
    target.scenarioPoliticalChunkData.features,
  );
  assert.notEqual(
    captured.values.scenarioPoliticalVisibleChunkData.features,
    target.scenarioPoliticalVisibleChunkData.features,
  );
  assert.notEqual(
    captured.values.runtimeChunkLoadState.retained,
    target.runtimeChunkLoadState.retained,
  );
  assert.deepEqual(
    {
      refreshTimerId: captured.values.runtimeChunkLoadState.refreshTimerId,
      promotionTimerId: captured.values.runtimeChunkLoadState.promotionTimerId,
      promotionScheduled:
        captured.values.runtimeChunkLoadState.promotionScheduled,
      promotionCommitInFlight:
        captured.values.runtimeChunkLoadState.promotionCommitInFlight,
      promotionCommitStatus:
        captured.values.runtimeChunkLoadState.promotionCommitStatus,
      promotionCommitError:
        captured.values.runtimeChunkLoadState.promotionCommitError,
      pendingPostCommitRefresh:
        captured.values.runtimeChunkLoadState.pendingPostCommitRefresh,
    },
    {
      refreshTimerId: null,
      promotionTimerId: null,
      promotionScheduled: false,
      promotionCommitInFlight: false,
      promotionCommitStatus: "rolled-back",
      promotionCommitError: "",
      pendingPostCommitRefresh: null,
    },
  );

  const absentHooks =
    captureScenarioTransactionRollbackSupplementalState(target, {
      cloneValue: cloneScenarioStateValue,
      readHookSource: () => null,
      scheduleScenarioChunkRefreshSource: scheduleHook,
      awaitInitialScenarioChunkVisualPromotionSource: promotionHook,
    });
  assert.equal(absentHooks.values.scheduleScenarioChunkRefreshEnabled, false);
  assert.equal(
    absentHooks.values.awaitInitialScenarioChunkVisualPromotionEnabled,
    false,
  );
  assert.deepEqual(
    absentHooks.presentKeys,
    SCENARIO_TRANSACTION_ROLLBACK_SUPPLEMENTAL_STATE_KEYS.slice(0, -2),
  );
});

test("scenario rollback composes canonical domain restores around audit and color-dirty effects", () => {
  const target = {
    ui: {
      preservedUiField: "keep",
      politicalEditingExpanded: false,
      scenarioVisualAdjustmentsOpen: true,
    },
    styleConfig: {
      preservedStyleField: "keep",
      ocean: { fill: "#000000" },
    },
  };
  const originalUi = target.ui;
  const originalStyleConfig = target.styleConfig;
  const plan = createRollbackPlan();
  const observed = [];

  restoreScenarioTransactionRollbackPlan(target, plan, {
    audit() {
      observed.push({
        effect: "audit",
        scenarioAudit: target.scenarioAudit,
        scenarioImportAudit: target.scenarioImportAudit,
      });
    },
    colorDirty() {
      observed.push({
        effect: "color-dirty",
        scenarioImportAudit: target.scenarioImportAudit,
        scenarioPoliticalChunkData: target.scenarioPoliticalChunkData,
      });
    },
  });

  assert.equal(observed[0].effect, "audit");
  assert.equal(observed[0].scenarioAudit, plan.values.scenarioAudit);
  assert.equal(observed[0].scenarioImportAudit, undefined);
  assert.equal(observed[1].effect, "color-dirty");
  assert.equal(
    observed[1].scenarioImportAudit,
    plan.values.scenarioImportAudit,
  );
  assert.equal(observed[1].scenarioPoliticalChunkData, undefined);

  for (const key of [
    ...SCENARIO_ACTIVATION_STATE_KEYS,
    ...SCENARIO_READINESS_STATE_KEYS,
    ...SCENARIO_PALETTE_STATE_KEYS,
    ...SCENARIO_TRANSACTION_ROLLBACK_SUPPLEMENTAL_STATE_KEYS,
    "scenarioHydrationHealthGate",
    "scenarioDataHealth",
    "activeScenarioPerformanceHints",
  ]) {
    if (key === "runtimeChunkLoadState") continue;
    assert.equal(target[key], plan.values[key], `${key} should restore exactly`);
  }
  assert.notEqual(
    target.runtimeChunkLoadState,
    plan.values.runtimeChunkLoadState,
  );
  assert.deepEqual(target.runtimeChunkLoadState, {
    ...plan.values.runtimeChunkLoadState,
    generation: 1,
  });
  assert.equal(target.ui, originalUi);
  assert.equal(target.ui.preservedUiField, "keep");
  assert.equal(target.ui.politicalEditingExpanded, true);
  assert.equal(target.ui.scenarioVisualAdjustmentsOpen, false);
  assert.equal(target.styleConfig, originalStyleConfig);
  assert.equal(target.styleConfig.preservedStyleField, "keep");
  assert.equal(target.styleConfig.ocean, plan.values.styleConfig.ocean);
});

test("canonical domain restores preserve rollback absent-key semantics", () => {
  const presentOptionalKeys = [
    "mapSemanticMode",
    "detailDeferred",
    "showScenarioAtlantropa",
    "locales",
  ];
  const plan = createRollbackPlan({ presentOptionalKeys });
  const target = Object.fromEntries(
    ALL_DOMAIN_KEYS.map((key) => [key, `stale:${key}`]),
  );
  target.ui = {};
  target.styleConfig = {};

  restoreScenarioTransactionRollbackPlan(target, plan);

  for (const key of SCENARIO_TRANSACTION_ROLLBACK_OPTIONAL_STATE_KEYS) {
    if (presentOptionalKeys.includes(key)) {
      assert.equal(target[key], plan.values[key], `${key} should be assigned`);
    } else {
      assert.equal(
        Object.prototype.hasOwnProperty.call(target, key),
        false,
        `${key} should be deleted`,
      );
    }
  }
  assert.equal(target.activeScenarioId, plan.values.activeScenarioId);
});

test("scenario transaction supplemental validator rejects incomplete patches", () => {
  const plan = createRollbackPlan();
  const target = {
    defaultRuntimePoliticalTopology: "before",
  };
  const before = structuredClone(target);
  delete plan.supplemental.values.defaultRuntimePoliticalTopology;

  assert.throws(
    () => validateScenarioTransactionRollbackSupplementalStatePatch(
      plan.supplemental,
    ),
    /missing required key: defaultRuntimePoliticalTopology/,
  );
  assert.deepEqual(target, before);
});

test("scenario transaction rollback action keeps a narrow canonical state-action boundary", () => {
  const importSources = [...ACTION_SOURCE.matchAll(
    /^import\s*\{[\s\S]*?\}\s*from\s*"([^"]+)";/gm,
  )].map((match) => match[1]).sort();
  assert.deepEqual(importSources, []);
  for (const actionName of [
    "replaceScenarioChunkRuntimeState",
    "setScenarioChunkRuntimeHooksState",
    "setDefaultRuntimePoliticalTopologyState",
    "setScenarioPoliticalChunkPayloadState",
  ]) {
    assert.match(ROLLBACK_SOURCE, new RegExp(`\\b${actionName}\\(`));
    assert.doesNotMatch(ACTION_SOURCE, new RegExp(`\\b${actionName}\\(`));
  }
  assert.doesNotMatch(
    ACTION_SOURCE,
    /\b(?:globalThis|window|document|runtimeState)\b/,
  );
  assert.doesNotMatch(ACTION_SOURCE, /\btarget\s*\[/);
  assert.doesNotMatch(ACTION_SOURCE, /\bdelete\s+target\s*\[/);
  const delegatedP42bKeys = new Set([
    "defaultRuntimePoliticalTopology",
    "scenarioPoliticalChunkData",
    "scenarioPoliticalVisibleChunkData",
    "activeScenarioChunks",
    "runtimeChunkLoadState",
    "scheduleScenarioChunkRefreshFn",
    "awaitInitialScenarioChunkVisualPromotionFn",
  ]);
  for (const key of SCENARIO_TRANSACTION_ROLLBACK_SUPPLEMENTAL_STATE_KEYS.filter(
    (key) => !delegatedP42bKeys.has(key),
  )) {
    assert.match(
      ACTION_SOURCE,
      new RegExp(`\\btarget\\.${key}\\b`),
      `${key} must have an explicit static target write`,
    );
  }
  for (const key of delegatedP42bKeys) {
    assert.doesNotMatch(
      ACTION_SOURCE,
      new RegExp(`\\btarget\\.${key}\\s*=`),
      `${key} must delegate to its P4.2b canonical action`,
    );
  }
  for (const key of ALL_DOMAIN_KEYS) {
    assert.doesNotMatch(
      ACTION_SOURCE,
      new RegExp(`\\btarget\\.${key}\\s*=`),
      `${key} must stay in its canonical domain action`,
    );
  }
});
