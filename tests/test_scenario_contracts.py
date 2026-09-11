from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from unittest import mock

from tools import check_scenario_contracts
from map_builder.contracts import (
    SCENARIO_PUBLISH_SCOPE_SCENARIO_DATA,
    SCENARIO_STRATEGIC_VALUES_FILENAME,
    resolve_scenario_publish_filenames,
)
from tools.check_scenario_contracts import (
    collect_duplicate_scenario_dirs,
    discover_scenario_dirs,
    inspect_scenario_contract,
    validate_scenario_contract,
)


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")


def _sha256_path(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


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
        "cores_url": f"data/scenarios/{scenario_name}/cores.by_feature.json",
        "audit_url": f"data/scenarios/{scenario_name}/audit.json",
        "summary": {"feature_count": 1},
        "generated_at": "2026-03-16T00:00:00Z",
        "performance_hints": {"render_profile_default": "balanced"},
        "style_defaults": {"ocean": {"fillColor": "#123456"}},
        "city_overrides_url": f"data/scenarios/{scenario_name}/city_overrides.json",
        "special_zone_layers_url": f"data/scenarios/{scenario_name}/special_zone_layers.json",
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
        scenario_dir / "special_zone_layers.json",
        {
            "version": 1,
            "layers": [],
            "activeLayerId": "",
            "topologyFingerprint": "",
            "diagnostics": [],
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
    # fixture 要按真实 strict 链路写 manifest source、snapshot 和 audit，避免测试只验证孤立 JSON 字段。
    project_root = scenario_dir.parents[2]
    base_topology_path = project_root / "data" / "europe_topology.json"
    if not base_topology_path.exists():
        _write_json(
            base_topology_path,
            {
                "type": "Topology",
                "objects": {},
                "arcs": [],
            },
        )

    manifest_path = scenario_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    _write_json(scenario_dir / "owners.by_feature.json", {"owners": owners_payload})
    _write_json(scenario_dir / "controllers.by_feature.json", {"controllers": controllers_payload})
    _write_json(scenario_dir / "cores.by_feature.json", {"cores": cores_payload})
    runtime_topology_path = scenario_dir / "runtime_topology.topo.json"
    _write_json(
        runtime_topology_path,
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
    manifest["summary"] = {
        **(manifest.get("summary") or {}),
        "feature_count": manifest_feature_count if manifest_feature_count is not None else len(owners_payload),
    }
    runtime_topology_sha = _sha256_path(runtime_topology_path)
    manifest["source"] = {
        **(manifest.get("source") or {}),
        "base_topology_sha256": _sha256_path(base_topology_path),
        "runtime_topology_sha256": runtime_topology_sha,
    }
    _write_json(manifest_path, manifest)
    snapshot_payload = check_scenario_contracts._build_snapshot_for_scenario(scenario_dir, manifest)
    manifest["snapshot_fingerprint"] = snapshot_payload["snapshot_fingerprint"]
    _write_json(manifest_path, manifest)
    check_scenario_contracts._refresh_audit_payload(
        scenario_dir,
        manifest,
        snapshot_payload=snapshot_payload,
    )


class ScenarioContractTest(unittest.TestCase):
    def test_scenario_publish_scope_includes_strategic_values_asset(self) -> None:
        self.assertIn(
            SCENARIO_STRATEGIC_VALUES_FILENAME,
            resolve_scenario_publish_filenames(SCENARIO_PUBLISH_SCOPE_SCENARIO_DATA),
        )

    def test_checked_in_scenario_registry_defaults_to_tno_1962(self) -> None:
        registry_path = Path(__file__).resolve().parents[1] / "data" / "scenarios" / "index.json"
        registry = json.loads(registry_path.read_text(encoding="utf-8"))

        self.assertEqual(registry.get("default_scenario_id"), "tno_1962")

    def test_hgo_scenarios_use_vector_contract_profile(self) -> None:
        profile = check_scenario_contracts.resolve_scenario_contract_profile("hgo_1936")

        self.assertEqual(profile.profile_id, "hgo_vector")
        self.assertTrue(profile.expect_runtime_topology)
        self.assertFalse(profile.expect_chunk_assets)
        self.assertFalse(profile.expect_startup_assets)

    def test_checked_in_hgo_scene_uses_vector_topology_not_runtime_bmp(self) -> None:
        manifest_path = Path(__file__).resolve().parents[1] / "data" / "scenarios" / "hgo_1936" / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest_urls = {
            key: str(value)
            for key, value in manifest.items()
            if key.endswith("_url")
        }

        self.assertEqual(
            manifest_urls["runtime_topology_url"],
            "data/scenarios/hgo_1936/runtime_topology.topo.json",
        )
        self.assertTrue(manifest["source"]["hgo_provinces_bmp_sha256"])
        self.assertTrue(all("hgo_runtime/provinces.bmp" not in value for value in manifest_urls.values()))
        self.assertTrue(all(not value.lower().endswith(".bmp") for value in manifest_urls.values()))

    def test_checked_in_tno_coverage_ledgers_expose_strict_machine_fields(self) -> None:
        scenario_dir = Path(__file__).resolve().parents[1] / "data" / "scenarios" / "tno_1962"
        ledger_path = scenario_dir / "derived" / "atlantropa_donor_ledger.json"
        drop_audit_path = scenario_dir / "derived" / "geometry_drop_audit.json"
        runtime_meta = json.loads((scenario_dir / "runtime_meta.json").read_text(encoding="utf-8"))
        ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
        drop_audit = json.loads(drop_audit_path.read_text(encoding="utf-8"))
        expected_ledger_paths = {
            "atlantropa_donor_ledger": "data/scenarios/tno_1962/derived/atlantropa_donor_ledger.json",
            "geometry_drop_audit": "data/scenarios/tno_1962/derived/geometry_drop_audit.json",
        }
        expected_report_paths = dict(check_scenario_contracts.TNO_COVERAGE_REPORT_PATHS)

        self.assertEqual(ledger["scenario_id"], "tno_1962")
        self.assertGreater(ledger["summary"]["runtime_feature_count"], 800)
        self.assertEqual(ledger["summary"]["missing_chunk_count"], 0)
        self.assertEqual(ledger["summary"]["basin_probe_failure_count"], 0)
        self.assertEqual(drop_audit["summary"]["protected_prefix_drop_count"], 0)
        self.assertEqual(drop_audit["summary"]["polar_feature_count"], 1)
        self.assertEqual(drop_audit["polar_gate_ref"], "verify:tno-polar-coverage")
        self.assertEqual(runtime_meta["coverage_ledger_paths"], expected_ledger_paths)
        self.assertEqual(runtime_meta["coverage_report_paths"], expected_report_paths)
        self.assertEqual(
            runtime_meta["coverage_ledger_hashes"]["atlantropa_donor_ledger"],
            _sha256_path(ledger_path),
        )
        self.assertEqual(
            runtime_meta["coverage_ledger_hashes"]["geometry_drop_audit"],
            _sha256_path(drop_audit_path),
        )
        required_probe_ids = {
            "ionian_mediterranean",
            "libya_suez_chain",
            "suez_canal_site",
            "malta_rebuilt_island",
            "cretan_mediterranean",
        }
        self.assertEqual({probe["id"] for probe in ledger["basin_probes"]}, required_probe_ids)

        report = inspect_scenario_contract(scenario_dir, {}, strict=True)

        self.assertEqual(report["errors"], [])
        self.assertTrue(report["coverage_ledger_ok"])
        self.assertEqual(report["protected_prefix_drop_count"], 0)
        self.assertEqual(report["basin_probe_failures"], [])
        self.assertEqual(report["polar_spherical_failures"], [])
        self.assertEqual(report["polar_feature_count"], 1)
        self.assertEqual(report["polar_gate_ref"], "verify:tno-polar-coverage")

    def test_atlantropa_basin_probes_require_real_geometry_intersection(self) -> None:
        disjoint_multipolygon_with_crossing_bbox = {
            "type": "MultiPolygon",
            "coordinates": [
                [
                    [
                        [18.5, 35.0],
                        [18.8, 35.0],
                        [18.8, 35.3],
                        [18.5, 35.3],
                        [18.5, 35.0],
                    ],
                ],
                [
                    [
                        [22.7, 35.0],
                        [23.0, 35.0],
                        [23.0, 35.3],
                        [22.7, 35.3],
                        [22.7, 35.0],
                    ],
                ],
            ],
        }
        rows = check_scenario_contracts._build_basin_probe_rows(
            [
                {
                    "feature_id": "ATLSEA_TEST_BBOX_ONLY",
                    "prefix": "ATLSEA_",
                    "bbox": [18.5, 35.0, 23.0, 35.3],
                    "chunk_present": True,
                    "_probe_geometry": disjoint_multipolygon_with_crossing_bbox,
                }
            ]
        )
        ionian_probe = next(row for row in rows if row["id"] == "ionian_mediterranean")

        self.assertEqual(ionian_probe["bbox_candidate_count"], 1)
        self.assertEqual(ionian_probe["match_count"], 0)
        self.assertEqual(ionian_probe["matching_feature_ids"], [])
        self.assertEqual(ionian_probe["failure_reasons"], ["no_matching_atlantropa_feature_geometry"])
        self.assertFalse(ionian_probe["ok"])

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

    def test_checked_in_blank_base_is_ownerless_editable_topology(self) -> None:
        scenario_dir = Path(__file__).resolve().parents[1] / "data" / "scenarios" / "blank_base"
        runtime_topology = json.loads((scenario_dir / "runtime_topology.topo.json").read_text(encoding="utf-8"))
        manifest = json.loads((scenario_dir / "manifest.json").read_text(encoding="utf-8"))
        owners = json.loads((scenario_dir / "owners.by_feature.json").read_text(encoding="utf-8"))
        cores = json.loads((scenario_dir / "cores.by_feature.json").read_text(encoding="utf-8"))
        countries = json.loads((scenario_dir / "countries.json").read_text(encoding="utf-8"))

        geometries = runtime_topology["objects"]["political"]["geometries"]
        self.assertGreater(len(geometries), 0)
        self.assertEqual(manifest["summary"]["feature_count"], len(geometries))
        self.assertEqual(manifest["summary"]["owner_count"], 0)
        self.assertEqual(manifest["style_defaults"]["empireBorders"]["opacity"], 0.4)
        self.assertEqual(manifest["style_defaults"]["coastlines"]["width"], 0.8)
        self.assertEqual(owners.get("owners"), {})
        self.assertEqual(cores.get("cores"), {})

        forbidden_property_names = {
            "cntr_code",
            "country_code",
            "owner",
            "controller",
            "core",
            "cores",
            "scenario_owner",
            "scenario_controller",
            "color",
            "color_hex",
            "admin1_group",
            "legacy_name",
            "anchor_county_name",
        }
        for index, geometry in enumerate(geometries[:200]):
            props = geometry.get("properties") or {}
            self.assertTrue(str(props.get("id") or "").strip(), index)
            self.assertFalse(forbidden_property_names & set(props), props)

        for tag, entry in countries.get("countries", {}).items():
            self.assertEqual(entry.get("feature_count"), 0, tag)
            self.assertEqual(entry.get("controller_feature_count"), 0, tag)

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

    def test_validate_scenario_contract_rejects_tno_city_overrides_unknown_country_tags(self) -> None:
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
                scenario_dir / "countries.json",
                {
                    "version": 1,
                    "scenario_id": "tno_1962",
                    "countries": {"AAA": {"tag": "AAA"}},
                },
            )
            _write_json(
                scenario_dir / "city_overrides.json",
                {
                    "version": 1,
                    "scenario_id": "tno_1962",
                    "capitals_by_tag": {
                        "AAA": "CITY::capital",
                        "ZZZ": "CITY::unknown",
                    },
                    "capital_city_hints": {
                        "QQQ": {"tag": "AAA"},
                        "AAA": {"tag": "RRR"},
                    },
                },
            )

            try:
                errors, warnings = validate_scenario_contract(scenario_dir, {})
            finally:
                check_scenario_contracts.PROJECT_ROOT = previous_project_root

            self.assertEqual(warnings, [])
            self.assertTrue(
                any(
                    "city_overrides.json capitals_by_tag has tags missing from countries.json" in error
                    for error in errors
                )
            )
            self.assertTrue(
                any(
                    "city_overrides.json capital_city_hints has tags missing from countries.json" in error
                    for error in errors
                )
            )
            self.assertTrue(
                any(
                    "city_overrides.json capital_city_hints entries must tag registered countries" in error
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
            self.assertTrue(any("owners/cores feature keysets must match" in error for error in errors))
            self.assertTrue(any("must store arrays for every feature" in error for error in errors))
            self.assertTrue(any("feature_count must equal owners feature count" in error for error in errors))
            self.assertTrue(any("may only exceed the feature maps with shell fallback ids" in error for error in errors))

    def test_validate_scenario_contract_strict_mode_rejects_runtime_object_count_drift(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_root = Path(tmp_dir)
            previous_project_root = check_scenario_contracts.PROJECT_ROOT
            check_scenario_contracts.PROJECT_ROOT = tmp_root
            scenario_dir = _create_scenario_dir(tmp_root, "strict_runtime_count")
            _write_strict_bundle_files(
                scenario_dir,
                owners={"F-1": "AAA"},
                controllers={"F-1": "AAA"},
                cores={"F-1": ["AAA"]},
                runtime_feature_ids=["F-1"],
                manifest_feature_count=1,
            )
            manifest_path = scenario_dir / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["summary"]["scenario_runtime_topology_object_count"] = 5
            _write_json(manifest_path, manifest)
            _write_json(
                scenario_dir / "runtime_meta.json",
                {
                    "runtime_topology_object_names": ["political", "ghost"],
                    "runtime_topology_object_count": 2,
                },
            )

            try:
                errors, warnings = validate_scenario_contract(scenario_dir, {}, strict=True)
            finally:
                check_scenario_contracts.PROJECT_ROOT = previous_project_root

            self.assertEqual(warnings, [])
            self.assertTrue(any("scenario_runtime_topology_object_count must equal" in error for error in errors), errors)
            self.assertTrue(any("runtime_meta.json runtime_topology_object_count must equal" in error for error in errors), errors)

    def test_validate_scenario_contract_strict_mode_rejects_partial_strategic_feature_coverage(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_root = Path(tmp_dir)
            previous_project_root = check_scenario_contracts.PROJECT_ROOT
            check_scenario_contracts.PROJECT_ROOT = tmp_root
            scenario_dir = _create_scenario_dir(tmp_root, "hoi4_partial_strategic")
            _write_strict_bundle_files(
                scenario_dir,
                owners={"F-1": "AAA", "F-2": "AAA"},
                controllers={"F-1": "AAA", "F-2": "AAA"},
                cores={"F-1": ["AAA"], "F-2": ["AAA"]},
                runtime_feature_ids=["F-1", "F-2"],
                manifest_feature_count=2,
            )
            manifest_path = scenario_dir / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["strategic_values_url"] = (
                "data/scenarios/hoi4_partial_strategic/strategic_values.by_feature.json"
            )
            _write_json(
                scenario_dir / "strategic_values.by_feature.json",
                {
                    "version": 1,
                    "scenario_id": "hoi4_partial_strategic",
                    "baseline_hash": manifest["baseline_hash"],
                    "metrics": {"steel": {"kind": "additive", "min": 0, "max": 1, "p95": 1}},
                    "buckets": {"s1": {"steel": 1}},
                    "bucket_by_feature": {"F-1": "s1"},
                    "resource_points": {"type": "FeatureCollection", "features": []},
                },
            )
            snapshot_payload = check_scenario_contracts._build_snapshot_for_scenario(scenario_dir, manifest)
            manifest["snapshot_fingerprint"] = snapshot_payload["snapshot_fingerprint"]
            _write_json(manifest_path, manifest)
            check_scenario_contracts._refresh_audit_payload(
                scenario_dir,
                manifest,
                snapshot_payload=snapshot_payload,
            )

            try:
                errors, warnings = validate_scenario_contract(scenario_dir, {}, strict=True)
            finally:
                check_scenario_contracts.PROJECT_ROOT = previous_project_root

            self.assertEqual(warnings, [])
            self.assertTrue(
                any("strategic_values.by_feature.json bucket_by_feature must cover owner features" in error for error in errors),
                errors,
            )

    def test_atlantropa_publish_mirror_must_match_runtime_object_ids(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_root = Path(tmp_dir)
            previous_project_root = check_scenario_contracts.PROJECT_ROOT
            check_scenario_contracts.PROJECT_ROOT = tmp_root
            scenario_dir = _create_scenario_dir(tmp_root, "tno_1962")
            topology_path = scenario_dir / "scenario_atlantropa.topo.json"
            _write_json(
                topology_path,
                {
                    "type": "Topology",
                    "objects": {
                        "scenario_atlantropa": {
                            "type": "GeometryCollection",
                            "geometries": [
                                {"type": "Polygon", "properties": {"id": "ATLSEA_MISSING"}, "arcs": []}
                            ],
                        }
                    },
                    "arcs": [],
                },
            )
            manifest = {
                "scenario_atlantropa_topology_url": "data/scenarios/tno_1962/scenario_atlantropa.topo.json",
                "summary": {"scenario_atlantropa_feature_count": 1},
            }
            errors: list[str] = []

            try:
                check_scenario_contracts._validate_atlantropa_publish_mirror(
                    scenario_dir,
                    manifest,
                    manifest["summary"],
                    {"ATLSEA_1"},
                    errors,
                )
            finally:
                check_scenario_contracts.PROJECT_ROOT = previous_project_root

            self.assertTrue(any("must mirror runtime_topology" in error for error in errors), errors)

    def test_validate_scenario_contract_strict_mode_rejects_unrenderable_bootstrap_shell(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_root = Path(tmp_dir)
            previous_project_root = check_scenario_contracts.PROJECT_ROOT
            check_scenario_contracts.PROJECT_ROOT = tmp_root
            scenario_dir = _create_scenario_dir(tmp_root, "strict_shell")
            _write_strict_bundle_files(
                scenario_dir,
                owners={"F-1": "AAA"},
                controllers={"F-1": "AAA"},
                cores={"F-1": ["AAA"]},
                runtime_feature_ids=["F-1"],
                manifest_feature_count=1,
            )
            shell_path = scenario_dir / "runtime_topology.bootstrap.topo.json"
            _write_json(
                shell_path,
                {
                    "type": "Topology",
                    "objects": {
                        "land_mask": {"type": "GeometryCollection", "geometries": []},
                        "context_land_mask": {"type": "GeometryCollection", "geometries": []},
                        "scenario_water": {"type": "GeometryCollection", "geometries": []},
                    },
                    "arcs": [],
                },
            )
            manifest_path = scenario_dir / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["runtime_bootstrap_topology_url"] = "data/scenarios/strict_shell/runtime_topology.bootstrap.topo.json"
            manifest["startup_topology_url"] = "data/scenarios/strict_shell/runtime_topology.bootstrap.topo.json"
            manifest["source"]["runtime_bootstrap_topology_sha256"] = _sha256_path(shell_path)
            _write_json(manifest_path, manifest)

            try:
                errors, warnings = validate_scenario_contract(scenario_dir, {}, strict=True)
            finally:
                check_scenario_contracts.PROJECT_ROOT = previous_project_root

            self.assertEqual(warnings, [])
            self.assertTrue(
                any("must contain non-empty objects.political.geometries" in error for error in errors)
            )

    def test_validate_scenario_contract_strict_mode_rejects_base_topology_sha_drift(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_root = Path(tmp_dir)
            previous_project_root = check_scenario_contracts.PROJECT_ROOT
            check_scenario_contracts.PROJECT_ROOT = tmp_root
            scenario_dir = _create_scenario_dir(tmp_root, "strict_source")
            _write_strict_bundle_files(scenario_dir)
            manifest_path = scenario_dir / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["source"]["base_topology_sha256"] = "0" * 64
            _write_json(manifest_path, manifest)

            try:
                errors, warnings = validate_scenario_contract(scenario_dir, {}, strict=True)
            finally:
                check_scenario_contracts.PROJECT_ROOT = previous_project_root

            self.assertEqual(warnings, [])
            self.assertTrue(
                any("manifest.source.base_topology_sha256 must match" in error for error in errors)
            )

    def test_validate_scenario_contract_strict_mode_rejects_hgo_source_sha_drift(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_root = Path(tmp_dir)
            previous_project_root = check_scenario_contracts.PROJECT_ROOT
            check_scenario_contracts.PROJECT_ROOT = tmp_root
            hgo_source_dir = tmp_root / "data" / "hgo_runtime"
            seed_path = hgo_source_dir / "seed.json"
            provinces_bmp_path = hgo_source_dir / "provinces.bmp"
            seed_path.parent.mkdir(parents=True)
            seed_path.write_text('{"seed":1}', encoding="utf-8")
            provinces_bmp_path.write_bytes(b"bmp-v1")
            scenario_dir = _create_scenario_dir(tmp_root, "hgo_1936")
            _write_strict_bundle_files(scenario_dir)
            manifest_path = scenario_dir / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["source"] = {
                **manifest["source"],
                "hgo_seed_sha256": _sha256_path(seed_path),
                "hgo_provinces_bmp_sha256": _sha256_path(provinces_bmp_path),
            }
            snapshot_payload = check_scenario_contracts._build_snapshot_for_scenario(scenario_dir, manifest)
            manifest["snapshot_fingerprint"] = snapshot_payload["snapshot_fingerprint"]
            _write_json(manifest_path, manifest)
            check_scenario_contracts._refresh_audit_payload(
                scenario_dir,
                manifest,
                snapshot_payload=snapshot_payload,
            )
            seed_path.write_text('{"seed":2}', encoding="utf-8")

            try:
                errors, warnings = validate_scenario_contract(scenario_dir, {}, strict=True)
            finally:
                check_scenario_contracts.PROJECT_ROOT = previous_project_root

            self.assertEqual(warnings, [])
            self.assertTrue(
                any("manifest.source.hgo_seed_sha256 must match" in error for error in errors),
                errors,
            )

    def test_capture_safe_repair_hashes_tracks_startup_bundle_gzip_sidecars(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir = Path(tmp_dir) / "data" / "scenarios" / "hash_capture"
            scenario_dir.mkdir(parents=True, exist_ok=True)
            for filename in (
                "startup.bundle.en.json.gz",
                "startup.bundle.zh.json.gz",
            ):
                (scenario_dir / filename).write_bytes(b"gzip-sidecar")

            hashes = check_scenario_contracts._capture_safe_repair_hashes(scenario_dir)

            self.assertIn("startup.bundle.en.json.gz", hashes)
            self.assertIn("startup.bundle.zh.json.gz", hashes)

    def test_contract_hash_normalizes_crlf_for_text_scenario_assets(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_root = Path(tmp_dir)
            lf_payload = b'{\n  "type": "FeatureCollection",\n  "features": []\n}\n'
            for filename in ("manifest.json", "water_regions.geojson", "runtime_topology.topo.json"):
                lf_path = tmp_root / f"lf-{filename}"
                crlf_path = tmp_root / f"crlf-{filename}"
                lf_path.write_bytes(lf_payload)
                crlf_path.write_bytes(lf_payload.replace(b"\n", b"\r\n"))

                self.assertEqual(
                    check_scenario_contracts._sha256_path(crlf_path),
                    check_scenario_contracts._sha256_path(lf_path),
                )
                self.assertEqual(
                    check_scenario_contracts._sha256_path(crlf_path),
                    hashlib.sha256(lf_payload).hexdigest(),
                )

    def test_contract_hash_normalizes_crlf_across_read_chunk_boundary(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "water_regions.geojson"
            chunk_edge_prefix = b"a" * (1024 * 1024 - 1)
            path.write_bytes(chunk_edge_prefix + b"\r\n")

            self.assertEqual(
                check_scenario_contracts._sha256_path(path),
                hashlib.sha256(chunk_edge_prefix + b"\n").hexdigest(),
            )

    def test_contract_hash_keeps_gzip_sidecars_byte_exact(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_root = Path(tmp_dir)
            lf_path = tmp_root / "startup.bundle.en.json.gz"
            crlf_path = tmp_root / "startup.bundle.zh.json.gz"
            lf_path.write_bytes(b"gzip\nsidecar\n")
            crlf_path.write_bytes(b"gzip\r\nsidecar\r\n")

            self.assertNotEqual(
                check_scenario_contracts._sha256_path(crlf_path),
                check_scenario_contracts._sha256_path(lf_path),
            )
            self.assertEqual(
                check_scenario_contracts._sha256_path(crlf_path),
                hashlib.sha256(b"gzip\r\nsidecar\r\n").hexdigest(),
            )

    def test_build_snapshot_fingerprint_changes_when_water_regions_payload_drifts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_root = Path(tmp_dir)
            previous_project_root = check_scenario_contracts.PROJECT_ROOT
            check_scenario_contracts.PROJECT_ROOT = tmp_root
            scenario_dir = _create_scenario_dir(tmp_root, "snapshot_water")
            _write_strict_bundle_files(scenario_dir)
            water_regions_path = scenario_dir / "water_regions.geojson"
            _write_json(
                water_regions_path,
                {
                    "type": "FeatureCollection",
                    "features": [
                        {
                            "type": "Feature",
                            "properties": {"id": "WATER-1", "name": "Alpha Sea"},
                            "geometry": {
                                "type": "Polygon",
                                "coordinates": [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
                            },
                        }
                    ],
                },
            )
            manifest_path = scenario_dir / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

            try:
                first_snapshot = check_scenario_contracts._build_snapshot_for_scenario(scenario_dir, manifest)
                _write_json(
                    water_regions_path,
                    {
                        "type": "FeatureCollection",
                        "features": [
                            {
                                "type": "Feature",
                                "properties": {"id": "WATER-1", "name": "Beta Sea"},
                                "geometry": {
                                    "type": "Polygon",
                                    "coordinates": [[[0, 0], [3, 0], [3, 1], [0, 1], [0, 0]]],
                                },
                            }
                        ],
                    },
                )
                second_snapshot = check_scenario_contracts._build_snapshot_for_scenario(scenario_dir, manifest)
            finally:
                check_scenario_contracts.PROJECT_ROOT = previous_project_root

            self.assertEqual(first_snapshot["water_count"], 1)
            self.assertEqual(second_snapshot["water_count"], 1)
            self.assertNotEqual(
                first_snapshot["snapshot_fingerprint"],
                second_snapshot["snapshot_fingerprint"],
            )

    def test_collect_snapshot_inputs_includes_chunk_source_layer_urls(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_root = Path(tmp_dir)
            previous_project_root = check_scenario_contracts.PROJECT_ROOT
            check_scenario_contracts.PROJECT_ROOT = tmp_root
            scenario_dir = _create_scenario_dir(tmp_root, "snapshot_layers")
            _write_json(scenario_dir / "special_regions.geojson", {"type": "FeatureCollection", "features": []})
            _write_json(scenario_dir / "special_zone_layers.json", {"version": 1, "layers": [], "activeLayerId": "", "topologyFingerprint": "", "diagnostics": []})
            _write_json(scenario_dir / "relief_overlays.geojson", {"type": "FeatureCollection", "features": []})
            _write_json(scenario_dir / "bathymetry.topo.json", {"type": "Topology", "objects": {}, "arcs": []})
            _write_json(scenario_dir / "city_overrides.json", {"type": "city_overrides", "featureCollection": {"features": []}})
            manifest = json.loads((scenario_dir / "manifest.json").read_text(encoding="utf-8"))
            manifest["special_regions_url"] = "data/scenarios/snapshot_layers/special_regions.geojson"
            manifest["special_zone_layers_url"] = "data/scenarios/snapshot_layers/special_zone_layers.json"
            manifest["relief_overlays_url"] = "data/scenarios/snapshot_layers/relief_overlays.geojson"
            manifest["bathymetry_topology_url"] = "data/scenarios/snapshot_layers/bathymetry.topo.json"
            manifest["city_overrides_url"] = "data/scenarios/snapshot_layers/city_overrides.json"

            try:
                input_sha = check_scenario_contracts._collect_snapshot_inputs(scenario_dir, manifest)
            finally:
                check_scenario_contracts.PROJECT_ROOT = previous_project_root

            self.assertIn("special_regions.geojson", input_sha)
            self.assertIn("special_zone_layers.json", input_sha)
            self.assertIn("relief_overlays.geojson", input_sha)
            self.assertIn("bathymetry.topo.json", input_sha)
            self.assertIn("city_overrides.json", input_sha)
            self.assertIn("capital_hints.json", input_sha)

    def test_build_snapshot_fingerprint_changes_when_capital_hints_payload_drifts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_root = Path(tmp_dir)
            previous_project_root = check_scenario_contracts.PROJECT_ROOT
            check_scenario_contracts.PROJECT_ROOT = tmp_root
            scenario_dir = _create_scenario_dir(tmp_root, "snapshot_capitals")
            _write_strict_bundle_files(scenario_dir)
            capital_hints_path = scenario_dir / "capital_hints.json"
            manifest = json.loads((scenario_dir / "manifest.json").read_text(encoding="utf-8"))

            try:
                first_snapshot = check_scenario_contracts._build_snapshot_for_scenario(scenario_dir, manifest)
                _write_json(
                    capital_hints_path,
                    {
                        "version": 1,
                        "scenario_id": "snapshot_capitals",
                        "entries": [{"tag": "AAA", "label": "Changed Capital", "feature_id": "CITY::changed"}],
                    },
                )
                second_snapshot = check_scenario_contracts._build_snapshot_for_scenario(scenario_dir, manifest)
            finally:
                check_scenario_contracts.PROJECT_ROOT = previous_project_root

            self.assertNotEqual(
                first_snapshot["snapshot_fingerprint"],
                second_snapshot["snapshot_fingerprint"],
            )

    def test_validate_startup_bundle_sources_rejects_missing_source_sha(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_root = Path(tmp_dir)
            previous_project_root = check_scenario_contracts.PROJECT_ROOT
            check_scenario_contracts.PROJECT_ROOT = tmp_root
            scenario_dir = _create_scenario_dir(tmp_root, "strict_startup_source")
            bundle_payload = {
                "scenario_id": "strict_startup_source",
                "source": {
                    "runtime_bootstrap_topology_sha256": "b" * 64,
                },
            }
            _write_json(scenario_dir / "startup.bundle.en.json", bundle_payload)
            _write_json(scenario_dir / "startup.bundle.zh.json", bundle_payload)
            manifest = json.loads((scenario_dir / "manifest.json").read_text(encoding="utf-8"))
            manifest["startup_bundle_url_en"] = "data/scenarios/strict_startup_source/startup.bundle.en.json"
            manifest["startup_bundle_url_zh"] = "data/scenarios/strict_startup_source/startup.bundle.zh.json"
            manifest["source"] = {
                "runtime_topology_sha256": "a" * 64,
                "runtime_bootstrap_topology_sha256": "b" * 64,
            }
            errors: list[str] = []

            try:
                check_scenario_contracts._validate_startup_bundle_sources(scenario_dir, manifest, errors)
            finally:
                check_scenario_contracts.PROJECT_ROOT = previous_project_root

            self.assertTrue(
                any(
                    "startup bundle en source.runtime_topology_sha256 must be present" in error
                    for error in errors
                )
            )

    def test_classify_violation_marks_owner_hint_failures_as_risky(self) -> None:
        self.assertEqual(
            check_scenario_contracts._classify_violation(
                "detail chunk political.detail.country.aaa feature AAA-1 is missing owners.by_feature ownership."
            ),
            "risky",
        )
        self.assertEqual(
            check_scenario_contracts._classify_violation(
                "runtime-only Arctic shell features must be coalesced shell_fallback geometry with owner/controller hints in strict mode. "
                "Sample: ['RU_ARCTIC_FB_001']."
            ),
            "risky",
        )

    def test_materialize_violation_report_disables_safe_fixable_when_risky_errors_exist(self) -> None:
        report = {
            "errors": [
                "detail chunk political.detail.country.aaa feature AAA-1 is missing owners.by_feature ownership.",
                "startup bundle en source.runtime_topology_sha256 must match manifest.source.runtime_topology_sha256.",
            ]
        }

        check_scenario_contracts._materialize_violation_report(report)

        self.assertFalse(report["safe_fixable"])
        self.assertTrue(report["risky_fixes_required"])

    def test_write_safe_main_blocks_risky_repairs_before_apply(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_root = Path(tmp_dir)
            scenario_dir = tmp_root / "data" / "scenarios" / "risky_scenario"
            scenario_dir.mkdir(parents=True, exist_ok=True)
            args = Namespace(
                write_safe=True,
                strict=True,
                scenarios_root=str((tmp_root / "data" / "scenarios").resolve()),
                scenario_dir=[str(scenario_dir.resolve())],
                report_path="",
            )
            initial_report = {
                "scenario_id": "risky_scenario",
                "scenario_dir": str(scenario_dir),
                "status": "failed",
                "errors": [
                    "detail chunk political.detail.country.aaa feature AAA-1 is missing owners.by_feature ownership."
                ],
                "warnings": [],
                "repair_tracks": {},
                "snapshot_fingerprint": "",
            }

            with mock.patch.object(check_scenario_contracts, "parse_args", return_value=args):
                with mock.patch.object(check_scenario_contracts, "discover_scenario_dirs", return_value=[scenario_dir]):
                    with mock.patch.object(check_scenario_contracts, "collect_duplicate_scenario_dirs", return_value={}):
                        with mock.patch.object(
                            check_scenario_contracts,
                            "inspect_scenario_contract",
                            return_value=dict(initial_report),
                        ):
                            with mock.patch.object(
                                check_scenario_contracts,
                                "apply_safe_scenario_contract_repairs",
                                return_value=[],
                            ) as repair_mock:
                                exit_code = check_scenario_contracts.main()

            self.assertEqual(exit_code, 1)
            repair_mock.assert_not_called()

    def test_validation_report_paths_support_repeated_outputs_and_legacy_string_args(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            first = root / "first.json"
            second = root / "nested" / "second.json"
            paths = check_scenario_contracts.resolve_validation_report_paths([str(first), str(second)])
            for output_path in paths:
                check_scenario_contracts.write_validation_report(
                    output_path,
                    [{"scenario_id": "fixture", "status": "ok"}],
                    strict=True,
                )

            self.assertEqual(first.read_bytes(), second.read_bytes())
            self.assertEqual(
                check_scenario_contracts.resolve_validation_report_paths(""),
                [],
            )
            self.assertEqual(
                check_scenario_contracts.resolve_validation_report_paths(str(first)),
                [first.resolve()],
            )

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
            self.assertIsNone(repair_tracks["owners_controllers_keyset"])
            self.assertEqual(repair_tracks["owners_cores_keyset"]["core_only_count"], 1)
            self.assertEqual(repair_tracks["runtime_topology_extra_ids"]["extra_runtime_id_count"], 2)


if __name__ == "__main__":
    unittest.main()
