import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

export function parseArgs(argv) {
  if (argv.includes("--help")) return { help: true };
  const options = {
    baseUrl: process.env.MAPCREATOR_BASE_URL || `http://127.0.0.1:${process.env.MAPCREATOR_DEV_PORT || 8810}`,
    scenarios: ["blank_base", "modern_world", "hoi4_1936", "hoi4_1939", "tno_1962"],
    runs: 1,
    tailMs: 30000,
    urlQuery: "",
    gpu: true,
    out: `.runtime/output/perf/interaction/interaction-${new Date().toISOString().replaceAll(":", "")}.json`,
  };
  const parameters = {
    "--base-url": ["baseUrl", String],
    "--scenarios": ["scenarios", (value) => value.split(",")],
    "--runs": ["runs", Number],
    "--tail-ms": ["tailMs", Number],
    "--url-query": ["urlQuery", String],
    "--gpu": ["gpu", (value) => value === "true"],
    "--out": ["out", String],
  };
  for (let i = 0; i < argv.length; i += 2) {
    const parameter = parameters[argv[i]];
    if (!parameter) throw new Error(`未知参数：${argv[i]}`);
    options[parameter[0]] = parameter[1](argv[i + 1]);
  }
  return options;
}

export function summarizeLoafWindow(entries, start, end) {
  const frames = entries.filter((entry) => entry.start >= start && entry.start < end);
  return {
    count: frames.length,
    totalMs: frames.reduce((total, entry) => total + entry.duration, 0),
    maxMs: frames.reduce((max, entry) => Math.max(max, entry.duration), 0),
    over200Count: frames.filter((entry) => entry.duration > 200).length,
    top: [...frames].sort((a, b) => b.duration - a.duration).slice(0, 5)
      .map((entry) => [entry.start - start, entry.duration, entry.top]),
  };
}

function median(values) {
  const sorted = values.filter((value) => value != null).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function aggregateScenario(runs) {
  const aggregate = {};
  for (const key of ["firstFrameMs", "viewableMs", "editableMs", "settledMs", "panSettledMs"]) {
    aggregate[key] = median(runs.map((run) => run[key]));
  }
  aggregate.tail = {};
  for (const key of ["count", "totalMs", "maxMs", "over200Count"]) {
    aggregate.tail[key] = median(runs.map((run) => run.tail[key]));
  }
  aggregate.drag = {};
  for (const key of ["longestFrameMs", "longFrameCount", "wallMs"]) {
    aggregate.drag[key] = median(runs.map((run) => run.drag[key]));
  }
  aggregate.politicalBackend = [...new Set(runs.map((run) => run.politicalBackend).filter(Boolean))].join("/") || null;
  aggregate.zoomSettledMs = [0, 1, 2].map((step) => median(runs.map((run) => run.zoomSettledMs[step])));
  return aggregate;
}

export function buildMarkdownTable(report) {
  const time = (ms, frame = false) => ms == null ? "—"
    : frame && ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
  const lines = [
    "| 剧本 | 真实首帧 | API 可见 | settled | 尾巴（个数/合计 ms） | 拖拽最长帧 | 平移 settled | 缩放 settled |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const [id, value] of Object.entries(report.scenarios)) {
    const backend = value.politicalBackend ? `（${value.politicalBackend}）` : "";
    lines.push(`| ${id}${backend} | ${time(value.firstFrameMs)} | ${time(value.viewableMs)} | ${time(value.settledMs)} | ${value.tail.count ?? "—"}/${value.tail.totalMs == null ? "—" : Math.round(value.tail.totalMs)} | ${time(value.drag.longestFrameMs, true)} | ${time(value.panSettledMs)} | ${value.zoomSettledMs.map((ms) => time(ms)).join(" / ")} |`);
  }
  return lines.join("\n");
}

function installProbe() {
  const probe = globalThis.__interactionProbe = {
    loafs: [], firstFramePainted: null, viewable: null, editable: null, settled: null,
  };
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const scripts = [...entry.scripts].sort((a, b) => b.duration - a.duration);
      const top = scripts[0];
      probe.loafs.push({
        start: entry.startTime,
        duration: entry.duration,
        blocking: entry.blockingDuration || 0,
        script: scripts.reduce((total, script) => total + script.duration, 0),
        top: top ? `${top.sourceFunctionName}@${top.sourceURL.split("/").pop()}:${top.duration}` : "",
      });
    }
  }).observe({ type: "long-animation-frame", buffered: true });
  function poll() {
    const status = globalThis.__scenarioForgeTestApi?.status();
    for (const key of ["firstFramePainted", "viewable", "editable", "settled"]) {
      if (status?.[key] && probe[key] === null) probe[key] = Math.round(performance.now());
    }
    setTimeout(poll, 50);
  }
  setTimeout(poll, 50);
}

async function waitUntilSettled(page) {
  await page.waitForFunction(() => {
    const status = globalThis.__scenarioForgeTestApi?.status();
    return status?.settled && status?.editable;
  }, null, { polling: 100, timeout: 300000 });
}

