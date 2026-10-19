import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createBorderMeshWorkerKernel } from "../js/core/renderer/border_mesh_worker_kernel.js";
import { createBorderMeshWorkerClient, prepareBorderTopologyForTransfer } from "../js/core/border_mesh_worker_client.js";
import { buildSourceBorderMeshes } from "../js/core/renderer/border_mesh_source_selection.js";
import { packTopologyForTransfer, packTopologyForTransferAsync, unpackTopologyFromTransfer } from "../js/core/topology_transfer_codec.js";
import { packBorderMeshResult, unpackBorderMeshResult } from "../js/core/border_mesh_transfer_codec.js";
import { getPackedLineMesh, isUsableLineMesh } from "../js/core/renderer/packed_line_mesh.js";
import { getPackedPaintContourMesh } from "../js/core/renderer/paint_contour_mesh.js";
vm.runInThisContext(readFileSync(new URL("../vendor/topojson-client.min.js", import.meta.url), "utf8"));
const source = () => ({ sourceKey: "primary", sourceSignature: "v1", topology: {
  type: "Topology", arcs: [[[0,0],[1,0]], [[1,0],[1,1]], [[1,1],[0,0]]],
  objects: { political: { type: "GeometryCollection", geometries: [
    { type: "Polygon", arcs: [[0,1,2]], properties: {} },
  ] } },
}, geometryPolicy: [{ countryCode: "AA", admin1Group: "one", excluded: false, isAdmDetailTier: true }] });

test("binary border results preserve exact coordinates, shared meshes, country Maps and empty arcs", () => {
  const mesh = { type: "MultiLineString", name: "exact", coordinates: [[], [[-0, 1e120], [NaN, -Infinity]],
    [[], [3], [1, 2, 3, 4]]] };
  const empty = { type: "MultiLineString", coordinates: [] };
  const emptyArc = { type: "MultiLineString", coordinates: [[]] };
  const result = { provinceMeshes: [mesh, empty], localMeshes: [mesh, emptyArc],
    provinceMeshesByCountry: new Map([["AA", [mesh]], ["ZZ", []]]),
    localMeshesByCountry: new Map([["AA", [mesh, emptyArc]], ["ZZ", []]]) };
  const before = structuredClone(result);
  const packed = packBorderMeshResult(result);
  assert.ok(packed.result.coordinates instanceof Float64Array);
  assert.ok(packed.result.offsets instanceof Uint32Array);
  assert.equal(packed.result.properties.length, 3, "the repeated mesh has a single wire id");
  const transferred = structuredClone(packed.result, { transfer: packed.transfer });
  assert.ok(packed.transfer.every(buffer => buffer.byteLength === 0));
  const decoded = unpackBorderMeshResult(transferred);
  assert.equal(decoded.provinceMeshes[0], decoded.localMeshes[0]);
  assert.equal(decoded.localMeshes[0], decoded.provinceMeshesByCountry.get("AA")[0]);
  assert.equal(getPackedPaintContourMesh, getPackedLineMesh, "paint's old export uses the shared registry");
  assert.ok(getPackedLineMesh(decoded.localMeshes[0]).arcs instanceof Uint32Array);
  assert.equal(isUsableLineMesh(decoded.provinceMeshes[1]), false);
  assert.equal(isUsableLineMesh(decoded.localMeshes[1]), true, "one empty arc keeps coordinates.length semantics");
  assert.equal(typeof Object.getOwnPropertyDescriptor(decoded.localMeshes[0], "coordinates").get, "function");
  assert.deepEqual(decoded, before);
  assert.equal(decoded.localMeshes[0].coordinates, decoded.localMeshes[0].coordinates);
  assert.deepEqual(result, before, "packing never detaches or mutates the original GeoJSON arrays");
  for (const value of [null, { type: "MultiLineString", coordinates: [] }, emptyArc]) {
    const packet = packBorderMeshResult({ mesh: value });
    assert.deepEqual(unpackBorderMeshResult(structuredClone(packet.result, { transfer: packet.transfer })), { mesh: value });
  }
});

