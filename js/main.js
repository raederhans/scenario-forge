// App entry point (Phase 13)
import { state } from "./core/state.js";
import { loadMapData } from "./core/data_loader.js";
import { initMap, setMapData, render } from "./core/map_renderer.js";
import { initSidebar, initPresetState } from "./ui/sidebar.js";
import { initToolbar } from "./ui/toolbar.js";
import { initTranslations } from "./ui/i18n.js";

function processHierarchyData(data) {
  state.hierarchyData = data || null;
  state.hierarchyGroupsByCode = new Map();
  if (!state.hierarchyData || !state.hierarchyData.groups) return;
  const labels = state.hierarchyData.labels || {};
  Object.entries(state.hierarchyData.groups).forEach(([groupId, children]) => {
    const code = groupId.split("_")[0];
    if (!code) return;
    const list = state.hierarchyGroupsByCode.get(code) || [];
    list.push({
      id: groupId,
      label: labels[groupId] || groupId,
      children: Array.isArray(children) ? children : [],
    });
    state.hierarchyGroupsByCode.set(code, list);
  });
  state.hierarchyGroupsByCode.forEach((groups) => {
    groups.sort((a, b) => a.label.localeCompare(b.label));
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

async function bootstrap() {
  if (!globalThis.d3 || !globalThis.topojson) {
    console.error("D3/topojson not loaded. Ensure scripts are included before main.js.");
    return;
  }

  hydrateLanguage();

  try {
    const {
      topology,
      topologyPrimary,
      topologyDetail,
      topologyBundleMode,
      locales,
      geoAliases,
      hierarchy,
    } = await loadMapData();
    state.topology = topology || topologyPrimary || topologyDetail;
    state.topologyPrimary = topologyPrimary || state.topology;
    state.topologyDetail = topologyDetail || null;
    state.topologyBundleMode = topologyBundleMode || "single";
    state.locales = locales || { ui: {}, geo: {} };
    state.geoAliasToStableKey = geoAliases?.alias_to_stable_key || {};
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
    console.log(
      `[main] Loaded topology bundle mode=${state.topologyBundleMode}, primary=${primaryCount}, detail=${detailCount}.`
    );

    state.landData = globalThis.topojson.feature(state.topologyPrimary, objects.political);

    if (objects.special_zones) {
      state.specialZonesData = globalThis.topojson.feature(state.topologyPrimary, objects.special_zones);
    }
    if (objects.rivers) {
      state.riversData = globalThis.topojson.feature(state.topologyPrimary, objects.rivers);
    }
    if (objects.ocean) {
      state.oceanData = globalThis.topojson.feature(state.topologyPrimary, objects.ocean);
    }
    if (objects.land) {
      state.landBgData = globalThis.topojson.feature(state.topologyPrimary, objects.land);
    }
    if (objects.urban) {
      state.urbanData = globalThis.topojson.feature(state.topologyPrimary, objects.urban);
    }
    if (objects.physical) {
      state.physicalData = globalThis.topojson.feature(state.topologyPrimary, objects.physical);
    }

    initPresetState();
    initMap();
    setMapData();

    const renderApp = () => {
      render();
    };
    globalThis.renderApp = renderApp;

    initToolbar({ render: renderApp });
    initTranslations();
    initSidebar({ render: renderApp });

    renderApp();
    console.log("Initial render complete.");
  } catch (error) {
    console.error("Failed to load TopoJSON:", error);
    console.error("Stack trace:", error.stack);
  }
}

bootstrap();
