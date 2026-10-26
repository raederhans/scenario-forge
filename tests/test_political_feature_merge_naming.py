from __future__ import annotations
import copy
import json
import tempfile
import unittest
from pathlib import Path

from shapely.geometry import box

from tools.apply_political_feature_merges import (
    Merges, add_scenario_member_aliases, apply_scenario_names, merge_geo_aliases, record_scenario_feature_merges, rename_view,
)
from tools.build_political_feature_merge_plan import (
    assign_representative,
    compass_direction,
    disambiguate_representative_names,
    inherit_leaf_assignments,
    parent_names,
    scenario_member_names,
    scenario_parent_names,
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

    def test_projection_writes_the_scenario_name_and_keeps_the_global_one_elsewhere(self):
        group = self.group()
        scenario_parent_names(group, self.parent, ("hoi4_1936", "tno_1962"), self.reviewed)
        group["previous_names"] = dict(group["names"])
        merges = rename_view([{"groups": [group]}])
        locales = {"geo": {"id::RU_MRG_000000000001": dict(group["names"])}}
        self.assertEqual(merges.project(locales), locales)
        with tempfile.TemporaryDirectory() as directory:
            for scenario, geo in (("tno_1962", {}), ("hoi4_1936", {"RU_MRG_000000000001": dict(group["names"])})):
                scenario_dir = Path(directory, scenario)
                scenario_dir.mkdir()
                Path(scenario_dir, "geo_locale_patch.json").write_text(json.dumps({"geo": geo}), encoding="utf-8")
                view = merges.for_scenario(scenario)
                apply_scenario_names(scenario_dir, view, {"RU_MRG_000000000001"})
            tno = json.loads(Path(directory, "tno_1962", "geo_locale_patch.json").read_text(encoding="utf-8"))
            hoi4 = json.loads(Path(directory, "hoi4_1936", "geo_locale_patch.json").read_text(encoding="utf-8"))
        self.assertEqual(tno["geo"]["RU_MRG_000000000001"], {"en": "Königsberg · Central 2", "zh": "柯尼斯堡·中部2"})
        self.assertEqual(hoi4["geo"]["RU_MRG_000000000001"], {"en": "Kaliningrad · Central 2", "zh": "加里宁格勒州·中部2"})

    def test_an_unchanged_global_name_stays_a_display_alias(self):
        group = {**self.group(), "previous_names": self.group()["names"]}
        payload = {"entries": [{"feature_id": "RU_MRG_000000000001", "country_code": "RU", "primary_name": "Kaliningrad · Central 2",
                                "aliases": ["Kaliningrad · Central 2"], "search_only_aliases": []}],
                   "alias_to_stable_key": {"Kaliningrad · Central 2": "id::RU_MRG_000000000001"}}
        entry, = merge_geo_aliases(payload, rename_view([{"groups": [group]}]))["entries"]
        self.assertEqual(entry["aliases"], ["Kaliningrad · Central 2"])


class ScenarioMemberNameTest(unittest.TestCase):
    facts = {
        "cities": [{"host_feature_id": "BE_C", "population": 9, "name": "Kortrijk", "name_en": "Kortrijk", "name_zh": "科特赖克"}],
        "population": {"BE_A": {"population": 50}, "BE_B": {"population": 40}, "BE_C": {"population": 30}, "BE_D": {"population": 1}},
        "global_names": {f"id::{member}": {"en": member, "zh": member} for member in ("BE_A", "BE_B", "BE_C")},
        "scenario_names": {"tno_1962": {
            "BE_A": {"en": "Arr. BE_A", "zh": "BE_A区"},       # affix only: not its own name
            "BE_B": {"en": "Bezirk Brügge", "zh": "布吕格"},   # rename
            "BE_C": {"en": "Bezirk Kortrijk", "zh": "科特赖兴"},  # rename hosting the largest city
            "BE_D": {"en": "Дельта", "zh": "德尔塔"},          # only TNO names it, in Cyrillic
        }},
    }

    def group(self, source):
        members = ["BE_A", "BE_B", "BE_C", "BE_D"]
        return {"id": "BE_MRG_000000000001", "parent_id": "BE_West_Flanders", "member_ids": members, "name_source": source,
                "names": {"en": "West Flanders · North", "zh": "西佛兰德省·北部"},
                "member_names": {member: {"en": member, "zh": member} for member in members}}

    def test_a_parent_named_group_takes_its_representative_renamed_member(self):
        group = self.group("parent_direction")
        scenario_member_names([group], self.facts, ("hoi4_1936", "tno_1962"))
        self.assertEqual(group["scenario_names"], {"tno_1962": {"en": "Bezirk Kortrijk", "zh": "科特赖兴"}})
        self.assertEqual(set(group["scenario_member_names"]["tno_1962"]), {"BE_B", "BE_C", "BE_D"})
        self.assertEqual(group["names"]["zh"], "西佛兰德省·北部")

    def test_own_parent_and_representative_names_stay_and_other_scenarios_are_untouched(self):
        group = {**self.group("parent_direction"), "scenario_names": {"tno_1962": {"en": "Westflandern · North", "zh": "西佛兰德省·北部"}}}
        scenario_member_names([group], self.facts, ("tno_1962",))
        self.assertEqual(group["scenario_names"]["tno_1962"]["en"], "Westflandern · North")
        representative = self.group("population")
        scenario_member_names([representative], self.facts, ("tno_1962",))
        self.assertNotIn("scenario_names", representative)
        self.assertIn("BE_B", representative["scenario_member_names"]["tno_1962"])
        outside = self.group("parent_direction")
        scenario_member_names([outside], self.facts, ("hoi4_1936",))
        self.assertFalse({"scenario_names", "scenario_member_names"} & set(outside))

    def test_member_names_become_aliases_without_taking_used_ones(self):
        group = self.group("parent_direction")
        scenario_member_names([group], self.facts, ("tno_1962",))
        payload = {"entries": [{"feature_id": group["id"], "aliases": [], "search_only_aliases": []}],
                   "alias_to_stable_key": {"德尔塔": "id::NL_X"}}
        result = add_scenario_member_aliases(payload, Merges({"groups": [group]}))
        self.assertEqual(result["alias_to_stable_key"]["布吕格"], "id::BE_MRG_000000000001")
        self.assertEqual(result["alias_to_stable_key"]["Bezirk Kortrijk"], "id::BE_MRG_000000000001")
        self.assertEqual(result["alias_to_stable_key"]["德尔塔"], "id::NL_X")
        self.assertIn("Дельта", result["entries"][0]["search_only_aliases"])
        self.assertEqual(add_scenario_member_aliases(copy.deepcopy(result), Merges({"groups": [group]})), result)


if __name__ == "__main__":
    unittest.main()
