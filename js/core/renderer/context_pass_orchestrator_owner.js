import { requireFunctionFrom } from "./require_function.js";
function createDeferredMetricPayload(featureCount) {
  return {
    featureCount,
    interactive: false,
    skipped: true,
    reason: "staged-apply",
  };
}

export function createContextPassOrchestratorOwner({
  getters = {},
  resolvers = {},
  helpers = {},
  effects = {},
} = {}) {
  const requireGetter = requireFunctionFrom(getters, "getters");
  const getDeferContextBasePass = requireGetter("getDeferContextBasePass");
  const requireResolver = requireFunctionFrom(resolvers, "resolvers");
  const resolveContextBaseDeferredSnapshot = requireResolver("resolveContextBaseDeferredSnapshot");
  const resolveContextMarkersDeferredSnapshot = requireResolver("resolveContextMarkersDeferredSnapshot");
  const requireHelper = requireFunctionFrom(helpers, "helpers");
  const nowMs = requireHelper("nowMs");
  const requireEffect = requireFunctionFrom(effects, "effects");
  const beginContextMetricSession = requireEffect("beginContextMetricSession");
  const endContextMetricSession = requireEffect("endContextMetricSession");
  const collectContextMetric = requireEffect("collectContextMetric");
  const recordRenderPerfMetric = requireEffect("recordRenderPerfMetric");
  const recordDeferredRiversLayerMetric = requireEffect("recordDeferredRiversLayerMetric");
  const drawPhysicalContourLayer = requireEffect("drawPhysicalContourLayer");
  const drawUrbanLayer = requireEffect("drawUrbanLayer");
  const drawRiversLayer = requireEffect("drawRiversLayer");
  const drawRoadsLayer = requireEffect("drawRoadsLayer");
  const drawRailwaysLayer = requireEffect("drawRailwaysLayer");
  const drawAirportsLayer = requireEffect("drawAirportsLayer");
  const drawPortsLayer = requireEffect("drawPortsLayer");
  const drawStrategicResourceMarkersLayer = requireEffect("drawStrategicResourceMarkersLayer");
  const drawCityPointsLayer = requireEffect("drawCityPointsLayer");
  const drawScenarioRegionOverlaysPass = requireEffect("drawScenarioRegionOverlaysPass");
  const drawScenarioReliefOverlaysPass = requireEffect("drawScenarioReliefOverlaysPass");

  function drawContextBasePass(k, { interactive = false } = {}) {
    const startedAt = nowMs();
    let deferred = false;
    beginContextMetricSession();
    try {
      if (getDeferContextBasePass() && !interactive) {
        deferred = true;
        const snapshot = resolveContextBaseDeferredSnapshot();
        collectContextMetric("drawPhysicalContourLayer", 0, {
          featureCount: 0,
          majorFeatureCount: 0,
          minorFeatureCount: 0,
          interactive: false,
          skipped: true,
          reason: "staged-apply",
          maskSource: snapshot.maskInfo.maskSource,
          maskFeatureCount: snapshot.maskInfo.maskFeatureCount,
          maskArcRefEstimate: snapshot.maskInfo.maskArcRefEstimate,
        });
        collectContextMetric(
          "drawUrbanLayer",
          0,
          createDeferredMetricPayload(snapshot.urbanFeatureCount),
        );
        collectContextMetric(
          "drawAirportsLayer",
          0,
          createDeferredMetricPayload(snapshot.airportFeatureCount),
        );
        collectContextMetric(
          "drawRoadsLayer",
          0,
          createDeferredMetricPayload(snapshot.roadFeatureCount),
        );
        collectContextMetric(
          "drawRailwaysLayer",
          0,
          createDeferredMetricPayload(snapshot.railwayFeatureCount),
        );
        collectContextMetric(
          "drawPortsLayer",
          0,
          createDeferredMetricPayload(snapshot.portFeatureCount),
        );
        recordDeferredRiversLayerMetric({ interactive: false, reason: "staged-apply" });
      } else {
        drawPhysicalContourLayer(k, { interactive });
        drawUrbanLayer(k, { interactive });
        drawRiversLayer(k, { interactive });
      }
    } finally {
      endContextMetricSession();
    }
    recordRenderPerfMetric("drawContextBasePass", nowMs() - startedAt, {
      interactive: !!interactive,
      deferred,
    });
  }

  function drawContextMarkersPass(k, { interactive = false } = {}) {
    const startedAt = nowMs();
    let deferred = false;
    beginContextMetricSession();
    try {
      if (getDeferContextBasePass() && !interactive) {
        deferred = true;
        const snapshot = resolveContextMarkersDeferredSnapshot();
        collectContextMetric(
          "drawCityPointsLayer",
          0,
          createDeferredMetricPayload(snapshot.cityFeatureCount),
        );
        collectContextMetric(
          "drawStrategicResourceMarkersLayer",
          0,
          createDeferredMetricPayload(snapshot.strategicResourceFeatureCount),
        );
        collectContextMetric(
          "drawAirportsLayer",
          0,
          createDeferredMetricPayload(snapshot.airportFeatureCount),
        );
        collectContextMetric(
          "drawPortsLayer",
          0,
          createDeferredMetricPayload(snapshot.portFeatureCount),
        );
        collectContextMetric(
          "drawRoadsLayer",
          0,
          createDeferredMetricPayload(snapshot.roadFeatureCount),
        );
        collectContextMetric(
          "drawRailwaysLayer",
          0,
          createDeferredMetricPayload(snapshot.railwayFeatureCount),
        );
      } else {
        drawRoadsLayer(k, { interactive });
        drawRailwaysLayer(k, { interactive });
        drawAirportsLayer(k, { interactive });
        drawPortsLayer(k, { interactive });
        drawStrategicResourceMarkersLayer(k, { interactive });
        if (interactive) drawCityPointsLayer(k, { interactive: true });
      }
    } finally {
      endContextMetricSession();
    }
    recordRenderPerfMetric("drawContextMarkersPass", nowMs() - startedAt, {
      interactive: !!interactive,
      deferred,
    });
  }

  function drawContextScenarioPass(k, { interactive = false } = {}) {
    const startedAt = nowMs();
    beginContextMetricSession();
    try {
      drawScenarioRegionOverlaysPass(k);
      drawScenarioReliefOverlaysPass(k);
      // Scenario urban supplements sit on land this pass paints over contextBase.
      drawUrbanLayer(k, { interactive, scope: "scenario-overlay" });
    } finally {
      endContextMetricSession();
    }
    recordRenderPerfMetric("drawContextScenarioPass", nowMs() - startedAt, {
      interactive: !!interactive,
    });
  }

  return Object.freeze({
    drawContextBasePass,
    drawContextMarkersPass,
    drawContextScenarioPass,
  });
}
