import test from "node:test";
import assert from "node:assert/strict";

import { createTransportWorkbenchPreviewLifecycleOwner } from "../js/ui/toolbar/transport_workbench_preview_lifecycle_owner.js";
import {
  buildTransportWorkbenchProjectedLines,
  createTransportWorkbenchLinePathD,
  createTransportWorkbenchLinePackRuntime,
  measureTransportWorkbenchProjectedLineLength,
  normalizeTransportWorkbenchNumber,
  PACK_MODE_FULL,
  PACK_MODE_PREVIEW,
} from "../js/ui/transport_workbench_line_runtime_shared.js";
import { prepareTransportWorkbenchFamilyPreview } from "../js/ui/transport_workbench_family_preview.js";
import { createRuntimeResourceBudget } from "../js/core/runtime_resource_budget.js";
import { createChunkLoadScheduler } from "../js/core/scenario/chunk_load_scheduler.js";
import {
  __transportWorkbenchPointPreviewTestInternals,
} from "../js/ui/transport_workbench_point_preview_shared.js";
import {
  buildTransportWorkbenchPointSnapshot,
  createTransportWorkbenchEffectivePointPack,
  getTransportWorkbenchPointPackCacheKey,
  getTransportWorkbenchPointPackPath,
  isTransportWorkbenchPointSinglePackPath,
  shouldUseTransportWorkbenchPointFullPack,
} from "../js/ui/transport_workbench_point_preview_runtime.js";

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

test("transport workbench line helpers keep shared path, length, and segment contracts", () => {
  const geometry = {
    type: "MultiLineString",
    coordinates: [
      [[0, 0], [3, 4]],
      [[3, 4], [6, 8]],
    ],
  };

  assert.equal(createTransportWorkbenchLinePathD(geometry), "M 0 0 L 3 4 M 3 4 L 6 8");
  assert.equal(measureTransportWorkbenchProjectedLineLength(geometry), 10);
  assert.equal(normalizeTransportWorkbenchNumber("bad", 7), 7);
  assert.deepEqual(buildTransportWorkbenchProjectedLines(geometry), [
    {
      points: [[0, 0], [3, 4]],
      pathD: "M 0 0 L 3 4",
      length: 5,
      segments: [
        {
          start: [0, 0],
          end: [3, 4],
          startDistance: 0,
          length: 5,
          angle: 53.13010235415598,
        },
      ],
    },
    {
      points: [[3, 4], [6, 8]],
      pathD: "M 3 4 L 6 8",
      length: 5,
      segments: [
        {
          start: [3, 4],
          end: [6, 8],
          startDistance: 0,
          length: 5,
          angle: 53.13010235415598,
        },
      ],
    },
  ]);
});

test("transport workbench preview lifecycle owner schedules warmup once during runtime hook init", async () => {
  const runtimeState = { transportWorkbenchUi: { open: false, activeFamily: "road" } };
  const warmCalls = [];
  const warnCalls = [];
  const selectionListeners = new Map();
  let carrierListener = null;
  let timeoutCalls = 0;
  let idleCalls = 0;

  const owner = createTransportWorkbenchPreviewLifecycleOwner(runtimeState, {
    listWarmupPlans: () => [
      { familyId: "road", includeFull: true },
      { familyId: "port", includeFull: false },
    ],
    warmFamilyPreview: async (familyId, options) => {
      warmCalls.push({ familyId, options });
      if (familyId === "port") {
        throw new Error("port warm failed");
      }
      return true;
    },
    setCarrierViewChangeListener: (listener) => {
      carrierListener = listener;
    },
    setFamilyPreviewSelectionListener: (familyId, listener) => {
      selectionListeners.set(familyId, listener);
    },
    runtimeFamilyIds: ["road", "port"],
    scheduleTimeout: (callback, delay) => {
      timeoutCalls += 1;
      assert.equal(delay, 10_000);
      callback();
      return timeoutCalls;
    },
    requestIdle: (callback, options) => {
      idleCalls += 1;
      assert.deepEqual(options, { timeout: 2_000 });
      callback();
      return idleCalls;
    },
    warnWarmupFailure: (familyId, reason) => {
      warnCalls.push({ familyId, message: reason?.message || String(reason) });
    },
  });

  owner.initializeRuntimeHooks();
  owner.initializeRuntimeHooks();
  await flushMicrotasks();

  assert.equal(timeoutCalls, 1);
  assert.equal(idleCalls, 1);
  assert.deepEqual(warmCalls, [
    { familyId: "road", options: { includeFull: true } },
    { familyId: "port", options: { includeFull: false } },
  ]);
  assert.deepEqual(warnCalls, [
    { familyId: "port", message: "port warm failed" },
  ]);
  assert.equal(typeof carrierListener, "function");
  assert.equal(typeof selectionListeners.get("road"), "function");
  assert.equal(typeof selectionListeners.get("port"), "function");
});

