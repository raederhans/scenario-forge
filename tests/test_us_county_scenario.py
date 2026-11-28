import unittest
from copy import deepcopy

from shapely.geometry import box, mapping

from map_builder.regional_geometry import _encode_exact_coverage, _decode_geometry
from tools.stage_us_county_scenario import replace_counties, project_migration_contract


class CountyScenarioTests(unittest.TestCase):
    def test_project_migration_uses_stable_identity_not_area_evidence(self):
        contract = project_migration_contract(
            ['US_CNTY_26001', 'US_CNTY_09120', 'US_ZN_26_001', 'CA_TEST'],
            ['US_CNTY_26001', 'US_CNTY_09120', 'US_CNTY_26003', 'CA_TEST'],
            ['US_CNTY_09120'], 'old', 'new')
        self.assertEqual(contract['crosswalk'], {'US_CNTY_26001': ['US_CNTY_26001']})
        self.assertEqual(contract['unresolved_ids'], ['US_CNTY_09120', 'US_ZN_26_001'])
        self.assertEqual(contract['source_baseline_hash'], 'old')
        self.assertEqual(contract['target_baseline_hash'], 'new')

    def setUp(self):
        self.baseline = _encode_exact_coverage(["US_ZN_26_001", "CA_TEST", "IN_ADM2_TEST"],
                                               [box(0, 0, 2, 1), box(2, 0, 3, 1), box(5, 0, 6, 1)])
        rows = self.baseline["objects"]["political"]["geometries"]
        for row, code in zip(rows, ["US", "CA", "IN"]):
            row["properties"].update(cntr_code=code, admin1_group="Michigan" if code == "US" else code)
        self.source = {"type": "FeatureCollection", "features": [
            {"type": "Feature", "properties": {"id": fid, "cntr_code": "US", "admin1_group": "Michigan"},
             "geometry": mapping(geometry)} for fid, geometry in
            [("US_CNTY_26001", box(0, 0, 1, 1)), ("US_CNTY_26003", box(1, 0, 2, 1))]]}
        self.owners = {"US_ZN_26_001": "US", "CA_TEST": "CA", "IN_ADM2_TEST": "IN"}
        self.cores = {fid: [owner] for fid, owner in self.owners.items()}

    def test_no_overlap_is_unresolved_not_nearest(self):
        self.source["features"][0]["geometry"] = mapping(box(-4, 0, -3, 1))
        self.source["features"][1]["geometry"] = mapping(box(-3, 0, -2, 1))
        _, _, _, report = replace_counties(self.baseline, self.source, self.owners, self.cores)
        self.assertEqual(report["crosswalk"]["US_ZN_26_001"], [])
        self.assertEqual(report["removed_land_degrees2"], 2)

    def test_county_split_preserves_non_targets_and_assignments(self):
        saved = deepcopy(self.baseline)
        result, owners, cores, report = replace_counties(self.baseline, self.source, self.owners, self.cores)
        self.assertEqual(self.baseline, saved)
        self.assertEqual(set(owners), {"US_CNTY_26001", "US_CNTY_26003", "CA_TEST", "IN_ADM2_TEST"})
        self.assertEqual(cores["US_CNTY_26001"], ["US"])
        before = {r["properties"]["id"]: r for r in saved["objects"]["political"]["geometries"]}
        after = {r["properties"]["id"]: r for r in result["objects"]["political"]["geometries"]}
        for fid in ("CA_TEST", "IN_ADM2_TEST"):
            self.assertEqual(before[fid]["properties"], after[fid]["properties"])
            self.assertTrue(_decode_geometry(saved, before[fid]).equals_exact(_decode_geometry(result, after[fid]), 0))
        self.assertEqual(report["new_land_degrees2"], 0)
        self.assertEqual(report["removed_land_degrees2"], 0)
        self.assertEqual(len(report["crosswalk"]["US_ZN_26_001"]), 2)
        self.assertFalse(report["automatic_project_migration"])


if __name__ == "__main__":
    unittest.main()
