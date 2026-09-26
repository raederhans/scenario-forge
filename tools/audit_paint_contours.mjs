#!/usr/bin/env node
// Real geometry acceptance. Separate processes release the large geometry index
// between scenarios. This is not a screen-pixel or ownership-identity audit.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { buildPaintContourGraph, createPaintContourGraphBuilder } from '../js/core/renderer/paint_contour_graph.js';
import { createPoliticalFeaturePolicy } from '../js/core/renderer/political_feature_policy.js';
import { registerContourSourcePrecision, getContourCoordinatePrecision } from '../js/core/paint_contour_source.js';
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
// Independent oracle starts with signed native TopoJSON arc references, not the
// graph's coordinate edge index. A shared arc alone is not a two-sided interior:
// real assets also contain overlapping same-side polygons and malformed rings.
function nativeInteriorPairs(topology, features, eligibleIds) {
  const incidents = new Map(), arcsByPair = new Map();
  let malformedRings = 0, nonInteriorArcs = 0;
  const side = (ring, hole) => {
    let area = 0;
    for (let i=1;i<ring.length;i++) {
      let dx=ring[i][0]-ring[i-1][0];if(dx>180)dx-=360;if(dx< -180)dx+=360;
      area -= dx*(ring[i][1]+ring[i-1][1]);
    }
    return Math.sign(area)*(hole?-1:1);
  };
  topology.objects.political.geometries.forEach((g, i) => {
    if (!eligibleIds.has(idOf(g))) return;
    const polys=g.type==='Polygon'?[g.arcs]:g.type==='MultiPolygon'?g.arcs:[];
    const coords=features[i].geometry?.type==='Polygon'?[features[i].geometry.coordinates]:features[i].geometry?.coordinates || [];
    polys.forEach((rings,pi)=>rings.forEach((refs,ri)=>{
      const ring=coords[pi]?.[ri];
      if(!ring||ring.length<4||String(ring[0])!==String(ring.at(-1))){malformedRings++;return;}
      const direction=side(ring,ri>0);if(!direction)return;
      for(const ref of refs){const arc=ref<0?~ref:ref;
        let sides=incidents.get(arc);if(!sides)incidents.set(arc,sides=[new Set(),new Set()]);
        sides[direction*(ref<0?-1:1)>0?0:1].add(idOf(g));
      }
    }));
  });
  for(const [arc,[left,right]] of incidents){
    if(left.size!==1||right.size!==1||[...left][0]===[...right][0]){if(left.size+right.size>1)nonInteriorArcs++;continue;}
    const line=topo.feature(topology,{type:'LineString',arcs:[arc]}).geometry.coordinates;
    if(!line.some(p=>String(p)!==String(line[0])))continue;
    const key=pair([...left][0],[...right][0]);
    if(!arcsByPair.has(key))arcsByPair.set(key,[]);arcsByPair.get(key).push(line);
  }
  return {arcsByPair,malformedRings,nonInteriorArcs,side};
}

function unresolvedInteriorPairs(missing, oracle, input) {
  // Coincident edges can have different native arc IDs. Inspect only the missing
  // candidate segments against all source rings, rejecting genuinely ambiguous
  // same-side overlaps. No per-country/feature failure allowlist is used.
  const vertex=p=>[Math.round((((p[0]+180)%360+360)%360-180)*1e7),Math.round(p[1]*1e7)];
  const edge=(a,b)=>{a=vertex(a);b=vertex(b);const sign=a[0]<b[0]||(a[0]===b[0]&&a[1]<b[1])?1:-1;
    return {key:sign>0?`${a};${b}`:`${b};${a}`,sign};};
  const candidates=new Map(), keysByPair=new Map();
  for(const p of missing){const keys=new Set();keysByPair.set(p,keys);
    for(const line of oracle.arcsByPair.get(p))for(let i=1;i<line.length;i++){
      const e=edge(line[i-1],line[i]);keys.add(e.key);candidates.set(e.key,[new Set(),new Set()]);
    }
  }
  for(const f of input){const polys=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;
    for(const rings of polys)for(const [ri,ring] of rings.entries()){
      if(!ring||ring.length<4)continue;
      const rendered=[...ring.slice(0,-1),ring[0]],side=oracle.side(rendered,ri>0);
      for(let i=1;i<rendered.length;i++){
        const e=edge(rendered[i-1],rendered[i]), sides=candidates.get(e.key);
        if(sides&&side)sides[e.sign*side>0?0:1].add(f.id);
      }
    }
  }
  return missing.filter(p=>[...keysByPair.get(p)].some(key=>{
    const [left,right]=candidates.get(key);
    return left.size===1&&right.size===1&&pair([...left][0],[...right][0])===p;
  }));
}

const policy = createPoliticalFeaturePolicy({}, {
  getFeatureId:idOf, getFeatureCountryCodeNormalized:f=>f.properties?.cntr_code || '',
  isBaseGeographyScenarioFeature:f=>f.properties?.render_as_base_geography===true,
  isAtlantropaFieldDrivenFeature:f=>!!(f.properties?.atl_render_layer || f.properties?.atl_color_rule),
  isScenarioAtlantropaVisible:()=>true,
  isInteractiveAtlantropaBooleanWeldIslandFeature:f=>idOf(f).startsWith('ATLISL_')
    && f.properties?.atl_geometry_role==='donor_island'&&f.properties?.atl_join_mode==='boolean_weld',
});
const eligible = f => policy.isPoliticalInteractionRenderableFeature(f,idOf(f))
  && (!f.properties?.atl_color_rule || f.properties.atl_color_rule==='owner');
