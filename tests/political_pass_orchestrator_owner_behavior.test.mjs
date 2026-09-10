import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createPoliticalPassOrchestratorOwner } from "../js/core/renderer/political_pass_orchestrator_owner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OWNER_PATH = path.resolve(__dirname, "../js/core/renderer/political_pass_orchestrator_owner.js");

const SCENE_IDENTITY = Object.freeze({
  sceneGeneration: 7,
  scenarioDataGeneration: 11,
  fullPoliticalReady: true,
});
const WORKER_IDENTITY = Object.freeze({ requestId: "worker-17" });
const IDENTITY_CAPSULE = Object.freeze({
  k: 3,
  transform: Object.freeze({ x: 5, y: 7, k: 3 }),
  canvasWidth: 100,
  canvasHeight: 80,
  dpr: 2,
  sceneIdentity: SCENE_IDENTITY,
  workerIdentity: WORKER_IDENTITY,
});
const VISIBLE_ITEMS_CAPSULE = Object.freeze({ token: "visible-items-frame-17" });
const VIEWPORT_CAPSULE = Object.freeze({
  overscanPx: 24,
  screenRects: Object.freeze([
    Object.freeze({ minX: -24, minY: -24, maxX: 124, maxY: 104 }),
  ]),
  visibleItems: VISIBLE_ITEMS_CAPSULE,
  visibleItemCount: 4,
  visibleStats: Object.freeze({ visitedBuckets: 9, candidateCount: 6 }),
});

const DEFAULT_BACKGROUND = Object.freeze({
  groupCount: 2,
  entryCount: 4,
  reusedPathCount: 3,
  builtPathCount: 1,
  pathlessEntryCount: 0,
  cacheHit: true,
  recoveryQuality: "fine",
  progressive: false,
  deferredFullCacheReady: true,
  deferredFullCacheScheduled: false,
  coarseUnderlay: "",
});

const DEPENDENCY_NAMES = Object.freeze({
  getters: Object.freeze([
    "isHgoRuntimePreviewReady",
    "isRenderDiagnosticsEnabled",
    "hasPoliticalLandFeatures",
    "isPoliticalRasterWorkerBitmapEnabled",
    "hasPendingPoliticalColorEdit",
  ]),
  resolvers: Object.freeze([
    "resolvePoliticalPassIdentity",
    "resolvePoliticalPassViewport",
    "hasVisiblePoliticalForegroundColorOverride",
  ]),
  helpers: Object.freeze([
    "nowMs",
    "createPoliticalPassDrawResult",
  ]),
  effects: Object.freeze([
    "recordRenderPerfMetric",
    "resolvePoliticalRecoveryQuality",
    "recordPoliticalRasterWorkerSnapshot",
    "publishPoliticalPassDiagnostics",
    "consumePoliticalRasterWorkerBitmapResult",
    "drawPoliticalWorkerBitmapResult",
    "drawPoliticalBackgroundFills",
    "buildPoliticalRasterWorkerPacket",
    "requestPoliticalRasterWorkerPass",
    "drawPoliticalFineFeatureLoop",
    "clearPendingPoliticalColorEdit",
  ]),
});

function createPoliticalResult(sceneIdentity, {
  committed = true,
  reason = "",
  politicalDataStage = "unknown",
  fullPoliticalReady = null,
  finePoliticalCacheReady = false,
  coarseUnderlay = "",
} = {}) {
  const stage = String(politicalDataStage || "unknown");
  return {
    committed,
    reason: String(reason || ""),
    sceneGeneration: Number(sceneIdentity?.sceneGeneration || 0),
    scenarioDataGeneration: Number(sceneIdentity?.scenarioDataGeneration || 0),
    politicalDataStage: stage,
    fullPoliticalReady: fullPoliticalReady === null
      ? !!sceneIdentity?.fullPoliticalReady
      : !!fullPoliticalReady,
    finePoliticalCacheReady: stage === "fine" && !!finePoliticalCacheReady,
    coarseUnderlay: String(coarseUnderlay || ""),
  };
}

function eventName(event) {
  return Array.isArray(event) ? event[0] : event;
}

