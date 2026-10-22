import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { getObjectIdentityToken } from "../js/core/renderer/object_identity.js";
import { getProjectionGeometryGeneration, markProjectionGeometryChanged } from "../js/core/renderer/projection_geometry_identity.js";
import { getContextCollectionRevision, getContextGeometryRevision, recordContextLayerPublication } from "../js/core/state/context_layer_revision.js";
import { getPoliticalGeometrySnapshot, registerPoliticalGeometrySnapshot } from "../js/core/political_geometry_store.js";

const REPO_ROOT = process.cwd();

function readRepoFile(...relativeParts) {
  return fs.readFileSync(path.join(REPO_ROOT, ...relativeParts), "utf8");
}

function createLandClipHarness() {
  const source = readRepoFile("js", "core", "map_renderer.js");
  const start = source.indexOf("function getPhysicalLandClipCacheKey(maskInfo) {");
  const end = source.indexOf("function applyPhysicalLandClipMask() {", start);
  const resetStart = source.indexOf("function resetPhysicalLandClipPathCache() {");
  const resetEnd = source.indexOf("\nfunction ", resetStart + 1);
  assert.ok(start > 0 && end > start && resetStart > 0 && resetEnd > resetStart);
  const sandbox = {};
  vm.runInNewContext(readRepoFile("vendor", "d3.v7.min.js"), sandbox);
  const d3 = sandbox.d3;
  let projection = d3.geoEqualEarth();
  const collection = { type: "FeatureCollection", features: [{ type: "Feature", properties: {},
    geometry: { type: "Polygon", coordinates: [
      [[1, 1], [1, 20], [20, 1], [1, 1]], [[3, 3], [5, 3], [3, 5], [3, 3]],
    ] } }] };
  const runtimeState = { contextLayerRevision: 0, landBgData: collection };
  const maskInfo = { collection, maskSource: "landBgData", maskQualityToken: "d3-valid" };
  const built = [];
  class Path2D { constructor(svg) { this.svg = svg; built.push(this); } }
  const physicalLandClipPathCache = { key: "", path: null };
  const deps = { globalThis: { d3, Path2D }, rendererSurfaceHost: { getProjection: () => projection },
    runtimeState, physicalLandClipPathCache, PATH_POINT_RADIUS: 2, getObjectIdentityToken,
    getProjectionGeometryGeneration, getContextCollectionRevision, getContextGeometryRevision, getPoliticalGeometrySnapshot };
  const api = new Function(...Object.keys(deps), `${source.slice(start, end)}\n${source.slice(resetStart, resetEnd)}
    return { getPhysicalLandClipCacheKey, getPhysicalLandClipPath, resetPhysicalLandClipPathCache };`)(...Object.values(deps));
  const key = () => api.getPhysicalLandClipCacheKey(maskInfo);
  const clip = () => api.getPhysicalLandClipPath(maskInfo, maskInfo.collection);
  return { api, key, clip, built, runtimeState, maskInfo, d3,
    get projection() { return projection; }, set projection(value) { projection = value; } };
}

test("physical clip reuses the identical SVG path across known water-only publications and camera/style changes", () => {
  const h = createLandClipHarness();
  const before = h.clip();
  assert.equal(before.cacheHit, false);
  const expected = h.d3.geoPath(h.projection).pointRadius(2)(h.maskInfo.collection);
  assert.equal(before.path.svg, expected, "keep the original rounded SVG and polygon hole semantics");
  const previousRevision = h.runtimeState.contextLayerRevision;
  h.runtimeState.contextLayerRevision++;
  const water = { features: [{}] };
  h.runtimeState.scenarioWaterRegionsData = water;
  h.runtimeState.contextLayerExternalDataByName = { lakes: water };
  recordContextLayerPublication(h.runtimeState, previousRevision, [water]);
  Object.assign(h.runtimeState, { scenarioAtlantropaData: { features: [{}] }, showScenarioAtlantropa: false,
    scenarioWaterOverlayVersionTag: "changed", scenarioContextLandMaskVersionTag: "unselected",
    detailPromotionCompleted: true, topologyRevision: 7, colorRevision: 5,
    zoomTransform: { x: 77, y: 22, k: 2.5 }, dpr: 2 });
  const next = h.clip();
  assert.equal(next.cacheHit, true);
  assert.equal(next.path, before.path);
  assert.equal(h.built.length, 1);
});

test("physical clip preserves unknown in-place geometry edits even before a subsequent known water publication", () => {
  for (const publishWater of [false, true]) {
    const h = createLandClipHarness();
    const before = h.clip();
    h.maskInfo.collection.features[0].geometry.coordinates[0][1][0] += 0.25;
    h.runtimeState.contextLayerRevision++;
    if (publishWater) {
      const previousRevision = h.runtimeState.contextLayerRevision++;
      recordContextLayerPublication(h.runtimeState, previousRevision, [{ features: [] }]);
    }
    const next = h.clip();
    assert.equal(next.cacheHit, false);
    assert.notEqual(next.path, before.path);
    assert.notEqual(next.path.svg, before.path.svg);
  }
});