test("transport workbench preview lifecycle owner batches selection listeners to one frame", () => {
  const runtimeState = { transportWorkbenchUi: { open: true, activeFamily: "road" } };
  const selectionListeners = new Map();
  const lensCalls = [];
  const inspectorCalls = [];
  const rafCallbacks = [];
  let context = {
    isOpen: true,
    family: { id: "road" },
    config: { roadClass: ["motorway"] },
    compareHeld: false,
  };

  const owner = createTransportWorkbenchPreviewLifecycleOwner(runtimeState, {
    getRenderContext: () => context,
    listWarmupPlans: () => [],
    setCarrierViewChangeListener: () => {},
    setFamilyPreviewSelectionListener: (familyId, listener) => {
      selectionListeners.set(familyId, listener);
    },
    runtimeFamilyIds: ["road", "port"],
    scheduleTimeout: () => 0,
    requestAnimationFrame: (callback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    },
    renderLensSections: (family, config, compareHeld) => {
      lensCalls.push({ familyId: family.id, config, compareHeld });
    },
    renderInspector: (family, config, compareHeld) => {
      inspectorCalls.push({ familyId: family.id, config, compareHeld });
    },
  });

  owner.initializeRuntimeHooks();
  selectionListeners.get("road")();
  selectionListeners.get("road")();

  assert.equal(lensCalls.length, 0);
  assert.equal(inspectorCalls.length, 0);
  assert.equal(rafCallbacks.length, 1);
  rafCallbacks.shift()();
  assert.deepEqual(lensCalls, [
    { familyId: "road", config: { roadClass: ["motorway"] }, compareHeld: false },
  ]);
  assert.deepEqual(inspectorCalls, [
    { familyId: "road", config: { roadClass: ["motorway"] }, compareHeld: false },
  ]);

  context = { ...context, family: { id: "port" } };
  selectionListeners.get("road")();
  rafCallbacks.shift()();
  context = { ...context, isOpen: false, family: { id: "road" } };
  selectionListeners.get("road")();
  rafCallbacks.shift()();

  assert.equal(lensCalls.length, 1);
  assert.equal(inspectorCalls.length, 1);
});

test("transport workbench preview lifecycle owner restores runtime listeners after dispose", () => {
  const runtimeState = { transportWorkbenchUi: { open: false, activeFamily: "road" } };
  let carrierListener = null;
  const registeredFamilies = [];

  const owner = createTransportWorkbenchPreviewLifecycleOwner(runtimeState, {
    listWarmupPlans: () => [],
    setCarrierViewChangeListener: (listener) => {
      carrierListener = listener;
    },
    setFamilyPreviewSelectionListener: (familyId) => {
      registeredFamilies.push(familyId);
    },
    runtimeFamilyIds: ["road", "port"],
    destroyCarrier: () => {
      carrierListener = null;
    },
    destroyFamilyPreviews: () => {},
    scheduleTimeout: () => 0,
  });

  owner.initializeRuntimeHooks();
  assert.equal(typeof carrierListener, "function");
  owner.dispose();

  assert.equal(typeof carrierListener, "function");
  assert.deepEqual(registeredFamilies, ["road", "port", "road", "port"]);
});

test("transport workbench preview lifecycle owner schedules carrier view sync as view-only preview refresh", async () => {
  const runtimeState = { transportWorkbenchUi: { open: true, activeFamily: "airport" } };
  const refreshCalls = [];
  let carrierListener = null;
  let rafCallback = null;
  let viewState = { scale: 1, translateX: 0, translateY: 0, quarterTurns: 0 };

  const owner = createTransportWorkbenchPreviewLifecycleOwner(runtimeState, {
    getRenderContext: () => ({
      isOpen: true,
      family: { id: "airport" },
      config: { airportType: ["international"] },
      compareHeld: false,
    }),
    getCarrierMount: () => ({}),
    getCarrierViewState: () => viewState,
    listWarmupPlans: () => [],
    renderFamilyPreview: async (familyId, config, options) => {
      refreshCalls.push({ familyId, config, viewOnly: !!options?.viewOnly });
      return null;
    },
    setCarrierViewChangeListener: (listener) => {
      carrierListener = listener;
    },
    setFamilyPreviewSelectionListener: () => {},
    runtimeFamilyIds: ["airport"],
    scheduleTimeout: () => 0,
    requestAnimationFrame: (callback) => {
      rafCallback = callback;
      return 7;
    },
    cancelAnimationFrame: () => {},
  });

  owner.initializeRuntimeHooks();
  viewState = { ...viewState, scale: 1.25 };
  carrierListener();
  assert.equal(refreshCalls.length, 0);
  assert.equal(typeof rafCallback, "function");

  rafCallback();
  await flushMicrotasks();

  assert.deepEqual(refreshCalls, [
    {
      familyId: "airport",
      config: { airportType: ["international"] },
      viewOnly: true,
    },
  ]);

  rafCallback = null;
  viewState = { ...viewState, scale: 1.254, translateX: 0.9, translateY: -0.9 };
  carrierListener();
  assert.equal(rafCallback, null);

  viewState = { ...viewState, translateX: 3 };
  carrierListener();
  assert.equal(typeof rafCallback, "function");
});

