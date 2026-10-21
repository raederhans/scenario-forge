import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {createOverlayStore,validateOverlayCatalog,visualizationAssets} from '../src/data/overlays.js';
import {DEFAULT_LAYERS,readLayers,validDisplayOption} from '../src/render/settings.js';
import {solarState,nightCoverage} from '../src/render/solar.js';
import {metricColor,createVisualizationGpu} from '../src/render/visualization.js';

globalThis.crypto ||= webcrypto;
const dataset={manifest:{id:'test',revision:'r1'}};
function fixture(){
  const raster=gzipSync(new Uint8Array([16,0,20,32]));
  const catalog={format:'hgo-visualization-catalog',schemaVersion:1,baseDataset:{id:'test',revision:'r1'},
    assets:{terrain:{path:'geography/physical.gz',encoding:'gzip',dtype:'u8',channels:1,width:2,height:2,
      decodedByteLength:4,byteLength:raster.length,sha256:createHash('sha256').update(raster).digest('hex')}}};
  let calls=0;
  return {catalog,raster,get calls(){return calls;},
    fetchImpl:async url=>{calls++;return new Response(url.endsWith('catalog.json')?JSON.stringify(catalog):raster);}};
}
const storeFor=(f,extra={})=>createOverlayStore({dataset,catalogUrl:'https://local.test/overlays/catalog.json',fetchImpl:f.fetchImpl,...extra});

test('optional assets load on demand, deduplicate, release memory and reload',async()=>{
  const f=fixture(),store=storeFor(f);
  assert.equal(f.calls,0);
  const a=store.ensure('terrain'),b=store.ensure('terrain');assert.equal(a,b);
  await a;assert.equal(f.calls,2);assert.equal(store.decodedBytes,4);
  assert.deepEqual([...store.get('terrain').data],[16,0,20,32]);
  store.setActive([]);assert.equal(store.get('terrain'),null);assert.equal(store.decodedBytes,0);
  await store.ensure('terrain');assert.equal(f.calls,3);store.dispose();assert.equal(store.decodedBytes,0);
});

test('quality switches replace terrain/river assets, keep lighting shared and release the old resolution',async()=>{
  const catalog={format:'hgo-visualization-catalog',schemaVersion:1,baseDataset:{id:'test',revision:'r1'},assets:{}};
  const bodies=new Map();
  function raster(key,values,width,height,channels=1){
    const body=gzipSync(new Uint8Array(values)),path=`${key}.gz`;bodies.set(path,body);
    catalog.assets[key]={path,encoding:'gzip',dtype:'u8',channels,width,height,decodedByteLength:values.length,
      byteLength:body.length,sha256:createHash('sha256').update(body).digest('hex')};
  }
  function json(key,value){
    const body=Buffer.from(JSON.stringify(value)),path=`${key}.json`;bodies.set(path,body);
    catalog.assets[key]={path,encoding:'json',byteLength:body.length,sha256:createHash('sha256').update(body).digest('hex')};
  }
  raster('terrain',[16,17,32,33],2,2);raster('terrainBalanced',[16],1,1);
  raster('rivers',[0,255,255,0],2,2);raster('riversBalanced',[255],1,1);
  raster('nightLights',[255],1,1);raster('illumination',[128,128,128,255],1,1,4);
  catalog.assets.illumination.vectorEncoding='premultiplied-unit-rgb-edge-fade-v2';
  json('localization',{});json('terrainPalette',{});json('terrainLabels',{});
  const store=storeFor({fetchImpl:async url=>new Response(url.endsWith('catalog.json')?JSON.stringify(catalog):bodies.get(url.split('/').at(-1)))});
  const layers={...DEFAULT_LAYERS,terrain:true,rivers:true,nightLights:true,dayNight:true};
  const select=async quality=>{const keys=visualizationAssets({...layers,quality});store.setActive(keys);await store.prepare(keys);return store.decodedBytes;};
  try{
    const balanced=await select('balanced'),lights=store.get('nightLights'),illumination=store.get('illumination');
    assert.equal(store.get('terrainBalanced').width,1);assert.equal(store.get('terrain'),null);
    const fine=await select('fine');
    assert.equal(fine,balanced+6,'only the two raster resolutions increase decoded allocation');
    assert.equal(store.get('terrainBalanced'),null);assert.equal(store.get('riversBalanced'),null);
    assert.equal(store.get('nightLights'),lights);assert.equal(store.get('illumination'),illumination);
    assert.equal(await select('balanced'),balanced,'switching back restores the original decoded allocation');
    assert.equal(store.get('terrain'),null);assert.equal(store.get('rivers'),null);
    store.setActive(['localization']);
    assert.equal(store.decodedBytes,catalog.assets.localization.byteLength);
    assert.deepEqual(Object.keys(store.statuses()),['localization']);
  }finally{store.dispose();}
  assert.equal(store.decodedBytes,0);
});

test('late aborted transport cannot resurrect disabled resources or leak accounting',async()=>{
  const f=fixture();let resolveAsset;
  const store=storeFor(f,{fetchImpl:async url=>url.endsWith('catalog.json')?
    new Response(JSON.stringify(f.catalog)):await new Promise(resolve=>{resolveAsset=resolve;})});
  const pending=store.ensure('terrain');
  while(!resolveAsset)await new Promise(resolve=>setImmediate(resolve));
  store.setActive([]);resolveAsset(new Response(f.raster));
  await assert.rejects(pending);
  assert.equal(store.decodedBytes,0);assert.equal(store.get('terrain'),null);assert.deepEqual(store.statuses(),{});
  store.dispose();
});