test("the production border worker transfers BUILD buffers and leaves registration replies ordinary", () => {
  const workerSource = readFileSync(new URL("../js/workers/border_mesh.worker.js", import.meta.url), "utf8")
    .replace(/^import[^\r\n]*\r?\n/gm, "");
  const mesh = { type: "MultiLineString", coordinates: [[[1.25, -0], [1e120, -1e-100]]] };
  const replies = [];
  const scope = { postMessage(message, transfer) {
    replies.push({ message: structuredClone(message, { transfer }), count: transfer.length });
    assert.ok(transfer.every(buffer => buffer.byteLength === 0));
  } };
  const kernel = { registerSource: () => ({ sourceKey: "one" }), build: () => ({ mesh }) };
  new Function("createBorderMeshWorkerKernel", "packBorderMeshResult", "self", "performance", workerSource)(
    () => kernel, packBorderMeshResult, scope, performance);
  scope.onmessage({ data: { type: "REGISTER_SOURCE", taskId: "register" } });
  scope.onmessage({ data: { type: "BUILD", taskId: "build" } });
  assert.equal(replies[0].count, 0);
  assert.deepEqual(replies[0].message.result, { sourceKey: "one" });
  assert.equal(replies[1].count, 3, "ordinary XY meshes only transfer their three numeric buffers");
  assert.deepEqual(unpackBorderMeshResult(replies[1].message.result), { mesh });
});

test("client unwraps binary replies without expanding coordinates and preserves mesh aliases", async () => {
  const mesh = { type: "MultiLineString", coordinates: [[[1.25, -0], [10, 15]]] };
  const client = createBorderMeshWorkerClient({ isSupported: () => true, createWorker: () => ({
    postMessage(message) {
      const packet = message.type === "BUILD" ? packBorderMeshResult({ localMeshes: [mesh],
        localMeshesByCountry: new Map([["AA", [mesh]], ["ZZ", []]]) }) : { result: {}, transfer: [] };
      const reply = structuredClone({ taskId: message.taskId, result: packet.result }, { transfer: packet.transfer });
      queueMicrotask(() => this.onmessage({ data: reply }));
    }, terminate() {},
  }) });
  const result = await client.build({ sceneKey: "one", source: source(), countries: ["AA", "ZZ"] });
  assert.equal(result.localMeshes[0], result.localMeshesByCountry.get("AA")[0]);
  const decoded = result.localMeshes[0];
  Object.defineProperty(decoded, "coordinates", { get() { throw new Error("eager GeoJSON expansion"); } });
  assert.equal(isUsableLineMesh(decoded), true);
  assert.deepEqual(Array.from(getPackedLineMesh(decoded).coordinates), [1.25, -0, 10, 15]);
  assert.deepEqual(result.localMeshesByCountry.get("ZZ"), []);
  client.dispose();
});

