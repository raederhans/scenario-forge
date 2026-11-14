import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const assetUrl = new URL("../js/core/city_lights_historical_1930_asset.js", import.meta.url);
const entriesUrl = new URL("../data/city_lights/historical_1930_entries.json", import.meta.url);
const modernAssetUrl = new URL("../js/core/city_lights_modern_asset.js", import.meta.url);
const modernDescriptorUrl = new URL("../data/city_lights/modern_source_descriptor.json", import.meta.url);
const fixtureDescriptorUrl = new URL("./fixtures/city_lights/modern_source_fixture_descriptor.json", import.meta.url);
const fixtureSourceUrl = new URL("./fixtures/city_lights/modern_source_fixture.pgm", import.meta.url);
const manifestUrl = new URL("../data/manifest.json", import.meta.url);
const catalogUrl = new URL("../data/CATALOG.json", import.meta.url);
const generatorUrl = new URL("../tools/build_city_lights_modern_asset.py", import.meta.url);
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const MODERN_RUNTIME_SHA256 = "d2438a7372c12411e048ea95fc55758fd4c95a1089547f54dd36258d60555dae";
const HISTORICAL_RUNTIME_SHA256 = "c06b718dc02ea23e01d3c9ed1aa595667515fbe8b23b009bfd6aef1303c0fe65";
const entriesPayload = JSON.parse(await readFile(entriesUrl, "utf8"));
const modernDescriptor = JSON.parse(await readFile(modernDescriptorUrl, "utf8"));
const fixtureDescriptor = JSON.parse(await readFile(fixtureDescriptorUrl, "utf8"));
const dataManifest = JSON.parse(await readFile(manifestUrl, "utf8"));
const dataCatalog = JSON.parse(await readFile(catalogUrl, "utf8"));
const assetModule = await import(assetUrl.href);
const {
  HISTORICAL_1930_CITY_LIGHTS_ENTRIES,
  HISTORICAL_1930_CITY_LIGHTS_SOURCE,
  HISTORICAL_1930_CITY_LIGHTS_STATS,
} = assetModule;

function findCity(nameAscii, countryCode) {
  return HISTORICAL_1930_CITY_LIGHTS_ENTRIES.find((entry) => (
    entry.nameAscii === nameAscii && entry.countryCode === countryCode
  ));
}

function runModernGenerator(args) {
  return runPython([fileURLToPath(generatorUrl), ...args]);
}

