import test from "node:test";
import assert from "node:assert/strict";
import { createLayerFromPreset } from "../js/core/special_zone_layers.js";
import { createSpecialZoneLayersRenderOwner } from "../js/core/renderer/special_zone_layers_render_owner.js";

function createGroup() {
  return {
    nodes: [],
    selectAll() { return { remove: () => { this.nodes = []; } }; },
    append(tag) {
      const node = { tag, attributes: {} };
      this.nodes.push(node);
      const selection = { attr(key, value) { node.attributes[key] = value; return selection; } };
      return selection;
    },
  };
}

function setup(getSelectionBoundary = () => null, topology = null) {
  const group = createGroup();
  const rendered = [];
  const layers = [
    createLayerFromPreset("claim", { id: "claim", memberFeatureIds: ["a", "b"] }),
    createLayerFromPreset("economic", { id: "economic", memberFeatureIds: ["c"] }),
  ];
  const state = {
    specialZoneLayers: { layers, activeLayerId: "claim" },
    landIndex: new Map(["a", "b", "c"].map((id) => [id, { type: "Feature", properties: { id }, geometry: { type: "Polygon", coordinates: [] } }])),
    topology,
  };
  const owner = createSpecialZoneLayersRenderOwner({
    state, helpers: { getSelectionBoundary, getPathSVG: () => (geometry) => { rendered.push(geometry); return `path-${rendered.length}`; } },
    groupGetters: { getSpecialZonesGroup: () => group },
  });
  return { group, owner, rendered, state };
}

test("each visible layer renders fill, texture and outline in layer order independently", () => {
  const boundary = { type: "MultiLineString", coordinates: [] };
  const calls = [];
  const { group, owner, rendered, state } = setup((ids) => { calls.push([...ids]); return ids.has("a") ? boundary : null; });
  owner.updateSpecialZonesPaths();
  assert.deepEqual(calls, [["a", "b"], ["c"]]);
  assert.deepEqual(group.nodes.map((node) => node.attributes.class), ["special-zone", "special-zone-pattern", "special-zone-outline", "special-zone", "special-zone-pattern", "special-zone-outline"]);
  assert.equal(rendered[0].type, "FeatureCollection");
  assert.equal(rendered[0].features.length, 2);
  assert.equal(rendered[0], rendered[1]);
  assert.equal(rendered[2], boundary);
  assert.equal(rendered[5].type, "FeatureCollection");
  assert.equal(group.nodes[2].attributes["stroke-dasharray"], "6 4");
  assert.equal(group.nodes[5].attributes["stroke-dasharray"], null);
  assert.equal(group.nodes[2].attributes["stroke-width"], 1.9);
  assert.equal(group.nodes[5].attributes["stroke-width"], 0.6);
  assert.equal(group.nodes[2].attributes["vector-effect"], "non-scaling-stroke");
  state.specialZoneLayers.layers.reverse();
  owner.updateSpecialZonesPaths();
  assert.equal(group.nodes.length, 6);
  assert.equal(group.nodes[0].attributes.fill, "#a3e635");
  state.specialZoneLayers.layers[0].visible = false;
  owner.updateSpecialZonesPaths();
  assert.equal(group.nodes.length, 3);
});

test("topology merge requires complete layer coverage and falls back independently", () => {
  const previous = globalThis.topojson;
  const calls = [];
  const merged = { type: "MultiPolygon", coordinates: [] };
  globalThis.topojson = { merge: (_topology, geometries) => { calls.push(geometries); return merged; } };
  try {
    const { owner, rendered } = setup(() => null, { objects: { political: { geometries: [{ id: "a" }, { id: "c" }] } } });
    owner.updateSpecialZonesPaths();
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], [{ id: "c" }]);
    assert.equal(rendered[2].type, "FeatureCollection");
    assert.equal(rendered[5].geometry, merged);
  } finally { globalThis.topojson = previous; }
});
