#!/usr/bin/env node
// Real geometry acceptance. Separate processes release the large geometry index
// between scenarios. This is not a screen-pixel or ownership-identity audit.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { buildPaintContourGraph, createPaintContourGraphBuilder } from '../js/core/renderer/paint_contour_graph.js';
import { createPaintContourMesh } from '../js/core/renderer/paint_contour_mesh.js';
const root = '.runtime/reports/p3b-geometry';
mkdirSync(root, { recursive: true });
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const context = { exports: {} }; context.module = { exports: context.exports };
vm.runInNewContext(readFileSync('vendor/topojson-client.min.js', 'utf8'), context);
const topo = context.exports;
const idOf = feature => String(feature.properties?.id || feature.id || '');
const pair = (a, b) => [a, b].sort().join('|');
function pairsOf(graph) {
  const pairs = new Set();
  for (let i = 0; i < graph.owners.length; i += 2) pairs.add(pair(graph.featureIds[graph.owners[i]], graph.featureIds[graph.owners[i+1]]));
  return pairs;
}
function inspect(scenario) {
  const manifest = read(`data/scenarios/${scenario}/manifest.json`);
  const topology = read(manifest.runtime_topology_url);
  const geometries = topology.objects.political.geometries;
  const features = topo.feature(topology, topology.objects.political).features.map(f => ({ ...f, id: idOf(f) }));
  const input = features.filter(f => f.id && ['Polygon','MultiPolygon'].includes(f.geometry?.type));
  const expected = new Set();
  topo.neighbors(geometries).forEach((neighbors, i) => {
    for (const j of neighbors) if (i < j && idOf(geometries[i]) && idOf(geometries[j])) expected.add(pair(idOf(geometries[i]), idOf(geometries[j])));
  });
  const start = performance.now();
  const graph = buildPaintContourGraph(input);
  const buildMs = performance.now() - start;
  const found = pairsOf(graph);
  const missing = [...expected].filter(p => !found.has(p));
  const paint = Object.fromEntries(input.map(f => [f.id, '#123456']));
  const mesh = createPaintContourMesh(graph, id => paint[id]);
  assert.equal(mesh.getActiveArcCount(), 0);
  const first = graph.featureIds[graph.owners[0]];
  const editStart = performance.now(); paint[first] = '#654321'; mesh.refresh([first]);
  const localPaintMs = performance.now() - editStart;
  const paintedArcs = mesh.getActiveArcCount(); assert.ok(paintedArcs > 0);
  paint[first] = '#123456'; mesh.refresh([first]); assert.equal(mesh.getActiveArcCount(), 0);
  const report = { scenario, source: manifest.runtime_topology_url, ...graph.diagnostics, buildMs, localPaintMs,
    paintedArcs, nativePairCount: expected.size, graphPairCount: found.size, missingNativePairs: missing,
    heapMiB: process.memoryUsage().heapUsed / 1024 / 1024 };
  writeFileSync(`${root}/${scenario}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, missingNativePairs: missing.slice(0, 12) }));
  assert.equal(missing.length, 0, `Shared topology neighbors lost in ${scenario}; see audit JSON`);
  // Verify composed coarse/detail sources, independent of local arc numbers.
  if (scenario === 'tno_1962') {
    const entries = read(manifest.detail_chunk_manifest_url).chunks;
    const coarse = entries.find(c => c.layer === 'political' && c.lod === 'coarse' && c.global_coverage);
    const coarseFeatures = read(coarse.url).features.map(f => ({ ...f, id: idOf(f) }));
    const detail = entries.filter(c => c.layer === 'political' && c.lod !== 'coarse').slice(0, 2);
    const builder = createPaintContourGraphBuilder(); builder.patch(coarseFeatures);
    const before = builder.finish(); const beforePairs = pairsOf(before);
    const replacements = detail.flatMap(c => read(c.url).features.map(f => ({ ...f, id: idOf(f) })));
    builder.patch(replacements);
    const after = builder.finish(); const afterPairs = pairsOf(after);
    const changedIds = new Set(replacements.map(f => f.id));
    const lostSeams = [...beforePairs].filter(p => { const [a,b] = p.split('|'); return changedIds.has(a) !== changedIds.has(b); }).filter(p => !afterPairs.has(p));
    const seamReport = { coarse: coarse.url, detail: detail.map(c=>c.url), changedFeatures: changedIds.size,
      coarse: before.diagnostics, promoted: after.diagnostics, lostSeams };
    writeFileSync(`${root}/tno-seams.json`, JSON.stringify(seamReport, null, 2));
    assert.equal(lostSeams.length, 0, 'TNO coarse/detail promotion lost an existing cross-source adjacency');
  }
}
if (process.argv[2]) inspect(process.argv[2]);
else {
  let failed = false;
  for (const scenario of ['modern_world', 'hoi4_1936', 'hoi4_1939', 'tno_1962']) {
    const result = spawnSync(process.execPath, ['--max-old-space-size=6144', import.meta.filename, scenario], { encoding:'utf8' });
    writeFileSync(`${root}/${scenario}.log`, result.stdout + result.stderr);
    console.log(result.stdout); console.error(result.stderr); failed ||= result.status !== 0;
  }
  process.exitCode = failed ? 1 : 0;
}
