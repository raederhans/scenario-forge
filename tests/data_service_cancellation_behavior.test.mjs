import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const assetUrl = "data/transport_layers/japan_road/manifest.json";
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
let sequence = 0;
async function service(load) {
  const key = `__dataServiceCancellationFixture${sequence++}`;
  globalThis[key] = load;
  let source = fs.readFileSync(new URL("../js/core/data_service.js", import.meta.url), "utf8");
  const replace = (pattern, replacement) => {
    assert.equal([...source.matchAll(new RegExp(pattern.source, "g"))].length, 1);
    source = source.replace(pattern, replacement);
  };
  replace(/import catalogPayload from "\.\.\/\.\.\/data\/CATALOG\.json" with \{ type: "json" \};/,
    `const catalogPayload = ${JSON.stringify({ version: 1, entries: [{ url: assetUrl, readMode: "json", role: "transport", cachePolicy: "no-cache" }] })};`);
  replace(/import \{ loadMeasuredJsonResource \} from "\.\/data_loader\.js";/,
    `const loadMeasuredJsonResource = globalThis[${JSON.stringify(key)}];`);
  replace(/import \{\s*RUNTIME_ASSET_REGISTRY,\s*RUNTIME_ASSET_URLS,\s*\} from "\.\/runtime_asset_registry\.js";/,
    "const RUNTIME_ASSET_REGISTRY = {}; const RUNTIME_ASSET_URLS = {};");
  replace(/import \{\s*ensureMapcreatorSnapshotGlobal,\s*registerMapcreatorSnapshotProvider,\s*\} from "\.\/mapcreator_snapshot\.js";/,
    "const ensureMapcreatorSnapshotGlobal = () => {}; const registerMapcreatorSnapshotProvider = () => {};");
  try { return await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`); }
  finally { delete globalThis[key]; }
}
const snapshot = (api) => api.getStatusSnapshot().resources[`transport:${assetUrl}`];

test("the real asset wrapper forwards its caller AbortSignal to the measured fetch", async () => {
  const controller = new AbortController();
  let received;
  const api = await service(async (url, options) => {
    assert.equal(url, assetUrl); received = options.signal;
    return { payload: { version: 1 }, metrics: { totalMs: 2 } };
  });
  assert.deepEqual(await api.getTransportAsset(assetUrl, { signal: controller.signal }), { version: 1 });
  assert.equal(received, controller.signal);
  assert.equal(snapshot(api).status, "ready");
});

test("a pre-aborted receiver never enters the network loader", async () => {
  const controller = new AbortController(); controller.abort();
  let requests = 0;
  const api = await service(async () => { requests++; return { payload: {} }; });
  await assert.rejects(api.getTransportAsset(assetUrl, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(requests, 0);
  assert.equal(snapshot(api).status, "cancelled");
  assert.equal(snapshot(api).httpStatus, 0);
});

test("a loader ignoring cancellation cannot publish a ready result after abort", async () => {
  const held = deferred(), controller = new AbortController();
  const api = await service(() => held.promise);
  const promise = api.getTransportAsset(assetUrl, { signal: controller.signal });
  const rejected = assert.rejects(promise, { name: "AbortError" });
  controller.abort(); held.resolve({ payload: { stale: true }, metrics: { totalMs: 100 } });
  await rejected;
  assert.equal(snapshot(api).status, "cancelled");
  assert.equal(api.getMetricsSnapshot().resources[`transport:${assetUrl}`], undefined);
});

test("an old cancelled same-URL receiver cannot overwrite a newer ready request", async () => {
  const old = deferred(), current = deferred(), controller = new AbortController();
  let requests = 0;
  const api = await service(() => ++requests === 1 ? old.promise : current.promise);
  const stale = api.getTransportAsset(assetUrl, { signal: controller.signal });
  const rejected = assert.rejects(stale, { name: "AbortError" });
  const fresh = api.getTransportAsset(assetUrl);
  current.resolve({ payload: { version: 2 }, metrics: { totalMs: 7 } });
  assert.equal((await fresh).version, 2);
  controller.abort(); old.resolve({ payload: { version: 1 }, metrics: { totalMs: 900 } });
  await rejected;
  assert.equal(snapshot(api).status, "ready");
  assert.equal(snapshot(api).error, "");
  assert.equal(api.getMetricsSnapshot().resources[`transport:${assetUrl}`].totalMs, 7);
});

test("an old network error cannot replace the newer receiver's error or success identity", async () => {
  const old = deferred(), current = deferred(); let requests = 0;
  const api = await service(() => ++requests === 1 ? old.promise : current.promise);
  const first = api.getTransportAsset(assetUrl);
  const rejected = assert.rejects(first, /old failure/);
  const second = api.getTransportAsset(assetUrl);
  current.resolve({ payload: { current: true }, metrics: {} }); await second;
  old.reject(new Error("old failure")); await rejected;
  assert.equal(snapshot(api).status, "ready");
  assert.equal(snapshot(api).errorCode, "");
});
