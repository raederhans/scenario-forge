import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCore} from '../src/data/dataset.js';
import {createHgoSession} from '../src/session.js';
import {createPaintScopes,tracePaintStates} from '../src/interaction/paint.js';

function fixture(){
  const core={schemaVersion:1,provinceIds:[null,10,20,30],provinceStateIds:[null,1,2,3],
    entities:[{tag:'A',color:'#123456'},{tag:'WTR',color:'#345678'}],
    states:[{id:1,name:'One',entityTag:'A',coreTags:['RELEASE'],anchor:[.5,.5]},
      {id:2,name:'Two',entityTag:'A',coreTags:['OTHER'],anchor:[1.5,.5]},
      {id:3,name:'Sea',entityTag:'WTR',anchor:[3.5,.5]}]};
  return {manifest:{id:'test',revision:'1',coordinateSpace:{width:4,height:2}},core,
    ids:new Uint16Array([1,2,2,3,1,2,2,3]),...validateCore(core,4,2)};
}
function harness(onChange=()=>{}){
  const handlers=new Map(),timers=new Map(),frames=new Map(),captures=new Set();let serial=0;
  const draws=[];
  const gl=new Proxy({NO_ERROR:0,getParameter:()=>8192,getShaderParameter:()=>true,getProgramParameter:()=>true,getError:()=>0,getExtension:()=>null,drawArrays:(...args)=>draws.push(args)},
    {get:(t,k)=>k in t?t[k]:k.toUpperCase()===k?++serial:()=>({})});
  const win={devicePixelRatio:1,requestAnimationFrame:fn=>{const id=++serial;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id),
    setTimeout:fn=>{const id=++serial;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
    addEventListener:(n,f)=>handlers.set('win:'+n,f),removeEventListener:n=>handlers.delete('win:'+n)};
  const ctx=new Proxy({measureText:()=>({width:1})},{get:(t,k)=>t[k]||(()=>{})});
  const canvas={width:400,height:200,clientWidth:400,clientHeight:200,ownerDocument:{defaultView:win},getContext:()=>gl,
    getBoundingClientRect:()=>({left:0,top:0}),setPointerCapture:id=>captures.add(id),hasPointerCapture:id=>captures.has(id),releasePointerCapture:id=>captures.delete(id),
    addEventListener:(n,f)=>handlers.set(n,f),removeEventListener:n=>handlers.delete(n)};
  const overlayCanvas={width:400,height:200,getContext:()=>ctx};
  const models=[];
  const session=createHgoSession({canvas,overlayCanvas,dataset:fixture(),onChange:vm=>{models.push(vm);onChange(vm);}});
  const {view}=session.serializeDocument();
  function event(name,x,y,extra={}){handlers.get(name)({button:0,pointerId:1,clientX:200+(x-2)*view.scale,clientY:100+(y-1)*view.scale,preventDefault(){},...extra});}
  return {session,event,handlers,frames,timers,models,draws,finishClicks(){for(const fn of timers.values())fn();timers.clear();}};
}
test('scope follows original owner, never cores or worldwide water; trace visits narrow intervening states',()=>{
  const d=fixture(),scope=createPaintScopes(d);
  assert.deepEqual(scope(1,'country'),['1','2']);assert.deepEqual(scope(3,'country'),['3']);
  assert.deepEqual(tracePaintStates(d,[-100,.5],[100,.5]),['1','2','3']);
  assert.deepEqual(tracePaintStates(d,[0,-1],[3,-1]),[]);
  const wide={...d,manifest:{coordinateSpace:{width:9000,height:1}},ids:new Uint16Array(9000).fill(1)};
  wide.ids[8123]=2;
  assert.deepEqual(tracePaintStates(wide,[-1,.5],[10000,.5]),['1','2']);
});
test('drag paints crossed states once, preserves view, and undo/redo cover the entire stroke',()=>{
  const h=harness(),s=h.session,before=s.serializeDocument().view;
  s.setTool('paint');s.setColor('#abcdef');h.event('pointerdown',.5,.5);h.event('pointermove',3.5,.5);h.event('pointerup',3.5,.5);
  assert.deepEqual(s.serializeDocument().paint,{'1':'#abcdef','2':'#abcdef','3':'#abcdef'});
  assert.deepEqual(s.serializeDocument().view,before);
  s.undo();assert.deepEqual(s.serializeDocument().paint,{});assert.equal(s.getViewModel().canUndo,false);
  s.redo();assert.equal(Object.keys(s.serializeDocument().paint).length,3);s.dispose();
});
test('double click replaces uncommitted click previews with one owner-country undo record',()=>{
  const h=harness(),s=h.session;s.setTool('paint');s.setColor('#aabbcc');
  for(let i=0;i<2;i++){h.event('pointerdown',.5,.5);h.event('pointerup',.5,.5);}
  h.event('dblclick',.5,.5);assert.deepEqual(s.serializeDocument().paint,{'1':'#aabbcc','2':'#aabbcc'});
  h.finishClicks();s.undo();assert.deepEqual(s.serializeDocument().paint,{});assert.equal(s.getViewModel().canUndo,false);s.dispose();
});
test('pick reads paint storage; cancelled brush is atomic; pan and disposal preserve interaction boundaries',()=>{
  const h=harness(),s=h.session;s.paintStates([1],'#FaCe12');assert.equal(s.pickColor(1),'#face12');
  s.setTool('pick');h.event('pointerdown',.5,.5);h.event('pointerup',.5,.5);assert.equal(s.getViewModel().color,'#face12');
  s.setTool('paint');s.setColor('#abcdef');h.event('pointerdown',.5,.5);h.event('pointermove',3.5,.5);
  for(const fn of h.frames.values())fn();h.frames.clear();h.event('pointercancel',3.5,.5);
  assert.deepEqual(s.serializeDocument().paint,{'1':'#face12'});
  const before=s.serializeDocument().view;s.setTool('pan');h.event('pointerdown',.5,.5);h.event('pointermove',1.5,.5);h.event('pointerup',1.5,.5);
  assert.notEqual(s.serializeDocument().view.x,before.x);assert.equal(Object.keys(s.serializeDocument().paint).length,1);
  s.dispose();assert.equal(h.handlers.size,0);assert.equal(h.timers.size,0);
});
test('invalid public actions never commit a pending click preview',async()=>{
  const h=harness(),s=h.session;s.setTool('paint');h.event('pointerdown',.5,.5);h.event('pointerup',.5,.5);
  for(const action of [()=>s.setSelection([999]),()=>s.paintStates([999],'#abcdef'),()=>s.paintSelection('bad'),()=>s.focusState(999),()=>s.setLayer('bad',true),()=>s.setLabel(999,'label'),()=>s.zoomBy(-1)]){
    assert.throws(action);assert.equal(s.getViewModel().canUndo,false);
  }
  await assert.rejects(s.exportPng({width:0}));assert.equal(s.getViewModel().canUndo,false);
  s.resetSelection();assert.deepEqual(s.serializeDocument().paint,{});s.dispose();
});
test('serializing a click preview publishes its committed undo state',()=>{
  const h=harness();h.session.setTool('paint');h.event('pointerdown',.5,.5);h.event('pointerup',.5,.5);
  assert.equal(h.models.at(-1).canUndo,false);
  assert.equal(Object.keys(h.session.serializeDocument().paint).length,1);
  assert.equal(h.models.at(-1).canUndo,true);h.session.dispose();
});

function flushFrame(h){const callbacks=[...h.frames.values()];h.frames.clear();for(const fn of callbacks)fn();}

test('wheel bursts publish one latest view per frame while state and anchored zoom stay immediate',()=>{
  const h=harness(),s=h.session;flushFrame(h);h.models.length=0;
  const before=s.serializeDocument().view,anchor=[-before.scale,-.5*before.scale];
  for(let i=0;i<60;i++)h.event('wheel',1,.5,{deltaY:1});
  assert.equal(h.frames.size,1);
  const after=s.serializeDocument().view;
  assert.ok(Math.abs(after.scale-before.scale*Math.exp(-.003*60))<1e-9);
  assert.ok(Math.abs(after.x+anchor[0]/after.scale-1)<1e-9);
  assert.ok(Math.abs(after.y+anchor[1]/after.scale-.5)<1e-9);
  assert.equal(s.getViewModel().dirty,true,'unsaved view must be visible before the next frame');
  flushFrame(h);
  assert.equal(h.models.length,1,'60 wheel events must share one UI refresh');
  assert.equal(h.models[0].zoom,after.scale);
  assert.equal(h.frames.size,0);
  s.dispose();
});

test('synchronous actions consume pending wheel notifications without a duplicate next frame',()=>{
  const h=harness(),s=h.session;flushFrame(h);
  for(const action of [()=>s.zoomBy(.9),()=>s.fit(),()=>s.setSelection([1]),
    ()=>s.setTool('pick'),()=>s.pickColor(1),()=>s.markSaved(),
    ()=>s.loadDocument(s.serializeDocument())]){
    h.models.length=0;
    h.event('wheel',1,.5,{deltaY:1});
    assert.equal(h.models.length,0,'wheel-only notification waits for paint');
    action();
    assert.equal(h.models.length,1,'public action still notifies synchronously');
    assert.deepEqual(h.models[0],s.getViewModel());
    flushFrame(h);
    assert.equal(h.models.length,1);
  }
  s.dispose();
});

test('wheel batching preserves immediate paint commits and context-loss/disposal boundaries',()=>{
  const h=harness(),s=h.session;
  s.setTool('paint');h.event('pointerdown',.5,.5);h.event('pointerup',.5,.5);
  flushFrame(h);h.models.length=0;
  h.event('wheel',1,.5,{deltaY:1});
  assert.equal(h.models.length,1,'ending the pending paint edit must notify immediately');
  assert.equal(h.models[0].canUndo,true);
  assert.equal(h.timers.size,0);
  h.handlers.get('webglcontextlost')({preventDefault(){}});
  assert.equal(h.models.length,2);assert.equal(h.models.at(-1).ready,false);
  assert.equal(h.frames.size,0);
  h.handlers.get('webglcontextrestored')();
  assert.equal(h.models.length,3);assert.equal(h.models.at(-1).ready,true);
  flushFrame(h);assert.equal(h.models.length,3);
  h.event('wheel',1,.5,{deltaY:1});
  const lateFrame=[...h.frames.values()][0];
  s.dispose();assert.equal(h.frames.size,0);
  lateFrame();assert.equal(h.models.length,3,'disposed sessions cannot deliver a pending notification');
});

test('a deferred view callback can dispose the session before rendering',()=>{
  let disposeOnChange=false;
  const h=harness(()=>{if(disposeOnChange)h.session.dispose();});
  flushFrame(h);h.draws.length=0;
  h.event('wheel',1,.5,{deltaY:1});disposeOnChange=true;
  flushFrame(h);
  assert.equal(h.draws.length,0,'notification must not draw using disposed graphics resources');
  assert.equal(h.session.getViewModel().ready,false);
});
