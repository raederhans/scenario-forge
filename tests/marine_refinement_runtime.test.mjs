import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
const topojson = require("../vendor/topojson-client.min.js");
const d3 = require("../vendor/d3.v7.min.js");
const read = (path) => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), "utf8"));
const wave6Waters = read("./fixtures/ocean_wave6_probes.json");
const wave7Waters = read("./fixtures/ocean_wave7_probes.json");
const acceptedWaveWaters = [...wave6Waters, ...wave7Waters];

function assertWaveMetadata(byId, prefix, context, rows, { requireParents = true } = {}) {
  for (const row of rows) {
    const id = `${prefix}_${row.slug}`;
    const entry = byId.get(id);
    assert.ok(entry, `${context}: missing ${id}`);
    assert.equal(entry.properties.name, row.name, `${context}: ${id} name`);
    assert.equal(entry.properties.water_type, row.waterType, `${context}: ${id} type`);
    assert.equal(entry.properties.region_group, row.regionGroup, `${context}: ${id} group`);
    const parentId = row.parentSlug ? `${prefix}_${row.parentSlug}` : "";
    assert.equal(entry.properties.parent_id, parentId, `${context}: ${id} parent`);
    assert.equal(entry.properties.source_standard, row.sourceStandard, `${context}: ${id} standard`);
    if (parentId && requireParents) assert.ok(byId.has(parentId), `${context}: missing parent ${parentId}`);
  }
}

const assertWave6Metadata = (byId, prefix, context) =>
  assertWaveMetadata(byId, prefix, context, wave6Waters);
const assertWave7Metadata = (byId, prefix, context, options) =>
  assertWaveMetadata(byId, prefix, context, wave7Waters, options);

test("wave 6 named waters preserve their frozen identities and hierarchy", () => {
  assert.equal(wave6Waters.length, 37);
  assert.equal(new Set(wave6Waters.map((row) => row.slug)).size, 37);
  assert.equal(wave6Waters.filter((row) => row.regionGroup === "marine_detail").length, 4);
  assert.equal(wave6Waters.filter((row) => row.sourceLayer === "world_bay_gulf").length, 27);
});

test("wave 7 accepted waters preserve source identities and canonical hierarchy", () => {
  assert.equal(wave7Waters.length, 46);
  assert.equal(new Set(wave7Waters.map((row) => row.slug)).size, 46);
  assert.equal(new Set(acceptedWaveWaters.map((row) => row.slug)).size, 83);
  assert.equal(wave7Waters.filter((row) => row.regionGroup === "marine_detail").length, 7);
  assert.equal(wave7Waters.filter((row) => row.sourceLayer === "world_bay_gulf").length, 46);
  assert.equal(wave7Waters.filter((row) => row.sourceSimplifyDegrees === 0.0005).length, 8);
  assert.ok(wave7Waters.every((row) => row.sourceFeatureCount > 0 && row.oceanClipIds.length > 0));

  for (const [file, count, prefix, checkSource] of [
    ["../data/marine_regions.additional.source.geojson", 98 + wave7Waters.length, "marine", true],
    ["../data/marine_regions.refined.source.geojson", 207 + wave7Waters.length, "marine", true],
    ["../data/water_regions.geojson", 246 + wave7Waters.length, "marine", true],
    ["../data/scenarios/tno_1962/water_regions.geojson", 239 + wave7Waters.length, "tno", false],
  ]) {
    const features = read(file).features;
    const byId = new Map(features.map((entry) => [entry.properties.id, entry]));
    assert.equal(features.length, count, file);
    assert.equal(byId.size, count, `${file}: unique IDs`);
    assertWave7Metadata(byId, prefix, file, {
      requireParents: !file.endsWith("marine_regions.additional.source.geojson"),
    });
    // Additional/shared sources do not contain every old named parent.
    if (file.includes(".source.geojson")) {
      for (const row of acceptedWaveWaters) {
        const entry = byId.get(`marine_${row.slug}`);
        assert.ok(entry, `${file}: missing ${row.slug}`);
        assert.equal(entry.properties.region_group, row.regionGroup, `${file}: ${row.slug}`);
        assert.equal(entry.properties.parent_id, row.parentSlug ? `marine_${row.parentSlug}` : "", `${file}: ${row.slug}`);
      }
    } else {
      assertWave6Metadata(byId, prefix, file);
    }
    if (checkSource) {
      for (const row of acceptedWaveWaters) {
        const props = byId.get(`marine_${row.slug}`).properties;
        assert.equal(props.name, row.name, `${file}: ${row.slug}`);
        assert.equal(props.water_type, row.waterType, `${file}: ${row.slug}`);
        assert.equal(props.source_standard, row.sourceStandard, `${file}: ${row.slug}`);
        assert.equal(props.source_layer, row.sourceLayer, `${file}: ${row.slug}`);
        assert.equal(props.source_query, row.sourceQuery, `${file}: ${row.slug}`);
        assert.ok(props.source_record_ids.includes(row.sourceRecordId), `${file}: ${row.slug} source record`);
      }
      if (file.endsWith("marine_regions.additional.source.geojson")) {
        for (const row of wave7Waters) {
          const props = byId.get(`marine_${row.slug}`).properties;
          assert.equal(props.source_feature_count, row.sourceFeatureCount, `${file}: ${row.slug} source feature count`);
          assert.equal(props.source_simplify_degrees, row.sourceSimplifyDegrees, `${file}: ${row.slug} source simplification`);
        }
      }
    }
  }
});

