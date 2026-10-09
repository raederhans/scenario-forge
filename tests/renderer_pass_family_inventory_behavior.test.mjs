import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  RENDER_PASS_FAMILY_IDS,
  RENDER_PASS_FAMILY_INVENTORY,
  RENDER_PASS_IMPLEMENTATION_STATUS_IDS,
  RENDER_PASS_PERF_SENSITIVITY_IDS,
  RENDER_PASS_PLANNED_PHASE_IDS,
  RENDER_PASS_RISK_TIER_IDS,
  RENDER_PASS_STATE_READ_CLASS_IDS,
  RENDER_PASS_STATE_WRITE_CLASS_IDS,
  RENDER_PASS_SURFACE_IDS,
} from "../tools/renderer_pass_family_inventory.mjs";

const REPO_ROOT = process.cwd();
const INVENTORY_PATH = "tools/renderer_pass_family_inventory.mjs";
const RECORD_KEYS = [
  "passName", "familyId", "entryFunction", "implementationStatus", "entryHostPath",
  "plannedPhase", "riskTier", "stateReadClass", "stateWriteClass", "canvasOrSvg",
  "existingDependencyOwners", "browserLanes", "perfSensitivity", "notes",
];
const ARRAY_FIELDS = ["stateReadClass", "stateWriteClass", "existingDependencyOwners", "browserLanes"];
const SCALAR_ENUM_FIELDS = [
  ["familyId", RENDER_PASS_FAMILY_IDS, ["foundation", "political", "context", "visual-effects", "borders", "labels"]],
  ["implementationStatus", RENDER_PASS_IMPLEMENTATION_STATUS_IDS, ["inline", "thin-wrapper", "delegated-existing", "owned-p3", "hold"]],
  ["plannedPhase", RENDER_PASS_PLANNED_PHASE_IDS, ["P3.1", "P3.2", "P3.3a", "P3.3b", "P3.4", "P3.5", "existing-delegated", "hold", "future-review"]],
  ["riskTier", RENDER_PASS_RISK_TIER_IDS, ["low", "medium", "high"]],
  ["canvasOrSvg", RENDER_PASS_SURFACE_IDS, ["canvas", "svg", "hybrid"]],
  ["perfSensitivity", RENDER_PASS_PERF_SENSITIVITY_IDS, ["low", "medium", "high"]],
];
const ENUM_CONTRACTS = [
  ...SCALAR_ENUM_FIELDS.map(([, values, expected]) => [values, expected]),
  [RENDER_PASS_STATE_READ_CLASS_IDS, ["viewport", "appearance", "scenario", "map-data", "interaction", "render-cache", "clock", "diagnostics"]],
  [RENDER_PASS_STATE_WRITE_CLASS_IDS, ["pass-surface", "owner-cache", "runtime-state", "diagnostics"]],
];
const STATIC_IMPORTS_BY_MODULE = new Map();
const DEPENDENCY_IMPORT_HOST_OVERRIDES = new Map([
  [
  ],
]);

function readText(...parts) {
  return fs.readFileSync(path.join(REPO_ROOT, ...parts), "utf8");
}

function extractIdleDefinitions(source) {
  return [...source.matchAll(/\{\s*passName:\s*"([^"]+)",\s*drawKey:\s*"([^"]+)"\s*\}/g)]
    .map((match) => ({ passName: match[1], drawKey: match[2] }));
}

