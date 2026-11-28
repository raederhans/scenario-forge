import unittest

from shapely.geometry import Polygon, box

from tools.validate_us_county_lod import validate_lod_sets


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


if __name__ == "__main__":
    unittest.main()
