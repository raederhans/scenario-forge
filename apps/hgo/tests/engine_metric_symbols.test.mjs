import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createMetricSymbolLayout,resourceSymbolMaxRadius,resourceSymbolRadius} from '../src/render/metric_symbols.js';

const metric='resource_steel';
function fixture(rows) {
  return {dataset:{core:{states:rows.map(([id,,x,y])=>({id,anchor:[x,y]}))}},
    payload:{states:Object.fromEntries(rows.map(([id,value])=>[id,{values:{[metric]:value}}]))}};
}
const view={x:50,y:50,scale:1};
const geometry=result=>result.entries.map(({stateId,value,x,y,anchorX,anchorY,radius,box,crowded,leader})=>
  ({stateId,value,x,y,anchorX,anchorY,radius,box,crowded,leader}));
function nativeFixture() {
  const root=new URL('../assets/',import.meta.url);
  return {dataset:{core:JSON.parse(readFileSync(new URL('default/core.json',root),'utf8'))},
    payload:JSON.parse(readFileSync(new URL('overlays/metrics/metrics.json',root),'utf8'))};
}
function overlappingPairs(entries,padding=0) {
  let count=0;
  for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++) {
    const a=entries[i],b=entries[j];
    if(Math.hypot(a.x-b.x,a.y-b.y)<a.radius+b.radius+padding-1e-8)count++;
  }
  return count;
}

test('filled area uses the shared full-dataset maximum with no minimum-radius clamp',()=>{
  const {dataset,payload}=fixture([[1,1,20,20],[2,4,80,80],[3,100,1000,1000]]);
  const owner=createMetricSymbolLayout(dataset),result=owner.layout(payload,metric,view,100,100);
  assert.equal(result.maxValue,100,'offscreen maximum remains the scale basis');
  const small=result.entries.find(entry=>entry.stateId==='1'),large=result.entries.find(entry=>entry.stateId==='2');
  assert.equal(large.radius,small.radius*2);
  assert.equal(Math.PI*large.radius**2/(Math.PI*small.radius**2),4);
  assert.ok(resourceSymbolRadius(1e-12,100,1)<.001,'small positive values must retain their true area');
  for(const entry of result.entries)assert.equal(entry.radius,result.legendRadius(entry.value));
  assert.deepEqual(result.legendValues,[6.25,25,100]);
  const pan=owner.layout(payload,metric,{...view,x:1000,y:1000},100,100);
  assert.equal(pan.maxValue,100);assert.equal(pan.legendRadius(4),large.radius);
  assert.equal(resourceSymbolMaxRadius(.2),10);assert.equal(resourceSymbolMaxRadius(1),18);
  assert.equal(resourceSymbolMaxRadius(100),18);
  assert.equal(resourceSymbolRadius(0,100,1),0);assert.equal(resourceSymbolRadius(null,100,1),0);
});

test('zero and missing records remain untouched and have no quantity circle',()=>{
  const {dataset,payload}=fixture([[1,0,10,10],[2,null,20,20],[3,undefined,30,30],[4,5,50,50]]);
  const before=structuredClone(payload),owner=createMetricSymbolLayout(dataset);
  const result=owner.layout(payload,metric,view,100,100);
  assert.deepEqual(result.entries.map(entry=>entry.stateId),['4']);
  assert.equal(result.sourceCount,4);assert.equal(result.zeroCount,1);assert.equal(result.missingCount,2);
  assert.equal(result.entries[0].sourceRecord,payload.states['4']);
  assert.deepEqual(payload,before);
  assert.throws(()=>owner.layout(payload,'infrastructure',view,100,100),/Not a resource metric/);
  assert.equal(owner.layout(payload,metric,{...view,scale:0},100,100).visibleCount,0);
});

test('stable ID placement resolves collisions with bounded leaders and draws smaller circles on top',()=>{
  const {dataset,payload}=fixture([[2,1,50,50],[1,4,50,50],[3,1,75,50]]);
  const owner=createMetricSymbolLayout(dataset),result=owner.layout(payload,metric,view,200,200);
  assert.equal(result.visibleCount,3);assert.ok(result.displacedCount>0);
  assert.equal(result.entries[0].stateId,'1','larger circle is painted first');
  for(const entry of result.entries) {
    const distance=Math.hypot(entry.x-entry.anchorX,entry.y-entry.anchorY);
    assert.ok(distance<=30+1e-9);
    assert.equal(Boolean(entry.leader),distance>1e-7);
    assert.equal(entry.box.length,4);
    if(entry.leader)assert.deepEqual(entry.leader,[entry.anchorX,entry.anchorY,entry.x,entry.y]);
  }
  assert.deepEqual(geometry(owner.layout(payload,metric,view,200,200)),geometry(result));
  const pan=owner.layout(payload,metric,{...view,x:51,y:52},200,200);
  for(const entry of pan.entries) {
    const previous=result.entries.find(row=>row.stateId===entry.stateId);
    assert.ok(Math.abs(entry.x-(previous.x-1))<1e-9);
    assert.ok(Math.abs(entry.y-(previous.y-2))<1e-9);
  }
  assert.deepEqual(geometry(owner.layout(payload,metric,view,200,200)),geometry(result),'returning to a view is deterministic');
});

