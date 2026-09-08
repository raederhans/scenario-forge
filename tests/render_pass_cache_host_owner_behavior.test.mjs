import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createRenderPassCacheHostOwner } from "../js/core/map_renderer/render_pass_cache_host_owner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const OWNER_PATH = path.join(REPO_ROOT, "js/core/map_renderer/render_pass_cache_host_owner.js");
const MAP_RENDERER_PATH = path.join(REPO_ROOT, "js/core/map_renderer.js");

function extractFunctionSource(source, functionName) {
  const marker = `function ${functionName}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Expected ${functionName} function source to exist.`);
  const bodyStart = source.indexOf("{", start);
  assert.notEqual(bodyStart, -1, `Expected ${functionName} function body to start.`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) {
      return source.slice(start, index + 1);
    }
  }
  throw new Error(`Expected ${functionName} function body to close.`);
}

function createRenderPassToCacheHarness({
  hostResult,
  cache = null,
  nowValues = [100, 125, 150],
  signature = "signature",
  passCounterNames = ["passCounter"],
  visibleFrameIdentity = {},
} = {}) {
  const calls = [];
  const cacheState = cache || {
    signatures: {},
    dirty: {},
    partialPoliticalDirtyIds: {
      cleared: false,
      clear() {
        this.cleared = true;
      },
    },
    counters: {
      contextScenarioReuseCount: 5,
    },
  };
  let nowIndex = 0;
  const dependencyMap = {
    exactCompositeReuseOwner: null,
    getRenderPassCacheState: () => cacheState,
    getRenderPassCacheHostOwner: () => ({
      prepareRenderPassHost(options) {
        calls.push(["prepareRenderPassHost", options.passName, typeof options.drawFn]);
        options.onHostReady?.();
        return hostResult;
      },
    }),
    getRenderPassCommitAccountingOwner: () => ({
      commitRenderPass(options) {
        calls.push(["commitRenderPass", options]);
      },
    }),
    recordRenderPerfMetric: (name, duration, metadata) => {
      calls.push(["recordRenderPerfMetric", name, duration, metadata]);
    },
    nowMs: () => nowValues[Math.min(nowIndex++, nowValues.length - 1)],
    setPassReferenceTransform: (passName, transform) => {
      calls.push(["setPassReferenceTransform", passName, transform]);
    },
    getVisibleFrameIdentity: (transform) => {
      calls.push(["getVisibleFrameIdentity", transform]);
      return visibleFrameIdentity;
    },
    setPassFullReferenceTransform: (passName, transform) => {
      calls.push(["setPassFullReferenceTransform", passName, transform]);
    },
    clearPassFullReferenceTransforms: (passNames) => {
      calls.push(["clearPassFullReferenceTransforms", passNames]);
    },
    getRenderPassSignature: (passName, transform) => {
      calls.push(["getRenderPassSignature", passName, transform]);
      return signature;
    },
    schedulePoliticalPathWarmup: (transform) => {
      calls.push(["schedulePoliticalPathWarmup", transform]);
    },
    recordPassTiming: (timings, passName, passStart) => {
      calls.push(["recordPassTiming", passName, passStart]);
      timings[passName] = Number(timings[passName] || 0) + 1;
    },
    getPassCounterNames: (passName) => {
      calls.push(["getPassCounterNames", passName]);
      return passCounterNames;
    },
    incrementPerfCounter: (counterName) => {
      calls.push(["incrementPerfCounter", counterName]);
    },
  };
  const rendererSource = fs.readFileSync(MAP_RENDERER_PATH, "utf8");
  const functionSource = extractFunctionSource(rendererSource, "renderPassToCache");
  const renderPassToCache = Function(
    ...Object.keys(dependencyMap),
    `return (${functionSource});`,
  )(...Object.values(dependencyMap));

  return {
    calls,
    cache: cacheState,
    renderPassToCache,
  };
}

function createOwner({
  canvasContext = {},
  layout = { width: 100, height: 80 },
  prepareK = 2,
  events = [],
} = {}) {
  const canvas = {
    getContext(type) {
      events.push(`getContext:${type}`);
      return canvasContext;
    },
  };
  const owner = createRenderPassCacheHostOwner({
    effects: {
      ensureRenderPassCanvas(passName) {
        events.push(`ensure:${passName}`);
        return canvas;
      },
      prepareTargetContext(passContext, transform, passLayout) {
        events.push(`prepare:${passContext === canvasContext}:${transform?.k}:${passLayout === layout}`);
        return prepareK;
      },
      withRenderTarget(passContext, callback) {
        events.push(`with:start:${passContext === canvasContext}`);
        const result = callback();
        events.push("with:end");
        return result;
      },
    },
    getters: {
      getRenderPassLayout(passName) {
        events.push(`layout:${passName}`);
        return layout;
      },
    },
  });

  return { owner, events };
}

