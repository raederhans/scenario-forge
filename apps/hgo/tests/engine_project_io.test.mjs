import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocument} from '../src/document/document.js';

const dataset={manifest:{id:'project-io',revision:'r1',coordinateSpace:{width:10,height:10}},
  stateById:new Map([['1',{id:1,entityTag:'AAA',coreTags:['COR']}],['2',{id:2,entityTag:'AAA'}]]),
  entityByTag:new Map([['AAA',{tag:'AAA',color:'#123456'}]])};
const view={x:1,y:2,scale:1}, layers={borders:true,labels:true,cities:false};
function edited() {
  const doc=createDocument(dataset);
  doc.transfer(doc.previewTransfer('AAA','COR'),{name:'Corsica',color:'#abcdef'});
  doc.paintStates(['1'],'#abcdef'); // An override equal to the palette still has meaning.
  doc.label('1','手动标签');
  return doc;
}

test('schema 2 string and object roundtrips retain explicit paint and country identity',()=>{
  const source=edited(), payload=source.serialize(view,layers);
  for (const input of [payload,JSON.stringify(payload)]) {
    const restored=createDocument(dataset), loaded=restored.load(input);
    assert.deepEqual(loaded.view,view);
    assert.deepEqual(restored.serialize(view,layers),payload);
    assert.equal(restored.dirty,false); assert.equal(restored.canUndo,false);
    restored.setCountryColor('COR','#112233');
    assert.equal(restored.color('1'),'#abcdef');
    assert.equal(restored.owner('1'),'COR');
    restored.beginPaintStroke('#445566'); restored.paintStrokeStates(['1']); restored.endPaintStroke();
    assert.equal(payload.paint['1'],'#abcdef');
    restored.undo(); assert.equal(restored.color('1'),'#abcdef');
  }
  const restored=createDocument(dataset); restored.load(payload);
  payload.paint['1']='#000000'; payload.labels['1']='changed';
  payload.owners['1']='AAA'; payload.palette.COR='#000000'; payload.createdCountries.COR.name='changed';
  assert.deepEqual(restored.serialize(view,layers),source.serialize(view,layers));
});

test('legacy schema 1 string preserves manual paint and labels without inferring ownership',()=>{
  const legacy='{"format":"scenario-forge-hgo","schemaVersion":1,"dataset":{"id":"project-io","revision":"r1"},"coordinateSpace":"hgo-pixel","paint":{"1":"#ABCDEF"},"labels":{"1":"旧存档"},"view":{"x":1,"y":2,"scale":1},"layers":{"borders":true,"labels":true,"cities":false}}';
  const doc=edited(); doc.load(legacy);
  const saved=doc.serialize(view,layers);
  assert.equal(saved.schemaVersion,2); assert.deepEqual(saved.paint,{'1':'#ABCDEF'});
  assert.deepEqual(saved.labels,{'1':'旧存档'}); assert.equal(doc.owner('1'),'AAA');
  for (const field of ['owners','palette','createdCountries']) assert.deepEqual(saved[field],{});
  assert.equal(doc.dirty,false); assert.equal(doc.canUndo,false);
});

test('invalid string imports preserve pending stroke, history and country state atomically',()=>{
  const doc=edited(), payload=doc.serialize(view,layers);
  doc.beginPaintStroke('#112233'); doc.paintStrokeStates(['2']);
  const before=doc.serialize(view,layers), revision=doc.revision, ownerRevision=doc.ownerRevision;
  for (const mutate of [p=>p.paint['999']='#abcdef',p=>p.labels['1']='x'.repeat(201),
    p=>p.view.scale=0,p=>p.layers.labels='yes',p=>delete p.palette.COR,
    p=>p.owners['1']='ZZZ',p=>p.createdCountries.COR.source='bad',p=>p.schemaVersion=1]) {
    const bad=structuredClone(payload); mutate(bad);
    assert.throws(()=>doc.load(JSON.stringify(bad)));
    assert.deepEqual(doc.serialize(view,layers),before);
    assert.equal(doc.revision,revision); assert.equal(doc.ownerRevision,ownerRevision);
  }
  assert.equal(doc.cancelPaintStroke(),true);
  assert.deepEqual(doc.serialize(view,layers),payload); assert.equal(doc.canUndo,true);
});
