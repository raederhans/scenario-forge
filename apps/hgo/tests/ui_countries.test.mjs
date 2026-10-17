import test from 'node:test';
import assert from 'node:assert/strict';
import {createCountryPanel} from '../src/ui/countries.js';

class Node {
  constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.dataset={};this.style={};this.value='';this.checked=false;this.hidden=false;this.disabled=false;this.events=new Map();this.attributes={};this.textContent='';}
  append(...nodes){for(const node of nodes){this.children.push(node);node.parentNode=this;}}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  setAttribute(name,value){this.attributes[name]=value;}
  addEventListener(event,fn){this.events.set(event,fn);}
  removeEventListener(event,fn){if(this.events.get(event)===fn)this.events.delete(event);}
  fire(event,target=this){this.events.get(event)?.({target});}
  closest(){return this.details||null;}
  focus(){this.ownerDocument.activeElement=this;}
}
function harness({count=2,closed=false}={}){
  const doc={documentElement:{lang:'en'},createElement:tag=>new Node(tag,doc)};
  const root=new Node('div',doc),details=closed?new Node('details',doc):null;
  if(details){details.open=false;root.details=details;}
  const countries=Array.from({length:count},(_,i)=>({tag:i?'BBB'+i:'AAA',name:i?'Target':'<img onerror=bad>',color:i?'#445566':'#112233',stateCount:3,overrideCount:1}));
  const calls=[],errors=[];
  const session={revision:0,listCountries(query,{includeEmpty=false}={}){calls.push(['list',query]);return countries.filter(c=>(includeEmpty||c.stateCount>0)&&`${c.tag} ${c.name}`.toLowerCase().includes(query.toLowerCase()));},selectCountry(tag){calls.push(['select',tag]);},
    setCountryColor(...args){calls.push(['color',...args]);countries.find(c=>c.tag===args[0]).color=args[1];},listCoreCandidates(){return [{target:'NEW',tag:'NEW',name:'',stateCount:2},{target:'BBB1',tag:'BBB1',name:'Target',stateCount:2}];},
    previewTransfer(parent,target){calls.push(['preview',parent,target]);return {revision:this.revision,parent,target,stateIds:['1','2'],states:[{id:'1',name:'First state'},{id:'2',name:'Second state'}],parentBefore:3,parentRemaining:1,targetBefore:target==='NEW'?0:3,targetAfter:target==='NEW'?2:5,overrideCount:1,tinyCount:1,otherCoreCount:1,suggestedColor:'#445566',targetName:target==='NEW'?'NEW':'Target',isNew:target==='NEW',colorConflict:true};},
    commitTransfer(...args){calls.push(['commit',...args]);},focusState(id){calls.push(['focus',id]);}};
  const panel=createCountryPanel({root,session,active:!closed,onError:error=>errors.push(error)});
  const find=id=>{const visit=n=>n.id===id?n:n.children.map(visit).find(Boolean);return visit(root);};
  const render=(revision=0,ready=true,generation=1)=>{session.revision=revision;panel.render({countryRevision:revision,ready,projectGeneration:generation});};
  const choose=()=>find('country-list').fire('click',find('country-list').children[0].children[1]);
  const preview=(index=0)=>find('country-core-list').fire('click',find('country-core-list').children[index]);
  return {panel,root,details,find,render,choose,preview,countries,calls,errors,session,doc};
}

test('country rows use literal text, preserve drafts, and keep the two color actions explicit',()=>{
  const h=harness();h.render();h.choose();
  assert.equal(h.find('country-list').children[0].children[1].textContent,'AAA · <img onerror=bad>');
  h.find('country-base-color').value='#abcdef';h.find('country-base-color').fire('input');h.render(1);
  assert.equal(h.find('country-base-color').value,'#abcdef');
  h.find('country-keep-overrides').fire('click');h.find('country-unify-overrides').fire('click');
  assert.deepEqual(h.calls.filter(c=>c[0]==='color'),[
    ['color','AAA','#abcdef',{overridePaint:false}],['color','AAA','#abcdef',{overridePaint:true}],
  ]);assert.deepEqual(h.errors,[]);
});

test('transfer preview keeps drafts when stale, refreshes explicitly, and submits the exact preview',()=>{
  const h=harness();h.render();h.choose();h.preview();
  assert.equal(h.find('country-override-paint').checked,true);
  assert.equal(h.find('country-color-conflict').hidden,false);
  assert.equal(h.find('country-state-list').children[0].textContent,'First state · 1');
  assert.equal(h.find('country-target-name').value,'NEW','missing names fall back to the tag');
  h.find('country-target-name').value='My country';h.find('country-target-color').value='#abcdef';
  h.render(1);assert.equal(h.find('country-stale').hidden,false);assert.equal(h.find('country-confirm-transfer').disabled,true);
  h.find('country-confirm-transfer').fire('click');assert.equal(h.calls.filter(c=>c[0]==='commit').length,0);
  h.find('country-refresh-preview').fire('click');
  assert.equal(h.find('country-target-name').value,'My country');assert.equal(h.find('country-target-color').value,'#abcdef');
  h.find('country-confirm-transfer').fire('click');
  const committed=h.calls.find(c=>c[0]==='commit');
  assert.equal(committed[1].revision,1);assert.deepEqual(committed[1].stateIds,['1','2']);
  assert.deepEqual(committed[2],{color:'#abcdef',name:'My country',overridePaint:true});
  assert.equal(h.find('country-confirm-transfer').disabled,true);
  assert.equal(h.find('country-completed').hidden,false);
  assert.equal(h.find('country-refresh-preview').hidden,true);
  assert.equal(h.find('country-stale').hidden,true);
  h.find('country-confirm-transfer').fire('click');assert.equal(h.calls.filter(c=>c[0]==='commit').length,1);
});

