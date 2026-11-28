from __future__ import annotations

import hashlib
import gzip
import json
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from unittest import mock

from tools import check_scenario_contracts
from tools.check_scenario_contracts import validate_scenario_contract


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")


def _sha256_path(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _create_scenario_dir(tmp_path: Path, scenario_name: str) -> Path:
    scenario_dir = tmp_path / "data" / "scenarios" / scenario_name
    manifest = {
        "version": 2,
        "scenario_id": scenario_name,
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
    manifest["capital_hints_url"] = f"data/scenarios/{scenario_name}/capital_hints.json"
    _write_json(scenario_dir / "manifest.json", manifest)
    identity = {"version": 1, "scenario_id": scenario_name}
    for filename, fields in {
        "city_overrides.json": {"capitals_by_tag": {"AAA": "CITY::capital"}, "capital_city_hints": {}},
        "special_zone_layers.json": {"layers": [], "activeLayerId": "", "topologyFingerprint": "", "diagnostics": []},
        "scenario_mutations.json": {"tags": {}, "countries": {}, "assignments_by_feature_id": {},
                                    "capitals": {}, "geo_locale": {}, "district_groups": {}},
        "city_assets.partial.json": {"cities": {}, "audit": {}},
        "capital_defaults.partial.json": {"capitals_by_tag": {}, "capital_city_hints": {}, "audit": {}},
        "capital_hints.json": {"entries": []},
    }.items():
        _write_json(scenario_dir / filename, {**identity, **fields})
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
    def test_runtime_gzip_source_uses_manifest_identity_in_staging_directory(self) -> None:
        runtime = Path(__file__).resolve().parents[1] / ".runtime/tmp"
        runtime.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=runtime) as temporary:
            staging = Path(temporary) / "staging"
            staging.mkdir()
            source = staging / "runtime_topology.topo.json.gz"
            encoded = gzip.compress(b'{"type":"Topology","objects":{},"arcs":[]}', mtime=0)
            source.write_bytes(encoded)
            manifest = {"scenario_id": "tno_1962", "runtime_topology_url": "data/scenarios/tno_1962/runtime_topology.topo.json.gz"}
            self.assertEqual(check_scenario_contracts._runtime_topology_source_path(staging, manifest), source.resolve())
            self.assertEqual(check_scenario_contracts._collect_snapshot_inputs(staging, manifest)["runtime_topology.topo.json"], hashlib.sha256(encoded).hexdigest())

    def test_explicit_missing_or_corrupt_gzip_runtime_fails_closed(self) -> None:
        runtime = Path(__file__).resolve().parents[1] / ".runtime/tmp"
        runtime.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=runtime) as temporary:
            scenario_dir = Path(temporary)
            plain = scenario_dir / "runtime_topology.topo.json"
            _write_json(plain, {"type": "Topology", "objects": {}, "arcs": []})
            compressed = plain.with_name(plain.name + ".gz")
            with self.assertRaises(FileNotFoundError):
                check_scenario_contracts.load_json(compressed)
            compressed.write_bytes(b"invalid gzip")
            with self.assertRaises(gzip.BadGzipFile):
                check_scenario_contracts.load_json(compressed)

    def test_blank_base_strict_contract_accepts_ownerless_geometry_and_rejects_pollution(self) -> None:
        cases = ("valid", "owners", "controllers", "direct_controllers", "cores", "property", "duplicate", "count", "mode")
        for case in cases:
            with self.subTest(case=case), tempfile.TemporaryDirectory() as tmp_dir:
                root = Path(tmp_dir)
                scenario_dir = _create_scenario_dir(root, "blank_base")
                manifest_path = scenario_dir / "manifest.json"
                manifest = json.loads(manifest_path.read_text())
                manifest.update(map_mode="blank" if case != "mode" else "political",
                                scenario_contract_profile="lightweight_base")
                _write_json(manifest_path, manifest)
                with mock.patch.object(check_scenario_contracts, "PROJECT_ROOT", root):
                    _write_strict_bundle_files(
                        scenario_dir, owners={"F-1": "AAA"} if case == "owners" else {},
                        cores={"F-1": ["AAA"]} if case == "cores" else {},
                        controllers={"F-1": "AAA"} if case == "controllers" else {},
                        runtime_feature_ids=["F-1", "RU_ARCTIC_FB_001"],
                        manifest_feature_count=1 if case == "count" else 2)
                    if case == "direct_controllers":
                        _write_json(scenario_dir / "controllers.by_feature.json", {"F-1": "AAA"})
                    if case in {"property", "duplicate"}:
                        runtime_path = scenario_dir / "runtime_topology.topo.json"
                        topology = json.loads(runtime_path.read_text())
                        rows = topology["objects"]["political"]["geometries"]
                        if case == "duplicate":
                            rows.append(dict(rows[0]))
                        else:
                            rows[0]["properties"]["cntr_code"] = "AAA"
                        _write_json(runtime_path, topology)
                    errors = []
                    check_scenario_contracts.validate_strict_bundle_contract(scenario_dir, errors)
                if case == "valid":
                    self.assertEqual(errors, [])
                elif case in {"owners", "cores", "controllers", "direct_controllers"}:
                    self.assertTrue(any("empty owners, cores and controllers" in error for error in errors), errors)
                elif case == "property":
                    self.assertTrue(any("assignment or grouping properties" in error for error in errors), errors)
                elif case == "count":
                    self.assertTrue(any("nonempty runtime feature count" in error for error in errors), errors)
                elif case == "duplicate":
                    self.assertTrue(any("nonempty and unique" in error for error in errors), errors)
                else:
                    self.assertTrue(any("may only exceed" in error for error in errors), errors)

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


if __name__ == "__main__":
    unittest.main()
