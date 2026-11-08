import json
import unittest
from pathlib import Path

from tools.apply_hoi4_era_city_names import ERA_CITY_NAMES


ROOT = Path(__file__).resolve().parents[1]


class EraCityNamesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.scenarios = {
            year: json.loads((ROOT / f"data/scenarios/hoi4_{year}/city_overrides.json").read_text(encoding="utf-8"))["cities"]
            for year in (1936, 1939)
        }
        cls.world = {
            feature["properties"]["city_id"]: feature["properties"]
            for feature in json.loads((ROOT / "data/world_cities.geojson").read_text(encoding="utf-8"))["features"]
        }

    def test_era_display_names(self):
        expected = {
            "CITY::ne::1159139051": ("Breslau", "布雷斯劳"),
            "CITY::ne::1159149707": ("Danzig", "但泽"),
            "CITY::ne::1159149323": ("Lwów", "利沃夫"),
            "CITY::ne::1159151599": ("Batavia", "巴达维亚"),
            "CITY::ne::1159149331": ("Stalino", "斯大林诺"),
            "CITY::ne::1159151611": ("Bombay", "孟买"),
            "CITY::ne::1159151253": ("Saigon", "西贡"),
            "CITY::ne::1159151291": ("Leningrad", "列宁格勒"),
            "CITY::ne::1159151567": ("Taihoku", "台北"),
            "CITY::ne::1159151523": ("Keijō", "京城"),
        }
        for year, cities in self.scenarios.items():
            for city_id, (en, zh) in expected.items():
                with self.subTest(year=year, city_id=city_id):
                    self.assertEqual(cities[city_id]["display_name"], {"en": en, "zh": zh})

    def test_scenario_specific_names(self):
        for year, en, zh in ((1936, "Peiping", "北平"), (1939, "Peking", "北京")):
            self.assertEqual(self.scenarios[year]["CITY::ne::1159151595"]["display_name"], {"en": en, "zh": zh})
        self.assertEqual(self.scenarios[1939]["CITY::ne::1159149571"]["display_name"], {"en": "Chkalov", "zh": "契卡洛夫"})
        orenburg = self.scenarios[1936].get("CITY::ne::1159149571", {})
        self.assertNotEqual(orenburg.get("display_name", {}).get("en"), "Chkalov")

    def test_rewritten_aliases(self):
        era_names = {row.split("|")[2] for row in ERA_CITY_NAMES.splitlines()}
        for year, cities in self.scenarios.items():
            for city_id, entry in cities.items():
                en = entry.get("display_name", {}).get("en")
                if en in era_names:
                    with self.subTest(year=year, city_id=city_id):
                        self.assertIn(en, entry["aliases"])
                        self.assertIn(self.world[city_id]["name_en"], entry["aliases"])
                        self.assertEqual(len(entry["aliases"]), len(set(entry["aliases"])))


if __name__ == "__main__":
    unittest.main()