function runPython(args) {
  const command = process.platform === "win32" ? "py" : "python3";
  const prefixArgs = process.platform === "win32" ? ["-3"] : [];
  return spawnSync(command, [...prefixArgs, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
}

function readGitBlob(ref, repoPath) {
  const result = spawnSync("git", ["cat-file", "blob", `${ref}:${repoPath}`], {
    cwd: repoRoot,
    encoding: null,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr?.toString("utf8"));
  return result.stdout;
}

function assertCliFailure(result, messagePattern) {
  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.match(result.stderr, messagePattern);
  assert.equal(result.stderr.includes("Traceback"), false, result.stderr);
}

async function writeDescriptor(path, payload, newline = "\n") {
  const canonical = `${JSON.stringify(payload, null, 2)}\n`;
  await writeFile(path, canonical.replaceAll("\n", newline), "utf8");
}

test("city lights ownership separates source descriptor, generated data, runtime module, and fixtures", async () => {
  assert.equal(modernDescriptor.ownership_class, "production_source_descriptor");
  assert.equal(modernDescriptor.product.version, "2016");
  assert.match(modernDescriptor.product.known_url, /BlackMarble_2016_3km_gray\.jpg$/);
  assert.equal(modernDescriptor.provenance.license_status, "requires_source_authority_confirmation");
  assert.deepEqual(modernDescriptor.grid, {
    width: 720,
    height: 360,
    base_threshold: 2,
    corridor_threshold: 14,
  });
  assert.equal(modernDescriptor.input_identity.status, "unavailable");
  assert.equal(modernDescriptor.input_identity.attestation, "not_attested");
  assert.equal(modernDescriptor.input_identity.sha256, null);
  assert.equal(modernDescriptor.authority.status, "source_authority_required");

  const descriptorOutput = dataManifest.outputs["city_lights/modern_source_descriptor.json"];
  const runtimeOutput = dataManifest.outputs["js/core/city_lights_modern_asset.js"];
  assert.equal(descriptorOutput.artifact_class, "source_descriptor");
  assert.equal(descriptorOutput.owner, "source_authority.city_lights_modern_descriptor");
  assert.equal(runtimeOutput.artifact_class, "publish");
  assert.equal(runtimeOutput.owner, "init_map_data.city_lights_assets");
  const generatedEntries = dataCatalog.entries.find((entry) => (
    entry.url === "data/city_lights/historical_1930_entries.json"
  ));
  const runtimeModule = dataCatalog.entries.find((entry) => (
    entry.url === "js/core/city_lights_modern_asset.js"
  ));
  assert.equal(generatedEntries.role, "city_lights_entries");
  assert.equal(
    generatedEntries.owner,
    "runtime_asset_registry.assets.city_lights:historical_1930:entries",
  );
  assert.equal(runtimeModule.role, "modern_city_lights_asset");
  assert.equal(runtimeModule.owner, "init_map_data.city_lights_assets");
  assert.equal(fixtureDescriptor.ownership_class, "test_fixture_descriptor");
  assert.equal(JSON.stringify(dataManifest).includes("tests/fixtures/city_lights"), false);
  assert.equal(JSON.stringify(dataCatalog).includes("tests/fixtures/city_lights"), false);

  const runtimeBytes = readGitBlob("HEAD", "js/core/city_lights_modern_asset.js");
  const historicalRuntimeBytes = readGitBlob("HEAD", "js/core/city_lights_historical_1930_asset.js");
  const runtimeSha256 = createHash("sha256").update(runtimeBytes).digest("hex");
  const historicalRuntimeSha256 = createHash("sha256").update(historicalRuntimeBytes).digest("hex");
  assert.equal(runtimeSha256, MODERN_RUNTIME_SHA256);
  assert.equal(historicalRuntimeSha256, HISTORICAL_RUNTIME_SHA256);
  assert.equal(runtimeOutput.size_bytes, runtimeBytes.length);
  assert.equal(runtimeOutput.sha256, runtimeSha256);
  const historicalOutput = dataManifest.outputs["js/core/city_lights_historical_1930_asset.js"];
  assert.equal(historicalOutput.size_bytes, historicalRuntimeBytes.length);
  assert.equal(historicalOutput.sha256, historicalRuntimeSha256);
});

test("modern city lights fixture rebuild is LF-stable across descriptor checkouts", async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), "city-lights-generator-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const lfDescriptor = join(tempRoot, "fixture-lf.json");
  const crlfDescriptor = join(tempRoot, "fixture-crlf.json");
  const lfOutput = join(tempRoot, "lf.js");
  const crlfOutput = join(tempRoot, "crlf.js");
  await writeDescriptor(lfDescriptor, fixtureDescriptor, "\n");
  await writeDescriptor(crlfDescriptor, fixtureDescriptor, "\r\n");
  const sharedArgs = [
    "--source-file", fileURLToPath(fixtureSourceUrl),
    "--require-attested-input",
  ];
  const lfResult = runModernGenerator([
    "--source-descriptor", lfDescriptor,
    ...sharedArgs,
    "--output", lfOutput,
  ]);
  const crlfResult = runModernGenerator([
    "--source-descriptor", crlfDescriptor,
    ...sharedArgs,
    "--output", crlfOutput,
  ]);
  assert.equal(lfResult.status, 0, lfResult.stderr || lfResult.stdout);
  assert.equal(crlfResult.status, 0, crlfResult.stderr || crlfResult.stdout);
  const lfBytes = await readFile(lfOutput);
  const crlfBytes = await readFile(crlfOutput);
  assert.deepEqual(lfBytes, crlfBytes);
  assert.equal(lfBytes.includes(13), false, "generated module must contain LF line endings only");
  assert.equal(
    createHash("sha256").update(lfBytes).digest("hex"),
    createHash("sha256").update(crlfBytes).digest("hex"),
  );
  const generatedSource = lfBytes.toString("utf8");
  assert.match(generatedSource, /descriptorId: 'repository_city_lights_fixture_v1'/);
  assert.match(generatedSource, /inputIdentityStatus: 'available'/);
  assert.match(generatedSource, /authenticatedRebuild: true/);
  assert.equal(generatedSource.includes(fileURLToPath(fixtureSourceUrl)), false);
});

test("modern production descriptor fails before network, cache, or source access", async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), "city-lights-preflight-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const outputPath = join(tempRoot, "production-unattested.js");
  const probe = String.raw`
import importlib.util
import json
import sys

spec = importlib.util.spec_from_file_location("city_lights_generator", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
counts = {"network_calls": 0, "cache_writes": 0, "source_accesses": 0}
original_urlopen = module.urllib.request.urlopen
original_mkdir = module.Path.mkdir
original_exists = module.Path.exists
original_write_bytes = module.Path.write_bytes

def is_cache_path(path):
    return ".runtime/tmp/city_lights" in str(path).replace("\\", "/")

def guarded_urlopen(*args, **kwargs):
    counts["network_calls"] += 1
    raise AssertionError("network access reached")

def guarded_mkdir(path, *args, **kwargs):
    if is_cache_path(path):
        counts["cache_writes"] += 1
    return original_mkdir(path, *args, **kwargs)

def guarded_exists(path, *args, **kwargs):
    if is_cache_path(path):
        counts["source_accesses"] += 1
    return original_exists(path, *args, **kwargs)

def guarded_write_bytes(path, *args, **kwargs):
    if is_cache_path(path):
        counts["cache_writes"] += 1
    return original_write_bytes(path, *args, **kwargs)

module.urllib.request.urlopen = guarded_urlopen
module.Path.mkdir = guarded_mkdir
module.Path.exists = guarded_exists
module.Path.write_bytes = guarded_write_bytes
sys.argv = [sys.argv[1], "--source-descriptor", sys.argv[2], "--require-attested-input", "--output", sys.argv[3]]
message = ""
try:
    module.main()
except module.GeneratorContractError as exc:
    message = str(exc)
print(json.dumps({"counts": counts, "message": message}, sort_keys=True))
if counts != {"network_calls": 0, "cache_writes": 0, "source_accesses": 0}:
    raise SystemExit(4)
if "input identity is not attested" not in message:
    raise SystemExit(5)
`;
  const result = runPython([
    "-c", probe,
    fileURLToPath(generatorUrl),
    fileURLToPath(modernDescriptorUrl),
    outputPath,
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout.trim());
  assert.deepEqual(report.counts, {
    cache_writes: 0,
    network_calls: 0,
    source_accesses: 0,
  });
  assert.equal(await readFile(outputPath).then(() => true, () => false), false);
});

