import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createPaintContourRuntime } from '../js/core/renderer/paint_contour_runtime.js';
import { createPaintContourGraphBuilder } from '../js/core/renderer/paint_contour_graph.js';
import { createPaintContourWorkerClient } from '../js/core/paint_contour_worker_client.js';
import { getPackedPaintContourMesh } from '../js/core/renderer/paint_contour_mesh.js';
import { createBorderIdentityResolver } from '../js/core/renderer/border_identity.js';
import { packContourWaterMask } from '../js/core/renderer/paint_contour_water_mask.js';

const stableDiagnostics = diagnostics => Object.fromEntries(Object.entries(diagnostics)
  .filter(([key]) => !(key.startsWith('nearSeam') && (key.endsWith('Ms') || key.endsWith('Bytes')))));

test('scenario classification reuses the graph, refreshes dirty arcs and invalidates borders on grouping or palette changes', async () => {
  let palette = { A: '#ff0000', B: '#00ff00' }, districts = {}, h;
  const overrides = {}, resolved = [];
  const identity = createBorderIdentityResolver({ sovereignBaseColors: () => palette,
    getReferenceOwner: id => h.owners[id], getOverrideColor: id => overrides[id] });
  h = harness({ resolveClassification: (feature, id) => {
    resolved.push(id);
    return { borderKey: identity(id), parentKey: districts[id] || '', provinceKey: 'same' };
  }, getClassificationRevision: () => [palette, districts] });
  assert.equal(h.runtime.getClassification(), null);
  await h.flush(); await h.finish();
  assert.equal(h.runtime.getClassification().country.length, 1);
  resolved.length = 0;
  overrides.B = '#ff0000'; h.colors.B = '#ff0000'; h.state.colorRevision++;
  assert.equal(h.runtime.notifyPaintChanged(['B']), true);
  assert.deepEqual(resolved, ['B']);
  assert.equal(h.runtime.getClassification().country.length, 0);
  assert.equal(h.runtime.getClassification().local.has('A'), true);
  assert.deepEqual(h.runtime.getMeshes(), []);
  const changes = h.changes.length;
  districts = { A: 'west', B: 'east' }; resolved.length = 0;
  assert.equal(h.runtime.getClassification().parent.has('A'), true);
  assert.deepEqual(resolved, ['A', 'B']);
  assert.equal(h.changes.length, changes + 1);
  palette = { A: '#000001', B: '#00ff00' };
  assert.equal(h.runtime.getClassification().country.length, 1);
  assert.equal(h.runtime.diagnostics().builds, 1);
  h.state.activeScenarioId = '';
  assert.equal(h.runtime.getClassification(), null);
  await h.flush(); await h.finish();
  assert.equal(h.runtime.getClassification(), null);
});

test('a geometry rebuild in the same scene keeps painted borders instead of reviving reference borders', async () => {
  const keys = { A: 'A', B: 'B' };
  const h = harness({ resolveClassification: (feature, id) => ({ borderKey: keys[id], parentKey: '', provinceKey: '' }) });
  h.runtime.getClassification(); await h.flush(); await h.finish();
  keys.B = 'A'; h.colors.B = h.colors.A; h.state.colorRevision++;
  h.runtime.notifyPaintChanged(['B']);
  assert.equal(h.runtime.getClassification().country.length, 0);
  h.state.land = [h.a, { ...h.b, geometry: rect('B', 1).geometry }];
  assert.equal(h.runtime.getClassification().country.length, 0, 'rebuild must not fall back to reference borders');
  await h.flush(); await h.finish();
  assert.equal(h.runtime.getClassification().country.length, 0);
  h.state.sceneGeneration = 1;
  assert.equal(h.runtime.getClassification(), null, 'a new scene never reuses the previous scene borders');
});

const rect=(id,x)=>({id,geometry:{type:'Polygon',coordinates:[[[x,0],[x+1,0],[x+1,1],[x,1],[x,0]]]}});
function harness(runtimeOptions = {}) {
  const a=rect('A',0),b=rect('B',1);
  const state={colorRevision:0,sovereigntyRevision:0,viewMode:'owner',separatePoliticalBorders:false,activeScenarioId:'test',land:[a,b]};
  const colors={A:'#ff0000',B:'#00ff00'};
  const owners={A:'A',B:'B'};
  const scans={ids:0,eligible:0};
  const tasks=[],scheduled=[],changes=[];let disposals=0,builder=null,finished=false,dirty=true;
  const client={dispose(){disposals++;builder=null;finished=false;dirty=true;},build(features,removed,options){
    const ownedDisposals=disposals;
    if(options.reuse){
      assert.ok(finished&&!dirty,'reuse must have a successful clean graph');
      assert.equal(removed.length,0);
      if(features.length){
        assert.equal(options.certifiedEquivalent,true);
        builder.patch(features,removed);
      }
      return new Promise((resolve,reject)=>tasks.push({features,removed,options,resolve:()=>resolve({unchanged:true}),reject}));
    }
    if(options.reset)builder=createPaintContourGraphBuilder({nearSeamTolerance:options.nearSeamTolerance});
    if(options.waterMask !== undefined)builder.setWaterMask(options.waterMask);
    dirty=true;builder.patch(features,removed);const graph=builder.finish();
    return new Promise((resolve,reject)=>tasks.push({features,removed,options,resolve:()=>{
      if(ownedDisposals===disposals){finished=true;dirty=false;}resolve(graph);
    },reject}));
  }};
  const runtime=createPaintContourRuntime({state,getFeatures:()=>state.land,getFeatureId:f=>{scans.ids++;return f.id;},
    isEligible:f=>{scans.eligible++;return !f.hidden;},resolveColor:f=>colors[f.id],
    resolveBoundaryKey:f=>owners[f.id],
    getBoundaryRevision:()=>`${state.sovereigntyRevision}|${state.viewMode}`,
    separatePoliticalBorders:()=>state.separatePoliticalBorders,
    client,schedule:fn=>scheduled.push(fn),onChange:r=>changes.push(r),...runtimeOptions});
  const flush=async()=>{while(scheduled.length)scheduled.shift()();await Promise.resolve();};
  const finish=async()=>{tasks.at(-1).resolve();await Promise.resolve();await Promise.resolve();};
  return {a,b,state,colors,owners,scans,runtime,tasks,changes,flush,finish,disposals:()=>disposals};
}

