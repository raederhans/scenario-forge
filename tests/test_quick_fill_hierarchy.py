from __future__ import annotations
import copy
import hashlib
import json
from pathlib import Path
import unittest
from jsonschema import Draft202012Validator
from map_builder.quick_fill_hierarchy import build_quick_fill_metadata, derive_fr_department

ROOT = Path(__file__).resolve().parents[1]

class QuickFillBuildContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.hierarchy = json.loads((ROOT / "data/hierarchy.json").read_text(encoding="utf-8"))
        cls.crosswalk = json.loads((ROOT / "data/quick_fill/china_prefecture_crosswalk.v1.json").read_text(encoding="utf-8"))
        topology = json.loads((ROOT / "data/europe_topology.runtime_political_v1.json").read_text(encoding="utf-8"))
        cls.properties = [g.get("properties", {}) for g in topology["objects"]["political"]["geometries"]]

    def test_rebuild_is_deterministic_and_does_not_mutate_legacy_hierarchy(self):
        before = copy.deepcopy(self.hierarchy)
        metadata = build_quick_fill_metadata(self.hierarchy, self.properties, self.crosswalk)
        self.assertEqual(metadata, self.hierarchy["quick_fill"])
        self.assertEqual(before, self.hierarchy)

    def test_france_departments_partition_all_current_arrondissements(self):
        metadata = self.hierarchy["quick_fill"]["countries"]["FR"]
        self.assertEqual(metadata["default_level"], "region")
        groups = metadata["levels"]["department"]["groups"]
        source = {leaf for k, v in self.hierarchy["groups"].items() if k.startswith("FR_") for leaf in v}
        flattened = [leaf for group in groups.values() for leaf in group["feature_ids"]]
        self.assertEqual(len(groups), 96)
        self.assertEqual(len(flattened), 320)
        self.assertEqual(set(flattened), source)
        self.assertEqual(len(flattened), len(set(flattened)))
        for department, group in groups.items():
            self.assertTrue(group["complete"])
            self.assertTrue(set(group["feature_ids"]) <= set(self.hierarchy["groups"][group["parent_group"]]))
            self.assertTrue(all("FR_DEPT_" + derive_fr_department(leaf) == department for leaf in group["feature_ids"]))

    def test_france_codes_and_conflicting_regions(self):
        for leaf, expected in [("FR_ARR_01001", "01"), ("FR_ARR_2A001", "2A"), ("FR_ARR_2B001", "2B"), ("FR_ARR_9711", "971")]:
            self.assertEqual(derive_fr_department(leaf), expected)
        self.assertIsNone(derive_fr_department("unrelated"))
        with self.assertRaisesRegex(ValueError, "multiple source regions"):
            build_quick_fill_metadata({"groups": {"FR_A": ["FR_ARR_01001"], "FR_B": ["FR_ARR_01002"]}}, [])

    def test_china_unresolved_provinces_are_not_published_as_complete(self):
        level = self.hierarchy["quick_fill"]["countries"]["CN"]["levels"]["prefecture"]
        self.assertEqual(level["status"], "partial")
        self.assertEqual(len(level["unmapped_feature_ids"]), 353)
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
            build_quick_fill_metadata(self.hierarchy, changed, self.crosswalk)
        hierarchy = copy.deepcopy(self.hierarchy)
        key = next(key for key in hierarchy["groups"] if key.startswith("CN_"))
        hierarchy["groups"][key].pop()
        with self.assertRaisesRegex(ValueError, "parent membership changed"):
            build_quick_fill_metadata(hierarchy, self.properties, self.crosswalk)

    def test_checked_in_reference_hash_and_schema(self):
        reference_path = ROOT / "data/quick_fill/reference/china-pca-2017.json"
        self.assertEqual(hashlib.sha256(reference_path.read_bytes()).hexdigest(), self.crosswalk["reference_sha256"])
        for filename, payload in [("quick_fill_china_reference_v1.schema.json", json.loads(reference_path.read_text(encoding="utf-8"))), ("quick_fill_crosswalk_v1.schema.json", self.crosswalk)]:
            schema = json.loads((ROOT / "map_builder/schemas" / filename).read_text(encoding="utf-8"))
            Draft202012Validator.check_schema(schema)
            Draft202012Validator(schema).validate(payload)

    def test_china_publication_requires_a_complete_unique_partition(self):
        released = next(key for key, value in self.crosswalk["provinces"].items() if value["release_enabled"])
        group_key = next(key for key, value in self.crosswalk["groups"].items() if value["province_id"] == released)
        leaf = self.crosswalk["groups"][group_key]["feature_ids"][0]
        mutations = {
            "missing member": lambda c: c["groups"][group_key]["feature_ids"].pop(),
            "duplicate member": lambda c: c["groups"][group_key]["feature_ids"].append(leaf),
            "duplicate group": lambda c: c["groups"].update({"CN_PREF_duplicate": copy.deepcopy(c["groups"][group_key])}),
            "unresolved overlap": lambda c: c["unresolved"].append({"feature_id": leaf, "province_id": released, "name": "duplicate", "candidates": []}),
            "missing province": lambda c: c["provinces"].pop(released),
            "stale count": lambda c: c["provinces"][released].update({"matched": 0}),
            "incomplete group": lambda c: c["groups"][group_key].update({"complete": False}),
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label):
                crosswalk = copy.deepcopy(self.crosswalk)
                mutate(crosswalk)
                with self.assertRaises(ValueError):
                    build_quick_fill_metadata(self.hierarchy, self.properties, crosswalk)

if __name__ == "__main__": unittest.main()
