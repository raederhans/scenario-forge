import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMergedScenarioChunkLayerPayloads,
  buildScenarioChunkLayerSelectionSignatures,
} from "../js/core/scenario/chunk_layer_payloads.js";

test("viewport metadata reads the registry once and observes in-place registry edits next call", () => {
  let reads = 0;
  const chunks = Array.from({ length: 80 }, (_, i) => ({ get id() { reads += 1; return `c${i}`; } }));
  const bundle = { chunkRegistry: { byLayer: { political: chunks, city: [] } } };
  const state = { loadedChunkIds: chunks.map((_, i) => `c${i}`),
    payloadByChunkId: Object.fromEntries(chunks.map((_, i) => [`c${i}`, { layerKey: "political", payload: {} }])) };
  let projectedEntries;
  const options = { nextSignatures: { political: "all" }, mergeScenarioChunkPayloads: () => ({}),
    mergeScenarioChunkPayloadsForViewport: (_layer, entries) => { projectedEntries = entries; return { payload: {} }; } };
  buildMergedScenarioChunkLayerPayloads(bundle, state, options);
  assert.equal(reads, 80);
  assert.equal(projectedEntries[79].chunk, chunks[79]);
  const replacement = { id: "c0", bounds: [0, 0, 1, 1] };
  chunks[0] = replacement;
  buildMergedScenarioChunkLayerPayloads(bundle, state, options);
  assert.equal(projectedEntries[0].chunk, replacement);
});

test("political merge reads precision metadata and duplicate IDs keep first registry entry", () => {
  const first = { id: "a" }, duplicate = { id: "a" };
  const bundle = { chunkRegistry: { byLayer: { political: [first], city: [duplicate] } } };
  const state = { loadedChunkIds: ["a"], payloadByChunkId: { a: { layerKey: "political", payload: {} } } };
  const options = { mergeScenarioChunkPayloads: () => ({}),
    mergeScenarioChunkPayloadsForViewport: (_layer, entries) => { assert.equal(entries[0].chunk, first); return {}; } };
  buildMergedScenarioChunkLayerPayloads(bundle, state, options);
  let reads = 0;
  Object.defineProperty(first, "id", { get() { reads += 1; return "a"; } });
  buildMergedScenarioChunkLayerPayloads(bundle, state, { mergeScenarioChunkPayloads: () => ({}) });
  assert.equal(reads, 1);
});

