import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { createPaintContourGraphBuilder } from '../js/core/renderer/paint_contour_graph.js';
import { createBorderClassification } from '../js/core/renderer/border_classification.js';
import { createPoliticalCollectionOwner } from '../js/core/renderer/political_collection_owner.js';
import { createPoliticalFeaturePolicy } from '../js/core/renderer/political_feature_policy.js';
import { resolveEffectiveWaterRegionFeatures } from '../js/core/renderer/effective_water_regions.js';
import { createProjectedGeometryBoundsOwner } from '../js/core/renderer/projected_geometry_bounds_owner.js';
import { packContourPolygons, createContourPolygonQuery, packContourWaterMask, createContourWaterQuery } from '../js/core/renderer/paint_contour_water_mask.js';

const read = path => JSON.parse(readFileSync(path, 'utf8'));
function vendor(path) {
  const scope = { exports: {} }; scope.module = { exports: scope.exports };
  vm.runInNewContext(readFileSync(path, 'utf8'), scope); return scope.exports;
}
globalThis.d3 = vendor('vendor/d3.v7.min.js');
globalThis.topojson = vendor('vendor/topojson-client.min.js');
const base = 'data/scenarios/tno_1962/', topology = read(`${base}runtime_topology.topo.json`);
const manifest = read(`${base}manifest.json`), owners = read(`${base}owners.by_feature.json`).owners;
const idOf = f => String(f.properties?.id || f.id || '');
const countryOf = f => String(f.properties?.cntr_code || '').toUpperCase();
const state = { activeScenarioId: 'tno_1962', mapSemanticMode: 'scenario', showScenarioAtlantropa: true };
const policy = createPoliticalFeaturePolicy(state, { getFeatureId: idOf, getFeatureCountryCodeNormalized: countryOf,
  isBaseGeographyScenarioFeature: f => f.properties?.render_as_base_geography === true,
  isAtlantropaFieldDrivenFeature: f => !!(f.properties?.atl_render_layer || f.properties?.atl_color_rule),
  isScenarioAtlantropaVisible: () => true,
  isInteractiveAtlantropaBooleanWeldIslandFeature: f => idOf(f).startsWith('ATLISL_')
    && f.properties?.atl_geometry_role === 'donor_island' && f.properties?.atl_join_mode === 'boolean_weld' });
const collectionOwner = createPoliticalCollectionOwner({ state, constants: {
  fragmentCamouflageRules: read('data/country_feature_policies.json').display.fragmentCamouflage.rules,
  interactiveAggregateTierFilters: { GB: new Set(['nuts1_basic']), GR: new Set(['adm1_basic']) },
}, helpers: { getFeatureId: idOf, getFeatureCountryCodeNormalized: countryOf,
  getDetailTier: f => f.properties?.detail_tier || '', isPoliticalInteractionRenderableFeature: policy.isPoliticalInteractionRenderableFeature } });
const decode = name => globalThis.topojson.feature(topology, topology.objects[name]);
const chunkEntries = read(`${base}detail_chunks.manifest.json`).chunks.filter(c => c.layer === 'political' && c.lod === 'detail');
const detail = { type: 'FeatureCollection', features: chunkEntries.flatMap(c => read(c.url).features) };
const composed = collectionOwner.composePoliticalFeatureCollections(decode('political'), detail);
const atlantropa = decode('scenario_atlantropa').features;
const landLike = atlantropa.filter(f => ['land', 'shoal', 'relief'].includes(f.properties?.atl_render_layer));
const all = new Map(composed.features.map(f => [idOf(f), f]));
for (const f of landLike) if (!all.has(idOf(f))) all.set(idOf(f), f);
const full = { type: 'FeatureCollection', features: [...all.values()] };
const interactive = collectionOwner.buildInteractiveLandData(full);
const eligible = f => !policy.shouldExcludePoliticalVisualFeature(f, idOf(f)) && !policy.isScenarioShellFeature(f, idOf(f))
  && (!f.properties?.atl_color_rule || f.properties.atl_color_rule === 'owner') && f.properties?.atl_surface_kind !== 'sea';
