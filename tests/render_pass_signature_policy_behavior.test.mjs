import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { parse } from "acorn";
import { createRenderPassSignaturePolicy } from "../js/core/renderer/render_pass_signature_policy.js";
import { RENDER_PASS_NAMES } from "../js/core/map_renderer/render_pass_catalog.js";
import { commitPhysicalContourDisplayState } from "../js/core/state/actions/content_load_actions.js";

function createHarness(overrides = {}) {
  const state = {
    zoomTransform: { k: 2, x: 10, y: 20 }, dpr: 2, width: 800, height: 600,
    topologyRevision: 1, styleConfig: {},
    intensityFields: { channels: { urbanGlow: { revision: 7 } } },
  };
  const live = { reuse: false, projection: {}, ready: false, debug: false, colorSensitive: false, visibility: "hgo-visibility" };
  const calls = [];
  const dependencies = {
    getTransformSignature: (t) => { calls.push("transform"); return `${t?.k}:${t?.x}:${t?.y}`; },
    getOceanBaseFillColor: () => "#123456",
    getDebugMode: () => live.debug,
    shouldEnableContextBaseTransformReuse: () => live.reuse,
    getViewportRenderSignature: () => `${state.width}:${state.height}`,
    getPhysicalLandMaskInfo: () => ({ maskSource: "land", maskFeatureCount: 3 }),
    getScenarioRuntimeTopologySignatureToken: () => "topology",
    getHgoRuntimePreviewVisibilitySignature: () => live.visibility,
    getHgoRuntimePreviewProjectionOptions: () => ({ projectionName: "mercator", sourceProjection: "geo" }),
    isHgoRuntimePreviewReady: () => live.ready,
    rendererSurfaceHost: { getProjection: () => live.projection },
    getContextBaseZoomBucketId: (k) => Math.floor(k),
    shouldRefreshContextBaseForColorChanges: () => live.colorSensitive,
    getScenarioOverlaySignatureToken: () => "overlays",
    getLakeBaseFillColor: () => "#abcdef",
    getLakeStyleConfig: () => ({ opacity: 1 }),
    stableJson: JSON.stringify,
    getDayNightRuntimeOwner: () => ({ buildDayNightPassSignature: (...args) => {
      calls.push(args);
      return args.join("::");
    } }),
    ...overrides,
  };
  return { state, live, calls, policy: createRenderPassSignaturePolicy(state, dependencies) };
}

const invalidationCases = [
  ["background", "topologyRevision"], ["physicalBase", "showPhysical"],
  ["political", "colorRevision"], ["hgoPreview", "width"],
  ["effects", "topologyRevision"], ["lineEffects", "topologyRevision"],
  ["contextBase", "contextLayerRevision"], ["contextMarkers", "cityLayerRevision"],
  ["labels", "scenarioStrategicValuesRevision"], ["contextScenario", "scenarioReliefOverlayRevision"],
  ["textureLabels", "topologyRevision"], ["dayNight", "topologyRevision"],
  ["borders", "sovereigntyRevision"],
];

test("country label visibility invalidates labels without invalidating political fill", () => {
  const { state, policy } = createHarness();
  const labels = policy.getRenderPassSignature("labels");
  const political = policy.getRenderPassSignature("political");
  state.styleConfig.countryLabels = { enabled: false };
  assert.notEqual(policy.getRenderPassSignature("labels"), labels);
  assert.equal(policy.getRenderPassSignature("political"), political);
});

test("physical region name opacity invalidates labels only while names are enabled", () => {
  const { state, policy } = createHarness();
  state.showPhysical = true;
  state.styleConfig.physical = { showRegionLabels: true, mode: "atlas_and_contours", opacity: 1 };
  const labels = policy.getRenderPassSignature("labels");
  state.styleConfig.physical.opacity = 0.5;
  assert.notEqual(policy.getRenderPassSignature("labels"), labels);

  state.styleConfig.physical.showRegionLabels = false;
  const namesHidden = policy.getRenderPassSignature("labels");
  state.styleConfig.physical.opacity = 0.25;
  assert.equal(policy.getRenderPassSignature("labels"), namesHidden);
});

