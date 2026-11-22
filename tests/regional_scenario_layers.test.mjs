import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createUrbanCityPolicyOwner } from "../js/core/renderer/urban_city_policy.js";
import { createCityPointsRenderOwner } from "../js/core/renderer/city_points_render_owner.js";
import * as cityPolicy from "../js/core/renderer/city_reveal_policy.js";
import { getRegionalLandMaskInfo, getRegionalLayerFilter } from "../js/core/renderer/regional_layer_filter.js";
import { resolveEffectiveWaterRegionFeatures, getScenarioWaterYear } from "../js/core/renderer/effective_water_regions.js";
import { createHitTestingOwner } from "../js/core/map_renderer/hit_testing_owner.js";
import { createPhysicalLayerRenderOwner } from "../js/core/renderer/physical_layer_render_owner.js";
import { createRiverLayerRenderOwner } from "../js/core/renderer/river_layer_render_owner.js";
import { state as mapState } from "../js/core/state.js";
import { refreshMapDataForScenarioApply } from "../js/core/map_renderer.js";

const require = createRequire(import.meta.url);
const d3 = require("../vendor/d3.v7.min.js");
const manifest = { region: { bounds: [0, 0, 30, 30] }, bookmark_date: "1919-10-15" };
const ring = (west, south, east, north) => [[west, south], [west, north], [east, north], [east, south], [west, south]];
const polygon = (id, rings, properties = {}) => ({ type: "Feature", properties: { id, ...properties },
  geometry: { type: "Polygon", coordinates: rings } });
const point = (id, coordinates, properties = {}) => ({ type: "Feature", id, properties: { id, ...properties },
  geometry: { type: "Point", coordinates } });
const collection = (...features) => ({ type: "FeatureCollection", features });
const land = collection(polygon("local", [ring(2, 2, 12, 12), ring(8, 8, 10, 10).reverse()]));
const ids = features => features.map(f => f.properties.id);
const noop = () => {};

function setup(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "d3");
  globalThis.d3 = d3;
  t.after(() => previous ? Object.defineProperty(globalThis, "d3", previous) : delete globalThis.d3);
  return { landData: land, activeScenarioId: "world", activeScenarioManifest: {}, width: 800, height: 600 };
}