const features = interactive.features.filter(eligible).map(f => ({ ...f, id: idOf(f) }));
const visibleIds = new Set(features.map(f => f.id));
const unpruned = full.features.filter(f => visibleIds.has(idOf(f)));
const boundsOwner = createProjectedGeometryBoundsOwner({ state, getters: { getD3: () => globalThis.d3,
  getActiveScenarioId: () => 'tno_1962' }, helpers: { getFeatureId: idOf } });
const water = boundsOwner.sanitizeWaterRegionFeatures(resolveEffectiveWaterRegionFeatures({ scenarioFeatures: [...decode('scenario_water').features,
  ...atlantropa.filter(f => f.properties?.atl_render_layer === 'water')],
  globalLakeFeatures: read('data/global_lakes.geojson').features,
  activeScenarioId: 'tno_1962', exclusive: true,
  isExcluded: f => !f.properties?.scenario_id && (manifest.excluded_water_region_ids.includes(idOf(f))
    || manifest.excluded_water_region_groups.includes(f.properties?.region_group)) }));
const mask = packContourWaterMask({ land: decode('land_mask'), water, addedLand: landLike });
const isLand = createContourWaterQuery(mask);
const coastlineQuery = createContourPolygonQuery(packContourPolygons(decode('scenario_coastline')));
console.log(JSON.stringify({ source: 'runtime_topology + all political detail chunks', chunks: chunkEntries.length,
  features: features.length, atlantropaVisible: true, landMaskBytes: [mask.land, mask.water].reduce((n,p) => n+p.coordinates.byteLength+p.ringOffsets.byteLength+p.polygonOffsets.byteLength,0),
  maskProbes: [[36.56,51.81],[15.73,44.92],[42.79,30.56],[12.62,56.04]].map(([x,y]) => ({ point:[x,y], land:isLand(x,y), coastline:coastlineQuery(x,y) })) }));

