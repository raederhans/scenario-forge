import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  loadAllowlist,
  normalizeRelativePath,
  scanContentForStateWrites,
} = require("./eslint-rules/no-direct-state-mutation.js");

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWLIST_PATH = path.join(PROJECT_ROOT, "tools", "eslint-rules", "state-writer-allowlist.json");
const SCAN_ROOTS = [
  path.join(PROJECT_ROOT, "js"),
  path.join(PROJECT_ROOT, "tests"),
];
const EXTENSIONS = new Set([".js", ".mjs"]);

function walkFiles(rootDir) {
  const results = [];
  if (!fs.existsSync(rootDir)) return results;
  const queue = [rootDir];
  while (queue.length) {
    const current = queue.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const nextPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(nextPath);
        continue;
      }
      if (!EXTENSIONS.has(path.extname(entry.name))) continue;
      results.push(nextPath);
    }
  }
  return results;
}

function collectCurrentWriters() {
  const current = new Set();
  for (const rootDir of SCAN_ROOTS) {
    for (const filePath of walkFiles(rootDir)) {
      const content = fs.readFileSync(filePath, "utf8");
      if (scanContentForStateWrites(content).length > 0) {
        current.add(normalizeRelativePath(path.relative(PROJECT_ROOT, filePath)));
      }
    }
  }
  return current;
}

const allowlist = loadAllowlist(ALLOWLIST_PATH);
const currentWriters = collectCurrentWriters();
const unexpected = [...currentWriters].filter((filePath) => !allowlist.has(filePath)).sort();
const stale = [...allowlist].filter((filePath) => !currentWriters.has(filePath)).sort();

if (!unexpected.length && !stale.length) {
  console.log(`State write allowlist passed with ${currentWriters.size} tracked files.`);
  process.exit(0);
}

if (unexpected.length) {
  console.error("Unexpected direct state write files:");
  unexpected.forEach((filePath) => console.error(`  + ${filePath}`));
}
if (stale.length) {
  console.error("Stale allowlist entries:");
  stale.forEach((filePath) => console.error(`  - ${filePath}`));
}
process.exit(1);
