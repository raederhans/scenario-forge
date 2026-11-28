from __future__ import annotations

import json
from pathlib import Path
import unittest
from unittest.mock import patch

import geopandas as gpd

from map_builder.cities import build_city_aliases_payload, build_world_cities


ROOT = Path(__file__).resolve().parents[1]


class ReviewedPlaceNamesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.features = json.loads((ROOT / "data/world_cities.geojson").read_text(encoding="utf-8"))["features"]

    def test_city_rebuild_preserves_reviewed_name_without_renaming_namesake(self):
        ids = {"CITY::ne::1159132667", "CITY::gn::2646032"}
        cities = gpd.GeoDataFrame.from_features(
            [feature for feature in self.features if feature["properties"]["id"] in ids],
            crs="EPSG:4326",
        )
        cities.loc[cities["country_code"] == "US", "name_zh"] = "歐文"
        original = cities.copy(deep=True)
        empty = gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")
        with patch("map_builder.cities._attach_cities_to_political", side_effect=lambda frame, _: frame), \
             patch("map_builder.cities._attach_cities_to_urban", side_effect=lambda frame, _: frame):
            rebuilt = build_world_cities(political=empty, urban=empty, merged_city_dataset=cities)
        self.assertTrue(cities.equals(original))
        by_id = rebuilt.set_index("id")
        self.assertEqual(by_id.loc["CITY::ne::1159132667", "name_zh"], "尔湾")
        self.assertEqual(by_id.loc["CITY::gn::2646032", "name_zh"], "Irvine")
        self.assertEqual(set(by_id.index), ids)
        for _, row in original.iterrows():
            self.assertTrue(by_id.loc[row["id"], "geometry"].equals(row["geometry"]))
        aliases = build_city_aliases_payload(rebuilt)
        self.assertEqual(aliases["geo"]["id::CITY::ne::1159132667"]["zh"], "尔湾")


if __name__ == "__main__":
    unittest.main()