function createHarness({
  hgoReady = false,
  diagnosticsEnabled = true,
  hasLand = true,
  workerEnabled = true,
  pendingEdit = false,
  foregroundOverride = false,
  bitmapResult = null,
  bitmapDrawn = false,
  backgroundSummary = DEFAULT_BACKGROUND,
  identityCapsule = IDENTITY_CAPSULE,
  viewportCapsule = VIEWPORT_CAPSULE,
  fineMetrics = null,
  overrides = {},
} = {}) {
  const events = [];
  const renderedIds = new Set(["a", "b"]);
  const resolvedFineMetrics = fineMetrics || {
    fillMs: 5,
    strokeMs: 7,
    renderedCount: 2,
    renderedIds,
  };
  const nowValues = [100, 112, 124];
  let nowIndex = 0;
  const dependencies = {
    getters: {
      isHgoRuntimePreviewReady: () => {
        events.push("hgo-ready");
        return hgoReady;
      },
      isRenderDiagnosticsEnabled: () => {
        events.push("diagnostics-enabled");
        return diagnosticsEnabled;
      },
      hasPoliticalLandFeatures: () => {
        events.push("has-land");
        return hasLand;
      },
      isPoliticalRasterWorkerBitmapEnabled: () => {
        events.push("worker-enabled");
        return workerEnabled;
      },
      hasPendingPoliticalColorEdit: () => {
        events.push("pending-edit");
        return pendingEdit;
      },
    },
    resolvers: {
      resolvePoliticalPassIdentity: (k) => {
        events.push(["resolve-identity", k]);
        return identityCapsule;
      },
      resolvePoliticalPassViewport: (identity) => {
        events.push(["resolve-viewport", identity]);
        return viewportCapsule;
      },
      hasVisiblePoliticalForegroundColorOverride: (visibleItems) => {
        events.push(["foreground-override", visibleItems]);
        return foregroundOverride;
      },
    },
    helpers: {
      nowMs: () => {
        events.push("now");
        return nowValues[nowIndex++];
      },
      createPoliticalPassDrawResult: (sceneIdentity, details) => {
        events.push(["result", sceneIdentity, details]);
        return createPoliticalResult(sceneIdentity, details);
      },
    },
    effects: {
      recordRenderPerfMetric: (...args) => events.push(["metric", ...args]),
      resolvePoliticalRecoveryQuality: () => {
        events.push("recovery-quality");
        return "fallback-quality";
      },
      recordPoliticalRasterWorkerSnapshot: () => events.push("worker-snapshot"),
      publishPoliticalPassDiagnostics: (payload) => events.push(["diagnostics", payload]),
      consumePoliticalRasterWorkerBitmapResult: (identity) => {
        events.push(["consume-bitmap", identity]);
        return bitmapResult;
      },
      drawPoliticalWorkerBitmapResult: (result, identity) => {
        events.push(["draw-bitmap", result, identity]);
        return bitmapDrawn;
      },
      drawPoliticalBackgroundFills: (payload) => {
        events.push(["background", payload]);
        return backgroundSummary;
      },
      buildPoliticalRasterWorkerPacket: (payload) => {
        events.push(["build-packet", payload]);
        return {
          packet: Object.freeze({ canvasPxWidth: 200, canvasPxHeight: 160, entries: Object.freeze([1, 2]) }),
          packetBuildMs: 4,
          reason: "built",
        };
      },
      requestPoliticalRasterWorkerPass: (payload) => events.push(["request-worker", payload]),
      drawPoliticalFineFeatureLoop: (payload) => {
        events.push(["fine-loop", payload]);
        return resolvedFineMetrics;
      },
      clearPendingPoliticalColorEdit: (payload) => events.push(["clear-pending", payload]),
    },
  };
  for (const [groupName, values] of Object.entries(overrides)) {
    Object.assign(dependencies[groupName], values);
  }
  const owner = createPoliticalPassOrchestratorOwner(dependencies);
  return { dependencies, events, owner, renderedIds };
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
        () => createPoliticalPassOrchestratorOwner(dependencies),
        new RegExp(`${groupName}\\.${missingName} must be a function`),
      );
    }
  }

  const { owner } = createHarness();
  assert.equal(Object.isFrozen(owner), true);
  assert.deepEqual(Object.keys(owner), ["drawPoliticalPass"]);
});

