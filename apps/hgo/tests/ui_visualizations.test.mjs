import test from 'node:test';
import assert from 'node:assert/strict';
import {createVisualizationPanel} from '../src/ui/visualizations.js';
import {DEFAULT_LAYERS} from '../src/render/settings.js';
import {METRIC_DEFINITIONS,infrastructureColor} from '../src/data/metrics.js';
import {resourceSymbolRadius,resourceSymbolColor} from '../src/render/metric_symbols.js';
import {metricColor} from '../src/render/visualization.js';

class Node {
  constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.dataset={};this.style={};this.value='';this.checked=false;this.hidden=false;this.disabled=false;this.events=new Map();this.attributes={};this.textContent='';}
  append(...nodes){for(const node of nodes){this.children.push(node);node.parentNode=this;}}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  setAttribute(name,value){this.attributes[name]=value;}
  getAttribute(name){return this.attributes[name]??null;}
  addEventListener(event,fn){this.events.set(event,fn);}
  removeEventListener(event,fn){if(this.events.get(event)===fn)this.events.delete(event);}
  fire(event,target=this){this.events.get(event)?.({target});}
}
function harness(){
  const doc={createElement:tag=>new Node(tag,doc),activeElement:null},root=new Node('div',doc),calls=[];
  let session={setLayer(...args){calls.push(['layer',...args]);},setDisplayOption(...args){calls.push(['option',...args]);},retryVisualizations(){calls.push(['retry']);}};
  const panel=createVisualizationPanel(root,{getSession:()=>session});
  const find=id=>{const visit=node=>node.id===id?node:node.children.map(visit).find(Boolean);return visit(root);};
  const all=(node=root)=>[node,...node.children.flatMap(child=>all(child))];
  const model={ready:true,layers:{...DEFAULT_LAYERS},visualizations:{statuses:{},decodedBytes:0}};
  const render=(next=model,language='zh')=>panel.render(next,language);
  return {panel,doc,root,find,all,calls,model,render,setSession:value=>{session=value;}};
}

test('panel has all 17 native metrics, progressive details and bilingual source context',()=>{
  const h=harness();h.render();
  assert.equal(h.find('visualization-details').tagName,'SECTION');
  const optionValues=h.all(h.find('vis-metric')).filter(node=>node.tagName==='OPTION').map(node=>node.value);
  assert.deepEqual(new Set(optionValues),new Set(['none',...METRIC_DEFINITIONS.map(item=>item.id)]));
  assert.match(h.all().map(node=>node.textContent).join(' '),/2016 年.*0.5°.*原始影像尚未核验/);
  assert.match(h.all().map(node=>node.textContent).join(' '),/并非现实产量/);
  const nameNode=h.find('vis-nameLanguage');h.render(h.model,'en');
  assert.equal(h.find('vis-nameLanguage'),nameNode,'render must keep focused form nodes stable');
  assert.match(h.all().map(node=>node.textContent).join(' '),/not measured production/);
  assert.equal(h.all().find(node=>node.tagName==='H3').textContent,'Physical reference');
});

test('inactive layer parameters stay hidden and expanding details changes no map settings',()=>{
  const h=harness();h.render();
  for(const id of ['vis-terrain-settings','vis-river-settings','vis-lighting-settings','vis-metric-settings','vis-time-summary']){
    assert.equal(h.find(id).hidden,true,id);
  }
  assert.equal(h.find('vis-terrainMode').parentNode.hidden,true);
  assert.equal(h.find('vis-quality').parentNode.hidden,true);
  const settings=h.find('vis-terrain-settings'),mode=h.find('vis-terrainMode');
  h.model.layers.terrain=true;h.render();
  assert.equal(settings.hidden,false);assert.equal(mode.parentNode.hidden,false);
  assert.equal(h.find('vis-quality').parentNode.hidden,false);
  settings.open=true;settings.fire('toggle');h.render();
  assert.deepEqual(h.calls,[],'parameter disclosure must not load, enable or change layers');
  assert.equal(h.find('vis-terrainMode'),mode);
  assert.equal(settings.open,true,'ordinary rendering preserves disclosure state');
  h.model.layers.terrain=false;h.render();assert.equal(settings.hidden,true);
  h.model.layers.terrain=true;h.render();assert.equal(settings.open,true);
});