test('integrity, decoding size and optional budget failures stay isolated',async()=>{
  const budget=storeFor(fixture(),{byteBudget:3});
  await assert.rejects(budget.ensure('terrain'),/budget/);assert.equal(budget.decodedBytes,0);
  assert.equal(budget.statuses().terrain.status,'error');budget.dispose();
  const f=fixture();f.catalog.assets.terrain.sha256='0'.repeat(64);
  const store=storeFor(f);await assert.rejects(store.ensure('terrain'),/integrity/);assert.equal(store.decodedBytes,0);store.dispose();
  const g=fixture();g.catalog.assets.terrain.width=1;g.catalog.assets.terrain.decodedByteLength=2;
  const tooLong=storeFor(g);await assert.rejects(tooLong.ensure('terrain'),/bounds/);tooLong.dispose();
});

test('catalog binds exact base and forbids path escapes or huge decoded images',()=>{
  for(const change of [c=>c.baseDataset.revision='other',c=>c.assets.terrain.path='../escape',
    c=>c.assets.terrain.path='https://remote.test/x',c=>c.assets.terrain.decodedByteLength=100e6]){
    const f=fixture();change(f.catalog);assert.throws(()=>validateOverlayCatalog(f.catalog,dataset));
  }
  const f=fixture();f.catalog.assets.illumination={...f.catalog.assets.terrain};
  assert.throws(()=>validateOverlayCatalog(f.catalog,dataset),/illumination vector encoding/);
  f.catalog.assets.illumination.vectorEncoding='premultiplied-unit-rgb-edge-fade-v2';
  assert.equal(validateOverlayCatalog(f.catalog,dataset),f.catalog);
});

test('new settings roundtrip with old project defaults and reject invalid metric/date',()=>{
  const defaults=readLayers({borders:true,labels:true,cities:true});
  assert.equal(defaults.terrain,false);assert.equal(defaults.nightLights,false);assert.equal(defaults.metric,'none');
  assert.equal(defaults.quality,'balanced');
  assert.equal(defaults.baseMapStyle,'political');
  const layers={...defaults,terrain:true,terrainMode:'geomorphology',metric:'resource_oil',solarDate:'2024-02-29',dayNight:true,solarMode:'cycle'};
  assert.deepEqual(readLayers(JSON.parse(JSON.stringify(layers))),layers);
  assert.equal(readLayers(JSON.parse(JSON.stringify({...layers,quality:'fine'}))).quality,'fine');
  assert.equal(validDisplayOption('quality','ultra'),false);
  assert.equal(readLayers({...layers,baseMapStyle:'thematic'}).baseMapStyle,'thematic');
  assert.equal(validDisplayOption('baseMapStyle','unknown'),false);
  assert.equal(validDisplayOption('solarDate','2023-02-29'),false);
  assert.equal(validDisplayOption('metric','oil'),false);
  assert.deepEqual(visualizationAssets(DEFAULT_LAYERS),['localization']);
  assert.ok(visualizationAssets(layers).includes('illumination'));
});

test('manual solar direction flips noon and midnight, date controls season, UTC ignores manual time',()=>{
  const noon=solarState({...DEFAULT_LAYERS,solarDate:'2026-03-20',utcMinutes:720});
  const midnight=solarState({...DEFAULT_LAYERS,solarDate:'2026-03-20',utcMinutes:0});
  assert.equal(nightCoverage([1,0,0],noon.direction),0);
  assert.equal(nightCoverage([1,0,0],midnight.direction),1);
  assert.ok(solarState({...DEFAULT_LAYERS,solarDate:'2026-06-21'}).direction[2]>.39);
  assert.ok(solarState({...DEFAULT_LAYERS,solarDate:'2026-12-21'}).direction[2]<-.39);
  const utc=solarState({...DEFAULT_LAYERS,solarMode:'utc',utcMinutes:0},new Date('2026-03-20T12:00:00Z'));
  assert.deepEqual(utc,noon);
  assert.ok(solarState({}).direction.every(Number.isFinite));
});

test('GPU uses numeric palette code, uploads once, and releases full rasters on disable',()=>{
  let serial=0;const uploads=[],deleted=[];
  const gl=new Proxy({texImage2D(...args){uploads.push(args);},deleteTexture(t){deleted.push(t);}},
    {get:(target,key)=>key in target?target[key]:String(key).toUpperCase()===key?++serial:()=>({})});
  const gpu=createVisualizationGpu(gl,{}, {core:{provinceIds:[null,1],provinceStateIds:[null,1],states:[{id:1,entityTag:'AAA'}]}});
  const terrain={width:2,height:2,data:new Uint8Array([16,16,16,16])};
  const palette={data:{palette:[{code:16,id:'plains',baseColor:'#112233',modernColor:null,color:'#112233'}]}};
  const resources=new Map([['terrainBalanced',terrain],['terrainPalette',palette]]);
  gpu.sync(resources,{...DEFAULT_LAYERS,terrain:true});
  const paletteUpload=uploads.find(args=>args[3]===256&&args[8].length===1024);
  assert.deepEqual([...paletteUpload[8].slice(64,68)],[17,34,51,255]);
  const count=uploads.length;gpu.sync(resources,{...DEFAULT_LAYERS,terrain:true});assert.equal(uploads.length,count);
  gpu.sync(resources,DEFAULT_LAYERS);
  assert.ok(uploads.slice(count).every(args=>args[3]===1&&args[4]===1));
  gpu.dispose();assert.equal(deleted.length,7);
  assert.deepEqual(metricColor(null),[0,0,0,0]);assert.equal(metricColor(0)[3],255);
});
