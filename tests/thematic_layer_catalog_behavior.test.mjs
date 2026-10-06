import assert from "node:assert/strict";
import test from "node:test";

import thematicIndex from "../data/thematic_layers/index.json" with { type: "json" };
import politicalManifest from "../data/thematic_layers/political/state_capacity_demo/manifest.json" with { type: "json" };
import wgiManifest from "../data/thematic_layers/political/wgi_state_capacity_v1/manifest.json" with { type: "json" };
import hdiManifest from "../data/thematic_layers/social/human_development_v1/manifest.json" with { type: "json" };
import wdiPopulationManifest from "../data/thematic_layers/population/wdi_population_v1/manifest.json" with { type: "json" };
import socialManifest from "../data/thematic_layers/social/human_development_demo/manifest.json" with { type: "json" };
import populationManifest from "../data/thematic_layers/population/population_density_demo/manifest.json" with { type: "json" };
import {
  listDefaultThematicLayerSummaries,
  loadThematicLayerCatalogPreview,
  normalizeThematicLayerCatalogPayload,
  THEMATIC_LAYER_RENDER_DISABLED_REASON,
  THEMATIC_REAL_SOURCE_DERIVED_METADATA_REASON,
  THEMATIC_REAL_SOURCE_NOT_INGESTED_REASON,
  THEMATIC_SOURCE_POLICY_FIXTURE_ONLY,
  THEMATIC_SOURCE_POLICY_REAL_SOURCE_CACHE_ONLY,
  THEMATIC_WGI_MAIN_MAP_SUPPORT_LABEL,
  THEMATIC_HDI_MAIN_MAP_SUPPORT_LABEL,
  THEMATIC_POPULATION_MAIN_MAP_SUPPORT_LABEL,
  THEMATIC_MAIN_MAP_SUPPORT_LABEL,
} from "../js/core/thematic_layer_catalog.js";
import { THEMATIC_WGI_LAYER_ID, THEMATIC_WGI_METRIC_ID, THEMATIC_WGI_METRICS, THEMATIC_WGI_SCENARIO_IDS } from "../js/core/thematic_wgi_data.js";
import { THEMATIC_HDI_LAYER_ID, THEMATIC_HDI_METRIC_ID, THEMATIC_HDI_METRICS } from "../js/core/thematic_hdi_data.js";
import { THEMATIC_POPULATION_LAYER_ID, THEMATIC_POPULATION_METRIC_ID, THEMATIC_POPULATION_METRICS } from "../js/core/thematic_population_data.js";
import {
  resolveThematicLayerCatalogAssetKey,
  resolveThematicLayerCatalogUrl,
  resolveThematicLayerManifestAssetKey,
  resolveThematicLayerManifestUrl,
} from "../js/core/runtime_asset_registry.js";

const REAL_LAYER_IDS = [THEMATIC_WGI_LAYER_ID, THEMATIC_HDI_LAYER_ID, THEMATIC_POPULATION_LAYER_ID];

test("thematic registry resolvers expose the catalog and manifest asset keys", () => {
  assert.equal(resolveThematicLayerCatalogAssetKey(), "thematic_layer_catalog");
  assert.equal(resolveThematicLayerCatalogUrl(), "data/thematic_layers/index.json");
  assert.equal(
    resolveThematicLayerManifestAssetKey("population_density_demo"),
    "thematic_layer:population_density_demo",
  );
  assert.equal(
    resolveThematicLayerManifestUrl("political_state_capacity_demo"),
    "data/thematic_layers/political/state_capacity_demo/manifest.json",
  );
  assert.equal(resolveThematicLayerManifestAssetKey(THEMATIC_POPULATION_LAYER_ID), "thematic_layer:population_wdi_population_v1");
  assert.equal(resolveThematicLayerManifestUrl(THEMATIC_POPULATION_LAYER_ID), "data/thematic_layers/population/wdi_population_v1/manifest.json");
});

