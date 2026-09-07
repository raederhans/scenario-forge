import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMergedScenarioChunkLayerPayloads,
  buildScenarioChunkLayerSelectionSignatures,
} from "../js/core/scenario/chunk_layer_payloads.js";

function fixture() {
  const a = { id: "a" }, b = { id: "b" };
  const oldPolitical = { features: ["old"] };
  return {
    bundle: { chunkRegistry: { byLayer: { political: [a, b], city: [] } } },
    state: {
      loadedChunkIds: ["a", "b"],
      payloadByChunkId: {
        a: { layerKey: "political", payload: { features: ["a"] } },
        b: { layerKey: "political", payload: { features: ["b"] } },
      },
      mergedLayerPayloads: { political: oldPolitical, removed: { features: ["removed"] } },
    },
    oldPolitical,
  };
}

for (const reuse of [false, true]) {
  test(`${reuse ? "reused" : "rebuilt"} layer projects viewport once, filters cache-only chunks and leaves commits to caller`, () => {
    const { bundle, state, oldPolitical } = fixture();
    const before = structuredClone(state);
    const signatures = buildScenarioChunkLayerSelectionSignatures(bundle, state, ["a"]);
    assert.deepEqual(signatures, { political: "a", city: "", removed: "" });
    const viewport = [0, 1, 2, 3];
    let merges = 0, projections = 0;
    const primary = { features: ["visible"] };
    const merged = { features: ["merged"] };
    const result = buildMergedScenarioChunkLayerPayloads(bundle, state, {
      activeChunkIds: ["a"],
      previousSignatures: { political: reuse ? "a" : "a|b", removed: "removed" },
      nextSignatures: signatures,
      previousMergedLayerPayloads: state.mergedLayerPayloads,
      viewportBbox: viewport,
      mergeScenarioChunkPayloads(layer, payloads) {
        merges += 1;
        assert.equal(layer, "political");
        assert.deepEqual(payloads, [{ features: ["a"] }]);
        return merged;
      },
      mergeScenarioChunkPayloadsForViewport(layer, entries, bounds) {
        projections += 1;
        assert.equal(layer, "political");
        assert.equal(entries.length, 1);
        assert.equal(entries[0].chunk, bundle.chunkRegistry.byLayer.political[0]);
        assert.equal(bounds, viewport);
        return { payload: primary, stats: { visibleFeatureCount: 1 } };
      },
    });
    assert.equal(merges, reuse ? 0 : 1);
    assert.equal(projections, 1);
    assert.equal(result.mergedLayerPayloads.political, reuse ? oldPolitical : merged);
    assert.equal(result.primaryMergedLayerPayloads.political, primary);
    assert.deepEqual(result.changedLayerKeys, reuse ? ["city", "removed"] : ["political", "city", "removed"]);
    assert.equal(result.mergedLayerPayloads.removed, null);
    assert.deepEqual(state, before);
  });
}

test("empty changed political layer clears primary while reusable null still projects the viewport", () => {
  const bundle = { chunkRegistry: { byLayer: { political: [] } } };
  const state = { loadedChunkIds: [], payloadByChunkId: {} };
  let projections = 0;
  const options = {
    mergeScenarioChunkPayloads: () => assert.fail("empty layer must not merge"),
    mergeScenarioChunkPayloadsForViewport: () => { projections += 1; return null; },
  };
  const changed = buildMergedScenarioChunkLayerPayloads(bundle, state, options);
  assert.deepEqual(changed.changedLayerKeys, ["political"]);
  assert.equal(changed.primaryMergedLayerPayloads.political, null);
  assert.equal(projections, 0);
  const reused = buildMergedScenarioChunkLayerPayloads(bundle, state, {
    ...options, previousMergedLayerPayloads: { political: null },
  });
  assert.deepEqual(reused.changedLayerKeys, []);
  assert.equal(projections, 1);
});
