import assert from "node:assert/strict";
import test from "node:test";
import { buildMergedScenarioChunkLayerPayloads } from "../js/core/scenario/chunk_layer_payloads.js";

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

test("merge preserves frozen input and borrowed output identities", () => {
  const { bundle, state, oldPolitical } = fixture();
  const freeze = value => {
    if (!value || typeof value !== "object") return value;
    Object.values(value).forEach(freeze);
    return Object.freeze(value);
  };
  freeze(bundle);
  freeze(state);
  const primary = Object.freeze({ features: Object.freeze(["visible"]) });
  const stats = Object.freeze({ visibleFeatureCount: 1 });
  const options = freeze({
    activeChunkIds: ["a"], viewportBbox: [0, 1, 2, 3],
    previousSignatures: { political: "same", removed: "removed" },
    nextSignatures: { political: "same" },
    previousMergedLayerPayloads: state.mergedLayerPayloads,
    mergeScenarioChunkPayloads() { throw new Error("unchanged layer must reuse its payload"); },
    mergeScenarioChunkPayloadsForViewport(layerKey, entries, viewport) {
      assert.equal(entries[0].payload, state.payloadByChunkId.a.payload);
      assert.equal(entries[0].chunk, bundle.chunkRegistry.byLayer.political[0]);
      assert.equal(viewport, options.viewportBbox);
      return { payload: primary, stats };
    },
  });
  const first = buildMergedScenarioChunkLayerPayloads(bundle, state, options);
  assert.equal(first.mergedLayerPayloads.political, oldPolitical);
  assert.equal(first.primaryMergedLayerPayloads.political, primary);
});

test('real chunk composition publishes only declared on-grid contour precision', async () => {
  const {normalizeScenarioChunkManifest}=await import('../js/core/scenario_chunk_manager.js');
  const {getContourCoordinatePrecision}=await import('../js/core/paint_contour_source.js');
  const make=(id,x)=>({type:'Feature',properties:{id},geometry:{type:'Polygon',coordinates:[[[x,0],[x+1,0],[x+1,1],[x,1],[x,0]]]}});
  const a=make('a',0),b=make('b',1.000001),detail=make('detail',2);
  const registry=normalizeScenarioChunkManifest({chunks:[
    {id:'coarse',url:'coarse.json',layer:'political',lod:'coarse',global_coverage:true,lod_diagnostics:{round_decimals:4}},
    {id:'detail',url:'detail.json',layer:'political',lod:'detail'},
  ]});
  const bundle={chunkRegistry:registry};
  const state={loadedChunkIds:['coarse','detail'],payloadByChunkId:{
    coarse:{layerKey:'political',payload:{type:'FeatureCollection',features:[a,b]}},
    detail:{layerKey:'political',payload:{type:'FeatureCollection',features:[detail]}},
  }};
  const result=buildMergedScenarioChunkLayerPayloads(bundle,state,{nextSignatures:{political:'a'}});
  assert.equal(result.mergedLayerPayloads.political.features.length,3);
  assert.equal(getContourCoordinatePrecision(a.geometry),4);
  assert.equal(getContourCoordinatePrecision(b.geometry),7);
  assert.equal(getContourCoordinatePrecision(detail.geometry),7);
});