test('political separation, ownership and view changes reuse the geometry graph', async () => {
  const h = harness();
  h.runtime.getMeshes(); await h.flush(); await h.finish();
  assert.equal(h.runtime.diagnostics().activeArcCount, 1);
  h.state.separatePoliticalBorders = true;
  assert.deepEqual(h.runtime.getMeshes(), []);
  const built = h.runtime.diagnostics().builds;
  h.owners.B = h.owners.A; h.state.sovereigntyRevision++;
  assert.equal(h.runtime.getMeshes().length, 1);
  h.state.viewMode = 'control';
  assert.equal(h.runtime.getMeshes().length, 1);
  h.owners.B = 'B'; h.state.sovereigntyRevision++;
  assert.deepEqual(h.runtime.getMeshes(), []);
  h.state.separatePoliticalBorders = false;
  assert.equal(h.runtime.getMeshes().length, 1);
  assert.equal(h.runtime.diagnostics().builds, built);
});

test('late geometry uses current separation and ownership state and scene reset rejects old ownership', async () => {
  const h = harness();
  h.runtime.getMeshes(); await h.flush();
  h.state.separatePoliticalBorders = true;
  h.owners.B = h.owners.A;
  await h.finish(); assert.equal(h.runtime.getMeshes().length, 1);
  h.state.activeScenarioId = 'next'; h.state.land = [rect('C', 4)];
  h.colors.C = '#111111'; h.owners.C = 'C';
  assert.deepEqual(h.runtime.getMeshes(), []); await h.flush(); await h.finish();
  assert.equal(h.runtime.diagnostics().activeArcCount, 0);
});

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

test('an immutable publication observed before its topology bump reuses the completed graph', async () => {
  const h = harness(); h.runtime.getMeshes(); await h.flush(); await h.finish();
  const mesh = h.runtime.getMeshes()[0], version = h.runtime.diagnostics().sourceVersion;
  h.state.land = h.state.land.map(feature => ({ ...feature, properties: { published: true } }));
  h.state.scenarioDataGeneration = 1;
  h.runtime.notifyPaintChanged();
  h.state.topologyRevision = 1;
  assert.equal(h.runtime.notifySourcePublished({ previousTopologyRevision: 0 }), false);
  await h.flush();
  assert.equal(h.runtime.getMeshes()[0], mesh);
  assert.equal(h.runtime.diagnostics().sourceVersion, version);
  assert.equal(h.tasks.length, 1, 'exact geometry does not repeat registration or graph finish');
  assert.equal(h.runtime.diagnostics().sentFeatures, 2);

  h.b.geometry.coordinates = rect('B', 5).geometry.coordinates;
  h.state.topologyRevision = 2;
  assert.deepEqual(h.runtime.getMeshes(), []);
  await h.flush();
  assert.deepEqual(h.tasks[1].features.map(feature => feature.id), ['A', 'B'], 'the publication grants no future mutation exemption');
  await h.finish();
  assert.equal(h.runtime.diagnostics().activeArcCount, 0);
});

test('a certified trailing publication skips feature scans and still updates current paint and boundary rules', async () => {
  const h = harness(); h.runtime.getMeshes(); await h.flush(); await h.finish();
  h.state.land = h.state.land.map(feature => ({ ...feature, properties: { published: true } }));
  h.state.scenarioDataGeneration = 1;
  h.runtime.notifyPaintChanged();
  assert.deepEqual(h.scans, { ids: 4, eligible: 4 }, 'adoption already compared the new source');
  const version = h.runtime.diagnostics().sourceVersion;

  h.colors.B = h.colors.A; h.state.colorRevision++; h.state.topologyRevision = 1;
  assert.equal(h.runtime.notifySourcePublished({ previousTopologyRevision: 0 }), true, 'paint is refreshed by the notification itself');
  assert.deepEqual(h.scans, { ids: 4, eligible: 4 });
  assert.equal(h.runtime.diagnostics().activeArcCount, 0);
  h.colors.B = '#00ff00'; h.state.colorRevision++; h.runtime.notifyPaintChanged(['B']);
  assert.equal(h.runtime.getMeshes().length, 1);

  h.state.separatePoliticalBorders = true; h.state.sovereigntyRevision++; h.state.topologyRevision = 2;
  assert.equal(h.runtime.notifySourcePublished({ previousTopologyRevision: 1 }), true, 'boundary rules are refreshed without another source scan');
  assert.deepEqual(h.scans, { ids: 4, eligible: 4 });
  assert.equal(h.runtime.diagnostics().activeArcCount, 0);
  h.owners.B = h.owners.A; h.state.sovereigntyRevision++;
  assert.equal(h.runtime.getMeshes().length, 1);
  await h.flush();
  assert.equal(h.tasks.length, 1);
  assert.equal(h.runtime.diagnostics().sourceVersion, version);
});

