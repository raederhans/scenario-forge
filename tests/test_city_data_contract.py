import json
from pathlib import Path
import unittest

from map_builder.city_contract import validate_city_features


def city(city_id="CITY::gn::1"):
    return {"type": "Feature", "properties": {"id": city_id, "stable_key": f"id::{city_id}", "host_feature_id": "unloaded"},
            "geometry": {"type": "Point", "coordinates": [103.8, 1.3]}}


class CityDataContractTest(unittest.TestCase):
    def test_reject_missing_or_duplicate_identity(self):
        for field in ("id", "stable_key"):
            bad = city()
            del bad["properties"][field]
            with self.assertRaisesRegex(ValueError, field):
                validate_city_features([bad])
            bad = city("other")
            bad["properties"][field] = city()["properties"][field]
            with self.assertRaisesRegex(ValueError, "duplicate"):
                validate_city_features([city(), bad])

    def test_migrated_strategic_references_preserve_the_exact_city_point(self):
        root = Path(__file__).resolve().parents[1]
        features = json.loads((root / "data/world_cities.geojson").read_text(encoding="utf-8"))["features"]
        cities = {feature["properties"]["id"]: feature["properties"] for feature in features}
        expected = {11865: "CITY::gn::1796427", 11822: "CITY::gn::1805408",
                    11764: "CITY::gn::2037823", 11972: "CITY::gn::1817294"}
        for scenario in ("hoi4_1936", "hoi4_1939"):
            payload = json.loads((root / f"data/scenarios/{scenario}/strategic_values.by_feature.json").read_text(encoding="utf-8"))
            checked = set()
            for entry in payload["victory_points"]:
                if entry["province_id"] not in expected:
                    continue
                self.assertEqual(entry["city_id"], expected[entry["province_id"]])
                props = cities[entry["city_id"]]
                for field in ("stable_key", "host_feature_id", "lon", "lat"):
                    self.assertEqual(entry[field], props[field])
                checked.add(entry["province_id"])
            self.assertEqual(checked, set(expected))

    def test_tracked_aliases_resolve_to_unique_canonical_cities(self):
        root = Path(__file__).resolve().parents[1]
        features = json.loads((root / "data/world_cities.geojson").read_text(encoding="utf-8"))["features"]
        aliases = json.loads((root / "data/city_aliases.json").read_text(encoding="utf-8"))
        ids = {feature["properties"]["id"] for feature in features}
        keys = {feature["properties"]["stable_key"] for feature in features}
        self.assertEqual(len(aliases["entries"]), len(features))
        self.assertLessEqual(set(aliases["alias_to_city_id"].values()), ids)
        self.assertLessEqual(set(aliases["alias_to_stable_key"].values()), keys)
        for city_id in ids:
            self.assertEqual(aliases["alias_to_city_id"][city_id], city_id)
