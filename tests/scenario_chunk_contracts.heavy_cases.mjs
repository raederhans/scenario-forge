import { createRequire } from "node:module";
import "../js/core/scenario_chunk_format_shared.js";
import {
  test,
  assert,
  normalizeScenarioChunkManifest,
  selectScenarioChunks,
  readRepoFile,
  loadVendorD3,
  isWorldGeoBounds,
  getManifestChunksByLayer,
  readManifestChunkPayload,
  getFeatureId,
  getTopologyGeometryId,
  getCoordinateBounds,
  createPoliticalPolicyFixture,
  createFirstVisibleFrameGateHarness,
  getPolygonCoordinateSets,
  getRingSignedArea,
} from "./helpers/scenario_chunk_contract_support.mjs";
import { readJsonSource } from "./helpers/read_json_source.mjs";

const topojson = createRequire(import.meta.url)("../vendor/topojson-client.min.js");
const { decodeScenarioChunkPayload } = globalThis.__scenarioForgeScenarioChunkFormatShared;

const defaultRegister = (_order, ...args) => test(...args);

export function registerScenarioChunkContractHeavyTests(register = defaultRegister) {
  register(25, "tno render budget sets political cold selection caps", () => {
    const manifest = JSON.parse(readRepoFile("data", "scenarios", "tno_1962", "manifest.json"));
    const hints = manifest.render_budget_hints || {};

    assert.equal(hints.max_required_political_chunks, 6);
    assert.equal(hints.min_required_political_chunks, 1);
    assert.equal(hints.max_required_political_estimated_path_cost, 680_000);
    assert.equal(hints.max_required_political_byte_size, 45_000_000);
  });

  register(26, "checked-in political coarse chunks match complete runtime political geometry", () => {
    for (const scenarioId of ["tno_1962", "hoi4_1939"]) {
      const chunkManifest = JSON.parse(readRepoFile("data", "scenarios", scenarioId, "detail_chunks.manifest.json"));
      const bootstrapTopology = JSON.parse(readRepoFile("data", "scenarios", scenarioId, "runtime_topology.bootstrap.topo.json"));
      const runtimeTopology = readJsonSource(new URL(`../data/scenarios/${scenarioId}/runtime_topology.topo.json`, import.meta.url));
      const bootstrapPoliticalCount = bootstrapTopology.objects?.political?.geometries?.length || 0;
      const runtimePoliticalCount = runtimeTopology.objects?.political?.geometries?.length || 0;
      const coarseChunk = chunkManifest.chunks.find((chunk) => chunk.id === "political.coarse.r0c0");
      const coarsePayload = decodeScenarioChunkPayload(readManifestChunkPayload(coarseChunk), topojson);

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
        if (props.atl_geometry_role !== "donor_island") continue;
        const isRequired = requiredIslandIds.has(featureId);
        if (isRequired) {
          visitedRequiredIds.add(featureId);
          assert.equal(props.atl_join_mode, featureId === "ATLISL_aegean_crete" ? "boolean_weld" : "none");
        }
        if (props.atl_join_mode === "boolean_weld") visitedBooleanWeldIds.add(featureId);
        else if (!isRequired) continue;
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

  register(41, "renderer shell fallback policy behaves as visual-only underlay coverage", () => {
    const harness = createPoliticalPolicyFixture();
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
    assert.equal(harness.shouldExcludeRuntimeOnlyShellFallbackPoliticalFeature(shellFeature, shellFeature.id), true);
    assert.equal(harness.shouldExcludePoliticalVisualFeature(shellFeature, shellFeature.id), false);
    assert.equal(harness.isPoliticalInteractionRenderableFeature(shellFeature, shellFeature.id), false);
    assert.equal(harness.shouldExcludePoliticalVisualFeature(baseFeature, baseFeature.id), false);
    assert.equal(harness.isPoliticalInteractionRenderableFeature(baseFeature, baseFeature.id), true);
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
    assert.equal(harness.hasVisiblePoliticalForegroundColorOverride([{ id: detailFeature.id, feature: detailFeature }]), true);
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
    assert.equal(harness.hasVisiblePoliticalForegroundColorOverride([{ id: primaryFallbackFeature.id, feature: primaryFallbackFeature }]), true);
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
      mixedCollection.features
        .filter((feature) => !harness.shouldExcludeRuntimeOnlyShellFallbackPoliticalFeature(feature, feature.id))
        .map((feature) => feature.id),
      [baseFeature.id],
    );
    harness.setMapSemanticMode("blank");
    assert.equal(harness.shouldExcludeRuntimeOnlyShellFallbackPoliticalFeature(shellFeature, shellFeature.id), false);

    const fullSource = [detailFeature, primaryFallbackFeature, baseFeature, shellFeature];
    const shuffled = [baseFeature, shellFeature, primaryFallbackFeature, detailFeature]
      .map(feature => ({ id: feature.id, feature }));
    harness.setPoliticalSourceFeatures(fullSource);
    harness.setVisualOverrides({ [detailFeature.id]: "#ff00aa", [primaryFallbackFeature.id]: "#ff00aa" });
    harness.setPendingColorEditIds([detailFeature.id]);
    harness.setStablePaintOrderEnabled(true);
    assert.deepEqual(Array.from(harness.orderPoliticalShellUnderlayFirst(shuffled), entry => entry.id),
      [primaryFallbackFeature.id, shellFeature.id, detailFeature.id, baseFeature.id],
      "river mode inherits complete source ranks without color/pending promotion");
    assert.deepEqual(Array.from(harness.orderPoliticalShellUnderlayFirst([shuffled[0], shuffled[3]]), entry => entry.id),
      [detailFeature.id, baseFeature.id], "visible subsets keep full-source rank");
    harness.setStablePaintOrderEnabled(false);
    assert.deepEqual(Array.from(harness.orderPoliticalShellUnderlayFirst(shuffled), entry => entry.id),
      [shellFeature.id, baseFeature.id, primaryFallbackFeature.id, detailFeature.id],
      "leaving river mode restores ordinary foreground promotion");
  });

  register(42, "post-edit visual override remains foreground after chunk promotion clears pending edit", () => {
    const harness = createPoliticalPolicyFixture();
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

    harness.setVisualOverrides({ [editedDetailFeature.id]: "#ff00aa" });
    harness.setPendingColorEditIds([editedDetailFeature.id]);

    assert.deepEqual(
      Array.from(harness.orderPoliticalShellUnderlayFirst([
        { id: editedDetailFeature.id, feature: editedDetailFeature },
        { id: primaryFallbackFeature.id, feature: primaryFallbackFeature },
        { id: baseFeature.id, feature: baseFeature },
      ]), (entry) => entry.id),
      [primaryFallbackFeature.id, baseFeature.id, editedDetailFeature.id],
    );

    harness.setPendingColorEditIds([]);
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
    const policy = createPoliticalPolicyFixture();
    const coarsePoliticalChunk = decodeScenarioChunkPayload(
      JSON.parse(readRepoFile("data", "scenarios", "tno_1962", "chunks", "political.coarse.r0c0.json")),
      topojson,
    );
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
    arcticShells.forEach(({ feature, featureId }) => {
      assert.equal(policy.shouldExcludePoliticalVisualFeature(feature, featureId), false,
        `${featureId} must stay paintable political coverage`);
      assert.equal(policy.shouldExcludePoliticalInteractionFeature(feature, featureId), true,
        `${featureId} must stay excluded from political interaction`);
      assert.equal(policy.shouldExcludeRuntimeOnlyShellFallbackPoliticalFeature(feature, featureId), true,
        `${featureId} is filtered from the runtime political base collection`);
    });

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

}
