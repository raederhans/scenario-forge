import hashlib
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from shapely.geometry import Polygon, box

from tools.validate_us_county_lod import load_chunk, validate_lod_sets


class CountyLodTests(unittest.TestCase):
    def setUp(self):
        # These tessellate one rectangle, with a bent internal boundary.
        self.source = {
            "a": Polygon([(0, 0), (1, 0), (1.2, .5), (1, 1), (0, 1)]),
            "b": Polygon([(1, 0), (2, 0), (2, 1), (1, 1), (1.2, .5)]),
            "c": box(2, 0, 3, 1),
        }
        self.coarse = {"a": box(0, 0, 1, 1), "b": box(1, 0, 2, 1), "c": self.source["c"]}

    def test_internal_simplification_is_safe_inside_whole_loaded_shard(self):
        result = validate_lod_sets(self.source, self.coarse,
                                   {"one": {k: self.source[k] for k in ["a", "b"]},
                                    "two": {"c": self.source["c"]}})
        self.assertEqual(result["status"], "PASS")
        self.assertTrue(result["all_shard_combinations_proven"])
        self.assertFalse(result["release_ready"])

    def test_owner_union_equality_does_not_approve_changed_shard_edges(self):
        result = validate_lod_sets(self.source, self.coarse,
                                   {key: {key: value} for key, value in self.source.items()})
        self.assertTrue(result["coarse_coverage_valid"])
        self.assertEqual(result["status"], "FAIL")
        self.assertFalse(result["all_shard_combinations_proven"])
        self.assertGreater(result["shards"][0]["domain_difference_degrees2"], 0)

    def test_overlapping_coarse_members_fail_even_if_shard_union_matches(self):
        rough = {"a": box(0, 0, 1.2, 1), "b": box(1, 0, 2, 1), "c": self.source["c"]}
        result = validate_lod_sets(self.source, rough, {"one": self.source})
        self.assertTrue(result["shards"][0]["domain_equal"])
        self.assertFalse(result["shards"][0]["coarse_coverage_valid"])
        self.assertEqual(result["status"], "FAIL")

    def test_detail_change_cannot_be_hidden_by_matching_coarse(self):
        result = validate_lod_sets(self.source, self.coarse, {"one": self.coarse})
        self.assertEqual(result["status"], "FAIL")
        self.assertFalse(result["shards"][0]["detail_matches_source"])

    def test_missing_duplicate_and_unknown_members_fail(self):
        for coarse, shards, message in [
            ({"a": self.coarse["a"]}, {"one": self.source}, "coarse county membership"),
            (self.coarse, {"one": {"a": self.source["a"]}}, "detail county membership"),
            (self.coarse, {"one": self.source, "two": {"a": self.source["a"]}}, "duplicate county"),
            (self.coarse, {"one": self.source, "two": {"unknown": box(4, 0, 5, 1)}}, "unknown county"),
        ]:
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                validate_lod_sets(self.source, coarse, shards)

    def test_chunk_integrity_and_path_are_checked(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            raw = json.dumps({"features": []}).encode()
            (root / "chunk.json").write_bytes(raw)
            entry = {"id": "one", "url": "data/scenarios/test/chunk.json",
                     "byte_size": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
                     "feature_count": 0}
            self.assertEqual(load_chunk(root, "test", entry), [])
            (root / "chunk.json").write_bytes(raw + b" ")
            with self.assertRaisesRegex(ValueError, "integrity mismatch"):
                load_chunk(root, "test", entry)
            entry["url"] = "data/scenarios/test/../outside.json"
            with self.assertRaisesRegex(ValueError, "escapes candidate"):
                load_chunk(root, "test", entry)


if __name__ == "__main__":
    unittest.main()
