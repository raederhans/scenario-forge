import test from "node:test";
import assert from "node:assert/strict";
import { createBorderMeshWorkerRuntime } from "../js/core/renderer/border_mesh_worker_runtime.js";

function fixture() {
  const topology = () => ({ objects: { political: { type: "GeometryCollection", geometries: [{ type: "Polygon", properties: {} }] } } });
  const state = { activeScenarioId: "one", topologyPrimary: topology(), topologyDetail: topology(),
    cachedProvinceBordersByCountry: new Map(), cachedLocalBordersByCountry: new Map(), cachedProvinceBorders: [], cachedLocalBorders: [] };
  let detailState = { signature: "", status: "idle" };
  const build = async (request) => {
    const mesh = { coordinates: [[[request.source.sourceKey, 0]]] };
    return request.kind === "detail" ? { mesh } : {
      provinceMeshesByCountry: new Map([["AA", [mesh]]]), localMeshesByCountry: new Map([["AA", [mesh]]]),
    };
  };
  const owner = createBorderMeshWorkerRuntime({ state, getGeometrySourceSignature: () => "v1",
    getFeatureCountryCodeNormalized: () => "AA", shouldExcludePoliticalInteractionFeature: () => false,
    getAdmin1Group: () => "one", isAdmDetailTier: () => true,
    getStaticMeshSourceCountries: () => ({ primary: new Set(["AA"]), detail: new Set(["AA"]) }),
    getDetailAdmMeshBuildState: () => detailState, setDetailAdmMeshBuildState: (value) => { detailState = value; },
    client: { build, dispose() {} },
  });
  return { owner, state };
}
const args = { countries: ["AA", "ZZ"], includeProvince: true, includeLocal: true, detailCountries: ["AA"], detailSignature: "d1" };

test("runtime merges detail and primary borders and commits empty countries", async () => {
  const h = fixture(); const result = await h.owner.buildDeferredBorderMeshesAsync(args);
  assert.equal(h.owner.commitDeferredBorderMeshes(result), true);
  assert.deepEqual(h.state.cachedProvinceBordersByCountry.get("ZZ"), []);
  assert.equal(h.state.cachedProvinceBorders.length, 2);
  assert.deepEqual(h.state.cachedGridLines, h.state.cachedLocalBorders);
});

test("scene changes reject stale border meshes", async () => {
  const h = fixture(); const result = await h.owner.buildDeferredBorderMeshesAsync(args);
  h.state.sceneGeneration = 2;
  assert.equal(h.owner.commitDeferredBorderMeshes(result), false);
  assert.equal(h.state.cachedProvinceBordersByCountry.size, 0);
  assert.equal(h.state.cachedLocalBordersByCountry.size, 0);
  assert.equal(h.state.cachedProvinceBorders.length, 0);
  assert.equal(h.state.cachedLocalBorders.length, 0);
});
