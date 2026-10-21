import {landformLabelsVisible} from './landforms.js';

const MAX_CATALOG = 512 * 1024;
const MAX_ASSET = 24 * 1024 * 1024;
export const OPTIONAL_BYTE_BUDGET = 48 * 1024 * 1024;
const fail = (ok,message) => {if(!ok)throw new Error(message);};

export function validateOverlayCatalog(catalog,dataset) {
  fail(catalog?.format==='hgo-visualization-catalog'&&catalog.schemaVersion===1,'Invalid visualization catalog');
  fail(catalog.baseDataset?.id===dataset.manifest.id&&catalog.baseDataset?.revision===dataset.manifest.revision,
    'Visualizations do not match this HGO dataset');
  fail(catalog.assets&&typeof catalog.assets==='object'&&!Array.isArray(catalog.assets),'Invalid visualization assets');
  for(const [key,asset] of Object.entries(catalog.assets)) {
    if(key==='illumination')fail(asset?.vectorEncoding==='premultiplied-unit-rgb-edge-fade-v2',
      'Unsupported illumination vector encoding');
    fail(/^[a-z][a-zA-Z0-9]*$/.test(key),'Invalid visualization key');
    fail(typeof asset.path==='string'&&/^[a-zA-Z0-9_./-]+$/.test(asset.path)
      &&!asset.path.startsWith('/')&&!asset.path.split('/').includes('..'),'Invalid visualization asset path');
    fail(Number.isInteger(asset.byteLength)&&asset.byteLength>0&&asset.byteLength<=MAX_ASSET
      &&/^[a-f0-9]{64}$/.test(asset.sha256),'Invalid visualization asset identity');
    fail(['json','gzip'].includes(asset.encoding),'Invalid visualization encoding');
    if(asset.encoding==='gzip')fail(asset.dtype==='u8'&&Number.isInteger(asset.width)&&asset.width>0
      &&Number.isInteger(asset.height)&&asset.height>0&&[1,4].includes(asset.channels)
      &&asset.decodedByteLength===asset.width*asset.height*asset.channels
      &&asset.decodedByteLength<=MAX_ASSET,'Invalid visualization raster');
  }
  return catalog;
}

async function readBounded(response,limit,signal,exact=false) {
  fail(response.ok,`Visualization: HTTP ${response.status}`);
  const reader=response.body.getReader(),chunks=[];let length=0;
  try {
    while(true){signal?.throwIfAborted();const {done,value}=await reader.read();if(done)break;
      length+=value.length;fail(length<=limit,'Visualization exceeds byte limit');chunks.push(value);}
  }finally{await reader.cancel();}
  fail(!exact||length===limit,'Visualization byte length mismatch');
  const out=new Uint8Array(length);let offset=0;
  for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.length;}
  return out;
}