test('publication generation or eligibility signal changes still scan every source feature', async () => {
  for (const [field, value] of [['scenarioDataGeneration', 1], ['showScenarioAtlantropa', false],
    ['showWaterRegions', true], ['showWaterRegions', null], ['mapSemanticMode', 'blank']]) {
    const h = harness(); h.runtime.getMeshes(); await h.flush(); await h.finish();
    h.b.hidden = true;
    h.state[field] = value; h.state.topologyRevision = 1;
    h.runtime.notifySourcePublished({ previousTopologyRevision: 0 });
    assert.deepEqual(h.scans, { ids: 4, eligible: 4 }, field);
    await h.flush();
    assert.deepEqual(h.tasks[1].removed, field === 'mapSemanticMode' ? [] : ['B'], field);
    if (field === 'mapSemanticMode') assert.equal(h.tasks[1].options.nearSeamTolerance, 0);
    await h.finish(); assert.equal(h.runtime.diagnostics().featureCount, 1);
  }
});

test('a certified publication with a different source array still performs its first comparison', async () => {
  const h = harness(); h.runtime.getMeshes(); await h.flush(); await h.finish();
  h.state.land = [...h.state.land]; h.state.topologyRevision = 1;
  h.runtime.notifySourcePublished({ previousTopologyRevision: 0 });
  assert.deepEqual(h.scans, { ids: 4, eligible: 4 });
  await h.flush(); assert.equal(h.tasks.length, 1);
});

test('a publication topology bump does not obsolete an in-flight geometry delta', async () => {
  const h = harness(); h.runtime.getMeshes(); await h.flush(); await h.finish();
  h.state.land = [h.a, rect('B', 3)]; h.state.scenarioDataGeneration = 1;
  h.runtime.notifyPaintChanged(); await h.flush();
  assert.deepEqual(h.tasks[1].features.map(feature => feature.id), ['B']);
  const version = h.runtime.diagnostics().sourceVersion;
  const scans = { ...h.scans };
  h.state.topologyRevision = 1;
  h.runtime.notifySourcePublished({ previousTopologyRevision: 0 });
  assert.deepEqual(h.scans, scans, 'the already-indexed source is not scanned again while the delta runs');
  assert.equal(h.runtime.diagnostics().sourceVersion, version);
  await h.finish(); await h.flush();
  assert.equal(h.tasks.length, 2);
  assert.equal(h.runtime.diagnostics().sentFeatures, 3);
  assert.equal(h.runtime.diagnostics().status, 'ready');
  assert.equal(h.runtime.hasPendingWork(), false);
  assert.equal(h.changes.length, 2, 'the actual latest graph is published');
});

test('publication still patches precision, eligibility, additions and removals', async () => {
  const { registerContourSourcePrecision } = await import('../js/core/paint_contour_source.js');
  const h = harness(); h.runtime.getMeshes(); await h.flush(); await h.finish();
  registerContourSourcePrecision({ features: [h.a] }, { lod: 'coarse', coordinatePrecision: 4 });
  h.state.land = [h.a, { ...h.b, hidden: true }, rect('C', 3)];
  h.colors.C = '#111111'; h.state.scenarioDataGeneration = 1; h.state.topologyRevision = 1;
  h.runtime.notifySourcePublished({ previousTopologyRevision: 0 }); await h.flush();
  assert.deepEqual(h.tasks[1].features.map(feature => [feature.id, feature.coordinatePrecision]), [['A', 4], ['C', 7]]);
  assert.deepEqual(h.tasks[1].removed, ['B']);
  assert.equal(h.tasks[1].options.reset, false);
  await h.finish();
  assert.equal(h.runtime.diagnostics().featureCount, 2);
  assert.equal(h.runtime.diagnostics().status, 'ready');
});

test('unmatched or nonadjacent publication notifications retain the in-place mutation fence', async () => {
  for (const [previousTopologyRevision, topologyRevision] of [[0, 2], [-1, 1], [1, 1], [undefined, 1]]) {
    const h = harness(); h.runtime.getMeshes(); await h.flush(); await h.finish();
    h.b.geometry.coordinates = rect('B', 5).geometry.coordinates;
    h.state.topologyRevision = topologyRevision;
    const scans = { ...h.scans };
    h.runtime.notifySourcePublished({ previousTopologyRevision }); await h.flush();
    assert.deepEqual(h.scans, { ids: scans.ids + 2, eligible: scans.eligible + 2 });
    assert.equal(h.tasks[1].features.length, 2);
    await h.finish();
    assert.equal(h.runtime.diagnostics().activeArcCount, 0);
  }
});

