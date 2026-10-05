import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import { createCountryLabelRenderOwner, projectCountryLabelPolygons, waitForCountryLabelsForExport } from "../js/core/renderer/country_label_render_owner.js";
import { createCountryLabelLayoutWorkerHandler } from "../js/core/renderer/country_label_layout_worker.js";
import { getMapLabelHierarchy } from "../js/core/renderer/map_label_hierarchy.js";

const vendor = await readFile(new URL("../vendor/d3.v7.min.js", import.meta.url), "utf8");
const sandbox = {};
vm.runInNewContext(vendor, sandbox);
const d3 = sandbox.d3;

function createContext() {
  const events = [];
  const stack = [];
  return {
    events, font: "", globalAlpha: 1,
    save() { stack.push({ font: this.font, globalAlpha: this.globalAlpha }); },
    restore() { Object.assign(this, stack.pop()); },
    measureText(text) {
      events.push(["measure", text, this.font]);
      return { width: 60, actualBoundingBoxLeft: 4, actualBoundingBoxRight: 55,
        actualBoundingBoxAscent: 70, actualBoundingBoxDescent: 15 };
    },
    translate(x, y) { events.push(["translate", x, y]); },
    rotate(angle) { events.push(["rotate", angle]); },
    strokeText(text) { events.push(["stroke", text, this.font, this.globalAlpha, this.lineWidth]); },
    fillText(text) { events.push(["fill", text, this.font, this.globalAlpha]); },
  };
}

function createHarness({ names = ["AB"], fontSizes = [12], alternatives = [], realLayout = false, helperOptions = {} } = {}) {
  const context = createContext();
  const state = { styleConfig: {}, zoomTransform: { x: 0, y: 0, k: 1 }, language: "en" };
  const projection = { stream: (sink) => sink };
  let projectionIdentity = 1;
  const source = { status: "ready", sourceToken: {}, revision: 1,
    countries: names.map((name, index) => ({ countryCode: `C${index}`, name,
      feature: { type: "Feature", geometry: { type: "Polygon", coordinates: [
        [[20 + index * 180, 20], [170 + index * 180, 20], [170 + index * 180, 170], [20 + index * 180, 170], [20 + index * 180, 20]],
      ] } } })) };
  const fitCalls = [];
  const timers = new Map();
  let timerId = 0;
  const helpers = { geoStream: d3.geoStream,
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); }, ...helperOptions };
  if (!realLayout) {
    helpers.buildCountryLabelCandidates = (polygons) => [{ polygons }];
    helpers.fitCountryLabel = (candidates, options) => {
      fitCalls.push(options);
      const offset = candidates[0].polygons[0][0][0][0] - 20;
      const fontSize = Math.min(fontSizes[Math.round(offset / 180)] ?? 12, options.maxFontSize);
      const glyphs = options.glyphs.map((glyph, index) => ({ text: glyph.text,
        x: 70 + offset + index * 12, y: 90, angle: index * 0.04,
        box: { x: 68 + offset + index * 12, y: 80, w: 8, h: 13 } }));
      return { fontSize, glyphs, candidateIndex: 0,
        alternatives: alternatives.map((dy, index) => ({ fontSize, candidateIndex: index + 1,
          glyphs: glyphs.map((glyph) => ({ ...glyph, y: glyph.y + dy, box: { ...glyph.box, y: glyph.box.y + dy } })),
          bounds: { x: 68 + offset, y: 80 + dy, w: 8 + (glyphs.length - 1) * 12, h: 13 } })),
        bounds: { x: 68 + offset, y: 80, w: 8 + (glyphs.length - 1) * 12, h: 13 } };
    };
  }
  const owner = createCountryLabelRenderOwner({ state, helpers, getters: {
    getContext: () => context, getProjection: () => projection,
    getProjectionIdentity: () => projectionIdentity, getCountryLabelSource: () => source,
    getViewportSize: () => ({ width: 800, height: 700 }),
    getTransform: () => state.zoomTransform, getLanguage: () => state.language,
  } });
  return { owner, state, source, context, fitCalls, timers, setProjectionIdentity(value) { projectionIdentity = value; } };
}

test("projection streams split antimeridian exteriors and retain polygon holes", () => {
  const projection = d3.geoEquirectangular().scale(100).translate([400, 200]);
  const crossing = { type: "Polygon", coordinates: [[[170, -10], [170, 10], [-170, 10], [-170, -10], [170, -10]]] };
  const polygons = projectCountryLabelPolygons(crossing, projection, d3.geoStream);
  assert.equal(polygons.length, 2, "two clipped exterior rings cannot become an exterior and a hole");
  for (const polygon of polygons) {
    assert.equal(polygon.length, 1);
    const xs = polygon[0].map((point) => point[0]);
    assert.ok(Math.max(...xs) - Math.min(...xs) < 20, "date-line parts stay narrow");
  }
  const withHole = { type: "Polygon", coordinates: [
    [[0, 0], [0, 20], [20, 20], [20, 0], [0, 0]],
    [[5, 5], [15, 5], [15, 15], [5, 15], [5, 5]],
  ] };
  const projected = projectCountryLabelPolygons(withHole, projection, d3.geoStream);
  assert.equal(projected.length, 1);
  assert.equal(projected[0].length, 2);
});

