// Invoke runVisualizationBrowserContract() from a localhost HGO page.
// Owns an offscreen same-origin frame; never touches the page's editor session.
import {loadDataset} from '../src/data/dataset.js';
import {createHgoSession} from '../src/session.js';

export async function runVisualizationBrowserContract() {
  const started=performance.now(),checks=[],errors=[],pngSize={width:512,height:256};
  const assert=(ok,message)=>{if(!ok)throw new Error(message);checks.push(message);};
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function waitFor(predicate,label,timeout=20000){
    const deadline=performance.now()+timeout;
    while(!predicate()){
      if(performance.now()>deadline)throw new Error(`Timed out: ${label}`);
      await sleep(25);
    }
  }
  const fingerprint=project=>JSON.stringify(Object.fromEntries(
    ['dataset','paint','owners','palette','createdCountries','labels'].map(key=>[key,project[key]])));
  const difference=(a,b)=>{
    if(a.length!==b.length)return Infinity;
    let count=0;
    for(let i=0;i<a.length;i+=4)if(a[i]!==b[i]||a[i+1]!==b[i+1]||a[i+2]!==b[i+2]||a[i+3]!==b[i+3])count++;
    return count;
  };
  const frame=document.createElement('iframe');
  frame.setAttribute('title','Isolated visualization contract');frame.setAttribute('aria-hidden','true');
  frame.tabIndex=-1;frame.style.cssText='position:fixed;left:-10000px;top:0;width:512px;height:256px;border:0;pointer-events:none';
  const frameLoaded=new Promise((resolve,reject)=>{
    frame.addEventListener('load',resolve,{once:true});frame.addEventListener('error',()=>reject(new Error('Test frame failed to load')),{once:true});
  });
  frame.srcdoc='<!doctype html><html><body style="margin:0;width:512px;height:256px"></body></html>';
  document.body.append(frame);
  let session,reopened,fault,restoreDraw,privateDocument,hiddenDescriptor,visibilityOverridden=false;
  const sessions=[];
  try {
    await frameLoaded;
    privateDocument=frame.contentDocument;
    assert(!!privateDocument?.defaultView,'isolated same-origin browser document is available');
    const win=privateDocument.defaultView;
    const frames=()=>new Promise(resolve=>win.requestAnimationFrame(()=>win.requestAnimationFrame(resolve)));
    const canvasPair=()=>{
      const host=privateDocument.createElement('div');host.style.cssText='position:relative;width:512px;height:256px';
      const canvas=privateDocument.createElement('canvas'),overlayCanvas=privateDocument.createElement('canvas');
      for(const node of [canvas,overlayCanvas]){node.style.cssText='position:absolute;inset:0;width:512px;height:256px';host.append(node);}
      privateDocument.body.append(host);return {canvas,overlayCanvas};
    };
    const pixels=async blob=>{
      const bitmap=await createImageBitmap(blob),target=privateDocument.createElement('canvas');
      try {
        target.width=bitmap.width;target.height=bitmap.height;
        assert(bitmap.width===pngSize.width&&bitmap.height===pngSize.height,'PNG export stays within the small contract size');
        const ctx=target.getContext('2d');ctx.drawImage(bitmap,0,0);
        return new Uint8ClampedArray(ctx.getImageData(0,0,target.width,target.height).data);
      }finally{bitmap.close();target.width=target.height=1;}
    };
    const dataset=await loadDataset(new URL('../assets/default/manifest.json',import.meta.url));
    const loaded=performance.now(),catalogUrl=new URL('../assets/overlays/catalog.json',import.meta.url).href;
    const pair=canvasPair();
    session=createHgoSession({...pair,dataset,overlayCatalogUrl:catalogUrl,onError:error=>errors.push(error.message)});sessions.push(session);
    await frames();assert(session.getViewModel().ready,'real WebGL session is ready');
    const gl=pair.canvas.getContext('webgl2');let drawCalls=0;
    const originalDraw=gl.drawArrays;
    gl.drawArrays=function(...args){drawCalls++;return originalDraw.apply(this,args);};
    restoreDraw=()=>{gl.drawArrays=originalDraw;};
    for(const key of ['labels','cities','borders'])session.setLayer(key,false);
    session.setDisplayOption('nameLanguage','en');session.setDisplayOption('textureOpacity',.15);
    const state=dataset.core.states.find(source=>source.entityTag!=='WTR');
    const other=dataset.core.entities.find(entity=>entity.tag!=='WTR'&&entity.tag!==state.entityTag&&/^[A-Z0-9]{3}$/.test(entity.tag));
    const initial=session.serializeDocument();
    initial.paint[String(state.id)]='#1a2b3c';initial.owners[String(state.id)]=other.tag;
    session.loadDocument(initial);
    const unchanged=fingerprint(session.serializeDocument());
    const basePng=await session.exportPng(pngSize),basePixels=await pixels(basePng);

    const options={baseMapStyle:'thematic',quality:'fine',terrainMode:'combined',terrainOpacity:.6,riverOpacity:.85,riverWidth:1.3,
      nightLightOpacity:1,nightOpacity:.75,twilightWidth:12,solarMode:'manual',solarDate:'2026-03-20',
      utcMinutes:0,cycleSeconds:30,metric:'resource_steel',metricOpacity:.75,nameLanguage:'bilingual'};
    for(const [key,value] of Object.entries(options))session.setDisplayOption(key,value);
    for(const key of ['terrain','rivers','nightLights','dayNight'])session.setLayer(key,true);
    const expected=['localization','terrain','terrainPalette','terrainLabels','rivers','nightLights','illumination','metrics'];
    const selectedResourcesReady=()=>{
      const statuses=session.getViewModel().visualizations.statuses;
      const failed=expected.filter(key=>statuses[key]?.status==='error');
      if(failed.length)throw new Error(`Optional assets failed: ${JSON.stringify(statuses)}`);
      return expected.every(key=>statuses[key]?.status==='ready');
    };
    await waitFor(selectedResourcesReady,'all selected optional resources');
    await frames();
    const loadedModel=session.getViewModel(),peakBytes=loadedModel.visualizations.decodedBytes;
    assert(peakBytes>0,'selected optional resources report allocated decoded bytes');
    session.setDisplayOption('quality','balanced');await waitFor(selectedResourcesReady,'balanced terrain and river resources');
    const balancedBytes=session.getViewModel().visualizations.decodedBytes;
    assert(balancedBytes<peakBytes,'balanced quality uses less decoded raster memory than fine');
    session.setDisplayOption('quality','fine');await waitFor(selectedResourcesReady,'fine terrain and river resources');
    assert(session.getViewModel().visualizations.decodedBytes===peakBytes,'switching to fine releases previous balanced assets');
    session.setDisplayOption('quality','balanced');await waitFor(selectedResourcesReady,'return to balanced resources');
    assert(session.getViewModel().visualizations.decodedBytes===balancedBytes,'returning to balanced restores its allocation without retaining fine assets');
    assert(fingerprint(session.serializeDocument())===unchanged,'loading and enabling visualizations preserve paint, owners and dataset identity');
    const translated=Object.entries(dataset.localization.states).find(([,entry])=>entry.zh&&!entry.displayFallback&&entry.zh.length>=3);
    assert(!!translated&&session.search(translated[1].zh,{limit:500}).some(result=>String(result.id)===translated[0]),'asynchronously loaded Chinese names participate in session search');
    session.setSelection([state.id]);
    assert(Number.isFinite(session.getViewModel().visualizations.metric?.min),'selected native metric exposes a finite map range');
    session.resetSelection();
    const saved=session.serializeDocument(),layeredPng=await session.exportPng(pngSize),layeredPixels=await pixels(layeredPng);
    const changedPixels=difference(basePixels,layeredPixels);
    assert(changedPixels>32,'enabled optional layers visibly affect the small PNG');
    const loss=gl.getExtension('WEBGL_lose_context');
    assert(!!loss,'optional-layer context recovery extension is available');
    loss.loseContext();await waitFor(()=>!session.getViewModel().ready,'lost decorated context');await frames();
    loss.restoreContext();await waitFor(()=>session.getViewModel().ready,'restored decorated context');await frames();
    const restoredPixels=await pixels(await session.exportPng(pngSize));
    assert(difference(restoredPixels,layeredPixels)===0,'all loaded visualizations recover after WebGL context loss without changing exported pixels');

    // Start export, then edit while its asset preparation is awaiting a promise.
    // The result must still use the captured document/settings, not live state.
    const pendingSnapshot=session.exportPng(pngSize);
    session.setDisplayOption('terrainOpacity',.1);session.setDisplayOption('nightOpacity',.1);
    session.paintStates([state.id],'#efab01');
    const snapshotPng=await pendingSnapshot,snapshotPixels=await pixels(snapshotPng);
    assert(difference(snapshotPixels,layeredPixels)===0,'asynchronous PNG export retains the captured settings and paint snapshot');
    assert(session.serializeDocument().paint[String(state.id)]==='#efab01','snapshot check exercises a real concurrent live edit');
    session.loadDocument(saved);await frames();
    assert(fingerprint(session.serializeDocument())===unchanged,'restoring the contract snapshot preserves original paint and ownership edits');

    // A new real WebGL session checks JSON parsing/default integration without
    // retaining a second copy of all optional rasters.
    reopened=createHgoSession({...canvasPair(),dataset:{...dataset},onError:error=>errors.push(error.message)});sessions.push(reopened);
    reopened.loadDocument(JSON.stringify(saved));
    assert(JSON.stringify(reopened.serializeDocument().layers)===JSON.stringify(saved.layers),'all visualization settings roundtrip through JSON into a new session');
    assert(fingerprint(reopened.serializeDocument())===unchanged,'JSON roundtrip preserves paint and country ownership');
    reopened.setDisplayOption('quality','fine');
    reopened.loadDocument(JSON.stringify(reopened.serializeDocument()));
    assert(reopened.serializeDocument().layers.quality==='fine','non-default fine quality survives JSON save and reload');
    reopened.dispose();

    // Timer instrumentation is restricted to this session's WebGL context.
    session.setDisplayOption('solarMode','manual');await frames();await sleep(150);
    const staticDraws=drawCalls;await sleep(250);
    assert(drawCalls===staticDraws,'manual solar mode has no animation redraw loop');
    session.setDisplayOption('solarMode','cycle');await sleep(350);
    const cycleDraws=drawCalls;await sleep(350);
    assert(drawCalls>=cycleDraws+2,'cycle mode redraws over real browser time');
    // This is a scoped Page Visibility event simulation, not a browser-tab
    // visibility assertion. Never replace hidden or timers on the host page.
    hiddenDescriptor=Object.getOwnPropertyDescriptor(privateDocument,'hidden');let hidden=true;
    Object.defineProperty(privateDocument,'hidden',{configurable:true,get:()=>hidden});visibilityOverridden=true;
    privateDocument.dispatchEvent(new win.Event('visibilitychange'));await frames();await sleep(150);
    const pausedDraws=drawCalls;await sleep(350);
    assert(drawCalls===pausedDraws,'private-document hidden visibility event stops the solar loop');
    hidden=false;privateDocument.dispatchEvent(new win.Event('visibilitychange'));await sleep(350);
    assert(drawCalls>pausedDraws,'private-document visible event resumes the solar loop');
    if(hiddenDescriptor)Object.defineProperty(privateDocument,'hidden',hiddenDescriptor);else delete privateDocument.hidden;
    visibilityOverridden=false;session.setDisplayOption('solarMode','manual');

    for(const key of ['terrain','rivers','nightLights','dayNight'])session.setLayer(key,false);
    session.setDisplayOption('metric','none');session.setDisplayOption('nameLanguage','en');await frames();
    const retained=session.getViewModel().visualizations,retainedLocalizationBytes=retained.decodedBytes;
    assert(retainedLocalizationBytes>0&&retainedLocalizationBytes<peakBytes,'disabling visual layers releases raster and metric resources while retaining localization');
    assert(Object.keys(retained.statuses).length===1&&retained.statuses.localization?.status==='ready',
      'only searchable localization remains ready after visual layers are disabled');
    session.dispose();
    assert(!session.getViewModel().ready&&session.getViewModel().visualizations.decodedBytes===0,'disposal marks the session unavailable and releases optional resources');

    // A valid HTTP response containing HTML is an invalid optional catalog.
    // This exercises failure isolation without global fetch mocks or a 404.
    fault=createHgoSession({...canvasPair(),dataset:{...dataset},overlayCatalogUrl:new URL('../index.html',import.meta.url).href,
      onError:error=>errors.push(error.message)});sessions.push(fault);
    fault.setLayer('terrain',true);
    await waitFor(()=>fault.getViewModel().visualizations.statuses.terrain?.status==='error','invalid optional catalog isolation',5000);
    assert(fault.getViewModel().ready,'an optional catalog failure leaves the base editor ready');
    fault.paintStates([state.id],'#7f8fa0');
    assert(fault.serializeDocument().paint[String(state.id)]==='#7f8fa0','base painting remains available after optional failure');
    fault.retryVisualizations();
    assert(fault.getViewModel().visualizations.statuses.terrain?.status==='loading','retry re-enters the optional loading state');
    await waitFor(()=>fault.getViewModel().visualizations.statuses.terrain?.status==='error','optional retry failure',5000);
    fault.setLayer('terrain',false);fault.setLayer('labels',false);fault.setLayer('cities',false);
    const textFreePng=await fault.exportPng(pngSize);await pixels(textFreePng);
    assert(textFreePng.type==='image/png','a text-free PNG does not depend on unavailable translation data');
    fault.setLayer('labels',true);fault.setLayer('cities',true);fault.setDisplayOption('nameLanguage','en');
    const fallbackPng=await fault.exportPng(pngSize);await pixels(fallbackPng);
    assert(fault.getViewModel().ready&&fallbackPng.type==='image/png','base PNG export works after failed optional layers are disabled');
    assert(errors.length===0,`no unexpected renderer errors: ${errors.join('; ')}`);
    return {passed:true,checks,changedPixels,peakDecodedBytes:peakBytes,retainedLocalizationBytes,
      pngBytes:{base:basePng.size,layered:layeredPng.size,snapshot:snapshotPng.size,fallback:fallbackPng.size},
      visibility:'private-document event simulation; actual browser-tab visibility requires driver coverage',
      optionalFault:'HTTP 200 HTML used as invalid JSON catalog; no global fetch override',
      timing:{datasetMs:loaded-started,totalMs:performance.now()-started}};
  }finally{
    if(visibilityOverridden&&privateDocument){if(hiddenDescriptor)Object.defineProperty(privateDocument,'hidden',hiddenDescriptor);else delete privateDocument.hidden;}
    restoreDraw?.();for(const owned of sessions)owned.dispose();frame.remove();
  }
}
