import { getActiveRiverPack, getRiverPartitionIndex } from "../river_paint/partition_model.js";
import { isRiverPaintSourceCompatible } from "../river_paint/pilot_manifest.js";
import { inheritContourCoordinatePrecision } from "../paint_contour_source.js";
import { getPoliticalGeometrySnapshot, registerPoliticalGeometrySnapshot } from "../political_geometry_store.js";

export function createPoliticalCollectionOwner({
  state,
  constants = {},
  helpers = {},
} = {}) {
  const {
    highFrequencyCountryDetailWhitelist = new Set(),
    interactiveAggregateTierFilters = {},
    fragmentCamouflageRules = [],
  } = constants;

  const {
    getDetailTier,
    getFeatureCountryCodeNormalized,
    getFeatureId,
    isPoliticalInteractionRenderableFeature,
    isRenderDiagEnabled = () => false,
    recordSphericalArea,
  } = helpers;

  const politicalFeatureCollectionCache = new WeakMap();
  const fragmentCamouflageRuleEntries = normalizeFragmentCamouflageRules(fragmentCamouflageRules);
  let composedPoliticalCollectionCache = {
    primaryRef: null,
    detailRef: null,
    overrideRef: null,
    result: null,
  };
  const rewoundFeatureLogKeys = new Set();

  // Cache normalized geometry per geometry-object identity.
  // Value is the rewound geometry object when rewind improved area, or the
  // sentinel GEOM_UNCHANGED when geoArea confirmed no rewind needed.
  // A thrown / non-finite geoArea result is never stored, so a retry with a
  // corrected globalThis.d3 can still succeed.
  const GEOM_UNCHANGED = Symbol("geom_unchanged");
  const normalizedGeometryByGeometry = new WeakMap();

  // Cache detail feature wrapper per original feature reference.
  // Value is {…feature, properties:{…, __source:"detail"}}.
  // The cached entry is only reused when it still matches the original
  // feature's current properties, so property mutations remain visible.
  const normalizedDetailWrapperByFeature = new WeakMap();
  const indexedDetailWrappers = new WeakMap();

  function matchesSnapshot(value, snapshot) {
    const keys = Object.keys(value || {});
    return keys.length === Object.keys(snapshot).length
      && keys.every((key) => Object.hasOwn(snapshot, key) && Object.is(value[key], snapshot[key]));
  }

  function normalizeFragmentCamouflageRules(rawRules) {
    if (!Array.isArray(rawRules)) return [];
    return rawRules
      .map((rule) => {
        const countryCode = String(rule?.countryCode || "").trim().toUpperCase();
        const featureIds = new Set(
          Array.isArray(rule?.featureIds)
            ? rule.featureIds
              .map((item) => String(item || "").trim())
              .filter(Boolean)
            : []
        );
        const minComponentAreaSteradians = Number(rule?.minComponentAreaSteradians);
        if (!countryCode || !featureIds.size || !Number.isFinite(minComponentAreaSteradians) || minComponentAreaSteradians <= 0) {
          return null;
        }
        return {
          countryCode,
          featureIds,
          minComponentAreaSteradians,
          preserveLargestComponent: rule?.preserveLargestComponent !== false,
        };
      })
      .filter(Boolean);
  }

  function getFragmentCamouflageRule(feature, featureId = null) {
    if (!fragmentCamouflageRuleEntries.length) return null;
    const resolvedFeatureId = String(featureId || getFeatureId(feature) || "").trim();
    if (!resolvedFeatureId) return null;
    const countryCode = getFeatureCountryCodeNormalized(feature);
    return fragmentCamouflageRuleEntries.find((rule) =>
      rule.countryCode === countryCode && rule.featureIds.has(resolvedFeatureId)
    ) || null;
  }

  function getPolygonComponentAreaSteradians(polygonCoordinates) {
    if (!globalThis.d3?.geoArea || !Array.isArray(polygonCoordinates)) {
      return null;
    }
    const normalizedPolygonCoordinates = polygonCoordinates.map((ring, index) =>
      orientRingCoordinates(ring, index === 0)
    );
    try {
      const area = globalThis.d3.geoArea({
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: normalizedPolygonCoordinates,
        },
      });
      return Number.isFinite(area) ? area : null;
    } catch (_error) {
      return null;
    }
  }

  function applyFragmentCamouflageToFeature(feature) {
    if (feature?.geometry?.type !== "MultiPolygon") return feature;
    // Reviewed river parents and contour neighbors were pinned before this
    // display pass. Pruning their fragments would invalidate the shared seams
    // and prevent saving/exporting the authenticated pack, even with tool off.
    const riverPack = getActiveRiverPack(state?.riverPaint, state?.activeScenarioId, state?.scenarioBaselineHash || "");
    if (riverPack && isRiverPaintSourceCompatible(riverPack, state?.activeScenarioManifest)) {
      const index = getRiverPartitionIndex(riverPack), id = getFeatureId(feature);
      const pinned = index.parents.get(id)?.parentGeometry || index.support.get(id)?.geometry;
      if (pinned && feature.geometry === pinned) return feature;
    }
    const polygonCoordinates = Array.isArray(feature.geometry.coordinates)
      ? feature.geometry.coordinates
      : [];
    if (polygonCoordinates.length < 2) return feature;

    const featureId = getFeatureId(feature);
    const rule = getFragmentCamouflageRule(feature, featureId);
    if (!rule) return feature;

    const components = polygonCoordinates.map((polygon, index) => ({
      index,
      polygon,
      area: getPolygonComponentAreaSteradians(polygon),
    }));
    if (components.some((component) => !Number.isFinite(component.area))) {
      return feature;
    }

    const largestComponent = components.reduce((largest, component) =>
      component.area > largest.area ? component : largest
    );
    const keptComponents = components.filter((component) =>
      component.area >= rule.minComponentAreaSteradians
      || (rule.preserveLargestComponent && component.index === largestComponent.index)
    );
    if (!keptComponents.length || keptComponents.length === components.length) {
      return feature;
    }

    return {
      ...feature,
      geometry: inheritContourCoordinatePrecision(feature.geometry, {
        ...feature.geometry,
        coordinates: keptComponents.map((component) => component.polygon),
      }),
      properties: {
        ...(feature.properties || {}),
        __visualFragmentCamouflage: true,
        __visualFragmentPrunedCount: components.length - keptComponents.length,
      },
    };
  }

  function applyFragmentCamouflageToCollection(collection) {
    if (!fragmentCamouflageRuleEntries.length || !Array.isArray(collection?.features) || !collection.features.length) {
      return collection;
    }
    let changed = false;
    const features = collection.features.map((feature) => {
      const camouflagedFeature = applyFragmentCamouflageToFeature(feature);
      if (camouflagedFeature !== feature) changed = true;
      return camouflagedFeature;
    });
    if (!changed) return collection;
    return {
      ...collection,
      features,
    };
  }

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

  function orientRingCoordinates(ring, outerRing) {
    if (!Array.isArray(ring) || ring.length < 4) return ring;
    const first = ring[0];
    const last = ring[ring.length - 1];
    const closedRing = Array.isArray(first) && Array.isArray(last)
      && first.length >= 2 && last.length >= 2
      && Number(first[0]) === Number(last[0])
      && Number(first[1]) === Number(last[1])
      ? ring
      : [...ring, first];
    const geoArea = globalThis.d3?.geoArea;
    if (typeof geoArea !== "function") return null;
    let area;
    try {
      area = Number(geoArea({ type: "Polygon", coordinates: [closedRing] }));
    } catch (_error) {
      return null;
    }
    if (!Number.isFinite(area)) return null;
    // d3.geoArea follows spherical winding: a clockwise outer ring describes
    // the smaller region (<= 2π); holes use the opposite winding. Planar
    // signed area is unreliable for antimeridian and near-polar rings.
    const hasDesiredWinding = outerRing ? area <= Math.PI * 2 : area > Math.PI * 2;
    if (hasDesiredWinding) return closedRing;
    return [...closedRing].reverse();
  }

  function rewindGeometryRings(geometry) {
    if (!geometry || !geometry.type || !geometry.coordinates) return null;
    if (geometry.type === "Polygon") {
      const coordinates = geometry.coordinates.map((ring, index) =>
        orientRingCoordinates(ring, index === 0)
      );
      if (coordinates.some((ring) => ring === null)) return null;
      return {
        ...geometry,
        coordinates,
      };
    }
    if (geometry.type === "MultiPolygon") {
      const coordinates = geometry.coordinates.map((polygon) =>
        Array.isArray(polygon)
          ? polygon.map((ring, index) => orientRingCoordinates(ring, index === 0))
          : polygon
      );
      if (coordinates.some((polygon) => Array.isArray(polygon)
        && polygon.some((ring) => ring === null))) return null;
      return {
        ...geometry,
        coordinates,
      };
    }
    return null;
  }

  function normalizeFeatureGeometry(feature, { sourceLabel = "detail" } = {}) {
    if (!feature?.geometry || !globalThis.d3?.geoArea) {
      return feature;
    }

    // Check geometry cache before calling geoArea.
    const geometry = feature.geometry;
    if (normalizedGeometryByGeometry.has(geometry)) {
      const cachedGeom = normalizedGeometryByGeometry.get(geometry);
      if (cachedGeom === GEOM_UNCHANGED) return feature;
      // cachedGeom is the rewound geometry object; spread a new feature to
      // carry current properties while returning the pre-computed geometry.
      return { ...feature, geometry: cachedGeom };
    }

    let area = null;
    try {
      area = globalThis.d3.geoArea(feature);
    } catch (_error) {
      // Do not cache: geoArea may succeed after d3 is initialised correctly.
      return feature;
    }
    if (!Number.isFinite(area)) return feature;
    if (area <= Math.PI * 2) {
      recordSphericalArea?.(geometry, area);
      // Preserve the fast path for already-small geometries. Spherical ring
      // normalization is needed when geoArea signals reversed winding.
      normalizedGeometryByGeometry.set(geometry, GEOM_UNCHANGED);
      return feature;
    }
    const rewoundGeometry = rewindGeometryRings(geometry);
    if (!rewoundGeometry) {
      // rewindGeometryRings returned null (unsupported type); do not cache.
      return feature;
    }
    const rewoundFeature = {
      ...feature,
      geometry: rewoundGeometry,
    };

    try {
      const rewoundArea = globalThis.d3.geoArea(rewoundFeature);
      recordSphericalArea?.(rewoundGeometry, rewoundArea);
      if (!Number.isFinite(rewoundArea)) return feature;
      if (rewoundArea < area) {
        const featureId = getFeatureId(feature) || "(unknown)";
        const logKey = `${sourceLabel}::${featureId}`;
        if (isRenderDiagEnabled() && !rewoundFeatureLogKeys.has(logKey)) {
          rewoundFeatureLogKeys.add(logKey);
          console.warn(
            `[map_renderer] Rewound ${sourceLabel} feature orientation for ${featureId}. area=${area.toFixed(5)} -> ${rewoundArea.toFixed(5)}`
          );
        }
        // Store the rewound geometry for reuse; do not re-run geoArea next time.
        inheritContourCoordinatePrecision(geometry, rewoundGeometry);
        normalizedGeometryByGeometry.set(geometry, rewoundGeometry);
        return rewoundFeature;
      }
    } catch (_error) {
      // Do not cache: second geoArea call failed; return original feature.
      return feature;
    }
    // Spherical ring normalization made no improvement; record that no
    // rewind is needed. Errors above remain uncached so a later retry works.
    normalizedGeometryByGeometry.set(geometry, GEOM_UNCHANGED);
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
    return consumePreparation(mergeOverrideFeaturesSteps(baseFeatures, overrideCollection));
  }

  function* mergeOverrideFeaturesSteps(baseFeatures, overrideCollection) {
    const order = [];
    const featureById = new Map();

    for (let index = 0, length = baseFeatures.length; index < length; index++) {
      if (!(index in baseFeatures)) { yield; continue; }
      const feature = baseFeatures[index];
      const featureId = getFeatureId(feature);
      if (featureId && !featureById.has(featureId)) {
        order.push(featureId);
        featureById.set(featureId, feature);
      }
      yield;
    }

    let applied = 0;
    let replaced = 0;

    const overrides = Array.isArray(overrideCollection?.features)
      ? overrideCollection.features
      : [];
    for (let index = 0, length = overrides.length; index < length; index++) {
      if (!(index in overrides)) { yield; continue; }
      const feature = overrides[index];
      if (!feature?.geometry) { yield; continue; }
      const normalizedFeature = normalizeFeatureGeometry(feature, { sourceLabel: "ru_override" });
      const featureId = getFeatureId(normalizedFeature);
      if (!featureId) { yield; continue; }

      const replaceIds = parseReplaceFeatureIds(
        normalizedFeature?.properties?.replace_ids ??
        normalizedFeature?.properties?.replaceIds ??
        ""
      );
      for (const replaceId of replaceIds) {
        if (featureById.delete(replaceId)) {
          replaced += 1;
        }
        yield;
      }

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
      yield;
    }

    if (applied > 0) {
      console.info(
        `[map_renderer] Applied RU city overrides: injected=${applied}, replaced=${replaced}.`
      );
    }

    const result = [];
    for (const id of order) {
      if (featureById.has(id)) result.push(featureById.get(id));
      yield;
    }
    return result;
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

  function consumePreparation(iterator) {
    let next = iterator.next();
    while (!next.done) next = iterator.next();
    return next.value;
  }

  async function consumePreparationChunked(iterator, {
    isCurrent = () => true,
    yieldControl = () => new Promise((resolve) => setTimeout(resolve, 0)),
    nowMs = () => globalThis.performance?.now?.() ?? Date.now(),
  } = {}) {
    let yieldCount = 0;
    let maxSliceMs = 0;
    let sliceStartedAt = nowMs();
    let steps = 0;
    // Input can replace authority while yielded. Guard every slice and the
    // final result without paying the whole-scene identity check per feature.
    let current = isCurrent();
    while (current) {
      const next = iterator.next();
      const sliceMs = Math.max(0, nowMs() - sliceStartedAt);
      maxSliceMs = Math.max(maxSliceMs, sliceMs);
      if (next.done) {
        if (!isCurrent()) break;
        return { status: "prepared", value: next.value, yieldCount, maxSliceMs };
      }
      if (++steps >= 400 || sliceMs >= 6) {
        if (!isCurrent()) break;
        yieldCount += 1;
        await yieldControl();
        current = isCurrent();
        sliceStartedAt = nowMs();
        steps = 0;
      }
    }
    iterator.return();
    return { status: "cancelled", value: null, yieldCount, maxSliceMs };
  }

  function composePoliticalFeatureCollections(primaryCollection, detailCollection = null, overrideCollection = null) {
    return consumePreparation(composePoliticalFeatureCollectionsSteps(primaryCollection, detailCollection, overrideCollection));
  }

  async function composePoliticalFeatureCollectionsChunked(primaryCollection, detailCollection = null, overrideCollection = null, options = {}) {
    const { value, ...result } = await consumePreparationChunked(
      composePoliticalFeatureCollectionsSteps(primaryCollection, detailCollection, overrideCollection), options
    );
    return { ...result, collection: value };
  }

  function* composePoliticalFeatureCollectionsSteps(primaryCollection, detailCollection, overrideCollection) {
    const geometrySnapshot = getPoliticalGeometrySnapshot(detailCollection);
    if (geometrySnapshot && detailCollection.globalCoverage === true && !overrideCollection) {
      const featuresById = new Map();
      const features = [];
      const preparation = { complete: false, snapshotRevision: geometrySnapshot.revision };
      const changedIds = new Set(geometrySnapshot.changedIds);
      let complete = true;
      // Source membership is indexed by the chunk store. Metadata remains
      // editable: retain shallow snapshot checks and propagate wrapper changes.
      for (const [id, feature] of geometrySnapshot.featuresById) {
        if (!getFeatureId(feature)) {
          yield;
          continue;
        }
        const cached = indexedDetailWrappers.get(feature);
        let wrapped = cached && matchesSnapshot(feature, cached.featureSnapshot)
          && matchesSnapshot(feature.properties, cached.propertiesSnapshot) ? cached.wrapped : null;
        // Composition can finish before its caller cancels publication. Keep
        // metadata candidates on same-revision retries for the committed cache.
        if (wrapped && (cached.preparation?.complete === false
          || cached.preparation?.snapshotRevision === geometrySnapshot.revision)) {
          changedIds.add(id);
          indexedDetailWrappers.set(feature, { ...cached, preparation });
        }
        if (!wrapped) {
          const normalized = normalizeFeatureGeometry(feature, { sourceLabel: "detail" });
          wrapped = { ...normalized, properties: { ...(normalized?.properties || {}), __source: "detail" } };
          changedIds.add(id);
          if (normalizedGeometryByGeometry.has(feature?.geometry)) indexedDetailWrappers.set(feature, {
            featureSnapshot: { ...feature }, propertiesSnapshot: { ...(feature.properties || {}) }, wrapped, preparation,
          });
          else complete = false;
        }
        featuresById.set(id, wrapped);
        features.push(wrapped);
        yield;
      }
      const result = { type: "FeatureCollection", features };
      preparation.complete = true;
      return complete ? registerPoliticalGeometrySnapshot(result, { ...geometrySnapshot, featuresById, changedIds: [...changedIds] }) : result;
    }
    // A complete scenario collection owns every region, including its shell
    // underlays. Modern primary geometry must not be promoted over that source.
    const normalizedPrimaryCollection = detailCollection?.globalCoverage !== true && Array.isArray(primaryCollection?.features)
      ? primaryCollection
      : { type: "FeatureCollection", features: [] };
    let normalizedDetailCollection = null;
    if (Array.isArray(detailCollection?.features)) {
      const sourceFeatures = detailCollection.features;
      const normalizedFeatures = new Array(sourceFeatures.length);
      for (let index = 0, length = sourceFeatures.length; index < length; index++) {
        if (index in sourceFeatures) {
          const feature = sourceFeatures[index];
          // Geometry and metadata can be replaced independently on a feature.
          // Compare shallow snapshots so scalar metadata edits stay visible.
          const cached = normalizedDetailWrapperByFeature.get(feature);
          if (cached && matchesSnapshot(feature, cached.featureSnapshot)
            && matchesSnapshot(feature.properties, cached.propertiesSnapshot)) {
            normalizedFeatures[index] = cached.wrapped;
          } else {
            const normalizedFeature = normalizeFeatureGeometry(feature, { sourceLabel: "detail" });
            const wrapped = {
              ...normalizedFeature,
              properties: {
                ...(normalizedFeature?.properties || {}),
                __source: "detail",
              },
            };
            // A failed normalization must be retried on the next composition.
            if (normalizedGeometryByGeometry.has(feature?.geometry)) {
              normalizedDetailWrapperByFeature.set(feature, {
                featureSnapshot: { ...feature },
                propertiesSnapshot: { ...(feature.properties || {}) },
                wrapped,
              });
            }
            normalizedFeatures[index] = wrapped;
          }
        }
        yield;
      }
      normalizedDetailCollection = { type: "FeatureCollection", features: normalizedFeatures };
    }
    if (!normalizedDetailCollection) {
      const baseFeatures = normalizedPrimaryCollection.features;
      const features = overrideCollection
        ? yield* mergeOverrideFeaturesSteps(baseFeatures, overrideCollection)
        : baseFeatures;
      return {
        type: "FeatureCollection",
        features,
      };
    }
    const detailCountries = new Set();
    const detailFeatureIdsByCountry = new Map();
    for (let index = 0, length = normalizedDetailCollection.features.length; index < length; index++) {
      if (index in normalizedDetailCollection.features) {
        const feature = normalizedDetailCollection.features[index];
        const code = getFeatureCountryCodeNormalized(feature);
        if (code) detailCountries.add(code);
        const featureId = getFeatureId(feature);
        if (code && featureId) {
          let ids = detailFeatureIdsByCountry.get(code);
          if (!ids) {
            ids = new Set();
            detailFeatureIdsByCountry.set(code, ids);
          }
          ids.add(featureId);
        }
      }
      yield;
    }

    const seen = new Set();
    const features = [];

    const pushIfUnique = (feature) => {
      const id = getFeatureId(feature);
      if (!id) return;
      if (seen.has(id)) return;
      seen.add(id);
      features.push(feature);
    };

    for (let index = 0, length = normalizedDetailCollection.features.length; index < length; index++) {
      if (index in normalizedDetailCollection.features) pushIfUnique(normalizedDetailCollection.features[index]);
      yield;
    }
    for (let index = 0, length = normalizedPrimaryCollection.features.length; index < length; index++) {
      if (!(index in normalizedPrimaryCollection.features)) { yield; continue; }
      const feature = normalizedPrimaryCollection.features[index];
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
      } else pushIfUnique(feature);
      yield;
    }

    const mergedFeatures = overrideCollection
      ? yield* mergeOverrideFeaturesSteps(features, overrideCollection)
      : features;

    return {
      type: "FeatureCollection",
      features: mergedFeatures,
    };
  }

  function createCountryCoverageAccumulator(totalFeatures) {
    const detailCountries = new Set();
    const primaryCountries = new Set();
    let detailFeatureCount = 0;
    let primaryFeatureCount = 0;
    const countryCoverage = new Map();

    function add(feature) {
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
    }

    function finish() {
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
        totalFeatures,
        detailFeatures: detailFeatureCount,
        primaryFeatures: primaryFeatureCount,
        detailCountryList,
        primaryCountryList,
        priorityCountryGaps,
      };
    }
    return { add, finish };
  }

  function collectCountryCoverageStats(features = []) {
    const coverage = createCountryCoverageAccumulator(features.length);
    for (const feature of features) coverage.add(feature);
    return coverage.finish();
  }

  function buildInteractiveLandData(fullCollection) {
    return consumePreparation(preparePoliticalCollectionViewSteps(fullCollection, false)).interactiveCollection;
  }

  async function preparePoliticalCollectionViewChunked(fullCollection, options = {}) {
    const { value, ...result } = await consumePreparationChunked(
      preparePoliticalCollectionViewSteps(fullCollection, true), options
    );
    return { ...result, interactiveCollection: value?.interactiveCollection ?? null, coverage: value?.coverage ?? null };
  }

  function* preparePoliticalCollectionViewSteps(fullCollection, includeCoverage) {
    const sourceFeatures = Array.isArray(fullCollection?.features) ? fullCollection.features : [];
    const coverage = includeCoverage ? createCountryCoverageAccumulator(sourceFeatures.length) : null;
    const finish = (interactiveCollection) => ({ interactiveCollection, coverage: coverage?.finish() });
    if (!sourceFeatures.length) return finish(fullCollection);

    const explicitFeatures = [];
    const filterStateByCountry = new Map();
    for (const feature of sourceFeatures) {
      coverage?.add(feature);
      if (isPoliticalInteractionRenderableFeature(feature, getFeatureId(feature))) {
        explicitFeatures.push(feature);
        const countryCode = getFeatureCountryCodeNormalized(feature);
        const blockedTiers = interactiveAggregateTierFilters[countryCode];
        if (countryCode && blockedTiers?.size) {
          const tier = getDetailTier(feature).toLowerCase();
          let entry = filterStateByCountry.get(countryCode);
          if (!entry) {
            entry = { blockedTiers, hasLeaf: false, hasBlocked: false };
            filterStateByCountry.set(countryCode, entry);
          }
          if (blockedTiers.has(tier)) entry.hasBlocked = true;
          else if (String(feature?.properties?.__source || "primary") === "detail") entry.hasLeaf = true;
        }
      }
      yield;
    }
    const explicitCollection = explicitFeatures.length === sourceFeatures.length
      ? fullCollection
      : { type: "FeatureCollection", features: explicitFeatures };
    if (!explicitFeatures.length) return finish(explicitCollection);

    const activeFilters = new Map();
    for (const [code, entry] of filterStateByCountry) {
      if (entry.hasLeaf && entry.hasBlocked) activeFilters.set(code, entry);
      yield;
    }
    if (!activeFilters.size && !fragmentCamouflageRuleEntries.length) return finish(explicitCollection);
    const features = [];
    let changed = false;
    let filtered = false;
    for (const feature of explicitFeatures) {
      const entry = activeFilters.size ? activeFilters.get(getFeatureCountryCodeNormalized(feature)) : null;
      if (entry?.blockedTiers.has(getDetailTier(feature).toLowerCase())) {
        changed = true;
        filtered = true;
      } else {
        const camouflaged = fragmentCamouflageRuleEntries.length ? applyFragmentCamouflageToFeature(feature) : feature;
        if (camouflaged !== feature) changed = true;
        features.push(camouflaged);
      }
      yield;
    }
    return finish(filtered ? { type: "FeatureCollection", features }
      : changed ? { ...explicitCollection, features } : explicitCollection);
  }

  return {
    applyFragmentCamouflageToCollection,
    applyFragmentCamouflageToFeature,
    buildInteractiveLandData,
    collectCountryCoverageStats,
    composePoliticalFeatureCollections,
    composePoliticalFeatureCollectionsChunked,
    preparePoliticalCollectionViewChunked,
    composePoliticalFeatures,
    getPoliticalFeatureCollection,
    mergeOverrideFeatures,
    normalizeFeatureGeometry,
  };
}