test("ring grouping preserves nested islands, concave gaps and boundary containment", () => {
  const rectangle = (x, y, size) => [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]];
  const exterior = rectangle(-20, -20, 20);
  const hole = rectangle(-18, -18, 10);
  const island = rectangle(-16, -16, 4);
  const islandHole = rectangle(-15, -15, 1);
  const concave = [[10, 0], [30, 0], [30, 4], [14, 4], [14, 20], [10, 20], [10, 0]];
  const inConcaveGap = rectangle(20, 10, 2);
  const onIncludedBoundary = rectangle(-20, -5, 1);
  const onExcludedBoundary = rectangle(0, -5, 1);
  const disjoint = Array.from({ length: 250 }, (_, index) => rectangle(100 + index * 3, -10, 1));
  const input = [islandHole, inConcaveGap, ...disjoint, hole, onExcludedBoundary, concave, island, onIncludedBoundary, exterior];
  const polygons = projectCountryLabelPolygons({}, { stream: (sink) => sink }, (_feature, sink) => {
    // Model a projection emitting many rings within one clipped polygon.
    sink.polygonStart();
    for (const ring of input) {
      sink.lineStart();
      for (const [x, y] of ring) sink.point(x, y);
      sink.lineEnd();
    }
    sink.polygonEnd();
  });
  assert.equal(polygons.length, disjoint.length + 5);
  assert.deepEqual(polygons.find(([ring]) => ring[0][0] === -20), [exterior, hole, onIncludedBoundary]);
  assert.deepEqual(polygons.find(([ring]) => ring[0][0] === -16), [island, islandHole]);
  assert.deepEqual(polygons.find(([ring]) => ring[0][0] === 10), [concave]);
  assert.deepEqual(polygons.find(([ring]) => ring[0][0] === 20), [inConcaveGap]);
  assert.deepEqual(polygons.find(([ring]) => ring[0][0] === 0), [onExcludedBoundary]);
});

test("pan and zoom reuse map geometry and text fits while repainting transformed glyphs", () => {
  const { owner, state, context, setProjectionIdentity } = createHarness();
  const occupied = [];
  assert.equal(owner.drawCountryLabels(1, { occupiedBoxes: occupied }), 1);
  assert.equal(occupied.length, 2, "each real glyph reserves its own box");
  const first = { ...occupied[0] };
  state.zoomTransform = { k: 1.15, x: 8, y: 5 };
  const next = [];
  assert.equal(owner.drawCountryLabels(1.15, { occupiedBoxes: next }), 1);
  assert.equal(next[0].x, (first.x + 1.5) * 1.15 + 8 - 1.5);
  assert.equal(owner.getDiagnostics().geometryBuilds, 1);
  assert.equal(owner.getDiagnostics().candidateBuilds, 1);
  assert.equal(owner.getDiagnostics().fitBuilds, 1);
  assert.equal(context.events.filter(([event]) => event === "measure").length, 2);
  assert.deepEqual(context.events.filter(([event]) => event === "translate")[0], ["translate", 70, 90]);
  setProjectionIdentity(2);
  owner.drawCountryLabels(1.15);
  assert.equal(owner.getDiagnostics().geometryBuilds, 2);
  assert.equal(owner.getDiagnostics().fitBuilds, 2);
});

test("disabled, interactive and pending draws do not build or measure labels", () => {
  const { owner, state, source, context } = createHarness();
  assert.equal(owner.drawCountryLabels(1, { interactive: true }), 0);
  state.styleConfig.countryLabels = { enabled: false };
  assert.equal(owner.drawCountryLabels(1), 0);
  state.styleConfig.countryLabels.enabled = true;
  source.status = "pending";
  assert.equal(owner.drawCountryLabels(1), 0);
  assert.equal(owner.getDiagnostics().geometryBuilds, 0);
  assert.equal(context.events.length, 0);
  source.status = "ready";
  assert.equal(owner.drawCountryLabels(1), 1);
});

test("normalized real glyph metrics, graphemes and language fonts participate in text cache", () => {
  const { owner, state, source, context, fitCalls } = createHarness({ names: ["A\u0301中"] });
  owner.drawCountryLabels(1);
  assert.equal(fitCalls[0].glyphs.length, 2);
  assert.deepEqual(fitCalls[0].glyphs[0], { text: "A\u0301", advance: 0.6, left: 0.04, right: 0.55, ascent: 0.7, descent: 0.15 });
  assert.equal(fitCalls[0].glyphPadding, 0.06);
  assert.match(context.events.find(([event]) => event === "measure")[2], /^500 100px "Map Garamond"/);
  assert.match(context.events.find(([event]) => event === "fill")[2], /^500 .*"Map Garamond", "Palatino Linotype", Georgia, serif$/);
  assert.equal(context.events.find(([event]) => event === "stroke")[4], 0.45);
  assert.equal(fitCalls[0].allowArcs, true);
  assert.equal(fitCalls[0].preferGentleArcs, true);
  assert.ok(fitCalls[0].minArcComponentArea > 0);
  assert.equal(fitCalls[0].maxArcTiltDegrees, 15);
  assert.equal(fitCalls[0].maxArcBendDegrees, 22);
  assert.equal(fitCalls[0].maxTracking, 0.08);
  assert.ok(Math.abs(fitCalls[0].minHoleArea - 1 / Math.sqrt(2)) < 1e-8);
  assert.equal(fitCalls[0].readableFontSize, 10, "readability is measured at the band lower edge, not its upper edge");
  assert.equal(fitCalls[0].maxTiltDegrees, 30);
  assert.ok(context.events.find(([event]) => event === "measure")[2].includes("100px"));
  state.language = "zh";
  source.countries[0].name = "中国";
  owner.drawCountryLabels(1);
  assert.equal(fitCalls[1].maxArcTiltDegrees, 10);
  assert.equal(fitCalls[1].maxArcBendDegrees, 14);
  assert.equal(fitCalls[1].maxTracking, 0.14);
  assert.equal(owner.getDiagnostics().geometryBuilds, 1);
  assert.equal(owner.getDiagnostics().fitBuilds, 2);
  assert.match(context.events.filter(([event]) => event === "measure").at(-1)[2], /^400 100px "Map Noto Serif SC"/);
  assert.match(context.events.filter(([event]) => event === "fill").at(-1)[2], /^400 .*"Map Noto Serif SC", "Noto Serif SC", "Songti SC", SimSun, serif$/);
  owner.clearTextCache();
  assert.equal(owner.isReadyForCurrentView(), false);
  owner.drawCountryLabels(1);
  assert.equal(owner.getDiagnostics().geometryBuilds, 1);
  assert.equal(owner.getDiagnostics().candidateBuilds, 1);
  assert.equal(owner.getDiagnostics().fitBuilds, 3);
  assert.equal(owner.isReadyForCurrentView(), true);
});

