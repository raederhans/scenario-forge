from __future__ import annotations

import json
import unittest
from collections import Counter

from shapely.geometry import box

from tools import build_hoi4_state_districts as builder


class Hoi4StateDistrictsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.payloads = {}
        cls.owners = {}
        for scenario_id in builder.SCENARIO_IDS:
            directory = builder.ROOT / "data" / "scenarios" / scenario_id
            cls.payloads[scenario_id] = json.loads(
                (directory / "district_groups.manual.json").read_text(encoding="utf-8")
            )
            cls.owners[scenario_id] = json.loads(
                (directory / "owners.by_feature.json").read_text(encoding="utf-8")
            )["owners"]

    def test_membership_and_names(self) -> None:
        for scenario_id, payload in self.payloads.items():
            self.assertEqual(payload["version"], 1)
            self.assertEqual(payload["scenario_id"], scenario_id)
            counts = Counter()
            for tag, record in payload["tags"].items():
                self.assertEqual(record["tag"], tag)
                self.assertGreaterEqual(len(record["districts"]), 2)
                assigned = set()
                for district_id, district in record["districts"].items():
                    with self.subTest(scenario=scenario_id, tag=tag, district=district_id):
                        self.assertEqual(district["district_id"], district_id)
                        self.assertTrue(district["name_en"].strip())
                        self.assertTrue(district["name_zh"].strip())
                        self.assertTrue(district["feature_ids"])
                        self.assertEqual(district["feature_ids"], sorted(district["feature_ids"]))
                        for feature_id in district["feature_ids"]:
                            self.assertIn(feature_id, self.owners[scenario_id])
                            self.assertEqual(self.owners[scenario_id][feature_id], tag)
                        assigned.update(district["feature_ids"])
                        counts.update(district["feature_ids"])
                self.assertEqual(assigned, {
                    feature_id for feature_id, owner in self.owners[scenario_id].items()
                    if owner == tag
                })
            self.assertFalse([feature_id for feature_id, count in counts.items() if count > 1])

    def test_fill_features_do_not_seed_or_extend_assignment_targets(self) -> None:
        feature_ids = ["A", "B", "X_SHELL_FB_1", "Y_SHELL_FB_2"]
        buckets = {"A": "s1", "B": "s2", "X_SHELL_FB_1": "s99", "Y_SHELL_FB_2": "s99"}
        adjacency = {
            "A": {"X_SHELL_FB_1": 3}, "B": {"X_SHELL_FB_1": 2},
            "X_SHELL_FB_1": {"A": 3, "B": 2, "Y_SHELL_FB_2": 10}, "Y_SHELL_FB_2": {"X_SHELL_FB_1": 10},
        }
        geometries = {
            "A": box(0, 0, 1, 1), "B": box(10, 0, 11, 1),
            "X_SHELL_FB_1": box(9, 0, 10, 1), "Y_SHELL_FB_2": box(11, 0, 12, 1),
        }
        groups, _, _ = builder.assign_tag(feature_ids, buckets, adjacency, geometries)
        self.assertEqual(groups, {1: {"A", "X_SHELL_FB_1"}, 2: {"B", "Y_SHELL_FB_2"}})

    def test_antarctic_groups_merge_without_absorbing_mixed_groups(self) -> None:
        groups = {2: {"south_a"}, 1: {"south_b"}, 3: {"south_c", "north"}}
        geometries = {
            "south_a": box(0, -80, 1, -70), "south_b": box(10, -70, 11, -60),
            "south_c": box(20, -80, 21, -70), "north": box(20, -60, 21, -59),
        }
        self.assertEqual(builder.merge_antarctic_groups(groups, geometries), 1)
        self.assertEqual(groups, {1: {"south_a", "south_b"}, 3: {"south_c", "north"}})


if __name__ == "__main__":
    unittest.main()
