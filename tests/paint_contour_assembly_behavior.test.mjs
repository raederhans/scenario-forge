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
  const events = [], owners = [];
  let sourceReads = 0;
  const internal = {
    ensureReady: async () => { events.push(["internal-ready"]); },
    notifyPaintChanged: ids => { events.push(["internal-paint", ids]); return false; },
    diagnostics: () => ({ status: "internal" }),
  };
  const assembly = createPaintContourAssembly({
    runtimeState: state,
    getFeatureId: feature => { sourceReads++; return feature.id; },
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
    invalidateRenderPasses: (...args) => events.push(["invalidate", ...args]),
    requestRendererRender: (...args) => events.push(["render", ...args]),
    getRiverInternalContourOwner: () => internal,
    getRiverContourRenderOwner: () => ({ diagnostics: () => ({ visible: true }) }),
  });
  return { state, assembly, events, owners, internal, sourceReads: () => sourceReads };
}

test("runtime is created on first use, reused, and disposal preserves the instance", async () => {
  const h = harness();
  assert.equal(h.assembly.hasPendingPaintContourWork(), undefined);
  assert.equal(h.assembly.disposePaintContoursIfCreated(), undefined);
  assert.equal(h.assembly.notifyPaintContourSourcePublished({ previousTopologyRevision: 0 }), undefined);
  assert.equal(h.assembly.hasPendingPaintContourWork(), undefined);
  assert.equal(h.sourceReads(), 0);
  const runtime = h.assembly.getPaintContourRuntimeOwner();
  assert.equal(h.assembly.getPaintContourRuntimeOwner(), runtime);
  assert.equal(h.assembly.hasPendingPaintContourWork(), false);
  const before = runtime.diagnostics().revision;
  h.assembly.disposePaintContoursIfCreated();
  assert.equal(h.assembly.getPaintContourRuntimeOwner(), runtime);
  assert.ok(runtime.diagnostics().revision > before);
  await h.assembly.ensurePaintContoursReady();
  assert.equal(runtime.diagnostics().status, "empty");
  assert.deepEqual(h.events, [["internal-ready"]]);
  h.assembly.disposePaintContoursIfCreated();
});

test("source publication only reaches an already created runtime", async () => {
  const h = harness([rectangle("a", 0)]);
  assert.equal(h.assembly.notifyPaintContourSourcePublished({ previousTopologyRevision: 0 }), undefined);
  assert.equal(h.sourceReads(), 0);
  const runtime = h.assembly.getPaintContourRuntimeOwner();
  h.assembly.notifyPaintContourSourcePublished({ previousTopologyRevision: 0 });
  assert.ok(h.sourceReads() > 0);
  assert.equal(h.assembly.hasPendingPaintContourWork(), true);
  await h.assembly.ensurePaintContoursReady();
  assert.equal(runtime.diagnostics().status, "ready");
  assert.equal(h.assembly.hasPendingPaintContourWork(), false);
  h.assembly.disposePaintContoursIfCreated();
});

test("border identity cache follows the palette revision and reuses unchanged inputs", () => {
  const item = rectangle("a", 0);
  const h = harness([item]);
  let enumerations = 0;
  h.state.sovereignBaseColors = new Proxy(h.state.sovereignBaseColors, {
    ownKeys(target) { enumerations++; return Reflect.ownKeys(target); },
  });
  h.state.visualOverrides.a = "#00ff00";
  assert.equal(h.assembly.resolveBorderIdentity("a", item), "BBB");
  const first = enumerations;
  assert.ok(first > 0);
  assert.equal(h.assembly.resolveBorderIdentity("a", item), "BBB");
  assert.equal(enumerations, first);
  h.state.sovereignBaseColors.BBB = "#0000ff";
  h.state.colorRevision++;
  assert.equal(h.assembly.resolveBorderIdentity("a", item), "color:#00ff00");
  assert.ok(enumerations > first);
  assert.equal(h.assembly.hasPendingPaintContourWork(), undefined);
});

test("palette revision refreshes real classification without rebuilding geometry", async () => {
  const h = harness([rectangle("a", 0), rectangle("b", 1, "BBB", "BB")]);
  h.state.visualOverrides.b = "#ff0000";
  await h.assembly.ensurePaintContoursReady();
  const initial = h.assembly.getClassifiedBorderMeshes();
  assert.equal(initial.country.length, 0);
  assert.equal(initial.province.has("AAA"), false, "occupied land retains no former province boundary");
  assert.equal(h.assembly.getClassifiedBorderMeshes(), initial);
  const builds = h.assembly.getPaintContourRuntimeOwner().diagnostics().builds;
  h.state.sovereignBaseColors.AAA = "#0000ff";
  h.state.sovereignBaseColors.BBB = "#ff0000";
  h.state.colorRevision++;
  const next = h.assembly.getClassifiedBorderMeshes();
  assert.notEqual(next, initial);
  assert.equal(next.country.length, 1);
  assert.equal(h.assembly.getPaintContourRuntimeOwner().diagnostics().builds, builds);
  assert.equal(h.state.specialZonesOverlayDirty, true);
  assert.ok(h.events.some(event => event[0] === "invalidate" && event[1] === "borders" && event[2] === "paint-contours-colors"));
  assert.ok(h.events.some(event => event[0] === "render" && event[1] === "paint-contours-colors" && event[2].flush === false));
  h.assembly.disposePaintContoursIfCreated();
});

test("full-collection shells remain coverage-only and river notifications keep their IDs", async () => {
  const base = rectangle("a", 0);
  const shell = rectangle("shell", 1);
  shell.properties.shell = true;
  const h = harness([base]);
  h.state.landDataFull = { features: [base, shell] };
  await h.assembly.ensurePaintContoursReady();
  const diagnostics = h.assembly.getPaintContourDiagnostics();
  assert.equal(diagnostics.sentFeatures, 2);
  assert.deepEqual(diagnostics.internal, { status: "internal" });
  assert.deepEqual(diagnostics.visibility, { visible: true });
  assert.ok(!h.owners.includes("shell"));
  const ids = ["a"];
  h.internal.notifyPaintChanged = value => { assert.equal(value, ids); return true; };
  h.assembly.notifyPaintContourColorsChanged(ids);
  assert.deepEqual(h.events.at(-1), ["invalidate", "borders", "paint-contours-colors"]);
  h.assembly.disposePaintContoursIfCreated();
});
