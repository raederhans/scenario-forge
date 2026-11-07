import assert from "node:assert/strict";
import test from "node:test";
import { resolveInspectorDrillStep } from "../js/core/inspector_drilldown.js";

const groups = [
  { id: "g1", label: "One", children: ["a", "b"] },
  { id: "g2", label: "Two", children: ["c", "d"] },
  { id: "g3", label: "Single", children: ["e"] },
];
const findGroup = (code, id) => groups.find((group) => group.children.includes(id)) || null;
const resolve = (current, id, detail = 1, code = "AA") => resolveInspectorDrillStep({
  current, hit: { countryCode: code, featureId: id }, findGroup, detail,
});

test("first click and switching country select country", () => {
  for (const current of [{}, { countryCode: "BB", level: "feature", featureId: "c" }]) {
    assert.deepEqual(resolve(current, "a"), { level: "country", countryCode: "AA" });
  }
});
test("country drills to multi-member group or directly to a parcel", () => {
  const current = { countryCode: "AA", level: "country" };
  assert.deepEqual(resolve(current, "a"), { level: "group", countryCode: "AA", group: groups[0] });
  for (const id of ["e", "ungrouped"]) {
    const step = resolve(current, id);
    assert.equal(step.level, "feature");
    assert.equal(step.featureId, id);
    assert.equal(step.group, findGroup("AA", id));
  }
});
test("group and parcel selection move within a group or switch groups", () => {
  for (const level of ["group", "feature"]) {
    const current = { countryCode: "AA", level, groupId: "g1", featureId: level === "feature" ? "a" : "" };
    for (const id of ["a", "b"]) {
      assert.deepEqual(resolve(current, id), { level: "feature", countryCode: "AA", group: groups[0], featureId: id });
    }
    assert.deepEqual(resolve(current, "c"), { level: "group", countryCode: "AA", group: groups[1] });
    assert.equal(resolve(current, "e").level, "feature");
    assert.equal(resolve(current, "ungrouped").level, "feature");
  }
});
test("subsequent double-click events preserve the previous result", () => {
  for (const level of ["country", "group", "feature"]) {
    const current = Object.freeze({ countryCode: "AA", level, groupId: "g1", featureId: "a" });
    assert.equal(resolve(current, "c", 2), current);
    assert.equal(resolve(current, "c", 3), current);
  }
});