test("physical base tracks the selected atlas identity rather than unrelated context publications", () => {
  const { state, policy } = createHarness();
  state.showPhysical = true;
  state.zoomTransform = { x: 0, y: 0, k: 1 };
  state.physicalSemanticsData = { features: [{}] };
  state.contextLayerExternalDataByName = {};
  const signature = (k = 1) => policy.getRenderPassSignature("physicalBase", { x: 0, y: 0, k });
  const overview = signature();
  state.contextLayerRevision = Number(state.contextLayerRevision || 0) + 1;
  state.contextLayerExternalDataByName.physical_region_labels = { features: [{}] };
  assert.equal(signature(), overview);
  state.contextLayerExternalDataByName.physical_semantics_detail = { features: [{}] };
  assert.equal(signature(), overview, "dormant detail must not redraw the overview");
  state.physicalSemanticsData = { features: [{}] };
  assert.notEqual(signature(), overview, "same-size replacement must update the atlas");

  const detail = signature(4);
  state.contextLayerRevision++;
  assert.equal(signature(4), detail);
  state.contextLayerExternalDataByName.physical_semantics_detail = { features: [{}] };
  assert.notEqual(signature(4), detail, "export/view transform selects the active detail identity");
  const replacement = signature(4);
  state.contextLayerExternalDataByName.physical_semantics_detail = { features: [] };
  assert.notEqual(signature(4), replacement, "empty detail falls back to the current overview");
});

test('a political border source publication invalidates only the border signature', () => {
  let revision=0;
  const {policy}=createHarness({getPoliticalBorderRevision:()=>revision});
  const borders=policy.getRenderPassSignature('borders');
  const fill=policy.getRenderPassSignature('political');
  revision++;
  assert.notEqual(policy.getRenderPassSignature('borders'),borders);
  assert.equal(policy.getRenderPassSignature('political'),fill);
});

test("strategic lens and resource filter changes invalidate their rendered passes", () => {
  const { state, policy } = createHarness();
  const before = policy.getRenderPassSignature("political");
  state.strategicChoroplethMetric = "steel";
  assert.notEqual(policy.getRenderPassSignature("political"), before);
  const metric = policy.getRenderPassSignature("political");
  state.styleConfig.strategicValues = { opacity: 0.2, palette: "rose", resourceFilter: "all" };
  assert.notEqual(policy.getRenderPassSignature("political"), metric);
  const resources = policy.getRenderPassSignature("contextMarkers");
  state.styleConfig.strategicValues.resourceFilter = "oil";
  assert.notEqual(policy.getRenderPassSignature("contextMarkers"), resources);
});

test("scoped topology promotion changes only dependent signatures, while unknown resets invalidate all", () => {
  const { state, policy } = createHarness();
  const names = ["background", "physicalBase", "political", "effects", "lineEffects", "labels"];
  const before = Object.fromEntries(names.map((name) => [name, policy.getRenderPassSignature(name)]));
  state.topologyRevision = 2;
  policy.recordScopedTopologyChange({ previousRevision: 1, targetPasses: ["political", "labels"] });
  for (const name of names) {
    assert.equal(policy.getRenderPassSignature(name) !== before[name], ["political", "labels"].includes(name), name);
  }
  const scoped = Object.fromEntries(names.map((name) => [name, policy.getRenderPassSignature(name)]));
  state.topologyRevision = 3;
  for (const name of names) assert.notEqual(policy.getRenderPassSignature(name), scoped[name], name);
  state.topologyRevision = 5;
  policy.recordScopedTopologyChange({ previousRevision: 4, targetPasses: [] });
  assert.match(policy.getRenderPassSignature("background"), /::5::/);
});

test("coastline border pixels invalidate on overlay visibility and geometry arrival", () => {
  let overlay = "pending";
  const { state, policy } = createHarness({ getScenarioOverlaySignatureToken: () => overlay });
  const initial = policy.getRenderPassSignature("borders");
  state.showWaterRegions = true;
  const water = policy.getRenderPassSignature("borders");
  assert.notEqual(water, initial);
  state.showScenarioAtlantropa = false;
  const hidden = policy.getRenderPassSignature("borders");
  assert.notEqual(hidden, water);
  overlay = "land-loaded";
  assert.notEqual(policy.getRenderPassSignature("borders"), hidden);
});

