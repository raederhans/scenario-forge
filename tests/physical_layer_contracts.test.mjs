import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();

function readRepoFile(...relativeParts) {
  return fs.readFileSync(path.join(REPO_ROOT, ...relativeParts), "utf8");
}

test("physical layer runtime assets stay registered in the source and manifest registries", () => {
  const registry = JSON.parse(readRepoFile("data", "runtime_asset_registry.json"));
  const manifest = JSON.parse(readRepoFile("data", "manifest.json"));

  const expectedAssets = {
    "context_layer:physical": "data/europe_physical.geojson",
    "context_layer:physical_semantics": "data/global_physical_semantics.topo.json",
    "context_layer:physical_contours_major": "data/global_contours.major.topo.json",
    "context_layer:physical_contours_minor": "data/global_contours.minor.topo.json",
  };

  Object.entries(expectedAssets).forEach(([assetKey, assetPath]) => {
    assert.equal(registry.assets?.[assetKey]?.url, assetPath, assetKey);
    assert.equal(manifest.runtime_asset_registry?.assets?.[assetKey]?.url, assetPath, assetKey);
  });

});
