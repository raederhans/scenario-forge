import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocument} from '../src/document/document.js';
import {createRenderer} from '../src/render/renderer.js';
import {DEFAULT_LAYERS} from '../src/render/settings.js';

function fixture() {
  const states=[{id:1,entityTag:'AAA',anchor:[.5,.5],pixelCount:2},{id:2,entityTag:'BBB',anchor:[2.5,.5],pixelCount:1}];
  const entities=[{tag:'AAA',color:'#123456'},{tag:'BBB',color:'#abcdef'}];
  return {manifest:{id:'renderer',revision:'r1',coordinateSpace:{width:3,height:1}},
    core:{states,entities,provinceIds:[null,11,12,13,14],provinceStateIds:[null,1,1,2,null]},
    ids:new Uint16Array([1,2,3]),stateById:new Map(states.map(s=>[String(s.id),s])),
    entityByTag:new Map(entities.map(e=>[e.tag,e])),places:[]};
}

function graphics(dataset) {
  const uploads=[],allocations=[],bound=new Map();let unit=0,serial=1;
  const constants={NO_ERROR:0,TEXTURE0:33984,TEXTURE1:33985,TEXTURE2:33986,TEXTURE3:33987};
  const gl=new Proxy({
    getParameter:()=>8192,getShaderParameter:()=>true,getProgramParameter:()=>true,getError:()=>0,
    activeTexture(value){unit=value-constants.TEXTURE0;},
    bindTexture(_target,texture){bound.set(unit,texture);},
    texImage2D(_target,_level,internal,width,height,_border,format,type,data){
      allocations.push({unit,texture:bound.get(unit),internal,width,height,format,type,data:data?.slice()});
    },
    texSubImage2D(_target,_level,_x,_y,width,height,format,type,data){
      uploads.push({unit,texture:bound.get(unit),width,height,format,type,data:data.slice()});
    },
  },{get(target,key){
    if(key in target)return target[key];
    if(key.toUpperCase()===key)return constants[key]??=serial++;
    if(key.startsWith('create'))return ()=>({id:serial++});
    return ()=>{};
  }});
  const canvas={width:300,height:100,getContext:()=>gl};
  return {renderer:createRenderer(canvas,dataset),uploads,allocations,take:()=>uploads.splice(0)};
}

const units=uploads=>uploads.map(upload=>upload.unit);
const color=(upload,province)=>Array.from(upload.data.subarray(province*4,province*4+4));

test('renderer skips unchanged tables and keeps color and selection uploads independent',t=>{
  const dataset=fixture(),document=createDocument(dataset),h=graphics(dataset),selected=new Set(['1']);
  t.after(()=>h.renderer.dispose());
  h.renderer.update(document,selected);
  let changes=h.take();assert.deepEqual(units(changes),[1,2,3]);
  assert.deepEqual(color(changes[1],1),[0x12,0x34,0x56,255]);
  assert.deepEqual(color(changes[1],2),[0x12,0x34,0x56,255]);
  assert.deepEqual(color(changes[1],3),[0xab,0xcd,0xef,255]);
  assert.deepEqual(Array.from(changes[2].data.subarray(0,5)),[0,255,255,0,0]);
  assert.equal(changes[1].data.byteLength,1024);assert.equal(changes[2].data.byteLength,256);

  h.renderer.update(document,selected);
  h.renderer.update(document,new Set(['1']));
  assert.deepEqual(units(h.take()),[],'unchanged updates must upload no texture bytes');

  // Mutating the same Set must still replace the GPU selection, including clearing old entries.
  selected.clear();selected.add('2');h.renderer.update(document,selected);
  changes=h.take();assert.deepEqual(units(changes),[3]);
  assert.deepEqual(Array.from(changes[0].data.subarray(0,5)),[0,0,0,255,0]);

  document.paintStates(['1'],'#998877');h.renderer.update(document,selected);
  changes=h.take();assert.deepEqual(units(changes),[2]);
  assert.deepEqual(color(changes[0],1),[0x99,0x88,0x77,255]);
  assert.deepEqual(color(changes[0],2),[0x99,0x88,0x77,255]);
  assert.deepEqual(color(changes[0],3),[0xab,0xcd,0xef,255]);
  assert.deepEqual(color(changes[0],4),[0,0,0,0],'unassigned provinces stay empty');
  assert.equal(h.allocations.length,4,'updates never reallocate the native map or tables');
  assert.deepEqual(Array.from(h.allocations[0].data),[1,2,3]);
});

test('paint history, country colors, load and document replacement refresh authoritative colors',t=>{
  const dataset=fixture(),document=createDocument(dataset),h=graphics(dataset),selected=new Set();
  t.after(()=>h.renderer.dispose());
  h.renderer.update(document,selected);h.take();
  const saved=document.serialize({x:1.5,y:.5,scale:1},DEFAULT_LAYERS);
  const check=(expected,expectedUnits=[2])=>{
    h.renderer.update(document,selected);
    const changes=h.take();assert.deepEqual(units(changes),expectedUnits);
    assert.deepEqual(color(changes.find(upload=>upload.unit===2),1),expected);
  };
  document.paintStates(['1'],'#556677');check([0x55,0x66,0x77,255]);
  document.undo();check([0x12,0x34,0x56,255]);
  document.redo();check([0x55,0x66,0x77,255]);
  document.setCountryColor('AAA','#010203',{overridePaint:true});check([1,2,3,255]);
  document.load(saved);check([0x12,0x34,0x56,255],[1,2]);

  const other=createDocument(dataset);
  // Equal numeric revisions on different document objects must not reuse a palette.
  while(other.revision<document.revision)other.paintStates(['1'],other.revision%2?'#112233':'#445566');
  assert.equal(other.revision,document.revision);
  h.renderer.update(other,selected);
  const changes=h.take();assert.deepEqual(units(changes),[1,2]);
  assert.deepEqual(color(changes[1],1),[0x44,0x55,0x66,255]);
});

test('unversioned callers stay live and fresh renderers initialize restored and export tables',t=>{
  const dataset=fixture(),h=graphics(dataset);let value='#123456';
  const document={color:()=>value};
  t.after(()=>h.renderer.dispose());
  h.renderer.update(document,new Set());h.take();
  value='#fedcba';h.renderer.update(document,new Set());
  const changes=h.take();assert.deepEqual(units(changes),[2]);
  assert.deepEqual(color(changes[0],1),[0xfe,0xdc,0xba,255]);

  const restored=createDocument(dataset);restored.paintStates(['1'],'#010203');
  h.renderer.update(restored,new Set(['1']));h.take();h.renderer.dispose({contextLost:true});
  for(const selected of [new Set(['1']),new Set()]){
    const next=graphics(dataset);
    next.renderer.update(restored,selected);
    const initial=next.take();assert.deepEqual(units(initial),[1,2,3]);
    assert.deepEqual(color(initial[1],1),[1,2,3,255]);
    assert.equal(initial[2].data[1],selected.size?255:0);
    next.renderer.dispose();
  }
});
