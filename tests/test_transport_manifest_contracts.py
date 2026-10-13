from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any

from map_builder.transport_carrier_registry import (
    CARRIER_EXTENSION_METADATA,
    CARRIER_RUNTIME_ASSETS,
    CARRIER_SOURCE_KIND_BY_ASSET_KEY,
    PACK_CARRIER_ASSET_KEYS,
    resolve_pack_carrier_extension,
)
from map_builder.transport_country_real_source_contracts import TARGET_COUNTRY_PACK_IDS
from map_builder.transport_workbench_contracts import validate_transport_manifest
from tools.check_transport_workbench_manifests import discover_manifest_paths, inspect_transport_manifests


PROJECT_ROOT = Path(__file__).resolve().parents[1]
PORT_BUILDER = PROJECT_ROOT / "tools" / "build_transport_workbench_japan_ports.py"
INDUSTRIAL_BUILDER = PROJECT_ROOT / "tools" / "build_transport_workbench_japan_industrial_zones.py"
RUNTIME_ASSET_REGISTRY = PROJECT_ROOT / "data" / "runtime_asset_registry.json"
CATALOG_JSON = PROJECT_ROOT / "data" / "CATALOG.json"


class TransportDependencyBoundaryTests(unittest.TestCase):
    def test_read_only_validator_does_not_import_geospatial_writers(self):
        script = """
import importlib.abc
import sys
class RefuseGeospatialImports(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split('.')[0] in {'geopandas', 'numpy', 'rasterio', 'shapely', 'pandas'}:
            raise AssertionError(f'Read-only transport validator imported {fullname}')
sys.meta_path.insert(0, RefuseGeospatialImports())
import tools.check_transport_workbench_manifests
"""
        result = subprocess.run([sys.executable, "-c", script], cwd=PROJECT_ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


def _minimal_transport_manifest() -> dict[str, Any]:
    return {
        "adapter_id": "road_v1",
        "family": "road",
        "geometry_kind": "line",
        "generated_at": "2026-05-07T00:00:00Z",
        "recipe_version": "v1",
        "feature_counts": {"preview": {"roads": 1}, "full": {"roads": 1}},
        "source_policy": "local_source_cache_only",
        "distribution_tier": "single_pack",
        "paths": {"preview": {"roads": "preview.topo.json"}},
        "default_variant": "default",
        "variants": {
            "default": {
                "distribution_tier": "single_pack",
                "paths": {"preview": {"roads": "preview.topo.json"}},
                "feature_counts": {"preview": {"roads": 1}},
            }
        },
    }


PHASE_B_BRIDGE_KEYS_BY_PACK = {
    "japan_road": ["roads", "road_labels"],
    "japan_rail": ["railways", "rail_stations_major"],
    "germany_road": ["roads", "road_labels"],
    "uk_road": ["roads", "road_labels"],
    "usa_road": ["roads", "road_labels"],
    "france_road": ["roads", "road_labels"],
    "china_road": ["roads", "road_labels"],
    "india_road": ["roads", "road_labels"],
    "russia_road": ["roads", "road_labels"],
    "france_rail": ["railways", "rail_stations_major"],
    "germany_rail": ["railways", "rail_stations_major"],
    "uk_rail": ["railways", "rail_stations_major"],
    "usa_rail": ["railways", "rail_stations_major"],
    "china_rail": ["railways", "rail_stations_major"],
    "india_rail": ["railways", "rail_stations_major"],
    "russia_rail": ["railways", "rail_stations_major"],
    "usa_airport": ["airports"],
    "china_airport": ["airports"],
    "russia_airport": ["airports"],
    "india_airport": ["airports"],
    "germany_airport": ["airports"],
    "france_airport": ["airports"],
    "uk_airport": ["airports"],
    "usa_port": ["ports"],
    "germany_port": ["ports"],
    "france_port": ["ports"],
    "uk_port": ["ports"],
    "china_port": ["ports"],
    "india_port": ["ports"],
    "russia_port": ["ports"],
}

PHASE_B_BRIDGE_SOURCE_POLICY_BY_PACK = {
    "japan_road": "local_source_cache_only",
    "japan_rail": "local_source_cache_only",
    "germany_road": "real_source_cache_only",
    "uk_road": "real_source_cache_only",
    "usa_road": "real_source_cache_only",
    "france_road": "real_source_cache_only",
    "china_road": "real_source_cache_only",
    "india_road": "real_source_cache_only",
    "russia_road": "real_source_cache_only",
    "france_rail": "real_source_cache_only",
    "germany_rail": "real_source_cache_only",
    "uk_rail": "real_source_cache_only",
    "usa_rail": "real_source_cache_only",
    "china_rail": "real_source_cache_only",
    "india_rail": "real_source_cache_only",
    "russia_rail": "real_source_cache_only",
    "usa_airport": "real_source_cache_only",
    "china_airport": "real_source_cache_only",
    "russia_airport": "real_source_cache_only",
    "india_airport": "real_source_cache_only",
    "germany_airport": "real_source_cache_only",
    "france_airport": "real_source_cache_only",
    "uk_airport": "real_source_cache_only",
    "usa_port": "real_source_cache_only",
    "germany_port": "real_source_cache_only",
    "france_port": "real_source_cache_only",
    "uk_port": "real_source_cache_only",
    "china_port": "real_source_cache_only",
    "india_port": "real_source_cache_only",
    "russia_port": "real_source_cache_only",
}


class TransportManifestContractsTest(unittest.TestCase):
    def test_checked_in_transport_manifests_pass_shared_contract(self) -> None:
        manifest_paths = discover_manifest_paths(PROJECT_ROOT / "data" / "transport_layers")
        reports = inspect_transport_manifests(manifest_paths)
        failed = [report for report in reports if report.get("status") != "ok"]
        self.assertFalse(failed, failed)


    def test_target_main_map_packs_declare_phase_b_bridge_contract(self) -> None:
        failures: list[str] = []
        for pack_id, expected_keys in PHASE_B_BRIDGE_KEYS_BY_PACK.items():
            manifest_path = PROJECT_ROOT / "data" / "transport_layers" / pack_id / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            if manifest.get("pack_id") != pack_id:
                failures.append(f"{pack_id}: pack_id")
            if manifest.get("mainMapEligible") is not True:
                failures.append(f"{pack_id}: mainMapEligible")
            if manifest.get("apply_bridge_supported") is not True:
                failures.append(f"{pack_id}: apply_bridge_supported")
            if manifest.get("coverage_scope") != "country":
                failures.append(f"{pack_id}: coverage_scope")
            if manifest.get("source_policy") != PHASE_B_BRIDGE_SOURCE_POLICY_BY_PACK[pack_id]:
                failures.append(f"{pack_id}: source_policy")
            if not manifest.get("source_signature"):
                failures.append(f"{pack_id}: source_signature")
            consumer = manifest.get("main_map_consumer") or {}
            if consumer.get("supported_keys") != expected_keys:
                failures.append(f"{pack_id}: supported_keys")
            for key in expected_keys:
                if key not in manifest.get("paths", {}).get("preview", {}) or key not in manifest.get("paths", {}).get("full", {}):
                    failures.append(f"{pack_id}: paths:{key}")
            if "road_labels" in expected_keys and manifest.get("sidecars", {}).get("road_labels", {}).get("required") is not True:
                failures.append(f"{pack_id}: sidecar:road_labels")
            if "rail_stations_major" in expected_keys and manifest.get("sidecars", {}).get("rail_stations_major", {}).get("required") is not True:
                failures.append(f"{pack_id}: sidecar:rail_stations_major")

        self.assertFalse(failures, failures)

    def test_main_map_point_packs_include_visible_importance_ranks(self) -> None:
        point_layers_by_pack = {
            "global_airport": "airports",
            "usa_airport": "airports",
            "china_airport": "airports",
            "russia_airport": "airports",
            "india_airport": "airports",
            "germany_airport": "airports",
            "france_airport": "airports",
            "uk_airport": "airports",
            "global_port": "ports",
            "usa_port": "ports",
            "germany_port": "ports",
            "france_port": "ports",
            "uk_port": "ports",
            "china_port": "ports",
            "india_port": "ports",
            "russia_port": "ports",
        }
        failures: list[str] = []
        airport_types = {"company_managed", "national", "specific_local", "local", "other", "shared"}
        airport_statuses = {"active", "paused", "unknown"}
        port_designations = {"international_strategy", "international_hub", "important", "local", "shelter"}
        port_manager_types = {"1", "2", "3", "4", "5"}
        for pack_id, layer_key in point_layers_by_pack.items():
            manifest_path = PROJECT_ROOT / "data" / "transport_layers" / pack_id / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            for phase in ("preview", "full"):
                layer_path = PROJECT_ROOT / manifest["paths"][phase][layer_key]
                payload = json.loads(layer_path.read_text(encoding="utf-8"))
                features = payload.get("features") or []
                bad_ranks = [
                    feature.get("properties", {}).get("id", index)
                    for index, feature in enumerate(features)
                    if not isinstance(feature.get("properties", {}).get("importance_rank"), (int, float))
                    or not 1 <= int(feature.get("properties", {}).get("importance_rank")) <= 3
                ]
                if bad_ranks:
                    failures.append(f"{pack_id}:{phase}:{layer_key}:bad_importance_rank:{bad_ranks[:5]}")
                if phase == "preview" and not any(int(feature.get("properties", {}).get("importance_rank", 0)) >= 2 for feature in features):
                    failures.append(f"{pack_id}:{phase}:{layer_key}:no_default_visible_features")
                if layer_key == "airports":
                    bad_airport_contract = [
                        feature.get("properties", {}).get("id", index)
                        for index, feature in enumerate(features)
                        if feature.get("properties", {}).get("airport_type") not in airport_types
                        or feature.get("properties", {}).get("status_category") not in airport_statuses
                    ]
                    if bad_airport_contract:
                        failures.append(f"{pack_id}:{phase}:{layer_key}:bad_workbench_airport_filters:{bad_airport_contract[:5]}")
                if layer_key == "ports":
                    bad_port_contract = [
                        feature.get("properties", {}).get("id", index)
                        for index, feature in enumerate(features)
                        if feature.get("properties", {}).get("legal_designation") not in port_designations
                        or str(feature.get("properties", {}).get("manager_type_code", "")) not in port_manager_types
                    ]
                    if bad_port_contract:
                        failures.append(f"{pack_id}:{phase}:{layer_key}:bad_workbench_port_filters:{bad_port_contract[:5]}")

        self.assertFalse(failures, failures)

    def test_recursive_manifest_discovery_includes_rail_region_shards(self) -> None:
        manifest_paths = discover_manifest_paths(PROJECT_ROOT / "data" / "transport_layers")
        normalized_paths = [str(path.relative_to(PROJECT_ROOT)).replace("\\", "/") for path in manifest_paths]
        self.assertTrue(
            any(path.startswith("data/transport_layers/global_rail/regions/") for path in normalized_paths),
            normalized_paths,
        )

    def test_validator_rejects_legacy_variant_fields(self) -> None:
        manifest = {
            "adapter_id": "japan_port_v1",
            "family": "port",
            "geometry_kind": "point",
            "generated_at": "2026-04-03T00:00:00Z",
            "recipe_version": "v1",
            "feature_counts": {"preview": {"ports": 1}, "full": {"ports": 1}},
            "source_policy": "local_source_cache_only",
            "distribution_tier": "coverage_tiered",
            "paths": {"preview": {"ports": "preview.geojson"}, "full": {"ports": "full.geojson"}},
            "default_variant": "expanded",
            "variants": {
                "core": {
                    "distribution_tier": "curated_core",
                    "paths": {"preview": {"ports": "preview.geojson"}, "full": {"ports": "full.geojson"}},
                    "feature_counts": {"preview": {"ports": 1}, "full": {"ports": 1}},
                }
            },
            "default_coverage_tier": "core",
            "coverage_variants": {
                "core": {
                    "distribution_tier": "curated_core",
                    "paths": {"preview": {"ports": "preview.geojson"}, "full": {"ports": "full.geojson"}},
                    "feature_counts": {"preview": {"ports": 1}, "full": {"ports": 1}},
                }
            },
        }

        errors = validate_transport_manifest(manifest, source_label="port-manifest")

        self.assertTrue(
            any("legacy transport variant field" in error for error in errors),
            errors,
        )

    def test_validator_rejects_empty_feature_counts_for_feature_manifests(self) -> None:
        manifest = {
            "adapter_id": "empty_point_v1",
            "family": "road",
            "geometry_kind": "line",
            "generated_at": "2026-05-07T00:00:00Z",
            "recipe_version": "v1",
            "feature_counts": {},
            "source_policy": "local_source_cache_only",
            "distribution_tier": "single_pack",
            "paths": {"preview": {"roads": "preview.topo.json"}},
            "default_variant": "default",
            "variants": {
                "default": {
                    "distribution_tier": "single_pack",
                    "paths": {"preview": {"roads": "preview.topo.json"}},
                    "feature_counts": {},
                }
            },
        }

        errors = validate_transport_manifest(manifest, source_label="road-manifest")

        self.assertTrue(any("feature_counts" in error for error in errors), errors)

    def test_validator_rejects_boolean_feature_counts(self) -> None:
        manifest = {
            "adapter_id": "boolean_count_v1",
            "family": "road",
            "geometry_kind": "line",
            "generated_at": "2026-05-11T00:00:00Z",
            "recipe_version": "v1",
            "feature_counts": {"preview": {"roads": True}},
            "source_policy": "local_source_cache_only",
            "distribution_tier": "single_pack",
            "paths": {"preview": {"roads": "preview.topo.json"}},
            "default_variant": "default",
            "variants": {
                "default": {
                    "distribution_tier": "single_pack",
                    "paths": {"preview": {"roads": "preview.topo.json"}},
                    "feature_counts": {"preview": {"roads": False}},
                }
            },
        }

        errors = validate_transport_manifest(manifest, source_label="road-manifest")

        self.assertTrue(any("feature_counts" in error for error in errors), errors)

    def test_validator_reports_schema_missing_required_field(self) -> None:
        manifest = _minimal_transport_manifest()
        del manifest["adapter_id"]

        errors = validate_transport_manifest(manifest, source_label="road-manifest")

        self.assertTrue(any("road-manifest" in error and "adapter_id" in error for error in errors), errors)

    def test_validator_reports_schema_type_error(self) -> None:
        manifest = _minimal_transport_manifest()
        manifest["paths"] = "preview.topo.json"

        errors = validate_transport_manifest(manifest, source_label="road-manifest")

        self.assertTrue(any("$.paths" in error for error in errors), errors)

    def test_validator_rejects_empty_paths_object(self) -> None:
        manifest = _minimal_transport_manifest()
        manifest["paths"] = {}

        errors = validate_transport_manifest(manifest, source_label="road-manifest")

        self.assertTrue(any("$.paths" in error for error in errors), errors)

    def test_validator_rejects_carrier_family_without_carrier_geometry_kind(self) -> None:
        manifest = {
            "adapter_id": "bad_carrier_v1",
            "family": "carrier",
            "geometry_kind": "line",
            "generated_at": "2026-05-11T00:00:00Z",
            "recipe_version": "v1",
            "feature_counts": {},
            "source_policy": "local_source_cache_only",
            "distribution_tier": "single_pack",
            "paths": {"carrier": "carrier.json", "provenance": "provenance.json"},
            "default_variant": "default",
            "variants": {
                "default": {
                    "distribution_tier": "single_pack",
                    "paths": {"carrier": "carrier.json"},
                    "feature_counts": {},
                }
            },
        }

        errors = validate_transport_manifest(manifest, source_label="carrier-manifest")

        self.assertTrue(any("carrier family requires geometry_kind" in error for error in errors), errors)
        self.assertTrue(any("feature_counts" in error for error in errors), errors)

    def test_checked_in_transport_manifests_do_not_keep_legacy_variant_fields(self) -> None:
        manifest_paths = discover_manifest_paths(PROJECT_ROOT / "data" / "transport_layers")
        legacy_fields = {
            "default_coverage_tier",
            "coverage_variants",
            "default_distribution_variant",
            "distribution_variants",
        }
        offenders: list[tuple[str, list[str]]] = []
        for path in manifest_paths:
            manifest = json.loads(path.read_text(encoding="utf-8"))
            present = sorted(field for field in legacy_fields if field in manifest)
            if present:
                offenders.append((str(path.relative_to(PROJECT_ROOT)).replace("\\", "/"), present))

        self.assertFalse(offenders, offenders)

    def test_transport_builders_no_longer_emit_legacy_variant_fields(self) -> None:
        legacy_field_names = (
            "default_coverage_tier",
            "coverage_variants",
            "default_distribution_variant",
            "distribution_variants",
        )

        for builder_path in (PORT_BUILDER, INDUSTRIAL_BUILDER):
            content = builder_path.read_text(encoding="utf-8")
            for field_name in legacy_field_names:
                self.assertNotIn(f'"{field_name}"', content, builder_path.as_posix())

    def test_target_pack_manifests_declare_registered_carrier_asset_key(self) -> None:
        runtime_asset_registry = json.loads(RUNTIME_ASSET_REGISTRY.read_text(encoding="utf-8"))
        runtime_assets = runtime_asset_registry.get("assets") or {}
        failures: list[str] = []
        target_pack_ids = set(TARGET_COUNTRY_PACK_IDS)
        missing_registry_pack_ids = sorted(target_pack_ids - set(PACK_CARRIER_ASSET_KEYS))
        if missing_registry_pack_ids:
            failures.append(f"missing carrier registry entries: {missing_registry_pack_ids}")
        for pack_id, expected_asset_key in sorted(PACK_CARRIER_ASSET_KEYS.items()):
            manifest_path = PROJECT_ROOT / "data" / "transport_layers" / pack_id / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            carrier_extension = manifest.get("extensions", {}).get("carrier", {})
            if manifest.get("carrier_asset_key") != expected_asset_key:
                failures.append(f"{pack_id}: carrier_asset_key")
            if carrier_extension.get("carrier_asset_key") != expected_asset_key:
                failures.append(f"{pack_id}: extensions.carrier.carrier_asset_key")
            expected_extension = resolve_pack_carrier_extension(pack_id)
            for field_name, expected_value in expected_extension.items():
                if field_name == "carrier_asset_key":
                    continue
                if carrier_extension.get(field_name) != expected_value:
                    failures.append(f"{pack_id}: extensions.carrier.{field_name}")
            if expected_asset_key not in runtime_assets:
                failures.append(f"{pack_id}: runtime asset {expected_asset_key}")

        self.assertFalse(failures, failures)

    def test_russia_carrier_keeps_kaliningrad_and_excludes_foreign_admin_codes(self) -> None:
        provenance_path = PROJECT_ROOT / "data" / "transport_layers" / "russia_carrier" / "provenance.json"
        provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
        codes = provenance["frames"]["main"]["prefectureCodes"]
        foreign_codes = [code for code in codes if not str(code).startswith("RU-")]

        self.assertIn("RU-KGD", codes)
        self.assertFalse(foreign_codes, foreign_codes)

    def test_carrier_manifest_is_valid_under_shared_contract(self) -> None:
        manifest_paths = [PROJECT_ROOT / "data" / "transport_layers" / "japan_corridor" / "manifest.json"]
        manifest_paths.extend(sorted((PROJECT_ROOT / "data" / "transport_layers").glob("*_carrier/manifest.json")))
        failures: list[str] = []
        for manifest_path in manifest_paths:
            carrier_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            errors = validate_transport_manifest(carrier_manifest, source_label=manifest_path.as_posix())
            if errors:
                failures.extend(errors)
        self.assertFalse(failures, failures)

    def test_carrier_manifests_declare_runtime_asset_key(self) -> None:
        # 同时锁 manifest extension 和 runtime asset registry，避免只改一端导致 workbench 无法加载底图。
        runtime_asset_registry = json.loads(RUNTIME_ASSET_REGISTRY.read_text(encoding="utf-8"))
        runtime_assets = runtime_asset_registry.get("assets") or {}
        expected_asset_keys = {
            "japan_corridor": "transport_carrier:japan_corridor",
            **{
                Path(url).parent.name: asset_key
                for asset_key, url in CARRIER_RUNTIME_ASSETS.items()
            },
        }
        failures: list[str] = []
        for carrier_dir, expected_asset_key in sorted(expected_asset_keys.items()):
            manifest_path = PROJECT_ROOT / "data" / "transport_layers" / carrier_dir / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            carrier_extension = manifest.get("extensions", {}).get("carrier", {})
            if carrier_extension.get("carrier_asset_key") != expected_asset_key:
                failures.append(f"{carrier_dir}: extensions.carrier.carrier_asset_key")
            if carrier_extension.get("carrier_source_kind") != CARRIER_SOURCE_KIND_BY_ASSET_KEY[expected_asset_key]:
                failures.append(f"{carrier_dir}: extensions.carrier.carrier_source_kind")
            expected_extension = CARRIER_EXTENSION_METADATA[expected_asset_key]
            for field_name, expected_value in expected_extension.items():
                if carrier_extension.get(field_name) != expected_value:
                    failures.append(f"{carrier_dir}: extensions.carrier.{field_name}")
            if expected_asset_key not in runtime_assets:
                failures.append(f"{carrier_dir}: runtime asset {expected_asset_key}")

        self.assertFalse(failures, failures)

    def test_carrier_runtime_asset_key_and_catalog_key_share_the_same_url(self) -> None:
        # runtime asset key 与 catalog key 指向同一 carrier.json，保证 UI 预览和数据目录读取同一份底图。
        runtime_asset_registry = json.loads(RUNTIME_ASSET_REGISTRY.read_text(encoding="utf-8"))
        catalog_payload = json.loads(CATALOG_JSON.read_text(encoding="utf-8"))
        catalog_entries = {entry["key"]: entry for entry in catalog_payload.get("entries") or []}
        expected_urls = {
            "transport_carrier:japan_corridor": "data/transport_layers/japan_corridor/carrier.json",
            **CARRIER_RUNTIME_ASSETS,
        }
        failures: list[str] = []
        for asset_key, expected_url in sorted(expected_urls.items()):
            runtime_entry = runtime_asset_registry.get("assets", {}).get(asset_key) or {}
            if runtime_entry.get("url") != expected_url:
                failures.append(f"{asset_key}:runtime_url:{runtime_entry.get('url')}")
            catalog_namespace = Path(expected_url).parent.name
            catalog_key = f"transport:{catalog_namespace}:carrier"
            catalog_entry = catalog_entries.get(catalog_key) or {}
            if catalog_entry.get("url") != expected_url:
                failures.append(f"{asset_key}:catalog_url:{catalog_entry.get('url')}")
            if catalog_entry.get("role") != "transport_carrier_payload":
                failures.append(f"{asset_key}:catalog_role:{catalog_entry.get('role')}")

        self.assertFalse(failures, failures)
