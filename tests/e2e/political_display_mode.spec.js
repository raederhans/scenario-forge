const { test, expect } = require("@playwright/test");
const { openApp, waitForSettled, waitForBackgroundIdle, zoomTo, screenPoint } = require("./golden/golden-support");

const BLOCK_RADIUS = 6;

async function selectMode(page, mode) {
  await page.locator("#politicalDisplayMode").selectOption(mode, { force: true });
  await waitForSettled(page);
}

// Pixels of a small square around the probe. Overlays such as railways or
// labels may cover part of it; region fills cover the rest.
async function blockAt(page, point, radius = BLOCK_RADIUS) {
  const size = radius * 2 + 1;
  const png = await page.screenshot({ clip: { x: Math.round(point.x) - radius, y: Math.round(point.y) - radius, width: size, height: size } });
  return page.evaluate(async ({ encoded, size }) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${encoded}`)).blob());
    const canvas = new OffscreenCanvas(size, size);
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0);
    const data = [...context.getImageData(0, 0, size, size).data];
    bitmap.close();
    return data;
  }, { encoded: png.toString("base64"), size });
}

// Share of pixels whose color moved by more than the antialiasing step.
function changedShare(before, after) {
  let changed = 0;
  for (let offset = 0; offset < before.length; offset += 4) {
    if ([0, 1, 2].some((channel) => Math.abs(before[offset + channel] - after[offset + channel]) > 3)) changed += 1;
  }
  return changed / (before.length / 4);
}

// The GPU palette upload lands a frame or two after the shell reports settled,
// so wait for the region fill under the probe itself rather than for the settled signal.
async function waitForFillChange(page, point, before, timeout = 10_000) {
  let block = before;
  await expect.poll(async () => {
    block = await blockAt(page, point);
    return changedShare(before, block);
  }, { timeout, intervals: [50, 100, 200] }).toBeGreaterThan(0.3);
  return block;
}

// The recolored region fill is the most common new color among changed
// pixels; antialiased or translucent overlays (railways, labels) spread over many.
function dominantRecolor(before, after) {
  const counts = new Map();
  for (let offset = 0; offset < before.length; offset += 4) {
    if (![0, 1, 2].some((channel) => Math.abs(before[offset + channel] - after[offset + channel]) > 3)) continue;
    const key = after.slice(offset, offset + 3).join(",");
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return top ? top[0].split(",").map(Number) : null;
}

function nearHex(rgb, hex, tolerance = 12) {
  return !!rgb && [1, 3, 5].every((index, channel) => Math.abs(rgb[channel] - parseInt(hex.slice(index, index + 2), 16)) <= tolerance);
}

const readEdits = (page) => page.evaluate(() => ({ history: window.__scenarioForgeTestApi.history(), dirty: window.__scenarioForgeTestApi.isDirty() }));

test("HOI4 alliance display restores country pixels without changing edits", async ({ page }) => {
  test.setTimeout(180_000);
  await openApp(page, { scenarioId: "hoi4_1939" });
  await waitForBackgroundIdle(page);
  await zoomTo(page, [10.5, 51.5], { steps: 3, scenarioId: "hoi4_1939" });
  const point = await screenPoint(page, [10.5, 51.5]);
  const before = await blockAt(page, point);
  const edits = await readEdits(page);
  await selectMode(page, "alliance");
  const allianceBlock = await waitForFillChange(page, point, before);
  expect(nearHex(dominantRecolor(before, allianceBlock), "#2f2f2f")).toBe(true);
  expect(await readEdits(page)).toEqual(edits);
  await selectMode(page, "country");
  await waitForFillChange(page, point, allianceBlock);
  // Path and GPU presentations may differ by one channel step in antialiasing.
  expect(changedShare(before, await blockAt(page, point))).toBeLessThan(0.05);
  expect(await readEdits(page)).toEqual(edits);
});

test("TNO alliance redraw completes within three seconds", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await openApp(page, { scenarioId: "tno_1962" });
  await waitForBackgroundIdle(page);
  await zoomTo(page, [10.5, 51.5], { steps: 3, scenarioId: "tno_1962" });
  const point = await screenPoint(page, [10.5, 51.5]);
  const before = await blockAt(page, point);
  const started = Date.now();
  await page.locator("#politicalDisplayMode").selectOption("alliance", { force: true });
  await waitForFillChange(page, point, before);
  const elapsedMs = Date.now() - started;
  console.log(`TNO alliance redraw: ${elapsedMs} ms`);
  await testInfo.attach("tno-alliance-redraw", { body: JSON.stringify({ elapsedMs }), contentType: "application/json" });
  expect(elapsedMs).toBeLessThan(3000);
  await waitForSettled(page);
  expect(nearHex(dominantRecolor(before, await blockAt(page, point)), "#2f2f2f")).toBe(true);
});
