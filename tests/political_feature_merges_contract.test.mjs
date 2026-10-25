import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

// Applied plans are materialized by tools/apply_political_feature_merges.py.
// Any upstream rebuild that restores a merged-away runtime ID must re-run it.
// Plans apply in apply_order.json order; a plan with "scenarios" applies only
// there, and a later plan may merge an earlier merged feature again.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const planDir = path.join(root, "data/political_feature_merges");
const planFiles = fs.readdirSync(planDir).filter(name => /\.v\d+\.json$/.test(name));
const order = JSON.parse(fs.readFileSync(path.join(planDir, "apply_order.json"), "utf8")).plans;
const plans = order.map(name => JSON.parse(fs.readFileSync(path.join(planDir, name), "utf8")));
const groups = plans.flatMap(plan => plan.groups);
const scenarios = ["blank_base", "hoi4_1936", "hoi4_1939", "modern_world", "tno_1962"];
const appliesTo = (plan, scenario) => !plan.scenarios || plan.scenarios.includes(scenario);
const scenarioGroups = scenario => plans.filter(plan => appliesTo(plan, scenario)).flatMap(plan => plan.groups);
const globalMembers = plans.filter(plan => !plan.scenarios).flatMap(plan => plan.groups.flatMap(group => group.member_ids));
const globalAssets = [
  "europe_topology.na_v2.json", "europe_topology.runtime_political_v1.json", "hierarchy.json", "locales.json",
  "geo_aliases.json", "country_feature_policies.json", "quick_fill", "world_cities.geojson", "europe_urban.geojson",
  "releasables/hoi4_vanilla.internal.phase1.catalog.json", "river_partitions",
];
// Global files read by one scenario only, so its scoped plans project them too.
const scenarioAssets = id => [
  ...(id === "tno_1962" ? ["releasables/tno_1962.internal.phase1.catalog.json"] : []),
  ...(id === "blank_base" ? [] : [`thematic_layers/population/ghsl_population_2020_v1/features/${id}.json`]),
];
// Shipped sample projects, keyed by political feature IDs of their own scenario.
const sampleProjects = listJson(path.join(root, "landing/assets/sample-projects"))
  .map(file => ({ file, scenario: JSON.parse(fs.readFileSync(file, "utf8")).scenario?.id }));
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

// Scenario-scoped merge maps name their members by design.
const featureMergeMaps = /"feature_merges":\s*\{[^}]*\}/g;
// Copies of global names and aliases, which keep the members of scoped plans.
const sharedNameCopies = /\/(locales|geo_aliases)\.startup\.json$/;

function staleIds(files, memberIds) {
  if (!memberIds.length) return [];
  const pattern = new RegExp(`"(?:id::)?(${memberIds.map(id => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})"`);
  return files.filter(file => !provenance.some(rule => rule.test(file.replaceAll("\\", "/")))).flatMap(file => {
    const match = pattern.exec(readText(file).replace(featureMergeMaps, ""));
    return match ? [`${path.relative(root, file)}: ${match[1]}`] : [];
  });
}

function scenarioStaleIds(id) {
  const files = [
    ...listJson(path.join(root, "data/scenarios", id)),
    ...scenarioAssets(id).map(name => path.join(root, "data", name)),
    ...sampleProjects.filter(sample => sample.scenario === id).map(sample => sample.file),
  ];
  const scopedMembers = plans.filter(plan => plan.scenarios?.includes(id)).flatMap(plan => plan.groups.flatMap(group => group.member_ids));
  return [
    ...staleIds(files, globalMembers),
    ...staleIds(files.filter(file => !sharedNameCopies.test(file.replaceAll("\\", "/"))), scopedMembers),
  ];
}

test("merge plan groups are disjoint, contiguous candidates with bilingual names", () => {
  assert.ok(plans.length >= 2);
  assert.deepEqual([...order].sort(), [...planFiles].sort());
  assert.equal(new Set(order).size, order.length);
  const produced = new Map();
  for (const plan of plans) {
    assert.ok(!plan.scenarios || (plan.scenarios.length && plan.scenarios.every(id => scenarios.includes(id))));
    const scope = plan.scenarios || scenarios;
    for (const group of plan.groups) {
      for (const member of group.member_ids.filter(id => id.includes("_MRG_"))) {
        assert.ok(scope.every(id => produced.get(member)?.includes(id)), `${group.id}: ${member} must come from an earlier plan`);
      }
      produced.set(group.id, scope);
    }
  }
  for (const scenario of scenarios) {
    const memberIds = scenarioGroups(scenario).flatMap(group => group.member_ids);
    assert.equal(new Set(memberIds).size, memberIds.length, scenario);
  }
  for (const group of groups) {
    assert.match(group.id, /^[A-Z]{2}_MRG_[0-9a-f]{12}$/);
    assert.ok(group.member_ids.length >= 2 && group.member_ids.every(id => id.startsWith(group.id.slice(0, 2))));
    assert.ok(group.names.en && group.names.zh);
  }
});

test("runtime assets contain no merged-away political feature IDs", () => {
  assert.ok(sampleProjects.length && sampleProjects.every(sample => scenarios.includes(sample.scenario)));
  const stale = [
    ...staleIds(globalAssets.flatMap(name => listJson(path.join(root, "data", name))), globalMembers),
    ...scenarios.flatMap(scenarioStaleIds),
  ];
  assert.deepEqual(stale, []);
});

test("every scenario topology carries each surviving merged feature exactly once", () => {
  for (const id of scenarios) {
    const dir = path.join(root, "data/scenarios", id);
    const file = fs.existsSync(path.join(dir, "runtime_topology.topo.json"))
      ? path.join(dir, "runtime_topology.topo.json") : path.join(dir, "runtime_topology.topo.json.gz");
    const ids = JSON.parse(readText(file)).objects.political.geometries.map(row => String(row.properties?.id ?? row.id));
    const applied = scenarioGroups(id);
    const consumed = new Set(applied.flatMap(group => group.member_ids));
    for (const group of applied.filter(entry => !consumed.has(entry.id))) {
      assert.equal(ids.filter(value => value === group.id).length, 1, `${id}: ${group.id}`);
    }
  }
});
