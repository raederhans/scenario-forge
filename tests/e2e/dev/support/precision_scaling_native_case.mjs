// Shared native-browser case, usable from the repository Playwright runner or
// any browser harness. No application state, saved projects or sources mutate.
export async function runPrecisionScalingNativeCase() {
  await import("/vendor/d3.v7.min.js");
  const { createGeometryRasterWorkerKernel } = await import("/js/core/renderer/geometry_raster_worker_kernel.js");
  const { createGeometryRasterWorkerClient } = await import("/js/core/geometry_raster_worker_client.js");
  const codec = globalThis.__scenarioForgeGeometryTransferCodecShared;
  const feature = { type: "Feature", geometry: { type: "GeometryCollection", geometries: [
    { type: "Polygon", coordinates: [
      [[-20, -20], [-20, 20], [20, 20], [20, -20], [-20, -20]],
      [[-5, -5], [5, -5], [5, 5], [-5, 5], [-5, -5]],
    ] },
    { type: "Polygon", coordinates: [[[170, 65], [-175, 85], [-170, 65], [170, 65]]] },
    { type: "MultiPolygon", coordinates: [[[[40, 0], [40, 20], [60, 0], [40, 0]]]] },
  ] } };
  // Dense ring forces the real client's normal packed transport threshold.
  const ring = Array.from({ length: 10000 }, (_, i) => {
    const a = -2 * Math.PI * i / 9999;
    return [-50 + 5 * Math.cos(a), 5 * Math.sin(a)];
  });
  ring[ring.length - 1] = [...ring[0]];
  const dense = { type: "Feature", geometry: { type: "Polygon", coordinates: [ring] } };
  const updates = [{ id: "holes", feature }, { id: "dense", feature: dense }];
  const sourceBefore = JSON.stringify(updates);
  const width = 400, height = 260;
  const packet = { sceneKey: "precision-native", projectionKey: 1, kind: "political", width, height,
    projectionOptions: { scale: 110, translate: [200, 130] }, geometryUpdates: updates,
    entries: updates.map(({ id }) => ({ id, fillColor: "#cf3d28" })) };
  const pixels = (bitmap) => {
    const canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0); bitmap.close();
    return ctx.getImageData(0, 0, width, height).data;
  };
  const raw = createGeometryRasterWorkerKernel({ d3, pathCacheBudget: 1, geometryCacheBudget: 1 });
  const packed = createGeometryRasterWorkerKernel({ d3, pathCacheBudget: 1, geometryCacheBudget: 1 });
  const encoded = codec.pack(updates, { minCoordinateCount: 0 });
  const original = await raw.render(packet);
  const compact = await packed.render({ ...packet, geometryUpdates: [],
    geometryTransport: structuredClone(encoded.payload, { transfer: encoded.transferables }) });
  const a = pixels(original.bitmap), b = pixels(compact.bitmap);
  const difference = (left, right) => left.reduce((n, value, i) => n + Number(value !== right[i]), 0);
  const inside = d3.geoEqualEarth().scale(110).translate([200, 130])([12, 0]);
  const centerAlpha = b[(130 * width + 200) * 4 + 3];
  const insideAlpha = b[(Math.floor(inside[1]) * width + Math.floor(inside[0])) * 4 + 3];
  const retired = await packed.render({ ...packet, geometryUpdates: [], entries: [] });
  retired.bitmap.close();
  const metrics = [];
  const client = createGeometryRasterWorkerClient({ onMetric: (...args) => metrics.push(args) });
  let workerDifference, workerPixels, secondPixels;
  try {
    const input = { ...packet, geometryUpdates: undefined, identity: "first",
      entries: updates.map(({ id, feature }) => ({ id, feature, fillColor: "#cf3d28" })) };
    const first = await client.request(input);
    const second = await client.request({ ...input, kind: "hit", identity: "second" });
    if (!first || !second) throw new Error("Native worker unexpectedly unavailable.");
    workerPixels = pixels(first.bitmap); secondPixels = pixels(second.bitmap);
    workerDifference = difference(a, workerPixels);
  } finally { client.dispose(); }
  return { differingChannels: difference(a, b), workerDifference,
    hitDifference: difference(workerPixels, secondPixels), centerAlpha, insideAlpha,
    rendered: b.some((value, index) => index % 4 === 3 && value > 0),
    sourceUnchanged: JSON.stringify(updates) === sourceBefore,
    mode: compact.geometryTransportMode, evicted: retired.evictedGeometryIds,
    uploads: metrics.filter(([name]) => name === "geometryWorkerRoundTrip").map(([, , value]) => value.geometryUploads),
    fallbackCount: metrics.filter(([name]) => name === "geometryWorkerFallback").length };
}
