from __future__ import annotations

import json
import unittest
from pathlib import Path

from scenario_builder.hoi4.crosswalk import (
    assign_feature_owners,
    build_iso2_to_mapped_tag,
)
from scenario_builder.hoi4.compiler import _evaluate_region_checks
from scenario_builder.hoi4.parser import (
    load_hierarchy_groups,
    load_manual_rules,
    load_palette_map,
    load_runtime_features,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]
JIDONG_COUNTY = "CN_CITY_17275852B82452317993245"
HEBEI_JIDONG = "CN_CITY_17275852B84296108244083"
LATAKIA = "SYR-134"
HATAY = "TR631"


class Hoi4TerritoryRegressionsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        data = PROJECT_ROOT / "data"
        cls.features = load_runtime_features(data / "europe_topology.runtime_political_v1.json")
        cls.hierarchy_groups, _ = load_hierarchy_groups(data / "hierarchy.json")
        cls.iso2_to_tag = build_iso2_to_mapped_tag(
            load_palette_map(data / "palette-maps" / "hoi4_vanilla.map.json")
        )

    def assignments_for(self, scenario_id: str):
        rule_paths = [PROJECT_ROOT / "data" / "scenario-rules" / "hoi4_1936.manual.json"]
        if scenario_id == "hoi4_1939":
            rule_paths.append(PROJECT_ROOT / "data" / "scenario-rules" / "hoi4_1939.manual.json")
        rules = [rule for path in rule_paths for rule in load_manual_rules(path)]
        assignments, _ = assign_feature_owners(
            runtime_features=self.features,
            hierarchy_groups=self.hierarchy_groups,
            rules=rules,
            iso2_to_tag=self.iso2_to_tag,
            active_owner_tags=set(self.iso2_to_tag.values()) | {rule.owner_tag for rule in rules},
        )
        return assignments

    def test_jidong_county_remains_manchukuo_while_hebei_jidong_rules_apply(self) -> None:
        assignments_1936 = self.assignments_for("hoi4_1936")
        self.assertEqual(assignments_1936[JIDONG_COUNTY].owner_tag, "MAN")
        self.assertEqual(assignments_1936[HEBEI_JIDONG].owner_tag, "JAP")

        assignments_1939 = self.assignments_for("hoi4_1939")
        self.assertEqual(assignments_1939[JIDONG_COUNTY].owner_tag, "MAN")
        self.assertEqual(assignments_1939[HEBEI_JIDONG].owner_tag, "CHI")

    def test_1939_latakia_stays_in_syria_and_hatay_stays_in_turkey(self) -> None:
        assignments = self.assignments_for("hoi4_1939")
        self.assertEqual(assignments[LATAKIA].owner_tag, "SYR")
        self.assertEqual(assignments[HATAY].owner_tag, "TUR")

    def test_1936_manchukuo_frontier_region_check_accepts_corrected_jidong(self) -> None:
        checks, _ = _evaluate_region_checks(
            runtime_features=self.features,
            hierarchy_groups=self.hierarchy_groups,
            assignments=self.assignments_for("hoi4_1936"),
        )
        self.assertEqual(checks["china_manchukuo_frontier"]["status"], "pass")


    def test_batch7_bundle_territories_and_capitals(self):
        for scenario in ("hoi4_1936", "hoi4_1939"):
            with self.subTest(scenario=scenario):
                directory = PROJECT_ROOT / "data/scenarios" / scenario
                owners = json.loads((directory / "owners.by_feature.json").read_text(encoding="utf-8"))["owners"]
                countries = json.loads((directory / "countries.json").read_text(encoding="utf-8"))["countries"]
                cities = json.loads((directory / "city_overrides.json").read_text(encoding="utf-8"))
                self.assertEqual(len(owners), 21100)
                self.assertEqual(owners["AU_ADM1_AUS-2653"], "AST")
                self.assertEqual(owners["AU_ADM1_AUS-2650"], "NTR")
                self.assertEqual(owners["CN_CITY_17275852B99290886399570"], "QMA")
                self.assertEqual(owners["CN_CITY_17275852B51096101365561"], "MAN")
                self.assertEqual(owners["YEM-334"], "YEM")
                self.assertEqual(owners["YEM-3510"], "RAJ" if scenario == "hoi4_1936" else "ADN")
                self.assertEqual(owners["GF_PRIMARY"], "CAY")
                for tag, count in {"DEE": 1, "TRH": 3, "CIH": 3, "MLN": 1, "GEM": 1,
                                   "GLG": 6, "YSH": 6, "CAM": 24, "LAO": 17, "VIN": 63,
                                   "LHJ": 1, "ABY": 1, "SHW": 1, "HDM": 1, "MHA": 1,
                                   "WDN": 0, "EDN": 0, "YUK": 1, "NWT": 2}.items():
                    self.assertEqual(sum(owner == tag for owner in owners.values()), count, tag)
                for tag in ("DEE", "TRH", "CIH", "MLN", "GEM", "GLG", "YSH", "LHJ", "ABY",
                            "SHW", "HDM", "MHA", "YUK", "GGY", "JEY", "IOM", "SUB", "NTR", "CAM", "LAO"):
                    hint = cities["capital_city_hints"][tag]
                    self.assertEqual(owners[hint["host_feature_id"]], tag)
                    self.assertEqual(cities["capitals_by_tag"][tag], hint["city_id"])
                for tag in ("WDN", "EDN", "NWT", "HRD", "AAT", "ROS", "QML", "ATA"):
                    self.assertNotIn(tag, cities["capitals_by_tag"])
                    if tag in countries:
                        self.assertEqual(cities["capital_city_hints"][tag]["resolution_method"], "no_capital")
                        self.assertFalse(cities["capital_city_hints"][tag]["city_id"])
                self.assertEqual(cities["capital_city_hints"]["AST"]["host_feature_id"], "AU_ADM1_AUS-2653")
                self.assertEqual(countries["AAT"]["parent_owner_tag"], "ENG" if scenario == "hoi4_1936" else "AST")
                self.assertEqual(owners["AQ_QML"], "ATA" if scenario == "hoi4_1936" else "QML")
                self.assertEqual(countries["ALK"]["subject_kind"], "territory")
                self.assertEqual(countries["HAW"]["subject_kind"], "territory")


if __name__ == "__main__":
    unittest.main()
