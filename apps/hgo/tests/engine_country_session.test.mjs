import test from 'node:test';
import assert from 'node:assert/strict';
import {createHgoSession} from '../src/session.js';
import {validateCore} from '../src/data/dataset.js';

function harness(){
  const states=[['FRA',['COR']],['FRA',['COR','OCC']],['FRA',['OCC']],['ENG',['COR']]].map(([entityTag,coreTags],i)=>({id:i+1,name:`State ${i+1}`,entityTag,coreTags,anchor:[i+.5,.5],bounds:[i,0,i+1,1],pixelCount:1}));
  const core={schemaVersion:1,states,entities:[{tag:'FRA',name:'France',color:'#25489b'},{tag:'ENG',name:'Britain',color:'#961a0a'}],provinceIds:[null,1,2,3,4],provinceStateIds:[null,1,2,3,4]};
  const dataset={manifest:{id:'session-countries',revision:'1',coordinateSpace:{width:4,height:1}},core,ids:new Uint16Array([1,2,3,4]),...validateCore(core,4,1)};
  const handlers=new Map(),frames=new Map(),timers=new Map(),captures=new Set();let serial=0;
  const gl=new Proxy({NO_ERROR:0,getParameter:()=>8192,getShaderParameter:()=>true,getProgramParameter:()=>true,getError:()=>0,getExtension:()=>null},{get:(t,k)=>k in t?t[k]:k.toUpperCase()===k?++serial:()=>({})});
  const win={devicePixelRatio:1,requestAnimationFrame:fn=>{const n=++serial;frames.set(n,fn);return n;},cancelAnimationFrame:n=>frames.delete(n),setTimeout:fn=>{const n=++serial;timers.set(n,fn);return n;},clearTimeout:n=>timers.delete(n),addEventListener:(n,f)=>handlers.set('win:'+n,f),removeEventListener:n=>handlers.delete('win:'+n)};
  const canvas={width:400,height:200,clientWidth:400,clientHeight:200,ownerDocument:{defaultView:win},getContext:()=>gl,getBoundingClientRect:()=>({left:0,top:0}),addEventListener:(n,f)=>handlers.set(n,f),removeEventListener:n=>handlers.delete(n),setPointerCapture:n=>captures.add(n),hasPointerCapture:n=>captures.has(n),releasePointerCapture:n=>captures.delete(n)};
  const context=new Proxy({measureText:()=>({width:10})},{get:(t,k)=>t[k]||(()=>{})});
  const session=createHgoSession({canvas,overlayCanvas:{width:400,height:200,getContext:()=>context},dataset});
  return {session,click(id){session.focusState(id);const {view}=session.serializeDocument(),x=200+(id-.5-view.x)*view.scale,y=100+(.5-view.y)*view.scale;for(const name of ['pointerdown','pointerup'])handlers.get(name)({button:0,pointerId:1,clientX:x,clientY:y,preventDefault(){}});},flush(){for(const f of timers.values())f();timers.clear();}};
}

test('session country scope and picker follow transferred ownership without changing it through paint',()=>{
  const h=harness(),s=h.session;
  const preview=s.previewTransfer('FRA','COR');assert.equal(preview.stateIds.length,2);
  s.commitTransfer(preview,{color:'#3962c5',name:'Corsica',overridePaint:true});
  assert.equal(s.listCountries('COR')[0].stateCount,2);
  assert.equal(s.listCountries('FRA')[0].stateCount,1);
  assert.equal(s.pickColor(1),'#3962c5');
  assert.equal(s.search('Corsica').length,0); // State names remain their own labels.
  assert.equal(s.search('COR').length,2);
  s.setPaintScope('country');s.setColor('#abcdef');s.setTool('paint');h.click(3);h.flush();
  let p=s.serializeDocument();assert.deepEqual(p.paint,{'3':'#abcdef'});assert.deepEqual(p.owners,{'1':'COR','2':'COR'});
  h.click(1);h.flush();p=s.serializeDocument();assert.equal(p.paint['1'],'#abcdef');assert.equal(p.paint['2'],'#abcdef');assert.equal(p.paint['4'],undefined);
  s.undo();assert.deepEqual(s.serializeDocument().paint,{'3':'#abcdef'});assert.deepEqual(s.serializeDocument().owners,{'1':'COR','2':'COR'});
  s.redo();assert.equal(s.pickColor(2),'#abcdef');s.dispose();
});

test('stale transfer preview rejects after edits; load and undo refresh current country groups',()=>{
  const {session:s}=harness(),legacy=s.serializeDocument();legacy.schemaVersion=1;delete legacy.owners;delete legacy.palette;delete legacy.createdCountries;
  const stale=s.previewTransfer('FRA','COR');s.setCountryColor('FRA','#112233');
  assert.throws(()=>s.commitTransfer(stale),/stale|changed|preview/i);assert.deepEqual(s.serializeDocument().owners,{});
  const fresh=s.previewTransfer('FRA','COR');s.commitTransfer(fresh,{color:'#3962c5'});s.undo();assert.equal(s.listCountries('FRA')[0].stateCount,3);
  s.redo();s.setSelection([1]);s.setPaintScope('country');s.paintSelection('#abcd12');assert.equal(Object.keys(s.serializeDocument().paint).length,2);
  const generation=s.getViewModel().projectGeneration;s.loadDocument(legacy);assert.equal(s.getViewModel().projectGeneration,generation+1);
  s.setSelection([1]);s.paintSelection('#abc123');assert.equal(Object.keys(s.serializeDocument().paint).length,3);
  assert.equal(s.serializeDocument().schemaVersion,2);s.dispose();
});
