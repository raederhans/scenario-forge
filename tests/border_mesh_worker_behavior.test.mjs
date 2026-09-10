import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createBorderMeshWorkerKernel } from "../js/core/renderer/border_mesh_worker_kernel.js";
import { createBorderMeshWorkerClient } from "../js/core/border_mesh_worker_client.js";
import { buildSourceBorderMeshes } from "../js/core/renderer/border_mesh_source_selection.js";
vm.runInThisContext(readFileSync(new URL("../vendor/topojson-client.min.js", import.meta.url), "utf8"));
const source = () => ({ sourceKey: "primary", sourceSignature: "v1", topology: {
  type: "Topology", arcs: [[[0,0],[1,0]], [[1,0],[1,1]], [[1,1],[0,0]]],
  objects: { political: { type: "GeometryCollection", geometries: [
    { type: "Polygon", arcs: [[0,1,2]], properties: {} },
  ] } },
}, geometryPolicy: [{ countryCode: "AA", admin1Group: "one", excluded: false, isAdmDetailTier: true }] });

test("kernel matches source builder and preserves empty countries", () => {
  const packet = source(); const kernel = createBorderMeshWorkerKernel(); kernel.registerSource(packet);
  const actual = kernel.build({ sourceKey: "primary", sourceSignature: "v1", countries: ["AA", "ZZ"] });
  const expected = buildSourceBorderMeshes({ topology: packet.topology, includedCountries: new Set(["AA"]),
    getFeatureCountryCodeNormalized: () => "AA", getAdmin1Group: () => "one", isUsableMesh: (mesh) => !!mesh?.coordinates?.length });
  assert.deepEqual(actual.localMeshes, expected.localMeshes);
  assert.deepEqual(actual.provinceMeshes, expected.provinceMeshes);
  assert.deepEqual(actual.localMeshesByCountry.get("ZZ"), []);
  assert.ok(kernel.build({ sourceKey: "primary", sourceSignature: "v1", countries: ["AA"], kind: "detail" }).mesh);
  kernel.registerSource({ ...packet, sourceSignature: "v2" });
  assert.throws(() => kernel.build({ sourceKey: "primary", sourceSignature: "v1" }), /Stale/);
  assert.throws(() => kernel.registerSource({ ...packet, geometryPolicy: [] }), /count mismatch/);
});

test("client registers once per source, resets scene, and honors default timeout", async (t) => {
  const messages = []; const timeouts = []; let terminated = 0;
  t.mock.method(globalThis, "setTimeout", (_callback, delay) => { timeouts.push(delay); return 1; });
  t.mock.method(globalThis, "clearTimeout", () => {});
  const client = createBorderMeshWorkerClient({ isSupported: () => true, createWorker: () => ({
    postMessage(message) { messages.push(message); queueMicrotask(() => this.onmessage({ data: { taskId: message.taskId, result: {} } })); },
    terminate() { terminated++; },
  }) });
  const request = { sceneKey: "scene1", source: source(), countries: ["AA"] };
  await client.build(request); await client.build(request);
  assert.equal(messages.filter((message) => message.type === "REGISTER_SOURCE").length, 1);
  assert.ok(timeouts.every((delay) => delay === 20000));
  await client.build({ ...request, sceneKey: "scene2" });
  assert.equal(terminated, 1); assert.equal(messages.filter((message) => message.type === "REGISTER_SOURCE").length, 2);
  client.dispose();
});

test("kernel preserves cross-country shared arcs and policy changes", () => {
  const packet = source();
  packet.topology.objects.political.geometries.push({ type: "Polygon", arcs: [[~1]], properties: {} });
  packet.geometryPolicy.push({ countryCode: "BB", admin1Group: "two", excluded: false });
  const kernel = createBorderMeshWorkerKernel();
  for (const [revision, neighbor] of [["foreign", "BB"], ["same", "AA"]]) {
    packet.sourceSignature = revision; packet.geometryPolicy[1].countryCode = neighbor;
    kernel.registerSource(packet);
    const geometries = packet.topology.objects.political.geometries;
    const expected = buildSourceBorderMeshes({ topology: packet.topology, includedCountries: new Set(["AA"]),
      getFeatureCountryCodeNormalized: (g) => packet.geometryPolicy[geometries.indexOf(g)].countryCode,
      getAdmin1Group: (g) => packet.geometryPolicy[geometries.indexOf(g)].admin1Group,
      isUsableMesh: (mesh) => !!mesh?.coordinates?.length });
    const actual = kernel.build({ sourceKey: "primary", sourceSignature: revision, countries: ["AA"] });
    assert.deepEqual(actual.provinceMeshes, expected.provinceMeshes);
    assert.deepEqual(actual.localMeshes, expected.localMeshes);
    assert.equal(actual.provinceMeshes.length, neighbor === "AA" ? 1 : 0);
  }
});

test("timeout recycles the worker and forces fresh registration", async (t) => {
  const timers = new Map(); let sequence = 0; let respond = false; let terminated = 0;
  t.mock.method(globalThis, "setTimeout", (callback) => { timers.set(++sequence, callback); return sequence; });
  t.mock.method(globalThis, "clearTimeout", (id) => timers.delete(id));
  const messages = [];
  const client = createBorderMeshWorkerClient({ isSupported: () => true, createWorker: () => ({
    postMessage(message) { messages.push(message); if (respond) queueMicrotask(() => this.onmessage({ data: { taskId: message.taskId, result: {} } })); },
    terminate() { terminated++; },
  }) });
  const request = { sceneKey: "one", source: source(), countries: ["AA"] };
  const rejected = assert.rejects(client.build(request), /timed out/);
  for (let i = 0; i < 5; i++) await Promise.resolve();
  [...timers.values()][0](); await rejected; assert.equal(terminated, 1);
  respond = true; await client.build(request);
  assert.equal(messages.filter((m) => m.type === "REGISTER_SOURCE").length, 2); client.dispose();
});

test("client abort discards late replies without recycling a reusable source", async () => {
  let worker; let held; let registrations = 0;
  const client = createBorderMeshWorkerClient({ isSupported: () => true, createWorker: () => (worker = {
    postMessage(message) {
      if (message.type === "REGISTER_SOURCE") { registrations++; queueMicrotask(() => this.onmessage({ data: { taskId: message.taskId, result: {} } })); }
      if (message.type === "BUILD") held = message;
    }, terminate() {},
  }) });
  const abort = new AbortController();
  const request = { sceneKey: "one", source: source(), countries: ["AA"] };
  const rejected = assert.rejects(client.build(request, { signal: abort.signal }), { name: "AbortError" });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  abort.abort(); await rejected;
  worker.onmessage({ data: { taskId: held.taskId, result: { stale: true } } });
  const next = client.build(request);
  for (let i = 0; i < 5; i++) await Promise.resolve();
  worker.onmessage({ data: { taskId: held.taskId, result: { fresh: true } } });
  assert.deepEqual(await next, { fresh: true }); assert.equal(registrations, 1); client.dispose();
});