test("HGO skip records the exact metric and returns before frame resolution", () => {
  const { events, owner } = createHarness({ hgoReady: true });
  assert.equal(owner.drawPoliticalPass(2), undefined);
  assert.deepEqual(events, [
    "hgo-ready",
    ["metric", "drawPoliticalPass", 0, {
      skipped: true,
      reason: "hgo-runtime-preview",
    }],
  ]);
});

test("worker bitmap success short-circuits before background and preserves snapshot order", () => {
  const bitmap = Object.freeze({ bitmapId: "accepted-17" });
  const { events, owner } = createHarness({ bitmapResult: bitmap, bitmapDrawn: true });
  const result = owner.drawPoliticalPass(3);
  assert.deepEqual(events.map(eventName), [
    "hgo-ready",
    "resolve-identity",
    "worker-snapshot",
    "resolve-viewport",
    "metric",
    "diagnostics-enabled",
    "diagnostics",
    "consume-bitmap",
    "draw-bitmap",
    "worker-snapshot",
    "result",
  ]);
  assert.deepEqual(events[4], ["metric", "politicalPassVisibleItems", 0, {
    visibleItemCount: 4,
    visitedBuckets: 9,
    candidateCount: 6,
  }]);
  assert.equal(events[6][1].identity, IDENTITY_CAPSULE);
  assert.equal(events[6][1].viewport, VIEWPORT_CAPSULE);
  assert.deepEqual(result, {
    committed: true,
    reason: "political-raster-worker-bitmap",
    sceneGeneration: 7,
    scenarioDataGeneration: 11,
    politicalDataStage: "fine",
    fullPoliticalReady: true,
    finePoliticalCacheReady: true,
    coarseUnderlay: "",
  });
});

test("rejected bitmap continues through background before the missing-land result", () => {
  const bitmap = Object.freeze({ bitmapId: "rejected-17" });
  const { events, owner } = createHarness({
    bitmapResult: bitmap,
    bitmapDrawn: false,
    hasLand: false,
  });
  const result = owner.drawPoliticalPass(3);
  assert.deepEqual(events.map(eventName), [
    "hgo-ready",
    "resolve-identity",
    "worker-snapshot",
    "resolve-viewport",
    "metric",
    "diagnostics-enabled",
    "diagnostics",
    "consume-bitmap",
    "draw-bitmap",
    "now",
    "background",
    "now",
    "metric",
    "has-land",
    "result",
  ]);
  assert.equal(events.some((event) => eventName(event) === "request-worker"), false);
  assert.deepEqual(result, {
    committed: true,
    reason: "missing-land-data",
    sceneGeneration: 7,
    scenarioDataGeneration: 11,
    politicalDataStage: "not-ready",
    fullPoliticalReady: false,
    finePoliticalCacheReady: false,
    coarseUnderlay: "",
  });
});

test("worker enabled and disabled paths preserve packet construction and request semantics", () => {
  const enabled = createHarness();
  enabled.owner.drawPoliticalPass(3);
  const enabledBuild = enabled.events.find((event) => eventName(event) === "build-packet");
  const enabledRequest = enabled.events.find((event) => eventName(event) === "request-worker");
  assert.equal(enabledBuild[1].identity, IDENTITY_CAPSULE);
  assert.equal(enabledBuild[1].viewport, VIEWPORT_CAPSULE);
  assert.equal(enabledRequest[1].identity, IDENTITY_CAPSULE);
  assert.equal(enabledRequest[1].viewport, VIEWPORT_CAPSULE);
  assert.equal(enabledRequest[1].packetState.reason, "built");

  const disabled = createHarness({ workerEnabled: false });
  disabled.owner.drawPoliticalPass(3);
  assert.equal(disabled.events.some((event) => eventName(event) === "build-packet"), false);
  const disabledRequest = disabled.events.find((event) => eventName(event) === "request-worker");
  assert.deepEqual(disabledRequest[1].packetState, {
    packet: null,
    packetBuildMs: 0,
    reason: "bitmap-flag-disabled",
  });
  assert.equal(disabled.events.filter((event) => eventName(event) === "worker-snapshot").length, 2);
});