test("skips without a pass canvas before context layout or draw", () => {
  const owner = createRenderPassCacheHostOwner({
    effects: {
      ensureRenderPassCanvas: () => null,
      prepareTargetContext: () => {
        throw new Error("prepareTargetContext must not run");
      },
      withRenderTarget: () => {
        throw new Error("withRenderTarget must not run");
      },
    },
    getters: {
      getRenderPassLayout: () => {
        throw new Error("getRenderPassLayout must not run");
      },
    },
  });
  let drawCount = 0;

  const summary = owner.prepareRenderPassHost({
    passName: "political",
    transform: { k: 1 },
    drawFn: () => {
      drawCount += 1;
    },
  });

  assert.deepEqual(summary, {
    passName: "political",
    k: null,
    hasPassCanvas: false,
    hasPassContext: false,
    drawInvoked: false,
    drawResult: undefined,
    skipped: true,
    skipReason: "missing-pass-canvas",
    effectOrder: ["ensureRenderPassCanvas"],
    getterOrder: [],
  });
  assert.equal(drawCount, 0);
});

test("skips without a 2d context before layout or draw", () => {
  const events = [];
  const owner = createRenderPassCacheHostOwner({
    effects: {
      ensureRenderPassCanvas: () => ({
        getContext(type) {
          events.push(`getContext:${type}`);
          return null;
        },
      }),
      prepareTargetContext: () => {
        throw new Error("prepareTargetContext must not run");
      },
      withRenderTarget: () => {
        throw new Error("withRenderTarget must not run");
      },
    },
    getters: {
      getRenderPassLayout: () => {
        throw new Error("getRenderPassLayout must not run");
      },
    },
  });

  const summary = owner.prepareRenderPassHost({
    passName: "contextBase",
    transform: { k: 1 },
    drawFn: () => {
      throw new Error("drawFn must not run");
    },
  });

  assert.equal(summary.skipped, true);
  assert.equal(summary.skipReason, "missing-pass-context");
  assert.equal(summary.hasPassCanvas, true);
  assert.equal(summary.hasPassContext, false);
  assert.equal(summary.drawInvoked, false);
  assert.deepEqual(summary.effectOrder, ["ensureRenderPassCanvas", "getContext2D"]);
  assert.deepEqual(summary.getterOrder, []);
  assert.deepEqual(events, ["getContext:2d"]);
});

test("prepares target inside render target and returns draw result unchanged", () => {
  const drawResult = { committed: true, politicalDataStage: "fine" };
  const { owner, events } = createOwner({ prepareK: 3.5 });

  const summary = owner.prepareRenderPassHost({
    passName: "political",
    transform: { k: 1.5 },
    onHostReady: () => {
      events.push("ready");
    },
    drawFn: (k) => {
      events.push(`draw:${k}`);
      return drawResult;
    },
  });

  assert.equal(summary.passName, "political");
  assert.equal(summary.k, 3.5);
  assert.equal(summary.hasPassCanvas, true);
  assert.equal(summary.hasPassContext, true);
  assert.equal(summary.drawInvoked, true);
  assert.equal(summary.drawResult, drawResult);
  assert.equal(summary.skipped, false);
  assert.deepEqual(summary.effectOrder, [
    "ensureRenderPassCanvas",
    "getContext2D",
    "onHostReady",
    "withRenderTarget",
    "prepareTargetContext",
    "drawFn",
  ]);
  assert.deepEqual(summary.getterOrder, ["getRenderPassLayout"]);
  assert.deepEqual(events, [
    "ensure:political",
    "getContext:2d",
    "ready",
    "layout:political",
    "with:start:true",
    "prepare:true:1.5:true",
    "draw:3.5",
    "with:end",
  ]);
});

test("hgoPreview keeps current scale normalization floor and skips target preparation", () => {
  const events = [];
  const { owner } = createOwner({ events, prepareK: 99 });
  const drawnScales = [];

  const first = owner.prepareRenderPassHost({
    passName: "hgoPreview",
    transform: { k: 0.000001 },
    drawFn: (k) => {
      drawnScales.push(k);
      return "first";
    },
  });
  const second = owner.prepareRenderPassHost({
    passName: "hgoPreview",
    transform: { k: 0 },
    drawFn: (k) => {
      drawnScales.push(k);
      return "second";
    },
  });

  assert.equal(first.k, 0.0001);
  assert.equal(first.drawResult, "first");
  assert.equal(second.k, 1);
  assert.equal(second.drawResult, "second");
  assert.deepEqual(drawnScales, [0.0001, 1]);
  assert.equal(first.effectOrder.includes("prepareTargetContext"), false);
  assert.equal(second.effectOrder.includes("prepareTargetContext"), false);
  assert.deepEqual(first.getterOrder, ["getRenderPassLayout"]);
});

