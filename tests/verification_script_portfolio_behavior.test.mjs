import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildVerificationCatalog,
  buildRepositoryVerificationCatalog,
  buildRepositoryVerificationSelectionPlan,
  buildVerificationSelectionPlan,
  assertPreparedVerificationCatalog,
  assertVerificationEstimatePolicy,
  buildScriptPortfolio,
  CANONICAL_VERIFICATION_ENTRYPOINTS,
  VERIFICATION_PRODUCT_JOURNEY_ENTRYPOINTS,
  VERIFICATION_TIER_ENTRYPOINTS,
  checkVerificationCatalogConsistency,
  formatScriptPortfolioJson,
  formatScriptPortfolioMarkdown,
  formatScriptPortfolioSummary,
  parseScriptPortfolioArgs,
  normalizeVerificationPath,
  prepareVerificationCatalog,
  prepareRepositoryVerificationCatalog,
  runScriptPortfolioCli,
  sealVerificationCatalog,
  VERIFICATION_METADATA_SOURCE_IDENTITY,
} from "../tools/verification/script_portfolio.mjs";
import {
  buildRouteIndex,
  ROUTE_REGISTRY_SOURCE_IDENTITY,
  validateDiscoveredRouteCoverage,
} from "../tools/test_route_registry.mjs";
import { COMMAND_SUPERSESSION_SOURCE_IDENTITY } from "../tools/verification/command_supersession.mjs";
import {
  VERIFICATION_DOMAINS,
  VERIFICATION_ESTIMATE_POLICY,
} from "../tools/verification/verification_domains.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI_PATH = path.join(REPO_ROOT, "tools", "verification", "script_portfolio.mjs");

test("runtime calibration rejects malformed or duplicate measurements", () => {
  for (const patch of [
    { platform: "unknown" }, { cost: "unknown" }, { groupBaseRuntimeSeconds: -1 },
    { perLeafRuntimeSeconds: 0 }, { leafIds: [] }, { leafIds: [42] },
    { leafIds: ["node-test:tests/a", "node-test:tests/a"] },
  ]) {
    const policy = structuredClone(VERIFICATION_ESTIMATE_POLICY);
    Object.assign(policy.localRuntimeCalibration, patch);
    assert.throws(() => assertVerificationEstimatePolicy(policy), /invalid-calibration/);
  }
  assert.equal(assertVerificationEstimatePolicy(VERIFICATION_ESTIMATE_POLICY), VERIFICATION_ESTIMATE_POLICY);
});

test("canonical metadata owns runtime projections and checks actual package scripts", () => {
  const packageScripts = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")).scripts;
  assert.deepEqual(ROUTE_REGISTRY_SOURCE_IDENTITY, VERIFICATION_METADATA_SOURCE_IDENTITY);
  assert.deepEqual(COMMAND_SUPERSESSION_SOURCE_IDENTITY, VERIFICATION_METADATA_SOURCE_IDENTITY);
  const prepared = prepareRepositoryVerificationCatalog({ packageScripts });
  assert.deepEqual(prepared.sourceIdentity.metadataSourceIdentity, VERIFICATION_METADATA_SOURCE_IDENTITY);
  assert.throws(
    () => prepareRepositoryVerificationCatalog({ packageScripts: { ...packageScripts, "verify:commit": "node forged-commit.mjs" } }),
    /verification-catalog-package-shadow-drift/,
  );
});

test("retired metadata shadow CLI is rejected rather than reporting fabricated equality", () => {
  assert.throws(() => parseScriptPortfolioArgs(["shadow-check"]), /unknown-action/);
});

test("actual package and manifest entries detect missing routes without a legacy table", () => {
  const fixture = {
    packageJson: { scripts: { "test:node:new-behavior": "node --test tests/new.test.mjs" } },
    e2eRoutes: [{ commandRef: "node tools/e2e_layering.mjs run-spec tests/e2e/new.spec.js" }],
    heavyGroups: {},
  };
  const routes = [{ commandRef: "test:node:new-behavior" }, ...fixture.e2eRoutes];
  assert.deepEqual(validateDiscoveredRouteCoverage(routes, fixture), { discoveredCommands: 2 });
  assert.throws(() => validateDiscoveredRouteCoverage(routes.slice(1), fixture), /coverage-missing:test:node:new-behavior/);
  assert.throws(() => validateDiscoveredRouteCoverage(routes.slice(0, 1), fixture), /coverage-missing:node tools\/e2e_layering/);
});

test("Python discovery requires coverage and accepts only covered aliases and aggregates", () => {
  const scripts = {
    "test:py:new-contract": "npm run python -- -m unittest tests.test_new_contract -q",
    "test:python:alias": "npm run test:py:new-contract",
    "test:python:aggregate": "npm run test:py:new-contract && npm run test:python:alias",
  };
  const fixture = { packageJson: { scripts }, e2eRoutes: [], heavyGroups: {} };
  assert.throws(() => validateDiscoveredRouteCoverage([], fixture), /coverage-missing:.*test:py:new-contract/);
  assert.deepEqual(validateDiscoveredRouteCoverage([
    { commandRef: "python -m unittest tests.test_new_contract -q" },
  ], fixture), { discoveredCommands: 3 });
  assert.throws(() => validateDiscoveredRouteCoverage([], {
    ...fixture, packageJson: { scripts: { "test:python:standalone": "python -m unittest tests.test_other -q" } },
  }), /coverage-missing:test:python:standalone/);
  assert.throws(() => validateDiscoveredRouteCoverage([{ commandRef: "test:py:new-contract" }], {
    ...fixture, packageJson: { scripts: { ...scripts, "test:python:mixed": "npm run test:py:new-contract && python extra.py" } },
  }), /coverage-missing:test:python:mixed/);
});

test("repository builders reject every caller-owned authority surface before planning", () => {
  const packageScripts = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")).scripts;
  const selectorRoutes = buildRouteIndex();
  const forgedRoute = {
    ...structuredClone(selectorRoutes[0]),
    id: "forged:repository-authority",
    sourceRef: "tests/forged_repository_authority.test.mjs",
  };
  const customEstimatePolicy = structuredClone(VERIFICATION_ESTIMATE_POLICY);
  customEstimatePolicy.costClasses.fast.perLeafCostUnits += 1;
  let runnerSpawns = 0;
  const forbiddenRunner = () => {
    runnerSpawns += 1;
    throw new Error("forbidden-runner-spawned");
  };

  assert.throws(
    () => buildRepositoryVerificationCatalog({
      packageScripts,
      verificationRecords: VERIFICATION_DOMAINS.slice(1),
      catalogBuilder: forbiddenRunner,
    }),
    /verification-catalog-repository-authority-override:verificationRecords/,
  );
  assert.throws(
    () => prepareRepositoryVerificationCatalog({
      packageScripts,
      selectorRoutes: [...selectorRoutes, forgedRoute],
      authorityReconciler: forbiddenRunner,
    }),
    /verification-catalog-repository-authority-override:selectorRoutes/,
  );
  assert.throws(
    () => buildRepositoryVerificationSelectionPlan({
      packageScripts,
      roots: [],
      estimatePolicy: customEstimatePolicy,
      catalogBuilder: forbiddenRunner,
    }),
    /verification-catalog-repository-authority-override:estimatePolicy/,
  );
  assert.equal(runnerSpawns, 0);
});

test("fixture builders cannot self-report repository or shadow authority", () => {
  const fixtureInput = {
    packageScripts: { forged: "node --test tests/forged.test.mjs" },
    selectorRoutes: [{ ...route("forged", "forged"), id: "fixture:forged" }],
  };
  for (const sourceMode of ["repository", "shadow"]) {
    assert.throws(
      () => prepareVerificationCatalog({ ...fixtureInput, sourceMode }),
      new RegExp(`verification-catalog-fixture-source-mode-forbidden:${sourceMode}`),
    );
    assert.throws(
      () => buildVerificationCatalog({ ...fixtureInput, sourceMode }),
      new RegExp(`verification-catalog-fixture-source-mode-forbidden:${sourceMode}`),
    );
  }
  const preparedFixture = prepareVerificationCatalog(fixtureInput);
  assert.equal(preparedFixture.sourceMode, "fixture");
  assert.equal(preparedFixture.catalog.sourceMode, "fixture");
});

test("production planning rejects self-consistent forged repository authority before execution", () => {
  const fixtureInput = {
    packageScripts: { forged: "node --test tests/forged.test.mjs" },
    selectorRoutes: [{ ...route("forged", "forged"), id: "fixture:forged" }],
  };
  const fixture = prepareVerificationCatalog(fixtureInput);
  const forgedPrepared = structuredClone(fixture);
  forgedPrepared.sourceMode = "repository";
  forgedPrepared.sourceIdentity.sourceMode = "repository";
  forgedPrepared.sourceInputs.sourceMode = "repository";
  forgedPrepared.catalog = sealVerificationCatalog({
    ...forgedPrepared.catalog,
    sourceMode: "repository",
  });
  forgedPrepared.catalogDigest = forgedPrepared.catalog.sourceIntegrity.digest;
  let executions = 0;
  let runnerSpawns = 0;
  assert.throws(
    () => {
      const plan = buildVerificationSelectionPlan(forgedPrepared.catalog, ["forged"], {
        preparedCatalog: forgedPrepared,
        runner() {
          runnerSpawns += 1;
        },
      });
      executions = plan.executions.length;
    },
    /verification-plan-source-authority-drift/,
  );
  assert.equal(executions, 0);
  assert.equal(runnerSpawns, 0);

  const forgedCatalog = sealVerificationCatalog({
    ...fixture.catalog,
    sourceMode: "repository",
  });
  assert.throws(
    () => buildVerificationSelectionPlan(forgedCatalog, ["forged"], {
      sourceInputs: {
        ...fixture.sourceInputs,
        sourceMode: "repository",
      },
    }),
    /verification-plan-source-authority-drift/,
  );
  const shadowCatalog = sealVerificationCatalog({
    ...fixture.catalog,
    sourceMode: "shadow",
  });
  assert.throws(
    () => buildVerificationSelectionPlan(shadowCatalog, ["forged"]),
    /verification-plan-source-authority-drift/,
  );
  assert.equal(executions, 0);
  assert.equal(runnerSpawns, 0);
});

