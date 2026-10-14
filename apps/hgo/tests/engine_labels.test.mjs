import test from 'node:test';
import assert from 'node:assert/strict';
import {createLabelLayout} from '../src/render/labels.js';

const document = {labels:{}};
const layers = {labels:true,cities:true,labelDensity:'medium'};
const overlap = (a,b) => a[0]<b[2] && a[2]>b[0] && a[1]<b[3] && a[3]>b[1];
function fixture(count=400) {
  return {core:{entities:[],states:Array.from({length:count},(_,id) => ({
    id,name:`S${id}`,anchor:[(id%20)*70+50,Math.floor(id/20)*70+50],pixelCount:100000,
  }))},places:[]};
}

test('all label kinds share bounded density budgets and stable repeated layouts', () => {
  const dataset=fixture(), view={x:715,y:715,scale:1};
  const namedDocument={labels:Object.fromEntries(dataset.core.states.map(state=>[state.id,state.name]))};
  for (const [density,budget] of [['low',96],['medium',180],['high',300]]) {
    const owner=createLabelLayout(dataset), options={...layers,labelDensity:density};
    const first=owner.layout(namedDocument,view,options,1500,1500);
    assert.equal(first.length,budget);
    assert.deepEqual(owner.layout(namedDocument,view,options,1500,1500).map(e=>e.id),first.map(e=>e.id));
  }
});

test('city point and text collide with every other kind and reserve separate boxes', () => {
  const dataset={core:{entities:[{tag:'AAA',name:'Nation',anchor:[100,100]}],states:[
    {id:1,name:'State',anchor:[100,100],pixelCount:100000},
  ]},places:[{name:'Capital',stateId:1,x:100,y:100,isCapital:true},
    {name:'Nearby',stateId:1,x:102,y:100}]};
  const entries=createLabelLayout(dataset).layout(document,{x:100,y:100,scale:1},layers,300,300);
  assert.equal(entries[0].text,'Capital');
  assert.equal(entries[0].markerRadius,3.5);
  assert.equal(entries.length,1);
  assert.equal(overlap(entries[0].boxes[0],entries[0].boxes[1]),false);
});

test('explicit state names outrank real capitals without fabricating a capital flag', () => {
  const dataset={core:{entities:[],states:[{id:1,name:'State',anchor:[100,100],pixelCount:1}]},
    places:[{name:'Capital',stateId:1,x:100,y:100,isCapital:true}]};
  const entries=createLabelLayout(dataset).layout({labels:{1:'My state'}},{x:100,y:100,scale:.1},layers,300,300);
  assert.equal(entries[0].text,'My state');
  assert.equal(entries[0].kind,'state');
  assert.equal(entries[0].markerRadius,0);
  assert.equal(entries.length,1);
});

test('mixed city, country and state layouts have no overlapping accepted boxes', () => {
  const dataset=fixture(40);
  dataset.core.entities=Array.from({length:20},(_,id)=>({tag:`E${id}`,name:`Nation ${id}`,anchor:[id*70+50,130]}));
  dataset.places=Array.from({length:40},(_,id)=>({name:`City ${id}`,stateId:id,
    x:(id%20)*70+50,y:Math.floor(id/20)*70+55,isCapital:id%4===0}));
  const entries=createLabelLayout(dataset).layout(document,{x:715,y:110,scale:1},layers,1500,300);
  assert.ok(new Set(entries.map(entry=>entry.kind)).size>=2,'fixture must exercise mixed classes');
  const boxes=entries.flatMap(entry=>entry.boxes);
  for (let i=0;i<boxes.length;i++) for (let j=i+1;j<boxes.length;j++) {
    assert.equal(overlap(boxes[i],boxes[j]),false,`accepted boxes ${i} and ${j} overlap`);
  }
});

test('zoom eligibility staggers labels around former shared thresholds', () => {
  const dataset=fixture(400);
  dataset.core.states=[];
  dataset.places=Array.from({length:400},(_,id) => ({name:`C${id}`,stateId:id,
    x:(id%20)*90+50,y:Math.floor(id/20)*90+50}));
  const idsAt=scale => createLabelLayout(dataset).layout(document,{x:900,y:900,scale},
    {...layers,labelDensity:'high'},2000,2000).map(e=>e.id);
  const before=idsAt(.699), after=idsAt(.7);
  assert.ok(before.length>0 && before.length<300);
  const newIds=after.filter(id=>!before.includes(id));
  assert.ok(newIds.length<5,'a tiny zoom change must not release all ordinary cities');
  const owner=createLabelLayout(dataset);
  const first=owner.layout(document,{x:900,y:900,scale:.7},layers,2000,2000);
  const jitter=owner.layout(document,{x:900,y:900,scale:.699},layers,2000,2000);
  assert.deepEqual(jitter.map(e=>e.id),first.map(e=>e.id),'hysteresis retains accepted labels during tiny zoom jitter');
});

test('hidden layers yield no markers and draw can preserve an existing map canvas', () => {
  const owner=createLabelLayout(fixture(1));
  assert.deepEqual(owner.layout(document,{x:50,y:50,scale:1},{labels:false,cities:false},100,100),[]);
  let clears=0;
  const ctx={setTransform(){},clearRect(){clears++;},measureText:()=>({width:10}),strokeText(){},fillText(){}};
  owner.draw({width:100,height:100,getContext:()=>ctx},document,{x:50,y:50,scale:1},layers,1,{clear:false});
  assert.equal(clears,0);
  assert.equal(ctx.globalAlpha,1);
});