test('dense clusters retain every positive state and identify unresolved circles at their original anchors',()=>{
  const {dataset,payload}=fixture(Array.from({length:171},(_,index)=>[index+1,4,50,50]));
  const owner=createMetricSymbolLayout(dataset),result=owner.layout(payload,metric,view,300,300);
  assert.equal(result.visibleCount,171);assert.equal(new Set(result.entries.map(entry=>entry.stateId)).size,171);
  assert.equal(result.boxes.length,171);assert.ok(result.crowdedCount>0);
  assert.ok(result.entries.some(entry=>entry.crowded&&!entry.displaced));
  assert.ok(result.entries.every(entry=>Math.hypot(entry.x-entry.anchorX,entry.y-entry.anchorY)<=30+1e-9));
  assert.ok(result.diagnostics.candidateChecks<=171*65,'candidate work is bounded');
  const fresh=createMetricSymbolLayout(dataset).layout(payload,metric,view,300,300);
  assert.deepEqual(geometry(fresh),geometry(result));
});

test('edge candidates keep circles and label exclusion boxes within the viewport when feasible',()=>{
  const {dataset,payload}=fixture([[1,1,0,50],[2,1,100,50],[3,1,50,0],[4,1,50,100]]);
  const result=createMetricSymbolLayout(dataset).layout(payload,metric,view,100,100);
  assert.equal(result.visibleCount,4);
  for(const entry of result.entries) {
    assert.ok(entry.box[0]>=0&&entry.box[1]>=0&&entry.box[2]<=100&&entry.box[3]<=100);
    assert.ok(entry.displaced);assert.ok(Math.hypot(entry.x-entry.anchorX,entry.y-entry.anchorY)<=30+1e-9);
  }
  const tinyFixture=fixture([[1,1,50,50]]);
  const tiny=createMetricSymbolLayout(tinyFixture.dataset).layout(tinyFixture.payload,metric,view,10,10);
  assert.equal(tiny.visibleCount,1);
  assert.ok(tiny.entries.some(entry=>entry.crowded),'impossible placement is reported rather than silently hidden');
  const corner=fixture([[1,1,0,0]]);
  const cornerResult=createMetricSymbolLayout(corner.dataset).layout(corner.payload,metric,view,100,100);
  assert.equal(cornerResult.visibleCount,1);assert.equal(cornerResult.crowdedCount,0);
  assert.ok(cornerResult.entries[0].box.every(value=>value>=0&&value<=100));
  assert.ok(Math.hypot(cornerResult.entries[0].x-cornerResult.entries[0].anchorX,
    cornerResult.entries[0].y-cornerResult.entries[0].anchorY)<=30);
});

test('cached positive index avoids rereading all native metadata and release rebuilds it',()=>{
  const {dataset,payload}=fixture(Array.from({length:1000},(_,index)=>[index+1,index<3?index+1:null,index%100,50]));
  let reads=0;
  for(const record of Object.values(payload.states)) {
    const value=record.values[metric];Object.defineProperty(record.values,metric,{get(){reads++;return value;}});
  }
  const owner=createMetricSymbolLayout(dataset),first=owner.layout(payload,metric,view,300,300);
  assert.equal(reads,1000);assert.equal(first.cacheHit,false);assert.equal(first.indexBuildCount,1);
  for(let frame=0;frame<20;frame++) {
    const result=owner.layout(payload,metric,{...view,x:50+frame/10},300,300);
    assert.equal(result.cacheHit,true);assert.equal(result.indexBuildCount,1);
  }
  assert.equal(reads,1000,'panning must only visit the positive index');
  owner.release();const rebuilt=owner.layout(payload,metric,view,300,300);
  assert.equal(reads,2000);assert.equal(rebuilt.cacheHit,false);assert.equal(rebuilt.indexBuildCount,2);
  assert.deepEqual(geometry(rebuilt),geometry(first));
  const replacement={states:{...payload.states}};
  assert.equal(owner.layout(replacement,metric,view,300,300).indexBuildCount,3);
});