function completeFixture(extra = {}) {
  return {
    "verify:commit": "node commit.mjs",
    "verify:core": "node core.mjs",
    "verify:impact": "node impact.mjs",
    "verify:release": "node release.mjs",
    "verify:pr": "node pr.mjs",
    "verify:nightly": "node nightly.mjs",
    "verify:demo": "node demo.mjs",
    ...extra,
  };
}

test("classifies every script exactly once with stable name ordering", () => {
  const portfolio = buildScriptPortfolio(completeFixture({
    zeta: "node zeta.mjs",
    alpha: "node alpha.mjs",
  }));
  assert.deepEqual(portfolio.canonicalEntrypoints, CANONICAL_VERIFICATION_ENTRYPOINTS);
  assert.deepEqual(portfolio.tierEntrypoints, VERIFICATION_TIER_ENTRYPOINTS);
  assert.deepEqual(portfolio.productJourneyEntrypoints, VERIFICATION_PRODUCT_JOURNEY_ENTRYPOINTS);
  assert.deepEqual(portfolio.scripts.map((entry) => entry.name), [
    "alpha",
    "verify:commit",
    "verify:core",
    "verify:demo",
    "verify:impact",
    "verify:nightly",
    "verify:pr",
    "verify:release",
    "zeta",
  ]);
  assert.deepEqual(portfolio.summary, {
    total: 9,
    canonical: 7,
    internal: 2,
    superseded: 0,
    complete: true,
  });
  assert.equal(new Set(portfolio.scripts.map((entry) => entry.name)).size, portfolio.summary.total);
});

test("uses the exact supersession graph and records the retained superseder", () => {
  const portfolio = buildScriptPortfolio(completeFixture({
    "verify:p4:p4-3": "node composite.mjs",
    "verify:p4:state-writer-policy": "node policy.mjs",
    "test:node:p4:state-writer-policy": "node full.mjs",
    "test:node:p4:state-writer-policy:quick": "node quick.mjs",
    "unrelated:leaf": "node unrelated.mjs",
  }));
  const byName = new Map(portfolio.scripts.map((entry) => [entry.name, entry]));
  assert.deepEqual(byName.get("verify:p4:state-writer-policy"), {
    name: "verify:p4:state-writer-policy",
    command: "node policy.mjs",
    classification: "superseded",
    supersededBy: "verify:p4:p4-3",
  });
  assert.equal(byName.get("test:node:p4:state-writer-policy:quick").supersededBy, "verify:p4:p4-3");
  assert.equal(byName.get("unrelated:leaf").classification, "internal");
});

test("does not infer supersession when the exact superseder is absent", () => {
  const portfolio = buildScriptPortfolio(completeFixture({
    "test:node:supervisor-contracts": "node contract.mjs",
  }));
  assert.equal(
    portfolio.scripts.find((entry) => entry.name === "test:node:supervisor-contracts").classification,
    "internal",
  );
});

test("reports every missing canonical entrypoint in contract order", () => {
  const portfolio = buildScriptPortfolio({ "verify:pr": "node pr.mjs" });
  assert.deepEqual(portfolio.missingCanonicalEntrypoints, [
    "verify:commit",
    "verify:impact",
    "verify:core",
    "verify:nightly",
    "verify:release",
    "verify:demo",
  ]);
  assert.equal(portfolio.summary.complete, false);
});

test("rejects blank script names and commands before completeness is evaluated", () => {
  assert.throws(() => buildScriptPortfolio({ "": "node valid.mjs" }), /invalid-name/);
  assert.throws(() => buildScriptPortfolio(completeFixture({ "verify:demo": "   " })), /blank-command:verify:demo/);
  assert.throws(() => buildScriptPortfolio({ internal: 7 }), /invalid-command:internal/);
});

test("JSON, Markdown, and summary formats are deterministic", () => {
  const portfolio = buildScriptPortfolio(completeFixture({ internal: "node x.mjs | tee out" }));
  assert.equal(formatScriptPortfolioJson(portfolio), formatScriptPortfolioJson(portfolio));
  assert.match(formatScriptPortfolioMarkdown(portfolio), /\| internal \| internal \|  \| node x\.mjs \\| tee out \|/);
  assert.equal(
    formatScriptPortfolioSummary(portfolio),
    "scripts=8 canonical=7 internal=1 superseded=0 complete=true missingCanonical=none\n",
  );
});

test("CLI argument parsing is fail-closed", () => {
  assert.deepEqual(parseScriptPortfolioArgs(["check", "--format", "json", "--package", "fixture.json"]), {
    action: "check",
    format: "json",
    packagePath: path.resolve("fixture.json"),
  });
  assert.throws(() => parseScriptPortfolioArgs(["publish"]), /unknown-action/);
  assert.throws(() => parseScriptPortfolioArgs(["list", "--format", "yaml"]), /unknown-format/);
  assert.throws(() => parseScriptPortfolioArgs(["list", "--package"]), /missing-value/);
  assert.throws(() => parseScriptPortfolioArgs(["list", "--wat"]), /unknown-argument/);
});

