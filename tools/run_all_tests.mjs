#!/usr/bin/env node
// Run the whole unit suite instead of a path-selected subset.
//   node tools/run_all_tests.mjs node [--shard=1/2] [--all]
//   node tools/run_all_tests.mjs python [--all]
// Only entries in tests/quarantine.json are skipped (quarantine plus the slow lists).
// --all ignores the quarantine; nightly uses it so known breakage stays visible.
//
// A few tests compare sources with the built Pages artifact. dist/ is not tracked, so
// unless SCENARIO_FORGE_PAGES_ARTIFACT_ROOT or a local dist/ build exists, this builds one
// into .runtime/pages-test/dist and reuses it while HEAD and the working tree are unchanged.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const [suite, ...flags] = process.argv.slice(2);
const all = flags.includes("--all");
const shard = flags.find(flag => flag.startsWith("--shard="));
const quarantine = JSON.parse(readFileSync(new URL("../tests/quarantine.json", import.meta.url), "utf8"));
const TEST_ARTIFACT_ROOT = ".runtime/pages-test/dist";
const ARTIFACT_STAMP = ".runtime/pages-test/source-stamp.txt";

function run(command, args) {
  console.log(`> ${command} ${args.length > 12 ? `${args.slice(0, 6).join(" ")} … (${args.length} args)` : args.join(" ")}`);
  const result = spawnSync(command, args, { stdio: "inherit" });
  process.exit(result.status ?? 1);
}

function sourceStamp() {
  const git = (...args) => spawnSync("git", args, { encoding: "utf8", maxBuffer: 1 << 26 }).stdout || "";
  return createHash("sha256").update(git("rev-parse", "HEAD")).update(git("status", "--porcelain"))
    .update(git("diff")).digest("hex");
}

function ensurePagesArtifact() {
  if (process.env.SCENARIO_FORGE_PAGES_ARTIFACT_ROOT || existsSync("dist/index.html")) return;
  const stamp = sourceStamp();
  const built = existsSync(`${TEST_ARTIFACT_ROOT}/index.html`) && existsSync(ARTIFACT_STAMP)
    && readFileSync(ARTIFACT_STAMP, "utf8") === stamp;
  if (!built) {
    console.log(`> building the Pages artifact into ${TEST_ARTIFACT_ROOT} (no dist/ found)`);
    rmSync(".runtime/pages-test", { recursive: true, force: true });
    const result = spawnSync(process.execPath, ["tools/run_python.mjs", "tools/build_pages_dist.py", "--output-root", TEST_ARTIFACT_ROOT], { stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status ?? 1);
    writeFileSync(ARTIFACT_STAMP, stamp);
  }
  process.env.SCENARIO_FORGE_PAGES_ARTIFACT_ROOT = TEST_ARTIFACT_ROOT;
}

if (suite === "node" || suite === "python") ensurePagesArtifact();

if (suite === "node") {
  const skipped = new Set(all ? [] : [...Object.keys(quarantine.node), ...quarantine.nodeSlow.files]);
  const files = readdirSync("tests").filter(name => name.endsWith(".test.mjs"))
    .map(name => `tests/${name}`).filter(file => !skipped.has(file)).sort();
  for (const file of skipped) console.log(`skipped: ${file} — ${quarantine.node[file] || quarantine.nodeSlow._reason}`);
  run(process.execPath, ["--test", ...(shard ? [`--test-shard=${shard.slice(8)}`] : []), ...files]);
} else if (suite === "python") {
  const ignored = all ? [] : [...Object.keys(quarantine.python), ...quarantine.pythonSlow.files];
  // run_python.mjs picks py -3 / python on Windows and python3 / python elsewhere.
  run(process.execPath, ["tools/run_python.mjs", "-m", "pytest", "tests", "-n", "auto", "-q", "-p", "no:cacheprovider",
    ...ignored.flatMap(file => ["--ignore", file])]);
} else {
  console.error("usage: node tools/run_all_tests.mjs node|python [--shard=i/n] [--all]");
  process.exit(2);
}
