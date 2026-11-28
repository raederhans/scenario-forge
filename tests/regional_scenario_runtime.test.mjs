import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createStartupDataPipelineOwner } from "../js/bootstrap/startup_data_pipeline.js";
import { createDeferredDetailPromotionOwner } from "../js/bootstrap/deferred_detail_promotion.js";
import { importProjectTextThroughFunnel } from "../js/core/interaction_funnel.js";
import { state } from "../js/core/state.js";
import { applyScenarioBundle, clearActiveScenario, prepareScenarioDetailTopologyState } from "../js/core/scenario_manager.js";
import { getScenarioRegion, isRegionalScenario } from "../js/core/scenario/scenario_region.js";
import { enforceScenarioHydrationHealthGate, hydrateActiveScenarioBundle } from "../js/core/scenario/scenario_resources.js";
import { addFeaturesToDevSelection, clearDevSelection, fillSelectedParcels, selectLandFeatureById } from "../js/core/map_renderer.js";
import { readRegisteredRuntimeHookSource, registerRuntimeHook } from "../js/core/state/index.js";
import { createContextLayerResolverOwner } from "../js/core/renderer/context_layer_resolver.js";
import { requiresPublicLeafDetail } from "../js/core/renderer/political_collection_source.js";
import { resolveDataAssetUrl, resolveScenarioRegistryUrl } from "../js/core/runtime_asset_registry.js";

const require = createRequire(import.meta.url);
const region = { bounds: [170, 10, -170, 60], central_meridian: 180 };
const inside = Array.from({ length: 1001 }, (_, i) => `RU-${i}`);
const outside = "US-outside";
const world = [...inside, outside];

function topology(ids) {
  const arcs = ids.map((id, i) => {
    const x = id === outside ? -100 : 170 + (i % 40) / 10;
    const y = 30 + Math.floor(i / 40) / 10;
    return [[x, y], [x, y + 0.09], [x + 0.09, y + 0.09], [x + 0.09, y], [x, y]];
  });
  const geometries = ids.map((id, i) => ({
    type: "Polygon", arcs: [[i]], id, properties: { id, country_code: id === outside ? "US" : "RU" },
  }));
  return { type: "Topology", arcs, objects: { political: { type: "GeometryCollection", geometries } } };
}

function makeBundle(id, ids, regional) {
  const directory = `data/scenarios/${id}`;
  return {
    manifest: {
      scenario_id: id, map_mode: "political", scenario_contract_profile: "lightweight_base",
      baseline_hash: id, source: { runtime_topology_sha256: "f".repeat(64) },
      summary: { feature_count: ids.length }, ...(regional ? { region } : {}),
      runtime_topology_url: `${directory}/runtime.topo.json`,
      countries_url: `${directory}/countries.json`, owners_url: `${directory}/owners.json`,
      cores_url: `${directory}/cores.json`,
    },
    countriesPayload: { countries: { RU: { name: "Russia", color_hex: "#774433" }, US: { name: "USA", color_hex: "#bb3311" } } },
    ownersPayload: { owners: Object.fromEntries(ids.map(id => [id, id === outside ? "US" : "RU"])) },
    coresPayload: { cores: {} },
    bundleLevel: "full",
    runtimeTopologyPayload: topology(ids),
  };
}

const local = makeBundle("regional_fixture", inside, true);
const globalBundle = makeBundle("global_fixture", world, false);
const primary = topology([inside[0], outside]);
const detail = globalBundle.runtimeTopologyPayload;
const detailUrl = "data/europe_topology.na_v2.json";
const runtimeUrl = resolveDataAssetUrl("runtime_political_topology");
const primaryUrl = "data/europe_topology.json";
const regionalManifestUrl = "data/scenarios/regional_fixture/manifest.json";

