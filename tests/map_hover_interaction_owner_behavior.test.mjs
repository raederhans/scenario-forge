import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parse } from "acorn";
import * as walk from "acorn-walk";
import { createMapHoverInteractionOwner } from "../js/core/map_renderer/map_hover_interaction_owner.js";

const rendererSource = readFileSync(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
let lookupSource;
walk.simple(parse(rendererSource, { ecmaVersion: "latest", sourceType: "module" }), {
  CallExpression(node) {
    if (node.callee.name !== "createMapHoverInteractionOwner") return;
    const getters = node.arguments[0].properties.find(property => property.key.name === "getters").value;
    const lookup = getters.properties.find(property => property.key.name === "getFeatureForHit").value;
    lookupSource = rendererSource.slice(lookup.start, lookup.end);
  },
});
const createFeatureLookup = new Function("runtimeState", `return (${lookupSource});`);

function createHarness(overrides = {}) {
  const calls = [], pending = new Map(), cancelled = [];
  let next = 0;
  const clock = {
    requestAnimationFrame(fn) { assert.equal(this, clock); const id = next++; pending.set(id, fn); return id; },
    cancelAnimationFrame(id) { assert.equal(this, clock); cancelled.push(id); pending.delete(id); },
  };
  let globalHost = clock;
  const state = { lastMouseMoveTime: 0, MOUSE_THROTTLE_MS: 16, landData: {}, renderPhase: "idle",
    hoveredId: null, hoveredWaterRegionId: null, hoveredSpecialRegionId: null, ...overrides };
  const data = { now: 100, hit: {}, facility: null, city: null, detailsActive: false, block: false, selected: null, hgo: null };
  const surfaces = { tooltip: { style: {} }, rect: { style(key, value) { calls.push([key, value]); } } };
  const owner = createMapHoverInteractionOwner({
    state,
    surfaceHost: { getTooltip: () => surfaces.tooltip, getInteractionRect: () => surfaces.rect },
    constants: { hoverSnapPx: 9, renderPhaseIdle: "idle" },
    getters: {
      getGlobal: () => globalHost, nowMs: () => data.now,
      inspectHgoRuntimePreviewFromEvent: () => data.hgo,
      getHitFromEvent: (event, options) => { calls.push(["hit", options, event]); data.onHit?.(); return data.hit; },
      getFeatureForHit: createFeatureLookup(state),
      getHoveredFacilityEntryFromEvent: () => data.facility,
      isFacilityDetailsSurfaceActive: () => data.detailsActive,
      getHoveredCityTooltipEntry: () => { calls.push(["city"]); return data.city; },
      getTooltipTextForFeature: feature => { calls.push(["feature", feature]); return feature.label; },
      getOverlayProjectionSignature: () => "projection", getSelectedFacilityEntry: () => data.selected,
      shouldBlockUnderlyingSelectionForFacility: () => data.block,
    },
    effects: {
      updateDevHoverHit(hit) { state.devHoverHit = hit; calls.push(["dev", hit]); },
      renderHoverOverlay: () => calls.push(["draw"]),
      recordInteractionDurationMetric: (...args) => calls.push(["metric", ...args]),
      hidePhysicalIntensityBrushPreview: () => calls.push(["hideBrush"]),
    },
    helpers: { getFacilityKey: entry => entry ? entry.familyId + ":" + entry.stableId : "" },
  });
  return { owner, state, data, calls, pending, cancelled, clock, surfaces,
    setGlobal(value) { globalHost = value; },
    flush() { const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(fn => fn()); },
    move() { return owner.handleMouseMove({ clientX: 20, clientY: 30 }); } };
}

test("mousemove is throttled before writing hover state", () => {
  const h = createHarness({ lastMouseMoveTime: 95 });
  assert.equal(h.move().branch, "throttled");
  assert.equal(h.state.lastMouseMoveTime, 95);
  assert.equal(h.pending.size, 0); assert.deepEqual(h.calls, []);
});

test("scheduled moves query only the latest stable coordinates, once per frame", () => {
  const h = createHarness();
  const event = { clientX: 1, clientY: 2 };
  h.owner.scheduleMouseMove(event);
  event.clientX = 99;
  h.owner.scheduleMouseMove({ clientX: 50, clientY: 60 });
  assert.equal(h.pending.size, 1);
  assert.equal(h.calls.length, 0);
  h.flush();
  const hits = h.calls.filter(([name]) => name === "hit");
  assert.equal(hits.length, 1);
  assert.equal(hits[0][2].clientX, 50);
  assert.equal(hits[0][2].clientY, 60);
  // A final move on a high-refresh display must not disappear into the
  // legacy 16ms event throttle after its animation-frame slot was consumed.
  h.data.now += 8;
  h.owner.scheduleMouseMove({ clientX: 70, clientY: 80 });
  h.flush();
  assert.equal(h.calls.filter(([name]) => name === "hit").length, 2);
});

test("mouseleave and reset invalidate late hover-hit callbacks", () => {
  for (const cancel of ["handleMapMouseLeave", "cancelPendingHoverWork"]) {
    const h = createHarness();
    h.owner.scheduleMouseMove({ clientX: 10, clientY: 20 });
    const stale = [...h.pending.values()];
    h.owner[cancel]();
    const count = h.calls.length;
    stale.forEach((callback) => callback());
    assert.equal(h.calls.length, count);
    assert.equal(h.pending.size, 0);
  }
});

test("hover can queue a new frame during a hit callback and rechecks exclusive modes", () => {
  const h = createHarness();
  h.data.onHit = () => { h.data.onHit = null; h.owner.scheduleMouseMove({ clientX: 30, clientY: 40 }); };
  h.owner.scheduleMouseMove({ clientX: 10, clientY: 20 });
  h.flush();
  h.state.specialZoneEditor = { active: true };
  h.flush();
  assert.equal(h.calls.filter(([name]) => name === "hit").length, 1);
  assert.equal(h.state.hoveredId, null);
});

test("no hover data stops before event resolution", () => {
  const h = createHarness({ landData: null });
  assert.equal(h.move().branch, "no-hover-data");
  assert.equal(h.state.lastMouseMoveTime, 100); assert.deepEqual(h.calls, []);
});

test("special-zone editor and HGO exclusive hover clear underlying targets", () => {
  for (const mode of ["editor", "hgo"]) {
    const h = createHarness({ hoveredId: "old", specialZoneEditor: { active: mode === "editor" } });
    h.owner.setHoveredFacilityEntry({ familyId: "port", stableId: "old" });
    h.data.hgo = mode === "hgo" ? { active: true, hit: { id: "hgo" } } : null;
    assert.equal(h.move().branch, mode === "editor" ? "special-zone-editor" : "hgo-runtime-hover");
    assert.equal(h.state.hoveredId, null); assert.equal(h.owner.getHoveredFacilityEntry(), null);
    assert.equal(h.state.tooltipPendingState.visible, false);
    assert.equal(h.state.devHoverHit?.id || null, mode === "hgo" ? "hgo" : null);
    h.flush(); assert.equal(h.surfaces.tooltip.style.opacity, "0");
  }
});

test("reduced hover clears map and facility targets with one overlay frame", () => {
  const h = createHarness({ renderPhase: "interacting", hoveredId: "old" });
  h.owner.setHoveredFacilityEntry({ familyId: "port", stableId: "old" });
  assert.equal(h.move().branch, "reduced-hover");
  assert.equal(h.state.hoveredId, null); assert.equal(h.owner.getHoveredFacilityEntry(), null);
  assert.equal(h.pending.size, 2);
  h.flush(); assert.equal(h.calls.filter(([name]) => name === "draw").length, 1);
});

test("land water and special hover resolve live state before tooltip probing", () => {
  const h = createHarness();
  for (const [type, field, index] of [["land", "hoveredId", "landIndex"], ["water", "hoveredWaterRegionId", "waterRegionsById"], ["special", "hoveredSpecialRegionId", "specialRegionsById"]]) {
    h.state[index] = new Map([[type, { label: type }]]);
    h.data.hit = { id: type, targetType: type }; h.data.now += 20;
    assert.equal(h.move().branch, "feature-tooltip");
    assert.equal(h.state[field], type); assert.equal(h.state.tooltipPendingState.text, type);
  }
  assert.deepEqual(h.calls.find(([name]) => name === "hit")[1], { enableSnap: false, snapPx: 9, eventType: "hover" });
});

test("missing tooltip still updates hover IDs", () => {
  const h = createHarness(); h.surfaces.tooltip = null; h.data.hit = { id: "land", targetType: "land" };
  assert.equal(h.move().branch, "no-tooltip"); assert.equal(h.state.hoveredId, "land");
});

test("facility tooltip wins over city and feature without changing selection", () => {
  const h = createHarness(); const selected = h.data.selected = { familyId: "port", stableId: "selected" };
  h.data.facility = { familyId: "airport", stableId: "hover", tooltipText: "Airport" };
  h.data.detailsActive = true; h.data.city = { tooltipText: "City" };
  assert.equal(h.move().branch, "facility-tooltip");
  assert.equal(h.owner.getHoveredFacilityEntry(), h.data.facility); assert.equal(h.data.selected, selected);
  assert.deepEqual(h.state.tooltipPendingState, { visible: true, text: "Airport", x: 32, y: 42 });
  assert.deepEqual(h.calls.find(([name]) => name === "cursor"), ["cursor", "pointer"]);
  assert.equal(h.calls.some(([name]) => name === "city" || name === "feature"), false);
  h.owner.handleMapMouseLeave(); assert.equal(h.data.selected, selected);
});

test("facility suppression clears underlying hover before city or feature probes", () => {
  const h = createHarness(); h.data.hit = { id: "L1", targetType: "land" };
  h.data.facility = { familyId: "port", stableId: "P1" }; h.data.block = true;
  assert.equal(h.move().branch, "facility-blocked-underlying");
  assert.equal(h.state.hoveredId, null); assert.equal(h.state.devHoverHit, null);
  assert.equal(h.calls.some(([name]) => name === "city"), false);
});

test("city tooltip and empty hover preserve fallback priority", () => {
  const h = createHarness(); h.data.city = { tooltipText: "Capital" };
  assert.equal(h.move().branch, "city-tooltip"); assert.equal(h.state.tooltipPendingState.text, "Capital");
  h.data.city = null; h.data.now += 20;
  assert.equal(h.move().branch, "empty-hover"); assert.equal(h.state.tooltipPendingState.visible, false);
});

test("tooltip frame zero coalesces updates and applies the latest payload to the live surface", () => {
  const h = createHarness(); const first = { visible: true, text: "first" };
  h.owner.queueTooltipUpdate(first); assert.equal(h.state.tooltipRafHandle, 0);
  first.text = "mutated"; assert.equal(h.state.tooltipPendingState.text, "first");
  h.owner.queueTooltipUpdate({ visible: true, text: "last", x: 2.6, y: 4.2 });
  assert.equal(h.pending.size, 1);
  const old = h.surfaces.tooltip; h.surfaces.tooltip = { style: {} }; h.flush();
  assert.equal(old.textContent, undefined); assert.equal(h.surfaces.tooltip.textContent, "last");
  assert.equal(h.surfaces.tooltip.style.transform, "translate3d(3px, 4px, 0)");
  assert.equal(h.state.tooltipRafHandle, null); assert.equal(h.state.tooltipPendingState, null);
});

test("mouseleave cancels frame zero and tooltip before drawing the cleared state", () => {
  const h = createHarness(); h.data.hit = { id: "L1", targetType: "land" }; h.move();
  const late = [...h.pending.values()]; h.owner.handleMapMouseLeave();
  assert.deepEqual(h.cancelled, [0, 1]); assert.equal(h.pending.size, 0);
  assert.equal(h.state.hoveredId, null); assert.equal(h.state.tooltipPendingState, null);
  assert.equal(h.surfaces.tooltip.style.opacity, "0");
  const count = h.calls.length; late.forEach(fn => fn()); assert.equal(h.calls.length, count);
  assert.equal(h.calls.at(-1)[0], "hideBrush");
});

test("reset ignores late callbacks without clearing a newly scheduled tooltip", () => {
  const h = createHarness(); h.owner.queueTooltipUpdate({ visible: true, text: "stale" });
  const late = [...h.pending.values()]; h.owner.cancelPendingHoverWork();
  assert.deepEqual(h.cancelled, [0]);
  h.owner.queueTooltipUpdate({ visible: true, text: "new" });
  const handle = h.state.tooltipRafHandle; late.forEach(fn => fn());
  assert.equal(h.state.tooltipRafHandle, handle); h.flush();
  assert.equal(h.surfaces.tooltip.textContent, "new");
});

test("fallback cancellation stays paired when global scheduler APIs change", () => {
  const h = createHarness(); const cancelled = []; let callback;
  const fallback = {
    setTimeout(fn, delay) { assert.equal(this, fallback); assert.equal(delay, 0); callback = fn; return 0; },
    clearTimeout(id) { assert.equal(this, fallback); cancelled.push(id); },
  };
  h.setGlobal(fallback); h.owner.queueTooltipUpdate({ visible: true, text: "old" });
  fallback.clearTimeout = () => assert.fail("must retain paired cancel function");
  h.setGlobal(h.clock); h.owner.resetTooltipState(); assert.deepEqual(cancelled, [0]); callback();
  assert.equal(h.surfaces.tooltip.style.opacity, "0");
  h.owner.queueTooltipUpdate({ visible: true, text: "raf" }); h.flush(); assert.equal(h.surfaces.tooltip.textContent, "raf");
});

test("overlay signature responds to external state and selected facility changes", () => {
  const h = createHarness(); h.owner.renderHoverOverlayIfNeeded(); h.owner.renderHoverOverlayIfNeeded();
  assert.equal(h.calls.filter(([name]) => name === "draw").length, 1);
  h.state.hoveredId = "new"; h.owner.renderHoverOverlayIfNeeded();
  h.data.selected = { familyId: "port", stableId: "selected", projectedPoint: [12, 13] }; h.owner.renderHoverOverlayIfNeeded();
  h.owner.setHoverOverlayDirty(); h.owner.renderHoverOverlayIfNeeded();
  h.owner.renderHoverOverlayIfNeeded({ force: true, eventType: "test" });
  assert.equal(h.calls.filter(([name]) => name === "draw").length, 5);
  assert.equal(h.state.hoverOverlayDirty, false); assert.deepEqual(h.calls.at(-1).at(-1), { eventType: "test", force: true });
});

test("owner fails fast for missing explicit dependencies", () => {
  assert.throws(() => createMapHoverInteractionOwner(), /getters.nowMs must be a function/);
});
