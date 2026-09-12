import test from "node:test";
import assert from "node:assert/strict";
import {
  createStaticBorderMeshLifecycle,
  getCoastlineDecisionSignature,
  getSourceCountriesSignature,
} from "../js/core/renderer/static_border_mesh_lifecycle.js";

function harness(ports = {}) {
  const events = [];
  const pending = new Map();
  let nextId = 0;
  let settled = true;
  let admitted = true;
  let detailState = { signature: "", status: "idle" };
  let sourceCountries = { primary: new Set(), detail: new Set(["AA"]) };
  let viewport = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
  let mesh = { coordinates: [[1, 2]] };
  let shouldThrow = false;
  let clock = 10;
  let countryCost = 0;
  const state = {
    topologyRevision: 1, topologyDetail: { id: "detail-1" }, zoomTransform: { k: 5 },
    spatialItems: [{ countryCode: "aa", minX: 1, minY: 1, maxX: 2, maxY: 2 }],
    cachedProvinceBorders: [], cachedProvinceBordersByCountry: new Map(),
    cachedLocalBorders: [], cachedLocalBordersByCountry: new Map(), cachedDetailAdmBorders: [],
  };
  const owner = createStaticBorderMeshLifecycle(state, {
    getStaticMeshSourceCountries: () => sourceCountries,
    getDetailAdmMeshBuildState: () => detailState,
    setDetailAdmMeshBuildState: (next) => { detailState = next; },
    getContextBaseZoomBucketId: (k) => Math.floor(k),
    getProjectedViewportBounds: () => viewport,
    VIEWPORT_CULL_OVERSCAN_PX: 20,
    canonicalCountryCode: (code) => code.toUpperCase(),
    cancelDeferredWork: (handle) => { events.push(["cancel", handle]); pending.delete(handle); },
    scheduleDeferredWork: (callback, options) => { const id = ++nextId; pending.set(id, callback); events.push(["schedule", options.timeout]); return id; },
    isInteractionRecoverySettled: (options) => { events.push(["settled", options.quietMs]); return settled; },
    beginInteractionRecoveryTask: (key) => { events.push(["begin", key]); return admitted; },
    endInteractionRecoveryTask: (key) => events.push(["end", key]),
    nowMs: () => clock,
    PROVINCE_BORDERS_TRANSITION_END_ZOOM: 2,
    LOCAL_BORDERS_MIN_ZOOM: 3,
    DETAIL_ADM_BORDERS_MIN_ZOOM: 4,
    ensureCountrySourceBorderMeshes: (code, options) => {
      if (shouldThrow) throw new Error("build failure");
      clock += countryCost;
      events.push(["country", code, options]);
      if (options.includeProvince) state.cachedProvinceBordersByCountry.set(code, []);
      if (options.includeLocal) state.cachedLocalBordersByCountry.set(code, []);
    },
    buildDetailAdmBorderMesh: (topology, countries) => { events.push(["detail", topology, [...countries]]); return mesh; },
    isUsableMesh: (value) => !!value,
    replaceDetailAdmBorders: (meshes) => { state.cachedDetailAdmBorders = meshes; events.push(["replace", meshes]); },
    syncStaticMeshSnapshot: () => events.push(["snapshot"]),
    invalidateRenderPasses: (...args) => events.push(["invalidate", ...args]),
    render: () => events.push(["render"]),
    recordInteractionRecoveryTaskMetric: (...args) => events.push(["metric", ...args]),
    ...ports,
  });
  return {
    owner, state, events, pending,
    run() { const [id, callback] = pending.entries().next().value; pending.delete(id); callback(); },
    drain() { let count = 0; while (pending.size) { if (++count > 100) throw new Error("runaway queue"); this.run(); } },
    setCountryCost: (value) => { countryCost = value; },
    getDetailState: () => detailState,
    setSettled: (value) => { settled = value; }, setAdmitted: (value) => { admitted = value; },
    setSourceCountries: (value) => { sourceCountries = value; },
    setViewport: (value) => { viewport = value; }, setMesh: (value) => { mesh = value; },
    throwOnBuild: () => { shouldThrow = true; },
  };
}

