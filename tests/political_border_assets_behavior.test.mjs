import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPaintContourGraph } from '../js/core/renderer/paint_contour_graph.js';
import { registerContourSourcePrecision, getContourCoordinatePrecision } from '../js/core/paint_contour_source.js';
import { createPoliticalBorderRuntime } from '../js/core/renderer/political_border_runtime.js';

const read = path => JSON.parse(fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const featureId = feature => String(feature.properties?.id ?? feature.id);
const pointKey = point => point.map(n => Math.round(n * 1e7)).join(',');
const edgeKey = (a,b) => [pointKey(a),pointKey(b)].sort().join('|');
function graphEdges(graph) {
  const result=new Set();
  for(let arc=0;arc<graph.offsets.length-1;arc++) {
    for(let i=graph.offsets[arc]+1;i<graph.offsets[arc+1];i++) {
      result.add(edgeKey([graph.coordinates[(i-1)*2],graph.coordinates[(i-1)*2+1]],
        [graph.coordinates[i*2],graph.coordinates[i*2+1]]));
    }
  }
  return result;
}

test('current TNO political mesh retains every known Swiss seam segment across coarse/detail promotions', () => {
  const manifest=read('data/scenarios/tno_1962/manifest.json');
  const chunks=read(manifest.detail_chunk_manifest_url).chunks;
  const selected=new Set(['AT342','CH055','CH070','ITC41']);
  const coarseChunk=chunks.find(c=>c.layer==='political'&&c.lod==='coarse');
  const coarse=read(coarseChunk.url);
  coarse.features=coarse.features.filter(f=>selected.has(featureId(f)));
  registerContourSourcePrecision(coarse,coarseChunk);
  const detail=[];
  // Always use current manifest references; legacy detail.country.de.json etc
  // can remain on disk while no longer representing the current scenario.
  for(const chunk of chunks.filter(c=>c.layer==='political'&&c.lod==='detail'
    && /country\.(ger|swi|ita)(\.|$)/.test(c.id))) {
    detail.push(...read(chunk.url).features.filter(f=>selected.has(featureId(f))));
  }
  assert.equal(coarse.features.length,4);assert.equal(detail.length,4);
  const graph=features=>buildPaintContourGraph(features.map(f=>({id:featureId(f),geometry:f.geometry,
    coordinatePrecision:getContourCoordinatePrecision(f.geometry)})));
  const detailedEdges=graphEdges(graph(detail));
  assert.equal(detailedEdges.size,8);
  assert.ok(graphEdges(graph(coarse.features)).size<detailedEdges.size,'fixture still reproduces the source LOD mismatch');
  const pack=read(manifest.mesh_pack_url);
  const state={activeScenarioId:'tno_1962',activeScenarioManifest:manifest,activeScenarioMeshPack:pack,
    mapSemanticMode:'political',landData:coarse};
  const runtime=createPoliticalBorderRuntime({state,buildMesh:()=>assert.fail('must use full-source mesh pack')});
  const mesh=runtime.getMeshes()[0];
  const renderedEdges=new Set();
  for(const line of mesh.coordinates)for(let i=1;i<line.length;i++)renderedEdges.add(edgeKey(line[i-1],line[i]));
  for(const edge of detailedEdges)assert.ok(renderedEdges.has(edge),`missing Swiss border segment ${edge}`);
  const revision=runtime.getRevision();
  state.landData={type:'FeatureCollection',features:detail};state.topologyRevision=5;state.scenarioDataGeneration=3;
  assert.equal(runtime.getMeshes()[0],mesh);
  assert.equal(runtime.getRevision(),revision);
});
