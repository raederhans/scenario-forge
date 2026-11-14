import test from "node:test";
import assert from "node:assert/strict";

import { createStrategicOverlayRenderOwner } from "../js/core/renderer/strategic_overlay_render_owner.js";

test("strategic overlay render owner renders dirty overlays once per signature", () => {
  const calls = [];
  const state = {
    annotationView: {
      showUnitLabels: true,
      unitRendererDefault: "game",
    },
    dirtyRevision: 1,
    operationGraphics: [{ id: "opg_1" }],
    operationGraphicsDirty: true,
    operationGraphicsEditor: { active: false, points: [], selectedId: "" },
    operationalLineEditor: { active: false, points: [], selectedId: "" },
    operationalLines: [{ id: "opl_1" }],
    operationalLinesDirty: true,
    renderPhase: "idle",
    showSpecialZones: true,
    specialZoneEditor: { active: false, selectedId: "" },
    specialZonesOverlayDirty: true,
    topologyRevision: 3,
    unitCounterEditor: { active: false, selectedId: "" },
    unitCounters: [{ id: "unit_1" }],
    unitCountersDirty: true,
    zoomTransform: { k: 1.5 },
  };

  const owner = createStrategicOverlayRenderOwner({
    state,
    helpers: {
      getProjectionRenderSignature: () => "projection-a",
    },
    renderers: {
      renderOperationGraphicsOverlay: () => calls.push("operationGraphics"),
      renderOperationalLinesOverlay: () => calls.push("operationalLines"),
      renderSpecialZones: () => calls.push("specialZones"),
      renderUnitCountersOverlay: () => calls.push("unitCounters"),
    },
  });

  assert.equal(owner.renderOperationalLinesIfNeeded(), true);
  assert.equal(owner.renderOperationGraphicsIfNeeded(), true);
  assert.equal(owner.renderUnitCountersIfNeeded(), true);
  assert.equal(owner.renderSpecialZonesIfNeeded(), true);
  assert.deepEqual(calls, ["operationalLines", "operationGraphics", "unitCounters", "specialZones"]);
  assert.equal(state.operationalLinesDirty, false);
  assert.equal(state.operationGraphicsDirty, false);
  assert.equal(state.unitCountersDirty, false);
  assert.equal(state.specialZonesOverlayDirty, false);

  assert.equal(owner.renderOperationalLinesIfNeeded(), false);
  assert.equal(owner.renderOperationGraphicsIfNeeded(), false);
  assert.equal(owner.renderUnitCountersIfNeeded(), false);
  assert.equal(owner.renderSpecialZonesIfNeeded(), false);
  assert.equal(calls.length, 4);
});

test("strategic overlay render owner force renders and skips non-idle dynamic overlays", () => {
  const calls = [];
  const state = {
    annotationView: {},
    renderPhase: "drawing",
    topologyRevision: 1,
    zoomTransform: { k: 2 },
  };

  const owner = createStrategicOverlayRenderOwner({
    state,
    helpers: {
      getProjectionRenderSignature: () => "projection-b",
    },
    renderers: {
      renderOperationGraphicsOverlay: () => calls.push("operationGraphics"),
      renderOperationalLinesOverlay: () => calls.push("operationalLines"),
      renderUnitCountersOverlay: () => calls.push("unitCounters"),
      syncUnitCounterScalesDuringZoom: () => {
        calls.push("sync");
        return false;
      },
    },
  });

  assert.equal(owner.renderOperationalLinesIfNeeded(), false);
  assert.equal(owner.renderOperationGraphicsIfNeeded(), false);
  assert.equal(owner.renderUnitCountersIfNeeded(), false);
  assert.deepEqual(calls, []);

  assert.equal(owner.renderUnitCountersIfNeeded({ force: true }), true);
  owner.syncUnitCounterScalesDuringZoom();
  assert.deepEqual(calls, ["unitCounters", "sync"]);
});

test("strategic overlay render owner materializes an empty visible counter layer once during zoom", () => {
  const calls = [];
  const state = {
    annotationView: {},
    renderPhase: "interacting",
    topologyRevision: 1,
    unitCounters: [{ id: "unit_1" }],
    unitCountersDirty: false,
    zoomTransform: { k: 7 },
  };
  let needsMaterialization = true;
  const owner = createStrategicOverlayRenderOwner({
    state,
    helpers: {
      getProjectionRenderSignature: () => "projection-c",
    },
    renderers: {
      renderUnitCountersOverlay: () => calls.push("unitCounters"),
      syncUnitCounterScalesDuringZoom: () => {
        calls.push("sync");
        const result = needsMaterialization;
        needsMaterialization = false;
        return result;
      },
    },
  });

  assert.equal(owner.syncUnitCounterScalesDuringZoom(), true);
  assert.deepEqual(calls, ["sync", "unitCounters"]);
  assert.equal(state.unitCountersDirty, false);

  assert.equal(owner.syncUnitCounterScalesDuringZoom(), false);
  assert.deepEqual(calls, ["sync", "unitCounters", "sync"]);

  state.renderPhase = "idle";
  assert.equal(owner.renderUnitCountersIfNeeded(), false);
});

test("strategic overlay render owner dirty API stays strategic-only", () => {
  const state = {
    hoverOverlayDirty: false,
    inspectorOverlayDirty: false,
    operationGraphicsDirty: false,
    operationalLinesDirty: false,
    specialZonesOverlayDirty: false,
    unitCountersDirty: false,
  };
  const owner = createStrategicOverlayRenderOwner({ state });

  owner.markOverlaysDirty({
    hover: true,
    inspector: true,
    operationGraphics: true,
    operationalLines: true,
    specialZones: true,
    unitCounters: true,
  });

  assert.equal(state.operationalLinesDirty, true);
  assert.equal(state.operationGraphicsDirty, true);
  assert.equal(state.unitCountersDirty, true);
  assert.equal(state.specialZonesOverlayDirty, true);
  assert.equal(state.inspectorOverlayDirty, false);
  assert.equal(state.hoverOverlayDirty, false);
});
