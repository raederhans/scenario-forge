import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tools import check_scenario_contracts
from tools.check_hoi4_scenario_bundle import inspect_hoi4_scenario_bundle


class CheckHoi4ScenarioBundleTest(unittest.TestCase):
    def setUp(self):
        root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.enterContext(patch.object(check_scenario_contracts, "PROJECT_ROOT", root))
        prefix = "data/scenarios/hoi4_1936"
        self.directory = root / prefix
        self.directory.mkdir(parents=True)
        self.report_dir = root / "reports"
        self.expectation = root / "expectation.json"
        self.expectation.write_text(json.dumps({"summary_equals": {"feature_count": 1}}))

        summary = {
            "feature_count": 1, "owner_count": 1, "controller_count": 1,
            "approximate_count": 0, "geometry_blocker_count": 0,
            "failed_region_check_count": 0, "synthetic_owner_feature_count": 0,
        }
        self.write("manifest.json", {
            "version": 2, "scenario_id": "hoi4_1936", "display_name": "hoi4_1936",
            "bookmark_name": "hoi4_1936", "bookmark_description": "hoi4_1936 description",
            "bookmark_date": "1936.1.1.12", "default_country": "AAA", "featured_tags": ["AAA"],
            "palette_id": "hoi4_vanilla", "baseline_hash": "abc123", "summary": summary,
            "countries_url": f"{prefix}/countries.json", "owners_url": f"{prefix}/owners.by_feature.json",
            "cores_url": f"{prefix}/cores.by_feature.json", "audit_url": f"{prefix}/audit.json",
            "city_overrides_url": f"{prefix}/city_overrides.json",
            "capital_hints_url": f"{prefix}/capital_hints.json",
            "special_zone_layers_url": f"{prefix}/special_zone_layers.json",
            "strategic_values_url": f"{prefix}/strategic_values.by_feature.json",
            "generated_at": "2026-04-03T00:00:00Z", "performance_hints": {"render_profile_default": "balanced"},
            "style_defaults": {"ocean": {"fillColor": "#123456"}},
        })
        self.write("countries.json", {"countries": {"AAA": {
            "feature_count": 1, "controller_feature_count": 1, "entry_kind": "country", "display_name": "AAA",
        }}})
        self.write("owners.by_feature.json", {"owners": {"F-1": "AAA"}})
        self.write("controllers.by_feature.json", {"controllers": {"F-1": "AAA"}})
        self.write("cores.by_feature.json", {"cores": {"F-1": ["AAA"]}})
        self.write("special_zone_layers.json", {"version": 1, "layers": [], "activeLayerId": "",
                                               "topologyFingerprint": "", "diagnostics": []})
        self.write("city_overrides.json", {"version": 1, "scenario_id": "hoi4_1936",
                                          "capitals_by_tag": {"AAA": "CITY::capital"}, "capital_city_hints": {}})
        self.write("capital_hints.json", {"version": 1, "scenario_id": "hoi4_1936", "entries": []})
        self.write("audit.json", {"summary": summary})
        self.strategic = {
            "version": 1, "scenario_id": "hoi4_1936", "baseline_hash": "abc123",
            "buckets": {"s1": {"state_id": 1, "owner_tag": "AAA"}},
            "bucket_by_feature": {"F-1": "s1"},
            "resource_points": {"type": "FeatureCollection", "features": []},
        }
        self.write("strategic_values.by_feature.json", self.strategic)

    def write(self, name, payload):
        (self.directory / name).write_text(json.dumps(payload), encoding="utf-8")

    def inspect(self):
        return inspect_hoi4_scenario_bundle(self.directory, self.report_dir, expectation_path=self.expectation)

    def test_valid_bundle_matches_expectation(self):
        report = self.inspect()
        self.assertEqual(report["status"], "ok")
        self.assertEqual(report["shared_errors"], [])
        self.assertEqual(report["domain_errors"], [])

    def test_inspect_hoi4_scenario_bundle_rejects_stale_strategic_baseline(self):
        self.strategic["baseline_hash"] = "stale"
        self.write("strategic_values.by_feature.json", self.strategic)
        report = self.inspect()
        self.assertEqual(report["status"], "failed")
        self.assertTrue(any("strategic_values.by_feature.json.baseline_hash" in error for error in report["domain_errors"]))

    def test_inspect_hoi4_scenario_bundle_rejects_partial_strategic_feature_coverage(self):
        self.write("owners.by_feature.json", {"owners": {"F-1": "AAA", "F-2": "AAA"}})
        self.write("controllers.by_feature.json", {"controllers": {"F-1": "AAA", "F-2": "AAA"}})
        self.write("cores.by_feature.json", {"cores": {"F-1": ["AAA"], "F-2": ["AAA"]}})
        report = self.inspect()
        self.assertEqual(report["status"], "failed")
        self.assertTrue(
            any("bucket_by_feature is missing owner feature IDs" in error for error in report["domain_errors"]),
            report["domain_errors"],
        )