function extractSecondaryPassNames(source) {
  const block = source.match(/export const RENDER_PASS_NAMES = \[([\s\S]*?)\];/);
  assert.ok(block, "RENDER_PASS_NAMES literal should exist");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function assertCanonicalTokens(values, canonical, label) {
  assert.equal(new Set(values).size, values.length, `${label} should be duplicate-free`);
  const positions = values.map((value) => canonical.indexOf(value));
  assert.equal(positions.every((position) => position >= 0), true, `${label} should use known tokens`);
  assert.deepEqual([...positions].sort((left, right) => left - right), positions, `${label} should use canonical order`);
}

function resolveStaticImport(importerPath, specifier) {
  if (!specifier.startsWith(".")) return null;
  return path.posix.normalize(path.posix.join(path.posix.dirname(importerPath), specifier));
}

function collectStaticImports(modulePath) {
  if (STATIC_IMPORTS_BY_MODULE.has(modulePath)) {
    return STATIC_IMPORTS_BY_MODULE.get(modulePath);
  }
  const source = readText(...modulePath.split("/"));
  const imports = new Set(
    [...source.matchAll(/(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g)]
      .map((match) => resolveStaticImport(modulePath, match[1]))
      .filter(Boolean),
  );
  STATIC_IMPORTS_BY_MODULE.set(modulePath, imports);
  return imports;
}

test("inventory shape, enums, records, and nested arrays are frozen", () => {
  assert.equal(RENDER_PASS_FAMILY_INVENTORY.length, 13);
  assert.equal(Object.isFrozen(RENDER_PASS_FAMILY_INVENTORY), true);
  for (const [values, expected] of ENUM_CONTRACTS) {
    assert.equal(Object.isFrozen(values), true);
    assert.equal(new Set(values).size, values.length, "inventory enums should be duplicate-free");
    assert.deepEqual(values, expected, "inventory enum tokens should keep their canonical order");
  }

  for (const record of RENDER_PASS_FAMILY_INVENTORY) {
    assert.equal(Object.isFrozen(record), true, `${record.passName} record should be frozen`);
    assert.deepEqual(Object.keys(record), RECORD_KEYS, `${record.passName} should use the exact record shape`);
    for (const key of RECORD_KEYS.filter((candidate) => !ARRAY_FIELDS.includes(candidate))) {
      assert.equal(typeof record[key], "string", `${record.passName}.${key} should be a string`);
    }
    for (const key of ARRAY_FIELDS) {
      assert.equal(Array.isArray(record[key]), true, `${record.passName}.${key} should be an array`);
      assert.equal(Object.isFrozen(record[key]), true, `${record.passName}.${key} should be frozen`);
      assert.equal(record[key].every((value) => typeof value === "string"), true);
    }
    for (const [key, values] of SCALAR_ENUM_FIELDS) {
      assert.equal(values.includes(record[key]), true, `${record.passName}.${key} should use a known enum value`);
    }
    assertCanonicalTokens(record.stateReadClass, RENDER_PASS_STATE_READ_CLASS_IDS, `${record.passName}.stateReadClass`);
    assertCanonicalTokens(record.stateWriteClass, RENDER_PASS_STATE_WRITE_CLASS_IDS, `${record.passName}.stateWriteClass`);
  }
});

test("inventory exactly matches the canonical runtime pass universe and order", () => {
  const idleDefinitions = extractIdleDefinitions(readText("js", "core", "renderer", "render_pipeline_catalog.js"));
  const secondaryNames = extractSecondaryPassNames(readText("js", "core", "map_renderer", "render_pass_catalog.js"));
  const inventoryNames = RENDER_PASS_FAMILY_INVENTORY.map((record) => record.passName);
  const idleNames = idleDefinitions.map((definition) => definition.passName);

  assert.equal(new Set(inventoryNames).size, 13);
  assert.equal(new Set(idleNames).size, 13);
  assert.equal(new Set(secondaryNames).size, 13);
  assert.deepEqual(inventoryNames, idleNames);
  assert.deepEqual([...inventoryNames].sort(), [...secondaryNames].sort());
  assert.notDeepEqual(secondaryNames, idleNames, "the secondary catalog keeps its known local order difference");
  for (const [index, record] of RENDER_PASS_FAMILY_INVENTORY.entries()) {
    assert.equal(record.entryFunction, idleDefinitions[index].drawKey, `${record.passName} entry should match its draw key`);
  }
});

test("family and planned-phase membership stays binding", () => {
  const namesFor = (key, value) => RENDER_PASS_FAMILY_INVENTORY.filter((record) => record[key] === value).map((record) => record.passName);
  assert.deepEqual(namesFor("familyId", "political"), ["political", "populationHeatmap"]);
  assert.deepEqual(namesFor("familyId", "visual-effects"), ["effects", "lineEffects", "dayNight", "textureLabels"]);
  assert.deepEqual(namesFor("plannedPhase", "P3.1"), ["effects", "lineEffects", "dayNight", "textureLabels"]);
  assert.deepEqual(namesFor("familyId", "context"), ["contextBase", "contextScenario", "contextMarkers"]);
  assert.deepEqual(namesFor("plannedPhase", "P3.2"), ["contextBase", "contextScenario", "contextMarkers"]);
  assert.deepEqual(namesFor("plannedPhase", "P3.3a"), []);
  assert.deepEqual(namesFor("plannedPhase", "P3.3b"), ["political"]);
  assert.deepEqual(namesFor("plannedPhase", "P3.4"), ["background"]);
  assert.deepEqual(namesFor("plannedPhase", "P3.5"), []);
  assert.deepEqual(namesFor("plannedPhase", "hold"), ["borders"]);
  assert.deepEqual(namesFor("plannedPhase", "existing-delegated"), ["physicalBase", "populationHeatmap"]);
  assert.deepEqual(namesFor("plannedPhase", "future-review"), ["labels"]);
  assert.deepEqual(namesFor("implementationStatus", "thin-wrapper"), ["borders", "labels"]);
  assert.deepEqual(namesFor("implementationStatus", "owned-p3"), [
    "background",
    "political",
    "contextBase",
    "contextScenario",
    "effects",
    "lineEffects",
    "dayNight",
    "contextMarkers",
    "textureLabels",
  ]);
  assert.deepEqual(namesFor("implementationStatus", "hold"), []);
});

test("population heatmap inventory binds its raster owner, composition order, and export gate", () => {
  const population = RENDER_PASS_FAMILY_INVENTORY.find((record) => record.passName === "populationHeatmap");
  assert.equal(population.familyId, "political");
  assert.equal(population.entryFunction, "drawPopulationHeatmapPass");
  assert.equal(population.implementationStatus, "delegated-existing");
  assert.equal(population.riskTier, "high");
  assert.equal(population.perfSensitivity, "high");
  assert.deepEqual(population.existingDependencyOwners, [
    "js/core/renderer/population_heatmap_render_owner.js",
    "js/core/population_spatial_runtime.js",
    "js/core/population_spatial_data.js",
    "js/core/population_spatial_view_model.js",
  ]);
  assert.deepEqual(population.browserLanes, []);
  assert.match(population.notes, /dedicated browser lane gap/);
  assert.match(population.notes, /statistics remain offline sidecar data/);

  const passCatalog = readText("js", "core", "map_renderer", "render_pass_catalog.js");
  for (const name of [
    "RENDER_PASS_NAMES",
    "TRANSFORM_REUSED_RENDER_PASS_NAMES",
    "INTERACTION_COMPOSITE_PASS_NAMES",
    "TRANSFORMED_FRAME_PASS_NAMES",
  ]) {
    const block = passCatalog.match(new RegExp(`export const ${name} = (?:new Set\\()?\\[([\\s\\S]*?)\\]`));
    assert.ok(block, `${name} should retain an explicit pass list`);
    const passes = [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    assert.equal(passes.indexOf("populationHeatmap"), passes.indexOf("political") + 1,
      `${name} should composite population immediately after political`);
    if (passes.includes("borders")) {
      assert.ok(passes.indexOf("populationHeatmap") < passes.indexOf("borders"), `${name} should preserve visible borders`);
    }
  }
  const visibilityPolicy = readText("js", "core", "map_renderer", "render_pass_visibility_policy.js");
  assert.match(visibilityPolicy, /populationHeatmap:\s*populationHeatmapEnabled/);
  const settleCatalog = readText("js", "core", "renderer", "exact_after_settle_pass_catalog.js");
  assert.match(settleCatalog, /EXACT_AFTER_SETTLE_ALWAYS_TARGET_PASSES = \[\s*"political",\s*"populationHeatmap",\s*"borders"/);
  const entryHost = readText(...population.entryHostPath.split("/"));
  assert.match(entryHost, /function drawPopulationHeatmapPass\(k\) \{[\s\S]{0,400}return getPopulationHeatmapRenderOwner\(\)\.draw\(k\)/);
  assert.match(entryHost, /sampleDensity:\s*samplePopulationDensityLonLat/);
  assert.match(entryHost, /if \(passNames\.includes\("populationHeatmap"\)\) assertPopulationHeatmapReadyForExport\(\)/);
});

test("all 13 records resolve entry hosts and reviewed dependency anchors", () => {
  const transportOwnerSource = readText("js", "core", "renderer", "transport_overview_render_owner.js");
  const uiStateSource = readText("js", "core", "state", "ui_state.js");
  assert.match(transportOwnerSource, /ensureTransportOverviewStyleConfigState\(runtimeState\)/);
  assert.match(
    uiStateSource,
    /export function ensureTransportOverviewStyleConfigState\(target\) \{[\s\S]{0,500}target\.styleConfig\.transportOverview\s*=/,
  );
  for (const record of RENDER_PASS_FAMILY_INVENTORY) {
    const entryHostSource = readText(...record.entryHostPath.split("/"));
    assert.match(entryHostSource, new RegExp(`function\\s+${record.entryFunction}\\s*\\(`), `${record.passName} entry should exist in its host`);
    assert.equal(record.stateWriteClass.includes("pass-surface"), true);
    assert.equal(record.canvasOrSvg, "canvas");
    assert.equal(new Set(record.existingDependencyOwners).size, record.existingDependencyOwners.length);
    for (const dependencyPath of record.existingDependencyOwners) {
      assert.equal(dependencyPath.includes("\\"), false, `${record.passName} dependencies should use POSIX paths`);
      assert.equal(fs.existsSync(path.join(REPO_ROOT, dependencyPath)), true, `${dependencyPath} should exist`);
      const importHostPath = DEPENDENCY_IMPORT_HOST_OVERRIDES.get(dependencyPath) || record.entryHostPath;
      assert.equal(
        collectStaticImports(importHostPath).has(dependencyPath),
        true,
        `${record.passName} dependency should be directly imported by ${importHostPath}: ${dependencyPath}`,
      );
    }
  }
  assert.ok(
    RENDER_PASS_FAMILY_INVENTORY.find((record) => record.passName === "physicalBase")
      .existingDependencyOwners.includes("js/core/renderer/physical_layer_render_owner.js"),
  );
});

test("browser lanes resolve to package scripts", () => {
  const packageScripts = JSON.parse(readText("package.json")).scripts;
  for (const record of RENDER_PASS_FAMILY_INVENTORY) {
    assert.equal(new Set(record.browserLanes).size, record.browserLanes.length);
    for (const lane of record.browserLanes) assert.equal(typeof packageScripts[lane], "string", `${lane} should be a package script`);
  }
  assert.deepEqual(
    RENDER_PASS_FAMILY_INVENTORY.find((record) => record.passName === "textureLabels").browserLanes,
    ["test:e2e:layer:regression"],
  );
  assert.deepEqual(
    RENDER_PASS_FAMILY_INVENTORY.find((record) => record.passName === "political").browserLanes,
    [
      "test:e2e:dev:political-progressive-recovery",
      "test:e2e:dev:scenario-chunk-runtime",
      "test:e2e:scenario-resilience",
      "test:e2e:physical-layer-runtime-contract",
      "test:e2e:water-rendering",
      "test:e2e:tno-contracts",
    ],
  );
});

test("inventory remains data-only and isolated from the product source graph", () => {
  const inventorySource = readText(...INVENTORY_PATH.split("/"));
  const testSource = readText("tests", "renderer_pass_family_inventory_behavior.test.mjs");
  assert.doesNotMatch(inventorySource, /^\s*import\s/m);
  assert.doesNotMatch(inventorySource, /\bimport\s*\(/);

  const imports = [...testSource.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.equal(imports.every((specifier) => specifier.startsWith("node:") || specifier === "../tools/renderer_pass_family_inventory.mjs"), true);

  let productReferences = "";
  try {
    productReferences = execFileSync("git", ["grep", "-n", "renderer_pass_family_inventory", "--", "js", "dist"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    assert.equal(error.status, 1, error.stderr?.toString() || "git grep should only exit 1 for zero matches");
  }
  assert.equal(productReferences, "");
});
