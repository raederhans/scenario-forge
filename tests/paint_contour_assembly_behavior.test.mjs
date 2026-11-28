import assert from "node:assert/strict";
import test from "node:test";
import { createPaintContourAssembly } from "../js/core/renderer/paint_contour_assembly.js";

function rectangle(id, x, owner = "AAA", country = "AA") {
  return { id, properties: { owner, country, admin1: id },
    geometry: { type: "Polygon", coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]] } };
}

function harness(features = []) {
  const state = {
    activeScenarioId: "test", sceneGeneration: 1, colorRevision: 0, sovereigntyRevision: 0,
    landData: { features }, landDataFull: { features }, landIndex: new Map(features.map(feature => [feature.id, feature])),
    sovereignBaseColors: { AAA: "#ff0000", BBB: "#00ff00" }, visualOverrides: {},
    scenarioCountriesByTag: { AAA: { base_iso2: "AA" }, BBB: { base_iso2: "BB" } },
    scenarioBaselineOwnersByFeatureId: Object.fromEntries(features.map(feature => [feature.id, feature.properties.owner])),
  };
  const owners = [];
  const assembly = createPaintContourAssembly({
    runtimeState: state,
    getFeatureId: feature => feature.id,
    canonicalCountryCode: value => String(value || "").trim().toUpperCase(),
    getDisplayOwnerCode: (feature, id) => { owners.push(id); return feature.properties.owner; },
    getAdmin1Group: feature => feature.properties.admin1,
    getFeatureCountryCodeNormalized: feature => feature.properties.country,
    isScenarioShellFeature: feature => !!feature.properties.shell,
    getEffectiveWaterRegionFeatures: () => [],
    buildAtlantropaLandLikeFeatureCollection: () => null,
    hasVisibleRiverPartitions: () => false,
    shouldExcludePoliticalVisualFeature: () => false,
    isAtlantropaSeaFeature: () => false,
    LAND_FILL_COLOR: "#aaaaaa",
    invalidateRenderPasses() {},
    requestRendererRender() {},
    getRiverInternalContourOwner: () => ({ ensureReady: async () => {} }),
  });
  return { state, assembly, owners };
}

test("palette changes refresh boundary classification", async () => {
  const h = harness([rectangle("a", 0), rectangle("b", 1, "BBB", "BB")]);
  h.state.visualOverrides.b = "#ff0000";
  await h.assembly.ensurePaintContoursReady();
  const initial = h.assembly.getClassifiedBorderMeshes();
  assert.equal(initial.country.length, 0);
  assert.equal(initial.province.has("AAA"), false, "occupied land retains no former province boundary");
  h.state.sovereignBaseColors.AAA = "#0000ff";
  h.state.sovereignBaseColors.BBB = "#ff0000";
  h.state.colorRevision++;
  const next = h.assembly.getClassifiedBorderMeshes();
  assert.notEqual(next, initial);
  assert.equal(next.country.length, 1);
  h.assembly.disposePaintContoursIfCreated();
});

test("full-collection shells remain coverage-only", async () => {
  const base = rectangle("a", 0);
  const shell = rectangle("shell", 1);
  shell.properties.shell = true;
  const h = harness([base]);
  h.state.landDataFull = { features: [base, shell] };
  await h.assembly.ensurePaintContoursReady();
  assert.equal(h.assembly.getPaintContourRuntimeOwner().diagnostics().sentFeatures, 2);
  assert.ok(!h.owners.includes("shell"));
  h.assembly.disposePaintContoursIfCreated();
});
