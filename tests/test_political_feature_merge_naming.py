from __future__ import annotations
import json
import tempfile
import unittest
from pathlib import Path

from shapely.geometry import box

from tools.apply_political_feature_merges import Merges, merge_geo_aliases, record_scenario_feature_merges, rename_view
from tools.build_political_feature_merge_plan import (
    assign_representative,
    compass_direction,
    disambiguate_representative_names,
    inherit_leaf_assignments,
    parent_names,
)


class DirectionalNameTest(unittest.TestCase):
    def test_sectors_and_centre_follow_the_parent_extent(self):
        parent = box(10, 50, 14, 54)
        self.assertEqual(compass_direction(box(13, 53, 14, 54), parent), ("Northeast", "东北部"))
        self.assertEqual(compass_direction(box(10, 51.5, 11, 52.5), parent), ("West", "西部"))
        self.assertEqual(compass_direction(box(11.8, 51.8, 12.2, 52.2), parent), ("Central", "中部"))

    def test_parent_names_prefer_candidate_then_exact_label_and_fail_closed(self):
        hierarchy = {"labels": {"DE_Brandenburg": "Brandenburg", "RU_Altai_Republic": "Altai Republic"}}
        raw = {"Brandenburg": {"en": "Brandenburg", "zh": "勃兰登堡"}, "Altai": {"zh": "阿尔泰语"}}
        self.assertEqual(parent_names("DE_Brandenburg", hierarchy, raw, None), {"en": "Brandenburg", "zh": "勃兰登堡"})
        self.assertEqual(parent_names("DE_Brandenburg", hierarchy, raw, {"en": "North Brandenburg", "zh": "北勃兰登堡"})["zh"], "北勃兰登堡")
        reviewed = {"RU_Altai_Republic": {"en": "Altai Krai", "zh": "阿尔泰边疆区"}}
        self.assertEqual(parent_names("RU_Altai_Republic", hierarchy, raw, None, reviewed)["zh"], "阿尔泰边疆区")
        with self.assertRaisesRegex(ValueError, "no bilingual parent name"):
            parent_names("RU_Altai_Republic", hierarchy, raw, None)


class ScopedIntermediateAssignmentTest(unittest.TestCase):
    def test_a_scoped_merged_id_takes_its_leaves_groups_or_matches_nothing(self):
        memberships = {"RU_A": ["group:RU_Altai"], "RU_B": ["group:RU_Altai"], "RU_C": ["group:RU_Omsk"]}
        prefectures = {"CN_A": "CN_PREF_1", "CN_B": "CN_PREF_1", "CN_C": "CN_PREF_2"}
        inherit_leaf_assignments({"RU_MRG_S": ["RU_A", "RU_B"], "RU_MRG_X": ["RU_A", "RU_C"],
                                  "CN_MRG_S": ["CN_A", "CN_B"], "CN_MRG_X": ["CN_A", "CN_C"]}, memberships, prefectures)
        self.assertEqual(memberships["RU_MRG_S"], ["group:RU_Altai"])
        self.assertEqual(memberships["RU_MRG_X"], ["inconsistent:RU_MRG_X"])
        self.assertEqual(prefectures["CN_MRG_S"], "CN_PREF_1")
        self.assertEqual(prefectures["CN_MRG_X"], "inconsistent:CN_MRG_X")
        self.assertNotIn("RU_MRG_S", prefectures)


class MergedNameApplyTest(unittest.TestCase):
    plan = {"groups": [{
        "id": "DE_MRG_000000000002", "member_ids": ["DE_MRG_000000000001", "DE3"], "name_source": "parent_direction",
        "names": {"en": "Brandenburg · East", "zh": "勃兰登堡·东部"},
        "member_names": {"DE_MRG_000000000001": {"en": "A + B", "zh": "甲、乙"}, "DE3": {"en": "C", "zh": "丙"}},
    }]}

    def test_a_fixed_name_replaces_an_earlier_composed_name(self):
        locales = {"id::DE_MRG_000000000001": {"en": "A + B", "zh": "甲、乙"}, "id::DE3": {"en": "C", "zh": "丙"}}
        self.assertEqual(Merges(self.plan).project(locales), {"id::DE_MRG_000000000002": {"en": "Brandenburg · East", "zh": "勃兰登堡·东部"}})

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
        "cities": [
            {"host_feature_id": "RU_B", "population": 900, "name": "Bigtown", "name_en": "Bigtown", "name_zh": "Bigtown"},
            {"host_feature_id": "RU_A", "population": 500, "name": "Tara", "name_en": "Tara", "name_zh": "塔拉"},
        ],
        "population": {"RU_A": {"population": 10, "land_area_km2": 5}, "RU_B": {"population": 30, "land_area_km2": 1},
                       "RU_C": {"population": 20, "land_area_km2": 9}},
        "scenario_names": {"tno_1962": {"RU_C": {"en": "RU_C District", "zh": "丙区"}, "RU_B": {"en": "Bee", "zh": "RU_B区"}}},
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

    def test_a_scenario_keeps_only_its_own_translations_of_the_member(self):
        group = representative_group("RU_B", "RU_C")
        assign_representative(group, self.facts)
        self.assertEqual(group["scenario_names"], {"tno_1962": {"en": "Bee", "zh": "RU_B区"}})
        group = representative_group("RU_A", "RU_C")
        facts = {**self.facts, "cities": []}
        assign_representative(group, facts)
        self.assertEqual(group["scenario_names"], {"tno_1962": {"en": "RU_C District", "zh": "丙区"}})

    def test_names_used_in_the_country_take_the_parent_then_a_number(self):
        with tempfile.TemporaryDirectory() as directory:
            topology = Path(directory, "topology.json")
            rows = [{"properties": {"id": feature_id, "cntr_code": "ZZ", "name": name}}
                    for feature_id, name in (("ZZ_X", "Taken"), ("ZZ_A", "a"), ("ZZ_B", "b"), ("ZZ_C", "c"), ("ZZ_D", "d"))]
            topology.write_text(json.dumps({"objects": {"political": {"geometries": rows}}}), encoding="utf-8")
            groups = [{"id": f"ZZ_MRG_{index}", "parent_id": "P", "member_ids": [member], "_population": population,
                       "names": {"en": en, "zh": zh}} for index, (member, en, zh, population) in
                      enumerate((("ZZ_A", "TAKEN", "甲", 1), ("ZZ_B", "Twin", "乙", 1), ("ZZ_C", "Twin", "乙", 5), ("ZZ_D", "Free", "丁", 1)))]
            groups[0]["scenario_names"] = {"tno_1962": {"en": "Other", "zh": "其他"}}
            disambiguate_representative_names(groups, {}, {}, {"P": {"en": "Omsk", "zh": "鄂木斯克州"}}, topology)
        self.assertEqual([group["names"]["en"] for group in groups], ["TAKEN (Omsk)", "Twin (Omsk) 2", "Twin (Omsk) 1", "Free"])
        self.assertEqual(groups[1]["names"]["zh"], "乙（鄂木斯克州）2")
        self.assertEqual(groups[0]["scenario_names"]["tno_1962"], {"en": "Other (Omsk)", "zh": "其他（鄂木斯克州）"})