test("effective cities rebind recut hosts after relocation, before capitals, labels and hover", t => {
  const state = setup(t);
  const city = (id, lon, host, population) => point(id, [lon, 5], {
    __city_host_feature_id: host, __city_population: population, __city_base_tier: "major",
    __city_settlement_rank: "metropolis",
  });
  const cities = collection(city("foreign", 17, "former", 9000000), city("inside", 3, "local", 5000000),
    city("moved", 25, "former", 1000000), city("leaver", 4, "local", 2000000), city("stayer", 4.5, "local", 1500000));
  Object.assign(state, { worldCitiesData: cities, showCityPoints: true, zoomTransform: d3.zoomIdentity.scale(10),
    sovereigntyByFeatureId: { local: "AA", former: "AA" }, scenarioCountriesByTag: { AA: {} },
    styleConfig: { cityPoints: { showLabels: true } } });
  const projection = ([x, y]) => [x * 3, y * 3];
  const policy = createUrbanCityPolicyOwner({ state, caches: { cityLayerCache: {}, urbanFeatureIndexCache: { byId: new Map() } }, helpers: {
    ...cityPolicy, getCityFeatureKey: f => f.id, getCityFeatureAliases: f => [f.id],
    getCityAnchor: f => projection(f.geometry.coordinates), isCityAnchorInViewport: () => true,
    getCityScreenPoint: (anchor, transform) => transform.apply(anchor), getCityViewportCenterDistanceNorm: () => 0,
    getCityInterpolatedRevealBucket: (entry, scale) => cityPolicy.getCityRevealBucket(entry, cityPolicy.getCityRevealPhase(scale).id),
  } });
  const markers = createCityPointsRenderOwner({ state, getters: { getProjection: () => projection, getMapSvg: () => ({}) },
    helpers: { ...policy, getPointer: e => e.point } });
  const view = () => markers.getCityLayerRenderState(10, { cacheHoverEntries: true });
  const hover = x => markers.getHoveredCityEntryFromEvent({ point: [30 * x, 150] })?.cityId;
  const original = policy.getEffectiveCityCollection();
  view();
  assert.equal(hover(17), "foreign");
  state.activeScenarioManifest = manifest;
  state.scenarioCityOverridesData = { capitals_by_tag: { AA: "foreign" },
    cities: { moved: { city_id: "moved", lon: 11, lat: 5 }, leaver: { city_id: "leaver", lon: 25, lat: 5 },
      stayer: { city_id: "stayer", lon: 6, lat: 5 } } };
  const effective = policy.getEffectiveCityCollection();
  // A city moved out of the region loses membership even though its old host was a member.
  assert.deepEqual(ids(effective.features), ["inside", "moved", "stayer"]);
  assert.deepEqual(effective.features[2].geometry.coordinates, [6, 5]);
  assert.equal(effective.features[2].properties.__city_host_feature_id, "local");
  assert.deepEqual(ids(effective.features.filter(f => f.properties.__city_is_capital)), ["inside"]);
  assert.equal(effective.features[1].properties.__city_host_feature_id, "local");
  assert.equal(policy.getCityScenarioTag(effective.features[1]), "AA");
  const rendered = view();
  for (const entries of [rendered.markerEntries, rendered.labelEntries]) {
    assert.deepEqual(entries.map(e => e.cityId).sort(), ["inside", "moved", "stayer"]);
  }
  assert.equal(hover(17), undefined);
  assert.equal(hover(11), "moved");
  assert.deepEqual(cities.features[2].geometry.coordinates, [25, 5]);
  state.activeScenarioManifest = {};
  state.scenarioCityOverridesData = null;
  assert.deepEqual(policy.getEffectiveCityCollection(), original);
  view();
  assert.equal(hover(17), "foreign");
});

test("water selection and hits share adjacent, enclosed and era-appropriate lakes", t => {
  const state = setup(t);
  const lake = (id, bounds, props) => polygon(id, [ring(...bounds)], { water_type: "lake", ...props });
  const crossing = lake("crossing", [0, 3, 15, 4]);
  const enclosed = lake("enclosed", [8.2, 8.2, 9.8, 9.8]);
  const remote = lake("remote", [14, 14, 16, 16]);
  const reservoir = lake("future", [4, 4, 5, 5], { year_built: 1960 });
  const sea = polygon("coast", [ring(12, 5, 14, 8)], { water_type: "sea" });
  const baseFeatures = [sea, crossing, enclosed, remote, reservoir];
  const globalLakeFeatures = baseFeatures.slice(1);
  const resolve = (scenarioFeatures = []) => resolveEffectiveWaterRegionFeatures({ baseFeatures, globalLakeFeatures,
    activeScenarioId: state.activeScenarioId, scenarioFeatures, scenarioYear: getScenarioWaterYear(state),
    regionFilter: getRegionalLayerFilter(state) });
  function hit(features, lonLat) {
    const items = features.map(feature => ({ id: feature.properties.id, feature, minX: 0, minY: 0, maxX: 30, maxY: 30 }));
    const owner = createHitTestingOwner({ state: { ...state, showWaterRegions: true, waterSpatialItems: items,
      waterSpatialGrid: new Map(), waterSpatialGridMeta: { cellSize: 50, cols: 1, rows: 1, globals: items } },
      deps: new Proxy({ isWaterRegionEnabled: () => true }, { get: (target, key) => target[key] || noop }) });
    return owner.getWaterHitFromPointer({ px: lonLat[0], py: lonLat[1], lonLat, zoomK: 1 },
      { eventType: "click", enableSnap: false }).id;
  }
  const original = resolve();
  assert.equal(hit(original, [15, 15]), "remote");
  state.activeScenarioManifest = manifest;
  assert.equal(getScenarioWaterYear(state), 1919);
  const historic = lake("crossing", [0, 3, 15, 5], { year_removed: 1960 });
  const regional = resolve([historic]);
  assert.deepEqual(ids(regional), ["coast", "crossing", "enclosed"]);
  assert.equal(hit(regional, [1, 4.5]), "crossing");
  assert.equal(hit(regional, [9, 9]), "enclosed");
  assert.equal(hit(regional, [15, 15]), null);
  state.activeScenarioManifest = {};
  assert.deepEqual(resolve(), original);
});