function inspect(scenario, seamsOnly=false) {
  const manifest = read(`data/scenarios/${scenario}/manifest.json`);
  if (!seamsOnly) {
  const topology = read(manifest.runtime_topology_url);
  const geometries = topology.objects.political.geometries;
  const features = topo.feature(topology, topology.objects.political).features.map(f => ({ ...f, id: idOf(f) }));
  const input = features.filter(f => f.id && eligible(f) && ['Polygon','MultiPolygon'].includes(f.geometry?.type));
  const expected = new Set();
  topo.neighbors(geometries).forEach((neighbors, i) => {
    for (const j of neighbors) if (i < j && idOf(geometries[i]) && idOf(geometries[j])) expected.add(pair(idOf(geometries[i]), idOf(geometries[j])));
  });
  const start = performance.now();
  const graph = buildPaintContourGraph(input);
  const buildMs = performance.now() - start;
  const found = pairsOf(graph);
  const missing = [...expected].filter(p => !found.has(p));
  const oracle = nativeInteriorPairs(topology, features, new Set(input.map(f=>f.id)));
  const absentInteriors = [...oracle.arcsByPair.keys()].filter(p => !found.has(p));
  const unresolved = unresolvedInteriorPairs(absentInteriors, oracle, input);
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
    provenNativeInteriorPairs: oracle.arcsByPair.size, malformedSourceRings: oracle.malformedRings,
    nonInteriorNativeArcs: oracle.nonInteriorArcs, coordinateOverlapPairs: absentInteriors.filter(p=>!unresolved.includes(p)),
    unresolvedInteriorPairs: unresolved,
    heapMiB: process.memoryUsage().heapUsed / 1024 / 1024 };
  writeFileSync(`${root}/${scenario}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, missingNativePairs: missing.slice(0, 12) }));
  assert.equal(unresolved.length, 0, `Proven two-sided interiors lost in ${scenario}; see audit JSON`);
  }
  // Verify composed coarse/detail sources, independent of local arc numbers.
  if (seamsOnly) {
    const entries = read(manifest.detail_chunk_manifest_url).chunks;
    const coarse = entries.find(c => c.layer === 'political' && c.lod === 'coarse' && c.global_coverage);
    const coarsePayload=read(coarse.url);registerContourSourcePrecision(coarsePayload,coarse);
    const coarseFeatures = coarsePayload.features.filter(eligible).map(f => ({ ...f, id: idOf(f), coordinatePrecision:getContourCoordinatePrecision(f.geometry) }));
    const detail = entries.filter(c => c.layer === 'political' && c.lod !== 'coarse').slice(0, 2);
    const builder = createPaintContourGraphBuilder(); builder.patch(coarseFeatures);
    const before = builder.finish(); const beforePairs = pairsOf(before);
    const replacements = detail.flatMap(c => read(c.url).features.filter(eligible).map(f => ({ ...f, id: idOf(f) })));
    builder.patch(replacements);
    const after = builder.finish(); const afterPairs = pairsOf(after);
    const changedIds = new Set(replacements.map(f => f.id));
    const lostSeams = [...beforePairs].filter(p => { const [a,b] = p.split('|'); return changedIds.has(a) !== changedIds.has(b); }).filter(p => !afterPairs.has(p));
    const seamReport = { coarseSource: coarse.url, detail: detail.map(c=>c.url), changedFeatures: changedIds.size,
      coarse: before.diagnostics, promoted: after.diagnostics, lostSeams };
    writeFileSync(`${root}/tno-seams.json`, JSON.stringify(seamReport, null, 2));
    assert.equal(lostSeams.length, 0, 'TNO coarse/detail promotion lost an existing cross-source adjacency');
    assert.ok(after.diagnostics.quantizedSharedSegments>0);
    writeFileSync(`${root}/tno-promoted-pairs.json`, JSON.stringify([...afterPairs].sort()));
    globalThis.gc?.();
    // Unloading detail must reproduce the original complete coarse adjacency.
    builder.patch(coarseFeatures.filter(f=>changedIds.has(f.id)));
    assert.deepEqual([...pairsOf(builder.finish())].sort(), [...beforePairs].sort());
  }
}
if (process.argv[2]) inspect(process.argv[2]==='tno-seams'?'tno_1962':process.argv[2], process.argv[2]==='tno-seams');
else {
  let failed = false;
  for (const scenario of ['modern_world', 'hoi4_1936', 'hoi4_1939', 'tno_1962', 'tno-seams']) {
    const result = spawnSync(process.execPath, ['--expose-gc', '--max-old-space-size=4096', import.meta.filename, scenario], { encoding:'utf8' });
    writeFileSync(`${root}/${scenario}.log`, result.stdout + result.stderr);
    console.log(result.stdout); console.error(result.stderr); failed ||= result.status !== 0;
  }
  process.exitCode = failed ? 1 : 0;
}
