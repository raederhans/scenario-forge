import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createDocument} from '../src/document/document.js';
import {suggestCountryColor,colorDistance} from '../src/document/countries.js';

// Metadata only: never decode the large province raster for document contracts.
const core=JSON.parse(readFileSync(new URL('../assets/default/core.json',import.meta.url),'utf8'));
const manifest=JSON.parse(readFileSync(new URL('../assets/default/manifest.json',import.meta.url),'utf8'));
const dataset={manifest,core,stateById:new Map(core.states.map(state=>[String(state.id),state])),entityByTag:new Map(core.entities.map(entity=>[entity.tag,entity]))};
const view={x:0,y:0,scale:1}, layers={borders:true,labels:true,cities:false};
const snapshot=doc=>JSON.stringify(doc.serialize(view,layers));

test('FRA core creation is one undo transaction and preserves source, paint, and explicit identity',()=>{
  const doc=createDocument(dataset), originalCore=JSON.stringify(core);
  doc.paintStates(['1'],'#112233'); doc.markSaved();
  const preview=doc.previewTransfer('FRA','COR');
  assert.deepEqual(preview.stateIds,['1','3452','3453']);
  assert.equal(preview.parentBefore,272); assert.equal(preview.parentRemaining,269);
  assert.equal(preview.overrideCount,1); assert.equal(preview.targetAfter,3);
  assert.ok(Object.isFrozen(preview) && Object.isFrozen(preview.stateIds));
  const before=snapshot(doc), ownerRevision=doc.ownerRevision;
  doc.transfer(preview,{name:'Corsica',color:'#3962c5'});
  assert.equal(doc.owner('1'),'COR'); assert.equal(doc.color('1'),'#3962c5');
  assert.ok(doc.ownerRevision>ownerRevision); assert.equal(doc.paint['1'],undefined);
  const after=snapshot(doc); doc.undo(); assert.equal(snapshot(doc),before); assert.equal(doc.dirty,false);
  doc.redo(); assert.equal(snapshot(doc),after);
  assert.equal(JSON.stringify(core),originalCore);
  doc.paintStates(['1'],'#25489b'); assert.equal(doc.owner('1'),'COR','same painted RGB never determines ownership');
});

test('existing IRE receives only ENG core intersection and keeps whole-country color',()=>{
  const doc=createDocument(dataset), ireland=doc.countries().find(c=>c.tag==='IRE');
  doc.paintStates([ireland.stateIds[0]],'#778899');
  const preview=doc.previewTransfer('ENG','IRE');
  assert.equal(preview.stateIds.length,9); assert.equal(preview.targetBefore,30); assert.equal(preview.targetAfter,39);
  const before=snapshot(doc);
  assert.throws(()=>doc.transfer(preview,{color:'#000000'}),/changed separately/);
  assert.equal(snapshot(doc),before);
  doc.transfer(preview);
  assert.equal(doc.countryColor('IRE'),ireland.color);
  assert.equal(doc.paint[ireland.stateIds[0]],'#778899');
  assert.equal(doc.countries().find(c=>c.tag==='IRE').stateCount,39);
});

test('overlapping cores recalculate under current owner and never steal third-owner cores',()=>{
  const doc=createDocument(dataset), stale=doc.previewTransfer('FRA','BGN'), occ=doc.previewTransfer('FRA','OCC');
  assert.equal(stale.stateIds.length,40); assert.equal(occ.stateIds.length,79); assert.equal(occ.otherCoreCount,6);
  const third=(core.states.filter(state=>(state.coreTags||[]).includes('OCC') && state.entityTag!=='FRA')).map(state=>[String(state.id),doc.owner(state.id)]);
  doc.transfer(occ);
  assert.throws(()=>doc.transfer(stale),/Stale/);
  assert.equal(doc.previewTransfer('FRA','BGN').stateIds.length,38);
  for (const [id,owner] of third) assert.equal(doc.owner(id),owner);
});

test('an emptied parent stays registered and later strokes retain country history',()=>{
  const doc=createDocument(dataset), preview=doc.previewTransfer('CHI','PRC');
  assert.equal(preview.stateIds.length,185); assert.equal(preview.parentRemaining,0);
  const parentColor=doc.countryColor('CHI'); doc.transfer(preview);
  const country=doc.countries().find(c=>c.tag==='CHI');
  assert.equal(country.stateCount,0); assert.equal(country.anchor,null); assert.equal(country.bounds,null);
  assert.equal(country.color,parentColor);
  const id=preview.stateIds[0];
  doc.beginPaintStroke('#112233'); doc.paintStrokeStates([id]); doc.endPaintStroke();
  doc.undo(); assert.equal(doc.owner(id),'PRC'); assert.equal(doc.paint[id],undefined);
  doc.undo(); assert.equal(doc.owner(id),'CHI');
  doc.redo(); assert.equal(doc.owner(id),'PRC');
});

test('palette changes retain manual overrides unless explicitly unified, in one undo',()=>{
  const doc=createDocument(dataset), cor=doc.previewTransfer('FRA','COR');
  doc.transfer(cor,{color:'#3962c5'});
  doc.paintStates(['1'],'#123456'); doc.paintStates(['3452'],'#3962c5');
  doc.setCountryColor('COR','#AABBCC');
  assert.equal(doc.color('1'),'#123456'); assert.equal(doc.color('3452'),'#3962c5');
  assert.equal(doc.countries().find(c=>c.tag==='COR').overrideCount,2);
  const before=snapshot(doc);
  doc.setCountryColor('COR','#aabbcc',{overridePaint:true});
  assert.equal(doc.color('1'),'#aabbcc'); assert.equal(doc.paint['3452'],undefined);
  doc.undo(); assert.equal(snapshot(doc),before);
  doc.setCountryColor('FRA','#aabbcc'); assert.equal(doc.countryColor('COR'),'#aabbcc');
  assert.equal(doc.owner('1'),'COR');
});