test("fine glyph boxes allow gaps, but city collisions and viewport clipping reject full labels", () => {
  const { owner, state } = createHarness();
  assert.equal(owner.drawCountryLabels(1, { occupiedBoxes: [{ x: 77.6, y: 80, w: 0.8, h: 10 }] }), 1);
  assert.equal(owner.drawCountryLabels(1, { occupiedBoxes: [{ x: 69, y: 80, w: 2, h: 10 }] }), 0);
  state.zoomTransform.x = -70;
  assert.equal(owner.drawCountryLabels(1), 0);
  state.zoomTransform.x = -900;
  owner.clearTextCache();
  owner.drawCountryLabels(1);
  assert.equal(owner.getDiagnostics().fitBuilds, 1, "offscreen geography does not trigger a new fit");
});

test("collisions try cached alternative positions and reserve only the accepted fit", () => {
  const { owner } = createHarness({ alternatives: [30, 60] });
  const blocker = { x: 65, y: 75, w: 50, h: 20 };
  const occupied = [blocker];
  assert.equal(owner.drawCountryLabels(1, { occupiedBoxes: occupied }), 1);
  assert.equal(owner.getDiagnostics().lastLabels[0].candidateIndex, 1);
  assert.equal(occupied.length, 3, "failed placements do not leak occupancy");
  assert.ok(occupied.slice(1).every((box) => box.y > 100));
  assert.equal(owner.drawCountryLabels(1, { occupiedBoxes: [blocker, { x: 65, y: 105, w: 50, h: 20 }] }), 1);
  assert.equal(owner.getDiagnostics().lastLabels[0].candidateIndex, 2);
  assert.equal(owner.drawCountryLabels(1, { occupiedBoxes: [{ x: 65, y: 75, w: 50, h: 100 }] }), 0);
  assert.equal(owner.drawCountryLabels(1), 1, "cleared obstruction restores the primary");
  assert.equal(owner.getDiagnostics().lastLabels[0].candidateIndex, 0);
  assert.equal(owner.getDiagnostics().fitBuilds, 1, "repaints and collision retries never refit geometry");
});

