import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parse } from "acorn";

const rendererSource = readFileSync(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
const names = [
  "getScenarioAtlantropaRevisionToken", "getScenarioSurfaceVersionParts", "getScenarioSurfaceVersionSignal", "getScenarioWaterVisualRevisionToken",
  "getEffectiveWaterRegionFeatures", "getEffectiveAtlantropaFeatures", "getAtlantropaRenderLayer",
  "isScenarioAtlantropaVisible", "getScenarioWaterRegionsMode", "isScenarioWaterTopologyExclusiveMode",
  "getScenarioExcludedWaterRegionIds", "getScenarioExcludedWaterRegionGroups", "isScenarioWaterRegion",
  "isWaterRegionExcludedByScenario", "getObjectIdentityToken", "getScenarioDetailPhaseSignatureToken",
  "getScenarioRuntimeTopologySignatureToken", "estimateTopologyObjectArcRefs", "countTopologyArcRefs",
  "getPhysicalLandMaskInfo", "getFirstUsablePhysicalLandMaskInfo", "getPhysicalLandMaskCandidateQuality",
  "createPhysicalLandMaskInfo", "getScenarioOverlaySignatureToken",
];
const feature = (id, props = {}) => ({ type: "Feature", properties: { id, ...props } });

// Exercise the actual private entry functions without importing the DOM renderer.
export function createHarness(source = rendererSource) {
  const functions = parse(source, { ecmaVersion: "latest", sourceType: "module" }).body
    .filter((node) => node.type === "FunctionDeclaration" && names.includes(node.id.name));
  assert.equal(functions.length, names.length);
  const state = {
    activeScenarioId: "tno", activeScenarioManifest: {}, scenarioRuntimeTopologyData: {},
    scenarioLandMaskData: { features: [feature("mask")] },
    waterRegionsData: { features: [feature("base")] },
    scenarioWaterRegionsData: { features: [feature("scenario", { scenario_id: "tno" })] },
    scenarioAtlantropaData: { features: [feature("sea", { atl_render_layer: "water" }), feature("land", { atl_render_layer: "land" })] },
    showWaterRegions: true, showScenarioAtlantropa: true,
  };
  const calls = { water: 0, buckets: 0, mask: 0, revision: 0 };
  const context = vm.createContext({
    runtimeState: state, objectIdentityTokenCache: new WeakMap(), nextObjectIdentityToken: 1,
    SCENARIO_PRESENTATION_FEATURES: { ATLANTROPA_RELIEF: "atlantropa" },
    scenarioHasPresentationFeature: (manifest) => !!manifest.legacyAtlantropa,
    sanitizeWaterRegionFeatures: (features) => features.filter((entry) => !entry.properties.unsafe),
    getSphericalGeometryDiagnostics: () => ({ invalid: false }), recordRenderPerfMetric: () => {},
    getFeatureCollectionFeatureCount: (collection) => collection?.features?.length || 0,
    stableJson: JSON.stringify, getOceanBaseFillColor: () => "#ocean", getLakeBaseFillColor: () => "#lake",
    getLakeStyleConfig: () => ({ opacity: 1 }),
    getScenarioSpecialVisualRevisionToken: () => "special",
    getScenarioReliefVisualRevisionToken: () => "relief",
  });
  vm.runInContext(functions.map((node) => source.slice(node.start, node.end)).join("\n"), context);
  for (const [name, key] of [["getEffectiveWaterRegionFeatures", "water"], ["getEffectiveAtlantropaFeatures", "buckets"],
    ["getPhysicalLandMaskInfo", "mask"], ["getScenarioAtlantropaRevisionToken", "revision"]]) {
    const original = context[name];
    context[name] = (...args) => { calls[key]++; return original(...args); };
  }
  return { state, calls, context, water: () => context.getScenarioWaterVisualRevisionToken(),
    surface: () => context.getScenarioSurfaceVersionSignal() };
}

const atlantropa = "scenario-atlantropa:4:features:2:water:1:land:1:shoal:0:relief:0:visible:on";
const surface = "tno|runtime-tag:scenario-runtime-topology:1:na|na|na|na|na|detail-phase:single/detail-pending/detail-idle"
  + "|mask-tag:scenarioLandMask:scenario-mask:2:1:na:d3-valid|water-ref:scenario-water:3|water-tag:features:3"
  + `|water-mode:combined|atlantropa:${atlantropa}`;
const suffix = `|water-effective:3|water-scenario:1|water-atlantropa:${atlantropa}|water-overrides:{}`
  + "|scenario-water:on|open-ocean:off|open-ocean-select:off|open-ocean-paint:off"
  + '|ocean-fill:#ocean|lake-fill:#lake|lake-style:{"opacity":1}';

test("water signature preserves bytes and identity allocation while avoiding duplicate water composition and revision work", () => {
  const h = createHarness();
  assert.equal(h.water(), surface + suffix);
  assert.deepEqual(h.calls, { water: 1, buckets: 2, mask: 1, revision: 1 });
  assert.equal(h.water(), surface + suffix);
  assert.deepEqual(h.calls, { water: 2, buckets: 4, mask: 2, revision: 2 });
});

test("standalone surface and Atlantropa calls keep their no-argument semantics", () => {
  const h = createHarness();
  assert.equal(h.surface(), surface);
  assert.equal(h.context.getScenarioAtlantropaRevisionToken(), atlantropa);
  assert.equal(h.water(), surface + suffix);
});

test("water selection invalidates the composite while fill reuse survives selection and clearing", () => {
  const h = createHarness();
  const fill = h.water();
  const composite = h.context.getScenarioOverlaySignatureToken();
  h.state.selectedWaterRegionId = "scenario";
  assert.equal(h.water(), fill);
  assert.notEqual(h.context.getScenarioOverlaySignatureToken(), composite);
  h.state.selectedWaterRegionId = "";
  assert.equal(h.water(), fill);
  assert.equal(h.context.getScenarioOverlaySignatureToken(), composite);
  h.state.waterRegionOverrides = { scenario: "#123456" };
  assert.notEqual(h.water(), fill);
  h.state.waterRegionOverrides = {};
  assert.equal(h.water(), fill);
  h.state.showWaterRegions = false;
  assert.notEqual(h.water(), fill);
  h.state.showWaterRegions = true;
  h.state.activeScenarioId = "hoi4";
  assert.notEqual(h.water(), fill);
});

test("explicit revision tags retain their bytes and skip unused identity allocations", () => {
  const h = createHarness();
  Object.assign(h.state, { scenarioRuntimeTopologyVersionTag: " runtime-v2 ", scenarioContextLandMaskVersionTag: " mask-v3 ", scenarioWaterOverlayVersionTag: " water-v4 " });
  const token = h.water();
  assert.match(token, /runtime-tag:runtime-v2\|/);
  assert.match(token, /mask-tag:mask-v3\|water-ref:scenario-water:1\|water-tag:water-v4/);
  assert.match(token, /atlantropa:scenario-atlantropa:2:features:2/);
  assert.deepEqual(h.calls, { water: 1, buckets: 2, mask: 1, revision: 1 });
});

for (const mode of ["exclusive", "legacy", "combined"]) {
  test(`${mode} water mode retains filtering, sanitization, and shared effective count`, () => {
    const h = createHarness();
    h.state.activeScenarioManifest = mode === "legacy" ? { legacyAtlantropa: true } : { water_regions_mode: mode };
    h.state.waterRegionsData.features.push(feature("unsafe", { unsafe: true }), feature("excluded"));
    h.state.activeScenarioManifest.excluded_water_region_ids = ["excluded", "scenario"];
    const expected = mode === "combined" ? 3 : 2;
    const token = h.water();
    assert.ok(token.includes(`water-tag:features:${expected}|`));
    assert.ok(token.includes(`water-effective:${expected}|`));
    assert.deepEqual(Array.from(h.context.getEffectiveWaterRegionFeatures(), (entry) => entry.properties.id),
      mode === "combined" ? ["base", "scenario", "sea"] : ["scenario", "sea"]);
  });
}

test("in-place water, bucket classification, and visibility changes refresh on the next call", () => {
  const h = createHarness();
  const first = h.water();
  h.state.scenarioWaterRegionsData.features.push(feature("new", { scenario_id: "tno" }));
  h.state.scenarioAtlantropaData.features[1].properties.atl_render_layer = "water";
  const second = h.water();
  assert.notEqual(second, first);
  assert.match(second, /water-effective:5\|water-scenario:2/);
  assert.match(second, /features:2:water:2:land:0/);
  h.state.showScenarioAtlantropa = false;
  const hidden = h.water();
  assert.match(hidden, /water-effective:3\|/);
  assert.match(hidden, /features:2:water:0:land:0:shoal:0:relief:0:visible:off/);
  assert.deepEqual(h.calls, { water: 3, buckets: 6, mask: 3, revision: 3 });
});

test("an empty effective collection reuses zero and absent collections keep none identities", () => {
  const h = createHarness();
  Object.assign(h.state, { scenarioWaterRegionsData: null, scenarioAtlantropaData: null,
    scenarioLandMaskData: null, scenarioRuntimeTopologyData: null, waterRegionsData: null });
  const token = h.water();
  assert.match(token, /water-ref:scenario-water:none\|water-tag:features:0/);
  assert.match(token, /atlantropa:scenario-atlantropa:none:features:0/);
  assert.match(token, /water-effective:0\|water-scenario:0/);
  assert.deepEqual(h.calls, { water: 1, buckets: 2, mask: 1, revision: 1 });
});
