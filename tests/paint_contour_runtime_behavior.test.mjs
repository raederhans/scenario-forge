import test from 'node:test';
import assert from 'node:assert/strict';
import { createPaintContourRuntime } from '../js/core/renderer/paint_contour_runtime.js';
import { createPaintContourGraphBuilder } from '../js/core/renderer/paint_contour_graph.js';
import { createPaintContourWorkerClient } from '../js/core/paint_contour_worker_client.js';

const rect=(id,x)=>({id,geometry:{type:'Polygon',coordinates:[[[x,0],[x+1,0],[x+1,1],[x,1],[x,0]]]}});
function harness() {
  const a=rect('A',0),b=rect('B',1);
  const state={colorRevision:0,activeScenarioId:'test',land:[a,b]};
  const colors={A:'#ff0000',B:'#00ff00'};
  const tasks=[],scheduled=[],changes=[];let disposals=0,builder=null;
  const client={dispose(){disposals++;builder=null;},build(features,removed,options){
    if(options.reset)builder=createPaintContourGraphBuilder();
    builder.patch(features,removed);const graph=builder.finish();
    return new Promise((resolve,reject)=>tasks.push({features,removed,resolve:()=>resolve(graph),reject}));
  }};
  const runtime=createPaintContourRuntime({state,getFeatures:()=>state.land,getFeatureId:f=>f.id,
    isEligible:f=>!f.hidden,resolveColor:f=>colors[f.id],client,schedule:fn=>scheduled.push(fn),onChange:r=>changes.push(r)});
  const flush=async()=>{while(scheduled.length)scheduled.shift()();await Promise.resolve();};
  const finish=async()=>{tasks.at(-1).resolve();await Promise.resolve();await Promise.resolve();};
  return {a,b,state,colors,runtime,tasks,changes,flush,finish,disposals:()=>disposals};
}

test('paint, erase/undo and palette updates do not re-index geometry',async()=>{
  const h=harness();assert.deepEqual(h.runtime.getMeshes(),[]);await h.flush();await h.finish();
  assert.equal(h.runtime.diagnostics().status,'ready');assert.equal(h.runtime.diagnostics().activeArcCount,1);
  const first=h.runtime.getMeshes()[0],rev=h.runtime.getRevision();
  h.colors.B='#000001';h.state.colorRevision++;assert.equal(h.runtime.notifyPaintChanged(['B']),false);
  assert.equal(h.runtime.getRevision(),rev);assert.equal(h.runtime.getMeshes()[0],first);
  h.colors.B=h.colors.A;h.state.colorRevision++;assert.equal(h.runtime.notifyPaintChanged(['B']),true);
  assert.deepEqual(h.runtime.getMeshes(),[]);
  h.colors.B='#00ff00';h.state.colorRevision++;h.runtime.notifyPaintChanged(['B']);
  assert.equal(h.runtime.getMeshes().length,1);
  h.colors.A=h.colors.B;h.state.colorRevision+=2;h.runtime.getRevision();assert.deepEqual(h.runtime.getMeshes(),[]);
  assert.equal(h.tasks.length,1);assert.equal(h.runtime.diagnostics().builds,1);
});

test('a geometry reply uses the latest paint, not the paint at build start',async()=>{
  const h=harness();h.runtime.getMeshes();await h.flush();
  h.colors.B=h.colors.A;h.state.colorRevision++;h.runtime.notifyPaintChanged(['B']);
  await h.finish();assert.equal(h.runtime.diagnostics().status,'ready');assert.deepEqual(h.runtime.getMeshes(),[]);
});

test('geometry promotion clears stale contours and sends only changed feature geometry',async()=>{
  const h=harness();h.runtime.getMeshes();await h.flush();await h.finish();
  h.state.land=[h.a,rect('B',3)];h.state.topologyRevision=1;
  assert.deepEqual(h.runtime.getMeshes(),[]);await h.flush();
  assert.deepEqual(h.tasks[1].features.map(f=>f.id),['B']);
  await h.finish();assert.deepEqual(h.runtime.getMeshes(),[]);assert.equal(h.runtime.diagnostics().builds,2);
});

