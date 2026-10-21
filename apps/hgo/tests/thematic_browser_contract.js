import {createRenderer} from '../src/render/renderer.js';
import {DEFAULT_LAYERS} from '../src/render/settings.js';

export function runThematicPixels(){
  const canvas=document.createElement('canvas');canvas.width=120;canvas.height=40;
  const dataset={manifest:{coordinateSpace:{width:6,height:2}},ids:new Uint16Array([1,1,2,2,3,3,1,1,2,2,3,3]),
    core:{provinceIds:[null,1,2,3],provinceStateIds:[null,1,2,3],
      states:[{id:1,entityTag:'AAA'},{id:2,entityTag:'AAA'},{id:3,entityTag:'WTR'}],entities:[{tag:'AAA'},{tag:'WTR'}]}};
  const colors={1:'#993333',2:'#339933',3:'#123456'},mapDocument={color:id=>colors[id]},before=JSON.stringify(colors);
  const renderer=createRenderer(canvas,dataset),gl=renderer.gl;
  const check=(ok,message)=>{if(!ok)throw new Error(message);};
  const read=()=>{const bytes=new Uint8Array(120*40*4);gl.readPixels(0,0,120,40,gl.RGBA,gl.UNSIGNED_BYTE,bytes);return bytes;};
  const view={x:3,y:1,scale:20},layers={...DEFAULT_LAYERS,borders:false};
  try{
    renderer.update(mapDocument,new Set());renderer.draw(view,layers);const political=read();
    let uploads=0;const originals={};
    for(const key of ['texImage2D','texSubImage2D']){originals[key]=gl[key];gl[key]=function(...args){uploads++;return originals[key].apply(this,args);};}
    const theme={...layers,baseMapStyle:'thematic'};
    renderer.draw(view,theme);const thematic=read();
    for(const [key,value] of Object.entries(originals))gl[key]=value;
    check(uploads===0,'Thematic switch must not rebuild textures');
    check(JSON.stringify(colors)===before,'Thematic display must preserve the document palette');
    const pixel=(image,x)=>Array.from(image.slice((20*120+x)*4,(20*120+x)*4+4));
    check(JSON.stringify(pixel(political,100))===JSON.stringify(pixel(thematic,100)),'Water color must remain exact');
    check(pixel(thematic,20)[0]>pixel(political,20)[0]&&pixel(thematic,20)[1]>pixel(political,20)[1],'Land base must become lighter');
    check(Math.abs(pixel(thematic,20)[0]-pixel(thematic,20)[1])<20,'Land base must suppress political hue');
    // Same-owner state border remains visible, with lower coverage.
    const border={...layers,borders:true,borderWidth:2,borderOpacity:1,borderColor:'#000000'};
    renderer.draw(view,border);const strong=read();renderer.draw(view,{...border,baseMapStyle:'thematic'});const quiet=read();
    check(pixel(quiet,39)[0]>pixel(strong,39)[0],'Thematic state borders must be quieter');
    renderer.draw(view,layers);check(read().every((v,i)=>v===political[i]),'Returning to political style must restore exact pixels');
    check(gl.getError()===gl.NO_ERROR,'Thematic GL operations must succeed');
    return {status:'PASS',uploads,checks:['water exact','land neutral','state borders quiet','palette unchanged','political pixels restored']};
  }finally{renderer.dispose();gl.getExtension('WEBGL_lose_context')?.loseContext();}
}
