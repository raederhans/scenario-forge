function requireFunction(candidate, label) {
  if (typeof candidate !== "function") {
    throw new TypeError(`${label} must be a function.`);
  }
  return candidate;
}

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
  const getDeferContextBasePass = requireFunction(
    getters.getDeferContextBasePass,
    "getters.getDeferContextBasePass",
  );
  const resolveContextBaseDeferredSnapshot = requireFunction(
    resolvers.resolveContextBaseDeferredSnapshot,
    "resolvers.resolveContextBaseDeferredSnapshot",
  );
  const resolveContextMarkersDeferredSnapshot = requireFunction(
    resolvers.resolveContextMarkersDeferredSnapshot,
    "resolvers.resolveContextMarkersDeferredSnapshot",
  );
  const nowMs = requireFunction(helpers.nowMs, "helpers.nowMs");
  const beginContextMetricSession = requireFunction(
    effects.beginContextMetricSession,
    "effects.beginContextMetricSession",
  );
  const endContextMetricSession = requireFunction(
    effects.endContextMetricSession,
    "effects.endContextMetricSession",
  );
  const collectContextMetric = requireFunction(
    effects.collectContextMetric,
    "effects.collectContextMetric",
  );
  const recordRenderPerfMetric = requireFunction(
    effects.recordRenderPerfMetric,
    "effects.recordRenderPerfMetric",
  );
  const recordDeferredRiversLayerMetric = requireFunction(
    effects.recordDeferredRiversLayerMetric,
    "effects.recordDeferredRiversLayerMetric",
  );
  const drawPhysicalContourLayer = requireFunction(
    effects.drawPhysicalContourLayer,
    "effects.drawPhysicalContourLayer",
  );
  const drawUrbanLayer = requireFunction(effects.drawUrbanLayer, "effects.drawUrbanLayer");
  const drawRiversLayer = requireFunction(effects.drawRiversLayer, "effects.drawRiversLayer");
  const drawRoadsLayer = requireFunction(effects.drawRoadsLayer, "effects.drawRoadsLayer");
  const drawRailwaysLayer = requireFunction(
    effects.drawRailwaysLayer,
    "effects.drawRailwaysLayer",
  );
  const drawAirportsLayer = requireFunction(
    effects.drawAirportsLayer,
    "effects.drawAirportsLayer",
  );
  const drawPortsLayer = requireFunction(effects.drawPortsLayer, "effects.drawPortsLayer");
  const drawStrategicResourceMarkersLayer = requireFunction(
    effects.drawStrategicResourceMarkersLayer,
    "effects.drawStrategicResourceMarkersLayer",
  );
  const drawCityPointsLayer = requireFunction(
    effects.drawCityPointsLayer,
    "effects.drawCityPointsLayer",
  );
  const drawScenarioRegionOverlaysPass = requireFunction(
    effects.drawScenarioRegionOverlaysPass,
    "effects.drawScenarioRegionOverlaysPass",
  );
  const drawScenarioReliefOverlaysPass = requireFunction(
    effects.drawScenarioReliefOverlaysPass,
    "effects.drawScenarioReliefOverlaysPass",
  );

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
