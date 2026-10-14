import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocument} from '../src/document/document.js';
import {DEFAULT_LAYERS,readLayers,validDisplayOption} from '../src/render/settings.js';

test('old projects receive display defaults; new options round-trip and invalid imports stay atomic',()=>{
  const dataset={manifest:{id:'display',revision:'1',coordinateSpace:{width:2,height:2}},stateById:new Map([['1',{entityTag:'A'}]]),entityByTag:new Map([['A',{color:'#123456'}]])};
  const doc=createDocument(dataset),view={x:1,y:1,scale:1};
  const old=doc.serialize(view,{borders:true,labels:true,cities:false});
  assert.deepEqual(doc.load(old).layers,{...DEFAULT_LAYERS,cities:false});
  const layers={...DEFAULT_LAYERS,borderWidth:1.3,borderColor:'#abcdef',borderOpacity:0.2,labelDensity:'low'};
  assert.deepEqual(doc.load(doc.serialize(view,layers)).layers,layers);
  doc.paintStates(['1'],'#fedcba');
  const before=doc.serialize(view,layers);
  for(const [key,value] of [['borderWidth',3],['borderOpacity',-1],['borderColor','#xyzxyz'],['labelDensity','unlimited'],['unknown',true]]){
    assert.equal(validDisplayOption(key,value),false);
    assert.throws(()=>doc.load({...before,layers:{...layers,[key]:value}}),/layers/);
    assert.deepEqual(doc.serialize(view,layers),before);assert.equal(doc.canUndo,true);
  }
  assert.throws(()=>readLayers({...layers,labels:1}),/layers/);
});
