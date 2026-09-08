import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  STARTUP_RESOURCE_CLASSES,
  buildStartupResourceGraph,
  validateStartupResourceGraph,
} from "../tools/startup_resource_graph.mjs";

test("startup resource graph is deterministic and reconciles the source entrypoint to Pages ownership", () => {
  const first = buildStartupResourceGraph();
  const second = buildStartupResourceGraph();

  assert.deepEqual(second, first);
  assert.deepEqual(first.entrypoint, {
    html_path: "index.html",
    module_path: "js/main.js",
    pages_html_path: "app/index.html",
    pages_module_path: "app/js/main.js",
  });
  assert.equal(first.manifest.admission_status, "complete");
  assert.equal(first.manifest.graph_scan_status, "complete");
  assert.equal(first.manifest.product_inventory_status, "complete");
  assert.equal(first.manifest.publication_ownership_status, "complete");
  assert.equal(first.validation.status, "rejected");
  assert.ok(first.validation.issues.some((issue) => issue.code === "optional-resource-in-base-startup-graph"));
  const optionalBaseStartupIssues = first.validation.issues
    .filter((issue) => issue.code === "optional-resource-in-base-startup-graph");
  assert.ok(optionalBaseStartupIssues.length > 0);
  assert.ok(optionalBaseStartupIssues.every((issue) => issue.classification !== "critical"));
  assert.deepEqual(
    first.validation.issue_summary.map((summary) => summary.code),
    [...new Set(first.validation.issues.map((issue) => issue.code))]
      .sort((left, right) => left.localeCompare(right)),
  );
  for (const summary of first.validation.issue_summary) {
    const summarizedIssues = first.validation.issues.filter((issue) => issue.code === summary.code);
    const expectedClassifications = [...new Set(summarizedIssues
      .map((issue) => issue.classification)
      .filter((classification) => typeof classification === "string" && classification.trim()))]
      .sort((left, right) => left.localeCompare(right));
    assert.equal(summary.issue_count, summarizedIssues.length);
    assert.deepEqual(
      summary.classification_counts.map(({ classification }) => classification),
      expectedClassifications,
    );
    for (const classificationSummary of summary.classification_counts) {
      assert.equal(
        classificationSummary.issue_count,
        summarizedIssues.filter((issue) => (
          issue.classification === classificationSummary.classification
        )).length,
      );
    }
  }
  assert.equal(
    first.validation.issue_summary.reduce((total, summary) => total + summary.issue_count, 0),
    first.validation.issue_count,
  );
  assert.deepEqual(Object.keys(first.categories), STARTUP_RESOURCE_CLASSES);
  assert.ok(first.categories.critical.includes("js/main.js"));
  assert.ok(first.categories.deferred.includes("js/bootstrap/startup_sample_project_deeplink.js"));
  assert.ok(first.categories.deferred.includes("js/core/appearance_transport_change_set.js"));
  assert.ok(first.categories["scenario-specific"].includes("js/bootstrap/startup_scenario_boot.js"));
  assert.equal(first.stage_a_lazy_loader.path, "js/bootstrap/startup_lazy_module_loader.js");
  assert.equal(first.stage_a_lazy_loader.entrypoint_imported, true);
  assert.deepEqual(first.stage_a_lazy_loader.bindings, [
    { name: "startupSampleProjectDeeplinkModuleLoader", target: "js/bootstrap/startup_sample_project_deeplink.js" },
    { name: "startupScenarioBootOwnerLoader", target: "js/bootstrap/startup_scenario_boot.js" },
  ]);
  assert.ok(first.modules.every((record) => record.product_owner));
  assert.ok(first.resources.every((record) => record.product_owner));
  for (const sourcePath of ["js/core/file_manager.js", "js/core/export_artifact_package.js"]) {
    const module = first.modules.find((record) => record.source_path === sourcePath);
    assert.equal(module?.base_startup, false, `${sourcePath} must load through explicit project/export intent`);
  }
});

