import unittest

from tools.build_scenario_country_stats import ADDITIVE, DATA, FACTORIES, GHSL, OUTPUT, SCENARIOS, allocate, read


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
    def test_antarctic_area_and_placeholder_pool(self):
        countries = read(OUTPUT / "hoi4_1936.json")["countries"]
        antarctic = countries["AAT"]
        population = antarctic["scenario_population"]
        self.assertTrue(population is None or population < 10_000)
        self.assertGreater(antarctic["scenario_land_area_km2"], 5_000_000)
        for key, value in countries["ALG"].items():
            if key in ("scenario_land_area_km2", "scenario_core_share"):
                self.assertIsNotNone(value)
            else:
                self.assertIsNone(value, key)

    def test_non_political_groups(self):
        for scenario in SCENARIOS:
            product = read(OUTPUT / f"{scenario}.json")
            owners = read(DATA / "scenarios" / scenario / "owners.by_feature.json")["owners"]
            features = read(GHSL / "features" / f"{scenario}.json")["features"]
            political = {tag for fid, tag in owners.items() if fid in features and
                         features[fid]["status"] not in ("water_not_applicable", "unestimated_scenario_land")}
            self.assertEqual(set(product["countries"]), political)
            self.assertEqual(product["non_political_tags"], sorted(set(owners.values()) - political))
            if scenario == "tno_1962":
                self.assertIn("ATL", product["non_political_tags"])
                self.assertNotIn("ATL", product["countries"])

    def test_runtime_assets(self):
        registry = read(DATA / "runtime_asset_registry.json")["assets"]
        catalog = {entry["key"]: entry for entry in read(DATA / "CATALOG.json")["entries"]}
        for scenario in (None, *SCENARIOS):
            role = "scenario_country_stats" if scenario else "scenario_country_stats_manifest"
            key = f"{role}:{scenario}" if scenario else role
            asset = registry[key]
            path = OUTPUT / f"{scenario or 'manifest'}.json"
            product = read(path)
            self.assertEqual(asset["url"], path.relative_to(DATA.parent).as_posix())
            self.assertEqual(asset["role"], role)
            self.assertEqual(asset["metadata"], {"layer_id": product["layer_id"], "data_version": product["data_version"],
                                                "scenario_id": scenario, "load_policy": "on_demand",
                                                "source_policy": "scenario_derived"})
            self.assertEqual(catalog[key]["url"], asset["url"])
            self.assertEqual(catalog[key]["schemaRef"], asset["schema_ref"])
            self.assertTrue((DATA.parent / asset["schema_ref"]).is_file())

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
