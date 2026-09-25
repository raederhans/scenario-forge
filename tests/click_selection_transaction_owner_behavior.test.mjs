import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const OWNER_PATH = path.join(
  REPO_ROOT,
  "js",
  "core",
  "map_renderer",
  "click_selection_transaction_owner.js",
);

async function loadOwnerModule() {
  const ownerModule = await import(pathToFileURL(OWNER_PATH));
  assert.deepEqual(Object.keys(ownerModule), [
    "createClickSelectionTransactionOwner",
    "resolveClickSelectionDecision",
  ]);
  assert.equal(typeof ownerModule.createClickSelectionTransactionOwner, "function");
  assert.equal(typeof ownerModule.resolveClickSelectionDecision, "function");
  return ownerModule;
}

async function loadResolver() {
  return (await loadOwnerModule()).resolveClickSelectionDecision;
}

function createResolvedHit(overrides = {}) {
  return {
    targetType: null,
    id: null,
    countryCode: null,
    runtimeCountryCode: null,
    ...overrides,
  };
}

function createReadonlyModifiers(overrides = {}) {
  return {
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  };
}

test("click selection owner module exposes the transaction factory and pure resolver", async () => {
  assert.equal(fs.existsSync(OWNER_PATH), true, "P1.8 owner module must exist");
  await loadOwnerModule();
});

test("empty hit returns exact empty target and false decision", async () => {
  const resolveClickSelectionDecision = await loadResolver();

  const result = resolveClickSelectionDecision(
    createResolvedHit(),
    createReadonlyModifiers({ ctrlKey: true, metaKey: true }),
  );

  assert.deepEqual(Reflect.ownKeys(result), ["decision", "target"]);
  assert.deepEqual(Reflect.ownKeys(result.decision), ["devSelectionRequested"]);
  assert.deepEqual(Reflect.ownKeys(result.target), ["kind"]);
  assert.deepEqual(result, {
    decision: { devSelectionRequested: false },
    target: { kind: "empty" },
  });
});

test("land ctrl or meta requests dev selection while shift and alt stay inert", async () => {
  const resolveClickSelectionDecision = await loadResolver();
  const resolvedHit = createResolvedHit({
    targetType: "land",
    id: "L1",
    countryCode: "AA",
    runtimeCountryCode: "BB",
  });

  for (const modifiers of [
    createReadonlyModifiers({ ctrlKey: true }),
    createReadonlyModifiers({ metaKey: true }),
    createReadonlyModifiers({ ctrlKey: true, metaKey: true, shiftKey: true, altKey: true }),
  ]) {
    const result = resolveClickSelectionDecision(resolvedHit, modifiers);
    assert.equal(result.decision.devSelectionRequested, true);
    assert.deepEqual(
      Reflect.ownKeys(result.target),
      ["kind", "id", "countryCode", "runtimeCountryCode"],
    );
    assert.deepEqual(result.target, {
      kind: "land",
      id: "L1",
      countryCode: "AA",
      runtimeCountryCode: "BB",
    });
  }

  for (const modifiers of [
    createReadonlyModifiers(),
    createReadonlyModifiers({ shiftKey: true }),
    createReadonlyModifiers({ altKey: true }),
    createReadonlyModifiers({ shiftKey: true, altKey: true }),
  ]) {
    assert.equal(
      resolveClickSelectionDecision(resolvedHit, modifiers).decision.devSelectionRequested,
      false,
    );
  }
});

test("repeated calls return equal data and preserve both inputs", async () => {
  const resolveClickSelectionDecision = await loadResolver();
  const resolvedHit = createResolvedHit({
    targetType: "land",
    id: "L1",
    countryCode: "AA",
    runtimeCountryCode: "BB",
  });
  const modifiers = createReadonlyModifiers({ ctrlKey: true, shiftKey: true });
  const hitBefore = { ...resolvedHit };
  const modifiersBefore = { ...modifiers };

  const first = resolveClickSelectionDecision(resolvedHit, modifiers);
  const second = resolveClickSelectionDecision(resolvedHit, modifiers);

  assert.deepEqual(first, second);
  assert.deepEqual(resolvedHit, hitBefore);
  assert.deepEqual(modifiers, modifiersBefore);
});

