import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createLabelsRuntime } from "../js/core/map_renderer/labels_runtime.js";
import { createCountryLabelCoverageOwner } from "../js/core/renderer/country_label_coverage.js";
import { createCountryLabelRenderOwner } from "../js/core/renderer/country_label_render_owner.js";
import { createPaintContourAssembly } from "../js/core/renderer/paint_contour_assembly.js";

const { geoStream } = createRequire(import.meta.url)("../vendor/d3.v7.min.js");

test("country size scales a multiline title's glyph origins and collision boxes around its center", () => {
  const name = "中华人民共和国";
  const geometry = { type: "Polygon", coordinates: [[[50, 50], [150, 50], [150, 130], [50, 130], [50, 50]]] };
  const source = { status: "ready", countries: [{ countryCode: "CHN", name, geometry }] };
  const projection = { stream: sink => sink };
  const style = { sizeScale: 1 };
  const origins = [];
  let origin;
  const ctx = { save() {}, restore() {}, rotate() {}, strokeText() {},
    measureText: () => ({ width: 100 }), translate(x, y) { origin = [x, y]; },
    fillText() { origins.push(origin); } };
  const owner = createCountryLabelRenderOwner({
    state: { currentLanguage: "zh", styleConfig: { countryLabels: style } }, helpers: { geoStream },
    getters: { getContext: () => ctx, getCountryLabelSource: () => source,
      getProjection: () => projection, getViewportSize: () => ({ width: 400, height: 300 }) },
  });
  function draw(sizeScale) {
    style.sizeScale = sizeScale;
    origins.length = 0;
    const boxes = [];
    assert.equal(owner.drawCountryLabels(1, { occupiedBoxes: boxes }), 1);
    const label = owner.getDiagnostics().lastLabels[0];
    assert.equal(label.lineCount, 2);
    assert.equal(origins.length, name.length);
    return { origins: [...origins], boxes, ...label };
  }
  const original = draw(1);
  const { x, y, w, h } = original.bounds;
  const cx = x + w / 2, cy = y + h / 2;
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
  for (const scale of [1.6, 0.6]) {
    const scaled = draw(scale);
    near(scaled.fontSizePx, original.fontSizePx * scale);
    for (const [i, [gx, gy]] of original.origins.entries()) {
      near(scaled.origins[i][0], cx + (gx - cx) * scale);
      near(scaled.origins[i][1], cy + (gy - cy) * scale);
      const before = original.boxes[i], after = scaled.boxes[i];
      near(after.x + after.w / 2, cx + (before.x + before.w / 2 - cx) * scale);
      near(after.y + after.h / 2, cy + (before.y + before.h / 2 - cy) * scale);
    }
  }
});

test("blank world labels prioritize large bounds and limit centroid work to eligible regions", () => {
  const features = Array.from({ length: 1000 }, (_, i) => ({ id: String(i),
    minX: 0, minY: 0, maxX: 50 + i, maxY: i % 2 ? 5 : 20 }));
  Object.assign(features[0], { maxX: 5, maxY: 10000 });
  Object.assign(features[1], { maxX: 10000, maxY: 5 });
  const drawn = [], centroids = [];
  let areaCalls = 0;
  const runtime = createLabelsRuntime({
    runtimeState: { activeScenarioId: "blank_base", mapSemanticMode: "blank", showBlankFeatureLabels: true,
      width: 1200, height: 600, landData: { features }, styleConfig: { countryLabels: { enabled: false } } },
    rendererSurfaceHost: {
      getContext: () => ({ save() {}, restore() {}, measureText: () => ({ width: 12 }),
        strokeText() {}, fillText: label => drawn.push(label) }),
      getProjection: () => null, getMapSvg: () => null,
      getPathCanvas: () => ({ area(f) { areaCalls++; return f.maxX * f.maxY; },
        centroid(f) { centroids.push(f); return [25, 10]; } }),
    },
    getProjectedFeatureBounds: f => f, getFeatureId: f => f.id,
    collectVisibleLandSpatialItems: () => features.map(feature => ({ ...feature, feature })),
    nowMs: () => 0, isExportRenderInProgress: () => false, isPrivateSceneActive: () => true,
    getFeatureCollectionFeatureCount: () => 0,
    recordRenderPerfMetric() {}, drawPendingTransportLabels() {}, drawPhysicalRegionLabels() {},
  });
  runtime.drawLabelsPassContent(1);
  assert.deepEqual(drawn, ["998"]);
  assert.equal(areaCalls, 0);
  assert.ok(centroids.length <= 300, `computed ${centroids.length} centroids`);
  assert.ok(centroids.every(f => f.maxX >= 13.8 && f.maxY >= 12.8));
});

test("changing another country's base color reclassifies untouched painted regions in both directions", () => {
  const state = { activeScenarioId: "history", colorRevision: 0, scenarioCountriesByTag: { AUT: {}, GER: {} },
    sovereignBaseColors: { AUT: "#123456", GER: "#abcdef" }, visualOverrides: { vienna: "#abcdef" } };
  const groupCodeById = new Map([["vienna", "AUT"], ["berlin", "GER"]]);
  const memberIndex = { groupCodeById, memberCountByCode: new Map([["AUT", 1], ["GER", 1]]),
    featureById: new Map([...groupCodeById.keys()].map(id => [id, { id }])) };
  const { resolveBorderIdentity, getBorderPaletteRevision } = createPaintContourAssembly({ runtimeState: state,
    canonicalCountryCode: code => code, getDisplayOwnerCode: (_, id) => groupCodeById.get(id) });
  const coverage = createCountryLabelCoverageOwner({ state, resolveBorderIdentity, getBorderPaletteRevision,
    peekSource: () => ({ status: "ready", memberIndex }) });
  assert.equal(coverage.getSignature(), "AUT");
  for (const [newColor, hidden] of [["#654321", ""], ["#abcdef", "AUT"]]) {
    state.sovereignBaseColors.GER = newColor;
    state.colorRevision++;
    coverage.notifyColorsChanged(["berlin"]);
    assert.equal(coverage.getSignature(), hidden);
    coverage.invalidate();
    assert.equal(coverage.getSignature(), hidden);
  }
});
