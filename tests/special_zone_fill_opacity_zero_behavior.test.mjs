import test from "node:test";
import assert from "node:assert/strict";
import { createSpecialZoneLayersRenderOwner } from "../js/core/renderer/special_zone_layers_render_owner.js";

function createSelection() {
  return {
    nodes: [],
    data(features) { this.nodes = features.map((datum) => ({ datum, attributes: {} })); return this; },
    enter() { return this; },
    append() { return this; },
    merge() { return this; },
    attr(name, value) {
      this.nodes.forEach((node) => { node.attributes[name] = typeof value === "function" ? value(node.datum) : value; });
      return this;
    },
    exit() { return { remove() {} }; },
  };
}

for (const [style, expected] of [[{ fillOpacity: 0 }, 0], [{}, 0.32], [{ fillOpacity: null }, 0.32], [{ fillOpacity: 0.5 }, 0.5]]) {
  test(`special zone renderer outputs fill-opacity ${expected}`, () => {
    const selections = new Map();
    const group = {
      selectAll(selector) {
        if (!selections.has(selector)) selections.set(selector, createSelection());
        return selections.get(selector);
      },
    };
    const owner = createSpecialZoneLayersRenderOwner({
      state: {
        specialZoneLayers: { layers: [{ id: "zone", memberFeatureIds: ["land"], style }] },
        landIndex: new Map([["land", { type: "Feature", properties: { id: "land" }, geometry: { type: "Polygon", coordinates: [] } }]]),
      },
      helpers: { getPathSVG: () => () => "M0,0Z" },
      groupGetters: { getSpecialZonesGroup: () => group },
    });
    owner.updateSpecialZonesPaths();
    const nodes = selections.get("path.special-zone").nodes;
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].attributes["fill-opacity"], expected);
  });
}
