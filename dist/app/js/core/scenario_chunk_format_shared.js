// Keep this helper as a classic script for both ESM side-effect imports and
// startup worker importScripts. Scenario chunk consumers always receive GeoJSON.
var SCENARIO_FORGE_SCENARIO_CHUNK_FORMAT_SHARED = globalThis.__scenarioForgeScenarioChunkFormatShared || (() => {
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
    return collection;
  }

  return Object.freeze({ decodeScenarioChunkPayload });
})();

globalThis.__scenarioForgeScenarioChunkFormatShared = SCENARIO_FORGE_SCENARIO_CHUNK_FORMAT_SHARED;
