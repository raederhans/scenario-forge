import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
const topojson = require("../vendor/topojson-client.min.js");
const d3 = require("../vendor/d3.v7.min.js");
const read = (path) => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), "utf8"));

const probes = [
  ["marine_bo_hai", [119.3, 38.5]],
  ["marine_taiwan_strait", [119.6, 24]],
  ["marine_flores_sea", [119.3, -7.1]],
  ["marine_bali_sea", [115, -7.5]],
  ["marine_florida_strait", [-80.5, 24]],
  ["marine_northeast_atlantic_ocean", [-30, 30]],
  ["marine_southeast_pacific_ocean", [-110, -30]],
];

test("shared refinements have unique interior membership in both published base topologies", () => {
  for (const file of ["../data/europe_topology.json", "../data/europe_topology.na_v2.json"]) {
    const topology = read(file);
    const water = topojson.feature(topology, topology.objects.water_regions).features;
    for (const [id, point] of probes) {
      const hits = water.filter((f) => d3.geoContains(f, point)).map((f) => f.properties.id).sort();
      assert.deepEqual(hits, [id], `${file}: ${id} must be selectable exactly once at ${point}`);
    }
    const byId = new Map(water.map((f) => [f.properties.id, f]));
    assert.ok(water.filter((f) => f.properties.parent_id && f.properties.water_type === "ocean").every((f) => f.properties.interactive === true));
    for (const id of ["marine_atlantic_ocean", "marine_pacific_ocean", "marine_indian_ocean", "marine_arctic_ocean", "marine_southern_ocean"]) {
      assert.ok(byId.has(id), `saved-project ID ${id} must remain available`);
    }
    assert.equal(byId.get("marine_bo_hai").properties.parent_id, "marine_yellow_sea");
    assert.equal(byId.get("marine_liaodong_wan").properties.parent_id, "marine_bo_hai");
    assert.equal(byId.get("marine_northeast_atlantic_ocean").properties.parent_id, "marine_atlantic_ocean");
  }
});

test("new ordinary sea polygons reach TNO without replacing its existing ocean sector identity", () => {
  const t = read("../data/scenarios/tno_1962/runtime_topology.topo.json");
  const water = topojson.feature(t, t.objects.scenario_water).features;
  for (const [id, point] of probes.filter(([id]) => /flores|bali|florida/.test(id))) {
    assert.deepEqual(water.filter((f) => d3.geoContains(f, point)).map((f) => f.properties.id), [id.replace("marine_", "tno_")]);
  }
  assert.deepEqual(water.filter((f) => d3.geoContains(f, [-30, 30])).map((f) => f.properties.id), ["tno_northeast_atlantic_ocean"]);
  assert.equal(water.filter((f) => f.properties.region_group === "ocean_macro").length, 20);
});
