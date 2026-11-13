// Helpers for the golden user flows. They drive the app through the DOM and the
// read-only window.__scenarioForgeTestApi (js/core/app_test_api.js) only, so the
// golden suite keeps working when internal state or the renderer is rewritten.
const { expect } = require("@playwright/test");

const GOLDEN_APP_PATH = "/app/?render_profile=balanced&startup_interaction=full&startup_worker=0&startup_cache=0";
const SCENARIO_IDS = ["blank_base", "hoi4_1936", "hoi4_1939", "modern_world", "tno_1962"];
// Interior Western Australia (Gibson Desert): a large region in every scenario,
// with no city markers or country labels nearby.
const PROBE_LON_LAT = [121.5, -25.5];

function collectPageErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  return errors;
}

async function readStatus(page) {
  return page.evaluate(() => globalThis.__scenarioForgeTestApi?.status() || null);
}

async function waitForSettled(page, { scenarioId = "", editable = true, timeout = 120_000 } = {}) {
  await expect.poll(async () => {
    const status = await readStatus(page);
    if (status?.bootError) throw new Error(`boot error: ${status.bootError}`);
    return !!status
      && status.settled
      && (!editable || status.editable)
      && (!scenarioId || status.scenarioId === scenarioId);
  }, { timeout, intervals: [250, 500, 1000] }).toBe(true);
  // Two frames so the last render is composited before pixels are sampled.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function closeScenarioGuide(page) {
  const guide = page.locator("#scenarioGuidePopover");
  if (await guide.isVisible()) await page.locator("#scenarioGuideCloseBtn").click();
}

// 取点前显式建立视角前提：用户可见的快捷键 0 把视角复位到全图，等缩放回到 1 且渲染稳定。
// 剧本可以有自己的开场视角，黄金流程不依赖"打开或切换后仍是全图"。
async function resetViewToWorld(page, { scenarioId = "", timeout = 120_000 } = {}) {
  await parkMouse(page);
  await page.keyboard.press("0");
  await expect.poll(async () => {
    const status = await readStatus(page);
    return Math.abs(Number(status?.viewport?.k) - 1) < 0.01;
  }, { timeout, intervals: [100, 250, 500] }).toBe(true);
  await waitForSettled(page, { scenarioId, timeout });
}

async function openApp(page, { timeout = 120_000, scenarioId = "", query = "" } = {}) {
  await page.setViewportSize({ width: 1440, height: 900 });
  const started = Date.now();
  let appPath = scenarioId
    ? `${GOLDEN_APP_PATH}&default_scenario=${encodeURIComponent(scenarioId)}`
    : GOLDEN_APP_PATH;
  if (query) appPath += `&${query}`;
  await page.goto(appPath, { waitUntil: "domcontentloaded" });
  await waitForSettled(page, { timeout });
  const startupMs = Date.now() - started;
  await closeScenarioGuide(page);
  await resetViewToWorld(page, { timeout });
  return { startupMs };
}

async function switchScenario(page, scenarioId, { timeout = 120_000 } = {}) {
  const status = await readStatus(page);
  if (status?.scenarioId === scenarioId) return;
  // Top bar "Scenario" menu -> custom picker (the native <select> is hidden) -> Apply.
  await page.locator("#lblScenario").click();
  await page.locator("#scenarioSelectButton").click();
  await page.locator(`#scenarioSelectMenu [role="option"][data-value="${scenarioId}"]`).click();
  await page.locator("#applyScenarioBtn").click();
  await waitForSettled(page, { scenarioId, timeout });
  await closeScenarioGuide(page);
  await resetViewToWorld(page, { scenarioId, timeout });
}

async function screenPoint(page, [lon, lat] = PROBE_LON_LAT) {
  const point = await page.evaluate(([x, y]) => globalThis.__scenarioForgeTestApi.screenPointForLonLat(x, y), [lon, lat]);
  expect(point, `no screen point for ${lon},${lat}`).toBeTruthy();
  return point;
}

