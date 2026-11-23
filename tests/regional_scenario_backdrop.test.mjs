import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { state } from "../js/core/state.js";
import { createRuntimeResourceBudget } from "../js/core/runtime_resource_budget.js";
import { getProjectedPathResourceAccounting } from "../js/core/renderer/projected_path_resource_accounting.js";
import { addFeaturesToDevSelection, clearDevSelection, fillSelectedParcels,
  ensureBathymetryReadyForExport, getOceanBaseFillColor, getWaterRegionColor, refreshMapDataForScenarioApply } from "../js/core/map_renderer.js";
import { createHitTestingOwner } from "../js/core/map_renderer/hit_testing_owner.js";
import { createBorderMeshOwner } from "../js/core/renderer/border_mesh_owner.js";
import { createPoliticalBackgroundRenderOwner } from "../js/core/renderer/political_background_render_owner.js";
import { createOceanRenderOwner, usesOceanSurfacePattern } from "../js/core/renderer/ocean_render_owner.js";
import { buildRegionalMemberCoastline, clipOceanOutsideLand, clipRegionalLakeOutline, drawRegionalLandEffect,
  getRegionalOceanLandMask } from "../js/core/renderer/regional_backdrop.js";

const require = createRequire(import.meta.url);
const topojson = require("../vendor/topojson-client.min.js");
const d3 = require("../vendor/d3.v7.min.js");
const collection = geometries => ({ type: "GeometryCollection", geometries });
const ring = (x, y, size) => [[x, y], [x, y + size], [x + size, y + size], [x + size, y], [x, y]];
const polygon = (arcs, id, country) => ({ type: "Polygon", arcs, properties: { id, cntr_code: country } });
const seam = [[10, 10], [10, 0]];
const arcs = [
  [[10, 0], [0, 0], [0, 10], [10, 10]], seam, [[10, 10], [20, 10], [20, 0], [10, 0]],
  ring(30, 0, 10), ring(33, 3, 4).reverse(),
];
const inside = polygon([[0, 1]], "AA-inside", "AA");
const outside = polygon([[~1, 2]], "BB-outside", "BB");
const primary = { type: "Topology", arcs, objects: {
  political: collection([inside, outside]),
  land: collection([polygon([[0, 2]]), polygon([[3], [4]])]),
  land_mask: collection([inside]),
} };
const detail = { ...primary, objects: { ...primary.objects, land: collection([inside]) } };
const regional = { ...primary, objects: { political: collection([inside]), land_mask: collection([inside]) } };
const points = [[25, 5], [15, 5], [5, 5], [31, 5], [35, 5]];
const ocean = "#227799", grey = "#b9b7b2", political = "#dd5522";
const ports = (overrides = {}) => new Proxy(overrides, {
  get: (target, key) => key in target ? target[key] : () => undefined,
});

test("a member edge crossing the physical shore is coastal only along its exposed portion", t => {
  const previous = globalThis.topojson;
  globalThis.topojson = topojson;
  t.after(() => previous ? globalThis.topojson = previous : delete globalThis.topojson);
  for (const west of [0, 175]) {
    const shift = ([x, y]) => [(west + x + 180) % 360 - 180, y];
    const member = ring(0, 0, 10);
    const mainland = [[0, 0], [0, 10], [10, 10], [10, 5], [20, 5], [20, 0], [0, 0]];
    const topology = (name, outline) => ({ type: "Topology", arcs: [outline.map(shift)],
      objects: { [name]: collection([polygon([[0]])]) } });
    const mesh = buildRegionalMemberCoastline({ activeScenarioManifest: { region: {
      backdrop: "none", bounds: [west, 0, shift([10, 0])[0], 10] } },
      topologyPrimary: topology("land", mainland), scenarioRuntimeTopologyData: topology("political", member) });
    const edges = mesh.coordinates.flatMap(line => line.slice(1).map((end, i) => [line[i], end].sort()));
    const expected = [[member[0], member[1]], [member[1], member[2]], [member[2], [10, 5]], [member[3], member[4]]];
    assert.deepEqual(edges.sort(), expected.map(edge => edge.map(shift).sort()).sort());
  }
});

