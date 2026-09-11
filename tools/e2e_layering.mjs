import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { buildE2eRoutes } from "./test_route_registry.mjs";

const REPO_ROOT = process.cwd();
const MANIFEST_PATH = path.join(REPO_ROOT, "tests", "e2e", "test-layer-manifest.json");
const TEST_LIST_DIR = path.join(REPO_ROOT, "tests", "e2e", "test-lists");
const RUNTIME_TEST_LIST_DIR = path.join(REPO_ROOT, ".runtime", "tests", "e2e-lists");
const PLAYWRIGHT_CLI = path.join(REPO_ROOT, "node_modules", "@playwright", "test", "cli.js");
const VALID_LAYERS = new Set(["smoke", "contract", "regression", "feature"]);
const VALID_EXECUTION_MODES = new Set(["browser", "hybrid", "static-contract"]);
const LAYER_ORDER = ["smoke", "contract", "regression", "feature", "all"];
const NON_SMOKE_LAYERS = ["contract", "regression", "feature"];
const EXPECTED_E2E_SPEC_COUNT = 49;
// 第一阶段 smoke 明确写死为这 4 个 spec，避免入口再次漂移。
const FIXED_SMOKE_SPECS = [
  "tests/e2e/main_shell_i18n.spec.js",
  "tests/e2e/hoi4_1939_ui_smoke.spec.js",
  "tests/e2e/tno_1962_ui_smoke.spec.js",
  "tests/e2e/ui_contract_foundation.spec.js",
];
const KNOWN_DIRECT_E2E_SCRIPT_TARGETS = new Set([
  "tests/e2e/ui_contract_foundation.spec.js",
  "tests/e2e/ui_rework_mainline_shell_sidebar.spec.js",
  "tests/e2e/ui_rework_support_transport_hardening.spec.js",
  "tests/e2e/scenario_apply_concurrency.spec.js",
  "tests/e2e/startup_bundle_recovery_contract.spec.js",
  "tests/e2e/scenario_shell_overlay_contract.spec.js",
  "tests/e2e/physical_layer_regression.spec.js",
  "tests/e2e/physical_layer_runtime_contract.spec.js",
  "tests/e2e/main_shell_i18n.spec.js",
  "tests/e2e/hoi4_1939_ui_smoke.spec.js",
  "tests/e2e/tno_1962_ui_smoke.spec.js",
  "tests/e2e/strategic_overlay_smoke.spec.js",
  "tests/e2e/project_save_load_roundtrip.spec.js",
  "tests/e2e/interaction_funnel_contract.spec.js",
  "tests/e2e/scenario_apply_resilience.spec.js",
]);

function readManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
}

function listRepoSpecs() {
  return fs
    .readdirSync(path.join(REPO_ROOT, "tests", "e2e"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".spec.js"))
    .map((entry) => toRepoPath(path.join("tests", "e2e", entry.name)))
    .sort();
}

function toRepoPath(value) {
  return value.split(path.sep).join("/");
}

// Playwright 的 --test-list 需要相对 testDir 的条目，这里统一降到文件名层。
function toTestListEntry(specPath) {
  return path.posix.basename(specPath);
}

