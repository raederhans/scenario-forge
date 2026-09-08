import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { parse } from "acorn";
import { createRenderPassSignaturePolicy } from "../js/core/renderer/render_pass_signature_policy.js";
import { RENDER_PASS_NAMES } from "../js/core/map_renderer/render_pass_catalog.js";

function createHarness() {
  const state = {
    zoomTransform: { k: 2, x: 10, y: 20 }, dpr: 2, width: 800, height: 600,
    topologyRevision: 1, styleConfig: {},
    intensityFields: { channels: { urbanGlow: { revision: 7 } } },
  };
  const live = { reuse: false, projection: {}, ready: false, debug: false, colorSensitive: false, visibility: "hgo-visibility" };
  const calls = [];
  const dependencies = {
    getTransformSignature: (t) => { calls.push("transform"); return `${t?.k}:${t?.x}:${t?.y}`; },
    getOceanBaseFillColor: () => "#123456",
    getDebugMode: () => live.debug,
    shouldEnableContextBaseTransformReuse: () => live.reuse,
    getViewportRenderSignature: () => `${state.width}:${state.height}`,
    getPhysicalLandMaskInfo: () => ({ maskSource: "land", maskFeatureCount: 3 }),
    getScenarioRuntimeTopologySignatureToken: () => "topology",
    getHgoRuntimePreviewVisibilitySignature: () => live.visibility,
    getHgoRuntimePreviewProjectionOptions: () => ({ projectionName: "mercator", sourceProjection: "geo" }),
    isHgoRuntimePreviewReady: () => live.ready,
    rendererSurfaceHost: { getProjection: () => live.projection },
    getContextBaseZoomBucketId: (k) => Math.floor(k),
    shouldRefreshContextBaseForColorChanges: () => live.colorSensitive,
    getScenarioOverlaySignatureToken: () => "overlays",
    getLakeBaseFillColor: () => "#abcdef",
    getLakeStyleConfig: () => ({ opacity: 1 }),
    stableJson: JSON.stringify,
    getDayNightRuntimeOwner: () => ({ buildDayNightPassSignature: (...args) => {
      calls.push(args);
      return args.join("::");
    } }),
  };
  return { state, live, calls, policy: createRenderPassSignaturePolicy(state, dependencies) };
}

const invalidationCases = [
  ["background", "topologyRevision"], ["physicalBase", "showPhysical"],
  ["political", "colorRevision"], ["hgoPreview", "width"],
  ["effects", "topologyRevision"], ["lineEffects", "topologyRevision"],
  ["contextBase", "contextLayerRevision"], ["contextMarkers", "cityLayerRevision"],
  ["labels", "scenarioStrategicValuesRevision"], ["contextScenario", "scenarioReliefOverlayRevision"],
  ["textureLabels", "topologyRevision"], ["dayNight", "topologyRevision"],
  ["borders", "sovereigntyRevision"],
];

test("every catalog pass reads its live invalidation input and ignores unrelated UI state", () => {
  assert.deepEqual(invalidationCases.map(([pass]) => pass).sort(), [...RENDER_PASS_NAMES].sort());
  for (const [pass, field] of invalidationCases) {
    const { state, policy } = createHarness();
    const before = policy.getRenderPassSignature(pass);
    state.selectedWaterRegionId = "unrelated-ui-selection";
    assert.equal(policy.getRenderPassSignature(pass), before, `${pass}: unrelated state`);
    state[field] = Number(state[field] || 0) + 1;
    assert.notEqual(policy.getRenderPassSignature(pass), before, `${pass}: ${field}`);
  }
});

test("only contextBase can reuse a viewport signature across a pan, while zoom buckets still invalidate", () => {
  const { state, live, policy } = createHarness();
  live.reuse = true;
  const before = Object.fromEntries(RENDER_PASS_NAMES.map(pass => [pass, policy.getRenderPassSignature(pass)]));
  state.zoomTransform = { k: 2, x: 50, y: 80 };
  for (const pass of RENDER_PASS_NAMES) {
    assert.equal(policy.getRenderPassSignature(pass) === before[pass], pass === "contextBase", pass);
  }
  state.zoomTransform.k = 3;
  assert.notEqual(policy.getRenderPassSignature("contextBase"), before.contextBase);
  live.reuse = false;
  assert.equal(policy.getRenderPassTransformSignature("contextBase"), "3:50:80");
});