test("startup resource graph rejects optional base-startup re-entry and missing ownership", () => {
  const result = validateStartupResourceGraph({
    issues: [],
    manifest: {
      admission_status: "complete",
      graph_scan_status: "complete",
      product_inventory_status: "complete",
      publication_ownership_status: "complete",
      schema_version: 2,
    },
    modules: ["deferred", "scenario-specific", "export-only", "dev-only"].map((classification) => ({
      base_startup: true,
      classification,
      manifest_load_phase: "initial",
      product_owner: classification === "deferred" ? "" : "fixture-owner",
      source_path: `js/${classification}.js`,
    })),
    resources: [],
  });

  assert.equal(result.status, "rejected");
  assert.deepEqual(result.issues.map((issue) => issue.code), [
    "missing-product-owner",
    "optional-resource-in-base-startup-graph",
    "optional-resource-in-base-startup-graph",
    "optional-resource-in-base-startup-graph",
    "optional-resource-in-base-startup-graph",
  ]);
  assert.deepEqual(result.issue_summary, [
    {
      classification_counts: [],
      code: "missing-product-owner",
      issue_count: 1,
    },
    {
      classification_counts: [
        { classification: "deferred", issue_count: 1 },
        { classification: "dev-only", issue_count: 1 },
        { classification: "export-only", issue_count: 1 },
        { classification: "scenario-specific", issue_count: 1 },
      ],
      code: "optional-resource-in-base-startup-graph",
      issue_count: 4,
    },
  ]);
  assert.equal(
    result.issue_summary.reduce((total, summary) => total + summary.issue_count, 0),
    result.issue_count,
  );
});

