import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createBorderMeshWorkerKernel } from "../js/core/renderer/border_mesh_worker_kernel.js";
import { createBorderMeshWorkerClient } from "../js/core/border_mesh_worker_client.js";
import { buildSourceBorderMeshes } from "../js/core/renderer/border_mesh_source_selection.js";
import { packTopologyForTransfer } from "../js/core/topology_transfer_codec.js";
import { packBorderMeshResult, unpackBorderMeshResult } from "../js/core/border_mesh_transfer_codec.js";

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
  const transferred = structuredClone(packed.result, { transfer: packed.transfer });
  const decoded = unpackBorderMeshResult(transferred);
  assert.equal(decoded.provinceMeshes[0], decoded.localMeshes[0]);
  assert.equal(decoded.localMeshes[0], decoded.provinceMeshesByCountry.get("AA")[0]);
  assert.deepEqual(decoded, before);
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

function createPreparingClient() {
  const preparations = [];
  const messages = [];
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
      terminate() {},
    }),
  });
  return { client, preparations, messages };
}

test("scene replacement discards pending border preparation", async () => {
  const fixture = createPreparingClient();
  const request = { sceneKey: "scene", source: source(), countries: ["AA"] };
  const stale = assert.rejects(fixture.client.build(request), { name: "AbortError" });
  await Promise.resolve();
  const current = fixture.client.build({ ...request, sceneKey: "next" });
  await Promise.resolve();
  assert.equal(fixture.preparations[0].signal.aborted, true);
  fixture.preparations[0].finish();
  await stale;
  assert.equal(fixture.messages.length, 0, "cancelled packing must never dispatch stale source data");
  fixture.preparations[1].finish();
  await current;
  fixture.client.dispose();
});
