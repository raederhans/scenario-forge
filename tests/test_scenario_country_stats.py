import unittest

from tools.build_scenario_country_stats import (
    ADDITIVE,
    FACTORIES,
    OUTPUT,
    SCENARIOS,
    allocate,
    read,
)


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
                "pool:SRC": bucket("SRC", manpower=20, factories_total=8, oil=20),
                "pool:BLUE": bucket("BLUE", coal=5),
                "s3": bucket("LOST", manpower=9),
            },
            "victory_points": [{"state_id": 2, "host_feature_id": "a", "value": 1},
                              {"state_id": 2, "host_feature_id": "b", "value": 3}],
        }
        totals, audit = allocate(strategic, owners, features)
        for tag, expected in (("RED", (90, 9, 2, 2, 4, 0)), ("BLUE", (30, 3, 8, 6, 16, 5))):
            keys = ("manpower", "factories_total", "steel", "military_factories", "oil", "coal")
            self.assertEqual(tuple(totals[tag][key] for key in keys), expected)
        self.assertEqual(audit["cross_country_buckets"], 3)
        self.assertEqual(audit["unallocated_buckets"], [{"id": "s3", "owner_tag": "LOST", "manpower": 9}])
        self.assertEqual(audit["metrics"]["manpower"],
                         {"source_total": 129, "allocated_total": 120, "unallocated_total": 9})
        self.assertEqual(audit["unallocated_manpower_zero_population_weight"], 0)

    def test_weight_fallbacks(self):
        owners = {"a": "RED", "b": "BLUE", "c": "BLUE"}
        strategic = {"buckets": {bid: bucket("RED", manpower=12, steel=12, **dict.fromkeys(FACTORIES, 4))
                                 for bid in ("s1", "pool:RED")},
                     "bucket_by_feature": dict.fromkeys(owners, "s1"), "victory_points": []}
        for features, red in (({"a": {"land_area_km2": 3}, "b": {"land_area_km2": 1}}, 18), ({}, 16)):
            totals, audit = allocate(strategic, owners, features)
            self.assertEqual(audit["unallocated_manpower_zero_population_weight"], 24)
            self.assertEqual(audit["metrics"]["manpower"]["unallocated_total"], 24)
            for key in FACTORIES:
                self.assertEqual(audit["metrics"][key]["unallocated_total"], 8)
            self.assertEqual(totals["RED"]["steel"], red)


class PublishedStatisticsTests(unittest.TestCase):
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
