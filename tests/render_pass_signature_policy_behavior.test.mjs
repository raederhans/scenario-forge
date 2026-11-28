import assert from "node:assert/strict";
import test from "node:test";
import { createRenderPassSignaturePolicy } from "../js/core/renderer/render_pass_signature_policy.js";

function createHarness(overrides = {}) {
  const state = {
    zoomTransform: { k: 2, x: 10, y: 20 }, dpr: 2, width: 800, height: 600,
    topologyRevision: 1, styleConfig: {},
    intensityFields: { channels: { urbanGlow: { revision: 7 } } },
  };
  const live = { reuse: false, projection: {}, debug: false, colorSensitive: false };
  const dependencies = {
    getTransformSignature: (t) => `${t?.k}:${t?.x}:${t?.y}`,
    getOceanBaseFillColor: () => "#123456",
    getDebugMode: () => live.debug,
    shouldEnableContextBaseTransformReuse: () => live.reuse,
    getViewportRenderSignature: () => `${state.width}:${state.height}`,
    getPhysicalLandMaskInfo: () => ({ maskSource: "land", maskFeatureCount: 3 }),
    getScenarioRuntimeTopologySignatureToken: () => "topology",

    rendererSurfaceHost: { getProjection: () => live.projection },
    getContextBaseZoomBucketId: (k) => Math.floor(k),
    shouldRefreshContextBaseForColorChanges: () => live.colorSensitive,
    getScenarioOverlaySignatureToken: () => "overlays",
    getLakeBaseFillColor: () => "#abcdef",
    getLakeStyleConfig: () => ({ opacity: 1 }),
    stableJson: JSON.stringify,
    ...overrides,
  };
  return { state, live, policy: createRenderPassSignaturePolicy(state, dependencies) };
}

test("physical base tracks replacement of its geometry source", () => {
  const { state, policy } = createHarness();
  state.showPhysical = true;
  state.zoomTransform = { x: 0, y: 0, k: 1 };
  state.physicalSemanticsData = { features: [{}] };
  state.contextLayerExternalDataByName = {};
  const signature = () => policy.getRenderPassSignature("physicalBase", state.zoomTransform);
  const overview = signature();
  state.physicalSemanticsData = { features: [{}] };
  assert.notEqual(signature(), overview, "same-size replacement must update the atlas");
});

test("border pixels depend on country appearance rather than unrelated individual color edits", () => {
  let appearanceRevision = 1, contourRevision = 1;
  const { state, policy } = createHarness({ getBorderAppearanceRevision: () => appearanceRevision, getPaintContourRevision: () => contourRevision });
  const before = policy.getRenderPassSignature("borders");
  state.colorRevision = 7;
  assert.equal(policy.getRenderPassSignature("borders"), before);
  appearanceRevision += 1;
  assert.notEqual(policy.getRenderPassSignature("borders"), before);
  const recolored = policy.getRenderPassSignature("borders");
  state.styleConfig.internalBorders = { colorMode: "manual", color: "#ff0000" };
  assert.notEqual(policy.getRenderPassSignature("borders"), recolored);
  const manual = policy.getRenderPassSignature("borders");
  contourRevision += 1;
  assert.notEqual(policy.getRenderPassSignature("borders"), manual);
});

test("river detail tier changes the reusable context signature without changing the shared zoom bucket", () => {
  const { state, live, policy } = createHarness({ getContextBaseZoomBucketId: () => "high" });
  live.reuse = true;
  state.showRivers = true;
  const at = (k) => policy.getRenderPassSignature("contextBase", { k, x: 0, y: 0 });
  assert.notEqual(at(4.9), at(5));
  assert.equal(at(5), at(5.1));
  state.showRivers = false;
  assert.equal(at(4.9), at(5));
});
