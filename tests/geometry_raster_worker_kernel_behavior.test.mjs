import { RecordingPath as RecordedPath } from "./helpers/recording_path.mjs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createGeometryRasterWorkerKernel } from "../js/core/renderer/geometry_raster_worker_kernel.js";

const d3 = createRequire(import.meta.url)("../vendor/d3.v7.min.js");

test("hit and political mixed batches preserve D3 drawing commands", async () => {
  for (const kind of ["hit", "political"]) {
    const baseline = harness(), transported = harness();
    const input = packet({ kind });
    const encoded = globalThis.__scenarioForgeGeometryTransferCodecShared.pack(input.geometryUpdates, { minCoordinateCount: 0 });
    await baseline.kernel.render(input);
    await transported.kernel.render({ ...input, geometryUpdates: null, geometryTransport: {
      encoding: "geo-f64-batches-v1", batches: [structuredClone(encoded.payload, { transfer: encoded.transferables }),
        [{ id: "absent", feature: null }]],
    } });
    assert.deepEqual(transported.draws, baseline.draws);
  }
});

function harness() {
  const draws = [];
  const kernel = createGeometryRasterWorkerKernel({
    d3, createPath: () => new RecordedPath(), yieldTask: async () => {},
    createCanvas: () => ({
      getContext: () => ({
        setTransform() {}, translate() {}, scale() {},
        clearRect() {},
        fill(...args) { draws.push({ kind: "fill", args, color: this.fillStyle }); },
        stroke(...args) { draws.push({ kind: "stroke", args, color: this.strokeStyle, width: this.lineWidth }); },
      }),
      transferToImageBitmap: () => ({}),
    }),
  });
  return { kernel, draws };
}
const feature = { type: "Feature", geometry: { type: "GeometryCollection", geometries: [
  { type: "Polygon", coordinates: [[[170, 65], [-170, 65], [-175, 85], [170, 65]]] },
  { type: "Polygon", coordinates: [[[0, 0], [0, 40], [40, 40], [40, 0], [0, 0]], [[10, 10], [20, 10], [20, 20], [10, 10]]] },
  { type: "MultiPolygon", coordinates: [[[[50, 0], [50, 20], [60, 0], [50, 0]]]] },
  { type: "Point", coordinates: [12, 12] },
] } };
function packet(extra = {}) {
  return { sceneKey: "tno", projectionKey: 1, projectionOptions: {}, kind: "political",
    geometryUpdates: [{ id: "region", feature }], entries: [{ id: "region", fillColor: "#123456", strokeColor: "#654321", lineWidth: 0.3 }],
    width: 800, height: 600, dpr: 2, transform: { x: 3, y: 4, k: 2.5 }, offsetX: 20, offsetY: 10, ...extra };
}
test("real D3 stream preserves clipping, resampling, holes, multipolygons and point radius", async () => {
  const options = { factory: "geoEqualEarth", scale: 180, translate: [200, 150], center: [2, 3], rotate: [5, 6, 7], angle: 8,
    reflectX: true, reflectY: false, precision: 0.1, clipAngle: 170, clipExtent: [[0, 0], [800, 600]], pointRadius: 2 };
  const { kernel, draws } = harness();
  await kernel.render(packet({ projectionOptions: options }));
  const expected = new RecordedPath();
  const projection = d3.geoEqualEarth();
  for (const [key, value] of Object.entries(options)) if (key !== "factory" && key !== "pointRadius") projection[key](value);
  d3.geoPath(projection, expected).pointRadius(2)(feature);
  assert.deepEqual(draws[0].args[0].commands, expected.commands);
});
