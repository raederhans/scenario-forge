import test from "node:test";
import assert from "node:assert/strict";
import d3 from "../vendor/d3.v7.min.js";
import { createTransportOverviewRenderOwner } from "../js/core/renderer/transport_overview_render_owner.js";
import { markProjectionGeometryChanged } from "../js/core/renderer/projection_geometry_identity.js";
import { resolveTransportOverviewLineStrategy } from "../js/core/transport_capability_registry.js";
import { buildTransportOverviewLineStrokeSpecs } from "../js/core/renderer/transport_line_label_policy.js";
import { getTransportOverviewRailVisualStyle, getTransportOverviewRoadVisualStyle } from "../js/core/renderer/transport_overview_style_policy.js";

class RecordedPath {
  constructor() { this.commands = []; }
  moveTo(...args) { this.commands.push(["moveTo", ...args]); }
  lineTo(...args) { this.commands.push(["lineTo", ...args]); }
  closePath() { this.commands.push(["closePath"]); }
  arc(...args) { this.commands.push(["arc", ...args]); }
}

function matrix(a, d, e, f, b = 0, c = 0) {
  return { a, b, c, d, e, f, inverse() {
    const determinant = a * d - b * c;
    return { a: d / determinant, b: -b / determinant, c: -c / determinant,
      d: a / determinant, e: (c * f - d * e) / determinant, f: (b * e - a * f) / determinant };
  } };
}

function featuresFor(family) {
  const classes = family === "road" ? ["motorway", "trunk", "primary", "secondary"] : ["mainline", "regional", "secondary"];
  const features = Array.from({ length: 6000 }, (_, id) => {
    const x = -175 + (id % 120) * 2.9;
    const y = -70 + Math.floor(id / 120) * 2.8;
    return { type: "Feature", id, properties: { class: classes[id % classes.length], reveal_rank: 1, name: `Line ${id}`, ref: `R${id}` },
      geometry: { type: "LineString", coordinates: [[x, y], [x + 0.8, y + 0.4]] } };
  });
  features.push({ ...features[0], id: "dateline", geometry: { type: "LineString", coordinates: [[179, 0], [-179, 0]] } });
  features.push({ ...features[0], id: "curve", geometry: { type: "LineString", coordinates: [[-65, 50], [65, 50]] } });
  features.push({ ...features[1], id: "multi", geometry: { type: "MultiLineString", coordinates: [[[-20, 0], [20, 0]], [[179, 5], [-179, 5]]] } });
  return features;
}

function harness(family, features, { indexed = true, labelsEnabled = false, k = 4, overlay = false } = {}) {
  const strokes = [];
  const metrics = [];
  let transform = matrix(4, 4, 100, 100);
  let projectionCalls = 0;
  let boundsCalls = 0;
  const rawProjection = d3.geoEquirectangular().scale(1000).translate([0, 0]);
  const projection = (point) => { projectionCalls += 1; return rawProjection(point); };
  projection.stream = (...args) => rawProjection.stream(...args);
  const context = new RecordedPath();
  if (indexed) context.canvas = { width: 400, height: 300 };
  context.getTransform = () => transform;
  context.save = () => {};
  context.restore = () => {};
  context.beginPath = () => { context.commands = []; };
  context.setLineDash = (dash) => { context.dash = [...dash]; };
  context.stroke = (path = context) => strokes.push({ id: path.id, commands: path.commands.slice(),
    style: context.strokeStyle, width: context.lineWidth, opacity: context.globalAlpha,
    dash: context.dash, cap: context.lineCap, join: context.lineJoin });
  const rawPath = d3.geoPath(projection, context);
  const path = (feature) => { rawPath.context().id = feature.id; rawPath(feature); };
  path.context = (...args) => args.length ? rawPath.context(...args) : rawPath.context();
  path.bounds = (feature) => { boundsCalls += 1; return rawPath.bounds(feature); };
  const collection = { type: "FeatureCollection", features };
  const config = { labelsEnabled, labelDensity: "dense", scopeLinkMode: "manual",
    scope: family === "road" ? "all" : "mainline_plus_regional", importanceThreshold: "all", opacity: 1, visualStrength: 0.5 };
  const dataKey = family === "road" ? "roadsData" : "railwaysData";
  const state = { showTransport: true, showRoad: true, showRail: true, zoomTransform: { k },
    styleConfig: { transportOverview: { visualMode: "network", [family]: config } }, [dataKey]: collection };
  if (overlay) {
    state[dataKey] = { type: "FeatureCollection", features: [] };
    state.transportCountryOverlayState = { status: "ready", family, activePackId: "test", collectionsByLayer: {
      [family === "road" ? "roads" : "railways"]: collection,
    } };
  }
  const owner = createTransportOverviewRenderOwner({ state, helpers: {
    getContext: () => context, getPathCanvas: () => path, getProjection: () => projection,
    getPath2D: () => RecordedPath, nowMs: () => 0,
    collectContextMetric: (name, duration, detail) => metrics.push({ name, ...detail }),
    getFeatureCollectionFeatureCount: (value) => value?.features?.length || 0,
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
    mixCanvasColors: (color) => color, setVisibleFacilityHoverEntries: () => {},
    getLineMidpointFromCoordinates: (coordinates) => coordinates[0],
    getMultiLineLabelAnchor: (geometry) => geometry.coordinates[0][0],
  } });
  const metricName = `draw${overlay ? "Country" : ""}${family === "road" ? "Roads" : "Railways"}Layer`;
  return { state, collection, rawProjection, projection, context, strokes, metrics,
    setTransform(value) { transform = value; },
    get boundsCalls() { return boundsCalls; }, get projectionCalls() { return projectionCalls; },
    draw() { strokes.length = 0; owner[family === "road" ? "drawRoadsLayer" : "drawRailwaysLayer"](k); return metrics.findLast((entry) => entry.name === metricName); },
    bounds: (feature) => rawPath.bounds(feature),
  };
}

