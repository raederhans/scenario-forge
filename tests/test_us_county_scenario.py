import unittest
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from copy import deepcopy

from shapely.geometry import box, mapping, Polygon

from map_builder.regional_geometry import _encode_exact_coverage, _decode_geometry
from tools.stage_us_county_scenario import replace_counties, startup_county_lod, validate_source_report, stage, ROOT, county_hierarchy_override, project_migration_contract, reviewed_legacy_lineage, LEGACY_LINEAGE_PATH
from tools.prepare_tno_russia_precision import digest


class CountyScenarioTests(unittest.TestCase):
    def _reviewed_fixture(self):
        payload = json.loads(LEGACY_LINEAGE_PATH.read_text(encoding="utf-8"))
        old_ids = {entry["source_id"] for entry in payload["lineage"]} | {"US_CNTY_09120", "US_CNTY_26001"}
        owners = {target: "US" for entry in payload["lineage"] for target in entry["target_ids"]}
        owners.update({"US_CNTY_09120": "US", "US_CNTY_26001": "US"})
        binding = payload["binding"]
        return payload, old_ids, owners, binding

    def test_reviewed_lineage_adds_eight_explicit_members_and_keeps_invalid_county_unresolved(self):
        payload, old_ids, owners, binding = self._reviewed_fixture()
        lineage, status = reviewed_legacy_lineage(
            payload, binding["baseline_runtime_sha256"], binding["county_source_sha256"],
            old_ids, owners, {"US_CNTY_09120"})
        self.assertEqual(status, "applied")
        self.assertEqual(len(lineage), 8)
        self.assertEqual(lineage["US_ZN_51_015"],
                         ["US_CNTY_51013", "US_CNTY_51510", "US_CNTY_51610"])
        contract = project_migration_contract(old_ids, owners, {"US_CNTY_09120"},
                                              "source-baseline", "target-baseline", lineage)
        self.assertEqual(len(contract["crosswalk"]), 9)
        self.assertEqual(contract["unresolved_ids"], ["US_CNTY_09120"])
        self.assertEqual(contract["source_baseline_hash"], "source-baseline")
        self.assertEqual(contract["target_baseline_hash"], "target-baseline")

    def test_reviewed_lineage_binding_mismatch_keeps_zones_unresolved(self):
        payload, old_ids, owners, binding = self._reviewed_fixture()
        for baseline_hash, source_hash, reason in [
            ("changed", binding["county_source_sha256"], "baseline_runtime_sha256_mismatch"),
            (binding["baseline_runtime_sha256"], "changed", "county_source_sha256_mismatch"),
        ]:
            with self.subTest(reason=reason):
                lineage, status = reviewed_legacy_lineage(
                    payload, baseline_hash, source_hash, old_ids, owners, {"US_CNTY_09120"})
                self.assertEqual((lineage, status), ({}, reason))
                contract = project_migration_contract(old_ids, owners, {"US_CNTY_09120"},
                                                      "old", "new", lineage)
                self.assertEqual(len(contract["unresolved_ids"]), 9)

    def test_reviewed_lineage_rejects_duplicate_illegal_or_conflicting_targets(self):
        payload, old_ids, owners, binding = self._reviewed_fixture()
        bad_targets = ["US_CNTY_02016", "US_CNTY_XXXXX", "US_CNTY_26001", "US_CNTY_99999"]
        for target in bad_targets:
            with self.subTest(target=target):
                changed = deepcopy(payload)
                changed["lineage"][1]["target_ids"] = [target]
                with self.assertRaisesRegex(ValueError, "target"):
                    reviewed_legacy_lineage(
                        changed, binding["baseline_runtime_sha256"], binding["county_source_sha256"],
                        old_ids, owners, {"US_CNTY_09120"})
        changed = deepcopy(payload)
        changed["lineage"][1]["source_id"] = changed["lineage"][0]["source_id"]
        with self.assertRaisesRegex(ValueError, "source"):
            reviewed_legacy_lineage(changed, binding["baseline_runtime_sha256"],
                                    binding["county_source_sha256"], old_ids, owners, {"US_CNTY_09120"})
        changed_owners = dict(owners, US_CNTY_29510="CA")
        with self.assertRaisesRegex(ValueError, "non-US legacy target"):
            reviewed_legacy_lineage(payload, binding["baseline_runtime_sha256"],
                                    binding["county_source_sha256"], old_ids, changed_owners,
                                    {"US_CNTY_09120"})

    def test_invalid_old_zone_is_not_rescued_by_reviewed_lineage(self):
        payload, old_ids, owners, binding = self._reviewed_fixture()
        invalid = {"US_CNTY_09120", "US_ZN_51_015"}
        lineage, status = reviewed_legacy_lineage(
            payload, binding["baseline_runtime_sha256"], binding["county_source_sha256"],
            old_ids, owners, invalid)
        self.assertEqual(status, "applied")
        self.assertNotIn("US_ZN_51_015", lineage)
        contract = project_migration_contract(old_ids, owners, invalid, "old", "new", lineage)
        self.assertEqual(contract["unresolved_ids"], ["US_CNTY_09120", "US_ZN_51_015"])

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

    def test_scenario_assignment_conflicts_are_rejected(self):
        self.owners["US_ZN_26_001"] = "JAP"
        with self.assertRaisesRegex(ValueError, "uniform modern"):
            replace_counties(self.baseline, self.source, self.owners, self.cores)

    def test_invalid_neighbor_near_source_is_not_silently_skipped(self):
        bad = _encode_exact_coverage(['US_ZN_26_001', 'CA_TEST'],
            [box(0, 0, 2, 1), Polygon([(1, 0), (3, 1), (1, 1), (3, 0), (1, 0)])])
        for row, code in zip(bad['objects']['political']['geometries'], ['US', 'CA']):
            row['properties'].update(cntr_code=code, admin1_group='Michigan' if code == 'US' else 'Canada')
        with self.assertRaisesRegex(ValueError, 'Invalid neighbor'):
            replace_counties(bad, self.source, self.owners, self.cores)

    def test_duplicate_county_ids_rejected(self):
        self.source["features"].append(self.source["features"][0])
        with self.assertRaisesRegex(ValueError, "Unique"):
            replace_counties(self.baseline, self.source, self.owners, self.cores)

    def test_no_overlap_is_unresolved_not_nearest(self):
        self.source["features"][0]["geometry"] = mapping(box(-4, 0, -3, 1))
        self.source["features"][1]["geometry"] = mapping(box(-3, 0, -2, 1))
        _, _, _, report = replace_counties(self.baseline, self.source, self.owners, self.cores)
        self.assertEqual(report["crosswalk"]["US_ZN_26_001"], [])
        self.assertEqual(report["removed_land_degrees2"], 2)

    def test_foreign_overlap_is_reported_not_hidden(self):
        self.source["features"][1]["geometry"] = mapping(box(1, 0, 2.5, 1))
        _, _, _, report = replace_counties(self.baseline, self.source, self.owners, self.cores)
        self.assertEqual(report["foreign_overlap"], [{"id": "CA_TEST", "area_degrees2": 0.5}])
        self.assertFalse(report["release_ready"])

    def test_repeated_point_baseline_part_is_recorded(self):
        first = self.baseline["objects"]["political"]["geometries"][0]
        first["type"] = "MultiPolygon"
        index = len(self.baseline["arcs"])
        self.baseline["arcs"].append([[0, 0], [0, 0]])
        first["arcs"] = [first["arcs"], [[index]]]
        _, _, _, report = replace_counties(self.baseline, self.source, self.owners, self.cores)
        self.assertEqual(report["baseline_zero_extent_parts"], {"US_ZN_26_001": 1})
        self.assertEqual(report["removed_land_degrees2"], 0)

    def test_startup_defers_geometry_to_chunks(self):
        candidate, _, _, _ = replace_counties(self.baseline, self.source, self.owners, self.cores)
        startup, report = startup_county_lod(candidate)
        self.assertEqual(startup["objects"]["political"]["geometries"], [])
        self.assertEqual(startup["arcs"], [])
        self.assertEqual(len(candidate["objects"]["political"]["geometries"]), 4)
        self.assertEqual(report["county_count"], 2)

    def test_hierarchy_uses_new_county_membership(self):
        override = county_hierarchy_override(self.source)
        self.assertEqual(override, {"country_codes": ["US"],
            "groups": {"US_Michigan": ["US_CNTY_26001", "US_CNTY_26003"]},
            "labels": {"US_Michigan": "Michigan"}})

    def test_untouched_us_state_overlap_is_reported(self):
        self.baseline["objects"]["political"]["geometries"][1]["properties"].update(
            cntr_code="US", admin1_group="New York")
        self.source["features"][1]["geometry"] = mapping(box(1, 0, 2.5, 1))
        _, _, _, report = replace_counties(self.baseline, self.source, self.owners, self.cores)
        self.assertEqual(report["foreign_overlap"], [{"id": "CA_TEST", "area_degrees2": 0.5}])

    def test_invalid_old_surface_leaves_migration_unresolved(self):
        invalid = _encode_exact_coverage(["US_ZN_26_001"],
            [Polygon([(0, 0), (2, 1), (0, 1), (2, 0), (0, 0)])])
        invalid["objects"]["political"]["geometries"][0]["properties"].update(
            cntr_code="US", admin1_group="Michigan")
        _, _, _, report = replace_counties(invalid, self.source, self.owners, self.cores)
        self.assertIn("US_ZN_26_001", report["invalid_baseline_unresolved"])
        self.assertEqual(report["crosswalk"]["US_ZN_26_001"], [])
        self.assertIsNone(report["removed_land_degrees2"])

    def test_source_binding_rejects_changed_bytes_or_missing_county(self):
        with TemporaryDirectory() as temp:
            path = Path(temp) / "counties.geojson"
            for feature in self.source["features"]:
                feature["properties"].update(GEOID=feature["properties"]["id"][8:], STATEFP="26")
            path.write_text(json.dumps(self.source), encoding="utf-8")
            report = {"display_geojson_sha256": digest(path), "states": [{
                "statefp": "26", "source_geoids": ["26001", "26003"],
                "display_geoids": ["26001", "26003"], "coverage_valid": True,
                "geometry_invalid_count": 0}]}
            report_path = path.with_name("source-report.json")
            report_path.write_text(json.dumps(report), encoding="utf-8")
            validate_source_report(path, self.source)
            path.write_text(json.dumps(self.source) + "\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "bytes"):
                validate_source_report(path, self.source)
            self.source["features"].pop()
            path.write_text(json.dumps(self.source), encoding="utf-8")
            report["display_geojson_sha256"] = digest(path)
            report_path.write_text(json.dumps(report), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "complete"):
                validate_source_report(path, self.source)

    def test_failed_stage_does_not_publish_partial_candidate(self):
        with TemporaryDirectory(dir=ROOT / ".runtime/tmp") as temp:
            output = Path(temp) / "modern_world"
            def fail(_baseline, _source, target, **_kwargs):
                target.mkdir()
                (target / "manifest.json").write_text("partial", encoding="utf-8")
                raise ValueError("build failed")
            with patch("tools.stage_us_county_scenario._stage_into", side_effect=fail):
                with self.assertRaisesRegex(ValueError, "build failed"):
                    stage(ROOT / "data/scenarios/modern_world", Path(temp) / "source.json", output)
            self.assertFalse(output.exists())
            self.assertEqual(list(Path(temp).iterdir()), [])


if __name__ == "__main__":
    unittest.main()