test("water and special targets never reuse the land dev-selection decision", async () => {
  const resolveClickSelectionDecision = await loadResolver();
  const modifiers = createReadonlyModifiers({ ctrlKey: true, metaKey: true });

  for (const targetType of ["water", "special"]) {
    const result = resolveClickSelectionDecision(
      createResolvedHit({
        targetType,
        id: `${targetType}-1`,
        countryCode: "AA",
        runtimeCountryCode: "BB",
      }),
      modifiers,
    );
    assert.equal(result.target.kind, targetType);
    assert.equal(result.decision.devSelectionRequested, false);
  }
});

test("blank identity fields normalize to null without mutating input", async () => {
  const resolveClickSelectionDecision = await loadResolver();
  const resolvedHit = createResolvedHit({
    targetType: "land",
    id: "L1",
    countryCode: "   ",
    runtimeCountryCode: "BB",
  });
  const modifiers = createReadonlyModifiers();

  const result = resolveClickSelectionDecision(resolvedHit, modifiers);

  assert.deepEqual(result.target, {
    kind: "land",
    id: "L1",
    countryCode: null,
    runtimeCountryCode: "BB",
  });
  assert.deepEqual(resolvedHit, {
    targetType: "land",
    id: "L1",
    countryCode: "   ",
    runtimeCountryCode: "BB",
  });
  assert.deepEqual(modifiers, createReadonlyModifiers());
});

test("blank id normalizes to null while target kind remains the projected kind", async () => {
  const resolveClickSelectionDecision = await loadResolver();

  const result = resolveClickSelectionDecision(
    createResolvedHit({ targetType: "land", id: "   ", countryCode: "AA" }),
    createReadonlyModifiers({ ctrlKey: true }),
  );

  assert.deepEqual(result.target, {
    kind: "land",
    id: null,
    countryCode: "AA",
    runtimeCountryCode: null,
  });
  assert.equal(result.decision.devSelectionRequested, true);
});

test("resolvedHit rejects missing extra symbol accessor nested function and invalid scalar values", async () => {
  const resolveClickSelectionDecision = await loadResolver();
  const modifiers = createReadonlyModifiers();
  const validHit = createResolvedHit({ targetType: "land", id: "L1" });

  const missingKey = { targetType: "land", id: "L1", countryCode: null };
  const extraKey = { ...validHit, feature: { type: "Feature" } };
  const symbolKey = { ...validHit, [Symbol("feature")]: "extra" };
  const nonEnumerableKey = { ...validHit };
  Object.defineProperty(nonEnumerableKey, "feature", { value: null });
  const accessorValue = { ...validHit };
  Object.defineProperty(accessorValue, "id", { enumerable: true, get: () => "L1" });

  for (const invalidHit of [
    null,
    [],
    missingKey,
    extraKey,
    symbolKey,
    nonEnumerableKey,
    accessorValue,
    createResolvedHit({ targetType: "coast" }),
    createResolvedHit({ id: undefined }),
    createResolvedHit({ id: 42 }),
    createResolvedHit({ countryCode: {} }),
    createResolvedHit({ runtimeCountryCode: () => "AA" }),
    createResolvedHit({ id: { value: "L1" } }),
  ]) {
    assert.throws(
      () => resolveClickSelectionDecision(invalidHit, modifiers),
      TypeError,
      `resolvedHit should reject ${String(invalidHit)}`,
    );
  }
});

