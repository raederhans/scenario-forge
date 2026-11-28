import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRoadSourceFlags, getLabelClassGate } from "../js/ui/transport_workbench/transport_workbench_road_preview_runtime.js";

test("normalizeRoadSourceFlags coerces arrays and pipe strings, rejects the rest", () => {
  assert.deepEqual(normalizeRoadSourceFlags(["a", "", "b"]), ["a", "b"]);
  assert.deepEqual(normalizeRoadSourceFlags("x|y| z "), ["x", "y", "z"]);
  assert.deepEqual(normalizeRoadSourceFlags(null), []);
  assert.deepEqual(normalizeRoadSourceFlags(123), []);
});

test("getLabelClassGate gates labels by refs, class, length and zoom", () => {
  const labelConfig = {
    showRefs: true,
    refClasses: ["motorway", "trunk"],
    allowPrimaryRefsAtHighZoom: false,
    zoomGate: "balanced",
  };
  const labelFeature = (over = {}) => ({ roadClass: "motorway", ref: "E1", projectedRoadLength: 100, ...over });

  assert.equal(getLabelClassGate(labelFeature(), labelConfig, 2), true);
  assert.equal(getLabelClassGate(labelFeature(), { ...labelConfig, showRefs: false }, 2), false);
  assert.equal(getLabelClassGate(labelFeature({ projectedRoadLength: 10 }), labelConfig, 2), false);
});
