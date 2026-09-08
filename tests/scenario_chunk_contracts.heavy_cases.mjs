const visibleFrameIdentitySource = readRepoFile("js", "core", "renderer", "visible_frame_identity_policy.js").replace(/^  /gm, "");
import {
  test,
  assert,
  normalizeScenarioChunkManifest,
  selectScenarioChunks,
  getSharedFeatureCountryCode,
  getSharedFeatureId,
  normalizeFeatureCountryCode,
  patchScenarioChunkLoadState,
  queueScenarioChunkPromotionState,
  readRepoFile,
  sliceBetween,
  loadVendorD3,
  isWorldGeoBounds,
  getManifestChunksByLayer,
  readManifestChunkPayload,
  getFeatureId,
  getTopologyGeometryId,
  getCoordinateBounds,
  extractRendererFunction,
  extractRendererPassSignatureBranch,
  createRendererShellPolicyHarness,
  createFirstVisibleFrameGateHarness,
  getPolygonCoordinateSets,
  getRingSignedArea,
} from "./helpers/scenario_chunk_contract_support.mjs";

const scenarioRegionOverlayOwnerSource = readRepoFile("js", "core", "renderer", "scenario_region_overlay_render_owner.js");
const scenarioReliefOverlayOwnerSource = readRepoFile("js", "core", "renderer", "scenario_relief_overlay_render_owner.js");

const politicalFeaturePolicySource = readRepoFile("js", "core", "renderer", "political_feature_policy.js").replace(/^  /gm, "");

const staticBorderMeshLifecycleSource = readRepoFile("js", "core", "renderer", "static_border_mesh_lifecycle.js");

const brushInteractionSessionOwnerSource = readRepoFile("js", "core", "renderer", "brush_interaction_session_owner.js");

const renderPassSignatureSource = readRepoFile("js", "core", "renderer", "render_pass_signature_policy.js").replace(/^  /gm, "");

const defaultRegister = (_order, ...args) => test(...args);

