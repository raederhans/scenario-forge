from __future__ import annotations

import json
import unittest
from collections import Counter
from pathlib import Path

from map_builder.scenario_context import load_scenario_context, load_scenario_mutations_payload
from map_builder.scenario_district_groups_service import build_district_groups_payload_in_context
from tools import build_tno_district_groups as builder


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SCENARIO_DIR = PROJECT_ROOT / "data" / "scenarios" / "tno_1962"
DISTRICTS_PATH = SCENARIO_DIR / "district_groups.manual.json"
OWNERS_PATH = SCENARIO_DIR / "owners.by_feature.json"
SPEC_PATH = PROJECT_ROOT / "tools" / "district_specs" / "tno_1962.json"


class TnoDistrictGroupsContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.payload = json.loads(DISTRICTS_PATH.read_text(encoding="utf-8"))
        cls.owners = json.loads(OWNERS_PATH.read_text(encoding="utf-8"))["owners"]
        cls.spec = json.loads(SPEC_PATH.read_text(encoding="utf-8"))

    def test_spec_tags_are_all_published(self) -> None:
        self.assertEqual(self.payload["scenario_id"], "tno_1962")
        self.assertEqual(set(self.payload["tags"]), set(self.spec["tags"]))
        for tag in (
            "GER", "FRA", "ENG", "ITA", "IBR", "RKM", "RKU", "RKO", "RKP", "RKN",
            "USA", "CHI", "CAN", "MEX", "NCP", "AZH", "TUR", "JAP", "MAN", "RAJ", "KOR",
        ):
            self.assertIn(tag, self.payload["tags"])

    def test_feature_ids_exist_and_belong_to_tag(self) -> None:
        for tag, record in self.payload["tags"].items():
            for district_id, district in record["districts"].items():
                for feature_id in district["feature_ids"]:
                    with self.subTest(tag=tag, district=district_id, feature=feature_id):
                        self.assertIn(feature_id, self.owners)
                        self.assertEqual(self.owners[feature_id], tag)

    def test_features_are_not_shared_between_districts(self) -> None:
        counts = Counter(
            feature_id
            for record in self.payload["tags"].values()
            for district in record["districts"].values()
            for feature_id in district["feature_ids"]
        )
        self.assertEqual([feature_id for feature_id, count in counts.items() if count > 1], [])

    def test_covered_tags_have_full_coverage(self) -> None:
        for tag, record in self.payload["tags"].items():
            assigned = {
                feature_id
                for district in record["districts"].values()
                for feature_id in district["feature_ids"]
            }
            owned = {feature_id for feature_id, owner in self.owners.items() if owner == tag}
            with self.subTest(tag=tag):
                self.assertEqual(sorted(owned - assigned), [])
                self.assertGreaterEqual(len(record["districts"]), 2)

    def test_district_records_are_named(self) -> None:
        for tag, record in self.payload["tags"].items():
            for district_id, district in record["districts"].items():
                with self.subTest(tag=tag, district=district_id):
                    self.assertEqual(district["district_id"], district_id)
                    self.assertTrue(district["name_en"].strip())
                    self.assertTrue(district["name_zh"].strip())
                    self.assertTrue(district["feature_ids"])

    def test_published_file_matches_spec_rebuild(self) -> None:
        # 合并地块 ID 或归属变化后，需要重跑 tools/build_tno_district_groups.py。
        rebuilt, _ = builder.build_tags(self.spec, builder.load_features())
        self.assertEqual(rebuilt, self.payload["tags"])

    def test_editing_source_materializes_to_published_file(self) -> None:
        # 开发工作区保存大区时会从 scenario_mutations.json 整份重写 manual 文件，二者必须一致。
        context = load_scenario_context("tno_1962")
        mutations = load_scenario_mutations_payload(context)
        materialized = build_district_groups_payload_in_context(context, mutations)
        self.assertEqual(materialized["tags"], self.payload["tags"])


if __name__ == "__main__":
    unittest.main()
