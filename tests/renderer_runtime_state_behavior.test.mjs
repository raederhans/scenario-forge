import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWaterSpatialItems,
} from "../js/core/renderer/spatial_index_runtime_builders.js";

test("water spatial builder indexes base geography water hit geometries", () => {
  const targetIds = [
    "caspian_sea",
    "lake_superior",
    "lake_michigan",
    "lake_huron",
    "lake_erie",
    "lake_ontario",
  ];
  const features = targetIds.map((featureId, index) => ({
    type: "Feature",
    properties: {
      id: featureId,
      render_as_base_geography: true,
      interactive: true,
    },
    geometry: {
      type: "Polygon",
      coordinates: [[
        [index, index],
        [index + 1, index],
        [index + 1, index + 1],
        [index, index + 1],
        [index, index],
      ]],
    },
  }));

  const items = buildWaterSpatialItems({
    features,
    getFeatureId: (feature) => String(feature?.properties?.id || ""),
    collectFeatureHitGeometries: (feature) => [feature],
    computeProjectedGeoBounds: (feature) => {
      const coords = feature.geometry.coordinates[0];
      const xs = coords.map(([x]) => x);
      const ys = coords.map(([, y]) => y);
      return {
        minX: Math.min(...xs),
        minY: Math.min(...ys),
        maxX: Math.max(...xs),
        maxY: Math.max(...ys),
        area: 1,
      };
    },
    shouldExcludeWaterHitGeometry: () => false,
  });

  assert.deepEqual(
    items.map((item) => item.featureId).sort(),
    [...targetIds].sort(),
  );
  assert.ok(items.every((item) => item.id.endsWith("::part:0")));
  assert.ok(items.every((item) => item.bboxArea > 0));
});