test("CLI check succeeds for a complete fixture and fails with explicit missing canonical names", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "script-portfolio-"));
  try {
    const completePath = path.join(tempDir, "complete.json");
    const incompletePath = path.join(tempDir, "incomplete.json");
    fs.writeFileSync(completePath, JSON.stringify({ scripts: completeFixture() }));
    fs.writeFileSync(incompletePath, JSON.stringify({ scripts: { internal: "node internal.mjs" } }));
    const complete = spawnSync(process.execPath, [CLI_PATH, "check", "--package", completePath], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    assert.equal(complete.status, 0, complete.stderr);
    assert.match(complete.stdout, /complete=true missingCanonical=none/);
    const incomplete = spawnSync(process.execPath, [CLI_PATH, "check", "--format", "json", "--package", incompletePath], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    assert.equal(incomplete.status, 1, incomplete.stderr);
    assert.deepEqual(JSON.parse(incomplete.stdout).missingCanonicalEntrypoints, CANONICAL_VERIFICATION_ENTRYPOINTS);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("real package list is read-only and stable", () => {
  const result = spawnSync(process.execPath, [CLI_PATH, "list", "--format", "json"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const portfolio = JSON.parse(result.stdout);
  const packageJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  assert.equal(portfolio.summary.total, Object.keys(packageJson.scripts).length);
  assert.equal(portfolio.scripts.length, portfolio.summary.total);
});

test("real package check enforces catalog consistency through the retained CLI entrypoint", () => {
  const result = spawnSync(process.execPath, [CLI_PATH, "check"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /complete=true missingCanonical=none/);
});

function route(commandRef, domain, overrides = {}) {
  return {
    commandRef,
    sourceRef: "tests/fixture_authority.test.mjs",
    domain,
    ownerHint: "fixture-authority",
    cost: "fast",
    executionOwner: "child-safe",
    platforms: ["linux", "win32"],
    resourceLocks: [],
    tier: "contract",
    ciProfile: "pr-fast",
    ...overrides,
  };
}

test("builds a canonical catalog from package scripts and route records", () => {
  const catalog = buildVerificationCatalog({
    packageScripts: {
      "test:node:a": "node --test tests\\a.test.mjs --test-name-pattern 'works here'",
      "test:python:b": "npm run python -- -m unittest tests.test_b -q",
      "test:python:path": "python -m unittest tests\\test_path.py -q",
      "test:python:discover": "python -m unittest discover -s tests -p 'test_*.py'",
      "test:python:pytest": "python -m pytest tests/test_pytest.py -q",
      "test:e2e:c": "node node_modules/@playwright/test/cli.js test tests/e2e/c.spec.js --workers=1",
      "verify:all": "npm run test:node:a && npm run test:python:b",
    },
    records: [
      route("test:node:a", "node-domain"),
      route("test:node:a", "shared-domain", { tier: "heavy", ciProfile: "full" }),
      route("test:python:b", "python-domain"),
      route("test:e2e:c", "browser-domain", {
        cost: "heavy",
        executionOwner: "main-thread",
        platforms: ["linux"],
        resourceLocks: ["playwright-browser", ".runtime-output"],
        tier: "heavy",
        ciProfile: "pr-smoke",
      }),
    ],
  });
  const byId = new Map(catalog.entries.map((entry) => [entry.id, entry]));
  assert.deepEqual(byId.get("test:node:a"), {
    id: "test:node:a",
    kind: "leaf",
    command: "node --test tests\\a.test.mjs --test-name-pattern 'works here'",
    executable: "node",
    argv: ["--test", "tests\\a.test.mjs", "--test-name-pattern", "works here"],
    runner: "node-test",
    files: ["tests/a.test.mjs"],
    modules: [],
    specs: [],
    runnerArgs: ["--test-name-pattern", "works here"],
    domains: ["node-domain", "shared-domain"],
    cost: "fast",
    executionOwner: "child-safe",
    platforms: ["linux", "win32"],
    resourceLocks: [],
    tiers: ["contract", "heavy"],
    ciProfiles: ["full", "pr-fast"],
    metadataComplete: true,
  });
  assert.equal(byId.get("test:python:b").runner, "python-unittest");
  assert.deepEqual(byId.get("test:python:b").modules, ["tests.test_b"]);
  assert.deepEqual(byId.get("test:python:path").files, ["tests/test_path.py"]);
  assert.deepEqual(byId.get("test:python:discover").files, ["tests/test_*.py"]);
  assert.equal(byId.get("test:python:pytest").runner, "python-pytest");
  assert.deepEqual(byId.get("test:python:pytest").files, ["tests/test_pytest.py"]);
  assert.equal(byId.get("test:e2e:c").runner, "playwright");
  assert.deepEqual(byId.get("test:e2e:c").specs, ["tests/e2e/c.spec.js"]);
  assert.deepEqual(byId.get("verify:all").refs, [
    { id: "test:node:a", args: [], sourceOrder: 0 },
    { id: "test:python:b", args: [], sourceOrder: 1 },
  ]);
});

test("recursively expands nested suites and preserves forwarded Node, Python, and Playwright args", () => {
  const catalog = buildVerificationCatalog({
    packageScripts: {
      node: "node --test ./tests/a.test.mjs --test-name-pattern base",
      python: "python -m unittest tests.test_b -q",
      e2e: "node node_modules/@playwright/test/cli.js test tests/e2e/c.spec.js --workers=1",
      nested: "npm run node -- --test-reporter=spec && npm run python",
      all: "npm run nested && npm run e2e -- --retries=2",
    },
    records: [route("all", "all")],
  });
  const plan = buildVerificationSelectionPlan(catalog, ["all"]);
  assert.deepEqual(plan.executions.map((entry) => entry.id), ["node", "python", "e2e"]);
  assert.deepEqual(plan.executions.find((entry) => entry.id === "node").forwardedArgs, ["--test-reporter=spec"]);
  assert.deepEqual(plan.executions.find((entry) => entry.id === "node").effectiveArgv, [
    "--test", "./tests/a.test.mjs", "--test-name-pattern", "base", "--test-reporter=spec",
  ]);
  assert.deepEqual(plan.executions.find((entry) => entry.id === "e2e").forwardedArgs, ["--retries=2"]);
  assert.deepEqual(plan.executions.find((entry) => entry.id === "python").logicalArgv, [
    "-m", "unittest", "tests.test_b", "-q",
  ]);
  assert.deepEqual(plan.normalizedLeaves, [
    "node-test:tests/a.test.mjs",
    "playwright:tests/e2e/c.spec.js",
    "python-unittest:tests.test_b",
  ]);
});

test("merges equivalent normalized leaves reached through direct and nested aliases", () => {
  const catalog = buildVerificationCatalog({
    packageScripts: {
      unix: "node --test tests/duplicate.test.mjs",
      windows: "node --test tests\\duplicate.test.mjs",
      nested: "npm run unix",
      duplicate: "npm run nested && npm run windows",
    },
    records: [route("duplicate", "duplicates")],
  });
  const plan = buildVerificationSelectionPlan(catalog, ["duplicate"]);
  assert.deepEqual(plan.normalizedLeaves, ["node-test:tests/duplicate.test.mjs"]);
  assert.equal(plan.executions.length, 1);
});

test("fails closed for cycles and unresolved suite references", () => {
  const cyclic = buildVerificationCatalog({ packageScripts: { a: "npm run b", b: "npm run a" } });
  assert.throws(() => buildVerificationSelectionPlan(cyclic, ["a"]), /verification-plan-cycle:a->b->a/);
  const unresolved = buildVerificationCatalog({ packageScripts: { a: "npm run missing" } });
  assert.throws(() => buildVerificationSelectionPlan(unresolved, ["a"]), /verification-plan-unresolved-ref:missing/);
  assert.throws(() => buildVerificationSelectionPlan(unresolved, ["unknown"]), /verification-plan-unresolved-ref:unknown/);
  const conflictingOrder = {
    entries: [
      {
        id: "leaf",
        kind: "leaf",
        command: "node --test tests/a.test.mjs",
        executable: "node",
        argv: ["--test", "tests/a.test.mjs"],
        runner: "node-test",
        files: ["tests/a.test.mjs"],
        modules: [],
        specs: [],
        cost: "fast",
        executionOwner: "child-safe",
        platforms: ["all"],
        resourceLocks: [],
        tiers: ["pr"],
        ciProfiles: ["pr-fast"],
      },
      {
        id: "ordered",
        kind: "suite",
        refs: [
          { id: "leaf", args: [], sourceOrder: 1 },
        ],
      },
    ],
  };
  assert.throws(
    () => buildVerificationSelectionPlan(conflictingOrder, ["ordered"], { allowUnverifiedCatalog: true }),
    /verification-plan-conflicting-source-order:ordered/,
  );
});

test("fails closed when duplicate leaves disagree on runner args, owner, platform, or locks", () => {
  const baseLeaf = {
    kind: "leaf",
    runner: "node-test",
    executable: "node",
    argv: ["--test", "tests/a.test.mjs"],
    files: ["tests/a.test.mjs"],
    modules: [],
    specs: [],
    domains: ["a"],
    cost: "fast",
    executionOwner: "child-safe",
    platforms: ["linux"],
    resourceLocks: [],
    tiers: ["pr"],
    ciProfiles: ["pr-fast"],
  };
  for (const [field, value] of [
    ["argv", ["--test", "tests/a.test.mjs", "--test-name-pattern", "x"]],
    ["executionOwner", "main-thread"],
    ["platforms", ["win32"]],
    ["resourceLocks", [".runtime-output"]],
    ["ciProfiles", ["full"]],
    ["runner", "opaque"],
  ]) {
    const catalog = {
      entries: [
        { id: "a", ...baseLeaf },
        { id: "b", ...baseLeaf, [field]: value },
        { id: "both", kind: "suite", refs: [{ id: "a", args: [] }, { id: "b", args: [] }] },
      ],
    };
    assert.throws(
      () => buildVerificationSelectionPlan(catalog, ["both"], { allowUnverifiedCatalog: true }),
      new RegExp(`verification-plan-leaf-conflict:node-test:tests/a\\.test\\.mjs:${field}`),
    );
  }
});

test("keeps locks as an execution boundary and returns deterministic plans", () => {
  const catalog = buildVerificationCatalog({
    packageScripts: {
      z: "node --test tests/z.test.mjs",
      a: "node --test tests/a.test.mjs",
      all: "npm run z && npm run a",
    },
    records: [
      route("z", "z", { executionOwner: "main-thread", resourceLocks: ["browser-dev-server", ".runtime-output"] }),
      route("a", "a"),
    ],
  });
  const first = buildVerificationSelectionPlan(catalog, ["all"]);
  const second = buildVerificationSelectionPlan(catalog, ["all"]);
  assert.deepEqual(first, second);
  assert.deepEqual(first.executions.map((entry) => entry.id), ["z", "a"]);
  assert.deepEqual(first.resourceLockGroups, [
    { resourceLocks: [], executionIds: ["execution:0002"] },
    { resourceLocks: [".runtime-output", "browser-dev-server"], executionIds: ["execution:0001"] },
  ]);
  const direct = buildVerificationSelectionPlan(catalog, ["z", "a"]);
  const reversed = buildVerificationSelectionPlan(catalog, ["a", "z"]);
  assert.deepEqual(direct.executions.map((entry) => entry.id), ["z", "a"]);
  assert.deepEqual(reversed.executions.map((entry) => entry.id), ["a", "z"]);
  assert.deepEqual(direct.selectedCommandRefs, ["z", "a"]);
});

test("normalizes Windows and Unix leaf paths without changing module names", () => {
  assert.equal(normalizeVerificationPath(".\\tests\\nested\\..\\a.test.mjs"), "tests/a.test.mjs");
  assert.equal(normalizeVerificationPath("./tests/nested/../a.test.mjs"), "tests/a.test.mjs");
  assert.equal(normalizeVerificationPath("C:\\repo\\tests\\a.test.mjs"), "c:/repo/tests/a.test.mjs");
  const catalog = buildVerificationCatalog({
    packageScripts: { windows: "powershell.exe -File tools/check.ps1" },
  });
  assert.deepEqual(catalog.entries[0].platforms, ["win32"]);
});

test("catalog consistency accepts selector leaves that target another platform", () => {
  const packageScripts = {
    windows: "powershell.exe -File tools/check.ps1",
  };
  const selectorRoutes = [{
    ...route("windows", "windows", { platforms: ["win32"] }),
    id: "fixture:windows",
    layer: "contract",
  }];
  const catalog = buildVerificationCatalog({
    packageScripts,
    selectorRoutes,
    platform: "linux",
  });
  const consistency = checkVerificationCatalogConsistency(catalog, {
    packageScripts,
    selectorRoutes,
    platform: "linux",
  });
  assert.equal(consistency.consistent, true);
  assert.deepEqual(consistency.selectorPlanFailures, []);
  assert.throws(
    () => buildVerificationSelectionPlan(catalog, ["windows"], {
      allowUnverifiedCatalog: true,
      platform: "linux",
    }),
    /verification-plan-platform-mismatch:windows:linux/,
  );
});

test("reports mechanical consistency gaps across catalog, scripts, and route records", () => {
  const scripts = {
    a: "node --test tests/a.test.mjs",
    b: "python -m unittest tests.test_b",
  };
  const records = [route("a", "a"), route("b", "b")];
  const catalog = buildVerificationCatalog({ packageScripts: scripts, records });
  assert.deepEqual(checkVerificationCatalogConsistency(catalog, {
    packageScripts: scripts,
    records,
  }), {
    schemaVersion: 1,
    kind: "verification-catalog-consistency",
    consistent: true,
    missingCatalogEntries: [],
    orphanCatalogEntries: [],
    unresolvedRecordRefs: [],
    entryMismatches: [],
    unresolvedSuiteRefs: [],
    cyclicSuiteRefs: [],
    invalidSuitePlans: [],
    selectorPlanFailures: [],
    supersessionMismatches: [],
    authorityMismatches: [],
    catalogIdentityMismatches: [],
    sourceIntegrityMismatches: [],
    unclassifiedCatalogEntries: [],
    targetlessDiscoveryEntries: [],
  });
  const unclassifiedCatalog = buildVerificationCatalog({ packageScripts: scripts });
  assert.deepEqual(checkVerificationCatalogConsistency({
    entries: [unclassifiedCatalog.entries[0], { ...unclassifiedCatalog.entries[0], id: "legacy" }],
  }, {
    packageScripts: scripts,
    records: [route("missing-route", "missing")],
  }), {
    schemaVersion: 1,
    kind: "verification-catalog-consistency",
    consistent: false,
    missingCatalogEntries: ["b"],
    orphanCatalogEntries: ["legacy"],
    unresolvedRecordRefs: ["missing-route"],
    entryMismatches: [],
    unresolvedSuiteRefs: [],
    cyclicSuiteRefs: [],
    invalidSuitePlans: [],
    selectorPlanFailures: [{ commandRef: "missing-route", error: "verification-plan-unresolved-ref:missing-route" }],
    supersessionMismatches: [],
    authorityMismatches: ["authority"],
    catalogIdentityMismatches: ["schemaVersion", "kind", "sourceMode", "identity", "estimatePolicy", "selectorCommandRefs"],
    sourceIntegrityMismatches: ["sourceIntegrity"],
    unclassifiedCatalogEntries: [],
    targetlessDiscoveryEntries: [],
  });
});

test("mechanical consistency rejects unresolved and cyclic retained aliases", () => {
  const unresolvedScripts = { a: "npm run missing" };
  const unresolved = buildVerificationCatalog({ packageScripts: unresolvedScripts });
  assert.deepEqual(checkVerificationCatalogConsistency(unresolved, { packageScripts: unresolvedScripts }), {
    schemaVersion: 1,
    kind: "verification-catalog-consistency",
    consistent: false,
    missingCatalogEntries: [],
    orphanCatalogEntries: [],
    unresolvedRecordRefs: [],
    entryMismatches: [],
    unresolvedSuiteRefs: ["a->missing"],
    cyclicSuiteRefs: [],
    invalidSuitePlans: [{ id: "a", error: "verification-plan-unresolved-ref:missing" }],
    selectorPlanFailures: [],
    supersessionMismatches: [],
    authorityMismatches: [],
    catalogIdentityMismatches: [],
    sourceIntegrityMismatches: [],
    unclassifiedCatalogEntries: [],
    targetlessDiscoveryEntries: [],
  });
  const cyclicScripts = { a: "npm run b", b: "npm run a" };
  const cyclic = buildVerificationCatalog({ packageScripts: cyclicScripts });
  assert.deepEqual(
    checkVerificationCatalogConsistency(cyclic, { packageScripts: cyclicScripts }).cyclicSuiteRefs,
    ["a->b->a"],
  );
});

test("models every mixed command-chain segment as an alias or stable inline leaf", () => {
  const catalog = buildVerificationCatalog({
    packageScripts: {
      leaf: "node --test tests/leaf.test.mjs",
      mixed: "node --test tests/direct.test.mjs && npm run python -- -m unittest tests.test_inline -q && npm run leaf",
    },
    records: [route("mixed", "mixed")],
  });
  const byId = new Map(catalog.entries.map((entry) => [entry.id, entry]));
  assert.equal(byId.get("mixed").kind, "suite");
  assert.deepEqual(byId.get("mixed").refs, [
    { id: "mixed#inline:01", args: [], sourceOrder: 0 },
    { id: "mixed#inline:02", args: [], sourceOrder: 1 },
    { id: "leaf", args: [], sourceOrder: 2 },
  ]);
  assert.deepEqual({
    kind: byId.get("mixed#inline:01").kind,
    runner: byId.get("mixed#inline:01").runner,
    files: byId.get("mixed#inline:01").files,
    sourceKind: byId.get("mixed#inline:01").sourceKind,
    sourceScript: byId.get("mixed#inline:01").sourceScript,
  }, {
    kind: "leaf",
    runner: "node-test",
    files: ["tests/direct.test.mjs"],
    sourceKind: "inline",
    sourceScript: "mixed",
  });
  assert.equal(byId.get("mixed#inline:02").runner, "python-unittest");
  const plan = buildVerificationSelectionPlan(catalog, ["mixed"]);
  assert.deepEqual(plan.executions.map((entry) => entry.id), [
    "mixed#inline:01",
    "mixed#inline:02",
    "leaf",
  ]);
  assert.deepEqual(plan.executions.find((entry) => entry.id === "mixed#inline:02").argv, [
    "run", "python", "--", "-m", "unittest", "tests.test_inline", "-q",
  ]);
});

test("propagates suite metadata to leaf plans and detects root-specific metadata conflicts", () => {
  const catalog = buildVerificationCatalog({
    packageScripts: {
      leaf: "node --test tests/leaf.test.mjs",
      suite: "npm run leaf",
    },
    records: [
      route("leaf", "leaf-domain", { cost: "fast", ciProfile: "pr-fast" }),
      route("suite", "suite-domain", {
        cost: "heavy",
        executionOwner: "main-thread",
        platforms: ["win32"],
        resourceLocks: [".runtime-output"],
        tier: undefined,
        layer: "heavy",
        ciProfile: "full",
      }),
    ],
  });
  const plan = buildVerificationSelectionPlan(catalog, ["suite"], { platform: "win32" });
  const [execution] = plan.executions;
  assert.deepEqual({
    domains: execution.domains,
    cost: execution.cost,
    executionOwner: execution.executionOwner,
    platforms: execution.platforms,
    resourceLocks: execution.resourceLocks,
    tiers: execution.tiers,
    ciProfiles: execution.ciProfiles,
  }, {
    domains: ["leaf-domain", "suite-domain"],
    cost: "heavy",
    executionOwner: "main-thread",
    platforms: ["win32"],
    resourceLocks: [".runtime-output"],
    tiers: ["contract", "heavy"],
    ciProfiles: ["full", "pr-fast"],
  });
  assert.throws(
    () => buildVerificationSelectionPlan(catalog, ["leaf", "suite"]),
    /verification-plan-leaf-conflict:node-test:tests\/leaf\.test\.mjs:executionOwner/,
  );
});

test("creates catalog leaves for direct metadata command refs", () => {
  const directNode = "node tools/select_verification_targets.mjs --check";
  const directPython = "npm run python -- -m unittest tests.test_direct -q";
  const records = [
    { ...route(directNode, "selector"), commandType: "direct", packageScriptRequired: false, layer: "contract" },
    { ...route(directPython, "python"), commandType: "direct", packageScriptRequired: false, layer: "contract" },
  ];
  const catalog = buildVerificationCatalog({ packageScripts: {}, records });
  const byId = new Map(catalog.entries.map((entry) => [entry.id, entry]));
  assert.equal(byId.get(directNode).sourceKind, "direct-authority");
  assert.equal(byId.get(directNode).runner, "node-script");
  assert.equal(byId.get(directPython).runner, "python-unittest");
  assert.deepEqual(byId.get(directPython).modules, ["tests.test_direct"]);
  assert.equal(checkVerificationCatalogConsistency(catalog, { packageScripts: {}, records }).consistent, true);
});

test("requires explicit execution metadata before a selected leaf can enter a plan", () => {
  const packageScripts = {
    leaf: "node --test tests/leaf.test.mjs",
    suite: "npm run leaf",
  };
  const unclassified = buildVerificationCatalog({ packageScripts });
  assert.equal(unclassified.entries.find((entry) => entry.id === "leaf").executionOwner, "unclassified");
  assert.throws(
    () => buildVerificationSelectionPlan(unclassified, ["leaf"]),
    /verification-plan-unclassified-leaf:leaf/,
  );
  const forged = {
    entries: [{
      ...unclassified.entries.find((entry) => entry.id === "leaf"),
      metadataComplete: true,
    }],
  };
  assert.throws(
    () => buildVerificationSelectionPlan(forged, ["leaf"], { allowUnverifiedCatalog: true }),
    /verification-plan-unclassified-leaf:leaf/,
  );
  const authorized = buildVerificationCatalog({
    packageScripts,
    records: [route("suite", "catalog", {
      executionOwner: "main-thread",
      resourceLocks: [".runtime-output"],
    })],
  });
  const [execution] = buildVerificationSelectionPlan(authorized, ["suite"]).executions;
  assert.equal(execution.executionOwner, "main-thread");
  assert.deepEqual(execution.resourceLocks, [".runtime-output"]);
});

test("recognizes direct Playwright binaries and rejects config discovery without an explicit owner", () => {
  const packageScripts = {
    direct: "playwright test tests/e2e/direct.spec.js --config=playwright.config.js --workers=1",
    discovery: "playwright.cmd test",
  };
  const records = [route("direct", "browser"), route("discovery", "browser")];
  const catalog = buildVerificationCatalog({ packageScripts, records });
  const direct = catalog.entries.find((entry) => entry.id === "direct");
  assert.equal(direct.runner, "playwright");
  assert.deepEqual(direct.specs, ["tests/e2e/direct.spec.js"]);
  assert.deepEqual(direct.runnerArgs, ["--config=playwright.config.js", "--workers=1"]);
  assert.deepEqual(buildVerificationSelectionPlan(catalog, ["direct"]).normalizedLeaves, [
    "playwright:tests/e2e/direct.spec.js",
  ]);
  const discovery = catalog.entries.find((entry) => entry.id === "discovery");
  assert.deepEqual(discovery.discovery, { kind: "playwright-config" });
  assert.throws(
    () => buildVerificationSelectionPlan(catalog, ["discovery"]),
    /verification-plan-targetless-leaf:discovery:playwright-config/,
  );
  const staleCatalog = {
    entries: [{
      ...discovery,
      targetless: undefined,
      discovery: undefined,
    }],
  };
  assert.throws(
    () => buildVerificationSelectionPlan(staleCatalog, ["discovery"], { allowUnverifiedCatalog: true }),
    /verification-plan-targetless-leaf:discovery:unknown/,
  );
});

test("keeps Node reporter modules outside normalized test file targets", () => {
  const catalog = buildVerificationCatalog({
    packageScripts: {
      node: "node --test tests/node.test.mjs --test-reporter=tools/reporter.mjs",
    },
    records: [route("node", "node")],
  });
  const [leaf] = catalog.entries;
  assert.deepEqual(leaf.files, ["tests/node.test.mjs"]);
  assert.deepEqual(leaf.runnerArgs, ["--test-reporter=tools/reporter.mjs"]);
  assert.deepEqual(buildVerificationSelectionPlan(catalog, ["node"]).normalizedLeaves, [
    "node-test:tests/node.test.mjs",
  ]);
});

test("keeps unittest filter values outside normalized Python modules", () => {
  const catalog = buildVerificationCatalog({
    packageScripts: {
      python: "python -m unittest -k=smoke tests.test_python -q",
    },
    records: [route("python", "python")],
  });
  const [leaf] = catalog.entries;
  assert.deepEqual(leaf.modules, ["tests.test_python"]);
  assert.deepEqual(leaf.runnerArgs, ["-k=smoke", "-q"]);
  assert.deepEqual(buildVerificationSelectionPlan(catalog, ["python"]).normalizedLeaves, [
    "python-unittest:tests.test_python",
  ]);
});

test("uses Node module identity to merge equivalent and reject conflicting invocations", () => {
  const duplicateCatalog = buildVerificationCatalog({
    packageScripts: {
      unix: "node tools/check.mjs --mode same",
      windows: "node tools\\check.mjs --mode same",
      both: "npm run unix && npm run windows",
    },
    records: [route("both", "node-tools")],
  });
  const duplicatePlan = buildVerificationSelectionPlan(duplicateCatalog, ["both"]);
  assert.deepEqual(duplicatePlan.normalizedLeaves, ["node-script:tools/check.mjs"]);
  assert.equal(duplicatePlan.executions.length, 1);
  const conflictCatalog = buildVerificationCatalog({
    packageScripts: {
      first: "node tools/check.mjs --mode a",
      second: "node tools/check.mjs --mode b",
      both: "npm run first && npm run second",
    },
    records: [route("both", "node-tools")],
  });
  assert.throws(
    () => buildVerificationSelectionPlan(conflictCatalog, ["both"]),
    /verification-plan-leaf-conflict:node-script:tools\/check\.mjs:argv/,
  );
});

test("merges Windows and Unix Python targets into one normalized leaf", () => {
  const catalog = buildVerificationCatalog({
    packageScripts: {
      unix: "python -m unittest tests/test_same.py -q",
      windows: "python -m unittest tests\\test_same.py -q",
      both: "npm run unix && npm run windows",
    },
    records: [route("both", "python")],
  });
  const plan = buildVerificationSelectionPlan(catalog, ["both"]);
  assert.deepEqual(plan.normalizedLeaves, ["python-unittest:tests/test_same.py"]);
  assert.equal(plan.executions.length, 1);
});

test("reports deterministic command, target, and execution metadata drift", () => {
  const packageScripts = { a: "node --test tests/a.test.mjs" };
  const records = [route("a", "a")];
  const catalog = buildVerificationCatalog({ packageScripts, records });
  const commandDrift = checkVerificationCatalogConsistency(catalog, {
    packageScripts: { a: "node --test tests/b.test.mjs" },
    records,
  });
  assert.deepEqual(commandDrift.entryMismatches, [{
    id: "a",
    fields: ["argv", "command", "files"],
  }]);
  assert.equal(commandDrift.consistent, false);

  const metadataDrift = checkVerificationCatalogConsistency(catalog, {
    packageScripts,
    records: [route("a", "a", {
      executionOwner: "main-thread",
      platforms: ["win32"],
      resourceLocks: [".runtime-output"],
      ciProfile: "full",
    })],
  });
  assert.deepEqual(metadataDrift.entryMismatches, [{
    id: "a",
    fields: ["ciProfiles", "executionOwner", "platforms", "resourceLocks"],
  }]);
  assert.equal(metadataDrift.consistent, false);

  const mutated = buildVerificationCatalog({ packageScripts, records });
  mutated.entries[0].command = "node --test tests/b.test.mjs";
  mutated.entries[0].argv = ["--test", "tests/b.test.mjs"];
  mutated.entries[0].files = ["tests/b.test.mjs"];
  assert.throws(
    () => buildVerificationSelectionPlan(mutated, ["a"]),
    /verification-plan-catalog-source-drift/,
  );
  assert.throws(
    () => buildVerificationSelectionPlan({ entries: mutated.entries }, ["a"]),
    /verification-plan-unverified-catalog/,
  );
  const unsealed = buildVerificationCatalog({ packageScripts, records });
  delete unsealed.sourceIntegrity;
  assert.deepEqual(
    checkVerificationCatalogConsistency(unsealed, { packageScripts, records }).sourceIntegrityMismatches,
    ["sourceIntegrity"],
  );
  assert.equal(checkVerificationCatalogConsistency(unsealed, { packageScripts, records }).consistent, false);
  const staleSeal = buildVerificationCatalog({ packageScripts, records });
  staleSeal.sourceIntegrity.digest = "0".repeat(64);
  assert.deepEqual(
    checkVerificationCatalogConsistency(staleSeal, { packageScripts, records }).sourceIntegrityMismatches,
    ["sourceIntegrity"],
  );
});

test("catalog identity seals the canonical estimate policy", () => {
  const inputs = {
    packageScripts: { a: "node --test tests/a.test.mjs" },
    records: [route("a", "a")],
  };
  const catalog = buildVerificationCatalog(inputs);
  assert.deepEqual(catalog.estimatePolicy, VERIFICATION_ESTIMATE_POLICY);

  const drifted = structuredClone(catalog);
  drifted.estimatePolicy.costClasses.fast.perLeafRuntimeSeconds += 1;
  assert.throws(
    () => buildVerificationSelectionPlan(drifted, ["a"]),
    /verification-plan-catalog-source-drift/,
  );

  const missing = structuredClone(catalog);
  delete missing.estimatePolicy;
  assert.throws(
    () => buildVerificationSelectionPlan(sealVerificationCatalog(missing), ["a"]),
    /verification-plan-estimate-policy-missing/,
  );

  assert.throws(
    () => buildVerificationCatalog({
      ...inputs,
      estimatePolicy: { ...VERIFICATION_ESTIMATE_POLICY, kind: "unknown-estimate-policy" },
    }),
    /verification-plan-estimate-policy-unknown-authority/,
  );

  const resealedDrift = sealVerificationCatalog(drifted);
  const consistency = checkVerificationCatalogConsistency(resealedDrift, inputs);
  assert.equal(consistency.consistent, false);
  assert.ok(consistency.catalogIdentityMismatches.includes("estimatePolicy"));
});

test("catalog schema and kind remain fixed after mutation and resealing", () => {
  const inputs = {
    packageScripts: { a: "node --test tests/a.test.mjs" },
    records: [route("a", "a")],
  };
  const catalog = buildVerificationCatalog(inputs);
  for (const [field, value] of [
    ["schemaVersion", 2],
    ["kind", "forged-verification-catalog"],
  ]) {
    const forged = sealVerificationCatalog({ ...structuredClone(catalog), [field]: value });
    const consistency = checkVerificationCatalogConsistency(forged, inputs);
    assert.equal(consistency.consistent, false);
    assert.ok(consistency.catalogIdentityMismatches.includes(field));
    assert.throws(
      () => buildVerificationSelectionPlan(forged, ["a"]),
      /verification-plan-catalog-identity/,
    );
  }
});

test("catalog authority preserves presence and every required field fails closed when removed", () => {
  const implicitPlatformRoute = route("a", "a");
  delete implicitPlatformRoute.platforms;
  const inputs = {
    packageScripts: { a: "node --test tests/a.test.mjs" },
    records: [implicitPlatformRoute],
  };
  const catalog = buildVerificationCatalog(inputs);
  assert.deepEqual(catalog.authority[0].platforms, ["all"]);
  assert.equal(catalog.authority[0].presence.platforms, false);
  assert.equal(catalog.authority[0].presence.resourceLocks, true);

  for (const field of [
    "routeIds",
    "safetyContributorRouteIds",
    "sourceRefs",
    "domains",
    "ownerHints",
    "tiers",
    "ciProfiles",
    "platforms",
    "cost",
    "executionOwner",
    "resourceLocks",
    "presence",
  ]) {
    const forgedCatalog = structuredClone(catalog);
    delete forgedCatalog.authority[0][field];
    const forged = sealVerificationCatalog(forgedCatalog);
    assert.equal(checkVerificationCatalogConsistency(forged, inputs).consistent, false, field);
    assert.throws(
      () => buildVerificationSelectionPlan(forged, ["a"]),
      new RegExp(`verification-plan-authority-gap:a:${field === "presence" ? "presence" : field}`),
      field,
    );
  }
});

test("fails closed for unsupported shell operators while preserving quoted script syntax", () => {
  for (const [operator, escaped] of [
    ["||", "\\|\\|"],
    ["|", "\\|"],
    ["&", "&"],
    [";", ";"],
    ["<", "<"],
    [">", ">"],
  ]) {
    assert.throws(
      () => buildVerificationCatalog({
        packageScripts: { bad: `node --test tests/a.test.mjs ${operator} node --test tests/b.test.mjs` },
        records: [route("bad", "shell")],
      }),
      new RegExp(`verification-catalog-unsupported-shell-operator:bad:${escaped}`),
    );
  }
  const quoted = buildVerificationCatalog({
    packageScripts: { quoted: "node -e \"process.env.X='a;b|c&d'; import('./tests/a.test.mjs')\"" },
    records: [route("quoted", "shell")],
  });
  assert.equal(buildVerificationSelectionPlan(quoted, ["quoted"]).executions[0].runner, "opaque");
});

test("rejects unquoted command-separator controls including CR LF and CRLF", () => {
  for (const [separator, code] of [
    ["\r", "CR"],
    ["\n", "LF"],
    ["\r\n", "CR"],
    ["\v", "VT"],
    ["\f", "FF"],
    ["\u2028", "LS"],
  ]) {
    assert.throws(
      () => buildVerificationCatalog({ packageScripts: { unsafe: `node before.mjs${separator}node after.mjs` } }),
      new RegExp(`verification-catalog-unsupported-shell-operator:unsafe:${code}`),
    );
  }
  assert.doesNotThrow(() => buildVerificationCatalog({
    packageScripts: { quoted: `node -e "console.log('before
after')"` },
  }));
});

test("uses repo-relative Windows identity with case folding and stable UNC handling", () => {
  const win = { repoRoot: "C:\\Repo", platform: "win32" };
  assert.equal(normalizeVerificationPath("C:\\Repo\\Tests\\A.test.mjs", win), "tests/a.test.mjs");
  assert.equal(normalizeVerificationPath("c:/repo/tests/a.test.mjs", win), "tests/a.test.mjs");
  assert.equal(
    normalizeVerificationPath("\\\\Server\\Share\\Tests\\A.test.mjs", win),
    "//server/share/tests/a.test.mjs",
  );
  assert.equal(
    normalizeVerificationPath("\\\\Server\\Share\\Repo\\Tests\\A.test.mjs", {
      repoRoot: "\\\\server\\share\\repo",
      platform: "win32",
    }),
    "tests/a.test.mjs",
  );
  assert.equal(
    normalizeVerificationPath("/repo/Tests/A.test.mjs", { repoRoot: "/repo", platform: "linux" }),
    "Tests/A.test.mjs",
  );
  const catalog = buildVerificationCatalog({
    packageScripts: {
      first: "node --test C:/Repo/Tests/A.test.mjs",
      second: "node --test c:/repo/tests/a.test.mjs",
      both: "npm run first && npm run second",
    },
    records: [route("both", "windows")],
    ...win,
  });
  const drivePlan = buildVerificationSelectionPlan(catalog, ["both"], win);
  assert.deepEqual(drivePlan.normalizedLeaves, ["node-test:tests/a.test.mjs"]);
  assert.equal(drivePlan.executions.length, 1);
  const uncCatalog = buildVerificationCatalog({
    packageScripts: {
      first: "node --test //Server/Share/Tests/A.test.mjs",
      second: "node --test //server/share/tests/a.test.mjs",
      both: "npm run first && npm run second",
    },
    records: [route("both", "windows")],
    ...win,
  });
  const uncPlan = buildVerificationSelectionPlan(uncCatalog, ["both"], win);
  assert.deepEqual(uncPlan.normalizedLeaves, ["node-test://server/share/tests/a.test.mjs"]);
  assert.equal(uncPlan.executions.length, 1);
});

test("preserves real build-test-drift and build-check chains as topological executions", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  const selectorRoutes = buildRouteIndex();
  const catalog = buildRepositoryVerificationCatalog({
    packageScripts: packageJson.scripts,
    selectorRoutes,
    repoRoot: REPO_ROOT,
  });
  const sourceInputs = {
    packageScripts: packageJson.scripts,
    verificationRecords: VERIFICATION_DOMAINS,
    selectorRoutes,
    repoRoot: REPO_ROOT,
    platform: process.platform,
  };
  assert.throws(
    () => buildVerificationSelectionPlan(catalog, ["verify:pages-dist-and-drift"]),
    /verification-plan-missing-source-authority/,
  );
  const pages = buildVerificationSelectionPlan(catalog, ["verify:pages-dist-and-drift"], {
    platform: process.platform,
    sourceInputs,
  });
  assert.deepEqual(pages.executions.map((entry) => entry.id), [
    "verify:pages-dist-and-drift#inline:01",
    "verify:pages-dist-and-drift#inline:02",
    "test:py:landing-map-asset-contracts",
    "test:node:landing-showcase-view",
    "verify:pages-dist-and-drift#inline:05",
  ]);
  assert.deepEqual(pages.executions.map((entry) => entry.dependsOn), [
    [],
    ["execution:0001"],
    ["execution:0002"],
    ["execution:0003"],
    ["execution:0004"],
  ]);
  assert.equal(pages.executions[0].effectiveArgv.at(-1), "tools/build_pages_dist.py");
  if (process.platform === "win32") {
    assert.equal(pages.executions[0].executable, "cmd.exe");
    assert.deepEqual(pages.executions[0].effectiveArgv.slice(0, 4), ["/d", "/s", "/c", "npm"]);
  }
  assert.equal(pages.executions.at(-1).effectiveArgv[0], "diff");

  const combined = buildRepositoryVerificationSelectionPlan({
    packageScripts: packageJson.scripts,
    roots: ["test:py:landing-map-asset-contracts", "verify:pages-dist-and-drift"],
    repoRoot: REPO_ROOT,
    platform: process.platform,
  });
  assert.deepEqual(
    combined.rootRecords.map((entry) => [entry.commandRef, entry.disposition, entry.supersededBy ?? null]),
    [
      ["test:py:landing-map-asset-contracts", "superseded", "verify:pages-dist-and-drift"],
      ["verify:pages-dist-and-drift", "planned", null],
    ],
  );
  assert.equal(
    combined.normalizedLeaves.filter((leaf) => leaf === "python-unittest:tests.test_landing_map_asset_contracts").length,
    1,
  );

  const pagesAndP4 = buildRepositoryVerificationSelectionPlan({
    packageScripts: packageJson.scripts,
    roots: ["test:node:p4:p4-1", "verify:pages-dist-and-drift"],
    repoRoot: REPO_ROOT,
    platform: process.platform,
  });
  assert.equal(
    pagesAndP4.normalizedLeaves.filter(
      (leaf) => leaf === "node-test:tests/sample_project_contracts.test.mjs",
    ).length,
    1,
  );

  const drift = buildVerificationSelectionPlan(catalog, ["verify:dist-drift"], {
    platform: process.platform,
    sourceInputs,
  });
  assert.deepEqual(drift.executions.map((entry) => entry.id), [
    "verify:dist-drift#inline:01",
    "verify:dist-drift#inline:02",
  ]);
  assert.deepEqual(drift.dependencyEdges, [{
    from: "execution:0001",
    to: "execution:0002",
    kind: "suite-sequence",
    suiteId: "verify:dist-drift",
    sourceOrder: 1,
  }]);
});

test("plans full selector roots once with supersession, process argv, and route provenance", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  const roots = [
    "node tools/select_verification_targets.mjs --check",
    "test:node:supervisor-contracts",
    "test:node:supervisor-plan",
    "test:node:supervisor-routing",
    "test:node:verification-metadata",
    "test:node:verification-script-portfolio",
    "test:node:verify-core-runner",
    ...(process.platform === "win32" ? [
      "test:node:williams-crossover-governance",
      "test:node:williams-crossover-job-runner",
      "test:node:windows-job-runtime",
    ] : []),
    "verify:script-portfolio",
    "verify:supervisor-contracts",
    "verify:test-import-graph",
    "verify:test:e2e-layers",
  ];
  const plan = buildRepositoryVerificationSelectionPlan({
    packageScripts: packageJson.scripts,
    roots,
    repoRoot: REPO_ROOT,
    platform: process.platform,
  });
  assert.equal(plan.rootRecords.length, roots.length);
  assert.ok(plan.rootRecords.every((entry) => entry.routeIds.length > 0));
  assert.deepEqual(
    plan.rootRecords.filter((entry) => entry.disposition === "superseded")
      .map((entry) => [entry.commandRef, entry.supersededBy]),
    [
      ["test:node:supervisor-contracts", "verify:supervisor-contracts"],
      ["test:node:supervisor-routing", "verify:supervisor-contracts"],
    ],
  );
  assert.equal(plan.executions.length, roots.length);
  assert.ok(plan.executions.every((entry) => entry.executable && Array.isArray(entry.effectiveArgv)));
  assert.ok(plan.executions.every((entry) => entry.provenance[0].routeIds.length > 0));

  const directPython = "python -m unittest tests.test_e2e_structural_tooling -q";
  const [execution] = buildRepositoryVerificationSelectionPlan({
    packageScripts: packageJson.scripts,
    roots: [{
    commandRef: directPython,
    routeIds: ["infra:playwright-observability"],
    safetyContributorRouteIds: ["infra:playwright-observability"],
    }],
    repoRoot: REPO_ROOT,
    platform: process.platform,
  }).executions;
  assert.equal(execution.logicalExecutable, "python");
  assert.deepEqual(execution.logicalArgv, ["-m", "unittest", "tests.test_e2e_structural_tooling", "-q"]);
  if (process.platform === "win32") {
    assert.equal(execution.executable, process.execPath);
    assert.deepEqual(execution.effectiveArgv, [
      "tools/run_python.mjs", "-m", "unittest", "tests.test_e2e_structural_tooling", "-q",
    ]);
  } else {
    assert.equal(execution.executable, "python");
    assert.deepEqual(execution.effectiveArgv, execution.logicalArgv);
  }
  assert.deepEqual(execution.provenance[0].routeIds, ["infra:playwright-observability"]);
  assert.deepEqual(execution.provenance[0].safetyContributorRouteIds, ["infra:playwright-observability"]);

  assert.throws(
    () => buildRepositoryVerificationSelectionPlan({
      packageScripts: packageJson.scripts,
      roots: [{
        commandRef: directPython,
        routeIds: ["stale:route"],
        safetyContributorRouteIds: ["infra:playwright-observability"],
      }],
      repoRoot: REPO_ROOT,
      platform: process.platform,
    }),
    /verification-plan-root-route-drift:python -m unittest tests\.test_e2e_structural_tooling -q:routeIds/,
  );
});

test("City Lights layer keeps one canonical wrapper invocation beside the city aggregate", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  const wrapper = "node tools/e2e_layering.mjs run-spec tests/e2e/city_lights_layer_regression.spec.js";
  const plan = buildRepositoryVerificationSelectionPlan({
    packageScripts: packageJson.scripts,
    roots: ["test:e2e:city-rendering", wrapper],
    repoRoot: REPO_ROOT,
    platform: process.platform,
  });
  assert.deepEqual(
    plan.rootRecords.map(({ commandRef, disposition, supersededBy }) => ({
      commandRef,
      disposition,
      ...(supersededBy ? { supersededBy } : {}),
    })),
    [
      { commandRef: "test:e2e:city-rendering", disposition: "planned" },
      { commandRef: wrapper, disposition: "planned" },
    ],
  );
  const cityLightsExecutions = plan.executions.filter((entry) => (
    entry.logicalArgv.includes("tests/e2e/city_lights_layer_regression.spec.js")
  ));
  assert.equal(cityLightsExecutions.length, 1);
  assert.deepEqual(cityLightsExecutions[0].logicalArgv, [
    "tools/e2e_layering.mjs",
    "run-spec",
    "tests/e2e/city_lights_layer_regression.spec.js",
  ]);
  const aggregateExecution = plan.executions.find((entry) => (
    entry.provenance.some(({ rootCommandRef }) => rootCommandRef === "test:e2e:city-rendering")
  ));
  assert.ok(aggregateExecution);
  assert.equal(
    aggregateExecution.logicalArgv.includes("tests/e2e/city_lights_layer_regression.spec.js"),
    false,
  );
});

test("City rendering aggregate reuses one canonical layering invocation per spec", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  const citySpecs = [
    "tests/e2e/city_label_i18n_redraw.spec.js",
    "tests/e2e/city_marker_visibility_regression.spec.js",
    "tests/e2e/city_points_urban_runtime.spec.js",
    "tests/e2e/city_reveal_plan_regression.spec.js",
    "tests/e2e/city_urban_rendering_regression.spec.js",
  ];
  const wrappers = citySpecs.map((spec) => `node tools/e2e_layering.mjs run-spec ${spec}`);
  const plan = buildRepositoryVerificationSelectionPlan({
    packageScripts: packageJson.scripts,
    roots: ["test:e2e:city-rendering", ...wrappers],
    repoRoot: REPO_ROOT,
    platform: process.platform,
  });
  for (const spec of citySpecs) {
    const executions = plan.executions.filter((entry) => entry.logicalArgv.includes(spec));
    assert.equal(executions.length, 1, spec);
    assert.deepEqual(executions[0].logicalArgv, [
      "tools/e2e_layering.mjs",
      "run-spec",
      spec,
    ]);
  }
});

test("Physical layer runtime contract reuses its canonical wrapper across alias and selector", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  const spec = "tests/e2e/physical_layer_runtime_contract.spec.js";
  const wrapper = `node tools/e2e_layering.mjs run-spec ${spec}`;
  for (const roots of [["test:e2e:physical-layer-runtime-contract", wrapper], [wrapper, "test:e2e:physical-layer-runtime-contract"]]) {
    const plan = buildRepositoryVerificationSelectionPlan({
      packageScripts: packageJson.scripts,
      roots,
      repoRoot: REPO_ROOT,
      platform: process.platform,
    });
    assert.equal(plan.executions.length, 1);
    assert.deepEqual(plan.executions[0].logicalArgv, ["tools/e2e_layering.mjs", "run-spec", spec]);
    assert.equal(plan.executions[0].executionOwner, "main-thread");
    assert.ok(plan.executions[0].resourceLocks.includes("playwright-browser"));
    assert.deepEqual(new Set(plan.executions[0].provenance.map(({ rootCommandRef }) => rootCommandRef)), new Set(roots));
  }
});

test("TNO contract aggregate preserves both specs and shares their canonical wrappers", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  const specs = [
    "tests/e2e/tno_startup_visible_context_layers_contract.spec.js",
    "tests/e2e/tno_1962_ui_smoke.spec.js",
  ];
  const wrappers = specs.map((spec) => `node tools/e2e_layering.mjs run-spec ${spec}`);
  const plan = buildRepositoryVerificationSelectionPlan({
    packageScripts: packageJson.scripts,
    roots: ["test:e2e:tno-contracts", ...wrappers],
    repoRoot: REPO_ROOT,
    platform: process.platform,
  });
  assert.equal(plan.executions.length, 2);
  for (const [index, spec] of specs.entries()) {
    const execution = plan.executions.find((entry) => entry.specs.includes(spec));
    assert.ok(execution, spec);
    assert.deepEqual(execution.logicalArgv, ["tools/e2e_layering.mjs", "run-spec", spec]);
    assert.equal(execution.executionOwner, "main-thread");
    assert.ok(execution.resourceLocks.includes("playwright-browser"));
    assert.deepEqual(new Set(execution.provenance.map(({ rootCommandRef }) => rootCommandRef)), new Set(["test:e2e:tno-contracts", wrappers[index]]));
  }
  assert.equal(packageJson.scripts["test:e2e:tno-contracts"], wrappers.join(" && "));
});

