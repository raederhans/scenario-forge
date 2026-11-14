import { resolveDataUrl } from "../data_base_url.js";
import { resolveDataAssetUrl } from "../runtime_asset_registry.js";
import {
  getTransportOverviewDataLayerKeys,
  listTransportOverviewCapabilityFamilyIds,
} from "../transport_capability_registry.js";

const GLOBAL_RIVERS_CONTEXT_PACK_URL = resolveDataAssetUrl("context_layer:rivers");
const GLOBAL_RAIL_CATALOG_URL = resolveDataAssetUrl("transport_catalog:rail");
const GLOBAL_ROAD_CATALOG_URL = resolveDataAssetUrl("transport_catalog:road");
let globalRoadContextCollectionsPromise = null;
const globalRailContextCollectionPromises = {};
const globalRailContextMetadataPromises = new Map();
let activeRailContextLoads = 0;

function loadRailContextMetadata(d3Client, url) {
  // Share small catalog/manifest parses across overlapping layer loads. Release
  // them when the batch settles; geometry never enters this temporary cache.
  let promise = globalRailContextMetadataPromises.get(url);
  if (!promise) {
    promise = Promise.resolve().then(() => d3Client.json(resolveDataUrl(url))).catch((error) => {
      // Another layer may still be loading. Let a retry refresh failed metadata
      // immediately without waiting for that unrelated request to settle.
      if (globalRailContextMetadataPromises.get(url) === promise) {
        globalRailContextMetadataPromises.delete(url);
      }
      throw error;
    });
    globalRailContextMetadataPromises.set(url, promise);
  }
  return promise;
}
const CONTEXT_LAYER_PACKS = {
  lakes: { url: resolveDataAssetUrl("context_layer:lakes"), format: "geojson" },
  airports: { url: resolveDataAssetUrl("context_layer:airports"), format: "geojson" },
  ports: { url: resolveDataAssetUrl("context_layer:ports"), format: "geojson" },
  physical: { url: resolveDataAssetUrl("context_layer:physical"), format: "geojson" },
  urban: { url: resolveDataAssetUrl("context_layer:urban"), format: "geojson" },
  // Synthetic urban patches on TNO Atlantropa land; appended to urban only for tno_1962.
  urban_tno_atlantropa: { url: resolveDataAssetUrl("context_layer:urban_tno_atlantropa"), format: "geojson" },
  physical_semantics: {
    url: resolveDataAssetUrl("context_layer:physical_semantics"),
    format: "topology",
    objectName: "physical_semantics",
  },
  physical_semantics_detail: {
    url: resolveDataAssetUrl("context_layer:physical_semantics_detail"),
    format: "topology",
    objectName: "physical_semantics",
  },
  physical_hillshade: {
    url: resolveDataAssetUrl("context_layer:physical_hillshade"),
    format: "topology",
    objectName: "physical_hillshade",
  },
  physical_region_labels: {
    url: resolveDataAssetUrl("context_layer:physical_region_labels"),
    format: "geojson",
  },
  physical_contours_major: {
    url: resolveDataAssetUrl("context_layer:physical_contours_major"),
    format: "topology",
    objectName: "contours",
  },
  physical_contours_minor: {
    url: resolveDataAssetUrl("context_layer:physical_contours_minor"),
    format: "topology",
    objectName: "contours",
  },
  physical_contours_low_major: {
    url: resolveDataAssetUrl("context_layer:physical_contours_low_major"),
    format: "topology",
    objectName: "contours",
  },
  physical_contours_mid_major: {
    url: resolveDataAssetUrl("context_layer:physical_contours_mid_major"),
    format: "topology",
    objectName: "contours",
  },
  physical_contours_mid_minor: {
    url: resolveDataAssetUrl("context_layer:physical_contours_mid_minor"),
    format: "topology",
    objectName: "contours",
  },
};
const EXPLICIT_CONTEXT_CATALOG_LAYER_NAMES = new Set(
  listTransportOverviewCapabilityFamilyIds()
    .flatMap((familyId) => getTransportOverviewDataLayerKeys(familyId))
    .filter((layerName) => layerName && !Object.prototype.hasOwnProperty.call(CONTEXT_LAYER_PACKS, layerName))
);

