import test from "node:test";
import assert from "node:assert/strict";
import { createPhysicalIntensityInteractionOwner } from "../js/core/renderer/physical_intensity_interaction_owner.js";
import { createMapInteractionEventBindingOwner } from "../js/core/renderer/map_interaction_event_binding_owner.js";
import { bakeIntensityComposite } from "../js/core/intensity_field.js";

function harness() {
  const state = { intensityFields: { channels: { physicalAtlas: { enabled: false, points: [], revision: 0 } } } };
  const channel = () => state.intensityFields.channels.physicalAtlas;
  const tool = { active: true, channelId: "physicalAtlas", subMode: "paint", brushRadiusDeg: 3, brushStrength: 2 };
  let hit;
  const noop = () => {};
  const owner = createPhysicalIntensityInteractionOwner({
    runtimeState: state, rendererSurfaceHost: { getInteractionRect: () => null },
    getPhysicalIntensityChannel: channel, getIntensityFieldTargetPasses: () => [],
    invalidateRenderPasses: noop, requestInteractionRender: noop, refreshPhysicalIntensityUi: noop,
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    INTENSITY_FIELD_GRID: { min: 0, max: 5 }, bakeIntensityComposite,
    captureHistoryState: () => structuredClone(channel()), pushHistoryEntry: noop, suppressNextClick: noop,
    getMapLonLatFromEvent: event => event.lonLat, stampIntensityBrush: () => ({}),
    getIntensityFieldTool: () => tool, blockStartupReadonlyInteraction: noop,
    renderPhysicalIntensityBrushPreview: noop, getPhysicalIntensityPointHit: () => hit,
    setIntensityFieldTool: patch => Object.assign(tool, patch),
    updatePhysicalIntensityBrushPreviewFromEvent: noop, requestAnimationFrame: () => 1,
  });
  const event = (lonLat = [1, 2]) => ({ lonLat, buttons: 1, pointerId: 7, preventDefault: noop });
  return { owner, channel, tool, event, select: point => { hit = { point, mode: "move" }; } };
}

test("point completion commits the final intensity grid", () => {
  const h = harness();
  h.tool.subMode = "points";
  h.channel().points.push({ id: "p", lon: 0, lat: 0, strength: 2, radiusDeg: 8, falloff: "smooth" });
  bakeIntensityComposite(h.channel());
  h.select(h.channel().points[0]);
  h.owner.handlePhysicalIntensityPointerDown(h.event());
  h.owner.handlePhysicalIntensityPointerMove(h.event([12, 15]));
  const expected = structuredClone(h.channel());
  bakeIntensityComposite(expected);
  expected.revision += 1;
  h.owner.handlePhysicalIntensityPointerEnd({ ...h.event(), type: "pointerup" });
  assert.deepEqual(h.channel(), expected);
});

test("a second touch restores the channel before the brush stroke", () => {
  const h = harness();
  h.channel().grid = { base: new Float32Array([0.12345]), composite: new Float32Array([0.67891]) };
  h.tool.selectedPointId = "selected-before";
  const before = structuredClone(h.channel());
  const listeners = new Map();
  const noop = () => {};
  const node = { style: {}, addEventListener: noop };
  const rect = { node: () => node, on: (type, fn) => { listeners.set(type, fn); return rect; } };
  const binding = createMapInteractionEventBindingOwner({
    getters: { getInteractionRect: () => rect, isTouchBrushEnabled: () => h.tool.active,
      getWindow: () => ({ addEventListener: noop }) },
    handlers: { ...h.owner, handleBrushPointerDown: h.owner.handlePhysicalIntensityPointerDown,
      handleBrushPointerMove: h.owner.handlePhysicalIntensityPointerMove,
      handleBrushPointerEnd: noop, cancelBrushSession: noop, flushBrushSession: noop,
      flushSpecialZoneMembershipDragSession: noop, handleMouseMove: noop, handleMouseLeave: noop,
      mapClick: noop, mapDoubleClick: noop, handleResize: noop, handleSidebarLayoutStart: noop },
  });
  binding.bindEvents();
  const first = { ...h.event(), pointerType: "touch", isPrimary: true };
  const second = { ...first, pointerId: 8, isPrimary: false };
  listeners.get("pointerdown.fieldTool")(first);
  assert.equal(binding.shouldAllowTouchNavigation(), false);
  h.channel().grid.base[0] = 2;
  h.channel().grid.composite[0] = 2;
  listeners.get("pointerdown.fieldTool")(second);
  assert.deepEqual(h.channel(), before);
});