test("default thematic summaries distinguish all three real-source families from fixture demos", () => {
  const layers = listDefaultThematicLayerSummaries();

  assert.equal(layers.length, thematicIndex.layers.length);
  layers.forEach((layer) => {
    if (REAL_LAYER_IDS.includes(layer.layerId)) {
      assert.equal(layer.sourcePolicy, THEMATIC_SOURCE_POLICY_REAL_SOURCE_CACHE_ONLY);
      assert.equal(layer.fixtureOnly, false);
      assert.equal(layer.realSourceStatus, THEMATIC_REAL_SOURCE_DERIVED_METADATA_REASON);
    } else {
      assert.equal(layer.sourcePolicy, THEMATIC_SOURCE_POLICY_FIXTURE_ONLY);
      assert.equal(layer.fixtureOnly, true);
      assert.equal(layer.realSourceStatus, THEMATIC_REAL_SOURCE_NOT_INGESTED_REASON);
    }
    assert.equal(layer.hiddenByDefault, true);
    assert.equal(layer.supportsRuntimePreview, true);
    assert.equal(layer.supportsMainMapRender, REAL_LAYER_IDS.includes(layer.layerId));
    assert.equal(layer.disabledReason, REAL_LAYER_IDS.includes(layer.layerId) ? "" : THEMATIC_LAYER_RENDER_DISABLED_REASON);
  });
});

test("catalog normalization joins index rows with loaded manifests", () => {
  const preview = normalizeThematicLayerCatalogPayload(thematicIndex, {
    assetKey: "thematic_layer_catalog",
    manifestByLayerId: {
      political_state_capacity_demo: politicalManifest,
      social_human_development_demo: socialManifest,
      population_density_demo: populationManifest,
      political_wgi_state_capacity_v1: wgiManifest,
      social_human_development_v1: hdiManifest,
      population_wdi_population_v1: wdiPopulationManifest,
    },
  });

  assert.equal(preview.status, "ready");
  assert.equal(preview.assetKey, "thematic_layer_catalog");
  assert.equal(preview.layerCount, thematicIndex.layers.length);
  assert.equal(preview.loadedManifestCount, thematicIndex.layers.length);
  assert.equal(preview.layers[0].payloadKind, "Admin metrics available");
  assert.equal(preview.layers[2].payloadKind, "Grid payload available");
  assert.equal(preview.layers[2].featureCount, 259200);
  assert.equal(preview.layers[2].renderer, "grid_heatmap");
  const wgi = preview.layers.find((layer) => layer.layerId === "political_wgi_state_capacity_v1");
  assert.equal(wgi.title, THEMATIC_WGI_MAIN_MAP_SUPPORT_LABEL);
  assert.equal(wgi.sourcePolicy, THEMATIC_SOURCE_POLICY_REAL_SOURCE_CACHE_ONLY);
  assert.equal(wgi.realSourceStatus, THEMATIC_REAL_SOURCE_DERIVED_METADATA_REASON);
  assert.equal(wgi.supportsMainMapRender, true);
  assert.deepEqual(wgi.runtimeMetricIds, THEMATIC_WGI_METRICS.map((metric) => metric.id));
  assert.deepEqual(wgi.supportedScenarioIds, THEMATIC_WGI_SCENARIO_IDS);
  assert.equal(wgi.disabledReason, "");
  assert.match(wgi.summary, /WGI governance · Scenario reference/);
  assert.doesNotMatch(wgi.summary, /Runtime rendering disabled/);
  assert.equal(preview.supportsMainMapRender, true);
  assert.ok(preview.summary.includes(THEMATIC_MAIN_MAP_SUPPORT_LABEL));
  assert.doesNotMatch(preview.summary, /Runtime rendering disabled/);
  const hdi = preview.layers.find((layer) => layer.layerId === THEMATIC_HDI_LAYER_ID);
  assert.equal(hdi.title, THEMATIC_HDI_MAIN_MAP_SUPPORT_LABEL);
  assert.equal(hdi.sourcePolicy, THEMATIC_SOURCE_POLICY_REAL_SOURCE_CACHE_ONLY);
  assert.equal(hdi.realSourceStatus, THEMATIC_REAL_SOURCE_DERIVED_METADATA_REASON);
  assert.equal(hdi.supportsMainMapRender, true);
  assert.deepEqual(hdi.runtimeMetricIds, THEMATIC_HDI_METRICS.map((metric) => metric.id));
  assert.deepEqual(hdi.supportedScenarioIds, THEMATIC_WGI_SCENARIO_IDS);
  assert.equal(hdi.disabledReason, "");
  assert.ok(hdi.summary.includes(THEMATIC_HDI_MAIN_MAP_SUPPORT_LABEL));
  const population = preview.layers.find((layer) => layer.layerId === THEMATIC_POPULATION_LAYER_ID);
  assert.equal(population.title, THEMATIC_POPULATION_MAIN_MAP_SUPPORT_LABEL);
  assert.equal(population.sourcePolicy, THEMATIC_SOURCE_POLICY_REAL_SOURCE_CACHE_ONLY);
  assert.equal(population.realSourceStatus, THEMATIC_REAL_SOURCE_DERIVED_METADATA_REASON);
  assert.equal(population.supportsMainMapRender, true);
  assert.deepEqual(population.runtimeMetricIds, THEMATIC_POPULATION_METRICS.map((metric) => metric.id));
  assert.deepEqual(population.supportedScenarioIds, THEMATIC_WGI_SCENARIO_IDS);
  assert.equal(population.disabledReason, "");
  assert.ok(population.summary.includes(THEMATIC_POPULATION_MAIN_MAP_SUPPORT_LABEL));
  assert.doesNotMatch(population.summary, /Runtime rendering disabled/);
  preview.layers.filter((layer) => !REAL_LAYER_IDS.includes(layer.layerId)).forEach((layer) => {
    assert.equal(layer.supportsMainMapRender, false);
    assert.deepEqual(layer.runtimeMetricIds, []);
    assert.equal(layer.disabledReason, THEMATIC_LAYER_RENDER_DISABLED_REASON);
  });
});