test("transport workbench preview lifecycle owner skips stale preview generation inspector writes", async () => {
  const runtimeState = { transportWorkbenchUi: { open: true, activeFamily: "road" } };
  const previewResolvers = [];
  const inspectorCalls = [];
  const owner = createTransportWorkbenchPreviewLifecycleOwner(runtimeState, {
    getCarrierMount: () => ({}),
    listWarmupPlans: () => [],
    renderFamilyPreview: (familyId, config, options) => new Promise((resolve) => {
      previewResolvers.push({ familyId, config, options, resolve });
    }),
    renderInspector: (family, config, compareHeld) => {
      inspectorCalls.push({ familyId: family.id, config, compareHeld });
    },
    setCarrierViewChangeListener: () => {},
    setFamilyPreviewSelectionListener: () => {},
    runtimeFamilyIds: ["road", "rail"],
    scheduleTimeout: () => 0,
  });
  const roadContext = {
    isOpen: true,
    family: { id: "road" },
    config: { scope: "motorway_only" },
    compareHeld: false,
  };
  const railContext = {
    isOpen: true,
    family: { id: "rail" },
    config: { scope: "mainline_only" },
    compareHeld: true,
  };

  const stalePreview = owner.refreshPreview(roadContext, { allowCarrierPrep: false });
  await flushMicrotasks();
  assert.equal(previewResolvers.length, 1);
  assert.equal(previewResolvers[0].familyId, "road");

  runtimeState.transportWorkbenchUi.activeFamily = "rail";
  const currentPreview = owner.refreshPreview(railContext, { allowCarrierPrep: false });
  await flushMicrotasks();
  assert.equal(previewResolvers.length, 2);
  assert.equal(previewResolvers[1].familyId, "rail");

  previewResolvers[0].resolve(null);
  await stalePreview;
  assert.deepEqual(inspectorCalls, []);

  previewResolvers[1].resolve(null);
  await currentPreview;
  assert.deepEqual(inspectorCalls, [
    {
      familyId: "rail",
      config: { scope: "mainline_only" },
      compareHeld: true,
    },
  ]);
});

test("point preview effective pack merges update patches and removes deleted source features", () => {
  const sourcePack = {
    mode: "preview",
    variantId: "fixture",
    features: [{
      id: "source_port_1",
      name: "Original Port",
      label: "Original Port",
      lon: 10,
      lat: 20,
      x: 100,
      y: 200,
      properties: {
        id: "source_port_1",
        name: "Original Port",
        source: "official_registry",
        manager_type_code: "1",
        legal_designation: "international_hub",
      },
    }, {
      id: "source_port_2",
      name: "Deleted Port",
      lon: 11,
      lat: 21,
      x: 110,
      y: 210,
      properties: {
        id: "source_port_2",
        source: "official_registry",
        manager_type_code: "1",
      },
    }],
    featureById: new Map(),
  };
  const config = {
    editOverlay: {
      updated: [{
        id: "source_port_1",
        name: "Edited Port",
        lon: 10.5,
        lat: 20.5,
        properties: { manager_type_code: "2" },
      }],
      deleted: ["source_port_2"],
    },
  };
  const projectFeature = (rawFeature, definition, variantId) => {
    const [lon, lat] = rawFeature.geometry.coordinates;
    return {
      id: rawFeature.id,
      name: rawFeature.properties.name,
      label: rawFeature.properties.name,
      lon,
      lat,
      x: lon * 10,
      y: lat * 10,
      kind: definition.selectionType,
      variant: variantId,
      properties: rawFeature.properties,
      editOverlay: !!rawFeature.properties.edit_overlay,
    };
  };

  const pack = __transportWorkbenchPointPreviewTestInternals.createEffectivePointPack(
    sourcePack,
    config,
    { selectionType: "port" },
    { projectFeature }
  );

  assert.equal(pack.features.length, 1);
  assert.equal(pack.featureById.has("source_port_2"), false);
  const updated = pack.featureById.get("source_port_1");
  assert.equal(updated.name, "Edited Port");
  assert.equal(updated.lon, 10.5);
  assert.equal(updated.lat, 20.5);
  assert.equal(updated.properties.source, "official_registry");
  assert.equal(updated.properties.legal_designation, "international_hub");
  assert.equal(updated.properties.manager_type_code, "2");
  assert.equal(updated.properties.edit_overlay_mode, "updated");
});

