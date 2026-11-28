import test from "node:test";
import assert from "node:assert/strict";
import { createRevisionedLegendColorReader } from "../js/core/legend_manager.js";
import { replaceResolvedColorsState } from "../js/core/state/color_state.js";

test("legend color reads follow replacements and isolate returned arrays", () => {
  const state = { colors: { A: "#112233", B: "#445566" }, colorRevision: 0 };
  const read = createRevisionedLegendColorReader();
  read(state).push("#000000");
  assert.deepEqual(read(state), ["#112233", "#445566"]);
  replaceResolvedColorsState(state, { C: "#778899" });
  assert.deepEqual(read(state), ["#778899"]);
});
