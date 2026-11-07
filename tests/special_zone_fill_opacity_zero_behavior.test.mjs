import test from "node:test";
import assert from "node:assert/strict";
import { createSpecialZoneLayersRenderOwner } from "../js/core/renderer/special_zone_layers_render_owner.js";

for (const [style, expected] of [[{ fillOpacity: 0 }, 0], [{}, 0.12], [{ fillOpacity: null }, 0.32], [{ fillOpacity: 0.5 }, 0.5]]) {
  test(`special zone renderer outputs fill-opacity ${expected}`, () => {
    const nodes = [];
    const group = {
      selectAll() { return { remove() { nodes.length = 0; } }; },
      append() {
        const node = { attributes: {} };
        nodes.push(node);
        const selection = { attr(name, value) { node.attributes[name] = value; return selection; } };
        return selection;
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
    assert.equal(nodes.length, 3);
    assert.equal(nodes[0].attributes["fill-opacity"], expected);
  });
}
