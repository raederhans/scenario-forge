import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createGeometryRasterWorkerKernel } from "../js/core/renderer/geometry_raster_worker_kernel.js";
import "../js/core/geometry_transfer_codec_shared.js";

const d3 = createRequire(import.meta.url)("../vendor/d3.v7.min.js");
const point = (x) => ({ type: "Feature", geometry: { type: "Point", coordinates: [x, 0] } });

test("navigation decodes mixed batches, builds SVG Path2D, and fills in entry order with alpha and scaleY", async () => {
  const fills = [], transforms = [], paths = [], contextOptions = [];
  const context = {
    setTransform(...args) { transforms.push(args); }, translate() {}, scale(...args) { transforms.push(args); },
    clearRect() {}, setLineDash() {},
    fill(path) { fills.push({ path, color: this.fillStyle, alpha: this.globalAlpha }); },
  };
  const kernel = createGeometryRasterWorkerKernel({ d3,
    createCanvas: () => ({ getContext: (_kind, options) => { contextOptions.push(options); return context; },
      transferToImageBitmap: () => ({ close() {} }) }),
    createPath: (svg) => { paths.push(svg); return { svg }; }, yieldTask: async () => {},
  });
  const first = [{ id: "a", feature: point(0) }];
  const second = [{ id: "b", feature: point(5) }];
  const packed = globalThis.__scenarioForgeGeometryTransferCodecShared.pack(first, { minCoordinateCount: 0 });
  const result = await kernel.render({ sceneKey: "nav", projectionKey: 1, kind: "navigation",
    projectionOptions: {}, width: 20, height: 10, transform: { x: 0, y: 0, k: 2, scaleY: 3 },
    entries: [{ id: "a", fillColor: "red", alpha: 0.4 }, { id: "b", fillColor: "blue" }],
    geometryTransport: { encoding: "geo-f64-batches-v1", batches: [packed.payload, second] },
  });
  assert.equal(result.renderedCount, 2);
  assert.deepEqual(contextOptions, [{ willReadFrequently: true }]);
  assert.equal(typeof result.navigationTimings.geometryUpdateMs, "number");
  assert.equal(typeof result.navigationTimings.pathBuildMs, "number");
  assert.equal(typeof result.navigationTimings.fillMs, "number");
  assert.equal(typeof result.navigationTimings.yieldWallMs, "number");
  assert.equal(typeof result.navigationTimings.bitmapMs, "number");
  assert.equal(typeof result.navigationTimings.trimMs, "number");
  assert.ok(["a", "b"].includes(result.navigationTimings.maxPathId));
  assert.ok(["a", "b"].includes(result.navigationTimings.maxFillId));
  assert.deepEqual(fills.map(({ color, alpha }) => [color, alpha]), [["red", 0.4], ["blue", 1]]);
  assert.ok(paths.every((svg) => typeof svg === "string" && svg.length > 0));
  assert.ok(transforms.some((args) => args.length === 2 && args[0] === 2 && args[1] === 3));
  await assert.rejects(kernel.render({ sceneKey: "nav", projectionKey: 1, kind: "political",
    width: 20, height: 10, geometryTransport: { encoding: "geo-f64-batches-v1", batches: [] } }),
  /Invalid navigation geometry transport/);
});