test("river strokes and hillshade stop at the land boundary and physical labels use their anchors", t => {
  const state = setup(t);
  const river = { type: "Feature", properties: { featurecla: "River", scalerank: 1 },
    geometry: { type: "LineString", coordinates: [[0, 5], [20, 5]] } };
  Object.assign(state, { showRivers: true, riversData: collection(river), showPhysical: true,
    styleConfig: { physical: { showRegionLabels: true, opacity: 1, hillshadeOpacity: 1 }, rivers: { outlineWidth: 0 } },
    contextLayerExternalDataByName: { physical_hillshade: collection(polygon("shade", [ring(0, 0, 20, 10)], { shade: 1 })),
      physical_region_labels: collection(
      point("remote", [13, 5], { name_en: "Outer plain" }), point("local", [6, 5], { name_en: "Inner ridge" })) } });
  let path, clip;
  const strokes = [], fills = [], labels = [], stack = [];
  const samples = () => [1, 6, 14].map(x => !clip || d3.geoContains(clip, [x, 5]));
  const applyPhysicalLandClipMask = () => { clip = getRegionalLandMaskInfo(state)?.collection; };
  const getPathCanvas = () => feature => { path = feature; };
  const context = { beginPath: noop, save: () => stack.push(clip), restore: () => { clip = stack.pop(); },
    setLineDash: noop, stroke: () => {
      assert.equal(path, river);
      strokes.push(samples());
    }, fill: () => fills.push(samples()), measureText: () => ({ width: 2 }), strokeText: noop, fillText: text => labels.push(text) };
  const rivers = createRiverLayerRenderOwner({ state, helpers: { getContext: () => context,
    getPathCanvas, getFeatureCollectionFeatureCount: c => c.features.length, applyPhysicalLandClipMask,
    clamp: (x, min, max) => Math.max(min, Math.min(max, x)), collectContextMetric: noop, nowMs: () => 0,
    pathBoundsInScreen: () => true, getDashPattern: () => [], getSafeCanvasColor: (v, fallback) => v || fallback } });
  const physical = createPhysicalLayerRenderOwner({ state, getters: { getContext: () => context, getPathCanvas,
    getProjection: () => ([x, y]) => [10 * x, 10 * y] }, helpers: { applyPhysicalLandClipMask } });
  const paint = () => {
    labels.length = 0;
    rivers.drawRiversLayer(4);
    physical.drawPhysicalHillshadeLayer(4);
    physical.drawPhysicalRegionLabels(4);
    return { stroke: strokes.at(-1), hillshade: fills.at(-1), labels: [...labels] };
  };
  const original = paint();
  assert.deepEqual(original, { stroke: [true, true, true], hillshade: [true, true, true], labels: ["Outer plain", "Inner ridge"] });
  state.activeScenarioManifest = manifest;
  assert.deepEqual(paint(), { stroke: [false, true, false], hillshade: [false, true, false], labels: ["Inner ridge"] });
  state.activeScenarioManifest = {};
  assert.deepEqual(paint(), original);
});