test("readonlyModifiers rejects missing extra symbol nested function and nonboolean values", async () => {
  const resolveClickSelectionDecision = await loadResolver();
  const validHit = createResolvedHit({ targetType: "land", id: "L1" });
  const validModifiers = createReadonlyModifiers();

  const missingKey = { ctrlKey: false, metaKey: false, shiftKey: false };
  const extraKey = { ...validModifiers, repeat: false };
  const symbolKey = { ...validModifiers, [Symbol("event")]: true };
  const nonEnumerableKey = { ...validModifiers };
  Object.defineProperty(nonEnumerableKey, "repeat", { value: false });
  const accessorValue = { ...validModifiers };
  Object.defineProperty(accessorValue, "ctrlKey", { enumerable: true, get: () => false });

  for (const invalidModifiers of [
    null,
    [],
    missingKey,
    extraKey,
    symbolKey,
    nonEnumerableKey,
    accessorValue,
    createReadonlyModifiers({ ctrlKey: undefined }),
    createReadonlyModifiers({ ctrlKey: 1 }),
    createReadonlyModifiers({ metaKey: null }),
    createReadonlyModifiers({ shiftKey: {} }),
    createReadonlyModifiers({ altKey: () => false }),
  ]) {
    assert.throws(
      () => resolveClickSelectionDecision(validHit, invalidModifiers),
      TypeError,
      `readonlyModifiers should reject ${String(invalidModifiers)}`,
    );
  }
});

const SERVICE_NAMES = [
  "addRecentColor", "appendOperationalLineVertexFromEvent", "appendOperationGraphicVertexFromEvent",
  "appendSpecialZoneVertexFromEvent", "applyFacilityInfoCardState", "applyFeatureVisualOverrideTransaction",
  "applyVisualSubdivisionFill", "applyWaterRegionFill", "blockStartupReadonlyInteraction", "captureHistoryState",
  "commitHistoryEntry", "dismissOnboardingHint", "ensureLeafDetailReady", "getFeatureCountryCodeNormalized",
  "getFeatureOwnerCode", "getFeaturePaintColor", "getHitFromEvent", "getHoveredFacilityEntryFromEvent", "getIntensityFieldTool",
  "getSafeCanvasColor", "getSpecialRegionColor", "getWaterRegionColor", "handleSpecialZoneMembershipClick",
  "inspectHgoRuntimePreviewFromEvent", "isDoubleClickBatchEligible", "isFacilityDetailsSurfaceActive",
  "isMacroOceanWaterRegion", "isOpenOceanPaintEnabled", "isSovereigntyModeActive", "markDirty",
  "markLegacyColorStateDirty", "noteRenderAction", "nowMs", "placeUnitCounterFromEvent", "queueTooltipUpdate",
  "refreshResolvedColorsForFeatures", "refreshResolvedColorsForOwners", "refreshSidebarAfterPaint",
  "refreshSpecialRegionSidebarRowsNow", "refreshWaterRegionSidebarRowsNow", "renderHoverOverlayIfNeeded",
  "requestInteractionRender", "resetFeatureOwnerCodes", "resolveInteractionTargetIds", "scheduleDynamicBorderRecompute",
  "setFeatureOwnerCodes", "shouldBlockUnderlyingSelectionForFacility", "shouldRequireLeafDetail",
  "syncInspectorCountryToLandSelection", "toggleFeatureInDevSelection", "updateDevSelectedHit",
  "warnMissingActiveSovereign", "warnIncompletePaintTargets",
];

const ACTION_NAMES = [
  "clearClickHoverIds", "consumeSuppressedBrushClick", "removeClickCountryColors",
  "removeClickWaterRegionOverride", "setClickActiveSovereignCode", "setClickCountryColors",
  "setClickHoverOverlayDirty", "setClickSelectedColor", "setClickSelectedSpecialRegionId",
  "setClickSelectedWaterRegionId", "setFacilityInfoCardExpanded", "setHoveredFacilityEntry",
  "setSelectedFacilityEntry", "togglePresetRegion",
];

