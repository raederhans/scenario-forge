import test from 'node:test';
import assert from 'node:assert/strict';
import { createPaintContourRuntime } from '../js/core/renderer/paint_contour_runtime.js';
import { createPaintContourGraphBuilder } from '../js/core/renderer/paint_contour_graph.js';

const rect=(id,x)=>({id,geometry:{type:'Polygon',coordinates:[[[x,0],[x+1,0],[x+1,1],[x,1],[x,0]]]}});
function harness(runtimeOptions = {}) {
  const a=rect('A',0),b=rect('B',1);
  const state={colorRevision:0,sovereigntyRevision:0,viewMode:'owner',separatePoliticalBorders:false,activeScenarioId:'test',land:[a,b]};
  const colors={A:'#ff0000',B:'#00ff00'};
  const owners={A:'A',B:'B'};
  const tasks = [], scheduled = [];
  let builder;
  const client = {
    dispose() { builder = null; },
    build(features, removed, options) {
      if (options.reset) builder = createPaintContourGraphBuilder({ nearSeamTolerance: options.nearSeamTolerance });
      if (options.waterMask !== undefined) builder.setWaterMask(options.waterMask);
      builder.patch(features, removed);
      const graph = builder.finish();
      return new Promise(resolve => tasks.push({ resolve: () => resolve(graph) }));
    },
  };
  const runtime=createPaintContourRuntime({state,getFeatures:()=>state.land,getFeatureId:f=>f.id,
    isEligible:f=>!f.hidden,resolveColor:f=>colors[f.id],
    resolveBoundaryKey:f=>owners[f.id],
    getBoundaryRevision:()=>`${state.sovereigntyRevision}|${state.viewMode}`,
    separatePoliticalBorders:()=>state.separatePoliticalBorders,
    client,schedule:fn=>scheduled.push(fn),...runtimeOptions});
  const flush=async()=>{while(scheduled.length)scheduled.shift()();await Promise.resolve();};
  const finish=async()=>{tasks.at(-1).resolve();await Promise.resolve();await Promise.resolve();};
  return {a,state,colors,owners,runtime,tasks,flush,finish};
}

test('only different paint colors produce a boundary mesh',async()=>{
  const h=harness();assert.deepEqual(h.runtime.getMeshes(),[]);await h.flush();await h.finish();
  h.colors.B=h.colors.A;h.state.colorRevision++;assert.equal(h.runtime.notifyPaintChanged(['B']),true);
  assert.deepEqual(h.runtime.getMeshes(),[]);
  h.colors.B='#00ff00';h.state.colorRevision++;h.runtime.notifyPaintChanged(['B']);
  assert.equal(h.runtime.getMeshes().length,1);
  h.colors.A=h.colors.B;h.state.colorRevision+=2;h.runtime.getRevision();assert.deepEqual(h.runtime.getMeshes(),[]);
});

test('geometry replacement clears stale contours',async()=>{
  const h=harness();h.runtime.getMeshes();await h.flush();await h.finish();
  h.state.land=[h.a,rect('B',3)];h.state.topologyRevision=1;
  assert.deepEqual(h.runtime.getMeshes(),[]);await h.flush();
  await h.finish();assert.deepEqual(h.runtime.getMeshes(),[]);
});

test('switching scenes rejects a late result and releases the previous graph',async()=>{
  const h=harness();h.runtime.getMeshes();await h.flush();const old=h.tasks[0];
  h.state.activeScenarioId='next';h.state.land=[rect('C',4)];h.colors.C='#123456';
  h.runtime.getMeshes();await h.flush();old.resolve();await Promise.resolve();
  assert.equal(h.runtime.diagnostics().status,'building');assert.deepEqual(h.runtime.getMeshes(),[]);
  await h.finish();assert.equal(h.runtime.diagnostics().featureCount,1);assert.equal(h.runtime.diagnostics().activeArcCount,0);
});

test('coverage-only shell fills close inland gaps without becoming coast or borders', async () => {
  const shell = { ...rect('SHELL', 1), shell: true };
  const land = () => [rect('A', 0).geometry, shell.geometry, rect('B', 2).geometry];
  // Vertical steps at x=1 or x=2 lie between parcels and the shell, never on the outer coast.
  const inlandCoast = coast => coast.coordinates.flatMap(line => line.slice(1)
    .filter((point, index) => point[0] === line[index][0] && (point[0] === 1 || point[0] === 2)));
  const setup = options => {
    const h = harness({ resolveClassification: (_feature, id) => ({ borderKey: id, parentKey: '', provinceKey: '' }),
      getWaterMaskSources: () => ({ land: land() }), ...options });
    h.state.land = [h.a, shell, rect('B', 2)];
    h.colors.SHELL = '#0000ff'; h.owners.SHELL = 'SHELL';
    return h;
  };

  const excluded = setup({ isEligible: f => !f.shell });
  excluded.runtime.getClassification(); await excluded.flush(); await excluded.finish();
  assert.ok(inlandCoast(excluded.runtime.getCoastMesh()).length > 0, 'gap edges become coast without the shell');

  const h = setup({ isCoverageOnly: f => !!f.shell });
  h.runtime.getClassification(); await h.flush(); await h.finish();
  assert.deepEqual(inlandCoast(h.runtime.getCoastMesh()), []);
  assert.ok(h.runtime.getCoastMesh().coordinates.length, 'the outer coast is still drawn');
  const classification = h.runtime.getClassification();
  assert.deepEqual([classification.country.length, classification.paint.length,
    classification.parent.size, classification.province.size, classification.local.size], [0, 0, 0, 0, 0]);

  h.state.activeScenarioId = '';
  h.runtime.getMeshes(); await h.flush(); await h.finish();
  assert.deepEqual(h.runtime.getMeshes(), [], 'shell paint never draws a contour against its neighbours');
});
