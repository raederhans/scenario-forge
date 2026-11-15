import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { buildPoliticalIdRasterTile, referenceColorizePoliticalIdTile } from "../js/core/renderer/political_id_raster_tile.js";
import { createPoliticalIdRasterWorkerRuntime } from "../js/workers/political_id_raster.worker.js";
import { queryPoliticalIdRasterCandidates } from "../js/core/renderer/political_id_raster_pick.js";
import { createPoliticalIdRasterOverview } from "../js/core/renderer/political_id_raster_overview.js";
import { createPoliticalIdRasterIdentityBuilder } from "../js/core/renderer/political_id_raster_identity.js";
import { createPoliticalIdRasterAssetStore, encodePoliticalIdRasterAsset } from "../js/core/renderer/political_id_raster_assets.js";

const palette = Uint8Array.of(0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 255, 255);
const codeToId = new Map([[1, "left"], [2, "right"]]);
const idToCode = new Map([["left", 1], ["right", 2]]);
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

test("worker storage includes real halo samples while core colors and pick results stay unchanged", async () => {
  const { cores, legacy, halos } = await buildPair();
  for (let i = 0; i < halos.length; i++) {
    const halo = halos[i], pixels = referenceColorizePoliticalIdTile(halo, palette);
    const previous = referenceColorizePoliticalIdTile(legacy[i], palette);
    for (let y = 0; y < 4; y++) assert.deepEqual(pixels.slice(((y + 1) * 6 + 1) * 4, ((y + 1) * 6 + 5) * 4), previous.slice(y * 16, (y + 1) * 16));
    assert.equal(halo.stats.retainedBytes, halo.codes.byteLength + halo.edgeIds.byteLength + halo.edgeWeights.byteLength);
    assert.equal(halo.width, 6); assert.equal(halo.height, 6);
  }
  assert.equal(halos[0].codes[1 * 6 + 5], 2, "right halo contains the next feature without a neighbor payload");
  assert.equal(halos[1].codes[1 * 6], 1);
  for (const x of [1.5, 2.5, 3.5, 4.5, 5.5, 6.5]) {
    const query = tiles => queryPoliticalIdRasterCandidates({ tiles, point: { x, y: 1.5 }, codeToId });
    assert.deepEqual(query(halos.map((tile, i) => ({ tile, descriptor: { ...cores[i], coreRect: tile.coreRect, storageRect: tile.storageRect } }))), query(legacy));
  }
});

test("overview samples core centers and preserves sparse coverage bytes", async () => {
  const { cores, legacy, halos } = await buildPair();
  const plan = { tiles: cores, density: 1, level: 0, scale: 1, originX: 0, originY: 0, width: 8, height: 4 };
  const before = createPoliticalIdRasterOverview({ tiles: legacy, plan });
  const after = createPoliticalIdRasterOverview({ tiles: halos, plan });
  assert.deepEqual(after, before);
  const budget = legacy.reduce((sum, tile) => sum + tile.codes.byteLength / 4 + tile.edgeIds.byteLength + tile.edgeWeights.byteLength, 0);
  assert.deepEqual(createPoliticalIdRasterOverview({ tiles: halos, plan, maxBytes: budget }), before);
  assert.equal(createPoliticalIdRasterOverview({ tiles: halos, plan, maxBytes: budget - 1 }), null);
});

test("halo identity rejects old persistent and prebuilt assets and admits rebuilt storage", async () => {
  const { cores, legacy, halos } = await buildPair();
  const builder = createPoliticalIdRasterIdentityBuilder({ crypto: webcrypto });
  const input = { sceneKey: "halo", entries, projectionOptions, strokeWidth: 0 };
  const oldIdentity = await builder.identify({ ...input, descriptor: cores[0] });
  const descriptor = { ...cores[0], ...halos[0] };
  const identity = await builder.identify({ ...input, descriptor });
  assert.notEqual(identity, oldIdentity);
  const { coreRect, storageRect, ...sameDimensions } = descriptor;
  assert.notEqual(identity, await builder.identify({ ...input, descriptor: sameDimensions }));
  const oldBuffer = encodePoliticalIdRasterAsset(legacy[0], { identity: oldIdentity, codeToId });
  let saved, fetches = 0;
  const store = createPoliticalIdRasterAssetStore({ indexedDB: null,
    backend: { read: async () => saved || oldBuffer, writeBounded: async entry => { saved = entry.payload; return true; }, prune: async () => {} },
    baseUrl: "https://example.test/", fetchImpl: async () => { fetches++; return new Response(oldBuffer); } });
  store.registerManifest({ schemaVersion: 1, tiles: [{ identity, url: "old.bin", byteLength: oldBuffer.byteLength }] });
  assert.equal(await store.load(identity, { idToCode }), null);
  assert.equal(fetches, 1);
  assert.equal(await store.save(identity, halos[0], { codeToId }), true);
  const restored = await store.load(identity, { idToCode });
  assert.deepEqual(restored.codes, halos[0].codes);
  assert.equal(restored.width, 6); assert.equal(restored.originX, -1);
  store.dispose();
});
