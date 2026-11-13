import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

// tests/e2e/test-layer-manifest.json 是 e2e 分层的唯一来源：tests/e2e 根目录下每个
// *.spec.js 恰好一条记录、一个主层级。各层的 Playwright 清单在运行时从它推导到 .runtime/，
// 不再提交生成文件，也不在这里另写数量或白名单。
//
// 范围：分层只覆盖 tests/e2e 根目录的 spec。layer:all = 清单里的全部根目录 spec。
// tests/e2e/dev、golden、release、ui_gallery 不在分层内，各有自己的入口
// （test:e2e:dev:*、test:e2e:golden、test:e2e:pages-public-release-gate 等）。
// 裸 test:e2e 是 Playwright 默认范围：tests/e2e 下除 release/ 外的全部（CI 上再去掉 dev/）。
const REPO_ROOT = process.cwd();
const E2E_DIR = path.join(REPO_ROOT, "tests", "e2e");
const MANIFEST_PATH = path.join(E2E_DIR, "test-layer-manifest.json");
const RUNTIME_TEST_LIST_DIR = path.join(REPO_ROOT, ".runtime", "tests", "e2e-lists");
const PLAYWRIGHT_CLI = path.join(REPO_ROOT, "node_modules", "@playwright", "test", "cli.js");
const LAYERS = ["smoke", "contract", "regression", "feature"];
const EXECUTION_MODES = new Set(["browser", "hybrid"]);
// smoke 要快：两个 worker、不重试。其余层沿用 Playwright 配置。
const LAYER_RUN_ARGS = { smoke: ["--workers=2", "--retries=0"] };
const SINGLE_SPEC_RUN_ARGS = ["--workers=1", "--retries=0"];

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function toRepoPath(value) {
  return value.split(path.sep).join("/");
}

function listRepoSpecs() {
  return fs
    .readdirSync(E2E_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".spec.js"))
    .map((entry) => toRepoPath(path.join("tests", "e2e", entry.name)))
    .sort();
}

function loadManifest() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const specs = Array.isArray(manifest?.specs) ? manifest.specs : [];
  ensure(manifest?.scope === "tests/e2e/*.spec.js", `Unexpected manifest scope: ${manifest?.scope}`);

  const repoSpecs = new Set(listRepoSpecs());
  const seen = new Set();
  for (const spec of specs) {
    const where = spec?.specPath;
    ensure(typeof where === "string" && /^tests\/e2e\/[^/]+\.spec\.js$/.test(where), `Invalid specPath: ${where}`);
    ensure(repoSpecs.has(where), `Manifest entry does not exist on disk: ${where}`);
    ensure(!seen.has(where), `Duplicate manifest entry: ${where}`);
    ensure(LAYERS.includes(spec.primaryLayer), `Invalid primaryLayer for ${where}: ${spec.primaryLayer}`);
    ensure(EXECUTION_MODES.has(spec.executionMode), `Invalid executionMode for ${where}: ${spec.executionMode}`);
    ensure(typeof spec.domain === "string" && spec.domain.trim(), `Missing domain for ${where}`);
    ensure(typeof spec.ownerHint === "string" && spec.ownerHint.trim(), `Missing ownerHint for ${where}`);
    seen.add(where);
  }
  const missing = [...repoSpecs].filter((specPath) => !seen.has(specPath));
  ensure(!missing.length, `Specs without a manifest entry: ${missing.join(", ")}`);
  ensure(specs.some((spec) => spec.primaryLayer === "smoke"), "The smoke layer is empty.");
  return specs;
}

function specsForLayer(layer) {
  ensure(layer === "all" || LAYERS.includes(layer), `Unknown layer: ${layer}`);
  const specs = loadManifest();
  return layer === "all" ? specs : specs.filter((spec) => spec.primaryLayer === layer);
}

function specsForField(field, value) {
  const matches = loadManifest().filter((spec) => spec[field] === value);
  ensure(matches.length > 0, `No E2E specs found for ${field}=${value}.`);
  return matches;
}

// Playwright 的 --test-list 条目相对 testDir（tests/e2e），根目录 spec 即文件名。
function writeTestList(name, specs) {
  fs.mkdirSync(RUNTIME_TEST_LIST_DIR, { recursive: true });
  const filePath = path.join(RUNTIME_TEST_LIST_DIR, `${name}.txt`);
  const entries = specs.map((spec) => path.posix.basename(spec.specPath)).sort();
  fs.writeFileSync(filePath, `${entries.join("\n")}\n`, "utf8");
  return filePath;
}

function runSpecs(name, specs, runArgs, extraArgs) {
  const cliArgs = [PLAYWRIGHT_CLI, "test", `--test-list=${writeTestList(name, specs)}`, ...runArgs, ...extraArgs];
  const result = spawnSync(process.execPath, cliArgs, { stdio: "inherit", cwd: REPO_ROOT });
  process.exit(typeof result.status === "number" ? result.status : 1);
}

function printSpecs(specs) {
  for (const spec of specs) {
    console.log(`${spec.specPath}\t${spec.primaryLayer}\t${spec.domain}\t${spec.ownerHint}`);
  }
}

function main() {
  const [, , command, target, ...rest] = process.argv;
  const extraArgs = rest[0] === "--" ? rest.slice(1) : rest;

  switch (command) {
    case "check": {
      const specs = loadManifest();
      for (const layer of LAYERS) {
        console.log(`${layer}: ${specs.filter((spec) => spec.primaryLayer === layer).length}`);
      }
      console.log(`E2E layer manifest covers all ${specs.length} root-level specs.`);
      return;
    }
    case "list":
      printSpecs(specsForLayer(target));
      return;
    case "run":
      runSpecs(target, specsForLayer(target), LAYER_RUN_ARGS[target] || [], extraArgs);
      return;
    case "list-domain":
      printSpecs(specsForField("domain", target));
      return;
    case "run-domain":
      runSpecs(`domain-${target}`, specsForField("domain", target), SINGLE_SPEC_RUN_ARGS, extraArgs);
      return;
    case "list-owner":
      printSpecs(specsForField("ownerHint", target));
      return;
    case "run-owner":
      runSpecs(`owner-${target}`, specsForField("ownerHint", target), SINGLE_SPEC_RUN_ARGS, extraArgs);
      return;
    case "run-spec": {
      const matches = specsForField("specPath", toRepoPath(target || ""));
      runSpecs(`spec-${path.posix.basename(matches[0].specPath, ".spec.js")}`, matches, SINGLE_SPEC_RUN_ARGS, extraArgs);
      return;
    }
    case "explain":
      console.log(JSON.stringify(specsForField("specPath", toRepoPath(target || ""))[0], null, 2));
      return;
  }

  throw new Error("Usage: node tools/e2e_layering.mjs <check|list <layer>|run <layer>|list-domain <domain>|run-domain <domain>|list-owner <owner>|run-owner <owner>|run-spec <specPath>|explain <specPath>>  (layer: smoke|contract|regression|feature|all)");
}

main();
