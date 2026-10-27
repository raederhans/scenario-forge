import test from "node:test";
import assert from "node:assert/strict";
import { createSelectionOverlayOwner } from "../js/core/renderer/selection_overlay_owner.js";

class Group {
  constructor() { this.attrs = {}; this.rows = []; this.renders = 0; }
  attr(name, value) { this.attrs[name] = value; return this; }
  selectAll(selector) {
    const group = this;
    const selection = {
      data(rows, key) { group.renders++; group.rows = rows; group.keys = rows.map(key); return this; },
      enter() { return this; },
      append(tag) { group.tag = tag; return this; },
      attr(name, value) { group.pathAttrs ||= {}; group.pathAttrs[name] = value; return this; },
      merge() { return this; },
      exit() { return { remove() {} }; },
      remove() { group.renders++; group.rows = []; return this; },
    };
    group.selector = selector;
    return selection;
  }
}
const feature = (id, code = "AA") => ({ type: "Feature", id, properties: { code } });
function harness() {
  const h = {
    ids: ["a", "b"], features: [feature("a"), feature("b")],
    inspector: { featureIds: ["a"], countryCode: "", groupMode: false, label: "Alpha" },
    topology: { objects: { political: { geometries: [{ id: "a" }, { id: "b" }] } } },
    members: { AA: ["a", "b"] },
    merged: [], devGroup: new Group(), inspectorGroup: new Group(), path: () => "path",
    projection: "projection-1", revision: 1, devDirty: true, inspectorDirty: true, clean: [0, 0],
  };
  h.index = new Map(h.features.map((value) => [value.id, value]));
  h.topojson = { merge: (_topology, geometries) => {
    h.merged.push(geometries);
    return { type: "MultiPolygon", coordinates: [] };
  } };
  h.owner = createSelectionOverlayOwner({
    getOverlayProjectionSignature: () => h.projection,
    getTopologyRevision: () => h.revision,
    getDevSelectionIds: () => h.ids,
    getInspectorSelection: () => h.inspector,
    getLandFeatures: () => h.features,
    getLandIndex: () => h.index,
    getRuntimeTopology: () => h.topology,
    getTopojson: () => h.topojson,
    getFeatureId: (value) => value.id,
    getEntityFeatureId: (value) => value.id,
    getCountryFeatureIds: (code) => h.members[code] || [],
    getDevGroup: () => h.devGroup,
    getInspectorGroup: () => h.inspectorGroup,
    getPath: () => h.path,
    isDevDirty: () => h.devDirty,
    isInspectorDirty: () => h.inspectorDirty,
    markDevClean: () => { h.devDirty = false; h.clean[0]++; },
    markInspectorClean: () => { h.inspectorDirty = false; h.clean[1]++; },
  });
  return h;
}

test("equal geometry counts cannot merge a different selection", () => {
  const h = harness();
  h.ids = ["a", "b", "c"];
  h.topology.objects.political.geometries = [{ id: "a" }, { id: "c" }];
  h.owner.renderDevSelectionOverlay();
  assert.deepEqual(h.merged, []);
  assert.deepEqual(h.devGroup.rows, h.features);
});

test("merge matches actual fallback IDs and preserves selection order", () => {
  const h = harness();
  h.ids = ["b", "a", "missing"];
  h.owner.renderDevSelectionOverlay();
  assert.deepEqual(h.merged[0].map((geometry) => geometry.id), ["b", "a"]);
  assert.equal(h.devGroup.rows.length, 1);
  assert.equal(h.devGroup.rows[0].properties.selectionGeometry, "topology-boolean-merge");
  assert.equal(h.devGroup.attrs["aria-label"], "Development selection overlay (2)");
  assert.equal(h.devGroup.pathAttrs["vector-effect"], "non-scaling-stroke");
  assert.equal(h.devGroup.pathAttrs.d, h.path);
});

for (const fault of ["missing-feature-id", "unrequested-feature", "duplicate-feature", "duplicate-request", "duplicate-topology", "cross-object-duplicate", "missing-topology", "missing-merge", "null-merge", "throw-merge"]) {
  test(`unsafe merge falls back unchanged: ${fault}`, () => {
    const h = harness();
    if (fault === "missing-feature-id") h.index.set("a", feature(""));
    if (fault === "unrequested-feature") h.index.set("a", feature("c"));
    if (fault === "duplicate-feature") h.index.set("a", h.index.get("b"));
    if (fault === "duplicate-request") h.ids = ["a", "b", "a"];
    if (fault === "duplicate-topology") h.topology.objects.political.geometries.push({ id: "a" });
    if (fault === "cross-object-duplicate") h.topology.objects.scenario_atlantropa = { geometries: [{ id: "a" }] };
    if (fault === "missing-topology") h.topology = null;
    if (fault === "missing-merge") h.topojson = null;
    if (fault === "null-merge") h.topojson.merge = () => null;
    if (fault === "throw-merge") h.topojson.merge = () => { throw Error("invalid arcs"); };
    const expected = h.ids.map((id) => h.index.get(id)).filter(Boolean);
    h.owner.renderDevSelectionOverlay();
    assert.deepEqual(h.devGroup.rows, expected);
    assert.deepEqual(h.merged, []);
  });
}

