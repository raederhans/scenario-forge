import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const planDir = path.join(root, "data/political_feature_merges");
const order = JSON.parse(fs.readFileSync(path.join(planDir, "apply_order.json"), "utf8")).plans;
const plans = order.map(name => JSON.parse(fs.readFileSync(path.join(planDir, name), "utf8")));
const scenarios = ["blank_base", "hoi4_1936", "hoi4_1939", "modern_world", "tno_1962"];
const appliesTo = (plan, scenario) => !plan.scenarios || plan.scenarios.includes(scenario);
const scenarioGroups = scenario => plans.filter(plan => appliesTo(plan, scenario)).flatMap(plan => plan.groups);
const globalMembers = plans.filter(plan => !plan.scenarios).flatMap(plan => plan.groups.flatMap(group => group.member_ids));
const globalAssets = [
  "europe_topology.na_v2.json", "europe_topology.runtime_political_v1.json", "hierarchy.json", "locales.json",
  "geo_aliases.json", "country_feature_policies.json", "quick_fill", "world_cities.geojson", "europe_urban.geojson",
  "releasables/hoi4_vanilla.internal.phase1.catalog.json", "river_partitions",
];
const scenarioAssets = id => [
  ...(id === "tno_1962" ? ["releasables/tno_1962.internal.phase1.catalog.json"] : []),
  ...(id === "blank_base" ? [] : [`thematic_layers/population/ghsl_population_2020_v1/features/${id}.json`]),
];
const sampleProjects = listJson(path.join(root, "landing/assets/sample-projects"))
  .map(file => ({ file, scenario: JSON.parse(fs.readFileSync(file, "utf8")).scenario?.id }));
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

const featureMergeMaps = /"feature_merges":\s*\{[^}]*\}/g;
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

test("saved-project merge lineage matches the applied plans in order", () => {
  const lineage = JSON.parse(fs.readFileSync(path.join(root, "data/feature-migrations/political_feature_merges.v1.json"), "utf8"));
  assert.deepEqual(lineage, { version: 1, plans: order.map((name, index) => ({
    plan: name, scenarios: plans[index].scenarios ?? null,
    groups: Object.fromEntries(plans[index].groups.map(group => [group.id, group.member_ids])),
  })) });
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
    const splits = JSON.parse(readText(path.join(dir, "manifest.json"))).hierarchy_overrides?.feature_splits || {};
    for (const group of applied.filter(entry => !consumed.has(entry.id))) {
      if (Object.hasOwn(splits, group.id)) {
        assert.ok(splits[group.id].length >= 2);
        assert.equal(new Set(splits[group.id]).size, splits[group.id].length);
        assert.equal(ids.filter(value => value === group.id).length, 0, `${id}: ${group.id}`);
        for (const child of splits[group.id]) {
          assert.equal(ids.filter(value => value === child).length, 1, `${id}: ${child}`);
        }
      } else {
        assert.equal(ids.filter(value => value === group.id).length, 1, `${id}: ${group.id}`);
      }
    }
  }
});