test("requires declared dependencies and draw callback", () => {
  assert.throws(
    () => createRenderPassCacheHostOwner({
      effects: {
        ensureRenderPassCanvas: () => ({}),
        withRenderTarget: () => {},
      },
      getters: {
        getRenderPassLayout: () => ({}),
      },
    }),
    /effects\.prepareTargetContext must be a function/,
  );

  const { owner } = createOwner();
  assert.throws(
    () => owner.prepareRenderPassHost({ passName: "political", drawFn: null }),
    /drawFn must be a function/,
  );
});

test("freezes returned summary and trace arrays", () => {
  const { owner } = createOwner();

  const summary = owner.prepareRenderPassHost({
    passName: "contextScenario",
    transform: { k: 2 },
    drawFn: () => undefined,
  });

  assert.equal(Object.isFrozen(summary), true);
  assert.equal(Object.isFrozen(summary.effectOrder), true);
  assert.equal(Object.isFrozen(summary.getterOrder), true);
});

test("renderPassToCache wrapper returns before cache commit when host skips", () => {
  const timings = {};
  const transform = { k: 2 };
  const { cache, calls, renderPassToCache } = createRenderPassToCacheHarness({
    hostResult: {
      skipped: true,
      skipReason: "missing-pass-context",
    },
  });

  renderPassToCache("political", () => ({ committed: true }), transform, timings);

  assert.deepEqual(timings, {});
  assert.deepEqual(cache.signatures, {});
  assert.deepEqual(cache.dirty, {});
  assert.deepEqual(calls, [["prepareRenderPassHost", "political", "function"]]);
});

test("renderPassToCache wrapper delegates declined commit accounting", () => {
  const timings = {};
  const transform = { k: 3 };
  const hostResult = {
    skipped: false,
    drawResult: {
      committed: false,
      reason: "draw-declined-for-test",
    },
  };
  const { cache, calls, renderPassToCache } = createRenderPassToCacheHarness({
    hostResult,
    nowValues: [500, 512],
  });

  renderPassToCache("contextBase", () => ({ committed: true }), transform, timings);

  assert.deepEqual(timings, {});
  assert.deepEqual(cache.signatures, {});
  assert.deepEqual(cache.dirty, {});
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], ["prepareRenderPassHost", "contextBase", "function"]);
  assert.equal(calls[1][0], "commitRenderPass");
  assert.deepEqual(calls[1][1], {
    passName: "contextBase",
    transform,
    drawResult: hostResult.drawResult,
    timings,
    passStart: 500,
    hostSummary: hostResult,
  });
});

test("renderPassToCache wrapper delegates political cache commit accounting after host draw", () => {
  const timings = {};
  const transform = { k: 4 };
  const hostResult = {
    skipped: false,
    drawResult: {
      politicalDataStage: "fine",
      fullPoliticalReady: true,
      finePoliticalCacheReady: true,
      sceneGeneration: 7,
      scenarioDataGeneration: 8,
    },
  };
  const { cache, calls, renderPassToCache } = createRenderPassToCacheHarness({
    hostResult,
    nowValues: [700],
    signature: "political-signature",
    passCounterNames: ["politicalCounter"],
    visibleFrameIdentity: {
      politicalDataStage: "coarse",
      fullPoliticalReady: false,
      finePoliticalCacheReady: false,
      sceneGeneration: 1,
      scenarioDataGeneration: 2,
    },
  });
  cache.dirty.political = true;

  renderPassToCache("political", () => ({ committed: true }), transform, timings);

  assert.equal(cache.signatures.political, undefined);
  assert.equal(cache.dirty.political, true);
  assert.equal(cache.partialPoliticalDirtyIds.cleared, false);
  assert.deepEqual(timings, {});
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], ["prepareRenderPassHost", "political", "function"]);
  assert.equal(calls[1][0], "commitRenderPass");
  assert.deepEqual(calls[1][1], {
    passName: "political",
    transform,
    drawResult: hostResult.drawResult,
    timings,
    passStart: 700,
    hostSummary: hostResult,
  });
});

test("owner source excludes renderer lifecycle and cache commit work", () => {
  const ownerSource = fs.readFileSync(OWNER_PATH, "utf8");

  for (const token of [
    "drawCanvas",
    "drawPoliticalPass",
    "drawContextBasePass",
    "drawContextScenarioPass",
    "buildHitCanvas",
    "setPassReferenceTransform",
    "cache.signatures",
    "cache.dirty",
    "recordPassTiming",
    "recordRenderPerfMetric",
    "schedulePoliticalPathWarmup",
    "runtimeState",
    "globalThis.d3",
    "document",
    "window",
  ]) {
    assert.equal(ownerSource.includes(token), false, `owner source must not include ${token}`);
  }
});
