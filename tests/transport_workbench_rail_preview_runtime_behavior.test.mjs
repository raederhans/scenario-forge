import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeRailLineClass,
  normalizeRailImportance,
  getLineVisibilityReason,
  getLineStyle,
  getLineOpacity,
  shouldShowStation,
  shouldShowStationLabel,
  formatLineVisibilityReason,
} from "../js/ui/transport_workbench/transport_workbench_rail_preview_runtime.js";

// Characterization tests: lock the rail preview's pure decision logic before/after
// it is extracted out of transport_workbench_rail_preview.js into the runtime layer.
// Values derive from the original in-file implementation (LINE_CLASS_STYLE,
// IMPORTANCE_ORDER, STATION_IMPORTANCE_STYLE, INACTIVE_STATUS).

const lineConfig = {
  status: ["active", "disused"],
  class: ["high_speed", "trunk", "branch", "service"],
  showBranchAtCurrentZoom: true,
  showServiceLines: true,
  showServiceAtHighZoomOnly: false,
};
const lineFeature = (over = {}) => ({ id: "l0", status: "active", lineClass: "trunk", ...over });

const stationConfig = { showMajorStations: true, showStationLabels: true, importanceThreshold: "broad_major" };
const stationFeature = (over = {}) => ({ id: "s0", importance: "regional_core", ...over });

test("normalizeRailLineClass / normalizeRailImportance fall back to defaults", () => {
  assert.equal(normalizeRailLineClass("HIGH_SPEED"), "high_speed");
  assert.equal(normalizeRailLineClass("nonsense"), "trunk");
  assert.equal(normalizeRailLineClass(""), "trunk");
  assert.equal(normalizeRailImportance("capital_core"), "capital_core");
  assert.equal(normalizeRailImportance("x"), "broad_major");
});

test("getLineVisibilityReason returns null for a visible active trunk line", () => {
  assert.equal(getLineVisibilityReason(lineFeature(), lineConfig, 2), null);
});

test("getLineVisibilityReason reports each hidden reason in priority order", () => {
  assert.equal(
    getLineVisibilityReason(lineFeature({ status: "active" }), { ...lineConfig, status: ["disused"] }, 2),
    "status_filtered",
  );
  assert.equal(
    getLineVisibilityReason(lineFeature({ lineClass: "service" }), { ...lineConfig, class: ["trunk"] }, 2),
    "class_filtered",
  );
  assert.equal(
    getLineVisibilityReason(lineFeature({ lineClass: "branch" }), { ...lineConfig, showBranchAtCurrentZoom: false }, 2),
    "branch_hidden",
  );
  assert.equal(
    getLineVisibilityReason(lineFeature({ lineClass: "branch" }), lineConfig, 1.0),
    "zoom_gate",
  );
  assert.equal(
    getLineVisibilityReason(lineFeature({ lineClass: "service" }), { ...lineConfig, showServiceLines: false }, 2),
    "service_hidden",
  );
  assert.equal(
    getLineVisibilityReason(lineFeature({ status: "disused" }), lineConfig, 1.0),
    "zoom_gate",
  );
});

test("getLineStyle resolves class stroke/width and selection/status hue", () => {
  const style = getLineStyle(lineFeature({ lineClass: "trunk" }), { lineOpacity: 92 }, null);
  assert.equal(style.stroke, "#1f2937");
  assert.equal(style.width, 2.35);
  assert.equal(
    getLineStyle(lineFeature({ id: "l1", lineClass: "trunk" }), { lineOpacity: 92 }, "l1").width,
    3.45,
  );
  assert.equal(
    getLineStyle(lineFeature({ status: "construction" }), { lineOpacity: 92, statusEncoding: "line_style_plus_hue" }, null).stroke,
    "#b45309",
  );
});

test("getLineOpacity fades inactive lines and applies class multiplier", () => {
  const active = getLineOpacity(lineFeature({ lineClass: "trunk", status: "active" }), { lineOpacity: 92 });
  assert.ok(Math.abs(active - 0.8832) < 1e-9);
  const inactive = getLineOpacity(lineFeature({ lineClass: "trunk", status: "disused" }), { lineOpacity: 92, inactiveFadeStrength: 72 });
  assert.ok(inactive < active);
});

test("station visibility gates on toggle, importance threshold and zoom", () => {
  assert.equal(shouldShowStation(stationFeature(), stationConfig, 1.0), true);
  assert.equal(shouldShowStation(stationFeature(), { ...stationConfig, showMajorStations: false }, 1.0), false);
  assert.equal(shouldShowStation(stationFeature(), stationConfig, 0.5), false);
  assert.equal(
    shouldShowStation(stationFeature({ importance: "broad_major" }), { ...stationConfig, importanceThreshold: "capital_core" }, 1.0),
    false,
  );
  assert.equal(shouldShowStationLabel(stationFeature(), stationConfig, 1.3), true);
  assert.equal(shouldShowStationLabel(stationFeature(), stationConfig, 1.1), false);
});

test("formatLineVisibilityReason maps reason codes to copy", () => {
  assert.equal(formatLineVisibilityReason("status_filtered"), "Filtered by status");
  assert.equal(formatLineVisibilityReason("zoom_gate"), "Hidden by zoom gate");
  assert.equal(formatLineVisibilityReason("anything_else"), "Visible");
});