test("border pixels depend on country appearance rather than unrelated individual color edits", () => {
  let appearanceRevision = 1, contourRevision = 1;
  const { state, policy } = createHarness({ getBorderAppearanceRevision: () => appearanceRevision, getPaintContourRevision: () => contourRevision });
  const before = policy.getRenderPassSignature("borders");
  state.colorRevision = 7;
  assert.equal(policy.getRenderPassSignature("borders"), before);
  appearanceRevision += 1;
  assert.notEqual(policy.getRenderPassSignature("borders"), before);
  const recolored = policy.getRenderPassSignature("borders");
  state.styleConfig.internalBorders = { colorMode: "manual", color: "#ff0000" };
  assert.notEqual(policy.getRenderPassSignature("borders"), recolored);
  const manual = policy.getRenderPassSignature("borders");
  contourRevision += 1;
  assert.notEqual(policy.getRenderPassSignature("borders"), manual);
});

test("urban screen paint invalidates on zoom within a reuse bucket but not on pan or inactive urban data", () => {
  const { state, live, policy } = createHarness({ getContextBaseZoomBucketId: () => "high" });
  live.reuse = true;
  state.showUrban = true;
  state.urbanData = { features: [{}] };
  state.zoomTransform = { k: 10, x: 0, y: 0 };
  const atTen = policy.getRenderPassSignature("contextBase");
  state.zoomTransform.x = 20;
  assert.equal(policy.getRenderPassSignature("contextBase"), atTen);
  state.zoomTransform.k = 20;
  assert.notEqual(policy.getRenderPassSignature("contextBase"), atTen);
  for (const deactivate of [() => { state.showUrban = false; }, () => { state.showUrban = true; state.urbanData = null; }]) {
    deactivate();
    const inactive = policy.getRenderPassSignature("contextBase");
    state.zoomTransform.k += 1;
    assert.equal(policy.getRenderPassSignature("contextBase"), inactive);
  }
});

test("river detail tier changes the reusable context signature without changing the shared zoom bucket", () => {
  const { state, live, policy } = createHarness({ getContextBaseZoomBucketId: () => "high" });
  live.reuse = true;
  state.showRivers = true;
  const at = (k) => policy.getRenderPassSignature("contextBase", { k, x: 0, y: 0 });
  assert.notEqual(at(4.9), at(5));
  assert.equal(at(5), at(5.1));
  state.showRivers = false;
  assert.equal(at(4.9), at(5));
});

test("transport presentation changes invalidate shared labels without invalidating political pixels", () => {
  for (const change of [
    (state) => { state.showAirports = true; },
    (state) => { state.showPorts = true; },
    (state) => { state.currentLanguage = "zh"; },
    (state) => { state.sceneGeneration = 2; },
    (state) => { state.scenarioDataGeneration = 2; },
    (state) => { state.styleConfig.transportOverview = { airport: { labelSize: 14 } }; },
  ]) {
    const { state, policy } = createHarness();
    const before = Object.fromEntries(["political", "contextMarkers", "labels"].map((name) => [name, policy.getRenderPassSignature(name)]));
    change(state);
    assert.equal(policy.getRenderPassSignature("political"), before.political);
    assert.notEqual(policy.getRenderPassSignature("contextMarkers"), before.contextMarkers);
    assert.notEqual(policy.getRenderPassSignature("labels"), before.labels);
  }
});

test("contour-only publications leave transport and label caches intact", () => {
  for (const showTransport of [false, true]) {
    const { state, policy } = createHarness();
    Object.assign(state, { showTransport, showRoad: true, roadsData: { features: [{}] } });
    const before = Object.fromEntries(["contextBase", "contextMarkers", "labels"].map((name) =>
      [name, policy.getRenderPassSignature(name)]));
    commitPhysicalContourDisplayState(state, { major: { features: [{}] } });
    assert.notEqual(policy.getRenderPassSignature("contextBase"), before.contextBase);
    assert.equal(policy.getRenderPassSignature("contextMarkers"), before.contextMarkers);
    assert.equal(policy.getRenderPassSignature("labels"), before.labels);
    state.roadsData = { features: [{}] };
    for (const name of ["contextMarkers", "labels"]) {
      if (showTransport) assert.notEqual(policy.getRenderPassSignature(name), before[name]);
      else assert.equal(policy.getRenderPassSignature(name), before[name]);
    }
  }
});

