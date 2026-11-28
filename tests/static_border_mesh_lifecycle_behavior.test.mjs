import test from "node:test";
import assert from "node:assert/strict";
import { createStaticBorderMeshLifecycle } from "../js/core/renderer/static_border_mesh_lifecycle.js";

function harness(ports = {}) {
  const pending = new Map();
  let nextId = 0;
  let detailState = { signature: "", status: "idle" };
  let sourceCountries = { primary: new Set(), detail: new Set(["AA"]) };
  let viewport = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
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
    cancelDeferredWork: handle => pending.delete(handle),
    scheduleDeferredWork(callback) { const id = ++nextId; pending.set(id, callback); return id; },
    isInteractionRecoverySettled: () => true,
    beginInteractionRecoveryTask: () => true,
    endInteractionRecoveryTask() {},
    recordInteractionRecoveryTaskMetric() {},
    nowMs: () => 10,
    PROVINCE_BORDERS_TRANSITION_END_ZOOM: 2,
    LOCAL_BORDERS_MIN_ZOOM: 3,
    DETAIL_ADM_BORDERS_MIN_ZOOM: 4,
    ...ports,
  });
  return {
    owner, state, pending,
    run() { const [id, callback] = pending.entries().next().value; pending.delete(id); callback(); },
  };
}

test("cancelled worker result cannot commit or clear a newer job", async () => {
  let resolve; let signal; let commits = 0;
  const h = harness({ isRetainedSceneActive: () => true,
    buildDeferredBorderMeshesAsync: (request) => { signal = request.signal; return new Promise((done) => { resolve = done; }); },
    commitDeferredBorderMeshes: () => { commits++; return true; } });
  h.owner.scheduleDeferredHeavyBorderMeshes(); h.run(); await Promise.resolve();
  h.state.topologyDetail = { id: "replacement" };
  h.owner.scheduleDeferredHeavyBorderMeshes(); assert.equal(signal.aborted, true);
  resolve({}); for (let i = 0; i < 6; i++) await Promise.resolve();
  assert.equal(commits, 0); assert.equal(h.pending.size, 1);
});