test("a retained lake can be filled across the border while its decorative outline stops at member land", () => {
  const land = topojson.feature(regional, inside);
  const lake = { type: "Polygon", coordinates: [ring(2, 3, 12)] };
  const samples = [[2, 4], [14, 4]];
  let path = lake, clip = null;
  const surface = { getContext: () => ({ beginPath() { path = null; } }), getPathCanvas: () => shape => { path = shape; } };
  const applyClip = () => { path = clip = land; };
  for (const backdrop of ["none", "land"]) {
    path = lake;
    clip = null;
    assert.deepEqual([[3, 4], [13, 4]].map(p => d3.geoContains(path, p)), [true, true]);
    clipRegionalLakeOutline({ activeScenarioManifest: { region: { bounds: [0, 0, 20, 20], backdrop } } },
      surface, applyClip, null, [lake]);
    const outline = { type: "LineString", coordinates: path.coordinates[0] };
    assert.deepEqual(samples.map(p => d3.geoContains(outline, p) && (!clip || d3.geoContains(clip, p))),
      [true, backdrop === "land"]);
  }
});

function createPaintProbe() {
  let paths = [];
  const pixels = new Map();
  const context = {
    canvas: { width: 100, height: 50 }, setTransform() {},
    fillRect() { for (const point of points) pixels.set(point, this.fillStyle); },
    beginPath: () => { paths = []; }, save() {}, restore() {}, stroke() {},
    fill() {
      for (const point of points) {
        if (paths.some(shape => d3.geoContains(shape, point))) pixels.set(point, this.fillStyle);
      }
    },
    clip(rule) {
      assert.equal(rule, "evenodd");
      for (const point of points) pixels.set(point, paths.filter(shape => d3.geoContains(shape, point)).length % 2 === 1);
    },
  };
  const surface = { getContext: () => context, getPathCanvas: () => shape => paths.push(shape), getProjection: () => d3.geoEquirectangular() };
  const oceanPasses = [];
  const oceanOwner = createOceanRenderOwner({ state, getters: surface, helpers: {
    getOceanStyleConfig: () => state.styleConfig.ocean,
    drawBathymetryTexture() { oceanPasses.push("bathymetry"); return { status: "ready" }; },
  } });
  const resourceBudget = createRuntimeResourceBudget();
  const owner = createPoliticalBackgroundRenderOwner({
    surface, getters: { getRuntimeState: () => state, getDebugMode: () => "PROD" },
    platform: { topojson, d3 },
    helpers: ports({
      getFeatureId: feature => feature.properties.id, getSafeCanvasColor: value => value,
      getOceanBaseFillColor, getResolvedFeatureColor: () => political,
      normalizeIntensityFieldsState: () => state.intensityFields,
      getLogicalCanvasDimensions: () => [100, 50], getRenderPassCacheState: () => ({}),
      projectedBoundsIntersectScreenRects: () => true, getAdmin0BackgroundFillColor: code => code,
    }),
    effects: ports({ resourceBudget, politicalPathResourceAccounting: getProjectedPathResourceAccounting(resourceBudget),
      drawOceanStyle: oceanOwner.drawOceanStyle,
      getIntensityFieldMaskOwner: () => ({ getMaskCanvas() { oceanPasses.push("depth mask"); } }),
    }),
  });
  return {
    paint() {
      pixels.clear();
      oceanPasses.length = 0;
      owner.drawBackgroundPass();
      owner.drawPoliticalBackgroundFills();
      return points.map(p => pixels.get(p));
    },
    oceanPasses,
    oceanMask() {
      context.beginPath();
      clipOceanOutsideLand(surface, { type: "Sphere" }, getRegionalOceanLandMask(state).collection, null);
      return points.map(p => pixels.get(p));
    },
  };
}