async function loadRiversFallbackCollection(d3Client) {
  try {
    const payload = await d3Client.json(resolveDataUrl(GLOBAL_RIVERS_CONTEXT_PACK_URL));
    if (!Array.isArray(payload?.features)) {
      console.warn(
        `[data_loader] Rivers fallback pack invalid at ${GLOBAL_RIVERS_CONTEXT_PACK_URL}.`
      );
      return null;
    }
    return {
      type: "FeatureCollection",
      features: payload.features,
    };
  } catch (err) {
    console.warn(
      `[data_loader] Rivers fallback pack missing or invalid at ${GLOBAL_RIVERS_CONTEXT_PACK_URL}.`,
      err
    );
    return null;
  }
}

function normalizeRequestedContextLayerNames(includeContextLayers) {
  if (includeContextLayers === true) {
    return ["rivers", ...Object.keys(CONTEXT_LAYER_PACKS)];
  }
  if (includeContextLayers === false || includeContextLayers == null) {
    return [];
  }
  const requestedNames = Array.isArray(includeContextLayers)
    ? includeContextLayers
    : [includeContextLayers];
  return Array.from(
    new Set(
      requestedNames
        .map((name) => String(name || "").trim().toLowerCase())
        .filter((name) => (
          name === "rivers"
          || Object.prototype.hasOwnProperty.call(CONTEXT_LAYER_PACKS, name)
          || EXPLICIT_CONTEXT_CATALOG_LAYER_NAMES.has(name)
        ))
    )
  );
}

