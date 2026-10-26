// Golden user flows: the behavior safety net for the architecture rewrite.
// These tests use only the DOM and window.__scenarioForgeTestApi; see golden-support.js.
const fs = require("fs");
const { test, expect } = require("@playwright/test");
const {
  SCENARIO_IDS,
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
} = require("./golden-support");
const { PERF_BUDGETS } = require("./golden-budgets");

const FILL = "#e31ac4";
const FILLED = 0.35;
const UNFILLED = 0.05;

async function paintProbe(page, scenarioId) {
  const point = await zoomTo(page, undefined, { scenarioId });
  expect(await colorShareAround(page, point, FILL), "probe already has the fill color").toBeLessThan(UNFILLED);
  await selectFillTool(page, FILL);
  const changed = await fillAt(page, point, { scenarioId });
  expect(changed.length).toBeGreaterThan(0);
  expect(await colorShareAround(page, point, FILL), "filled region is not visible").toBeGreaterThan(FILLED);
  return { point, changed };
}

test("startup reaches an editable, rendered map", async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectPageErrors(page);
  const { startupMs } = await openApp(page);
  const status = await readStatus(page);
  expect(status.scenarioId).toBeTruthy();
  expect(await mapColorVariety(page)).toBeGreaterThan(20);
  expect(errors).toEqual([]);
  test.info().annotations.push({ type: "startupMs", description: String(startupMs) });
  expect(startupMs, "cold startup to an editable, settled map").toBeLessThan(PERF_BUDGETS.startupMs);
});

test("first map click only selects without creating history or dirty state", async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectPageErrors(page);
  await openApp(page);
  await waitForSettled(page);
  const point = await screenPoint(page);
  await page.mouse.click(point.x, point.y);
  await waitForSettled(page);
  expect(await page.evaluate(() => globalThis.__scenarioForgeTestApi.history())).toEqual({ undo: 0, redo: 0 });
  expect(await page.evaluate(() => globalThis.__scenarioForgeTestApi.isDirty())).toBe(false);
  const selection = await page.evaluate(() => globalThis.__scenarioForgeTestApi.selection());
  expect(selection.selectedInspectorCountryCode).toBeTruthy();
  expect(selection.currentTool).toBe("select");
  expect(errors).toEqual([]);
});

for (const scenarioId of SCENARIO_IDS) {
  test(`${scenarioId}: switching scenario then filling a region shows in the map`, async ({ page }) => {
    test.setTimeout(240_000);
    const errors = collectPageErrors(page);
    await openApp(page);
    await switchScenario(page, scenarioId);
    expect(await mapColorVariety(page)).toBeGreaterThan(5);
    await paintProbe(page, scenarioId);
    expect(errors).toEqual([]);
  });
}

test("undo and redo, by button and keyboard, restore the rendered map", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = collectPageErrors(page);
  await openApp(page);
  await switchScenario(page, "hoi4_1936");
  const { point } = await paintProbe(page, "hoi4_1936");
  const afterFill = await page.evaluate(() => globalThis.__scenarioForgeTestApi.history());

  await page.locator("#undoBtn").click();
  await waitForSettled(page);
  expect(await colorShareAround(page, point, FILL)).toBeLessThan(UNFILLED);
  expect((await page.evaluate(() => globalThis.__scenarioForgeTestApi.history())).undo).toBe(afterFill.undo - 1);
  await page.locator("#redoBtn").click();
  await waitForSettled(page);
  expect(await colorShareAround(page, point, FILL)).toBeGreaterThan(FILLED);

  // Keyboard shortcuts need focus outside text inputs (the color field had it).
  await page.locator("#mapContainer").focus().catch(() => {});
  await page.keyboard.press("Control+z");
  await waitForSettled(page);
  expect(await colorShareAround(page, point, FILL)).toBeLessThan(UNFILLED);
  await page.keyboard.press("Control+y");
  await waitForSettled(page);
  expect(await colorShareAround(page, point, FILL)).toBeGreaterThan(FILLED);
  expect(errors).toEqual([]);
});

