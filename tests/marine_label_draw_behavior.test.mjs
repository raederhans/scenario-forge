import assert from "node:assert/strict";
import test from "node:test";
import { createMarineLabelOwner } from "../js/core/renderer/marine_label_owner.js";
import { markProjectionGeometryChanged } from "../js/core/renderer/projection_geometry_identity.js";
import { claimScreenLabelPlacement } from "../js/core/renderer/screen_label_placement.js";

function feature(id, waterType = "sea", group = "marine_macro", x = 100, y = 100) {
  return {
    properties: { id, water_type: waterType, region_group: group, label: id },
    parts: [{ centroid: [x, y], bounds: { minX: x - 30, minY: y - 30, maxX: x + 30, maxY: y + 30 } }],
  };
}

function harness(features) {
  const events = [], metrics = [], calls = { centroid: 0, contains: 0 };
  const state = {
    showWaterRegions: true,
    waterRegionsById: new Map(features.map(item => [item.properties.id, item])),
    zoomTransform: { k: 1, x: 0, y: 0 }, width: 400, height: 300, currentLanguage: "en",
  };
  const context = {
    save() { events.push(["save"]); },
    restore() { events.push(["restore"]); },
    measureText() { return { width: 20 }; },
    strokeText(text, x, y) { events.push(["stroke", text, x, y]); },
    fillText(text, x, y) { events.push(["fill", text, x, y, this.font, this.fillStyle]); },
  };
  const h = {
    state, events, metrics, calls, context,
    projection: { invert: point => point },
    path: { centroid(part) { calls.centroid++; return part.centroid; } },
    paintBounds: null, openOceanRenderable: false,
    d3: { zoomIdentity: { k: 1, x: 0, y: 0 }, geoContains() { calls.contains++; return true; } },
    painted: () => events.filter(event => event[0] === "fill"),
  };
  let time = 0;
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
    nowMs: () => time++,
    recordRenderPerfMetric(name, duration, details) {
      events.push(["metric", name]);
      metrics.push({ name, duration, ...details });
    },
  });
  h.draw = (occupiedBoxes = []) => h.owner.drawOrdinaryMarineLabels(state.zoomTransform?.k || 1, occupiedBoxes);
  return h;
}

test("projection generation changes reset centroid and interior caches together", () => {
  const sea = feature("marine_sea");
  const h = harness([sea]);
  h.draw();
  h.draw();
  assert.deepEqual(h.calls, { centroid: 1, contains: 1 });
  assert.equal(h.painted().length, 2);
  markProjectionGeometryChanged(h.projection);
  h.draw();
  assert.deepEqual(h.calls, { centroid: 2, contains: 2 });
  h.draw();
  assert.deepEqual(h.calls, { centroid: 2, contains: 2 });
  h.projection = { invert: point => point };
  sea.parts[0].centroid = [110, 100];
  h.draw();
  assert.deepEqual(h.calls, { centroid: 3, contains: 3 });
  assert.deepEqual(h.painted().at(-1).slice(1, 4), ["marine_sea", 110, 100]);
});

test("selection bypasses the detail scale threshold and takes collision priority", () => {
  const sea = feature("marine_sea");
  const bay = feature("marine_bay", "bay", "marine_detail");
  const h = harness([sea, bay]);
  h.draw();
  assert.deepEqual(h.painted().map(event => event[1]), ["marine_sea"]);
  assert.equal(h.metrics.at(-1).candidateCount, 1);
  h.events.length = 0;
  h.state.selectedWaterRegionId = "marine_bay";
  h.draw();
  assert.deepEqual(h.painted().map(event => event[1]), ["marine_bay"]);
  assert.equal(h.painted()[0][4], "600 14px system-ui, sans-serif");
  assert.deepEqual(h.metrics.at(-1), {
    name: "drawMarineLabels", duration: 1, candidateCount: 2, drawnCount: 1, selectedVisible: true,
  });
  h.events.length = 0;
  h.draw([{ x: 80, y: 80, w: 40, h: 40 }]);
  assert.equal(h.painted().length, 0);
  assert.equal(h.metrics.at(-1).selectedVisible, false);
});

test("selected regions still obey eligibility, water visibility and renderability", () => {
  const ocean = feature("marine_ocean", "ocean", "ocean_macro");
  const h = harness([ocean]);
  h.state.selectedWaterRegionId = "marine_ocean";
  h.draw();
  assert.equal(h.painted().length, 0);
  h.openOceanRenderable = true;
  h.draw();
  assert.equal(h.painted().length, 1);
  h.events.length = 0;
  ocean.renderable = false;
  h.draw();
  assert.equal(h.painted().length, 0);
  ocean.renderable = true;
  ocean.properties.region_group = "other";
  h.draw();
  assert.equal(h.painted().length, 0);
  h.state.showWaterRegions = false;
  const metricCount = h.metrics.length;
  h.draw();
  assert.equal(h.metrics.length, metricCount);
});

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

test("provided paint bounds control both anchor search and offscreen text placement", () => {
  const h = harness([feature("marine_edge", "sea", "marine_macro", -60, 100)]);
  h.draw();
  assert.equal(h.painted().length, 0);
  h.paintBounds = { minX: -96, minY: -96, maxX: 496, maxY: 396 };
  h.draw();
  assert.deepEqual(h.painted()[0].slice(1, 4), ["marine_edge", -60, 100]);
  h.events.length = 0;
  h.paintBounds = null;
  h.draw();
  assert.equal(h.painted().length, 0);
});

test("largest visible geometry part supplies the anchor and metrics follow painting", () => {
  const sea = feature("marine_sea");
  sea.parts.push({ centroid: [250, 150], bounds: { minX: 200, minY: 100, maxX: 300, maxY: 200 } });
  const h = harness([sea]);
  h.draw();
  assert.deepEqual(h.painted()[0].slice(1, 4), ["marine_sea", 250, 150]);
  assert.deepEqual(h.events.slice(-2), [["restore"], ["metric", "drawMarineLabels"]]);
  assert.deepEqual(h.metrics, [{
    name: "drawMarineLabels", duration: 1, candidateCount: 1, drawnCount: 1, selectedVisible: false,
  }]);
});

test("missing draw prerequisites do not record a completed draw metric", () => {
  for (const change of [
    h => { h.state.waterRegionsById.clear(); },
    h => { h.context = null; },
    h => { h.path = null; },
    h => { h.state.zoomTransform = null; h.d3 = null; },
  ]) {
    const h = harness([feature("marine_sea")]);
    change(h);
    h.draw();
    assert.deepEqual(h.metrics, []);
    assert.deepEqual(h.events, []);
  }
});