test("worker wait releases recovery ownership and commits only after quiet admission", async () => {
  let resolve; let commits = 0;
  const h = harness({ buildDeferredBorderMeshesAsync: () => new Promise((done) => { resolve = done; }),
    commitDeferredBorderMeshes: () => { commits += 1; return true; } });
  assert.equal(h.owner.hasPendingWork(), false);
  h.owner.scheduleDeferredHeavyBorderMeshes(); h.run(); await Promise.resolve();
  assert.equal(h.owner.hasPendingWork(), true, "awaiting the worker remains observable after the timer runs");
  assert.equal(h.events.filter(([name]) => name === "end").length, 1);
  assert.equal(h.pending.size, 0);
  resolve({}); for (let i = 0; i < 6; i++) await Promise.resolve();
  h.setSettled(false); h.run(); assert.equal(commits, 0);
  h.setSettled(true); h.drain(); assert.equal(commits, 1);
  assert.equal(h.owner.hasPendingWork(), false);
  assert.equal(h.events.some(([name]) => name === "country"), false);
});

test("cancelled worker result cannot commit or clear a newer job", async () => {
  let resolve; let signal; let commits = 0;
  const h = harness({ buildDeferredBorderMeshesAsync: (request) => { signal = request.signal; return new Promise((done) => { resolve = done; }); },
    commitDeferredBorderMeshes: () => { commits++; return true; } });
  h.owner.scheduleDeferredHeavyBorderMeshes(); h.run(); await Promise.resolve();
  h.owner.scheduleDeferredHeavyBorderMeshes(); assert.equal(signal.aborted, true);
  resolve({}); for (let i = 0; i < 6; i++) await Promise.resolve();
  assert.equal(commits, 0); assert.equal(h.pending.size, 1);
});

test("worker errors use the existing synchronous mesh path", async () => {
  const h = harness({ buildDeferredBorderMeshesAsync: async () => { throw new Error("worker unavailable"); }, commitDeferredBorderMeshes: () => false });
  h.owner.scheduleDeferredHeavyBorderMeshes(); h.run();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  h.drain(); assert.ok(h.events.some(([name]) => name === "country"));
  assert.ok(h.events.some(([name, task]) => name === "metric" && task === "border-worker-fallback"));
});

test("scene changes discard worker replies and restart current selection", async () => {
  let resolve; let commits = 0;
  const h = harness({ buildDeferredBorderMeshesAsync: () => new Promise((done) => { resolve = done; }),
    commitDeferredBorderMeshes: () => { commits++; return true; } });
  h.owner.scheduleDeferredHeavyBorderMeshes(); h.run(); await Promise.resolve();
  h.state.sceneGeneration = 2; resolve({});
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(commits, 0); assert.equal(h.pending.size, 1);
  h.owner.cancelDeferredHeavyBorderMeshes();
});

test("deferred mesh work replaces pending jobs and retries only recovery gates", () => {
  const h = harness(); h.owner.scheduleDeferredHeavyBorderMeshes(); h.owner.scheduleDeferredHeavyBorderMeshes();
  assert.equal(h.pending.size, 1);
  h.setSettled(false); h.run();
  assert.equal(h.pending.size, 1); assert.equal(h.events.some(([name]) => name === "begin"), false);
  h.setSettled(true); h.setAdmitted(false); h.run();
  assert.equal(h.pending.size, 1); assert.equal(h.events.some(([name]) => name === "country"), false);
  h.owner.cancelDeferredHeavyBorderMeshes(); assert.equal(h.pending.size, 0);
  assert.ok(h.events.filter(([name]) => name === "schedule").every(([, timeout]) => timeout === 360));
});