test("Scenario resilience keeps the canonical layering wrapper invocation", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  const wrapper = "node tools/e2e_layering.mjs run-spec tests/e2e/scenario_apply_resilience.spec.js";
  const plan = buildRepositoryVerificationSelectionPlan({
    packageScripts: packageJson.scripts,
    roots: ["test:e2e:scenario-resilience", wrapper],
    repoRoot: REPO_ROOT,
    platform: process.platform,
  });
  assert.deepEqual(
    plan.rootRecords.map(({ commandRef, disposition }) => ({
      commandRef,
      disposition,
    })),
    [
      { commandRef: "test:e2e:scenario-resilience", disposition: "planned" },
      { commandRef: wrapper, disposition: "planned" },
    ],
  );
  const resilienceExecutions = plan.executions.filter((entry) => (
    entry.logicalArgv.includes("tests/e2e/scenario_apply_resilience.spec.js")
  ));
  assert.equal(resilienceExecutions.length, 1);
  assert.deepEqual(resilienceExecutions[0].logicalArgv, [
    "tools/e2e_layering.mjs",
    "run-spec",
    "tests/e2e/scenario_apply_resilience.spec.js",
  ]);
});

test("plans distinct selector E2E roots by spec identity", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  const selectorRoutes = buildRouteIndex();
  const roots = selectorRoutes.filter((route) => route.id.startsWith("e2e:")).slice(0, 2)
    .map((route) => ({
      commandRef: route.commandRef,
      routeIds: [route.id],
      safetyContributorRouteIds: [route.id],
    }));
  const plan = buildRepositoryVerificationSelectionPlan({
    packageScripts: packageJson.scripts,
    roots,
    selectorRoutes,
    repoRoot: REPO_ROOT,
    platform: process.platform,
  });
  assert.equal(plan.executions.length, 2);
  assert.ok(plan.executions.every((entry) => entry.runner === "playwright" && entry.specs.length === 1));
  assert.notEqual(plan.executions[0].specs[0], plan.executions[1].specs[0]);
});

