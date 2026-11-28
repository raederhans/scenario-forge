import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createPoliticalIdRasterWorkerClient } from "../js/core/political_id_raster_worker_client.js";
import { createPoliticalIdRasterWorkerRuntime } from "../js/workers/political_id_raster.worker.js";
import { isPackedRasterGeometry } from "../js/core/renderer/packed_geometry.js";
const d3 = createRequire(import.meta.url)("../vendor/d3.v7.min.js");

const entry = (id = "a", geometryVersion = 1) => ({ id, geometryVersion, code: 1,
  feature: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
  bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 } });
const packet = (entries = [entry()], geometryNamespace = "scene") => ({ entries, geometryNamespace,
  density: 1, width: 1, height: 1, projectionOptions: { factory: "geoEqualEarth", scale: 1, translate: [0, 0] } });

function harness(options = {}) {
  const inputs = [];
  const client = createPoliticalIdRasterWorkerClient({ isSupported: () => true, createWorker: () => {
    const worker = {
      postMessage(message, transfer = []) {
        const data = structuredClone(message, { transfer });
        runtime.handleMessage(data);
      },
      terminate() { runtime.dispose(); },
    };
    const runtime = createPoliticalIdRasterWorkerRuntime({
      projectionApi: d3,
      postMessage: (data, transfer = []) => {
        const cloned = structuredClone(data, { transfer });
        worker.onmessage?.({ data: cloned });
      },
      buildTile: async input => {
        inputs.push(input);
        for (const item of input.entries) assert.equal(isPackedRasterGeometry(item.feature), true);
        await options.onBuild?.(input);
        return { codes: new Uint32Array([1]), edgeIds: new Uint32Array(), edgeWeights: new Float32Array() };
      },
    });
    return worker;
  } });
  return { client, inputs };
}

test("a replacement uses the new geometry version", async () => {
  const h = harness();
  try {
    await h.client.request(packet());
    await h.client.request(packet([entry("a", 2)]));
    assert.equal(h.inputs.at(-1).entries[0].geometryVersion, 2);
  } finally { h.client.dispose(); }
});

test("packed projected path streams equal D3 path commands without nested-array decoding", async () => {
  const oldPath = globalThis.Path2D;
  class Path {
    commands = [];
    moveTo(...args) { this.commands.push(["M", ...args]); }
    lineTo(...args) { this.commands.push(["L", ...args]); }
    closePath() { this.commands.push(["Z"]); }
    arc(...args) { this.commands.push(["A", ...args]); }
  }
  globalThis.Path2D = Path;
  const h = harness({ onBuild: input => {
    const actual = input.createProjectedPath(input.entries[0]);
    const expected = new Path();
    d3.geoPath(input.projection).context(expected)(entry().feature);
    assert.deepEqual(actual.commands, expected.commands);
  } });
  try { await h.client.request(packet()); }
  finally { h.client.dispose(); globalThis.Path2D = oldPath; }
});
