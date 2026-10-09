from __future__ import annotations

import hashlib
import json
import unittest
from pathlib import Path

from map_builder.runtime_asset_registry import _validate_runtime_asset_registry
from tools.build_data_catalog import validate_catalog_entry_contract


REPO_ROOT = Path(__file__).resolve().parents[1]
CANONICAL_LF_MANIFEST_OUTPUTS = {
    "js/core/city_lights_modern_asset.js",
    "js/core/city_lights_historical_1930_asset.js",
}


def _canonical_manifest_bytes(relative_path: str, output_bytes: bytes) -> bytes:
    if relative_path in CANONICAL_LF_MANIFEST_OUTPUTS:
        return output_bytes.replace(b"\r\n", b"\n").replace(b"\r", b"\n")
    return output_bytes


DATA_MANIFEST = REPO_ROOT / "data" / "manifest.json"
DATA_LOADER = REPO_ROOT / "js" / "core" / "data_loader.js"
RUNTIME_ASSET_REGISTRY_SOURCE = REPO_ROOT / "data" / "runtime_asset_registry.json"
RUNTIME_ASSET_REGISTRY_JS = REPO_ROOT / "js" / "core" / "runtime_asset_registry.js"
HISTORICAL_1930_CITY_LIGHTS_ASSET = REPO_ROOT / "js" / "core" / "city_lights_historical_1930_asset.js"
HISTORICAL_1930_CITY_LIGHTS_ENTRIES = REPO_ROOT / "data" / "city_lights" / "historical_1930_entries.json"


def _resolve_manifest_output_path(relative_path: str) -> Path:
    if relative_path.startswith("js/"):
        return REPO_ROOT / relative_path
    return REPO_ROOT / "data" / relative_path


def _resolve_runtime_asset_path(relative_path: str) -> Path:
    if relative_path.startswith(("data/", "js/")):
        return REPO_ROOT / relative_path
    return REPO_ROOT / "data" / relative_path