test("progressive coarse admission stays exact and keeps the foreground check lazy", () => {
  const progressive = {
    ...DEFAULT_BACKGROUND,
    recoveryQuality: "progressive",
    progressive: true,
    deferredFullCacheReady: false,
    coarseUnderlay: "admin0",
  };
  const accepted = createHarness({ backgroundSummary: progressive });
  const result = accepted.owner.drawPoliticalPass(3);
  assert.equal(accepted.events.some((event) => eventName(event) === "foreground-override"), true);
  assert.equal(accepted.events.some((event) => eventName(event) === "fine-loop"), false);
  const coarseMetrics = accepted.events.filter(
    (event) => eventName(event) === "metric" && String(event[1]).startsWith("drawPoliticalFeature"),
  );
  assert.deepEqual(coarseMetrics.map((event) => event[1]), [
    "drawPoliticalFeatureFillLoop",
    "drawPoliticalFeatureStrokeLoop",
  ]);
  assert.deepEqual(result, {
    committed: true,
    reason: "progressive-coarse-underlay",
    sceneGeneration: 7,
    scenarioDataGeneration: 11,
    politicalDataStage: "coarse",
    fullPoliticalReady: true,
    finePoliticalCacheReady: false,
    coarseUnderlay: "admin0",
  });

  for (const options of [
    { backgroundSummary: { ...progressive, progressive: false } },
    { backgroundSummary: { ...progressive, deferredFullCacheReady: true } },
    { backgroundSummary: { ...progressive, coarseUnderlay: "other" } },
    { backgroundSummary: { ...progressive, coarseUnderlay: "scenario-features" } },
    { backgroundSummary: progressive, pendingEdit: true },
  ]) {
    const harness = createHarness(options);
    harness.owner.drawPoliticalPass(3);
    assert.equal(harness.events.some((event) => eventName(event) === "foreground-override"), false);
    assert.equal(harness.events.some((event) => eventName(event) === "fine-loop"), true);
  }

  const foreground = createHarness({ backgroundSummary: progressive, foregroundOverride: true });
  foreground.owner.drawPoliticalPass(3);
  assert.equal(foreground.events.some((event) => eventName(event) === "foreground-override"), true);
  assert.equal(foreground.events.some((event) => eventName(event) === "fine-loop"), true);
});

test("fine loop preserves metric, pending-clear, Set identity, and result order", () => {
  const { events, owner, renderedIds } = createHarness();
  const result = owner.drawPoliticalPass(3);
  const fineStart = events.findIndex((event) => eventName(event) === "fine-loop");
  assert.deepEqual(events.slice(fineStart).map(eventName), [
    "fine-loop",
    "metric",
    "metric",
    "clear-pending",
    "result",
  ]);
  assert.deepEqual(events[fineStart + 1], ["metric", "drawPoliticalFeatureFillLoop", 5, {
    renderedCount: 2,
    visibleItemCount: 4,
  }]);
  assert.deepEqual(events[fineStart + 2], ["metric", "drawPoliticalFeatureStrokeLoop", 7, {
    renderedCount: 2,
    visibleItemCount: 4,
  }]);
  assert.equal(events[fineStart + 3][1].renderedIds, renderedIds);
  assert.deepEqual(events[fineStart + 3][1], {
    renderedCount: 2,
    renderedIds,
    paintSource: "political-pass",
  });
  assert.deepEqual(result, {
    committed: true,
    reason: "fine-feature-loop",
    sceneGeneration: 7,
    scenarioDataGeneration: 11,
    politicalDataStage: "fine",
    fullPoliticalReady: true,
    finePoliticalCacheReady: true,
    coarseUnderlay: "",
  });

  const noVisibleItems = createHarness({
    viewportCapsule: Object.freeze({
      ...VIEWPORT_CAPSULE,
      visibleItems: null,
      visibleItemCount: null,
      visibleStats: null,
    }),
    diagnosticsEnabled: false,
  });
  noVisibleItems.owner.drawPoliticalPass(3);
  assert.equal(noVisibleItems.events.some((event) => eventName(event) === "diagnostics"), false);
  assert.equal(noVisibleItems.events.some(
    (event) => eventName(event) === "metric" && event[1] === "politicalPassVisibleItems",
  ), false);
  const noVisibleFine = noVisibleItems.events.find((event) => eventName(event) === "fine-loop");
  assert.equal(noVisibleFine[1].viewport.visibleItems, null);
});