function intersects(featureBounds, transform, canvas, padding) {
  const inverse = transform.inverse();
  const corners = [[0, 0], [canvas.width, 0], [0, canvas.height], [canvas.width, canvas.height]]
    .map(([x, y]) => [inverse.a * x + inverse.c * y + inverse.e, inverse.b * x + inverse.d * y + inverse.f]);
  const [[left, top], [right, bottom]] = featureBounds;
  return left <= Math.max(...corners.map(([x]) => x)) + padding
    && right >= Math.min(...corners.map(([x]) => x)) - padding
    && top <= Math.max(...corners.map(([, y]) => y)) + padding
    && bottom >= Math.min(...corners.map(([, y]) => y)) - padding;
}

for (const family of ["road", "rail"]) {
  for (const overlay of [false, true]) {
    test(`${family} ${overlay ? "country" : "global"} indexed strokes match the viewport subset in order and style`, () => {
      const features = featuresFor(family);
      const full = harness(family, features, { indexed: false, overlay });
      full.draw();
      const indexed = harness(family, features, { overlay });
      const bounds = new Map(features.map((feature) => [feature.id, full.bounds(feature)]));
      const padding = Math.max(...full.strokes.map((stroke) => stroke.width)) / 2;
      const transforms = [matrix(8, 8, 200, 150), matrix(8, 8, -25000, 150), matrix(8, 8, 25200, 150), matrix(3, 3, 200, 3600, 0.2, -0.1)];
      for (const transform of transforms) {
        indexed.setTransform(transform);
        const metric = indexed.draw();
        const expected = full.strokes.filter((stroke) => intersects(bounds.get(stroke.id), transform, indexed.context.canvas, padding));
        assert.ok(expected.length > 0);
        assert.deepEqual(indexed.strokes, expected);
        assert.ok(metric.visitedFeatureCount < features.length / 4, `${metric.visitedFeatureCount} visited of ${features.length}`);
        assert.ok(metric.pathBuildCount <= metric.visibleFeatureCount);
        const repeated = indexed.draw();
        assert.equal(repeated.indexBuildFeatureCount, 0);
        assert.equal(repeated.pathBuildCount, 0);
      }
      assert.equal(indexed.boundsCalls, features.length);
      indexed.setTransform(transforms[1]);
      indexed.draw();
      assert.ok(indexed.strokes.some((stroke) => stroke.id === "dateline"));
      indexed.setTransform(transforms[2]);
      indexed.draw();
      assert.ok(indexed.strokes.some((stroke) => stroke.id === "dateline"));
    });
  }
}

test("line caches rebuild for projection generations and data identity", () => {
  const features = featuresFor("rail");
  const scene = harness("rail", features);
  assert.equal(scene.draw().indexBuildFeatureCount, features.length);
  scene.rawProjection.translate([10, 0]);
  markProjectionGeometryChanged(scene.projection);
  assert.equal(scene.draw().indexBuildFeatureCount, features.length);
  scene.collection.features = features.slice();
  assert.equal(scene.draw().indexBuildFeatureCount, features.length);
  scene.state.railwaysData = { ...scene.collection };
  assert.equal(scene.draw().indexBuildFeatureCount, features.length);
});

test("rail strategy disabling labels performs no candidate projections", () => {
  const scene = harness("rail", featuresFor("rail"), { k: 1, labelsEnabled: true });
  assert.ok(scene.draw().visibleFeatureCount > 0);
  assert.equal(scene.projectionCalls, 0);
  scene.draw();
  assert.equal(scene.projectionCalls, 0);
  const enabled = harness("rail", featuresFor("rail"), { k: 4, labelsEnabled: true });
  enabled.draw();
  assert.ok(enabled.projectionCalls > 0);
});

test("casing width includes lines immediately outside the canvas boundary", () => {
  for (const family of ["road", "rail"]) {
    const style = family === "road" ? getTransportOverviewRoadVisualStyle(undefined, 0.5) : getTransportOverviewRailVisualStyle(undefined, 0.5);
    const primary = family === "road" ? "motorway" : "mainline";
    const strategy = resolveTransportOverviewLineStrategy(family, {}, { scale: 4, visualMode: "network" });
    const specs = buildTransportOverviewLineStrokeSpecs({ casingWidth: style[`${primary}CasingWidth`], innerWidth: style[`${primary}Width`] }, { strategy, k: 4, widthFloorPx: family === "road" ? 1.1 : 1.05 });
    const radius = Math.max(...specs.map((spec) => spec.lineWidth)) / 2;
    const features = [0.9, 1.1].map((factor, id) => ({ type: "Feature", id, properties: { class: primary, reveal_rank: 1 },
      geometry: { type: "LineString", coordinates: [[-factor * radius * 180 / (Math.PI * 1000), -1], [-factor * radius * 180 / (Math.PI * 1000), -2]] } }));
    const scene = harness(family, features);
    scene.setTransform(matrix(4, 4, 0, 0));
    scene.draw();
    assert.deepEqual(scene.strokes.map((stroke) => stroke.id), [0, 0]);
  }
});
