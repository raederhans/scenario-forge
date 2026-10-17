import test from 'node:test';
import assert from 'node:assert/strict';
import {createInspectorTabs} from '../src/ui/inspector.js';

test('tabs isolate inactive controls and keyboard navigation moves focus with selection',()=>{
  let focused,prevented=0;const changes=[],panels={},tabs=['paint','countries','display'].map(name=>{
    panels[name]={hidden:false};const handlers=new Map(),attrs={'aria-selected':String(name==='paint')};
    return {dataset:{panel:name},tabIndex:0,handlers,getAttribute:key=>attrs[key],setAttribute:(key,value)=>attrs[key]=value,focus(){focused=this;},addEventListener:(key,fn)=>handlers.set(key,fn),removeEventListener:key=>handlers.delete(key)};
  });
  const controller=createInspectorTabs({root:{querySelectorAll:()=>tabs},panels,onChange:name=>changes.push(name)});
  assert.equal(panels.paint.hidden,false);assert.equal(panels.countries.hidden,true);assert.equal(tabs[1].tabIndex,-1);
  const key=(index,value)=>tabs[index].handlers.get('keydown')({key:value,preventDefault(){prevented++;}});
  key(0,'ArrowRight');assert.equal(controller.current,'countries');assert.equal(focused,tabs[1]);assert.equal(panels.paint.hidden,true);assert.equal(tabs[0].tabIndex,-1);
  key(1,'End');assert.equal(controller.current,'display');key(2,'ArrowRight');assert.equal(controller.current,'paint');
  key(0,'ArrowLeft');assert.equal(controller.current,'display');key(2,'Home');assert.equal(controller.current,'paint');
  key(0,'Tab');assert.equal(prevented,5);assert.equal(controller.current,'paint');
  tabs[1].handlers.get('click')();assert.equal(controller.current,'countries');assert.equal(panels.countries.hidden,false);
  controller.select('invalid');assert.equal(controller.current,'countries');
  assert.deepEqual(changes,['paint','countries','display','paint','display','paint','countries']);
  controller.dispose();assert.ok(tabs.every(tab=>tab.handlers.size===0));
});
