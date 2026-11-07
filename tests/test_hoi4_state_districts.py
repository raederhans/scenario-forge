from __future__ import annotations

import json
import unittest
from collections import Counter

from shapely.geometry import box

from tools import build_hoi4_state_districts as builder

# 生成器读取本机 HOI4 本地化；CI 没有游戏文件时跳过依赖它的用例，数据结构检查照常运行。
requires_game_files = unittest.skipUnless(builder.LOCALISATION_DIR.exists(), "需要本机 HOI4 安装")


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

    @requires_game_files
    def test_germany_1936_uses_localised_state_names(self) -> None:
        districts = self.payloads["hoi4_1936"]["tags"]["GER"]["districts"]
        self.assertGreaterEqual(len(districts), 15)
        english = builder.load_state_names("english")
        chinese = builder.load_state_names("simp_chinese")
        for state in (51, 42):
            self.assertEqual(districts[f"state_{state}"]["name_en"], english[state])
            self.assertEqual(districts[f"state_{state}"]["name_zh"], chinese[state])

    @requires_game_files
    def test_published_file_matches_rebuild(self) -> None:
        payload, _ = builder.build_scenario("hoi4_1936")
        self.assertEqual(payload, self.payloads["hoi4_1936"])

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

    def test_only_fill_tag_keeps_original_grouping(self) -> None:
        groups, _, _ = builder.assign_tag(
            ["A_SHELL_FB_1", "B_SHELL_FB_2"], {"A_SHELL_FB_1": "s1", "B_SHELL_FB_2": "s2"},
            {"A_SHELL_FB_1": {}, "B_SHELL_FB_2": {}},
            {"A_SHELL_FB_1": box(0, 0, 1, 1), "B_SHELL_FB_2": box(10, 0, 11, 1)},
        )
        self.assertEqual(groups, {1: {"A_SHELL_FB_1"}, 2: {"B_SHELL_FB_2"}})

    def test_arctic_fallback_features_seed_groups_and_are_not_shell_fragments(self) -> None:
        feature_ids = ["A", "RU_ARCTIC_FB_1", "OTHER_FB_1"]
        geometries = {feature_id: box(index, 0, index + 1, 1) for index, feature_id in enumerate(feature_ids)}
        groups, _, _ = builder.assign_tag(
            feature_ids, {"A": "s1", "RU_ARCTIC_FB_1": "s2", "OTHER_FB_1": "s3"},
            {feature_id: {} for feature_id in feature_ids}, geometries,
        )
        self.assertEqual(groups, {1: {"A"}, 2: {"RU_ARCTIC_FB_1"}, 3: {"OTHER_FB_1"}})
        districts = {
            f"state_{state}": {"name_en": "Name", "name_zh": "名称", "feature_ids": sorted(members)}
            for state, members in groups.items()
        }
        suspicious = builder.find_suspicious(
            "test", "TAG", districts, feature_ids, geometries,
            {f"s{state}": {"owner_tag": "TAG"} for state in groups}, {},
        )
        self.assertEqual([item["reasons"] for item in suspicious], [["单地块组"]] * 3)

    def test_antarctic_groups_merge_without_absorbing_mixed_groups(self) -> None:
        groups = {2: {"south_a"}, 1: {"south_b"}, 3: {"south_c", "north"}}
        geometries = {
            "south_a": box(0, -80, 1, -70), "south_b": box(10, -70, 11, -60),
            "south_c": box(20, -80, 21, -70), "north": box(20, -60, 21, -59),
        }
        self.assertEqual(builder.merge_antarctic_groups(groups, geometries), 1)
        self.assertEqual(groups, {1: {"south_a", "south_b"}, 3: {"south_c", "north"}})

    def test_antarctic_tags_omitted_and_manual_names_applied(self) -> None:
        for scenario_id, payload in self.payloads.items():
            with self.subTest(scenario=scenario_id):
                self.assertNotIn("AAT", payload["tags"])
                self.assertNotIn("ATA", payload["tags"])
                for tag, overrides in builder.MANUAL_DISTRICT_OVERRIDES[scenario_id].items():
                    for district_id, names in overrides.items():
                        district = payload["tags"][tag]["districts"].get(district_id)
                        if district is not None:
                            self.assertEqual(district["name_en"], names["name_en"])
                            self.assertEqual(district["name_zh"], names["name_zh"])
                for record in payload["tags"].values():
                    antarctic = [district for district in record["districts"].values() if district["name_zh"] == "南极属地"]
                    self.assertLessEqual(len(antarctic), 1)
                    for district in antarctic:
                        self.assertEqual(district["name_en"], "Antarctic Territory")

    def test_fill_groups_have_regular_members_and_scotland_is_renamed(self) -> None:
        for scenario_id, payload in self.payloads.items():
            with self.subTest(scenario=scenario_id):
                for tag, record in payload["tags"].items():
                    if any("_SHELL_FB_" not in feature_id for feature_id, owner in self.owners[scenario_id].items() if owner == tag):
                        for district in record["districts"].values():
                            self.assertTrue(any("_SHELL_FB_" not in feature_id for feature_id in district["feature_ids"]))
                scotland = payload["tags"]["ENG"]["districts"]["state_136"]
                self.assertIn("GB_NUTS1_UKM", scotland["feature_ids"])
                self.assertEqual(scotland["name_en"], "Scotland")
                self.assertEqual(scotland["name_zh"], "苏格兰")

    def test_suspicious_reasons_and_distance_threshold(self) -> None:
        districts = {
            "state_1": {"name_en": "One", "name_zh": "一", "feature_ids": ["A_SHELL_FB_1"]},
            "state_2": {"name_en": "Two", "name_zh": "二", "feature_ids": ["B", "C"]},
        }
        geometries = {
            "A_SHELL_FB_1": box(0, 0, 1, 1), "B": box(30, 0, 31, 1), "C": box(31, 0, 32, 1),
        }
        buckets = {"s1": {"owner_tag": "OLD"}, "s2": {"owner_tag": "TAG"}}
        points = {1: (0, 0), 2: (30, 0)}
        result = builder.find_suspicious("test", "TAG", districts, list(geometries), geometries, buckets, points)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["member_count"], 1)
        self.assertEqual(len(result[0]["reasons"]), 3)
        self.assertIn("游戏归属 OLD", result[0]["reasons"][0])
        self.assertIn("补洞地块占比", result[0]["reasons"][1])
        self.assertEqual(result[0]["reasons"][2], "单地块组")
        points[1] = (31, 0)
        result = builder.find_suspicious("test", "TAG", districts, list(geometries), geometries, buckets, points)
        self.assertEqual(len(result[0]["reasons"]), 2)


if __name__ == "__main__":
    unittest.main()


class ForeignFragmentMergeTest(unittest.TestCase):
    def test_far_foreign_fragment_merges_and_near_one_stays(self) -> None:
        geometries = {"A": box(0, 0, 1, 1), "B": box(1, 0, 2, 1), "F": box(2, 0, 3, 1), "N": box(0, 1, 1, 2)}
        adjacency = {"A": {"B": 1, "N": 1}, "B": {"A": 1, "F": 1}, "F": {"B": 1}, "N": {"A": 1}}
        groups = {1: {"A"}, 2: {"B"}, 3: {"F"}, 4: {"N"}}
        buckets = {"s1": {"owner_tag": "T"}, "s2": {"owner_tag": "T"}, "s3": {"owner_tag": "X"}, "s4": {"owner_tag": "X"}}
        state_points = {1: (0.5, 0.5), 2: (1.5, 0.5), 3: (60.0, 0.5), 4: (0.5, 1.5)}
        merged = builder.merge_foreign_fragments(groups, "T", buckets, {"T", "X"}, set(), adjacency, geometries, state_points)
        self.assertEqual(merged, 1)
        self.assertNotIn(3, groups)
        self.assertIn("F", groups[2])
        self.assertEqual(groups[4], {"N"})