test('successive immutable publications keep worker registration separate from stale graph replies', async () => {
  const h = harness(); h.runtime.getMeshes(); await h.flush(); await h.finish();
  h.state.land = [h.a, rect('B', 3)]; h.state.topologyRevision = 1;
  h.runtime.notifySourcePublished({ previousTopologyRevision: 0 }); await h.flush();
  h.state.land = [h.a, rect('B', 5)]; h.state.topologyRevision = 2;
  h.runtime.notifySourcePublished({ previousTopologyRevision: 1 });
  await h.finish();
  assert.equal(h.changes.length, 1, 'the obsolete first publication cannot revive a mesh');
  assert.deepEqual(h.runtime.getMeshes(), []);
  await h.flush();
  assert.deepEqual(h.tasks[2].features.map(feature => feature.id), ['B']);
  assert.equal(h.tasks[2].features[0].geometry.coordinates[0][0][0], 5);
  assert.equal(h.tasks[2].options.reset, false, 'the acknowledged first delta remains the worker authority');
  await h.finish();
  assert.equal(h.runtime.diagnostics().status, 'ready');
  assert.equal(h.runtime.diagnostics().sentFeatures, 4);
  assert.equal(h.changes.length, 2);
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

function loopbackContourWorker({ holdPatch = false, builderFactory = createPaintContourGraphBuilder } = {}) {
  const sent = [], replies = [];
  let terminations = 0;
  const worker = { terminate() { terminations++; }, postMessage(message, transfer = []) {
    const packet = structuredClone(message, { transfer });
    sent.push({ packet, transferred: transfer.length, detached: transfer.every(buffer => buffer.byteLength === 0) });
    if (holdPatch && packet.type === 'PATCH') return;
    scope.self.onmessage({ data: packet });
  } };
  const scope = { createPaintContourGraphBuilder: builderFactory,
    __scenarioForgeGeometryTransferCodecShared: globalThis.__scenarioForgeGeometryTransferCodecShared,
    self: { postMessage(message, transfer = []) {
      const packet = structuredClone(message, { transfer });
      replies.push({ packet, transferred: transfer.length });
      queueMicrotask(() => worker.onmessage({ data: packet }));
    } },
  };
  const source = readFileSync(new URL('../js/workers/paint_contour.worker.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '');
  vm.runInNewContext(source, scope);
  return { worker, sent, replies, receive: packet => scope.self.onmessage({ data: packet }), terminations: () => terminations };
}

test('water revisions rebuild without geometry transfers and unchanged sources reuse the worker mask', async () => {
  let revision = 0, calls = 0;
  let land = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-1,-1],[4,-1],[4,3],[-1,3],[-1,-1]]] } };
  const h = harness({ getWaterRevision: () => [revision], getWaterMaskSources: () => { calls++; return { land }; } });
  h.state.land = [rect('A',0),rect('B',1.03)];
  h.runtime.getMeshes(); await h.flush(); await h.finish();
  assert.ok(h.runtime.diagnostics().nearSeamSegments > 0); assert.equal(calls,1);
  h.state.land = structuredClone(h.state.land); h.runtime.getMeshes(); await h.flush(); await h.finish();
  assert.equal(h.tasks[1].options.waterMask,undefined); assert.equal(calls,1);
  land = { type: 'FeatureCollection', features: h.state.land.map(f => ({ ...f, type: 'Feature' })) }; revision++;
  h.runtime.getMeshes(); await h.flush(); await h.finish();
  assert.equal(h.tasks[2].features.length,0); assert.equal(h.tasks[2].options.reuse,false);
  assert.equal(h.runtime.diagnostics().nearSeamSegments,0); assert.equal(calls,2);
  h.state.sceneGeneration=1;h.runtime.getMeshes();await h.flush();await h.finish();assert.equal(calls,3);
});

test('an empty water collection replaced by another empty collection does not rebuild the graph', async () => {
  let landMask = { type: 'FeatureCollection', features: [] }, calls = 0;
  const h = harness({ getWaterRevision: () => [landMask], getWaterMaskSources: () => { calls++; return { land: landMask }; } });
  h.runtime.getMeshes(); await h.flush(); await h.finish();
  assert.equal(h.tasks.length, 1); assert.equal(calls, 1);
  const version = h.runtime.diagnostics().sourceVersion;
  landMask = { type: 'FeatureCollection', features: [] };
  h.runtime.getMeshes(); await h.flush();
  assert.equal(h.tasks.length, 1, 'another empty collection packs to the same mask');
  assert.equal(h.runtime.diagnostics().sourceVersion, version); assert.equal(calls, 1);
  landMask = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-1,-1],[4,-1],[4,3],[-1,3],[-1,-1]]] } }] };
  h.runtime.getMeshes(); await h.flush(); await h.finish();
  assert.equal(h.tasks.length, 2); assert.equal(h.tasks[1].features.length, 0); assert.equal(h.tasks[1].options.reuse, false); assert.equal(calls, 2);
  landMask = null;
  h.runtime.getMeshes(); await h.flush(); await h.finish();
  assert.equal(h.tasks.length, 3, 'null selects a different source than an empty collection');
});

test('water masks transfer once and subsequent geometry updates retain water rejection in the real worker', async () => {
  for (const supported of [true,false]) {
    const h = loopbackContourWorker(), client=createPaintContourWorkerClient({createWorker:()=>h.worker,isSupported:()=>supported,yieldToHost:()=>Promise.resolve()});
    const features=[rect('A',0),rect('B',1.03)];
    const land={type:'Feature',geometry:{type:'Polygon',coordinates:[[[-1,-1],[4,-1],[4,3],[-1,3],[-1,-1]]]}};
    try {
      const first=await client.build(features,[],{reset:true,waterMask:packContourWaterMask({land})});
      assert.ok(first.diagnostics.nearSeamSegments>0);
      const waterMask=packContourWaterMask({land:features.map(f=>({...f,type:'Feature'}))});
      const rejected=await client.build([],[],{waterMask});assert.equal(rejected.diagnostics.nearSeamSegments,0);
      const next=await client.build(structuredClone(features),[]);assert.equal(next.diagnostics.nearSeamSegments,0);
      if(supported){
        const messages=h.sent.filter(m=>m.packet.type==='WATER');assert.equal(messages.length,2);
        assert.ok(messages.every(m=>m.transferred===6&&m.detached));
      }
    } finally {client.dispose();}
  }
});