test("repository planning fails when current package or route sources drift", () => {
  const authorityRoute = {
    id: "selector:a",
    commandRef: "a",
    sourceRef: "tests/a.test.mjs",
    domain: "a",
    ownerHint: "a",
    layer: "contract",
    cost: "fast",
    resourceLocks: [],
    executionOwner: "child-safe",
    ciProfile: "pr-fast",
  };
  assert.throws(
    () => buildRepositoryVerificationCatalog({
      packageScripts: { a: "node --test tests/a.test.mjs" },
      verificationRecords: [],
      selectorRoutes: [authorityRoute],
      repoRoot: REPO_ROOT,
      platform: process.platform,
    }),
    /verification-catalog-package-shadow-drift/,
  );
  const fixtureCatalog = buildVerificationCatalog({
    packageScripts: { a: "node --test tests/a.test.mjs" },
    records: [authorityRoute],
    selectorRoutes: [authorityRoute],
    repoRoot: REPO_ROOT,
    platform: process.platform,
    sourceMode: "fixture",
  });
  const forgedRepositoryCatalog = sealVerificationCatalog({
    ...fixtureCatalog,
    sourceMode: "repository",
  });
  assert.throws(
    () => buildVerificationSelectionPlan(forgedRepositoryCatalog, ["a"], {
      platform: process.platform,
      sourceInputs: {
        packageScripts: { a: "node --test tests/b.test.mjs" },
        verificationRecords: [],
        selectorRoutes: [authorityRoute],
        repoRoot: REPO_ROOT,
        platform: process.platform,
        sourceMode: "repository",
      },
    }),
    /verification-plan-source-authority-drift/,
  );
  const plan = buildVerificationSelectionPlan(fixtureCatalog, ["a"], { platform: process.platform });
  assert.deepEqual(plan.normalizedLeaves, ["node-test:tests/a.test.mjs"]);
});

