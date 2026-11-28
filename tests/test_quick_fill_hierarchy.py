from __future__ import annotations
import copy
import json
from pathlib import Path
import unittest
from map_builder.quick_fill_hierarchy import (
    build_quick_fill_metadata,
    load_feature_merge_members,
    resolve_fr_department,
)

ROOT = Path(__file__).resolve().parents[1]

class QuickFillBuildContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.hierarchy = json.loads((ROOT / "data/hierarchy.json").read_text(encoding="utf-8"))
        cls.crosswalk = json.loads((ROOT / "data/quick_fill/china_prefecture_crosswalk.v1.json").read_text(encoding="utf-8"))
        topology = json.loads((ROOT / "data/europe_topology.runtime_political_v1.json").read_text(encoding="utf-8"))
        cls.properties = [g.get("properties", {}) for g in topology["objects"]["political"]["geometries"]]
        cls.merged_members = load_feature_merge_members(ROOT / "data")

    def test_merged_france_features_resolve_only_within_one_department(self):
        merged = {"FR_MRG_same": ["FR_ARR_62001", "FR_ARR_62002"], "FR_MRG_split": ["FR_ARR_59001", "FR_ARR_62001"]}
        self.assertEqual(resolve_fr_department("FR_MRG_same", merged), "62")
        self.assertIsNone(resolve_fr_department("FR_MRG_split", merged))
        self.assertIsNone(resolve_fr_department("FR_MRG_same"))
        with self.assertRaisesRegex(ValueError, "Unsupported France arrondissement ID"):
            build_quick_fill_metadata({"groups": {"FR_A": ["FR_MRG_split"]}}, [], None, merged)

    def test_china_unresolved_provinces_are_not_published_as_complete(self):
        level = self.hierarchy["quick_fill"]["countries"]["CN"]["levels"]["prefecture"]
        self.assertEqual(level["status"], "partial")
        # 353 unresolved leaves before merges; merged unresolved leaves collapse to one ID.
        china_merges = [members for merged, members in self.merged_members.items() if merged.startswith("CN_")]
        unresolved = {row["feature_id"] for row in self.crosswalk["unresolved"]}
        self.assertEqual(len(level["unmapped_feature_ids"]), 353 - sum(len(members) - 1 for merged, members in
                                                                        self.merged_members.items() if merged in unresolved))
        self.assertTrue(china_merges)
        self.assertEqual(len(level["blocked_parent_groups"]), 26)
        self.assertEqual(len(level["groups"]), 12)
        leaves = []
        for group in level["groups"].values():
            self.assertTrue(self.crosswalk["provinces"][group["province_id"]]["release_enabled"])
            self.assertNotIn(group["province_id"], level["blocked_parent_groups"])
            self.assertTrue(group["complete"])
            leaves.extend(group["feature_ids"])
        self.assertEqual(len(leaves), 97)
        self.assertEqual(len(leaves), len(set(leaves)))
        self.assertFalse(set(leaves) & set(level["unmapped_feature_ids"]))

    def test_china_stale_identity_or_parent_mapping_fails_closed(self):
        changed = copy.deepcopy(self.properties)
        next(row for row in changed if row.get("cntr_code") == "CN")["name"] += "_changed"
        with self.assertRaisesRegex(ValueError, "IDs/names changed"):
            build_quick_fill_metadata(self.hierarchy, changed, self.crosswalk, self.merged_members)
        hierarchy = copy.deepcopy(self.hierarchy)
        key = next(key for key in hierarchy["groups"] if key.startswith("CN_"))
        hierarchy["groups"][key].pop()
        with self.assertRaisesRegex(ValueError, "parent membership changed"):
            build_quick_fill_metadata(hierarchy, self.properties, self.crosswalk, self.merged_members)

if __name__ == "__main__": unittest.main()
