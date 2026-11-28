import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPaintContourGraph } from '../js/core/renderer/paint_contour_graph.js';
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
  const colors={A:'#ff0000',B:'#FF0000',C:'#00ff00'};
  const view=createPaintContourMesh(graph,id=>colors[id]);
  assert.equal(view.getActiveArcCount(),0);
  colors.B='#000000'; assert.equal(view.refresh(['B']),true);
  assert.deepEqual(view.getMesh().coordinates,[[[1,0],[1,1]]]);
});

test('holes and enclaves match regardless of polygon ring winding', () => {
  const outer=rect('A',0,0,3,3); const hole=rect('B',1,1,2,2);
  outer.geometry.coordinates.push([...hole.geometry.coordinates[0]].reverse());
  const graph=buildPaintContourGraph([outer,hole]);
  assert.equal(segments(graph).length, 4);
  outer.geometry.coordinates.forEach(ring=>ring.reverse()); hole.geometry.coordinates[0].reverse();
  assert.deepEqual(segments(buildPaintContourGraph([outer,hole])),segments(graph));
});

test('date-line aliases produce one shared arc without drawing a world-spanning chord', () => {
  const graph=buildPaintContourGraph([rect('west',179,0,180,1),rect('east',-180,0,-179,1)]);
  assert.equal(Math.abs(graph.coordinates[0]),180);
  assert.equal(graph.coordinates[0],graph.coordinates[2]);
});

test('coast chains contain uncovered one-sided edges', async () => {
  const { packContourWaterMask } = await import('../js/core/renderer/paint_contour_water_mask.js');
  const { createPackedLineMesh } = await import('../js/core/renderer/packed_line_mesh.js');
  const a = rect('A', 0, 0, 1, 1), b = rect('B', 1, 0, 2, 1);
  const segments = graph => createPackedLineMesh(graph.coast).coordinates.flatMap(line =>
    line.slice(1).map((p, i) => [line[i], p]));
  const graph = buildPaintContourGraph([a, b], { waterMask: packContourWaterMask({ land: [a.geometry, b.geometry] }) });
  assert.equal(segments(graph).length, 6);
  assert.ok(segments(graph).every(([p, q]) => !(p[0] === 1 && q[0] === 1)));
});

test('coast retains both shores of a narrow water channel', async () => {
  const { packContourWaterMask } = await import('../js/core/renderer/paint_contour_water_mask.js');
  const { createPackedLineMesh } = await import('../js/core/renderer/packed_line_mesh.js');
  const rect = (id, west, east) => ({ id, type: 'Feature', geometry: { type: 'Polygon',
    coordinates: [[[west, 0], [east, 0], [east, 1], [west, 1], [west, 0]]] } });
  const features = [rect('A', 0, 1), rect('B', 1.001, 2)];
  const waterMask = packContourWaterMask({ land: features });
  for (const nearSeamTolerance of [0, 0.05]) {
    const graph = buildPaintContourGraph(features, { waterMask, nearSeamTolerance });
    const edges = createPackedLineMesh(graph.coast).coordinates.flatMap(line => line.slice(1).map((p, i) => [line[i], p]));
    assert.equal(edges.length, 8);
    for (const x of [1, 1.001]) assert.ok(edges.some(([a, b]) => a[0] === x && b[0] === x));
  }
});