for (const kind of ["dev", "inspector"]) {
  const methods = kind === "dev" ? ["renderDevSelectionOverlayIfNeeded", "devGroup", "devDirty", 0]
    : ["renderInspectorHighlightOverlayIfNeeded", "inspectorGroup", "inspectorDirty", 1];
  test(`${kind} caches only a present surface and redraws replacement group or path`, () => {
    const h = harness();
    const [method, groupKey, dirtyKey, cleanIndex] = methods;
    h[groupKey] = null;
    h.owner[method]();
    assert.equal(h.clean[cleanIndex], 0);
    assert.equal(h[dirtyKey], true);
    h[groupKey] = new Group();
    h.path = null;
    h.owner[method]();
    assert.equal(h.clean[cleanIndex], 0);
    h.path = () => "first";
    h.owner[method]();
    assert.equal(h[groupKey].renders, 1);
    h.owner[method]();
    assert.equal(h[groupKey].renders, 1);
    h[groupKey] = new Group();
    h.owner[method]();
    assert.equal(h[groupKey].renders, 1);
    h.path = () => "second";
    h.owner[method]();
    assert.equal(h[groupKey].renders, 2);
    h.owner[method]({ force: true });
    assert.equal(h[groupKey].renders, 3);
    h[dirtyKey] = true;
    h.owner[method]();
    assert.equal(h[groupKey].renders, 4);
  });
  test(`${kind} projection changes invalidate an otherwise clean surface`, () => {
    const h = harness();
    const [method, groupKey] = methods;
    h.owner[method]();
    h.projection = "projection-2";
    h.owner[method]();
    assert.equal(h[groupKey].renders, 2);
  });
}

test("inspector label changes update aria text even when selected IDs stay fixed", () => {
  const h = harness();
  h.owner.renderInspectorHighlightOverlayIfNeeded();
  h.inspector.label = "Beta";
  h.owner.renderInspectorHighlightOverlayIfNeeded();
  assert.equal(h.inspectorGroup.renders, 2);
  assert.equal(h.inspectorGroup.attrs["aria-label"], "Inspector highlight overlay for Beta");
});

test("inspector group, individual, country and empty selection retain overlay behavior", () => {
  const h = harness();
  h.inspector = { featureIds: [" a ", "a", "b"], groupMode: true, label: "Group" };
  h.owner.renderInspectorHighlightOverlay();
  assert.equal(h.inspectorGroup.rows.length, 1);
  assert.equal(h.inspectorGroup.rows[0].type, "FeatureCollection");
  assert.deepEqual(h.inspectorGroup.rows[0].features, h.features);
  assert.equal(h.inspectorGroup.pathAttrs.fill, "none");
  assert.equal(h.inspectorGroup.pathAttrs["stroke-width"], 2.4);
  h.inspector.groupMode = false;
  h.owner.renderInspectorHighlightOverlay();
  assert.deepEqual(h.inspectorGroup.rows, h.features);
  h.inspector = { featureIds: [], countryCode: " aa " };
  h.index = null;
  h.owner.renderInspectorHighlightOverlay();
  assert.deepEqual(h.inspectorGroup.rows, h.features);
  h.inspector = { featureIds: ["b"] };
  h.owner.renderInspectorHighlightOverlay();
  assert.deepEqual(h.inspectorGroup.rows, [h.features[1]]);
  h.inspector = {};
  h.owner.renderInspectorHighlightOverlay();
  assert.deepEqual(h.inspectorGroup.rows, []);
  assert.equal(h.inspectorGroup.attrs["aria-hidden"], "true");
});

test("inspector country highlight follows scenario membership, not geometry country code", () => {
  const h = harness();
  h.features = [feature("moscow", "RU"), feature("tver", "RU"), feature("kyiv", "UA"), feature("rkm-baked", "RKM")];
  h.index = new Map(h.features.map((value) => [value.id, value]));
  h.members = { RKM: ["moscow", "tver", "not-loaded"] };
  h.inspector = { featureIds: [], countryCode: "rkm" };
  h.owner.renderInspectorHighlightOverlay();
  assert.deepEqual(h.inspectorGroup.rows.map((value) => value.id), ["moscow", "tver"]);
  assert.equal(h.inspectorGroup.attrs["aria-hidden"], "false");
});

test("IDs containing delimiters cannot collide in either overlay signature", () => {
  const h = harness();
  h.features = [feature("a|b"), feature("c"), feature("a"), feature("b|c")];
  h.index = new Map(h.features.map((value) => [value.id, value]));
  h.topojson = null;
  h.ids = ["a|b", "c"];
  h.inspector = { featureIds: h.ids };
  h.owner.renderDevSelectionOverlayIfNeeded();
  h.owner.renderInspectorHighlightOverlayIfNeeded();
  h.ids = ["a", "b|c"];
  h.inspector = { featureIds: h.ids };
  h.owner.renderDevSelectionOverlayIfNeeded();
  h.owner.renderInspectorHighlightOverlayIfNeeded();
  assert.deepEqual(h.devGroup.rows.map((value) => value.id), h.ids);
  assert.deepEqual(h.inspectorGroup.rows.map((value) => value.id), h.ids);
});
