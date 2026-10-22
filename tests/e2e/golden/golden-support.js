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

async function openApp(page, { timeout = 120_000 } = {}) {
  await page.setViewportSize({ width: 1440, height: 900 });
  const started = Date.now();
  await page.goto(GOLDEN_APP_PATH, { waitUntil: "domcontentloaded" });
  await waitForSettled(page, { timeout });
  const startupMs = Date.now() - started;
  await closeScenarioGuide(page);
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

module.exports = {
  GOLDEN_APP_PATH,
  PROBE_LON_LAT,
  SCENARIO_IDS,
  closeScenarioGuide,
  collectPageErrors,
  colorShareAround,
  fillAt,
  mapColorVariety,
  openApp,
  parkMouse,
  readStatus,
  screenPoint,
  selectFillTool,
  switchScenario,
  waitForSettled,
  zoomTo,
};