// Zoom the map in around a geographic point with the mouse wheel, like a user would.
async function zoomTo(page, lonLat = PROBE_LON_LAT, { steps = 3, scenarioId = "" } = {}) {
  for (let i = 0; i < steps; i += 1) {
    const point = await screenPoint(page, lonLat);
    await page.mouse.move(point.x, point.y);
    await page.mouse.wheel(0, -400);
    await waitForSettled(page, { scenarioId });
  }
  await parkMouse(page);
  await waitForSettled(page, { scenarioId });
  return screenPoint(page, lonLat);
}

function hexToRgb(hex) {
  const value = Number.parseInt(String(hex).replace("#", ""), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

// Share of pixels in a square around (x, y) that match `hex` within `tolerance`.
// Uses a real screenshot, so it checks what the user sees whatever draws it.
async function colorShareAround(page, { x, y }, hex, { radius = 6, tolerance = 6 } = {}) {
  const clip = { x: Math.round(x) - radius, y: Math.round(y) - radius, width: radius * 2 + 1, height: radius * 2 + 1 };
  const png = await page.screenshot({ clip });
  return page.evaluate(async ({ encoded, rgb, tolerance: limit }) => {
    const blob = await (await fetch(`data:image/png;base64,${encoded}`)).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let matching = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (Math.abs(pixels[i] - rgb[0]) <= limit
        && Math.abs(pixels[i + 1] - rgb[1]) <= limit
        && Math.abs(pixels[i + 2] - rgb[2]) <= limit) matching += 1;
    }
    bitmap.close();
    return matching / (pixels.length / 4);
  }, { encoded: png.toString("base64"), rgb: hexToRgb(hex), tolerance });
}

// Screenshot of the square around (x, y), for comparing what the user sees before and after.
async function snapshotAround(page, { x, y }, { radius = 12 } = {}) {
  return page.screenshot({ clip: { x: Math.round(x) - radius, y: Math.round(y) - radius, width: radius * 2 + 1, height: radius * 2 + 1 } });
}

// Share of pixels that differ by more than `tolerance` on any channel between two
// same-sized PNG screenshots.
async function pixelChangeShare(page, beforePng, afterPng, { tolerance = 12 } = {}) {
  return page.evaluate(async ({ before, after, limit }) => {
    const decode = async (encoded) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${encoded}`)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      return context.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const [a, b] = await Promise.all([decode(before), decode(after)]);
    if (a.length !== b.length) throw new Error("snapshots differ in size");
    let changed = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (Math.abs(a[i] - b[i]) > limit || Math.abs(a[i + 1] - b[i + 1]) > limit || Math.abs(a[i + 2] - b[i + 2]) > limit) changed += 1;
    }
    return changed / (a.length / 4);
  }, { before: beforePng.toString("base64"), after: afterPng.toString("base64"), limit: tolerance });
}

// Share of pixels in a whole PNG (e.g. an exported image) that match `hex`.
async function colorShareInPng(page, png, hex, { tolerance = 6 } = {}) {
  return page.evaluate(async ({ encoded, rgb, limit }) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${encoded}`)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let matching = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (Math.abs(pixels[i] - rgb[0]) <= limit
        && Math.abs(pixels[i + 1] - rgb[1]) <= limit
        && Math.abs(pixels[i + 2] - rgb[2]) <= limit) matching += 1;
    }
    return matching / (pixels.length / 4);
  }, { encoded: png.toString("base64"), rgb: hexToRgb(hex), limit: tolerance });
}

// The app replaces most native <select>s with a button and a listbox; pick by option value.
async function chooseStyledOption(page, button, value) {
  await button.click();
  const listId = await button.getAttribute("aria-controls");
  await page.locator(`#${listId} [role="option"][data-value="${value}"]`).click();
}

// Save the project from the Project panel. Headless browsers cancel the Save As dialog,
// so choose "Browser download" like a user without file-system access would.
async function saveProjectFile(page, savePath) {
  await page.locator("#inspectorSidebarTabProject").click();
  await page.locator("#projectDownloadDestination").selectOption("browser");
  const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
  await page.locator("#downloadProjectBtn").click();
  const download = await downloadPromise;
  await download.saveAs(savePath);
  return savePath;
}

