from __future__ import annotations

import json
import re
import tempfile
import unittest
from pathlib import Path

from tools import (
    audit_startup_bundle_family,
    audit_startup_support_family,
    build_startup_bootstrap_assets,
    build_hoi4_scenario,
    build_startup_bundle,
    generate_startup_support_whitelist,
    materialize_startup_support_candidate,
)


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


class StartupBootstrapAssetsTest(unittest.TestCase):
    def test_build_bootstrap_runtime_topology_keeps_runtime_shell_only(self) -> None:
        full_topology = {
            "type": "Topology",
            "objects": {
                "political": {
                    "type": "GeometryCollection",
                    "geometries": [
                        {"type": "Polygon", "properties": {"id": "AAA-1"}, "arcs": [[0]]},
                        {
                            "type": "Polygon",
                            "properties": {
                                "id": "RU_ARCTIC_FB_001",
                                "scenario_helper_kind": "shell_fallback",
                                "scenario_shell_owner_hint": "RFA",
                                "unused": "x",
                            },
                            "arcs": [[1]],
                        },
                    ],
                },
                "land_mask": {"type": "GeometryCollection", "geometries": [{"type": "Polygon", "properties": {"id": "mask-1"}, "arcs": [[1]]}]},
                "context_land_mask": {"type": "GeometryCollection", "geometries": [{"type": "Polygon", "properties": {"id": "context-mask-1"}, "arcs": [[2]]}]},
                "scenario_water": {"type": "GeometryCollection", "geometries": [{"type": "Polygon", "properties": {"id": "water-1"}, "arcs": [[3]]}]},
                "scenario_special_land": {"type": "GeometryCollection", "geometries": [{"type": "Polygon", "properties": {"id": "special-1"}, "arcs": [[4]]}]},
            },
            "arcs": [[], [], [], [], []],
            "bbox": [-1, -1, 1, 1],
        }

        shell = build_startup_bootstrap_assets.build_bootstrap_runtime_topology(full_topology)

        self.assertEqual(list(shell["objects"].keys()), ["political", "land_mask", "context_land_mask", "scenario_water", "scenario_special_land"])
        self.assertEqual(shell["arcs"], [[]])
        shell_political = shell["objects"]["political"]["geometries"]
        self.assertEqual([geometry["properties"]["id"] for geometry in shell_political], ["RU_ARCTIC_FB_001"])
        self.assertEqual(shell_political[0]["properties"]["scenario_shell_owner_hint"], "RFA")
        self.assertNotIn("unused", shell_political[0]["properties"])
        self.assertEqual(shell["objects"]["scenario_water"]["geometries"], [])


    def test_build_bootstrap_runtime_topology_keeps_required_empty_shell_objects(self) -> None:
        shell = build_startup_bootstrap_assets.build_bootstrap_runtime_topology(
            {"type": "Topology", "objects": {"political": {"type": "GeometryCollection", "geometries": []}}, "arcs": []}
        )

        self.assertEqual(
            list(shell["objects"].keys()),
            ["land_mask", "context_land_mask", "scenario_water", "scenario_special_land"],
        )
        self.assertEqual(shell["arcs"], [])

    def test_hoi4_1939_checked_in_startup_bundle_contract(self) -> None:
        scenario_dir = Path(__file__).resolve().parents[1] / "data" / "scenarios" / "hoi4_1939"
        manifest = json.loads((scenario_dir / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["startup_bundle_url_en"], "data/scenarios/hoi4_1939/startup.bundle.en.json")
        self.assertEqual(manifest["startup_bundle_url_zh"], "data/scenarios/hoi4_1939/startup.bundle.zh.json")
        self.assertEqual(manifest["startup_bundle_version"], build_startup_bundle.STARTUP_BUNDLE_VERSION)
        self.assertEqual(manifest["startup_bootstrap_strategy"], build_startup_bundle.STARTUP_BOOTSTRAP_STRATEGY)
        legacy_bootstrap = json.loads((scenario_dir / "runtime_topology.bootstrap.topo.json").read_text(encoding="utf-8"))
        self.assertGreater(len(legacy_bootstrap["objects"]["political"]["geometries"]), 0)
        self.assertGreater(len(legacy_bootstrap["arcs"]), 0)
        startup_shell = json.loads((scenario_dir / "startup.runtime_shell.topo.json").read_text(encoding="utf-8"))
        self.assertNotIn("political", startup_shell["objects"])
        for object_name in ("land_mask", "context_land_mask", "scenario_water"):
            self.assertIn(object_name, startup_shell["objects"])

        for language in build_startup_bundle.SUPPORTED_LANGUAGES:
            bundle_path = scenario_dir / f"startup.bundle.{language}.json"
            gzip_path = scenario_dir / f"startup.bundle.{language}.json.gz"
            self.assertTrue(bundle_path.exists(), bundle_path)
            self.assertTrue(gzip_path.exists(), gzip_path)
            self.assertLess(gzip_path.stat().st_size, build_startup_bundle.STARTUP_BUNDLE_GZIP_BUDGET_BYTES)
            bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
            self.assertEqual(bundle["scenario_id"], "hoi4_1939")
            self.assertEqual(bundle["scenario"]["bootstrap_strategy"], build_startup_bundle.STARTUP_BOOTSTRAP_STRATEGY)
            runtime_objects = bundle["scenario"]["runtime_topology_bootstrap"]["objects"]
            for object_name in ("land_mask", "context_land_mask", "scenario_water"):
                self.assertIn(object_name, runtime_objects)
            self.assertGreater(len(bundle["scenario"]["runtime_political_meta"]["featureIds"]), 0)

    def test_tno_1962_checked_in_startup_bundle_includes_arctic_shell(self) -> None:
        scenario_dir = Path(__file__).resolve().parents[1] / "data" / "scenarios" / "tno_1962"
        bootstrap = json.loads((scenario_dir / "runtime_topology.bootstrap.topo.json").read_text(encoding="utf-8"))
        bootstrap_shells = [
            geometry
            for geometry in bootstrap["objects"]["political"]["geometries"]
            if str((geometry.get("properties", {}) or {}).get("id") or "").startswith("RU_ARCTIC_FB_")
        ]
        self.assertGreater(len(bootstrap_shells), 0)
        bootstrap_shell_props = [geometry.get("properties", {}) or {} for geometry in bootstrap_shells]
        self.assertFalse(
            any(re.fullmatch(r"RU_ARCTIC_FB_\d+", str(props.get("id") or "")) for props in bootstrap_shell_props)
        )
        self.assertTrue(all(props.get("scenario_shell_owner_hint") for props in bootstrap_shell_props))
        self.assertTrue(all(props.get("scenario_shell_controller_hint") for props in bootstrap_shell_props))

        for language in build_startup_bundle.SUPPORTED_LANGUAGES:
            bundle_path = scenario_dir / f"startup.bundle.{language}.json"
            gzip_path = scenario_dir / f"startup.bundle.{language}.json.gz"
            self.assertTrue(bundle_path.exists(), bundle_path)
            self.assertTrue(gzip_path.exists(), gzip_path)
            self.assertLess(gzip_path.stat().st_size, build_startup_bundle.STARTUP_BUNDLE_GZIP_BUDGET_BYTES)
            bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
            runtime_political = bundle["scenario"]["runtime_topology_bootstrap"]["objects"]["political"]
            shell_props = [
                geometry.get("properties", {}) or {}
                for geometry in runtime_political["geometries"]
                if str((geometry.get("properties", {}) or {}).get("id") or "").startswith("RU_ARCTIC_FB_")
            ]
            self.assertEqual(len(shell_props), len(bootstrap_shells))
            self.assertTrue(all(props.get("scenario_helper_kind") == "shell_fallback" for props in shell_props))
            self.assertTrue(all(props.get("interactive") is False for props in shell_props))
            self.assertFalse(any(re.fullmatch(r"RU_ARCTIC_FB_\d+", str(props.get("id") or "")) for props in shell_props))
            self.assertTrue(all(props.get("scenario_shell_owner_hint") for props in shell_props))
            self.assertTrue(all(props.get("scenario_shell_controller_hint") for props in shell_props))


    def test_hoi4_geo_locale_language_patches_derive_from_base_patch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir = Path(tmp_dir) / "hoi4_1939"
            scenario_dir.mkdir(parents=True)
            _write_json(
                scenario_dir / "geo_locale_patch.json",
                {
                    "version": 1,
                    "scenario_id": "hoi4_1939",
                    "generated_at": "now",
                    "geo": {
                        "id::AAA-1": {"en": "Alpha", "zh": "阿尔法"},
                        "id::BBB-1": {"en": "Beta"},
                        "id::CCC-1": {"zh": "伽马"},
                    },
                },
            )

            build_hoi4_scenario.ensure_geo_locale_patch_inputs(scenario_dir, "hoi4_1939")

            en_payload = json.loads((scenario_dir / "geo_locale_patch.en.json").read_text(encoding="utf-8"))
            zh_payload = json.loads((scenario_dir / "geo_locale_patch.zh.json").read_text(encoding="utf-8"))
            self.assertEqual(sorted(en_payload["geo"].keys()), ["id::AAA-1", "id::BBB-1"])
            self.assertEqual(sorted(zh_payload["geo"].keys()), ["id::AAA-1", "id::CCC-1"])
            self.assertEqual(en_payload["geo"]["id::AAA-1"]["en"], "Alpha")
            self.assertEqual(zh_payload["geo"]["id::AAA-1"]["zh"], "阿尔法")

    def test_build_startup_bundle_payload_uses_full_runtime_topology_for_political_meta(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            topology_primary_path = root / "topology_primary.json"
            full_runtime_topology_path = root / "runtime_topology.topo.json"
            runtime_bootstrap_topology_path = root / "runtime_topology.bootstrap.topo.json"
            startup_locales_path = root / "locales.startup.json"
            geo_aliases_path = root / "geo_aliases.startup.json"
            countries_path = root / "countries.json"
            owners_path = root / "owners.json"
            controllers_path = root / "controllers.json"
            cores_path = root / "cores.json"
            geo_patch_path = root / "geo_locale_patch.en.json"

            _write_json(topology_primary_path, {"type": "Topology", "objects": {"political": {"type": "GeometryCollection", "geometries": []}}})
            _write_json(
                full_runtime_topology_path,
                {
                    "type": "Topology",
                    "objects": {
                        "political": {
                            "type": "GeometryCollection",
                            "geometries": [
                                {"type": "Polygon", "properties": {"id": "AAA-1", "cntr_code": "AA"}, "arcs": []},
                                {"type": "Polygon", "properties": {"id": "BBB-1", "cntr_code": "BB"}, "arcs": []},
                                {
                                    "type": "Polygon",
                                    "properties": {
                                        "id": "RU_ARCTIC_FB_RFA_001",
                                        "cntr_code": "RU",
                                        "scenario_helper_kind": "shell_fallback",
                                        "scenario_shell_owner_hint": "RFA",
                                        "interactive": False,
                                    },
                                    "arcs": [[0]],
                                },
                            ],
                            "computed_neighbors": [[], [], []],
                        },
                        "land_mask": {"type": "GeometryCollection", "geometries": []},
                        "context_land_mask": {"type": "GeometryCollection", "geometries": []},
                        "scenario_water": {"type": "GeometryCollection", "geometries": []},
                    },
                    "arcs": [[[0, 0], [1, 0]]],
                },
            )
            _write_json(
                runtime_bootstrap_topology_path,
                {
                    "type": "Topology",
                    "objects": {
                        "political": {
                            "type": "GeometryCollection",
                            "geometries": [
                                {
                                    "type": "Polygon",
                                    "properties": {
                                        "id": "RU_ARCTIC_FB_RFA_001",
                                        "cntr_code": "RU",
                                        "scenario_helper_kind": "shell_fallback",
                                        "scenario_shell_owner_hint": "RFA",
                                        "interactive": False,
                                        "unused": "x",
                                    },
                                    "arcs": [[0]],
                                },
                            ],
                        },
                        "land_mask": {"type": "GeometryCollection", "geometries": []},
                        "context_land_mask": {"type": "GeometryCollection", "geometries": []},
                        "scenario_water": {"type": "GeometryCollection", "geometries": []},
                    },
                    "arcs": [[[0, 0], [1, 0]]],
                },
            )
            _write_json(startup_locales_path, {"ui": {}, "geo": {}})
            _write_json(geo_aliases_path, {"alias_to_stable_key": {}})
            _write_json(countries_path, {"countries": {"AAA": {"display_name": "Alpha", "base_iso2": "AA", "feature_count": 1, "color_hex": "#111111"}}})
            _write_json(owners_path, {"owners": {"AAA-1": "AAA", "RU_ARCTIC_FB_RFA_001": "AAA"}})
            _write_json(controllers_path, {"controllers": {"AAA-1": "AAA", "RU_ARCTIC_FB_RFA_001": "AAA"}})
            _write_json(cores_path, {"cores": {"AAA-1": ["AAA"], "RU_ARCTIC_FB_RFA_001": ["AAA"]}})
            _write_json(geo_patch_path, {"geo": {}})

            payload = build_startup_bundle.build_startup_bundle_payload(
                language="en",
                scenario_manifest={"scenario_id": "tno_1962", "generated_at": "now", "baseline_hash": "base"},
                data_manifest={"version": 1, "generated_at": "now"},
                topology_primary_path=topology_primary_path,
                full_runtime_topology_path=full_runtime_topology_path,
                runtime_bootstrap_topology_path=runtime_bootstrap_topology_path,
                countries_path=countries_path,
                owners_path=owners_path,
                controllers_path=controllers_path,
                cores_path=cores_path,
            )

            self.assertEqual(len(payload["scenario"]["runtime_political_meta"]["featureIds"]), 3)
            self.assertEqual(payload["scenario"]["runtime_political_meta"]["encoding"], build_startup_bundle.STARTUP_RUNTIME_POLITICAL_META_ENCODING)
            self.assertNotIn("featureIndexById", payload["scenario"]["runtime_political_meta"])
            self.assertNotIn("canonicalCountryByFeatureId", payload["scenario"]["runtime_political_meta"])
            shell_geometries = payload["scenario"]["runtime_topology_bootstrap"]["objects"]["political"]["geometries"]
            self.assertEqual([geometry["properties"]["id"] for geometry in shell_geometries], ["RU_ARCTIC_FB_RFA_001"])
            self.assertEqual(shell_geometries[0]["properties"]["scenario_shell_owner_hint"], "RFA")
            self.assertNotIn("unused", shell_geometries[0]["properties"])
            self.assertEqual(payload["scenario"]["runtime_topology_bootstrap"]["objects"]["scenario_water"]["geometries"], [])
            self.assertNotIn("locales", payload["base"])
            self.assertNotIn("geo_aliases", payload["base"])
            self.assertNotIn("geo_locale_patch", payload["scenario"])
            self.assertNotIn("apply_seed", payload["scenario"])
            self.assertEqual(payload["scenario"]["owners"]["encoding"], build_startup_bundle.STARTUP_FEATURE_ORDER_ASSIGNMENT_ENCODING)
            self.assertEqual(payload["scenario"]["controllers"]["encoding"], build_startup_bundle.STARTUP_FEATURE_ORDER_ASSIGNMENT_ENCODING)
            self.assertEqual(payload["scenario"]["cores"]["encoding"], build_startup_bundle.STARTUP_FEATURE_ORDER_ASSIGNMENT_ENCODING)

    def test_build_slim_startup_primary_topology_keeps_special_zones_for_startup_fallback(self) -> None:
        source_topology = {
            "type": "Topology",
            "objects": {
                "political": {
                    "type": "GeometryCollection",
                    "geometries": [
                        {"type": "Polygon", "properties": {"id": "AAA-1", "name": "Alpha", "cntr_code": "AAA", "detail_tier": "adm0", "unused": "x"}, "arcs": [[0]]},
                    ],
                },
                "water_regions": {
                    "type": "GeometryCollection",
                    "geometries": [
                        {"type": "Polygon", "properties": {"id": "W-1", "label": "Water", "water_type": "sea", "region_group": "macro", "unused": "x"}, "arcs": [[1]]},
                    ],
                },
                "special_zones": {
                    "type": "GeometryCollection",
                    "geometries": [
                        {"type": "Polygon", "properties": {"id": "SZ-1", "label": "Zone"}, "arcs": [[2]]},
                    ],
                },
                "land": {
                    "type": "GeometryCollection",
                    "geometries": [
                        {"type": "Polygon", "properties": {"foo": "bar"}, "arcs": [[3]]},
                    ],
                },
            },
            "arcs": [
                [[0, 0], [1, 0]],
                [[0, 0], [0, 1]],
                [[0, 0], [1, 1]],
                [[1, 0], [1, 1]],
            ],
            "bbox": [-1, -1, 1, 1],
        }

        slim = build_startup_bundle.build_slim_startup_primary_topology(source_topology)

        self.assertIn("special_zones", slim["objects"])
        self.assertEqual(sorted(slim["objects"].keys()), ["land", "political", "special_zones", "water_regions"])
        self.assertEqual(len(slim["arcs"]), 4)
        self.assertEqual(
            slim["objects"]["political"]["geometries"][0]["properties"],
            {"id": "AAA-1", "name": "Alpha", "cntr_code": "AAA", "detail_tier": "adm0"},
        )
        self.assertEqual(
            slim["objects"]["special_zones"]["geometries"][0]["properties"],
            {"id": "SZ-1", "label": "Zone"},
        )
        self.assertNotIn("properties", slim["objects"]["land"]["geometries"][0])

    def test_build_startup_primary_slimming_report_tracks_removed_objects(self) -> None:
        source_topology = {
            "type": "Topology",
            "objects": {
                "political": {"type": "GeometryCollection", "geometries": [{"type": "Polygon", "properties": {"id": "AAA-1"}, "arcs": [[0]]}]},
                "special_zones": {"type": "GeometryCollection", "geometries": [{"type": "Polygon", "properties": {"id": "SZ-1"}, "arcs": [[1]]}]},
            },
            "arcs": [
                [[0, 0], [1, 0]],
                [[0, 0], [0, 1]],
            ],
            "bbox": [-1, -1, 1, 1],
        }
        slim = build_startup_bundle.build_slim_startup_primary_topology(source_topology)

        report = build_startup_bundle.build_startup_primary_slimming_report(source_topology, slim)

        self.assertEqual(report["removed_objects"], [])
        self.assertEqual(report["before_arc_count"], report["after_arc_count"])

    def test_build_startup_bundle_report_includes_startup_family_audit_fields(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_manifest_path = root / "manifest.json"
            data_manifest_path = root / "data_manifest.json"
            topology_primary_path = root / "topology_primary.json"
            full_runtime_topology_path = root / "runtime_topology.topo.json"
            runtime_bootstrap_topology_path = root / "runtime_topology.bootstrap.topo.json"
            startup_locales_path = root / "locales.startup.json"
            geo_aliases_path = root / "geo_aliases.startup.json"
            countries_path = root / "countries.json"
            owners_path = root / "owners.json"
            controllers_path = root / "controllers.json"
            cores_path = root / "cores.json"
            geo_patch_en_path = root / "geo_locale_patch.en.json"
            geo_patch_zh_path = root / "geo_locale_patch.zh.json"
            output_en_path = root / "startup.bundle.en.json"
            output_zh_path = root / "startup.bundle.zh.json"
            report_path = root / "startup_bundle.report.json"

            _write_json(scenario_manifest_path, {"scenario_id": "tno_1962", "generated_at": "now", "baseline_hash": "base"})
            _write_json(data_manifest_path, {"version": 1, "generated_at": "now"})
            _write_json(
                topology_primary_path,
                {
                    "type": "Topology",
                    "objects": {
                        "political": {"type": "GeometryCollection", "geometries": [{"type": "Polygon", "properties": {"id": "AAA-1"}, "arcs": []}]},
                        "water_regions": {"type": "GeometryCollection", "geometries": [{"type": "Polygon", "properties": {"id": "W-1"}, "arcs": []}]},
                        "special_zones": {"type": "GeometryCollection", "geometries": [{"type": "Polygon", "properties": {"id": "SZ-1"}, "arcs": []}]},
                    },
                    "arcs": [],
                },
            )
            _write_json(
                full_runtime_topology_path,
                {
                    "type": "Topology",
                    "objects": {
                        "political": {
                            "type": "GeometryCollection",
                            "geometries": [{"type": "Polygon", "properties": {"id": "AAA-1", "cntr_code": "AA"}, "arcs": []}],
                            "computed_neighbors": [[]],
                        },
                        "land_mask": {"type": "GeometryCollection", "geometries": [{"type": "Polygon", "properties": {"id": "LM-1"}, "arcs": []}]},
                        "context_land_mask": {"type": "GeometryCollection", "geometries": [{"type": "Polygon", "properties": {"id": "CLM-1"}, "arcs": []}]},
                        "scenario_water": {"type": "GeometryCollection", "geometries": [{"type": "Polygon", "properties": {"id": "W-1"}, "arcs": []}]},
                    },
                    "arcs": [],
                },
            )
            _write_json(
                runtime_bootstrap_topology_path,
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
            _write_json(
                startup_locales_path,
                {"ui": {"hello": {"en": "Hello", "zh": "你好"}}, "geo": {"AAA-1": {"en": "Alpha", "zh": "阿尔法"}}},
            )
            _write_json(geo_aliases_path, {"alias_to_stable_key": {"alpha": "AAA-1"}})
            _write_json(countries_path, {"countries": {"AAA": {"display_name": "Alpha", "base_iso2": "AA", "feature_count": 1, "color_hex": "#111111"}}})
            _write_json(owners_path, {"owners": {"AAA-1": "AAA"}})
            _write_json(controllers_path, {"controllers": {"AAA-1": "AAA"}})
            _write_json(cores_path, {"cores": {"AAA-1": ["AAA"]}})
            _write_json(geo_patch_en_path, {"scenario_id": "tno_1962", "geo": {"AAA-1": {"en": "Alpha"}}})
            _write_json(geo_patch_zh_path, {"scenario_id": "tno_1962", "geo": {"AAA-1": {"zh": "阿尔法"}}})

            result = build_startup_bundle.build_startup_bundles(
                scenario_manifest_path=scenario_manifest_path,
                data_manifest_path=data_manifest_path,
                topology_primary_path=topology_primary_path,
                startup_locales_path=startup_locales_path,
                geo_aliases_path=geo_aliases_path,
                full_runtime_topology_path=full_runtime_topology_path,
                runtime_bootstrap_topology_path=runtime_bootstrap_topology_path,
                countries_path=countries_path,
                owners_path=owners_path,
                controllers_path=controllers_path,
                cores_path=cores_path,
                geo_locale_patch_en_path=geo_patch_en_path,
                geo_locale_patch_zh_path=geo_patch_zh_path,
                output_en_path=output_en_path,
                output_zh_path=output_zh_path,
                report_path=report_path,
            )

            report = result["report"]
            self.assertIn("consumer_matrix", report)
            self.assertIn("section_roles", report)
            self.assertIn("duplication_suspects", report)
            self.assertIn("file_audit", report)
            self.assertIn("startup_bundle", report["file_audit"])
            self.assertIn("startup_primary_source", report["file_audit"])
            self.assertIn("startup_locales", report["file_audit"])
            self.assertIn("geo_locale_patch", report["file_audit"])
            self.assertIn("base.topology_primary", report["languages"]["en"]["section_bytes"])
            self.assertNotIn("base.locales", report["languages"]["en"]["section_bytes"])
            self.assertNotIn("base.geo_aliases", report["languages"]["en"]["section_bytes"])
            self.assertNotIn("scenario.geo_locale_patch", report["languages"]["en"]["section_bytes"])
            self.assertNotIn("scenario.apply_seed", report["languages"]["en"]["section_bytes"])
            self.assertIn("external_support_bytes", report["languages"]["en"])
            self.assertIn("external_patch_bytes", report["languages"]["en"])
            self.assertIn("startup_core_compaction", report["languages"]["en"])
            self.assertEqual(report["languages"]["en"]["startup_core_compaction"]["apply_seed"]["after_bytes"], 0)
            self.assertGreater(report["languages"]["en"]["startup_core_compaction"]["apply_seed"]["before_bytes"], 0)
            self.assertLess(
                report["languages"]["en"]["startup_core_compaction"]["runtime_political_meta"]["after_bytes"],
                report["languages"]["en"]["startup_core_compaction"]["runtime_political_meta"]["before_bytes"],
            )
            self.assertIn("startup_primary_slimming", report)
            self.assertEqual(report["startup_primary_slimming"]["removed_objects"], [])
            self.assertEqual(report["file_audit"]["startup_locales"]["path"], str(startup_locales_path))
            self.assertEqual(report["file_audit"]["startup_geo_aliases"]["path"], str(geo_aliases_path))
            self.assertEqual(report["file_audit"]["geo_locale_patch"]["en"]["path"], str(geo_patch_en_path))
            self.assertEqual(report["file_audit"]["geo_locale_patch"]["zh"]["path"], str(geo_patch_zh_path))
            self.assertEqual(report["file_audit"]["startup_primary_source"]["path"], str(topology_primary_path))
            self.assertEqual(
                report["file_audit"]["startup_bundle"]["en"]["gzip_file_bytes"],
                (output_en_path.with_suffix(".json.gz")).stat().st_size,
            )
            self.assertTrue(report_path.exists())

    def test_audit_startup_bundle_family_reads_existing_scenario_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir = Path(tmp_dir) / "tno_1962"
            scenario_dir.mkdir(parents=True, exist_ok=True)
            scenario_manifest_path = scenario_dir / "manifest.json"
            data_manifest_path = scenario_dir / "data_manifest.json"
            topology_primary_path = scenario_dir / "topology_primary.json"
            full_runtime_topology_path = scenario_dir / "runtime_topology.topo.json"
            runtime_bootstrap_topology_path = scenario_dir / "runtime_topology.bootstrap.topo.json"
            startup_locales_path = scenario_dir / "locales.startup.json"
            geo_aliases_path = scenario_dir / "geo_aliases.startup.json"
            countries_path = scenario_dir / "countries.json"
            owners_path = scenario_dir / "owners.json"
            controllers_path = scenario_dir / "controllers.json"
            cores_path = scenario_dir / "cores.json"
            geo_patch_en_path = scenario_dir / "geo_locale_patch.en.json"
            geo_patch_zh_path = scenario_dir / "geo_locale_patch.zh.json"
            output_en_path = scenario_dir / "startup.bundle.en.json"
            output_zh_path = scenario_dir / "startup.bundle.zh.json"

            _write_json(scenario_manifest_path, {"scenario_id": "tno_1962", "generated_at": "now", "baseline_hash": "base"})
            _write_json(data_manifest_path, {"version": 1, "generated_at": "now"})
            _write_json(
                topology_primary_path,
                {
                    "type": "Topology",
                    "objects": {"political": {"type": "GeometryCollection", "geometries": [{"type": "Polygon", "properties": {"id": "AAA-1"}, "arcs": []}]}},
                    "arcs": [],
                },
            )
            _write_json(
                full_runtime_topology_path,
                {
                    "type": "Topology",
                    "objects": {
                        "political": {
                            "type": "GeometryCollection",
                            "geometries": [{"type": "Polygon", "properties": {"id": "AAA-1", "cntr_code": "AA"}, "arcs": []}],
                            "computed_neighbors": [[]],
                        },
                        "land_mask": {"type": "GeometryCollection", "geometries": []},
                        "context_land_mask": {"type": "GeometryCollection", "geometries": []},
                        "scenario_water": {"type": "GeometryCollection", "geometries": []},
                    },
                    "arcs": [],
                },
            )
            _write_json(
                runtime_bootstrap_topology_path,
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
            _write_json(startup_locales_path, {"ui": {}, "geo": {"AAA-1": {"en": "Alpha", "zh": "阿尔法"}}})
            _write_json(geo_aliases_path, {"alias_to_stable_key": {"alpha": "AAA-1"}})
            _write_json(countries_path, {"countries": {"AAA": {"display_name": "Alpha", "base_iso2": "AA", "feature_count": 1, "color_hex": "#111111"}}})
            _write_json(owners_path, {"owners": {"AAA-1": "AAA"}})
            _write_json(controllers_path, {"controllers": {"AAA-1": "AAA"}})
            _write_json(cores_path, {"cores": {"AAA-1": ["AAA"]}})
            _write_json(geo_patch_en_path, {"scenario_id": "tno_1962", "geo": {"AAA-1": {"en": "Alpha"}}})
            _write_json(geo_patch_zh_path, {"scenario_id": "tno_1962", "geo": {"AAA-1": {"zh": "阿尔法"}}})

            build_startup_bundle.build_startup_bundles(
                scenario_manifest_path=scenario_manifest_path,
                data_manifest_path=data_manifest_path,
                topology_primary_path=topology_primary_path,
                startup_locales_path=startup_locales_path,
                geo_aliases_path=geo_aliases_path,
                full_runtime_topology_path=full_runtime_topology_path,
                runtime_bootstrap_topology_path=runtime_bootstrap_topology_path,
                countries_path=countries_path,
                owners_path=owners_path,
                controllers_path=controllers_path,
                cores_path=cores_path,
                geo_locale_patch_en_path=geo_patch_en_path,
                geo_locale_patch_zh_path=geo_patch_zh_path,
                output_en_path=output_en_path,
                output_zh_path=output_zh_path,
                report_path=None,
            )

            report_path = scenario_dir / "startup_family_audit.json"
            report = audit_startup_bundle_family.audit_startup_bundle_family(
                scenario_dir=scenario_dir,
                topology_primary_source_path=topology_primary_path,
                report_path=report_path,
            )

            self.assertEqual(report["scenario_id"], "tno_1962")
            self.assertEqual(report["file_audit"]["startup_primary_source"]["path"], str(topology_primary_path))
            self.assertEqual(report["file_audit"]["startup_locales"]["path"], str(startup_locales_path))
            self.assertEqual(report["file_audit"]["startup_bundle"]["en"]["path"], str(output_en_path))
            self.assertEqual(report["file_audit"]["geo_locale_patch"]["zh"]["path"], str(geo_patch_zh_path))
            self.assertTrue(report_path.exists())
            self.assertGreater(report["file_audit"]["startup_bundle"]["en"]["gzip_file_bytes"], 0)

    def test_build_startup_support_assets_report_tracks_required_key_sources(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            base_topology_path = root / "topology_primary.json"
            full_locales_path = root / "locales.json"
            full_geo_aliases_path = root / "geo_aliases.json"
            runtime_topology_path = root / "runtime_topology.topo.json"
            scenario_geo_patch_path = root / "geo_locale_patch.json"
            startup_locales_output_path = root / "locales.startup.json"
            startup_geo_aliases_output_path = root / "geo_aliases.startup.json"
            startup_support_whitelist_path = root / "startup_support_whitelist.json"
            report_path = root / "startup_support.report.json"

            _write_json(
                base_topology_path,
                {
                    "type": "Topology",
                    "objects": {
                        "political": {
                            "type": "GeometryCollection",
                            "geometries": [{"type": "Polygon", "properties": {"id": "AAA-1", "name": "Alpha"}, "arcs": []}],
                        }
                    },
                    "arcs": [],
                },
            )
            _write_json(
                runtime_topology_path,
                {
                    "type": "Topology",
                    "objects": {
                        "scenario_water": {
                            "type": "GeometryCollection",
                            "geometries": [{"type": "Polygon", "properties": {"id": "W-1", "label": "Water"}, "arcs": []}],
                        },
                        "land_mask": {"type": "GeometryCollection", "geometries": []},
                        "context_land_mask": {"type": "GeometryCollection", "geometries": []},
                        "scenario_special_land": {"type": "GeometryCollection", "geometries": []},
                    },
                    "arcs": [],
                },
            )
            _write_json(
                full_locales_path,
                {
                    "ui": {"hello": {"en": "Hello", "zh": "你好"}},
                    "geo": {
                        "A Coruña": {"en": "A Coruña", "zh": "拉科鲁尼亚"},
                        "W-1": {"en": "Water", "zh": "水域"},
                        "EXTRA": {"en": "Extra", "zh": "额外"},
                    },
                },
            )
            _write_json(
                full_geo_aliases_path,
                {
                    "alias_to_stable_key": {
                        "A Coruña (ES)": "A Coruña",
                        "water": "W-1",
                        "extra": "EXTRA",
                        "city::skip": "city::foo",
                    }
                },
            )
            _write_json(
                scenario_geo_patch_path,
                {"scenario_id": "tno_1962", "geo": {"PATCH-ID": {"en": "Patch", "zh": "补丁"}}},
            )
            _write_json(
                startup_support_whitelist_path,
                {
                    "locale_keys": ["PATCH-ID", "A Coruña"],
                    "alias_keys": ["A Coruña (ES)"],
                },
            )

            result = build_startup_bootstrap_assets.build_startup_support_assets(
                base_topology_path=base_topology_path,
                full_locales_path=full_locales_path,
                full_geo_aliases_path=full_geo_aliases_path,
                full_runtime_topology_path=runtime_topology_path,
                scenario_geo_patch_path=scenario_geo_patch_path,
                startup_locales_output_path=startup_locales_output_path,
                startup_geo_aliases_output_path=startup_geo_aliases_output_path,
                startup_support_whitelist_path=startup_support_whitelist_path,
                report_path=report_path,
            )

            report = result["report"]
            self.assertEqual(report["scenario_id"], "tno_1962")
            self.assertEqual(report["required_geo_key_sources"]["geo_locale_patch"], 1)
            self.assertEqual(report["startup_locales"]["geo_key_count_before"], 3)
            self.assertEqual(report["startup_locales"]["geo_key_count_after"], 1)
            self.assertEqual(report["startup_geo_aliases"]["alias_count_before"], 4)
            self.assertEqual(report["startup_geo_aliases"]["alias_count_after"], 1)
            self.assertEqual(report["startup_support_whitelist"]["locale_key_count"], 2)
            self.assertEqual(report["startup_support_whitelist"]["alias_key_count"], 1)
            self.assertEqual(report["file_audit"]["startup_support_whitelist"]["path"], str(startup_support_whitelist_path))
            self.assertEqual(report["file_audit"]["startup_locales"]["path"], str(startup_locales_output_path))
            self.assertTrue(report_path.exists())

    def test_audit_startup_support_family_reads_existing_scenario_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir = Path(tmp_dir) / "tno_1962"
            scenario_dir.mkdir(parents=True, exist_ok=True)
            _write_json(scenario_dir / "manifest.json", {"scenario_id": "tno_1962"})
            _write_json(scenario_dir / "geo_locale_patch.json", {"scenario_id": "tno_1962", "geo": {"AAA-1": {"en": "Alpha"}}})
            _write_json(scenario_dir / "locales.startup.json", {"ui": {}, "geo": {"AAA-1": {"en": "Alpha"}}})
            _write_json(scenario_dir / "geo_aliases.startup.json", {"alias_to_stable_key": {"alpha": "AAA-1"}})

            base_topology_path = scenario_dir / "topology_primary.json"
            runtime_topology_path = scenario_dir / "runtime_topology.topo.json"
            full_locales_path = scenario_dir / "locales.json"
            full_geo_aliases_path = scenario_dir / "geo_aliases.json"
            whitelist_path = scenario_dir / "startup_support_whitelist.json"
            _write_json(
                base_topology_path,
                {
                    "type": "Topology",
                    "objects": {
                        "political": {
                            "type": "GeometryCollection",
                            "geometries": [{"type": "Polygon", "properties": {"id": "AAA-1"}, "arcs": []}],
                        }
                    },
                    "arcs": [],
                },
            )
            _write_json(
                runtime_topology_path,
                {
                    "type": "Topology",
                    "objects": {
                        "scenario_water": {"type": "GeometryCollection", "geometries": []},
                        "land_mask": {"type": "GeometryCollection", "geometries": []},
                        "context_land_mask": {"type": "GeometryCollection", "geometries": []},
                        "scenario_special_land": {"type": "GeometryCollection", "geometries": []},
                    },
                    "arcs": [],
                },
            )
            _write_json(full_locales_path, {"ui": {}, "geo": {"AAA-1": {"en": "Alpha"}}})
            _write_json(full_geo_aliases_path, {"alias_to_stable_key": {"alpha": "AAA-1"}})
            _write_json(whitelist_path, {"locale_keys": ["AAA-1"], "alias_keys": ["alpha"]})

            report_path = scenario_dir / "startup_support_audit.json"
            report = audit_startup_support_family.audit_startup_support_family(
                scenario_dir=scenario_dir,
                base_topology_path=base_topology_path,
                full_locales_path=full_locales_path,
                full_geo_aliases_path=full_geo_aliases_path,
                full_runtime_topology_path=runtime_topology_path,
                startup_support_whitelist_path=whitelist_path,
                report_path=report_path,
            )

            self.assertEqual(report["scenario_id"], "tno_1962")
            self.assertEqual(report["file_audit"]["startup_geo_aliases"]["path"], str((scenario_dir / "geo_aliases.startup.json").resolve()))
            self.assertEqual(report["file_audit"]["geo_locale_patch"]["path"], str((scenario_dir / "geo_locale_patch.json").resolve()))
            self.assertEqual(report["file_audit"]["startup_support_whitelist"]["path"], str(whitelist_path.resolve()))
            self.assertTrue(report_path.exists())
            self.assertEqual(report["version"], 1)

    def test_audit_startup_support_family_without_whitelist_keeps_report_scenario_scoped(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenario_dir = Path(tmp_dir) / "hoi4_1936"
            scenario_dir.mkdir(parents=True, exist_ok=True)
            _write_json(scenario_dir / "manifest.json", {"scenario_id": "hoi4_1936"})
            _write_json(scenario_dir / "geo_locale_patch.json", {"scenario_id": "hoi4_1936", "geo": {}})
            _write_json(scenario_dir / "locales.startup.json", {"ui": {}, "geo": {}})
            _write_json(scenario_dir / "geo_aliases.startup.json", {"alias_to_stable_key": {}})
            base_topology_path = scenario_dir / "topology_primary.json"
            runtime_topology_path = scenario_dir / "runtime_topology.topo.json"
            full_locales_path = scenario_dir / "locales.json"
            full_geo_aliases_path = scenario_dir / "geo_aliases.json"
            _write_json(base_topology_path, {"type": "Topology", "objects": {}, "arcs": []})
            _write_json(runtime_topology_path, {"type": "Topology", "objects": {}, "arcs": []})
            _write_json(full_locales_path, {"ui": {}, "geo": {}})
            _write_json(full_geo_aliases_path, {"alias_to_stable_key": {}})

            report = audit_startup_support_family.audit_startup_support_family(
                scenario_dir=scenario_dir,
                base_topology_path=base_topology_path,
                full_locales_path=full_locales_path,
                full_geo_aliases_path=full_geo_aliases_path,
                full_runtime_topology_path=runtime_topology_path,
            )

            self.assertEqual(report["scenario_id"], "hoi4_1936")
            self.assertEqual(report["file_audit"]["startup_support_whitelist"]["path"], "")
            self.assertEqual(report["startup_support_whitelist"]["locale_key_count"], 0)
            self.assertEqual(report["startup_support_whitelist"]["alias_key_count"], 0)

    def test_build_startup_support_assets_rejects_missing_explicit_whitelist(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            base_topology_path = root / "topology_primary.json"
            full_locales_path = root / "locales.json"
            full_geo_aliases_path = root / "geo_aliases.json"
            runtime_topology_path = root / "runtime_topology.topo.json"
            scenario_geo_patch_path = root / "geo_locale_patch.json"
            startup_locales_output_path = root / "locales.startup.json"
            startup_geo_aliases_output_path = root / "geo_aliases.startup.json"
            missing_whitelist_path = root / "derived" / "startup_support_whitelist.json"

            _write_json(base_topology_path, {"type": "Topology", "objects": {}, "arcs": []})
            _write_json(full_locales_path, {"ui": {}, "geo": {}})
            _write_json(full_geo_aliases_path, {"alias_to_stable_key": {}})
            _write_json(runtime_topology_path, {"type": "Topology", "objects": {}, "arcs": []})
            _write_json(scenario_geo_patch_path, {"scenario_id": "tno_1962", "geo": {}})

            with self.assertRaises(FileNotFoundError):
                build_startup_bootstrap_assets.build_startup_support_assets(
                    base_topology_path=base_topology_path,
                    full_locales_path=full_locales_path,
                    full_geo_aliases_path=full_geo_aliases_path,
                    full_runtime_topology_path=runtime_topology_path,
                    scenario_geo_patch_path=scenario_geo_patch_path,
                    startup_locales_output_path=startup_locales_output_path,
                    startup_geo_aliases_output_path=startup_geo_aliases_output_path,
                    startup_support_whitelist_path=missing_whitelist_path,
                )

    def test_generate_startup_support_whitelist_builds_candidate_sets(self) -> None:
        runtime_tmp_root = generate_startup_support_whitelist.ROOT / ".runtime" / "tmp"
        runtime_tmp_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=runtime_tmp_root) as tmp_dir:
            root = Path(tmp_dir)
            usage_report_path = root / "usage.json"
            startup_locales_path = root / "locales.startup.json"
            startup_geo_aliases_path = root / "geo_aliases.startup.json"
            full_locales_path = root / "locales.json"
            full_geo_aliases_path = root / "geo_aliases.json"
            support_audit_path = root / "startup_support_audit.json"
            output_path = root / "startup_support_whitelist.json"

            _write_json(
                usage_report_path,
                {
                    "version": 1,
                    "scenario_id": "tno_1962",
                    "source": "startup-bundle",
                    "usage": {
                        "language": "en",
                        "queryKeys": ["Alpha", "Beta", "Gamma"],
                        "directLocaleKeys": ["id::AAA-1", "id::BBB-1"],
                        "aliasKeys": ["Alpha", "Beta"],
                        "aliasTargetKeys": ["id::AAA-1", "id::BBB-1"],
                        "missKeys": ["Gamma"],
                    },
                },
            )
            _write_json(
                startup_locales_path,
                {
                    "ui": {},
                    "geo": {
                        "id::AAA-1": {"en": "Alpha"},
                    },
                },
            )
            _write_json(
                startup_geo_aliases_path,
                {
                    "alias_to_stable_key": {
                        "Alpha": "id::AAA-1",
                    }
                },
            )
            _write_json(
                full_locales_path,
                {
                    "ui": {},
                    "geo": {
                        "id::AAA-1": {"en": "Alpha"},
                        "id::BBB-1": {"en": "Beta"},
                    },
                },
            )
            _write_json(
                full_geo_aliases_path,
                {
                    "alias_to_stable_key": {
                        "Alpha": "id::AAA-1",
                        "Beta": "id::BBB-1",
                    }
                },
            )
            _write_json(
                support_audit_path,
                {
                    "required_geo_key_sources": {"combined": 2},
                    "startup_locales": {"geo_key_count_after": 2},
                    "startup_geo_aliases": {"alias_count_after": 2},
                },
            )

            result = generate_startup_support_whitelist.generate_startup_support_whitelist(
                scenario_id="tno_1962",
                usage_report_paths=[usage_report_path],
                startup_locales_path=startup_locales_path,
                startup_geo_aliases_path=startup_geo_aliases_path,
                full_locales_path=full_locales_path,
                full_geo_aliases_path=full_geo_aliases_path,
                support_audit_report_path=support_audit_path,
                output_path=output_path,
            )

            self.assertEqual(result["coverage"]["candidate_locale_key_count"], 2)
            self.assertEqual(result["coverage"]["candidate_alias_key_count"], 2)
            self.assertEqual(result["coverage"]["full_locale_geo_total"], 2)
            self.assertEqual(result["coverage"]["startup_locale_geo_total"], 1)
            self.assertEqual(result["candidates"]["locale_keys"], ["id::AAA-1", "id::BBB-1"])
            self.assertEqual(result["candidates"]["alias_keys"], ["Alpha", "Beta"])
            self.assertEqual(result["unresolved"]["miss_keys"], ["Gamma"])
            self.assertEqual(
                result["inputs"]["startup_locales_path"],
                startup_locales_path.resolve().relative_to(generate_startup_support_whitelist.ROOT).as_posix(),
            )
            self.assertEqual(
                result["inputs"]["full_locales_path"],
                full_locales_path.resolve().relative_to(generate_startup_support_whitelist.ROOT).as_posix(),
            )
            self.assertTrue(output_path.exists())

    def test_generate_startup_support_whitelist_can_merge_existing_whitelist_without_pruning(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            usage_report_path = root / "usage.json"
            startup_locales_path = root / "locales.startup.json"
            startup_geo_aliases_path = root / "geo_aliases.startup.json"
            full_locales_path = root / "locales.json"
            full_geo_aliases_path = root / "geo_aliases.json"
            baseline_whitelist_path = root / "baseline_whitelist.json"

            _write_json(
                usage_report_path,
                {
                    "version": 1,
                    "scenario_id": "tno_1962",
                    "source": "sampling-harness",
                    "usage": {
                        "language": "en",
                        "queryKeys": ["Existing", "Recovered"],
                        "directLocaleKeys": ["Recovered"],
                        "aliasKeys": ["Recovered Alias"],
                        "aliasTargetKeys": ["Recovered"],
                        "missKeys": [],
                    },
                },
            )
            _write_json(
                startup_locales_path,
                {"ui": {}, "geo": {"Existing": {"en": "Existing"}}},
            )
            _write_json(
                startup_geo_aliases_path,
                {"alias_to_stable_key": {"Existing Alias": "Existing"}},
            )
            _write_json(
                full_locales_path,
                {"ui": {}, "geo": {"Existing": {"en": "Existing"}, "Recovered": {"en": "Recovered"}}},
            )
            _write_json(
                full_geo_aliases_path,
                {"alias_to_stable_key": {"Existing Alias": "Existing", "Recovered Alias": "Recovered"}},
            )
            _write_json(
                baseline_whitelist_path,
                {"locale_keys": ["Existing"], "alias_keys": ["Existing Alias"]},
            )

            result = generate_startup_support_whitelist.generate_startup_support_whitelist(
                scenario_id="tno_1962",
                usage_report_paths=[usage_report_path],
                startup_locales_path=startup_locales_path,
                startup_geo_aliases_path=startup_geo_aliases_path,
                full_locales_path=full_locales_path,
                full_geo_aliases_path=full_geo_aliases_path,
                baseline_whitelist_path=baseline_whitelist_path,
            )

            self.assertEqual(result["candidates"]["locale_keys"], ["Existing", "Recovered"])
            self.assertEqual(result["candidates"]["alias_keys"], ["Existing Alias", "Recovered Alias"])
            self.assertEqual(result["coverage"]["baseline_locale_key_count"], 1)
            self.assertEqual(result["coverage"]["baseline_alias_key_count"], 1)
            self.assertEqual(result["coverage"]["added_locale_key_count"], 1)
            self.assertEqual(result["coverage"]["added_alias_key_count"], 1)

    def test_materialize_startup_support_candidate_writes_shadow_payloads(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            whitelist_path = root / "whitelist.json"
            startup_locales_path = root / "locales.startup.json"
            startup_geo_aliases_path = root / "geo_aliases.startup.json"
            output_locales_path = root / "candidate.locales.startup.json"
            output_aliases_path = root / "candidate.geo_aliases.startup.json"
            summary_path = root / "candidate.summary.json"

            _write_json(
                whitelist_path,
                {
                    "candidates": {
                        "locale_keys": ["id::AAA-1", "Belize"],
                        "alias_keys": ["Belize (BZ)"],
                    }
                },
            )
            _write_json(
                startup_locales_path,
                {
                    "ui": {"hello": {"en": "Hello"}},
                    "geo": {
                        "id::AAA-1": {"en": "Alpha"},
                        "Belize": {"en": "Belize"},
                        "Other": {"en": "Other"},
                    },
                },
            )
            _write_json(
                startup_geo_aliases_path,
                {
                    "alias_to_stable_key": {
                        "Belize (BZ)": "id::AAA-1",
                        "Other (OT)": "id::OTHER",
                    }
                },
            )

            result = materialize_startup_support_candidate.materialize_startup_support_candidate(
                whitelist_path=whitelist_path,
                startup_locales_path=startup_locales_path,
                startup_geo_aliases_path=startup_geo_aliases_path,
                output_locales_path=output_locales_path,
                output_aliases_path=output_aliases_path,
                summary_path=summary_path,
            )

            candidate_locales = json.loads(output_locales_path.read_text(encoding="utf-8"))
            candidate_aliases = json.loads(output_aliases_path.read_text(encoding="utf-8"))
            self.assertEqual(sorted(candidate_locales["geo"].keys()), ["Belize", "id::AAA-1"])
            self.assertEqual(candidate_aliases["alias_to_stable_key"], {"Belize (BZ)": "id::AAA-1"})
            self.assertEqual(result["locale_keys_after"], 2)
            self.assertEqual(result["alias_keys_after"], 1)
            self.assertTrue(summary_path.exists())


if __name__ == "__main__":
    unittest.main()