test('existing targets retain country-wide color/name controls and state IDs can be located',()=>{
  const h=harness();h.render();h.choose();h.preview(1);
  assert.equal(h.find('country-target-color').disabled,true);assert.equal(h.find('country-target-name').disabled,true);
  h.find('country-state-list').value='1';h.find('country-focus-state').fire('click');
  assert.deepEqual(h.calls.find(c=>c[0]==='focus'),['focus','1']);
  h.render(0,false);h.find('country-focus-state').fire('click');
  assert.equal(h.calls.filter(c=>c[0]==='focus').length,1);
});

test('inactive country tabs defer queries, cap rows, and stable renders keep DOM nodes',()=>{
  const h=harness({count:150,closed:true});h.render();assert.equal(h.calls.length,0);
  h.panel.setActive(true);assert.equal(h.find('country-list').children.length,100);
  assert.match(h.find('country-empty').textContent,/100 of 150/);
  const row=h.find('country-list').children[0],calls=h.calls.length;
  h.render();h.render();assert.equal(h.calls.length,calls);assert.equal(h.find('country-list').children[0],row);
  h.find('country-search').value='BBB149';h.find('country-search').fire('input');assert.equal(h.find('country-list').children.length,1);
});

test('zero-state parents are explicit and replacement projects reset panel state',()=>{
  const h=harness();h.countries[0].stateCount=0;h.render();h.find('country-show-empty').checked=true;h.find('country-show-empty').fire('change');h.choose();
  assert.equal(h.find('country-core-search').disabled,true);assert.equal(h.find('country-unify-overrides').disabled,true);
  assert.equal(h.find('country-core-list').children.length,0);
  h.countries[0].stateCount=3;h.render(1);h.preview();h.render(2,true,2);
  assert.equal(h.find('country-preview').hidden,true);assert.equal(h.find('country-base-color').disabled,true);
});

test('preview errors are surfaced and disposed panel callbacks cannot mutate the session',()=>{
  const h=harness();h.render();h.choose();h.session.previewTransfer=()=>{throw new Error('No matching states');};h.preview();
  assert.equal(h.errors[0].message,'No matching states');
  const keep=h.find('country-keep-overrides'),calls=h.calls.length;h.panel.dispose();h.panel.dispose();keep.fire('click');
  assert.equal(h.calls.length,calls);assert.equal(h.root.children.length,0);h.panel.render({ready:true});assert.equal(h.root.children.length,0);
});

test('base color follows committed undo values until the user edits a draft, and a zero-state parent stays selected',()=>{
  const h=harness();h.render();h.choose();
  h.countries[0].color='#334455';h.render(1);assert.equal(h.find('country-base-color').value,'#334455');
  h.find('country-base-color').value='#abcdef';h.find('country-base-color').fire('input');
  h.countries[0].color='#112233';h.countries[0].stateCount=0;h.render(2);
  assert.equal(h.find('country-base-color').value,'#abcdef');
  assert.match(h.find('country-selected').textContent,/AAA/);
  assert.equal(h.find('country-zero-state').hidden,false);
  assert.equal(h.find('country-core-search').disabled,true);
  assert.match(h.find('country-core-notice').textContent,/does not represent in-game release conditions/);
});

test('refreshing a now-active target adopts its authoritative color and name',()=>{
  const h=harness();h.render();h.choose();h.preview();
  h.find('country-target-color').value='#abcdef';h.find('country-target-name').value='Draft name';
  const previous=h.session.previewTransfer.bind(h.session);
  h.session.previewTransfer=(parent,target)=>({...previous(parent,target),targetBefore:2,isNew:false,suggestedColor:'#998877',targetName:'Existing name'});
  h.render(1);h.find('country-refresh-preview').fire('click');
  assert.equal(h.find('country-target-color').value,'#998877');assert.equal(h.find('country-target-name').value,'Existing name');
  assert.equal(h.find('country-target-color').disabled,true);assert.equal(h.find('country-target-name').disabled,true);
});

test('country navigation preserves search, draft color, focus and preview until a new target is chosen',()=>{
  const h=harness();h.render();
  h.find('country-search').value='AAA';h.find('country-search').fire('input');
  assert.equal(h.find('country-browse').hidden,false);assert.equal(h.find('country-detail').hidden,true);
  h.choose();assert.equal(h.find('country-browse').hidden,true);assert.equal(h.find('country-detail').hidden,false);
  assert.equal(h.doc.activeElement,h.find('country-selected'));
  h.find('country-base-color').value='#abcdef';h.find('country-base-color').fire('input');
  h.preview();assert.equal(h.find('country-detail').hidden,true);assert.equal(h.find('country-preview').hidden,false);
  h.find('country-target-name').value='Draft country';
  h.panel.setActive(false);h.render(1);h.panel.setActive(true);
  assert.equal(h.find('country-target-name').value,'Draft country');assert.equal(h.find('country-confirm-transfer').disabled,true);
  h.find('country-back-detail').fire('click');assert.equal(h.find('country-detail').hidden,false);assert.equal(h.find('country-preview').hidden,true);
  assert.equal(h.doc.activeElement,h.find('country-core-list').children[0]);assert.equal(h.find('country-base-color').value,'#abcdef');
  h.find('country-back-list').fire('click');assert.equal(h.find('country-search').value,'AAA');assert.equal(h.find('country-browse').hidden,false);
  assert.equal(h.doc.activeElement,h.find('country-list').children[0]);
  h.render(2,true,2);assert.equal(h.find('country-search').value,'');assert.equal(h.find('country-preview').hidden,true);
});