function ensure(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function buildExpectedLists(specs) {
  const byLayer = new Map([
    ["smoke", FIXED_SMOKE_SPECS.map(toTestListEntry)],
    ["contract", []],
    ["regression", []],
    ["feature", []],
  ]);

  for (const spec of specs) {
    if (spec.primaryLayer === "smoke") {
      continue;
    }
    byLayer.get(spec.primaryLayer).push(toTestListEntry(spec.specPath));
  }

  for (const layer of NON_SMOKE_LAYERS) {
    byLayer.set(layer, byLayer.get(layer).sort());
  }

  const allSpecs = specs.map((spec) => toTestListEntry(spec.specPath)).sort();
  byLayer.set("all", allSpecs);
  return byLayer;
}

function validateManifest() {
  const manifest = readManifest();
  const specs = Array.isArray(manifest?.specs) ? manifest.specs : [];
  const repoSpecs = listRepoSpecs();
  const repoSpecSet = new Set(repoSpecs);
  const seenSpecPaths = new Set();

  ensure(manifest?.scope === "tests/e2e/*.spec.js", `Unexpected manifest scope: ${manifest?.scope}`);
  ensure(specs.length === EXPECTED_E2E_SPEC_COUNT, `Manifest must contain ${EXPECTED_E2E_SPEC_COUNT} specs, found ${specs.length}.`);
  ensure(repoSpecs.length === EXPECTED_E2E_SPEC_COUNT, `Repository currently exposes ${repoSpecs.length} Playwright specs under tests/e2e.`);

  for (const spec of specs) {
    ensure(typeof spec?.specPath === "string" && spec.specPath.startsWith("tests/e2e/"), `Invalid specPath: ${spec?.specPath}`);
    ensure(spec.specPath.endsWith(".spec.js"), `Manifest entry must point to a .spec.js file: ${spec.specPath}`);
    ensure(repoSpecSet.has(spec.specPath), `Manifest entry does not exist on disk: ${spec.specPath}`);
    ensure(!seenSpecPaths.has(spec.specPath), `Duplicate manifest entry: ${spec.specPath}`);
    ensure(VALID_LAYERS.has(spec.primaryLayer), `Invalid primaryLayer for ${spec.specPath}: ${spec.primaryLayer}`);
    ensure(VALID_EXECUTION_MODES.has(spec.executionMode), `Invalid executionMode for ${spec.specPath}: ${spec.executionMode}`);
    ensure(spec.executionMode !== "static-contract", `Playwright E2E manifest must stay Playwright-only: ${spec.specPath}`);
    ensure(typeof spec.domain === "string" && spec.domain.trim(), `Missing domain for ${spec.specPath}`);
    ensure(typeof spec.ownerHint === "string" && spec.ownerHint.trim(), `Missing ownerHint for ${spec.specPath}`);
    seenSpecPaths.add(spec.specPath);
  }

  ensure(repoSpecs.every((specPath) => seenSpecPaths.has(specPath)), "Manifest coverage diverges from tests/e2e/*.spec.js.");

  const actualSmokeEntries = specs
    .filter((spec) => spec.primaryLayer === "smoke")
    .map((spec) => spec.specPath);
  ensure(actualSmokeEntries.length === FIXED_SMOKE_SPECS.length, "Smoke layer must contain exactly 4 specs.");
  ensure(
    FIXED_SMOKE_SPECS.every((specPath) => actualSmokeEntries.includes(specPath)),
    "Smoke layer must stay fixed to the approved 4 spec set."
  );
  ensure(!actualSmokeEntries.includes("tests/e2e/scenario_apply_resilience.spec.js"), "scenario_apply_resilience.spec.js must stay outside smoke.");

  const expectedLists = buildExpectedLists(specs);
  for (const specPath of KNOWN_DIRECT_E2E_SCRIPT_TARGETS) {
    ensure(repoSpecSet.has(specPath), `Known direct E2E script target is missing on disk: ${specPath}`);
  }

  return { specs, expectedLists };
}

function writeLayerTestLists(outputDir = TEST_LIST_DIR) {
  const { specs, expectedLists } = validateManifest();
  fs.mkdirSync(outputDir, { recursive: true });

  for (const layer of LAYER_ORDER) {
    const entries = expectedLists.get(layer);
    const filePath = path.join(outputDir, `${layer}.txt`);
    fs.writeFileSync(filePath, `${entries.join("\n")}\n`, "utf8");
  }

  return specs.length;
}

function writeFilteredTestList(name, specs) {
  validateManifest();
  fs.mkdirSync(RUNTIME_TEST_LIST_DIR, { recursive: true });
  const filePath = path.join(RUNTIME_TEST_LIST_DIR, `${name}.txt`);
  const entries = specs.map((spec) => toTestListEntry(spec.specPath)).sort();
  fs.writeFileSync(filePath, `${entries.join("\n")}\n`, "utf8");
  return filePath;
}

function checkGeneratedTestLists() {
  const { specs, expectedLists } = validateManifest();
  for (const layer of LAYER_ORDER) {
    const filePath = path.join(TEST_LIST_DIR, `${layer}.txt`);
    ensure(fs.existsSync(filePath), `Missing generated test list: ${toRepoPath(path.relative(REPO_ROOT, filePath))}`);
    const actualEntries = fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const expectedEntries = expectedLists.get(layer);
    ensure(
      actualEntries.join("\n") === expectedEntries.join("\n"),
      `Generated test list mismatch for ${layer}.`
    );
  }
  return {
    specCount: specs.length,
    smokeSpecs: FIXED_SMOKE_SPECS,
    directScriptTargetCount: KNOWN_DIRECT_E2E_SCRIPT_TARGETS.size,
  };
}

function runLayer(layer, extraArgs) {
  ensure(LAYER_ORDER.includes(layer), `Unknown layer: ${layer}`);
  writeLayerTestLists(RUNTIME_TEST_LIST_DIR);

  const testListPath = path.join(RUNTIME_TEST_LIST_DIR, `${layer}.txt`);
  const cliArgs = [PLAYWRIGHT_CLI, "test", `--test-list=${testListPath}`];

  // smoke 的 workers / retries 约束只在脚本层实现，不改全局 Playwright 配置。
  if (layer === "smoke") {
    cliArgs.push("--workers=2", "--retries=0");
  }

  cliArgs.push(...extraArgs);

  const result = spawnSync(process.execPath, cliArgs, {
    stdio: "inherit",
    cwd: REPO_ROOT,
  });

  if (typeof result.status === "number") {
    process.exit(result.status);
  }

  process.exit(1);
}


function specsForField(field, value) {
  const { specs } = validateManifest();
  const matches = specs.filter((spec) => spec[field] === value);
  ensure(matches.length > 0, `No E2E specs found for ${field}=${value}.`);
  return matches;
}

function specsForSpecPath(specPath) {
  const normalizedPath = toRepoPath(specPath);
  const matches = specsForField("specPath", normalizedPath);
  ensure(matches.length === 1, `Expected exactly one E2E spec for ${normalizedPath}.`);
  return matches;
}

function listSpecsForField(field, value) {
  const matches = specsForField(field, value);
  for (const spec of matches) {
    console.log(`${spec.specPath}	${spec.primaryLayer}	${spec.domain}	${spec.ownerHint}`);
  }
}

function runSpecs(name, specs, extraArgs) {
  const testListPath = writeFilteredTestList(name, specs);
  const cliArgs = [PLAYWRIGHT_CLI, "test", `--test-list=${testListPath}`, "--workers=1", "--retries=0", ...extraArgs];
  const result = spawnSync(process.execPath, cliArgs, {
    stdio: "inherit",
    cwd: REPO_ROOT,
  });

  if (typeof result.status === "number") {
    process.exit(result.status);
  }

  process.exit(1);
}

function explainSpec(specPath) {
  validateManifest();
  const normalizedPath = toRepoPath(specPath);
  const route = buildE2eRoutes().find((candidate) => candidate.sourceRef === normalizedPath);
  ensure(route, `No E2E route found for ${normalizedPath}.`);
  console.log(JSON.stringify(route, null, 2));
}

function main() {
  const [, , command, maybeLayer, ...restArgs] = process.argv;

  switch (command) {
    case "generate": {
      const count = writeLayerTestLists(TEST_LIST_DIR);
      console.log(`Generated ${LAYER_ORDER.length} test lists from ${count} manifest entries.`);
      return;
    }
    case "check":
      {
        const summary = checkGeneratedTestLists();
        console.log(`Smoke specs: ${summary.smokeSpecs.join(", ")}`);
        console.log(`Known direct E2E script targets: ${summary.directScriptTargetCount}`);
        console.log(`Manifest spec count: ${summary.specCount}`);
      }
      console.log("E2E layer manifest coverage check passed.");
      return;
    case "run": {
      const extraArgs = restArgs[0] === "--" ? restArgs.slice(1) : restArgs;
      runLayer(maybeLayer, extraArgs);
      return;
    }
    case "list-domain":
      listSpecsForField("domain", maybeLayer);
      return;
    case "run-domain": {
      const extraArgs = restArgs[0] === "--" ? restArgs.slice(1) : restArgs;
      runSpecs(`domain-${maybeLayer}`, specsForField("domain", maybeLayer), extraArgs);
      return;
    }
    case "list-owner":
      listSpecsForField("ownerHint", maybeLayer);
      return;
    case "run-owner": {
      const extraArgs = restArgs[0] === "--" ? restArgs.slice(1) : restArgs;
      runSpecs(`owner-${maybeLayer}`, specsForField("ownerHint", maybeLayer), extraArgs);
      return;
    }
    case "run-spec": {
      const extraArgs = restArgs[0] === "--" ? restArgs.slice(1) : restArgs;
      const matches = specsForSpecPath(maybeLayer);
      const specName = path.posix.basename(matches[0].specPath, ".spec.js");
      runSpecs(`spec-${specName}`, matches, extraArgs);
      return;
    }
    case "explain":
      explainSpec(maybeLayer);
      return;
  }

  throw new Error("Usage: node tools/e2e_layering.mjs <generate|check|run <layer>|list-domain <domain>|run-domain <domain>|list-owner <owner>|run-owner <owner>|run-spec <specPath>|explain <specPath>>");
}

main();