test("reconciled authority rejects route source drift mechanically", () => {
  const shared = {
    id: "shared-route",
    commandRef: "a",
    sourceRef: "tests/a.test.mjs",
    domain: "a",
    ownerHint: "a",
    layer: "contract",
    cost: "fast",
    resourceLocks: [],
    executionOwner: "child-safe",
    ciProfile: "pr-fast",
  };
  assert.throws(
    () => buildVerificationCatalog({
      packageScripts: { a: "node --test tests/a.test.mjs" },
      records: [shared],
      selectorRoutes: [{ ...shared, commandRef: "b" }],
    }),
    /verification-route-authority-source-drift:shared-route:commandRef/,
  );
});

test("reconciled authority rejects invalid safety metadata before catalog planning", () => {
  const packageScripts = { a: "node --test tests/a.test.mjs" };
  for (const [overrides, error] of [
    [
      { executionOwner: undefined, executionOwners: ["main-thread", "bogus-owner"] },
      /verification-route-authority-invalid-execution-owner:verification-record:0001:a:bogus-owner/,
    ],
    [{ ciProfile: "bogus-profile" }, /verification-route-authority-invalid-ci-profile:verification-record:0001:a:bogus-profile/],
    [{ executionOwner: "main-thread", resourceLocks: ["bogus-lock"] }, /verification-route-authority-invalid-resource-lock:verification-record:0001:a:bogus-lock/],
    [{ resourceLocks: [".runtime-output"] }, /verification-route-authority-child-safe-resource-lock:verification-record:0001:a/],
    [{ cost: "heavy" }, /verification-route-authority-child-safe-heavy:verification-record:0001:a/],
    [{ platforms: ["plan9"] }, /verification-route-authority-invalid-platform:verification-record:0001:a:plan9/],
  ]) {
    assert.throws(
      () => buildVerificationCatalog({ packageScripts, records: [route("a", "a", overrides)] }),
      error,
    );
  }
});

