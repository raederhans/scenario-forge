#!/usr/bin/env node
// Audit the same resolver used by map double-clicks against published metadata.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { createQuickFillHierarchyResolver, getQuickFillHierarchyIndex } from "../js/core/quick_fill_hierarchy.js";
import { createPoliticalFeaturePolicy } from "../js/core/renderer/political_feature_policy.js";
import { normalizeCountryCodeAlias } from "../js/core/country_code_aliases.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => {
  const bytes = readFileSync(path.join(root, relative));
  return JSON.parse(relative.endsWith(".gz") ? gunzipSync(bytes).toString("utf8") : bytes.toString("utf8"));
};
const hash = (relative) => createHash("sha256").update(readFileSync(path.join(root, relative))).digest("hex");
const idOf = (feature) => String(feature?.properties?.id || feature?.id || "").trim();
const countryOf = (feature) => normalizeCountryCodeAlias(String(feature?.properties?.cntr_code || "").trim().toUpperCase());
const hierarchy = read("data/hierarchy.json");
const hierarchyIndex = getQuickFillHierarchyIndex(hierarchy);

function loadSnapshot(scenarioId) {
  if (!scenarioId) {
    const source = "data/europe_topology.runtime_political_v1.json";
    return { source, features: read(source).objects.political.geometries.map((geometry) => ({ properties: geometry.properties })), owners: {}, districts: null };
  }
  const base = `data/scenarios/${scenarioId}`;
  const manifest = read(`${base}/manifest.json`);
  const chunks = read(`${base}/detail_chunks.manifest.json`).chunks;
  const coarse = chunks.find((chunk) => chunk.layer === "political" && chunk.lod === "coarse" && chunk.global_coverage);
  const source = coarse?.url || `${base}/runtime_topology.topo.json`;
  const data = read(source);
  const features = data.features || data.objects?.political?.geometries?.map((geometry) => ({ properties: geometry.properties }));
  if (!Array.isArray(features)) throw new Error(`Unsupported political metadata source: ${source}`);
  return { source, features: features.map((feature) => ({ properties: feature.properties })),
    owners: read(`${base}/owners.by_feature.json`).owners || {},
    districts: manifest.district_groups_url && existsSync(path.join(root, manifest.district_groups_url)) ? read(manifest.district_groups_url) : null };
}