test('preview scope and revision validation are atomic for painting, forged IDs, and water',()=>{
  const doc=createDocument(dataset), preview=doc.previewTransfer('FRA','COR');
  assert.throws(()=>doc.transfer({...preview,stateIds:['1']}),/scope/);
  doc.beginPaintStroke('#112233'); doc.paintStrokeStates(['1']);
  assert.throws(()=>doc.transfer(preview),/Stale/); doc.cancelPaintStroke();
  assert.throws(()=>doc.previewTransfer('WTR','COR'),/country/);
  assert.throws(()=>doc.previewTransfer('FRA','WTR'),/target/);
  assert.throws(()=>doc.previewTransfer('FRA','qpw'),/target/);
  assert.throws(()=>doc.previewTransfer('FRA','SGN\\n'),/target/);
  assert.ok(doc.candidates('FRA').every(c=>/^[A-Z0-9]{3}$/.test(c.tag) && c.tag!=='WTR'));
});

test('schema 2 roundtrip and strict schema 1 migration keep country edits atomic',()=>{
  const doc=createDocument(dataset);
  doc.transfer(doc.previewTransfer('FRA','COR'),{color:'#3962c5'});
  const payload=doc.serialize(view,layers), restored=createDocument(dataset);
  restored.load(payload); assert.equal(restored.owner('1'),'COR'); assert.equal(restored.dirty,false);
  restored.setCountryColor('COR','#112233'); assert.equal(payload.palette.COR,'#3962c5');
  const before=snapshot(restored), rev=restored.revision;
  const water=core.states.find(state=>state.entityTag==='WTR');
  for (const mutate of [p=>p.owners['999999']='COR',p=>p.owners[water.id]='COR',p=>p.palette.COR='bad',p=>delete p.palette.COR,
    p=>p.createdCountries.COR.source='unknown',p=>p.owners['1']='ZZZ',p=>p.createdCountries.COR.name='']) {
    const bad=structuredClone(payload); mutate(bad); assert.throws(()=>restored.load(bad));
    assert.equal(snapshot(restored),before); assert.equal(restored.revision,rev);
  }
  const v1=structuredClone(payload); v1.schemaVersion=1; delete v1.owners; delete v1.palette; delete v1.createdCountries;
  v1.paint['1']='#3962c5'; restored.load(v1);
  assert.equal(restored.owner('1'),'FRA'); assert.equal(restored.color('1'),'#3962c5');
  assert.deepEqual(restored.serialize(view,layers).owners,{});
});

test('country summaries are detached and original short base tags remain compatible',()=>{
  const small={manifest:{id:'small',revision:'r',coordinateSpace:{width:5,height:5}},
    stateById:new Map([['1',{id:1,entityTag:'A',name:'S',anchor:[1,1],bounds:[0,0,2,2]}]]),entityByTag:new Map([['A',{tag:'A',name:'A',color:'#123456'}]])};
  const doc=createDocument(small); doc.setCountryColor('A','#abcdef');
  const first=doc.countries(); first[0].stateIds.length=0; first[0].name='Altered';
  assert.equal(doc.countries()[0].stateCount,1); assert.equal(doc.countries()[0].name,'A');
});

test('country labels always anchor in a currently owned state after transferring the old anchor region',()=>{
  const states=[{id:1,entityTag:'AAA',name:'Large',anchor:[1,1],bounds:[0,0,2,2],pixelCount:100,coreTags:['COR']},
    {id:2,entityTag:'AAA',name:'Remaining capital',anchor:[4,4],bounds:[3,3,5,5],pixelCount:10,coreTags:['AAA']}];
  const small={manifest:{id:'anchors',revision:'r',coordinateSpace:{width:6,height:6}},
    stateById:new Map(states.map(state=>[String(state.id),state])),
    entityByTag:new Map([['AAA',{tag:'AAA',name:'Parent',color:'#123456',anchor:[1,1],capitalStateId:2}]])};
  const doc=createDocument(small);
  assert.deepEqual(doc.countries()[0].anchor,[1,1]);
  doc.transfer(doc.previewTransfer('AAA','COR'));
  assert.deepEqual(doc.countries().find(country=>country.tag==='AAA').anchor,[4,4]);
  assert.deepEqual(doc.countries().find(country=>country.tag==='COR').anchor,[1,1]);
  doc.undo(); assert.deepEqual(doc.countries()[0].anchor,[1,1]);
});

test('color suggestions are deterministic finite screened variants, including gray',()=>{
  for (const color of ['#25489b','#888888','#000000','#ffffff']) {
    const first=suggestCountryColor(color,'COR'); assert.deepEqual(suggestCountryColor(color,'COR'),first);
    assert.match(first.color,/^#[0-9a-f]{6}$/); assert.notEqual(first.color,color);
    if (!first.conflict) assert.ok(colorDistance(color,first.color)>=12);
    if (color==='#888888' || color==='#000000' || color==='#ffffff') assert.equal(first.color.slice(1,3),first.color.slice(3,5));
  }
});
