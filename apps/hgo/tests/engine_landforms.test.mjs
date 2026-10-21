import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLandformLabels} from '../src/data/landforms.js';
import {visualizationAssets} from '../src/data/overlays.js';
import {DEFAULT_LAYERS,readLayers} from '../src/render/settings.js';
import {createLabelLayout} from '../src/render/labels.js';

const dataset={manifest:{coordinateSpace:{width:5120,height:2560}},core:{states:[],entities:[]},places:[]};
const document={labels:{}},view={x:2560,y:1280,scale:1};
const layers={...DEFAULT_LAYERS,terrain:true,labels:false,cities:false};
const entry={id:'alps',nameEn:'Alps',nameZh:'阿尔卑斯山',x:2560,y:1280,rank:1,minZoom:2};
const payload=labels=>({schemaVersion:1,coordinateSpace:'hgo-pixel',labels});
const measure=text=>text.length*8;
const layout=(owner,options=layers,source=payload([entry]),camera=view)=>
  owner.layout(document,camera,options,1600,900,measure,source);

test('landform assets follow their parent mode and saved switch, independent of political names',()=>{
  assert.equal(visualizationAssets(DEFAULT_LAYERS).includes('terrainLabels'),false);
  assert.equal(visualizationAssets(layers).includes('terrainLabels'),true);
  for(const changes of [{terrain:false},{terrainMode:'native'},{landformLabels:false}])
    assert.equal(visualizationAssets({...layers,...changes}).includes('terrainLabels'),false);
  assert.equal(readLayers({borders:true,labels:false,cities:false}).landformLabels,true);
  assert.equal(readLayers({...layers,landformLabels:false}).landformLabels,false);
  assert.throws(()=>readLayers({...layers,landformLabels:'yes'}));
});

test('registered names require bounded native coordinates, unique ids and valid visibility metadata',()=>{
  const source=payload([entry]);
  assert.equal(validateLandformLabels(source,dataset),source);
  for(const bad of [{x:5120},{x:-1},{y:Infinity},{rank:0},{minZoom:NaN},{nameEn:''},{nameZh:null}]){
    assert.throws(()=>validateLandformLabels(payload([{...entry,...bad}]),dataset),/landform labels/);
  }
  assert.throws(()=>validateLandformLabels(payload([entry,entry]),dataset));
  assert.throws(()=>validateLandformLabels({...source,coordinateSpace:'lonlat'},dataset));
});

test('landform names support all languages and English fallback without changing source names',()=>{
  const owner=createLabelLayout(dataset);
  assert.equal(layout(owner)[0].text,'阿尔卑斯山');
  assert.equal(layout(owner,{...layers,nameLanguage:'en'})[0].text,'Alps');
  assert.equal(layout(owner,{...layers,nameLanguage:'bilingual'})[0].text,'阿尔卑斯山 / Alps');
  assert.equal(layout(owner,layers,payload([{...entry,nameZh:''}]))[0].text,'Alps');
  assert.equal(entry.nameEn,'Alps');
});

test('late loads build one spatial index; pan reuses it and disabling releases it',()=>{
  let reads=0;
  const point={...entry,get x(){reads++;return entry.x;}},source=payload([point]);
  const owner=createLabelLayout(dataset);
  assert.equal(layout(owner,layers,null).length,0);
  assert.equal(layout(owner,layers,source).length,1);
  const once=reads;
  for(let i=0;i<30;i++)assert.equal(layout(owner,layers,source,{...view,x:view.x+i}).length,1);
  assert.equal(reads,once,'native anchors must not be reindexed on every frame');
  assert.equal(layout(owner,{...layers,terrain:false},source).length,0);
  assert.equal(layout(owner,layers,source).length,1);
  assert.ok(reads>once,'enabling after release reconstructs only the optional index');
  owner.releaseLandforms();
  assert.equal(layout(owner,layers,null).length,0);
});

test('source atlas thresholds and ranks reveal names progressively, independently of screen pixels',()=>{
  const owner=createLabelLayout(dataset),source=payload([entry,{...entry,id:'minor',x:2800,rank:5}]);
  assert.equal(layout(owner,layers,source,{...view,scale:.2}).length,0);
  assert.deepEqual(layout(owner,layers,source).map(e=>e.id),['landform:alps']);
  assert.ok(layout(owner,layers,source,{...view,x:2680,scale:4}).some(e=>e.id==='landform:minor'));
  assert.equal(layout(owner,{...layers,terrainMode:'native'},source).length,0);
});

test('landforms share collision/total budgets and preserve custom-name priority',()=>{
  const source=payload(Array.from({length:200},(_,i)=>({...entry,id:String(i),nameEn:`Range ${i}`,
    nameZh:`山脉 ${i}`,x:100+(i%20)*220,y:100+Math.floor(i/20)*220})));
  const mixed={...dataset,core:{...dataset.core,states:source.labels.map((label,i)=>({
    id:i,name:`S${i}`,anchor:[label.x,label.y+60],pixelCount:10000}))}};
  for(const [density,cap,total]of [['low',12,96],['medium',24,180],['high',40,300]]){
    const entries=createLabelLayout(mixed).layout(document,view,{...layers,labels:true,labelDensity:density},6000,3000,measure,source);
    assert.equal(entries.filter(e=>e.kind==='landform').length,cap);
    assert.ok(entries.length<=total);
    const boxes=entries.flatMap(e=>e.boxes);
    for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
      const [a,b]=[boxes[i],boxes[j]];
      assert.equal(a[0]<b[2]&&a[2]>b[0]&&a[1]<b[3]&&a[3]>b[1],false);
    }
  }
  const custom={...dataset,core:{...dataset.core,states:[{id:1,name:'State',anchor:[entry.x,entry.y],pixelCount:1}]}};
  const result=createLabelLayout(custom).layout({labels:{1:'My name'}},view,{...layers,labels:true},1000,500,measure,payload([entry]));
  assert.deepEqual(result.map(e=>e.text),['My name']);
});

test('draw consumes an explicit label snapshot and shares text measurements across frames',()=>{
  const owner=createLabelLayout(dataset),source=payload([entry]);
  let measurements=0;const texts=[];
  const ctx={setTransform(){},clearRect(){},strokeText(){},fillText(text){texts.push(text);},
    measureText(){measurements++;return {width:90};}};
  const canvas={width:1600,height:900,getContext:()=>ctx};
  for(let frame=0;frame<20;frame++)owner.draw(canvas,document,{...view,x:view.x+frame},layers,1,{landformLabels:source});
  assert.equal(measurements,1);assert.equal(texts.length,20);
  assert.equal(owner.draw(canvas,document,view,layers,1,{landformLabels:null}).length,0);
  assert.equal(owner.draw(canvas,document,view,layers,1,{clear:false,landformLabels:source})[0].text,'阿尔卑斯山');
});