test("HGO identity distinguishes readiness, projection availability and live dimensions", () => {
  const { state, live, policy } = createHarness();
  state.hgoRuntimePreview = { status: "ready", summary: { province_count: 9, state_count: 4, country_count: 2 } };
  const before = policy.getRenderPassSignature("hgoPreview");
  assert.match(before, /^hgo:off::ready::2\.00::800::600::2:10:20::mercator::geo::seed:9:4:2$/);
  live.ready = true;
  live.projection = null;
  assert.match(policy.getRenderPassSignature("hgoPreview"), /^hgo:on::.*::projection:none::/);
});

test("HGO visibility invalidates exactly its seven dependent passes", () => {
  const { state, live, policy } = createHarness();
  const dependentPasses = new Set(["political", "contextBase", "contextMarkers", "labels", "contextScenario", "textureLabels", "borders"]);
  const before = Object.fromEntries(RENDER_PASS_NAMES.map(pass => [pass, policy.getRenderPassSignature(pass)]));
  live.visibility = "hgo-visible";
  for (const pass of RENDER_PASS_NAMES) {
    assert.equal(policy.getRenderPassSignature(pass) !== before[pass], dependentPasses.has(pass), pass);
  }
  state.colorRevision = 3;
  assert.match(policy.getRenderPassSignature("political"), /^3::hgo-visible::/);
});

test("context color sensitivity and nested state replacements are evaluated per call", () => {
  const { state, live, policy } = createHarness();
  const context = policy.getRenderPassSignature("contextBase");
  state.colorRevision = 4;
  assert.equal(policy.getRenderPassSignature("contextBase"), context);
  live.colorSensitive = true;
  assert.notEqual(policy.getRenderPassSignature("contextBase"), context);
  const background = policy.getRenderPassSignature("background");
  state.styleConfig = { ocean: { fillColor: "#000000" } };
  assert.notEqual(policy.getRenderPassSignature("background"), background);
});

test("signature evaluation preserves caller data and isolates independent renderer instances", () => {
  const first = createHarness();
  const second = createHarness();
  const snapshot = structuredClone(first.state);
  assert.equal(Object.isFrozen(first.policy), true);
  for (const pass of RENDER_PASS_NAMES) first.policy.getRenderPassSignature(pass);
  assert.deepEqual(first.state, snapshot);
  first.state.topologyRevision++;
  first.live.debug = true;
  assert.notEqual(first.policy.getPoliticalPassStaticSignature(), second.policy.getPoliticalPassStaticSignature());
  assert.deepEqual(second.state, snapshot);
});

test("explicit transforms, fallback pass identity and day/night delegation retain their contract", () => {
  const { state, calls, policy } = createHarness();
  const transform = { k: 4, x: 5, y: 6 };
  assert.equal(policy.getRenderPassSignature("unknown", transform), "4:5:6");
  assert.equal(policy.getRenderPassSignature("dayNight", transform), "4:5:6::7::1");
  assert.deepEqual(calls, ["transform", "transform", ["4:5:6", 7, 1]]);
  assert.equal(state.zoomTransform.k, 2);
});

test("entrypoint delegates default transform resolution once to the signature policy", () => {
  const source = fs.readFileSync(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  for (const [name, args] of [
    ["getPoliticalPassStaticSignature", []],
    ["getRenderPassTransformSignature", ["unknown"]],
    ["getRenderPassSignature", ["unknown"]],
  ]) {
    const { state, policy } = createHarness();
    let reads = 0;
    Object.defineProperty(state, "zoomTransform", { get() { reads++; return undefined; } });
    const node = ast.body.find(n => n.type === "FunctionDeclaration" && n.id.name === name);
    const invoke = new Function("runtimeState", "getRenderPassSignaturePolicy", `${source.slice(node.start, node.end)}; return ${name};`)(state, () => policy);
    const expected = policy[name](...args);
    const directReads = reads;
    reads = 0;
    assert.equal(invoke(...args), expected);
    assert.equal(reads, directReads, name);
  }
});