function setupResources(t, search = "", extraResources = []) {
  const initialState = Object.getOwnPropertyDescriptors(state);
  t.after(() => {
    for (const key of Object.keys(state)) {
      if (!Object.hasOwn(initialState, key)) delete state[key];
    }
    Object.defineProperties(state, initialState);
  });
  const urls = [];
  const resources = new Map([
    [primaryUrl, primary], [detailUrl, detail], [runtimeUrl, detail],
    [resolveScenarioRegistryUrl(), { scenarios: [{ scenario_id: local.manifest.scenario_id, manifest_url: regionalManifestUrl }] }],
    [regionalManifestUrl, local.manifest], [local.manifest.runtime_topology_url, local.runtimeTopologyPayload],
    [local.manifest.countries_url, local.countriesPayload], [local.manifest.owners_url, local.ownersPayload],
    [local.manifest.cores_url, local.coresPayload],
    ["data/locales.json", { ui: {}, geo: { moscow: { en: "Moscow", zh: "莫斯科" } } }],
    ["data/geo_aliases.json", { alias_to_stable_key: { Moscow: "moscow" } }],
    ...extraResources,
  ]);
  const json = async url => {
    const path = new URL(url, "https://fixture.invalid/").pathname.slice(1);
    urls.push(path);
    return structuredClone(resources.get(path) ?? { type: "FeatureCollection", features: [] });
  };
  const globals = { location: new URL("https://fixture.invalid/" + search),
    topojson: require("../vendor/topojson-client.min.js"), d3: { ...require("../vendor/d3.v7.min.js"), json },
    fetch: async url => Response.json(await json(url)) };
  for (const [key, value] of Object.entries(globals)) {
    const old = Object.getOwnPropertyDescriptor(globalThis, key);
    globalThis[key] = value;
    t.after(() => {
      if (old) Object.defineProperty(globalThis, key, old);
      else delete globalThis[key];
    });
  }
  return urls;
}

function assertMembership(ids) {
  const expected = new Set(ids);
  assert.deepEqual(new Set(state.landDataFull.features.map(f => f.properties.id)), expected);
  assert.deepEqual(new Set(state.landData.features.map(f => f.properties.id)), expected);
  assert.deepEqual(new Set(state.landIndex.keys()), expected);
}

const apply = (bundle, options) => applyScenarioBundle(bundle, {
  renderNow: false, suppressRender: true, rememberScenario: false, syncPalette: false, markDirtyReason: "", ...options,
});

async function failAfterCommit(bundle) {
  const previous = globalThis.__scenarioTestHooks;
  try {
    globalThis.__scenarioTestHooks = { forceApplyConsistencyFailureOnce: true };
    await assert.rejects(apply(bundle), /Injected apply consistency failure/);
  } finally {
    globalThis.__scenarioTestHooks = previous;
  }
}

test("only a manifest with valid WGS84 bounds selects regional behavior", () => {
  assert.equal(getScenarioRegion(local), region);
  assert.equal(isRegionalScenario(globalBundle), false);
  for (const bounds of [[], [0, 0, 0, 1], [0, 2, 1, 1], [0, -91, 1, 2], [0, 0, 181, 1], [null, 0, 1, 1]]) {
    assert.equal(isRegionalScenario({ region: { bounds } }), false);
  }
});

for (const mode of ["single", "composite"]) {
  test(`regional apply, editing, rollback and exit from ${mode}`, async t => {
    const urls = setupResources(t);
    Object.assign(state, { topology: primary, topologyPrimary: primary, topologyBundleMode: mode,
      topologyDetail: mode === "single" ? null : detail,
      defaultRuntimePoliticalTopology: mode === "single" ? null : detail });
    if (mode === "composite") {
      await apply(globalBundle);
      assertMembership(world);
      urls.length = 0;
      await failAfterCommit(local);
      assert.equal(state.activeScenarioId, globalBundle.manifest.scenario_id);
      assertMembership(world);
      await assert.rejects(apply({ ...local, runtimeTopologyPayload: topology([]) }), /runtime topology is not renderable/);
      assertMembership(world);
    }
    await apply(local);
    assertMembership(inside);
    assert.equal(state.topologyBundleMode, mode);
    assert.equal(selectLandFeatureById(outside), false);
    hydrateActiveScenarioBundle(local, { renderNow: false });
    assertMembership(inside);

    const promotion = createDeferredDetailPromotionOwner({ runtimeState: state });
    assert.equal(await promotion.ensureDetailTopologyReady({ requireIdle: true }), true);
    assert.equal(requiresPublicLeafDetail(state, { requiresComposite: true }), false);
    assert.equal(addFeaturesToDevSelection([inside[0], outside]), 1);
    assert.deepEqual(fillSelectedParcels({ color: "#123abc" }), { changed: 1, skipped: 0 });
    assert.equal(state.visualOverrides[inside[0]], "#123abc");
    assert.equal(state.colors[inside[0]], "#123abc");
    assert.equal(state.visualOverrides[outside], undefined);
    assert.deepEqual(urls.filter(url => url.startsWith("data/europe_topology.") || url === runtimeUrl), []);

    await failAfterCommit(globalBundle);
    assert.equal(state.activeScenarioId, local.manifest.scenario_id);
    assertMembership(inside);
    assert.equal(state.topologyBundleMode, mode);
    assert.deepEqual(state.topologyDetail, mode === "single" ? null : detail);
    assert.equal(state.visualOverrides[inside[0]], "#123abc");
    await apply(globalBundle);
    assertMembership(world);
    assert.equal(selectLandFeatureById(outside), true);
    await apply(local);
    assertMembership(inside);
    clearActiveScenario({ renderNow: false, markDirtyReason: "", allowDuringBootBlocking: true });
    assertMembership(world);
    assert.equal(selectLandFeatureById(outside), true);
  });
}

