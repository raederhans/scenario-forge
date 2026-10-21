import {createDocument,validColor} from './document/document.js';
import {hitTest} from './interaction/hit.js';
import {createPaintScopes,tracePaintStates} from './interaction/paint.js';
import {createRenderer,drawOverlay,prepareMetricSymbols,releaseLandformLabels,releaseMetricSymbols,metricSymbolSummary,releaseOverlayLayout} from './render/renderer.js';
import {DEFAULT_LAYERS,LAYER_SWITCHES,validDisplayOption} from './render/settings.js';
import {createOverlayStore,visualizationAssets,visualizationAssetKey} from './data/overlays.js';
import {createNameResolver,validateLocalization} from './data/localization.js';
import {validateMetrics,METRIC_DEFINITIONS,metricEntries,readStateMetric,metricUnit} from './data/metrics.js';
import {solarState} from './render/solar.js';
import {validateLandformLabels} from './data/landforms.js';

export function createHgoSession({canvas,overlayCanvas,dataset,overlayCatalogUrl,onChange=()=>{},onError=()=>{}}) {
  const document=createDocument(dataset), {width,height}=dataset.manifest.coordinateSpace;
  let renderer=createRenderer(canvas,dataset), disposed=false, ready=true, tool='select',color='#d17b55',selection=new Set(),view={x:width/2,y:height/2,scale:1},layers={...DEFAULT_LAYERS},status=dataset.placesWarning?`Cities unavailable: ${dataset.placesWarning}`:'Ready',raf=0,drag=null;
  const listeners=[],win=canvas.ownerDocument.defaultView;
  const names=createNameResolver(dataset),entityByTag=new Map(dataset.core.entities.map(entity=>[entity.tag,entity]));
  let overlayStore=null,solarTimer=0,metricSource=null,metricId=null,metricSummary=null,visualizationRevision=0;
  function visualizationModel(){
    const data=overlayStore?.get('metrics')?.data;
    if(data!==metricSource||layers.metric!==metricId){
      metricSource=data;metricId=layers.metric;metricSummary=null;
      if(data&&metricId!=='none'){
        const definition=METRIC_DEFINITIONS.find(item=>item.id===metricId);
        const values=metricEntries(data,metricId).filter(item=>item.value!==null).map(item=>item.value);
        metricSummary={title:definition.title,unit:metricUnit(data,metricId),knownCount:values.length,
          zeroCount:values.filter(value=>value===0).length,
          min:values.length?Math.min(...values):null,max:values.length?Math.max(...values):null};
      }
    }
    const selected=selection.size===1?[...selection][0]:null;
    const symbols=metricSymbolSummary(overlayCanvas);
    const statuses=overlayStore?.statuses()||{};
    for(const key of ['terrain','rivers']){
      const actual=visualizationAssetKey(key,layers);
      if(actual!==key&&statuses[actual]){statuses[key]=statuses[actual];delete statuses[actual];}
    }
    return {statuses,decodedBytes:overlayStore?.decodedBytes||0,
      terrainPalette:overlayStore?.get('terrainPalette')?.data,
      metric:metricSummary?{...metricSummary,symbols:symbols?.metricId===metricId?symbols:null,...(selected?readStateMetric(data,metricId,selected):{value:null,status:'no-selection'})}:null};
  }
  function syncVisualizations(){
    overlayStore?.setActive(visualizationAssets(layers));
    if(!layers.metric?.startsWith('resource_'))releaseMetricSymbols(overlayCanvas);
    if(ready)renderer.setVisualizations(overlayStore,layers);
    resetSolarTimer();
  }
  function resetSolarTimer(){
    if(solarTimer)clearTimer(solarTimer);solarTimer=0;
    if(disposed||!ready||!overlayStore?.get('illumination')||!layers.dayNight||layers.solarMode==='manual'||canvas.ownerDocument.hidden)return;
    solarTimer=timeout(()=>{solarTimer=0;schedule();resetSolarTimer();},layers.solarMode==='cycle'?100:15000);
  }
  const scopeStates=createPaintScopes(dataset,document);
  let paintScope='state',pendingClick=null,spacePan=false,brushPoints=[],lastPointerWasDrag=false;
  let viewDirty=false,exporting=false,projectGeneration=0,viewNotificationPending=false;
  function listen(target,event,handler,options){target.addEventListener(event,handler,options);listeners.push(()=>target.removeEventListener(event,handler,options));}
  function model(){return {ready:ready&&!disposed,dirty:document.dirty||viewDirty,tool,color,paintScope,countryRevision:`${document.revision}:${visualizationRevision}:${layers.nameLanguage}`,ownerRevision:document.ownerRevision,projectGeneration,selection:[...selection].map(id=>{const s=dataset.stateById.get(id);return {id:s.id,name:names.name('state',s,layers.nameLanguage,{customName:document.labels[id]}),customLabel:document.labels[id]||'',entityTag:document.owner(id),originalEntityTag:s.entityTag,color:document.color(id)};}),canUndo:document.canUndo,canRedo:document.canRedo,zoom:view.scale,layers:{...layers},visualizations:visualizationModel(),stats:{stateCount:dataset.core.states.length,provinceCount:dataset.core.provinceIds.length-1},status};}
  function emit(){viewNotificationPending=false;if(!disposed)onChange(model());}
  function draw(){
    raf=0;if(!ready||disposed)return;
    try{
      if(flushBrush()){renderer.update(document,selection);emit();}
      if(!ready||disposed)return;
      const previous=metricSymbolSummary(overlayCanvas),ratio=canvas.width/(canvas.clientWidth||1);
      const symbols=prepareMetricSymbols(overlayCanvas,dataset,view,layers,ratio,overlayStore?.get('metrics')?.data);
      const next=metricSymbolSummary(overlayCanvas);
      if(viewNotificationPending||['metricId','visibleCount','displacedCount','crowdedCount','maxValue','scale'].some(key=>previous?.[key]!==next?.[key]))emit();
      // The consumer may dispose this session or lose its context in onChange.
      if(!ready||disposed)return;
      renderer.draw(view,layers,ratio);
      drawOverlay(overlayCanvas,dataset,document,view,layers,ratio,{landformLabels:overlayStore?.get('terrainLabels')?.data,
        metricSymbols:symbols,selectedIds:selection});
    }catch(e){onError(e);}
  }
  function schedule(){if(!raf&&!disposed&&ready)raf=win.requestAnimationFrame(draw);}
  // Only wheel view notifications wait for paint. A synchronous action publishes
  // the latest complete model and consumes any pending view notification.
  function changed(palette=false,deferViewNotification=false){if(disposed)return;if(palette&&ready)renderer.update(document,selection);schedule();if(deferViewNotification&&ready)viewNotificationPending=true;else emit();}
  function resize(){if(disposed)return;const ratio=Math.min(win.devicePixelRatio||1,2);for(const c of [canvas,overlayCanvas]){const w=Math.max(1,Math.round(canvas.clientWidth*ratio)),h=Math.max(1,Math.round(canvas.clientHeight*ratio));if(c.width!==w)c.width=w;if(c.height!==h)c.height=h;}schedule();}
  function fit(initial=false){check();finishInteraction();view={x:width/2,y:height/2,scale:Math.min((canvas.clientWidth||width)/width,(canvas.clientHeight||height)/height)*.96};if(!initial)viewDirty=true;changed();}
  function check(){if(disposed)throw new Error('HGO session has been disposed');}
  function zoom(factor,anchor,deferViewNotification=false){check();if(!Number.isFinite(factor)||factor<=0)throw new Error('Invalid zoom factor');finishInteraction();const previous=view.scale;view.scale=Math.min(128,Math.max(.015,previous*factor));if(anchor){view.x+=anchor[0]/previous-anchor[0]/view.scale;view.y+=anchor[1]/previous-anchor[1]/view.scale;}viewDirty=true;changed(false,deferViewNotification);}
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
        const owner=document.owner(id),key=paintScope==='country'&&owner!=='WTR'?`country:${owner}`:`state:${id}`;
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
  listen(canvas,'wheel',e=>{e.preventDefault();if(!ready)return;finishInteraction();const [x,y]=position(e);zoom(Math.exp(-Math.max(-100,Math.min(100,e.deltaY))*.003),[x-canvas.clientWidth/2,y-canvas.clientHeight/2],true);},{passive:false});
  listen(canvas,'webglcontextlost',e=>{e.preventDefault();finishInteraction(true);ready=false;resetSolarTimer();renderer.dispose({contextLost:true});status='Graphics context lost; waiting for recovery';if(raf)win.cancelAnimationFrame(raf);raf=0;emit();});
  listen(canvas,'webglcontextrestored',()=>{if(disposed)return;try{renderer=createRenderer(canvas,dataset);ready=true;syncVisualizations();status='Graphics context restored';changed(true);}catch(e){ready=false;status=e.message;onError(e);emit();}});
  if(overlayCatalogUrl)listen(canvas.ownerDocument,'visibilitychange',()=>{resetSolarTimer();if(!canvas.ownerDocument.hidden)schedule();});
  const observer=typeof win.ResizeObserver==='function'?new win.ResizeObserver(resize):null;observer?.observe(canvas);if(!observer)listen(win,'resize',resize);
  resize();fit(true);renderer.update(document,selection);
  function focusGroup(ids,bounds,anchor){
    selection=new Set(ids.map(String));
    if(bounds){const [x1,y1,x2,y2]=bounds;view={x:(x1+x2)/2,y:(y1+y2)/2,scale:Math.min(32,Math.max(.015,Math.min(canvas.clientWidth/Math.max(8,x2-x1),canvas.clientHeight/Math.max(8,y2-y1))*.7))};if(ids.length===1&&anchor){view.x=anchor[0];view.y=anchor[1];}viewDirty=true;}
    changed(true);
  }
  const api={
    getViewModel:model,
    listCountries(query='',{includeEmpty=false}={}){check();const q=String(query).trim().toLocaleLowerCase();return document.countries().filter(c=>c.tag!=='WTR'&&(includeEmpty||c.stateCount>0)).map(c=>{const source=entityByTag.get(c.tag)||c,customName=c.name!==source.name?c.name:undefined;return {...c,name:names.name('entity',source,layers.nameLanguage,{customName}),searchText:`${c.tag} ${names.searchNames('entity',source,{customName}).join(' ')}`};}).filter(c=>c.searchText.toLocaleLowerCase().includes(q));},
    selectCountry(tag){check();const c=document.countries().find(c=>c.tag===tag);if(!c||tag==='WTR')throw new Error('Unknown country');finishInteraction();focusGroup(c.stateIds,c.bounds,c.anchor);},
    setCountryColor(tag,value,options={}){check();if(!validColor(value)||!document.countries().some(c=>c.tag===tag&&tag!=='WTR')||('overridePaint' in options&&typeof options.overridePaint!=='boolean'))throw new Error('Invalid country colour');finishInteraction();document.setCountryColor(tag,value,options);changed(true);},
    listCoreCandidates(parent,query=''){check();const q=String(query).trim().toLocaleLowerCase();return document.candidates(parent).map(c=>{const source=entityByTag.get(c.tag||c.target);if(!source)return {...c,searchText:`${c.tag||c.target} ${c.name}`};const customName=c.name!==source.name?c.name:undefined;return {...c,name:names.name('entity',source,layers.nameLanguage,{customName}),searchText:`${c.tag||c.target} ${names.searchNames('entity',source,{customName}).join(' ')}`};}).filter(c=>c.searchText.toLocaleLowerCase().includes(q));},
    previewTransfer(parent,target){check();if(!document.candidates(parent).some(c=>(c.target||c.tag)===target))throw new Error('No current core territories for this target');finishInteraction();const preview=document.previewTransfer(parent,target);focusGroup(preview.stateIds,preview.bounds);return preview;},
    commitTransfer(preview,options={}){check();if(drag||pendingClick)throw new Error('Finish the current stroke and refresh the transfer preview');document.transfer(preview,options);selection=new Set(preview.stateIds);changed(true);},
    setTool(value){check();if(!['select','paint','pan','pick'].includes(value))throw new Error('Invalid tool');finishInteraction();tool=value;changed(true);},
    setColor(value){check();if(!validColor(value))throw new Error('Invalid color');finishInteraction();color=value.toLowerCase();changed(true);},
    setPaintScope(value){check();if(!['state','country'].includes(value))throw new Error('Invalid paint scope');finishInteraction();paintScope=value;changed(true);},
    pickColor(id){check();document.validateIds([id]);finishInteraction();color=document.color(String(id)).toLowerCase();emit();return color;},
    setSelection(values){check();const ids=document.validateIds(values);finishInteraction();selection=new Set(ids);changed(true);},
    paintSelection(value=color){check();if(!validColor(value))throw new Error('Invalid paint color');finishInteraction();document.paintStates([...new Set([...selection].flatMap(id=>scopeStates(id,paintScope)))],value);changed(true);},
    paintStates(values,value){check();document.validateIds(values);if(!validColor(value))throw new Error('Invalid paint color');finishInteraction();document.paintStates(values,value);changed(true);},
    resetSelection(){check();finishInteraction(true);selection.clear();changed(true);},
    undo(){check();finishInteraction();document.undo();changed(true);},redo(){check();finishInteraction();document.redo();changed(true);},
    fit(){fit();},zoomBy(factor,anchor){zoom(factor,anchor);},
    focusState(id){check();const s=dataset.stateById.get(String(id));if(!s)throw new Error('Unknown state');finishInteraction();const b=s.bounds||[s.anchor[0]-10,s.anchor[1]-10,s.anchor[0]+10,s.anchor[1]+10];view={x:s.anchor[0],y:s.anchor[1],scale:Math.min(32,Math.max(.1,Math.min(canvas.clientWidth/Math.max(8,b[2]-b[0]),canvas.clientHeight/Math.max(8,b[3]-b[1]))*.55))};viewDirty=true;selection=new Set([String(id)]);changed(true);},
    search(query,{limit=50}={}){check();const q=String(query).trim().toLocaleLowerCase();if(!q)return [];const max=Math.max(0,Math.min(500,Math.floor(limit)||0)),found=[];for(const s of dataset.core.states){const customName=document.labels[s.id];if(`${s.id} ${names.searchNames('state',s,{customName}).join(' ')} ${s.nameKey||''} ${document.owner(s.id)} ${s.entityTag}`.toLocaleLowerCase().includes(q)){found.push({id:s.id,name:names.name('state',s,layers.nameLanguage,{customName}),entityTag:document.owner(s.id),originalEntityTag:s.entityTag});if(found.length>=max)break;}}return max?found:[];},
    setLayer(name,enabled){check();if(!LAYER_SWITCHES.includes(name)||typeof enabled!=='boolean')throw new Error('Invalid layer');finishInteraction();layers[name]=enabled;viewDirty=true;syncVisualizations();changed();},
    setDisplayOption(name,value){check();if(!validDisplayOption(name,value))throw new Error('Invalid display option');finishInteraction();layers[name]=name==='borderColor'?value.toLowerCase():value;viewDirty=true;syncVisualizations();changed();},
    retryVisualizations(){check();for(const [key,value]of Object.entries(overlayStore?.statuses()||{}))if(value.status==='error')void overlayStore.retry(key).catch(()=>{});},
    setLabel(id,text){check();document.validateIds([id]);if(typeof text!=='string'||text.length>200)throw new Error('Invalid label');finishInteraction();document.label(id,text);changed();},
    serializeDocument(){check();finishInteraction();return document.serialize(view,layers);},
    loadDocument(payload){check();const next=document.load(payload);finishInteraction(true);view=next.view;layers=next.layers;selection.clear();viewDirty=false;projectGeneration++;status='Project opened';syncVisualizations();changed(true);},
    async exportPng({width:outWidth=width,height:outHeight=height}={}){
      check();if(!Number.isInteger(outWidth)||!Number.isInteger(outHeight)||outWidth<1||outHeight<1||outWidth*outHeight>40e6||Math.max(outWidth,outHeight)>16384)throw new Error('Invalid PNG dimensions');
      if(!ready)throw new Error('Graphics context is not ready');
      if(exporting)throw new Error('PNG export already in progress');
      finishInteraction();
      exporting=true;
      const exportLayers={...layers},exportSolar=solarState(exportLayers),generation=projectGeneration;
      const exportDocument=createDocument(dataset);exportDocument.load(document.serialize(view,exportLayers));
      // Source English names remain exportable when the optional translation
      // catalog is unavailable. Requested Chinese/bilingual labels wait for it.
      const exportKeys=visualizationAssets(exportLayers).filter(key=>key!=='localization'||
        ((exportLayers.labels||exportLayers.cities)&&exportLayers.nameLanguage!=='en'));
      let target,result,exportRenderer;
      function releaseGpu(){if(exportRenderer){exportRenderer.dispose();exportRenderer.gl.getExtension('WEBGL_lose_context')?.loseContext();exportRenderer=null;}if(target){target.width=1;target.height=1;}}
      try{
        if(overlayStore){
          await overlayStore.prepare(exportKeys);check();
          if(generation!==projectGeneration||exportKeys.some(key=>!overlayStore.get(key)))throw new Error('Visualizations changed during export; retry export');
        }
        const exportResources=new Map(exportKeys.map(key=>[key,overlayStore?.get(key)]));
        target=canvas.ownerDocument.createElement('canvas');result=canvas.ownerDocument.createElement('canvas');
        for(const c of [target,result]){c.width=outWidth;c.height=outHeight;}
        exportRenderer=createRenderer(target,dataset);exportRenderer.update(exportDocument,new Set());
        exportRenderer.setVisualizations(exportResources,exportLayers);
        const exportView={x:width/2,y:height/2,scale:Math.min(outWidth/width,outHeight/height)};
        exportRenderer.draw(exportView,exportLayers,1,exportSolar);
        const ctx=result.getContext('2d');if(!ctx)throw new Error('PNG canvas unavailable');
        ctx.drawImage(target,0,0);
        // Composite labels into the output directly, avoiding a full-size
        // transparent overlay. Release temporary GPU storage before encoding.
        releaseGpu();drawOverlay(result,dataset,exportDocument,exportView,exportLayers,1,{clear:false,landformLabels:exportResources.get('terrainLabels')?.data,metrics:exportResources.get('metrics')?.data});
        const blob=await new Promise((resolve,reject)=>result.toBlob(b=>b?resolve(b):reject(new Error('PNG encoding failed')),'image/png'));
        check();return blob;
      }finally{releaseGpu();if(result){result.width=1;result.height=1;}exporting=false;}
    },
    markSaved(){check();finishInteraction();document.markSaved();viewDirty=false;emit();},resize,
    dispose(){if(disposed)return;finishInteraction(true);disposed=true;ready=false;resetSolarTimer();if(overlayStore)delete dataset.localization;overlayStore?.dispose();releaseOverlayLayout(overlayCanvas);metricSource=null;metricSummary=null;if(raf)win.cancelAnimationFrame(raf);for(const off of listeners)off();observer?.disconnect();renderer.dispose();renderer.gl.getExtension('WEBGL_lose_context')?.loseContext();overlayCanvas.getContext('2d').clearRect(0,0,overlayCanvas.width,overlayCanvas.height);selection.clear();}
  };
  if(overlayCatalogUrl){
    overlayStore=createOverlayStore({dataset,catalogUrl:overlayCatalogUrl,
      validators:{localization:validateLocalization,metrics:validateMetrics,terrainLabels:validateLandformLabels},
      onChange(){
        dataset.localization=overlayStore.get('localization')?.data;
        if(!overlayStore.get('terrainLabels'))releaseLandformLabels(overlayCanvas);
        if(!overlayStore.get('metrics'))releaseMetricSymbols(overlayCanvas);
        visualizationRevision++;
        if(ready)renderer.setVisualizations(overlayStore,layers);
        resetSolarTimer();
        changed();
      }});
    syncVisualizations();
  }
  return api;
}