test("wave 6 and 7 named waters keep local spherical areas and exclude details from their parents", () => {
  for (const [file, objectName, prefix, count] of [
    ["../data/europe_topology.json", "water_regions", "marine", 246 + wave7Waters.length],
    ["../data/europe_topology.na_v2.json", "water_regions", "marine", 246 + wave7Waters.length],
    ["../data/scenarios/tno_1962/runtime_topology.topo.json", "scenario_water", "tno", 239 + wave7Waters.length],
  ]) {
    const topology = read(file);
    const water = topojson.feature(topology, topology.objects[objectName]).features;
    const byId = new Map(water.map((entry) => [entry.properties.id, entry]));
    assert.equal(water.length, count, file);
    assertWave6Metadata(byId, prefix, file);
    assertWave7Metadata(byId, prefix, file);
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

const expansionProbes = [
  ["marine_kara_sea", [70, 75]],
  ["marine_laptev_sea", [125, 76]],
  ["marine_east_siberian_sea", [160, 72]],
  ["marine_chukchi_sea", [-170, 69]],
  ["marine_chukchi_sea", [179, 70]],
  ["marine_bering_strait", [-168.8, 65.8]],
  ["marine_strait_of_hormuz", [56.3, 26.6]],
];
const additionalProbes = [
  ["marine_bay_of_fundy", [-65.9565, 45.0306]],
  ["marine_gulf_of_maine", [-68.3599, 43.1895]],
  ["marine_rio_de_la_plata", [-57.4362, -34.71908]],
  ["marine_davis_strait", [-57.87665, 64.98225]],
  ["marine_gulf_of_panama", [-79.79254, 8.25514]],
  ["marine_gulf_of_california", [-111.4503, 27.37862]],
  ["marine_coastal_waters_of_southeast_alaska_and_british_columbia", [-131.07971, 53.36571]],
  ["marine_solomon_sea", [152.2479, -8.0172]],
  ["marine_bismarck_sea", [147.7107, -3.3874]],
  ["marine_riiser_larsen_sea", [24.177567, -67.624884]],
  ["marine_cooperation_sea", [74.150565, -67.233897]],
  ["marine_davis_sea", [95.001421, -64.661885]],
  ["marine_lazarev_sea", [3.547863, -67.575378]],
  ["marine_cosmonauts_sea", [37.328299, -67.261725]],
  ["marine_bellingshausen_sea", [-79.755286, -70.359588]],
  ["marine_amundsen_sea", [-106.253629, -73.12257]],
  ["marine_mawson_sea", [108.88711, -65.372187]],
  ["marine_dumont_durville_sea", [144.608664, -65.495982]],
  ["marine_somov_sea", [161.289037, -68.06758]],
  ["marine_white_sea", [42.906271, 67.658248]],
  ["marine_iceland_sea", [-11.23928, 67.57079]],
  ["marine_lincoln_sea", [-52.277912, 82.786277]],
  ["marine_gulf_of_mannar", [78.873752, 8.098401]],
  ["marine_palk_strait_and_palk_bay", [79.589502, 9.956368]],
  ["marine_lakshadweep_sea", [76.289919, 5.660971]],
  ["marine_bransfield_strait", [-55.884628, -62.258402]],
  ["marine_drake_passage", [-61.814093, -59.590098]],
  ["marine_tryoshnikova_gulf", [94.345128, -65.939219]],
  ...wave7Waters.map((row) => [`marine_${row.slug}`, row.point]),
];
const wave4Slugs = [
  "white_sea", "iceland_sea", "lincoln_sea", "gulf_of_mannar", "palk_strait_and_palk_bay",
  "lakshadweep_sea", "bransfield_strait", "drake_passage", "tryoshnikova_gulf",
];
const protectedSouthernSeaProbes = [
  ["marine_ross_sea", [-169, -74.8]],
  ["marine_weddell_sea", [-37, -68.8]],
  ["marine_scotia_sea", [-43.4, -57.1]],
];
const probes = [
  ...expansionProbes,
  ...additionalProbes,
  ...protectedSouthernSeaProbes,
  ["marine_bo_hai", [119.3, 38.5]],
  ["marine_taiwan_strait", [119.6, 24]],
  ["marine_flores_sea", [119.3, -7.1]],
  ["marine_bali_sea", [115, -7.5]],
  ["marine_florida_strait", [-80.5, 24]],
  ["marine_northeast_atlantic_ocean", [-30, 30]],
  ["marine_southeast_pacific_ocean", [-110, -30]],
];
const protectedBaseSeamProbes = [
  // The source Alaska polygon overlaps Salish Sea; the named local sea owns this interior.
  ["marine_salish_sea", [-122.918513, 48.804661]],
  // Davis Strait's source footprint overlaps Hudson Strait; Hudson keeps this interior.
  ["marine_hudson_strait", [-65.307433, 61.520821]],
];
const protectedTnoSeamProbes = [
  // This point lies in the overlap of the Davis source polygon and TNO Hudson Strait.
  ["tno_hudson_strait", [-65.286139, 61.517149]],
];
const northSeaDetails = [
  { slug: "dornoch_firth", waterType: "channel", point: [-3.912293956280313, 57.90968620512397], land: [-3.947792441632354, 57.982585740643565] },
  { slug: "firth_of_tay", waterType: "channel", point: [-3.0741913345063456, 56.426683599211486], land: [-3.065318591483891, 56.399083973451475] },
  { slug: "tees_bay", waterType: "bay", point: [-1.1667179279440574, 54.66552974268499], land: [-1.1945051423223239, 54.67705442700283] },
  { slug: "bridlington_bay", waterType: "bay", point: [-0.11685520303616029, 53.99902297420898], land: [-0.1706854670007638, 54.07344290831883] },
  { slug: "westray_firth", waterType: "channel", point: [-3.0207864977734378, 59.22873594667968], land: [-3.0007864977734378, 59.308735946679676] },
  { slug: "stronsay_firth", waterType: "channel", point: [-2.7444210914167813, 59.0420697540752], land: [-2.8093480577799403, 58.98809069906988] },
  { slug: "scapa_flow", waterType: "bay", point: [-3.0289193163085937, 58.88811042794921], land: [-3.045190842201188, 58.95559621358031] },
  { slug: "yell_sound", waterType: "channel", point: [-1.2419149839117443, 60.613799467494026], land: [-1.1601170117011657, 60.613799467494026] },
];
const protectedNorthSeaDetailProbes = [
  ["firth_of_forth", [-3.05, 56.0]],
  ["moray_firth", [-3.44, 57.75]],
  ["pentland_firth", [-3.02, 58.75]],
];

test("North Sea details keep their parents, unique D3 interiors and nearby land in all three topologies", () => {
  for (const [file, objectName, landObject, prefix] of [
    ["../data/europe_topology.json", "water_regions", "land", "marine"],
    ["../data/europe_topology.na_v2.json", "water_regions", "land", "marine"],
    ["../data/scenarios/tno_1962/runtime_topology.topo.json", "scenario_water", "land_mask", "tno"],
  ]) {
    const topology = read(file);
    const water = topojson.feature(topology, topology.objects[objectName]).features;
    const land = topojson.feature(topology, topology.objects[landObject]);
    const byId = new Map(water.map((entry) => [entry.properties.id, entry]));
    const parentId = `${prefix}_north_sea`;
    const parent = byId.get(parentId);
    assert.ok(parent, `${file}: North Sea parent must remain available`);
    const hitIds = (point) => water.filter((entry) => d3.geoContains(entry, point)).map((entry) => entry.properties.id).sort();
    for (const { slug, waterType, point, land: landPoint } of northSeaDetails) {
      const id = `${prefix}_${slug}`;
      const entry = byId.get(id);
      assert.ok(entry, `${file}: missing North Sea detail ${id}`);
      assert.equal(entry.properties.region_group, "marine_detail", `${file}: ${id}`);
      assert.equal(entry.properties.parent_id, parentId, `${file}: ${id}`);
      assert.equal(entry.properties.water_type, waterType, `${file}: ${id}`);
      const area = d3.geoArea(entry);
      assert.ok(Number.isFinite(area) && area > 0 && area < 2 * Math.PI, `${file}: ${id} must have valid local spherical area`);
      assert.deepEqual(hitIds(point), [id], `${file}: ${id} must own its interior exactly once`);
      assert.equal(d3.geoContains(parent, point), false, `${file}: North Sea must exclude child ${id}`);
      assert.equal(d3.geoContains(land, point), false, `${file}: ${id} interior must remain offshore`);
      assert.equal(d3.geoContains(land, landPoint), true, `${file}: land near ${id} must stay land`);
      assert.deepEqual(hitIds(landPoint), [], `${file}: land near ${id} must not become selectable water`);
    }
    for (const [slug, point] of protectedNorthSeaDetailProbes) {
      const id = `${prefix}_${slug}`;
      assert.deepEqual(hitIds(point), [id], `${file}: existing ${id} interior must remain assigned`);
      assert.equal(byId.get(id).properties.region_group, "marine_detail", `${file}: ${id}`);
      assert.equal(byId.get(id).properties.parent_id, parentId, `${file}: ${id}`);
    }
  }
});

test("shared refinements have unique interior membership in both published base topologies", () => {
  for (const file of ["../data/europe_topology.json", "../data/europe_topology.na_v2.json"]) {
    const topology = read(file);
    const water = topojson.feature(topology, topology.objects.water_regions).features;
    for (const [id, point] of probes) {
      const hits = water.filter((f) => d3.geoContains(f, point)).map((f) => f.properties.id).sort();
      assert.deepEqual(hits, [id], `${file}: ${id} must be selectable exactly once at ${point}`);
    }
    for (const [id, point] of protectedBaseSeamProbes) {
      const hits = water.filter((f) => d3.geoContains(f, point)).map((f) => f.properties.id).sort();
      assert.deepEqual(hits, [id], `${file}: the protected seam interior at ${point} must remain assigned to ${id}`);
    }
    // The nearby Chukotka coast stays land while the date-line sea remains selectable.
    assert.equal(d3.geoContains(topojson.feature(topology, topology.objects.land), [179, 69]), true);
    assert.deepEqual(water.filter((f) => d3.geoContains(f, [179, 69])).map((f) => f.properties.id), []);
    const byId = new Map(water.map((f) => [f.properties.id, f]));
    assert.ok(water.filter((f) => f.properties.parent_id && f.properties.water_type === "ocean").every((f) => f.properties.interactive === true));
    for (const id of ["marine_atlantic_ocean", "marine_pacific_ocean", "marine_indian_ocean", "marine_arctic_ocean", "marine_southern_ocean"]) {
      assert.ok(byId.has(id), `saved-project ID ${id} must remain available`);
    }
    assert.equal(byId.get("marine_bo_hai").properties.parent_id, "marine_yellow_sea");
    assert.equal(byId.get("marine_liaodong_wan").properties.parent_id, "marine_bo_hai");
    assert.equal(byId.get("marine_northeast_atlantic_ocean").properties.parent_id, "marine_atlantic_ocean");
    for (const slug of wave4Slugs) {
      assert.equal(byId.get(`marine_${slug}`).properties.region_group, "marine_macro", slug);
      assert.equal(byId.get(`marine_${slug}`).properties.parent_id, "", slug);
    }
    const gulf = byId.get("marine_tryoshnikova_gulf");
    assert.equal(gulf.properties.water_type, "gulf");
  }
});

test("new ordinary seas reach TNO while preserving existing Southern Ocean sea identities", () => {
  const t = read("../data/scenarios/tno_1962/runtime_topology.topo.json");
  const water = topojson.feature(t, t.objects.scenario_water).features;
  for (const [id, point] of [
    ...expansionProbes,
    ...additionalProbes,
    ...protectedSouthernSeaProbes.map(([id, point]) => [id.replace("marine_", "tno_"), point]),
    ...probes.filter(([id]) => /flores|bali|florida/.test(id)),
  ]) {
    assert.deepEqual(water.filter((f) => d3.geoContains(f, point)).map((f) => f.properties.id), [id.replace("marine_", "tno_")]);
  }
  for (const [id, point] of protectedTnoSeamProbes) {
    assert.deepEqual(water.filter((f) => d3.geoContains(f, point)).map((f) => f.properties.id), [id]);
  }
  assert.deepEqual(water.filter((f) => d3.geoContains(f, [-30, 30])).map((f) => f.properties.id), ["tno_northeast_atlantic_ocean"]);
  assert.equal(water.filter((f) => f.properties.region_group === "ocean_macro").length, 20);
  const byId = new Map(water.map((f) => [f.properties.id, f]));
  for (const slug of wave4Slugs) {
    assert.equal(byId.get(`tno_${slug}`).properties.region_group, "marine_macro", slug);
    assert.equal(byId.get(`tno_${slug}`).properties.parent_id, "", slug);
  }
  const gulf = water.find((f) => f.properties.id === "tno_tryoshnikova_gulf");
  assert.equal(gulf.properties.water_type, "gulf");
});
