// Content/data state defaults.
// 这里收口 localization、topology、context layer 和底图数据默认 shape，
// 避免 state.js 与 consumer reset/fallback 再次各写一份。

export function createDefaultLocalesState() {
  return {
    ui: {},
    geo: {},
  };
}

export function createDefaultContextLayerLoadStateByName() {
  return {
    rivers: "idle",
    urban: "idle",
    airports: "idle",
    ports: "idle",
    roads: "idle",
    road_labels: "idle",
    railways: "idle",
    rail_stations_major: "idle",
    physical: "idle",
    physical_semantics: "idle",
    physical_contours_major: "idle",
    physical_contours_minor: "idle",
  };
}

export function createDefaultContentState() {
  return {
    locales: createDefaultLocalesState(),
    baseLocalizationLevel: "full",
    baseLocalizationDataState: "idle",
    baseLocalizationDataError: "",
    baseLocalizationDataPromise: null,
    baseGeoLocales: {},
    geoAliasToStableKey: {},
    baseGeoAliasToStableKey: {},
    currentLanguage: globalThis.currentLanguage || "en",
    topology: null,
    topologyPrimary: null,
    topologyDetail: null,
    runtimePoliticalTopology: null,
    defaultRuntimePoliticalTopology: null,
    ruCityOverrides: null,
    topologyBundleMode: "single",
    renderProfile: "auto",
    detailDeferred: false,
    detailSourceRequested: "na_v2",
    detailPromotionInFlight: false,
    detailPromotionCompleted: false,
    scenarioApplyInFlight: false,
    parentBordersVisible: true,
    landData: null,
    landDataFull: null,
    specialZonesData: null,
    specialZonesExternalData: null,
    contextLayerExternalDataByName: {},
    contextLayerRevision: 0,
    contextLayerLoadStateByName: createDefaultContextLayerLoadStateByName(),
    contextLayerLoadErrorByName: {},
    contextLayerLoadPromiseByName: {},
    specialZones: {},
    waterRegionsData: null,
    riversData: null,
    airportsData: null,
    portsData: null,
    roadsData: null,
    roadLabelsData: null,
    railwaysData: null,
    railStationsMajorData: null,
    oceanData: null,
    globalBathymetryTopologyData: null,
    globalBathymetryBandsData: null,
    globalBathymetryContoursData: null,
    globalBathymetryTopologyUrl: "",
    activeBathymetryBandsData: null,
    activeBathymetryContoursData: null,
    activeBathymetrySource: "none",
    activeBathymetryTopologyUrl: "",
    oceanMaskMode: "topology_ocean",
    oceanMaskQuality: 1,
    landBgData: null,
    urbanData: null,
    urbanLayerCapability: null,
    worldCitiesData: null,
    baseCityAliasesData: null,
    baseCityDataState: "idle",
    baseCityDataError: "",
    baseCityDataPromise: null,
    physicalData: null,
    physicalSemanticsData: null,
    physicalContourMajorData: null,
    physicalContourMinorData: null,
    hierarchyData: null,
    hierarchyGroupsByCode: new Map(),
    countryGroupsData: null,
    countryGroupMetaByCode: new Map(),
    countryInteractionPoliciesByCode: new Map(),
    layerDataDiagnostics: {},
    contextLayerSourceByName: {},
    width: 0,
    height: 0,
    dpr: globalThis.devicePixelRatio || 1,
  };
}

export function setCurrentLanguage(target, language = "en") {
  if (!target || typeof target !== "object") {
    return "en";
  }
  const normalizedLanguage = String(language || "en").trim() || "en";
  target.currentLanguage = normalizedLanguage;
  return target.currentLanguage;
}

function ensureLocalesContainer(target) {
  if (!target.locales || typeof target.locales !== "object" || Array.isArray(target.locales)) {
    target.locales = createDefaultLocalesState();
  }
  return target.locales;
}

