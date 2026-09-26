import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPaintContourGraph, createPaintContourGraphBuilder } from '../js/core/renderer/paint_contour_graph.js';
import { createPaintContourMesh } from '../js/core/renderer/paint_contour_mesh.js';

const polygon = (id, rings) => ({ id, geometry: { type: 'Polygon', coordinates: rings } });
const rect = (id, x0, y0, x1, y1) => polygon(id, [[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]]]);
function segments(graph) {
  const result = [];
  for (let i=0; i<graph.offsets.length-1; i++) {
    const pair = [graph.featureIds[graph.owners[i*2]],graph.featureIds[graph.owners[i*2+1]]].sort().join(':');
    for (let j=graph.offsets[i]; j<graph.offsets[i+1]-1; j++) {
      const ends = [[graph.coordinates[j*2],graph.coordinates[j*2+1]],[graph.coordinates[j*2+2],graph.coordinates[j*2+3]]];
      result.push(`${pair}|${ends.map(JSON.stringify).sort().join('|')}`);
    }
  }
  return result.sort();
}

test('only shared boundaries between unequal persistent colors are active', () => {
  const graph=buildPaintContourGraph([rect('A',0,0,1,1),rect('B',1,0,2,1),rect('C',8,8,9,9)]);
  assert.equal(graph.diagnostics.arcCount,1);
  const colors={A:'#ff0000',B:'#FF0000',C:'#00ff00'};
  const view=createPaintContourMesh(graph,id=>colors[id]);
  assert.equal(view.getActiveArcCount(),0);
  colors.B='#000000'; assert.equal(view.refresh(['B']),true);
  assert.deepEqual(view.getMesh().coordinates,[[[1,0],[1,1]]]);
  const before=view.getMesh(); colors.B='#000001';
  assert.equal(view.refresh(['B']),false); assert.equal(view.getMesh(),before);
  colors.A='#000001'; view.refresh(['A']); assert.equal(view.getActiveArcCount(),0);
  colors.A='#ff0000'; view.refresh(['A']); assert.equal(view.getActiveArcCount(),1);
});

test('cross-source arcs with unequal collinear segmentation are noded once', () => {
  const a=rect('A',0,0,1,2);
  const b=polygon('B',[[[1,0],[2,0],[2,2],[1,2],[1,1],[1,0]]]);
  const builder=createPaintContourGraphBuilder();
  builder.patch([a]); builder.patch([b]);
  const graph=builder.finish();
  assert.equal(graph.diagnostics.nodedSharedSegments,2);
  assert.equal(graph.diagnostics.arcCount,1);
  assert.deepEqual(segments(graph),['A:B|[1,0]|[1,1]','A:B|[1,1]|[1,2]']);
});

test('points merely near another edge are never snapped together beyond declared precision', () => {
  const graph=buildPaintContourGraph([rect('A',0,0,1,1),rect('B',1.00001,0,2,1)]);
  assert.equal(graph.diagnostics.arcCount,0);
});

test('floating coordinate representations join but original coordinates are retained', () => {
  const a=rect('A',0,0,1+1e-10,1),b=rect('B',1,0,2,1);
  const before=JSON.stringify([a,b]); const graph=buildPaintContourGraph([a,b]);
  assert.equal(graph.diagnostics.arcCount,1);
  assert.equal(graph.coordinates[0],1+1e-10);
  assert.equal(JSON.stringify([a,b]),before);
});

test('holes and enclaves match regardless of polygon ring winding', () => {
  const outer=rect('A',0,0,3,3); const hole=rect('B',1,1,2,2);
  outer.geometry.coordinates.push([...hole.geometry.coordinates[0]].reverse());
  const graph=buildPaintContourGraph([outer,hole]);
  assert.equal(graph.diagnostics.arcCount,1); assert.equal(graph.diagnostics.exactSharedSegments,4);
  outer.geometry.coordinates.forEach(ring=>ring.reverse()); hole.geometry.coordinates[0].reverse();
  assert.deepEqual(segments(buildPaintContourGraph([outer,hole])),segments(graph));
});

test('date-line aliases produce one shared arc without drawing a world-spanning chord', () => {
  const graph=buildPaintContourGraph([rect('west',179,0,180,1),rect('east',-180,0,-179,1)]);
  assert.equal(graph.diagnostics.arcCount,1);
  assert.equal(Math.abs(graph.coordinates[0]),180);
  assert.equal(graph.coordinates[0],graph.coordinates[2]);
});

test('touching corners and repeated overlapping polygons do not invent interior borders', () => {
  assert.equal(buildPaintContourGraph([rect('A',0,0,1,1),rect('B',1,1,2,2)]).diagnostics.arcCount,0);
  const graph=buildPaintContourGraph([rect('A',0,0,1,1),rect('B',0,0,1,1)]);
  assert.equal(graph.diagnostics.arcCount,0); assert.equal(graph.diagnostics.ambiguousSegments,4);
});

