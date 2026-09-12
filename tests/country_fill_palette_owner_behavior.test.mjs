import test from "node:test";
import assert from "node:assert/strict";
import { createCountryFillPaletteOwner } from "../js/core/renderer/country_fill_palette_owner.js";

function harness() {
  const state = { colorRevision: 0, activeScenarioId: "tno" };
  let features = [
    { id: "a", country: "AA", color: "red" },
    { id: "b", country: "AA", color: "blue" },
    { id: "c", country: "AA", color: "blue" },
    { id: "d", country: "BB", color: "green" },
  ];
  const reads = [];
  const owner = createCountryFillPaletteOwner({
    state, getFeatures: () => features,
    getFeatureId: (feature) => feature.id,
    resolveCountryCode: (feature) => feature.country,
    isExcluded: (feature) => feature.excluded,
    resolveColor: (feature) => { reads.push(feature.id); return feature.color; },
  });
  return {
    state, owner, reads, features,
    replace: (next) => { features = next; },
    edit: (ids) => { state.colorRevision += 1; owner.notifyColorsChanged(ids); },
  };
}

test("initial build follows feature-order tie semantics and caches unchanged reads", () => {
  const h = harness();
  assert.deepEqual([...h.owner.getDominantFillColorMap()], [["AA", "blue"], ["BB", "green"]]);
  assert.equal(h.owner.getAppearanceRevision(), 1);
  h.reads.length = 0;
  h.owner.getDominantFillColorMap();
  assert.deepEqual(h.reads, []);
  h.features[2].color = null; h.edit(["c"]);
  assert.equal(h.owner.getDominantFillColorMap().get("AA"), "red");
  assert.deepEqual(h.reads, ["c"]);
});

test("single edits touch only listed features and bump appearance only when a dominant changes", () => {
  const h = harness(); h.owner.getDominantFillColorMap(); h.reads.length = 0;
  h.features[0].color = "pink"; h.edit(["a"]);
  assert.equal(h.owner.getDominantFillColorMap().get("AA"), "blue");
  assert.equal(h.owner.getAppearanceRevision(), 1);
  assert.deepEqual(h.reads, ["a"]);
  h.features[1].color = "pink"; h.edit(["b"]);
  assert.equal(h.owner.getDominantFillColorMap().get("AA"), "pink");
  assert.equal(h.owner.getAppearanceRevision(), 2);
  assert.deepEqual(h.reads, ["a", "b"]);
});

test("undo, excluded records and batched edits preserve earliest color tie order", () => {
  const h = harness(); h.owner.getDominantFillColorMap();
  h.features[1].color = "red"; h.features[2].color = "green"; h.edit(["b", "c", "b"]);
  assert.equal(h.owner.getDominantFillColorMap().get("AA"), "red");
  h.features[1].color = "blue"; h.features[2].color = "blue"; h.edit(["b", "c"]);
  assert.equal(h.owner.getDominantFillColorMap().get("AA"), "blue");
  h.features[1].excluded = true; h.edit(["b"]);
  assert.equal(h.owner.getDominantFillColorMap().get("AA"), "red");
  h.features[0].excluded = true; h.features[2].color = null; h.edit(["a", "c"]);
  assert.equal(h.owner.getDominantFillColorMap().has("AA"), false);
  assert.equal(h.owner.getDominantFillColorMap().get("BB"), "green");
});

test("unnotified and skipped color revisions fall back to a complete rebuild", () => {
  const h = harness(); h.owner.getDominantFillColorMap(); h.reads.length = 0;
  h.features[3].color = "black"; h.state.colorRevision += 1;
  assert.equal(h.owner.getDominantFillColorMap().get("BB"), "black");
  assert.equal(h.reads.length, 4);
  h.reads.length = 0;
  h.features[3].color = "white"; h.state.colorRevision += 1;
  h.features[0].color = "blue"; h.edit(["a"]);
  assert.equal(h.owner.getDominantFillColorMap().get("BB"), "white");
  assert.equal(h.reads.length, 4);
});

for (const key of ["activeScenarioId", "sceneGeneration", "scenarioDataGeneration", "topologyRevision", "sovereigntyRevision", "scenarioShellOverlayRevision", "mapSemanticMode", "showScenarioAtlantropa"]) {
  test(`${key} changes rebuild even when colorRevision is unchanged`, () => {
    const h = harness(); h.owner.getDominantFillColorMap(); h.reads.length = 0;
    h.state[key] = "changed";
    h.owner.getDominantFillColorMap();
    assert.equal(h.reads.length, 4);
    assert.equal(h.owner.getAppearanceRevision(), 1, "identical output must keep its appearance revision");
  });
}

test("replacement collections and removal cannot retain vanished country colors", () => {
  const h = harness(); h.owner.getDominantFillColorMap();
  h.replace([{ id: "a", country: "CC", color: "yellow" }]);
  assert.deepEqual([...h.owner.getDominantFillColorMap()], [["CC", "yellow"]]);
  h.replace([]);
  assert.equal(h.owner.getDominantFillColorMap().size, 0);
});

test("equal rebuilds preserve the published Map and still advance identity and color revision", () => {
  const h = harness();
  const first = h.owner.getDominantFillColorMap();
  h.state.sceneGeneration = 1;
  h.state.colorRevision += 1;
  assert.equal(h.owner.getDominantFillColorMap(), first);
  assert.equal(h.owner.getAppearanceRevision(), 1);
  h.reads.length = 0;
  assert.equal(h.owner.getDominantFillColorMap(), first);
  assert.deepEqual(h.reads, []);
  h.features[3].color = "white";
  h.edit(["d"]);
  assert.equal(h.owner.getDominantFillColorMap(), first);
  assert.equal(first.get("BB"), "white");
  assert.deepEqual(h.reads, ["d"]);
  assert.equal(h.owner.getAppearanceRevision(), 2);
});

test("duplicate IDs update all matching records without changing feature-order ties", () => {
  const h = harness(); h.features[2].id = "a"; h.owner.getDominantFillColorMap();
  h.features[0].color = "yellow"; h.features[2].color = "yellow"; h.reads.length = 0; h.edit(["a"]);
  assert.deepEqual(h.reads, ["a", "a"]);
  assert.equal(h.owner.getDominantFillColorMap().get("AA"), "yellow");
});

test("unknown notification with a newer revision rebuilds rather than blessing unknown changes", () => {
  const h = harness(); h.owner.getDominantFillColorMap();
  h.features[3].color = "white"; h.edit([]);
  assert.equal(h.owner.getDominantFillColorMap().get("BB"), "white");
});
