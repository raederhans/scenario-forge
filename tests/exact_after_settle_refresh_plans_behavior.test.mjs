import test from "node:test";
import assert from "node:assert/strict";
import {
  createExactAfterSettleRefreshPlan,
  EXACT_AFTER_SETTLE_DEFERRED_PASS_NAMES,
  filterExactAfterSettleIdleRenderPassDefinitions,
  getExactAfterSettleDprRestorePasses,
  resolveDeferredExactContextTargetPasses,
  resolveExactAfterSettleTargetPasses,
} from "../js/core/map_renderer/exact_after_settle_refresh_plans.js";
import {
  EXACT_AFTER_SETTLE_DEFERRED_PASS_NAMES as CATALOG_DEFERRED_PASS_NAMES,
  getExactAfterSettleDprRestorePasses as getCatalogDprRestorePasses,
} from "../js/core/renderer/exact_after_settle_pass_catalog.js";

const RENDER_PASSES = [
  "background",
  "physicalBase",
  "political",
  "hgoPreview",
  "contextBase",
  "contextScenario",
  "effects",
  "lineEffects",
  "contextMarkers",
  "dayNight",
  "borders",
  "textureLabels",
  "labels",
];

test("exact-after-settle plan records timing and refresh policy inputs", () => {
  const plan = createExactAfterSettleRefreshPlan({
    profile: { exactQuietWindowMs: 420 },
    scheduleStartedAt: 100,
    callbackStartedAt: 580,
    reuseDecision: { shouldExactRefresh: true, reason: "context-base-exact" },
    forceExactContextBaseRefresh: false,
    metricSequenceStartedAt: 9,
  });

  assert.equal(plan.exactRefreshApplied, true);
  assert.equal(plan.settleWindowElapsedMs, 480);
  assert.equal(plan.metricSequenceStartedAt, 9);
  assert.deepEqual(plan.exactTargetPasses, []);
  assert.deepEqual(plan.deferredExactTargetPasses, []);
});

test("DPR restore pass list keeps political invalidation explicit", () => {
  assert.deepEqual(
    getExactAfterSettleDprRestorePasses(["political", "contextBase", "political", "labels"]),
    ["contextBase", "labels"],
  );
});

test("urban zoom refresh requests only the dirty deferred context pass without physical refresh", () => {
  const plan = createExactAfterSettleRefreshPlan({ urbanZoomExactRefresh: true });
  assert.equal(plan.urbanZoomExactRefresh, true);
  assert.equal(plan.forceExactContextBaseRefresh, false);
  assert.equal(plan.exactRefreshApplied, false, "a deferred urban request is not completed refresh work");
  const targets = resolveExactAfterSettleTargetPasses({
    renderPassNames: RENDER_PASSES,
    idleRenderPassNames: RENDER_PASSES,
    dirtyPassNames: ["contextBase"],
    physicalExactRefreshPasses: ["physicalBase", "contextBase"],
    forceExactContextBaseRefresh: plan.forceExactContextBaseRefresh,
    exactRefreshApplied: plan.exactRefreshApplied,
  });
  assert.deepEqual(targets.exactTargetPasses, ["political", "borders"]);
  assert.deepEqual(targets.deferredExactTargetPasses, ["contextBase", "textureLabels", "labels"]);
});

test("refresh plans keep exact-after-settle pass catalog compatibility exports", () => {
  assert.equal(EXACT_AFTER_SETTLE_DEFERRED_PASS_NAMES, CATALOG_DEFERRED_PASS_NAMES);
  assert.equal(getExactAfterSettleDprRestorePasses, getCatalogDprRestorePasses);
});

test("idle pass definition filter keeps scheduler pass selection in plan helpers", () => {
  const definitions = [
    ["political", () => "political"],
    ["contextBase", () => "contextBase"],
    ["labels", () => "labels"],
  ];

  assert.deepEqual(
    filterExactAfterSettleIdleRenderPassDefinitions(definitions, [" labels ", "political"]),
    [definitions[0], definitions[2]],
  );
  assert.deepEqual(filterExactAfterSettleIdleRenderPassDefinitions(definitions, []), definitions);
});

test("target pass policy splits critical political work from deferred context passes", () => {
  const targetPasses = resolveExactAfterSettleTargetPasses({
    renderPassNames: RENDER_PASSES,
    idleRenderPassNames: RENDER_PASSES,
    dirtyPassNames: ["contextScenario", "effects"],
    physicalExactRefreshPasses: ["physicalBase", "political", "contextBase", "borders"],
    forceExactContextBaseRefresh: true,
    exactRefreshApplied: true,
  });

  assert.deepEqual(targetPasses.exactTargetPasses, ["physicalBase", "political", "effects", "borders"]);
  assert.deepEqual(targetPasses.deferredExactTargetPasses, ["contextBase", "contextScenario", "textureLabels", "labels"]);
});

test("deferred context target policy merges plan targets and newly dirty deferred passes", () => {
  const targetPasses = resolveDeferredExactContextTargetPasses({
    plan: { deferredExactTargetPasses: ["labels"] },
    dirtyPassNames: ["contextBase", "political", "labels"],
    idleRenderPassNames: RENDER_PASSES,
  });

  assert.deepEqual(targetPasses, ["contextBase", "labels"]);
});

test("deferred pass set excludes background and physical base", () => {
  assert.equal(EXACT_AFTER_SETTLE_DEFERRED_PASS_NAMES.has("contextBase"), true);
  assert.equal(EXACT_AFTER_SETTLE_DEFERRED_PASS_NAMES.has("contextScenario"), true);
  assert.equal(EXACT_AFTER_SETTLE_DEFERRED_PASS_NAMES.has("background"), false);
  assert.equal(EXACT_AFTER_SETTLE_DEFERRED_PASS_NAMES.has("physicalBase"), false);
});

test("target pass policy ignores dirty passes outside the active idle list", () => {
  const activeVectorPasses = RENDER_PASSES.filter((passName) => passName !== "hgoPreview");
  const targetPasses = resolveExactAfterSettleTargetPasses({
    renderPassNames: RENDER_PASSES,
    idleRenderPassNames: activeVectorPasses,
    dirtyPassNames: ["hgoPreview", "political"],
    physicalExactRefreshPasses: [],
    exactRefreshApplied: true,
  });

  assert.deepEqual(targetPasses.exactTargetPasses, ["political", "borders"]);
  assert.deepEqual(targetPasses.deferredExactTargetPasses, ["textureLabels", "labels"]);
  assert.equal(targetPasses.exactTargetPasses.includes("hgoPreview"), false);
  assert.equal(targetPasses.deferredExactTargetPasses.includes("hgoPreview"), false);
});

test("target pass policy keeps HGO preview when it is the active dirty pass", () => {
  const targetPasses = resolveExactAfterSettleTargetPasses({
    renderPassNames: RENDER_PASSES,
    idleRenderPassNames: ["hgoPreview"],
    dirtyPassNames: ["hgoPreview", "political"],
    physicalExactRefreshPasses: [],
    exactRefreshApplied: false,
  });

  assert.deepEqual(targetPasses.exactTargetPasses, ["hgoPreview"]);
  assert.deepEqual(targetPasses.deferredExactTargetPasses, []);
});
