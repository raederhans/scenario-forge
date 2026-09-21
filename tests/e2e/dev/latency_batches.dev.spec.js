const { test, expect } = require("@playwright/test");

test("bulk pending edits use the real module worker and commit correct undo pixels", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    await import("/vendor/d3.v7.min.js");
    const { createGeometryRasterRuntimeOwner } = await import("/js/core/renderer/geometry_raster_runtime_owner.js");
    const { createPoliticalPatchPreviewBudget } = await import("/js/core/renderer/political_patch_preview_budget.js");
    const features = Array.from({ length: 30 }, (_, i) => {
      const x = (i % 6) * 6 - 18, y = Math.floor(i / 6) * 6 - 15;
      return { type: "Feature", id: String(i), geometry: { type: "Polygon", coordinates: [
        [[x, y], [x, y + 4], [x + 4, y + 4], [x + 4, y], [x, y]],
      ] } };
    });
    const budget = createPoliticalPatchPreviewBudget();
    budget.inspect(features.map(feature => ({ feature })));
    let color = "#ff0000", commits = 0;
    const metrics = [];
    const canvas = new OffscreenCanvas(320, 240), context = canvas.getContext("2d");
    const projection = d3.geoEqualEarth().scale(300).translate([160, 120]);
    const state = { firstVisibleFramePainted: true, activeScenarioId: "test", sceneGeneration: 1,
      scenarioDataGeneration: 1, topologyRevision: 1, dpr: 1, landData: { features },
      zoomTransform: { x: 0, y: 0, k: 1 }, renderPhase: "idle" };
    const owner = createGeometryRasterRuntimeOwner({ state,
      surface: { getProjection: () => projection, getContext: () => context },
      helpers: { isEnabled: () => true, hasPendingColorEdit: () => true, allowPendingColorEdit: () => budget.isDeferred(),
        needsPoliticalRender: () => true, getPoliticalLayout: () => ({ pixelWidth: 320, pixelHeight: 240 }),
        getPoliticalSignature: () => color, collectPoliticalItems: () => features.map(feature => ({ id: feature.id, feature })),
        orderPoliticalItems: items => items, excludeVisual: () => false, skipVisual: () => false,
        resolveFillColor: () => color, resolveStrokeColor: () => null, pointRadius: 2 },
      effects: { recordMetric: (...args) => metrics.push(args), requestRender: () => { commits++; } },
    });
    try {
      const first = owner.preparePolitical();
      const before = [...context.getImageData(0, 0, 320, 240).data].every(value => value === 0);
      await first;
      const drawn = owner.drawPolitical();
      const pixel = projection([-16, -13]);
      const read = () => [...context.getImageData(Math.floor(pixel[0]), Math.floor(pixel[1]), 1, 1).data];
      const red = read();
      color = "#0000ff"; await owner.preparePolitical(); owner.drawPolitical(); const blue = read();
      color = "#ff0000"; await owner.preparePolitical(); owner.drawPolitical(); const undo = read();
      return { deferred: budget.isDeferred(), before, red, blue, undo, count: drawn?.renderedCount,
        ids: drawn?.renderedIds.size, commits,
        uploads: metrics.filter(([name]) => name === "geometryWorkerRoundTrip").map(([, , data]) => data.geometryUploads),
        fallbacks: metrics.filter(([name]) => name === "geometryWorkerFallback").length };
    } finally { owner.dispose(); }
  });
  expect(result.deferred).toBe(true); expect(result.before).toBe(true);
  expect(result.count).toBe(30); expect(result.ids).toBe(30);
  expect(result.red).toEqual([255, 0, 0, 255]); expect(result.blue).toEqual([0, 0, 255, 255]);
  expect(result.undo).toEqual(result.red); expect(result.uploads).toEqual([30, 0, 0]);
  expect(result.fallbacks).toBe(0); expect(result.commits).toBe(3);
});

test("native task window merges layer presentation without synchronous flush", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { createContextLayerRenderScheduler } = await import("/js/core/renderer/context_layer_render_scheduler.js");
    const calls = [], metrics = [];
    let identity = ["tno", 1];
    const scheduler = createContextLayerRenderScheduler({ getIdentity: () => identity,
      requestRender: (...args) => calls.push(args), recordMetric: (...args) => metrics.push(args) });
    scheduler.request(["urban"], "preset"); scheduler.request(["rivers"], "preset"); scheduler.request(["physical"], "preset");
    const immediate = calls.length;
    await new Promise(resolve => setTimeout(resolve, 60));
    scheduler.request(["urban"], "outgoing"); identity = ["hoi4", 2];
    await new Promise(resolve => setTimeout(resolve, 60)); scheduler.reset();
    return { immediate, calls, requests: metrics[0]?.[2]?.requestCount };
  });
  expect(result.immediate).toBe(0); expect(result.calls).toHaveLength(1);
  expect(result.calls[0][1].flush).toBe(false); expect(result.requests).toBe(3);
});
