import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

// Applied plans are materialized by tools/apply_political_feature_merges.py.
// Any upstream rebuild that restores a merged-away runtime ID must re-run it.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const planDir = path.join(root, "data/political_feature_merges");
const plans = fs.readdirSync(planDir).filter(name => /\.v\d+\.json$/.test(name))
  .map(name => JSON.parse(fs.readFileSync(path.join(planDir, name), "utf8")));
const groups = plans.flatMap(plan => plan.groups);
const memberIds = groups.flatMap(group => group.member_ids);
const memberPattern = new RegExp(`"(?:id::)?(${memberIds.map(id => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})"`);
const scenarios = ["blank_base", "hoi4_1936", "hoi4_1939", "modern_world", "tno_1962"];
const globalAssets = [
  "europe_topology.na_v2.json", "europe_topology.runtime_political_v1.json", "hierarchy.json", "locales.json",
  "geo_aliases.json", "country_feature_policies.json", "quick_fill", "world_cities.geojson", "europe_urban.geojson",
  "releasables/hoi4_vanilla.internal.phase1.catalog.json", "releasables/tno_1962.internal.phase1.catalog.json",
  "thematic_layers/population/ghsl_population_2020_v1/features", "river_partitions",
];
// Shipped product content outside data/ that is keyed by political feature IDs.
const publicAssets = ["landing/assets/sample-projects"];
// Provenance written before the merge; not read by the runtime.
const provenance = [/\/derived\//, /\/audit\.json$/, /\/build_snapshot\.json$/];

function readText(file) {
  const bytes = fs.readFileSync(file);
  return (file.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString("utf8");
}

function listJson(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  return fs.readdirSync(target, { recursive: true }).map(name => path.join(target, name))
    .filter(file => /\.(json|geojson)(\.gz)?$|\.pidr\.gz$/.test(file) && fs.statSync(file).isFile());
}

test("merge plan groups are disjoint, contiguous candidates with bilingual names", () => {
  assert.ok(plans.length >= 2);
  assert.equal(new Set(memberIds).size, memberIds.length);
  for (const group of groups) {
    assert.match(group.id, /^[A-Z]{2}_MRG_[0-9a-f]{12}$/);
    assert.ok(group.member_ids.length >= 2 && group.member_ids.every(id => id.startsWith(group.id.slice(0, 2))));
    assert.ok(group.names.en && group.names.zh);
  }
});

test("runtime assets contain no merged-away political feature IDs", () => {
  const files = [
    ...globalAssets.flatMap(name => listJson(path.join(root, "data", name))),
    ...scenarios.flatMap(id => listJson(path.join(root, "data/scenarios", id))),
    ...publicAssets.flatMap(name => listJson(path.join(root, name))),
  ].filter(file => !provenance.some(pattern => pattern.test(file.replaceAll("\\", "/"))));
  const stale = files.flatMap(file => {
    const match = memberPattern.exec(readText(file));
    return match ? [`${path.relative(root, file)}: ${match[1]}`] : [];
  });
  assert.deepEqual(stale, []);
});

test("every scenario topology carries each merged feature exactly once", () => {
  for (const id of scenarios) {
    const dir = path.join(root, "data/scenarios", id);
    const file = fs.existsSync(path.join(dir, "runtime_topology.topo.json"))
      ? path.join(dir, "runtime_topology.topo.json") : path.join(dir, "runtime_topology.topo.json.gz");
    const ids = JSON.parse(readText(file)).objects.political.geometries.map(row => String(row.properties?.id ?? row.id));
    for (const group of groups) {
      assert.equal(ids.filter(value => value === group.id).length, 1, `${id}: ${group.id}`);
    }
  }
});
