#!/usr/bin/env node
// Run the whole unit suite instead of a path-selected subset.
//   node tools/run_all_tests.mjs node [--shard=1/2] [--all]
//   node tools/run_all_tests.mjs python [--all]
// Only entries in tests/quarantine.json are skipped (quarantine plus the slow lists).
// --all ignores the quarantine; nightly uses it so known breakage stays visible.
import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const [suite, ...flags] = process.argv.slice(2);
const all = flags.includes("--all");
const shard = flags.find(flag => flag.startsWith("--shard="));
const quarantine = JSON.parse(readFileSync(new URL("../tests/quarantine.json", import.meta.url), "utf8"));

function run(command, args) {
  console.log(`> ${command} ${args.length > 12 ? `${args.slice(0, 6).join(" ")} … (${args.length} args)` : args.join(" ")}`);
  const result = spawnSync(command, args, { stdio: "inherit" });
  process.exit(result.status ?? 1);
}

if (suite === "node") {
  const skipped = all ? new Set() : new Set([...Object.keys(quarantine.node), ...quarantine.nodeSlow.files]);
  const files = readdirSync("tests").filter(name => name.endsWith(".test.mjs"))
    .map(name => `tests/${name}`).filter(file => !skipped.has(file)).sort();
  for (const file of skipped) console.log(`skipped: ${file} — ${quarantine.node[file] || quarantine.nodeSlow._reason}`);
  run(process.execPath, ["--test", ...(shard ? [`--test-shard=${shard.slice(8)}`] : []), ...files]);
} else if (suite === "python") {
  const ignored = all ? [] : [...Object.keys(quarantine.python), ...quarantine.pythonSlow.files];
  run("python", ["-m", "pytest", "tests", "-n", "auto", "-q", "-p", "no:cacheprovider",
    ...ignored.flatMap(file => ["--ignore", file])]);
} else {
  console.error("usage: node tools/run_all_tests.mjs node|python [--shard=i/n] [--all]");
  process.exit(2);
}
