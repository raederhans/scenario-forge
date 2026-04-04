from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from tools import check_scenario_contracts
from tools.check_scenario_contracts import (
    collect_duplicate_scenario_dirs,
    discover_scenario_dirs,
    inspect_scenario_contract,
    validate_scenario_contract,
)


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _build_minimal_manifest(
    scenario_name: str,
    scenario_id: str | None = None,
    *,
    include_capital_hints_url: bool = True,
) -> dict[str, object]:
    manifest = {
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
    }
    if include_capital_hints_url:
        manifest["capital_hints_url"] = f"data/scenarios/{scenario_name}/capital_hints.json"
    return manifest


def _create_scenario_dir(
    tmp_path: Path,
    scenario_name: str,
    scenario_id: str | None = None,
    *,
    include_capital_hints_url: bool = True,
) -> Path:
    scenario_dir = tmp_path / "data" / "scenarios" / scenario_name
    manifest = _build_minimal_manifest(
        scenario_name,
        scenario_id=scenario_id,
        include_capital_hints_url=include_capital_hints_url,
    )
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
        scenario_dir / "scenario_mutations.json",
        {
            "version": 1,
            "scenario_id": scenario_id or scenario_name,
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
            "scenario_id": scenario_id or scenario_name,
            "generated_at": "",
            "cities": {},
            "audit": {},
        },
    )
    _write_json(
        scenario_dir / "capital_defaults.partial.json",
        {
            "version": 1,
            "scenario_id": scenario_id or scenario_name,
            "generated_at": "",
            "capitals_by_tag": {},
            "capital_city_hints": {},
            "audit": {},
        },
    )
    if include_capital_hints_url:
        _write_json(
            scenario_dir / "capital_hints.json",
            {
                "version": 1,
                "scenario_id": scenario_id or scenario_name,
                "entries": [],
            },
        )
    return scenario_dir


def _write_strict_bundle_files(
    scenario_dir: Path,
    *,
    owners: dict[str, str] | None = None,
    controllers: dict[str, str] | None = None,
    cores: dict[str, object] | None = None,
    runtime_feature_ids: list[str] | None = None,
    manifest_feature_count: int | None = None,
) -> None:
    owners_payload = owners if owners is not None else {"F-1": "AAA"}
    controllers_payload = controllers if controllers is not None else {"F-1": "AAA", "F-2": "AAA"}
    cores_payload = cores if cores is not None else {"F-1": ["AAA"], "F-2": ["AAA"]}
    runtime_ids = runtime_feature_ids if runtime_feature_ids is not None else ["F-1", "F-2"]

    manifest_path = scenario_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["summary"] = {
        **(manifest.get("summary") or {}),
        "feature_count": manifest_feature_count if manifest_feature_count is not None else len(owners_payload),
    }
    _write_json(manifest_path, manifest)
    _write_json(scenario_dir / "owners.by_feature.json", {"owners": owners_payload})
    _write_json(scenario_dir / "controllers.by_feature.json", {"controllers": controllers_payload})
    _write_json(scenario_dir / "cores.by_feature.json", {"cores": cores_payload})
    _write_json(
        scenario_dir / "runtime_topology.topo.json",
        {
            "type": "Topology",
            "objects": {
                "political": {
                    "type": "GeometryCollection",
                    "geometries": [
                        {
                            "type": "Polygon",
                            "properties": {"id": feature_id},
                            "arcs": [],
                        }
                        for feature_id in runtime_ids
                    ],
                }
            },
            "arcs": [],
        },
    )