function createTransactionHarness({ state: stateOverrides = {}, services: serviceOverrides = {}, actions: actionOverrides = {}, getClickState = null } = {}) {
  const trace = [];
  const state = {
    activeSovereignCode: "",
    colors: {},
    countryBaseColors: {},
    currentTool: "fill",
    interactionGranularity: "feature",
    isEditingPreset: false,
    landData: { features: [] },
    landIndex: new Map([["land-1", { properties: { id: "land-1" } }]]),
    operationalLineEditor: null,
    operationGraphicsEditor: null,
    scenarioSpecialRegionsData: { features: [] },
    selectedColor: "#123456",
    selectedSpecialRegionId: "",
    selectedWaterRegionId: "",
    sovereignBaseColors: {},
    specialRegionsById: new Map([["special-1", { properties: { id: "special-1" } }]]),
    specialZoneEditor: null,
    startupReadonly: false,
    unitCounterEditor: null,
    waterRegionsById: new Map([["water-1", { properties: { id: "water-1" } }]]),
    waterRegionsData: { features: [] },
    ...stateOverrides,
  };
  const hit = { targetType: null, id: null, countryCode: null, runtimeCountryCode: null };
  const services = Object.fromEntries(SERVICE_NAMES.map((name) => [name, (...args) => {
    trace.push([name, ...args]);
    return undefined;
  }]));
  Object.assign(services, {
    ensureLeafDetailReady: async () => true,
    getFeatureCountryCodeNormalized: () => "AA",
    getFeatureOwnerCode: () => "AA",
    getFeaturePaintColor: (id) => state.visualOverrides?.[id] || "#cccccc",
    getHitFromEvent: () => hit,
    getHoveredFacilityEntryFromEvent: () => null,
    getIntensityFieldTool: () => ({ active: false }),
    getSafeCanvasColor: (value) => value,
    handleSpecialZoneMembershipClick: () => false,
    inspectHgoRuntimePreviewFromEvent: () => ({ active: false, hit: null }),
    isDoubleClickBatchEligible: () => false,
    isFacilityDetailsSurfaceActive: () => false,
    isMacroOceanWaterRegion: () => false,
    isOpenOceanPaintEnabled: () => false,
    isSovereigntyModeActive: () => false,
    nowMs: () => 17,
    resolveInteractionTargetIds: (_feature, id) => [id],
    shouldBlockUnderlyingSelectionForFacility: () => false,
    shouldRequireLeafDetail: () => false,
    toggleFeatureInDevSelection: () => true,
    ...serviceOverrides,
  });
  const actions = Object.fromEntries(ACTION_NAMES.map((name) => [name, (...args) => {
    trace.push([name, ...args]);
    return undefined;
  }]));
  Object.assign(actions, {
    consumeSuppressedBrushClick: () => false,
    ...actionOverrides,
  });
  return {
    actions,
    getClickState: getClickState ? () => getClickState(state) : () => state,
    hit,
    services,
    state,
    trace,
  };
}

async function createTransactionOwner(options = {}) {
  const harness = createTransactionHarness(options);
  const { createClickSelectionTransactionOwner } = await loadOwnerModule();
  const owner = createClickSelectionTransactionOwner({
    constants: { clickSnapRadiusPx: 5, landFillColor: "#eeeeee" },
    getters: {
      getClickState: harness.getClickState,
      getSelectedFacilityEntry: () => null,
    },
    effects: harness.actions,
    services: harness.services,
  });
  return { ...harness, owner };
}

function traceNames(trace) {
  return trace.map(([name]) => name);
}

test("empty hit clears water then special and invalidates each selection exactly once", async () => {
  const harness = await createTransactionOwner({
    state: { selectedWaterRegionId: "water-1", selectedSpecialRegionId: "special-1" },
  });
  await harness.owner.handleClick({});
  assert.deepEqual(traceNames(harness.trace), [
    "dismissOnboardingHint",
    "setClickSelectedWaterRegionId",
    "refreshWaterRegionSidebarRowsNow",
    "requestInteractionRender",
    "setClickSelectedSpecialRegionId",
    "refreshSpecialRegionSidebarRowsNow",
    "requestInteractionRender",
  ]);
  assert.deepEqual(
    harness.trace.filter(([name]) => name === "requestInteractionRender").map(([, reason]) => reason),
    ["clear-water-selection-empty-click", "clear-special-selection-empty-click"],
  );
});