test('worker PATCH transfers lossless Float64 batches and only graph-required metadata in source order', async () => {
  const h = loopbackContourWorker();
  const client = createPaintContourWorkerClient({ createWorker: () => h.worker, isSupported: () => true });
  const features = [rect('A', 0), rect('B', 1),
    ...Array.from({ length: 128 }, (_, index) => rect(`island-${index}`, index + 4)),
    { id: 'empty', geometry: { type: 'GeometryCollection', geometries: [] } }];
  features[0].geometry.coordinates[0][1][0] = 1 + 1e-10;
  features[0].coordinatePrecision = 7;
  features[1].coordinatePrecision = 4;
  features[1].geometry = { type: 'GeometryCollection', geometries: [features[1].geometry] };
  features[0].properties = { unused: new Array(100).fill('unrelated') };
  features[0].geometry.properties = { unused: true };
  const before = JSON.stringify(features);
  try {
    const graph = await client.build(features, [], { reset: true });
    const expected = createPaintContourGraphBuilder();
    expected.patch(features);
    const reference = expected.finish();
    assert.deepEqual({ ...graph, diagnostics: stableDiagnostics(graph.diagnostics) },
      { ...reference, diagnostics: stableDiagnostics(reference.diagnostics) });
    assert.equal(JSON.stringify(features), before, 'only newly allocated codec buffers are transferred');
    assert.deepEqual(h.sent.map(({ packet }) => packet.type), ['BEGIN', 'PATCH', 'PATCH', 'FINISH']);
    const patches = h.sent.filter(({ packet }) => packet.type === 'PATCH');
    const decoded = patches.flatMap(({ packet }) => packet.geometryTransport.batches.flatMap(batch =>
      batch?.encoding === 'geo-f64-v1' ? globalThis.__scenarioForgeGeometryTransferCodecShared.unpack(batch) : batch));
    assert.deepEqual(decoded.map(feature => feature.id), features.map(feature => feature.id));
    assert.equal(decoded[0].geometry.coordinates[0][1][0], 1 + 1e-10);
    assert.equal(decoded[1].coordinatePrecision, 4);
    assert.deepEqual(Object.keys(decoded[0]), ['id', 'geometry', 'coordinatePrecision']);
    assert.deepEqual(Object.keys(decoded[0].geometry), ['type', 'coordinates']);
    assert.ok(patches.every(({ packet, transferred, detached }) => packet.features === null && transferred > 0 && detached));
    assert.ok(patches.every(({ packet }) => packet.geometryTransport.batches.filter(batch => batch?.encoding)
      .every(batch => batch.coordinates instanceof Float64Array && batch.lengths instanceof Uint32Array)));
  } finally { client.dispose(); }
});

test('binary worker transport preserves deletion-only, empty, replacement and reset messages', async () => {
  const h = loopbackContourWorker();
  const client = createPaintContourWorkerClient({ createWorker: () => h.worker, isSupported: () => true });
  try {
    assert.equal((await client.build([rect('A', 0), rect('B', 1)], [], { reset: true })).diagnostics.arcCount, 1);
    assert.equal((await client.build([], ['B'])).diagnostics.featureCount, 1);
    const deletion = h.sent.at(-2).packet;
    assert.equal(deletion.type, 'PATCH');
    assert.deepEqual(deletion.features, []);
    assert.deepEqual(deletion.removedIds, ['B']);
    assert.equal((await client.build([], [])).diagnostics.featureCount, 1);
    assert.equal((await client.build([rect('B', 3)], [])).diagnostics.arcCount, 0);
    assert.equal((await client.build([], [], { reset: true })).diagnostics.featureCount, 0);
    const malformed = { id: 'malformed', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], ['bad', 1], [0, 0]]] } };
    const graph = await client.build([malformed], []);
    assert.equal(graph.diagnostics.invalidRings, 1, 'codec raw batches preserve invalid-input diagnostics');
    assert.equal(h.sent.at(-2).transferred, 0);
  } finally { client.dispose(); }
});

test('disposing during packing aborts before PATCH transfer and leaves source coordinates intact', async () => {
  const h = loopbackContourWorker();
  const client = createPaintContourWorkerClient({ createWorker: () => h.worker, isSupported: () => true });
  let disposed = false;
  const point = new Proxy([0, 0], { get(target, key) {
    if (key === '0' && !disposed) { disposed = true; client.dispose(); }
    return Reflect.get(target, key);
  } });
  const feature = { id: 'abort', geometry: { type: 'Polygon', coordinates: [[point, [1, 0], [1, 1], point]] } };
  await assert.rejects(client.build([feature], [], { reset: true }), { name: 'AbortError' });
  assert.deepEqual(h.sent.map(({ packet }) => packet.type), ['BEGIN']);
  assert.equal(h.terminations(), 1);
  assert.equal(point[0], 0);
});

test('dispose cancels a pending transferred PATCH and a new scene rebuild uses a fresh worker', async () => {
  const workers = [];
  const client = createPaintContourWorkerClient({ createWorker: () => {
    const h = loopbackContourWorker({ holdPatch: workers.length === 0 });
    workers.push(h); return h.worker;
  }, isSupported: () => true });
  try {
    const request = client.build([rect('A', 0)], [], { reset: true });
    const rejected = assert.rejects(request, { name: 'AbortError' });
    await new Promise(setImmediate);
    assert.equal(workers[0].sent.at(-1).packet.type, 'PATCH');
    client.dispose();
    await rejected;
    assert.equal(workers[0].terminations(), 1);
    assert.equal(workers[0].sent.at(-1).packet.type, 'CANCEL_TASK');
    const graph = await client.build([rect('C', 4)], [], { reset: true });
    assert.equal(workers.length, 2);
    assert.deepEqual(graph.featureIds, ['C']);
    assert.equal(graph.diagnostics.featureCount, 1);
  } finally { client.dispose(); }
});