// Startup pipeline still owns the fetch flow; these helpers only collapse the
// repeated root-state writes for base city/localization hydration.
export function applyBaseLocalizationSnapshot(
  target,
  {
    uiLocales,
    geoLocales,
    aliasToStableKey,
    bumpCityLayerRevision = false,
  } = {},
) {
  if (!target || typeof target !== "object") {
    return null;
  }
  const currentLocales = ensureLocalesContainer(target);
  const locales = {
    ...currentLocales,
  };
  if (uiLocales && typeof uiLocales === "object") {
    locales.ui = { ...uiLocales };
  }
  if (geoLocales && typeof geoLocales === "object") {
    locales.geo = { ...geoLocales };
  }
  target.locales = locales;
  if (aliasToStableKey && typeof aliasToStableKey === "object") {
    target.geoAliasToStableKey = { ...aliasToStableKey };
  }
  if (bumpCityLayerRevision) {
    target.cityLayerRevision = (Number(target.cityLayerRevision) || 0) + 1;
  }
  return locales;
}

export function beginBaseCitySupportLoad(target) {
  if (!target || typeof target !== "object") {
    return "idle";
  }
  target.baseCityDataState = "loading";
  target.baseCityDataError = "";
  return target.baseCityDataState;
}

export function setBaseCityDataPromise(target, promise = null) {
  if (!target || typeof target !== "object") {
    return null;
  }
  target.baseCityDataPromise = promise || null;
  return target.baseCityDataPromise;
}

export function commitBaseCitySupportData(
  target,
  result,
  { scenarioActive = false } = {},
) {
  if (!target || typeof target !== "object") {
    return null;
  }
  target.worldCitiesData = result?.worldCities || null;
  target.baseCityAliasesData = result?.cityAliases || null;
  target.baseGeoLocales = {
    ...(
      result?.locales?.geo && typeof result.locales.geo === "object"
        ? result.locales.geo
        : (target.baseGeoLocales || {})
    ),
  };
  target.baseGeoAliasToStableKey = {
    ...(
      result?.geoAliases?.alias_to_stable_key && typeof result.geoAliases.alias_to_stable_key === "object"
        ? result.geoAliases.alias_to_stable_key
        : (target.baseGeoAliasToStableKey || {})
    ),
  };
  if (!scenarioActive) {
    applyBaseLocalizationSnapshot(target, {
      geoLocales: target.baseGeoLocales,
      aliasToStableKey: target.baseGeoAliasToStableKey,
      bumpCityLayerRevision: true,
    });
  }
  target.baseCityDataState = "loaded";
  target.baseCityDataError = "";
  target.baseCityDataPromise = null;
  return target.worldCitiesData;
}

export function failBaseCitySupportLoad(target, error) {
  if (!target || typeof target !== "object") {
    return "";
  }
  target.baseCityDataState = "error";
  target.baseCityDataError = error?.message || String(error || "Unknown city data loading error.");
  target.baseCityDataPromise = null;
  return target.baseCityDataError;
}

export function beginFullLocalizationLoad(target) {
  if (!target || typeof target !== "object") {
    return "idle";
  }
  target.baseLocalizationDataState = "loading";
  target.baseLocalizationDataError = "";
  return target.baseLocalizationDataState;
}

export function setBaseLocalizationDataPromise(target, promise = null) {
  if (!target || typeof target !== "object") {
    return null;
  }
  target.baseLocalizationDataPromise = promise || null;
  return target.baseLocalizationDataPromise;
}

export function commitFullLocalizationData(
  target,
  {
    uiLocales,
    geoLocales,
    aliasToStableKey,
    scenarioActive = false,
  } = {},
) {
  if (!target || typeof target !== "object") {
    return null;
  }
  target.baseGeoLocales = geoLocales && typeof geoLocales === "object"
    ? { ...geoLocales }
    : {};
  target.baseGeoAliasToStableKey = aliasToStableKey && typeof aliasToStableKey === "object"
    ? { ...aliasToStableKey }
    : {};
  target.baseLocalizationLevel = "full";
  applyBaseLocalizationSnapshot(target, {
    uiLocales,
    ...(scenarioActive
      ? {}
      : {
          geoLocales: target.baseGeoLocales,
          aliasToStableKey: target.baseGeoAliasToStableKey,
        }),
  });
  target.baseLocalizationDataState = "loaded";
  target.baseLocalizationDataError = "";
  target.baseLocalizationDataPromise = null;
  return target.locales;
}

