import {createDocument,validColor} from './document/document.js';
import {hitTest} from './interaction/hit.js';
import {createRenderer,drawOverlay} from './render/renderer.js';

export function createHgoSession({canvas,overlayCanvas,dataset,onChange=()=>{},onError=()=>{}}) {
  const document=createDocument(dataset), {width,height}=dataset.manifest.coordinateSpace;
  let renderer=createRenderer(canvas,dataset), disposed=false, ready=true, tool='select',color='#d17b55',selection=new Set(),view={x:width/2,y:height/2,scale:1},layers={borders:true,labels:true,cities:true},status=dataset.placesWarning?`Cities unavailable: ${dataset.placesWarning}`:'Ready',raf=0,drag=null;
  const listeners=[],win=canvas.ownerDocument.defaultView;
  let viewDirty=false;
  function listen(target,event,handler,options){target.addEventListener(event,handler,options);listeners.push(()=>target.removeEventListener(event,handler,options));}
  function model(){return {ready:ready&&!disposed,dirty:document.dirty||viewDirty,tool,color,selection:[...selection].map(id=>{const s=dataset.stateById.get(id);return {id:s.id,name:document.labels[id]||s.name,entityTag:s.entityTag,color:document.color(id)};}),canUndo:document.canUndo,canRedo:document.canRedo,zoom:view.scale,layers:{...layers},stats:{stateCount:dataset.core.states.length,provinceCount:dataset.core.provinceIds.length-1},status};}
  function emit(){if(!disposed)onChange(model());}
  function draw(){raf=0;if(!ready||disposed)return;try{const ratio=canvas.width/(canvas.clientWidth||1);renderer.draw(view,layers,ratio);drawOverlay(overlayCanvas,dataset,document,view,layers,ratio);}catch(e){onError(e);}}
  function schedule(){if(!raf&&!disposed&&ready)raf=win.requestAnimationFrame(draw);}
  function changed(palette=false){if(disposed)return;if(palette&&ready)renderer.update(document,selection);schedule();emit();}
  function resize(){if(disposed)return;const ratio=Math.min(win.devicePixelRatio||1,2);for(const c of [canvas,overlayCanvas]){const w=Math.max(1,Math.round(canvas.clientWidth*ratio)),h=Math.max(1,Math.round(canvas.clientHeight*ratio));if(c.width!==w)c.width=w;if(c.height!==h)c.height=h;}schedule();}
  function fit(initial=false){check();view={x:width/2,y:height/2,scale:Math.min((canvas.clientWidth||width)/width,(canvas.clientHeight||height)/height)*.96};if(!initial)viewDirty=true;changed();}
  function check(){if(disposed)throw new Error('HGO session has been disposed');}
  function zoom(factor,anchor){check();if(!Number.isFinite(factor)||factor<=0)throw new Error('Invalid zoom factor');const previous=view.scale;view.scale=Math.min(128,Math.max(.015,previous*factor));if(anchor){view.x+=anchor[0]/previous-anchor[0]/view.scale;view.y+=anchor[1]/previous-anchor[1]/view.scale;}viewDirty=true;changed();}
  function position(e){const r=canvas.getBoundingClientRect();return [e.clientX-r.left,e.clientY-r.top];}
  listen(canvas,'pointerdown',e=>{if(!ready||e.button!==0)return;const [x,y]=position(e);drag={id:e.pointerId,x,y,lastX:x,lastY:y,moved:false};canvas.setPointerCapture(e.pointerId);});
  listen(canvas,'pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;const [x,y]=position(e);if(Math.hypot(x-drag.x,y-drag.y)>4)drag.moved=true;if(drag.moved||tool==='pan'){view.x-=(x-drag.lastX)/view.scale;view.y-=(y-drag.lastY)/view.scale;viewDirty=true;changed();}drag.lastX=x;drag.lastY=y;});
  listen(canvas,'pointerup',e=>{if(!drag||drag.id!==e.pointerId)return;const d=drag;drag=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);if(d.moved||tool==='pan')return;const [x,y]=position(e),hit=hitTest(dataset,(x-canvas.clientWidth/2)/view.scale+view.x,(y-canvas.clientHeight/2)/view.scale+view.y);if(!hit){selection.clear();changed(true);return;}if(e.shiftKey){if(selection.has(hit.stateId))selection.delete(hit.stateId);else selection.add(hit.stateId);}else selection=new Set([hit.stateId]);if(tool==='paint')document.paintStates([hit.stateId],color);status=`Province ${hit.provinceId} · State ${hit.stateId}`;changed(true);});
  const cancel=()=>{if(drag&&canvas.hasPointerCapture(drag.id))canvas.releasePointerCapture(drag.id);drag=null;};
  listen(canvas,'pointercancel',cancel);listen(canvas,'lostpointercapture',()=>{drag=null;});
  listen(canvas,'wheel',e=>{e.preventDefault();if(!ready)return;const [x,y]=position(e);zoom(Math.exp(-Math.max(-100,Math.min(100,e.deltaY))*.003),[x-canvas.clientWidth/2,y-canvas.clientHeight/2]);},{passive:false});
  listen(canvas,'webglcontextlost',e=>{e.preventDefault();cancel();ready=false;renderer.dispose({contextLost:true});status='Graphics context lost; waiting for recovery';if(raf)win.cancelAnimationFrame(raf);raf=0;emit();});
  listen(canvas,'webglcontextrestored',()=>{if(disposed)return;try{renderer=createRenderer(canvas,dataset);ready=true;status='Graphics context restored';changed(true);}catch(e){ready=false;status=e.message;onError(e);emit();}});
  const observer=typeof win.ResizeObserver==='function'?new win.ResizeObserver(resize):null;observer?.observe(canvas);if(!observer)listen(win,'resize',resize);
  resize();fit(true);renderer.update(document,selection);
  const api={
    getViewModel:model,
    setTool(value){check();if(!['select','paint','pan'].includes(value))throw new Error('Invalid tool');tool=value;cancel();emit();},
    setColor(value){check();if(!validColor(value))throw new Error('Invalid color');color=value.toLowerCase();emit();},
    setSelection(values){check();selection=new Set(document.validateIds(values));changed(true);},
    paintSelection(value=color){check();document.paintStates([...selection],value);changed(true);},
    paintStates(values,value){check();document.paintStates(values,value);changed(true);},
    resetSelection(){check();selection.clear();changed(true);},
    undo(){check();document.undo();changed(true);},redo(){check();document.redo();changed(true);},
    fit(){fit();},zoomBy:zoom,
    focusState(id){check();const s=dataset.stateById.get(String(id));if(!s)throw new Error('Unknown state');const b=s.bounds||[s.anchor[0]-10,s.anchor[1]-10,s.anchor[0]+10,s.anchor[1]+10];view={x:s.anchor[0],y:s.anchor[1],scale:Math.min(32,Math.max(.1,Math.min(canvas.clientWidth/Math.max(8,b[2]-b[0]),canvas.clientHeight/Math.max(8,b[3]-b[1]))*.55))};viewDirty=true;selection=new Set([String(id)]);changed(true);},
    search(query,{limit=50}={}){check();const q=String(query).trim().toLocaleLowerCase();if(!q)return [];const max=Math.max(0,Math.min(500,Math.floor(limit)||0)),found=[];for(const s of dataset.core.states){const name=document.labels[s.id]||s.name;if(`${s.id} ${name} ${s.nameKey||''} ${s.entityTag}`.toLocaleLowerCase().includes(q)){found.push({id:s.id,name,entityTag:s.entityTag});if(found.length>=max)break;}}return max?found:[];},
    setLayer(name,enabled){check();if(!Object.hasOwn(layers,name)||typeof enabled!=='boolean')throw new Error('Invalid layer');layers[name]=enabled;viewDirty=true;changed();},
    setLabel(id,text){check();document.label(id,text);changed();},
    serializeDocument(){check();return document.serialize(view,layers);},
    loadDocument(payload){check();const next=document.load(payload);view=next.view;layers=next.layers;selection.clear();viewDirty=false;status='Project opened';changed(true);},
    async exportPng({width:outWidth=width,height:outHeight=height}={}){
      check();if(!Number.isInteger(outWidth)||!Number.isInteger(outHeight)||outWidth<1||outHeight<1||outWidth*outHeight>40e6||Math.max(outWidth,outHeight)>16384)throw new Error('Invalid PNG dimensions');
      const target=canvas.ownerDocument.createElement('canvas'),overlay=canvas.ownerDocument.createElement('canvas'),result=canvas.ownerDocument.createElement('canvas');for(const c of [target,overlay,result]){c.width=outWidth;c.height=outHeight;}
      let exportRenderer;
      try{exportRenderer=createRenderer(target,dataset);exportRenderer.update(document,new Set());const exportView={x:width/2,y:height/2,scale:Math.min(outWidth/width,outHeight/height)};exportRenderer.draw(exportView,layers);drawOverlay(overlay,dataset,document,exportView,layers);const ctx=result.getContext('2d');ctx.drawImage(target,0,0);ctx.drawImage(overlay,0,0);const blob=await new Promise((resolve,reject)=>result.toBlob(b=>b?resolve(b):reject(new Error('PNG encoding failed')),'image/png'));check();return blob;}finally{exportRenderer?.dispose();exportRenderer?.gl.getExtension('WEBGL_lose_context')?.loseContext();for(const c of [target,overlay,result]){c.width=1;c.height=1;}}
    },
    markSaved(){check();document.markSaved();viewDirty=false;emit();},resize,
    dispose(){if(disposed)return;cancel();disposed=true;ready=false;if(raf)win.cancelAnimationFrame(raf);for(const off of listeners)off();observer?.disconnect();renderer.dispose();renderer.gl.getExtension('WEBGL_lose_context')?.loseContext();overlayCanvas.getContext('2d').clearRect(0,0,overlayCanvas.width,overlayCanvas.height);selection.clear();}
  };
  return api;
}