test("single-package regional cold start uses full topology and unlocks without public political downloads", async t => {
  const urls = setupResources(t, "?default_scenario=regional_fixture&render_profile=full");
  const pipeline = createStartupDataPipelineOwner({ state });
  const d3Client = globalThis.d3;
  const startup = pipeline.resolveStartupScenarioBootstrap({ d3Client });
  const startupFallbackScenarioId = await startup.requestedDefaultScenarioIdPromise;
  assert.equal(startupFallbackScenarioId, local.manifest.scenario_id);
  const result = await startup.scenarioBundlePromise;
  assert.ifError(result.error);
  assert.equal(result.bundle.bundleLevel, "full");
  assert.ok(urls.includes(local.manifest.runtime_topology_url));
  let startupBaseData;
  for (const profile of ["render_profile=balanced", "render_profile=full&detail_layer=off", "render_profile=full"]) {
    globalThis.location.search = "?default_scenario=regional_fixture&" + profile;
    const before = urls.length;
    startupBaseData = await pipeline.loadStartupBaseData({ d3Client, startupFallbackScenarioId,
      startupBundleResultPromise: startup.startupBundleResultPromise });
    assert.ok(urls.slice(before).includes(primaryUrl));
    assert.ok(urls.slice(before).includes("data/locales.json"));
    assert.ok(urls.slice(before).includes("data/geo_aliases.json"));
    assert.equal(startupBaseData.locales.geo.moscow.zh, "莫斯科");
    assert.equal(startupBaseData.geoAliases.alias_to_stable_key.Moscow, "moscow");
    assert.equal(startupBaseData.topologyDetail, null);
    assert.equal(startupBaseData.runtimePoliticalTopology, null);
    assert.deepEqual(startupBaseData.topologyPrimary, primary);
  }
  pipeline.hydrateStartupBaseState({ startupBaseData });
  pipeline.decodeStartupPrimaryCollections();
  state.startupReadonly = true;
  await apply(result.bundle, { interactionLevel: "readonly-startup" });
  assert.equal(state.scenarioRuntimeTopologyVersionTag, local.manifest.scenario_id + ":" + local.manifest.source.runtime_topology_sha256);
  const promotion = createDeferredDetailPromotionOwner({ runtimeState: state, helpers: {
    setStartupReadonlyState: active => { state.startupReadonly = active; },
  } });
  promotion.scheduleDeferredDetailPromotion();
  assert.equal(await promotion.unlockStartupReadonlyWithDetail(), true);
  assert.equal(state.startupReadonly, false);
  hydrateActiveScenarioBundle(result.bundle, { renderNow: false });
  const health = await enforceScenarioHydrationHealthGate({ renderNow: false });
  assert.equal(health.ok, true);
  assert.equal(health.attemptedRetry, false);
  const resolver = createContextLayerResolverOwner({ runtimeState: state, caches: { layerResolverCache: {} } });
  resolver.ensureLayerDataFromTopology();
  assertMembership(inside);
  clearDevSelection();
  assert.equal(addFeaturesToDevSelection([inside[1], outside]), 1);
  assert.equal(fillSelectedParcels({ color: "#aabbcc" }).changed, 1);
  assert.equal(state.colors[inside[1]], "#aabbcc");
  assert.deepEqual(urls.filter(url => (url !== primaryUrl && url.startsWith("data/europe_topology."))
    || url === runtimeUrl || url.endsWith(".startup.json")), []);

  const unavailable = await prepareScenarioDetailTopologyState({ loadDetailBundle: async () => ({}) });
  assert.equal(unavailable.detailPromoted, false);
  assert.equal(unavailable.scenarioReadinessPatch.topologyDetail, null);
  let restore;
  const previousDetailHook = readRegisteredRuntimeHookSource(state, "ensureDetailTopologyFn");
  t.after(() => registerRuntimeHook(state, "ensureDetailTopologyFn", previousDetailHook));
  registerRuntimeHook(state, "ensureDetailTopologyFn", () => (restore = promotion.ensureDetailTopologyReady()));
  clearActiveScenario({ renderNow: false, markDirtyReason: "", allowDuringBootBlocking: true });
  assert.equal(await restore, true);
  assert.equal(state.runtimePoliticalFeatureCollectionSeed, null);
  assertMembership(world);
  assert.equal(selectLandFeatureById(outside), true);
});