test("point preview runtime resolves variant paths and single-pack cache keys", () => {
  const manifest = {
    paths: {
      preview: { airports: "global.preview.geojson" },
      full: { airports: "global.full.geojson" },
    },
  };
  const definition = {
    packKey: "airports",
    getVariantMeta: (_manifest, variantId) => ({
      id: variantId,
      paths: {
        preview: { airports: `${variantId}.shared.geojson` },
        full: { airports: `${variantId}.shared.geojson` },
      },
    }),
    importanceOrder: { major: 2, all: 1 },
    fullPackScaleThreshold: 1.5,
  };

  assert.equal(getTransportWorkbenchPointPackCacheKey(PACK_MODE_PREVIEW), "preview");
  assert.equal(getTransportWorkbenchPointPackCacheKey(PACK_MODE_FULL, "domestic"), "domestic:full");
  assert.equal(
    getTransportWorkbenchPointPackPath(manifest, PACK_MODE_PREVIEW, "airports", definition, "domestic"),
    "domestic.shared.geojson"
  );
  assert.equal(isTransportWorkbenchPointSinglePackPath(manifest, "airports", definition, "domestic"), true);
  assert.equal(shouldUseTransportWorkbenchPointFullPack({ importanceThreshold: "all" }, definition, 1), true);
  assert.equal(shouldUseTransportWorkbenchPointFullPack({ importanceThreshold: "major" }, definition, 1.4), false);
  assert.equal(shouldUseTransportWorkbenchPointFullPack({ importanceThreshold: "major" }, definition, 1.5), true);
});

test("point preview runtime builds created updated deleted overlay model", () => {
  const definition = { familyId: "airport", selectionType: "airport" };
  const sourcePack = {
    mode: "preview",
    variantId: "domestic",
    features: [{
      id: "a1",
      name: "Old Airport",
      label: "Old Airport",
      lon: 1,
      lat: 2,
      x: 10,
      y: 20,
      kind: "airport",
      variant: "domestic",
      properties: { id: "a1", name: "Old Airport", airport_type: "domestic" },
    }, {
      id: "a2",
      name: "Removed Airport",
      label: "Removed Airport",
      lon: 3,
      lat: 4,
      x: 30,
      y: 40,
      kind: "airport",
      variant: "domestic",
      properties: { id: "a2", name: "Removed Airport" },
    }],
    featureById: new Map(),
  };
  const config = {
    editOverlay: {
      updated: [{ id: "a1", name: "Updated Airport", lon: 5, lat: 6 }],
      deleted: ["a2"],
      created: [{ id: "a3", name: "New Airport", lon: 7, lat: 8 }],
    },
  };
  const projectFeature = (rawFeature, runtimeDefinition, variantId) => {
    const [lon, lat] = rawFeature.geometry.coordinates;
    return {
      id: rawFeature.id || rawFeature.properties.id,
      name: rawFeature.properties.name,
      label: rawFeature.properties.name,
      lon,
      lat,
      x: lon * 10,
      y: lat * 10,
      kind: runtimeDefinition.selectionType,
      variant: variantId,
      properties: rawFeature.properties,
      editOverlay: !!rawFeature.properties.edit_overlay,
    };
  };

  const pack = createTransportWorkbenchEffectivePointPack(sourcePack, config, definition, { projectFeature });

  assert.deepEqual(pack.features.map((feature) => feature.id), ["a1", "a3"]);
  assert.equal(pack.featureById.has("a2"), false);
  assert.equal(pack.featureById.get("a1").name, "Updated Airport");
  assert.equal(pack.featureById.get("a1").properties.edit_overlay_mode, "updated");
  assert.equal(pack.featureById.get("a3").properties.source, "user_overlay");
  assert.equal(pack.featureById.get("a3").properties.airport_type, "other");
  assert.equal(pack.featureById.get("a3").properties.status_category, "active");
});

