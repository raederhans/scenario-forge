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

test('switching scenes discards the previous border mesh', () => {
  const h=harness();h.state.activeScenarioMeshPack=h.pack;
  h.owner.getMeshes();h.state.activeScenarioId='other';
  assert.deepEqual(h.owner.getMeshes(),[]);
});

test('an empty complete political mesh is valid and never falls back to reference borders', () => {
  const h=harness();
  h.state.activeScenarioMeshPack={...h.pack,meshes:{opening_owner_borders:{type:'MultiLineString',coordinates:[]}}};
  assert.deepEqual(h.owner.getMeshes(),[]);
  assert.equal(h.owner.diagnostics().status,'ready');
  assert.equal(h.calls(),0);
});
