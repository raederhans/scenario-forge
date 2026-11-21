import assert from "node:assert/strict";
import test from "node:test";
import { clearHistory, pushHistoryEntry } from "../js/core/history_manager.js";
import { bindRenderBoundary } from "../js/core/render_boundary.js";
import { state } from "../js/core/state.js";
import { bindHistoryPanel } from "../js/ui/history_panel.js";

function mount() {
  const panel = {
    rows: [],
    replaceChildren() { this.rows = []; this.textContent = ""; },
    appendChild(row) { this.rows.push(row); },
  };
  const dropdown = new EventTarget();
  dropdown.ownerDocument = Object.assign(new EventTarget(), { createElement: () => new EventTarget() });
  dropdown.querySelector = (selector) => selector === "summary" ? { focus() {} } : panel;
  bindHistoryPanel(dropdown);
  const open = () => {
    dropdown.open = true;
    dropdown.dispatchEvent(new Event("toggle"));
  };
  return { panel, open, dropdown };
}

test("history keeps 200 entries and the dropdown jumps to the state after a listed edit with one flush", (ctx) => {
  clearHistory();
  state.currentLanguage = "en";
  state.visualOverrides = {};
  state.mapLabels = [];
  const { panel, open, dropdown } = mount();
  open();
  assert.equal(panel.textContent, "No history yet");

  for (let i = 1; i <= 201; i++) {
    const before = { visualOverrides: { a: i - 1 } };
    state.visualOverrides.a = i;
    pushHistoryEntry({ kind: "fill-feature-color", before, after: { visualOverrides: { a: i } } });
  }
  state.mapLabels = [{ id: "end" }];
  pushHistoryEntry({ kind: "place-map-label", before: { mapLabels: [] }, after: { mapLabels: state.mapLabels } });
  assert.equal(state.historyPast.length, 200);
  assert.equal(state.historyPast[0].after.visualOverrides.a, 3);
  const flushes = [];
  bindRenderBoundary({ flushRender: ({ reason }) => flushes.push(reason) });
  ctx.after(() => bindRenderBoundary());

  open();
  assert.equal(panel.rows.length, 50);
  assert.equal(panel.rows[0].disabled, true);
  assert.equal(panel.rows[0].textContent, "Current: Place map label");
  assert.equal(panel.rows[49].textContent, "Return to: Paint 1 region");
  panel.rows[49].dispatchEvent(new Event("click"));
  assert.equal(dropdown.open, false);
  assert.equal(state.visualOverrides.a, 153);
  assert.deepEqual(state.mapLabels, []);
  assert.equal(state.historyFuture.length, 49);
  assert.deepEqual(flushes, ["history-undo"]);

  open();
  assert.equal(panel.rows[49].disabled, true);
  assert.equal(panel.rows[0].textContent, "Redo: Place map label");
  panel.rows[0].dispatchEvent(new Event("click"));
  assert.equal(state.visualOverrides.a, 201);
  assert.equal(state.mapLabels[0].id, "end");
  assert.equal(state.historyFuture.length, 0);
  assert.deepEqual(flushes, ["history-undo", "history-redo"]);
});
