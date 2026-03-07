// App entry point (Phase 13)
import { state } from "./core/state.js";
import { loadDeferredDetailBundle, loadMapData } from "./core/data_loader.js";
import { initMap, setMapData, render } from "./core/map_renderer.js";
import { applyActivePaletteState } from "./core/palette_manager.js";
import { initScenarioManager } from "./core/scenario_manager.js";
import { initSidebar, initPresetState } from "./ui/sidebar.js";
import { initShortcuts } from "./ui/shortcuts.js";
import { initToolbar } from "./ui/toolbar.js";
import { initTranslations } from "./ui/i18n.js";
import { initToast } from "./ui/toast.js";
import { bindBeforeUnload } from "./core/dirty_state.js";

const COUNTRY_CODE_ALIASES = {
  UK: "GB",
  EL: "GR",
};

function normalizeCountryCode(rawCode) {
  const code = String(rawCode || "").trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (!code) return "";
  return COUNTRY_CODE_ALIASES[code] || code;
}

function processHierarchyData(data) {
  state.hierarchyData = data || null;
  state.hierarchyGroupsByCode = new Map();
  state.countryGroupsData = state.hierarchyData?.country_groups || null;
  state.countryGroupMetaByCode = new Map();

  if (state.hierarchyData?.groups) {
    const labels = state.hierarchyData.labels || {};
    Object.entries(state.hierarchyData.groups).forEach(([groupId, children]) => {
      const code = normalizeCountryCode(groupId.split("_")[0]);
      if (!code) return;
      const list = state.hierarchyGroupsByCode.get(code) || [];
      list.push({
        id: groupId,
        label: labels[groupId] || groupId,
        children: Array.isArray(children) ? children : [],
      });
      state.hierarchyGroupsByCode.set(code, list);
    });
  }

  state.hierarchyGroupsByCode.forEach((groups) => {
    groups.sort((a, b) => a.label.localeCompare(b.label));
  });

  const countryMeta = state.countryGroupsData?.country_meta || {};
  Object.entries(countryMeta).forEach(([rawCode, meta]) => {
    const code = normalizeCountryCode(rawCode);
    if (!code || !meta || typeof meta !== "object") return;
    state.countryGroupMetaByCode.set(code, {
      continentId: String(meta.continent_id || "").trim(),
      continentLabel: String(meta.continent_label || "").trim(),
      subregionId: String(meta.subregion_id || "").trim(),
      subregionLabel: String(meta.subregion_label || "").trim(),
    });
  });
}

function hydrateLanguage() {
  try {
    const storedLang = localStorage.getItem("map_lang");
    if (storedLang) {
      state.currentLanguage = storedLang;
    }
  } catch (error) {
    console.warn("Language preference not available:", error);
  }
}

function createRenderDispatcher(renderFn) {
  let framePending = false;

  const flush = () => {
    framePending = false;
    renderFn();
  };

  const schedule = () => {
    if (framePending) return;
    framePending = true;
    globalThis.requestAnimationFrame(flush);
  };

  return { schedule, flush };
}

function getDeferredPromotionDelay(profile) {
  if (profile === "balanced") return 250;
  if (profile === "auto") return 1200;
  return 0;
}

function scheduleDeferredDetailPromotion(renderDispatcher) {
  if (!state.detailDeferred || state.detailPromotionCompleted || state.detailPromotionInFlight) {
    return;
  }

  const runPromotion = async () => {
    if (!state.detailDeferred || state.detailPromotionCompleted || state.detailPromotionInFlight) {
      return;
    }

    state.detailPromotionInFlight = true;
    try {
      const {
        topologyDetail,
        runtimePoliticalTopology,
        topologyBundleMode,
        detailSourceUsed,
      } = await loadDeferredDetailBundle({
        detailSourceKey: state.detailSourceRequested,
      });

      if (!topologyDetail) {
        state.detailDeferred = false;
        console.warn("[main] Deferred detail promotion skipped: no detail topology was loaded.");
        return;
      }

      state.topologyDetail = topologyDetail;
      state.runtimePoliticalTopology = runtimePoliticalTopology || state.runtimePoliticalTopology;
      state.topologyBundleMode = topologyBundleMode || "composite";
      state.detailDeferred = false;
      state.detailPromotionCompleted = true;
      state.detailSourceRequested = detailSourceUsed || state.detailSourceRequested;

      console.info(
        `[main] Deferred detail promotion applied. source=${state.detailSourceRequested}, mode=${state.topologyBundleMode}.`
      );
      setMapData({ refitProjection: false, resetZoom: false });
      renderDispatcher.schedule();
    } catch (error) {
      console.warn("[main] Deferred detail promotion failed:", error);
    } finally {
      state.detailPromotionInFlight = false;
    }
  };

  const delayMs = getDeferredPromotionDelay(state.renderProfile);
  if (typeof globalThis.requestIdleCallback === "function") {
    globalThis.requestIdleCallback(runPromotion, { timeout: Math.max(600, delayMs) });
  } else {
    globalThis.setTimeout(runPromotion, delayMs);
  }
}