test("dependency failures propagate at the original boundary and stop later effects", () => {
  const backgroundError = new Error("background failed");
  const background = createHarness({
    overrides: {
      effects: {
        drawPoliticalBackgroundFills: () => {
          background.events.push("background-throws");
          throw backgroundError;
        },
      },
    },
  });
  assert.throws(() => background.owner.drawPoliticalPass(3), backgroundError);
  assert.equal(background.events.some((event) => eventName(event) === "has-land"), false);

  const requestError = new Error("request failed");
  const request = createHarness({
    overrides: {
      effects: {
        requestPoliticalRasterWorkerPass: () => {
          request.events.push("request-throws");
          throw requestError;
        },
      },
    },
  });
  assert.throws(() => request.owner.drawPoliticalPass(3), requestError);
  assert.equal(request.events.filter((event) => eventName(event) === "worker-snapshot").length, 1);
  assert.equal(request.events.some((event) => eventName(event) === "pending-edit"), false);

  const fineError = new Error("fine failed");
  const fine = createHarness({
    overrides: {
      effects: {
        drawPoliticalFineFeatureLoop: () => {
          fine.events.push("fine-throws");
          throw fineError;
        },
      },
    },
  });
  assert.throws(() => fine.owner.drawPoliticalPass(3), fineError);
  assert.equal(fine.events.some((event) => eventName(event) === "clear-pending"), false);
  assert.equal(fine.events.some((event) => eventName(event) === "result"), false);

  const metricError = new Error("fill metric failed");
  const metric = createHarness({
    overrides: {
      effects: {
        recordRenderPerfMetric: (name, ...args) => {
          metric.events.push(["metric", name, ...args]);
          if (name === "drawPoliticalFeatureFillLoop") throw metricError;
        },
      },
    },
  });
  assert.throws(() => metric.owner.drawPoliticalPass(3), metricError);
  assert.equal(metric.events.some(
    (event) => eventName(event) === "metric" && event[1] === "drawPoliticalFeatureStrokeLoop",
  ), false);
  assert.equal(metric.events.some((event) => eventName(event) === "clear-pending"), false);
});

test("all committed results keep the exact key order and JSON-safe schema", () => {
  const cases = [
    createHarness({ bitmapResult: Object.freeze({ id: 1 }), bitmapDrawn: true }),
    createHarness({ hasLand: false }),
    createHarness({
      backgroundSummary: {
        ...DEFAULT_BACKGROUND,
        recoveryQuality: "progressive",
        progressive: true,
        deferredFullCacheReady: false,
        coarseUnderlay: "admin0",
      },
    }),
    createHarness(),
  ];
  for (const harness of cases) {
    const result = harness.owner.drawPoliticalPass(3);
    assert.deepEqual(Object.keys(result), [
      "committed",
      "reason",
      "sceneGeneration",
      "scenarioDataGeneration",
      "politicalDataStage",
      "fullPoliticalReady",
      "finePoliticalCacheReady",
      "coarseUnderlay",
    ]);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  }
});

test("owner source stays import-free and excludes renderer state, DOM, D3, canvas, and feature algorithms", () => {
  const source = fs.readFileSync(OWNER_PATH, "utf8");
  assert.equal(/^\s*import\s/m.test(source), false);
  for (const forbidden of [
    "runtimeState",
    "RendererRuntimeContext",
    "globalThis",
    "document.",
    "window.",
    "getContext(",
    "drawPoliticalFeature(",
    "buildPoliticalRasterWorkerPacket(",
    "tryPartialPoliticalPassRepaint(",
  ]) {
    assert.equal(source.includes(forbidden), false, `owner should exclude ${forbidden}`);
  }
});
