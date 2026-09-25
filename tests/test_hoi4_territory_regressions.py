from __future__ import annotations

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


if __name__ == "__main__":
    unittest.main()
