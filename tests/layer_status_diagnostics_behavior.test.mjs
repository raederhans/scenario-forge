import assert from "node:assert/strict";
import test from "node:test";

import {
  THEMATIC_REAL_SOURCE_DERIVED_METADATA_REASON,
  THEMATIC_REAL_SOURCE_NOT_INGESTED_REASON,
  THEMATIC_WGI_MAIN_MAP_SUPPORT_LABEL,
  THEMATIC_HDI_MAIN_MAP_SUPPORT_LABEL,
  THEMATIC_MAIN_MAP_SUPPORT_LABEL,
} from "../js/core/thematic_layer_catalog.js";
import {
  createDefaultContentState,
} from "../js/core/state/content_state.js";
import {
  createDefaultStyleConfig,
  createDefaultUiState,
} from "../js/core/state/ui_state.js";
import {
  buildBathymetryDiagnostic,
  buildDayNightDiagnostic,
  buildLayerStatusDiagnostics,
  buildThematicCatalogDiagnostic,
  buildTransportFamilyDiagnostics,
  buildTransportMasterDiagnostic,
  resolveLayerStatusTone,
  sanitizeLayerStatusText,
} from "../js/ui/toolbar/layer_status_diagnostics.js";

function createState(overrides = {}) {
  return {
    ...createDefaultContentState(),
    ...createDefaultUiState(),
    styleConfig: createDefaultStyleConfig(),
    renderPerfMetrics: {},
    zoomTransform: { k: 4 },
    ...overrides,
  };
}

test("physical atlas status ignores skipped contours and dormant contour failures", () => {
  const state = createState({
    showPhysical: true,
    physicalSemanticsData: { features: [{}, {}, {}] },
    physicalContourMajorData: { features: [{}, {}] },
    contextLayerLoadStateByName: { physical_semantics: "loaded", physical_contours_major: "error" },
    renderPerfMetrics: { contextBreakdown: {
      drawPhysicalContourLayer: { featureCount: 0, skipped: true, reason: "atlas-only" },
      drawPhysicalAtlasLayer: { featureCount: 3, renderedCount: 1 },
      drawPhysicalReliefOverlayLayer: { featureCount: 3, renderedCount: 1 },
      drawPhysicalBasePass: { renderedCount: 5 },
    } },
  });
  const physical = buildLayerStatusDiagnostics(state).find((entry) => entry.id === "physical");
  assert.equal(physical.loadedCount, 3);
  assert.equal(physical.visibleCount, 2);
  assert.equal(physical.summary, "Visible · 2 visible · 3 loaded");
});

test("contours-only status uses the requested LOD and excludes dormant atlas data", () => {
  const state = createState({
    showPhysical: true,
    styleConfig: { physical: { mode: "contours_only" } },
    zoomTransform: { k: 1 },
    physicalSemanticsData: { features: [{}, {}, {}] },
    physicalContourMajorData: { features: [{}, {}] },
    physicalContourMinorData: { features: [{}] },
    contextLayerLoadStateByName: { physical_contours_low_major: "loaded", physical_semantics: "error" },
    renderPerfMetrics: { drawPhysicalContourLayer: { renderedCount: 0 } },
  });
  const physical = buildLayerStatusDiagnostics(state).find((entry) => entry.id === "physical");
  assert.equal(physical.summary, "Loaded · 0 visible · 2 loaded");
  state.contextLayerLoadStateByName.physical_contours_low_major = "loading";
  assert.equal(buildLayerStatusDiagnostics(state).find((entry) => entry.id === "physical").summary, "Loading/settling");
});

test("physical status exposes requested detail failures while preserving overview availability", () => {
  const state = createState({
    showPhysical: true,
    physicalSemanticsData: { features: [{}] },
    contextLayerLoadStateByName: { physical_semantics: "loaded", physical_semantics_detail: "error" },
    renderPerfMetrics: { drawPhysicalAtlasLayer: { renderedCount: 1 } },
  });
  const diagnostic = () => buildLayerStatusDiagnostics(state).find((entry) => entry.id === "physical");
  assert.equal(diagnostic().severity, "warning");
  assert.equal(diagnostic().summary, "Visible · 1 visible · 1 loaded · Regional detail: Load error");
  state.zoomTransform.k = 1;
  assert.equal(diagnostic().severity, "active");
  assert.equal(diagnostic().summary, "Visible · 1 visible · 1 loaded");
});