test("macro label orchestration reserves capitals then countries then other city text; detail prioritizes cities", async () => {
  const renderer = await readFile(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
  const code = renderer.slice(renderer.indexOf("function drawLabelsPassContent(k,"), renderer.indexOf("function focusWaterRegionById("));
  const events = [];
  const runtimeState = { styleConfig: {}, deferContextBasePass: false };
  const countryBox = { x: 20, y: 20, w: 50, h: 12 };
  const markerBox = { x: 80, y: 20, w: 8, h: 8 };
  const capitalBox = { x: 90, y: 20, w: 45, h: 12 };
  const overviewLayout = { capitalBoxes: [capitalBox] };
  const scope = { runtimeState, getMapLabelHierarchy, isHgoRuntimePreviewReady: () => false, recordRenderPerfMetric() {},
    drawBlankFeatureLabelsPass() {}, shouldShowMarineRegionNames: () => false, nowMs: () => 0,
    getCityPointsRenderOwner: () => ({
      reserveOverviewLabelBoxes(_k, boxes) { events.push("capitals"); boxes.push(markerBox, capitalBox); return overviewLayout; },
      drawLabelsPass(_k, { occupiedBoxes, overviewLayout: reservation }) {
        events.push("cities");
        if (reservation) { assert.equal(reservation, overviewLayout); assert.ok(occupiedBoxes.includes(countryBox)); }
        else occupiedBoxes.push(markerBox, capitalBox);
      },
    }),
    getCountryLabelSourceOwner: () => ({ prepare() {} }),
    getCountryLabelRenderOwner: () => ({ drawCountryLabels(_k, { occupiedBoxes }) {
      events.push("countries"); assert.ok(occupiedBoxes.includes(markerBox)); assert.ok(occupiedBoxes.includes(capitalBox)); occupiedBoxes.push(countryBox);
    }, getDiagnostics: () => ({}) }),
    getTransportOverviewRenderOwner: () => ({ drawPendingLabels() {} }),
    getPhysicalLayerRenderOwner: () => ({ drawPhysicalRegionLabels() {} }),
  };
  vm.runInNewContext(code, scope);
  for (const k of [1, 2, 2.5, 3]) {
    events.length = 0;
    scope.drawLabelsPassContent(k);
    assert.deepEqual(events, ["capitals", "countries", "cities"]);
  }
  events.length = 0;
  scope.drawLabelsPassContent(4);
  assert.deepEqual(events, ["cities", "countries"]);
  events.length = 0;
  runtimeState.styleConfig.countryLabels = { enabled: false };
  scope.drawLabelsPassContent(1);
  assert.deepEqual(events, ["cities"]);
});

test("large-country labels survive magnification with a bounded screen font", () => {
  const { owner, state } = createHarness({ names: ["TEST"], realLayout: true });
  assert.equal(owner.drawCountryLabels(1), 1);
  const original = owner.getDiagnostics().lastLabels[0];
  for (const k of [2, 4, 8, 16]) {
    state.zoomTransform = { x: 400 - 95 * k, y: 350 - 95 * k, k };
    assert.equal(owner.drawCountryLabels(k), 1, `a centered major country remains labelled at ${k}x`);
    const label = owner.getDiagnostics().lastLabels[0];
    assert.ok(label.fontSizePx >= 10 && label.fontSizePx <= 32);
    assert.equal(label.alpha, original.alpha, "magnification does not fade a readable major country");
  }
});

test("country text steps into the background only while city text is enabled", () => {
  const { owner, state } = createHarness({ names: ["TEST"], realLayout: true });
  state.showCityPoints = true;
  assert.equal(owner.drawCountryLabels(1), 1);
  const baseAlpha = owner.getDiagnostics().lastLabels[0].alpha;
  state.zoomTransform = { x: 400 - 95 * 6, y: 350 - 95 * 6, k: 6 };
  const occupiedBoxes = [];
  assert.equal(owner.drawCountryLabels(6, { occupiedBoxes }), 0);
  assert.equal(occupiedBoxes.length, 0, "fully faded countries do not block city labels");
  const fitBuilds = owner.getDiagnostics().fitBuilds;
  for (const cityStyle of [{ showLabels: false }, { opacity: 0 }]) {
    state.styleConfig.cityPoints = cityStyle;
    assert.equal(owner.drawCountryLabels(6), 1);
    assert.equal(owner.getDiagnostics().lastLabels[0].alpha, baseAlpha);
  }
  state.styleConfig.cityPoints = {};
  state.showCityPoints = false;
  assert.equal(owner.drawCountryLabels(6), 1);
  assert.equal(owner.getDiagnostics().lastLabels[0].alpha, baseAlpha);
  assert.equal(owner.getDiagnostics().fitBuilds, fitBuilds, "hierarchy switches change paint, not geometry fitting");
});

test("long English display names preserve their supplied case and share export readiness keys", () => {
  const { owner, source, fitCalls } = createHarness({ names: ["New Zealand"] });
  assert.equal(owner.drawCountryLabels(1), 1);
  assert.equal(owner.getDiagnostics().lastLabels[0].text, "New Zealand");
  assert.equal(fitCalls[0].glyphs.map((glyph) => glyph.text).join(""), "New Zealand");
  assert.equal(owner.isReadyForCurrentView(), true);
  assert.equal(source.countries[0].name, "New Zealand");
  owner.drawCountryLabels(1);
  assert.equal(fitCalls.length, 1);
  source.countries[0].name = "Brazil";
  owner.drawCountryLabels(1);
  assert.equal(owner.getDiagnostics().lastLabels[0].text, "BRAZIL");
  assert.equal(owner.isReadyForCurrentView(), true);
});

test("a small country remains labelled locally while a large country's fade is stable during pan", () => {
  const { owner, source, state } = createHarness({ names: ["SMALL"], realLayout: true });
  state.showCityPoints = true;
  source.countries[0].feature.geometry.coordinates = [[[20, 20], [35, 20], [35, 35], [20, 35], [20, 20]]];
  state.zoomTransform = { x: 235, y: 185, k: 6 };
  assert.equal(owner.drawCountryLabels(6), 1);
  assert.equal(owner.getDiagnostics().lastLabels[0].alpha, 0.9);
  const large = createHarness({ names: ["LARGE"], realLayout: true });
  large.state.showCityPoints = true;
  for (const x of [-170, -500, -650]) {
    large.state.zoomTransform = { x, y: -220, k: 6 };
    assert.equal(large.owner.drawCountryLabels(6), 0);
    assert.equal(large.owner.getDiagnostics().rejectedByVisibility, 1);
  }
});

test("territory rather than short versus long readable names determines visibility and order", () => {
  const { owner, source } = createHarness({ names: ["AA", "AAAAAAAAAAAAAA"], realLayout: true });
  assert.equal(owner.drawCountryLabels(1), 2);
  const labels = owner.getDiagnostics().lastLabels;
  assert.ok(labels[0].fontSizePx > labels[1].fontSizePx, "the longer label is genuinely geometry constrained");
  assert.equal(labels[0].alpha, labels[1].alpha);
  source.countries[0].name = "AAAAAAAAAAAAAA";
  source.countries[1].name = "AA";
  assert.equal(owner.drawCountryLabels(1), 2);
  assert.deepEqual(owner.getDiagnostics().lastLabels.map((label) => label.countryCode), ["C0", "C1"], "text length does not reorder equal territories");
});

test("remote islands cannot use an inflated aggregate bbox to reveal tiny territories", () => {
  const { owner, source } = createHarness({ names: ["AA"], fontSizes: [12] });
  const square = (x) => [[[x, 20], [x + 10, 20], [x + 10, 30], [x, 30], [x, 20]]];
  source.countries[0].feature.geometry = { type: "MultiPolygon", coordinates: [square(20), square(600)] };
  assert.equal(owner.drawCountryLabels(1), 0);
  assert.equal(owner.getDiagnostics().rejectedByVisibility, 1);
  assert.equal(owner.getDiagnostics().rejectedLabels[0].visibleArea, 100);
});

test("separate mainland and overseas fits survive panning without refitting or duplicate titles", () => {
  const { owner, state, source } = createHarness({ names: ["Continental Republic"], realLayout: true });
  const square = (x, y, w, h) => [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]];
  source.countries[0].feature.geometry = { type: "MultiPolygon", coordinates: [square(20, 80, 220, 100), square(1000, 80, 110, 110)] };
  assert.equal(owner.drawCountryLabels(1), 1);
  assert.equal(owner.getDiagnostics().lastLabels[0].polygonIndex, 0);
  const builds = owner.getDiagnostics().fitBuilds;
  state.zoomTransform.x = -900;
  assert.equal(owner.drawCountryLabels(1), 1, "an independently retained overseas fit remains available");
  assert.equal(owner.getDiagnostics().lastLabels[0].polygonIndex, 1);
  state.zoomTransform = { x: 0, y: 0, k: 0.6 };
  assert.equal(owner.drawCountryLabels(0.6), 1, "both territories in view still produce a single country title");
  assert.equal(owner.getDiagnostics().lastLabels.length, 1);
  state.zoomTransform = { x: 0, y: 0, k: 1 };
  owner.drawCountryLabels(1);
  assert.equal(owner.getDiagnostics().fitBuilds, builds + 1, "only the new zoom band fits; panning reuses component fits");
});

