import {createRenderer,drawOverlay,metricSymbolSummary} from '../src/render/renderer.js';
import {DEFAULT_LAYERS} from '../src/render/settings.js';
import {infrastructureColor} from '../src/data/metrics.js';

export function runMetricDisplayPixels(){
  const canvas=document.createElement('canvas'),overlay=document.createElement('canvas');
  canvas.width=overlay.width=200;canvas.height=overlay.height=40;
  const row=[1,1,2,2,3,3,4,4,5,5];
  const dataset={manifest:{coordinateSpace:{width:10,height:2}},ids:new Uint16Array([...row,...row]),places:[],
    core:{provinceIds:[null,1,2,3,4,5],provinceStateIds:[null,1,2,3,4,5],
      states:row.filter((_,i)=>i%2===0).map(id=>({id,entityTag:id===5?'WTR':id%2?'AAA':'BBB',anchor:[id*2-1,1]})),
      entities:[{tag:'AAA'},{tag:'BBB'},{tag:'WTR'}]}};
  const values={1:4,2:4,3:0,4:null,5:null},colors={1:'#ff0000',2:'#00ff00',3:'#0000ff',4:'#ffff00',5:'#123456'};
  const metrics={states:Object.fromEntries(Object.entries(values).map(([id,value])=>[id,{values:{infrastructure:value,resource_steel:id==='1'?4:id==='2'?16:id==='3'?0:null},stateBuildings:{}}]))};
  const resources=new Map([['metrics',{data:metrics}],['terrain',{width:1,height:1,data:new Uint8Array([1])}],
    ['terrainPalette',{data:{palette:[{code:1,color:'#ff0000',baseColor:'#ff0000'}]}}],
    ['nightLights',{width:1,height:1,data:new Uint8Array([255])}],['illumination',{width:1,height:1,data:new Uint8Array([255,128,128,255])}]]);
  const doc={labels:{},color:id=>colors[id]},view={x:5,y:1,scale:20};
  const layers={...DEFAULT_LAYERS,borders:false,labels:false,cities:false,textureOpacity:0};
  const renderer=createRenderer(canvas,dataset),gl=renderer.gl,checks=[];
  const check=(ok,message)=>{if(!ok)throw new Error(message);checks.push(message);};
  const pixel=x=>{const b=new Uint8Array(4);gl.readPixels(x,20,1,1,gl.RGBA,gl.UNSIGNED_BYTE,b);return [...b];};
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  try{
    renderer.update(doc,new Set());renderer.draw(view,layers);const water=pixel(180),original=pixel(20);
    let uploads=0;const originals={};
    for(const key of ['texImage2D','texSubImage2D']){originals[key]=gl[key];gl[key]=function(...args){uploads++;return originals[key].apply(this,args);};}
    const symbols={...layers,metric:'resource_steel',metricOpacity:1};
    renderer.setVisualizations(resources,symbols);renderer.draw(view,symbols);
    check(uploads===0,'Resources alone require no optional GPU uploads or metric fill texture');
    check(same(pixel(20),pixel(60)),'Resource map removes country hue from the land base');
    check(same(pixel(180),water),'Resource map preserves water pixels');
    drawOverlay(overlay,dataset,doc,view,symbols,1,{metrics});
    check(metricSymbolSummary(overlay).visibleCount===2,'Zero and missing resources do not create quantity circles');
    const ctx=overlay.getContext('2d'),at=x=>ctx.getImageData(x,20,1,1).data[3];
    check(at(20)>0&&at(60)>0&&at(100)===0&&at(140)===0,'Canvas symbols occupy only positive native state anchors');
    const infra={...layers,metric:'infrastructure',metricOpacity:.05};
    renderer.setVisualizations(resources,infra);renderer.draw(view,infra);
    check(same(pixel(20),infrastructureColor(4))&&same(pixel(60),infrastructureColor(4)),'Equal infrastructure levels have exact equal colors across countries');
    check(same(pixel(100),infrastructureColor(0))&&!same(pixel(100),pixel(140)),'Known level zero differs from missing records');
    const missing=pixel(140),decorated={...infra,terrain:true,terrainOpacity:1,nightLights:true,dayNight:true,textureOpacity:1};
    renderer.setVisualizations(resources,decorated);renderer.draw(view,decorated);
    check(same(pixel(20),infrastructureColor(4))&&same(pixel(140),missing),'Decoration cannot alter the level scale or missing land base');
    const before=uploads;
    for(let i=0;i<40;i++)renderer.draw({...view,x:5+i*.001},decorated);
    check(uploads===before,'Repeated pans do not upload metric or native textures');
    drawOverlay(overlay,dataset,doc,view,infra,1,{metrics});
    check(metricSymbolSummary(overlay)===null&&at(20)===0,'Switching to levels clears resource circles and summary');
    renderer.setVisualizations(null,layers);renderer.draw(view,layers);
    check(same(pixel(20),original)&&same(pixel(180),water),'Turning metrics off restores exact original colors');
    check(gl.getError()===gl.NO_ERROR,'Metric GPU path completes without GL errors');
    return {status:'PASS',checks};
  }finally{renderer.dispose();gl.getExtension('WEBGL_lose_context')?.loseContext();}
}
