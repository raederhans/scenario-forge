import test from "node:test";
import assert from "node:assert/strict";
import d3 from "../vendor/d3.v7.min.js";
import { createTransportOverviewRenderOwner } from "../js/core/renderer/transport_overview_render_owner.js";
import { resolveTransportOverviewLineStrategy } from "../js/core/transport_capability_registry.js";
import { buildTransportOverviewLineStrokeSpecs } from "../js/core/renderer/transport_line_label_policy.js";
import { getTransportOverviewRailVisualStyle, getTransportOverviewRoadVisualStyle } from "../js/core/renderer/transport_overview_style_policy.js";

class RecordedPath {
  moveTo() {} lineTo() {} closePath() {} arc() {}
}

function matrix(a, d, e, f) {
  return { a, b: 0, c: 0, d, e, f, inverse: () => ({
    a: 1 / a, b: 0, c: 0, d: 1 / d, e: -e / a, f: -f / d,
  }) };
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
  return features;
}

function harness(family, features, { indexed = true } = {}) {
  const strokes = [];
  let transform = matrix(4, 4, 100, 100);
  const projection = d3.geoEquirectangular().scale(1000).translate([0, 0]);
  const context = new RecordedPath();
  if (indexed) context.canvas = { width: 400, height: 300 };
  context.getTransform = () => transform;
  context.save = () => {};
  context.restore = () => {};
  context.beginPath = () => {};
  context.setLineDash = () => {};
  context.stroke = (path = context) => strokes.push({ id: path.id, width: context.lineWidth });
  const rawPath = d3.geoPath(projection, context);
  const path = (feature) => { rawPath.context().id = feature.id; rawPath(feature); };
  path.context = (...args) => args.length ? rawPath.context(...args) : rawPath.context();
  path.bounds = (feature) => rawPath.bounds(feature);
  const collection = { type: "FeatureCollection", features };
  const config = { labelsEnabled: false, scopeLinkMode: "manual",
    scope: family === "road" ? "all" : "mainline_plus_regional", importanceThreshold: "all", opacity: 1, visualStrength: 0.5 };
  const dataKey = family === "road" ? "roadsData" : "railwaysData";
  const state = { showTransport: true, showRoad: true, showRail: true, zoomTransform: { k: 4 },
    styleConfig: { transportOverview: { visualMode: "network", [family]: config } }, [dataKey]: collection };
  const owner = createTransportOverviewRenderOwner({ state, helpers: {
    collectContextMetric() {},
    getContext: () => context, getPathCanvas: () => path, getProjection: () => projection,
    getPath2D: () => RecordedPath, nowMs: () => 0,
    getFeatureCollectionFeatureCount: (value) => value?.features?.length || 0,
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
    mixCanvasColors: (color) => color, setVisibleFacilityHoverEntries: () => {},
  } });
  return { context, strokes,
    setTransform(value) { transform = value; },
    draw() {
      strokes.length = 0;
      owner[family === "road" ? "drawRoadsLayer" : "drawRailwaysLayer"](4);
    },
    bounds: (feature) => rawPath.bounds(feature),
  };
}

function intersects(featureBounds, transform, canvas, padding) {
  const inverse = transform.inverse();
  const [[left, top], [right, bottom]] = featureBounds;
  return left <= inverse.a * canvas.width + inverse.e + padding
    && right >= inverse.e - padding
    && top <= inverse.d * canvas.height + inverse.f + padding
    && bottom >= inverse.f - padding;
}

test("indexed strokes match the full-scan viewport subset", () => {
  for (const family of ["road", "rail"]) {
    const features = featuresFor(family);
    const full = harness(family, features, { indexed: false });
    full.draw();
    const indexed = harness(family, features);
    const bounds = new Map(features.map((feature) => [feature.id, full.bounds(feature)]));
    const padding = Math.max(...full.strokes.map((stroke) => stroke.width)) / 2;
    const transforms = [matrix(8, 8, 200, 150), matrix(8, 8, -25000, 150), matrix(8, 8, 25200, 150)];
    for (const transform of transforms) {
      indexed.setTransform(transform);
      indexed.draw();
      const expected = full.strokes.filter((stroke) => intersects(bounds.get(stroke.id), transform, indexed.context.canvas, padding));
      assert.ok(expected.length > 0);
      assert.deepEqual(indexed.strokes, expected);
    }
  }
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
