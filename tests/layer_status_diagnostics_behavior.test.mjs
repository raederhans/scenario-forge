import assert from "node:assert/strict";
import test from "node:test";

import {
  THEMATIC_REAL_SOURCE_DERIVED_METADATA_REASON,
  THEMATIC_REAL_SOURCE_NOT_INGESTED_REASON,
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