async function bootstrap() {
  if (!globalThis.d3 || !globalThis.topojson) {
    console.error("D3/topojson not loaded. Ensure scripts are included before main.js.");
    return;
  }

  hydrateLanguage();

  try {
    bindBeforeUnload();
    const {
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
      hierarchy,
      ruCityOverrides,
      specialZones,
      contextLayerExternal,
      paletteRegistry,
      releasableCatalog,
      activePaletteMeta,
      activePalettePack,
      activePaletteMap,
    } = await loadMapData();
    state.topology = topology || topologyPrimary || topologyDetail;
    state.topologyPrimary = topologyPrimary || state.topology;
    state.topologyDetail = topologyDetail || null;
    state.runtimePoliticalTopology = runtimePoliticalTopology || null;
    state.topologyBundleMode = topologyBundleMode || "single";
    state.renderProfile = renderProfile || "auto";
    state.detailDeferred = !!detailDeferred;
    state.detailSourceRequested = detailSourceRequested || "na_v2";
    state.detailPromotionInFlight = false;
    state.detailPromotionCompleted = !detailDeferred;
    state.locales = locales || { ui: {}, geo: {} };
    state.geoAliasToStableKey = geoAliases?.alias_to_stable_key || {};
    state.ruCityOverrides = ruCityOverrides || null;
    state.specialZonesExternalData = specialZones || null;
    state.contextLayerExternalDataByName = contextLayerExternal || {};
    state.physicalSemanticsData = state.contextLayerExternalDataByName?.physical_semantics || null;
    state.physicalContourMajorData = state.contextLayerExternalDataByName?.physical_contours_major || null;
    state.physicalContourMinorData = state.contextLayerExternalDataByName?.physical_contours_minor || null;
    state.paletteRegistry = paletteRegistry || null;
    state.releasableCatalog = releasableCatalog || null;
    state.activePaletteMeta = activePaletteMeta || null;
    state.activePalettePack = activePalettePack || null;
    state.activePaletteMap = activePaletteMap || null;
    state.activePaletteId = String(
      activePaletteMeta?.palette_id
      || paletteRegistry?.default_palette_id
      || state.activePaletteId
      || "hoi4_vanilla"
    ).trim();
    state.currentPaletteTheme = String(
      activePaletteMeta?.display_name
      || state.currentPaletteTheme
      || "HOI4 Vanilla"
    );
    state.palettePackCacheById = state.palettePackCacheById || {};
    state.paletteMapCacheById = state.paletteMapCacheById || {};
    state.paletteLoadErrorById = state.paletteLoadErrorById || {};
    if (state.activePaletteId && activePalettePack) {
      state.palettePackCacheById[state.activePaletteId] = activePalettePack;
    }
    if (state.activePaletteId && activePaletteMap) {
      state.paletteMapCacheById[state.activePaletteId] = activePaletteMap;
    }
    applyActivePaletteState({ overwriteCountryPalette: true });
    processHierarchyData(hierarchy);

    if (!state.topologyPrimary) {
      console.error("CRITICAL: TopoJSON file loaded but is null/undefined");
      return;
    }

    const objects = state.topologyPrimary.objects || {};
    if (!objects.political) {
      console.error("CRITICAL: 'political' object missing from TopoJSON");
      return;
    }
    const primaryCount = Array.isArray(objects.political.geometries)
      ? objects.political.geometries.length
      : 0;
    const detailCount =
      state.topologyDetail?.objects?.political?.geometries &&
      Array.isArray(state.topologyDetail.objects.political.geometries)
        ? state.topologyDetail.objects.political.geometries.length
        : 0;
    const overrideCount = Array.isArray(state.ruCityOverrides?.features)
      ? state.ruCityOverrides.features.length
      : 0;
    console.log(
      `[main] Loaded topology bundle mode=${state.topologyBundleMode}, primary=${primaryCount}, detail=${detailCount}, ruOverrides=${overrideCount}.`
    );

    state.landData = globalThis.topojson.feature(state.topologyPrimary, objects.political);

    if (state.specialZonesExternalData?.features) {
      state.specialZonesData = state.specialZonesExternalData;
    } else if (objects.special_zones) {
      state.specialZonesData = globalThis.topojson.feature(state.topologyPrimary, objects.special_zones);
    }
    if (objects.rivers) {
      state.riversData = globalThis.topojson.feature(state.topologyPrimary, objects.rivers);
    } else if (Array.isArray(state.contextLayerExternalDataByName?.rivers?.features)) {
      state.riversData = state.contextLayerExternalDataByName.rivers;
    }
    if (objects.ocean) {
      state.oceanData = globalThis.topojson.feature(state.topologyPrimary, objects.ocean);
    }
    if (objects.land) {
      state.landBgData = globalThis.topojson.feature(state.topologyPrimary, objects.land);
    }
    if (objects.urban) {
      state.urbanData = globalThis.topojson.feature(state.topologyPrimary, objects.urban);
    } else if (Array.isArray(state.contextLayerExternalDataByName?.urban?.features)) {
      state.urbanData = state.contextLayerExternalDataByName.urban;
    }
    if (objects.physical) {
      state.physicalData = globalThis.topojson.feature(state.topologyPrimary, objects.physical);
    } else if (Array.isArray(state.contextLayerExternalDataByName?.physical?.features)) {
      state.physicalData = state.contextLayerExternalDataByName.physical;
    }
    state.physicalSemanticsData = state.contextLayerExternalDataByName?.physical_semantics || null;
    state.physicalContourMajorData = state.contextLayerExternalDataByName?.physical_contours_major || null;
    state.physicalContourMinorData = state.contextLayerExternalDataByName?.physical_contours_minor || null;

    initPresetState();
    initMap();
    setMapData();

    const renderDispatcher = createRenderDispatcher(render);
    const renderApp = () => {
      renderDispatcher.schedule();
    };
    globalThis.renderApp = renderApp;
    globalThis.renderNow = renderDispatcher.flush;
    state.renderNowFn = renderDispatcher.flush;

    initToast();
    initToolbar({ render: renderApp });
    initTranslations();
    initSidebar({ render: renderApp });
    initScenarioManager({ render: renderApp });
    initShortcuts();

    renderDispatcher.flush();
    scheduleDeferredDetailPromotion(renderDispatcher);
    console.log("Initial render complete.");
  } catch (error) {
    console.error("Failed to load TopoJSON:", error);
    console.error("Stack trace:", error.stack);
  }
}

bootstrap();
