from __future__ import annotations
import unittest
from tools.apply_political_feature_merges import Merges, merge_population

GROUP = {"id": "PL_MRG_test", "member_ids": ["A", "B"]}


def row(status, population, area, density, coverage):
    return {"population": population, "land_area_km2": area, "density": density,
            "coverage_fraction": coverage, "status": status, "source_epoch": 2020}


def merge(a, b):
    payload = {"features": {"A": a, "B": b, "C": row("ok", 5.0, 1.0, 5.0, 1.0)}}
    features = merge_population(payload, Merges({"groups": [GROUP]}), "test")["features"]
    assert set(features) == {"PL_MRG_test", "C"}
    return features["PL_MRG_test"]


class MergedPopulationRowTest(unittest.TestCase):
    """Merged rows must satisfy the population registrar's per-status contract."""

    def test_complete_members_sum_and_rederive_density(self):
        merged = merge(row("ok", 30.0, 2.0, 15.0, 1.0), row("ok", 10.0, 3.0, 10.0 / 3.0, 1.0))
        self.assertEqual((merged["status"], merged["population"], merged["land_area_km2"]), ("ok", 40.0, 5.0))
        self.assertAlmostEqual(merged["density"], 8.0)
        self.assertEqual(merged["coverage_fraction"], 1.0)

    def test_partial_member_makes_a_partial_row_without_density(self):
        merged = merge(row("partial_coverage", 30.0, 2.0, None, 0.5), row("ok", 10.0, 2.0, 5.0, 1.0))
        self.assertEqual((merged["status"], merged["population"], merged["density"]), ("partial_coverage", 40.0, None))
        self.assertAlmostEqual(merged["coverage_fraction"], 0.75)

    def test_unknown_member_leaves_population_unknown(self):
        merged = merge(row("ok", 30.0, 2.0, 15.0, 1.0), row("no_data", None, None, None, None))
        self.assertEqual((merged["status"], merged["population"], merged["density"]), ("no_data", None, None))


if __name__ == "__main__":
    unittest.main()
