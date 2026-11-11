const { test, expect } = require("@playwright/test");

test("native raster cache pressure preserves holes and re-upload after eviction", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    await import("/vendor/d3.v7.min.js");
    const { createGeometryRasterWorkerKernel } = await import("/js/core/renderer/geometry_raster_worker_kernel.js");
    const kernel = createGeometryRasterWorkerKernel({ d3: globalThis.d3, pathCacheBudget: 1, geometryCacheBudget: 1 });
    const feature = { type: "Feature", geometry: { type: "Polygon", coordinates: [
      [[-20, -20], [-20, 20], [20, 20], [20, -20], [-20, -20]],
      [[-5, -5], [5, -5], [5, 5], [-5, 5], [-5, -5]],
    ] } };
    const packet = { sceneKey: "budget", projectionKey: 1, kind: "political", width: 200, height: 160,
      projectionOptions: { scale: 100, translate: [100, 80] },
      entries: [{ id: "with-hole", fillColor: "#ff0000" }], geometryUpdates: [{ id: "with-hole", feature }] };
    const first = await kernel.render(packet);
    const canvas = new OffscreenCanvas(200, 160), context = canvas.getContext("2d");
    context.drawImage(first.bitmap, 0, 0); first.bitmap.close();
    const centerAlpha = context.getImageData(100, 80, 1, 1).data[3];
    const inside = d3.geoEqualEarth().scale(100).translate([100, 80])([12, 0]);
    const insideAlpha = context.getImageData(Math.floor(inside[0]), Math.floor(inside[1]), 1, 1).data[3];
    const released = await kernel.render({ ...packet, entries: [], geometryUpdates: [] }); released.bitmap.close();
    const restored = await kernel.render(packet); restored.bitmap.close();
    return { centerAlpha, insideAlpha, first: first.cacheBudget, evicted: released.evictedGeometryIds,
      released: released.cacheBudget, restored: restored.pathBuildCount };
  });
  expect(result.centerAlpha).toBe(0);
  expect(result.insideAlpha).toBe(255);
  expect(result.first.paths.estimatedBytes).toBe(0);
  expect(result.first.geometry.overBudgetBytes).toBeGreaterThan(0);
  expect(result.evicted).toEqual(["with-hole"]);
  expect(result.released.geometry.estimatedBytes).toBe(0);
  expect(result.restored).toBe(1);
});

