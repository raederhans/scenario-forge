import assert from "node:assert/strict";
import test from "node:test";

import { createContextPassOrchestratorOwner } from "../js/core/renderer/context_pass_orchestrator_owner.js";

const BASE_SNAPSHOT = Object.freeze({
  maskInfo: Object.freeze({
    maskSource: "land-mask",
    maskFeatureCount: 7,
    maskArcRefEstimate: 11,
  }),
  urbanFeatureCount: 13,
  airportFeatureCount: 17,
  roadFeatureCount: 19,
  railwayFeatureCount: 23,
  portFeatureCount: 29,
});

const MARKERS_SNAPSHOT = Object.freeze({
  cityFeatureCount: 31,
  strategicResourceFeatureCount: 37,
  airportFeatureCount: 41,
  portFeatureCount: 43,
  roadFeatureCount: 47,
  railwayFeatureCount: 53,
});

const DEPENDENCY_NAMES = Object.freeze({
  getters: Object.freeze([
    "getDeferContextBasePass",
  ]),
  resolvers: Object.freeze([
    "resolveContextBaseDeferredSnapshot",
    "resolveContextMarkersDeferredSnapshot",
  ]),
  helpers: Object.freeze(["nowMs"]),
  effects: Object.freeze([
    "beginContextMetricSession",
    "endContextMetricSession",
    "collectContextMetric",
    "recordRenderPerfMetric",
    "recordDeferredRiversLayerMetric",
    "drawPhysicalContourLayer",
    "drawUrbanLayer",
    "drawRiversLayer",
    "drawRoadsLayer",
    "drawRailwaysLayer",
    "drawAirportsLayer",
    "drawPortsLayer",
    "drawStrategicResourceMarkersLayer",
    "drawCityPointsLayer",
    "drawScenarioRegionOverlaysPass",
    "drawScenarioReliefOverlaysPass",
  ]),
});

function createHarness({
  defer = false,
  overrides = {},
} = {}) {
  const events = [];
  const nowValues = [100, 112, 124, 136];
  let nowIndex = 0;
  const dependencies = {
    getters: {
      getDeferContextBasePass: () => {
        events.push("get-defer");
        return defer;
      },
    },
    resolvers: {
      resolveContextBaseDeferredSnapshot: () => {
        events.push("resolve-base");
        return BASE_SNAPSHOT;
      },
      resolveContextMarkersDeferredSnapshot: () => {
        events.push("resolve-markers");
        return MARKERS_SNAPSHOT;
      },
    },
    helpers: {
      nowMs: () => {
        events.push("now");
        return nowValues[nowIndex++];
      },
    },
    effects: {
      beginContextMetricSession: () => events.push("begin-session"),
      endContextMetricSession: () => events.push("end-session"),
      collectContextMetric: (...args) => events.push(["context-metric", ...args]),
      recordRenderPerfMetric: (...args) => events.push(["perf-metric", ...args]),
      recordDeferredRiversLayerMetric: (...args) => events.push(["deferred-rivers", ...args]),
      drawPhysicalContourLayer: (...args) => events.push(["physical", ...args]),
      drawUrbanLayer: (...args) => events.push(["urban", ...args]),
      drawRiversLayer: (...args) => events.push(["rivers", ...args]),
      drawRoadsLayer: (...args) => events.push(["roads", ...args]),
      drawRailwaysLayer: (...args) => events.push(["railways", ...args]),
      drawAirportsLayer: (...args) => events.push(["airports", ...args]),
      drawPortsLayer: (...args) => events.push(["ports", ...args]),
      drawStrategicResourceMarkersLayer: (...args) => events.push(["strategic", ...args]),
      drawCityPointsLayer: (...args) => events.push(["city", ...args]),
      drawScenarioRegionOverlaysPass: (...args) => events.push(["scenario-region", ...args]),
      drawScenarioReliefOverlaysPass: (...args) => events.push(["scenario-relief", ...args]),
    },
  };
  for (const [groupName, values] of Object.entries(overrides)) {
    Object.assign(dependencies[groupName], values);
  }
  const owner = createContextPassOrchestratorOwner(dependencies);
  return { dependencies, events, owner };
}

