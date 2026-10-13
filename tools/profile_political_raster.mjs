import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { openRasterApp } from "./political_id_raster_app_session.mjs";
import { residentFrameReady } from "./verify_political_raster_resident.mjs";
import { editHistory, brushHistory } from "./verify_political_id_raster_integration.mjs";

export function summarize(values) {
  const sorted = [...values].sort((a,b) => a-b);
  if (!sorted.length || sorted.some(value => !Number.isFinite(value))) throw new TypeError("Finite samples required.");
  const n = sorted.length;
  return { count:n, median:n%2 ? sorted[(n-1)/2] : (sorted[n/2-1]+sorted[n/2])/2,
    p95:sorted[Math.ceil(n*0.95)-1], max:sorted[n-1] };
}
export async function settle(page) {
  const handle = await page.waitForFunction(residentFrameReady, undefined, { timeout:30000 });
  await handle.dispose();
}
async function mode(page, value) {
  await page.evaluate(value => {
    const url = new URL(location.href);
    url.searchParams.set("political_raster_present", value === "full" ? "full" : "retained");
    history.replaceState(null,"",url);
    window.__rasterTask.renderer.setPoliticalRenderMode(value === "vector" ? "vector" : "raster");
  },value);
  await settle(page);
  const d = await page.evaluate(() => window.__rasterTask.renderer.getPoliticalIdRasterDiagnostics());
  if (value !== "vector") assert.equal(d.actualBackend,"raster");
  return d;
}
async function captureReference(page) {
  await page.evaluate(() => {
    const canvas = window.__rasterTask.state.renderPassCache.canvases.political;
    window.__part2Reference = canvas.getContext("2d").getImageData(0,0,canvas.width,canvas.height);
  });
}
async function compareReference(page) {
  return page.evaluate(() => {
    const canvas = window.__rasterTask.state.renderPassCache.canvases.political;
    const a = window.__part2Reference;
    if (canvas.width !== a.width || canvas.height !== a.height) throw Error("Comparison dimensions changed");
    const b = canvas.getContext("2d").getImageData(0,0,canvas.width,canvas.height);
    let changed=0, overTolerance=0, maxDelta=0;
    for (let i=0;i<a.data.length;i+=4) {
      let delta=0;
      for (let c=0;c<4;c++) delta=Math.max(delta,Math.abs(a.data[i+c]-b.data[i+c]));
      if (delta) changed++;
      if (delta>1) overTolerance++;
      maxDelta=Math.max(maxDelta,delta);
    }
    return { pixels:canvas.width*canvas.height, changed, overTolerance, maxDelta, tolerance:1 };
  });
}
async function parity(page, report, label) {
  // Reference is the previous full-GPU raster, not a native-refined substitute.
  await captureReference(page);
  const actual = await mode(page,"full");
  const pixels = await compareReference(page);
  report.quality.push({ label, reference:"retained-raster", compared:"full-gpu-raster", pixels });
  assert.equal(actual.actualBackend,"raster");
  assert.equal(pixels.overTolerance,0,`${label}: retained presentation must not alter raster pixels`);
  await mode(page,"retained");
}
async function point(page) {
  return page.evaluate(() => {
    const xy=window.__rasterTask.renderer.projectGeoToScreen(-110,56);
    const rect=document.querySelector("#mapContainer").getBoundingClientRect();
    return {x:xy[0]+rect.left,y:xy[1]+rect.top};
  });
}
async function paint(page, id, color) {
  await page.locator("#customColor").fill(color);
  const xy=await point(page); await page.mouse.move(xy.x,xy.y);
  // No getImageData, screenshots, tracing screenshots or GPU queries in this
  // interval. Readiness is an explicitly named state observation, not photons.
  await page.evaluate(({id,color}) => {
    const probe=window.__part2Input={ started:null, done:false, frames:[], previous:null };
    const begin=event => { probe.started=event.timeStamp; };
    probe.begin=begin;
    document.addEventListener("pointerdown",begin,{capture:true,once:true});
    const poll=now => {
      if (probe.started!==null) {
        if (probe.previous!==null) probe.frames.push(now-probe.previous);
        probe.previous=now;
        const {state,renderer}=window.__rasterTask;
        const d=renderer.getPoliticalIdRasterDiagnostics();
        if (state.visualOverrides[id]===color && !state.renderPassCache?.dirty?.political
          && state.renderPhase==="idle" && !state.isInteracting && !d.pending
          && (d.effectiveMode!=="raster" || d.actualBackend==="raster" && d.displayState==="accelerated")) {
          probe.ms=performance.now()-probe.started; probe.done=true; return;
        }
      }
      probe.raf=requestAnimationFrame(poll);
    };
    probe.raf=requestAnimationFrame(poll);
  },{id,color});
  try {
    await page.mouse.click(xy.x,xy.y);
    await page.waitForFunction(()=>window.__part2Input.done,null,{timeout:10000});
    const result=await page.evaluate(()=>({ms:window.__part2Input.ms,frames:window.__part2Input.frames,
      timing:window.__rasterTask.renderer.getPoliticalIdRasterDiagnostics().lastTiming}));
    await settle(page);
    assert.equal(await page.evaluate(id=>window.__rasterTask.state.visualOverrides[id],id),color);
    return result;
  } finally {
    await page.evaluate(()=>{
      cancelAnimationFrame(window.__part2Input?.raf);
      document.removeEventListener("pointerdown",window.__part2Input?.begin,true);
    });
  }
}
async function navigation(page, zoom) {
  await page.evaluate(()=>{
    const trace=window.__part2Navigation={started:performance.now(),frames:[],previous:null};
    const poll=now=>{if(trace.previous!==null)trace.frames.push(now-trace.previous);trace.previous=now;trace.raf=requestAnimationFrame(poll);};
    trace.raf=requestAnimationFrame(poll);
  });
  try {
    await page.locator("#zoomPercentInput").fill(`${zoom}%`);
    await page.locator("#zoomPercentInput").press("Enter");
    await settle(page);
    return await page.evaluate(()=>({elapsedMs:performance.now()-window.__part2Navigation.started,
      frames:window.__part2Navigation.frames, view:{...window.__rasterTask.state.zoomTransform},
      diagnostics:window.__rasterTask.renderer.getPoliticalIdRasterDiagnostics()}));
  } finally { await page.evaluate(()=>cancelAnimationFrame(window.__part2Navigation?.raf)); }
}
export async function profileScenario(baseUrl,{scenarioId="hoi4_1939",output,revision="unknown",dpr=1}={}) {
  const report={schemaVersion:1,revision,scenarioId,dpr,passed:false,quality:[],blocks:[],navigation:[],
    measurement:"Input-to-observed-ready and CPU wall time. No pixel reads inside samples. Not GPU execution, display presentation, FPS or INP. Six samples per block; preserve outliers.",
    order:["vector","full","retained","retained","full","vector"]};
  let session,watchdog;
  try {
    report.stage="startup";
    session=await openRasterApp(baseUrl,{scenarioId,enabled:false,dpr});
    watchdog=setTimeout(()=>void session.browser.close(),360000);
    const {page}=session;
    report.browser=session.browser.version();
    report.gpu=await page.evaluate(()=>{
      const gl=document.createElement("canvas").getContext("webgl2");
      const ext=gl?.getExtension("WEBGL_debug_renderer_info");
      const result=gl?{renderer:gl.getParameter(ext?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER),version:gl.getParameter(gl.VERSION)}:null;
      gl?.getExtension("WEBGL_lose_context")?.loseContext();return result;
    });
    await settle(page);
    if(await page.locator("#scenarioGuidePopover").isVisible())await page.locator("#scenarioGuideCloseBtn").click();
    await page.locator("#paintModeVisualBtn").click();await page.locator("#toolFillBtn").click();
    report.stage="untimed-native-comparison";
    await captureReference(page); await mode(page,"retained");
    report.nativeDifference=await compareReference(page);
    assert.equal(await page.evaluate(()=>window.__rasterTask.renderer.getPoliticalIdRasterDiagnostics().presentation),"retained-regions");
    await parity(page,report,"initial");
    report.stage="untimed-edit-history";
    report.edit=await editHistory(page,false,settle);
    report.brush=await brushHistory(page,false,settle);
    const id=report.edit.paintedIds[0];
    assert.ok(id); assert.equal(report.brush.historyEntries,1);
    await parity(page,report,"edit-and-brush-history");
    await page.locator("#toolFillBtn").click();
    await paint(page,id,"#e31ac4");
    report.stage="warm-profiling";
    for (const value of report.order) {
      await mode(page,value); await paint(page,id,"#19a0a2");
      const before=await page.evaluate(()=>window.__rasterTask.renderer.getPoliticalIdRasterDiagnostics());
      const samples=[];
      for(const color of ["#ab1357","#31bb7d","#8a32c4","#317acd","#e31ac4","#cc9911"])samples.push(await paint(page,id,color));
      const after=await page.evaluate(()=>window.__rasterTask.renderer.getPoliticalIdRasterDiagnostics());
      const passDelta=Object.fromEntries(Object.entries(after.passes).filter(([,v])=>typeof v==="number")
        .map(([key,v])=>[key,v-(before.passes[key]||0)]));
      report.blocks.push({mode:value,id,input:summarize(samples.map(s=>s.ms)),samples,passDelta,
        buildDelta:(after.builds||0)-(before.builds||0),presentation:after.presentation,
        cache:after.presentationCache,timing:after.lastTiming});
      if(value!=="vector") {
        assert.equal(after.builds,before.builds);assert.equal(after.nativeRefinements,0);
        for(const key of ["nativeBackgroundPasses","nativeFinePasses","nativePartialRepaints"])assert.equal(passDelta[key],0);
      }
      if(value==="retained")assert.ok(after.presentationCache.partialUpdates>before.presentationCache.partialUpdates,
        "warm local recolor must exercise retained-region updates");
    }
    report.stage="untimed-recolor-parity";
    await mode(page,"retained");await paint(page,id,"#dd2277");await parity(page,report,"local-recolor");
    report.stage="navigation";
    for(const zoom of [130,250,100]) {
      const nav=await navigation(page,zoom);report.navigation.push({zoom,...nav});
      assert.equal(nav.diagnostics.actualBackend,"raster");
      await parity(page,report,`zoom-${zoom}`);
    }
    await page.evaluate(()=>delete window.__part2Reference);
    if(output)await page.screenshot({path:path.join(output,`${scenarioId}-dpr${dpr}-part2.png`)});
    report.final=await page.evaluate(()=>window.__rasterTask.renderer.getPoliticalIdRasterDiagnostics());
    assert.deepEqual(session.errors,[]);report.stage="complete";report.passed=true;
  } catch(error) {
    report.error=String(error?.stack||error);
    if(session)report.failureDiagnostics=await session.page.evaluate(()=>window.__rasterTask?.renderer.getPoliticalIdRasterDiagnostics()).catch(()=>null);
  } finally {
    clearTimeout(watchdog);
    if(session){report.errors=session.errors;report.warnings=session.warnings;await session.browser.close();}
    if(output)await fs.writeFile(path.join(output,`${scenarioId}-dpr${dpr}-profile.json`),JSON.stringify(report,null,2)+"\n");
  }
  return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const flags=new Map();
  for(let i=2;i<process.argv.length;i+=2){
    if(!["--base-url","--scenario","--revision","--output","--dpr"].includes(process.argv[i])||!process.argv[i+1])throw Error("Invalid profiler argument");
    flags.set(process.argv[i],process.argv[i+1]);
  }
  const baseUrl=flags.get("--base-url");const url=new URL(baseUrl);
  if(!["localhost","127.0.0.1"].includes(url.hostname))throw Error("Profiling is localhost-only");
  const scenarioId=flags.get("--scenario")||"hoi4_1939";
  if(!["hoi4_1939","hoi4_1936","tno_1962"].includes(scenarioId))throw Error("Unsupported scenario");
  const dpr=Number(flags.get("--dpr")||1);if(![1,2].includes(dpr))throw Error("DPR must be 1 or 2");
  const output=path.resolve(flags.get("--output")||".runtime/reports/generated/raster-part2");
  if(!output.startsWith(path.resolve(".runtime")+path.sep))throw Error("Reports must stay in .runtime");
  await fs.mkdir(output,{recursive:true});
  const report=await profileScenario(baseUrl,{scenarioId,output,dpr,revision:flags.get("--revision")||"unknown"});
  console.log(JSON.stringify({scenarioId,dpr,passed:report.passed,stage:report.stage,gpu:report.gpu,
    quality:report.quality,blocks:report.blocks.map(b=>({mode:b.mode,input:b.input,cache:b.cache,timing:b.timing,passDelta:b.passDelta})),error:report.error,
    failureDiagnostics:report.failureDiagnostics}));
  if(!report.passed)process.exitCode=1;
}
