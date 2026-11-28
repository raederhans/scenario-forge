import test from "node:test";
import assert from "node:assert/strict";
import { createWaterRasterWorkerKernel } from "../js/core/renderer/water_raster_worker_kernel.js";
import { packWaterGeometry } from "../js/core/renderer/water_geometry_transport.js";

function harness(options = {}) {
  const canvases = [], paths = [];
  const createPath = () => {
    const path = { commands: [], moveTo(...p) { this.commands.push(["move", ...p]); },
      lineTo(...p) { this.commands.push(["line", ...p]); }, closePath() { this.commands.push(["close"]); },
      arc(...p) { this.commands.push(["arc", ...p]); }, addPath(p) { this.commands.push(...p.commands); } };
    paths.push(path); return path;
  };
  const createCanvas = (width, height) => {
    const canvas = { width, height, transferToImageBitmap() { return { width, height, close() {} }; } };
    const context = { canvas, globalAlpha: 1, operations: [], setTransform() {}, clearRect() {},
      save() {}, restore() {}, setLineDash() {}, fill(path) { this.operations.push(["fill", path]); },
      stroke(path) { this.operations.push(["stroke", path]); },
      drawImage() { this.operations.push(["image", this.globalAlpha]); } };
    canvas.getContext = () => context; canvases.push(canvas); return canvas;
  };
  const kernel = createWaterRasterWorkerKernel({ d3: { geoEqualEarth: () => ({ stream: sink => sink }) },
    createCanvas, createPath, yieldTask: async () => {}, ...options });
  return { kernel, canvases, paths };
}
const polygon = { type: "Polygon", coordinates: [
  [[0, 0], [0, 10], [10, 0], [0, 0]], [[1, 1], [2, 1], [1, 2], [1, 1]],
] };
async function upload(kernel) {
  const packed = await packWaterGeometry([{ id: "water", feature: { type: "GeometryCollection", geometries: [polygon, polygon] } }]);
  kernel.sync({ geometryNamespace: "scene", updates: packed.payload, versions: [["water", 1]], requiredIds: ["water"] });
}
const packet = { geometryNamespace: "scene", identity: "candidate", revision: 1,
  projectionOptions: { factory: "geoEqualEarth" }, layout: { pixelWidth: 10, pixelHeight: 10, dpr: 2 },
  transform: { x: 1, y: 2, k: 3 }, entries: [{ id: "water", geometryVersion: 1, opacity: 0.4, fillColor: "#123456" }] };

test("marine polygon paths retain holes", async () => {
  const { kernel, paths } = harness();
  await upload(kernel);
  await kernel.render(packet);
  assert.equal(paths[0].commands.filter(item => item[0] === "close").length, 2);
  kernel.dispose();
});

test("marine parts apply feature alpha only at union composite", async () => {
  const { kernel, canvases } = harness();
  await upload(kernel);
  await kernel.render(packet);
  assert.deepEqual(canvases[0].getContext().operations, [["image", 0.4]]);
  assert.equal(canvases[1].getContext().operations.filter(item => item[0] === "fill").length, 2);
  kernel.dispose();
});

test("budget rejection produces no partial candidate surface", async () => {
  const { kernel, canvases } = harness();
  await upload(kernel);
  await assert.rejects(kernel.render({ ...packet, layout: { ...packet.layout, pixelWidth: 10000, pixelHeight: 10000 } }), /budget/);
  assert.equal(canvases.length, 0);
  kernel.dispose();
});
