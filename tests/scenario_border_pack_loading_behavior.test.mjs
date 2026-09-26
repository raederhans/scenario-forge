import test from "node:test";
import assert from "node:assert/strict";
import { createScenarioChunkRegistryEnsurer } from "../js/core/scenario/bundle_loader.js";

const urls = {
  detail: "detail-chunks.json",
  context: "context-lod.json",
  meta: "runtime-meta.json",
  mesh: "mesh-pack.json",
};

function makeBundle(scenarioId = "tno_1962", resourceUrls = urls, version = 1) {
  return {
    manifest: { scenario_id: scenarioId, version },
    runtimeShell: {
      scenarioId,
      detailChunkManifestUrl: resourceUrls.detail,
      contextLodManifestUrl: resourceUrls.context,
      runtimeMetaUrl: resourceUrls.meta,
      meshPackUrl: resourceUrls.mesh,
    },
  };
}

function payloadFor(url) {
  if (url.startsWith("detail-")) return { version: 1, chunks: [{ id: "political-detail", url: "political-detail.json", layer: "political" }] };
  if (url.startsWith("context-")) return { version: 1, levels: [] };
  if (url.startsWith("runtime-")) return { featureIds: ["a"] };
  return { meshes: { opening_owner_borders: { coordinates: [[0, 0], [1, 1]] } } };
}

function responseFor(url, status = 200) {
  return new Response(JSON.stringify(payloadFor(url)), { status });
}

function makeEnsurer(patches = []) {
  let generation = 0;
  return createScenarioChunkRegistryEnsurer({
    patchRuntimeChunkLoadState(patch, options = {}) {
      patches.push({ patch, options });
      if (options.returnLoadStateGeneration) return ++generation;
      return undefined;
    },
  });
}

test("overlapping bundles share each detail resource load and mesh payload", async (t) => {
  const calls = [];
  const pending = [];
  t.mock.method(globalThis, "fetch", (url) => {
    const resourceUrl = String(url).split("?")[0];
    calls.push(resourceUrl);
    return new Promise((resolve) => pending.push(() => resolve(responseFor(resourceUrl))));
  });
  const patches = [];
  const ensure = makeEnsurer(patches);
  const worldBundle = makeBundle();
  const zoomBundle = makeBundle();
  const d3Client = {};
  const world = ensure(worldBundle, { d3Client });
  const zoom = ensure(zoomBundle, { d3Client });

  assert.deepEqual(calls.sort(), Object.values(urls).sort());
  pending.forEach((resolve) => resolve());
  await Promise.all([world, zoom]);

  assert.ok(worldBundle.chunkRegistry);
  assert.ok(zoomBundle.chunkRegistry);
  assert.strictEqual(worldBundle.meshPackPayload, zoomBundle.meshPackPayload);
  assert.strictEqual(worldBundle.runtimeMetaPayload, zoomBundle.runtimeMetaPayload);
  assert.equal(patches.filter(({ patch }) => patch.registryStatus === "loading").length, 2);
  const readyPatches = patches.filter(({ patch }) => patch.registryStatus === "ready");
  assert.equal(readyPatches.length, 2);
  assert.deepEqual(readyPatches.map(({ options }) => options.expectedLoadStateGeneration), [1, 2]);
});

test("a failed resource group is removed so a later call can retry", async (t) => {
  const calls = [];
  let failMesh = true;
  t.mock.method(globalThis, "fetch", async (url) => {
    const resourceUrl = String(url).split("?")[0];
    calls.push(resourceUrl);
    if (resourceUrl === urls.mesh && failMesh) return responseFor(resourceUrl, 500);
    return responseFor(resourceUrl);
  });
  const ensure = makeEnsurer();
  const first = makeBundle();
  const second = makeBundle();
  await assert.rejects(ensure(first, { d3Client: {} }), /Failed to fetch/);
  failMesh = false;
  await ensure(second, { d3Client: {} });
  assert.equal(calls.filter((url) => url === urls.mesh).length, 2);
  assert.ok(second.meshPackPayload);
});

test("scenario, URL, and manifest version keep concurrent loads separate", async (t) => {
  const calls = [];
  const pending = [];
  t.mock.method(globalThis, "fetch", (url) => {
    const resourceUrl = String(url).split("?")[0];
    calls.push(resourceUrl);
    return new Promise((resolve) => pending.push(() => resolve(responseFor(resourceUrl))));
  });
  const ensure = makeEnsurer();
  const loads = [
    ensure(makeBundle("first"), { d3Client: {} }),
    ensure(makeBundle("second"), { d3Client: {} }),
    ensure(makeBundle("first", { ...urls, mesh: "mesh-other.json" }), { d3Client: {} }),
    ensure(makeBundle("first", urls, 2), { d3Client: {} }),
  ];
  assert.equal(calls.length, 16);
  assert.equal(calls.filter((url) => url === urls.mesh).length, 3);
  assert.equal(calls.filter((url) => url === "mesh-other.json").length, 1);
  pending.forEach((resolve) => resolve());
  await Promise.all(loads);
});
