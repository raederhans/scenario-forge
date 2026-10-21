import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createInspector} from '../src/ui/inspector.js';
import {createCountryPanel} from '../src/ui/countries.js';

class Node {
  constructor(tag,doc,id=''){
    this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.id=id;this.children=[];
    this.attributes={};this.events=new Map();this.dataset={};this.style={};this.value='';
    this.hidden=false;this.checked=false;this.scrollTop=0;this.textWrites=0;this._open=false;
  }
  set textContent(value){this._text=value;this.textWrites++;}
  get textContent(){return this._text||'';}
  set open(value){const changed=this._open!==value;this._open=value;if(changed)this.fire('toggle');}
  get open(){return this._open;}
  append(...nodes){for(const node of nodes){this.children.push(node);node.parentNode=this;}}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  setAttribute(name,value){this.attributes[name]=value;}
  addEventListener(name,fn){this.events.set(name,fn);}
  removeEventListener(name,fn){if(this.events.get(name)===fn)this.events.delete(name);}
  contains(node){return node===this||this.children.some(child=>child.contains(node));}
  closest(selector){for(let node=this;node;node=node.parentNode)if(node.tagName===selector.toUpperCase())return node;return null;}
  focus(){this.ownerDocument.activeElement=this;}
  fire(name,options={}){
    const event={target:this,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...options};
    for(let node=this;node;node=node.parentNode){node.events.get(name)?.(event);if(event.stopped)break;}
    return event;
  }
}
function harness(){
  const doc={documentElement:{lang:'zh-CN'},activeElement:null,createElement:tag=>new Node(tag,doc)};
  const root=new Node('aside',doc,'inspector');
  doc.getElementById=id=>{const find=node=>node.id===id?node:node.children.map(find).find(Boolean);return find(root);};
  const make=(tag,id,parent=root)=>{const node=new Node(tag,doc,id);parent.append(node);return node;};
  const tabs=make('div','tabs');
  for(const key of ['edit','layers','countries']){make('button',`inspector-tab-${key}`,tabs);make('div',`inspector-panel-${key}`);}
  const summary=make('div','selection-summary');
  for(const name of ['title','meta','swatch'])make('span',`selection-summary-${name}`,summary);
  const details=make('details','country-management',doc.getElementById('inspector-panel-countries'));
  const countries=make('div','country-panel',details);
  const draft=make('input','draft',doc.getElementById('inspector-panel-edit'));
  const inspector=createInspector({root});
  return {root,doc,details,countries,draft,inspector,find:doc.getElementById};
}

test('tabs expose one selected tab and panel, with keyboard wrapping and no map key propagation',()=>{
  const h=harness();let mapKeys=0;h.root.addEventListener('keydown',()=>mapKeys++);
  const check=key=>{
    assert.equal(h.inspector.active,key);
    for(const name of ['edit','layers','countries']){
      assert.equal(h.find(`inspector-tab-${name}`).attributes['aria-selected'],String(name===key));
      assert.equal(h.find(`inspector-tab-${name}`).tabIndex,name===key?0:-1);
      assert.equal(h.find(`inspector-panel-${name}`).hidden,name!==key);
    }
  };
  check('edit');
  for(const [from,key,to] of [['edit','ArrowRight','layers'],['layers','End','countries'],['countries','ArrowRight','edit'],['edit','ArrowLeft','countries'],['countries','Home','edit']]){
    const event=h.find(`inspector-tab-${from}`).fire('keydown',{key});
    check(to);assert.equal(event.prevented,true);assert.equal(event.stopped,true);
    assert.equal(h.doc.activeElement,h.find(`inspector-tab-${to}`));
  }
  assert.equal(mapKeys,0);
  h.find('inspector-tab-layers').fire('click');check('layers');
  h.inspector.dispose();h.find('inspector-tab-edit').fire('click');check('layers');
});

test('tab changes retain DOM, edit drafts, each scroll position and a visible focus target',()=>{
  const h=harness(),edit=h.find('inspector-panel-edit'),layers=h.find('inspector-panel-layers');
  h.draft.value='未提交名称';h.draft.focus();edit.scrollTop=124;
  h.inspector.activate('layers');layers.scrollTop=265;
  assert.equal(h.doc.activeElement,h.find('inspector-tab-layers'));
  h.inspector.activate('edit');
  assert.equal(h.find('draft'),h.draft);assert.equal(h.draft.value,'未提交名称');
  assert.equal(edit.scrollTop,124);assert.equal(layers.scrollTop,265);
});

