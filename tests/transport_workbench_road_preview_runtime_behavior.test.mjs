import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeRoadSourceFlags,
  getRoadVisibilityReason,
  getRoadStyle,
  getLabelClassGate,
} from "../js/ui/transport_workbench/transport_workbench_road_preview_runtime.js";

// Characterization tests: lock the road preview's pure decision logic before/after
// it is extracted out of transport_workbench_road_preview.js into the runtime layer.
// Values are derived from the original in-file implementation (ROAD_STYLE_PRESETS,
// *_REVEAL_SCALE, METRO_GUARD_BONUS) so any behavior drift during extraction fails here.

const baseConfig = {
  roadClass: ["motorway", "trunk", "primary"],
  excludeLinks: false,
  minProjectedSegmentPx: 6,
  suppressShortPrimarySegments: false,
  denseMetroGuard: "balanced",
  zoomGate: "balanced",
};

const roadFeature = (over = {}) => ({
  id: "r0",
  roadClass: "motorway",
  isLink: false,
  denseMetro: false,
  projectedLength: 100,
  lengthMeters: 50000,
  sourceFlags: [],
  ...over,
});

test("normalizeRoadSourceFlags coerces arrays and pipe strings, rejects the rest", () => {
  assert.deepEqual(normalizeRoadSourceFlags(["a", "", "b"]), ["a", "b"]);
  assert.deepEqual(normalizeRoadSourceFlags("x|y| z "), ["x", "y", "z"]);
  assert.deepEqual(normalizeRoadSourceFlags(null), []);
  assert.deepEqual(normalizeRoadSourceFlags(123), []);
});

test("getRoadVisibilityReason returns null for a fully visible motorway", () => {
  assert.equal(getRoadVisibilityReason(roadFeature(), baseConfig, 2), null);
});

test("getRoadVisibilityReason reports each hidden reason in priority order", () => {
  assert.equal(
    getRoadVisibilityReason(roadFeature({ roadClass: "service" }), baseConfig, 2),
    "class_filtered",
  );
  assert.equal(
    getRoadVisibilityReason(roadFeature({ isLink: true }), { ...baseConfig, excludeLinks: true }, 2),
    "link_filtered",
  );
  assert.equal(
    getRoadVisibilityReason(roadFeature({ projectedLength: 2 }), baseConfig, 2),
    "short_projected_segment",
  );
  assert.equal(
    getRoadVisibilityReason(
      roadFeature({ roadClass: "primary", lengthMeters: 1000 }),
      { ...baseConfig, suppressShortPrimarySegments: true },
      2,
    ),
    "short_primary",
  );
  assert.equal(
    getRoadVisibilityReason(
      roadFeature({ roadClass: "primary", denseMetro: true, projectedLength: 8 }),
      baseConfig,
      2,
    ),
    "dense_metro_guard",
  );
  assert.equal(
    getRoadVisibilityReason(roadFeature({ roadClass: "trunk" }), baseConfig, 0.5),
    "zoom_gate",
  );
  assert.equal(
    getRoadVisibilityReason(roadFeature({ roadClass: "primary" }), baseConfig, 1.0),
    "zoom_gate",
  );
});

test("getRoadStyle resolves preset stroke/width/opacity and selection emphasis", () => {
  assert.deepEqual(
    getRoadStyle(roadFeature({ roadClass: "motorway" }), { strokePreset: "corridor", baseOpacity: 88 }, null),
    { stroke: "#cf5d35", width: 2.8, opacity: 0.88 },
  );
  assert.equal(
    getRoadStyle(roadFeature({ id: "r1", roadClass: "motorway" }), { strokePreset: "corridor", baseOpacity: 88 }, "r1").width,
    3.9,
  );
  assert.equal(
    getRoadStyle(
      roadFeature({ roadClass: "motorway", sourceFlags: ["name_conflict"] }),
      { strokePreset: "corridor", baseOpacity: 88, showSourceConflicts: true },
      null,
    ).stroke,
    "#a22f2a",
  );
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