test("deferred work reads execution-time topology, zoom and sources then snapshots before rendering", () => {
  const h = harness(); h.owner.scheduleDeferredHeavyBorderMeshes();
  h.state.topologyRevision = 2; h.state.topologyDetail = { id: "detail-2" };
  h.state.zoomTransform = { k: 6 };
  h.state.spatialItems = [{ countryCode: "bb", minX: 1, minY: 1, maxX: 2, maxY: 2 }];
  h.setSourceCountries({ detail: new Set(["BB"]) }); h.drain();
  assert.deepEqual(h.events.find(([name]) => name === "detail"), ["detail", h.state.topologyDetail, ["BB"]]);
  assert.deepEqual(h.getDetailState(), { signature: "2|6|BB", status: "ready" });
  const names = h.events.map(([name]) => name);
  assert.ok(names.indexOf("snapshot") < names.indexOf("invalidate"));
  assert.ok(names.indexOf("invalidate") < names.indexOf("render"));
  assert.equal(names.at(-1), "end");
  h.events.length = 0; h.owner.scheduleDeferredHeavyBorderMeshes(); h.drain();
  assert.equal(h.events.some(([name]) => name === "detail" || name === "render" || name === "snapshot"), false);
});

test("empty detail results settle once without rendering and re-evaluate on signature change", () => {
  const h = harness(); h.setMesh(null);
  h.state.cachedProvinceBordersByCountry.set("AA", []); h.state.cachedLocalBordersByCountry.set("AA", []);
  h.owner.scheduleDeferredHeavyBorderMeshes(); h.drain();
  assert.equal(h.getDetailState().status, "empty");
  assert.equal(h.events.filter(([name]) => name === "snapshot").length, 1);
  assert.equal(h.events.some(([name]) => name === "render"), false);
  h.owner.scheduleDeferredHeavyBorderMeshes(); h.drain();
  assert.equal(h.events.filter(([name]) => name === "detail").length, 1);
  h.state.topologyRevision += 1; h.owner.scheduleDeferredHeavyBorderMeshes(); h.drain();
  assert.equal(h.events.filter(([name]) => name === "detail").length, 2);
});

test("recovery task is released on early exits and mesh errors", () => {
  const h = harness(); h.state.zoomTransform.k = 1;
  h.owner.scheduleDeferredHeavyBorderMeshes(); h.run();
  assert.equal(h.events.at(-1)[0], "end");
  assert.equal(h.events.some(([name]) => name === "country"), false);
  h.state.zoomTransform.k = 5; h.throwOnBuild(); h.owner.scheduleDeferredHeavyBorderMeshes();
  assert.throws(() => h.run(), /build failure/);
  assert.equal(h.events.at(-1)[0], "end"); assert.equal(h.pending.size, 0);
});

test("visible-country cache returns detached sets and invalidates with viewport and explicit reset", () => {
  const h = harness();
  const first = h.owner.getVisibleCountryCodesForBorderMeshes(); first.clear();
  assert.deepEqual([...h.owner.getVisibleCountryCodesForBorderMeshes()], ["AA"]);
  h.setViewport({ minX: 20, minY: 20, maxX: 30, maxY: 30 });
  assert.equal(h.owner.getVisibleCountryCodesForBorderMeshes().size, 0);
  h.state.spatialItems[0] = { borderMeshCountryCode: "cc", minX: 21, minY: 21, maxX: 22, maxY: 22 };
  h.owner.resetVisibleCountryCodesCache();
  assert.deepEqual([...h.owner.getVisibleCountryCodesForBorderMeshes()], ["CC"]);
  h.setViewport(null); assert.equal(h.owner.getVisibleCountryCodesForBorderMeshes().size, 0);
});

