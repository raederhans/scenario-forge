from __future__ import annotations
import json
import tempfile
import unittest
from pathlib import Path

from shapely.geometry import box

from tools.apply_political_feature_merges import Merges, merge_geo_aliases, record_scenario_feature_merges
from tools.build_political_feature_merge_plan import compass_direction, inherit_leaf_assignments, parent_names


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