test("a blocked dominant mainland cannot relocate its country title to a minor overseas territory", () => {
  const { owner, state, source } = createHarness({ names: ["Continental Republic"], realLayout: true });
  const square = (x, y, w, h) => [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]];
  source.countries[0].feature.geometry = { type: "MultiPolygon", coordinates: [square(20, 180, 350, 200), square(500, 80, 110, 110)] };
  assert.equal(owner.drawCountryLabels(1), 1);
  assert.equal(owner.getDiagnostics().lastLabels[0].polygonIndex, 0);
  assert.equal(owner.drawCountryLabels(1, { occupiedBoxes: [{ x: 20, y: 180, w: 350, h: 200 }] }), 0);
  state.zoomTransform.x = -400;
  assert.equal(owner.drawCountryLabels(1), 1, "overseas placement becomes available when the mainland leaves view");
  assert.equal(owner.getDiagnostics().lastLabels[0].polygonIndex, 1);
});

test("overseas visibility and local fade use the territory carrying the label", () => {
  const { owner, state, source } = createHarness({ names: ["A"], realLayout: true });
  const square = (x, y, w, h) => [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]];
  source.countries[0].feature.geometry = { type: "MultiPolygon", coordinates: [square(20, 20, 200, 80), square(1000, 20, 25, 25)] };
  state.showCityPoints = true;
  state.zoomTransform = { x: 400 - 1012.5 * 6, y: 350 - 32.5 * 6, k: 6 };
  assert.equal(owner.drawCountryLabels(6), 1, "the distant mainland must not suppress this small overseas label");
  const label = owner.getDiagnostics().lastLabels[0];
  assert.equal(label.polygonIndex, 1);
  const expected = 0.9 * (1 - (625 * 36 / (800 * 700) - 0.02) / 0.08);
  assert.ok(Math.abs(label.alpha - expected) < 1e-8);
  state.zoomTransform = { x: 400 - 120 * 6, y: 350 - 60 * 6, k: 6 };
  assert.equal(owner.drawCountryLabels(6), 0, "the large mainland still yields to cities at the same zoom");
  state.showCityPoints = false;
  assert.equal(owner.drawCountryLabels(6), 1);
});

test("same-band pan reuses fits, while bounded band caches reuse recent scales", () => {
  const { owner, state } = createHarness();
  for (const k of [1, 1.2, 1.5, 2, 3, 4, 6, 8]) {
    state.zoomTransform = { x: 400 - 80 * k, y: 350 - 90 * k, k };
    owner.drawCountryLabels(k);
    assert.ok(owner.getDiagnostics().cachedFits <= 4);
  }
  const builds = owner.getDiagnostics().fitBuilds;
  for (const x of [10, 20, 30]) {
    state.zoomTransform = { x: 400 - 80 * 8 + x, y: 350 - 90 * 8, k: 8 };
    owner.drawCountryLabels(8);
  }
  state.zoomTransform = { x: 400 - 80 * 6, y: 350 - 90 * 6, k: 6 };
  owner.drawCountryLabels(6);
  assert.equal(owner.getDiagnostics().fitBuilds, builds, "pans and returning to a cached band do not fit again");
});