test("snapshot copies collections while preserving mesh identities and current detail state", () => {
  const h = harness(); const mesh = { id: "mesh" };
  h.state.cachedCountryBorders = [mesh]; h.state.cachedProvinceBordersByCountry.set("AA", [mesh]);
  const snapshot = h.owner.captureStaticMeshSnapshot();
  assert.notEqual(snapshot.cachedCountryBorders, h.state.cachedCountryBorders);
  assert.equal(snapshot.cachedCountryBorders[0], mesh);
  assert.notEqual(snapshot.cachedProvinceBordersByCountry, h.state.cachedProvinceBordersByCountry);
  assert.equal(snapshot.cachedProvinceBordersByCountry.get("AA"), h.state.cachedProvinceBordersByCountry.get("AA"));
  snapshot.detailAdmMeshBuildState.status = "empty"; assert.equal(h.getDetailState().status, "idle");
});

test("source signature is order-independent and coastline signature tracks decision fields", () => {
  assert.equal(getSourceCountriesSignature({ primary: new Set(["BB", "AA"]), detail: new Set(["CC"]) }), "primary:AA,BB|detail:CC");
  assert.equal(getCoastlineDecisionSignature(null), "");
  const decision = { scenarioSurfaceVersionSignal: "a", source: "runtime", scenarioId: "tno" };
  assert.notEqual(getCoastlineDecisionSignature(decision), getCoastlineDecisionSignature({ ...decision, scenarioSurfaceVersionSignal: "b" }));
  assert.notEqual(getCoastlineDecisionSignature(decision), getCoastlineDecisionSignature({ ...decision, runtimeInteriorRingRatio: 0.5 }));
});

function useThreeCountries(h) {
  h.state.spatialItems = ["AA", "BB", "CC"].map((countryCode) => ({
    countryCode, minX: 1, minY: 1, maxX: 2, maxY: 2,
  }));
  h.setCountryCost(9);
}

test("country work yields at the CPU budget, isolates detail ADM, and publishes once", () => {
  const h = harness(); useThreeCountries(h);
  h.owner.scheduleDeferredHeavyBorderMeshes();
  for (let index = 1; index <= 3; index += 1) {
    h.run();
    assert.equal(h.state.cachedProvinceBordersByCountry.size, index);
    assert.equal(h.events.filter(([name]) => name === "end").length, index);
    assert.equal(h.events.some(([name]) => name === "detail" || name === "snapshot" || name === "render"), false);
    assert.equal(h.pending.size, 1);
  }
  h.run();
  assert.equal(h.pending.size, 0);
  assert.equal(h.events.filter(([name]) => name === "detail").length, 1);
  assert.equal(h.events.filter(([name]) => name === "snapshot").length, 1);
  assert.equal(h.events.filter(([name]) => name === "render").length, 1);
  const metrics = h.events.filter(([name]) => name === "metric");
  assert.deepEqual(metrics.map(([, , duration]) => duration), [9, 9, 9, 0]);
  assert.equal(metrics.at(-1)[3].cpuMs, 27);
  assert.equal(metrics.at(-1)[3].yieldCount, 3);
  assert.equal(metrics.at(-1)[3].complete, true);
});

test("mutable slice progress leaves borrowed topology and spatial identities untouched", () => {
  const h = harness(); useThreeCountries(h);
  const borrowed = {
    topologyPrimary: Object.freeze({ id: "primary" }),
    topology: Object.freeze({ id: "topology" }),
    topologyDetail: Object.freeze({ id: "detail" }),
    runtimePoliticalTopology: Object.freeze({ id: "political" }),
    spatialItems: Object.freeze(h.state.spatialItems.map((item) => Object.freeze(item))),
    zoomTransform: Object.freeze({ k: 5, x: 0, y: 0 }),
  };
  Object.assign(h.state, borrowed);
  const before = JSON.stringify(borrowed);
  h.owner.scheduleDeferredHeavyBorderMeshes(); h.drain();
  for (const [key, value] of Object.entries(borrowed)) assert.equal(h.state[key], value, key);
  assert.equal(JSON.stringify(borrowed), before);
  assert.equal(h.events.filter(([name]) => name === "country").length, 3);
  assert.equal(h.events.filter(([name]) => name === "snapshot").length, 1);
  assert.equal(h.events.filter(([name]) => name === "render").length, 1);
});

