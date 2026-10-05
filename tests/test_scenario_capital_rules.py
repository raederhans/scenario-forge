from __future__ import annotations

import copy
import gzip
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from map_builder.scenario_capital_rules import apply_reviewed_capitals
from map_builder.scenario_city_overrides_composer import build_capital_overrides_payload_from_capital_hints
from map_builder.scenario_capital_placement import place_capital_markers, read_political_features

TNO_CITY_ROWS = {f"CITY::ne::{ne_id}": {"id": f"CITY::ne::{ne_id}"}
                 for ne_id in ("1159151523", "1159150965", "1159151567")}


class ScenarioCapitalRulesTest(unittest.TestCase):
    def test_capital_geometry_reader_accepts_gzip_only_topology(self):
        ring = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]
        topology = {"type": "Topology", "arcs": [ring], "objects": {
            name: {"type": "GeometryCollection", "geometries": [{
                "type": "Polygon", "arcs": [[0]], "properties": {"id": name},
            }]} for name in ("political", "scenario_atlantropa")
        }}
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "runtime_topology.topo.json"
            path.with_suffix(path.suffix + ".gz").write_bytes(
                gzip.compress(json.dumps(topology).encode("utf-8")))
            features = read_political_features(path)
        self.assertEqual([feature["properties"]["id"] for feature in features],
                         ["political", "scenario_atlantropa"])
        for feature in features:
            self.assertEqual(feature["geometry"]["type"], "Polygon")
            self.assertEqual([[list(point) for point in exterior]
                              for exterior in feature["geometry"]["coordinates"]], [ring])

    def test_modern_small_territories_have_explicit_capital_decisions(self):
        countries = {tag: {} for tag in ("PM", "SH", "AQ", "HM", "IO", "TF")}
        result = apply_reviewed_capitals({}, countries, {}, scenario_id="modern_world", strict=True)
        self.assertEqual(set(result["capital_city_hints"]), set(countries))
        for tag, city_id in (("PM", "CITY::gn::3424934"), ("SH", "CITY::gn::3370903")):
            self.assertEqual(result["capitals_by_tag"][tag], city_id)
            self.assertTrue(result["cities"][city_id]["add_city"])
            self.assertEqual(result["cities"][city_id]["country_code"], tag)
        for tag in ("AQ", "HM", "IO", "TF"):
            self.assertNotIn(tag, result["capitals_by_tag"])
            self.assertEqual(result["capital_city_hints"][tag]["resolution_method"], "no_capital")

    def test_modern_reviewed_capitals_use_gp_chef_lieu_and_lk_administrative_capital(self):
        gp_id = "CITY::ne::1159143181"
        lk_id = "CITY::ne::1159149593"
        cities = {
            gp_id: {"id": gp_id, "lon": -61.705484, "lat": 16.01041},
            lk_id: {"id": lk_id, "lon": 79.90708, "lat": 6.88297},
        }
        countries = {"GP": {"display_name": "Guadeloupe"},
                     "LK": {"display_name": "Sri Lanka"}}

        result = apply_reviewed_capitals(
            {}, countries, cities, scenario_id="modern_world", strict=True)

        self.assertEqual(result["capitals_by_tag"], {"GP": gp_id, "LK": lk_id})
        self.assertEqual(result["capital_city_hints"]["GP"]["city_name"], "Basse-Terre")
        self.assertEqual(result["capital_city_hints"]["LK"]["city_name"],
                         "Sri Jayawardenepura Kotte")

    def test_historical_city_names_are_scenario_scoped_without_promoting_cities(self):
        modern_names = {
            "1159151595": ("Beijing", "北京"),
            "1159151531": ("Ürümqi", "乌鲁木齐"),
            "1159150965": ("Astana", "阿斯塔纳"),
            "1159150969": ("Almaty", "阿拉木图"),
            "1159151523": ("Seoul", "首尔"),
            "1159151567": ("Taipei", "台北"),
        }
        historical_names = {
            "1159151531": ("Dihua", "迪化"),
            "1159150965": ("Akmolinsk", "阿克莫林斯克"),
            "1159150969": ("Alma-Ata", "阿拉木图"),
            "1159151523": ("Keijō", "京城"),
        }
        city_rows = {f"CITY::ne::{ne_id}": {"id": f"CITY::ne::{ne_id}"}
                     for ne_id in modern_names}
        payload = {
            "capitals_by_tag": {},
            "capital_city_hints": {"PEK": {
                "city_id": "CITY::ne::1159151595", "city_name": "Beijing",
                "selection_note": "regional label"}},
            "cities": {
                f"CITY::ne::{ne_id}": {
                    "display_name": {"en": names[0], "zh": names[1]},
                    "hidden": True, "tier": "regional"}
                for ne_id, names in modern_names.items()
            },
        }
        original = copy.deepcopy(payload)

        for scenario_id in ("modern_world", "hoi4_1936", "hoi4_1939", "tno_1962"):
            with self.subTest(scenario_id=scenario_id):
                result = apply_reviewed_capitals(
                    payload, {}, city_rows, scenario_id=scenario_id, strict=True)
                expected = dict(modern_names)
                if scenario_id.startswith("hoi4_"):
                    expected.update(historical_names)
                    expected["1159151595"] = ("Beiping", "北平")
                elif scenario_id == "tno_1962":
                    expected["1159151523"] = ("Keijō", "京城")
                    expected["1159150965"] = ("Akmola", "阿克莫拉")
                for ne_id, names in expected.items():
                    city = result["cities"][f"CITY::ne::{ne_id}"]
                    self.assertEqual(city["display_name"], {"en": names[0], "zh": names[1]})
                    self.assertTrue(city["hidden"])
                    self.assertEqual(city["tier"], "regional")
                    self.assertNotIn("add_city", city)
                self.assertEqual(result["capitals_by_tag"], {})
                self.assertEqual(result["capital_city_hints"]["PEK"], {
                    "city_id": "CITY::ne::1159151595", "city_name": expected["1159151595"][0],
                    "selection_note": "regional label"})
        self.assertEqual(payload, original)

    def test_hoi4_sik_capital_and_city_label_agree(self):
        city_id = "CITY::ne::1159151531"
        payload = {"cities": {city_id: {"hidden": False, "tier": "major"}}}
        city_rows = {city_id: {"id": city_id, "lon": 87.6, "lat": 43.8}}
        for scenario_id in ("hoi4_1936", "hoi4_1939"):
            with self.subTest(scenario_id=scenario_id):
                result = apply_reviewed_capitals(
                    payload, {"SIK": {"display_name": "Sinkiang"}}, city_rows,
                    scenario_id=scenario_id)
                self.assertEqual(result["capitals_by_tag"]["SIK"], city_id)
                self.assertEqual(result["capital_city_hints"]["SIK"]["city_name"], "Dihua")
                self.assertEqual(result["cities"][city_id]["display_name"],
                                 {"en": "Dihua", "zh": "迪化"})
                self.assertEqual(result["cities"][city_id]["tier"], "major")

    def test_existing_scenario_capital_names_survive_city_flavor_pass(self):
        man = "CITY::ne::1159151393"
        tai = "CITY::ne::1159151567"
        svr = "CITY::ne::1159150701"
        city_rows = {city_id: {"id": city_id} for city_id in (man, tai, svr)}
        cases = (
            ("hoi4_1936", {"MAN": {}, "TAI": {}},
             {"MAN": (man, "Hsinking"), "TAI": (tai, "Taihoku")}),
            ("hoi4_1939", {"MAN": {}, "TAI": {}},
             {"MAN": (man, "Hsinking"), "TAI": (tai, "Taihoku")}),
            ("tno_1962", {"MAN": {}, "SVR": {}},
             {"MAN": (man, "Xinjing"), "SVR": (svr, "Sverdlovsk")}),
        )
        for scenario_id, countries, expected in cases:
            with self.subTest(scenario_id=scenario_id):
                result = apply_reviewed_capitals(
                    {}, countries, city_rows, scenario_id=scenario_id)
                for tag, (city_id, name) in expected.items():
                    self.assertEqual(result["capitals_by_tag"][tag], city_id)
                    self.assertEqual(result["capital_city_hints"][tag]["city_name"], name)
                    self.assertEqual(result["cities"][city_id]["display_name"]["en"], name)

    def test_reviewed_capital_replaces_wrong_city_and_keeps_unrelated_edits(self):
        city_id = "CITY::ne::1159151609"
        payload = {"capitals_by_tag": {"JAP": "kyoto"}, "capital_city_hints": {},
                   "cities": {city_id: {"hidden": False, "tier": "major"}, "other": {"hidden": True}},
                   "audit": {"unresolved_capitals": [{"tag": "JAP"}, {"tag": "OTHER"}]}}
        original = copy.deepcopy(payload)
        cities = {**TNO_CITY_ROWS, city_id: {"id": city_id, "lon": 139.6917, "lat": 35.6895}}
        result = apply_reviewed_capitals(payload, {"JAP": {}}, cities, scenario_id="tno_1962", strict=True)
        self.assertEqual(result["capitals_by_tag"]["JAP"], city_id)
        self.assertEqual(result["capital_city_hints"]["JAP"]["lon"], 139.6917)
        self.assertEqual(result["cities"][city_id]["display_name"]["zh"], "东京")
        self.assertEqual(result["cities"][city_id]["tier"], "major")
        self.assertEqual(result["cities"]["other"], payload["cities"]["other"])
        self.assertEqual(result["audit"]["unresolved_capitals"], [{"tag": "OTHER"}])
        self.assertEqual(payload, original)
        self.assertEqual(apply_reviewed_capitals(result, {"JAP": {}}, cities, scenario_id="tno_1962"), result)

    def test_identity_is_scenario_specific_not_a_tag_match_to_the_mod(self):
        cities = {**TNO_CITY_ROWS, "CITY::ne::1159149559": {"id": "CITY::ne::1159149559"}}
        result = apply_reviewed_capitals({}, {"MAG": {}}, cities, scenario_id="tno_1962", strict=True)
        self.assertEqual(result["capital_city_hints"]["MAG"]["city_name"], "Magnitogorsk")
        self.assertEqual(apply_reviewed_capitals({}, {"MAG": {}}, cities, scenario_id="hgo_1936")["capitals_by_tag"], {})

    def test_no_capital_survives_composition_and_does_not_invent_a_city(self):
        result = apply_reviewed_capitals({"capitals_by_tag": {"AFA": "niamey"}}, {"AFA": {}}, {}, scenario_id="tno_1962")
        self.assertNotIn("AFA", result["capitals_by_tag"])
        hints = {"entries": list(result["capital_city_hints"].values())}
        composed = build_capital_overrides_payload_from_capital_hints(hints, scenario_id="tno_1962")
        self.assertEqual(composed["capital_city_hints"]["AFA"]["resolution_method"], "no_capital")
        self.assertNotIn("AFA", composed["capitals_by_tag"])

    def test_strict_repair_rejects_missing_city_before_writing(self):
        with self.assertRaisesRegex(ValueError, "missing reviewed city"):
            apply_reviewed_capitals({}, {"JAP": {}}, {}, scenario_id="tno_1962", strict=True)

    def test_repair_checks_preserved_explicit_capital_before_writing(self):
        from tools import repair_scenario_capitals as repair

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            directory = root / "data/scenarios/tno_1962"
            directory.mkdir(parents=True)
            original = {"capitals_by_tag": {"JAP": "explicit-city"}, "capital_city_hints": {
                "JAP": {"city_id": "explicit-city", "lon": 10, "lat": 10},
            }}
            for name, value in {
                "countries.json": {"countries": {"JAP": {"feature_count": 1}}},
                "owners.by_feature.json": {"owners": {"land": "JAP"}},
                "city_overrides.json": original,
                "scenario_mutations.json": {"capitals": {"JAP": "explicit-city"}},
            }.items():
                (directory / name).write_text(json.dumps(value), encoding="utf-8")
            features = [{"properties": {"id": "land"}, "geometry": {
                "type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
            }}]
            cities = {**TNO_CITY_ROWS, "CITY::ne::1159151609": {"lon": 0.5, "lat": 0.5}}
            with patch.object(repair, "ROOT", root), patch.object(repair, "read_political_features", return_value=features):
                with self.assertRaisesRegex(ValueError, "capital_outside_territory"):
                    repair.repair_scenario("tno_1962", cities)
            self.assertEqual(json.loads((directory / "city_overrides.json").read_text()), original)

    def test_territory_binding_rejects_foreign_city_and_only_snaps_a_small_coastal_miss(self):
        features = [{"properties": {"id": "land"}, "geometry": {"type": "Polygon", "coordinates": [
            [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]],
        ]}}]
        payload = {"capital_city_hints": {"AAA": {"city_id": "city", "lon": 1.001, "lat": 0.5}}}
        countries = {"AAA": {"feature_count": 1}}
        self.assertEqual(place_capital_markers(payload, countries, {"land": "AAA"}, features), [])
        hint = payload["capital_city_hints"]["AAA"]
        self.assertEqual(hint["host_feature_id"], "land")
        self.assertLess(hint["lon"], 1)
        self.assertEqual(hint["source_coordinates"], [1.001, 0.5])
        foreign = {"properties": {"id": "foreign"}, "geometry": {"type": "Polygon", "coordinates": [
            [[1, 0], [2, 0], [2, 1], [1, 1], [1, 0]],
        ]}}
        payload = {"capital_city_hints": {"AAA": {"city_id": "city", "lon": 1.001, "lat": 0.5}}}
        errors = place_capital_markers(payload, countries, {"land": "AAA", "foreign": "BBB"}, features + [foreign])
        self.assertEqual(errors[0]["reason"], "capital_outside_territory")
        self.assertEqual(payload["capital_city_hints"]["AAA"]["lon"], 1.001)


if __name__ == "__main__":
    unittest.main()