test("modern generator rejects malformed identity algorithms, hashes, and enum values", async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), "city-lights-identity-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const cases = [
    {
      name: "algorithm",
      mutate: (descriptor) => { descriptor.input_identity.algorithm = "sha512"; },
      message: /algorithm must be exactly 'sha256'/,
    },
    {
      name: "nonhex",
      mutate: (descriptor) => { descriptor.input_identity.sha256 = "g".repeat(64); },
      message: /64 lowercase hexadecimal characters/,
    },
    {
      name: "short",
      mutate: (descriptor) => { descriptor.input_identity.sha256 = "a".repeat(63); },
      message: /64 lowercase hexadecimal characters/,
    },
    {
      name: "uppercase",
      mutate: (descriptor) => { descriptor.input_identity.sha256 = descriptor.input_identity.sha256.toUpperCase(); },
      message: /64 lowercase hexadecimal characters/,
    },
    {
      name: "status-enum",
      mutate: (descriptor) => { descriptor.input_identity.status = "known"; },
      message: /status must be one of: available, unavailable/,
    },
    {
      name: "attestation-enum",
      mutate: (descriptor) => { descriptor.input_identity.attestation = "verified"; },
      message: /attestation must be one of: attested, not_attested/,
    },
    {
      name: "invalid-combination",
      mutate: (descriptor) => {
        descriptor.input_identity.status = "unavailable";
        descriptor.input_identity.attestation = "attested";
      },
      message: /Attested input identity requires status 'available'/,
    },
  ];

  for (const testCase of cases) {
    const descriptor = structuredClone(fixtureDescriptor);
    testCase.mutate(descriptor);
    const descriptorPath = join(tempRoot, `${testCase.name}.json`);
    await writeDescriptor(descriptorPath, descriptor);
    const result = runModernGenerator([
      "--source-descriptor", descriptorPath,
      "--source-file", fileURLToPath(fixtureSourceUrl),
      "--require-attested-input",
      "--output", join(tempRoot, `${testCase.name}.js`),
    ]);
    assertCliFailure(result, testCase.message);
  }
});