for (const identityKey of ["topologyPrimary", "topology", "topologyDetail", "runtimePoliticalTopology", "spatialItems"]) {
  test(`replacement ${identityKey} rejects a stale worker result without a revision change`, async () => {
    const requests = [];
    const commits = [];
    const h = harness({
      buildDeferredBorderMeshesAsync: (request) => new Promise((resolve) => requests.push({ request, resolve })),
      commitDeferredBorderMeshes: (result) => { commits.push(result); return true; },
    });
    const initial = identityKey === "spatialItems"
      ? Object.freeze(h.state.spatialItems.map((item) => Object.freeze(item)))
      : Object.freeze({ id: "same-content" });
    h.state[identityKey] = initial;
    h.owner.scheduleDeferredHeavyBorderMeshes(); h.run(); await Promise.resolve();
    const revision = h.state.topologyRevision;
    h.state[identityKey] = identityKey === "spatialItems" ? [...initial] : { ...initial };
    requests[0].resolve({ id: "stale" });
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    assert.equal(h.state.topologyRevision, revision);
    assert.deepEqual(commits, []);
    assert.equal(h.events.some(([name]) => name === "snapshot" || name === "render"), false);
    assert.equal(h.pending.size, 1);
    h.run(); await Promise.resolve();
    requests[1].resolve({ id: "current" });
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    h.drain();
    assert.deepEqual(commits, [{ id: "current" }]);
    assert.equal(h.events.filter(([name]) => name === "snapshot").length, 1);
    assert.equal(h.events.filter(([name]) => name === "render").length, 1);
  });
}

test("canceled callbacks cannot clear or execute the replacement queue", () => {
  const h = harness(); useThreeCountries(h);
  h.owner.scheduleDeferredHeavyBorderMeshes(); h.run();
  const staleCallback = [...h.pending.values()][0];
  h.owner.scheduleDeferredHeavyBorderMeshes();
  const currentHandle = [...h.pending.keys()][0];
  staleCallback();
  assert.deepEqual([...h.pending.keys()], [currentHandle]);
  assert.equal(h.events.filter(([name]) => name === "country").length, 1);
  h.owner.cancelDeferredHeavyBorderMeshes();
  staleCallback();
  assert.equal(h.pending.size, 0);
});

for (const change of ["scene", "topology", "owner", "viewport", "sceneGeneration", "scenarioDataGeneration", "scenarioShellOverlayRevision", "mapSemanticMode"]) {
  test(`a ${change} change discards the remaining queue before publishing`, () => {
    const h = harness(); useThreeCountries(h);
    h.owner.scheduleDeferredHeavyBorderMeshes(); h.run();
    if (change === "scene") h.state.activeScenarioId = "new-scenario";
    if (change === "topology") h.state.topologyRevision += 1;
    if (change === "owner") h.state.sovereigntyRevision = 1;
    if (change === "viewport") h.setViewport({ minX: 20, minY: 20, maxX: 30, maxY: 30 });
    if (["sceneGeneration", "scenarioDataGeneration", "scenarioShellOverlayRevision", "mapSemanticMode"].includes(change)) h.state[change] = 1;
    // Retain the spatial array identity and length so the tested identity field
    // is what forces the queue to be rebuilt.
    h.state.spatialItems.fill({ countryCode: "DD", minX: change === "viewport" ? 21 : 1,
      minY: change === "viewport" ? 21 : 1, maxX: 22, maxY: 22 });
    h.run(); // Detect changed identity; enqueue current selection.
    assert.equal(h.events.some(([name]) => name === "snapshot" || name === "render"), false);
    h.drain();
    assert.deepEqual(h.events.filter(([name]) => name === "country").map(([, code]) => code), ["AA", "DD"]);
    assert.equal(h.events.filter(([name]) => name === "render").length, 1);
  });
}
