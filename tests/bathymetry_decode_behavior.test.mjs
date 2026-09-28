import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

import { decodeBathymetryTopology } from "../js/core/renderer/bathymetry_decode.js";

const vendor = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL("../vendor/d3.v7.min.js", import.meta.url), "utf8"), vendor);
const d3 = vendor.d3;
const polygon = (coordinates) => ({ type: "Feature", geometry: { type: "Polygon", coordinates: [coordinates] }, properties: {} });
const square = [[10, 10], [12, 10], [12, 12], [10, 12], [10, 10]];

test("decode keeps only needed topology metadata and normalizes detail and overview independently", () => {
  const layers = {
    detail: { type: "FeatureCollection", features: [polygon(square)] },
    overview: { type: "FeatureCollection", features: [polygon([[0, 0], [1, 0], [1, 1]])] },
    contour: { type: "FeatureCollection", features: [] },
  };
  const topology = {
    type: "Topology",
    bbox: [0, 0, 20, 20],
    arcs: [[99, 88]],
    objects: {
      bathymetry_bands: "detail",
      bathymetry_contours: "contour",
      bathymetry_bands_overview: "overview",
      bathymetry_contours_overview: "contour",
    },
    bathymetry_clip_edges: { type: "MultiLineString", coordinates: [] },
    bathymetry_expansion: { mode: "regional" },
  };
  const decoded = decodeBathymetryTopology("/bathymetry.json", topology, {
    d3,
    topojson: { feature: (_topology, object) => layers[object] },
  });
  assert.equal(decoded.url, "/bathymetry.json");
  assert.deepEqual(Object.keys(decoded.topology), ["type", "bbox", "bathymetry_clip_edges", "bathymetry_expansion"]);
  assert.equal(decoded.bands.features.length, 1);
  assert.equal(decoded.bandsOverview.features.length, 0);
  assert.equal(decoded.geometryDiagnostics.rejectedPolygonCount, 0);
  assert.equal(decoded.overviewGeometryDiagnostics.rejectedPolygonCount, 1);
  assert.ok(decoded.timings.normalizationDetailMs >= 0);
  assert.ok(decoded.timings.normalizationOverviewMs >= 0);
  assert.equal(topology.arcs.length, 1);
});

test("decode rejects malformed topology and missing depth objects", () => {
  assert.throws(() => decodeBathymetryTopology("/a", {}), /Invalid bathymetry topology/);
  assert.throws(() => decodeBathymetryTopology("/a", { type: "Topology", arcs: [], objects: {} }, {
    d3,
    topojson: { feature() {} },
  }), /Missing bathymetry_bands/);
});
