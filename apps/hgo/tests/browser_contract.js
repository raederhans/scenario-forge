// Run in a localhost page using runBrowserContract(). This exercises real WebGL,
// native assets and PNG pixels; it is deliberately excluded from the app build.
import {loadDataset} from '../src/data/dataset.js';
import {createHgoSession} from '../src/session.js';
import {hitTest} from '../src/interaction/hit.js';

export async function runBrowserContract() {
  const start=performance.now(), checks=[];
  const assert=(ok,message)=>{if(!ok)throw new Error(message);checks.push(message);};
  const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const dataset=await loadDataset(new URL('../assets/default/manifest.json',import.meta.url));
  const loaded=performance.now();
  const host=document.createElement('div');
  host.style.cssText='position:fixed;left:0;top:0;width:800px;height:400px;z-index:10000;pointer-events:none';
  const canvas=document.createElement('canvas'),overlayCanvas=document.createElement('canvas');
  for(const c of [canvas,overlayCanvas]){c.style.cssText='position:absolute;width:800px;height:400px';host.append(c);}
  document.body.append(host);
  let session,viewModel,errors=[];
  const water=dataset.core.states.filter(s=>s.entityTag==='WTR').sort((a,b)=>a.pixelCount-b.pixelCount)[0];
  const city=dataset.core.states.filter(s=>s.entityTag!=='WTR'&&/city|town/.test(s.category)).sort((a,b)=>a.pixelCount-b.pixelCount)[0];
  try {
    session=createHgoSession({canvas,overlayCanvas,dataset,onChange:vm=>{viewModel=vm;},onError:e=>errors.push(e.message)});
    await frame();
    assert(session.getViewModel().ready&&!session.getViewModel().dirty,'initial GPU ready and document clean');
    for(const s of [water,city]) {
      assert(hitTest(dataset,...s.anchor)?.stateId===String(s.id),`exact native hit ${s.id} (${s.pixelCount} pixels)`);
      session.focusState(s.id);session.paintSelection('#1a2b3c');
    }
    const documentBefore=session.serializeDocument();
    assert(documentBefore.paint[water.id]==='#1a2b3c'&&documentBefore.paint[city.id]==='#1a2b3c','land and water paint');
    session.undo();assert(!session.serializeDocument().paint[city.id],'undo removes last state paint');
    session.redo();assert(session.serializeDocument().paint[city.id]==='#1a2b3c','redo restores last state paint');
    session.setLabel(city.id,'原生城市 · Native city');
    const project=session.serializeDocument();
    let rejected=false;try{session.loadDocument({...project,dataset:{...project.dataset,revision:'different'}});}catch{rejected=true;}
    assert(rejected&&JSON.stringify(session.serializeDocument())===JSON.stringify(project),'wrong revision rejected atomically');
    session.loadDocument(JSON.stringify(project));
    assert(!session.getViewModel().dirty&&session.serializeDocument().labels[city.id]==='原生城市 · Native city','JSON reopen preserves edits and marks clean');
    for(const layer of ['labels','cities','borders'])session.setLayer(layer,false);
    session.resetSelection();await frame();
    const exported=await session.exportPng();
    const bitmap=await createImageBitmap(exported),pixels=document.createElement('canvas');pixels.width=bitmap.width;pixels.height=bitmap.height;
    const ctx=pixels.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();
    assert(pixels.width===5120&&pixels.height===2560,'PNG native dimensions');
    for(const s of [water,city]){
      const rgba=Array.from(ctx.getImageData(Math.floor(s.anchor[0]),Math.floor(s.anchor[1]),1,1).data);
      assert(rgba.join(',')==='26,43,60,255',`PNG exact painted pixel ${s.id}`);
    }
    const gl=canvas.getContext('webgl2'),loss=gl.getExtension('WEBGL_lose_context');
    assert(!!loss,'WebGL context recovery extension available');
    loss.loseContext();await frame();
    assert(!viewModel.ready,'context loss disables editing readiness');
    loss.restoreContext();
    for(let n=0;n<120&&!session.getViewModel().ready;n++)await frame();
    assert(session.getViewModel().ready&&session.serializeDocument().paint[water.id]==='#1a2b3c',`context restored with document retained: ${JSON.stringify({status:session.getViewModel().status,errors,lost:gl.isContextLost()})}`);
    assert(errors.length===0,'no renderer errors');
    const abort=new AbortController();abort.abort();let cancelled=false;
    try{await loadDataset(new URL('../assets/default/manifest.json',import.meta.url),{signal:abort.signal});}catch(e){cancelled=e.name==='AbortError';}
    assert(cancelled,'native fetch cancellation');
    session.dispose();assert(!session.getViewModel().ready,'disposed session no longer ready');
    return {passed:true,checks,water:{id:water.id,anchor:water.anchor,pixels:water.pixelCount},city:{id:city.id,anchor:city.anchor,pixels:city.pixelCount},timing:{datasetMs:loaded-start,totalMs:performance.now()-start},pngBytes:exported.size};
  } finally {session?.dispose();host.remove();}
}