class DataManifestContractTest(unittest.TestCase):
    def test_manifest_output_hashes_match_checked_in_artifacts(self) -> None:
        manifest = json.loads(DATA_MANIFEST.read_text(encoding="utf-8"))
        mismatches: list[str] = []

        for relative_path, metadata in manifest["outputs"].items():
            output_path = _resolve_manifest_output_path(relative_path)
            if not output_path.is_file():
                mismatches.append(f"{relative_path}: missing")
                continue
            output_bytes = _canonical_manifest_bytes(relative_path, output_path.read_bytes())
            actual_size = len(output_bytes)
            actual_sha = hashlib.sha256(output_bytes).hexdigest()
            if metadata.get("size_bytes") != actual_size or metadata.get("sha256") != actual_sha:
                mismatches.append(f"{relative_path}: size/hash drift")

        self.assertEqual(mismatches, [])

    def test_runtime_asset_registry_manifest_hash_matches_source_file(self) -> None:
        manifest = json.loads(DATA_MANIFEST.read_text(encoding="utf-8"))
        metadata = manifest.get("outputs", {}).get("runtime_asset_registry.json") or {}
        output_bytes = RUNTIME_ASSET_REGISTRY_SOURCE.read_bytes()

        self.assertEqual(metadata.get("size_bytes"), RUNTIME_ASSET_REGISTRY_SOURCE.stat().st_size)
        self.assertEqual(metadata.get("sha256"), hashlib.sha256(output_bytes).hexdigest())

    def test_manifest_outputs_include_wgi_state_capacity_assets(self) -> None:
        manifest = json.loads(DATA_MANIFEST.read_text(encoding="utf-8"))
        outputs = manifest.get("outputs") or {}
        expected = {
            "thematic_layers/political/wgi_state_capacity_v1/manifest.json": "schema://thematic/layer_manifest/v1",
            "thematic_layers/political/wgi_state_capacity_v1/metrics.admin0.json": "schema://thematic/admin_metrics/v1",
            "thematic_layers/political/wgi_state_capacity_v1/build_audit.json": "schema://thematic/build_audit/v1",
            "thematic_layers/source_recipes/wgi_state_capacity_v1.manual.json": "",
        }

        for relative_path, schema_ref in expected.items():
            with self.subTest(relative_path=relative_path):
                metadata = outputs.get(relative_path) or {}
                output_path = REPO_ROOT / "data" / relative_path
                self.assertTrue(output_path.is_file())
                self.assertEqual(metadata.get("role", "").startswith("thematic_"), True)
                if schema_ref:
                    self.assertEqual(metadata.get("schema_ref"), schema_ref)
                self.assertEqual(metadata.get("size_bytes"), output_path.stat().st_size)
                self.assertEqual(metadata.get("sha256"), hashlib.sha256(output_path.read_bytes()).hexdigest())

        registry = manifest.get("runtime_asset_registry") or {}
        self.assertEqual(
            registry.get("thematic_layer_manifest_keys", {}).get("political_wgi_state_capacity_v1"),
            "thematic_layer:political_wgi_state_capacity_v1",
        )
        self.assertEqual(
            registry.get("assets", {}).get("thematic_layer:political_wgi_state_capacity_v1", {}).get("url"),
            "data/thematic_layers/political/wgi_state_capacity_v1/manifest.json",
        )

    def test_runtime_asset_registry_declares_phase1_assets(self) -> None:
        manifest = json.loads(DATA_MANIFEST.read_text(encoding="utf-8"))
        registry = manifest.get("runtime_asset_registry") or {}
        source_registry = json.loads(RUNTIME_ASSET_REGISTRY_SOURCE.read_text(encoding="utf-8"))
        assets = source_registry.get("assets") or {}
        mismatches: list[str] = []
        loader_source = DATA_LOADER.read_text(encoding="utf-8")
        registry_source = RUNTIME_ASSET_REGISTRY_JS.read_text(encoding="utf-8")

        self.assertEqual(registry, source_registry)
        self.assertIn('../../data/runtime_asset_registry.json', registry_source)
        self.assertIn('resolveDataAssetUrl', registry_source)
        self.assertIn('resolveScenarioRegistryUrl', registry_source)
        self.assertIn('resolveCountryFeaturePoliciesUrl', registry_source)
        self.assertIn('resolveTransportManifestUrl', registry_source)
        self.assertIn('./runtime_asset_registry.js', loader_source)
        self.assertEqual(
            assets.get("city_lights:historical_1930:entries", {}).get("url"),
            "data/city_lights/historical_1930_entries.json",
        )
        self.assertEqual(
            source_registry.get("city_lights", {}).get("historical_1930", {}).get("entries_key"),
            "city_lights:historical_1930:entries",
        )
        self.assertEqual(
            assets.get("country_feature_policies", {}).get("url"),
            "data/country_feature_policies.json",
        )
        self.assertEqual(source_registry.get("country_feature_policies_key"), "country_feature_policies")
        self.assertEqual(assets.get("world_cities", {}).get("url"), "data/world_cities.geojson")
        self.assertEqual(assets.get("locales", {}).get("url"), "data/locales.json")
        self.assertEqual(assets.get("geo_aliases", {}).get("url"), "data/geo_aliases.json")
        self.assertEqual(assets.get("context_layer:physical", {}).get("url"), "data/europe_physical.geojson")
        self.assertEqual(assets.get("transport_catalog:road", {}).get("url"), "data/transport_layers/global_road/catalog.json")
        self.assertEqual(assets.get("hgo_flags_png_manifest", {}).get("url"), "data/hgo_catalogs/hgo_flags.png_manifest.json")
        self.assertEqual(assets.get("hgo_identity_aliases", {}).get("url"), "data/hgo_catalogs/hgo_identity_aliases.json")
        self.assertNotIn("hgo_runtime_manifest", assets)
        self.assertNotIn("hgo_runtime_seed", assets)
        self.assertNotIn("hgo_runtime_provinces_bmp", assets)
        self.assertNotIn("hgo_flags_index", assets)
        self.assertIn('resolveDataAssetUrl("world_cities")', loader_source)
        self.assertIn('resolveDataAssetUrl("locales")', loader_source)
        self.assertIn('resolveDataAssetUrl("geo_aliases")', loader_source)
        self.assertIn('resolveDataAssetUrl("context_layer:physical")', loader_source)
        self.assertIn('resolveDataAssetUrl("transport_catalog:road")', loader_source)
        self.assertNotIn("topology:detail:highres", assets)
        self.assertNotIn("topology:detail:legacy_bak", assets)
        self.assertNotIn("topology:detail:na_v1", assets)
        self.assertNotIn("topology:detail:na_v2", assets)
        self.assertIn('highres: "data/europe_topology.highres.json"', loader_source)
        self.assertIn('legacy_bak: "data/europe_topology.json.bak"', loader_source)
        self.assertIn('na_v1: "data/europe_topology.na_v1.json"', loader_source)
        self.assertIn('na_v2: "data/europe_topology.na_v2.json"', loader_source)
        self.assertNotIn('const GLOBAL_ROAD_CATALOG_URL = "data/transport_layers/global_road/catalog.json";', loader_source)
        self.assertNotIn('localesUrl || "data/locales.json"', loader_source)
        self.assertNotIn('geoAliasesUrl || "data/geo_aliases.json"', loader_source)
        self.assertNotIn('const PALETTE_REGISTRY_URL = "data/palettes/index.json";', loader_source)

        for asset_key, metadata in assets.items():
            expected_url = metadata.get("url")
            actual_url = registry.get("assets", {}).get(asset_key, {}).get("url")
            if actual_url != expected_url:
                mismatches.append(f"{asset_key}: expected {expected_url}, got {actual_url}")
                continue
            if not _resolve_runtime_asset_path(expected_url).is_file():
                mismatches.append(f"{asset_key}: target missing at {expected_url}")

        self.assertEqual(mismatches, [])

    def test_runtime_asset_registry_schema_rejects_missing_assets(self) -> None:
        with self.assertRaises(ValueError) as context:
            _validate_runtime_asset_registry(
                {
                    "scenario_registry_key": "scenario_registry",
                    "transport_manifest_keys": {},
                }
            )

        self.assertIn("runtime_asset_registry", str(context.exception))
        self.assertIn("assets", str(context.exception))

    def test_runtime_asset_registry_schema_rejects_assets_type_error(self) -> None:
        with self.assertRaises(ValueError) as context:
            _validate_runtime_asset_registry(
                {
                    "assets": [],
                    "scenario_registry_key": "scenario_registry",
                    "transport_manifest_keys": {},
                }
            )

        self.assertIn("$.assets", str(context.exception))

    def test_runtime_asset_registry_business_rules_keep_cross_field_reference_errors(self) -> None:
        with self.assertRaises(ValueError) as context:
            _validate_runtime_asset_registry(
                {
                    "assets": {
                        "scenario_registry": {"url": "data/scenarios/index.json"},
                    },
                    "scenario_registry_key": "scenario_registry",
                    "transport_manifest_keys": {"road": "missing_asset"},
                }
            )

        self.assertIn(
            "runtime_asset_registry.transport_manifest_keys.road must reference an existing asset",
            str(context.exception),
        )

    def test_runtime_asset_registry_business_rules_keep_thematic_reference_errors(self) -> None:
        with self.assertRaises(ValueError) as context:
            _validate_runtime_asset_registry(
                {
                    "assets": {
                        "scenario_registry": {"url": "data/scenarios/index.json"},
                        "thematic_layer_catalog": {
                            "url": "data/thematic_layers/index.json",
                            "role": "thematic_layer_catalog",
                        },
                    },
                    "scenario_registry_key": "scenario_registry",
                    "transport_manifest_keys": {},
                    "thematic_layer_index_key": "thematic_layer_catalog",
                    "thematic_layer_manifest_keys": {"population_density_demo": "missing_asset"},
                }
            )

        self.assertIn(
            "runtime_asset_registry.thematic_layer_manifest_keys.population_density_demo must reference an existing asset",
            str(context.exception),
        )

    def test_runtime_asset_registry_business_rules_keep_thematic_role_errors(self) -> None:
        with self.assertRaises(ValueError) as context:
            _validate_runtime_asset_registry(
                {
                    "assets": {
                        "scenario_registry": {"url": "data/scenarios/index.json"},
                        "wrong_catalog_role": {
                            "url": "data/thematic_layers/index.json",
                            "role": "transport_manifest",
                        },
                    },
                    "scenario_registry_key": "scenario_registry",
                    "transport_manifest_keys": {},
                    "thematic_layer_index_key": "wrong_catalog_role",
                }
            )

        self.assertIn(
            "runtime_asset_registry.thematic_layer_index_key must reference an asset with role thematic_layer_catalog",
            str(context.exception),
        )

    def test_catalog_entry_contract_reports_missing_required_and_type_errors(self) -> None:
        missing_errors = validate_catalog_entry_contract(
            {
                "key": "runtime_asset_registry",
                "url": "data/runtime_asset_registry.json",
                "role": "runtime_asset",
                "format": "json",
                "owner": "test",
                "cachePolicy": "default",
                "readMode": "json",
            },
            source_label="catalog entry test",
        )
        self.assertTrue(any("schemaRef" in error for error in missing_errors), missing_errors)

        empty_errors = validate_catalog_entry_contract(
            {
                "key": "runtime_asset_registry",
                "url": "data/runtime_asset_registry.json",
                "role": "runtime_asset",
                "format": "json",
                "schemaRef": "",
                "owner": "test",
                "cachePolicy": "default",
                "readMode": "json",
            },
            source_label="catalog entry test",
        )
        self.assertTrue(any("$.schemaRef" in error for error in empty_errors), empty_errors)

        type_errors = validate_catalog_entry_contract(
            {
                "key": "runtime_asset_registry",
                "url": "data/runtime_asset_registry.json",
                "role": "runtime_asset",
                "format": "json",
                "schemaRef": "schema://json/object/v1",
                "owner": "test",
                "cachePolicy": "default",
                "readMode": "json",
                "aliases": "runtime_asset_registry",
            },
            source_label="catalog entry test",
        )
        self.assertTrue(any("$.aliases" in error for error in type_errors), type_errors)



    def test_historical_1930_city_lights_source_refs_are_repo_relative(self) -> None:
        asset_source = HISTORICAL_1930_CITY_LIGHTS_ASSET.read_text(encoding="utf-8")
        self.assertIn('sourceKey: "city_lights:historical_1930:source"', asset_source)
        self.assertIn('exclusionsKey: "city_lights:historical_1930:exclusions"', asset_source)
        self.assertIn('entriesKey: "city_lights:historical_1930:entries"', asset_source)
        self.assertIn('sourceRefParts: ["data", "world_cities.geojson"]', asset_source)
        self.assertIn('exclusionsRefParts: ["data", "historical_city_lights_1930_exclusions.json"]', asset_source)
        self.assertIn('entriesRefParts: ["data", "city_lights/historical_1930_entries.json"]', asset_source)
        self.assertIn('historical_1930_entries.json', asset_source)
        self.assertNotIn("population: 35676000", asset_source)
        self.assertNotIn("file:///", asset_source)
        self.assertNotIn("C:/", asset_source)

        entries_payload = json.loads(HISTORICAL_1930_CITY_LIGHTS_ENTRIES.read_text(encoding="utf-8"))
        self.assertEqual(entries_payload.get("asset_key"), "city_lights:historical_1930:entries")
        self.assertEqual(entries_payload.get("family_id"), "historical_1930")
        self.assertEqual(entries_payload.get("stats", {}).get("entryCount"), 1580)
        self.assertEqual(len(entries_payload.get("entries") or []), 1580)

    def test_topology_outputs_expose_schema_and_zoom_metadata(self) -> None:
        manifest = json.loads(DATA_MANIFEST.read_text(encoding="utf-8"))
        outputs = manifest.get("outputs") or {}
        expected = {
            "europe_topology.json": {
                "schema_ref": "schema://topology/political_bundle_v1",
                "simplification": "coarse_publish_v1",
                "target_zoom_range": [0.0, 1.7],
            },
            "europe_topology.na_v1.json": {
                "schema_ref": "schema://topology/detail_political_bundle_v1",
                "simplification": "detail_publish_legacy_v1",
                "target_zoom_range": [1.7, 20.0],
            },
            "europe_topology.na_v2.json": {
                "schema_ref": "schema://topology/detail_political_bundle_v2",
                "simplification": "detail_publish_v2",
                "target_zoom_range": [1.7, 20.0],
            },
            "europe_topology.runtime_political_v1.json": {
                "schema_ref": "schema://topology/runtime_political_v1",
                "simplification": "runtime_projection_v1",
                "target_zoom_range": [1.7, 20.0],
            },
            "global_physical_semantics.topo.json": {
                "schema_ref": "schema://topology/physical_semantics_v1",
                "simplification": "semantic_dissolve_v1",
                "target_zoom_range": [0.0, 20.0],
            },
            "global_contours.major.topo.json": {
                "schema_ref": "schema://topology/terrain_contours_major_v1",
                "simplification": "contour_major_publish_v1",
                "target_zoom_range": [0.0, 20.0],
            },
            "global_contours.minor.topo.json": {
                "schema_ref": "schema://topology/terrain_contours_minor_v1",
                "simplification": "contour_minor_publish_v1",
                "target_zoom_range": [0.0, 20.0],
            },
        }

        for relative_path, metadata in expected.items():
            self.assertEqual(outputs.get(relative_path, {}).get("schema_ref"), metadata["schema_ref"], relative_path)
            self.assertEqual(outputs.get(relative_path, {}).get("simplification"), metadata["simplification"], relative_path)
            self.assertEqual(outputs.get(relative_path, {}).get("target_zoom_range"), metadata["target_zoom_range"], relative_path)


if __name__ == "__main__":
    unittest.main()
