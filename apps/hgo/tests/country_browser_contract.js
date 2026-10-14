import {createRenderer} from '../src/render/renderer.js';

export function runCountryRenderContract(){
  const canvas=document.createElement('canvas');canvas.width=40;canvas.height=16;
  const dataset={manifest:{coordinateSpace:{width:10,height:4}},core:{
    entities:[{tag:'AAA'}],provinceIds:[null,10,20],provinceStateIds:[null,1,2],
    states:[{id:1,entityTag:'AAA',coreTags:[],pixelCount:20,anchor:[2.5,2]},
      {id:2,entityTag:'AAA',coreTags:['BBB'],pixelCount:20,anchor:[7.5,2]}],
  },ids:Uint16Array.from({length:40},(_,i)=>i%10<5?1:2)};
  const checks=[],assert=(ok,message)=>{if(!ok)throw new Error(message);checks.push(message);};
  let revision=0,transferred=false;
  const editDocument={get ownerRevision(){return revision;},owner:id=>transferred&&id==='2'?'BBB':'AAA',color:()=>'#a0b4c8'};
  const renderer=createRenderer(canvas,dataset),gl=renderer.gl;
  let uploads=0,lastTable;
  const upload=gl.texSubImage2D.bind(gl);
  gl.texSubImage2D=(...args)=>{if(args[6]===gl.RG_INTEGER){uploads++;lastTable=new Uint16Array(args[8]);}return upload(...args);};
  const view={x:5,y:2,scale:4},layers={borders:true};
  const pixel=x=>{const out=new Uint8Array(4);gl.readPixels(x,8,1,1,gl.RGBA,gl.UNSIGNED_BYTE,out);return [...out];};
  try{
    renderer.update(editDocument,new Set());renderer.draw(view,layers);const original=pixel(19);
    assert(uploads===1,'initial document owner table is uploaded');
    for(let n=0;n<5;n++)renderer.update(editDocument,new Set());
    assert(uploads===1,'unchanged owner revision avoids table reuploads');
    transferred=true;revision++;renderer.update(editDocument,new Set());renderer.draw(view,layers);const current=pixel(19);
    assert(uploads===2&&current[0]<original[0],'current owner transfer changes country boundary with identical fill colours');
    assert(lastTable[2]===1&&lastTable[4]===2,'original state channel stays unchanged');
    assert(lastTable[3]!==lastTable[5],'valid core-only target has its own GPU owner identity');
    assert(pixel(10).join(',')==='160,180,200,255','current country borders preserve exact interior RGB');
    renderer.update({color:()=>'#a0b4c8'},new Set());renderer.draw(view,layers);
    assert(pixel(19).join(',')===original.join(','),'legacy document fallback restores original owner borders');
    renderer.update(editDocument,new Set());renderer.draw(view,layers);
    assert(pixel(19).join(',')===current.join(','),'returning to edited document restores current owner borders');
    const exportCanvas=document.createElement('canvas');exportCanvas.width=40;exportCanvas.height=16;
    const fresh=createRenderer(exportCanvas,dataset);
    try{fresh.update(editDocument,new Set());fresh.draw(view,layers);const exported=new Uint8Array(4);fresh.gl.readPixels(19,8,1,1,fresh.gl.RGBA,fresh.gl.UNSIGNED_BYTE,exported);assert([...exported].join(',')===current.join(','),'fresh export/recovery renderer starts with current owner boundaries');}finally{fresh.dispose();}
    assert(gl.getError()===gl.NO_ERROR,'current owner rendering has no WebGL errors');
    return {passed:true,checks,samples:{original,current},ownerUploads:uploads};
  }finally{gl.texSubImage2D=upload;renderer.dispose();}
}
