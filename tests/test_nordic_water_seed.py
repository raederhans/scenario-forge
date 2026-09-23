import unittest
from pathlib import Path

import geopandas as gpd
from shapely.geometry import shape

from init_map_data import SEEDED_LAKE_REGION_SPECS, _select_named_water_features, _union_named_water_geometries
from tools.append_nordic_water import append_water_features, appended_water_features
from tools.patch_tno_1962_bundle import TNO_BASE_GEOGRAPHY_WATER_CLONE_IDS


ROOT = Path(__file__).resolve().parents[1]
NORDIC_IDS = {
    "lake_vanern", "lake_vattern", "lake_saimaa", "lake_paijanne",
    "lake_inari", "lake_pielinen",
}


class NordicWaterSeedTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lakes = gpd.read_file(ROOT / "data/ne_10m_lakes.zip")

    def test_lake_selector_uses_all_name_fields(self):
        # Natural Earth uses name_en=Ladoga, while the seed says Lake Ladoga.
        matches = _select_named_water_features(self.lakes, ["Lake Ladoga"])
        self.assertEqual(matches["name"].tolist(), ["Lake Ladoga"])
        self.assertEqual(matches["name_en"].tolist(), ["Ladoga"])

    def test_nordic_seeds_have_valid_local_source_and_tno_clone(self):
        specs = {spec["id"]: spec for spec in SEEDED_LAKE_REGION_SPECS}
        self.assertTrue(NORDIC_IDS.issubset(specs))
        self.assertTrue((NORDIC_IDS | {"lake_ladoga", "lake_onega"}).issubset(
            TNO_BASE_GEOGRAPHY_WATER_CLONE_IDS))
        for lake_id in NORDIC_IDS:
            with self.subTest(lake_id=lake_id):
                geometry = _union_named_water_geometries(self.lakes, specs[lake_id]["match_names"])
                self.assertIsNotNone(geometry)
                self.assertTrue(geometry.is_valid)
                self.assertGreater(geometry.area, 0)

    def test_append_preserves_existing_arcs_and_decodes_islands(self):
        outer = [[1, 1], [7, 1], [7, 7], [1, 7], [1, 1]]
        hole = [[2, 2], [2, 3], [3, 3], [3, 2], [2, 2]]
        extra = [[8, 8], [9, 8], [9, 9], [8, 9], [8, 8]]
        feature = {"type": "Feature", "properties": {"id": "new_lake"},
                   "geometry": {"type": "MultiPolygon", "coordinates": [[outer, hole], [extra]]}}
        for transform in (None, {"scale": [0.01, 0.01], "translate": [0, 0]}):
            with self.subTest(transform=transform):
                topology = {"type": "Topology", "arcs": [[[0, 0], [0, 1]]],
                            "objects": {
                                "water_regions": {"type": "GeometryCollection", "geometries": [
                                    {"type": "Polygon", "arcs": [[0]], "properties": {"id": "old"}}]},
                                "land": {"type": "GeometryCollection", "geometries": [
                                    {"type": "LineString", "arcs": [0], "properties": {"id": "shore"}}]},
                            }}
                if transform:
                    topology["transform"] = transform
                result = append_water_features(topology, "water_regions", [feature])
                self.assertEqual(result["arcs"][0], topology["arcs"][0])
                self.assertEqual(result["objects"]["land"], topology["objects"]["land"])
                self.assertEqual(result["objects"]["water_regions"]["geometries"][0],
                                 topology["objects"]["water_regions"]["geometries"][0])
                geometry = shape(appended_water_features(result, "water_regions", 1)[0]["geometry"])
                self.assertTrue(geometry.is_valid)
                self.assertEqual(len(geometry.geoms), 2)
                self.assertEqual(len(geometry.geoms[0].interiors), 1)

    def test_empty_append_is_idempotent(self):
        topology = {"type": "Topology", "arcs": [], "objects": {
            "water_regions": {"type": "GeometryCollection", "geometries": []}}}
        self.assertEqual(append_water_features(topology, "water_regions", []), topology)
        self.assertEqual(appended_water_features(topology, "water_regions", 0), [])


if __name__ == "__main__":
    unittest.main()