function auditSnapshot(scenarioId = "") {
  const snapshot = loadSnapshot(scenarioId);
  const state = { activeScenarioId: scenarioId, hierarchyData: hierarchy, landIndex: new Map(), countryToFeatureIds: new Map(),
    sovereigntyByFeatureId: snapshot.owners, scenarioDistrictGroupsData: snapshot.districts, mapSemanticMode: "political" };
  const visibility = createPoliticalFeaturePolicy(state, {
    getFeatureId: idOf, getFeatureCountryCodeNormalized: countryOf,
    isAtlantropaFieldDrivenFeature: (feature) => !!(feature.properties?.atl_render_layer || feature.properties?.atl_color_rule),
    isInteractiveAtlantropaBooleanWeldIslandFeature: (feature) => idOf(feature).startsWith("ATLISL_") && feature.properties?.atl_geometry_role === "donor_island" && feature.properties?.atl_join_mode === "boolean_weld",
    isScenarioAtlantropaVisible: () => true,
    isBaseGeographyScenarioFeature: (feature) => feature.properties?.render_as_base_geography === true,
  });
  let duplicateIds = 0;
  for (const feature of snapshot.features) {
    const id = idOf(feature); const country = countryOf(feature);
    if (!id) continue;
    if (state.landIndex.has(id)) duplicateIds++;
    state.landIndex.set(id, feature);
    if (!state.countryToFeatureIds.has(country)) state.countryToFeatureIds.set(country, []);
    state.countryToFeatureIds.get(country).push(id);
  }
  const resolver = createQuickFillHierarchyResolver(state, {
    getAdmin1Group: (feature) => String(feature?.properties?.admin1_group || "").trim(),
    getFeatureCountryCodeNormalized: countryOf,
    getFeatureInteractionCountryCodeNormalized: (feature, id) => state.sovereigntyByFeatureId[id] || countryOf(feature),
    shouldExcludePoliticalInteractionFeature: visibility.shouldExcludePoliticalInteractionFeature,
  });
  const countries = [];
  for (const [country, rawIds] of state.countryToFeatureIds) {
    const ids = rawIds.filter((id) => !visibility.shouldExcludePoliticalInteractionFeature(state.landIndex.get(id), id));
    const levels = ["parent", ...Array.from(hierarchyIndex.countries.get(country)?.levels.keys() || []).filter((level) => level !== "parent").map((level) => `level:${level}`)];
    const countsByLevel = {};
    const examples = {};
    for (const scope of levels) {
      const counts = {};
      for (const id of ids) {
        const resolution = resolver.resolve(state.landIndex.get(id), id, scope);
        counts[resolution.status] = (counts[resolution.status] || 0) + 1;
        if (resolution.status === "ready" && resolution.singleton) counts.singleton = (counts.singleton || 0) + 1;
        if (resolution.status !== "ready" && !examples[resolution.status]) examples[resolution.status] = id;
      }
      countsByLevel[scope] = counts;
    }
    const counts = countsByLevel.parent;
    const category = !ids.length ? "no_interactive_leaves"
      : counts.ready === ids.length ? (counts.singleton === ids.length ? "singleton_parents" : "usable_parent")
        : counts.scenario_level_unavailable === ids.length ? "scenario_policy_disabled"
          : counts.no_parent_level === ids.length ? "no_parent_level" : "partial_or_broken";
    countries.push({ country, category, raw_features: rawIds.length, interactive_leaves: ids.length,
      excluded_helpers: rawIds.length - ids.length, levels: countsByLevel, examples });
  }
  const fullIds = new Set(state.landIndex.keys());
  const hierarchyOrphans = Object.entries(hierarchy.groups || {}).flatMap(([group, members]) => members.filter((id) => !fullIds.has(id)).map((id) => ({ group, id })));
  return { scenario: scenarioId || "default", source: snapshot.source, source_sha256: hash(snapshot.source),
    duplicate_feature_ids: duplicateIds, hierarchy_orphan_count: hierarchyOrphans.length,
    hierarchy_orphan_examples: hierarchyOrphans.slice(0, 20), countries: countries.sort((a, b) => a.country.localeCompare(b.country)) };
}

const snapshots = ["", "hoi4_1936", "hoi4_1939", "tno_1962"].map(auditSnapshot);
const report = { version: 1, audit_kind: "metadata_and_resolver_not_browser_replay", hierarchy_sha256: hash("data/hierarchy.json"), snapshots };
const outputDir = path.join(root, ".runtime/reports/generated");
mkdirSync(outputDir, { recursive: true });
writeFileSync(path.join(outputDir, "quick-fill-support.json"), JSON.stringify(report, null, 2) + "\n");
const majors = ["CN", "FR", "DE", "US", "GB", "IN", "RU", "CA", "MX", "JP", "BR", "AU", "PL", "UA"];
const lines = ["# Quick-fill support audit", "", "Metadata/resolver audit. Not a claim that browser interactions were replayed.", "", "| Snapshot | Country | Interactive leaves | Ready parent | Excluded helpers | Status |", "|---|---|---:|---:|---:|---|"];
for (const snapshot of snapshots) {
  for (const row of snapshot.countries.filter((row) => majors.includes(row.country))) {
    lines.push(`| ${snapshot.scenario} | ${row.country} | ${row.interactive_leaves} | ${row.levels.parent.ready || 0} | ${row.excluded_helpers} | ${row.category} |`);
  }
}
lines.push("", "## Intermediate levels", "");
for (const country of ["FR", "CN"]) {
  const row = snapshots[0].countries.find((entry) => entry.country === country);
  lines.push(`- ${country}: \`${JSON.stringify(row.levels)}\``);
}
writeFileSync(path.join(outputDir, "quick-fill-support.md"), lines.join("\n") + "\n");
console.log(lines.join("\n"));
if (snapshots.some((snapshot) => snapshot.duplicate_feature_ids)) process.exitCode = 1;
