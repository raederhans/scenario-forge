import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HISTORICAL_1930_CITY_LIGHTS_ENTRIES } from "../js/core/city_lights_historical_1930_asset.js";
const fixtureDescriptorUrl = new URL("./fixtures/city_lights/modern_source_fixture_descriptor.json", import.meta.url);
const fixtureSourceUrl = new URL("./fixtures/city_lights/modern_source_fixture.pgm", import.meta.url);

const generatorUrl = new URL("../tools/build_city_lights_modern_asset.py", import.meta.url);

const fixtureDescriptor = JSON.parse(await readFile(fixtureDescriptorUrl, "utf8"));

function runModernGenerator(args) {
  const command = process.platform === "win32" ? "py" : "python3";
  const prefixArgs = process.platform === "win32" ? ["-3"] : [];
  return spawnSync(command, [...prefixArgs, fileURLToPath(generatorUrl), ...args], {
    stdio: "inherit",
    windowsHide: true,
  });
}

async function writeDescriptor(path, payload, newline = "\n") {
  const canonical = `${JSON.stringify(payload, null, 2)}\n`;
  await writeFile(path, canonical.replaceAll("\n", newline), "utf8");
}

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
  assert.equal(lfResult.status, 0);
  assert.equal(crlfResult.status, 0);
  const lfBytes = await readFile(lfOutput);
  const crlfBytes = await readFile(crlfOutput);
  assert.deepEqual(lfBytes, crlfBytes);
  assert.equal(lfBytes.includes(13), false, "generated module must contain LF line endings only");
});

test("historical city lights have valid coordinates and intensity", () => {
  for (const entry of HISTORICAL_1930_CITY_LIGHTS_ENTRIES) {
    assert.ok(Number.isFinite(entry.lon));
    assert.ok(entry.lon >= -180 && entry.lon <= 180);
    assert.ok(Number.isFinite(entry.lat));
    assert.ok(entry.lat >= -89.999 && entry.lat <= 89.999);
    assert.ok(Number.isFinite(entry.weight));
    assert.ok(entry.weight >= 0.18 && entry.weight <= 1.0);
  }
});
