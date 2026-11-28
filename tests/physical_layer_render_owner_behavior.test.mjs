import test from "node:test";
import assert from "node:assert/strict";

import { createPhysicalLayerRenderOwner } from "../js/core/renderer/physical_layer_render_owner.js";

function createOwner() {
  const alphas = [], widths = [];
  const context = {
    save() {}, restore() {}, beginPath() {},
    fill() { alphas.push(this.globalAlpha); },
    stroke() { widths.push(this.lineWidth); },
  };
  const owner = createPhysicalLayerRenderOwner({
    state: {},
    constants: { PHYSICAL_ATLAS_PALETTE: { forest: "#446644", mountain: "#887766" } },
    getters: { getContext: () => context, getPathCanvas: () => () => {} },
    helpers: {
      getPhysicalAtlasClass: feature => feature.properties.atlasClass,
      getPhysicalAtlasLayer: feature => feature.properties.layerName,
      getAtlasFeatureAlphaMultiplier: atlasClass => atlasClass === "mountain" ? 0.8 : 1,
      getContourVisibleFeatures: collection => collection.features,
    },
  });
  return { owner, alphas, widths };
}

test("atlas fills apply each feature's alpha multiplier", () => {
  const { owner, alphas } = createOwner();
  const features = ["mountain", "forest"].map(atlasClass => ({ properties: { atlasClass, layerName: "relief_base" } }));
  owner.drawPhysicalAtlasCollectionLayer({ features }, "relief_base", {}, { baseOpacity: 0.5, blendMode: "multiply" });
  assert.deepEqual(alphas, [0.4, 0.5]);
});

test("physical contour width scales with zoom", () => {
  const { owner, widths } = createOwner();
  owner.drawContourCollection(
    { type: "FeatureCollection", features: [{ id: "major-a" }] },
    {
      cacheSlot: "major",
      color: "#776655",
      opacity: 0.8,
      width: 2,
      k: 4,
    },
  );

  assert.equal(widths[0], 0.5);
});