test('draw preserves the overlay canvas, applies DPR and only draws actual leaders',()=>{
  const {dataset,payload}=fixture([[1,4,50,50],[2,1,50,50]]),owner=createMetricSymbolLayout(dataset);
  const result=owner.layout(payload,metric,view,200,200),calls=[];
  const context=new Proxy({},{get:(_target,name)=>(...args)=>calls.push([name,...args]),set:()=>true});
  owner.draw({getContext:()=>context},result,2,{opacity:.8,selectedIds:['1']});
  assert.equal(calls.some(([name])=>name==='clearRect'),false);
  assert.deepEqual(calls.find(([name])=>name==='setTransform'),['setTransform',2,0,0,2,0,0]);
  assert.equal(calls.filter(([name])=>name==='lineTo').length,result.displacedCount);
  assert.equal(calls.filter(([name])=>name==='fill').length,result.visibleCount);
  assert.deepEqual(calls[0],['save']);assert.deepEqual(calls.at(-1),['restore']);
});

test('real native data retains every positive resource state in the world viewport',()=>{
  const {dataset,payload}=nativeFixture();
  const owner=createMetricSymbolLayout(dataset);
  for(const name of payload.resourceTypes) {
    const metricId=`resource_${name}`,positive=Object.values(payload.states).filter(record=>record.values[metricId]>0);
    const ids=Object.keys(payload.states).filter(id=>payload.states[id].values[metricId]>0).sort();
    for(const [scale,width,height] of [[.2,1024,512],[.135,720,540],[.195,1152,898],[.205,1024,640]]) {
      const result=owner.layout(payload,metricId,{x:scale===.2?2560:2816,y:1280,scale},width,height);
      assert.equal(result.positiveCount,positive.length);assert.equal(result.visibleCount,positive.length);
      assert.deepEqual(result.entries.map(entry=>entry.stateId).sort(),ids);
      assert.equal(result.invalidAnchorCount,0);assert.ok(result.maxRadius<=10);
      assert.equal(result.maxValue,Math.max(...positive.map(record=>record.values[metricId])));
      for(const entry of result.entries) {
        assert.equal(entry.radius,result.legendRadius(entry.value));
        assert.ok(Math.hypot(entry.x-entry.anchorX,entry.y-entry.anchorY)<=30+1e-9);
      }
    }
  }
});

test('real world resource decluttering reduces actual overlap without weakening the safety gap or discarding IDs',()=>{
  const {dataset,payload}=nativeFixture(),owner=createMetricSymbolLayout(dataset);
  // Round 8 had 45/24/16 actual overlapping pairs and 65/33/26 padded pairs.
  for(const [scale,width,height,maxPairs,maxGapPairs,maxCrowded] of [
    [.135,720,540,19,29,19],[.195,1152,898,2,7,9],[.205,1024,640,2,6,8],
  ]) {
    const currentView={x:2816,y:1280,scale},result=owner.layout(payload,metric,currentView,width,height);
    assert.equal(result.visibleCount,171);
    assert.ok(overlappingPairs(result.entries)<=maxPairs);
    assert.ok(overlappingPairs(result.entries,2)<=maxGapPairs,'the original 2px gap is still measured');
    assert.ok(result.crowdedCount<=maxCrowded);
    const duplicate=createMetricSymbolLayout(dataset).layout(payload,metric,currentView,width,height);
    assert.deepEqual(geometry(duplicate),geometry(result));
    const panned=owner.layout(payload,metric,{...currentView,x:2817,y:1281},width,height);
    for(const entry of panned.entries) {
      const previous=result.entries.find(row=>row.stateId===entry.stateId);
      assert.ok(Math.abs(entry.x-previous.x+scale)<1e-9);
      assert.ok(Math.abs(entry.y-previous.y+scale)<1e-9);
    }
  }
});

test('regional resource views remain clear and preserve every on-screen native anchor',()=>{
  const {dataset,payload}=nativeFixture(),owner=createMetricSymbolLayout(dataset);
  for(const [scale,x,y] of [[1.5,2730,845],[3,2690,825]]) {
    const currentView={x,y,scale},width=1152,height=898;
    const result=owner.layout(payload,metric,currentView,width,height);
    assert.equal(overlappingPairs(result.entries),0);assert.equal(result.crowdedCount,0);
    const ids=new Set(result.entries.map(entry=>entry.stateId));
    for(const state of dataset.core.states) {
      if(!(payload.states[state.id].values[metric]>0))continue;
      const x=(state.anchor[0]-currentView.x)*scale+width/2,y=(state.anchor[1]-currentView.y)*scale+height/2;
      if(x>=0&&x<=width&&y>=0&&y<=height)assert.ok(ids.has(String(state.id)));
    }
  }
});