test("modern generator bounds grid and threshold parameters before source access", async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), "city-lights-parameters-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const cases = [
    { args: ["--grid-width", "0"], message: /Grid width.*1\.\.4096/ },
    { args: ["--grid-height", "-1"], message: /Grid height.*1\.\.4096/ },
    { args: ["--grid-width", "4097"], message: /Grid width.*1\.\.4096/ },
    {
      args: ["--grid-width", "4096", "--grid-height", "4096"],
      message: /Grid cell count must not exceed 4194304/,
    },
    { args: ["--base-threshold", "-1"], message: /Base threshold.*0\.\.255/ },
    { args: ["--corridor-threshold", "256"], message: /Corridor threshold.*0\.\.255/ },
  ];

  for (const [index, testCase] of cases.entries()) {
    const missingSource = join(tempRoot, `missing-${index}.pgm`);
    const result = runModernGenerator([
      "--source-descriptor", fileURLToPath(fixtureDescriptorUrl),
      "--source-file", missingSource,
      ...testCase.args,
      "--output", join(tempRoot, `invalid-${index}.js`),
    ]);
    assertCliFailure(result, testCase.message);
    assert.equal(result.stderr.includes("Source file not found"), false, result.stderr);
  }
});

test("modern generator rejects output overlap using resolved Windows path semantics", async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), "city-lights-paths-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const sourcePath = fileURLToPath(fixtureSourceUrl);
  const descriptorPath = fileURLToPath(fixtureDescriptorUrl);
  const sourceBefore = createHash("sha256").update(await readFile(sourcePath)).digest("hex");
  const descriptorBefore = createHash("sha256").update(await readFile(descriptorPath)).digest("hex");
  const baseArgs = [
    "--source-descriptor", descriptorPath,
    "--source-file", sourcePath,
  ];

  const sourceOverlap = runModernGenerator([...baseArgs, "--output", sourcePath]);
  assertCliFailure(sourceOverlap, /Output path must differ from source image path/);

  const descriptorOverlap = runModernGenerator([...baseArgs, "--output", descriptorPath]);
  assertCliFailure(descriptorOverlap, /Output path must differ from source descriptor path/);

  const cacheOverlap = runModernGenerator([
    "--source-descriptor", descriptorPath,
    "--output", join(repoRoot, ".runtime", "tmp", "city_lights", "modern-source-v1"),
  ]);
  assertCliFailure(cacheOverlap, /Output path must differ from source image path/);

  if (process.platform === "win32") {
    const caseVariantOverlap = runModernGenerator([
      ...baseArgs,
      "--output", descriptorPath.toUpperCase(),
    ]);
    assertCliFailure(caseVariantOverlap, /Output path must differ from source descriptor path/);
  }

  assert.equal(
    createHash("sha256").update(await readFile(sourcePath)).digest("hex"),
    sourceBefore,
  );
  assert.equal(
    createHash("sha256").update(await readFile(descriptorPath)).digest("hex"),
    descriptorBefore,
  );
});