test("special water and land candidates retain their distinct transaction priority", async () => {
  const special = await createTransactionOwner({
    services: { getHitFromEvent: () => ({ targetType: "special", id: "special-1", countryCode: null, runtimeCountryCode: null }) },
  });
  await special.owner.handleClick({});
  assert.deepEqual(traceNames(special.trace).slice(-6), [
    "updateDevSelectedHit", "setClickSelectedWaterRegionId", "setClickSelectedSpecialRegionId",
    "refreshSpecialRegionSidebarRowsNow", "requestInteractionRender", "noteRenderAction",
  ]);

  const water = await createTransactionOwner({
    services: { getHitFromEvent: () => ({ targetType: "water", id: "water-1", countryCode: null, runtimeCountryCode: null }) },
  });
  await water.owner.handleClick({ ctrlKey: true, preventDefault() { water.trace.push(["preventDefault"]); } });
  assert.deepEqual(traceNames(water.trace).slice(-7), [
    "updateDevSelectedHit", "preventDefault", "setClickSelectedSpecialRegionId", "setClickSelectedWaterRegionId",
    "refreshWaterRegionSidebarRowsNow", "requestInteractionRender", "noteRenderAction",
  ]);

  const land = await createTransactionOwner({
    services: {
      getHitFromEvent: () => ({ targetType: "land", id: "land-1", countryCode: "AA", runtimeCountryCode: null }),
      toggleFeatureInDevSelection: () => {
        land.trace.push(["toggleFeatureInDevSelection"]);
        return false;
      },
    },
  });
  await land.owner.handleClick({ metaKey: true, shiftKey: true, altKey: true, preventDefault() { land.trace.push(["preventDefault"]); } });
  assert.deepEqual(traceNames(land.trace).slice(-5), [
    "updateDevSelectedHit", "preventDefault", "toggleFeatureInDevSelection",
    "syncInspectorCountryToLandSelection", "noteRenderAction",
  ]);
  assert.equal(land.trace.at(-1)[1], "dev-selection-sync");
  assert.equal(traceNames(land.trace).includes("requestInteractionRender"), false);
});

test("missing candidate fails closed before selection actions and invalidation", async () => {
  const harness = await createTransactionOwner({
    services: { getHitFromEvent: () => ({ targetType: "water", id: "missing", countryCode: null, runtimeCountryCode: null }) },
  });
  await harness.owner.handleClick({});
  assert.deepEqual(traceNames(harness.trace), ["dismissOnboardingHint", "updateDevSelectedHit"]);
});

test("action failure propagates and stops later sidebar and render work", async () => {
  const failure = new Error("selection write failed");
  const harness = await createTransactionOwner({
    state: { selectedWaterRegionId: "water-1" },
    actions: {
      setClickSelectedWaterRegionId: () => {
        harness.trace.push(["setClickSelectedWaterRegionId"]);
        throw failure;
      },
    },
  });
  await assert.rejects(harness.owner.handleClick({}), failure);
  assert.deepEqual(traceNames(harness.trace), ["dismissOnboardingHint", "setClickSelectedWaterRegionId"]);
});

test("startup readonly prevents the event and blocks with no later side effects", async () => {
  const harness = await createTransactionOwner({ state: { startupReadonly: true } });
  await harness.owner.handleClick({
    preventDefault() { harness.trace.push(["preventDefault"]); },
  });
  assert.deepEqual(traceNames(harness.trace), [
    "preventDefault",
    "blockStartupReadonlyInteraction",
  ]);
});