test("factory validates every dependency and freezes the exact public API", () => {
  for (const [groupName, names] of Object.entries(DEPENDENCY_NAMES)) {
    for (const missingName of names) {
      const dependencies = Object.fromEntries(
        Object.entries(DEPENDENCY_NAMES).map(([name, groupNames]) => [
          name,
          Object.fromEntries(groupNames.map((dependencyName) => [dependencyName, () => {}])),
        ]),
      );
      delete dependencies[groupName][missingName];
      assert.throws(
        () => createContextPassOrchestratorOwner(dependencies),
        new RegExp(`${groupName}\\.${missingName} must be a function`),
      );
    }
  }

  const { owner } = createHarness();
  assert.equal(Object.isFrozen(owner), true);
  assert.deepEqual(Object.keys(owner), [
    "drawContextBasePass",
    "drawContextMarkersPass",
    "drawContextScenarioPass",
  ]);
});

test("context base deferred path preserves metric order and payloads", () => {
  const { events, owner } = createHarness({ defer: true });
  owner.drawContextBasePass(3);
  assert.deepEqual(events, [
    "now",
    "begin-session",
    "get-defer",
    "resolve-base",
    ["context-metric", "drawPhysicalContourLayer", 0, {
      featureCount: 0,
      majorFeatureCount: 0,
      minorFeatureCount: 0,
      interactive: false,
      skipped: true,
      reason: "staged-apply",
      maskSource: "land-mask",
      maskFeatureCount: 7,
      maskArcRefEstimate: 11,
    }],
    ["context-metric", "drawUrbanLayer", 0, {
      featureCount: 13,
      interactive: false,
      skipped: true,
      reason: "staged-apply",
    }],
    ["context-metric", "drawAirportsLayer", 0, {
      featureCount: 17,
      interactive: false,
      skipped: true,
      reason: "staged-apply",
    }],
    ["context-metric", "drawRoadsLayer", 0, {
      featureCount: 19,
      interactive: false,
      skipped: true,
      reason: "staged-apply",
    }],
    ["context-metric", "drawRailwaysLayer", 0, {
      featureCount: 23,
      interactive: false,
      skipped: true,
      reason: "staged-apply",
    }],
    ["context-metric", "drawPortsLayer", 0, {
      featureCount: 29,
      interactive: false,
      skipped: true,
      reason: "staged-apply",
    }],
    ["deferred-rivers", { interactive: false, reason: "staged-apply" }],
    "end-session",
    "now",
    ["perf-metric", "drawContextBasePass", 12, {
      interactive: false,
      deferred: true,
    }],
  ]);
});

test("context base normal path preserves draw order and keeps snapshots lazy", () => {
  for (const interactive of [false, true]) {
    const { events, owner } = createHarness({ defer: interactive });
    owner.drawContextBasePass(5, { interactive });
    assert.deepEqual(events, [
      "now",
      "begin-session",
      "get-defer",
      ["physical", 5, { interactive }],
      ["urban", 5, { interactive }],
      ["rivers", 5, { interactive }],
      "end-session",
      "now",
      ["perf-metric", "drawContextBasePass", 12, {
        interactive,
        deferred: false,
      }],
    ]);
  }
});

test("context markers deferred path preserves exact metric order and payloads", () => {
  const { events, owner } = createHarness({ defer: true });
  owner.drawContextMarkersPass(7);
  assert.deepEqual(events, [
    "now",
    "begin-session",
    "get-defer",
    "resolve-markers",
    ["context-metric", "drawCityPointsLayer", 0, {
      featureCount: 31,
      interactive: false,
      skipped: true,
      reason: "staged-apply",
    }],
    ["context-metric", "drawStrategicResourceMarkersLayer", 0, {
      featureCount: 37,
      interactive: false,
      skipped: true,
      reason: "staged-apply",
    }],
    ["context-metric", "drawAirportsLayer", 0, {
      featureCount: 41,
      interactive: false,
      skipped: true,
      reason: "staged-apply",
    }],
    ["context-metric", "drawPortsLayer", 0, {
      featureCount: 43,
      interactive: false,
      skipped: true,
      reason: "staged-apply",
    }],
    ["context-metric", "drawRoadsLayer", 0, {
      featureCount: 47,
      interactive: false,
      skipped: true,
      reason: "staged-apply",
    }],
    ["context-metric", "drawRailwaysLayer", 0, {
      featureCount: 53,
      interactive: false,
      skipped: true,
      reason: "staged-apply",
    }],
    "end-session",
    "now",
    ["perf-metric", "drawContextMarkersPass", 12, {
      interactive: false,
      deferred: true,
    }],
  ]);
});