export function failFullLocalizationLoad(target, error) {
  if (!target || typeof target !== "object") {
    return "";
  }
  target.baseLocalizationDataState = "error";
  target.baseLocalizationDataError = error?.message || String(error || "Unknown localization hydration error.");
  target.baseLocalizationDataPromise = null;
  return target.baseLocalizationDataError;
}

const CONTEXT_LAYER_DATA_FIELD_BY_NAME = {
  rivers: "riversData",
  airports: "airportsData",
  ports: "portsData",
  roads: "roadsData",
  road_labels: "roadLabelsData",
  railways: "railwaysData",
  rail_stations_major: "railStationsMajorData",
  urban: "urbanData",
  physical: "physicalData",
  physical_semantics: "physicalSemanticsData",
  physical_contours_major: "physicalContourMajorData",
  physical_contours_minor: "physicalContourMinorData",
};

// Deferred context layers keep a single layer-name -> state-field mapping here,
// so startup/bootstrap code no longer needs a long write switch.
function ensureContextLayerLoadMaps(target) {
  if (!target.contextLayerLoadStateByName || typeof target.contextLayerLoadStateByName !== "object") {
    target.contextLayerLoadStateByName = createDefaultContextLayerLoadStateByName();
  }
  if (!target.contextLayerLoadErrorByName || typeof target.contextLayerLoadErrorByName !== "object") {
    target.contextLayerLoadErrorByName = {};
  }
  if (!target.contextLayerLoadPromiseByName || typeof target.contextLayerLoadPromiseByName !== "object") {
    target.contextLayerLoadPromiseByName = {};
  }
}

export function commitContextLayerCollection(
  target,
  layerName,
  collection,
  { bumpRevision = false } = {},
) {
  if (!target || typeof target !== "object") {
    return null;
  }
  target.contextLayerExternalDataByName = {
    ...(target.contextLayerExternalDataByName || {}),
    [layerName]: collection,
  };
  const targetField = CONTEXT_LAYER_DATA_FIELD_BY_NAME[layerName];
  if (targetField) {
    target[targetField] = collection;
  }
  if (bumpRevision) {
    target.contextLayerRevision = (Number(target.contextLayerRevision) || 0) + 1;
  }
  return collection;
}

export function setContextLayerLoadState(
  target,
  layerName,
  loadState,
  {
    errorMessage,
    clearError = false,
  } = {},
) {
  if (!target || typeof target !== "object") {
    return "";
  }
  ensureContextLayerLoadMaps(target);
  target.contextLayerLoadStateByName[layerName] = loadState;
  if (errorMessage !== undefined) {
    target.contextLayerLoadErrorByName[layerName] = errorMessage;
  } else if (clearError) {
    target.contextLayerLoadErrorByName[layerName] = "";
  }
  return target.contextLayerLoadStateByName[layerName];
}

export function setContextLayerLoadPromise(target, layerName, promise = null) {
  if (!target || typeof target !== "object") {
    return null;
  }
  ensureContextLayerLoadMaps(target);
  if (promise) {
    target.contextLayerLoadPromiseByName[layerName] = promise;
    return promise;
  }
  delete target.contextLayerLoadPromiseByName[layerName];
  return null;
}