test("HGO preview and facility-card hits retain their isolated early-return funnels", async () => {
  const hgo = await createTransactionOwner({
    services: {
      inspectHgoRuntimePreviewFromEvent: () => {
        hgo.trace.push(["inspectHgoRuntimePreviewFromEvent"]);
        return { active: true, hit: { id: "hgo-1" } };
      },
    },
  });
  await hgo.owner.handleClick({
    preventDefault() { hgo.trace.push(["preventDefault"]); },
  });
  assert.deepEqual(traceNames(hgo.trace), [
    "dismissOnboardingHint",
    "inspectHgoRuntimePreviewFromEvent",
    "preventDefault",
    "updateDevSelectedHit",
    "clearClickHoverIds",
    "queueTooltipUpdate",
    "setClickHoverOverlayDirty",
    "renderHoverOverlayIfNeeded",
    "requestInteractionRender",
    "noteRenderAction",
  ]);
  assert.equal(traceNames(hgo.trace).includes("getHitFromEvent"), false);

  const facilityEntry = { id: "facility-1", familyId: "airbase" };
  const facility = await createTransactionOwner({
    services: {
      getHoveredFacilityEntryFromEvent: () => facilityEntry,
      isFacilityDetailsSurfaceActive: () => true,
    },
  });
  await facility.owner.handleClick({ clientX: 12, clientY: 34 });
  assert.deepEqual(traceNames(facility.trace), [
    "dismissOnboardingHint",
    "setHoveredFacilityEntry",
    "setSelectedFacilityEntry",
    "setFacilityInfoCardExpanded",
    "queueTooltipUpdate",
    "applyFacilityInfoCardState",
    "setClickHoverOverlayDirty",
    "renderHoverOverlayIfNeeded",
    "noteRenderAction",
  ]);
});

test("special eyedropper selects before sampling and records one render action", async () => {
  const harness = await createTransactionOwner({
    state: { selectedWaterRegionId: "water-1", currentTool: "eyedropper" },
    services: {
      getHitFromEvent: () => ({ targetType: "special", id: "special-1", countryCode: null, runtimeCountryCode: null }),
      getSpecialRegionColor: () => "#abcdef",
    },
  });
  await harness.owner.handleClick({});
  assert.deepEqual(traceNames(harness.trace), [
    "dismissOnboardingHint",
    "updateDevSelectedHit",
    "setClickSelectedWaterRegionId",
    "setClickSelectedSpecialRegionId",
    "refreshWaterRegionSidebarRowsNow",
    "refreshSpecialRegionSidebarRowsNow",
    "requestInteractionRender",
    "setClickSelectedColor",
    "noteRenderAction",
  ]);
  assert.deepEqual(harness.trace.at(-2), [
    "setClickSelectedColor",
    "#abcdef",
    { updateSwatch: true },
  ]);
});

test("water eraser preserves selection, history, dirty, render, and sidebar order", async () => {
  const harness = await createTransactionOwner({
    state: { currentTool: "eraser", selectedSpecialRegionId: "special-1" },
    services: {
      getHitFromEvent: () => ({ targetType: "water", id: "water-1", countryCode: null, runtimeCountryCode: null }),
    },
  });
  await harness.owner.handleClick({});
  assert.deepEqual(traceNames(harness.trace), [
    "dismissOnboardingHint",
    "updateDevSelectedHit",
    "setClickSelectedSpecialRegionId",
    "setClickSelectedWaterRegionId",
    "refreshSpecialRegionSidebarRowsNow",
    "refreshWaterRegionSidebarRowsNow",
    "captureHistoryState",
    "removeClickWaterRegionOverride",
    "markDirty",
    "captureHistoryState",
    "commitHistoryEntry",
    "requestInteractionRender",
    "refreshSidebarAfterPaint",
    "noteRenderAction",
  ]);
  assert.equal(harness.trace.filter(([name]) => name === "requestInteractionRender").length, 1);
});