test("point preview runtime snapshot sorts visibility rows and preserves loading status", () => {
  const runtime = {
    definition: {
      familyId: "airport",
      getHiddenReason: (feature) => feature.id === "hidden" ? "below_threshold" : null,
      shouldShowLabel: () => true,
    },
    activePackMode: PACK_MODE_PREVIEW,
    activeVariantId: "domestic",
    activePack: {
      features: [{
        id: "hidden",
        kind: "airport",
        name: "Hidden",
        lon: 1,
        lat: 2,
        variant: "domestic",
        properties: { source: "official" },
      }, {
        id: "visible",
        kind: "airport",
        name: "Visible",
        lon: 3,
        lat: 4,
        variant: "domestic",
        properties: { source_label: "registry" },
      }],
    },
    projectedPacks: new Map(),
    loadState: {
      status: "ready",
      error: null,
      manifest: { pack_id: "airport" },
      audit: { generated_at: "now" },
      subtypeCatalog: null,
      singlePack: true,
      previewStatus: "ready",
      fullStatus: "idle",
    },
    renderStats: {
      renderMode: "inspect",
      totalFeatures: 2,
      visibleFeatures: 1,
      filteredFeatures: 1,
      visibleLabels: 1,
      aggregateUnits: 0,
    },
    renderedConfigSignature: "",
    selectedFeature: { id: "visible" },
    lastRenderedConfig: {},
  };

  const snapshot = buildTransportWorkbenchPointSnapshot(runtime, { scale: 1 });

  assert.equal(snapshot.status, "loading");
  assert.equal(snapshot.dataRowCount, 2);
  assert.equal(snapshot.dataRows[0].id, "visible");
  assert.equal(snapshot.dataRows[0].visible, true);
  assert.equal(snapshot.dataRows[0].selected, true);
  assert.equal(snapshot.dataRows[1].id, "hidden");
  assert.equal(snapshot.dataRows[1].hiddenReason, "below_threshold");
  assert.equal(snapshot.dataRowLimit, 240);
});

test("carrier view refresh preserves the initial preview status update without rebuilding it on later pans", async () => {
  const runtimeState = { transportWorkbenchUi: { open: true, activeFamily: "road" } };
  let finishCarrier;
  const carrier = new Promise((resolve) => { finishCarrier = resolve; });
  const lensCalls = [];
  const owner = createTransportWorkbenchPreviewLifecycleOwner(runtimeState, {
    getCarrierMount: () => ({}),
    ensureCarrier: () => carrier,
    prepareFamilyPreview: async () => ({}),
    renderFamilyPreview: async () => null,
    renderLensSections: (family) => lensCalls.push(family.id),
  });
  const context = { isOpen: true, family: { id: "road" }, config: {}, compareHeld: false };
  const initial = owner.refreshPreview(context);
  await flushMicrotasks();
  assert.deepEqual(lensCalls, []);
  await owner.refreshPreview(context, { allowCarrierPrep: false, viewOnly: true });
  assert.deepEqual(lensCalls, ["road"]);
  finishCarrier();
  await initial;
  await owner.refreshPreview(context, { allowCarrierPrep: false, viewOnly: true });
  assert.deepEqual(lensCalls, ["road"]);
});

test("preview lifecycle owner starts selected pack preparation in parallel before carrier promise resolves", async () => {
  const runtimeState = { transportWorkbenchUi: { open: true, activeFamily: "road" } };
  const callEvents = [];
  let carrierResolver = null;
  let packResolver = null;
  let renderResolver = null;

  const owner = createTransportWorkbenchPreviewLifecycleOwner(runtimeState, {
    getCarrierMount: () => ({ id: "mount" }),
    ensureCarrier: () => {
      callEvents.push("ensureCarrier:start");
      return new Promise((resolve) => {
        carrierResolver = () => {
          callEvents.push("ensureCarrier:resolve");
          resolve({ land: {}, sea: {} });
        };
      });
    },
    prepareFamilyPreview: (familyId, config) => {
      callEvents.push(`prepareFamilyPreview:${familyId}:${config?.activePackId}`);
      return new Promise((resolve) => {
        packResolver = () => {
          callEvents.push("prepareFamilyPreview:resolve");
          resolve(true);
        };
      });
    },
    renderFamilyPreview: (familyId, config) => {
      callEvents.push(`renderFamilyPreview:${familyId}:${config?.activePackId}`);
      return new Promise((resolve) => {
        renderResolver = () => {
          callEvents.push("renderFamilyPreview:resolve");
          resolve(null);
        };
      });
    },
    renderInspector: (family) => {
      callEvents.push(`renderInspector:${family.id}`);
    },
    renderLensSections: (family) => {
      callEvents.push(`renderLensSections:${family.id}`);
    },
    runtimeFamilyIds: ["road", "rail"],
    listWarmupPlans: () => [],
    scheduleTimeout: () => 0,
  });

  const context = {
    isOpen: true,
    family: { id: "road" },
    config: { activePackId: "japan_custom_road", scope: "all" },
    compareHeld: false,
  };

  const refreshPromise = owner.refreshPreview(context);
  await flushMicrotasks();

  // Evidence: Both ensureCarrier and prepareFamilyPreview started in parallel!
  assert.deepEqual(callEvents, [
    "prepareFamilyPreview:road:japan_custom_road",
    "ensureCarrier:start",
  ]);

  // Pack resolves before carrier resolves:
  packResolver();
  await flushMicrotasks();

  // Render must NOT have started yet because carrier has not resolved!
  assert.equal(callEvents.includes("renderFamilyPreview:road:japan_custom_road"), false);

  // Now carrier resolves:
  carrierResolver();
  await flushMicrotasks();

  // Render starts now!
  assert.equal(callEvents.includes("renderFamilyPreview:road:japan_custom_road"), true);

  // Finish render:
  renderResolver();
  await refreshPromise;

  assert.deepEqual(callEvents, [
    "prepareFamilyPreview:road:japan_custom_road",
    "ensureCarrier:start",
    "prepareFamilyPreview:resolve",
    "ensureCarrier:resolve",
    "renderFamilyPreview:road:japan_custom_road",
    "renderFamilyPreview:resolve",
    "renderLensSections:road",
    "renderInspector:road",
  ]);
});

