import assert from "node:assert/strict";
import test from "node:test";
import { getEffectiveScenarioHierarchy, getEffectiveScenarioHierarchyFromInputs } from "../js/core/scenario_hierarchy.js";
import { createQuickFillHierarchyResolver } from "../js/core/quick_fill_hierarchy.js";
import { createParentBorderGroupingPolicy } from "../js/core/renderer/parent_border_grouping_policy.js";
import { getQuickFillLevelModel } from "../js/ui/toolbar/quick_fill_level_controls.js";
import { readFileSync } from "node:fs";
import { parse } from "acorn";
import { normalizeCountryCodeAlias } from "../js/core/country_code_aliases.js";

// Bind the actual consumer functions to a local fixture, as in the import
// transaction tests. Never write the application's shared state singleton.
function bindConsumers(path, names, runtime) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const nodes = parse(source, { ecmaVersion: "latest", sourceType: "module" }).body
    .map(node => node.type === "ExportNamedDeclaration" ? node.declaration : node);
  const declarations = names.map(name => {
    const node = nodes.find(entry => entry?.type === "FunctionDeclaration" && entry.id.name === name);
    assert.ok(node, `Missing consumer ${name}`);
    return source.slice(node.start, node.end);
  }).join("\n");
  return new Function("runtimeState", "getEffectiveScenarioHierarchy", "normalizeCountryCode",
    `${declarations}\nreturn { ${names.join(", ")} };`)(runtime, getEffectiveScenarioHierarchy, normalizeCountryCodeAlias);
}

function fixture() {
  const groups = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [
    `US_State_${i}`, Array.from({ length: i === 50 ? 44 : 62 }, (_, j) => `US_CNTY_${String(i * 62 + j).padStart(5, "0")}`),
  ]));
  const override = { country_codes: ["US"], groups, labels: Object.fromEntries(Object.keys(groups).map(id => [id, id.replaceAll("_", " ")])) };
  const base = {
    groups: { US_old: ["US_ZN_31_1__R"], IN_Kerala: ["IN_1", "IN_2"] },
    labels: { US_old: "Old US", IN_Kerala: "Kerala" },
    quick_fill: { countries: { US: { default_level: "state", levels: { state: { label: "State", alias: "parent" } } } } },
  };
  return { hierarchyData: base, activeScenarioManifest: { hierarchy_overrides: override } };
}

test("51-state snapshot replaces the entire US membership and preserves India and quick-fill references", () => {
  const runtime = fixture();
  const before = structuredClone(runtime);
  const result = getEffectiveScenarioHierarchy(runtime);
  const overrides = runtime.activeScenarioManifest.hierarchy_overrides;
  assert.equal(Object.keys(result.groups).filter(id => id.startsWith("US_")).length, 51);
  assert.equal(Object.values(overrides.groups).flat().length, 3144);
  assert.deepEqual(Object.entries(result.groups).filter(([id]) => id.startsWith("US_")), Object.entries(overrides.groups));
  assert.equal(result.groups.US_old, undefined);
  assert.equal(result.labels.US_old, undefined);
  assert.equal(result.groups.IN_Kerala, runtime.hierarchyData.groups.IN_Kerala);
  assert.equal(result.labels.IN_Kerala, "Kerala");
  assert.equal(result.quick_fill, runtime.hierarchyData.quick_fill);
  assert.deepEqual(runtime, before);
  assert.equal(getEffectiveScenarioHierarchy(runtime), result);
  assert.equal(getEffectiveScenarioHierarchyFromInputs(runtime.hierarchyData, overrides), result);
});

test("manifest switch, clear and rollback reuse only the matching snapshot", () => {
  const runtime = fixture();
  const manifest = runtime.activeScenarioManifest;
  const first = getEffectiveScenarioHierarchy(runtime);
  runtime.activeScenarioManifest = structuredClone(manifest);
  assert.notEqual(getEffectiveScenarioHierarchy(runtime), first);
  runtime.activeScenarioManifest = null;
  assert.equal(getEffectiveScenarioHierarchy(runtime), runtime.hierarchyData);
  assert.equal(getEffectiveScenarioHierarchyFromInputs(runtime.hierarchyData, undefined), runtime.hierarchyData);
  runtime.activeScenarioManifest = {};
  assert.equal(getEffectiveScenarioHierarchy(runtime), runtime.hierarchyData);
  runtime.activeScenarioManifest = manifest;
  assert.equal(getEffectiveScenarioHierarchy(runtime), first);
  runtime.hierarchyData = { ...runtime.hierarchyData };
  assert.notEqual(getEffectiveScenarioHierarchy(runtime), first);
  assert.equal(getEffectiveScenarioHierarchy({}), undefined);
});

