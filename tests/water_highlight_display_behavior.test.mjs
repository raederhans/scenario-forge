import test from "node:test";
import assert from "node:assert/strict";
import { createWaterHighlightDisplay } from "../js/core/renderer/water_highlight_display.js";
import { createTransientOverlayRenderOwner } from "../js/core/renderer/transient_overlay_render_owner.js";

function createProjection({ scale = 1, translate = [0, 0] } = {}) {
  let currentScale = scale;
  let currentTranslate = [...translate];
  const projection = {
    scale(value) {
      if (value === undefined) return currentScale;
      currentScale = value;
      return projection;
    },
    translate(value) {
      if (value === undefined) return [...currentTranslate];
      currentTranslate = [...value];
      return projection;
    },
    stream(sink) {
      return {
        polygonStart: () => sink.polygonStart?.(),
        polygonEnd: () => sink.polygonEnd?.(),
        lineStart: () => sink.lineStart?.(),
        lineEnd: () => sink.lineEnd?.(),
        point(x, y) {
          sink.point?.(x * currentScale + currentTranslate[0], y * currentScale + currentTranslate[1]);
        },
      };
    },
  };
  return projection;
}

function streamGeometry(geometry, stream) {
  const line = (coordinates) => {
    stream.lineStart();
    for (const [x, y] of coordinates) stream.point(x, y);
    stream.lineEnd();
  };
  const polygon = (rings) => {
    stream.polygonStart();
    for (const ring of rings) line(ring);
    stream.polygonEnd();
  };

  switch (geometry.type) {
    case "Polygon": polygon(geometry.coordinates); break;
    case "MultiPolygon": for (const rings of geometry.coordinates) polygon(rings); break;
    case "LineString": line(geometry.coordinates); break;
    case "MultiLineString": for (const coordinates of geometry.coordinates) line(coordinates); break;
    case "GeometryCollection": for (const child of geometry.geometries) streamGeometry(child, stream); break;
    default: throw new Error(`Unsupported test geometry: ${geometry.type}`);
  }
}

function makeGeoStream(counter = { calls: 0 }) {
  return (featureOrGeometry, stream) => {
    counter.calls += 1;
    const geometry = featureOrGeometry.type === "Feature" ? featureOrGeometry.geometry : featureOrGeometry;
    streamGeometry(geometry, stream);
  };
}

function segmentedSquare(size, segments = 40, offset = [0, 0]) {
  const [ox, oy] = offset;
  const points = [];
  for (let index = 0; index <= segments; index += 1) points.push([ox + size * index / segments, oy]);
  points.push([ox + size, oy + size], [ox, oy + size], [ox, oy]);
  return points;
}

class TestGroup {
  attrs = {};
  selections = new Map();
  attr(name, value) { this.attrs[name] = value; return this; }
  selectAll(selector) {
    if (!this.selections.has(selector)) {
      const selection = {
        rows: [], attrs: {},
        data(rows, key) { this.rows = rows; this.keys = rows.map(key); return this; },
        enter() { return this; }, append() { return this; }, merge() { return this; },
        attr(name, value) {
          this.attrs[name] = this.rows.map((row, index) => typeof value === "function" ? value(row, index) : value);
          return this;
        },
        exit() { return { remove() {} }; },
      };
      this.selections.set(selector, selection);
    }
    return this.selections.get(selector);
  }
}