test("physical status reports requested names and shade independently and ignores dormant failures", () => {
  const state = createState({
    showPhysical: true,
    physicalSemanticsData: { features: [{}] },
    styleConfig: { physical: { mode: "atlas_only", showRegionLabels: true, hillshadeOpacity: 0.1 } },
    contextLayerLoadStateByName: {
      physical_semantics: "loaded", physical_region_labels: "error", physical_hillshade: "loading",
    },
  });
  const diagnostic = () => buildLayerStatusDiagnostics(state).find((entry) => entry.id === "physical");
  assert.equal(diagnostic().severity, "warning");
  assert.match(diagnostic().summary, /Physical region names: Load error/);
  assert.match(diagnostic().summary, /Terrain shading: Loading\/settling/);
  state.styleConfig.physical.showRegionLabels = false;
  state.styleConfig.physical.hillshadeOpacity = 0;
  assert.equal(diagnostic().summary, "Loaded · 1 loaded");
  state.styleConfig.physical.mode = "contours_only";
  state.styleConfig.physical.showRegionLabels = true;
  state.styleConfig.physical.hillshadeOpacity = 0.1;
  assert.equal(diagnostic().severity, "active");
  assert.doesNotMatch(diagnostic().summary, /names|shading|detail/);
  state.showPhysical = false;
  assert.equal(diagnostic().summary, "Hidden");
});

test("layer diagnostics report loaded and visible counts from existing metrics", () => {
  const state = createState({
    urbanData: {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {} },
        { type: "Feature", properties: {} },
        { type: "Feature", properties: {} },
      ],
    },
    renderPerfMetrics: {
      contextBreakdown: {
        drawUrbanLayer: {
          featureCount: 3,
          visibleFeatureCount: 2,
        },
      },
    },
  });

  const diagnostics = buildLayerStatusDiagnostics(state, { translate: (key) => key });
  const urban = diagnostics.find((entry) => entry.id === "urban");

  assert.equal(urban.summary, "Visible · 2 visible · 3 loaded");
  assert.equal(urban.severity, "active");
});

test("city status uses the latest settled marker count over a stale interactive zero", () => {
  const state = createState({
    worldCitiesData: { type: "FeatureCollection", features: [{}, {}, {}] },
    renderPerfMetrics: {
      drawLabelsPass: { recordedAt: 200, interactive: false, featureCount: 3, visibleFeatureCount: 2 },
      drawCityPointsLayer: { recordedAt: 100, interactive: true, featureCount: 3, visibleFeatureCount: 0 },
      contextBreakdown: {
        drawCityPointsLayer: { recordedAt: 100, interactive: true, featureCount: 3, visibleFeatureCount: 0 },
      },
    },
  });
  const city = buildLayerStatusDiagnostics(state, { translate: (key) => key })
    .find((entry) => entry.id === "city-points");
  assert.equal(city.visibleCount, 2);
  assert.equal(city.summary, "Visible · 2 visible · 3 loaded");
});

test("city status respects a newer interactive zero and does not invent zero without a measurement", () => {
  const state = createState({
    worldCitiesData: { type: "FeatureCollection", features: [{}, {}, {}] },
    renderPerfMetrics: {
      drawLabelsPass: { recordedAt: 100, visibleFeatureCount: 2 },
      drawCityPointsLayer: { recordedAt: 200, visibleFeatureCount: 0 },
    },
  });
  const status = () => buildLayerStatusDiagnostics(state, { translate: (key) => key })
    .find((entry) => entry.id === "city-points");
  assert.equal(status().summary, "Loaded · 0 visible · 3 loaded");

  state.renderPerfMetrics = { drawLabelsPass: { recordedAt: 300, skipped: true, reason: "staged-apply" } };
  assert.equal(status().visibleCount, null);
  assert.equal(status().summary, "Loaded · 3 loaded");
});

