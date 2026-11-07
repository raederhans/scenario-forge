import json
from pathlib import Path
import unittest

from pyproj import Geod


SCENARIOS = Path(__file__).resolve().parents[1] / "data/scenarios"


class TnoStrategicValuesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.payload = json.loads((SCENARIOS / "tno_1962/strategic_values.by_feature.json").read_text(encoding="utf-8"))
        cls.reference = json.loads((SCENARIOS / "hoi4_1936/strategic_values.by_feature.json").read_text(encoding="utf-8"))
        cls.owners = json.loads((SCENARIOS / "tno_1962/owners.by_feature.json").read_text(encoding="utf-8"))["owners"]

    def test_top_level_fields(self):
        self.assertEqual(set(self.payload), set(self.reference))

    def test_victory_points_and_match_rate(self):
        points = self.payload["victory_points"]
        self.assertTrue(points)
        matched = sum(point["match_method"] != "unmatched" for point in points)
        self.assertGreaterEqual(matched / len(points), 0.7376877401327279 - 0.05)

    def test_host_features_exist(self):
        missing = {
            point["host_feature_id"]
            for point in self.payload["victory_points"]
            if "host_feature_id" in point and point["host_feature_id"] not in self.owners
        }
        self.assertEqual(missing, set())

    def test_berlin_in_top_three(self):
        points = self.payload["victory_points"]
        berlin = [point for point in points if "germania" in point["name"].lower() or point["name"].lower() == "berlin"]
        self.assertTrue(berlin)
        self.assertGreaterEqual(max(point["value"] for point in berlin), sorted((point["value"] for point in points), reverse=True)[2])

    def test_berlin_matches_german_feature(self):
        berlin = next(point for point in self.payload["victory_points"] if point["name"] == "Berlin-Germania")
        self.assertEqual(berlin["city_id"], "CITY::ne::1159151529")
        self.assertNotEqual(berlin["match_method"], "unmatched")
        self.assertEqual(self.owners[berlin["host_feature_id"]], "GER")

    def test_american_rome_and_moscow_do_not_match_foreign_cities(self):
        foreign_cities = {"Rome": "CITY::ne::1159151593", "Moscow": "CITY::ne::1159151585"}
        for point in self.payload["victory_points"]:
            if point["owner_tag"] == "USA" and point["name"] in foreign_cities:
                with self.subTest(province_id=point["province_id"]):
                    self.assertNotEqual(point.get("city_id"), foreign_cities[point["name"]])

    def test_major_cities_near_registered_victory_point_centers(self):
        registered_centers = {
            9523: (2.509887201469997, 48.78566789586515),
            1349: (72.94152244693163, 19.131332290185835),
            19181: (20.772697399181155, 52.18358592067151),
            6380: (37.949241656761146, 55.727589938072775),
            6521: (13.319577585696216, 52.50038287143849),
        }
        points = {point["province_id"]: point for point in self.payload["victory_points"]}
        geod = Geod(ellps="WGS84")
        for province_id, center in registered_centers.items():
            with self.subTest(province_id=province_id):
                point = points[province_id]
                self.assertNotEqual(point["match_method"], "unmatched")
                distance = geod.inv(*center, point["lon"], point["lat"])[2]
                self.assertLess(distance, 60000)


if __name__ == "__main__":
    unittest.main()
