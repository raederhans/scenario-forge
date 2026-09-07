import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();

function readRepoFile(...relativeParts) {
  return fs.readFileSync(path.join(REPO_ROOT, ...relativeParts), "utf8");
}

function readJsonRepoFile(...relativeParts) {
  return JSON.parse(readRepoFile(...relativeParts));
}

test("river layer contracts keep zoom gating, render metrics, and targeted regression coverage", () => {
  const rendererSource = readRepoFile("js", "core", "map_renderer.js");
  const riverOwnerSource = readRepoFile("js", "core", "renderer", "river_layer_render_owner.js");
  const contextPassOwnerSource = readRepoFile("js", "core", "renderer", "context_pass_orchestrator_owner.js");
  const riverSpecSource = readRepoFile("tests", "e2e", "river_layer_regression.spec.js");

  const drawRiversLayerStart = rendererSource.indexOf("function drawRiversLayer");
  const drawRiversLayerEnd = rendererSource.indexOf("const { getCityFeatureKey", drawRiversLayerStart);
  const drawRiversLayerSource =
    drawRiversLayerStart >= 0 && drawRiversLayerEnd > drawRiversLayerStart
      ? rendererSource.slice(drawRiversLayerStart, drawRiversLayerEnd)
      : "";

  const ownerDrawStart = riverOwnerSource.indexOf("function drawRiversLayer");
  const ownerDrawEnd = riverOwnerSource.indexOf("return {", ownerDrawStart);
  const ownerDrawSource =
    ownerDrawStart >= 0 && ownerDrawEnd > ownerDrawStart
      ? riverOwnerSource.slice(ownerDrawStart, ownerDrawEnd)
      : "";

  const contextBaseStart = contextPassOwnerSource.indexOf("function drawContextBasePass");
  const contextBaseEnd = contextPassOwnerSource.indexOf("function drawContextMarkersPass", contextBaseStart);
  const contextBaseSource =
    contextBaseStart >= 0 && contextBaseEnd > contextBaseStart
      ? contextPassOwnerSource.slice(contextBaseStart, contextBaseEnd)
      : "";

  const checks = {
    hasDrawRiversLayerPass: drawRiversLayerSource.includes("function drawRiversLayer(k, { interactive = false } = {})"),
    mapRendererKeepsThinRiverWrapper:
      drawRiversLayerSource.includes("return getRiverLayerRenderOwner().drawRiversLayer(k, { interactive });")
      && !/coreWidthFactor|outlineWidthFactor|outlineAlphaFactor/.test(drawRiversLayerSource),
    ownerRecordsRiverMetric:
      ownerDrawSource.includes('collectContextMetric("drawRiversLayer"'),
    ownerComputesZoomBucket:
      /zoomBucket/.test(riverOwnerSource)
      && /coreWidthFactor/.test(riverOwnerSource)
      && /outlineWidthFactor/.test(riverOwnerSource)
      && /outlineAlphaFactor/.test(riverOwnerSource),
    ownerOwnsClassProfileAndCanvasDraw:
      riverOwnerSource.includes("RIVER_CLASS_STYLE_FACTORS")
      && riverOwnerSource.includes("function getRiverVisibilityProfile")
      && ownerDrawSource.includes("pathCanvas(feature)")
      && ownerDrawSource.includes("context.stroke()"),
    contextBaseInvokesRiverPass:
      contextBaseSource.includes("drawRiversLayer(k, { interactive });"),
    deferredContextStillRecordsRiverMetric:
      /recordDeferredRiversLayerMetric\(\{ interactive: false, reason: "staged-apply" \}\)/.test(contextBaseSource),
    hasTargetedRiverRegressionSpec:
      riverSpecSource.includes("river layer major zoom gating regression")
      && riverSpecSource.includes("river layer mid-tier zoom gating regression")
      && riverSpecSource.includes("river layer lake zoom gating regression")
      && riverSpecSource.includes("river layer intermittent zoom gating regression")
      && riverSpecSource.includes("river layer canal zoom gating regression")
      && riverSpecSource.includes("readRiverRenderMetric")
      && riverSpecSource.includes("drawRiversLayer")
      && riverSpecSource.includes("zoomBucket")
      && riverSpecSource.includes("coreWidthFactor")
      && riverSpecSource.includes("outlineWidthFactor"),
    regressionSpecKeepsRepresentativeSubsets:
      riverSpecSource.includes("river-major")
      && riverSpecSource.includes("river-mid-tier")
      && riverSpecSource.includes("lake-centerline")
      && riverSpecSource.includes("river-intermittent")
      && riverSpecSource.includes("canal"),
  };

  Object.entries(checks).forEach(([label, ok]) => {
    assert.equal(ok, true, label);
  });
});

