import { normalizeBathymetryFeatureCollection } from "./bathymetry_geometry.js";

export function decodeBathymetryTopology(url, topology, {
  topojson = globalThis.topojson,
  d3 = globalThis.d3,
} = {}) {
  if (topology?.type !== "Topology" || !topology.objects || !Array.isArray(topology.arcs)) {
    throw new Error("Invalid bathymetry topology.");
  }
  if (typeof topojson?.feature !== "function") {
    throw new Error("Bathymetry TopoJSON decoder unavailable.");
  }
  const now = () => globalThis.performance?.now?.() ?? Date.now();
  const decodeStartedAt = now();
  const decodeLayer = (name) => {
    const object = topology.objects[name];
    if (!object) return null;
    const collection = topojson.feature(topology, object);
    if (!Array.isArray(collection?.features)) {
      throw new Error(`Invalid bathymetry ${name} collection.`);
    }
    return collection;
  };
  const bands = decodeLayer("bathymetry_bands");
  const contours = decodeLayer("bathymetry_contours");
  const bandsOverview = decodeLayer("bathymetry_bands_overview");
  const contoursOverview = decodeLayer("bathymetry_contours_overview");
  const decodeMs = now() - decodeStartedAt;
  if (!bands && !contours) {
    throw new Error("Missing bathymetry_bands / bathymetry_contours objects");
  }
  const normalizationDetailStartedAt = now();
  const normalized = bands
    ? normalizeBathymetryFeatureCollection(bands, { geoArea: d3?.geoArea, geoBounds: d3?.geoBounds })
    : { collection: null, diagnostics: { polygonCount: 0, rewoundRingCount: 0, removedDegenerateHoleCount: 0, rejectedPolygonCount: 0, issues: [] } };
  const normalizationDetailMs = now() - normalizationDetailStartedAt;
  const normalizationOverviewStartedAt = now();
  const normalizedOverview = bandsOverview
    ? normalizeBathymetryFeatureCollection(bandsOverview, { geoArea: d3?.geoArea, geoBounds: d3?.geoBounds })
    : { collection: null, diagnostics: { polygonCount: 0, rewoundRingCount: 0, removedDegenerateHoleCount: 0, rejectedPolygonCount: 0, issues: [] } };
  const normalizationOverviewMs = now() - normalizationOverviewStartedAt;
  const metadata = { type: topology.type };
  for (const key of ["bbox", "bathymetry_clip_edges", "bathymetry_expansion"]) {
    if (Object.hasOwn(topology, key)) metadata[key] = topology[key];
  }
  return {
    url,
    topology: metadata,
    bands: normalized.collection,
    contours,
    bandsOverview: normalizedOverview.collection,
    contoursOverview,
    geometryDiagnostics: normalized.diagnostics,
    overviewGeometryDiagnostics: normalizedOverview.diagnostics,
    timings: { decodeMs, normalizationDetailMs, normalizationOverviewMs },
  };
}