// Count distinct coarse colors in the map area: a blank or failed render has very few.
async function mapColorVariety(page) {
  const box = await page.locator("#mapContainer").boundingBox();
  const png = await page.screenshot({ clip: box });
  return page.evaluate(async (encoded) => {
    const blob = await (await fetch(`data:image/png;base64,${encoded}`)).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const buckets = new Set();
    for (let i = 0; i < pixels.length; i += 4 * 7) {
      buckets.add(`${pixels[i] >> 4},${pixels[i + 1] >> 4},${pixels[i + 2] >> 4}`);
    }
    bitmap.close();
    return buckets.size;
  }, png.toString("base64"));
}

async function selectFillTool(page, hex) {
  await page.locator("#paintModeVisualBtn").click();
  await page.locator("#toolFillBtn").click();
  await page.locator("#customColor").fill(hex);
}

// Move the pointer to the map's left edge so hover tooltips and outlines stay off the probe.
async function parkMouse(page) {
  const box = await page.locator("#mapContainer").boundingBox();
  await page.mouse.move(box.x + 4, box.y + box.height - 4);
}

// Click-fill at a point; returns the ids whose user color changed.
async function fillAt(page, point, { scenarioId = "" } = {}) {
  const before = await page.evaluate(() => globalThis.__scenarioForgeTestApi.editedFeatureColors());
  await page.mouse.click(point.x, point.y);
  await parkMouse(page);
  await expect.poll(async () => {
    const after = await page.evaluate(() => globalThis.__scenarioForgeTestApi.editedFeatureColors());
    return Object.keys(after).filter((id) => after[id] !== before[id]).length;
  }, { timeout: 15_000 }).toBeGreaterThan(0);
  await waitForSettled(page, { scenarioId });
  const after = await page.evaluate(() => globalThis.__scenarioForgeTestApi.editedFeatureColors());
  return Object.keys(after).filter((id) => after[id] !== before[id]);
}

// Wait for work that may land after `settled`: full bundle hydration (and its health
// gate) and the deferred detail-topology promotion.
async function waitForBackgroundIdle(page, { timeout = 120_000 } = {}) {
  await expect.poll(async () => {
    const status = await readStatus(page);
    if (status?.bootError) throw new Error(`boot error: ${status.bootError}`);
    const background = status?.background;
    return !!background
      && !background.detailPending
      && (background.healthGate !== "idle" || background.fatalRecovery);
  }, { timeout, intervals: [500, 1000] }).toBe(true);
}

// The names drawn in the visible map: city IDs and country codes. Country names fit
// asynchronously and some label passes redraw once more after the map settles, so
// wait for no pending fits and two equal reads a second apart.
async function readStableLabels(page, { timeout = 60_000 } = {}) {
  const read = () => page.evaluate(() => globalThis.__scenarioForgeTestApi.labels());
  let previous = null;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const next = await read();
    if (!next.pendingCountryFits && previous && JSON.stringify(next) === JSON.stringify(previous)) {
      return { cities: next.cities, countries: next.countries };
    }
    previous = next.pendingCountryFits ? null : next;
    await page.waitForTimeout(1000);
  }
  throw new Error(`map labels did not settle: ${JSON.stringify(previous)}`);
}

module.exports = {
  GOLDEN_APP_PATH,
  PROBE_LON_LAT,
  SCENARIO_IDS,
  chooseStyledOption,
  closeScenarioGuide,
  collectPageErrors,
  colorShareAround,
  colorShareInPng,
  fillAt,
  mapColorVariety,
  openApp,
  parkMouse,
  pixelChangeShare,
  readStableLabels,
  readStatus,
  saveProjectFile,
  screenPoint,
  selectFillTool,
  snapshotAround,
  switchScenario,
  resetViewToWorld,
  waitForBackgroundIdle,
  waitForSettled,
  zoomTo,
};
