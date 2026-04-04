from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from tools import check_scenario_contracts
from tools.check_hoi4_scenario_bundle import inspect_hoi4_scenario_bundle


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _create_valid_hoi4_bundle(tmp_root: Path, scenario_name: str = "hoi4_1936") -> tuple[Path, Path, Path]:
    scenario_dir = tmp_root / "data" / "scenarios" / scenario_name
    report_dir = tmp_root / ".runtime" / "reports" / "generated" / "scenarios" / scenario_name
    expectation_path = tmp_root / "data" / "scenarios" / "expectations" / f"{scenario_name}.expectation.json"

    _write_json(
        scenario_dir / "manifest.json",
        {
            "version": 2,
            "scenario_id": scenario_name,
            "display_name": scenario_name,
            "bookmark_name": scenario_name,
            "bookmark_description": f"{scenario_name} description",
            "bookmark_date": "1936.1.1.12",
            "default_country": "AAA",
            "featured_tags": ["AAA"],
            "palette_id": "hoi4_vanilla",
            "baseline_hash": "abc123",
            "countries_url": f"data/scenarios/{scenario_name}/countries.json",
            "owners_url": f"data/scenarios/{scenario_name}/owners.by_feature.json",
            "controllers_url": f"data/scenarios/{scenario_name}/controllers.by_feature.json",
            "cores_url": f"data/scenarios/{scenario_name}/cores.by_feature.json",
            "audit_url": f"data/scenarios/{scenario_name}/audit.json",
            "city_overrides_url": f"data/scenarios/{scenario_name}/city_overrides.json",
            "capital_hints_url": f"data/scenarios/{scenario_name}/capital_hints.json",
            "summary": {
                "feature_count": 1,
                "owner_count": 1,
                "controller_count": 1,
                "approximate_count": 0,
                "geometry_blocker_count": 0,
                "failed_region_check_count": 0,
                "synthetic_owner_feature_count": 0,
            },
            "generated_at": "2026-04-03T00:00:00Z",
            "performance_hints": {"render_profile_default": "balanced"},
            "style_defaults": {"ocean": {"fillColor": "#123456"}},
        },
    )
    _write_json(
        scenario_dir / "city_overrides.json",
        {
            "version": 1,
            "scenario_id": scenario_name,
            "capitals_by_tag": {"AAA": "CITY::capital"},
            "capital_city_hints": {},
        },
    )
    _write_json(
        scenario_dir / "capital_hints.json",
        {
            "version": 1,
            "scenario_id": scenario_name,
            "entries": [],
        },
    )
    _write_json(
        scenario_dir / "scenario_mutations.json",
        {
            "version": 1,
            "scenario_id": scenario_name,
            "generated_at": "",
            "tags": {},
            "countries": {},
            "assignments_by_feature_id": {},
            "capitals": {},
            "geo_locale": {},
            "district_groups": {},
        },
    )
    _write_json(
        scenario_dir / "city_assets.partial.json",
        {
            "version": 1,
            "scenario_id": scenario_name,
            "generated_at": "",
            "cities": {},
            "audit": {},
        },
    )
    _write_json(
        scenario_dir / "capital_defaults.partial.json",
        {
            "version": 1,
            "scenario_id": scenario_name,
            "generated_at": "",
            "capitals_by_tag": {},
            "capital_city_hints": {},
            "audit": {},
        },
    )
    _write_json(
        scenario_dir / "countries.json",
        {
            "countries": {
                "AAA": {
                    "feature_count": 1,
                    "controller_feature_count": 1,
                    "entry_kind": "country",
                    "display_name": "AAA",
                }
            }
        },
    )
    _write_json(scenario_dir / "owners.by_feature.json", {"owners": {"F-1": "AAA"}})
    _write_json(scenario_dir / "controllers.by_feature.json", {"controllers": {"F-1": "AAA"}})
    _write_json(scenario_dir / "cores.by_feature.json", {"cores": {"F-1": ["AAA"]}})
    _write_json(
        scenario_dir / "audit.json",
        {
            "summary": {
                "feature_count": 1,
                "owner_count": 1,
                "controller_count": 1,
                "approximate_count": 0,
                "geometry_blocker_count": 0,
                "failed_region_check_count": 0,
                "synthetic_owner_feature_count": 0,
            }
        },
    )
    _write_json(
        expectation_path,
        {
            "scenario_id": scenario_name,
            "require_controllers": True,
            "summary_equals": {"feature_count": 1},
            "owner_set_assertions": [
                {
                    "name": "aaa owners",
                    "expected_owner_tag": "AAA",
                    "feature_ids": ["F-1"],
                }
            ],
        },
    )
    _write_text(
        report_dir / "coverage_report.md",
        "\n".join(
            [
                "Features assigned: `1`",
                "Owners present: `1`",
                "Geometry blockers: `0`",
                "Failed region checks: `0`",
                "Synthetic-owner features: `0`",
                "- `approx_existing_geometry`: `0`",
            ]
        ),
    )
    return scenario_dir, report_dir, expectation_path