test("historical 1930 city lights asset exposes calibrated exports", () => {
  assert.equal(HISTORICAL_1930_CITY_LIGHTS_SOURCE.entriesKey, "city_lights:historical_1930:entries");
  assert.deepEqual(HISTORICAL_1930_CITY_LIGHTS_SOURCE.entriesRefParts, ["data", "city_lights/historical_1930_entries.json"]);
  assert.equal(HISTORICAL_1930_CITY_LIGHTS_STATS.calibrationVersion, "balanced-2026-04");
  assert.ok(Array.isArray(HISTORICAL_1930_CITY_LIGHTS_ENTRIES));
  assert.ok(Array.isArray(entriesPayload.entries));
  assert.ok(HISTORICAL_1930_CITY_LIGHTS_ENTRIES.length >= 1450);
  assert.ok(HISTORICAL_1930_CITY_LIGHTS_ENTRIES.length <= 1800);
  assert.equal(entriesPayload.entries.length, 1580);
  assert.equal(HISTORICAL_1930_CITY_LIGHTS_STATS.entryCount, HISTORICAL_1930_CITY_LIGHTS_ENTRIES.length);
  assert.deepEqual(entriesPayload.stats, HISTORICAL_1930_CITY_LIGHTS_STATS);
});

test("historical 1930 city light entries keep legal render fields", () => {
  for (const entry of HISTORICAL_1930_CITY_LIGHTS_ENTRIES) {
    assert.equal(typeof entry.nameAscii, "string");
    assert.equal(typeof entry.countryCode, "string");
    assert.ok(Number.isFinite(entry.lon));
    assert.ok(entry.lon >= -180 && entry.lon <= 180);
    assert.ok(Number.isFinite(entry.lat));
    assert.ok(entry.lat >= -89.999 && entry.lat <= 89.999);
    assert.ok(Number.isFinite(entry.weight));
    assert.ok(entry.weight >= 0.18 && entry.weight <= 1.0);
    assert.equal(typeof entry.capitalKind, "string");
    assert.ok(Number.isFinite(entry.population));
  }
});

test("historical 1930 region calibration keeps target anchor cities visible", () => {
  const anchors = [
    ["London", "GB", 0.95],
    ["Paris", "FR", 0.95],
    ["Berlin", "DE", 0.9],
    ["Milan", "IT", 0.8],
    ["Rome", "IT", 0.95],
    ["Tokyo", "JP", 0.95],
    ["Osaka", "JP", 0.9],
    ["New York", "US", 0.76],
    ["Washington", "US", 0.86],
    ["Beijing", "CN", 0.95],
    ["Delhi", "IN", 0.84],
    ["Shanghai", "CN", 0.84],
  ];
  for (const [nameAscii, countryCode, minimumWeight] of anchors) {
    const entry = findCity(nameAscii, countryCode);
    assert.ok(entry, `${nameAscii} ${countryCode} should be present`);
    assert.ok(
      entry.weight >= minimumWeight,
      `${nameAscii} ${countryCode} weight ${entry.weight} should be >= ${minimumWeight}`
    );
  }
});

test("historical 1930 calibration caps oversized non-capital Asian hubs", () => {
  for (const [nameAscii, countryCode] of [["Shanghai", "CN"], ["Mumbai", "IN"]]) {
    const entry = findCity(nameAscii, countryCode);
    assert.ok(entry, `${nameAscii} ${countryCode} should be present`);
    assert.ok(entry.population >= 18_000_000);
    assert.notEqual(entry.capitalKind, "country_capital");
    assert.ok(entry.weight <= 0.96);
  }
});
