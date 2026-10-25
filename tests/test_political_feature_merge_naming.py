from __future__ import annotations
import unittest

from shapely.geometry import box

from tools.apply_political_feature_merges import Merges, merge_geo_aliases
from tools.build_political_feature_merge_plan import compass_direction, parent_names


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


if __name__ == "__main__":
    unittest.main()
