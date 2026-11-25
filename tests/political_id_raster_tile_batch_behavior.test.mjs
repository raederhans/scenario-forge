import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createPoliticalIdRasterWorkerClient } from "../js/core/political_id_raster_worker_client.js";
import { buildPoliticalIdRasterTile } from "../js/core/renderer/political_id_raster_tile.js";
import { selectPoliticalIdTileBatch } from "../js/core/renderer/political_id_raster_tile_batch.js";
import { createPoliticalIdRasterWorkerRuntime } from "../js/workers/political_id_raster.worker.js";

const d3 = createRequire(import.meta.url)("../vendor/d3.v7.min.js");
const tick = () => new Promise(resolve => setImmediate(resolve));

function maskCanvas() {
  let code, offset;
  const context = {
    setTransform(_a, _b, _c, _d, dx) { offset = dx; },
    clearRect() {}, fill(value) { code = value; },
    getImageData(x, _y, width, height) {
      const data = new Uint8ClampedArray(width * height * 4);
      const alpha = [255, 96, 0, 172, 32];
      for (let i = 0; i < width * height; i++) data[i * 4 + 3] = alpha[(i + x - offset + code) % alpha.length];
      return { data };
    },
  };
  return { getContext: () => context };
}

async function buildTiles(workerCount) {
  const gates = new Map(), completed = [], tiles = new Map();
  let workers = 0;
  const client = createPoliticalIdRasterWorkerClient({ workerCount, isSupported: () => true, createWorker() {
    workers++;
    const runtime = createPoliticalIdRasterWorkerRuntime({
      projectionApi: d3,
      postMessage(data, transfer) { worker.onmessage({ data: structuredClone(data, { transfer }) }); },
      async buildTile(input) {
        await new Promise(resolve => gates.set(input.originX, resolve));
        return buildPoliticalIdRasterTile({ ...input, createCanvas: maskCanvas, createProjectedPath: entry => entry.code });
      },
    });
    const worker = { postMessage: (data, transfer) => runtime.handleMessage(structuredClone(data, { transfer })),
      terminate: () => runtime.dispose() };
    return worker;
  } });
  const packets = [0, 4, 8].map(originX => ({ originX, originY: 0, width: 4, height: 2, density: 1,
    strokeWidth: 0, geometryNamespace: "scene", projectionOptions: { factory: "geoEqualEarth" },
    entries: [1, 2].map(code => ({ code, id: String(code), geometryVersion: 1, bounds: { minX: 0, minY: 0, maxX: 12, maxY: 2 },
      feature: { type: "Point", coordinates: [code, 0] } })),
  }));
  try {
    while (tiles.size < packets.length) {
      const batch = selectPoliticalIdTileBatch(packets, client.workerCount, packet => !tiles.has(packet.originX));
      const results = batch.map(async packet => {
        const tile = await client.request(packet);
        tiles.set(tile.originX, tile);
        completed.push(tile.originX);
      });
      await tick();
      assert.equal(gates.size, batch.length);
      for (let i = batch.length - 1; i >= 0; i--) {
        const key = batch[i].originX;
        gates.get(key)();
        gates.delete(key);
        await results[i];
      }
    }
    assert.equal(workers, workerCount);
    return { tiles, completed };
  } finally { client.dispose(); }
}

test("out-of-order parallel tiles match single-worker ID and edge buffers byte for byte", async () => {
  const serial = await buildTiles(1), parallel = await buildTiles(3);
  assert.deepEqual(serial.completed, [0, 4, 8]);
  assert.deepEqual(parallel.completed, [8, 4, 0]);
  for (const [key, tile] of serial.tiles) {
    assert.ok(tile.edgeWeights.length > 0);
    for (const field of ["codes", "edgeIds", "edgeWeights"]) {
      assert.deepEqual(new Uint8Array(parallel.tiles.get(key)[field].buffer), new Uint8Array(tile[field].buffer));
    }
  }
});