test('country navigation closes the real query gate and preserves preview inputs without session mutations',()=>{
  const h=harness(),calls=[],country={tag:'AAA',name:'国家',color:'#112233',stateCount:2,overrideCount:0};
  const session={
    listCountries(){calls.push('list');return [country];},
    listCoreCandidates(){calls.push('cores');return [{tag:'NEW',target:'NEW',stateCount:1}];},
    selectCountry(){calls.push('select');},
    previewTransfer(){return {revision:0,parent:'AAA',target:'NEW',stateIds:['1'],parentBefore:2,parentRemaining:1,targetBefore:0,targetAfter:1,overrideCount:0,tinyCount:0,otherCoreCount:0,suggestedColor:'#445566',targetName:'NEW',isNew:true};},
    setLayer(){throw Error('navigation changed a layer');},setDisplayOption(){throw Error('navigation changed display');},
  };
  const panel=createCountryPanel({root:h.countries,session,getLanguage:()=> 'zh'});
  const model={ready:true,projectGeneration:1,countryRevision:0};panel.render(model);
  assert.deepEqual(calls,[]);
  h.inspector.activate('countries');assert.equal(h.details.open,true);assert.deepEqual(calls,['list']);
  h.find('country-list').fire('click',{target:h.find('country-list').children[0]});
  h.find('country-core-list').fire('click',{target:h.find('country-core-list').children[0]});
  const draft=h.find('country-target-name');draft.value='新国家草稿';
  const before=calls.length;
  h.inspector.activate('layers');assert.equal(h.details.open,false);
  panel.render({...model,countryRevision:1});panel.render({...model,countryRevision:1});
  assert.equal(calls.length,before,'hidden renders cannot query country data');
  h.inspector.activate('countries');assert.equal(h.find('country-target-name'),draft);
  assert.equal(draft.value,'新国家草稿');
  const after=calls.length;h.inspector.activate('countries');panel.render({...model,countryRevision:1});
  assert.equal(calls.length,after,'repeat navigation/render cannot rebuild rows');
  assert.deepEqual(calls.filter(call=>call==='select'),['select'],'only the explicit country choice mutated selection');
});

test('selection summary only writes for relevant displayed values and localizes without replacing nodes',()=>{
  const h=harness(),title=h.find('selection-summary-title'),meta=h.find('selection-summary-meta');
  const model={selection:[{id:1,name:'阿雅克肖',entityTag:'FRA',color:'#123456'}],zoom:1};
  h.inspector.render(model,'zh');const writes=[title.textWrites,meta.textWrites];
  h.inspector.render({...model,zoom:2,dirty:true,status:'tick'},'zh');
  assert.deepEqual([title.textWrites,meta.textWrites],writes);
  assert.equal(title.textContent,'阿雅克肖');assert.match(meta.textContent,/#1 · FRA/);
  h.inspector.render(model,'en');assert.match(meta.textContent,/Selected states 1/);
  assert.equal(h.find('selection-summary-title'),title);
  h.inspector.render({selection:[]},'zh');assert.equal(h.find('selection-summary-swatch').hidden,true);
});

test('HTML keeps the shared search, summary and existing controls under their intended panels',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  for(const key of ['edit','layers','countries']){
    assert.match(html,new RegExp(`id="inspector-tab-${key}" role="tab" aria-controls="inspector-panel-${key}"`));
    assert.match(html,new RegExp(`id="inspector-panel-${key}" class="inspector-panel" role="tabpanel" aria-labelledby="inspector-tab-${key}"`));
  }
  assert.ok(html.indexOf('id="state-search"')<html.indexOf('id="inspector-panel-edit"'));
  assert.ok(html.indexOf('id="selection-summary"')<html.indexOf('id="inspector-panel-edit"'));
  assert.match(html,/<details class="layer-parameters"><summary data-i18n="borderParameters">/);
  const edit=html.slice(html.indexOf('id="inspector-panel-edit"'),html.indexOf('id="inspector-panel-layers"'));
  assert.match(edit,/id="paint-color"/);assert.match(edit,/id="selection-detail"/);
  const layers=html.slice(html.indexOf('id="inspector-panel-layers"'),html.indexOf('id="inspector-panel-countries"'));
  assert.match(layers,/id="layer-borders"/);assert.match(layers,/id="visualization-panel"/);
  const countries=html.slice(html.indexOf('id="inspector-panel-countries"'));
  assert.match(countries,/id="country-management"/);
});
