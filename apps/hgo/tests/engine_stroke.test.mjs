import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocument} from '../src/document/document.js';

function fixture() {
  return {manifest:{id:'stroke-test',revision:'r1',coordinateSpace:{width:10,height:10}},
    stateById:new Map(['1','2','3'].map(id => [id,{entityTag:'AAA'}])),
    entityByTag:new Map([['AAA',{color:'#abcdef'}]])};
}
const view = {x:0,y:0,scale:1};
const layers = {borders:true,labels:true,cities:false};

test('incremental stroke deduplicates states, keeps its map, and commits one undo entry', () => {
  const dataset = fixture(), doc = createDocument(dataset);
  doc.label('1','Kept label'); doc.markSaved();
  doc.beginPaintStroke('#AA1122');
  const map = doc.paint;
  assert.equal(doc.paintStrokeStates([1,1]),true);
  assert.equal(doc.paintStrokeStates(['1']),false);
  assert.equal(doc.paintStrokeStates(['2']),true);
  assert.equal(doc.paint,map,'pointer updates must not copy the paint map');
  assert.equal(doc.color('1'),'#aa1122');
  assert.equal(doc.dirty,true);
  assert.equal(doc.endPaintStroke(),true);
  doc.undo();
  assert.deepEqual(doc.paint,{});
  assert.equal(doc.labels['1'],'Kept label');
  assert.equal(doc.dirty,false);
  doc.redo();
  assert.deepEqual(doc.paint,{'1':'#aa1122','2':'#aa1122'});
  assert.equal(dataset.entityByTag.get('AAA').color,'#abcdef');
});

test('cancel and no-op stroke preserve redo and saved identity', () => {
  const doc = createDocument(fixture());
  doc.paintStates(['1'],'#112233'); doc.markSaved();
  doc.paintStates(['2'],'#445566'); doc.undo();
  doc.beginPaintStroke('#112233');
  assert.equal(doc.paintStrokeStates(['1']),false);
  assert.equal(doc.endPaintStroke(),false);
  assert.equal(doc.canRedo,true);
  doc.beginPaintStroke('#778899'); doc.paintStrokeStates(['1','3']);
  assert.equal(doc.cancelPaintStroke(),true);
  assert.deepEqual(doc.paint,{'1':'#112233'});
  assert.equal(doc.dirty,false);
  assert.equal(doc.canRedo,true);
  assert.equal(doc.redo(),true);
  assert.equal(doc.color('2'),'#445566');
});

test('stroke validation is atomic, and load detaches payload and pending history', () => {
  const doc = createDocument(fixture());
  assert.throws(() => doc.beginPaintStroke('#bad'),/Invalid paint color/);
  doc.beginPaintStroke('#AABBCC');
  assert.throws(() => doc.beginPaintStroke('#112233'),/already active/);
  assert.throws(() => doc.paintStrokeStates(['1','missing']),/Unknown state/);
  assert.deepEqual(doc.paint,{});
  doc.paintStrokeStates(['1']);
  const payload = doc.serialize(view,layers);
  const bad = structuredClone(payload); bad.view.scale = 0;
  assert.throws(() => doc.load(bad),/Invalid project view/);
  assert.equal(doc.cancelPaintStroke(),true,'failed load must preserve the active transaction');
  doc.beginPaintStroke('#112233'); doc.paintStrokeStates(['2']);
  doc.load(payload);
  assert.equal(doc.endPaintStroke(),false);
  assert.equal(doc.canUndo,false);
  assert.equal(doc.dirty,false);
  doc.beginPaintStroke('#445566'); doc.paintStrokeStates(['1']); doc.endPaintStroke();
  assert.equal(payload.paint['1'],'#aabbcc','loaded input must remain immutable');
  doc.undo();
  assert.equal(doc.color('1'),'#aabbcc');
});

test('stroke history retains the existing 200-entry bound', () => {
  const doc = createDocument(fixture());
  for (let i=1;i<=205;i++) {
    doc.beginPaintStroke(`#${i.toString(16).padStart(6,'0')}`);
    doc.paintStrokeStates(['1']); doc.endPaintStroke();
  }
  let undone = 0;
  while (doc.undo()) undone++;
  assert.equal(undone,200);
  assert.equal(doc.color('1'),'#000005');
});
