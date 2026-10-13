import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { openRasterApp } from "./political_id_raster_app_session.mjs";
import { editHistory, brushHistory } from "./verify_political_id_raster_integration.mjs";

// This oracle observes the live raster, never waits for native exact pixels.
export function residentFrameReady(s = window.__rasterTask.state, d = window.__rasterTask.renderer.getPoliticalIdRasterDiagnostics()) {
  const c = s.runtimeChunkLoadState || {};
  const background = s.renderPerfMetrics?.drawPoliticalBackgroundFillsPass;
  const nativeReady = !!background && (!background.progressive || background.deferredFullCacheReady);
  const backendReady = d.effectiveMode === "raster" ? d.actualBackend === "raster" && d.displayState === "accelerated"
    && d.sourceCoverage === "complete-display-v1" && d.view
    && ["x", "y", "k"].every(key => Math.abs(d.view[key] - s.zoomTransform[key]) < 1e-7)
    : nativeReady && (d.effectiveMode !== "hybrid" || d.displayState === "precise");
  return !s.scenarioApplyInFlight && !s.startupReadonly && !s.isInteracting && s.renderPhase === "idle"
    && !s.deferExactAfterSettle && !s.exactAfterSettleHandle && !s.activePostReadyTaskKey
    && !s.renderPassCache?.dirty?.political && !c.pendingReason && !c.refreshScheduled && !c.promotionScheduled
    && !c.pendingPromotion && !c.pendingInfraPromotion && !c.promotionCommitInFlight
    && !d.failed && !d.pending && !d.refinementPending
    && backendReady;
}

async function settle(page) {
  const result = await page.waitForFunction(residentFrameReady, undefined, { timeout: 30000 });
  await result.dispose();
}

async function setMode(page, mode) {
  if (await page.locator("#scenarioGuidePopover").isVisible()) await page.locator("#scenarioGuideCloseBtn").click();
  await page.locator("#editorTaskLayersBtn").click();
  await page.locator("#appearanceTabBorders").click();
  await page.locator("#politicalRenderMode").evaluate(element => {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) if (parent.tagName === "DETAILS") parent.open = true;
  });
  await page.locator("#politicalRenderMode").selectOption(mode);
  await settle(page);
  assert.equal(await page.evaluate(() => window.__rasterTask.renderer.getPoliticalIdRasterDiagnostics().mode), mode);
}

function quantile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a,b) => a-b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
}

async function paintProbe(page, color) {
  await page.locator("#customColor").fill(color);
  const beforeColors = await page.evaluate(() => ({ ...window.__rasterTask.state.visualOverrides }));
  const point = await page.evaluate(() => {
    const xy = window.__rasterTask.renderer.projectGeoToScreen(-110, 56);
    const rect = document.querySelector("#mapContainer").getBoundingClientRect();
    return { x: xy[0] + rect.left, y: xy[1] + rect.top };
  });
  await page.mouse.move(point.x, point.y);
  await page.evaluate(({ point, color }) => {
    const rgb = [1,3,5].map(start => Number.parseInt(color.slice(start,start+2),16));
    const scratch = document.createElement("canvas"); scratch.width = 9; scratch.height = 9;
    const ctx = scratch.getContext("2d", { willReadFrequently: true });
    const probe = window.__residentProbe = { started: null, ms: null, frames: [], previous: null };
    document.addEventListener("pointerdown", event => { probe.started = event.timeStamp; }, { capture: true, once: true });
    const poll = now => {
      if (probe.started !== null) {
        if (probe.previous !== null) probe.frames.push(now - probe.previous);
        probe.previous = now;
        ctx.clearRect(0,0,9,9);
        for (const id of ["map-canvas", "map-political-patch-canvas", "map-interaction-overlay-canvas"]) {
          const canvas = document.getElementById(id);
          if (!canvas || getComputedStyle(canvas).display === "none") continue;
          const rect = canvas.getBoundingClientRect();
          if (!rect.width || !rect.height) continue;
          ctx.drawImage(canvas, Math.floor((point.x-rect.left)*canvas.width/rect.width)-4,
            Math.floor((point.y-rect.top)*canvas.height/rect.height)-4,9,9,0,0,9,9);
        }
        const pixels = ctx.getImageData(0,0,9,9).data;
        for (let i=0;i<pixels.length;i+=4) if (pixels[i+3]===255 && rgb.every((v,c)=>Math.abs(v-pixels[i+c])<=3)) {
          probe.ms = performance.now()-probe.started; return;
        }
      }
      probe.raf = requestAnimationFrame(poll);
    };
    probe.raf = requestAnimationFrame(poll);
  }, { point, color });
  try {
    await page.mouse.click(point.x,point.y);
    await page.waitForFunction(() => window.__residentProbe.ms !== null, null, { timeout: 10000 });
    await settle(page);
    const changedIds = await page.evaluate(({ beforeColors, color }) => Object.entries(window.__rasterTask.state.visualOverrides)
      .filter(([id,value]) => value === color && beforeColors[id] !== value).map(([id]) => id), { beforeColors, color });
    assert.equal(changedIds.length, 1, "a pixel-color match must also be a real single-feature canonical paint");
    return { ...await page.evaluate(() => ({ ms: window.__residentProbe.ms, frames: window.__residentProbe.frames })), id: changedIds[0] };
  } finally {
    await page.evaluate(() => cancelAnimationFrame(window.__residentProbe?.raf));
  }
}

