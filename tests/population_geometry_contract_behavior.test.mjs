// 人口层要跟随剧本拓扑：剧本拓扑重建后若没有重建人口层，运行时会以
// "requested geometry version mismatch" 拒绝加载。这里用运行时同一套取版本与加载逻辑，
// 在源数据和 Pages 产物两棵树上逐剧本加载人口数据，任何一处过期都会失败。
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { loadPopulationData, POPULATION_SCENARIO_IDS } from "../js/core/population_spatial_data.js";
import { getPopulationGeometryVersion } from "../js/core/population_spatial_view_model.js";

function readJson(file) {
  const raw = fs.readFileSync(file);
  return JSON.parse(file.endsWith(".gz") ? gunzipSync(raw) : raw);
}

function createTreeFetcher(root) {
  return async (url) => readJson(path.join(root, String(url).split("?")[0]));
}

function treesUnderTest() {
  const trees = [{ label: "source", root: process.cwd() }];
  const artifactRoot = String(process.env.SCENARIO_FORGE_PAGES_ARTIFACT_ROOT || "").trim();
  if (artifactRoot) trees.push({ label: "pages-artifact", root: path.resolve(artifactRoot, "app") });
  return trees;
}

for (const { label, root } of treesUnderTest()) {
  for (const scenarioId of POPULATION_SCENARIO_IDS) {
    test(`${label}: ${scenarioId} population data loads for the scenario's current geometry`, async () => {
      const manifest = readJson(path.join(root, "data/scenarios", scenarioId, "manifest.json"));
      const geometryVersion = getPopulationGeometryVersion({ activeScenarioManifest: manifest });
      assert.ok(geometryVersion, `${scenarioId} manifest must expose the runtime geometry version`);
      const data = await loadPopulationData({ scenarioId, geometryVersion, fetchJson: createTreeFetcher(root) });
      assert.ok(data && typeof data === "object");
    });
  }
}

test("source: population rows cover exactly the political features of each scenario topology", () => {
  const layer = readJson(path.join(process.cwd(), "data/thematic_layers/population/ghsl_population_2020_v1/manifest.json"));
  for (const scenarioId of POPULATION_SCENARIO_IDS) {
    const manifest = readJson(path.join(process.cwd(), "data/scenarios", scenarioId, "manifest.json"));
    const topology = readJson(path.join(process.cwd(), manifest.runtime_topology_url));
    const politicalIds = new Set(topology.objects.political.geometries
      .map((geometry) => String(geometry.properties?.id || geometry.properties?.NUTS_ID || geometry.id || "").trim()));
    const document = readJson(path.join(process.cwd(), layer.scenarios[scenarioId].features_url));
    const missing = [...politicalIds].filter((id) => !Object.hasOwn(document.features, id));
    assert.deepEqual(missing.slice(0, 10), [], `${scenarioId} political features without a population row`);
  }
});
