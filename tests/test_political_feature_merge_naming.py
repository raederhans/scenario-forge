from __future__ import annotations
import unittest

from tools.apply_political_feature_merges import Merges, merge_geo_aliases
from tools.build_political_feature_merge_plan import assign_representative, parent_names, scenario_parent_names


class MergedNameApplyTest(unittest.TestCase):
    plan = {"groups": [{
        "id": "DE_MRG_000000000002", "member_ids": ["DE_MRG_000000000001", "DE3"], "name_source": "parent_direction",
        "names": {"en": "Brandenburg · East", "zh": "勃兰登堡·东部"},
        "member_names": {"DE_MRG_000000000001": {"en": "A + B", "zh": "甲、乙"}, "DE3": {"en": "C", "zh": "丙"}},
    }]}

    def test_member_and_earlier_names_stay_searchable(self):
        payload = {"entries": [
            {"feature_id": "DE_MRG_000000000001", "country_code": "DE", "aliases": ["A + B"], "search_only_aliases": []},
            {"feature_id": "DE3", "country_code": "DE", "aliases": ["C"], "search_only_aliases": []},
        ], "alias_to_stable_key": {"A + B": "id::DE_MRG_000000000001", "C": "id::DE3"}}
        result = merge_geo_aliases(payload, Merges(self.plan))
        entry, = result["entries"]
        self.assertEqual(entry["primary_name"], "Brandenburg · East")
        self.assertTrue({"A + B", "C"} <= set(entry["aliases"]))
        self.assertTrue({"勃兰登堡·东部", "甲、乙", "丙"} <= set(entry["search_only_aliases"]))
        self.assertEqual(result["alias_to_stable_key"]["A + B"], "id::DE_MRG_000000000002")


def representative_group(*members):
    return {"id": "RU_MRG_000000000009", "parent_id": "RU_Omsk", "member_ids": list(members),
            "member_names": {member: {"en": f"{member} District", "zh": f"{member}区"} for member in members}}


class RepresentativeNameTest(unittest.TestCase):
    facts = {
        "scenario_names": {},
        "cities": [
            {"host_feature_id": "RU_B", "population": 900, "name": "Bigtown", "name_en": "Bigtown", "name_zh": "Bigtown"},
            {"host_feature_id": "RU_A", "population": 500, "name": "Tara", "name_en": "Tara", "name_zh": "塔拉"},
        ],
        "population": {"RU_A": {"population": 10, "land_area_km2": 5}, "RU_B": {"population": 30, "land_area_km2": 1},
                       "RU_C": {"population": 20, "land_area_km2": 9}},
    }

    def test_a_city_with_a_chinese_name_wins_then_population_then_area(self):
        group = representative_group("RU_A", "RU_B")
        assign_representative(group, self.facts)
        self.assertEqual((group["names"], group["name_source"], group["representative_id"]),
                         ({"en": "Tara", "zh": "塔拉"}, "city", "RU_A"))
        group = representative_group("RU_B", "RU_C")
        assign_representative(group, self.facts)
        self.assertEqual((group["names"]["en"], group["name_source"]), ("RU_B District", "population"))
        facts = {**self.facts, "population": {"RU_B": {"land_area_km2": 1}, "RU_C": {"population": 1, "land_area_km2": 9}}}
        group = representative_group("RU_B", "RU_C")
        assign_representative(group, facts)
        self.assertEqual((group["names"]["en"], group["name_source"]), ("RU_C District", "area"))


class ScenarioParentNameTest(unittest.TestCase):
    reviewed = {"RU_Kaliningrad": {"en": "Kaliningrad", "zh": "加里宁格勒州",
                                   "scenarios": {"tno_1962": {"en": "Königsberg", "zh": "柯尼斯堡"}}}}
    parent = {"en": "Kaliningrad", "zh": "加里宁格勒州"}

    def group(self, en="Kaliningrad · Central 2", zh="加里宁格勒州·中部2"):
        return {"id": "RU_MRG_000000000001", "parent_id": "RU_Kaliningrad", "member_ids": ["RU_A", "RU_B"],
                "name_source": "parent_direction", "names": {"en": en, "zh": zh},
                "member_names": {"RU_A": {"en": "A", "zh": "甲"}, "RU_B": {"en": "B", "zh": "乙"}}}

    def test_a_scenario_parent_name_wins_only_in_that_scenario(self):
        group = self.group()
        scenario_parent_names(group, self.parent, ("hoi4_1936", "tno_1962"), self.reviewed)
        self.assertEqual(group["names"], {"en": "Kaliningrad · Central 2", "zh": "加里宁格勒州·中部2"})
        self.assertEqual(group["scenario_names"], {"tno_1962": {"en": "Königsberg · Central 2", "zh": "柯尼斯堡·中部2"}})
        self.assertEqual(parent_names("RU_Kaliningrad", {}, {}, None, self.reviewed), self.parent)
        outside = self.group()
        scenario_parent_names(outside, self.parent, ("hoi4_1936",), self.reviewed)
        self.assertNotIn("scenario_names", outside)


if __name__ == "__main__":
    unittest.main()
