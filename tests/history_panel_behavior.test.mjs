import assert from "node:assert/strict";
import test from "node:test";
import { clearHistory, pushHistoryEntry } from "../js/core/history_manager.js";
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
  return { panel, open };
}

test("history list jumps back and forward across paint and label edits", () => {
  clearHistory();
  state.visualOverrides = {};
  state.mapLabels = [];
  const { panel, open } = mount();
  for (let i = 1; i <= 201; i++) {
    const before = { visualOverrides: { a: i - 1 } };
    state.visualOverrides.a = i;
    pushHistoryEntry({ kind: "fill-feature-color", before, after: { visualOverrides: { a: i } } });
  }
  state.mapLabels = [{ id: "end" }];
  pushHistoryEntry({ kind: "place-map-label", before: { mapLabels: [] }, after: { mapLabels: state.mapLabels } });
  open();
  panel.rows[49].dispatchEvent(new Event("click"));
  assert.equal(state.visualOverrides.a, 153);
  assert.deepEqual(state.mapLabels, []);

  open();
  panel.rows[0].dispatchEvent(new Event("click"));
  assert.equal(state.visualOverrides.a, 201);
  assert.equal(state.mapLabels[0].id, "end");
});