test("city status uses metric sequence when settled and interactive draws share a timestamp", () => {
  const state = createState({
    worldCitiesData: { type: "FeatureCollection", features: [{}, {}, {}] },
    renderPerfMetrics: {
      drawLabelsPass: { recordedAt: 500, sequence: 12, visibleFeatureCount: 2 },
      drawCityPointsLayer: { recordedAt: 500, sequence: 13, visibleFeatureCount: 0 },
    },
  });
  const status = () => buildLayerStatusDiagnostics(state, { translate: (key) => key })
    .find((entry) => entry.id === "city-points");
  assert.equal(status().visibleCount, 0);
  state.renderPerfMetrics.drawLabelsPass.sequence = 14;
  assert.equal(status().visibleCount, 2);
});

test("transport master diagnostic exposes enabled state with zero selected families", () => {
  const state = createState({
    showTransport: true,
    showAirports: false,
    showPorts: false,
    showRail: false,
    showRoad: false,
  });

  const diagnostic = buildTransportMasterDiagnostic(state, { translate: (key) => key });

  assert.equal(diagnostic.summary, "No overview family selected");
  assert.equal(diagnostic.severity, "muted");
  assert.equal(resolveLayerStatusTone(diagnostic), "muted");
  assert.deepEqual(diagnostic.selectedFamilies, []);
});

test("transport family diagnostics expose workbench-only disabled reasons", () => {
  const diagnostics = buildTransportFamilyDiagnostics(createState(), { translate: (key) => key });
  const mineral = diagnostics.find((entry) => entry.familyId === "mineral_resources");
  const energy = diagnostics.find((entry) => entry.familyId === "energy_facilities");
  const industrial = diagnostics.find((entry) => entry.familyId === "industrial_zones");
  const logistics = diagnostics.find((entry) => entry.familyId === "logistics_hubs");

  assert.equal(mineral.supported, false);
  assert.equal(mineral.disabledReason, "Available in Transport Workbench only");
  assert.equal(energy.summary, "Available in Transport Workbench only");
  assert.equal(industrial.summary, "Available in Transport Workbench only");
  assert.equal(logistics.severity, "muted");
});

test("bathymetry diagnostic explains disabled and pending data states", () => {
  const disabled = buildBathymetryDiagnostic(createState(), { translate: (key) => key });
  assert.equal(disabled.summary, "Off");
  assert.equal(disabled.severity, "muted");
  assert.equal(resolveLayerStatusTone(disabled), "off");

  const pending = buildBathymetryDiagnostic(createState({
    styleConfig: {
      ...createDefaultStyleConfig(),
      ocean: {
        ...createDefaultStyleConfig().ocean,
        experimentalAdvancedStyles: true,
        preset: "bathymetry_soft",
      },
    },
  }), { translate: (key) => key });
  assert.equal(pending.summary, "Bathymetry data pending for selected style");
  assert.equal(pending.severity, "warning");
  assert.equal(resolveLayerStatusTone(pending), "warning");
});