class CheckHoi4ScenarioBundleTest(unittest.TestCase):
    def test_inspect_hoi4_scenario_bundle_passes_when_domain_report_and_expectation_match(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_root = Path(tmp_dir)
            scenario_dir, report_dir, expectation_path = _create_valid_hoi4_bundle(tmp_root)
            previous_project_root = check_scenario_contracts.PROJECT_ROOT
            check_scenario_contracts.PROJECT_ROOT = tmp_root
            try:
                report = inspect_hoi4_scenario_bundle(
                    scenario_dir,
                    report_dir,
                    expectation_path=expectation_path,
                )
            finally:
                check_scenario_contracts.PROJECT_ROOT = previous_project_root

            self.assertEqual(report["status"], "ok")
            self.assertEqual(report["shared_errors"], [])
            self.assertEqual(report["domain_errors"], [])

    def test_inspect_hoi4_scenario_bundle_keeps_domain_report_checks(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_root = Path(tmp_dir)
            scenario_dir, report_dir, expectation_path = _create_valid_hoi4_bundle(tmp_root)
            _write_text(
                report_dir / "coverage_report.md",
                "\n".join(
                    [
                        "Features assigned: `2`",
                        "Owners present: `1`",
                        "Geometry blockers: `0`",
                        "Failed region checks: `0`",
                        "Synthetic-owner features: `0`",
                        "- `approx_existing_geometry`: `0`",
                    ]
                ),
            )
            previous_project_root = check_scenario_contracts.PROJECT_ROOT
            check_scenario_contracts.PROJECT_ROOT = tmp_root
            try:
                report = inspect_hoi4_scenario_bundle(
                    scenario_dir,
                    report_dir,
                    expectation_path=expectation_path,
                )
            finally:
                check_scenario_contracts.PROJECT_ROOT = previous_project_root

            self.assertEqual(report["status"], "failed")
            self.assertFalse(report["shared_errors"])
            self.assertTrue(
                any("coverage_report.md feature_count must equal audit.summary.feature_count." in error for error in report["domain_errors"])
            )

    def test_inspect_hoi4_scenario_bundle_ignores_strict_bundle_only_mismatches(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_root = Path(tmp_dir)
            scenario_dir, report_dir, expectation_path = _create_valid_hoi4_bundle(tmp_root, scenario_name="hoi4_1939")
            _write_json(
                scenario_dir / "controllers.by_feature.json",
                {"controllers": {"F-1": "AAA", "F-2": "AAA"}},
            )
            _write_json(
                scenario_dir / "cores.by_feature.json",
                {"cores": {"F-1": ["AAA"], "F-2": ["AAA"]}},
            )
            previous_project_root = check_scenario_contracts.PROJECT_ROOT
            check_scenario_contracts.PROJECT_ROOT = tmp_root
            try:
                report = inspect_hoi4_scenario_bundle(
                    scenario_dir,
                    report_dir,
                    expectation_path=expectation_path,
                )
            finally:
                check_scenario_contracts.PROJECT_ROOT = previous_project_root

            self.assertEqual(report["status"], "ok")
            self.assertEqual(report["shared_errors"], [])
            self.assertEqual(report["domain_errors"], [])
