import assert from "node:assert/strict";
import test from "node:test";

import {
  restoreScenarioActivationAfterColorDirtyState,
  restoreScenarioActivationBeforeAuditState,
  restoreScenarioActivationBeforeColorDirtyState,
  SCENARIO_ACTIVATION_STATE_KEYS,
} from "../js/core/state/actions/scenario_activation_actions.js";
import {
  restoreScenarioPaletteState,
  SCENARIO_PALETTE_STATE_KEYS,
} from "../js/core/state/actions/scenario_palette_actions.js";
import {
  restoreScenarioTransactionPresentationBeforeAuditState,
  restoreScenarioTransactionPresentationState,
  setActiveScenarioPerformanceHintsState,
  SCENARIO_PRESENTATION_STATE_KEYS,
} from "../js/core/state/actions/scenario_presentation_actions.js";
import {
  restoreScenarioDataHealthState,
  restoreScenarioHydrationHealthGateState,
} from "../js/core/state/actions/scenario_health_actions.js";
import {
  restoreScenarioReadinessState,
  SCENARIO_READINESS_STATE_KEYS,
} from "../js/core/state/actions/scenario_readiness_actions.js";
import {
  captureScenarioTransactionRollbackOptionalState,
  SCENARIO_TRANSACTION_ROLLBACK_SUPPLEMENTAL_HANDOFF_PHASE_BY_KEY,
  SCENARIO_TRANSACTION_ROLLBACK_OPTIONAL_STATE_KEYS,
  SCENARIO_TRANSACTION_ROLLBACK_SUPPLEMENTAL_STATE_KEYS,
  validateScenarioTransactionRollbackSupplementalStatePatch,
} from "../js/core/state/actions/scenario_transaction_rollback_actions.js";
import {
  replaceScenarioChunkRuntimeState,
  setScenarioChunkRuntimeHooksState,
} from "../js/core/state/actions/scenario_chunk_runtime_actions.js";
import {
  setDefaultRuntimePoliticalTopologyState,
  setScenarioPoliticalChunkPayloadState,
} from "../js/core/state/actions/scenario_chunk_promotion_actions.js";
import { cloneScenarioStateValue } from "../js/core/scenario/shared.js";

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

function createValues(keys) {
  return Object.fromEntries(
    keys.map((key, index) => [
      key,
      Object.freeze({ key, index }),
    ]),
  );
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
  assert.equal(authorityKeys.length, 112);
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
