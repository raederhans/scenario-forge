import test from "node:test";
import assert from "node:assert/strict";
import { createBorderMeshWorkerRuntime } from "../js/core/renderer/border_mesh_worker_runtime.js";
import { getBorderWorkerIdentity, getDefaultBorderWorkerSources,
  hasCachedProvinceBorders, hasCachedLocalBorders } from "../js/core/renderer/border_mesh_queries.js";

test("worker readers retain live source references and optional Map lookup semantics", () => {
  const topology = Object.freeze({ objects: Object.freeze({}) });
  const state = { activeScenarioId: "one", scenarioApplyEpoch: 2, sceneGeneration: 3,
    scenarioDataGeneration: 4, topologyRevision: 5, sovereigntyRevision: 6,
    scenarioShellOverlayRevision: 7, mapSemanticMode: "visual", showScenarioAtlantropa: false,
    topology, topologyDetail: topology };
  assert.equal(getBorderWorkerIdentity(state), "one|2|3|4|5|6|7|visual|false");
  const first = getDefaultBorderWorkerSources(state);
  assert.equal(first[0].topology, topology);
  assert.equal(first[1].topology, topology);
  const replacement = Object.freeze({});
  state.topologyPrimary = replacement;
  const next = getDefaultBorderWorkerSources(state);
  assert.notEqual(next, first);
  assert.equal(next[1].topology, replacement);
  assert.equal(first[1].topology, topology);
  for (const [read, field] of [[hasCachedProvinceBorders, "cachedProvinceBordersByCountry"],
    [hasCachedLocalBorders, "cachedLocalBordersByCountry"]]) {
    assert.equal(read(state, "AA"), undefined);
    state[field] = new Map([["AA", []]]);
    state[field].set = state[field].delete = state[field].clear = () => { throw new Error("read must not mutate"); };
    assert.equal(read(state, "AA"), true);
    assert.equal(read(state, "BB"), false);
    assert.equal(state[field].size, 1);
  }
});

function fixture() {
  const topology = () => ({ objects: { political: { type: "GeometryCollection", geometries: [{ type: "Polygon", properties: {} }] } } });
  const state = { activeScenarioId: "one", topologyPrimary: topology(), topologyDetail: topology(),
    cachedProvinceBordersByCountry: new Map(), cachedLocalBordersByCountry: new Map(), cachedProvinceBorders: [], cachedLocalBorders: [] };
  let detailState = { signature: "", status: "idle" }; let policies = 0;
  const requests = []; let build = async (request) => {
    requests.push(request);
    const mesh = { coordinates: [[[request.source.sourceKey, 0]]] };
    return request.kind === "detail" ? { mesh } : {
      provinceMeshesByCountry: new Map([["AA", [mesh]]]), localMeshesByCountry: new Map([["AA", [mesh]]]),
    };
  };
  const owner = createBorderMeshWorkerRuntime({ state, getGeometrySourceSignature: () => "v1",
    getFeatureCountryCodeNormalized: () => { policies++; return "AA"; }, shouldExcludePoliticalInteractionFeature: () => false,
    getAdmin1Group: () => "one", isAdmDetailTier: () => true,
    getStaticMeshSourceCountries: () => ({ primary: new Set(["AA"]), detail: new Set(["AA"]) }),
    getDetailAdmMeshBuildState: () => detailState, setDetailAdmMeshBuildState: (value) => { detailState = value; },
    client: { build: (...args) => build(...args), dispose() {} },
  });
  return { owner, state, requests, policies: () => policies, detail: () => detailState, setBuild: (fn) => { build = fn; } };
}
const args = { countries: ["AA", "ZZ"], includeProvince: true, includeLocal: true, detailCountries: ["AA"], detailSignature: "d1" };

test("runtime merges detail then primary, commits empty countries and avoids duplicate appends", async () => {
  const h = fixture(); const result = await h.owner.buildDeferredBorderMeshesAsync(args);
  assert.deepEqual(h.requests.map((r) => [r.source.sourceKey, r.kind]), [["detail", "country"], ["primary", "country"], ["detail", "detail"]]);
  assert.equal(h.policies(), 2);
  assert.equal(h.owner.commitDeferredBorderMeshes(result), true);
  assert.equal(h.owner.commitDeferredBorderMeshes(result), false);
  assert.deepEqual(h.state.cachedProvinceBordersByCountry.get("ZZ"), []);
  assert.equal(h.state.cachedProvinceBorders.length, 2);
  assert.deepEqual(h.state.cachedGridLines, h.state.cachedLocalBorders);
  assert.deepEqual(h.detail(), { signature: "d1", status: "ready" });
  await h.owner.buildDeferredBorderMeshesAsync(args); assert.equal(h.policies(), 2);
});

test("source replacement and scene changes reject stale commits and refresh policy", async () => {
  const h = fixture(); const result = await h.owner.buildDeferredBorderMeshesAsync(args);
  h.state.topologyPrimary = structuredClone(h.state.topologyPrimary);
  assert.equal(h.owner.commitDeferredBorderMeshes(result), false);
  assert.equal(h.state.cachedProvinceBordersByCountry.size, 0);
  assert.equal(h.state.cachedLocalBordersByCountry.size, 0);
  assert.equal(h.state.cachedProvinceBorders.length, 0);
  assert.equal(h.state.cachedLocalBorders.length, 0);
  assert.equal(h.state.cachedGridLines, undefined);
  assert.equal(h.state.cachedDetailAdmBorders, undefined);
  assert.deepEqual(h.detail(), { signature: "", status: "idle" });
  const current = await h.owner.buildDeferredBorderMeshesAsync(args); assert.equal(h.policies(), 3);
  h.state.sceneGeneration = 2; assert.equal(h.owner.commitDeferredBorderMeshes(current), false);
  await h.owner.buildDeferredBorderMeshesAsync(args); assert.equal(h.policies(), 5);
});

test("unsupported worker falls back, and old scene cannot dispatch remaining sources", async () => {
  const h = fixture(); h.setBuild(async () => null);
  assert.equal(await h.owner.buildDeferredBorderMeshesAsync(args), null);
  let calls = 0;
  h.setBuild(async () => { calls++; h.state.sceneGeneration = 3; return {}; });
  await assert.rejects(h.owner.buildDeferredBorderMeshesAsync(args), { name: "AbortError" });
  assert.equal(calls, 1); assert.equal(h.state.cachedProvinceBorders.length, 0);
});