test("deferred land hydration refreshes the hit and resumes with the latest tool and color state", async () => {
  let releaseHydration;
  const hydration = new Promise((resolve) => { releaseHydration = resolve; });
  let currentTool = "fill";
  let selectedColor = "#111111";
  let hitCount = 0;
  const baseState = {
    colors: { "land-2": "#000000" },
    visualOverrides: { "land-2": "#fedcba" },
    landIndex: new Map([
      ["land-1", { properties: { id: "land-1" } }],
      ["land-2", { properties: { id: "land-2" } }],
    ]),
  };
  const harness = await createTransactionOwner({
    state: baseState,
    getClickState: (state) => ({ ...state, currentTool, selectedColor }),
    services: {
      ensureLeafDetailReady: async () => hydration,
      getHitFromEvent: () => {
        hitCount += 1;
        return {
          targetType: "land",
          id: hitCount === 1 ? "land-1" : "land-2",
          countryCode: "AA",
          runtimeCountryCode: null,
        };
      },
      shouldRequireLeafDetail: () => true,
    },
  });
  const pending = harness.owner.handleClick({});
  await Promise.resolve();
  currentTool = "eyedropper";
  selectedColor = "#222222";
  releaseHydration(true);
  await pending;
  assert.equal(hitCount, 2);
  assert.deepEqual(
    harness.trace.filter(([name]) => name === "updateDevSelectedHit").map(([, hit]) => hit.id),
    ["land-1", "land-2"],
  );
  assert.deepEqual(
    harness.trace.find(([name]) => name === "setClickSelectedColor"),
    ["setClickSelectedColor", "#fedcba", { updateSwatch: true }],
  );
  assert.equal(traceNames(harness.trace).includes("applyVisualSubdivisionFill"), false);
});

test("preset admission after hydration delegates the refreshed land id only", async () => {
  const harness = await createTransactionOwner({
    state: { isEditingPreset: true },
    services: {
      getHitFromEvent: () => ({ targetType: "land", id: "land-1", countryCode: "AA", runtimeCountryCode: null }),
    },
  });
  await harness.owner.handleClick({});
  assert.deepEqual(
    harness.trace.filter(([name]) => name === "togglePresetRegion"),
    [["togglePresetRegion", "land-1"]],
  );
  assert.equal(traceNames(harness.trace).includes("setClickSelectedColor"), false);
});

test("a stale ownership-mode service cannot reactivate political editing", async () => {
  for (const activeSovereignCode of ["", "OWNER-1"]) {
    const harness = await createTransactionOwner({
      state: { activeSovereignCode },
      services: {
        getHitFromEvent: () => ({ targetType: "land", id: "land-1", countryCode: "AA", runtimeCountryCode: null }),
        isSovereigntyModeActive: () => true,
      },
    });
    await harness.owner.handleClick({});
    assert.ok(traceNames(harness.trace).includes("applyVisualSubdivisionFill"));
    for (const forbidden of ["setFeatureOwnerCodes", "resetFeatureOwnerCodes", "scheduleDynamicBorderRecompute", "warnMissingActiveSovereign"]) {
      assert.equal(traceNames(harness.trace).includes(forbidden), false);
    }
  }
});

test("country click paints the admitted feature batch instead of changing a geographic base palette", async () => {
  const harness = await createTransactionOwner({
    state: { interactionGranularity: "country" },
    services: {
      getHitFromEvent: () => ({ targetType: "land", id: "land-1", countryCode: "AA", runtimeCountryCode: "BB" }),
      resolveInteractionTargetIds: () => ["land-1", "land-2"],
    },
  });
  await harness.owner.handleClick({});
  assert.deepEqual(harness.trace.find(([name]) => name === "applyVisualSubdivisionFill"), [
    "applyVisualSubdivisionFill", ["land-1", "land-2"], "#123456",
    { kind: "fill-country-color", dirtyReason: "fill-country-color" },
  ]);
  for (const forbidden of ["setClickCountryColors", "refreshResolvedColorsForOwners", "setFeatureOwnerCodes"]) {
    assert.equal(traceNames(harness.trace).includes(forbidden), false);
  }
});