function createHoverOwnerHarness({ water = false, lake = false } = {}) {
  const feature = {
    type: "Feature",
    id: water ? "sea" : "land",
    properties: lake ? { water_type: "lake" } : {},
    geometry: { type: "Polygon", coordinates: [] },
  };
  const state = {
    renderPhase: "idle",
    hoveredId: water ? null : feature.id,
    hoveredWaterRegionId: water ? feature.id : null,
    hoveredSpecialRegionId: null,
    zoomTransform: { k: 2 },
    landIndex: new Map(water ? [] : [[feature.id, feature]]),
    waterRegionsById: new Map(water ? [[feature.id, feature]] : []),
    specialRegionsById: new Map(),
  };
  const hover = new TestGroup();
  let displayCalls = 0;
  const owner = createTransientOverlayRenderOwner(state, {
    rendererSurfaceHost: {
      getHoverGroup: () => hover,
      getPathSvg: () => () => "legacy-path",
      getProjection: () => createProjection(),
    },
    ensureSpecialZoneEditorState() {},
    getSpecialZoneStyle: () => ({}),
    DEFAULT_SPECIAL_ZONE_TYPE: "default",
    RENDER_PHASE_IDLE: "idle",
    isSpecialRegionEnabled: () => true,
    isWaterRegionEnabled: () => true,
    getFeatureId: (datum) => datum.id,
    getActiveFacilityHighlightEntry: () => null,
    buildFacilityEntryKey: (datum) => datum.id,
    waterHighlightDisplay: {
      get(datum, _projection, zoom) {
        displayCalls += 1;
        assert.equal(datum, feature);
        assert.equal(zoom, 2);
        return { svgPath: "simplified-water-path" };
      },
    },
  });
  return { owner, hover, getDisplayCalls: () => displayCalls };
}

test("projected marine display simplifies dense boundaries, preserves rings, and traces the same geometry", () => {
  const original = {
    type: "Feature",
    properties: { id: "sea" },
    geometry: {
      type: "Polygon",
      coordinates: [
        segmentedSquare(10),
        [[2, 2], [2, 5], [5, 5], [5, 2], [2, 2]],
      ],
    },
  };
  const before = structuredClone(original);
  const owner = createWaterHighlightDisplay({ geoStream: makeGeoStream() });
  const display = owner.get(original, createProjection(), 1);

  assert.ok(display);
  assert.equal(display.polylines.length, 2, "outer boundary and visible hole remain separate closed rings");
  assert.ok(display.polylines[0].points.length < original.geometry.coordinates[0].length / 4,
    "collinear projected points are removed");
  assert.ok(display.polylines.every((line) => line.closed));
  assert.equal((display.svgPath.match(/Z/g) || []).length, 2);
  assert.deepEqual(original, before, "display simplification never mutates source geometry");

  const calls = [];
  assert.equal(display.trace({
    beginPath: () => calls.push(["begin"]),
    moveTo: (...point) => calls.push(["move", ...point]),
    lineTo: (...point) => calls.push(["line", ...point]),
    closePath: () => calls.push(["close"]),
  }), true);
  assert.equal(calls.filter(([name]) => name === "move").length, 2);
  assert.equal(calls.filter(([name]) => name === "close").length, 2);
  assert.equal(calls.filter(([name]) => name === "line").length,
    display.polylines.reduce((total, line) => total + line.points.length - 1, 0));
});

test("subpixel rings disappear at low zoom and return when zoomed in", () => {
  const feature = {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [segmentedSquare(2, 12)] },
  };
  const owner = createWaterHighlightDisplay({ geoStream: makeGeoStream() });
  const projection = createProjection();
  const lowZoom = owner.get(feature, projection, 0.25);
  const highZoom = owner.get(feature, projection, 2);

  assert.equal(lowZoom.svgPath, "");
  assert.equal(lowZoom.polylines.length, 0);
  assert.ok(highZoom.svgPath.endsWith("Z"));
  assert.equal(highZoom.polylines.length, 1);
  assert.notEqual(lowZoom, highZoom, "different zoom buckets hold distinct display geometry");
});

test("cache reuses projected geometry but invalidates when mutable projection parameters change", () => {
  const counter = { calls: 0 };
  const feature = {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [segmentedSquare(10, 30)] },
  };
  const projection = createProjection();
  const owner = createWaterHighlightDisplay({ geoStream: makeGeoStream(counter) });
  const first = owner.get(feature, projection, 1);

  assert.equal(owner.get(feature, projection, 1), first);
  assert.equal(owner.get(feature.geometry, projection, 1), first,
    "raw GeoJSON geometry parts share the geometry identity cache with Features");
  assert.equal(counter.calls, 1, "same geometry, projection, and zoom bucket use the cached result");

  projection.translate([100, 20]);
  const panned = owner.get(feature, projection, 1);
  assert.notEqual(panned, first);
  assert.equal(counter.calls, 2, "projection translation invalidates clipped/projected coordinates");
  assert.ok(panned.svgPath.startsWith("M100,20"));
});

