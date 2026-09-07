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
  let tool = { active: true, subMode: 'brush', brushRadiusDeg: 3 };
  let radius = 40;
  const marks = [];
  const makeGroup = () => {
    const group = { styles: {}, rows: [], attrs: {}, style(key,value) { this.styles[key]=value; return this; }, selectAll() { return this; }, data(rows) { this.rows=rows; return this; }, join() { marks.push(this); return this; }, attr(key,value) { this.attrs[key]=typeof value==='function'?value(this.rows[0]):value; return this; } };
    return group;
  };
  let group = makeGroup();
  const owner = createPhysicalIntensityPreviewOwner({
    runtimeState: state,
    rendererSurfaceHost: { getProjection: () => projection, getInteractionRect: () => ({ node: () => ({}) }), getIntensityFieldPreviewGroup: () => group },
    getIntensityFieldTool: () => tool,
    getProjectedDegreeRadiusPx: () => radius,
    clamp: (v,lo,hi) => Math.max(lo,Math.min(hi,v)),
  });
  return { owner,state,marks,get group(){return group;},setProjection(next){projection=next;},setTool(next){tool=next;},setRadius(next){radius=next;},replaceGroup(){group=makeGroup();} };
}

test('pointer inversion and public projection read replaced transform and projection', t => {
  const h=harness(t);
  assert.deepEqual(h.owner.getMapLonLatFromEvent({coords:[30,220]}),[10,90]);
  assert.deepEqual(h.owner.projectGeoToScreen(5,6),[20,32]);
  const next = ([x,y]) => [x*3,y*4]; next.invert=([x,y])=>[x/3,y/4];
  h.setProjection(next); h.state.zoomTransform={x:0,y:0,k:1};
  assert.deepEqual(h.owner.projectGeoToScreen(5,6),[15,24]);
  assert.deepEqual(h.owner.getMapLonLatFromEvent({coords:[15,24]}),[5,6]);
  assert.equal(h.owner.getMapLonLatFromEvent({coords:[NaN,0]}),null);
  h.setProjection(null); assert.equal(h.owner.projectGeoToScreen(1,2),null);
});

test('preview redraw retains location while using current surface, tool and radius', t => {
  const h=harness(t);
  assert.equal(h.owner.renderPhysicalIntensityBrushPreview([5,6]),true);
  assert.equal(h.group.attrs.cx,20); assert.equal(h.group.attrs.r,40);
  h.replaceGroup(); h.setTool({active:true,subMode:'erase',brushRadiusDeg:4}); h.setRadius(55);
  assert.equal(h.owner.renderPhysicalIntensityBrushPreview(),true);
  assert.equal(h.group.attrs.r,55); assert.match(h.group.attrs.stroke,/251, 191, 36/);
  h.owner.hidePhysicalIntensityBrushPreview();
  assert.equal(h.group.styles.display,'none');
  assert.equal(h.owner.renderPhysicalIntensityBrushPreview(),false);
});

test('inactive or invalid preview resets remembered location', t => {
  const h=harness(t);
  assert.equal(h.owner.updatePhysicalIntensityBrushPreviewFromEvent({coords:[20,32]}),true);
  h.setRadius(0); assert.equal(h.owner.renderPhysicalIntensityBrushPreview(),false);
  h.setRadius(30); assert.equal(h.owner.renderPhysicalIntensityBrushPreview(),false);
  h.setTool({active:false}); assert.equal(h.owner.updatePhysicalIntensityBrushPreviewFromEvent({coords:[20,32]}),false);
});

test('point picking distinguishes center and radius and returns original point identity', t => {
  const h=harness(t); h.state.zoomTransform={x:0,y:0,k:1};
  const point={id:'p',lon:0,lat:0,radiusDeg:4}; const channel={points:[point]};
  assert.deepEqual(h.owner.getPhysicalIntensityPointHit(channel,[2,0]),{point,mode:'move',distance:2});
  assert.deepEqual(h.owner.getPhysicalIntensityPointHit(channel,[42,0]),{point,mode:'radius',distance:2});
  assert.equal(h.owner.getPhysicalIntensityPointHit(channel,[80,0]),null);
  h.setProjection(null); assert.equal(h.owner.getPhysicalIntensityPointHit(channel,[0,0]),null);
});