test("physical clip tracks selected collection publications, replacements, feature arrays and membership count", () => {
  const changes = [
    h => { const revision = h.runtimeState.contextLayerRevision++; recordContextLayerPublication(h.runtimeState, revision, [h.maskInfo.collection]); },
    h => { h.maskInfo.collection = { ...h.maskInfo.collection }; },
    h => { h.maskInfo.collection.features = [...h.maskInfo.collection.features]; },
    h => { h.maskInfo.collection.features.push(h.maskInfo.collection.features[0]); },
    h => { h.maskInfo.maskSource = "scenarioLandMask"; },
    h => { h.maskInfo.maskQualityToken = "changed"; },
  ];
  for (const change of changes) {
    const h = createLandClipHarness(), previous = h.key();
    change(h);
    assert.notEqual(h.key(), previous);
  }
});

test("physical clip uses only the selected scenario mask version and the political fallback's geometry snapshot", () => {
  for (const [source, field, other] of [
    ["scenarioLandMask", "scenarioLandMaskVersionTag", "scenarioContextLandMaskVersionTag"],
    ["scenarioContextLandMask", "scenarioContextLandMaskVersionTag", "scenarioLandMaskVersionTag"],
  ]) {
    const h = createLandClipHarness();
    h.maskInfo.maskSource = source;
    const before = h.key();
    h.runtimeState[other] = "unrelated";
    assert.equal(h.key(), before);
    h.runtimeState[field] = "selected-mask-updated";
    assert.notEqual(h.key(), before);
  }
  for (const source of ["landData", "landDataFull"]) {
    const h = createLandClipHarness();
    h.maskInfo.maskSource = source;
    registerPoliticalGeometrySnapshot(h.maskInfo.collection, { revision: 4 });
    const before = h.key();
    registerPoliticalGeometrySnapshot(h.maskInfo.collection, { revision: 5 });
    assert.notEqual(h.key(), before);
  }
});

test("physical clip detects exact projection options, custom clipping, replacement and marked mutation", () => {
  const mutations = [
    h => h.projection.precision(h.projection.precision() + 1e-7),
    h => h.projection.translate([h.projection.translate()[0] + 1e-7, h.projection.translate()[1]]),
    h => h.projection.scale(h.projection.scale() + 1e-7),
    h => h.projection.center([1e-7, 0]), h => h.projection.rotate([1e-7, 0, 0]),
    h => h.projection.angle(1e-7), h => h.projection.reflectX(true), h => h.projection.reflectY(true),
    h => h.projection.clipAngle(179.9999999),
    h => h.projection.clipExtent([[0, 0], [700.0000001, 500]]),
    h => h.projection.preclip(stream => stream), h => h.projection.postclip(stream => stream),
    h => { h.projection = h.d3.geoEqualEarth(); }, h => markProjectionGeometryChanged(h.projection),
  ];
  for (const change of mutations) {
    const h = createLandClipHarness(), previous = h.key();
    change(h);
    assert.notEqual(h.key(), previous);
  }
  const h = createLandClipHarness();
  h.projection.clipExtent([[0, 0], [700, 500]]);
  const before = h.key();
  h.projection.clipExtent([[0, 0], [700 + 1e-7, 500]]);
  assert.notEqual(h.key(), before, "sub-rounding clip extent changes cannot collide");
});

test("physical clip key does not traverse feature arrays and explicit reset still rebuilds the original SVG path", () => {
  const h = createLandClipHarness();
  const before = h.clip();
  h.api.resetPhysicalLandClipPathCache();
  const next = h.clip();
  assert.equal(next.cacheHit, false);
  assert.notEqual(next.path, before.path);
  assert.equal(next.path.svg, before.path.svg);
  h.maskInfo.collection.features = new Proxy(h.maskInfo.collection.features, { get(target, name, receiver) {
    if (name === Symbol.iterator || /^\d+$/.test(String(name))) assert.fail("cache lookup must not scan mask features");
    return Reflect.get(target, name, receiver);
  } });
  const key = h.key();
  for (let repeat = 0; repeat < 10; repeat++) assert.equal(h.key(), key);
});

test("physical layer runtime assets stay publishable through registry and Pages allowlist", () => {
  const registry = JSON.parse(readRepoFile("data", "runtime_asset_registry.json"));
  const manifest = JSON.parse(readRepoFile("data", "manifest.json"));
  const pagesDistSource = readRepoFile("tools", "build_pages_dist.py");

  const expectedAssets = {
    "context_layer:physical": "data/europe_physical.geojson",
    "context_layer:physical_semantics": "data/global_physical_semantics.topo.json",
    "context_layer:physical_contours_major": "data/global_contours.major.topo.json",
    "context_layer:physical_contours_minor": "data/global_contours.minor.topo.json",
  };

  Object.entries(expectedAssets).forEach(([assetKey, assetPath]) => {
    assert.equal(registry.assets?.[assetKey]?.url, assetPath, assetKey);
    assert.equal(manifest.runtime_asset_registry?.assets?.[assetKey]?.url, assetPath, assetKey);
    assert.ok(pagesDistSource.includes(`"${assetPath.replace("data/", "")}"`), assetPath);
  });

});