test("preview lifecycle owner prevents spurious asset prep on closed, layers, missing mount, and view-only paths", async () => {
  const runtimeState = { transportWorkbenchUi: { open: true, activeFamily: "road" } };
  const prepareCalls = [];
  const carrierCalls = [];
  const renderCalls = [];

  let mount = { id: "mount" };

  const owner = createTransportWorkbenchPreviewLifecycleOwner(runtimeState, {
    getCarrierMount: () => mount,
    ensureCarrier: async () => {
      carrierCalls.push("ensureCarrier");
      return {};
    },
    prepareFamilyPreview: async (familyId, config) => {
      prepareCalls.push({ familyId, config });
      return true;
    },
    renderFamilyPreview: async (familyId, config, options) => {
      renderCalls.push({ familyId, config, viewOnly: !!options?.viewOnly });
      return null;
    },
    renderInspector: () => {},
    renderLayerOrderPanel: () => {},
    runtimeFamilyIds: ["road"],
    listWarmupPlans: () => [],
    scheduleTimeout: () => 0,
  });

  // 1. Closed workbench
  await owner.refreshPreview({
    isOpen: false,
    family: { id: "road" },
    config: { activePackId: "road_pack" },
  });
  assert.equal(prepareCalls.length, 0);
  assert.equal(carrierCalls.length, 0);

  // 2. Layers panel
  await owner.refreshPreview({
    isOpen: true,
    family: { id: "layers" },
    config: {},
  });
  assert.equal(prepareCalls.length, 0);
  assert.equal(carrierCalls.length, 0);

  // 3. Missing carrier mount
  mount = null;
  await owner.refreshPreview({
    isOpen: true,
    family: { id: "road" },
    config: { activePackId: "road_pack" },
  });
  assert.equal(prepareCalls.length, 0);
  assert.equal(carrierCalls.length, 0);
  mount = { id: "mount" };

  // 4. View-only refresh (e.g. camera sync)
  await owner.refreshPreview({
    isOpen: true,
    family: { id: "road" },
    config: { activePackId: "road_pack" },
  }, { allowCarrierPrep: false, viewOnly: true });

  assert.equal(prepareCalls.length, 0);
  assert.equal(carrierCalls.length, 0);
  assert.equal(renderCalls.length, 1);
  assert.equal(renderCalls[0].viewOnly, true);
});

test("preview lifecycle owner aborts stale generation when family switches during preparation", async () => {
  const runtimeState = { transportWorkbenchUi: { open: true, activeFamily: "road" } };
  const renderCalls = [];
  const inspectorCalls = [];
  let resolveRoadCarrier = null;
  let resolveRailCarrier = null;

  const owner = createTransportWorkbenchPreviewLifecycleOwner(runtimeState, {
    getCarrierMount: () => ({ id: "mount" }),
    ensureCarrier: () => new Promise((resolve) => {
      if (runtimeState.transportWorkbenchUi.activeFamily === "road") {
        resolveRoadCarrier = resolve;
      } else {
        resolveRailCarrier = resolve;
      }
    }),
    prepareFamilyPreview: async () => true,
    renderFamilyPreview: async (familyId, config) => {
      renderCalls.push({ familyId, config });
      return null;
    },
    renderInspector: (family) => {
      inspectorCalls.push(family.id);
    },
    runtimeFamilyIds: ["road", "rail"],
    listWarmupPlans: () => [],
    scheduleTimeout: () => 0,
  });

  const roadPromise = owner.refreshPreview({
    isOpen: true,
    family: { id: "road" },
    config: { activePackId: "road_pack" },
  });
  await flushMicrotasks();

  // User switches active family to rail before road carrier finishes:
  runtimeState.transportWorkbenchUi.activeFamily = "rail";
  const railPromise = owner.refreshPreview({
    isOpen: true,
    family: { id: "rail" },
    config: { activePackId: "rail_pack" },
  });
  await flushMicrotasks();

  // Road carrier resolves:
  resolveRoadCarrier({});
  await roadPromise;

  // Stale road render and inspector writes must NOT occur!
  assert.deepEqual(renderCalls, []);
  assert.deepEqual(inspectorCalls, []);

  // Rail carrier resolves:
  resolveRailCarrier({});
  await railPromise;

  // Rail renders and writes inspector:
  assert.deepEqual(renderCalls, [{ familyId: "rail", config: { activePackId: "rail_pack" } }]);
  assert.deepEqual(inspectorCalls, ["rail"]);
});