export async function verifyResidentScenario(baseUrl, { scenarioId = "hoi4_1939", output, rounds = 2, revision = "unknown" } = {}) {
  const report = { revision, scenarioId, viewport: { width: 1280, height: 900 }, dpr: 1, passed: false,
    measurement: "Warm paired same-document comparisons; pointer-to-Canvas pixels, not display presentation. GPU is runner-specific. Screenshots are outside timing samples.",
    samples: [], lifecycle: [], network: [] };
  let session;
  try {
    report.stage = "startup";
    session = await openRasterApp(baseUrl, { scenarioId, enabled: false });
    const { page } = session;
    report.browser = session.browser.version();
    report.gpu = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl2");
      const ext = gl?.getExtension("WEBGL_debug_renderer_info");
      return gl ? { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) } : null;
    });
    await settle(page);
    if (await page.locator("#scenarioGuidePopover").isVisible()) await page.locator("#scenarioGuideCloseBtn").click();
    await page.locator("#paintModeVisualBtn").click(); await page.locator("#toolFillBtn").click();
    const baselineColors = await page.evaluate(() => ({ ...window.__rasterTask.state.visualOverrides }));
    if (output) await page.screenshot({ path: path.join(output,`${scenarioId}-native-initial.png`) });
    // Exercise a cold resident activation separately from warm timing.
    report.stage = "resident-activation";
    const activationStarted = performance.now();
    await setMode(page,"raster");
    report.activationMs = performance.now() - activationStarted;
    report.initial = await page.evaluate(() => window.__rasterTask.renderer.getPoliticalIdRasterDiagnostics());
    if (output) await page.screenshot({ path: path.join(output,`${scenarioId}-raster-initial.png`) });
    report.stage = "resident-edit-history";
    const edit = report.edit = await editHistory(page, false, settle);
    report.stage = "resident-brush-history";
    const brush = report.brush = await brushHistory(page, false, settle);
    report.lifecycle.push({ mode: "raster", edit, brush });
    assert.equal(brush.historyEntries,1); assert.equal(brush.pointerSteps,41);
    await page.locator("#undoBtn").click(); await settle(page);
    await page.locator("#undoBtn").click(); await settle(page);
    assert.deepEqual(await page.evaluate(() => ({ ...window.__rasterTask.state.visualOverrides })), baselineColors);
    report.stage = "resident-navigation";
    for (const zoom of [130,100]) {
      await page.evaluate(value => window.__rasterTask.renderer.setZoomPercent(value), zoom); await settle(page);
      assert.equal(await page.evaluate(() => window.__rasterTask.renderer.getPoliticalIdRasterDiagnostics().actualBackend),"raster");
    }
    // Prime one foreground edit once. All later measurements use identical warm coverage/order.
    await paintProbe(page,"#e31ac4");
    for (const mode of [...Array.from({ length: rounds }, () => ["vector","raster"]).flat(), "hybrid"]) {
      report.stage = `warm-${mode}-${report.samples.length}`;
      await setMode(page,mode);
      await paintProbe(page,"#19a0a2");
      const before = await page.evaluate(() => window.__rasterTask.renderer.getPoliticalIdRasterDiagnostics());
      const input = [];
      for (const color of ["#ab1357","#31bb7d","#8a32c4","#317acd","#e31ac4","#cc9911"]) input.push(await paintProbe(page,color));
      const after = await page.evaluate(() => window.__rasterTask.renderer.getPoliticalIdRasterDiagnostics());
      const delta = Object.fromEntries(Object.entries(after.passes).filter(([,v]) => typeof v === "number")
        .map(([k,v]) => [k,v-(before.passes[k]||0)]));
      report.samples.push({ mode, paintedIds: input.map(p=>p.id), inputMs: input.map(p=>p.ms), medianMs: quantile(input.map(p=>p.ms),0.5),
        p95Ms: quantile(input.map(p=>p.ms),0.95), passDelta: delta,
        buildDelta: (after.builds||0)-(before.builds||0), diagnostics: after });
      assert.equal(new Set(report.samples.flatMap(sample => sample.paintedIds)).size, 1, "all backends must paint the same canonical feature");
      if (mode === "raster") {
        assert.equal(after.nativeRefinements,0); assert.equal(delta.nativeBackgroundPasses,0);
        assert.equal(delta.nativeFinePasses,0); assert.equal(delta.nativePartialRepaints,0);
        assert.equal(after.builds,before.builds,"warm palette edits must not rebuild coverage");
        assert.ok(delta.rasterPrimaryPasses>0);
      }

    }
    await setMode(page,"raster");
    const beforeSwitch = await page.evaluate(() => ({ colors: { ...window.__rasterTask.state.visualOverrides }, past: window.__rasterTask.state.historyPast.length }));
    await setMode(page,"vector"); await setMode(page,"raster");
    assert.deepEqual(await page.evaluate(() => ({ colors: { ...window.__rasterTask.state.visualOverrides }, past: window.__rasterTask.state.historyPast.length })),beforeSwitch);
    if (output) await page.screenshot({ path: path.join(output,`${scenarioId}-resident.png`) });
    report.final = await page.evaluate(() => window.__rasterTask.renderer.getPoliticalIdRasterDiagnostics());
    assert.equal(report.final.actualBackend,"raster"); assert.equal(report.final.nativeRefinements,0);
    assert.deepEqual(session.errors,[]); report.stage = "complete"; report.passed = true;
  } catch(error) {
    report.error = String(error?.stack || error);
    if (session) {
      report.failureDiagnostics = await session.page.evaluate(() => ({ diagnostics: window.__rasterTask?.renderer.getPoliticalIdRasterDiagnostics(),
        bootPhase: window.__rasterTask?.state.bootPhase, dirty: window.__rasterTask?.state.renderPassCache?.dirty,
        chunk: Object.fromEntries(["generation","pendingReason","refreshScheduled","promotionScheduled","promotionCommitInFlight","promotionCommitStatus"]
          .map(key => [key,window.__rasterTask?.state.runtimeChunkLoadState?.[key]])) })).catch(()=>null);
      if (/Conflicting display geometry/.test(report.failureDiagnostics?.diagnostics?.failed || "")) {
        report.geometryComparison = await session.page.evaluate(async () => {
          const { getFeatureId } = await import(new URL("js/core/feature_identity.js", document.baseURI));
          const { state, renderer } = window.__rasterTask;
          const id = /feature "([^"]+)"/.exec(renderer.getPoliticalIdRasterDiagnostics().failed)?.[1];
          const full = state.landDataFull?.features.find(f => getFeatureId(f) === id);
          const fine = state.landData?.features.find(f => getFeatureId(f) === id);
          const a = JSON.stringify(full?.geometry), b = JSON.stringify(fine?.geometry);
          let firstDifference = 0;
          while (firstDifference < Math.min(a.length,b.length) && a[firstDifference] === b[firstDifference]) firstDifference++;
          return { id, sameContents: a === b, fullLength:a.length, fineLength:b.length,
            firstDifference, fullExcerpt:a.slice(Math.max(0,firstDifference-80),firstDifference+120),
            fineExcerpt:b.slice(Math.max(0,firstDifference-80),firstDifference+120) };
        }).catch(()=>null);
      }
      if (output) await session.page.screenshot({ path: path.join(output,`${scenarioId}-failed.png`) }).catch(()=>{});
    }
  } finally {
    if (session) { report.errors=session.errors; report.warnings=session.warnings; report.network=session.network; await session.browser.close(); }
    if (output) await fs.writeFile(path.join(output,`${scenarioId}.json`),JSON.stringify(report,null,2)+"\n");
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flags = new Map();
  for (let i=2;i<process.argv.length;i+=2) {
    if (!["--base-url","--scenario","--output","--rounds","--revision"].includes(process.argv[i]) || !process.argv[i+1]) throw Error("Invalid resident verifier argument");
    flags.set(process.argv[i],process.argv[i+1]);
  }
  const output=path.resolve(flags.get("--output")||".runtime/reports/generated/raster-r0-r2/browser");
  const allowed=path.resolve(".runtime")+path.sep;
  if (!output.startsWith(allowed)) throw Error("Reports must stay under .runtime");
  await fs.mkdir(output,{recursive:true});
  const scenarioId=flags.get("--scenario")||"hoi4_1939";
  if (!["hoi4_1936","hoi4_1939","tno_1962"].includes(scenarioId)) throw Error("Unsupported scenario");
  const rounds=Number(flags.get("--rounds")||2);
  if (!Number.isInteger(rounds)||rounds<1||rounds>3) throw Error("rounds must be 1..3");
  const report=await verifyResidentScenario(flags.get("--base-url"),{scenarioId,output,rounds,revision:flags.get("--revision")||"unknown"});
  console.log(JSON.stringify({scenarioId,passed:report.passed,samples:report.samples.map(s=>({mode:s.mode,medianMs:s.medianMs,p95Ms:s.p95Ms,passDelta:s.passDelta})),error:report.error}));
  if (!report.passed) process.exitCode=1;
}