test('lighting discloses only relevant controls and summarizes time without its own clock',()=>{
  const h=harness();h.model.layers.nightLights=true;h.render();
  assert.equal(h.find('vis-lighting-settings').hidden,false);
  assert.equal(h.find('vis-solarMode').parentNode.hidden,true);
  assert.equal(h.find('vis-nightLightOpacity').parentNode.parentNode.hidden,false);
  assert.equal(h.find('vis-time-summary').hidden,true);
  h.model.layers.dayNight=true;h.model.layers.solarMode='manual';h.model.layers.utcMinutes=73;h.render();
  assert.equal(h.find('vis-time-summary').hidden,false);
  assert.match(h.find('vis-time-summary').textContent,/01:13 UTC/);
  assert.equal(h.find('vis-cycleSeconds').parentNode.parentNode.hidden,true);
  h.model.layers.solarMode='cycle';h.render();
  assert.match(h.find('vis-time-summary').textContent,/循环演示/);
  assert.equal(h.find('vis-cycleSeconds').parentNode.parentNode.hidden,false);
  h.model.layers.solarMode='utc';h.render(h.model,'en');
  assert.equal(h.find('vis-time-summary').textContent,'Current UTC');
  assert.deepEqual(h.calls,[]);
});

test('switches and options call the current session with typed values',()=>{
  const h=harness();h.model.layers.dayNight=true;h.model.layers.solarMode='cycle';h.render();
  h.find('vis-terrain').checked=true;h.find('vis-terrain').fire('change');
  h.find('vis-terrainOpacity').value='.45';h.find('vis-terrainOpacity').fire('input');
  h.find('vis-terrainMode').value='geomorphology';h.find('vis-terrainMode').fire('change');
  h.find('vis-nameLanguage').value='bilingual';h.find('vis-nameLanguage').fire('change');
  h.find('vis-utcMinutes').value='73';h.find('vis-utcMinutes').fire('input');
  h.find('vis-solarDate').value='2026-10-20';h.find('vis-solarDate').fire('change');
  assert.deepEqual(h.calls,[['layer','terrain',true],['option','terrainOpacity',.45],['option','terrainMode','geomorphology'],
    ['option','nameLanguage','bilingual'],['option','utcMinutes',73],['option','solarDate','2026-10-20']]);
  const replacement=[];h.setSession({setLayer:(...args)=>replacement.push(args)});
  h.find('vis-rivers').checked=true;h.find('vis-rivers').fire('change');
  assert.deepEqual(replacement,[['rivers',true]],'replaced projects must not use the old session');
  h.render({...h.model,ready:false});h.find('vis-rivers').fire('change');
  assert.equal(replacement.length,1);
});

test('lighting controls follow the active mode and focused drafts survive unrelated renders',()=>{
  const h=harness();h.render();
  assert.equal(h.find('vis-solarMode').disabled,true);
  h.model.layers.dayNight=true;h.model.layers.solarMode='utc';h.render();
  assert.equal(h.find('vis-solarMode').disabled,false);assert.equal(h.find('vis-solarDate').disabled,true);
  assert.equal(h.find('vis-utcMinutes').disabled,true);assert.equal(h.find('vis-cycleSeconds').disabled,true);
  h.model.layers.solarMode='cycle';h.render();assert.equal(h.find('vis-cycleSeconds').disabled,false);
  assert.equal(h.find('vis-utcMinutes').disabled,true);
  h.model.layers.solarMode='manual';h.render();assert.equal(h.find('vis-utcMinutes').disabled,false);
  const input=h.find('vis-solarDate');h.doc.activeElement=input;input.value='2027-01-01';h.render();
  assert.equal(input.value,'2027-01-01');h.doc.activeElement=null;h.render();assert.equal(input.value,h.model.layers.solarDate);
});

test('quality control sends balanced/fine choices and preserves lighting settings',()=>{
  const h=harness();h.model.layers.quality='balanced';h.render();
  const quality=h.find('vis-quality');
  assert.equal(quality.value,'balanced');
  assert.deepEqual(quality.children.map(node=>[node.value,node.textContent]),[['balanced','均衡（更轻）'],['fine','精细']]);
  const lighting={solarMode:h.model.layers.solarMode,nightLightOpacity:h.model.layers.nightLightOpacity};
  quality.value='fine';quality.fire('change');
  assert.deepEqual(h.calls,[['option','quality','fine']]);
  h.model.layers.quality='fine';h.render(h.model,'en');
  assert.equal(quality.value,'fine');assert.equal(quality.children[0].textContent,'Balanced (lighter)');
  assert.equal(h.model.layers.solarMode,lighting.solarMode);assert.equal(h.model.layers.nightLightOpacity,lighting.nightLightOpacity);
});

