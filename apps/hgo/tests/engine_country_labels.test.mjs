import test from 'node:test';
import assert from 'node:assert/strict';
import {createLabelLayout} from '../src/render/labels.js';

test('country labels follow current revision, hide zero-state countries and reuse the static index',()=>{
  const dataset={core:{states:[{id:1,name:'State',anchor:[50,50],pixelCount:1}],
    entities:[{tag:'AAA',name:'Original',anchor:[50,50]}]},places:[]};
  let revision=0,calls=0;
  let countries=[{tag:'AAA',name:'Current',stateCount:1,anchor:[50,50],pixelCount:1},
    {tag:'BBB',name:'Empty',stateCount:0,anchor:[50,50]},
    {tag:'WTR',name:'Water',stateCount:1,anchor:[50,50]}];
  const document={labels:{},get ownerRevision(){return revision;},countries(){calls++;return countries;}};
  const owner=createLabelLayout(dataset),layers={labels:true,cities:false,labelDensity:'medium'};
  const view={x:50,y:50,scale:.1};
  const first=owner.layout(document,view,layers,200,200);
  assert.deepEqual(first.map(e=>[e.id,e.text]),[['country:AAA','Current']]);
  for(let i=0;i<20;i++)owner.layout(document,{...view,x:50+i*.01},layers,200,200);
  assert.equal(calls,1,'pointer/view changes do not rebuild country metadata');
  countries=[{tag:'AAA',name:'Former',stateCount:0,anchor:[50,50]},
    {tag:'BBB',name:'Created',stateCount:1,anchor:[700,50],pixelCount:1}];revision++;
  const next=owner.layout(document,{x:700,y:50,scale:.1},layers,200,200);
  assert.deepEqual(next.map(e=>[e.id,e.text,e.x]),[['country:BBB','Created',100]]);
  assert.equal(calls,2);
  countries=[{...countries[1],name:'Renamed'}];revision++;
  assert.equal(owner.layout(document,{x:700,y:50,scale:.1},layers,200,200)[0].text,'Renamed');
  // A new document at the same revision must not inherit another document's index.
  const reopened={labels:{},ownerRevision:revision,countries:()=>[{tag:'AAA',name:'Reopened',stateCount:1,anchor:[50,50]}]};
  assert.equal(owner.layout(reopened,view,layers,200,200)[0].text,'Reopened');
});

test('legacy synthetic documents still label original entities without a country API',()=>{
  const dataset={core:{states:[],entities:[{tag:'AAA',name:'Original',anchor:[50,50]},
    {tag:'WTR',name:'Water',kind:'water',anchor:[50,50]}]},places:[]};
  const entries=createLabelLayout(dataset).layout({labels:{}},{x:50,y:50,scale:.1},
    {labels:true,cities:false},200,200);
  assert.deepEqual(entries.map(e=>e.text),['Original']);
});
