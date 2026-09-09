from __future__ import annotations

import json
from pathlib import Path
import unittest
from unittest.mock import patch

import geopandas as gpd

from map_builder.cities import build_city_aliases_payload, build_world_cities


ROOT = Path(__file__).resolve().parents[1]


def read_geo(path):
    return json.loads((ROOT / path).read_text(encoding="utf-8"))["geo"]


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

    def test_reviewed_city_assets_and_alias_locales_agree(self):
        manual = json.loads((ROOT / "data/i18n/manual_geo_overrides.json").read_text(encoding="utf-8"))
        reviewed = {key: value for key, value in manual.items() if key.startswith("id::CITY::")}
        aliases = json.loads((ROOT / "data/city_aliases.json").read_text(encoding="utf-8"))
        entries = {entry["stable_key"]: entry for entry in aliases["entries"]}
        cities = {feature["properties"]["stable_key"]: feature["properties"] for feature in self.features}
        self.assertTrue(reviewed)
        for key, name in reviewed.items():
            with self.subTest(city=key):
                self.assertEqual(cities[key]["name_zh"], name)
                self.assertEqual(entries[key]["name_zh"], name)
                self.assertEqual(aliases["geo"][key]["zh"], name)

    def test_tno_script_forms_remain_scenario_specific(self):
        base = read_geo("data/locales.json")
        folder = "data/scenarios/tno_1962/"
        manual = read_geo(folder + "geo_name_overrides.manual.json")
        variants = [read_geo(folder + name) for name in ("geo_locale_patch.json", "geo_locale_patch.zh.json")]
        expected = {
            "CN_CITY_17275852B77518624384720": ("Jimo", "即墨", "Jimo", "即墨"),
            "TWN-1163": ("Yilan", "宜兰", "Yilan", "宜蘭"),
            "CN_CITY_17275852B13666567623021": ("Siping", "四平", "Siping", "四平"),
            "CN_CITY_17275852B13766311075127": ("Yakeshei", "牙克石", "Yakeshei", "牙克石"),
            "CN_CITY_17275852B24114902469869": ("Shenyang", "沈阳", "Mukden", "奉天"),
        }
        for feature_id, (english, normal, scenario_english, flavor) in expected.items():
            with self.subTest(feature=feature_id):
                self.assertEqual(base[english]["zh"], normal)
                self.assertEqual(manual[feature_id], {"en": scenario_english, "zh": flavor})
                for variant in variants:
                    self.assertEqual(variant[feature_id]["zh"], flavor)
        self.assertEqual(manual["RU_CITY_VOLGOGRAD"]["zh"], "保卢斯堡")


if __name__ == "__main__":
    unittest.main()
