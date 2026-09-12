import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "acorn";
import { createPhysicalContourVisibleSetOwner } from "../js/core/renderer/physical_contour_visible_set_owner.js";
import { createRendererTransactionResetOwner } from "../js/core/map_renderer/renderer_transaction_reset_owner.js";

const viewport = Object.freeze({
  width: 1000, height: 600, topologyRevision: 1, zoomBucket: "near",
  transformSignature: "0|0|2|1000|600|1", viewportSignature: "1000|600|1",
});
const box = (span = 20, x = 0, y = 0) => ({
  minX: x, minY: y, maxX: x + span, maxY: y + span, width: span, height: span,
});
const feature = (id, elevation = 200, type = "LineString") => Object.freeze({
  id, properties: Object.freeze({ elevation_m: elevation }), geometry: Object.freeze({ type }),
});
const collection = (...features) => Object.freeze({ features: Object.freeze(features) });

function harness(bounds = () => box()) {
  const calls = [];
  const owner = createPhysicalContourVisibleSetOwner({
    overscanPx: 96,
    getFeatureScreenBounds(item, options) {
      calls.push([item.id, options?.allowCompute]);
      return bounds(item, options);
    },
  });
  return { owner, calls };
}

test("selection preserves source identities/order and filters before querying bounds", () => {
  const low = feature("low", 50), major = feature("major", 1000);
  const a = feature("a", 200), b = feature("b", 400), offInterval = feature("off-interval", 300);
  const outside = feature("outside", 600), tiny = feature("tiny", 800);
  const source = collection(low, a, major, b, offInterval, outside, tiny);
  const { owner, calls } = harness((item) => item === outside ? box(20, 1100) : box(item === tiny ? 2 : 20));
  const selected = owner.select(source, { lowReliefCutoff: 100, intervalM: 200, excludeIntervalM: 1000, minScreenSpanPx: 10 }, viewport);
  assert.deepEqual(selected, [a, b]);
  assert.equal(selected[0], a);
  assert.deepEqual(calls.map(([id]) => id), ["a", "b", "outside", "tiny"]);
});

test("uncached bounds fall back once, unprojectable lines survive only without span filtering", () => {
  const fallback = feature("fallback"), line = feature("line"), multi = feature("multi", undefined, " MultiLineString ");
  const polygon = feature("polygon", 200, "Polygon");
  const { owner, calls } = harness((item, options) => item === fallback && options?.allowCompute !== false ? box() : null);
  const source = collection(fallback, line, multi, polygon);
  assert.deepEqual(owner.select(source, {}, viewport), [fallback, line, multi]);
  assert.deepEqual(calls.slice(0, 2), [["fallback", false], ["fallback", undefined]]);
  assert.deepEqual(owner.select(source, { minScreenSpanPx: 1 }, viewport), [fallback]);
});

test("viewport overscan includes touching edges and scales for large viewports", () => {
  const edge = feature("edge"), outside = feature("outside"), scaled = feature("scaled");
  const { owner } = harness((item) => box(0, item === edge ? 1096 : item === outside ? -96.01 : 2160));
  assert.deepEqual(owner.select(collection(edge, outside), {}, viewport), [edge]);
  assert.deepEqual(owner.select(collection(scaled), {}, {
    ...viewport, width: 2000, height: 2000, transformSignature: "large", viewportSignature: "large",
  }), [scaled]);
});

test("feature cap retains score ranking and stable ties without mutating input order", () => {
  const a = feature("a"), b = feature("b"), wide = feature("wide", 0), high = feature("high", 1000);
  const source = collection(a, b, wide, high);
  const { owner } = harness((item) => box(item === wide ? 100 : 20));
  assert.deepEqual(owner.select(source, { maxFeatures: 3 }, viewport), [wide, high, a]);
  assert.deepEqual(owner.select(source, { maxFeatures: 4 }, viewport), [a, b, wide, high]);
  assert.deepEqual(source.features, [a, b, wide, high]);
});