test("wrapped regions find members on both sides of the dateline and drop replaced geometry", t => {
  const state = setup(t);
  state.activeScenarioManifest = { region: { bounds: [160, 0, -160, 30] } };
  state.landData = collection(polygon("coast", [ring(175, 0, -177, 10)]));
  const filter = getRegionalLayerFilter(state);
  assert.equal(filter.hostAt([178, 5]), "coast");
  assert.equal(filter.hostAt([-179, 5]), "coast");
  assert.equal(filter.hostAt([0, 5]), "");
  assert.equal(filter.includesWater(polygon("sea", [ring(-178, 5, -172, 8)])), true);
  state.landData = collection();
  assert.equal(getRegionalLayerFilter(state).hostAt([-179, 5]), "");
});

test("water membership follows the great-circle edges of long parcel borders", t => {
  const state = setup(t);
  state.activeScenarioManifest = { region: { bounds: [-10, 30, 40, 70] } };
  state.landData = collection(polygon("wide", [ring(0, 40, 30, 60)]));
  const filter = getRegionalLayerFilter(state);
  // The northern edge bows poleward to about 60.85° at mid-span.
  assert.equal(filter.hostAt([15, 60.4]), "wide");
  assert.equal(filter.includesWater(polygon("inner-lake", [ring(14, 60.3, 16, 60.5)])), true);
  assert.equal(filter.hostAt([15, 61.5]), "");
  assert.equal(filter.includesWater(polygon("outer-lake", [ring(14, 61.4, 16, 61.6)])), false);
  // The southern edge bows poleward too, so a lake just above 40° at mid-span lies outside.
  assert.equal(filter.hostAt([15, 40.3]), "");
  assert.equal(filter.includesWater(polygon("south-lake", [ring(14.5, 40.2, 15.5, 40.4)])), false);
});

test("scenario refresh publishes only selectable regional waters and clears a foreign selection", t => {
  setup(t);
  const saved = Object.getOwnPropertyDescriptors(mapState);
  const previous = Object.getOwnPropertyDescriptor(globalThis, "topojson");
  globalThis.topojson = require("../vendor/topojson-client.min.js");
  t.after(() => {
    for (const key of Object.keys(mapState)) if (!Object.hasOwn(saved, key)) delete mapState[key];
    Object.defineProperties(mapState, saved);
    if (previous) Object.defineProperty(globalThis, "topojson", previous);
    else delete globalThis.topojson;
  });
  const topology = { type: "Topology", arcs: [ring(2, 2, 12, 12)], objects: {
    political: { type: "GeometryCollection", geometries: [{ type: "Polygon", arcs: [[0]], properties: { id: "local", cntr_code: "AA" } }] },
  } };
  const lakes = collection(polygon("border", [ring(1, 5, 3, 6)], { water_type: "lake" }),
    polygon("foreign", [ring(14, 14, 16, 16)], { water_type: "lake" }),
    polygon("reservoir", [ring(4, 4, 6, 6)], { water_type: "lake", year_built: 1950 }));
  Object.assign(mapState, { topology, topologyPrimary: topology, scenarioRuntimeTopologyData: topology,
    topologyBundleMode: "single", activeScenarioId: "world", activeScenarioManifest: {},
    styleConfig: { ...mapState.styleConfig, lakes: { interactive: true } },
    contextLayerExternalDataByName: { lakes } });
  const refresh = () => {
    refreshMapDataForScenarioApply({ suppressRender: true });
    return [...mapState.waterRegionsById.keys()];
  };
  const initial = refresh();
  assert.deepEqual(initial, ["border", "foreign", "reservoir"]);
  mapState.selectedWaterRegionId = "foreign";
  mapState.activeScenarioId = "regional";
  mapState.activeScenarioManifest = manifest;
  assert.deepEqual(refresh(), ["border"]);
  assert.equal(mapState.selectedWaterRegionId, "");
  mapState.activeScenarioId = "world";
  mapState.activeScenarioManifest = {};
  assert.deepEqual(refresh(), initial);
});