test("country eraser removes feature paint, preserving reference and base colors", async () => {
  const harness = await createTransactionOwner({
    state: { interactionGranularity: "country", currentTool: "eraser" },
    services: {
      getHitFromEvent: () => ({ targetType: "land", id: "land-1", countryCode: "AA", runtimeCountryCode: null }),
      resolveInteractionTargetIds: () => ["land-1", "land-2"],
    },
  });
  await harness.owner.handleClick({});
  assert.deepEqual(harness.trace.find(([name]) => name === "applyFeatureVisualOverrideTransaction"), [
    "applyFeatureVisualOverrideTransaction", ["land-1", "land-2"], null,
    { remove: true, inputStartedAt: 17, inputLabel: "erase-country-color" },
  ]);
  assert.equal(traceNames(harness.trace).includes("removeClickCountryColors"), false);
  assert.deepEqual(harness.trace.filter(([name]) => name === "captureHistoryState").map(([, scope]) => scope), [
    { featureIds: ["land-1", "land-2"] }, { featureIds: ["land-1", "land-2"] },
  ]);
});

test("incomplete country selection warns without painting, history or palette mutation", async () => {
  for (const currentTool of ["fill", "eraser"]) {
    const harness = await createTransactionOwner({
      state: { currentTool, interactionGranularity: "country" },
      services: {
        getHitFromEvent: () => ({ targetType: "land", id: "land-1", countryCode: "AA", runtimeCountryCode: null }),
        resolveInteractionTargetIds: () => [],
      },
    });
    await harness.owner.handleClick({});
    assert.equal(traceNames(harness.trace).at(-1), "warnIncompletePaintTargets");
    for (const forbidden of ["applyVisualSubdivisionFill", "applyFeatureVisualOverrideTransaction", "setClickCountryColors", "removeClickCountryColors", "captureHistoryState", "markDirty", "commitHistoryEntry"]) {
      assert.equal(traceNames(harness.trace).includes(forbidden), false);
    }
  }
});

test("land eyedropper samples persistent paint even with a partial group and a heatmap display", async () => {
  const harness = await createTransactionOwner({
    state: { currentTool: "eyedropper", interactionGranularity: "country", colors: { "land-1": "#ff0000" }, visualOverrides: { "land-1": "#00ff00" } },
    services: {
      getHitFromEvent: () => ({ targetType: "land", id: "land-1", countryCode: "AA", runtimeCountryCode: null }),
      resolveInteractionTargetIds: () => [],
    },
  });
  await harness.owner.handleClick({});
  assert.deepEqual(harness.trace.find(([name]) => name === "setClickSelectedColor"), ["setClickSelectedColor", "#00ff00", { updateSwatch: true }]);
  assert.equal(traceNames(harness.trace).includes("warnIncompletePaintTargets"), false);
});

test("an early HGO inspection failure propagates before hover or render effects", async () => {
  const failure = new Error("HGO inspection failed");
  const harness = await createTransactionOwner({
    services: {
      inspectHgoRuntimePreviewFromEvent: () => {
        harness.trace.push(["inspectHgoRuntimePreviewFromEvent"]);
        throw failure;
      },
    },
  });
  await assert.rejects(harness.owner.handleClick({}), failure);
  assert.deepEqual(traceNames(harness.trace), [
    "dismissOnboardingHint",
    "inspectHgoRuntimePreviewFromEvent",
  ]);
});

test("factory rejects missing ports and invalid constant values", async () => {
  const { createClickSelectionTransactionOwner } = await loadOwnerModule();
  assert.throws(() => createClickSelectionTransactionOwner(), /clickSnapRadiusPx/);
  assert.throws(
    () => createClickSelectionTransactionOwner({ constants: { clickSnapRadiusPx: 5 } }),
    /getters\.getClickState/,
  );
});
