import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { normalizeBathymetryFeatureCollection } from "../js/core/renderer/bathymetry_geometry.js";

const vendor = vm.createContext({});
for (const file of ["d3.v7.min.js", "topojson-client.min.js"]) {
  vm.runInContext(fs.readFileSync(new URL(`../vendor/${file}`, import.meta.url), "utf8"), vendor);
}
const { d3, topojson } = vendor;
const topology = JSON.parse(fs.readFileSync(new URL("../data/global_bathymetry.topo.json", import.meta.url), "utf8"));
const decoded = topojson.feature(topology, topology.objects.bathymetry_bands);
const normalized = normalizeBathymetryFeatureCollection(decoded, d3);
const bands = normalized.collection.features.map(feature => ({ feature, bounds: d3.geoBounds(feature) }));
function bandsAt(point, entries = bands) {
  const [lon, lat] = point;
  return entries.filter(({ feature, bounds: [[west, south], [east, north]] }) =>
    lat >= south && lat <= north
    && (west <= east ? lon >= west && lon <= east : lon >= west || lon <= east)
    && d3.geoContains(feature, point)).map(({ feature }) => feature);
}

test("expanded ocean bands remain valid local spherical geometry", () => {
  assert.ok(decoded.features.some(f => f.properties.asset_origin === "global_marine_120s_v1"));
  assert.equal(normalized.diagnostics.rejectedPolygonCount, 0, JSON.stringify(normalized.diagnostics.issues.slice(0, 8)));
  assert.equal(normalized.collection.features.length, decoded.features.length);
  for (const { feature } of bands) {
    const area = d3.geoArea(feature);
    assert.ok(area > 0 && area < 2 * Math.PI, `non-local band: ${feature.properties.tile_key || feature.id}`);
  }
});

test("overview retains major ocean coverage with fewer coordinates and valid spherical rings", () => {
  const overview = topojson.feature(topology, topology.objects.bathymetry_bands_overview);
  const result = normalizeBathymetryFeatureCollection(overview, d3);
  assert.equal(result.diagnostics.rejectedPolygonCount, 0, JSON.stringify(result.diagnostics.issues.slice(0, 8)));
  assert.equal(result.collection.features.length, overview.features.length);
  const entries = result.collection.features.map(feature => ({ feature, bounds: d3.geoBounds(feature) }));
  for (const point of [[-60,25], [-40,30], [160,10], [-179.5,-20], [179.5,-20], [75,-25], [88,12], [65,15], [38,19.98], [38,20], [38,20.02], [-150,29.98], [-150,30], [-150,30.02], [0,-65], [0,85], [0,89]]) {
    assert.ok(bandsAt(point, entries).length, `overview coverage missing at ${point}`);
  }
  const count = coordinates => typeof coordinates[0] === "number" ? 1
    : coordinates.reduce((sum, child) => sum + count(child), 0);
  const total = collection => collection.features.reduce((sum, f) => sum + count(f.geometry.coordinates), 0);
  assert.ok(total(overview) < total(decoded) * 0.65, "overview should materially reduce vertex processing");
  const overviewLines = topojson.feature(topology, topology.objects.bathymetry_contours_overview);
  assert.ok(overviewLines.features.some(f => Math.abs(f.properties.depth_m) === 6000));
});

test("all major oceans and marginal sea probes have real depth bands", () => {
  for (const [name, point] of [
    ["North Atlantic", [-40, 30]], ["South Atlantic", [-15, -30]],
    ["equatorial Atlantic", [-25, 0]], ["North Pacific", [-150, 30]],
    ["South Pacific", [-130, -30]], ["western Pacific", [160, 10]],
    ["eastern Pacific", [-110, 0]], ["Sea of Japan", [135, 40]],
    ["Caribbean", [-75, 15]], ["east of dateline", [-179.5, -20]],
    ["Sargasso Sea", [-60, 25]],
    ["west of dateline", [179.5, -20]],
    ["Indian Ocean", [75, -25]], ["Bay of Bengal", [88, 12]],
    ["Arabian Sea", [65, 15]], ["Red Sea", [38, 20]],
    ["Red Sea south of seam", [38, 19.98]], ["Red Sea north of seam", [38, 20.02]],
    ["North Pacific south of seam", [-150, 29.98]], ["North Pacific north of seam", [-150, 30.02]],
    ["Southern Ocean", [0, -65]], ["Arctic Ocean", [0, 85]],
    ["near North Pole", [0, 89]],
  ]) {
    assert.ok(bandsAt(point).length, `${name} has no rendered depth coverage at ${point}`);
  }
  assert.ok(bandsAt([142.2, 11.35]).some(f => Math.abs(f.properties.depth_max_m) > 6000),
    "Mariana trench must not fall through the old 6000 m cutoff");
});

test("ocean expansion excludes negative land elevations and inland waters", () => {
  for (const [name, point] of [
    ["Dead Sea", [35.5, 31.5]], ["Caspian Sea", [50, 42]],
    ["Qattara Depression", [26.5, 30]], ["continental interior", [-65, -5]],
  ]) assert.equal(bandsAt(point).filter(f => f.properties.asset_origin === "global_marine_120s_v1").length,
    0, `${name} must not receive expanded marine depth bands`);
});

test("generated contour fragments and cutlines do not manufacture dateline strokes", () => {
  const contours = topojson.feature(topology, topology.objects.bathymetry_contours);
  const expanded = contours.features.filter(f => f.properties.asset_origin === "global_marine_120s_v1");
  assert.ok(expanded.some(f => Math.abs(f.properties.depth_m) === 6000));
  for (const feature of expanded) {
    assert.ok(feature.properties.tile_key);
    const lines = feature.geometry.type === "LineString" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    for (const line of lines) for (let i = 1; i < line.length; i += 1) {
      assert.ok(Math.abs(line[i][0] - line[i - 1][0]) < 180, "contour must not bridge the world");
      assert.ok(!(Math.abs(line[i][0]) > 179.999 && Math.abs(line[i - 1][0]) > 179.999),
        "dateline clipping edge must not be a depth contour");
    }
  }
  for (const line of topology.bathymetry_clip_edges?.coordinates || []) {
    assert.ok(!line.every(point => Math.abs(point[0]) > 179.999), "date line is not a coverage cutline");
  }
});