test("supersession fails closed when the current superseder closure drops a covered leaf", () => {
  const catalog = buildVerificationCatalog({
    packageScripts: {
      superseder: "node --test tests/a.test.mjs",
      covered: "node --test tests/b.test.mjs",
    },
    records: [route("superseder", "a"), route("covered", "b")],
  });
  assert.throws(
    () => buildVerificationSelectionPlan(catalog, ["superseder", "covered"], {
      supersession: { superseder: ["covered"] },
    }),
    /verification-plan-supersession-drift:superseder:covered/,
  );
});

test("real package scripts and verification domains form one mechanically consistent catalog", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  const selectorRoutes = buildRouteIndex();
  const catalog = buildRepositoryVerificationCatalog({
    packageScripts: packageJson.scripts,
    verificationRecords: VERIFICATION_DOMAINS,
    selectorRoutes,
    repoRoot: REPO_ROOT,
  });
  const consistency = checkVerificationCatalogConsistency(catalog, {
    packageScripts: packageJson.scripts,
    records: VERIFICATION_DOMAINS,
    selectorRoutes,
    repoRoot: REPO_ROOT,
    sourceMode: "repository",
  });
  assert.equal(consistency.consistent, true);
  assert.deepEqual({
    missingCatalogEntries: consistency.missingCatalogEntries,
    orphanCatalogEntries: consistency.orphanCatalogEntries,
    unresolvedRecordRefs: consistency.unresolvedRecordRefs,
    entryMismatches: consistency.entryMismatches,
    unresolvedSuiteRefs: consistency.unresolvedSuiteRefs,
    cyclicSuiteRefs: consistency.cyclicSuiteRefs,
    invalidSuitePlans: consistency.invalidSuitePlans,
  }, {
    missingCatalogEntries: [],
    orphanCatalogEntries: [],
    unresolvedRecordRefs: [],
    entryMismatches: [],
    unresolvedSuiteRefs: [],
    cyclicSuiteRefs: [],
    invalidSuitePlans: [],
  });
  assert.deepEqual(consistency.unclassifiedCatalogEntries, []);
  assert.deepEqual(consistency.targetlessDiscoveryEntries, []);
  const p4Plan = buildRepositoryVerificationSelectionPlan({
    packageScripts: packageJson.scripts,
    roots: ["verify:p4:p4-3", "verify:p4:state-writer-policy"],
    repoRoot: REPO_ROOT,
    platform: process.platform,
  });
  assert.deepEqual(
    p4Plan.rootRecords.map(({ commandRef, disposition, supersededBy }) => ({
      commandRef,
      disposition,
      ...(supersededBy ? { supersededBy } : {}),
    })),
    [
      { commandRef: "verify:p4:p4-3", disposition: "planned" },
      {
        commandRef: "verify:p4:state-writer-policy",
        disposition: "superseded",
        supersededBy: "verify:p4:p4-3",
      },
    ],
  );
  assert.deepEqual(consistency.selectorPlanFailures, []);
  assert.deepEqual(consistency.supersessionMismatches, []);
  assert.deepEqual(consistency.catalogIdentityMismatches, []);
  assert.deepEqual(consistency.sourceIntegrityMismatches, []);
  const directRefs = VERIFICATION_DOMAINS
    .filter((entry) => entry.commandType === "direct")
    .map((entry) => entry.commandRef);
  const catalogIds = new Set(catalog.entries.map((entry) => entry.id));
  assert.ok(catalogIds.has("node tools/select_verification_targets.mjs --check"));
  assert.ok(catalogIds.has(directRefs.find((commandRef) => commandRef.includes("tests.test_app_entry_resolver"))));
});

