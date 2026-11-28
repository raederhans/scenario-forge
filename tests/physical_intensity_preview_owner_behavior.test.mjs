import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhysicalIntensityPreviewOwner } from '../js/core/renderer/physical_intensity_preview_owner.js';

function harness(t) {
  const prior = globalThis.d3;
  globalThis.d3 = { zoomIdentity: { x: 0, y: 0, k: 1 }, pointer: event => event.coords };
  t.after(() => { if (prior === undefined) delete globalThis.d3; else globalThis.d3 = prior; });
  const state = { zoomTransform: { x: 10, y: 20, k: 2 } };
  let projection = coords => coords;
  projection.invert = coords => coords;
  const owner = createPhysicalIntensityPreviewOwner(state, {
    rendererSurfaceHost: { getProjection: () => projection, getInteractionRect: () => ({ node: () => ({}) }) },
    getProjectedDegreeRadiusPx: () => 40,
    clamp: (v,lo,hi) => Math.max(lo,Math.min(hi,v)),
  });
  return { owner, state, setProjection(next) { projection = next; } };
}

test('pointer inversion and public projection read replaced transform and projection', t => {
  const h=harness(t);
  assert.deepEqual(h.owner.getMapLonLatFromEvent({coords:[30,220]}),[10,90]);
  const next = ([x,y]) => [x*3,y*4]; next.invert=([x,y])=>[x/3,y/4];
  h.setProjection(next); h.state.zoomTransform={x:0,y:0,k:1};
  assert.deepEqual(h.owner.getMapLonLatFromEvent({coords:[15,24]}),[5,6]);
  assert.equal(h.owner.getMapLonLatFromEvent({coords:[NaN,0]}),null);
});

test('point picking distinguishes center and radius and returns original point identity', t => {
  const h=harness(t); h.state.zoomTransform={x:0,y:0,k:1};
  const point={id:'p',lon:0,lat:0,radiusDeg:4}; const channel={points:[point]};
  assert.deepEqual(h.owner.getPhysicalIntensityPointHit(channel,[2,0]),{point,mode:'move',distance:2});
  assert.deepEqual(h.owner.getPhysicalIntensityPointHit(channel,[42,0]),{point,mode:'radius',distance:2});
  assert.equal(h.owner.getPhysicalIntensityPointHit(channel,[80,0]),null);
  h.setProjection(null); assert.equal(h.owner.getPhysicalIntensityPointHit(channel,[0,0]),null);
});