test("preview lifecycle owner aborts in-flight preview when workbench closes", async () => {
  const runtimeState = { transportWorkbenchUi: { open: true, activeFamily: "road" } };
  const renderCalls = [];
  const inspectorCalls = [];
  let resolveCarrier = null;

  const owner = createTransportWorkbenchPreviewLifecycleOwner(runtimeState, {
    getCarrierMount: () => ({ id: "mount" }),
    ensureCarrier: () => new Promise((resolve) => { resolveCarrier = resolve; }),
    prepareFamilyPreview: async () => true,
    renderFamilyPreview: async (familyId) => {
      renderCalls.push(familyId);
      return null;
    },
    renderInspector: (family) => {
      inspectorCalls.push(family.id);
    },
    destroyCarrier: () => {},
    destroyFamilyPreviews: () => {},
    runtimeFamilyIds: ["road"],
    listWarmupPlans: () => [],
    scheduleTimeout: () => 0,
  });

  const refreshPromise = owner.refreshPreview({
    isOpen: true,
    family: { id: "road" },
    config: { activePackId: "road_pack" },
  });
  await flushMicrotasks();

  // Close workbench:
  runtimeState.transportWorkbenchUi.open = false;
  owner.dispose();

  // Carrier resolves after close:
  resolveCarrier({});
  await refreshPromise;

  assert.deepEqual(renderCalls, []);
  assert.deepEqual(inspectorCalls, []);
});

test("preview lifecycle owner preserves pack preparation failure, skips render commit, and allows retry", async () => {
  const runtimeState = { transportWorkbenchUi: { open: true, activeFamily: "road" } };
  const renderCalls = [];
  const inspectorCalls = [];
  let shouldFailPrep = true;

  const owner = createTransportWorkbenchPreviewLifecycleOwner(runtimeState, {
    getCarrierMount: () => ({ id: "mount" }),
    ensureCarrier: async () => ({}),
    prepareFamilyPreview: async (familyId, config) => {
      if (shouldFailPrep) {
        throw new Error("Simulated pack fetch failure 500");
      }
      return true;
    },
    renderFamilyPreview: async (familyId, config) => {
      renderCalls.push({ familyId, config });
      return null;
    },
    renderInspector: (family, config) => {
      inspectorCalls.push({ familyId: family.id, config });
    },
    runtimeFamilyIds: ["road"],
    listWarmupPlans: () => [],
    scheduleTimeout: () => 0,
  });

  const failedContext = {
    isOpen: true,
    family: { id: "road" },
    config: { activePackId: "bad_pack" },
  };

  await owner.refreshPreview(failedContext);

  // Render was aborted due to prep failure; inspector still received update (reporting failure state)
  assert.deepEqual(renderCalls, []);
  assert.equal(inspectorCalls.length, 1);
  assert.equal(inspectorCalls[0].familyId, "road");

  // Retry with fixed pack:
  shouldFailPrep = false;
  const retryContext = {
    isOpen: true,
    family: { id: "road" },
    config: { activePackId: "good_pack" },
  };

  await owner.refreshPreview(retryContext);

  // Render succeeds on retry!
  assert.equal(renderCalls.length, 1);
  assert.equal(renderCalls[0].config.activePackId, "good_pack");
  assert.equal(inspectorCalls.length, 2);
});

test("preview lifecycle owner handles carrier preparation failure without stale preview commit", async () => {
  const runtimeState = { transportWorkbenchUi: { open: true, activeFamily: "road" } };
  const renderCalls = [];
  const inspectorCalls = [];

  const owner = createTransportWorkbenchPreviewLifecycleOwner(runtimeState, {
    getCarrierMount: () => ({ id: "mount" }),
    ensureCarrier: async () => {
      throw new Error("Simulated carrier 404");
    },
    prepareFamilyPreview: async () => true,
    renderFamilyPreview: async (familyId) => {
      renderCalls.push(familyId);
      return null;
    },
    renderInspector: (family) => {
      inspectorCalls.push(family.id);
    },
    runtimeFamilyIds: ["road"],
    listWarmupPlans: () => [],
    scheduleTimeout: () => 0,
  });

  await owner.refreshPreview({
    isOpen: true,
    family: { id: "road" },
    config: {},
  });

  assert.deepEqual(renderCalls, []);
  assert.deepEqual(inspectorCalls, ["road"]);
});