test('switching scenes rejects a late result and releases the previous graph',async()=>{
  const h=harness();h.runtime.getMeshes();await h.flush();const old=h.tasks[0];
  h.state.activeScenarioId='next';h.state.land=[rect('C',4)];h.colors.C='#123456';
  h.runtime.getMeshes();await h.flush();old.resolve();await Promise.resolve();
  assert.equal(h.runtime.diagnostics().status,'building');assert.deepEqual(h.runtime.getMeshes(),[]);
  await h.finish();assert.equal(h.runtime.diagnostics().featureCount,1);assert.equal(h.runtime.diagnostics().activeArcCount,0);
  assert.equal(h.changes.length,1);assert.ok(h.disposals()>=2);
});

test('multiple promotions while indexing coalesce and never publish an obsolete mesh',async()=>{
  const h=harness();h.runtime.getMeshes();await h.flush();
  h.state.land=[h.a,rect('B',3)];h.runtime.getMeshes();h.state.land=[h.a,rect('B',5)];h.runtime.getMeshes();
  await h.finish();assert.equal(h.changes.length,0);await h.flush();
  assert.equal(h.tasks.length,2);assert.equal(h.tasks[1].features[0].geometry.coordinates[0][0][0],5);
  await h.finish();assert.equal(h.changes.length,1);assert.deepEqual(h.runtime.getMeshes(),[]);
});

test('failed indexing does not revive reference borders or loop retries every frame',async()=>{
  const h=harness();h.runtime.getMeshes();await h.flush();h.tasks[0].reject(new Error('broken geometry worker'));
  await Promise.resolve();await Promise.resolve();
  for(let i=0;i<5;i++)assert.deepEqual(h.runtime.getMeshes(),[]);
  await h.flush();assert.equal(h.tasks.length,1);assert.equal(h.runtime.diagnostics().status,'error');
});

test('supplementary source arrival, removal and empty scene are generation-safe',async()=>{
  const h=harness();h.runtime.getMeshes();await h.flush();await h.finish();
  h.state.land=[...h.state.land,rect('island',2)];h.colors.island='#111111';h.runtime.getMeshes();await h.flush();
  assert.deepEqual(h.tasks[1].features.map(f=>f.id),['island']);await h.finish();assert.equal(h.runtime.diagnostics().activeArcCount,2);
  h.state.land=[h.a,h.b];h.runtime.getMeshes();await h.flush();assert.deepEqual(h.tasks[2].removed,['island']);
  await h.finish();assert.equal(h.runtime.diagnostics().activeArcCount,1);
  h.state.land=[];assert.deepEqual(h.runtime.getMeshes(),[]);assert.equal(h.runtime.diagnostics().status,'empty');
});

test('unsupported-worker fallback has the same graph contract and can be disposed',async()=>{
  const client=createPaintContourWorkerClient({isSupported:()=>false,yieldToHost:()=>Promise.resolve()});
  const graph=await client.build([rect('A',0),rect('B',1)],[],{reset:true});assert.equal(graph.diagnostics.arcCount,1);
  const update=await client.build([rect('B',3)],[],{reset:false});assert.equal(update.diagnostics.arcCount,0);client.dispose();
});


test('explicit same-collection topology revision does not reuse mutated geometry', async () => {
  const h = harness(); h.runtime.getMeshes(); await h.flush(); await h.finish();
  h.b.geometry.coordinates = rect('B', 5).geometry.coordinates;
  h.state.topologyRevision = 1;
  assert.deepEqual(h.runtime.getMeshes(), []); await h.flush();
  assert.equal(h.tasks[1].features.length, 2);
  await h.finish(); assert.equal(h.runtime.diagnostics().activeArcCount, 0);
});

test('metadata-only source replacement refreshes reference-derived colors', async () => {
  const h = harness(); h.runtime.getMeshes(); await h.flush(); await h.finish();
  h.colors.B = h.colors.A; h.state.land = [h.a, { ...h.b, properties: { group: 'new' } }];
  assert.deepEqual(h.runtime.getMeshes(), []);
  assert.equal(h.runtime.diagnostics().builds, 1);
});