test("river layer subset regressions keep isolated three-measure test budgets", () => {
  const riverSpecSource = readRepoFile("tests", "e2e", "river_layer_regression.spec.js");
  const measureHelperStart = riverSpecSource.indexOf("async function measureRiverInk");
  const beginRegressionStart = riverSpecSource.indexOf("async function beginRiverRegression");
  const majorStart = riverSpecSource.indexOf("test('river layer major zoom gating regression'");
  const midTierStart = riverSpecSource.indexOf("test('river layer mid-tier zoom gating regression'");
  const lakeStart = riverSpecSource.indexOf("test('river layer lake zoom gating regression'");
  const intermittentStart = riverSpecSource.indexOf("test('river layer intermittent zoom gating regression'");
  const canalStart = riverSpecSource.indexOf("test('river layer canal zoom gating regression'");

  assert.ok(majorStart >= 0 && majorStart < midTierStart);
  assert.ok(measureHelperStart >= 0 && measureHelperStart < beginRegressionStart);
  assert.ok(midTierStart < lakeStart);
  assert.ok(lakeStart < intermittentStart);
  assert.ok(intermittentStart < canalStart);

  const measureHelperSource = riverSpecSource.slice(measureHelperStart, beginRegressionStart);
  const majorTestSource = riverSpecSource.slice(majorStart, midTierStart);
  const midTierTestSource = riverSpecSource.slice(midTierStart, lakeStart);
  const lakeTestSource = riverSpecSource.slice(lakeStart, intermittentStart);
  const intermittentTestSource = riverSpecSource.slice(intermittentStart, canalStart);
  const canalTestSource = riverSpecSource.slice(canalStart);
  const measureCount = (source) => source.match(/measureRiverInk\(page, \{/g)?.length ?? 0;
  const subsetCount = (source, subsetName) =>
    source.match(new RegExp(`subsetName: '${subsetName}'`, "g"))?.length ?? 0;
  const measureCalls = Array.from(
    riverSpecSource.matchAll(/const (\w+) = await measureRiverInk\(page, \{([\s\S]*?)\n\s{2}\}\);/g),
    ([, name, optionsSource]) => ({ name, optionsSource }),
  );
  const overriddenMeasureCalls = measureCalls.filter(({ optionsSource }) =>
    optionsSource.includes("zoomRenderIdleTimeout:"));

  assert.match(
    riverSpecSource,
    /async function setZoomPercent\(page, percent, \{ renderIdleTimeout = 30_000 \} = \{\}\)[\s\S]*?timeout: renderIdleTimeout/,
  );
  assert.match(measureHelperSource, /zoomRenderIdleTimeout = 30_000/);
  assert.match(
    measureHelperSource,
    /setZoomPercent\(page, zoomPercent, \{ renderIdleTimeout: zoomRenderIdleTimeout \}\)/,
  );
  assert.equal(
    measureHelperSource.match(/waitForRenderIdle\(page, \{ scenarioId: SCENARIO_ID, timeout: 30_000 \}\)/g)?.length ?? 0,
    2,
  );
  assert.match(
    majorTestSource,
    /const riverMajorHigh = await measureRiverInk\(page, \{[\s\S]*?zoomRenderIdleTimeout: 45_000,[\s\S]*?\n\s{2}\}\);/,
  );
  assert.equal(measureCalls.length, 15);
  assert.deepEqual(overriddenMeasureCalls.map(({ name }) => name), ["riverMajorHigh"]);
  assert.equal(overriddenMeasureCalls[0]?.optionsSource.match(/zoomRenderIdleTimeout:/g)?.length, 1);
  assert.match(overriddenMeasureCalls[0]?.optionsSource ?? "", /zoomRenderIdleTimeout: 45_000/);

  assert.equal(measureCount(majorTestSource), 3);
  assert.equal(measureCount(midTierTestSource), 3);
  assert.equal(measureCount(lakeTestSource), 3);
  assert.equal(measureCount(intermittentTestSource), 3);
  assert.equal(measureCount(canalTestSource), 3);
  assert.equal(subsetCount(majorTestSource, "river-major"), 3);
  assert.equal(subsetCount(midTierTestSource, "river-mid-tier"), 3);
  assert.equal(subsetCount(lakeTestSource, "lake-centerline"), 3);
  assert.equal(subsetCount(intermittentTestSource, "river-intermittent"), 3);
  assert.equal(subsetCount(canalTestSource, "canal"), 3);
  assert.equal(majorTestSource.includes("subsetName: 'river-mid-tier'"), false);
  assert.equal(midTierTestSource.includes("subsetName: 'river-major'"), false);
  assert.equal(majorTestSource.match(/restoreRiverRegressionState\(page\)/g)?.length ?? 0, 1);
  assert.equal(majorTestSource.match(/expectNoRiverRuntimeIssues\(trackers\)/g)?.length ?? 0, 1);
  assert.equal(midTierTestSource.match(/restoreRiverRegressionState\(page\)/g)?.length ?? 0, 1);
  assert.equal(midTierTestSource.match(/expectNoRiverRuntimeIssues\(trackers\)/g)?.length ?? 0, 1);
  assert.equal(lakeTestSource.includes("subsetName: 'canal'"), false);
  assert.equal(intermittentTestSource.includes("subsetName: 'canal'"), false);
});

test("river layer data remains wired from runtime registry to deferred context loader", () => {
  const registry = readJsonRepoFile("data", "runtime_asset_registry.json");
  const manifest = readJsonRepoFile("data", "manifest.json");
  const dataLoaderSource = readRepoFile("js", "core", "data_loader.js");
  const startupDataPipelineSource = readRepoFile("js", "bootstrap", "startup_data_pipeline.js");
  const startupBundleSource = readRepoFile("tools", "build_startup_bundle.py");
  const pagesDistSource = readRepoFile("tools", "build_pages_dist.py");

  assert.equal(registry.assets?.["context_layer:rivers"]?.url, "data/global_rivers.geojson");
  assert.equal(manifest.runtime_asset_registry?.assets?.["context_layer:rivers"]?.url, "data/global_rivers.geojson");
  assert.ok(pagesDistSource.includes('"global_rivers.geojson"'));
  assert.ok(startupBundleSource.includes('"rivers",'));
  assert.ok(startupBundleSource.includes('"featurecla"'));
  assert.ok(startupBundleSource.includes('"scalerank"'));

  assert.ok(dataLoaderSource.includes('const GLOBAL_RIVERS_CONTEXT_PACK_URL = resolveDataAssetUrl("context_layer:rivers");'));
  assert.ok(/function normalizeRequestedContextLayerNames\(includeContextLayers\)[\s\S]*return \["rivers", \.\.\.Object\.keys\(CONTEXT_LAYER_PACKS\)\];/.test(dataLoaderSource));
  assert.ok(/if \(layerName === "rivers"\) \{[\s\S]*?return loadRiversFallbackCollection\(d3Client\);[\s\S]*?\}/.test(dataLoaderSource));
  assert.ok(/const CONTEXT_LAYER_LOAD_ORDER = \[[\s\S]*?"rivers",/.test(startupDataPipelineSource));
});
