import test from "node:test";
import assert from "node:assert/strict";
import { getLineVisibilityReason, shouldShowStation } from "../js/ui/transport_workbench/transport_workbench_rail_preview_runtime.js";

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

test("line visibility follows filters and zoom", () => {
  assert.equal(getLineVisibilityReason(lineFeature(), lineConfig, 2), null);
  assert.equal(
    getLineVisibilityReason(lineFeature({ status: "active" }), { ...lineConfig, status: ["disused"] }, 2),
    "status_filtered",
  );
  assert.equal(
    getLineVisibilityReason(lineFeature({ lineClass: "service" }), { ...lineConfig, class: ["trunk"] }, 2),
    "class_filtered",
  );
  assert.equal(
    getLineVisibilityReason(lineFeature({ lineClass: "branch" }), lineConfig, 1.0),
    "zoom_gate",
  );
});

test("station visibility gates on toggle, importance threshold and zoom", () => {
  assert.equal(shouldShowStation(stationFeature(), stationConfig, 1.0), true);
  assert.equal(shouldShowStation(stationFeature(), { ...stationConfig, showMajorStations: false }, 1.0), false);
  assert.equal(shouldShowStation(stationFeature(), stationConfig, 0.5), false);
  assert.equal(
    shouldShowStation(stationFeature({ importance: "broad_major" }), { ...stationConfig, importanceThreshold: "capital_core" }, 1.0),
    false,
  );
});
