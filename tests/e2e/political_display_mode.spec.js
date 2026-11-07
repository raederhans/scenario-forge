const { test, expect } = require("@playwright/test");
const { openApp, waitForSettled, waitForBackgroundIdle, zoomTo, screenPoint, colorShareAround } = require("./golden/golden-support");

async function selectMode(page, mode) {
  await page.locator("#politicalDisplayMode").selectOption(mode, { force: true });
  await waitForSettled(page);
}

async function pixelAt(page, point) {
  const png = await page.screenshot({ clip: { x: Math.round(point.x), y: Math.round(point.y), width: 1, height: 1 } });
  return page.evaluate(async (encoded) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${encoded}`)).blob());
    const canvas = new OffscreenCanvas(1, 1);
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0);
    const pixel = [...context.getImageData(0, 0, 1, 1).data];
    bitmap.close();
    return pixel;
  }, png.toString("base64"));
}

const readEdits = (page) => page.evaluate(() => ({ history: window.__scenarioForgeTestApi.history(), dirty: window.__scenarioForgeTestApi.isDirty() }));

test("HOI4 alliance display restores country pixels without changing edits", async ({ page }) => {
  test.setTimeout(180_000);
  await openApp(page, { scenarioId: "hoi4_1939" });
  await waitForBackgroundIdle(page);
  await zoomTo(page, [10.5, 51.5], { steps: 3, scenarioId: "hoi4_1939" });
  const point = await screenPoint(page, [10.5, 51.5]);
  const before = await pixelAt(page, point);
  const edits = await readEdits(page);
  await selectMode(page, "alliance");
  expect(await colorShareAround(page, point, "#2f2f2f", { radius: 2, tolerance: 12 })).toBeGreaterThan(0.5);
  expect(await pixelAt(page, point)).not.toEqual(before);
  expect(await readEdits(page)).toEqual(edits);
  await selectMode(page, "country");
  expect(await pixelAt(page, point)).toEqual(before);
  expect(await readEdits(page)).toEqual(edits);
});

test("TNO alliance redraw completes within three seconds", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await openApp(page, { scenarioId: "tno_1962" });
  await waitForBackgroundIdle(page);
  await zoomTo(page, [10.5, 51.5], { steps: 3, scenarioId: "tno_1962" });
  const point = await screenPoint(page, [10.5, 51.5]);
  const before = await pixelAt(page, point);
  const started = Date.now();
  await selectMode(page, "alliance");
  const elapsedMs = Date.now() - started;
  console.log(`TNO alliance redraw: ${elapsedMs} ms`);
  await testInfo.attach("tno-alliance-redraw", { body: JSON.stringify({ elapsedMs }), contentType: "application/json" });
  expect(elapsedMs).toBeLessThan(3000);
  expect(await pixelAt(page, point)).not.toEqual(before);
  expect(await colorShareAround(page, point, "#2f2f2f", { radius: 2, tolerance: 12 })).toBeGreaterThan(0.5);
});