function checkPicking() {
  const items = [...state.landIndex].map(([id, feature]) => ({ id, feature, minX: 0, minY: 0, maxX: 20, maxY: 10 }));
  const marine = { id: "sea", feature: { type: "Feature", geometry: { type: "Polygon", coordinates: [ring(0, 0, 45)] } },
    minX: 0, minY: 0, maxX: 45, maxY: 45 };
  const grid = { cellSize: 50, cols: 1, rows: 1 };
  const hit = createHitTestingOwner({ state: { ...state, showWaterRegions: true, spatialItems: items,
    spatialGrid: new Map(), spatialGridMeta: { ...grid, globals: items }, waterSpatialItems: [marine],
    waterSpatialGrid: new Map(), waterSpatialGridMeta: { ...grid, globals: [marine] } },
    deps: ports({ readSearchParam: () => "spatial", isWaterRegionEnabled: () => true }) });
  for (const eventType of ["hover", "click"]) {
    for (const [i, point] of points.entries()) {
      const pointer = { px: point[0], py: point[1], lonLat: point, zoomK: 1 };
      const options = { eventType, enableSnap: false };
      assert.equal(hit.getLandHitFromPointer({}, pointer, options).id, i === 2 ? inside.properties.id : null);
      assert.equal(hit.getWaterHitFromPointer(pointer, options).id, i === 0 || i === 4 ? "sea" : null);
    }
  }
}

