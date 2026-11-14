#!/usr/bin/env node
// Import boundary check for js/. Fails when a module crosses a layer boundary:
//   1. js/core and js/shared never import js/ui.
//   2. js/shared never imports js/core.
//   3. js/ui reaches the renderer only through js/core/map_renderer/public.js;
//      the direct imports that predate this check are listed below and may only shrink.
// Usage: node tools/check_import_boundaries.mjs
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "acorn";
import { simple } from "acorn-walk";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// "importer -> imported" pairs that already crossed rule 3 when the check was added.
const KNOWN_UI_RENDERER_IMPORTS = new Set([
  "js/ui/sidebar.js -> js/core/map_renderer.js",
  "js/ui/sidebar.js -> js/core/renderer/modern_place_name.js",
  "js/ui/sidebar/country_inspector_controller.js -> js/core/renderer/modern_place_name.js",
  "js/ui/sidebar/water_special_region_controller.js -> js/core/renderer/water_region_color.js",
  "js/ui/sidebar/water_special_region_controller.js -> js/core/renderer/effective_water_regions.js",
  "js/ui/toolbar.js -> js/core/renderer/thematic_wgi_export_legend.js",
  "js/ui/toolbar.js -> js/core/renderer/population_export_legend.js",
  "js/ui/toolbar/appearance_border_owner.js -> js/core/renderer/political_border_policy.js",
  "js/ui/toolbar/appearance_controls_controller.js -> js/core/renderer/display_quality_policy.js",
  "js/ui/toolbar/appearance_physical_owner.js -> js/core/renderer/physical_atlas_lod_policy.js",
  "js/ui/toolbar/layer_status_diagnostics.js -> js/core/renderer/physical_contour_lod_policy.js",
  "js/ui/toolbar/layer_status_diagnostics.js -> js/core/renderer/physical_atlas_lod_policy.js",
  "js/ui/toolbar/strategic_values_owner.js -> js/core/renderer/strategic_choropleth.js",
  "js/ui/transport_workbench_retention.js -> js/core/renderer/geometry_cache_budget.js",
]);

function listModules(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...listModules(full));
    else if (entry.name.endsWith(".js")) found.push(full);
  }
  return found;
}

const toRepoPath = (file) => path.relative(ROOT, file).split(path.sep).join("/");

function importedSpecifiers(source) {
  let tree;
  try {
    tree = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  } catch {
    // Classic worker scripts are not modules and have no import statements.
    return [];
  }
  const specifiers = [];
  const literal = (node) => {
    if (node && node.type === "Literal" && typeof node.value === "string") specifiers.push(node.value);
  };
  simple(tree, {
    ImportDeclaration: (node) => literal(node.source),
    ExportNamedDeclaration: (node) => literal(node.source),
    ExportAllDeclaration: (node) => literal(node.source),
    ImportExpression: (node) => literal(node.source),
  });
  return specifiers;
}

function violation(importer, imported) {
  const inCore = importer.startsWith("js/core/");
  const inShared = importer.startsWith("js/shared/");
  const inUi = importer.startsWith("js/ui/");
  if ((inCore || inShared) && imported.startsWith("js/ui/")) return "core and shared must not import ui";
  if (inShared && imported.startsWith("js/core/")) return "shared must not import core";
  const rendererInternal = imported === "js/core/map_renderer.js" || imported.startsWith("js/core/renderer/")
    || (imported.startsWith("js/core/map_renderer/") && imported !== "js/core/map_renderer/public.js");
  if (inUi && rendererInternal) return "ui must import the renderer through js/core/map_renderer/public.js";
  return "";
}

const failures = [];
const seenKnown = new Set();
for (const file of listModules(path.join(ROOT, "js"))) {
  const importer = toRepoPath(file);
  for (const specifier of importedSpecifiers(readFileSync(file, "utf8"))) {
    if (!specifier.startsWith(".")) continue;
    const imported = toRepoPath(path.resolve(path.dirname(file), specifier));
    const reason = violation(importer, imported);
    if (!reason) continue;
    const pair = `${importer} -> ${imported}`;
    if (KNOWN_UI_RENDERER_IMPORTS.has(pair)) seenKnown.add(pair);
    else failures.push(`${pair}: ${reason}`);
  }
}
for (const pair of KNOWN_UI_RENDERER_IMPORTS) {
  if (!seenKnown.has(pair)) failures.push(`${pair}: no longer present, remove it from KNOWN_UI_RENDERER_IMPORTS`);
}

if (failures.length) {
  console.error(`Import boundary check failed (${failures.length}):`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`Import boundaries hold; ${seenKnown.size} known ui -> renderer imports remain.`);
