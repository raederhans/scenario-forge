// 临时性能剖析脚本：测量测深开/关时的加载、重绘与缩放耗时，并截图。研究结束后删除。
const fs = require("fs");
const path = require("path");
const { test } = require("@playwright/test");
const { openApp, zoomTo, parkMouse, waitForSettled, switchScenario } = require("./golden-support");

const SCENARIO = process.env.PROFILE_SCENARIO || "";
const OUT_DIR = path.join(process.cwd(), ".runtime", "browser", "bathymetry");

test.use({ launchOptions: { args: ["--enable-gpu", "--use-angle=d3d11"] } });

async function installObservers(page) {
  await page.evaluate(() => {
    globalThis.__prof = { loaf: [] };
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) globalThis.__prof.loaf.push({
        start: Math.round(e.startTime), duration: Math.round(e.duration),
        scripts: e.scripts.map((sc) => ({ d: Math.round(sc.duration), fn: sc.sourceFunctionName,
          src: String(sc.sourceURL).replace(/^.*\/js\//, "js/") })).filter((s) => s.d >= 10),
      });
    }).observe({ type: "long-animation-frame", buffered: false });
  });
}

async function metrics(page) {
  return page.evaluate(() => {
    const all = globalThis.__renderPerfMetrics || {};
    const pick = {};
    for (const [key, value] of Object.entries(all)) {
      if (/bathym|ocean|background|drawBathy|paintGlobal|Water|totalRender|renderFrame|settle/i.test(key)) pick[key] = value;
    }
    return { pick, heapMB: Math.round((performance.memory?.usedJSHeapSize || 0) / 1048576) };
  });
}

async function drainLoaf(page) {
  return page.evaluate(() => {
    const out = globalThis.__prof.loaf.splice(0);
    return { count: out.length, total: out.reduce((a, b) => a + b.duration, 0), max: Math.max(0, ...out.map((e) => e.duration)), top: out.sort((a, b) => b.duration - a.duration).slice(0, 4) };
  });
}

async function wheelBurst(page, lonLat, deltaY) {
  const point = await page.evaluate(([lon, lat]) => globalThis.__scenarioForgeTestApi?.projectLonLat?.([lon, lat]) || null, lonLat).catch(() => null);
  const box = await page.locator("#map-container, #mapContainer, .map-container").first().boundingBox().catch(() => null);
  const x = point?.x ?? (box ? box.x + box.width / 2 : 700);
  const y = point?.y ?? (box ? box.y + box.height / 2 : 450);
  await page.mouse.move(x, y);
  const started = Date.now();
  for (let i = 0; i < 6; i += 1) {
    await page.mouse.wheel(0, deltaY);
    await page.waitForTimeout(40);
  }
  return started;
}

async function toggleBathymetry(page, on) {
  await page.evaluate((enabled) => {
    const box = document.getElementById("oceanAdvancedStylesToggle");
    box.checked = enabled;
    box.dispatchEvent(new Event("change", { bubbles: true }));
  }, on);
}

test("剖析海洋测深", async ({ page }) => {
  test.setTimeout(600_000);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tag = SCENARIO || "default";
  await openApp(page);
  if (SCENARIO) await switchScenario(page, SCENARIO);
  await waitForSettled(page, { scenarioId: SCENARIO });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await page.bringToFront();
  await installObservers(page);
  const report = { scenario: tag, steps: {} };

  // 关闭状态基线：缩放一轮。
  report.steps.offBaseline = await metrics(page);
  await page.screenshot({ path: path.join(OUT_DIR, `${tag}-off-k1.png`) });
  await wheelBurst(page, null, -300);
  await waitForSettled(page, { scenarioId: SCENARIO });
  report.steps.offZoomIn = await drainLoaf(page);
  await wheelBurst(page, null, 300);
  await waitForSettled(page, { scenarioId: SCENARIO });
  report.steps.offZoomOut = await drainLoaf(page);

  // 打开测深：加载 + 首次绘制。
  const t0 = Date.now();
  await toggleBathymetry(page, true);
  await page.waitForFunction(() => globalThis.__renderPerfMetrics?.bathymetryVisibility?.status === "ready"
    || globalThis.__renderPerfMetrics?.bathymetryVisibility?.details?.status === "ready", null, { timeout: 120_000 }).catch(() => {});
  await waitForSettled(page, { scenarioId: SCENARIO });
  report.steps.enableWallMs = Date.now() - t0;
  report.steps.enableLoaf = await drainLoaf(page);
  report.steps.onAfterLoad = await metrics(page);
  await page.waitForTimeout(4000);
  await waitForSettled(page, { scenarioId: SCENARIO });
  drainLoaf(page);
  await parkMouse(page);
  await page.screenshot({ path: path.join(OUT_DIR, `${tag}-on-k1.png`) });

  // 打开状态：同样的缩放。
  await wheelBurst(page, null, -300);
  await waitForSettled(page, { scenarioId: SCENARIO });
  report.steps.onZoomIn = await drainLoaf(page);
  report.steps.onAfterZoomIn = await metrics(page);
  await page.screenshot({ path: path.join(OUT_DIR, `${tag}-on-zoom1.png`) });
  await wheelBurst(page, null, -300);
  await waitForSettled(page, { scenarioId: SCENARIO });
  report.steps.onZoomIn2 = await drainLoaf(page);
  report.steps.onAfterZoomIn2 = await metrics(page);
  await page.screenshot({ path: path.join(OUT_DIR, `${tag}-on-zoom2.png`) });
  // 平移
  const box = await page.viewportSize();
  await page.mouse.move(box.width / 2, box.height / 2);
  await page.mouse.down();
  for (let i = 0; i < 20; i += 1) { await page.mouse.move(box.width / 2 - i * 15, box.height / 2 - i * 5); await page.waitForTimeout(16); }
  await page.mouse.up();
  await parkMouse(page);
  await waitForSettled(page, { scenarioId: SCENARIO });
  report.steps.onPan = await drainLoaf(page);
  report.steps.onAfterPan = await metrics(page);
  await page.screenshot({ path: path.join(OUT_DIR, `${tag}-on-pan.png`) });
  await wheelBurst(page, null, 600);
  await waitForSettled(page, { scenarioId: SCENARIO });
  report.steps.onZoomOut = await drainLoaf(page);
  report.steps.onAfterZoomOut = await metrics(page);
  await page.screenshot({ path: path.join(OUT_DIR, `${tag}-on-zoomout.png`) });
  // 回到全图后连续三次小平移，测 overview 层每次重绘的稳定成本。
  for (let r = 0; r < 3; r += 1) {
    await page.mouse.move(box.width / 2, box.height / 2);
    await page.mouse.down();
    for (let i = 0; i < 10; i += 1) { await page.mouse.move(box.width / 2 + i * 8, box.height / 2); await page.waitForTimeout(16); }
    await page.mouse.up();
    await parkMouse(page);
    await waitForSettled(page, { scenarioId: SCENARIO });
  }
  report.steps.onOverviewPan = await drainLoaf(page);
  report.steps.onAfterOverviewPan = await metrics(page);
  await toggleBathymetry(page, false);
  await waitForSettled(page, { scenarioId: SCENARIO });
  drainLoaf(page);
  for (let r = 0; r < 3; r += 1) {
    await page.mouse.move(box.width / 2, box.height / 2);
    await page.mouse.down();
    for (let i = 0; i < 10; i += 1) { await page.mouse.move(box.width / 2 + i * 8, box.height / 2); await page.waitForTimeout(16); }
    await page.mouse.up();
    await parkMouse(page);
    await waitForSettled(page, { scenarioId: SCENARIO });
  }
  report.steps.offOverviewPan = await drainLoaf(page);

  fs.writeFileSync(path.join(OUT_DIR, `${tag}-report.json`), JSON.stringify(report, null, 2));
});
