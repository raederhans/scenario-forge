import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();

function readRepoFile(...relativeParts) {
  return fs.readFileSync(path.join(REPO_ROOT, ...relativeParts), "utf8");
}

test("exact-after-settle keeps scenario overlays on the contextScenario reuse path", () => {
  const rendererSource = readRepoFile("js", "core", "map_renderer.js");

  const contract = {
    drawContextScenarioPassKeepsScenarioOverlayBoundary:
      /function drawContextScenarioPass\(k, \{ interactive = false \} = \{\}\) \{[\s\S]*?drawScenarioRegionOverlaysPass\(k\);[\s\S]*?drawScenarioReliefOverlaysLayer\(k\);[\s\S]*?recordRenderPerfMetric\("drawContextScenarioPass"/.test(rendererSource),
    signatureOnlyContextScenarioInvalidationUsesTransformReuse:
      /passName === "contextScenario"[\s\S]*?shouldEnableContextScenarioTransformReuse\(\)[\s\S]*?cache\.dirty\[passName\] = false;[\s\S]*?recordRenderPerfMetric\("contextScenarioReuseSkipped", 0, \{/.test(rendererSource),
    contextScenarioKeepsLayerMetrics:
      rendererSource.includes('"contextScenarioLayerWater"')
      && rendererSource.includes('"contextScenarioLayerSpecial"')
      && rendererSource.includes('"contextScenarioLayerRelief"')
      && rendererSource.includes('recordRenderPerfMetric("contextScenarioSignatureChanged"'),
    exactAfterSettleRefreshLeavesContextScenarioOutsidePhysicalRefreshPasses:
      /function getPhysicalExactRefreshPasses\(\) \{[\s\S]*?\["physicalBase", "political", "contextBase", "borders"\][\s\S]*?\["political", "contextBase", "borders"\][\s\S]*?return passes;[\s\S]*?\}/.test(rendererSource)
      && /scheduleExactAfterSettleRefresh[\s\S]*?invalidateRenderPasses\(\["physicalBase", "contextBase"\], "physical-visible-exact"\);[\s\S]*?invalidateRenderPasses\(getPhysicalExactRefreshPasses\(\), reuseDecision\.reason \|\| "context-base-exact"\);/.test(rendererSource),
  };

  Object.entries(contract).forEach(([label, ok]) => {
    assert.equal(ok, true, label);
  });
});

test("perf contracts keep coarse first frame and benchmark app-path fallback boundaries", () => {
  const rendererSource = readRepoFile("js", "core", "map_renderer.js");
  const scenarioManagerSource = readRepoFile("js", "core", "scenario_manager.js");
  const scenarioApplyPipelineSource = readRepoFile("js", "core", "scenario_apply_pipeline.js");
  const benchmarkSource = readRepoFile("ops", "browser-mcp", "editor-performance-benchmark.py");
  const playwrightAppPathsSource = readRepoFile("tests", "e2e", "support", "playwright-app-paths.js");

  const checks = {
    politicalPassStartsWithBackgroundFills:
      /function drawPoliticalPass\(k\) \{[\s\S]*?const visibleItems = debugMode === "PROD" \? collectVisibleLandSpatialItems\(\) : null;[\s\S]*?drawPoliticalBackgroundFills\(\{[\s\S]*?returnSummary: true,[\s\S]*?\}\);[\s\S]*?if \(!(?:runtimeState|state)\.landData\?\.features\?\.length\) return;/.test(rendererSource),
    backgroundFillHelperKeepsScenarioMergeSplit:
      /function drawPoliticalBackgroundFills\(options = \{\}\) \{[\s\S]*?if \(shouldUseScenarioPoliticalBackgroundMerge\(\)\) \{[\s\S]*?return drawScenarioPoliticalBackgroundFills\(options\);[\s\S]*?\}[\s\S]*?drawAdmin0BackgroundFills\(options\);/.test(rendererSource),
    backgroundFullPassCacheBuildsAndReplays:
      /function getScenarioPoliticalBackgroundFullPassGroups\([\s\S]*?recordRenderPerfMetric\("scenarioPoliticalBackgroundCacheReplay"[\s\S]*?recordRenderPerfMetric\("scenarioPoliticalBackgroundCacheBuild"/.test(rendererSource),
    chunkedRuntimeSkipsBlockingDetailPromotion:
      /const supportsChunkedPoliticalRuntime = scenarioSupportsChunkedRuntime\(bundle\)[\s\S]*?const detailPromoted = \(startupReadonly \|\| supportsChunkedPoliticalRuntime\)\s*\?\s*false\s*:\s*await ensureScenarioDetailTopologyLoaded\(\{ applyMapData: false \}\);/.test(scenarioApplyPipelineSource),
    unconfirmedDetailPromotionStillWarnsBeforeHealthGate:
      /if \(!detailReady && (?:runtimeState|state)\.topologyBundleMode !== "composite"\) \{[\s\S]*?console\.warn\("\[scenario\] Applying bundle without confirmed detail promotion; health gate will validate runtime topology\."\);/.test(scenarioApplyPipelineSource),
    coarseInteractiveMetricRecordedAfterPostApplyEffects:
      /const \{ dataHealth, scenarioMapRefreshMode, hasChunkedRuntime \} = await runPostScenarioApplyEffects\([\s\S]*?recordScenarioPerfMetric\(\s*"timeToInteractiveCoarseFrame",[\s\S]*?hasChunkedRuntime,[\s\S]*?mapRefreshMode: scenarioMapRefreshMode,/.test(scenarioManagerSource),
    ensureAppPathUrlRewritesRootAndNestedPaths:
      /def ensure_app_path_url\(url: str\) -> str:[\s\S]*?if path\.startswith\("\/app\/"\) or path == "\/app":[\s\S]*?elif path == "\/":[\s\S]*?normalized_path = "\/app\/"[\s\S]*?else:[\s\S]*?normalized_path = f"\/app\{path\}" if path\.startswith\("\/"\) else f"\/app\/\{path\}"/.test(benchmarkSource),
    buildScenarioOpenUrlsAddsPerfOverlayAndScenarioCandidate:
      /def build_scenario_open_urls\([\s\S]*?perf_url = with_query_overrides\(ensure_app_path_url\(base_url\), perf_overlay="1"\)[\s\S]*?if normalized_scenario_id and normalized_scenario_id != "none":[\s\S]*?scenario_perf_url = with_query_overrides\(perf_url, default_scenario=normalized_scenario_id\)[\s\S]*?urls\.append\(scenario_perf_url\)[\s\S]*?urls\.append\(perf_url\)/.test(benchmarkSource),
    openPageKeepsWrapperThenLocalFallbackAcrossCandidates:
      /def open_page\(urls: list\[str\] \| tuple\[str, \.\.\.\] \| str\) -> dict:[\s\S]*?if PWCLI\.exists\(\):[\s\S]*?for browser_name in OPEN_BROWSER_CANDIDATES:[\s\S]*?for candidate_url in candidate_urls:[\s\S]*?run_wrapper_pw\("open", candidate_url, "--browser", browser_name,[\s\S]*?for browser_name in OPEN_BROWSER_CANDIDATES:[\s\S]*?for candidate_url in candidate_urls:[\s\S]*?run_local_pw\(\s*"open",\s*candidate_url,\s*"--browser",\s*browser_name,/.test(benchmarkSource),
    suiteBaseUrlsKeepOriginalAndAppVariants:
      /suite_base_urls = unique_strings\(\[[\s\S]*?effective_url,[\s\S]*?ensure_app_path_url\(effective_url\),[\s\S]*?args\.url,[\s\S]*?ensure_app_path_url\(args\.url\),/.test(benchmarkSource),
    sameScenarioFreshMetricSelectionIsExplicit:
      /def is_same_scenario_fresh_metric_entry\([\s\S]*?def summarize_freshest_same_scenario_metric_entry\(/.test(benchmarkSource),
    e2eHarnessDefaultsToAppPath:
      playwrightAppPathsSource.includes("const DEFAULT_OPEN_PATH = DEFAULT_FAST_APP_OPEN_PATH;")
      && playwrightAppPathsSource.includes("const DEFAULT_APP_ORIGIN = `http://127.0.0.1:${DEFAULT_TEST_SERVER_PORT}`;"),
    normalizeAppPathKeepsRootQueryAndHashOnAppRoute:
      playwrightAppPathsSource.includes('if (normalizedTarget === "/") {')
      && playwrightAppPathsSource.includes('if (normalizedTarget.startsWith("/app/")) {')
      && playwrightAppPathsSource.includes('if (normalizedTarget === "/app") {')
      && playwrightAppPathsSource.includes('if (normalizedTarget.startsWith("/?") || normalizedTarget.startsWith("/#")) {')
      && playwrightAppPathsSource.includes('return `/app${normalizedTarget}`;'),
  };

  Object.entries(checks).forEach(([label, ok]) => {
    assert.equal(ok, true, label);
  });
});

test("TNO water topology contracts keep exclusive scenario water and shared surface version signal", () => {
  const rendererSource = readRepoFile("js", "core", "map_renderer.js");
  const spatialBuilderSource = readRepoFile("js", "core", "renderer", "spatial_index_runtime_builders.js");
  const spatialOwnerSource = readRepoFile("js", "core", "renderer", "spatial_index_runtime_owner.js");
  const scenarioApplyPipelineSource = readRepoFile("js", "core", "scenario_apply_pipeline.js");

  const checks = {
    tnoWaterUsesScenarioCollectionOnly:
      /function getEffectiveWaterRegionFeatures\(\) \{[\s\S]*?if \(isScenarioWaterTopologyExclusiveMode\(\)\) \{[\s\S]*?return sanitizeWaterRegionFeatures\(scenarioFeatures\.filter\(\(feature\) => !isWaterRegionExcludedByScenario\(feature\)\)\);/.test(rendererSource),
    waterSphericalDiagnosticsBacksSanitization:
      /function getSphericalGeometryDiagnostics\(geoObject\) \{[\s\S]*?globalThis\.d3\.geoArea[\s\S]*?globalThis\.d3\.geoBounds[\s\S]*?isWorldBounds\(bounds\)[\s\S]*?SPHERICAL_GEOMETRY_MAX_AREA/.test(rendererSource)
      && /function collectSafeWaterRegionGeometryPartsInfo\(feature\) \{[\s\S]*?isSphericalGeometryUnsafe\(part\)[\s\S]*?removedCount \+= 1;/.test(rendererSource)
      && /function sanitizeWaterRegionFeatures\(features = \[\]\) \{[\s\S]*?recordRenderPerfMetric\("waterSphericalSanitization"/.test(rendererSource),
    waterDrawAndHighlightUseSafeParts:
      /function drawScenarioWaterFillLayer\(k, \{ waterFeatures = \[\] \} = \{\}\) \{[\s\S]*?collectSafeWaterRegionGeometryParts\(feature\)[\s\S]*?pathCanvas\(part\)/.test(rendererSource)
      && /function drawScenarioWaterHighlightLayer\(k\) \{[\s\S]*?collectSafeWaterRegionGeometryParts\(feature\)[\s\S]*?pathCanvas\(part\)/.test(rendererSource),
    waterFillUsesProjectionPathCacheBeforeCanvasFallback:
      /let scenarioWaterPartPathCache = new WeakMap\(\);[\s\S]*?let scenarioWaterFeaturePathCache = new WeakMap\(\);/.test(rendererSource)
      && /function getScenarioWaterFeaturePath\(feature, parts\) \{[\s\S]*?scenarioWaterFeaturePathCache\.has\(feature\)[\s\S]*?combinedPath\.addPath\(partPath\)[\s\S]*?scenarioWaterFeaturePathCache\.set\(feature, path\);/.test(rendererSource)
      && /function drawScenarioWaterFillLayer\(k, \{ waterFeatures = \[\] \} = \{\}\) \{[\s\S]*?const waterPath = visibleParts\.length === parts\.length[\s\S]*?getScenarioWaterFeaturePath\(feature, parts\)[\s\S]*?context\.fill\(waterPath\);[\s\S]*?getScenarioWaterPartPath\(part\)[\s\S]*?context\.fill\(partPath\)[\s\S]*?pathCanvas\(part\);/.test(rendererSource),
    waterCoverageUsesSafeParts:
      /function getScenarioWaterVisibleCoverageRatioLegacy\(waterFeatures = \[\]\) \{[\s\S]*?collectSafeWaterRegionGeometryParts\(feature\)[\s\S]*?computeProjectedGeoBounds\(part\)/.test(rendererSource)
      && /function getScenarioWaterVisibleCoverageRatioGrid\(waterFeatures = \[\]\) \{[\s\S]*?collectSafeWaterRegionGeometryParts\(feature\)[\s\S]*?computeProjectedGeoBounds\(part\)/.test(rendererSource),
    waterSpatialIndexSkipsUnsafeParts:
      /function buildWaterSpatialItems\(\{[\s\S]*?shouldExcludeWaterHitGeometry = \(\) => false,[\s\S]*?if \(shouldExcludeWaterHitGeometry\(hitGeometry, feature, id\)\) return;/.test(spatialBuilderSource)
      && /shouldExcludeWaterHitGeometry = \(\) => false/.test(spatialOwnerSource)
      && /shouldExcludeWaterHitGeometry,/.test(spatialOwnerSource)
      && /collectFeatureHitGeometries: collectSafeWaterRegionGeometryParts/.test(rendererSource),
    physicalLandMasksRequireD3Quality:
      /function getPhysicalLandMaskCandidateQuality\(collection, maskSource\) \{[\s\S]*?getSphericalGeometryDiagnostics\(collection\)[\s\S]*?recordRenderPerfMetric\("physicalLandMaskRejected"/.test(rendererSource)
      && /function getFirstUsablePhysicalLandMaskInfo\(candidates = \[\]\) \{[\s\S]*?getPhysicalLandMaskCandidateQuality\(candidate\.collection, candidate\.maskSource\)/.test(rendererSource),
    waterMaskAndCoastlineShareScenarioSurfaceSignal:
      /function getScenarioSurfaceVersionSignal\(\) \{/.test(rendererSource)
      && /`water-ref:\$\{getObjectIdentityToken\(runtimeState\.scenarioWaterRegionsData, "scenario-water"\)\}`/.test(rendererSource)
      && /maskInfo\.maskQualityToken \|\| "unchecked"/.test(rendererSource)
      && /function getScenarioWaterVisualRevisionToken\(\) \{[\s\S]*?getScenarioSurfaceVersionSignal\(\)/.test(rendererSource)
      && /function getPhysicalLandClipCacheKey\(maskInfo\) \{[\s\S]*?scenario-surface:\$\{getScenarioSurfaceVersionSignal\(\)\}/.test(rendererSource)
      && /function getCoastlineDecisionSignature\(decision = null\) \{[\s\S]*?String\(decision\.scenarioSurfaceVersionSignal \|\| ""\)/.test(rendererSource),
    chunkPromotionSkipsDeferredInfraWhenSecondaryIndexesAlreadySynced:
      /const synchronizedSecondaryRegionIndexes = syncScenarioSecondaryRegionIndexes\(\{[\s\S]*?const shouldSkipDeferredInfraRefresh = synchronizedSecondaryRegionIndexes && !hasPoliticalChange;[\s\S]*?if \(shouldSkipDeferredInfraRefresh\) \{[\s\S]*?scheduleHitCanvasBuildIfNeeded\(\{[\s\S]*?\}\);[\s\S]*?\} else \{[\s\S]*?scheduleDeferredScenarioChunkPromotionInfraRefresh\(\{/.test(rendererSource),
    scenarioApplyCommitsPreparedScenarioWaterPayloadOnly:
      /runtimeState\.scenarioWaterRegionsData = staged\.scenarioWaterRegionsFromTopology \|\| null;/.test(scenarioApplyPipelineSource),
  };

  Object.entries(checks).forEach(([label, ok]) => {
    assert.equal(ok, true, label);
  });
});

test("Atlantropa land interaction contracts use owner-aware targets with runtime country preserved", () => {
  const rendererSource = readRepoFile("js", "core", "map_renderer.js");
  const spatialBuilderSource = readRepoFile("js", "core", "renderer", "spatial_index_runtime_builders.js");
  const spatialOwnerSource = readRepoFile("js", "core", "renderer", "spatial_index_runtime_owner.js");

  const checks = {
    hitResultShapeCarriesRuntimeCountry:
      /function createHitResult\(overrides = \{\}\) \{[\s\S]*?countryCode: null,[\s\S]*?runtimeCountryCode: null,/.test(rendererSource),
    interactionCountryCodeFallsBackFromDisplayOwnerToRuntimeCountry:
      /function getFeatureInteractionCountryCodeNormalized\(feature, featureId = null\) \{[\s\S]*?getDisplayOwnerCode\(feature, resolvedId\)[\s\S]*?getFeatureCountryCodeNormalized\(feature\)/.test(rendererSource),
    canvasHitPreservesRuntimeCountryAndReturnsInteractionCountry:
      /function getHitResultFromCanvas\(event\) \{[\s\S]*?countryCode: getFeatureInteractionCountryCodeNormalized\(feature, id\),[\s\S]*?runtimeCountryCode: getFeatureCountryCodeNormalized\(feature\),/.test(rendererSource),
    spatialHitPreservesRuntimeCountryAndReturnsInteractionCountry:
      /function toHitResult\(candidate[\s\S]*?const runtimeCountryCode = canonicalCountryCode\([\s\S]*?candidate\.item\.countryCode[\s\S]*?const interactionCountryCode = feature[\s\S]*?getFeatureInteractionCountryCodeNormalized\(feature, resolvedId\)[\s\S]*?countryCode: interactionCountryCode \|\| runtimeCountryCode,[\s\S]*?runtimeCountryCode,/.test(rendererSource),
    targetResolutionUsesOwnerAwareFeatureIds:
      /function getInteractionCountryFeatureIds\(feature, featureId\) \{[\s\S]*?getScenarioOwnerFeatureIds\(interactionCountryCode\)[\s\S]*?getCountryFeatureIds\(runtimeCountryCode\)/.test(rendererSource)
      && /function resolveInteractionTargetIds\(feature, id\) \{[\s\S]*?getFeatureInteractionCountryCodeNormalized\(feature, id\)[\s\S]*?getInteractionCountryFeatureIds\(feature, id\)/.test(rendererSource)
      && /function resolveCountryFillTargetIds\(feature, featureId[\s\S]*?getFeatureInteractionCountryCodeNormalized\(feature, featureId\)[\s\S]*?getInteractionCountryFeatureIds\(feature, featureId\)/.test(rendererSource),
    parentGroupsUseOwnerAwareScope:
      /function resolveParentGroupKey\(feature, featureId\) \{[\s\S]*?getFeatureInteractionCountryCodeNormalized\(feature, featureId\)/.test(rendererSource)
      && /function resolveParentGroupTargetIds\(feature, featureId\) \{[\s\S]*?getInteractionCountryFeatureIds\(feature, featureId\)/.test(rendererSource),
    booleanWeldIslandCanRenderWithoutBecomingInteractive:
      /function isAtlantropaVisualSupportHelperFeature\(feature, featureId = null\) \{[\s\S]*?joinMode === "gap_fill"[\s\S]*?\}/.test(rendererSource)
      && /function isPoliticalInteractionRenderableFeature\(feature, featureId = null\) \{[\s\S]*?feature\?\.properties\?\.interactive === false[\s\S]*?isAtlantropaSupportHelperFeature\(feature, featureId\)/.test(rendererSource),
    backgroundMergeFiltersVisualHelpersButKeepsVisibleNonInteractiveLand:
      /function buildScenarioPoliticalBackgroundEntries\(\) \{[\s\S]*?shouldExcludePoliticalVisualFeature\(feature, id\)/.test(rendererSource)
      && /function buildScenarioPoliticalBackgroundEntriesFromSpatialItems\(items = \[\]\) \{[\s\S]*?shouldExcludePoliticalVisualFeature\(entry\.feature, entry\.id\)/.test(rendererSource),
    spatialItemsCanCarryVisibleNonInteractiveLand:
      /function appendLandSpatialItemsRange\([\s\S]*?shouldExcludePoliticalVisualFeature = shouldExcludePoliticalInteractionFeature[\s\S]*?if \(shouldExcludePoliticalVisualFeature\(feature, id\)\) continue;[\s\S]*?interactive: !shouldExcludePoliticalInteractionFeature\(feature, id\)/.test(spatialBuilderSource)
      && /shouldExcludePoliticalVisualFeature = shouldExcludePoliticalInteractionFeature/.test(spatialOwnerSource)
      && /shouldExcludePoliticalVisualFeature,/.test(spatialOwnerSource),
    hitCanvasStillFiltersNonInteractiveSpatialItems:
      /const visibleSpatialItems = collectVisibleLandSpatialItems\(\);[\s\S]*?visibleSpatialItems\.forEach\(\(item\) => \{[\s\S]*?shouldExcludePoliticalInteractionFeature\(item\.feature, item\.id\)/.test(rendererSource),
  };

  Object.entries(checks).forEach(([label, ok]) => {
    assert.equal(ok, true, label);
  });
});