class RenameOnlyProjectionTest(unittest.TestCase):
    plan = {"groups": [{
        "id": "FR_MRG_000000000001", "member_ids": ["FR_A", "FR_B"], "name_source": "city", "representative_id": "FR_B",
        "names": {"en": "Calais", "zh": "加来"}, "previous_names": {"en": "A + Calais", "zh": "甲、加来区"},
        "scenario_names": {"tno_1962": {"en": "Kalen", "zh": "卡伦"}},
        "member_names": {"FR_A": {"en": "A", "zh": "甲"}, "FR_B": {"en": "Calais", "zh": "加来区"}},
    }]}

    def test_names_change_while_ids_lists_and_other_entries_stay(self):
        merges = rename_view([self.plan])
        payload = {"geo": {"id::FR_MRG_000000000001": {"en": "A + Calais", "zh": "甲、加来区"}, "id::FR_X": {"en": "X", "zh": "叉"}},
                   "ids": ["FR_MRG_000000000001", "FR_X"]}
        self.assertEqual(merges.project(payload), {**payload, "geo": {**payload["geo"], "id::FR_MRG_000000000001": {"en": "Calais", "zh": "加来"}}})
        patch = {"geo": {"FR_MRG_000000000001": {"en": "A + Calais", "zh": "甲、加来区"}}}
        self.assertEqual(merges.for_scenario("tno_1962").project(patch), {"geo": {"FR_MRG_000000000001": {"en": "Kalen", "zh": "卡伦"}}})

    def test_the_joined_name_becomes_search_only_and_still_resolves(self):
        payload = {"entries": [{"feature_id": "FR_MRG_000000000001", "country_code": "FR", "primary_name": "A + Calais",
                                "aliases": ["A + Calais", "A"], "search_only_aliases": ["Calais"]}],
                   "alias_to_stable_key": {"A + Calais": "id::FR_MRG_000000000001", "A": "id::FR_MRG_000000000001"}}
        result = merge_geo_aliases(payload, rename_view([self.plan]))
        entry, = result["entries"]
        self.assertEqual((entry["primary_name"], entry["aliases"]), ("Calais", ["Calais", "A"]))
        self.assertTrue({"A + Calais", "甲、加来区", "加来"} <= set(entry["search_only_aliases"]))
        self.assertEqual(result["alias_to_stable_key"]["A + Calais"], "id::FR_MRG_000000000001")
        self.assertEqual(result["alias_to_stable_key"]["Calais"], "id::FR_MRG_000000000001")


class ScenarioFeatureMergeRecordTest(unittest.TestCase):
    def test_chained_scoped_merges_record_leaves_and_redirect_intermediate_ids(self):
        scoped = lambda *groups: Merges({"scenarios": ["tno_1962"], "groups": [
            {"id": gid, "member_ids": members, "names": {"en": gid, "zh": gid}, "member_names": {}} for gid, members in groups]})
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, "manifest.json")
            path.write_text(json.dumps({"scenario_id": "tno_1962"}), encoding="utf-8")
            record_scenario_feature_merges(path, scoped(("RU_MRG_S", ["RU_D", "RU_E"])), ["RU_MRG_S"])
            record_scenario_feature_merges(path, scoped(("RU_MRG_T", ["RU_MRG_S", "RU_G"])), ["RU_MRG_T"])
            record_scenario_feature_merges(path, scoped(("RU_MRG_U", ["RU_MRG_T", "RU_H"])), ["RU_MRG_U"])
            overrides = json.loads(path.read_text(encoding="utf-8"))["hierarchy_overrides"]
        self.assertEqual(overrides["feature_merges"], {"RU_MRG_U": ["RU_D", "RU_E", "RU_G", "RU_H"]})
        self.assertEqual(overrides["feature_redirects"], {"RU_MRG_S": "RU_MRG_U", "RU_MRG_T": "RU_MRG_U"})


if __name__ == "__main__":
    unittest.main()
