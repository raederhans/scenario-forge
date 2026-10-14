// Focused real-WebGL color contract; no native assets or whole-map export needed.
import {createRenderer} from '../src/render/renderer.js';

export function runColorContract() {
  const canvas=document.createElement('canvas');canvas.width=5;canvas.height=3;
  const dataset={manifest:{coordinateSpace:{width:5,height:3}},core:{
    provinceIds:[null,101,102],provinceStateIds:[null,1,2],states:[{id:1},{id:2}],
  },ids:new Uint16Array([1,1,1,2,2,1,1,1,2,2,1,1,1,2,2])};
  const renderer=createRenderer(canvas,dataset),checks=[],samples={};
  const view={x:2.5,y:1.5,scale:1};
  const pixels=(x)=>{const out=new Uint8Array(4);renderer.gl.readPixels(x,1,1,1,renderer.gl.RGBA,renderer.gl.UNSIGNED_BYTE,out);return [...out];};
  const assert=(ok,message)=>{if(!ok)throw new Error(message);checks.push(message);};
  let color='#1a2b3c';const paintDocument={color:id=>id==='1'?color:'#4080a0'};
  try {
    renderer.update(paintDocument,new Set());renderer.draw(view,{borders:false});
    const interior=pixels(1),edge=pixels(2);
    samples.unselectedInterior=interior;
    assert(interior.join(',')==='26,43,60,255','unselected interior equals authoritative RGB');
    assert(edge.join(',')===interior.join(','),'unselected border-off edge equals authoritative RGB');
    renderer.update(paintDocument,new Set(['1']));renderer.draw(view,{borders:false});
    samples.selectedInterior=pixels(1);samples.selectedEdge=pixels(3);
    assert(pixels(1).join(',')===interior.join(','),'selection preserves authoritative interior RGB');
    assert(paintDocument.color('1')==='#1a2b3c','rendering selection does not modify the stored color');
    assert(pixels(3).join(',')!=='64,128,160,255','selection remains visible outside the boundary');
    renderer.update(paintDocument,new Set());renderer.draw(view,{borders:true});
    assert(pixels(1).join(',')===interior.join(','),'borders preserve authoritative interior RGB');
    assert(pixels(2).join(',')!==edge.join(','),'borders darken only the boundary');
    color='#abcdef';renderer.update(paintDocument,new Set(['1']));renderer.draw(view,{borders:true});
    assert(pixels(1).join(',')==='171,205,239,255','paint update remains exact while selected');
    assert(renderer.gl.getError()===renderer.gl.NO_ERROR,'no WebGL errors');
    return {passed:true,checks,samples};
  } finally {renderer.dispose();}
}