test("bathymetry diagnostic separates loaded data from current view and reports load failures", () => {
  const state = createState({
    styleConfig: {
      ...createDefaultStyleConfig(),
      ocean: { ...createDefaultStyleConfig().ocean, experimentalAdvancedStyles: true, preset: "bathymetry_soft" },
    },
    activeBathymetryBandsData: { features: [{}, {}] },
    activeBathymetryContoursData: { features: [{}] },
    renderPerfMetrics: {
      bathymetryLoad: { status: "ready", failedSources: [] },
      bathymetryVisibility: { status: "ready", globalVisibleCount: 0, scenarioVisibleCount: 0, visibleCount: 0 },
    },
  });
  const diagnostic = () => buildBathymetryDiagnostic(state, { translate: (key) => key });
  assert.equal(diagnostic().loadedCount, 3);
  assert.equal(diagnostic().visibleCount, 0);
  assert.equal(diagnostic().summary, "No bathymetry coverage in this view");

  state.renderPerfMetrics.bathymetryVisibility = { status: "ready", globalVisibleCount: 2, scenarioVisibleCount: 1, visibleCount: 3 };
  assert.equal(diagnostic().summary, "2 raster-derived visible · 1 schematic visible");
  assert.equal(diagnostic().visibleCount, 3);

  state.renderPerfMetrics.bathymetryLoad = { status: "partial", failedSources: ["regional source"] };
  assert.equal(diagnostic().severity, "warning");
  assert.match(diagnostic().summary, /Some bathymetry sources failed to load · regional source/);

  state.renderPerfMetrics.bathymetryLoad = { status: "error", failedSources: ["regional source"] };
  assert.equal(diagnostic().summary, "Bathymetry data failed to load · regional source");
  state.activeBathymetryBandsData = { features: [] };
  state.activeBathymetryContoursData = { features: [] };
  state.renderPerfMetrics.bathymetryLoad = { status: "partial", failedSources: ["regional source"] };
  state.renderPerfMetrics.bathymetryVisibility = { status: "off" };
  assert.equal(diagnostic().summary, "Some bathymetry sources failed to load · regional source");
  state.renderPerfMetrics.bathymetryLoad = { status: "ready", failedSources: [] };
  state.renderPerfMetrics.bathymetryVisibility = { status: "hidden", visibleCount: 0 };
  assert.equal(diagnostic().summary, "Bathymetry opacity is zero");
  assert.equal(diagnostic().visibleCount, null);
});

test("day and night diagnostic uses the clock mode labels", () => {
  const labels = {
    Enabled: "启用",
    "Manual UTC": "手动 UTC",
    "Live Computer UTC": "本机 UTC 实时同步",
    "Continuous Cycle": "连续循环",
  };
  for (const [mode, expected] of [
    ["manual", "手动 UTC"], ["utc", "本机 UTC 实时同步"], ["cycle", "连续循环"],
  ]) {
    const state = createState({
      styleConfig: { ...createDefaultStyleConfig(), dayNight: { enabled: true, mode } },
    });
    const diagnostic = buildDayNightDiagnostic(state, { translate: (key) => labels[key] || key });
    assert.equal(diagnostic.summary, `启用 · ${expected}`);
  }
});

test("thematic catalog diagnostic reports read-only fixture preview state", () => {
  const layers = [
    { fixtureOnly: true, hiddenByDefault: true, manifestLoaded: true, realSourceStatus: THEMATIC_REAL_SOURCE_NOT_INGESTED_REASON },
    { fixtureOnly: true, hiddenByDefault: true, manifestLoaded: true, realSourceStatus: THEMATIC_REAL_SOURCE_NOT_INGESTED_REASON },
    { fixtureOnly: true, hiddenByDefault: true, manifestLoaded: true, realSourceStatus: THEMATIC_REAL_SOURCE_NOT_INGESTED_REASON },
    { fixtureOnly: false, hiddenByDefault: true, manifestLoaded: true, realSourceStatus: THEMATIC_REAL_SOURCE_DERIVED_METADATA_REASON },
  ];
  const preview = {
    status: "ready",
    layerCount: layers.length,
    loadedManifestCount: layers.length,
    layers,
  };
  const diagnostic = buildThematicCatalogDiagnostic({ thematicCatalogPreview: preview }, { translate: (key) => key });

  assert.equal(diagnostic.id, "thematic");
  assert.equal(diagnostic.enabled, false);
  assert.equal(diagnostic.loadedCount, layers.length);
  assert.equal(diagnostic.visibleCount, 0);
  assert.equal(diagnostic.severity, "muted");
  assert.equal(diagnostic.summary.includes("Preview metadata available"), true);
  assert.equal(diagnostic.summary.includes("Runtime rendering disabled"), true);
  assert.equal(diagnostic.summary.includes(THEMATIC_REAL_SOURCE_NOT_INGESTED_REASON), true);
  assert.equal(diagnostic.summary.includes(THEMATIC_REAL_SOURCE_DERIVED_METADATA_REASON), true);

  const diagnostics = buildLayerStatusDiagnostics(createState(), {
    translate: (key) => key,
    thematicCatalogPreview: preview,
  });
  assert.ok(diagnostics.find((entry) => entry.id === "thematic"));
});

