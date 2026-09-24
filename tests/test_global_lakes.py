"""Contracts for the generated global inland-water display asset."""
from __future__ import annotations

import json
from pathlib import Path
import unittest

from shapely.geometry import Polygon, shape

from tools import build_global_lakes as builder


ROOT = Path(__file__).resolve().parents[1]


class GlobalLakesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.collection, cls.stats = builder.build_collection()
        cls.features = cls.collection["features"]
        cls.by_id = {f["properties"]["id"]: f for f in cls.features}

    def test_source_coverage_known_lakes_are_present(self):
        self.assertGreater(self.stats["source_candidate_count"], 0)
        names = {str(f["properties"].get("name_en", "")).casefold()
                 for f in self.features}
        self.assertIn("geneva", names)
        self.assertIn("qinghai", names)
        self.assertTrue(any(f["properties"].get("source_standard") == "natural_earth_lakes"
                            for f in self.features))

    def test_generated_asset_matches_builder_feature_ids(self):
        on_disk = json.loads(builder.OUTPUT.read_text(encoding="utf-8"))
        disk_ids = [f["properties"]["id"] for f in on_disk["features"]]
        built_ids = [f["properties"]["id"] for f in self.features]
        self.assertEqual(disk_ids, built_ids)

    def test_ids_are_unique_and_congo_lake_is_excluded(self):
        ids = [f["properties"]["id"] for f in self.features]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertNotIn("congo_lake", ids)
        self.assertFalse(any("congo" in str(f["properties"].get("name", "")).casefold()
                             for f in self.features))

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

    def test_new_source_features_are_display_only_and_have_stable_source_ids(self):
        source = [f for f in self.features
                  if f["properties"].get("id", "").startswith("ne_lake_")]
        self.assertTrue(source)
        for feature in source:
            props = feature["properties"]
            self.assertEqual(props["id"], f"ne_lake_{props['ne_id']}")
            self.assertFalse(props["interactive"])
            self.assertTrue(props["render_as_base_geography"])
            self.assertNotIn("scenario_id", props)

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
