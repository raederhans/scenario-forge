import test from "node:test";
import assert from "node:assert/strict";

import { buildPoliticalIdRasterTile, referenceColorizePoliticalIdTile } from "../js/core/renderer/political_id_raster_tile.js";
import { createPoliticalIdRasterWorkerRuntime } from "../js/workers/political_id_raster.worker.js";
import { queryPoliticalIdRasterCandidates } from "../js/core/renderer/political_id_raster_pick.js";

const palette = Uint8Array.of(0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 255, 255);
const codeToId = new Map([[1, "left"], [2, "right"]]);

const entries = [1, 2].map(code => ({ code, id: codeToId.get(code), geometryVersion: 1,
  feature: { type: "Point", coordinates: [code, 0] },
  bounds: { minX: -20, minY: -20, maxX: 20, maxY: 20 } }));
const projectionOptions = { factory: "geoEqualEarth", scale: 1, translate: [0, 0] };
const projection = { scale() { return this; }, translate() { return this; } };

function rasterize(options) {
  let dx = 0, dy = 0, code = 0;
  const context = {
    setTransform(_a, _b, _c, _d, x, y) { dx = x; dy = y; }, clearRect() {},
    fill(path) { code = path; }, stroke() {},
    getImageData(x, y, width, height) {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
        const wx = x + col - dx, wy = y + row - dy;
        const alpha = wy === 2 ? 128 : 255;
        data[(row * width + col) * 4 + 3] = (code === 1 ? wx < 4 : wx >= 4) ? alpha : 0;
      }
      return { data };
    },
  };
  return buildPoliticalIdRasterTile({ ...options, projection, d3: { geoPath() {} },
    createProjectedPath: entry => entry.code,
    createCanvas: (width, height) => ({ width, height, getContext: () => context }),
    yieldTask: async () => {} });
}

async function buildPair() {
  const cores = [0, 4].map(originX => ({ originX, originY: 0, width: 4, height: 4, density: 1, level: 0 }));
  const legacy = await Promise.all(cores.map(core => rasterize({ ...core, entries, strokeWidth: 0 })));
  const halos = [];
  for (const core of cores) {
    const coreRect = { minX: core.originX, minY: 0, maxX: core.originX + 4, maxY: 4 };
    const storageRect = { minX: core.originX - 1, minY: -1, maxX: core.originX + 5, maxY: 5 };
    const packet = { ...core, originX: storageRect.minX, originY: -1, width: 6, height: 6,
      coreRect, storageRect, entries, strokeWidth: 0, projectionOptions };
    const tile = await new Promise((resolve, reject) => {
      const worker = createPoliticalIdRasterWorkerRuntime({
        projectionApi: { geoEqualEarth: () => projection }, buildTile: rasterize,
        postMessage(message) { worker.dispose(); message.type === "RESULT" ? resolve(message.tile) : reject(new Error(message.message)); },
      });
      worker.handleMessage({ taskId: "halo", type: "BUILD_POLITICAL_ID_TILE", packet });
    });
    halos.push(tile);
  }
  return { cores, legacy, halos };
}

test("worker storage includes real halo samples while core colors stay unchanged", async () => {
  const { legacy, halos } = await buildPair();
  for (let i = 0; i < halos.length; i++) {
    const halo = halos[i], pixels = referenceColorizePoliticalIdTile(halo, palette);
    const previous = referenceColorizePoliticalIdTile(legacy[i], palette);
    for (let y = 0; y < 4; y++) assert.deepEqual(pixels.slice(((y + 1) * 6 + 1) * 4, ((y + 1) * 6 + 5) * 4), previous.slice(y * 16, (y + 1) * 16));
    assert.equal(halo.width, 6); assert.equal(halo.height, 6);
  }
  assert.equal(halos[0].codes[1 * 6 + 5], 2, "right halo contains the next feature without a neighbor payload");
  assert.equal(halos[1].codes[1 * 6], 1);
});

test("core edge picks agree with the original tiles", async () => {
  const { cores, legacy, halos } = await buildPair();
  for (const x of [1.5, 2.5, 3.5, 4.5, 5.5, 6.5]) {
    const query = tiles => queryPoliticalIdRasterCandidates({ tiles, point: { x, y: 1.5 }, codeToId });
    assert.deepEqual(query(halos.map((tile, i) => ({ tile, descriptor: { ...cores[i], coreRect: tile.coreRect, storageRect: tile.storageRect } }))), query(legacy));
  }
});
