// 临时性能剖析脚本：测量一次填色点击的耗时与热点函数。提交前删除。
const fs = require("fs");
const { test } = require("@playwright/test");
const { openApp, selectFillTool, zoomTo, parkMouse, waitForSettled, switchScenario } = require("./golden-support");

const SCENARIO = process.env.PROFILE_SCENARIO || "tno_1962";
const THROTTLE = Number(process.env.PROFILE_THROTTLE || 4);

test("剖析填色点击", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  await openApp(page);
  await switchScenario(page, SCENARIO);
  const point = await zoomTo(page, undefined, { scenarioId: SCENARIO });
  await selectFillTool(page, "#e31ac4");
  await waitForSettled(page, { scenarioId: SCENARIO });
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate(() => {
    globalThis.__prof = { events: [], longTasks: [] };
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) globalThis.__prof.events.push({ name: e.name, duration: e.duration, processing: e.processingEnd - e.processingStart });
    }).observe({ type: "event", durationThreshold: 16, buffered: false });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) globalThis.__prof.longTasks.push({ start: e.startTime, duration: e.duration });
    }).observe({ type: "longtask", buffered: false });
    globalThis.__prof.loaf = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) globalThis.__prof.loaf.push({
        start: Math.round(e.startTime), duration: Math.round(e.duration), blocking: Math.round(e.blockingDuration),
        render: Math.round(e.renderStart ? e.startTime + e.duration - e.renderStart : 0),
        raf: Math.round(e.renderStart && e.styleAndLayoutStart ? e.styleAndLayoutStart - e.renderStart : 0),
        styleLayoutPaint: Math.round(e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0),
        scriptCount: e.scripts.length,
        scripts: e.scripts.map((sc) => ({ d: Math.round(sc.duration), inv: sc.invoker, fn: sc.sourceFunctionName,
          src: String(sc.sourceURL).replace(/^.*\/js\//, "js/"), pos: sc.sourceCharPosition, layout: Math.round(sc.forcedStyleAndLayoutDuration) })),
      });
    }).observe({ type: "long-animation-frame", buffered: false });
    globalThis.__prof.clickAt = null;
    addEventListener("click", () => { globalThis.__prof.clickAt = performance.now(); }, { capture: true, once: true });
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  await cdp.send("Profiler.start");
  const t0 = Date.now();
  await page.mouse.click(point.x, point.y);
  await parkMouse(page);
  // 剖析窗口内不向页面发任何 evaluate，避免把测试脚本自身的开销采进来。
  await page.waitForTimeout(Number(process.env.PROFILE_WINDOW_MS || 8000));
  const { profile } = await cdp.send("Profiler.stop");
  await waitForSettled(page, { scenarioId: SCENARIO, timeout: 120_000 });
  const settledMs = Date.now() - t0;
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  const prof = await page.evaluate(() => globalThis.__prof);
  const metrics = await page.evaluate(() => {
    // 只保留点击后 1 秒内记录的渲染指标（recordedAt 是墙钟时间）。
    const clickEpoch = performance.timeOrigin + (globalThis.__prof.clickAt || 0);
    const m = globalThis.__renderPerfMetrics || {};
    const pick = {};
    for (const [k, v] of Object.entries(m)) {
      if (!v || typeof v !== "object" || !(v.recordedAt >= clickEpoch && v.recordedAt <= clickEpoch + 1000)) continue;
      pick[k] = { at: Math.round(v.recordedAt - clickEpoch), ms: Math.round((v.durationMs ?? v.totalMs ?? 0) * 10) / 10, reason: v.reason || v.inputLabel };
    }
    return pick;
  });
  for (const [k, v] of Object.entries(metrics).sort((a, b) => a[1].at - b[1].at)) console.log(`METRIC +${v.at}ms ${k} ${v.ms}ms ${v.reason || ""}`);
  require("fs").writeFileSync(`.runtime/reports/generated/fill-metrics-${SCENARIO}.json`, JSON.stringify(metrics, null, 2));

  // 按函数聚合 self time
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const dt = profile.timeDeltas;
  for (let i = 0; i < profile.samples.length; i += 1) {
    const node = byId.get(profile.samples[i]);
    const f = node.callFrame;
    const key = `${f.functionName || "(anonymous)"} ${String(f.url).replace(/^.*\/js\//, "js/")}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) || 0) + (dt[i] || 0) / 1000);
  }
  const top = [...self.entries()].filter(([k]) => !k.startsWith("(idle)") && !k.startsWith("(program)"))
    .sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, ms]) => `${ms.toFixed(1).padStart(8)} ms  ${k}`);
  const report = {
    scenario: SCENARIO, throttle: THROTTLE, settledMs,
    inputEvents: prof.events,
    longTasks: prof.longTasks.map((t) => Math.round(t.duration)),
    longTaskTotalMs: Math.round(prof.longTasks.reduce((s, t) => s + t.duration, 0)),
    topSelfTime: top,
  };
  fs.mkdirSync(".runtime/reports/generated", { recursive: true });
  fs.writeFileSync(`.runtime/reports/generated/fill-profile-${SCENARIO}.json`, JSON.stringify(report, null, 2));
  fs.writeFileSync(`.runtime/reports/generated/fill-profile-${SCENARIO}.cpuprofile`, JSON.stringify(profile));
  const click = prof.events.find((e) => e.name === "click");
  const firstFrames = prof.loaf.filter((f) => f.start + f.duration >= (prof.clickAt || 0) - 1).slice(0, 4);
  console.log(JSON.stringify({ settledMs, inp: click?.duration, clickProcessing: click?.processing, longTaskTotalMs: report.longTaskTotalMs }));
  for (const f of firstFrames) {
    console.log(`LoAF start+${Math.round(f.start - prof.clickAt)}ms dur ${f.duration} blocking ${f.blocking} rAF回调 ${f.raf} 样式布局绘制 ${f.styleLayoutPaint} 脚本数 ${f.scriptCount}`);
    for (const sc of f.scripts.sort((a, b) => b.d - a.d).slice(0, 6)) console.log(`   ${String(sc.d).padStart(5)}ms ${sc.inv} :: ${sc.fn} ${sc.src} layout=${sc.layout}`);
  }
  fs.writeFileSync(`.runtime/reports/generated/fill-loaf-${SCENARIO}.json`, JSON.stringify({ clickAt: prof.clickAt, loaf: prof.loaf, events: prof.events }, null, 2));
  console.log(top.slice(0, 30).join("\n"));
});
