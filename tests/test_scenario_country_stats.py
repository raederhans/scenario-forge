import unittest

from tools.build_scenario_country_stats import ADDITIVE, OUTPUT, SCENARIOS, allocate, read


def bucket(tag, **values):
    return {**dict.fromkeys(ADDITIVE, 0), "owner_tag": tag, **values}


class AllocationTests(unittest.TestCase):
    def test_referenced_state_host_pool_and_unallocated(self):
        owners = {"a": "RED", "b": "BLUE"}
        features = {"a": {"population": 3, "land_area_km2": 1},
                    "b": {"population": 1, "land_area_km2": 4}}
        strategic = {
            "bucket_by_feature": {"a": "s1", "b": "s1"},
            "buckets": {
                "s1": bucket("SRC", manpower=100, factories_total=4, steel=10),
                "s2": bucket("SRC", military_factories=8),
                "pool:SRC": bucket("SRC", oil=20),
                "pool:BLUE": bucket("BLUE", coal=5),
                "s3": bucket("LOST", manpower=9),
            },
            "victory_points": [{"state_id": 2, "host_feature_id": "a", "value": 1},
                              {"state_id": 2, "host_feature_id": "b", "value": 3}],
        }
        totals, audit = allocate(strategic, owners, features)
        for tag, expected in (("RED", (75, 3, 2, 2, 4, 0)), ("BLUE", (25, 1, 8, 6, 16, 5))):
            keys = ("manpower", "factories_total", "steel", "military_factories", "oil", "coal")
            self.assertEqual(tuple(totals[tag][key] for key in keys), expected)
        self.assertEqual(audit["cross_country_buckets"], 3)
        self.assertEqual(audit["unallocated_buckets"], [{"id": "s3", "owner_tag": "LOST", "manpower": 9}])
        self.assertEqual(audit["metrics"]["manpower"],
                         {"source_total": 109, "allocated_total": 100, "unallocated_total": 9})

    def test_weight_fallbacks(self):
        owners = {"a": "RED", "b": "BLUE", "c": "BLUE"}
        strategic = {"buckets": {"s1": bucket("SRC", manpower=12, steel=12)},
                     "bucket_by_feature": dict.fromkeys(owners, "s1"), "victory_points": []}
        for features, red in (({"a": {"land_area_km2": 3}, "b": {"land_area_km2": 1}}, 9), ({}, 4)):
            totals, _ = allocate(strategic, owners, features)
            self.assertEqual(totals["RED"]["manpower"], red)
            self.assertEqual(totals["RED"]["steel"], red)


class PublishedStatisticsTests(unittest.TestCase):
    def test_country_population_ranges(self):
        for scenario, ranges in {
            "hoi4_1936": {"GER": (60_000_000, 75_000_000), "RAJ": (250_000_000, 350_000_000),
                          "USA": (110_000_000, 140_000_000)},
            "tno_1962": {"GER": (100_000_000, 150_000_000), "RAJ": (1, float("inf"))},
        }.items():
            countries = read(OUTPUT / f"{scenario}.json")["countries"]
            for tag, (minimum, maximum) in ranges.items():
                with self.subTest(scenario=scenario, tag=tag):
                    value = countries[tag]["scenario_population"]
                    self.assertGreaterEqual(value, minimum)
                    self.assertLessEqual(value, maximum)

    def test_products_and_conservation(self):
        manifest = read(OUTPUT / "manifest.json")
        audits = read(OUTPUT / "audit.json")["scenarios"]
        for scenario in SCENARIOS:
            product = read(OUTPUT / manifest["scenarios"][scenario]["path"])
            for stats in product["countries"].values():
                self.assertEqual(set(stats), set(manifest["metric_ids"]))
                for key, metric in product["metrics"].items():
                    if not metric["available"]:
                        self.assertIsNone(stats[key])
            for metric in audits[scenario]["metrics"].values():
                self.assertAlmostEqual(metric["source_total"], metric["allocated_total"] + metric["unallocated_total"],
                                       delta=metric["source_total"] * 1e-6)