test("catalog loader uses data service asset keys for index and manifests", async () => {
  const payloadsByKey = {
    thematic_layer_catalog: thematicIndex,
    "thematic_layer:political_state_capacity_demo": politicalManifest,
    "thematic_layer:social_human_development_demo": socialManifest,
    "thematic_layer:population_density_demo": populationManifest,
    "thematic_layer:political_wgi_state_capacity_v1": wgiManifest,
    "thematic_layer:social_human_development_v1": hdiManifest,
    "thematic_layer:population_wdi_population_v1": wdiPopulationManifest,
  };
  const requestedKeys = [];

  const preview = await loadThematicLayerCatalogPreview({
    loadAsset: async (key) => {
      requestedKeys.push(key);
      return payloadsByKey[key];
    },
  });

  assert.deepEqual(requestedKeys, [
    "thematic_layer_catalog",
    "thematic_layer:political_state_capacity_demo",
    "thematic_layer:social_human_development_demo",
    "thematic_layer:population_density_demo",
    "thematic_layer:political_wgi_state_capacity_v1",
    "thematic_layer:social_human_development_v1",
    "thematic_layer:population_wdi_population_v1",
  ]);
  assert.equal(preview.layerCount, thematicIndex.layers.length);
  assert.equal(preview.loadedManifestCount, thematicIndex.layers.length);
  assert.deepEqual(preview.layers.filter((layer) => layer.supportsMainMapRender).map((layer) => layer.layerId), REAL_LAYER_IDS);
});