test('identical geometry copies wait for real reuse ACK, retain one packed graph and refresh current paint', async () => {
  const h = harness(); h.runtime.getMeshes(); await h.flush(); await h.finish();
  const coordinates = getPackedPaintContourMesh(h.runtime.getMeshes()[0]).coordinates;
  h.state.land = structuredClone(h.state.land);
  h.state.land[0].geometry.unusedMetadata = { changed: true };
  assert.deepEqual(h.runtime.getMeshes(), []);
  await h.flush();
  assert.equal(h.tasks[1].options.reuse, true);
  assert.equal(h.tasks[1].options.certifiedEquivalent, true);
  assert.deepEqual(h.tasks[1].features.map(feature => feature.id), ['A', 'B']);
  assert.equal(h.tasks[1].removed.length, 0);
  assert.equal(h.runtime.hasPendingWork(), true);
  h.colors.B = h.colors.A; h.state.colorRevision++; h.runtime.notifyPaintChanged(['B']);
  await h.finish();
  assert.equal(h.runtime.diagnostics().status, 'ready');
  assert.equal(h.runtime.diagnostics().builds, 1);
  assert.equal(h.runtime.diagnostics().reuseAcks, 1);
  assert.equal(h.runtime.diagnostics().equalFeatures, 2);
  assert.deepEqual(h.runtime.getMeshes(), []);
  // Undo and a different painted target update the restored complete graph.
  h.colors.B = '#00ff00'; h.state.colorRevision++; h.runtime.notifyPaintChanged(['B']);
  assert.equal(getPackedPaintContourMesh(h.runtime.getMeshes()[0]).coordinates, coordinates);
  h.colors.A = h.colors.B; h.state.colorRevision++; h.runtime.notifyPaintChanged(['A']);
  assert.deepEqual(h.runtime.getMeshes(), []);
  h.colors.A = '#123456'; h.state.colorRevision++; h.runtime.notifyPaintChanged(['A']);
  assert.equal(h.runtime.getMeshes().length, 1);
  assert.equal(h.tasks.length, 2);
});

test('exact comparison preserves coordinate values, ring order, geometry type and source precision', async () => {
  const { registerContourSourcePrecision } = await import('../js/core/paint_contour_source.js');
  const cases = [
    feature => { feature.geometry.coordinates[0][1][0] += 1e-10; },
    feature => { feature.geometry.coordinates[0][0][0] = -0; },
    feature => { feature.geometry.coordinates[0].reverse(); },
    feature => { feature.geometry = { type: 'GeometryCollection', geometries: [feature.geometry] }; },
    feature => { registerContourSourcePrecision({ features: [feature] }, { lod: 'coarse', coordinatePrecision: 4 }); },
  ];
  for (const change of cases) {
    const h = harness(); h.runtime.getMeshes(); await h.flush(); await h.finish();
    const next = structuredClone(h.a); change(next);
    h.state.land = [next, h.b]; h.runtime.getMeshes(); await h.flush();
    assert.equal(h.tasks[1].options.reuse, false);
    assert.deepEqual(h.tasks[1].features.map(feature => feature.id), ['A']);
    await h.finish();
    assert.equal(h.runtime.diagnostics().builds, 2);
  }
});

test('nested GeometryCollection copies compare every child and its order', async () => {
  const h = harness();
  h.a.geometry = { type: 'GeometryCollection', geometries: [h.a.geometry, rect('island', 8).geometry] };
  h.runtime.getMeshes(); await h.flush(); await h.finish();
  h.state.land = structuredClone(h.state.land); h.runtime.getMeshes(); await h.flush();
  assert.equal(h.tasks[1].options.reuse, true); await h.finish();
  h.state.land = structuredClone(h.state.land); h.state.land[0].geometry.geometries.reverse();
  h.runtime.getMeshes(); await h.flush();
  assert.equal(h.tasks[2].options.reuse, false);
  assert.deepEqual(h.tasks[2].features.map(feature => feature.id), ['A', 'B']); await h.finish();
});

test('reordered equivalent records retain the original real PATCH order before CONFIRM', async () => {
  const h = harness(); h.runtime.getMeshes(); await h.flush(); await h.finish();
  h.state.land = structuredClone(h.state.land).reverse(); h.runtime.getMeshes(); await h.flush();
  assert.equal(h.tasks[1].options.reuse, true);
  assert.equal(h.tasks[1].options.certifiedEquivalent, true);
  assert.deepEqual(h.tasks[1].features.map(feature => feature.id), ['B', 'A']);
  await h.finish();
  assert.equal(h.runtime.diagnostics().builds, 1);
});

test('private comparison yields, cancels before worker mutation and queues only the latest source', async () => {
  let clock = 0, release;
  const h = harness({ nowMs: () => clock += 4,
    yieldControl: () => new Promise(resolve => { release = resolve; }) });
  h.a.geometry.coordinates[0] = [...Array.from({ length: 1024 }, (_, index) => [index / 1024, 0]),
    [1,0], [1,1], [0,1], [0,0]];
  h.runtime.getMeshes(); await h.flush(); await h.finish();
  h.state.land = structuredClone(h.state.land); h.runtime.getMeshes(); await h.flush();
  assert.equal(typeof release, 'function');
  assert.equal(h.tasks.length, 1, 'comparison has not sent PATCH or CONFIRM');
  assert.deepEqual(h.runtime.getMeshes(), []);
  h.state.land = [h.a, rect('B', 3)]; h.runtime.getMeshes();
  release(); await h.flush(); await h.flush();
  assert.equal(h.tasks.length, 2);
  assert.deepEqual(h.tasks[1].features.map(feature => feature.id), ['B']);
  assert.equal(h.tasks[1].options.reset, false);
  await h.finish();
  assert.equal(h.runtime.diagnostics().status, 'ready');
  assert.ok(h.runtime.diagnostics().comparisonYields > 0);
  assert.equal(h.runtime.diagnostics().reuseAcks, 0);
});

