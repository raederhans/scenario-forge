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

test('resource exclusion boxes prevent state, city and country labels from covering quantities',()=>{
  const dataset=fixture(3),owner=createLabelLayout(dataset),view={x:120,y:50,scale:1};
  const doc={labels:{0:'First',1:'Middle',2:'Last'}},reserved=[[140,140,160,160]];
  const entries=owner.layout(doc,view,layers,300,300,undefined,null,reserved);
  assert.ok(entries.length>0);
  assert.ok(entries.every(entry=>entry.boxes.every(box=>!overlap(box,reserved[0]))));
  assert.equal(entries.some(entry=>entry.text==='Middle'),false);
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

test('zoom redraws reuse text measurements without changing label placement', () => {
  const dataset=fixture(40), owner=createLabelLayout(dataset), reference=createLabelLayout(dataset);
  const document={labels:Object.fromEntries(dataset.core.states.map(state=>[state.id,state.name]))};
  let measurements=0;
  const measure=(text,size)=>text.length*size*.6;
  const ctx={setTransform(){},clearRect(){},strokeText(){},fillText(){},
    measureText(text){measurements++;return {width:measure(text,parseFloat(this.font.split(' ')[1]))};}};
  const canvas={width:1600,height:400,getContext:()=>ctx};
  for(let frame=0;frame<20;frame++){
    const view={x:715+frame,y:90,scale:1+frame*.002};
    const actual=owner.draw(canvas,document,view,layers);
    assert.deepEqual(actual,reference.layout(document,view,layers,1600,400,measure));
  }
  assert.equal(measurements,40,'each unchanged font/text pair is measured once across zoom frames');
});

test('text measurement cache stays bounded and respects edits, fonts and canvas contexts', () => {
  const owner=createLabelLayout(fixture(1)), document={labels:{0:'S0'}};
  const view={x:50,y:50,scale:1};
  let measurements=0;
  const context=width=>({setTransform(){},clearRect(){},strokeText(){},fillText(){},
    measureText(){measurements++;return {width:width+(this.font.startsWith('600')?10:0)};}});
  let ctx=context(20);
  const canvas={width:400,height:200,getContext:()=>ctx};
  const draw=()=>owner.draw(canvas,document,view,layers)[0];
  assert.equal(draw().boxes[0][2]-draw().boxes[0][0],36);
  delete document.labels[0];
  assert.equal(draw().boxes[0][2]-draw().boxes[0][0],26,'normal and bold widths must not be mixed');
  for(let i=0;i<1100;i++){
    document.labels[0]=`Renamed ${i}`;
    assert.equal(draw().text,document.labels[0]);
  }
  document.labels[0]='S0';
  const before=measurements;
  draw();
  assert.equal(measurements,before+1,'old names must be evicted after many edits');
  ctx=context(70);
  assert.equal(draw().boxes[0][2]-draw().boxes[0][0],86,'another canvas context must be measured afresh');
});

test('identical names in country, state and city fonts retain their own widths',()=>{
  const dataset=fixture(1),document={labels:{0:'S0'}};
  dataset.core.entities=[{tag:'AAA',name:'S0',anchor:[50,50]}];
  dataset.places=[{stateId:0,name:'S0',x:50,y:50,isCapital:true}];
  const owner=createLabelLayout(dataset),view={x:50,y:50,scale:.1};
  const ctx={setTransform(){},clearRect(){},strokeText(){},fillText(){},beginPath(){},arc(){},fill(){},stroke(){},
    measureText(){return {width:parseFloat(this.font.split(' ')[1])};}};
  const canvas={width:400,height:200,getContext:()=>ctx};
  const check=(options,kind,width)=>{
    const [entry]=owner.draw(canvas,document,view,options);
    assert.equal(entry.kind,kind);assert.equal(entry.boxes[0][2]-entry.boxes[0][0],width+6);
  };
  check({...layers,cities:false},'state',12);
  delete document.labels[0];
  check({...layers,cities:false},'country',13);
  check({...layers,labels:false},'city',11);
});
