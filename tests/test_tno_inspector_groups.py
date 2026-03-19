from __future__ import annotations

import json
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
COUNTRIES_PATH = PROJECT_ROOT / "data" / "scenarios" / "tno_1962" / "countries.json"


class TnoInspectorGroupTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        payload = json.loads(COUNTRIES_PATH.read_text(encoding="utf-8"))
        cls.countries = payload["countries"]

    def test_russia_region_assignments(self) -> None:
        self.assertEqual(
            self.countries["SOV"].get("inspector_group_id"),
            "scenario_group_russia_region",
        )
        self.assertEqual(
            self.countries["WRS"].get("inspector_group_id"),
            "scenario_group_russia_region",
        )
        self.assertEqual(
            self.countries["SOV"].get("inspector_group_anchor_id"),
            "continent_europe",
        )
        self.assertFalse(self.countries["RKM"].get("inspector_group_id"))

    def test_china_region_assignments(self) -> None:
        for tag in ("CHI", "PRC", "MEN"):
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


if __name__ == "__main__":
    unittest.main()