test("startup resource graph parses source edges with Pages Acorn semantics and fails closed on externals", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "startup-resource-graph-"));
  test.after(() => fs.rmSync(rootDir, { force: true, recursive: true }));
  fs.mkdirSync(path.join(rootDir, "dist"), { recursive: true });
  fs.mkdirSync(path.join(rootDir, "js", "bootstrap"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "index.html"), '<script type="module" src="./js/main.js"></script>\n');
  fs.writeFileSync(path.join(rootDir, "js", "main.js"), [
    'const stringPseudoImport = \'import "./string-ghost.js"\';',
    '// import "./comment-ghost.js";',
    'import/* parser must accept comments here */"./bootstrap/startup_lazy_module_loader.js";',
    'import {',
    '  multilineFeature,',
    '} from "./multiline.js?cache=1#fixture";',
    'import "/js/root-feature.js";',
    'import "https://cdn.example.test/module.js?token=a=b";',
    'void import("./dynamic-feature.js?cache=1#fixture", { with: { type: "json" } });',
    'export { stringPseudoImport, multilineFeature };',
  ].join("\n"));
  fs.writeFileSync(
    path.join(rootDir, "js", "bootstrap", "startup_lazy_module_loader.js"),
    "export function createPageLifetimeModuleLoader() {}\n",
  );
  fs.writeFileSync(path.join(rootDir, "js", "multiline.js"), "export const multilineFeature = true;\n");
  fs.writeFileSync(path.join(rootDir, "js", "root-feature.js"), "export const rootFeature = true;\n");
  fs.writeFileSync(path.join(rootDir, "js", "dynamic-feature.js"), "export const dynamicFeature = true;\n");
  fs.writeFileSync(path.join(rootDir, "js", "string-ghost.js"), "throw new Error('not reachable');\n");
  fs.writeFileSync(path.join(rootDir, "js", "comment-ghost.js"), "throw new Error('not reachable');\n");

  const modulePaths = [
    "app/js/main.js",
    "app/js/bootstrap/startup_lazy_module_loader.js",
    "app/js/multiline.js",
    "app/js/root-feature.js",
    "app/js/dynamic-feature.js",
  ];
  fs.writeFileSync(path.join(rootDir, "dist", "pages-dist-manifest.json"), JSON.stringify({
    reachability_inventory: {
      admission: { status: "complete" },
      graph_scan_status: "complete",
      module_graph: {
        entrypoints: [{ id: "editor", path: "app/index.html", resource_references: ["app/js/main.js"] }],
        initial_resource_paths: [],
        nodes: modulePaths.map((modulePath) => ({
          dynamic_import_expressions: [],
          dynamic_imports: modulePath === "app/js/main.js" ? ["app/js/dynamic-feature.js"] : [],
          load_phase: modulePath === "app/js/dynamic-feature.js" ? "deferred-runtime" : "initial",
          path: modulePath,
          product_category: "startup-critical",
          reference_locations: {
            dynamic_imports: modulePath === "app/js/main.js" ? [{
              local: true,
              reference: "./dynamic-feature.js?cache=1#fixture",
              resolved_path: "app/js/dynamic-feature.js",
            }] : [],
          },
          resource_references: [],
          static_imports: modulePath === "app/js/main.js" ? [
            "app/js/bootstrap/startup_lazy_module_loader.js",
            "app/js/multiline.js",
            "app/js/root-feature.js",
          ] : [],
        })),
      },
      ownership_groups: [{
        basis: "fixture",
        category: "startup-critical",
        owner: "fixture-owner",
        path_exceptions: [],
        path_prefixes: [{ prefix: "app/js/" }],
      }],
      product_inventory: { status: "complete" },
      publication_ownership_status: "complete",
      schema_version: 2,
    },
  }));

  const graph = buildStartupResourceGraph({ rootDir });
  const mainModule = graph.modules.find((record) => record.source_path === "js/main.js");
  assert.deepEqual(mainModule.static_imports, [
    "js/bootstrap/startup_lazy_module_loader.js",
    "js/multiline.js",
    "js/root-feature.js",
  ]);
  assert.deepEqual(mainModule.dynamic_imports, ["js/dynamic-feature.js"]);
  assert.equal(graph.modules.some((record) => record.source_path.endsWith("ghost.js")), false);
  assert.equal(graph.validation.issues.some((issue) => issue.code.endsWith("edge-mismatch")), false);
  assert.ok(graph.validation.issues.some((issue) => (
    issue.code === "unresolved-static-import"
    && issue.from === "js/main.js"
    && issue.reference === "https://cdn.example.test/module.js?token=a=b"
  )));

  const manifestPath = path.join(rootDir, "dist", "pages-dist-manifest.json");
  const mismatchedManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const mainManifestNode = mismatchedManifest.reachability_inventory.module_graph.nodes
    .find((node) => node.path === "app/js/main.js");
  mainManifestNode.static_imports = mainManifestNode.static_imports
    .filter((entry) => entry !== "app/js/root-feature.js");
  mainManifestNode.reference_locations.dynamic_imports = [];
  fs.writeFileSync(manifestPath, JSON.stringify(mismatchedManifest));
  const mismatchedGraph = buildStartupResourceGraph({ rootDir });
  assert.ok(mismatchedGraph.validation.issues.some((issue) => (
    issue.code === "pages-static-edge-mismatch"
    && issue.source_only.includes("app/js/root-feature.js")
  )));
  assert.ok(mismatchedGraph.validation.issues.some((issue) => (
    issue.code === "pages-literal-dynamic-edge-mismatch"
    && issue.source_only.includes("app/js/dynamic-feature.js")
  )));
});

test("startup resource graph accepts only Pages reachability schema version 2", () => {
  for (const schemaVersion of [undefined, 0, 1, 3]) {
    const result = validateStartupResourceGraph({
      issues: [],
      manifest: {
        admission_status: "complete",
        graph_scan_status: "complete",
        product_inventory_status: "complete",
        publication_ownership_status: "complete",
        schema_version: schemaVersion,
      },
      modules: [],
      resources: [],
    });
    assert.equal(result.status, "rejected", `schema version ${schemaVersion}`);
    assert.deepEqual(result.issues, [{
      actual: schemaVersion === undefined ? null : schemaVersion,
      code: "pages-reachability-schema-version-mismatch",
      expected: 2,
    }]);
    assert.deepEqual(result.issue_summary, [{
      classification_counts: [],
      code: "pages-reachability-schema-version-mismatch",
      issue_count: 1,
    }]);
  }
});
