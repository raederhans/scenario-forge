import test from 'node:test';
import assert from 'node:assert/strict';
import {createVisualizationGpu} from '../src/render/visualization.js';
import {DEFAULT_LAYERS} from '../src/render/settings.js';

test('river distance textures upload only on resource changes and release on disable',()=>{
  let id=0,unit;const uploads=[],deleted=[],values=new Map();
  const gl=new Proxy({
    activeTexture(value){unit=value;},
    texImage2D(...args){uploads.push({unit,width:args[3],height:args[4],data:args[8]});},
    deleteTexture(texture){deleted.push(texture);},
    getUniformLocation(_program,name){return name;},
    uniform1f(name,value){values.set(name,value);},
    uniform1i(name,value){values.set(name,value);}
  },{get:(target,key)=>key in target?target[key]:
    String(key).toUpperCase()===key?key:()=>({id:++id})});
  const dataset={core:{provinceIds:[null,1,2],provinceStateIds:[null,1,2],
    states:[{id:1,entityTag:'AAA'},{id:2,entityTag:'WTR'}]}};
  const gpu=createVisualizationGpu(gl,{},dataset);
  const nativeMask=uploads.find(u=>u.width===256);
  assert.deepEqual([...nativeMask.data.slice(0,3)],[0,255,0]);
  const balanced={width:2,height:2,data:new Uint8Array([120,136,120,136])};
  const fine={width:4,height:4,data:new Uint8Array(16).fill(136)};
  const resources=new Map([['riversBalanced',balanced],['rivers',fine]]);
  let layers={...DEFAULT_LAYERS,rivers:true};
  gpu.sync(resources,layers);
  assert.ok(uploads.some(upload=>upload.data===balanced.data));
  const count=uploads.length;
  for(const width of [.5,1,3]){
    layers={...layers,riverWidth:width};
    gpu.sync(resources,layers);gpu.draw(layers);
    assert.equal(values.get('riverWidth'),width);
    assert.equal(values.get('riverOpacity'),DEFAULT_LAYERS.riverOpacity);
    assert.equal(values.get('riversEnabled'),1);
  }
  assert.equal(uploads.length,count,'slider/draw must not regenerate or upload the field');
  layers={...layers,quality:'fine'};gpu.sync(resources,layers);
  assert.equal(uploads.length,count+1);assert.equal(uploads.at(-1).data,fine.data);
  gpu.sync(resources,{...layers,rivers:false});gpu.draw({...layers,rivers:false});
  assert.equal(uploads.at(-1).width,1);assert.equal(uploads.at(-1).height,1);
  assert.equal(values.get('riversEnabled'),0);
  gpu.dispose();gpu.dispose();assert.equal(deleted.length,7);
});
