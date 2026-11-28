"""Contracts for the generated global inland-water display asset."""
from __future__ import annotations

import json
import unittest

from shapely.geometry import Polygon, shape

from tools import build_global_lakes as builder


class GlobalLakesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        collection, _ = builder.build_collection()
        cls.features = collection["features"]
        cls.by_id = {f["properties"]["id"]: f for f in cls.features}

    def test_generated_asset_matches_builder_feature_ids(self):
        on_disk = json.loads(builder.OUTPUT.read_text(encoding="utf-8"))
        disk_ids = [f["properties"]["id"] for f in on_disk["features"]]
        built_ids = [f["properties"]["id"] for f in self.features]
        self.assertEqual(disk_ids, built_ids)

    def test_existing_inland_water_geometry_and_interactivity_are_preserved(self):
        original = json.loads(builder.EXISTING.read_text(encoding="utf-8"))
        existing = {f["properties"]["id"]: f for f in original["features"]
                    if f.get("properties", {}).get("water_type") in
                    {"lake", "reservoir", "inland_sea"}}
        for feature_id, source in existing.items():
            result = self.by_id[feature_id]
            self.assertTrue(shape(source["geometry"]).equals(shape(result["geometry"])), feature_id)
            self.assertEqual(source["properties"].get("interactive"),
                             result["properties"].get("interactive"), feature_id)
        self.assertIn("lake_baikal", self.by_id)
        self.assertIn("caspian_sea", self.by_id)
        self.assertIn("aral_sea", self.by_id)

    def test_compiled_geometries_are_valid_and_d3_wound(self):
        for feature in self.features:
            geometry = shape(feature["geometry"])
            self.assertTrue(geometry.is_valid, feature["properties"]["id"])
            self.assertTrue(geometry.geom_type in {"Polygon", "MultiPolygon"},
                            feature["properties"]["id"])
            polygons = [geometry] if isinstance(geometry, Polygon) else list(geometry.geoms)
            self.assertTrue(all(not polygon.exterior.is_ccw for polygon in polygons),
                            feature["properties"]["id"])


if __name__ == "__main__":
    unittest.main()