test('export readiness waits for the actual graph and surfaces worker failures', async () => {
  const h = harness(); h.runtime.getMeshes(); await h.flush();
  let ready = false; const wait = h.runtime.ensureReady().then(() => { ready = true; });
  await Promise.resolve(); assert.equal(ready, false); assert.equal(h.runtime.hasPendingWork(), true);
  await h.finish(); await wait; assert.equal(ready, true); assert.equal(h.runtime.hasPendingWork(), false);
  h.state.land = [h.a, rect('B',4)]; h.runtime.getMeshes(); await h.flush();
  const failure = assert.rejects(h.runtime.ensureReady(), /preparation failed/);
  h.tasks.at(-1).reject(new Error('worker failure')); await failure;
});

test('same-scene data promotions preserve the worker index and only send replacements', async () => {
  const h=harness();h.runtime.getMeshes();await h.flush();await h.finish();
  const disposals=h.disposals();
  h.state.scenarioDataGeneration=3;h.state.land=[h.a,rect('B',4)];
  h.runtime.getMeshes();await h.flush();assert.equal(h.disposals(),disposals);
  assert.deepEqual(h.tasks.at(-1).features.map(f=>f.id),['B']);
  await h.finish();assert.equal(h.runtime.diagnostics().status,'ready');
});

test('source-declared coordinate precision survives composition and normalizer sidecars', async () => {
  const {registerContourSourcePrecision,getContourCoordinatePrecision,inheritContourCoordinatePrecision}=await import('../js/core/paint_contour_source.js');
  const coarse=rect('coarse',0),preserved=rect('preserved',1.000001),fine=rect('fine',3);
  registerContourSourcePrecision({features:[coarse,preserved]},{lod:'coarse',coordinatePrecision:4});
  registerContourSourcePrecision({features:[fine]},{lod:'detail',coordinatePrecision:4});
  assert.equal(getContourCoordinatePrecision(coarse.geometry),4);
  assert.equal(getContourCoordinatePrecision(preserved.geometry),7);
  assert.equal(getContourCoordinatePrecision(fine.geometry),7);
  const copied=structuredClone(coarse.geometry);inheritContourCoordinatePrecision(coarse.geometry,copied);
  assert.equal(getContourCoordinatePrecision(copied),4);
  assert.equal(Object.keys(coarse.geometry).includes('coordinatePrecision'),false);
});

test('metadata-only promotions during indexing do not discard an otherwise current graph', async () => {
  const h=harness();h.runtime.getMeshes();await h.flush();
  const version=h.runtime.diagnostics().sourceVersion;
  h.state.scenarioDataGeneration=8;h.runtime.getMeshes();
  assert.equal(h.runtime.diagnostics().sourceVersion,version);
  await h.finish();assert.equal(h.runtime.diagnostics().status,'ready');assert.equal(h.tasks.length,1);
});

test('malformed-ring contours follow the vendored d3 geometry stream', async () => {
  const {readFileSync}=await import('node:fs');const vm=await import('node:vm');
  const context={exports:{}};context.module={exports:context.exports};
  vm.runInNewContext(readFileSync(new URL('../vendor/d3.v7.min.js',import.meta.url),'utf8'),context);
  const feature={id:'open',geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,1]]]}};
  const vertices=[];context.exports.geoStream({type:'Feature',...feature},{polygonStart(){},polygonEnd(){},lineStart(){},lineEnd(){},point(x,y){vertices.push([x,y]);}});
  assert.deepEqual(vertices,[[0,0],[1,0],[1,1]]);
  const builder=createPaintContourGraphBuilder();builder.patch([feature,rect('neighbor',1)]);
  const graph=builder.finish();assert.equal(graph.diagnostics.invalidRings,1);assert.equal(graph.diagnostics.arcCount,1);
});

test('precision-only metadata publication updates the affected worker registration', async () => {
  const { registerContourSourcePrecision } = await import('../js/core/paint_contour_source.js');
  const h=harness();h.runtime.getMeshes();await h.flush();await h.finish();
  const disposals=h.disposals();
  registerContourSourcePrecision({features:[h.a]},{lod:'coarse',coordinatePrecision:4});
  h.state.scenarioDataGeneration=1;
  h.runtime.getMeshes();await h.flush();
  assert.equal(h.tasks.length,2);
  assert.deepEqual(h.tasks[1].features.map(f=>[f.id,f.coordinatePrecision]),[['A',4]]);
  assert.equal(h.disposals(),disposals);
  await h.finish();assert.equal(h.runtime.diagnostics().status,'ready');
});
