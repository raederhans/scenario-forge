import assert from "node:assert/strict";
import test from "node:test";

import { RENDER_PASS_NAMES } from "../js/core/map_renderer/render_pass_catalog.js";
import {
  IDLE_RENDER_PASS_DEFINITIONS,
} from "../js/core/renderer/render_pipeline_catalog.js";
import {
  EXACT_AFTER_SETTLE_ALWAYS_TARGET_PASSES,
  EXACT_AFTER_SETTLE_DEFERRED_PASS_NAMES,
  getExactAfterSettleDprRestorePasses,
} from "../js/core/renderer/exact_after_settle_pass_catalog.js";
import {
  EXACT_AFTER_SETTLE_DEFERRED_PASS_NAMES as REEXPORTED_DEFERRED_PASS_NAMES,
  getExactAfterSettleDprRestorePasses as getReexportedDprRestorePasses,
} from "../js/core/map_renderer/exact_after_settle_refresh_plans.js";
import {
  createRenderPipelinePassesOwner,
} from "../js/core/renderer/render_pipeline_passes.js";

const EXPECTED_DEFERRED_PASS_NAMES = [
  "contextBase",
  "contextScenario",
  "contextMarkers",
  "textureLabels",
  "labels",
];

const EXPECTED_ALWAYS_TARGET_PASSES = [
  "political",
  "populationHeatmap",
  "borders",
  "labels",
  "textureLabels",
];

const IDLE_RENDER_PASS_NAMES = IDLE_RENDER_PASS_DEFINITIONS.map(({ passName }) => passName);

function createContextBasePipelineHarness(constants = {}) {
  const cache = {
    canvases: {
      contextBase: {},
    },
    counters: {},
    dirty: {},
    reasons: {},
    signatures: {
      contextBase: "contextBase:previous",
    },
  };
  const metrics = [];
  const renderedPasses = [];
  const owner = createRenderPipelinePassesOwner({
    constants,
    helpers: {
      getExactAfterSettleControllerState: () => ({ phase: "awaiting-paint" }),
      getPassReferenceTransform: (passName) => (
        passName === "contextBase" ? { k: 1, x: 0, y: 0 } : null
      ),
      getRenderPassCacheState: () => cache,
      getRenderPassSignature: (passName) => `${passName}:next`,
      recordRenderPerfMetric: (name, value, details) => {
        metrics.push({ name, value, details });
      },
      renderPassToCache: (passName) => {
        renderedPasses.push(passName);
      },
    },
    state: {
      activeScenarioId: "catalog-test",
      zoomTransform: { k: 1, x: 0, y: 0 },
    },
  });

  return { cache, metrics, owner, renderedPasses };
}

test("exact-after-settle catalog owns deferred and always-target pass policy", () => {
  assert.ok(EXACT_AFTER_SETTLE_DEFERRED_PASS_NAMES instanceof Set);
  assert.deepEqual([...EXACT_AFTER_SETTLE_DEFERRED_PASS_NAMES], EXPECTED_DEFERRED_PASS_NAMES);
  assert.deepEqual(EXACT_AFTER_SETTLE_ALWAYS_TARGET_PASSES, EXPECTED_ALWAYS_TARGET_PASSES);
});

test("exact-after-settle catalog pass policy only references known idle render passes", () => {
  for (const passName of [
    ...EXACT_AFTER_SETTLE_DEFERRED_PASS_NAMES,
    ...EXACT_AFTER_SETTLE_ALWAYS_TARGET_PASSES,
  ]) {
    assert.ok(RENDER_PASS_NAMES.includes(passName), `${passName} must exist in RENDER_PASS_NAMES.`);
    assert.ok(IDLE_RENDER_PASS_NAMES.includes(passName), `${passName} must exist in idle pipeline order.`);
  }
});

test("DPR restore pass policy excludes political while preserving render pass order", () => {
  assert.deepEqual(
    getExactAfterSettleDprRestorePasses(RENDER_PASS_NAMES),
    RENDER_PASS_NAMES.filter((passName) => passName !== "political"),
  );
});

test("exact-after-settle refresh plans keep compatibility re-exports", () => {
  assert.equal(REEXPORTED_DEFERRED_PASS_NAMES, EXACT_AFTER_SETTLE_DEFERRED_PASS_NAMES);
  assert.deepEqual(
    getReexportedDprRestorePasses(RENDER_PASS_NAMES),
    getExactAfterSettleDprRestorePasses(RENDER_PASS_NAMES),
  );
});

test("render pipeline owner uses catalog deferred pass default", () => {
  const { cache, metrics, owner, renderedPasses } = createContextBasePipelineHarness();

  owner.prepareIdleRenderPassDefinition("contextBase", () => {}, { k: 1, x: 0, y: 0 }, {}, cache);

  assert.equal(cache.dirty.contextBase, true);
  assert.equal(cache.reasons.contextBase, "signature");
  assert.deepEqual(renderedPasses, []);
  assert.equal(metrics.length, 1);
  assert.equal(metrics[0].name, "settleExactRefreshDeferredPass");
  assert.equal(metrics[0].details.passName, "contextBase");
});

test("render pipeline owner keeps constants override for deferred pass names", () => {
  const { cache, metrics, owner, renderedPasses } = createContextBasePipelineHarness({
    exactAfterSettleDeferredPassNames: new Set(),
  });

  owner.prepareIdleRenderPassDefinition("contextBase", () => {}, { k: 1, x: 0, y: 0 }, {}, cache);

  assert.deepEqual(renderedPasses, ["contextBase"]);
  assert.deepEqual(metrics, []);
});
