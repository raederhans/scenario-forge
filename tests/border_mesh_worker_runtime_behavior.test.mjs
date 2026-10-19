import test from "node:test";
import assert from "node:assert/strict";
import { createBorderMeshWorkerRuntime } from "../js/core/renderer/border_mesh_worker_runtime.js";
import { packBorderMeshResult, unpackBorderMeshResult } from "../js/core/border_mesh_transfer_codec.js";
import { getBorderWorkerIdentity, getDefaultBorderWorkerSources,
  hasCachedProvinceBorders, hasCachedLocalBorders } from "../js/core/renderer/border_mesh_queries.js";

test("worker readers retain live source references and optional Map lookup semantics", () => {
  const topology = Object.freeze({ objects: Object.freeze({}) });
  const state = { activeScenarioId: "one", renderTransactionDiagnostics: { scenarioApplyEpoch: 2 }, sceneGeneration: 3,
    scenarioDataGeneration: 4, topologyRevision: 5, sovereigntyRevision: 6,
    scenarioShellOverlayRevision: 7, mapSemanticMode: "visual", showScenarioAtlantropa: false,
    topology, topologyDetail: topology };
  const identity = getBorderWorkerIdentity(state);
  assert.equal(identity, "one|2|3|4|5|6|7|visual|false");
  state.renderTransactionDiagnostics.scenarioApplyEpoch += 1;
  assert.notEqual(getBorderWorkerIdentity(state), identity);
  assert.equal(getBorderWorkerIdentity(state), "one|3|3|4|5|6|7|visual|false");
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

function fixture(overrides = {}) {
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
    ...overrides,
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

test("runtime commits packed borders and empty countries without reading lazy coordinates", async () => {
  const h = fixture();
  h.setBuild(async (request) => {
    const mesh = { type: "MultiLineString", coordinates: [[[1, 2], [3, 4]]] };
    const encoded = packBorderMeshResult(request.kind === "detail" ? { mesh } : {
      provinceMeshesByCountry: new Map([["AA", [mesh]], ["ZZ", []]]),
      localMeshesByCountry: new Map([["AA", [mesh]], ["ZZ", []]]),
    });
    const decoded = unpackBorderMeshResult(structuredClone(encoded.result, { transfer: encoded.transfer }));
    Object.defineProperty(request.kind === "detail" ? decoded.mesh : decoded.localMeshesByCountry.get("AA")[0],
      "coordinates", { get() { throw new Error("runtime must not expand packed coordinates"); } });
    return decoded;
  });
  const result = await h.owner.buildDeferredBorderMeshesAsync(args);
  assert.equal(h.owner.commitDeferredBorderMeshes(result), true);
  assert.deepEqual(h.state.cachedProvinceBordersByCountry.get("ZZ"), []);
  assert.deepEqual(h.state.cachedLocalBordersByCountry.get("ZZ"), []);
  assert.equal(h.state.cachedProvinceBorders.length, 2);
  assert.equal(h.state.cachedLocalBorders.length, 2);
  assert.equal(h.state.cachedDetailAdmBorders.length, 1);
  assert.equal(h.owner.commitDeferredBorderMeshes(result), false);
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

test("policy revision keeps worker scene while stale identity still rejects commit", async () => {
  const h = fixture();
  const previous = await h.owner.buildDeferredBorderMeshesAsync(args);
  const originalScene = h.requests[0].sceneKey;
  h.state.sovereigntyRevision = 2;
  assert.equal(h.owner.commitDeferredBorderMeshes(previous), false);
  await h.owner.buildDeferredBorderMeshesAsync(args);
  assert.equal(h.requests.at(-1).sceneKey, originalScene);
  assert.notEqual(h.requests.at(-1).source.sourceSignature, h.requests[0].source.sourceSignature);
  assert.equal(h.policies(), 4);
});

test("unsupported worker falls back, and old scene cannot dispatch remaining sources", async () => {
  const h = fixture(); h.setBuild(async () => null);
  assert.equal(await h.owner.buildDeferredBorderMeshesAsync(args), null);
  let calls = 0;
  h.setBuild(async () => { calls++; h.state.sceneGeneration = 3; return {}; });
  await assert.rejects(h.owner.buildDeferredBorderMeshesAsync(args), { name: "AbortError" });
  assert.equal(calls, 1); assert.equal(h.state.cachedProvinceBorders.length, 0);
});

const countryArgs = { countries: ["AA"], includeProvince: true };
function primaryGeometries(h, geometries) {
  h.state.topologyDetail = null;
  h.state.topologyPrimary.objects.political = { type: "GeometryCollection", geometries };
}

test("policy preparation slices traversal work and retains DFS policy semantics and complete-cache fast path", async () => {
  const visited = [];
  const slices = [];
  const h = fixture({
    nowMs: () => 0,
    yieldControl: async () => {
      slices.push(visited.length);
      assert.equal(h.requests.length, 0, "worker cannot receive a partial packet");
    },
    asFeatureLike: (geometry) => ({ geometry }),
    getFeatureCountryCodeNormalized: (feature) => { visited.push(feature.geometry.id); return feature.geometry.code; },
    canonicalCountryCode: (code) => code?.toUpperCase(),
    shouldExcludePoliticalInteractionFeature: (feature) => feature.geometry.excluded,
    getAdmin1Group: (geometry) => `group-${geometry.id}`,
    isAdmDetailTier: (geometry) => geometry.id % 2,
  });
  const leaves = Array.from({ length: 1100 }, (_, id) => ({ type: "Polygon", id, code: id % 2 ? "aa" : "", excluded: id % 3 === 0 }));
  primaryGeometries(h, [leaves[0], { type: "GeometryCollection", geometries: [null, ...leaves.slice(1, 600)] },
    { type: "GeometryCollection", geometries: [] }, ...leaves.slice(600)]);
  const result = await h.owner.buildDeferredBorderMeshesAsync(countryArgs);
  assert.deepEqual(visited, leaves.map((leaf) => leaf.id));
  assert.ok(slices.length >= 2);
  let prior = 0;
  for (const count of [...slices, visited.length]) {
    assert.ok(count - prior <= 512, "no slice can process more than 512 leaves");
    prior = count;
  }
  const packet = h.requests[0].source;
  assert.equal(packet.topology, h.state.topologyPrimary);
  assert.equal(packet.sourceSignature, `${result.identity}|v1`);
  assert.deepEqual(packet.geometryPolicy, leaves.map((leaf) => ({ countryCode: leaf.code.toUpperCase(),
    excluded: !!leaf.excluded, admin1Group: `group-${leaf.id}`, isAdmDetailTier: !!(leaf.id % 2) })));
  const sliceCount = slices.length;
  await h.owner.buildDeferredBorderMeshesAsync(countryArgs);
  assert.equal(slices.length, sliceCount, "complete cached packet does not yield or prepare again");
  assert.equal(visited.length, leaves.length);
  assert.equal(h.requests[1].source, packet);
});

test("clock budget yields after four milliseconds and collection-only work also yields", async () => {
  let clock = 0;
  let count = 0;
  const slices = [];
  const h = fixture({ nowMs: () => clock,
    yieldControl: async () => { slices.push(count); },
    getFeatureCountryCodeNormalized: () => { count++; clock++; return "AA"; },
  });
  primaryGeometries(h, Array.from({ length: 13 }, () => ({ type: "Polygon" })));
  await h.owner.buildDeferredBorderMeshesAsync(countryArgs);
  assert.deepEqual(slices, [4, 8, 12]);

  let yields = 0;
  const nested = fixture({ nowMs: () => 0, yieldControl: async () => { yields++; } });
  let geometry = { type: "Polygon" };
  for (let index = 0; index < 1200; index++) geometry = { type: "GeometryCollection", geometries: [geometry] };
  primaryGeometries(nested, [geometry]);
  await nested.owner.buildDeferredBorderMeshesAsync(countryArgs);
  assert.ok(yields >= 4, "collection traversal and exits are bounded even with one leaf");
  assert.equal(nested.policies(), 1);
});

test("default preparation yield allows another host task to cancel before dispatch", async () => {
  const h = fixture({ nowMs: () => 0 });
  primaryGeometries(h, Array.from({ length: 1500 }, () => ({ type: "Polygon" })));
  const controller = new AbortController();
  const cancellation = new Promise((resolve) => setTimeout(() => { controller.abort(); resolve(); }, 0));
  await assert.rejects(h.owner.buildDeferredBorderMeshesAsync({ ...countryArgs, signal: controller.signal }), { name: "AbortError" });
  await cancellation;
  assert.equal(h.requests.length, 0);
  assert.ok(h.policies() < 1500);
  const partial = h.policies();
  await h.owner.buildDeferredBorderMeshesAsync(countryArgs);
  assert.equal(h.policies(), partial + 1500, "cancelled private policies were not cached");
});

test("suspended policy preparations reject every scene/source change and disposal before dispatch", async (t) => {
  for (const [name, mutate] of [
    ["scene", (h) => { h.state.sceneGeneration = 1; }],
    ["policy identity", (h) => { h.state.sovereigntyRevision = 1; }],
    ["source reference", (h) => { h.state.topologyPrimary = structuredClone(h.state.topologyPrimary); }],
    ["source signature", (h) => { h.revision = "v2"; }],
    ["source list", (h) => { h.state.topologyDetail = structuredClone(h.state.topologyPrimary); }],
    ["abort", (h) => h.controller.abort()],
    ["dispose", (h) => h.owner.dispose()],
  ]) {
    await t.test(name, async () => {
      let resume;
      let disposed = 0;
      const h = fixture({ nowMs: () => 0, yieldControl: () => new Promise((resolve) => { resume = resolve; }),
        getGeometrySourceSignature: () => h.revision,
        client: { build() { throw new Error("stale packet dispatched"); }, dispose() { disposed++; } },
      });
      h.revision = "v1";
      h.controller = new AbortController();
      primaryGeometries(h, Array.from({ length: 700 }, () => ({ type: "Polygon" })));
      const pending = h.owner.buildDeferredBorderMeshesAsync({ ...countryArgs, signal: h.controller.signal });
      const rejected = assert.rejects(pending, { name: "AbortError" });
      assert.equal(typeof resume, "function");
      const count = h.policies();
      mutate(h);
      resume();
      await rejected;
      assert.equal(h.policies(), count, "no policy callbacks resume after invalidation");
      assert.equal(h.requests.length, 0);
      assert.equal(disposed, name === "dispose" ? 1 : 0);
    });
  }
});

test("last policy callback cancellation cannot publish a complete packet", async () => {
  const controller = new AbortController();
  let visits = 0;
  const h = fixture({ getFeatureCountryCodeNormalized: () => {
    visits++;
    if (visits === 1) controller.abort();
    return "AA";
  } });
  primaryGeometries(h, [{ type: "Polygon" }]);
  await assert.rejects(h.owner.buildDeferredBorderMeshesAsync({ ...countryArgs, signal: controller.signal }), { name: "AbortError" });
  assert.equal(h.requests.length, 0);
  await h.owner.buildDeferredBorderMeshesAsync(countryArgs);
  assert.equal(visits, 2);
});
