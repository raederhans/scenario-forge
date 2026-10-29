// Keep this helper as a classic script for both ESM side-effect imports and
// startup worker importScripts. Scenario chunk consumers always receive GeoJSON.
var SCENARIO_FORGE_SCENARIO_CHUNK_FORMAT_SHARED = globalThis.__scenarioForgeScenarioChunkFormatShared || (() => {
  function orientPoliticalFeatureCollection(collection, geoArea) {
    function orientRing(ring, outerRing) {
      if (!Array.isArray(ring) || ring.length < 4) return ring;
      const first = ring[0];
      const last = ring[ring.length - 1];
      const closedRing = Array.isArray(first) && Array.isArray(last)
        && first.length >= 2 && last.length >= 2
        && Number(first[0]) === Number(last[0])
        && Number(first[1]) === Number(last[1])
        ? ring
        : [...ring, first];
      const area = Number(geoArea({ type: "Polygon", coordinates: [closedRing] }));
      if (!Number.isFinite(area)) return null;
      const hasDesiredWinding = outerRing ? area <= Math.PI * 2 : area > Math.PI * 2;
      return hasDesiredWinding ? closedRing : [...closedRing].reverse();
    }

    // topojson.feature returns a single Feature for a bare geometry object.
    const features = Array.isArray(collection?.features) ? collection.features
      : collection?.type === "Feature" ? [collection] : [];
    for (const feature of features) {
      try {
        // Same rule as the renderer's normalizeFeatureGeometry: keep geometry
        // whose area already fits a hemisphere, and keep a rewind only when it
        // shrinks the area. Rewinding every ring unconditionally turns a sliver
        // "hole" larger than its shell into a whole-sphere fill over the ocean.
        const sourceArea = Number(geoArea(feature));
        if (!Number.isFinite(sourceArea)) continue;
        if (sourceArea <= Math.PI * 2) {
          feature.sphericalArea = sourceArea;
          continue;
        }
        let geometry = feature.geometry;
        if (geometry?.type === "Polygon") {
          const coordinates = geometry.coordinates.map((ring, index) => orientRing(ring, index === 0));
          if (coordinates.some((ring) => ring === null)) continue;
          geometry = { ...geometry, coordinates };
        } else if (geometry?.type === "MultiPolygon") {
          const coordinates = geometry.coordinates.map((polygon) => Array.isArray(polygon)
            ? polygon.map((ring, index) => orientRing(ring, index === 0))
            : polygon);
          if (coordinates.some((polygon) => Array.isArray(polygon)
            && polygon.some((ring) => ring === null))) continue;
          geometry = { ...geometry, coordinates };
        }
        const area = Number(geoArea({ ...feature, geometry }));
        if (!Number.isFinite(area)) continue;
        if (area < sourceArea) {
          feature.geometry = geometry;
          feature.sphericalArea = area;
        } else {
          feature.sphericalArea = sourceArea;
        }
      } catch (_error) {
        continue;
      }
    }
    return collection;
  }

  function decodeScenarioChunkPayload(payload, topojsonClient = globalThis.topojson) {
    if (payload?.type !== "Topology") return payload;
    const political = payload.objects?.political;
    if (political?.type !== "GeometryCollection" || !Array.isArray(political.geometries) || !Array.isArray(payload.arcs)) {
      throw new Error("[scenario_chunk] Topology requires an objects.political GeometryCollection and arcs.");
    }
    if (typeof topojsonClient?.feature !== "function") {
      throw new Error("[scenario_chunk] TopoJSON feature decoder is not available.");
    }
    const collection = topojsonClient.feature(payload, political);
    if (collection?.type !== "FeatureCollection" || !Array.isArray(collection.features) || collection.features.length !== political.geometries.length) {
      throw new Error("[scenario_chunk] Topology decoder did not return the political FeatureCollection.");
    }
    return typeof globalThis.d3?.geoArea === "function"
      ? orientPoliticalFeatureCollection(collection, globalThis.d3.geoArea)
      : collection;
  }

  return Object.freeze({ decodeScenarioChunkPayload, orientPoliticalFeatureCollection });
})();

globalThis.__scenarioForgeScenarioChunkFormatShared = SCENARIO_FORGE_SCENARIO_CHUNK_FORMAT_SHARED;