export function hydrateHierarchyState(
  target,
  data,
  {
    normalizeCountryCode = (value) => String(value || "").trim().toUpperCase(),
    normalizeBatchFillScopes = () => ["parent", "country"],
  } = {},
) {
  if (!target || typeof target !== "object") {
    return null;
  }
  target.hierarchyData = data || null;
  target.hierarchyGroupsByCode = new Map();
  target.countryGroupsData = target.hierarchyData?.country_groups || null;
  target.countryGroupMetaByCode = new Map();
  target.countryInteractionPoliciesByCode = new Map();

  if (target.hierarchyData?.groups) {
    const labels = target.hierarchyData.labels || {};
    Object.entries(target.hierarchyData.groups).forEach(([groupId, children]) => {
      const code = normalizeCountryCode(groupId.split("_")[0]);
      if (!code) return;
      const list = target.hierarchyGroupsByCode.get(code) || [];
      list.push({
        id: groupId,
        label: labels[groupId] || groupId,
        children: Array.isArray(children) ? children : [],
      });
      target.hierarchyGroupsByCode.set(code, list);
    });
  }

  target.hierarchyGroupsByCode.forEach((groups) => {
    groups.sort((a, b) => a.label.localeCompare(b.label));
  });

  const countryMeta = target.countryGroupsData?.country_meta || {};
  Object.entries(countryMeta).forEach(([rawCode, meta]) => {
    const code = normalizeCountryCode(rawCode);
    if (!code || !meta || typeof meta !== "object") return;
    target.countryGroupMetaByCode.set(code, {
      continentId: String(meta.continent_id || "").trim(),
      continentLabel: String(meta.continent_label || "").trim(),
      subregionId: String(meta.subregion_id || "").trim(),
      subregionLabel: String(meta.subregion_label || "").trim(),
    });
  });

  const interactionPolicies = target.hierarchyData?.interaction_policies || {};
  Object.entries(interactionPolicies).forEach(([rawCode, policy]) => {
    const code = normalizeCountryCode(rawCode);
    if (!code || !policy || typeof policy !== "object") return;
    target.countryInteractionPoliciesByCode.set(code, {
      leafSource: String(policy.leaf_source || "").trim().toLowerCase(),
      leafKind: String(policy.leaf_kind || "").trim().toLowerCase(),
      parentSource: String(policy.parent_source || "").trim().toLowerCase(),
      parentScopeLabel: String(policy.parent_scope_label || "").trim(),
      requiresComposite: !!policy.requires_composite,
      quickFillScopes: normalizeBatchFillScopes(policy.quick_fill_scopes),
    });
  });

  return target.hierarchyData;
}

export function hydrateStoredViewSettings(
  target,
  rawSettings,
  { normalizeCityLayerStyleConfig = (value) => value } = {},
) {
  if (!target || typeof target !== "object" || !rawSettings || typeof rawSettings !== "object") {
    return false;
  }
  const cityPoints = rawSettings.cityPoints && typeof rawSettings.cityPoints === "object"
    ? rawSettings.cityPoints
    : {};
  if (cityPoints.show !== undefined) {
    target.showCityPoints = !!cityPoints.show;
  }
  if (cityPoints.style && typeof cityPoints.style === "object") {
    target.styleConfig.cityPoints = normalizeCityLayerStyleConfig({
      ...(target.styleConfig.cityPoints || {}),
      ...cityPoints.style,
    });
  }
  return true;
}