test("road and rail line pack runtime harnesses exercise nondefault activePackId, preview-only requests, no selection emission before render, and dedup", async () => {
  function createLinePreviewHarness({ familyId = "road", defaultManifestUrl = "manifest:default" } = {}) {
    const requests = [];
    const builds = [];
    let selectionEmissions = 0;
    const resources = createRuntimeResourceBudget({ softLimitBytes: 1_000_000 });
    const scheduler = createChunkLoadScheduler({ resourceBudget: resources });

    const lineRuntime = createTransportWorkbenchLinePackRuntime({
      familyId,
      manifestUrl: defaultManifestUrl,
      estimatedLoadBytes: { [PACK_MODE_PREVIEW]: 100, [PACK_MODE_FULL]: 500 },
      prepareCarrier: async () => {},
      buildPack: async ({ mode, manifest }) => {
        builds.push({ mode, packId: manifest.pack_id });
        return {
          mode,
          manifest,
          features: [{ id: `feature_${mode}_${manifest.pack_id}` }],
        };
      },
    }, {
      resourceBudget: resources,
      scheduler,
      yieldTask: () => Promise.resolve(),
      getAsset: async (path, options) => {
        requests.push({ path, label: options?.label });
        if (path.includes("manifest")) {
          return {
            pack_id: path,
            paths: {
              preview: { lines: `${path}:preview:lines` },
              full: { lines: `${path}:full:lines` },
            },
          };
        }
        return { objects: { lines: {} } };
      },
    });

    const runtime = lineRuntime.runtime;
    lineRuntime.setSelectionListener(() => {
      selectionEmissions += 1;
    });

    async function loadPack(mode = PACK_MODE_PREVIEW, config = {}, { emitSelection = true } = {}) {
      if (config?.activePackId) {
        lineRuntime.setActivePack(config.activePackId, `manifest:${config.activePackId}`);
      }
      return lineRuntime.loadPack(mode, () => {
        if (emitSelection && runtime.loadState.status === "ready" && runtime.lastRenderedConfig) {
          lineRuntime.emitSelectionChange();
        }
      });
    }

    async function prepare(config = {}) {
      return loadPack(PACK_MODE_PREVIEW, config, { emitSelection: false });
    }

    async function render(config = {}, options = {}) {
      const pack = await loadPack(PACK_MODE_PREVIEW, config, { emitSelection: true });
      if (typeof options.isCurrent === "function" && !options.isCurrent()) return null;
      runtime.lastRenderedConfig = config;
      runtime.activePack = pack;
      runtime.activePackMode = PACK_MODE_PREVIEW;
      lineRuntime.emitSelectionChange();
      return pack;
    }

    return {
      lineRuntime,
      runtime,
      requests,
      builds,
      getSelectionEmissions: () => selectionEmissions,
      prepare,
      render,
    };
  }

  // 1. Nondefault activePackId and preview-only requests
  const roadHarness = createLinePreviewHarness({ familyId: "road" });
  const nonDefaultConfig = { activePackId: "tno_custom_road_pack", scope: "motorway" };

  const preparePromise = roadHarness.prepare(nonDefaultConfig);
  await preparePromise;

  assert.equal(roadHarness.runtime.activePackId, "tno_custom_road_pack");
  assert.equal(roadHarness.requests[0].path, "manifest:tno_custom_road_pack");
  assert.deepEqual(roadHarness.builds.map((b) => b.mode), [PACK_MODE_PREVIEW]);
  assert.equal(roadHarness.runtime.loadState.previewStatus, "ready");
  assert.equal(roadHarness.runtime.loadState.fullStatus, "idle");
  assert.equal(roadHarness.requests.some((r) => r.path.includes("full")), false);

  // 2. No selection emission before render
  assert.equal(roadHarness.getSelectionEmissions(), 0);

  // 3. Single request dedup when prepare + render load same pack
  const renderPack = await roadHarness.render(nonDefaultConfig);
  assert.ok(renderPack);
  assert.equal(roadHarness.builds.length, 1);
  assert.equal(roadHarness.requests.filter((r) => r.path.includes("manifest")).length, 1);
  assert.equal(roadHarness.getSelectionEmissions(), 1);

  // 4. Family preview layer dispatches only declared prepare and returns null for undeclared
  const undeclaredResult = await prepareTransportWorkbenchFamilyPreview("airport", { activePackId: "airport_pack" });
  assert.equal(undeclaredResult, null);
});
