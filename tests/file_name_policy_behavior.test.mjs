import test from "node:test";
import assert from "node:assert/strict";
import { buildDefaultFileStem } from "../js/core/file_name_policy.js";

const date = new Date(2026, 0, 9, 3, 4, 59);

test("default names prefer the project name, imported filename, scenario, then map", () => {
  const state = { projectName: "项目", projectFileStem: "Atlas.v2", activeScenarioId: "tno_1962" };
  assert.equal(buildDefaultFileStem(state, date), "项目_20260109-0304");
  state.projectName = " ";
  assert.equal(buildDefaultFileStem(state, date), "Atlas.v2_20260109-0304");
  state.projectFileStem = "";
  assert.equal(buildDefaultFileStem(state, date), "tno_1962_20260109-0304");
  assert.equal(buildDefaultFileStem({}, date), "map_20260109-0304");
});

test("default names remove illegal characters before choosing a usable stem", () => {
  const state = { projectName: ' A\\/B:*?"<>| C ' };
  assert.equal(buildDefaultFileStem(state, date), "AB C_20260109-0304");
  assert.equal(buildDefaultFileStem({ projectName: "|", projectFileStem: "Atlas" }, date), "Atlas_20260109-0304");
});

test("truncation keeps the timestamp and export suffix within 80 characters", () => {
  const suffix = "_snapshot.png";
  const stem = buildDefaultFileStem({ projectName: "🌏".repeat(100) }, date, suffix);
  assert.equal(stem + suffix, "🌏".repeat(53) + "_20260109-0304_snapshot.png");
});