test("missing or unaccepted WGI manifest cannot claim main-map support", () => {
  const mutations = [
    (manifest) => { manifest.schema_version = 2; },
    (manifest) => { manifest.layer_id = "fixture"; },
    (manifest) => { manifest.source_policy = "fixture_only"; },
    (manifest) => { manifest.status = "fixture"; },
    (manifest) => { delete manifest.metric_ids; },
    (manifest) => { manifest.metric_ids = THEMATIC_WGI_METRIC_ID; },
    (manifest) => { manifest.runtime_consumer.status = "catalog_only"; },
    (manifest) => { manifest.runtime_consumer.supports_main_map_render = false; },
    (manifest) => { manifest.runtime_consumer.data_version = "unaccepted"; },
    (manifest) => { manifest.runtime_consumer.supported_metrics = ["wgi_state_capacity_composite_0_100"]; },
    (manifest) => { manifest.runtime_consumer.supported_metrics.push("wgi_state_capacity_composite_0_100"); },
    (manifest) => { manifest.runtime_consumer.supported_metrics = []; },
    (manifest) => { manifest.runtime_consumer.supported_metrics.push("unsupported"); },
    (manifest) => { manifest.runtime_consumer.supported_metrics = [THEMATIC_HDI_METRIC_ID]; },
    (manifest) => { manifest.runtime_consumer.supported_metrics.push(THEMATIC_WGI_METRIC_ID); },
    (manifest) => { manifest.metric_ids = [THEMATIC_WGI_METRIC_ID]; },
    (manifest) => { manifest.runtime_consumer.supported_scenarios = ["tno_1962"]; },
    (manifest) => { manifest.runtime_consumer.supported_scenarios = []; },
    (manifest) => { delete manifest.runtime_consumer.supported_scenarios; },
    (manifest) => { manifest.runtime_consumer.supported_scenarios = "modern_world"; },
    (manifest) => { manifest.runtime_consumer.supported_scenarios.push("tno_1962"); },
    (manifest) => { manifest.runtime_consumer.supported_scenarios.push("blank_base"); },
    (manifest) => { manifest.runtime_consumer.supported_scenarios.push("hgo"); },
  ];
  const candidates = [null, ...mutations.map((mutate) => {
    const manifest = structuredClone(wgiManifest);
    mutate(manifest);
    return manifest;
  })];
  for (const manifest of candidates) {
    const preview = normalizeThematicLayerCatalogPayload(thematicIndex, {
      manifestByLayerId: { [THEMATIC_WGI_LAYER_ID]: manifest },
    });
    const wgi = preview.layers.find((layer) => layer.layerId === THEMATIC_WGI_LAYER_ID);
    assert.equal(wgi.supportsMainMapRender, false);
    assert.deepEqual(wgi.runtimeMetricIds, []);
    assert.deepEqual(wgi.supportedScenarioIds, []);
    assert.equal(wgi.disabledReason, THEMATIC_LAYER_RENDER_DISABLED_REASON);
    assert.equal(preview.supportsMainMapRender, false);
    assert.match(preview.summary, /Runtime rendering disabled/);
  }
});

test("WGI main-map admission accepts each official nonempty metric subset", () => {
  const officialMetricIds = THEMATIC_WGI_METRICS.map((metric) => metric.id);
  for (const metricIds of [[officialMetricIds[0]], [officialMetricIds[1]], officialMetricIds, [...officialMetricIds].reverse()]) {
    const manifest = structuredClone(wgiManifest);
    manifest.runtime_consumer.supported_metrics = metricIds;
    manifest.metric_ids = [...metricIds];
    const preview = normalizeThematicLayerCatalogPayload(thematicIndex, {
      manifestByLayerId: { [THEMATIC_WGI_LAYER_ID]: manifest },
    });
    const wgi = preview.layers.find((layer) => layer.layerId === THEMATIC_WGI_LAYER_ID);
    assert.equal(wgi.supportsMainMapRender, true);
    assert.deepEqual(wgi.runtimeMetricIds, metricIds);
    assert.equal(Object.isFrozen(wgi.runtimeMetricIds), true);
  }
});

test("WGI scenario admission preserves modern-only manifests and supported subsets", () => {
  for (const scenarioIds of [["modern_world"], ["modern_world", "hoi4_1936"],
    [...THEMATIC_WGI_SCENARIO_IDS], [...THEMATIC_WGI_SCENARIO_IDS].reverse()]) {
    const manifest = structuredClone(wgiManifest);
    manifest.runtime_consumer.supported_scenarios = scenarioIds;
    const preview = normalizeThematicLayerCatalogPayload(thematicIndex, {
      manifestByLayerId: { [THEMATIC_WGI_LAYER_ID]: manifest },
    });
    const wgi = preview.layers.find((layer) => layer.layerId === THEMATIC_WGI_LAYER_ID);
    assert.equal(wgi.supportsMainMapRender, true);
    assert.deepEqual(wgi.supportedScenarioIds, scenarioIds);
    assert.equal(Object.isFrozen(wgi.supportedScenarioIds), true);
    const snapshot = [...scenarioIds];
    manifest.runtime_consumer.supported_scenarios.push("blank_base");
    assert.deepEqual(wgi.supportedScenarioIds, snapshot);
  }
});

test("fixture index rows cannot acquire WGI main-map support from a ready manifest", () => {
  const catalog = structuredClone(thematicIndex);
  catalog.layers.find((layer) => layer.layer_id === THEMATIC_WGI_LAYER_ID).status = "fixture";
  const preview = normalizeThematicLayerCatalogPayload(catalog, {
    manifestByLayerId: { [THEMATIC_WGI_LAYER_ID]: wgiManifest },
  });
  const wgi = preview.layers.find((layer) => layer.layerId === THEMATIC_WGI_LAYER_ID);
  assert.equal(wgi.fixtureOnly, true);
  assert.equal(wgi.supportsMainMapRender, false);
  assert.deepEqual(wgi.runtimeMetricIds, []);
});