async function measureRun(browser, options, scenarioId, run, pageErrors) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  try {
    await context.addInitScript(installProbe);
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const query = options.urlQuery ? `&${options.urlQuery.replace(/^[?&]/, "")}` : "";
    await page.goto(`${options.baseUrl.replace(/\/$/, "")}/app/?default_scenario=${scenarioId}&startup_cache=0&render_profile=balanced&startup_interaction=full${query}`, { waitUntil: "domcontentloaded" });
    await waitUntilSettled(page);
    if (await page.locator("#scenarioGuidePopover").isVisible()) {
      await page.locator("#scenarioGuideCloseBtn").click();
    }
    const tailStart = await page.evaluate(() => performance.now());
    await page.waitForTimeout(options.tailMs);
    const tail = summarizeLoafWindow(await page.evaluate(() => globalThis.__interactionProbe.loafs), tailStart, tailStart + options.tailMs);
    const zoomSettledMs = [];
    for (let step = 0; step < 3; step += 1) {
      const point = await page.evaluate(() => globalThis.__scenarioForgeTestApi.screenPointForLonLat(10, 50));
      await page.mouse.move(point.x, point.y);
      const start = await page.evaluate(() => performance.now());
      await page.mouse.wheel(0, -400);
      await waitUntilSettled(page);
      zoomSettledMs.push(await page.evaluate(() => performance.now()) - start);
    }
    await page.mouse.move(800, 450);
    const dragStart = await page.evaluate(() => performance.now());
    await page.mouse.down();
    for (let j = 1; j <= 20; j += 1) {
      await page.mouse.move(800 - j * 20, 450 + j * 4);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    const dragEnd = await page.evaluate(() => performance.now());
    await waitUntilSettled(page);
    const panSettledMs = await page.evaluate(() => performance.now()) - dragEnd;
    const probe = await page.evaluate(() => globalThis.__interactionProbe);
    // 实际政区渲染后端（raster / vector），用于确认 A/B 的分组真的生效
    const politicalBackend = await page.evaluate(async () => {
      const { renderer } = await globalThis.__scenarioForgeTestApi.internals();
      const raster = renderer.getPoliticalIdRasterDiagnostics?.();
      return raster?.selected && raster.actualBackend === "raster" ? "raster" : "vector";
    });
    const drag = summarizeLoafWindow(probe.loafs, dragStart, dragEnd + 0.001);
    return {
      scenarioId, run, politicalBackend,
      firstFrameMs: probe.firstFramePainted,
      viewableMs: probe.viewable,
      editableMs: probe.editable,
      settledMs: probe.settled,
      tail, zoomSettledMs,
      drag: { longestFrameMs: drag.maxMs, longFrameCount: drag.count, wallMs: dragEnd - dragStart },
      panSettledMs, pageErrors,
    };
  } finally {
    await context.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`用法：node tools/perf/interaction_probe.mjs [选项]
需先运行 python tools/dev_server.py --port <端口>，本脚本不启动服务。
  --base-url <地址>      默认 MAPCREATOR_BASE_URL 或 http://127.0.0.1:<MAPCREATOR_DEV_PORT 或 8810>
  --scenarios <列表>    默认 blank_base,modern_world,hoi4_1936,hoi4_1939,tno_1962
  --runs <次数>         默认 1
  --tail-ms <毫秒>      默认 30000
  --url-query <查询串>  默认空，例如 political_render_mode=raster
  --gpu true|false     默认 true
  --out <路径>         默认 .runtime/output/perf/interaction/interaction-<ISO时间去掉冒号>.json，相对仓库根
  --help               打印用法并退出`);
    return;
  }
  const args = ["--disable-renderer-backgrounding", "--disable-background-timer-throttling"];
  if (options.gpu) {
    args.push("--enable-gpu", "--ignore-gpu-blocklist");
    if (process.platform === "win32") args.push("--use-angle=d3d11");
  }
  const browser = await chromium.launch({ headless: true, args });
  const report = {
    generatedAt: new Date().toISOString(), baseUrl: options.baseUrl,
    urlQuery: options.urlQuery, gpu: options.gpu, tailMs: options.tailMs,
    runs: [], scenarios: {},
  };
  try {
    for (const scenarioId of options.scenarios) {
      const successfulRuns = [];
      for (let run = 1; run <= options.runs; run += 1) {
        const pageErrors = [];
        try {
          const result = await measureRun(browser, options, scenarioId, run, pageErrors);
          report.runs.push(result);
          successfulRuns.push(result);
        } catch (error) {
          report.runs.push({ scenarioId, run, error: error.message, pageErrors });
          process.exitCode = 1;
        }
      }
      report.scenarios[scenarioId] = aggregateScenario(successfulRuns);
    }
  } finally {
    await browser.close();
  }
  const output = path.resolve(repoRoot, options.out);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(buildMarkdownTable(report));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
