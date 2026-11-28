import test from "node:test";
import assert from "node:assert/strict";
import { createTransientOverlayRenderOwner } from "../js/core/renderer/transient_overlay_render_owner.js";

class Group {
  selections = new Map();
  attr() { return this; }
  selectAll(selector) {
    if (!this.selections.has(selector)) {
      const selection = {
        data(rows) { this.rows = rows; return this; },
        enter() { return this; }, append() { return this; }, merge() { return this; },
        attr() { return this; },
        exit() { return { remove() {} }; },
      };
      this.selections.set(selector, selection);
    }
    return this.selections.get(selector);
  }
}
function harness() {
  const h = {
    editor: new Group(), state: {},
  };
  h.owner = createTransientOverlayRenderOwner(h.state, {
    rendererSurfaceHost: {
      getSpecialZoneEditorGroup: () => h.editor,
      getPathSvg: () => (feature) => feature.geometry.type,
      getProjection: () => (point) => point,
    },
    ensureSpecialZoneEditorState() {},
    getSpecialZoneStyle: () => ({ dash: [] }),
    DEFAULT_SPECIAL_ZONE_TYPE: "default",
  });
  return h;
}
const row = (group, selector) => group.selectAll(selector);

test("zone preview closes polygons without changing vertices", () => {
  const h = harness();
  h.state.specialZoneEditor = { active: true, vertices: [[2, 3], [4, 5], [6, 7]] };
  h.owner.renderSpecialZoneEditorOverlay();
  const paths = row(h.editor, "path.special-zone-editor-path");
  assert.deepEqual(paths.rows[0].feature.geometry.coordinates[0], [[2, 3], [4, 5], [6, 7], [2, 3]]);
  assert.equal(h.state.specialZoneEditor.vertices.length, 3);
});
