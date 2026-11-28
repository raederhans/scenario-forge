import assert from "node:assert/strict";
import test from "node:test";
import { createHitTestingOwner } from "../js/core/map_renderer/hit_testing_owner.js";

function harness() {
  const feature = { geometry: { type: "Polygon" }, properties: { contains: true } };
  const item = { id: "land", feature, minX: 0, minY: 0, maxX: 10, maxY: 10, bboxArea: 100 };
  const state = {
    idToKey: new Map([["land", 1]]), keyToId: new Map([[1, "land"]]),
    landIndex: new Map([["land", feature]]), spatialItemsById: new Map([["land", item]]),
    dpr: 2, topologyRevision: 7, hitCanvasTopologyRevision: 0, hitCanvasDirty: true,
    renderPhase: "idle", activeScenarioId: "test",
    zoomTransform: { x: 0, y: 0, k: 1 },
  };
  const context = { getImageData: () => ({ data: [1, 0, 0, 255] }) };
  const deps = new Proxy({
    nowMs: () => 10,
    getHitContext: () => context, getPathHitCanvas: () => () => {},
    getHitCanvas: () => ({ width: 100, height: 100 }), getMapSvg: () => ({}),
    getProjection: () => ({ invert: point => point }),
    getLogicalCanvasDimensions: () => [50, 50],
    canonicalCountryCode: value => value,
    getFeatureCountryCodeNormalized: () => "AA", getFeatureInteractionCountryCodeNormalized: () => "BB",
  }, { get: (target, key) => target[key] || (() => false) });
  return { owner: createHitTestingOwner({ state, deps }) };
}

test("hit colors round trip across byte boundaries", () => {
  const { owner } = harness();
  for (const key of [0, 1, 255, 256, 65535, 65536, 0xffffff]) {
    const pixel = owner.keyToHitColor(key).match(/\d+/g).map(Number);
    assert.equal(owner.hitColorToKey(pixel), key);
  }
});

test("canvas hits retain distinct runtime and interaction countries", t => {
  const previous = globalThis.d3;
  t.after(() => { globalThis.d3 = previous; });
  globalThis.d3 = { pointer: () => [5, 5] };
  const { owner } = harness();
  const hit = owner.getHitResultFromCanvas({});
  assert.equal(hit.countryCode, "BB");
  assert.equal(hit.runtimeCountryCode, "AA");
});
