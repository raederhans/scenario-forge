import test from "node:test";
import assert from "node:assert/strict";
import { createTransientOverlayRenderOwner } from "../js/core/renderer/transient_overlay_render_owner.js";

class Group {
  attrs = {};
  selections = new Map();
  attr(name, value) { this.attrs[name] = value; return this; }
  selectAll(selector) {
    if (!this.selections.has(selector)) {
      const selection = {
        rows: [], attrs: {}, removed: false, exited: false,
        data(rows, key) { this.rows = rows; this.keys = rows.map(key); return this; },
        enter() { return this; }, append() { return this; }, merge() { return this; },
        attr(name, value) { this.attrs[name] = this.rows.map((row, index) => typeof value === "function" ? value(row, index) : value); return this; },
        remove() { this.removed = true; this.rows = []; return this; },
        exit() { return { remove: () => { this.exited = true; } }; },
      };
      this.selections.set(selector, selection);
    }
    return this.selections.get(selector);
  }
}
function harness() {
  const h = {
    hover: new Group(), editor: new Group(), path: (feature) => feature.id || feature.geometry.type,
    project: ([x, y]) => [x * 2, y * 3], ensured: 0, facility: null,
    state: { renderPhase: "idle", specialZoneEditor: { active: true, vertices: [[1, 2], [3, 4]], zoneType: "custom" }, landIndex: new Map(), specialRegionsById: new Map(), waterRegionsById: new Map() },
    style: { fill: "blue", fillOpacity: 0.9, stroke: "red", strokeWidth: 0.5, dash: [2, 4] },
  };
  h.owner = createTransientOverlayRenderOwner({
    runtimeState: h.state,
    rendererSurfaceHost: {
      getHoverGroup: () => h.hover, getSpecialZoneEditorGroup: () => h.editor,
      getPathSvg: () => h.path, getProjection: () => h.project,
    },
    ensureSpecialZoneEditorState: () => { h.ensured++; },
    getSpecialZoneStyle: (feature) => { h.zoneType = feature.properties.type; return h.style; },
    DEFAULT_SPECIAL_ZONE_TYPE: "default", RENDER_PHASE_IDLE: "idle",
    isSpecialRegionEnabled: (feature) => feature.enabled !== false,
    isWaterRegionEnabled: (feature) => feature.enabled !== false,
    getFeatureId: (feature) => feature.id,
    getActiveFacilityHighlightEntry: () => h.facility,
    buildFacilityEntryKey: (entry) => entry.id,
  });
  return h;
}
const row = (group, selector) => group.selectAll(selector);

test("absent surfaces or paths skip drawing and editor normalization", () => {
  const h = harness();
  h.path = null;
  h.owner.renderSpecialZoneEditorOverlay(); h.owner.renderHoverOverlay();
  assert.equal(h.ensured, 0);
  assert.equal(h.editor.selections.size, 0);
  assert.equal(h.hover.selections.size, 0);
  h.path = () => "path"; h.hover = null; h.editor = null;
  assert.doesNotThrow(() => { h.owner.renderSpecialZoneEditorOverlay(); h.owner.renderHoverOverlay(); });
});

test("zone preview closes polygons without changing vertices and updates projected handles", () => {
  const h = harness();
  h.owner.renderSpecialZoneEditorOverlay();
  const paths = row(h.editor, "path.special-zone-editor-path");
  assert.deepEqual(paths.keys, ["draw-line"]);
  h.state.specialZoneEditor = { active: true, vertices: [[2, 3], [4, 5], [6, 7]] };
  h.project = () => null;
  h.path = (feature) => `new:${feature.geometry.type}`;
  h.owner.renderSpecialZoneEditorOverlay();
  assert.equal(h.zoneType, "default");
  assert.deepEqual(paths.keys, ["draw-poly", "draw-line"]);
  assert.deepEqual(paths.attrs.d, ["new:Polygon", "new:LineString"]);
  assert.deepEqual(paths.attrs["fill-opacity"], [0.6, 0]);
  assert.deepEqual(paths.rows[0].feature.geometry.coordinates[0], [[2, 3], [4, 5], [6, 7], [2, 3]]);
  assert.equal(h.state.specialZoneEditor.vertices.length, 3);
  assert.deepEqual(row(h.editor, "circle.special-zone-editor-point").attrs.cx, [-9999, -9999, -9999]);
  assert.equal(paths.exited, true);
});

test("disabled or emptied editor clears preview using the current surface", () => {
  const h = harness();
  h.owner.renderSpecialZoneEditorOverlay();
  const previous = h.editor;
  h.editor = new Group(); h.state.specialZoneEditor.active = false;
  h.owner.renderSpecialZoneEditorOverlay();
  assert.equal(row(h.editor, "*").removed, true);
  assert.equal(previous.selections.has("*"), false);
  h.state.specialZoneEditor.active = true; h.state.specialZoneEditor.vertices = [];
  h.owner.renderSpecialZoneEditorOverlay();
  assert.equal(h.ensured, 3);
});

test("hover feature precedence and enabled checks preserve water stroke rules", () => {
  const h = harness();
  for (const [field, map, id] of [["hoveredId", "landIndex", "land"], ["hoveredWaterRegionId", "waterRegionsById", "water"], ["hoveredSpecialRegionId", "specialRegionsById", "special"]]) {
    h.state[field] = id; h.state[map].set(id, { id });
    h.owner.renderHoverOverlay();
    assert.deepEqual(row(h.hover, "path.hovered-feature").keys, [id]);
  }
  assert.deepEqual(row(h.hover, "path.hovered-feature").attrs["stroke-width"], [1.25]);
  h.state.specialRegionsById.get("special").enabled = false;
  h.owner.renderHoverOverlay();
  assert.deepEqual(row(h.hover, "path.hovered-feature").rows, []);
  assert.equal(h.hover.attrs["aria-hidden"], "true");
  h.state.hoveredSpecialRegionId = null; h.state.hoveredWaterRegionId = null;
  h.owner.renderHoverOverlay();
  assert.deepEqual(row(h.hover, "path.hovered-feature").attrs["stroke-width"], [1.45]);
});

for (const [shape, expected] of [
  ["icon", "M 5 20 A 5 5 0 1 0 15 20 A 5 5 0 1 0 5 20 Z"],
  ["square", "M 5 15 L 15 15 L 15 25 L 5 25 Z"],
  ["diamond", "M 10 15 L 15 20 L 10 25 L 5 20 Z"],
]) {
  test(`facility ${shape} highlight uses current zoom and survives without a hovered feature`, () => {
    const h = harness();
    h.state.zoomTransform = { k: 2 };
    h.facility = { id: "facility", shape, projectedPoint: [10, 20], markerRadiusPx: 7.2 };
    h.owner.renderHoverOverlay();
    assert.deepEqual(row(h.hover, "path.hovered-facility-marker").attrs.d, [expected]);
    assert.equal(h.hover.attrs["aria-hidden"], "false");
    h.hover = new Group(); h.state.renderPhase = "interacting";
    h.owner.renderHoverOverlay();
    assert.equal(row(h.hover, "path.hovered-feature").removed, true);
    assert.equal(row(h.hover, "path.hovered-facility-marker").removed, true);
    assert.equal(h.hover.attrs["aria-hidden"], "true");
  });
}