test("invalid override fails closed without changing another country", () => {
  for (const mutate of [
    o => { o.country_codes = []; },
    o => { o.groups.IN_Kerala = ["incorrect"]; },
    o => { o.labels.IN_Kerala = "incorrect"; },
    o => { o.groups.US_State_0 = "invalid"; },
    o => { o.groups.US_State_0.push(o.groups.US_State_1[0]); },
    o => { o.country_codes.push("CA"); },
  ]) {
    const runtime = fixture();
    mutate(runtime.activeScenarioManifest.hierarchy_overrides);
    assert.equal(getEffectiveScenarioHierarchy(runtime), runtime.hierarchyData);
  }
});

test("quick-fill and border consumers plus source-bound sidebar and releasable consumers resolve scenario counties", () => {
  const runtime = fixture();
  const groups = runtime.activeScenarioManifest.hierarchy_overrides.groups;
  const ids = Object.values(groups).flat();
  const features = ids.map(id => ({ id, properties: { cntr_code: "US" } }));
  Object.assign(runtime, {
    activeScenarioId: "modern_world", selectedInspectorCountryCode: "US", batchFillScope: "level:state",
    landIndex: new Map(features.map(f => [f.id, f])),
    sovereigntyByFeatureId: Object.fromEntries(ids.map(id => [id, "US"])),
  });
  const helpers = {
    canonicalCountryCode: value => value,
    getAdmin1Group: () => "",
    getFeatureCountryCodeNormalized: f => f.properties.cntr_code,
    getFeatureId: f => f.id,
    shouldExcludePoliticalInteractionFeature: () => false,
  };
  const resolver = createQuickFillHierarchyResolver(runtime, helpers);
  for (const scope of ["parent", "level:state"]) {
    const result = resolver.resolve(features[0], ids[0], scope);
    assert.equal(result.status, "ready");
    assert.deepEqual(result.targetIds, groups.US_State_0);
  }
  assert.ok(getQuickFillLevelModel(runtime).options.some(o => o.value === "level:state"));
  const policy = createParentBorderGroupingPolicy(runtime, helpers);
  const candidate = policy.resolveCountryParentGroupingCandidate("US", features.map(feature => ({ id: feature.id, feature })));
  assert.equal(candidate.accepted, true);
  assert.equal(candidate.groupCountTotal, 51);
  assert.equal(candidate.featureToGroup.size, 3144);

  runtime.hierarchyGroupsByCode = new Map([["US", [{ id: "US_old", children: ["US_ZN_31_1__R"] }]]]);
  const { getHierarchyGroupsForCode } = bindConsumers("../js/ui/sidebar.js", ["getHierarchyGroupsForCode"], runtime);
  const { resolveFeatureIdsFromPresetSource } = bindConsumers("../js/core/releasable_manager.js",
    ["normalizePresetSource", "resolveFeatureIdsFromPresetSource"], runtime);
  const sidebar = getHierarchyGroupsForCode("US");
  assert.equal(sidebar.length, 51);
  assert.deepEqual(sidebar.find(g => g.id === "US_State_0").children, groups.US_State_0);
  assert.deepEqual(getHierarchyGroupsForCode("IN")[0].children, ["IN_1", "IN_2"]);
  for (const type of ["hierarchy_group_ids", "feature_ids"]) {
    assert.deepEqual(resolveFeatureIdsFromPresetSource({ type, group_ids: ["US_State_0"] }), groups.US_State_0);
  }
  runtime.activeScenarioManifest = null;
  assert.equal(getHierarchyGroupsForCode("US")[0].id, "US_old");
});