test("unchanged viewport reuses primary merge and bbox, payload, selection and merger changes invalidate it", () => {
  const { bundle, state } = fixture();
  let merges = 0;
  const options = {
    activeChunkIds: ["a"], viewportBbox: [0, 1, 2, 3],
    nextSignatures: { political: "a" },
    mergeScenarioChunkPayloads: () => ({}),
    mergeScenarioChunkPayloadsForViewport: () => ({ payload: { revision: ++merges }, stats: {} }),
  };
  const run = () => buildMergedScenarioChunkLayerPayloads(bundle, state, options).primaryMergedLayerPayloads.political;
  const first = run();
  assert.equal(run(), first);
  assert.equal(merges, 1);
  options.viewportBbox = [0, 1, 3, 4];
  assert.notEqual(run(), first);
  assert.equal(merges, 2);
  state.payloadByChunkId.a = { layerKey: "political", payload: { features: ["replacement"] } };
  run();
  assert.equal(merges, 3);
  options.activeChunkIds = ["b"];
  options.nextSignatures = { political: "b" };
  run();
  assert.equal(merges, 4);
  options.mergeScenarioChunkPayloadsForViewport = () => ({ payload: { revision: ++merges } });
  run();
  assert.equal(merges, 5);
});

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
    assert.match(signatures.political, /^a@\d+$/);
    assert.equal(signatures.city, "");
    assert.equal(signatures.removed, "");
    const viewport = [0, 1, 2, 3];
    let merges = 0, projections = 0;
    const primary = { features: ["visible"] };
    const merged = { features: ["merged"] };
    const result = buildMergedScenarioChunkLayerPayloads(bundle, state, {
      activeChunkIds: ["a"],
      previousSignatures: { political: reuse ? signatures.political : "a|b", removed: "removed" },
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

test("persistent political coverage shares the complete payload across viewport changes without projecting", () => {
  const bundle = { chunkRegistry: { byLayer: { political: [
    { id: "base", lod: "coarse", globalCoverage: true },
    { id: "detail", lod: "detail" },
  ] } } };
  const a = { id: "a" }, b = { id: "b" }, detailA = { id: "a", detail: true };
  const state = { loadedChunkIds: ["base", "detail"], payloadByChunkId: {
    base: { layerKey: "political", payload: { features: [a, b] } },
    detail: { layerKey: "political", payload: { features: [detailA] } },
  } };
  const merged = { features: [detailA, b] };
  let merges = 0;
  const options = {
    nextSignatures: { political: "base|detail" }, viewportBbox: [0, 0, 1, 1],
    mergeScenarioChunkPayloads: () => { merges += 1; return merged; },
    mergeScenarioChunkPayloadsForViewport: () => assert.fail("complete base must not project a subset"),
  };
  const first = buildMergedScenarioChunkLayerPayloads(bundle, state, options);
  assert.equal(first.primaryMergedLayerPayloads.political, first.mergedLayerPayloads.political);
  assert.equal(first.mergedLayerPayloads.political.globalCoverage, true);
  assert.equal(first.mergedLayerPayloads.political.features, merged.features);
  assert.equal(merged.globalCoverage, undefined, "coverage metadata must not mutate a borrowed payload");
  assert.deepEqual(first.primaryLayerStats.political, {
    coverageMode: "full", visibleFeatureCount: 2, totalFeatureCount: 2,
    clippedChunkCount: 0, fullChunkCount: 2, unboundedChunkCount: 0,
  });
  const panned = buildMergedScenarioChunkLayerPayloads(bundle, state, {
    ...options, viewportBbox: [50, 0, 60, 10], previousSignatures: options.nextSignatures,
    previousMergedLayerPayloads: first.mergedLayerPayloads,
  });
  assert.equal(merges, 1);
  assert.equal(panned.primaryMergedLayerPayloads.political, first.mergedLayerPayloads.political);
  assert.equal(panned.primaryMergedLayerPayloads.political, panned.mergedLayerPayloads.political);
  assert.deepEqual(panned.primaryLayerStats.political, first.primaryLayerStats.political);
  const withoutProjector = buildMergedScenarioChunkLayerPayloads(bundle, state, {
    ...options, mergeScenarioChunkPayloadsForViewport: null,
  });
  assert.equal(withoutProjector.primaryMergedLayerPayloads.political.globalCoverage, true);
  assert.equal(withoutProjector.primaryMergedLayerPayloads.political.features, merged.features);
  assert.equal(withoutProjector.primaryMergedLayerPayloads.political, withoutProjector.mergedLayerPayloads.political);
});

test("merge preserves frozen input and borrowed output identities while private viewport cache stays effective", () => {
  const { bundle, state, oldPolitical } = fixture();
  const freeze = value => {
    if (!value || typeof value !== "object") return value;
    Object.values(value).forEach(freeze);
    return Object.freeze(value);
  };
  freeze(bundle);
  freeze(state);
  const calls = [];
  const primary = Object.freeze({ features: Object.freeze(["visible"]) });
  const stats = Object.freeze({ visibleFeatureCount: 1 });
  const options = freeze({
    activeChunkIds: ["a"], viewportBbox: [0, 1, 2, 3],
    previousSignatures: { political: "same", removed: "removed" },
    nextSignatures: { political: "same" },
    previousMergedLayerPayloads: state.mergedLayerPayloads,
    mergeScenarioChunkPayloads() { throw new Error("unchanged layer must reuse its payload"); },
    mergeScenarioChunkPayloadsForViewport(layerKey, entries, viewport) {
      calls.push(layerKey);
      assert.equal(entries[0].payload, state.payloadByChunkId.a.payload);
      assert.equal(entries[0].chunk, bundle.chunkRegistry.byLayer.political[0]);
      assert.equal(viewport, options.viewportBbox);
      return { payload: primary, stats };
    },
  });
  const first = buildMergedScenarioChunkLayerPayloads(bundle, state, options);
  const second = buildMergedScenarioChunkLayerPayloads(bundle, state, options);
  assert.equal(first.mergedLayerPayloads.political, oldPolitical);
  assert.equal(second.mergedLayerPayloads.political, oldPolitical);
  assert.equal(first.primaryMergedLayerPayloads.political, primary);
  assert.equal(second.primaryMergedLayerPayloads.political, primary);
  assert.equal(second.primaryLayerStats.political, stats);
  assert.deepEqual(calls, ["political"]);
  assert.deepEqual(first.changedLayerKeys, ["city", "removed"]);
});
