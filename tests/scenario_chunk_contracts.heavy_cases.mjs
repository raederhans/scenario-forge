import { createRequire } from "node:module";
import "../js/core/scenario_chunk_format_shared.js";
import {
  test,
  assert,
  readRepoFile,
  loadVendorD3,
  isWorldGeoBounds,
  getManifestChunksByLayer,
  readManifestChunkPayload,
} from "./helpers/scenario_chunk_contract_support.mjs";
import { readJsonSource } from "./helpers/read_json_source.mjs";

const topojson = createRequire(import.meta.url)("../vendor/topojson-client.min.js");
const { decodeScenarioChunkPayload } = globalThis.__scenarioForgeScenarioChunkFormatShared;

const defaultRegister = (_order, ...args) => test(...args);

export function registerScenarioChunkContractHeavyTests(register = defaultRegister) {
  register(26, "checked-in political coarse chunks match complete runtime political geometry", () => {
    for (const scenarioId of ["tno_1962", "hoi4_1939"]) {
      const chunkManifest = JSON.parse(readRepoFile("data", "scenarios", scenarioId, "detail_chunks.manifest.json"));
      const bootstrapTopology = JSON.parse(readRepoFile("data", "scenarios", scenarioId, "runtime_topology.bootstrap.topo.json"));
      const runtimeTopology = readJsonSource(new URL(`../data/scenarios/${scenarioId}/runtime_topology.topo.json`, import.meta.url));
      const bootstrapPoliticalCount = bootstrapTopology.objects?.political?.geometries?.length || 0;
      const runtimePoliticalCount = runtimeTopology.objects?.political?.geometries?.length || 0;
      const coarseChunk = chunkManifest.chunks.find((chunk) => chunk.id === "political.coarse.r0c0");
      const coarsePayload = decodeScenarioChunkPayload(readManifestChunkPayload(coarseChunk), topojson);

      assert.ok(bootstrapPoliticalCount > 0, `${scenarioId} bootstrap political geometry must exist`);
      assert.ok(runtimePoliticalCount > 0, `${scenarioId} runtime political geometry must exist`);
      assert.equal(coarseChunk.feature_count, runtimePoliticalCount, `${scenarioId} coarse chunk should match runtime political geometry`);
      assert.equal(coarseChunk.feature_bounds.length, coarseChunk.feature_count, `${scenarioId} coarse chunk should expose per-feature bounds`);
      assert.equal(coarsePayload.features.length, coarseChunk.feature_count, `${scenarioId} coarse payload should match manifest count`);

      const interactivePoliticalFeatures = coarsePayload.features.filter((feature) => {
        const props = feature?.properties || {};
        return props.interactive !== false && props.render_as_base_geography !== true;
      });
      assert.ok(interactivePoliticalFeatures.length > 0, `${scenarioId} coarse chunk should retain interactive political features`);
    }
  });

  register(30, "tno scenario_atlantropa chunks stay d3 small-polygon safe", () => {
    const d3 = loadVendorD3();
    const chunkManifest = JSON.parse(readRepoFile("data", "scenarios", "tno_1962", "detail_chunks.manifest.json"));
    const atlantropaChunks = getManifestChunksByLayer(chunkManifest, "scenario_atlantropa");
    assert.ok(atlantropaChunks.length > 0, "scenario_atlantropa chunks must exist");
    const badSamples = [];
    for (const chunk of atlantropaChunks) {
      const payload = readManifestChunkPayload(chunk);
      for (const feature of payload.features || []) {
        const featureId = String(feature?.properties?.id || feature?.id || "").trim();
        if (!featureId.startsWith("ATL")) continue;
        const bounds = d3.geoBounds(feature);
        const area = d3.geoArea(feature);
        if (isWorldGeoBounds(bounds) || area > 1) {
          badSamples.push({ chunkId: chunk.id, featureId, bounds, area });
        }
        if (badSamples.length >= 8) break;
      }
      if (badSamples.length >= 8) break;
    }
    assert.deepEqual(badSamples, []);
  });
}
