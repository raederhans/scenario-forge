// Opt-in diagnostics for the existing raster release sequence. No product state changes.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const output = process.env.RASTER_WAIT_DIAGNOSTICS;
if (output) {
  fs.mkdirSync(output, { recursive: true });
  const prefix = path.resolve(output, `process-${process.pid}`);
  const stamp = () => ({ epoch: performance.timeOrigin + performance.now(), mono: performance.now() });
  const record = (kind, data = {}) => {
    const event = { kind, ...stamp(), ...data };
    fs.appendFileSync(`${prefix}.jsonl`, JSON.stringify(event) + "\n");
    if (["wait-abort", "wait-rejected", "wait-resolved", "snapshot", "profile-summary", "trace-summary"].includes(kind))
      console.log("RASTER_DIAGNOSTIC " + JSON.stringify(event));
  };
  const bounded = (promise, ms = 3000) => {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("diagnostic collection budget exceeded")), ms); })]).finally(() => clearTimeout(timer));
  };
  const require = createRequire(import.meta.url);
  const coreRoot = path.dirname(require.resolve("playwright-core/package.json"));
  const { ProgressController } = require(path.join(coreRoot, "lib/server/progress.js"));
  const pwTime = require(path.join(coreRoot, "lib/utils/isomorphic/time.js"));
  const run = ProgressController.prototype.run;
  const captures = new Set();
  ProgressController.prototype.run = function(task, timeout) {
    return run.call(this, progress => {
      if (progress.metadata.method === "waitForFunction") {
        const identity = { callId: progress.metadata.id, deadlineEpoch: pwTime.timeOrigin() + progress.deadline };
        record("wait-deadline", identity);
        progress.signal.addEventListener("abort", () => {
          record("wait-abort", { ...identity, reason: String(progress.signal.reason) });
          for (const capture of captures) void capture("abort");
        }, { once: true });
      }
      return task(progress);
    }, timeout);
  };
  const launch = chromium.launch.bind(chromium);
  chromium.launch = async options => {
    const browser = await launch(options);
    record("browser", { version: browser.version(), options });
    const browserCdp = await browser.newBrowserCDPSession();
    const tracePath = `${prefix}-trace.jsonl`;
    let traced = false, traceCount = 0;
    const longEvents = [];
    browserCdp.on("Tracing.dataCollected", ({ value }) => {
      fs.appendFileSync(tracePath, value.map(v => JSON.stringify(v)).join("\n") + "\n");
      traceCount += value.length;
      for (const v of value) if (v.dur > 100000 && longEvents.length < 300) longEvents.push({ name: v.name, pid: v.pid, tid: v.tid, ts: v.ts, dur: v.dur, args: v.args });
    });
    await browserCdp.send("Tracing.start", { categories: "toplevel,devtools.timeline,v8.execute", transferMode: "ReportEvents" });
    const endTrace = async () => {
      if (traced) return;
      traced = true;
      try { await bounded(new Promise((resolve, reject) => {
        browserCdp.once("Tracing.tracingComplete", () => {
          record("trace-summary", { traceCount, longEvents: longEvents.sort((a,b) => b.dur-a.dur).slice(0,20) });
          resolve();
        });
        browserCdp.send("Tracing.end").catch(reject);
      })); } catch (e) { record("trace-error", { error: String(e) }); }
    };
    let sampling = false;
    const sampler = setInterval(async () => {
      if (sampling) return;
      sampling = true;
      try { record("processes", await bounded(browserCdp.send("SystemInfo.getProcessInfo"), 1500)); }
      catch (e) { record("process-sample-error", { error: String(e) }); }
      finally { sampling = false; }
    }, 2000);
    sampler.unref();
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async options => {
      const context = await newContext(options);
      await context.addInitScript(() => {
        const d = window.__rasterWaitObservation = { id: `${performance.timeOrigin}-${Math.random()}`, seq: 0, last: null };
        d.read = () => {
          const s = window.__rasterTask?.state;
          return { documentId: d.id, timeOrigin: performance.timeOrigin, now: performance.now(), url: location.href, visibility: document.visibilityState,
            bootPhase: s?.bootPhase, startupReadonly: s?.startupReadonly, unlock: s?.startupReadonlyUnlockInFlight,
            applying: s?.scenarioApplyInFlight, scenario: s?.activeScenarioId, zoom: s?.zoomTransform,
            raster: window.__rasterTask?.renderer.getPoliticalIdRasterDiagnostics() };
        };
        d.poll = value => { d.last = { seq: ++d.seq, now: performance.now(), value }; return value; };
        setInterval(() => console.log("__RASTER_OBSERVATION__" + JSON.stringify({ ...d.read(), lastPoll: d.last })), 2000);
        new PerformanceObserver(list => console.log("__RASTER_LONGTASK__" + JSON.stringify(list.getEntries().map(e => ({ start: e.startTime, duration: e.duration }))))).observe({ type: "longtask", buffered: true });
      });
      const newPage = context.newPage.bind(context);
      context.newPage = async () => {
        const page = await newPage();
        const cdp = await context.newCDPSession(page);
        await cdp.send("Profiler.enable");
        await cdp.send("Profiler.setSamplingInterval", { interval: 10000 });
        await cdp.send("Profiler.start");
        let captured = false;
        const capture = async reason => {
          if (captured) return;
          captured = true;
          await Promise.allSettled([
            (async () => { try {
              await bounded(cdp.send("Runtime.evaluate", { expression: "JSON.stringify(window.__rasterWaitObservation?.read())", returnByValue: true, timeout: 1000 })
                .then(data => record("snapshot", { reason, data })));
            } catch (e) { record("snapshot-error", { reason, error: String(e) }); } })(),
            (async () => { try {
              await bounded(cdp.send("Profiler.stop").then(({ profile }) => {
              fs.writeFileSync(`${prefix}-${reason}.cpuprofile`, JSON.stringify(profile));
              const counts = new Map();
              for (const id of profile.samples || []) counts.set(id, (counts.get(id) || 0) + 1);
              record("profile-summary", { reason, startTime: profile.startTime, endTime: profile.endTime, top: profile.nodes.map(n => ({ frame: n.callFrame, samples: counts.get(n.id) || 0 })).sort((a,b) => b.samples-a.samples).slice(0, 20) });
              }));
            } catch (e) { record("profile-error", { reason, error: String(e) }); } })(),
            endTrace(),
          ]);
        };
        captures.add(capture);
        page.on("close", () => captures.delete(capture));
        page.on("console", m => {
          if (m.text().startsWith("__RASTER_OBSERVATION__")) record("observation", { pageId: page._guid, frameId: page.mainFrame()._guid, data: JSON.parse(m.text().slice(22)) });
          else if (m.text().startsWith("__RASTER_LONGTASK__")) record("longtask", { data: JSON.parse(m.text().slice(19)) });
        });
        page.on("framenavigated", f => record("navigation", { frameId: f._guid, url: f.url() }));
        const wait = page.waitForFunction.bind(page);
        page.waitForFunction = async (fn, arg, options) => {
          const source = fn.toString();
          const wrapped = typeof fn === "function" ? Function(`return function(arg) { const value = (${source})(arg); return window.__rasterWaitObservation ? window.__rasterWaitObservation.poll(value) : value; }`)() : fn;
          record("wait-call", { source, options, pageId: page._guid });
          try { const handle = await wait(wrapped, arg, options); record("wait-resolved"); return handle; }
          catch (e) { record("wait-rejected", { error: String(e) }); throw e; }
        };
        return page;
      };
      return context;
    };
    const close = browser.close.bind(browser);
    browser.close = async (...args) => {
      clearInterval(sampler);
      await Promise.allSettled([...captures].map(capture => capture("close")));
      await endTrace();
      return close(...args);
    };
    browser.on("disconnected", () => clearInterval(sampler));
    return browser;
  };
}