test("missing, stale, cross-family and fixture HDI manifests cannot claim main-map support", () => {
  const mutations = [
    (manifest) => { manifest.schema_version = 2; },
    (manifest) => { manifest.layer_id = THEMATIC_WGI_LAYER_ID; },
    (manifest) => { manifest.source_policy = "fixture_only"; },
    (manifest) => { manifest.status = "fixture"; },
    (manifest) => { manifest.provenance = []; },
    (manifest) => { manifest.provenance[0].source_id = "world_bank_wgi_2025_revision"; },
    (manifest) => { manifest.provenance[0].version = "2024"; },
    (manifest) => { manifest.provenance[0].release = "Human Development Report 2024"; },
    (manifest) => { manifest.provenance[0].selected_year = 2022; },
    (manifest) => { manifest.period.year = 2022; },
    (manifest) => { delete manifest.metric_ids; },
    (manifest) => { manifest.metric_ids = THEMATIC_HDI_METRIC_ID; },
    (manifest) => { manifest.runtime_consumer.status = "catalog_only"; },
    (manifest) => { manifest.runtime_consumer.supports_main_map_render = false; },
    (manifest) => { manifest.runtime_consumer.data_version = "undp-hdr-2024:2022"; },
    (manifest) => { manifest.runtime_consumer.supported_metrics = [THEMATIC_WGI_METRIC_ID]; },
    (manifest) => { manifest.runtime_consumer.supported_metrics.push(THEMATIC_WGI_METRIC_ID); },
    (manifest) => { manifest.runtime_consumer.supported_metrics = []; },
    (manifest) => { manifest.runtime_consumer.supported_metrics.push("unknown"); },
    (manifest) => { manifest.runtime_consumer.supported_metrics.push(THEMATIC_HDI_METRIC_ID); },
    (manifest) => { manifest.metric_ids = [THEMATIC_HDI_METRIC_ID]; },
    (manifest) => { manifest.runtime_consumer.supported_scenarios = ["tno_1962"]; },
    (manifest) => { manifest.runtime_consumer.supported_scenarios = []; },
    (manifest) => { delete manifest.runtime_consumer.supported_scenarios; },
    (manifest) => { manifest.runtime_consumer.supported_scenarios = "modern_world"; },
    (manifest) => { manifest.runtime_consumer.supported_scenarios.push("tno_1962"); },
    (manifest) => { manifest.runtime_consumer.supported_scenarios.push("blank_base"); },
    (manifest) => { manifest.runtime_consumer.supported_scenarios.push("unknown"); },
  ];
  const candidates = [null, ...mutations.map((mutate) => {
    const manifest = structuredClone(hdiManifest);
    mutate(manifest);
    return manifest;
  })];
  for (const manifest of candidates) {
    const preview = normalizeThematicLayerCatalogPayload(thematicIndex, {
      manifestByLayerId: { [THEMATIC_HDI_LAYER_ID]: manifest },
    });
    const hdi = preview.layers.find((layer) => layer.layerId === THEMATIC_HDI_LAYER_ID);
    assert.equal(hdi.supportsMainMapRender, false);
    assert.deepEqual(hdi.runtimeMetricIds, []);
    assert.deepEqual(hdi.supportedScenarioIds, []);
    assert.equal(hdi.disabledReason, THEMATIC_LAYER_RENDER_DISABLED_REASON);
    assert.equal(preview.supportsMainMapRender, false);
    assert.match(preview.summary, /Runtime rendering disabled/);
  }
});

