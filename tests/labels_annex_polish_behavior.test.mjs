import assert from "node:assert/strict";
import test from "node:test";
import { createLabelsRuntime } from "../js/core/map_renderer/labels_runtime.js";
import { claimScreenLabelPlacement } from "../js/core/renderer/screen_label_placement.js";

test("blank feature names claim screen space by descending area and fit inside their land bounds", () => {
  const feature = (name, x, width, height) => ({
    id: name, properties: { name }, x, width, height,
  });
  const features = [
    feature("Small", 52, 30, 20), feature("Large", 50, 50, 30),
    feature("Narrow", 100, 8, 30), feature("Shallow", 120, 40, 4), feature("Separate", 150, 40, 20),
  ];
  const drawn = [];
  const ctx = { save() {}, restore() {}, measureText: () => ({ width: 10 }),
    strokeText() {}, fillText(...args) { drawn.push(args); } };
  let occupied;
  const state = { activeScenarioId: "blank_base", mapSemanticMode: "blank", showBlankFeatureLabels: true,
    zoomTransform: { x: 100, y: 25, k: 2 }, landData: { features }, styleConfig: { countryLabels: { enabled: false } } };
  const runtime = createLabelsRuntime({
    runtimeState: state, rendererSurfaceHost: {
      getContext: () => ctx, getProjection: () => null, getMapSvg: () => null,
      getPathCanvas: () => ({ centroid: f => [f.x, 50], area: f => f.width * f.height }),
    },
    getProjectedFeatureBounds: f => ({ minX: f.x - f.width / 2, maxX: f.x + f.width / 2,
      minY: 50 - f.height / 2, maxY: 50 + f.height / 2 }),
    collectVisibleLandSpatialItems: () => features.map(f => ({ feature: f, id: f.id })),
    nowMs: () => 0, isExportRenderInProgress: () => false, isPrivateSceneActive: () => true,
    getFeatureCollectionFeatureCount: () => 0, recordRenderPerfMetric() {},
    drawPendingTransportLabels: (_, { occupiedBoxes }) => { occupied = occupiedBoxes; },
    drawPhysicalRegionLabels() {},
  });
  runtime.drawLabelsPassContent(2);
  assert.deepEqual(drawn, [["Large", 50, 50], ["Separate", 150, 50]]);
  assert.equal(ctx.font, "5.5px system-ui, sans-serif");
  const claimAt = (x, y) => claimScreenLabelPlacement([{ box: { x, y, w: 1, h: 1 } }], occupied);
  assert.equal(claimAt(209, 130), null);
  assert.ok(claimAt(50, 50));
});