test('a late FINISH becomes the sole ACK graph before a newer equivalent source is confirmed', async () => {
  const h = harness(); h.runtime.getMeshes(); await h.flush(); await h.finish();
  h.state.land = [h.a, rect('B', 3)]; h.runtime.getMeshes(); await h.flush();
  h.state.land = structuredClone(h.state.land); h.runtime.getMeshes();
  await h.finish();
  assert.equal(h.changes.length, 1, 'obsolete FINISH cannot publish');
  await h.flush();
  assert.equal(h.tasks[2].options.reuse, true);
  await h.finish();
  assert.equal(h.runtime.diagnostics().activeArcCount, 0, 'must not restore the older adjacent A/B graph');
  assert.equal(h.runtime.diagnostics().builds, 2);
  assert.equal(h.runtime.diagnostics().reuseAcks, 1);
});

test('late reuse ACK cannot publish an obsolete source and the next delta uses true registration', async () => {
  const h = harness(); h.runtime.getMeshes(); await h.flush(); await h.finish();
  h.state.land = structuredClone(h.state.land); h.runtime.getMeshes(); await h.flush();
  h.state.land = [h.a, rect('B', 3)]; h.runtime.getMeshes();
  await h.finish(); assert.equal(h.changes.length, 1);
  await h.flush();
  assert.equal(h.tasks[2].options.reset, false);
  assert.deepEqual(h.tasks[2].features.map(feature => feature.id), ['A', 'B']);
  await h.finish(); assert.equal(h.runtime.diagnostics().activeArcCount, 0);
});

test('failed reuse discards the ACK graph, suppresses frame retries and a new publication resets', async () => {
  const h = harness(); h.runtime.getMeshes(); await h.flush(); await h.finish();
  h.state.land = structuredClone(h.state.land); h.runtime.getMeshes(); await h.flush();
  h.tasks[1].reject(new Error('reuse failed')); await Promise.resolve(); await Promise.resolve();
  for (let index = 0; index < 3; index++) assert.deepEqual(h.runtime.getMeshes(), []);
  await h.flush(); assert.equal(h.tasks.length, 2);
  assert.equal(h.runtime.diagnostics().status, 'error');
  h.state.land = structuredClone(h.state.land); h.runtime.getMeshes(); await h.flush();
  assert.equal(h.tasks[2].options.reset, true);
  assert.equal(h.tasks[2].options.reuse, false);
  await h.finish(); assert.equal(h.runtime.diagnostics().activeArcCount, 1);
});

test('worker and unsupported fallback confirm only a successful unchanged graph and transfer no old buffers', async () => {
  for (const supported of [true, false]) {
    const h = loopbackContourWorker(), workers = [];
    const client = createPaintContourWorkerClient({ createWorker: () => {
      const next = workers.length ? loopbackContourWorker() : h;
      workers.push(next); return next.worker;
    },
      isSupported: () => supported, yieldToHost: () => Promise.resolve() });
    try {
      await assert.rejects(client.build([], [], { reuse: true }), /registered|completed/);
      const graph = await client.build([rect('A',0), rect('B',1)], [], { reset: true });
      const bytes = graph.coordinates.byteLength;
      assert.deepEqual(await client.build([], [], { reuse: true }), { unchanged: true });
      assert.equal(graph.coordinates.byteLength, bytes);
      if (supported) {
        assert.equal(h.sent.at(-1).packet.type, 'CONFIRM');
        assert.equal(h.sent.at(-1).transferred, 0);
        assert.equal(h.replies.at(-1).transferred, 0);
        assert.deepEqual(Object.keys(h.replies.at(-1).packet.result), ['unchanged']);
      }
      await assert.rejects(client.build([rect('A',0)], [], { reuse: true }), /cannot mutate/);
      await assert.rejects(client.build([], [], { reuse: true, reset: true }), /cannot mutate/);
      await assert.rejects(client.build([rect('A',0)], ['B'], { reuse: true, certifiedEquivalent: true }), /cannot mutate/);
      await assert.rejects(client.build([rect('A',0)], [], { certifiedEquivalent: true }), /Invalid certified/);
      client.dispose();
      if (supported) assert.equal(h.terminations(), 1, 'dispose terminates the completed worker');
      await assert.rejects(client.build([], [], { reuse: true }), /registered|completed/);
      if (supported) {
        assert.equal(workers.length, 2, 'a new request receives a fresh unregistered worker');
        assert.notEqual(workers[0].worker, workers[1].worker);
      }
    } finally { client.dispose(); }
  }
});

test('worker CONFIRM rejects dirty PATCH, reset and a failed FINISH until a new full FINISH succeeds', async () => {
  let fail = false;
  const h = loopbackContourWorker({ builderFactory: () => {
    const builder = createPaintContourGraphBuilder();
    return { ...builder, finish() { if (fail) throw new Error('finish failed'); return builder.finish(); } };
  } });
  const client = createPaintContourWorkerClient({ createWorker: () => h.worker, isSupported: () => true });
  try {
    await client.build([rect('A',0), rect('B',1)], [], { reset: true });
    h.receive({ type: 'PATCH', taskId: 'private-patch', features: [rect('B',3)], removedIds: [] });
    await assert.rejects(client.build([], [], { reuse: true }), /completed unchanged/);
    await assert.rejects(client.build([rect('A',0)], [], { reuse: true, certifiedEquivalent: true }), /completed unchanged/);
    await client.build([], []);
    assert.deepEqual(await client.build([], [], { reuse: true }), { unchanged: true });
    fail = true;
    await assert.rejects(client.build([], []), /finish failed/);
    await assert.rejects(client.build([], [], { reuse: true }), /completed unchanged/);
    fail = false; await client.build([], []);
    assert.deepEqual(await client.build([], [], { reuse: true }), { unchanged: true });
    h.receive({ type: 'BEGIN', taskId: 'private-reset' });
    await assert.rejects(client.build([], [], { reuse: true }), /completed unchanged/);
  } finally { client.dispose(); }
});

