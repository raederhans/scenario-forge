import {createDocument,validColor} from './document/document.js';
import {hitTest} from './interaction/hit.js';
import {createPaintScopes,tracePaintStates} from './interaction/paint.js';
import {createRenderer,drawOverlay} from './render/renderer.js';
import {DEFAULT_LAYERS,validDisplayOption} from './render/settings.js';

export function createHgoSession({canvas,overlayCanvas,dataset,onChange=()=>{},onError=()=>{}}) {
  const document=createDocument(dataset), {width,height}=dataset.manifest.coordinateSpace;
  let renderer=createRenderer(canvas,dataset), disposed=false, ready=true, tool='select',color='#d17b55',selection=new Set(),view={x:width/2,y:height/2,scale:1},layers={...DEFAULT_LAYERS},status=dataset.placesWarning?`Cities unavailable: ${dataset.placesWarning}`:'Ready',raf=0,drag=null;
  const listeners=[],win=canvas.ownerDocument.defaultView;
  const scopeStates=createPaintScopes(dataset);
  let paintScope='state',pendingClick=null,spacePan=false,brushPoints=[],lastPointerWasDrag=false;
  let viewDirty=false,exporting=false;
  function listen(target,event,handler,options){target.addEventListener(event,handler,options);listeners.push(()=>target.removeEventListener(event,handler,options));}
  function model(){return {ready:ready&&!disposed,dirty:document.dirty||viewDirty,tool,color,paintScope,selection:[...selection].map(id=>{const s=dataset.stateById.get(id);return {id:s.id,name:document.labels[id]||s.name,entityTag:s.entityTag,color:document.color(id)};}),canUndo:document.canUndo,canRedo:document.canRedo,zoom:view.scale,layers:{...layers},stats:{stateCount:dataset.core.states.length,provinceCount:dataset.core.provinceIds.length-1},status};}
  function emit(){if(!disposed)onChange(model());}
  function draw(){raf=0;if(!ready||disposed)return;try{if(flushBrush()){renderer.update(document,selection);emit();}const ratio=canvas.width/(canvas.clientWidth||1);renderer.draw(view,layers,ratio);drawOverlay(overlayCanvas,dataset,document,view,layers,ratio);}catch(e){onError(e);}}
  function schedule(){if(!raf&&!disposed&&ready)raf=win.requestAnimationFrame(draw);}
  function changed(palette=false){if(disposed)return;if(palette&&ready)renderer.update(document,selection);schedule();emit();}
  function resize(){if(disposed)return;const ratio=Math.min(win.devicePixelRatio||1,2);for(const c of [canvas,overlayCanvas]){const w=Math.max(1,Math.round(canvas.clientWidth*ratio)),h=Math.max(1,Math.round(canvas.clientHeight*ratio));if(c.width!==w)c.width=w;if(c.height!==h)c.height=h;}schedule();}
  function fit(initial=false){check();finishInteraction();view={x:width/2,y:height/2,scale:Math.min((canvas.clientWidth||width)/width,(canvas.clientHeight||height)/height)*.96};if(!initial)viewDirty=true;changed();}
  function check(){if(disposed)throw new Error('HGO session has been disposed');}
  function zoom(factor,anchor){check();if(!Number.isFinite(factor)||factor<=0)throw new Error('Invalid zoom factor');finishInteraction();const previous=view.scale;view.scale=Math.min(128,Math.max(.015,previous*factor));if(anchor){view.x+=anchor[0]/previous-anchor[0]/view.scale;view.y+=anchor[1]/previous-anchor[1]/view.scale;}viewDirty=true;changed();}
  function position(e){const r=canvas.getBoundingClientRect();return [e.clientX-r.left,e.clientY-r.top];}
  const timeout=(fn,ms)=>(win.setTimeout||setTimeout)(fn,ms);
  const clearTimer=id=>(win.clearTimeout||clearTimeout)(id);
  function mapPoint(x,y){return [(x-canvas.clientWidth/2)/view.scale+view.x,(y-canvas.clientHeight/2)/view.scale+view.y];}
  function flushBrush(){
    if(!drag?.brush||!brushPoints.length)return false;
    let edited=false;
    for(const point of brushPoints){
      const hits=tracePaintStates(dataset,drag.mapLast,point);
      for(const id of hits){
        const state=dataset.stateById.get(id),key=paintScope==='country'&&state.entityTag!=='WTR'?`country:${state.entityTag}`:`state:${id}`;
        if(drag.visited.has(key))continue;
        drag.visited.add(key);
        edited=document.paintStrokeStates(scopeStates(id,paintScope))||edited;
        selection=new Set([id]);
      }
      drag.mapLast=point;
    }
    brushPoints=[];return edited;
  }
  function finishPending(cancelled=false){
    if(!pendingClick)return;
    clearTimer(pendingClick.timer);pendingClick=null;
    return cancelled?document.cancelPaintStroke():document.endPaintStroke();
  }
  function finishInteraction(cancelled=false){
    let edited=finishPending(cancelled);
    if(drag?.brush){if(!cancelled)edited=flushBrush()||edited;edited=(cancelled?document.cancelPaintStroke():document.endPaintStroke())||edited;}
    const captured=drag?.id;drag=null;brushPoints=[];
    if(captured!==undefined&&canvas.hasPointerCapture(captured))canvas.releasePointerCapture(captured);
    if(edited&&ready&&!disposed){renderer.update(document,selection);schedule();emit();}
  }
  listen(win,'keydown',e=>{if(e.code==='Space'&&e.target===canvas){spacePan=true;e.preventDefault();}});
  listen(win,'keyup',e=>{if(e.code==='Space')spacePan=false;});
  listen(win,'blur',()=>{spacePan=false;finishInteraction(true);changed(true);});
  listen(canvas,'pointerdown',e=>{
    if(!ready||![0,1].includes(e.button)||drag)return;
    const [x,y]=position(e);
    // Keep a click preview uncommitted until native double-click disambiguation.
    if(pendingClick){finishPending(tool==='paint'&&e.button===0&&!spacePan&&Math.hypot(x-pendingClick.x,y-pendingClick.y)<=4);changed(true);}
    const p=mapPoint(x,y);
    drag={id:e.pointerId,x,y,lastX:x,lastY:y,moved:false,pan:tool==='pan'||spacePan||e.button===1,brush:false,mapLast:p,visited:new Set()};
    canvas.setPointerCapture(e.pointerId);e.preventDefault?.();
  });
  listen(canvas,'pointermove',e=>{
    if(!drag||drag.id!==e.pointerId)return;
    const [x,y]=position(e);
    if(Math.hypot(x-drag.x,y-drag.y)>4)drag.moved=true;
    if(drag.pan||(drag.moved&&tool!=='paint')){
      view.x-=(x-drag.lastX)/view.scale;view.y-=(y-drag.lastY)/view.scale;viewDirty=true;changed();
    }else if(drag.moved&&tool==='paint'){
      if(!drag.brush){document.beginPaintStroke(color);drag.brush=true;}
      if(brushPoints.length>=256)flushBrush();
      brushPoints.push(mapPoint(x,y));schedule();
    }
    drag.lastX=x;drag.lastY=y;
  });
  listen(canvas,'pointerup',e=>{
    if(!drag||drag.id!==e.pointerId)return;
    const d=drag,[x,y]=position(e);
    lastPointerWasDrag=d.moved||d.pan;
    if(d.brush){brushPoints.push(mapPoint(x,y));flushBrush();document.endPaintStroke();}
    drag=null;brushPoints=[];
    if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
    if(d.brush){changed(true);return;}
    if(d.moved||d.pan)return;
    const hit=hitTest(dataset,...mapPoint(x,y));
    if(!hit){selection.clear();changed(true);return;}
    if(e.shiftKey){if(selection.has(hit.stateId))selection.delete(hit.stateId);else selection.add(hit.stateId);}
    else selection=new Set([hit.stateId]);
    if(tool==='pick')color=document.color(hit.stateId).toLowerCase();
    if(tool==='paint'){
      document.beginPaintStroke(color);document.paintStrokeStates(scopeStates(hit.stateId,paintScope));
      pendingClick={x,y,timer:timeout(()=>{pendingClick=null;document.endPaintStroke();changed(true);},550)};
    }
    status=`Province ${hit.provinceId} · State ${hit.stateId}`;changed(true);
  });
  listen(canvas,'dblclick',e=>{
    if(!ready||e.button!==0||!['paint','select'].includes(tool)||spacePan||lastPointerWasDrag)return;
    e.preventDefault();finishInteraction(true);
    const [x,y]=position(e),hit=hitTest(dataset,...mapPoint(x,y));if(!hit)return;
    const ids=scopeStates(hit.stateId,'country');selection=new Set(ids);
    if(tool==='paint')document.paintStates(ids,color);
    changed(true);
  });
  const cancel=()=>{finishInteraction(true);changed(true);};
  listen(canvas,'pointercancel',cancel);listen(canvas,'lostpointercapture',()=>{if(drag)cancel();});
  listen(canvas,'wheel',e=>{e.preventDefault();if(!ready)return;finishInteraction();const [x,y]=position(e);zoom(Math.exp(-Math.max(-100,Math.min(100,e.deltaY))*.003),[x-canvas.clientWidth/2,y-canvas.clientHeight/2]);},{passive:false});
  listen(canvas,'webglcontextlost',e=>{e.preventDefault();finishInteraction(true);ready=false;renderer.dispose({contextLost:true});status='Graphics context lost; waiting for recovery';if(raf)win.cancelAnimationFrame(raf);raf=0;emit();});
  listen(canvas,'webglcontextrestored',()=>{if(disposed)return;try{renderer=createRenderer(canvas,dataset);ready=true;status='Graphics context restored';changed(true);}catch(e){ready=false;status=e.message;onError(e);emit();}});
  const observer=typeof win.ResizeObserver==='function'?new win.ResizeObserver(resize):null;observer?.observe(canvas);if(!observer)listen(win,'resize',resize);
  resize();fit(true);renderer.update(document,selection);
  const api={
    getViewModel:model,
    setTool(value){check();if(!['select','paint','pan','pick'].includes(value))throw new Error('Invalid tool');finishInteraction();tool=value;changed(true);},
    setColor(value){check();if(!validColor(value))throw new Error('Invalid color');finishInteraction();color=value.toLowerCase();changed(true);},
    setPaintScope(value){check();if(!['state','country'].includes(value))throw new Error('Invalid paint scope');finishInteraction();paintScope=value;changed(true);},
    pickColor(id){check();document.validateIds([id]);finishInteraction();color=document.color(String(id)).toLowerCase();emit();return color;},
    setSelection(values){check();const ids=document.validateIds(values);finishInteraction();selection=new Set(ids);changed(true);},
    paintSelection(value=color){check();if(!validColor(value))throw new Error('Invalid paint color');finishInteraction();document.paintStates([...new Set([...selection].flatMap(id=>scopeStates(id,paintScope)))],value);changed(true);},
    paintStates(values,value){check();document.validateIds(values);if(!validColor(value))throw new Error('Invalid paint color');finishInteraction();document.paintStates(values,value);changed(true);},
    resetSelection(){check();finishInteraction(true);selection.clear();changed(true);},
    undo(){check();finishInteraction();document.undo();changed(true);},redo(){check();finishInteraction();document.redo();changed(true);},
    fit(){fit();},zoomBy:zoom,
    focusState(id){check();const s=dataset.stateById.get(String(id));if(!s)throw new Error('Unknown state');finishInteraction();const b=s.bounds||[s.anchor[0]-10,s.anchor[1]-10,s.anchor[0]+10,s.anchor[1]+10];view={x:s.anchor[0],y:s.anchor[1],scale:Math.min(32,Math.max(.1,Math.min(canvas.clientWidth/Math.max(8,b[2]-b[0]),canvas.clientHeight/Math.max(8,b[3]-b[1]))*.55))};viewDirty=true;selection=new Set([String(id)]);changed(true);},
    search(query,{limit=50}={}){check();const q=String(query).trim().toLocaleLowerCase();if(!q)return [];const max=Math.max(0,Math.min(500,Math.floor(limit)||0)),found=[];for(const s of dataset.core.states){const name=document.labels[s.id]||s.name;if(`${s.id} ${name} ${s.nameKey||''} ${s.entityTag}`.toLocaleLowerCase().includes(q)){found.push({id:s.id,name,entityTag:s.entityTag});if(found.length>=max)break;}}return max?found:[];},
    setLayer(name,enabled){check();if(!['borders','labels','cities'].includes(name)||typeof enabled!=='boolean')throw new Error('Invalid layer');finishInteraction();layers[name]=enabled;viewDirty=true;changed();},
    setDisplayOption(name,value){check();if(!validDisplayOption(name,value))throw new Error('Invalid display option');finishInteraction();layers[name]=name==='borderColor'?value.toLowerCase():value;viewDirty=true;changed();},
    setLabel(id,text){check();document.validateIds([id]);if(typeof text!=='string'||text.length>200)throw new Error('Invalid label');finishInteraction();document.label(id,text);changed();},
    serializeDocument(){check();finishInteraction();return document.serialize(view,layers);},
    loadDocument(payload){check();const next=document.load(payload);finishInteraction(true);view=next.view;layers=next.layers;selection.clear();viewDirty=false;status='Project opened';changed(true);},
    async exportPng({width:outWidth=width,height:outHeight=height}={}){
      check();if(!Number.isInteger(outWidth)||!Number.isInteger(outHeight)||outWidth<1||outHeight<1||outWidth*outHeight>40e6||Math.max(outWidth,outHeight)>16384)throw new Error('Invalid PNG dimensions');
      if(!ready)throw new Error('Graphics context is not ready');
      if(exporting)throw new Error('PNG export already in progress');
      finishInteraction();
      exporting=true;
      let target,result,exportRenderer;
      function releaseGpu(){if(exportRenderer){exportRenderer.dispose();exportRenderer.gl.getExtension('WEBGL_lose_context')?.loseContext();exportRenderer=null;}if(target){target.width=1;target.height=1;}}
      try{
        target=canvas.ownerDocument.createElement('canvas');result=canvas.ownerDocument.createElement('canvas');
        for(const c of [target,result]){c.width=outWidth;c.height=outHeight;}
        exportRenderer=createRenderer(target,dataset);exportRenderer.update(document,new Set());
        const exportView={x:width/2,y:height/2,scale:Math.min(outWidth/width,outHeight/height)};
        exportRenderer.draw(exportView,layers);
        const ctx=result.getContext('2d');if(!ctx)throw new Error('PNG canvas unavailable');
        ctx.drawImage(target,0,0);
        // Composite labels into the output directly, avoiding a full-size
        // transparent overlay. Release temporary GPU storage before encoding.
        releaseGpu();drawOverlay(result,dataset,document,exportView,layers,1,{clear:false});
        const blob=await new Promise((resolve,reject)=>result.toBlob(b=>b?resolve(b):reject(new Error('PNG encoding failed')),'image/png'));
        check();return blob;
      }finally{releaseGpu();if(result){result.width=1;result.height=1;}exporting=false;}
    },
    markSaved(){check();finishInteraction();document.markSaved();viewDirty=false;emit();},resize,
    dispose(){if(disposed)return;finishInteraction(true);disposed=true;ready=false;if(raf)win.cancelAnimationFrame(raf);for(const off of listeners)off();observer?.disconnect();renderer.dispose();renderer.gl.getExtension('WEBGL_lose_context')?.loseContext();overlayCanvas.getContext('2d').clearRect(0,0,overlayCanvas.width,overlayCanvas.height);selection.clear();}
  };
  return api;
}