test("visible transport overlays and rail stations invalidate cached labels", () => {
  const { state, policy } = createHarness();
  Object.assign(state, { showTransport: true, showRail: true,
    transportCountryOverlayState: { overlaysByFamily: { rail: { status: "ready", collectionsByLayer: {} } } } });
  for (const publish of [
    () => { state.railStationsMajorData = { features: [{}] }; },
    () => { state.transportCountryOverlayState.overlaysByFamily.rail.collectionsByLayer.railways = { features: [{}] }; },
    () => { state.transportCountryOverlayState.overlaysByFamily.rail.status = "idle"; },
  ]) {
    const before = policy.getRenderPassSignature("labels");
    publish();
    assert.notEqual(policy.getRenderPassSignature("labels"), before);
  }
});

test("marine visibility, selection, data and language invalidate only labels among unrelated passes", () => {
  for (const change of [
    (state) => { state.showWaterRegions = true; },
    (state) => { state.showOpenOceanRegions = true; },
    (state) => { state.allowOpenOceanPaint = true; },
    (state) => { state.selectedWaterRegionId = "tno_bo_hai"; },
    (state) => { state.waterRegionsDataToken = "new-water"; },
    (state) => { state.scenarioWaterOverlayVersionTag = "new-scenario-water"; },
    (state) => { state.currentLanguage = "zh"; },
  ]) {
    const { state, policy } = createHarness();
    const before = policy.getRenderPassSignature("labels");
    change(state);
    assert.notEqual(policy.getRenderPassSignature("labels"), before);
  }
});

test("sea name toggle invalidates labels without repainting the ocean background", () => {
  const { state, policy } = createHarness();
  state.styleConfig.ocean = { fillColor: "#aadaff", showRegionNames: false };
  const labels = policy.getRenderPassSignature("labels");
  const background = policy.getRenderPassSignature("background");
  state.styleConfig.ocean.showRegionNames = true;
  assert.notEqual(policy.getRenderPassSignature("labels"), labels);
  assert.equal(policy.getRenderPassSignature("background"), background);
});

test("every catalog pass reads its live invalidation input and ignores unrelated UI state", () => {
  assert.deepEqual(invalidationCases.map(([pass]) => pass).sort(), [...RENDER_PASS_NAMES].sort());
  for (const [pass, field] of invalidationCases) {
    const { state, policy } = createHarness();
    const before = policy.getRenderPassSignature(pass);
    state.selectedWaterRegionId = "unrelated-ui-selection";
    assert.equal(policy.getRenderPassSignature(pass) === before, pass !== "labels", `${pass}: water selection`);
    state[field] = Number(state[field] || 0) + 1;
    assert.notEqual(policy.getRenderPassSignature(pass), before, `${pass}: ${field}`);
  }
});

test("only contextBase can reuse a viewport signature across a pan, while zoom buckets still invalidate", () => {
  const { state, live, policy } = createHarness();
  live.reuse = true;
  const before = Object.fromEntries(RENDER_PASS_NAMES.map(pass => [pass, policy.getRenderPassSignature(pass)]));
  state.zoomTransform = { k: 2, x: 50, y: 80 };
  for (const pass of RENDER_PASS_NAMES) {
    assert.equal(policy.getRenderPassSignature(pass) === before[pass], pass === "contextBase", pass);
  }
  state.zoomTransform.k = 3;
  assert.notEqual(policy.getRenderPassSignature("contextBase"), before.contextBase);
  live.reuse = false;
  assert.equal(policy.getRenderPassTransformSignature("contextBase"), "3:50:80");
});