class ScenarioContractTest(unittest.TestCase):
    def test_checked_in_scenario_registry_defaults_to_tno_1962(self) -> None:
        registry_path = Path(__file__).resolve().parents[1] / "data" / "scenarios" / "index.json"
        registry = json.loads(registry_path.read_text(encoding="utf-8"))

        self.assertEqual(registry.get("default_scenario_id"), "tno_1962")

    def test_checked_in_hoi4_scenarios_pass_shared_strict_review(self) -> None:
        scenarios_root = Path(__file__).resolve().parents[1] / "data" / "scenarios"
        duplicate_scenario_dirs = collect_duplicate_scenario_dirs(
            discover_scenario_dirs(scenarios_root, [])
        )

        for scenario_name in ("hoi4_1936", "hoi4_1939"):
            with self.subTest(scenario_name=scenario_name):
                report = inspect_scenario_contract(
                    scenarios_root / scenario_name,
                    duplicate_scenario_dirs,
                    strict=True,
                )

                self.assertEqual(report["status"], "ok")
                self.assertEqual(report["errors"], [])
                self.assertIsNone(report["repair_tracks"]["owners_controllers_keyset"])
                self.assertIsNone(report["repair_tracks"]["owners_cores_keyset"])
                self.assertIsNone(report["repair_tracks"]["runtime_topology_extra_ids"])

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

    def test_validate_scenario_contract_allows_tno_without_capital_hints_url(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_root = Path(tmp_dir)
            previous_project_root = check_scenario_contracts.PROJECT_ROOT
            check_scenario_contracts.PROJECT_ROOT = tmp_root
            scenario_dir = _create_scenario_dir(
                tmp_root,
                "tno_1962",
                include_capital_hints_url=False,
            )

            try:
                errors, warnings = validate_scenario_contract(scenario_dir, {})
            finally:
                check_scenario_contracts.PROJECT_ROOT = previous_project_root

            self.assertEqual(errors, [])
            self.assertEqual(warnings, [])

    def test_validate_scenario_contract_requires_capital_hints_url_for_non_tno(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_root = Path(tmp_dir)
            previous_project_root = check_scenario_contracts.PROJECT_ROOT
            check_scenario_contracts.PROJECT_ROOT = tmp_root
            scenario_dir = _create_scenario_dir(
                tmp_root,
                "example_scenario",
                include_capital_hints_url=False,
            )

            try:
                errors, warnings = validate_scenario_contract(scenario_dir, {})
            finally:
                check_scenario_contracts.PROJECT_ROOT = previous_project_root

            self.assertEqual(warnings, [])
            self.assertTrue(any("Missing: capital_hints_url" in error for error in errors))

    def test_validate_scenario_contract_requires_internal_authoring_inputs_for_tno_without_capital_hints(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_root = Path(tmp_dir)
            previous_project_root = check_scenario_contracts.PROJECT_ROOT
            check_scenario_contracts.PROJECT_ROOT = tmp_root
            scenario_dir = _create_scenario_dir(
                tmp_root,
                "tno_1962",
                include_capital_hints_url=False,
            )
            for filename in (
                "scenario_mutations.json",
                "city_assets.partial.json",
                "capital_defaults.partial.json",
            ):
                (scenario_dir / filename).unlink(missing_ok=True)

            try:
                errors, warnings = validate_scenario_contract(scenario_dir, {})
            finally:
                check_scenario_contracts.PROJECT_ROOT = previous_project_root

            self.assertEqual(warnings, [])
            self.assertTrue(any("canonical authoring inputs" in error for error in errors))

    def test_validate_scenario_contract_rejects_tno_manifest_capital_hints_url(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_root = Path(tmp_dir)
            previous_project_root = check_scenario_contracts.PROJECT_ROOT
            check_scenario_contracts.PROJECT_ROOT = tmp_root
            scenario_dir = _create_scenario_dir(
                tmp_root,
                "tno_1962",
                include_capital_hints_url=True,
            )

            try:
                errors, warnings = validate_scenario_contract(scenario_dir, {})
            finally:
                check_scenario_contracts.PROJECT_ROOT = previous_project_root

            self.assertEqual(warnings, [])
            self.assertTrue(any("must not declare manifest.capital_hints_url" in error for error in errors))

    def test_validate_scenario_contract_rejects_tno_checked_in_legacy_capital_hints(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_root = Path(tmp_dir)
            previous_project_root = check_scenario_contracts.PROJECT_ROOT
            check_scenario_contracts.PROJECT_ROOT = tmp_root
            scenario_dir = _create_scenario_dir(
                tmp_root,
                "tno_1962",
                include_capital_hints_url=False,
            )
            _write_json(
                scenario_dir / "capital_hints.json",
                {
                    "version": 1,
                    "scenario_id": "tno_1962",
                    "entries": [],
                },
            )

            try:
                errors, warnings = validate_scenario_contract(scenario_dir, {})
            finally:
                check_scenario_contracts.PROJECT_ROOT = previous_project_root

            self.assertEqual(warnings, [])
            self.assertTrue(any("must not check in legacy capital_hints.json" in error for error in errors))

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

    def test_inspect_scenario_contract_collects_geo_locale_collision_repair_track(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_root = Path(tmp_dir)
            previous_project_root = check_scenario_contracts.PROJECT_ROOT
            check_scenario_contracts.PROJECT_ROOT = tmp_root
            scenario_dir = _create_scenario_dir(tmp_root, "repair_track_warning")
            manifest_path = scenario_dir / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["geo_locale_patch_url"] = "data/scenarios/repair_track_warning/geo_locale_patch.json"
            _write_json(manifest_path, manifest)
            _write_json(
                scenario_dir / "geo_locale_patch.json",
                {
                    "version": 1,
                    "scenario_id": "repair_track_warning",
                    "geo": {},
                    "audit": {
                        "collision_candidates": [
                            {"feature_id": "FEATURE-1", "raw_name": "Pool", "reason": "non_unique_raw_name"}
                        ],
                        "collision_candidate_count": 1,
                        "cross_base_collision_count": 3,
                        "split_clone_safe_copy_count": 1,
                        "reviewed_collision_exception_count": 0,
                        "reviewed_collision_candidates": [],
                        "excluded_feature_count": 0,
                        "excluded_feature_prefixes": [],
                        "excluded_features": [],
                    },
                },
            )

            try:
                report = inspect_scenario_contract(scenario_dir, {}, strict=False)
            finally:
                check_scenario_contracts.PROJECT_ROOT = previous_project_root

            repair_tracks = report["repair_tracks"]
            geo_locale_tracks = repair_tracks["geo_locale_collision_candidates"]
            self.assertEqual(report["status"], "ok")
            self.assertEqual(report["errors"], [])
            self.assertEqual(len(geo_locale_tracks), 1)
            self.assertEqual(geo_locale_tracks[0]["cross_base_collision_count"], 3)
            self.assertEqual(geo_locale_tracks[0]["split_clone_safe_copy_count"], 1)
            self.assertEqual(geo_locale_tracks[0]["reviewed_collision_exception_count"], 0)

    def test_validate_scenario_contract_warns_when_locale_audit_counts_are_not_numeric(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_root = Path(tmp_dir)
            previous_project_root = check_scenario_contracts.PROJECT_ROOT
            check_scenario_contracts.PROJECT_ROOT = tmp_root
            scenario_dir = _create_scenario_dir(tmp_root, "warning_counts")
            manifest_path = scenario_dir / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["geo_locale_patch_url"] = "data/scenarios/warning_counts/geo_locale_patch.json"
            _write_json(manifest_path, manifest)
            _write_json(
                scenario_dir / "geo_locale_patch.json",
                {
                    "version": 1,
                    "scenario_id": "warning_counts",
                    "geo": {},
                    "audit": {
                        "collision_candidates": [
                            {
                                "feature_id": "FEATURE-1",
                                "raw_name": "Pool",
                                "reason": "non_unique_raw_name",
                            }
                        ],
                        "collision_candidate_count": "N/A",
                        "cross_base_collision_count": "unknown",
                        "split_clone_safe_copy_count": "n/a",
                    },
                },
            )

            try:
                errors, warnings = validate_scenario_contract(scenario_dir, {})
            finally:
                check_scenario_contracts.PROJECT_ROOT = previous_project_root

            self.assertEqual(errors, [])
            self.assertTrue(any("audit.collision_candidate_count must be numeric" in warning for warning in warnings))
            self.assertTrue(any("audit.cross_base_collision_count must be numeric" in warning for warning in warnings))
            self.assertTrue(any("audit.split_clone_safe_copy_count must be numeric" in warning for warning in warnings))
            self.assertTrue(any("collision candidates" in warning for warning in warnings))

    def test_validate_scenario_contract_accepts_locale_specific_patch_urls(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_root = Path(tmp_dir)
            previous_project_root = check_scenario_contracts.PROJECT_ROOT
            check_scenario_contracts.PROJECT_ROOT = tmp_root
            scenario_dir = _create_scenario_dir(tmp_root, "locale_split")
            manifest_path = scenario_dir / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["geo_locale_patch_url_en"] = "data/scenarios/locale_split/geo_locale_patch.en.json"
            manifest["geo_locale_patch_url_zh"] = "data/scenarios/locale_split/geo_locale_patch.zh.json"
            _write_json(manifest_path, manifest)
            for filename, locale_key, value in (
                ("geo_locale_patch.en.json", "en", "Alpha"),
                ("geo_locale_patch.zh.json", "zh", "阿尔法"),
            ):
                _write_json(
                    scenario_dir / filename,
                    {
                        "version": 1,
                        "scenario_id": "locale_split",
                        "geo": {
                            "FEATURE-1": {
                                locale_key: value,
                            }
                        },
                        "audit": {},
                    },
                )

            try:
                errors, warnings = validate_scenario_contract(scenario_dir, {})
            finally:
                check_scenario_contracts.PROJECT_ROOT = previous_project_root

            self.assertEqual(errors, [])
            self.assertEqual(warnings, [])

    def test_validate_scenario_contract_dedupes_locale_patch_audit_warnings_across_split_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_root = Path(tmp_dir)
            previous_project_root = check_scenario_contracts.PROJECT_ROOT
            check_scenario_contracts.PROJECT_ROOT = tmp_root
            scenario_dir = _create_scenario_dir(tmp_root, "locale_split_warning")
            manifest_path = scenario_dir / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["geo_locale_patch_url_en"] = "data/scenarios/locale_split_warning/geo_locale_patch.en.json"
            manifest["geo_locale_patch_url_zh"] = "data/scenarios/locale_split_warning/geo_locale_patch.zh.json"
            _write_json(manifest_path, manifest)
            for filename, locale_key, value in (
                ("geo_locale_patch.en.json", "en", "Pool"),
                ("geo_locale_patch.zh.json", "zh", "泳池"),
            ):
                _write_json(
                    scenario_dir / filename,
                    {
                        "version": 1,
                        "scenario_id": "locale_split_warning",
                        "geo": {
                            "FEATURE-1": {
                                locale_key: value,
                            }
                        },
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
            collision_warnings = [warning for warning in warnings if "collision candidates" in warning]
            self.assertEqual(len(collision_warnings), 1)

    def test_validate_scenario_contract_default_mode_keeps_authoring_safe_bundle_mismatches(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_root = Path(tmp_dir)
            previous_project_root = check_scenario_contracts.PROJECT_ROOT
            check_scenario_contracts.PROJECT_ROOT = tmp_root
            scenario_dir = _create_scenario_dir(tmp_root, "authoring_safe")
            _write_strict_bundle_files(
                scenario_dir,
                owners={"F-1": "AAA"},
                controllers={"F-1": "AAA"},
                cores={"F-1": ["AAA"]},
                runtime_feature_ids=["F-1"],
                manifest_feature_count=1,
            )

            try:
                errors, warnings = validate_scenario_contract(scenario_dir, {}, strict=False)
            finally:
                check_scenario_contracts.PROJECT_ROOT = previous_project_root

            self.assertEqual(errors, [])
            self.assertEqual(warnings, [])

    def test_validate_scenario_contract_strict_mode_rejects_bundle_mismatches(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_root = Path(tmp_dir)
            previous_project_root = check_scenario_contracts.PROJECT_ROOT
            check_scenario_contracts.PROJECT_ROOT = tmp_root
            scenario_dir = _create_scenario_dir(tmp_root, "strict_bundle")
            _write_strict_bundle_files(
                scenario_dir,
                owners={"F-1": "AAA"},
                controllers={"F-1": "AAA", "F-2": "AAA"},
                cores={"F-1": ["AAA"], "F-2": "AAA"},
                runtime_feature_ids=["F-1", "F-2", "BAD-1"],
                manifest_feature_count=5,
            )

            try:
                errors, warnings = validate_scenario_contract(scenario_dir, {}, strict=True)
            finally:
                check_scenario_contracts.PROJECT_ROOT = previous_project_root

            self.assertEqual(warnings, [])
            self.assertTrue(any("owners/controllers feature keysets must match" in error for error in errors))
            self.assertTrue(any("owners/cores feature keysets must match" in error for error in errors))
            self.assertTrue(any("must store arrays for every feature" in error for error in errors))
            self.assertTrue(any("feature_count must equal owners feature count" in error for error in errors))
            self.assertTrue(any("may only exceed the feature maps with shell fallback ids" in error for error in errors))

    def test_validate_scenario_contract_strict_mode_rejects_unreviewed_geo_locale_collisions(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_root = Path(tmp_dir)
            previous_project_root = check_scenario_contracts.PROJECT_ROOT
            check_scenario_contracts.PROJECT_ROOT = tmp_root
            scenario_dir = _create_scenario_dir(tmp_root, "strict_locale")
            manifest_path = scenario_dir / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["geo_locale_patch_url"] = "data/scenarios/strict_locale/geo_locale_patch.json"
            _write_json(manifest_path, manifest)
            _write_json(
                scenario_dir / "geo_locale_patch.json",
                {
                    "version": 1,
                    "scenario_id": "strict_locale",
                    "geo": {},
                    "audit": {
                        "collision_candidates": [
                            {"feature_id": "FEATURE-1", "raw_name": "Pool", "reason": "non_unique_raw_name"}
                        ],
                        "collision_candidate_count": 1,
                        "cross_base_collision_count": 1,
                        "split_clone_safe_copy_count": 0,
                        "reviewed_collision_exception_count": 0,
                    },
                },
            )
            _write_strict_bundle_files(
                scenario_dir,
                owners={"F-1": "AAA"},
                controllers={"F-1": "AAA"},
                cores={"F-1": ["AAA"]},
                runtime_feature_ids=["F-1"],
                manifest_feature_count=1,
            )

            try:
                errors, warnings = validate_scenario_contract(scenario_dir, {}, strict=True)
            finally:
                check_scenario_contracts.PROJECT_ROOT = previous_project_root

            self.assertEqual(warnings, [])
            self.assertTrue(any("unresolved locale collision candidates" in error for error in errors))

    def test_validate_scenario_contract_strict_mode_accepts_geo_locale_when_only_reviewed_exceptions_remain(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_root = Path(tmp_dir)
            previous_project_root = check_scenario_contracts.PROJECT_ROOT
            check_scenario_contracts.PROJECT_ROOT = tmp_root
            scenario_dir = _create_scenario_dir(tmp_root, "strict_locale_reviewed")
            manifest_path = scenario_dir / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["geo_locale_patch_url"] = "data/scenarios/strict_locale_reviewed/geo_locale_patch.json"
            _write_json(manifest_path, manifest)
            _write_json(
                scenario_dir / "geo_locale_patch.json",
                {
                    "version": 1,
                    "scenario_id": "strict_locale_reviewed",
                    "geo": {},
                    "audit": {
                        "collision_candidates": [],
                        "collision_candidate_count": 0,
                        "cross_base_collision_count": 0,
                        "split_clone_safe_copy_count": 0,
                        "reviewed_collision_exception_count": 1,
                        "reviewed_collision_candidates": [
                            {"feature_id": "FEATURE-1", "raw_name": "Pool", "reason": "non_unique_raw_name"}
                        ],
                    },
                },
            )
            _write_strict_bundle_files(
                scenario_dir,
                owners={"F-1": "AAA"},
                controllers={"F-1": "AAA"},
                cores={"F-1": ["AAA"]},
                runtime_feature_ids=["F-1"],
                manifest_feature_count=1,
            )

            try:
                errors, warnings = validate_scenario_contract(scenario_dir, {}, strict=True)
            finally:
                check_scenario_contracts.PROJECT_ROOT = previous_project_root

            self.assertEqual(errors, [])
            self.assertEqual(warnings, [])

    def test_validate_scenario_contract_strict_mode_rejects_reviewed_exception_count_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_root = Path(tmp_dir)
            previous_project_root = check_scenario_contracts.PROJECT_ROOT
            check_scenario_contracts.PROJECT_ROOT = tmp_root
            scenario_dir = _create_scenario_dir(tmp_root, "strict_locale_reviewed_mismatch")
            manifest_path = scenario_dir / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["geo_locale_patch_url"] = "data/scenarios/strict_locale_reviewed_mismatch/geo_locale_patch.json"
            _write_json(manifest_path, manifest)
            _write_json(
                scenario_dir / "geo_locale_patch.json",
                {
                    "version": 1,
                    "scenario_id": "strict_locale_reviewed_mismatch",
                    "geo": {},
                    "audit": {
                        "collision_candidates": [],
                        "collision_candidate_count": 0,
                        "cross_base_collision_count": 0,
                        "split_clone_safe_copy_count": 0,
                        "reviewed_collision_exception_count": 2,
                        "reviewed_collision_candidates": [
                            {"feature_id": "FEATURE-1", "raw_name": "Pool", "reason": "non_unique_raw_name"}
                        ],
                    },
                },
            )
            _write_strict_bundle_files(
                scenario_dir,
                owners={"F-1": "AAA"},
                controllers={"F-1": "AAA"},
                cores={"F-1": ["AAA"]},
                runtime_feature_ids=["F-1"],
                manifest_feature_count=1,
            )

            try:
                errors, warnings = validate_scenario_contract(scenario_dir, {}, strict=True)
            finally:
                check_scenario_contracts.PROJECT_ROOT = previous_project_root

            self.assertEqual(warnings, [])
            self.assertTrue(
                any("reviewed_collision_exception_count must equal the reviewed_collision_candidates list length" in error for error in errors)
            )

    def test_validate_scenario_contract_strict_mode_rejects_excluded_feature_prefix_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_root = Path(tmp_dir)
            previous_project_root = check_scenario_contracts.PROJECT_ROOT
            check_scenario_contracts.PROJECT_ROOT = tmp_root
            scenario_dir = _create_scenario_dir(tmp_root, "strict_locale_excluded_mismatch")
            manifest_path = scenario_dir / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["geo_locale_patch_url"] = "data/scenarios/strict_locale_excluded_mismatch/geo_locale_patch.json"
            _write_json(manifest_path, manifest)
            _write_json(
                scenario_dir / "geo_locale_patch.json",
                {
                    "version": 1,
                    "scenario_id": "strict_locale_excluded_mismatch",
                    "geo": {},
                    "audit": {
                        "collision_candidates": [],
                        "collision_candidate_count": 0,
                        "cross_base_collision_count": 0,
                        "split_clone_safe_copy_count": 0,
                        "reviewed_collision_exception_count": 0,
                        "excluded_feature_count": 1,
                        "excluded_feature_prefixes": ["ATLSEA_FILL_"],
                        "excluded_features": [
                            {"feature_id": "FEATURE-1", "raw_name": "Pool", "reason": "synthetic"}
                        ],
                    },
                },
            )
            _write_strict_bundle_files(
                scenario_dir,
                owners={"F-1": "AAA"},
                controllers={"F-1": "AAA"},
                cores={"F-1": ["AAA"]},
                runtime_feature_ids=["F-1"],
                manifest_feature_count=1,
            )

            try:
                errors, warnings = validate_scenario_contract(scenario_dir, {}, strict=True)
            finally:
                check_scenario_contracts.PROJECT_ROOT = previous_project_root

            self.assertEqual(warnings, [])
            self.assertTrue(
                any("excluded_features may only include ids that match excluded_feature_prefixes" in error for error in errors)
            )

    def test_inspect_scenario_contract_strict_mode_collects_repair_tracks(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_root = Path(tmp_dir)
            previous_project_root = check_scenario_contracts.PROJECT_ROOT
            check_scenario_contracts.PROJECT_ROOT = tmp_root
            scenario_dir = _create_scenario_dir(tmp_root, "strict_repair_tracks")
            _write_strict_bundle_files(
                scenario_dir,
                owners={"F-1": "AAA"},
                controllers={"F-1": "AAA", "F-2": "AAA"},
                cores={"F-1": ["AAA"], "F-3": ["AAA"]},
                runtime_feature_ids=["F-1", "F-2", "BAD-1"],
                manifest_feature_count=1,
            )

            try:
                report = inspect_scenario_contract(scenario_dir, {}, strict=True)
            finally:
                check_scenario_contracts.PROJECT_ROOT = previous_project_root

            repair_tracks = report["repair_tracks"]
            self.assertEqual(report["status"], "failed")
            self.assertEqual(repair_tracks["owners_controllers_keyset"]["controller_only_count"], 1)
            self.assertEqual(repair_tracks["owners_cores_keyset"]["core_only_count"], 1)
            self.assertEqual(repair_tracks["runtime_topology_extra_ids"]["extra_runtime_id_count"], 2)


if __name__ == "__main__":
    unittest.main()
