import test from 'node:test';
import assert from 'node:assert/strict';
import {createHgoSession} from '../src/session.js';

function harness() {
  const created=[],events=[],callbacks=[];let serial=0;
  function graphics(){return new Proxy({NO_ERROR:0,getParameter:()=>8192,getShaderParameter:()=>true,getProgramParameter:()=>true,getError:()=>0,
    getExtension:()=>({loseContext(){events.push('release-context');}})},
  {get:(t,k)=>k in t?t[k]:k.toUpperCase()===k?++serial:()=>({})});}
  const win={devicePixelRatio:1,requestAnimationFrame:()=>1,cancelAnimationFrame(){},addEventListener(){},removeEventListener(){}};
  const ownerDocument={defaultView:win,createElement(){
    const gl=graphics(),ctx={setTransform(){},clearRect(){},drawImage(){events.push('copy-map');}};
    const c={width:0,height:0,getContext:type=>type==='2d'?ctx:gl,toBlob(callback){events.push('encode');callbacks.push(callback);}};
    created.push(c);return c;
  }};
  const canvas={width:100,height:100,clientWidth:100,clientHeight:100,ownerDocument,getContext:()=>graphics(),addEventListener(){},removeEventListener(){},hasPointerCapture:()=>false};
  const overlayCanvas={width:100,height:100,getContext:()=>({clearRect(){}})};
  const state={id:1,name:'One',entityTag:'A',anchor:[.5,.5],pixelCount:1};
  const entity={tag:'A',color:'#123456'};
  const dataset={manifest:{id:'test',revision:'1',coordinateSpace:{width:1,height:1}},core:{states:[state],entities:[entity],provinceIds:[null,1],provinceStateIds:[null,1]},ids:new Uint16Array([1]),stateById:new Map([['1',state]]),entityByTag:new Map([['A',entity]]),places:[]};
  const session=createHgoSession({canvas,overlayCanvas,dataset});session.setLayer('labels',false);session.setLayer('cities',false);
  return {session,created,events,callbacks};
}

test('PNG uses two canvases, releases temporary GPU before encoding, and serializes exports',async()=>{
  const h=harness(),before=h.session.serializeDocument();
  const promise=h.session.exportPng({width:20,height:10});
  assert.equal(h.created.length,2);
  assert.deepEqual(h.events,['copy-map','release-context','encode']);
  assert.equal(h.created[0].width,1);
  await assert.rejects(h.session.exportPng(),/already in progress/);
  const blob=new Blob(['png'],{type:'image/png'});h.callbacks.shift()(blob);
  assert.equal(await promise,blob);
  assert.ok(h.created.every(c=>c.width===1&&c.height===1));
  assert.deepEqual(h.session.serializeDocument(),before);h.session.dispose();
});

test('failed PNG encoding releases canvas and unlocks later exports',async()=>{
  const h=harness(),first=h.session.exportPng();h.callbacks.shift()(null);
  await assert.rejects(first,/encoding failed/);
  assert.ok(h.created.every(c=>c.width===1&&c.height===1));
  const second=h.session.exportPng();h.callbacks.shift()(new Blob(['retry']));await second;
  h.session.dispose();
});
