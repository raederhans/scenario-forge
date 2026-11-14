#!/usr/bin/env node
// Import boundary check for js/. Fails when a module crosses a layer boundary:
//   1. js/core and js/shared never import js/ui.
//   2. js/shared never imports js/core.
//   3. js/ui reaches the renderer runtime only through js/core/map_renderer/public.js.
//      Policy and query modules under js/core/renderer/ stay importable: they are
//      plain functions, and routing them through the facade would load the whole
//      renderer into every ui module that needs one helper.
// Usage: node tools/check_import_boundaries.mjs
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "acorn";
import { simple } from "acorn-walk";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
  const rendererRuntime = imported === "js/core/map_renderer.js"
    || (imported.startsWith("js/core/map_renderer/") && imported !== "js/core/map_renderer/public.js");
  if (inUi && rendererRuntime) return "ui must import the renderer through js/core/map_renderer/public.js";
  return "";
}

const failures = [];
for (const file of listModules(path.join(ROOT, "js"))) {
  const importer = toRepoPath(file);
  for (const specifier of importedSpecifiers(readFileSync(file, "utf8"))) {
    if (!specifier.startsWith(".")) continue;
    const imported = toRepoPath(path.resolve(path.dirname(file), specifier));
    const reason = violation(importer, imported);
    if (reason) failures.push(`${importer} -> ${imported}: ${reason}`);
  }
}

if (failures.length) {
  console.error(`Import boundary check failed (${failures.length}):`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log("Import boundaries hold.");