test('certified replacements still PATCH in original order and preserve the next true FINISH history', async () => {
  for (const supported of [true, false]) {
    const h = loopbackContourWorker();
    const client = createPaintContourWorkerClient({ createWorker: () => h.worker,
      isSupported: () => supported, yieldToHost: () => Promise.resolve() });
    const features = [rect('A',0), rect('B',1), rect('C',2)];
    const reference = createPaintContourGraphBuilder();
    try {
      reference.patch(features); reference.finish();
      const original = await client.build(features, [], { reset: true });
      const replacements = structuredClone(features).reverse();
      reference.patch(replacements); reference.finish();
      const reply = await client.build(replacements, [], { reuse: true, certifiedEquivalent: true });
      assert.deepEqual(reply, { unchanged: true });
      assert.ok(original.coordinates.byteLength > 0, 'CONFIRM never retransfers the retained graph');
      if (supported) {
        const patch = h.sent.at(-2).packet;
        assert.equal(patch.type, 'PATCH'); assert.equal(patch.certifiedEquivalent, true);
        const decoded = patch.geometryTransport.batches.flatMap(batch =>
          batch?.encoding === 'geo-f64-v1' ? globalThis.__scenarioForgeGeometryTransferCodecShared.unpack(batch) : batch);
        assert.deepEqual(decoded.map(feature => feature.id), ['C', 'B', 'A']);
        assert.equal(h.sent.at(-1).packet.type, 'CONFIRM');
        assert.equal(h.replies.at(-1).transferred, 0);
      }
      const update = rect('B',4); reference.patch([update]);
      const expected = reference.finish(), actual = await client.build([update], []);
      assert.deepEqual(actual.featureIds, expected.featureIds);
      assert.deepEqual(stableDiagnostics(actual.diagnostics), stableDiagnostics(expected.diagnostics));
      for (const key of ['coordinates', 'offsets', 'owners']) {
        const bytes = graph => Buffer.from(graph[key].buffer, graph[key].byteOffset, graph[key].byteLength);
        assert.ok(bytes(actual).equals(bytes(expected)), `${key}: actual PATCH history must equal the original full-FINISH sequence`);
      }
    } finally { client.dispose(); }
  }
});


test('only water geometry references and Atlantropa visibility invalidate the water mask', async () => {
  const h = harness();
  h.runtime.getMeshes(); await h.flush(); await h.finish();
  h.state.contextLayerRevision = 1;
  h.state.activeScenarioManifest = {};
  h.state.scenarioLandMaskVersionTag = 'changed';
  h.state.scenarioContextLandMaskVersionTag = 'changed';
  h.state.contextLayerExternalDataByName = { unrelated: {} };
  h.runtime.getMeshes(); await h.flush();
  assert.equal(h.tasks.length, 1);
  for (const field of ['scenarioLandMaskData', 'scenarioContextLandMaskData', 'landBgData',
    'scenarioWaterRegionsData', 'waterRegionsData', 'scenarioAtlantropaData']) {
    const count = h.tasks.length;
    h.state[field] = {};
    h.runtime.getMeshes(); await h.flush();
    assert.equal(h.tasks.length, count + 1, field);
    assert.equal(h.tasks.at(-1).options.reuse, false);
    assert.notEqual(h.tasks.at(-1).options.waterMask, undefined);
    await h.finish();
  }
  const count = h.tasks.length;
  h.state.contextLayerExternalDataByName.lakes = {};
  h.runtime.getMeshes(); await h.flush(); await h.finish();
  assert.equal(h.tasks.length, count + 1);
  h.state.contextLayerExternalDataByName = { ...h.state.contextLayerExternalDataByName, unrelated: {} };
  h.runtime.getMeshes(); await h.flush();
  assert.equal(h.tasks.length, count + 1);
  h.state.showScenarioAtlantropa = false;
  h.runtime.getMeshes(); await h.flush(); await h.finish();
  assert.equal(h.tasks.length, count + 2);
});


test('coast follows the retained classification across rebuilds and resets with the scene', async () => {
  const h = harness({ resolveClassification: (_feature, id) => ({ borderKey: id }),
    getWaterMaskSources: () => ({ land: [rect('A', 0).geometry, rect('B', 1).geometry] }) });
  assert.equal(h.runtime.getCoastMesh(), null);
  await h.flush(); await h.finish();
  const classification = h.runtime.getClassification(), coast = h.runtime.getCoastMesh();
  assert.ok(coast.coordinates.length);
  h.state.land = [h.a, rect('B', 2)];
  assert.equal(h.runtime.getClassification(), classification);
  assert.equal(h.runtime.getCoastMesh(), coast);
  await h.flush(); await h.finish();
  assert.notEqual(h.runtime.getCoastMesh(), coast);
  h.state.sceneGeneration = 1;
  assert.equal(h.runtime.getClassification(), null);
  assert.equal(h.runtime.getCoastMesh(), null);
});
