import assert from "node:assert/strict";
import test from "node:test";
import { state as runtimeState } from "../js/core/state.js";
import { createFillTargetPolicy } from "../js/core/renderer/fill_target_policy.js";
import { createMapHoverInteractionOwner } from "../js/core/map_renderer/map_hover_interaction_owner.js";

function fixture(context, language = "zh") {
  const previousLanguage = runtimeState.currentLanguage;
  runtimeState.currentLanguage = language;
  context.after(() => { runtimeState.currentLanguage = previousLanguage; });
  const ids = ["a", "b", "c"];
  const state = {
    currentLanguage: language, currentTool: "fill", interactionGranularity: "subdivision",
    batchFillScope: "parent", renderPhase: "idle", landData: {},
    landIndex: new Map(ids.map((id) => [id, { id }])),
    countryToFeatureIds: new Map([["CN", ids]]),
    hierarchyData: {
      groups: { CN_north: ["a", "b"] },
      quick_fill: { countries: { CN: { levels: {
        city: { groups: { east: { label: "东城", feature_ids: ["a"] } } },
      } } } },
    },
  };
  const policy = createFillTargetPolicy(state, {
    getFeatureCountryCodeNormalized: () => "CN",
    getAdmin1Group: () => "",
    shouldExcludePoliticalInteractionFeature: () => false,
  });
  const buildPlan = context.mock.fn(policy.buildDoubleClickBatchPlan);
  const observedPolicy = { ...policy, buildDoubleClickBatchPlan: buildPlan };
  const tooltip = { style: {} };
  const frames = [];
  const idle = () => {};
  const owner = createMapHoverInteractionOwner({
    state,
    surfaceHost: { getTooltip: () => tooltip, getInteractionRect: () => null },
    getters: {
      nowMs: () => 1,
      getHitFromEvent: (event) => ({ targetType: "land", id: ids[event.clientX] }),
      getFeatureForHit: (hit) => state.landIndex.get(hit.id),
      getTooltipTextForFeature: (feature) => feature.id,
      getFillTargetPolicy: () => observedPolicy,
      getHoveredFacilityEntryFromEvent: idle, isFacilityDetailsSurfaceActive: idle,
      getHoveredCityTooltipEntry: idle, getOverlayProjectionSignature: idle,
      getSelectedFacilityEntry: idle, shouldBlockUnderlyingSelectionForFacility: idle,
      getGlobal: () => ({ requestAnimationFrame: (fn) => frames.push(fn), cancelAnimationFrame: idle }),
    },
    effects: { updateDevHoverHit: idle, renderHoverOverlay: idle,
      recordInteractionDurationMetric: idle, hidePhysicalIntensityBrushPreview: idle },
    helpers: { getFacilityKey: idle },
  });
  function hover(id = "a") {
    owner.handleMouseMove({ clientX: ids.indexOf(id) });
    frames.splice(0).forEach((fn) => fn());
    return tooltip.textContent;
  }
  return { state, hover, calls: () => buildPlan.mock.callCount() };
}

test("悬停显示当前层级及实际地块数，切换范围立即更新", (context) => {
  const { state, hover } = fixture(context);
  assert.equal(hover(), "a\n双击填充：2 个地块（上级区域）");
  state.batchFillScope = "level:city";
  assert.equal(hover(), "a\n双击填充：1 个地块（东城）");
  assert.equal(hover("b"), "b");
  state.batchFillScope = "country";
  assert.equal(hover("b"), "b\n双击填充：整个国家 · 3 个地块");
  state.batchFillScope = "parent";
  state.hierarchyData = { quick_fill: { countries: { CN: { parent_available: false } } } };
  assert.equal(hover("b"), "b\n双击填充：整国（无上级区域）· 3 个地块");
});

test("同地块重复悬停复用结果，非填色工具及手势期间跳过计算", (context) => {
  const { state, hover, calls } = fixture(context, "en");
  assert.equal(hover(), "a\nDouble-click fill: 2 regions (parent region)");
  hover();
  assert.equal(calls(), 1);
  hover("b");
  assert.equal(calls(), 2);
  state.currentTool = "erase";
  assert.equal(hover("b"), "b");
  state.currentTool = "fill";
  state.isInteracting = true;
  assert.equal(hover(), "");
  state.isInteracting = false;
  state.renderPhase = "settling";
  assert.equal(hover(), "");
  assert.equal(calls(), 2);
  state.renderPhase = "idle";
  state.batchFillScope = "level:city";
  assert.equal(hover(), "a\nDouble-click fill: 1 region (东城)");
  assert.equal(calls(), 3);
});