test("cache retention stays bounded and supports explicit reset", () => {
  const owner = createWaterHighlightDisplay({ geoStream: makeGeoStream(), maxEntries: 1 });
  const projection = createProjection();
  const feature = (id) => ({
    type: "Feature",
    properties: { id },
    geometry: { type: "Polygon", coordinates: [segmentedSquare(10)] },
  });

  owner.get(feature("one"), projection, 1);
  owner.get(feature("two"), projection, 1);
  assert.equal(owner.getCacheSize(), 1);
  owner.clear();
  assert.equal(owner.getCacheSize(), 0);
  assert.equal(owner.getCacheBytes(), 0);
});

test("byte budget avoids retaining an individually oversized display path", () => {
  const counter = { calls: 0 };
  const owner = createWaterHighlightDisplay({
    geoStream: makeGeoStream(counter),
    maxCacheBytes: 1,
  });
  const feature = {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [segmentedSquare(10)] },
  };
  const projection = createProjection();

  assert.ok(owner.get(feature.geometry, projection, 1));
  assert.equal(owner.getCacheSize(), 0);
  owner.get(feature.geometry, projection, 1);
  assert.equal(counter.calls, 2, "oversized entries are returned but not retained");
});

test("SVG path formatting stays within a hundredth of a screen pixel while canvas points keep precision", () => {
  const exactPoints = [[0.123456789, 0.234567891], [1.234567891, 1.345678912], [2.345678912, 0.123456789]];
  const feature = {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: exactPoints },
  };
  const owner = createWaterHighlightDisplay({ geoStream: makeGeoStream(), tolerancePx: 0 });
  const display = owner.get(feature, createProjection(), 1);

  assert.deepEqual(display.polylines[0].points, exactPoints, "canvas trace keeps full projected precision");
  const serializedPoints = [...display.svgPath.matchAll(/[ML](-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)]
    .map((match) => [Number(match[1]), Number(match[2])]);
  assert.equal(serializedPoints.length, exactPoints.length);
  for (let index = 0; index < exactPoints.length; index += 1) {
    assert.ok(Math.abs(serializedPoints[index][0] - exactPoints[index][0]) <= 0.005);
    assert.ok(Math.abs(serializedPoints[index][1] - exactPoints[index][1]) <= 0.005);
  }
});

test("hover owner uses softened display geometry for water while land keeps its legacy path", () => {
  const water = createHoverOwnerHarness({ water: true });
  water.owner.renderHoverOverlay();
  const waterPath = water.hover.selectAll("path.hovered-feature");
  assert.equal(water.getDisplayCalls(), 1);
  assert.deepEqual(waterPath.attrs.d, ["simplified-water-path"]);
  assert.deepEqual(waterPath.attrs["stroke-width"], [1.12]);
  assert.deepEqual(waterPath.attrs["stroke-opacity"], [0.86]);

  const land = createHoverOwnerHarness();
  land.owner.renderHoverOverlay();
  const landPath = land.hover.selectAll("path.hovered-feature");
  assert.equal(land.getDisplayCalls(), 0);
  assert.deepEqual(landPath.attrs.d, ["legacy-path"]);
  assert.deepEqual(landPath.attrs["stroke-width"], [1.45]);
  assert.deepEqual(landPath.attrs["stroke-opacity"], [1]);

  const lake = createHoverOwnerHarness({ water: true, lake: true });
  lake.owner.renderHoverOverlay();
  const lakePath = lake.hover.selectAll("path.hovered-feature");
  assert.equal(lake.getDisplayCalls(), 0);
  assert.deepEqual(lakePath.attrs.d, ["legacy-path"]);
  assert.deepEqual(lakePath.attrs["stroke-width"], [1.25]);
});