test("HDI admission accepts each official metric and supported scenario subset as immutable snapshots", () => {
  const officialIds = THEMATIC_HDI_METRICS.map((metric) => metric.id);
  const metricSubsets = [...officialIds.map((id) => [id]), officialIds, [...officialIds].reverse()];
  for (const metricIds of metricSubsets) {
    for (const scenarioIds of [["modern_world"], ["modern_world", "hoi4_1936"], [...THEMATIC_WGI_SCENARIO_IDS]]) {
      const manifest = structuredClone(hdiManifest);
      manifest.runtime_consumer.supported_metrics = [...metricIds];
      manifest.metric_ids = [...metricIds];
      manifest.runtime_consumer.supported_scenarios = [...scenarioIds];
      const preview = normalizeThematicLayerCatalogPayload(thematicIndex, {
        manifestByLayerId: { [THEMATIC_HDI_LAYER_ID]: manifest },
      });
      const hdi = preview.layers.find((layer) => layer.layerId === THEMATIC_HDI_LAYER_ID);
      assert.equal(hdi.supportsMainMapRender, true);
      assert.deepEqual(hdi.runtimeMetricIds, metricIds);
      assert.deepEqual(hdi.supportedScenarioIds, scenarioIds);
      assert.ok(Object.isFrozen(hdi.runtimeMetricIds));
      assert.ok(Object.isFrozen(hdi.supportedScenarioIds));
      manifest.runtime_consumer.supported_metrics.push("unknown");
      manifest.runtime_consumer.supported_scenarios.push("blank_base");
      assert.deepEqual(hdi.runtimeMetricIds, metricIds);
      assert.deepEqual(hdi.supportedScenarioIds, scenarioIds);
    }
  }
});

test("HDI fixture index rows and foreign ready manifests cannot gain real-source admission", () => {
  const catalog = structuredClone(thematicIndex);
  catalog.layers.find((layer) => layer.layer_id === THEMATIC_HDI_LAYER_ID).status = "fixture";
  const preview = normalizeThematicLayerCatalogPayload(catalog, {
    manifestByLayerId: { [THEMATIC_HDI_LAYER_ID]: hdiManifest },
  });
  const hdi = preview.layers.find((layer) => layer.layerId === THEMATIC_HDI_LAYER_ID);
  assert.equal(hdi.fixtureOnly, true);
  assert.equal(hdi.supportsMainMapRender, false);
  assert.deepEqual(hdi.runtimeMetricIds, []);
  const foreign = normalizeThematicLayerCatalogPayload(thematicIndex, {
    manifestByLayerId: { [THEMATIC_HDI_LAYER_ID]: wgiManifest, [THEMATIC_WGI_LAYER_ID]: hdiManifest },
  });
  assert.equal(foreign.supportsMainMapRender, false);
});

test("missing, stale, cross-family and fixture population manifests cannot claim main-map support", () => {
  const source = (manifest) => manifest.provenance.find((entry) => entry.source_id === "world_bank_wdi_population");
  const mutations = [
    (manifest) => { manifest.schema_version = 2; },
    (manifest) => { manifest.layer_id = THEMATIC_HDI_LAYER_ID; },
    (manifest) => { manifest.source_policy = "fixture_only"; },
    (manifest) => { manifest.status = "fixture"; },
    (manifest) => { manifest.provenance = []; },
    (manifest) => { manifest.provenance = {}; },
    (manifest) => { manifest.provenance.forEach((entry) => { entry.source_id = "undp_hdr_2025"; }); },
    (manifest) => { manifest.provenance.forEach((entry) => { entry.source_id = "world_bank_wgi_2025_revision"; }); },
    (manifest) => { source(manifest).version = "2025"; },
    (manifest) => { source(manifest).release = "Human Development Report 2025"; },
    (manifest) => { source(manifest).selected_year = 2022; },
    (manifest) => { manifest.period.year = 2022; },
    (manifest) => { delete manifest.metric_ids; },
    (manifest) => { manifest.metric_ids = THEMATIC_POPULATION_METRIC_ID; },
    (manifest) => { manifest.runtime_consumer.status = "catalog_only"; },
    (manifest) => { manifest.runtime_consumer.supports_main_map_render = false; },
    (manifest) => { manifest.runtime_consumer.data_version = "wdi-2026-07-13:2022"; },
    (manifest) => { manifest.runtime_consumer.supported_metrics = [THEMATIC_HDI_METRIC_ID]; },
    (manifest) => { manifest.runtime_consumer.supported_metrics.push(THEMATIC_WGI_METRIC_ID); },
    (manifest) => { manifest.runtime_consumer.supported_metrics = []; },
    (manifest) => { manifest.runtime_consumer.supported_metrics.push("unknown"); },
    (manifest) => { manifest.runtime_consumer.supported_metrics.push(THEMATIC_POPULATION_METRIC_ID); },
    (manifest) => { manifest.metric_ids = [THEMATIC_POPULATION_METRIC_ID]; },
    (manifest) => { manifest.runtime_consumer.supported_scenarios = ["tno_1962"]; },
    (manifest) => { manifest.runtime_consumer.supported_scenarios = []; },
    (manifest) => { delete manifest.runtime_consumer.supported_scenarios; },
    (manifest) => { manifest.runtime_consumer.supported_scenarios = "modern_world"; },
    (manifest) => { manifest.runtime_consumer.supported_scenarios.push("modern_world"); },
    (manifest) => { manifest.runtime_consumer.supported_scenarios.push("blank_base"); },
    (manifest) => { manifest.runtime_consumer.supported_scenarios.push("unknown"); },
  ];
  const candidates = [null, wgiManifest, hdiManifest, ...mutations.map((mutate) => {
    const manifest = structuredClone(wdiPopulationManifest);
    mutate(manifest);
    return manifest;
  })];
  for (const manifest of candidates) {
    const preview = normalizeThematicLayerCatalogPayload(thematicIndex, {
      manifestByLayerId: { [THEMATIC_POPULATION_LAYER_ID]: manifest },
    });
    const population = preview.layers.find((layer) => layer.layerId === THEMATIC_POPULATION_LAYER_ID);
    assert.equal(population.supportsMainMapRender, false);
    assert.deepEqual(population.runtimeMetricIds, []);
    assert.deepEqual(population.supportedScenarioIds, []);
    assert.equal(population.disabledReason, THEMATIC_LAYER_RENDER_DISABLED_REASON);
    assert.equal(preview.supportsMainMapRender, false);
    assert.match(preview.summary, /Runtime rendering disabled/);
  }
});

