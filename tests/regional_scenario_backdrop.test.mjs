import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { state } from "../js/core/state.js";
import { createRuntimeResourceBudget } from "../js/core/runtime_resource_budget.js";
import { getProjectedPathResourceAccounting } from "../js/core/renderer/projected_path_resource_accounting.js";
import { getOceanBaseFillColor, refreshMapDataForScenarioApply } from "../js/core/map_renderer.js";
import { createPoliticalBackgroundRenderOwner } from "../js/core/renderer/political_background_render_owner.js";
import { createOceanRenderOwner } from "../js/core/renderer/ocean_render_owner.js";
import { buildRegionalMemberCoastline, clipRegionalLakeOutline } from "../js/core/renderer/regional_backdrop.js";

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
  };
  const surface = { getContext: () => context, getPathCanvas: () => shape => paths.push(shape), getProjection: () => d3.geoEquirectangular() };
  const oceanOwner = createOceanRenderOwner({ state, getters: surface, helpers: {
    getOceanStyleConfig: () => state.styleConfig.ocean,
    drawBathymetryTexture() { return { status: "ready" }; },
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
      getIntensityFieldMaskOwner: () => ({ getMaskCanvas() {} }),
    }),
  });
  return {
    paint() {
      pixels.clear();
      owner.drawBackgroundPass();
      owner.drawPoliticalBackgroundFills();
      return points.map(p => pixels.get(p));
    },
  };
}

test("regional land and political cut edge", t => {
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
    topology: primary, topologyPrimary: primary, topologyDetail: null,
    topologyBundleMode: "single", scenarioRuntimeTopologyData: regional, runtimePoliticalTopology: regional,
    activeScenarioManifest: { region: { bounds: [0, 0, 10, 10] } }, activeScenarioId: "region",
    styleConfig: { ...state.styleConfig,
      ocean: { fillColor: ocean, experimentalAdvancedStyles: true, preset: "bathymetry_soft" },
      lakes: { linkedToOcean: false, fillColor: "#abcabc" } },
    intensityFields: { ...state.intensityFields, channels: { ...state.intensityFields?.channels, oceanDepth: { enabled: true } } },
  });
  refreshMapDataForScenarioApply({ suppressRender: true });

  state.colors = { [inside.properties.id]: political };
  const probe = createPaintProbe();
  assert.deepEqual(probe.paint(), [ocean, grey, political, grey, ocean]);
});