test("cache hits reuse result arrays; collection identity, viewport identity and reset invalidate both slots", () => {
  const item = feature("a"), source = collection(item);
  const { owner, calls } = harness();
  const major = owner.select(source, {}, viewport);
  const minor = owner.select(source, { cacheSlot: "minor" }, viewport);
  assert.notEqual(major, minor);
  assert.equal(owner.select(source, {}, viewport), major);
  assert.equal(calls.length, 2);
  assert.notEqual(owner.select(collection(item), {}, viewport), major);
  for (const field of ["topologyRevision", "zoomBucket", "transformSignature", "viewportSignature"]) {
    const original = owner.select(source, {}, viewport);
    assert.notEqual(owner.select(source, {}, { ...viewport, [field]: 9 }), original, field);
  }
  const beforeReset = owner.select(source, {}, viewport);
  owner.reset();
  assert.notEqual(owner.select(source, {}, viewport), beforeReset);
  assert.notEqual(owner.select(source, { cacheSlot: "minor" }, viewport), minor);
});

test("each filter and source feature count participates in cache identity", () => {
  const source = { features: [feature("a", 1200)] };
  const { owner } = harness();
  for (const field of ["lowReliefCutoff", "intervalM", "excludeIntervalM", "minScreenSpanPx", "maxFeatures"]) {
    const before = owner.select(source, {}, viewport);
    assert.notEqual(owner.select(source, { [field]: 1 }, viewport), before, field);
  }
  const before = owner.select(source, {}, viewport);
  source.features.push(feature("b"));
  assert.notEqual(owner.select(source, {}, viewport), before);
  assert.deepEqual(owner.select(null, {}, viewport), []);
  assert.deepEqual(owner.select(collection(), {}, viewport), []);
});

test("failed projection does not publish partial selections or poison later attempts", () => {
  let fail = true;
  const source = collection(feature("a"), feature("b"));
  const { owner } = harness((item) => {
    if (item.id === "b" && fail) throw new Error("projection failure");
    return box();
  });
  assert.throws(() => owner.select(source, {}, viewport), /projection failure/);
  fail = false;
  assert.deepEqual(owner.select(source, {}, viewport), source.features);
  assert.throws(() => createPhysicalContourVisibleSetOwner({ overscanPx: 96 }), /getFeatureScreenBounds/);
});

test("real renderer adapter samples live viewport state; refresh preserves cache while topology reset releases it", () => {
  const sourceText = readFileSync(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
  const ast = parse(sourceText, { sourceType: "module", ecmaVersion: "latest" });
  const names = ["getContourVisibleFeatures", "resetExactRefreshOptimizationState"];
  const declarations = names.map((name) => {
    const node = ast.body.find((entry) => entry.type === "FunctionDeclaration" && entry.id.name === name);
    assert.ok(node, name);
    return sourceText.slice(node.start, node.end);
  }).join("\n");
  const { owner, calls } = harness();
  const state = { width: 1000, height: 600, topologyRevision: 1, zoomTransform: { k: 2, x: 0, y: 0 } };
  const adapter = new Function("runtimeState", "contourVisibleSetOwner", "getContextBaseZoomBucketId", "getTransformSignature", "getViewportRenderSignature", "resetContourHostFillColorCache", "cancelDeferredContextBaseEnhancement", `let detailAdmMeshBuildState; ${declarations}; return { ${names.join(",")} };`)(
    state, owner, (k) => k, (t) => JSON.stringify(t), () => `${state.width}|${state.height}`, () => {}, () => {},
  );
  const source = collection(feature("a"));
  const first = adapter.getContourVisibleFeatures(source);
  assert.equal(adapter.getContourVisibleFeatures(source), first);
  state.zoomTransform.x = 20;
  const panned = adapter.getContourVisibleFeatures(source);
  assert.notEqual(panned, first);
  state.width = 1200;
  const resized = adapter.getContourVisibleFeatures(source);
  assert.notEqual(resized, panned);
  const effects = new Proxy({}, { get: (_target, name) => name === "resetExactRefreshOptimizationState"
    ? adapter.resetExactRefreshOptimizationState : () => {} });
  const transactions = createRendererTransactionResetOwner({ effects });
  transactions.resetRendererRefreshTransactionState();
  assert.equal(adapter.getContourVisibleFeatures(source), resized);
  transactions.markRendererTopologyChanged();
  assert.notEqual(adapter.getContourVisibleFeatures(source), resized);
  assert.equal(calls.length, 4);
});