test('landform names have an independent conditional switch and river weight has no pixel unit',()=>{
  const h=harness();h.render();
  const names=h.find('vis-landformLabels');
  assert.equal(names.parentNode.hidden,true);
  h.model.layers.terrain=true;h.render();
  assert.equal(names.parentNode.hidden,false);assert.equal(names.checked,true);
  names.checked=false;names.fire('change');
  assert.deepEqual(h.calls,[['layer','landformLabels',false]]);
  h.model.layers.terrainMode='native';h.render();assert.equal(names.parentNode.hidden,true);
  h.model.layers.rivers=true;h.model.layers.riverWidth=.5;h.render();
  const row=h.find('vis-riverWidth').parentNode;
  assert.equal(row.children.find(node=>node.tagName==='OUTPUT').textContent,'0.5');
  assert.match(h.all().map(node=>node.textContent).join(' '),/河流粗细/);
  h.render(h.model,'en');
  assert.match(h.all().map(node=>node.textContent).join(' '),/River weight/);
});

test('metric zero is displayed separately from missing data and literal palette text is safe',()=>{
  const h=harness();h.model.layers.metric='resource_steel';h.model.layers.terrain=true;
  h.model.visualizations={statuses:{metrics:{status:'ready'}},metric:{value:0,status:'known',min:0,max:15,knownCount:7},
    terrainPalette:[{id:'test',label:{zh:'<img onerror=bad>',en:'<svg>'},color:'#123456'}]};h.render();
  assert.equal(h.find('vis-metric-value').textContent,'所选州 · 0');
  assert.equal(h.find('vis-metric-hint').textContent,'游戏资源值');
  assert.match(h.find('vis-metric-range').textContent,/0 – 15/);
  const legend=h.find('vis-terrain-legend');assert.equal(legend.children[0].children[1].textContent,'<img onerror=bad>');
  assert.equal(h.all(legend).some(node=>node.tagName==='IMG'),false);
  h.model.visualizations.metric={value:null,status:'missing',knownCount:7};h.render();
  assert.match(h.find('vis-metric-hint').textContent,/缺失值不视为零/);
  h.model.visualizations.metric={value:null,status:'no-selection',knownCount:7};h.render();
  assert.match(h.find('vis-metric-hint').textContent,/选择一个州/);
});

test('metric legend matches render colors, handles constant zero and keeps stable nodes',()=>{
  const h=harness();h.model.layers.metric='industrial_complex';
  h.model.visualizations.metric={min:0,max:15,knownCount:7};h.render();
  const legend=h.find('vis-metric-legend'),rows=[...legend.children];
  assert.equal(legend.hidden,false);
  assert.deepEqual(rows.map(row=>row.children[1].textContent),['0','7.5','15']);
  for(const [i,row] of rows.entries())assert.equal(row.children[0].style.backgroundColor,`rgb(${metricColor(i/2).slice(0,3).join(',')})`);
  h.model.visualizations.metric={min:0,max:0,knownCount:1};h.render(h.model,'en');
  assert.deepEqual(rows.map(row=>row.hidden),[true,false,true]);
  assert.equal(rows[1].children[1].textContent,'0');
  assert.match(h.all().map(node=>node.textContent).join(' '),/Missing values stay transparent/);
  assert.deepEqual(legend.children,rows);
  h.model.visualizations.metric={min:null,max:null,knownCount:0};h.render();
  assert.equal(legend.hidden,true);
  assert.deepEqual(h.calls,[],'legend must not mutate display settings');
});

test('resource legend uses area symbols, shows crowding and preserves zero/missing distinction',()=>{
  const h=harness();h.model.layers.metric='resource_oil';h.model.zoom=1;
  h.model.visualizations.metric={min:0,max:64,knownCount:7,value:0,status:'known',unit:'native-resource-value',symbols:{visibleCount:7,displacedCount:2,crowdedCount:1}};h.render();
  const legend=h.find('vis-resource-legend'),rows=[...legend.children];
  assert.equal(legend.hidden,false);assert.equal(h.find('vis-metric-legend').hidden,true);
  assert.deepEqual(rows.map(row=>row.children[1].textContent),['4','16','64']);
  for(const [i,row] of rows.entries()){
    assert.equal(row.children[0].style.width,`${2*resourceSymbolRadius([4,16,64][i],64,1)}px`);
    assert.equal(row.children[0].style.backgroundColor,resourceSymbolColor('resource_oil'));
  }
  assert.match(h.find('vis-metric-value').textContent,/0/);assert.match(h.find('vis-symbol-stats').textContent,/交叠.*1/);
  h.model.visualizations.metric.value=null;h.model.visualizations.metric.status='missing';h.render();
  assert.match(h.find('vis-metric-hint').textContent,/缺失值不视为零/);
  h.model.visualizations.metric.max=.5;h.render();
  assert.equal(rows[0].children[0].style.width,`${2*resourceSymbolRadius(.5/16,.5,1)}px`);
  assert.deepEqual(legend.children,rows);assert.deepEqual(h.calls,[]);
});

