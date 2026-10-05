import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const CANONICAL_RUNTIME_NAME = "runtime_topology.topo.json";

export function resolveJsonSourcePath(filePath) {
  const resolved = path.resolve(filePath instanceof URL ? fileURLToPath(filePath) : filePath);
  if (path.basename(resolved) === CANONICAL_RUNTIME_NAME && !fs.existsSync(resolved)) {
    const compressedPath = `${resolved}.gz`;
    if (fs.existsSync(compressedPath)) return compressedPath;
  }
  return resolved;
}

export function readJsonBytes(filePath) {
  const resolved = resolveJsonSourcePath(filePath);
  const bytes = fs.readFileSync(resolved);
  return resolved.endsWith(".gz") ? gunzipSync(bytes) : bytes;
}

export function readJsonSource(filePath) {
  return JSON.parse(readJsonBytes(filePath).toString("utf8"));
}

export function jsonSourceSha256(filePath) {
  return createHash("sha256").update(fs.readFileSync(resolveJsonSourcePath(filePath))).digest("hex");
}