test("rapid zoom caps pending per-country worker fits and resumes the current band", () => {
  const callbacks = [], messages = [];
  let worker;
  const { owner, state } = createHarness({ helperOptions: {
    onInvalidate() {}, scheduleWork: (callback) => callbacks.push(callback),
    createWorker: () => (worker = { postMessage: (message) => messages.push(message), terminate() {} }),
  } });
  for (const k of [1, 1.2, 1.5, 2, 3, 4, 6, 8]) {
    state.zoomTransform = { x: 400 - 95 * k, y: 350 - 95 * k, k };
    owner.drawCountryLabels(k);
    callbacks.shift()?.();
  }
  assert.equal(messages.length, 4);
  assert.equal(owner.getDiagnostics().pendingWorkerFits, 4);
  assert.equal(owner.isReadyForCurrentView(), false);
  const handle = createCountryLabelLayoutWorkerHandler();
  for (const message of messages.splice(0)) worker.onmessage({ data: handle(message) });
  owner.drawCountryLabels(8);
  callbacks.shift()();
  assert.equal(messages.length, 1, "current uncached band resumes after pending work completes");
  worker.onmessage({ data: handle(messages.shift()) });
  assert.equal(owner.drawCountryLabels(8), 1);
  assert.equal(owner.isReadyForCurrentView(), true);
  assert.equal(owner.getDiagnostics().cachedFits, 4);
});

test("delayed zoom-band workers preserve safe same-text labels while readiness stays pending", () => {
  const callbacks = [], messages = [];
  let worker;
  const { owner, state, source } = createHarness({ names: ["TEST"], helperOptions: {
    onInvalidate() {}, scheduleWork: (callback) => callbacks.push(callback),
    createWorker: () => (worker = { postMessage: (message) => messages.push(message), terminate() {} }),
  } });
  const handle = createCountryLabelLayoutWorkerHandler();
  owner.drawCountryLabels(1);
  callbacks.shift()();
  worker.onmessage({ data: handle(messages.shift()) });
  assert.equal(owner.drawCountryLabels(1), 1);
  state.zoomTransform.k = 1.2;
  assert.equal(owner.drawCountryLabels(1.2), 1, "a safe old fit remains painted during worker preparation");
  assert.equal(owner.isReadyForCurrentView(), false);
  assert.equal(owner.getDiagnostics().pendingFits, 1);
  callbacks.shift()();
  assert.equal(messages[0].polygons, undefined);
  state.zoomTransform.x = 10;
  assert.equal(owner.drawCountryLabels(1.2), 1, "in-band pan can use the same safe fallback");
  assert.equal(owner.getDiagnostics().geometryBuilds, 1);
  assert.equal(owner.getDiagnostics().candidateBuilds, 1);
  assert.equal(messages.length, 1, "pan cannot enqueue another fit request");
  worker.onmessage({ data: handle(messages.shift()) });
  assert.equal(owner.drawCountryLabels(1.2), 1);
  assert.equal(owner.isReadyForCurrentView(), true);
  assert.equal(owner.getDiagnostics().candidateBuilds, 1, "the worker reuses projected candidates across bands");
  state.language = "zh";
  source.countries[0].name = "中国";
  assert.equal(owner.drawCountryLabels(1.2), 0, "a prior language must not appear as a pending fallback");
});

test("zoom fallback cannot retain a fit that discarded a hole significant in the new band", () => {
  const callbacks = [], messages = [];
  let worker;
  const { owner, state, source } = createHarness({ names: ["TEST"], helperOptions: {
    onInvalidate() {}, scheduleWork: (callback) => callbacks.push(callback),
    createWorker: () => (worker = { postMessage: (message) => messages.push(message), terminate() {} }),
  } });
  source.countries[0].feature.geometry.coordinates.push([[75, 95], [75.8, 95], [75.8, 95.8], [75, 95.8], [75, 95]]);
  const handle = createCountryLabelLayoutWorkerHandler();
  owner.drawCountryLabels(1);
  callbacks.shift()();
  const first = handle(messages.shift());
  assert.ok(first.fit.minHoleArea > 0, "the small hole was intentionally discarded at the first band");
  worker.onmessage({ data: first });
  assert.equal(owner.drawCountryLabels(1), 1);
  state.zoomTransform.k = 1.2;
  assert.equal(owner.drawCountryLabels(1.2), 0, "an increasingly visible hole invalidates the old fallback");
  assert.equal(owner.isReadyForCurrentView(), false);
  callbacks.shift()();
  const next = handle(messages.shift());
  assert.equal(next.fit.minHoleArea, 0, "the new band fit checks the now-significant hole strictly");
  worker.onmessage({ data: next });
  assert.equal(owner.drawCountryLabels(1.2), 1);
  assert.equal(owner.isReadyForCurrentView(), true);
});

test("a fully visible edge label ignores collision padding and tries cached viewport alternatives", () => {
  const { owner, state } = createHarness({ alternatives: [30] });
  state.zoomTransform.y = -79;
  assert.equal(owner.drawCountryLabels(1), 1, "padding crossing the viewport does not clip actual glyph boxes");
  state.zoomTransform.y = -85;
  assert.equal(owner.drawCountryLabels(1), 1);
  assert.equal(owner.getDiagnostics().lastLabels[0].candidateIndex, 1);
  assert.equal(owner.getDiagnostics().fitBuilds, 1);
  state.zoomTransform.y = -115;
  assert.equal(owner.drawCountryLabels(1), 0);
  assert.equal(owner.getDiagnostics().rejectedByViewport, 1);
  assert.equal(owner.getDiagnostics().rejectedLabels[0].reason, "Viewport");
});

