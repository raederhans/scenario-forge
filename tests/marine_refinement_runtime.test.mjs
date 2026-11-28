import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { readJsonSource } from "./helpers/read_json_source.mjs";
const require = createRequire(import.meta.url);
const topojson = require("../vendor/topojson-client.min.js");
const d3 = require("../vendor/d3.v7.min.js");
const read = (path) => path.includes("/runtime_topology.topo.json")
  ? readJsonSource(new URL(path, import.meta.url))
  : JSON.parse(fs.readFileSync(new URL(path, import.meta.url), "utf8"));
const wave6Waters = read("./fixtures/ocean_wave6_probes.json");
const wave7Waters = read("./fixtures/ocean_wave7_probes.json");
const acceptedWaveWaters = [...wave6Waters, ...wave7Waters];

test("wave 6 and 7 named waters keep local spherical areas and exclude details from their parents", () => {
  for (const [file, objectName, prefix] of [
    ["../data/europe_topology.json", "water_regions", "marine"],
    ["../data/europe_topology.na_v2.json", "water_regions", "marine"],
    ["../data/scenarios/tno_1962/runtime_topology.topo.json", "scenario_water", "tno"],
  ]) {
    const topology = read(file);
    const water = topojson.feature(topology, topology.objects[objectName]).features;
    const byId = new Map(water.map((entry) => [entry.properties.id, entry]));
    for (const row of acceptedWaveWaters) {
      const id = `${prefix}_${row.slug}`;
      const area = d3.geoArea(byId.get(id));
      assert.ok(Number.isFinite(area) && area > 0 && area < 2 * Math.PI, `${file}: ${id} local spherical area`);
      if (row.parentSlug) {
        assert.equal(d3.geoContains(byId.get(`${prefix}_${row.parentSlug}`), row.point), false, `${file}: parent must exclude ${id}`);
      }
    }
  }
});

const northSeaDetails = [
  { slug: "dornoch_firth", point: [-3.912293956280313, 57.90968620512397] },
  { slug: "firth_of_tay", point: [-3.0741913345063456, 56.426683599211486] },
  { slug: "tees_bay", point: [-1.1667179279440574, 54.66552974268499] },
  { slug: "bridlington_bay", point: [-0.11685520303616029, 53.99902297420898] },
  { slug: "westray_firth", point: [-3.0207864977734378, 59.22873594667968] },
  { slug: "stronsay_firth", point: [-2.7444210914167813, 59.0420697540752] },
  { slug: "scapa_flow", point: [-3.0289193163085937, 58.88811042794921] },
  { slug: "yell_sound", point: [-1.2419149839117443, 60.613799467494026] },
];
const protectedNorthSeaDetailProbes = [
  ["firth_of_forth", [-3.05, 56.0]],
  ["moray_firth", [-3.44, 57.75]],
  ["pentland_firth", [-3.02, 58.75]],
];

test("North Sea details keep their parents, unique D3 interiors in all three topologies", () => {
  for (const [file, objectName, prefix] of [
    ["../data/europe_topology.json", "water_regions", "marine"],
    ["../data/europe_topology.na_v2.json", "water_regions", "marine"],
    ["../data/scenarios/tno_1962/runtime_topology.topo.json", "scenario_water", "tno"],
  ]) {
    const topology = read(file);
    const water = topojson.feature(topology, topology.objects[objectName]).features;
    const byId = new Map(water.map((entry) => [entry.properties.id, entry]));
    const parentId = `${prefix}_north_sea`;
    const parent = byId.get(parentId);
    assert.ok(parent, `${file}: North Sea parent must remain available`);
    const hitIds = (point) => water.filter((entry) => d3.geoContains(entry, point)).map((entry) => entry.properties.id).sort();
    for (const { slug, point } of northSeaDetails) {
      const id = `${prefix}_${slug}`;
      const entry = byId.get(id);
      assert.ok(entry, `${file}: missing North Sea detail ${id}`);
      assert.equal(entry.properties.parent_id, parentId, `${file}: ${id}`);
      const area = d3.geoArea(entry);
      assert.ok(Number.isFinite(area) && area > 0 && area < 2 * Math.PI, `${file}: ${id} must have valid local spherical area`);
      assert.deepEqual(hitIds(point), [id], `${file}: ${id} must own its interior exactly once`);
      assert.equal(d3.geoContains(parent, point), false, `${file}: North Sea must exclude child ${id}`);
    }
    for (const [slug, point] of protectedNorthSeaDetailProbes) {
      const id = `${prefix}_${slug}`;
      assert.deepEqual(hitIds(point), [id], `${file}: existing ${id} interior must remain assigned`);
    }
  }
});
