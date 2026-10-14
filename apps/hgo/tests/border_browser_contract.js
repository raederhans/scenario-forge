import {createRenderer} from '../src/render/renderer.js';

// Real WebGL, synthetic 20x12 source: identical fill colours deliberately make
// the distinction between state and original-owner borders observable.
export function runBorderContract() {
  const width=20,height=12,checks=[],samples={};
  const states=[{id:1,entityTag:'A',anchor:[4,6],pixelCount:95},
    {id:2,entityTag:'A',anchor:[10,6],pixelCount:48},
    {id:3,entityTag:'B',anchor:[16,6],pixelCount:96},
    {id:4,entityTag:'B',anchor:[2.5,2.5],pixelCount:1}];
  const ids=Uint16Array.from({length:width*height},(_,i)=>i===2*width+2?4:i%width<8?1:i%width<12?2:3);
  const dataset={manifest:{coordinateSpace:{width,height}},core:{states,
    provinceIds:[null,101,102,103,104],provinceStateIds:[null,1,2,3,4]},ids};
  const canvas=document.createElement('canvas'),renderer=createRenderer(canvas,dataset);
  const fill=[160,180,200,255],paintDocument={color:()=>'#a0b4c8'};
  const assert=(ok,message)=>{if(!ok)throw new Error(message);checks.push(message);};
  const pixel=(x,y)=>{const out=new Uint8Array(4);renderer.gl.readPixels(x,canvas.height-1-y,1,1,renderer.gl.RGBA,renderer.gl.UNSIGNED_BYTE,out);return [...out];};
  const same=(a,b)=>a.join(',')===b.join(',');
  function draw(scale,ratio=1,layers={borders:true},selection=new Set()){
    canvas.width=Math.round(width*scale*ratio);canvas.height=Math.round(height*scale*ratio);
    renderer.update(paintDocument,selection);renderer.draw({x:width/2,y:height/2,scale},layers,ratio);
  }
  try {
    for(const scale of [4,16]){
      draw(scale);
      const x=8*scale,y=6*scale;
      assert(same(pixel(x-2,y),fill)&&same(pixel(x+1,y),fill),`border at zoom ${scale} does not occupy a whole source pixel`);
      assert(!same(pixel(x-1,y),fill)&&!same(pixel(x,y),fill),`state boundary visible at zoom ${scale}`);
      const state=pixel(x-1,y),country=pixel(12*scale-1,y);
      assert(country[0]<state[0],'country emphasis follows original owners despite identical fill');
      samples[`zoom${scale}`]={state,country,interior:pixel(x-2,y)};
    }
    draw(4,2);
    assert(same(pixel(8*8-3,6*8),fill),'DPR 2 border stays bounded in CSS pixels');
    for(const layers of [{borders:false},{borders:true,borderWidth:0},{borders:true,borderOpacity:0}]){
      draw(4,1,layers);assert(same(pixel(31,24),fill),'disabled/zero-width/transparent borders keep original RGB');
    }
    draw(4,1,{borders:true,borderWidth:2,borderOpacity:1,borderColor:'#ff0000'});
    assert(same(pixel(31,24),[255,0,0,255]),'border width/opacity/hex colour settings reach the GPU');
    draw(4,1,{borders:true},new Set(['4']));
    assert(same(pixel(9,9),fill),'single-pixel selected state retains its entire interior RGB');
    assert(!same(pixel(13,9),fill),'small-state exterior locator is visible without recolouring its interior');
    // At low zoom a source pixel may fall between screen samples. A fixed CSS
    // anchor ring signals that selection without inventing geographic pixels.
    canvas.width=80;canvas.height=48;renderer.update(paintDocument,new Set());
    renderer.draw({x:10,y:6,scale:.2},{borders:false});
    const baseline=pixel(41,23);
    renderer.update(paintDocument,new Set(['4']));
    renderer.draw({x:10,y:6,scale:.2},{borders:false});
    const located=pixel(41,23);
    assert(!same(located,baseline)&&located[0]>baseline[0]&&located[2]<baseline[2],'subpixel selected state has a visible yellow anchor locator');
    samples.subpixelLocator={baseline,selected:located};
    assert(renderer.gl.getError()===renderer.gl.NO_ERROR,'border and locator shaders have no WebGL errors');
    return {passed:true,checks,samples};
  } finally {renderer.dispose();}
}
