import copy
import json
from pathlib import Path
import unittest

from map_builder.city_contract import validate_city_features


def city(city_id="CITY::gn::1"):
    return {"type": "Feature", "properties": {"id": city_id, "stable_key": f"id::{city_id}", "host_feature_id": "unloaded"},
            "geometry": {"type": "Point", "coordinates": [103.8, 1.3]}}


class CityDataContractTest(unittest.TestCase):
    def test_reorder_and_unloaded_hosts(self):
        features = [city("a"), city("b")]
        before = copy.deepcopy(features)
        validate_city_features(features)
        validate_city_features(reversed(features))
        self.assertEqual(features, before)

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

    def test_reject_invalid_geometry(self):
        for geometry in (None, {"type": "LineString", "coordinates": []},
                         *({"type": "Point", "coordinates": point} for point in ([181, 0], [0, -91], [float("nan"), 0], [True, 0], ["1", 0]))):
            with self.subTest(geometry=geometry), self.assertRaises(ValueError):
                validate_city_features([{**city(), "geometry": geometry}])

    def test_tracked_world_cities(self):
        path = Path(__file__).resolve().parents[1] / "data/world_cities.geojson"
        features = json.loads(path.read_text(encoding="utf-8"))["features"]
        validate_city_features(features)
        self.assertGreater(len(features), 20_000)

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

    def test_alias_builder_rejects_invalid_identity_before_emission(self):
        import geopandas as gpd
        from map_builder.cities import build_city_aliases_payload
        frame = gpd.GeoDataFrame.from_features([city(), city()], crs="EPSG:4326")
        with self.assertRaisesRegex(ValueError, "duplicate id"):
            build_city_aliases_payload(frame)

    def test_merge_assigns_one_ne_identity_to_nearest_point_independent_of_order(self):
        import geopandas as gpd
        from map_builder.cities import merge_world_cities

        def record(city_id, lon):
            feature = city(city_id)
            feature["geometry"]["coordinates"] = [lon, 0]
            feature["properties"].update(city_id=city_id, name="Same", name_ascii="Same", country_code="SG",
                                         aliases=["Same"], lon=lon, lat=0, population=100, capital_kind="place")
            return feature

        ne = gpd.GeoDataFrame.from_features([record("CITY::ne::1", 0)], crs="EPSG:4326")
        # The farther point appears first; it must retain its GeoNames identity.
        source = [record("CITY::gn::1", 0.1), record("CITY::gn::2", 0.01)]
        for features in (source, list(reversed(source))):
            result = merge_world_cities(gpd.GeoDataFrame.from_features(features, crs="EPSG:4326"), ne)
            validate_city_features(result.iterfeatures(drop_id=True))
            identities = dict(zip(result["lon"], result["id"]))
            self.assertEqual(identities, {0.1: "CITY::gn::1", 0.01: "CITY::ne::1"})

    def test_output_rejects_invalid_city_before_writing(self):
        from unittest.mock import patch
        import geopandas as gpd
        from map_builder.outputs.save import save_outputs
        frame = gpd.GeoDataFrame.from_features([city(), city()], crs="EPSG:4326")
        with patch("map_builder.outputs.save.round_geometries", side_effect=lambda value: value), \
                patch("map_builder.outputs.save._write_geojson") as write, \
                patch("map_builder.outputs.save._write_json") as write_json:
            with self.assertRaisesRegex(ValueError, "duplicate id"):
                save_outputs(*([frame] * 10), world_cities=frame)
            write.assert_not_called()
            write_json.assert_not_called()
