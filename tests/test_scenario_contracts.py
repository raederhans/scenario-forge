from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from tools import check_scenario_contracts
from tools.check_scenario_contracts import validate_scenario_contract


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _build_minimal_manifest(scenario_name: str, scenario_id: str | None = None) -> dict[str, object]:
    return {
        "version": 2,
        "scenario_id": scenario_id or scenario_name,
        "display_name": scenario_name,
        "bookmark_name": scenario_name,
        "bookmark_description": f"{scenario_name} description",
        "bookmark_date": "2000.1.1.12",
        "default_country": "AAA",
        "featured_tags": ["AAA"],
        "palette_id": "test",
        "baseline_hash": "abc123",
        "countries_url": f"data/scenarios/{scenario_name}/countries.json",
        "owners_url": f"data/scenarios/{scenario_name}/owners.by_feature.json",
        "controllers_url": f"data/scenarios/{scenario_name}/controllers.by_feature.json",
        "cores_url": f"data/scenarios/{scenario_name}/cores.by_feature.json",
        "audit_url": f"data/scenarios/{scenario_name}/audit.json",
        "summary": {"feature_count": 1},
        "generated_at": "2026-03-16T00:00:00Z",
        "performance_hints": {"render_profile_default": "balanced"},
        "style_defaults": {"ocean": {"fillColor": "#123456"}},
        "city_overrides_url": f"data/scenarios/{scenario_name}/city_overrides.json",
        "capital_hints_url": f"data/scenarios/{scenario_name}/capital_hints.json",
    }


def _create_scenario_dir(tmp_path: Path, scenario_name: str, scenario_id: str | None = None) -> Path:
    scenario_dir = tmp_path / "data" / "scenarios" / scenario_name
    manifest = _build_minimal_manifest(scenario_name, scenario_id=scenario_id)
    _write_json(scenario_dir / "manifest.json", manifest)
    _write_json(
        scenario_dir / "city_overrides.json",
        {
            "version": 1,
            "scenario_id": scenario_id or scenario_name,
            "capitals_by_tag": {"AAA": "CITY::capital"},
            "capital_city_hints": {},
        },
    )
    _write_json(
        scenario_dir / "capital_hints.json",
        {
            "version": 1,
            "scenario_id": scenario_id or scenario_name,
            "entries": [],
        },
    )
    return scenario_dir


class ScenarioContractTest(unittest.TestCase):
    def test_validate_scenario_contract_rejects_manifest_scenario_id_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_root = Path(tmp_dir)
            previous_project_root = check_scenario_contracts.PROJECT_ROOT
            check_scenario_contracts.PROJECT_ROOT = tmp_root
            scenario_dir = _create_scenario_dir(tmp_root, "example_scenario", scenario_id="wrong_id")

            try:
                errors, warnings = validate_scenario_contract(scenario_dir, {})
            finally:
                check_scenario_contracts.PROJECT_ROOT = previous_project_root

            self.assertEqual(warnings, [])
            self.assertTrue(
                any(
                    "manifest.scenario_id must equal scenario directory name `example_scenario`" in error
                    for error in errors
                )
            )

    def test_validate_scenario_contract_keeps_locale_collisions_as_warnings(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_root = Path(tmp_dir)
            previous_project_root = check_scenario_contracts.PROJECT_ROOT
            check_scenario_contracts.PROJECT_ROOT = tmp_root
            scenario_dir = _create_scenario_dir(tmp_root, "warning_scenario")
            manifest_path = scenario_dir / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["geo_locale_patch_url"] = "data/scenarios/warning_scenario/geo_locale_patch.json"
            _write_json(manifest_path, manifest)
            _write_json(
                scenario_dir / "geo_locale_patch.json",
                {
                    "version": 1,
                    "scenario_id": "warning_scenario",
                    "geo": {},
                    "audit": {
                        "collision_candidates": [
                            {
                                "feature_id": "FEATURE-1",
                                "raw_name": "Pool",
                                "reason": "non_unique_raw_name",
                            }
                        ]
                    },
                },
            )

            try:
                errors, warnings = validate_scenario_contract(scenario_dir, {})
            finally:
                check_scenario_contracts.PROJECT_ROOT = previous_project_root

            self.assertEqual(errors, [])
            self.assertTrue(any("collision candidates" in warning for warning in warnings))


if __name__ == "__main__":
    unittest.main()