test("kernel matches source builder and preserves empty countries", () => {
  const packet = source(); const kernel = createBorderMeshWorkerKernel(); kernel.registerSource(packet);
  const actual = kernel.build({ sourceKey: "primary", sourceSignature: "v1", countries: ["AA", "ZZ"] });
  const expected = buildSourceBorderMeshes({ topology: packet.topology, includedCountries: new Set(["AA"]),
    getFeatureCountryCodeNormalized: () => "AA", getAdmin1Group: () => "one", isUsableMesh: (mesh) => !!mesh?.coordinates?.length });
  assert.deepEqual(actual.localMeshes, expected.localMeshes);
  assert.deepEqual(actual.provinceMeshes, expected.provinceMeshes);
  assert.deepEqual(actual.localMeshesByCountry.get("ZZ"), []);
  const packedResult = packBorderMeshResult(actual);
  const decoded = unpackBorderMeshResult(structuredClone(packedResult.result, { transfer: packedResult.transfer }));
  assert.deepEqual(decoded, actual, "worker transfer keeps the independently checked native mesh selection");
  assert.equal(decoded.localMeshes[0], decoded.localMeshesByCountry.get("AA")[0]);
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

test("arc transfer round trips empty, ragged, signed, and large exact coordinates", () => {
  const topology = { type: "Topology", transform: { scale: [0.1, 1], translate: [5, -5] },
    arcs: [[], [[], [-0, -22, 9007199254740991], [1.25, 1e120]], [[-1e-100, 3, NaN, Infinity]]],
    objects: { political: { type: "GeometryCollection", geometries: [] } } };
  const snapshot = structuredClone(topology);
  const packed = packTopologyForTransfer(topology);
  assert.equal("arcs" in packed.topology, false);
  const transferred = structuredClone({ topology: packed.topology, topologyArcs: packed.topologyArcs },
    { transfer: packed.transfer });
  assert.deepEqual(unpackTopologyFromTransfer(transferred.topology, transferred.topologyArcs), snapshot);
  assert.deepEqual(topology, snapshot);
  assert.ok(packed.transfer.every((buffer) => buffer.byteLength === 0));
});

test("client reuses topology across policy revisions and registers replacements", async () => {
  const messages = []; const diagnostics = []; let terminated = 0;
  const kernel = createBorderMeshWorkerKernel();
  const client = createBorderMeshWorkerClient({ isSupported: () => true,
    onDiagnostic: (entry) => diagnostics.push(entry), createWorker: () => ({
      postMessage(message, transfer = []) {
        const copy = structuredClone(message, { transfer });
        messages.push(copy);
        queueMicrotask(() => {
          try {
            const result = copy.type === "REGISTER_SOURCE" ? kernel.registerSource(copy)
              : copy.type === "UPDATE_POLICY" ? kernel.updatePolicy(copy) : kernel.build(copy);
            this.onmessage({ data: { taskId: copy.taskId, result } });
          } catch (error) { this.onmessage({ data: { type: "ERROR", taskId: copy.taskId, message: error.message } }); }
        });
      }, terminate() { terminated++; kernel.clear(); },
    }) });
  const original = source(); const originalArcs = structuredClone(original.topology.arcs);
  original.unrelatedSourceMetadata = "not part of REGISTER_SOURCE";
  const request = { sceneKey: "same-scene", source: original, countries: ["AA"] };
  await client.build(request);
  assert.deepEqual(original.topology.arcs, originalArcs);
  assert.equal(messages[0].topology.arcs, undefined);
  assert.equal("properties" in messages[0].topology.objects.political.geometries[0], false);
  assert.equal("unrelatedSourceMetadata" in messages[0], false);
  assert.ok(diagnostics.some((entry) => entry.type === "REGISTER_SOURCE" && entry.transferBytes > 0));
  const changed = { ...original, sourceSignature: "v2",
    geometryPolicy: [{ ...original.geometryPolicy[0], excluded: true }] };
  await client.build({ ...request, source: changed });
  assert.deepEqual(kernel.build({ sourceKey: "primary", sourceSignature: "v2", countries: ["AA"] }).localMeshes, []);
  assert.deepEqual(messages.map((message) => message.type),
    ["REGISTER_SOURCE", "BUILD", "UPDATE_POLICY", "BUILD"]);
  assert.equal(terminated, 0);
  await client.build({ ...request, source: { ...changed, sourceSignature: "v3",
    topology: structuredClone(original.topology) } });
  assert.equal(messages.filter((message) => message.type === "REGISTER_SOURCE").length, 2);
  client.dispose();
});

test("timeout recycles the worker and forces fresh registration", async (t) => {
  const timers = new Map(); let sequence = 0; let respond = false; let terminated = 0;
  let markTimerScheduled;
  const timerScheduled = new Promise((resolve) => { markTimerScheduled = resolve; });
  t.mock.method(globalThis, "setTimeout", (callback) => { timers.set(++sequence, callback); markTimerScheduled(); return sequence; });
  t.mock.method(globalThis, "clearTimeout", (id) => timers.delete(id));
  const messages = [];
  const client = createBorderMeshWorkerClient({ isSupported: () => true, createWorker: () => ({
    postMessage(message) { messages.push(message); if (respond) queueMicrotask(() => this.onmessage({ data: { taskId: message.taskId, result: {} } })); },
    terminate() { terminated++; },
  }) });
  const request = { sceneKey: "one", source: source(), countries: ["AA"] };
  const rejected = assert.rejects(client.build(request), /timed out/);
  await timerScheduled;
  [...timers.values()][0](); await rejected; assert.equal(terminated, 1);
  respond = true; await client.build(request);
  assert.equal(messages.filter((m) => m.type === "REGISTER_SOURCE").length, 2); client.dispose();
});

function semanticBorderSource(quantized = false) {
  const topology = {
    type: "Topology", bbox: [0, 0, 12, 12], metadata: { irrelevant: "topology metadata" },
    arcs: [
      [[0, 0], [1, 0]], [[1, 0], [1, 1]], [[1, 1], [0, 1]], [[0, 1], [0, 0]],
      [[1, 0], [2, 0]], [[2, 0], [2, 1]], [[2, 1], [1, 1]],
      [[2, 0], [3, 0]], [[3, 0], [3, 1]], [[3, 1], [2, 1]], [[10, 10], [11, 12]],
    ],
    objects: {
      unrelated: { type: "GeometryCollection", geometries: [{ type: "Polygon", arcs: [[10]], properties: { retained: false } }] },
      political: { type: "GeometryCollection", id: "root", properties: { ignored: true }, geometries: [
        { type: "Polygon", arcs: [[0, 1, 2, 3]], id: "left", properties: { countryCode: "WRONG", excluded: true } },
        { type: "GeometryCollection", id: "nested", bbox: [0, 0, 3, 1], geometries: [
          { type: "MultiPolygon", arcs: [[[4, 5, 6, ~1]]], properties: { countryCode: "WRONG", admin1Group: "WRONG" } },
          { type: "Polygon", arcs: [[7, 8, 9, ~5]], properties: { isAdmDetailTier: false } },
          { type: "Point", coordinates: [-0, 9007199254740991], properties: { ignored: true } },
          { type: "MultiPoint", coordinates: [[2.5, -1e-100], [1e120, -0]], id: "points" },
          { type: "LineString", arcs: [10], id: "line" },
          { type: "MultiLineString", arcs: [[10]], id: "lines" },
        ] },
      ] },
    },
  };
  if (quantized) {
    topology.transform = { scale: [0.125, 0.25], translate: [-20, 10], metadata: "unused" };
    topology.arcs = topology.arcs.map((arc) => arc.map(([x, y], index) => (
      [x - (index ? arc[index - 1][0] : 0), y - (index ? arc[index - 1][1] : 0)]
    )));
  }
  return {
    sourceKey: "semantic", sourceSignature: "initial", topology,
    geometryPolicy: [
      { countryCode: "AA", admin1Group: "one", excluded: false, isAdmDetailTier: true },
      { countryCode: "AA", admin1Group: "two", excluded: false, isAdmDetailTier: false },
      { countryCode: "BB", admin1Group: "three", excluded: false, isAdmDetailTier: true },
      ...Array.from({ length: 4 }, () => ({ countryCode: "CC", admin1Group: "other", excluded: false })),
    ],
  };
}

test("border-only political topology preserves real TopoJSON meshes and nested policy order", async () => {
  for (const quantized of [false, true]) {
    const packet = semanticBorderSource(quantized);
    if (quantized) {
      // Structured clone preserves geometry aliases; the last policy for an
      // aliased leaf must still win in the kernel's WeakMap after stripping.
      packet.topology.objects.political.geometries.push(packet.topology.objects.political.geometries[1].geometries[0]);
      packet.geometryPolicy.push({ countryCode: "DD", admin1Group: "aliased", excluded: true });
    }
    const snapshot = structuredClone(packet);
    const reference = createBorderMeshWorkerKernel();
    const stripped = createBorderMeshWorkerKernel();
    const packed = await prepareBorderTopologyForTransfer(packet.topology);
    const received = structuredClone({ topology: packed.topology, topologyArcs: packed.topologyArcs }, { transfer: packed.transfer });
    reference.registerSource(packet);
    stripped.registerSource({ ...packet, ...received });
    const variants = [packet.geometryPolicy,
      packet.geometryPolicy.map((entry, index) => ({ ...entry, ...(index === 1 ? { admin1Group: "one" } : {}) })),
      packet.geometryPolicy.map((entry, index) => ({ ...entry, ...(index === 1 ? { countryCode: "BB" } : {}) })),
      packet.geometryPolicy.map((entry, index) => ({ ...entry, ...(index === 0 ? { excluded: true } : {}) })),
    ];
    for (let revision = 0; revision < variants.length; revision++) {
      const sourceSignature = `revision-${revision}`;
      const policy = { sourceKey: packet.sourceKey, sourceSignature, geometryPolicy: variants[revision] };
      reference.updatePolicy(policy); stripped.updatePolicy(policy);
      for (const options of [{}, { includeProvince: false }, { includeLocal: false }, { kind: "detail" }]) {
        const request = { sourceKey: packet.sourceKey, sourceSignature, countries: ["AA", "BB", "CC", "ZZ"], ...options };
        assert.deepEqual(stripped.build(request), reference.build(request), `quantized=${quantized}, revision=${revision}, ${JSON.stringify(options)}`);
      }
    }
    assert.deepEqual(packet, snapshot, "preparation and mesh building do not mutate the original source");
  }
});

test("border preparation strips huge unrelated metadata without reading properties or other objects", async () => {
  const packet = semanticBorderSource(true);
  const huge = Array.from({ length: 10_000 }, (_, index) => ({ name: `unrelated-${index}`, description: "x".repeat(80) }));
  packet.topology.metadata = huge;
  packet.topology.objects.unrelated = { type: "GeometryCollection", geometries: huge };
  packet.topology.objects.political.properties = { huge };
  packet.topology.objects.political.geometries[0].properties = { huge };
  const originalBytes = JSON.stringify(packet.topology).length;
  Object.defineProperty(packet.topology.objects, "neverRead", { enumerable: true, get() { throw new Error("other object read"); } });
  Object.defineProperty(packet.topology.objects.political.geometries[1], "properties", {
    enumerable: true, get() { throw new Error("political properties read"); },
  });
  const packed = await prepareBorderTopologyForTransfer(packet.topology);
  assert.deepEqual(Object.keys(packed.topology).sort(), ["objects", "transform", "type"]);
  assert.deepEqual(Object.keys(packed.topology.objects), ["political"]);
  assert.deepEqual(packed.topology.transform, { scale: [0.125, 0.25], translate: [-20, 10] });
  const visit = (geometry) => {
    assert.ok(Object.keys(geometry).every((key) => ["type", "arcs", "coordinates", "geometries"].includes(key)));
    geometry.geometries?.forEach(visit);
  };
  visit(packed.topology.objects.political);
  assert.ok(JSON.stringify(packed.topology).length < originalBytes / 100);
  assert.equal(packet.topology.metadata, huge);
  const expected = packTopologyForTransfer({ ...packed.topology, arcs: packet.topology.arcs });
  packed.transfer.forEach((buffer, index) => assert.deepEqual(new Uint8Array(buffer), new Uint8Array(expected.transfer[index])));
});

test("border geometry shell preparation yields and cancels before reading later geometries", async () => {
  const controller = new AbortController();
  const political = { type: "GeometryCollection", geometries: Array.from({ length: 2000 }, () => ({ type: "Polygon", arcs: [[0]] })) };
  Object.defineProperty(political.geometries[1000], "type", { get() { throw new Error("cancelled preparation continued"); } });
  let yields = 0;
  await assert.rejects(prepareBorderTopologyForTransfer({ type: "Topology", objects: { political }, arcs: [] }, {
    signal: controller.signal, coordinateBatchSize: 64, nowMs: () => 0,
    yieldControl: () => { yields++; controller.abort(); },
  }), { name: "AbortError" });
  assert.equal(yields, 1);
});

test("client abort discards late replies without recycling a reusable source", async () => {
  let worker; let held; let registrations = 0;
  let markBuildStarted;
  const buildStarted = new Promise((resolve) => { markBuildStarted = resolve; });
  const client = createBorderMeshWorkerClient({ isSupported: () => true, createWorker: () => (worker = {
    postMessage(message) {
      if (message.type === "REGISTER_SOURCE") { registrations++; queueMicrotask(() => this.onmessage({ data: { taskId: message.taskId, result: {} } })); }
      if (message.type === "BUILD") { held = message; markBuildStarted(); }
    }, terminate() {},
  }) });
  const abort = new AbortController();
  const request = { sceneKey: "one", source: source(), countries: ["AA"] };
  const rejected = assert.rejects(client.build(request, { signal: abort.signal }), { name: "AbortError" });
  await buildStarted;
  abort.abort(); await rejected;
  worker.onmessage({ data: { taskId: held.taskId, result: { stale: true } } });
  const next = client.build(request);
  for (let i = 0; i < 5; i++) await Promise.resolve();
  worker.onmessage({ data: { taskId: held.taskId, result: { fresh: true } } });
  assert.deepEqual(await next, { fresh: true }); assert.equal(registrations, 1); client.dispose();
});

test("async arc packing preserves exact transfer bytes and yields within one large arc", async () => {
  const topology = source().topology;
  topology.arcs = [[[], [-0, -22, 9007199254740991, 1e120, -1e-100, NaN, Infinity],
    ...Array.from({ length: 50 }, (_, i) => [i / 3, -i])], []];
  const expected = packTopologyForTransfer(topology);
  let yields = 0;
  const actual = await packTopologyForTransferAsync(topology, {
    coordinateBatchSize: 16, nowMs: () => 0, yieldControl: () => { yields++; },
  });
  assert.ok(yields > 4, "coordinate bound yields inside both passes over the single large arc");
  assert.deepEqual(actual.topology, expected.topology);
  actual.transfer.forEach((buffer, i) => assert.deepEqual(new Uint8Array(buffer), new Uint8Array(expected.transfer[i])));
  assert.deepEqual(unpackTopologyFromTransfer(actual.topology, actual.topologyArcs), topology);

  let timeYields = 0;
  let clock = 0;
  await packTopologyForTransferAsync(topology, {
    coordinateBatchSize: 1e9, timeBudgetMs: 1, nowMs: () => ++clock,
    yieldControl: () => { timeYields++; },
  });
  // A wide point also crosses the time checkpoint without relying on arc boundaries.
  await packTopologyForTransferAsync({ arcs: [Array.from({ length: 300 }, () => [1, 2])] }, {
    coordinateBatchSize: 1e9, timeBudgetMs: 1, nowMs: () => ++clock,
    yieldControl: () => { timeYields++; },
  });
  assert.ok(timeYields > 0);
});

test("async arc packing can abort while counting or copying a wide point", async () => {
  for (const abortAt of [1, 2]) {
    const controller = new AbortController();
    let yields = 0;
    await assert.rejects(packTopologyForTransferAsync({ arcs: [[Array.from({ length: 100 }, (_, i) => i)]] }, {
      signal: controller.signal, coordinateBatchSize: 8, nowMs: () => 0,
      yieldControl: () => { if (++yields === abortAt) controller.abort(); },
    }), { name: "AbortError" });
    assert.equal(yields, abortAt);
  }
});

test("default async packing yields to another event-loop task before completion", async () => {
  let taskRan = false;
  const pulse = new Promise((resolve) => setTimeout(() => { taskRan = true; resolve(); }, 0));
  const topology = { arcs: [Array.from({ length: 20_000 }, (_, i) => [i, -i])] };
  const packed = await packTopologyForTransferAsync(topology);
  assert.equal(taskRan, true);
  assert.equal(packed.topologyArcs.values.length, 40_000);
  await pulse;
});

function createPreparingClient() {
  const preparations = [];
  const messages = [];
  let terminated = 0;
  const client = createBorderMeshWorkerClient({
    isSupported: () => true,
    prepareTopology(topology, { signal }) {
      return new Promise((resolve) => preparations.push({ signal, finish: () => resolve(packTopologyForTransfer(topology)) }));
    },
    createWorker: () => ({
      postMessage(message) {
        messages.push(message);
        queueMicrotask(() => this.onmessage({ data: { taskId: message.taskId, result: { signature: message.sourceSignature } } }));
      },
      terminate() { terminated++; },
    }),
  });
  return { client, preparations, messages, get terminated() { return terminated; } };
}

test("concurrent builds share pending registration while one waiter aborts independently", async () => {
  const fixture = createPreparingClient();
  const request = { sceneKey: "scene", source: source(), countries: ["AA"] };
  const controller = new AbortController();
  const cancelled = assert.rejects(fixture.client.build(request, { signal: controller.signal }), { name: "AbortError" });
  const remaining = fixture.client.build(request);
  await Promise.resolve();
  assert.equal(fixture.preparations.length, 1);
  controller.abort();
  await cancelled;
  assert.equal(fixture.preparations[0].signal.aborted, false);
  fixture.preparations[0].finish();
  assert.deepEqual(await remaining, { signature: "v1" });
  assert.deepEqual(fixture.messages.map((message) => message.type), ["REGISTER_SOURCE", "BUILD"]);
  assert.equal(fixture.terminated, 0);
  fixture.client.dispose();
});

test("concurrent non-aborted builds reuse one preparation and each dispatch BUILD", async () => {
  const fixture = createPreparingClient();
  const request = { sceneKey: "scene", source: source(), countries: ["AA"] };
  const first = fixture.client.build(request);
  const second = fixture.client.build(request);
  await Promise.resolve();
  assert.equal(fixture.preparations.length, 1);
  fixture.preparations[0].finish();
  assert.deepEqual(await Promise.all([first, second]), [{ signature: "v1" }, { signature: "v1" }]);
  assert.deepEqual(fixture.messages.map((message) => message.type), ["REGISTER_SOURCE", "BUILD", "BUILD"]);
  fixture.client.dispose();
});

test("scene, source replacement and disposal discard preparation before registration", async () => {
  for (const replacement of ["scene", "source", "dispose"]) {
    const fixture = createPreparingClient();
    const request = { sceneKey: "scene", source: source(), countries: ["AA"] };
    const stale = assert.rejects(fixture.client.build(request), { name: "AbortError" });
    await Promise.resolve();
    let current;
    if (replacement === "dispose") fixture.client.dispose();
    else current = fixture.client.build(replacement === "scene" ? { ...request, sceneKey: "next" }
      : { ...request, source: { ...source(), sourceSignature: "v2" } });
    await Promise.resolve();
    assert.equal(fixture.preparations[0].signal.aborted, true);
    fixture.preparations[0].finish();
    await stale;
    assert.equal(fixture.messages.length, 0, "cancelled packing must never dispatch stale source data");
    if (current) {
      fixture.preparations[1].finish();
      await current;
      assert.equal(fixture.messages.filter((message) => message.type === "REGISTER_SOURCE").length, 1);
    }
    fixture.client.dispose();
  }
});

test("policy changes during preparation retain shared topology and queue UPDATE_POLICY", async () => {
  const fixture = createPreparingClient();
  const initial = source();
  const stale = assert.rejects(fixture.client.build({ sceneKey: "scene", source: initial }), /Stale/);
  await Promise.resolve();
  const changed = fixture.client.build({ sceneKey: "scene", source: { ...initial, sourceSignature: "v2", geometryPolicy: [] } });
  assert.equal(fixture.preparations[0].signal.aborted, false);
  fixture.preparations[0].finish();
  await stale;
  await changed;
  assert.equal(fixture.preparations.length, 1);
  assert.deepEqual(fixture.messages.map((message) => message.type), ["REGISTER_SOURCE", "UPDATE_POLICY", "BUILD"]);
  assert.equal(fixture.messages.at(-1).sourceSignature, "v2");
  fixture.client.dispose();
});
