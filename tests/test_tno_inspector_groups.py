from __future__ import annotations

import json
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
COUNTRIES_PATH = PROJECT_ROOT / "data" / "scenarios" / "tno_1962" / "countries.json"
MANUAL_OVERRIDES_PATH = PROJECT_ROOT / "data" / "scenarios" / "tno_1962" / "scenario_manual_overrides.json"
SCENARIO_MUTATIONS_PATH = PROJECT_ROOT / "data" / "scenarios" / "tno_1962" / "scenario_mutations.json"


class TnoInspectorGroupTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        payload = json.loads(COUNTRIES_PATH.read_text(encoding="utf-8"))
        cls.countries = payload["countries"]
        cls.manual_countries = json.loads(MANUAL_OVERRIDES_PATH.read_text(encoding="utf-8"))["countries"]
        cls.mutation_countries = json.loads(SCENARIO_MUTATIONS_PATH.read_text(encoding="utf-8"))["countries"]

    def test_russia_region_assignments(self) -> None:
        for tag in ("PRC", "WRS", "VOK", "BOP", "ORS", "MGN", "MAG", "ORN", "ONG", "GAY"):
            with self.subTest(tag=tag):
                self.assertEqual(
                    self.countries[tag].get("inspector_group_id"),
                    "scenario_group_russia_region",
                )
                self.assertEqual(
                    self.countries[tag].get("inspector_group_anchor_id"),
                    "continent_europe",
                )
        self.assertFalse(self.countries["RKM"].get("inspector_group_id"))

    def test_china_region_assignments(self) -> None:
        for tag in ("CHI", "MEN", "XIK"):
            with self.subTest(tag=tag):
                self.assertEqual(
                    self.countries[tag].get("inspector_group_id"),
                    "scenario_group_china_region",
                )
                self.assertEqual(
                    self.countries[tag].get("inspector_group_anchor_id"),
                    "continent_asia",
                )
        self.assertFalse(self.countries["MAN"].get("inspector_group_id"))

    def test_manual_inspector_group_sources_stay_in_sync(self) -> None:
        expected_groups = {
            "XIK": ("scenario_group_china_region", "continent_asia"),
            "VOK": ("scenario_group_russia_region", "continent_europe"),
            "BOP": ("scenario_group_russia_region", "continent_europe"),
            "ORS": ("scenario_group_russia_region", "continent_europe"),
            "MGN": ("scenario_group_russia_region", "continent_europe"),
            "ORN": ("scenario_group_russia_region", "continent_europe"),
            "ONG": ("scenario_group_russia_region", "continent_europe"),
            "GAY": ("scenario_group_russia_region", "continent_europe"),
        }
        for tag, (group_id, anchor_id) in expected_groups.items():
            with self.subTest(source="manual", tag=tag):
                self.assertEqual(self.manual_countries[tag].get("inspector_group_id"), group_id)
                self.assertEqual(self.manual_countries[tag].get("inspector_group_anchor_id"), anchor_id)

        for tag, (group_id, anchor_id) in expected_groups.items():
            if tag not in self.mutation_countries:
                continue
            with self.subTest(source="mutations", tag=tag):
                self.assertEqual(self.mutation_countries[tag].get("inspector_group_id"), group_id)
                self.assertEqual(self.mutation_countries[tag].get("inspector_group_anchor_id"), anchor_id)


if __name__ == "__main__":
    unittest.main()
