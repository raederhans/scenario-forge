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

test("classic chunk worker and module raster worker preserve high resolution geometry across transfer", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { decodeRuntimeChunkViaWorker, terminateStartupWorker } = await import("/js/core/startup_worker_client.js");
    const { createGeometryRasterWorkerClient } = await import("/js/core/geometry_raster_worker_client.js");
    const url = "/data/scenarios/tno_1962/chunks/political.detail.country.ger.json";
    const source = await (await fetch(url)).json();
    const decoded = await decodeRuntimeChunkViaWorker({ chunkUrl: url, chunkType: "political" });
    const identical = JSON.stringify(decoded.chunkPayload) === JSON.stringify(source);
    const metrics = [];
    const client = createGeometryRasterWorkerClient({ onMetric: (...args) => metrics.push(args) });
    const entries = decoded.chunkPayload.features.map((feature, index) => ({ id: `feature-${index}`, feature, fillColor: "#ff0000" }));
    const input = { identity: "first", kind: "political", sceneKey: "transport-test", projectionKey: 1,
      width: 300, height: 200, dpr: 1, entries, projectionOptions: { scale: 80, translate: [150, 100] } };
    try {
      const first = await client.request(input);
      const second = await client.request({ ...input, identity: "second", kind: "hit" });
      const pixels = (bitmap) => {
        const canvas = document.createElement("canvas"); canvas.width = 300; canvas.height = 200;
        const ctx = canvas.getContext("2d"); ctx.drawImage(bitmap, 0, 0);
        return ctx.getImageData(0, 0, 300, 200).data;
      };
      const firstPixels = first && pixels(first.bitmap), secondPixels = second && pixels(second.bitmap);
      const rendered = firstPixels?.some((value, index) => index % 4 === 3 && value > 0);
      const equalFrames = firstPixels && secondPixels && firstPixels.every((value, index) => value === secondPixels[index]);
      let differingChannels = 0, maxDifference = 0;
      for (let i = 0; i < (firstPixels?.length || 0); i++) {
        const difference = Math.abs(firstPixels[i] - secondPixels[i]);
        if (difference) differingChannels++;
        maxDifference = Math.max(maxDifference, difference);
      }
      first?.bitmap.close(); second?.bitmap.close();
      return { identical, rendered, equalFrames, differingChannels, maxDifference, features: entries.length,
        sourceStillUsable: JSON.stringify(decoded.chunkPayload) === JSON.stringify(source),
        packingMs: decoded.metrics.geometryPackingMs, unpackingMs: decoded.metrics.geometryUnpackingMs,
        uploads: metrics.filter(([name]) => name === "geometryWorkerRoundTrip").map(([, , value]) => value.geometryUploads),
        fallbacks: metrics.filter(([name]) => name === "geometryWorkerFallback") };
    } finally { client.dispose(); terminateStartupWorker(); }
  });
  expect(result.identical).toBe(true);
  expect(result.sourceStillUsable).toBe(true);
  expect(result.rendered).toBe(true);
  expect(result.equalFrames, JSON.stringify(result)).toBe(true);
  expect(result.packingMs).toBeGreaterThanOrEqual(0);
  expect(result.unpackingMs).toBeGreaterThanOrEqual(0);
  expect(result.uploads).toEqual([result.features, 0]);
  expect(result.fallbacks).toEqual([]);
});