test("population admission accepts official metric and supported scenario subsets as immutable snapshots", () => {
  const officialIds = THEMATIC_POPULATION_METRICS.map((metric) => metric.id);
  const metricSubsets = [...officialIds.map((id) => [id]), officialIds, [...officialIds].reverse()];
  for (const metricIds of metricSubsets) {
    for (const scenarioIds of [["modern_world"], ["modern_world", "hoi4_1936"],
      [...THEMATIC_WGI_SCENARIO_IDS], [...THEMATIC_WGI_SCENARIO_IDS].reverse()]) {
      const manifest = structuredClone(wdiPopulationManifest);
      manifest.runtime_consumer.supported_metrics = [...metricIds];
      manifest.metric_ids = [...metricIds];
      manifest.runtime_consumer.supported_scenarios = [...scenarioIds];
      const preview = normalizeThematicLayerCatalogPayload(thematicIndex, {
        manifestByLayerId: { [THEMATIC_POPULATION_LAYER_ID]: manifest },
      });
      const population = preview.layers.find((layer) => layer.layerId === THEMATIC_POPULATION_LAYER_ID);
      assert.equal(population.supportsMainMapRender, true);
      assert.deepEqual(population.runtimeMetricIds, metricIds);
      assert.deepEqual(population.supportedScenarioIds, scenarioIds);
      assert.ok(Object.isFrozen(population.runtimeMetricIds));
      assert.ok(Object.isFrozen(population.supportedScenarioIds));
      manifest.runtime_consumer.supported_metrics.push("unknown");
      manifest.runtime_consumer.supported_scenarios.push("blank_base");
      assert.deepEqual(population.runtimeMetricIds, metricIds);
      assert.deepEqual(population.supportedScenarioIds, scenarioIds);
    }
  }
});

test("population fixture rows and foreign layer identities cannot gain real-source admission", () => {
  for (const mutation of [
    (layer) => { layer.status = "fixture"; },
    (layer) => { layer.source_policy = "fixture_only"; },
    (layer) => { layer.layer_id = "population_unaccepted"; },
  ]) {
    const catalog = structuredClone(thematicIndex);
    const row = catalog.layers.find((layer) => layer.layer_id === THEMATIC_POPULATION_LAYER_ID);
    mutation(row);
    const preview = normalizeThematicLayerCatalogPayload(catalog, {
      manifestByLayerId: { [row.layer_id]: wdiPopulationManifest },
    });
    const population = preview.layers.find((layer) => layer.layerId === row.layer_id);
    assert.equal(population.supportsMainMapRender, false);
    assert.deepEqual(population.runtimeMetricIds, []);
    assert.equal(population.disabledReason, THEMATIC_LAYER_RENDER_DISABLED_REASON);
    assert.equal(preview.supportsMainMapRender, false);
  }
});
