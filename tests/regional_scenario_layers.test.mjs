import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createUrbanCityPolicyOwner } from "../js/core/renderer/urban_city_policy.js";
import { createCityPointsRenderOwner } from "../js/core/renderer/city_points_render_owner.js";
import * as cityPolicy from "../js/core/renderer/city_reveal_policy.js";
import { getRegionalLayerFilter } from "../js/core/renderer/regional_layer_filter.js";

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
