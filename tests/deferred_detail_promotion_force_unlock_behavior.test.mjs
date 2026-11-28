import assert from "node:assert/strict";
import test from "node:test";

import { createDeferredDetailPromotionOwner } from "../js/bootstrap/deferred_detail_promotion.js";
import { state as rendererState } from "../js/core/state.js";

function detailPromotionFixture() {
  const h = {};
  let markYielded;
  h.yielded = new Promise(resolve => { markYielded = resolve; });
  const gate = new Promise(resolve => { h.release = resolve; });
  h.state = { activeScenarioId: "tno_1962", sceneGeneration: 1, topologyBundleMode: "single",
    detailDeferred: true, detailPromotionCompleted: false, detailPromotionInFlight: false };
  h.detail = { type: "Topology", objects: { political: { type: "GeometryCollection", geometries: [] } }, arcs: [] };
  h.owner = createDeferredDetailPromotionOwner({ runtimeState: h.state, helpers: {
    loadDetailBundle: async () => ({ topologyDetail: h.detail, topologyBundleMode: "composite", detailSourceUsed: "na_v2" }),
    yieldToInput: () => { markYielded(); return gate; },
  } });
  // Settles on the yield, or on the promotion if it finishes without one.
  h.reachYield = promotion => Promise.race([h.yielded, promotion]);
  return h;
}

test("a scene change during the yield discards the loaded detail bundle", async t => {
  const h = detailPromotionFixture();
  // Read-only startup keeps the stale request from scheduling its own retry.
  h.state.startupReadonly = true;
  // The refresh scope reads the renderer's live scene.
  const previousGeneration = rendererState.sceneGeneration;
  t.after(() => { rendererState.sceneGeneration = previousGeneration; });
  const promotion = h.owner.ensureDetailTopologyReady({ applyMapData: false, flushPendingFocusRefresh: false });
  await h.reachYield(promotion);
  rendererState.sceneGeneration = (Number(previousGeneration) || 0) + 1;
  h.release();
  assert.equal(await promotion, false);
  assert.equal(h.state.topologyDetail, undefined);
  assert.equal(h.state.detailPromotionCompleted, false);
  assert.equal(h.state.detailPromotionInFlight, false);
});
