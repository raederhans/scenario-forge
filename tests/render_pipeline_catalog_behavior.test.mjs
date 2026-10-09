import assert from "node:assert/strict";
import test from "node:test";

import { RENDER_PASS_NAMES } from "../js/core/map_renderer/render_pass_catalog.js";
import { IDLE_RENDER_PASS_DEFINITIONS } from "../js/core/renderer/render_pipeline_catalog.js";
import { createRenderPipelinePassesOwner } from "../js/core/renderer/render_pipeline_passes.js";

const EXPECTED_IDLE_RENDER_PASS_NAMES = [
  "background",
  "physicalBase",
  "political",
  "populationHeatmap",
  "contextBase",
  "contextScenario",
  "effects",
  "lineEffects",
  "dayNight",
  "borders",
  "contextMarkers",
  "textureLabels",
  "labels",
];

function createDrawPassSpies() {
  const calls = new Map();
  const drawPasses = {};
  for (const { drawKey } of IDLE_RENDER_PASS_DEFINITIONS) {
    calls.set(drawKey, []);
    drawPasses[drawKey] = (token) => {
      calls.get(drawKey).push(token);
    };
  }
  return { calls, drawPasses };
}

test("idle render pipeline catalog preserves pass order and draw keys", () => {
  assert.deepEqual(
    IDLE_RENDER_PASS_DEFINITIONS.map(({ passName }) => passName),
    EXPECTED_IDLE_RENDER_PASS_NAMES,
  );
  for (const { passName, drawKey } of IDLE_RENDER_PASS_DEFINITIONS) {
    assert.ok(RENDER_PASS_NAMES.includes(passName), `${passName} must exist in RENDER_PASS_NAMES.`);
    assert.equal(typeof drawKey, "string");
    assert.ok(drawKey.length > 0, `${passName} must declare a drawKey.`);
  }
});

test("render pipeline owner maps catalog draw keys to draw functions", () => {
  const { calls, drawPasses } = createDrawPassSpies();
  const owner = createRenderPipelinePassesOwner({
    drawPasses,
    helpers: {},
    state: {},
  });

  const definitions = owner.getIdleRenderPassDefinitions();

  assert.deepEqual(
    definitions.map(([passName]) => passName),
    EXPECTED_IDLE_RENDER_PASS_NAMES,
  );

  for (const [index, [, drawFn]] of definitions.entries()) {
    const { drawKey } = IDLE_RENDER_PASS_DEFINITIONS[index];
    drawFn(`token:${drawKey}`);
  }

  for (const { drawKey } of IDLE_RENDER_PASS_DEFINITIONS) {
    assert.deepEqual(calls.get(drawKey), [`token:${drawKey}`]);
  }
});

test("ensureIdleRenderPasses filters requested pass names before preparation and render", () => {
  const { calls, drawPasses } = createDrawPassSpies();
  const cache = {
    canvases: {},
    counters: {},
    dirty: {},
    reasons: {},
    signatures: {},
  };
  const helperCalls = {
    mismatchChecks: 0,
    renderPasses: [],
    signatures: [],
  };
  const owner = createRenderPipelinePassesOwner({
    drawPasses,
    helpers: {
      detectContextScenarioReasonMismatch: () => {
        helperCalls.mismatchChecks += 1;
      },
      getRenderPassCacheState: () => cache,
      getRenderPassSignature: (passName) => {
        helperCalls.signatures.push(passName);
        return `${passName}:next`;
      },
      renderPassToCache: (passName, drawFn, transform, timings) => {
        helperCalls.renderPasses.push({
          passName,
          transform,
          timings,
        });
        drawFn(`render:${passName}`);
      },
    },
    state: {
      renderPerfMetrics: {},
      zoomTransform: { k: 1, x: 0, y: 0 },
    },
  });
  const timings = {};

  owner.ensureIdleRenderPasses(timings, ["political"]);

  assert.deepEqual(helperCalls.signatures, ["political", "political"],
    "the async preparation gate and exact pass both inspect only the requested political pass");
  assert.deepEqual(helperCalls.renderPasses.map(({ passName }) => passName), ["political"]);
  assert.equal(helperCalls.renderPasses[0].timings, timings);
  assert.deepEqual(calls.get("drawPoliticalPass"), ["render:political"]);
  for (const { drawKey } of IDLE_RENDER_PASS_DEFINITIONS) {
    if (drawKey === "drawPoliticalPass") continue;
    assert.deepEqual(calls.get(drawKey), []);
  }
  assert.equal(cache.dirty.political, true);
  assert.equal(cache.reasons.political, "signature");
  assert.equal(helperCalls.mismatchChecks, 1);
});

test("context scenario async preparation preserves the old pass until ready", () => {
  const oldCanvas = { id: "painted-before-warmup" };
  const cache = {
    canvases: { contextScenario: oldCanvas }, counters: {},
    dirty: { contextScenario: true }, reasons: {},
    signatures: { contextScenario: "previous" },
  };
  const prepared = [];
  const rendered = [];
  let pending = true;
  const owner = createRenderPipelinePassesOwner({
    state: { zoomTransform: { x: 0, y: 0, k: 1 } },
    helpers: {
      getRenderPassCacheState: () => cache,
      getRenderPassSignature: () => "next",
      prepareRenderPassAsync: (name) => {
        prepared.push(name);
        return pending;
      },
      renderPassToCache: (name) => {
        rendered.push(name);
        cache.canvases[name] = { id: "newly-painted" };
        cache.signatures[name] = "next";
        cache.dirty[name] = false;
      },
    },
  });

  assert.equal(owner.ensureIdleRenderPasses({}, ["contextScenario"]), false);
  assert.deepEqual(prepared, ["contextScenario"]);
  assert.deepEqual(rendered, []);
  assert.equal(cache.canvases.contextScenario, oldCanvas);
  assert.equal(cache.signatures.contextScenario, "previous");
  assert.equal(cache.dirty.contextScenario, true);

  pending = false;
  assert.equal(owner.ensureIdleRenderPasses({}, ["contextScenario"]), true);
  assert.deepEqual(rendered, ["contextScenario"]);
  assert.equal(cache.signatures.contextScenario, "next");
  assert.equal(cache.dirty.contextScenario, false);
  assert.notEqual(cache.canvases.contextScenario, oldCanvas);
});

test("context scenario async hook skips clean passes and does not affect other passes", () => {
  const cache = {
    canvases: {}, counters: {}, dirty: {}, reasons: {},
    signatures: { contextScenario: "same", background: "same" },
  };
  const prepared = [];
  const rendered = [];
  const owner = createRenderPipelinePassesOwner({
    state: { zoomTransform: { x: 0, y: 0, k: 1 } },
    helpers: {
      getRenderPassCacheState: () => cache,
      getRenderPassSignature: () => "same",
      prepareRenderPassAsync: (name) => { prepared.push(name); return true; },
      renderPassToCache: (name) => rendered.push(name),
    },
  });

  assert.equal(owner.ensureIdleRenderPasses({}, ["contextScenario"]), true);
  assert.deepEqual(prepared, []);
  cache.dirty.background = true;
  assert.equal(owner.ensureIdleRenderPasses({}, ["background"]), true);
  assert.deepEqual(prepared, []);
  assert.deepEqual(rendered, ["background"]);
});
