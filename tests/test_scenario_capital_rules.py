from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from map_builder.scenario_capital_rules import REVIEWED_CITY_NAMES, apply_reviewed_capitals
from map_builder.scenario_city_overrides_composer import build_capital_overrides_payload_from_capital_hints
from map_builder.scenario_capital_placement import place_capital_markers

TNO_CITY_ROWS = {(ne_id if ne_id.startswith("CITY::") else f"CITY::ne::{ne_id}"):
                {"id": ne_id if ne_id.startswith("CITY::") else f"CITY::ne::{ne_id}"}
                 for ne_id in REVIEWED_CITY_NAMES["tno_1962"]}


class ScenarioCapitalRulesTest(unittest.TestCase):
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