function assertReadiness(ids, mode, deferred, completed, expectedDetail) {
  assertMembership(ids);
  assert.equal(state.topologyBundleMode, mode);
  assert.equal(state.detailDeferred, deferred);
  assert.equal(state.detailPromotionCompleted, completed);
  assert.deepEqual(state.topologyDetail, expectedDetail);
}

for (const startRegional of [false, true]) {
  test(`cold start ${startRegional ? "via region" : "without region"} to hoi4_1936, modern_world and base map`, async t => {
    const hoiIds = ["historical-east", "historical-west", outside];
    const modernIds = [...world, "modern-only"];
    const hoi = makeBundle("hoi4_1936", hoiIds, false);
    const modern = makeBundle("modern_world", modernIds, false);
    const chunkUrl = "data/scenarios/hoi4_1936/political.coarse.json";
    hoi.manifest.detail_chunk_manifest_url = "data/scenarios/hoi4_1936/detail_chunks.manifest.json";
    const urls = setupResources(t, startRegional ? "?default_scenario=regional_fixture&render_profile=balanced"
      : "?default_scenario=none&render_profile=balanced", [
      [hoi.manifest.detail_chunk_manifest_url, { chunks: [{ id: "political.coarse", layer: "political",
        url: chunkUrl, lod: "coarse", global_coverage: true }] }],
      [chunkUrl, require("../vendor/topojson-client.min.js").feature(hoi.runtimeTopologyPayload, hoi.runtimeTopologyPayload.objects.political)],
    ]);
    const pipeline = createStartupDataPipelineOwner({ state });
    const d3Client = globalThis.d3;
    const startup = pipeline.resolveStartupScenarioBootstrap({ d3Client });
    const startupBaseData = await pipeline.loadStartupBaseData({ d3Client,
      startupFallbackScenarioId: await startup.requestedDefaultScenarioIdPromise,
      startupBundleResultPromise: startup.startupBundleResultPromise });
    pipeline.hydrateStartupBaseState({ startupBaseData });
    pipeline.decodeStartupPrimaryCollections();
    const result = await startup.scenarioBundlePromise;
    assert.ifError(result.error);
    if (startRegional) {
      await apply(result.bundle);
      assertReadiness(inside, "single", false, true, null);
    } else {
      assert.equal(result.skipped, true);
    }

    await apply(hoi);
    if (!startRegional) {
      const promotion = createDeferredDetailPromotionOwner({ runtimeState: state });
      assert.equal(await promotion.ensureDetailTopologyReady(), true);
    }
    assertReadiness(hoiIds, "composite", false, true, null);
    assert.ok(urls.includes(chunkUrl));
    assert.ok(!urls.includes(detailUrl) && !urls.includes(runtimeUrl));

    await apply(modern);
    assertReadiness(modernIds, "composite", false, true, detail);
    assert.equal(urls.filter(url => url === detailUrl).length, 1);
    const publicDetail = state.topologyDetail;
    const modernSeed = state.runtimePoliticalFeatureCollectionSeed;
    assert.ok(modernSeed?.features.length);
    clearActiveScenario({ renderNow: false, markDirtyReason: "", allowDuringBootBlocking: true });
    assertReadiness(world, "composite", false, true, publicDetail);
    assert.equal(state.runtimePoliticalFeatureCollectionSeed, modernSeed);
    assert.equal(urls.filter(url => url === detailUrl).length, 1);
  });
}

test("project import skips a second rebuild when scenario recovery cleared dirty borders", async t => {
  setupResources(t);
  Object.assign(state, { topology: primary, topologyPrimary: primary, bootBlocking: false,
    scenarioBundleCacheById: { [local.manifest.scenario_id]: local } });
  const previous = readRegisteredRuntimeHookSource(state, "recomputeDynamicBordersNowFn");
  t.after(() => registerRuntimeHook(state, "recomputeDynamicBordersNowFn", previous));
  const rebuild = t.mock.fn();
  registerRuntimeHook(state, "recomputeDynamicBordersNowFn", rebuild);
  const project = {
    schemaVersion: 21,
    scenario: { id: local.manifest.scenario_id, baselineHash: local.manifest.baseline_hash },
    dynamicBordersDirty: true,
    layerVisibility: { showTransport: false, showCityPoints: false, showUrban: false, showPhysical: false, showRivers: false },
  };
  const result = await importProjectTextThroughFunnel(JSON.stringify(project), {
    ui: { t: key => key, showToast() {}, showAppDialog: async () => true },
    hooks: { refreshColorState() {} },
  });
  await result.completion;
  assert.equal(result.getRecoveryState().tasks["scenario-runtime"], "complete");
  assert.equal(state.activeScenarioId, local.manifest.scenario_id);
  assert.equal(state.dynamicBordersDirty, false);
  assert.equal(rebuild.mock.callCount(), 0);
});