test('supplementary MultiPolygon island geometry contributes its shared border', () => {
  const island={id:'island',geometry:{type:'MultiPolygon',coordinates:[rect('',8,0,9,1).geometry.coordinates,rect('',20,0,21,1).geometry.coordinates]}};
  const graph=buildPaintContourGraph([rect('main',0,0,1,1),rect('neighbor',9,0,10,1),island]);
  assert.equal(graph.diagnostics.featureCount,3);
  assert.deepEqual(segments(graph),['island:neighbor|[9,0]|[9,1]']);
});

test('patch replacement/removal equals rebuilding the current composed source', () => {
  const a=rect('A',0,0,1,1),b=rect('B',1,0,2,1),c=rect('C',2,0,3,1);
  const builder=createPaintContourGraphBuilder(); builder.patch([a,b,c]);
  const replacement=rect('B',1,0,2,2);
  builder.patch([replacement],['C']);
  assert.deepEqual(segments(builder.finish()),segments(buildPaintContourGraph([a,replacement])));
  builder.patch([],['B']); assert.equal(builder.finish().diagnostics.arcCount,0);
  builder.patch([b,c]); assert.deepEqual(segments(builder.finish()),segments(buildPaintContourGraph([a,b,c])));
});

test('open rings are diagnosed and follow the actual d3 streamed fill surface', () => {
  const broken=polygon('bad',[[[0,0],[1,0],[1,1],[0,1]]]);
  const graph=buildPaintContourGraph([broken,rect('A',1,0,2,1)]);
  assert.equal(graph.diagnostics.invalidRings,1);assert.equal(graph.diagnostics.arcCount,1);
  assert.deepEqual(segments(graph), ['A:bad|[1,0]|[1,1]']);
});

test('palette or undo refresh changes only the active set, never the packed graph', () => {
  const graph=buildPaintContourGraph([rect('A',0,0,1,1),rect('B',1,0,2,1),rect('C',2,0,3,1)]);
  const bytes=Buffer.from(graph.coordinates.buffer).toString('hex');
  const colors={A:'#010101',B:'#020202',C:'#030303'};
  const view=createPaintContourMesh(graph,id=>colors[id]);assert.equal(view.getActiveArcCount(),2);
  colors.B=colors.A; view.refresh();assert.equal(view.getActiveArcCount(),1);
  colors.B='#020202';view.refresh(['B']);assert.equal(view.getActiveArcCount(),2);
  assert.equal(Buffer.from(graph.coordinates.buffer).toString('hex'),bytes);
});

test('declared coarse quantization repairs coarse/fine seams without merging fine/fine gaps', () => {
  const coarse = {...rect('A',0,0,1,1), coordinatePrecision:4};
  const fine = rect('B',1.00002,0.00002,2,1.00002);
  const g=buildPaintContourGraph([coarse,fine]);
  assert.equal(g.diagnostics.quantizedSharedSegments,1);
  assert.deepEqual(segments(g), ['A:B|[1,0]|[1,1]']);
  assert.equal(buildPaintContourGraph([rect('A',0,0,1,1),fine]).diagnostics.arcCount,0);
  assert.equal(buildPaintContourGraph([coarse,rect('B',1.00006,0,2,1)]).diagnostics.arcCount,0);
  assert.equal(buildPaintContourGraph([coarse, fine, {...fine,id:'C'}]).diagnostics.arcCount,0);
});

test('mixed LOD partial intervals node once and replacing coarse precision removes the join', () => {
  const a={...rect('A',0,0,1,2),coordinatePrecision:4};
  const b=polygon('B',[[[1.00002,0],[2,0],[2,2],[1.00002,2],[1.00002,1],[1.00002,0]]]);
  const builder=createPaintContourGraphBuilder();builder.patch([a,b]);
  assert.equal(builder.finish().diagnostics.quantizedSharedSegments,2);
  builder.patch([{...a,coordinatePrecision:7}]);assert.equal(builder.finish().diagnostics.arcCount,0);
});

test('partially exact seams retain the unmatched interval for coarse/fine reconciliation', () => {
  const a={...rect('A',0,0,1,2),coordinatePrecision:4};
  const b=polygon('B',[[[1,0],[2,0],[2,2],[1.00002,2],[1.00002,1],[1,1],[1,0]]]);
  const g=buildPaintContourGraph([a,b]);
  assert.equal(g.diagnostics.nodedSharedSegments,1);
  assert.equal(g.diagnostics.quantizedSharedSegments,1);
  assert.deepEqual(segments(g),['A:B|[1,0]|[1,1]','A:B|[1,1]|[1,2]']);
});
