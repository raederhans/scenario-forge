from __future__ import annotations

import hashlib
import json
import unittest
from pathlib import Path

from map_builder.runtime_asset_registry import _validate_runtime_asset_registry


REPO_ROOT = Path(__file__).resolve().parents[1]
# 这些文本产物在仓库里是 LF；Windows 检出会变成 CRLF，比较前统一换行。
CANONICAL_LF_MANIFEST_OUTPUTS = {
    "global_lakes.geojson",
    "hgo_catalogs/hgo_flags.index.json",
    "hgo_catalogs/hgo_flags.png_manifest.json",
    "hgo_catalogs/hgo_place_names.json",
    "hgo_catalogs/index.json",
    "js/core/city_lights_modern_asset.js",
    "js/core/city_lights_historical_1930_asset.js",
}


def _canonical_manifest_bytes(relative_path: str, output_bytes: bytes) -> bytes:
    if relative_path in CANONICAL_LF_MANIFEST_OUTPUTS:
        return output_bytes.replace(b"\r\n", b"\n").replace(b"\r", b"\n")
    return output_bytes


RUNTIME_ASSET_REGISTRY_SOURCE = REPO_ROOT / "data" / "runtime_asset_registry.json"
DATA_MANIFEST = REPO_ROOT / "data" / "manifest.json"


def _resolve_manifest_output_path(relative_path: str) -> Path:
    if relative_path.startswith("js/"):
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

    def test_runtime_asset_registry_cross_field_references(self) -> None:
        manifest = json.loads(DATA_MANIFEST.read_text(encoding="utf-8"))
        registry = manifest.get("runtime_asset_registry") or {}
        source_registry = json.loads(RUNTIME_ASSET_REGISTRY_SOURCE.read_text(encoding="utf-8"))
        assets = source_registry.get("assets") or {}
        self.assertEqual(registry, source_registry)
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


if __name__ == "__main__":
    unittest.main()
