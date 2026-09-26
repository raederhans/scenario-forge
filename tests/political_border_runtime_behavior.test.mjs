import test from 'node:test';
import assert from 'node:assert/strict';
import { createPoliticalBorderRuntime } from '../js/core/renderer/political_border_runtime.js';

const mesh = {type:'MultiLineString', coordinates:[[[9.5599,47.541],[9.5959,47.4837]]]};
function harness() {
  const state = {activeScenarioId:'tno',mapSemanticMode:'political',
    activeScenarioManifest:{mesh_pack_url:'mesh_pack.json'},
    scenarioBaselineOwnersByFeatureId:Object.freeze({a:'GER',b:'SWI'}),
    styleConfig:{empireBorders:{political:'auto'}},
    runtimePoliticalTopology:{objects:{political:{geometries:[{id:'shell'}]}}}};
  let calls=0;
  const owner=createPoliticalBorderRuntime({state,resolveOwnerCode:e=>e.id,
    buildMesh:()=>{calls++;return mesh;}});
  return {state,owner,calls:()=>calls,pack:{scenario_id:'tno',meshes:{opening_owner_borders:mesh}}};
}

test('chunked scenarios wait for their matching full-source mesh, never shell topology', () => {
  const h=harness();
  assert.deepEqual(h.owner.getMeshes(),[]);
  assert.equal(h.owner.diagnostics().status,'pending');
  assert.equal(h.calls(),0);
  const revision=h.owner.getRevision();
  h.state.activeScenarioMeshPack=h.pack;
  assert.equal(h.owner.getMeshes()[0],mesh);
  assert.ok(h.owner.getRevision()>revision);
  assert.equal(h.owner.diagnostics().source,'scenario-mesh-pack');
  assert.equal(h.calls(),0);
});

test('paint, zoom and coarse/detail promotions do not change or rebuild political geometry', () => {
  const h=harness();h.state.activeScenarioMeshPack=h.pack;
  const first=h.owner.getMeshes(),revision=h.owner.getRevision();
  h.state.landData={features:[{id:'coarse'}]};h.state.topologyRevision=12;
  h.state.colorRevision=8;h.state.scenarioDataGeneration=14;h.state.zoomTransform={k:3};
  h.state.scenarioShellOverlayRevision=7;
  assert.equal(h.owner.getMeshes(),first);
  assert.equal(h.owner.getRevision(),revision);
  h.state.styleConfig.empireBorders.political='off';
  assert.deepEqual(h.owner.getMeshes(),[]);
  h.state.styleConfig.empireBorders.political='on';
  assert.equal(h.owner.getMeshes()[0],mesh);
  assert.equal(h.calls(),0);
});

test('scene switches, blank drawing and foreign packs never reuse another scene border', () => {
  const h=harness();h.state.activeScenarioMeshPack=h.pack;
  h.owner.getMeshes();h.state.activeScenarioId='other';
  assert.deepEqual(h.owner.getMeshes(),[]);
  assert.equal(h.owner.diagnostics().status,'error');
  h.state.activeScenarioMeshPack=null;
  assert.equal(h.owner.diagnostics().status,'pending');
  h.state.mapSemanticMode='blank';
  assert.equal(h.owner.diagnostics().status,'disabled');
  assert.deepEqual(h.owner.getMeshes(),[]);
});

test('an empty complete political mesh is valid and never falls back to reference borders', () => {
  const h=harness();
  h.state.activeScenarioMeshPack={...h.pack,meshes:{opening_owner_borders:{type:'MultiLineString',coordinates:[]}}};
  assert.deepEqual(h.owner.getMeshes(),[]);
  assert.equal(h.owner.diagnostics().status,'ready');
  assert.equal(h.calls(),0);
});

test('full topology scenes retain source and reference identity but exclude auxiliary features', () => {
  const state={activeScenarioId:'full',scenarioBaselineOwnersByFeatureId:{a:'A',b:'B'},
    runtimePoliticalTopology:{objects:{political:{}}}};
  const calls=[];
  const runtime=createPoliticalBorderRuntime({state,resolveOwnerCode:e=>state.scenarioBaselineOwnersByFeatureId[e.id],
    isEligible:e=>!e.shell,
    buildMesh:options=>{calls.push(options);return mesh;}});
  runtime.getMeshes();runtime.getMeshes();assert.equal(calls.length,1);
  assert.equal(calls[0].shouldExcludeOwnerBorderEntity({shell:true}),true);
  assert.equal(calls[0].resolveOwnerBorderCode({id:'a'}),'A');
  state.runtimePoliticalTopology={objects:{political:{}}};runtime.getMeshes();
  assert.equal(calls.length,2);
  state.scenarioBaselineOwnersByFeatureId={a:'B',b:'B'};runtime.getMeshes();
  assert.equal(calls.length,3);
});