test("thematic catalog diagnostics use the shared country-indicators label for either admitted source family", () => {
  assert.equal(THEMATIC_WGI_MAIN_MAP_SUPPORT_LABEL, "WGI governance · Scenario reference");
  assert.equal(THEMATIC_HDI_MAIN_MAP_SUPPORT_LABEL, "UNDP human development · Scenario reference");
  assert.equal(THEMATIC_MAIN_MAP_SUPPORT_LABEL, "Country indicators · Scenario reference");
  for (const layerId of ["political_wgi_state_capacity_v1", "social_human_development_v1"]) {
    const diagnostic = buildThematicCatalogDiagnostic({ thematicCatalogPreview: {
      status: "ready",
      layers: [{ layerId, supportsMainMapRender: true, manifestLoaded: true,
        realSourceStatus: THEMATIC_REAL_SOURCE_DERIVED_METADATA_REASON }],
    } }, { translate: (key) => key });
    assert.equal(diagnostic.summary.includes(THEMATIC_MAIN_MAP_SUPPORT_LABEL), true);
    assert.equal(diagnostic.summary.includes("Runtime rendering disabled"), false);
    assert.equal(diagnostic.enabled, false);
    assert.equal(diagnostic.visibleCount, 0);
  }
});

test("mixed thematic-family diagnostics translate shared support while retaining fixture and source boundaries", () => {
  const diagnostic = buildThematicCatalogDiagnostic({ thematicCatalogPreview: {
    status: "ready",
    layers: [
      { supportsMainMapRender: true, manifestLoaded: true, hiddenByDefault: true,
        realSourceStatus: THEMATIC_REAL_SOURCE_DERIVED_METADATA_REASON },
      { supportsMainMapRender: true, manifestLoaded: true, hiddenByDefault: true,
        realSourceStatus: THEMATIC_REAL_SOURCE_DERIVED_METADATA_REASON },
      { fixtureOnly: true, manifestLoaded: true, hiddenByDefault: true,
        realSourceStatus: THEMATIC_REAL_SOURCE_NOT_INGESTED_REASON },
    ],
  } }, { translate: (key) => key === THEMATIC_MAIN_MAP_SUPPORT_LABEL ? "国家指标 · 剧本参考" : key });
  assert.equal(diagnostic.loadedCount, 3);
  assert.equal(diagnostic.visibleCount, 0);
  assert.ok(diagnostic.summary.includes("国家指标 · 剧本参考"));
  assert.ok(diagnostic.summary.includes("Fixture only"));
  assert.ok(diagnostic.summary.includes(THEMATIC_REAL_SOURCE_NOT_INGESTED_REASON));
  assert.ok(diagnostic.summary.includes(THEMATIC_REAL_SOURCE_DERIVED_METADATA_REASON));
  assert.equal(diagnostic.summary.includes("Runtime rendering disabled"), false);
});

test("layer diagnostics keep text clean and do not mutate default state", () => {
  const state = createState();
  const before = JSON.stringify(state.styleConfig);
  const diagnostics = buildLayerStatusDiagnostics(state, { translate: (key) => key });

  assert.equal(JSON.stringify(state.styleConfig), before);
  diagnostics.forEach((entry) => {
    assert.equal(String(entry.summary).includes("undefined"), false);
    assert.equal(String(entry.summary).includes("null"), false);
    assert.equal(String(entry.summary).includes("NaN"), false);
  });
  assert.equal(sanitizeLayerStatusText("Visible · undefined · NaN"), "Visible");
});
