export function createPoliticalCollectionOwner({
  state,
  constants = {},
  helpers = {},
} = {}) {
  const {
    highFrequencyCountryDetailWhitelist = new Set(),
    interactiveAggregateTierFilters = {},
  } = constants;

  const {
    getDetailTier,
    getFeatureCountryCodeNormalized,
    getFeatureId,
    isPoliticalInteractionRenderableFeature,
    isRenderDiagEnabled = () => false,
  } = helpers;

  const politicalFeatureCollectionCache = new WeakMap();
  let composedPoliticalCollectionCache = {
    primaryRef: null,
    detailRef: null,
    overrideRef: null,
    result: null,
  };
  const rewoundFeatureLogKeys = new Set();

  function parseReplaceFeatureIds(rawValue) {
    if (Array.isArray(rawValue)) {
      return rawValue
        .map((item) => String(item || "").trim())
        .filter(Boolean);
    }

    const text = String(rawValue || "").trim();
    if (!text) return [];
    return text
      .split(/[,\n;|]+/)
      .map((item) => String(item || "").trim())
      .filter(Boolean);
  }

  function getRingOrientationAccumulator(ring) {
    if (!Array.isArray(ring) || ring.length < 4) return 0;
    let total = 0;
    for (let index = 0; index < ring.length - 1; index += 1) {
      const start = ring[index];
      const end = ring[index + 1];
      if (!Array.isArray(start) || !Array.isArray(end)) continue;
      total += (Number(end[0]) - Number(start[0])) * (Number(end[1]) + Number(start[1]));
    }
    return total;
  }

  function orientRingCoordinates(ring, clockwise) {
    if (!Array.isArray(ring) || ring.length < 4) return ring;
    const signed = getRingOrientationAccumulator(ring);
    const isClockwise = signed > 0;
    if (clockwise === isClockwise) return ring;
    return [...ring].reverse();
  }

  function rewindGeometryRings(geometry) {
    if (!geometry || !geometry.type || !geometry.coordinates) return null;
    if (geometry.type === "Polygon") {
      return {
        ...geometry,
        coordinates: geometry.coordinates.map((ring, index) =>
          orientRingCoordinates(ring, index === 0)
        ),
      };
    }
    if (geometry.type === "MultiPolygon") {
      return {
        ...geometry,
        coordinates: geometry.coordinates.map((polygon) =>
          Array.isArray(polygon)
            ? polygon.map((ring, index) => orientRingCoordinates(ring, index === 0))
            : polygon
        ),
      };
    }
    return null;
  }

  function normalizeFeatureGeometry(feature, { sourceLabel = "detail" } = {}) {
    if (!feature?.geometry || !globalThis.d3?.geoArea) {
      return feature;
    }

    let area = null;
    try {
      area = globalThis.d3.geoArea(feature);
    } catch (_error) {
      return feature;
    }
    if (!Number.isFinite(area) || area <= Math.PI * 2) {
      return feature;
    }

    const rewoundGeometry = rewindGeometryRings(feature.geometry);
    if (!rewoundGeometry) return feature;
    const rewoundFeature = {
      ...feature,
      geometry: rewoundGeometry,
    };

    try {
      const rewoundArea = globalThis.d3.geoArea(rewoundFeature);
      if (Number.isFinite(rewoundArea) && rewoundArea < area) {
        const featureId = getFeatureId(feature) || "(unknown)";
        const logKey = `${sourceLabel}::${featureId}`;
        if (isRenderDiagEnabled() && !rewoundFeatureLogKeys.has(logKey)) {
          rewoundFeatureLogKeys.add(logKey);
          console.warn(
            `[map_renderer] Rewound ${sourceLabel} feature orientation for ${featureId}. area=${area.toFixed(5)} -> ${rewoundArea.toFixed(5)}`
          );
        }
        return rewoundFeature;
      }
    } catch (_error) {
      return feature;
    }
    return feature;
  }

  function getPoliticalFeatureCollection(topology, sourceName) {
    if (!topology?.objects?.political || !globalThis.topojson) {
      return { type: "FeatureCollection", features: [] };
    }
    const cachedCollections = politicalFeatureCollectionCache.get(topology);
    if (cachedCollections?.has(sourceName)) {
      return cachedCollections.get(sourceName);
    }
    const seededCollection =
      sourceName === "runtime"
      && topology === state.runtimePoliticalTopology
      && Array.isArray(state.runtimePoliticalFeatureCollectionSeed?.features)
        ? state.runtimePoliticalFeatureCollectionSeed
        : null;
    const collection = seededCollection || globalThis.topojson.feature(topology, topology.objects.political);
    const features = Array.isArray(collection?.features) ? collection.features : [];
    const normalizedCollection = {
      type: "FeatureCollection",
      features: features.map((feature) => {
        const normalizedFeature = normalizeFeatureGeometry(feature, { sourceLabel: sourceName });
        const existingSource = String(normalizedFeature?.properties?.__source || "").trim();
        return {
          ...normalizedFeature,
          properties: {
            ...(normalizedFeature?.properties || {}),
            __source: existingSource || sourceName,
          },
        };
      }),
    };
    const nextCollections = cachedCollections || new Map();
    nextCollections.set(sourceName, normalizedCollection);
    politicalFeatureCollectionCache.set(topology, nextCollections);
    if (seededCollection) {
      state.runtimePoliticalFeatureCollectionSeed = normalizedCollection;
    }
    return normalizedCollection;
  }

  function mergeOverrideFeatures(baseFeatures, overrideCollection) {
    const order = [];
    const featureById = new Map();

    baseFeatures.forEach((feature) => {
      const featureId = getFeatureId(feature);
      if (!featureId || featureById.has(featureId)) return;
      order.push(featureId);
      featureById.set(featureId, feature);
    });

    let applied = 0;
    let replaced = 0;

    const overrides = Array.isArray(overrideCollection?.features)
      ? overrideCollection.features
      : [];
    overrides.forEach((feature) => {
      if (!feature?.geometry) return;
      const normalizedFeature = normalizeFeatureGeometry(feature, { sourceLabel: "ru_override" });
      const featureId = getFeatureId(normalizedFeature);
      if (!featureId) return;

      const replaceIds = parseReplaceFeatureIds(
        normalizedFeature?.properties?.replace_ids ??
        normalizedFeature?.properties?.replaceIds ??
        ""
      );
      replaceIds.forEach((replaceId) => {
        if (featureById.delete(replaceId)) {
          replaced += 1;
        }
      });

      const existing = featureById.has(featureId);
      featureById.set(featureId, {
        ...normalizedFeature,
        properties: {
          ...(normalizedFeature?.properties || {}),
          __source: "ru_override",
        },
      });
      if (!existing) {
        order.push(featureId);
      }
      applied += 1;
    });

    if (applied > 0) {
      console.info(
        `[map_renderer] Applied RU city overrides: injected=${applied}, replaced=${replaced}.`
      );
    }

    return order
      .filter((id) => featureById.has(id))
      .map((id) => featureById.get(id));
  }

  function composePoliticalFeatures(primaryTopology, detailTopology, overrideCollection = null) {
    const cacheMatches =
      composedPoliticalCollectionCache.primaryRef === primaryTopology &&
      composedPoliticalCollectionCache.detailRef === detailTopology &&
      composedPoliticalCollectionCache.overrideRef === overrideCollection;
    if (cacheMatches && composedPoliticalCollectionCache.result) {
      return composedPoliticalCollectionCache.result;
    }
    const primaryCollection = getPoliticalFeatureCollection(primaryTopology, "primary");
    if (!detailTopology) {
      const baseFeatures = primaryCollection.features;
      const features = overrideCollection
        ? mergeOverrideFeatures(baseFeatures, overrideCollection)
        : baseFeatures;
      const result = {
        type: "FeatureCollection",
        features,
      };
      composedPoliticalCollectionCache = {
        primaryRef: primaryTopology,
        detailRef: detailTopology,
        overrideRef: overrideCollection,
        result,
      };
      return result;
    }

    const detailCollection = getPoliticalFeatureCollection(detailTopology, "detail");
    const result = composePoliticalFeatureCollections(primaryCollection, detailCollection, overrideCollection);
    composedPoliticalCollectionCache = {
      primaryRef: primaryTopology,
      detailRef: detailTopology,
      overrideRef: overrideCollection,
      result,
    };
    return result;
  }

  function composePoliticalFeatureCollections(primaryCollection, detailCollection = null, overrideCollection = null) {
    const normalizedPrimaryCollection = Array.isArray(primaryCollection?.features)
      ? primaryCollection
      : { type: "FeatureCollection", features: [] };
    const normalizedDetailCollection = Array.isArray(detailCollection?.features)
      ? {
        type: "FeatureCollection",
        features: detailCollection.features.map((feature) => {
          const normalizedFeature = normalizeFeatureGeometry(feature, { sourceLabel: "detail" });
          return {
            ...normalizedFeature,
            properties: {
              ...(normalizedFeature?.properties || {}),
              __source: "detail",
            },
          };
        }),
      }
      : null;
    if (!normalizedDetailCollection) {
      const baseFeatures = normalizedPrimaryCollection.features;
      const features = overrideCollection
        ? mergeOverrideFeatures(baseFeatures, overrideCollection)
        : baseFeatures;
      return {
        type: "FeatureCollection",
        features,
      };
    }
    const detailCountries = new Set();
    const detailFeatureIdsByCountry = new Map();
    normalizedDetailCollection.features.forEach((feature) => {
      const code = getFeatureCountryCodeNormalized(feature);
      if (code) detailCountries.add(code);
      const featureId = getFeatureId(feature);
      if (!code || !featureId) return;
      let ids = detailFeatureIdsByCountry.get(code);
      if (!ids) {
        ids = new Set();
        detailFeatureIdsByCountry.set(code, ids);
      }
      ids.add(featureId);
    });

    const seen = new Set();
    const features = [];

    const pushIfUnique = (feature) => {
      const id = getFeatureId(feature);
      if (!id) return;
      if (seen.has(id)) return;
      seen.add(id);
      features.push(feature);
    };

    normalizedDetailCollection.features.forEach(pushIfUnique);
    normalizedPrimaryCollection.features.forEach((feature) => {
      const code = getFeatureCountryCodeNormalized(feature);
      if (code && detailCountries.has(code)) {
        const featureId = getFeatureId(feature);
        const detailFeatureIds = detailFeatureIdsByCountry.get(code);
        const countryPriority = highFrequencyCountryDetailWhitelist.has(code);
        if (countryPriority && featureId && !(detailFeatureIds?.has(featureId))) {
          const promotedFeature = {
            ...feature,
            properties: {
              ...(feature?.properties || {}),
              __source: "primary",
              __coveragePromoted: true,
            },
          };
          pushIfUnique(promotedFeature);
        }
        return;
      }
      pushIfUnique(feature);
    });

    const mergedFeatures = overrideCollection
      ? mergeOverrideFeatures(features, overrideCollection)
      : features;

    return {
      type: "FeatureCollection",
      features: mergedFeatures,
    };
  }

  function collectCountryCoverageStats(features = []) {
    const detailCountries = new Set();
    const primaryCountries = new Set();
    let detailFeatureCount = 0;
    let primaryFeatureCount = 0;
    const countryCoverage = new Map();

    features.forEach((feature) => {
      const countryCode = getFeatureCountryCodeNormalized(feature);
      if (!countryCode) return;
      const source = String(feature?.properties?.__source || "primary");
      let countryEntry = countryCoverage.get(countryCode);
      if (!countryEntry) {
        countryEntry = {
          countryCode,
          totalFeatures: 0,
          detailFeatures: 0,
          primaryFeatures: 0,
          promotedPrimaryFeatures: 0,
          detailOnly: false,
          priorityCountry: highFrequencyCountryDetailWhitelist.has(countryCode),
        };
        countryCoverage.set(countryCode, countryEntry);
      }
      countryEntry.totalFeatures += 1;
      if (source === "detail") {
        detailCountries.add(countryCode);
        detailFeatureCount += 1;
        countryEntry.detailFeatures += 1;
      } else {
        primaryCountries.add(countryCode);
        primaryFeatureCount += 1;
        countryEntry.primaryFeatures += 1;
        if (feature?.properties?.__coveragePromoted) {
          countryEntry.promotedPrimaryFeatures += 1;
        }
      }
    });

    const detailCountryList = [];
    const primaryCountryList = [];
    const priorityCountryGaps = [];
    Array.from(countryCoverage.values())
      .sort((a, b) => a.countryCode.localeCompare(b.countryCode))
      .forEach((entry) => {
        entry.detailOnly = entry.detailFeatures > 0 && entry.primaryFeatures === 0;
        if (entry.detailFeatures > 0) {
          detailCountryList.push(entry);
        }
        if (entry.primaryFeatures > 0) {
          primaryCountryList.push(entry);
        }
        if (entry.priorityCountry && entry.primaryFeatures > 0) {
          priorityCountryGaps.push({
            countryCode: entry.countryCode,
            primaryFeatures: entry.primaryFeatures,
            promotedPrimaryFeatures: entry.promotedPrimaryFeatures,
            detailFeatures: entry.detailFeatures,
          });
        }
      });

    const totalCountries = new Set([...detailCountries, ...primaryCountries]).size;
    return {
      totalCountries,
      detailCountries: detailCountries.size,
      primaryCountries: primaryCountries.size,
      totalFeatures: features.length,
      detailFeatures: detailFeatureCount,
      primaryFeatures: primaryFeatureCount,
      detailCountryList,
      primaryCountryList,
      priorityCountryGaps,
    };
  }

  function buildInteractiveLandData(fullCollection) {
    if (!Array.isArray(fullCollection?.features) || !fullCollection.features.length) {
      return fullCollection;
    }

    const explicitFeatures = fullCollection.features.filter((feature) =>
      isPoliticalInteractionRenderableFeature(feature, getFeatureId(feature))
    );
    const explicitCollection = explicitFeatures.length === fullCollection.features.length
      ? fullCollection
      : {
        type: "FeatureCollection",
        features: explicitFeatures,
      };
    if (!Array.isArray(explicitCollection?.features) || !explicitCollection.features.length) {
      return explicitCollection;
    }

    const filterStateByCountry = new Map();
    explicitCollection.features.forEach((feature) => {
      const countryCode = getFeatureCountryCodeNormalized(feature);
      const blockedTiers = interactiveAggregateTierFilters[countryCode];
      if (!countryCode || !blockedTiers?.size) return;

      const tier = getDetailTier(feature).toLowerCase();
      let entry = filterStateByCountry.get(countryCode);
      if (!entry) {
        entry = {
          blockedTiers,
          hasLeaf: false,
          hasBlocked: false,
        };
        filterStateByCountry.set(countryCode, entry);
      }

      if (blockedTiers.has(tier)) {
        entry.hasBlocked = true;
        return;
      }

      if (String(feature?.properties?.__source || "primary") === "detail") {
        entry.hasLeaf = true;
      }
    });

    const activeFilters = new Map(
      Array.from(filterStateByCountry.entries()).filter(([, entry]) => entry.hasLeaf && entry.hasBlocked)
    );
    if (!activeFilters.size) {
      return explicitCollection;
    }

    const filteredFeatures = explicitCollection.features.filter((feature) => {
      const countryCode = getFeatureCountryCodeNormalized(feature);
      const entry = activeFilters.get(countryCode);
      if (!entry) return true;
      return !entry.blockedTiers.has(getDetailTier(feature).toLowerCase());
    });

    if (filteredFeatures.length === explicitCollection.features.length) {
      return explicitCollection;
    }

    return {
      type: "FeatureCollection",
      features: filteredFeatures,
    };
  }

  return {
    buildInteractiveLandData,
    collectCountryCoverageStats,
    composePoliticalFeatureCollections,
    composePoliticalFeatures,
    getPoliticalFeatureCollection,
    mergeOverrideFeatures,
    normalizeFeatureGeometry,
  };
}
