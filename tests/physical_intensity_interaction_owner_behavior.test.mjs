import test from "node:test";
import assert from "node:assert/strict";
import { createPhysicalIntensityInteractionOwner } from "../js/core/renderer/physical_intensity_interaction_owner.js";

function harness() {
  const calls = [], frames = [];
  const state = {};
  const tool = { active: true, channelId: "physicalAtlas", subMode: "paint", brushRadiusDeg: 3, brushStrength: 2 };
  let channel = { enabled: false, points: [], revision: 0 };
  const mode = { hit: null, stamp: true, captureThrows: false };
  const record = (name) => (...args) => calls.push([name, ...args]);
  const node = {
    setPointerCapture(id) { calls.push(["capture-pointer", id]); if (mode.captureThrows) throw Error("capture"); },
    releasePointerCapture(id) { calls.push(["release-pointer", id]); if (mode.captureThrows) throw Error("release"); },
  };
  const owner = createPhysicalIntensityInteractionOwner({
    runtimeState: state, rendererSurfaceHost: { getInteractionRect: () => ({ node: () => node }) },
    getPhysicalIntensityChannel: () => channel, getIntensityFieldTargetPasses: () => [],
    invalidateRenderPasses: record("invalidate"), requestInteractionRender: record("render"),
    refreshPhysicalIntensityUi: record("ui"), clamp: (v,a,b) => Math.max(a, Math.min(b,v)),
    INTENSITY_FIELD_GRID: { min: 0, max: 5 }, bakeIntensityComposite: record("bake"),
    captureHistoryState: () => { calls.push(["history-capture"]); return structuredClone(channel); },
    pushHistoryEntry: record("history"), suppressNextClick: record("suppress"),
    getMapLonLatFromEvent: (event) => event.lonLat,
    stampIntensityBrush: (target, options) => { calls.push(["stamp", options]); if (mode.stamp) target.stamped = true; return mode.stamp ? {} : null; },
    getIntensityFieldTool: () => tool, blockStartupReadonlyInteraction: record("readonly"),
    renderPhysicalIntensityBrushPreview: record("preview"), getPhysicalIntensityPointHit: () => mode.hit,
    setIntensityFieldTool: (patch) => { Object.assign(tool, patch); calls.push(["tool", patch]); },
    updatePhysicalIntensityBrushPreviewFromEvent: record("preview-event"),
    requestAnimationFrame: (callback) => { frames.push(callback); return frames.length; },
  });
  const event = (lonLat = [1, 2], buttons = 1) => ({ lonLat, buttons, pointerId: 7, preventDefault: record("prevent") });
  return { owner, state, tool, mode, calls, frames, event, channel: () => channel, replaceChannel: (value) => { channel = value; } };
}

test("brush captures before mutation, coalesces frames and commits live replacement channel on lost buttons", () => {
  const h = harness();
  h.owner.handlePhysicalIntensityPointerDown(h.event());
  h.owner.handlePhysicalIntensityPointerMove(h.event([2,3]));
  assert.equal(h.frames.length, 1);
  assert.equal(h.calls.filter(([n]) => n === "invalidate").length, 2);
  h.replaceChannel({ enabled: true, points: [], revision: 8, stamped: true });
  h.calls.length = 0;
  assert.equal(h.owner.handlePhysicalIntensityPointerMove(h.event([2,3],0)), true);
  assert.equal(h.channel().revision, 9);
  assert.deepEqual(h.calls.map(([n]) => n), ["preview-event", "release-pointer", "history-capture", "history", "suppress", "invalidate", "ui"]);
  const history = h.calls.find(([n]) => n === "history")[1];
  assert.equal(history.before.enabled, false);
  assert.equal(history.meta.reason, "physical-intensity-pointer-lost-buttons");
  assert.equal(history.kind, "physical-intensity-brush");
  assert.equal(h.frames.length, 1);
  h.frames.shift()();
  assert.deepEqual(h.calls.at(-1), ["render", "physical-intensity-field-drag"]);
  assert.equal(h.owner.handlePhysicalIntensityPointerEnd(h.event()), false);
});

test("unchanged stamp still enables channel but end records no history or suppression", () => {
  const h = harness(); h.mode.stamp = false; h.mode.captureThrows = true;
  assert.equal(h.owner.handlePhysicalIntensityPointerDown(h.event()), true);
  assert.equal(h.channel().enabled, true);
  h.calls.length = 0;
  assert.equal(h.owner.handlePhysicalIntensityPointerEnd(h.event()), true);
  assert.deepEqual(h.calls.map(([n]) => n), ["prevent", "preview-event", "release-pointer"]);
  assert.equal(h.frames.length, 0);
});

test("point creation then pointercancel uses normal bake and commit, without rollback", () => {
  const h = harness(); h.tool.subMode = "points"; h.tool.brushStrength = 0; h.tool.brushRadiusDeg = 0;
  h.owner.handlePhysicalIntensityPointerDown(h.event([190,-95]));
  const point = h.channel().points[0];
  assert.deepEqual({ ...point, id: "id" }, { id: "id", lon: 180, lat: -90, strength: 1, radiusDeg: 3, falloff: "smooth" });
  assert.equal(h.tool.selectedPointId, point.id);
  h.calls.length = 0;
  assert.equal(h.owner.handlePhysicalIntensityPointerEnd({ ...h.event(), type: "pointercancel" }), true);
  assert.deepEqual(h.calls.map(([n]) => n), ["prevent", "preview-event", "release-pointer", "bake", "history-capture", "history", "suppress", "invalidate", "ui"]);
  assert.equal(h.channel().points.length, 1);
  assert.equal(h.channel().revision, 1);
});

test("existing point selection is unchanged until drag, including wrapped radius and move clamping", () => {
  for (const dragMode of ["radius", "move"]) {
    const h = harness(); h.tool.subMode = "points";
    const point = { id: "p", lon: 179, lat: 0, radiusDeg: 1 };
    h.channel().points.push(point); h.mode.hit = { point, mode: dragMode };
    h.owner.handlePhysicalIntensityPointerDown(h.event());
    assert.equal(h.channel().points.length, 1);
    h.owner.handlePhysicalIntensityPointerMove(h.event(dragMode === "radius" ? [-179,0] : [190,-100]));
    if (dragMode === "radius") assert.equal(point.radiusDeg, 2);
    else assert.deepEqual([point.lon, point.lat], [180,-90]);
    h.owner.handlePhysicalIntensityPointerEnd(h.event());
    assert.equal(h.channel().revision, 1);
    assert.equal(h.calls.filter(([n]) => n === "bake").length, 1);
  }
});

test("inactive, readonly, nonprimary and invalid coordinates keep original return behavior", () => {
  const h = harness(); h.tool.active = false;
  assert.equal(h.owner.handlePhysicalIntensityPointerDown(h.event()), false);
  h.tool.active = true; h.state.startupReadonly = true;
  assert.equal(h.owner.handlePhysicalIntensityPointerDown(h.event()), true);
  assert.ok(h.calls.some(([n]) => n === "readonly"));
  h.state.startupReadonly = false;
  assert.equal(h.owner.handlePhysicalIntensityPointerDown(h.event([1,2],0)), true);
  assert.equal(h.owner.handlePhysicalIntensityPointerDown(h.event(null)), true);
  assert.equal(h.owner.handlePhysicalIntensityPointerEnd(h.event()), false);
  assert.equal(h.owner.handlePhysicalIntensityPointerMove(h.event()), false);
  assert.equal(h.calls.filter(([n]) => n === "history-capture").length, 0);
});
