import assert from "node:assert/strict";
import test from "node:test";
import { createMarineLabelOwner } from "../js/core/renderer/marine_label_owner.js";
import { claimScreenLabelPlacement } from "../js/core/renderer/screen_label_placement.js";

function feature(id, waterType = "sea", group = "marine_macro", x = 100, y = 100) {
  return {
    properties: { id, water_type: waterType, region_group: group, label: id },
    parts: [{ centroid: [x, y], bounds: { minX: x - 30, minY: y - 30, maxX: x + 30, maxY: y + 30 } }],
  };
}

function harness(features) {
  const events = [];
  const state = {
    showWaterRegions: true,
    waterRegionsById: new Map(features.map(item => [item.properties.id, item])),
    zoomTransform: { k: 1, x: 0, y: 0 }, width: 400, height: 300, currentLanguage: "en",
  };
  const context = {
    save() {}, restore() {},
    measureText() { return { width: 20 }; },
    strokeText() {},
    fillText(text, x, y) { events.push(["fill", text, x, y, this.font, this.fillStyle]); },
  };
  const h = {
    state, events, context,
    projection: { invert: point => point },
    path: { centroid: part => part.centroid },
    paintBounds: null, openOceanRenderable: false,
    d3: { zoomIdentity: { k: 1, x: 0, y: 0 }, geoContains: () => true },
    painted: () => events.filter(event => event[0] === "fill"),
  };
  h.owner = createMarineLabelOwner({
    state,
    getContext: () => h.context,
    getPathCanvas: () => h.path,
    getProjection: () => h.projection,
    getD3: () => h.d3,
    isOpenOceanRenderable: () => h.openOceanRenderable,
    isWaterRegionRenderable: item => item.renderable !== false,
    getProjectedFeatureBounds: item => item.parts[0].bounds,
    projectedGeoBoundsInScreen: bounds => bounds != null,
    collectSafeWaterRegionGeometryParts: item => item.parts,
    getScenarioWaterPartBounds: part => part.bounds,
    getLabelPaintBounds: () => h.paintBounds,
    getGeoFeatureDisplayLabel: item => item.properties.label,
    nowMs: () => 0,
    recordRenderPerfMetric() {},
  });
  h.draw = (occupiedBoxes = []) => h.owner.drawOrdinaryMarineLabels(state.zoomTransform?.k || 1, occupiedBoxes);
  return h;
}

test("marine placement uses the caller's occupancy array and blocks later labels", () => {
  const h = harness([feature("marine_sea")]);
  const earlier = { x: 200, y: 200, w: 20, h: 20 };
  const occupiedBoxes = [earlier];
  h.draw(occupiedBoxes);
  assert.equal(occupiedBoxes.length, 2);
  assert.equal(occupiedBoxes[0], earlier);
  assert.equal(claimScreenLabelPlacement([{ box: { x: 95, y: 95, w: 10, h: 10 } }], occupiedBoxes), null);
  assert.ok(claimScreenLabelPlacement([{ box: { x: 300, y: 200, w: 10, h: 10 } }], occupiedBoxes));
  h.events.length = 0;
  h.draw(occupiedBoxes);
  assert.equal(h.painted().length, 0);
  assert.equal(occupiedBoxes.length, 3);
});

test("largest visible geometry part supplies the anchor", () => {
  const sea = feature("marine_sea");
  sea.parts.push({ centroid: [250, 150], bounds: { minX: 200, minY: 100, maxX: 300, maxY: 200 } });
  const h = harness([sea]);
  h.draw();
  assert.deepEqual(h.painted()[0].slice(1, 4), ["marine_sea", 250, 150]);
});