test("geometry and fitting run in bounded deferred tasks while repaint stays free of preparation", () => {
  let now = 0;
  const callbacks = [];
  let invalidations = 0;
  const { owner } = createHarness({ names: ["A", "B", "C"], helperOptions: {
    nowMs: () => { now += 7; return now; },
    scheduleWork: (callback) => callbacks.push(callback),
    onInvalidate: () => { invalidations += 1; },
  } });
  owner.drawCountryLabels(1);
  assert.equal(owner.getDiagnostics().fitBuilds, 0);
  assert.equal(owner.getDiagnostics().projectedCountries, 0);
  assert.equal(owner.getDiagnostics().pendingFits, 3);
  owner.drawCountryLabels(1);
  assert.equal(callbacks.length, 1);
  callbacks.shift()();
  assert.equal(invalidations, 1);
  owner.drawCountryLabels(1);
  for (let turn = 0; turn < 12 && owner.getDiagnostics().pendingFits; turn += 1) {
    callbacks.shift()();
    owner.drawCountryLabels(1);
  }
  assert.equal(owner.getDiagnostics().fitBuilds, 3);
  assert.equal(owner.getDiagnostics().pendingFits, 0);
});

test("deferred preparation batches countries and bounds the serial worker queue", () => {
  const callbacks = [], messages = [];
  let invalidations = 0;
  let worker;
  const { owner } = createHarness({ names: Array.from({ length: 12 }, (_, i) => `C${i}`), helperOptions: {
    nowMs: () => 0,
    scheduleWork: (callback) => callbacks.push(callback),
    onInvalidate: () => { invalidations += 1; },
    createWorker: () => (worker = { postMessage: (message) => messages.push(message), terminate() {} }),
  } });
  owner.drawCountryLabels(1);
  callbacks.shift()();
  assert.equal(messages.length, 8, "one bounded batch prepares multiple worker requests");
  assert.equal(invalidations, 1, "preparation shares one repaint across the batch");
  owner.drawCountryLabels(1);
  assert.equal(callbacks.length, 0, "a full queue waits for completion instead of flooding the worker");
  for (const message of messages.slice(0, 4)) worker.onmessage({ data: { requestId: message.requestId, fit: null } });
  assert.equal(owner.getDiagnostics().pendingWorkerFits, 4);
  owner.drawCountryLabels(1);
  callbacks.shift()();
  assert.equal(messages.length, 12, "pending worker requests are not queued again");
  assert.equal(owner.getDiagnostics().pendingWorkerFits, 8, "released slots are refilled without exceeding the queue cap");
  assert.equal(invalidations, 6);
  owner.clearTextCache();
  owner.drawCountryLabels(1);
  assert.equal(callbacks.length, 0);
  worker.onmessage({ data: { requestId: messages[4].requestId, fit: null } });
  assert.equal(invalidations, 7, "a stale text response still wakes preparation after releasing a slot");
  owner.drawCountryLabels(1);
  callbacks.shift()();
  assert.equal(messages.length, 13, "the current text generation resumes within the queue cap");
  assert.equal(owner.getDiagnostics().pendingWorkerFits, 8);
});

test("actual layout can render a complete projected country using measured glyph bounds", () => {
  const { owner, context } = createHarness({ names: ["TEST"], realLayout: true });
  assert.equal(owner.drawCountryLabels(1), 1);
  assert.equal(owner.getDiagnostics().glyphsDrawn, 4);
  assert.equal(context.events.filter(([event]) => event === "stroke").length, 4);
});

test("worker fits reuse projected geometry and discard responses after text or projection invalidation", () => {
  const callbacks = [];
  const messages = [];
  const workers = [];
  const handle = createCountryLabelLayoutWorkerHandler();
  const { owner, state, source, setProjectionIdentity } = createHarness({ names: ["TEST"], helperOptions: {
    onInvalidate() {}, scheduleWork: (callback) => callbacks.push(callback),
    createWorker() {
      const worker = { terminate() { this.terminated = true; }, postMessage(message) { messages.push(message); } };
      workers.push(worker);
      return worker;
    },
  } });
  owner.drawCountryLabels(1);
  callbacks.shift()();
  assert.equal(messages.length, 1);
  assert.equal(owner.getDiagnostics().fitBuilds, 0, "posting work does not imply a completed fit");
  workers[0].onmessage({ data: handle(messages.shift()) });
  assert.equal(owner.drawCountryLabels(1), 1);
  assert.equal(owner.getDiagnostics().workerFits, 1);
  assert.equal(owner.getDiagnostics().candidateBuilds, 1);
  state.language = "zh";
  source.countries[0].name = "中国";
  owner.drawCountryLabels(1);
  callbacks.shift()();
  assert.equal(messages[0].polygons, undefined, "worker retains immutable projected country geometry");
  const outdatedFontResult = handle(messages.shift());
  owner.clearTextCache();
  workers[0].onmessage({ data: outdatedFontResult });
  assert.equal(owner.getDiagnostics().workerFits, 1, "font changes reject older glyph metrics");
  owner.drawCountryLabels(1);
  callbacks.shift()();
  const outdatedProjectionResult = handle(messages.shift());
  setProjectionIdentity(2);
  owner.drawCountryLabels(1);
  assert.equal(workers[0].terminated, true);
  workers[0].onmessage({ data: outdatedProjectionResult });
  assert.equal(owner.getDiagnostics().workerFits, 1, "projection changes reject older fitted positions");
});

