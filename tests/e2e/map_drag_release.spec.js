const { test, expect } = require("@playwright/test");
const { chooseStyledOption, waitForSettled } = require("./golden/golden-support");

async function renderState(page) {
  return page.evaluate(async () => {
    const api = globalThis.__scenarioForgeTestApi;
    const { state } = await api.internals();
    const cache = state.renderPassCache;
    const coverage = {};
    for (const pass of ["effects", "dayNight", "textureLabels"]) {
      const reference = cache.referenceTransforms[pass];
      const layout = cache.layouts[pass];
      const canvas = cache.canvases[pass];
      if (!reference || !layout || !canvas) continue;
      const scale = state.zoomTransform.k / reference.k;
      const left = -layout.offsetX * scale + state.zoomTransform.x - reference.x * scale;
      const top = -layout.offsetY * scale + state.zoomTransform.y - reference.y * scale;
      coverage[pass] = {
        left, top,
        right: left + canvas.width / layout.dpr * scale,
        bottom: top + canvas.height / layout.dpr * scale,
        width: layout.logicalWidth, height: layout.logicalHeight,
      };
    }
    return {
      settled: api.status().settled,
      interacting: state.isInteracting,
      phase: state.renderPhase,
      dirty: { ...state.renderPassCache.dirty },
      counters: { ...state.renderPassCache.counters },
      coverage,
      history: api.history(),
      tool: api.selection().currentTool,
      viewport: api.status().viewport,
    };
  });
}

for (const scenarioId of ["hoi4_1936", "tno_1962"]) {
  test(`${scenarioId}: map drag finishes over disabled dock controls and restores visible layers`, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const errors = [];
    const evidence = [];
    page.on("pageerror", error => errors.push(String(error)));
    await page.setViewportSize({ width: 1440, height: 900 });
    // Default renderer/startup configuration, including the scenario opening view.
    await page.goto(`/app/?default_scenario=${scenarioId}`, { waitUntil: "domcontentloaded" });
    await waitForSettled(page, { scenarioId });
    await expect(page.locator("#undoBtn")).toBeDisabled();
    const box = await page.locator("#undoBtn").boundingBox();
    const x = box.x + box.width / 2;
    let dragIndex = 0;

    async function dragTo(point, expectedTarget, passes = []) {
      const hit = await page.evaluate(({ x, y }) => {
        const element = document.elementFromPoint(x, y);
        return { tag: element.tagName, id: element.id, undo: !!element.closest("#undoBtn") };
      }, point);
      expectedTarget(hit);
      const before = await renderState(page);
      // Alternate horizontal direction so repeated drags stay near the opening view.
      await page.mouse.move(point.x + (dragIndex++ % 2 ? 35 : -35), 700);
      await page.mouse.down();
      await page.mouse.move(point.x, point.y, { steps: 10 });
      await expect.poll(async () => (await renderState(page)).interacting).toBe(true);
      await page.mouse.up();
      // No following move/click is allowed to recover a dropped end event.
      await expect.poll(async () => {
        const state = await renderState(page);
        return !state.interacting && state.phase === "idle";
      }, { timeout: 5000 }).toBe(true);
      await waitForSettled(page, { scenarioId, timeout: 30_000 });
      const after = await renderState(page);
      expect(after.history).toEqual(before.history);
      expect(after.tool).toBe(before.tool);
      expect(after.viewport.x).not.toBe(before.viewport.x);
      for (const [pass, counter] of passes) {
        expect(after.dirty[pass], `${pass} stayed dirty`).toBe(false);
        expect(after.counters[counter], `${pass} was never drawn`).toBeGreaterThan(0);
        // A padded pass may be reused. Its pixels must still cover the whole
        // settled viewport; requiring a fresh draw would reject valid caching.
        const coverage = after.coverage[pass];
        expect(coverage, `${pass} has no rendered surface`).toBeTruthy();
        expect(coverage.left).toBeLessThanOrEqual(0);
        expect(coverage.top).toBeLessThanOrEqual(0);
        expect(coverage.right).toBeGreaterThanOrEqual(coverage.width);
        expect(coverage.bottom).toBeGreaterThanOrEqual(coverage.height);
      }
      evidence.push({ point, hit, phase: after.phase, settled: after.settled, passes });
    }

    for (const y of [750, 790, 830, 850, 870]) {
      await dragTo({ x, y }, hit => {
        if (y === 830 || y === 850) expect(hit.undo).toBe(true);
        else expect(hit.tag.toLowerCase()).toBe(y === 870 ? "div" : "rect");
      });
    }
    const svgBox = await page.locator("#undoBtn svg").boundingBox();
    const svgPoint = { x: svgBox.x + svgBox.width / 2, y: svgBox.y + svgBox.height / 2 };
    const expectUndoIcon = hit => {
      expect(hit.undo).toBe(true);
      expect(["svg", "path"]).toContain(hit.tag.toLowerCase());
    };
    await dragTo(svgPoint, expectUndoIcon);
    await dragTo(svgPoint, expectUndoIcon);
    const redo = await page.locator("#redoBtn").boundingBox();
    await expect(page.locator("#redoBtn")).toBeDisabled();
    await dragTo({ x: redo.x + redo.width / 2, y: redo.y + 3 }, hit => expect(hit.id).toBe("redoBtn"));
    const fill = await page.locator("#toolFillBtn").boundingBox();
    await expect(page.locator("#toolFillBtn")).toBeEnabled();
    await dragTo({ x: fill.x + fill.width / 2, y: fill.y + 3 }, hit => expect(hit.id).toBe("toolFillBtn"));

    // Enable the affected passes through the UI. Disabled layers may legitimately
    // stay dirty, so only assert redraw/transform coverage for visible layers.
    await page.locator("#editorTaskLayersBtn").click();
    await page.locator("#mapContentTabDayNight").click();
    await page.locator("#dayNightEnabled").check();
    await page.locator("#mapContentTabTexture").click();
    await chooseStyledOption(page, page.locator("#textureSelectAppSelectButton"), "paper");
    await waitForSettled(page, { scenarioId });
    await dragTo(svgPoint, expectUndoIcon, [["effects", "effectsPassRenders"], ["dayNight", "dayNightPassRenders"]]);
    await chooseStyledOption(page, page.locator("#textureSelectAppSelectButton"), "graticule");
    await waitForSettled(page, { scenarioId });
    await dragTo(svgPoint, expectUndoIcon, [["textureLabels", "labelPassRenders"], ["dayNight", "dayNightPassRenders"]]);

    await page.mouse.move(700, 500);
    await page.mouse.wheel(0, -200);
    await waitForSettled(page, { scenarioId });
    expect((await renderState(page)).interacting).toBe(false);
    expect(errors).toEqual([]);
    await testInfo.attach("drag-release-evidence", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
  });
}