test('infrastructure has every fixed level, exact swatches and no opacity control',()=>{
  const h=harness();h.model.layers.metric='infrastructure';h.model.visualizations.metric={min:2,max:8,knownCount:5};h.render();
  const legend=h.find('vis-level-legend');assert.equal(legend.hidden,false);
  assert.equal(legend.children.length,11);assert.equal(h.find('vis-metric-settings').hidden,true);
  assert.equal(h.find('vis-resource-legend').hidden,true);assert.equal(h.find('vis-metric-legend').hidden,true);
  for(const [level,row]of legend.children.entries()){
    assert.equal(row.children[1].textContent,String(level));
    assert.equal(row.children[0].style.backgroundColor,`rgb(${infrastructureColor(level).slice(0,3).join(',')})`);
  }
  h.model.visualizations.metric={value:2,status:'known',min:0,max:10,unit:'native-province-level-sum'};h.model.layers.metric='naval_base';h.render();
  assert.match(h.find('vis-metric-hint').textContent,/省份建设等级合计/);
});

test('load failures expose retry, pending state and recovery without raw asset paths',async()=>{
  const h=harness();h.model.layers.terrain=true;
  h.model.visualizations={statuses:{terrain:{status:'error',error:'bad/file.json'},terrainPalette:{status:'ready'}},decodedBytes:1048576};h.render();
  assert.equal(h.find('vis-retry').hidden,false);assert.match(h.find('vis-memory').textContent,/1.0 MiB/);
  assert.ok(h.all().some(node=>node.dataset.status==='error'&&node.textContent==='暂不可用'));
  assert.equal(h.all().some(node=>node.textContent.includes('bad/file.json')),false);
  h.find('vis-retry').fire('click');assert.equal(h.find('vis-retry').disabled,true);
  await new Promise(setImmediate);assert.deepEqual(h.calls,[['retry']]);assert.equal(h.find('vis-retry').disabled,false);
  h.model.visualizations.statuses.terrain.status='loading';h.render();
  assert.ok(h.all().some(node=>node.dataset.status==='loading'&&node.textContent==='加载中…'));
  h.model.visualizations.statuses.terrain.status='ready';h.render();assert.equal(h.find('vis-retry').hidden,true);
});

test('terrain legend unpacks palette data and deduplicates native/modern combinations by display mode',()=>{
  const h=harness();h.model.layers.terrain=true;
  const palette=[];
  for(let native=0;native<3;native++)for(let modern=0;modern<3;modern++){
    if(!native&&!modern)continue;
    const name=modern?`class${modern}`:`class${native}`;
    palette.push({code:native*16+modern,id:name,nativeClassId:native?`class${native}`:null,
      modernClassId:modern?`class${modern}`:null,label:{en:name,zh:name},
      nativeLabel:{en:`Native ${native}`,zh:`原生 ${native}`},modernLabel:{en:`Modern ${modern}`,zh:`现代 ${modern}`},
      color:'#112233',baseColor:'#445566',modernColor:'#778899'});
  }
  h.model.visualizations.terrainPalette={palette};h.model.layers.terrainMode='combined';h.render();
  assert.equal(h.find('vis-terrain-legend').children.length,2);
  const first=h.find('vis-terrain-legend').children[0];h.render();
  assert.equal(h.find('vis-terrain-legend').children[0],first,'stable model renders keep legend nodes');
  h.model.layers.terrainMode='native';h.render();
  assert.equal(h.find('vis-terrain-legend').children.length,2);
  assert.equal(h.find('vis-terrain-legend').children[0].children[0].style.backgroundColor,'#445566');
  assert.equal(h.find('vis-terrain-legend').children[0].children[1].textContent,'原生 1');
  h.model.layers.terrainMode='geomorphology';h.render();
  assert.equal(h.find('vis-terrain-legend').children[0].children[1].textContent,'现代 1');
});

test('action failures are visible and disposal removes all mutation callbacks',async()=>{
  const h=harness();h.render();h.setSession({retryVisualizations(){throw new Error('failure');}});
  h.model.visualizations.statuses={metrics:{status:'error'}};h.render();h.find('vis-retry').fire('click');
  await new Promise(setImmediate);assert.equal(h.find('visualization-error').hidden,false);
  assert.equal(h.find('vis-retry').disabled,false,'a synchronous retry failure must not leave the panel stuck');
  const input=h.find('vis-rivers');h.panel.dispose();h.panel.dispose();input.fire('change');
  assert.equal(h.calls.length,0);assert.equal(h.root.children.length,0);h.render();assert.equal(h.root.children.length,0);
});