test("worker and structured clone errors remain observable without synchronous expensive fallback", () => {
  for (const cloneThrows of [false, true]) {
    const callbacks = [];
    let worker;
    const { owner, fitCalls } = createHarness({ helperOptions: {
      onInvalidate() {}, scheduleWork: (callback) => callbacks.push(callback),
      createWorker() {
        worker = { terminate() {}, postMessage() { if (cloneThrows) throw new Error("clone failed"); } };
        return worker;
      },
    } });
    owner.drawCountryLabels(1);
    callbacks.shift()();
    if (!cloneThrows) worker.onerror(new Error("worker failed"));
    owner.drawCountryLabels(1);
    assert.equal(fitCalls.length, 0);
    assert.equal(owner.getDiagnostics().workerErrors, 1);
    assert.equal(owner.getDiagnostics().pendingFits, 0);
    assert.equal(owner.isReadyForCurrentView(), false);
    assert.match(owner.getDiagnostics().lastWorkerError, cloneThrows ? /clone failed/ : /worker failed/);
  }
});

test("unanswered or undecodable layout requests fail and a new scene can recover", () => {
  for (const failure of ["timeout", "messageerror"]) {
    const callbacks = [], workers = [];
    const harness = createHarness({ realLayout: true, helperOptions: {
      onInvalidate() {}, scheduleWork: (callback) => callbacks.push(callback),
      createWorker() {
        const worker = { messages: [], terminate() { this.terminated = true; },
          postMessage(data) { this.messages.push(data); } };
        workers.push(worker);
        return worker;
      },
    } });
    const { owner, source, timers } = harness;
    owner.drawCountryLabels(1);
    callbacks.shift()();
    assert.equal(timers.size, 1);
    if (failure === "timeout") [...timers.values()][0]();
    else workers[0].onmessageerror();
    assert.equal(timers.size, 0);
    assert.equal(owner.getDiagnostics().pendingFits, 0);
    assert.equal(owner.getDiagnostics().workerErrors, 1);
    assert.equal(owner.isReadyForCurrentView(), false);
    owner.drawCountryLabels(1);
    assert.equal(callbacks.length, 0, "failed generation must not retry");
    source.sourceToken = {};
    source.revision++;
    owner.drawCountryLabels(1);
    callbacks.shift()();
    assert.equal(workers.length, 2);
    workers[0].onerror(new Error("late failure"));
    assert.equal(workers[1].terminated, undefined, "old worker cannot fail the new generation");
    const handle = createCountryLabelLayoutWorkerHandler();
    workers[1].onmessage({ data: handle(workers[1].messages[0]) });
    assert.equal(timers.size, 0);
    assert.equal(owner.getDiagnostics().workerErrors, 0);
    assert.equal(owner.isReadyForCurrentView(), true);
  }
});

test("projection replacement clears pending layout timers", () => {
  const callbacks = [];
  const { owner, timers, setProjectionIdentity } = createHarness({ helperOptions: {
    onInvalidate() {}, scheduleWork: (callback) => callbacks.push(callback),
    createWorker: () => ({ postMessage() {}, terminate() {} }),
  } });
  owner.drawCountryLabels(1);
  callbacks.shift()();
  assert.equal(timers.size, 1);
  setProjectionIdentity(2);
  owner.drawCountryLabels(1);
  assert.equal(timers.size, 0);
});

test("a stale idle callback cannot strand preparation after a projection change", () => {
  const callbacks = [];
  const { owner, setProjectionIdentity } = createHarness({ helperOptions: {
    onInvalidate() {}, scheduleWork: (callback) => callbacks.push(callback),
  } });
  owner.drawCountryLabels(1);
  setProjectionIdentity(2);
  owner.drawCountryLabels(1);
  assert.equal(callbacks.length, 2, "new projection schedules its own continuation immediately");
  callbacks.shift()();
  assert.equal(owner.getDiagnostics().fitBuilds, 0);
  callbacks.shift()();
  assert.equal(owner.getDiagnostics().fitBuilds, 1);
  assert.equal(owner.isReadyForCurrentView(), true);
});

test("export waits for country name source and layout workers", async () => {
  let tick = 0, prepared = 0, requested = 0;
  await waitForCountryLabelsForExport({
    prepareSource: async () => { prepared += 1; },
    getSource: () => ({ status: tick ? "ready" : "pending" }),
    getDiagnostics: () => ({ workerErrors: 0, pendingFits: tick < 3 ? 1 : 0 }),
    requestRender: () => { requested += 1; }, isDisabled: () => false,
    wait: async () => { tick += 1; }, now: () => tick,
  });
  assert.equal(tick, 3);
  assert.equal(prepared, 1);
  assert.equal(requested, 1);
});

test("export preserves label failure and timeout guards and disabled bypass", async () => {
  const options = { prepareSource: async () => {}, getSource: () => ({ status: "ready" }),
    getDiagnostics: () => ({ workerErrors: 1, pendingFits: 0 }), requestRender: () => {},
    isDisabled: () => false };
  await assert.rejects(waitForCountryLabelsForExport(options), /failed to prepare/);
  await assert.rejects(waitForCountryLabelsForExport({ ...options,
    getSource: () => ({ status: "error", error: "source failed" }) }), /source failed/);
  let tick = 0;
  await assert.rejects(waitForCountryLabelsForExport({ ...options,
    getDiagnostics: () => ({ workerErrors: 0, pendingFits: 1 }),
    wait: async () => { tick++; }, now: () => tick, timeoutMs: 2 }), /still preparing/);
  await waitForCountryLabelsForExport({ ...options, isDisabled: () => true,
    prepareSource: () => { throw new Error("must not prepare disabled labels"); } });
});
