import assert from "node:assert/strict";
import test from "node:test";
import { createRenderTransformReusePolicyOwner } from "../js/core/renderer/render_transform_reuse_policy_owner.js";
import { RENDER_PASS_NAMES } from "../js/core/map_renderer/render_pass_catalog.js";

function cloneZoomTransform(transform) {
  return {
    x: Number(transform?.x || 0),
    y: Number(transform?.y || 0),
    k: Math.max(0.0001, Number(transform?.k || 1)),
  };
}

function createOwner({
  state: stateOverrides = {},
  cache: cacheOverrides = {},
  references = {},
  heavyScenario = true,
  activePassNames = RENDER_PASS_NAMES,
} = {}) {
  const state = {
    width: 1000,
    height: 1000,
    renderProfile: "balanced",
    activeScenarioId: "tno_1962",
    zoomTransform: { k: 1, x: 0, y: 0 },
    deferContextBasePass: false,
    ...stateOverrides,
  };
  const cache = {
    canvases: {},
    counters: {},
    layouts: { contextScenario: { offsetX: 150, offsetY: 150 } },
    ...cacheOverrides,
  };
  const referenceTransforms = { ...references };
  return {
    cache,
    state,
    referenceTransforms,
    owner: createRenderTransformReusePolicyOwner({
      state,
      getters: {
        getRenderPassCacheState: () => cache,
        getPassReferenceTransform: (passName) => referenceTransforms[passName] || null,
        getActiveRenderPassNames: () => activePassNames,
      },
      helpers: {
        cloneZoomTransform,
        isHeavyScenarioStagedApplyCandidate: () => heavyScenario,
      },
    }),
  };
}

test("river detail boundary forces exact repaint in both zoom directions only while rivers are visible", () => {
  for (const [from, to] of [[4.9, 5], [5, 4.9]]) {
    const { owner, state } = createOwner({
      state: { showRivers: true },
      references: { contextBase: { k: from, x: 0, y: 0 } },
    });
    const next = { k: to, x: 0, y: 0 };
    assert.equal(owner.getContextBaseReuseDecision(next).reason, "river-bucket-change");
    assert.equal(owner.getContextBaseReuseDecision(next).shouldExactRefresh, true);
    state.showRivers = false;
    assert.equal(owner.getContextBaseReuseDecision(next).shouldExactRefresh, false);
  }
});

test("scenario reuse requires painted viewport coverage, not just distance and frame budgets", () => {
  const { owner } = createOwner({ references: { contextScenario: { k: 1, x: 0, y: 0 } } });
  for (const transform of [
    { k: 1, x: 100, y: 0 }, { k: 1, x: -100, y: 0 },
    { k: 1, x: 0, y: 100 }, { k: 1, x: 0, y: -100 },
    { k: 0.5, x: 250, y: 250 },
  ]) {
    const decision = owner.getContextScenarioReuseDecision(transform);
    assert.equal(decision.shouldExactRefresh, true);
    assert.equal(decision.reason, "viewport-uncovered");
  }
  assert.equal(owner.getContextScenarioReuseDecision({ k: 1, x: 90, y: -90 }).shouldExactRefresh, false);
  assert.equal(owner.getContextScenarioReuseDecision({ k: 2, x: -500, y: -500 }).shouldExactRefresh, false);
  const unpadded = createOwner({ cache: { layouts: {} }, references: { contextScenario: { k: 1, x: 0, y: 0 } } });
  assert.equal(unpadded.owner.getContextScenarioReuseDecision({ k: 1, x: 1, y: 0 }).shouldExactRefresh, true);
});