export function hydrateStartupBaseContentState(
  target,
  {
    topology,
    topologyPrimary,
    topologyDetail,
    runtimePoliticalTopology,
    topologyBundleMode,
    renderProfile,
    detailDeferred,
    detailSourceRequested,
    locales,
    geoAliases,
    localeLevel,
    startupBootCacheState,
    ruCityOverrides,
    specialZones,
    contextLayerExternal,
  } = {},
) {
  if (!target || typeof target !== "object") {
    return null;
  }
  target.topology = topology || topologyPrimary || topologyDetail || null;
  target.topologyPrimary = topologyPrimary || target.topology;
  target.topologyDetail = topologyDetail || null;
  target.runtimePoliticalTopology = runtimePoliticalTopology || null;
  target.defaultRuntimePoliticalTopology = target.runtimePoliticalTopology || null;
  target.topologyBundleMode = topologyBundleMode || "single";
  target.renderProfile = renderProfile || "auto";
  target.detailDeferred = !!detailDeferred;
  target.detailSourceRequested = detailSourceRequested || "na_v2";
  target.detailPromotionInFlight = false;
  target.detailPromotionCompleted = !detailDeferred;
  target.locales = locales || createDefaultLocalesState();
  target.baseLocalizationLevel = localeLevel || "full";
  target.baseLocalizationDataState = target.baseLocalizationLevel === "full" ? "loaded" : "partial";
  target.baseLocalizationDataError = "";
  target.baseLocalizationDataPromise = null;
  target.baseGeoLocales = { ...(target.locales?.geo || {}) };
  target.geoAliasToStableKey = geoAliases?.alias_to_stable_key || {};
  target.baseGeoAliasToStableKey = { ...target.geoAliasToStableKey };
  target.worldCitiesData = null;
  target.baseCityAliasesData = null;
  target.baseCityDataState = "idle";
  target.baseCityDataError = "";
  target.baseCityDataPromise = null;
  target.cityLayerRevision = (Number(target.cityLayerRevision) || 0) + 1;
  target.ruCityOverrides = ruCityOverrides || null;
  target.specialZonesExternalData = specialZones || null;
  target.contextLayerExternalDataByName = contextLayerExternal || {};
  target.contextLayerRevision = (Number(target.contextLayerRevision) || 0) + 1;
  target.contextLayerLoadStateByName = createDefaultContextLayerLoadStateByName();
  target.contextLayerLoadErrorByName = {};
  target.contextLayerLoadPromiseByName = {};
  target.physicalSemanticsData = null;
  target.physicalContourMajorData = null;
  target.physicalContourMinorData = null;
  target.airportsData = null;
  target.portsData = null;
  if (startupBootCacheState && typeof startupBootCacheState === "object") {
    target.startupBootCacheState = startupBootCacheState;
  }
  return target.topologyPrimary;
}

export function decodeStartupPrimaryCollectionsIntoState(
  target,
  {
    startupDecodedCollections = null,
    topojsonClient = globalThis.topojson,
  } = {},
) {
  if (!target || typeof target !== "object") {
    return null;
  }
  if (!target.topologyPrimary) {
    throw new Error("CRITICAL: TopoJSON file loaded but is null/undefined");
  }
  const objects = target.topologyPrimary.objects || {};
  if (!objects.political) {
    throw new Error("CRITICAL: 'political' object missing from TopoJSON");
  }
  target.landData =
    startupDecodedCollections?.landData
    || topojsonClient.feature(target.topologyPrimary, objects.political);

  if (target.specialZonesExternalData?.features) {
    target.specialZonesData = target.specialZonesExternalData;
  } else if (objects.special_zones) {
    target.specialZonesData = startupDecodedCollections?.specialZonesData
      || topojsonClient.feature(target.topologyPrimary, objects.special_zones);
  }
  if (objects.rivers) {
    target.riversData = startupDecodedCollections?.riversData
      || topojsonClient.feature(target.topologyPrimary, objects.rivers);
  } else if (Array.isArray(target.contextLayerExternalDataByName?.rivers?.features)) {
    target.riversData = target.contextLayerExternalDataByName.rivers;
  }
  if (objects.water_regions) {
    target.waterRegionsData = startupDecodedCollections?.waterRegionsData
      || topojsonClient.feature(target.topologyPrimary, objects.water_regions);
  }
  if (objects.ocean) {
    target.oceanData = startupDecodedCollections?.oceanData
      || topojsonClient.feature(target.topologyPrimary, objects.ocean);
  }
  if (objects.land) {
    target.landBgData = startupDecodedCollections?.landBgData
      || topojsonClient.feature(target.topologyPrimary, objects.land);
  }
  if (objects.urban) {
    target.urbanData = startupDecodedCollections?.urbanData
      || topojsonClient.feature(target.topologyPrimary, objects.urban);
  } else if (Array.isArray(target.contextLayerExternalDataByName?.urban?.features)) {
    target.urbanData = target.contextLayerExternalDataByName.urban;
  }
  if (objects.physical) {
    target.physicalData = startupDecodedCollections?.physicalData
      || topojsonClient.feature(target.topologyPrimary, objects.physical);
  } else if (Array.isArray(target.contextLayerExternalDataByName?.physical?.features)) {
    target.physicalData = target.contextLayerExternalDataByName.physical;
  }
  return target.landData;
}