for (const mode of ["single", "composite"]) {
  test(`regional land, lake and political cut edge from ${mode}`, async t => {
    const previous = Object.getOwnPropertyDescriptors(state);
    t.after(() => {
      for (const key of Object.keys(state)) if (!Object.hasOwn(previous, key)) delete state[key];
      Object.defineProperties(state, previous);
    });
    for (const [key, library] of Object.entries({ topojson, d3 })) {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
      globalThis[key] = library;
      t.after(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]);
    }
    Object.assign(state, {
      topology: primary, topologyPrimary: primary, topologyDetail: mode === "composite" ? detail : null,
      topologyBundleMode: mode, scenarioRuntimeTopologyData: regional, runtimePoliticalTopology: regional,
      activeScenarioManifest: { region: { bounds: [0, 0, 10, 10] } }, activeScenarioId: "region",
      styleConfig: { ...state.styleConfig,
        ocean: { fillColor: ocean, experimentalAdvancedStyles: true, preset: "bathymetry_soft" },
        lakes: { linkedToOcean: false, fillColor: "#abcabc" } },
      intensityFields: { ...state.intensityFields, channels: { ...state.intensityFields?.channels, oceanDepth: { enabled: true } } },
    });
    const refresh = () => refreshMapDataForScenarioApply({ suppressRender: true });
    refresh();
    if (mode === "composite") state.landBgData = topojson.feature(detail, detail.objects.land);
    state.colors = { [inside.properties.id]: political };
    const probe = createPaintProbe();
    assert.deepEqual(probe.paint(), [ocean, grey, political, grey, ocean]);
    assert.deepEqual(probe.oceanPasses, ["bathymetry", "depth mask"]);
    const land = state.landData;
    let clip;
    const effectsSurface = { getContext: () => ({ save() {}, restore() { clip = null; } }) };
    const texturedPoints = () => drawRegionalLandEffect(state, effectsSurface, () => { clip = land; return true; },
      () => points.map(point => !clip || d3.geoContains(clip, point)));
    assert.deepEqual(texturedPoints(), [true, true, true, true, true]);
    assert.deepEqual(probe.oceanMask(), [true, false, false, false, true]);
    const coast = state.cachedCoastlinesHigh.flatMap(mesh => mesh.coordinates);
    const segments = coast.flatMap(line => line.slice(1).map((end, i) => [line[i], end]));
    const segmentKey = segment => segment.map(point => point.join(",")).sort().join("|");
    assert.ok(segments.some(s => segmentKey(s) === segmentKey(arcs[2].slice(1, 3))));
    assert.ok(segments.some(s => segmentKey(s) === segmentKey(arcs[4].slice(0, 2))));
    assert.ok(!segments.some(s => segmentKey(s) === segmentKey(seam)));
    assert.deepEqual(state.cachedCountryBorders, []);
    const borders = createBorderMeshOwner({ state, helpers: {
      getEntityBorderMeshCountryCode: () => "AA", isAdmDetailTier: () => true,
    } });
    const admMesh = borders.buildDetailAdmBorderMesh(detail, new Set(["AA"]));
    assert.deepEqual(admMesh, topojson.mesh(regional, regional.objects.political));
    assert.deepEqual([...state.landIndex.keys()], [inside.properties.id]);
    assert.equal(state.countryToFeatureIds.has("BB"), false);
    assert.equal(state.idToKey.has(outside.properties.id), false);
    checkPicking();
    clearDevSelection();
    assert.equal(addFeaturesToDevSelection([outside.properties.id, inside.properties.id]), 1);
    assert.equal(fillSelectedParcels({ color: "#223344" }).changed, 1);
    assert.equal(state.visualOverrides[outside.properties.id], undefined);

    const region = state.activeScenarioManifest.region;
    region.backdrop = "none";
    refresh();
    state.colors = { [inside.properties.id]: political };
    assert.deepEqual(texturedPoints(), [false, false, true, false, false]);
    await ensureBathymetryReadyForExport(["background"], 3);
    for (const background of [ocean, "#343434"]) {
      if (background !== ocean) region.backdrop_fill = background;
      assert.deepEqual(probe.paint(), [background, background, political, background, background]);
      assert.deepEqual(probe.oceanPasses, []);
      assert.equal(usesOceanSurfacePattern(state, state.styleConfig.ocean), false);
      const lake = { properties: { id: "lake", water_type: "lake" } };
      for (const water of [lake, { properties: { id: "sea", water_type: "sea" } }]) {
        state.waterRegionOverrides = {};
        assert.equal(getWaterRegionColor(water.properties.id, water), background);
        state.waterRegionOverrides = { [water.properties.id]: "#aaccee" };
        assert.equal(getWaterRegionColor(water.properties.id, water), "#aaccee");
      }
    }
    checkPicking();
    const shores = state.cachedCoastlinesHigh.flatMap(mesh => mesh.coordinates)
      .flatMap(line => line.slice(1).map((end, i) => segmentKey([line[i], end])));
    assert.deepEqual(shores.sort(), arcs[0].slice(1).map((end, i) => segmentKey([arcs[0][i], end])).sort());
    region.backdrop = "land";
    delete region.backdrop_fill;
    refresh();
    state.colors = { [inside.properties.id]: political };
    assert.deepEqual(probe.paint(), [ocean, grey, political, grey, ocean]);
    assert.deepEqual(probe.oceanPasses, ["bathymetry", "depth mask"]);
    assert.equal(usesOceanSurfacePattern(state, state.styleConfig.ocean), true);
    assert.deepEqual(state.cachedCoastlinesHigh.flatMap(mesh => mesh.coordinates), coast);

    state.activeScenarioManifest.region.backdrop_fill = "#aaaaaa";
    state.scenarioRuntimeTopologyData = null;
    refresh();
    assert.deepEqual(probe.paint(), [ocean, "#aaaaaa", "#aaaaaa", "#aaaaaa", ocean]);
    state.activeScenarioId = "world";
    state.activeScenarioManifest = {};
    state.runtimePoliticalTopology = primary;
    refresh();
    assert.ok(state.landIndex.has(outside.properties.id));
    assert.deepEqual(state.cachedCountryBorders, [{ type: "MultiLineString", coordinates: [seam] }]);
    state.colors = { [inside.properties.id]: "#778811", [outside.properties.id]: "#116688" };
    assert.deepEqual(probe.paint(), [ocean, "#116688", "#778811", ocean, ocean]);
    assert.deepEqual(probe.oceanPasses, ["bathymetry", "depth mask"]);
    state.landDataFull = state.landData = { type: "FeatureCollection", features: [] };
    assert.deepEqual(probe.paint(), [ocean, "BB", "AA", ocean, ocean]);
  });
}
