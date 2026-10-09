import {loadDataset} from './data/dataset.js';
import {createHgoSession} from './session.js';
import {text,keyboardAction,validateProjectFile,parseHexColor} from './ui/text.js';
import {consumeHandoff} from './integration/handoff.js';

const $=id=>document.getElementById(id);
const palette=['#d17b55','#d6b978','#87977a','#728b98','#9b859e','#e2daca','#3d4951'];
let language='zh',session=null,loadingController=null,loadGeneration=0,viewModel=null,exporting=false,handoffPending=false,toastTimer=0,destroyed=false,leaveAuthorized=false;
const objectUrls=new Set();
const t=key=>text[language][key]||key;
function notify(message,error=false){const el=$('toast');el.textContent=message;el.classList.toggle('error',error);el.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{el.hidden=true;},error?9000:4000);}
function attempt(action){try{return action();}catch(error){notify(error.message,true);}}
function download(blob,name){const url=URL.createObjectURL(blob);objectUrls.add(url);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>{URL.revokeObjectURL(url);objectUrls.delete(url);},1500);}
function canReplace(){return !session?.getViewModel().dirty||window.confirm(t('discard'));}
function setLanguage(next){
  language=next;document.documentElement.lang=next==='zh'?'zh-CN':'en';
  document.querySelectorAll('[data-i18n]').forEach(el=>{el.textContent=t(el.dataset.i18n);});
  $('language-button').textContent=language==='zh'?'EN':'中文';$('language-button').setAttribute('aria-label',language==='zh'?'Switch to English':'切换到中文');
  $('state-search').placeholder=t('searchPlaceholder');$('paint-color').setAttribute('aria-label',t('colorHeading'));$('zoom-in').setAttribute('aria-label',t('zoomIn'));$('zoom-out').setAttribute('aria-label',t('zoomOut'));$('map-canvas').setAttribute('aria-label',t('mapAria'));$('back-link').setAttribute('aria-label',t('back'));
  for(const [id,key,shortcut]of [['tool-select','select','V'],['tool-paint','paint','B'],['tool-pan','pan','H'],['undo-button','undo','Ctrl/⌘+Z'],['redo-button','redo','Ctrl/⌘+Shift+Z']])$(id).title=`${t(key)} (${shortcut})`;
  if(viewModel)render(viewModel);else{$('load-title').textContent=t(loadingController?'loading':'loadCancelled');$('load-detail').textContent=t(loadingController?'loadDetail':'cancelledDetail');}
  search();
}
function render(vm){
  viewModel=vm;const ready=vm.ready&&!handoffPending;
  for(const id of ['open-button','state-search','paint-color','paint-hex','zoom-in','zoom-out','fit-button','tool-select','tool-paint','tool-pan'])$(id).disabled=!ready;
  $('save-button').disabled=!session||handoffPending;
  $('export-button').disabled=!ready||exporting;$('undo-button').disabled=!ready||!vm.canUndo;$('redo-button').disabled=!ready||!vm.canRedo;
  for(const button of $('color-swatches').children)button.disabled=!ready;
  for(const name of ['borders','labels','cities']){$(`layer-${name}`).disabled=!ready;$(`layer-${name}`).checked=vm.layers[name];}
  for(const button of document.querySelectorAll('[data-tool]'))button.setAttribute('aria-pressed',String(button.dataset.tool===vm.tool));
  $('map-canvas').style.cursor=vm.tool==='pan'?'grab':vm.tool==='paint'?'cell':'crosshair';
  $('map-canvas').style.pointerEvents=handoffPending?'none':'';
  $('paint-color').value=vm.color;if(document.activeElement!==$('paint-hex'))$('paint-hex').value=vm.color;
  $('zoom-value').textContent=`${Math.round(vm.zoom*100)}%`;$('dirty-indicator').textContent=t(vm.dirty?'unsaved':'clean');
  $('status-led').classList.toggle('ready',ready);
  $('status-text').textContent=vm.status.includes('context lost')?t('lost'):vm.status.includes('context restored')?t('restored'):vm.status==='Ready'?t('ready'):vm.status;
  $('dataset-stats').textContent=`${vm.stats.stateCount.toLocaleString()} ${t('states')} · ${vm.stats.provinceCount.toLocaleString()} ${t('provinces')}`;
  const selected=vm.selection.length>0,first=vm.selection[0];
  $('selection-empty').hidden=selected;$('selection-detail').hidden=!selected;$('paint-selection').disabled=!ready||!selected;$('clear-selection').disabled=!ready||!selected;
  $('label-input').disabled=!ready||vm.selection.length!==1;$('label-button').disabled=!ready||vm.selection.length!==1;
  if(selected){$('selected-name').textContent=vm.selection.length===1?first.name:`${vm.selection.length} ${t('multiple')}`;$('selected-swatch').style.background=first.color;$('selected-id').textContent=vm.selection.length===1?first.id:'—';$('selected-entity').textContent=[...new Set(vm.selection.map(s=>s.entityTag))].slice(0,4).join(', ');$('selected-count').textContent=String(vm.selection.length);if(document.activeElement!==$('label-input'))$('label-input').value=vm.selection.length===1?first.name:'';}
}
function search(){
  const results=$('search-results');results.replaceChildren();const query=$('state-search').value.trim();if(!session||!query)return;
  const found=session.search(query,{limit:30});
  if(!found.length){const empty=document.createElement('p');empty.className='search-empty';empty.textContent=t('noResults');results.append(empty);return;}
  for(const state of found){const button=document.createElement('button');button.type='button';button.className='search-result';const name=document.createElement('span'),meta=document.createElement('small');name.textContent=state.name;meta.textContent=`#${state.id} / ${state.entityTag}`;button.append(name,meta);button.addEventListener('click',()=>attempt(()=>{session.focusState(state.id);$('map-canvas').focus({preventScroll:true});}));results.append(button);}
}
async function start(){
  const generation=++loadGeneration;loadingController?.abort();session?.dispose();session=null;viewModel=null;handoffPending=false;
  const controller=new AbortController();loadingController=controller;
  $('load-panel').hidden=false;$('load-title').textContent=t('loading');$('load-detail').textContent=t('loadDetail');$('cancel-load').hidden=false;$('retry-load').hidden=true;$('load-progress').classList.remove('stopped');
  try{
    const dataset=await loadDataset(new URL('../assets/default/manifest.json',import.meta.url).href,{signal:controller.signal,onProgress:progress=>{if(generation!==loadGeneration)return;$('load-detail').textContent=progress.phase==='places-warning'?t('cityWarning'):`${t('loadingPhase')} · ${progress.phase}`;}});
    if(destroyed||controller.signal.aborted||generation!==loadGeneration)return;
    const url=new URL(location.href),token=url.searchParams.get('handoff');handoffPending=Boolean(token);
    session=createHgoSession({canvas:$('map-canvas'),overlayCanvas:$('overlay-canvas'),dataset,onChange:render,onError:error=>notify(error.message,true)});
    loadingController=null;$('load-panel').hidden=!handoffPending;$('cancel-load').hidden=true;$('retry-load').hidden=true;render(session.getViewModel());
    if(dataset.placesWarning)notify(`${t('cityWarning')} ${dataset.placesWarning}`,true);
    if(token){
      try{
        const target=session;
        await consumeHandoff(token,payload=>{if(destroyed||session!==target)throw new Error('HGO session is no longer active');target.loadDocument(payload);});
        if(!destroyed&&session===target){url.searchParams.delete('handoff');history.replaceState(history.state,'',url);notify(t('openDone'));}
      }catch(error){if(!destroyed)notify(error.message,true);}
      finally{if(!destroyed&&session){handoffPending=false;$('load-panel').hidden=true;render(session.getViewModel());}}
    }
  }catch(error){
    if(destroyed||generation!==loadGeneration)return;
    loadingController=null;$('load-title').textContent=t(controller.signal.aborted?'loadCancelled':'loadFailed');$('load-detail').textContent=controller.signal.aborted?t('cancelledDetail'):error.message;$('cancel-load').hidden=true;$('retry-load').hidden=false;$('load-progress').classList.add('stopped');$('status-text').textContent=$('load-title').textContent;
  }
}
function save(){if(!session||handoffPending)return;attempt(()=>{const project=session.serializeDocument();download(new Blob([JSON.stringify(project,null,2)],{type:'application/json'}),`hgo-${project.dataset.id}.json`);session.markSaved();notify(t('saveDone'));});}
async function openFile(file){
  if(!file)return;if(!validateProjectFile(file)){notify(t('badFile'),true);return;}if(!session)return;
  const target=session;
  try{const payload=await file.text();if(destroyed||session!==target||!canReplace())return;target.loadDocument(payload);$('state-search').value='';search();notify(t('openDone'));}catch(error){notify(error.message,true);}
}
async function exportPng(){
  if(!session||exporting)return;exporting=true;render(session.getViewModel());notify(t('exporting'));
  try{const blob=await session.exportPng();if(destroyed)return;download(blob,'hgo-atlas.png');notify(t('exportDone'));}catch(error){if(!destroyed)notify(error.message,true);}finally{exporting=false;if(!destroyed&&session)render(session.getViewModel());}
}
function applyLabel(){attempt(()=>{if(viewModel?.selection.length===1){session.setLabel(viewModel.selection[0].id,$('label-input').value);$('label-input').blur();render(session.getViewModel());search();}});}
for(const color of palette){const button=document.createElement('button');button.type='button';button.disabled=true;button.style.background=color;button.style.setProperty('--swatch',color);button.setAttribute('aria-label',color);button.title=color;button.addEventListener('click',()=>attempt(()=>session.setColor(color)));$('color-swatches').append(button);}
$('language-button').addEventListener('click',()=>setLanguage(language==='zh'?'en':'zh'));
$('cancel-load').addEventListener('click',()=>loadingController?.abort());$('retry-load').addEventListener('click',()=>void start());
for(const button of document.querySelectorAll('[data-tool]'))button.addEventListener('click',()=>attempt(()=>session.setTool(button.dataset.tool)));
for(const [id,action]of Object.entries({'undo-button':()=>session.undo(),'redo-button':()=>session.redo(),'fit-button':()=>session.fit(),'zoom-in':()=>session.zoomBy(1.4),'zoom-out':()=>session.zoomBy(1/1.4),'clear-selection':()=>session.resetSelection(),'paint-selection':()=>session.paintSelection()}))$(id).addEventListener('click',()=>attempt(action));
$('paint-color').addEventListener('input',event=>attempt(()=>session.setColor(event.target.value)));
$('paint-hex').addEventListener('input',event=>{const value=parseHexColor(event.target.value);if(value)attempt(()=>session.setColor(value));});
$('paint-hex').addEventListener('change',event=>{const value=parseHexColor(event.target.value);if(!value){notify(t('badColor'),true);event.target.value=viewModel.color;return;}attempt(()=>session.setColor(value));});
for(const name of ['borders','labels','cities'])$(`layer-${name}`).addEventListener('change',event=>attempt(()=>session.setLayer(name,event.target.checked)));
$('state-search').addEventListener('input',search);$('state-search').addEventListener('keydown',e=>{if(e.key==='Enter')$('search-results').querySelector('button')?.click();});
$('label-button').addEventListener('click',applyLabel);$('label-input').addEventListener('keydown',e=>{if(e.key==='Enter')applyLabel();});
$('save-button').addEventListener('click',save);$('open-button').addEventListener('click',()=>{$('project-file').value='';$('project-file').click();});
$('project-file').addEventListener('change',event=>void openFile(event.target.files[0]));$('export-button').addEventListener('click',()=>void exportPng());
$('back-link').addEventListener('click',event=>{if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||event.button!==0)return;if(!canReplace())event.preventDefault();else leaveAuthorized=true;});
window.addEventListener('beforeunload',event=>{if(!leaveAuthorized&&session?.getViewModel().dirty){event.preventDefault();event.returnValue='';}});
window.addEventListener('pagehide',event=>{if(event.persisted)return;destroyed=true;++loadGeneration;loadingController?.abort();session?.dispose();session=null;clearTimeout(toastTimer);for(const url of objectUrls)URL.revokeObjectURL(url);objectUrls.clear();});
window.addEventListener('pageshow',()=>{leaveAuthorized=false;session?.resize();});
document.addEventListener('keydown',event=>{
  if(!viewModel||event.repeat)return;
  const typing=event.target instanceof Element&&event.target.closest('input,textarea,select,[contenteditable="true"]');
  const action=keyboardAction(event);if(!action||(typing&&!['save','open'].includes(action)))return;event.preventDefault();
  if(action==='save'){save();return;}if(!viewModel.ready||handoffPending)return;
  if(action==='open')$('open-button').click();else attempt(()=>{if(['select','paint','pan'].includes(action))session.setTool(action);else if(action==='zoomIn')session.zoomBy(1.4);else if(action==='zoomOut')session.zoomBy(1/1.4);else if(action==='clear')session.resetSelection();else session[action]();});
});
setLanguage('zh');void start();