test("canonical catalog seals entrypoint depth eligibility with cost and owner authority", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  const selectorRoutes = buildRouteIndex();
  const catalog = buildRepositoryVerificationCatalog({
    packageScripts: packageJson.scripts,
    verificationRecords: VERIFICATION_DOMAINS,
    selectorRoutes,
    repoRoot: REPO_ROOT,
  });
  const authority = new Map(catalog.authority.map((entry) => [entry.commandRef, entry]));

  assert.deepEqual(authority.get("verify:local-infra").entrypointPolicy, {
    schemaVersion: 1,
    eligibleEntrypoints: ["edit", "impact", "pr"],
    minimumDepth: "local",
    executionTarget: "child-safe",
    deferredReason: null,
    plannerDisposition: "planned",
    blockedReason: null,
    localProjection: {
      mode: "indivisible",
      proof: "canonical-local-leaf-equivalence",
    },
  });
  assert.deepEqual(
    authority.get("node tools/select_verification_targets.mjs --check").entrypointPolicy,
    {
      schemaVersion: 1,
      eligibleEntrypoints: ["pr"],
      minimumDepth: "pr",
      executionTarget: "child-safe",
      deferredReason: "requires-pr-verification",
      plannerDisposition: "planned",
      blockedReason: null,
      localProjection: null,
    },
  );
  assert.deepEqual(
    authority.get("node tools/run_adaptive_tests.mjs --entrypoint impact --execute --defer-main-thread")
      .entrypointPolicy,
    {
      schemaVersion: 1,
      eligibleEntrypoints: ["edit", "impact", "pr"],
      minimumDepth: "local",
      executionTarget: "child-safe",
      deferredReason: null,
      plannerDisposition: "blocked",
      blockedReason: "adaptive-recursion-forbidden",
      localProjection: null,
    },
  );
  assert.deepEqual(authority.get("test:node:p4:p4-3").entrypointPolicy.eligibleEntrypoints, ["nightly"]);
  assert.equal(authority.get("test:node:p4:p4-3").executionOwner, "main-thread");
  assert.equal(authority.get("test:node:p4:p4-3").cost, "heavy");
  assert.equal(authority.get("test:e2e:pages-public-release-gate").entrypointPolicy.minimumDepth, "release");
  assert.equal(authority.get("test:e2e:pages-public-release-gate").entrypointPolicy.executionTarget, "deployed-target");
  assert.equal(authority.get("verify:tno-coverage-chain").entrypointPolicy.minimumDepth, "nightly");
  assert.equal(authority.get("test:node:transport-workbench-controller").entrypointPolicy.minimumDepth, "pr");
  assert.equal(authority.get("test:node:thematic-layer-catalog").entrypointPolicy.minimumDepth, "pr");

  const forged = structuredClone(catalog);
  forged.sourceMode = "fixture";
  forged.authority.find((entry) => entry.commandRef === "verify:local-infra")
    .entrypointPolicy.eligibleEntrypoints = ["pr"];
  assert.throws(
    () => buildVerificationSelectionPlan(forged, ["verify:local-infra"], { allowUnverifiedCatalog: false }),
    /verification-plan-(?:authority-gap:verify:local-infra:entrypointPolicy|catalog-source-drift)/,
  );

  const prepared = prepareRepositoryVerificationCatalog({
    packageScripts: packageJson.scripts,
    verificationRecords: VERIFICATION_DOMAINS,
    selectorRoutes,
    repoRoot: REPO_ROOT,
  });
  const driftedPrepared = structuredClone(prepared);
  driftedPrepared.authority.find((entry) => entry.commandRef === "verify:local-infra")
    .entrypointPolicy.minimumDepth = "pr";
  assert.throws(
    () => assertPreparedVerificationCatalog(driftedPrepared, driftedPrepared.catalog),
    /verification-plan-source-authority-drift/,
  );
});