function build(input, tolerance) {
  const builder = createPaintContourGraphBuilder({ nearSeamTolerance: tolerance, waterMask: mask });
  const start = performance.now(); builder.patch(input); const patchMs = performance.now()-start;
  const finishStart = performance.now(), graph = builder.finish();
  const finishMs = performance.now()-finishStart;
  const classification = createBorderClassification(graph, id => ({ borderKey: owners[id] || all.get(id)?.properties?.owner || '' }));
  return { graph, classification, patchMs, finishMs, memory: process.memoryUsage() };
}
const before = build(features, 0);
console.log(JSON.stringify({ phase:'before', finishMs:before.finishMs, patchMs:before.patchMs, diagnostics:before.graph.diagnostics, memory:before.memory }));
const after = build(features, 0.05);
console.log(JSON.stringify({ phase:'after', finishMs:after.finishMs, patchMs:after.patchMs, diagnostics:after.graph.diagnostics, memory:after.memory }));
const country = f => owners[idOf(f)] || f.properties?.owner || '';
const pairKey = (a,b) => [a,b].sort().join('|');
function outputSegments(graph) {
  const countries = new Map(), pairs = new Map();
  for (let arc=0;arc<graph.owners.length/2;arc++) {
    const a=graph.featureIds[graph.owners[arc*2]], b=graph.featureIds[graph.owners[arc*2+1]];
    const ca=owners[a] || all.get(a)?.properties?.owner, cb=owners[b] || all.get(b)?.properties?.owner;
    if (!ca || !cb || ca===cb) continue;
    const key=pairKey(a,b), list=pairs.get(key)||[]; pairs.set(key,list);
    const ck=pairKey(ca,cb), cs=countries.get(ck)||[]; countries.set(ck,cs);
    for(let i=graph.offsets[arc];i<graph.offsets[arc+1]-1;i++) {
      const line=[[graph.coordinates[i*2],graph.coordinates[i*2+1]],[graph.coordinates[i*2+2],graph.coordinates[i*2+3]]];
      list.push(line);cs.push(line);
    }
  }
  return { countries, pairs };
}
const km = (a,b) => globalThis.d3.geoDistance(a,b)*6371.0088;
const length = lines => (lines||[]).reduce((n,[a,b])=>n+km(a,b),0);
const oldLines=outputSegments(before.graph), newLines=outputSegments(after.graph);
const featureOrder = new Map(before.graph.featureIds.map((id,index)=>[id,index]));
const occupiedByFeature = new Map();
for (let arc=0;arc<before.graph.owners.length/2;arc++) {
  const ids=[before.graph.featureIds[before.graph.owners[arc*2]],before.graph.featureIds[before.graph.owners[arc*2+1]]];
  for(const id of ids)if(!occupiedByFeature.has(id))occupiedByFeature.set(id,[]);
  for(let p=before.graph.offsets[arc];p<before.graph.offsets[arc+1]-1;p++) {
    const a=[before.graph.coordinates[p*2],before.graph.coordinates[p*2+1]], b=[before.graph.coordinates[p*2+2],before.graph.coordinates[p*2+3]];
    for(const id of ids)occupiedByFeature.get(id).push({a,b});
  }
}
const occupiedGrids=new Map();
function occupied(f,p) {
  let grid=occupiedGrids.get(f.id);
  if(!grid){grid=gridFor(occupiedByFeature.get(f.id)||[]);occupiedGrids.set(f.id,grid);}
  for(const {a,b} of grid.get(Math.floor(p[0]/.05)*65536+Math.floor(p[1]/.05))||[]) {
    const dx=b[0]-a[0],dy=b[1]-a[1],u=((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy);
    if(u>=-1e-7&&u<=1+1e-7&&(a[0]+u*dx-p[0])**2+(a[1]+u*dy-p[1])**2<1e-12)return true;
  }
  return false;
}
const featureQueries = new Map();
function contains(f,x,y) {
  let query=featureQueries.get(f.id);
  if(!query){query=createContourPolygonQuery(packContourPolygons(f.geometry));featureQueries.set(f.id,query);}
  return query(x,y);
}
function boundary(f) {
  const result=[];
  const polys=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;
  for(const polygon of polys) for(let r=0;r<polygon.length;r++) {
    const ring=polygon[r];let area=0;
    for(let i=1;i<ring.length;i++)area+=(ring[i-1][0]*ring[i][1]-ring[i][0]*ring[i-1][1]);
    const sign=Math.sign(area)*(r? -1:1);
    for(let i=1;i<ring.length;i++) {
      const a=ring[i-1],b=ring[i],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);
      if(len&&Math.abs(dx)<=180)result.push({a,b,dx,dy,len,sign,f});
    }
  }
  return result;
}
const sourceOwners = new Map();
function sourceKey(edge) {
  const a=edge.a.map(n=>Math.round(n*1e7)).join(','),b=edge.b.map(n=>Math.round(n*1e7)).join(',');
  return a<b?`${a};${b}`:`${b};${a}`;
}
for(const feature of features)for(const edge of boundary(feature)) {
  const key=sourceKey(edge), previous=sourceOwners.get(key);
  if(previous===undefined)sourceOwners.set(key,feature.id);
  else if(previous!==feature.id)sourceOwners.set(key,null);
}
const cache=new Map();
const edgesFor = tag => {
  if(!cache.has(tag))cache.set(tag,features.filter(f=>country(f)===tag).flatMap(boundary).filter(edge=>sourceOwners.get(sourceKey(edge))!==null));
  return cache.get(tag);
};
function gridFor(edges) {
  const grid=new Map();
  for(const edge of edges) {
    for(let x=Math.floor(Math.min(edge.a[0],edge.b[0])/.05);x<=Math.floor(Math.max(edge.a[0],edge.b[0])/.05);x++)
      for(let y=Math.floor(Math.min(edge.a[1],edge.b[1])/.05);y<=Math.floor(Math.max(edge.a[1],edge.b[1])/.05);y++) {
        const key=x*65536+y;let bucket=grid.get(key);if(!bucket)grid.set(key,bucket=[]);bucket.push(edge);
      }
  }
  return grid;
}
function missing(tagA,tagB,output) {
  const grids=new Map([[tagA,gridFor(edgesFor(tagB))],[tagB,gridFor(edgesFor(tagA))]]);
  let candidateKm=0,missingKm=0,maxGapKm=0,rejectedWaterKm=0;
  const outputGrid=gridFor((output.countries.get(pairKey(tagA,tagB))||[]).map(([a,b])=>({a,b})));
  const missingExamples=[];
  for(const edge of [...edgesFor(tagA),...edgesFor(tagB)]) {
    const grid=grids.get(country(edge.f));
    const candidates=new Set(), cuts=[0,1], outputCandidates=new Set();
    for(let x=Math.floor((Math.min(edge.a[0],edge.b[0])-.05)/.05);x<=Math.floor((Math.max(edge.a[0],edge.b[0])+.05)/.05);x++)
      for(let y=Math.floor((Math.min(edge.a[1],edge.b[1])-.05)/.05);y<=Math.floor((Math.max(edge.a[1],edge.b[1])+.05)/.05);y++) {
        for(const line of outputGrid.get(x*65536+y)||[])outputCandidates.add(line);
        for(const other of grid.get(x*65536+y)||[]) {
          if(featureOrder.get(edge.f.id)>featureOrder.get(other.f.id))continue;
          if((edge.dx*other.dx+edge.dy*other.dy)*edge.sign*other.sign>=-.5*edge.len*other.len)continue;
          candidates.add(other);
        }
      }
    if(!candidates.size)continue;
    const project=p=>((p[0]-edge.a[0])*edge.dx+(p[1]-edge.a[1])*edge.dy)/(edge.len**2);
    const projected=[...candidates].map(other=>{const t=[project(other.a),project(other.b)].sort((a,b)=>a-b);const lo=Math.max(0,t[0]),hi=Math.min(1,t[1]);if(lo<hi)cuts.push(lo,hi);return{other,lo,hi};});
    cuts.sort((a,b)=>a-b);let gap=0;
    for(let i=1;i<cuts.length;i++) {
      const lo=cuts[i-1],hi=cuts[i];if(hi-lo<1e-12)continue;
      const samples=Math.max(1,Math.ceil((hi-lo)*edge.len/.005));
      for(let s=0;s<samples;s++) {
        const t=lo+(hi-lo)*(s+.5)/samples, p=[edge.a[0]+edge.dx*t,edge.a[1]+edge.dy*t];
        if(occupied(edge.f,p)){gap=0;continue;}
        let nearest=null,dist=.05**2;
        for(const {other,lo:ol,hi:oh} of projected) {
          if(t<ol||t>oh)continue;
          const u=Math.max(0,Math.min(1,((p[0]-other.a[0])*other.dx+(p[1]-other.a[1])*other.dy)/other.len**2));
          const q=[other.a[0]+other.dx*u,other.a[1]+other.dy*u],d=(q[0]-p[0])**2+(q[1]-p[1])**2;
          if(occupied(other.f,q))continue;
          if(d<=dist){nearest={other,q};dist=d;}
        }
        if(!nearest){gap=0;continue;}
        const unitKm=km(edge.a,edge.b)*(hi-lo)/samples;
        const x=(p[0]+nearest.q[0])/2,y=(p[1]+nearest.q[1])/2;
        if(!isLand(x,y)&&!contains(edge.f,x,y)&&!contains(nearest.other.f,x,y)){rejectedWaterKm+=unitKm;gap=0;continue;}
        candidateKm+=unitKm;
        const covered=[...outputCandidates].some(({a,b})=>{
          const ta=project(a),tb=project(b);if(t<Math.min(ta,tb)-1e-7||t>Math.max(ta,tb)+1e-7)return false;
          const dx=b[0]-a[0],dy=b[1]-a[1],u=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy)));
          return (a[0]+dx*u-p[0])**2+(a[1]+dy*u-p[1])**2<=.05**2+1e-12;
        });
        if(!covered){missingKm+=unitKm;gap+=unitKm;maxGapKm=Math.max(maxGapKm,gap);
          if(missingExamples.length<3)missingExamples.push({point:p,feature:edge.f.id,neighbor:nearest.other.f.id});
        }else gap=0;
      }
    }
  }
  return {candidateKm,missingKm,maxGapKm,rejectedWaterKm,missingExamples};
}
const pairs=[['RKO','RKM'],['RKU','RKM'],['ITA','CRO'],['TUR','SYR'],['IRQ','SAU'],['IRQ','PER'],['SAU','JOR'],['SAU','YEM'],['SAU','OMA'],['SAU','ARE'],['GER','RKP'],['RKN','BRG'],['DEN','SWE'],['IBR','MOR'],['ESP','MOR']];
for(const [a,b] of pairs)console.log(JSON.stringify({pair:`${a}-${b}`,beforeKm:length(oldLines.countries.get(pairKey(a,b))),afterKm:length(newLines.countries.get(pairKey(a,b))),
  before:missing(a,b,oldLines),after:missing(a,b,newLines)}));
