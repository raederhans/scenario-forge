import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {keyboardAction,validateProjectFile,parseHexColor,text} from '../src/ui/text.js';
test('hex input accepts complete typed or pasted colors and rejects unfinished or malformed edits',()=>{assert.equal(parseHexColor('#1a2b3c'),'#1a2b3c');assert.equal(parseHexColor(' #A1B2C3 '),'#A1B2C3');for(const value of ['', '#', '#1a2b3', '#abc', '1a2b3c', '#1a2b3g', '#1a2b3c4'])assert.equal(parseHexColor(value),null);});
test('keyboard preserves platform save/open/undo and ignores unrelated modifier commands',()=>{assert.equal(keyboardAction({key:'z',metaKey:true,shiftKey:true}),'redo');assert.equal(keyboardAction({key:'S',ctrlKey:true}),'save');assert.equal(keyboardAction({key:'o',metaKey:true}),'open');assert.equal(keyboardAction({key:'b',ctrlKey:true}),null);assert.equal(keyboardAction({key:'v',altKey:true}),null);assert.equal(keyboardAction({key:'B'}),'paint');assert.equal(keyboardAction({key:'Escape'}),'clear');});
test('project file gate rejects empty oversized and unrelated documents',()=>{assert.equal(validateProjectFile({name:'atlas.JSON',size:300}),true);for(const file of [null,{name:'map.png',size:500},{name:'project.json',size:0},{name:'project.json',size:10*1024*1024+1}])assert.equal(validateProjectFile(file),false);});
test('Chinese and English UI have matching translation coverage',()=>{assert.deepEqual(Object.keys(text.zh).sort(),Object.keys(text.en).sort());for(const values of [text.zh,text.en])assert.ok(Object.values(values).every(value=>typeof value==='string'&&value.length>0));});

async function appHarness({handoff=false,ready=true}={}){
  const source=(await readFile(new URL('../src/main.js',import.meta.url),'utf8'))
    .replace(/^import .*;\r?\n/gm,'').replaceAll('import.meta.url',"'https://example.test/apps/hgo/src/main.js'").replace("setLanguage('zh');void start();",'')
    .concat('\nglobalThis.appStart=start;');
  const elements=new Map(),listeners=new Map();
  const element=id=>{
    if(elements.has(id))return elements.get(id);
    const handlers=new Map(),el={id,disabled:false,hidden:false,value:'',textContent:'',dataset:{},style:{setProperty(){}},children:[],classList:{toggle(){},remove(){},add(){}},
      addEventListener(name,fn){handlers.set(name,fn);},setAttribute(){},append(){},appendChild(){},replaceChildren(){},remove(){},click(){handlers.get('click')?.({});},focus(){},closest(){return null;},
      get handlers(){return handlers;}};
    elements.set(id,el);return el;
  };
  const document={documentElement:{},activeElement:null,body:element('body'),getElementById:element,querySelectorAll:()=>[],createElement:tag=>element(`created-${tag}`),addEventListener(name,fn){listeners.set(name,fn);}};
  const project={dataset:{id:'test'},paint:{},labels:{}};let acceptHandoff,finishHandoff;
  const session={loaded:null,saved:0,serialized:0,model:{ready,dirty:true,tool:'select',color:'#d17b55',selection:[],canUndo:false,canRedo:false,zoom:1,layers:{borders:true,labels:true,cities:true},stats:{stateCount:1,provinceCount:1},status:ready?'Ready':'Graphics context lost; waiting for recovery'},
    getViewModel(){return this.model;},loadDocument(payload){this.loaded=payload;},serializeDocument(){this.serialized++;return project;},markSaved(){this.saved++;}};
  class TestURL extends URL {static createObjectURL(){return 'blob:test';}static revokeObjectURL(){}}
  const context={document,window:{confirm:()=>true,addEventListener(){},removeEventListener(){},},location:{href:`https://example.test/hgo${handoff?'?handoff=123e4567-e89b-12d3-a456-426614174000':''}`},history:{state:null,replaceState(){}},URL:TestURL,Blob,AbortController,Element:class{},
    setTimeout:()=>1,clearTimeout(){},loadDataset:async()=>({placesWarning:null}),createHgoSession:()=>session,
    consumeHandoff:(token,accept)=>new Promise((resolve,reject)=>{acceptHandoff=accept;finishHandoff={resolve,reject};}),text,keyboardAction,validateProjectFile,parseHexColor,console};
  vm.runInNewContext(source,context,{filename:'apps/hgo/src/main.js'});
  return {elements,listeners,session,start:context.appStart,accept:payload=>acceptHandoff(payload),finish:()=>finishHandoff.resolve(true)};
}
test('delayed handoff keeps the editor unavailable until the document is accepted',async()=>{
  const app=await appHarness({handoff:true}),started=app.start();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.elements.get('open-button').disabled,true);
  assert.equal(app.elements.get('save-button').disabled,true);
  assert.equal(app.elements.get('map-canvas').style.pointerEvents,'none');
  assert.equal(app.elements.get('load-panel').hidden,false);
  assert.equal(app.session.loaded,null);
  app.listeners.get('keydown')({key:'s',ctrlKey:true,repeat:false,target:null,preventDefault(){}});
  assert.equal(app.session.serialized,0);
  app.accept({dataset:{id:'incoming'}});app.finish();await started;
  assert.deepEqual(app.session.loaded,{dataset:{id:'incoming'}});
  assert.equal(app.elements.get('open-button').disabled,false);
  assert.equal(app.elements.get('save-button').disabled,false);
  assert.equal(app.elements.get('map-canvas').style.pointerEvents,'');
  assert.equal(app.elements.get('load-panel').hidden,true);
});
test('a live document stays JSON-saveable after GPU context loss',async()=>{
  const app=await appHarness({ready:false}),started=app.start();await started;
  const save=app.elements.get('save-button');
  assert.equal(save.disabled,false);
  save.click();
  assert.equal(app.session.serialized,1);
  assert.equal(app.session.saved,1);
  assert.equal(app.elements.get('export-button').disabled,true);
  assert.equal(app.elements.get('open-button').disabled,true);
});