async function loadContextLayerPackInternal(layerName, d3Client) {
  if (layerName === "rivers") {
    return loadRiversFallbackCollection(d3Client);
  }
  if (layerName === "roads") {
    if (!globalThis.topojson || typeof globalThis.topojson.feature !== "function") {
      console.warn("[data_loader] topojson-client unavailable. Ignoring roads deferred load.");
      return null;
    }
    globalRoadContextCollectionsPromise ||= (async () => {
      const catalog = await d3Client.json(resolveDataUrl(GLOBAL_ROAD_CATALOG_URL));
      const entries = Array.isArray(catalog?.entries) ? catalog.entries : [];
      const roadFeatures = [];
      for (const entry of entries) {
        if (Number(entry?.feature_counts?.preview?.roads || 0) <= 0) continue;
        const manifestPath = String(entry?.manifest_path || "").trim();
        if (!manifestPath) continue;
        const manifest = await d3Client.json(resolveDataUrl(manifestPath));
        const roadsPath = String(manifest?.paths?.preview?.roads || "").trim();
        if (!roadsPath) continue;
        const topology = await d3Client.json(resolveDataUrl(roadsPath));
        const roadsObject = topology?.objects?.roads;
        const roadsCollection = roadsObject ? globalThis.topojson.feature(topology, roadsObject) : null;
        if (Array.isArray(roadsCollection?.features) && roadsCollection.features.length) {
          roadFeatures.push(...roadsCollection.features);
        }
      }
      return {
        roads: { type: "FeatureCollection", features: roadFeatures },
      };
    })().catch((error) => {
      globalRoadContextCollectionsPromise = null;
      throw error;
    });
    try {
      const collections = await globalRoadContextCollectionsPromise;
      return collections?.roads || null;
    } catch (err) {
      console.warn("[data_loader] Global road catalog or shard payload missing/invalid. Ignoring road runtime pack.", err);
      return null;
    }
  }
  if (layerName === "railways" || layerName === "rail_stations_major") {
    if (layerName === "railways" && (!globalThis.topojson || typeof globalThis.topojson.feature !== "function")) {
      console.warn("[data_loader] topojson-client unavailable. Ignoring railways deferred load.");
      return null;
    }
    globalRailContextCollectionPromises[layerName] ||= (async () => {
      activeRailContextLoads += 1;
      try {
        const catalog = await loadRailContextMetadata(d3Client, GLOBAL_RAIL_CATALOG_URL);
        const entries = Array.isArray(catalog?.entries) ? catalog.entries : [];
        const railFeatures = [];
        const stationFeatures = [];
        for (const entry of entries) {
          const manifestPath = String(entry?.manifest_path || "").trim();
          if (!manifestPath) continue;
          const manifest = await loadRailContextMetadata(d3Client, manifestPath);
          const railwaysPath = String(manifest?.paths?.preview?.railways || "").trim();
          if (layerName === "railways" && railwaysPath && Number(entry?.feature_counts?.preview?.railways || 0) > 0) {
            const topology = await d3Client.json(resolveDataUrl(railwaysPath));
            const railwaysObject = topology?.objects?.railways;
            const railwaysCollection = railwaysObject ? globalThis.topojson.feature(topology, railwaysObject) : null;
            if (Array.isArray(railwaysCollection?.features) && railwaysCollection.features.length) {
              railFeatures.push(...railwaysCollection.features);
            }
          }
          const stationsPath = String(manifest?.paths?.preview?.rail_stations_major || "").trim();
          if (layerName === "rail_stations_major" && stationsPath) {
            const stationsCollection = await d3Client.json(resolveDataUrl(stationsPath));
            if (Array.isArray(stationsCollection?.features) && stationsCollection.features.length) {
              stationFeatures.push(...stationsCollection.features);
            }
          }
        }
        return layerName === "railways"
          ? { type: "FeatureCollection", features: railFeatures }
          : { type: "FeatureCollection", features: stationFeatures };
      } finally {
        activeRailContextLoads -= 1;
        if (!activeRailContextLoads) globalRailContextMetadataPromises.clear();
      }
    })().catch((error) => {
      delete globalRailContextCollectionPromises[layerName];
      throw error;
    });
    try {
      return await globalRailContextCollectionPromises[layerName];
    } catch (err) {
      console.warn("[data_loader] Global rail catalog or shard payload missing/invalid. Ignoring rail runtime pack.", err);
      return null;
    }
  }
  const descriptor = CONTEXT_LAYER_PACKS[layerName];
  if (!descriptor) {
    return null;
  }
  const { url, format = "geojson", objectName = "" } = descriptor;
  try {
    const payload = await d3Client.json(resolveDataUrl(url));
    if (format === "topology") {
      const object = payload?.objects?.[objectName];
      const collection = object && globalThis.topojson
        ? globalThis.topojson.feature(payload, object)
        : null;
      if (!Array.isArray(collection?.features)) {
        console.warn(`[data_loader] Context topology pack invalid at ${url}. Ignoring ${layerName}.`);
        return null;
      }
      return collection;
    }
    if (!Array.isArray(payload?.features)) {
      console.warn(`[data_loader] Context layer pack invalid at ${url}. Ignoring ${layerName}.`);
      return null;
    }
    return {
      type: "FeatureCollection",
      features: payload.features,
    };
  } catch (err) {
    console.warn(`[data_loader] Context layer pack missing or invalid for ${layerName}. Ignoring.`, err);
    return null;
  }
}

async function loadOptionalContextLayerPacks(d3Client, includeContextLayers = true) {
  const requestedNames = normalizeRequestedContextLayerNames(includeContextLayers);
  if (!requestedNames.length) {
    return {};
  }
  const entries = await Promise.all(
    requestedNames.map(async (layerName) => [layerName, await loadContextLayerPackInternal(layerName, d3Client)])
  );
  return Object.fromEntries(entries.filter(([, collection]) => Array.isArray(collection?.features)));
}

export {
  loadContextLayerPackInternal as loadContextLayerPack,
  loadOptionalContextLayerPacks,
  normalizeRequestedContextLayerNames,
};