test("HGO identity distinguishes readiness, projection availability and live dimensions", () => {
  const { state, live, policy } = createHarness();
  state.hgoRuntimePreview = { status: "ready", summary: { province_count: 9, state_count: 4, country_count: 2 } };
  const before = policy.getRenderPassSignature("hgoPreview");
  assert.match(before, /^hgo:off::ready::2\.00::800::600::2:10:20::mercator::geo::seed:9:4:2$/);
  live.ready = true;
  live.projection = null;
  assert.match(policy.getRenderPassSignature("hgoPreview"), /^hgo:on::.*::projection:none::/);
});

test("HGO visibility invalidates exactly its seven dependent passes", () => {
  const { state, live, policy } = createHarness();
  const dependentPasses = new Set(["political", "contextBase", "contextMarkers", "labels", "contextScenario", "textureLabels", "borders"]);
  const before = Object.fromEntries(RENDER_PASS_NAMES.map(pass => [pass, policy.getRenderPassSignature(pass)]));
  live.visibility = "hgo-visible";
  for (const pass of RENDER_PASS_NAMES) {
    assert.equal(policy.getRenderPassSignature(pass) !== before[pass], dependentPasses.has(pass), pass);
  }
  state.colorRevision = 3;
  assert.match(policy.getRenderPassSignature("political"), /^3::hgo-visible::/);
});

test("context color sensitivity and nested state replacements are evaluated per call", () => {
  const { state, live, policy } = createHarness();
  const context = policy.getRenderPassSignature("contextBase");
  state.colorRevision = 4;
  assert.equal(policy.getRenderPassSignature("contextBase"), context);
  live.colorSensitive = true;
  assert.notEqual(policy.getRenderPassSignature("contextBase"), context);
  const background = policy.getRenderPassSignature("background");
  state.styleConfig = { ocean: { fillColor: "#000000" } };
  assert.notEqual(policy.getRenderPassSignature("background"), background);
});

test("signature evaluation preserves caller data and isolates independent renderer instances", () => {
  const first = createHarness();
  const second = createHarness();
  const snapshot = structuredClone(first.state);
  assert.equal(Object.isFrozen(first.policy), true);
  for (const pass of RENDER_PASS_NAMES) first.policy.getRenderPassSignature(pass);
  assert.deepEqual(first.state, snapshot);
  first.state.topologyRevision++;
  first.live.debug = true;
  assert.notEqual(first.policy.getPoliticalPassStaticSignature(), second.policy.getPoliticalPassStaticSignature());
  assert.deepEqual(second.state, snapshot);
});

test("explicit transforms, fallback pass identity and day/night delegation retain their contract", () => {
  const { state, calls, policy } = createHarness();
  const transform = { k: 4, x: 5, y: 6 };
  assert.equal(policy.getRenderPassSignature("unknown", transform), "4:5:6");
  assert.equal(policy.getRenderPassSignature("dayNight", transform), "4:5:6::7::1");
  assert.deepEqual(calls, ["transform", "transform", ["4:5:6", 7, 1]]);
  assert.equal(state.zoomTransform.k, 2);
});

