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
    .concat('\nglobalThis.appStart=start;globalThis.appRender=render;');
  const elements=new Map(),listeners=new Map();let created=0;
  const element=id=>{
    if(elements.has(id))return elements.get(id);
    const handlers=new Map(),el={id,disabled:false,hidden:false,value:'',textContent:'',dataset:{},style:{setProperty(){}},children:[],classList:{toggle(){},remove(){},add(){}},
      addEventListener(name,fn){handlers.set(name,fn);},setAttribute(){},append(...nodes){this.children.push(...nodes);},appendChild(){},replaceChildren(...nodes){this.children=nodes;},querySelector(tag){return this.children.find(child=>child.tagName===tag)||null;},remove(){},click(){handlers.get('click')?.({});},focus(){handlers.get('focus')?.({});},closest(){return null;},
      get handlers(){return handlers;}};
    elements.set(id,el);return el;
  };
  const document={documentElement:{},activeElement:null,body:element('body'),getElementById:element,querySelectorAll:()=>[],createElement:tag=>{const node=element(`created-${tag}-${created++}`);node.tagName=tag;return node;},addEventListener(name,fn){listeners.set(name,fn);}};
  const project={dataset:{id:'test'},paint:{},labels:{}};let acceptHandoff,finishHandoff;
  const session={loaded:null,saved:0,serialized:0,model:{ready,dirty:true,tool:'select',color:'#d17b55',selection:[],canUndo:false,canRedo:false,zoom:1,layers:{borders:true,labels:true,cities:true},stats:{stateCount:1,provinceCount:1},status:ready?'Ready':'Graphics context lost; waiting for recovery'},
    getViewModel(){return this.model;},loadDocument(payload){this.loaded=payload;},serializeDocument(){this.serialized++;return project;},markSaved(){this.saved++;}};
  class TestURL extends URL {static createObjectURL(){return 'blob:test';}static revokeObjectURL(){}}
  const context={document,window:{confirm:()=>true,addEventListener(){},removeEventListener(){},},location:{href:`https://example.test/hgo${handoff?'?handoff=123e4567-e89b-12d3-a456-426614174000':''}`},history:{state:null,replaceState(){}},URL:TestURL,Blob,AbortController,Element:class{},
    setTimeout:()=>1,clearTimeout(){},loadDataset:async()=>({placesWarning:null}),createHgoSession:()=>session,createCountryPanel:()=>({render(){},dispose(){}}),createVisualizationPanel:()=>({render(){},dispose(){}}),createInspector:()=>({render(){},dispose(){}}),
    consumeHandoff:(token,accept)=>new Promise((resolve,reject)=>{acceptHandoff=accept;finishHandoff={resolve,reject};}),text,keyboardAction,validateProjectFile,parseHexColor,console};
  vm.runInNewContext(source,context,{filename:'apps/hgo/src/main.js'});
  return {elements,listeners,session,start:context.appStart,render:context.appRender,accept:payload=>acceptHandoff(payload),finish:()=>finishHandoff.resolve(true)};
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

test('unfocused edit drafts survive unrelated renders and refresh for a new selection or project',async()=>{
  const app=await appHarness();await app.start();
  const first={id:'1',name:'First',customLabel:'',entityTag:'AAA',originalEntityTag:'AAA',color:'#123456'};
  app.session.model={...app.session.model,projectGeneration:1,selection:[first]};app.render(app.session.model);
  const label=app.elements.get('label-input'),hex=app.elements.get('paint-hex');
  label.value='Unsubmitted name';hex.value='#abc';
  app.render({...app.session.model,zoom:2});
  assert.equal(label.value,'Unsubmitted name');assert.equal(hex.value,'#abc');
  app.render({...app.session.model,projectGeneration:2});assert.equal(label.value,'');
  label.value='Old draft';app.render({...app.session.model,selection:[{...first,id:'2',customLabel:'Second label'}]});
  assert.equal(label.value,'Second label');
});

test('search selection dismisses results, explicit focus or input reveals them, and background refresh keeps disclosure',async()=>{
  const app=await appHarness();await app.start();
  const input=app.elements.get('state-search'),results=app.elements.get('search-results'),focused=[];
  app.session.search=()=>[{id:'1',name:'First',entityTag:'AAA'}];
  app.session.focusState=id=>focused.push(id);
  input.value='First';input.handlers.get('input')();assert.equal(results.hidden,false);
  results.children[0].click();assert.equal(results.hidden,true);assert.equal(input.value,'First');
  assert.deepEqual(focused,['1']);
  app.render({...app.session.model,visualizations:{statuses:{localization:{status:'ready'}}}});
  assert.equal(results.hidden,true,'localization result rebuild cannot reopen dismissed results');
  app.elements.get('language-button').click();assert.equal(results.hidden,true,'language change cannot reopen results');
  input.focus();assert.equal(results.hidden,false);
  input.handlers.get('keydown')({key:'Enter',preventDefault(){}});
  assert.equal(results.hidden,true);assert.deepEqual(focused,['1','1']);
  input.handlers.get('input')();assert.equal(results.hidden,false);
  const escape={key:'Escape',preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;}};
  input.handlers.get('keydown')(escape);
  assert.equal(escape.prevented,true);assert.equal(escape.stopped,true);assert.equal(results.hidden,true);
  assert.equal(input.value,'First');assert.deepEqual(focused,['1','1']);
  input.focus();assert.equal(results.hidden,false);
  results.handlers.get('keydown')({...escape,currentTarget:results});
  assert.equal(results.hidden,true,'Escape from a result returns focus without leaving results open');
});