test("context markers preserve normal layer order and draw city points only interactively", () => {
  for (const interactive of [false, true]) {
    const { events, owner } = createHarness({ defer: interactive });
    owner.drawContextMarkersPass(11, { interactive });
    const expectedLayers = [
      ["roads", 11, { interactive }],
      ["railways", 11, { interactive }],
      ["airports", 11, { interactive }],
      ["ports", 11, { interactive }],
      ["strategic", 11, { interactive }],
      ...(interactive ? [["city", 11, { interactive: true }]] : []),
    ];
    assert.deepEqual(events, [
      "now",
      "begin-session",
      "get-defer",
      ...expectedLayers,
      "end-session",
      "now",
      ["perf-metric", "drawContextMarkersPass", 12, {
        interactive,
        deferred: false,
      }],
    ]);
  }
});

test("context scenario preserves region then relief order and final timing", () => {
  const { events, owner } = createHarness();
  owner.drawContextScenarioPass(13, { interactive: true });
  assert.deepEqual(events, [
    "now",
    "begin-session",
    ["scenario-region", 13],
    ["scenario-relief", 13],
    "end-session",
    "now",
    ["perf-metric", "drawContextScenarioPass", 12, { interactive: true }],
  ]);
});

test("session cleanup preserves original error propagation and omits final timing", () => {
  const drawError = new Error("draw failed");
  const drawHarness = createHarness({
    overrides: {
      effects: {
        drawUrbanLayer: () => {
          drawHarness.events.push("urban-throws");
          throw drawError;
        },
      },
    },
  });
  assert.throws(() => drawHarness.owner.drawContextBasePass(1), drawError);
  assert.deepEqual(drawHarness.events, [
    "now",
    "begin-session",
    "get-defer",
    ["physical", 1, { interactive: false }],
    "urban-throws",
    "end-session",
  ]);

  const beginError = new Error("begin failed");
  const beginHarness = createHarness({
    overrides: {
      effects: {
        beginContextMetricSession: () => {
          beginHarness.events.push("begin-throws");
          throw beginError;
        },
      },
    },
  });
  assert.throws(() => beginHarness.owner.drawContextScenarioPass(1), beginError);
  assert.deepEqual(beginHarness.events, ["now", "begin-throws"]);

  const endError = new Error("end failed");
  const endHarness = createHarness({
    overrides: {
      effects: {
        endContextMetricSession: () => {
          endHarness.events.push("end-throws");
          throw endError;
        },
      },
    },
  });
  assert.throws(() => endHarness.owner.drawContextScenarioPass(1), endError);
  assert.deepEqual(endHarness.events, [
    "now",
    "begin-session",
    ["scenario-region", 1],
    ["scenario-relief", 1],
    "end-throws",
  ]);
});

test("marker and scenario effect failures close their sessions at the exact failure boundary", () => {
  const markerError = new Error("markers failed");
  const markerHarness = createHarness({
    overrides: {
      effects: {
        drawRailwaysLayer: () => {
          markerHarness.events.push("railways-throws");
          throw markerError;
        },
      },
    },
  });
  assert.throws(() => markerHarness.owner.drawContextMarkersPass(2), markerError);
  assert.deepEqual(markerHarness.events, [
    "now",
    "begin-session",
    "get-defer",
    ["roads", 2, { interactive: false }],
    "railways-throws",
    "end-session",
  ]);

  const regionError = new Error("region failed");
  const regionHarness = createHarness({
    overrides: {
      effects: {
        drawScenarioRegionOverlaysPass: () => {
          regionHarness.events.push("region-throws");
          throw regionError;
        },
      },
    },
  });
  assert.throws(() => regionHarness.owner.drawContextScenarioPass(3), regionError);
  assert.deepEqual(regionHarness.events, [
    "now",
    "begin-session",
    "region-throws",
    "end-session",
  ]);

  const reliefError = new Error("relief failed");
  const reliefHarness = createHarness({
    overrides: {
      effects: {
        drawScenarioReliefOverlaysPass: () => {
          reliefHarness.events.push("relief-throws");
          throw reliefError;
        },
      },
    },
  });
  assert.throws(() => reliefHarness.owner.drawContextScenarioPass(4), reliefError);
  assert.deepEqual(reliefHarness.events, [
    "now",
    "begin-session",
    ["scenario-region", 4],
    "relief-throws",
    "end-session",
  ]);
});

test("null options throw before dependencies while omitted options preserve false defaults", () => {
  for (const methodName of [
    "drawContextBasePass",
    "drawContextMarkersPass",
    "drawContextScenarioPass",
  ]) {
    const harness = createHarness();
    assert.throws(() => harness.owner[methodName](1, null), TypeError);
    assert.deepEqual(harness.events, []);
  }

  const omitted = createHarness();
  omitted.owner.drawContextScenarioPass(1);
  assert.deepEqual(omitted.events.at(-1), [
    "perf-metric",
    "drawContextScenarioPass",
    12,
    { interactive: false },
  ]);
});