test("entrypoint delegates default transform resolution once to the signature policy", () => {
  const source = fs.readFileSync(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  for (const [name, args] of [
    ["getPoliticalPassStaticSignature", []],
    ["getRenderPassTransformSignature", ["unknown"]],
    ["getRenderPassSignature", ["unknown"]],
  ]) {
    const { state, policy } = createHarness();
    let reads = 0;
    Object.defineProperty(state, "zoomTransform", { get() { reads++; return undefined; } });
    const node = ast.body.find(n => n.type === "FunctionDeclaration" && n.id.name === name);
    const invoke = new Function("runtimeState", "getRenderPassSignaturePolicy", `${source.slice(node.start, node.end)}; return ${name};`)(state, () => policy);
    const expected = policy[name](...args);
    const directReads = reads;
    reads = 0;
    assert.equal(invoke(...args), expected);
    assert.equal(reads, directReads, name);
  }
});

for (const [field, value] of Object.entries({
  contourColor: "#123456", contourOpacity: 0.2, contourMajorWidth: 2, contourMinorWidth: 1,
  contourMajorIntervalM: 1500, contourMinorIntervalM: 500, contourMinorVisible: false,
  contourMajorLowReliefCutoffM: 700, contourMinorLowReliefCutoffM: 900,
})) {
  test(`contour-only ${field} invalidates context without repainting physical base`, () => {
    const { state, policy } = createHarness();
    state.styleConfig.physical = { preset: "balanced", mode: "atlas_and_contours" };
    const base = policy.getRenderPassSignature("physicalBase");
    const contours = policy.getRenderPassSignature("contextBase");
    state.styleConfig.physical[field] = value;
    assert.equal(policy.getRenderPassSignature("physicalBase"), base);
    assert.notEqual(policy.getRenderPassSignature("contextBase"), contours);
  });
}

for (const [field, value] of Object.entries({
  atlasOpacity: 0.1, atlasIntensity: 1.4, atlasClassVisibility: { forest_temperate: false },
  rainforestEmphasis: 0.1, blendMode: "multiply",
})) {
  test(`atlas-only ${field} invalidates physical base without repainting context`, () => {
    const { state, policy } = createHarness();
    state.styleConfig.physical = { preset: "balanced", mode: "atlas_and_contours" };
    const base = policy.getRenderPassSignature("physicalBase");
    const contours = policy.getRenderPassSignature("contextBase");
    state.styleConfig.physical[field] = value;
    assert.notEqual(policy.getRenderPassSignature("physicalBase"), base);
    assert.equal(policy.getRenderPassSignature("contextBase"), contours);
  });
}

for (const [field, value] of Object.entries({ preset: "terrain_rich", mode: "atlas_only", opacity: 0.1 })) {
  test(`shared physical ${field} invalidates both dependent passes`, () => {
    const { state, policy } = createHarness();
    state.styleConfig.physical = { preset: "balanced", mode: "atlas_and_contours" };
    const before = ["physicalBase", "contextBase"].map((pass) => policy.getRenderPassSignature(pass));
    state.styleConfig.physical[field] = value;
    ["physicalBase", "contextBase"].forEach((pass, index) => assert.notEqual(policy.getRenderPassSignature(pass), before[index]));
  });
}

for (const [preset, beforeZoom, afterZoom] of [["balanced", 3.1, 3.3], ["terrain_rich", 3.9, 4.1]]) {
  test(`contour LOD threshold invalidates context even inside a reused bucket: ${preset}`, () => {
    const { state, live, policy } = createHarness({
      getTransformSignature: () => "same-transform",
      getContextBaseZoomBucketId: () => "same-bucket",
    });
    live.reuse = true;
    state.showPhysical = true;
    state.styleConfig.physical = { preset, mode: "atlas_and_contours", contourMinorVisible: true };
    state.zoomTransform.k = beforeZoom;
    const before = Object.fromEntries(["contextBase", "physicalBase", "political"].map((pass) => [pass, policy.getRenderPassSignature(pass)]));
    state.zoomTransform.k = afterZoom;
    assert.notEqual(policy.getRenderPassSignature("contextBase"), before.contextBase);
    assert.equal(policy.getRenderPassSignature("physicalBase"), before.physicalBase);
    assert.equal(policy.getRenderPassSignature("political"), before.political);
  });
}


test("loaded bathymetry invalidates the background signature", () => {
  const { state, policy } = createHarness();
  const before = policy.getRenderPassSignature("background");
  state.activeBathymetryTopologyUrl = "global.topo.json";
  assert.notEqual(policy.getRenderPassSignature("background"), before);
});

test("physical component controls and names invalidate only their drawing passes", () => {
  const { state, policy } = createHarness();
  state.styleConfig.physical = { mode: "atlas_only", landformIntensity: 1, landcoverIntensity: 1, hillshadeOpacity: 0, showRegionLabels: false };
  const base = policy.getRenderPassSignature("physicalBase");
  const contours = policy.getRenderPassSignature("contextBase");
  const labels = policy.getRenderPassSignature("labels");
  state.styleConfig.physical.landformIntensity = 0;
  assert.notEqual(policy.getRenderPassSignature("physicalBase"), base);
  assert.equal(policy.getRenderPassSignature("contextBase"), contours);
  assert.equal(policy.getRenderPassSignature("labels"), labels);
  state.styleConfig.physical.showRegionLabels = true;
  assert.notEqual(policy.getRenderPassSignature("labels"), labels);
});