function straitLength(graph, codes, bounds) {
  let total=0;
  for(let arc=0;arc<graph.owners.length/2;arc++) {
    const a=all.get(graph.featureIds[graph.owners[arc*2]]),b=all.get(graph.featureIds[graph.owners[arc*2+1]]);
    if(pairKey(countryOf(a),countryOf(b))!==pairKey(...codes))continue;
    for(let p=graph.offsets[arc];p<graph.offsets[arc+1]-1;p++) {
      const a=[graph.coordinates[p*2],graph.coordinates[p*2+1]],b=[graph.coordinates[p*2+2],graph.coordinates[p*2+3]];
      const x=(a[0]+b[0])/2,y=(a[1]+b[1])/2;
      if(x>=bounds[0]&&x<=bounds[2]&&y>=bounds[1]&&y<=bounds[3])total+=km(a,b);
    }
  }
  return total;
}
for(const [name,codes,bounds] of [['Oresund',['DK','SE'],[12.3,55.4,13.2,56.5]],['Gibraltar',['ES','MA'],[-5.7,35.95,-5.25,36.2]]]) {
  console.log(JSON.stringify({strait:name,sourceCountries:codes,bounds,beforeKm:straitLength(before.graph,codes,bounds),afterKm:straitLength(after.graph,codes,bounds)}));
}
const pruned=features.filter(f=>f.properties?.__visualFragmentCamouflage).map(f=>({id:f.id,owner:country(f),removed:f.properties.__visualFragmentPrunedCount}));
console.log(JSON.stringify({fragmentCamouflage:pruned, countryArcCount:after.classification.getCounts().country}));
if(pruned.length) {
  const originalById=new Map(unpruned.map(f=>[idOf(f),f]));
  const prunedIds=new Set(pruned.map(f=>f.id));
  const raw=build(features.map(f=>prunedIds.has(f.id)?{...originalById.get(f.id),id:f.id}:f),.05);
  const rawLines=outputSegments(raw.graph);
  console.log(JSON.stringify({fragmentCamouflageCountryLengthLossKm:pairs.map(([a,b])=>({pair:`${a}-${b}`,unprunedKm:length(rawLines.countries.get(pairKey(a,b))),visibleKm:length(newLines.countries.get(pairKey(a,b)))}))}));
}