// Optional resources have their own lifecycle and version. They never mutate
// the native dataset identity or participate in paint/ownership history.
export function createOverlayStore({dataset,catalogUrl,fetchImpl=globalThis.fetch,
  validators={},onChange=()=>{},byteBudget=OPTIONAL_BYTE_BUDGET}={}) {
  const base=new URL(catalogUrl),root=new URL('./',base);
  let catalog=null,catalogPromise=null,disposed=false,reserved=0;
  const entries=new Map(),catalogController=new AbortController();
  function announce(){if(!disposed)onChange();}
  async function catalogReady(){
    if(catalog)return catalog;
    if(!catalogPromise)catalogPromise=(async()=>{
      const bytes=await readBounded(await fetchImpl(base.href,{signal:catalogController.signal}),MAX_CATALOG,catalogController.signal);
      catalog=validateOverlayCatalog(JSON.parse(new TextDecoder().decode(bytes)),dataset);
      return catalog;
    })().catch(error=>{catalogPromise=null;throw error;});
    return catalogPromise;
  }
  async function readAsset(key,entry) {
    const meta=(await catalogReady()).assets[key];fail(meta,`Missing visualization: ${key}`);
    entry.controller.signal.throwIfAborted();
    const bytes=meta.encoding==='gzip'?meta.decodedByteLength:meta.byteLength;
    fail(reserved+bytes<=byteBudget,'Optional visualization memory budget exceeded');
    entry.bytes=bytes;reserved+=bytes;
    const url=new URL(meta.path,root);
    fail(url.origin===root.origin&&url.pathname.startsWith(root.pathname),'Visualization asset escapes package');
    const transport=await readBounded(await fetchImpl(url.href,{signal:entry.controller.signal}),meta.byteLength,entry.controller.signal,true);
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',transport)),b=>b.toString(16).padStart(2,'0')).join('');
    fail(hash===meta.sha256,'Visualization integrity mismatch');
    let data;
    if(meta.encoding==='gzip') {
      const reader=new Blob([transport]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
      data=new Uint8Array(meta.decodedByteLength);let offset=0;
      try{while(true){entry.controller.signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;
        fail(offset+value.length<=data.length,'Visualization decompression exceeds bounds');data.set(value,offset);offset+=value.length;}}
      finally{await reader.cancel();}
      fail(offset===data.length,'Truncated visualization raster');
    } else {
      data=JSON.parse(new TextDecoder().decode(transport));
      if(validators[key])data=validators[key](data,dataset);
    }
    entry.controller.signal.throwIfAborted();
    fail(!disposed&&entries.get(key)===entry,'Obsolete visualization load');
    entry.resource={...meta,data};entry.status='ready';announce();return entry.resource;
  }
  function release(key,entry) {
    entry.controller.abort();reserved-=entry.bytes||0;entry.bytes=0;entry.resource=null;
    if(entries.get(key)===entry)entries.delete(key);
  }
  function ensure(key) {
    if(disposed)return Promise.reject(new Error('Visualization store disposed'));
    const previous=entries.get(key);if(previous)return previous.promise;
    const entry={controller:new AbortController(),status:'loading',bytes:0,resource:null};
    entries.set(key,entry);
    entry.promise=readAsset(key,entry).catch(error=>{
      reserved-=entry.bytes||0;entry.bytes=0;
      if(entries.get(key)===entry){entry.status='error';entry.error=error.message;announce();}
      throw error;
    });
    announce();return entry.promise;
  }
  return {
    get:key=>entries.get(key)?.resource||null,
    get catalog(){return catalog;},
    get decodedBytes(){return reserved;},
    statuses:()=>Object.fromEntries([...entries].map(([key,e])=>[key,{status:e.status,error:e.error||null}])),
    setActive(keys){
      const wanted=new Set(keys);
      for(const [key,entry]of entries)if(!wanted.has(key))release(key,entry);
      for(const key of wanted)void ensure(key).catch(()=>{});
      announce();
    },
    ensure,
    async prepare(keys){await Promise.all(keys.map(ensure));},
    retry(key){const entry=entries.get(key);if(entry)release(key,entry);return ensure(key);},
    dispose(){if(disposed)return;disposed=true;catalogController.abort();for(const [key,entry]of entries)release(key,entry);catalog=null;catalogPromise=null;}
  };
}

export function visualizationAssetKey(key,layers) {
  return ['terrain','rivers'].includes(key)&&layers.quality!=='fine'?`${key}Balanced`:key;
}

export function visualizationAssets(layers) {
  // English also needs verified spelling corrections and bilingual search.
  const keys=['localization'];
  if(layers.terrain)keys.push(visualizationAssetKey('terrain',layers),'terrainPalette');
  if(landformLabelsVisible(layers))keys.push('terrainLabels');
  if(layers.rivers)keys.push(visualizationAssetKey('rivers',layers));
  if(layers.nightLights)keys.push('nightLights');
  if(layers.dayNight)keys.push('illumination');
  if(layers.metric&&layers.metric!=='none')keys.push('metrics');
  return keys;
}