export function registerScenarioChunkContractHeavyTests(register = defaultRegister) {
  register(25, "tno render budget sets political cold selection caps", () => {
    const manifest = JSON.parse(readRepoFile("data", "scenarios", "tno_1962", "manifest.json"));
    const chunkAssetToolSource = readRepoFile("tools", "scenario_chunk_assets.py");
    const hints = manifest.render_budget_hints || {};

    assert.equal(hints.max_required_political_chunks, 6);
    assert.equal(hints.min_required_political_chunks, 1);
    assert.equal(hints.max_required_political_estimated_path_cost, 680_000);
    assert.equal(hints.max_required_political_byte_size, 45_000_000);
    assert.match(chunkAssetToolSource, /TNO_1962_RENDER_BUDGET_HINTS = \{[\s\S]*?"max_required_political_chunks": 6/);
    assert.match(chunkAssetToolSource, /\*\*\(TNO_1962_RENDER_BUDGET_HINTS if scenario_id == "tno_1962" else \{\}\)/);
  });

  register(26, "checked-in political coarse chunks match complete runtime political geometry", () => {
    for (const scenarioId of ["tno_1962", "hoi4_1939"]) {
      const chunkManifest = JSON.parse(readRepoFile("data", "scenarios", scenarioId, "detail_chunks.manifest.json"));
      const bootstrapTopology = JSON.parse(readRepoFile("data", "scenarios", scenarioId, "runtime_topology.bootstrap.topo.json"));
      const runtimeTopology = JSON.parse(readRepoFile("data", "scenarios", scenarioId, "runtime_topology.topo.json"));
      const bootstrapPoliticalCount = bootstrapTopology.objects?.political?.geometries?.length || 0;
      const runtimePoliticalCount = runtimeTopology.objects?.political?.geometries?.length || 0;
      const coarseChunk = chunkManifest.chunks.find((chunk) => chunk.id === "political.coarse.r0c0");
      const coarsePayload = readManifestChunkPayload(coarseChunk);

      assert.ok(bootstrapPoliticalCount > 0, `${scenarioId} bootstrap political geometry must exist`);
      assert.ok(runtimePoliticalCount > 0, `${scenarioId} runtime political geometry must exist`);
      assert.equal(coarseChunk.feature_count, runtimePoliticalCount, `${scenarioId} coarse chunk should match runtime political geometry`);
      assert.equal(coarseChunk.feature_bounds.length, coarseChunk.feature_count, `${scenarioId} coarse chunk should expose per-feature bounds`);
      assert.equal(coarsePayload.features.length, coarseChunk.feature_count, `${scenarioId} coarse payload should match manifest count`);

      const interactivePoliticalFeatures = coarsePayload.features.filter((feature) => {
        const props = feature?.properties || {};
        return props.interactive !== false && props.render_as_base_geography !== true;
      });
      assert.ok(interactivePoliticalFeatures.length > 0, `${scenarioId} coarse chunk should retain interactive political features`);
    }
  });

  register(27, "tno mediterranean detail selection keeps Atlantropa scenario layer chunks", () => {
    const manifest = JSON.parse(readRepoFile("data", "scenarios", "tno_1962", "manifest.json"));
    const chunkManifest = JSON.parse(readRepoFile("data", "scenarios", "tno_1962", "detail_chunks.manifest.json"));
    const chunkRegistry = normalizeScenarioChunkManifest(chunkManifest);
    const mediterraneanViewport = [8, 32, 28, 46];
    const focusCountries = ["ITA", "GRE", "TUR", "CRO", "SPR", ""];

    focusCountries.forEach((focusCountry) => {
      const selection = selectScenarioChunks({
        scenarioId: "tno_1962",
        chunkRegistry,
        contextLodManifest: null,
        zoom: 2.5,
        viewportBbox: mediterraneanViewport,
        focusCountry,
        renderBudgetHints: manifest.render_budget_hints,
        visibleLayers: ["political", "scenario_atlantropa"],
        loadedChunkIds: [],
      });
      const requiredIds = selection.requiredChunks.map((chunk) => chunk.id);
      assert.ok(
        requiredIds.some((id) => id.startsWith("scenario_atlantropa.detail.")),
        `focus=${focusCountry || "(none)"} required=${requiredIds.join(",")}`,
      );
      assert.equal(
        requiredIds.includes("political.detail.country.atl"),
        false,
        `focus=${focusCountry || "(none)"} should use scenario_atlantropa chunks instead of the old ATL political chunk`,
      );
      assert.ok(requiredIds.length > 6, "TNO Mediterranean detail view needs wider political chunk coverage than the old 6 chunk cap");
    });
  });

  register(28, "tno detail chunk manifest records content hashes and precise feature bounds", () => {
    const chunkManifest = JSON.parse(readRepoFile("data", "scenarios", "tno_1962", "detail_chunks.manifest.json"));
    const atlantropaDetailChunks = getManifestChunksByLayer(chunkManifest, "scenario_atlantropa")
      .filter((chunk) => chunk.lod === "detail");
    assert.ok(atlantropaDetailChunks.length > 0, "scenario_atlantropa detail chunks must exist");
    atlantropaDetailChunks.forEach((chunk) => {
      assert.match(chunk.id, /^scenario_atlantropa\.detail\.r[0-1]c[0-3]$/);
      assert.match(String(chunk.sha256 || ""), /^[a-f0-9]{64}$/);
      assert.ok(Array.isArray(chunk.feature_bounds), `${chunk.id} should expose precise feature bounds`);
    });
    const localBounds = atlantropaDetailChunks.flatMap((chunk) => chunk.feature_bounds || []);
    assert.ok(localBounds.length >= 100);
    assert.ok(
      localBounds.some((bounds) => Array.isArray(bounds) && bounds[0] >= -6.1 && bounds[2] <= 36.3),
      "scenario_atlantropa chunks should expose local feature bounds for viewport selection",
    );
  });

  register(29, "tno startup runtime meta keeps Atlantropa ids beyond the bootstrap shell", () => {
    const startupBundle = JSON.parse(readRepoFile("data", "scenarios", "tno_1962", "startup.bundle.en.json"));
    const bootstrapTopology = startupBundle.scenario.runtime_topology_bootstrap;
    const metaFeatureIds = startupBundle.scenario.runtime_political_meta.featureIds;
    const bootstrapPoliticalIds = (bootstrapTopology.objects.political.geometries || []).map(getTopologyGeometryId);
    const bootstrapAtlantropaIds = (bootstrapTopology.objects.scenario_atlantropa?.geometries || []).map(getTopologyGeometryId);

    assert.ok(metaFeatureIds.length > bootstrapPoliticalIds.length + bootstrapAtlantropaIds.length);
    assert.ok(metaFeatureIds.some((featureId) => String(featureId).startsWith("ATL")));
    const metaFeatureIdSet = new Set(metaFeatureIds);
    assert.ok(bootstrapPoliticalIds.every((featureId) => metaFeatureIdSet.has(featureId)));
  });

  register(30, "tno scenario_atlantropa chunks stay d3 small-polygon safe", () => {
    const d3 = loadVendorD3();
    const chunkManifest = JSON.parse(readRepoFile("data", "scenarios", "tno_1962", "detail_chunks.manifest.json"));
    const atlantropaChunks = getManifestChunksByLayer(chunkManifest, "scenario_atlantropa");
    assert.ok(atlantropaChunks.length > 0, "scenario_atlantropa chunks must exist");
    const badSamples = [];
    for (const chunk of atlantropaChunks) {
      const payload = readManifestChunkPayload(chunk);
      for (const feature of payload.features || []) {
        const featureId = String(feature?.properties?.id || feature?.id || "").trim();
        if (!featureId.startsWith("ATL")) continue;
        const bounds = d3.geoBounds(feature);
        const area = d3.geoArea(feature);
        if (isWorldGeoBounds(bounds) || area > 1) {
          badSamples.push({ chunkId: chunk.id, featureId, bounds, area });
        }
        if (badSamples.length >= 8) break;
      }
      if (badSamples.length >= 8) break;
    }
    assert.deepEqual(badSamples, []);
  });

  register(31, "tno boolean-weld Atlantropa donor island chunks do not publish large interior holes", () => {
    const chunkManifest = JSON.parse(readRepoFile("data", "scenarios", "tno_1962", "detail_chunks.manifest.json"));
    const requiredIslandIds = new Set([
      "ATLISL_west_med_balearics",
      "ATLISL_aegean_crete",
      "ATLISL_levant_cyprus",
    ]);
    const atlantropaChunks = getManifestChunksByLayer(chunkManifest, "scenario_atlantropa");
    const visitedRequiredIds = new Set();
    const visitedBooleanWeldIds = new Set();
    const interiorRingSamples = [];
    for (const chunk of atlantropaChunks) {
      const payload = readManifestChunkPayload(chunk);
      for (const feature of payload.features || []) {
        const featureId = getFeatureId(feature);
        const props = feature?.properties || {};
        if (!featureId.startsWith("ATLISL_")) continue;
        if (props.atl_geometry_role !== "donor_island" || props.atl_join_mode !== "boolean_weld") continue;
        if (requiredIslandIds.has(featureId)) visitedRequiredIds.add(featureId);
        visitedBooleanWeldIds.add(featureId);
        for (const polygonCoordinates of getPolygonCoordinateSets(feature.geometry)) {
          polygonCoordinates.slice(1).forEach((ring, ringIndex) => {
            interiorRingSamples.push({
              chunkId: chunk.id,
              featureId,
              ringIndex: ringIndex + 1,
              pointCount: Array.isArray(ring) ? ring.length : 0,
              area: Number(Math.abs(getRingSignedArea(ring)).toFixed(9)),
            });
          });
        }
      }
    }
    assert.ok(visitedBooleanWeldIds.size > 0, "expected checked-in Atlantropa boolean-weld donor islands");
    assert.deepEqual([...requiredIslandIds].filter((featureId) => !visitedRequiredIds.has(featureId)), []);
    assert.deepEqual(interiorRingSamples, []);
  });

  register(33, "exact-after-settle keeps scenario overlays on the contextScenario reuse path", () => {
    const rendererSource = readRepoFile("js", "core", "map_renderer.js");
    const hoverOwnerSource = readRepoFile("js", "core", "map_renderer", "map_hover_interaction_owner.js");
    const politicalPassOwnerSource = readRepoFile(
      "js",
      "core",
      "renderer",
      "political_pass_orchestrator_owner.js",
    );
    const politicalPartialOwnerSource = readRepoFile(
      "js",
      "core",
      "renderer",
      "political_partial_repaint_owner.js",
    );
    const urbanCityPolicySource = readRepoFile("js", "core", "renderer", "urban_city_policy.js");
    const drawCanvasOrchestrationOwnerSource = readRepoFile(
      "js",
      "core",
      "map_renderer",
      "draw_canvas_orchestration_owner.js",
    );
    const mainSource = readRepoFile("js", "main.js");
    const deferredUiBootstrapSource = readRepoFile("js", "bootstrap", "deferred_ui_bootstrap.js");
    const contextScenarioSignatureBranch = extractRendererPassSignatureBranch(renderPassSignatureSource, "contextScenario");
    const rendererRuntimeStateSource = readRepoFile("js", "core", "state", "renderer_runtime_state.js");
    const frameSchedulerSource = readRepoFile("js", "core", "frame_scheduler.js");
    const exactAfterSettlePlansSource = readRepoFile("js", "core", "map_renderer", "exact_after_settle_refresh_plans.js");
    const exactAfterSettlePassCatalogSource = readRepoFile("js", "core", "renderer", "exact_after_settle_pass_catalog.js");
    const exactSchedulerSource = readRepoFile("js", "core", "map_renderer", "exact_after_settle_scheduler.js");
    const renderPassCatalogSource = readRepoFile("js", "core", "map_renderer", "render_pass_catalog.js");
    const renderInvalidationCatalogSource = readRepoFile("js", "core", "map_renderer", "render_invalidation_catalog.js");
    const scenarioOwnershipEditorSource = readRepoFile("js", "core", "scenario_ownership_editor.js");
    const politicalRasterWorkerClientSource = readRepoFile("js", "core", "political_raster_worker_client.js");
    const politicalRasterWorkerSource = readRepoFile("js", "workers", "political_raster.worker.js");
    const chunkRuntimeSource = readRepoFile("js", "core", "scenario", "chunk_runtime.js");
    const chunkManagerSource = readRepoFile("js", "core", "scenario_chunk_manager.js");
    const spatialQueryIndexSource = readRepoFile("js", "core", "renderer", "spatial_query_index.js");
    const chunkPromotionHelperSource = readRepoFile("js", "core", "renderer", "scenario_chunk_promotion_helpers.js");
    const scenarioRefreshPlansSource = readRepoFile("js", "core", "map_renderer", "scenario_refresh_plans.js");
    const scenarioRefreshRuntimeSource = readRepoFile("js", "core", "map_renderer", "scenario_refresh_runtime.js");
    const scenarioVisualInvalidationExecutorSource = readRepoFile("js", "core", "map_renderer", "scenario_visual_invalidation_executor.js");
    const frameGraphExecutionPlanSource = sliceBetween(
      scenarioRefreshPlansSource,
      "function resolveFrameGraphInvalidationExecutionPlan(",
      "function createScenarioApplyRefreshPlan(",
    );
    const chunkPromotionRuntimeSource = sliceBetween(
      scenarioRefreshRuntimeSource,
      "function refreshMapDataForScenarioChunkPromotion(",
      "function refreshMapDataForScenarioApply(",
    );
    const scenarioRendererBridgeSource = readRepoFile("js", "core", "scenario", "scenario_renderer_bridge.js");
    const interactionHitCandidateSource = readRepoFile("js", "core", "map_renderer", "interaction_hit_candidates.js");
    const bundleRuntimeSource = readRepoFile("js", "core", "scenario", "bundle_runtime.js");
    const bundleLoaderSource = readRepoFile("js", "core", "scenario", "bundle_loader.js");
    const postApplyEffectsSource = readRepoFile("js", "core", "scenario_post_apply_effects.js");
    const renderPipelinePassesSource = readRepoFile("js", "core", "renderer", "render_pipeline_passes.js");
    const contextPassOwnerSource = readRepoFile("js", "core", "renderer", "context_pass_orchestrator_owner.js");
    const renderCacheOwnerSource = readRepoFile("js", "core", "renderer", "render_cache_owner.js");
    const cachedPassCompositorOwnerSource = readRepoFile("js", "core", "renderer", "cached_pass_compositor_owner.js");
    const transformedFrameCompositorOwnerSource = readRepoFile("js", "core", "map_renderer", "transformed_frame_compositor_owner.js");
    const renderTransformReusePolicyOwnerSource = readRepoFile("js", "core", "renderer", "render_transform_reuse_policy_owner.js");
    const visibleFrameDiagnosticsOwnerSource = readRepoFile("js", "core", "renderer", "visible_frame_diagnostics_owner.js");
    const setMapDataTransactionOwnerSource = readRepoFile("js", "core", "map_renderer", "set_map_data_transaction_owner.js");
    const renderRequestBoundaryOwnerSource = readRepoFile("js", "core", "map_renderer", "render_request_boundary_owner.js");
    const renderPhaseLifecycleOwnerSource = readRepoFile("js", "core", "map_renderer", "render_phase_lifecycle_owner.js");
    const renderPassCommitAccountingOwnerSource = readRepoFile("js", "core", "map_renderer", "render_pass_commit_accounting_owner.js");
    const clickSelectionTransactionOwnerSource = readRepoFile("js", "core", "map_renderer", "click_selection_transaction_owner.js");
    const zoomInteractionLifecycleOwnerSource = readRepoFile("js", "core", "renderer", "zoom_interaction_lifecycle_owner.js");
    const cityPointsRenderOwnerSource = readRepoFile("js", "core", "renderer", "city_points_render_owner.js");
    const interactionRecoveryBlockedBody =
      rendererSource.match(/function isInteractionRecoveryBlocked\(\) \{(?<body>[\s\S]*?)\n\}/)?.groups?.body || "";
    const applyRenderPassInvalidationEffectsBody =
      rendererSource.match(/function applyRenderPassInvalidationEffects\(mutation = \{\}\) \{[\s\S]*?\r?\n\}\r?\n\r?\nfunction invalidateRenderPasses/)?.[0] || "";

    const contract = {
      drawContextScenarioPassKeepsScenarioOverlayBoundary:
        /function drawContextScenarioPass\(k, \{ interactive = false \} = \{\}\) \{[\s\S]*?drawScenarioRegionOverlaysPass\(k\);[\s\S]*?drawScenarioReliefOverlaysPass\(k\);[\s\S]*?recordRenderPerfMetric\("drawContextScenarioPass"/.test(contextPassOwnerSource),
      signatureOnlyContextScenarioInvalidationUsesTransformReuse:
        /passName === "contextScenario"[\s\S]*?shouldEnableContextScenarioTransformReuse\(\)[\s\S]*?cache\.dirty\[passName\] = false;[\s\S]*?recordRenderPerfMetric\("contextScenarioReuseSkipped", 0, \{/.test(renderPipelinePassesSource)
        && /shouldEnableContextScenarioTransformReuse,/.test(rendererSource),
      contextScenarioKeepsLayerMetrics:
        scenarioRegionOverlayOwnerSource.includes('"contextScenarioLayerWater"')
        && scenarioRegionOverlayOwnerSource.includes('"contextScenarioLayerSpecial"')
        && scenarioReliefOverlayOwnerSource.includes('"contextScenarioLayerRelief"')
        && renderPipelinePassesSource.includes('recordRenderPerfMetric("contextScenarioSignatureChanged"'),
      contextScenarioSpecialSignatureTracksPayloadIdentity:
        /function getScenarioSpecialVisualRevisionToken\(\) \{[\s\S]*?special-ref:\$\{getObjectIdentityToken\(runtimeState\.scenarioSpecialRegionsData, "scenario-special"\)\}[\s\S]*?special-count:\$\{getFeatureCollectionFeatureCount\(runtimeState\.scenarioSpecialRegionsData\)\}[\s\S]*?runtimeState\.showScenarioSpecialRegions \? "scenario-special:on" : "scenario-special:off"/.test(rendererSource),
      interactionMetricsKeepDirectActionAndHitRankDurations:
        rendererSource.includes('recordInteractionDurationMetric("interactionActionDuration"')
        && /function rankCandidates\([\s\S]*?candidates,[\s\S]*?lonLat,[\s\S]*?eventType = "unknown",[\s\S]*?targetType = "unknown",[\s\S]*?recordInteractionDurationMetric\("interactionHitRankDuration"[\s\S]*?candidateCount: candidates\.length,[\s\S]*?geoContainsCount,[\s\S]*?containsGeoCount:[\s\S]*?eventType,[\s\S]*?targetType,/.test(interactionHitCandidateSource)
        && /function rankCandidates\(candidates, lonLat,[\s\S]*?rankHitCandidates\(candidates, lonLat,[\s\S]*?recordInteractionDurationMetric,/.test(rendererSource),
      hoverMetricsUseSamplingAndSlowSampleThreshold:
        rendererSource.includes("const HOVER_INTERACTION_METRIC_SAMPLE_RATE = 10;")
        && rendererSource.includes("const HOVER_INTERACTION_SLOW_SAMPLE_MS = 8;")
        && /function recordInteractionDurationMetric\(name, durationMs, details = \{\}\) \{[\s\S]*?incrementPerfCounter\(counterName\);[\s\S]*?callCount % HOVER_INTERACTION_METRIC_SAMPLE_RATE === 0/.test(rendererSource),
      hoverOverlayKeepsDirtySignatureGateAndRafQueue:
        /function renderHoverOverlayIfNeeded\(\{ force = false, eventType = "hover" \} = \{\}\) \{[\s\S]*?!force && !state\.hoverOverlayDirty && nextSignature === lastHoverOverlaySignature[\s\S]*?recordInteractionDurationMetric\("interactionHoverOverlayDuration"/.test(hoverOwnerSource)
        && /function scheduleHoverOverlayRender\(\) \{[\s\S]*?if \(overlayFrame\) return;[\s\S]*?overlayFrame = scheduleFrame\(/.test(hoverOwnerSource),
      hoverOverlayDirectPathsCarryExplicitEventTypes:
        rendererSource.includes('renderHoverOverlayIfNeeded({ eventType: "facility-card-visibility" });')
        && clickSelectionTransactionOwnerSource.includes('renderHoverOverlayIfNeeded({ eventType: "facility-card-open" });')
        && clickSelectionTransactionOwnerSource.includes('renderHoverOverlayIfNeeded({ eventType: "facility-card-clear" });')
        && zoomInteractionLifecycleOwnerSource.includes('renderHoverOverlayIfNeeded?.({ force: true, eventType: "zoom-start" });')
        && hoverOwnerSource.includes('renderHoverOverlayIfNeeded({ eventType: "mouseleave" });')
        && rendererSource.includes('renderHoverOverlayIfNeeded({ eventType: "facility-card-close" });'),
      hoverFacilityAndCityProbeMetricsRemainNamed:
        rendererSource.includes('recordInteractionDurationMetric("interactionHoverFacilityProbeDuration"')
        && cityPointsRenderOwnerSource.includes('recordInteractionDurationMetric("interactionHoverCityProbeDuration"'),
      interactionCompositeUsesSingleMainPassCache:
        renderPassCatalogSource.includes("export const INTERACTION_COMPOSITE_PASS_NAMES = [")
        && rendererSource.includes('recordRenderPerfMetric("interactionCompositeBuild"')
        && rendererSource.includes('recordRenderPerfMetric("interactionCompositeContinuityReuse"')
        && renderCacheOwnerSource.includes("function getInteractionCompositeReuseDecision(")
        && renderCacheOwnerSource.includes('new Set(["selection-version-mismatch", "topology-revision-mismatch"])')
        && /function composeTransformedFrameToBuffer\([\s\S]*?useInteractionComposite = true[\s\S]*?allowInteractionCompositeContinuity = false[\s\S]*?drawInteractionComposite\(currentTransform, \{[\s\S]*?allowSelectionTopologyContinuity: allowInteractionCompositeContinuity[\s\S]*?composeRenderPassesToTarget\([\s\S]*?interactionCompositePassNames[\s\S]*?drawInteractionBorderSnapshot\(currentTransform\)/.test(transformedFrameCompositorOwnerSource),
      continuityFrameSkipsBaseFillDuringInteraction:
        rendererSource.includes("const CONTINUITY_FRAME_MAX_STALE_AGE_MS = 1500;")
        && /function invalidateLastGoodFrame\(reason = "visual-invalidation"\) \{[\s\S]*?frame\.stale = true;/.test(renderCacheOwnerSource)
        && /function recordLastGoodFrameInvalidationSummary\(summary = \{\}\) \{[\s\S]*?recordRenderPerfMetric\("continuityFrameMarkedStale"/.test(rendererSource)
        && /getRenderPhase\(\) === renderPhaseInteracting && getFirstVisibleFramePainted\(\)[\s\S]*?noteMissingVisibleFrameSkippedDuringInteraction\("missing-fast-frame-no-continuity"\);[\s\S]*?keptPreviousPixels = true;[\s\S]*?\} else \{[\s\S]*?drewFrame = !!drawBaseVisibleFrameFallback\("missing-fast-frame-no-continuity"\);/.test(drawCanvasOrchestrationOwnerSource)
        && rendererSource.includes('recordRenderPerfMetric("continuityFrameStaleAgeMs"')
        && visibleFrameDiagnosticsOwnerSource.includes('"visibleFrameTransaction"')
        && rendererSource.includes('recordRenderPerfMetric("missingVisibleFrameCount"')
        && rendererSource.includes('recordRenderPerfMetric("missingVisibleFrameSkippedDuringInteraction"')
        && /const staleSince = frame\.stale && Number\(frame\.invalidatedAt \|\| 0\) > 0[\s\S]*?Number\(frame\.invalidatedAt \|\| 0\)[\s\S]*?Number\(frame\.capturedAt \|\| 0\);[\s\S]*?const staleAgeMs = Math\.max\(0, Date\.now\(\) - staleSince\);/.test(rendererSource)
        && rendererSource.includes('return reject("topology-revision-mismatch")')
        && rendererSource.includes('return reject("stale-age-limit")')
        && rendererSource.includes('continuityFrameRelaxedReuse'),
      firstVisibleScenarioRequiresCurrentPoliticalExactFrame:
        /function getFirstVisiblePoliticalFrameBlockReason\(reason = "visible-frame"\) \{[\s\S]*?base-visible-fallback[\s\S]*?normalizedReason !== "exact-frame"[\s\S]*?dirty-political-pass[\s\S]*?stale-ocean-fill[\s\S]*?stale-political-signature[\s\S]*?stale-political-reference-transform[\s\S]*?politicalPassDataStage[\s\S]*?politicalPassFineCacheReady[\s\S]*?stale-political-full-reference-transform/.test(visibleFrameIdentitySource)
        && /function noteFirstVisibleFrameBlocked\(reason = "visible-frame", blockReason = "unknown"\) \{[\s\S]*?getVisibleFrameDiagnosticsOwner\(\)\.recordFirstVisibleFrameBlocked\(reason, blockReason\);/.test(rendererSource)
        && /function recordVisibleFrameTransactionMetric\(status, details = \{\}\) \{[\s\S]*?getVisibleFrameDiagnosticsOwner\(\)\.recordVisibleFrameTransaction\(status, details\)\.metricEntry;/.test(rendererSource)
        && /function markFirstVisibleFramePainted\(reason = "visible-frame"\) \{[\s\S]*?getVisibleFrameDiagnosticsOwner\(\)\.markFirstVisibleFramePainted\(reason\);/.test(rendererSource)
        && visibleFrameDiagnosticsOwnerSource.includes('"visibleFrameTransactionCount"')
        && visibleFrameDiagnosticsOwnerSource.includes('"firstVisibleFrameBlocked"')
        && visibleFrameDiagnosticsOwnerSource.includes('"firstVisibleFramePainted"')
        && visibleFrameDiagnosticsOwnerSource.includes('"callFirstVisibleFramePaintedHook"')
        && visibleFrameDiagnosticsOwnerSource.includes("topologyBundleMode")
        && visibleFrameDiagnosticsOwnerSource.includes("oceanFill"),
      oceanBackgroundInvalidationCoversPoliticalSignatureDependents:
        /function invalidateOceanBackgroundVisualState\(reason = "ocean-background"\) \{[\s\S]*?cancelExactAfterSettleRefresh\(\{ clearDefer: true \}\);[\s\S]*?invalidateRenderPasses\(\["background", "physicalBase", "political", "contextBase", "contextScenario"\], reason\);[\s\S]*?clearRenderPassReferenceTransforms\(\["background", "physicalBase", "political", "contextBase", "contextScenario"\]\);/.test(rendererSource)
        && /function getPoliticalPassStaticSignature[\s\S]*?`ocean-fill:\$\{getOceanBaseFillColor\(\)\}`/.test(renderPassSignatureSource)
        && /if \(passName === "contextScenario"\) \{[\s\S]*?`ocean-fill:\$\{getOceanBaseFillColor\(\)\}`/.test(renderPassSignatureSource),
      exactAfterSettleReschedulesWhenPhaseStillBusy:
        /function scheduleExactAfterSettleRefresh\(profile = runtimeState\.adaptiveSettleProfile \|\| getAdaptiveSettleProfile\(\)\) \{[\s\S]*?getExactAfterSettleScheduler\(\)\.scheduleExactAfterSettleRefresh\(profile\);/.test(rendererSource)
        && /function scheduleExactAfterSettleRefresh\(profile = runtimeState\.adaptiveSettleProfile \|\| getAdaptiveSettleProfile\(\)\) \{[\s\S]*?const generation = Number\(beginExactAfterSettleControllerSchedule\(scheduleStartedAt\) \|\| 0\);[\s\S]*?isExactAfterSettleGenerationCurrent\(generation, "scheduled"\)[\s\S]*?if \(!runtimeState\.deferExactAfterSettle\) \{[\s\S]*?resetExactAfterSettleController\("defer-cleared", generation\);[\s\S]*?if \(runtimeState\.renderPhase !== renderPhaseIdle\) \{[\s\S]*?scheduleExactAfterSettleRefresh\(resolvedProfile\);[\s\S]*?return;[\s\S]*?\}/.test(exactSchedulerSource),
      exactAfterSettleUsesLocalController:
        rendererRuntimeStateSource.includes("exactAfterSettleController")
        && rendererRuntimeStateSource.includes("function createDefaultExactAfterSettleControllerState()")
        && rendererRuntimeStateSource.includes("function resetExactAfterSettleControllerState(")
        && rendererRuntimeStateSource.includes("function isExactAfterSettleGenerationCurrentState(")
        && /function getExactAfterSettleControllerState\(\) \{[\s\S]*?getExactAfterSettleScheduler\(\)\.getExactAfterSettleControllerState\(\);/.test(rendererSource)
        && /function getExactAfterSettleControllerState\(\) \{[\s\S]*?ensureExactAfterSettleControllerState\(runtimeState\);/.test(exactSchedulerSource)
        && /function applyScheduledExactAfterSettleRefreshPlan\(generation, plan\) \{[\s\S]*?const scheduledPlan = \{[\s\S]*?controllerGeneration: generation,[\s\S]*?beginExactAfterSettleControllerApplyState\(runtimeState, \{[\s\S]*?plan: scheduledPlan,[\s\S]*?const appliedPlan = applyExactAfterSettleRefreshPlan\(scheduledPlan\);[\s\S]*?prepareExactAfterSettlePassesInSlices\(generation, appliedPlan\);/.test(exactSchedulerSource)
        && /replaceExactAfterSettlePendingPlanState\(runtimeState, \{[\s\S]*?generation,[\s\S]*?plan: appliedPlan,[\s\S]*?\}\);/.test(exactSchedulerSource)
        && /function completeScheduledExactAfterSettleRefreshPlan\(generation, plan, passStartedAt\) \{[\s\S]*?completeExactAfterSettleControllerApplyState\(runtimeState, \{[\s\S]*?generation,[\s\S]*?applyFinishedAt,[\s\S]*?recordRenderPerfMetric\("settleExactRefreshPasses"[\s\S]*?requestRendererRender\("exact-after-settle", \{[\s\S]*?flush: true/.test(exactSchedulerSource),
      exactAfterSettleFinalizesAfterExactCompose:
        /function drawCanvasFrame\(options\) \{[\s\S]*?const activeRenderPassNames = getActiveRenderPassNames\(\);[\s\S]*?drewExactFrame = !!composeCachedPasses\(activeRenderPassNames\);[\s\S]*?if \(drewExactFrame\) \{[\s\S]*?finalizePendingExactAfterSettleRefreshAfterPaint\(\);/.test(drawCanvasOrchestrationOwnerSource)
        && /function finalizePendingExactAfterSettleRefreshAfterPaint\(\) \{[\s\S]*?isExactAfterSettleIdentityCurrent\(controller\)[\s\S]*?recordRenderPerfMetric\("settleExactRefreshWaitForPaint"[\s\S]*?finalizeExactAfterSettleRefreshPlan\(plan\);[\s\S]*?recordRenderPerfMetric\("settleExactRefreshFinalize"/.test(exactSchedulerSource)
        && /metricSequenceStartedAt: Math\.max\(0, Number\(runtimeState\.renderPerfMetricSequence \|\| 0\)\)/.test(exactSchedulerSource)
        && /function readRenderPerfMetricDuration\(metricName, minSequence = 0\) \{[\s\S]*?requiredMinSequence > 0[\s\S]*?entry\?\.sequence/.test(rendererSource)
        && /function recordSettleExactRefreshPhaseBreakdown\(plan, durationMs\) \{[\s\S]*?recordRenderPerfMetric\("settleExactRefreshPhaseBreakdown"[\s\S]*?applyMs: readRenderPerfMetricDuration\("settleExactRefreshApply"\)[\s\S]*?passesMs: readRenderPerfMetricDuration\("settleExactRefreshPasses"\)[\s\S]*?hitCanvasMs: readRenderPerfMetricDuration\("buildHitCanvas", metricSequenceStartedAt\)/.test(exactSchedulerSource)
        && /recordRenderPerfMetric\("settleExactRefreshFinalize"[\s\S]*?recordSettleExactRefreshPhaseBreakdown\(plan, Math\.max\(0, nowMs\(\) - Number\(plan\.startedAt \|\| finalizeStartedAt\)\)\);/.test(exactSchedulerSource)
        && !/applyScheduledExactAfterSettleRefreshPlan\(generation, plan\);[\s\S]{0,160}?finalizeExactAfterSettleRefreshPlan\(plan\);/.test(exactSchedulerSource),
      exactAfterSettleSuccessInvalidatesPoliticalPass:
        /function invalidateExactAfterSettlePoliticalPass\(generation, plan\) \{[\s\S]*?invalidateRenderPasses\("political", "exact-after-settle-political"\);[\s\S]*?const nextPlan = \{[\s\S]*?politicalInvalidationReason: "exact-after-settle-political",[\s\S]*?politicalInvalidatedAt,[\s\S]*?replaceExactAfterSettlePendingPlanState\(runtimeState, \{[\s\S]*?generation,[\s\S]*?plan: nextPlan,[\s\S]*?return nextPlan;/.test(exactSchedulerSource)
        && /function prepareExactAfterSettlePassesInSlices\(generation, plan\) \{[\s\S]*?const enqueueNextPass = \(index, activePlan\) => \{[\s\S]*?if \(runtimeState\.renderPhase !== renderPhaseIdle\) \{[\s\S]*?abortInterruptedExactAfterSettleRefresh\(`\$\{passName\}-phase-interrupted`, generation\);[\s\S]*?return;[\s\S]*?if \(!isExactAfterSettleIdentityCurrent\(activeController\)\) \{[\s\S]*?abortInterruptedExactAfterSettleRefresh\(`\$\{passName\}-identity-mismatch`, generation\);[\s\S]*?return;[\s\S]*?const nextPlan = passName === "political"[\s\S]*?invalidateExactAfterSettlePoliticalPass\(generation, activePlan\)[\s\S]*?getRenderPipelinePassesOwner\(\)\.prepareIdleRenderPassDefinition\(passName, drawFn, transform, timings, cache\);/.test(exactSchedulerSource)
        && /function applyExactAfterSettleRefreshPlan\(plan\) \{[\s\S]*?const exactAfterSettleDprPasses = getExactAfterSettleDprRestorePasses\(renderPassNames\);[\s\S]*?reason: "exact-after-settle-dpr-restore",[\s\S]*?targetPassesOnDprChange: exactAfterSettleDprPasses,[\s\S]*?targetPassesOnResize: exactAfterSettleDprPasses,[\s\S]*?targetPassesOnCanvasResize: exactAfterSettleDprPasses,[\s\S]*?resolveExactAfterSettleTargetPasses/.test(exactSchedulerSource)
        && !/function applyExactAfterSettleRefreshPlan\(plan\) \{[\s\S]*?exact-after-settle-dpr-restore[\s\S]*?targetPassesOnDprChange: \["political", "contextBase", "borders"\]/.test(exactSchedulerSource)
        && !/function applyExactAfterSettleRefreshPlan\(plan\) \{[\s\S]*?invalidateRenderPasses\("political", "exact-after-settle-political"\);[\s\S]*?const targetPassNames = new Set\(\["political", "borders", "labels", "textureLabels"\]\);/.test(exactSchedulerSource)
        && /recordRenderPerfMetric\("settleExactRefreshPasses"[\s\S]*?politicalInvalidationReason: String\(plan\.politicalInvalidationReason \|\| ""\),[\s\S]*?politicalInvalidatedAt: Number\(plan\.politicalInvalidatedAt \|\| 0\),/.test(exactSchedulerSource),
      exactAfterSettleAbortsInterruptedBeforePaint:
        /function abortInterruptedExactAfterSettleRefresh\(reason = "interrupted", generation = null\) \{[\s\S]*?const shouldRearmExactRefresh = !!runtimeState\.deferExactAfterSettle;[\s\S]*?recordRenderPerfMetric\("settleExactRefreshAbortBeforePaint"[\s\S]*?resetExactAfterSettleController\(`abort-\$\{normalizedReason\}`, generation\);[\s\S]*?setDeferExactAfterSettleState\(runtimeState, shouldRearmExactRefresh\);[\s\S]*?setPendingExactPoliticalFastFrameState\(runtimeState, shouldRearmExactRefresh\);[\s\S]*?invalidateRenderPasses\("political", "exact-after-settle-abort"\);[\s\S]*?if \(shouldRearmExactRefresh\) \{[\s\S]*?scheduleExactAfterSettleRefresh\(runtimeState\.adaptiveSettleProfile \|\| getAdaptiveSettleProfile\(\)\);[\s\S]*?\}[\s\S]*?requestRendererRender\("exact-after-settle-abort-recover", \{[\s\S]*?flush: false,[\s\S]*?if \(getContext\(\)\) render\(\);/.test(exactSchedulerSource)
        && /function enqueueExactAfterSettleSegment\(generation, label, task\) \{[\s\S]*?if \(runtimeState\.renderPhase !== renderPhaseIdle\) \{[\s\S]*?abortInterruptedExactAfterSettleRefresh\(`\$\{label\}-phase-interrupted`, generation\);[\s\S]*?if \(!isExactAfterSettleIdentityCurrent\(getExactAfterSettleControllerState\(\)\)\) \{[\s\S]*?abortInterruptedExactAfterSettleRefresh\(`\$\{label\}-identity-mismatch`, generation\);/.test(exactSchedulerSource)
        && /function completeScheduledExactAfterSettleRefreshPlan\(generation, plan, passStartedAt\) \{[\s\S]*?if \(!isExactAfterSettleIdentityCurrent\(controller\)\) \{[\s\S]*?return abortInterruptedExactAfterSettleRefresh\("pass-complete-identity-mismatch", generation\);/.test(exactSchedulerSource)
        && /function finalizePendingExactAfterSettleRefreshAfterPaint\(\) \{[\s\S]*?if \(!isExactAfterSettleIdentityCurrent\(controller\)\) \{[\s\S]*?return abortInterruptedExactAfterSettleRefresh\("identity-mismatch", generation\);[\s\S]*?if \(!plan \|\| typeof plan !== "object"\) \{[\s\S]*?return abortInterruptedExactAfterSettleRefresh\("missing-plan", generation\);/.test(exactSchedulerSource),
      exactAfterSettleAbortsAwaitingPaintAfterExactComposeFailure:
        /function abortPendingExactAfterSettleRefreshAfterPaint\(reason = "exact-compose-failed"\) \{[\s\S]*?String\(controller\.phase \|\| ""\) !== "awaiting-paint"[\s\S]*?recordRenderPerfMetric\("settleExactRefreshAbortAfterPaintFailure"[\s\S]*?resetExactAfterSettleController\(`abort-\$\{reason\}`, generation\);/.test(exactSchedulerSource)
        && /function abortPendingExactAfterSettleRefreshAfterPaint\(reason = "exact-compose-failed"\) \{[\s\S]*?resetExactAfterSettleController\(`abort-\$\{reason\}`, generation\);[\s\S]*?setDeferExactAfterSettleState\(runtimeState, false\);[\s\S]*?setPendingExactPoliticalFastFrameState\(runtimeState, false\);[\s\S]*?invalidateRenderPasses\("political", "exact-after-settle-abort"\);[\s\S]*?requestRendererRender\("exact-after-settle-abort-recover", \{[\s\S]*?flush: false,[\s\S]*?if \(getContext\(\)\) render\(\);/.test(exactSchedulerSource)
        && /if \(!useTransformedFrame \|\| !drewFrame\) \{[\s\S]*?const activeRenderPassNames = getActiveRenderPassNames\(\);[\s\S]*?drewExactFrame = !!composeCachedPasses\(activeRenderPassNames\);[\s\S]*?if \(!drewExactFrame\) \{[\s\S]*?abortPendingExactAfterSettleRefreshAfterPaint\("compose-cached-passes-failed"\);[\s\S]*?\}/.test(drawCanvasOrchestrationOwnerSource)
        && /function isInteractionRecoveryBlocked\(\) \{[\s\S]*?isExactAfterSettleControllerActive\(\)/.test(rendererSource),
      exactComposeFailureReportsControllerAndMissingPassContext:
        /function composeCachedPasses\(passNames, currentTransform = runtimeState\.zoomTransform \|\| globalThis\.d3\.zoomIdentity\) \{[\s\S]*?recordRenderPerfMetric\("compositeBufferMissingPass", 0, \{[\s\S]*?missingPassNames:[\s\S]*?controllerPhase:[\s\S]*?deferExactAfterSettle:[\s\S]*?\}\);/.test(rendererSource)
        && /function composeRenderPassesToTarget\([\s\S]*?const missingCanvasPassNames = \[\];[\s\S]*?const missingReferenceTransformPassNames = \[\];[\s\S]*?reason: "missing-pass-canvas"[\s\S]*?missingPassNames: missingCanvasPassNames[\s\S]*?reason: "missing-reference-transform"[\s\S]*?missingPassNames: missingReferenceTransformPassNames/.test(cachedPassCompositorOwnerSource),
      interactionRecoveryDoesNotSelfBlockPostReadyTask:
        interactionRecoveryBlockedBody.includes("runtimeState.renderPhase !== RENDER_PHASE_IDLE")
        && interactionRecoveryBlockedBody.includes("runtimeState.isInteracting")
        && interactionRecoveryBlockedBody.includes("isExactAfterSettleControllerActive()")
        && interactionRecoveryBlockedBody.includes("activeInteractionRecoveryTaskKey")
        && !interactionRecoveryBlockedBody.includes("activePostReadyTaskKey"),
      interactionRecoveryMetricsNameTaskAndWindow:
        /function recordInteractionRecoveryTaskMetric\(taskKey, durationMs, details = \{\}, \{ benchmarkInteraction = true \} = \{\}\) \{[\s\S]*?taskMetricName = benchmarkInteraction \? "interactionRecoveryTaskMs"[\s\S]*?windowMetricName = benchmarkInteraction \? "interactionRecoveryWindowMs"/.test(rendererSource)
        && /const taskKey = "scenario-chunk-promotion-infra";[\s\S]*?recordInteractionRecoveryTaskMetric\(taskKey,/.test(scenarioRefreshRuntimeSource)
        && /const taskKey = "secondary-spatial-index";[\s\S]*?recordInteractionRecoveryTaskMetric\(taskKey,/.test(rendererSource)
        && /const taskKey = "deferred-heavy-border-meshes";[\s\S]*?recordInteractionRecoveryTaskMetric\(taskKey,/.test(staticBorderMeshLifecycleSource),
      hoverStrictHitUsesFirstContainingFastPath:
        /function findFirstContainingCandidate\([\s\S]*?eventType = "hover",[\s\S]*?targetType = "unknown",[\s\S]*?fastPath: "hover-first-containing"/.test(interactionHitCandidateSource)
        && /function findFirstContainingCandidate\(candidates, lonLat,[\s\S]*?findFirstContainingHitCandidate\(candidates, lonLat,[\s\S]*?recordInteractionDurationMetric,/.test(rendererSource)
        && /eventType === "hover" && !enableSnap[\s\S]*?findFirstContainingCandidate\(strictCandidates, pointer\.lonLat, \{ eventType, targetType: "land" \}\)/.test(rendererSource),
      exactAfterSettleRefreshLeavesContextScenarioOutsidePhysicalRefreshPasses:
        /function getPhysicalExactRefreshPasses\(\) \{[\s\S]*?\["physicalBase", "political", "contextBase", "borders"\][\s\S]*?\["political", "contextBase", "borders"\][\s\S]*?return passes;[\s\S]*?\}/.test(rendererSource)
        && /function applyExactAfterSettleRefreshPlan[\s\S]*?invalidateRenderPasses\(\["physicalBase", "contextBase"\], "physical-visible-exact"\);[\s\S]*?invalidateRenderPasses\(getPhysicalExactRefreshPasses\(\), reuseDecision\.reason \|\| "context-base-exact"\);/.test(exactSchedulerSource),
      politicalSceneReadinessCountsRuntimeColors:
        /function getResolvedColorCountForSceneSnapshot\(\) \{[\s\S]*?const colorSource = runtimeState\.colors[\s\S]*?const colorRevision = Number\(runtimeState\.colorRevision \|\| 0\);[\s\S]*?resolvedColorCountSnapshot\.count = Object\.keys\(colorSource\)\.length;/.test(rendererSource)
        && !/function getResolvedColorCountForSceneSnapshot\(\) \{[\s\S]*?runtimeState\.resolvedColors/.test(rendererSource),
      stableVisibleFrameEnsuresResolvedColorsBeforeDraw:
        /function ensureResolvedColorsReadyForStableVisibleFrame\(reason = "visible-frame"\) \{[\s\S]*?const colorSourceName = getResolvedColorSourceName\(\);[\s\S]*?const colorSourceFeatureCount = getResolvedColorSourceFeatures\(\)\.length;[\s\S]*?Object\.keys\(runtimeState\.colors \|\| \{\}\)\.length > 0[\s\S]*?colorSourceName,[\s\S]*?colorSourceFeatureCount,[\s\S]*?rebuildResolvedColors\(\)[\s\S]*?recordRenderPerfMetric\("visibleFrameResolvedColorReadiness"[\s\S]*?sourceFeatureCount: colorSourceFeatureCount,[\s\S]*?sourceName: colorSourceName,/.test(rendererSource)
        && /function render\(\) \{[\s\S]*?ensureResolvedColorsReadyForStableVisibleFrame\("render"\);[\s\S]*?drawCanvas\(\);/.test(rendererSource),
      politicalFeatureFillUsesExplicitSafeFallback:
        /function getPoliticalFeatureFillColor\(feature, id, index, canvasWidth = 0\) \{[\s\S]*?getSafeCanvasColor\(state\.colors\[id\], null\)[\s\S]*?getSafeCanvasColor\(helper\.getResolvedFeatureColor\(feature, id\), null\)[\s\S]*?\|\| landFillColor/.test(politicalPartialOwnerSource)
        && /function drawPoliticalFeature\([\s\S]*?let fillColor = getPoliticalFeatureFillColor\(feature, id, index, canvasWidth\);[\s\S]*?const context = surface\.getContext\(\);[\s\S]*?context\.fillStyle = fillColor;/.test(politicalPartialOwnerSource),
      colorRefreshUsesPartialPoliticalInvalidation:
        /function refreshResolvedColorsForFeatures[\s\S]*?const pendingRenderIds = new Set\(\);[\s\S]*?normalizePoliticalColorEditIds\(cache\.pendingPoliticalColorEditIds\)[\s\S]*?pendingRenderIds\.add\(pendingId\);[\s\S]*?cache\.partialPoliticalDirtyIds\.add\(id\);[\s\S]*?pendingRenderIds\.add\(id\);[\s\S]*?bumpColorRevision\(state\);[\s\S]*?markPendingPoliticalColorEdit\(Array\.from\(pendingRenderIds\), \{[\s\S]*?startedAt: inputStartedAt,[\s\S]*?inputLabel,[\s\S]*?\}\)[\s\S]*?clearPendingPoliticalColorEdit\(\{ force: true \}\);[\s\S]*?invalidateRenderPasses\("political", "refresh-colors"\);/.test(rendererSource)
        && rendererSource.includes('invalidateRenderPasses(["contextMarkers", "labels"], "refresh-colors-collateral");')
        && rendererSource.includes('invalidateRenderPasses("contextBase", "refresh-colors-context-base");')
        && /function markPendingPoliticalColorEdit\(featureIds,[\s\S]*?cache\.pendingPoliticalColorEditIds = new Set\(ids\);[\s\S]*?cache\.pendingPoliticalColorEditRevision = Number\(runtimeState\.colorRevision \|\| 0\);/.test(rendererSource)
        && rendererSource.includes('cache.pendingPoliticalColorEditScenarioId = String(runtimeState.activeScenarioId || "");')
        && /function hasPendingPoliticalColorEdit\(\) \{[\s\S]*?pendingIds instanceof Set[\s\S]*?Number\(cache\.pendingPoliticalColorEditRevision \?\? -1\) === Number\(runtimeState\.colorRevision \|\| 0\)/.test(rendererSource)
        && /function clearPendingPoliticalColorEdit\(\{[\s\S]*?renderedCount = 0,[\s\S]*?renderedIds = null,[\s\S]*?force = false,[\s\S]*?paintSource = "political-pass"[\s\S]*?\} = \{\}\) \{[\s\S]*?const hasRenderedIdScope = renderedIds !== null && renderedIds !== undefined;[\s\S]*?renderedIdList\.forEach\(\(id\) => pendingIds\.delete\(id\)\);[\s\S]*?if \(pendingIds\.size > 0\) return false;/.test(rendererSource)
        && /function recordFillPatchFirstPixelMetric\(\{[\s\S]*?recordRenderPerfMetric\("fillPatchInputToFirstPixelMs"/.test(rendererSource)
        && /function shouldRefreshContextBaseContoursForColorChanges\(\) \{[\s\S]*?runtimeState\.showPhysical[\s\S]*?physicalContourMajorData/.test(rendererSource)
        && /if \(passName === "contextBase"\) \{[\s\S]*?`context-colors:\$\{shouldRefreshContextBaseForColorChanges\(\) \? Number\(runtimeState\.colorRevision \|\| 0\) : 0\}`/.test(renderPassSignatureSource)
        && !contextScenarioSignatureBranch.includes("`colors:${Number(runtimeState.colorRevision || 0)}`")
        && /if \(passName === "labels"\) \{[\s\S]*?getUrbanCityRenderPassSignatureParts\(runtimeState, "labels"\)/.test(renderPassSignatureSource)
        && /const sharedTail = \[[\s\S]*?`colors:\$\{Number\(state\?\.colorRevision \|\| 0\)\}`[\s\S]*?\];/.test(urbanCityPolicySource)
        && /if \(passName === "labels"\) \{[\s\S]*?return \[[\s\S]*?strategic, \.\.\.sharedTail\];/.test(urbanCityPolicySource),
      partialPoliticalRepaintOnlyAcceptsTargetedRefreshColors:
        /function tryPartialPoliticalPassRepaint\(transform, nextSignature, timings\) \{[\s\S]*?String\(cache\.reasons\?\.political \|\| ""\) !== "refresh-colors"[\s\S]*?return fallback\("non-color-invalidation"\);/.test(politicalPartialOwnerSource)
        && !politicalPartialOwnerSource.includes('["refresh-colors", "rebuild-colors"].includes(String(cache.reasons?.political || ""))')
        && !politicalPartialOwnerSource.includes('!["refresh-colors", "rebuild-colors"].includes(String(reason || "unspecified"))'),
      progressiveRecoveryKeepsFineLoopForVisibleColorOverrides:
        /function hasVisiblePoliticalForegroundColorOverride\(entries = \[\]\) \{[\s\S]*?hasPoliticalForegroundColorOverride\(featureId\);[\s\S]*?\}/.test(politicalFeaturePolicySource)
        && /const progressiveRecoveryCoarseSkipCandidate = \([\s\S]*?!pendingPoliticalColorEdit[\s\S]*?\);[\s\S]*?const visiblePoliticalForegroundColorOverride = progressiveRecoveryCoarseSkipCandidate[\s\S]*?hasVisiblePoliticalForegroundColorOverride\(viewport\.visibleItems\)[\s\S]*?if \(progressiveRecoveryCoarseSkipCandidate && !visiblePoliticalForegroundColorOverride\)/.test(politicalPassOwnerSource),
      politicalPathCachePreservesTargetedColorAndDeferredFullCacheReady:
        /const POLITICAL_PATH_CACHE_PRESERVING_INVALIDATION_REASONS = new Set\(\[[\s\S]*?"refresh-colors"[\s\S]*?"progressive-political-full-cache-ready"[\s\S]*?\]\);/.test(rendererSource)
        && /function applyRenderPassInvalidationEffects\(mutation = \{\}\) \{[\s\S]*?hostFollowUps\.needsPoliticalPathCacheInvalidation[\s\S]*?!POLITICAL_PATH_CACHE_PRESERVING_INVALIDATION_REASONS\.has\(String\(reason \|\| "unspecified"\)\)[\s\S]*?cache\.partialPoliticalDirtyIds\.clear\(\);[\s\S]*?cancelScenarioPoliticalBackgroundDeferredFullCache/.test(applyRenderPassInvalidationEffectsBody)
        && !/pendingPoliticalColorEditIds\.clear\(\)/.test(applyRenderPassInvalidationEffectsBody)
        && /function rebuildResolvedColors\(\) \{[\s\S]*?const previousColorRevision = Number\(runtimeState\.colorRevision \|\| 0\);[\s\S]*?bumpColorRevision\(state\);[\s\S]*?retargetPendingPoliticalColorEditRevisionAfterColorRebuild\(previousColorRevision\);[\s\S]*?invalidateRenderPasses\(\["physicalBase", "political", "contextBase"\], "rebuild-colors"\);/.test(rendererSource)
        && /function retargetPendingPoliticalColorEditRevisionAfterColorRebuild\(previousColorRevision\) \{[\s\S]*?pendingScenarioId && pendingScenarioId !== activeScenarioId[\s\S]*?clearPendingPoliticalColorEdit\(\{[\s\S]*?force: true,[\s\S]*?resetReason: "stale-scenario-color-rebuild",[\s\S]*?paintSource: "color-rebuild",[\s\S]*?\}\);[\s\S]*?cache\.pendingPoliticalColorEditRevision = currentRevision;/.test(rendererSource)
        && /function setMapData\(\{[\s\S]*?return getSetMapDataTransactionOwner\(\)\.runSetMapDataTransaction\(\{/.test(rendererSource)
        && /function runSetMapDataTransaction\(options = \{\}\) \{[\s\S]*?runEffect\("clearPendingPoliticalColorEdit", \{[\s\S]*?force: true,[\s\S]*?resetReason: SET_MAP_DATA_REASON,[\s\S]*?paintSource: SET_MAP_DATA_REASON,[\s\S]*?\}\);[\s\S]*?runEffect\("clearRenderPassReferenceTransforms"\);[\s\S]*?runEffect\("clearLastGoodFrame", SET_MAP_DATA_REASON\);/.test(setMapDataTransactionOwnerSource),
      politicalFullReferenceOnlyWrittenByFullPass:
        (() => {
          const body = renderPassCommitAccountingOwnerSource.match(/function commitRenderPass\(\{[\s\S]*?\r?\n  \}\r?\n\r?\n  return Object\.freeze/)?.[0] || "";
          return body.includes("runEffect(trace, \"setPassReferenceTransform\", normalizedPassName, transform);")
            && /if \(normalizedPassName === "political"\) \{[\s\S]*?if \(politicalFineCacheReady\) \{[\s\S]*?runEffect\(trace, "setPassFullReferenceTransform", normalizedPassName, transform\);[\s\S]*?\} else \{[\s\S]*?runEffect\(trace, "clearPassFullReferenceTransforms", \[normalizedPassName\]\);[\s\S]*?\}/.test(body)
            && (body.match(/"setPassFullReferenceTransform"/g) || []).length === 1
            && !/if \(normalizedPassName !== "political"\)[\s\S]*?setPassFullReferenceTransform/.test(body);
        })(),
      politicalPartialRequiresFullReferenceBaseline:
        /function tryPartialPoliticalPassRepaint\(transform, nextSignature, timings\) \{[\s\S]*?hasPassFullReferenceTransform\("political"\)[\s\S]*?fallback\("missing-full-reference-transform"\)[\s\S]*?getPassFullReferenceTransform\("political"\)[\s\S]*?fallback\("full-reference-transform-mismatch"\)/.test(politicalPartialOwnerSource),
      politicalPartialNeverMutatesFullReferenceBaseline:
        [
          "function tryPartialPoliticalPassRepaint(transform, nextSignature, timings)",
          'setPassReferenceTransform("political", transform);',
          "setPassFullReferenceTransform(passName, transform);",
          'if (passName === "political")',
        ].every((snippet) => rendererSource.includes(snippet) || politicalPartialOwnerSource.includes(snippet))
        && !politicalPartialOwnerSource.includes('setPassFullReferenceTransform("political"'),
      canvasResizeClearsFullReferenceBaseline:
        [
          "targetPassesOnDprChange = null",
          "targetPassesOnResize = null",
          "targetPassesOnCanvasResize = null",
          "const resizeInvalidationPasses = Array.isArray(targetPassesOnResize) && targetPassesOnResize.length",
          "const dprInvalidationPasses = Array.isArray(targetPassesOnDprChange) && targetPassesOnDprChange.length",
          "const invalidationPasses = sizeChanged ? resizeInvalidationPasses : dprInvalidationPasses;",
          "const canvasResizePasses = Array.isArray(targetPassesOnCanvasResize) && targetPassesOnCanvasResize.length",
          "resizeRenderPassCanvases(canvasResizePasses);",
          "invalidateRenderPasses(resizeInvalidationPasses, reason || \"resize\");",
          "clearRenderPassReferenceTransforms(resizeInvalidationPasses);",
          "invalidateRenderPasses(dprInvalidationPasses, reason || \"dpr-change\");",
          "clearRenderPassReferenceTransforms(dprInvalidationPasses);",
        ].every((snippet) => rendererSource.includes(snippet))
        && /function ensureRenderPassCanvas\(passName\) \{[\s\S]*?resizeRenderPassCanvases\(\[passName\]\);[\s\S]*?return cache\.canvases\[passName\];/.test(renderCacheOwnerSource),
      firstBatchInteractionWritesUseRafRenderBoundary:
        /function requestInteractionRender\(reason = "interaction"\) \{[\s\S]*?getRenderRequestBoundaryOwner\(\)\.requestInteractionRenderBoundary\(reason\)\.completed;/.test(rendererSource)
        && renderRequestBoundaryOwnerSource.includes("requestInteractionRenderBoundary")
        && renderRequestBoundaryOwnerSource.includes("effectApi.requestRender(normalizedReason)")
        && renderRequestBoundaryOwnerSource.includes("options: { flush: false, interaction: true }")
        && !scenarioOwnershipEditorSource.includes("flushRenderBoundary")
        && /function requestScenarioOwnershipRender\(reason = "scenario-ownership"\) \{[\s\S]*?requestInteractionRender\(reason\);/.test(scenarioOwnershipEditorSource)
        && scenarioOwnershipEditorSource.includes('requestScenarioOwnershipRender("scenario-ownership-apply-owner");')
        && scenarioOwnershipEditorSource.includes('requestScenarioOwnershipRender("scenario-ownership-reset-baseline");')
        && scenarioOwnershipEditorSource.includes('requestScenarioOwnershipRender("scenario-ownership-apply-owner-controller");')
        && /function handleBrushPointerMove[\s\S]*?requestInteractionRender\("brush-preview"\);/.test(brushInteractionSessionOwnerSource)
        && /function addFeatureToDevSelection[\s\S]*?requestInteractionRender\("dev-selection-add"\);/.test(rendererSource)
        && /function toggleFeatureInDevSelection[\s\S]*?requestInteractionRender\("dev-selection-toggle"\);/.test(rendererSource)
        && /function setDevSelectionDirty\(\)[\s\S]*?runtimeState\.refreshCountryListRowsFn\(\{[\s\S]*?refreshInspector: true,[\s\S]*?refreshPresetTree: true,[\s\S]*?\}\);/.test(rendererSource)
        && /function syncInspectorCountryToLandSelection[\s\S]*?runtimeState\.selectedInspectorCountryCode = nextCode;[\s\S]*?refreshPresetTree: true/.test(rendererSource)
        && /if \(decision\.devSelectionRequested\) \{[\s\S]*?toggleFeatureInDevSelection\(landId\);[\s\S]*?syncInspectorCountryToLandSelection\(feature, landId, landHit\);/.test(clickSelectionTransactionOwnerSource)
        && !rendererSource.includes("runtimeState.devSelectionModeEnabled && (event?.ctrlKey || event?.metaKey)")
        && /function removeLastDevSelection[\s\S]*?requestInteractionRender\("dev-selection-remove-last"\);/.test(rendererSource)
        && /function clearDevSelection[\s\S]*?requestInteractionRender\("dev-selection-clear"\);/.test(rendererSource)
        && /function applyVisualSubdivisionFill[\s\S]*?requestInteractionRender\(kind\);[\s\S]*?refreshSidebarAfterPaint\(\{ featureIds: resolvedIds \}\);/.test(rendererSource)
        && /function applyWaterRegionFill[\s\S]*?requestInteractionRender\(kind\);[\s\S]*?refreshSidebarAfterPaint\(\{ waterRegionIds: \[resolvedId\] \}\);/.test(rendererSource)
        && /function applyWaterRegionFill[\s\S]*?if \(currentColor === color\) \{[\s\S]*?refreshWaterRegionSidebarRowsNow\(\[resolvedId\]\);[\s\S]*?requestInteractionRender\(kind\);[\s\S]*?return false;/.test(rendererSource)
        && !rendererSource.includes('flushInteractionRender("dev-selection-add")')
        && !rendererSource.includes('flushInteractionRender("dev-selection-toggle")')
        && !rendererSource.includes('flushInteractionRender("dev-selection-remove-last")')
        && !rendererSource.includes('flushInteractionRender("dev-selection-clear")')
        && !rendererSource.includes('flushInteractionRender("click-fill")')
        && !rendererSource.includes('flushInteractionRender("click-erase")')
        && !rendererSource.includes('flushInteractionRender(kind);'),
      exactAfterSettleDefersContextPassesAfterCriticalPaint:
        exactAfterSettlePlansSource.includes("from \"../renderer/exact_after_settle_pass_catalog.js\";")
        && exactAfterSettlePassCatalogSource.includes("export const EXACT_AFTER_SETTLE_DEFERRED_PASS_NAMES = new Set")
        && rendererSource.includes("const DEFERRED_EXACT_CONTEXT_REFRESH_DELAY_MS = 3600;")
        && rendererSource.includes('"contextBase",')
        && rendererSource.includes('"contextScenario",')
        && (() => {
          const deferredPassSet = exactAfterSettlePassCatalogSource.match(/export const EXACT_AFTER_SETTLE_DEFERRED_PASS_NAMES = new Set\(\[[\s\S]*?\]\);/)?.[0] || "";
          return !deferredPassSet.includes('"background"') && !deferredPassSet.includes('"physicalBase"');
        })()
        && /function shouldDeferExactAfterSettlePassForCriticalPaint\(passName, cache = getRenderPassCacheState\(\)\) \{[\s\S]*?String\(controller\.phase \|\| ""\) !== "awaiting-paint"[\s\S]*?getPassReferenceTransform\(passName\)/.test(renderPipelinePassesSource)
        && /function prepareIdleRenderPassDefinition[\s\S]*?shouldDeferExactAfterSettlePassForCriticalPaint\(passName, cache\)[\s\S]*?recordRenderPerfMetric\("settleExactRefreshDeferredPass"/.test(renderPipelinePassesSource)
        && /function applyExactAfterSettleRefreshPlan[\s\S]*?resolveExactAfterSettleTargetPasses[\s\S]*?return \{[\s\S]*?\.\.\.plan,[\s\S]*?deferredExactTargetPasses: targetPassPlan\.deferredExactTargetPasses,[\s\S]*?exactTargetPasses: targetPassPlan\.exactTargetPasses/.test(exactSchedulerSource)
        && /function scheduleDeferredExactContextRefresh\(plan = \{\}\)[\s\S]*?prepareDeferredExactContextPassesInSlices[\s\S]*?recordRenderPerfMetric\("deferredExactContextRefreshScheduled"/.test(exactSchedulerSource)
        && exactSchedulerSource.includes("let deferredExactContextRefreshVersion = 0;")
        && exactSchedulerSource.includes("const deferredExactContextRefreshTaskHandles = new Set();")
        && /function cancelDeferredExactContextRefresh\(\) \{[\s\S]*?deferredExactContextRefreshVersion \+= 1;[\s\S]*?deferredExactContextRefreshTaskHandles\.forEach[\s\S]*?handle\.cancel\(\);[\s\S]*?deferredExactContextRefreshTaskHandles\.clear\(\);/.test(exactSchedulerSource)
        && /function isDeferredExactContextRefreshCurrent\(refreshVersion, plan = \{\}\) \{[\s\S]*?deferredExactContextRefreshVersion[\s\S]*?isExactAfterSettleIdentityCurrent\(identity\)/.test(exactSchedulerSource)
        && /function prepareDeferredExactContextPassesInSlices\(passNames, plan = \{\}, refreshVersion = deferredExactContextRefreshVersion\) \{[\s\S]*?!isDeferredExactContextRefreshCurrent\(refreshVersion, plan\)[\s\S]*?deferredExactContextRefreshTaskHandles\.delete\(taskHandle\)[\s\S]*?getRenderPipelinePassesOwner\(\)\.prepareIdleRenderPassDefinition\(passName, drawFn, transform, timings, cache\)/.test(exactSchedulerSource)
        && /function scheduleDeferredExactContextRefresh\(plan = \{\}\) \{[\s\S]*?const refreshVersion = Number\(deferredExactContextRefreshVersion \|\| 0\);[\s\S]*?const scheduledPlan = plan\.deferredExactContextIdentity[\s\S]*?deferredExactContextIdentity: getExactAfterSettleIdentity\(\),[\s\S]*?!isDeferredExactContextRefreshCurrent\(refreshVersion, scheduledPlan\)[\s\S]*?prepareDeferredExactContextPassesInSlices\(targetPasses, scheduledPlan, refreshVersion\)[\s\S]*?timeout: exactContextRefreshDelayMs/.test(exactSchedulerSource),
      exactAfterSettleUsesFrameScheduler:
        frameSchedulerSource.includes("export function enqueueFrameTask")
        && /import \{ enqueueFrameTask(?:, getFrameSchedulerQueueLength)? \} from "\.\/frame_scheduler\.js";/.test(rendererSource)
        && /function enqueueExactAfterSettleSegment\(generation, label, task\) \{[\s\S]*?enqueueFrameTask/.test(exactSchedulerSource)
        && /scheduleExactAfterSettleRefresh[\s\S]*?enqueueExactAfterSettleSegment\(generation, "Prepare"[\s\S]*?enqueueExactAfterSettleSegment\(generation, "Apply"/.test(exactSchedulerSource),
      exactAfterSettleWaitsForRefreshStartedChunkWork:
        renderPhaseLifecycleOwnerSource.includes("const PROMOTION_ACTIVE_STATUSES = Object.freeze([")
        && renderPhaseLifecycleOwnerSource.includes("\"promotion-scheduled\"")
        && renderPhaseLifecycleOwnerSource.includes("\"refresh-started\"")
        && /const pendingChunkRefreshStatus = runEffect\([\s\S]*?"scheduleScenarioChunkRefresh", \{/.test(renderPhaseLifecycleOwnerSource)
        && /const promotionWorkActive = PROMOTION_ACTIVE_STATUSES\.includes\(String\(pendingChunkRefreshStatus \|\| ""\)\);/.test(renderPhaseLifecycleOwnerSource)
        && /if \(promotionWorkActive\) return;/.test(renderPhaseLifecycleOwnerSource),
      frameSchedulerQueueMetricsReportedPerPriority:
        frameSchedulerSource.includes("HIGH_PRIORITY_MIN_PER_DRAIN = 1")
        && frameSchedulerSource.includes("byLabelGeneration = false")
        && frameSchedulerSource.includes("labelGenerationKey")
        && /export function getFrameSchedulerQueueLength\(\{ byPriority = false, byLabelGeneration = false \} = \{\}\) \{[\s\S]*?high:[\s\S]*?normal:[\s\S]*?low:[\s\S]*?total:/.test(frameSchedulerSource)
        && /function render\(\) \{[\s\S]*?getFrameSchedulerQueueLength\(\{ byPriority: true, byLabelGeneration: true \}\);[\s\S]*?recordRenderPerfMetric\("frameSchedulerQueueDepth", 0, frameSchedulerQueue\);/.test(rendererSource),
      deferredUiYieldPrefersSchedulerYield:
        /export async function yieldToMain\(\{ globalScope = globalThis \} = \{\}\) \{[\s\S]*?typeof globalScope\?\.scheduler\?\.yield === "function"[\s\S]*?await globalScope\.scheduler\.yield\(\);[\s\S]*?getTimeoutFn\(globalScope\)\(resolve, 0\);/.test(deferredUiBootstrapSource)
        && !/async function yieldToMain\(/.test(mainSource),
      exactAfterSettleDedupesByGeneration:
        /function enqueueExactAfterSettleSegment\(generation, label, task\) \{[\s\S]*?generation,[\s\S]*?dedupe: true,[\s\S]*?deferOnContinuousInput: false/.test(exactSchedulerSource)
        && /label: `exact-after-settle-pass-\$\{passName\}`,[\s\S]*?generation,[\s\S]*?dedupe: true,[\s\S]*?deferOnContinuousInput: false/.test(exactSchedulerSource)
        && /priority: "high",[\s\S]*?label: `deferred-exact-context-pass-\$\{passName\}`,[\s\S]*?generation: Number\(plan\.controllerGeneration \|\| 0\),[\s\S]*?dedupe: true,[\s\S]*?deferOnContinuousInput: false/.test(exactSchedulerSource),
      buildHitCanvasReportsVisibleAndGridCandidateCounts:
        rendererSource.includes("lastHitCanvasBuildStats")
        && rendererSource.includes("HIT_CANVAS_VIEWPORT_OVERSCAN_PX")
        && /const visibleSpatialItemsResult = collectVisibleLandSpatialItemsWithStats\(\{[\s\S]*?overscanPx: HIT_CANVAS_VIEWPORT_OVERSCAN_PX,[\s\S]*?\}\);/.test(rendererSource)
        && rendererSource.includes("visibleItemCount")
        && spatialQueryIndexSource.includes("cellCandidateCount")
        && spatialQueryIndexSource.includes("globalCandidateCount")
        && rendererSource.includes("globalCount")
        && spatialQueryIndexSource.includes("cellSpan"),
      dirtyHitCanvasUsesPointProbeBeforeDeferredFullBuild:
        /function getDirtyHitCanvasPointProbeHit\(event\) \{[\s\S]*?collectGridCandidates\(projectedX, projectedY, 0\)[\s\S]*?rendererSurfaceHost\.getHitContext\(\)\.rect\(px - 1, py - 1, 3, 3\);[\s\S]*?rendererSurfaceHost\.getHitContext\(\)\.clip\(\);[\s\S]*?recordRenderPerfMetric\("hitCanvasPointProbe"[\s\S]*?recordRenderPerfMetric\("hitCanvasViewportProfile"[\s\S]*?profile: "point-probe"/.test(rendererSource)
        && /function getValidatedCanvasHit\(event, strictIds = null, \{ forceBuild = false \} = \{\}\) \{[\s\S]*?if \(isHitCanvasCurrent\(\)\) \{[\s\S]*?getHitResultFromCanvas\(event\)[\s\S]*?\} else \{[\s\S]*?scheduleHitCanvasBuildIfNeeded\(\{ reason: forceBuild \? "dirty-point-probe-click" : "dirty-point-probe-hover" \}\);[\s\S]*?getDirtyHitCanvasPointProbeHit\(event\);/.test(rendererSource),
      startupHitCanvasFullBuildIsDeferred:
        /function recordDeferredFullHitCanvasMetric\(\{ reason = "deferred-full", keepReady = false \} = \{\}\) \{[\s\S]*?mode: "deferred-full"[\s\S]*?reason,[\s\S]*?recordRenderPerfMetric\("hitCanvasViewportProfile"[\s\S]*?profile: "deferred-full"/.test(rendererSource)
        && /async function buildHitCanvasAfterStartup\(\{ keepReady = false, reason = "startup-deferred-hit-canvas" \} = \{\}\) \{[\s\S]*?recordDeferredFullHitCanvasMetric\(\{[\s\S]*?reason,[\s\S]*?keepReady[\s\S]*?\}\);[\s\S]*?setInteractionInfrastructureState\("hit-canvas-deferred"/.test(rendererSource)
        && !/async function buildHitCanvasAfterStartup\(\{[\s\S]*?ensureHitCanvasUpToDate\(\{ force: true \}\);[\s\S]*?\n\}/.test(rendererSource),
      stagedHitCanvasWarmupDefersFullBuild:
        /function scheduleStagedHitCanvasWarmup\(startedAt, token\) \{[\s\S]*?recordDeferredFullHitCanvasMetric\(\{[\s\S]*?reason: "staged-hit-canvas-warmup"[\s\S]*?recordRenderPerfMetric\("setMapDataHitCanvasReady"/.test(rendererSource)
        && !/function scheduleStagedHitCanvasWarmup\(startedAt, token\) \{[\s\S]*?ensureHitCanvasUpToDate\(\{ force: true \}\);/.test(rendererSource),
      buildHitCanvasMetricsSeparateDeferredForcedAndPointProbe:
        /drawHitCanvasWithMetric\(\{[\s\S]*?mode: "deferred",[\s\S]*?reason,/.test(rendererSource)
        && /drawHitCanvasWithMetric\(\{[\s\S]*?mode: "forced",[\s\S]*?reason: "strict-validation"/.test(rendererSource)
        && /recordDeferredFullHitCanvasMetric\(\{[\s\S]*?mode: "deferred-full"[\s\S]*?profile: "deferred-full"/.test(rendererSource)
        && /recordRenderPerfMetric\("hitCanvasPointProbe"[\s\S]*?recordRenderPerfMetric\("hitCanvasViewportProfile"[\s\S]*?profile: "point-probe"/.test(rendererSource),
      hitCanvasPixelReadsUseFiniteDpr:
        /function getHitResultFromCanvas\(event\) \{[\s\S]*?const dpr = Number\.isFinite\(Number\(runtimeState\.dpr\)\) && Number\(runtimeState\.dpr\) > 0[\s\S]*?Math\.round\(sx \* dpr\)[\s\S]*?Math\.round\(sy \* dpr\)/.test(rendererSource)
        && /function getDirtyHitCanvasPointProbeHit\(event\) \{[\s\S]*?const dpr = Number\.isFinite\(Number\(runtimeState\.dpr\)\) && Number\(runtimeState\.dpr\) > 0[\s\S]*?Math\.round\(sx \* dpr\)[\s\S]*?rendererSurfaceHost\.getHitContext\(\)\.setTransform\(dpr, 0, 0, dpr, 0, 0\);/.test(rendererSource),
      chunkPromotionReportsPrimaryAndDeferredStageMetrics:
        scenarioRefreshRuntimeSource.includes('recordRenderPerfMetric("chunkPromotionPrimaryRefreshMs"')
        && scenarioRefreshRuntimeSource.includes('recordRenderPerfMetric("chunkPromotionDeferredInfraMs"')
        && scenarioRefreshRuntimeSource.includes("promotedVisibleFeatureCount")
        && scenarioRefreshRuntimeSource.includes("promotedTotalFeatureCount")
        && scenarioRefreshRuntimeSource.includes("readFirstNonNegativeCount")
        && chunkPromotionHelperSource.includes("fullPoliticalPayloadFeatureCount")
        && chunkPromotionHelperSource.includes("viewportVisibleSubsetFeatureCount")
        && /function buildScenarioChunkPromotionVisualMetricDetails\(\{[\s\S]*?selectedByteCountSum[\s\S]*?selectedEstimatedPathCostSum/.test(chunkPromotionHelperSource)
        && /const promotionMetricDetails = buildScenarioChunkPromotionVisualMetricDetails\(\{[\s\S]*?recordRenderPerfMetric\("scenarioChunkPromotionVisualStage", visualDurationMs, \{[\s\S]*?\.\.\.promotionMetricDetails/.test(scenarioRefreshRuntimeSource)
        && /recordScenarioRenderMetric\("politicalChunkPromotionMs"[\s\S]*?promotedVisibleFeatureCount:[\s\S]*?promotedTotalFeatureCount:[\s\S]*?primaryVisibleFeatureCount:[\s\S]*?primaryTotalFeatureCount:/.test(chunkRuntimeSource)
        && /function buildInitialScenarioChunkVisualPromotionResult[\s\S]*?scenarioPoliticalVisibleFeatureCount[\s\S]*?promotedVisibleFeatureCount: scenarioPoliticalVisibleFeatureCount,[\s\S]*?promotedTotalFeatureCount: scenarioPoliticalChunkFeatureCount/.test(chunkRuntimeSource)
        && /const ready = !!\([\s\S]*?scenarioPoliticalChunkFeatureCount > 0[\s\S]*?landFeatureCount > 0[\s\S]*?colorCount > 0/.test(chunkRuntimeSource)
        && /allowStartupInitialVisual = false,[\s\S]*?shouldForceStartupInitialVisualRefresh = !!allowStartupInitialVisual[\s\S]*?getFeatureCount\(runtimeState\.landData\) <= 0[\s\S]*?getColorCount\(\) <= 0[\s\S]*?forceRefresh: !!pendingPromotion\.primaryVisibleFeatureSubsetChanged \|\| shouldForceStartupInitialVisualRefresh/.test(chunkRuntimeSource)
        && /const pendingVisualPromotion = \{[\s\S]*?selectedFeatureCountSum:[\s\S]*?selectedByteCountSum:[\s\S]*?selectedEstimatedPathCostSum:/.test(chunkRuntimeSource)
        && /const pendingPromotion = \{[\s\S]*?requiredPoliticalChunkCount:[\s\S]*?selectedFeatureCountSum:[\s\S]*?selectedByteCountSum:[\s\S]*?selectedEstimatedPathCostSum:[\s\S]*?queueScenarioChunkPromotionState\(runtimeState, \{[\s\S]*?visualPromotion: pendingVisualPromotion,[\s\S]*?promotion: pendingPromotion,/.test(chunkRuntimeSource),
      deferredInfraRestoresFullPoliticalDerivedStateWhenVisibleSubsetIsActive:
        scenarioRefreshRuntimeSource.includes("function analyzeScenarioPoliticalDerivedStateCoverage(runtimeState)")
        && scenarioRefreshRuntimeSource.includes('recordRenderPerfMetric("scenarioPoliticalDerivedStateCoverage"')
        && scenarioRefreshRuntimeSource.includes("primaryVisibleDerivedStateReady = false")
        && scenarioRefreshRuntimeSource.includes("completePoliticalDerivedStateReady = false")
        && /const shouldRestoreFullPoliticalDerivedState = \([\s\S]*?politicalCoverageBeforeRestore\.completePoliticalFeatureCount > 0[\s\S]*?!resolvedCompletePoliticalDerivedStateReady[\s\S]*?primaryVisibleDerivedStateReady[\s\S]*?primaryVisibleFeatureSubsetActive[\s\S]*?landDataCoverageMissing[\s\S]*?colorCoverageMissing[\s\S]*?\);/.test(scenarioRefreshRuntimeSource)
        && /colorCoverageMissing: !!coverage\.colorCoverageMissing,/.test(scenarioRefreshRuntimeSource)
        && /if \(hasPrimaryVisiblePoliticalSubset \|\| shouldRestoreFullPoliticalDerivedState\) \{[\s\S]*?setScenarioPoliticalChunkPayloadState\(runtimeState, \{ visiblePayload: null \}\);[\s\S]*?\}[\s\S]*?if \(shouldRestoreFullPoliticalDerivedState\) \{/.test(scenarioRefreshRuntimeSource)
        && /if \(shouldRestoreFullPoliticalDerivedState\) \{[\s\S]*?rebuildPoliticalLandCollections\(\);[\s\S]*?rebuildRuntimeDerivedState\(\{[\s\S]*?includeRuntimePoliticalMeta: true,[\s\S]*?includeSecondarySpatial: false,[\s\S]*?\}\);/.test(scenarioRefreshRuntimeSource)
        && /restoredFullPoliticalChunkData = shouldRestoreFullPoliticalDerivedState;/.test(scenarioRefreshRuntimeSource),
      exactAfterSettleDefersPoliticalFastExact:
        /function drawTransformedFrameFromCaches[\s\S]*?settlePoliticalFastExactSkipped[\s\S]*?defer-to-sliced-exact-refresh/.test(transformedFrameCompositorOwnerSource)
        && !/function drawTransformedFrameFromCaches[\s\S]*?renderPassToCache\("political", \(k\) => drawPoliticalPass\(k\)/.test(transformedFrameCompositorOwnerSource),
      transformReusablePassSignaturesUseStableViewportKey:
        renderPassCatalogSource.includes("export const VIEWPORT_STABLE_RENDER_PASS_SIGNATURE_NAMES = new Set")
        && /export const VIEWPORT_STABLE_RENDER_PASS_SIGNATURE_NAMES = new Set\(\[[\s\S]*?"contextBase",[\s\S]*?\]\);/.test(renderPassCatalogSource)
        && (() => {
          const stableSignatureSet = renderPassCatalogSource.match(/export const VIEWPORT_STABLE_RENDER_PASS_SIGNATURE_NAMES = new Set\(\[[\s\S]*?\]\);/)?.[0] || "";
          return [
            '"background"',
            '"physicalBase"',
            '"contextScenario"',
            '"effects"',
            '"lineEffects"',
            '"contextMarkers"',
            '"dayNight"',
          ].every((passName) => !stableSignatureSet.includes(passName));
        })()
        && /function getRenderPassTransformSignature[\s\S]*?VIEWPORT_STABLE_RENDER_PASS_SIGNATURE_NAMES\.has\(passName\)[\s\S]*?shouldEnableContextBaseTransformReuse\(\)[\s\S]*?"transform-reuse"[\s\S]*?getViewportRenderSignature\(\)/.test(renderPassSignatureSource)
        && /if \(passName === "contextScenario"\) \{[\s\S]*?transformSignature,[\s\S]*?`scenario-overlays:\$\{getScenarioOverlaySignatureToken\(\)\}`/.test(renderPassSignatureSource)
        && /function getRenderPassSignature[\s\S]*?const transformSignature = getRenderPassTransformSignature\(passName, transform\);/.test(renderPassSignatureSource),
      continuityFrameReuseIdentityIncludesSelectionAndContextFlags:
        visibleFrameIdentitySource.includes("function getRuntimeChunkSelectionVersion()")
        && visibleFrameIdentitySource.includes("function getVisibleContextFlagSignature()")
        && visibleFrameIdentitySource.includes("function getCommittedFrameIdentity")
        && visibleFrameIdentitySource.includes("function getCommittedFrameKeySignature")
        && /function getVisibleFrameIdentity[\s\S]*?selectionVersion: getRuntimeChunkSelectionVersion\(\)[\s\S]*?contextFlagSignature: getVisibleContextFlagSignature\(\)/.test(visibleFrameIdentitySource)
        && /function getCommittedFrameIdentity[\s\S]*?const commitKey = \{[\s\S]*?scenarioId: identity\.scenarioId[\s\S]*?sceneGeneration: identity\.sceneGeneration[\s\S]*?scenarioDataGeneration: identity\.scenarioDataGeneration[\s\S]*?selectionVersion: identity\.selectionVersion[\s\S]*?topologyRevision: identity\.topologyRevision[\s\S]*?colorRevision: identity\.colorRevision[\s\S]*?contextFlagSignature: identity\.contextFlagSignature[\s\S]*?pixelWidth: identity\.pixelWidth[\s\S]*?pixelHeight: identity\.pixelHeight/.test(visibleFrameIdentitySource)
        && /function recordVisibleFrameTransactionMetric\(status, details = \{\}\) \{[\s\S]*?getVisibleFrameDiagnosticsOwner\(\)\.recordVisibleFrameTransaction\(status, details\)\.metricEntry;/.test(rendererSource)
        && /function recordVisibleFrameTransactionCore[\s\S]*?committedFrameIdentity: providedCommittedFrameIdentity[\s\S]*?getCommittedFrameIdentity[\s\S]*?getCommittedFrameKeySignature[\s\S]*?commitKey: visibleFrameCommitKey[\s\S]*?committedFrameIdentity/.test(visibleFrameDiagnosticsOwnerSource)
        && /function getInteractionCompositeMismatchReasons[\s\S]*?selection-version-mismatch[\s\S]*?context-flag-mismatch[\s\S]*?color-revision-mismatch/.test(renderCacheOwnerSource)
        && /function getInteractionCompositeReuseDecision[\s\S]*?allowSelectionTopologyContinuity[\s\S]*?continuityReasons\.has\(reason\)/.test(renderCacheOwnerSource)
        && /function captureLastGoodFrame[\s\S]*?cache\.lastGoodFrame\.commitKeySignature = getCommittedFrameKeySignature\(identity\)[\s\S]*?cache\.lastGoodFrame\.colorRevision = identity\.colorRevision/.test(rendererSource)
        && /function drawLastGoodFrameFallback[\s\S]*?selection-version-mismatch[\s\S]*?context-flag-mismatch[\s\S]*?color-revision-mismatch[\s\S]*?commit-key-mismatch/.test(rendererSource)
        && rendererRuntimeStateSource.includes("selectionVersion: 0")
        && rendererRuntimeStateSource.includes('contextFlagSignature: ""')
        && rendererRuntimeStateSource.includes("commitKey: null")
        && rendererRuntimeStateSource.includes('commitKeySignature: ""')
        && rendererRuntimeStateSource.includes("committedFrameIdentity: null"),
      exactAfterSettleFreshnessIdentityIncludesContextFlags:
        /function getExactAfterSettleIdentity\(\)[\s\S]*?selectionVersion:[\s\S]*?contextFlagSignature: getVisibleContextFlagSignature\(\)[\s\S]*?transformBucket: getTransformBucketSignature\(\)/.test(exactSchedulerSource)
        && /function assignExactAfterSettleIdentity[\s\S]*?refreshExactAfterSettleControllerIdentityState\(runtimeState, identity\);/.test(exactSchedulerSource)
        && /function isExactAfterSettleIdentityCurrent[\s\S]*?String\(controller\.contextFlagSignature \|\| ""\) === identity\.contextFlagSignature/.test(exactSchedulerSource),
      contextScenarioReuseUsesScenarioDistanceBudget:
        renderTransformReusePolicyOwnerSource.includes("const CONTEXT_SCENARIO_REUSE_MAX_DISTANCE_PX = 960;")
        && renderTransformReusePolicyOwnerSource.includes("const CONTEXT_SCENARIO_REUSE_FRAME_LIMIT = 24;")
        && /function getContextScenarioReuseDecision[\s\S]*?Math\.max\([\s\S]*?getContextBaseReuseMaxDistancePx\(\),[\s\S]*?contextScenarioReuseMaxDistancePx[\s\S]*?\)[\s\S]*?const shouldExactRefresh =[\s\S]*?delta\.distancePx > maxDistancePx[\s\S]*?reachesReuseFrameLimit/.test(renderTransformReusePolicyOwnerSource)
        && rendererSource.includes("return getRenderTransformReusePolicyOwner().getContextScenarioReuseDecision(transform);"),
      settlingFastFrameCanUseDirtyCachedPassesWithoutDirtyComposite:
        /function canDrawTransformedPass\(passName, cache = getRenderPassCacheState\(\), \{ allowDirty = false \} = \{\}\) \{[\s\S]*?cache\.dirty\?\.\[passName\] && !allowDirty/.test(rendererSource)
        && /function canBuildInteractionComposite\(cache = getRenderPassCacheState\(\)\) \{[\s\S]*?canDrawTransformedPass\(passName, cache\)/.test(rendererSource)
        && /function buildInteractionComposite\(currentTransform, timings\) \{[\s\S]*?canBuildInteractionComposite\(getRenderPassCacheState\(\)\)/.test(rendererSource)
        && /function drawTransformedFrameFromCaches[\s\S]*?const allowDirtyFastFrame =[\s\S]*?initialRenderPhase === renderPhaseSettling[\s\S]*?getDeferExactAfterSettle\(\)[\s\S]*?const dirtyFastFramePassNames = allowDirtyFastFrame[\s\S]*?canDrawTransformedPass\(passName, cache, \{[\s\S]*?allowDirty: allowDirtyFastFrame[\s\S]*?const canDrawDirtyInteractionPasses = allowDirtyFastFrame[\s\S]*?allowDirty: true[\s\S]*?buildInteractionComposite\(currentTransform, timings\)[\s\S]*?useInteractionComposite: !canDrawDirtyInteractionPasses/.test(transformedFrameCompositorOwnerSource)
        && /function drawCanvasFrame[\s\S]*?usedDirtyFastFramePasses[\s\S]*?!usedDirtyFastFramePasses[\s\S]*?captureLastGoodFrame[\s\S]*?lastGoodFrameCaptureSkipped/.test(drawCanvasOrchestrationOwnerSource),
      politicalRasterWorkerProtocolDefaultsOff:
        politicalRasterWorkerClientSource.includes("POLITICAL_RASTER_WORKER_PROTOCOL_VERSION = 4")
        && politicalRasterWorkerClientSource.includes("political_raster_worker")
        && politicalRasterWorkerClientSource.includes("political_raster_worker_bitmap")
        && politicalRasterWorkerClientSource.includes("isPoliticalRasterWorkerBitmapEnabled")
        && politicalRasterWorkerClientSource.includes("consumePoliticalRasterWorkerBitmapResult")
        && politicalRasterWorkerClientSource.includes('return { ok: false, reason: "flag-disabled" };')
        && politicalRasterWorkerClientSource.includes('type: "RASTER_POLITICAL_PASS"')
        && politicalRasterWorkerClientSource.includes("isPoliticalRasterWorkerResultCurrent(request, current)")
        && politicalRasterWorkerClientSource.includes("acceptedCount")
        && politicalRasterWorkerClientSource.includes("bitmapAcceptedCount")
        && politicalRasterWorkerClientSource.includes("bitmapRejectedCount")
        && politicalRasterWorkerClientSource.includes("packetBuildMs")
        && politicalRasterWorkerClientSource.includes("rejectedStaleCount")
        && politicalRasterWorkerClientSource.includes("fallbackCount")
        && politicalRasterWorkerClientSource.includes("passSignature")
        && politicalRasterWorkerSource.includes('type: "RASTER_RESULT"')
        && politicalRasterWorkerSource.includes('reason: "metadata-only"')
        && politicalRasterWorkerSource.includes('reason: "bitmap"')
        && politicalRasterWorkerSource.includes("transferToImageBitmap")
        && politicalRasterWorkerSource.includes('type: "ERROR"')
        && politicalRasterWorkerSource.includes("taskId"),
      exactComposeUsesCompositeBuffer:
        /function ensureCompositeBufferCanvas\(\) \{[\s\S]*?cache\.compositeBuffer\.canvas = canvas;/.test(renderCacheOwnerSource)
        && /function composeCachedPasses[\s\S]*?const bufferCanvas = ensureCompositeBufferCanvas\(\);[\s\S]*?composeRenderPassesToTarget\(bufferContext, passNames, currentTransform,[\s\S]*?requireAllPasses: true[\s\S]*?blitCompositeBufferToMain\(bufferCanvas\);/.test(rendererSource)
        && /function blitCompositeBufferToMain\(bufferCanvas\) \{[\s\S]*?rendererSurfaceHost\.getContext\(\)\.globalCompositeOperation = "copy";[\s\S]*?rendererSurfaceHost\.getContext\(\)\.drawImage\(bufferCanvas, 0, 0\);[\s\S]*?rendererSurfaceHost\.getContext\(\)\.globalCompositeOperation = "source-over";/.test(rendererSource),
      coarsePrewarmDoesNotOverwriteActiveDetailChunks:
        /function hasDetailScenarioChunkIds\(chunkIds = \[\]\) \{[\s\S]*?String\(chunkId \|\| ""\)\.includes\("\.detail\."\)/.test(chunkRuntimeSource)
        && /const SCENARIO_CHUNK_FULL_WORLD_BBOX = Object\.freeze\(\[-180, -90, 180, 90\]\);/.test(chunkRuntimeSource)
        && /function preloadScenarioCoarseChunks[\s\S]*?viewportBbox: \[\.\.\.SCENARIO_CHUNK_FULL_WORLD_BBOX\],[\s\S]*?focusCountry:/.test(chunkRuntimeSource)
        && /function preloadScenarioCoarseChunks[\s\S]*?hasDetailScenarioChunkIds\(chunkState\.loadedChunkIds\)[\s\S]*?loadState\.promotionCommitInFlight[\s\S]*?return null;/.test(chunkRuntimeSource),
      zoomEndSettleRetainsPreviousRequiredPoliticalDetailChunks:
        chunkRuntimeSource.includes('function applyZoomEndChunkProtectionToSelection(selection, target, {')
        && chunkRuntimeSource.includes('reason = "",')
        && chunkRuntimeSource.includes('previousSelection = null,')
        && chunkRuntimeSource.includes('"render-phase-idle", "exact-after-settle", "scenario-apply", "scenario-apply-detail-prewarm"')
        && chunkRuntimeSource.includes('previousSelection?.requiredChunkIds')
        && chunkRuntimeSource.includes('chunkId.startsWith("political.detail.")')
        && chunkRuntimeSource.includes("selection.cacheOnlyChunkIds")
        && chunkRuntimeSource.includes("getScenarioChunkActiveMergeIds")
        && /const previousSelection = loadState\.lastSelection;[\s\S]*?applyZoomEndChunkProtection\(selection, loadState, \{[\s\S]*?reason: normalizedReason,[\s\S]*?previousSelection,/.test(chunkRuntimeSource),
      stalePostApplyRefreshDoesNotEvictRecentZoomEndDetail:
        /function shouldSkipStalePostApplyRefreshAfterZoomEnd\(loadState, reason = "", \{[\s\S]*?scenarioId = "",[\s\S]*?selectionVersion = 0,[\s\S]*?refreshSourceStartedAtMs = 0,[\s\S]*?lastSelection\?\.reason[\s\S]*?lastZoomEndToChunkVisibleMetric[\s\S]*?metric\?\.scenarioId[\s\S]*?metric\?\.selectionVersion[\s\S]*?sourceStartedAt > 0 && sourceStartedAt <= recordedAt/.test(chunkRuntimeSource)
        && /if \(shouldSkipStalePostApplyRefreshAfterZoomEnd\(loadState, nextReason, \{[\s\S]*?scenarioId,[\s\S]*?selectionVersion: loadState\.selectionVersion,[\s\S]*?refreshSourceStartedAtMs,[\s\S]*?normalizeScenarioIdFn: normalizeScenarioId,[\s\S]*?\}\)\) \{[\s\S]*?return "stale-post-apply-after-zoom-end";/.test(chunkRuntimeSource)
        && /patchScenarioChunkLoadState\(runtimeState, \{ pendingPostCommitRefresh: \{[\s\S]*?refreshSourceStartedAtMs,[\s\S]*?requestedAt: Date\.now\(\),[\s\S]*?\} \}\);/.test(chunkRuntimeSource)
        && /scheduleScenarioChunkRefresh\(\{[\s\S]*?reason: replayReason,[\s\S]*?refreshSourceStartedAtMs: Number\(pendingPostCommitRefresh\.refreshSourceStartedAtMs \|\| 0\),[\s\S]*?\}\);/.test(chunkRuntimeSource)
        && /scheduleScenarioChunkRefresh\(\{[\s\S]*?reason: "scenario-apply-detail-prewarm",[\s\S]*?refreshSourceStartedAtMs: prewarmStartedAt,[\s\S]*?\}\);/.test(postApplyEffectsSource)
        && /scheduleScenarioChunkRefresh\(\{[\s\S]*?reason: "scenario-apply",[\s\S]*?refreshSourceStartedAtMs: prewarmStartedAt,[\s\S]*?\}\);/.test(postApplyEffectsSource),
      delayedPoliticalCoreReadyMetricKeepsCoarseReadinessDetails:
        /const coarseReadyDetails = \{[\s\S]*?source: "chunk-promotion-coarse-ready"[\s\S]*?readinessLevel: "coarse-chunk"[\s\S]*?promotedPoliticalFeatureCount[\s\S]*?recordScenarioPerfMetric\("timeToPoliticalCoreReady", coarseReadyMs, coarseReadyDetails\);[\s\S]*?recordScenarioPerfMetric\("timeToInteractiveCoarseFrame", coarseReadyMs, coarseReadyDetails\);/.test(chunkRuntimeSource),
      frameGraphInvalidationReachesScenarioRefreshRuntime:
        scenarioRefreshPlansSource.includes("function createFrameGraphInvalidation")
        && scenarioRefreshPlansSource.includes("frameGraphInvalidation")
        && !/function createFrameGraphInvalidation\([\s\S]*?(legacyTargetPasses|targetPasses\s*=|targetPasses:|getTargetResourcesForPasses\(targetPasses\))[\s\S]*?function getFrameGraphInvalidationTargetPasses/.test(scenarioRefreshPlansSource)
        && !/export\s*\{[\s\S]*getFrameGraphInvalidationTargetPasses/.test(scenarioRefreshPlansSource)
        && /function normalizeRendererRefreshPlan\(refreshPlan, defaults = \{\}\) \{[\s\S]*?const frameGraphInvalidation = plan\.frameGraphInvalidation[\s\S]*?\.\.\.\(frameGraphInvalidation \? \{ frameGraphInvalidation \} : \{\}\)/.test(scenarioRefreshPlansSource)
        && scenarioRefreshPlansSource.includes("function resolveFrameGraphInvalidationExecutionPlan(frameGraphInvalidation, fallbackTargetPasses = [])")
        && /const hasExplicitTargetResources = Array\.isArray\(frameGraphInvalidation\?\.targetResources\);[\s\S]*?const resolvedInvalidationPasses = getFrameGraphInvalidationTargetPasses\([\s\S]*?const invalidationTargetPasses = resolvedInvalidationPasses\.length[\s\S]*?hasExplicitTargetResources \? \[\] : \[\.\.\.DEFAULT_RENDER_INVALIDATION_PASSES\][\s\S]*?return \{[\s\S]*?targetResources,[\s\S]*?invalidationTargetPasses,[\s\S]*?hasExplicitTargetResources,/.test(frameGraphExecutionPlanSource)
        && renderInvalidationCatalogSource.includes('export const DEFAULT_RENDER_INVALIDATION_PASSES = ["political", "borders", "labels"];')
        && !/\btargetPasses\s*[,}:]/.test(frameGraphExecutionPlanSource)
        && /function resolveScenarioChunkPromotionRendererRefreshDescriptor\([\s\S]*?const rendererRefreshPlan = normalizeRendererRefreshPlan[\s\S]*?const frameGraphInvalidation = rendererRefreshPlan\.frameGraphInvalidation[\s\S]*?const executionPlan = resolveFrameGraphInvalidationExecutionPlan\([\s\S]*?\.\.\.executionPlan/.test(scenarioRefreshPlansSource)
        && /const \{[\s\S]*?hasExplicitTargetResources,[\s\S]*?targetResources,[\s\S]*?invalidationTargetPasses,[\s\S]*?\} = resolveScenarioChunkPromotionRendererRefreshDescriptor\(\{[\s\S]*?refreshPlan,[\s\S]*?changedLayerKeys: effectiveChangedLayerKeys,[\s\S]*?hasPoliticalChange,[\s\S]*?\}\)/.test(chunkPromotionRuntimeSource)
        && chunkPromotionRuntimeSource.includes("scenarioVisualInvalidationExecutor.executeScenarioVisualInvalidation({")
        && /executionPlan:\s*\{\s*targetResources,\s*invalidationTargetPasses,\s*hasExplicitTargetResources\s*\}/.test(chunkPromotionRuntimeSource)
        && !/executionPlan:\s*\{[^}]*\btargetPasses\s*[,}:]/.test(chunkPromotionRuntimeSource)
        && scenarioVisualInvalidationExecutorSource.includes("const REQUIRED_RENDERER_EFFECT_NAMES = Object.freeze([")
        && scenarioVisualInvalidationExecutorSource.includes("function getRequiredRendererEffect(deps, name)")
        && scenarioVisualInvalidationExecutorSource.includes("function findRetiredVisualInvalidationPassInputKey(inputs = {})")
        && scenarioVisualInvalidationExecutorSource.includes("function createScenarioVisualInvalidationExecutor(deps = {})")
        && scenarioVisualInvalidationExecutorSource.includes("function executeScenarioVisualInvalidation({")
        && renderInvalidationCatalogSource.includes("export const UNSUPPORTED_RENDER_PASS_INPUT_KEYS = Object.freeze([")
        && scenarioVisualInvalidationExecutorSource.includes("UNSUPPORTED_RENDER_PASS_INPUT_KEYS")
        && scenarioVisualInvalidationExecutorSource.includes("from \"./render_invalidation_catalog.js\";")
        && !scenarioVisualInvalidationExecutorSource.includes("const RETIRED_VISUAL_INVALIDATION_PASS_INPUT_KEYS = Object.freeze([")
        && scenarioVisualInvalidationExecutorSource.includes("findRetiredVisualInvalidationPassInputKey(executionPlan)")
        && scenarioVisualInvalidationExecutorSource.includes("assertExecutionPlanHasNoRetiredPassFields(executionPlan, retiredInputs);")
        && !/function executeScenarioVisualInvalidation\([\s\S]*?\btargetPasses\s*=/.test(scenarioVisualInvalidationExecutorSource)
        && !/const legacyTargetPasses =/.test(scenarioVisualInvalidationExecutorSource)
        && [
          "clearLastGoodFrame(`${reason}-frame-graph`)",
          "clearRenderPassReferenceTransforms(invalidationTargetPasses)",
          "invalidateInteractionComposite(`${reason}-frame-graph`)",
          "invalidateBorderCache()",
          "resetScenarioWaterCacheAdaptiveState(frameGraphInvalidation.resetWaterCacheReason)",
          "invalidateRenderPasses(invalidationTargetPasses, reason);",
        ].every((snippet) => scenarioVisualInvalidationExecutorSource.includes(snippet)),
      startupInitialVisualUsesFirstFrameResourceAllowlist:
        renderInvalidationCatalogSource.includes("export const FIRST_FRAME_BASE_TARGET_RESOURCES = Object.freeze([")
        && renderInvalidationCatalogSource.includes('"backgroundBuffer"')
        && renderInvalidationCatalogSource.includes('"physicalBaseBuffer"')
        && renderInvalidationCatalogSource.includes('"politicalBaseBuffer"')
        && renderInvalidationCatalogSource.includes('"hitIndex"')
        && renderInvalidationCatalogSource.includes('"borderBuffer"')
        && renderInvalidationCatalogSource.includes('"interactionOverlay"')
        && scenarioRefreshPlansSource.includes("from \"./render_invalidation_catalog.js\";")
        && !scenarioRefreshPlansSource.includes("const FIRST_FRAME_BASE_TARGET_RESOURCES = Object.freeze([")
        && !/export const FIRST_FRAME_BASE_TARGET_RESOURCES = Object\.freeze\(\[[^\]]*?"labelBuffer"/.test(renderInvalidationCatalogSource)
        && !/export const FIRST_FRAME_BASE_TARGET_RESOURCES = Object\.freeze\(\[[^\]]*?"contextBaseBuffer"/.test(renderInvalidationCatalogSource)
        && !/export const FIRST_FRAME_BASE_TARGET_RESOURCES = Object\.freeze\(\[[^\]]*?"contextScenarioBuffer"/.test(renderInvalidationCatalogSource)
        && !/export const FIRST_FRAME_BASE_TARGET_RESOURCES = Object\.freeze\(\[[^\]]*?"dayNightBuffer"/.test(renderInvalidationCatalogSource)
        && /createScenarioChunkPromotionRefreshPlan\(\{[\s\S]*?firstFrameOnly = false,[\s\S]*?hgoPreviewDirty = false,[\s\S]*?const targetResources = firstFrameOnly[\s\S]*?resolveFirstFrameTargetResources/.test(scenarioRefreshPlansSource)
        && /function refreshMapDataForScenarioChunkPromotion\(options = \{\}\) \{[\s\S]*?firstFrameOnly: !!options\.firstFrameOnly,[\s\S]*?hgoPreviewDirty: !!options\.hgoPreviewDirty/.test(scenarioRendererBridgeSource)
        && /function applyScenarioPoliticalChunkPayload\([\s\S]*?firstFrameOnly = false,[\s\S]*?refreshMapDataForScenarioChunkPromotion\(\{[\s\S]*?firstFrameOnly,/.test(chunkRuntimeSource)
        && /applyScenarioPoliticalChunkPayload\(bundle, mergedLayerPayloads\.political \|\| null, \{[\s\S]*?firstFrameOnly: !!allowStartupInitialVisual/.test(chunkRuntimeSource),
      chunkSelectionCarriesCostFieldsAndSums:
        chunkManagerSource.includes("byteSize")
        && chunkManagerSource.includes("coordCount")
        && chunkManagerSource.includes("partCount")
        && chunkManagerSource.includes("estimatedPathCost")
        && chunkManagerSource.includes("selectedFeatureCountSum")
        && chunkManagerSource.includes("selectedEstimatedPathCostSum")
        && chunkManagerSource.includes("max_required_estimated_path_cost")
        && chunkManagerSource.includes("max_required_byte_size")
        && chunkManagerSource.includes("max_required_political_chunks")
        && chunkManagerSource.includes("min_required_political_chunks")
        && chunkManagerSource.includes("max_required_political_estimated_path_cost")
        && chunkManagerSource.includes("max_required_political_byte_size")
        && chunkManagerSource.includes("takeRequiredChunksWithinCostBudget"),
      focusCountryOverrideHasTtlAndIsConsumed:
        chunkRuntimeSource.includes("FOCUS_COUNTRY_OVERRIDE_TTL_MS")
        && chunkRuntimeSource.includes("focusCountryOverrideExpiresAt")
        && chunkRuntimeSource.includes("consumeScenarioChunkFocusCountryOverride(loadState)")
        && chunkRuntimeSource.includes("clearScenarioChunkFocusCountryOverride(loadState)"),
      chunkedFullBundleUsesBootstrapRuntimeTopology:
        bundleRuntimeSource.includes("const runtimeTopologyLevel = requestedBundleLevel === \"bootstrap\" || runtimeShell?.detailChunkManifestUrl")
        && /const runtimeTopologyUrl = String\([\s\S]*?runtimeTopologyLevel === "bootstrap"[\s\S]*?runtimeShell\?\.startupTopologyUrl[\s\S]*?manifest\.runtime_topology_url/.test(bundleRuntimeSource)
        && /assembleScenarioBundle\([\s\S]*?runtimeTopologyUrl,[\s\S]*?runtimeTopologyLevel,[\s\S]*?geoLocalePatchDescriptor/.test(bundleRuntimeSource)
        && /function loadScenarioRuntimeTopologyForBundle\([\s\S]*?runtimeTopologyLevel = requestedBundleLevel[\s\S]*?requestedRuntimeTopologyLevel === "bootstrap"[\s\S]*?loadScenarioRuntimeBootstrapViaWorker/.test(bundleLoaderSource)
        && /decodeRuntimeChunkViaWorker\(\{ runtimeTopologyUrl \}\)/.test(bundleLoaderSource)
        && /topologyLevel: runtimeTopologyLevel === "bootstrap" \? "bootstrap" : "full"/.test(bundleLoaderSource),
    };

    Object.entries(contract).forEach(([label, ok]) => {
      assert.equal(ok, true, label);
    });
  });

  register(34, "first visible political frame accepts coarse startup pass without full reference", () => {
    const harness = createFirstVisibleFrameGateHarness();

    harness.setPoliticalStage("coarse", false);
    harness.setFullReferenceTransform(null);
    assert.equal(harness.blockReason("exact-frame"), "");

    harness.setPoliticalStage("data-ready", false);
    harness.setFullReferenceTransform({ x: 999, y: 0, k: 1 });
    assert.equal(harness.blockReason("exact-frame"), "");

    harness.setPoliticalStage("fine", true);
    harness.setFullReferenceTransform(null);
    assert.equal(harness.blockReason("exact-frame"), "stale-political-full-reference-transform");

    harness.setFullReferenceTransform({ x: 1, y: 0, k: 1 });
    assert.equal(harness.blockReason("exact-frame"), "stale-political-full-reference-transform");

    harness.setFullReferenceTransform({ x: 0, y: 0, k: 1 });
    assert.equal(harness.blockReason("exact-frame"), "");
  });

  register(35, "perf contracts keep coarse first frame and benchmark app-path fallback boundaries", () => {
    const rendererSource = readRepoFile("js", "core", "map_renderer.js");
    const politicalPartialOwnerSource = readRepoFile(
      "js",
      "core",
      "renderer",
      "political_partial_repaint_owner.js",
    );
    const politicalPassOwnerSource = readRepoFile(
      "js",
      "core",
      "renderer",
      "political_pass_orchestrator_owner.js",
    );
    const politicalBackgroundOwnerSource = readRepoFile(
      "js",
      "core",
      "renderer",
      "political_background_render_owner.js",
    );
    const cachedPassCompositorOwnerSource = readRepoFile("js", "core", "renderer", "cached_pass_compositor_owner.js");
    const scenarioManagerSource = readRepoFile("js", "core", "scenario_manager.js");
    const scenarioApplyPipelineSource = readRepoFile("js", "core", "scenario_apply_pipeline.js");
    const chunkRuntimeSource = readRepoFile("js", "core", "scenario", "chunk_runtime.js");
    const mainSource = readRepoFile("js", "main.js");
    const benchmarkSource = readRepoFile("ops", "browser-mcp", "editor-performance-benchmark.py");
    const playwrightAppPathsSource = readRepoFile("tests", "e2e", "support", "playwright-app-paths.js");
    const politicalOwnerDrawSource = extractRendererFunction(politicalPassOwnerSource, "drawPoliticalPass");
    const politicalBackgroundEffectSource = extractRendererFunction(rendererSource, "drawPoliticalPassBackground");
    const politicalFineLoopSource = extractRendererFunction(politicalPartialOwnerSource, "drawPoliticalFineFeatureLoop");
    const transformedPassDiagnosticsOwnerSource = extractRendererFunction(
      cachedPassCompositorOwnerSource,
      "recordTransformedPassIfEnabled",
    );
    const drawTransformedPassSource = extractRendererFunction(
      cachedPassCompositorOwnerSource,
      "drawTransformedPass",
    );
    const composeRenderPassesSource = extractRendererFunction(
      cachedPassCompositorOwnerSource,
      "composeRenderPassesToTarget",
    );

    const checks = {
      politicalPassStartsWithBackgroundFills:
        /recordPoliticalRasterWorkerSnapshot\(\);[\s\S]*?resolvePoliticalPassViewport\(identity\)[\s\S]*?consumePoliticalRasterWorkerBitmapResult\(identity\.workerIdentity\)[\s\S]*?drawPoliticalBackgroundFills\(\{ identity, viewport \}\)[\s\S]*?if \(!hasPoliticalLandFeatures\(\)\)/.test(politicalOwnerDrawSource)
        && /drawPoliticalBackgroundFills\(\{[\s\S]*?transform: identity\.transform,[\s\S]*?visibleItems: viewport\.visibleItems,[\s\S]*?screenRects: viewport\.screenRects,[\s\S]*?returnSummary: true,/.test(politicalBackgroundEffectSource),
      transformedPassPathsRecordRenderDiagnosticsThroughOwner:
        transformedPassDiagnosticsOwnerSource.includes("if (!isRenderDiagnosticsEnabled()) return;")
        && /recordTransformedPassDiagnostics\(passName, \{[\s\S]*?current,[\s\S]*?reference,[\s\S]*?scaleRatio,[\s\S]*?dx,[\s\S]*?dy,[\s\S]*?layout,/.test(transformedPassDiagnosticsOwnerSource)
        && drawTransformedPassSource.includes("recordTransformedPassIfEnabled(")
        && composeRenderPassesSource.includes("recordTransformedPassIfEnabled(")
        && /recordTransformedPassDiagnostics: \(passName, details\) => \{[\s\S]*?renderDiag\.transformedPasses = \{[\s\S]*?\[passName\]: details,[\s\S]*?publishRenderDiagnostics\(\);/.test(rendererSource),
      drawInteractionCompositeRecordsStableRenderDiagnostics:
        (() => {
          const body = rendererSource.match(/function drawInteractionComposite\([\s\S]*?\r?\n\}\r?\n\r?\nfunction /)?.[0] || "";
          return body.includes("renderDiag.transformedPasses = {")
            && body.includes("interactionComposite: {")
            && body.includes("current,")
            && body.includes("reference,")
            && body.includes("scaleRatio,")
            && body.includes("layout: null,")
            && body.includes("dirty: false,")
            && body.includes("publishRenderDiagnostics();");
        })(),
      backgroundFillHelperKeepsScenarioMergeSplit:
        /function drawPoliticalBackgroundFills\(options = \{\}\) \{[\s\S]*?if \(shouldUseScenarioPoliticalBackgroundMerge\(\)\) \{[\s\S]*?return drawScenarioPoliticalBackgroundFills\(options\);[\s\S]*?\}[\s\S]*?drawAdmin0BackgroundFills\(options\);/.test(politicalBackgroundOwnerSource),
      backgroundFullPassCacheBuildsAndReplays:
        /function getScenarioPoliticalBackgroundFullPassGroups\([\s\S]*?metricName = "scenarioPoliticalBackgroundCacheBuild"[\s\S]*?recordRenderPerfMetric\("scenarioPoliticalBackgroundCacheReplay"[\s\S]*?recordRenderPerfMetric\(metricName/.test(politicalBackgroundOwnerSource),
      politicalRecoveryQualityDefaultsProgressiveWithExactOverride:
        rendererSource.includes('const POLITICAL_RECOVERY_QUALITY_PARAM = "political_recovery_quality";')
        && /function getPoliticalRecoveryQuality\(\) \{[\s\S]*?raw === POLITICAL_RECOVERY_QUALITY_EXACT[\s\S]*?POLITICAL_RECOVERY_QUALITY_EXACT[\s\S]*?POLITICAL_RECOVERY_QUALITY_PROGRESSIVE[\s\S]*?runtimeState\.politicalRecoveryQuality = resolved;[\s\S]*?return resolved;[\s\S]*?\}/.test(rendererSource),
      progressivePoliticalRecoveryUsesCoarseUnderlayAndDeferredFullCache:
        politicalBackgroundOwnerSource.includes("POLITICAL_PROGRESSIVE_BACKGROUND_EXACT_ENTRY_LIMIT")
        && rendererSource.includes("POLITICAL_PATH_CACHE_PRESERVING_INVALIDATION_REASONS")
        && politicalBackgroundOwnerSource.includes('"progressive-political-full-cache-ready"')
        && politicalBackgroundOwnerSource.includes("function isScenarioPoliticalBackgroundFullPassCacheKeyReady")
        && politicalBackgroundOwnerSource.includes("function scheduleScenarioPoliticalBackgroundDeferredFullCache")
        && politicalBackgroundOwnerSource.includes("function isScenarioPoliticalBackgroundDeferredFullCacheStateCurrent")
        && /function getScenarioPoliticalBackgroundFullPassIdentity\([\s\S]*?const sceneIdentity = getVisibleFrameIdentity\(transform\);[\s\S]*?sceneIdentity\.sceneGeneration[\s\S]*?sceneIdentity\.scenarioDataGeneration/.test(politicalBackgroundOwnerSource)
        && /function isScenarioPoliticalBackgroundDeferredFullCacheStateCurrent\([\s\S]*?transform = getRuntimeState\(\)\.zoomTransform \|\| platform\.d3\?\.zoomIdentity[\s\S]*?const transformSignature = getTransformSignature\(transform\);[\s\S]*?String\(state\.transformSignature \|\| ""\) === transformSignature/.test(politicalBackgroundOwnerSource)
        && /function recordScenarioPoliticalBackgroundDeferredFullCacheReadyRepaintDeferred\(deferredState\) \{[\s\S]*?deferredState\.repaintDeferredRecorded = true;[\s\S]*?recordRenderPerfMetric\("scenarioPoliticalBackgroundDeferredFullCacheReadyRepaintDeferred"/.test(politicalBackgroundOwnerSource)
        && politicalBackgroundOwnerSource.includes("function runScenarioPoliticalBackgroundDeferredFullCacheSlice")
        && /function runScenarioPoliticalBackgroundDeferredFullCacheSlice\([\s\S]*?const normalizedEntries = deferredState\.entries;[\s\S]*?isScenarioPoliticalBackgroundFullPassCacheKeyReady\(deferredState\.fullPassCacheKey\)/.test(politicalBackgroundOwnerSource)
        && (() => {
          const body = politicalBackgroundOwnerSource.match(/function runScenarioPoliticalBackgroundDeferredFullCacheSlice\([\s\S]*?\r?\n  \}\r?\n\s*function scheduleScenarioPoliticalBackgroundDeferredFullCache/)?.[0] || "";
          return body.includes("getRuntimeState().deferExactAfterSettle")
            && body.includes("isExactAfterSettleControllerActive()")
            && body.includes("cache.dirty?.political")
            && body.includes('cancelScenarioPoliticalBackgroundDeferredFullCache("scene-snapshot-mismatch");')
            && body.includes("scenarioPoliticalBackgroundDeferredFullCacheHandle = scheduleDeferredWork")
            && body.includes("const recoverySettled = isInteractionRecoverySettled({ quietMs: 600 });")
            && /!recoverySettled[\s\S]*?deferredState\.index >= normalizedEntries\.length[\s\S]*?recordScenarioPoliticalBackgroundDeferredFullCacheReadyRepaintDeferred\(deferredState\);[\s\S]*?const startedAt = nowMs\(\)[\s\S]*?getPoliticalFeaturePathEntry\([\s\S]*?allowBuild: true/.test(body)
            && /if \(!isInteractionRecoverySettled\(\{ quietMs: 600 \}\)\) \{[\s\S]*?scenarioPoliticalBackgroundDeferredFullCacheHandle = scheduleDeferredWork\([\s\S]*?runScenarioPoliticalBackgroundDeferredFullCacheSlice,[\s\S]*?\{ timeout: POLITICAL_DEFERRED_FULL_CACHE_TIMEOUT_MS \},[\s\S]*?\);[\s\S]*?recordScenarioPoliticalBackgroundDeferredFullCacheReadyRepaintDeferred\(deferredState\);[\s\S]*?return false;[\s\S]*?\}/.test(body);
        })()
        && /function drawScenarioPoliticalBackgroundFills\([\s\S]*?const pendingPoliticalColorEdit = hasPendingPoliticalColorEdit\(\);[\s\S]*?politicalDirtyReason !== "refresh-colors"[\s\S]*?!pendingPoliticalColorEdit[\s\S]*?allowBuild: false[\s\S]*?drawAdmin0BackgroundFills\(\{[\s\S]*?scheduleScenarioPoliticalBackgroundDeferredFullCache/.test(politicalBackgroundOwnerSource)
        && /const pendingPoliticalColorEdit = hasPendingPoliticalColorEdit\(\);[\s\S]*?const progressiveRecoveryCoarseSkipCandidate = \([\s\S]*?coarseUnderlay \|\| ""\) === "admin0"[\s\S]*?!pendingPoliticalColorEdit[\s\S]*?\);[\s\S]*?if \(progressiveRecoveryCoarseSkipCandidate && !visiblePoliticalForegroundColorOverride\)/.test(politicalOwnerDrawSource)
        && /function clearPendingPoliticalColorEdit\(\{[\s\S]*?renderedCount = 0,[\s\S]*?renderedIds = null,[\s\S]*?force = false,[\s\S]*?paintSource = "political-pass"[\s\S]*?\} = \{\}\) \{[\s\S]*?cache\.pendingPoliticalColorEditIds\.clear\(\);[\s\S]*?cache\.pendingPoliticalColorEditRevision = -1;/.test(rendererSource)
        && /function drawPoliticalFeature\([\s\S]*?metricsCollector\.renderedIds instanceof Set[\s\S]*?metricsCollector\.renderedIds\.add\(id\);/.test(politicalPartialOwnerSource)
        && /const featureMetrics = \{[\s\S]*?renderedIds: new Set\(\)[\s\S]*?\};[\s\S]*?return featureMetrics;/.test(politicalFineLoopSource)
        && /const featureMetrics = drawPoliticalFineFeatureLoop\([\s\S]*?recordRenderPerfMetric\("drawPoliticalFeatureFillLoop"[\s\S]*?recordRenderPerfMetric\("drawPoliticalFeatureStrokeLoop"[\s\S]*?clearPendingPoliticalColorEdit\(\{[\s\S]*?renderedIds: featureMetrics\.renderedIds,[\s\S]*?\}\);/.test(politicalOwnerDrawSource)
        && /function tryPartialPoliticalPassRepaint\(transform, nextSignature, timings\) \{[\s\S]*?const partialFeatureMetrics = \{[\s\S]*?renderedIds: new Set\(\)[\s\S]*?\};[\s\S]*?metricsCollector: partialFeatureMetrics,[\s\S]*?clearPendingPoliticalColorEdit\(\{[\s\S]*?renderedIds: partialFeatureMetrics\.renderedIds,[\s\S]*?\}\);/.test(politicalPartialOwnerSource)
        && politicalBackgroundOwnerSource.includes('recordRenderPerfMetric("scenarioPoliticalBackgroundProgressiveRecovery"')
        && politicalBackgroundOwnerSource.includes('metricName: "scenarioPoliticalBackgroundDeferredFullCacheBuild"')
        && politicalBackgroundOwnerSource.includes('recordRenderPerfMetric("scenarioPoliticalBackgroundDeferredFullCacheSlice"')
        && politicalPassOwnerSource.includes('reason: "progressive-coarse-underlay"'),
      progressiveFullCacheReadyRequestsPoliticalRepaint:
        (() => {
          const body = politicalBackgroundOwnerSource.match(/function runScenarioPoliticalBackgroundDeferredFullCacheSlice\([\s\S]*?\r?\n  \}\r?\n\s*function scheduleScenarioPoliticalBackgroundDeferredFullCache/)?.[0] || "";
          return /isInteractionRecoverySettled\(\{ quietMs: 600 \}\)[\s\S]*?recordRenderPerfMetric\("scenarioPoliticalBackgroundDeferredFullCacheComplete"[\s\S]*?scenarioPoliticalBackgroundDeferredFullCacheState = null;[\s\S]*?invalidateRenderPasses\("political", "progressive-political-full-cache-ready"\);[\s\S]*?recordProgressivePoliticalFullCacheReadyDiagnostics\(getRuntimeState\(\)[\s\S]*?const repaintRequested = requestRendererRender\("progressive-political-full-cache-ready", \{[\s\S]*?flush: false,[\s\S]*?fallback: renderFallback,[\s\S]*?recordRenderPerfMetric\("scenarioPoliticalBackgroundDeferredFullCacheReadyRepaintRequest"[\s\S]*?repaintRequested: !!repaintRequested/.test(body);
        })(),
      chunkedRuntimeSkipsBlockingDetailPromotion:
        /async function stageScenarioReadinessPatch\([\s\S]*?if \(startupReadonly \|\| supportsChunkedPoliticalRuntime\) \{[\s\S]*?detailPromoted: false,[\s\S]*?return stagedReadiness;/.test(scenarioApplyPipelineSource)
        && scenarioApplyPipelineSource.includes("await prepareScenarioDetailTopologyState();"),
      unconfirmedDetailPromotionStillWarnsBeforeHealthGate:
        /if \(!detailReady && scenarioReadinessPatch\.topologyBundleMode !== "composite"\) \{[\s\S]*?console\.warn\("\[scenario\] Applying bundle without confirmed detail promotion; health gate will validate runtime topology\."\);/.test(scenarioApplyPipelineSource),
      coarseInteractiveMetricRecordedAfterPostApplyEffects:
        /const \{[\s\S]*?chunkPrewarmAwaited = true,[\s\S]*?chunkPrewarmDeferred = false,[\s\S]*?coarsePrewarmCommitted = false,[\s\S]*?\} = await runPostScenarioApplyEffects\([\s\S]*?deferChunkPrewarm,[\s\S]*?const canRecordPostApplyCoarseMetric = !hasChunkedRuntime \|\| coarsePrewarmCommitted;[\s\S]*?if \(chunkPrewarmDeferred\) \{[\s\S]*?recordScenarioPerfMetric\("timeToStartupShellApplyReady"[\s\S]*?source: "post-apply-startup-shell-ready"[\s\S]*?readinessLevel: "startup-shell-apply-ready"[\s\S]*?\} else if[\s\S]*?canRecordPostApplyCoarseMetric[\s\S]*?recordScenarioPerfMetric\([\s\S]*?"timeToPoliticalCoreReady"[\s\S]*?source: "post-apply-coarse-ready"[\s\S]*?if \(!chunkPrewarmDeferred && canRecordPostApplyCoarseMetric\) \{[\s\S]*?recordScenarioPerfMetric\([\s\S]*?"timeToInteractiveCoarseFrame"[\s\S]*?readinessLevel: "coarse-chunk"[\s\S]*?chunkPrewarmAwaited,[\s\S]*?chunkPrewarmDeferred,[\s\S]*?coarsePrewarmCommitted,/.test(scenarioManagerSource),
      chunkedCoarsePrewarmSuppressesDetailHealthSignals:
        /function shouldSuppressChunkedPostApplyDataHealthSignals\([\s\S]*?return hasChunkedRuntime === true[\s\S]*?prewarmFailed !== true[\s\S]*?chunkErrorCount/.test(readRepoFile("js", "core", "scenario_post_apply_effects.js"))
        && /const suppressChunkedPostApplyDataHealthSignals = shouldSuppressChunkedPostApplyDataHealthSignals\(\{[\s\S]*?showWarningToast: shouldExposeScenarioDataHealthSignals && !suppressChunkedPostApplyDataHealthSignals,[\s\S]*?showErrorToast: shouldExposeScenarioDataHealthSignals && !suppressChunkedPostApplyDataHealthSignals,/.test(readRepoFile("js", "core", "scenario_post_apply_effects.js"))
        && /const shouldExposeDetailVisibilityWarning =[\s\S]*?!shouldSuppressChunkedPostApplyDataHealthSignals\(\{[\s\S]*?hasChunkedRuntime,[\s\S]*?prewarmFailed,[\s\S]*?chunkErrorCount:/.test(scenarioManagerSource),
      startupBootDefersCoarsePrewarm:
        /async function ensureChunkedScenarioFirstFrameReady\(\{[\s\S]*?awaitPrewarm = true,[\s\S]*?coarsePrewarmCommitted: false,[\s\S]*?if \(awaitPrewarm === false && !synchronous\) \{[\s\S]*?scheduleScenarioChunkRefresh\(\{[\s\S]*?reason: "scenario-apply"[\s\S]*?coarsePrewarmDeferredAt: refreshScheduledAt[\s\S]*?chunkRefreshScheduledAt: refreshScheduledAt[\s\S]*?return \{[\s\S]*?chunkPrewarmAwaited: false,[\s\S]*?chunkPrewarmDeferred: true,[\s\S]*?coarsePrewarmCommitted: false,/.test(readRepoFile("js", "core", "scenario_post_apply_effects.js"))
        && /canDeferStartupChunkPrewarm = scenarioBundleSource === "startup-bundle"[\s\S]*?defaultScenarioBundle\?\.loadDiagnostics\?\.startupBundle === true[\s\S]*?deferChunkPrewarm: canDeferStartupChunkPrewarm,[\s\S]*?canDeferStartupChunkPrewarm = false;/.test(readRepoFile("js", "bootstrap", "startup_scenario_boot.js")),
      disabledDefaultScenarioOverrideBootsBaseMap:
        readRepoFile("js", "bootstrap", "startup_bootstrap_support.js").includes('const DEFAULT_SCENARIO_DISABLED_OVERRIDE = "none";')
        && /function getConfiguredDefaultScenarioId\(\)[\s\S]*?if \(isDefaultScenarioDisabledOverride\(queryOverride\)\) \{[\s\S]*?return "";[\s\S]*?export function shouldDisableConfiguredDefaultScenario\(\)/.test(readRepoFile("js", "bootstrap", "startup_bootstrap_support.js"))
        && /const defaultScenarioDisabled = shouldDisableConfiguredDefaultScenario\(\);[\s\S]*?const configuredDefaultScenarioId = defaultScenarioDisabled \? "" : getConfiguredDefaultScenarioId\(\);[\s\S]*?const registryDefaultScenarioIdPromise = defaultScenarioDisabled[\s\S]*?Promise\.resolve\(""\)[\s\S]*?const requestedDefaultScenarioIdPromise = defaultScenarioDisabled[\s\S]*?Promise\.resolve\(""\)/.test(readRepoFile("js", "bootstrap", "startup_data_pipeline.js"))
        && /if \(scenarioBundleResult\?\.skipped && !scenarioBundleResult\.bundle\) \{[\s\S]*?bundleLevel: "none"[\s\S]*?defaultScenarioBundle: null/.test(readRepoFile("js", "bootstrap", "startup_scenario_boot.js"))
        && /if \(!scenarioId\) \{[\s\S]*?buildInitialScenarioChunkVisualPromotionResult\("no-active-scenario"[\s\S]*?result\.ok = true;[\s\S]*?return result;/.test(chunkRuntimeSource),
      startupBootRebuildsBaseMapBeforeInitialChunkVisual:
        /startupScenarioBoot\.runStartupScenarioBoot\([\s\S]*?if \(!Array\.isArray\(runtimeState\.landData\?\.features\) \|\| !runtimeState\.landData\.features\.length\) \{[\s\S]*?setMapData\(\{[\s\S]*?suppressRender: true,[\s\S]*?interactionLevel: startupInteractionLevel,[\s\S]*?deferInteractionInfrastructure: startupInteractionLevel === "readonly-startup"[\s\S]*?\}\);[\s\S]*?await ensureStartupInitialScenarioChunkVisualReady/.test(mainSource),
      ensureAppPathUrlRewritesRootAndNestedPaths:
        /def ensure_app_path_url\(url: str\) -> str:[\s\S]*?if path\.startswith\("\/app\/"\) or path == "\/app":[\s\S]*?elif path == "\/":[\s\S]*?normalized_path = "\/app\/"[\s\S]*?else:[\s\S]*?normalized_path = f"\/app\{path\}" if path\.startswith\("\/"\) else f"\/app\/\{path\}"/.test(benchmarkSource),
      buildScenarioOpenUrlsAddsPerfOverlayAndScenarioCandidate:
        /def build_scenario_open_urls\([\s\S]*?perf_url = with_query_overrides\(ensure_app_path_url\(base_url\), perf_overlay="1", runtime_chunk_perf="1"\)[\s\S]*?neutral_perf_url = with_query_overrides\(perf_url, default_scenario="none"\)[\s\S]*?urls\.append\(neutral_perf_url\)[\s\S]*?if normalized_scenario_id == "none":[\s\S]*?pass[\s\S]*?elif normalized_scenario_id:[\s\S]*?scenario_perf_url = with_query_overrides\(perf_url, default_scenario=normalized_scenario_id\)[\s\S]*?urls\.append\(scenario_perf_url\)[\s\S]*?urls\.append\(perf_url\)/.test(benchmarkSource),
      openPageKeepsWrapperThenLocalFallbackAcrossCandidates:
        /REQUESTED_PLAYWRIGHT_BACKEND = os\.environ\.get\("EDITOR_PERF_BENCHMARK_BACKEND"/.test(benchmarkSource)
        && /PLAYWRIGHT_BACKEND = LOCAL_NODE_PLAYWRIGHT_BACKEND if REQUESTED_PLAYWRIGHT_BACKEND == LOCAL_NODE_PLAYWRIGHT_BACKEND else WRAPPER_BACKEND/.test(benchmarkSource)
        && /SCENARIO_BROWSER_RECYCLE_SETTLE_SEC = 1\.0/.test(benchmarkSource)
        && /case 'open': \{[\s\S]*?if \(url && payload\.navigate !== false\) \{[\s\S]*?await targetPage\.goto/.test(benchmarkSource)
        && /"headless": LOCAL_NODE_PLAYWRIGHT_HEADLESS,[\s\S]*?"navigate": False,/.test(benchmarkSource)
        && /def open_page\(urls: list\[str\] \| tuple\[str, \.\.\.\] \| str\) -> dict:[\s\S]*?if REQUESTED_PLAYWRIGHT_BACKEND in \{"", WRAPPER_BACKEND\} and PWCLI\.exists\(\):[\s\S]*?run_wrapper_pw\("open", candidate_url, "--browser", browser_name,[\s\S]*?if REQUESTED_PLAYWRIGHT_BACKEND in \{"", LOCAL_NODE_PLAYWRIGHT_BACKEND\}:[\s\S]*?run_local_pw\(\s*"open",\s*candidate_url,\s*"--browser",\s*browser_name,/.test(benchmarkSource),
      scenarioSuitesSettleAfterClosingBrowser:
        /def run_scenario_suite\([\s\S]*?close_session\(\)[\s\S]*?time\.sleep\(SCENARIO_BROWSER_RECYCLE_SETTLE_SEC\)[\s\S]*?page_load = open_page/.test(benchmarkSource),
      benchmarkReadyTimeoutReportsBootErrorAndBrowserIssues:
        /bootError: String\(state\.bootError \|\| ''\),/.test(benchmarkSource)
        && /if isinstance\(result, dict\):[\s\S]*?result\["consoleIssues"\] = capture_console_issues\(\)[\s\S]*?result\["networkIssues"\] = capture_network_issues\(\)[\s\S]*?Benchmark runtime did not become ready before scenario action/.test(benchmarkSource),
      suiteBaseUrlsKeepOriginalAndAppVariants:
        /suite_base_urls = unique_strings\(\[[\s\S]*?effective_url,[\s\S]*?ensure_app_path_url\(effective_url\),[\s\S]*?args\.url,[\s\S]*?ensure_app_path_url\(args\.url\),/.test(benchmarkSource),
      sameScenarioFreshMetricSelectionIsExplicit:
        /def is_same_scenario_fresh_metric_entry\([\s\S]*?def summarize_freshest_same_scenario_metric_entry\(/.test(benchmarkSource),
      scenarioConsistencyAcceptsNeutralPageLoadBeforeApply:
        /neutral_page_load = page_load_active == "" and "default_scenario=none" in page_load_open_url[\s\S]*?or neutral_page_load[\s\S]*?scenario_apply_matches =/.test(benchmarkSource),
      contextProbeReportsPerPassDurations:
        benchmarkSource.includes('("all_context_off", {')
        && benchmarkSource.includes('"contextBaseDurationMs"')
        && benchmarkSource.includes('"contextScenarioDurationMs"')
        && benchmarkSource.includes('("lastFrame", "timings", "contextScenario")')
        && benchmarkSource.includes("'showCityPoints'")
        && benchmarkSource.includes("'showTransport'"),
      contextProbeScenariosAndCasesAreConfigurable:
        benchmarkSource.includes('"--context-probe-scenarios"')
        && benchmarkSource.includes('"--context-probe-cases"')
        && /def parse_context_probe_scenarios\(value: str\) -> set\[str\]:[\s\S]*?known_scenario_ids = set\(SCENARIO_IDS\)[\s\S]*?Unknown --context-probe-scenarios value\(s\)/.test(benchmarkSource)
        && /def parse_context_probe_cases\(value: str\) -> list\[tuple\[str, dict\[str, bool\]\]\]:[\s\S]*?unknown = \[label for label in labels if label not in cases_by_label\]/.test(benchmarkSource)
        && /def measure_context_probes\([\s\S]*?enabled_scenario_ids: set\[str\][\s\S]*?context_probe_cases: list\[tuple\[str, dict\[str, bool\]\][\s\S]*?if scenario_id not in enabled_scenario_ids:[\s\S]*?for label, flags in context_probe_cases:/.test(benchmarkSource)
        && /context_probe_scenario_ids = parse_context_probe_scenarios\(args\.context_probe_scenarios\)[\s\S]*?context_probe_cases = parse_context_probe_cases\(args\.context_probe_cases\)[\s\S]*?"contextProbeScenarios": sorted\(context_probe_scenario_ids\)[\s\S]*?"contextProbeCases": \[label for label, _flags in context_probe_cases\]/.test(benchmarkSource),
      benchmarkWheelTraceTracksLastWheelAndBlackRatio:
        benchmarkSource.includes("firstIdleAfterLastWheelMs")
        && benchmarkSource.includes("sample_canvas_black_pixel_ratio_js")
        && benchmarkSource.includes("maxBlackPixelRatio")
        && benchmarkSource.includes("lastWheelAt = await page.evaluate(() => performance.now())")
        && benchmarkSource.includes('"rapidWheel": rapid_wheel_screenshot_path')
        && benchmarkSource.includes('"interactivePan": interactive_pan_screenshot_path'),
      zoomEndVisualMetricRequiresCurrentZoomEndSelection:
        benchmarkSource.includes("String(entry?.reason || '').toLowerCase() === 'zoom-end'")
        && benchmarkSource.includes("expectedSelectionVersion")
        && benchmarkSource.includes("Number(entry?.selectionVersion || 0) >= Number(expectedSelectionVersion || 0)"),
      directProbeScenarioContextDoesNotLookLikeStaleMetric:
        benchmarkSource.includes("direct_probe_without_scenario_fields")
        && benchmarkSource.includes('"requestedScenarioId"')
        && benchmarkSource.includes('"sameScenario": details_match_scenario or probe_matches_scenario or direct_probe_without_scenario_fields'),
      fillActionInvalidProbeStaysReportable:
        benchmarkSource.includes("def build_invalid_fill_probe(precheck: dict, reason: str) -> dict:")
        && /explicit_validity = probe\.get\("validity"\)[\s\S]*?if explicit_validity and explicit_validity\.get\("valid"\) is False:[\s\S]*?"reason": str\(explicit_validity\.get\("reason"\) or "invalid-probe"\)/.test(benchmarkSource)
        && /if \(!interaction \|\| !state\.landData\?\.features\?\.length\) \{[\s\S]*?return invalid\('missing-prerequisites'\);/.test(benchmarkSource)
        && /if \(!candidate\) \{[\s\S]*?return invalid\('missing-target'\);/.test(benchmarkSource)
        && /if not isinstance\(target, dict\) or target\.get\("valid"\) is False:[\s\S]*?return build_invalid_fill_probe\([\s\S]*?str\(target\.get\("reason"\) if isinstance\(target, dict\) else ""\),/.test(benchmarkSource),
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

  register(38, "TNO water topology contracts keep exclusive scenario water and shared surface version signal", () => {
    const rendererSource = readRepoFile("js", "core", "map_renderer.js");
    const projectedGeometryBoundsOwnerSource = readRepoFile("js", "core", "renderer", "projected_geometry_bounds_owner.js");
    const scenarioWaterCachePolicyOwnerSource = readRepoFile("js", "core", "renderer", "scenario_water_cache_policy_owner.js");
    const spatialBuilderSource = readRepoFile("js", "core", "renderer", "spatial_index_runtime_builders.js");
    const spatialOwnerSource = readRepoFile("js", "core", "renderer", "spatial_index_runtime_owner.js");
    const scenarioApplyPipelineSource = readRepoFile("js", "core", "scenario_apply_pipeline.js");
    const startupHydrationSource = readRepoFile("js", "core", "scenario", "startup_hydration.js");
    const chunkRuntimeSource = readRepoFile("js", "core", "scenario", "chunk_runtime.js");
    const scenarioRefreshPlansSource = readRepoFile("js", "core", "map_renderer", "scenario_refresh_plans.js");
    const scenarioRefreshRuntimeSource = readRepoFile("js", "core", "map_renderer", "scenario_refresh_runtime.js");

    const checks = {
      scenarioWaterExclusiveModeComesFromManifestWithLegacyAtlantropaDefault:
        /function getScenarioWaterRegionsMode\(\) \{[\s\S]*?runtimeState\.activeScenarioManifest\?\.water_regions_mode[\s\S]*?SCENARIO_PRESENTATION_FEATURES\.ATLANTROPA_RELIEF[\s\S]*?return "exclusive";[\s\S]*?return "combined";[\s\S]*?\}/.test(rendererSource)
        && /function isScenarioWaterTopologyExclusiveMode\(\) \{[\s\S]*?return getScenarioWaterRegionsMode\(\) === "exclusive";[\s\S]*?\}/.test(rendererSource),
      tnoWaterUsesScenarioCollectionOnly:
        /function getEffectiveWaterRegionFeatures\(\) \{[\s\S]*?if \(isScenarioWaterTopologyExclusiveMode\(\)\) \{[\s\S]*?return sanitizeWaterRegionFeatures\(scenarioFeatures\.filter\(\(feature\) => !isWaterRegionExcludedByScenario\(feature\)\)\);/.test(rendererSource),
      openOceanRenderAndInteractionUseActiveOverlayGate:
        /function isOpenOceanOverlayActive\(\) \{[\s\S]*?return isOpenOceanSelectionEnabled\(\) \|\| isOpenOceanPaintEnabled\(\);[\s\S]*?\}/.test(rendererSource)
        && /function isWaterRegionRenderable\(feature\) \{[\s\S]*?if \(isOpenOceanWaterRegion\(feature\)\) \{[\s\S]*?return isOpenOceanRenderable\(\);[\s\S]*?return feature\?\.properties\?\.interactive !== false;[\s\S]*?\}/.test(rendererSource)
        && /function isWaterRegionEnabled\(feature\) \{[\s\S]*?if \(isOpenOceanWaterRegion\(feature\)\) \{[\s\S]*?return isOpenOceanOverlayActive\(\);[\s\S]*?return feature\?\.properties\?\.interactive !== false;[\s\S]*?\}/.test(rendererSource)
        && /function getWaterHitFromPointer\([\s\S]*?\) \{[\s\S]*?if \(!runtimeState\.showWaterRegions && !isOpenOceanOverlayActive\(\)\) return createHitResult\(\);/.test(rendererSource)
        && /function drawScenarioWaterFillLayer\(k, \{ waterFeatures = \[\] \} = \{\}\) \{[\s\S]*?if \(!isWaterRegionRenderable\(feature\)\) return;/.test(scenarioRegionOverlayOwnerSource)
        && /function collectWaterGridCandidates\(px, py, radiusProj = 0\) \{[\s\S]*?shouldIncludeItem: \(item\) => isWaterRegionEnabled\(item\.feature\),/.test(rendererSource)
        && /function rebuildAuxiliaryRegionIndexes\(\) \{[\s\S]*?if \(!isWaterRegionEnabled\(selectedFeature\)\) \{[\s\S]*?runtimeState\.selectedWaterRegionId = "";/.test(rendererSource)
        && /function drawScenarioWaterHighlightLayer\(k\) \{[\s\S]*?if \(!isWaterRegionEnabled\(feature\)\) return;/.test(scenarioRegionOverlayOwnerSource),
      waterSphericalDiagnosticsBacksSanitization:
        /function getSphericalGeometryDiagnostics\(geoObject\) \{[\s\S]*?const d3 = getD3\(\);[\s\S]*?d3\.geoArea[\s\S]*?d3\.geoBounds[\s\S]*?isWorldBounds\(bounds\)[\s\S]*?sphericalGeometryMaxArea/.test(projectedGeometryBoundsOwnerSource)
        && /function collectSafeWaterRegionGeometryPartsInfo\(feature\) \{[\s\S]*?isSphericalGeometryUnsafe\(part\)[\s\S]*?removedCount \+= 1;/.test(projectedGeometryBoundsOwnerSource)
        && /function sanitizeWaterRegionFeatures\(features = \[\]\) \{[\s\S]*?recordRenderPerfMetric\("waterSphericalSanitization"/.test(projectedGeometryBoundsOwnerSource)
        && /function sanitizeWaterRegionFeatures\(features = \[\]\) \{[\s\S]*?return getProjectedGeometryBoundsOwner\(\)\.sanitizeWaterRegionFeatures\(features\);/.test(rendererSource),
      waterDrawAndHighlightUseSafeParts:
        /function drawScenarioWaterFillLayer\(k, \{ waterFeatures = \[\] \} = \{\}\) \{[\s\S]*?collectSafeWaterRegionGeometryParts\(feature\)[\s\S]*?rendererSurfaceHost\.getPathCanvas\(\)\(part\)/.test(scenarioRegionOverlayOwnerSource)
        && /function drawScenarioWaterHighlightLayer\(k\) \{[\s\S]*?collectSafeWaterRegionGeometryParts\(feature\)[\s\S]*?rendererSurfaceHost\.getPathCanvas\(\)\(part\)/.test(scenarioRegionOverlayOwnerSource),
      waterFillUsesProjectionPathCacheBeforeCanvasFallback:
        /let scenarioWaterPartPathCache = new WeakMap\(\);[\s\S]*?let scenarioWaterFeaturePathCache = new WeakMap\(\);/.test(scenarioRegionOverlayOwnerSource)
        && /function getScenarioWaterFeaturePath\(feature, parts\) \{[\s\S]*?scenarioWaterFeaturePathCache\.has\(feature\)[\s\S]*?combinedPath\.addPath\(partPath\)[\s\S]*?scenarioWaterFeaturePathCache\.set\(feature, path\);/.test(scenarioRegionOverlayOwnerSource)
        && /function drawScenarioWaterFillLayer\(k, \{ waterFeatures = \[\] \} = \{\}\) \{[\s\S]*?const waterPath = visibleParts\.length === parts\.length[\s\S]*?getScenarioWaterFeaturePath\(feature, parts\)[\s\S]*?rendererSurfaceHost\.getContext\(\)\.fill\(waterPath\);[\s\S]*?getScenarioWaterPartPath\(part\)[\s\S]*?rendererSurfaceHost\.getContext\(\)\.fill\(partPath\)[\s\S]*?rendererSurfaceHost\.getPathCanvas\(\)\(part\);/.test(scenarioRegionOverlayOwnerSource),
      waterCoverageUsesSafeParts:
        /function getScreenBounds\(part\) \{[\s\S]*?const bounds = computeProjectedGeoBounds\(part\);/.test(scenarioWaterCachePolicyOwnerSource)
        && /function getScenarioWaterVisibleCoverageRatioLegacy\(waterFeatures = \[\]\) \{[\s\S]*?if \(!isWaterRegionRenderable\(feature\)\) continue;[\s\S]*?collectSafeWaterRegionGeometryParts\(feature\)[\s\S]*?getScreenBounds\(part\)/.test(scenarioWaterCachePolicyOwnerSource)
        && /function getScenarioWaterVisibleCoverageRatioGrid\(waterFeatures = \[\]\) \{[\s\S]*?if \(!isWaterRegionRenderable\(feature\)\) continue;[\s\S]*?collectSafeWaterRegionGeometryParts\(feature\)[\s\S]*?getScreenBounds\(part\)/.test(scenarioWaterCachePolicyOwnerSource),
      waterSpatialIndexSkipsUnsafeParts:
        /function buildWaterSpatialItems\(\{[\s\S]*?shouldExcludeWaterHitGeometry = \(\) => false,[\s\S]*?if \(shouldExcludeWaterHitGeometry\(hitGeometry, feature, id\)\) return;/.test(spatialBuilderSource)
        && /shouldExcludeWaterHitGeometry = \(\) => false/.test(spatialOwnerSource)
        && /shouldExcludeWaterHitGeometry,/.test(spatialOwnerSource)
        && /collectFeatureHitGeometries: collectSafeWaterRegionGeometryParts/.test(rendererSource),
      physicalLandMasksRequireD3Quality:
        /function getPhysicalLandMaskCandidateQuality\(collection, maskSource\) \{[\s\S]*?getSphericalGeometryDiagnostics\(collection\)[\s\S]*?recordRenderPerfMetric\("physicalLandMaskRejected"/.test(rendererSource)
        && /function getFirstUsablePhysicalLandMaskInfo\(candidates = \[\]\) \{[\s\S]*?getPhysicalLandMaskCandidateQuality\(candidate\.collection, candidate\.maskSource\)/.test(rendererSource),
      waterMaskAndCoastlineShareScenarioSurfaceSignal:
        /function getScenarioSurfaceVersionSignal\(\) \{\s*return getScenarioSurfaceVersionParts\(\)\.signal;\s*\}/.test(rendererSource)
        && /`water-ref:\$\{getObjectIdentityToken\(runtimeState\.scenarioWaterRegionsData, "scenario-water"\)\}`/.test(rendererSource)
        && /`water-mode:\$\{getScenarioWaterRegionsMode\(\)\}`/.test(rendererSource)
        && /maskInfo\.maskQualityToken \|\| "unchecked"/.test(rendererSource)
        && /function getScenarioSurfaceVersionParts\(waterFeatureCount = null, atlantropaCounts = null\) \{[\s\S]*?const atlantropaRevisionToken = String\(getScenarioAtlantropaRevisionToken\(atlantropaCounts\)\);[\s\S]*?return \{ signal: signal\.join\("\|"\), atlantropaRevisionToken \};/.test(rendererSource)
        && /function getScenarioWaterVisualRevisionToken\(\) \{[\s\S]*?const \{ signal, atlantropaRevisionToken \} = getScenarioSurfaceVersionParts\(\s*effectiveWaterFeatureCount, atlantropaCounts\s*\);\s*return \[\s*signal,/.test(rendererSource)
        && /function getPhysicalLandClipCacheKey\(maskInfo\) \{[\s\S]*?scenario-surface:\$\{getScenarioSurfaceVersionSignal\(\)\}/.test(rendererSource)
        && /function getCoastlineDecisionSignature\(decision = null\) \{[\s\S]*?String\(decision\.scenarioSurfaceVersionSignal \|\| ""\)/.test(staticBorderMeshLifecycleSource),
      chunkPromotionSkipsDeferredInfraWhenSecondaryIndexesAlreadySynced:
        /const synchronizedSecondaryRegionIndexes = syncScenarioSecondaryRegionIndexes\(\{[\s\S]*?const shouldSkipDeferredInfraRefresh = synchronizedSecondaryRegionIndexes && !hasPoliticalChange;[\s\S]*?if \(shouldSkipDeferredInfraRefresh\) \{[\s\S]*?scheduleHitCanvasBuildIfNeeded\(\{[\s\S]*?\}\);[\s\S]*?\} else \{[\s\S]*?scheduleDeferredScenarioChunkPromotionInfraRefresh\(\{/.test(scenarioRefreshRuntimeSource),
      startupHydrationWaterOnlyChangeSyncsSecondaryIndexes:
        /let scenarioWaterChanged = false;/.test(startupHydrationSource)
        && /scenarioWaterChanged = state\.scenarioWaterRegionsData !== nextScenarioWaterRegionsData;/.test(startupHydrationSource)
        && /hydrationChangedLayerKeys = \[[\s\S]*?\.\.\.\(scenarioWaterChanged \? \["water"\] : \[\]\),[\s\S]*?\.\.\.\(scenarioAtlantropaChanged \? \["scenario_atlantropa"\] : \[\]\),[\s\S]*?\];/.test(startupHydrationSource)
        && /if \(scenarioWaterChanged && !scenarioAtlantropaChanged && !promotedScenarioPolitical && !hasPoliticalPayloadChange\) \{[\s\S]*?refreshMapDataForScenarioChunkPromotion\(\{[\s\S]*?reason: "scenario-hydrate-water",[\s\S]*?changedLayerKeys: \["water"\],[\s\S]*?hasPoliticalPayloadChange: false,/.test(startupHydrationSource),
      chunkPromotionVisualStageReusesPrimaryDerivedStateRebuild:
        [
          "function getScenarioChunkPromotionTargetPasses({",
          '"contextMarkers"',
          '"labels"',
          "function refreshMapDataForScenarioChunkPromotion({",
          "ensureLayerDataFromTopology();",
          "rebuildPoliticalLandCollections();",
          "includeRuntimePoliticalMeta: true",
          'scheduleUiMode: "deferred"',
          "buildSpatial: true",
          "includeSecondarySpatial: false",
          "async function runDeferredScenarioChunkPromotionInfraRefresh({",
          "primaryVisibleDerivedStateReady = false",
          "completePoliticalDerivedStateReady = false",
          "primaryDerivedStateReady = false",
          "buildIndex();",
          "await buildSpatialIndexChunked({",
          "includeSecondary: false",
          "keepReady: true",
        ].every((snippet) => `${rendererSource}\n${scenarioRefreshPlansSource}\n${scenarioRefreshRuntimeSource}`.includes(snippet)),
      rebuildPoliticalLandCollectionsBreakdownExposesSyncSubsteps:
        /function rebuildPoliticalLandCollections\(\) \{[\s\S]*?let runtimeCollectionMs = 0;[\s\S]*?let composeMs = 0;[\s\S]*?let atlantropaMs = 0;[\s\S]*?let interactiveMs = 0;[\s\S]*?let coverageMs = 0;[\s\S]*?recordRenderPerfMetric\("rebuildPoliticalLandCollectionsBreakdown"[\s\S]*?scenarioChunkFeatureCount:[\s\S]*?scenarioChunkVisibleFeatureCount:[\s\S]*?runtimeCollectionMs:[\s\S]*?composeMs:[\s\S]*?atlantropaMs:[\s\S]*?interactiveMs:[\s\S]*?coverageMs:/.test(rendererSource),
      politicalChunkPromotionBreakdownExposesVisualStageSubsteps:
        /function applyScenarioPoliticalChunkPayload\(bundle, politicalPayload,[\s\S]*?const normalizeStartedAt = startedAt;[\s\S]*?const identityStartedAt = normalizeEndedAt;[\s\S]*?const compareStartedAt = identityEndedAt;[\s\S]*?recordScenarioRenderMetric\("politicalChunkPromotionBreakdown"[\s\S]*?normalizeMs:[\s\S]*?identityMs:[\s\S]*?compareMs:[\s\S]*?refreshMs:/.test(chunkRuntimeSource)
        && /if \(samePayload && samePrimaryPayload && !forceRefresh\) \{[\s\S]*?recordScenarioRenderMetric\("politicalChunkPromotionBreakdown"[\s\S]*?samePayload: true,[\s\S]*?samePrimaryPayload: true,[\s\S]*?refreshMs: 0,/.test(chunkRuntimeSource)
        && /recordScenarioRenderMetric\("politicalChunkPromotionBreakdown", finishedAt - startedAt,[\s\S]*?samePayload: false,[\s\S]*?samePrimaryPayload,[\s\S]*?forcedRefresh: !!forceRefresh,[\s\S]*?resolvedPoliticalFeatureCount: resolvedPoliticalFeatureIds\.length,/.test(chunkRuntimeSource),
      compositeScenarioRebuildKeepsScenarioRuntimeTopology:
        politicalFeaturePolicySource.includes("render_as_base_geography === false")
        && [
          "scenarioRuntimeTopologyData || runtimeState.runtimePoliticalTopology",
          "const runtimeBaseCollection = getRuntimePoliticalBaseCollection(runtimeCollection);",
          "const hasScenarioRuntimePoliticalSource = !!String(runtimeState.activeScenarioId || \"\").trim()",
          "&& !!runtimeTopology?.objects?.political;",
          "if (runtimeBaseCollection)",
          "fullCollection = runtimeBaseCollection;",
          "fullCollection = { type: \"FeatureCollection\", features: [] };",
          "scenarioPoliticalVisibleChunkCollection",
          "composePoliticalFeatureCollections(fullCollection, scenarioPoliticalChunkCollection)",
          "shouldExcludeRuntimeOnlyShellFallbackPoliticalFeature(",
        ].every((snippet) => rendererSource.includes(snippet))
        && rendererSource.includes("features.filter((feature, index) => !shouldExcludeRuntimeOnlyShellFallbackPoliticalFeature(")
        && /if \(runtimeBaseCollection\) \{[\s\S]*?fullCollection = runtimeBaseCollection;[\s\S]*?\} else if \(hasScenarioRuntimePoliticalSource\) \{[\s\S]*?fullCollection = \{ type: "FeatureCollection", features: \[\] \};[\s\S]*?\} else if \(primaryTopology\?\.objects\?\.political/.test(rendererSource),
      scenarioApplyCommitsPreparedScenarioWaterPayloadOnly:
        /function buildScenarioActivationCommitState\(bundle,\s*staged\) \{[\s\S]*?const scenarioWaterRegionsData = staged\.scenarioWaterRegionsFromTopology \|\| null;[\s\S]*?scenarioWaterRegionsData,/.test(scenarioApplyPipelineSource)
        && /commitScenarioActivationAuthorityState\(\s*runtimeState,\s*transactionPatch\.scenarioActivationPatch,\s*\);/.test(scenarioApplyPipelineSource),
    };

    Object.entries(checks).forEach(([label, ok]) => {
      assert.equal(ok, true, label);
    });
  });

  register(40, "Atlantropa field-driven interaction contracts preserve explicit render and hit layers", () => {
    const rendererSource = readRepoFile("js", "core", "map_renderer.js");
    const politicalPartialOwnerSource = readRepoFile("js", "core", "renderer", "political_partial_repaint_owner.js");
    const politicalBackgroundOwnerSource = readRepoFile("js", "core", "renderer", "political_background_render_owner.js");
    const politicalFineLoopSource = extractRendererFunction(politicalPartialOwnerSource, "drawPoliticalFineFeatureLoop");
    const projectedGeometryBoundsOwnerSource = readRepoFile("js", "core", "renderer", "projected_geometry_bounds_owner.js");
    const spatialBuilderSource = readRepoFile("js", "core", "renderer", "spatial_index_runtime_builders.js");
    const spatialOwnerSource = readRepoFile("js", "core", "renderer", "spatial_index_runtime_owner.js");
    const chunkAssetToolSource = readRepoFile("tools", "scenario_chunk_assets.py");
    const checkScenarioContractsSource = readRepoFile("tools", "check_scenario_contracts.py");
    const chunkPromotionHelperSource = readRepoFile("js", "core", "renderer", "scenario_chunk_promotion_helpers.js");
    const scenarioRefreshRuntimeSource = readRepoFile("js", "core", "map_renderer", "scenario_refresh_runtime.js");
    const interactionHitCandidateSource = readRepoFile("js", "core", "map_renderer", "interaction_hit_candidates.js");
    const colorCoverageE2eSource = readRepoFile("tests", "e2e", "dev", "scenario_chunk_exact_after_settle_regression.dev.spec.js");
    const beforeZoomProbeSource = colorCoverageE2eSource.slice(
      colorCoverageE2eSource.indexOf("const beforeZoom = await page.evaluate"),
      colorCoverageE2eSource.indexOf("expect(beforeZoom.activeScenarioId)"),
    );
    const afterZoomProbeSource = colorCoverageE2eSource.slice(
      colorCoverageE2eSource.indexOf("const afterZoom = await page.evaluate"),
      colorCoverageE2eSource.indexOf("expect(afterZoom.activeScenarioId)"),
    );
    const pixelProbeSource = readRepoFile("tests", "e2e", "support", "political-pixel-probe.js");
    const visualRenderableBody = politicalFeaturePolicySource.match(/function isPoliticalVisualRenderableFeature\(feature, featureId = null\) \{[\s\S]*?\n\}/)?.[0] || "";

    const checks = {
      hitResultShapeCarriesRuntimeCountry:
        /function createHitResult\(overrides = \{\}\) \{[\s\S]*?countryCode: null,[\s\S]*?runtimeCountryCode: null,/.test(interactionHitCandidateSource),
      interactionCountryCodeFallsBackFromDisplayOwnerToRuntimeCountry:
        /function getFeatureInteractionCountryCodeNormalized\(feature, featureId = null\) \{[\s\S]*?getDisplayOwnerCode\(feature, resolvedId\)[\s\S]*?getFeatureCountryCodeNormalized\(feature\)/.test(rendererSource),
      canvasHitPreservesRuntimeCountryAndReturnsInteractionCountry:
        /function getHitResultFromCanvas\(event\) \{[\s\S]*?countryCode: getFeatureInteractionCountryCodeNormalized\(feature, id\),[\s\S]*?runtimeCountryCode: getFeatureCountryCodeNormalized\(feature\),/.test(rendererSource),
      spatialHitPreservesRuntimeCountryAndReturnsInteractionCountry:
        /function toHitResult\([\s\S]*?const runtimeCountryCode = canonicalCountryCode\([\s\S]*?candidate\.item\.countryCode[\s\S]*?const interactionCountryCode = feature[\s\S]*?getFeatureInteractionCountryCodeNormalized\(feature, resolvedId\)[\s\S]*?countryCode: interactionCountryCode \|\| runtimeCountryCode,[\s\S]*?runtimeCountryCode,/.test(interactionHitCandidateSource)
        && /function toHitResult\(candidate,[\s\S]*?toCandidateHitResult\(candidate,[\s\S]*?getFeatureInteractionCountryCodeNormalized,/.test(rendererSource),
      booleanWeldDonorIslandHasDedicatedInteractiveEscape:
        /function isInteractiveAtlantropaBooleanWeldIslandFeature\(feature, featureId = null\) \{[\s\S]*?candidate\.startsWith\("ATLISL_"\)[\s\S]*?getAtlantropaGeometryRole\(feature\) === "donor_island"[\s\S]*?getAtlantropaJoinMode\(feature\) === "boolean_weld"[\s\S]*?\}/.test(rendererSource),
      booleanWeldIslandCanRenderAndRemainInteractive:
        /function isAtlantropaVisualSupportHelperFeature\(feature, featureId = null\) \{[\s\S]*?joinMode === "gap_fill"[\s\S]*?\}/.test(politicalFeaturePolicySource)
        && /function isAtlantropaSupportHelperFeature\(feature, featureId = null\) \{[\s\S]*?isInteractiveAtlantropaBooleanWeldIslandFeature\(feature, featureId\)[\s\S]*?return false;[\s\S]*?joinMode === "boolean_weld"[\s\S]*?\}/.test(politicalFeaturePolicySource)
        && /function isPoliticalInteractionRenderableFeature\(feature, featureId = null\) \{[\s\S]*?feature\?\.properties\?\.interactive === false[\s\S]*?isAtlantropaSupportHelperFeature\(feature, featureId\)/.test(politicalFeaturePolicySource),
      arcticShellCanRenderWithoutBecomingInteractive:
        !/shouldExcludeRuntimeOnlyShellFallbackPoliticalFeature/.test(visualRenderableBody)
        && !/isScenarioShellFeature/.test(visualRenderableBody)
        && /function isPoliticalInteractionRenderableFeature\(feature, featureId = null\) \{[\s\S]*?isScenarioShellFeature\(feature, featureId\)[\s\S]*?feature\?\.properties\?\.interactive === false/.test(politicalFeaturePolicySource),
      arcticShellUnderlayDrawsBeforeDetailFeatures:
        /function isPoliticalShellUnderlayFeature\(feature, featureId = null\) \{[\s\S]*?isRuntimeOnlyShellFallbackPoliticalFeature\(feature, featureId\)/.test(politicalFeaturePolicySource)
        && /function isPoliticalPrimaryUnderlayFeature\(feature, _featureId = null\) \{[\s\S]*?__source[\s\S]*?=== "primary";[\s\S]*?\}/.test(politicalFeaturePolicySource)
        && /function isPoliticalUnderlayFeature\(feature, featureId = null\) \{[\s\S]*?isPoliticalShellUnderlayFeature\(feature, featureId\)[\s\S]*?isPoliticalPrimaryUnderlayFeature\(feature, featureId\)/.test(politicalFeaturePolicySource)
        && /function hasPoliticalForegroundColorOverride\(featureId\) \{[\s\S]*?runtimeState\.visualOverrides\?\.\[id\][\s\S]*?runtimeState\.featureOverrides\?\.\[id\]/.test(politicalFeaturePolicySource)
        && /function isPendingPoliticalColorEditFeature\(feature, featureId = null\) \{[\s\S]*?hasPendingPoliticalColorEdit\(\)[\s\S]*?pendingPoliticalColorEditIds[\s\S]*?pendingIds\.has\(id\);/.test(politicalFeaturePolicySource)
        && /function isPoliticalForegroundFeature\(feature, featureId = null, pendingIds = undefined\) \{[\s\S]*?hasPoliticalForegroundColorOverride\(id\)[\s\S]*?isPendingPoliticalColorEditFeature\(feature, id\)/.test(politicalFeaturePolicySource)
        && /function orderPoliticalShellUnderlayFirst\(entries = \[\]\) \{[\s\S]*?const underlayEntries = \[\];[\s\S]*?const detailEntries = \[\];[\s\S]*?const foregroundEntries = \[\];[\s\S]*?isPoliticalForegroundFeature\(feature, featureId, pendingIds\)[\s\S]*?isPoliticalUnderlayFeature\(feature, featureId\)[\s\S]*?return \[\.\.\.underlayEntries, \.\.\.detailEntries, \.\.\.foregroundEntries\];/.test(politicalFeaturePolicySource)
        && /orderPoliticalShellUnderlayFirst\(redrawEntries\)\.forEach/.test(politicalPartialOwnerSource)
        && /orderPoliticalShellUnderlayFirst\(viewport\.visibleItems\)\.forEach/.test(politicalFineLoopSource)
        && /const featureEntries = state\.landData\.features\.map/.test(politicalFineLoopSource)
        && /orderPoliticalShellUnderlayFirst\(featureEntries\)\.forEach/.test(politicalFineLoopSource),
      arcticShellOwnerHintsCanColorCoalescedShells:
        /scenario_shell_owner_hint/.test(rendererSource)
        && /scenario_shell_controller_hint/.test(rendererSource),
      scenarioAtlantropaVisibilityGatesFieldDrivenRenderPaths:
        /function isScenarioAtlantropaVisible\(\) \{[\s\S]*?runtimeState\.showScenarioAtlantropa !== false;[\s\S]*?\}/.test(rendererSource)
        && /function getEffectiveAtlantropaFeatures\(\) \{[\s\S]*?if \(!isScenarioAtlantropaVisible\(\)\) \{[\s\S]*?return buckets;[\s\S]*?\}/.test(rendererSource)
        && /function isPoliticalVisualRenderableFeature\(feature, featureId = null\) \{[\s\S]*?isAtlantropaFieldDrivenFeature\(feature\) && !isScenarioAtlantropaVisible\(\)/.test(politicalFeaturePolicySource),
      fieldDrivenAtlantropaUsesExplicitInteractionFlag:
        /function isAtlantropaSupportHelperFeature\(feature, featureId = null\) \{[\s\S]*?if \(isAtlantropaFieldDrivenFeature\(feature\)\) \{[\s\S]*?return feature\?\.properties\?\.atl_interactive !== true;[\s\S]*?\}/.test(politicalFeaturePolicySource),
      backgroundMergeFiltersVisualHelpersButKeepsVisibleNonInteractiveLand:
        /function buildScenarioPoliticalBackgroundEntries\(\) \{[\s\S]*?shouldExcludePoliticalVisualFeature\(feature, id\)/.test(politicalBackgroundOwnerSource)
        && /function buildScenarioPoliticalBackgroundEntriesFromSpatialItems\(items = \[\]\) \{[\s\S]*?shouldExcludePoliticalVisualFeature\(entry\.feature, entry\.id\)/.test(politicalBackgroundOwnerSource),
      admin0BackgroundUsesDominantResolvedFillBeforeBaseColor:
        /function getAdmin0BackgroundFillColor\(countryCode\) \{[\s\S]*?const dominantFillColor = buildCountryDominantFillColorMap\(\)\.get\(canonicalCode\);[\s\S]*?return getSafeCanvasColor\(dominantFillColor, null\)[\s\S]*?getSafeCanvasColor\(getColorByCanonicalCountryCode\(runtimeState\.sovereignBaseColors, canonicalCode\), null\)[\s\S]*?getSafeCanvasColor\(getColorByCanonicalCountryCode\(runtimeState\.countryBaseColors, canonicalCode\), null\)[\s\S]*?\|\| LAND_FILL_COLOR;[\s\S]*?\}/.test(rendererSource)
        && /function drawAdmin0BackgroundFills\([\s\S]*?const fillColor = getAdmin0BackgroundFillColor\(code\);/.test(politicalBackgroundOwnerSource),
      colorCoverageOwnerDiagnosticsUseDisplayOwnerCode:
        /import\("\/js\/core\/feature_identity\.js"\)/.test(colorCoverageE2eSource)
        && /getCountryCode:\s*getSharedFeatureCountryCode/.test(colorCoverageE2eSource)
        && /getFeatureId:\s*getSharedFeatureId/.test(colorCoverageE2eSource)
        && /const normalizeCode = \(value\) => normalizeFeatureCountryCode\(value, \{ allowReserved: true \}\);/.test(colorCoverageE2eSource)
        && /getSharedFeatureCountryCode\(feature, \{[\s\S]*?fallbackCountryCode: fallback,[\s\S]*?fallbackId: fallback,[\s\S]*?\}\)/.test(colorCoverageE2eSource)
        && /getSharedFeatureId\(feature, \{ fallback \}\)/.test(colorCoverageE2eSource)
        && /ISO_A2_EH: props\.ISO_A2_EH[\s\S]*?ADM0_A2: props\.ADM0_A2[\s\S]*?__city_country_code: props\.__city_country_code/.test(colorCoverageE2eSource)
        && /const getDisplayOwnerCode = \(feature, featureId, fallbackCountryCode = ""\) => \{[\s\S]*?state\.sovereigntyByFeatureId\?\.\[featureId\][\s\S]*?state\.scenarioAutoShellOwnerByFeatureId\?\.\[featureId\][\s\S]*?shellCandidate\.startsWith\("RU_ARCTIC_FB_"\)[\s\S]*?props\.name[\s\S]*?shell fallback[\s\S]*?const displayOwnerCode = getDisplayOwnerCode\(feature, featureId, countryCode\);/.test(colorCoverageE2eSource)
        && /countryOwnerSourceMismatches\.push\(\{[\s\S]*?classification: "display-owner-source-mismatch"/.test(colorCoverageE2eSource)
        && /expect\(coverage\.missingOwnerColorCount,[\s\S]*?display owner base colors/.test(colorCoverageE2eSource),
      pixelProbeOwnerColorUsesDisplayOwnerCode:
        /import\("\/js\/core\/feature_identity\.js"\)/.test(pixelProbeSource)
        && /getCountryCode:\s*getSharedFeatureCountryCode/.test(pixelProbeSource)
        && /getFeatureId:\s*getSharedFeatureId/.test(pixelProbeSource)
        && /getSharedFeatureCountryCode\(feature, \{[\s\S]*?fallbackCountryCode: fallback,[\s\S]*?fallbackId: fallback,[\s\S]*?\}\)/.test(pixelProbeSource)
        && /getSharedFeatureId\(feature\)/.test(pixelProbeSource)
        && /normalizeFeatureCountryCode\(state\.sovereigntyByFeatureId\?\.\[featureId\][\s\S]*?allowReserved: true/.test(pixelProbeSource)
        && /shellCandidate\.startsWith\("RU_ARCTIC_FB_"\)[\s\S]*?props\.name[\s\S]*?shell fallback/.test(pixelProbeSource)
        && /const displayOwnerCode = getDisplayOwnerCode\(matchedFeature, featureId, countryCode\);/.test(pixelProbeSource)
        && /state\.sovereignBaseColors\?\.\[displayOwnerCode\][\s\S]*?state\.countryBaseColors\?\.\[displayOwnerCode\]/.test(pixelProbeSource),
      pixelProbeResolvesColorsFromFullVisualFeatures:
        /const colorFeatures = Array\.isArray\(state\.landDataFull\?\.features\) && state\.landDataFull\.features\.length[\s\S]*?\? state\.landDataFull\.features[\s\S]*?: \(Array\.isArray\(state\.landData\?\.features\) \? state\.landData\.features : \[\]\);/.test(pixelProbeSource)
        && /for \(const feature of colorFeatures\)/.test(pixelProbeSource),
      zoomRegressionResolvesColorsFromFullVisualFeatures:
        /const features = Array\.isArray\(state\.landDataFull\?\.features\) && state\.landDataFull\.features\.length[\s\S]*?\? state\.landDataFull\.features[\s\S]*?: \(Array\.isArray\(state\.landData\?\.features\) \? state\.landData\.features : \[\]\);/.test(beforeZoomProbeSource)
        && /const features = Array\.isArray\(state\.landDataFull\?\.features\) && state\.landDataFull\.features\.length[\s\S]*?\? state\.landDataFull\.features[\s\S]*?: \(Array\.isArray\(state\.landData\?\.features\) \? state\.landData\.features : \[\]\);/.test(afterZoomProbeSource)
        && /await waitForFullPoliticalColorCoverage\(page\);[\s\S]*?const beforeZoom = await page\.evaluate/.test(colorCoverageE2eSource),
      scenarioBackgroundMergeUsesVisualLandCollection:
        /function getScenarioPoliticalBackgroundLandCollection\(\) \{[\s\S]*?return state\.landDataFull \|\| state\.landData;[\s\S]*?\}/.test(politicalBackgroundOwnerSource)
        && /function shouldUseScenarioPoliticalBackgroundMerge\(\) \{[\s\S]*?const landCollection = getScenarioPoliticalBackgroundLandCollection\(\);[\s\S]*?state\.activeScenarioId[\s\S]*?landCollection\.features\.length/.test(politicalBackgroundOwnerSource)
        && /function buildScenarioPoliticalBackgroundEntries\(\) \{[\s\S]*?const landCollection = getScenarioPoliticalBackgroundLandCollection\(\);/.test(politicalBackgroundOwnerSource)
        && /function collectScenarioPoliticalBackgroundSpatialEntries\([\s\S]*?const landCollection = getScenarioPoliticalBackgroundLandCollection\(\);[\s\S]*?if \(landCollection !== state\.landData\)/.test(politicalBackgroundOwnerSource),
      backgroundMergeEntriesCacheIsViewportIndependent:
        (() => {
          const entriesBody = politicalBackgroundOwnerSource.match(/function buildScenarioPoliticalBackgroundEntries\(\) \{[\s\S]*?\r?\n  \}\r?\n\s*function buildScenarioPoliticalBackgroundEntriesFromSpatialItems/)?.[0] || "";
          return !!entriesBody
            && !entriesBody.includes("pathBoundsInScreen")
            && entriesBody.includes("viewport filtering stays in the draw path");
        })()
        && /function drawScenarioPoliticalBackgroundFills\([\s\S]*?const normalizedScreenRects = Array\.isArray\(screenRects\) && screenRects\.length[\s\S]*?const visibleEntries = normalizedScreenRects[\s\S]*?projectedBoundsIntersectScreenRects\(projectedBounds, normalizedScreenRects, \{ transform \}\)/.test(politicalBackgroundOwnerSource),
      spatialItemsCanCarryVisibleNonInteractiveLand:
        /function appendLandSpatialItemsRange\([\s\S]*?shouldExcludePoliticalVisualFeature = shouldExcludePoliticalInteractionFeature[\s\S]*?if \(shouldExcludePoliticalVisualFeature\(feature, id\)\) continue;[\s\S]*?interactive: !shouldExcludePoliticalInteractionFeature\(feature, id\)/.test(spatialBuilderSource)
        && /shouldExcludePoliticalVisualFeature = shouldExcludePoliticalInteractionFeature/.test(spatialOwnerSource)
        && /shouldExcludePoliticalVisualFeature,/.test(spatialOwnerSource),
      hitCanvasStillFiltersNonInteractiveSpatialItems:
        /const visibleSpatialItemsResult = collectVisibleLandSpatialItemsWithStats\(\{[\s\S]*?overscanPx: HIT_CANVAS_VIEWPORT_OVERSCAN_PX,[\s\S]*?\}\);[\s\S]*?const visibleSpatialItems = visibleSpatialItemsResult\.items;[\s\S]*?visibleSpatialItems\.forEach\(\(item\) => \{[\s\S]*?shouldExcludePoliticalInteractionFeature\(item\.feature, item\.id\)/.test(rendererSource)
        && /collectVisibleSpatialItemsWithStats\(\{[\s\S]*?shouldIncludeItem:[\s\S]*?!shouldExcludePoliticalVisualFeature/.test(rendererSource),
      atlantropaScenarioLayerFeedsScenarioWaterPath:
        /function getScenarioAtlantropaRevisionToken\(counts = null\) \{[\s\S]*?runtimeState\.scenarioAtlantropaData[\s\S]*?water:\$\{counts \? counts\.water : buckets\.water\.length\}/.test(rendererSource)
        && /function getScenarioAtlantropaRevisionToken\(counts = null\) \{[\s\S]*?isScenarioAtlantropaVisible\(\) \? "visible:on" : "visible:off"/.test(rendererSource)
        && /function getEffectiveWaterRegionFeatures\(\) \{[\s\S]*?\.\.\.atlantropaFeatures\.water,/.test(rendererSource)
        && /function drawScenarioAtlantropaLandLikeOverlayLayer\(k\) \{[\s\S]*?const buckets = getEffectiveAtlantropaFeatures\(\);[\s\S]*?\.\.\.buckets\.shoal,/.test(scenarioRegionOverlayOwnerSource)
        && /function drawScenarioAtlantropaLandLikeOverlayLayer\(k\) \{[\s\S]*?getSafeCanvasColor\(runtimeState\.colors\?\.\[id\], null\)[\s\S]*?getSafeCanvasColor\(getResolvedFeatureColor\(feature, id\), null\)/.test(scenarioRegionOverlayOwnerSource)
        && /function drawScenarioRegionOverlaysPass\(k\) \{[\s\S]*?const showAtlantropaLandLikeOverlay = showWater && isScenarioAtlantropaVisible\(\);[\s\S]*?if \(showAtlantropaLandLikeOverlay\) \{[\s\S]*?drawScenarioAtlantropaLandLikeOverlayLayer\(k\);[\s\S]*?\}/.test(scenarioRegionOverlayOwnerSource)
        && /function shouldExcludeWaterHitGeometry\(hitGeometry, feature = null\) \{[\s\S]*?return getProjectedGeometryBoundsOwner\(\)\.shouldExcludeWaterHitGeometry\(hitGeometry, feature\);[\s\S]*?\}/.test(rendererSource)
        && /function shouldExcludeWaterHitGeometry\(hitGeometry, _feature = null\) \{[\s\S]*?return isSphericalGeometryUnsafe\(hitGeometry\);[\s\S]*?\}/.test(projectedGeometryBoundsOwnerSource)
        && /function getUnifiedWaterBaseStyle\(feature\) \{[\s\S]*?isAtlantropaSeaFeature\(feature\)[\s\S]*?getAtlantropaSeaPoliticalFillColor\(\)/.test(rendererSource)
        && /function getWaterRegionColor\(id, feature = null\) \{[\s\S]*?const defaultStyleFeature = feature \|\| runtimeState\.waterRegionsById\?\.get\(resolvedId\);/.test(rendererSource)
        && /rendererSurfaceHost\.getContext\(\)\.fillStyle = getWaterRegionColor\(id, feature\);/.test(scenarioRegionOverlayOwnerSource)
        && /function getScenarioWaterVisualRevisionToken\(\) \{[\s\S]*?water-atlantropa:\$\{atlantropaRevisionToken\}/.test(rendererSource)
        && /let bounds = computeProjectedGeoBounds\(hitGeometry\);[\s\S]*?if \(!bounds\) \{[\s\S]*?if \(!featureBoundsComputed\) \{[\s\S]*?featureBounds = computeProjectedGeoBounds\(feature\);[\s\S]*?featureBoundsComputed = true;[\s\S]*?bounds = featureBounds;/.test(spatialBuilderSource)
        && !rendererSource.includes("atl_water_projection")
        && !rendererSource.includes("collectActiveAtlantropaSeaWaterFeatures")
        && !rendererSource.includes("getActiveAtlantropaSeaWaterProjectionState"),
      macroOceanOverridesRequirePaintMode:
        /function getWaterRegionColor\(id, feature = null\) \{[\s\S]*?const defaultStyleFeature = feature \|\| runtimeState\.waterRegionsById\?\.get\(resolvedId\);[\s\S]*?if \(isMacroOceanWaterRegion\(defaultStyleFeature\) && !isOpenOceanPaintEnabled\(\)\) \{[\s\S]*?return getWaterRegionDefaultStyle\(defaultStyleFeature\)\.fill;[\s\S]*?\}[\s\S]*?getSafeCanvasColor\(runtimeState\.waterRegionOverrides\?\.\[resolvedId\], null\)/.test(rendererSource),
      politicalPromotionTreatsAtlantropaLayerAsWaterChange:
        /const hasAtlantropaLayerChange = normalizedChangedLayerKeys\.includes\("scenario_atlantropa"\);/.test(chunkPromotionHelperSource)
        && /const effectiveChangedLayerKeys = hasAtlantropaLayerChange[\s\S]*?"water"/.test(chunkPromotionHelperSource)
        && /resolveScenarioChunkPromotionChangeSet\(\{[\s\S]*?changedLayerKeys,[\s\S]*?politicalFeatureIds,[\s\S]*?hasPoliticalPayloadChange/.test(scenarioRefreshRuntimeSource)
        && /const hasWaterChange = normalizedLayerKeys\.has\("water"\) \|\| normalizedLayerKeys\.has\("scenario_atlantropa"\);/.test(rendererSource)
        && /syncScenarioSecondaryRegionIndexes\(\{[\s\S]*?changedLayerKeys: effectiveChangedLayerKeys,/.test(scenarioRefreshRuntimeSource)
        && /function refreshMapDataForScenarioApply\([\s\S]*?const atlantropaWaterFeatureCount = getEffectiveAtlantropaFeatures\(\)\.water\.length;[\s\S]*?if \(atlantropaWaterFeatureCount > 0\) \{[\s\S]*?rebuildAuxiliaryRegionIndexes\(\);[\s\S]*?getSpatialIndexRuntimeOwner\(\)\.buildSecondarySpatialIndexes/.test(scenarioRefreshRuntimeSource)
        && /function scheduleSecondarySpatialIndexBuild\([\s\S]*?rebuildAuxiliaryRegionIndexes\(\);[\s\S]*?getSpatialIndexRuntimeOwner\(\)\.buildSecondarySpatialIndexes/.test(rendererSource),
      startupRuntimeMetaSeedAllowsShellOnlyAtlantropaLayer:
        /function collectRuntimePoliticalTopologyFeatureIds\(\) \{[\s\S]*?\["political", "scenario_atlantropa"\]\.flatMap/.test(rendererSource)
        && /function runtimePoliticalMetaSeedCoversTopology\(seed, runtimeFeatureIds\) \{[\s\S]*?seedFeatureIds\.length < runtimeFeatureIds\.length[\s\S]*?new Set\(seedFeatureIds\)[\s\S]*?seedFeatureIdSet\.has\(featureId\)/.test(rendererSource)
        && /const seedMatches = runtimePoliticalMetaSeedCoversTopology\(seed, runtimeFeatureIds\);/.test(rendererSource)
        && !/seed\.featureIds\.length === runtimeFeatureCount/.test(rendererSource),
      chunkAssetBuilderNormalizesDirectAtlantropaGeojsonForD3:
        /def _normalize_atlantropa_feature_for_d3\(feature: dict\[str, Any\]\) -> dict\[str, Any\]:/.test(chunkAssetToolSource)
        && /def _normalize_polygon_coordinates_for_d3\(polygon_coordinates: Any\) -> Any:/.test(chunkAssetToolSource)
        && /_normalize_atlantropa_feature_for_d3\(feature\)/.test(chunkAssetToolSource)
        && /\"sha256\": sha256_path\(chunk_path\)/.test(chunkAssetToolSource)
        && /\"feature_bounds\": feature_bounds_summary/.test(chunkAssetToolSource),
      strictCheckerValidatesDetailFeatureBounds:
        /def _validate_detail_chunk_feature_bounds\(/.test(checkScenarioContractsSource)
        && /require_precise_chunk_manifest = target_dir\.name == "tno_1962"/.test(checkScenarioContractsSource)
        && /feature_bounds must be present for political detail chunks/.test(checkScenarioContractsSource)
        && /feature_bounds length must match non-empty payload feature bounds/.test(checkScenarioContractsSource)
        && /feature_bounds\[\{index\}\] must match payload geometry bounds/.test(checkScenarioContractsSource),
      strictCheckerSeparatesAtlantropaCoarseAndDetailCoverage:
        /atlantropa_all_ids: set\[str\] = set\(\)/.test(checkScenarioContractsSource)
        && /atlantropa_detail_ids: set\[str\] = set\(\)/.test(checkScenarioContractsSource)
        && /if chunk_lod == "detail":[\s\S]*?atlantropa_detail_ids\.add\(feature_id\)/.test(checkScenarioContractsSource)
        && /scenario_atlantropa detail chunks must cover runtime scenario_atlantropa ids/.test(checkScenarioContractsSource),
    };

    Object.entries(checks).forEach(([label, ok]) => {
      assert.equal(ok, true, label);
    });
  });

  register(41, "renderer shell fallback policy behaves as visual-only underlay coverage", () => {
    const rendererSource = readRepoFile("js", "core", "map_renderer.js");
    const politicalPartialOwnerSource = readRepoFile("js", "core", "renderer", "political_partial_repaint_owner.js");
    const harness = createRendererShellPolicyHarness(rendererSource, politicalPartialOwnerSource);
    const shellFeature = {
      id: "RU_ARCTIC_FB_TYM_042",
      properties: {
        id: "RU_ARCTIC_FB_TYM_042",
        scenario_helper_kind: "shell_fallback",
        render_as_base_geography: false,
        interactive: false,
      },
    };
    const baseFeature = {
      id: "REAL_TYM",
      properties: {
        id: "REAL_TYM",
        cntr_code: "RU",
      },
    };
    const primaryFallbackFeature = {
      id: "FR",
      properties: {
        id: "FR",
        __source: "primary",
      },
    };
    const detailFeature = {
      id: "FR_ARR_18002",
      properties: {
        id: "FR_ARR_18002",
        __source: "detail",
      },
    };

    assert.equal(harness.isScenarioShellFeature(shellFeature, shellFeature.id), true);
    assert.equal(harness.isRuntimeOnlyShellFallbackPoliticalFeature(shellFeature, shellFeature.id), true);
    assert.equal(harness.isPoliticalVisualRenderableFeature(shellFeature, shellFeature.id), true);
    assert.equal(harness.isPoliticalInteractionRenderableFeature(shellFeature, shellFeature.id), false);
    assert.equal(harness.isPoliticalVisualRenderableFeature(baseFeature, baseFeature.id), true);
    assert.equal(harness.isPoliticalInteractionRenderableFeature(baseFeature, baseFeature.id), true);
    assert.equal(harness.isPoliticalPrimaryUnderlayFeature(primaryFallbackFeature, primaryFallbackFeature.id), true);
    assert.equal(harness.isPoliticalUnderlayFeature(detailFeature, detailFeature.id), false);
    assert.deepEqual(
      Array.from(harness.orderPoliticalShellUnderlayFirst([
        { id: baseFeature.id, feature: baseFeature },
        { id: shellFeature.id, feature: shellFeature },
      ]), (entry) => entry.id),
      [shellFeature.id, baseFeature.id],
    );
    assert.deepEqual(
      Array.from(harness.orderPoliticalShellUnderlayFirst([
        { id: detailFeature.id, feature: detailFeature },
        { id: primaryFallbackFeature.id, feature: primaryFallbackFeature },
      ]), (entry) => entry.id),
      [primaryFallbackFeature.id, detailFeature.id],
    );
    harness.setVisualOverrides({ [detailFeature.id]: "#ff00aa" });
    assert.equal(harness.hasPoliticalForegroundColorOverride(detailFeature.id), true);
    assert.equal(harness.isPoliticalForegroundFeature(detailFeature, detailFeature.id), true);
    assert.deepEqual(
      Array.from(harness.orderPoliticalShellUnderlayFirst([
        { id: detailFeature.id, feature: detailFeature },
        { id: primaryFallbackFeature.id, feature: primaryFallbackFeature },
        { id: baseFeature.id, feature: baseFeature },
      ]), (entry) => entry.id),
      [primaryFallbackFeature.id, baseFeature.id, detailFeature.id],
    );
    harness.setVisualOverrides({});
    harness.setVisualOverrides({ [primaryFallbackFeature.id]: "#ff00aa" });
    assert.equal(harness.hasPoliticalForegroundColorOverride(primaryFallbackFeature.id), true);
    assert.equal(harness.isPoliticalForegroundFeature(primaryFallbackFeature, primaryFallbackFeature.id), true);
    assert.deepEqual(
      Array.from(harness.orderPoliticalShellUnderlayFirst([
        { id: primaryFallbackFeature.id, feature: primaryFallbackFeature },
        { id: shellFeature.id, feature: shellFeature },
        { id: detailFeature.id, feature: detailFeature },
      ]), (entry) => entry.id),
      [shellFeature.id, detailFeature.id, primaryFallbackFeature.id],
    );
    harness.setVisualOverrides({});
    harness.setPendingColorEditIds([primaryFallbackFeature.id]);
    assert.equal(harness.isPendingPoliticalColorEditFeature(primaryFallbackFeature, primaryFallbackFeature.id), true);
    assert.equal(harness.isPoliticalForegroundFeature(primaryFallbackFeature, primaryFallbackFeature.id), true);
    assert.deepEqual(
      Array.from(harness.orderPoliticalShellUnderlayFirst([
        { id: detailFeature.id, feature: detailFeature },
        { id: primaryFallbackFeature.id, feature: primaryFallbackFeature },
        { id: shellFeature.id, feature: shellFeature },
      ]), (entry) => entry.id),
      [shellFeature.id, detailFeature.id, primaryFallbackFeature.id],
    );
    harness.setPendingColorEditIds([]);
    harness.setPendingColorEditIds([baseFeature.id]);
    assert.equal(harness.isPendingPoliticalColorEditFeature(baseFeature, baseFeature.id), true);
    assert.equal(harness.isPoliticalForegroundFeature(baseFeature, baseFeature.id), true);
    assert.deepEqual(
      Array.from(harness.orderPoliticalShellUnderlayFirst([
        { id: baseFeature.id, feature: baseFeature },
        { id: shellFeature.id, feature: shellFeature },
        { id: detailFeature.id, feature: detailFeature },
      ]), (entry) => entry.id),
      [shellFeature.id, detailFeature.id, baseFeature.id],
    );
    harness.setPendingColorEditIds([]);

    const mixedCollection = {
      type: "FeatureCollection",
      features: [shellFeature, baseFeature],
    };
    assert.deepEqual(
      harness.getRuntimePoliticalBaseCollection(mixedCollection).features.map((feature) => feature.id),
      [baseFeature.id],
    );
    harness.setMapSemanticMode("blank");
    assert.equal(harness.getRuntimePoliticalBaseCollection({ type: "FeatureCollection", features: [shellFeature] }).features.length, 1);
  });

  register(42, "post-edit visual override remains foreground after chunk promotion clears pending edit", () => {
    const rendererSource = readRepoFile("js", "core", "map_renderer.js");
    const politicalPartialOwnerSource = readRepoFile("js", "core", "renderer", "political_partial_repaint_owner.js");
    const harness = createRendererShellPolicyHarness(rendererSource, politicalPartialOwnerSource);
    const primaryFallbackFeature = {
      id: "FR",
      properties: {
        id: "FR",
        __source: "primary",
        fill: "#0f0f65",
      },
    };
    const baseFeature = {
      id: "REAL_FR",
      properties: {
        id: "REAL_FR",
        cntr_code: "FR",
        fill: "#0f0f65",
      },
    };
    const editedDetailFeature = {
      id: "FR_ARR_18002",
      properties: {
        id: "FR_ARR_18002",
        __source: "detail",
        fill: "#0f0f65",
      },
    };

    harness.setColors({
      [primaryFallbackFeature.id]: "#0f0f65",
      [baseFeature.id]: "#0f0f65",
      [editedDetailFeature.id]: "#ff00aa",
    });
    harness.setVisualOverrides({ [editedDetailFeature.id]: "#ff00aa" });
    harness.setPendingColorEditIds([editedDetailFeature.id]);

    assert.equal(harness.isPoliticalForegroundFeature(editedDetailFeature, editedDetailFeature.id), true);
    assert.equal(
      harness.getPoliticalFeatureFillColor(editedDetailFeature, editedDetailFeature.id, 0, 1000),
      "#ff00aa",
    );
    assert.deepEqual(
      Array.from(harness.orderPoliticalShellUnderlayFirst([
        { id: editedDetailFeature.id, feature: editedDetailFeature },
        { id: primaryFallbackFeature.id, feature: primaryFallbackFeature },
        { id: baseFeature.id, feature: baseFeature },
      ]), (entry) => entry.id),
      [primaryFallbackFeature.id, baseFeature.id, editedDetailFeature.id],
    );

    harness.setPendingColorEditIds([]);
    assert.equal(harness.isPoliticalForegroundFeature(editedDetailFeature, editedDetailFeature.id), true);
    assert.equal(
      harness.getPoliticalFeatureFillColor(editedDetailFeature, editedDetailFeature.id, 0, 1000),
      "#ff00aa",
    );
    assert.deepEqual(
      Array.from(harness.orderPoliticalShellUnderlayFirst([
        { id: editedDetailFeature.id, feature: editedDetailFeature },
        { id: primaryFallbackFeature.id, feature: primaryFallbackFeature },
        { id: baseFeature.id, feature: baseFeature },
      ]), (entry) => entry.id),
      [primaryFallbackFeature.id, baseFeature.id, editedDetailFeature.id],
    );
  });

  register(43, "TNO Russian Arctic shell fallbacks remain visual-only political coverage", () => {
    const rendererSource = readRepoFile("js", "core", "map_renderer.js");
    const visualRenderableBody = politicalFeaturePolicySource.match(/function isPoliticalVisualRenderableFeature\(feature, featureId = null\) \{[\s\S]*?\n\}/)?.[0] || "";
    const interactionRenderableBody = politicalFeaturePolicySource.match(/function isPoliticalInteractionRenderableFeature\(feature, featureId = null\) \{[\s\S]*?\n\}/)?.[0] || "";
    const coarsePoliticalChunk = JSON.parse(readRepoFile("data", "scenarios", "tno_1962", "chunks", "political.coarse.r0c0.json"));
    const countries = JSON.parse(readRepoFile("data", "scenarios", "tno_1962", "countries.json")).countries || {};
    const ownersByFeature = JSON.parse(readRepoFile("data", "scenarios", "tno_1962", "owners.by_feature.json"));
    const arcticShells = (coarsePoliticalChunk.features || [])
      .filter((feature) => getFeatureId(feature).startsWith("RU_ARCTIC_FB_"))
      .map((feature) => ({
        feature,
        featureId: getFeatureId(feature),
        bounds: getCoordinateBounds(feature?.geometry?.coordinates),
      }))
      .filter((entry) => entry.bounds.maxLat >= 73);

    assert.ok(arcticShells.length >= 3, `expected high-latitude RU_ARCTIC_FB shell coverage, found ${arcticShells.length}`);
    assert.equal(
      visualRenderableBody.includes("shouldExcludeRuntimeOnlyShellFallbackPoliticalFeature"),
      false,
      "runtime-only shell collection filtering must not block per-feature political fill",
    );
    assert.match(
      interactionRenderableBody,
      /isScenarioShellFeature\(feature, featureId\)/,
      "scenario shells must remain excluded from political interaction",
    );
    assert.match(
      rendererSource,
      /function getRuntimePoliticalBaseCollection\(collection\) \{[\s\S]*?shouldExcludeRuntimeOnlyShellFallbackPoliticalFeature\(/,
      "runtime political base collection still filters shell-only payloads",
    );

    arcticShells.forEach(({ feature, featureId, bounds }) => {
      const properties = feature?.properties || {};
      const ownerHint = String(properties.scenario_shell_owner_hint || "").trim().toUpperCase();
      assert.equal(properties.scenario_helper_kind, "shell_fallback", `${featureId} must stay marked as a shell fallback`);
      assert.equal(properties.render_as_base_geography, false, `${featureId} should be political fill coverage, not base geography`);
      assert.equal(properties.interactive, false, `${featureId} must stay non-interactive`);
      assert.equal(Object.hasOwn(ownersByFeature, featureId), false, `${featureId} should rely on owner hints instead of owners.by_feature`);
      assert.ok(ownerHint, `${featureId} needs a scenario shell owner hint`);
      assert.match(String(countries[ownerHint]?.color_hex || ""), /^#[0-9a-f]{6}$/i, `${featureId} owner hint ${ownerHint} needs a country color`);
      assert.ok(bounds.maxLat >= 73, `${featureId} should cover the reported high-latitude band`);
    });
  });

  register(44, "TNO ATLSEA chunk GeoJSON donor seas stay d3-small and local", () => {
    const d3 = loadVendorD3();
    const chunkManifest = JSON.parse(readRepoFile("data", "scenarios", "tno_1962", "detail_chunks.manifest.json"));
    const atlantropaChunks = getManifestChunksByLayer(chunkManifest, "scenario_atlantropa");
    assert.ok(atlantropaChunks.length > 0, "scenario_atlantropa chunks must carry Atlantropa donor seas");
    const checkedPayloads = atlantropaChunks.map(readManifestChunkPayload);
    let donorSeaCount = 0;

    checkedPayloads.forEach((payload) => {
      (payload.features || []).forEach((feature) => {
        const props = feature?.properties || {};
        const featureId = String(props.id || "").trim();
        if (!featureId.startsWith("ATLSEA_") || featureId.startsWith("ATLSEA_FILL_")) return;
        if (String(props.atl_geometry_role || "").trim().toLowerCase() !== "donor_sea") return;
        donorSeaCount += 1;
        const area = d3.geoArea(feature);
        const bounds = d3.geoBounds(feature);
        assert.equal(isWorldGeoBounds(bounds), false, `${featureId} must not render as global water shell`);
        assert.ok(area < 0.05, `${featureId} spherical area must stay local: ${area}`);
        if (featureId === "ATLSEA_adriatica_8597_5838_0") {
          assert.equal(d3.geoContains(feature, [18, 41.6]), true, `${featureId} should contain its Adriatic basin probe`);
          assert.equal(d3.geoContains(feature, [-150, 0]), false, `${featureId} should not contain a global ocean probe`);
        }
      });
    });

    assert.ok(donorSeaCount >= 100, `expected ATLSEA donor seas in checked chunks, found ${donorSeaCount}`);
  });

  register(67, "political raster renderer request identity includes viewport and pass signature", () => {
    const rendererSource = readRepoFile("js", "core", "map_renderer.js");
    const politicalPartialOwnerSource = readRepoFile("js", "core", "renderer", "political_partial_repaint_owner.js");
    const politicalPassOwnerSource = readRepoFile(
      "js",
      "core",
      "renderer",
      "political_pass_orchestrator_owner.js",
    );
    const workerClientSource = readRepoFile("js", "core", "political_raster_worker_client.js");
    const workerSource = readRepoFile("js", "workers", "political_raster.worker.js");
    const identitySource = extractRendererFunction(politicalPartialOwnerSource, "resolvePoliticalPassIdentity");
    const viewportSource = extractRendererFunction(politicalPartialOwnerSource, "resolvePoliticalPassViewport");
    const packetSource = extractRendererFunction(rendererSource, "buildPoliticalPassWorkerPacket");
    const requestSource = extractRendererFunction(politicalPartialOwnerSource, "requestPoliticalPassWorker");
    const ownerDrawSource = extractRendererFunction(politicalPassOwnerSource, "drawPoliticalPass");

    assert.ok(rendererSource.includes("function getTransformBucketSignature("));
    assert.ok(identitySource.includes("const [canvasWidth, canvasHeight] = helper.getLogicalCanvasDimensions();"));
    assert.ok(/createPoliticalRasterWorkerIdentity\(\{[\s\S]*?sceneGeneration: sceneIdentity\.sceneGeneration,[\s\S]*?scenarioDataGeneration: sceneIdentity\.scenarioDataGeneration,[\s\S]*?selectionVersion: sceneIdentity\.selectionVersion \|\| Number\(loadState\?\.selectionVersion \|\| 0\),[\s\S]*?topologyRevision: sceneIdentity\.topologyRevision,[\s\S]*?colorRevision: sceneIdentity\.colorRevision,[\s\S]*?transformBucket: sceneIdentity\.transformBucket,[\s\S]*?dpr: sceneIdentity\.dpr,/.test(identitySource));
    assert.ok(/viewport: \{[\s\S]*?width: canvasWidth,[\s\S]*?height: canvasHeight,[\s\S]*?right: canvasWidth,[\s\S]*?bottom: canvasHeight,[\s\S]*?\}/.test(identitySource));
    assert.ok(identitySource.includes('passSignature: helper.getRenderPassSignature("political", transform),'));
    assert.ok(/const screenRects = \[\{[\s\S]*?maxX: identity\.canvasWidth \+ politicalOverscanPx,[\s\S]*?maxY: identity\.canvasHeight \+ politicalOverscanPx/.test(viewportSource));
    assert.ok(ownerDrawSource.includes("const consumedBitmapResult = consumePoliticalRasterWorkerBitmapResult(identity.workerIdentity);"));
    assert.ok(
      ownerDrawSource.indexOf("const consumedBitmapResult = consumePoliticalRasterWorkerBitmapResult(identity.workerIdentity);")
        < ownerDrawSource.indexOf("const backgroundStartedAt = nowMs();"),
    );
    assert.ok(packetSource.includes("buildPoliticalRasterWorkerPacket({"));
    assert.ok(/effect\.requestPoliticalRasterWorkerPass\(\{[\s\S]*?identity: identity\.workerIdentity,[\s\S]*?rasterPacket: packetState\.packet,[\s\S]*?packetBuildMs: packetState\.packetBuildMs/.test(requestSource));
    assert.ok(requestSource.includes("canvasPxWidth: packetState.packet?.canvasPxWidth"));
    assert.ok(requestSource.includes("canvasPxHeight: packetState.packet?.canvasPxHeight"));
    assert.ok(requestSource.includes("onAcceptedBitmapResult: effect.onAcceptedBitmapResult"));
    assert.ok(rendererSource.includes('invalidateRenderPasses("political", "political-raster-worker-bitmap-ready");'));
    assert.ok(/function normalizeViewportIdentity\(viewport = null\)[\s\S]*?\["x", "y", "width", "height", "left", "top", "right", "bottom"\]/.test(workerClientSource));
    assert.ok(/Number\(request\.sceneGeneration \|\| 0\) === Number\(current\.sceneGeneration \|\| 0\)/.test(workerClientSource));
    assert.ok(/Number\(request\.scenarioDataGeneration \|\| 0\) === Number\(current\.scenarioDataGeneration \|\| 0\)/.test(workerClientSource));
    assert.ok(/String\(request\.passSignature \|\| ""\) === String\(current\.passSignature \|\| ""\)/.test(workerClientSource));
    assert.ok(/normalizeViewportIdentity\(request\.viewport\) === normalizeViewportIdentity\(current\.viewport\)/.test(workerClientSource));
    assert.ok(workerSource.includes("passSignature: String(identity.passSignature || \"\")"));
    assert.ok(workerSource.includes("viewport: identity.viewport || null"));
  });

  register(68, "political patch overlay and first-pixel source are explicit layer contracts", () => {
    const rendererSource = readRepoFile("js", "core", "map_renderer.js");
    const politicalPartialOwnerSource = readRepoFile("js", "core", "renderer", "political_partial_repaint_owner.js");
    const drawCanvasOrchestrationOwnerSource = readRepoFile(
      "js",
      "core",
      "map_renderer",
      "draw_canvas_orchestration_owner.js",
    );
    const layerManagerSource = readRepoFile("js", "core", "map_renderer", "canvas_layer_manager.js");
    const packetSource = readRepoFile("js", "core", "map_renderer", "political_raster_worker_packet.js");
    const runtimeStateSource = readRepoFile("js", "core", "state", "renderer_runtime_state.js");

    assert.ok(layerManagerSource.includes('id: "map-political-patch-canvas"'));
    assert.ok(layerManagerSource.includes('id: "map-interaction-overlay-canvas"'));
    assert.ok(rendererSource.includes("function paintPoliticalPatchOverlayForIds"));
    assert.ok(rendererSource.includes("function clearPoliticalPatchOverlayIfStale"));
    assert.ok(rendererSource.includes("pendingPoliticalPatchOverlayTransformSignature"));
    assert.ok(drawCanvasOrchestrationOwnerSource.includes('clearPoliticalPatchOverlayIfStale("drawCanvas-stale-overlay")'));
    assert.ok(layerManagerSource.includes("function shouldClearStaleCanvasOverlay"));
    assert.ok(rendererSource.includes('recordRenderPerfMetric("politicalPatchOverlayPaint"'));
    assert.ok(rendererSource.includes('recordRenderPerfMetric("politicalPatchOverlayClear"'));
    assert.ok(rendererSource.includes('paintSource: "political-patch-overlay"'));
    assert.ok(/function buildPoliticalRasterWorkerPacket\(options = \{\}\) \{[\s\S]*?return getPoliticalPartialRepaintOwner\(\)\.buildPoliticalRasterWorkerPacket\(options\);/.test(rendererSource));
    assert.ok(/function getPoliticalPartialRepaintOwner\(\) \{[\s\S]*?helpers: \{[\s\S]*?buildWorkerPixelRingsForGeometry,/.test(rendererSource));
    assert.ok(politicalPartialOwnerSource.includes("helper.buildWorkerPixelRingsForGeometry("));
    assert.ok(packetSource.includes("function collectRasterPolygonalGeometryParts"));
    assert.ok(packetSource.includes('geometryType === "GeometryCollection"'));
    assert.ok(runtimeStateSource.includes("pendingPoliticalColorEditFirstPixelRecorded: false"));
    assert.ok(runtimeStateSource.includes('pendingPoliticalColorEditFirstPixelPaintSource: ""'));
    assert.ok(runtimeStateSource.includes('pendingPoliticalPatchOverlayTransformSignature: ""'));
  });

  register(69, "startup render samples expose hot-path details", () => {
    const rendererSource = readRepoFile("js", "core", "map_renderer.js");
    const renderStart = rendererSource.indexOf("function render()");
    const renderEnd = rendererSource.indexOf("function autoFillMap(", renderStart);
    const renderSource = renderStart >= 0 && renderEnd > renderStart
      ? rendererSource.slice(renderStart, renderEnd)
      : "";

    assert.ok(renderSource.includes("const metricSequenceStartedAt = startedAt > 0"));
    assert.ok(renderSource.includes('politicalBgMs: readRenderPerfMetricDuration("drawPoliticalBackgroundFillsPass", metricSequenceStartedAt)'));
    assert.ok(renderSource.includes('politicalRecoveryQuality: readRenderPerfMetricString("drawPoliticalBackgroundFillsPass", "recoveryQuality", metricSequenceStartedAt)'));
    assert.ok(renderSource.includes('politicalBgProgressive: readRenderPerfMetricBoolean("drawPoliticalBackgroundFillsPass", "progressive", metricSequenceStartedAt)'));
    assert.ok(renderSource.includes('politicalBgDeferredFullCacheScheduled: readRenderPerfMetricBoolean("drawPoliticalBackgroundFillsPass", "deferredFullCacheScheduled", metricSequenceStartedAt)'));
    assert.ok(renderSource.includes('politicalBgDeferredFullCacheReady: readRenderPerfMetricBoolean("drawPoliticalBackgroundFillsPass", "deferredFullCacheReady", metricSequenceStartedAt)'));
    assert.ok(renderSource.includes('politicalBgCacheBuildMs: readRenderPerfMetricDuration("scenarioPoliticalBackgroundCacheBuild", metricSequenceStartedAt)'));
    assert.ok(renderSource.includes('politicalBgCacheEntryCount: readRenderPerfMetricNumber("scenarioPoliticalBackgroundCacheBuild", "entryCount", metricSequenceStartedAt)'));
    assert.ok(renderSource.includes('politicalBgCacheBuiltPathCount: readRenderPerfMetricNumber("scenarioPoliticalBackgroundCacheBuild", "builtPathCount", metricSequenceStartedAt)'));
    assert.ok(renderSource.includes('politicalBgCachePathCacheSizeBefore: readRenderPerfMetricNumber("scenarioPoliticalBackgroundCacheBuild", "pathCacheSizeBefore", metricSequenceStartedAt)'));
    assert.ok(renderSource.includes('politicalBgCachePathCacheSizeAfter: readRenderPerfMetricNumber("scenarioPoliticalBackgroundCacheBuild", "pathCacheSizeAfter", metricSequenceStartedAt)'));
    assert.ok(renderSource.includes('politicalBgCachePathCacheResetPreviousReason: readRenderPerfMetricString("scenarioPoliticalBackgroundCacheBuild", "pathCacheResetPreviousReason", metricSequenceStartedAt)'));
    assert.ok(renderSource.includes('politicalBgDeferredFullCacheBuildMs: readRenderPerfMetricDuration("scenarioPoliticalBackgroundDeferredFullCacheBuild", metricSequenceStartedAt)'));
    assert.ok(renderSource.includes('politicalBgDeferredFullCacheEntryCount: readRenderPerfMetricNumber("scenarioPoliticalBackgroundDeferredFullCacheBuild", "entryCount", metricSequenceStartedAt)'));
    assert.ok(renderSource.includes('politicalBgDeferredFullCacheBuiltPathCount: readRenderPerfMetricNumber("scenarioPoliticalBackgroundDeferredFullCacheBuild", "builtPathCount", metricSequenceStartedAt)'));
    assert.ok(renderSource.includes('politicalFeatureFillMs: readRenderPerfMetricDuration("drawPoliticalFeatureFillLoop", metricSequenceStartedAt)'));
    assert.ok(renderSource.includes('contextScenarioMs: readRenderPerfMetricDuration("drawContextScenarioPass", metricSequenceStartedAt)'));
    assert.ok(renderSource.includes('hitCanvasMs: readRenderPerfMetricDuration("buildHitCanvas", metricSequenceStartedAt)'));
  });

  register(70, "render perf metric sequence filter excludes previous-frame metrics", () => {
    const rendererSource = readRepoFile("js", "core", "map_renderer.js");
    const match = rendererSource.match(/function readRenderPerfMetricDuration\(metricName, minSequence = 0\) \{[\s\S]*?\n\}/);
    assert.ok(match, "readRenderPerfMetricDuration should stay available for render sample filtering");
    const readRenderPerfMetricDuration = Function(
      "runtimeState",
      `${match[0]}; return readRenderPerfMetricDuration;`,
    )({
      renderPerfMetrics: {
        previousFrame: {
          durationMs: 33,
          sequence: 10,
        },
        currentFrame: {
          durationMs: 44,
          sequence: 11,
        },
        missingSequence: {
          durationMs: 55,
        },
      },
    });

    assert.equal(readRenderPerfMetricDuration("previousFrame", 10), 0);
    assert.equal(readRenderPerfMetricDuration("currentFrame", 10), 44);
    assert.equal(readRenderPerfMetricDuration("previousFrame", 9), 33);
    assert.equal(readRenderPerfMetricDuration("missingSequence", 10), 0);

    const numberMatch = rendererSource.match(/function readRenderPerfMetricNumber\(metricName, fieldName, minSequence = 0\) \{[\s\S]*?\n\}/);
    assert.ok(numberMatch, "readRenderPerfMetricNumber should share the render sample sequence filter");
    const readRenderPerfMetricNumber = Function(
      "runtimeState",
      `${numberMatch[0]}; return readRenderPerfMetricNumber;`,
    )({
      renderPerfMetrics: {
        previousFrame: {
          entryCount: 77,
          sequence: 10,
        },
        currentFrame: {
          entryCount: 88,
          sequence: 11,
        },
      },
    });
    assert.equal(readRenderPerfMetricNumber("previousFrame", "entryCount", 10), 0);
    assert.equal(readRenderPerfMetricNumber("currentFrame", "entryCount", 10), 88);

    const stringMatch = rendererSource.match(/function readRenderPerfMetricString\(metricName, fieldName, minSequence = 0\) \{[\s\S]*?\n\}/);
    assert.ok(stringMatch, "readRenderPerfMetricString should share the render sample sequence filter");
    const readRenderPerfMetricString = Function(
      "runtimeState",
      `${stringMatch[0]}; return readRenderPerfMetricString;`,
    )({
      renderPerfMetrics: {
        previousFrame: {
          reason: "old",
          sequence: 10,
        },
        currentFrame: {
          reason: "current",
          sequence: 11,
        },
      },
    });
    assert.equal(readRenderPerfMetricString("previousFrame", "reason", 10), "");
    assert.equal(readRenderPerfMetricString("currentFrame", "reason", 10), "current");

    const booleanMatch = rendererSource.match(/function readRenderPerfMetricBoolean\(metricName, fieldName, minSequence = 0\) \{[\s\S]*?\n\}/);
    assert.ok(booleanMatch, "readRenderPerfMetricBoolean should share the render sample sequence filter");
    const readRenderPerfMetricBoolean = Function(
      "runtimeState",
      `${booleanMatch[0]}; return readRenderPerfMetricBoolean;`,
    )({
      renderPerfMetrics: {
        previousFrame: {
          progressive: true,
          sequence: 10,
        },
        currentFrame: {
          progressive: true,
          sequence: 11,
        },
      },
    });
    assert.equal(readRenderPerfMetricBoolean("previousFrame", "progressive", 10), false);
    assert.equal(readRenderPerfMetricBoolean("currentFrame", "progressive", 10), true);
  });

  register(71, "political path cache reset exposes invalidation reason and previous size", () => {
    const rendererSource = readRepoFile("js", "core", "map_renderer.js");
    const politicalPathCacheSource = readRepoFile("js", "core", "renderer", "political_path_cache_owner.js")
      .replace(/^  /gm, "");
    const politicalBackgroundOwnerSource = readRepoFile("js", "core", "renderer", "political_background_render_owner.js");
    const invalidateBody = politicalPathCacheSource.match(/function invalidatePoliticalPathCache\(reason = "unspecified"\) \{[\s\S]*?\n\}/)?.[0] || "";
    assert.ok(invalidateBody.includes('recordRenderPerfMetric("politicalPathCacheReset"'));
    assert.ok(invalidateBody.includes("previousSize"));
    assert.ok(invalidateBody.includes("previousSignature"));
    assert.ok(invalidateBody.includes("previousReason"));

    const handleBody = politicalPathCacheSource.match(/function getPoliticalPathCacheHandle\([\s\S]*?\n\}/)?.[0] || "";
    assert.ok(handleBody.includes('recordRenderPerfMetric("politicalPathCacheReset"'));
    assert.ok(handleBody.includes('reason: "prepare-mismatch"'));
    assert.ok(handleBody.includes("nextSignature: signature"));
    const signatureBody = politicalPathCacheSource.match(/function getPoliticalPathCacheSignature\([\s\S]*?\n\}/)?.[0] || "";
    [
      "getPoliticalPassStaticSignature(transform)",
      "getProjectionRenderSignature()",
      "getViewportRenderSignature()",
      "String(runtimeState.activeScenarioId || \"\")",
      "\"ownership\"",
      "Number(runtimeState.sovereigntyRevision || 0)",
      "Number(runtimeState.scenarioShellOverlayRevision || 0)",
    ].forEach((signatureInput) => {
      assert.ok(signatureBody.includes(signatureInput), `political path cache signature should include ${signatureInput}`);
    });
    assert.ok(rendererSource.includes("runtimeState.topologyRevision || 0"));
    const entryBody = politicalPathCacheSource.match(/function buildPoliticalFeaturePathEntry\(feature\) \{[\s\S]*?\n\}/)?.[0] || "";
    assert.ok(entryBody.includes("path: new globalThis.Path2D(pathString)"));
    assert.equal(entryBody.includes("featureRef"), false);
    assert.equal(entryBody.includes("projectionSignature"), false);
    const getEntryBody = politicalPathCacheSource.match(/function getPoliticalFeaturePathEntry\([\s\S]*?\n\}/)?.[0] || "";
    assert.ok(getEntryBody.includes("if (cachedEntry?.path)"));
    assert.ok(politicalBackgroundOwnerSource.includes("pathCacheSizeBefore"));
    assert.ok(politicalBackgroundOwnerSource.includes("pathCacheSizeAfter"));
    assert.ok(politicalBackgroundOwnerSource.includes("pathCacheResetReason"));
    assert.ok(politicalBackgroundOwnerSource.includes("pathCacheResetPreviousSize"));
    assert.ok(politicalBackgroundOwnerSource.includes("pathCacheResetPreviousReason"));
  });
}