test("a saved project reopens with the same edits after a reload", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const errors = collectPageErrors(page);
  await openApp(page);
  await switchScenario(page, "hoi4_1936");
  await paintProbe(page, "hoi4_1936");
  const edits = await page.evaluate(() => globalThis.__scenarioForgeTestApi.editedFeatureColors());
  expect(await page.evaluate(() => globalThis.__scenarioForgeTestApi.isDirty())).toBe(true);

  // Headless browsers cancel the Save As dialog, so choose "Browser download" like a
  // user without file-system access would, then save from the Project panel.
  await page.locator("#inspectorSidebarTabProject").click();
  await page.locator("#projectDownloadDestination").selectOption("browser");
  const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
  await page.locator("#downloadProjectBtn").click();
  const download = await downloadPromise;
  const savePath = testInfo.outputPath("golden.project.json");
  await download.saveAs(savePath);
  const saved = JSON.parse(fs.readFileSync(savePath, "utf8"));
  expect(saved).toBeTruthy();

  await openApp(page);
  expect(await page.evaluate(() => globalThis.__scenarioForgeTestApi.editedFeatureColors())).toEqual({});
  await page.locator("#projectFileInput").setInputFiles(savePath);
  await expect.poll(async () => (await readStatus(page)).scenarioId, { timeout: 120_000 }).toBe("hoi4_1936");
  await waitForSettled(page, { scenarioId: "hoi4_1936" });
  await expect.poll(() => page.evaluate(() => globalThis.__scenarioForgeTestApi.editedFeatureColors()), { timeout: 60_000 })
    .toEqual(edits);
  const point = await zoomTo(page, undefined, { scenarioId: "hoi4_1936" });
  expect(await colorShareAround(page, point, FILL)).toBeGreaterThan(FILLED);
  expect(errors).toEqual([]);
});

test("exported PNG contains the painted region", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const errors = collectPageErrors(page);
  await openApp(page);
  await switchScenario(page, "hoi4_1936");
  await paintProbe(page, "hoi4_1936");

  await page.locator("#workspaceExportBtn").click();
  await expect(page.locator("#exportWorkbenchOverlay")).toBeVisible();
  const downloadPromise = page.waitForEvent("download", { timeout: 120_000 });
  await page.locator("#exportWorkbenchSnapshotBtn").click();
  const download = await downloadPromise;
  expect(await download.failure()).toBeNull();
  const pngPath = testInfo.outputPath("golden-export.png");
  await download.saveAs(pngPath);
  const bytes = fs.readFileSync(pngPath);
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  const painted = await page.evaluate(async ({ encoded, rgb }) => {
    const blob = await (await fetch(`data:image/png;base64,${encoded}`)).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (Math.abs(pixels[i] - rgb[0]) <= 6 && Math.abs(pixels[i + 1] - rgb[1]) <= 6 && Math.abs(pixels[i + 2] - rgb[2]) <= 6) count += 1;
    }
    bitmap.close();
    return count;
  }, { encoded: bytes.toString("base64"), rgb: [0xe3, 0x1a, 0xc4] });
  expect(painted).toBeGreaterThan(100);
  expect(errors).toEqual([]);
});

test("a fill click stays within the interaction budget", async ({ page }) => {
  test.setTimeout(240_000);
  await openApp(page);
  await switchScenario(page, "tno_1962");
  const point = await zoomTo(page, undefined, { scenarioId: "tno_1962" });
  await selectFillTool(page, FILL);
  await page.evaluate(() => {
    globalThis.__goldenEventTimings = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (["pointerdown", "pointerup", "click", "mousedown", "mouseup"].includes(entry.name)) {
          globalThis.__goldenEventTimings.push(entry.duration);
        }
      }
    }).observe({ type: "event", durationThreshold: 16, buffered: false });
  });
  await fillAt(page, point, { scenarioId: "tno_1962" });
  await parkMouse(page);
  // Event timing entries are delivered after the next frame.
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 500)));
  const interactionMs = await page.evaluate(() => Math.max(0, ...globalThis.__goldenEventTimings));
  test.info().annotations.push({ type: "fillInteractionMs", description: String(interactionMs) });
  expect(interactionMs, "longest input event duration for a fill click").toBeLessThan(PERF_BUDGETS.fillInteractionMs);
});
