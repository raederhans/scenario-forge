import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { state } from "../js/core/state.js";
import { createRuntimeResourceBudget } from "../js/core/runtime_resource_budget.js";
import { getProjectedPathResourceAccounting } from "../js/core/renderer/projected_path_resource_accounting.js";
import { addFeaturesToDevSelection, clearDevSelection, fillSelectedParcels,
  refreshMapDataForScenarioApply } from "../js/core/map_renderer.js";
import { createHitTestingOwner } from "../js/core/map_renderer/hit_testing_owner.js";
import { createBorderMeshOwner } from "../js/core/renderer/border_mesh_owner.js";
import { createPoliticalBackgroundRenderOwner } from "../js/core/renderer/political_background_render_owner.js";
import { clipOceanOutsideLand, getRegionalBackdrop } from "../js/core/renderer/regional_backdrop.js";

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

function createPaintProbe() {
  let paths = [];
  const pixels = new Map();
  const context = {
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
  const surface = { getContext: () => context, getPathCanvas: () => shape => paths.push(shape), getProjection: () => null };
  const resourceBudget = createRuntimeResourceBudget();
  const owner = createPoliticalBackgroundRenderOwner({
    surface, getters: { getRuntimeState: () => state, getDebugMode: () => "PROD" },
    platform: { topojson, d3 },
    helpers: ports({
      getFeatureId: feature => feature.properties.id, getSafeCanvasColor: value => value,
      getOceanBaseFillColor: () => ocean, getResolvedFeatureColor: () => political,
      getLogicalCanvasDimensions: () => [100, 50], getRenderPassCacheState: () => ({}),
      projectedBoundsIntersectScreenRects: () => true, getAdmin0BackgroundFillColor: code => code,
    }),
    effects: ports({ resourceBudget, politicalPathResourceAccounting: getProjectedPathResourceAccounting(resourceBudget) }),
  });
  return {
    paint() {
      pixels.clear();
      owner.drawBackgroundPass();
      owner.drawPoliticalBackgroundFills();
      return points.map(p => pixels.get(p));
    },
    oceanMask() {
      context.beginPath();
      clipOceanOutsideLand(surface, { type: "Sphere" }, getRegionalBackdrop(state).collection, null);
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
  test(`regional land, lake and political cut edge from ${mode}`, t => {
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
    });
    const refresh = () => refreshMapDataForScenarioApply({ suppressRender: true });
    refresh();
    if (mode === "composite") state.landBgData = topojson.feature(detail, detail.objects.land);
    state.colors = { [inside.properties.id]: political };
    const probe = createPaintProbe();
    assert.deepEqual(probe.paint(), [ocean, grey, political, grey, ocean]);
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
    state.landDataFull = state.landData = { type: "FeatureCollection", features: [] };
    assert.deepEqual(probe.paint(), [ocean, "BB", "AA", ocean, ocean]);
  });
}
