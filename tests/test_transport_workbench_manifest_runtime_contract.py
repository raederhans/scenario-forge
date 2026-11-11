from functools import lru_cache
from pathlib import Path
import json
import subprocess
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
CARRIER_JSON = REPO_ROOT / "data" / "transport_layers" / "japan_corridor" / "carrier.json"
CARRIER_PROVENANCE_JSON = REPO_ROOT / "data" / "transport_layers" / "japan_corridor" / "provenance.json"
LOCALES_JSON = REPO_ROOT / "data" / "locales.json"
STARTUP_LOCALE_FILES = [
    REPO_ROOT / "data" / "scenarios" / "hoi4_1936" / "locales.startup.json",
    REPO_ROOT / "data" / "scenarios" / "hoi4_1939" / "locales.startup.json",
    REPO_ROOT / "data" / "scenarios" / "tno_1962" / "locales.startup.json",
]


@lru_cache(maxsize=1)
def _resolver_pack_ids() -> dict[str, list[str]]:
    """Read the pack id lists exported by the real transport pack resolver."""
    result = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            (
                "import('./js/core/transport_pack_resolver.js')"
                ".then((m) => console.log(JSON.stringify({"
                "target: m.TARGET_MAIN_MAP_PACK_IDS, selectable: m.WORKBENCH_SELECTABLE_PACK_IDS })))"
                ".catch((error) => { console.error(error); process.exit(1); })"
            ),
        ],
        cwd=REPO_ROOT,
        check=True,
        text=True,
        capture_output=True,
    )
    return json.loads(result.stdout)


class TransportWorkbenchManifestRuntimeContractTest(unittest.TestCase):
    # 已提交的交通数据（runtime registry、manifest、carrier、locale）与运行时 pack 列表必须一致。
    def test_japan_carrier_default_orientation_is_data_driven(self) -> None:
        carrier_payload = json.loads(CARRIER_JSON.read_text(encoding="utf-8"))
        provenance_payload = json.loads(CARRIER_PROVENANCE_JSON.read_text(encoding="utf-8"))

        self.assertEqual(carrier_payload["defaultCamera"]["rotationQuarterTurns"], 1)
        self.assertEqual(provenance_payload["defaultCamera"]["rotationQuarterTurns"], 1)

    def test_main_map_target_packs_resolve_runtime_manifests_with_carriers(self) -> None:
        runtime_registry = json.loads((REPO_ROOT / "data" / "runtime_asset_registry.json").read_text(encoding="utf-8"))
        target_pack_ids = list(_resolver_pack_ids()["target"])
        expected_target_pack_ids: list[str] = []
        for pack_id, asset_key in sorted((runtime_registry.get("transport_manifest_keys") or {}).items()):
            asset_url = (runtime_registry.get("assets") or {}).get(asset_key, {}).get("url")
            if not asset_url:
                continue
            manifest_path = REPO_ROOT / asset_url
            if not manifest_path.is_file():
                continue
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            if (
                manifest.get("mainMapEligible") is True
                and manifest.get("apply_bridge_supported") is True
                and manifest.get("coverage_scope") == "country"
                and manifest.get("carrier_asset_key")
            ):
                expected_target_pack_ids.append(str(manifest.get("pack_id") or pack_id))
        missing_from_resolver = sorted(set(expected_target_pack_ids) - set(target_pack_ids))
        self.assertFalse(missing_from_resolver, missing_from_resolver)
        failures: list[str] = []

        for pack_id in target_pack_ids:
            asset_key = (runtime_registry.get("transport_manifest_keys") or {}).get(pack_id)
            if not asset_key:
                failures.append(f"{pack_id}: missing runtime manifest key")
                continue
            asset_url = (runtime_registry.get("assets") or {}).get(asset_key, {}).get("url")
            if not asset_url:
                failures.append(f"{pack_id}: missing runtime manifest url")
                continue
            manifest_path = REPO_ROOT / asset_url
            if not manifest_path.is_file():
                failures.append(f"{pack_id}: missing manifest file {asset_url}")
                continue
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            if manifest.get("pack_id") != pack_id:
                failures.append(f"{pack_id}: manifest pack_id {manifest.get('pack_id')}")
            if not manifest.get("carrier_asset_key"):
                failures.append(f"{pack_id}: missing carrier_asset_key")
            if not manifest.get("mainMapEligible"):
                failures.append(f"{pack_id}: missing mainMapEligible")
            if not manifest.get("apply_bridge_supported"):
                failures.append(f"{pack_id}: missing apply_bridge_supported")

        self.assertFalse(failures, failures)

    def test_runtime_registered_workbench_facility_packs_are_selectable(self) -> None:
        runtime_registry = json.loads((REPO_ROOT / "data" / "runtime_asset_registry.json").read_text(encoding="utf-8"))
        selectable_pack_ids = set(_resolver_pack_ids()["selectable"])
        facility_families = {"energy_facilities", "mineral_resources", "industrial_zones", "logistics_hubs"}
        missing: list[str] = []
        for pack_id, asset_key in sorted((runtime_registry.get("transport_manifest_keys") or {}).items()):
            if pack_id.startswith("japan_"):
                continue
            family_id = pack_id.split("_", 1)[1] if "_" in pack_id else ""
            if family_id in facility_families:
                if pack_id not in selectable_pack_ids:
                    missing.append(f"{pack_id}:{asset_key}")

        self.assertFalse(missing, missing)

    def test_transport_copy_drops_road_only_legacy_phrases_from_runtime_and_startup_locales(self) -> None:
        stale_phrases = [
            "Only the road family is live right now",
            "Road and rail are the only Japan families with detailed controls right now.",
            "Use the center board to sort the seven transport families.",
            "These controls style only the future rail overlay shell.",
        ]

        locales_content = LOCALES_JSON.read_text(encoding="utf-8")

        for phrase in stale_phrases:
            self.assertNotIn(phrase, locales_content)
            for startup_locale_file in STARTUP_LOCALE_FILES:
                self.assertNotIn(phrase, startup_locale_file.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
